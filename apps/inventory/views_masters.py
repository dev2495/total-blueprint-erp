from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Vendor
from .serializers_masters import VendorSerializer

class VendorViewSet(viewsets.ModelViewSet):
    queryset = Vendor.objects.all().order_by('name')
    serializer_class = VendorSerializer
    search_fields = ['name', 'code', 'type', 'status']
    filterset_fields = ['status', 'type']
