import json
import os
import sys
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import uuid4

import django
from django.apps import apps as django_apps

sys.path.insert(0, os.getcwd())
os.environ.setdefault("SKIP_CELERY_IMPORT", "1")
os.environ.setdefault("SKIP_ADMIN_APP_IMPORT", "1")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
if not django_apps.ready:
    django.setup()

from django.core.exceptions import ValidationError
from django.db.models import Q
from django.utils import timezone

from apps.artwork.print_contract import resolve_ink_base_from_layers, validate_frozen_printing_snapshot
from apps.factory.models import Machine, Plant, Process, WorkCenter, WorkCenterProcess
from apps.inventory.models import (
    DeliveryChallan as InterPlantDeliveryChallan,
    InkMaterial,
    InterPlantChallanItem,
    InventoryLocation,
    InventoryReservation,
    InventoryRoll,
    JobWorkOrder,
    RollConsumption,
    RollLink,
    RollMovement,
)
from apps.inventory.services.bulk_service import BulkService
from apps.inventory.services.roll_service import RollService
from apps.inventory.services.packaging_service import PackagingService
from apps.materials.models import InventoryMaterial
from apps.production.models import (
    DowntimeLog,
    JobMaterialRequirement,
    JobExecutionLog,
    MaterialConsumptionLog,
    ProductionJob,
    RollDispatchPackRecord,
    ScrapLog,
    WorkCenterAssignment as ProductionWCAssignment,
)
from apps.production.services.dispatch_service import FGDispatchService
from apps.production.services.services_execution import ExecutionService
from apps.physics.spec_signature import (
    build_invariant_payload,
    build_invariant_signature,
    build_spec_payload,
    build_spec_signature,
)
from apps.recipes.models import RecipeGrade
from apps.sales.models import Customer, SalesOrder, SalesOrderItem, SalesSkuVariant
from apps.templates.models import TemplateProcessStep
from apps.users.models import MachineAssignment, User, WorkCenterAssignment as UserWCAssignment
from apps.inventory.models import Vendor
from scripts.e2e_green_utils import CODE_PREFIX, current_run_tag, label, runtime_dir


RUN_TAG = f"{current_run_tag()}{uuid4().hex[:6].upper()}"
PREFIX = f"{CODE_PREFIX}-MUT"
OPERATOR_JOB_NUMBER = f"{PREFIX}-OP-{RUN_TAG}"
PRINTING_JOB_NUMBER = f"{PREFIX}-PRINT-{RUN_TAG}"
WCM_JOB_NUMBER = f"{PREFIX}-WCM-{RUN_TAG}"
JOBWORK_JOB_NUMBER = f"{PREFIX}-JW-{RUN_TAG}"


@dataclass
class PlantContext:
    plant: Plant
    work_center: WorkCenter
    machine: Machine
    rm: InventoryLocation
    wip: InventoryLocation
    warehouse: InventoryLocation
    fg: InventoryLocation


def _suffix() -> str:
    return RUN_TAG


def _pick_active_ink(*tokens: str, base_type: str | None = None):
    query = InkMaterial.objects.filter(status="ACTIVE")
    if base_type:
        query = query.filter(base_type=str(base_type).upper())
    for token in tokens:
        match = (
            query.filter(
                Q(code__icontains=token)
                | Q(name__icontains=token)
                | Q(color_name__icontains=token)
            )
            .order_by("created_at")
            .first()
        )
        if match:
            return match
    return None


def _json_ready(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, dict):
        return {str(key): _json_ready(inner) for key, inner in value.items()}
    if isinstance(value, list):
        return [_json_ready(inner) for inner in value]
    return value


def _require(model, **filters):
    obj = model.objects.filter(**filters).first()
    if not obj:
        label = ", ".join(f"{key}={value}" for key, value in filters.items())
        raise RuntimeError(f"Required {model.__name__} missing ({label}).")
    return obj


def _get_plant_context(code: str) -> PlantContext:
    plant = _require(Plant, code=code)
    work_center = _require(WorkCenter, plant=plant, code=f"{code}_EXTRU")
    machine = _require(Machine, work_center=work_center, code=f"{code}_EXTRU_M1")
    return PlantContext(
        plant=plant,
        work_center=work_center,
        machine=machine,
        rm=_require(InventoryLocation, plant=plant, code="RM"),
        wip=_require(InventoryLocation, plant=plant, code="WIP"),
        warehouse=_require(InventoryLocation, plant=plant, code="WAREHOUSE"),
        fg=_require(InventoryLocation, plant=plant, code="FG"),
    )


def _ensure_admin() -> User:
    admin = User.objects.filter(username="admin").first() or User.objects.filter(is_superuser=True).order_by("username").first()
    if not admin:
        raise RuntimeError("Admin user is required before seeding UI mutation fixtures.")
    return admin


