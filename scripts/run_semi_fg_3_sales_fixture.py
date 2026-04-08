#!/usr/bin/env python3
"""
Scripted local fixture:
1) Create semi-FG stock order (step-stop),
2) Consume that semi roll flow across 3 sales orders with different pouch sizes,
3) Emit one audit report for WIP lineage + targets + dispatch readiness.

Usage:
  venv_311/bin/python scripts/run_semi_fg_3_sales_fixture.py
"""

import json
import os
import sys
import uuid
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, List, Optional

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django

django.setup()

from django.utils import timezone
from django.db.models import Sum
from rest_framework.test import APIClient

from apps.users.models import User
from apps.sales.models import SalesOrder, SalesOrderItem, Customer
from apps.sales.services.order_service import SalesOrderService
from apps.templates.models import TemplateBlueprint, TemplateProcessStep
from apps.materials.models import InventoryMaterial
from apps.recipes.models import RecipeGrade
from apps.production.models import ProductionJob, FinishedGoodsBatch, JobExecutionLog
from apps.production.services.job_services import JobService
from apps.production.services.services_execution import ExecutionService
from apps.inventory.models import (
    InventoryLocation,
    InventoryReservation,
    InventoryRoll,
    RollLink,
)


DEFAULT_TEMPLATE_ID = "7cd05e87-6ec0-489f-8b0f-2df9f4234638"


def _d(value: Any) -> Decimal:
    try:
        return Decimal(str(value if value is not None else 0))
    except Exception:
        return Decimal("0")


def _as_float(value: Any) -> float:
    try:
        return float(value)
    except Exception:
        return 0.0


def _admin_user() -> User:
    user = (
        User.objects.filter(is_superuser=True).first()
        or User.objects.filter(role_info__code__in=["SUPER_ADMIN", "ADMIN"]).first()
        or User.objects.first()
    )
    if not user:
        raise RuntimeError("No admin/superuser found.")
    return user


def _fixture_customer() -> Customer:
    customer = Customer.objects.filter(code="FX-SEMIFG").first()
    if customer:
        return customer
    return Customer.objects.create(name="Fixture SemiFG Customer", code="FX-SEMIFG")


def _api_client(user: User) -> APIClient:
    client = APIClient()
    client.defaults["HTTP_HOST"] = "127.0.0.1"
    client.force_authenticate(user=user)
    return client


def _pick_template() -> TemplateBlueprint:
    preferred = TemplateBlueprint.objects.filter(
        id=DEFAULT_TEMPLATE_ID,
        status="LIVE",
        routing_rule__isnull=False,
    ).first()
    if preferred:
        return preferred

    # Fallback: choose LIVE pouch template with a 2-step route where step-1 is roll->roll and step-2 is roll->bulk.
    for tpl in TemplateBlueprint.objects.filter(status="LIVE", fg_type="POUCH", routing_rule__isnull=False):
        steps = list(
            TemplateProcessStep.objects.filter(template=tpl).select_related("process").order_by("sequence_number")
        )
        if len(steps) < 2:
            continue
        s1 = steps[0].process
        s2 = steps[1].process
        if (
            str(s1.input_form).upper() == "ROLL"
            and str(s1.output_form).upper() == "ROLL"
            and str(s2.input_form).upper() == "ROLL"
            and str(s2.output_form).upper() == "BULK"
        ):
            return tpl
    raise RuntimeError("No suitable LIVE POUCH template found for fixture.")


def _source_item_for_template(template: TemplateBlueprint) -> SalesOrderItem:
    source = (
        SalesOrderItem.objects.filter(template=template)
        .exclude(layer_snapshot=[])
        .exclude(layer_snapshot=None)
        .order_by("-created_at")
        .first()
    )
    if not source:
        raise RuntimeError(f"No source SalesOrderItem with snapshots found for template {template.id}.")
    if not isinstance(source.geometry_snapshot, dict):
        raise RuntimeError("Source item geometry snapshot is invalid.")
    if not isinstance(source.layer_snapshot, list) or not source.layer_snapshot:
        raise RuntimeError("Source item layer snapshot is missing.")
    return source


