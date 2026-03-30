import json
import os
import sys
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import uuid4

import django

sys.path.insert(0, os.getcwd())
os.environ.setdefault("SKIP_CELERY_IMPORT", "1")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from django.core.exceptions import ValidationError
from django.db.models import Q
from django.utils import timezone

from apps.factory.models import Machine, Plant, Process, WorkCenter
from apps.inventory.models import (
    DeliveryChallan as InterPlantDeliveryChallan,
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
from apps.recipes.models import RecipeGrade
from apps.sales.models import SalesOrder
from apps.templates.models import TemplateProcessStep
from apps.users.models import MachineAssignment, User, WorkCenterAssignment as UserWCAssignment
from apps.inventory.models import Vendor
from scripts.e2e_green_utils import CODE_PREFIX, current_run_tag, label, runtime_dir


RUN_TAG = current_run_tag()
PREFIX = f"{CODE_PREFIX}-MUT"
OPERATOR_JOB_NUMBER = f"{PREFIX}-OP-{RUN_TAG}"
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


def _dispatch_target_sales_order() -> tuple[SalesOrder, object]:
    candidates = list(FGDispatchService.get_sales_orders_with_fg())
    if not candidates:
        raise RuntimeError("No sales order with dispatchable FG is available for UI E2E mutation seeding.")
    for candidate in candidates:
        order = SalesOrder.objects.filter(id=candidate["id"]).first()
        item = order.items.order_by("created_at").first() if order else None
        if order and item:
            return order, item
    raise RuntimeError("Dispatchable sales order exists but no sales-order item could be resolved.")


def _seed_extrusion_requirement(job: ProductionJob, material: InventoryMaterial, required_qty: Decimal):
    first_step = (
        TemplateProcessStep.objects.filter(template=job.template)
        .order_by("sequence_number")
        .first()
    )
    if not first_step:
        raise RuntimeError(f"Template step metadata missing for seeded job {job.job_number}.")
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
    _cleanup_previous_seed_data()
    admin = _ensure_admin()
    plant_a = _get_plant_context("PLANT_A")
    plant_b = _get_plant_context("PLANT_B")
    dspx = Plant.objects.filter(code="DSPX").first()
    dspx_fg = InventoryLocation.objects.filter(plant=dspx, code="FG").first() if dspx else None
    extrusion = _require(Process, code="EXTRUSION")
    job_source = _find_job_template_source()
    granule = _require(InventoryMaterial, category="GRANULE", code="GRANULE_LDPE")
    film_variant = _require(InventoryMaterial, category="FILM_VARIANT", code="VAR_PET_12")
    extrudable_variant = _require(InventoryMaterial, category="FILM_VARIANT", code="VAR_MLD_40")
    packaging_material = _require(InventoryMaterial, category="PACKAGING", code="PACK_INNER_100")
    grade = _require(RecipeGrade, name="GP")
    vendor = _require(Vendor, code="JW_VENDOR_A")
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

    _ensure_user_scope(admin, plant_a.work_center, plant_a.machine)
    _ensure_user_scope(admin, plant_b.work_center, plant_b.machine)

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

    dispatch_order, dispatch_item = _dispatch_target_sales_order()
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
