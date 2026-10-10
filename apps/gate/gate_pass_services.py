"""Gate passes (RGP / NRGP): numbered office documents for non-stock items leaving the factory.

Lifecycle
    DRAFT ──issue──▶ ISSUED ──outward photo matched──▶ OUT (RGP) / CLOSED (NRGP)
    OUT ──returns──▶ PARTLY_RETURNED ──returns──▶ RETURNED (closed_at stamped)
    OUT / PARTLY_RETURNED ──short-close (reason)──▶ SHORT_CLOSED
    DRAFT / ISSUED ──cancel (reason)──▶ CANCELLED

A returnable pass (RGP) stays open until every line is returned or the pass is
short-closed with a reason. Returns are append-only events (DB trigger), from a
General Receipt line (workstream B calls ``record_gate_pass_return`` inside its
posting transaction) or from the office "receive back" action. Gate passes
never move production stock.
"""
import re
import uuid
from decimal import Decimal

from django.db import transaction
from django.db.models import Count, F, Q
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from apps.factory.models import Machine, Plant
from apps.inventory.models import Vendor
from apps.users.permission_service import PermissionService
from apps.users.services.bill_notifications import publish_document_event, register_document_event

from .models import GateAuditEvent, GatePass, GatePassLine, GatePassReturn, OutwardDocumentLink
from .numbering import next_document_number
from .outward_registry import NEAR_DEPARTURE, build_snapshot, quantity_text, register_outward_search
from .qr import register_qr_kind
from .services import Conflict, gate_today, gate_zone, idempotent_action

OVERDUE_EVENT = "documents.gate_pass_overdue"
register_document_event(OVERDUE_EVENT, "gatepass.manage")

OPEN_RETURN_STATUSES = {"OUT", "PARTLY_RETURNED"}
OPEN_STATUSES = {"ISSUED", "OUT", "PARTLY_RETURNED"}
DONE_STATUSES = {"RETURNED", "CLOSED", "SHORT_CLOSED", "CANCELLED"}
ALL_STATUSES = {code for code, _ in GatePass._meta.get_field("status").choices}
DRAFT_PREFIX = "DRAFT-"
GATE_OUT_CLOSE_REASON = "Non-returnable pass closed when it left the gate."
KIND_SHORT = {"RETURNABLE": "RGP", "NON_RETURNABLE": "NRGP"}
GSTIN = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")


# --------------------------------------------------------------- permissions
def can_view(user):
    return PermissionService.has_document_permission(user, "documents.view")


def can_manage(user):
    return PermissionService.has_document_permission(user, "gatepass.manage")


def require_view(user):
    if not can_view(user):
        raise PermissionDenied("Gate passes are available to the inventory team, administrators and owners.")


def require_manage(user):
    if not can_manage(user):
        raise PermissionDenied("Only accounts with the gate pass right can create, issue, return or close gate passes.")


def gate_pass_queryset(user):
    require_view(user)
    return (
        GatePass.objects.filter(plant__in=PermissionService.document_plants(user))
        .select_related("plant", "vendor", "created_by", "issued_by", "closed_by")
        .prefetch_related("lines__machine")
    )


def get_gate_pass(user, pk):
    obj = gate_pass_queryset(user).filter(id=pk).first()
    if not obj:
        raise NotFound("This gate pass is unavailable.")
    return obj


# ------------------------------------------------------------------ helpers
def is_draft_number(number):
    return str(number or "").startswith(DRAFT_PREFIX)


def public_number(gate_pass):
    return None if is_draft_number(gate_pass.number) else gate_pass.number


def display_number(gate_pass):
    if is_draft_number(gate_pass.number):
        return f"Draft {str(gate_pass.id)[:8].upper()}"
    return gate_pass.number


def days_overdue(gate_pass, today=None):
    if gate_pass.kind != "RETURNABLE" or gate_pass.status not in OPEN_RETURN_STATUSES or not gate_pass.expected_return_date:
        return 0
    return max(0, ((today or gate_today()) - gate_pass.expected_return_date).days)


def _name(user):
    if not user:
        return ""
    return user.get_full_name() or user.username


def _local(value):
    return value.astimezone(gate_zone()) if value else None


def normalise_vehicle(value):
    return re.sub(r"[^A-Z0-9]", "", str(value or "").upper())[:40]


def gate_pass_snapshot(gate_pass):
    return {
        "number": gate_pass.number,
        "kind": gate_pass.kind,
        "status": gate_pass.status,
        "party_name": gate_pass.party_name,
        "purpose": gate_pass.purpose,
        "expected_return_date": str(gate_pass.expected_return_date) if gate_pass.expected_return_date else None,
        "lines": [
            {"id": str(line.id), "line_no": line.line_no, "description": line.description, "quantity": str(line.quantity), "uom": line.uom, "returned_quantity": str(line.returned_quantity)}
            for line in gate_pass.lines.all()
        ],
    }


