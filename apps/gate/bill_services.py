"""Private bill arrival and receipt evidence; ERP services alone post stock."""
import hashlib
import json
import uuid
from datetime import timedelta
from functools import wraps

from django.db import transaction
from django.db.models import Prefetch, Q
from django.utils import timezone
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.renderers import JSONRenderer
from apps.factory.models import Plant
from apps.inventory.models import BulkTransaction, InventoryRoll, PackagingTransaction, Vendor
from apps.procurement.models import PurchaseOrder, PurchaseOrderReceipt, PurchaseOrderReceiptLine, TradingGoodReceipt
from apps.users.permission_service import PermissionService
from .models import GateAuditEvent, InwardBillIntake, InwardBillPage, InwardBillReceiptReference
from .services import Conflict, date_bounds, gate_today, get_plant, idempotent_action, is_owner, is_watchman, scoped_plants

OPEN_STATUSES = {"PENDING_GRN", "PARTIAL_GRN"}


def require_review(user):
    if not PermissionService.has_inventory_bill_review(user):
        raise PermissionDenied("Only an eligible inventory reviewer can receive inward bills.")


def bill_queryset(user):
    source = InwardBillIntake.objects.select_related("plant", "created_by").prefetch_related(Prefetch("pages", queryset=InwardBillPage.objects.defer("data")), "receipt_references")
    if PermissionService.has_inventory_bill_review(user):
        return source.filter(plant__in=PermissionService.inventory_review_plants(user))
    if is_watchman(user):
        start, end = date_bounds(gate_today(), gate_today())
        return source.filter(plant__in=scoped_plants(user), created_by=user, arrival_at__gte=start, arrival_at__lt=end)
    raise PermissionDenied("This account cannot access inward bills.")


def get_bill(user, pk, review=False):
    if review:
        require_review(user)
    obj = bill_queryset(user).filter(id=pk).first()
    if not obj:
        raise NotFound("This inward bill is unavailable.")
    return obj


def bill_safe_snapshot(obj):
    return {"status": obj.status, "arrival_at": obj.arrival_at.isoformat(), "page_count": obj.pages.count(), "review_data": obj.review_data, "receipt_refs": [ref.snapshot for ref in obj.receipt_references.all()], "resolved_at": obj.resolved_at.isoformat() if obj.resolved_at else None, "resolution_code": obj.resolution_code}


def bill_audit(obj, action, actor, reason="", before=None):
    GateAuditEvent.objects.create(plant=obj.plant, object_id=obj.id, object_type="BILL", action=action, actor=actor, reason=reason, before=before or {}, after=bill_safe_snapshot(obj))


def bill_payload(obj, user=None):
    pages = [{"id": str(page.id), "page_number": page.page_number, "width": page.width, "height": page.height, "byte_size": page.byte_size, "image_url": f"/api/gate/inward-bills/{obj.id}/pages/{page.id}/"} for page in obj.pages.all()]
    duplicates = list(InwardBillIntake.objects.filter(plant=obj.plant, content_hash=obj.content_hash).exclude(id=obj.id).order_by("-arrival_at").values_list("id", flat=True)[:10])
    watchman = user is not None and is_watchman(user)
    return {"id": str(obj.id), "plant": str(obj.plant_id), "plant_name": obj.plant.name, "arrival_at": obj.arrival_at.isoformat(), "status": obj.status, "created_by_name": obj.created_by.username, "page_count": len(pages), "pages": pages, "review_data": {} if watchman else obj.review_data, "receipt_refs": [] if watchman else [ref.snapshot for ref in obj.receipt_references.all()], "resolution_reason": "" if watchman else obj.resolution_reason, "resolution_code": "" if watchman else obj.resolution_code, "resolved_at": obj.resolved_at.isoformat() if obj.resolved_at else None, "duplicate_warning": {"possible_duplicate": bool(duplicates), "bill_ids": [] if watchman else [str(pk) for pk in duplicates]}}


