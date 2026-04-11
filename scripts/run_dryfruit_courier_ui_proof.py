#!/usr/bin/env python3
import json
import os
import runpy
import sys
import uuid
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings_script")
os.environ.setdefault("SKIP_ADMIN_APP_IMPORT", "1")

import django

django.setup()

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from apps.factory.models import Machine, Plant, Process, WorkCenter
from apps.inventory.models import InventoryBulk, InventoryLocation, InventoryRoll, PackagingStock
from apps.inventory.services.bulk_service import BulkService
from apps.inventory.services.packaging_service import PackagingService
from apps.materials.models import CommercialFamily, InventoryMaterial, PodSku, PodSkuVariant
from apps.production.models import FinishedGoodsBatch, JobExecutionLog, PlannedBulkStockOrder, PlannedStockOrder, PlannerSku, PlannerSkuVariant, ProductionJob
from apps.sales.models import Customer, SalesOrder, SalesSku, SalesSkuVariant
from apps.sales.services.quotation_service import QuotationService
from apps.templates.models import TemplateBlueprint


def runtime_dir() -> Path:
    target = Path(os.environ.get("UI_E2E_RUNTIME_DIR", ROOT_DIR / ".runtime" / "ui-e2e"))
    target.mkdir(parents=True, exist_ok=True)
    return target


def _now():
    return timezone.now()


def _admin():
    user = get_user_model().objects.filter(username="admin").first()
    if user:
        return user
    user = get_user_model().objects.filter(is_superuser=True).order_by("id").first()
    if user:
        return user
    raise RuntimeError("No admin user found.")


def _api_client(user):
    client = APIClient()
    client.defaults["HTTP_HOST"] = "127.0.0.1"
    client.force_authenticate(user=user)
    return client


def _d(value) -> Decimal:
    try:
        return Decimal(str(value if value is not None else 0))
    except Exception:
        return Decimal("0")


def _route_process(template: TemplateBlueprint, step_index: int):
    ordered = list(getattr(getattr(template, "routing_rule", None), "ordered_processes", None) or [])
    if not ordered:
        raise RuntimeError(f"Template {template.name} has no routing rule.")
    if step_index < 0 or step_index >= len(ordered):
        raise RuntimeError(f"Template {template.name} does not have step {step_index}.")
    return Process.objects.get(code=ordered[step_index])


def _ensure_location(plant: Plant, loc_type: str, code: str, name: str, is_system: bool = False):
    location = (
        InventoryLocation.objects.filter(plant=plant, type=loc_type, is_active=True)
        .order_by("-is_system", "name")
        .first()
    )
    if location:
        return location
    return InventoryLocation.objects.create(
        plant=plant,
        type=loc_type,
        code=code,
        name=name,
        is_system=is_system,
        is_active=True,
    )


def _material_variant(layer_snapshot: list[dict], index: int = 0):
    layer = (layer_snapshot or [])[index] if len(layer_snapshot or []) > index else {}
    variant_id = str(layer.get("variant_id") or layer.get("material_id") or "")
    material = InventoryMaterial.objects.filter(id=variant_id).first() if variant_id else None
    if not material:
        family_id = str(layer.get("family_id") or "")
        if family_id:
            material = (
                InventoryMaterial.objects.filter(parent_family_id=family_id, category="FILM_VARIANT", status="ACTIVE")
                .order_by("code")
                .first()
            )
    if not material:
        raise RuntimeError("Layer snapshot does not contain a resolvable film variant id.")
    return material, layer


def _route_last_index(template: TemplateBlueprint) -> int:
    ordered = list(getattr(getattr(template, "routing_rule", None), "ordered_processes", None) or [])
    if not ordered:
        raise RuntimeError(f"Template {template.name} has no routing rule.")
    return max(len(ordered) - 1, 0)


def _seed_sales():
    runpy.run_path(str(ROOT_DIR / "scripts" / "seed_ui_e2e_sales.py"), run_name="__main__")
    seed_path = runtime_dir() / "sales-seed.json"
    return json.loads(seed_path.read_text(encoding="utf-8"))


def _create_sales_order(customer: Customer, plant: Plant, variant: SalesSkuVariant, qty_pcs: int, unit_price: Decimal, line_name: str):
    geometry = variant.geometry_snapshot or {}
    base = geometry.get("base") if isinstance(geometry.get("base"), dict) else {}
    payload = {
        "customer": str(customer.id),
        "plant": str(plant.id),
        "customer_name": customer.name,
        "terms": "Courier dry-fruit proof order.",
        "items": [
            {
                "sku_variant_id": str(variant.id),
                "line_name": line_name,
                "qty_value": qty_pcs,
                "qty_uom": "PCS",
                "price_basis": "PCS",
                "geometry": {"base": {"width_mm": base.get("width_mm") or 0, "height_mm": base.get("height_mm") or 0}},
                "commercial_snapshot": {"manual_unit_price": unit_price, "tax_percent": 18},
            }
        ],
    }
    quotation = QuotationService.create_quotation(payload)
    order = QuotationService.convert_to_sales_order(quotation)
    order.status = "PLANNING_REQUIRED"
    order.save(update_fields=["status"])
    return quotation, order, order.items.select_related("template").first()