def gate_pass_audit(gate_pass, action, actor, reason="", before=None):
    GateAuditEvent.objects.create(plant_id=gate_pass.plant_id, object_id=gate_pass.id, object_type="GATE_PASS", action=action, actor=actor, reason=reason[:500], before=before or {}, after=gate_pass_snapshot(gate_pass))


def line_payload(line):
    outstanding = line.quantity - line.returned_quantity
    return {
        "id": str(line.id),
        "line_no": line.line_no,
        "description": line.description,
        "quantity": quantity_text(line.quantity),
        "uom": line.uom,
        "machine": str(line.machine_id) if line.machine_id else None,
        "machine_name": f"{line.machine.name} ({line.machine.code})" if line.machine_id else "",
        "equipment_text": line.equipment_text,
        "serial_no": line.serial_no,
        "approx_value": str(line.approx_value) if line.approx_value is not None else None,
        "returned_quantity": quantity_text(line.returned_quantity),
        "outstanding_quantity": quantity_text(outstanding if outstanding > 0 else Decimal("0")),
        "remarks": line.remarks,
    }


def allowed_actions(gate_pass, user):
    if not can_manage(user):
        return []
    actions = []
    if gate_pass.status == "DRAFT":
        actions += ["edit", "issue", "cancel"]
    if gate_pass.status == "ISSUED":
        actions += ["cancel"]
    if gate_pass.kind == "RETURNABLE" and gate_pass.status in OPEN_RETURN_STATUSES:
        actions += ["receive_back", "short_close"]
    return actions


def gate_pass_payload(gate_pass, user=None, *, detail=False):
    lines = list(gate_pass.lines.all())
    overdue = days_overdue(gate_pass)
    values = [line.approx_value for line in lines if line.approx_value is not None]
    data = {
        "id": str(gate_pass.id),
        "number": public_number(gate_pass),
        "display_number": display_number(gate_pass),
        "kind": gate_pass.kind,
        "kind_label": gate_pass.get_kind_display(),
        "kind_short": KIND_SHORT[gate_pass.kind],
        "plant": str(gate_pass.plant_id),
        "plant_name": gate_pass.plant.name,
        "vendor": str(gate_pass.vendor_id) if gate_pass.vendor_id else None,
        "vendor_name": gate_pass.vendor.name if gate_pass.vendor_id else "",
        "party_name": gate_pass.party_name,
        "party_address": gate_pass.party_address,
        "party_gstin": gate_pass.party_gstin,
        "purpose": gate_pass.purpose,
        "purpose_label": gate_pass.get_purpose_display(),
        "expected_return_date": str(gate_pass.expected_return_date) if gate_pass.expected_return_date else None,
        "vehicle_number": gate_pass.vehicle_number,
        "carried_by": gate_pass.carried_by,
        "status": gate_pass.status,
        "status_label": gate_pass.get_status_display(),
        "is_overdue": overdue > 0,
        "days_overdue": overdue,
        "notes": gate_pass.notes,
        "created_by_name": _name(gate_pass.created_by),
        "created_at": gate_pass.created_at.isoformat(),
        "issued_by_name": _name(gate_pass.issued_by),
        "issued_at": gate_pass.issued_at.isoformat() if gate_pass.issued_at else None,
        "out_at": gate_pass.out_at.isoformat() if gate_pass.out_at else None,
        "closed_by_name": _name(gate_pass.closed_by),
        "closed_at": gate_pass.closed_at.isoformat() if gate_pass.closed_at else None,
        "close_reason": gate_pass.close_reason,
        "version": gate_pass.version,
        "line_count": len(lines),
        "approx_value_total": str(sum(values, Decimal("0"))) if values else None,
        "lines": [line_payload(line) for line in lines],
        "print_url": f"/api/gate/gate-passes/{gate_pass.id}/print.pdf",
        "actions": allowed_actions(gate_pass, user) if user is not None else [],
    }
    if detail:
        data.update(_detail_extras(gate_pass, user))
    return data


