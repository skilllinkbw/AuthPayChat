/**
 * API client.
 * Rule: the client never decides a payment succeeded. It renders whatever status the
 * backend returns and polls until that status is terminal.
 *
 * Supports a demo mode that runs entirely client-side (no server needed).
 * Demo mode is auto-enabled when running as a Capacitor APK.
 */

import { demoApi } from './demo-mode.js';
import { DEMO_PROVIDERS } from './demo-fixtures/providers.js';

const ACCESS_KEY = 'paychat.access';
const REFRESH_KEY = 'paychat.refresh';

// Auto-enable demo mode if running as APK
if (demoApi.runningAsApk()) {
  demoApi.enable();
}

// Helpers for demo mode
function uid(prefix: string): string { return `${prefix}-${Math.random().toString(36).slice(2, 10)}`; }
function now(): string { return new Date().toISOString(); }
function jwtLike(): string { return `demo.${btoa(String(Date.now())).slice(0, 20)}.${Math.random().toString(36).slice(2, 10)}`; }

export interface ApiError {
  status: number;
  code: string;
  message: string;
  requiresStepUp?: boolean;
  fields?: Array<{ field: string; message: string }>;
}

export const tokenStore = {
  get access() { return localStorage.getItem(ACCESS_KEY); },
  get refresh() { return localStorage.getItem(REFRESH_KEY); },
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  setAccess(access: string) { localStorage.setItem(ACCESS_KEY, access); },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

/** Routes API calls to the demo implementation when demo mode is active. */
async function demoRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  // Simulate network latency for realism
  await new Promise((r) => setTimeout(r, 150 + Math.random() * 200));

  const b = body as Record<string, unknown> | undefined;

  // Auth endpoints
  if (path === '/api/auth/login' && method === 'POST') {
    return demoApi.login(b?.phone as string, b?.password as string) as T;
  }
  if (path === '/api/auth/register' && method === 'POST') {
    return demoApi.register(b?.phone as string, b?.password as string, b?.displayName as string) as T;
  }
  if (path === '/api/auth/me' && method === 'GET') {
    return demoApi.me() as T;
  }
  if (path === '/api/auth/logout') {
    return undefined as T;
  }
  if (path === '/api/auth/refresh' && method === 'POST') {
    return { accessToken: 'demo-refreshed', refreshToken: 'demo-refreshed', userId: 'demo-user-001' } as T;
  }

  // Contacts
  if (path === '/api/contacts' && method === 'GET') {
    return { contacts: demoApi.contacts() } as T;
  }

  // Accounts
  if (path === '/api/accounts' && method === 'GET') {
    return { accounts: demoApi.accounts() } as T;
  }
  if (path === '/api/accounts/quote' && method === 'POST') {
    return { methods: demoApi.quote(b?.amountMinor as number) } as T;
  }

  // Payments
  if (path === '/api/payments/intents' && method === 'POST') {
    return demoApi.createIntent({
      recipientContactId: b?.recipientContactId as string | undefined,
      recipientHandle: b?.recipientHandle as string | undefined,
      recipientLabel: b?.recipientLabel as string,
      amountMinor: b?.amountMinor as number,
      currency: b?.currency as string,
      narration: b?.narration as string | undefined,
      conversationId: b?.conversationId as string | undefined,
    }) as T;
  }
  if (path.match(/\/api\/payments\/intents\/.+\/confirm$/) && method === 'POST') {
    const parts = path.split('/');
    const intentId = parts[4];
    if (!intentId) throw new Error('Invalid intent path');
    const intent = await demoRequest<IntentView>('GET', `/api/payments/intents/${intentId}`);
    return demoApi.confirmIntent(intentId, (b?.accountId as string) ?? '', intent.amountMinor, intent.recipientLabel, '') as T;
  }
  if (path.match(/\/api\/payments\/intents\/.+$/) && method === 'GET') {
    const parts = path.split('/');
    const intentId = parts[4];
    if (!intentId) throw new Error('Invalid intent path');
    return demoApi.getIntent(intentId) as T;
  }
  if (path === '/api/payments' && method === 'GET') {
    return { payments: demoApi.listTransactions() } as T;
  }

  // Receipts
  if (path.match(/\/api\/receipts\/.+$/) && method === 'GET') {
    const parts = path.split('/');
    const id = parts[3];
    if (!id) throw new Error('Invalid receipt path');
    const receipt = demoApi.getReceipt(id);
    if (!receipt) { const e: Error & { status?: number } = new Error('Receipt not found.'); e.status = 404; throw e; }
    return receipt as T;
  }

  // Conversations
  if (path === '/api/conversations' && method === 'GET') {
    return { conversations: demoApi.conversations() } as T;
  }
  if (path.match(/\/api\/conversations\/.+\/messages$/) && method === 'GET') {
    const parts = path.split('/');
    const id = parts[3];
    if (!id) throw new Error('Invalid conversation path');
    return { messages: demoApi.messages(id) } as T;
  }
  if (path.match(/\/api\/conversations\/.+\/messages$/) && method === 'POST') {
    const parts = path.split('/');
    const id = parts[3];
    if (!id) throw new Error('Invalid conversation path');
    return demoApi.sendMessage(id, (b?.body as string) ?? '', (b?.clientMsgId as string) ?? '') as T;
  }

  // Notifications
  if (path === '/api/notifications' && method === 'GET') {
    return demoApi.notifications() as T;
  }
  if (path.match(/\/api\/notifications\/.+\/read$/) && method === 'POST') {
    const parts = path.split('/');
    const id = parts[3];
    if (!id) throw new Error('Invalid notification path');
    demoApi.markRead(id);
    return undefined as T;
  }
  if (path === '/api/notifications/read-all' && method === 'POST') {
    demoApi.markAllRead();
    return undefined as T;
  }

  // Sessions
  if (path === '/api/auth/sessions' && method === 'GET') {
    return { sessions: [{ id: 'sess-demo', device_label: 'This device', created_at: now(), revoked_at: null }] } as T;
  }
  if (path === '/api/auth/sessions/revoke' && method === 'POST') {
    return undefined as T;
  }

  // WebAuthn
  if (path === '/api/webauthn/credentials' && method === 'GET') {
    return { credentials: [] } as T;
  }
  if (path === '/api/webauthn/register/options' && method === 'POST') {
    return { demo: true, message: 'Biometric enrolment requires a live server.' } as T;
  }
  if (path === '/api/webauthn/register/verify' && method === 'POST') {
    return { ok: true } as T;
  }
  if (path === '/api/webauthn/authenticate/options' && method === 'POST') {
    return { demo: true, message: 'Biometric authentication requires a live server.' } as T;
  }
  if (path === '/api/webauthn/authenticate/verify' && method === 'POST') {
    return { ok: true, token: jwtLike() } as T;
  }

  // Step-up auth
  if (path === '/api/auth/step-up' && method === 'POST') {
    return { token: jwtLike(), expiresAt: Date.now() + 300000 } as T;
  }
  if (path === '/api/auth/step-up/verify' && method === 'POST') {
    return { proof: jwtLike() } as T;
  }

  // Providers
  if (path === '/api/providers' && method === 'GET') {
    return { providers: DEMO_PROVIDERS } as T;
  }

  // Account management
  if (path === '/api/accounts/connect' && method === 'POST') {
    return { id: uid('acct'), providerId: b?.providerId, label: b?.label, currency: 'BWP', status: 'connected', balance: null } as T;
  }
  if (path.match(/\/api\/accounts\/.+\/balance\/refresh$/) && method === 'POST') {
    return { availableMinor: 18540, pendingMinor: 0, unavailableMinor: 0, currency: 'BWP', asOf: now(), providerStatus: 'ok' } as T;
  }
  if (path.match(/\/api\/accounts\/.+$/) && method === 'DELETE') {
    return undefined as T;
  }

  // Requests
  if (path === '/api/requests' && method === 'GET') {
    return { requests: [] } as T;
  }
  if (path.match(/\/api\/requests\/.+\/decline$/) && method === 'POST') {
    return undefined as T;
  }

  // Fallback
  throw { status: 404, code: 'NOT_FOUND', message: `Demo mode: endpoint ${method} ${path} not implemented.` } as ApiError;
}

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  // Route to demo mode if active
  if (demoApi.isDemoMode()) {
    return demoRequest<T>(method, path, body);
  }

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const access = tokenStore.access;
  if (access) headers.authorization = `Bearer ${access}`;

  let response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });

  if (response.status === 401 && retry && tokenStore.refresh) {
    const refreshed = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokenStore.refresh }),
    });
    if (refreshed.ok) {
      const tokens = await refreshed.json() as { accessToken: string; refreshToken: string };
      tokenStore.set(tokens.accessToken, tokens.refreshToken);
      headers.authorization = `Bearer ${tokens.accessToken}`;
      response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } else {
      tokenStore.clear();
    }
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: ApiError } | null;
    const error: ApiError = payload?.error
      ? { ...payload.error, status: response.status }
      : { status: response.status, code: 'UNKNOWN', message: 'Something went wrong.' };
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown, headers: Record<string, string> = {}) =>
    requestWithHeaders<T>('POST', path, body, headers),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