def _ensure_dryfruit_planner_variant(admin, template: TemplateBlueprint, plant: Plant, sales_variant: SalesSkuVariant):
    route_last_index = _route_last_index(template)
    sku, _ = PlannerSku.objects.update_or_create(
        code="PLN-DRYFRUIT-COURIER",
        defaults={
            "name": "Dry Fruit Courier Planner",
            "template": template,
            "default_plant": plant,
            "active": True,
            "notes": "Courier-route dry-fruit planner family for invariant and fast stock launch.",
            "created_by": admin,
        },
    )
    variant, _ = PlannerSkuVariant.objects.update_or_create(
        code="DRYFRUIT-INVARIANT-PRINTSTOP",
        defaults={
            "sku": sku,
            "name": "Dry Fruit Invariant Print Stop",
            "active": True,
            "launch_kind": "SHARED_INVARIANT_ROLL",
            "template": template,
            "default_plant": plant,
            "default_qty": Decimal("2400"),
            "quantity_uom": "PCS",
            "stock_purpose": "PRODUCT",
            "stock_strategy": "INTERMEDIATE_POOL",
            "planner_stock_class": "SHARED_INVARIANT_ROLL",
            "start_step_index": route_last_index,
            "stop_step_index": route_last_index,
            "geometry_snapshot": sales_variant.geometry_snapshot or {},
            "layer_snapshot": sales_variant.layer_snapshot or [],
            "printing_snapshot": sales_variant.printing_snapshot or {},
            "addons_snapshot": sales_variant.addons_snapshot or [],
            "packaging_snapshot": sales_variant.packaging_snapshot or {},
            "created_by": admin,
        },
    )
    return sku, variant