def _detail_extras(gate_pass, user):
    from apps.procurement.models import GeneralReceiptLine

    from .document_pages import serialize_pages

    returns = (
        GatePassReturn.objects.filter(line__gate_pass=gate_pass)
        .select_related("line", "received_by")
        .order_by("returned_at", "id")
    )
    receipt_lines = list(
        GeneralReceiptLine.objects.filter(gate_pass_line__gate_pass=gate_pass)
        .select_related("receipt")
        .order_by("receipt__received_at", "line_no")
    )
    receipt_numbers = {str(row.id): row.receipt.number for row in receipt_lines}
    can_open_outward = PermissionService.has_document_permission(user, "outward.reconcile") if user is not None else False
    links = (
        OutwardDocumentLink.objects.filter(kind="GATE_PASS", object_id=gate_pass.id)
        .select_related("document__created_by")
        .order_by("linked_at", "id")
    )
    outward = []
    for link in links:
        document = link.document
        pages = list(document.pages.defer("data").order_by("page_number"))
        row = {
            "link_id": str(link.id),
            "document_id": str(document.id),
            "departed_at": document.departed_at.isoformat(),
            "vehicle_number": document.vehicle_number,
            "status": document.status,
            "page_count": len(pages),
            "link_source": link.link_source,
            "recorded_by_name": _name(document.created_by),
            "active": link.removed_at is None,
            "removed_reason": link.removed_reason,
            "can_open": can_open_outward,
            "thumb_url": None,
        }
        if can_open_outward and pages:
            row["thumb_url"] = serialize_pages("OUTWARD", pages[:1], lambda page, doc=document: f"/api/gate/outward-documents/{doc.id}/pages/{page.id}/")[0]["thumb_url"]
        outward.append(row)
    timeline = GateAuditEvent.objects.filter(object_type="GATE_PASS", object_id=gate_pass.id).select_related("actor").order_by("created_at", "id")
    return {
        "returns": [
            {
                "id": str(event.id),
                "line_id": str(event.line_id),
                "line_no": event.line.line_no,
                "description": event.line.description,
                "quantity": quantity_text(event.quantity),
                "uom": event.line.uom,
                "returned_at": event.returned_at.isoformat(),
                "received_by_name": _name(event.received_by),
                "notes": event.notes,
                "general_receipt_line_id": str(event.general_receipt_line_id) if event.general_receipt_line_id else None,
                "general_receipt_number": receipt_numbers.get(str(event.general_receipt_line_id), ""),
                "inward_document_id": str(event.inward_document_id) if event.inward_document_id else None,
            }
            for event in returns
        ],
        "general_receipt_lines": [
            {
                "id": str(row.id),
                "receipt_id": str(row.receipt_id),
                "receipt_number": row.receipt.number,
                "receipt_status": row.receipt.status,
                "received_at": row.receipt.received_at.isoformat(),
                "gate_pass_line_id": str(row.gate_pass_line_id),
                "line_no": row.line_no,
                "description": row.description,
                "quantity": quantity_text(row.quantity),
                "uom": row.uom,
            }
            for row in receipt_lines
        ],
        "outward_documents": outward,
        "timeline": [
            {"id": str(event.id), "action": event.action, "actor_name": _name(event.actor) or "System", "reason": event.reason, "created_at": event.created_at.isoformat()}
            for event in timeline
        ],
    }


# --------------------------------------------------------------- validation
def _clean_header(data):
    plant = Plant.objects.filter(id=data["plant"]).first()
    if not plant:
        raise ValidationError({"plant": "Choose a factory."})
    vendor = None
    if data.get("vendor"):
        vendor = Vendor.objects.filter(id=data["vendor"], status="ACTIVE").first()
        if not vendor:
            raise ValidationError({"vendor": "Choose an active vendor, or type the party name instead."})
    party_name = (data.get("party_name") or "").strip() or (vendor.name if vendor else "")
    if not party_name:
        raise ValidationError({"party_name": "Choose a vendor or type who the items go to."})
    gstin = (data.get("party_gstin") or "").strip().upper()
    if gstin and not GSTIN.match(gstin):
        raise ValidationError({"party_gstin": "Enter a valid 15-character GSTIN or leave it blank."})
    if not gstin and vendor:
        # Fall back to the vendor master only when its GSTIN is well formed.
        master = str(vendor.gst_no or "").strip().upper()
        gstin = master if GSTIN.match(master) else ""
    kind = data["kind"]
    expected = data.get("expected_return_date")
    if kind == "RETURNABLE":
        if not expected:
            raise ValidationError({"expected_return_date": "A returnable gate pass needs an expected return date."})
        if expected < gate_today():
            raise ValidationError({"expected_return_date": "The expected return date cannot be in the past."})
        if data["purpose"] == "SCRAP_SALE":
            raise ValidationError({"purpose": "Scrap sale items do not come back. Use a non-returnable gate pass (NRGP)."})
    else:
        expected = None
    return {
        "kind": kind,
        "plant": plant,
        "vendor": vendor,
        "party_name": party_name[:255],
        "party_address": (data.get("party_address") or "").strip() or (vendor.address if vendor else ""),
        "party_gstin": gstin,
        "purpose": data["purpose"],
        "expected_return_date": expected,
        "vehicle_number": normalise_vehicle(data.get("vehicle_number") or ""),
        "carried_by": (data.get("carried_by") or "").strip(),
        "notes": (data.get("notes") or "").strip(),
    }


