#!/usr/bin/env python3
"""
Targeted V2 recovery verification script.
Covers:
- Template minimal runtime contract (route sync + category mapping + roll policy)
- Sales create/confirm (printing off + printing on)
- Printing artwork type mismatch rejection
- Step-0 MODIFY_EXISTING reservation gate + same-output accumulation + remainder reset
- Roll->Bulk KG/PCS validations + batch-only output behavior
- Stable target/provenance payloads in machine context + analytics tracking
"""

import os
import sys
import uuid
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Dict, List, Optional

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django

django.setup()

from django.utils import timezone
from rest_framework.test import APIClient

from apps.users.models import User
from apps.sales.models import SalesOrder, SalesOrderItem, Customer
from apps.sales.services import SalesOrderService
from apps.templates.models import TemplateBlueprint, TemplateProcessStep
from apps.routing.models import RoutingRule
from apps.artwork.models import Artwork
from apps.inventory.models import InkMaterial, InventoryRoll, InventoryReservation, InventoryBulk
from apps.materials.models import InventoryMaterial
from apps.recipes.models import RecipeGrade
from apps.production.models import ProductionJob, FinishedGoodsBatch
from apps.production.services.job_services import JobService
from apps.production.services.operator_service import OperatorService
from apps.production.services.services_execution import ExecutionService


@dataclass
class Check:
    name: str
    ok: bool
    detail: str = ""


def _check(results: List[Check], name: str, ok: bool, detail: str = ""):
    results.append(Check(name=name, ok=ok, detail=detail))


def _fmt_exc(exc: Exception) -> str:
    return f"{type(exc).__name__}: {exc}"


def _must_admin() -> User:
    user = (
        User.objects.filter(is_superuser=True).first()
        or User.objects.filter(role_info__code__in=["SUPER_ADMIN", "ADMIN"]).first()
        or User.objects.first()
    )
    if not user:
        raise RuntimeError("No user found in database.")
    return user


def _must_customer() -> Customer:
    customer = Customer.objects.first()
    if customer:
        return customer
    return Customer.objects.create(name="V2 Test Customer", code=f"V2C-{uuid.uuid4().hex[:6]}")


def _must_routing_rule() -> RoutingRule:
    rule = RoutingRule.objects.filter(is_active=True).first() or RoutingRule.objects.first()
    if not rule:
        raise RuntimeError("No routing rule available.")
    return rule


def _find_live_template_with_steps() -> TemplateBlueprint:
    tpl = (
        TemplateBlueprint.objects
        .filter(status="LIVE", routing_rule__isnull=False)
        .order_by("-created_at")
        .first()
    )
    if not tpl:
        raise RuntimeError("No LIVE template with routing rule found.")
    return tpl


def _seed_artwork_for_print_type(print_type: str, front_colors: List[str], back_colors: List[str]) -> Artwork:
    design_code = f"AUTO-{print_type}-{uuid.uuid4().hex[:6].upper()}"
    return Artwork.objects.create(
        design_code=design_code,
        name=f"Auto {print_type} {design_code}",
        print_type=print_type,
        status="APPROVED",
        front_colors_count=len(front_colors),
        back_colors_count=len(back_colors),
        front_colors=[c.upper() for c in front_colors],
        back_colors=[c.upper() for c in back_colors],
        color_list=[*(c.upper() for c in front_colors), *(c.upper() for c in back_colors)],
        colors_count=len(front_colors) + len(back_colors),
        color_mapping={},
    )


def _pick_colors_for_base(base: str, needed: int = 2) -> List[str]:
    rows = list(
        InkMaterial.objects.filter(base_type=base).values_list("color_name", flat=True)
    )
    unique = []
    seen = set()
    for name in rows:
        key = str(name).strip().upper()
        if key and key not in seen:
            seen.add(key)
            unique.append(key)
    if len(unique) < needed:
        raise RuntimeError(f"Need >= {needed} {base} inks, found {len(unique)}")
    return unique[:needed]

