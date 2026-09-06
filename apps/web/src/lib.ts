import { useEffect, useState } from 'react';
import { api, tokenStore } from './api.js';

export function formatMoney(minor: number | null | undefined, currency: string, opts: { hide?: boolean } = {}): string {
  if (minor === null || minor === undefined) return '—';
  if (opts.hide) return '•••••';
  const symbol = currency === 'BWP' ? 'P' : currency === 'ZAR' ? 'R' : currency === 'USD' ? '$' : `${currency} `;
  const abs = Math.abs(minor).toString().padStart(3, '0');
  const int = abs.slice(0, abs.length - 2);
  const frac = abs.slice(abs.length - 2);
  return `${symbol}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`;
}

export function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

export function timeAgo(iso: string, lang: 'en' | 'tn'): string {
  const diff = Date.now() - Date.parse(iso);
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return lang === 'tn' ? 'jaanong' : 'now';
  if (minutes < 60) return lang === 'tn' ? `${minutes}m` : `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Connection state — the UI stays usable offline and retries safely. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

/* --------------------------- biometrics --------------------------- */
/**
 * Biometric confirmation uses the platform authenticator (fingerprint / face) via WebAuthn.
 * PayChat never sees or stores a fingerprint or face template — the operating system
 * verifies the user and returns a signed assertion that the server verifies.
 */

export function biometricSupported(): boolean {
  return typeof window !== 'undefined' && 'PublicKeyCredential' in window && window.isSecureContext;
}

export async function enrolBiometric(deviceLabel = 'This device'): Promise<{ ok: boolean; message?: string }> {
  if (!biometricSupported()) return { ok: false, message: 'This device or browser does not support biometrics.' };
  try {
    const { startRegistration } = await import('@simplewebauthn/browser');
    const options = await api.post<Record<string, unknown>>('/api/webauthn/register/options');
    const attestation = await startRegistration(options as never);
    await api.post('/api/webauthn/register/verify', { ...attestation, deviceLabel });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not set up biometrics.' };
  }
}

/** Returns true only when the platform authenticator produced a signature the server accepted. */
export async function confirmWithBiometric(): Promise<{ ok: boolean; message?: string }> {
  if (!biometricSupported()) return { ok: false, message: 'Biometrics are not available on this device.' };
  try {
    const { startAuthentication } = await import('@simplewebauthn/browser');
    const options = await api.post<Record<string, unknown>>('/api/webauthn/authenticate/options');
    const assertion = await startAuthentication(options as never);
    const result = await api.post<{ verified: boolean; accessToken: string }>('/api/webauthn/authenticate/verify', assertion);
    if (result.verified && result.accessToken) {
      tokenStore.setAccess(result.accessToken);   // carries the verified step-up claim
      return { ok: true };
    }
    return { ok: false, message: 'We could not verify your identity.' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Biometric confirmation failed.' };
  }
}

export async function confirmWithPassword(password: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const result = await api.post<{ accessToken: string }>('/api/auth/step-up', { password });
    if (result.accessToken) {
      tokenStore.setAccess(result.accessToken);
      return { ok: true };
    }
    return { ok: false, message: 'We could not verify your password.' };
  } catch (error) {
    const apiError = error as { message?: string };
    return { ok: false, message: apiError.message ?? 'We could not verify your password.' };
  }
}

/* --------------------------- voice --------------------------- */
/**
 * Voice input → text → the SAME intent parser. Speech never executes a payment:
 * the transcript still has to be confirmed by the user.
 */
export interface VoiceSupport {
  supported: boolean;
  listening: boolean;
  transcript: string;
  error: string | null;
  start: (lang: 'en' | 'tn') => void;
  stop: () => void;
}

type SpeechRecognitionCtor = new () => {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const voiceSupported = () => getSpeechRecognition() !== null;

export function startListening(lang: 'en' | 'tn', onText: (text: string) => void, onError?: (message: string) => void): () => void {
  const Ctor = getSpeechRecognition();
  if (!Ctor) {
    onError?.('Voice input is not supported in this browser. Please type your instruction.');
    return () => undefined;
  }
  const recognition = new Ctor();
  // Setswana speech support varies by engine; we request it and fall back to English.
  recognition.lang = lang === 'tn' ? 'tn-BW' : 'en-BW';
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;

  recognition.onresult = (event) => {
    const text = Array.from(event.results).map((r) => r[0]?.transcript ?? '').join(' ').trim();
    if (text) onText(text);
  };
  recognition.onerror = (event) => {
    if (event.error === 'language-not-supported') {
      recognition.lang = 'en-GB';
      onError?.('Setswana voice is not available here — listening in English.');
      try { recognition.start(); } catch { /* already started */ }
      return;
    }
    if (event.error !== 'no-speech') onError?.(`Voice input unavailable (${event.error}). Please type instead.`);
  };
  try { recognition.start(); } catch { /* ignore double start */ }
  return () => { try { recognition.stop(); } catch { /* ignore */ } };
}

/** Outgoing message retry queue — messages drafted offline are sent when connectivity returns. */
const QUEUE_KEY = 'paychat.outbox';

export interface QueuedMessage { conversationId: string; body: string; clientMsgId: string; }

export const outboxQueue = {
  all(): QueuedMessage[] {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as QueuedMessage[]; } catch { return []; }
  },
  add(message: QueuedMessage): void {
    const all = outboxQueue.all();
    all.push(message);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(all));
  },
  remove(clientMsgId: string): void {
    const all = outboxQueue.all().filter((m) => m.clientMsgId !== clientMsgId);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(all));
  },
};

export const draftStore = {
  get(conversationId: string): string {
    return localStorage.getItem(`paychat.draft.${conversationId}`) ?? '';
  },
  set(conversationId: string, value: string): void {
    localStorage.setItem(`paychat.draft.${conversationId}`, value);
  },
  clear(conversationId: string): void {
    localStorage.removeItem(`paychat.draft.${conversationId}`);
  },
};