def _ensure_packaging_assets(admin, plant: Plant):
    family, _ = CommercialFamily.objects.update_or_create(
        code="PACK9001400",
        defaults={"name": "Packaging Pouch 900 x 1400", "default_form": "POUCH", "default_reporting_group": "PACKAGING", "active": True},
    )
    primary_family, _ = InventoryMaterial.objects.update_or_create(
        code="UAT-PACK-PET",
        defaults={
            "name": "UAT Packaging PET Family",
            "category": "FILM_FAMILY",
            "density_gcm3": Decimal("1.3800"),
            "status": "ACTIVE",
            "commercial_family": family,
        },
    )
    primary_variant, _ = InventoryMaterial.objects.update_or_create(
        code="UAT-PACK-PET-12",
        defaults={
            "name": "UAT Packaging PET 12u",
            "category": "FILM_VARIANT",
            "parent_family": primary_family,
            "density_gcm3": Decimal("1.3800"),
            "is_purchasable": True,
            "is_extrudable": False,
            "status": "ACTIVE",
            "commercial_family": family,
        },
    )
    seal_family, _ = InventoryMaterial.objects.update_or_create(
        code="UAT-PACK-PE",
        defaults={
            "name": "UAT Packaging PE Family",
            "category": "FILM_FAMILY",
            "density_gcm3": Decimal("0.9200"),
            "status": "ACTIVE",
            "commercial_family": family,
        },
    )
    seal_variant, _ = InventoryMaterial.objects.update_or_create(
        code="UAT-PACK-PE-40",
        defaults={
            "name": "UAT Packaging PE 40u",
            "category": "FILM_VARIANT",
            "parent_family": seal_family,
            "density_gcm3": Decimal("0.9200"),
            "is_purchasable": True,
            "is_extrudable": False,
            "status": "ACTIVE",
            "commercial_family": family,
        },
    )
    lamination, _ = Process.objects.update_or_create(
        code="UATPACKLAM",
        defaults={"name": "UAT Packaging Lamination", "input_form": "ROLL", "output_form": "ROLL", "roll_behavior": "MULTI_INPUT_COMBINE"},
    )
    pouching, _ = Process.objects.update_or_create(
        code="UATPACKPOUCH",
        defaults={"name": "UAT Packaging Pouching", "input_form": "ROLL", "output_form": "BULK", "roll_behavior": "NONE"},
    )
    from apps.routing.models import RoutingRule
    route, _ = RoutingRule.objects.update_or_create(
        name="UAT Packaging Pouch Route",
        defaults={"ordered_processes": [lamination.code, pouching.code]},
    )
    if route.ordered_processes != [lamination.code, pouching.code]:
        route.ordered_processes = [lamination.code, pouching.code]
        route.save(update_fields=["ordered_processes"])
    template, _ = TemplateBlueprint.objects.update_or_create(
        name="UAT Packaging Pouch 900x1400",
        defaults={
            "fg_type": "POUCH",
            "status": "LIVE",
            "routing_rule": route,
            "pouch_style": "THREE_SIDE_SEAL",
            "commercial_family": family,
        },
    )
    route_last_index = _route_last_index(template)
    material, _ = InventoryMaterial.objects.update_or_create(
        code="UAT-PACK-POUCH-900X1400",
        defaults={
            "name": "UAT Packaging Pouch 900 x 1400",
            "category": "PACKAGING",
            "base_uom": "PCS",
            "commercial_family": family,
            "packaging_kind": "INNER_POUCH",
            "packaging_supply_mode": "IN_HOUSE",
            "production_template": template,
            "packaging_defaults_json": {"label": "2-layer non-printed packaging pouch"},
            "status": "ACTIVE",
        },
    )
    sku, _ = PlannerSku.objects.update_or_create(
        code="PLN-PACK-900X1400",
        defaults={
            "name": "Packaging Pouch 900 x 1400",
            "template": template,
            "default_plant": plant,
            "active": True,
            "notes": "In-house non-printed packaging pouch.",
            "created_by": admin,
        },
    )
    variant, _ = PlannerSkuVariant.objects.update_or_create(
        code="PACK-PCH-900X1400-NP",
        defaults={
            "sku": sku,
            "name": "Packaging Pouch 900 x 1400",
            "active": True,
            "launch_kind": "PACKAGING_STOCK",
            "template": template,
            "default_plant": plant,
            "default_qty": Decimal("60"),
            "quantity_uom": "PCS",
            "stock_purpose": "PACKAGING",
            "stock_strategy": "PACKAGING_STOCK",
            "planner_stock_class": "PACKAGING_STOCK",
            "start_step_index": 0,
            "stop_step_index": route_last_index,
            "geometry_snapshot": {
                "base": {"width_mm": 900, "height_mm": 1400},
                "adjustments": [],
                "multipliers": {"faces": 1},
                "finished_good_type": "POUCH",
            },
            "layer_snapshot": [
                {"family_id": str(primary_family.id), "variant_id": str(primary_variant.id), "thickness_micron": 12, "density_g_cm3": 1.38},
                {"family_id": str(seal_family.id), "variant_id": str(seal_variant.id), "thickness_micron": 40, "density_g_cm3": 0.92},
            ],
            "printing_snapshot": {"enabled": False},
            "addons_snapshot": [],
            "packaging_snapshot": {},
            "packaging_material": material,
            "created_by": admin,
        },
    )
    return {"template": template, "material": material, "sku": sku, "variant": variant}


