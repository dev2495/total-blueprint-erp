"""Planned route steps that run at a job worker.

* Step guard: a job-work order completes its route step only while the job is
  still on that step (``step_position``). A job that already moved on (early
  release, or completed by the planner / work-centre manager) is reported and
  left untouched; a job that has not reached the step is a conflict.
* ``complete_route_step``: completes the step as the real user through
  ``JobService.complete_step(material_settled_externally=True)`` — the job
  worker's material use is settled by the order, so the close-time
  auto-consumption from the job's WIP location never runs for job work.
* ``release_route_step``: "continue production with what's back". The step is
  completed while material is still at the job worker; the order stays open
  for the rest, later returns land ready for the next step, and closing the
  order never completes a step again.
* ``sync_step_requirements``: the step's JobMaterialRequirement actuals. Our
  material that went out on the challan is counted from its settlements
  (consumed + written off, unit-converted, no stock movement: it already left
  through JOBWORK_OUT); material the job worker supplied is recorded as zero
  factory consumption and flagged ``JOBWORK_VENDOR``.
"""
from __future__ import annotations

import logging
from decimal import Decimal
from typing import Dict, List, Optional, Tuple

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Q, Sum
from django.utils import timezone
from rest_framework.exceptions import APIException, ValidationError

from apps.inventory.models import JOBWORK_FINAL_STATUSES, JobWorkOrder, JobWorkSettlement
from apps.inventory.services.job_work import (
    STATUS_LABELS,
    ZERO,
    Conflict,
    audit,
    legacy_stuck_rolls,
    line_balances,
    messages_of,
    order_process,
)

logger = logging.getLogger(__name__)

ON_STEP = "ON_STEP"
PAST = "PAST"
BLOCKED = "BLOCKED"
Q4 = Decimal("0.0001")
FILM_CATEGORIES = {"FILM_VARIANT", "FILM_FAMILY"}


# ------------------------------------------------------------------ guard
def order_step_index(order: JobWorkOrder, job) -> int:
    if order.route_step_index is not None:
        return int(order.route_step_index)
    return int(getattr(job, "current_step_index", 0) or 0)


def step_label(order: JobWorkOrder, job) -> str:
    process = order_process(order)
    name = getattr(process, "name", None) or getattr(process, "code", None) or "job work"
    return f"route step {order_step_index(order, job) + 1} ({name})"


def _when(value) -> str:
    return f"{timezone.localtime(value):%d %b %Y %H:%M}" if value else "earlier"


def step_position(order: JobWorkOrder, job) -> Tuple[str, str]:
    """Where the job stands against the order's route step.

    ``ON_STEP``: the job is on the step and paused/running (completable).
    ``PAST``: the step is already complete (released early, or completed by the
    planner / work-centre manager). ``BLOCKED``: anything else, with the reason.
    """
    step = order_step_index(order, job)
    current = int(getattr(job, "current_step_index", 0) or 0)
    label = step_label(order, job)
    state = str(job.job_state or "").upper()
    if current > step:
        return PAST, f"Job {job.job_number} has already moved past {label} (it is at route step {current + 1})."
    if current < step:
        return BLOCKED, (
            f"Job {job.job_number} is at route step {current + 1}, before this order's {label}. "
            "Its earlier steps must finish first; ask the planner to check the route."
        )
    if state == "COMPLETED":
        if order.step_released_at:
            return PAST, f"{label[0].upper()}{label[1:]} of job {job.job_number} was completed on {_when(order.step_released_at)} when production continued with what was back."
        who = getattr(job.closed_by, "username", None) if getattr(job, "closed_by_id", None) else None
        by = f" by {who}" if who else ""
        return PAST, f"{label[0].upper()}{label[1:]} of job {job.job_number} was already completed{by} on {_when(job.closed_at)} outside this order."
    if state in {"EXECUTING", "PAUSED"}:
        return ON_STEP, ""
    if state in {"PLANNED", "WAITING"}:
        return BLOCKED, f"Job {job.job_number} has not reached {label} yet (it is {state.lower()}). Release it from the planner first."
    if state == "CANCELLED":
        return BLOCKED, f"Job {job.job_number} is cancelled; its route step cannot be completed."
    return BLOCKED, f"Job {job.job_number} is {state.lower()}; the job-work step can only be completed while the job is paused for job work."


def is_last_route_step(job) -> bool:
    from apps.production.services.job_services import JobService

    return bool(JobService._is_final_route_step(job))