def _clean_lines(lines, plant):
    machines = {}
    rows = []
    for index, line in enumerate(lines, start=1):
        machine = None
        if line.get("machine"):
            key = str(line["machine"])
            if key not in machines:
                machines[key] = Machine.objects.select_related("work_center").filter(id=line["machine"], work_center__plant=plant).first()
            machine = machines[key]
            if machine is None:
                raise ValidationError({"lines": f"Line {index}: choose a machine of {plant.name}."})
        description = (line.get("description") or "").strip()
        if not description:
            raise ValidationError({"lines": f"Line {index}: describe the item."})
        rows.append({
            "line_no": index,
            "description": description[:255],
            "quantity": line["quantity"],
            "uom": line["uom"],
            "machine": machine,
            "equipment_text": (line.get("equipment_text") or "").strip(),
            "serial_no": (line.get("serial_no") or "").strip(),
            "approx_value": line.get("approx_value"),
            "remarks": (line.get("remarks") or "").strip(),
        })
    if not rows:
        raise ValidationError({"lines": "Add at least one item."})
    return rows


def _replace_lines(gate_pass, rows):
    gate_pass.lines.all().delete()
    GatePassLine.objects.bulk_create([GatePassLine(gate_pass=gate_pass, **row) for row in rows])


def _fresh(gate_pass_id):
    return GatePass.objects.select_related("plant", "vendor", "created_by", "issued_by", "closed_by").prefetch_related("lines__machine").get(id=gate_pass_id)


def _check_version(gate_pass, version):
    if version is not None and int(version) != gate_pass.version:
        raise Conflict("This gate pass was changed by someone else. Reload it and try again.")


# ------------------------------------------------------------------ actions
def create_gate_pass(user, data):
    require_manage(user)
    header = _clean_header(data)
    plant = header["plant"]

    def operation():
        rows = _clean_lines(data["lines"], plant)
        gate_pass = GatePass.objects.create(number=f"{DRAFT_PREFIX}{uuid.uuid4().hex[:24].upper()}", created_by=user, **header)
        _replace_lines(gate_pass, rows)
        gate_pass = _fresh(gate_pass.id)
        gate_pass_audit(gate_pass, "GATE_PASS_DRAFTED", user, "Draft created.")
        return gate_pass_payload(gate_pass, user, detail=True)

    return idempotent_action(plant, f"gatepass:create:{user.id}", data, operation)


def update_gate_pass(user, gate_pass, data):
    require_manage(user)
    header = _clean_header(data)

    def operation():
        current = GatePass.objects.select_for_update().get(id=gate_pass.id)
        if current.status != "DRAFT":
            raise Conflict("Only a draft gate pass can be edited. Cancel it and create a new one instead.")
        _check_version(current, data.get("version"))
        before = gate_pass_snapshot(current)
        rows = _clean_lines(data["lines"], header["plant"])
        for field, value in header.items():
            setattr(current, field, value)
        current.version += 1
        current.save()
        _replace_lines(current, rows)
        current = _fresh(current.id)
        gate_pass_audit(current, "GATE_PASS_EDITED", user, "Draft edited.", before)
        return gate_pass_payload(current, user, detail=True)

    return idempotent_action(gate_pass.plant, f"gatepass:{gate_pass.id}:edit:{user.id}", data, operation)


def issue_gate_pass(user, gate_pass, data):
    require_manage(user)

    def operation():
        current = GatePass.objects.select_for_update().get(id=gate_pass.id)
        if current.status != "DRAFT":
            raise Conflict(f"This gate pass is already {current.get_status_display().lower()}.")
        _check_version(current, data.get("version"))
        if not current.lines.exists():
            raise ValidationError({"lines": "Add at least one item before issuing."})
        if current.kind == "RETURNABLE" and (not current.expected_return_date or current.expected_return_date < gate_today()):
            raise ValidationError({"expected_return_date": "Set an expected return date of today or later before issuing."})
        before = gate_pass_snapshot(current)
        key = KIND_SHORT[current.kind]
        current.number = next_document_number(key, prefix=key, width=4)
        current.status, current.issued_by, current.issued_at = "ISSUED", user, timezone.now()
        current.version += 1
        current.save(update_fields=["number", "status", "issued_by", "issued_at", "version"])
        current = _fresh(current.id)
        gate_pass_audit(current, "GATE_PASS_ISSUED", user, f"Issued as {current.number}.", before)
        return gate_pass_payload(current, user, detail=True)

    return idempotent_action(gate_pass.plant, f"gatepass:{gate_pass.id}:issue:{user.id}", data, operation)


