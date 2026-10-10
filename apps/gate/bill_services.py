"""Bills & documents: private arrival evidence, office uploads, classification,
filing and receipt links. ERP receipt services alone post stock; nothing here
creates or changes stock.
"""
import hashlib
import json
import uuid
from datetime import date, timedelta
from decimal import Decimal
from functools import wraps

from django.db import transaction
from django.db.models import Count, Exists, F, OuterRef, Prefetch, Q, Sum, Value
from django.db.models.functions import Coalesce, NullIf
from django.utils import timezone
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.renderers import JSONRenderer
from apps.factory.models import Plant
from apps.inventory.models import BulkTransaction, InventoryRoll, PackagingTransaction, Vendor
from apps.procurement.models import GeneralReceipt, GeneralReceiptLine, PurchaseOrder, PurchaseOrderReceipt, PurchaseOrderReceiptLine, TradingGoodReceipt
from apps.users.permission_service import PermissionService
from .models import DOCUMENT_CATEGORIES, DOCUMENT_TYPES, RECORD_ONLY_CATEGORIES, DocumentOriginalFile, GateAuditEvent, InwardBillIntake, InwardBillPage, InwardBillReceiptReference
from .services import Conflict, date_bounds, gate_today, gate_zone, get_plant, idempotent_action, invoice_fiscal_year, is_owner, is_watchman

OPEN_STATUSES = {"PENDING_GRN", "PARTIAL_GRN"}


def display_name(user):
    """Full name where set (as on other ERP pages), else the login name."""
    if user is None:
        return ""
    return (user.get_full_name() or "").strip() or user.username
# Paper that may be filed as a record when no goods were received against it.
FILEABLE_DOC_TYPES = {"DEBIT_NOTE", "CREDIT_NOTE", "SERVICE_REPORT", "UTILITY_BILL", "OTHER"}
# Receipt kinds that never post production stock (documents.manage may link them).
NON_STOCK_RECEIPT_KINDS = {"GENERAL_RECEIPT"}
DOCUMENT_TYPE_LABELS = dict(DOCUMENT_TYPES)
DOCUMENT_CATEGORY_LABELS = dict(DOCUMENT_CATEGORIES)
REGISTER_STATUSES = {"OPEN", "ALL", "PENDING_GRN", "PARTIAL_GRN", "RECEIPTED", "FILED", "VOID", "NEEDS_CLASSIFYING", "WAITING_RECEIPT", "NON_STOCK_FOLLOWUP"}
REGISTER_ORDERING = {
    "arrival_at": [F("arrival_at").asc(), F("id").asc()],
    "-arrival_at": [F("arrival_at").desc(), F("id").desc()],
    "invoice_date": [F("invoice_date").asc(nulls_last=True), F("arrival_at").asc(), F("id").asc()],
    "-invoice_date": [F("invoice_date").desc(nulls_last=True), F("arrival_at").desc(), F("id").desc()],
    "total_amount": [F("total_amount").asc(nulls_last=True), F("arrival_at").asc(), F("id").asc()],
    "-total_amount": [F("total_amount").desc(nulls_last=True), F("arrival_at").desc(), F("id").desc()],
}
# Keys hidden from watchman responses (header, commercial and resolution details).
OFFICE_ONLY_KEYS = (
    "doc_type", "doc_type_label", "category", "category_label", "vendor", "vendor_name", "vendor_code", "party_name", "party_display",
    "invoice_number", "invoice_date", "invoice_fy", "taxable_amount", "tax_amount", "total_amount", "due_date", "valid_until",
    "ship_to_plant", "ship_to_plant_name", "notes", "original_invoice_ref", "classified_at", "classified_by_name", "header_version",
    "attached_to", "supporting_documents", "original_files", "followup", "needs_followup", "allowed_actions", "duplicate_candidates",
    "resolved_by_name", "timeline",
)


# ── permissions ─────────────────────────────────────────────────────────────

def can_review_stock(user):
    """Stock-receipt authority against bills (GRN posting / stock receipt links)."""
    return PermissionService.has_inventory_bill_review(user)


def can_view_documents(user):
    return can_review_stock(user) or PermissionService.has_document_permission(user, "documents.view")


def can_manage_documents(user):
    return PermissionService.has_document_permission(user, "documents.manage")


def can_upload_documents(user):
    return PermissionService.has_document_permission(user, "documents.upload")


def is_document_master(user):
    return PermissionService.is_gate_master(user)


def require_review(user):
    if not can_review_stock(user):
        raise PermissionDenied("Only an eligible inventory reviewer can receive inward bills.")


def require_manage(user):
    if not can_manage_documents(user):
        raise PermissionDenied("Classifying, filing and voiding documents needs the documents manage right (Inventory by default).")


def require_review_or_manage(user):
    if not (can_review_stock(user) or can_manage_documents(user)):
        raise PermissionDenied("This needs inventory receiving rights or the documents manage right.")


def require_master(user):
    if not is_document_master(user):
        raise PermissionDenied("Only an owner or administrator can correct a filed or voided document.")


def reader_plants(user):
    plants = Plant.objects.none()
    if PermissionService.has_document_permission(user, "documents.view"):
        plants = PermissionService.document_plants(user)
    if can_review_stock(user):
        plants = plants | PermissionService.inventory_review_plants(user)
    return plants


class Perms:
    """Resolved once per request; drives allowed_actions."""
    def __init__(self, user):
        self.watchman = user is not None and is_watchman(user)
        self.review = bool(user) and not self.watchman and can_review_stock(user)
        self.manage = bool(user) and not self.watchman and can_manage_documents(user)
        self.view = bool(user) and not self.watchman and (self.review or can_view_documents(user))
        self.master = bool(user) and not self.watchman and is_document_master(user)


# ── querysets ───────────────────────────────────────────────────────────────

def bill_queryset(user):
    source = InwardBillIntake.objects.select_related(
        "plant", "created_by", "vendor", "ship_to_plant", "classified_by", "resolved_by", "attached_to", "attached_to__vendor",
    ).prefetch_related(
        Prefetch("pages", queryset=InwardBillPage.objects.defer("data")),
        "receipt_references",
        Prefetch("original_files", queryset=DocumentOriginalFile.objects.defer("data")),
        Prefetch("supporting_documents", queryset=InwardBillIntake.objects.select_related("vendor").annotate(_page_count=Count("pages")).order_by("arrival_at", "id")),
    )
    if can_view_documents(user):
        return source.filter(plant__in=reader_plants(user))
    if is_watchman(user):
        from .services import scoped_plants
        start, end = date_bounds(gate_today(), gate_today())
        return source.filter(plant__in=scoped_plants(user), created_by=user, arrival_at__gte=start, arrival_at__lt=end)
    raise PermissionDenied("This account cannot access bills and documents.")


def get_bill(user, pk, review=False):
    if review:
        require_review(user)
    obj = bill_queryset(user).filter(id=pk).first()
    if not obj:
        raise NotFound("This inward bill is unavailable.")
    return obj


def _lock(bill_id):
    return InwardBillIntake.objects.select_for_update().get(id=bill_id)


# ── header helpers ──────────────────────────────────────────────────────────

def normalise_invoice(value):
    return " ".join(str(value or "").upper().split())


def normalise_party(value):
    return " ".join(str(value or "").split())


def bill_ref(bill_id):
    return str(bill_id).replace("-", "")[:8].upper()


