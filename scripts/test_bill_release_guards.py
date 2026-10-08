"""Independent release guard regressions; fixtures never connect to a database."""
import hashlib
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import types
import unittest
from contextlib import nullcontext
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[1]
HELPERS = REPO / "docs/releases/bill-intake-20261008"
PARENT = "72759ea64c703118a670b507b5aacfec417ae6f7"
CANDIDATE = "a" * 40
OLD = {("gate", "0001_initial"), ("gate", "0002_public_links_and_audit_guard"), ("users", "0012_watchman_role"), ("analytics", "0004_gate_register_report")}


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, HELPERS / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MigrationGuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="tpp-bill-release-guards-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        folder = self.root / "docs/releases/bill-intake-20261008"
        folder.mkdir(parents=True)
        self.migration = self.root / "apps/gate/migrations/0003_bill_fixture.py"
        self.migration.parent.mkdir(parents=True)
        self.migration.write_text("# reviewed additive fixture\n")
        digest = hashlib.sha256(self.migration.read_bytes()).hexdigest()
        (folder / "reviewed-migrations.json").write_text(json.dumps([{"app": "gate", "name": "0003_bill_fixture", "sha256": digest}]))
        (folder / "source-provenance.json").write_text(json.dumps({"deployed_parent": PARENT}))
        self.module = load("bill_migration_guard", "review-migrations.py")
        self.module.ROOT = self.root
        self.module.__file__ = str(folder / "review-migrations.py")
        self.applied = set(OLD)
        self.plan = [(types.SimpleNamespace(app_label="gate", name="0003_bill_fixture"), False)]
        self.operations = []
        self.sql = []
        executor = types.SimpleNamespace(
            migration_plan=lambda leaves: self.plan,
            loader=types.SimpleNamespace(
                applied_migrations=self.applied,
                graph=types.SimpleNamespace(leaf_nodes=lambda: []),
                get_migration=lambda app, name: types.SimpleNamespace(operations=self.operations),
            ),
        )
        django = types.ModuleType("django")
        django.setup = lambda: None
        conf = types.ModuleType("django.conf")
        conf.settings = types.SimpleNamespace(IS_PRODUCTION=True, DEBUG=False)
        db = types.ModuleType("django.db")
        db.connection = types.SimpleNamespace(vendor="postgresql", cursor=lambda: nullcontext(types.SimpleNamespace(execute=lambda statement: self.sql.append(statement))))
        db.transaction = types.SimpleNamespace(atomic=lambda: nullcontext())
        migrations = types.ModuleType("django.db.migrations.executor")
        migrations.MigrationExecutor = lambda connection: executor
        self.modules = {"django": django, "django.conf": conf, "django.db": db, "django.db.migrations.executor": migrations}

    def verify(self, proof=None):
        with patch.dict(sys.modules, self.modules), patch.dict(os.environ, {"APP_BUILD_SHA": CANDIDATE}):
            if proof is None:
                return self.module.verify(CANDIDATE)
            with patch.object(sys, "stdin", io.StringIO(json.dumps(proof))):
                return self.module.verify(CANDIDATE, True)

    def test_initial_and_already_applied_resumption(self):
        result = self.verify()
        self.assertEqual(result["reviewed_pending_migrations"], [("gate", "0003_bill_fixture")])
        self.plan.clear()
        self.applied.add(("gate", "0003_bill_fixture"))
        self.assertEqual(self.verify()["reviewed_pending_migrations"], [])
        self.assertIn("SET TRANSACTION READ ONLY", self.sql)

    def test_rejects_unrelated_pending_migration(self):
        self.plan.append((types.SimpleNamespace(app_label="sales", name="9999_unreviewed"), False))
        with self.assertRaises(RuntimeError):
            self.verify()

    def test_rejects_backward_missing_or_changed_migration(self):
        self.plan[0] = (self.plan[0][0], True)
        with self.assertRaises(RuntimeError):
            self.verify()
        self.plan.clear()
        with self.assertRaises(RuntimeError):
            self.verify()
        self.migration.write_text("# changed after review\n")
        with self.assertRaises(RuntimeError):
            self.verify()

    def test_rejects_existing_schema_loss_and_destructive_operations(self):
        self.applied.remove(("gate", "0002_public_links_and_audit_guard"))
        with self.assertRaises(RuntimeError):
            self.verify()
        self.applied.update(OLD)
        self.operations = [type("RemoveField", (), {})()]
        with self.assertRaises(RuntimeError):
            self.verify()

    def backup_fixture(self, age=10):
        directory = self.root / "managed"
        directory.mkdir(exist_ok=True)
        artifact = directory / "fixture.dump"
        artifact.write_bytes(b"selected exact artifact")
        digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
        backup = types.SimpleNamespace(id="backup-selected", status="SUCCEEDED", file_name=artifact.name, checksum_sha256=digest, size_bytes=artifact.stat().st_size, created_at=datetime.now(timezone.utc) - timedelta(seconds=age))
        restore = types.SimpleNamespace(id="restore-selected", status="SUCCEEDED", smoke_test_passed=True, backup_record_id=backup.id)
        models = types.ModuleType("apps.platformops.models")
        models.BackupRecord = types.SimpleNamespace(objects=types.SimpleNamespace(get=lambda pk: backup if pk == backup.id else None))
        models.RestoreDrillRecord = types.SimpleNamespace(objects=types.SimpleNamespace(get=lambda pk: restore if pk == restore.id else None))
        self.modules["apps.platformops.models"] = models
        self.module.Path = lambda value: directory if str(value) == "/var/backups/tpp-erp/managed" else Path(value)
        proof = {"status": "PASS", "image_build_sha": PARENT, "backup": {"id": backup.id, "checksum_sha256": digest, "size_bytes": backup.size_bytes}, "restore": {"id": restore.id, "backup_id": backup.id}}
        return proof, artifact, restore

    def test_exact_backup_binding_and_checksum(self):
        proof, artifact, restore = self.backup_fixture()
        self.assertTrue(self.verify(proof)["fresh_exact_backup_restore_verified"])
        restore.backup_record_id = "another-backup"
        with self.assertRaises(RuntimeError):
            self.verify(proof)
        restore.backup_record_id = proof["backup"]["id"]
        artifact.write_bytes(b"changed retained artifact")
        with self.assertRaises(RuntimeError):
            self.verify(proof)

    def test_stale_backup_and_wrong_parent_rejected(self):
        proof, _, _ = self.backup_fixture(age=3601)
        with self.assertRaises(RuntimeError):
            self.verify(proof)
        proof["image_build_sha"] = "b" * 40
        with self.assertRaises(RuntimeError):
            self.verify(proof)


