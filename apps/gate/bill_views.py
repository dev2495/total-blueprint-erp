import csv
import io
from urllib.parse import quote

from django.db.models import Q
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from apps.inventory.models import Vendor
from . import document_reminders  # noqa: F401  (registers reminder notification events)
from .bill_serializers import (
    BillAttachSerializer, BillClassifySerializer, BillFileSerializer, BillFinishSerializer, BillLinkSerializer, BillReasonSerializer,
    BillReviewSerializer, BillUploadSerializer, BillVoidSerializer, OfficeUploadSerializer, VOID_CODES,
)
from .bill_services import (
    CSV_FIELDS, DOCUMENT_CATEGORY_LABELS, DOCUMENT_TYPE_LABELS, PayloadContext, attach_bill, bill_payload, bill_queryset, can_review_stock,
    can_view_documents, classify_bill, detach_bill, document_report_summary, file_bill, filter_register, get_bill, office_upload,
    reader_plants, receipt_candidates, register_csv_rows, reopen_bill, require_review_or_manage, resolve_bill, review_bill, upload_bill,
)
from .models import DocumentOriginalFile, InwardBillPage
from .services import get_plant
from .views import FileNegotiation, GatePagination, GateView, period, private_response, uuid_param, validated


class BillView(GateView):
    permission_classes = [IsAuthenticated]


def require_reader(user):
    if not can_view_documents(user):
        raise PermissionDenied("Bills and documents are available to Inventory and accounts granted the documents view right.")


def scoped_plant_filter(source, request):
    plant = uuid_param(request, "plant")
    if not plant:
        return source, None
    if can_view_documents(request.user):
        if not reader_plants(request.user).filter(id=plant).exists():
            raise PermissionDenied("This factory is unavailable.")
    else:
        get_plant(request.user, plant)
    return source.filter(plant_id=plant), plant


class BillsView(BillView):
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request):
        source = bill_queryset(request.user)
        source, _ = scoped_plant_filter(source, request)
        reader = can_view_documents(request.user)
        filters = {"status", "date_from", "date_to", "category", "source", "vendor", "search", "date_basis", "doc_type", "ordering"}
        if not reader and filters & set(request.query_params):
            raise PermissionDenied("Bill history is available to inventory reviewers.")
        if reader:
            source = filter_register(source, request.user, request.query_params, lambda: period(request))
        paginator = GatePagination()
        page = paginator.paginate_queryset(source, request)
        ctx = PayloadContext(page, request.user)
        return paginator.get_paginated_response([bill_payload(obj, request.user, ctx) for obj in page])

    def post(self, request):
        return Response(upload_bill(request.user, validated(BillUploadSerializer, request.data)), status=201)


class OfficeUploadView(BillView):
    """POST multipart {client_token, plant, files[], optional header}: office photos and/or PDFs."""
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        from .bill_services import can_upload_documents
        if not can_upload_documents(request.user):
            raise PermissionDenied("Uploading bills needs the documents upload right (Inventory by default).")
        return Response(office_upload(request.user, validated(OfficeUploadSerializer, request.data)), status=201)


class BillDetailView(BillView):
    def get(self, request, pk):
        return Response(bill_payload(get_bill(request.user, pk), request.user, detail=True))


class BillPageView(BillView):
    content_negotiation_class = FileNegotiation

    def get(self, request, pk, page_id):
        bill = get_bill(request.user, pk)
        page = InwardBillPage.objects.filter(id=page_id, intake=bill).first()
        if not page:
            raise NotFound()
        from .document_pages import page_image_bytes
        return private_response(page_image_bytes(page, request), "image/jpeg")


def attachment_disposition(file_name):
    ascii_name = "".join(ch if 32 <= ord(ch) < 127 and ch not in '"\\' else "_" for ch in file_name) or "document.pdf"
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(file_name)}"


class BillOriginalView(BillView):
    """GET the immutable original upload (e.g. the office PDF) as a private download."""
    content_negotiation_class = FileNegotiation

    def get(self, request, pk, file_id):
        require_reader(request.user)
        bill = get_bill(request.user, pk)
        original = DocumentOriginalFile.objects.filter(id=file_id, intake=bill).first()
        if not original:
            raise NotFound()
        response = private_response(bytes(original.data), original.content_type or "application/octet-stream")
        response["Content-Disposition"] = attachment_disposition(original.file_name)
        response["Content-Length"] = str(original.byte_size)
        return response


class BillReviewView(BillView):
    def post(self, request, pk):
        require_review_or_manage(request.user)
        return Response(review_bill(request.user, get_bill(request.user, pk), validated(BillReviewSerializer, request.data)))


class BillCandidatesView(BillView):
    def get(self, request, pk):
        require_review_or_manage(request.user)
        bill = get_bill(request.user, pk)
        rows = receipt_candidates(bill, request.query_params.get("search", "").strip()[:100], uuid_param(request, "vendor_id"), stock=can_review_stock(request.user))
        return Response({"results": rows, "matching_is_manual": True})


