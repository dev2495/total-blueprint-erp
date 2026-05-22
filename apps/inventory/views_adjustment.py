"""ViewSet for Stock Adjustments — unified audit log across all stock pools."""

from decimal import Decimal

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response

from apps.inventory.models import StockAdjustment, StockAdjustmentLine
from apps.inventory.services.adjustment import (
    StockAdjustmentService,
    _generate_adj_code,
)
from apps.users.permission_registry import can_with_wildcard
from apps.users.permission_service import PermissionService


class CanAdjustStock(BasePermission):
    """Allows access only to users with `inventory.adjust` permission."""

    message = "Permission required: inventory.adjust"

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if getattr(user, "is_superuser", False) or getattr(user, "is_owner", False):
            return True
        granted = PermissionService.get_user_permissions(user)
        return can_with_wildcard(granted, "inventory.adjust")


class StockAdjustmentLineSerializer(serializers.ModelSerializer):
    inventory_material_code = serializers.CharField(
        source="inventory_material.code", read_only=True, allow_null=True
    )
    inventory_material_name = serializers.CharField(
        source="inventory_material.name", read_only=True, allow_null=True
    )
    trading_good_code = serializers.CharField(
        source="trading_good.code", read_only=True, allow_null=True
    )
    trading_good_name = serializers.CharField(
        source="trading_good.name", read_only=True, allow_null=True
    )
    location_name = serializers.CharField(
        source="location.name", read_only=True, allow_null=True
    )
    inventory_roll_label = serializers.CharField(
        source="inventory_roll.label_id", read_only=True, allow_null=True
    )

    class Meta:
        model = StockAdjustmentLine
        fields = [
            "id",
            "line_no",
            "stock_class",
            "inventory_material",
            "inventory_material_code",
            "inventory_material_name",
            "trading_good",
            "trading_good_code",
            "trading_good_name",
            "location",
            "location_name",
            "inventory_roll",
            "inventory_roll_label",
            "before_qty",
            "delta_qty",
            "after_qty",
            "uom",
            "value_inr",
            "notes",
        ]
        read_only_fields = [
            "id",
            "before_qty",
            "after_qty",
            "value_inr",
            "inventory_material_code",
            "inventory_material_name",
            "trading_good_code",
            "trading_good_name",
            "location_name",
            "inventory_roll_label",
        ]

    def validate(self, attrs):
        stock_class = attrs.get("stock_class") or getattr(self.instance, "stock_class", None)
        delta = attrs.get("delta_qty", getattr(self.instance, "delta_qty", Decimal("0")))
        if delta is None or Decimal(str(delta)) == 0:
            raise serializers.ValidationError({"delta_qty": "Delta quantity cannot be zero."})

        material = attrs.get("inventory_material") or getattr(self.instance, "inventory_material", None)
        trading_good = attrs.get("trading_good") or getattr(self.instance, "trading_good", None)
        location = attrs.get("location") or getattr(self.instance, "location", None)
        inventory_roll = attrs.get("inventory_roll") or getattr(self.instance, "inventory_roll", None)

        if stock_class == "BULK":
            if not material or not location:
                raise serializers.ValidationError({"stock_class": "BULK adjustments require material and location."})
            if str(material.category or "").upper() not in {"GRANULE", "INK", "ADHESIVE", "SOLVENT", "ADDON", "FILM_FAMILY"}:
                raise serializers.ValidationError({"inventory_material": "Selected material is not a bulk-stock material."})
        elif stock_class == "PACKAGING":
            if not material or not location:
                raise serializers.ValidationError({"stock_class": "PACKAGING adjustments require material and location."})
            if str(material.category or "").upper() not in {"PACKAGING", "POD"}:
                raise serializers.ValidationError({"inventory_material": "Selected material is not packaging/POD stock."})
        elif stock_class == "ROLL":
            if not inventory_roll:
                raise serializers.ValidationError({"inventory_roll": "ROLL adjustments require a roll."})
        elif stock_class == "TRADING_GOOD":
            if not trading_good:
                raise serializers.ValidationError({"trading_good": "TRADING_GOOD adjustments require a trading good."})
        else:
            raise serializers.ValidationError({"stock_class": "Unknown stock class."})
        return attrs


