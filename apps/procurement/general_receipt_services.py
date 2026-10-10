"""General Receipts: "received / done by whom, when" for non-stock goods and services.

A General Receipt records spares, machinery, tools, consumables, services and
charges against a bill (or before the bill arrives). It never writes stock
tables; production stock stays owned by the GRN services. Each line may say
whether the item was kept in store, installed on a machine or used at once,
and may close a returnable gate pass line when a repaired part comes back.
"""
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import Count, Prefetch, Q, Sum
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from apps.factory.models import Machine, Plant
from apps.gate.bill_services import (
    OPEN_STATUSES, RECORD_ONLY_CATEGORIES, _refuse_duplicates, attach_receipt_to_bill, bill_audit, bill_queryset, bill_ref, bill_safe_snapshot,
    can_manage_documents, can_view_documents, is_document_master, normalise_party, reader_plants, register_receipt_kind,
)
from apps.gate.models import DOCUMENT_CATEGORIES, GateAuditEvent, GatePassLine, GatePassReturn, InwardBillIntake
from apps.gate.numbering import next_document_number
from apps.gate.services import Conflict, fingerprint, idempotent_action
from apps.inventory.models import Vendor
from apps.procurement.models import GENERAL_LINE_CATEGORIES, GENERAL_LINE_DISPOSITIONS, GENERAL_RECEIPT_TYPES, GENERAL_UOMS, GeneralReceipt, GeneralReceiptLine

KIND = "GENERAL_RECEIPT"
GATE_ARRIVAL_WINDOW = timedelta(hours=24)
OFFICE_UPLOAD_WINDOW = timedelta(days=60)
CLOCK_SKEW = timedelta(minutes=2)
LINE_CATEGORY_LABELS = dict(GENERAL_LINE_CATEGORIES)
DISPOSITION_LABELS = dict(GENERAL_LINE_DISPOSITIONS)
RECEIPT_TYPE_LABELS = dict(GENERAL_RECEIPT_TYPES)
DOCUMENT_CATEGORY_LABELS = dict(DOCUMENT_CATEGORIES)


# ── permissions ─────────────────────────────────────────────────────────────

def require_view(user):
    if not can_view_documents(user):
        raise PermissionDenied("General receipts are available to Inventory and accounts granted the documents view right.")


def require_manage(user):
    if not can_manage_documents(user):
        raise PermissionDenied("Recording a General Receipt needs the documents manage right (Inventory by default).")


# ── shared rules ────────────────────────────────────────────────────────────

def earliest_receipt_time(bill):
    """GATE bills: up to 24 h before arrival. OFFICE uploads: up to 60 days before the upload."""
    return bill.arrival_at - (OFFICE_UPLOAD_WINDOW if bill.source == "OFFICE" else GATE_ARRIVAL_WINDOW)


def check_receipt_time(bill, received_at, field="received_at"):
    if received_at > timezone.now() + CLOCK_SKEW:
        raise ValidationError({field: "Received time cannot be in the future."})
    if bill is not None and received_at < earliest_receipt_time(bill):
        window = "60 days before it was uploaded" if bill.source == "OFFICE" else "24 hours before it arrived at the gate"
        raise ValidationError({field: f"Received time must be no earlier than {window} (bill {bill_ref(bill.id)})."})


def bill_plants(bill):
    return {bill.plant_id} | ({bill.ship_to_plant_id} if bill.ship_to_plant_id else set())


def derived_category(receipt_type, lines):
    if receipt_type == "SERVICE":
        return "SERVICE"
    return "MACHINERY" if any(line["line_category"] == "MACHINERY" for line in lines) else "SPARES"


def quantities_by_uom(lines):
    totals = {}
    for line in lines:
        totals[line.uom] = totals.get(line.uom, Decimal("0")) + line.quantity
    return totals


# ── bill receipt kind ───────────────────────────────────────────────────────

