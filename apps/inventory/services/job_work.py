"""Job work: orders, Rule 45 challans, returns, close and legacy reconciliation.

Flow (docs/documents-jobwork/SPEC.md, FINAL-PLAN §5)::

    order (DRAFT) → dispatch = JWC challan + sent lines; material moves to the
    plant's JOBWORK_OUT location (rolls become SENT_JOBWORK)
    → return(s) (JWR): every sent line a return covers is *settled* — processed
      at the vendor (consumed, with lineage) or returned to the factory
      (balance roll / bulk back in stock). Outputs become normal ERP stock
      (FG batch, output rolls, bulk) and wastage a ScrapLog against the job.
    → close when nothing remains at the vendor (short-close writes off the
      rest with a reason). Only closing completes a planned route step.

Every mutation locks the order row (SELECT ... FOR UPDATE) and is idempotent
per client token: the same token and payload replay the stored result, a
different payload is refused with 409. Stock is never created from nothing:
material only leaves JOBWORK_OUT through a settlement.

Design note (return posting): ``ExecutionService.execute_completion`` is the
machine-terminal engine. It needs reserved input rolls at a work centre,
machine context and route-step roll specs, none of which exist for material
held by an outside job worker. Returns therefore post through RollService /
BulkService / FinishedGoodsBatch directly and populate every field the way
the terminal does (batch number, step indexes, geometry override, inner-pack
consumption, JobExecutionLog progress, RollConsumption, RollLink, ScrapLog),
so packing, dispatch, traceability and planner boards read job-work output
exactly like in-house output.
"""
from __future__ import annotations

import hashlib
import json
import logging
import uuid
from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any, Dict, Iterable, List, Optional

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, connection, transaction
from django.db.models import Q, Sum
from django.utils import timezone
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, ValidationError

from apps.factory.models import Plant
from apps.inventory.models import (
    JOBWORK_FINAL_STATUSES,
    JOBWORK_OPEN_STATUSES,
    InventoryLocation,
    InventoryReservation,
    InventoryRoll,
    JobWorkChallan,
    JobWorkOrder,
    JobWorkReturn,
    JobWorkReturnLine,
    JobWorkSentLine,
    JobWorkSettlement,
    RollConsumption,
    RollLink,
    RollMovement,
    Vendor,
)
from apps.inventory.services.bulk_service import BulkService
from apps.inventory.services.roll_service import RollService
from apps.materials.models import InventoryMaterial
from apps.recipes.models import RecipeGrade
from apps.users.permission_registry import can_with_wildcard
from apps.users.permission_service import PermissionService

logger = logging.getLogger(__name__)

ZERO = Decimal("0")
KG3 = Decimal("0.001")
MONEY = Decimal("0.01")
RATE4 = Decimal("0.0001")
ROLL_SEND_STATUSES = {"AVAILABLE", "RESERVED", "IN_PROCESS"}
NON_STOCK_LOCATION_TYPES = {"JOBWORK", "TRANSIT"}
RECEIVABLE_STATUSES = {"SENT", "PARTIAL", "PARTLY_RETURNED", "RETURNED"}
DISPATCHABLE_STATUSES = {"DRAFT", "SENT", "PARTIAL", "PARTLY_RETURNED", "RETURNED"}
DISPOSITIONS = {"PROCESSED", "RETURNED", "PARTLY_USED"}
ITC04_WARNING_DAYS = 300
ITC04_LIMIT_DAYS = 365
OUTPUT_LABELS = {"FG_PCS": "Finished pieces", "ROLLS": "Rolls", "BULK": "Bulk material"}
STATUS_LABELS = {
    "DRAFT": "Draft",
    "SENT": "At job worker",
    "PARTIAL": "Partly returned",
    "PARTLY_RETURNED": "Partly returned",
    "RETURNED": "All returned",
    "CLOSED": "Closed",
    "CANCELLED": "Cancelled",
}


class Conflict(APIException):
    status_code = 409
    default_detail = "This job-work order changed. Refresh it and try again."
    default_code = "conflict"


# ---------------------------------------------------------------- utilities
def dec(value, default: str = "0") -> Decimal:
    if value in (None, ""):
        return Decimal(default)
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        raise ValidationError(f"'{value}' is not a number.")
    if not result.is_finite():
        raise ValidationError(f"'{value}' is not a number.")
    return result