def _ensure_user_scope(user: User, work_center: WorkCenter, machine: Machine):
    UserWCAssignment.objects.get_or_create(user=user, work_center=work_center)
    MachineAssignment.objects.get_or_create(user=user, machine=machine)
    if machine.assigned_operator_id != user.id:
        machine.assigned_operator = user
        machine.save(update_fields=["assigned_operator"])


def _job_number(kind: str, suffix: str) -> str:
    return f"{PREFIX}-{kind}-{suffix}"


def _cleanup_previous_seed_data():
    seeded_roll_ids = list(
        InventoryRoll.objects.filter(
            Q(meta_json__ui_e2e_seed=True)
            | Q(production_job__job_number__startswith=f"{PREFIX}-")
            | Q(created_by_job__job_number__startswith=f"{PREFIX}-")
            | Q(label_id__startswith=f"{PREFIX}-")
            | Q(label_id__startswith=f"R-{PREFIX}-")
        ).values_list("id", flat=True)
    )
    if seeded_roll_ids:
        RollMovement.objects.filter(roll_id__in=seeded_roll_ids).delete()
        RollConsumption.objects.filter(input_roll_id__in=seeded_roll_ids).delete()
        RollConsumption.objects.filter(output_roll_id__in=seeded_roll_ids).delete()
        RollConsumption.objects.filter(balance_roll_id__in=seeded_roll_ids).delete()
        RollConsumption.objects.filter(scrap_roll_id__in=seeded_roll_ids).delete()
        RollLink.objects.filter(parent_roll_id__in=seeded_roll_ids).delete()
        RollLink.objects.filter(child_roll_id__in=seeded_roll_ids).delete()
        InventoryReservation.objects.filter(roll_id__in=seeded_roll_ids).delete()
        InterPlantChallanItem.objects.filter(roll_id__in=seeded_roll_ids).delete()
        RollDispatchPackRecord.objects.filter(roll_id__in=seeded_roll_ids).delete()
        InterPlantDeliveryChallan.objects.filter(items__roll_id__in=seeded_roll_ids).distinct().delete()
        InventoryRoll.objects.filter(id__in=seeded_roll_ids).delete()

    JobWorkOrder.objects.filter(production_job__job_number__startswith=f"{PREFIX}-").delete()
    DowntimeLog.objects.filter(production_job__job_number__startswith=f"{PREFIX}-").delete()
    JobExecutionLog.objects.filter(production_job__job_number__startswith=f"{PREFIX}-").delete()
    ScrapLog.objects.filter(production_job__job_number__startswith=f"{PREFIX}-").delete()
    MaterialConsumptionLog.objects.filter(production_job__job_number__startswith=f"{PREFIX}-").delete()
    JobMaterialRequirement.objects.filter(production_job__job_number__startswith=f"{PREFIX}-").delete()
    ProductionWCAssignment.objects.filter(production_job__job_number__startswith=f"{PREFIX}-").delete()
    ProductionJob.objects.filter(job_number__startswith=f"{PREFIX}-").delete()
    SalesOrderItem.objects.filter(sales_order__order_name=f"{PREFIX} Printing Seed").delete()
    SalesOrder.objects.filter(order_name=f"{PREFIX} Printing Seed").delete()


def _find_job_template_source() -> ProductionJob:
    base_qs = (
        ProductionJob.objects.filter(template__isnull=False, routing_rule__isnull=False)
        .exclude(job_state__in=["COMPLETED", "CANCELLED"])
        .exclude(job_number__startswith=f"{PREFIX}-")
    )
    source = (
        base_qs.filter(sales_order_item__isnull=False)
        .select_related("template", "routing_rule", "sales_order_item", "mts_order")
        .order_by("-created_at")
        .first()
    )
    if not source:
        source = (
            base_qs.filter(mts_order__isnull=False)
            .select_related("template", "routing_rule", "sales_order_item", "mts_order")
            .order_by("-created_at")
            .first()
        )
    if not source:
        source = (
            base_qs.select_related("template", "routing_rule", "sales_order_item", "mts_order")
            .order_by("-created_at")
            .first()
        )
    if not source:
        raise RuntimeError("Could not find a source production job to clone for UI E2E mutation fixtures.")
    return source


def _clone_job(
    *,
    job_number: str,
    source: ProductionJob,
    process: Process,
    work_center: WorkCenter,
    from_location: InventoryLocation,
    to_location: InventoryLocation,
    machine: Machine | None = None,
    quantity_kg: Decimal = Decimal("12.0"),
    user: User | None = None,
) -> ProductionJob:
    job = ProductionJob.objects.create(
        job_number=job_number,
        origin=source.origin or "STOCK",
        source_type=source.source_type or "STOCK",
        execution_model_version=2,
        job_state="RELEASED",
        template=source.template,
        sales_order_item=source.sales_order_item,
        mts_order=source.mts_order,
        routing_rule=source.routing_rule,
        current_step_index=0,
        current_process=process,
        routing_step_index=0,
        process=process,
        work_center=work_center,
        machine=machine,
        operator=user if machine else None,
        priority=source.priority,
        planned_date=date.today(),
        is_on_hold=False,
        planner_notes="UI E2E mutation seed",
        input_form=process.input_form,
        output_form=process.output_form,
        produced_qty=Decimal("0"),
        remaining_qty=quantity_kg,
        from_location=from_location,
        to_location=to_location,
        quantity=quantity_kg,
        uom="KG",
        status="QUEUED",
    )
    return job


