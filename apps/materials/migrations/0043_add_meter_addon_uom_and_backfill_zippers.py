from django.db import migrations, models


def mark_zipper_addons_as_meter(apps, schema_editor):
    InventoryMaterial = apps.get_model("materials", "InventoryMaterial")
    from django.db.models import Q

    InventoryMaterial.objects.filter(category="ADDON").filter(
        Q(code__icontains="ZIP") | Q(name__icontains="ZIP") | Q(name__icontains="ZIPPER")
    ).update(
        is_purchasable=True,
        addon_is_purchased=True,
        addon_purchase_uom="METER",
        base_uom="METER",
    )


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0042_inventorymaterial_lead_time_override_days_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="inventorymaterial",
            name="addon_purchase_uom",
            field=models.CharField(
                choices=[
                    ("KG", "Kilograms (KG)"),
                    ("PCS", "Pieces (PCS)"),
                    ("METER", "Meters (METER)"),
                ],
                default="KG",
                help_text="Inventory UOM used when purchased add-ons are inwarded through bulk GRN.",
                max_length=10,
            ),
        ),
        migrations.RunPython(mark_zipper_addons_as_meter, migrations.RunPython.noop),
    ]
