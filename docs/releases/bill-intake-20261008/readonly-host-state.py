#!/usr/bin/env python3
"""Root-only host identity/unchanged-state checks; never expose environment data."""
import argparse
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path

APP = Path("/opt/tpp-erp/app")
MARKER = Path("/opt/tpp-erp/releases/current-commit")


def inspect(name):
    return json.loads(subprocess.check_output(["docker", "inspect", name], text=True))[0]


def snapshot(expected, marker_expected=None):
    marker_expected = marker_expected or expected
    if not re.fullmatch(r"[0-9a-f]{40}", expected) or not re.fullmatch(r"[0-9a-f]{40}", marker_expected) or os.geteuid() != 0:
        raise RuntimeError("Root and the exact expected production SHA are required.")
    if MARKER.read_text().strip() != marker_expected or APP.resolve() != Path("/opt/tpp-erp/releases") / expected[:12]:
        raise RuntimeError("Production source pointer/marker differs from the expected release.")
    services = {}
    mounts = {}
    for service in ("backend", "frontend", "worker", "beat", "postgres", "redis"):
        row = inspect("aws-" + service + "-1")
        if not row["State"]["Running"]:
            raise RuntimeError("A production service is not running.")
        mounts[service] = sorted((m["Source"], m["Destination"], m["RW"]) for m in row["Mounts"])
        if service in ("backend", "frontend", "worker", "beat"):
            revision = row["Config"].get("Labels", {}).get("org.opencontainers.image.revision")
            if revision != expected:
                raise RuntimeError("A production application service has a different revision.")
            health = row["State"].get("Health", {}).get("Status")
            if service in ("backend", "frontend") and health != "healthy":
                raise RuntimeError("A production web service is unhealthy.")
            services[service] = {"revision": revision, "running": True, "health": health}
    redis = inspect("aws-redis-1")
    command = redis["Config"].get("Cmd", [])
    if "noeviction" not in command or "--appendonly" not in command:
        raise RuntimeError("The reviewed durable Redis broker configuration changed.")
    env = Path("/opt/tpp-erp/secrets/app.env")
    if not env.is_file() or env.is_symlink() or env.stat().st_mode & 0o077:
        raise RuntimeError("Production environment permissions changed.")
    return {
        "expected_sha": expected, "services": services,
        "preserved": {
            "environment_digest": hashlib.sha256(env.read_bytes()).hexdigest(),
            "caddy_digest": hashlib.sha256(Path("/etc/caddy/Caddyfile").read_bytes()).hexdigest(),
            "mounts": mounts,
            "postgres_container": inspect("aws-postgres-1")["Id"],
            "redis_container": redis["Id"],
            "redis_command": command,
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expected-sha", required=True)
    parser.add_argument("--marker-sha", help="During verified cutover only, require the unchanged old marker until the final write.")
    parser.add_argument("--save", type=Path)
    parser.add_argument("--compare", type=Path)
    args = parser.parse_args()
    current = snapshot(args.expected_sha, args.marker_sha)
    if args.compare:
        original = json.loads(args.compare.read_text())
        # JSON serializes tuples as lists; normalize both before comparison.
        if json.dumps(current["preserved"], sort_keys=True) != json.dumps(original["preserved"], sort_keys=True):
            raise RuntimeError("Caddy, secrets, persistent mounts or database/broker containers changed.")
    if args.save:
        descriptor = os.open(args.save, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as stream:
            json.dump(current, stream, sort_keys=True)
            stream.write("\n")
    print(json.dumps({"status": "PASS", "expected_sha": args.expected_sha, "services": current["services"], "preserved_state_verified": bool(args.compare)}))


if __name__ == "__main__":
    main()
