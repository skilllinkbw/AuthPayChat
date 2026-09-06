/**
 * Risk-based authentication.
 * More friction when it matters, less when it does not — but never weaker security for speed.
 */

import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { devices } from '../repositories.js';

export interface RiskInput {
  userId: string;
  deviceId: string | null;
  amountMinor: number;
  recipientContactId: string | null;
  recipientUserId: string | null;
}

export interface RiskDecision {
  score: number;
  requiresStepUp: boolean;
  reasons: string[];
}

export function evaluateRisk(input: RiskInput): RiskDecision {
  const reasons: string[] = [];
  let score = 0;

  if (input.amountMinor >= config.risk.stepUpAmountMinor) {
    score += 40;
    reasons.push('high_value');
  }

  const db = getDb();
  const paidBefore = db
    .prepare(
      `SELECT 1 AS ok FROM payment_intents
        WHERE user_id = ? AND status = 'SUCCESSFUL'
          AND (recipient_contact_id = ? OR recipient_user_id = ?)
          AND created_at > datetime('now', '-30 days') LIMIT 1`,
    )
    .get(input.userId, input.recipientContactId, input.recipientUserId) as { ok: number } | undefined;
  if (!paidBefore) {
    score += 30;
    reasons.push('new_recipient');
  }

  if (devices.isNew(input.userId, input.deviceId, config.risk.newDeviceHours)) {
    score += 25;
    reasons.push('new_device');
  }

  const recent = db
    .prepare(`SELECT COUNT(*) AS n FROM payment_intents WHERE user_id = ? AND created_at > datetime('now', ?)`)
    .get(input.userId, `-${config.risk.velocityWindowMinutes} minutes`) as { n: number };
  if (recent.n >= config.risk.velocityMaxPayments) {
    score += 30;
    reasons.push('velocity');
  }

  return {
    score: Math.min(100, score),
    requiresStepUp: reasons.length > 0,
    reasons,
  };
}
