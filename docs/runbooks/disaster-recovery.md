# Disaster Recovery Runbook

## Targets
- `RPO <= 4h`
- `RTO <= 2h`
- Backup schedule: every 4 hours
- Retention: 30 days

## Trigger conditions
- primary DB corruption
- accidental destructive migration/data loss
- prolonged DB outage

## Recovery procedure
1. Freeze writes:
   - set maintenance banner
   - disable mutating API routes at gateway/WAF if required
2. Pick restore candidate:
   - query `platformops_backup_records` for latest `SUCCEEDED`
   - verify checksum + object availability
3. Restore to staging first:
   - run `DR_RESTORE_DRILL_COMMAND`
   - execute smoke tests (`DR_SMOKE_TEST_COMMAND`)
   - On AWS, run the drill inside the backend container so the host backup mount is
     available at `/var/backups/tpp-erp/managed`:
     `cd /opt/tpp-erp/app && sudo docker compose -f deploy/aws/docker-compose.yml run --rm backend /app/deploy/aws/restore-drill.sh`
   - Do not invoke `/opt/tpp-erp/app/deploy/aws/restore-drill.sh` directly on the
     host without setting `BACKUP_LOCAL_DIR`; its default path is the container
     mount and will otherwise produce a false "no managed backup" failure.
4. If staging smoke passes:
   - restore production database
5. Validate:
   - `/api/health/live/` and `/api/health/ready/`
   - login
   - sales->production->dispatch critical path
6. Re-open traffic.

## Weekly drill checklist
1. Trigger drill (`/api/ops/restore-drills/run-now`).
2. Capture:
   - backup ID
   - start/end timestamps
   - measured RPO minutes
   - measured RTO minutes
3. Attach result to ops log.
4. Create action items for any failed smoke or SLO breach.
