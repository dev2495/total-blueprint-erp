"""Read-only bill release evidence: safe aggregates, schema and image identity.

Run in the deployed backend with its full expected commit. This collector never
provisions links, users, notices, backups or receipts and reads no image bytes.
"""
import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")


def collect(expected, local=False):
    if not re.fullmatch(r"[0-9a-f]{40}", expected) or os.getenv("APP_BUILD_SHA") != expected:
        raise RuntimeError("The exact deployed image identity is required.")
    import django
    django.setup()
    from cryptography.fernet import Fernet
    from django.conf import settings
    from django.db import connection, transaction
    from django.db.models import Count
    from django.db.migrations.recorder import MigrationRecorder
    from apps.analytics.models import ReportDistributionProfile
    from apps.gate.models import GateAuditEvent, InwardBillIntake, InwardBillPage, InwardBillReceiptReference
    from apps.users.models import Notification, NotificationDeliveryAttempt

    if connection.vendor != "postgresql" or not settings.IS_PRODUCTION or settings.DEBUG:
        raise RuntimeError("A production PostgreSQL read-only collector is required.")
    if local and (os.getenv("BILL_ACCEPTANCE_ALLOW_LOCAL") != "1" or connection.settings_dict["NAME"] != "tpp_bill_dev_20261008"):
        raise RuntimeError("The isolated production-shaped database guard failed.")
    if not local and connection.settings_dict["NAME"] == "tpp_bill_dev_20261008":
        raise RuntimeError("Explicit isolated mode is required for local evidence.")
    key = getattr(settings, "GATE_ID_ENCRYPTION_KEY", "") or os.getenv("GATE_ID_ENCRYPTION_KEY", "")
    Fernet(key.encode())
    reviewed = json.loads((ROOT / "docs/releases/bill-intake-20261008/reviewed-migrations.json").read_text())
    required_bill = {("gate", "0003_inward_bill_intake"), ("users", "0013_inward_bill_notifications")}
    if {(item["app"], item["name"]) for item in reviewed} != required_bill:
        raise RuntimeError("The exact reviewed bill migration allowlist is required.")
    for item in reviewed:
        file = ROOT / "apps" / item["app"] / "migrations" / (item["name"] + ".py")
        if hashlib.sha256(file.read_bytes()).hexdigest() != item["sha256"]:
            raise RuntimeError("A deployed migration differs from its reviewed source.")
    expected_triggers = {
        "gate_audit_immutable": GateAuditEvent,
        "bill_arrival_immutable": InwardBillIntake,
        "bill_page_immutable": InwardBillPage,
        "bill_reference_immutable": InwardBillReceiptReference,
    }
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
            cursor.execute("SET LOCAL statement_timeout='4000ms'")
            cursor.execute("SET LOCAL lock_timeout='500ms'")
            triggers = {}
            for name, model in expected_triggers.items():
                cursor.execute("SELECT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON t.tgrelid=c.oid WHERE c.relname=%s AND t.tgname=%s AND t.tgenabled='O' AND NOT t.tgisinternal)", [model._meta.db_table, name])
                triggers[name] = cursor.fetchone()[0]
            cursor.execute("SELECT c.column_default, c.is_nullable FROM information_schema.columns c WHERE c.table_schema=current_schema() AND c.table_name=%s AND c.column_name='deep_link'", [Notification._meta.db_table])
            link_column = cursor.fetchone()
            old_notification_insert_compatible = bool(link_column and link_column[0] in {"''::character varying", "''::text", "''"} and link_column[1] == "NO")
        applied = set(MigrationRecorder.Migration.objects.values_list("app", "name"))
        required = required_bill | {("gate", "0001_initial"), ("gate", "0002_public_links_and_audit_guard"), ("users", "0012_watchman_role"), ("analytics", "0004_gate_register_report")}
        bills = InwardBillIntake.objects
        counts = dict(bills.values("status").annotate(total=Count("id")).values_list("status", "total"))
        invalid_resolution = bills.filter(status__in=["RECEIPTED", "VOID"], resolved_at__isnull=True).count()
        missing_pages = bills.filter(pages__isnull=True).count()
        notices = Notification.objects.filter(event_key="gate.inward_bill_uploaded")
        attempts = NotificationDeliveryAttempt.objects.filter(notification__in=notices)
        unsafe_delivery = attempts.exclude(channel="IN_APP").count()
        profile = ReportDistributionProfile.objects.filter(report_code="gate_register_daily").first()
        evidence = {
            "status": "PASS", "mode": "production-shaped-local" if local else "deployed-production",
            "image_build_sha": expected, "database_mode": "read only", "production_mode": True, "debug": False,
            "reviewed_migration_files_verified": True, "reviewed_migrations_applied": required <= applied,
            "postgresql_evidence_triggers": triggers, "gate_id_key_valid": True,
            "old_stack_notification_insert_compatible": old_notification_insert_compatible,
            "gate_time_zone": settings.GATE_TIME_ZONE,
            "record_counts": {"bills_by_status": counts, "pages": InwardBillPage.objects.count(), "receipt_references": InwardBillReceiptReference.objects.count(), "bill_audit_events": GateAuditEvent.objects.filter(object_type="BILL").count(), "bill_notifications": notices.count(), "bill_in_app_attempts": attempts.filter(channel="IN_APP").count()},
            "integrity": {"resolved_bills_missing_timestamp": invalid_resolution, "bills_without_pages": missing_pages, "external_bill_delivery_attempts": unsafe_delivery},
            "gate_report_owner_recipient_policy_retained": bool(profile and profile.target_roles == ["OWNER"] and not profile.extra_recipients),
            "read_image_or_private_commercial_fields": False,
        }
        if not required <= applied or not all(triggers.values()) or not old_notification_insert_compatible or invalid_resolution or missing_pages or unsafe_delivery:
            raise RuntimeError("Deployed bill schema/evidence integrity checks failed.")
    return evidence


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expected-sha", required=True)
    parser.add_argument("--production-shaped-local", action="store_true")
    args = parser.parse_args()
    try:
        print(json.dumps(collect(args.expected_sha, args.production_shaped_local), sort_keys=True))
    except Exception as error:
        print(json.dumps({"status": "FAIL", "error_type": type(error).__name__, "check": "Read-only bill release evidence was rejected."}))
        raise SystemExit(1)
