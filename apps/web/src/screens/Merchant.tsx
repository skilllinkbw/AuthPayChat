/**
 * Merchant console (brief §17).
 *
 * Onboarding, settlement summary, received payments, reconciliation and refunds. Every
 * number shown here comes from an owner-scoped endpoint — the server never returns another
 * business's data, and there is no screen that lists other merchants.
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatMoney } from '../lib.js';
import { useT, type Lang } from '../i18n.js';

interface Summary {
  businessName: string;
  settlementCurrency: string;
  settledMinor: number;
  pendingMinor: number;
  failedMinor: number;
  refundedMinor: number;
  transactionCount: number;
}

interface Txn {
  id: string;
  reference: string;
  amount_minor: number;
  currency: string;
  status: string;
  customer_label: string | null;
  created_at: string;
}

export function Merchant({ lang, isMerchant, onOnboarded }: { lang: Lang; isMerchant: boolean; onOnboarded: () => void }) {
  const t = useT(lang);
  const [businessName, setBusinessName] = useState('');
  const [category, setCategory] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [transactions, setTransactions] = useState<Txn[]>([]);
  const [code, setCode] = useState<{ qr: string; token: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null);

  const load = useCallback(async () => {
    if (!isMerchant) return;
    try {
      const [summaryData, txnData] = await Promise.all([
        api.get<Summary>('/api/merchant/summary'),
        api.get<{ transactions: Txn[] }>('/api/merchant/transactions'),
      ]);
      setSummary(summaryData);
      setTransactions(txnData.transactions);
    } catch (error) {
      setStatus({ kind: 'error', message: (error as { message?: string }).message ?? 'Could not load your business data' });
    }
  }, [isMerchant]);

  useEffect(() => { void load(); }, [load]);

  const onboard = async () => {
    setBusy(true);
    try {
      await api.post('/api/merchant/onboard', { businessName, category: category || undefined, settlementCurrency: 'BWP' });
      onOnboarded();
      await load();
      setStatus({ kind: 'ok', message: 'Your business account is ready.' });
    } catch (error) {
      setStatus({ kind: 'error', message: (error as { message?: string }).message ?? 'Could not create the business account' });
    } finally {
      setBusy(false);
    }
  };

  const reconcile = async () => {
    setBusy(true);
    try {
      const result = await api.post<{ checked: number; inserted: number; updated: number }>('/api/merchant/reconcile', {});
      setStatus({ kind: 'ok', message: `Checked ${result.checked} payments · ${result.inserted} added · ${result.updated} updated` });
      await load();
    } catch (error) {
      setStatus({ kind: 'error', message: (error as { message?: string }).message ?? 'Reconciliation failed' });
    } finally {
      setBusy(false);
    }
  };

  const refund = async (id: string) => {
    setBusy(true);
    try {
      const result = await api.post<{ status: string }>(`/api/merchant/transactions/${id}/refund`, {});
      setStatus({ kind: 'ok', message: `Refunded — ${result.status}` });
      await load();
    } catch (error) {
      setStatus({ kind: 'error', message: (error as { message?: string }).message ?? 'Refund failed' });
    } finally {
      setBusy(false);
    }
  };

  const publishCode = async () => {
    try {
      const data = await api.post<{ qr: string; token: string }>('/api/merchant/qr', { currency: 'BWP' });
      setCode(data);
    } catch (error) {
      setStatus({ kind: 'error', message: (error as { message?: string }).message ?? 'Could not publish your code' });
    }
  };

  if (!isMerchant) {
    return (
      <div className="screen-scroll">
        <header className="screen-header"><h1>{String(t('merchant.title'))}</h1></header>
        <section className="card">
          <h2 className="card-title">{String(t('merchant.onboard'))}</h2>
          <label className="field">
            <span>{String(t('merchant.businessName'))}</span>
            <input className="field" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Mma Ramotswe Coffee" />
          </label>
          <label className="field">
            <span>{String(t('merchant.category'))}</span>
            <input className="field" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="cafe" />
          </label>
          <div className="btn-row">
            <button className="btn teal" type="button" disabled={busy || businessName.trim().length < 2} onClick={() => void onboard()}>
              {String(t('merchant.onboard'))}
            </button>
          </div>
        </section>
        {status && <p className={status.kind === 'ok' ? 'notice ok' : 'notice error'}>{status.message}</p>}
      </div>
    );
  }

  return (
    <div className="screen-scroll">
      <header className="screen-header">
        <h1>{summary?.businessName ?? String(t('merchant.title'))}</h1>
      </header>

      <section className="card">
        <h2 className="card-title">{String(t('merchant.summary'))}</h2>
        <div className="stat-grid">
          <div className="stat"><span className="muted small">{String(t('merchant.settled'))}</span><strong>{formatMoney(summary?.settledMinor ?? 0, summary?.settlementCurrency ?? 'BWP')}</strong></div>
          <div className="stat"><span className="muted small">{String(t('merchant.pending'))}</span><strong>{formatMoney(summary?.pendingMinor ?? 0, summary?.settlementCurrency ?? 'BWP')}</strong></div>
          <div className="stat"><span className="muted small">{String(t('merchant.refunded'))}</span><strong>{formatMoney(summary?.refundedMinor ?? 0, summary?.settlementCurrency ?? 'BWP')}</strong></div>
        </div>
        <div className="btn-row">
          <button className="btn" type="button" disabled={busy} onClick={() => void reconcile()}>{String(t('merchant.reconcile'))}</button>
          <button className="btn secondary" type="button" onClick={() => void publishCode()}>{String(t('merchant.myCode'))}</button>
        </div>
        {code && (
          <div className="qr-wrap">
            <img src={code.qr} alt="Your business payment code" width={200} height={200} />
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">{String(t('merchant.transactions'))}</h2>
        {transactions.length === 0 && <p className="muted small">{String(t('merchant.empty'))}</p>}
        <ul className="list">
          {transactions.map((txn) => (
            <li key={txn.id} className="row-between">
              <div>
                <div>{txn.customer_label ?? txn.reference}</div>
                <div className="muted small">{new Date(txn.created_at).toLocaleString()} · {txn.status}</div>
              </div>
              <div className="row-gap">
                <strong>{formatMoney(txn.amount_minor, txn.currency)}</strong>
                {txn.status === 'SUCCESSFUL' && (
                  <button className="btn small" type="button" disabled={busy} onClick={() => void refund(txn.id)}>{String(t('merchant.refund'))}</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {status && <p className={status.kind === 'ok' ? 'notice ok' : 'notice error'}>{status.message}</p>}
    </div>
  );
}
