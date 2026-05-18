"""
Schema migration for the unified PACKAGING + POD master model.

Adds two fields:

  - ``ProductMaster.packaging_kind`` — subtype for PACKAGING masters
    (INNER_POUCH or SHEET). Null for non-PACKAGING masters.

  - ``InventoryMaterial.produced_by_product_variant`` — manual back-link to
    the ProductVariant that can produce this fixed catalog row. Null means the
    SKU is purchased/manual and not currently tied to an in-house PM variant.

Both fields are nullable + reversible — safe to run on existing data.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0028_drop_pm_packaging_lines"),
    ]

    operations = [
        migrations.AddField(
            model_name="productmaster",
            name="packaging_kind",
            field=models.CharField(
                blank=True,
                choices=[
                    ("INNER_POUCH", "Inner Pouch"),
                    ("SHEET", "Sheet / Roll for packing"),
                ],
                help_text=(
                    "Only set for PACKAGING masters. INNER_POUCH = inner "
                    "pouch carrier · SHEET = roll for packing."
                ),
                max_length=20,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="inventorymaterial",
            name="produced_by_product_variant",
            field=models.ForeignKey(
                blank=True,
                help_text=(
                    "Manual back-link to the ProductVariant that can produce "
                    "this fixed catalog row (PACKAGING / POD masters). Null "
                    "for purchased/manual SKUs."
                ),
                null=True,
                on_delete=models.deletion.SET_NULL,
                related_name="inventory_links",
                to="materials.productvariant",
            ),
        ),
    ]
