import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("artwork", "0010_artwork_product_metadata"),
        ("materials", "0018_productmaster"),
        ("production", "0054_wcm_material_policy_audit_action"),
        ("sales", "0023_product_master_overlay_trace"),
    ]

    operations = [
        migrations.AddField(
            model_name="plannedstockorder",
            name="commitment_scope",
            field=models.CharField(choices=[("GENERIC", "Generic / Shared"), ("CUSTOMER", "Customer Committed"), ("ARTWORK", "Artwork Committed"), ("CUSTOMER_ARTWORK", "Customer + Artwork Committed")], default="GENERIC", max_length=24),
        ),
        migrations.AddField(
            model_name="plannedstockorder",
            name="committed_artwork",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="committed_stock_orders", to="artwork.artwork"),
        ),
        migrations.AddField(
            model_name="plannedstockorder",
            name="committed_customer",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="committed_stock_orders", to="sales.customer"),
        ),
        migrations.AddField(
            model_name="plannedstockorder",
            name="product_master",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="planned_stock_orders", to="materials.productmaster"),
        ),
        migrations.AddField(
            model_name="plannersku",
            name="product_master",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="planner_skus", to="materials.productmaster"),
        ),
        migrations.AddField(
            model_name="plannerskuvariant",
            name="commitment_scope",
            field=models.CharField(choices=[("GENERIC", "Generic / Shared"), ("CUSTOMER", "Customer Committed"), ("ARTWORK", "Artwork Committed"), ("CUSTOMER_ARTWORK", "Customer + Artwork Committed")], default="GENERIC", max_length=24),
        ),
        migrations.AddField(
            model_name="plannerskuvariant",
            name="committed_artwork",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="planner_sku_variants", to="artwork.artwork"),
        ),
        migrations.AddField(
            model_name="plannerskuvariant",
            name="committed_customer",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="planner_sku_variants", to="sales.customer"),
        ),
        migrations.AddField(
            model_name="plannerskuvariant",
            name="product_master",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="planner_sku_variants", to="materials.productmaster"),
        ),
    ]
