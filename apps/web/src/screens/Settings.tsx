import { useCallback, useEffect, useState } from 'react';
import { api, type Account } from '../api.js';
import { biometricSupported, enrolBiometric, formatMoney } from '../lib.js';
import { useT, type Lang } from '../i18n.js';

interface Session { id: string; device_label: string | null; created_at: string; revoked_at: string | null; }
interface Credential { id: string; label: string | null; createdAt: string; }

export function Settings({
  lang, setLang, hideBalances, onToggleHide, onLogout,
}: {
  lang: Lang;
  setLang: (lang: Lang) => void;
  hideBalances: boolean;
  onToggleHide: () => void;
  onLogout: () => void;
}) {
  const t = useT(lang);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [providers, setProviders] = useState<Array<{ id: string; displayName: string; kind: string; enabled: boolean }>>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [accountData, sessionData, credentialData, providerData] = await Promise.all([
      api.get<{ accounts: Account[] }>('/api/accounts'),
      api.get<{ sessions: Session[] }>('/api/auth/sessions'),
      api.get<{ credentials: Credential[] }>('/api/webauthn/credentials'),
      api.get<{ providers: Array<{ id: string; displayName: string; kind: string; enabled: boolean }> }>('/api/providers'),
    ]);
    setAccounts(accountData.accounts);
    setSessions(sessionData.sessions);
    setCredentials(credentialData.credentials);
    setProviders(providerData.providers);
  }, []);

  useEffect(() => { void load().catch(() => undefined); }, [load]);

  async function connect(providerId: string, displayName: string) {
    setConnecting(providerId);
    setMessage(null);
    try {
      await api.post('/api/accounts/connect', {
        providerId,
        label: displayName,
        // In a live deployment this reference comes back from the provider's OAuth consent
        // step; here the user supplies the wallet/account handle they have with the provider.
        providerAccountRef: prompt(`Enter your ${displayName} account / wallet reference`) ?? '',
        currency: 'BWP',
        makeDefault: accounts.length === 0,
      });
      await load();
      setMessage(`${displayName} connected.`);
    } catch (err) {
      setMessage((err as { message?: string }).message ?? 'Could not connect that account.');
    } finally {
      setConnecting(null);
    }
  }

  async function disconnect(accountId: string) {
    await api.del(`/api/accounts/${accountId}`);
    await load();
  }

  async function enrol() {
    const result = await enrolBiometric();
    setMessage(result.ok ? 'Biometric confirmation is set up.' : (result.message ?? 'Could not set up biometrics.'));
    if (result.ok) await load();
  }

  async function revokeSession(sessionId: string) {
    await api.post('/api/auth/sessions/revoke', { sessionId });
    await load();
  }

  return (
    <div className="screen">
      <header className="topbar"><h1>{t('nav.settings')}</h1></header>
      <div className="screen-scroll">
        <div className="card">
          <div className="strong">{t('settings.language')}</div>
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button className={`btn ${lang === 'en' ? '' : 'secondary'}`} type="button" onClick={() => setLang('en')}>English</button>
            <button className={`btn ${lang === 'tn' ? '' : 'secondary'}`} type="button" onClick={() => setLang('tn')}>Setswana</button>
          </div>
        </div>

        <div className="card">
          <div className="strong">{t('settings.privacy')}</div>
          <button className="btn secondary" style={{ marginTop: 8 }} type="button" onClick={onToggleHide}>
            {hideBalances ? t('balances.show') : t('balances.hide')}
          </button>
        </div>

        <div className="card">
          <div className="strong">{t('settings.biometric')}</div>
          <p className="small muted">
            Uses your device fingerprint or face. PayChat never receives or stores your biometric data —
            your device confirms it is you and returns a signed result the server verifies.
          </p>
          {!biometricSupported() && (
            <p className="notice">This browser does not expose platform biometrics here. Payments will use password confirmation instead.</p>
          )}
          <button className="btn secondary" type="button" onClick={enrol} disabled={!biometricSupported()}>
            {t('settings.biometricEnroll')}
          </button>
          {credentials.map((credential) => (
            <div className="row between tiny muted" key={credential.id} style={{ marginTop: 6 }}>
              <span>✓ {credential.label ?? 'This device'}</span>
              <span>{new Date(credential.createdAt).toLocaleDateString()}</span>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="strong">{t('settings.accounts')}</div>
          {accounts.map((account) => (
            <div className="row between" key={account.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              <span>
                <span className="strong">{account.label}</span>
                <br />
                <span className="tiny muted">{account.currency} · {formatMoney(account.balance?.availableMinor ?? null, account.currency, { hide: hideBalances })}</span>
              </span>
              <button className="btn ghost small" style={{ width: 'auto' }} type="button" onClick={() => disconnect(account.id)}>
                Disconnect
              </button>
            </div>
          ))}
          <div className="stack" style={{ marginTop: 10 }}>
            {providers.filter((p) => p.enabled && !accounts.some((a) => a.providerId === p.id)).map((provider) => (
              <button key={provider.id} className="btn secondary" type="button"
                onClick={() => connect(provider.id, provider.displayName)}
                disabled={connecting === provider.id}>
                {connecting === provider.id ? t('common.loading') : `Connect ${provider.displayName}`}
              </button>
            ))}
          </div>
          {providers.filter((p) => p.enabled).length === 0 && (
            <p className="notice" style={{ marginTop: 8 }}>
              No live payment providers are configured on this deployment. Real rails become available once
              their API credentials are set — PayChat never pretends a rail is connected when it is not.
            </p>
          )}
        </div>

        <div className="card">
          <div className="strong">{t('settings.sessions')}</div>
          {sessions.map((session) => (
            <div className="row between" key={session.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              <span>
                <span className="small">{session.device_label ?? 'This device'}</span>
                <br />
                <span className="tiny muted">{new Date(session.created_at).toLocaleString()} {session.revoked_at ? '· revoked' : ''}</span>
              </span>
              {!session.revoked_at && (
                <button className="btn ghost small" style={{ width: 'auto' }} type="button" onClick={() => revokeSession(session.id)}>
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>

        {message && <p className="notice" role="status">{message}</p>}

        <button className="btn danger" type="button" onClick={onLogout}>{t('settings.logout')}</button>
      </div>
    </div>
  );
}
