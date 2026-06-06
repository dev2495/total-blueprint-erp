from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.http import FileResponse
from io import BytesIO, TextIOWrapper
import csv
import uuid
from openpyxl import load_workbook
from django.utils.dateparse import parse_date
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.factory.models import Plant
from apps.inventory.models import (
    InventoryAuditBatch,
    InventoryAuditLine,
    InventoryBulk,
    InventoryFinancialPeriod,
    InventoryLocation,
    InventoryRoll,
    PackagingStock,
)
from apps.inventory.serializers import InventoryAuditBatchSerializer, InventoryFinancialPeriodSerializer
from apps.inventory.services.audit import InventoryAuditService, current_indian_financial_year
from apps.materials.models import GranuleQualityCode, InventoryMaterial
from apps.users.permission_registry import can_with_wildcard
from apps.users.permission_service import PermissionService


def _error_response(exc, http_status=status.HTTP_400_BAD_REQUEST):
    detail = getattr(exc, "message_dict", None) or getattr(exc, "messages", None) or str(exc)
    return Response({"detail": detail}, status=http_status)


def _uuid_like(value):
    try:
        uuid.UUID(str(value))
        return True
    except Exception:
        return False


def _require_permission(request, permission: str):
    user = request.user
    if getattr(user, "is_superuser", False) or getattr(user, "is_owner", False):
        return None
    granted = PermissionService.get_user_permissions(user)
    if not can_with_wildcard(granted, permission):
        return Response({"detail": f"Permission required: {permission}"}, status=status.HTTP_403_FORBIDDEN)
    return None


def _opening_workflow_from_payload(payload):
    mode = str(payload.get("opening_mode") or payload.get("mode") or "").upper().strip()
    cutover = bool(payload.get("cutover") or payload.get("cutover_mode") or mode in InventoryAuditService.CUTOVER_OPENING_MODES)
    if cutover:
        mode = "CUTOVER_OPENING"
    return {
        "mode": mode or "TRUE_OPENING",
        "source": "stock_lifecycle_ui",
        "cutover": cutover,
        "cutover_reason_code": payload.get("reason_code") or "",
        "cutover_note": payload.get("notes") or "",
        "counted_as_of": payload.get("counted_as_of") or payload.get("cutoff_at") or "",
        "entry_at": timezone.now().isoformat(),
    }


def _resolve_granule_code_for_row(row, material):
    lookup = str(
        row.get("granule_code_id")
        or row.get("granule_code")
        or row.get("granule_quality_code_id")
        or row.get("granule_quality_code")
        or ""
    ).strip()
    if not lookup:
        return None
    quality = GranuleQualityCode.objects.filter(id=lookup).first() if _uuid_like(lookup) else None
    if not quality:
        quality = GranuleQualityCode.objects.filter(granule=material, code__iexact=lookup).first()
    if not quality:
        raise DjangoValidationError(f"Granule code {lookup} was not found for material {material.code}.")
    if str(quality.granule_id) != str(material.id):
        raise DjangoValidationError(f"Granule code {quality.code} does not belong to material {material.code}.")
    if str(quality.status or "").upper() != "ACTIVE":
        raise DjangoValidationError(f"Granule code {quality.code} is inactive.")
    return str(quality.id)


def _default_inventory_plant_id():
    """Prefer a plant with real stock when V3.6 count UI does not pass one."""
    plant_id = (
        InventoryBulk.objects.filter(qty_kg__gt=0)
        .order_by("-updated_at")
        .values_list("plant_id", flat=True)
        .first()
    )
    if plant_id:
        return plant_id

    plant_id = (
        PackagingStock.objects.filter(qty__gt=0)
        .order_by("-updated_at")
        .values_list("plant_id", flat=True)
        .first()
    )
    if plant_id:
        return plant_id

    plant_id = (
        InventoryRoll.objects.exclude(status__in=["CONSUMED", "SCRAPPED", "MISSING"])
        .filter(weight_kg__gt=0, plant__isnull=False)
        .order_by("-created_at")
        .values_list("plant_id", flat=True)
        .first()
    )
    if plant_id:
        return plant_id

    return Plant.objects.order_by("code", "name").values_list("id", flat=True).first()


def _batch_payload_from_v36(payload):
    if payload.get("type"):
        return payload
    period = None
    if payload.get("period_id"):
        period = InventoryFinancialPeriod.objects.filter(id=payload.get("period_id")).first()
    financial_year = payload.get("financial_year") or getattr(period, "financial_year", None) or current_indian_financial_year()
    plant_id = payload.get("plant") or payload.get("plant_id")
    if not plant_id:
        plant_id = _default_inventory_plant_id()
    scope = str(payload.get("scope") or "FULL").upper()
    locations = payload.get("locations") or []
    klass_filter = payload.get("klass_filter") or payload.get("stock_class_filter") or []
    return {
        "type": "PHYSICAL_COUNT",
        "plant": str(plant_id) if plant_id else "",
        "financial_year": financial_year,
        "cutoff_at": payload.get("deadline") or payload.get("cutoff_at") or timezone.now().isoformat(),
        "notes": payload.get("notes") or f"V3.6 {scope.lower()} stock count",
        "lines": payload.get("lines") or [],
        "_v36_workflow": {
            "scope": scope,
            "locations": locations,
            "klass_filter": klass_filter,
            "assigned_to_user_id": payload.get("assigned_to_user_id") or "",
            "deadline": payload.get("deadline") or "",
            "name": payload.get("name") or f"{scope.title()} stock count",
        },
    }


