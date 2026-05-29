"""
Reason-code admin (scrap / downtime) + read-only stalled-jobs surface.

Endpoints (all under /api/production/):
  - scrap-reasons/      CRUD  (GET gated production.view, writes production.manage)
  - downtime-reasons/   CRUD
  - stalled-jobs/       read-only list, ?work_center=&plant=
"""

from rest_framework import viewsets, status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import ScrapReason, DowntimeReason
from .serializers import ScrapReasonSerializer, DowntimeReasonSerializer
from .services.stalled_jobs import get_stalled_jobs


class _ReasonCodeViewSet(viewsets.ModelViewSet):
    """
    Shared CRUD behaviour for scrap + downtime reason taxonomies.

    Inactive rows are hidden by default; pass ?include_inactive=1 to show them
    (the admin page does this). Sort is by (sort_order, code).
    """

    def get_queryset(self):
        qs = self.queryset
        include_inactive = str(self.request.query_params.get("include_inactive") or "").lower()
        if include_inactive not in ("1", "true", "yes"):
            qs = qs.filter(is_active=True)
        return qs.order_by("sort_order", "code")

    def perform_destroy(self, instance):
        # Soft semantics: hard-delete leaf codes, but a parent with children is
        # deactivated instead so existing log references / sub-codes survive.
        if instance.children.exists():
            instance.is_active = False
            instance.save(update_fields=["is_active", "updated_at"])
        else:
            instance.delete()


class ScrapReasonViewSet(_ReasonCodeViewSet):
    queryset = ScrapReason.objects.all()
    serializer_class = ScrapReasonSerializer


class DowntimeReasonViewSet(_ReasonCodeViewSet):
    queryset = DowntimeReason.objects.all()
    serializer_class = DowntimeReasonSerializer


@api_view(["GET"])
def stalled_jobs(request):
    """
    Read-only list of stalled (EXECUTING but idle) jobs.

    Optional query params:
      - work_center: UUID, scope to one work center
      - plant:       UUID, scope to one plant
    """
    work_center = (request.query_params.get("work_center") or "").strip() or None
    plant = (request.query_params.get("plant") or "").strip() or None
    rows = get_stalled_jobs(work_center=work_center, plant=plant)
    return Response(rows, status=status.HTTP_200_OK)
