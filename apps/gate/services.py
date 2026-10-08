"""Independent physical gate observations. Never posts ERP stock/accounting."""
import hashlib
import hmac
import json
import os
from datetime import datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Count, Q, Sum
from django.utils import timezone
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from apps.factory.models import Plant
from apps.inventory.models import Vendor
from apps.materials.models import ConsumableMaterial, InventoryMaterial, ProductMaster, TradingGood
from apps.procurement.models import PurchaseOrderReceipt, TradingGoodReceipt
from apps.production.models import DeliveryChallan
from apps.sales.models import Customer, CustomerDispatch, TradeOrder
from apps.users.role_catalog import get_canonical_role_code
from apps.users.permission_service import PermissionService
from .models import GateAssignment, GateAuditEvent, GateRequestReceipt, GoodsLine, GoodsMovement, VisitorVisit


class Conflict(APIException):
    status_code = 409
    default_detail = "This action conflicts with a recorded gate event. Refresh and check the register."


class EncryptionUnavailable(APIException):
    status_code = 503
    default_detail = {"detail": "Optional government ID storage is temporarily unavailable. Please omit the ID number and retry.", "code": "GATE_ID_STORAGE_UNAVAILABLE"}


def gate_zone():
    return ZoneInfo(getattr(settings, "GATE_TIME_ZONE", "") or os.getenv("GATE_TIME_ZONE", "Asia/Kolkata"))


def gate_today():
    return timezone.now().astimezone(gate_zone()).date()


def date_bounds(start_date, end_date):
    return (datetime.combine(start_date, time.min, tzinfo=gate_zone()), datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=gate_zone()))


def invoice_fiscal_year(value):
    """Indian April–March supplier-number namespace, stored as its start year."""
    return value.year if value.month >= 4 else value.year - 1


def is_watchman(user):
    return any(get_canonical_role_code(value) == "WATCHMAN" for value in [getattr(getattr(user, "role", None), "code", ""), getattr(user, "effective_role_code", "")])


def is_owner(user):
    """Legacy gate alias for shared owner/administrator master access."""
    return PermissionService.is_gate_master(user)


def has_gate_permission(user, code):
    if is_owner(user):
        return True
    if is_watchman(user):
        return code == "gate.log"
    return code in set(PermissionService.get_user_permissions(user))


def require_owner(user):
    if not is_owner(user):
        raise PermissionDenied("Only an owner or administrator can inspect or correct gate history.")


def scoped_plants(user):
    if is_owner(user):
        return Plant.objects.all()
    return Plant.objects.filter(id__in=GateAssignment.objects.filter(user=user).values("plant_id"))


def get_plant(user, plant_id):
    plant = scoped_plants(user).filter(id=plant_id).first()
    if not plant:
        raise PermissionDenied("This gate is not assigned to your account.")
    return plant


def product_master(kind, product_id, *, active=True):
    mapping = {"MATERIAL": (InventoryMaterial, {"status": "ACTIVE"}), "PRODUCT": (ProductMaster, {"active": True, "is_current_version": True}), "TRADING": (TradingGood, {"is_active": True}), "CONSUMABLE": (ConsumableMaterial, {})}
    if kind not in mapping:
        raise ValidationError({"product_kind": "Choose an existing product master."})
    model, criteria = mapping[kind]
    obj = model.objects.filter(id=product_id, **(criteria if active else {})).first()
    if obj and active and kind == "CONSUMABLE" and obj.master_material_id and obj.master_material.status != "ACTIVE":
        obj = None
    if not obj:
        raise ValidationError({"product_id": "This product is unavailable. Choose an active product master."})
    return obj


def product_uom(kind, obj):
    if kind == "CONSUMABLE":
        return str(obj.unit).upper()
    if kind == "PRODUCT":
        return "KG"  # Finished products allow observed KG or PCS; document UOM remains authoritative.
    return str(getattr(obj, "base_uom", "KG")).upper()


