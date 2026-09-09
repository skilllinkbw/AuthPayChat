/**
 * Demo Mode - client-side simulation of the PayChat API.
 *
 * ALL data here is SANDBOX / DEMONSTRATION data. No real money is moved.
 * The app clearly identifies sandbox data throughout the UI.
 *
 * This makes the APK fully standalone for bank demonstration without
 * requiring a running backend server.
 */

import type {
  UserProfile, AuthResponse, Account, QuoteMethod,
  IntentView, Contact, Message, Conversation, Receipt, Notification,
} from './api.js';
import { DEFAULT_BALANCES, DEMO_ACCOUNTS } from './demo-fixtures/providers.js';

const DEMO_PHONE = '+26771000000';
const DEMO_PASSWORD = 'PayChat2025!';
const DEMO_USER_ID = 'demo-user-001';

function uid(prefix: string): string { return `${prefix}-${Math.random().toString(36).slice(2, 10)}`; }
function now(): string { return new Date().toISOString(); }
function minutesAgo(m: number): string { return new Date(Date.now() - m * 60000).toISOString(); }
function jwtLike(): string { return `demo.${btoa(String(Date.now())).slice(0, 20)}.${Math.random().toString(36).slice(2, 10)}`; }

interface DemoState {
  balances: Record<string, number>;
  transactions: DemoTransaction[];
  notifications: DemoNotification[];
}

interface DemoTransaction {
  id: string; reference: string; status: string; amountMinor: number;
  currency: string; recipientLabel: string; recipientHandle: string;
  accountId: string; providerLabel: string; methodLabel: string;
  senderLabel: string; narration: string | null; createdAt: string;
  receiptId: string; conversationId: string | null;
}

interface DemoNotification {
  id: string; type: string; title: string; body: string;
  read: boolean; createdAt: string; receiptId: string | null;
}

function loadState<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(`paychat.demo.${key}`); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}
function saveState<T>(key: string, value: T): void { localStorage.setItem(`paychat.demo.${key}`, JSON.stringify(value)); }

const DEMO_CONTACTS: Contact[] = [
  { id: 'contact-1', display_name: 'Motakase', phone_e164: '+26772000001', is_merchant: 0, conversation_id: 'conv-1' },
  { id: 'contact-2', display_name: 'Neo', phone_e164: '+26773000002', is_merchant: 0, conversation_id: null },
  { id: 'contact-3', display_name: 'Thato', phone_e164: '+26774000003', is_merchant: 0, conversation_id: null },
  { id: 'contact-4', display_name: 'John', phone_e164: '+26775000004', is_merchant: 0, conversation_id: null },
  { id: 'contact-5', display_name: 'Mma Dineo Bakery', phone_e164: '+26776000005', is_merchant: 1, conversation_id: null },
];

const DEMO_PROFILE: UserProfile = {
  id: DEMO_USER_ID, displayName: 'You', phone: DEMO_PHONE,
  language: 'en', currency: 'BWP', hideBalances: false, isMerchant: false,
};

function accountsWithBalances(state: DemoState): Account[] {
  return DEMO_ACCOUNTS.map((a) => ({
    ...a,
    balance: {
      availableMinor: state.balances[a.id] ?? DEFAULT_BALANCES[a.id] ?? 0,
      pendingMinor: 0, unavailableMinor: 0, currency: 'BWP',
      asOf: now(), providerStatus: 'ok',
    },
  }));
}