def _clone_geometry(base_geometry: Dict[str, Any], width_mm: float, height_mm: float) -> Dict[str, Any]:
    geo = dict(base_geometry or {})
    base = geo.get("base") if isinstance(geo.get("base"), dict) else {}
    base = dict(base)
    base["width_mm"] = float(width_mm)
    base["height_mm"] = float(height_mm)
    geo["base"] = base
    geo["finished_good_type"] = "POUCH"
    geo.setdefault("adjustments", [])
    geo.setdefault("multipliers", {"faces": 1, "repeats": 1})
    return geo


def _resolve_roll_location_for_job(job: ProductionJob) -> InventoryLocation:
    if job.from_location_id:
        return job.from_location
    if job.work_center_id and getattr(job.work_center, "default_wip_location_id", None):
        return job.work_center.default_wip_location

    plant_id = (
        getattr(getattr(job, "work_center", None), "plant_id", None)
        or getattr(getattr(job, "to_location", None), "plant_id", None)
    )
    if not plant_id:
        raise RuntimeError(f"Cannot resolve plant/location for job {job.id}.")
    loc = (
        InventoryLocation.objects.filter(plant_id=plant_id, type="RM", is_active=True)
        .order_by("-is_system", "name")
        .first()
    )
    if loc:
        return loc
    loc = (
        InventoryLocation.objects.filter(plant_id=plant_id, is_active=True)
        .order_by("-is_system", "name")
        .first()
    )
    if not loc:
        raise RuntimeError(f"No inventory location found for plant {plant_id}.")
    return loc


def _seed_fixture_raw_roll(job: ProductionJob, layer_snapshot: List[Dict[str, Any]], fixture_tag: str, min_weight_kg: Decimal) -> InventoryRoll:
    first_layer = layer_snapshot[0] if layer_snapshot else {}
    variant_id = str(first_layer.get("variant_id") or first_layer.get("material_id") or "")
    if not variant_id:
        raise RuntimeError("First layer has no variant_id/material_id.")

    material = InventoryMaterial.objects.filter(id=variant_id).first()
    if not material:
        raise RuntimeError(f"Variant material not found: {variant_id}")

    thickness = _d(first_layer.get("thickness_micron") or 0)
    if thickness <= 0:
        thickness = Decimal("12")

    width_mm = _d(first_layer.get("roll_width_mm") or 0)
    if width_mm <= 0:
        width_mm = Decimal("1000")
    elif width_mm < Decimal("1000"):
        width_mm = Decimal("1000")

    location = _resolve_roll_location_for_job(job)
    grade = None
    if bool(getattr(material, "is_extrudable", False)):
        grade_id = first_layer.get("grade_id")
        if grade_id:
            grade = RecipeGrade.objects.filter(id=str(grade_id)).first()
        if not grade:
            grade = RecipeGrade.objects.first()
        if not grade:
            raise RuntimeError("Extrudable material requires grade but no RecipeGrade exists.")

    roll_weight = max(min_weight_kg + Decimal("25"), Decimal("60"))
    label = f"FX-SEMI-{fixture_tag[:8].upper()}-{uuid.uuid4().hex[:6].upper()}"
    roll = InventoryRoll.objects.create(
        label_id=label,
        material=material,
        thickness_micron=thickness,
        width_mm=width_mm,
        grade=grade,
        weight_kg=roll_weight,
        original_weight_kg=roll_weight,
        plant=location.plant,
        location=location,
        status="AVAILABLE",
        template=job.template,
        stage_index=0,
        current_step_index=0,
        completed_step_index=0,
        meta_json={
            "fixture_tag": fixture_tag,
            "roll_role": "RAW_MATERIAL",
            "fixture_source": "seed_raw_input",
        },
    )
    return roll


def _pick_fixture_roll(fixture_tag: str, template_id: str, min_weight: Decimal = Decimal("0.1")) -> InventoryRoll:
    roll = (
        InventoryRoll.objects.filter(
            template_id=template_id,
            status="AVAILABLE",
            weight_kg__gt=min_weight,
            meta_json__fixture_tag=fixture_tag,
        )
        .order_by("-weight_kg", "created_at")
        .first()
    )
    if not roll:
        raise RuntimeError("No available fixture-tagged roll found for allocation.")
    return roll