async function requestWithHeaders<T>(method: string, path: string, body: unknown, extra: Record<string, string>): Promise<T> {
  // Route to demo mode if active (idempotency-key header is passed through)
  if (demoApi.isDemoMode()) {
    return demoRequest<T>(method, path, body);
  }
  const headers: Record<string, string> = { 'content-type': 'application/json', ...extra };
  const access = tokenStore.access;
  if (access) headers.authorization = `Bearer ${access}`;
  const response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: ApiError } | null;
    throw payload?.error
      ? ({ ...payload.error, status: response.status } as ApiError)
      : ({ status: response.status, code: 'UNKNOWN', message: 'Something went wrong.' } as ApiError);
  }
  return response.json() as Promise<T>;
}

/* --------------------------- types --------------------------- */

export interface UserProfile {
  id: string; displayName: string; phone: string; language: 'en' | 'tn';
  currency: string; hideBalances: boolean; isMerchant: boolean;
}
export interface AuthResponse {
  userId: string; accessToken: string; refreshToken: string; expiresAt: number; sessionId: string; user: UserProfile;
}
export interface AccountBalance {
  availableMinor: number | null; pendingMinor: number | null; unavailableMinor: number | null;
  currency: string; asOf: string; providerStatus: string; stale?: boolean;
}
export interface Account {
  id: string; providerId: string; kind: string; label: string; currency: string;
  isDefault: boolean; status: string; balance: AccountBalance | null;
}
export interface QuoteMethod {
  accountId: string; label: string; kind: string; providerId: string; currency: string;
  availableMinor: number | null; insufficient: boolean | null; balanceAsOf: string | null; providerStatus: string;
}
export interface IntentView {
  id: string; reference: string; status: string; amountMinor: number; currency: string;
  recipientLabel: string; risk: { score: number; reasons: string[] }; duplicate?: boolean;
  accountId?: string | null; receiptId?: string | null;
}
export interface Contact { id: string; display_name: string; phone_e164: string; is_merchant: number; conversation_id: string | null; }
export interface Message {
  id: string; conversation_id: string; sender_id: string; kind: string; body: string | null;
  payment_intent_id: string | null; payment_request_id: string | null; created_at: string; sender_name: string | null;
}
export interface Conversation { id: string; type: string; last_message: string | null; last_message_at: string; unread: number; peer_name: string | null; peer_is_merchant: number | null; }
export interface Receipt {
  id: string; reference: string; amount_minor: number; currency: string; provider_label: string;
  method_label: string; sender_label: string; recipient_label: string; status: string; issued_at: string;
}
export interface Notification { id: string; type: string; title: string; body: string; read_at: string | null; created_at: string; }

export const TERMINAL = ['SUCCESSFUL', 'FAILED', 'CANCELLED', 'EXPIRED', 'REVERSED', 'REFUNDED'];
export const isTerminalStatus = (status: string) => TERMINAL.includes(status);