def _close(user, gate_pass, data, *, allowed, status, action, refusal, scope):
    require_manage(user)

    def operation():
        current = GatePass.objects.select_for_update().get(id=gate_pass.id)
        if not allowed(current):
            raise Conflict(refusal(current))
        before = gate_pass_snapshot(current)
        current.status, current.closed_by, current.closed_at, current.close_reason = status, user, timezone.now(), data["reason"]
        current.version += 1
        current.save(update_fields=["status", "closed_by", "closed_at", "close_reason", "version"])
        current = _fresh(current.id)
        gate_pass_audit(current, action, user, data["reason"], before)
        return gate_pass_payload(current, user, detail=True)

    return idempotent_action(gate_pass.plant, f"gatepass:{gate_pass.id}:{scope}:{user.id}", data, operation)


def cancel_gate_pass(user, gate_pass, data):
    return _close(
        user, gate_pass, data, status="CANCELLED", action="GATE_PASS_CANCELLED", scope="cancel",
        allowed=lambda current: current.status in {"DRAFT", "ISSUED"},
        refusal=lambda current: f"A gate pass that is {current.get_status_display().lower()} cannot be cancelled.",
    )


def short_close_gate_pass(user, gate_pass, data):
    return _close(
        user, gate_pass, data, status="SHORT_CLOSED", action="GATE_PASS_SHORT_CLOSED", scope="short-close",
        allowed=lambda current: current.kind == "RETURNABLE" and current.status in OPEN_RETURN_STATUSES,
        refusal=lambda current: "Only a returnable gate pass with items still out can be short-closed.",
    )


def receive_back(user, gate_pass, data):
    """Office records items that came back without a supplier bill."""
    require_manage(user)
    ids = [str(row["line_id"]) for row in data["lines"]]
    if len(ids) != len(set(ids)):
        raise ValidationError({"lines": "Choose each line once."})

    def operation():
        current = GatePass.objects.select_for_update().get(id=gate_pass.id)
        known = {str(pk) for pk in current.lines.values_list("id", flat=True)}
        if not set(ids) <= known:
            raise ValidationError({"lines": "Choose lines of this gate pass."})
        for row in data["lines"]:
            record_gate_pass_return(user, line_id=row["line_id"], quantity=row["quantity"], notes=data["reason"])
        return gate_pass_payload(_fresh(current.id), user, detail=True)

    return idempotent_action(gate_pass.plant, f"gatepass:{gate_pass.id}:receive:{user.id}", data, operation)


def _refresh_return_status(gate_pass, user):
    lines = list(gate_pass.lines.all())
    if all(line.returned_quantity >= line.quantity for line in lines):
        gate_pass.status = "RETURNED"
        gate_pass.closed_at = gate_pass.closed_at or timezone.now()
        gate_pass.closed_by = gate_pass.closed_by or user
    elif any(line.returned_quantity > 0 for line in lines):
        gate_pass.status = "PARTLY_RETURNED"


def record_gate_pass_return(user, *, line_id, quantity, general_receipt_line_id=None, inward_document_id=None, notes=""):
    """Record that ``quantity`` of an RGP line came back.

    Must run inside the caller's transaction (e.g. a General Receipt posting) so
    the receipt line and the return commit together. Locks the pass, refuses
    over-returns and non-returnable / not-yet-out passes, appends a
    GatePassReturn event, updates returned quantity and pass status, and audits.
    """
    if not transaction.get_connection().in_atomic_block:
        raise RuntimeError("record_gate_pass_return must run inside the receipt transaction.")
    quantity = Decimal(str(quantity))
    if quantity <= 0:
        raise ValidationError({"quantity": "Returned quantity must be positive."})
    line = GatePassLine.objects.select_related("gate_pass").filter(id=line_id).first()
    if not line:
        raise NotFound("This gate pass line is unavailable.")
    gate_pass = GatePass.objects.select_for_update().get(id=line.gate_pass_id)
    line = GatePassLine.objects.select_for_update().get(id=line.id)
    if gate_pass.kind != "RETURNABLE":
        raise ValidationError({"gate_pass_line": "Only returnable gate passes (RGP) can be received back."})
    if gate_pass.status not in OPEN_RETURN_STATUSES:
        raise Conflict(f"Gate pass {display_number(gate_pass)} is {gate_pass.get_status_display().lower()}; it cannot receive returns.")
    outstanding = line.quantity - line.returned_quantity
    if quantity > outstanding:
        raise ValidationError({"quantity": f"Only {quantity_text(outstanding)} {line.uom} of line {line.line_no} is still out on {gate_pass.number}."})
    before = gate_pass_snapshot(gate_pass)
    event = GatePassReturn.objects.create(line=line, quantity=quantity, received_by=user, general_receipt_line_id=general_receipt_line_id, inward_document_id=inward_document_id, notes=notes[:500])
    line.returned_quantity = line.returned_quantity + quantity
    line.save(update_fields=["returned_quantity"])
    _refresh_return_status(gate_pass, user)
    gate_pass.version += 1
    gate_pass.save(update_fields=["status", "closed_at", "closed_by", "version"])
    gate_pass_audit(gate_pass, "GATE_PASS_RETURNED", user, f"{quantity_text(quantity)} {line.uom} of line {line.line_no} returned.", before)
    return event


