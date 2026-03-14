from django.db import migrations, models


def backfill_roll_density(apps, schema_editor):
    InventoryRoll = apps.get_model("inventory", "InventoryRoll")
    InventoryMaterial = apps.get_model("materials", "InventoryMaterial")

    material_map = {}
    for material in InventoryMaterial.objects.select_related("parent_family").all().only(
        "id",
        "density_gcm3",
        "parent_family_id",
        "parent_family__density_gcm3",
    ):
        family = getattr(material, "parent_family", None)
        density = getattr(family, "density_gcm3", None) if family else None
        if density in (None, ""):
            density = getattr(material, "density_gcm3", None)
        material_map[str(material.id)] = density

    for roll in InventoryRoll.objects.filter(density_gcm3__isnull=True).only("id", "material_id"):
        density = material_map.get(str(roll.material_id))
        if density in (None, ""):
            continue
        InventoryRoll.objects.filter(id=roll.id).update(density_gcm3=density)


class Migration(migrations.Migration):

    dependencies = [
        ("inventory", "0028_packagingtransaction_packagingstock"),
        ("materials", "0008_inventorymaterial_packaging_kind_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="inventoryroll",
            name="density_gcm3",
            field=models.DecimalField(
                blank=True,
                decimal_places=4,
                default=None,
                help_text="Density snapshot for stable derived area/length previews",
                max_digits=10,
                null=True,
            ),
        ),
        migrations.RunPython(backfill_roll_density, migrations.RunPython.noop),
    ]
