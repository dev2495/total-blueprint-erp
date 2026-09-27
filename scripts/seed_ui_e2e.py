import os
import sys
import django
from decimal import Decimal

sys.path.insert(0, os.getcwd())
os.environ.setdefault("SKIP_CELERY_IMPORT", "1")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from apps.factory.models import Machine, Plant, Process, WorkCenter, WorkCenterProcess
from apps.inventory.models import InkMaterial, InventoryLocation, Vendor
from apps.materials.models import InventoryMaterial
from apps.recipes.models import RecipeGrade
from apps.routing.models import RoutingRule

COLORS = ["YELLOW", "CYAN", "MAGENTA", "BLACK", "WHITE", "RED"]
BASES = ["POLY", "PET"]

for base in BASES:
    for color in COLORS:
        ink, created = InkMaterial.objects.get_or_create(
            base_type=base,
            color_name=color,
            defaults={
                "status": "ACTIVE",
                "is_purchasable": True,
                "is_extrudable": False,
            },
        )
        if not created:
            changed = False
            if getattr(ink, "status", "") != "ACTIVE":
                ink.status = "ACTIVE"
                changed = True
            if hasattr(ink, "is_purchasable") and not ink.is_purchasable:
                ink.is_purchasable = True
                changed = True
            if changed:
                ink.save()

Vendor.objects.get_or_create(
    code="UI_E2E_VENDOR",
    defaults={
        "name": "UI E2E Vendor",
        "type": "BOTH",
        "status": "ACTIVE",
        "payment_terms": "Immediate",
        "lead_time_days": 1,
    },
)
Vendor.objects.get_or_create(
    code="JW_VENDOR_A",
    defaults={
        "name": "UI E2E Jobwork Vendor",
        "type": "JOBWORK",
        "status": "ACTIVE",
        "jobwork_capabilities": [],
    },
)
RecipeGrade.objects.get_or_create(name="GP", defaults={"is_active": True})


def ensure_material(code, name, category, **defaults):
    material, _ = InventoryMaterial.objects.get_or_create(
        code=code,
        defaults={"name": name, "category": category, "status": "ACTIVE", **defaults},
    )
    if str(material.category or "").upper() != category or str(material.status or "").upper() != "ACTIVE":
        raise RuntimeError(f"UI E2E material {code} has unexpected category or status.")
    return material


pet_family = ensure_material(
    "UI_E2E_PET_FAMILY",
    "UI E2E PET Film Family",
    "FILM_FAMILY",
    density_gcm3=Decimal("1.3800"),
    is_purchasable=True,
)
mldpe_family = ensure_material(
    "UI_E2E_MLDPE_FAMILY",
    "UI E2E MLDPE Film Family",
    "FILM_FAMILY",
    density_gcm3=Decimal("0.9200"),
    is_purchasable=True,
)
for code, name, family, density, extrudable in (
    ("VAR_PET_12", "UI E2E PET 12 Micron", pet_family, Decimal("1.3800"), False),
    ("VAR_MLD_40", "UI E2E MLDPE 40 Micron", mldpe_family, Decimal("0.9200"), True),
):
    variant = ensure_material(
        code,
        name,
        "FILM_VARIANT",
        parent_family=family,
        density_gcm3=density,
        is_extrudable=extrudable,
        is_purchasable=True,
    )
    if variant.parent_family_id != family.id:
        raise RuntimeError(f"UI E2E film variant {code} has an unexpected parent family.")

ensure_material(
    "GRANULE_LDPE",
    "UI E2E LDPE Granule",
    "GRANULE",
    density_gcm3=Decimal("0.9200"),
    is_purchasable=True,
)
ensure_material(
    "PACK_INNER_100",
    "UI E2E Inner Pouch 100",
    "PACKAGING",
    base_uom="PCS",
    packaging_kind="INNER_POUCH",
    packaging_supply_mode="PURCHASED",
    packaging_defaults_json={"pcs_per_pack": 100, "weight_kg_per_base_uom": 0.04},
    is_purchasable=True,
)

