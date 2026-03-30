import json
import os
import sys
from decimal import Decimal

import django

sys.path.insert(0, os.getcwd())
os.environ.setdefault("SKIP_CELERY_IMPORT", "1")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from apps.costing.models import MaterialCostSnapshot, ProcessCostRate
from apps.factory.models import Plant, PlantLegalProfile, Process
from apps.materials.models import InventoryMaterial
from apps.routing.models import RoutingRule
from apps.sales.models import Customer, Quotation, SalesSku, SalesSkuVariant
from apps.templates.models import TemplateBlueprint
from scripts.e2e_green_utils import CODE_PREFIX, current_run_tag, label, runtime_dir


RUN_TAG = current_run_tag()
PLANT_CODE = f"{CODE_PREFIX}-QPLANT"
PLANT_NAME = label("Quote Plant")
CUSTOMER_CODE = f"{CODE_PREFIX}-QCUST"
CUSTOMER_NAME = label("Quote Customer")
TEMPLATE_NAME = label("Quote Pouch")
SKU_CODE = f"{CODE_PREFIX}-QSKU"
SKU_NAME = label("Quote Sales SKU")
SKU_VARIANT_CODE = f"{CODE_PREFIX}-QSKU-3SS"
SKU_VARIANT_NAME = label("Quote Sales SKU 3 Side Seal")


plant, _ = Plant.objects.update_or_create(
    code=PLANT_CODE,
    defaults={"name": PLANT_NAME},
)
PlantLegalProfile.objects.update_or_create(
    plant=plant,
    defaults={
        "legal_name": f"{PLANT_NAME} LLP",
        "gstin": "24ABCDE1234F1Z5",
        "address": "Quotation Testing Estate, Ahmedabad",
        "contact_phone": "9999999999",
        "contact_email": "uat-green-quotes@example.com",
    },
)

customer, _ = Customer.objects.update_or_create(
    code=CUSTOMER_CODE,
    defaults={"name": CUSTOMER_NAME},
)
Quotation.objects.filter(customer=customer).exclude(status="CONVERTED").update(status="EXPIRED")

family, _ = InventoryMaterial.objects.update_or_create(
    code=f"{CODE_PREFIX}-QFAM",
    defaults={
        "name": label("Quote PE Film"),
        "category": "FILM_FAMILY",
        "density_gcm3": Decimal("0.9200"),
        "status": "ACTIVE",
        "is_purchasable": True,
        "is_extrudable": False,
    },
)
variant, _ = InventoryMaterial.objects.update_or_create(
    code=f"{CODE_PREFIX}-QVAR",
    defaults={
        "name": label("Quote PE Film 50u"),
        "category": "FILM_VARIANT",
        "parent_family": family,
        "density_gcm3": Decimal("0.9200"),
        "status": "ACTIVE",
        "is_purchasable": True,
        "is_extrudable": False,
    },
)

if not MaterialCostSnapshot.objects.filter(material=family, avg_rate_per_kg=Decimal("205.0000")).exists():
    MaterialCostSnapshot.objects.create(material=family, avg_rate_per_kg=Decimal("205.0000"))

process, _ = Process.objects.update_or_create(
    code=f"{CODE_PREFIX}-QPRINT",
    defaults={
        "name": label("Quote Printing"),
        "input_form": "ROLL",
        "output_form": "ROLL",
        "roll_behavior": "MODIFY_EXISTING",
    },
)
rate_defaults = {
    "cost_per_hour": Decimal("1200.00"),
    "power_cost_per_hour": Decimal("300.00"),
    "labor_cost_per_hour": Decimal("400.00"),
    "overhead_cost_per_hour": Decimal("500.00"),
    "is_active": True,
}
existing_rates = ProcessCostRate.objects.filter(process=process, machine__isnull=True).order_by("created_at", "id")
primary_rate = existing_rates.first()
if primary_rate:
    for field, value in rate_defaults.items():
        setattr(primary_rate, field, value)
    primary_rate.save(update_fields=[*rate_defaults.keys(), "updated_at"])
    existing_rates.exclude(id=primary_rate.id).delete()
