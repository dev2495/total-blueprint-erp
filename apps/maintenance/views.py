"""
Maintenance API.

Permissions (granted through the role matrix):
  maintenance.view   - read schedules, jobs, faults, board, reports, scan cards
  maintenance.log    - operator checks, fault reports, attachments
  maintenance.work   - technician: start/complete jobs
  maintenance.manage - supervisor: schedules, assign, verify, cancel, reports
"""
from __future__ import annotations

import os
from datetime import date
from decimal import Decimal
from urllib.parse import urlparse

from django.conf import settings
from django.db.models import Count, Q, Sum
from django.http import FileResponse, Http404, HttpResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.negotiation import DefaultContentNegotiation
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.factory.models import Machine
from apps.inventory.models import InventoryLocation
from apps.maintenance.models import MachineFault, MaintenanceAttachment, MaintenanceEditLog, MaintenanceJob, MaintenanceSchedule
from apps.maintenance.serializers import (
    FaultReportSerializer,
    JobCompleteSerializer,
    MachineFaultSerializer,
    MaintenanceAttachmentSerializer,
    MaintenanceEditLogSerializer,
    MaintenanceJobSerializer,
    MaintenanceScheduleSerializer,
    MachineRefSerializer,
)
from apps.maintenance.services import MaintenanceService
from apps.users.permission_registry import can_with_wildcard
from apps.users.permission_service import PermissionService
from apps.users.role_catalog import get_canonical_role_code

MAX_UPLOAD_BYTES = 8 * 1024 * 1024
ALLOWED_UPLOAD_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"}


def granted_for(user) -> set:
    try:
        return set(PermissionService.get_user_permissions(user) or [])
    except Exception:
        return set()


def user_can(user, code: str) -> bool:
    return can_with_wildcard(granted_for(user), code)


def require(user, code: str):
    if not user_can(user, code):
        raise PermissionDenied(f"Missing permission: {code}")


def effective_role(user) -> str:
    return get_canonical_role_code(getattr(user, "effective_role_code", "") or (user.role.code if getattr(user, "role", None) else ""))


class MaintenanceAccess(BasePermission):
    message = "You do not have maintenance access."

    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return False
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return user_can(user, "maintenance.view")
        return user_can(user, "maintenance.log") or user_can(user, "maintenance.work") or user_can(user, "maintenance.manage")


def _plant_filter(request, qs, field="machine__work_center__plant_id"):
    plant_id = request.query_params.get("plant_id")
    if plant_id:
        qs = qs.filter(**{field: plant_id})
    return qs


# ============================================================================ schedules
class MaintenanceScheduleViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, MaintenanceAccess]
    serializer_class = MaintenanceScheduleSerializer

    def get_queryset(self):
        qs = MaintenanceSchedule.objects.select_related("machine", "machine__work_center", "machine__work_center__plant", "responsible_user")
        qs = _plant_filter(self.request, qs)
        machine_id = self.request.query_params.get("machine_id")
        if machine_id:
            qs = qs.filter(machine_id=machine_id)
        if self.request.query_params.get("active", "1") in ("1", "true"):
            qs = qs.filter(is_active=True)
        return qs

    def perform_create(self, serializer):
        require(self.request.user, "maintenance.manage")
        schedule = serializer.save(created_by=self.request.user)
        MaintenanceService.initialize_schedule(schedule, user=self.request.user)
        MaintenanceEditLog.objects.create(object_type="SCHEDULE", object_id=schedule.id, action="CREATED", actor=self.request.user, after={"name": schedule.name})

    def perform_update(self, serializer):
        require(self.request.user, "maintenance.manage")
        before = {"name": serializer.instance.name, "interval_type": serializer.instance.interval_type, "interval_value": serializer.instance.interval_value, "anchor_date": str(serializer.instance.anchor_date)}
        schedule = serializer.save()
        MaintenanceService.initialize_schedule(schedule, user=self.request.user)
        MaintenanceEditLog.objects.create(object_type="SCHEDULE", object_id=schedule.id, action="UPDATED", actor=self.request.user, before=before,
                                          after={"name": schedule.name, "interval_type": schedule.interval_type, "interval_value": schedule.interval_value, "anchor_date": str(schedule.anchor_date)})

    def perform_destroy(self, instance):
        require(self.request.user, "maintenance.manage")
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])
        MaintenanceEditLog.objects.create(object_type="SCHEDULE", object_id=instance.id, action="DEACTIVATED", actor=self.request.user)

    @action(detail=False, methods=["post"], url_path="generate-due")
    def generate_due(self, request):
        require(request.user, "maintenance.manage")
        lookahead = int(request.data.get("lookahead_days") or 0)
        return Response(MaintenanceService.generate_due_jobs(lookahead_days=lookahead, user=request.user))


