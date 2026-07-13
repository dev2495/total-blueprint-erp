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
        with patch.dict(
            "os.environ",
            {
                "DR_RESTORE_DRILL_COMMAND": "echo restore-ok",
                "DR_SMOKE_TEST_COMMAND": "echo smoke-ok",
            },
            clear=False,
        ), patch("apps.platformops.services.backup_service.subprocess.run", return_value=completed) as run_mock:
            record = BackupService.run_restore_drill()

        self.assertEqual(record.status, record.RestoreStatus.SUCCEEDED)
        run_mock.assert_any_call(["echo", "restore-ok"], capture_output=True, text=True)
        run_mock.assert_any_call(["echo", "smoke-ok"], capture_output=True, text=True)

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
