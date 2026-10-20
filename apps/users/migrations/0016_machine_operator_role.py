"""Bring back the Machine Operator role, scoped to the machines assigned to each account.

Until now the code OPERATOR was an alias of Work Center Manager, so an account still holding it
worked as a Work Center Manager. Those accounts move to the Work Center Manager role first, so
nobody loses access on deploy; an admin then gives the new Machine Operator role (and its
machines) on the Users page to the people who should only run their own machines.
"""

from django.db import migrations

OPERATOR_PERMISSIONS = [
    "users.self_manage",
    "notifications.view",
    "page.profile.view",
    "page.scan.machine.view",
    "production.view",
    "production.manage",
    "master.view",
    "inventory.view",
    "factory.view",
    "maintenance.view",
    "maintenance.log",
    "page.maintenance.board.view",
    "page.maintenance.faults.view",
]


def bring_back_operator(apps, schema_editor):
    Role = apps.get_model("users", "Role")
    User = apps.get_model("users", "User")
    operator = Role.objects.filter(code="OPERATOR").first()
    if operator is not None and User.objects.filter(role=operator).exists():
        wcm, _ = Role.objects.get_or_create(code="WORK_CENTER_MANAGER", defaults={"name": "Work Center Manager"})
        User.objects.filter(role=operator).update(role=wcm)
    if operator is None:
        operator = Role(code="OPERATOR")
    operator.name = "Machine Operator"
    operator.description = "Runs the machine terminal for the machines assigned to them; reports faults and does daily checks."
    operator.default_permissions = list(OPERATOR_PERMISSIONS)
    if hasattr(operator, "revoked_permissions"):
        operator.revoked_permissions = []
    operator.save()


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0015_retire_engineering_role"),
    ]

    operations = [
        migrations.RunPython(bring_back_operator, migrations.RunPython.noop),
    ]
