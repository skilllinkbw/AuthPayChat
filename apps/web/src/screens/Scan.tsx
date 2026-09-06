/**
 * Scan & pay (brief §16).
 *
 *  - Shows the signed-in user's own payment code (server-rendered PNG, no client QR library).
 *  - Reads a code from the camera when the platform exposes a BarcodeDetector, and always
 *    offers manual paste as a fallback (camera support is not universal, and this build
 *    cannot be verified against real camera hardware).
 *  - A scan NEVER pays. It resolves to a preview that the user confirms, then the same
 *    authentication and step-up rules as any other payment apply.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { formatMoney } from '../lib.js';
import { useT, type Lang } from '../i18n.js';

interface ScanPreview {
  kind: 'payment_link' | 'merchant';
  token: string;
  amountMinor: number | null;
  amountFixed: boolean;
  currency: string;
  description: string | null;
  recipient: { id: string; name: string; isMerchant: boolean };
  merchant: { id: string; name: string; businessName: string | null } | null;
  expiresAt: string;
}

interface Account { id: string; label: string; kind: string; currency: string; provider_id: string; is_default: number }

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

export function Scan({ lang }: { lang: Lang }) {
  const t = useT(lang);
  const [myCode, setMyCode] = useState<{ qr: string; token: string; expiresAt?: string } | null>(null);
  const [amount, setAmount] = useState('');
  const [preview, setPreview] = useState<ScanPreview | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState('');
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null);
  const [cameraState, setCameraState] = useState<'off' | 'starting' | 'on' | 'unsupported'>('off');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraState('off');
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  useEffect(() => {
    void api.get<{ accounts: Account[] }>('/api/accounts').then((data) => {
      setAccounts(data.accounts);
      const defaultAccount = data.accounts.find((a) => a.is_default === 1) ?? data.accounts[0];
      if (defaultAccount) setAccountId(defaultAccount.id);
    }).catch(() => setAccounts([]));
  }, []);

  const loadMyCode = useCallback(async () => {
    setStatus(null);
    try {
      const link = await api.post<{ token: string; qr: string }>('/api/payment-links', {
        amountMinor: Math.max(1, Math.round(Number(amount || 0) * 100)),
        currency: 'BWP',
        description: 'Pay me on PayChat',
      });
      setMyCode({ qr: link.qr, token: link.token });
    } catch (error) {
      setMyCode(null);
      setStatus({ kind: 'error', message: (error as { message?: string }).message ?? 'Could not create your code' });
    }
  }, [amount]);

  const resolveCode = useCallback(async (code: string) => {
    setBusy(true);
    setStatus(null);
    try {
      const data = await api.post<ScanPreview>('/api/qr/scan', { code });
      setPreview(data);
      stopCamera();
    } catch (error) {
      setPreview(null);
      setStatus({ kind: 'error', message: (error as { message?: string }).message ?? String(t('scan.expired')) });
    } finally {
      setBusy(false);
    }
  }, [stopCamera, t]);

  const startCamera = useCallback(async () => {
    const Ctor = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!Ctor || !navigator.mediaDevices?.getUserMedia) {
      setCameraState('unsupported');
      setStatus({ kind: 'error', message: String(t('scan.noDetector')) });
      return;
    }
    setCameraState('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      detectorRef.current = new Ctor({ formats: ['qr_code'] });
      setCameraState('on');
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play();
      }
      const tick = async () => {
        const currentVideo = videoRef.current;
        if (currentVideo && currentVideo.readyState >= 2) {
          try {
            const detected = await detectorRef.current!.detect(currentVideo);
            if (detected[0]?.rawValue) {
              await resolveCode(detected[0].rawValue);
              return;
            }
          } catch {
            // keep scanning
          }
        }
        rafRef.current = requestAnimationFrame(() => void tick());
      };
      rafRef.current = requestAnimationFrame(() => void tick());
    } catch {
      setCameraState('unsupported');
      setStatus({ kind: 'error', message: String(t('scan.cameraUnavailable')) });
    }
  }, [resolveCode, t]);

  const pay = useCallback(async () => {
    if (!preview) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await api.post<{ intentId: string; status: string }>('/api/qr/pay', {
        code: preview.token,
        accountId,
        ...(preview.amountFixed ? {} : { amountMinor: Math.round(Number(amount || 0) * 100) }),
        authMethod: 'password',
      });
      setStatus({ kind: 'ok', message: `${String(t('scan.done'))} (${result.status})` });
      setPreview(null);
    } catch (error) {
      const apiError = error as { code?: string; message?: string };
      setStatus({ kind: 'error', message: apiError.code?.includes('already') ? String(t('scan.reused')) : (apiError.message ?? 'Payment failed') });
    } finally {
      setBusy(false);
    }
  }, [accountId, amount, preview, t]);

  return (
    <div className="screen-scroll">
      <header className="screen-header">
        <h1>{String(t('scan.title'))}</h1>
      </header>

      <section className="card">
        <h2 className="card-title">{String(t('scan.mine'))}</h2>
        <label className="field">
          <span>Amount (P)</span>
          <input className="field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50.00" />
        </label>
        <div className="btn-row">
          <button className="btn teal" type="button" onClick={() => void loadMyCode()}>
            {String(t('scan.mine'))}
          </button>
        </div>
        {myCode && (
          <div className="qr-wrap">
            <img src={myCode.qr} alt="Your PayChat payment code" width={220} height={220} />
            <p className="muted small">{myCode.token.slice(0, 24)}…</p>
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">{String(t('scan.pay'))}</h2>
        <div className="btn-row">
          <button className="btn" type="button" onClick={() => void startCamera()} disabled={cameraState === 'on' || cameraState === 'starting'}>
            {String(t('scan.camera'))}
          </button>
          {cameraState === 'on' && (
            <button className="btn secondary" type="button" onClick={stopCamera}>{String(t('confirm.cancel'))}</button>
          )}
        </div>
        {cameraState === 'on' && (
          <video ref={videoRef} className="qr-video" muted playsInline aria-label="Camera preview" />
        )}
        {cameraState === 'starting' && <p className="muted small">{String(t('scan.scanning'))}</p>}

        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void resolveCode(paste.trim());
          }}
        >
          <label className="field">
            <span>{String(t('scan.paste'))}</span>
            <input className="field" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="paychat://pay/…" />
          </label>
          <button className="btn" type="submit" disabled={busy || paste.trim().length === 0}>{String(t('scan.preview'))}</button>
        </form>
      </section>

      {preview && (
        <section className="sheet-backdrop" role="dialog" aria-modal="true">
          <div className="sheet">
            <div className="grab" />
            <h2>{String(t('scan.preview'))}</h2>
            <p className="row-between">
              <span>{preview.merchant?.businessName ?? preview.recipient.name}</span>
              {preview.recipient.isMerchant && <span className="pill">Business</span>}
            </p>
            {preview.description && <p className="muted small">{preview.description}</p>}
            <p className="amount">
              {preview.amountFixed
                ? formatMoney(preview.amountMinor ?? 0, preview.currency)
                : String(t('scan.openAmount'))}
            </p>
            {!preview.amountFixed && (
              <label className="field">
                <span>Amount (P)</span>
                <input className="field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50.00" />
              </label>
            )}
            <label className="field">
              <span>{String(t('confirm.method'))}</span>
              <select className="field" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.label}</option>
                ))}
              </select>
            </label>
            <p className="muted small">Expires {new Date(preview.expiresAt).toLocaleString()}</p>
            <div className="btn-row">
              <button className="btn secondary" type="button" onClick={() => setPreview(null)}>{String(t('confirm.cancel'))}</button>
              <button
                className="btn teal"
                type="button"
                disabled={busy || !accountId || (!preview.amountFixed && Math.round(Number(amount || 0) * 100) <= 0)}
                onClick={() => void pay()}
              >
                {String(t('confirm.confirm'))}
              </button>
            </div>
          </div>
        </section>
      )}

      {status && <p className={status.kind === 'ok' ? 'notice ok' : 'notice error'}>{status.message}</p>}
    </div>
  );
}
