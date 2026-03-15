from rest_framework import viewsets
from rest_framework.response import Response
from .models import Cylinder, ToolAsset
from .serializers import CylinderSerializer, ToolAssetSerializer

class CylinderViewSet(viewsets.ModelViewSet):
    queryset = Cylinder.objects.select_related("artwork", "engraving_vendor", "storage_location").order_by('-created_at')
    serializer_class = CylinderSerializer
    search_fields = ['code', 'name', 'artwork__name', 'engraving_vendor__name']
    filterset_fields = ['status', 'engraving_vendor', 'artwork', 'side', 'is_draft', 'lifecycle_status']


class ToolAssetViewSet(viewsets.ModelViewSet):
    queryset = ToolAsset.objects.select_related("plant", "vendor", "storage_location").order_by("plant__name", "asset_type", "code")
    serializer_class = ToolAssetSerializer
    search_fields = ["code", "name", "vendor__name", "rack_code", "slot_code"]
    filterset_fields = ["plant", "asset_type", "status", "vendor", "storage_location"]