def next_step_jobs(job) -> list:
    """Jobs of the next route step for the same batch / sales line / stock order."""
    from apps.production.models import ProductionJob
    from apps.production.services.batch_route_service import RouteGraphService

    filters = {"routing_rule_id": job.routing_rule_id}
    if getattr(job, "production_batch_id", None):
        filters["production_batch_id"] = job.production_batch_id
    elif getattr(job, "sales_order_item_id", None):
        filters["sales_order_item_id"] = job.sales_order_item_id
    elif getattr(job, "mts_order_id", None):
        filters["mts_order_id"] = job.mts_order_id
    else:
        return []
    scope = ProductionJob.objects.filter(**filters).exclude(id=job.id).exclude(job_state="CANCELLED").select_related("current_process", "process", "work_center")
    successor_ids = []
    if job.routing_rule_id:
        try:
            node = RouteGraphService.node_for_job(job)
            successor_ids = list((node or {}).get("successor_node_ids") or [])
        except Exception:  # route graph is best effort for display
            logger.debug("Route graph unavailable for job %s", job.id, exc_info=True)
    if successor_ids:
        rows = list(scope.filter(route_node_id__in=successor_ids).order_by("current_step_index", "created_at"))
        if rows:
            return rows
    later = list(scope.filter(current_step_index__gt=job.current_step_index).order_by("current_step_index", "created_at"))
    if not later:
        return []
    first = later[0].current_step_index
    return [row for row in later if row.current_step_index == first]


def next_jobs_payload(job) -> List[dict]:
    rows = []
    for nxt in next_step_jobs(job):
        process = nxt.current_process or nxt.process
        rows.append({
            "id": str(nxt.id), "job_number": nxt.job_number, "job_state": nxt.job_state,
            "step_number": int(nxt.current_step_index or 0) + 1,
            "process_code": getattr(process, "code", None), "process_name": getattr(process, "name", None),
            "work_center_name": getattr(nxt.work_center, "name", None),
            "is_on_hold": bool(nxt.is_on_hold),
        })
    return rows


def step_progress(job) -> Optional[dict]:
    """Step output against its target (same profile complete_step checks)."""
    from apps.production.services.services_execution import ExecutionService

    try:
        profile = ExecutionService.get_step_execution_profile(job.id)
    except Exception:  # display only; completion re-checks with the real rules
        logger.warning("Step profile unavailable for job %s", job.id, exc_info=True)
        return None
    if profile.get("missing"):
        return None
    uom = str(profile.get("primary_uom") or "KG").upper()

    def pick(primary, fallback):
        value = profile.get(primary)
        return Decimal(str(value if value is not None else profile.get(fallback) or 0))

    target = pick("step_target_primary", "step_target_total_kg")
    produced = pick("step_produced_primary", "step_produced_kg")
    remaining = pick("step_remaining_primary", "step_remaining_kg")
    tolerance = Decimal(str(profile.get("tolerance_primary") if profile.get("tolerance_primary") is not None else profile.get("tolerance_kg") or "0.25"))
    return {
        "uom": uom,
        "target": target.quantize(Q4),
        "produced": produced.quantize(Q4),
        "remaining": remaining.quantize(Q4),
        "tolerance": tolerance.quantize(Q4),
        "short": remaining > tolerance,
    }


# --------------------------------------------------------------- complete
def complete_route_step(order: JobWorkOrder, job, user, force_reason: str) -> dict:
    """Complete the job-work route step (job locked by the caller, on the step)."""
    from apps.production.services.job_services import JobService

    try:
        JobService.complete_step(job, user=user, force_reason=force_reason or None, material_settled_externally=True)
    except (ValueError, DjangoValidationError) as exc:
        message = messages_of(exc)
        if "force_reason" in message:
            raise ValidationError({"step_force_reason": (
                f"Job {job.job_number} is short of its step target: {message.split(' Provide')[0]} "
                "Give a reason to complete the step with a variance."
            )})
        raise Conflict(f"Job {job.job_number}: the route step could not be completed. {message}")
    except APIException:
        raise
    except Exception as exc:  # route engine errors (dispatch rules, successors)
        logger.exception("Job-work step completion failed for job %s", job.job_number)
        raise Conflict(f"Job {job.job_number}: the route step could not be completed. {exc}")
    job.refresh_from_db()
    if job.is_on_hold:
        job.is_on_hold = False
        job.hold_reason = None
        job.save(update_fields=["is_on_hold", "hold_reason", "updated_at"])
    materials = sync_step_requirements(order, job)
    following = next_jobs_payload(job)
    who = getattr(user, "username", "system")
    detail = f"Route step completed by {who}."
    if following:
        nxt = following[0]
        detail += f" Job {nxt['job_number']} ({nxt['process_name'] or 'next step'}) is {str(nxt['job_state']).lower()}."
    return {"job_number": job.job_number, "action": "STEP_COMPLETED", "detail": detail, "next_jobs": following, "materials": materials}