# ============================================================================ jobs
class MaintenanceJobViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, MaintenanceAccess]
    serializer_class = MaintenanceJobSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        qs = MaintenanceJob.objects.select_related("machine", "machine__work_center", "machine__work_center__plant", "assigned_to", "schedule", "fault", "completed_by", "verified_by").prefetch_related("attachments")
        qs = _plant_filter(self.request, qs)
        p = self.request.query_params
        if p.get("machine_id"):
            qs = qs.filter(machine_id=p.get("machine_id"))
        if p.get("status"):
            qs = qs.filter(status__in=[s.strip().upper() for s in p.get("status").split(",") if s.strip()])
        if p.get("open") in ("1", "true"):
            qs = qs.filter(status__in=MaintenanceJob.OPEN_STATUSES)
        if p.get("mine") in ("1", "true"):
            qs = qs.filter(Q(assigned_to=self.request.user) | Q(assigned_to__isnull=True, assigned_role__in=self._roles_for(self.request.user)))
        if p.get("kind"):
            qs = qs.filter(kind=p.get("kind"))
        if p.get("date"):
            qs = qs.filter(planned_date=p.get("date"))
        if p.get("date_from"):
            qs = qs.filter(planned_date__gte=p.get("date_from"))
        if p.get("date_to"):
            qs = qs.filter(planned_date__lte=p.get("date_to"))
        return qs

    @staticmethod
    def _roles_for(user):
        role = effective_role(user)
        if role in {"MAINTENANCE_TECH", "MAINTENANCE_SUPERVISOR"}:
            return ["MAINTENANCE_TECH"]
        return ["OPERATOR"]

    def perform_create(self, serializer):
        user = self.request.user
        if not (user_can(user, "maintenance.manage") or user_can(user, "maintenance.work")):
            raise PermissionDenied("Only maintenance staff can add jobs by hand.")
        data = serializer.validated_data
        job = MaintenanceService.create_manual_job(
            machine=data["machine"], title=data["title"], planned_date=data.get("planned_date") or timezone.localdate(),
            kind=data.get("kind") or "TECH_SERVICE", assigned_role=data.get("assigned_role") or "MAINTENANCE_TECH",
            assigned_to=data.get("assigned_to"), fault=data.get("fault"), checklist=data.get("checklist") or [],
            requires_verification=bool(data.get("requires_verification")), notes=data.get("notes") or "", user=user,
        )
        serializer.instance = job

    def perform_update(self, serializer):
        require(self.request.user, "maintenance.manage")
        serializer.save()

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        job = self.get_object()
        if not (user_can(request.user, "maintenance.work") or user_can(request.user, "maintenance.log") or user_can(request.user, "maintenance.manage")):
            raise PermissionDenied("You cannot start maintenance work.")
        try:
            MaintenanceService.start_job(job, user=request.user)
        except ValueError as exc:
            raise ValidationError(str(exc))
        return Response(self.get_serializer(job).data)

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        job = self.get_object()
        needed = "maintenance.log" if job.kind == "OPERATOR_CHECK" else "maintenance.work"
        if not (user_can(request.user, needed) or user_can(request.user, "maintenance.manage")):
            raise PermissionDenied(f"Missing permission: {needed}")
        ser = JobCompleteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            MaintenanceService.complete_job(job, user=request.user, **ser.validated_data)
        except ValueError as exc:
            raise ValidationError(str(exc))
        job.refresh_from_db()
        return Response(self.get_serializer(job).data)

    @action(detail=True, methods=["post"])
    def verify(self, request, pk=None):
        require(request.user, "maintenance.manage")
        job = self.get_object()
        try:
            MaintenanceService.verify_job(job, user=request.user, accepted=bool(request.data.get("accepted", True)), note=str(request.data.get("note") or ""))
        except ValueError as exc:
            raise ValidationError(str(exc))
        return Response(self.get_serializer(job).data)

    @action(detail=True, methods=["post"])
    def reassign(self, request, pk=None):
        require(request.user, "maintenance.manage")
        job = self.get_object()
        assigned_to = None
        if request.data.get("assigned_to"):
            from apps.users.models import User
            assigned_to = User.objects.filter(id=request.data.get("assigned_to")).first()
            if assigned_to is None:
                raise ValidationError("Unknown user.")
        planned_date = None
        if request.data.get("planned_date"):
            planned_date = date.fromisoformat(str(request.data.get("planned_date")))
        MaintenanceService.reassign_job(job, assigned_to=assigned_to, planned_date=planned_date, user=request.user, note=str(request.data.get("note") or ""))
        return Response(self.get_serializer(job).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        require(request.user, "maintenance.manage")
        job = self.get_object()
        try:
            MaintenanceService.cancel_job(job, user=request.user, note=str(request.data.get("note") or ""))
        except ValueError as exc:
            raise ValidationError(str(exc))
        return Response(self.get_serializer(job).data)

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        job = self.get_object()
        rows = MaintenanceEditLog.objects.filter(object_type="JOB", object_id=job.id).select_related("actor")
        return Response(MaintenanceEditLogSerializer(rows, many=True).data)


# ============================================================================ faults
class MachineFaultViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, MaintenanceAccess]
    serializer_class = MachineFaultSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        qs = MachineFault.objects.select_related("machine", "machine__work_center", "machine__work_center__plant", "reported_by", "assigned_to", "resolved_by", "production_job").prefetch_related("attachments")
        qs = _plant_filter(self.request, qs)
        p = self.request.query_params
        if p.get("machine_id"):
            qs = qs.filter(machine_id=p.get("machine_id"))
        if p.get("status"):
            qs = qs.filter(status__in=[s.strip().upper() for s in p.get("status").split(",") if s.strip()])
        if p.get("open") in ("1", "true"):
            qs = qs.filter(status__in=["OPEN", "ASSIGNED", "IN_REPAIR"])
        return qs

    def create(self, request, *args, **kwargs):
        if not (user_can(request.user, "maintenance.log") or user_can(request.user, "maintenance.work") or user_can(request.user, "maintenance.manage")):
            raise PermissionDenied("You cannot report faults.")
        ser = FaultReportSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        machine = Machine.objects.filter(id=ser.validated_data["machine"]).first()
        if machine is None:
            raise ValidationError("Unknown machine.")
        fault = MaintenanceService.report_fault(
            machine=machine, title=ser.validated_data["title"], description=ser.validated_data.get("description") or "",
            severity=ser.validated_data.get("severity") or "MEDIUM", machine_running=ser.validated_data.get("machine_running", True), user=request.user,
        )
        return Response(self.get_serializer(fault).data, status=status.HTTP_201_CREATED)

    def perform_update(self, serializer):
        require(self.request.user, "maintenance.manage")
        serializer.save()

    @action(detail=True, methods=["post"])
    def assign(self, request, pk=None):
        require(request.user, "maintenance.manage")
        fault = self.get_object()
        assigned_to = None
        if request.data.get("assigned_to"):
            from apps.users.models import User
            assigned_to = User.objects.filter(id=request.data.get("assigned_to")).first()
        planned_date = date.fromisoformat(str(request.data.get("planned_date"))) if request.data.get("planned_date") else None
        fault, job = MaintenanceService.assign_fault(fault, assigned_to=assigned_to, user=request.user, create_job=bool(request.data.get("create_job", True)), planned_date=planned_date)
        return Response({"fault": self.get_serializer(fault).data, "job": MaintenanceJobSerializer(job).data if job else None})

    @action(detail=True, methods=["post"], url_path="set-status")
    def set_status(self, request, pk=None):
        fault = self.get_object()
        target = str(request.data.get("status") or "").upper()
        if target in {"IN_REPAIR", "RESOLVED"}:
            if not (user_can(request.user, "maintenance.work") or user_can(request.user, "maintenance.manage")):
                raise PermissionDenied("Only maintenance staff can change repair status.")
        else:
            require(request.user, "maintenance.manage")
        try:
            MaintenanceService.set_fault_status(fault, status=target, user=request.user, note=str(request.data.get("note") or ""))
        except ValueError as exc:
            raise ValidationError(str(exc))
        return Response(self.get_serializer(fault).data)

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        fault = self.get_object()
        rows = MaintenanceEditLog.objects.filter(object_type="FAULT", object_id=fault.id).select_related("actor")
        return Response(MaintenanceEditLogSerializer(rows, many=True).data)


