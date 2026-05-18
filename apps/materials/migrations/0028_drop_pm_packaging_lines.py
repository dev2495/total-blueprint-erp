"""
Data-only migration. Strips the deprecated ``packaging_lines`` and ``pod_*``
keys from every ``ProductMaster.fixed_attributes`` JSON blob.

Why
---
With the v37 model rework, PM-locked packing (gunny / sheet / tape / label /
tag) is no longer carried on the master — packing yard ticks it per order at
EOD via ``PackingViewSet.order_consumption_post``. POD is a sales-pickable axis
(``pod_variant``) rather than a PM-locked SKU. The legacy
``fixed_attributes.packaging_lines`` array and ``pod_enabled / pod_variant``
trio still sit in old masters but are no longer surfaced anywhere in the UI
and the BOM resolver tolerates their absence.

This migration deletes those keys so the data matches the model. It is
idempotent: rerunning does nothing on rows that have already been cleaned.

Reverse is a no-op (we can't reliably reconstruct the deleted blobs and the
keys were already inert).
"""

from django.db import migrations


def _strip_deprecated_packaging_keys(apps, schema_editor):
    ProductMaster = apps.get_model("materials", "ProductMaster")
    DEPRECATED_KEYS = {
        "packaging_lines",
        "pod_enabled",
        "pod_variant",
        "pod_variant_code",
        "pod_material",
        "pod_material_code",
        "pod_profile",
    }
    cleaned = 0
    inspected = 0
    for pm in ProductMaster.objects.all().iterator(chunk_size=200):
        inspected += 1
        fixed = pm.fixed_attributes if isinstance(pm.fixed_attributes, dict) else {}
        hits = [k for k in DEPRECATED_KEYS if k in fixed]
        if not hits:
            continue
        for k in hits:
            fixed.pop(k, None)
        pm.fixed_attributes = fixed
        pm.save(update_fields=["fixed_attributes"])
        cleaned += 1
    # Visible in migrate output / logs
    print(f"  [materials.0028] inspected={inspected} cleaned={cleaned}")


def _noop_reverse(apps, schema_editor):
    # Data was already inert — nothing to restore.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0027_addon_purchasable_defaults"),
    ]

    operations = [
        migrations.RunPython(_strip_deprecated_packaging_keys, _noop_reverse),
    ]
