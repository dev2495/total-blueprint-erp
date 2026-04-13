"""
Pre-deploy RBAC bootstrap.

Runs on every deploy via preDeployCommand in render.yaml.

1. Upserts all canonical roles with correct default_permissions from the matrix.
2. Ensures every is_staff=True user who has no role assigned gets the ADMIN role,
   so they are never silently locked out by STRICT_RBAC mode.
"""
from django.core.management.base import BaseCommand

from apps.users.models import Role, User
from apps.users.permission_registry import ROLE_PERMISSION_MATRIX
from apps.users.role_catalog import CANONICAL_ROLE_LABELS


class Command(BaseCommand):
    help = "Sync canonical RBAC roles and ensure staff users have a role assigned."

    def handle(self, *args, **options):
        # Step 1 — sync all canonical roles from the permission matrix.
        admin_role = None
        synced = []
        for role_code, permissions in ROLE_PERMISSION_MATRIX.items():
            desired_name = CANONICAL_ROLE_LABELS.get(role_code, role_code.replace("_", " ").title())
            desired_perms = list(permissions)
            role, created = Role.objects.get_or_create(
                code=role_code,
                defaults={"name": desired_name, "default_permissions": desired_perms},
            )
            changed = []
            if role.name != desired_name:
                role.name = desired_name
                changed.append("name")
            if list(role.default_permissions or []) != desired_perms:
                role.default_permissions = desired_perms
                changed.append("default_permissions")
            if changed:
                role.save(update_fields=changed)
            if role_code == "ADMIN":
                admin_role = role
            verb = "created" if created else ("updated" if changed else "ok")
            synced.append(f"  {role_code}: {verb}")

        self.stdout.write(self.style.SUCCESS("Roles synced:"))
        for line in synced:
            self.stdout.write(line)

        # Step 2 — assign ADMIN role to any is_staff user with no role.
        if admin_role is None:
            self.stdout.write(self.style.WARNING("ADMIN role not found — skipping staff user assignment."))
            return

        unroled_staff = User.objects.filter(is_staff=True, role__isnull=True)
        count = 0
        for user in unroled_staff:
            user.role = admin_role
            user.save(update_fields=["role"])
            self.stdout.write(self.style.SUCCESS(f"  Assigned ADMIN role to staff user: {user.username}"))
            count += 1

        if count == 0:
            self.stdout.write("  All staff users already have a role.")
        else:
            self.stdout.write(self.style.SUCCESS(f"  {count} staff user(s) updated."))