# ============================================================================ attachments
class AttachmentUploadView(APIView):
    permission_classes = [IsAuthenticated, MaintenanceAccess]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        upload = request.FILES.get("file")
        if upload is None:
            raise ValidationError("A file is required.")
        if upload.size > MAX_UPLOAD_BYTES:
            raise ValidationError("File is larger than 8 MB.")
        content_type = str(getattr(upload, "content_type", "") or "").lower()
        if content_type not in ALLOWED_UPLOAD_TYPES:
            raise ValidationError("Only photos (JPEG, PNG, WebP, HEIC) and PDF are accepted.")
        job = MaintenanceJob.objects.filter(id=request.data.get("job")).first() if request.data.get("job") else None
        fault = MachineFault.objects.filter(id=request.data.get("fault")).first() if request.data.get("fault") else None
        if job is None and fault is None:
            raise ValidationError("Attach the file to a job or a fault.")
        safe_name = os.path.basename(str(upload.name or "photo"))[:255]
        row = MaintenanceAttachment.objects.create(job=job, fault=fault, file=upload, original_name=safe_name, content_type=content_type, size_bytes=upload.size, uploaded_by=request.user)
        return Response(MaintenanceAttachmentSerializer(row).data, status=status.HTTP_201_CREATED)


class AttachmentFileView(APIView):
    permission_classes = [IsAuthenticated, MaintenanceAccess]

    def get(self, request, pk):
        row = MaintenanceAttachment.objects.filter(id=pk).first()
        if row is None:
            raise Http404()
        response = FileResponse(row.file.open("rb"), content_type=row.content_type or "application/octet-stream")
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        response["Content-Disposition"] = f'inline; filename="{row.original_name or "attachment"}"'
        return response


