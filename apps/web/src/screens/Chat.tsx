import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, isTerminalStatus, type Contact, type Message, type IntentView } from '../api.js';
import { Composer } from '../components/Composer.js';
import { PaymentSheet, type ProposedPayment } from '../components/PaymentSheet.js';
import { formatMoney, timeAgo, initials, useOnline, outboxQueue } from '../lib.js';
import { useT, type Lang } from '../i18n.js';

export function Chat({ lang }: { lang: Lang }) {
  const { id = '' } = useParams();
  const t = useT(lang);
  const online = useOnline();
  const [messages, setMessages] = useState<Message[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [intents, setIntents] = useState<Record<string, IntentView>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<ProposedPayment | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestAmount, setRequestAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async () => {
    try {
      const data = await api.get<{ messages: Message[] }>(`/api/conversations/${id}/messages?limit=30`);
      setMessages(data.messages);
      setError(null);
    } catch (err) {
      setError((err as { message?: string }).message ?? t('error.generic'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  const loadIntents = useCallback(async (list: Message[]) => {
    const ids = [...new Set(list.map((m) => m.payment_intent_id).filter(Boolean) as string[])];
    for (const intentId of ids) {
      if (intents[intentId]) continue;
      try {
        const intent = await api.get<IntentView>(`/api/payments/intents/${intentId}`);
        setIntents((prev) => ({ ...prev, [intentId]: intent }));
      } catch {
        // The payment belongs to the other party — the card is rendered without detail.
      }
    }
  }, [intents]);

  useEffect(() => {
    void (async () => {
      await loadMessages();
      try {
        const contactData = await api.get<{ contacts: Contact[] }>('/api/contacts');
        setContacts(contactData.contacts);
      } catch { /* contacts are optional for the composer parser */ }
    })();
  }, [loadMessages, id]);

  useEffect(() => { void loadIntents(messages); }, [messages, loadIntents]);

  // Realtime: SSE when available, polling as a low-connectivity fallback.
  useEffect(() => {
    let closed = false;
    const token = localStorage.getItem('paychat.access');
    const source = token ? new EventSource(`/api/events?token=${encodeURIComponent(token)}`) : null;
    source?.addEventListener('message', () => { if (!closed) void loadMessages(); });
    source?.addEventListener('error', () => { /* EventSource retries on its own */ });

    const poll = setInterval(() => { if (!closed && document.visibilityState === 'visible') void loadMessages(); }, 8000);
    return () => { closed = true; source?.close(); clearInterval(poll); };
  }, [loadMessages]);

  // Flush messages that were drafted while offline.
  useEffect(() => {
    if (!online) return;
    void (async () => {
      for (const queued of outboxQueue.all()) {
        try {
          await api.post(`/api/conversations/${queued.conversationId}/messages`, { body: queued.body, clientMsgId: queued.clientMsgId });
          outboxQueue.remove(queued.clientMsgId);
          if (queued.conversationId === id) void loadMessages();
        } catch { /* keep it queued for the next reconnect */ }
      }
    })();
  }, [online, id, loadMessages]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages.length]);

  const peerName = useMemo(() => {
    const fromPeer = messages.find((m) => m.sender_id && m.sender_name)?.sender_name;
    return fromPeer ?? 'PayChat';
  }, [messages]);

  async function send(body: string, clientMsgId: string) {
    try {
      await api.post(`/api/conversations/${id}/messages`, { body, clientMsgId });
      await loadMessages();
    } catch {
      outboxQueue.add({ conversationId: id, body, clientMsgId });
      setMessages((prev) => [...prev, {
        id: clientMsgId, conversation_id: id, sender_id: 'me', kind: 'text', body,
        payment_intent_id: null, payment_request_id: null, created_at: new Date().toISOString(), sender_name: 'You',
      }]);
    }
  }

  async function loadOlder() {
    if (!messages.length) return;
    const oldest = messages[0]!;
    const data = await api.get<{ messages: Message[] }>(
      `/api/conversations/${id}/messages?limit=30&before=${encodeURIComponent(oldest.created_at)}&beforeId=${encodeURIComponent(oldest.id)}`,
    );
    setMessages((prev) => [...data.messages, ...prev]);
  }

  async function createRequest() {
    setBusy(true);
    try {
      const minor = Math.round(Number(requestAmount) * 100);
      await api.post('/api/requests', {
        payerLabel: peerName, conversationId: id, amountMinor: minor, currency: 'BWP',
        description: 'Payment request',
      });
      setRequestOpen(false);
      setRequestAmount('');
      await loadMessages();
    } catch (err) {
      setError((err as { message?: string }).message ?? t('error.generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <header className="topbar">
        <span className="avatar" aria-hidden="true" style={{ background: 'linear-gradient(135deg,#0B3B8C,#00A88F)' }}>
          {initials(peerName)}
        </span>
        <h1>{peerName}</h1>
        <span className="spacer" />
        <span className={`pill ${online ? 'online' : 'offline'}`}>{online ? t('common.online') : t('common.offline')}</span>
      </header>

      <div className="thread" ref={threadRef}>
        <button className="btn ghost small" type="button" onClick={loadOlder}>Load earlier messages</button>
        {loading && <div className="skeleton" style={{ height: 40 }} />}
        {messages.map((message) => {
          const intent = message.payment_intent_id ? intents[message.payment_intent_id] : undefined;
          if (message.kind === 'payment' && intent) {
            return <PaymentCard key={message.id} lang={lang} intent={intent} />;
          }
          if (message.kind === 'payment') {
            return (
              <div key={message.id} className={`bubble ${message.sender_id ? '' : 'me'}`}>
                <strong>💸 Payment</strong>
                <div className="meta">{message.body}</div>
              </div>
            );
          }
          return (
            <div key={message.id} className={`bubble ${message.sender_name === null ? 'me' : ''}`}>
              <div>{message.body}</div>
              <div className="meta">{timeAgo(message.created_at, lang)}</div>
            </div>
          );
        })}
      </div>

      {error && <p className="error" style={{ padding: '0 16px' }} role="alert">{error}</p>}

      {requestOpen && (
        <div className="sheet-backdrop" role="dialog" aria-modal="true">
          <div className="sheet">
            <div className="grab" />
            <h2>{t('home.quickRequest')}</h2>
            <label className="field">
              <span>Amount (P)</span>
              <input className="field" inputMode="decimal" value={requestAmount}
                onChange={(e) => setRequestAmount(e.target.value)} placeholder="200.00" />
            </label>
            <div className="btn-row">
              <button className="btn secondary" type="button" onClick={() => setRequestOpen(false)}>{t('confirm.cancel')}</button>
              <button className="btn teal" type="button" onClick={createRequest} disabled={busy || !requestAmount}>
                {t('request.pay')}
              </button>
            </div>
          </div>
        </div>
      )}

      {proposal && (
        <PaymentSheet
          lang={lang}
          proposal={proposal}
          onClose={() => setProposal(null)}
          onDone={() => { void loadMessages(); }}
        />
      )}

      <Composer
        lang={lang}
        conversationId={id}
        contacts={contacts.map((c) => ({ id: c.id, display_name: c.display_name, phone_e164: c.phone_e164 }))}
        onSend={send}
        onPaymentDetected={(p) => setProposal(p)}
        onRequest={() => setRequestOpen(true)}
        onAttach={() => setProposal({
          amountMinor: 0, currency: 'BWP', recipientLabel: peerName, conversationId: id, source: 'text',
        })}
      />
    </div>
  );
}

function PaymentCard({ lang, intent }: { lang: Lang; intent: IntentView }) {
  const t = useT(lang);
  const tone = ['SUCCESSFUL', 'REFUNDED'].includes(intent.status)
    ? 'success'
    : ['FAILED', 'REVERSED'].includes(intent.status)
      ? 'failed'
      : isTerminalStatus(intent.status) ? 'neutral' : 'pending';
  const icon = intent.status === 'SUCCESSFUL' ? '✓' : intent.status === 'FAILED' ? '✕' : '⏳';

  return (
    <div className={`paycard ${tone}`}>
      <div className="status-line">
        <span aria-hidden="true">{icon}</span>
        <span>{t(`status.${intent.status}`)}</span>
      </div>
      <div className="amount">{formatMoney(intent.amountMinor, intent.currency)}</div>
      <div className="small muted">Ref: {intent.reference}</div>
      {intent.status === 'SUCCESSFUL' && intent.receiptId && (
        <a className="btn ghost small" href={`#/receipt/${intent.receiptId}`} style={{ display: 'inline-block', marginTop: 6 }}>
          {t('receipt.view')}
        </a>
      )}
    </div>
  );
}
