import csv
import hashlib
import hmac
import io
import os
import uuid
from datetime import date, timedelta
from urllib.parse import urlparse

from django.conf import settings
from django.db import transaction
from django.db.models import BooleanField, Case, F, Q, Value, When
from django.http import HttpResponse
from django.utils import timezone
from django.utils.decorators import method_decorator
from rest_framework.exceptions import NotFound, PermissionDenied, Throttled, ValidationError
from rest_framework.negotiation import DefaultContentNegotiation
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import BaseThrottle
from rest_framework.views import APIView

from apps.inventory.models import Vendor
from apps.factory.models import Plant
from apps.materials.models import ConsumableMaterial, InventoryMaterial, ProductMaster, TradingGood
from apps.sales.models import Customer
from .models import GateAuditEvent, GatePublicLink, GatePublicRateBucket, GoodsMovement, VisitorVisit
from .serializers import ActionInputSerializer, CancelInputSerializer, CorrectionInputSerializer, GoodsInputSerializer, PURPOSES, ReconcileInputSerializer, VisitorInputSerializer
from .services import EncryptionUnavailable, audit_event_payload, change_goods, create_goods, create_visitor, date_bounds, document_candidates, gate_today, get_plant, goods_payload, has_gate_permission, is_owner, is_watchman, product_uom, report_payload_for_period, scoped_plants, summary_for_period, transition_visitor, visitor_payload

PRIVACY_NOTE = "Your details and optional photo are recorded for factory access and safety. Government ID is optional; enter it only if requested. Submission records your entry; the watchman confirms your exit."


def gate_exception_handler(exc, context):
    if isinstance(exc, EncryptionUnavailable):
        # This is a known refusal before any visitor commit, so retain its
        # specific code instead of the global generic 5xx normalization.
        return Response(exc.detail, status=exc.status_code)
    from config.views import custom_exception_handler
    return custom_exception_handler(exc, context)


class GateAccess(BasePermission):
    def has_permission(self, request, view):
        if getattr(view, "owner_only", False):
            return is_owner(request.user)
        return has_gate_permission(request.user, getattr(view, "gate_permission", "gate.log"))


class GateView(APIView):
    permission_classes = [IsAuthenticated, GateAccess]

    def get_exception_handler(self):
        return gate_exception_handler

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store"
        return response


class GatePagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 100

    def paginate_queryset(self, queryset, request, view=None):
        raw = request.query_params.get("page_size")
        if raw is not None and (not raw.isdigit() or not 1 <= int(raw) <= 100):
            raise ValidationError({"page_size": "Choose a page size between 1 and 100."})
        return super().paginate_queryset(queryset, request, view)


def paginated(queryset, request, serializer):
    paginator = GatePagination()
    page = paginator.paginate_queryset(queryset, request)
    return paginator.get_paginated_response([serializer(obj) for obj in page])


def uuid_param(request, name, required=False):
    value = request.query_params.get(name)
    if not value:
        if required:
            raise ValidationError({name: "Choose a plant."})
        return None
    try:
        return uuid.UUID(value)
    except (ValueError, TypeError):
        raise ValidationError({name: "Use a valid reference."})


def period(request):
    try:
        start = date.fromisoformat(request.query_params.get("date_from", str(gate_today())))
        end = date.fromisoformat(request.query_params.get("date_to", str(gate_today())))
    except ValueError:
        raise ValidationError("Use dates in YYYY-MM-DD format.")
    if start > end or (end - start).days > 365:
        raise ValidationError("Choose an ordered date range of 366 days or fewer.")
    return start, end


def filtered_scope(queryset, user, request):
    allowed = scoped_plants(user)
    plant_id = uuid_param(request, "plant")
    if plant_id:
        get_plant(user, plant_id)
        allowed = allowed.filter(id=plant_id)
    return queryset.filter(plant__in=allowed)


def validated(serializer_class, data):
    serializer = serializer_class(data=data)
    serializer.is_valid(raise_exception=True)
    return serializer.validated_data


