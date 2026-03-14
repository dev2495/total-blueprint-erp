from django.db import migrations


def create_base_inks(apps, schema_editor):
    InventoryMaterial = apps.get_model("materials", "InventoryMaterial")

    base_inks = [
        ("INK-POLY", "POLY Ink Pool"),
        ("INK-PET", "PET Ink Pool"),
    ]

    for code, name in base_inks:
        InventoryMaterial.objects.get_or_create(
            code=code,
            defaults={
                "name": name,
                "category": "INK",
                "base_uom": "KG",
                "status": "ACTIVE",
            },
        )


def noop_reverse(apps, schema_editor):
    # Keep the rows; they may be referenced by templates/jobs.
    return


class Migration(migrations.Migration):
    dependencies = [
        ("materials", "0005_consumablematerial"),
    ]

    operations = [
        migrations.RunPython(create_base_inks, reverse_code=noop_reverse),
    ]