# The mutation E2E seed needs a deterministic two-plant work-center fixture.
# Create only missing master rows and fail closed if an existing physical
# process or machine definition conflicts with the expected test contract.
extrusion, _ = Process.objects.get_or_create(
    code="EXTRUSION",
    defaults={
        "name": "Extrusion",
        "input_form": "BULK",
        "output_form": "ROLL",
        "roll_behavior": "CREATE_NEW",
        "transition": "BULK_TO_ROLL",
        "active": True,
    },
)
expected_physics = ("BULK", "ROLL", "CREATE_NEW")
actual_physics = (
    str(extrusion.input_form or "").upper(),
    str(extrusion.output_form or "").upper(),
    str(extrusion.roll_behavior or "").upper(),
)
if actual_physics != expected_physics or not extrusion.active:
    raise RuntimeError(f"EXTRUSION fixture has unexpected physical behavior: {actual_physics}.")

# Acceptance creates missing canonical process masters, then needs routes that
# finish in the matching physical output form. Keep this test fixture explicit
# so a clean migrated database does not fall back to an unrelated quote route.
for route_name, process_codes in (
    ("UI E2E Acceptance Roll Route", ["EXTRUSION", "PRINTING", "SLITTING"]),
    ("UI E2E Acceptance Pouch Route", ["EXTRUSION", "PRINTING", "POUCHING"]),
):
    route, _ = RoutingRule.objects.get_or_create(
        name=route_name,
        defaults={
            "description": "Isolated UI E2E route for acceptance fixture coverage.",
            "ordered_processes": process_codes,
            "is_active": True,
        },
    )
    if list(route.ordered_processes or []) != process_codes or not route.is_active:
        raise RuntimeError(f"{route_name} conflicts with the expected UI E2E route fixture.")

for plant_code, plant_name in (("PLANT_A", "Plant A"), ("PLANT_B", "Plant B")):
    plant, _ = Plant.objects.get_or_create(code=plant_code, defaults={"name": plant_name})
    for location_code, location_name, location_type in (
        ("RM", f"{plant_name} Raw Materials Store", "RM"),
        ("WIP", f"{plant_name} Work In Progress Store", "WIP"),
        ("WAREHOUSE", f"{plant_name} Warehouse", "WAREHOUSE"),
        ("FG", f"{plant_name} Finished Goods Store", "FG"),
    ):
        location = InventoryLocation.objects.filter(plant=plant, code=location_code).first()
        if location is None:
            location = InventoryLocation.objects.create(
                plant=plant,
                code=location_code,
                name=location_name,
                type=location_type,
                is_system=True,
            )
        if str(location.type or "").upper() != location_type or not location.is_active:
            raise RuntimeError(f"UI E2E location {plant_code}/{location_code} has an unexpected type or status.")
    center_code = f"{plant_code}_EXTRU"
    work_center, _ = WorkCenter.objects.get_or_create(
        code=center_code,
        defaults={
            "plant": plant,
            "name": f"{plant_name} Extrusion WC",
            "standard_operating_minutes_per_day": 480,
        },
    )
    if work_center.plant_id != plant.id:
        raise RuntimeError(f"Work center {center_code} is already assigned to a different plant.")
    WorkCenterProcess.objects.get_or_create(work_center=work_center, process=extrusion)

    machine_code = f"{center_code}_M1"
    machine, _ = Machine.objects.get_or_create(
        code=machine_code,
        defaults={
            "work_center": work_center,
            "name": f"{plant_name} Extrusion Machine 1",
            "status": "ACTIVE",
            "standard_rate_kg_per_hour": Decimal("120.00"),
        },
    )
    if machine.work_center_id != work_center.id or str(machine.status or "").upper() != "ACTIVE":
        raise RuntimeError(f"Machine {machine_code} is not an active machine in {center_code}.")

print("UI E2E fixture seed complete.")
