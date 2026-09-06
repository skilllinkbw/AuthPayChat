/**
 * Normalised PayChat payment status model.
 * Provider-specific states are mapped into this model by each provider adapter.
 * The frontend must never decide that a payment succeeded — only these states,
 * persisted by the backend after provider verification, are authoritative.
 */

export const PAYMENT_STATUSES = [
  'CREATED',
  'PENDING',
  'PROCESSING',
  'SUCCESSFUL',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
  'REVERSED',
  'REFUNDED',
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * Allowed state transitions. Anything not listed here is rejected by the state machine,
 * which is what blocks "status = successful" style manipulation.
 */
const TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  CREATED: ['PENDING', 'PROCESSING', 'FAILED', 'CANCELLED', 'EXPIRED'],
  PENDING: ['PROCESSING', 'SUCCESSFUL', 'FAILED', 'CANCELLED', 'EXPIRED'],
  PROCESSING: ['SUCCESSFUL', 'FAILED', 'CANCELLED', 'EXPIRED', 'REVERSED'],
  SUCCESSFUL: ['REVERSED', 'REFUNDED'],
  FAILED: [],
  CANCELLED: [],
  EXPIRED: [],
  REVERSED: [],
  REFUNDED: [],
};

export const TERMINAL_STATUSES: readonly PaymentStatus[] = ['SUCCESSFUL', 'FAILED', 'CANCELLED', 'EXPIRED', 'REVERSED', 'REFUNDED'];

export function isTerminal(status: PaymentStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!canTransition(from, to)) {
    throw new PaymentStateError(from, to);
  }
}

export class PaymentStateError extends Error {
  readonly code = 'PAYMENT_STATE_CONFLICT' as const;
  constructor(readonly from: PaymentStatus, readonly to: PaymentStatus) {
    super(`illegal payment transition ${from} -> ${to}`);
    this.name = 'PaymentStateError';
  }
}

/** UI buckets so the chat cards can visually distinguish states (never colour-only). */
export function statusTone(status: PaymentStatus): 'pending' | 'success' | 'failed' | 'neutral' {
  switch (status) {
    case 'SUCCESSFUL':
      return 'success';
    case 'FAILED':
    case 'REVERSED':
      return 'failed';
    case 'PENDING':
    case 'PROCESSING':
    case 'CREATED':
      return 'pending';
    default:
      return 'neutral';
  }
}
