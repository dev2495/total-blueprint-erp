import json
import os
import sys
from uuid import uuid4

import django
from django.apps import apps as django_apps
from django.utils import timezone

sys.path.insert(0, os.getcwd())
os.environ.setdefault("SKIP_CELERY_IMPORT", "1")
os.environ.setdefault("SKIP_ADMIN_APP_IMPORT", "1")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
if not django_apps.ready:
    django.setup()

from apps.factory.models import Plant
from apps.inventory.models import InventoryFinancialPeriod, InventoryLocation, Vendor
from apps.inventory.services.audit import InventoryAuditService, current_indian_financial_year, financial_year_dates
from apps.materials.models import InventoryMaterial
from scripts.e2e_green_utils import CODE_PREFIX, current_run_tag, runtime_dir


def _ensure_current_period():
    try:
        return InventoryAuditService.ensure_default_period()
    except Exception:
        fy = current_indian_financial_year()
        start, end = financial_year_dates(fy)
        return InventoryFinancialPeriod.objects.filter(financial_year=fy).first() or InventoryFinancialPeriod.objects.create(
            financial_year=fy,
            start_date=start,
            end_date=end,
            status="CLOSING_IN_PROGRESS",
        )


def _fresh_close_period():
    for year in range(2180, 2210):
        fy = f"{year}-{year + 1}"
        period = InventoryFinancialPeriod.objects.filter(financial_year=fy).first()
        if not period:
            start, end = financial_year_dates(fy)
            return InventoryFinancialPeriod.objects.create(
                financial_year=fy,
                start_date=start,
                end_date=end,
                status="CLOSING_IN_PROGRESS",
            )
        if period.status != "CLOSED":
            return period
    raise RuntimeError("Could not allocate an isolated close-period fixture.")


def main():
    run_tag = f"{current_run_tag()}{uuid4().hex[:5].upper()}"
    short = run_tag[-8:].replace("-", "")[:8]
    plant_code = f"LIFE{short}"[:20]
    material_code = f"{CODE_PREFIX}-LIFE-GR-{short}"

    plant, _ = Plant.objects.get_or_create(
        code=plant_code,
        defaults={"name": f"UI Lifecycle Plant {short}", "include_in_official_reports": False},
    )
    location, _ = InventoryLocation.objects.get_or_create(
        plant=plant,
        code="RM",
        name="Lifecycle RM",
        defaults={"type": "RM", "is_active": True},
    )
    material, _ = InventoryMaterial.objects.get_or_create(
        code=material_code,
        defaults={
            "name": f"Lifecycle Granule {short}",
            "category": "GRANULE",
            "base_uom": "KG",
            "status": "ACTIVE",
            "is_purchasable": True,
        },
    )
    vendor, _ = Vendor.objects.get_or_create(
        code=f"LIFEV{short}"[:50],
        defaults={"name": f"Lifecycle Vendor {short}", "type": "RM", "status": "ACTIVE", "qc_required": False},
    )
    current_period = _ensure_current_period()
    close_period = _fresh_close_period()

    payload = {
        "seeded_at": timezone.now().isoformat(),
        "plant_id": str(plant.id),
        "plant_code": plant.code,
        "plant_name": plant.name,
        "location_id": str(location.id),
        "location_code": location.code,
        "location_name": location.name,
        "material_id": str(material.id),
        "material_code": material.code,
        "material_name": material.name,
        "vendor_id": str(vendor.id),
        "vendor_code": vendor.code,
        "vendor_name": vendor.name,
        "current_period_id": str(current_period.id),
        "current_financial_year": current_period.financial_year,
        "close_period_id": str(close_period.id),
        "close_financial_year": close_period.financial_year,
    }

    out = runtime_dir() / "stock-lifecycle-seed.json"
    out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
