#!/usr/bin/env python3
"""Verify exact reviewed additive migration files and an optional linked backup."""
import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")


def verify(expected, backup_proof=False):
    if not re.fullmatch(r"[0-9a-f]{40}", expected) or os.getenv("APP_BUILD_SHA") != expected:
        raise RuntimeError("Exact candidate image identity is required.")
    import django
    django.setup()
    from django.conf import settings
    from django.db import connection, transaction
    from django.db.migrations.executor import MigrationExecutor

    if connection.vendor != "postgresql" or not settings.IS_PRODUCTION or settings.DEBUG:
        raise RuntimeError("The production PostgreSQL migration guard is required.")
    reviewed = json.loads((Path(__file__).parent / "reviewed-migrations.json").read_text())
    if not reviewed:
        raise RuntimeError("The bill migration review has not been frozen.")
    allowed = set()
    for item in reviewed:
        app, name, checksum = item["app"], item["name"], item["sha256"]
        if not re.fullmatch(r"[a-z_]+", app) or not re.fullmatch(r"[0-9]{4}_[a-z0-9_]+", name) or not re.fullmatch(r"[0-9a-f]{64}", checksum):
            raise RuntimeError("Invalid reviewed migration identity.")
        path = ROOT / "apps" / app / "migrations" / (name + ".py")
        if hashlib.sha256(path.read_bytes()).hexdigest() != checksum:
            raise RuntimeError("A reviewed migration changed after source freeze.")
        allowed.add((app, name))
    if len(allowed) != len(reviewed):
        raise RuntimeError("Duplicate reviewed migrations are not allowed.")
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
            cursor.execute("SET LOCAL statement_timeout='4000ms'")
            cursor.execute("SET LOCAL lock_timeout='500ms'")
        executor = MigrationExecutor(connection)
        plan = executor.migration_plan(executor.loader.graph.leaf_nodes())
        pending = {(migration.app_label, migration.name) for migration, backwards in plan}
        applied = set(executor.loader.applied_migrations)
        existing_gate = {("gate", "0001_initial"), ("gate", "0002_public_links_and_audit_guard"), ("users", "0012_watchman_role"), ("analytics", "0004_gate_register_report")}
        if not existing_gate <= applied:
            raise RuntimeError("The existing deployed gate migration history changed.")
        if any(backwards for migration, backwards in plan) or pending - allowed or allowed - (pending | applied):
            raise RuntimeError("The pending/already-applied plan differs from the reviewed bill migrations.")
        destructive = {"DeleteModel", "RemoveField", "RenameModel", "RenameField", "AlterModelTable"}
        for app, name in allowed:
            migration = executor.loader.get_migration(app, name)
            if any(type(operation).__name__ in destructive for operation in migration.operations):
                raise RuntimeError("The bill release must not remove or rename existing schema.")
        if backup_proof:
            from apps.platformops.models import BackupRecord, RestoreDrillRecord
            proof = json.load(sys.stdin)
            parent = json.loads((Path(__file__).parent / "source-provenance.json").read_text())["deployed_parent"]
            if proof["status"] != "PASS" or proof["image_build_sha"] != parent:
                raise RuntimeError("Backup evidence does not describe the expected deployed parent.")
            backup = BackupRecord.objects.get(pk=proof["backup"]["id"])
            restore = RestoreDrillRecord.objects.get(pk=proof["restore"]["id"])
            if backup.status != "SUCCEEDED" or restore.status != "SUCCEEDED" or not restore.smoke_test_passed or restore.backup_record_id != backup.id:
                raise RuntimeError("Backup and restore drill are not successful and exactly linked.")
            if proof["restore"]["backup_id"] != str(backup.id) or proof["backup"]["checksum_sha256"] != backup.checksum_sha256 or proof["backup"]["size_bytes"] != backup.size_bytes:
                raise RuntimeError("Backup artifact identity differs from the reviewed evidence.")
            age = (datetime.now(timezone.utc) - backup.created_at).total_seconds()
            if age < 0 or age > 3600:
                raise RuntimeError("Run a fresh managed backup/restore drill within one hour of activation.")
            directory = Path("/var/backups/tpp-erp/managed")
            artifact = directory / backup.file_name
            if artifact.is_symlink() or artifact.resolve().parent != directory.resolve() or not artifact.is_file() or artifact.stat().st_size != backup.size_bytes:
                raise RuntimeError("The exact managed backup artifact is unavailable.")
            if hashlib.sha256(artifact.read_bytes()).hexdigest() != backup.checksum_sha256:
                raise RuntimeError("The exact managed backup artifact checksum changed.")
    return {"status": "PASS", "candidate_sha": expected, "reviewed_pending_migrations": sorted(pending), "reviewed_already_applied_migrations": sorted(allowed & applied), "fresh_exact_backup_restore_verified": backup_proof}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expected-sha", required=True)
    parser.add_argument("--backup-proof", action="store_true")
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.expected_sha, args.backup_proof), sort_keys=True))
    except Exception:
        print(json.dumps({"status": "FAIL", "check": "Candidate migration or backup review guard rejected activation."}))
        raise SystemExit(1)
