from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("inventory", "0039_alter_bulktransaction_type_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="inventoryroll",
            name="net_weight_kg",
            field=models.DecimalField(
                blank=True,
                decimal_places=3,
                help_text="Product-only roll weight excluding core and packing tare. Falls back to weight_kg when not separately captured.",
                max_digits=10,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="inventoryroll",
            name="tare_weight_kg",
            field=models.DecimalField(
                decimal_places=3,
                default=0,
                help_text="Core / sleeve / roll packing tare weight.",
                max_digits=10,
            ),
        ),
        migrations.AddField(
            model_name="inventoryroll",
            name="gross_weight_kg",
            field=models.DecimalField(
                blank=True,
                decimal_places=3,
                help_text="Scale gross roll weight including core and packing tare.",
                max_digits=10,
                null=True,
            ),
        ),
    ]