else:
    ProcessCostRate.objects.create(process=process, machine=None, **rate_defaults)

route_name = label("Quote Route")
routing = RoutingRule.objects.filter(name=route_name).order_by("id").first()
if routing:
    RoutingRule.objects.filter(name=route_name).exclude(id=routing.id).delete()
    if routing.ordered_processes != [process.code]:
        routing.ordered_processes = [process.code]
        routing.save(update_fields=["ordered_processes"])
else:
    routing = RoutingRule.objects.create(name=route_name, ordered_processes=[process.code])

template_defaults = {
    "fg_type": "POUCH",
    "status": "LIVE",
    "routing_rule": routing,
    "pouch_style": "THREE_SIDE_SEAL",
}
template = TemplateBlueprint.objects.filter(name=TEMPLATE_NAME).order_by("created_at", "id").first()
if template:
    TemplateBlueprint.objects.filter(name=TEMPLATE_NAME).exclude(id=template.id).delete()
    for field, value in template_defaults.items():
        setattr(template, field, value)
    template.save(update_fields=[*template_defaults.keys(), "updated_at"])
else:
    template = TemplateBlueprint.objects.create(name=TEMPLATE_NAME, **template_defaults)

sku, _ = SalesSku.objects.update_or_create(
    code=SKU_CODE,
    defaults={
        "name": SKU_NAME,
        "template": template,
        "default_line_name": SKU_VARIANT_NAME,
        "active": True,
    },
)

variant_geometry = {
    "base": {"width_mm": 140, "height_mm": 220},
    "pouch_style": "THREE_SIDE_SEAL",
    "gusset_mm": 0,
    "trim_loss_mm": 0,
    "flap_tape_mm": 0,
    "adjustments": [],
    "multipliers": {"faces": 1},
}
variant_layers = [
    {
        "family_id": str(family.id),
        "variant_id": str(variant.id),
        "thickness_micron": 50,
        "roll_width_mm": 140,
        "density_g_cm3": 0.92,
    }
]
variant_printing = {
    "enabled": False,
    "type": "FLEXO",
    "substrate_mode": "SHEET",
    "front_colors_count": 0,
    "back_colors_count": 0,
    "ink_gsm_total": 0,
}
variant_packaging = {
    "pod": {
        "enabled": False,
        "pod_profile_id": None,
        "pod_sku_variant_id": None,
        "pod_sku_code": None,
        "pod_sku_name": None,
    },
    "note": "",
}
sku_variant, _ = SalesSkuVariant.objects.update_or_create(
    sku=sku,
    code=SKU_VARIANT_CODE,
    defaults={
        "name": SKU_VARIANT_NAME,
        "active": True,
        "finished_good_type": "POUCH",
        "roll_form": "",
        "geometry_snapshot": variant_geometry,
        "layer_snapshot": variant_layers,
        "printing_snapshot": variant_printing,
        "chemicals_snapshot": {"adhesive_gsm": 0, "solvent_gsm": 0},
        "addons_snapshot": [],
        "packaging_snapshot": variant_packaging,
    },
)

payload = {
    "run_tag": RUN_TAG,
    "label_prefix": label("").strip(),
    "customer_id": str(customer.id),
    "customer_name": customer.name,
    "plant_id": str(plant.id),
    "plant_name": plant.name,
    "template_id": str(template.id),
    "template_name": template.name,
    "sku_id": str(sku.id),
    "sku_name": sku.name,
    "sku_variant_id": str(sku_variant.id),
    "sku_variant_name": sku_variant.name,
    "sku_variant_code": sku_variant.code,
    "film_family_id": str(family.id),
    "film_family_name": family.name,
    "film_variant_id": str(variant.id),
    "film_variant_name": variant.name,
}

target = runtime_dir() / "quotation-seed.json"
target.write_text(json.dumps(payload, indent=2), encoding="utf-8")

print(f"Quotation UI E2E seed complete: {target}")
