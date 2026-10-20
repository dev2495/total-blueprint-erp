"""Our own papers coming back in at the gate.

One record for the three ways goods of ours return through a gate:

* ``INTERPLANT_DC``   — a truck from another of our factories arrives with an inter-plant challan;
* ``JOBWORK_CHALLAN`` — a job worker brings back processed material against our job-work challan;
* ``GATE_PASS``       — a returnable gate pass item (repair, calibration, trial...) comes back.

The watchman scans the QR on the paper (or the office types the number); the arrival is saved
once, the source record gets its "back at gate" mark where it has one, and the store is told to
receive it. Nothing here moves stock: receiving stays on the inter-plant, job-work and gate-pass
screens, exactly as before.
"""
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.users.permission_service import PermissionService
from apps.users.services.bill_notifications import publish_document_event, register_document_event

from .models import ARRIVAL_KINDS, GateArrival, GateAuditEvent
from .outward_registry import build_snapshot, iso
from .qr import parse_token
from .services import get_plant, idempotent_action, is_owner, is_watchman

ARRIVAL_EVENT = "documents.gate_arrival"
register_document_event(ARRIVAL_EVENT, "documents.manage")
KIND_LABELS = dict(ARRIVAL_KINDS)
ARRIVAL_HANDLERS = {}


def register_arrival_kind(kind, resolve, on_arrival=None, deep_link=None):
    ARRIVAL_HANDLERS[kind] = {"resolve": resolve, "on_arrival": on_arrival, "deep_link": deep_link}


def _refuse(message):
    raise ValidationError({"code": message})


# ------------------------------------------------------------- inter-plant
def _interplant_queryset():
    from apps.inventory.models import DeliveryChallan

    return DeliveryChallan.objects.select_related("from_plant", "to_plant").prefetch_related("items__roll", "items__material")


def resolve_interplant_arrival(object_id, plant):
    challan = _interplant_queryset().filter(id=object_id).first()
    if challan is None:
        _refuse("This inter-plant challan is not in the ERP.")
    if challan.to_plant_id != plant.id:
        _refuse(f"This challan is for {challan.to_plant.name if challan.to_plant_id else 'another factory'}, not this gate.")
    reference = challan.dc_no or f"IP-{str(challan.id)[:8].upper()}"
    if challan.status == "RECEIVED":
        _refuse(f"Inter-plant challan {reference} is already received here.")
    lines = []
    for item in challan.items.all():
        if item.line_type == "ROLL" and item.roll_id:
            label = f"Roll {item.roll.label_id}"
        elif item.material_id:
            label = item.material.name or item.material.code
        else:
            label = item.get_line_type_display()
        quantity = item.dispatched_qty_kg if item.dispatched_qty_kg else item.planned_qty_kg
        lines.append({"description": label, "quantity": quantity, "uom": "KG"})
    warnings = []
    if challan.status in {"DRAFT", "APPROVED"}:
        warnings.append(f"{challan.from_plant.name} has not dispatched this challan in the ERP yet; the store will check the goods against it.")
    if challan.gate_in_at:
        warnings.append("This challan was already recorded at the gate once.")
    return build_snapshot(
        kind="INTERPLANT_DC", obj_id=challan.id, reference=reference, party_name=f"From {challan.from_plant.name}",
        plant=challan.to_plant, status=challan.status, document_date=challan.dispatched_at or challan.created_at,
        lines=lines, warnings=warnings,
    )


def interplant_arrived(object_id, arrived_at, user):
    from apps.inventory.models import DeliveryChallan

    challan = DeliveryChallan.objects.select_for_update().filter(id=object_id).first()
    if challan is not None and not challan.gate_in_at:
        challan.gate_in_at = arrived_at
        challan.gate_in_by = user if getattr(user, "pk", None) else None
        challan.save(update_fields=["gate_in_at", "gate_in_by", "updated_at"])


