# Data Breach Response Procedure

**Product:** PayChat · **Controller:** Braincade Holdings (Pty) Ltd
**Version:** 1.0-draft · **Legal review status: DRAFT — NOT REVIEWED BY COUNSEL**
**Last updated:** 2026-09-19

> **Not yet operational.** This procedure is fully documented, but no on-call
> rota, alerting backend or formal legal contact list exists yet. Until those are
> in place, breach handling depends on a person monitoring the system manually.

Applies to any confirmed or suspected personal-data breach affecting PayChat
data. For availability/security incidents generally, see
[`../docs/partner/INCIDENT_RESPONSE.md`](../docs/partner/INCIDENT_RESPONSE.md).

---

## 1. Reporting a suspected breach

Any person who suspects a breach reports it **immediately** to
`security@paychat.bw` with: what was observed, when, which systems, and any
evidence. Do not investigate alone, do not delete evidence, and do not contact
affected users or the regulator before the incident lead agrees the message.

## 2. Severity classification

| Severity | Definition | Examples |
|---|---|---|
| **S1 Critical** | Confirmed unauthorised access to personal or financial data, or compromise of a secret | Database exfiltration; provider credential leak; admin account takeover |
| **S2 High** | Likely unauthorised access, scope not yet bounded | Suspicious bulk read; leaked log file containing personal data |
| **S3 Medium** | Contained exposure with limited impact | Mis-sent single-user export |
| **S4 Low** | No personal data involved | Misconfiguration with no data exposure |

## 3. Response phases

### Phase 1 — Triage (target: within 1 hour of report)
1. Record the report with a unique incident reference.
2. Assign an incident lead.
3. Classify severity (S1–S4). Re-classify as facts change.
4. Decide whether to invoke the crisis bridge.

### Phase 2 — Containment (target: within 4 hours for S1/S2)
1. Revoke affected sessions and rotate the affected credentials/key material.
2. Isolate the implicated component (feature flag off, route disabled, node
   drained) — preserve evidence before doing so.
3. Block the abuse vector (revoke tokens, tighten rate limits, add a rule).
4. Confirm the blast radius: which data subjects, which fields, which period.

### Phase 3 — Assessment
Determine, for each affected data subject:
1. What data was involved (identity, contact, transactional, credentials).
2. Whether the data was readable or encrypted/protected.
3. The likelihood and severity of harm (identity theft, financial loss,
   discrimination, reputational).
4. Whether the data is subject to a Payment Partner's or another controller's
   notification duty.

### Phase 4 — Notification
1. **Regulator:** notify the Information and Data Protection Commission where the
   threshold is met. **The statutory notification window and form must be
   confirmed by counsel.**
2. **Data subjects:** notify without undue delay where a high risk of harm
   exists, in clear language covering: what happened, when, what data, what we
   have done, what the individual should do, and whom to contact.
3. **Payment Partners:** notify any partner whose records or customers are
   affected, in line with the partner agreement.
4. **Insurers / advisers:** notify as required and where privilege applies.

Notifications must be factual. Do not speculate, and do not minimise.

### Phase 5 — Remediation
1. Fix the root cause, not only the symptom.
2. Add a regression test or control that would have caught the issue.
3. Rotate any credential that may have been exposed.
4. Re-run the security gate (secret scan, dependency audit, full test suite).

### Phase 6 — Post-incident review (within 10 business days)
A written review covering: timeline, root cause, impact, what worked, what
failed, corrective actions with owners and dates, and whether the register and
retention records were updated. Findings feed back into this procedure.

## 4. Evidence handling

- Preserve logs and audit records before any remediation that could overwrite
  them.
- Keep an evidence log of who accessed what and when.
- Do not copy personal data out of the controlled environment for convenience.

## 5. Roles

| Role | Responsibility |
|---|---|
| Incident lead | Owns the incident end to end, decides severity, approves messaging |
| Engineering | Containment, forensics, remediation, regression test |
| Privacy/legal contact | Notification decisions and wording, regulator liaison |
| Communications | Consistent external statement, if required |
| Accountable executive | Escalation point, resourcing, sign-off on closure |

Named individuals and a 24/7 escalation path **must be recorded by the owner
before go-live**. A procedure without named owners is not operationally credible.

## 6. Record keeping

Every incident is recorded with: reference, severity, timeline, data subjects and
fields affected, decisions, notifications sent, corrective actions and closure
approval. Records are retained per
[`DATA_RETENTION_POLICY.md`](DATA_RETENTION_POLICY.md) and are classified C2.