def receipt_snapshot(bill, pk, lock=False):
    """Snapshot with the same keys as stock receipts, enforcing plant and time rules."""
    qs = GeneralReceipt.objects.select_for_update() if lock else GeneralReceipt.objects
    receipt = qs.filter(id=pk).first()
    if not receipt:
        raise ValidationError("This General Receipt is unavailable.")
    if receipt.status != "POSTED":
        raise ValidationError("A reversed General Receipt cannot be linked to a bill.")
    if receipt.plant_id not in bill_plants(bill):
        raise ValidationError("A General Receipt must be at the bill's factory or its ship-to factory.")
    check_receipt_time(bill, receipt.received_at, field="receipt_refs")
    lines = list(receipt.lines.all())
    totals = quantities_by_uom(lines)
    single = len(totals) == 1
    vendor = Vendor.objects.filter(id=receipt.vendor_id).first() if receipt.vendor_id else None
    return {
        "kind": KIND, "id": str(receipt.id), "reference": receipt.number, "invoice_number": receipt.invoice_number or "",
        "vendor_id": str(receipt.vendor_id) if receipt.vendor_id else None, "vendor_name": vendor.name if vendor else receipt.party_name,
        "plant": str(receipt.plant_id), "received_at": receipt.received_at.isoformat(),
        "quantity": str(next(iter(totals.values()))) if single else None, "quantities_by_uom": {uom: str(qty) for uom, qty in totals.items()},
        "uom": next(iter(totals)) if single else "MIXED", "quality_status": "POSTED",
    }


def receipt_is_linked(pk):
    return GeneralReceipt.objects.filter(id=pk, document__isnull=False).exists()


def on_receipt_linked(bill, pk, user):
    GeneralReceipt.objects.filter(id=pk).update(document=bill)


def receipt_link_candidates(bill, search="", vendor_id=None):
    qs = GeneralReceipt.objects.filter(status="POSTED", document__isnull=True, plant_id__in=bill_plants(bill), received_at__gte=earliest_receipt_time(bill))
    if search:
        qs = qs.filter(Q(number__icontains=search) | Q(invoice_number__icontains=search) | Q(party_name__icontains=search))
    if vendor_id:
        qs = qs.filter(vendor_id=vendor_id)
    rows = []
    for receipt in qs.order_by("-received_at")[:50]:
        try:
            rows.append(receipt_snapshot(bill, receipt.id))
        except ValidationError:
            continue
    return rows


register_receipt_kind(KIND, receipt_snapshot, receipt_is_linked, on_linked=on_receipt_linked, candidates=receipt_link_candidates)


# ── payloads ────────────────────────────────────────────────────────────────

def receipt_queryset():
    return GeneralReceipt.objects.select_related("plant", "vendor", "document", "document__vendor", "received_by", "created_by", "reversed_by").prefetch_related(
        Prefetch("lines", queryset=GeneralReceiptLine.objects.select_related("machine", "machine__work_center__plant", "gate_pass_line", "gate_pass_line__gate_pass").order_by("line_no")),
    )


def user_label(user):
    if not user:
        return None
    full = (user.get_full_name() or "").strip()
    return full or user.username


def _returns_map(line_ids):
    rows = {}
    for event in GatePassReturn.objects.filter(general_receipt_line_id__in=line_ids):
        rows.setdefault(str(event.general_receipt_line_id), Decimal("0"))
        rows[str(event.general_receipt_line_id)] += event.quantity
    return rows


