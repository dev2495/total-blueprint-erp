"""Our papers coming back in at the gate (see arrival_services).

GET  arrivals/?plant=           today's own arrivals (watchman) or the factory's arrivals (store)
GET  arrivals/preview/?plant=&code=   what a scanned QR is, before saving
POST arrivals/  {plant, code | kind+object_id, vehicle_number, notes, client_token}
"""
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .arrival_services import arrivals_for, preview_arrival, record_arrival
from .views import GateView, uuid_param


class ArrivalView(GateView):
    # The services check gate assignment (watchman) or document rights (store) per factory.
    permission_classes = [IsAuthenticated]


class ArrivalListView(ArrivalView):
    def get(self, request):
        plant = uuid_param(request, "plant")
        return Response({"results": arrivals_for(request.user, plant_id=plant, limit=request.query_params.get("limit") or 50)})

    def post(self, request):
        return Response(record_arrival(request.user, dict(request.data)), status=201)


class ArrivalPreviewView(ArrivalView):
    def get(self, request):
        return Response(preview_arrival(request.user, {
            "plant": uuid_param(request, "plant", required=True),
            "code": request.query_params.get("code"),
            "kind": request.query_params.get("kind"),
            "object_id": request.query_params.get("object_id"),
        }))