def _ensure_pod_assets(admin, plant: Plant):
    family, _ = CommercialFamily.objects.update_or_create(
        code="POD1L",
        defaults={"name": "POD 1 Layer", "default_form": "ROLL", "default_reporting_group": "OTHER", "active": True},
    )
    film_family, _ = InventoryMaterial.objects.update_or_create(
        code="UAT-POD-PE",
        defaults={
            "name": "UAT POD PE Family",
            "category": "FILM_FAMILY",
            "density_gcm3": Decimal("0.9200"),
            "status": "ACTIVE",
            "commercial_family": family,
        },
    )
    film_variant, _ = InventoryMaterial.objects.update_or_create(
        code="UAT-POD-PE-30",
        defaults={
            "name": "UAT POD PE 30u",
            "category": "FILM_VARIANT",
            "parent_family": film_family,
            "density_gcm3": Decimal("0.9200"),
            "is_purchasable": True,
            "is_extrudable": True,
            "status": "ACTIVE",
            "commercial_family": family,
        },
    )
    extrusion, _ = Process.objects.update_or_create(
        code="UATPODXTRU",
        defaults={"name": "UAT POD Extrusion", "input_form": "BULK", "output_form": "ROLL", "roll_behavior": "CREATE_NEW"},
    )
    slitting, _ = Process.objects.update_or_create(
        code="UATPODSLIT",
        defaults={"name": "UAT POD Slitting", "input_form": "ROLL", "output_form": "ROLL", "roll_behavior": "SPLIT"},
    )
    from apps.routing.models import RoutingRule
    route, _ = RoutingRule.objects.update_or_create(
        name="UAT POD Stock Route",
        defaults={"ordered_processes": [extrusion.code, slitting.code]},
    )
    if route.ordered_processes != [extrusion.code, slitting.code]:
        route.ordered_processes = [extrusion.code, slitting.code]
        route.save(update_fields=["ordered_processes"])
    template, _ = TemplateBlueprint.objects.update_or_create(
        name="UAT POD Stock Roll",
        defaults={
            "fg_type": "ROLL",
            "status": "LIVE",
            "routing_rule": route,
            "commercial_family": family,
        },
    )
    material, _ = InventoryMaterial.objects.update_or_create(
        code="UAT-POD-1L-EXTRU-SLIT",
        defaults={
            "name": "UAT POD 1L Extrusion Slit",
            "category": "POD",
            "base_uom": "KG",
            "commercial_family": family,
            "pod_type": "SINGLE",
            "pod_fixed_height_mm": Decimal("280"),
            "pod_thickness_micron": Decimal("30"),
            "pod_panel_count": 1,
            "pod_is_inhouse_produced": True,
            "density_gcm3": Decimal("0.9200"),
            "status": "ACTIVE",
        },
    )
    pod_sku, _ = PodSku.objects.update_or_create(
        code="POD-UAT-1L",
        defaults={"name": "POD UAT 1L", "family": "POD", "active": True},
    )
    pod_variant, _ = PodSkuVariant.objects.update_or_create(
        pod_sku=pod_sku,
        code="POD-UAT-1L-SLIT",
        defaults={
            "name": "POD UAT 1L Slit",
            "material": material,
            "active": True,
            "production_defaults_json": {"route_template": template.name, "route_code": route.name},
            "reporting_attributes_json": {"display_height_mm": 280},
        },
    )
    sku, _ = PlannerSku.objects.update_or_create(
        code="PLN-POD-1L",
        defaults={
            "name": "POD 1L Slit Stock",
            "template": template,
            "default_plant": plant,
            "active": True,
            "notes": "1-layer extrusion plus slitting POD replenishment.",
            "created_by": admin,
        },
    )
    variant, _ = PlannerSkuVariant.objects.update_or_create(
        code="POD-1L-SLIT-STOCK",
        defaults={
            "sku": sku,
            "name": "POD 1L Slit Stock",
            "active": True,
            "launch_kind": "POD_STOCK",
            "template": template,
            "default_plant": plant,
            "default_qty": Decimal("75"),
            "quantity_uom": "KG",
            "stock_purpose": "PRODUCT",
            "stock_strategy": "INTERMEDIATE_POOL",
            "planner_stock_class": "EXTRUDED_BASE_ROLL",
            "start_step_index": 0,
            "stop_step_index": _route_last_index(template),
            "geometry_snapshot": {"base": {"width_mm": 280, "height_mm": 0}, "adjustments": [], "multipliers": {"faces": 1}, "finished_good_type": "ROLL", "roll_form": "FLAT"},
            "layer_snapshot": [
                {
                    "family_id": str(film_family.id),
                    "variant_id": str(film_variant.id),
                    "thickness_micron": 30,
                    "density_g_cm3": 0.92,
                    "roll_width_mm": 280,
                }
            ],
            "printing_snapshot": {"enabled": False},
            "addons_snapshot": [],
            "packaging_snapshot": {},
            "pod_sku_variant": pod_variant,
            "created_by": admin,
        },
    )
    return {"template": template, "material": material, "pod_sku": pod_sku, "pod_variant": pod_variant, "sku": sku, "variant": variant}


def _create_stock_order(client: APIClient, payload: dict):
    response = client.post("/api/production/planner/create-stock-order/", payload, format="json")
    if response.status_code not in {200, 201}:
        raise RuntimeError(f"Stock order create failed: {response.status_code} {response.content.decode()}")
    order_id = response.data.get("stock_order_id") or response.data.get("order_id")
    if not order_id:
        raise RuntimeError("Stock order create did not return an order id.")
    return PlannedStockOrder.objects.get(id=order_id)


def _create_bulk_order(client: APIClient, payload: dict):
    response = client.post("/api/production/planner/create-stock-order/", payload, format="json")
    if response.status_code not in {200, 201}:
        raise RuntimeError(f"Bulk stock order create failed: {response.status_code} {response.content.decode()}")
    order_id = response.data.get("order_id") or response.data.get("id")
    if not order_id:
        raise RuntimeError("Bulk stock order create did not return an order id.")
    return PlannedBulkStockOrder.objects.get(id=order_id)


