"""Create the two maintenance roles so administrators can assign them on day one.

Permissions resolve from the canonical matrix at request time, so existing roles
need no re-sync; only the new Role rows are needed here.
"""
from django.db import migrations


def create_roles(apps, schema_editor):
    Role = apps.get_model("users", "Role")
    from apps.users.permission_registry import ROLE_PERMISSION_MATRIX
    from apps.users.role_catalog import CANONICAL_ROLE_LABELS

    for code in ("MAINTENANCE_TECH", "MAINTENANCE_SUPERVISOR"):
        Role.objects.get_or_create(
            code=code,
            defaults={
                "name": CANONICAL_ROLE_LABELS.get(code, code.replace("_", " ").title()),
                "default_permissions": list(ROLE_PERMISSION_MATRIX.get(code, [])),
            },
        )


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("maintenance", "0001_initial"),
        ("users", "0014_role_revocations_and_waste_threshold"),
    ]

    operations = [migrations.RunPython(create_roles, noop)]
