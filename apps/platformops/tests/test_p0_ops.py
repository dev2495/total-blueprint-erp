import tempfile
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from apps.platformops.models import BackupRecord
from apps.platformops.services.backup_service import BackupService
from apps.platformops.services.metrics_service import OpsMetricsService
from apps.users.models import Notification, NotificationDeliveryAttempt


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