def kg3(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(KG3, rounding=ROUND_HALF_UP)


def money(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(MONEY, rounding=ROUND_HALF_UP)


def messages_of(exc) -> str:
    if isinstance(exc, DjangoValidationError):
        return " ".join(str(m) for m in exc.messages)
    detail = getattr(exc, "detail", None)
    if detail is not None:
        return str(detail)
    return str(exc)


def _advisory_lock(key: str) -> None:
    if connection.vendor == "postgresql":
        lock_id = int.from_bytes(hashlib.sha256(key.encode()).digest()[:8], "big", signed=True)
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(%s)", [lock_id])


def parse_token(raw) -> uuid.UUID:
    try:
        return uuid.UUID(str(raw))
    except (ValueError, TypeError, AttributeError):
        raise ValidationError({"client_token": "Send a UUID client_token so a retry cannot post twice."})


def ids_only(data) -> dict:
    """Replace model instances by their ids (stable fingerprints and JSON)."""
    def clean(value):
        if hasattr(value, "pk"):
            return str(value.pk)
        if isinstance(value, dict):
            return {key: clean(item) for key, item in value.items()}
        if isinstance(value, (list, tuple)):
            return [clean(item) for item in value]
        return value

    return clean(dict(data or {}))


def canonical_payload(data) -> dict:
    """JSON-stable copy of validated data without the token (for fingerprints)."""
    data = ids_only(data)
    data.pop("client_token", None)
    return json.loads(json.dumps(data, sort_keys=True, default=str))


def replay_or_run(*, scope: str, token, payload: dict, operation, lock=None) -> dict:
    """Run ``operation`` once per (scope, token).

    Same token and payload → the stored result with ``replayed: True``.
    Same token, different payload → 409. ``lock`` runs first inside the
    transaction (e.g. lock the order row) so concurrent retries serialize.
    """
    from apps.gate.models import GateRequestReceipt
    from apps.gate.services import fingerprint

    token = parse_token(token)
    digest = fingerprint(payload)
    with transaction.atomic():
        if lock is not None:
            lock()
        else:
            _advisory_lock(f"{scope}:{token}")
        receipt = GateRequestReceipt.objects.filter(scope=scope, token=token).first()
        if receipt:
            if receipt.fingerprint != digest:
                raise Conflict("This retry token belongs to a different submission. Start the action again.")
            return {**receipt.response, "replayed": True}
        try:
            with transaction.atomic():
                response = operation()
                GateRequestReceipt.objects.create(scope=scope[:128], token=token, fingerprint=digest, response=response)
        except IntegrityError:
            raise Conflict("This submission was already recorded. Refresh the order.") from None
        return {**response, "replayed": False}


# -------------------------------------------------------------- permissions
def has_jobwork_permission(user, code: str) -> bool:
    """inventory.view / inventory.manage for job work. Watchman never; Owner/Admin always."""
    if not user or not getattr(user, "is_authenticated", False) or not getattr(user, "is_active", False):
        return False
    if PermissionService.is_watchman(user):
        return False
    if PermissionService.is_gate_master(user):
        return True
    granted = set(PermissionService.get_user_permissions(user))
    if can_with_wildcard(granted, code):
        return True
    return code == "inventory.view" and "inventory.manage" in granted


def require_jobwork_permission(user, code: str) -> None:
    if not has_jobwork_permission(user, code):
        if code == "inventory.view":
            raise PermissionDenied("Job work is open to inventory, planning and administrator accounts.")
        raise PermissionDenied("Only inventory staff (inventory.manage) or an administrator can change job work.")


def require_owner(user) -> None:
    if not PermissionService.is_gate_master(user):
        raise PermissionDenied("Only an owner or administrator can reconcile job work from before the upgrade.")


# ----------------------------------------------------------- audit timeline
def audit(order: JobWorkOrder, action: str, actor, reason: str = "", after: Optional[dict] = None) -> None:
    from apps.gate.models import GateAuditEvent

    GateAuditEvent.objects.create(
        plant_id=order.plant_id,
        object_id=order.id,
        object_type="JOBWORK",
        action=action[:24],
        actor=actor if getattr(actor, "pk", None) else None,
        reason=str(reason or "")[:500],
        before={},
        after=json.loads(json.dumps(after or {}, default=str)),
    )


# ------------------------------------------------------------ plant helpers
def jobwork_location(plant) -> InventoryLocation:
    location = (
        InventoryLocation.objects.filter(plant=plant, code="JOBWORK_OUT")
        .order_by("-is_system", "name", "id")
        .first()
    )
    if not location:
        raise Conflict(
            f"The system location JOBWORK_OUT is missing for {getattr(plant, 'name', 'this plant')}. "
            "Ask an administrator to create it before sending job work."
        )
    return location


def stock_location(location_id, plant, *, field: str) -> InventoryLocation:
    try:
        location = InventoryLocation.objects.select_related("plant").get(id=location_id)
    except (InventoryLocation.DoesNotExist, ValueError, TypeError, DjangoValidationError):
        raise ValidationError({field: "Choose an existing stock location."})
    if location.plant_id != plant.id:
        raise ValidationError({field: f"{location.name} belongs to {location.plant.name}; choose a location in {plant.name}."})
    if not location.is_active:
        raise ValidationError({field: f"{location.name} is inactive."})
    if location.type in NON_STOCK_LOCATION_TYPES or location.type == "SCRAP":
        raise ValidationError({field: f"{location.name} is not a stock location for returned goods."})
    return location


def resolve_job_plant(job):
    for attr in ("work_center", "from_location", "to_location"):
        related = getattr(job, attr, None)
        plant = getattr(related, "plant", None) if related is not None else None
        if plant is not None:
            return plant
    return None


def job_process(job):
    if not job:
        return None
    return getattr(job, "current_process", None) or getattr(job, "process", None)


def order_process(order: JobWorkOrder):
    return order.process or job_process(order.production_job)


def vendor_rate_card(vendor: Optional[Vendor], process_code: str = "") -> List[dict]:
    rows = [row for row in (getattr(vendor, "jobwork_rates", None) or []) if isinstance(row, dict)]
    code = str(process_code or "").upper()
    if code:
        rows = [row for row in rows if str(row.get("process_code") or "").upper() == code]
    return rows


def vendor_rate(vendor, process_code: str, uom: str = "") -> Optional[dict]:
    for row in vendor_rate_card(vendor, process_code):
        if not uom or str(row.get("uom") or "").upper() == str(uom).upper():
            return {"process_code": str(row.get("process_code")).upper(), "rate": str(row.get("rate")), "uom": str(row.get("uom")).upper()}
    return None


def material_rate(material) -> Decimal:
    if material is None:
        return ZERO
    try:
        from apps.costing.models import MaterialCostSnapshot

        snapshot = MaterialCostSnapshot.objects.filter(material=material).order_by("-effective_date").first()
        if snapshot and Decimal(str(snapshot.avg_rate_per_kg or 0)) > 0:
            return Decimal(str(snapshot.avg_rate_per_kg))
    except Exception:  # costing app is optional in isolated settings
        logger.debug("Material cost snapshot unavailable", exc_info=True)
    for attr in ("standard_cost", "avg_cost", "cost_price"):
        value = getattr(material, attr, None)
        try:
            if value not in (None, "") and Decimal(str(value)) > 0:
                return Decimal(str(value))
        except (InvalidOperation, ValueError, TypeError):
            continue
    return ZERO


def roll_rate_per_kg(roll: InventoryRoll) -> Decimal:
    meta = roll.meta_json or {}
    for key in ("unit_cost_per_kg", "unit_cost", "rate_per_kg", "rate_per_uom"):
        value = meta.get(key)
        try:
            if value not in (None, "") and Decimal(str(value)) > 0:
                return Decimal(str(value))
        except (InvalidOperation, ValueError, TypeError):
            continue
    return material_rate(roll.material)


def bulk_rate(material_id, location_id) -> Decimal:
    from apps.inventory.models import InventoryBulk

    row = InventoryBulk.objects.filter(material_id=material_id, location_id=location_id).order_by("-updated_at").first()
    if row and Decimal(str(row.avg_cost or 0)) > 0:
        return Decimal(str(row.avg_cost))
    return material_rate(InventoryMaterial.objects.filter(id=material_id).first())


def legal_snapshot(plant) -> dict:
    from apps.factory.models import PlantLegalProfile

    profile = PlantLegalProfile.objects.filter(plant=plant).first()
    return {
        "name": (profile.legal_name if profile and profile.legal_name else plant.name),
        "gstin": (profile.gstin if profile else "") or "",
        "address": (profile.address if profile else "") or "",
        "phone": (profile.contact_phone if profile else "") or "",
        "email": (profile.contact_email if profile else "") or "",
        "signatory_name": (profile.authorized_signatory_name if profile else "") or "",
        "signatory_designation": (profile.authorized_signatory_designation if profile else "") or "",
        "plant_name": plant.name,
    }


def vendor_snapshot(vendor: Vendor) -> dict:
    address = ", ".join(part.strip() for part in [vendor.address, vendor.mailing_state, vendor.mailing_pincode] if str(part or "").strip())
    return {
        "name": vendor.mailing_name or vendor.name,
        "code": vendor.code,
        "gstin": vendor.gst_no or "",
        "address": address,
        "state": vendor.mailing_state or "",
        "phone": vendor.phone_number or "",
    }


# ----------------------------------------------------------- balances
def line_balances(order: JobWorkOrder, *, lines: Optional[Iterable[JobWorkSentLine]] = None) -> Dict[str, dict]:
    """Open quantity per sent line = sent − Σ settlements (consumed + returned)."""
    lines = list(lines) if lines is not None else list(order.sent_lines.select_related("challan", "roll", "material"))
    totals = {
        row["sent_line_id"]: row
        for row in JobWorkSettlement.objects.filter(order=order).values("sent_line_id").annotate(
            consumed_qty=Sum("consumed_qty"), returned_qty=Sum("returned_qty"),
            consumed_kg=Sum("consumed_kg"), returned_kg=Sum("returned_kg"),
        )
    }
    result = {}
    for line in lines:
        row = totals.get(line.id, {})
        settled_qty = Decimal(str(row.get("consumed_qty") or 0)) + Decimal(str(row.get("returned_qty") or 0))
        settled_kg = Decimal(str(row.get("consumed_kg") or 0)) + Decimal(str(row.get("returned_kg") or 0))
        open_qty = max(Decimal(str(line.quantity)) - settled_qty, ZERO)
        result[str(line.id)] = {
            "line": line,
            "settled_qty": settled_qty,
            "settled_kg": settled_kg,
            "open_qty": open_qty,
            "open_kg": max(Decimal(str(line.qty_kg)) - settled_kg, ZERO) if open_qty > 0 else ZERO,
            "is_open": open_qty > 0,
            "consumed_kg": Decimal(str(row.get("consumed_kg") or 0)),
            "returned_kg": Decimal(str(row.get("returned_kg") or 0)),
        }
    return result


def order_totals(order: JobWorkOrder, balances: Optional[Dict[str, dict]] = None) -> dict:
    balances = balances if balances is not None else line_balances(order)
    sent_kg = sum((Decimal(str(row["line"].qty_kg)) for row in balances.values()), ZERO)
    at_vendor_kg = sum((row["open_kg"] for row in balances.values()), ZERO)
    agg = order.returns.aggregate(
        settled=Sum("settled_sent_kg"), output=Sum("output_kg"), pcs=Sum("output_pcs"),
        balance=Sum("balance_kg"), wastage=Sum("wastage_kg"),
    )
    settled = Decimal(str(agg["settled"] or 0))
    output = Decimal(str(agg["output"] or 0))
    balance = Decimal(str(agg["balance"] or 0))
    wastage = Decimal(str(agg["wastage"] or 0))
    variance = settled - (output + balance + wastage)
    pct = (variance / settled * 100).quantize(KG3) if settled > 0 else None
    written_off = JobWorkSettlement.objects.filter(order=order, written_off=True).aggregate(kg=Sum("consumed_kg"))["kg"] or ZERO
    return {
        "sent_kg": kg3(sent_kg),
        "at_vendor_kg": kg3(at_vendor_kg),
        "open_lines": sum(1 for row in balances.values() if row["is_open"]),
        "settled_kg": kg3(settled),
        "output_kg": kg3(output),
        "output_pcs": int(agg["pcs"] or 0),
        "balance_kg": kg3(balance),
        "wastage_kg": kg3(wastage),
        "variance_kg": kg3(variance),
        "variance_pct": pct,
        "written_off_kg": kg3(written_off),
        "tolerance_pct": Decimal(str(order.wastage_tolerance_pct or 0)),
        "variance_reason_recorded": order.returns.exclude(variance_reason="").exists() or bool((order.meta_json or {}).get("close_variance_reason")),
    }


def is_legacy_capable(order: JobWorkOrder) -> bool:
    """Orders from before the upgrade (backfilled JWO-L-… or written by an older image)."""
    return not order.number or order.number.startswith("JWO-L-")


def legacy_attribution(*, plant_ids=None) -> Dict[Any, List[InventoryRoll]]:
    """Map rolls the old flow left SENT_JOBWORK in JOBWORK_OUT (and that are on
    no sent line) to the legacy order that most likely sent them: same plant,
    same vendor (old movement note ``JW-OUT: <vendor>``), same production job
    when the order has one, order created before the move. Rolls that match no
    order are listed under ``None``."""
    rolls_qs = InventoryRoll.objects.select_related("material", "location", "location__plant", "production_job").filter(
        status="SENT_JOBWORK", location__code="JOBWORK_OUT",
    ).exclude(job_work_sent_lines__isnull=False)
    if plant_ids is not None:
        rolls_qs = rolls_qs.filter(location__plant_id__in=list(plant_ids))
    rolls = list(rolls_qs.order_by("created_at", "id"))
    if not rolls:
        return {}
    orders = [
        order for order in JobWorkOrder.objects.filter(plant_id__in={roll.location.plant_id for roll in rolls}).exclude(status="CANCELLED").order_by("-created_at", "-id")
        if is_legacy_capable(order)
    ]
    moves = {}
    for move in RollMovement.objects.filter(roll__in=rolls, to_location__code="JOBWORK_OUT").order_by("timestamp", "id"):
        moves[move.roll_id] = move
    grouped: Dict[Any, List[InventoryRoll]] = {}
    for roll in rolls:
        move = moves.get(roll.id)
        note = str(getattr(move, "reason_note", "") or "")
        moved_at = getattr(move, "timestamp", None) or roll.created_at
        vendor_name = note.split("JW-OUT:", 1)[1].strip() if "JW-OUT:" in note else ""
        match = None
        for order in orders:
            if order.plant_id != roll.location.plant_id or order.created_at > moved_at + timedelta(minutes=5):
                continue
            if vendor_name and vendor_name != (order.vendor_name or "").strip():
                continue
            if order.production_job_id:
                cross = set((order.meta_json or {}).get("cross_job_dispatch_rolls") or [])
                if order.production_job_id not in {roll.production_job_id, roll.created_by_job_id} and roll.label_id not in cross:
                    continue
            match = order
            break
        roll._legacy_sent_at = moved_at
        grouped.setdefault(str(match.id) if match else None, []).append(roll)
    return grouped


def legacy_stuck_rolls(order: JobWorkOrder) -> List[InventoryRoll]:
    if not is_legacy_capable(order) or order.status in JOBWORK_FINAL_STATUSES:
        return []
    return legacy_attribution(plant_ids=[order.plant_id]).get(str(order.id), [])


def legacy_output_candidates(order: Optional[JobWorkOrder]):
    """Rolls the old receive screen created for this order (batch ``JW-<id>``,
    or a ``JW-IN: <vendor>`` movement after dispatch)."""
    if order is None:
        return InventoryRoll.objects.none()
    since = order.dispatched_at or order.created_at
    moved = RollMovement.objects.filter(reason_note=f"JW-IN: {order.vendor_name}", timestamp__gte=since, to_location__plant_id=order.plant_id).values_list("roll_id", flat=True)
    return InventoryRoll.objects.filter(Q(batch_no=f"JW-{order.id}") | Q(id__in=moved), plant_id=order.plant_id).exclude(status="SENT_JOBWORK").order_by("created_at")


def refresh_status(order: JobWorkOrder, balances: Optional[Dict[str, dict]] = None) -> str:
    if order.status in JOBWORK_FINAL_STATUSES:
        return order.status
    balances = balances if balances is not None else line_balances(order)
    if not balances:
        if not order.dispatched_at:
            status = "DRAFT"
        else:  # legacy order: no sent lines were recorded by the old flow
            status = "PARTLY_RETURNED" if order.status == "PARTIAL" else order.status
    elif any(row["is_open"] for row in balances.values()):
        settled_any = order.returns.exists() or JobWorkSettlement.objects.filter(order=order).exists()
        status = "PARTLY_RETURNED" if settled_any else "SENT"
    else:
        status = "RETURNED"
    order.status = status
    return status


def lock_order(order_id) -> JobWorkOrder:
    try:
        return JobWorkOrder.objects.select_for_update(of=("self",)).select_related(
            "plant", "vendor", "process", "production_job", "production_job__current_process",
            "production_job__process", "production_job__template", "production_job__sales_order_item",
            "production_job__sales_order_item__sales_order", "production_job__mts_order",
            "production_job__work_center", "production_job__production_batch",
        ).get(id=order_id)
    except (JobWorkOrder.DoesNotExist, ValueError, DjangoValidationError):
        raise NotFound("This job-work order does not exist.")


def _with_locked_order(order_id, scope: str, data: dict, body):
    holder = {}

    def lock():
        holder["order"] = lock_order(order_id)

    return replay_or_run(
        scope=f"jobwork:{order_id}:{scope}", token=data.get("client_token"), payload=canonical_payload(data),
        operation=lambda: body(holder["order"]), lock=lock,
    )


class JobWorkService:
    # ------------------------------------------------------- vendor matching
    @classmethod
    def _job_process_context(cls, production_job):
        process = job_process(production_job)
        return str(getattr(process, "code", "") or "").upper(), resolve_job_plant(production_job)

    @classmethod
    def vendor_matches_jobwork(cls, vendor: Vendor, *, process_code: str = "", plant=None) -> Dict[str, Any]:
        capabilities = [str(code or "").upper() for code in (vendor.jobwork_capabilities or []) if str(code or "").strip()]
        plants = [str(code or "").upper() for code in (vendor.jobwork_plants or []) if str(code or "").strip()]

        process_ok = True
        if capabilities and process_code:
            process_ok = process_code in capabilities

        plant_token_id = str(getattr(plant, "id", "") or "").upper()
        plant_token_code = str(getattr(plant, "code", "") or "").upper()
        plant_ok = True
        if plants:
            plant_ok = plant_token_id in plants or plant_token_code in plants

        vendor_active = str(vendor.status or "").upper() == "ACTIVE"
        vendor_type_ok = str(vendor.type or "").upper() in {"JOBWORK", "BOTH"}

        match = bool(vendor_active and vendor_type_ok and process_ok and plant_ok)
        reasons = []
        if not vendor_active:
            reasons.append("Vendor is not ACTIVE.")
        if not vendor_type_ok:
            reasons.append("Vendor type must be JOBWORK or BOTH.")
        if not process_ok:
            reasons.append(f"Vendor does not support process {process_code}.")
        if not plant_ok:
            reasons.append("Vendor is not mapped to this plant.")
        return {"match": match, "reasons": reasons, "process_ok": process_ok, "plant_ok": plant_ok}

    @classmethod
    def compatible_vendors(cls, *, process_code: str = "", plant=None):
        vendors = Vendor.objects.filter(status="ACTIVE", type__in=["JOBWORK", "BOTH"]).order_by("name")
        return [(vendor, cls.vendor_matches_jobwork(vendor, process_code=process_code, plant=plant)) for vendor in vendors]

    # ------------------------------------------------------------- create
    @classmethod
    @transaction.atomic
    def create_order(
        cls,
        plant: Optional[Plant],
        vendor: Vendor,
        sent_material_type: str = "WIP",
        expected_return: str = "WIP",
        production_job=None,
        notes: str = "",
        mode: Optional[str] = None,
        route_step_index=None,
        emergency_reason: str = "",
        *,
        process=None,
        expected_output_kind: str = "",
        expected_qty=None,
        expected_uom: str = "",
        rate=None,
        rate_uom: str = "",
        wastage_tolerance_pct=None,
        expected_return_date=None,
        user=None,
    ) -> JobWorkOrder:
        """Create a DRAFT order with a JWO number (one open order per job).

        Raises Django ValidationError; API callers translate it."""
        from apps.gate.numbering import next_document_number

        process_code = ""
        resolved_plant = plant
        if production_job is not None:
            from apps.production.models import ProductionJob

            production_job = ProductionJob.objects.select_for_update(of=("self",)).select_related(
                "current_process", "process", "work_center__plant", "from_location__plant", "to_location__plant",
            ).get(id=production_job.id)
            process_code, plant_from_job = cls._job_process_context(production_job)
            if plant_from_job is not None:
                if plant is not None and str(getattr(plant, "id", "")) != str(plant_from_job.id):
                    raise DjangoValidationError(
                        f"Job {production_job.job_number} runs at {plant_from_job.name}, not {plant.name}. Choose the job's plant."
                    )
                resolved_plant = plant_from_job
            existing = JobWorkOrder.objects.filter(production_job=production_job, status__in=JOBWORK_OPEN_STATUSES).first()
            if existing:
                raise DjangoValidationError(
                    f"Job {production_job.job_number} already has open job-work order {existing.number or existing.id}. "
                    "Use that order or close it first."
                )
            if process is None:
                process = job_process(production_job)
        if resolved_plant is None:
            raise DjangoValidationError("Choose the plant that sends this job work.")
        if process is not None and not process_code:
            process_code = str(process.code or "").upper()

        if vendor:
            verdict = cls.vendor_matches_jobwork(vendor, process_code=process_code, plant=resolved_plant)
            if not verdict["match"]:
                raise DjangoValidationError(" ".join(verdict["reasons"]) or "Vendor is not compatible for this jobwork context.")

        default_mode = "PLANNED_STEP" if production_job else "EMERGENCY"
        safe_mode = str(mode or default_mode).upper()
        if safe_mode not in {"PLANNED_STEP", "EMERGENCY"}:
            raise DjangoValidationError("mode must be PLANNED_STEP or EMERGENCY.")
        if safe_mode == "EMERGENCY" and not str(emergency_reason or "").strip():
            raise DjangoValidationError("emergency_reason is required for EMERGENCY jobwork.")
        if safe_mode == "PLANNED_STEP" and production_job is None:
            raise DjangoValidationError("A planned route-step order needs its production job.")

        if route_step_index is None and production_job is not None:
            route_step_index = int(getattr(production_job, "current_step_index", 0) or 0)

        kind = str(expected_output_kind or "ROLLS").upper()
        if kind not in OUTPUT_LABELS:
            raise DjangoValidationError("Expected output must be FG_PCS, ROLLS or BULK.")
        if kind == "FG_PCS" and production_job is None:
            raise DjangoValidationError("Finished pieces can only be received against a production job. Link the job.")

        if rate not in (None, "") and not rate_uom:
            rate_uom = "PCS" if kind == "FG_PCS" else "KG"
        if rate in (None, "") and vendor is not None and process_code:
            card = vendor_rate(vendor, process_code, rate_uom or ("PCS" if kind == "FG_PCS" else ""))
            if card:
                rate, rate_uom = card["rate"], card["uom"]
        qty_uom = str(expected_uom or "").upper()
        if expected_qty not in (None, "") and not qty_uom:
            qty_uom = "PCS" if kind == "FG_PCS" else "KG"

        order = JobWorkOrder.objects.create(
            number=next_document_number("JWO", prefix="JWO"),
            plant=resolved_plant,
            vendor=vendor,
            vendor_name=vendor.name if vendor else "",
            production_job=production_job,
            process=process,
            sent_material_type=sent_material_type or "WIP",
            expected_return_type=expected_return or "WIP",
            expected_output_kind=kind,
            expected_qty=Decimal(str(expected_qty)) if expected_qty not in (None, "") else None,
            expected_uom=qty_uom,
            rate=Decimal(str(rate)) if rate not in (None, "") else None,
            rate_uom=str(rate_uom or "").upper(),
            wastage_tolerance_pct=Decimal(str(wastage_tolerance_pct)) if wastage_tolerance_pct not in (None, "") else Decimal("3.00"),
            expected_return_date=expected_return_date,
            mode=safe_mode,
            route_step_index=route_step_index,
            emergency_reason=str(emergency_reason or "").strip(),
            notes=notes or "",
            status="DRAFT",
            created_by=user if getattr(user, "pk", None) else None,
        )
        audit(order, "JW_CREATED", user, notes or "", {"number": order.number, "mode": safe_mode, "vendor": order.vendor_name})
        return order

    @classmethod
    def create_from_api(cls, *, user, data: dict) -> dict:
        """Validated API create (inventory.manage). Idempotent per client_token."""
        require_jobwork_permission(user, "inventory.manage")

        def operation():
            job = data.get("production_job")
            if job is not None and job.job_state not in {"RELEASED", "EXECUTING", "PAUSED"}:
                raise ValidationError({"production_job": f"Job {job.job_number} is {job.job_state.lower()}; only released, running or paused jobs can go to job work."})
            try:
                order = cls.create_order(
                    plant=data.get("plant"),
                    vendor=data["vendor"],
                    production_job=job,
                    process=data.get("process"),
                    mode=data.get("mode"),
                    emergency_reason=data.get("emergency_reason") or "",
                    notes=data.get("notes") or "",
                    sent_material_type=data.get("sent_material_type") or "WIP",
                    expected_return=data.get("expected_return_type") or "WIP",
                    expected_output_kind=data.get("expected_output_kind") or "",
                    expected_qty=data.get("expected_qty"),
                    expected_uom=data.get("expected_uom") or "",
                    rate=data.get("rate"),
                    rate_uom=data.get("rate_uom") or "",
                    wastage_tolerance_pct=data.get("wastage_tolerance_pct"),
                    expected_return_date=data.get("expected_return_date"),
                    user=user,
                )
            except DjangoValidationError as exc:
                raise ValidationError(messages_of(exc)) from None
            if data.get("save_rate_to_vendor") and order.rate and order.rate_uom:
                process = order_process(order)
                if process is None:
                    raise ValidationError({"save_rate_to_vendor": "Choose the process before saving a rate-card entry."})
                cls._upsert_vendor_rate(order.vendor, process.code, order.rate, order.rate_uom)
            if order.production_job_id:
                cls._hold_job_for_order(order)
            return {"order_id": str(order.id), "number": order.number}

        return replay_or_run(scope=f"jobwork:create:{user.id}", token=data.get("client_token"), payload=canonical_payload(data), operation=operation)

    @classmethod
    def _hold_job_for_order(cls, order: JobWorkOrder) -> None:
        """Pause the linked job while its material is with the job worker."""
        from apps.production.models import ProductionJob
        from apps.production.services.job_services import JobService

        job = ProductionJob.objects.select_for_update(of=("self",)).get(id=order.production_job_id)
        reason = f"Job work {order.number} with {order.vendor_name}"[:255]
        if job.job_state in {"RELEASED", "EXECUTING"}:
            job = JobService.pause_job(job.id, reason=reason)
        job.is_on_hold = True
        job.hold_reason = reason
        job.save(update_fields=["is_on_hold", "hold_reason", "updated_at"])

    @classmethod
    def _upsert_vendor_rate(cls, vendor: Vendor, process_code: str, rate, uom: str) -> List[dict]:
        from apps.inventory.models import validate_jobwork_rates

        vendor = Vendor.objects.select_for_update().get(id=vendor.id)
        code = str(process_code or "").strip().upper()
        unit = str(uom or "").strip().upper()
        rows = [dict(row) for row in (vendor.jobwork_rates or []) if isinstance(row, dict)]
        rows = [row for row in rows if not (str(row.get("process_code") or "").upper() == code and str(row.get("uom") or "").upper() == unit)]
        rows.append({"process_code": code, "rate": format(Decimal(str(rate)).normalize(), "f"), "uom": unit})
        rows.sort(key=lambda row: (row["process_code"], row["uom"]))
        try:
            validate_jobwork_rates(rows)
        except DjangoValidationError as exc:
            raise ValidationError({"rate": messages_of(exc)})
        vendor.jobwork_rates = rows
        vendor.save(update_fields=["jobwork_rates", "updated_at"])
        return rows

    @classmethod
    def save_vendor_rate(cls, *, user, data: dict) -> dict:
        require_jobwork_permission(user, "inventory.manage")
        vendor = data["vendor"]
        if str(vendor.type or "").upper() not in {"JOBWORK", "BOTH"}:
            raise ValidationError({"vendor": "Rate cards are kept for job-work vendors only."})

        def operation():
            rows = cls._upsert_vendor_rate(vendor, data["process_code"], data["rate"], data["uom"])
            return {"vendor_id": str(vendor.id), "jobwork_rates": rows}

        return replay_or_run(scope=f"jobwork:rate:{vendor.id}", token=data.get("client_token"), payload=canonical_payload(data), operation=operation)

    # ------------------------------------------------------------ dispatch
    @classmethod
    def dispatch(cls, *, order_id, user, data: dict) -> dict:
        require_jobwork_permission(user, "inventory.manage")
        return _with_locked_order(order_id, "dispatch", data, lambda order: cls._dispatch_locked(order, user, data))

    @classmethod
    def _dispatch_locked(cls, order: JobWorkOrder, user, data: dict) -> dict:
        from apps.gate.numbering import next_document_number
        from apps.inventory.services.fsm import ROLL_TRANSITIONS, validate_transition

        if order.status not in DISPATCHABLE_STATUSES:
            raise Conflict(f"Order {order.number} is {STATUS_LABELS.get(order.status, order.status).lower()}; nothing more can be sent on it.")
        vendor = order.vendor
        if vendor is None:
            raise ValidationError({"vendor": "Choose the job worker on this order before sending material."})
        if str(vendor.status or "").upper() != "ACTIVE":
            raise ValidationError({"vendor": f"{vendor.name} is not an active vendor."})
        if legacy_stuck_rolls(order):
            raise Conflict("This order still has rolls from before the upgrade at the job worker. Ask an owner to reconcile them first.")
        jw_loc = jobwork_location(order.plant)

        roll_rows = [dict(row) for row in data.get("rolls") or []]
        roll_rows += [{"roll_id": roll_id} for roll_id in data.get("roll_ids") or []]
        bulk_rows = [dict(row) for row in data.get("bulk_items") or []]
        if not roll_rows and not bulk_rows:
            raise ValidationError({"rolls": "Pick at least one roll or bulk quantity to send."})
        default_hsn = str(data.get("hsn_code") or "").strip()

        roll_ids = [str(row["roll_id"]) for row in roll_rows]
        if len(roll_ids) != len(set(roll_ids)):
            raise ValidationError({"rolls": "Each roll can be sent once per challan."})
        rolls = {
            str(roll.id): roll
            for roll in InventoryRoll.objects.select_for_update(of=("self",)).select_related("material", "location", "location__plant", "production_job").filter(id__in=roll_ids)
        }
        missing = [rid for rid in roll_ids if rid not in rolls]
        if missing:
            raise ValidationError({"rolls": f"{len(missing)} selected roll(s) no longer exist. Refresh the roll list."})

        prepared_rolls, errors = [], []
        for row in roll_rows:
            roll = rolls[str(row["roll_id"])]
            if roll.location.plant_id != order.plant_id or (roll.plant_id and roll.plant_id != order.plant_id):
                errors.append(f"{roll.label_id} is at {roll.location.plant.name}, not {order.plant.name}.")
                continue
            if roll.status == "SENT_JOBWORK":
                errors.append(f"{roll.label_id} is already at a job worker.")
                continue
            if roll.status not in ROLL_SEND_STATUSES:
                errors.append(f"{roll.label_id} is {roll.get_status_display().lower()} and cannot be sent.")
                continue
            if roll.location.type in NON_STOCK_LOCATION_TYPES:
                errors.append(f"{roll.label_id} is in {roll.location.name}; it is not in stock at the factory.")
                continue
            weight = Decimal(str(roll.weight_kg or 0))
            if weight <= 0:
                errors.append(f"{roll.label_id} has no weight left.")
                continue
            other = InventoryReservation.objects.filter(roll=roll, status="ACTIVE").exclude(job_id=order.production_job_id).select_related("job").first()
            if other:
                errors.append(f"{roll.label_id} is reserved for job {other.job.job_number}. Release it there first.")
                continue
            value = money(dec(row.get("value"))) if row.get("value") not in (None, "") else money(roll_rate_per_kg(roll) * weight)
            if value <= 0:
                errors.append(f"Enter the value of {roll.label_id} (no cost rate is on record).")
                continue
            hsn = str(row.get("hsn_code") or default_hsn).strip()
            if not hsn:
                errors.append(f"Enter the HSN code for {roll.label_id}.")
                continue
            cross_job = bool(order.production_job_id) and order.production_job_id not in {roll.production_job_id, roll.created_by_job_id}
            prepared_rolls.append({"roll": roll, "from": roll.location, "weight": weight, "value": value, "hsn": hsn, "cross_job": cross_job})
        if errors:
            raise ValidationError({"rolls": errors})

        prepared_bulk = []
        for index, row in enumerate(bulk_rows, start=1):
            try:
                material = InventoryMaterial.objects.get(id=row.get("material_id"))
            except (InventoryMaterial.DoesNotExist, ValueError, TypeError, DjangoValidationError):
                raise ValidationError({"bulk_items": f"Bulk line {index}: choose an existing material."})
            location = stock_location(row.get("location_id"), order.plant, field="bulk_items")
            qty = kg3(dec(row.get("quantity")))
            if qty <= 0:
                raise ValidationError({"bulk_items": f"Bulk line {index}: quantity must be more than zero."})
            try:
                uom = BulkService._material_stock_uom(material)
            except DjangoValidationError as exc:
                raise ValidationError({"bulk_items": messages_of(exc)})
            value = money(dec(row.get("value"))) if row.get("value") not in (None, "") else money(bulk_rate(material.id, location.id) * qty)
            if value <= 0:
                raise ValidationError({"bulk_items": f"Enter the value of {material.name or material.code} (no cost rate is on record)."})
            hsn = str(row.get("hsn_code") or default_hsn).strip()
            if not hsn:
                raise ValidationError({"bulk_items": f"Enter the HSN code for {material.name or material.code}."})
            prepared_bulk.append({"material": material, "location": location, "qty": qty, "uom": uom, "value": value, "hsn": hsn, "granule_code_id": row.get("granule_code_id") or None})

        process = order_process(order)
        purpose = str(data.get("purpose") or "").strip() or f"Job work – {getattr(process, 'name', None) or 'processing'}"
        expected_return_date = data.get("expected_return_date") or order.expected_return_date
        total_kg = sum((row["weight"] for row in prepared_rolls), ZERO) + sum((row["qty"] for row in prepared_bulk if row["uom"] == "KG"), ZERO)
        total_value = sum((row["value"] for row in prepared_rolls + prepared_bulk), ZERO)
        now = timezone.now()
        challan = JobWorkChallan.objects.create(
            number=next_document_number("JWC", prefix="JWC"),
            order=order,
            plant=order.plant,
            vendor=vendor,
            issued_at=now,
            issued_by=user,
            purpose=purpose[:160],
            expected_return_date=expected_return_date,
            place_of_supply=(vendor.mailing_state or "")[:80],
            vehicle_no=str(data.get("vehicle_no") or "").strip()[:32],
            notes=str(data.get("notes") or "").strip(),
            consignor=legal_snapshot(order.plant),
            consignee=vendor_snapshot(vendor),
            total_qty_kg=kg3(total_kg),
            total_value=money(total_value),
            request_key=str(parse_token(data.get("client_token"))),
        )
        line_no = order.sent_lines.count()
        for row in prepared_rolls:
            roll = row["roll"]
            line_no += 1
            RollService.move_roll(
                roll=roll, to_location=jw_loc, reason="JOBWORK_OUT",
                reason_note=f"{challan.number} → {vendor.name}"[:255], job=order.production_job, user=user,
            )
            validate_transition(roll.status, "SENT_JOBWORK", ROLL_TRANSITIONS, label=f"Roll {roll.label_id}")
            roll.status = "SENT_JOBWORK"
            meta = dict(roll.meta_json or {})
            meta["jobwork"] = {"order_id": str(order.id), "order_number": order.number, "challan_number": challan.number, "vendor": vendor.name}
            roll.meta_json = meta
            roll.save(update_fields=["status", "meta_json"])
            if order.production_job_id:
                InventoryReservation.objects.filter(roll=roll, status="ACTIVE", job_id=order.production_job_id).update(status="FULFILLED", updated_at=now)
            material = roll.material
            JobWorkSentLine.objects.create(
                order=order, challan=challan, line_no=line_no, kind="ROLL", roll=roll, roll_label=roll.label_id,
                material=material, material_name=(material.name or material.code) if material else "",
                from_location=row["from"], description=roll_description(roll)[:255], hsn_code=row["hsn"][:12],
                quantity=kg3(row["weight"]), uom="KG", qty_kg=kg3(row["weight"]), width_mm=roll.width_mm,
                thickness_micron=roll.thickness_micron, rate_per_unit=(row["value"] / row["weight"]).quantize(RATE4),
                value=row["value"], sent_at=now,
                meta_json={"cross_job": row["cross_job"], "production_job_number": getattr(roll.production_job, "job_number", None)},
            )
        for row in prepared_bulk:
            line_no += 1
            material = row["material"]
            try:
                BulkService.transfer_bulk(
                    material_id=str(material.id), qty=row["qty"], from_location_id=str(row["location"].id),
                    to_location_id=str(jw_loc.id), reference=f"{challan.number} → {vendor.name}"[:200],
                    granule_code_id=row["granule_code_id"], qty_uom=row["uom"],
                )
            except DjangoValidationError as exc:
                raise ValidationError({"bulk_items": f"{material.name or material.code}: {messages_of(exc)}"})
            JobWorkSentLine.objects.create(
                order=order, challan=challan, line_no=line_no, kind="BULK", material=material,
                material_name=material.name or material.code, granule_code_id=row["granule_code_id"],
                from_location=row["location"], description=f"{material.name or material.code}"[:255],
                hsn_code=row["hsn"][:12], quantity=row["qty"], uom=row["uom"],
                qty_kg=row["qty"] if row["uom"] == "KG" else ZERO,
                rate_per_unit=(row["value"] / row["qty"]).quantize(RATE4), value=row["value"], sent_at=now,
            )
        if order.dispatched_at is None:
            order.dispatched_at = now
        if order.expected_return_date is None and expected_return_date:
            order.expected_return_date = expected_return_date
        cross = [row["roll"].label_id for row in prepared_rolls if row["cross_job"]]
        if cross:
            meta = dict(order.meta_json or {})
            meta["cross_job_dispatch_rolls"] = sorted(set(list(meta.get("cross_job_dispatch_rolls") or []) + cross))
            order.meta_json = meta
        refresh_status(order)
        order.save(update_fields=["status", "dispatched_at", "expected_return_date", "meta_json", "updated_at"])
        audit(order, "JW_DISPATCHED", user, "", {"challan": challan.number, "kg": total_kg, "rolls": len(prepared_rolls), "bulk_lines": len(prepared_bulk)})
        return {"order_id": str(order.id), "challan_id": str(challan.id), "challan_number": challan.number, "status": order.status}

    # -------------------------------------------------------------- return
    @classmethod
    def receive_return(cls, *, order_id, user, data: dict) -> dict:
        require_jobwork_permission(user, "inventory.manage")
        if data.get("bill") and not PermissionService.has_inventory_bill_review(user):
            raise PermissionDenied("Linking a bill needs bill-receiving rights (Inventory store or an administrator).")
        return _with_locked_order(order_id, "return", data, lambda order: cls._return_locked(order, user, data))

    @classmethod
    def _return_locked(cls, order: JobWorkOrder, user, data: dict) -> dict:
        from apps.gate.numbering import next_document_number

        if order.status not in RECEIVABLE_STATUSES:
            if order.status == "DRAFT":
                raise Conflict(f"Nothing has been sent on {order.number} yet. Dispatch material before receiving it back.")
            raise Conflict(f"Order {order.number} is {STATUS_LABELS.get(order.status, order.status).lower()}; it cannot receive returns.")
        if legacy_stuck_rolls(order):
            raise Conflict("This order still has rolls from before the upgrade at the job worker. Ask an owner to reconcile them first.")
        job = order.production_job
        process = order_process(order)
        balances = line_balances(order)
        now = timezone.now()
        received_at = data.get("received_at") or now
        if received_at > now + timedelta(minutes=5):
            raise ValidationError({"received_at": "The return time cannot be in the future."})
        if order.dispatched_at and received_at < order.dispatched_at - timedelta(minutes=5):
            raise ValidationError({"received_at": "The return cannot be earlier than the dispatch."})
        tolerance = Decimal(str(order.wastage_tolerance_pct or 0))
        warnings: List[dict] = []

        # ---- sent-line settlements -------------------------------------
        settle_rows = []
        seen = set()
        for index, row in enumerate(data.get("sent_lines") or [], start=1):
            key = str(row["sent_line_id"])
            if key in seen:
                raise ValidationError({"sent_lines": f"Row {index}: each sent line can appear once."})
            seen.add(key)
            balance = balances.get(key)
            if balance is None:
                raise ValidationError({"sent_lines": f"Row {index}: this sent line is not on order {order.number}."})
            line = balance["line"]
            if not balance["is_open"]:
                raise Conflict(f"{line_label(line)} was already settled. Refresh the order.")
            disposition = str(row.get("disposition") or "").upper()
            if disposition not in DISPOSITIONS:
                raise ValidationError({"sent_lines": f"{line_label(line)}: choose used up, came back unused or partly used."})
            open_qty = balance["open_qty"]
            if line.kind == "ROLL":
                if disposition == "PROCESSED":
                    consumed_qty, returned_qty = open_qty, ZERO
                elif disposition == "RETURNED":
                    consumed_qty, returned_qty = ZERO, open_qty
                else:
                    returned_qty = kg3(dec(row.get("returned_qty")))
                    if returned_qty <= 0 or returned_qty >= open_qty:
                        raise ValidationError({"sent_lines": f"{line_label(line)}: the balance roll must weigh more than 0 and less than {open_qty} kg."})
                    consumed_qty = open_qty - returned_qty
            else:
                consumed_qty = kg3(dec(row["consumed_qty"])) if row.get("consumed_qty") not in (None, "") else None
                returned_qty = kg3(dec(row["returned_qty"])) if row.get("returned_qty") not in (None, "") else None
                if disposition == "PROCESSED":
                    consumed_qty, returned_qty = (consumed_qty if consumed_qty is not None else open_qty), ZERO
                elif disposition == "RETURNED":
                    consumed_qty, returned_qty = ZERO, (returned_qty if returned_qty is not None else open_qty)
                elif consumed_qty is None or returned_qty is None:
                    raise ValidationError({"sent_lines": f"{line_label(line)}: enter the used and the returned quantity."})
                if consumed_qty < 0 or returned_qty < 0 or consumed_qty + returned_qty <= 0:
                    raise ValidationError({"sent_lines": f"{line_label(line)}: quantities must be positive."})
                if consumed_qty + returned_qty > open_qty:
                    raise ValidationError({"sent_lines": f"{line_label(line)}: only {open_qty} {line.uom} is at the job worker."})
            location = stock_location(row.get("location_id"), order.plant, field="sent_lines") if returned_qty > 0 else None
            quantity = Decimal(str(line.quantity))
            per_kg = (Decimal(str(line.qty_kg)) / quantity) if quantity > 0 else ZERO
            settle_rows.append({
                "line": line, "disposition": disposition, "consumed_qty": consumed_qty, "returned_qty": returned_qty,
                "consumed_kg": kg3(consumed_qty * per_kg), "returned_kg": kg3(returned_qty * per_kg), "location": location,
                "closes_line": consumed_qty + returned_qty >= open_qty,
            })

        # ---- outputs -----------------------------------------------------
        fg_plan = None
        fg = data.get("fg") or None
        if fg:
            if job is None:
                raise ValidationError({"fg": "Finished pieces need a production job on the order (FG batches belong to a job)."})
            if job.template_id is None:
                raise ValidationError({"fg": f"Job {job.job_number} has no product template; finished pieces cannot be booked."})
            pcs = int(fg.get("qty_pcs") or 0)
            if pcs <= 0:
                raise ValidationError({"fg": "Enter the number of pieces received."})
            location = stock_location(fg.get("location_id"), order.plant, field="fg")
            if fg.get("qty_kg") not in (None, ""):
                fg_kg = kg3(dec(fg.get("qty_kg")))
                if fg_kg <= 0:
                    raise ValidationError({"fg": "The weight of the pieces must be more than zero."})
            else:
                unit_weight = unit_weight_g(job)
                if unit_weight <= 0:
                    raise ValidationError({"fg": f"Job {job.job_number} has no unit weight. Enter the weight of the pieces in kg."})
                fg_kg = kg3(Decimal(pcs) * unit_weight / Decimal("1000"))
            source = str(fg.get("inner_pack_source") or "FACTORY").upper()
            if source not in {"FACTORY", "VENDOR"}:
                raise ValidationError({"fg": "Inner packs come from the factory store or the job worker."})
            boxes = fg.get("boxes")
            fg_plan = {"pcs": pcs, "kg": fg_kg, "location": location, "boxes": int(boxes) if boxes not in (None, "") else None, "inner_pack_source": source}

        roll_plans = []
        for index, row in enumerate(data.get("output_rolls") or [], start=1):
            try:
                material = InventoryMaterial.objects.get(id=row.get("material_id"))
            except (InventoryMaterial.DoesNotExist, ValueError, TypeError, DjangoValidationError):
                raise ValidationError({"output_rolls": f"Roll {index}: choose an existing film material."})
            if material.category not in {"FILM_VARIANT", "POD"}:
                raise ValidationError({"output_rolls": f"Roll {index}: {material.name or material.code} is not a roll material."})
            weight = kg3(dec(row.get("weight_kg")))
            width = dec(row.get("width_mm"))
            micron = dec(row.get("thickness_micron"))
            if weight <= 0 or width <= 0 or micron <= 0:
                raise ValidationError({"output_rolls": f"Roll {index}: weight, width and micron must all be more than zero."})
            grade = None
            if row.get("grade_id"):
                grade = RecipeGrade.objects.filter(id=row["grade_id"]).first()
                if grade is None:
                    raise ValidationError({"output_rolls": f"Roll {index}: the selected grade does not exist."})
            if getattr(material, "is_extrudable", False) and grade is None:
                raise ValidationError({"output_rolls": f"Roll {index}: choose the grade for {material.name or material.code}."})
            label = str(row.get("label_id") or "").strip()
            if label and InventoryRoll.objects.filter(label_id=label).exists():
                raise ValidationError({"output_rolls": f"Roll label {label} already exists."})
            location = stock_location(row.get("location_id"), order.plant, field="output_rolls")
            roll_plans.append({"material": material, "weight": weight, "width": width, "micron": micron, "grade": grade, "label": label, "location": location, "row": row})
        labels = [plan["label"] for plan in roll_plans if plan["label"]]
        if len(labels) != len(set(labels)):
            raise ValidationError({"output_rolls": "Two output rolls have the same label."})

        bulk_plans = []
        for index, row in enumerate(data.get("output_bulk") or [], start=1):
            try:
                material = InventoryMaterial.objects.get(id=row.get("material_id"))
                uom = BulkService._material_stock_uom(material)
            except (InventoryMaterial.DoesNotExist, ValueError, TypeError):
                raise ValidationError({"output_bulk": f"Bulk line {index}: choose an existing material."})
            except DjangoValidationError as exc:
                raise ValidationError({"output_bulk": messages_of(exc)})
            qty = kg3(dec(row.get("quantity")))
            if qty <= 0:
                raise ValidationError({"output_bulk": f"Bulk line {index}: quantity must be more than zero."})
            location = stock_location(row.get("location_id"), order.plant, field="output_bulk")
            bulk_plans.append({"material": material, "qty": qty, "uom": uom, "location": location, "granule_code_id": row.get("granule_code_id") or None})

        wastage_plan = None
        wastage = data.get("wastage") or None
        if wastage:
            wkg = kg3(dec(wastage.get("kg")))
            if wkg <= 0:
                raise ValidationError({"wastage": "Enter the wastage weight in kg."})
            bags = wastage.get("bags")
            wastage_plan = {"kg": wkg, "bags": int(bags) if bags not in (None, "") else None, "returned": bool(wastage.get("returned_to_factory")), "notes": str(wastage.get("notes") or "").strip()}

        if not (settle_rows or fg_plan or roll_plans or bulk_plans or wastage_plan):
            raise ValidationError({"sent_lines": "Record what came back: output, balance material or wastage."})

        expected = order.expected_output_kind
        if (fg_plan and expected != "FG_PCS") or (roll_plans and expected != "ROLLS") or (bulk_plans and expected != "BULK"):
            warnings.append({"code": "OUTPUT_KIND", "message": f"The order expected {OUTPUT_LABELS.get(expected, expected).lower()}; this return books a different output."})

        # ---- material balance -------------------------------------------
        settled_kg = sum((row["consumed_kg"] + row["returned_kg"] for row in settle_rows), ZERO)
        output_kg = (fg_plan["kg"] if fg_plan else ZERO) + sum((plan["weight"] for plan in roll_plans), ZERO) + sum((plan["qty"] for plan in bulk_plans if plan["uom"] == "KG"), ZERO)
        balance_kg = sum((row["returned_kg"] for row in settle_rows), ZERO)
        wastage_kg = wastage_plan["kg"] if wastage_plan else ZERO
        variance_kg = settled_kg - (output_kg + balance_kg + wastage_kg)
        variance_pct = (variance_kg / settled_kg * 100).quantize(KG3) if settled_kg > 0 else None
        closing = {str(row["line"].id) for row in settle_rows if row["closes_line"]}
        nothing_left = all((not row["is_open"]) or key in closing for key, row in balances.items())
        prior = order.returns.aggregate(s=Sum("settled_sent_kg"), o=Sum("output_kg"), b=Sum("balance_kg"), w=Sum("wastage_kg"))
        cum_settled = Decimal(str(prior["s"] or 0)) + settled_kg
        cum_accounted = sum((Decimal(str(prior[key] or 0)) for key in ("o", "b", "w")), ZERO) + output_kg + balance_kg + wastage_kg
        cum_variance = cum_settled - cum_accounted
        cum_pct = (cum_variance / cum_settled * 100) if cum_settled > 0 else None
        variance_reason = str(data.get("variance_reason") or "").strip()
        if nothing_left and cum_pct is not None and abs(cum_pct) > tolerance and not variance_reason:
            raise ValidationError({"variance_reason": (
                f"Material balance is off by {kg3(cum_variance)} kg ({cum_pct.quantize(Decimal('0.1'))}%), more than the "
                f"{tolerance.normalize():f}% tolerance. Explain the difference before saving."
            )})
        if not nothing_left and variance_pct is not None and abs(variance_pct) > tolerance:
            warnings.append({"code": "PARTIAL_BALANCE", "message": f"This trip's balance is off by {kg3(variance_kg)} kg; it is checked again when the last material comes back."})

        # ---- bill --------------------------------------------------------
        bill_data = data.get("bill") or None
        bill_obj = None
        billed = {"billed_qty": None, "billed_uom": "", "billed_rate": None, "billed_amount": None}
        vendor_document_no = str(data.get("vendor_document_no") or "").strip()
        if bill_data:
            bill_obj = check_bill(order, bill_data["bill_id"])
            if not vendor_document_no:
                vendor_document_no = bill_invoice_number(bill_obj)
            billed = {
                "billed_qty": kg3(bill_data["billed_qty"]) if bill_data.get("billed_qty") not in (None, "") else None,
                "billed_uom": str(bill_data.get("billed_uom") or "").upper(),
                "billed_rate": Decimal(str(bill_data["billed_rate"])).quantize(RATE4) if bill_data.get("billed_rate") not in (None, "") else None,
                "billed_amount": money(bill_data["billed_amount"]) if bill_data.get("billed_amount") not in (None, "") else None,
            }
            warnings.extend(bill_warnings(order, billed, fg_plan, output_kg, bill_obj))

        ret = JobWorkReturn.objects.create(
            number=next_document_number("JWR", prefix="JWR"),
            order=order,
            plant=order.plant,
            received_at=received_at,
            received_by=user,
            bill=bill_obj,
            vendor_document_no=vendor_document_no[:80],
            vendor_document_date=data.get("vendor_document_date"),
            settled_sent_kg=kg3(settled_kg),
            output_kg=kg3(output_kg),
            output_pcs=fg_plan["pcs"] if fg_plan else 0,
            balance_kg=kg3(balance_kg),
            wastage_kg=kg3(wastage_kg),
            variance_kg=kg3(variance_kg),
            variance_pct=variance_pct,
            variance_reason=variance_reason,
            warnings=warnings,
            notes=str(data.get("notes") or "").strip(),
            request_key=str(parse_token(data.get("client_token"))),
            **billed,
        )
        line_no = 0
        jw_loc = jobwork_location(order.plant)
        step_index = order.route_step_index if order.route_step_index is not None else int(getattr(job, "current_step_index", 0) or 0)

        # ---- balances back to stock, processed material consumed ---------
        processed = []  # (sent roll, consumed kg, balance child or None)
        for row in settle_rows:
            line = row["line"]
            if line.kind == "ROLL":
                roll = lock_sent_roll(line, jw_loc)
                balance_roll = None
                if row["disposition"] == "RETURNED":
                    RollService.move_roll(roll=roll, to_location=row["location"], reason="JOBWORK_IN", reason_note=f"{ret.number} returned unused by {order.vendor_name}"[:255], job=job, user=user)
                    set_roll_status(roll, "AVAILABLE")
                    balance_roll = roll
                elif row["disposition"] == "PARTLY_USED":
                    balance_roll = split_remainder(roll, row["returned_kg"], row["location"], ret, job, user)
                    processed.append((roll, row["consumed_kg"], balance_roll))
                else:
                    consume_sent_roll(roll)
                    processed.append((roll, row["consumed_kg"], None))
                if balance_roll is not None:
                    line_no += 1
                    JobWorkReturnLine.objects.create(
                        job_work_return=ret, line_no=line_no, kind="BALANCE_ROLL", quantity=row["returned_kg"], uom="KG",
                        qty_kg=row["returned_kg"], location=row["location"], sent_line=line, material=roll.material,
                        roll=balance_roll, roll_label=balance_roll.label_id,
                        meta_json={"disposition": row["disposition"], "sent_roll": roll.label_id},
                    )
            else:
                reference = f"{ret.number} {order.vendor_name}"[:180]
                try:
                    if row["consumed_qty"] > 0:
                        BulkService.consume_bulk(str(line.material_id), row["consumed_qty"], str(jw_loc.id), job_id=getattr(job, "id", None), reference=f"{reference} processed", granule_code_id=line.granule_code_id, qty_uom=line.uom)
                    if row["returned_qty"] > 0:
                        BulkService.transfer_bulk(str(line.material_id), row["returned_qty"], str(jw_loc.id), str(row["location"].id), reference=f"{reference} balance", granule_code_id=line.granule_code_id, qty_uom=line.uom)
                except DjangoValidationError:
                    raise Conflict(jobwork_out_shortage(line, jw_loc))
                if row["returned_qty"] > 0:
                    line_no += 1
                    JobWorkReturnLine.objects.create(
                        job_work_return=ret, line_no=line_no, kind="BALANCE_BULK", quantity=row["returned_qty"], uom=line.uom,
                        qty_kg=row["returned_kg"], location=row["location"], sent_line=line, material=line.material,
                        meta_json={"disposition": row["disposition"]},
                    )
            JobWorkSettlement.objects.create(
                order=order, sent_line=line, job_work_return=ret, source="RETURN",
                consumed_qty=row["consumed_qty"], returned_qty=row["returned_qty"],
                consumed_kg=row["consumed_kg"], returned_kg=row["returned_kg"],
                note=row["disposition"], created_by=user, created_at=received_at,
            )

        source_labels = [roll.label_id for roll, _, _ in processed]
        # ---- outputs -------------------------------------------------------
        if fg_plan:
            fg_batch = create_fg_batch(order, job, ret, fg_plan, step_index, source_labels)
            line_no += 1
            JobWorkReturnLine.objects.create(
                job_work_return=ret, line_no=line_no, kind="FG_PCS", quantity=Decimal(fg_plan["pcs"]), uom="PCS",
                qty_kg=fg_plan["kg"], boxes=fg_plan["boxes"], location=fg_plan["location"], fg_batch=fg_batch,
                meta_json={"batch_number": fg_batch.batch_number, "inner_pack_source": fg_plan["inner_pack_source"]},
            )
        output_rolls = []
        for plan in roll_plans:
            out = create_output_roll(order, job, process, ret, plan, step_index, processed, user)
            output_rolls.append((out, plan["weight"]))
            line_no += 1
            JobWorkReturnLine.objects.create(
                job_work_return=ret, line_no=line_no, kind="OUTPUT_ROLL", quantity=plan["weight"], uom="KG", qty_kg=plan["weight"],
                location=plan["location"], material=plan["material"], roll=out, roll_label=out.label_id,
                meta_json={"width_mm": str(plan["width"]), "thickness_micron": str(plan["micron"]), "source_rolls": source_labels},
            )
        total_roll_out = sum((weight for _, weight in output_rolls), ZERO)
        for parent, consumed_kg, _ in processed:
            for out, weight in output_rolls:
                share = (consumed_kg * weight / total_roll_out).quantize(KG3) if total_roll_out > 0 else ZERO
                RollLink.objects.get_or_create(parent_roll=parent, child_roll=out, defaults={"relation_type": "PROCESS_OUTPUT", "qty_used_kg": share})
        for plan in bulk_plans:
            try:
                tx = BulkService.add_bulk(
                    material_id=str(plan["material"].id), qty=plan["qty"], plant_id=str(order.plant_id), location_id=str(plan["location"].id),
                    cost=0, reference=f"{ret.number} job-work output from {order.vendor_name}"[:200], tx_type="PRODUCE",
                    job_id=getattr(job, "id", None), granule_code_id=plan["granule_code_id"], qty_uom=plan["uom"],
                )
            except DjangoValidationError as exc:
                raise ValidationError({"output_bulk": messages_of(exc)})
            line_no += 1
            JobWorkReturnLine.objects.create(
                job_work_return=ret, line_no=line_no, kind="OUTPUT_BULK", quantity=plan["qty"], uom=plan["uom"],
                qty_kg=plan["qty"] if plan["uom"] == "KG" else ZERO, location=plan["location"], material=plan["material"], bulk_transaction=tx,
            )

        if wastage_plan:
            scrap_log = None
            if job is not None:
                from apps.production.models import ScrapLog
                from apps.production.services.shift_resolver import build_shift_fields_for_job

                note_bits = [f"Job work {ret.number} · {order.vendor_name}"]
                if wastage_plan["bags"]:
                    note_bits.append(f"{wastage_plan['bags']} bags")
                note_bits.append("returned to factory" if wastage_plan["returned"] else "kept by job worker")
                if wastage_plan["notes"]:
                    note_bits.append(wastage_plan["notes"])
                scrap_log = ScrapLog.objects.create(
                    production_job=job, quantity=wastage_plan["kg"], uom="KG", reason="JOBWORK_WASTE",
                    notes=" · ".join(note_bits), logged_by=user, **build_shift_fields_for_job(job),
                )
            line_no += 1
            JobWorkReturnLine.objects.create(
                job_work_return=ret, line_no=line_no, kind="WASTAGE", quantity=wastage_plan["kg"], uom="KG", qty_kg=wastage_plan["kg"],
                bags=wastage_plan["bags"], returned_to_factory=wastage_plan["returned"], scrap_log=scrap_log,
                meta_json={"notes": wastage_plan["notes"]},
            )

        # ---- consumption records + job progress -------------------------
        total_processed = sum((kg for _, kg, _ in processed), ZERO)
        if job is not None and process is not None:
            first_out = output_rolls[0][0] if output_rolls else None
            for parent, consumed_kg, balance_roll in processed:
                share = (consumed_kg / total_processed) if total_processed > 0 else ZERO
                RollConsumption.objects.create(
                    job=job, process=process, input_roll=parent, output_roll=first_out, balance_roll=balance_roll,
                    consumed_kg=kg3(consumed_kg), scrap_kg=kg3(wastage_kg * share), output_kg=kg3(output_kg * share),
                    balance_kg=kg3(balance_roll.weight_kg if balance_roll is not None else 0), operator=user,
                    notes=f"Job work {ret.number} at {order.vendor_name}"[:500],
                )
        if job is not None and output_kg > 0:
            record_job_output(job, output_kg, fg_plan["pcs"] if fg_plan else None, user)

        # ---- bill link (same transaction) -------------------------------
        bill_result = None
        if bill_obj is not None:
            from apps.gate.bill_services import attach_receipt_to_bill

            bill_result = attach_receipt_to_bill(user, bill_obj.id, "JOBWORK_RETURN", ret.id, complete=bool(bill_data.get("complete")), reason=f"Job-work return {ret.number} for {order.number}.")

        if order.received_at is None:
            order.received_at = received_at
        refresh_status(order)
        order.save(update_fields=["status", "received_at", "updated_at"])
        audit(order, "JW_RETURNED", user, variance_reason, {
            "return": ret.number, "output_kg": output_kg, "pcs": ret.output_pcs, "balance_kg": balance_kg,
            "wastage_kg": wastage_kg, "variance_kg": variance_kg, "bill": str(bill_obj.id) if bill_obj else None,
        })
        return {"order_id": str(order.id), "return_id": str(ret.id), "return_number": ret.number, "status": order.status, "bill": bill_result, "warnings": warnings}

    # --------------------------------------------------------------- close
    @classmethod
    def close(cls, *, order_id, user, data: dict) -> dict:
        require_jobwork_permission(user, "inventory.manage")

        def body(order):
            if order.status in JOBWORK_FINAL_STATUSES:
                raise Conflict(f"Order {order.number} is already {order.status.lower()}.")
            if order.status == "DRAFT":
                raise Conflict(f"Nothing was sent on {order.number}. Cancel the draft instead.")
            stuck = legacy_stuck_rolls(order)
            if stuck:
                raise Conflict(f"{len(stuck)} roll(s) from before the upgrade are still recorded at the job worker. Ask an owner to reconcile them first.")
            balances = line_balances(order)
            open_rows = [row for row in balances.values() if row["is_open"]]
            if open_rows:
                kg = kg3(sum((row["open_kg"] for row in open_rows), ZERO))
                raise Conflict(f"{len(open_rows)} sent line(s) ({kg} kg) are still at the job worker. Receive them, or short-close with a reason.")
            totals = order_totals(order, balances)
            reason = str(data.get("variance_reason") or "").strip()
            if totals["variance_pct"] is not None and abs(totals["variance_pct"]) > totals["tolerance_pct"] and not totals["variance_reason_recorded"] and not reason:
                raise ValidationError({"variance_reason": f"Material balance is off by {totals['variance_kg']} kg ({totals['variance_pct']}%). Explain the difference to close."})
            if reason:
                meta = dict(order.meta_json or {})
                meta["close_variance_reason"] = reason
                order.meta_json = meta
            step = cls._finish_production(order, user, step_force_reason=str(data.get("step_force_reason") or "").strip())
            order.status = "CLOSED"
            order.closed_at = timezone.now()
            order.closed_by = user
            order.save(update_fields=["status", "closed_at", "closed_by", "meta_json", "updated_at"])
            audit(order, "JW_CLOSED", user, reason, {"step": step})
            return {"order_id": str(order.id), "status": order.status, "step": step}

        return _with_locked_order(order_id, "close", data, body)

    @classmethod
    def short_close(cls, *, order_id, user, data: dict) -> dict:
        require_jobwork_permission(user, "inventory.manage")

        def body(order):
            reason = str(data.get("reason") or "").strip()
            if len(reason) < 5:
                raise ValidationError({"reason": "Explain why the order is closed short (at least 5 characters)."})
            if order.status in JOBWORK_FINAL_STATUSES:
                raise Conflict(f"Order {order.number} is already {order.status.lower()}.")
            if order.status == "DRAFT":
                raise Conflict(f"Nothing was sent on {order.number}. Cancel the draft instead.")
            stuck = legacy_stuck_rolls(order)
            if stuck:
                raise Conflict(f"{len(stuck)} roll(s) from before the upgrade are still recorded at the job worker. Ask an owner to reconcile them first.")
            balances = line_balances(order)
            job = order.production_job
            process = order_process(order)
            jw_loc = jobwork_location(order.plant)
            written = []
            now = timezone.now()
            for row in balances.values():
                if not row["is_open"]:
                    continue
                line = row["line"]
                if line.kind == "ROLL":
                    roll = lock_sent_roll(line, jw_loc)
                    meta = dict(roll.meta_json or {})
                    meta["jobwork_write_off"] = {"order": order.number, "reason": reason, "at": now.isoformat()}
                    roll.meta_json = meta
                    roll.save(update_fields=["meta_json"])
                    consume_sent_roll(roll)
                    if job is not None and process is not None:
                        RollConsumption.objects.create(
                            job=job, process=process, input_roll=roll, consumed_kg=row["open_kg"], operator=user,
                            notes=f"Written off at short-close of {order.number}: {reason}"[:500],
                        )
                else:
                    try:
                        BulkService.consume_bulk(str(line.material_id), row["open_qty"], str(jw_loc.id), job_id=getattr(job, "id", None), reference=f"{order.number} short-close write-off"[:200], granule_code_id=line.granule_code_id, qty_uom=line.uom)
                    except DjangoValidationError:
                        raise Conflict(jobwork_out_shortage(line, jw_loc))
                JobWorkSettlement.objects.create(
                    order=order, sent_line=line, source="SHORT_CLOSE", consumed_qty=row["open_qty"], consumed_kg=row["open_kg"],
                    written_off=True, note=reason[:500], created_by=user, created_at=now,
                )
                written.append({"line": line_label(line), "qty": str(row["open_qty"]), "uom": line.uom, "kg": str(row["open_kg"])})
            step = cls._finish_production(order, user, step_force_reason=str(data.get("step_force_reason") or "").strip() or reason)
            order.status = "CLOSED"
            order.closed_at = now
            order.closed_by = user
            order.short_close_reason = reason
            order.save(update_fields=["status", "closed_at", "closed_by", "short_close_reason", "updated_at"])
            audit(order, "JW_SHORT_CLOSED", user, reason, {"written_off": written, "step": step})
            return {"order_id": str(order.id), "status": order.status, "written_off": written, "step": step}

        return _with_locked_order(order_id, "short-close", data, body)

    @classmethod
    def cancel(cls, *, order_id, user, data: dict) -> dict:
        require_jobwork_permission(user, "inventory.manage")

        def body(order):
            reason = str(data.get("reason") or "").strip()
            if len(reason) < 3:
                raise ValidationError({"reason": "Say why the draft is cancelled."})
            if order.status != "DRAFT" or order.sent_lines.exists():
                raise Conflict(f"Only a draft with nothing sent can be cancelled. {order.number} is {STATUS_LABELS.get(order.status, order.status).lower()}.")
            job_note = None
            if order.production_job_id:
                from apps.production.models import ProductionJob

                job = ProductionJob.objects.select_for_update(of=("self",)).get(id=order.production_job_id)
                if order.mode == "EMERGENCY":
                    job_note = release_job(job, user)
                elif job.job_state not in {"COMPLETED", "CANCELLED"}:
                    job.hold_reason = f"Job work {order.number} cancelled; create a new job-work order to continue"[:255]
                    job.save(update_fields=["hold_reason", "updated_at"])
                    job_note = f"Job {job.job_number} stays paused at its job-work step."
            meta = dict(order.meta_json or {})
            meta["cancel_reason"] = reason
            order.meta_json = meta
            order.status = "CANCELLED"
            order.closed_at = timezone.now()
            order.closed_by = user
            order.save(update_fields=["status", "closed_at", "closed_by", "meta_json", "updated_at"])
            audit(order, "JW_CANCELLED", user, reason, {"job": job_note})
            return {"order_id": str(order.id), "status": order.status, "job": job_note}

        return _with_locked_order(order_id, "cancel", data, body)

    @classmethod
    def _finish_production(cls, order: JobWorkOrder, user, *, step_force_reason: str) -> Optional[dict]:
        """Planned step: complete the route step as the real user. Emergency:
        release the job hold. Failures surface as errors; nothing is held silently."""
        if not order.production_job_id:
            return None
        from apps.production.models import ProductionJob
        from apps.production.services.job_services import JobService

        job = ProductionJob.objects.select_for_update(of=("self",)).select_related("work_center").get(id=order.production_job_id)
        if order.mode != "PLANNED_STEP":
            return {"job_number": job.job_number, "action": "RELEASED", "detail": release_job(job, user)}
        if job.job_state == "COMPLETED":
            return {"job_number": job.job_number, "action": "ALREADY_COMPLETED", "detail": "The route step was already completed."}
        if job.job_state not in {"EXECUTING", "PAUSED"}:
            raise Conflict(f"Job {job.job_number} is {job.job_state.lower()}; the job-work step can only be completed while the job is paused for job work.")
        try:
            JobService.complete_step(job, user=user, force_reason=step_force_reason or None)
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
            logger.exception("Job-work close could not complete job %s", job.job_number)
            raise Conflict(f"Job {job.job_number}: the route step could not be completed. {exc}")
        job.refresh_from_db()
        if job.is_on_hold:
            job.is_on_hold = False
            job.hold_reason = None
            job.save(update_fields=["is_on_hold", "hold_reason", "updated_at"])
        return {"job_number": job.job_number, "action": "STEP_COMPLETED", "detail": f"Route step completed by {getattr(user, 'username', 'system')}."}

    # --------------------------------------------------------- legacy fix
    @classmethod
    def reconcile_legacy(cls, *, user, data: dict) -> dict:
        require_owner(user)
        order_id = data.get("order_id")
        if order_id:
            return _with_locked_order(order_id, "legacy", data, lambda order: cls._reconcile_locked(order, user, data))
        return replay_or_run(
            scope="jobwork:legacy:unattributed", token=data.get("client_token"), payload=canonical_payload(data),
            operation=lambda: cls._reconcile_locked(None, user, data),
        )

    @classmethod
    def _reconcile_locked(cls, order: Optional[JobWorkOrder], user, data: dict) -> dict:
        action = str(data.get("action") or "").upper()
        reason = str(data.get("reason") or "").strip()
        if action not in {"CONSUME", "RETURN"}:
            raise ValidationError({"action": "Choose CONSUME (used by the job worker) or RETURN (back in the factory)."})
        if len(reason) < 5:
            raise ValidationError({"reason": "Record why these rolls are reconciled (at least 5 characters)."})
        roll_ids = [str(rid) for rid in data.get("roll_ids") or []]
        if not roll_ids or len(roll_ids) != len(set(roll_ids)):
            raise ValidationError({"roll_ids": "Pick each stuck roll once."})
        if action == "CONSUME" and order is None:
            raise ValidationError({"order_id": "Rolls can only be marked used against the order that sent them."})
        if order is not None and not is_legacy_capable(order):
            raise ValidationError({"order_id": f"{order.number} was created after the upgrade; its rolls are settled through returns."})
        attribution = legacy_attribution(plant_ids=[order.plant_id] if order else None)
        allowed = {str(roll.id) for roll in attribution.get(str(order.id) if order else None, [])}
        stray = [rid for rid in roll_ids if rid not in allowed]
        if stray:
            raise Conflict(f"{len(stray)} roll(s) are no longer stuck for this order (already reconciled or moved). Refresh the list.")
        rolls = list(InventoryRoll.objects.select_for_update(of=("self",)).select_related("material", "location", "location__plant").filter(id__in=roll_ids).order_by("label_id"))
        location = None
        if action == "RETURN":
            plants = {roll.location.plant_id for roll in rolls}
            if len(plants) != 1:
                raise ValidationError({"roll_ids": "Reconcile rolls of one plant at a time."})
            location = stock_location(data.get("location_id"), Plant.objects.get(id=plants.pop()), field="location_id")
        outputs = []
        if action == "CONSUME" and data.get("output_roll_ids"):
            candidates = {str(roll.id): roll for roll in legacy_output_candidates(order)}
            for rid in data["output_roll_ids"]:
                if str(rid) not in candidates:
                    raise ValidationError({"output_roll_ids": "Choose output rolls that were received on this order."})
                outputs.append(candidates[str(rid)])
        job = order.production_job if order else None
        process = order_process(order) if order else None
        now = timezone.now()
        line_no = order.sent_lines.count() if order else 0
        summary = []
        total_out = sum((Decimal(str(out.original_weight_kg or out.weight_kg or 0)) for out in outputs), ZERO)
        for roll in rolls:
            if roll.status != "SENT_JOBWORK":
                raise Conflict(f"{roll.label_id} changed while reconciling. Refresh the list.")
            weight = kg3(roll.weight_kg)
            line = None
            if order is not None:
                line_no += 1
                line = JobWorkSentLine.objects.create(
                    order=order, challan=None, line_no=line_no, kind="ROLL", is_legacy=True, roll=roll, roll_label=roll.label_id,
                    material=roll.material, material_name=(roll.material.name or roll.material.code) if roll.material else "",
                    description=roll_description(roll)[:255], quantity=weight, uom="KG", qty_kg=weight, width_mm=roll.width_mm,
                    thickness_micron=roll.thickness_micron, value=money(roll_rate_per_kg(roll) * weight), sent_at=legacy_sent_at(roll),
                    meta_json={"reconciled_by": getattr(user, "username", ""), "reason": reason},
                )
            if action == "RETURN":
                RollService.move_roll(roll=roll, to_location=location, reason="JOBWORK_IN", reason_note=f"Legacy job-work reconciliation: {reason}"[:255], job=job, user=user)
                set_roll_status(roll, "AVAILABLE")
            else:
                for out in outputs:
                    share = (weight * Decimal(str(out.original_weight_kg or out.weight_kg or 0)) / total_out).quantize(KG3) if total_out > 0 else ZERO
                    RollLink.objects.get_or_create(parent_roll=roll, child_roll=out, defaults={"relation_type": "PROCESS_OUTPUT", "qty_used_kg": share})
                consume_sent_roll(roll)
                if job is not None and process is not None:
                    RollConsumption.objects.create(
                        job=job, process=process, input_roll=roll, output_roll=outputs[0] if outputs else None, consumed_kg=weight,
                        operator=user, notes=f"Legacy job-work reconciliation of {order.number}: {reason}"[:500],
                    )
            if line is not None:
                JobWorkSettlement.objects.create(
                    order=order, sent_line=line, source="RECONCILE",
                    consumed_qty=weight if action == "CONSUME" else ZERO, returned_qty=weight if action == "RETURN" else ZERO,
                    consumed_kg=weight if action == "CONSUME" else ZERO, returned_kg=weight if action == "RETURN" else ZERO,
                    note=reason[:500], created_by=user, created_at=now,
                )
            summary.append({"roll": roll.label_id, "kg": str(weight)})
        after = {"action": action, "rolls": summary, "location": location.name if location else None, "outputs": [out.label_id for out in outputs]}
        if order is not None:
            if order.status == "PARTIAL":
                order.status = "PARTLY_RETURNED"
            refresh_status(order)
            order.save(update_fields=["status", "updated_at"])
            audit(order, "JW_RECONCILED", user, reason, after)
        else:
            from apps.gate.models import GateAuditEvent

            GateAuditEvent.objects.create(
                plant_id=rolls[0].location.plant_id, object_id=uuid.uuid5(uuid.NAMESPACE_URL, "tpp:jobwork:unattributed"),
                object_type="JOBWORK", action="JW_RECONCILED", actor=user, reason=reason[:500], after=after,
            )
        return {"order_id": str(order.id) if order else None, "action": action, "rolls": summary, "status": order.status if order else None}


# -------------------------------------------------------------- helpers
def roll_description(roll: InventoryRoll) -> str:
    material = roll.material
    bits = [(material.name or material.code) if material else "Film roll"]
    if roll.width_mm:
        bits.append(f"{Decimal(str(roll.width_mm)).normalize():f} mm")
    if roll.thickness_micron:
        bits.append(f"{Decimal(str(roll.thickness_micron)).normalize():f} µ")
    return f"Roll {roll.label_id} · " + " · ".join(bits)


def line_label(line: JobWorkSentLine) -> str:
    return f"Roll {line.roll_label}" if line.kind == "ROLL" else (line.material_name or "Bulk line")


def legacy_sent_at(roll: InventoryRoll):
    move = RollMovement.objects.filter(roll=roll, to_location__code="JOBWORK_OUT").order_by("-timestamp").first()
    return move.timestamp if move else roll.created_at


def set_roll_status(roll: InventoryRoll, status: str) -> None:
    from apps.inventory.services.fsm import ROLL_TRANSITIONS, validate_transition

    validate_transition(roll.status, status, ROLL_TRANSITIONS, label=f"Roll {roll.label_id}")
    roll.status = status
    meta = dict(roll.meta_json or {})
    if status == "AVAILABLE" and "jobwork" in meta:
        meta["jobwork_returned"] = meta.pop("jobwork")
        roll.meta_json = meta
        roll.save(update_fields=["status", "meta_json"])
        return
    roll.save(update_fields=["status"])


def consume_sent_roll(roll: InventoryRoll) -> None:
    """Processed at (or written off by) the job worker: the roll leaves JOBWORK_OUT for good."""
    from apps.inventory.services.fsm import ROLL_TRANSITIONS, validate_transition

    validate_transition(roll.status, "CONSUMED", ROLL_TRANSITIONS, label=f"Roll {roll.label_id}")
    roll.status = "CONSUMED"
    roll.weight_kg = ZERO
    roll.save(update_fields=["status", "weight_kg"])


def lock_sent_roll(line: JobWorkSentLine, jw_loc: InventoryLocation) -> InventoryRoll:
    if not line.roll_id:
        raise Conflict(f"Roll {line.roll_label} is no longer in the system; it cannot be settled.")
    roll = InventoryRoll.objects.select_for_update(of=("self",)).select_related("material", "location").get(id=line.roll_id)
    if roll.status != "SENT_JOBWORK" or roll.location_id != jw_loc.id:
        raise Conflict(f"Roll {roll.label_id} is {roll.get_status_display().lower()} at {roll.location.name}, not at the job worker. Refresh the order.")
    return roll


def unique_roll_label(base: str) -> str:
    base = base[:46]
    candidate = base
    counter = 1
    while InventoryRoll.objects.filter(label_id=candidate).exists():
        counter += 1
        candidate = f"{base}-{counter}"
    return candidate


def split_remainder(roll: InventoryRoll, remainder_kg: Decimal, location: InventoryLocation, ret: JobWorkReturn, job, user) -> InventoryRoll:
    """Partly used roll: the unused remainder returns as a child roll (SPLIT
    lineage, same fields RollService.split_roll copies); the parent is consumed."""
    meta = {key: value for key, value in dict(roll.meta_json or {}).items() if key != "jobwork"}
    meta.update({"jobwork_balance_of": roll.label_id, "jobwork_return": ret.number, "roll_role": "REMAINDER", "is_remainder": True})
    child = InventoryRoll.objects.create(
        label_id=unique_roll_label(f"{roll.label_id}-JWB"),
        material=roll.material,
        batch_no=roll.batch_no,
        thickness_micron=roll.thickness_micron,
        width_mm=roll.width_mm,
        stock_form=roll.stock_form,
        width_basis=roll.width_basis,
        grade=roll.grade,
        plant=location.plant,
        density_gcm3=RollService._resolve_density_gcm3(roll=roll),
        original_weight_kg=remainder_kg,
        weight_kg=remainder_kg,
        net_weight_kg=remainder_kg,
        location=location,
        status="AVAILABLE",
        stage_index=roll.stage_index,
        parent_roll=roll,
        created_by_job=roll.created_by_job,
        created_process=roll.created_process,
        is_fg=roll.is_fg,
        template=roll.template,
        current_step_index=roll.current_step_index,
        completed_step_index=roll.completed_step_index,
        geometry_override=roll.geometry_override or {},
        production_job=roll.production_job,
        sales_order_item=roll.sales_order_item,
        vendor=roll.vendor,
        meta_json=meta,
    )
    RollLink.objects.create(parent_roll=roll, child_roll=child, relation_type="SPLIT", qty_used_kg=remainder_kg)
    RollService.log_movement(roll=child, from_location=roll.location, to_location=location, reason="JOBWORK_IN", reason_note=f"{ret.number} balance of {roll.label_id}"[:255], job=job, user=user)
    consume_sent_roll(roll)
    return child


def order_geometry(job) -> dict:
    if job is None:
        return {}
    item = getattr(job, "sales_order_item", None)
    if item is not None and getattr(item, "sales_order", None) is not None:
        return dict(item.sales_order.geometry_override or {})
    if getattr(job, "mts_order", None) is not None:
        return dict(job.mts_order.geometry_override or {})
    return {}


def is_internal_stock(job) -> bool:
    if job is None:
        return False
    from apps.production.services.services_execution import ExecutionService

    return bool(ExecutionService._is_packaging_purpose_job(job))


def unit_weight_g(job) -> Decimal:
    from apps.production.services.job_services import JobService

    weight = JobService._unit_weight_g(job)
    if weight > 0:
        return weight
    from apps.production.services.services_execution import ExecutionService

    return Decimal(str(ExecutionService._job_unit_weight_g(job) or 0))


def create_output_roll(order, job, process, ret, plan, step_index, processed, user) -> InventoryRoll:
    from apps.materials.stock_forms import STOCK_FORM_OPEN_WEB, normalize_stock_form, normalize_width_basis

    material = plan["material"]
    row = plan["row"]
    if plan["label"]:
        label = plan["label"]
    elif job is not None:
        count = InventoryRoll.objects.filter(production_job=job).count() + 1
        label = unique_roll_label(f"R-{job.job_number}-{count:04d}-JW")
    else:
        label = unique_roll_label(f"R-{order.number}")
    parent = processed[0][0] if processed else None
    stock_form = normalize_stock_form(row.get("stock_form") or getattr(parent, "stock_form", None) or STOCK_FORM_OPEN_WEB)
    width_basis = normalize_width_basis(row.get("width_basis") or "", stock_form=stock_form)
    stage = max([int(getattr(p, "stage_index", 0) or 0) for p, _, _ in processed] or [0]) + 1
    meta = {
        "roll_role": "OUTPUT",
        "source_behavior": "JOBWORK",
        "is_remainder": False,
        "jobwork": {"order_id": str(order.id), "order_number": order.number, "return_number": ret.number, "vendor": order.vendor_name},
    }
    if is_internal_stock(job):
        meta["is_internal_stock"] = True
    roll = InventoryRoll.objects.create(
        label_id=label,
        material=material,
        batch_no=str(row.get("batch_no") or ret.number)[:100],
        plant=order.plant,
        production_job=job,
        created_by_job=job,
        created_process=process,
        parent_roll=parent,
        thickness_micron=plan["micron"],
        width_mm=plan["width"],
        stock_form=stock_form,
        width_basis=width_basis,
        density_gcm3=RollService._resolve_density_gcm3(material=material),
        grade=plan["grade"],
        weight_kg=plan["weight"],
        original_weight_kg=plan["weight"],
        net_weight_kg=plan["weight"],
        length_m=dec(row.get("length_m")),
        status="AVAILABLE",
        location=plan["location"],
        stage_index=stage,
        current_step_index=(step_index + 1) if job is not None else 0,
        completed_step_index=step_index if job is not None else 0,
        template=getattr(job, "template", None),
        sales_order_item=getattr(job, "sales_order_item", None),
        geometry_override=order_geometry(job),
        is_fg=plan["location"].type == "FG",
        meta_json=meta,
    )
    RollService.log_movement(roll=roll, to_location=plan["location"], reason="JOBWORK_IN", reason_note=f"{ret.number} output from {order.vendor_name}"[:255], job=job, user=user)
    return roll


def create_fg_batch(order, job, ret, fg_plan, step_index, source_labels):
    """FG batch built exactly like the terminal pouch completion (ExecutionService)."""
    from apps.production.models import FinishedGoodsBatch
    from apps.production.services.services_execution import ExecutionService

    count = FinishedGoodsBatch.objects.filter(production_job=job).count() + 1
    batch_number = f"BATCH-{job.job_number}-{count:03d}"
    while FinishedGoodsBatch.objects.filter(batch_number=batch_number).exists():
        count += 1
        batch_number = f"BATCH-{job.job_number}-{count:03d}"
    meta = {"is_internal_stock": True} if is_internal_stock(job) else {}
    meta["output_capture_policy"] = {"effective_mode": "KG_AND_PCS", "requires_output_pcs": True, "allows_kg_only": False}
    meta["primary_uom"] = "PCS"
    meta["jobwork"] = {
        "order_id": str(order.id), "order_number": order.number, "return_id": str(ret.id), "return_number": ret.number,
        "vendor_id": str(order.vendor_id) if order.vendor_id else None, "vendor": order.vendor_name,
        "boxes": fg_plan["boxes"], "source_rolls": source_labels,
    }
    packaging = ExecutionService._job_packaging_snapshot(job) or {}
    primary = packaging.get("primary_inner_pack") if isinstance(packaging.get("primary_inner_pack"), dict) else {}
    pack_meta = None
    if primary and bool(primary.get("enabled")):
        material_id = primary.get("material_id")
        try:
            pcs_per_pack = int(primary.get("pcs_per_pack") or 0)
        except (TypeError, ValueError):
            pcs_per_pack = 0
        if not material_id or pcs_per_pack <= 0:
            raise ValidationError({"fg": "The order's inner-pack setup is incomplete (material or pieces per pack). Fix the sales packaging first."})
        pack_meta = {
            "enabled": True, "material_id": str(material_id), "pcs_per_pack": pcs_per_pack,
            "pack_count": (int(fg_plan["pcs"]) + pcs_per_pack - 1) // pcs_per_pack, "consumed_at_fg": True,
            "source": "JOBWORK_VENDOR" if fg_plan["inner_pack_source"] == "VENDOR" else "FINAL_STEP",
        }
        meta["primary_inner_pack"] = pack_meta
    batch = FinishedGoodsBatch.objects.create(
        batch_number=batch_number,
        qty_kg=fg_plan["kg"],
        qty_pcs=int(fg_plan["pcs"]),
        geometry_override=order_geometry(job),
        meta_json=meta,
        completed_step_index=step_index,
        production_job=job,
        production_batch=getattr(job, "production_batch", None),
        sales_order_item=job.sales_order_item,
        status="AVAILABLE",
        location=fg_plan["location"],
        template=job.template,
    )
    if pack_meta and fg_plan["inner_pack_source"] == "FACTORY":
        from apps.inventory.services.packaging_service import PackagingService

        so = getattr(getattr(job, "sales_order_item", None), "sales_order", None)
        try:
            PackagingService.consume_packaging_stock(
                material_id=pack_meta["material_id"], qty=pack_meta["pack_count"], input_uom="PCS", location_id=fg_plan["location"].id,
                job_id=job.id, sales_order_item_id=getattr(job, "sales_order_item_id", None), mts_order_id=getattr(job, "mts_order_id", None),
                reference=f"SO:{getattr(so, 'order_number', 'N/A')} JOB:{job.job_number} FG_BATCH:{batch.batch_number}",
                basis="PER_PACK", meta_json={"fg_batch_id": str(batch.id), "applied_at": "FG_CREATION", "pack_count": pack_meta["pack_count"], "jobwork_return": ret.number},
            )
        except DjangoValidationError as exc:
            raise ValidationError({"fg": f"{messages_of(exc)} Choose 'packed in the job worker's own inner packs' if the vendor used theirs."})
    return batch


def record_job_output(job, output_kg: Decimal, output_pcs: Optional[int], user) -> None:
    """Same progress bookkeeping as JobService.log_output_event."""
    from apps.production.models import JobExecutionLog, ProductionJob
    from apps.production.services.batch_route_service import BatchExecutionService
    from apps.production.services.job_services import JobService
    from apps.production.services.shift_resolver import build_shift_fields_for_job

    locked = ProductionJob.objects.select_for_update(of=("self",)).select_related("sales_order_item", "mts_order", "production_batch").get(id=job.id)
    if str(locked.uom or "KG").upper() == "PCS" and output_pcs:
        increment = Decimal(output_pcs)
    else:
        increment = JobService._kg_to_job_uom(locked, output_kg)
    target = Decimal(str(locked.quantity or 0))
    produced = Decimal(str(locked.produced_qty or 0)) + increment
    if target > 0 and produced > target:
        produced = target
    locked.produced_qty = produced
    locked.remaining_qty = max(target - produced, ZERO)
    locked.save(update_fields=["produced_qty", "remaining_qty", "updated_at"])
    JobExecutionLog.objects.create(production_job=locked, quantity=kg3(output_kg), uom="KG", logged_by=user, **build_shift_fields_for_job(locked))
    job.produced_qty, job.remaining_qty = locked.produced_qty, locked.remaining_qty
    BatchExecutionService.sync_for_job(locked)


def release_job(job, user) -> str:
    from apps.production.services.job_services import JobService

    if job.job_state in {"COMPLETED", "CANCELLED"}:
        return f"Job {job.job_number} is {job.job_state.lower()}; there is no hold to release."
    if job.job_state == "PAUSED":
        job = JobService.resume_job(job.id, user=user)
    job.is_on_hold = False
    job.hold_reason = None
    job.save(update_fields=["is_on_hold", "hold_reason", "updated_at"])
    return f"Job {job.job_number} released from the job-work hold ({job.job_state.lower()})."


def jobwork_out_shortage(line: JobWorkSentLine, jw_loc: InventoryLocation) -> str:
    from apps.inventory.models import InventoryBulk

    qs = InventoryBulk.objects.filter(material_id=line.material_id, location=jw_loc)
    if line.granule_code_id:
        qs = qs.filter(granule_code_id=line.granule_code_id)
    held = qs.aggregate(total=Sum("qty_kg"))["total"] or ZERO
    return (
        f"{line.material_name}: the job-work location holds only {kg3(held).normalize():f} {line.uom}, less than this order "
        "still shows at the vendor. Nothing was posted; check this material's stock movements before receiving it."
    )


def bill_invoice_number(bill) -> str:
    header = str(getattr(bill, "invoice_number", "") or "").strip()
    return header or str((bill.review_data or {}).get("invoice_number") or "").strip()


def check_bill(order: JobWorkOrder, bill_id):
    from apps.gate.models import InwardBillIntake

    bill = InwardBillIntake.objects.select_related("plant").filter(id=bill_id).first()
    if bill is None:
        raise ValidationError({"bill": "This bill does not exist."})
    if bill.plant_id != order.plant_id and getattr(bill, "ship_to_plant_id", None) != order.plant_id:
        raise ValidationError({"bill": f"This bill arrived at {bill.plant.name}; the order belongs to {order.plant.name}."})
    if bill.status not in {"PENDING_GRN", "PARTIAL_GRN"}:
        raise Conflict("This bill is already closed. Open it from Bills & documents to see what it is linked to.")
    vendor_ids = {str(value) for value in [getattr(bill, "vendor_id", None), (bill.review_data or {}).get("vendor_id")] if value}
    if vendor_ids and str(order.vendor_id) not in vendor_ids:
        raise ValidationError({"bill": f"This bill is from another vendor; the order's job worker is {order.vendor_name}."})
    return bill


def bill_warnings(order, billed, fg_plan, output_kg, bill) -> List[dict]:
    warnings = []
    qty, uom, rate, amount = billed["billed_qty"], billed["billed_uom"], billed["billed_rate"], billed["billed_amount"]
    if qty is not None:
        if uom == "PCS":
            received = Decimal(fg_plan["pcs"]) if fg_plan else ZERO
            if qty != received:
                warnings.append({"code": "BILLED_QTY", "message": f"The bill charges {qty.normalize():f} pcs but this return receives {received.normalize():f} pcs."})
        elif uom == "KG" and abs(qty - output_kg) > Decimal("0.5"):
            warnings.append({"code": "BILLED_QTY", "message": f"The bill charges {qty.normalize():f} kg but this return receives {kg3(output_kg)} kg of output."})
    if rate is not None:
        if order.rate is not None and (not uom or not order.rate_uom or uom == order.rate_uom) and rate != Decimal(str(order.rate)).quantize(RATE4):
            warnings.append({"code": "RATE_ORDER", "message": f"Billed rate ₹{rate.normalize():f} differs from the agreed ₹{Decimal(str(order.rate)).normalize():f} per {order.rate_uom or uom}."})
        process = order_process(order)
        card = vendor_rate(order.vendor, getattr(process, "code", ""), uom) if process is not None else None
        if card and Decimal(card["rate"]).quantize(RATE4) != rate:
            warnings.append({"code": "RATE_CARD", "message": f"Billed rate ₹{rate.normalize():f} differs from {order.vendor_name}'s rate card ₹{Decimal(card['rate']).normalize():f} per {card['uom']}."})
    if qty is not None and rate is not None and amount is not None and abs(money(qty * rate) - amount) > Decimal("1.00"):
        warnings.append({"code": "AMOUNT", "message": f"Billed amount ₹{amount} is not {qty.normalize():f} × ₹{rate.normalize():f} = ₹{money(qty * rate)}."})
    taxable = getattr(bill, "taxable_amount", None)
    if amount is not None and taxable is not None and abs(Decimal(str(taxable)) - amount) > Decimal("1.00"):
        warnings.append({"code": "BILL_TAXABLE", "message": f"The bill's taxable value ₹{taxable} differs from the job-work amount ₹{amount}."})
    return warnings
