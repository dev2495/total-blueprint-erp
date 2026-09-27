from django.db import migrations


PRINT_PROCESS_CODES = ("PRT", "FLE PRT")


def enable_print_processes(apps, schema_editor):
    Process = apps.get_model("factory", "Process")
    for process in Process.objects.all().only("id", "code", "name", "print_capable", "has_artwork"):
        code = str(process.code or "").strip().upper()
        name = str(process.name or "").strip().upper()
        if code in PRINT_PROCESS_CODES or name in {"ROTO PRINTING", "FLEXO PRINTING"}:
            Process.objects.filter(id=process.id).update(print_capable=True, has_artwork=True)


class Migration(migrations.Migration):

    dependencies = [
        ("factory", "0027_process_route_skip_capabilities"),
    ]

    operations = [
        migrations.RunPython(enable_print_processes, migrations.RunPython.noop),
    ]