# ============================================================================ board + reports
class BoardView(APIView):
    permission_classes = [IsAuthenticated, MaintenanceAccess]

    def get(self, request):
        board = MaintenanceService.board(plant_id=request.query_params.get("plant_id"), machine_id=request.query_params.get("machine_id"))
        return Response({
            "today": board["today"],
            "counts": board["counts"],
            "due_today": MaintenanceJobSerializer(board["due_today"], many=True).data,
            "overdue": MaintenanceJobSerializer(board["overdue"], many=True).data,
            "open_faults": MachineFaultSerializer(board["open_faults"], many=True).data,
            "awaiting_verification": MaintenanceJobSerializer(board["awaiting_verification"], many=True).data,
            "machines_awaiting_repair": MachineRefSerializer(board["machines_awaiting_repair"], many=True).data,
        })


class ReportsView(APIView):
    permission_classes = [IsAuthenticated, MaintenanceAccess]

    def get(self, request, report):
        plant_id = request.query_params.get("plant_id")
        machine_id = request.query_params.get("machine_id")
        if report == "compliance":
            return Response(MaintenanceService.compliance_report(plant_id=plant_id, machine_id=machine_id, months=int(request.query_params.get("months") or 3)))
        if report == "downtime":
            return Response(MaintenanceService.downtime_report(plant_id=plant_id, machine_id=machine_id, days=int(request.query_params.get("days") or 90)))
        if report == "recurring-faults":
            return Response(MaintenanceService.recurring_faults(plant_id=plant_id, machine_id=machine_id, days=int(request.query_params.get("days") or 90)))
        if report == "spares":
            return Response(MaintenanceService.spares_report(plant_id=plant_id, machine_id=machine_id, months=int(request.query_params.get("months") or 3)))
        if report == "workload":
            return Response(MaintenanceService.workload_report(plant_id=plant_id, days=int(request.query_params.get("days") or 30)))
        raise Http404()