def validate_lines(lines):
    result = []
    seen = set()
    for line in lines:
        obj = product_master(line["product_kind"], line["product_id"])
        uom = str(line["uom"]).strip().upper()
        allowed = {"KG", "PCS"} if line["product_kind"] == "PRODUCT" else {product_uom(line["product_kind"], obj)}
        if uom not in allowed:
            raise ValidationError({"uom": f"Use the master unit: {' / '.join(sorted(allowed))}."})
        key = (line["product_kind"], str(obj.id), uom)
        if key in seen:
            raise ValidationError({"lines": "Combine duplicate product/unit rows into one quantity."})
        seen.add(key)
        result.append({"product_kind": line["product_kind"], "product_id": str(obj.id), "product_name": obj.name or obj.code, "quantity": str(line["quantity"]), "uom": uom, "amount": str(line["amount"]) if line.get("amount") is not None else None})
    return result


def party_master(kind, party_id):
    model = Vendor if kind == "VENDOR" else Customer
    party = model.objects.filter(id=party_id, status="ACTIVE").first()
    if not party:
        raise ValidationError({"party_id": "Choose an active party from the master list."})
    return party


def decimal_text(value, places=4):
    return str(Decimal(value or 0).quantize(Decimal(10) ** -places))


def combine_document_lines(lines):
    totals = {}
    for line in lines:
        key = (line["product_kind"], line["product_id"], line["uom"])
        if key not in totals:
            totals[key] = dict(line)
            totals[key]["quantity"] = Decimal(str(line["quantity"]))
            totals[key]["amount"] = Decimal(str(line["amount"])) if line.get("amount") is not None else None
        else:
            totals[key]["quantity"] += Decimal(str(line["quantity"]))
            if totals[key]["amount"] is not None and line.get("amount") is not None:
                totals[key]["amount"] += Decimal(str(line["amount"]))
            else:
                totals[key]["amount"] = None
    return [{**line, "quantity": decimal_text(line["quantity"]), "amount": decimal_text(line["amount"], 2) if line["amount"] is not None else None} for line in totals.values()]


def document_payload(kind, obj):
    lines, warnings = [], []
    if kind == "GRN":
        party = obj.purchase_order.vendor
        for row in obj.lines.select_related("po_item__material").all():
            material = row.po_item.material
            if row.qty_received > 0:
                lines.append({"product_kind": "MATERIAL", "product_id": str(material.id), "product_name": material.name or material.code, "quantity": str(row.qty_received), "uom": row.po_item.uom.upper(), "amount": decimal_text(row.qty_received * row.rate, 2)})
        date, reference, party_kind = obj.vendor_invoice_date, obj.code, "VENDOR"
        invoice = obj.vendor_invoice_no
        basis = "ERP received quantity × recorded rate, excluding GST/freight"
    elif kind == "TRADING_RECEIPT":
        party = obj.vendor
        product = obj.trading_good
        lines = [{"product_kind": "TRADING", "product_id": str(product.id), "product_name": product.name, "quantity": str(obj.qty_received), "uom": product.base_uom, "amount": str(obj.line_total)}]
        date, reference, party_kind = obj.vendor_invoice_date, obj.code, "VENDOR"
        invoice = obj.vendor_invoice_no
        basis = "ERP trading receipt line total including recorded GST"
    elif kind == "TRADE":
        party = obj.customer
        party_kind, reference, invoice, date = "CUSTOMER", obj.code, obj.invoice_no, None
        basis = "ERP dispatched trade line total including recorded GST"
        for row in obj.items.select_related("inventory_material", "trading_good").all():
            product_kind = "TRADING" if row.trading_good_id else "MATERIAL"
            product = row.trading_good if row.trading_good_id else row.inventory_material
            if not product:
                warnings.append("A trading row has no linked product master.")
                continue
            if row.qty > 0:
                lines.append({"product_kind": product_kind, "product_id": str(product.id), "product_name": product.name or product.code, "quantity": str(row.qty), "uom": row.uom.upper(), "amount": str(row.line_total)})
    else:
        party_kind = "CUSTOMER"
        if kind == "DISPATCH":
            party = obj.customer or obj.sales_order.customer
            date, reference = None, obj.code
            invoice = obj.invoice_no
            rows = obj.lines.select_related("sales_order_item__product_master").all()
        else:
            party = obj.sales_order.customer if obj.sales_order_id else None
            date, reference = None, obj.dc_no
            invoice = obj.dc_no
            if obj.status == "DRAFT":
                warnings.append("ERP challan is a draft; physical dispatch has not been posted in the system.")
            rows = obj.items.select_related("sales_order_item__product_master").all()
        basis = "ERP shipment quantity × sales rate estimate, excluding GST/freight; unknown when price basis differs"
        for row in rows:
            item = row.sales_order_item
            if not item or not item.product_master_id:
                warnings.append("A historical dispatch row has no linked product master; choose observed master rows.")
                continue
            if kind == "DISPATCH":
                qty, uom = row.qty_dispatched, row.uom.upper()
            else:
                qty, uom = (row.qty_pcs, "PCS") if item.qty_uom == "PCS" and row.qty_pcs is not None else (row.weight_kg, "KG")
            if qty and qty > 0:
                amount = Decimal(qty) * item.unit_price if uom == item.price_basis else None
                lines.append({"product_kind": "PRODUCT", "product_id": str(item.product_master_id), "product_name": item.product_master.name, "quantity": str(qty), "uom": uom, "amount": decimal_text(amount, 2) if amount is not None else None})
        if not party:
            warnings.append("Historical challan has no customer master link.")
    lines = combine_document_lines(lines)
    all_known = bool(lines) and all(line["amount"] is not None for line in lines)
    return {"kind": kind, "id": str(obj.id), "reference": reference, "invoice_number": invoice, "party_kind": party_kind, "party_id": str(party.id) if party else None, "party_name": party.name if party else obj.customer_name, "invoice_date": str(date) if date else None, "vehicle_number": getattr(obj, "vehicle_no", ""), "lines": lines, "amount": decimal_text(sum(Decimal(line["amount"]) for line in lines), 2) if all_known else None, "amount_basis": basis, "warnings": warnings}


