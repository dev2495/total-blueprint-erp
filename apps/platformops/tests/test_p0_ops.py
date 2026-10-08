import tempfile
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from apps.materials.models import CommercialFamily, InventoryMaterial
from apps.platformops.models import BackupRecord, OperationalAlert
from apps.platformops.services.backup_service import BackupService
from apps.platformops.services.metrics_service import OpsMetricsService
from apps.users.models import Notification, NotificationDeliveryAttempt, NotificationRule, Role, User


class PlatformOpsP0Tests(TestCase):
    def test_metrics_summary_contract(self):
        notification = Notification.objects.create(
            type="SYSTEM",
            title="Ops event",
            message="Ops message",
            priority="NORMAL",
            channels=["IN_APP"],
        )
        NotificationDeliveryAttempt.objects.create(
            notification=notification,
            channel="IN_APP",
            status="SUCCEEDED",
            attempt_no=1,
        )

        summary = OpsMetricsService.summary()
        self.assertIn("backups", summary)
        self.assertIn("restore_drills", summary)
        self.assertIn("notifications", summary)
        self.assertIn("delivery_success_rate_pct", summary["notifications"])

    def test_backup_retention_prunes_old_local_artifacts(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            local_file = Path(tmpdir) / "old_backup.dump"
            local_file.write_bytes(b"backup")

            old_record = BackupRecord.objects.create(
                status=BackupRecord.BackupStatus.SUCCEEDED,
                storage_provider="LOCAL",
                file_name="old_backup.dump",
            )
            BackupRecord.objects.filter(id=old_record.id).update(
                created_at=timezone.now() - timedelta(days=40)
            )

            fresh_record = BackupRecord.objects.create(
                status=BackupRecord.BackupStatus.SUCCEEDED,
                storage_provider="LOCAL",
                file_name="new_backup.dump",
            )

            with patch.dict("os.environ", {"BACKUP_LOCAL_DIR": tmpdir, "BACKUP_S3_BUCKET": ""}, clear=False):
                result = BackupService.prune_backup_retention(retention_days=30)

            self.assertEqual(result["deleted_records"], 1)
            self.assertFalse(local_file.exists())
            self.assertTrue(BackupRecord.objects.filter(id=fresh_record.id).exists())

    def test_backup_retention_fails_closed_and_retries_s3_deletion(self):
        old_record = BackupRecord.objects.create(
            status=BackupRecord.BackupStatus.SUCCEEDED,
            storage_provider="S3",
            file_name="old_backup.dump.enc",
            object_key="db-backups/old_backup.dump.enc",
        )
        BackupRecord.objects.filter(id=old_record.id).update(
            created_at=timezone.now() - timedelta(days=40)
        )

        with patch.dict(
            "os.environ",
            {"BACKUP_S3_BUCKET": "test-backup-bucket", "BACKUP_S3_REGION": "ap-south-1"},
            clear=False,
        ), patch.object(BackupService, "_s3_client") as client_factory:
            client_factory.return_value.delete_object.side_effect = RuntimeError("s3 unavailable")
            with self.assertRaisesRegex(RuntimeError, str(old_record.id)):
                BackupService.prune_backup_retention(retention_days=30)

        self.assertTrue(BackupRecord.objects.filter(id=old_record.id).exists())
        alert = OperationalAlert.objects.get(category="BACKUP_RETENTION", resolved=False)
        self.assertEqual(alert.severity, OperationalAlert.Severity.CRITICAL)
        self.assertEqual(alert.details["backup_record_id"], str(old_record.id))

        with patch.dict(
            "os.environ",
            {"BACKUP_S3_BUCKET": "test-backup-bucket", "BACKUP_S3_REGION": "ap-south-1"},
            clear=False,
        ), patch.object(BackupService, "_s3_client") as client_factory:
            result = BackupService.prune_backup_retention(retention_days=30)

        client_factory.return_value.delete_object.assert_called_once_with(
            Bucket="test-backup-bucket",
            Key="db-backups/old_backup.dump.enc",
        )
        self.assertEqual(result["deleted_records"], 1)
        self.assertEqual(result["deleted_s3_objects"], 1)
        self.assertFalse(BackupRecord.objects.filter(id=old_record.id).exists())
        self.assertFalse(
            OperationalAlert.objects.filter(category="BACKUP_RETENTION", resolved=False).exists()
        )

    def test_backup_retention_keeps_untraceable_local_record(self):
        old_record = BackupRecord.objects.create(
            status=BackupRecord.BackupStatus.SUCCEEDED,
            storage_provider="LOCAL",
            file_name="",
        )
        BackupRecord.objects.filter(id=old_record.id).update(
            created_at=timezone.now() - timedelta(days=40)
        )

        with self.assertRaisesRegex(RuntimeError, "no file name"):
            BackupService.prune_backup_retention(retention_days=30)

        self.assertTrue(BackupRecord.objects.filter(id=old_record.id).exists())
        alert = OperationalAlert.objects.get(category="BACKUP_RETENTION", resolved=False)
        self.assertEqual(alert.details["backup_record_id"], str(old_record.id))

    def test_backup_retention_preserves_terminal_failure_audit_and_continues_pruning_artifacts(self):
        now = timezone.now()
        failed_record = BackupRecord.objects.create(
            status=BackupRecord.BackupStatus.FAILED,
            storage_provider="LOCAL",
            finished_at=now - timedelta(days=40),
            error_text="pg_dump unavailable",
        )
        BackupRecord.objects.filter(id=failed_record.id).update(created_at=now - timedelta(days=40))
        with tempfile.TemporaryDirectory() as tmpdir:
            artifact = Path(tmpdir) / "expired.dump"
            artifact.write_bytes(b"old successful backup")
            successful_record = BackupRecord.objects.create(
                status=BackupRecord.BackupStatus.SUCCEEDED,
                storage_provider="LOCAL",
                file_name=artifact.name,
            )
            BackupRecord.objects.filter(id=successful_record.id).update(created_at=now - timedelta(days=39))
            with patch.dict("os.environ", {"BACKUP_LOCAL_DIR": tmpdir}, clear=False):
                result = BackupService.prune_backup_retention(retention_days=30)

            self.assertEqual(result["deleted_records"], 1)
            self.assertEqual(result["deleted_local_files"], 1)
            self.assertEqual(result["skipped_failed_attempts"], 1)
            self.assertFalse(artifact.exists())
        self.assertTrue(BackupRecord.objects.filter(id=failed_record.id).exists())
        self.assertFalse(BackupRecord.objects.filter(id=successful_record.id).exists())

    def test_backup_retention_keeps_active_attempts_and_their_artifacts(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            artifact = Path(tmpdir) / "retry.dump"
            artifact.write_bytes(b"previous retry artifact")
            records = [
                BackupRecord.objects.create(status=status, file_name=artifact.name)
                for status in (BackupRecord.BackupStatus.PENDING, BackupRecord.BackupStatus.RUNNING)
            ]
            BackupRecord.objects.filter(id__in=[record.id for record in records]).update(
                created_at=timezone.now() - timedelta(days=40)
            )
            with patch.dict("os.environ", {"BACKUP_LOCAL_DIR": tmpdir}, clear=False):
                result = BackupService.prune_backup_retention(retention_days=30)
            self.assertEqual(result["deleted_records"], 0)
            self.assertEqual(result["skipped_active_attempts"], 2)
            self.assertTrue(artifact.exists())
            self.assertEqual(BackupRecord.objects.filter(id__in=[record.id for record in records]).count(), 2)

    def test_backup_retention_keeps_failed_record_with_unlocated_artifact_evidence(self):
        record = BackupRecord.objects.create(
            status=BackupRecord.BackupStatus.FAILED,
            finished_at=timezone.now(),
            checksum_sha256="abc123",
            size_bytes=25,
        )
        BackupRecord.objects.filter(id=record.id).update(created_at=timezone.now() - timedelta(days=40))
        with self.assertRaisesRegex(RuntimeError, "no file name"):
            BackupService.prune_backup_retention(retention_days=30)
        self.assertTrue(BackupRecord.objects.filter(id=record.id).exists())

    def test_backup_retry_reuses_one_record_and_resolves_failure_alert(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            failed = SimpleNamespace(returncode=1, stderr="pg_dump unavailable")

            with patch.dict(
                "os.environ",
                {
                    "BACKUP_LOCAL_DIR": tmpdir,
                    "BACKUP_S3_BUCKET": "",
                    "BACKUP_ENCRYPTION_KEY": "",
                },
                clear=False,
            ), patch(
                "apps.platformops.services.backup_service.subprocess.run",
                return_value=failed,
            ):
                with self.assertRaises(RuntimeError):
                    BackupService.run_database_backup(attempt_key="celery-task-1")

            self.assertEqual(BackupRecord.objects.count(), 1)
            alert = OperationalAlert.objects.get(category="BACKUP", resolved=False)
            self.assertEqual(alert.severity, OperationalAlert.Severity.CRITICAL)

            def successful_dump(cmd, **_kwargs):
                output_path = Path(cmd[cmd.index("-f") + 1])
                output_path.write_bytes(b"valid postgres custom dump")
                return SimpleNamespace(returncode=0, stderr="")

            with patch.dict(
                "os.environ",
                {
                    "BACKUP_LOCAL_DIR": tmpdir,
                    "BACKUP_S3_BUCKET": "",
                    "BACKUP_ENCRYPTION_KEY": "",
                },
                clear=False,
            ), patch(
                "apps.platformops.services.backup_service.subprocess.run",
                side_effect=successful_dump,
            ):
                record = BackupService.run_database_backup(attempt_key="celery-task-1")

            self.assertEqual(BackupRecord.objects.count(), 1)
            self.assertEqual(record.status, BackupRecord.BackupStatus.SUCCEEDED)
            self.assertTrue(record.checksum_sha256)
            self.assertEqual(record.metadata["attempt_key"], "celery-task-1")
            self.assertFalse(OperationalAlert.objects.filter(category="BACKUP", resolved=False).exists())

    def test_overlapping_backups_in_same_second_preserve_distinct_complete_artifacts(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            overlapping_records = []
            calls = []

            def overlapping_dump(cmd, **_kwargs):
                output_path = Path(cmd[cmd.index("-f") + 1])
                calls.append(output_path)
                self.assertTrue(output_path.name.endswith(".dump.partial"))
                payload = b"outer backup" if len(calls) == 1 else b"inner backup"
                output_path.write_bytes(payload)
                if len(calls) == 1:
                    overlapping_records.append(BackupService.run_database_backup(attempt_key="inner-attempt"))
                return SimpleNamespace(returncode=0, stderr="")

            with patch.dict("os.environ", {"BACKUP_LOCAL_DIR": tmpdir, "BACKUP_S3_BUCKET": "", "BACKUP_ENCRYPTION_KEY": ""}, clear=False), patch.object(
                BackupService, "_timestamp", return_value="20261007_120000"
            ), patch("apps.platformops.services.backup_service.subprocess.run", side_effect=overlapping_dump):
                outer = BackupService.run_database_backup(attempt_key="outer-attempt")
            inner = overlapping_records[0]
            self.assertNotEqual(outer.file_name, inner.file_name)
            self.assertEqual((Path(tmpdir) / outer.file_name).read_bytes(), b"outer backup")
            self.assertEqual((Path(tmpdir) / inner.file_name).read_bytes(), b"inner backup")
            self.assertNotEqual(outer.checksum_sha256, inner.checksum_sha256)
            self.assertFalse(list(Path(tmpdir).glob("*.partial*")))

    def test_failed_upload_keeps_published_artifact_and_intended_remote_key(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            def successful_dump(cmd, **_kwargs):
                Path(cmd[cmd.index("-f") + 1]).write_bytes(b"complete backup")
                return SimpleNamespace(returncode=0, stderr="")

            with patch.dict("os.environ", {"BACKUP_LOCAL_DIR": tmpdir, "BACKUP_S3_BUCKET": "test-bucket", "BACKUP_S3_PREFIX": "backups", "BACKUP_ENCRYPTION_KEY": ""}, clear=False), patch(
                "apps.platformops.services.backup_service.subprocess.run", side_effect=successful_dump
            ), patch.object(BackupService, "_s3_client") as client_factory:
                client_factory.return_value.upload_file.side_effect = RuntimeError("Upload response lost")
                with self.assertRaisesRegex(RuntimeError, "Upload response lost"):
                    BackupService.run_database_backup(attempt_key="failed-upload")
            failed = BackupRecord.objects.get(metadata__attempt_key="failed-upload")
            self.assertEqual(failed.status, BackupRecord.BackupStatus.FAILED)
            self.assertEqual(failed.storage_provider, "S3")
            self.assertTrue(failed.object_key.startswith("backups/"))
            self.assertTrue(failed.object_key.endswith(failed.file_name))
            self.assertEqual((Path(tmpdir) / failed.file_name).read_bytes(), b"complete backup")
            self.assertTrue(failed.checksum_sha256)
            self.assertFalse(list(Path(tmpdir).glob("*.partial*")))

    def test_ambiguous_upload_retry_reuses_artifact_key_and_original_snapshot_date(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            original_time = timezone.now() - timedelta(days=2)
            remote_objects = {}

            def successful_dump(cmd, **_kwargs):
                Path(cmd[cmd.index("-f") + 1]).write_bytes(b"original snapshot")
                return SimpleNamespace(returncode=0, stderr="")

            def ambiguous_upload(file_path, _bucket, key):
                remote_objects[key] = Path(file_path).read_bytes()
                if len(client_factory.return_value.upload_file.call_args_list) == 1:
                    raise RuntimeError("Upload acknowledgment lost")

            with patch.dict("os.environ", {"BACKUP_LOCAL_DIR": tmpdir, "BACKUP_S3_BUCKET": "same-bucket", "BACKUP_S3_PREFIX": "original-prefix", "BACKUP_ENCRYPTION_KEY": ""}, clear=False), patch(
                "apps.platformops.services.backup_service.subprocess.run", side_effect=successful_dump
            ) as dump, patch.object(BackupService, "_s3_client") as client_factory:
                client_factory.return_value.upload_file.side_effect = ambiguous_upload
                with patch("apps.platformops.services.backup_service.timezone.now", return_value=original_time):
                    with self.assertRaisesRegex(RuntimeError, "acknowledgment lost"):
                        BackupService.run_database_backup(attempt_key="ambiguous-same-attempt")
                failed = BackupRecord.objects.get(metadata__attempt_key="ambiguous-same-attempt")
                original_name, original_key = failed.file_name, failed.object_key
                with patch.dict("os.environ", {"BACKUP_S3_PREFIX": "changed-prefix"}, clear=False):
                    retried = BackupService.run_database_backup(attempt_key="ambiguous-same-attempt")
                replayed = BackupService.run_database_backup(attempt_key="ambiguous-same-attempt")

                self.assertEqual(dump.call_count, 1)
                self.assertEqual(client_factory.return_value.upload_file.call_count, 2)
                self.assertEqual(retried.pk, failed.pk)
                self.assertEqual(replayed.pk, failed.pk)
                self.assertEqual(retried.file_name, original_name)
                self.assertEqual(retried.object_key, original_key)
                self.assertEqual(retried.started_at, original_time)
                self.assertEqual(retried.finished_at, original_time)
                self.assertEqual(replayed.finished_at, original_time)
                self.assertEqual(remote_objects, {original_key: b"original snapshot"})
                self.assertEqual([path.name for path in Path(tmpdir).iterdir()], [original_name])
                self.assertFalse(OperationalAlert.objects.filter(category="BACKUP", resolved=False).exists())

    def test_upload_retry_fails_closed_when_original_completed_artifact_changes(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            def successful_dump(cmd, **_kwargs):
                Path(cmd[cmd.index("-f") + 1]).write_bytes(b"complete backup")
                return SimpleNamespace(returncode=0, stderr="")

            with patch.dict("os.environ", {"BACKUP_LOCAL_DIR": tmpdir, "BACKUP_S3_BUCKET": "test-bucket", "BACKUP_ENCRYPTION_KEY": ""}, clear=False), patch(
                "apps.platformops.services.backup_service.subprocess.run", side_effect=successful_dump
            ) as dump, patch.object(BackupService, "_s3_client") as client_factory:
                client_factory.return_value.upload_file.side_effect = RuntimeError("Upload failed")
                with self.assertRaisesRegex(RuntimeError, "Upload failed"):
                    BackupService.run_database_backup(attempt_key="corrupt-retry")
                failed = BackupRecord.objects.get(metadata__attempt_key="corrupt-retry")
                original_name, original_key, original_hash = failed.file_name, failed.object_key, failed.checksum_sha256
                (Path(tmpdir) / failed.file_name).write_bytes(b"altered snapshot")
                with self.assertRaisesRegex(RuntimeError, "checksum or size verification"):
                    BackupService.run_database_backup(attempt_key="corrupt-retry")
                failed.refresh_from_db()
                self.assertEqual(dump.call_count, 1)
                self.assertEqual(client_factory.return_value.upload_file.call_count, 1)
                self.assertEqual((failed.file_name, failed.object_key, failed.checksum_sha256), (original_name, original_key, original_hash))

    def test_s3_retention_deletes_owned_local_mirror_after_remote_and_retries_local_failure(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            local_artifact = Path(tmpdir) / "expired-s3.dump"
            local_artifact.write_bytes(b"complete local mirror")
            record = BackupRecord.objects.create(
                status=BackupRecord.BackupStatus.SUCCEEDED, storage_provider="S3", file_name=local_artifact.name,
                object_key="original/expired-s3.dump", metadata={"storage_bucket": "same-bucket"},
            )
            BackupRecord.objects.filter(id=record.id).update(created_at=timezone.now() - timedelta(days=40))
            with patch.dict("os.environ", {"BACKUP_LOCAL_DIR": tmpdir, "BACKUP_S3_BUCKET": "same-bucket"}, clear=False), patch.object(
                BackupService, "_s3_client"
            ) as client_factory:
                client_factory.return_value.delete_object.side_effect = RuntimeError("Remote removal failed")
                with self.assertRaisesRegex(RuntimeError, "Remote removal failed"):
                    BackupService.prune_backup_retention()
                self.assertTrue(local_artifact.exists())
                self.assertTrue(BackupRecord.objects.filter(id=record.id).exists())
                client_factory.return_value.delete_object.side_effect = None
                with patch.object(Path, "unlink", side_effect=PermissionError("Local removal failed")):
                    with self.assertRaisesRegex(RuntimeError, "Local removal failed"):
                        BackupService.prune_backup_retention()
                self.assertTrue(local_artifact.exists())
                self.assertTrue(BackupRecord.objects.filter(id=record.id).exists())
                result = BackupService.prune_backup_retention()
                self.assertEqual(client_factory.return_value.delete_object.call_count, 3)
                self.assertEqual(result["deleted_s3_objects"], 1)
                self.assertEqual(result["deleted_local_files"], 1)
                self.assertFalse(local_artifact.exists())
                self.assertFalse(BackupRecord.objects.filter(id=record.id).exists())

    def test_same_logical_attempt_cannot_restart_an_active_backup(self):
        record = BackupRecord.objects.create(
            status=BackupRecord.BackupStatus.RUNNING, started_at=timezone.now(), metadata={"attempt_key": "active-attempt"},
        )
        with patch("apps.platformops.services.backup_service.subprocess.run") as dump:
            with self.assertRaisesRegex(RuntimeError, "already running"):
                BackupService.run_database_backup(attempt_key="active-attempt")
            dump.assert_not_called()
        record.refresh_from_db()
        self.assertEqual(record.status, BackupRecord.BackupStatus.RUNNING)
        self.assertEqual(BackupRecord.objects.count(), 1)

    def test_successful_attempt_replay_verifies_local_artifact_without_new_dump(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            def successful_dump(cmd, **_kwargs):
                Path(cmd[cmd.index("-f") + 1]).write_bytes(b"complete backup")
                return SimpleNamespace(returncode=0, stderr="")

            with patch.dict("os.environ", {"BACKUP_LOCAL_DIR": tmpdir, "BACKUP_S3_BUCKET": "", "BACKUP_ENCRYPTION_KEY": ""}, clear=False), patch(
                "apps.platformops.services.backup_service.subprocess.run", side_effect=successful_dump
            ) as dump:
                original = BackupService.run_database_backup(attempt_key="already-successful")
                replayed = BackupService.run_database_backup(attempt_key="already-successful")
                self.assertEqual(replayed.pk, original.pk)
                self.assertEqual(replayed.file_name, original.file_name)
                self.assertEqual(replayed.finished_at, original.finished_at)
                self.assertEqual(dump.call_count, 1)
                (Path(tmpdir) / original.file_name).write_bytes(b"corrupted")
                with self.assertRaisesRegex(RuntimeError, "checksum or size verification"):
                    BackupService.run_database_backup(attempt_key="already-successful")
                self.assertEqual(dump.call_count, 1)

    def test_metrics_reports_backup_freshness(self):
        BackupRecord.objects.create(
            status=BackupRecord.BackupStatus.SUCCEEDED,
            started_at=timezone.now(),
            finished_at=timezone.now(),
            file_name="fresh.dump",
        )

        with patch.dict("os.environ", {"BACKUP_MAX_AGE_HOURS": "6"}, clear=False):
            summary = OpsMetricsService.summary()

        self.assertTrue(summary["backups"]["fresh"])
        self.assertLessEqual(summary["backups"]["age_hours"], 0.01)

    def test_backup_encryption_key_is_not_exposed_in_process_arguments(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            source = Path(tmpdir) / "backup.dump"
            source.write_bytes(b"postgres dump")
            captured = {}

            def successful_encrypt(cmd, **kwargs):
                captured["cmd"] = cmd
                captured["env"] = kwargs["env"]
                output_path = Path(cmd[cmd.index("-out") + 1])
                output_path.write_bytes(b"encrypted postgres dump")
                return SimpleNamespace(returncode=0, stderr="")

            with patch.dict(
                "os.environ",
                {"BACKUP_ENCRYPTION_KEY": "sensitive-test-key"},
                clear=False,
            ), patch(
                "apps.platformops.services.backup_service.subprocess.run",
                side_effect=successful_encrypt,
            ):
                encrypted = BackupService._maybe_encrypt(source)

            self.assertTrue(encrypted.exists())
            self.assertNotIn("sensitive-test-key", " ".join(captured["cmd"]))
            self.assertEqual(captured["env"]["BACKUP_ENCRYPTION_KEY"], "sensitive-test-key")

    def test_parse_safe_command_rejects_shell_operators(self):
        with self.assertRaises(RuntimeError):
            BackupService._parse_safe_command("echo ok | cat", env_name="DR_RESTORE_DRILL_COMMAND")

        parsed = BackupService._parse_safe_command("echo ok", env_name="DR_RESTORE_DRILL_COMMAND")
        self.assertEqual(parsed, ["echo", "ok"])

    def test_restore_drill_runs_without_shell_true(self):
        completed = SimpleNamespace(returncode=0, stderr="")
        with tempfile.TemporaryDirectory() as tmpdir, patch.dict(
            "os.environ",
            {
                "BACKUP_LOCAL_DIR": tmpdir,
                "DR_RESTORE_DRILL_COMMAND": "echo restore-ok",
                "DR_SMOKE_TEST_COMMAND": "echo smoke-ok",
            },
            clear=False,
        ), patch("apps.platformops.services.backup_service.subprocess.run", return_value=completed) as run_mock:
            artifact = Path(tmpdir) / "selected_backup.dump"
            artifact.write_bytes(b"verified backup")
            backup = BackupRecord.objects.create(
                status=BackupRecord.BackupStatus.SUCCEEDED, storage_provider="LOCAL",
                file_name=artifact.name, object_key=artifact.name,
                checksum_sha256=BackupService._sha256(artifact), size_bytes=artifact.stat().st_size,
            )
            record = BackupService.run_restore_drill()

        self.assertEqual(record.status, record.RestoreStatus.SUCCEEDED)
        self.assertEqual(record.backup_record_id, backup.id)
        self.assertEqual([call.args[0] for call in run_mock.call_args_list], [["echo", "restore-ok"], ["echo", "smoke-ok"]])
        for call in run_mock.call_args_list:
            self.assertTrue(call.kwargs["capture_output"])
            self.assertTrue(call.kwargs["text"])
            self.assertNotIn("shell", call.kwargs)
            self.assertEqual(call.kwargs["env"]["RESTORE_BACKUP_PATH"], str(artifact.resolve()))
            self.assertEqual(call.kwargs["env"]["RESTORE_BACKUP_SHA256"], backup.checksum_sha256)

    def test_bootstrap_render_production_baseline_seeds_only_repo_safe_defaults(self):
        call_command("bootstrap_render_production_baseline", allow_production=True)

        self.assertTrue(Role.objects.filter(code="OWNER").exists())
        self.assertTrue(Role.objects.filter(code="SUPER_ADMIN").exists())
        self.assertTrue(CommercialFamily.objects.filter(code="PET_PRINT_WEB").exists())
        self.assertEqual(InventoryMaterial.objects.filter(category="POD").count(), 2)
        self.assertTrue(NotificationRule.objects.filter(event_key="reports.daily_pack_generated").exists())
        self.assertTrue(NotificationRule.objects.filter(event_key="inventory.transfer_created").exists())
        self.assertTrue(NotificationRule.objects.filter(event_key="production.next_step_ready").exists())
        self.assertEqual(Notification.objects.count(), 0)

    def test_bootstrap_render_launch_users_creates_named_access_accounts(self):
        call_command(
            "bootstrap_render_launch_users",
            allow_production=True,
            devarsh_password="TempPass123!",
            chirag_email="chirag@example.com",
            chirag_password="TempPass456!",
        )

        devarsh = User.objects.get(email="dvrshthakkar@gmail.com")
        chirag = User.objects.get(email="chirag@example.com")

        self.assertEqual(devarsh.role.code, "SUPER_ADMIN")
        self.assertTrue(devarsh.is_superuser)
        self.assertTrue(devarsh.is_staff)
        self.assertTrue(devarsh.is_owner)

        self.assertEqual(chirag.role.code, "OWNER")
        self.assertFalse(chirag.is_superuser)
        self.assertFalse(chirag.is_staff)
        self.assertTrue(chirag.is_owner)
