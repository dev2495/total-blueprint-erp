#!/usr/bin/env python3
import os
import sys
from decimal import Decimal
from pathlib import Path

import django

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from apps.factory.models import Process
from apps.inventory.models import InventoryBulk
from apps.materials.models import GranuleQualityCode, InventoryMaterial
from apps.production.models import ProductionJob
from apps.production.services.services_execution import ExecutionService
from apps.templates.models import TemplateProcessStep


DEMO_JOB_NUMBERS = [
    "DRYFRUIT-WCM-DEMO-WCM",
    "DRYFRUIT-WCM-DEMO-MACHINE",
]

CODE_SPLITS = [
    ("LDPE-A", Decimal("12.0000")),
    ("LDPE-B", Decimal("10.0000")),
    ("LDPE-C", Decimal("8.0000")),
]


def resolve_granule():
    granule = (
        InventoryMaterial.objects.filter(category="GRANULE", code="GRANULE_LDPE").first()
        or InventoryMaterial.objects.filter(category="GRANULE").order_by("code").first()
    )
    if granule:
        return granule
    return InventoryMaterial.objects.create(
        code="GRANULE_LDPE",
        name="LDPE Granule",
        category="GRANULE",
        base_uom="KG",
    )


def resolve_step(job: ProductionJob):
    steps = list(
        TemplateProcessStep.objects.select_related("process")
        .filter(template=job.template)
        .order_by("sequence_number")
    )
    step = next(
        (
            row
            for row in steps
            if str(getattr(getattr(row, "process", None), "input_form", "") or "").upper() == "BULK"
            and str(getattr(getattr(row, "process", None), "output_form", "") or "").upper() == "ROLL"
        ),
        None,
    )
    if step:
        return step
    process = (
        Process.objects.filter(code__icontains="EXTR").first()
        or Process.objects.filter(name__icontains="Extrusion").first()
    )
    if process and job.template_id:
        step, _ = TemplateProcessStep.objects.get_or_create(
            template=job.template,
            sequence_number=1,
            defaults={"process": process},
        )
        return step
    raise RuntimeError(f"Could not resolve an extrusion step for {job.job_number}.")


def ensure_code_stock(job: ProductionJob, granule: InventoryMaterial):
    if not job.from_location_id:
        raise RuntimeError(f"{job.job_number} has no source location.")
    for code_value, qty in CODE_SPLITS:
        code, _ = GranuleQualityCode.objects.get_or_create(
            granule=granule,
            code=code_value,
            defaults={"status": "ACTIVE"},
        )
        InventoryBulk.objects.update_or_create(
            material=granule,
            granule_code=code,
            plant_id=job.work_center.plant_id if job.work_center_id else job.from_location.plant_id,
            location_id=job.from_location_id,
            defaults={
                "qty_kg": qty,
                "avg_cost": Decimal("82.2500"),
            },
        )


def update_bom(job: ProductionJob, granule: InventoryMaterial, step: TemplateProcessStep):
    source_item = getattr(job, "sales_order_item", None) or getattr(job, "mts_order", None)
    if source_item is None:
        raise RuntimeError(f"{job.job_number} has no sales or MTS source snapshot to patch.")
    bom = dict(getattr(source_item, "bom_snapshot", None) or {})
    granules = bom.get("granules") if isinstance(bom.get("granules"), list) else []
    if not any(str(row.get("granule_id") or "") == str(granule.id) for row in granules if isinstance(row, dict)):
        granules.append(
            {
                "granule_id": str(granule.id),
                "code": granule.code,
                "name": granule.name,
                "percentage": 100,
                "weight_kg": float(Decimal(str(job.quantity or 0)).quantize(Decimal("0.0001"))),
                "layer_index": 1,
            }
        )
    bom["granules"] = granules

    planning_lines = bom.get("planning_lines") if isinstance(bom.get("planning_lines"), list) else []
    planning_lines = [row for row in planning_lines if not (isinstance(row, dict) and str(row.get("category_code") or "").upper() == "GRANULE")]
    planning_lines.append(
        {
            "policy_key": f"GRANULE:{granule.id}",
            "category_code": "GRANULE",
            "material_id": str(granule.id),
            "material_code": granule.code,
            "material_name": granule.name,
            "uom": "KG",
            "step_id": str(step.id),
            "step_sequence": int(step.sequence_number or 1),
            "step_name": str(getattr(step.process, "name", "") or f"Step {step.sequence_number}"),
            "consumption_basis": "FIXED_KG",
            "formula_driver": "NONE",
            "formula_params": {},
            "capture_mode": "AUTO_ESTIMATED_CONFIRM",
            "split_pct": 100.0,
            "theoretical_qty": float(Decimal(str(job.quantity or 0)).quantize(Decimal("0.0001"))),
            "planned_issue_qty": float(Decimal(str(job.quantity or 0)).quantize(Decimal("0.0001"))),
            "template_issue_policy_mode": "NONE",
            "template_issue_policy_value": 0.0,
            "override_issue_policy_mode": None,
            "override_issue_policy_value": None,
            "effective_issue_policy_mode": "NONE",
            "effective_issue_policy_value": 0.0,
            "policy_source": "LOCAL_DEMO_PATCH",
        }
    )
    bom["planning_lines"] = planning_lines
    source_item.bom_snapshot = bom
    source_item.save(update_fields=["bom_snapshot"])


def main():
    granule = resolve_granule()
    jobs = list(
        ProductionJob.objects.select_related("template", "work_center", "from_location", "sales_order_item", "mts_order")
        .filter(job_number__in=DEMO_JOB_NUMBERS)
    )
    if not jobs:
        print("No dryfruit demo jobs found.")
        return

    for job in jobs:
        step = resolve_step(job)
        ensure_code_stock(job, granule)
        update_bom(job, granule, step)
        ExecutionService.calculate_requirements(job.id)
        status = ExecutionService.get_satisfaction_status(job.id)
        print(
            f"{job.job_number}: granules={len((getattr(getattr(job, 'sales_order_item', None), 'bom_snapshot', None) or getattr(getattr(job, 'mts_order', None), 'bom_snapshot', None) or {}).get('granules') or [])} "
            f"bulk_rows={len(status.get('bulk_consumption') or [])} "
            f"source={job.from_location.code if job.from_location_id else 'NONE'}"
        )


if __name__ == "__main__":
    main()