def _completed_job(admin, template: TemplateBlueprint, mts_order: PlannedStockOrder | None, process: Process, *, quantity_kg: Decimal, work_center: WorkCenter | None = None, machine: Machine | None = None, from_location: InventoryLocation | None = None, to_location: InventoryLocation | None = None):
    stamp = timezone.now().strftime("%Y%m%d%H%M%S")
    job = ProductionJob.objects.create(
        job_number=f"JOB-DF-{stamp}-{uuid.uuid4().hex[:4].upper()}",
        origin="MTS",
        source_type="MTS",
        template=template,
        mts_order=mts_order,
        routing_rule=template.routing_rule,
        current_step_index=max(0, int((mts_order.stop_step_index if mts_order else 0) or 0)),
        current_process=process,
        routing_step_index=max(0, int((mts_order.stop_step_index if mts_order else 0) or 0)),
        process=process,
        work_center=work_center,
        machine=machine,
        operator=admin,
        planned_date=_now().date(),
        input_form=str(process.input_form or "ROLL").upper(),
        output_form=str(process.output_form or "ROLL").upper(),
        quantity=quantity_kg,
        uom="KG",
        produced_qty=quantity_kg,
        remaining_qty=Decimal("0"),
        job_state="COMPLETED",
        status="COMPLETED",
        start_date=_now() - timedelta(hours=1),
        end_date=_now() - timedelta(minutes=10),
        closed_at=_now() - timedelta(minutes=10),
        closed_by=admin,
        from_location=from_location,
        to_location=to_location,
    )
    JobExecutionLog.objects.create(
        production_job=job,
        quantity=quantity_kg,
        uom="KG",
        shift_code="GEN",
        shift_date=_now().date(),
        logged_by=admin,
    )
    return job


def _create_invariant_roll(
    admin,
    stock_order: PlannedStockOrder,
    template: TemplateBlueprint,
    plant: Plant,
    wip_location: InventoryLocation,
    *,
    fallback_layer_snapshot: list[dict] | None = None,
    fallback_geometry_snapshot: dict | None = None,
):
    stop_step_index = int(stock_order.stop_step_index if stock_order.stop_step_index is not None else _route_last_index(template))
    process = _route_process(template, stop_step_index)
    effective_layers = stock_order.layer_snapshot or fallback_layer_snapshot or []
    effective_geometry = stock_order.geometry_snapshot or fallback_geometry_snapshot or {}
    material, first_layer = _material_variant(effective_layers, 0)
    job = _completed_job(
        admin,
        template,
        stock_order,
        process,
        quantity_kg=_d(stock_order.total_weight_kg or stock_order.target_qty or 0),
        from_location=wip_location,
        to_location=wip_location,
    )
    roll = InventoryRoll.objects.create(
        label_id=f"DRV-INV-{uuid.uuid4().hex[:8].upper()}",
        material=material,
        batch_no=f"DRVINV-{uuid.uuid4().hex[:6].upper()}",
        thickness_micron=_d(first_layer.get("thickness_micron") or 12),
        width_mm=_d((effective_geometry or {}).get("base", {}).get("width_mm") or 240),
        plant=plant,
        original_weight_kg=_d(stock_order.total_weight_kg or stock_order.target_qty or 0),
        weight_kg=_d(stock_order.total_weight_kg or stock_order.target_qty or 0),
        location=wip_location,
        status="AVAILABLE",
        stage_index=stop_step_index,
        is_fg=False,
        template=template,
        current_step_index=stop_step_index,
        completed_step_index=stop_step_index,
        created_by_job=job,
        production_job=job,
        created_process=process,
        meta_json={
            "spec_signature": stock_order.spec_signature,
            "invariant_signature": stock_order.invariant_signature,
            "roll_role": "OUTPUT",
        },
    )
    return job, roll


def _create_fg_batch(admin, stock_order: PlannedStockOrder, template: TemplateBlueprint, fg_location: InventoryLocation, qty_pcs: int):
    process = _route_process(template, int(stock_order.stop_step_index or 0))
    job = _completed_job(
        admin,
        template,
        stock_order,
        process,
        quantity_kg=_d(stock_order.total_weight_kg or stock_order.target_qty or 0),
        from_location=fg_location,
        to_location=fg_location,
    )
    batch = FinishedGoodsBatch.objects.create(
        batch_number=f"FG-DRV-{uuid.uuid4().hex[:8].upper()}",
        template=template,
        production_job=job,
        qty_pcs=int(qty_pcs),
        qty_kg=_d(stock_order.total_weight_kg or stock_order.target_qty or 0),
        geometry_override=stock_order.geometry_snapshot or {},
        completed_step_index=len(template.routing_rule.ordered_processes) - 1,
        location=fg_location,
        status="AVAILABLE",
    )
    return job, batch


