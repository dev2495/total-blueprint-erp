from rest_framework import viewsets
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db.models.deletion import ProtectedError
from apps.users.audit_mixins import MasterDataAuditMixin
from apps.users.permission_service import PermissionService
from .models import RoutingRule
from .serializers import RoutingRuleSerializer


def _is_admin_actor(user) -> bool:
    role_code = str(getattr(getattr(user, "role", None), "code", "") or "").upper()
    return bool(getattr(user, "is_authenticated", False) and (getattr(user, "is_superuser", False) or getattr(user, "is_owner", False) or role_code in {"ADMIN", "SUPER_ADMIN", "OWNER"}))


def _can_manage_route(user) -> bool:
    if not getattr(user, "is_authenticated", False):
        return False
    if _is_admin_actor(user):
        return True
    permissions = set(PermissionService.get_user_permissions(user))
    return bool({"*", "routing.manage", "templates.manage"} & permissions)


class RoutingRuleViewSet(MasterDataAuditMixin, viewsets.ModelViewSet):
    audit_area = "ROUTING_RULE"
    queryset = RoutingRule.objects.all()
    serializer_class = RoutingRuleSerializer

    def get_queryset(self):
        qs = super().get_queryset().order_by("name")
        include_inactive = str(self.request.query_params.get("include_inactive") or "").lower() in {"1", "true", "yes"}
        if not include_inactive and getattr(self, "action", None) == "list":
            qs = qs.filter(is_active=True)
        return qs

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        incoming = request.data.get("ordered_processes", None)
        if incoming is not None and [str(v) for v in incoming] != [str(v) for v in (instance.ordered_processes or [])]:
            from apps.templates.models import TemplateBlueprint

            active_template_refs = (
                TemplateBlueprint.objects.filter(routing_rule=instance, is_current_version=True)
                .exclude(status="OBSOLETE")
                .order_by("name")
            )
            if active_template_refs.exists():
                return Response(
                    {
                        "error": "Routing sequence is locked by current templates.",
                        "detail": (
                            "Disable the old route/template and create a corrected route/template version. "
                            f"Current linked templates: {', '.join(active_template_refs.values_list('name', flat=True)[:5])}."
                        ),
                    },
                    status=status.HTTP_409_CONFLICT,
                )
        return super().update(request, *args, **kwargs)

    @action(detail=True, methods=["post"], url_path="disable")
    def disable(self, request, pk=None):
        if not _can_manage_route(request.user):
            return Response({"detail": "Routing or template manage permission is required to disable routes."}, status=status.HTTP_403_FORBIDDEN)
        route = self.get_object()
        was_active = bool(route.is_active)
        route.is_active = False
        route.save(update_fields=["is_active"])
        self._audit_master_change(
            "DISABLE",
            route,
            extra_details={
                "before_is_active": was_active,
                "after_is_active": route.is_active,
                "ordered_processes": route.ordered_processes,
            },
        )
        return Response(RoutingRuleSerializer(route).data)

    def destroy(self, request, *args, **kwargs):
        if not _can_manage_route(request.user):
            return Response({"detail": "Routing or template manage permission is required to delete routing rules."}, status=status.HTTP_403_FORBIDDEN)
        instance = self.get_object()
        from apps.templates.models import TemplateBlueprint

        active_template_refs = TemplateBlueprint.objects.filter(routing_rule=instance, is_current_version=True).exclude(status="OBSOLETE").order_by("name")
        if active_template_refs.exists():
            return Response(
                {
                    "error": "Routing rule is still used by active templates.",
                    "detail": f"Disable linked templates or create a corrected route first: {', '.join(active_template_refs.values_list('name', flat=True)[:5])}.",
                },
                status=status.HTTP_409_CONFLICT,
            )
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