def money(value):
    return str(value) if value is not None else None


def iso(value):
    return value.isoformat() if value else None


def party_display(bill):
    if bill.vendor_id:
        return bill.vendor.name
    return bill.party_name or ""


def bill_safe_snapshot(obj):
    return {
        "status": obj.status, "source": obj.source, "arrival_at": obj.arrival_at.isoformat(), "page_count": obj.pages.count(),
        "review_data": obj.review_data, "receipt_refs": [ref.snapshot for ref in obj.receipt_references.all()],
        "resolved_at": iso(obj.resolved_at), "resolution_code": obj.resolution_code,
        "doc_type": obj.doc_type, "category": obj.category, "vendor_id": str(obj.vendor_id) if obj.vendor_id else None,
        "party_name": obj.party_name, "invoice_number": obj.invoice_number, "invoice_date": iso(obj.invoice_date), "invoice_fy": obj.invoice_fy,
        "taxable_amount": money(obj.taxable_amount), "tax_amount": money(obj.tax_amount), "total_amount": money(obj.total_amount),
        "due_date": iso(obj.due_date), "valid_until": iso(obj.valid_until),
        "ship_to_plant": str(obj.ship_to_plant_id) if obj.ship_to_plant_id else None,
        "attached_to": str(obj.attached_to_id) if obj.attached_to_id else None, "header_version": obj.header_version,
    }


def bill_audit(obj, action, actor, reason="", before=None, extra=None):
    after = bill_safe_snapshot(obj)
    if extra:
        after.update(extra)
    GateAuditEvent.objects.create(plant_id=obj.plant_id, object_id=obj.id, object_type="BILL", action=action, actor=actor, reason=reason[:500], before=before or {}, after=after)


def _sync_review_data(bill):
    review = dict(bill.review_data or {})
    if bill.vendor_id:
        review["vendor_id"] = str(bill.vendor_id)
        review["vendor_name"] = bill.vendor.name
    else:
        review.pop("vendor_id", None)
        review.pop("vendor_name", None)
    if bill.invoice_number:
        review["invoice_number"] = bill.invoice_number
    else:
        review.pop("invoice_number", None)
    review["invoice_date"] = iso(bill.invoice_date)
    bill.review_data = review


def _derive_fiscal_year(bill):
    if bill.invoice_date:
        bill.invoice_fy = invoice_fiscal_year(bill.invoice_date)
    elif bill.invoice_number:
        bill.invoice_fy = invoice_fiscal_year(bill.arrival_at.astimezone(gate_zone()).date())
    else:
        bill.invoice_fy = None


def adopt_legacy_review(bill):
    """Bills reviewed before the register columns existed keep their GRN prefill
    (vendor / invoice) in review_data only; copy it into blank columns."""
    review = bill.review_data or {}
    changed = False
    if not bill.vendor_id and not bill.party_name and review.get("vendor_id"):
        vendor = Vendor.objects.filter(id=str(review["vendor_id"])).first()
        if vendor:
            bill.vendor = vendor
            changed = True
    if not bill.invoice_number and str(review.get("invoice_number") or "").strip():
        bill.invoice_number = " ".join(str(review["invoice_number"]).split())[:80]
        bill.invoice_normalized = normalise_invoice(bill.invoice_number)
        changed = True
    if not bill.invoice_date and review.get("invoice_date"):
        try:
            bill.invoice_date = date.fromisoformat(str(review["invoice_date"]))
            changed = True
        except ValueError:
            pass
    if changed:
        _derive_fiscal_year(bill)
    return changed


def backfill_headers_from_review(batch_size=500):
    """One-off backfill of register columns for bills reviewed before the
    document register existed. Safe to re-run; never overwrites typed values."""
    updated = 0
    candidates = InwardBillIntake.objects.filter(Q(review_data__has_key="vendor_id") | Q(review_data__has_key="invoice_number") | Q(review_data__has_key="invoice_date")).order_by("id")
    for pk in candidates.values_list("id", flat=True).iterator(chunk_size=batch_size):
        with transaction.atomic():
            bill = _lock(pk)
            if adopt_legacy_review(bill):
                bill.save(update_fields=["vendor", "invoice_number", "invoice_normalized", "invoice_date", "invoice_fy"])
                updated += 1
    return updated


def apply_header(bill, data, has_refs=False):
    """Validate and apply the header keys present in ``data`` to ``bill`` (unsaved)."""
    adopt_legacy_review(bill)
    errors = {}
    if "vendor_id" in data:
        vendor = None
        if data["vendor_id"]:
            vendor = Vendor.objects.filter(id=data["vendor_id"], status="ACTIVE").first()
            if not vendor:
                errors["vendor_id"] = "Choose an active vendor from the master list."
        bill.vendor = vendor
        if vendor:
            bill.party_name = ""
    if "party_name" in data:
        name = normalise_party(data["party_name"])
        if name and data.get("vendor_id"):
            errors["party_name"] = "Choose a master vendor or type a party name, not both."
        elif name:
            bill.vendor = None
            bill.party_name = name
        elif not bill.vendor_id:
            bill.party_name = ""
    if "doc_type" in data:
        bill.doc_type = data["doc_type"] or ""
    if "category" in data:
        category = data["category"] or ""
        if category != bill.category and has_refs and (category in RECORD_ONLY_CATEGORIES or not category):
            errors["category"] = "This document already has receipts linked, so it cannot become a record-only category."
        bill.category = category
    if "invoice_number" in data:
        bill.invoice_number = " ".join(str(data["invoice_number"] or "").split())
        bill.invoice_normalized = normalise_invoice(bill.invoice_number)
    if "invoice_date" in data:
        if data["invoice_date"] and data["invoice_date"] > gate_today() + timedelta(days=1):
            errors["invoice_date"] = "Invoice date cannot be in the future."
        bill.invoice_date = data["invoice_date"]
    for field in ("taxable_amount", "tax_amount", "total_amount", "due_date", "valid_until"):
        if field in data:
            setattr(bill, field, data[field])
    if "ship_to_plant" in data:
        target = None
        if data["ship_to_plant"]:
            target = Plant.objects.filter(id=data["ship_to_plant"]).first()
            if not target:
                errors["ship_to_plant"] = "Choose an existing factory."
        bill.ship_to_plant = None if not target or target.id == bill.plant_id else target
    if "notes" in data:
        review = dict(bill.review_data or {})
        review["notes"] = str(data["notes"] or "").strip()
        bill.review_data = review
    amounts = [bill.taxable_amount, bill.tax_amount, bill.total_amount]
    if all(value is not None for value in amounts) and abs(amounts[0] + amounts[1] - amounts[2]) > Decimal("1.00"):
        errors["total_amount"] = f"Taxable {amounts[0]} + tax {amounts[1]} = {amounts[0] + amounts[1]}, which differs from the total {amounts[2]} by more than ₹1. Check the amounts."
    if bill.invoice_date and bill.due_date and bill.due_date < bill.invoice_date:
        errors["due_date"] = "Due date is before the invoice date."
    if bill.invoice_date and bill.valid_until and bill.valid_until < bill.invoice_date:
        errors["valid_until"] = "Valid-until date is before the invoice date."
    if errors:
        raise ValidationError(errors)
    _derive_fiscal_year(bill)
    _sync_review_data(bill)


