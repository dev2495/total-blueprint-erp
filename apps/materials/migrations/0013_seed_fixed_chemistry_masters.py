from django.db import migrations


FIXED_CHEMISTRY = [
    {
        "code": "AD-ADHESIVE",
        "name": "Standard Lamination Adhesive",
        "category": "ADHESIVE",
    },
    {
        "code": "AD-SOLVENT",
        "name": "Standard Lamination Solvent",
        "category": "SOLVENT",
    },
]


def seed_fixed_chemistry(apps, schema_editor):
    InventoryMaterial = apps.get_model("materials", "InventoryMaterial")

    for row in FIXED_CHEMISTRY:
        defaults = {
            "name": row["name"],
            "category": row["category"],
            "base_uom": "KG",
            "is_purchasable": True,
            "status": "ACTIVE",
        }
        obj, _ = InventoryMaterial.objects.get_or_create(code=row["code"], defaults=defaults)
        updates = {}
        for field, value in defaults.items():
            if getattr(obj, field) != value:
                updates[field] = value
        if updates:
            for field, value in updates.items():
                setattr(obj, field, value)
            obj.save(update_fields=list(updates.keys()) + ["updated_at"])


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0012_podsku_and_variants"),
    ]

    operations = [
        migrations.RunPython(seed_fixed_chemistry, migrations.RunPython.noop),
    ]