def release_route_step(order: JobWorkOrder, user, data: dict) -> dict:
    """Continue production with what is back: complete the step now, keep the order open."""
    from apps.production.models import ProductionJob

    if order.mode != "PLANNED_STEP" or not order.production_job_id:
        raise Conflict("Only a planned route-step order can continue production before it closes. An emergency handoff releases its job when the order closes.")
    if order.status in JOBWORK_FINAL_STATUSES:
        raise Conflict(f"Order {order.number} is already {STATUS_LABELS.get(order.status, order.status).lower()}.")
    if order.status == "DRAFT":
        raise Conflict(f"Nothing was sent on {order.number} yet.")
    if order.step_released_at:
        by = getattr(order.step_released_by, "username", None) if order.step_released_by_id else None
        raise Conflict(f"Production already continued on {_when(order.step_released_at)}{f' ({by})' if by else ''}. Receive the rest and close the order.")
    if legacy_stuck_rolls(order):
        raise Conflict("This order still has rolls from before the upgrade at the job worker. Ask an owner to reconcile them first.")
    if not order.returns.filter(Q(output_kg__gt=0) | Q(output_pcs__gt=0)).exists():
        raise Conflict(
            f"Nothing processed has come back from {order.vendor_name} yet. Receive the processed material first; "
            "production can then continue with it."
        )
    job = ProductionJob.objects.select_for_update(of=("self",)).select_related("work_center", "closed_by", "current_process", "process", "routing_rule").get(id=order.production_job_id)
    position, detail = step_position(order, job)
    if position == PAST:
        raise Conflict(f"{detail} Nothing to continue: receive the rest and close the order.")
    if position != ON_STEP:
        raise Conflict(detail)
    if is_last_route_step(job):
        raise Conflict(
            f"{step_label(order, job)[0].upper()}{step_label(order, job)[1:]} is the last route step of job {job.job_number}. "
            "Finished pieces are available to packing and dispatch as they come back; close the order when everything is back, or close it short."
        )
    reason = str(data.get("step_force_reason") or "").strip()
    step = complete_route_step(order, job, user, reason)
    order.step_released_at = timezone.now()
    order.step_released_by = user if getattr(user, "pk", None) else None
    order.step_release_reason = reason
    order.save(update_fields=["step_released_at", "step_released_by", "step_release_reason", "updated_at"])
    balances = line_balances(order)
    open_rows = [row for row in balances.values() if row["is_open"]]
    at_vendor = sum((row["open_kg"] for row in open_rows), ZERO)
    audit(order, "JW_STEP_RELEASED", user, reason, {
        "job": job.job_number, "step": order_step_index(order, job) + 1, "next_jobs": [row["job_number"] for row in step["next_jobs"]],
        "at_vendor_kg": at_vendor, "open_lines": len(open_rows),
    })
    return {"order_id": str(order.id), "status": order.status, "step": step}


# ------------------------------------------------------- material actuals
def _norm_uom(value) -> str:
    from apps.inventory.services.bulk_service import BulkService

    return BulkService._normalize_uom(value or "KG")


def kg_per_piece(material) -> Optional[Decimal]:
    try:
        if str(getattr(material, "weight_mode", "") or "").upper() in {"PER_PIECE", "FIXED"} and material.weight_value:
            grams = Decimal(str(material.weight_value))
            if grams > 0:
                return grams / Decimal("1000")
        per_piece = getattr(material, "per_sheet_base_qty", None)
        if per_piece and _norm_uom(material.base_uom) == "KG" and Decimal(str(per_piece)) > 0:
            return Decimal(str(per_piece))
    except (ValueError, TypeError, ArithmeticError):
        return None
    return None


def to_requirement_uom(qty: Decimal, uom: str, requirement) -> Optional[Decimal]:
    """Quantity in the requirement's unit, or None when it cannot be converted."""
    source, target = _norm_uom(uom), _norm_uom(requirement.uom or getattr(requirement.material, "base_uom", "KG"))
    if source == target:
        return qty
    factor = kg_per_piece(requirement.material)
    if factor:
        if source == "PCS" and target == "KG":
            return qty * factor
        if source == "KG" and target == "PCS":
            return qty / factor
    return None