class BillResolveView(BillView):
    def post(self, request, pk, action):
        serializers = {"link-receipts": BillLinkSerializer, "complete": BillFinishSerializer, "void": BillVoidSerializer}
        require_review_or_manage(request.user)
        return Response(resolve_bill(request.user, get_bill(request.user, pk), validated(serializers[action], request.data), action))


class BillActionView(BillView):
    """classify / file / attach (documents.manage), detach / reopen (Owner/Admin)."""
    parser_classes = [JSONParser, FormParser, MultiPartParser]
    ACTIONS = {
        "classify": (BillClassifySerializer, classify_bill),
        "file": (BillFileSerializer, file_bill),
        "attach": (BillAttachSerializer, attach_bill),
        "detach": (BillReasonSerializer, detach_bill),
        "reopen": (BillReasonSerializer, reopen_bill),
    }

    def post(self, request, pk, action):
        serializer, handler = self.ACTIONS[action]
        require_reader(request.user)
        bill = get_bill(request.user, pk)
        return Response(handler(request.user, bill, validated(serializer, request.data)))


CATEGORY_GUIDE = {
    "STOCK": "Raw material, film, packaging or trading goods: post a GRN so stock goes up.",
    "JOBWORK": "Work returned by a job worker: receive it against the job-work order.",
    "SPARES": "Machine spares and parts: record a General Receipt (kept in store / installed).",
    "MACHINERY": "Machines and equipment: record a General Receipt at the plant that received it.",
    "SERVICE": "Repair, service or engineer visit: record a General Receipt confirming the work.",
    "UTILITY": "Power, water, gas, phone: file it as a record with its due date.",
    "PROFESSIONAL_STATUTORY": "Consultant, licence or statutory fee: file it, with a valid-until date for renewals.",
    "TRANSPORT": "Freight or transport LR: attach it to the stock bill it came with, or file it.",
    "OTHER_EXPENSE": "Any other expense with nothing to receive: file it as a record.",
}


class BillFormOptionsView(BillView):
    """GET masters for the upload/classify forms: plants, vendor search, document types and categories."""

    def get(self, request):
        require_reader(request.user)
        query = request.query_params.get("q", "").strip()[:100]
        vendors = Vendor.objects.filter(status="ACTIVE")
        if query:
            vendors = vendors.filter(Q(name__icontains=query) | Q(code__icontains=query))
        rows = [{"id": str(obj.id), "name": obj.name, "code": obj.code} for obj in vendors.order_by("name")[:50]]
        selected = uuid_param(request, "vendor")
        if selected and not any(row["id"] == str(selected) for row in rows):
            obj = Vendor.objects.filter(id=selected).first()
            if obj:
                rows.insert(0, {"id": str(obj.id), "name": obj.name, "code": obj.code, "inactive": obj.status != "ACTIVE"})
        plants = reader_plants(request.user).order_by("name")
        return Response({
            "plants": [{"id": str(obj.id), "name": obj.name, "code": obj.code} for obj in plants],
            "vendors": rows,
            "doc_types": [{"code": code, "label": label} for code, label in DOCUMENT_TYPE_LABELS.items()],
            "categories": [{"code": code, "label": label, "guide": CATEGORY_GUIDE.get(code, "")} for code, label in DOCUMENT_CATEGORY_LABELS.items()],
            "void_codes": [code for code in VOID_CODES if code != "NON_STOCK"],
        })


class DocumentPageRotationView(BillView):
    """POST {page_kind, page_id, rotation, client_token}: shared display rotation."""

    def post(self, request):
        from .document_pages import rotation_response
        return rotation_response(request)


def report_scope(request):
    require_reader(request.user)
    plants = reader_plants(request.user)
    plant_id = uuid_param(request, "plant")
    if plant_id:
        if not plants.filter(id=plant_id).exists():
            raise NotFound("This report factory is unavailable.")
        plants = plants.filter(id=plant_id)
    return list(plants.values_list("id", flat=True))


class DocumentReportSummaryView(BillView):
    def get(self, request):
        plant_ids = report_scope(request)
        start, end = period(request)
        basis = request.query_params.get("date_basis", "arrival")
        if basis not in {"arrival", "invoice"}:
            raise ValidationError({"date_basis": "Choose arrival or invoice date."})
        return Response(document_report_summary(start, end, plant_ids, basis))


def csv_safe(value):
    text = "" if value is None else str(value)
    return "'" + text if text.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")) else text


class DocumentRegisterCSVView(BillView):
    content_negotiation_class = FileNegotiation

    def get(self, request):
        require_reader(request.user)
        source, _ = scoped_plant_filter(bill_queryset(request.user), request)
        params = request.query_params.copy()
        params.setdefault("status", "ALL")
        source = filter_register(source, request.user, params, lambda: period(request))
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=CSV_FIELDS)
        writer.writeheader()
        for row in register_csv_rows(source):
            writer.writerow({key: csv_safe(value) for key, value in row.items()})
        response = private_response("﻿" + output.getvalue(), "text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="documents-register.csv"'
        return response