export const demoApi = {
  isDemoMode(): boolean {
    return localStorage.getItem('paychat.demo.enabled') === 'true' || this.runningAsApk();
  },

  runningAsApk(): boolean {
    const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean }; cordova?: unknown };
    return !!(w.Capacitor?.isNativePlatform?.() || w.cordova);
  },

  enable(): void {
    localStorage.setItem('paychat.demo.enabled', 'true');
    if (!localStorage.getItem('paychat.demo.balances')) {
      saveState('balances', { ...DEFAULT_BALANCES });
      saveState('transactions', []);
      saveState('notifications', []);
    }
  },

  disable(): void { localStorage.removeItem('paychat.demo.enabled'); },

  reset(): void {
    localStorage.removeItem('paychat.demo.balances');
    localStorage.removeItem('paychat.demo.transactions');
    localStorage.removeItem('paychat.demo.notifications');
    this.enable();
  },

  _state(): DemoState {
    return {
      balances: loadState('balances', { ...DEFAULT_BALANCES }),
      transactions: loadState<DemoTransaction[]>('transactions', []),
      notifications: loadState<DemoNotification[]>('notifications', []),
    };
  },
  login(phone: string, password: string): AuthResponse {
    if (phone !== DEMO_PHONE || password !== DEMO_PASSWORD) {
      const err: Error & { status?: number } = new Error('Invalid phone number or password.');
      err.status = 401;
      throw err;
    }
    return {
      userId: DEMO_USER_ID, accessToken: jwtLike(), refreshToken: jwtLike(),
      expiresAt: Date.now() + 900000, sessionId: uid('sess'), user: DEMO_PROFILE,
    };
  },

  register(phone: string, password: string, displayName: string): AuthResponse {
    if (phone !== DEMO_PHONE) {
      const err: Error & { status?: number } = new Error('Demo mode: only the demo phone number (+26771000000) can be used.');
      err.status = 409;
      throw err;
    }
    if (password.length < 10) {
      const err: Error & { status?: number; fields?: Array<{ field: string; message: string }> } = new Error('Password too short.');
      err.status = 400;
      err.fields = [{ field: 'password', message: 'Password must be at least 10 characters.' }];
      throw err;
    }
    return {
      userId: DEMO_USER_ID, accessToken: jwtLike(), refreshToken: jwtLike(),
      expiresAt: Date.now() + 900000, sessionId: uid('sess'),
      user: { ...DEMO_PROFILE, displayName: displayName || 'You', phone },
    };
  },

  me(): UserProfile {
    return { ...DEMO_PROFILE, language: (localStorage.getItem('paychat.lang') as 'en' | 'tn') || 'en' };
  },

  contacts(): Contact[] { return DEMO_CONTACTS; },

  accounts(): Account[] { return accountsWithBalances(this._state()); },

  quote(amountMinor: number): QuoteMethod[] {
    const state = this._state();
    return DEMO_ACCOUNTS.map((a) => {
      const bal = state.balances[a.id] ?? DEFAULT_BALANCES[a.id] ?? 0;
      return {
        accountId: a.id, label: a.label, kind: a.kind,
        providerId: a.providerId, currency: 'BWP',
        availableMinor: bal, insufficient: bal < amountMinor,
        balanceAsOf: now(), providerStatus: 'ok',
      };
    });
  },

  createIntent(data: {
    recipientContactId?: string; recipientHandle?: string;
    recipientLabel: string; amountMinor: number; currency: string;
    narration?: string; conversationId?: string;
  }): IntentView {
    if (data.amountMinor <= 0) {
      const err: Error & { status?: number; fields?: Array<{ field: string; message: string }> } = new Error('Invalid amount.');
      err.status = 400;
      err.fields = [{ field: 'amountMinor', message: 'Amount must be greater than zero.' }];
      throw err;
    }
    if (!data.recipientLabel) {
      const err: Error & { status?: number } = new Error('Recipient is required.');
      err.status = 400;
      throw err;
    }
    return {
      id: uid('intent'),
      reference: `PAY-${Date.now().toString(36).toUpperCase()}`,
      status: 'PENDING', amountMinor: data.amountMinor,
      currency: data.currency, recipientLabel: data.recipientLabel,
      risk: { score: data.amountMinor > 50000 ? 60 : 10, reasons: data.amountMinor > 50000 ? ['high-value'] : [] },
    };
  },
  confirmIntent(intentId: string, accountId: string, amountMinor: number, recipientLabel: string, recipientHandle: string): IntentView {
    const state = this._state();
    const account = DEMO_ACCOUNTS.find((a) => a.id === accountId);
    if (!account) { const e: Error & { status?: number } = new Error('Payment method not found.'); e.status = 400; throw e; }
    const currentBal = state.balances[accountId] ?? DEFAULT_BALANCES[accountId] ?? 0;
    if (currentBal < amountMinor) { const e: Error & { status?: number } = new Error('Insufficient balance on selected method.'); e.status = 422; throw e; }
    state.balances[accountId] = currentBal - amountMinor;
    saveState('balances', state.balances);

    const txId = uid('tx');
    const receiptId = uid('rcpt');
    const reference = `PAY-${Date.now().toString(36).toUpperCase()}`;

    const tx: DemoTransaction = {
      id: txId, reference, status: 'SUCCESSFUL', amountMinor,
      currency: 'BWP', recipientLabel, recipientHandle: recipientHandle || '',
      accountId, providerLabel: 'Sandbox Rail (DEMO)',
      methodLabel: account.label, senderLabel: 'You',
      narration: null, createdAt: now(), receiptId, conversationId: null,
    };
    state.transactions.unshift(tx);
    saveState('transactions', state.transactions);

    const notif: DemoNotification = {
      id: uid('notif'), type: 'payment.successful',
      title: 'Payment sent',
      body: `You sent P${(amountMinor / 100).toFixed(2)} to ${recipientLabel}`,
      read: false, createdAt: now(), receiptId,
    };
    state.notifications.unshift(notif);
    saveState('notifications', state.notifications);

    return {
      id: intentId, reference, status: 'SUCCESSFUL',
      amountMinor, currency: 'BWP', recipientLabel,
      risk: { score: 10, reasons: [] }, accountId, receiptId,
    };
  },

  getIntent(intentId: string): IntentView {
    return {
      id: intentId, reference: `PAY-${Date.now().toString(36).toUpperCase()}`,
      status: 'SUCCESSFUL', amountMinor: 0, currency: 'BWP',
      recipientLabel: '', risk: { score: 0, reasons: [] },
    };
  },

  listTransactions(): DemoTransaction[] { return this._state().transactions; },

  getReceipt(receiptId: string): Receipt | null {
    const state = this._state();
    const tx = state.transactions.find((t) => t.receiptId === receiptId);
    if (!tx) return null;
    return {
      id: tx.receiptId!, reference: tx.reference,
      amount_minor: tx.amountMinor, currency: tx.currency,
      provider_label: tx.providerLabel, method_label: tx.methodLabel,
      sender_label: tx.senderLabel, recipient_label: tx.recipientLabel,
      status: tx.status, issued_at: tx.createdAt,
    };
  },
  conversations(): Conversation[] {
    return [{
      id: 'conv-1', type: 'direct',
      last_message: 'Dumela! Are o ntshumeletse P50?',
      last_message_at: minutesAgo(30), unread: 1,
      peer_name: 'Motakase', peer_is_merchant: 0,
    }];
  },

  messages(conversationId: string): Message[] {
    if (conversationId === 'conv-1') {
      return [
        { id: 'msg-1', conversation_id: 'conv-1', sender_id: 'contact-1', kind: 'text', body: 'Dumela! Are o ntshumeletse P50?', payment_intent_id: null, payment_request_id: null, created_at: minutesAgo(60), sender_name: 'Motakase' },
        { id: 'msg-2', conversation_id: 'conv-1', sender_id: DEMO_USER_ID, kind: 'text', body: 'Ke tla go duela jaanong.', payment_intent_id: null, payment_request_id: null, created_at: minutesAgo(55), sender_name: 'You' },
        { id: 'msg-3', conversation_id: 'conv-1', sender_id: 'contact-1', kind: 'text', body: 'Dumela! Are o ntshumeletse P50?', payment_intent_id: null, payment_request_id: null, created_at: minutesAgo(30), sender_name: 'Motakase' },
      ];
    }
    return [];
  },

  sendMessage(conversationId: string, body: string, clientMsgId: string): Message {
    const paymentMatch = body.match(/pay\s+P?(\d+(?:\.\d{1,2})?)\s+(.+)/i);
    if (paymentMatch && paymentMatch[1] && paymentMatch[2]) {
      const amountMinor = Math.round(parseFloat(paymentMatch[1]) * 100);
      const recipient = paymentMatch[2].trim();
      const contact = DEMO_CONTACTS.find((c) => c.display_name.toLowerCase() === recipient.toLowerCase());
      const intent = this.createIntent({
        recipientLabel: contact?.display_name || recipient,
        recipientHandle: contact?.phone_e164 ?? '', amountMinor, currency: 'BWP', conversationId,
      });
      const defaultAccount = DEMO_ACCOUNTS.find((a) => a.isDefault)!;
      this.confirmIntent(intent.id, defaultAccount.id, amountMinor, intent.recipientLabel, contact?.phone_e164 || '');
    }
    return {
      id: clientMsgId || uid('msg'), conversation_id: conversationId,
      sender_id: DEMO_USER_ID, kind: 'text', body,
      payment_intent_id: null, payment_request_id: null,
      created_at: now(), sender_name: 'You',
    };
  },

  notifications(): { notifications: Notification[]; unreadCount: number } {
    const state = this._state();
    const notifications: Notification[] = state.notifications.map((n) => ({
      id: n.id, type: n.type, title: n.title, body: n.body,
      read_at: n.read ? now() : null, created_at: n.createdAt,
    }));
    const unreadCount = state.notifications.filter((n) => !n.read).length;
    return { notifications, unreadCount };
  },

  markRead(id: string): void {
    const state = this._state();
    const n = state.notifications.find((x) => x.id === id);
    if (n) { n.read = true; saveState('notifications', state.notifications); }
  },

  markAllRead(): void {
    const state = this._state();
    state.notifications.forEach((n) => { n.read = true; });
    saveState('notifications', state.notifications);
  },
};
