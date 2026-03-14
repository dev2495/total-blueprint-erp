from rest_framework import viewsets
from .models import InventoryMaterial
from .serializers import AdhesiveSolventSerializer

class AdhesiveViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = InventoryMaterial.objects.filter(category='ADHESIVE').order_by('name')
    serializer_class = AdhesiveSolventSerializer

class SolventViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = InventoryMaterial.objects.filter(category='SOLVENT').order_by('name')
    serializer_class = AdhesiveSolventSerializer