def current_actor_payload(payload, user):
    """Apply current permissions even when the receipt was cached by a master."""
    if not is_watchman(user):
        return payload
    return {**payload, "review_data": {}, "receipt_refs": [], "resolution_reason": "", "resolution_code": "", "duplicate_warning": {**payload.get("duplicate_warning", {}), "bill_ids": []}}


def upload_bill(user, data):
    if not (is_watchman(user) or is_owner(user)):
        raise PermissionDenied("Only gate staff can record a bill arrival.")
    plant = get_plant(user, data["plant"])
    def operation():
        digest = hashlib.sha256("|".join(page["sha256"] for page in data["images"]).encode()).hexdigest()
        bill = InwardBillIntake.objects.create(plant=plant, created_by=user, content_hash=digest)
        InwardBillPage.objects.bulk_create([InwardBillPage(intake=bill, page_number=index+1, **page) for index, page in enumerate(data["images"])])
        bill_audit(bill, "BILL_ARRIVED", user)
        from apps.users.services.bill_notifications import publish_bill_arrival
        publish_bill_arrival(bill)
        return bill_payload(bill, user)
    safe_data = {"client_token": data["client_token"], "plant": data["plant"], "images": [{key: page[key] for key in ["sha256", "width", "height", "byte_size"]} for page in data["images"]]}
    return current_actor_payload(idempotent_action(plant, f"bill:upload:{user.id}", safe_data, operation), user)


def _open(bill):
    if bill.status not in OPEN_STATUSES:
        raise Conflict("This bill is resolved. Refresh the inventory queue.")


def _check_review_refs(bill, snapshots, review_data=None):
    reviewed = bill.review_data if review_data is None else review_data
    vendors = {row["vendor_id"] for row in snapshots}
    if len(vendors) > 1:
        raise ValidationError("All receipts for one bill must share a vendor.")
    if reviewed.get("vendor_id") and vendors and vendors != {reviewed["vendor_id"]}:
        raise ValidationError("Receipt vendor differs from the reviewed bill.")
    if reviewed.get("invoice_number") and any(row["invoice_number"].strip().upper() != reviewed["invoice_number"].strip().upper() for row in snapshots):
        raise ValidationError("Receipt invoice differs from the reviewed bill.")


def review_bill(user, obj, data):
    require_review(user)
    def operation():
        bill = InwardBillIntake.objects.select_for_update().get(id=obj.id)
        _open(bill)
        before = bill_safe_snapshot(bill)
        review = {**bill.review_data, **json.loads(json.dumps({key: value for key, value in data.items() if key != "client_token"}, default=str))}
        if review.get("vendor_id") and not Vendor.objects.filter(id=review["vendor_id"], status="ACTIVE").exists():
            raise ValidationError("Choose an active vendor master.")
        if review.get("purchase_order_id"):
            po = PurchaseOrder.objects.filter(id=review["purchase_order_id"], plant=bill.plant).first()
            if not po or (review.get("vendor_id") and str(po.vendor_id) != review["vendor_id"]):
                raise ValidationError("Purchase order must belong to this bill plant and vendor.")
        _check_review_refs(bill, [ref.snapshot for ref in bill.receipt_references.all()], review)
        bill.review_data = review
        bill.save(update_fields=["review_data"])
        bill_audit(bill, "BILL_REVIEWED", user, before=before)
        return bill_payload(bill)
    return idempotent_action(obj.plant, f"bill:{obj.id}:review:{user.id}", data, operation)


