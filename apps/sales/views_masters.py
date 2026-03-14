from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Customer
from .serializers_masters import CustomerSerializer

class CustomerViewSet(viewsets.ModelViewSet):
    queryset = Customer.objects.all().order_by('name')
    serializer_class = CustomerSerializer
    search_fields = ['name', 'code', 'contact_person', 'status']
    filterset_fields = ['status']
