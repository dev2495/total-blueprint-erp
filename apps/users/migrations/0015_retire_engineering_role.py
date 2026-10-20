"""Retire the Engineering role.

Masters, templates, routes, artworks, cylinders and the tool room are admin/owner screens; any
account can still be given them through per-user grants. An account that still holds the
Engineering role keeps exactly the access it had: the role's permissions (the old canonical set,
the role row's own defaults, less the role-matrix removals) become the account's own grants and
the role is cleared, so an admin can give it a proper role from the Users page.
"""

from django.db import migrations

RETIRED_CODES = ("ENGINEERING", "ENGINEER")

# The Engineering row of the role matrix as it stood when the role was retired.
ENGINEERING_PERMISSIONS = [
    "tooling.view",
    "tooling.manage",
    "users.self_manage",
    "engineering.view",
    "engineering.manage",
    "templates.view",
    "templates.manage",
    "routing.view",
    "routing.manage",
    "master.view",
    "master.manage",
    "dashboard.view",
    "notifications.view",
    "factory.view",
]


def retire(apps, schema_editor):
    Role = apps.get_model("users", "Role")
    User = apps.get_model("users", "User")
    for role in Role.objects.filter(code__in=RETIRED_CODES):
        granted = set(ENGINEERING_PERMISSIONS) | set(role.default_permissions or [])
        granted -= set(getattr(role, "revoked_permissions", None) or [])
        for user in User.objects.filter(role=role):
            user.extra_permissions = sorted(set(user.extra_permissions or []) | granted)
            user.role = None
            user.save(update_fields=["extra_permissions", "role"])
        role.delete()


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0014_role_revocations_and_waste_threshold"),
    ]

    operations = [
        migrations.RunPython(retire, migrations.RunPython.noop),
    ]
