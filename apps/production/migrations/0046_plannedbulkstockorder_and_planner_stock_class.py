from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("factory", "0021_plant_include_in_official_reports"),
        ("materials", "0011_inventorymaterial_packaging_defaults_json_and_more"),
        ("production", "0045_packingunit_extras_tare_kg_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="plannedstockorder",
            name="planner_stock_class",
            field=models.CharField(
                blank=True,
                choices=[
                    ("FINAL_PRODUCT", "Final Product"),
                    ("FINAL_PLAIN_ROLL", "Final Plain Roll"),
                    ("EXTRUDED_BASE_ROLL", "Extruded/Base Roll"),
                    ("SHARED_INVARIANT_ROLL", "Shared Invariant Roll"),
                    ("PACKAGING_STOCK", "Packaging Stock"),
                ],
                default="",
                max_length=30,
            ),
        ),
        migrations.CreateModel(
            name="PlannedBulkStockOrder",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("order_number", models.CharField(blank=True, max_length=50, unique=True)),
                ("internal_name", models.CharField(blank=True, default="", max_length=255)),
                ("bulk_class", models.CharField(choices=[("POD_BULK", "POD Bulk")], default="POD_BULK", max_length=20)),
                ("target_qty_kg", models.DecimalField(decimal_places=4, max_digits=12)),
                ("produced_qty_kg", models.DecimalField(decimal_places=4, default=0, max_digits=12)),
                ("pod_profile_snapshot", models.JSONField(blank=True, default=dict)),
                ("planner_origin_meta", models.JSONField(blank=True, default=dict)),
                ("status", models.CharField(choices=[("DRAFT", "Draft"), ("PLANNING_REQUIRED", "Planning Required"), ("PLANNED", "Planned"), ("RELEASED", "Released"), ("STOCK_READY", "Stock Ready"), ("COMPLETED", "Completed"), ("CANCELLED", "Cancelled")], default="PLANNING_REQUIRED", max_length=20)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="planned_bulk_stock_orders", to=settings.AUTH_USER_MODEL)),
                ("material", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="planned_bulk_stock_orders", to="materials.inventorymaterial")),
                ("plant", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, to="factory.plant")),
            ],
            options={
                "db_table": "production_mts_bulk_orders",
                "ordering": ["-created_at"],
            },
        ),
    ]
