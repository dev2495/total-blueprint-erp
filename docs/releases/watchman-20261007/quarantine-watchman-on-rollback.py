"""Disable active watchman logins before reverting to a pre-gate application.

Invoked only by the reviewed rollback shell with a private recovery-directory
mount. This never changes passwords or users in other roles. Recovery metadata
contains only user IDs and prior active flags and is never printed.
"""
import json
import os
import tempfile
from pathlib import Path

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django
django.setup()
from django.db import transaction
from django.utils import timezone
from apps.users.models import Role, User


def quarantine(recovery_directory: Path):
    target = recovery_directory / "watchman-account-state.json"
    with transaction.atomic():
        # Match the application's strip/upper canonical role semantics, even
        # for a legacy role row containing whitespace or lower-case letters.
        roles = [pk for pk, code in Role.objects.values_list("id", "code") if str(code or "").strip().upper() == "WATCHMAN"]
        accounts = list(User.objects.select_for_update().filter(role_id__in=roles, is_active=True).values("id", "is_active"))
        previous = json.loads(target.read_text()) if target.exists() else {"created_at": timezone.now().isoformat(), "reason": "Application rollback to pre-watchman access controls", "accounts": []}
        if not isinstance(previous.get("accounts"), list):
            raise RuntimeError("Invalid private account recovery record; preserve it for administrator review.")
        retained = {str(item["id"]): item for item in previous["accounts"]}
        for account in accounts:
            retained.setdefault(str(account["id"]), {"id": str(account["id"]), "was_active": bool(account["is_active"])})
        previous["accounts"] = list(retained.values())
        fd, temporary = tempfile.mkstemp(prefix=".watchman-state-", dir=recovery_directory)
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "w") as stream:
                json.dump(previous, stream)
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, target)
            directory_fd = os.open(recovery_directory, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        User.objects.filter(id__in=[account["id"] for account in accounts]).update(is_active=False)
    return len(accounts)


if __name__ == "__main__":
    import sys
    if sys.argv[1:] != ["--authorized-application-rollback"]:
        raise SystemExit("This account protection runs only as an explicitly authorized application rollback.")
    directory = Path("/release-recovery")
    if not directory.is_dir() or directory.stat().st_mode & 0o077:
        raise SystemExit("A private mode-0700 recovery directory is required.")
    count = quarantine(directory)
    print(json.dumps({"watchman_accounts_disabled": count, "private_recovery_record_preserved": True, "passwords_changed": False}))
