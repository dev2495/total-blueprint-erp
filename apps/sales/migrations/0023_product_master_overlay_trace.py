import django.db.models.deletion
import uuid
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("artwork", "0010_artwork_product_metadata"),
        ("materials", "0018_productmaster"),
        ("sales", "0022_salesskuvariant_derived_from_planner_variant"),
    ]

    operations = [
        migrations.CreateModel(
            name="CustomerProductOverlay",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("customer_item_code", models.CharField(blank=True, default="", max_length=80)),
                ("customer_display_name", models.CharField(blank=True, default="", max_length=255)),
                ("default_packing_note", models.TextField(blank=True, default="")),
                ("default_price_basis", models.CharField(blank=True, choices=[("KG", "Per KG"), ("PCS", "Per PCS")], default="", max_length=10)),
                ("notes", models.TextField(blank=True, default="")),
                ("active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("customer", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="product_overlays", to="sales.customer")),
                ("default_artwork", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="customer_product_overlays", to="artwork.artwork")),
                ("product_master", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="customer_overlays", to="materials.productmaster")),
            ],
            options={
                "db_table": "customer_product_overlays",
                "ordering": ["customer__name", "product_master__name", "customer_item_code"],
            },
        ),
        migrations.AddField(
            model_name="salesorderitem",
            name="customer_product_overlay",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="sales_order_items", to="sales.customerproductoverlay"),
        ),
        migrations.AddField(
            model_name="salesorderitem",
            name="product_master",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="sales_order_items", to="materials.productmaster"),
        ),
        migrations.AddField(
            model_name="salessku",
            name="product_master",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="sales_skus", to="materials.productmaster"),
        ),
        migrations.AddConstraint(
            model_name="customerproductoverlay",
            constraint=models.UniqueConstraint(fields=("product_master", "customer", "customer_item_code"), name="customer_product_overlay_unique_item_code"),
        ),
    ]