def _variance_pct(system_qty, counted_qty):
    try:
        system = float(system_qty or 0)
        counted = float(counted_qty or 0)
    except Exception:
        return 0.0
    if system == 0:
        return 100.0 if counted else 0.0
    return ((counted - system) / system) * 100


def _line_payload_from_ref(batch, payload):
    ref_id = payload.get("ref_id") or payload.get("line_id")
    ref_type = str(payload.get("ref_type") or payload.get("stock_class") or "").upper()
    if ref_id:
        existing = batch.lines.filter(id=ref_id).first()
        if existing:
            return existing, None

    material = None
    location = None
    if ref_id and ref_type == "ROLL":
        from apps.inventory.models import InventoryRoll

        roll = InventoryRoll.objects.select_related("material", "grade", "location").filter(id=ref_id).first()
        if roll:
            material = roll.material
            location = roll.location
            return None, {
                "stock_class": "ROLL",
                "material": str(roll.material_id),
                "grade": str(roll.grade_id) if roll.grade_id else None,
                "location": str(roll.location_id),
                "label_id": roll.label_id,
                "batch_no": roll.batch_no,
                "width_mm": str(roll.width_mm or 0),
                "thickness_micron": str(roll.thickness_micron or 0),
                "length_m": str(roll.length_m or 0),
                "counted_qty": payload.get("counted_qty"),
            }
    elif ref_id and ref_type == "BULK":
        from apps.inventory.models import InventoryBulk

        stock = InventoryBulk.objects.select_related("material", "granule_code", "location").filter(id=ref_id).first()
        if stock:
            return None, {
                "stock_class": "BULK",
                "material": str(stock.material_id),
                "granule_code": str(stock.granule_code_id) if stock.granule_code_id else None,
                "location": str(stock.location_id),
                "counted_qty": payload.get("counted_qty"),
            }
    elif ref_id and ref_type == "PACKAGING":
        from apps.inventory.models import PackagingStock

        stock = PackagingStock.objects.select_related("material", "location").filter(id=ref_id).first()
        if stock:
            return None, {
                "stock_class": "PACKAGING",
                "material": str(stock.material_id),
                "location": str(stock.location_id),
                "counted_qty": payload.get("counted_qty"),
            }

    material_id = payload.get("material") or payload.get("material_id")
    location_id = payload.get("location") or payload.get("location_id")
    if not material_id and payload.get("material_code"):
        material = InventoryMaterial.objects.filter(code__iexact=payload.get("material_code")).first()
        material_id = str(material.id) if material else None
    if not location_id and payload.get("location_code"):
        location = InventoryLocation.objects.filter(plant=batch.plant, code__iexact=payload.get("location_code")).first()
        location_id = str(location.id) if location else None
    if not material_id or not location_id:
        raise DjangoValidationError("Count line needs an existing batch line/ref_id or material + location.")
    return None, {
        "stock_class": ref_type or payload.get("stock_class") or "BULK",
        "material": str(material_id),
        "location": str(location_id),
        "counted_qty": payload.get("counted_qty"),
        "uom": payload.get("uom"),
        "label_id": payload.get("label") or payload.get("label_id") or "",
    }


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

    @action(detail=True, methods=["post"], url_path="open")
    def open(self, request, pk=None):
        guard = _require_permission(request, "inventory.period.close")
        if guard:
            return guard
        period = self.get_object()
        try:
            if period.status == "CLOSED":
                raise DjangoValidationError("Closed financial years cannot be reopened from V3.6 period management.")
            period = InventoryAuditService.start_period(financial_year=period.financial_year, user=request.user)
            return Response(self.get_serializer(period).data)
        except DjangoValidationError as exc:
            return _error_response(exc)

    @action(detail=True, methods=["post"], url_path="close")
    def close(self, request, pk=None):
        guard = _require_permission(request, "inventory.period.close")
        if guard:
            return guard
        try:
            plant_id = request.data.get("plant") or request.data.get("plant_id")
            if not plant_id:
                plant_id = Plant.objects.values_list("id", flat=True).first()
            if not plant_id:
                raise DjangoValidationError("Plant is required.")
            open_batches = InventoryAuditBatch.objects.filter(
                plant_id=plant_id,
                financial_year=self.get_object().financial_year,
                status__in=["DRAFT", "SUBMITTED", "APPROVED"],
            ).count()
            if open_batches:
                raise DjangoValidationError({"blockers": [{"code": "OPEN_AUDIT_BATCHES", "label": "Open audit batches", "count": open_batches}]})
            period = InventoryAuditService.close_period(period=self.get_object(), plant_id=plant_id, user=request.user)
            return Response(self.get_serializer(period).data)
        except DjangoValidationError as exc:
            return _error_response(exc)

    @action(detail=True, methods=["post"], url_path="year-end-close")
    def year_end_close(self, request, pk=None):
        guard = _require_permission(request, "inventory.period.close")
        if guard:
            return guard
        if not str(request.data.get("owner_signoff_token") or "").strip():
            return Response({"detail": "owner_signoff_token is required for year-end close."}, status=status.HTTP_400_BAD_REQUEST)
        if not bool(request.data.get("ack_pause_on_failure", False)):
            return Response({"detail": "ack_pause_on_failure must be true."}, status=status.HTTP_400_BAD_REQUEST)

        period = self.get_object()
        plant_rows = []
        failed = False
        for plant in Plant.objects.all().order_by("name"):
            blockers = InventoryAuditService.close_blockers(plant=plant)
            if blockers:
                failed = True
                plant_rows.append({"plant_id": str(plant.id), "name": plant.name, "status": "FAILED", "reason": blockers[0]["label"]})
            else:
                plant_rows.append({"plant_id": str(plant.id), "name": plant.name, "status": "READY", "carry_fwd_value_inr": 0})
        if failed:
            return Response({"period_id": str(period.id), "status": "PAUSED", "plants": plant_rows})

        closed_rows = []
        for row in plant_rows:
            try:
                closed = InventoryAuditService.close_period(period=period, plant_id=row["plant_id"], user=request.user)
                closed_rows.append({**row, "status": "CLOSED"})
                period = closed
            except DjangoValidationError as exc:
                failed = True
                closed_rows.append({**row, "status": "FAILED", "reason": _error_response(exc).data})
        return Response({"period_id": str(period.id), "status": "PAUSED" if failed else "CLOSED", "plants": closed_rows})


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
        guard = _require_permission(request, "inventory.audit.manage")
        if guard:
            return guard
        try:
            payload = _batch_payload_from_v36(dict(request.data or {}))
            workflow = payload.pop("_v36_workflow", None)
            lines = payload.pop("lines", None) or []
            if lines and not isinstance(lines, list):
                return Response({"detail": "lines must be an array."}, status=status.HTTP_400_BAD_REQUEST)
            with transaction.atomic():
                batch = InventoryAuditService.create_batch(payload=payload, user=request.user)
                if workflow:
                    summary = dict(batch.summary_json or {})
                    summary["workflow"] = {**dict(summary.get("workflow") or {}), **workflow}
                    batch.summary_json = summary
                    batch.save(update_fields=["summary_json", "updated_at"])
                if lines:
                    InventoryAuditService.import_lines(batch=batch, rows=lines)
                batch.refresh_from_db()
            return Response(self.get_serializer(batch).data, status=status.HTTP_201_CREATED)
        except DjangoValidationError as exc:
            return _error_response(exc)

    @action(detail=True, methods=["post"], url_path="start")
    def start(self, request, pk=None):
        guard = _require_permission(request, "inventory.audit.manage")
        if guard:
            return guard
        batch = self.get_object()
        if batch.status not in {"DRAFT", "SUBMITTED"}:
            return Response({"detail": "Only draft/submitted batches can be started."}, status=status.HTTP_400_BAD_REQUEST)
        summary = dict(batch.summary_json or {})
        workflow = dict(summary.get("workflow") or {})
        workflow.update({"started_at": timezone.now().isoformat(), "started_by": getattr(request.user, "username", "")})
        summary["workflow"] = workflow
        batch.summary_json = summary
        batch.save(update_fields=["summary_json", "updated_at"])
        return Response(self.get_serializer(batch).data)

    @action(detail=True, methods=["post"], url_path="submit-line")
    def submit_line(self, request, pk=None):
        guard = _require_permission(request, "inventory.audit.manage")
        if guard:
            return guard
        try:
            batch = self.get_object()
            offline_uuid = str(request.data.get("offline_uuid") or "").strip()
            if offline_uuid:
                existing = batch.lines.filter(posted_reference_json__offline_uuid=offline_uuid).first()
                if existing:
                    return Response({"offline_uuid": offline_uuid, "status": "DUPLICATE", "server_id": str(existing.id)})
            existing_line, payload = _line_payload_from_ref(batch, request.data)
            if existing_line:
                line = existing_line
                line.counted_qty = request.data.get("counted_qty")
                line.system_qty = request.data.get("system_qty") if request.data.get("system_qty") not in (None, "") else line.system_qty
                line.variance_qty = float(line.counted_qty or 0) - float(line.system_qty or 0)
                refs = dict(line.posted_reference_json or {})
                if offline_uuid:
                    refs["offline_uuid"] = offline_uuid
                refs.update({
                    "reason_code": request.data.get("reason_code") or "",
                    "reason_note": request.data.get("reason_note") or "",
                    "device_id": request.data.get("device_id") or "",
                    "counted_at": request.data.get("counted_at") or timezone.now().isoformat(),
                })
                line.posted_reference_json = refs
                line.save(update_fields=["counted_qty", "system_qty", "variance_qty", "posted_reference_json", "updated_at"])
            else:
                payload = dict(payload or {})
                payload["counted_qty"] = request.data.get("counted_qty", payload.get("counted_qty"))
                line = InventoryAuditService.upsert_line(batch=batch, payload=payload)
                refs = dict(line.posted_reference_json or {})
                if offline_uuid:
                    refs["offline_uuid"] = offline_uuid
                refs.update({
                    "reason_code": request.data.get("reason_code") or "",
                    "reason_note": request.data.get("reason_note") or "",
                    "device_id": request.data.get("device_id") or "",
                    "counted_at": request.data.get("counted_at") or timezone.now().isoformat(),
                })
                line.posted_reference_json = refs
                line.save(update_fields=["posted_reference_json", "updated_at"])
            InventoryAuditService.refresh_batch_summary(batch)
            variance = _variance_pct(line.system_qty, line.counted_qty)
            return Response({
                "offline_uuid": offline_uuid,
                "status": "OK",
                "server_id": str(line.id),
                "variance_pct": variance,
                "flagged": abs(variance) > 2,
            })
        except DjangoValidationError as exc:
            return _error_response(exc)

    @action(detail=True, methods=["post"], url_path="sync")
    def sync(self, request, pk=None):
        guard = _require_permission(request, "inventory.audit.manage")
        if guard:
            return guard
        results = []
        for event in request.data.get("events") or []:
            child_request = type("RequestProxy", (), {"data": event, "user": request.user})()
            response = self.submit_line(child_request, pk=pk)
            payload = dict(response.data)
            if response.status_code >= 400:
                payload = {"offline_uuid": event.get("offline_uuid"), "status": "REJECTED", "reason": payload.get("detail") or payload.get("error") or "Rejected"}
            results.append(payload)
        return Response({"results": results})

    @action(detail=True, methods=["post"], url_path="finalize")
    def finalize(self, request, pk=None):
        guard = _require_permission(request, "inventory.audit.manage")
        if guard:
            return guard
        try:
            batch = self.get_object()
            InventoryAuditService.validate_batch(batch=batch)
            variance_count = 0
            max_variance = 0.0
            for line in batch.lines.all():
                pct = _variance_pct(line.system_qty, line.counted_qty)
                max_variance = max(max_variance, abs(pct))
                if abs(pct) > 2:
                    variance_count += 1
            summary = dict(batch.summary_json or {})
            workflow = dict(summary.get("workflow") or {})
            workflow.update({
                "finalized_at": timezone.now().isoformat(),
                "variance_count": variance_count,
                "variance_pct_max": round(max_variance, 4),
                "flagged": variance_count > 0,
            })
            summary["workflow"] = workflow
            batch.summary_json = summary
            if batch.status == "DRAFT":
                batch.status = "SUBMITTED"
                batch.save(update_fields=["status", "summary_json", "updated_at"])
            else:
                batch.save(update_fields=["summary_json", "updated_at"])
            return Response(self.get_serializer(batch).data)
        except DjangoValidationError as exc:
            return _error_response(exc)

    @action(detail=True, methods=["get"], url_path="locations")
    def locations(self, request, pk=None):
        batch = self.get_object()
        rows = []
        for location in InventoryLocation.objects.filter(inventory_audit_lines__batch=batch).distinct().order_by("code"):
            lines = batch.lines.filter(location=location)
            total = lines.count()
            counted = lines.exclude(counted_qty__isnull=True).count()
            rows.append({
                "id": str(location.id),
                "code": location.code,
                "name": location.name,
                "total": total,
                "counted": counted,
                "pending": max(total - counted, 0),
            })
        return Response({"items": rows})

    @action(detail=True, methods=["get"], url_path="items")
    def items(self, request, pk=None):
        batch = self.get_object()
        qs = batch.lines.select_related("material", "location").all()
        location = request.query_params.get("location")
        if location:
            qs = qs.filter(location_id=location) if len(str(location)) > 20 else qs.filter(location__code__iexact=location)
        rows = []
        for line in qs.order_by("location__code", "material__code", "label_id")[:200]:
            rows.append({
                "id": str(line.id),
                "ref_type": line.stock_class,
                "ref_id": str(line.id),
                "materialCode": line.material.code,
                "locationCode": line.location.code,
                "materialKind": line.stock_class,
                "systemQty": float(line.system_qty or 0),
                "countedQty": float(line.counted_qty) if line.counted_qty is not None else None,
                "uom": line.uom,
                "label": line.label_id or line.material.code,
                "submitted": line.counted_qty is not None,
            })
        return Response({"items": rows})

    @action(detail=True, methods=["post"], url_path="lines/import")
    def lines_import(self, request, pk=None):
        guard = _require_permission(request, "inventory.audit.manage")
        if guard:
            return guard
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

    @action(detail=True, methods=["post"], url_path="lines/import-file")
    def lines_import_file(self, request, pk=None):
        guard = _require_permission(request, "inventory.audit.manage")
        if guard:
            return guard
        try:
            batch = self.get_object()
            uploaded = request.FILES.get("file")
            if not uploaded:
                return Response({"detail": "Upload a CSV or XLSX file."}, status=status.HTTP_400_BAD_REQUEST)
            default_stock_class = request.data.get("stock_class")
            InventoryAuditService.import_file(batch=batch, uploaded_file=uploaded, default_stock_class=default_stock_class)
            batch.refresh_from_db()
            return Response(self.get_serializer(batch).data)
        except DjangoValidationError as exc:
            return _error_response(exc)

    @action(detail=True, methods=["post"], url_path="lines/validate")
    def lines_validate(self, request, pk=None):
        guard = _require_permission(request, "inventory.audit.manage")
        if guard:
            return guard
        try:
            batch = self.get_object()
            result = InventoryAuditService.validate_batch(batch=batch)
            batch.refresh_from_db()
            payload = self.get_serializer(batch).data
            payload["validation"] = result
            return Response(payload)
        except DjangoValidationError as exc:
            return _error_response(exc)

    @action(detail=True, methods=["get"], url_path="preview")
    def preview(self, request, pk=None):
        guard = _require_permission(request, "inventory.audit.view")
        if guard:
            return guard
        try:
            return Response(InventoryAuditService.preview_batch(batch=self.get_object()))
        except DjangoValidationError as exc:
            return _error_response(exc)

    @action(detail=True, methods=["post"], url_path="submit")
    def submit(self, request, pk=None):
        guard = _require_permission(request, "inventory.audit.manage")
        if guard:
            return guard
        try:
            batch = InventoryAuditService.submit_batch(batch=self.get_object(), user=request.user)
            return Response(self.get_serializer(batch).data)
        except DjangoValidationError as exc:
            return _error_response(exc)

    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request, pk=None):
        guard = _require_permission(request, "inventory.audit.manage")
        if guard:
            return guard
        try:
            batch = InventoryAuditService.approve_batch(batch=self.get_object(), user=request.user)
            return Response(self.get_serializer(batch).data)
        except DjangoValidationError as exc:
            return _error_response(exc)

    @action(detail=True, methods=["post"], url_path="load-system-stock")
    def load_system_stock(self, request, pk=None):
        guard = _require_permission(request, "inventory.audit.manage")
        if guard:
            return guard
        try:
            batch = InventoryAuditService.load_batch_from_snapshot(
                batch=self.get_object(),
                stock_class=request.data.get("stock_class"),
                location_id=request.data.get("location"),
                material_id=request.data.get("material"),
                query=request.data.get("query"),
                replace_existing=bool(request.data.get("replace_existing", True)),
            )
            return Response(self.get_serializer(batch).data)
        except DjangoValidationError as exc:
            return _error_response(exc)

    @action(detail=True, methods=["post"], url_path="post")
    def post_batch(self, request, pk=None):
        guard = _require_permission(request, "inventory.audit.manage")
        if guard:
            return guard
        try:
            batch = InventoryAuditService.post_batch(batch=self.get_object(), user=request.user)
            return Response(self.get_serializer(batch).data)
        except DjangoValidationError as exc:
            return _error_response(exc)

    @action(detail=True, methods=["post"], url_path="void")
    def void(self, request, pk=None):
        guard = _require_permission(request, "inventory.audit.manage")
        if guard:
            return guard
        batch = self.get_object()
        if batch.status in {"POSTED", "LOCKED"}:
            return Response({"detail": "Posted or locked batches cannot be voided from the UI."}, status=status.HTTP_400_BAD_REQUEST)
        batch.status = "VOID"
        batch.notes = f"{batch.notes}\nVOID: {request.data.get('reason') or 'No reason supplied'}".strip()
        batch.save(update_fields=["status", "notes", "updated_at"])
        return Response(self.get_serializer(batch).data)

    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel(self, request, pk=None):
        guard = _require_permission(request, "inventory.audit.manage")
        if guard:
            return guard
        try:
            batch = InventoryAuditService.cancel_batch(batch=self.get_object(), user=request.user, reason=request.data.get("reason"))
            return Response(self.get_serializer(batch).data)
        except DjangoValidationError as exc:
            return _error_response(exc)

    @action(detail=True, methods=["get"], url_path="export")
    def export(self, request, pk=None):
        guard = _require_permission(request, "inventory.audit.view")
        if guard:
            return guard
        try:
            batch = self.get_object()
            content, file_name = InventoryAuditService.build_batch_workbook(batch=batch)
            return FileResponse(
                BytesIO(content),
                as_attachment=True,
                filename=file_name,
                content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        except DjangoValidationError as exc:
            return _error_response(exc)

    @action(detail=False, methods=["get"], url_path="sample-template")
    def sample_template(self, request):
        guard = _require_permission(request, "inventory.audit.view")
        if guard:
            return guard
        try:
            batch_type = request.query_params.get("type") or "OPENING_STOCK"
            stock_class = request.query_params.get("stock_class") or "BULK"
            content, file_name = InventoryAuditService.build_sample_template(batch_type=batch_type, stock_class=stock_class)
            return FileResponse(
                BytesIO(content),
                as_attachment=True,
                filename=file_name,
                content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        except DjangoValidationError as exc:
            return _error_response(exc)


class StockSnapshotView(APIView):
    def get(self, request):
        guard = _require_permission(request, "inventory.audit.view")
        if guard:
            return guard
        try:
            payload = InventoryAuditService.stock_snapshot(
                plant_id=request.query_params.get("plant"),
                stock_class=request.query_params.get("stock_class"),
                location_id=request.query_params.get("location"),
                material_id=request.query_params.get("material"),
                query=request.query_params.get("query"),
            )
            return Response(payload)
        except DjangoValidationError as exc:
            return _error_response(exc)


class ClosingPreviewView(APIView):
    def get(self, request):
        guard = _require_permission(request, "inventory.audit.view")
        if guard:
            return guard
        try:
            payload = InventoryAuditService.closing_preview(
                plant_id=request.query_params.get("plant"),
                financial_year=request.query_params.get("financial_year") or current_indian_financial_year(),
            )
            return Response(payload)
        except DjangoValidationError as exc:
            return _error_response(exc)

    def post(self, request):
        guard = _require_permission(request, "inventory.audit.view")
        if guard:
            return guard
        try:
            financial_year = request.data.get("financial_year") or current_indian_financial_year()
            payload = InventoryAuditService.closing_preview(
                plant_id=request.data.get("plant"),
                financial_year=financial_year,
            )
            content, file_name = InventoryAuditService.build_closing_preview_workbook(preview=payload, financial_year=financial_year)
            return FileResponse(
                BytesIO(content),
                as_attachment=True,
                filename=file_name,
                content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        except DjangoValidationError as exc:
            return _error_response(exc)


class StockCardView(APIView):
    def get(self, request):
        guard = _require_permission(request, "inventory.audit.view")
        if guard:
            return guard
        try:
            payload = InventoryAuditService.stock_card(
                material_id=request.query_params.get("material"),
                plant_id=request.query_params.get("plant"),
                location_id=request.query_params.get("location"),
                financial_year=request.query_params.get("financial_year"),
                date_from=parse_date(request.query_params.get("from")) if request.query_params.get("from") else None,
                date_to=parse_date(request.query_params.get("to")) if request.query_params.get("to") else None,
            )
            return Response(payload)
        except DjangoValidationError as exc:
            return _error_response(exc)

    def post(self, request):
        guard = _require_permission(request, "inventory.audit.view")
        if guard:
            return guard
        try:
            payload = InventoryAuditService.stock_card(
                material_id=request.data.get("material"),
                plant_id=request.data.get("plant"),
                location_id=request.data.get("location"),
                financial_year=request.data.get("financial_year"),
                date_from=parse_date(request.data.get("from")) if request.data.get("from") else None,
                date_to=parse_date(request.data.get("to")) if request.data.get("to") else None,
            )
            content, file_name = InventoryAuditService.build_stock_card_workbook(payload=payload)
            return FileResponse(
                BytesIO(content),
                as_attachment=True,
                filename=file_name,
                content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        except DjangoValidationError as exc:
            return _error_response(exc)


def _resolve_opening_row(row, default_plant=None):
    plant = default_plant
    plant_code = str(row.get("plant_code") or "").strip()
    if plant_code:
        plant = Plant.objects.filter(code__iexact=plant_code).first()
    if not plant:
        raise DjangoValidationError("plant_code is required or no default plant is available.")

    location_lookup = str(row.get("location_id") or row.get("location") or "").strip()
    location = InventoryLocation.objects.filter(plant=plant, id=location_lookup).first() if _uuid_like(location_lookup) else None
    location_code = str(row.get("location_code") or ("" if _uuid_like(row.get("location")) else row.get("location")) or "").strip()
    location_name = str(row.get("location_name") or "").strip()
    if not location and location_code:
        location = InventoryLocation.objects.filter(plant=plant, code__iexact=location_code).first()
    if not location and location_name:
        location = InventoryLocation.objects.filter(plant=plant, name__iexact=location_name).first()
    if not location:
        label = location_code or location_name or location_lookup
        raise DjangoValidationError(f"Location {label} was not found for plant {plant.code}.")

    material_lookup = str(row.get("material_id") or row.get("material") or "").strip()
    material = InventoryMaterial.objects.filter(id=material_lookup).first() if _uuid_like(material_lookup) else None
    material_code = str(
        row.get("product_code")
        or row.get("material_code")
        or row.get("variant_code")
        or ("" if _uuid_like(row.get("material")) else row.get("material"))
        or ""
    ).strip()
    if not material and material_code:
        material = InventoryMaterial.objects.filter(code__iexact=material_code).first()
    if not material:
        label = material_code or material_lookup
        raise DjangoValidationError(f"Material {label} was not found.")

    klass = str(row.get("klass") or row.get("stock_class") or "").upper().strip()
    if not klass:
        klass = "PACKAGING" if material.category == "PACKAGING" else ("ROLL" if material.category in {"FILM_VARIANT", "POD"} else "BULK")
    granule_code_id = _resolve_granule_code_for_row(row, material) if str(material.category or "").upper() == "GRANULE" else None
    qty = row.get("qty") or row.get("weight_kg") or row.get("quantity") or row.get("opening_qty")
    return plant, {
        "stock_class": klass,
        "material": str(material.id),
        "granule_code": granule_code_id,
        "location": str(location.id),
        "quantity": qty,
        "counted_qty": qty,
        "uom": row.get("uom") or material.base_uom or "KG",
        "grade": row.get("grade") or row.get("grade_id") or "",
        "label_id": row.get("label") or row.get("label_id") or "",
        "batch_no": row.get("lot_no") or row.get("batch_no") or "",
        "width_mm": row.get("width_mm") or "",
        "thickness_micron": row.get("thickness_um") or row.get("thickness_micron") or "",
        "length_m": row.get("length_m") or "",
        "rate": row.get("rate") or row.get("avg_cost") or row.get("unit_rate") or "",
        "is_fg": row.get("is_fg") or False,
        "stage_index": row.get("stage_index") or 0,
        "status": row.get("status") or "AVAILABLE",
        "stock_form": row.get("stock_form") or ("OPEN_WEB" if klass == "ROLL" else ""),
        "width_basis": row.get("width_basis") or ("OPEN_WEB_WIDTH" if klass == "ROLL" else ""),
        "packaging_kind": row.get("packaging_kind") or getattr(material, "packaging_kind", ""),
        "base_uom": row.get("uom") or material.base_uom or "",
    }


def _read_opening_csv(uploaded):
    uploaded.seek(0)
    wrapper = TextIOWrapper(uploaded.file, encoding="utf-8-sig")
    try:
        return list(csv.DictReader(wrapper))
    finally:
        wrapper.detach()


def _read_opening_xlsx(uploaded):
    uploaded.seek(0)
    workbook = load_workbook(uploaded, read_only=True, data_only=True)
    sheet = workbook.active
    rows = list(sheet.iter_rows(values_only=True))
    if not rows:
        return []
    headers = [str(value or "").strip() for value in rows[0]]
    parsed = []
    for values in rows[1:]:
        if not any(value not in (None, "") for value in values):
            continue
        parsed.append({headers[index]: values[index] if index < len(values) else "" for index in range(len(headers)) if headers[index]})
    return parsed


def _read_opening_upload(uploaded):
    name = str(getattr(uploaded, "name", "") or "").lower()
    if name.endswith((".xlsx", ".xlsm")):
        return _read_opening_xlsx(uploaded)
    return _read_opening_csv(uploaded)


class OpeningStockCsvView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        guard = _require_permission(request, "inventory.audit.manage")
        if guard:
            return guard
        uploaded = request.FILES.get("file")
        if not uploaded:
            return Response({"detail": "Upload a CSV or XLSX file."}, status=status.HTTP_400_BAD_REQUEST)
        raw_rows = _read_opening_upload(uploaded)
        default_plant = Plant.objects.filter(id=request.data.get("plant_id") or request.data.get("plant")).first() if (request.data.get("plant_id") or request.data.get("plant")) else Plant.objects.first()
        valid_rows = []
        errors = []
        plant = default_plant
        for index, row in enumerate(raw_rows, start=2):
            try:
                plant, normalized = _resolve_opening_row(row, default_plant=default_plant)
                valid_rows.append(normalized)
            except DjangoValidationError as exc:
                errors.append({"row": index, "field": "row", "message": str(exc)})
        summary_by_klass = {}
        for row in valid_rows:
            summary_by_klass[row["stock_class"]] = summary_by_klass.get(row["stock_class"], 0) + 1
        dry_run = str(request.data.get("dry_run", "true")).lower() not in {"0", "false", "no"} and not request.data.get("commit")
        if errors:
            payload = {
                "rows_total": len(raw_rows),
                "rows_valid": len(valid_rows),
                "rows_invalid": len(errors),
                "errors": errors[:200],
                "summary_by_klass": summary_by_klass,
            }
            if dry_run:
                return Response(payload)
            return Response(payload, status=status.HTTP_400_BAD_REQUEST)
        try:
            with transaction.atomic():
                batch = InventoryAuditService.create_batch(
                    payload={
                        "type": "OPENING_STOCK",
                        "plant": str(plant.id),
                        "financial_year": request.data.get("financial_year") or current_indian_financial_year(),
                        "cutoff_at": request.data.get("cutoff_at") or timezone.now().isoformat(),
                        "notes": request.data.get("notes") or "V3.6 opening stock CSV/XLSX import",
                        "source_file_name": uploaded.name,
                        "_v36_workflow": _opening_workflow_from_payload(request.data),
                    },
                    user=request.user,
                )
                InventoryAuditService.import_lines(batch=batch, rows=valid_rows)
                validation = InventoryAuditService.validate_batch(batch=batch)
                business_errors = []
                valid_line_count = 0
                for offset, line in enumerate(batch.lines.order_by("created_at"), start=2):
                    blockers = [str(error) for error in (line.row_errors or []) if not str(error).startswith("W-")]
                    if blockers:
                        business_errors.append({"row": offset, "field": "row", "message": "; ".join(blockers)})
                    else:
                        valid_line_count += 1
                response_payload = {
                    "rows_total": len(raw_rows),
                    "rows_valid": valid_line_count,
                    "rows_invalid": len(business_errors),
                    "errors": business_errors[:200],
                    "summary_by_klass": summary_by_klass,
                    "validation": validation,
                }
                if dry_run:
                    transaction.set_rollback(True)
                    return Response(response_payload)
                if business_errors:
                    transaction.set_rollback(True)
                    return Response(response_payload, status=status.HTTP_400_BAD_REQUEST)
                batch = InventoryAuditService.post_batch(batch=batch, user=request.user)
        except DjangoValidationError as exc:
            return _error_response(exc)
        return Response({"batch_id": str(batch.id), "rows_committed": len(valid_rows), "opening_value_inr": float((batch.summary_json or {}).get("value", 0))}, status=status.HTTP_201_CREATED)


class OpeningStockManualView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        guard = _require_permission(request, "inventory.audit.manage")
        if guard:
            return guard
        rows = request.data.get("lines") or request.data.get("rows") or []
        if not isinstance(rows, list) or not rows:
            return Response({"detail": "lines must be a non-empty array."}, status=status.HTTP_400_BAD_REQUEST)
        plant = Plant.objects.filter(id=request.data.get("plant_id") or request.data.get("plant")).first() or Plant.objects.first()
        try:
            with transaction.atomic():
                normalized = [_resolve_opening_row(row, default_plant=plant)[1] for row in rows]
                batch = InventoryAuditService.create_batch(
                    payload={
                        "type": "OPENING_STOCK",
                        "plant": str(plant.id),
                        "financial_year": request.data.get("financial_year") or current_indian_financial_year(),
                        "cutoff_at": request.data.get("cutoff_at") or timezone.now().isoformat(),
                        "notes": request.data.get("notes") or "V3.6 opening stock manual entry",
                        "_v36_workflow": _opening_workflow_from_payload(request.data),
                    },
                    user=request.user,
                )
                InventoryAuditService.import_lines(batch=batch, rows=normalized)
                batch = InventoryAuditService.post_batch(batch=batch, user=request.user)
            return Response({"batch_id": str(batch.id), "rows_committed": len(normalized), "opening_value_inr": float((batch.summary_json or {}).get("value", 0))}, status=status.HTTP_201_CREATED)
        except DjangoValidationError as exc:
            return _error_response(exc)


class OpeningStockFromCountView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        guard = _require_permission(request, "inventory.audit.manage")
        if guard:
            return guard
        source_id = request.data.get("batch_id") or request.data.get("audit_batch_id")
        source = InventoryAuditBatch.objects.filter(id=source_id).first()
        if not source:
            return Response({"detail": "Source count batch was not found."}, status=status.HTTP_404_NOT_FOUND)
        rows = []
        for line in source.lines.select_related("material", "location"):
            rows.append({
                "stock_class": line.stock_class,
                "material": str(line.material_id),
                "location": str(line.location_id),
                "quantity": str(line.counted_qty if line.counted_qty is not None else line.system_qty),
                "uom": line.uom,
                "label_id": line.label_id,
                "batch_no": line.batch_no,
                "width_mm": str(line.width_mm or ""),
                "thickness_micron": str(line.thickness_micron or ""),
                "length_m": str(line.length_m or ""),
                "packaging_kind": line.packaging_kind,
                "base_uom": line.base_uom,
            })
        try:
            batch = InventoryAuditService.create_batch(
                payload={
                    "type": "OPENING_STOCK",
                    "plant": str(source.plant_id),
                    "financial_year": request.data.get("financial_year") or current_indian_financial_year(),
                    "cutoff_at": request.data.get("cutoff_at") or timezone.now().isoformat(),
                    "notes": f"Promoted from count batch {source.batch_no}",
                },
                user=request.user,
            )
            InventoryAuditService.import_lines(batch=batch, rows=rows)
            batch = InventoryAuditService.post_batch(batch=batch, user=request.user)
            return Response({"batch_id": str(batch.id), "rows_committed": len(rows), "opening_value_inr": float((batch.summary_json or {}).get("value", 0))}, status=status.HTTP_201_CREATED)
        except DjangoValidationError as exc:
            return _error_response(exc)


# Stock class derivation per InventoryMaterial.category
_STOCK_CLASS_BY_CATEGORY = {
    "FILM_VARIANT": "ROLL",
    "PACKAGING": "PACKAGING",
    "GRANULE": "BULK",
    "SOLVENT": "BULK",
    "INK": "BULK",
    "ADHESIVE": "BULK",
    "ADDON": "BULK",
    "POD": "ROLL",
}


class MasterCatalogView(APIView):
    """Stock Lifecycle workspace master catalog.

    Returns every InventoryMaterial along with the current system quantity in
    the requested plant (summed across locations) and a per-location breakdown.
    Unlike the current_stock_snapshot, this includes materials with zero stock
    so the lifecycle workspace can offer them for opening / counting.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        guard = _require_permission(request, "inventory.audit.view")
        if guard:
            return guard

        plant_qs = Plant.objects.all().order_by("code", "name")
        plant_arg = request.query_params.get("plant")
        plant = None
        if plant_arg and plant_arg != "any":
            plant = plant_qs.filter(id=plant_arg).first()
        if plant is None:
            plant = plant_qs.first()

        if plant is None:
            return Response({"plant": None, "rows": [], "by_category": {}})

        # Pre-fetch location names for this plant
        plant_locations = {
            str(loc.id): loc
            for loc in InventoryLocation.objects.filter(plant=plant)
        }

        # Aggregate quantities by (material_id, location_id), and by granule quality code
        # where the physical stock identity is finer than the material family.
        agg: dict = {}
        granule_code_qty: dict[str, dict[str, float]] = {}

        # BULK qty (qty_kg)
        for bulk in InventoryBulk.objects.select_related("material", "location", "granule_code").filter(plant=plant):
            mid = str(bulk.material_id)
            lid = str(bulk.location_id) if bulk.location_id else None
            qty = float(bulk.qty_kg or 0)
            if qty == 0:
                continue
            entry = agg.setdefault(mid, {})
            entry[lid] = entry.get(lid, 0.0) + qty
            if str(getattr(bulk.material, "category", "") or "").upper() == "GRANULE" and bulk.granule_code_id:
                code_map = granule_code_qty.setdefault(mid, {})
                code_id = str(bulk.granule_code_id)
                code_map[code_id] = code_map.get(code_id, 0.0) + qty

        # ROLL qty (weight_kg) - filter by location.plant, exclude CONSUMED/SCRAPPED
        for roll in InventoryRoll.objects.select_related("material", "location").filter(
            location__plant=plant
        ).exclude(status__in=["CONSUMED", "SCRAPPED"]):
            if not roll.material_id:
                continue
            mid = str(roll.material_id)
            lid = str(roll.location_id) if roll.location_id else None
            qty = float(roll.weight_kg or 0)
            if qty == 0:
                continue
            entry = agg.setdefault(mid, {})
            entry[lid] = entry.get(lid, 0.0) + qty

        # PACKAGING qty
        for stock in PackagingStock.objects.select_related("material", "location").filter(plant=plant):
            mid = str(stock.material_id)
            lid = str(stock.location_id) if stock.location_id else None
            qty = float(stock.qty or 0)
            if qty == 0:
                continue
            entry = agg.setdefault(mid, {})
            entry[lid] = entry.get(lid, 0.0) + qty

        rows: list = []
        by_category: dict = {}

        granule_codes_by_material: dict[str, list[dict]] = {}
        for quality_code in GranuleQualityCode.objects.filter(status="ACTIVE").order_by("granule_id", "code"):
            granule_codes_by_material.setdefault(str(quality_code.granule_id), []).append(
                {
                    "id": str(quality_code.id),
                    "code": quality_code.code,
                    "name": quality_code.notes or quality_code.code,
                }
            )

        stock_materials = (
            InventoryMaterial.objects.select_related("grade")
            .exclude(category="FILM_FAMILY")
            .order_by("category", "code")
        )

        for material in stock_materials:
            mid = str(material.id)
            loc_map = agg.get(mid, {})
            locations = []
            system_qty = 0.0
            for lid, qty in loc_map.items():
                if lid and lid in plant_locations:
                    locations.append({
                        "id": lid,
                        "name": plant_locations[lid].name,
                        "qty": round(qty, 4),
                    })
                elif lid is None:
                    locations.append({"id": None, "name": "(unassigned)", "qty": round(qty, 4)})
                system_qty += qty

            stock_class = _STOCK_CLASS_BY_CATEGORY.get(str(material.category or ""), "BULK")

            row = {
                "id": mid,
                "code": material.code,
                "name": material.name or material.code,
                "category": material.category,
                "stock_class": stock_class,
                "base_uom": material.base_uom or "KG",
                "is_extrudable": bool(getattr(material, "is_extrudable", False)),
                "default_grade_id": str(material.grade_id) if getattr(material, "grade_id", None) else None,
                "default_grade_name": material.grade.name if getattr(material, "grade_id", None) else None,
                "granule_codes": granule_codes_by_material.get(mid, []),
                "granule_code_quantities": {code_id: round(qty, 4) for code_id, qty in granule_code_qty.get(mid, {}).items()},
                "system_qty": round(system_qty, 4),
                "locations": locations,
            }
            rows.append(row)
            by_category.setdefault(material.category, []).append(row)

        return Response({
            "plant": {
                "id": str(plant.id),
                "name": plant.name,
                "code": plant.code,
            },
            "rows": rows,
            "by_category": by_category,
        })