class HostStateGuardTests(unittest.TestCase):
    def test_real_label_mount_secret_and_broker_boundaries(self):
        module = load("bill_host_guard", "readonly-host-state.py")
        with tempfile.TemporaryDirectory(prefix="tpp-bill-host-guard-") as temp:
            env, caddy = Path(temp) / "env", Path(temp) / "caddy"
            env.write_text("fixture-only-existing-key=retained\n")
            env.chmod(0o600)
            caddy.write_text("fixture unchanged trusted proxy\n")
            state = {"revision": PARENT, "noeviction": True, "running": True}
            module.APP = types.SimpleNamespace(resolve=lambda: Path("/opt/tpp-erp/releases") / state["revision"][:12])
            module.MARKER = types.SimpleNamespace(read_text=lambda: PARENT)
            module.Path = lambda value: env if str(value) == "/opt/tpp-erp/secrets/app.env" else caddy if str(value) == "/etc/caddy/Caddyfile" else Path(value)
            def inspect(name):
                command = ["redis-server", "--appendonly", "yes", "--maxmemory-policy", "noeviction" if state["noeviction"] else "allkeys-lru"]
                return {"Id": name, "Config": {"Cmd": command, "Labels": {"org.opencontainers.image.revision": state["revision"]}}, "State": {"Running": state["running"], "Health": {"Status": "healthy"}}, "Mounts": [{"Source": "/fixed-data", "Destination": "/data", "RW": True}]}
            module.inspect = inspect
            with patch.object(module.os, "geteuid", return_value=0):
                before = module.snapshot(PARENT)
                state["revision"] = CANDIDATE
                after = module.snapshot(CANDIDATE, PARENT)
                self.assertEqual(before["preserved"], after["preserved"])
                with self.assertRaises(RuntimeError):
                    module.snapshot(PARENT)
                state["noeviction"] = False
                with self.assertRaises(RuntimeError):
                    module.snapshot(CANDIDATE, PARENT)
                state["noeviction"] = True
                env.chmod(0o644)
                with self.assertRaises(RuntimeError):
                    module.snapshot(CANDIDATE, PARENT)


