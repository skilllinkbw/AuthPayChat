import { useEffect, useRef, useState } from 'react';
import { parsePaymentCommand, type PaymentIntent } from '@paychat/nlp';
import type { Lang } from '../i18n.js';
import { useT } from '../i18n.js';
import { draftStore, startListening, voiceSupported } from '../lib.js';
import type { ProposedPayment } from './PaymentSheet.js';

interface Props {
  lang: Lang;
  conversationId: string;
  contacts: Array<{ id: string; display_name: string; phone_e164: string }>;
  onSend: (body: string, clientMsgId: string) => void;
  onPaymentDetected: (proposal: ProposedPayment) => void;
  onRequest: () => void;
  onAttach: () => void;
}

/**
 * Payment lives inside the composer: the user never leaves the conversation to pay.
 * Typing or saying "Pay P50 Motakase" only PROPOSES a payment — the confirmation
 * sheet is always shown before anything is sent.
 */
export function Composer({ lang, conversationId, contacts, onSend, onPaymentDetected, onRequest, onAttach }: Props) {
  const t = useT(lang);
  const [text, setText] = useState(() => draftStore.get(conversationId));
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PaymentIntent | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    draftStore.set(conversationId, text);
  }, [conversationId, text]);

  useEffect(() => () => { stopRef.current?.(); }, []);

  // Live interpretation of what the user typed (same parser the server uses).
  useEffect(() => {
    const trimmed = text.trim();
    if (!trimmed) { setPreview(null); return; }
    const intent = parsePaymentCommand(trimmed, {
      resolveRecipient: (query) => {
        const q = query.toLowerCase();
        return contacts
          .filter((c) => c.display_name.toLowerCase().startsWith(q.split(' ')[0]!))
          .map((c) => ({ id: c.id, label: c.display_name, subtitle: c.phone_e164 }));
      },
    });
    setPreview(intent.action !== 'UNKNOWN' || intent.amountMinor !== undefined ? intent : null);
  }, [text, contacts]);

  function submit() {
    const body = text.trim();
    if (!body) return;

    if (preview && preview.amountMinor !== undefined && preview.recipientQuery && !preview.clarification) {
      onPaymentDetected({
        amountMinor: preview.amountMinor,
        currency: preview.currency,
        recipientLabel: contacts.find((c) => c.id === preview.recipientQuery)?.display_name ?? String(preview.recipientQuery),
        recipientContactId: contacts.some((c) => c.id === preview.recipientQuery) ? String(preview.recipientQuery) : null,
        recipientHandle: contacts.find((c) => c.id === preview.recipientQuery)?.phone_e164 ?? undefined,
        conversationId,
        source: 'text',
      });
      setText('');
      draftStore.clear(conversationId);
      return;
    }

    onSend(body, `cm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    setText('');
    draftStore.clear(conversationId);
  }

  function toggleVoice() {
    if (listening) {
      stopRef.current?.();
      setListening(false);
      return;
    }
    setVoiceError(null);
    setListening(true);
    stopRef.current = startListening(
      lang,
      (transcript) => {
        setText(transcript);
        setListening(false);
      },
      (message) => { setVoiceError(message); setListening(false); },
    );
  }

  const clarification = preview?.clarification;

  return (
    <>
      {preview && (
        <div className="subbar" role="status">
          <span className="chip" aria-pressed="true">
            {preview.action === 'REQUEST' ? '↙' : '↗'} {formatPreview(preview, lang)}
          </span>
          <span className="spacer" style={{ flex: 1 }} />
          <span className="tiny muted">
            {clarification ? (lang === 'tn' ? clarification.prompt.tn : clarification.prompt.en) : 'Confirm to continue'}
          </span>
        </div>
      )}
      {voiceError && <p className="error" style={{ padding: '0 16px' }} role="alert">{voiceError}</p>}
      <div className="composer">
        <button className="round" type="button" onClick={onAttach} aria-label="Add attachment">＋</button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder={t('composer.placeholder')}
          aria-label="Message"
          inputMode="text"
          autoComplete="off"
        />
        <button className="round" type="button" onClick={onRequest} aria-label={t('home.quickRequest')}>↙</button>
        <button
          className={`round${listening ? ' recording' : ''}`}
          type="button"
          onClick={toggleVoice}
          disabled={!voiceSupported()}
          aria-label={t('composer.voice')}
          aria-pressed={listening}
        >
          {listening ? '■' : '🎙'}
        </button>
        <button className="send" type="button" onClick={submit} aria-label={t('composer.send')}>➤</button>
      </div>
    </>
  );
}

function formatPreview(intent: PaymentIntent, lang: Lang): string {
  const action = intent.action === 'REQUEST'
    ? (lang === 'tn' ? 'Kopa' : 'Request')
    : (lang === 'tn' ? 'Duela' : 'Pay');
  const amount = intent.amountMinor !== undefined ? `P${(intent.amountMinor / 100).toFixed(2)}` : '…';
  const recipient = intent.clarification?.field === 'recipient' ? '…' : (intent.recipientQuery ?? '…');
  return `${action} ${amount} ${recipient}`;
}