def _create_roll(
    *,
    label_prefix: str,
    material: InventoryMaterial,
    location: InventoryLocation,
    plant: Plant,
    grade: RecipeGrade | None,
    weight_kg: Decimal,
    width_mm: Decimal,
    thickness_micron: Decimal,
    batch_no: str,
    is_fg: bool = False,
    created_by_job: ProductionJob | None = None,
    production_job: ProductionJob | None = None,
    sales_order_item=None,
    template=None,
    current_step_index: int = 0,
    completed_step_index: int = 0,
    stage_index: int | None = None,
    meta_json: dict | None = None,
) -> InventoryRoll:
    roll = RollService.create_roll(
        material=material,
        weight_kg=weight_kg,
        location=location,
        width_mm=width_mm,
        thickness_micron=thickness_micron,
        batch_no=batch_no,
        grade=grade,
        is_fg=is_fg,
        plant=plant,
        user=None,
        notes="UI E2E mutation seed",
    )
    roll.label_id = f"{label_prefix}-{uuid4().hex[:6].upper()}"
    roll.created_by_job = created_by_job
    roll.production_job = production_job
    roll.sales_order_item = sales_order_item
    roll.template = template
    roll.current_step_index = current_step_index
    roll.completed_step_index = completed_step_index
    if stage_index is not None:
        roll.stage_index = stage_index
    if meta_json:
        roll.meta_json = meta_json
    roll.save(
        update_fields=[
            "label_id",
            "created_by_job",
            "production_job",
            "sales_order_item",
            "template",
            "current_step_index",
            "completed_step_index",
            "stage_index",
            "meta_json",
        ]
    )
    return roll


def _ensure_production_assignment(job: ProductionJob, work_center: WorkCenter, machine: Machine | None, status: str, user: User) -> ProductionWCAssignment:
    assignment, _ = ProductionWCAssignment.objects.update_or_create(
        production_job=job,
        defaults={
            "work_center": work_center,
            "assigned_machine": machine,
            "status": status,
            "assigned_by": user if machine else None,
            "assigned_at": timezone.now() if machine else None,
        },
    )
    return assignment


def _dispatch_target_sales_order(fallback_template=None) -> tuple[SalesOrder, SalesOrderItem]:
    seeded_order = SalesOrder.objects.filter(order_name=f"{PREFIX} Dispatch Seed").order_by("-created_at").first()
    seeded_item = seeded_order.items.order_by("created_at").first() if seeded_order else None
    if seeded_order and seeded_item:
        if seeded_order.status != "PACKING_READY":
            seeded_order.status = "PACKING_READY"
            seeded_order.save(update_fields=["status"])
        return seeded_order, seeded_item

    for candidate in FGDispatchService.get_sales_orders_with_fg():
        order = SalesOrder.objects.filter(id=candidate["id"]).first()
        item = order.items.order_by("created_at").first() if order else None
        if order and item:
            return order, item

    variant = (
        SalesSkuVariant.objects.select_related("sku", "sku__template")
        .filter(active=True, sku__active=True, sku__template__isnull=False)
        .order_by("-updated_at", "-created_at")
        .first()
    )
    template = (
        getattr(getattr(variant, "sku", None), "template", None)
        or fallback_template
    )
    if template is None:
        raise RuntimeError("Could not resolve a fallback template for UI E2E dispatch mutation seeding.")

    customer = (
        Customer.objects.filter(code="UAT-GREEN-SALES").first()
        or Customer.objects.filter(status="ACTIVE").order_by("name").first()
    )
    if customer is None:
        customer = Customer.objects.create(code=f"{PREFIX}-CUSTOMER", name=f"{PREFIX} Customer", status="ACTIVE")

    geometry_snapshot = dict(getattr(variant, "geometry_snapshot", None) or {})
    layer_snapshot = list(getattr(variant, "layer_snapshot", None) or [])
    printing_snapshot = dict(getattr(variant, "printing_snapshot", None) or {})
    addons_snapshot = list(getattr(variant, "addons_snapshot", None) or [])
    packaging_snapshot = dict(getattr(variant, "packaging_snapshot", None) or {})

    fg_type = str(getattr(variant, "finished_good_type", "") or geometry_snapshot.get("fg_type") or getattr(template, "fg_type", "POUCH")).upper()
    qty_uom = "PCS" if fg_type == "POUCH" else "KG"
    qty_value = Decimal("1000") if qty_uom == "PCS" else Decimal("5")
    unit_weight_g = Decimal("2.5000") if qty_uom == "PCS" else Decimal("0")
    total_weight_kg = (
        (qty_value * unit_weight_g) / Decimal("1000")
        if qty_uom == "PCS" and unit_weight_g > 0
        else qty_value
    )

    order = SalesOrder.objects.create(
        customer=customer,
        customer_name=customer.name,
        order_name=f"{PREFIX} Dispatch Seed",
        status="PACKING_READY",
        order_type="MTO",
    )
    item = SalesOrderItem.objects.create(
        sales_order=order,
        template=template,
        mode="TEMPLATE",
        sku_variant=variant,
        line_name=f"{PREFIX} Dispatch Seed Line",
        geometry_snapshot=geometry_snapshot,
        layer_snapshot=layer_snapshot,
        printing_snapshot=printing_snapshot,
        addons_snapshot=addons_snapshot,
        packaging_snapshot=packaging_snapshot,
        bom_snapshot={"items": []},
        qty_uom=qty_uom,
        qty_value=qty_value,
        unit_weight_g=unit_weight_g,
        total_weight_kg=total_weight_kg,
        price_basis="PCS" if qty_uom == "PCS" else "KG",
        unit_price=Decimal("1.0000"),
    )
    return order, item


