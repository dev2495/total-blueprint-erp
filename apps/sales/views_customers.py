from rest_framework import viewsets

from apps.users.audit_mixins import MasterDataAuditMixin
from .models import Customer
from .serializers_masters import CustomerSerializer


class CustomerViewSet(MasterDataAuditMixin, viewsets.ModelViewSet):
    audit_area = "MASTER_CUSTOMER"
    queryset = Customer.objects.all().order_by("name")
    serializer_class = CustomerSerializer
    search_fields = ["name", "code", "contact_person", "status"]
    filterset_fields = ["status"]
