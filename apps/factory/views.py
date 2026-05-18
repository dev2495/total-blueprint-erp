from rest_framework import viewsets, serializers
from rest_framework.decorators import action
from rest_framework import status
from rest_framework.response import Response
from django.db.models.deletion import ProtectedError
from django.utils import timezone
from datetime import timedelta
from .models import Plant, Process, WorkCenter, Machine, PlantShiftDefinition, MachineShiftOverride
from .serializers import (
    PlantSerializer,
    ProcessSerializer,
    WorkCenterSerializer,
    MachineSerializer,
    PlantShiftDefinitionSerializer,
    MachineShiftOverrideSerializer,
)


def _is_admin_actor(user) -> bool:
    role_code = str(getattr(getattr(user, 'role', None), 'code', '') or '').upper()
    return bool(user.is_authenticated and (user.is_superuser or user.is_owner or role_code in {'ADMIN', 'SUPER_ADMIN', 'OWNER'}))

class PlantViewSet(viewsets.ModelViewSet):
    queryset = Plant.objects.select_related('legal_profile').all()
    serializer_class = PlantSerializer

class ProcessViewSet(viewsets.ModelViewSet):
    queryset = Process.objects.all()
    serializer_class = ProcessSerializer
    pagination_class = None

    def perform_update(self, serializer):
        if getattr(serializer.instance, "is_system", False):
            raise serializers.ValidationError({"error": "System processes cannot be modified."})
        if "roll_behavior" in serializer.validated_data:
            incoming = (serializer.validated_data.get("roll_behavior") or "").upper()
            current = (serializer.instance.roll_behavior or "").upper()
            if incoming != current:
                raise serializers.ValidationError({"roll_behavior": "roll_behavior is immutable after process creation."})
        super().perform_update(serializer)

    def destroy(self, request, *args, **kwargs):
        if not _is_admin_actor(request.user):
            return Response({"detail": "Only admin users can delete processes."}, status=status.HTTP_403_FORBIDDEN)
        instance = self.get_object()
        if getattr(instance, "is_system", False):
            return Response({"error": "System processes cannot be deleted."}, status=400)
        from apps.routing.models import RoutingRule

        route_refs = RoutingRule.objects.filter(ordered_processes__contains=[instance.code]).order_by("name")
        if route_refs.exists():
            return Response(
                {
                    "error": "Process is still used by routing rules.",
                    "detail": f"Delete or edit linked routing rules first: {', '.join(route_refs.values_list('name', flat=True)[:5])}.",
                },
                status=status.HTTP_409_CONFLICT,
            )
        active_template_steps = instance.template_steps.exclude(template__status="OBSOLETE")
        if active_template_steps.exists():
            return Response(
                {
                    "error": "Process is still used by active templates.",
                    "detail": "Disable linked templates first. Disabled templates release their process references.",
                },
                status=status.HTTP_409_CONFLICT,
            )
        instance.template_steps.filter(template__status="OBSOLETE").delete()
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            return Response(
                {
                    "error": "Process is used by existing templates or jobs and cannot be deleted.",
                    "detail": "Mark the process inactive instead, or remove the dependent template steps first.",
                },
                status=status.HTTP_409_CONFLICT,
            )

class WorkCenterViewSet(viewsets.ModelViewSet):
    queryset = WorkCenter.objects.all()
    serializer_class = WorkCenterSerializer

    @action(detail=False, methods=['get'], url_path='my-work-centers')
    def my_work_centers(self, request):
        user = request.user
        role_code = getattr(user, 'effective_role_code', user.role.code if user.role else 'GUEST')
        is_admin = role_code in ['ADMIN', 'SUPER_ADMIN', 'OWNER'] or user.is_owner or user.is_superuser

        if is_admin:
            return Response(WorkCenterSerializer(self.queryset, many=True).data)
        
        from apps.users.models import WorkCenterAssignment
        assigned_ids = WorkCenterAssignment.objects.filter(user=user).values_list('work_center_id', flat=True)
        wcs = WorkCenter.objects.filter(id__in=assigned_ids)
        return Response(WorkCenterSerializer(wcs, many=True).data)

