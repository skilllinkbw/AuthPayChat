# Disaster Recovery

**Company:** Braincade Holdings (Pty) Ltd (Reg. No. BW00001951757)
**Status:** Planned — see `BUSINESS_CONTINUITY.md` for full DR strategy

---

## 1. Recovery Point / Time Objectives

| System | RTO | RPO |
|---|---|---|
| API | 4 hours | 5 minutes |
| Database | 4 hours | 5 minutes |
| Redis | 24 hours | N/A (degraded mode available) |
| Static assets | 2 hours | N/A |

## 2. Backup Locations

| Data | Storage | Access |
|---|---|---|
| Database snapshots | Cloud object storage (encrypted) | DevOps team |
| Application artifacts | Container registry | CI/CD |
| Configuration | Git (non-secret) + secret manager | Engineering |
| Logs | Centralized log store | SRE team |

## 3. Recovery Procedures

### Database Restore (PostgreSQL)
1. Stop the application (`systemctl stop paychat-api`)
2. Restore from the latest clean snapshot:
   `pg_basebackup --restore-point=<timestamp> --target-action=restore`
3. Verify data integrity (checksum comparison)
4. Start application
5. Run health checks (`/healthz`, `/readyz`)
6. Monitor for 30 minutes

### Database Restore (SQLite embedded)
1. Stop application
2. Copy latest backup to `DATABASE_PATH`
3. Start application
4. Run migration verification
5. Monitor

### Redis Restore
1. Deploy new Redis instance
2. Rate limiting works in degraded mode immediately
3. Shared locks/caches re-populate as needed
4. No data restoration required (ephemeral state)

## 4. Failure Detection

| Check | Frequency | Alert threshold |
|---|---|---|
| `/healthz` (liveness) | Every 10s | 2 consecutive failures |
| `/readyz` (readiness) | Every 10s | 2 consecutive failures |
| Database connectivity | Every 30s | 1 failure |
| Redis connectivity | Every 30s | 1 failure (warning, not critical) |
| Webhook processing | Every 5 min | 10 unprocessed events |

## 5. Rollback Procedure

If a deployment causes a Critical incident:
1. Stop traffic to new version (`paychat-api-v2`)
2. Route traffic back to previous version (`paychat-api-v1`)
3. Verify health checks pass
4. Investigate root cause
5. Fix → test → redeploy

Rollback time target: **5 minutes**

## 6. Untested Elements (as of 2026-09-19)

The following DR procedures have NOT been executed in a production environment:
- Full region failover
- Database point-in-time recovery from WAL
- Complete Redis cluster rebuild
- Application-level failover to read replica

These are scheduled for testing once a staging environment mirroring production is established.