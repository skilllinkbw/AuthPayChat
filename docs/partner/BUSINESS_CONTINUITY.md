# Business Continuity & Disaster Recovery

**Company:** Braincade Holdings (Pty) Ltd (Reg. No. BW00001951757)
**Status:** Planned — requires production deployment and DR testing

---

## 1. Business Impact Analysis (BIA)

| System | Recovery Time Objective (RTO) | Recovery Point Objective (RPO) |
|---|---|---|
| API (Fastify) | 4 hours | 5 minutes |
| Database (SQLite/Postgres) | 4 hours | 5 minutes |
| Redis (rate limiting) | 24 hours | Not critical (degrades to in-process) |
| Web frontend | 2 hours | N/A (static assets) |
| Android app | 2 hours | N/A (OTA update) |

| Function | Critical? | Acceptable downtime |
|---|---|---|
| Payment initiation | Yes | <4 hours |
| Balance inquiry | Yes | <4 hours |
| Chat/messaging | No | <24 hours |
| Notifications | No | <24 hours |
| Admin dashboard | No | <4 hours |

## 2. Continuity Strategy

| Component | Strategy |
|---|---|
| API | Containerized (Docker), multi-AZ deployment |
| Database | Postgres with streaming replication (primary + 1 replica) |
| Redis | ElastiCache (Redis) with Multi-AZ |
| Static assets | CDN (CloudFront / equivalent) |
| DNS | Route 53 (or equivalent) with health checks |
| Load balancer | Application Load Balancer (multi-AZ) |

## 3. Backup Strategy

| Data | Frequency | Retention | Test |
|---|---|---|---|
| Database | Continuous WAL (Postgres) / daily snapshot (SQLite) | 30 days | Monthly restore test |
| Application code | Git | Permanent | N/A |
| Configuration | Git (non-secret) + secret manager | Permanent | N/A |
| Logs | Daily | 90 days (audit), 30 days (operational) | N/A |

## 4. Disaster Recovery Scenarios

### 4.1 Single AZ Outage
- Traffic fails over to secondary AZ within 60 seconds (health check)
- No data loss (RPO = 5 min for database)
- RTO: <4 hours for full recovery

### 4.2 Database Corruption
- Promote read replica
- Restore from last clean snapshot if needed
- RTO: <4 hours

### 4.3 Complete Region Failure
- Failover to secondary region
- DNS cutover (TTL = 60s)
- RTO: <24 hours

### 4.4 Redis Failure
- Rate limiting degrades to in-process mode
- No financial impact — only abuse-detection degradation
- RTO: <1 hour (restore Redis) or <24 hours (manual)

## 5. Runbook: API Server Failure

1. Health check fails (`/readyz` returns non-200)
2. Load balancer removes instance from pool
3. New instance launched from AMI / container image
4. Instance passes health check → traffic restored
5. If all instances down: deploy from latest build
6. Notify on-call: ops@paychat.bw

## 6. Runbook: Database Failure

1. Promote read replica (Postgres)
2. Update application config to point to new primary
3. Resume service
4. Restore failed primary from backup
5. Re-establish replication

## 7. Testing Schedule

| Test | Frequency | Owner |
|---|---|---|
| Backup restore | Monthly | DevOps |
| Failover drill | Quarterly | SRE |
| Full DR exercise | Annually | Engineering |
| Health check validation | Continuous | Monitoring |

## 8. Contact List

| Role | Contact |
|---|---|
| On-call (primary) | oncall@paychat.bw |
| On-call (secondary) | ops@paychat.bw |
| Database admin | dba@paychat.bw |
| Network/security | security@paychat.bw |

## 9. Limitations

- This plan is **not yet tested in production** — PayChat has no production deployment as of 2026-09-19.
- The plan assumes AWS/Azure/GCP equivalent infrastructure; actual cloud provider TBC.
- DR testing requires a production-like environment, which is planned for Q4 2026.