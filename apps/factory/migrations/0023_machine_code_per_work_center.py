import re

from django.db import migrations, models


def normalize_machine_code(value: str) -> str:
    normalized = re.sub(r"\s*-\s*", "-", str(value or "").strip())
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.upper()


def normalize_existing_machine_codes(apps, schema_editor):
    Machine = apps.get_model("factory", "Machine")
    seen = set()
    for machine in Machine.objects.all().order_by("work_center_id", "id"):
        normalized = normalize_machine_code(machine.code)
        key = (str(machine.work_center_id), normalized)
        if not normalized or key in seen:
            seen.add((str(machine.work_center_id), str(machine.code)))
            continue
        if machine.code != normalized:
            machine.code = normalized
            machine.save(update_fields=["code"])
        seen.add(key)


class Migration(migrations.Migration):

    dependencies = [
        ("factory", "0022_machine_cost_absorption_group_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="machine",
            name="code",
            field=models.CharField(max_length=50),
        ),
        migrations.RunPython(normalize_existing_machine_codes, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="machine",
            constraint=models.UniqueConstraint(fields=("work_center", "code"), name="factory_machine_wc_code_unique"),
        ),
    ]
