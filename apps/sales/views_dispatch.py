"""CustomerDispatch viewset — Sprint 2 lifecycle closure.

Endpoints:
    GET    /api/sales/customer-dispatches/                 — list (filter by sales_order)
    POST   /api/sales/customer-dispatches/                 — create DRAFT dispatch + lines
    GET    /api/sales/customer-dispatches/{id}/            — detail
    PATCH  /api/sales/customer-dispatches/{id}/            — edit DRAFT
    POST   /api/sales/customer-dispatches/{id}/confirm/    — DRAFT -> CONFIRMED, then try_complete SO
    POST   /api/sales/customer-dispatches/{id}/cancel/     — DRAFT|CONFIRMED -> CANCELLED
"""

from __future__ import annotations

import logging
from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.factory.models import Plant
from apps.sales.models import Customer, SalesOrder, SalesOrderItem
from apps.sales.models_dispatch import CustomerDispatch, CustomerDispatchLine
from apps.sales.services.order_service import SalesOrderService

logger = logging.getLogger(__name__)


class CustomerDispatchLineSerializer(serializers.ModelSerializer):
    sales_order_item_label = serializers.SerializerMethodField()

    class Meta:
        model = CustomerDispatchLine
        fields = [
            "id",
            "sales_order_item",
            "sales_order_item_label",
            "qty_dispatched",
            "uom",
            "notes",
        ]

    def get_sales_order_item_label(self, obj):
        item = obj.sales_order_item
        try:
            return getattr(item.template, "name", "") or str(item.id)
        except Exception:
            return str(item.id)


class CustomerDispatchSerializer(serializers.ModelSerializer):
    lines = CustomerDispatchLineSerializer(many=True, required=False)
    sales_order_number = serializers.SerializerMethodField()
    customer_name = serializers.SerializerMethodField()
    plant_name = serializers.SerializerMethodField()

    class Meta:
        model = CustomerDispatch
        fields = [
            "id",
            "code",
            "sales_order",
            "sales_order_number",
            "plant",
            "plant_name",
            "customer",
            "customer_name",
            "dispatch_date",
            "status",
            "vehicle_no",
            "driver_name",
            "lr_no",
            "invoice_no",
            "notes",
            "created_at",
            "confirmed_at",
            "dispatched_at",
            "cancelled_at",
            "lines",
        ]
        read_only_fields = [
            "id",
            "code",
            "created_at",
            "confirmed_at",
            "dispatched_at",
            "cancelled_at",
        ]

    def validate(self, attrs):
        sales_order = attrs.get("sales_order") or getattr(self.instance, "sales_order", None)
        lines = attrs.get("lines")
        if sales_order and lines is not None:
            for line in lines:
                item = line.get("sales_order_item")
                if not item:
                    raise serializers.ValidationError({"lines": "Each dispatch line requires a sales order item."})
                if str(item.sales_order_id) != str(sales_order.id):
                    raise serializers.ValidationError({"lines": "Dispatch lines must belong to the selected sales order."})
                line_status = str(getattr(item, "line_status", "") or "").upper()
                parent_status = str(getattr(sales_order, "status", "") or "").upper()
                if line_status not in {"PACKING_READY", "DISPATCH_READY", "COMPLETED"} and parent_status not in {"PACKING_READY", "DISPATCH_READY"}:
                    raise serializers.ValidationError(
                        {"lines": f"{self.get_sales_order_item_label_for_item(item)} is not ready for dispatch. Resolve it in Planner first."}
                    )
                qty = Decimal(str(line.get("qty_dispatched") or 0))
                if qty <= 0:
                    raise serializers.ValidationError({"lines": "Dispatch quantity must be greater than zero."})
                if qty > (item.qty_open + Decimal("0.001")):
                    raise serializers.ValidationError(
                        {"lines": f"{self.get_sales_order_item_label_for_item(item)} exceeds open quantity {item.qty_open}."}
                    )
        return attrs

    def get_sales_order_item_label_for_item(self, item):
        try:
            return str(getattr(item, "line_name", "") or getattr(item.template, "name", "") or item.id)
        except Exception:
            return str(getattr(item, "id", "") or "")

    def get_sales_order_number(self, obj):
        return getattr(obj.sales_order, "order_number", "") if obj.sales_order_id else ""

    def get_customer_name(self, obj):
        if obj.customer_id and obj.customer:
            return obj.customer.name
        if obj.sales_order_id and obj.sales_order:
            return obj.sales_order.customer_name
        return ""

    def get_plant_name(self, obj):
        return getattr(obj.plant, "name", "") if obj.plant_id else ""

    def create(self, validated_data):
        lines = validated_data.pop("lines", []) or []
        request = self.context.get("request")
        user = getattr(request, "user", None) if request else None
        with transaction.atomic():
            dispatch = CustomerDispatch.objects.create(
                created_by=user if (user and getattr(user, "is_authenticated", False)) else None,
                **validated_data,
            )
            for ln in lines:
                CustomerDispatchLine.objects.create(dispatch=dispatch, **ln)
        return dispatch

    def update(self, instance, validated_data):
        lines = validated_data.pop("lines", None)
        for k, v in validated_data.items():
            setattr(instance, k, v)
        instance.save()
        if lines is not None:
            instance.lines.all().delete()
            for ln in lines:
                CustomerDispatchLine.objects.create(dispatch=instance, **ln)
        return instance


