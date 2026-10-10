"""Document image storage in PostgreSQL: measurement, projection and owner alerts.

Decision (10 Oct 2026): bill/outward page images stay in PostgreSQL (bytea),
which keeps evidence transactional with its records and inside the proven
pg_dump/restore drill. Growth is controlled and watched:

* Upload normalisation caps each page at 2400 px / 2 MiB JPEG (typically
  250–600 KB); PDFs are rendered to the same JPEG pages and their original is
  kept once. Thumbnails are rendered on the fly and never stored.
* This monitor runs daily and on demand. It reports page bytes by table,
  database size, free disk on the backup volume, 30-day growth and the
  projected days until each threshold, and alerts Owner/Admin accounts once per
  day when a threshold is crossed.
* Exit path when thresholds are reached: move page bytes to private object
  storage with dual-read (new pages to the bucket, old pages read from the
  database until copied), keeping sha256 verification. See
  docs/documents-jobwork/STORAGE.md.
"""
import os
import shutil
from datetime import timedelta
from decimal import Decimal

from django.db import connection
from django.db.models import Sum
from django.utils import timezone

GB = 1024 ** 3
DOCUMENT_TABLES = {
    "inward_pages": "gate_inwardbillpage",
    "outward_pages": "gate_outwarddocumentpage",
    "original_files": "gate_documentoriginalfile",
}


def _threshold(name, default):
    try:
        return Decimal(str(os.getenv(name, default)))
    except Exception:
        return Decimal(str(default))


def _table_bytes(table):
    if connection.vendor != "postgresql":
        return 0
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_total_relation_size(to_regclass(%s))", [table])
        value = cursor.fetchone()[0]
    return int(value or 0)


def _database_bytes():
    if connection.vendor != "postgresql":
        return 0
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_database_size(current_database())")
        return int(cursor.fetchone()[0] or 0)


def _backup_volume():
    from apps.platformops.services.backup_service import BackupService

    try:
        usage = shutil.disk_usage(BackupService._backup_dir())
    except Exception:
        return None
    return {"total_bytes": usage.total, "free_bytes": usage.free, "free_pct": round(usage.free * 100 / usage.total, 1) if usage.total else None}


def _recent_page_bytes(days=30):
    from .models import DocumentOriginalFile, InwardBillPage, OutwardDocumentPage

    since = timezone.now() - timedelta(days=days)
    inward = InwardBillPage.objects.filter(intake__arrival_at__gte=since).aggregate(total=Sum("byte_size"))["total"] or 0
    outward = OutwardDocumentPage.objects.filter(document__departed_at__gte=since).aggregate(total=Sum("byte_size"))["total"] or 0
    originals = DocumentOriginalFile.objects.filter(created_at__gte=since).aggregate(total=Sum("byte_size"))["total"] or 0
    return int(inward + outward + originals)


def storage_report():
    from .models import DocumentOriginalFile, InwardBillPage, OutwardDocumentPage

    tables = {name: _table_bytes(table) for name, table in DOCUMENT_TABLES.items()}
    document_bytes = sum(tables.values())
    database_bytes = _database_bytes()
    growth_30d = _recent_page_bytes(30)
    daily = growth_30d / 30 if growth_30d else 0
    db_warn = int(_threshold("DOCUMENT_DB_WARN_GB", "25") * GB)
    disk_warn_pct = float(_threshold("DOCUMENT_DISK_FREE_WARN_PCT", "20"))
    volume = _backup_volume()
    warnings = []
    if database_bytes and database_bytes >= db_warn:
        warnings.append(f"Database is {database_bytes / GB:.1f} GB, above the {db_warn / GB:.0f} GB planning threshold.")
    if volume and volume["free_pct"] is not None and volume["free_pct"] < disk_warn_pct:
        warnings.append(f"Server disk has {volume['free_pct']}% free, below {disk_warn_pct:.0f}%.")
    days_to_db_warn = None
    if daily > 0 and database_bytes and database_bytes < db_warn:
        days_to_db_warn = int((db_warn - database_bytes) / daily)
    days_to_disk_warn = None
    if daily > 0 and volume and volume["total_bytes"]:
        floor = volume["total_bytes"] * disk_warn_pct / 100
        # Each document byte is held by the database and by every retained backup.
        retained_backups = max(1, int(os.getenv("DOCUMENT_BACKUP_COPIES", "6")))
        headroom = volume["free_bytes"] - floor
        if headroom > 0:
            days_to_disk_warn = int(headroom / (daily * (1 + retained_backups)))
    return {
        "measured_at": timezone.now().isoformat(),
        "storage_backend": "POSTGRESQL",
        "tables_bytes": tables,
        "document_bytes": document_bytes,
        "database_bytes": database_bytes,
        "document_share_pct": round(document_bytes * 100 / database_bytes, 1) if database_bytes else None,
        "page_counts": {
            "inward_pages": InwardBillPage.objects.count(),
            "outward_pages": OutwardDocumentPage.objects.count(),
            "original_files": DocumentOriginalFile.objects.count(),
        },
        "growth_30d_bytes": growth_30d,
        "projected_daily_bytes": int(daily),
        "thresholds": {"database_warn_bytes": db_warn, "disk_free_warn_pct": disk_warn_pct},
        "backup_volume": volume,
        "days_to_database_threshold": days_to_db_warn,
        "days_to_disk_threshold": days_to_disk_warn,
        "warnings": warnings,
        "status": "ACTION_NEEDED" if warnings else ("PLAN_AHEAD" if (days_to_db_warn is not None and days_to_db_warn < 90) or (days_to_disk_warn is not None and days_to_disk_warn < 90) else "OK"),
    }


def run_storage_monitor():
    """Daily job: alert Owner/Admin accounts (once per day) when action is needed."""
    from apps.users.models import Notification, User
    from apps.users.permission_service import PermissionService

    report = storage_report()
    if report["status"] == "OK":
        return report
    today = timezone.now().date().isoformat()
    from apps.users.services.notification_service import NotificationService

    for user in User.objects.filter(is_active=True).select_related("role").iterator():
        if not PermissionService.is_gate_master(user):
            continue
        notification, created = Notification.objects.get_or_create(
            user=user, idempotency_key=f"doc-storage:{today}:{user.pk}",
            defaults={
                "event_key": "documents.storage_threshold", "type": "SYSTEM",
                "title": "Bill image storage needs attention" if report["status"] == "ACTION_NEEDED" else "Plan bill image storage",
                "message": " ".join(report["warnings"]) or "At the current rate, document images reach a storage threshold within 90 days.",
                "priority": "HIGH" if report["status"] == "ACTION_NEEDED" else "MEDIUM",
                "channels": ["IN_APP"], "deep_link": "/inventory/gate-bills?tab=reports",
            },
        )
        if created:
            NotificationService._create_delivery_attempts(notification)
    return report
