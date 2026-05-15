from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0055_product_master_commitments"),
    ]

    operations = [
        migrations.AddField(
            model_name="plannedstockorder",
            name="axis_values",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="plannerskuvariant",
            name="axis_values",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
