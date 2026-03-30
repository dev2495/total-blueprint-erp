# Generated manually for sales fast-entry SKU support.

import django.db.models.deletion
import uuid
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0011_inventorymaterial_packaging_defaults_json_and_more"),
        ("sales", "0016_quotation_quotationitem"),
        ("templates", "0028_alter_templateblueprint_pouch_style"),
    ]

    operations = [
        migrations.CreateModel(
            name="SalesSku",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("code", models.CharField(db_index=True, max_length=80, unique=True)),
                ("name", models.CharField(max_length=255)),
                ("default_line_name", models.CharField(blank=True, default="", max_length=255)),
                ("active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("commercial_family", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="sales_skus", to="materials.commercialfamily")),
                ("template", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="sales_skus", to="templates.templateblueprint")),
            ],
            options={
                "db_table": "sales_skus",
                "ordering": ["name", "code"],
            },
        ),
        migrations.CreateModel(
            name="SalesSkuVariant",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("code", models.CharField(max_length=80)),
                ("name", models.CharField(max_length=255)),
                ("active", models.BooleanField(default=True)),
                ("finished_good_type", models.CharField(choices=[("POUCH", "Pouch"), ("ROLL", "Roll")], default="POUCH", max_length=20)),
                ("roll_form", models.CharField(blank=True, choices=[("", "Not Applicable"), ("FLAT", "Flat"), ("FOLDED", "Folded"), ("TUBING", "Tubing")], default="", max_length=20)),
                ("geometry_snapshot", models.JSONField(blank=True, default=dict)),
                ("layer_snapshot", models.JSONField(blank=True, default=list)),
                ("printing_snapshot", models.JSONField(blank=True, default=dict)),
                ("chemicals_snapshot", models.JSONField(blank=True, default=dict)),
                ("addons_snapshot", models.JSONField(blank=True, default=list)),
                ("packaging_snapshot", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("sku", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="variants", to="sales.salessku")),
            ],
            options={
                "db_table": "sales_sku_variants",
                "ordering": ["sku__name", "name", "code"],
                "constraints": [
                    models.UniqueConstraint(fields=("sku", "code"), name="sales_sku_variant_code_unique_per_sku"),
                ],
            },
        ),
        migrations.AddField(
            model_name="salesorderitem",
            name="repeat_source_item",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="repeat_children", to="sales.salesorderitem"),
        ),
        migrations.AddField(
            model_name="salesorderitem",
            name="sku_variant",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="sales_order_items", to="sales.salesskuvariant"),
        ),
    ]