def adopt_header_from_receipts(bill, snapshots, category=""):
    """Fill blank header columns from posted receipts (never overwrites typed values)."""
    changed = False
    if category and not bill.category:
        bill.category = category
        changed = True
        if not bill.doc_type:
            bill.doc_type = "TAX_INVOICE"
    vendors = {row.get("vendor_id") for row in snapshots if row.get("vendor_id")}
    if not bill.vendor_id and not bill.party_name and len(vendors) == 1:
        vendor = Vendor.objects.filter(id=next(iter(vendors))).first()
        if vendor:
            bill.vendor = vendor
            changed = True
    invoices = {" ".join(str(row.get("invoice_number") or "").split()) for row in snapshots}
    invoices.discard("")
    if not bill.invoice_number and len(invoices) == 1:
        bill.invoice_number = next(iter(invoices))
        bill.invoice_normalized = normalise_invoice(bill.invoice_number)
        changed = True
    if changed:
        # Columns only: review_data stays the human-reviewed GRN check, so a
        # later receipt is never refused because of an automatic fill.
        _derive_fiscal_year(bill)
        bill.header_version += 1


# ── duplicates ──────────────────────────────────────────────────────────────

def duplicate_queryset(bill):
    """Other non-void documents with the same vendor (or typed party) + invoice + FY, any plant."""
    if not bill.invoice_normalized or bill.invoice_fy is None or not (bill.vendor_id or bill.party_name):
        return InwardBillIntake.objects.none()
    if bill.vendor_id:
        party = Q(vendor_id=bill.vendor_id) | Q(vendor__isnull=True, party_name__iexact=bill.vendor.name)
    else:
        party = Q(party_name__iexact=bill.party_name) | Q(vendor__name__iexact=bill.party_name)
    related = Q(attached_to_id=bill.id)
    if bill.attached_to_id:
        related |= Q(id=bill.attached_to_id)
    return InwardBillIntake.objects.filter(party, invoice_normalized=bill.invoice_normalized, invoice_fy=bill.invoice_fy).exclude(id=bill.id).exclude(status="VOID").exclude(related)


def duplicate_candidates(bill, limit=10):
    rows = duplicate_queryset(bill).select_related("plant", "vendor").order_by("-arrival_at", "-id")[:limit]
    return [{
        "id": str(row.id), "ref": bill_ref(row.id), "plant": str(row.plant_id), "plant_name": row.plant.name, "status": row.status,
        "source": row.source, "arrival_at": row.arrival_at.isoformat(), "party_display": party_display(row),
        "invoice_number": row.invoice_number, "invoice_date": iso(row.invoice_date), "total_amount": money(row.total_amount),
    } for row in rows]


def _refuse_duplicates(bill, override_reason):
    rows = duplicate_candidates(bill, limit=5)
    if rows and not override_reason:
        refs = ", ".join(f"{row['ref']} ({row['plant_name']}, {row['status'].replace('_', ' ').lower()})" for row in rows)
        raise Conflict({"duplicate_override_reason": f"Invoice {bill.invoice_number} from {party_display(bill)} is already recorded on {refs}. Void this one as a duplicate, or give a reason to continue anyway."})
    return rows


# ── payload ─────────────────────────────────────────────────────────────────

def _page_rows(bill, rotations):
    """Same shape as document_pages.serialize_pages, using a batched rotation map."""
    rows = []
    for page in bill.pages.all():
        url = f"/api/gate/inward-bills/{bill.id}/pages/{page.id}/"
        rows.append({
            "id": str(page.id), "page_number": page.page_number, "width": page.width, "height": page.height, "byte_size": page.byte_size,
            "image_url": url, "thumb_url": f"{url}?w=320", "display_rotation": rotations.get(str(page.id), 0), "page_kind": "INWARD",
        })
    return rows


class PayloadContext:
    """Batched lookups for a page of bills so list payloads avoid N+1 queries."""
    def __init__(self, bills, user=None):
        from .document_pages import rotation_map

        bills = list(bills)
        self.perms = Perms(user)
        self.rotations = rotation_map("INWARD", [page.id for bill in bills for page in bill.pages.all()])
        pairs = {(bill.plant_id, bill.content_hash) for bill in bills}
        self.hash_twins = {}
        if pairs:
            rows = InwardBillIntake.objects.filter(content_hash__in={pair[1] for pair in pairs}, plant_id__in={pair[0] for pair in pairs}).order_by("-arrival_at", "-id").values_list("id", "plant_id", "content_hash")
            for pk, plant_id, digest in rows:
                self.hash_twins.setdefault((plant_id, digest), []).append(str(pk))
        gr_ids = [ref.object_id for bill in bills for ref in bill.receipt_references.all() if ref.kind == "GENERAL_RECEIPT"]
        self.gr_status = {str(pk): status for pk, status in GeneralReceipt.objects.filter(id__in=gr_ids).values_list("id", "status")} if gr_ids else {}
        void_ids = [bill.id for bill in bills if bill.status == "VOID" and bill.resolution_code == "NON_STOCK"]
        self.followups = {}
        if void_ids:
            for row in GeneralReceipt.objects.filter(document_id__in=void_ids, status="POSTED").order_by("received_at").values("document_id", "id", "number"):
                self.followups.setdefault(str(row["document_id"]), {"id": str(row["id"]), "number": row["number"]})


def allowed_actions(bill, perms, refs, followup):
    if perms.watchman or not perms.view:
        return []
    actions = ["view"]
    open_ = bill.status in OPEN_STATUSES
    has_refs = bool(refs)
    supporting = list(bill.supporting_documents.all())
    if open_ and perms.manage:
        actions.append("classify")
        if not has_refs and (bill.category in RECORD_ONLY_CATEGORIES or bill.doc_type in FILEABLE_DOC_TYPES):
            actions.append("file")
        if not has_refs and not supporting:
            actions.append("attach")
        if bill.category not in RECORD_ONLY_CATEGORIES:
            actions.append("general_receipt")
    if open_ and (perms.review or perms.manage):
        actions.append("link_receipts")
        if not has_refs and not supporting:
            actions.append("void")
    if open_ and perms.review and bill.category in {"", "STOCK"}:
        actions.append("grn")
    if open_ and perms.review and bill.category in {"", "JOBWORK"}:
        actions.append("jobwork")
    if bill.status == "PARTIAL_GRN" and has_refs and (perms.review or (perms.manage and all(ref.kind in NON_STOCK_RECEIPT_KINDS for ref in refs))):
        actions.append("complete")
    if perms.master and bill.status == "FILED" and bill.attached_to_id:
        actions.append("detach")
    if perms.master and bill.status in {"FILED", "VOID"} and not has_refs and not followup:
        actions.append("reopen")
    if perms.manage and bill.status == "VOID" and bill.resolution_code == "NON_STOCK" and not followup:
        actions.append("followup")
    if list(bill.original_files.all()):
        actions.append("download_original")
    return actions