class CustomerDispatchViewSet(viewsets.ModelViewSet):
    queryset = (
        CustomerDispatch.objects.all()
        .select_related("sales_order", "plant", "customer")
        .prefetch_related("lines", "lines__sales_order_item", "lines__sales_order_item__template")
        .order_by("-dispatch_date", "-created_at")
    )
    serializer_class = CustomerDispatchSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        so = params.get("sales_order") or params.get("sales_order_id")
        if so:
            qs = qs.filter(sales_order_id=so)
        st = params.get("status")
        if st:
            qs = qs.filter(status=st)
        return qs

    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        with transaction.atomic():
            dispatch = CustomerDispatch.objects.select_for_update().get(pk=pk)
            if dispatch.status != "DRAFT":
                return Response(
                    {"detail": f"Cannot confirm a dispatch in status {dispatch.status}."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            lines = list(dispatch.lines.select_related("sales_order_item").all())
            if not lines:
                return Response(
                    {"detail": "Cannot confirm a dispatch with no lines."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            # Validate each line does not exceed remaining open qty.
            for ln in lines:
                item = ln.sales_order_item
                line_status = str(getattr(item, "line_status", "") or "").upper()
                parent_status = str(getattr(dispatch.sales_order, "status", "") or "").upper()
                if line_status not in {"PACKING_READY", "DISPATCH_READY", "COMPLETED"} and parent_status not in {"PACKING_READY", "DISPATCH_READY"}:
                    return Response(
                        {"detail": f"Line is not ready for dispatch: {getattr(item, 'line_name', '') or item.id}."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                open_qty = item.qty_open  # property
                if Decimal(str(ln.qty_dispatched or 0)) > (open_qty + Decimal("0.001")):
                    return Response(
                        {"detail": f"Line exceeds open qty: requested {ln.qty_dispatched}, open {open_qty}."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
            dispatch.status = "CONFIRMED"
            dispatch.confirmed_at = timezone.now()
            dispatch.save(update_fields=["status", "confirmed_at", "updated_at"])
            for ln in lines:
                item = ln.sales_order_item
                if str(item.line_status or "").upper() in {"CANCELLED", "SHORT_CLOSED"}:
                    continue
                item.refresh_from_db()
                item.line_status = "COMPLETED" if item.qty_open <= Decimal("0.001") else "DISPATCH_READY"
                item.save(update_fields=["line_status"])
            SalesOrderService.sync_order_status_from_lines(dispatch.sales_order)
            sales_order_id = dispatch.sales_order_id
        # Outside the with-block but inside the request — try to complete the SO.
        try:
            SalesOrderService.try_complete(sales_order_id)
        except Exception as exc:
            logger.warning(
                "try_complete failed after dispatch %s: %s",
                dispatch.code,
                exc,
                exc_info=True,
            )
        dispatch.refresh_from_db()
        return Response(self.get_serializer(dispatch).data)

    @action(detail=True, methods=["post"])
    def mark_dispatched(self, request, pk=None):
        """Optional second step: CONFIRMED -> DISPATCHED (vehicle/LR captured)."""
        with transaction.atomic():
            dispatch = CustomerDispatch.objects.select_for_update().get(pk=pk)
            if dispatch.status != "CONFIRMED":
                return Response(
                    {"detail": f"Cannot mark a {dispatch.status} dispatch as DISPATCHED."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            dispatch.status = "DISPATCHED"
            dispatch.dispatched_at = timezone.now()
            dispatch.save(update_fields=["status", "dispatched_at", "updated_at"])
        try:
            SalesOrderService.try_complete(dispatch.sales_order_id)
        except Exception as exc:
            logger.warning("try_complete failed after dispatch %s: %s", dispatch.code, exc, exc_info=True)
        dispatch.refresh_from_db()
        return Response(self.get_serializer(dispatch).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        with transaction.atomic():
            dispatch = CustomerDispatch.objects.select_for_update().get(pk=pk)
            if dispatch.status in {"DISPATCHED", "CANCELLED"}:
                return Response(
                    {"detail": f"Cannot cancel a dispatch in status {dispatch.status}."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            dispatch.status = "CANCELLED"
            dispatch.cancelled_at = timezone.now()
            dispatch.save(update_fields=["status", "cancelled_at", "updated_at"])
            for line in dispatch.lines.select_related("sales_order_item").all():
                item = line.sales_order_item
                if str(item.line_status or "").upper() in {"CANCELLED", "SHORT_CLOSED"}:
                    continue
                item.refresh_from_db()
                item.line_status = "COMPLETED" if item.qty_open <= Decimal("0.001") else "PACKING_READY"
                item.save(update_fields=["line_status"])
            SalesOrderService.sync_order_status_from_lines(dispatch.sales_order)
        return Response(self.get_serializer(dispatch).data)