def line_payload(line, returned):
    gst = (line.amount * line.gst_rate / Decimal("100")).quantize(Decimal("0.01")) if line.amount is not None and line.gst_rate is not None else None
    machine = line.machine
    gpl = line.gate_pass_line
    return {
        "id": str(line.id), "line_no": line.line_no, "line_category": line.line_category, "line_category_label": LINE_CATEGORY_LABELS.get(line.line_category, line.line_category),
        "description": line.description, "quantity": str(line.quantity), "uom": line.uom, "rate": str(line.rate) if line.rate is not None else None,
        "amount": str(line.amount) if line.amount is not None else None, "gst_rate": str(line.gst_rate) if line.gst_rate is not None else None,
        "gst_amount": str(gst) if gst is not None else None, "disposition": line.disposition, "disposition_label": DISPOSITION_LABELS.get(line.disposition, line.disposition),
        "machine": {"id": str(machine.id), "name": machine.name, "code": machine.code, "plant_name": machine.work_center.plant.name} if machine else None,
        "equipment_text": line.equipment_text, "serial_no": line.serial_no, "remarks": line.remarks,
        "gate_pass_line": {"id": str(gpl.id), "gate_pass_id": str(gpl.gate_pass_id), "gate_pass_number": gpl.gate_pass.number, "line_no": gpl.line_no, "description": gpl.description} if gpl else None,
        "returned_quantity": str(returned) if returned is not None else None,
    }


def receipt_payload(receipt, user=None, returns=None):
    lines = list(receipt.lines.all())
    if returns is None:
        returns = _returns_map([line.id for line in lines])
    amount = sum((line.amount for line in lines if line.amount is not None), Decimal("0"))
    gst = sum(((line.amount * line.gst_rate / Decimal("100")) for line in lines if line.amount is not None and line.gst_rate is not None), Decimal("0")).quantize(Decimal("0.01"))
    document = receipt.document
    has_returns = any(str(line.id) in returns for line in lines)
    return {
        "id": str(receipt.id), "number": receipt.number, "plant": str(receipt.plant_id), "plant_name": receipt.plant.name,
        "document": {
            "id": str(document.id), "ref": bill_ref(document.id), "status": document.status, "category": document.category,
            "party_display": document.vendor.name if document.vendor_id else document.party_name, "invoice_number": document.invoice_number,
            "followup": document.status == "VOID" and document.resolution_code == "NON_STOCK",
        } if document else None,
        "vendor": str(receipt.vendor_id) if receipt.vendor_id else None, "vendor_name": receipt.vendor.name if receipt.vendor_id else None,
        "vendor_code": receipt.vendor.code if receipt.vendor_id else None, "party_name": receipt.party_name,
        "invoice_number": receipt.invoice_number, "invoice_date": receipt.invoice_date.isoformat() if receipt.invoice_date else None,
        "receipt_type": receipt.receipt_type, "receipt_type_label": RECEIPT_TYPE_LABELS.get(receipt.receipt_type, receipt.receipt_type),
        "received_at": receipt.received_at.isoformat(), "received_by": str(receipt.received_by_id), "received_by_name": user_label(receipt.received_by),
        "reference": receipt.reference, "notes": receipt.notes, "status": receipt.status,
        "reversed_at": receipt.reversed_at.isoformat() if receipt.reversed_at else None, "reversed_by_name": user_label(receipt.reversed_by),
        "reversal_reason": receipt.reversal_reason, "created_by_name": user_label(receipt.created_by), "created_at": receipt.created_at.isoformat(),
        "line_count": len(lines), "amount": str(amount.quantize(Decimal("0.01"))), "gst_amount": str(gst), "total_with_gst": str((amount + gst).quantize(Decimal("0.01"))),
        "machines": sorted({line.machine.name for line in lines if line.machine_id}),
        "lines": [line_payload(line, returns.get(str(line.id))) for line in lines],
        "has_gate_pass_returns": has_returns,
        "can_reverse": bool(user) and is_document_master(user) and receipt.status == "POSTED" and not has_returns,
    }


def receipt_audit(receipt, action, actor, reason="", before=None):
    after = receipt_payload(receipt_queryset().get(id=receipt.id))
    after.pop("can_reverse", None)
    GateAuditEvent.objects.create(plant_id=receipt.plant_id, object_id=receipt.id, object_type="GEN_RECEIPT", action=action, actor=actor, reason=reason[:500], before=before or {}, after=after)


# ── create ──────────────────────────────────────────────────────────────────