def receipt_snapshot(bill, kind, pk, lock=False):
    models = {"BULK": BulkTransaction, "PACKAGING": PackagingTransaction, "ROLL": InventoryRoll, "PO_RECEIPT": PurchaseOrderReceipt, "TRADING": TradingGoodReceipt}
    if kind not in models:
        raise ValidationError("Choose a valid posted receipt kind.")
    qs = models[kind].objects
    if lock:
        qs = qs.select_for_update()
    obj = qs.filter(id=pk).first()
    if not obj:
        raise ValidationError("This receipt is unavailable.")
    # Legacy PO posting can create physical stock even for REJECTED quality.
    # Its child ledger row must not bypass the parent receipt's quality check.
    child_fields = {"BULK": "bulk_tx_id", "PACKAGING": "packaging_tx_id", "ROLL": "roll_id"}
    if kind in child_fields and PurchaseOrderReceiptLine.objects.filter(**{child_fields[kind]: pk}, receipt__quality_status__iexact="REJECTED").exists():
        raise ValidationError("A rejected PO receipt cannot receive a bill through its stock rows.")
    quality = "POSTED"
    if kind in {"BULK", "PACKAGING"}:
        plant_id, vendor, received = obj.location.plant_id, obj.vendor, obj.created_at
        quantity = obj.qty_kg if kind == "BULK" else obj.qty
        uom, reference = obj.material.base_uom, obj.reference or ""
        if obj.type != "INWARD":
            raise ValidationError("Only posted inward transactions can receive a bill.")
    elif kind == "ROLL":
        plant_id, vendor, received = obj.plant_id or obj.location.plant_id, obj.vendor, obj.created_at
        quantity, uom, reference = obj.net_weight_kg or obj.original_weight_kg or obj.weight_kg, "KG", obj.label_id
        quality = str((obj.meta_json or {}).get("qc_status") or "POSTED").upper()
        from apps.inventory.models import RollMovement
        if (obj.meta_json or {}).get("grn_source") != "GRN_INWARD" and not RollMovement.objects.filter(roll=obj, reason="GRN").exists():
            raise ValidationError("This roll was not created by a posted inward receipt.")
    elif kind == "PO_RECEIPT":
        plant_id, vendor, received = obj.plant_id, obj.purchase_order.vendor, obj.received_at
        lines = list(obj.lines.select_related("po_item"))
        if not any(line.qty_received > 0 and (line.bulk_tx_id or line.roll_id or line.packaging_tx_id) for line in lines):
            raise ValidationError("This PO header has no posted positive stock receipt.")
        quantities = {}
        for line in lines:
            if line.qty_received > 0:
                quantities[line.po_item.uom] = quantities.get(line.po_item.uom, 0)+line.qty_received
        quantity = next(iter(quantities.values())) if len(quantities) == 1 else None
        uom, reference, quality = next(iter(quantities)) if len(quantities) == 1 else "MIXED", obj.code, obj.quality_status
    else:
        plant_id, vendor, received = obj.plant_id, obj.vendor, obj.received_at
        quantity, uom, reference = obj.qty_received, obj.trading_good.base_uom, obj.code
    if str(plant_id) != str(bill.plant_id) or not vendor or (quantity is not None and quantity <= 0) or quality == "REJECTED":
        raise ValidationError("Receipt must be positive, non-rejected and belong to this bill's plant.")
    if received < bill.arrival_at-timedelta(hours=24) or received > timezone.now()+timedelta(minutes=1):
        raise ValidationError("Receipt time must be within 24 hours before bill arrival or after it.")
    return {"kind": kind, "id": str(obj.id), "reference": reference, "invoice_number": obj.vendor_invoice_no, "vendor_id": str(vendor.id), "vendor_name": vendor.name, "plant": str(plant_id), "received_at": received.isoformat(), "quantity": str(quantity) if quantity is not None else None, "quantities_by_uom": {unit: str(qty) for unit, qty in quantities.items()} if kind == "PO_RECEIPT" else {uom: str(quantity)}, "uom": uom, "quality_status": quality}


def _append_refs(bill, refs, user):
    keys = [(row["kind"], str(row["id"])) for row in refs]
    if len(keys) != len(set(keys)):
        raise ValidationError("Choose each receipt once.")
    snapshots = [receipt_snapshot(bill, kind, pk, lock=True) for kind, pk in keys]
    existing = list(bill.receipt_references.all())
    _check_review_refs(bill, [ref.snapshot for ref in existing]+snapshots)
    for row in snapshots:
        if receipt_is_linked(row["kind"], row["id"]):
            raise Conflict("This receipt is already linked to a bill.")
        InwardBillReceiptReference.objects.create(intake=bill, kind=row["kind"], object_id=row["id"], snapshot=row, linked_by=user)


