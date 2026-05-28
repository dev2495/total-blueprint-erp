"""Reorder policy endpoints — Sprint 3 inventory governance.

Lists every InventoryMaterial with its reorder fields + a current-stock roll-up,
and supports inline PATCH for reorder_qty / safety_stock / lead_time_override_days.
"""

from __future__ import annotations

from decimal import Decimal

from django.db.models import Sum
from rest_framework import permissions, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.materials.models import InventoryMaterial
from apps.users.permission_registry import can_with_wildcard
from apps.users.permission_service import PermissionService


class _ReorderPolicyPermission(permissions.BasePermission):
    """OWNER / ADMIN / STORE only — backend defence in depth alongside sidebar gate."""

    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return False
        if getattr(user, "is_superuser", False) or getattr(user, "is_owner", False):
            return True
        granted = PermissionService.get_user_permissions(user)
        need = "inventory.view" if request.method in permissions.SAFE_METHODS else "inventory.manage"
        return can_with_wildcard(granted, need)


class ReorderPolicySerializer(serializers.ModelSerializer):
    category_label = serializers.SerializerMethodField()
    current_stock = serializers.SerializerMethodField()
    last_alert_at = serializers.SerializerMethodField()

    class Meta:
        model = InventoryMaterial
        fields = [
            "id",
            "code",
            "name",
            "category",
            "category_label",
            "base_uom",
            "status",
            "reorder_qty",
            "safety_stock",
            "lead_time_override_days",
            "current_stock",
            "last_alert_at",
        ]
        read_only_fields = ["id", "code", "category", "category_label", "base_uom", "status"]

    def get_category_label(self, obj):
        return obj.get_category_display()

    def get_current_stock(self, obj):
        # On-hand = available bulk + available rolls (KG). Lazy import to keep
        # the materials app independent of inventory module load order.
        try:
            from apps.inventory.models import InventoryBulk, InventoryRoll
        except Exception:
            return 0
        bulk = InventoryBulk.objects.filter(material=obj).aggregate(t=Sum("qty_kg"))["t"] or Decimal("0")
        rolls = (
            InventoryRoll.objects.filter(material=obj, status="AVAILABLE").aggregate(
                t=Sum("weight_kg")
            )["t"]
            or Decimal("0")
        )
        return float(bulk + rolls)

    def get_last_alert_at(self, obj):
        try:
            from apps.inventory.models import InventoryAlert
        except Exception:
            return None
        last = (
            InventoryAlert.objects.filter(material=obj, type="LOW_STOCK")
            .order_by("-created_at")
            .values_list("created_at", flat=True)
            .first()
        )
        return last.isoformat() if last else None


class ReorderPolicyViewSet(viewsets.ModelViewSet):
    """List / patch reorder policy on InventoryMaterial.

    GET /api/materials/reorder-policy/?category=GRANULE
    PATCH /api/materials/reorder-policy/{id}/ { reorder_qty, safety_stock, lead_time_override_days }
    POST /api/materials/reorder-policy/run-scan/ — manually trigger the scan
    """

    queryset = InventoryMaterial.objects.filter(status="ACTIVE").order_by("category", "code")
    serializer_class = ReorderPolicySerializer
    permission_classes = [_ReorderPolicyPermission]
    http_method_names = ["get", "patch", "head", "options", "post"]

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        cat = params.get("category")
        if cat:
            cats = [c.strip().upper() for c in cat.split(",") if c.strip()]
            qs = qs.filter(category__in=cats)
        search = params.get("search")
        if search:
            from django.db.models import Q
            qs = qs.filter(Q(code__icontains=search) | Q(name__icontains=search))
        no_policy = params.get("no_policy")
        if no_policy in {"1", "true", "yes"}:
            qs = qs.filter(reorder_qty__isnull=True)
        return qs

    @action(detail=False, methods=["post"], url_path="run-scan")
    def run_scan(self, request):
        from apps.inventory.services.inventory_audit_service import InventoryAuditService
        result = InventoryAuditService.generate_low_stock_alerts()
        return Response(result)