def bill_payload(obj, user=None, ctx=None, detail=False):
    ctx = ctx or PayloadContext([obj], user)
    perms = ctx.perms
    pages = _page_rows(obj, ctx.rotations)
    twins = [pk for pk in ctx.hash_twins.get((obj.plant_id, obj.content_hash), []) if pk != str(obj.id)][:10]
    base = {
        "id": str(obj.id), "ref": bill_ref(obj.id), "plant": str(obj.plant_id), "plant_name": obj.plant.name, "arrival_at": obj.arrival_at.isoformat(),
        "status": obj.status, "source": obj.source, "created_by_name": display_name(obj.created_by), "page_count": len(pages), "pages": pages,
        "review_data": {}, "receipt_refs": [], "resolution_reason": "", "resolution_code": "", "resolved_at": iso(obj.resolved_at),
        "duplicate_warning": {"possible_duplicate": bool(twins), "bill_ids": []},
    }
    if perms.watchman or not perms.view:
        return base
    refs = list(obj.receipt_references.all())
    receipt_refs = []
    for ref in refs:
        row = dict(ref.snapshot)
        if ref.kind == "GENERAL_RECEIPT":
            row["receipt_status"] = ctx.gr_status.get(str(ref.object_id), "POSTED")
        receipt_refs.append(row)
    followup = ctx.followups.get(str(obj.id))
    supporting = list(obj.supporting_documents.all())
    originals = list(obj.original_files.all())
    review = obj.review_data or {}
    attached = obj.attached_to
    base.update({
        "review_data": review, "receipt_refs": receipt_refs, "resolution_reason": obj.resolution_reason, "resolution_code": obj.resolution_code,
        "resolved_by_name": display_name(obj.resolved_by) if obj.resolved_by_id else None,
        "duplicate_warning": {"possible_duplicate": bool(twins), "bill_ids": twins},
        "doc_type": obj.doc_type, "doc_type_label": DOCUMENT_TYPE_LABELS.get(obj.doc_type, ""),
        "category": obj.category, "category_label": DOCUMENT_CATEGORY_LABELS.get(obj.category, ""),
        "vendor": str(obj.vendor_id) if obj.vendor_id else None, "vendor_name": obj.vendor.name if obj.vendor_id else None,
        "vendor_code": obj.vendor.code if obj.vendor_id else None, "party_name": obj.party_name, "party_display": party_display(obj),
        # Bills reviewed before the register columns existed fall back to their GRN prefill.
        "invoice_number": obj.invoice_number or str(review.get("invoice_number") or ""),
        "invoice_date": iso(obj.invoice_date) or (str(review["invoice_date"]) if review.get("invoice_date") else None), "invoice_fy": obj.invoice_fy,
        "taxable_amount": money(obj.taxable_amount), "tax_amount": money(obj.tax_amount), "total_amount": money(obj.total_amount),
        "due_date": iso(obj.due_date), "valid_until": iso(obj.valid_until),
        "ship_to_plant": str(obj.ship_to_plant_id) if obj.ship_to_plant_id else None, "ship_to_plant_name": obj.ship_to_plant.name if obj.ship_to_plant_id else None,
        "notes": str(review.get("notes") or ""), "original_invoice_ref": str(review.get("original_invoice_ref") or ""),
        "classified_at": iso(obj.classified_at), "classified_by_name": display_name(obj.classified_by) if obj.classified_by_id else None,
        "header_version": obj.header_version,
        "attached_to": {"id": str(attached.id), "ref": bill_ref(attached.id), "party_display": party_display(attached), "invoice_number": attached.invoice_number, "status": attached.status} if attached else None,
        "supporting_documents": [{
            "id": str(row.id), "ref": bill_ref(row.id), "doc_type": row.doc_type, "doc_type_label": DOCUMENT_TYPE_LABELS.get(row.doc_type, ""),
            "category": row.category, "party_display": party_display(row), "invoice_number": row.invoice_number, "invoice_date": iso(row.invoice_date),
            "total_amount": money(row.total_amount), "status": row.status, "arrival_at": row.arrival_at.isoformat(), "page_count": getattr(row, "_page_count", None),
        } for row in supporting],
        "original_files": [{
            "id": str(row.id), "file_name": row.file_name, "content_type": row.content_type, "byte_size": row.byte_size, "page_count": row.page_count,
            "created_at": row.created_at.isoformat(), "download_url": f"/api/gate/inward-bills/{obj.id}/originals/{row.id}/",
        } for row in originals],
        "followup": followup,
        "needs_followup": obj.status == "VOID" and obj.resolution_code == "NON_STOCK" and not followup,
        "allowed_actions": allowed_actions(obj, perms, refs, followup),
    })
    if detail:
        base["duplicate_candidates"] = duplicate_candidates(obj)
        base["timeline"] = [{
            "id": str(event.id), "action": event.action, "actor_name": display_name(event.actor) if event.actor_id else None,
            "reason": event.reason, "created_at": event.created_at.isoformat(),
        } for event in GateAuditEvent.objects.filter(object_id=obj.id, object_type="BILL").select_related("actor").order_by("created_at", "id")[:200]]
    return base


def current_actor_payload(payload, user):
    """Apply current permissions even when the receipt was cached by a master."""
    if not is_watchman(user):
        return payload
    redacted = {key: value for key, value in payload.items() if key not in OFFICE_ONLY_KEYS}
    return {**redacted, "review_data": {}, "receipt_refs": [], "resolution_reason": "", "resolution_code": "", "duplicate_warning": {**payload.get("duplicate_warning", {}), "bill_ids": []}}


def fresh_payload(user, bill_id, detail=True):
    bill = bill_queryset(user).get(id=bill_id)
    return bill_payload(bill, user, detail=detail)


# ── arrival / upload ────────────────────────────────────────────────────────

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
        return bill_payload(bill_queryset(user).get(id=bill.id), user)
    safe_data = {"client_token": data["client_token"], "plant": data["plant"], "images": [{key: page[key] for key in ["sha256", "width", "height", "byte_size"]} for page in data["images"]]}
    return current_actor_payload(idempotent_action(plant, f"bill:upload:{user.id}", safe_data, operation), user)


def office_upload(user, data):
    """Office upload (photos and/or PDFs): one document, rendered pages, originals kept. No arrival alert."""
    if not can_upload_documents(user):
        raise PermissionDenied("Uploading bills needs the documents upload right (Inventory by default).")
    plant = PermissionService.document_plants(user).filter(id=data["plant"]).first()
    if not plant:
        raise PermissionDenied("This factory is unavailable for document uploads.")
    from .bill_serializers import HEADER_FIELDS
    header = {key: data[key] for key in HEADER_FIELDS if key in data}
    pages, originals = data["files"]["pages"], data["files"]["originals"]
    def operation():
        digest = hashlib.sha256("|".join(page["sha256"] for page in pages).encode()).hexdigest()
        bill = InwardBillIntake(plant=plant, created_by=user, content_hash=digest, source="OFFICE", arrival_at=timezone.now())
        if header:
            apply_header(bill, header)
            bill.header_version = 1
            bill.classified_at, bill.classified_by = timezone.now(), user
        bill.save()
        InwardBillPage.objects.bulk_create([InwardBillPage(intake=bill, page_number=index + 1, **page) for index, page in enumerate(pages)])
        for original in originals:
            DocumentOriginalFile.objects.create(intake=bill, **{key: original[key] for key in ("file_name", "content_type", "byte_size", "sha256", "page_count", "data")})
        bill_audit(bill, "BILL_OFFICE_UPLOADED", user, extra={"original_files": [{"file_name": row["file_name"], "sha256": row["sha256"], "page_count": row["page_count"]} for row in originals]})
        return bill_payload(bill_queryset(user).get(id=bill.id), user, detail=True)
    safe_data = {
        "client_token": data["client_token"], "plant": data["plant"], "header": json.loads(json.dumps(header, default=str)),
        "pages": [{key: page[key] for key in ("sha256", "width", "height", "byte_size")} for page in pages],
        "originals": [{key: row[key] for key in ("file_name", "sha256", "byte_size", "page_count", "first_page")} for row in originals],
    }
    return idempotent_action(plant, f"bill:office:{user.id}", safe_data, operation)


