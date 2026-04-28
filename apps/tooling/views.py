from rest_framework import viewsets
from rest_framework.response import Response
from .models import Cylinder, CylinderSlotAssignment, ToolAsset
from .serializers import CylinderSerializer, CylinderSlotAssignmentSerializer, ToolAssetSerializer
from .services import CylinderService

class CylinderViewSet(viewsets.ModelViewSet):
    queryset = Cylinder.objects.select_related("artwork", "engraving_vendor", "storage_location").prefetch_related("artwork__images").order_by('-created_at')
    serializer_class = CylinderSerializer
    search_fields = ['code', 'name', 'artwork__name', 'engraving_vendor__name']
    filterset_fields = ['status', 'engraving_vendor', 'artwork', 'side', 'is_draft', 'lifecycle_status']

    def perform_create(self, serializer):
        cylinder = serializer.save()
        CylinderService.sync_direct_assignment(cylinder)

    def perform_update(self, serializer):
        cylinder = serializer.save()
        CylinderService.sync_direct_assignment(cylinder)


class CylinderSlotAssignmentViewSet(viewsets.ModelViewSet):
    queryset = CylinderSlotAssignment.objects.select_related("artwork", "cylinder", "cylinder__artwork").order_by(
        "artwork__design_code", "side", "side_slot_index"
    )
    serializer_class = CylinderSlotAssignmentSerializer
    filterset_fields = ["artwork", "cylinder", "side"]

    def create(self, request, *args, **kwargs):
        artwork_id = request.data.get("artwork")
        cylinder_id = request.data.get("cylinder")
        side = request.data.get("side")
        slot = request.data.get("side_slot_index") or request.data.get("slot")
        try:
            assignment = CylinderService.assign_existing_to_slot(
                artwork_id=artwork_id,
                cylinder_id=cylinder_id,
                side=side,
                slot=slot,
            )
        except Exception as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response(self.get_serializer(assignment).data, status=201)

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        artwork_id = request.data.get("artwork") or instance.artwork_id
        cylinder_id = request.data.get("cylinder") or instance.cylinder_id
        side = request.data.get("side") or instance.side
        slot = request.data.get("side_slot_index") or request.data.get("slot") or instance.side_slot_index
        try:
            assignment = CylinderService.assign_existing_to_slot(
                artwork_id=artwork_id,
                cylinder_id=cylinder_id,
                side=side,
                slot=slot,
            )
        except Exception as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response(self.get_serializer(assignment).data)


class ToolAssetViewSet(viewsets.ModelViewSet):
    queryset = ToolAsset.objects.select_related("plant", "vendor", "storage_location").order_by("plant__name", "asset_type", "code")
    serializer_class = ToolAssetSerializer
    search_fields = ["code", "name", "vendor__name", "rack_code", "slot_code"]
    filterset_fields = ["plant", "asset_type", "status", "vendor", "storage_location"]