def document_candidates(plant, direction, invoice_number, party_kind=None, party_id=None):
    if direction == "INWARD":
        sources = [("GRN", PurchaseOrderReceipt.objects.filter(plant=plant, vendor_invoice_no__iexact=invoice_number).select_related("purchase_order__vendor")), ("TRADING_RECEIPT", TradingGoodReceipt.objects.filter(plant=plant, vendor_invoice_no__iexact=invoice_number).select_related("vendor", "trading_good"))]
    else:
        sources = [("DISPATCH", CustomerDispatch.objects.filter(Q(invoice_no__iexact=invoice_number) | Q(code__iexact=invoice_number), plant=plant, status__in=["CONFIRMED", "DISPATCHED"]).select_related("customer", "sales_order__customer")), ("CHALLAN", DeliveryChallan.objects.filter(plant=plant, dc_no__iexact=invoice_number).exclude(status="CANCELLED").select_related("sales_order__customer")), ("TRADE", TradeOrder.objects.filter(Q(invoice_no__iexact=invoice_number) | Q(code__iexact=invoice_number), plant=plant, status__in=["DISPATCHED", "INVOICED"]).select_related("customer"))]
    candidates = []
    for kind, source in sources:
        for obj in source[:51]:
            data = document_payload(kind, obj)
            if not party_id or (data["party_kind"] == party_kind and data["party_id"] == str(party_id)):
                candidates.append(data)
    return candidates[:50]


def chosen_document(plant, direction, party_kind, party_id, kind, document_id):
    mapping = {"GRN": PurchaseOrderReceipt, "TRADING_RECEIPT": TradingGoodReceipt, "DISPATCH": CustomerDispatch, "CHALLAN": DeliveryChallan, "TRADE": TradeOrder}
    if kind not in mapping or (direction == "INWARD") != (kind in {"GRN", "TRADING_RECEIPT"}):
        raise ValidationError({"document_kind": "Document direction does not match the gate movement."})
    obj = mapping[kind].objects.filter(id=document_id, plant=plant).first()
    if not obj or (kind == "DISPATCH" and obj.status not in {"CONFIRMED", "DISPATCHED"}) or (kind == "CHALLAN" and obj.status == "CANCELLED") or (kind == "TRADE" and obj.status not in {"DISPATCHED", "INVOICED"}):
        raise ValidationError({"document_id": "This reference is unavailable in the selected plant."})
    data = document_payload(kind, obj)
    if data["party_kind"] != party_kind or data["party_id"] != str(party_id):
        raise ValidationError({"document_id": "This ERP reference belongs to another party."})
    return data


