/**
 * Inbox / notifications suite.
 *
 * Notifications are generated ONLY by the backend from verified transaction state —
 * these tests prove that: no notification appears before a provider callback,
 * duplicates (webhook replays, double confirm) never produce duplicate notifications,
 * and every notification is private to its owner.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  newApp, registerUser, addContact, addAccount, createIntent, confirmPayment, sendWebhook,
  stepUp,
} from './helpers.js';
import type { SandboxProvider } from '../apps/api/src/providers/sandbox.js';

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  read_at: string | null;
  receiptId: string | null;
}

async function listNotifications(app: FastifyInstance, auth: Record<string, string>) {
  const response = await app.inject({ method: 'GET', url: '/api/notifications', headers: auth });
  return {
    status: response.statusCode,
    ...response.json<{ notifications: NotificationRow[]; unreadCount: number }>(),
  };
}

describe('Notifications — generated from verified payment state', () => {
  let app: FastifyInstance;
  let sandbox: SandboxProvider;

  beforeEach(async () => {
    ({ app, sandbox } = await newApp('success'));
  });

  async function setup() {
    const payer = await stepUp(app, await registerUser(app, { phone: '+26771000100', name: 'Payer' }));
    const recipient = await registerUser(app, { phone: '+26772000200', name: 'Motakase' });
    const contactId = addContact(payer.userId, 'Motakase', '+26772000200', recipient.userId);
    const accountId = addAccount(payer.userId, { label: 'Orange Money', providerAccountRef: 'w-inbox', isDefault: true });
    sandbox.setBalance('w-inbox', 50000);
    return { payer, recipient, contactId, accountId };
  }

  it('notifies the payer AND the recipient only after a verified provider callback', async () => {
    const { payer, recipient, contactId, accountId } = await setup();

    // Intent created: NO notification yet — nothing has happened.
    const created = await createIntent(app, payer, { recipientContactId: contactId, amountMinor: 5000 });
    const intentId = String(created.body.id);
    expect((await listNotifications(app, payer.auth)).notifications).toHaveLength(0);

    // Confirmed but not settled: still no success notification (payment is only PROCESSING).
    const confirmed = await confirmPayment(app, payer, intentId, accountId);
    expect(confirmed.body.status).toBe('PROCESSING');
    expect((await listNotifications(app, payer.auth)).notifications.filter((n) => n.type === 'payment.successful')).toHaveLength(0);

    // Provider confirms via signed webhook: now both sides hear about it.
    await sendWebhook(app, sandbox, String(confirmed.body.providerRef), 'SUCCESSFUL', 5000);

    const payerInbox = await listNotifications(app, payer.auth);
    const sent = payerInbox.notifications.find((n) => n.type === 'payment.successful');
    expect(sent).toBeDefined();
    expect(sent!.receiptId).toBeTruthy(); // deep-links to the verified receipt

    const recipientInbox = await listNotifications(app, recipient.auth);
    const received = recipientInbox.notifications.find((n) => n.type === 'payment.received');
    expect(received).toBeDefined();
    expect(received!.title).toBe('Money received');
    // The recipient's notification names the SENDER (spec: "P250.00 received from <sender>").
    expect(received!.body).toContain('Payer');
  });

  it('never duplicates notifications on webhook replay or double confirm', async () => {
    const { payer, contactId, accountId } = await setup();
    const created = await createIntent(app, payer, { recipientContactId: contactId, amountMinor: 5000 });
    const intentId = String(created.body.id);
    const confirmed = await confirmPayment(app, payer, intentId, accountId);
    const providerRef = String(confirmed.body.providerRef);

    await sendWebhook(app, sandbox, providerRef, 'SUCCESSFUL', 5000);
    await sendWebhook(app, sandbox, providerRef, 'SUCCESSFUL', 5000); // replay
    await confirmPayment(app, payer, intentId, accountId);           // double confirm

    const inbox = await listNotifications(app, payer.auth);
    expect(inbox.notifications.filter((n) => n.type === 'payment.successful')).toHaveLength(1);
  });

  it('tells the payer when a payment did not complete', async () => {
    const { payer, contactId, accountId } = await setup();
    const created = await createIntent(app, payer, { recipientContactId: contactId, amountMinor: 5000 });
    const intentId = String(created.body.id);
    const confirmed = await confirmPayment(app, payer, intentId, accountId);

    await sendWebhook(app, sandbox, String(confirmed.body.providerRef), 'FAILED', 5000);
    const inbox = await listNotifications(app, payer.auth);
    const failed = inbox.notifications.find((n) => n.type === 'payment.failed');
    expect(failed).toBeDefined();
    // Never claims money was lost when the provider said it was not taken.
    expect(failed!.body.toLowerCase()).toContain('no money has left');
  });

  it('tracks unread state, single-read and mark-all-read', async () => {
    const { payer, recipient, contactId, accountId } = await setup();
    const created = await createIntent(app, payer, { recipientContactId: contactId, amountMinor: 5000 });
    const confirmed = await confirmPayment(app, payer, String(created.body.id), accountId);
    await sendWebhook(app, sandbox, String(confirmed.body.providerRef), 'SUCCESSFUL', 5000);

    const recipientInbox = await listNotifications(app, recipient.auth);
    expect(recipientInbox.unreadCount).toBe(1);
    const notification = recipientInbox.notifications[0]!;
    expect(notification.read_at).toBeNull();

    // Another user cannot read or mark someone else's notification.
    const stranger = await registerUser(app, { phone: '+26773000300' });
    expect((await app.inject({
      method: 'POST', url: `/api/notifications/${notification.id}/read`, headers: stranger.auth,
    })).statusCode).toBe(404);
    expect((await listNotifications(app, stranger.auth)).notifications).toHaveLength(0);

    await app.inject({ method: 'POST', url: `/api/notifications/${notification.id}/read`, headers: recipient.auth });
    expect((await listNotifications(app, recipient.auth)).unreadCount).toBe(0);

    // A second payment, then mark-all-read clears everything.
    const second = await createIntent(app, payer, { recipientContactId: contactId, amountMinor: 2000 });
    const confirmedSecond = await confirmPayment(app, payer, String(second.body.id), accountId);
    await sendWebhook(app, sandbox, String(confirmedSecond.body.providerRef), 'SUCCESSFUL', 2000);
    expect((await listNotifications(app, recipient.auth)).unreadCount).toBe(1);

    await app.inject({ method: 'POST', url: '/api/notifications/read-all', headers: recipient.auth });
    const after = await listNotifications(app, recipient.auth);
    expect(after.unreadCount).toBe(0);
    expect(after.notifications.every((n) => n.read_at !== null)).toBe(true);
  });

  it('requires authentication to read notifications at all', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/notifications' });
    expect(response.statusCode).toBe(401);
  });
});

