import { useState } from 'react';
import { api, tokenStore, type AuthResponse } from '../api.js';
import { useT, type Lang } from '../i18n.js';

export function Auth({ lang, onAuthenticated }: { lang: Lang; onAuthenticated: (user: AuthResponse['user']) => void }) {
  const t = useT(lang);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const path = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const payload = mode === 'login'
        ? { phone, password, deviceLabel: navigator.platform, platform: navigator.userAgent }
        : { phone, password, displayName: name, language: lang, deviceLabel: navigator.platform, platform: navigator.userAgent };
      const result = await api.post<AuthResponse>(path, payload);
      tokenStore.set(result.accessToken, result.refreshToken);
      onAuthenticated(result.user);
    } catch (err) {
      const apiError = err as { message?: string; fields?: Array<{ message: string }> };
      setError(apiError.fields?.[0]?.message ?? apiError.message ?? t('error.generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <div className="screen-scroll" style={{ paddingTop: 40 }}>
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <img src="/paychat-logo.png" alt="PayChat" style={{ width: '70%', maxWidth: 260, display: 'block', margin: '0 auto 4px' }} />
          <p className="center muted small" style={{ marginTop: 0 }}>{t('app.tagline')}</p>
        </div>

        <div style={{ textAlign: 'center', margin: '8px 0 16px' }}>
          <div className="company-brand">by Braincade Holdings (Pty) Ltd</div>
          <div className="company-reg">Reg. No. BW00001951757</div>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>{mode === 'login' ? t('auth.signin') : t('auth.welcome')}</h2>
          <p className="small muted" style={{ marginTop: 0 }}>{t('auth.welcomeBody')}</p>

          <form onSubmit={submit}>
            {mode === 'register' && (
              <label className="field">
                <span>{t('auth.name')}</span>
                <input className="field" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoComplete="name" />
              </label>
            )}
            <label className="field">
              <span>{t('auth.phone')}</span>
              <input className="field" value={phone} onChange={(e) => setPhone(e.target.value)}
                placeholder="+26771234567" required inputMode="tel" autoComplete="tel" />
            </label>
            <label className="field">
              <span>{t('auth.password')}</span>
              <input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                required minLength={10} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
            </label>

            {error && <p className="error" role="alert">{error}</p>}

            <button className="btn" type="submit" disabled={busy}>
              {busy ? t('common.loading') : (mode === 'login' ? t('auth.signin') : t('auth.register'))}
            </button>
          </form>

          <button className="btn ghost" type="button"
            onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}>
            {mode === 'login' ? t('auth.register') : t('auth.signin')}
          </button>
        </div>

        <div className="legal-footer">
          <p className="center tiny muted">
            PayChat is a product of Braincade Holdings (Pty) Ltd, a company registered in Botswana (Reg. No. BW00001951757).
            Payments are processed through PayChat's secure payment rails.
          </p>
          <p className="center tiny">
            <a href="#/terms" className="legal-link">Terms &amp; Conditions</a>
            {' · '}
            <a href="#/privacy" className="legal-link">Privacy Notice</a>
            {' · '}
            <a href="#/security-guide" className="legal-link">Safety Guidance</a>
          </p>
          <p className="center tiny muted">
            +267 76 749 821 &nbsp;|&nbsp; +267 26 150 87
          </p>
        </div>
      </div>
    </div>
  );
}
