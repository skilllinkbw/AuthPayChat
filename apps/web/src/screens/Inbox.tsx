/**
 * Inbox — the user's financial notification and receipt centre.
 *
 *  - Every notification is server-generated from verified transaction state (the
 *    orchestrator writes them only after a provider callback or a deterministic
 *    state transition). Nothing here is invented client-side.
 *  - Payment notifications deep-link to the receipt issued from verified data.
 *  - Unread state, per-category filtering and mark-all-read are supported.
 *  - Refreshes by polling; a realtime channel can replace this without touching
 *    the payment logic.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { timeAgo } from '../lib.js';
import { useT, type Lang } from '../i18n.js';

export interface InboxNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  data_json: string | null;
  read_at: string | null;
  created_at: string;
  receiptId?: string | null;
}

type Category = 'all' | 'received' | 'paid' | 'pending' | 'failed' | 'security';

const CATEGORIES: Array<{ id: Category; icon: string }> = [
  { id: 'all', icon: '📥' },
  { id: 'received', icon: '↙' },
  { id: 'paid', icon: '↗' },
  { id: 'pending', icon: '⏳' },
  { id: 'failed', icon: '⚠' },
  { id: 'security', icon: '🔒' },
];

/** Per-type glyph. Unknown/future types fall back to a neutral dot. */
const ICONS: Record<string, string> = {
  'payment.received': '↙',
  'payment.successful': '↗',
  'payment.pending': '⏳',
  'payment.processing': '⏳',
  'payment.created': '⏳',
  'payment.failed': '⚠',
  'payment.cancelled': '⊘',
  'payment.expired': '⊘',
  'payment.reversed': '↩',
  'payment.refunded': '↩',
  'receipt.issued': '🧾',
  'account.updated': '💰',
  'security.alert': '🔒',
};

function categoryOf(type: string): Category {
  if (type === 'payment.received') return 'received';
  if (type === 'payment.successful') return 'paid';
  if (type.startsWith('payment.reversed') || type.startsWith('payment.refunded')) return 'paid';
  if (type === 'payment.pending' || type === 'payment.processing' || type === 'payment.created') return 'pending';
  if (type === 'payment.failed' || type === 'payment.cancelled' || type === 'payment.expired') return 'failed';
  return 'security';
}

export function Inbox({ lang }: { lang: Lang }) {
  const t = useT(lang);
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<InboxNotification[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [filter, setFilter] = useState<Category>('all');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ notifications: InboxNotification[]; unreadCount: number }>('/api/notifications');
      setNotifications(data.notifications);
      setUnread(data.unreadCount);
      setError(null);
    } catch (err) {
      setError((err as { message?: string }).message ?? 'Could not load your inbox.');
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  useEffect(() => {
    void load();
    // Polling fallback for inbox updates; a realtime channel can replace this later.
    const interval = setInterval(() => void load(), 15000);
    return () => clearInterval(interval);
  }, [load]);

  async function open(notification: InboxNotification) {
    if (!notification.read_at) {
      // Optimistic unread clear; the server is authoritative on next load.
      setNotifications((all) =>
        (all ?? []).map((n) => (n.id === notification.id ? { ...n, read_at: new Date().toISOString() } : n)),
      );
      setUnread((n) => Math.max(0, n - 1));
      void api.post(`/api/notifications/${notification.id}/read`).catch(() => undefined);
    }
    if (notification.receiptId) navigate(`/receipt/${notification.receiptId}`);
  }

  async function markAllRead() {
    await api.post('/api/notifications/read-all', {}).catch(() => undefined);
    await load();
  }

  const visible = (notifications ?? []).filter((n) => filter === 'all' || categoryOf(n.type) === filter);

  return (
    <div className="screen">
      <header className="topbar">
        <button className="btn ghost" type="button" onClick={() => navigate(-1)} aria-label="Back">←</button>
        <h1>{t('inbox.title')}</h1>
        <span className="spacer" />
        {unread > 0 && <span className="badge" aria-label={`${unread} unread`}>{unread}</span>}
      </header>

      <div className="screen-scroll">
        <div className="btn-row" role="tablist" aria-label={t('inbox.filter')}>
          {CATEGORIES.map((category) => (
            <button
              key={category.id}
              className={`btn ${filter === category.id ? 'teal' : 'secondary'}`}
              style={{ width: 'auto' }}
              type="button"
              role="tab"
              aria-selected={filter === category.id}
              onClick={() => setFilter(category.id)}
            >
              <span aria-hidden="true">{category.icon} </span>{t(`inbox.cat.${category.id}`)}
            </button>
          ))}
        </div>

        <div className="row between" style={{ marginTop: 10 }}>
          <button className="btn ghost small" style={{ width: 'auto' }} type="button" onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? t('common.loading') : t('balances.refresh')}
          </button>
          {unread > 0 && (
            <button className="btn ghost small" style={{ width: 'auto' }} type="button" onClick={() => void markAllRead()}>
              {t('inbox.markAll')}
            </button>
          )}
        </div>

        {error && <p className="error" role="alert">{error}</p>}

        {notifications === null && <div className="skeleton" style={{ height: 72 }} />}
        {notifications !== null && visible.length === 0 && (
          <div className="card center muted small" style={{ marginTop: 12 }}>
            {t('inbox.empty')}
          </div>
        )}

        {visible.map((notification) => (
          <button
            key={notification.id}
            className={`list-item ${notification.read_at ? '' : 'unread'}`}
            type="button"
            onClick={() => void open(notification)}
            aria-label={notification.title}
          >
            <span className="avatar" aria-hidden="true" style={{ background: 'linear-gradient(135deg,#0B3B8C,#00A88F)' }}>
              {ICONS[notification.type] ?? '•'}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="strong">
                {notification.title}
                {!notification.read_at && <span className="dot-unread" aria-label="Unread" />}
              </span>
              <br />
              <span className="small muted">{notification.body}</span>
              <br />
              <span className="tiny muted">{timeAgo(notification.created_at, lang)}</span>
            </span>
            {notification.receiptId && (
              <span className="tiny muted">{t('receipt.view')} →</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}