def _locked_bill(user, bill_id, field):
    if not bill_queryset(user).filter(id=bill_id).exists():
        raise ValidationError({field: "That bill is unavailable."})
    # Lock only the bill row (never the joined plant) so plant-scoped retries cannot deadlock with it.
    return InwardBillIntake.objects.select_for_update(of=("self",)).select_related("plant", "ship_to_plant", "vendor").get(id=bill_id)


def _replay(existing, digest, user):
    if existing.request_fingerprint != digest:
        raise Conflict("This retry token belongs to a different General Receipt. Start a new receipt.")
    return {**receipt_payload(receipt_queryset().get(id=existing.id), user), "replayed": True}


def create_general_receipt(user, data):
    """Create a General Receipt idempotently (request_key + fingerprint). Returns (payload, created)."""
    require_manage(user)
    key = f"gr:{user.id}:{data['client_token']}"
    digest = fingerprint({name: value for name, value in data.items() if name != "client_token"})
    existing = GeneralReceipt.objects.filter(request_key=key).first()
    if existing:
        return _replay(existing, digest, user), False
    try:
        with transaction.atomic():
            receipt = _create(user, data, key, digest)
    except IntegrityError:
        existing = GeneralReceipt.objects.filter(request_key=key).first()
        if existing is None:
            raise Conflict("This receipt conflicts with another record saved at the same time. Refresh and try again.") from None
        return _replay(existing, digest, user), False
    return {**receipt_payload(receipt_queryset().get(id=receipt.id), user), "replayed": False}, True


