import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, type Receipt } from '../api.js';
import { formatMoney, timeAgo } from '../lib.js';
import { useT, type Lang } from '../i18n.js';

interface PaymentRow {
  id: string; reference: string; status: string; amountMinor: number; currency: string;
  recipientLabel: string; createdAt: string; receiptId: string | null;
}
interface RequestRow {
  id: string; reference: string; amount_minor: number; currency: string; status: string;
  payer_label: string; requester_user_id: string; created_at: string;
}

export function Activity({ lang }: { lang: Lang }) {
  const t = useT(lang);
  const navigate = useNavigate();
  const [tab, setTab] = useState<'payments' | 'requests'>('payments');
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [paymentData, requestData] = await Promise.all([
      api.get<{ payments: PaymentRow[] }>('/api/payments'),
      api.get<{ requests: RequestRow[] }>('/api/requests'),
    ]);
    setPayments(paymentData.payments);
    setRequests(requestData.requests as unknown as RequestRow[]);
  }, []);

  useEffect(() => { void load().catch(() => undefined); }, [load]);

  async function decline(id: string) {
    setBusy(id);
    try { await api.post(`/api/requests/${id}/decline`); await load(); } finally { setBusy(null); }
  }

  return (
    <div className="screen">
      <header className="topbar"><h1>{t('activity.title')}</h1></header>
      <div className="subbar">
        <button className="chip" type="button" aria-pressed={tab === 'payments'} onClick={() => setTab('payments')}>
          {t('activity.payments')}
        </button>
        <button className="chip" type="button" aria-pressed={tab === 'requests'} onClick={() => setTab('requests')}>
          {t('activity.requests')}
        </button>
      </div>

      <div className="screen-scroll">
        {tab === 'payments' && payments.map((payment) => (
          <div className="card" key={payment.id}>
            <div className="row between">
              <div>
                <div className="strong">{payment.recipientLabel}</div>
                <div className="tiny muted">{payment.reference} · {timeAgo(payment.createdAt, lang)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="strong mono">{formatMoney(payment.amountMinor, payment.currency)}</div>
                <span className={`badge status-${payment.status.toLowerCase()}`}>{t(`status.${payment.status}`)}</span>
              </div>
            </div>
            {payment.receiptId && (
              <button className="btn ghost small" type="button" onClick={() => navigate(`/receipt/${payment.receiptId}`)}>
                {t('receipt.view')}
              </button>
            )}
          </div>
        ))}

        {tab === 'payments' && payments.length === 0 && (
          <div className="card muted small center">No payments yet.</div>
        )}

        {tab === 'requests' && requests.map((request) => (
          <div className="card" key={request.id}>
            <div className="row between">
              <div>
                <div className="strong">{request.payer_label} {t('request.from')} {formatMoney(request.amount_minor, request.currency)}</div>
                <div className="tiny muted">{request.reference} · {request.status}</div>
              </div>
              {request.status === 'PENDING' && (
                <div className="btn-row" style={{ width: 'auto' }}>
                  <button className="btn teal" style={{ width: 'auto' }} type="button" onClick={() => navigate('/balances')}>
                    {t('request.pay')}
                  </button>
                  <button className="btn secondary" style={{ width: 'auto' }} type="button"
                    onClick={() => decline(request.id)} disabled={busy === request.id}>
                    {t('request.decline')}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {tab === 'requests' && requests.length === 0 && (
          <div className="card muted small center">No payment requests.</div>
        )}
      </div>
    </div>
  );
}

export function ReceiptView({ lang }: { lang: Lang }) {
  const { id = '' } = useParams();
  const t = useT(lang);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.get<Receipt>(`/api/receipts/${id}`)
      .then(setReceipt)
      .catch((err: { message?: string }) => setError(err.message ?? t('error.generic')));
  }, [id, t]);

  if (error) {
    return (
      <div className="screen"><header className="topbar"><h1>{t('receipt.title')}</h1></header>
        <div className="screen-scroll"><p className="error" role="alert">{error}</p></div>
      </div>
    );
  }

  if (!receipt) {
    return <div className="screen"><div className="screen-scroll"><div className="skeleton" style={{ height: 200 }} /></div></div>;
  }

  return (
    <div className="screen">
      <header className="topbar"><h1>{t('receipt.title')}</h1></header>
      <div className="screen-scroll">
        <div className="card">
          <img src="/paychat-logo.png" alt="PayChat" style={{ width: '100%', maxWidth: 260, display: 'block', margin: '0 auto 12px' }} />
          <div className="center">
            <div className="muted small">{t(`status.${receipt.status}`)}</div>
            <div className="balance-total">{formatMoney(receipt.amount_minor, receipt.currency)}</div>
            <div className="small muted">{receipt.recipient_label}</div>
          </div>
          <hr style={{ border: 0, borderTop: '1px dashed var(--line)', margin: '14px 0' }} />
          <Row label={t('receipt.ref')} value={receipt.reference} />
          <Row label={t('confirm.method')} value={`${receipt.provider_label} · ${receipt.method_label}`} />
          <Row label="From" value={receipt.sender_label} />
          <Row label="Date" value={new Date(receipt.issued_at).toLocaleString()} />
        </div>
        <button className="btn secondary" type="button" onClick={() => window.print()}>Share / Print</button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="row between" style={{ padding: '6px 0' }}>
      <span className="muted small">{label}</span>
      <span className="small strong">{value}</span>
    </div>
  );
}