class MachineHistoryView(APIView):
    permission_classes = [IsAuthenticated, MaintenanceAccess]

    def get(self, request, machine_id):
        machine = Machine.objects.select_related("work_center", "work_center__plant").filter(id=machine_id).first()
        if machine is None:
            raise Http404()
        return Response({"machine": MachineRefSerializer(machine).data, "events": MaintenanceService.machine_history(machine, limit=int(request.query_params.get("limit") or 200))})


# ============================================================================ scan cards + QR
def public_origin() -> str:
    origin = getattr(settings, "GATE_PUBLIC_ORIGIN", "") or os.getenv("GATE_PUBLIC_ORIGIN", "https://erp.totalpolyprint.com")
    parsed = urlparse(origin)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        origin = "https://erp.totalpolyprint.com"
    return origin.rstrip("/")


def machine_scan_url(machine: Machine) -> str:
    return f"{public_origin()}/m/{machine.code}"


def location_scan_url(location: InventoryLocation) -> str:
    return f"{public_origin()}/loc/{location.code}"


class FileNegotiation(DefaultContentNegotiation):
    def select_renderer(self, request, renderers, format_suffix=None):
        return renderers[0], renderers[0].media_type


def _qr_svg(payload: str) -> HttpResponse:
    import qrcode
    import qrcode.image.svg
    code = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H, border=4, box_size=10)
    code.add_data(payload)
    code.make(fit=True)
    response = HttpResponse(code.make_image(image_factory=qrcode.image.svg.SvgPathImage).to_string(), content_type="image/svg+xml")
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    return response


class MachineQrView(APIView):
    """SVG QR for one machine; printable from the machine master page."""
    permission_classes = [IsAuthenticated]
    content_negotiation_class = FileNegotiation

    def get(self, request, machine_id):
        machine = Machine.objects.filter(id=machine_id).first()
        if machine is None:
            raise Http404()
        return _qr_svg(machine_scan_url(machine))


class LocationQrView(APIView):
    permission_classes = [IsAuthenticated]
    content_negotiation_class = FileNegotiation

    def get(self, request, location_id):
        location = InventoryLocation.objects.filter(id=location_id).first()
        if location is None:
            raise Http404()
        return _qr_svg(location_scan_url(location))


