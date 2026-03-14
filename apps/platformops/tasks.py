import logging
from celery import shared_task
from django.core.management import call_command

from apps.platformops.models import BackupRecord, OperationalAlert
from apps.platformops.services.backup_service import BackupService

logger = logging.getLogger(__name__)


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=True, retry_jitter=True, max_retries=3)
def run_db_backup_task(self, created_by_id: str | None = None):
    from apps.users.models import User

    created_by = None
    if created_by_id:
        created_by = User.objects.filter(id=created_by_id).first()
    record = BackupService.run_database_backup(created_by=created_by)
    return {"backup_record_id": str(record.id), "status": record.status}


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=True, retry_jitter=True, max_retries=2)
def prune_backup_retention_task(self):
    retention_days = int(__import__("os").environ.get("BACKUP_RETENTION_DAYS", "30"))
    return BackupService.prune_backup_retention(retention_days=retention_days)


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=True, retry_jitter=True, max_retries=1)
def run_restore_drill_task(self):
    record = BackupService.run_restore_drill()
    return {"restore_drill_id": str(record.id), "status": record.status}


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=True, retry_jitter=True, max_retries=2)
def run_inventory_snapshot_task(self):
    call_command("inventory_snapshot")
    return {"status": "completed"}


@shared_task(bind=True, max_retries=0)
def monitor_queue_health_task(self):
    """Best-effort queue health ping; raises operational alert on failures."""
    try:
        from config.celery import app as celery_app

        insp = celery_app.control.inspect(timeout=2)
        stats = insp.stats() or {}
        active_workers = len(stats.keys())
        if active_workers <= 0:
            OperationalAlert.objects.create(
                category="QUEUE",
                severity=OperationalAlert.Severity.CRITICAL,
                message="No active Celery workers detected",
                details={"task": "monitor_queue_health_task"},
            )
            return {"healthy": False, "active_workers": 0}

        return {"healthy": True, "active_workers": active_workers}
    except Exception as exc:
        logger.exception("Queue health monitor failed")
        OperationalAlert.objects.create(
            category="QUEUE",
            severity=OperationalAlert.Severity.CRITICAL,
            message="Queue health check failed",
            details={"error": str(exc)},
        )
        return {"healthy": False, "error": str(exc)}