def discrepancy_list(movement, lines, document):
    if not document:
        return []
    errors = list(document.get("warnings", []))
    invoice_normal = lambda value: " ".join(str(value or "").upper().split())
    allowed_invoice_refs = {invoice_normal(document.get("invoice_number"))}
    if document.get("kind") in {"DISPATCH", "CHALLAN", "TRADE"}:
        allowed_invoice_refs.add(invoice_normal(document.get("reference")))
    if invoice_normal(movement.invoice_number) not in allowed_invoice_refs:
        errors.append("Invoice number differs from ERP reference.")
    if document.get("invoice_date") and str(movement.invoice_date or "") != document["invoice_date"]:
        errors.append("Invoice date differs from ERP reference.")
    normalize_vehicle = lambda value: "".join(str(value or "").upper().split())
    if document.get("vehicle_number") and normalize_vehicle(document["vehicle_number"]) != normalize_vehicle(movement.vehicle_number):
        errors.append("Vehicle differs from ERP reference.")
    def grouped(rows):
        return {(r["product_kind"], str(r["product_id"]), r["uom"]): (Decimal(str(r["quantity"])), Decimal(str(r["amount"])) if r.get("amount") is not None else None) for r in rows}
    observed, expected = grouped(lines), grouped(document["lines"])
    if observed.keys() != expected.keys():
        errors.append("Products or units differ from ERP reference.")
    for key in observed.keys() & expected.keys():
        if observed[key][0] != expected[key][0]:
            errors.append("Observed quantity differs from ERP reference.")
        if observed[key][1] is not None and expected[key][1] is not None and observed[key][1] != expected[key][1]:
            errors.append("Observed amount differs from ERP reference.")
    return sorted(set(errors))


def goods_payload(obj):
    lines = [{"id": str(row.id), "product_kind": row.product_kind, "product_id": str(row.product_id), "product_name": row.product_name, "quantity": str(row.quantity), "uom": row.uom, "amount": str(row.amount) if row.amount is not None else None} for row in obj.lines.all()]
    amount = sum(Decimal(row["amount"]) for row in lines) if lines and all(row["amount"] is not None for row in lines) else None
    return {"id": str(obj.id), "plant": str(obj.plant_id), "plant_name": obj.plant.name, "direction": obj.direction, "invoice_number": obj.invoice_number, "invoice_date": str(obj.invoice_date) if obj.invoice_date else None, "vehicle_number": obj.vehicle_number, "party_kind": obj.party_kind, "party_id": str(obj.party_id), "party_name": obj.party_name, "lines": lines, "amount": str(amount) if amount is not None else None, "document_kind": obj.document_kind, "document_id": str(obj.document_id) if obj.document_id else None, "document_snapshot": obj.document_snapshot, "reconciliation_status": obj.reconciliation_status, "discrepancies": obj.discrepancies, "notes": obj.notes, "logged_at": obj.logged_at.isoformat(), "created_by_name": obj.created_by.username}


def visitor_payload(obj):
    has_selfie = obj._has_selfie if hasattr(obj, "_has_selfie") else bool(obj.selfie_data)
    return {"id": str(obj.id), "plant": str(obj.plant_id), "plant_name": obj.plant.name, "name": obj.name, "mobile": obj.mobile, "purpose": obj.purpose, "company": obj.company, "source": obj.source, "status": obj.status, "submitted_at": obj.submitted_at.isoformat(), "entry_at": obj.entry_at.isoformat() if obj.entry_at else None, "exit_at": obj.exit_at.isoformat() if obj.exit_at else None, "government_id_masked": f"{obj.government_id_type} •••• {obj.government_id_suffix}" if obj.government_id_suffix else "", "has_selfie": has_selfie, "selfie_url": f"/api/gate/visitors/{obj.id}/selfie/" if has_selfie else None}


def audit_event_payload(event):
    def redact(value):
        if isinstance(value, dict):
            return {key: redact(item) for key, item in value.items() if not any(word in key.lower() for word in ["government_id", "selfie", "encrypted", "secret"]) and ("mobile" not in key.lower() or key.lower().endswith("masked"))}
        if isinstance(value, list):
            return [redact(item) for item in value]
        return value
    return {"id": str(event.id), "plant": str(event.plant_id), "plant_name": event.plant.name, "object_id": str(event.object_id), "object_type": event.object_type, "action": event.action, "actor_name": event.actor.username if event.actor else "Visitor self-registration", "reason": event.reason, "before": redact(event.before), "after": redact(event.after), "created_at": event.created_at.isoformat()}


