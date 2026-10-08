#!/usr/bin/env python3
"""Test exact candidate images on disposable AWS PostgreSQL/Redis, without live data."""
import argparse
import base64
import hashlib
import json
import os
import re
import secrets
import subprocess
import time
from pathlib import Path

PARENT = "72759ea64c703118a670b507b5aacfec417ae6f7"
FOCUSED = [
    "apps.gate.tests_bills", "apps.users.tests_bill_notifications", "apps.users.tests_gate_rbac",
    "apps.users.tests_p0_notifications", "apps.analytics.tests.test_gate_reports",
    "apps.procurement.test_receipt_integrity", "apps.inventory.tests.test_stock_adjustment_lifecycle",
]


def command(arguments, **kwargs):
    return subprocess.run(arguments, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=60, **kwargs).stdout


def run(expected, mode, output):
    if os.geteuid() != 0 or not re.fullmatch(r"[0-9a-f]{40}", expected):
        raise RuntimeError("Root and the full staged candidate SHA are required.")
    if Path("/opt/tpp-erp/releases/current-commit").read_text().strip() != PARENT:
        raise RuntimeError("The private repair parent changed before isolated acceptance.")
    image = "tpp-erp-backend:" + expected[:12]
    actual = command(["docker", "image", "inspect", "--format", '{{index .Config.Labels "org.opencontainers.image.revision"}}', image]).strip()
    if actual != expected:
        raise RuntimeError("The isolated test image differs from the staged candidate.")
    before = {service: command(["docker", "inspect", "--format", "{{.Id}}", "aws-" + service + "-1"]).strip() for service in ("backend", "frontend", "worker", "beat", "postgres", "redis")}
    available = next(int(row.split()[1]) * 1024 for row in Path("/proc/meminfo").read_text().splitlines() if row.startswith("MemAvailable:"))
    if available < (3 if mode == "full" else 2) * 1024**3:
        raise RuntimeError("Wait for other build/test workloads to finish; isolated acceptance needs spare production memory.")
    output = output.resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    nonce = secrets.token_hex(5)
    prefix = "tpp-bill-qa-" + expected[:12] + "-" + nonce
    network, postgres, redis, runner = (prefix + "-" + suffix for suffix in ("net", "pg", "redis", "runner"))
    password = secrets.token_urlsafe(32)
    values = {
        "POSTGRES_DB": "bill_isolated_" + expected[:12], "POSTGRES_USER": "bill_qa", "POSTGRES_PASSWORD": password,
        "DB_NAME": "bill_isolated_" + expected[:12], "DB_USER": "bill_qa", "DB_PASSWORD": password, "DB_HOST": "bill-postgres", "DB_PORT": "5432",
        "SECRET_KEY": secrets.token_urlsafe(64), "DJANGO_ENV": "development", "DEBUG": "False", "SKIP_DOTENV_IMPORT": "1",
        "REDIS_URL": "redis://bill-redis:6379/0", "BACKUP_LOCAL_DIR": "/tmp/bill-isolated-backups",
        "GATE_ID_ENCRYPTION_KEY": base64.urlsafe_b64encode(secrets.token_bytes(32)).decode(),
        "GATE_TIME_ZONE": "Asia/Kolkata", "GATE_PUBLIC_ORIGIN": "https://erp.totalpolyprint.com",
        "ALLOWED_HOSTS": "erp.totalpolyprint.com,testserver,localhost", "JWT_COOKIE_SECURE": "True",
    }
    env_file = output / (prefix + ".env")
    descriptor = os.open(env_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        stream.write("".join(key + "=" + value + "\n" for key, value in values.items()))
    log = output / (prefix + "-" + mode + ".log")
    started = time.monotonic()
    created = []
    network_created = False
    try:
        command(["docker", "network", "create", "--internal", network])
        network_created = True
        command(["docker", "run", "-d", "--pull=never", "--name", postgres, "--network", network, "--network-alias", "bill-postgres", "--env-file", str(env_file), "--memory", "512m", "postgres:16-bookworm"])
        created.append(postgres)
        command(["docker", "run", "-d", "--pull=never", "--name", redis, "--network", network, "--network-alias", "bill-redis", "--memory", "128m", "redis:7-bookworm", "redis-server", "--maxmemory", "64mb", "--maxmemory-policy", "noeviction"])
        created.append(redis)
        for _ in range(40):
            ready = subprocess.run(["docker", "exec", postgres, "pg_isready", "-U", "bill_qa", "-d", values["DB_NAME"]], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if ready.returncode == 0:
                break
            time.sleep(0.5)
        else:
            raise RuntimeError("Disposable PostgreSQL did not become ready.")
        labels = [] if mode == "full" else FOCUSED
        args = ["docker", "run", "--name", runner, "--network", network, "--env-file", str(env_file), "--cpus", "1", "--memory", "1536m", "--security-opt", "no-new-privileges:true", "--cap-drop", "ALL", image, "python", "manage.py", "test", *labels, "--noinput", "--verbosity", "1"]
        created.append(runner)
        descriptor = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as stream:
            result = subprocess.run(args, stdout=stream, stderr=subprocess.STDOUT, timeout=3600)
        if result.returncode:
            raise RuntimeError("Exact-image isolated backend tests failed; preserve the private log.")
        raw_log = log.read_bytes()
        count = re.findall(r"Ran ([0-9]+) tests? in", raw_log.decode("utf-8", errors="replace"))
        if not count or int(count[-1]) < (1214 if mode == "full" else 20):
            raise RuntimeError("The isolated run did not discover the required backend coverage.")
        evidence = {"status": "PASS", "candidate_sha": expected, "mode": mode, "tests_run": int(count[-1]), "test_log": str(log), "test_log_sha256": hashlib.sha256(raw_log).hexdigest(), "duration_seconds": round(time.monotonic() - started, 3), "production_data_imported": False, "production_environment_used": False, "private_network_has_external_egress": False, "password_hasher_override": False}
    finally:
        for name in reversed(created):
            subprocess.run(["docker", "rm", "-f", "-v", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
        if network_created:
            subprocess.run(["docker", "network", "rm", network], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
        env_file.unlink(missing_ok=True)
    after = {service: command(["docker", "inspect", "--format", "{{.Id}}", "aws-" + service + "-1"]).strip() for service in before}
    if before != after or Path("/opt/tpp-erp/releases/current-commit").read_text().strip() != PARENT:
        raise RuntimeError("Production container/source identities changed during isolated tests.")
    evidence["production_containers_unchanged"] = True
    proof = output / (prefix + "-" + mode + ".json")
    proof.write_text(json.dumps(evidence, indent=2) + "\n")
    proof.chmod(0o600)
    return evidence


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expected-sha", required=True)
    parser.add_argument("--mode", choices=["full", "focused"], default="full")
    parser.add_argument("--output-directory", required=True, type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(run(args.expected_sha, args.mode, args.output_directory), sort_keys=True))
    except Exception:
        print(json.dumps({"status": "FAIL", "check": "Isolated exact-image acceptance failed; preserve the private log. Production data was not imported."}))
        raise SystemExit(1)
