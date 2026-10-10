"""Outward gate documents API.

POST   outward-documents/                 watchman (assigned gate) / Owner-Admin: photos + QR codes
GET    outward-documents/                 watchman: own today; reconciler: queue with filters + counts
GET    outward-documents/<id>/            detail (watchman: own today, redacted)
GET    outward-documents/<id>/pages/<p>/  private JPEG (?w=160|320|640 thumbnail)
GET    outward-documents/<id>/candidates/ reconciler: ERP documents to match (?q=&kind=)
POST   outward-documents/<id>/(link|unlink|discrepancy|resolve|void)/
"""
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.users.permission_service import PermissionService

from .document_pages import page_image_bytes
from .models import OutwardDocumentPage
from .outward_serializers import OutwardCaptureSerializer, OutwardDiscrepancySerializer, OutwardLinkSerializer, OutwardResolveSerializer, OutwardUnlinkSerializer, OutwardVoidSerializer
from .outward_services import (
    candidates, capture_outward, get_outward, is_reconciler, link_document, list_filters, mark_discrepancy, outward_payload,
    outward_queryset, recent_vehicles, resolve_matched, unlink_document, void_document,
)
from .services import get_plant, is_watchman
from .views import FileNegotiation, GateView, paginated, private_response, uuid_param, validated

WATCHMAN_FILTERS = {"status", "date_from", "date_to", "search", "has_links"}


class OutwardView(GateView):
    permission_classes = [IsAuthenticated]


class OutwardListView(OutwardView):
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request):
        user = request.user
        source = outward_queryset(user)
        plant = uuid_param(request, "plant")
        counts = None
        if is_reconciler(user):
            source, counts = list_filters(source, request.query_params)
        else:
            if WATCHMAN_FILTERS & set(request.query_params):
                raise PermissionDenied("Outward history is available to the office matching team.")
            if plant:
                get_plant(user, plant)
                source = source.filter(plant_id=plant)
        response = paginated(source, request, lambda obj: outward_payload(obj, user))
        if counts is not None:
            response.data["counts"] = counts
            # Factory filter options for the matching team (outward-only accounts
            # hold no gate-pass / bill rights to read form options elsewhere).
            response.data["plants"] = [
                {"id": str(row.id), "name": row.name, "code": row.code}
                for row in PermissionService.document_plants(user).order_by("name")
            ]
        if plant:
            response.data["recent_vehicles"] = recent_vehicles(plant)
        return response

    def post(self, request):
        return Response(capture_outward(request.user, validated(OutwardCaptureSerializer, request.data)), status=201)


class OutwardDetailView(OutwardView):
    def get(self, request, pk):
        return Response(outward_payload(get_outward(request.user, pk), request.user, detail=not is_watchman(request.user)))


class OutwardPageView(OutwardView):
    content_negotiation_class = FileNegotiation

    def get(self, request, pk, page_id):
        document = get_outward(request.user, pk)
        page = OutwardDocumentPage.objects.filter(id=page_id, document=document).first()
        if not page:
            raise NotFound()
        return private_response(page_image_bytes(page, request), "image/jpeg")


class OutwardCandidatesView(OutwardView):
    def get(self, request, pk):
        document = get_outward(request.user, pk)
        return Response(candidates(request.user, document, request.query_params.get("q", ""), request.query_params.get("kind") or None))


class OutwardActionView(OutwardView):
    parser_classes = [JSONParser, FormParser]
    ACTIONS = {
        "link": (OutwardLinkSerializer, link_document),
        "unlink": (OutwardUnlinkSerializer, unlink_document),
        "discrepancy": (OutwardDiscrepancySerializer, mark_discrepancy),
        "resolve": (OutwardResolveSerializer, resolve_matched),
        "void": (OutwardVoidSerializer, void_document),
    }

    def post(self, request, pk, action):
        serializer, handler = self.ACTIONS[action]
        document = get_outward(request.user, pk)
        return Response(handler(request.user, document, validated(serializer, request.data)))