class ActivationShellTests(unittest.TestCase):
    """Exercise the actual shell sequencing with isolated files and fake Docker.

    Python migration/host guards are tested above. These cases exercise source
    switches, last-write marker behavior and rollback, without any host access.
    """
    def run_activation(self, failure=""):
        temporary = tempfile.TemporaryDirectory(prefix="tpp-bill-activation-")
        self.addCleanup(temporary.cleanup)
        base = Path(temporary.name).resolve()
        release_root = base / "tpp-erp"
        releases = release_root / "releases"
        old, candidate = releases / PARENT[:12], releases / CANDIDATE[:12]
        for folder in (old, candidate, base / "bin"):
            folder.mkdir(parents=True)
        (candidate / "candidate-commit").write_text(CANDIDATE + "\n")
        (candidate / "host-before.json").write_text("{}\n")
        marker = releases / "current-commit"
        marker.write_text(PARENT + "\n")
        (release_root / "app").symlink_to(old)
        proof = base / "backup-proof.json"
        proof.write_text("{}\n")
        state_file = base / "docker-state.json"
        state_file.write_text(json.dumps({"backend": PARENT, "frontend": PARENT}))
        script = base / "activate-release.sh"
        script.write_text((HELPERS / "activate-release.sh").read_text().replace("/opt/tpp-erp", str(release_root)))
        programs = {
            "docker": '''import json,os,sys
from pathlib import Path
a=sys.argv[1:]
state=Path(os.environ['MOCK_STATE'])
parent=os.environ['MOCK_PARENT']; candidate=os.environ['MOCK_CANDIDATE']
if a[:2]==['image','inspect']:
 print(parent if 'rollback-' in a[-1] else candidate)
elif a and a[0]=='tag':
 content=json.loads(state.read_text()); service='frontend' if 'frontend' in a[-1] else 'backend'
 content[service]=parent if 'rollback-' in a[1] else candidate; state.write_text(json.dumps(content))
elif a and a[0]=='exec':
 sys.stdout.write('Celery probe diagnostic line\\n'*15000)
 print('no worker response' if os.environ['MOCK_FAILURE']=='celery' else 'pong')
elif a and a[0]=='run' and 'migrate' in a and os.environ['MOCK_FAILURE']=='migration':
 sys.exit(37)
''',
            "python3": '''import os,sys
from pathlib import Path
a=sys.argv[1:]
if '--save' in a:
 p=Path(a[a.index('--save')+1]); p.write_text('{}\\n'); p.chmod(0o600)
print('{"status":"PASS","mock_host_guard":true}')
''',
            "curl": "import sys\nprint('mock healthy endpoint')\n",
            "ln": '''import os,sys
if os.environ['MOCK_FAILURE']=='source-link': sys.exit(44)
os.execv('/bin/ln',['/bin/ln',*sys.argv[1:]])
''',
        }
        for name, content in programs.items():
            executable = base / "bin" / name
            executable.write_text("#!" + sys.executable + "\n" + content)
            executable.chmod(0o755)
        env = {**os.environ, "PATH": str(base / "bin") + os.pathsep + os.environ["PATH"], "MOCK_STATE": str(state_file), "MOCK_PARENT": PARENT, "MOCK_CANDIDATE": CANDIDATE, "MOCK_FAILURE": failure}
        result = subprocess.run(["/bin/bash", str(script), CANDIDATE, PARENT, str(proof)], env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
        return result, release_root, candidate, json.loads(state_file.read_text())

    def test_success_consumes_full_celery_probe_and_writes_marker_last(self):
        result, root, candidate, state = self.run_activation()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((root / "app").resolve(), candidate)
        self.assertEqual((root / "releases/current-commit").read_text().strip(), CANDIDATE)
        self.assertEqual(set(state.values()), {CANDIDATE})
        self.assertGreater((candidate / "celery-ping.log").stat().st_size, 200000)

    def test_missing_pong_restores_exact_source_images_and_marker(self):
        result, root, _, state = self.run_activation("celery")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((root / "app").resolve(), root / "releases" / PARENT[:12])
        self.assertEqual((root / "releases/current-commit").read_text().strip(), PARENT)
        self.assertEqual(set(state.values()), {PARENT})

    def test_interrupted_source_symlink_creation_recovers_missing_app_link(self):
        result, root, _, state = self.run_activation("source-link")
        self.assertEqual(result.returncode, 44, result.stderr)
        self.assertEqual((root / "app").resolve(), root / "releases" / PARENT[:12])
        self.assertEqual((root / "releases/current-commit").read_text().strip(), PARENT)
        self.assertEqual(set(state.values()), {PARENT})

    def test_migration_failure_keeps_parent_stack_and_pointer(self):
        result, root, _, state = self.run_activation("migration")
        self.assertEqual(result.returncode, 37, result.stderr)
        self.assertEqual((root / "app").resolve(), root / "releases" / PARENT[:12])
        self.assertEqual(set(state.values()), {PARENT})


if __name__ == "__main__":
    unittest.main()
