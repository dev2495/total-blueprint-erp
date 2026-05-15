from django.db import migrations, models


def convert_legacy_bulk_product_masters(apps, schema_editor):
    ProductMaster = apps.get_model("materials", "ProductMaster")
    ProductMaster.objects.filter(product_kind="BULK").update(
        product_kind="ROLL",
        default_reporting_group="SEMI_FG",
        active=False,
    )


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0024_productmastersize_geometry_config"),
    ]

    operations = [
        migrations.RunPython(convert_legacy_bulk_product_masters, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="productmaster",
            name="product_kind",
            field=models.CharField(
                choices=[
                    ("POUCH", "Pouch"),
                    ("ROLL", "Roll"),
                    ("PACKAGING", "Packaging"),
                    ("POD", "POD"),
                    ("OTHER", "Other"),
                ],
                default="POUCH",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="inventorymaterial",
            name="addon_is_purchased",
            field=models.BooleanField(default=False, help_text="TRUE when this add-on is bought and stocked through bulk GRN before order-level consumption."),
        ),
        migrations.AddField(
            model_name="inventorymaterial",
            name="addon_purchase_uom",
            field=models.CharField(choices=[("KG", "Kilograms (KG)"), ("PCS", "Pieces (PCS)")], default="KG", help_text="Inventory UOM used when purchased add-ons are inwarded through bulk GRN.", max_length=10),
        ),
    ]
