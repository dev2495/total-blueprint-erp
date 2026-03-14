from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.platformops.models import BackupRecord, RestoreDrillRecord
from apps.platformops.serializers import BackupRecordSerializer, RestoreDrillRecordSerializer
from apps.platformops.services.backup_service import BackupService
from apps.platformops.services.metrics_service import OpsMetricsService


def _is_ops_admin(user) -> bool:
    if not user or not user.is_authenticated:
        return False
    role_code = str(getattr(getattr(user, "role", None), "code", "") or "").upper()
    return bool(user.is_superuser or user.is_owner or role_code in {"ADMIN", "SUPER_ADMIN", "OWNER"})


class OpsViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=["get"], url_path="metrics/summary")
    def summary(self, request):
        if not _is_ops_admin(request.user):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)
        return Response(OpsMetricsService.summary())

    @action(detail=False, methods=["get"], url_path="backups")
    def backups(self, request):
        if not _is_ops_admin(request.user):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)
        qs = BackupRecord.objects.all()[:100]
        return Response(BackupRecordSerializer(qs, many=True).data)

    @action(detail=False, methods=["post"], url_path="backups/run-now")
    def run_backup_now(self, request):
        if not _is_ops_admin(request.user):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)
        from apps.platformops.tasks import run_db_backup_task

        task = run_db_backup_task.delay(created_by_id=str(request.user.id))
        return Response({"status": "queued", "task_id": task.id}, status=status.HTTP_202_ACCEPTED)

    @action(detail=False, methods=["post"], url_path="backups/prune")
    def prune_backups(self, request):
        if not _is_ops_admin(request.user):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)

        retention_days = int(request.data.get("retention_days") or 30)
        result = BackupService.prune_backup_retention(retention_days=retention_days)
        return Response(result)

    @action(detail=False, methods=["get"], url_path="restore-drills")
    def restore_drills(self, request):
        if not _is_ops_admin(request.user):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)
        qs = RestoreDrillRecord.objects.all()[:50]
        return Response(RestoreDrillRecordSerializer(qs, many=True).data)

    @action(detail=False, methods=["post"], url_path="restore-drills/run-now")
    def run_restore_drill_now(self, request):
        if not _is_ops_admin(request.user):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)

        from apps.platformops.tasks import run_restore_drill_task

        task = run_restore_drill_task.delay()
        return Response({"status": "queued", "task_id": task.id}, status=status.HTTP_202_ACCEPTED)
