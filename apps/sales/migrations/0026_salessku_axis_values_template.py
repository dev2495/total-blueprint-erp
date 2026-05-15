from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("sales", "0025_customerproductoverlay_axis_values_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="salessku",
            name="axis_values_template",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