def _seed_printing_sales_item(
    *,
    template,
    source_item: SalesOrderItem | None,
    source_variant: SalesSkuVariant | None,
    primary_ink_material: InkMaterial,
    secondary_ink_material: InkMaterial,
) -> tuple[SalesOrder, SalesOrderItem]:
    customer = (
        Customer.objects.filter(code="UAT-GREEN-SALES").first()
        or Customer.objects.filter(status="ACTIVE").order_by("name").first()
    )
    if customer is None:
        customer = Customer.objects.create(code=f"{PREFIX}-CUSTOMER", name=f"{PREFIX} Customer", status="ACTIVE")

    geometry_snapshot = dict(getattr(source_item, "geometry_snapshot", None) or getattr(source_variant, "geometry_snapshot", None) or {})
    layer_snapshot = list(getattr(source_item, "layer_snapshot", None) or getattr(source_variant, "layer_snapshot", None) or [])
    addons_snapshot = list(getattr(source_item, "addons_snapshot", None) or getattr(source_variant, "addons_snapshot", None) or [])
    packaging_snapshot = dict(getattr(source_item, "packaging_snapshot", None) or getattr(source_variant, "packaging_snapshot", None) or {})

    printing_snapshot = validate_frozen_printing_snapshot(
        {
            "enabled": True,
            "type": "FLEXO",
            "method": "FLEXO",
            "substrate_mode": "SHEET",
            "front_colors_count": 2,
            "back_colors_count": 0,
            "front_colors": ["RED", "BLACK"],
            "back_colors": [],
            "color_names": ["RED", "BLACK"],
            "ink_gsm_total": 1.2,
            "artwork_id": f"{PREFIX}-PRINT-ARTWORK",
            "artwork_design_code": f"{PREFIX}-PRINT-DESIGN",
            "cylinder_required": False,
            "color_mapping": {
                "RED": str(primary_ink_material.id),
                "BLACK": str(secondary_ink_material.id),
            },
            "ink_base_family": str(primary_ink_material.base_type or "").upper(),
        },
        layer_snapshot=layer_snapshot,
        require_artwork=True,
        strict_inks=True,
    )

    fg_type = str(
        geometry_snapshot.get("fg_type")
        or getattr(source_variant, "finished_good_type", "")
        or getattr(template, "fg_type", "ROLL")
    ).upper()
    roll_form = str(geometry_snapshot.get("roll_form") or getattr(source_variant, "roll_form", "") or "").upper()
    spec_payload = build_spec_payload(
        fg_type=fg_type,
        roll_form=roll_form,
        geometry=geometry_snapshot,
        film_layers=layer_snapshot,
        printing=printing_snapshot,
        addons=addons_snapshot,
    )
    invariant_payload = build_invariant_payload(film_layers=layer_snapshot, printing=printing_snapshot)

    order = SalesOrder.objects.create(
        customer=customer,
        customer_name=customer.name,
        order_name=f"{PREFIX} Printing Seed",
        order_type="MTO",
        status="CONFIRMED",
        geometry_override=_json_ready(geometry_snapshot),
        commercial_confirmed_at=timezone.now(),
        delivery_date=timezone.localdate(),
    )
    item = SalesOrderItem.objects.create(
        sales_order=order,
        template=template,
        mode="TEMPLATE",
        sku_variant=source_variant,
        line_name=f"{PREFIX} Printing Seed Line",
        geometry_snapshot=_json_ready(geometry_snapshot),
        layer_snapshot=_json_ready(layer_snapshot),
        printing_snapshot=_json_ready(printing_snapshot),
        addons_snapshot=_json_ready(addons_snapshot),
        packaging_snapshot=_json_ready(packaging_snapshot),
        bom_snapshot={"items": []},
        spec_signature=build_spec_signature(spec_payload),
        invariant_signature=build_invariant_signature(invariant_payload),
        unit_weight_g=Decimal("0"),
        total_weight_kg=Decimal("5.0000"),
        qty_uom="KG",
        qty_value=Decimal("5.00"),
        price_basis="KG",
        unit_price=Decimal("1.0000"),
        artwork_assignment_required=False,
    )
    return order, item