class StockAdjustmentSerializer(serializers.ModelSerializer):
    lines = StockAdjustmentLineSerializer(many=True, required=False)
    plant_name = serializers.CharField(source="plant.name", read_only=True)
    plant_code = serializers.CharField(source="plant.code", read_only=True)
    created_by_name = serializers.CharField(
        source="created_by.username", read_only=True, allow_null=True
    )
    posted_by_name = serializers.CharField(
        source="posted_by.username", read_only=True, allow_null=True
    )

    class Meta:
        model = StockAdjustment
        fields = [
            "id",
            "code",
            "plant",
            "plant_name",
            "plant_code",
            "reason",
            "status",
            "notes",
            "lines",
            "created_at",
            "created_by",
            "created_by_name",
            "posted_at",
            "posted_by",
            "posted_by_name",
        ]
        read_only_fields = [
            "id",
            "code",
            "status",
            "created_at",
            "created_by",
            "posted_at",
            "posted_by",
            "plant_name",
            "plant_code",
            "created_by_name",
            "posted_by_name",
        ]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if self.instance is None and not attrs.get("lines"):
            raise DRFValidationError({"lines": "At least one adjustment line is required."})
        return attrs

    def create(self, validated_data):
        lines_data = validated_data.pop("lines", [])
        user = self.context["request"].user if self.context.get("request") else None
        adj = StockAdjustment.objects.create(
            code=_generate_adj_code(),
            created_by=user if (user and user.is_authenticated) else None,
            **validated_data,
        )
        for idx, line in enumerate(lines_data or [], start=1):
            StockAdjustmentLine.objects.create(
                adjustment=adj,
                line_no=line.get("line_no") or idx,
                stock_class=line.get("stock_class"),
                inventory_material=line.get("inventory_material"),
                trading_good=line.get("trading_good"),
                location=line.get("location"),
                inventory_roll=line.get("inventory_roll"),
                delta_qty=line.get("delta_qty") or Decimal("0"),
                uom=line.get("uom") or "KG",
                notes=line.get("notes") or "",
            )
        return adj

    def update(self, instance, validated_data):
        if instance.status != "DRAFT":
            raise DRFValidationError(
                f"Cannot edit adjustment in status {instance.status}"
            )
        lines_data = validated_data.pop("lines", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if lines_data is not None:
            instance.lines.all().delete()
            for idx, line in enumerate(lines_data or [], start=1):
                StockAdjustmentLine.objects.create(
                    adjustment=instance,
                    line_no=line.get("line_no") or idx,
                    stock_class=line.get("stock_class"),
                    inventory_material=line.get("inventory_material"),
                    trading_good=line.get("trading_good"),
                    location=line.get("location"),
                    inventory_roll=line.get("inventory_roll"),
                    delta_qty=line.get("delta_qty") or Decimal("0"),
                    uom=line.get("uom") or "KG",
                    notes=line.get("notes") or "",
                )
        return instance


class StockAdjustmentViewSet(viewsets.ModelViewSet):
    queryset = (
        StockAdjustment.objects.all()
        .select_related("plant", "created_by", "posted_by")
        .prefetch_related(
            "lines",
            "lines__inventory_material",
            "lines__trading_good",
            "lines__location",
            "lines__inventory_roll",
        )
        .order_by("-created_at")
    )
    serializer_class = StockAdjustmentSerializer
    permission_classes = [IsAuthenticated, CanAdjustStock]

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        st = params.get("status")
        if st:
            qs = qs.filter(status=st)
        plant = params.get("plant")
        if plant:
            qs = qs.filter(plant_id=plant)
        return qs

    @action(detail=True, methods=["post"], url_path="post")
    def post_adjustment(self, request, pk=None):
        adj = self.get_object()
        user = request.user if request.user.is_authenticated else None
        try:
            StockAdjustmentService.post(adjustment=adj, user=user)
        except DjangoValidationError as exc:
            raise DRFValidationError(getattr(exc, "messages", str(exc)))
        adj.refresh_from_db()
        return Response(self.get_serializer(adj).data)

    @action(detail=True, methods=["post"], url_path="void")
    def void_adjustment(self, request, pk=None):
        adj = self.get_object()
        user = request.user if request.user.is_authenticated else None
        try:
            StockAdjustmentService.void(adjustment=adj, user=user)
        except DjangoValidationError as exc:
            raise DRFValidationError(getattr(exc, "messages", str(exc)))
        adj.refresh_from_db()
        return Response(self.get_serializer(adj).data)

    @action(detail=True, methods=["post"], url_path="add-line")
    def add_line(self, request, pk=None):
        adj = self.get_object()
        if adj.status != "DRAFT":
            raise DRFValidationError(f"Cannot add lines to {adj.status} adjustment.")
        ser = StockAdjustmentLineSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        with transaction.atomic():
            next_no = (adj.lines.count() or 0) + 1
            line = StockAdjustmentLine.objects.create(
                adjustment=adj,
                line_no=ser.validated_data.get("line_no") or next_no,
                stock_class=ser.validated_data.get("stock_class"),
                inventory_material=ser.validated_data.get("inventory_material"),
                trading_good=ser.validated_data.get("trading_good"),
                location=ser.validated_data.get("location"),
                inventory_roll=ser.validated_data.get("inventory_roll"),
                delta_qty=ser.validated_data.get("delta_qty") or Decimal("0"),
                uom=ser.validated_data.get("uom") or "KG",
                notes=ser.validated_data.get("notes") or "",
            )
        return Response(StockAdjustmentLineSerializer(line).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["delete"], url_path=r"lines/(?P<line_id>[^/.]+)")
    def remove_line(self, request, pk=None, line_id=None):
        adj = self.get_object()
        if adj.status != "DRAFT":
            raise DRFValidationError(f"Cannot remove lines from {adj.status} adjustment.")
        StockAdjustmentLine.objects.filter(adjustment=adj, id=line_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
