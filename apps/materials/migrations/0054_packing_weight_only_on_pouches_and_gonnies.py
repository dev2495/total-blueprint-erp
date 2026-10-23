"""Only inner pouches and gonnies carry a weight (owner rule, 23 Oct 2026).

In-house inner pouches take it from their linked Product Master BOM, so a typed weight is
dropped; bought pouches and gonnies keep theirs. Every other packing item (sheets, rolls,
tape, cartons, extras) is counted in its own unit at the evening count and keeps no weight.
"""
from django.db import migrations

WEIGHT_KEYS = ("weight_kg_per_base_uom", "tare_kg_per_meter", "kg_per_piece", "kg_per_inner_pouch", "kg_per_inner", "unit_base_qty", "base_qty_per_consumed_unit")


def forwards(apps, schema_editor):
    InventoryMaterial = apps.get_model("materials", "InventoryMaterial")
    for material in InventoryMaterial.objects.filter(category="PACKAGING"):
        kind = str(material.packaging_kind or "").upper()
        mode = str(material.packaging_supply_mode or "").upper()
        keep = kind == "GONNY" or (kind == "INNER_POUCH" and mode in {"PURCHASED", "BOTH"})
        defaults = dict(material.packaging_defaults_json or {})
        changed = False
        for key in WEIGHT_KEYS:
            if key in defaults and not (keep and key == "weight_kg_per_base_uom" and str(material.base_uom or "").upper() != "KG"):
                defaults.pop(key)
                changed = True
        if material.per_sheet_base_qty is not None and not (keep and str(material.base_uom or "").upper() == "KG"):
            material.per_sheet_base_qty = None
            changed = True
        if changed:
            material.packaging_defaults_json = defaults
            material.save(update_fields=["packaging_defaults_json", "per_sheet_base_qty"])


class Migration(migrations.Migration):
    dependencies = [("materials", "0053_pod_sku_variant_for_every_pod_roll")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