# ── office actions ──────────────────────────────────────────────────────────

def _open(bill):
    if bill.status not in OPEN_STATUSES:
        raise Conflict("This bill is resolved. Refresh the inventory queue.")


def _open_for_header(bill):
    if bill.status == "FILED":
        raise Conflict("This document is filed. Ask an owner or administrator to reopen it before changing its details.")
    _open(bill)


def _check_review_refs(bill, snapshots, review_data=None):
    reviewed = bill.review_data if review_data is None else review_data
    vendors = {row["vendor_id"] for row in snapshots}
    if len(vendors) > 1:
        raise ValidationError("All receipts for one bill must share a vendor.")
    if reviewed.get("vendor_id") and vendors and vendors != {reviewed["vendor_id"]}:
        raise ValidationError("Receipt vendor differs from the reviewed bill.")
    if reviewed.get("invoice_number") and any(str(row.get("invoice_number") or "").strip().upper() != reviewed["invoice_number"].strip().upper() for row in snapshots):
        raise ValidationError("Receipt invoice differs from the reviewed bill.")


def review_bill(user, obj, data):
    require_review_or_manage(user)
    def operation():
        bill = _lock(obj.id)
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
        # Keep the register columns in step with the GRN prefill fields.
        header = {}
        if "vendor_id" in data:
            header["vendor_id"] = data["vendor_id"]
        if "invoice_number" in data:
            header["invoice_number"] = data["invoice_number"]
        if "invoice_date" in data:
            header["invoice_date"] = data["invoice_date"]
        if header:
            apply_header(bill, header, has_refs=bill.receipt_references.exists())
            bill.review_data = {**review, **{key: value for key, value in bill.review_data.items() if key in {"vendor_id", "vendor_name", "invoice_number", "invoice_date"}}}
            bill.header_version += 1
        bill.save()
        bill_audit(bill, "BILL_REVIEWED", user, before=before)
        return fresh_payload(user, bill.id)
    return idempotent_action(obj.plant, f"bill:{obj.id}:review:{user.id}", data, operation)


def classify_bill(user, obj, data):
    require_manage(user)
    from .bill_serializers import HEADER_FIELDS
    header = {key: data[key] for key in HEADER_FIELDS if key in data}
    def operation():
        bill = _lock(obj.id)
        _open_for_header(bill)
        if data["header_version"] != bill.header_version:
            raise Conflict("Someone else saved this document's details. Refresh to see their changes, then save again.")
        before = bill_safe_snapshot(bill)
        refs = [ref.snapshot for ref in bill.receipt_references.all()]
        apply_header(bill, header, has_refs=bool(refs))
        _check_review_refs(bill, refs)
        bill.header_version += 1
        bill.classified_at, bill.classified_by = timezone.now(), user
        bill.save()
        bill_audit(bill, "BILL_CLASSIFIED", user, before=before)
        return fresh_payload(user, bill.id)
    return idempotent_action(obj.plant, f"bill:{obj.id}:classify:{user.id}", data, operation)


def _resolve(bill, user, status, reason):
    bill.status, bill.resolved_at, bill.resolved_by, bill.resolution_reason = status, timezone.now(), user, reason[:500]


def file_bill(user, obj, data):
    require_manage(user)
    def operation():
        bill = _lock(obj.id)
        if bill.status == "FILED":
            raise Conflict("This document is already filed.")
        _open(bill)
        if "header_version" in data and data["header_version"] != bill.header_version:
            raise Conflict("Someone else saved this document's details. Refresh and check them before filing.")
        if bill.receipt_references.exists():
            raise Conflict("Receipts are already linked to this document. Confirm it complete instead of filing it.")
        if not (bill.category in RECORD_ONLY_CATEGORIES or bill.doc_type in FILEABLE_DOC_TYPES):
            raise ValidationError({"category": "Only record-only paper can be filed: a utility, professional/statutory fee, transport or other-expense bill, or a debit/credit note, service report, utility bill or other document without goods. Choose its category first."})
        missing = {}
        if not (bill.vendor_id or bill.party_name):
            missing["vendor_id"] = "Choose the vendor or type the party name before filing."
        if not bill.invoice_number:
            missing["invoice_number"] = "Enter the bill / invoice number before filing."
        if not bill.invoice_date:
            missing["invoice_date"] = "Enter the bill date before filing."
        if bill.total_amount is None:
            missing["total_amount"] = "Enter the bill total before filing."
        if missing:
            raise ValidationError(missing)
        override = (data.get("duplicate_override_reason") or "").strip()
        duplicates = _refuse_duplicates(bill, override)
        before = bill_safe_snapshot(bill)
        original_ref = (data.get("original_invoice_ref") or "").strip()
        if original_ref:
            if bill.doc_type not in {"DEBIT_NOTE", "CREDIT_NOTE"}:
                raise ValidationError({"original_invoice_ref": "Only debit and credit notes refer to an original invoice."})
            bill.review_data = {**bill.review_data, "original_invoice_ref": original_ref}
        label = DOCUMENT_CATEGORY_LABELS.get(bill.category) or DOCUMENT_TYPE_LABELS.get(bill.doc_type) or "document"
        _resolve(bill, user, "FILED", (data.get("reason") or "").strip() or f"Filed as a record ({label.lower()}).")
        bill.save()
        extra = {"duplicate_override_reason": override, "duplicate_ids": [row["id"] for row in duplicates]} if duplicates else None
        bill_audit(bill, "BILL_FILED", user, bill.resolution_reason, before, extra)
        return fresh_payload(user, bill.id)
    return idempotent_action(obj.plant, f"bill:{obj.id}:file:{user.id}", data, operation)


def attach_bill(user, obj, data):
    """File a supporting paper (e.g. transport LR) under another document of the same factory."""
    require_manage(user)
    target_id = data["target_bill_id"]
    if str(target_id) == str(obj.id):
        raise ValidationError({"target_bill_id": "Choose another document to attach this one to."})
    if not bill_queryset(user).filter(id=target_id).exists():
        raise ValidationError({"target_bill_id": "That document is unavailable."})
    def operation():
        locked = {str(row.id): row for row in InwardBillIntake.objects.select_for_update().filter(id__in=[obj.id, target_id]).order_by("id")}
        bill, target = locked[str(obj.id)], locked[str(target_id)]
        if bill.status == "FILED":
            raise Conflict("This document is already filed.")
        _open(bill)
        if target.plant_id != bill.plant_id:
            raise ValidationError({"target_bill_id": "Attach only to a document from the same factory."})
        if target.status == "VOID":
            raise ValidationError({"target_bill_id": "That document is voided. Choose the live bill."})
        if target.attached_to_id:
            raise ValidationError({"target_bill_id": f"That document is itself attached to {bill_ref(target.attached_to_id)}. Attach to the main bill instead."})
        if bill.receipt_references.exists():
            raise Conflict("Receipts are linked to this document, so it cannot become a supporting paper.")
        if bill.supporting_documents.exists():
            raise Conflict("Other papers are attached to this document. Detach them first.")
        before, target_before = bill_safe_snapshot(bill), bill_safe_snapshot(target)
        bill.attached_to = target
        _resolve(bill, user, "FILED", data["reason"])
        bill.save()
        bill_audit(bill, "BILL_ATTACHED", user, data["reason"], before, {"attached_to_ref": bill_ref(target.id)})
        bill_audit(target, "BILL_SUPPORT_ADDED", user, data["reason"], target_before, {"supporting_document": str(bill.id)})
        return fresh_payload(user, bill.id)
    return idempotent_action(obj.plant, f"bill:{obj.id}:attach:{user.id}", data, operation)