def _step_target(job: ProductionJob) -> Decimal:
    profile = ExecutionService.get_step_execution_profile(str(job.id)) or {}
    target = _d(profile.get("step_target_total_kg"))
    if target <= 0:
        target = _d(job.quantity)
    return target


def _complete_job(job: ProductionJob, user: User):
    try:
        JobService.complete_step(job, user=user)
    except Exception:
        # Force-close only if still open and variance gating triggers.
        refreshed = ProductionJob.objects.get(id=job.id)
        if refreshed.job_state in {"EXECUTING", "PAUSED"}:
            JobService.complete_step(refreshed, user=user, force_reason="Fixture force-close for remaining variance")


def _execute_modify_job(job: ProductionJob, input_roll: InventoryRoll, user: User, target_kg: Decimal):
    JobService.start_job(job)
    try:
        ExecutionService.assign_roll_to_job(str(job.id), str(input_roll.id), user=user, manual_override=False)
    except Exception:
        ExecutionService.assign_roll_to_job(
            str(job.id),
            str(input_roll.id),
            user=user,
            manual_override=True,
            override_reason="Fixture override: force semi-flow continuity",
        )
    input_roll.refresh_from_db()
    output_kg = min(target_kg, _d(input_roll.weight_kg))
    if output_kg <= 0:
        raise RuntimeError(f"Input roll {input_roll.label_id} has no weight to consume.")
    JobService.log_output_event(job, output_kg, user=user)
    _complete_job(job, user)