def _seed_extrusion_requirement(job: ProductionJob, material: InventoryMaterial, required_qty: Decimal):
    _seed_step_requirement(job, material, required_qty)


def _seed_step_requirement(
    job: ProductionJob,
    material: InventoryMaterial,
    required_qty: Decimal,
    *,
    process_code: str | None = None,
):
    first_step = (
        TemplateProcessStep.objects.filter(template=job.template)
        .filter(process__code=process_code) if process_code else TemplateProcessStep.objects.filter(template=job.template)
    )
    first_step = (
        first_step
        .order_by("sequence_number")
        .first()
    )
    if not first_step:
        raise RuntimeError(
            f"Template step metadata missing for seeded job {job.job_number}{f' ({process_code})' if process_code else ''}."
        )
    JobMaterialRequirement.objects.update_or_create(
        production_job=job,
        material=material,
        process_step=first_step,
        defaults={
            "required_qty": required_qty,
            "theoretical_qty": required_qty,
            "planned_issue_qty": required_qty,
            "uom": "KG",
        },
    )


def main():
    run_suffix = _suffix()
    runtime_path = runtime_dir() / "mutation-seed.json"
    print("[seed-ui-mutations] cleanup", flush=True)
    _cleanup_previous_seed_data()
    print("[seed-ui-mutations] lookup core masters", flush=True)
    admin = _ensure_admin()
    plant_a = _get_plant_context("PLANT_A")
    plant_b = _get_plant_context("PLANT_B")
    dspx = Plant.objects.filter(code="DSPX").first()
    dspx_fg = InventoryLocation.objects.filter(plant=dspx, code="FG").first() if dspx else None
    extrusion = _require(Process, code="EXTRUSION")
    printing = _require(Process, code="PRINTING")
    job_source = _find_job_template_source()
    print_source = (
        ProductionJob.objects.filter(current_process__code="PRINTING", template__isnull=False, work_center__isnull=False)
        .exclude(job_state__in=["COMPLETED", "CANCELLED"])
        .order_by("-created_at")
        .first()
    )
    print_source_item = getattr(print_source, "sales_order_item", None) or getattr(job_source, "sales_order_item", None)
    print_source_variant = (
        getattr(print_source_item, "sku_variant", None)
        or SalesSkuVariant.objects.filter(
            sku__template=(getattr(print_source, "template", None) or job_source.template),
            active=True,
        )
        .order_by("-updated_at", "-created_at")
        .first()
    )
    print_layer_snapshot = list(
        getattr(print_source_item, "layer_snapshot", None)
        or getattr(print_source_variant, "layer_snapshot", None)
        or []
    )
    print_ink_base = resolve_ink_base_from_layers(print_layer_snapshot)
    granule = _require(InventoryMaterial, category="GRANULE", code="GRANULE_LDPE")
    film_variant = _require(InventoryMaterial, category="FILM_VARIANT", code="VAR_PET_12")
    extrudable_variant = _require(InventoryMaterial, category="FILM_VARIANT", code="VAR_MLD_40")
    packaging_material = _require(InventoryMaterial, category="PACKAGING", code="PACK_INNER_100")
    primary_ink_material = _pick_active_ink("RED", base_type=print_ink_base) or _pick_active_ink("RED")
    secondary_ink_material = _pick_active_ink("BLACK", base_type=print_ink_base) or _pick_active_ink("BLACK")
    if primary_ink_material is None or secondary_ink_material is None:
        raise RuntimeError("At least two active INK materials are required for UI E2E printing mutation seeding.")
    if primary_ink_material.id == secondary_ink_material.id:
        secondary_ink_material = (
            InkMaterial.objects.filter(status="ACTIVE", base_type=str(primary_ink_material.base_type or "").upper())
            .exclude(id=primary_ink_material.id)
            .order_by("created_at")
            .first()
        )
    if secondary_ink_material is None:
        raise RuntimeError("Could not resolve a second active INK material for printing remix proof.")
    grade = _require(RecipeGrade, name="GP")
    vendor = _require(Vendor, code="JW_VENDOR_A")
    print_wc_map = (
        WorkCenterProcess.objects.select_related("work_center", "work_center__plant")
        .filter(process=printing)
        .order_by("work_center__plant__code", "work_center__code")
        .first()
    )
    if print_wc_map is None:
        raise RuntimeError("No work center is mapped to PRINTING for UI E2E printing mutation seeding.")
    print_work_center = print_wc_map.work_center
    print_machine = (
        Machine.objects.filter(work_center=print_work_center, status="ACTIVE").order_by("code").first()
        or Machine.objects.filter(work_center=print_work_center).order_by("code").first()
    )
    if print_machine is None:
        raise RuntimeError(f"No machine found for printing work center {print_work_center.code}.")
    print_ctx = PlantContext(
        plant=print_work_center.plant,
        work_center=print_work_center,
        machine=print_machine,
        rm=_require(InventoryLocation, plant=print_work_center.plant, code="RM"),
        wip=_require(InventoryLocation, plant=print_work_center.plant, code="WIP"),
        warehouse=_require(InventoryLocation, plant=print_work_center.plant, code="WAREHOUSE"),
        fg=_require(InventoryLocation, plant=print_work_center.plant, code="FG"),
    )
    vendor_fields = []
    if str(vendor.status or "").upper() != "ACTIVE":
        vendor.status = "ACTIVE"
        vendor_fields.append("status")
    if str(vendor.type or "").upper() not in {"JOBWORK", "BOTH"}:
        vendor.type = "BOTH"
        vendor_fields.append("type")
    capabilities = {str(code or "").upper() for code in (vendor.jobwork_capabilities or []) if str(code or "").strip()}
    if "EXTRUSION" not in capabilities:
        capabilities.add("EXTRUSION")
        vendor.jobwork_capabilities = sorted(capabilities)
        vendor_fields.append("jobwork_capabilities")
    plants = {str(code or "").upper() for code in (vendor.jobwork_plants or []) if str(code or "").strip()}
    plant_tokens = {str(plant_a.plant.id).upper(), str(plant_a.plant.code).upper()}
    if not plant_tokens.issubset(plants):
        vendor.jobwork_plants = sorted(plants | plant_tokens)
        vendor_fields.append("jobwork_plants")
    if vendor_fields:
        vendor.save(update_fields=vendor_fields + ["updated_at"])

    print("[seed-ui-mutations] scope users", flush=True)
    _ensure_user_scope(admin, plant_a.work_center, plant_a.machine)
    _ensure_user_scope(admin, plant_b.work_center, plant_b.machine)
    _ensure_user_scope(admin, print_ctx.work_center, print_ctx.machine)

    print("[seed-ui-mutations] printing sales source", flush=True)
    _, printing_sales_item = _seed_printing_sales_item(
        template=(getattr(print_source, "template", None) or job_source.template),
        source_item=print_source_item,
        source_variant=print_source_variant,
        primary_ink_material=primary_ink_material,
        secondary_ink_material=secondary_ink_material,
    )

    print("[seed-ui-mutations] operator fixture", flush=True)
    operator_job = _clone_job(
        job_number=OPERATOR_JOB_NUMBER,
        source=job_source,
        process=extrusion,
        work_center=plant_b.work_center,
        from_location=plant_b.rm,
        to_location=plant_b.wip,
        machine=plant_b.machine,
        quantity_kg=Decimal("9.0"),
        user=admin,
    )
    operator_assignment = _ensure_production_assignment(
        operator_job,
        plant_b.work_center,
        plant_b.machine,
        "EXECUTION_READY",
        admin,
    )
    _seed_extrusion_requirement(operator_job, granule, Decimal("9.000"))
    BulkService.add_bulk(
        material_id=granule.id,
        qty=Decimal("25.000"),
        plant_id=plant_b.plant.id,
        location_id=plant_b.rm.id,
        cost=Decimal("1.0"),
        reference=f"{PREFIX}-OP-BULK-{run_suffix}",
    )

    print("[seed-ui-mutations] printing fixture", flush=True)
    printing_source = print_source or job_source
    printing_job = _clone_job(
        job_number=PRINTING_JOB_NUMBER,
        source=printing_source,
        process=printing,
        work_center=print_ctx.work_center,
        from_location=print_ctx.wip,
        to_location=print_ctx.wip,
        machine=print_ctx.machine,
        quantity_kg=Decimal("5.0"),
        user=admin,
    )
    printing_job.sales_order_item = printing_sales_item
    printing_job.mts_order = None
    printing_job.current_step_index = 1
    printing_job.routing_step_index = 1
    printing_job.save(update_fields=["sales_order_item", "mts_order", "current_step_index", "routing_step_index"])
    printing_context = ExecutionService.get_job_context(str(printing_job.id))
    printing_target_spec = next(
        (
            spec
            for spec in (printing_context.get("target_roll_invariant_list") or [])
            if isinstance(spec, dict) and spec.get("variant_id")
        ),
        {},
    )
    printing_variant = (
        InventoryMaterial.objects.filter(id=printing_target_spec.get("variant_id")).first()
        or film_variant
    )
    printing_width_mm = Decimal(str(printing_target_spec.get("min_width_mm") or "200"))
    printing_thickness_micron = Decimal(str(printing_target_spec.get("thickness_micron") or "12"))
    printing_assignment = _ensure_production_assignment(
        printing_job,
        print_ctx.work_center,
        print_ctx.machine,
        "EXECUTION_READY",
        admin,
    )
    print_input_roll = _create_roll(
        label_prefix=f"{PREFIX}-PRINT-IN",
        material=printing_variant,
        location=print_ctx.wip,
        plant=print_ctx.plant,
        grade=None,
        weight_kg=Decimal("5.000"),
        width_mm=printing_width_mm,
        thickness_micron=printing_thickness_micron,
        batch_no=f"{PREFIX}-PRINT-{run_suffix}",
        created_by_job=operator_job,
        production_job=operator_job,
        current_step_index=1,
        completed_step_index=1,
        stage_index=1,
        meta_json={"ui_e2e_seed": True, "seed_type": "printing_input", "run_tag": RUN_TAG, "label_prefix": label("Mutations")},
    )
    if print_input_roll.status != "RESERVED":
        print_input_roll.status = "RESERVED"
        print_input_roll.save(update_fields=["status"])
    InventoryReservation.objects.update_or_create(
        job=printing_job,
        roll=print_input_roll,
        defaults={
            "material": print_input_roll.material,
            "quantity": print_input_roll.weight_kg,
            "uom": "KG",
            "status": "ACTIVE",
            "created_by": admin,
        },
    )
    _seed_step_requirement(printing_job, primary_ink_material, Decimal("0.250"), process_code="PRINTING")
    _seed_step_requirement(printing_job, secondary_ink_material, Decimal("0.150"), process_code="PRINTING")
    BulkService.add_bulk(
        material_id=primary_ink_material.id,
        qty=Decimal("5.000"),
        plant_id=print_ctx.plant.id,
        location_id=print_ctx.wip.id,
        cost=Decimal("1.0"),
        reference=f"{PREFIX}-PRINT-INK-A-{run_suffix}",
    )
    BulkService.add_bulk(
        material_id=secondary_ink_material.id,
        qty=Decimal("5.000"),
        plant_id=print_ctx.plant.id,
        location_id=print_ctx.wip.id,
        cost=Decimal("1.0"),
        reference=f"{PREFIX}-PRINT-INK-B-{run_suffix}",
    )

    print("[seed-ui-mutations] wcm fixture", flush=True)
    wcm_job = _clone_job(
        job_number=WCM_JOB_NUMBER,
        source=job_source,
        process=extrusion,
        work_center=plant_a.work_center,
        from_location=plant_a.rm,
        to_location=plant_a.wip,
        quantity_kg=Decimal("11.0"),
    )
    wcm_assignment = _ensure_production_assignment(
        wcm_job,
        plant_a.work_center,
        None,
        "WC_READY",
        admin,
    )
    _seed_extrusion_requirement(wcm_job, granule, Decimal("11.000"))
    BulkService.add_bulk(
        material_id=granule.id,
        qty=Decimal("25.000"),
        plant_id=plant_a.plant.id,
        location_id=plant_a.rm.id,
        cost=Decimal("1.0"),
        reference=f"{PREFIX}-WCM-BULK-{run_suffix}",
    )

    print("[seed-ui-mutations] jobwork fixture", flush=True)
    jobwork_source_job = _clone_job(
        job_number=JOBWORK_JOB_NUMBER,
        source=job_source,
        process=extrusion,
        work_center=plant_a.work_center,
        from_location=plant_a.rm,
        to_location=plant_a.wip,
        quantity_kg=Decimal("8.0"),
    )

    jobwork_roll = _create_roll(
        label_prefix=f"{PREFIX}-JW-ROLL",
        material=film_variant,
        location=plant_a.wip,
        plant=plant_a.plant,
        grade=None,
        weight_kg=Decimal("8.250"),
        width_mm=Decimal("1120"),
        thickness_micron=Decimal("12"),
        batch_no=f"{PREFIX}-JW-{run_suffix}",
        created_by_job=jobwork_source_job,
        production_job=jobwork_source_job,
        current_step_index=1,
        completed_step_index=1,
        stage_index=1,
        meta_json={"ui_e2e_seed": True, "seed_type": "jobwork_source", "run_tag": RUN_TAG, "label_prefix": label("Mutations")},
    )

    interplant_roll = _create_roll(
        label_prefix=f"{PREFIX}-IP-ROLL",
        material=film_variant,
        location=plant_a.warehouse,
        plant=plant_a.plant,
        grade=None,
        weight_kg=Decimal("6.750"),
        width_mm=Decimal("980"),
        thickness_micron=Decimal("12"),
        batch_no=f"{PREFIX}-IP-{run_suffix}",
        meta_json={"ui_e2e_seed": True, "seed_type": "interplant_source", "run_tag": RUN_TAG, "label_prefix": label("Mutations")},
    )

    print("[seed-ui-mutations] dispatch fixture", flush=True)
    dispatch_order, dispatch_item = _dispatch_target_sales_order(job_source.template)
    dispatch_roll = _create_roll(
        label_prefix=f"{PREFIX}-DSP-ROLL",
        material=film_variant,
        location=dspx_fg or plant_a.fg,
        plant=(dspx_fg.plant if dspx_fg else plant_a.plant),
        grade=None,
        weight_kg=Decimal("4.200"),
        width_mm=Decimal("620"),
        thickness_micron=Decimal("12"),
        batch_no=f"{PREFIX}-DSP-{run_suffix}",
        is_fg=True,
        sales_order_item=dispatch_item,
        template=dispatch_item.template,
        current_step_index=5,
        completed_step_index=5,
        stage_index=5,
        meta_json={"ui_e2e_seed": True, "seed_type": "dispatch_roll", "run_tag": RUN_TAG, "label_prefix": label("Mutations")},
    )
    PackagingService.add_packaging_stock(
        material_id=packaging_material.id,
        qty=Decimal("50"),
        location_id=dispatch_roll.location_id,
        cost=Decimal("1.0"),
        vendor_id=vendor.id,
        reference=f"{PREFIX}-PACK-{run_suffix}",
        input_uom="PCS",
    )

    print("[seed-ui-mutations] write metadata", flush=True)
    metadata = {
        "run_tag": RUN_TAG,
        "label_prefix": label("").strip(),
        "seeded_at": timezone.now().isoformat(),
        "admin_username": admin.username,
        "operator": {
            "machine_id": str(plant_b.machine.id),
            "machine_code": plant_b.machine.code,
            "job_id": str(operator_job.id),
            "job_number": operator_job.job_number,
            "assignment_id": str(operator_assignment.id),
        },
        "wcm": {
            "work_center_id": str(plant_a.work_center.id),
            "work_center_code": plant_a.work_center.code,
            "machine_id": str(plant_a.machine.id),
            "machine_code": plant_a.machine.code,
            "job_id": str(wcm_job.id),
            "job_number": wcm_job.job_number,
            "assignment_id": str(wcm_assignment.id),
        },
        "printing_operator": {
            "machine_id": str(print_ctx.machine.id),
            "machine_code": print_ctx.machine.code,
            "work_center_id": str(print_ctx.work_center.id),
            "work_center_code": print_ctx.work_center.code,
            "job_id": str(printing_job.id),
            "job_number": printing_job.job_number,
            "assignment_id": str(printing_assignment.id),
            "input_roll_id": str(print_input_roll.id),
            "input_roll_label": print_input_roll.label_id,
            "ink_material_id": str(primary_ink_material.id),
            "ink_material_code": primary_ink_material.code,
            "ink_materials": [
                {
                    "id": str(primary_ink_material.id),
                    "code": primary_ink_material.code,
                    "name": primary_ink_material.name,
                },
                {
                    "id": str(secondary_ink_material.id),
                    "code": secondary_ink_material.code,
                    "name": secondary_ink_material.name,
                },
            ],
        },
        "grn": {
            "plant_id": str(plant_a.plant.id),
            "plant_name": plant_a.plant.name,
            "bulk_location_id": str(plant_a.rm.id),
            "bulk_location_name": plant_a.rm.name,
            "roll_location_id": str(plant_a.warehouse.id),
            "roll_location_name": plant_a.warehouse.name,
            "vendor_id": str(vendor.id),
            "vendor_code": vendor.code,
            "bulk_material_id": str(granule.id),
            "bulk_material_code": granule.code,
            "roll_material_id": str(film_variant.id),
            "roll_material_code": film_variant.code,
            "roll_label_prefix": f"{PREFIX}-GRN-ROLL",
        },
        "interplant": {
            "from_plant_id": str(plant_a.plant.id),
            "from_plant_code": plant_a.plant.code,
            "from_plant_name": plant_a.plant.name,
            "to_plant_id": str(plant_b.plant.id),
            "to_plant_code": plant_b.plant.code,
            "to_plant_name": plant_b.plant.name,
            "destination_location_id": str(plant_b.warehouse.id),
            "destination_location_name": plant_b.warehouse.name,
            "roll_id": str(interplant_roll.id),
            "roll_label": interplant_roll.label_id,
        },
        "jobwork": {
            "plant_id": str(plant_a.plant.id),
            "plant_code": plant_a.plant.code,
            "plant_name": plant_a.plant.name,
            "vendor_id": str(vendor.id),
            "vendor_code": vendor.code,
            "production_job_id": str(jobwork_source_job.id),
            "production_job_number": jobwork_source_job.job_number,
            "source_roll_id": str(jobwork_roll.id),
            "source_roll_label": jobwork_roll.label_id,
            "receive_location_id": str(plant_a.warehouse.id),
            "receive_location_name": plant_a.warehouse.name,
            "return_material_id": str(extrudable_variant.id),
            "return_material_code": extrudable_variant.code,
            "return_grade_id": str(grade.id),
        },
        "dispatch": {
            "sales_order_id": str(dispatch_order.id),
            "sales_order_number": dispatch_order.order_number,
            "roll_id": str(dispatch_roll.id),
            "roll_label": dispatch_roll.label_id,
            "packaging_material_id": str(packaging_material.id),
            "packaging_material_code": packaging_material.code,
            "packaging_qty": 1,
        },
    }

    runtime_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print("UI E2E mutation seed complete:", json.dumps(metadata, indent=2))


if __name__ == "__main__":
    try:
        main()
    except ValidationError as exc:
        raise RuntimeError(str(exc)) from exc
