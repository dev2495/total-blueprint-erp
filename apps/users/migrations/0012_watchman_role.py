from django.db import migrations


def add_watchman_role(apps, schema_editor):
    # Only create the new role. Existing users, passwords and role grants remain
    # untouched; gates must be assigned explicitly through user management.
    Role = apps.get_model("users", "Role")
    Role.objects.get_or_create(
        code="WATCHMAN",
        defaults={
            "name": "Watchman",
            "description": "Log gate goods movements and visitor entry or exit at assigned plants.",
            "default_permissions": ["users.self_manage", "gate.log", "page.gate.watchman.view", "page.profile.view"],
        },
    )


class Migration(migrations.Migration):
    dependencies = [("users", "0011_shift_inference")]
    operations = [migrations.RunPython(add_watchman_role, migrations.RunPython.noop)]