def _create(user, data, key, digest):
    plant = reader_plants(user).filter(id=data["plant"]).first()
    if not plant:
        raise ValidationError({"plant": "Choose a factory you can record receipts for."})
    bill = followup = None
    if data.get("document"):
        bill = _locked_bill(user, data["document"], "document")
        if bill.status not in OPEN_STATUSES:
            raise Conflict(f"Bill {bill_ref(bill.id)} is already {bill.get_status_display().lower()}. Open a bill that is still waiting for receipt.")
        if bill.category in RECORD_ONLY_CATEGORIES:
            raise ValidationError({"document": f"Bill {bill_ref(bill.id)} is classified as {DOCUMENT_CATEGORY_LABELS[bill.category].lower()}, which is filed rather than received. Change its category first."})
    if data.get("followup_of_bill"):
        followup = _locked_bill(user, data["followup_of_bill"], "followup_of_bill")
        if followup.status != "VOID" or followup.resolution_code != "NON_STOCK":
            raise ValidationError({"followup_of_bill": "Only a bill voided earlier as non-stock can be followed up with a General Receipt."})
        previous = GeneralReceipt.objects.filter(document=followup, status="POSTED").first()
        if previous:
            raise Conflict(f"Bill {bill_ref(followup.id)} is already followed up by {previous.number}.")
    source_bill = bill or followup
    if source_bill is not None and plant.id not in bill_plants(source_bill):
        names = source_bill.plant.name + (f" or its ship-to factory {source_bill.ship_to_plant.name}" if source_bill.ship_to_plant_id else "")
        raise ValidationError({"plant": f"Record this receipt at the bill's factory ({names})."})
    if bill is not None:
        _refuse_duplicates(bill, (data.get("duplicate_override_reason") or "").strip())

    vendor = None
    if data.get("vendor"):
        vendor = Vendor.objects.filter(id=data["vendor"], status="ACTIVE").first()
        if not vendor:
            raise ValidationError({"vendor": "Choose an active vendor from the master list."})
    party_name = normalise_party(data.get("party_name"))
    if vendor and party_name and party_name.lower() != vendor.name.lower():
        raise ValidationError({"party_name": "Choose a master vendor or type the party name, not both."})
    if source_bill is not None and not vendor and not party_name:
        vendor = source_bill.vendor if source_bill.vendor_id else None
        party_name = source_bill.party_name
    if not vendor and not party_name:
        raise ValidationError({"vendor": "Choose the vendor or type the party name."})
    invoice_number = " ".join(str(data["invoice_number"]).split()) if "invoice_number" in data else (source_bill.invoice_number if source_bill else "")
    invoice_date = data["invoice_date"] if "invoice_date" in data else (source_bill.invoice_date if source_bill else None)

    User = get_user_model()
    received_by = user
    if data.get("received_by"):
        received_by = User.objects.filter(id=data["received_by"], is_active=True).first()
        if not received_by:
            raise ValidationError({"received_by": "Choose an active user who received the goods or confirmed the work."})
    check_receipt_time(source_bill, data["received_at"])

    allowed_machine_plants = {plant.id} | ({source_bill.ship_to_plant_id} if source_bill is not None and source_bill.ship_to_plant_id else set())
    machine_ids = {line["machine"] for line in data["lines"] if line.get("machine")}
    machines = {machine.id: machine for machine in Machine.objects.select_related("work_center__plant").filter(id__in=machine_ids)}
    gate_ids = {line["gate_pass_line"] for line in data["lines"] if line.get("gate_pass_line")}
    gate_lines = {row.id: row for row in GatePassLine.objects.select_related("gate_pass").filter(id__in=gate_ids)}
    errors = {}
    for index, line in enumerate(data["lines"], start=1):
        machine = machines.get(line.get("machine")) if line.get("machine") else None
        if line.get("machine") and machine is None:
            errors[f"lines[{index}].machine"] = f"Line {index}: this machine is not in the machine master."
        elif machine is not None and machine.work_center.plant_id not in allowed_machine_plants:
            errors[f"lines[{index}].machine"] = f"Line {index}: {machine.name} belongs to {machine.work_center.plant.name}, not the receiving factory."
        if line.get("gate_pass_line"):
            gate_line = gate_lines.get(line["gate_pass_line"])
            if gate_line is None:
                errors[f"lines[{index}].gate_pass_line"] = f"Line {index}: this gate pass line is unavailable."
            elif gate_line.gate_pass.plant_id != plant.id:
                errors[f"lines[{index}].gate_pass_line"] = f"Line {index}: gate pass {gate_line.gate_pass.number} was issued at another factory."
            elif vendor and gate_line.gate_pass.vendor_id and gate_line.gate_pass.vendor_id != vendor.id:
                errors[f"lines[{index}].gate_pass_line"] = f"Line {index}: gate pass {gate_line.gate_pass.number} was issued to another party."
    if errors:
        raise ValidationError(errors)

    number = next_document_number("GR")
    receipt = GeneralReceipt.objects.create(
        number=number, plant=plant, document=None, vendor=vendor, party_name=(vendor.name if vendor else party_name)[:255],
        invoice_number=invoice_number[:80], invoice_date=invoice_date, receipt_type=data["receipt_type"], received_at=data["received_at"],
        received_by=received_by, reference=data.get("reference", "").strip(), notes=data.get("notes", "").strip(), created_by=user,
        request_key=key, request_fingerprint=digest,
    )
    created_lines = []
    for index, line in enumerate(data["lines"], start=1):
        created_lines.append(GeneralReceiptLine.objects.create(
            receipt=receipt, line_no=index, line_category=line["line_category"], description=line["description"], quantity=line["quantity"],
            uom=line["uom"], rate=line.get("rate"), amount=line.get("amount"), gst_rate=line.get("gst_rate"), disposition=line["disposition"],
            machine=machines.get(line.get("machine")) if line.get("machine") else None, equipment_text=line["equipment_text"],
            serial_no=line["serial_no"], gate_pass_line=gate_lines.get(line.get("gate_pass_line")) if line.get("gate_pass_line") else None,
            remarks=line["remarks"],
        ))
    from apps.gate.gate_pass_services import record_gate_pass_return
    for line, row in zip(data["lines"], created_lines):
        if row.gate_pass_line_id:
            record_gate_pass_return(user, line_id=row.gate_pass_line_id, quantity=line["returned_quantity"], general_receipt_line_id=row.id, inward_document_id=source_bill.id if source_bill else None, notes=f"Returned on {number}, line {row.line_no}.")
    if bill is not None:
        category = derived_category(data["receipt_type"], data["lines"])
        attach_receipt_to_bill(user, bill.id, KIND, receipt.id, complete=data.get("bill_complete", False), reason=f"General Receipt {number} {'completes' if data.get('bill_complete') else 'recorded against'} this bill.", category=category)
    if followup is not None:
        before = bill_safe_snapshot(followup)
        receipt.document = followup
        receipt.save(update_fields=["document"])
        bill_audit(followup, "NON_STOCK_FOLLOWUP", user, f"General Receipt {number} records what this non-stock bill delivered. The original void stays.", before, {"general_receipt": str(receipt.id), "general_receipt_number": number})
    receipt_audit(receipt, "GR_POSTED", user, data.get("duplicate_override_reason", ""))
    return receipt


