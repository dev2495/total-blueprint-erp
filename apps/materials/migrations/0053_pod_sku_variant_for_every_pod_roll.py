"""Give every POD roll its POD SKU + variant (rolls added after 0012 never got one).

The variant takes the roll's own code: sales picks POD variants by code, so every roll
needs a distinct one (several rolls all named CORE would resolve to the first).
"""
from django.db import migrations


def backfill(apps, schema_editor):
    InventoryMaterial = apps.get_model("materials", "InventoryMaterial")
    PodSku = apps.get_model("materials", "PodSku")
    PodSkuVariant = apps.get_model("materials", "PodSkuVariant")
    covered = set(PodSkuVariant.objects.values_list("material_id", flat=True))
    for material in InventoryMaterial.objects.filter(category="POD").exclude(id__in=covered):
        code = str(material.code or "").strip().upper()
        name = str(material.name or code).strip()
        family = str(material.pod_type or "POD").strip().upper() or "POD"
        active = str(material.status or "ACTIVE").upper() == "ACTIVE"
        pod_sku, _ = PodSku.objects.get_or_create(code=code, defaults={"name": name, "family": family, "active": active})
        PodSkuVariant.objects.get_or_create(
            pod_sku=pod_sku,
            code=code,
            defaults={
                "name": name,
                "material_id": material.id,
                "active": active,
                "production_defaults_json": {},
                "reporting_attributes_json": {"pod_type": family},
            },
        )


class Migration(migrations.Migration):
    dependencies = [("materials", "0052_floor_logic_contracts")]
    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
