import { useCallback, useEffect, useState } from 'react';
import { api, type Account } from '../api.js';
import { formatMoney, useOnline } from '../lib.js';
import { useT, type Lang } from '../i18n.js';

export function Balances({ lang, hideBalances, onToggleHide }: { lang: Lang; hideBalances: boolean; onToggleHide: () => void }) {
  const t = useT(lang);
  const online = useOnline();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ accounts: Account[] }>('/api/accounts');
      setAccounts(data.accounts);
    } catch (err) {
      setError((err as { message?: string }).message ?? t('error.generic'));
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  async function refresh(accountId: string) {
    setBusy(accountId);
    try {
      await api.post(`/api/accounts/${accountId}/balance/refresh`);
      await load();
    } catch (err) {
      setError((err as { message?: string }).message ?? t('error.generic'));
    } finally {
      setBusy(null);
    }
  }

  const currencies = [...new Set((accounts ?? []).map((a) => a.currency))];

  return (
    <div className="screen">
      <header className="topbar">
        <h1>{t('balances.title')}</h1>
        <span className="spacer" />
        <button className="icon-btn" type="button" onClick={onToggleHide} aria-pressed={hideBalances}>
          {hideBalances ? t('balances.show') : t('balances.hide')}
        </button>
      </header>

      <div className="screen-scroll">
        <div className="card">
          <div className="muted small">{t('balances.total')}</div>
          {currencies.map((currency) => {
            const total = (accounts ?? [])
              .filter((a) => a.currency === currency)
              .reduce((sum, a) => sum + (a.balance?.availableMinor ?? 0), 0);
            return (
              <div key={currency} className={`balance-total ${hideBalances ? 'hidden-balance' : ''}`}>
                {formatMoney(total, currency, { hide: hideBalances })}
              </div>
            );
          })}
          {currencies.length > 1 && <p className="notice" style={{ marginTop: 8 }}>{t('balances.multiCurrency')}</p>}
          {!online && <p className="pill offline" style={{ marginTop: 8 }}>{t('common.offline')}</p>}
        </div>

        <h2 className="small muted">{t('balances.accounts')}</h2>
        {accounts === null && <div className="skeleton" style={{ height: 60, marginBottom: 10 }} />}
        {accounts?.length === 0 && (
          <div className="card muted small">No accounts connected yet. Add one in Settings → {t('settings.accounts')}.</div>
        )}

        {(accounts ?? []).map((account) => {
          const balance = account.balance;
          const unavailable = balance?.providerStatus === 'unavailable';
          return (
            <div className="card" key={account.id}>
              <div className="row between">
                <div>
                  <div className="strong">{account.label}</div>
                  <div className="tiny muted">
                    {account.kind.replace('_', ' ')} · {account.currency}
                  </div>
                </div>
                <button className="btn secondary" style={{ width: 'auto' }} type="button"
                  onClick={() => refresh(account.id)} disabled={busy === account.id}>
                  {busy === account.id ? t('common.loading') : t('balances.refresh')}
                </button>
              </div>

              <div className="row between" style={{ marginTop: 10 }}>
                <div>
                  <div className="muted tiny">{t('confirm.available')}</div>
                  <div className={`strong ${hideBalances ? 'hidden-balance' : ''}`} style={{ fontSize: 20 }}>
                    {unavailable && <span className="tiny muted"> · {t('balances.unavailable')}</span>}
                    {formatMoney(balance?.availableMinor ?? null, balance?.currency ?? account.currency, { hide: hideBalances })}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="muted tiny">Pending</div>
                  <div className="small">{formatMoney(balance?.pendingMinor ?? null, balance?.currency ?? account.currency, { hide: hideBalances })}</div>
                </div>
              </div>

              <div className="tiny muted" style={{ marginTop: 8 }}>
                {balance ? `${t('balances.stale')}: ${new Date(balance.asOf).toLocaleTimeString()}` : 'Balance not fetched yet'}
                {balance?.stale && <span className="badge" style={{ marginLeft: 6 }}>stale</span>}
              </div>
            </div>
          );
        })}

        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
