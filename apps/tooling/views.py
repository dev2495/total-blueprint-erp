from rest_framework import viewsets
from rest_framework.response import Response
from .models import Cylinder
from .serializers import CylinderSerializer

class CylinderViewSet(viewsets.ModelViewSet):
    queryset = Cylinder.objects.all().order_by('-created_at')
    serializer_class = CylinderSerializer
    search_fields = ['code', 'name', 'artwork__name', 'engraving_vendor__name']
    filterset_fields = ['status', 'engraving_vendor', 'artwork', 'side', 'is_draft', 'lifecycle_status']
