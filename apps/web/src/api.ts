/**
 * API client.
 * Rule: the client never decides a payment succeeded. It renders whatever status the
 * backend returns and polls until that status is terminal.
 */

const ACCESS_KEY = 'paychat.access';
const REFRESH_KEY = 'paychat.refresh';

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

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
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
