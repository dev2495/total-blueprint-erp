from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0008_inventorymaterial_packaging_kind_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="inventorymaterial",
            name="pod_fixed_height_mm",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True),
        ),
        migrations.AddField(
            model_name="inventorymaterial",
            name="pod_is_inhouse_produced",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="inventorymaterial",
            name="pod_panel_count",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="inventorymaterial",
            name="pod_thickness_micron",
            field=models.DecimalField(blank=True, decimal_places=3, max_digits=10, null=True),
        ),
        migrations.AddField(
            model_name="inventorymaterial",
            name="pod_type",
            field=models.CharField(blank=True, choices=[("SINGLE", "Single POD"), ("DOUBLE", "Double POD")], max_length=20, null=True),
        ),
    ]