class MastersView(GateView):
    def get(self, request):
        plants = scoped_plants(request.user)
        plant_id = uuid_param(request, "plant")
        if plant_id:
            get_plant(request.user, plant_id)
        if not plants.exists():
            raise PermissionDenied("Ask an owner or administrator to assign your factory gate before logging entries.")
        query = request.query_params.get("q", "").strip()[:100]
        parties, products = [], []
        for kind, model in [("VENDOR", Vendor), ("CUSTOMER", Customer)]:
            source = model.objects.filter(status="ACTIVE")
            if query:
                source = source.filter(Q(name__icontains=query) | Q(code__icontains=query))
            parties += [{"kind": kind, "id": str(obj.id), "name": obj.name, "code": obj.code} for obj in source.order_by("name")[:100]]
        sources = [("MATERIAL", InventoryMaterial.objects.filter(status="ACTIVE")), ("PRODUCT", ProductMaster.objects.filter(active=True, is_current_version=True)), ("TRADING", TradingGood.objects.filter(is_active=True)), ("CONSUMABLE", ConsumableMaterial.objects.filter(Q(master_material__isnull=True) | Q(master_material__status="ACTIVE")))]
        for kind, source in sources:
            if query:
                source = source.filter(Q(name__icontains=query) | Q(code__icontains=query)) if kind != "CONSUMABLE" else source.filter(name__icontains=query)
            products += [{"kind": kind, "id": str(obj.id), "name": obj.name or getattr(obj, "code", ""), "code": getattr(obj, "code", ""), "uom": product_uom(kind, obj), "units": ["KG", "PCS"] if kind == "PRODUCT" else [product_uom(kind, obj)]} for obj in source.order_by("name")[:100]]
        return Response({"plants": [{"id": str(obj.id), "code": obj.code, "name": obj.name} for obj in plants], "parties": parties, "products": products, "units": sorted({"KG", "PCS"} | {row["uom"] for row in products}), "purposes": PURPOSES, "search_limit_per_master": 100})


class MatchView(GateView):
    def get(self, request):
        plant = get_plant(request.user, uuid_param(request, "plant", required=True))
        direction = request.query_params.get("direction", "")
        invoice = request.query_params.get("invoice_number", "").strip()
        if direction not in {"INWARD", "OUTWARD"} or not invoice or len(invoice) > 80:
            raise ValidationError("Choose direction and enter an invoice number (up to 80 characters).")
        kind = request.query_params.get("party_kind")
        party_id = uuid_param(request, "party_id")
        if party_id and kind not in {"VENDOR", "CUSTOMER"}:
            raise ValidationError("Choose the party type.")
        candidates = document_candidates(plant, direction, invoice, kind, party_id)
        return Response({"status": "MATCHED" if len(candidates) == 1 else "AMBIGUOUS" if candidates else "UNMATCHED", "candidates": candidates})


class GoodsView(GateView):
    def get(self, request):
        source = filtered_scope(GoodsMovement.objects.select_related("plant", "created_by").prefetch_related("lines"), request.user, request)
        if not is_owner(request.user):
            if any(key in request.query_params for key in ["date_from", "date_to"]):
                require_today = period(request)
                if require_today != (gate_today(), gate_today()):
                    raise PermissionDenied("Gate history is available to owners and administrators.")
            start, end = date_bounds(gate_today(), gate_today())
            source = source.filter(logged_at__gte=start, logged_at__lt=end)
        elif "date_from" in request.query_params or "date_to" in request.query_params:
            start, end = date_bounds(*period(request))
            source = source.filter(logged_at__gte=start, logged_at__lt=end)
        direction = request.query_params.get("direction")
        status = request.query_params.get("reconciliation_status")
        if direction:
            if direction not in {"INWARD", "OUTWARD"}:
                raise ValidationError("Choose a valid direction.")
            source = source.filter(direction=direction)
        if status:
            if status not in {"MATCHED", "UNMATCHED", "DISCREPANCY"}:
                raise ValidationError("Choose a valid reconciliation status.")
            source = source.filter(reconciliation_status=status)
        search = request.query_params.get("search", "").strip()[:100]
        if search:
            source = source.filter(Q(invoice_number__icontains=search) | Q(vehicle_number__icontains=search) | Q(party_name__icontains=search))
        return paginated(source, request, goods_payload)

    def post(self, request):
        return Response(create_goods(request.user, validated(GoodsInputSerializer, request.data)), status=201)


class GoodsDetailView(GateView):
    owner_only = True

    def get(self, request, pk):
        obj = GoodsMovement.objects.select_related("plant", "created_by").prefetch_related("lines").filter(id=pk).first()
        if not obj:
            raise NotFound()
        return Response(goods_payload(obj))


class GoodsChangeView(GateView):
    owner_only = True

    def post(self, request, pk, action):
        obj = GoodsMovement.objects.select_related("plant", "created_by").filter(id=pk).first()
        if not obj:
            raise NotFound()
        data = validated(ReconcileInputSerializer if action == "reconcile" else CorrectionInputSerializer, request.data)
        return Response(change_goods(request.user, obj, data, reconcile=action == "reconcile"))