def receipt_is_linked(kind, pk):
    if InwardBillReceiptReference.objects.filter(kind=kind, object_id=pk).exists():
        return True
    fields = {"BULK": "bulk_tx_id", "PACKAGING": "packaging_tx_id", "ROLL": "roll_id"}
    if kind in fields:
        headers = PurchaseOrderReceiptLine.objects.filter(**{fields[kind]: pk}).values_list("receipt_id", flat=True)
        return InwardBillReceiptReference.objects.filter(kind="PO_RECEIPT", object_id__in=headers).exists()
    if kind == "PO_RECEIPT":
        for child_kind, field in fields.items():
            ids = PurchaseOrderReceiptLine.objects.filter(receipt_id=pk).exclude(**{f"{field}__isnull": True}).values_list(field, flat=True)
            if InwardBillReceiptReference.objects.filter(kind=child_kind, object_id__in=ids).exists():
                return True
    return False


def _finish(bill, user, reason):
    if not bill.receipt_references.exists():
        raise ValidationError("Post or link at least one receipt before confirming the bill complete.")
    bill.status, bill.resolved_at, bill.resolved_by = "RECEIPTED", timezone.now(), user
    bill.resolution_reason = reason


def resolve_bill(user, obj, data, action):
    require_review(user)
    def operation():
        bill = InwardBillIntake.objects.select_for_update().get(id=obj.id)
        _open(bill)
        before = bill_safe_snapshot(bill)
        if action == "link-receipts":
            _append_refs(bill, data["receipt_refs"], user)
            bill.status = "PARTIAL_GRN"
            if data.get("bill_complete"):
                _finish(bill, user, data["reason"])
        elif action == "complete":
            _finish(bill, user, data["reason"])
        else:
            if bill.receipt_references.exists():
                raise Conflict("A bill with posted receipts cannot be voided. Review its remaining lines.")
            if data.get("duplicate_of"):
                duplicate = InwardBillIntake.objects.filter(id=data["duplicate_of"], plant=bill.plant).exclude(id=bill.id).first()
                if not duplicate:
                    raise ValidationError("Choose another bill at the same plant.")
                bill.duplicate_of = duplicate
            bill.status, bill.resolved_at, bill.resolved_by = "VOID", timezone.now(), user
            bill.resolution_reason, bill.resolution_code = data["reason"], data["resolution_code"]
        bill.save()
        bill_audit(bill, "BILL_VOIDED" if action == "void" else "BILL_RECEIPTED" if bill.status == "RECEIPTED" else "BILL_LINKED", user, data["reason"], before)
        return bill_payload(bill)
    return idempotent_action(obj.plant, f"bill:{obj.id}:{action}:{user.id}", data, operation)


def receipt_candidates(bill, search="", vendor_id=None):
    sources = [("BULK", BulkTransaction.objects.filter(type="INWARD", location__plant=bill.plant)), ("PACKAGING", PackagingTransaction.objects.filter(type="INWARD", location__plant=bill.plant)), ("ROLL", InventoryRoll.objects.filter(plant=bill.plant)), ("PO_RECEIPT", PurchaseOrderReceipt.objects.filter(plant=bill.plant)), ("TRADING", TradingGoodReceipt.objects.filter(plant=bill.plant))]
    rows = []
    for kind, qs in sources:
        qs = qs.filter(created_at__gte=bill.arrival_at-timedelta(hours=24))
        if search:
            predicate = Q(vendor_invoice_no__icontains=search)
            if kind in {"PO_RECEIPT", "TRADING"}:
                predicate |= Q(code__icontains=search)
            elif kind == "ROLL":
                predicate |= Q(label_id__icontains=search) | Q(meta_json__grn_reference__icontains=search)
            else:
                predicate |= Q(reference__icontains=search)
            qs = qs.filter(predicate)
        if vendor_id:
            qs = qs.filter(**{"purchase_order__vendor_id" if kind == "PO_RECEIPT" else "vendor_id": vendor_id})
        for obj in qs.order_by("-created_at")[:100]:
            if receipt_is_linked(kind, obj.id):
                continue
            try:
                rows.append(receipt_snapshot(bill, kind, obj.id))
            except ValidationError:
                continue
    return sorted(rows, key=lambda row: row["received_at"], reverse=True)[:100]


