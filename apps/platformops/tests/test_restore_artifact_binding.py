import os
import subprocess
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from django.conf import settings
from django.test import TestCase

from apps.platformops.models import BackupRecord, RestoreDrillRecord
from apps.platformops.services.backup_service import BackupService


class RestoreArtifactBindingTests(TestCase):
    def _backup(self, directory, name, content):
        artifact = directory / name
        artifact.write_bytes(content)
        record = BackupRecord.objects.create(
            status=BackupRecord.BackupStatus.SUCCEEDED, storage_provider="LOCAL",
            file_name=name, object_key=name, size_bytes=len(content),
            checksum_sha256=BackupService._sha256(artifact),
        )
        return record, artifact

    def test_explicit_record_remains_bound_when_a_newer_backup_exists(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            chosen, chosen_path = self._backup(Path(tmpdir), "erp_db_20261007_120000_z_nonce.dump", b"chosen snapshot")
            newer, _ = self._backup(Path(tmpdir), "erp_db_20261007_120000_a_nonce.dump", b"other snapshot")
            completed = SimpleNamespace(returncode=0, stderr="", stdout="TPP_RESTORE_SMOKE_PASS\n")
            with patch.dict(os.environ, {
                "BACKUP_LOCAL_DIR": tmpdir, "DR_RESTORE_DRILL_COMMAND": "restore-test",
                "DR_SMOKE_TEST_COMMAND": "RESTORED_DATABASE",
                "RESTORE_BACKUP_PATH": "untrusted inherited path",
            }), patch("apps.platformops.services.backup_service.subprocess.run", return_value=completed) as run:
                drill = BackupService.run_restore_drill(backup_record=chosen)
                self.assertEqual(os.environ["RESTORE_BACKUP_PATH"], "untrusted inherited path")
                env = run.call_args.kwargs["env"]
                self.assertEqual(env["RESTORE_BACKUP_PATH"], str(chosen_path.resolve()))
                self.assertEqual(env["RESTORE_BACKUP_SHA256"], chosen.checksum_sha256)
                self.assertEqual(env["RESTORE_BACKUP_ID"], str(chosen.id))
            self.assertEqual(drill.backup_record_id, chosen.id)
            self.assertNotEqual(drill.backup_record_id, newer.id)
            self.assertEqual(drill.status, RestoreDrillRecord.RestoreStatus.SUCCEEDED)

    def test_invalid_selected_artifact_fails_before_any_restore_command(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            chosen, chosen_path = self._backup(Path(tmpdir), "erp_db_20261007_120000_nonce.dump", b"chosen snapshot")
            chosen_path.write_bytes(b"changed snapshot")
            with patch.dict(os.environ, {
                "BACKUP_LOCAL_DIR": tmpdir, "DR_RESTORE_DRILL_COMMAND": "restore-test",
            }), patch("apps.platformops.services.backup_service.subprocess.run") as run:
                with self.assertRaisesRegex(RuntimeError, "checksum or size"):
                    BackupService.run_restore_drill(backup_record=chosen)
                run.assert_not_called()
            drill = RestoreDrillRecord.objects.get(backup_record=chosen)
            self.assertEqual(drill.status, RestoreDrillRecord.RestoreStatus.FAILED)

    def _shell_drill(self, root, selected_path, checksum):
        binaries = root / "bin"
        binaries.mkdir(exist_ok=True)
        trace = root / "restore-trace"
        stubs = {
            "pg_restore": '#!/bin/sh\nfor file do :; done\ncat "$file" >> "$RESTORE_TRACE"\nprintf "\\n" >> "$RESTORE_TRACE"\n',
            "createdb": '#!/bin/sh\necho CREATED >> "$RESTORE_TRACE"\n',
            "dropdb": '#!/bin/sh\nexit 0\n',
            "psql": '#!/bin/sh\necho 1\n',
            "python": '#!/bin/sh\necho TPP_RESTORE_SMOKE_PASS\n',
        }
        for name, body in stubs.items():
            executable = binaries / name
            executable.write_text(body)
            executable.chmod(0o700)
        env = {
            **os.environ, "PATH": f"{binaries}{os.pathsep}{os.environ['PATH']}",
            "BACKUP_LOCAL_DIR": str(root / "backups"),
            "RESTORE_BACKUP_PATH": str(selected_path), "RESTORE_BACKUP_SHA256": checksum,
            "RESTORE_TRACE": str(trace),
        }
        completed = subprocess.run(
            ["sh", str(Path(settings.BASE_DIR) / "deploy/aws/restore-drill.sh")],
            env=env, capture_output=True, text=True, timeout=15,
        )
        return completed, trace.read_text() if trace.exists() else ""

    def test_actual_shell_restores_selected_record_not_lexicographic_nonce(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            backups = root / "backups"
            backups.mkdir()
            self._backup(backups, "erp_db_20261007_120000_z_nonce.dump", b"wrong lexicographic snapshot")
            chosen, chosen_path = self._backup(backups, "erp_db_20261007_120000_a_nonce.dump", b"selected latest record")
            (backups / "erp_db_99999999_z.dump.partial").write_bytes(b"incomplete snapshot")
            completed, trace = self._shell_drill(root, chosen_path, chosen.checksum_sha256)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertEqual(trace, "selected latest record\nCREATED\nselected latest record\n")
            self.assertIn("TPP_RESTORE_SMOKE_PASS", completed.stdout)

    def test_actual_shell_rejects_checksum_mismatch_and_staging_before_restore(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            backups = root / "backups"
            backups.mkdir()
            chosen, chosen_path = self._backup(backups, "erp_db_20261007_120000_nonce.dump", b"original")
            chosen_path.write_bytes(b"tampered")
            completed, trace = self._shell_drill(root, chosen_path, chosen.checksum_sha256)
            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("SHA256 verification", completed.stderr)
            self.assertEqual(trace, "")
            partial = backups / "erp_db_20261007_120000_nonce.dump.partial"
            partial.write_bytes(b"original")
            completed, trace = self._shell_drill(root, partial, chosen.checksum_sha256)
            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("staging files are excluded", completed.stderr)
            self.assertEqual(trace, "")