def detach_bill(user, obj, data):
    require_master(user)
    def operation():
        bill = _lock(obj.id)
        if bill.status != "FILED" or not bill.attached_to_id:
            raise Conflict("Only a filed supporting document can be detached.")
        target = _lock(bill.attached_to_id)
        before, target_before = bill_safe_snapshot(bill), bill_safe_snapshot(target)
        bill.attached_to = None
        bill.status, bill.resolved_at, bill.resolved_by, bill.resolution_reason = "PENDING_GRN", None, None, ""
        bill.save()
        bill_audit(bill, "BILL_DETACHED", user, data["reason"], before)
        bill_audit(target, "BILL_SUPPORT_REMOVED", user, data["reason"], target_before, {"supporting_document": str(bill.id)})
        return fresh_payload(user, bill.id)
    return idempotent_action(obj.plant, f"bill:{obj.id}:detach:{user.id}", data, operation)


def reopen_bill(user, obj, data):
    require_master(user)
    def operation():
        bill = _lock(obj.id)
        if bill.status not in {"FILED", "VOID"}:
            raise Conflict("Only filed or voided documents can be reopened.")
        if bill.receipt_references.exists():
            raise Conflict("Receipts are linked to this document, so it cannot be reopened.")
        if GeneralReceipt.objects.filter(document_id=bill.id, status="POSTED").exists():
            raise Conflict("A posted General Receipt follows up this document. Reverse that receipt first.")
        before = bill_safe_snapshot(bill)
        previous = bill.attached_to_id
        bill.attached_to = None
        bill.duplicate_of = None
        bill.status, bill.resolved_at, bill.resolved_by, bill.resolution_reason, bill.resolution_code = "PENDING_GRN", None, None, "", ""
        bill.save()
        bill_audit(bill, "BILL_REOPENED", user, data["reason"], before)
        if previous:
            target = InwardBillIntake.objects.get(id=previous)
            bill_audit(target, "BILL_SUPPORT_REMOVED", user, data["reason"], {}, {"supporting_document": str(bill.id)})
        return fresh_payload(user, bill.id)
    return idempotent_action(obj.plant, f"bill:{obj.id}:reopen:{user.id}", data, operation)


# ── receipt kinds and links ─────────────────────────────────────────────────

STOCK_RECEIPT_KINDS = ("BULK", "ROLL", "PACKAGING", "PO_RECEIPT", "TRADING")
# Header category adopted when a receipt of this kind is the first link.
KIND_CATEGORY = {"BULK": "STOCK", "ROLL": "STOCK", "PACKAGING": "STOCK", "PO_RECEIPT": "STOCK", "TRADING": "STOCK", "JOBWORK_RETURN": "JOBWORK"}

# Receipt kinds owned by other modules (General Receipt, Job-work Return).
# Each handler is {"snapshot": fn(bill, pk, lock) -> dict, "is_linked": fn(pk) -> bool | None,
# "on_linked": fn(bill, pk, user) | None, "candidates": fn(bill, search, vendor_id) -> [dict] | None}.
# The snapshot must enforce plant/vendor/timing rules and return the same keys
# as stock snapshots (kind, id, reference, invoice_number, vendor_id,
# vendor_name, plant, received_at, quantity, quantities_by_uom, uom, quality_status).
EXTRA_RECEIPT_KINDS = {}


def register_receipt_kind(kind, snapshot, is_linked=None, on_linked=None, candidates=None):
    EXTRA_RECEIPT_KINDS[kind] = {"snapshot": snapshot, "is_linked": is_linked, "on_linked": on_linked, "candidates": candidates}


def receipt_kinds():
    return list(STOCK_RECEIPT_KINDS) + sorted(EXTRA_RECEIPT_KINDS)


def receipt_snapshot(bill, kind, pk, lock=False):
    if kind in EXTRA_RECEIPT_KINDS:
        return EXTRA_RECEIPT_KINDS[kind]["snapshot"](bill, pk, lock)
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
        handler = EXTRA_RECEIPT_KINDS.get(row["kind"], {})
        if handler.get("on_linked"):
            handler["on_linked"](bill, row["id"], user)
    return snapshots


def receipt_is_linked(kind, pk):
    if InwardBillReceiptReference.objects.filter(kind=kind, object_id=pk).exists():
        return True
    if kind in EXTRA_RECEIPT_KINDS:
        checker = EXTRA_RECEIPT_KINDS[kind]["is_linked"]
        return bool(checker(pk)) if checker else False
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


def _require_link_permission(user, kinds):
    if set(kinds) <= NON_STOCK_RECEIPT_KINDS:
        require_review_or_manage(user)
    else:
        require_review(user)


def _finish(bill, user, reason):
    if not bill.receipt_references.exists():
        raise ValidationError("Post or link at least one receipt before confirming the bill complete.")
    bill.status, bill.resolved_at, bill.resolved_by = "RECEIPTED", timezone.now(), user
    bill.resolution_reason = reason


def _category_for(snapshots, category=""):
    if category:
        return category
    kinds = {row["kind"] for row in snapshots}
    found = {KIND_CATEGORY[kind] for kind in kinds if kind in KIND_CATEGORY}
    return next(iter(found)) if len(found) == 1 else ""


def attach_receipt_to_bill(user, bill_id, kind, object_id, *, complete=False, reason="", category=""):
    """Link a freshly posted receipt (any registered kind) to an open bill.

    Call inside the caller's transaction, after the receipt row exists, so the
    receipt and its bill link commit or roll back together. Locks the bill,
    enforces vendor/invoice consistency and one-bill-per-receipt, moves the
    bill to PARTIAL_GRN (or RECEIPTED when ``complete``) and writes audit.
    Blank header columns are filled from the receipt (``category`` overrides
    the kind's default category). Returns {"id", "status", "resolved_at"}.
    """
    if not transaction.get_connection().in_atomic_block:
        raise RuntimeError("attach_receipt_to_bill must run inside the receipt transaction.")
    _require_link_permission(user, [kind])
    obj = get_bill(user, bill_id)
    bill = _lock(obj.id)
    _open(bill)
    before = bill_safe_snapshot(bill)
    snapshots = _append_refs(bill, [{"kind": kind, "id": str(object_id)}], user)
    adopt_header_from_receipts(bill, snapshots, _category_for(snapshots, category))
    bill.status = "PARTIAL_GRN"
    if complete:
        _finish(bill, user, reason or "Inventory confirmed all bill lines received.")
    bill.save()
    bill_audit(bill, "BILL_RECEIPTED" if complete else "BILL_LINKED", user, reason or f"Linked {kind.replace('_', ' ').lower()}.", before)
    return {"id": str(bill.id), "status": bill.status, "resolved_at": iso(bill.resolved_at)}