# ---------------------------------------------------- gate-out (outward QR)
def _gate_pass_lines(gate_pass):
    rows = []
    for line in gate_pass.lines.all():
        what = line.description
        if line.machine_id:
            what += f" · {line.machine.name}"
        elif line.equipment_text:
            what += f" · {line.equipment_text}"
        rows.append({"description": what, "quantity": line.quantity, "uom": line.uom})
    return rows


def _gate_pass_link_snapshot(gate_pass):
    warnings = []
    if gate_pass.status in {"OUT", "CLOSED"} and gate_pass.out_at:
        warnings.append(f"Already recorded leaving the gate on {_local(gate_pass.out_at):%d %b %Y, %I:%M %p}.")
    lines = _gate_pass_lines(gate_pass)
    summary = f"{KIND_SHORT[gate_pass.kind]} · {len(lines)} item{'' if len(lines) == 1 else 's'}"
    if gate_pass.kind == "RETURNABLE" and gate_pass.expected_return_date:
        summary += f" · back by {gate_pass.expected_return_date:%d %b}"
    return build_snapshot(
        kind="GATE_PASS", obj_id=gate_pass.id, reference=gate_pass.number, party_name=gate_pass.party_name,
        plant=gate_pass.plant, status=gate_pass.status, document_date=gate_pass.issued_at, lines=lines,
        summary=summary, warnings=warnings,
    )


def _closed_at_gate(gate_pass):
    return gate_pass.kind == "NON_RETURNABLE" and gate_pass.status == "CLOSED" and gate_pass.close_reason == GATE_OUT_CLOSE_REASON


def resolve_gate_pass(object_id, plant):
    gate_pass = GatePass.objects.select_related("plant").prefetch_related("lines__machine").filter(id=object_id).first()
    if not gate_pass:
        raise ValidationError({"code": "This gate pass is not in the ERP."})
    if gate_pass.plant_id != plant.id:
        raise ValidationError({"code": "This gate pass belongs to another factory. It cannot be matched at this gate."})
    number = display_number(gate_pass)
    if gate_pass.status == "DRAFT":
        raise ValidationError({"code": "This gate pass is still a draft. Ask the office to issue it before the items leave."})
    if gate_pass.status == "CANCELLED":
        raise ValidationError({"code": f"Gate pass {number} is cancelled. The items must not leave on it."})
    if gate_pass.status in {"PARTLY_RETURNED", "RETURNED", "SHORT_CLOSED"} or (gate_pass.status == "CLOSED" and not _closed_at_gate(gate_pass)):
        raise ValidationError({"code": f"Gate pass {number} is {gate_pass.get_status_display().lower()}. Items cannot leave on it again; ask the office for a new gate pass."})
    return _gate_pass_link_snapshot(gate_pass)


def mark_gate_pass_out(object_id, departed_at, user):
    """on_gate_out hook: the first matched departure sets the pass OUT (NRGP: CLOSED)."""
    gate_pass = GatePass.objects.select_for_update().get(id=object_id)
    if gate_pass.status != "ISSUED":
        return False
    before = gate_pass_snapshot(gate_pass)
    gate_pass.out_at = departed_at
    fields = ["out_at", "status", "version"]
    if gate_pass.kind == "NON_RETURNABLE":
        gate_pass.status, gate_pass.closed_at, gate_pass.closed_by, gate_pass.close_reason = "CLOSED", departed_at, user, GATE_OUT_CLOSE_REASON
        fields += ["closed_at", "closed_by", "close_reason"]
    else:
        gate_pass.status = "OUT"
    gate_pass.version += 1
    gate_pass.save(update_fields=fields)
    gate_pass_audit(gate_pass, "GATE_PASS_OUT", user, "Left the gate; outward photo matched.", before)
    return True


def revert_gate_out(gate_pass_id, user, reason):
    """Undo the gate-out of a pass when its only departure link was removed.

    Leaves the pass unchanged when another active departure still carries it
    or any return was already recorded (the items evidently left)."""
    gate_pass = GatePass.objects.select_for_update().filter(id=gate_pass_id).first()
    if gate_pass is None:
        return False
    if OutwardDocumentLink.objects.filter(kind="GATE_PASS", object_id=gate_pass.id, removed_at__isnull=True).exclude(document__status="VOID").exists():
        return False
    if GatePassReturn.objects.filter(line__gate_pass=gate_pass).exists():
        return False
    if not (gate_pass.status == "OUT" or _closed_at_gate(gate_pass)):
        return False
    before = gate_pass_snapshot(gate_pass)
    fields = ["status", "out_at", "version"]
    if gate_pass.kind == "NON_RETURNABLE":
        gate_pass.closed_at, gate_pass.closed_by, gate_pass.close_reason = None, None, ""
        fields += ["closed_at", "closed_by", "close_reason"]
    gate_pass.status, gate_pass.out_at = "ISSUED", None
    gate_pass.version += 1
    gate_pass.save(update_fields=fields)
    gate_pass_audit(gate_pass, "GATE_PASS_OUT_REVERSED", user, reason, before)
    return True