def _ink_base_from_layers(layers: List[Dict[str, Any]]) -> str:
    for layer in layers or []:
        if not isinstance(layer, dict):
            continue
        try:
            den = Decimal(str(layer.get("density_g_cm3") or 0))
        except Exception:
            den = Decimal("0")
        if den >= Decimal("1.4"):
            return "PET"
    return "POLY"


def _build_sales_payload_from_template(template: TemplateBlueprint, customer: Customer, *, printing: Dict[str, Any]) -> Dict[str, Any]:
    # Prefer copying from an existing item for stable real-world shape.
    source_item = (
        SalesOrderItem.objects
        .filter(template=template)
        .exclude(layer_snapshot=[])
        .order_by("-created_at")
        .first()
    )
    if not source_item:
        raise RuntimeError("No source SalesOrderItem found for template to clone snapshots.")

    geom = dict(source_item.geometry_snapshot or {})
    geom.setdefault("base", {"width_mm": 300, "height_mm": 400})
    geom.setdefault("adjustments", [])
    geom.setdefault("multipliers", {"faces": 1, "repeats": 1})

    fg_type = str((geom.get("finished_good_type") or template.fg_type or "POUCH")).upper()
    roll_form = geom.get("roll_form") if fg_type == "ROLL" else None

    payload = {
        "customer": str(customer.id),
        "customer_name": customer.name,
        "delivery_date": (timezone.now().date()).isoformat(),
        "template_id": str(template.id),
        "mode": "TEMPLATE",
        "qty_value": 120,
        "qty_uom": "PCS",
        "fg_type": fg_type,
        "roll_form": roll_form,
        "geometry": geom,
        "film_layers": source_item.layer_snapshot or [],
        "printing": printing,
        "addons": source_item.addons_snapshot or [],
        "chemicals": (source_item.printing_snapshot or {}).get("chemicals") or {},
    }
    return payload


def _topup_bulk_for_job(job: ProductionJob):
    reqs = job.material_requirements.exclude(material__category__in=["FILM_VARIANT", "FILM_FAMILY"])
    if not reqs.exists():
        return
    location = job.from_location
    if not location and job.work_center and job.work_center.default_wip_location:
        location = job.work_center.default_wip_location
    if not location:
        return
    for req in reqs:
        bulk, _ = InventoryBulk.objects.get_or_create(
            material=req.material,
            plant=location.plant,
            location=location,
            defaults={"qty_kg": Decimal("1000")},
        )
        if Decimal(str(bulk.qty_kg or 0)) < Decimal("200"):
            bulk.qty_kg = Decimal("1000")
            bulk.save(update_fields=["qty_kg"])


def _compatible_roll_for_job(job: ProductionJob, *, label_prefix: str = "V2TEST") -> InventoryRoll:
    specs = ExecutionService._build_step_target_specs(job, job.current_process or job.process)
    chosen = next((s for s in specs if isinstance(s, dict) and (s.get("variant_id") or s.get("family_id"))), None)
    if not chosen:
        raise RuntimeError("No compatible target spec found for job.")

    mat: Optional[InventoryMaterial] = None
    if chosen.get("variant_id"):
        mat = InventoryMaterial.objects.filter(id=str(chosen["variant_id"])).first()
    elif chosen.get("family_id"):
        mat = (
            InventoryMaterial.objects
            .filter(category="FILM_VARIANT", parent_family_id=str(chosen["family_id"]))
            .order_by("created_at")
            .first()
        )
    if not mat:
        raise RuntimeError("Could not resolve compatible material for step spec.")

    grade_id = chosen.get("grade_id")
    grade = RecipeGrade.objects.filter(id=str(grade_id)).first() if grade_id else RecipeGrade.objects.first()
    if not grade:
        raise RuntimeError("No RecipeGrade found for test roll creation.")

    thickness = Decimal(str(chosen.get("thickness_micron") or 12))
    min_width = Decimal(str(chosen.get("min_width_mm") or 100))
    width = min_width + Decimal("5")

    location = job.from_location
    if not location and job.work_center and job.work_center.default_wip_location:
        location = job.work_center.default_wip_location
    if not location:
        raise RuntimeError("Job has no usable location for roll creation.")

    label = f"{label_prefix}-{uuid.uuid4().hex[:8].upper()}"
    roll = InventoryRoll.objects.create(
        label_id=label,
        material=mat,
        thickness_micron=thickness,
        width_mm=width,
        grade=grade,
        weight_kg=Decimal("35"),
        plant=location.plant,
        location=location,
        status="AVAILABLE",
        stage_index=0,
        current_step_index=0,
        completed_step_index=0,
        meta_json={"roll_role": "RAW_MATERIAL"},
    )
    return roll