def safe_visitor_snapshot(obj):
    return {"status": obj.status, "mobile_masked": f"••••••{obj.mobile[-4:]}", "purpose": obj.purpose, "submitted_at": obj.submitted_at.isoformat(), "entry_at": obj.entry_at.isoformat() if obj.entry_at else None, "exit_at": obj.exit_at.isoformat() if obj.exit_at else None}


def audit(obj, action, user=None, reason="", before=None):
    is_goods = isinstance(obj, GoodsMovement)
    GateAuditEvent.objects.create(plant_id=obj.plant_id, object_id=obj.id, object_type="GOODS" if is_goods else "VISITOR", action=action, actor=user, reason=reason, before=before or {}, after=goods_payload(obj) if is_goods else safe_visitor_snapshot(obj))


def fingerprint(data):
    def safe(value):
        if isinstance(value, bytes):
            return {"image_sha256": hashlib.sha256(value).hexdigest()}
        return str(value)
    payload = json.dumps(data, default=safe, sort_keys=True, separators=(",", ":")).encode()
    return hmac.new(settings.SECRET_KEY.encode(), payload, hashlib.sha256).hexdigest()


def idempotent_action(plant, scope, data, operation):
    digest = fingerprint(data)
    with transaction.atomic():
        # Plant lock serializes receipts/active phone invariants on PostgreSQL,
        # while database uniqueness remains the final concurrent race guard.
        Plant.objects.select_for_update().get(id=plant.id)
        receipt = GateRequestReceipt.objects.filter(scope=scope, token=data["client_token"]).first()
        if receipt:
            if receipt.fingerprint != digest:
                raise Conflict("This retry token belongs to a different submission. Start a new action.")
            return {**receipt.response, "replayed": True}
        try:
            with transaction.atomic():
                response = operation()
                GateRequestReceipt.objects.create(scope=scope, token=data["client_token"], fingerprint=digest, response=response)
        except IntegrityError:
            # Do not chain PostgreSQL uniqueness details: an active visitor
            # conflict contains their phone number in the database error.
            raise Conflict("This invoice or active visitor is already recorded. Refresh the gate register.") from None
        return {**response, "replayed": False}


def store_lines(movement, lines):
    GoodsLine.objects.bulk_create([GoodsLine(movement=movement, **line) for line in lines])


def create_goods(user, data):
    if is_watchman(user) and data["direction"] == "INWARD":
        raise PermissionDenied("Use the camera bill upload to record inward arrival. Inventory records the GRN.")
    plant = get_plant(user, data["plant"])
    def operation():
        party = party_master(data["party_kind"], data["party_id"])
        document = None
        if data.get("document_id"):
            document = chosen_document(plant, data["direction"], data["party_kind"], party.id, data["document_kind"], data["document_id"])
        else:
            candidates = document_candidates(plant, data["direction"], data["invoice_number"], data["party_kind"], party.id)
            if len(candidates) > 1:
                raise ValidationError({"document_id": "Multiple ERP references match. Choose the correct reference."})
            if candidates:
                document = candidates[0]
        lines = validate_lines(data["lines"]) if data.get("lines") else validate_lines(document["lines"]) if document and document["lines"] else []
        if not lines or any(Decimal(str(line["quantity"])) <= 0 for line in lines):
            raise ValidationError({"lines": "Choose an active master product and a positive observed quantity."})
        invoice_date = data.get("invoice_date") or (datetime.strptime(document["invoice_date"], "%Y-%m-%d").date() if document and document["invoice_date"] else None)
        obj = GoodsMovement.objects.create(plant=plant, direction=data["direction"], invoice_number=data["invoice_number"].strip(), invoice_normalized=" ".join(data["invoice_number"].upper().split()), invoice_date=invoice_date, invoice_year=invoice_fiscal_year(invoice_date or gate_today()), vehicle_number=data["vehicle_number"].strip().upper(), party_kind=data["party_kind"], party_id=party.id, party_name=party.name, document_kind=document["kind"] if document else "", document_id=document["id"] if document else None, document_snapshot=document or {}, notes=data.get("notes", ""), created_by=user)
        obj.discrepancies = discrepancy_list(obj, lines, document)
        obj.reconciliation_status = "DISCREPANCY" if obj.discrepancies else "MATCHED" if document else "UNMATCHED"
        obj.save(update_fields=["discrepancies", "reconciliation_status"])
        store_lines(obj, lines)
        audit(obj, "GOODS_LOGGED", user)
        return goods_payload(obj)
    return idempotent_action(plant, f"goods:{user.id}", data, operation)