# ── reverse ─────────────────────────────────────────────────────────────────

def get_receipt(user, pk):
    require_view(user)
    receipt = receipt_queryset().filter(id=pk, plant__in=reader_plants(user)).first()
    if not receipt:
        raise NotFound("This General Receipt is unavailable.")
    return receipt


def reverse_general_receipt(user, pk, data):
    if not is_document_master(user):
        raise PermissionDenied("Only an owner or administrator can reverse a General Receipt.")
    receipt = get_receipt(user, pk)
    def operation():
        locked = GeneralReceipt.objects.select_for_update().get(id=receipt.id)
        if locked.status == "REVERSED":
            raise Conflict(f"{locked.number} is already reversed.")
        line_ids = list(locked.lines.values_list("id", flat=True))
        returned = GatePassReturn.objects.filter(general_receipt_line_id__in=line_ids).select_related("line__gate_pass").order_by("returned_at").first()
        if returned:
            raise Conflict(f"{locked.number} recorded items coming back on gate pass {returned.line.gate_pass.number}. Reversing it would not undo that return, so it cannot be reversed. Correct the gate pass with an owner first and record a fresh receipt if needed.")
        before = receipt_payload(receipt_queryset().get(id=locked.id))
        before.pop("can_reverse", None)
        locked.status, locked.reversed_at, locked.reversed_by, locked.reversal_reason = "REVERSED", timezone.now(), user, data["reason"]
        locked.save(update_fields=["status", "reversed_at", "reversed_by", "reversal_reason"])
        receipt_audit(locked, "GR_REVERSED", user, data["reason"], before)
        if locked.document_id:
            bill = InwardBillIntake.objects.select_for_update().get(id=locked.document_id)
            bill_audit(bill, "BILL_REF_REVERSED", user, f"{locked.number} reversed: {data['reason']}", bill_safe_snapshot(bill), {"general_receipt": str(locked.id), "general_receipt_number": locked.number})
        return receipt_payload(receipt_queryset().get(id=locked.id), user)
    return idempotent_action(receipt.plant, f"gr:{receipt.id}:reverse:{user.id}", data, operation)


# ── list, history, suggestions, options ────────────────────────────────────