class VisitorsView(GateView):
    def get(self, request):
        source = filtered_scope(VisitorVisit.objects.select_related("plant").defer("selfie_data", "government_id_encrypted").annotate(_has_selfie=Case(When(selfie_data__isnull=False, then=Value(True)), default=Value(False), output_field=BooleanField())), request.user, request)
        status = request.query_params.get("status")
        if status:
            if status not in {"PENDING", "INSIDE", "EXITED", "CANCELLED"}:
                raise ValidationError("Choose a valid visitor status.")
            if not is_owner(request.user) and status != "INSIDE":
                raise PermissionDenied("Only visitors inside are available in the exit queue.")
            source = source.filter(status=status)
            if status == "PENDING":
                source = source.order_by("submitted_at", "id")
            elif status == "INSIDE":
                source = source.order_by("entry_at", "submitted_at", "id")
        elif not is_owner(request.user):
            source = source.filter(status="INSIDE").order_by("entry_at", "submitted_at", "id")
        if "date_from" in request.query_params or "date_to" in request.query_params:
            if not is_owner(request.user):
                raise PermissionDenied("Visitor date history is available to owners and administrators.")
            start, end = date_bounds(*period(request))
            source = source.filter(submitted_at__gte=start, submitted_at__lt=end)
        search = request.query_params.get("search", "").strip()[:100]
        if search:
            source = source.filter(Q(name__icontains=search) | Q(mobile__icontains=search) | Q(company__icontains=search))
        return paginated(source, request, visitor_payload)

    def post(self, request):
        if not is_owner(request.user):
            raise PermissionDenied("Visitors record entry themselves using the factory QR code.")
        data = validated(VisitorInputSerializer, request.data)
        if not data.get("plant"):
            raise ValidationError({"plant": "Choose a plant."})
        return Response(create_visitor(get_plant(request.user, data["plant"]), data, request.user), status=201)


class VisitorActionView(GateView):
    def post(self, request, pk, action):
        if action != "check-out" and not is_owner(request.user):
            raise PermissionDenied("Only an owner or administrator can recover legacy pending registrations.")
        obj = VisitorVisit.objects.select_related("plant").filter(id=pk, plant__in=scoped_plants(request.user)).first()
        if not obj:
            raise NotFound()
        data = validated(CancelInputSerializer if action == "cancel" else ActionInputSerializer, request.data)
        return Response(transition_visitor(request.user, obj, data, action))


class FileNegotiation(DefaultContentNegotiation):
    def select_renderer(self, request, renderers, format_suffix=None):
        return renderers[0], renderers[0].media_type


def private_response(data, content_type):
    response = HttpResponse(data, content_type=content_type)
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    response["Content-Security-Policy"] = "default-src 'none'; sandbox; frame-ancestors 'self'"
    return response


class SelfieView(GateView):
    content_negotiation_class = FileNegotiation

    def get(self, request, pk):
        source = VisitorVisit.objects.filter(id=pk, plant__in=scoped_plants(request.user))
        if not is_owner(request.user):
            source = source.filter(status="INSIDE")
        obj = source.first()
        if not obj or not obj.selfie_data:
            raise NotFound()
        return private_response(bytes(obj.selfie_data), "image/jpeg")


class SummaryView(GateView):
    def get(self, request):
        start, end = period(request)
        if not is_owner(request.user) and (start, end) != (gate_today(), gate_today()):
            raise PermissionDenied("Historical gate summaries are available to owners and administrators.")
        plants = scoped_plants(request.user)
        plant_id = uuid_param(request, "plant")
        if plant_id:
            get_plant(request.user, plant_id)
            plants = plants.filter(id=plant_id)
        return Response(summary_for_period(start, end, list(plants.values_list("id", flat=True))))


class AuditView(GateView):
    owner_only = True

    def get(self, request):
        source = filtered_scope(GateAuditEvent.objects.select_related("plant", "actor"), request.user, request)
        object_id = uuid_param(request, "object_id")
        if object_id:
            source = source.filter(object_id=object_id)
        if "date_from" in request.query_params or "date_to" in request.query_params:
            start, end = date_bounds(*period(request))
            source = source.filter(created_at__gte=start, created_at__lt=end)
        return paginated(source, request, audit_event_payload)


class ReportsView(GateView):
    gate_permission = "gate.reports"

    def get(self, request):
        # An explicit report entitlement grants sanitized report access across
        # factories; gate assignments grant physical logging access separately.
        plants = Plant.objects.all()
        plant_id = uuid_param(request, "plant")
        if plant_id:
            if not plants.filter(id=plant_id).exists():
                raise NotFound("This report plant is unavailable.")
            plants = plants.filter(id=plant_id)
        start, end = period(request)
        payload = report_payload_for_period(start, end, list(plants.values_list("id", flat=True)))
        payload["plants"] = [{"id": str(plant.id), "name": plant.name, "code": plant.code} for plant in plants]
        return Response(payload)


