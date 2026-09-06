import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Account, type Conversation } from '../api.js';
import { formatMoney, initials, timeAgo, useOnline } from '../lib.js';
import { useT, type Lang } from '../i18n.js';

export function Home({ lang, hideBalances }: { lang: Lang; hideBalances: boolean }) {
  const t = useT(lang);
  const navigate = useNavigate();
  const online = useOnline();
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [query, setQuery] = useState('');
  const [unreadInbox, setUnreadInbox] = useState(0);

  useEffect(() => {
    void (async () => {
      try {
        const [conversationData, accountData] = await Promise.all([
          api.get<{ conversations: Conversation[] }>('/api/conversations'),
          api.get<{ accounts: Account[] }>('/api/accounts'),
        ]);
        setConversations(conversationData.conversations);
        setAccounts(accountData.accounts);
      } catch {
        setConversations([]);
      }
    })();
  }, []);

  // Inbox badge — polled so a received payment surfaces on the home screen too.
  useEffect(() => {
    let cancelled = false;
    const tick = () => void api.get<{ unreadCount: number }>('/api/notifications')
      .then((d) => { if (!cancelled) setUnreadInbox(d.unreadCount); })
      .catch(() => undefined);
    tick();
    const interval = setInterval(tick, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const currencies = [...new Set(accounts.map((a) => a.currency))];
  const totals = currencies.map((currency) => ({
    currency,
    total: accounts
      .filter((a) => a.currency === currency)
      .reduce((sum, a) => sum + (a.balance?.availableMinor ?? 0), 0),
  }));

  const filtered = (conversations ?? []).filter((c) =>
    !query || (c.peer_name ?? '').toLowerCase().includes(query.toLowerCase()) || (c.last_message ?? '').toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="screen">
      <header className="topbar">
        <img className="logo" src="/paychat-mark.png" alt="PayChat" />
        <h1>PayChat</h1>
        <span className="spacer" />
        <button
          className="btn ghost"
          style={{ width: 'auto', position: 'relative' }}
          type="button"
          onClick={() => navigate('/inbox')}
          aria-label={t('inbox.title')}
        >
          🔔
          {unreadInbox > 0 && (
            <span
              className="badge"
              style={{ position: 'absolute', top: -4, right: -4, background: 'var(--brand-teal)', color: '#fff', border: 0 }}
            >
              {unreadInbox}
            </span>
          )}
        </button>
        <span className={`pill ${online ? 'online' : 'offline'}`}>{online ? '●' : '○'}</span>
      </header>

      <div className="screen-scroll">
        <div className="card">
          <div className="row between">
            <div>
              <div className="muted small">{t('home.balanceSummary')}</div>
              {totals.length === 0 && <div className="balance-total">{formatMoney(null, 'BWP')}</div>}
              {totals.map((entry) => (
                <div key={entry.currency} className={`balance-total ${hideBalances ? 'hidden-balance' : ''}`}>
                  {formatMoney(entry.total, entry.currency, { hide: hideBalances })}
                </div>
              ))}
            </div>
            <button className="btn secondary" style={{ width: 'auto' }} type="button" onClick={() => navigate('/balances')}>
              {t('nav.balances')}
            </button>
          </div>
          {currencies.length > 1 && <p className="notice" style={{ marginTop: 10 }}>{t('balances.multiCurrency')}</p>}
        </div>

        <div className="card">
          <div className="btn-row">
            <button className="btn" type="button" onClick={() => navigate('/contacts')}>{t('home.quickPay')}</button>
            <button className="btn secondary" type="button" onClick={() => navigate('/activity')}>{t('home.quickRequest')}</button>
            <button className="btn secondary" type="button" onClick={() => navigate('/activity')}>{t('home.quickScan')}</button>
          </div>
        </div>

        <input
          className="field" placeholder="Search PayChat" value={query}
          onChange={(e) => setQuery(e.target.value)} aria-label="Search"
        />

        <h2 className="small muted" style={{ margin: '16px 0 4px' }}>{t('home.recent')}</h2>
        {conversations === null && <div className="skeleton" style={{ height: 60, marginBottom: 8 }} />}
        {conversations?.length === 0 && (
          <div className="card center muted small">No conversations yet. Start one from Contacts.</div>
        )}
        {filtered.map((conversation) => (
          <button
            key={conversation.id}
            className="list-item"
            type="button"
            onClick={() => navigate(`/chat/${conversation.id}`)}
          >
            <span className="avatar" style={{ background: 'linear-gradient(135deg,#0B3B8C,#00A88F)' }} aria-hidden="true">
              {initials(conversation.peer_name ?? 'PC')}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="strong">{conversation.peer_name ?? 'PayChat'}</span>
              {conversation.peer_is_merchant === 1 && <span className="badge" style={{ marginLeft: 6 }}>Merchant</span>}
              <br />
              <span className="small muted">{conversation.last_message ?? '—'}</span>
            </span>
            <span style={{ textAlign: 'right' }}>
              <span className="tiny muted">{timeAgo(conversation.last_message_at, lang)}</span>
              {conversation.unread > 0 && (
                <span className="badge" style={{ display: 'block', background: 'var(--brand-teal)', color: '#fff', border: 0 }}>
                  {conversation.unread}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