def filter_receipts(queryset, params, period_fn):
    def uuid_value(name):
        import uuid
        raw = params.get(name)
        if not raw:
            return None
        try:
            return uuid.UUID(str(raw))
        except (TypeError, ValueError):
            raise ValidationError({name: "Use a valid reference."})
    for name, field in (("plant", "plant_id"), ("vendor", "vendor_id"), ("document", "document_id")):
        value = uuid_value(name)
        if value:
            queryset = queryset.filter(**{field: value})
    machine = uuid_value("machine")
    if machine:
        queryset = queryset.filter(lines__machine_id=machine)
    receipt_type = params.get("receipt_type")
    if receipt_type:
        if receipt_type not in RECEIPT_TYPE_LABELS:
            raise ValidationError({"receipt_type": "Choose goods or service."})
        queryset = queryset.filter(receipt_type=receipt_type)
    line_category = params.get("line_category")
    if line_category:
        if line_category not in LINE_CATEGORY_LABELS:
            raise ValidationError({"line_category": "Choose a valid line category."})
        queryset = queryset.filter(lines__line_category=line_category)
    status = params.get("status")
    if status:
        if status not in {"POSTED", "REVERSED"}:
            raise ValidationError({"status": "Choose posted or reversed."})
        queryset = queryset.filter(status=status)
    if "date_from" in params or "date_to" in params:
        from apps.gate.services import date_bounds
        start, end = period_fn()
        low, high = date_bounds(start, end)
        queryset = queryset.filter(received_at__gte=low, received_at__lt=high)
    search = str(params.get("search", "")).strip()[:100]
    if search:
        queryset = queryset.filter(Q(number__icontains=search) | Q(party_name__icontains=search) | Q(invoice_number__icontains=search) | Q(reference__icontains=search) | Q(lines__description__icontains=search) | Q(lines__serial_no__icontains=search))
    return queryset.distinct().order_by("-received_at", "-id")


def page_payloads(receipts, user):
    receipts = list(receipts)
    returns = _returns_map([line.id for receipt in receipts for line in receipt.lines.all()])
    return [receipt_payload(receipt, user, returns) for receipt in receipts]


def machine_history(user, machine_id):
    require_view(user)
    machine = Machine.objects.select_related("work_center__plant").filter(id=machine_id, work_center__plant__in=reader_plants(user)).first()
    if not machine:
        raise NotFound("This machine is unavailable.")
    events = []
    lines = GeneralReceiptLine.objects.filter(machine=machine).select_related("receipt", "receipt__plant").order_by("-receipt__received_at", "-line_no")[:300]
    for line in lines:
        receipt = line.receipt
        events.append({
            "kind": "GENERAL_RECEIPT", "at": receipt.received_at.isoformat(), "receipt_id": str(receipt.id), "number": receipt.number,
            "receipt_type": receipt.receipt_type, "status": receipt.status, "line_category": line.line_category, "line_category_label": LINE_CATEGORY_LABELS.get(line.line_category),
            "description": line.description, "quantity": str(line.quantity), "uom": line.uom, "rate": str(line.rate) if line.rate is not None else None,
            "amount": str(line.amount) if line.amount is not None else None, "disposition": line.disposition, "disposition_label": DISPOSITION_LABELS.get(line.disposition),
            "serial_no": line.serial_no, "party": receipt.party_name, "invoice_number": receipt.invoice_number, "plant_name": receipt.plant.name,
        })
    for gate_line in GatePassLine.objects.filter(machine=machine).exclude(gate_pass__status__in=["DRAFT", "CANCELLED"]).select_related("gate_pass").prefetch_related("returns").order_by("-gate_pass__created_at")[:200]:
        gate_pass = gate_line.gate_pass
        left = gate_pass.out_at or gate_pass.issued_at or gate_pass.created_at
        events.append({
            "kind": "GATE_PASS_OUT", "at": left.isoformat(), "gate_pass_id": str(gate_pass.id), "number": gate_pass.number, "gate_pass_kind": gate_pass.kind,
            "purpose": gate_pass.purpose, "status": gate_pass.status, "description": gate_line.description, "quantity": str(gate_line.quantity), "uom": gate_line.uom,
            "returned_quantity": str(gate_line.returned_quantity), "party": gate_pass.party_name,
            "expected_return_date": gate_pass.expected_return_date.isoformat() if gate_pass.expected_return_date else None,
        })
        for event in gate_line.returns.all():
            events.append({
                "kind": "GATE_PASS_RETURN", "at": event.returned_at.isoformat(), "gate_pass_id": str(gate_pass.id), "number": gate_pass.number,
                "description": gate_line.description, "quantity": str(event.quantity), "uom": gate_line.uom, "party": gate_pass.party_name,
                "general_receipt_line_id": str(event.general_receipt_line_id) if event.general_receipt_line_id else None,
            })
    events.sort(key=lambda row: row["at"], reverse=True)
    posted = GeneralReceiptLine.objects.filter(machine=machine, receipt__status="POSTED")
    totals = posted.aggregate(amount=Sum("amount"), lines=Count("id"), services=Count("id", filter=Q(line_category="SERVICE")))
    return {
        "machine": {"id": str(machine.id), "name": machine.name, "code": machine.code, "status": machine.status, "plant": str(machine.work_center.plant_id), "plant_name": machine.work_center.plant.name},
        "totals": {"amount": str(totals["amount"] or Decimal("0")), "lines": totals["lines"], "service_lines": totals["services"]},
        "events": events,
    }


