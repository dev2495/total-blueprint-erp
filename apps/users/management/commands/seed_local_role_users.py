"""One local test account per floor and office role, for trying each role's screens (local only).

Creates or refreshes demo.<role> accounts with the role, and the floor scope that role needs:
the Work Center Manager gets one work centre, the Machine Operator one machine of it. The shared
local password comes from LOCAL_ROLE_USERS_PASSWORD or ROLE_USERS_PASSWORD in the git-ignored
.runtime/local-test-accounts.env; the command refuses to run on a production settings profile.
"""

import os
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.factory.models import Machine, WorkCenter
from apps.users.models import MachineAssignment, Role, WorkCenterAssignment
from apps.users.permission_registry import ROLE_PERMISSION_MATRIX
from apps.users.role_catalog import CANONICAL_ROLE_LABELS


def _local_value(key):
    path = Path(settings.BASE_DIR) / ".runtime" / "local-test-accounts.env"
    try:
        for line in path.read_text().splitlines():
            name, _, value = line.partition("=")
            if name.strip() == key:
                return value.strip()
    except OSError:
        return ""
    return ""


ROLES = ["SALES", "PLANNER", "WORK_CENTER_MANAGER", "OPERATOR", "STORE", "DISPATCH", "PLANT_MANAGER"]


class Command(BaseCommand):
    help = "Create local demo.<role> accounts for every floor and office role (local only)."

    def add_arguments(self, parser):
        parser.add_argument("--work-center", default="", help="Work centre code for the WCM and operator (default: the first with a machine).")

    def handle(self, *args, **options):
        if getattr(settings, "IS_PRODUCTION", False) or str(getattr(settings, "DJANGO_ENV", "")).lower().startswith("prod"):
            raise CommandError("Refusing to create test accounts on a production settings profile.")
        password = os.environ.get("LOCAL_ROLE_USERS_PASSWORD") or _local_value("ROLE_USERS_PASSWORD")
        if not password:
            raise CommandError("Set ROLE_USERS_PASSWORD in .runtime/local-test-accounts.env (git-ignored) or LOCAL_ROLE_USERS_PASSWORD.")
        wc_qs = WorkCenter.objects.filter(machines__status="ACTIVE").distinct().order_by("code")
        wc = wc_qs.filter(code=options["work_center"]).first() if options["work_center"] else wc_qs.first()
        if wc is None:
            raise CommandError("No work centre with an active machine; seed the masters first.")
        machine = Machine.objects.filter(work_center=wc, status="ACTIVE").order_by("code").first()
        User = get_user_model()
        with transaction.atomic():
            for code in ROLES:
                role, _ = Role.objects.get_or_create(
                    code=code,
                    defaults={"name": CANONICAL_ROLE_LABELS.get(code, code.title()), "default_permissions": list(ROLE_PERMISSION_MATRIX.get(code, []))},
                )
                username = f"demo.{code.lower().replace('_', '-')}"
                user, _ = User.objects.get_or_create(username=username, defaults={"email": f"{username}@example.invalid"})
                user.role = role
                user.is_active = True
                user.is_staff = False
                user.is_superuser = False
                user.is_owner = False
                user.extra_permissions = []
                user.set_password(password)
                user.save()
                WorkCenterAssignment.objects.filter(user=user).delete()
                MachineAssignment.objects.filter(user=user).delete()
                if code == "WORK_CENTER_MANAGER":
                    WorkCenterAssignment.objects.create(user=user, work_center=wc)
                if code == "OPERATOR":
                    MachineAssignment.objects.create(user=user, machine=machine)
                self.stdout.write(f"{username:28} {CANONICAL_ROLE_LABELS.get(code, code)}")
        self.stdout.write(self.style.SUCCESS(f"Work centre {wc.code} · {wc.name}; operator machine {machine.code} · {machine.name}"))