def _set_actuals(req, *, issued, returned, consumed, scrap, variance, source, note) -> None:
    req.actual_issued_qty = Decimal(issued).quantize(Q4)
    req.actual_returned_qty = Decimal(returned).quantize(Q4)
    req.consumed_qty = Decimal(consumed).quantize(Q4)
    req.actual_scrap_qty = Decimal(scrap).quantize(Q4)
    req.variance_qty = Decimal(variance).quantize(Q4)
    req.is_estimated = False
    req.supply_source = source
    req.supply_note = note[:255]
    req.save(update_fields=[
        "actual_issued_qty", "actual_returned_qty", "consumed_qty", "actual_scrap_qty", "variance_qty",
        "is_estimated", "supply_source", "supply_note", "updated_at",
    ])


def _requirement_row(req, note: str = "") -> dict:
    material = req.material
    return {
        "material": (material.name or material.code) if material else None,
        "uom": req.uom,
        "supply_source": req.supply_source,
        "consumed": format(Decimal(str(req.consumed_qty)).normalize(), "f"),
        "note": note or req.supply_note,
    }


def sync_step_requirements(order: JobWorkOrder, job) -> List[dict]:
    """Set the job-work step's material actuals from the order (no stock movement).

    * Bulk material sent on the challan: consumed = Σ settled consumed (returns
      and short-close write-offs), returned = Σ returned, issued = both;
      converted to the requirement's unit.
    * Film rolls sent: consumed / balance kg of the settled rolls, vendor
      wastage shared by consumption (as the terminal does for roll usage).
    * Inner packs the factory issued when finished pieces were booked.
    * Anything else is the job worker's own material: zero factory
      consumption, flagged JOBWORK_VENDOR — unless the factory had already
      issued it in-house before the order, which stays as recorded.
    Re-running (close after an early release) recomputes the same rows.
    """
    from apps.production.models import JobMaterialRequirement

    step_seq = order_step_index(order, job) + 1
    reqs = list(
        JobMaterialRequirement.objects.select_for_update(of=("self",)).select_related("material", "material__parent_family")
        .filter(production_job=job, process_step__sequence_number=step_seq).order_by("id")
    )
    if not reqs:
        return []
    vendor = order.vendor_name or "the job worker"
    totals = {
        row["sent_line_id"]: row
        for row in JobWorkSettlement.objects.filter(order=order).values("sent_line_id").annotate(
            consumed_qty=Sum("consumed_qty"), returned_qty=Sum("returned_qty"), consumed_kg=Sum("consumed_kg"), returned_kg=Sum("returned_kg"),
        )
    }
    bulk: Dict[str, dict] = {}
    rolls: Dict[str, dict] = {}
    for line in order.sent_lines.select_related("material", "material__parent_family", "challan"):
        settled = totals.get(line.id)
        if not settled or not line.material_id:
            continue
        challan = line.challan.number if line.challan_id else "legacy reconciliation"
        if line.kind == "BULK":
            row = bulk.setdefault(str(line.material_id), {"parts": [], "challans": set()})
            row["parts"].append((Decimal(str(settled["consumed_qty"] or 0)), Decimal(str(settled["returned_qty"] or 0)), line.uom))
            row["challans"].add(challan)
        else:
            row = rolls.setdefault(str(line.material_id), {"consumed": ZERO, "returned": ZERO, "challans": set(), "family": str(line.material.parent_family_id or "")})
            row["consumed"] += Decimal(str(settled["consumed_kg"] or 0))
            row["returned"] += Decimal(str(settled["returned_kg"] or 0))
            row["challans"].add(challan)

    packs: Dict[str, Decimal] = {}
    for ret in order.returns.prefetch_related("lines__fg_batch"):
        for line in ret.lines.all():
            if line.kind != "FG_PCS" or not line.fg_batch_id:
                continue
            pack = (line.fg_batch.meta_json or {}).get("primary_inner_pack") or {}
            if isinstance(pack, dict) and pack.get("material_id") and pack.get("source") != "JOBWORK_VENDOR":
                packs[str(pack["material_id"])] = packs.get(str(pack["material_id"]), ZERO) + Decimal(str(pack.get("pack_count") or 0))

    wastage = Decimal(str(order.returns.aggregate(total=Sum("wastage_kg"))["total"] or 0))
    film_reqs = [req for req in reqs if str(getattr(req.material, "category", "") or "").upper() in FILM_CATEGORIES]
    film_alloc: Dict[str, dict] = {}
    for material_id, row in rolls.items():
        match = next((req for req in film_reqs if str(req.material_id) == material_id), None)
        if match is None and row["family"]:
            match = next((req for req in film_reqs if str(req.material_id) == row["family"]), None)
        if match is None and len(film_reqs) == 1:
            match = film_reqs[0]
        if match is None:
            continue
        slot = film_alloc.setdefault(str(match.id), {"consumed": ZERO, "returned": ZERO, "challans": set()})
        slot["consumed"] += row["consumed"]
        slot["returned"] += row["returned"]
        slot["challans"] |= row["challans"]
    film_consumed = sum((slot["consumed"] for slot in film_alloc.values()), ZERO)

    summary = []
    for req in reqs:
        category = str(getattr(req.material, "category", "") or "").upper()
        theoretical = Decimal(str(req.theoretical_qty or 0))
        if category in FILM_CATEGORIES and str(req.id) in film_alloc:
            slot = film_alloc[str(req.id)]
            scrap = (wastage * slot["consumed"] / film_consumed) if film_consumed > 0 else ZERO
            consumed = to_requirement_uom(slot["consumed"], "KG", req)
            returned = to_requirement_uom(slot["returned"], "KG", req)
            if consumed is None or returned is None:
                summary.append(_requirement_row(req, f"Rolls were sent in kg; the requirement is in {req.uom}. Not updated."))
                continue
            note = f"Rolls sent on {', '.join(sorted(slot['challans']))}; used by {vendor} ({order.number})."
            _set_actuals(req, issued=consumed + returned, returned=returned, consumed=consumed, scrap=scrap, variance=consumed - theoretical, source=JobMaterialRequirement.SUPPLY_JOBWORK_SENT, note=note)
            summary.append(_requirement_row(req))
            continue
        if category in FILM_CATEGORIES and rolls:
            # Rolls went out but none matches this film row: never guess, and
            # never call our film the job worker's.
            summary.append(_requirement_row(req, "The rolls sent do not match this film; not updated."))
            continue
        sent = bulk.get(str(req.material_id)) if category not in FILM_CATEGORIES else None
        if sent:
            consumed, returned, unconvertible = ZERO, ZERO, None
            for used, back, uom in sent["parts"]:
                used_req, back_req = to_requirement_uom(used, uom, req), to_requirement_uom(back, uom, req)
                if used_req is None or back_req is None:
                    unconvertible = uom
                    break
                consumed += used_req
                returned += back_req
            if unconvertible:
                summary.append(_requirement_row(req, f"Sent in {unconvertible}; the requirement is in {req.uom} and has no conversion. Not updated."))
                continue
            note = f"Sent on {', '.join(sorted(sent['challans']))}; used by {vendor} ({order.number})."
            _set_actuals(req, issued=consumed + returned, returned=returned, consumed=consumed, scrap=ZERO, variance=consumed - theoretical, source=JobMaterialRequirement.SUPPLY_JOBWORK_SENT, note=note)
            summary.append(_requirement_row(req))
            continue
        pack_count = packs.get(str(req.material_id)) if category not in FILM_CATEGORIES else None
        if pack_count:
            used = to_requirement_uom(pack_count, "PCS", req)
            if used is None:
                summary.append(_requirement_row(req, f"Inner packs are counted in pieces; the requirement is in {req.uom}. Not updated."))
                continue
            note = f"Inner packs issued from factory packing stock when finished pieces were booked ({order.number})."
            _set_actuals(req, issued=used, returned=ZERO, consumed=used, scrap=ZERO, variance=used - theoretical, source=JobMaterialRequirement.SUPPLY_FACTORY, note=note)
            summary.append(_requirement_row(req))
            continue
        had_factory_actuals = req.supply_source != JobMaterialRequirement.SUPPLY_JOBWORK_VENDOR and any(
            Decimal(str(value or 0)) != 0 for value in (req.actual_issued_qty, req.actual_returned_qty, req.consumed_qty)
        )
        if had_factory_actuals:
            summary.append(_requirement_row(req, "Issued in-house before the job work; kept as recorded."))
            continue
        note = f"Supplied by {vendor} on job-work order {order.number}; no factory stock used."
        _set_actuals(req, issued=ZERO, returned=ZERO, consumed=ZERO, scrap=ZERO, variance=ZERO, source=JobMaterialRequirement.SUPPLY_JOBWORK_VENDOR, note=note)
        summary.append(_requirement_row(req))
    return summary