class QrTargetsView(APIView):
    """Machines and locations with their scan URLs, for the printable sheets."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        plant_id = request.query_params.get("plant_id")
        machines = Machine.objects.select_related("work_center", "work_center__plant").order_by("work_center__plant__code", "code")
        locations = InventoryLocation.objects.select_related("plant").filter(is_active=True).order_by("plant__code", "code")
        if plant_id:
            machines = machines.filter(work_center__plant_id=plant_id)
            locations = locations.filter(plant_id=plant_id)
        return Response({
            "origin": public_origin(),
            "machines": [
                {"id": str(m.id), "code": m.code, "name": m.name, "work_center": m.work_center.name, "plant": m.work_center.plant.name,
                 "url": machine_scan_url(m), "svg_url": f"/api/maintenance/qr/machine/{m.id}.svg"}
                for m in machines
            ],
            "locations": [
                {"id": str(l.id), "code": l.code, "name": l.name, "type": l.type, "plant": l.plant.name,
                 "url": location_scan_url(l), "svg_url": f"/api/maintenance/qr/location/{l.id}.svg"}
                for l in locations
            ],
        })


class MachineScanView(APIView):
    """
    What a phone shows after scanning a machine QR. One payload; the page
    chooses the panels for the viewer's role. Production queue and live
    progress come from the existing machine endpoints.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, code):
        from apps.production.models import DowntimeLog, ProductionJob
        machine = Machine.objects.select_related("work_center", "work_center__plant", "assigned_operator").filter(code__iexact=code).first()
        if machine is None:
            machine = Machine.objects.select_related("work_center", "work_center__plant", "assigned_operator").filter(id=code).first() if _is_uuid(code) else None
        if machine is None:
            raise Http404("No machine with this code.")
        user = request.user
        role = effective_role(user)
        granted = granted_for(user)
        can_view_maint = can_with_wildcard(granted, "maintenance.view")
        today = timezone.localdate()
        running = list(ProductionJob.objects.filter(machine=machine, job_state__in=["EXECUTING", "PAUSED"]).select_related("sales_order_item__sales_order").order_by("start_date")[:5])
        queued = ProductionJob.objects.filter(machine=machine).exclude(job_state__in=["EXECUTING", "PAUSED", "COMPLETED", "CANCELLED"]).count()
        since = timezone.now() - timezone.timedelta(days=30)
        downtime = DowntimeLog.objects.filter(production_job__machine=machine, start_time__gte=since)
        breakdown_hours = Decimal("0")
        all_hours = Decimal("0")
        breakdowns = 0
        now = timezone.now()
        for log in downtime.only("start_time", "end_time", "reason"):
            hours = Decimal(((log.end_time or now) - log.start_time).total_seconds()) / Decimal(3600)
            all_hours += hours
            if log.reason == "BREAKDOWN":
                breakdowns += 1
                breakdown_hours += hours
        run_hours_30d = MaintenanceService.machine_run_hours(machine, since=since)
        payload = {
            "machine": {**MachineRefSerializer(machine).data, "concurrency_policy": machine.concurrency_policy,
                        "assigned_operator": (machine.assigned_operator.get_full_name() or machine.assigned_operator.username) if machine.assigned_operator_id else ""},
            "viewer": {"role": role, "can_log_checks": can_with_wildcard(granted, "maintenance.log"), "can_work": can_with_wildcard(granted, "maintenance.work"),
                       "can_manage": can_with_wildcard(granted, "maintenance.manage"), "can_view_maintenance": can_view_maint,
                       "can_run_production": can_with_wildcard(granted, "production.manage"), "can_view_production": can_with_wildcard(granted, "production.view")},
            "production": {
                "running": [
                    {"id": str(j.id), "job_number": j.job_number, "job_state": j.job_state, "status": j.status,
                     "order_number": getattr(getattr(j.sales_order_item, "sales_order", None), "order_number", "") if j.sales_order_item_id else "",
                     "customer": getattr(getattr(j.sales_order_item, "sales_order", None), "customer_name", "") if j.sales_order_item_id else "",
                     "quantity": float(j.quantity or 0), "uom": j.uom, "produced_qty": float(j.produced_qty or 0), "remaining_qty": float(j.remaining_qty or 0),
                     "started_at": j.start_date.isoformat() if j.start_date else None, "hold_reason": j.hold_reason or ""}
                    for j in running
                ],
                "queued_count": queued,
            },
            "report_30d": {"run_hours": float(run_hours_30d), "downtime_hours": float(all_hours.quantize(Decimal("0.01"))), "breakdowns": breakdowns,
                           "breakdown_hours": float(breakdown_hours.quantize(Decimal("0.01")))},
        }
        if can_view_maint:
            open_jobs = MaintenanceJob.objects.filter(machine=machine, status__in=MaintenanceJob.OPEN_STATUSES).select_related("assigned_to", "schedule").order_by("planned_date")
            payload["maintenance"] = {
                "checks_today": MaintenanceJobSerializer([j for j in open_jobs if j.kind == "OPERATOR_CHECK" and j.planned_date <= today], many=True).data,
                "open_jobs": MaintenanceJobSerializer([j for j in open_jobs if j.kind != "OPERATOR_CHECK"], many=True).data,
                "overdue_count": sum(1 for j in open_jobs if j.planned_date < today),
                "open_faults": MachineFaultSerializer(MachineFault.objects.filter(machine=machine, status__in=["OPEN", "ASSIGNED", "IN_REPAIR"]).select_related("assigned_to", "reported_by")[:50], many=True).data,
                "schedules": MaintenanceScheduleSerializer(MaintenanceSchedule.objects.filter(machine=machine, is_active=True).select_related("responsible_user"), many=True).data,
                "awaiting_verification": MaintenanceJobSerializer(MaintenanceJob.objects.filter(machine=machine, status="AWAITING_VERIFICATION").select_related("completed_by")[:50], many=True).data,
                "recent": MaintenanceService.machine_history(machine, limit=20),
            }
        return Response(payload)


