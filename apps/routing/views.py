from rest_framework import viewsets
from .models import RoutingRule
from .serializers import RoutingRuleSerializer

class RoutingRuleViewSet(viewsets.ModelViewSet):
    queryset = RoutingRule.objects.all()
    serializer_class = RoutingRuleSerializer
