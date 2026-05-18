from rest_framework import viewsets
from rest_framework import status
from rest_framework.response import Response
from django.db.models.deletion import ProtectedError
from .models import RoutingRule
from .serializers import RoutingRuleSerializer

class RoutingRuleViewSet(viewsets.ModelViewSet):
    queryset = RoutingRule.objects.all()
    serializer_class = RoutingRuleSerializer

    def destroy(self, request, *args, **kwargs):
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            return Response(
                {
                    "error": "Routing rule is used by existing templates or jobs and cannot be deleted.",
                    "detail": "Mark the routing rule inactive instead, or move dependent templates to another route first.",
                },
                status=status.HTTP_409_CONFLICT,
            )