def search_gate_pass(plant, query, *, around=None, limit=10):
    qs = (
        GatePass.objects.filter(plant=plant)
        .filter(Q(status__in=["ISSUED", "OUT"]) | Q(kind="NON_RETURNABLE", status="CLOSED", close_reason=GATE_OUT_CLOSE_REASON))
        .select_related("plant").prefetch_related("lines__machine")
    )
    if query:
        qs = qs.filter(Q(number__icontains=query) | Q(party_name__icontains=query) | Q(vehicle_number__icontains=query) | Q(carried_by__icontains=query))
    elif around is not None:
        qs = qs.filter(issued_at__gte=around - NEAR_DEPARTURE * 4, issued_at__lte=around + NEAR_DEPARTURE)
    return [_gate_pass_link_snapshot(obj) for obj in qs.order_by("-issued_at")[:limit]]


register_qr_kind("GATE_PASS", resolve_gate_pass, on_gate_out=mark_gate_pass_out)
register_outward_search("GATE_PASS", search_gate_pass)


# ------------------------------------------------------------- list & picker
def _uuid(value, name):
    try:
        return uuid.UUID(str(value))
    except ValueError:
        raise ValidationError({name: "Use a valid reference."})


def filter_gate_passes(source, params):
    """Apply list filters; returns (queryset, counts per tab)."""
    today = gate_today()
    kind = params.get("kind")
    if kind:
        if kind not in KIND_SHORT:
            raise ValidationError({"kind": "Choose RETURNABLE or NON_RETURNABLE."})
        source = source.filter(kind=kind)
    if params.get("plant"):
        source = source.filter(plant_id=_uuid(params["plant"], "plant"))
    if params.get("vendor"):
        source = source.filter(vendor_id=_uuid(params["vendor"], "vendor"))
    if params.get("machine"):
        source = source.filter(id__in=GatePassLine.objects.filter(machine_id=_uuid(params["machine"], "machine")).values("gate_pass_id"))
    search = str(params.get("search") or "").strip()[:100]
    if search:
        source = source.filter(
            Q(number__icontains=search) | Q(party_name__icontains=search) | Q(vehicle_number__icontains=search) | Q(carried_by__icontains=search)
            | Q(id__in=GatePassLine.objects.filter(Q(description__icontains=search) | Q(serial_no__icontains=search) | Q(equipment_text__icontains=search) | Q(machine__name__icontains=search)).values("gate_pass_id"))
        )
    counts = source.aggregate(
        OPEN=Count("id", filter=Q(status__in=OPEN_STATUSES)),
        OVERDUE=Count("id", filter=Q(kind="RETURNABLE", status__in=OPEN_RETURN_STATUSES, expected_return_date__lt=today)),
        DONE=Count("id", filter=Q(status__in=DONE_STATUSES)),
        DRAFT=Count("id", filter=Q(status="DRAFT")),
        ALL=Count("id"),
    )
    status = params.get("status") or "ALL"
    if status == "OPEN":
        source = source.filter(status__in=OPEN_STATUSES).order_by(F("expected_return_date").asc(nulls_last=True), "created_at")
    elif status == "OVERDUE":
        source = source.filter(kind="RETURNABLE", status__in=OPEN_RETURN_STATUSES, expected_return_date__lt=today).order_by("expected_return_date", "created_at")
    elif status == "DONE":
        source = source.filter(status__in=DONE_STATUSES).order_by(F("closed_at").desc(nulls_last=True), "-created_at")
    elif status in ALL_STATUSES:
        source = source.filter(status=status)
    elif status != "ALL":
        raise ValidationError({"status": "Choose a valid gate pass status."})
    return source, counts