def change_goods(user, obj, data, reconcile=False):
    require_owner(user)
    def operation():
        current = GoodsMovement.objects.select_for_update().get(id=obj.id)
        before = goods_payload(current)
        if reconcile:
            document = chosen_document(current.plant, current.direction, current.party_kind, current.party_id, data["document_kind"], data["document_id"])
            current.document_kind, current.document_id, current.document_snapshot = document["kind"], document["id"], document
        else:
            for field in ["vehicle_number", "invoice_number", "invoice_date", "notes"]:
                if field in data:
                    setattr(current, field, data[field])
            current.invoice_normalized = " ".join(current.invoice_number.upper().split())
            current.invoice_year = invoice_fiscal_year(current.invoice_date or current.logged_at.astimezone(gate_zone()).date())
            current.vehicle_number = current.vehicle_number.upper()
            if "lines" in data:
                lines = validate_lines(data["lines"])
                # Physical observation line replacement requires master access; its
                # complete before/after is permanently retained in audit.
                current.lines.all().delete()
                store_lines(current, lines)
        lines = goods_payload(current)["lines"]
        current.discrepancies = discrepancy_list(current, lines, current.document_snapshot)
        current.reconciliation_status = "DISCREPANCY" if current.discrepancies else "MATCHED" if current.document_id else "UNMATCHED"
        current.save()
        audit(current, "GOODS_RECONCILED" if reconcile else "GOODS_CORRECTED", user, data["reason"], before)
        return goods_payload(current)
    return idempotent_action(obj.plant, f"goods:{obj.id}:{'reconcile' if reconcile else 'correct'}:{user.id}", data, operation)


def encrypt_government_id(number):
    if not number:
        return ""
    key = getattr(settings, "GATE_ID_ENCRYPTION_KEY", "") or os.getenv("GATE_ID_ENCRYPTION_KEY", "")
    try:
        from cryptography.fernet import Fernet
        if not key:
            raise ValueError()
        return Fernet(key.encode() if isinstance(key, str) else key).encrypt(number.encode()).decode()
    except (ImportError, ValueError, TypeError):
        raise EncryptionUnavailable()


def create_visitor(plant, data, user=None, public=False, scope=""):
    if not public:
        require_owner(user)
        get_plant(user, plant.id)
    def operation():
        number = data.get("government_id_number", "")
        encrypted = encrypt_government_id(number)
        now = timezone.now()
        obj = VisitorVisit.objects.create(plant=plant, name=data["name"], mobile=data["mobile"], purpose=data["purpose"], company=data.get("company", ""), government_id_type=data.get("government_id_type", ""), government_id_encrypted=encrypted, government_id_suffix=number[-4:] if number else "", selfie_data=data.get("selfie"), source="PUBLIC" if public else "OWNER", status="INSIDE" if public else "PENDING", submitted_at=now, consent_at=now, entry_at=now if public else None)
        # QR registration and entry are one atomic visitor action. Neither
        # timestamp nor audit evidence is repeated when the receipt is replayed.
        audit(obj, "VISITOR_REGISTERED", None if public else user)
        if public:
            audit(obj, "VISITOR_ENTERED", reason="Visitor QR submission recorded entry.")
            return {"receipt_id": str(obj.id), "status": obj.status, "entry_at": obj.entry_at.isoformat(), "message": "Entry recorded. Please ask the watchman to confirm your exit when leaving."}
        return visitor_payload(obj)
    return idempotent_action(plant, scope or f"visitor:{user.id}", data, operation)


def transition_visitor(user, obj, data, action):
    if action not in {"check-in", "check-out", "cancel"}:
        raise ValidationError("Choose a valid visitor action.")
    if action != "check-out":
        require_owner(user)
    elif not has_gate_permission(user, "gate.log"):
        raise PermissionDenied("This account cannot record visitor exits.")
    get_plant(user, obj.plant_id)
    def operation():
        current = VisitorVisit.objects.select_for_update().get(id=obj.id)
        before = safe_visitor_snapshot(current)
        expected = "INSIDE" if action == "check-out" else "PENDING"
        if current.status != expected:
            raise Conflict(f"Visitor is {current.status.lower()}. Refresh before recording this action.")
        if action == "check-in":
            current.status, current.entry_at, current.entry_by = "INSIDE", timezone.now(), user
        elif action == "check-out":
            current.status, current.exit_at, current.exit_by = "EXITED", timezone.now(), user
        else:
            current.status = "CANCELLED"
        current.save()
        audit(current, {"check-in": "VISITOR_ENTERED", "check-out": "VISITOR_EXITED", "cancel": "VISITOR_CANCELLED"}[action], user, data.get("reason", ""), before)
        return visitor_payload(current)
    return idempotent_action(obj.plant, f"visitor:{obj.id}:{action}:{user.id}", data, operation)


