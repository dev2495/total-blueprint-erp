import json
import os
import sys
from decimal import Decimal
from pathlib import Path

import django

sys.path.insert(0, os.getcwd())
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from apps.costing.models import MaterialCostSnapshot, ProcessCostRate
from apps.factory.models import Plant, PlantLegalProfile, Process
from apps.materials.models import InventoryMaterial
from apps.routing.models import RoutingRule
from apps.sales.models import Customer
from apps.templates.models import TemplateBlueprint


def runtime_dir() -> Path:
    target = Path(os.environ.get("UI_E2E_RUNTIME_DIR", Path(os.getcwd()) / ".runtime" / "ui-e2e"))
    target.mkdir(parents=True, exist_ok=True)
    return target


plant, _ = Plant.objects.update_or_create(
    code="UIE2E-QPLANT",
    defaults={"name": "UI E2E Quote Plant"},
)
PlantLegalProfile.objects.update_or_create(
    plant=plant,
    defaults={
        "legal_name": "UI E2E Quote Plant LLP",
        "gstin": "24ABCDE1234F1Z5",
        "address": "Quotation Testing Estate, Ahmedabad",
        "contact_phone": "9999999999",
        "contact_email": "quotes-ui@example.com",
    },
)

customer, _ = Customer.objects.update_or_create(
    code="UIE2E-QCUST",
    defaults={"name": "UI E2E Quote Customer"},
)

family, _ = InventoryMaterial.objects.update_or_create(
    code="UIE2E-QFAM",
    defaults={
        "name": "UI E2E PE Film",
        "category": "FILM_FAMILY",
        "density_gcm3": Decimal("0.9200"),
        "status": "ACTIVE",
        "is_purchasable": True,
        "is_extrudable": False,
    },
)
variant, _ = InventoryMaterial.objects.update_or_create(
    code="UIE2E-QVAR",
    defaults={
        "name": "UI E2E PE Film 50u",
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
    code="UIE2E-QPRINT",
    defaults={
        "name": "UI E2E Quote Printing",
        "input_form": "ROLL",
        "output_form": "ROLL",
        "roll_behavior": "MODIFY_EXISTING",
    },
)
ProcessCostRate.objects.update_or_create(
    process=process,
    machine=None,
    defaults={
        "cost_per_hour": Decimal("1200.00"),
        "power_cost_per_hour": Decimal("300.00"),
        "labor_cost_per_hour": Decimal("400.00"),
        "overhead_cost_per_hour": Decimal("500.00"),
        "is_active": True,
    },
)

routing, _ = RoutingRule.objects.get_or_create(
    name="UI E2E Quote Route",
    defaults={"ordered_processes": [process.code]},
)
if routing.ordered_processes != [process.code]:
    routing.ordered_processes = [process.code]
    routing.save(update_fields=["ordered_processes"])

template, _ = TemplateBlueprint.objects.update_or_create(
    name="UI E2E Quote Pouch",
    defaults={
        "fg_type": "POUCH",
        "status": "LIVE",
        "routing_rule": routing,
        "pouch_style": "THREE_SIDE_SEAL",
    },
)

payload = {
    "customer_id": str(customer.id),
    "customer_name": customer.name,
    "plant_id": str(plant.id),
    "plant_name": plant.name,
    "template_id": str(template.id),
    "template_name": template.name,
    "film_family_id": str(family.id),
    "film_variant_id": str(variant.id),
}

target = runtime_dir() / "quotation-seed.json"
target.write_text(json.dumps(payload, indent=2), encoding="utf-8")

print(f"Quotation UI E2E seed complete: {target}")
