# AML / KYC Overview

**Company:** Braincade Holdings (Pty) Ltd (Reg. No. BW00001951757)
**Status:** Designed · **Requires regulatory approval and external provider compliance**

**This document is engineering documentation for partner review. It does NOT
constitute compliance certification and does NOT claim regulatory approval.**

---

## 1. Regulatory Context

- Botswana Central Bank supervises anti-money laundering (AML) obligations under
  the Financial Intelligence Act (FIA) and related regulations.
- PayChat operates as a **payment technology platform** — it is not a registered
  Money Services Business (MSB) or bank. AML/KYC obligations are therefore
  triggered by transaction thresholds and by partnership structure.
- KYC/AML compliance is **shared with provider partners**, who are the regulated
  entities holding customer funds.

## 2. Role and Responsibility Model

| Party | Role | AML/KYC Obligations |
|---|---|---|
| Provider partners (banks, mobile money) | Licensed VASP | Primary KYC, transaction monitoring, reporting to FIA |
| PayChat (Braincade) | Payment orchestration platform | Monitor for platform-level abuse, support provider obligations, maintain audit trail |

## 3. Current KYC Implementation

| Feature | Status | Notes |
|---|---|---|
| Account creation (name + phone) | Implemented | Minimal onboarding |
| Phone verification | Planned | SMS OTP |
| ID document verification | **Planned** | Requires partner integration |
| Facial matching | **Planned** | Requires partner integration |
| Sanctions screening | **Planned** | Requires external provider |

## 4. Transaction Monitoring

| Control | Implementation | Threshold |
|---|---|---|
| Velocity check | `apps/api/src/payments/risk.ts` | 5 payments per hour |
| Step-up requirement | Amount ≥ P500 (`RISK_STEP_UP_AMOUNT_MINOR`) | Step-up required |
| New-device risk | 24-hour window (`RISK_NEW_DEVICE_HOURS`) | Risk flag |
| Daily limits | **Configured per provider** | P5,000 default |
| Weekly limits | **Planned** | To be configured |
| Monthly limits | **Planned** | To be configured |

## 5. Suspicious Activity Reporting

- PayChat logs all payment attempts with full audit trails
- Anomalous patterns (rapid succession, velocity, new devices) trigger step-up
  or block
- **SAR filing** is the responsibility of the licensed provider partner
- PayChat supports SAR filing through: `audit_logs` table + incident response pipeline

## 6. Record Keeping

| Record | Retention |
|---|---|
| Transaction records | 7 years |
| Audit logs | 7 years |
| Account creation data | 7 years after account closure |
| Communication records | 7 years |

## 7. Politically Exposed Persons (PEPs)

- **Not yet screened** — PEP screening is planned and requires an external
  sanctions/PEP watchlist provider
- High-value transactions (≥ P5,000) are flagged for manual review pending
  PEP integration

## 8. Customer Due Diligence (CDD)

| CDD Level | Trigger | Requirements | Status |
|---|---|---|---|
| Simplified | Standard payments | Phone + name | Implemented |
| Standard | Daily > P1,000 | Phone + name + OTP | Planned |
| Enhanced | Daily > P5,000 | ID document + selfie + sanctions screening | Planned |

## 9. Ongoing Monitoring

- Real-time velocity and fraud scoring at payment initiation
- Daily batch reconciliation against provider statements
- Quarterly AML policy review (to be established)

## 10. Training and Internal Controls

- All engineering team members review AML/KYC obligations during onboarding
- Access to payment systems is role-based and logged
- **Formal AML training program: planned**

## 11. External Dependencies

PayChat's AML/KYC effectiveness depends on:

| Dependency | Type | Status |
|---|---|---|
| Provider partner KYC | External | Required |
| Sanctions screening | External provider | Not yet integrated |
| ID document verification | External provider | Not yet integrated |
| OTP delivery | External provider | Not yet integrated |

## 12. Next Steps

1. Engage Botswana legal counsel for AML/KYC programme sign-off
2. Select and integrate an external KYC provider
3. Establish formal transaction monitoring rules
4. Implement SAR reporting interface to licensed partners
5. Obtain necessary regulatory registrations if PayChat's role expands

## 13. Disclaimer

This document reflects engineering intent and current implementation status.
PayChat has **NOT** obtained any regulatory approval for its AML/KYC programme.
This document is provided for partner awareness and must be reviewed and
validated by qualified regulatory counsel before production use.