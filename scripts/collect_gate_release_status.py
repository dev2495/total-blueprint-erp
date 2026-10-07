"""Read-only gate deployment evidence; no account or factory details are printed.

Run inside the candidate backend with --expected-sha <full commit>. Queries run
in a PostgreSQL read-only transaction with bounded statement/lock timeouts. This
collector does not provision links, profiles, users, backups or restore drills.
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django
django.setup()
from cryptography.fernet import Fernet
from django.conf import settings
from django.db import connection, transaction
from django.db.migrations.recorder import MigrationRecorder
from apps.analytics.models import ReportDistributionProfile
from apps.factory.models import Plant
from apps.gate.models import GateAssignment, GateAuditEvent, GatePublicLink, GoodsMovement, VisitorVisit
from apps.platformops.models import BackupRecord, RestoreDrillRecord
from apps.users.models import User


def collect(expected_sha):
    if not re.fullmatch(r"[0-9a-f]{40}", expected_sha) or os.getenv("APP_BUILD_SHA") != expected_sha:
        raise RuntimeError("Runtime build identity does not match the full expected SHA")
    if connection.vendor != "postgresql":
        raise RuntimeError("Read-only release status requires PostgreSQL")
    required = {("analytics", "0004_gate_register_report"), ("gate", "0001_initial"), ("gate", "0002_public_links_and_audit_guard"), ("users", "0012_watchman_role")}
    key = getattr(settings, "GATE_ID_ENCRYPTION_KEY", "") or os.getenv("GATE_ID_ENCRYPTION_KEY", "")
    key_valid = False
    try:
        Fernet(key.encode())
        key_valid = True
    except (ValueError, TypeError):
        pass
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
            cursor.execute("SET LOCAL statement_timeout='4000ms'")
            cursor.execute("SET LOCAL lock_timeout='500ms'")
            cursor.execute("SELECT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON t.tgrelid=c.oid WHERE c.relname=%s AND t.tgname='gate_audit_immutable' AND t.tgenabled='O' AND NOT t.tgisinternal)", [GateAuditEvent._meta.db_table])
            audit_trigger = cursor.fetchone()[0]
        applied = set(MigrationRecorder.Migration.objects.filter(app__in=["analytics", "gate", "users"]).values_list("app", "name"))
        backup = BackupRecord.objects.filter(status="SUCCEEDED").order_by("-created_at").first()
        restore = RestoreDrillRecord.objects.filter(status="SUCCEEDED").order_by("-created_at").first()
        profile = ReportDistributionProfile.objects.filter(report_code="gate_register_daily").first()
        watchman = User.objects.filter(role__code__iexact="WATCHMAN", is_active=True)
        evidence = {
            "database_mode": "read only",
            "image_build_sha": os.getenv("APP_BUILD_SHA"),
            "production_mode": bool(settings.IS_PRODUCTION),
            "debug": bool(settings.DEBUG),
            "gate_key_configured_and_valid": key_valid,
            "global_time_zone": settings.TIME_ZONE,
            "gate_time_zone": settings.GATE_TIME_ZONE,
            "gate_public_origin": getattr(settings, "GATE_PUBLIC_ORIGIN", "") or os.getenv("GATE_PUBLIC_ORIGIN", "https://erp.totalpolyprint.com"),
            "trusted_proxy_ips": settings.GATE_TRUSTED_PROXY_IPS,
            "reviewed_migrations_applied": required <= applied,
            "postgresql_audit_immutable_trigger_enabled": audit_trigger,
            "factory_count": Plant.objects.count(),
            "active_public_qr_link_count": GatePublicLink.objects.filter(active=True).count(),
            "factories_without_any_qr_link": Plant.objects.exclude(id__in=GatePublicLink.objects.values("plant_id")).count(),
            "active_watchman_account_count": watchman.count(),
            "active_unassigned_watchman_count": watchman.exclude(id__in=GateAssignment.objects.values("user_id")).count(),
            "record_counts": {"goods": GoodsMovement.objects.count(), "visitors": VisitorVisit.objects.count(), "audit": GateAuditEvent.objects.count()},
            "daily_gate_report_profile": {"configured": True, "active": profile.active, "targets_owner_only": profile.target_roles == ["OWNER"], "has_extra_recipients": bool(profile.extra_recipients)} if profile else {"configured": False},
            "latest_successful_backup": {"id": str(backup.id), "created_at": backup.created_at.isoformat(), "checksum_sha256": backup.checksum_sha256, "size_bytes": backup.size_bytes} if backup else None,
            "latest_successful_restore": {"id": str(restore.id), "backup_id": str(restore.backup_record_id), "created_at": restore.created_at.isoformat(), "smoke_test_passed": restore.smoke_test_passed} if restore else None,
        }
    return evidence


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expected-sha", required=True)
    arguments = parser.parse_args()
    try:
        print(json.dumps(collect(arguments.expected_sha), sort_keys=True))
    except Exception as error:
        print(json.dumps({"status": "FAIL", "error_type": type(error).__name__, "check": "Read-only gate deployment evidence could not be collected"}))
        raise SystemExit(1)