def summary_for_period(start_date, end_date, plant_ids=None):
    start, end = date_bounds(start_date, end_date)
    goods = GoodsMovement.objects.filter(logged_at__gte=start, logged_at__lt=end)
    visitors = VisitorVisit.objects.all()
    if plant_ids is not None:
        goods, visitors = goods.filter(plant_id__in=plant_ids), visitors.filter(plant_id__in=plant_ids)
    counts = {row["direction"]: row["n"] for row in goods.values("direction").annotate(n=Count("id"))}
    qty = {row["uom"]: str(row["qty"]) for row in GoodsLine.objects.filter(movement__in=goods).values("uom").annotate(qty=Sum("quantity"))}
    amounts = {row["movement__direction"]: str(row["amount"]) if row["amount"] is not None else None for row in GoodsLine.objects.filter(movement__in=goods).values("movement__direction").annotate(amount=Sum("amount"))}
    from apps.analytics.gate_bill_reporting import summary_for_period as bill_summary
    return {**bill_summary(start_date, end_date, plant_ids), "date_from": str(start_date), "date_to": str(end_date), "business_timezone": str(gate_zone()), "goods_total": sum(counts.values()), "inward": counts.get("INWARD", 0), "outward": counts.get("OUTWARD", 0), "unmatched": goods.filter(reconciliation_status="UNMATCHED").count(), "discrepancies": goods.filter(reconciliation_status="DISCREPANCY").count(), "pending_visitors": visitors.filter(status="PENDING").count(), "inside_visitors": visitors.filter(status="INSIDE").count(), "visitor_entries": visitors.filter(entry_at__gte=start, entry_at__lt=end).count(), "visitor_exits": visitors.filter(exit_at__gte=start, exit_at__lt=end).count(), "overdue_visitors": visitors.filter(status="INSIDE", entry_at__lt=timezone.now()-timedelta(hours=12)).count(), "stale_pending_visitors": visitors.filter(status="PENDING", submitted_at__lt=timezone.now()-timedelta(hours=12)).count(), "amount_by_direction": amounts, "quantity_by_uom": qty, "unknown_amount_lines": GoodsLine.objects.filter(movement__in=goods, amount__isnull=True).count(), "amount_note": "Known observed/ERP line amounts only; may exclude tax or freight. See document amount basis. Not an accounting total."}


def report_payload_for_period(start_date, end_date, plant_ids=None):
    start, end = date_bounds(start_date, end_date)
    goods = GoodsMovement.objects.filter(logged_at__gte=start, logged_at__lt=end).select_related("plant", "created_by").prefetch_related("lines")
    if plant_ids is not None:
        goods = goods.filter(plant_id__in=plant_ids)
    rows = []
    # Export bounded for human report delivery; API history stays paginated.
    for index, movement in enumerate(goods[:10001]):
        if index == 10000:
            raise ValidationError("Report exceeds 10,000 movements. Select a shorter date range.")
        for line in movement.lines.all():
            rows.append({"logged_at": movement.logged_at.astimezone(gate_zone()).isoformat(), "plant": movement.plant.name, "direction": movement.direction, "invoice_number": movement.invoice_number, "invoice_date": str(movement.invoice_date) if movement.invoice_date else "", "vehicle_number": movement.vehicle_number, "party_name": movement.party_name, "product_name": line.product_name, "quantity": str(line.quantity), "uom": line.uom, "amount": str(line.amount) if line.amount is not None else "", "reconciliation_status": movement.reconciliation_status, "reference": movement.document_snapshot.get("reference", ""), "amount_basis": movement.document_snapshot.get("amount_basis", "Observed / unknown")})
            if len(rows) > 20000:
                raise ValidationError("Report exceeds 20,000 lines. Select a shorter date range.")
    return {"summary": summary_for_period(start_date, end_date, plant_ids), "rows": rows}