def _planner_rows(client: APIClient):
    response = client.get("/api/production/planner/control-hub/")
    if response.status_code != 200:
        raise RuntimeError(f"Planner control-hub failed: {response.status_code} {response.content.decode()}")
    return response.json()


def _sales_row(control_payload: dict, sales_order: SalesOrder):
    for row in control_payload.get("orders", []):
        if row.get("order_kind") == "sales" and str(row.get("order_id")) == str(sales_order.id):
            return row
    raise RuntimeError(f"Sales order {sales_order.order_number} not found in planner queue.")


def _plan_and_release(client: APIClient, sales_order: SalesOrder, option: str, row: dict, allocations: list[dict] | None = None):
    plan_payload = {
        "option": option,
        "start_step_index": int(row.get("required_start_step") or 0),
        "stop_step_index": int(row.get("route_last_step_index") or 0),
        "allocations": allocations or [],
    }
    plan_response = client.post(f"/api/production/planner/control-hub/sales/{sales_order.id}/plan/", plan_payload, format="json")
    if plan_response.status_code != 200:
        raise RuntimeError(f"Plan failed for {sales_order.order_number} with {option}: {plan_response.status_code} {plan_response.content.decode()}")
    plan_json = plan_response.json()
    release_json = None
    if plan_json.get("order_status") == "PLANNED":
        release_response = client.post(f"/api/production/planner/control-hub/sales/{sales_order.id}/release/", {}, format="json")
        if release_response.status_code != 200:
            raise RuntimeError(f"Release failed for {sales_order.order_number}: {release_response.status_code} {release_response.content.decode()}")
        release_json = release_response.json()
    sales_order.refresh_from_db()
    jobs = list(ProductionJob.objects.filter(sales_order_item__sales_order=sales_order).order_by("created_at"))
    return {
        "plan_response": plan_json,
        "release_response": release_json,
        "order_status": sales_order.status,
        "jobs_created": [
            {
                "job_id": str(job.id),
                "job_number": job.job_number,
                "job_state": job.job_state,
                "current_step_index": job.current_step_index,
                "process_code": getattr(getattr(job, "current_process", None), "code", None) or getattr(getattr(job, "process", None), "code", None),
            }
            for job in jobs
        ],
    }


def _verify_machine_history(client: APIClient, machine: Machine):
    response = client.get(f"/api/production/machine/{machine.id}/history/?status=ALL")
    if response.status_code != 200:
        raise RuntimeError(f"Machine history failed for {machine.id}: {response.status_code} {response.content.decode()}")
    return response.json()


