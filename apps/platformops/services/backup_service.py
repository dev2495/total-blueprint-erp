import datetime as dt
import hashlib
import os
import pathlib
import shlex
import subprocess
import time
from dataclasses import dataclass
from typing import Optional

from django.conf import settings
from django.utils import timezone

from apps.platformops.models import BackupRecord, OperationalAlert, RestoreDrillRecord


@dataclass
class BackupArtifacts:
    file_path: pathlib.Path
    file_name: str
    checksum_sha256: str
    size_bytes: int


class BackupService:
    """Handles database backups, retention and restore drills."""

    @staticmethod
    def _backup_dir() -> pathlib.Path:
        default_dir = pathlib.Path(settings.BASE_DIR) / ".runtime" / "backups"
        configured = os.getenv("BACKUP_LOCAL_DIR", str(default_dir))
        path = pathlib.Path(configured).expanduser().resolve()
        path.mkdir(parents=True, exist_ok=True)
        return path

    @staticmethod
    def _timestamp() -> str:
        return timezone.now().strftime("%Y%m%d_%H%M%S")

    @classmethod
    def _pg_dump_binary(cls) -> str:
        return os.getenv("PG_DUMP_BIN", "pg_dump")

    @classmethod
    def _build_pg_dump_command(cls, output_path: pathlib.Path) -> list[str]:
        db_name = os.getenv("DB_NAME", "total_blueprint_erp")
        db_user = os.getenv("DB_USER", "postgres")
        db_host = os.getenv("DB_HOST", "127.0.0.1")
        db_port = os.getenv("DB_PORT", "5432")
        return [
            cls._pg_dump_binary(),
            "-Fc",
            "-f",
            str(output_path),
            "-h",
            db_host,
            "-p",
            db_port,
            "-U",
            db_user,
            db_name,
        ]

    @staticmethod
    def _sha256(file_path: pathlib.Path) -> str:
        digest = hashlib.sha256()
        with file_path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    @staticmethod
    def _maybe_encrypt(file_path: pathlib.Path) -> pathlib.Path:
        encryption_key = os.getenv("BACKUP_ENCRYPTION_KEY", "").strip()
        if not encryption_key:
            return file_path

        encrypted_path = file_path.with_suffix(file_path.suffix + ".enc")
        cmd = [
            "openssl",
            "enc",
            "-aes-256-cbc",
            "-salt",
            "-pbkdf2",
            "-pass",
            "env:BACKUP_ENCRYPTION_KEY",
            "-in",
            str(file_path),
            "-out",
            str(encrypted_path),
        ]
        env = os.environ.copy()
        env["BACKUP_ENCRYPTION_KEY"] = encryption_key
        completed = subprocess.run(cmd, capture_output=True, text=True, env=env)
        if completed.returncode != 0:
            raise RuntimeError(f"openssl encryption failed: {completed.stderr.strip()}")

        file_path.unlink(missing_ok=True)
        return encrypted_path

    @staticmethod
    def _parse_safe_command(command: str, *, env_name: str) -> list[str]:
        raw = str(command or "").strip()
        if not raw:
            raise RuntimeError(f"{env_name} is empty")
        tokens = shlex.split(raw)
        if not tokens:
            raise RuntimeError(f"{env_name} has no executable")

        # Explicitly reject shell metacharacters to avoid command injection.
        blocked = {"|", "||", "&&", ";", ">", ">>", "<", "<<", "`"}
        if any(token in blocked for token in tokens):
            raise RuntimeError(f"{env_name} contains unsupported shell operators")
        return tokens

    @staticmethod
    def _s3_client():
        try:
            import boto3  # type: ignore
        except Exception as exc:  # pragma: no cover - environment dependent
            raise RuntimeError("boto3 is required for object storage uploads") from exc

        endpoint_url = os.getenv("BACKUP_S3_ENDPOINT", "").strip() or None
        region_name = os.getenv("BACKUP_S3_REGION", "").strip() or None
        access_key = os.getenv("BACKUP_S3_ACCESS_KEY", "").strip() or None
        secret_key = os.getenv("BACKUP_S3_SECRET_KEY", "").strip() or None

        return boto3.session.Session().client(
            "s3",
            endpoint_url=endpoint_url,
            region_name=region_name,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
        )

    @classmethod
    def _upload_to_object_storage(cls, file_path: pathlib.Path) -> tuple[str, str]:
        bucket = os.getenv("BACKUP_S3_BUCKET", "").strip()
        if not bucket:
            return "LOCAL", file_path.name

        client = cls._s3_client()
        prefix = os.getenv("BACKUP_S3_PREFIX", "db-backups/").strip()
        if prefix and not prefix.endswith("/"):
            prefix += "/"
        object_key = f"{prefix}{timezone.now().strftime('%Y/%m/%d')}/{file_path.name}"

        client.upload_file(str(file_path), bucket, object_key)
        return "S3", object_key

    @classmethod
    def run_database_backup(cls, created_by=None, *, attempt_key: str = "") -> BackupRecord:
        """Run one logical backup attempt.

        Celery keeps the same task id across retries.  Reusing the row for that
        id prevents a single failed schedule from creating several misleading
        failure records while still retaining the final error or artifact.
        """
        attempt_key = str(attempt_key or "").strip()
        backup_record = None
        if attempt_key:
            backup_record = BackupRecord.objects.filter(
                metadata__attempt_key=attempt_key,
            ).order_by("-created_at").first()

        now = timezone.now()
        if backup_record is None:
            backup_record = BackupRecord.objects.create(
                kind=BackupRecord.BackupKind.POSTGRES_DUMP,
                status=BackupRecord.BackupStatus.RUNNING,
                started_at=now,
                created_by=created_by,
                metadata={"attempt_key": attempt_key} if attempt_key else {},
            )
        else:
            backup_record.status = BackupRecord.BackupStatus.RUNNING
            backup_record.started_at = now
            backup_record.finished_at = None
            backup_record.duration_seconds = None
            backup_record.error_text = ""
            backup_record.save(
                update_fields=[
                    "status",
                    "started_at",
                    "finished_at",
                    "duration_seconds",
                    "error_text",
                ]
            )
        start_ts = time.monotonic()

        try:
            backup_file = cls._backup_dir() / f"erp_db_{cls._timestamp()}.dump"
            cmd = cls._build_pg_dump_command(backup_file)

            env = os.environ.copy()
            db_password = os.getenv("DB_PASSWORD", "")
            if db_password:
                env["PGPASSWORD"] = db_password

            completed = subprocess.run(cmd, capture_output=True, text=True, env=env)
            if completed.returncode != 0:
                raise RuntimeError(completed.stderr.strip() or "pg_dump failed")

            final_path = cls._maybe_encrypt(backup_file)
            checksum = cls._sha256(final_path)
            size_bytes = final_path.stat().st_size
            storage_provider, object_key = cls._upload_to_object_storage(final_path)

            finished_at = timezone.now()
            duration = int(max(1, time.monotonic() - start_ts))
            backup_record.status = BackupRecord.BackupStatus.SUCCEEDED
            backup_record.finished_at = finished_at
            backup_record.duration_seconds = duration
            backup_record.file_name = final_path.name
            backup_record.object_key = object_key
            backup_record.storage_provider = storage_provider
            backup_record.checksum_sha256 = checksum
            backup_record.size_bytes = size_bytes
            backup_record.metadata = {
                **(backup_record.metadata or {}),
                "command": " ".join(shlex.quote(c) for c in cmd),
                "encrypted": final_path.suffix.endswith(".enc"),
            }
            backup_record.save(
                update_fields=[
                    "status",
                    "finished_at",
                    "duration_seconds",
                    "file_name",
                    "object_key",
                    "storage_provider",
                    "checksum_sha256",
                    "size_bytes",
                    "metadata",
                ]
            )
            OperationalAlert.objects.filter(
                category="BACKUP",
                resolved=False,
            ).update(resolved=True, resolved_at=finished_at)
            return backup_record
        except Exception as exc:
            backup_record.status = BackupRecord.BackupStatus.FAILED
            backup_record.finished_at = timezone.now()
            backup_record.duration_seconds = int(max(1, time.monotonic() - start_ts))
            backup_record.error_text = str(exc)
            backup_record.save(update_fields=["status", "finished_at", "duration_seconds", "error_text"])
            OperationalAlert.objects.update_or_create(
                category="BACKUP",
                resolved=False,
                defaults={
                    "severity": OperationalAlert.Severity.CRITICAL,
                    "message": "Automated database backup failed",
                    "details": {
                        "backup_record_id": str(backup_record.id),
                        "error": str(exc),
                    },
                },
            )
            raise

    @classmethod
    def prune_backup_retention(cls, retention_days: int = 30) -> dict:
        cutoff = timezone.now() - dt.timedelta(days=retention_days)
        records = list(BackupRecord.objects.filter(created_at__lt=cutoff).order_by("created_at"))
        candidate_records = len(records)
        deleted_db_rows = 0
        local_deleted = 0
        local_missing = 0
        bucket = os.getenv("BACKUP_S3_BUCKET", "").strip()
        s3_deleted = 0
        s3_client = None
        active_record = None

        try:
            for record in records:
                active_record = record
                provider = str(record.storage_provider or "LOCAL").strip().upper()
                if provider == "LOCAL":
                    if not record.file_name:
                        raise RuntimeError("Local backup record has no file name.")
                    local_path = cls._backup_dir() / record.file_name
                    if local_path.exists():
                        local_path.unlink(missing_ok=True)
                        local_deleted += 1
                    else:
                        local_missing += 1
                elif provider == "S3":
                    if not bucket:
                        raise RuntimeError(
                            "BACKUP_S3_BUCKET is required to prune an S3 backup record."
                        )
                    if not record.object_key:
                        raise RuntimeError("S3 backup record has no object key.")
                    if s3_client is None:
                        s3_client = cls._s3_client()
                    s3_client.delete_object(Bucket=bucket, Key=record.object_key)
                    s3_deleted += 1
                else:
                    raise RuntimeError(f"Unsupported backup storage provider: {provider}")

                # Delete the audit row only after its external artifact has
                # either been removed or confirmed absent. A retry is then
                # idempotent and never loses the evidence needed to recover.
                record.delete()
                deleted_db_rows += 1
        except Exception as exc:
            record_id = str(getattr(active_record, "id", "") or "")
            alert_defaults = {
                "severity": OperationalAlert.Severity.CRITICAL,
                "message": "Automated backup retention failed",
                "details": {
                    "backup_record_id": record_id,
                    "provider": str(getattr(active_record, "storage_provider", "") or ""),
                    "error_type": type(exc).__name__,
                    "error": str(exc)[:2000],
                },
            }
            alert = (
                OperationalAlert.objects.filter(category="BACKUP_RETENTION", resolved=False)
                .order_by("-created_at")
                .first()
            )
            if alert is None:
                OperationalAlert.objects.create(category="BACKUP_RETENTION", **alert_defaults)
            else:
                alert.severity = alert_defaults["severity"]
                alert.message = alert_defaults["message"]
                alert.details = alert_defaults["details"]
                alert.save(update_fields=["severity", "message", "details"])
            raise RuntimeError(
                f"Backup retention failed for record {record_id or 'unknown'}: {exc}"
            ) from exc

        finished_at = timezone.now()
        OperationalAlert.objects.filter(
            category="BACKUP_RETENTION",
            resolved=False,
        ).update(resolved=True, resolved_at=finished_at)

        return {
            "candidate_records": candidate_records,
            "deleted_records": deleted_db_rows,
            "deleted_local_files": local_deleted,
            "missing_local_files": local_missing,
            "deleted_s3_objects": s3_deleted,
            "retention_days": retention_days,
        }

    @classmethod
    def run_restore_drill(cls) -> RestoreDrillRecord:
        latest_backup: Optional[BackupRecord] = (
            BackupRecord.objects.filter(status=BackupRecord.BackupStatus.SUCCEEDED)
            .order_by("-created_at")
            .first()
        )

        record = RestoreDrillRecord.objects.create(
            backup_record=latest_backup,
            status=RestoreDrillRecord.RestoreStatus.RUNNING,
            started_at=timezone.now(),
            smoke_test_command=os.getenv("DR_SMOKE_TEST_COMMAND", "venv_311/bin/python manage.py check"),
            notes="Automated restore drill execution",
        )

        start_ts = time.monotonic()
        try:
            restore_cmd = os.getenv("DR_RESTORE_DRILL_COMMAND", "").strip()
            if not restore_cmd:
                record.status = RestoreDrillRecord.RestoreStatus.SKIPPED
                record.notes = "DR_RESTORE_DRILL_COMMAND is not configured; restore step skipped."
            else:
                restore_tokens = cls._parse_safe_command(
                    restore_cmd,
                    env_name="DR_RESTORE_DRILL_COMMAND",
                )
                completed_restore = subprocess.run(restore_tokens, capture_output=True, text=True)
                if completed_restore.returncode != 0:
                    raise RuntimeError(f"Restore command failed: {completed_restore.stderr.strip()}")

                smoke_cmd = (record.smoke_test_command or "").strip()
                if smoke_cmd:
                    smoke_tokens = cls._parse_safe_command(
                        smoke_cmd,
                        env_name="DR_SMOKE_TEST_COMMAND",
                    )
                    smoke = subprocess.run(smoke_tokens, capture_output=True, text=True)
                    record.smoke_test_passed = smoke.returncode == 0
                    if smoke.returncode != 0:
                        raise RuntimeError(f"Smoke test failed: {smoke.stderr.strip()}")

                record.status = RestoreDrillRecord.RestoreStatus.SUCCEEDED

            finished_at = timezone.now()
            record.finished_at = finished_at
            record.duration_seconds = int(max(1, time.monotonic() - start_ts))
            if latest_backup and latest_backup.created_at:
                record.rpo_minutes = int((finished_at - latest_backup.created_at).total_seconds() / 60)
            record.rto_minutes = int(record.duration_seconds / 60)
            record.save(
                update_fields=[
                    "status",
                    "notes",
                    "finished_at",
                    "duration_seconds",
                    "rpo_minutes",
                    "rto_minutes",
                    "smoke_test_passed",
                ]
            )
            return record
        except Exception as exc:
            record.status = RestoreDrillRecord.RestoreStatus.FAILED
            record.error_text = str(exc)
            record.finished_at = timezone.now()
            record.duration_seconds = int(max(1, time.monotonic() - start_ts))
            if latest_backup and latest_backup.created_at:
                record.rpo_minutes = int((record.finished_at - latest_backup.created_at).total_seconds() / 60)
            record.rto_minutes = int(record.duration_seconds / 60)
            record.save(
                update_fields=[
                    "status",
                    "error_text",
                    "finished_at",
                    "duration_seconds",
                    "rpo_minutes",
                    "rto_minutes",
                ]
            )
            raise