def _execute_roll_to_bulk_job(job: ProductionJob, input_roll: InventoryRoll, user: User, target_kg: Decimal):
    JobService.start_job(job)
    try:
        ExecutionService.assign_roll_to_job(str(job.id), str(input_roll.id), user=user, manual_override=False)
    except Exception:
        ExecutionService.assign_roll_to_job(
            str(job.id),
            str(input_roll.id),
            user=user,
            manual_override=True,
            override_reason="Fixture override: force semi-flow continuity",
        )
    input_roll.refresh_from_db()
    output_kg = min(target_kg, _d(input_roll.weight_kg))
    if output_kg <= 0:
        raise RuntimeError(f"Input roll {input_roll.label_id} has no weight to consume.")

    unit_weight_g = _d(ExecutionService._job_unit_weight_g(job))
    if unit_weight_g > 0:
        output_pcs = int(((output_kg * Decimal("1000")) / unit_weight_g).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    else:
        output_pcs = max(1, int(output_kg.quantize(Decimal("1"), rounding=ROUND_HALF_UP)))

    JobService.log_output_event(
        job,
        output_kg,
        completion_meta={"output_pcs": int(output_pcs)},
        user=user,
    )
    _complete_job(job, user)


def _job_audit(job: ProductionJob) -> Dict[str, Any]:
    profile = ExecutionService.get_step_execution_profile(str(job.id)) or {}
    produced_logs = JobExecutionLog.objects.filter(production_job=job).aggregate(total=Sum("quantity")).get("total") or Decimal("0")
    return {
        "job_id": str(job.id),
        "job_number": job.job_number,
        "state": job.job_state,
        "status": job.status,
        "step_index": int(job.current_step_index or 0),
        "target_kg": _as_float(profile.get("step_target_total_kg") or 0),
        "produced_kg_profile": _as_float(profile.get("step_produced_kg") or 0),
        "remaining_kg_profile": _as_float(profile.get("step_remaining_kg") or 0),
        "produced_kg_logs": _as_float(produced_logs),
    }


def _lineage_rows(fixture_tag: str) -> List[Dict[str, Any]]:
    rolls = list(
        InventoryRoll.objects.filter(meta_json__fixture_tag=fixture_tag)
        .select_related("template", "location", "material", "created_by_job", "sales_order_item")
        .order_by("created_at")
    )
    if not rolls:
        return []

    parent_map: Dict[str, List[str]] = {}
    links = RollLink.objects.filter(child_roll_id__in=[r.id for r in rolls]).values_list("child_roll_id", "parent_roll_id")
    for child_id, parent_id in links:
        parent_map.setdefault(str(child_id), []).append(str(parent_id))

    rows: List[Dict[str, Any]] = []
    for roll in rolls:
        rows.append(
            {
                "roll_id": str(roll.id),
                "label_id": roll.label_id,
                "status": roll.status,
                "weight_kg": _as_float(roll.weight_kg),
                "stage_index": int(roll.stage_index or 0),
                "current_step_index": int(roll.current_step_index or 0),
                "completed_step_index": int(roll.completed_step_index or 0),
                "material": roll.material.name if roll.material else None,
                "template_id": str(roll.template_id) if roll.template_id else None,
                "location": roll.location.name if roll.location_id else None,
                "created_by_job": roll.created_by_job.job_number if roll.created_by_job_id else None,
                "sales_order_item_id": str(roll.sales_order_item_id) if roll.sales_order_item_id else None,
                "roll_role": str((roll.meta_json or {}).get("roll_role") or ""),
                "is_remainder": bool((roll.meta_json or {}).get("is_remainder")),
                "parents": parent_map.get(str(roll.id), []),
            }
        )
    return rows


def _print_compact_report(report: Dict[str, Any]):
    print("\n=== Semi-FG Fixture Audit Summary ===")
    stock = report.get("stock_order", {})
    print(f"fixture_tag: {report.get('fixture_tag')}")
    print(f"template: {stock.get('template_name')} ({stock.get('template_id')})")
    print(f"stock_order: {stock.get('order_number')} status={stock.get('status')}")
    print(f"stock_job: {stock.get('stock_job_number')} target_kg={stock.get('stock_job_target_kg')} produced_kg={stock.get('stock_job_produced_kg')}")
    print(f"seed_roll: {stock.get('seed_roll_label')} -> semi_roll_weight_kg={stock.get('semi_roll_available_kg')}")
    print(f"sales_orders: {len(report.get('sales_orders', []))}")
    for row in report.get("sales_orders", []):
        print(
            f"  - {row.get('order_number')} size={row.get('geometry')} "
            f"target_kg={row.get('target_kg')} status={row.get('status')} "
            f"packing_ready={row.get('packing_ready')} dispatch_ready={row.get('dispatch_ready')} "
            f"fg_batches={row.get('fg_batches_count')}"
        )
    print(f"lineage_roll_count: {len(report.get('wip_lineage', []))}")
    print(f"audit_report_file: {report.get('audit_report_file')}")


def main() -> int:
    fixture_tag = f"semi_fg_{uuid.uuid4().hex[:10]}"
    user = _admin_user()
    customer = _fixture_customer()
    client = _api_client(user)
    template = _pick_template()
    source_item = _source_item_for_template(template)

    # Base snapshots reused across stock + sales; only pouch size changes.
    source_geometry = dict(source_item.geometry_snapshot or {})
    source_layers = list(source_item.layer_snapshot or [])
    source_printing = {"enabled": False}
    source_addons: List[Dict[str, Any]] = []
    stock_geometry = _clone_geometry(source_geometry, 260.0, 360.0)

    # 1) Create semi-FG stock order at step-stop (0 -> 0)
    create_stock_payload = {
        "name": f"Fixture SemiFG {fixture_tag}",
        "template_id": str(template.id),
        "quantity": 55,
        "quantity_uom": "KG",
        "start_step_index": 0,
        "stop_step_index": 0,
        "geometry": stock_geometry,
        "film_layers": source_layers,
        "printing": source_printing,
        "addons": source_addons,
    }
    create_stock_resp = client.post("/api/production/planner/create-stock-order/", create_stock_payload, format="json")
    if create_stock_resp.status_code != 201:
        raise RuntimeError(f"create-stock-order failed: {create_stock_resp.status_code} {create_stock_resp.data}")
    stock_order_id = str(create_stock_resp.data["stock_order_id"])

    plan_stock_resp = client.post(
        f"/api/production/planner/control-hub/stock/{stock_order_id}/plan/",
        {"option": "FRESH", "start_step_index": 0, "stop_step_index": 0},
        format="json",
    )
    if plan_stock_resp.status_code != 200:
        raise RuntimeError(f"stock plan failed: {plan_stock_resp.status_code} {plan_stock_resp.data}")

    release_stock_resp = client.post(f"/api/production/planner/control-hub/stock/{stock_order_id}/release/", {}, format="json")
    if release_stock_resp.status_code != 200:
        raise RuntimeError(f"stock release failed: {release_stock_resp.status_code} {release_stock_resp.data}")

    from apps.production.models import PlannedStockOrder

    stock_obj = PlannedStockOrder.objects.get(id=stock_order_id)
    stock_job = ProductionJob.objects.filter(mts_order=stock_obj, current_step_index=0).order_by("created_at").first()
    if not stock_job:
        raise RuntimeError("No stock job created after planning/release.")

    stock_target_kg = _step_target(stock_job)
    seed_roll = _seed_fixture_raw_roll(stock_job, source_layers, fixture_tag, min_weight_kg=stock_target_kg)
    _execute_modify_job(stock_job, seed_roll, user, stock_target_kg)
    stock_job.refresh_from_db()

    # 2) Consume semi-flow across 3 sales orders with different pouch sizes
    sales_specs = [
        {"width_mm": 180.0, "height_mm": 280.0, "qty_kg": Decimal("10"), "unit_price": Decimal("122")},
        {"width_mm": 220.0, "height_mm": 320.0, "qty_kg": Decimal("12"), "unit_price": Decimal("126")},
        {"width_mm": 260.0, "height_mm": 360.0, "qty_kg": Decimal("14"), "unit_price": Decimal("130")},
    ]

    sales_rows: List[Dict[str, Any]] = []
    job_rows: List[Dict[str, Any]] = [_job_audit(stock_job)]

    for idx, spec in enumerate(sales_specs, start=1):
        geometry = _clone_geometry(source_geometry, spec["width_mm"], spec["height_mm"])
        so_payload = {
            "customer": str(customer.id),
            "customer_name": customer.name,
            "order_name": f"Fixture SO {fixture_tag}-{idx}",
            "delivery_date": timezone.now().date().isoformat(),
            "template_id": str(template.id),
            "fg_type": "POUCH",
            "mode": "TEMPLATE",
            "qty_value": str(spec["qty_kg"]),
            "qty_uom": "KG",
            "geometry": geometry,
            "film_layers": source_layers,
            "printing": source_printing,
            "addons": source_addons,
            "line_name": f"Fixture Line {idx}",
            "price_basis": "KG",
            "unit_price": str(spec["unit_price"]),
        }

        so = SalesOrderService.create_sales_order(so_payload)
        SalesOrderService.confirm_sales_order(str(so.id))
        so.refresh_from_db()

        # Continue directly from final roll->bulk step for this fixture.
        plan_sales_resp = client.post(
            f"/api/production/planner/control-hub/sales/{so.id}/plan/",
            {"option": "FRESH", "start_step_index": 1, "stop_step_index": 1},
            format="json",
        )
        if plan_sales_resp.status_code != 200:
            raise RuntimeError(
                f"sales plan failed for {so.order_number}: {plan_sales_resp.status_code} {plan_sales_resp.data}"
            )

        release_sales_resp = client.post(
            f"/api/production/planner/control-hub/sales/{so.id}/release/",
            {},
            format="json",
        )
        if release_sales_resp.status_code != 200:
            raise RuntimeError(
                f"sales release failed for {so.order_number}: {release_sales_resp.status_code} {release_sales_resp.data}"
            )

        final_job = (
            ProductionJob.objects.filter(sales_order_item__sales_order=so, current_step_index=1)
            .order_by("created_at")
            .first()
        )
        if not final_job:
            raise RuntimeError(f"No final roll->bulk job found for sales order {so.order_number}.")

        input_roll = _pick_fixture_roll(fixture_tag, str(template.id), min_weight=Decimal("0.1"))
        target_kg = _step_target(final_job)
        _execute_roll_to_bulk_job(final_job, input_roll, user, target_kg)
        final_job.refresh_from_db()
        job_rows.append(_job_audit(final_job))

        so.refresh_from_db()
        fg_batches = FinishedGoodsBatch.objects.filter(sales_order_item__sales_order=so).order_by("created_at")
        sales_rows.append(
            {
                "order_id": str(so.id),
                "order_number": so.order_number,
                "status": so.status,
                "packing_ready": so.status == "PACKING_READY",
                "dispatch_ready": so.status == "DISPATCH_READY",
                "geometry": {"width_mm": spec["width_mm"], "height_mm": spec["height_mm"]},
                "target_kg": _as_float(so.total_weight_kg),
                "jobs": [
                    {
                        "job_number": j.job_number,
                        "step_index": int(j.current_step_index or 0),
                        "state": j.job_state,
                        "status": j.status,
                    }
                    for j in ProductionJob.objects.filter(sales_order_item__sales_order=so).order_by("current_step_index")
                ],
                "fg_batches_count": fg_batches.count(),
                "fg_batches": [
                    {
                        "batch_number": b.batch_number,
                        "qty_kg": _as_float(b.qty_kg),
                        "qty_pcs": int(b.qty_pcs or 0),
                        "status": b.status,
                    }
                    for b in fg_batches
                ],
            }
        )

    # 3) Build final audit report
    stock_obj.refresh_from_db()
    lineage = _lineage_rows(fixture_tag)
    semi_roll_available = (
        InventoryRoll.objects.filter(
            template=template,
            status="AVAILABLE",
            meta_json__fixture_tag=fixture_tag,
        ).aggregate(total=Sum("weight_kg")).get("total")
        or Decimal("0")
    )

    allocations = list(
        InventoryReservation.objects.filter(roll__meta_json__fixture_tag=fixture_tag)
        .select_related("job", "roll")
        .order_by("created_at")
    )

    report: Dict[str, Any] = {
        "fixture_tag": fixture_tag,
        "generated_at": timezone.now().isoformat(),
        "stock_order": {
            "order_id": str(stock_obj.id),
            "order_number": stock_obj.order_number,
            "status": stock_obj.status,
            "template_id": str(template.id),
            "template_name": template.name,
            "start_step_index": int(stock_obj.start_step_index or 0),
            "stop_step_index": int(stock_obj.stop_step_index or 0),
            "target_qty_kg": _as_float(stock_obj.target_qty),
            "stock_job_id": str(stock_job.id),
            "stock_job_number": stock_job.job_number,
            "stock_job_state": stock_job.job_state,
            "stock_job_target_kg": _as_float(_step_target(stock_job)),
            "stock_job_produced_kg": _as_float(
                JobExecutionLog.objects.filter(production_job=stock_job).aggregate(total=Sum("quantity")).get("total")
                or 0
            ),
            "seed_roll_label": seed_roll.label_id,
            "semi_roll_available_kg": _as_float(semi_roll_available),
        },
        "sales_orders": sales_rows,
        "targets_audit": job_rows,
        "wip_lineage": lineage,
        "dispatch_readiness": {
            "packing_ready_orders": [row["order_number"] for row in sales_rows if row.get("packing_ready")],
            "non_packing_ready_orders": [row["order_number"] for row in sales_rows if not row.get("packing_ready")],
            "dispatch_ready_orders": [row["order_number"] for row in sales_rows if row["dispatch_ready"]],
            "non_dispatch_ready_orders": [row["order_number"] for row in sales_rows if not row["dispatch_ready"]],
        },
        "reservations_trace": [
            {
                "job_number": res.job.job_number if res.job_id else None,
                "roll_label": res.roll.label_id if res.roll_id else None,
                "status": res.status,
                "qty_kg": _as_float(res.quantity),
                "created_at": res.created_at.isoformat() if res.created_at else None,
            }
            for res in allocations
        ],
    }

    out_file = f"/tmp/semi_fg_3_sales_audit_{fixture_tag}.json"
    report["audit_report_file"] = out_file
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, default=str)

    _print_compact_report(report)
    print("\n--- FULL AUDIT JSON ---")
    print(json.dumps(report, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