class MachineViewSet(viewsets.ModelViewSet):
    serializer_class = MachineSerializer

    def get_queryset(self):
        queryset = Machine.objects.select_related('work_center', 'work_center__plant').order_by('work_center__code', 'code', 'name')
        work_center = self.request.query_params.get('work_center')
        if work_center:
            queryset = queryset.filter(work_center_id=work_center)
        return queryset

    def _deny_if_not_admin(self, request):
        if _is_admin_actor(request.user):
            return None
        return Response({"detail": "Forbidden"}, status=403)

    def create(self, request, *args, **kwargs):
        denied = self._deny_if_not_admin(request)
        if denied:
            return denied
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        denied = self._deny_if_not_admin(request)
        if denied:
            return denied
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        denied = self._deny_if_not_admin(request)
        if denied:
            return denied
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        denied = self._deny_if_not_admin(request)
        if denied:
            return denied
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=['get'], url_path='my-machines')
    def my_machines(self, request):
        user = request.user
        role_code = getattr(user, 'effective_role_code', user.role.code if user.role else 'GUEST')
        is_admin = role_code in ['ADMIN', 'SUPER_ADMIN', 'OWNER'] or user.is_owner or user.is_superuser

        if is_admin:
            return Response(MachineSerializer(self.queryset, many=True).data)

        from apps.users.models import WorkCenterAssignment
        assigned_wc_ids = WorkCenterAssignment.objects.filter(user=user).values_list('work_center_id', flat=True)
        machines = Machine.objects.filter(work_center_id__in=assigned_wc_ids)
        return Response(MachineSerializer(machines, many=True).data)

    @action(detail=True, methods=['post'], url_path='downtime')
    def downtime(self, request, pk=None):
        """
        Lightweight downtime logging endpoint.

        Frontend may post downtime events against a Machine. We attach the downtime
        to the latest job assigned to this machine (via WorkCenterAssignment),
        or accept an explicit `job_id`.
        """
        reason = (request.data.get("reason") or "OTHER").upper()
        duration_minutes = request.data.get("duration_minutes")
        notes = request.data.get("notes") or ""
        job_id = request.data.get("job_id")

        try:
            from apps.production.models import WorkCenterAssignment, ProductionJob, DowntimeLog
            from apps.production.services.shift_resolver import build_shift_fields_for_job

            job = None
            if job_id:
                job = ProductionJob.objects.filter(id=job_id).first()

            if not job:
                assignment = (
                    WorkCenterAssignment.objects.filter(assigned_machine_id=pk)
                    .select_related("production_job")
                    .order_by("-updated_at")
                    .first()
                )
                job = assignment.production_job if assignment else None

            if not job:
                # Keep 200 so the UI doesn't break; this endpoint is informational.
                return Response({"status": "ignored", "message": "No active job found for this machine."})

            valid_reasons = {c[0] for c in DowntimeLog.REASON_CHOICES}
            if reason not in valid_reasons:
                reason = "OTHER"

            dur = None
            if duration_minutes is not None:
                try:
                    dur = int(duration_minutes)
                except Exception:
                    dur = None

            start_time = timezone.now() - timedelta(minutes=dur) if dur else timezone.now()
            end_time = timezone.now() if dur else None

            log = DowntimeLog.objects.create(
                production_job=job,
                start_time=start_time,
                end_time=end_time,
                reason=reason,
                notes=notes,
                logged_by=request.user,
                **build_shift_fields_for_job(job, ts=start_time),
            )

            return Response({"status": "logged", "id": str(log.id), "job_id": str(job.id)})
        except Exception as e:
            return Response({"error": str(e)}, status=400)


class PlantShiftDefinitionViewSet(viewsets.ModelViewSet):
    serializer_class = PlantShiftDefinitionSerializer
    pagination_class = None

    def get_queryset(self):
        qs = PlantShiftDefinition.objects.select_related("plant").all()
        plant_id = self.request.query_params.get("plant")
        is_active = self.request.query_params.get("is_active")
        if plant_id:
            qs = qs.filter(plant_id=plant_id)
        if is_active is not None:
            flag = str(is_active).lower() in {"1", "true", "yes"}
            qs = qs.filter(is_active=flag)
        return qs


class MachineShiftOverrideViewSet(viewsets.ModelViewSet):
    serializer_class = MachineShiftOverrideSerializer
    pagination_class = None

    def get_queryset(self):
        qs = MachineShiftOverride.objects.select_related("machine", "machine__work_center").all()
        machine_id = self.request.query_params.get("machine")
        if machine_id:
            qs = qs.filter(machine_id=machine_id)
        return qs
