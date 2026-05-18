from rest_framework import viewsets
from rest_framework import status
from rest_framework.response import Response
from django.db.models.deletion import ProtectedError
from .models import RoutingRule
from .serializers import RoutingRuleSerializer


def _is_admin_actor(user) -> bool:
    role_code = str(getattr(getattr(user, "role", None), "code", "") or "").upper()
    return bool(getattr(user, "is_authenticated", False) and (getattr(user, "is_superuser", False) or getattr(user, "is_owner", False) or role_code in {"ADMIN", "SUPER_ADMIN", "OWNER"}))


class RoutingRuleViewSet(viewsets.ModelViewSet):
    queryset = RoutingRule.objects.all()
    serializer_class = RoutingRuleSerializer

    def destroy(self, request, *args, **kwargs):
        if not _is_admin_actor(request.user):
            return Response({"detail": "Only admin users can delete routing rules."}, status=status.HTTP_403_FORBIDDEN)
        instance = self.get_object()
        from apps.templates.models import TemplateBlueprint

        active_template_refs = TemplateBlueprint.objects.filter(routing_rule=instance).exclude(status="OBSOLETE").order_by("name")
        if active_template_refs.exists():
            return Response(
                {
                    "error": "Routing rule is still used by active templates.",
                    "detail": f"Disable linked templates first: {', '.join(active_template_refs.values_list('name', flat=True)[:5])}.",
                },
                status=status.HTTP_409_CONFLICT,
            )
        TemplateBlueprint.objects.filter(routing_rule=instance, status="OBSOLETE").update(routing_rule=None)
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