def resolve_bill(user, obj, data, action):
    if action == "link-receipts":
        _require_link_permission(user, [row["kind"] for row in data["receipt_refs"]])
    else:
        require_review_or_manage(user)
    def operation():
        bill = _lock(obj.id)
        _open(bill)
        before = bill_safe_snapshot(bill)
        if action == "link-receipts":
            snapshots = _append_refs(bill, data["receipt_refs"], user)
            adopt_header_from_receipts(bill, snapshots, _category_for(snapshots))
            bill.status = "PARTIAL_GRN"
            if data.get("bill_complete"):
                _finish(bill, user, data["reason"])
        elif action == "complete":
            kinds = list(bill.receipt_references.values_list("kind", flat=True))
            if not (can_review_stock(user) or (kinds and set(kinds) <= NON_STOCK_RECEIPT_KINDS)):
                raise PermissionDenied("Only an eligible inventory reviewer can confirm stock receipts complete.")
            _finish(bill, user, data["reason"])
        else:
            if bill.receipt_references.exists():
                raise Conflict("A bill with posted receipts cannot be voided. Review its remaining lines.")
            if bill.supporting_documents.exists():
                raise Conflict("Other papers are attached to this document. Detach them before voiding it.")
            if data.get("duplicate_of"):
                duplicate = bill_queryset(user).filter(id=data["duplicate_of"]).exclude(id=bill.id).first()
                if not duplicate or (duplicate.plant_id != bill.plant_id and not duplicate_queryset(bill).filter(id=duplicate.id).exists()):
                    raise ValidationError("Choose another document at the same factory, or one with the same vendor, invoice number and year.")
                bill.duplicate_of = duplicate
            bill.status, bill.resolved_at, bill.resolved_by = "VOID", timezone.now(), user
            bill.resolution_reason, bill.resolution_code = data["reason"], data["resolution_code"]
        bill.save()
        bill_audit(bill, "BILL_VOIDED" if action == "void" else "BILL_RECEIPTED" if bill.status == "RECEIPTED" else "BILL_LINKED", user, data["reason"], before)
        return fresh_payload(user, bill.id)
    return idempotent_action(obj.plant, f"bill:{obj.id}:{action}:{user.id}", data, operation)


def receipt_candidates(bill, search="", vendor_id=None, stock=True):
    sources = [] if not stock else [("BULK", BulkTransaction.objects.filter(type="INWARD", location__plant=bill.plant)), ("PACKAGING", PackagingTransaction.objects.filter(type="INWARD", location__plant=bill.plant)), ("ROLL", InventoryRoll.objects.filter(plant=bill.plant)), ("PO_RECEIPT", PurchaseOrderReceipt.objects.filter(plant=bill.plant)), ("TRADING", TradingGoodReceipt.objects.filter(plant=bill.plant))]
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
    for kind, handler in EXTRA_RECEIPT_KINDS.items():
        if handler.get("candidates"):
            rows.extend(handler["candidates"](bill, search, vendor_id))
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
                bill = _lock(obj.id)
                _open(bill)
                if bill.category in RECORD_ONLY_CATEGORIES:
                    raise ValidationError("This document is classified as a record-only paper. Change its category before posting stock against it.")
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
                snapshots = _append_refs(bill, [{"kind": ref.get("kind", ref.get("type")), "id": ref["id"]} for ref in refs], request.user)
                adopt_header_from_receipts(bill, snapshots, "STOCK")
                bill.status = "PARTIAL_GRN"
                if complete:
                    _finish(bill, request.user, "Inventory confirmed all bill lines received during GRN posting.")
                bill.save()
                bill_audit(bill, "BILL_RECEIPTED" if complete else "BILL_LINKED", request.user, "Linked normal ERP GRN posting.", before)
                result["inward_bill"] = {"id": str(bill.id), "status": bill.status, "resolved_at": iso(bill.resolved_at)}
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


# ── register filters, reports and CSV ───────────────────────────────────────

def followup_pending_q():
    return Q(status="VOID", resolution_code="NON_STOCK") & ~Exists(GeneralReceipt.objects.filter(document_id=OuterRef("pk"), status="POSTED"))


def filter_register(source, user, params, period_fn):
    """Apply register filters (shared by the list API and the CSV export)."""
    status = params.get("status", "OPEN")
    if status not in REGISTER_STATUSES:
        raise ValidationError({"status": "Choose a valid document status."})
    if status == "OPEN":
        source = source.filter(status__in=OPEN_STATUSES)
    elif status == "NEEDS_CLASSIFYING":
        source = source.filter(status__in=OPEN_STATUSES, category="")
    elif status == "WAITING_RECEIPT":
        source = source.filter(status="PENDING_GRN").exclude(category="")
    elif status == "NON_STOCK_FOLLOWUP":
        if not can_manage_documents(user):
            raise PermissionDenied("The non-stock follow-up list needs the documents manage right.")
        source = source.filter(followup_pending_q())
    elif status != "ALL":
        source = source.filter(status=status)
    categories = [value.strip() for value in str(params.get("category", "")).split(",") if value.strip()]
    if categories:
        valid = set(DOCUMENT_CATEGORY_LABELS) | {"NONE"}
        if not set(categories) <= valid:
            raise ValidationError({"category": "Choose valid categories."})
        predicate = Q(category__in=[value for value in categories if value != "NONE"])
        if "NONE" in categories:
            predicate |= Q(category="")
        source = source.filter(predicate)
    doc_type = params.get("doc_type")
    if doc_type:
        if doc_type not in DOCUMENT_TYPE_LABELS:
            raise ValidationError({"doc_type": "Choose a valid document type."})
        source = source.filter(doc_type=doc_type)
    origin = params.get("source")
    if origin:
        if origin not in {"GATE", "OFFICE"}:
            raise ValidationError({"source": "Choose gate or office."})
        source = source.filter(source=origin)
    vendor = params.get("vendor")
    if vendor:
        try:
            source = source.filter(vendor_id=uuid.UUID(str(vendor)))
        except (TypeError, ValueError):
            raise ValidationError({"vendor": "Use a valid vendor reference."})
    basis = params.get("date_basis", "arrival")
    if basis not in {"arrival", "invoice"}:
        raise ValidationError({"date_basis": "Choose arrival or invoice date."})
    if "date_from" in params or "date_to" in params:
        start, end = period_fn()
        if basis == "invoice":
            source = source.filter(invoice_date__gte=start, invoice_date__lte=end)
        else:
            low, high = date_bounds(start, end)
            source = source.filter(arrival_at__gte=low, arrival_at__lt=high)
    search = str(params.get("search", "")).strip()[:100]
    if search:
        predicate = Q(invoice_number__icontains=search) | Q(party_name__icontains=search) | Q(vendor__name__icontains=search) | Q(review_data__invoice_number__icontains=search)
        compact = search.replace("-", "").lower()
        if len(compact) == 32 and all(ch in "0123456789abcdef" for ch in compact):
            predicate |= Q(id=uuid.UUID(compact))
        elif 4 <= len(compact) <= 8 and all(ch in "0123456789abcdef" for ch in compact):
            predicate |= Q(id__startswith=compact)
        source = source.filter(predicate)
    ordering = params.get("ordering") or "arrival_at"
    if ordering not in REGISTER_ORDERING:
        raise ValidationError({"ordering": "Choose a valid order."})
    return source.order_by(*REGISTER_ORDERING[ordering])


