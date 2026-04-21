from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils.dateparse import parse_date
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.inventory.models import InventoryAuditBatch, InventoryFinancialPeriod
from apps.inventory.serializers import InventoryAuditBatchSerializer, InventoryFinancialPeriodSerializer
from apps.inventory.services.audit import InventoryAuditService, current_indian_financial_year
from apps.users.permission_registry import can_with_wildcard
from apps.users.permission_service import PermissionService


def _error_response(exc, http_status=status.HTTP_400_BAD_REQUEST):
    detail = getattr(exc, "message_dict", None) or getattr(exc, "messages", None) or str(exc)
    return Response({"detail": detail}, status=http_status)


def _require_permission(request, permission: str):
    user = request.user
    if getattr(user, "is_superuser", False) or getattr(user, "is_owner", False):
        return None
    granted = PermissionService.get_user_permissions(user)
    if not can_with_wildcard(granted, permission):
        return Response({"detail": f"Permission required: {permission}"}, status=status.HTTP_403_FORBIDDEN)
    return None


class InventoryFinancialPeriodViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = InventoryFinancialPeriodSerializer
    queryset = InventoryFinancialPeriod.objects.select_related("closed_by", "closing_batch", "opening_batch_next_year").all()

    def list(self, request, *args, **kwargs):
        InventoryAuditService.ensure_default_period()
        return super().list(request, *args, **kwargs)

    @action(detail=False, methods=["post"], url_path="start")
    def start(self, request):
        guard = _require_permission(request, "inventory.period.close")
        if guard:
            return guard
        try:
            financial_year = request.data.get("financial_year") or current_indian_financial_year()
            period = InventoryAuditService.start_period(financial_year=financial_year, user=request.user)
            return Response(self.get_serializer(period).data, status=status.HTTP_201_CREATED)
        except DjangoValidationError as exc:
            return _error_response(exc)

    @action(detail=True, methods=["post"], url_path="begin-close")
    def begin_close(self, request, pk=None):
        guard = _require_permission(request, "inventory.period.close")
        if guard:
            return guard
        try:
            period = InventoryAuditService.begin_close(period=self.get_object())
            return Response(self.get_serializer(period).data)
        except DjangoValidationError as exc:
            return _error_response(exc)

    @action(detail=True, methods=["post"], url_path="close")
    def close(self, request, pk=None):
        guard = _require_permission(request, "inventory.period.close")
        if guard:
            return guard
        try:
            plant_id = request.data.get("plant")
            period = InventoryAuditService.close_period(period=self.get_object(), plant_id=plant_id, user=request.user)
            return Response(self.get_serializer(period).data)
        except DjangoValidationError as exc:
            return _error_response(exc)


class InventoryAuditBatchViewSet(viewsets.ModelViewSet):
    serializer_class = InventoryAuditBatchSerializer

    def get_queryset(self):
        qs = InventoryAuditBatch.objects.select_related("plant", "posted_by", "locked_by", "created_by").prefetch_related(
            "lines",
            "lines__material",
            "lines__granule_code",
            "lines__grade",
            "lines__plant",
            "lines__location",
        )
        batch_type = self.request.query_params.get("type")
        status_filter = self.request.query_params.get("status")
        financial_year = self.request.query_params.get("financial_year")
        plant = self.request.query_params.get("plant")
        if batch_type:
            qs = qs.filter(type=str(batch_type).upper())
        if status_filter:
            qs = qs.filter(status=str(status_filter).upper())
        if financial_year:
            qs = qs.filter(financial_year=financial_year)
        if plant:
            qs = qs.filter(plant_id=plant)
        return qs

    def create(self, request, *args, **kwargs):
        try:
            batch = InventoryAuditService.create_batch(payload=request.data, user=request.user)
            return Response(self.get_serializer(batch).data, status=status.HTTP_201_CREATED)
        except DjangoValidationError as exc:
            return _error_response(exc)

    @action(detail=True, methods=["post"], url_path="lines/import")
    def lines_import(self, request, pk=None):
        try:
            batch = self.get_object()
            rows = request.data.get("lines") or []
            if not isinstance(rows, list):
                return Response({"detail": "lines must be an array."}, status=status.HTTP_400_BAD_REQUEST)
            InventoryAuditService.import_lines(batch=batch, rows=rows)
            batch.refresh_from_db()
            return Response(self.get_serializer(batch).data)
        except DjangoValidationError as exc:
            return _error_response(exc)

    @action(detail=True, methods=["post"], url_path="lines/validate")
    def lines_validate(self, request, pk=None):
        try:
            batch = self.get_object()
            result = InventoryAuditService.validate_batch(batch=batch)
            batch.refresh_from_db()
            payload = self.get_serializer(batch).data
            payload["validation"] = result
            return Response(payload)
        except DjangoValidationError as exc:
            return _error_response(exc)

    @action(detail=True, methods=["post"], url_path="post")
    def post_batch(self, request, pk=None):
        try:
            batch = InventoryAuditService.post_batch(batch=self.get_object(), user=request.user)
            return Response(self.get_serializer(batch).data)
        except DjangoValidationError as exc:
            return _error_response(exc)

    @action(detail=True, methods=["post"], url_path="void")
    def void(self, request, pk=None):
        batch = self.get_object()
        if batch.status in {"POSTED", "LOCKED"}:
            return Response({"detail": "Posted or locked batches cannot be voided from the UI."}, status=status.HTTP_400_BAD_REQUEST)
        batch.status = "VOID"
        batch.notes = f"{batch.notes}\nVOID: {request.data.get('reason') or 'No reason supplied'}".strip()
        batch.save(update_fields=["status", "notes", "updated_at"])
        return Response(self.get_serializer(batch).data)


class ClosingPreviewView(APIView):
    def get(self, request):
        try:
            payload = InventoryAuditService.closing_preview(
                plant_id=request.query_params.get("plant"),
                financial_year=request.query_params.get("financial_year") or current_indian_financial_year(),
            )
            return Response(payload)
        except DjangoValidationError as exc:
            return _error_response(exc)


class StockCardView(APIView):
    def get(self, request):
        try:
            payload = InventoryAuditService.stock_card(
                material_id=request.query_params.get("material"),
                plant_id=request.query_params.get("plant"),
                location_id=request.query_params.get("location"),
                date_from=parse_date(request.query_params.get("from")) if request.query_params.get("from") else None,
                date_to=parse_date(request.query_params.get("to")) if request.query_params.get("to") else None,
            )
            return Response(payload)
        except DjangoValidationError as exc:
            return _error_response(exc)
