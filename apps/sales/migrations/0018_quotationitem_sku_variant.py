from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("sales", "0017_salessku_salesskuvariant_and_order_item_refs"),
    ]

    operations = [
        migrations.AddField(
            model_name="quotationitem",
            name="sku_variant",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=models.deletion.SET_NULL,
                related_name="quotation_items",
                to="sales.salesskuvariant",
            ),
        ),
    ]