# ---------------------------------------------------------------- job work
def resolve_jobwork_arrival(object_id, plant):
    from apps.inventory.models import JobWorkChallan
    from apps.inventory.services.job_work_integrations import challan_snapshot

    challan = JobWorkChallan.objects.select_related("order", "plant", "vendor").filter(id=object_id).first()
    if challan is None:
        _refuse("This job-work challan is not in the ERP.")
    if challan.plant_id != plant.id:
        _refuse("This job-work challan belongs to another factory. The material comes back to the factory that sent it.")
    order = challan.order
    if order.status in {"RETURNED", "CLOSED", "CANCELLED"}:
        _refuse(f"Job-work order {order.number or order.id} has nothing left at {challan.vendor.name}.")
    snapshot = challan_snapshot(challan, plant)
    snapshot["party_name"] = f"From {challan.vendor.name}"
    snapshot.setdefault("warnings", []).append("The store records what came back (output, balance, wastage) on the job-work order.")
    return snapshot


def jobwork_arrived(object_id, arrived_at, user):
    from apps.inventory.models import JobWorkChallan
    from apps.inventory.services.job_work import audit

    challan = JobWorkChallan.objects.select_related("order").filter(id=object_id).first()
    if challan is not None:
        audit(challan.order, "JW_GATE_IN", user, "", {"challan": challan.number, "at": arrived_at})


# -------------------------------------------------------------- gate pass
def resolve_gate_pass_arrival(object_id, plant):
    from .gate_pass_services import _gate_pass_link_snapshot, display_number
    from .models import GatePass

    gate_pass = GatePass.objects.select_related("plant").prefetch_related("lines__machine").filter(id=object_id).first()
    if gate_pass is None:
        _refuse("This gate pass is not in the ERP.")
    if gate_pass.plant_id != plant.id:
        _refuse("This gate pass belongs to another factory.")
    number = display_number(gate_pass)
    if gate_pass.kind != "RETURNABLE":
        _refuse(f"Gate pass {number} is non-returnable: nothing is expected back on it.")
    if gate_pass.status not in {"OUT", "PARTLY_RETURNED", "ISSUED"}:
        _refuse(f"Gate pass {number} is {gate_pass.get_status_display().lower()}; nothing is expected back on it.")
    snapshot = _gate_pass_link_snapshot(gate_pass)
    if gate_pass.status == "ISSUED":
        snapshot.setdefault("warnings", []).append("The ERP has no gate-out for this pass; check the items left on it.")
    return snapshot


def gate_pass_arrived(object_id, arrived_at, user):
    from .gate_pass_services import gate_pass_audit
    from .models import GatePass

    gate_pass = GatePass.objects.filter(id=object_id).first()
    if gate_pass is not None:
        gate_pass_audit(gate_pass, "GATE_PASS_BACK", user, "Back at the gate; waiting for the store to record the return.")


register_arrival_kind("INTERPLANT_DC", resolve_interplant_arrival, interplant_arrived, lambda obj_id: f"/inventory/inter-plant?challan={obj_id}")
register_arrival_kind("JOBWORK_CHALLAN", resolve_jobwork_arrival, jobwork_arrived, None)
register_arrival_kind("GATE_PASS", resolve_gate_pass_arrival, gate_pass_arrived, lambda obj_id: f"/inventory/gate-passes/{obj_id}")


# --------------------------------------------------------------- service
def _arrival_plant(user, plant_id):
    """Watchman: an assigned gate. Office: a factory they hold document rights for."""
    if is_watchman(user) or is_owner(user):
        return get_plant(user, plant_id)
    plant = PermissionService.document_plants(user).filter(id=plant_id).first()
    if plant is None or not PermissionService.has_document_permission(user, "documents.manage"):
        raise PermissionDenied("Recording goods back at the gate is for gate staff and the store.")
    return plant


def _read_reference(data):
    code = str(data.get("code") or "").strip()
    if code:
        kind, object_id = parse_token(code)
    else:
        kind = str(data.get("kind") or "").strip().upper()
        object_id = data.get("object_id")
        if not kind or not object_id:
            raise ValidationError({"code": "Scan the QR on the paper, or choose the paper from the list."})
    if kind not in ARRIVAL_HANDLERS:
        raise ValidationError({"code": "Only inter-plant challans, job-work challans and returnable gate passes come back through this screen."})
    return kind, object_id


def preview_arrival(user, data):
    plant = _arrival_plant(user, data.get("plant"))
    kind, object_id = _read_reference(data)
    snapshot = ARRIVAL_HANDLERS[kind]["resolve"](object_id, plant)
    return {"kind": kind, "kind_label": KIND_LABELS[kind], "id": str(object_id), **{k: snapshot.get(k) for k in ("reference", "party_name", "summary", "status", "warnings", "lines")}}


