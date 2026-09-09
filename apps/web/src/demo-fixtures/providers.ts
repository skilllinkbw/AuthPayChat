/**
 * DEMO-ONLY FIXTURES — client-side simulation data for the PayChat bank demo APK.
 *
 * Everything in this file is SANDBOX / DEMONSTRATION data that runs entirely on
 * the device. It exists so the standalone review APK can be demonstrated without
 * a live backend. Provider names appear here ONLY as display labels for the demo
 * accounts; they are never wired to a real rail and never allowed to affect the
 * core orchestrator (see apps/api/src/providers for the runtime registry).
 *
 * The provider-architecture acceptance test explicitly permits this single
 * fixtures path (parallel to apps/api/src/providers/definitions.ts). Any new
 * provider name elsewhere in apps/web/src or apps/api/src is a test failure.
 */

import type { Account } from '../api.js';

/** Demo account ids are stable so balances saved in localStorage keep working. */
export const DEFAULT_BALANCES: Record<string, number> = {
  'demo-acct-orange': 18540,
  'demo-acct-myzaka': 42000,
  'demo-acct-smega': 9500,
  'demo-acct-bank': 125000,
};

export const DEMO_ACCOUNTS: Account[] = [
  { id: 'demo-acct-orange', providerId: 'sandbox', kind: 'mobile_money', label: 'Orange Money', currency: 'BWP', isDefault: true, status: 'connected', balance: null },
  { id: 'demo-acct-myzaka', providerId: 'sandbox', kind: 'mobile_money', label: 'MyZaka', currency: 'BWP', isDefault: false, status: 'connected', balance: null },
  { id: 'demo-acct-smega', providerId: 'sandbox', kind: 'mobile_money', label: 'Smega', currency: 'BWP', isDefault: false, status: 'connected', balance: null },
  { id: 'demo-acct-bank', providerId: 'sandbox', kind: 'bank', label: 'Bank Account', currency: 'BWP', isDefault: false, status: 'connected', balance: null },
];

/**
 * The demo `/api/providers` response. Mirrors the real API contract: the sandbox
 * rail is enabled for the demo; the other rails are shown but disabled because no
 * external credentials exist. This is configuration-shaped demo data, not core code.
 */
export const DEMO_PROVIDERS = [
  { id: 'sandbox', displayName: 'Sandbox Rail (DEMO)', kind: 'sandbox', enabled: true },
  { id: 'orange_money', displayName: 'Orange Money', kind: 'mobile_money', enabled: false },
  { id: 'myzaka', displayName: 'MyZaka', kind: 'mobile_money', enabled: false },
  { id: 'smega', displayName: 'Smega', kind: 'mobile_money', enabled: false },
  { id: 'bank_api', displayName: 'Bank API', kind: 'bank', enabled: false },
  { id: 'card_api', displayName: 'Card API', kind: 'card', enabled: false },
];