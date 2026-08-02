import os
import logging

from django.db.models import Count, Q
from django.utils import timezone

from apps.platformops.models import BackupRecord, RestoreDrillRecord
from apps.users.models import NotificationDeliveryAttempt

logger = logging.getLogger(__name__)


class OpsMetricsService:
    @staticmethod
    def _queue_snapshot() -> dict:
        snapshot = {
            "active_workers": 0,
            "default_queue_depth": 0,
            "inspected": False,
        }

        try:
            from config.celery import app as celery_app

            inspect = celery_app.control.inspect(timeout=2)
            stats = inspect.stats() or {}
            snapshot["active_workers"] = len(stats.keys())
            snapshot["inspected"] = True
        except Exception:
            logger.warning("Unable to inspect Celery workers for platform metrics", exc_info=True)

        try:
            import redis  # type: ignore

            redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
            client = redis.Redis.from_url(redis_url, socket_timeout=2, socket_connect_timeout=2)
            depth = client.llen("celery")
            snapshot["default_queue_depth"] = int(depth or 0)
        except Exception:
            logger.warning("Unable to read Redis queue depth for platform metrics", exc_info=True)

        return snapshot

    @staticmethod
    def summary() -> dict:
        now = timezone.now()
        day_ago = now - timezone.timedelta(hours=24)
        max_backup_age_hours = int(os.getenv("BACKUP_MAX_AGE_HOURS", "6"))

        backups = BackupRecord.objects.filter(created_at__gte=day_ago)
        restore_drills = RestoreDrillRecord.objects.filter(created_at__gte=day_ago)
        deliveries = NotificationDeliveryAttempt.objects.filter(created_at__gte=day_ago)

        delivery_totals = deliveries.aggregate(
            total=Count("id"),
            success=Count("id", filter=Q(status="SUCCEEDED")),
            failed=Count("id", filter=Q(status="FAILED")),
        )
        total = int(delivery_totals.get("total") or 0)
        success = int(delivery_totals.get("success") or 0)

        latest_successful_backup = BackupRecord.objects.filter(
            status=BackupRecord.BackupStatus.SUCCEEDED,
        ).order_by("-finished_at", "-created_at").first()
        backup_age_hours = None
        backup_fresh = False
        if latest_successful_backup:
            completed_at = latest_successful_backup.finished_at or latest_successful_backup.created_at
            backup_age_hours = max(0.0, (now - completed_at).total_seconds() / 3600)
            backup_fresh = backup_age_hours <= max_backup_age_hours

        return {
            "generated_at": now.isoformat(),
            "backups": {
                "last_24h_total": backups.count(),
                "last_24h_failed": backups.filter(status=BackupRecord.BackupStatus.FAILED).count(),
                "latest": BackupRecord.objects.values(
                    "id", "status", "created_at", "finished_at", "size_bytes", "storage_provider", "object_key"
                ).order_by("-created_at").first(),
                "latest_success_at": (
                    (latest_successful_backup.finished_at or latest_successful_backup.created_at).isoformat()
                    if latest_successful_backup
                    else None
                ),
                "age_hours": round(backup_age_hours, 2) if backup_age_hours is not None else None,
                "max_age_hours": max_backup_age_hours,
                "fresh": backup_fresh,
            },
            "restore_drills": {
                "last_24h_total": restore_drills.count(),
                "last_24h_failed": restore_drills.filter(status=RestoreDrillRecord.RestoreStatus.FAILED).count(),
                "latest": RestoreDrillRecord.objects.values(
                    "id", "status", "created_at", "finished_at", "rpo_minutes", "rto_minutes", "smoke_test_passed"
                ).order_by("-created_at").first(),
            },
            "notifications": {
                "last_24h_total_delivery_attempts": total,
                "last_24h_successful": success,
                "last_24h_failed": int(delivery_totals.get("failed") or 0),
                "delivery_success_rate_pct": round((success / total) * 100, 2) if total else 100.0,
            },
            "queue": OpsMetricsService._queue_snapshot(),
        }
