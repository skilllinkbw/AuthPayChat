import { useEffect, useMemo, useState } from 'react';
import { api, type QuoteMethod, type IntentView, isTerminalStatus } from '../api.js';
import { confirmWithBiometric, confirmWithPassword, biometricSupported, formatMoney } from '../lib.js';
import { useT } from '../i18n.js';
import type { Lang } from '../i18n.js';

export interface ProposedPayment {
  amountMinor: number;
  currency: string;
  recipientLabel: string;
  recipientContactId?: string | null;
  recipientHandle?: string | null;
  conversationId?: string | null;
  narration?: string | null;
  /** How the command was captured (typed or spoken) — shown for transparency, never trusted. */
  source?: 'text' | 'voice';
}

interface Props {
  lang: Lang;
  proposal: ProposedPayment;
  onClose: () => void;
  onDone: (intent: IntentView) => void;
}

/**
 * The confirmation step. Nothing about this screen sends money by itself:
 * the intent is created on the server, the user picks a method, and only an
 * explicit Confirm (with biometric / password step-up where required) initiates it.
 */
export function PaymentSheet({ lang, proposal, onClose, onDone }: Props) {
  const t = useT(lang);
  const [methods, setMethods] = useState<QuoteMethod[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stepUpMode, setStepUpMode] = useState<'none' | 'biometric' | 'password'>('none');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [intent, setIntent] = useState<IntentView | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const quote = await api.post<{ methods: QuoteMethod[] }>('/api/accounts/quote', {
          amountMinor: proposal.amountMinor, currency: proposal.currency,
        });
        setMethods(quote.methods);
        const usable = quote.methods.filter((m) => m.insufficient === false);
        setSelected((quote.methods.find((m) => m.insufficient === false) ?? usable[0] ?? quote.methods[0])?.accountId ?? null);
      } catch (err) {
        setError((err as { message?: string }).message ?? t('error.generic'));
      }
    })();
  }, [proposal.amountMinor, proposal.currency, t]);

  const selectedMethod = useMemo(() => methods?.find((m) => m.accountId === selected) ?? null, [methods, selected]);

  async function createIntent(): Promise<IntentView> {
    if (intent) return intent;
    const created = await api.post<IntentView>('/api/payments/intents', {
      recipientContactId: proposal.recipientContactId ?? undefined,
      recipientHandle: proposal.recipientHandle ?? undefined,
      recipientLabel: proposal.recipientLabel,
      amountMinor: proposal.amountMinor,
      currency: proposal.currency,
      narration: proposal.narration ?? undefined,
      conversationId: proposal.conversationId ?? undefined,
    }, { 'idempotency-key': `web-${proposal.conversationId ?? 'quick'}-${proposal.amountMinor}-${Date.now()}` });
    setIntent(created);
    return created;
  }

  async function pollToCompletion(pendingIntent: IntentView): Promise<IntentView> {
    let current = pendingIntent;
    for (let attempt = 0; attempt < 30 && !isTerminalStatus(current.status); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      current = await api.get<IntentView>(`/api/payments/intents/${current.id}`);
      setStatus(current.status);
    }
    setIntent(current);
    return current;
  }

  async function doConfirm() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createIntent();

      // Step-up: high value, new recipient, new device or unusual velocity.
      if (created.risk?.reasons?.length) {
        setStepUpMode(biometricSupported() ? 'biometric' : 'password');
        setBusy(false);
        return;
      }
      await initiate(created);
    } catch (err) {
      const apiError = err as { message?: string; requiresStepUp?: boolean };
      if (apiError.requiresStepUp) {
        setStepUpMode(biometricSupported() ? 'biometric' : 'password');
        setBusy(false);
        return;
      }
      setError(apiError.message ?? t('error.generic'));
      setBusy(false);
    }
  }

  async function initiate(createdIntent: IntentView) {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await api.post<{ status: string; providerRef?: string }>(
        `/api/payments/intents/${createdIntent.id}/confirm`,
        { accountId: selected, authMethod: stepUpMode === 'biometric' ? 'biometric' : 'password' },
      );
      setStatus(result.status);
      const settled = await pollToCompletion({ ...createdIntent, status: result.status });
      onDone(settled);
      onClose();
    } catch (err) {
      const apiError = err as { message?: string };
      setError(apiError.message ?? t('error.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function runStepUp() {
    setBusy(true);
    setError(null);
    const result = stepUpMode === 'biometric' ? await confirmWithBiometric() : await confirmWithPassword(password);
    setBusy(false);
    if (!result.ok) {
      setError(result.message ?? t('confirm.verify'));
      return;
    }
    const created = intent ?? (await createIntent());
    await initiate(created);
  }

  const insufficient = selectedMethod?.insufficient === true;

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label={t('confirm.title')}>
      <div className="sheet">
        <div className="grab" />
        <h2>{t('confirm.title')}</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          {proposal.source === 'voice' ? '🎙 ' : ''}{t('app.tagline')}
        </p>

        <div className="card" style={{ marginTop: 8 }}>
          <div className="center">
            <div className="muted small">{t('confirm.to')} {proposal.recipientLabel}</div>
            <div className="balance-total" style={{ fontSize: 34 }}>
              {formatMoney(proposal.amountMinor, proposal.currency)}
            </div>
            <div className="tiny muted">{proposal.currency}</div>
          </div>
        </div>

        <div className="strong small" style={{ margin: '8px 0' }}>{t('confirm.method')}</div>
        {methods === null && <div className="skeleton" style={{ height: 56 }} />}
        {methods?.length === 0 && (
          <p className="notice">No payment method is connected yet. Connect an account in Settings to start paying.</p>
        )}
        {methods?.map((method) => (
          <button
            key={method.accountId}
            className="method"
            aria-selected={method.accountId === selected}
            onClick={() => setSelected(method.accountId)}
            type="button"
          >
            <span className="dot" aria-hidden="true">{method.label.slice(0, 1)}</span>
            <span style={{ flex: 1 }}>
              <span className="strong">{method.label}</span>
              <br />
              <span className="tiny muted">
                {t('confirm.available')}: {formatMoney(method.availableMinor, method.currency)}
                {method.providerStatus === 'unavailable' ? ` · ${t('balances.unavailable')}` : ''}
              </span>
            </span>
            {method.insufficient === true && <span className="insufficient small">✕ {t('confirm.insufficient')}</span>}
            {method.insufficient === false && <span className="small" style={{ color: 'var(--ok)' }}>✓</span>}
          </button>
        ))}

        {stepUpMode !== 'none' && (
          <div className="card" style={{ marginTop: 8 }}>
            <p className="small" style={{ marginTop: 0 }}>
              <strong>{t('confirm.stepup')}</strong>
            </p>
            {stepUpMode === 'biometric' ? (
              <p className="small muted">Use your fingerprint or face to confirm. PayChat never stores your biometric data.</p>
            ) : (
              <label className="field">
                <span>Password</span>
                <input
                  className="field" type="password" value={password}
                  onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
                />
              </label>
            )}
          </div>
        )}

        {status && !isTerminalStatus(status) && (
          <p className="pill" style={{ marginTop: 8 }}>⏳ {t(`status.${status}`)}</p>
        )}

        {error && <p className="error" role="alert">{error}</p>}

        <div className="btn-row" style={{ marginTop: 14 }}>
          <button className="btn secondary" type="button" onClick={onClose} disabled={busy}>{t('confirm.cancel')}</button>
          {stepUpMode === 'none' ? (
            <button className="btn teal" type="button" onClick={doConfirm} disabled={busy || !selected || insufficient}>
              {busy ? t('confirm.verifying') : t('confirm.confirm')}
            </button>
          ) : (
            <button className="btn teal" type="button" onClick={runStepUp} disabled={busy}>
              {busy ? t('confirm.verifying') : t('confirm.verify')}
            </button>
          )}
        </div>

        {insufficient && (
          <p className="error" role="alert">{t('confirm.insufficient')} — choose another method.</p>
        )}
      </div>
    </div>
  );
}