class ReportsCSVView(ReportsView):
    content_negotiation_class = FileNegotiation

    def get(self, request):
        payload = super().get(request).data
        rows = payload["rows"]
        output = io.StringIO()
        fields = ["logged_at", "plant", "direction", "invoice_number", "invoice_date", "vehicle_number", "party_name", "product_name", "quantity", "uom", "amount", "reconciliation_status", "reference", "amount_basis"]
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: "'" + str(value) if str(value).lstrip().startswith(("=", "+", "-", "@", "\t", "\r")) else value for key, value in row.items()})
        response = private_response("\ufeff" + output.getvalue(), "text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="gate-register.csv"'
        return response


class PublicGateThrottle(BaseThrottle):
    """Global DB-backed limits across gunicorn workers; never trusts raw XFF."""
    def allow_request(self, request, view):
        address = request.META.get("REMOTE_ADDR", "unknown")
        trusted = set(getattr(settings, "GATE_TRUSTED_PROXY_IPS", []))
        if address in trusted:
            address = request.META.get("HTTP_X_REAL_IP", address)
        digest = hmac.new(settings.SECRET_KEY.encode(), address.encode(), hashlib.sha256).hexdigest()
        now = timezone.now()
        limits = [(60, 20), (3600, 100)] if request.method == "POST" else [(60, 120)]
        for seconds, limit in limits:
            bucket_start = int(now.timestamp()) // seconds * seconds
            key = f"{request.method}:{digest}:{seconds}:{bucket_start}"
            with transaction.atomic():
                bucket, _ = GatePublicRateBucket.objects.get_or_create(key=key, defaults={"expires_at": now + timedelta(seconds=seconds)})
                changed = GatePublicRateBucket.objects.filter(key=key, count__lt=limit).update(count=F("count") + 1)
                if not changed:
                    self.retry_after = seconds - (int(now.timestamp()) - bucket_start)
                    return False
        GatePublicRateBucket.objects.filter(expires_at__lt=now-timedelta(hours=1)).delete()
        return True

    def wait(self):
        return getattr(self, "retry_after", 60)


def public_link(token):
    try:
        token = uuid.UUID(str(token))
    except (ValueError, TypeError):
        raise NotFound("This visitor QR is unavailable. Please ask the watchman.")
    link = GatePublicLink.objects.select_related("plant").filter(token=token, active=True).first()
    if not link:
        raise NotFound("This visitor QR is unavailable. Please ask the watchman.")
    return link


@method_decorator(transaction.non_atomic_requests, name="dispatch")
class PublicConfigView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [PublicGateThrottle]

    def get_exception_handler(self):
        return gate_exception_handler

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "no-store"
        return response

    def get(self, request):
        link = public_link(request.query_params.get("gate_token"))
        return Response({"company_name": "Total Poly Print", "plant_name": link.plant.name, "plant_code": link.plant.code, "purposes": PURPOSES, "privacy_note": PRIVACY_NOTE, "government_id_enabled": bool(os.getenv("GATE_ID_ENCRYPTION_KEY") or getattr(settings, "GATE_ID_ENCRYPTION_KEY", ""))})


class PublicVisitorsView(PublicConfigView):
    def post(self, request):
        data = validated(VisitorInputSerializer, request.data)
        link = public_link(data.get("gate_token"))
        return Response(create_visitor(link.plant, data, public=True, scope=f"public:{link.token}"), status=201)

    def get(self, request):
        return self.http_method_not_allowed(request)


def qr_url(link):
    origin = getattr(settings, "GATE_PUBLIC_ORIGIN", "") or os.getenv("GATE_PUBLIC_ORIGIN", "https://erp.totalpolyprint.com")
    parsed = urlparse(origin)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.path not in {"", "/"}:
        raise ValidationError("Visitor public origin is not configured correctly.")
    return f"{origin.rstrip('/')}/visit/{link.token}"


class QRView(GateView):
    owner_only = True

    def get(self, request):
        plant_id = uuid_param(request, "plant", required=True)
        link = GatePublicLink.objects.select_related("plant").filter(plant_id=plant_id, active=True).first()
        if not link:
            raise NotFound("This gate QR has not been configured.")
        return Response({"plant_name": link.plant.name, "plant_code": link.plant.code, "gate_token": str(link.token), "public_url": qr_url(link), "svg_url": f"/api/gate/qr/{link.plant_id}/svg/"})


class QRSVGView(QRView):
    content_negotiation_class = FileNegotiation

    def get(self, request, plant_id):
        import qrcode
        import qrcode.image.svg
        link = GatePublicLink.objects.select_related("plant").filter(plant_id=plant_id, active=True).first()
        if not link:
            raise NotFound()
        code = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H, border=4, box_size=10)
        code.add_data(qr_url(link))
        code.make(fit=True)
        return private_response(code.make_image(image_factory=qrcode.image.svg.SvgPathImage).to_string(), "image/svg+xml")