AGE_BUCKETS = [("le_1d", 0, 1), ("d2_3", 1, 3), ("d4_7", 3, 7), ("gt_7d", 7, None)]


def document_report_summary(start, end, plant_ids, basis="arrival"):
    docs = InwardBillIntake.objects.filter(plant_id__in=plant_ids)
    if basis == "invoice":
        ranged = docs.filter(invoice_date__gte=start, invoice_date__lte=end)
    else:
        low, high = date_bounds(start, end)
        ranged = docs.filter(arrival_at__gte=low, arrival_at__lt=high)
    live = ranged.exclude(status="VOID")
    by_status = {row["status"]: row["n"] for row in ranged.values("status").annotate(n=Count("id"))}
    by_source = {row["source"]: row["n"] for row in ranged.values("source").annotate(n=Count("id"))}
    by_category = [
        {"category": row["category"], "label": DOCUMENT_CATEGORY_LABELS.get(row["category"], "Not classified"), "count": row["n"], "total_amount": money(row["total"]), "taxable_amount": money(row["taxable"]), "tax_amount": money(row["tax"]), "without_amount": row["missing"]}
        for row in live.values("category").annotate(n=Count("id"), total=Sum("total_amount"), taxable=Sum("taxable_amount"), tax=Sum("tax_amount"), missing=Count("id", filter=Q(total_amount__isnull=True))).order_by(F("total").desc(nulls_last=True), "category")
    ]
    now = timezone.now()
    open_docs = docs.filter(status__in=OPEN_STATUSES)
    ageing = []
    for key, low_days, high_days in AGE_BUCKETS:
        bucket = open_docs.filter(arrival_at__lte=now - timedelta(days=low_days)) if low_days else open_docs
        if high_days is not None:
            bucket = bucket.filter(arrival_at__gt=now - timedelta(days=high_days))
        ageing.append({"bucket": key, "count": bucket.count()})
    vendors = [
        {"vendor": str(row["vendor_id"]) if row["vendor_id"] else None, "name": row["name"] or "(not entered)", "count": row["n"], "total_amount": money(row["total"])}
        for row in live.exclude(total_amount__isnull=True).annotate(name=Coalesce("vendor__name", NullIf("party_name", Value("")))).values("vendor_id", "name").annotate(n=Count("id"), total=Sum("total_amount")).order_by("-total")[:10]
    ]
    twins_vendor = InwardBillIntake.objects.filter(vendor_id=OuterRef("vendor_id"), invoice_normalized=OuterRef("invoice_normalized"), invoice_fy=OuterRef("invoice_fy")).exclude(id=OuterRef("id")).exclude(status="VOID")
    twins_party = InwardBillIntake.objects.filter(vendor__isnull=True, party_name__iexact=OuterRef("party_name"), invoice_normalized=OuterRef("invoice_normalized"), invoice_fy=OuterRef("invoice_fy")).exclude(id=OuterRef("id")).exclude(status="VOID")
    flagged = live.exclude(invoice_normalized="").filter(invoice_fy__isnull=False).filter((Q(vendor__isnull=False) & Exists(twins_vendor)) | (Q(vendor__isnull=True) & ~Q(party_name="") & Exists(twins_party))).count()
    low, high = date_bounds(start, end)
    receipts = GeneralReceipt.objects.filter(status="POSTED", plant_id__in=plant_ids, received_at__gte=low, received_at__lt=high)
    lines = GeneralReceiptLine.objects.filter(receipt__in=receipts)
    gr_by_category = [
        {"line_category": row["line_category"], "count": row["n"], "amount": money(row["amount"])}
        for row in lines.values("line_category").annotate(n=Count("id"), amount=Sum("amount")).order_by(F("amount").desc(nulls_last=True), "line_category")
    ]
    gr_by_machine = [
        {"machine": str(row["machine_id"]), "name": row["machine__name"], "code": row["machine__code"], "plant_name": row["machine__work_center__plant__name"], "count": row["n"], "amount": money(row["amount"])}
        for row in lines.exclude(machine__isnull=True).values("machine_id", "machine__name", "machine__code", "machine__work_center__plant__name").annotate(n=Count("id"), amount=Sum("amount")).order_by(F("amount").desc(nulls_last=True))[:10]
    ]
    totals = lines.aggregate(amount=Sum("amount"))
    return {
        "date_from": str(start), "date_to": str(end), "date_basis": basis, "documents": ranged.count(),
        "by_status": by_status, "by_source": by_source, "by_category": by_category,
        "open_ageing": ageing, "open_total": open_docs.count(), "needs_classifying": open_docs.filter(category="").count(),
        "top_vendors": vendors, "filed_count": by_status.get("FILED", 0), "duplicates_flagged": flagged,
        "non_stock_followups": docs.filter(followup_pending_q()).count(),
        "general_receipts": {"count": receipts.count(), "service_count": receipts.filter(receipt_type="SERVICE").count(), "goods_count": receipts.filter(receipt_type="GOODS").count(), "amount": money(totals["amount"]), "by_line_category": gr_by_category, "by_machine": gr_by_machine},
        "amount_note": "Bill amounts are the totals typed from each paper (each document once, voided ones excluded). General receipt spend is line amount before GST.",
    }


CSV_FIELDS = ["ref", "id", "source", "plant", "arrival_at", "status", "doc_type", "category", "party", "vendor_code", "invoice_number", "invoice_date", "invoice_fy", "taxable_amount", "tax_amount", "total_amount", "due_date", "valid_until", "ship_to_plant", "receipts", "attached_to", "resolved_at", "resolution_reason", "created_by"]


def register_csv_rows(queryset, limit=10000):
    rows = []
    for index, bill in enumerate(queryset.select_related("plant", "vendor", "ship_to_plant", "created_by").prefetch_related("receipt_references")[:limit + 1]):
        if index == limit:
            raise ValidationError(f"The register export is limited to {limit:,} documents. Narrow the dates or filters.")
        rows.append({
            "ref": bill_ref(bill.id), "id": str(bill.id), "source": bill.source, "plant": bill.plant.name,
            "arrival_at": bill.arrival_at.astimezone(gate_zone()).isoformat(), "status": bill.status,
            "doc_type": DOCUMENT_TYPE_LABELS.get(bill.doc_type, ""), "category": DOCUMENT_CATEGORY_LABELS.get(bill.category, ""),
            "party": party_display(bill), "vendor_code": bill.vendor.code if bill.vendor_id else "", "invoice_number": bill.invoice_number or (bill.review_data or {}).get("invoice_number", ""),
            "invoice_date": iso(bill.invoice_date) or "", "invoice_fy": bill.invoice_fy or "", "taxable_amount": money(bill.taxable_amount) or "",
            "tax_amount": money(bill.tax_amount) or "", "total_amount": money(bill.total_amount) or "", "due_date": iso(bill.due_date) or "",
            "valid_until": iso(bill.valid_until) or "", "ship_to_plant": bill.ship_to_plant.name if bill.ship_to_plant_id else "",
            "receipts": "; ".join(f"{ref.kind}:{ref.snapshot.get('reference') or ref.object_id}" for ref in bill.receipt_references.all()),
            "attached_to": bill_ref(bill.attached_to_id) if bill.attached_to_id else "",
            "resolved_at": bill.resolved_at.astimezone(gate_zone()).isoformat() if bill.resolved_at else "",
            "resolution_reason": bill.resolution_reason, "created_by": display_name(bill.created_by),
        })
    return rows