def main():
    admin = _admin()
    client = _api_client(admin)
    sales_seed = _seed_sales()

    plant = Plant.objects.get(id=sales_seed["plant_id"])
    customer = Customer.objects.get(id=sales_seed["customer_id"])
    dryfruit_sku = SalesSku.objects.get(code=sales_seed["sku_code"])
    dryfruit_variant = SalesSkuVariant.objects.select_related("sku", "sku__template").get(code=sales_seed["variant_codes"][0], sku=dryfruit_sku)
    courier_template = dryfruit_sku.template
    if not getattr(courier_template, "routing_rule", None):
        raise RuntimeError(f"Dry fruit SKU template {courier_template.name} has no routing rule.")

    rm_location = _ensure_location(plant, "RM", "UAT-RM", "UAT Raw Material", True)
    wip_location = _ensure_location(plant, "WIP", "UAT-WIP", "UAT WIP", True)
    fg_location = _ensure_location(plant, "FG", "UAT-FG", "UAT FG", True)

    dryfruit_planner_sku, dryfruit_invariant_variant = _ensure_dryfruit_planner_variant(admin, courier_template, plant, dryfruit_variant)
    packaging_assets = _ensure_packaging_assets(admin, plant)
    pod_assets = _ensure_pod_assets(admin, plant)
    route_last_index = max(len(courier_template.routing_rule.ordered_processes or []) - 1, 0)

    direct_fg_order = _create_stock_order(
        client,
        {
            "sales_sku_variant_id": str(dryfruit_variant.id),
            "launcher_mode": "FINAL_ROLL",
            "quantity": 3200,
            "quantity_uom": "PCS",
            "start_step_index": 0,
            "stop_step_index": route_last_index,
        },
    )
    invariant_order = _create_stock_order(
        client,
        {
            "planner_sku_variant_id": str(dryfruit_invariant_variant.id),
        },
    )
    packaging_order = _create_stock_order(
        client,
        {
            "planner_sku_variant_id": str(packaging_assets["variant"].id),
        },
    )
    pod_order = _create_bulk_order(
        client,
        {
            "planner_sku_variant_id": str(pod_assets["variant"].id),
        },
    )

    direct_fg_job, direct_fg_batch = _create_fg_batch(admin, direct_fg_order, courier_template, fg_location, qty_pcs=3200)
    invariant_job, invariant_roll = _create_invariant_roll(
        admin,
        invariant_order,
        courier_template,
        plant,
        wip_location,
        fallback_layer_snapshot=dryfruit_invariant_variant.layer_snapshot or [],
        fallback_geometry_snapshot=dryfruit_invariant_variant.geometry_snapshot or {},
    )

    pricing = Decimal("8.25")
    _, so_wip, so_wip_item = _create_sales_order(customer, plant, dryfruit_variant, 1800, pricing, "Dry Fruit WIP Continuation")
    _, so_fg, so_fg_item = _create_sales_order(customer, plant, dryfruit_variant, 2000, pricing, "Dry Fruit FG Claim")
    _, so_fresh, so_fresh_item = _create_sales_order(customer, plant, dryfruit_variant, 2200, pricing, "Dry Fruit Fresh Route")

    control_payload = _planner_rows(client)
    row_wip = _sales_row(control_payload, so_wip)
    row_fg = _sales_row(control_payload, so_fg)
    row_fresh = _sales_row(control_payload, so_fresh)

    wip_candidate = next(
        (
            row
            for row in (row_wip.get("inventory_options") or [])
            if row.get("inventory_type") == "ROLL" and str(row.get("inventory_id")) == str(invariant_roll.id)
        ),
        None,
    )
    if not wip_candidate:
        raise RuntimeError("Dry-fruit invariant roll was not offered as a WIP continuation candidate.")
    fg_candidate = next(
        (
            row
            for row in (row_fg.get("inventory_options") or [])
            if row.get("inventory_type") in {"FG_BATCH", "FG"} and str(row.get("inventory_id")) == str(direct_fg_batch.id)
        ),
        None,
    )
    if not fg_candidate:
        raise RuntimeError("Dry-fruit FG batch was not offered as an FG candidate.")

    wip_result = _plan_and_release(
        client,
        so_wip,
        "WIP_CONTINUE",
        row_wip,
        allocations=[
            {
                "inventory_type": "ROLL",
                "inventory_id": str(invariant_roll.id),
                "allocated_qty_kg": float(_d(row_wip.get("required_qty_kg") or 0)),
            }
        ],
    )
    fg_result = _plan_and_release(
        client,
        so_fg,
        "FG",
        row_fg,
        allocations=[
            {
                "inventory_type": "FG_BATCH",
                "inventory_id": str(direct_fg_batch.id),
                "allocated_qty_kg": float(_d(row_fg.get("required_qty_kg") or 0)),
            }
        ],
    )
    fresh_result = _plan_and_release(client, so_fresh, "FRESH", row_fresh, allocations=[])

    gonny_material = InventoryMaterial.objects.filter(code="PACK_GONNY_STD").first()
    if gonny_material:
        gonny_stock = PackagingStock.objects.filter(material=gonny_material, location=fg_location).first()
        current_gonny_qty = _d(gonny_stock.qty if gonny_stock else 0)
        if current_gonny_qty < Decimal("25"):
            PackagingService.add_packaging_stock(
                material_id=gonny_material.id,
                qty=Decimal("25") - current_gonny_qty,
                location_id=fg_location.id,
                sales_order_item_id=so_fg_item.id,
                reference=f"{so_fg.order_number} gonny top-up",
                input_uom="PCS",
            )

    packaging_tx_in = PackagingService.add_packaging_stock(
        material_id=packaging_assets["material"].id,
        qty=60,
        location_id=fg_location.id,
        mts_order_id=packaging_order.id,
        reference=f"{packaging_order.order_number} packaging produce",
        input_uom="PCS",
    )
    PackagingService.consume_packaging_stock(
        material_id=packaging_assets["material"].id,
        qty=18,
        location_id=fg_location.id,
        mts_order_id=packaging_order.id,
        reference=f"{packaging_order.order_number} packaging consume",
        input_uom="PCS",
        basis="dispatch-proof",
    )
    packaging_stock = PackagingStock.objects.get(material=packaging_assets["material"], location=fg_location)

    bulk_in = BulkService.add_bulk(
        pod_assets["material"].id,
        80,
        plant.id,
        rm_location.id,
        reference=f"{pod_order.order_number} pod produce",
    )
    BulkService.consume_bulk(
        pod_assets["material"].id,
        24,
        rm_location.id,
        reference=f"{pod_order.order_number} pod consume",
    )
    pod_bulk = InventoryBulk.objects.get(material=pod_assets["material"], location=rm_location)

    history_machine = Machine.objects.select_related("work_center", "work_center__plant").order_by("name").first()
    if not history_machine:
        raise RuntimeError("No machine exists for machine history proof.")
    history_wc_process = (
        history_machine.work_center.center_processes.select_related("process").order_by("process__code").first()
        if history_machine.work_center_id
        else None
    )
    history_process = history_wc_process.process if history_wc_process else _route_process(courier_template, 1)
    history_job = _completed_job(
        admin,
        courier_template,
        direct_fg_order,
        history_process,
        quantity_kg=Decimal("42"),
        work_center=history_machine.work_center,
        machine=history_machine,
        from_location=rm_location,
        to_location=wip_location,
    )
    history_payload = _verify_machine_history(client, history_machine)

    artifact = {
        "generated_at": _now().isoformat(),
        "dryfruit": {
            "sku_code": dryfruit_sku.code,
            "sku_name": dryfruit_sku.name,
            "template_name": courier_template.name,
            "template_id": str(courier_template.id),
            "planner_invariant_sku": {
                "sku_id": str(dryfruit_planner_sku.id),
                "sku_code": dryfruit_planner_sku.code,
                "variant_id": str(dryfruit_invariant_variant.id),
                "variant_code": dryfruit_invariant_variant.code,
            },
            "direct_fg_stock_order": {
                "id": str(direct_fg_order.id),
                "order_number": direct_fg_order.order_number,
                "planner_stock_class": direct_fg_order.planner_stock_class,
                "batch_id": str(direct_fg_batch.id),
                "batch_number": direct_fg_batch.batch_number,
            },
            "invariant_stock_order": {
                "id": str(invariant_order.id),
                "order_number": invariant_order.order_number,
                "planner_stock_class": invariant_order.planner_stock_class,
                "roll_id": str(invariant_roll.id),
                "roll_label": invariant_roll.label_id,
                "completed_step_index": invariant_roll.completed_step_index,
            },
            "sales_orders": {
                "wip": {
                    "sales_order_id": str(so_wip.id),
                    "sales_order_number": so_wip.order_number,
                    "sales_order_item_id": str(so_wip_item.id),
                    "required_start_step": row_wip.get("required_start_step"),
                    "route_last_step_index": row_wip.get("route_last_step_index"),
                    "inventory_candidate": wip_candidate,
                    "result": wip_result,
                },
                "fg": {
                    "sales_order_id": str(so_fg.id),
                    "sales_order_number": so_fg.order_number,
                    "sales_order_item_id": str(so_fg_item.id),
                    "required_start_step": row_fg.get("required_start_step"),
                    "route_last_step_index": row_fg.get("route_last_step_index"),
                    "inventory_candidate": fg_candidate,
                    "result": fg_result,
                },
                "fresh": {
                    "sales_order_id": str(so_fresh.id),
                    "sales_order_number": so_fresh.order_number,
                    "sales_order_item_id": str(so_fresh_item.id),
                    "required_start_step": row_fresh.get("required_start_step"),
                    "route_last_step_index": row_fresh.get("route_last_step_index"),
                    "result": fresh_result,
                },
            },
        },
        "packaging": {
            "template_name": packaging_assets["template"].name,
            "material_code": packaging_assets["material"].code,
            "planner_sku_code": packaging_assets["sku"].code,
            "variant_id": str(packaging_assets["variant"].id),
            "variant_code": packaging_assets["variant"].code,
            "stock_order_id": str(packaging_order.id),
            "stock_order_number": packaging_order.order_number,
            "produced_tx_id": str(packaging_tx_in.id),
            "remaining_qty": float(packaging_stock.qty),
            "uom": packaging_assets["material"].base_uom,
        },
        "pod": {
            "template_name": pod_assets["template"].name,
            "material_code": pod_assets["material"].code,
            "planner_sku_code": pod_assets["sku"].code,
            "variant_id": str(pod_assets["variant"].id),
            "variant_code": pod_assets["variant"].code,
            "bulk_order_id": str(pod_order.id),
            "bulk_order_number": pod_order.order_number,
            "produced_tx_id": str(bulk_in.id),
            "remaining_qty_kg": float(pod_bulk.qty_kg),
        },
        "machine_history": {
            "machine_id": str(history_machine.id),
            "machine_name": history_machine.name,
            "completed_job_id": str(history_job.id),
            "completed_job_number": history_job.job_number,
            "summary": history_payload.get("summary") or {},
            "jobs": history_payload.get("jobs") or [],
        },
    }

    target = runtime_dir() / "dryfruit-courier-ui-proof.json"
    target.write_text(json.dumps(artifact, indent=2), encoding="utf-8")
    print(f"Dry-fruit courier UI proof written to {target}")


if __name__ == "__main__":
    main()
