from django.db import migrations, models


GEOMETRY_KEYS = {"trim_loss_mm", "flap_tape_mm", "adjustments", "multipliers", "pouch_style"}


def copy_geometry_from_legacy_default_packing(apps, schema_editor):
    ProductMasterSize = apps.get_model("materials", "ProductMasterSize")
    updates = []
    for size in ProductMasterSize.objects.all():
        legacy = size.default_packing if isinstance(size.default_packing, dict) else {}
        geometry = legacy.get("geometry")
        if not isinstance(geometry, dict):
            geometry = {key: legacy[key] for key in GEOMETRY_KEYS if key in legacy}
        if geometry:
            size.geometry_config = geometry
            updates.append(size)
    if updates:
        ProductMasterSize.objects.bulk_update(updates, ["geometry_config"])


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0023_alter_commercialfamily_default_reporting_group_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="productmastersize",
            name="geometry_config",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.RunPython(copy_geometry_from_legacy_default_packing, migrations.RunPython.noop),
    ]
