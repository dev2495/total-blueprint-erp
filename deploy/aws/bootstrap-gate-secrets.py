#!/usr/bin/env python3
"""Provision a persistent gate identity key without exposing existing secrets.

Run on the production host as root before gate migrations and activation.
Existing valid keys are preserved. Never run with shell tracing enabled.
"""

import base64
import os
import re
import secrets
import stat
import tempfile
from pathlib import Path


def main() -> None:
    if os.geteuid() != 0:
        raise SystemExit("Run gate secret provisioning as root on the production host.")
    env_path = Path("/opt/tpp-erp/secrets/app.env")
    if not env_path.is_file() or env_path.is_symlink():
        raise SystemExit("Expected a regular existing production environment file.")
    current_stat = env_path.stat()
    if current_stat.st_mode & (stat.S_IRWXG | stat.S_IRWXO):
        raise SystemExit("Production environment file permissions must be private (0600).")
    original = env_path.read_text()
    matches = re.findall(r"^\s*(?:export\s+)?GATE_ID_ENCRYPTION_KEY\s*=\s*(.*?)\s*$", original, re.MULTILINE)
    if len(matches) > 1:
        raise SystemExit("Duplicate gate identity key settings require administrator reconciliation.")
    if matches:
        value = matches[0].strip().strip("\"'")
        try:
            valid = len(base64.urlsafe_b64decode(value)) == 32
        except Exception:
            valid = False
        if not valid:
            raise SystemExit("Existing gate identity key is invalid; preserve it and reconcile before release.")
        print("Gate identity encryption key validated and retained.")
        return
    key = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode("ascii")
    appended = original.rstrip("\n") + "\nGATE_ID_ENCRYPTION_KEY=" + key + "\n"
    descriptor, temporary = tempfile.mkstemp(prefix=".app.env.gate-", dir=env_path.parent)
    try:
        os.fchmod(descriptor, 0o600)
        os.fchown(descriptor, current_stat.st_uid, current_stat.st_gid)
        with os.fdopen(descriptor, "w") as stream:
            stream.write(appended)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, env_path)
        directory_fd = os.open(env_path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print("Gate identity encryption key provisioned in the private production environment.")


if __name__ == "__main__":
    main()