def description_suggestions(user, query="", vendor_id=None, limit=20):
    require_view(user)
    lines = GeneralReceiptLine.objects.filter(receipt__status="POSTED", receipt__plant__in=reader_plants(user)).select_related("receipt", "receipt__vendor")
    if query:
        lines = lines.filter(description__icontains=query)
    seen = {}
    for line in lines.order_by("-receipt__received_at", "-line_no")[:400]:
        key = line.description.strip().lower()
        if key in seen:
            continue
        receipt = line.receipt
        seen[key] = {
            "description": line.description, "line_category": line.line_category, "uom": line.uom, "last_rate": str(line.rate) if line.rate is not None else None,
            "last_gst_rate": str(line.gst_rate) if line.gst_rate is not None else None, "last_received_at": receipt.received_at.isoformat(),
            "vendor": str(receipt.vendor_id) if receipt.vendor_id else None, "vendor_name": receipt.vendor.name if receipt.vendor_id else receipt.party_name,
            "number": receipt.number,
        }
    rows = list(seen.values())
    if vendor_id:
        rows.sort(key=lambda row: row["vendor"] != str(vendor_id))
    return rows[:limit]


def receipt_options(user, plant_ids):
    require_view(user)
    plants = reader_plants(user)
    if plant_ids:
        plants = plants.filter(id__in=plant_ids)
    machines = Machine.objects.filter(work_center__plant__in=plants).select_related("work_center__plant").order_by("work_center__plant__name", "name")
    User = get_user_model()
    receivers = User.objects.filter(is_active=True).order_by("username")[:500]
    from .general_receipt_serializers import GST_RATES
    return {
        "plants": [{"id": str(plant.id), "name": plant.name, "code": plant.code} for plant in reader_plants(user).order_by("name")],
        "machines": [{"id": str(m.id), "name": m.name, "code": m.code, "status": m.status, "plant": str(m.work_center.plant_id), "plant_name": m.work_center.plant.name, "work_center_name": m.work_center.name} for m in machines],
        "receivers": [{"id": str(u.id), "name": user_label(u), "username": u.username} for u in receivers],
        "receipt_types": [{"code": code, "label": label} for code, label in GENERAL_RECEIPT_TYPES],
        "line_categories": [{"code": code, "label": label} for code, label in GENERAL_LINE_CATEGORIES],
        "dispositions": [{"code": code, "label": label} for code, label in GENERAL_LINE_DISPOSITIONS],
        "uoms": list(GENERAL_UOMS),
        "gst_rates": [str(int(rate)) for rate in GST_RATES],
    }


def plant_for_options(user, raw_ids):
    import uuid
    ids = []
    for raw in raw_ids:
        if not raw:
            continue
        try:
            ids.append(uuid.UUID(str(raw)))
        except (TypeError, ValueError):
            raise ValidationError({"plant": "Use a valid factory reference."})
    if ids and Plant.objects.filter(id__in=ids).count() != len(set(ids)):
        raise ValidationError({"plant": "Choose an existing factory."})
    return ids