def _job_order_id(kind, object_id):
    if kind != "JOBWORK_CHALLAN":
        return None
    from apps.inventory.models import JobWorkChallan

    return JobWorkChallan.objects.filter(id=object_id).values_list("order_id", flat=True).first()


def arrival_payload(arrival):
    handler = ARRIVAL_HANDLERS.get(arrival.kind) or {}
    link = handler.get("deep_link")
    order_id = _job_order_id(arrival.kind, arrival.object_id)
    return {
        "id": str(arrival.id),
        "kind": arrival.kind,
        "kind_label": KIND_LABELS.get(arrival.kind, arrival.kind),
        "object_id": str(arrival.object_id),
        "reference": arrival.reference,
        "party_name": arrival.party_name,
        "summary": (arrival.snapshot or {}).get("summary", ""),
        "plant": str(arrival.plant_id),
        "plant_name": arrival.plant.name if arrival.plant_id else "",
        "vehicle_number": arrival.vehicle_number,
        "notes": arrival.notes,
        "arrived_at": iso(arrival.arrived_at),
        "recorded_by": (arrival.created_by.get_full_name() or arrival.created_by.username) if arrival.created_by_id else "",
        "link": f"/inventory/job-work/{order_id}" if order_id else (link(arrival.object_id) if link else ""),
    }


def record_arrival(user, data):
    if not data.get("client_token"):
        raise ValidationError({"client_token": "Missing retry token."})
    plant = _arrival_plant(user, data.get("plant"))
    kind, object_id = _read_reference(data)
    vehicle = str(data.get("vehicle_number") or "").strip().upper()[:40]
    notes = str(data.get("notes") or "").strip()[:500]
    handler = ARRIVAL_HANDLERS[kind]

    def operation():
        snapshot = handler["resolve"](object_id, plant)
        now = timezone.now()
        arrival = GateArrival.objects.create(
            plant=plant, kind=kind, object_id=object_id, reference=str(snapshot.get("reference") or "")[:120],
            party_name=str(snapshot.get("party_name") or "")[:255], snapshot=snapshot, vehicle_number=vehicle,
            notes=notes, arrived_at=now, created_by=user,
        )
        if handler.get("on_arrival"):
            handler["on_arrival"](object_id, now, user)
        GateAuditEvent.objects.create(
            plant_id=plant.id, object_id=arrival.id, object_type="ARRIVAL", action="ARRIVED", actor=user,
            reason="", before={}, after={"kind": kind, "object_id": str(object_id), "reference": arrival.reference, "vehicle": vehicle},
        )
        payload = arrival_payload(arrival)
        publish_document_event(
            event_key=ARRIVAL_EVENT, plant=plant, object_id=arrival.id, object_type="GATE_ARRIVAL",
            title=f"{KIND_LABELS[kind]}: {arrival.reference}",
            message=f"{arrival.party_name} is at the {plant.name} gate{f' on {vehicle}' if vehicle else ''}. Receive it so the stock and the order move on.",
            deep_link=payload["link"] or "/inventory/goods-movements", priority="HIGH",
        )
        return {"arrival": payload}

    with transaction.atomic():
        return idempotent_action(plant, f"gate-arrival:{plant.id}", {**data, "plant": str(plant.id)}, operation)


def arrivals_for(user, *, plant_id=None, limit=50):
    qs = GateArrival.objects.select_related("plant", "created_by")
    if is_watchman(user):
        from .services import scoped_plants

        qs = qs.filter(plant__in=scoped_plants(user), created_by=user, arrived_at__date=timezone.localdate())
    elif not is_owner(user):
        if not PermissionService.has_document_permission(user, "documents.view"):
            raise PermissionDenied("Gate arrivals are for gate staff and the store.")
        qs = qs.filter(plant__in=PermissionService.document_plants(user))
    if plant_id:
        qs = qs.filter(plant_id=plant_id)
    return [arrival_payload(row) for row in qs[: max(1, min(int(limit or 50), 200))]]


def latest_arrival_map(kind, object_ids):
    """{object_id: arrived_at iso} of the newest arrival per record (for the movements register)."""
    rows = GateArrival.objects.filter(kind=kind, object_id__in=list(object_ids)).order_by("object_id", "-arrived_at").values("object_id", "arrived_at")
    out = {}
    for row in rows:
        out.setdefault(str(row["object_id"]), row["arrived_at"])
    return out