def _is_uuid(value: str) -> bool:
    import uuid
    try:
        uuid.UUID(str(value))
        return True
    except (ValueError, TypeError, AttributeError):
        return False


class LocationScanView(APIView):
    """
    What a phone shows after scanning a location QR: what the system says is
    there (rolls, bulk, packed units), so the store can count against it and
    post the differences through stock adjustments; owners see the totals.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, code):
        from apps.inventory.models import InventoryBulk, InventoryRoll
        from apps.production.models import PackingUnit
        location = InventoryLocation.objects.select_related("plant").filter(code__iexact=code, is_active=True).first()
        if location is None:
            location = InventoryLocation.objects.select_related("plant").filter(id=code).first() if _is_uuid(code) else None
        if location is None:
            raise Http404("No location with this code.")
        user = request.user
        granted = granted_for(user)
        if not can_with_wildcard(granted, "inventory.view"):
            raise PermissionDenied("Missing permission: inventory.view")
        rolls = InventoryRoll.objects.filter(location=location, status__in=["AVAILABLE", "RESERVED", "IN_PROCESS"]).select_related("material").order_by("material__code", "roll_number")
        roll_groups: dict[str, dict] = {}
        roll_rows = []
        for roll in rolls[:1000]:
            mat = roll.material
            key = str(roll.material_id) if roll.material_id else "none"
            group = roll_groups.setdefault(key, {"material_id": key, "material_code": getattr(mat, "code", "") or "", "material_name": getattr(mat, "name", "") or "", "rolls": 0, "weight_kg": 0.0, "reserved": 0})
            group["rolls"] += 1
            group["weight_kg"] = round(group["weight_kg"] + float(roll.weight_kg or 0), 3)
            if roll.status != "AVAILABLE":
                group["reserved"] += 1
            if len(roll_rows) < 400:
                roll_rows.append({"id": str(roll.id), "roll_number": roll.roll_number, "material_code": getattr(mat, "code", "") or "", "width_mm": float(roll.width_mm or 0), "weight_kg": float(roll.weight_kg or 0), "status": roll.status, "batch_no": roll.batch_no})
        bulk_rows = []
        for row in InventoryBulk.objects.filter(location=location, qty_kg__gt=0).select_related("material", "granule_code").order_by("material__code"):
            bulk_rows.append({"id": str(row.id), "material_id": str(row.material_id), "material_code": row.material.code, "material_name": row.material.name,
                              "category": row.material.category, "granule_code": row.granule_code.code if row.granule_code_id else "",
                              "qty": float(row.qty_kg or 0), "uom": str(getattr(row.material, "base_uom", "KG") or "KG").upper()})
        packed = PackingUnit.objects.filter(location=location).exclude(status__in=["DISPATCHED", "CANCELLED"]).aggregate(units=Count("id"), pcs=Sum("qty_pcs"), kg=Sum("weight_kg"))
        return Response({
            "location": {"id": str(location.id), "code": location.code, "name": location.name, "type": location.type, "plant_id": str(location.plant_id), "plant_name": location.plant.name, "plant_code": location.plant.code},
            "viewer": {"role": effective_role(user), "can_count": can_with_wildcard(granted, "inventory.adjust"), "can_view": True},
            "totals": {"roll_count": rolls.count(), "roll_kg": round(sum(g["weight_kg"] for g in roll_groups.values()), 3), "bulk_lines": len(bulk_rows),
                       "bulk_kg": round(sum(r["qty"] for r in bulk_rows if r["uom"] == "KG"), 3), "packed_units": int(packed["units"] or 0), "packed_pcs": int(packed["pcs"] or 0), "packed_kg": float(packed["kg"] or 0)},
            "roll_groups": sorted(roll_groups.values(), key=lambda g: g["material_code"]),
            "rolls": roll_rows,
            "bulk": bulk_rows,
            "adjustment_reason": "COUNT_CORRECTION",
        })