def open_lines(user, *, vendor=None, party="", plant=None):
    """Outstanding RGP lines for the General Receipt return picker (workstream B)."""
    require_view(user)
    qs = GatePassLine.objects.select_related("gate_pass__plant", "machine").filter(
        gate_pass__kind="RETURNABLE", gate_pass__status__in=OPEN_RETURN_STATUSES, returned_quantity__lt=F("quantity"),
        gate_pass__plant__in=PermissionService.document_plants(user),
    )
    if plant:
        qs = qs.filter(gate_pass__plant_id=plant)
    who = Q()
    if vendor:
        who |= Q(gate_pass__vendor_id=vendor)
    party = str(party or "").strip()[:100]
    if party:
        who |= Q(gate_pass__party_name__icontains=party)
    if vendor or party:
        qs = qs.filter(who)
    rows = []
    for line in qs.order_by("gate_pass__expected_return_date", "gate_pass__number", "line_no")[:200]:
        gate_pass = line.gate_pass
        rows.append({
            "line_id": str(line.id),
            "gate_pass_id": str(gate_pass.id),
            "gate_pass_number": gate_pass.number,
            "line_no": line.line_no,
            "description": line.description,
            "uom": line.uom,
            "outstanding_quantity": quantity_text(line.quantity - line.returned_quantity),
            "machine_name": f"{line.machine.name} ({line.machine.code})" if line.machine_id else "",
            "expected_return_date": str(gate_pass.expected_return_date) if gate_pass.expected_return_date else None,
            "quantity": quantity_text(line.quantity),
            "returned_quantity": quantity_text(line.returned_quantity),
            "machine_id": str(line.machine_id) if line.machine_id else None,
            "equipment_text": line.equipment_text,
            "serial_no": line.serial_no,
            "party_name": gate_pass.party_name,
            "vendor_id": str(gate_pass.vendor_id) if gate_pass.vendor_id else None,
            "plant": str(gate_pass.plant_id),
            "plant_name": gate_pass.plant.name,
        })
    return rows


def form_options(user, *, plant=None, query=""):
    from apps.procurement.models import GENERAL_UOMS

    from .models import GATE_PASS_KINDS, GATE_PASS_PURPOSES

    require_view(user)
    plants = PermissionService.document_plants(user).order_by("name")
    query = str(query or "").strip()[:100]
    vendors = Vendor.objects.filter(status="ACTIVE")
    if query:
        vendors = vendors.filter(Q(name__icontains=query) | Q(code__icontains=query))
    machines = Machine.objects.select_related("work_center__plant").filter(work_center__plant__in=plants)
    if plant:
        machines = machines.filter(work_center__plant_id=plant)
    return {
        "plants": [{"id": str(row.id), "name": row.name, "code": row.code} for row in plants],
        "vendors": [{"id": str(row.id), "name": row.name, "code": row.code, "address": row.address, "gstin": row.gst_no} for row in vendors.order_by("name")[:50]],
        "machines": [
            {"id": str(row.id), "name": row.name, "code": row.code, "status": row.status, "work_center": row.work_center.name, "plant": str(row.work_center.plant_id)}
            for row in machines.order_by("work_center__plant__name", "name")[:500]
        ],
        "uoms": list(GENERAL_UOMS),
        "kinds": [{"value": code, "label": label} for code, label in GATE_PASS_KINDS],
        "purposes": [{"value": code, "label": label} for code, label in GATE_PASS_PURPOSES],
    }


# ---------------------------------------------------------- overdue alerts
def overdue_threshold(days):
    """Reminder step for ``days`` past the expected return date: 0 (due), 3, 7, then weekly."""
    if days < 0:
        return None
    if days < 3:
        return 0
    if days < 7:
        return 3
    return 7 * (days // 7)


def run_gate_pass_overdue_reminders(today=None):
    """Daily: alert gate-pass managers about RGPs due back or past due.

    One notification per pass per step (due date, +3, +7, then every 7 days)
    per account holding gatepass.manage; re-running the same day is a no-op.
    """
    today = today or gate_today()
    due = (
        GatePass.objects.filter(kind="RETURNABLE", status__in=OPEN_RETURN_STATUSES, expected_return_date__lte=today)
        .select_related("plant").prefetch_related("lines").order_by("expected_return_date", "number")
    )
    checked = sent = 0
    for gate_pass in due:
        checked += 1
        days = (today - gate_pass.expected_return_date).days
        step = overdue_threshold(days)
        outstanding = [line for line in gate_pass.lines.all() if line.returned_quantity < line.quantity]
        items = ", ".join(f"{quantity_text(line.quantity - line.returned_quantity)} {line.uom} {line.description}" for line in outstanding[:3])
        if len(outstanding) > 3:
            items += f" and {len(outstanding) - 3} more"
        title = f"{gate_pass.number} is due back today" if days == 0 else f"{gate_pass.number} is {days} day{'' if days == 1 else 's'} overdue"
        message = f"{gate_pass.party_name} still has {items or 'items'} from {gate_pass.plant.name}. Expected back {gate_pass.expected_return_date:%d %b %Y}."
        with transaction.atomic():
            sent += publish_document_event(
                event_key=OVERDUE_EVENT, plant=gate_pass.plant, object_id=gate_pass.id, object_type="GatePass",
                title=title, message=message, deep_link=f"/inventory/gate-passes/{gate_pass.id}",
                priority="HIGH" if days >= 7 else "NORMAL", dedupe_suffix=f"overdue-step-{step}",
            )
    return {"checked": checked, "notifications": sent, "date": str(today)}
