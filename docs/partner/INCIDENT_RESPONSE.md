# Incident Response Plan

**Company:** Braincade Holdings (Pty) Ltd (Reg. No. BW00001951757)
**Effective:** 2026-09-19
**Status:** Draft — requires legal/ciso sign-off

---

## 1. Scope

This plan covers security incidents affecting PayChat's infrastructure, data,
or payment flows. It is aligned with the Botswana Data Protection Act, 2018
breach notification requirement (72 hours to the Information Regulator where
feasible).

## 2. Incident Classification

| Severity | Criteria | Response Time |
|---|---|---|
| **Critical** | Confirmed data breach, payment fraud, production outage >30 min | 15 min |
| **High** | Suspicious activity, potential compromise, service degradation | 1 hour |
| **Medium** | Detected vulnerability, minor service issue | 4 hours |
| **Low** | False positive, low-impact anomaly | 1 business day |

## 3. Incident Response Team (IRT)

| Role | Name/Contact | Responsibilities |
|---|---|---|
| **Incident Coordinator** | security@paychat.bw | Overall coordination, escalation |
| **Lead Engineer** | eng@paychat.bw | Technical investigation, remediation |
| **Product Lead** | product@paychat.bw | Customer impact assessment |
| **Legal** | legal@paychat.bw | Regulatory reporting, disclosure |
| **Comms** | press@paychat.bw | External communication |

## 4. Response Procedure

### Step 1: Detection & Triage
1. Alert received from monitoring (audit logs, rate limit, webhook failure)
2. IRT coordinator assesses severity
3. Incident ticket created in tracker

### Step 2: Containment
1. Isolate affected systems (network rules, disable keys)
2. Preserve evidence (logs, database snapshots)
3. Prevent further impact

### Step 3: Eradication
1. Identify root cause
2. Remove attacker access (rotate credentials, revoke tokens)
3. Patch vulnerability

### Step 4: Recovery
1. Restore from clean backup / rebuild
2. Verify integrity
3. Monitor for reoccurrence

### Step 5: Post-Incident
1. Write incident report
2. Update controls to prevent recurrence
3. Communicate to affected users (if required by law)

## 5. Specific Playbooks

### 5.1 Webhook Forgery Attempt
1. Verify `signature_ok = false` in `webhook_events`
2. Confirm no financial movement occurred (check `payment_intents` + `payment_transactions`)
3. Block the source IP at the edge
4. Notify provider partner
5. Audit log entry → SIEM

### 5.2 Duplicate Transaction
1. Identify duplicate via `event_id` or `idempotency_key`
2. Verify only one `payment_transactions` row exists for the intent
3. If duplicate found, reverse/refund the duplicate (coordinated with provider)
4. Audit trail review

### 5.3 Token Leakage (access token stolen)
1. Immediately revoke the session via `POST /api/auth/sessions/revoke`
2. User must re-authenticate
3. Check `audit_logs` for anomalous use
4. Consider forcing password reset

### 5.4 Secret Leakage (JWT_SECRET, DB credential, etc.)
1. Rotate the compromised secret immediately
2. Deploy new build with rotated secret
3. Force all sessions to re-authenticate
4. Audit for misuse during the exposure window

## 6. Communication Plan

| Audience | Channel | Timing |
|---|---|---|
| Internal team | Incident tracker + Slack | Immediate |
| Regulator (Botswana) | Official filing | Within 72 hours |
| Affected users | In-app + email | After regulator (if required by law) |
| Public | Press release | Coordinated with legal |

## 7. Post-Incident Review

After every Critical or High incident:
1. Root cause analysis (5 whys)
2. Lessons learned meeting within 5 business days
3. Update this plan and controls
4. Track remediation to closure

## 8. Testing

- This plan is **drilled annually** (tabletop exercise)
- Last drill: (none — first drill scheduled 2026-12)
- Webhook forgery scenario is covered by automated tests (`security.test.ts`)