def main() -> int:
    results: List[Check] = []
    client = APIClient()
    client.defaults["HTTP_HOST"] = "127.0.0.1"

    try:
        admin = _must_admin()
        client.force_authenticate(user=admin)
        _check(results, "auth/admin", True, f"user={admin.email or admin.username}")
    except Exception as exc:
        _check(results, "auth/admin", False, _fmt_exc(exc))
        _print_summary(results)
        return 1

    # 1) Template minimal contract endpoint checks
    created_template_id = None
    try:
        routing_rule = _must_routing_rule()
        create_resp = client.post(
            "/api/templates/",
            {
                "name": f"Auto V2 Template {uuid.uuid4().hex[:6]}",
                "fg_type": "POUCH",
                "routing_rule": str(routing_rule.id),
            },
            format="json",
        )
        ok = create_resp.status_code == 201
        created_template_id = (create_resp.data or {}).get("id") if ok else None
        _check(results, "template/create", ok, f"status={create_resp.status_code}; detail={getattr(create_resp, 'data', None)}")

        if created_template_id:
            sync_resp = client.post(f"/api/templates/{created_template_id}/sync-from-routing/")
            _check(
                results,
                "template/sync-route",
                sync_resp.status_code == 200,
                f"status={sync_resp.status_code}; steps_created={(sync_resp.data or {}).get('steps_created')}",
            )

            steps_resp = client.get(f"/api/templates/{created_template_id}/process-steps/")
            steps = steps_resp.data if isinstance(steps_resp.data, list) else []
            _check(results, "template/process-steps", steps_resp.status_code == 200 and len(steps) > 0, f"count={len(steps)}")

            if steps:
                first_step_id = steps[0]["id"]
                mat_resp = client.post(
                    f"/api/templates/{created_template_id}/process-steps/{first_step_id}/materials/",
                    {
                        "source_kind": "CATEGORY",
                        "category_code": "GRANULE",
                        "quantity_mode": "KG",
                        "value": 1,
                    },
                    format="json",
                )
                _check(results, "template/category-mapping", mat_resp.status_code in (200, 201), f"status={mat_resp.status_code}")

                roll_resp = client.patch(
                    f"/api/templates/{created_template_id}/process-steps/{first_step_id}/roll-spec/",
                    {
                        "input_roll_count": 1,
                        "thickness_rule": "INHERIT_INPUT",
                        "width_rule": "LOCK_INPUT",
                        "size_input_mode": "NONE",
                        "notes": "Auto verify",
                    },
                    format="json",
                )
                _check(results, "template/roll-spec", roll_resp.status_code == 200, f"status={roll_resp.status_code}")
    except Exception as exc:
        _check(results, "template/minimal-contract", False, _fmt_exc(exc))

    # 2) Sales create + confirm (printing disabled)
    so_plain: Optional[SalesOrder] = None
    template_for_order: Optional[TemplateBlueprint] = None
    try:
        customer = _must_customer()
        template_for_order = _find_live_template_with_steps()

        payload_plain = _build_sales_payload_from_template(
            template_for_order,
            customer,
            printing={"enabled": False},
        )
        create_plain = client.post("/api/sales/orders/", payload_plain, format="json")
        ok_create = create_plain.status_code == 201
        _check(results, "sales/create-no-print", ok_create, f"status={create_plain.status_code}; detail={getattr(create_plain, 'data', None)}")

        if ok_create:
            so_plain = SalesOrder.objects.get(id=create_plain.data["id"])
            confirm_plain = client.post(f"/api/sales/orders/{so_plain.id}/confirm/")
            _check(
                results,
                "sales/confirm-no-print",
                confirm_plain.status_code == 200 and str(confirm_plain.data.get("status")) == "PLANNING_REQUIRED",
                f"status={confirm_plain.status_code}; order_status={confirm_plain.data.get('status')}",
            )
    except Exception as exc:
        _check(results, "sales/no-print-flow", False, _fmt_exc(exc))

    # 3) Sales create + confirm (printing enabled) + mismatch rejection
    try:
        if not template_for_order:
            raise RuntimeError("template_for_order unavailable")
        customer = _must_customer()

        source_item = (
            SalesOrderItem.objects.filter(template=template_for_order)
            .exclude(layer_snapshot=[])
            .order_by("-created_at")
            .first()
        )
        if not source_item:
            raise RuntimeError("No source item to infer layer ink base.")
        ink_base = _ink_base_from_layers(source_item.layer_snapshot or [])
        c1, c2 = _pick_colors_for_base(ink_base, needed=2)

        flexo_art = _seed_artwork_for_print_type("FLEXO", [c1], [c2])
        payload_print = _build_sales_payload_from_template(
            template_for_order,
            customer,
            printing={
                "enabled": True,
                "type": "FLEXO",
                "substrate_mode": "SHEET",
                "front_colors_count": 1,
                "back_colors_count": 1,
                "ink_gsm_total": 1.8,
                "artwork_id": str(flexo_art.id),
            },
        )

        create_print = client.post("/api/sales/orders/", payload_print, format="json")
        _check(results, "sales/create-print", create_print.status_code == 201, f"status={create_print.status_code}; detail={getattr(create_print, 'data', None)}")

        if create_print.status_code == 201:
            so_print = SalesOrder.objects.get(id=create_print.data["id"])
            confirm_print = client.post(f"/api/sales/orders/{so_print.id}/confirm/")
            _check(results, "sales/confirm-print", confirm_print.status_code == 200, f"status={confirm_print.status_code}")

            # mismatch check: force ROTO with FLEXO artwork on a new order
            payload_bad = _build_sales_payload_from_template(
                template_for_order,
                customer,
                printing={
                    "enabled": True,
                    "type": "ROTO",
                    "substrate_mode": "SHEET",
                    "front_colors_count": 1,
                    "back_colors_count": 1,
                    "ink_gsm_total": 1.8,
                    "artwork_id": str(flexo_art.id),
                },
            )
            create_bad = client.post("/api/sales/orders/", payload_bad, format="json")
            if create_bad.status_code == 201:
                bad_order_id = create_bad.data["id"]
                confirm_bad = client.post(f"/api/sales/orders/{bad_order_id}/confirm/")
                mismatch_ok = confirm_bad.status_code == 400 and "print type" in str(confirm_bad.data).lower()
                _check(results, "sales/confirm-print-mismatch-rejected", mismatch_ok, f"status={confirm_bad.status_code}; detail={confirm_bad.data}")
            else:
                _check(results, "sales/create-mismatch-order", False, f"status={create_bad.status_code}; detail={create_bad.data}")
    except Exception as exc:
        _check(results, "sales/print-flow", False, _fmt_exc(exc))

    # 4) Production flow checks from no-print order (job creation + modify-existing behavior)
    first_job: Optional[ProductionJob] = None
    step0_target_before: Optional[float] = None
    step0_target_after: Optional[float] = None
    output_roll_id: Optional[str] = None
    try:
        if not so_plain:
            raise RuntimeError("No plain sales order available for production checks.")

        jobs = JobService.create_jobs_from_order(str(so_plain.id))
        _check(results, "jobs/create-from-order", len(jobs) > 0, f"jobs={len(jobs)}")
        _check(
            results,
            "jobs/version-v2",
            all(int(getattr(j, "execution_model_version", 0) or 0) == 2 for j in jobs),
            f"versions={[int(getattr(j,'execution_model_version',0) or 0) for j in jobs]}",
        )

        first_job = next((j for j in jobs if int(j.current_step_index or 0) == 0), None)
        if not first_job:
            raise RuntimeError("No step-0 job created.")

        first_job.job_state = "EXECUTING"
        first_job.status = "RUNNING"
        first_job.save(update_fields=["job_state", "status", "updated_at"])

        _topup_bulk_for_job(first_job)

        context_before = ExecutionService.get_job_context(str(first_job.id))
        step0_target_before = float((context_before.get("step_execution") or {}).get("total_target_kg") or 0)

        # Must fail without reserved roll.
        no_reservation_failed = False
        try:
            OperatorService.log_output_step(str(first_job.id), 2.0, admin)
        except Exception as exc:
            no_reservation_failed = "reserved roll" in str(exc).lower() or "missing reserved rolls" in str(exc).lower()
        _check(results, "modify-step0-reservation-required", no_reservation_failed)

        # Reserve compatible roll and log twice.
        test_roll = _compatible_roll_for_job(first_job)
        ExecutionService.assign_roll_to_job(str(first_job.id), str(test_roll.id), user=admin, manual_override=False)

        OperatorService.log_output_step(str(first_job.id), 5.0, admin)
        OperatorService.log_output_step(str(first_job.id), 3.0, admin)

        out_rolls = list(
            InventoryRoll.objects.filter(
                created_by_job=first_job,
                meta_json__roll_role="OUTPUT",
                stage_index=int(first_job.current_step_index or 0) + 1,
            ).order_by("created_at")
        )
        same_roll_ok = len(out_rolls) == 1 and abs(float(out_rolls[0].weight_kg) - 8.0) < 0.01
        _check(results, "modify-same-output-roll-accumulates", same_roll_ok, f"rolls={len(out_rolls)} weight={(out_rolls[0].weight_kg if out_rolls else 'NA')}")
        if out_rolls:
            output_roll_id = str(out_rolls[0].id)

        remainders = list(
            InventoryRoll.objects.filter(created_by_job=first_job, meta_json__is_remainder=True).order_by("-created_at")
        )
        rem_ok = False
        rem_detail = "none"
        if remainders:
            r = remainders[0]
            rem_ok = (
                int(r.stage_index or 0) == 0
                and int(r.current_step_index or 0) == 0
                and int(r.completed_step_index or 0) == 0
                and str(r.status).upper() == "AVAILABLE"
            )
            rem_detail = f"stage={r.stage_index},current={r.current_step_index},completed={r.completed_step_index},status={r.status}"
        _check(results, "remainder-reset-stage0-allocatable", rem_ok, rem_detail)

        context_after = ExecutionService.get_job_context(str(first_job.id))
        step0_target_after = float((context_after.get("step_execution") or {}).get("total_target_kg") or 0)
        stable = False
        if step0_target_before is not None and step0_target_after is not None:
            stable = abs(step0_target_before - step0_target_after) < 0.0001
        _check(results, "step-target-stable-across-logs", stable, f"before={step0_target_before} after={step0_target_after}")

        policy = (context_after.get("step_policy") or {})
        _check(
            results,
            "machine-context-v2-provenance",
            int(policy.get("execution_model_version") or 0) == 2
            and bool(policy.get("step_target_source"))
            and bool(policy.get("order_target_source")),
            f"policy={policy}",
        )
    except Exception as exc:
        _check(results, "modify-flow", False, _fmt_exc(exc))

    # 5) Roll->Bulk strict KG+PCS check on downstream job
    try:
        if not so_plain:
            raise RuntimeError("No plain sales order for roll->bulk checks.")

        so_item = so_plain.items.first()
        if not so_item:
            raise RuntimeError("SO has no item.")

        job2 = (
            ProductionJob.objects
            .filter(sales_order_item=so_item)
            .exclude(id=first_job.id if first_job else None)
            .filter(input_form="ROLL", output_form="BULK")
            .order_by("current_step_index")
            .first()
        )
        if not job2:
            raise RuntimeError("No roll->bulk downstream job found.")

        job2.job_state = "EXECUTING"
        job2.status = "RUNNING"
        job2.save(update_fields=["job_state", "status", "updated_at"])
        _topup_bulk_for_job(job2)

        # assign one roll to step-2 from step-1 output; fallback to a new compatible roll
        assigned_roll_id = output_roll_id
        if assigned_roll_id:
            try:
                ExecutionService.assign_roll_to_job(str(job2.id), str(assigned_roll_id), user=admin, manual_override=False)
            except Exception:
                ExecutionService.assign_roll_to_job(
                    str(job2.id),
                    str(assigned_roll_id),
                    user=admin,
                    manual_override=True,
                    override_reason="V2 verifier fallback override for downstream roll->bulk assignment",
                )
        else:
            fallback_roll = _compatible_roll_for_job(job2, label_prefix="V2TESTB")
            assigned_roll_id = str(fallback_roll.id)
            ExecutionService.assign_roll_to_job(str(job2.id), assigned_roll_id, user=admin, manual_override=False)

        missing_pcs_failed = False
        try:
            OperatorService.log_output_step(str(job2.id), 2.0, admin)
        except Exception as exc:
            missing_pcs_failed = "output_pcs is required" in str(exc).lower()
        _check(results, "roll-to-bulk-reject-missing-pcs", missing_pcs_failed)

        mismatch_failed = False
        try:
            OperatorService.log_output_step(str(job2.id), 2.0, admin, output_pcs=999999)
        except Exception as exc:
            mismatch_failed = "does not align" in str(exc).lower()
        _check(results, "roll-to-bulk-reject-kg-pcs-mismatch", mismatch_failed)

        unit_weight_g = Decimal(str(ExecutionService._job_unit_weight_g(job2) or 0))
        expected_pcs = int(((Decimal("2.0") * Decimal("1000")) / unit_weight_g).quantize(Decimal("1"))) if unit_weight_g > 0 else 0
        OperatorService.log_output_step(str(job2.id), 2.0, admin, output_pcs=expected_pcs)

        fg_batches = FinishedGoodsBatch.objects.filter(production_job=job2)
        has_batch = fg_batches.exists()
        _check(results, "roll-to-bulk-batch-created", has_batch, f"batches={fg_batches.count()}")

        output_rolls_job2 = InventoryRoll.objects.filter(created_by_job=job2, meta_json__roll_role="OUTPUT")
        _check(results, "roll-to-bulk-no-output-roll-artifact", output_rolls_job2.count() == 0, f"output_rolls={output_rolls_job2.count()}")
    except Exception as exc:
        _check(results, "roll-to-bulk-flow", False, _fmt_exc(exc))

    # 6) Tracking payload provenance
    try:
        if not so_plain:
            raise RuntimeError("No order for tracking check")
        tracking_resp = client.get(f"/api/analytics/orders/{so_plain.id}/tracking/")
        has_fields = False
        line_items = []
        data = tracking_resp.data if isinstance(tracking_resp.data, dict) else {}
        line_items = data.get("line_items") or data.get("items") or []
        if isinstance(line_items, list) and line_items:
            probe = line_items[0]
            has_fields = (
                "execution_model_version" in probe
                and "step_target_source" in probe
                and "route_target_source" in probe
            )
        _check(results, "analytics-tracking-provenance", tracking_resp.status_code == 200 and has_fields, f"status={tracking_resp.status_code}")
    except Exception as exc:
        _check(results, "analytics-tracking", False, _fmt_exc(exc))

    _print_summary(results)
    return 0 if all(r.ok for r in results) else 2


def _print_summary(results: List[Check]):
    print("\n=== V2 RECOVERY VERIFICATION SUMMARY ===")
    passed = 0
    for idx, row in enumerate(results, start=1):
        status = "PASS" if row.ok else "FAIL"
        if row.ok:
            passed += 1
        print(f"{idx:02d}. [{status}] {row.name} :: {row.detail}")
    print(f"\nTOTAL: {passed}/{len(results)} passed")


if __name__ == "__main__":
    sys.exit(main())