class PostingRefused(APIException):
    def __init__(self, response):
        self.status_code = response.status_code
        super().__init__(response.data)


def with_bill_grn(kind):
    """Wrap existing posting unchanged, within bill lock and receipt transaction."""
    def decorate(fn):
        @wraps(fn)
        def wrapped(self, request, *args, **kwargs):
            bill_id = request.data.get("inward_bill_id")
            if not bill_id:
                return fn(self, request, *args, **kwargs)
            try:
                bill_id, token = uuid.UUID(str(bill_id)), uuid.UUID(str(request.data.get("client_token", "")))
            except (ValueError, TypeError):
                raise ValidationError("Bill posting requires inward_bill_id and a UUID client_token.")
            header_token = request.headers.get("Idempotency-Key")
            if header_token is not None and header_token.strip() != str(token):
                raise ValidationError("Idempotency-Key must equal the bill posting client_token, or be omitted.")
            obj = get_bill(request.user, bill_id, review=True)
            if not str(request.data.get("vendor_invoice_no", "")).strip():
                raise ValidationError("Enter the invoice or bill reference before posting against an inward bill.")
            from rest_framework import serializers
            complete = serializers.BooleanField().run_validation(request.data.get("bill_complete", False))
            payload = {**dict(request.data), "client_token": token, "posting_kind": kind, "bill_complete": complete}
            def operation():
                bill = InwardBillIntake.objects.select_for_update().get(id=obj.id)
                _open(bill)
                if str(request.data.get("quality_status", "")).upper() == "REJECTED":
                    raise ValidationError("Rejected receipt quality cannot receive a bill.")
                before = bill_safe_snapshot(bill)
                response = fn(self, request, *args, **kwargs)
                if response.status_code == 200:
                    raise Conflict("This posting token already belongs to an existing ERP receipt. Select that receipt explicitly or start a new posting token.")
                if response.status_code != 201:
                    raise PostingRefused(response)
                result = json.loads(JSONRenderer().render(response.data))
                refs = result.get("stock_movements", []) if kind == "UNIFIED" else [{"id": result["id"], "kind": kind}]
                if not refs:
                    raise ValidationError("No posted receipt was returned; bill remains pending.")
                _append_refs(bill, [{"kind": ref.get("kind", ref.get("type")), "id": ref["id"]} for ref in refs], request.user)
                bill.status = "PARTIAL_GRN"
                if complete:
                    _finish(bill, request.user, "Inventory confirmed all bill lines received during GRN posting.")
                bill.save()
                bill_audit(bill, "BILL_RECEIPTED" if complete else "BILL_LINKED", request.user, "Linked normal ERP GRN posting.", before)
                result["inward_bill"] = {"id": str(bill.id), "status": bill.status, "resolved_at": bill.resolved_at.isoformat() if bill.resolved_at else None}
                return result
            result = idempotent_action(obj.plant, f"bill:{obj.id}:posting:{request.user.id}", payload, operation)
            return Response(result, status=200 if result["replayed"] else 201)
        return wrapped
    return decorate


def bill_summary_for_period(start_date, end_date, plant_ids=None):
    start, end = date_bounds(start_date, end_date)
    qs = InwardBillIntake.objects.all()
    if plant_ids is not None:
        qs = qs.filter(plant_id__in=plant_ids)
    return {"bill_arrivals": qs.filter(arrival_at__gte=start, arrival_at__lt=end).count(), "pending_bill_grn": qs.filter(status__in=OPEN_STATUSES).count(), "partial_bill_grn": qs.filter(status="PARTIAL_GRN").count(), "receipted_bills": qs.filter(status="RECEIPTED", resolved_at__gte=start, resolved_at__lt=end).count(), "void_bills": qs.filter(status="VOID", resolved_at__gte=start, resolved_at__lt=end).count()}
