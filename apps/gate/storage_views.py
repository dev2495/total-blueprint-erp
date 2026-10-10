from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.users.permission_service import PermissionService

from .storage_monitor import storage_report
from .views import GateView


class DocumentStorageView(GateView):
    """Owner/Admin: document image storage measurement and projection."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not PermissionService.is_gate_master(request.user):
            raise PermissionDenied("Only an owner or administrator can view storage capacity.")
        return Response(storage_report())
