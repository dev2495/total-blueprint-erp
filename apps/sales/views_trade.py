"""ViewSets for Trading Goods + Trade Orders."""

from decimal import Decimal

from django.core.exceptions import ValidationError as DjValidationError
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.factory.models import Plant
from apps.inventory.models import StockAdjustment, StockAdjustmentLine
from apps.inventory.services.adjustment import StockAdjustmentService, _generate_adj_code
from apps.materials.models import InventoryMaterial, TradingGood, TradingGoodStock
from apps.sales.models import TradeOrder
from apps.sales.serializers_trade import (
    SellableMaterialSerializer,
    TradeOrderSerializer,
    TradingGoodSerializer,
    TradingGoodStockSerializer,
)
from apps.sales.services.trade_dispatch import (
    dispatch_trade_order,
    get_available_stock_for_inventory_material,
    get_stock_rows_for_inventory_material,
    get_trade_order_stock_shortages,
)
from apps.users.permission_registry import can_with_wildcard
from apps.users.permission_service import PermissionService


class TradingGoodViewSet(viewsets.ModelViewSet):
    queryset = TradingGood.objects.all().prefetch_related("stocks", "stocks__plant").order_by("code")
    serializer_class = TradingGoodSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        is_active = params.get("is_active")
        if is_active in {"true", "1"}:
            qs = qs.filter(is_active=True)
        elif is_active in {"false", "0"}:
            qs = qs.filter(is_active=False)
        q = params.get("search") or params.get("q")
        if q:
            from django.db.models import Q
            qs = qs.filter(Q(code__icontains=q) | Q(name__icontains=q))
        return qs

    @action(detail=True, methods=["get"], url_path="stock")
    def stock(self, request, pk=None):
        good = self.get_object()
        ser = TradingGoodStockSerializer(good.stocks.select_related("plant").all(), many=True)
        return Response(ser.data)

    @action(detail=True, methods=["post"], url_path="adjust-stock")
    def adjust_stock(self, request, pk=None):
        """Body: { plant: <uuid>, qty|delta_qty|set_qty: number, mode: 'set'|'add' (default 'add'),
        reason?: str, notes?: str, avg_cost?: number }

        Routes every adjustment through the unified StockAdjustment audit pipeline:
        creates a single-line StockAdjustment, posts it, and returns the updated TradingGood.
        """
        # Gate behind `inventory.adjust` (same as the unified adjustment viewset).
        user = request.user
        if not (getattr(user, "is_superuser", False) or getattr(user, "is_owner", False)):
            granted = PermissionService.get_user_permissions(user)
            if not can_with_wildcard(granted, "inventory.adjust"):
                return Response(
                    {"detail": "Permission required: inventory.adjust"},
                    status=status.HTTP_403_FORBIDDEN,
                )
        good = self.get_object()
        plant_id = request.data.get("plant")
        mode = (request.data.get("mode") or "add").lower()
        raw_qty = (
            request.data.get("qty")
            if request.data.get("qty") is not None
            else request.data.get("delta_qty")
            if request.data.get("delta_qty") is not None
            else request.data.get("set_qty")
        )
        reason = (request.data.get("reason") or "OTHER").upper()
        notes = request.data.get("notes") or ""
        avg_cost = request.data.get("avg_cost")

        if not plant_id:
            raise DRFValidationError({"plant": "Required."})
        if raw_qty is None:
            raise DRFValidationError({"qty": "Required."})
        try:
            qty_dec = Decimal(str(raw_qty))
        except Exception:
            raise DRFValidationError({"qty": "Invalid number."})

        plant = Plant.objects.filter(id=plant_id).first()
        if not plant:
            raise DRFValidationError({"plant": "Plant not found."})

        # Compute delta against current stock.
        if mode == "set":
            current = TradingGoodStock.objects.filter(trading_good=good, plant=plant).first()
            current_qty = (current.qty if current else Decimal("0")) or Decimal("0")
            delta = qty_dec - current_qty
        else:
            delta = qty_dec

        user = request.user if request.user.is_authenticated else None
        with transaction.atomic():
            adj = StockAdjustment.objects.create(
                code=_generate_adj_code(),
                plant=plant,
                reason=reason if reason in dict(StockAdjustment.REASON_CHOICES) else "OTHER",
                notes=notes,
                created_by=user,
            )
            StockAdjustmentLine.objects.create(
                adjustment=adj,
                line_no=1,
                stock_class="TRADING_GOOD",
                trading_good=good,
                delta_qty=delta,
                uom=good.base_uom or "PCS",
                notes=notes,
            )
            # If avg_cost passed, set it on the underlying stock row after seeding.
            if avg_cost is not None:
                stock_row, _ = TradingGoodStock.objects.get_or_create(
                    trading_good=good, plant=plant, defaults={"qty": Decimal("0")}
                )
                try:
                    stock_row.avg_cost = Decimal(str(avg_cost))
                    stock_row.save(update_fields=["avg_cost", "updated_at"])
                except Exception:
                    pass
            StockAdjustmentService.post(adjustment=adj, user=user)
        good.refresh_from_db()
        return Response(TradingGoodSerializer(good).data)


class SellableMaterialsView(APIView):
    """List InventoryMaterial rows where is_sellable=True (granules + film variants flagged)."""

    def get(self, request):
        plant = None
        plant_id = request.query_params.get("plant") or request.query_params.get("plant_id")
        if plant_id:
            plant = Plant.objects.filter(id=plant_id).first()
            if not plant:
                raise DRFValidationError({"plant": "Plant not found."})
        qs = (
            InventoryMaterial.objects.filter(is_sellable=True, status="ACTIVE")
            .select_related("parent_family")
            .order_by("category", "code")
        )
        if plant and (request.query_params.get("available_only") or "").lower() in {"1", "true", "yes"}:
            qs = [m for m in qs if get_available_stock_for_inventory_material(material=m, plant=plant) > Decimal("0")]
        return Response(SellableMaterialSerializer(qs, many=True, context={"plant": plant}).data)


class TradeOrderItemOptionsView(APIView):
    """Unified item picker for Trade Orders, scoped to one dispatch stock plant."""

    def get(self, request):
        plant_id = request.query_params.get("plant") or request.query_params.get("plant_id")
        if not plant_id:
            return Response([])
        plant = Plant.objects.filter(id=plant_id).first()
        if not plant:
            raise DRFValidationError({"plant": "Plant not found."})

        rows = []
        for good in (
            TradingGood.objects.filter(is_active=True)
            .prefetch_related("stocks", "stocks__plant")
            .order_by("trade_type", "code")
        ):
            stock = next((s for s in good.stocks.all() if str(s.plant_id) == str(plant.id)), None)
            available = (stock.qty if stock else Decimal("0")) or Decimal("0")
            if available <= 0:
                continue
            rows.append(
                {
                    "key": f"TG:{good.id}",
                    "item_type": "TRADING_GOOD",
                    "id": str(good.id),
                    "code": good.code,
                    "name": good.name,
                    "category": good.trade_type,
                    "category_label": good.get_trade_type_display(),
                    "base_uom": good.base_uom or "PCS",
                    "default_gst_pct": good.default_gst_pct,
                    "default_sale_rate": good.default_sale_rate,
                    "available_qty": available,
                    "plant_stock_qty": available,
                    "plant_name": plant.name,
                    "plant_code": plant.code,
                    "stock_by_plant": [
                        {
                            "plant": str(s.plant_id),
                            "plant_name": s.plant.name if s.plant_id else "",
                            "plant_code": s.plant.code if s.plant_id else "",
                            "qty": s.qty,
                            "uom": good.base_uom or "PCS",
                            "stock_class": "TRADING_GOOD",
                            "detail": "Trading stock pool",
                        }
                        for s in good.stocks.all()
                        if (s.qty or Decimal("0")) > 0
                    ],
                }
            )

        for material in (
            InventoryMaterial.objects.filter(is_sellable=True, status="ACTIVE")
            .select_related("parent_family")
            .order_by("category", "code")
        ):
            available = get_available_stock_for_inventory_material(material=material, plant=plant)
            if available <= 0:
                continue
            rows.append(
                {
                    "key": f"IM:{material.id}",
                    "item_type": "INVENTORY_MATERIAL",
                    "id": str(material.id),
                    "code": material.code,
                    "name": material.name,
                    "category": material.category,
                    "category_label": material.get_category_display(),
                    "base_uom": material.base_uom or "KG",
                    "default_gst_pct": material.default_gst_pct,
                    "default_sale_rate": None,
                    "available_qty": available,
                    "plant_stock_qty": available,
                    "plant_name": plant.name,
                    "plant_code": plant.code,
                    "parent_family_name": material.parent_family.name if material.parent_family_id else "",
                    "stock_by_plant": get_stock_rows_for_inventory_material(material=material),
                }
            )

        rows.sort(key=lambda r: (str(r["category_label"]), str(r["code"])))
        return Response(rows)


class TradeOrderViewSet(viewsets.ModelViewSet):
    queryset = TradeOrder.objects.all().prefetch_related("items").order_by("-created_at")
    serializer_class = TradeOrderSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        st = params.get("status")
        if st:
            qs = qs.filter(status=st)
        cust = params.get("customer")
        if cust:
            qs = qs.filter(customer_id=cust)
        return qs

    def _next_code(self):
        """Generate a unique TO code via savepoint+IntegrityError retry."""
        from django.db import IntegrityError

        year = timezone.now().year
        prefix = f"TO-{year}-"
        last = (
            TradeOrder.objects.filter(code__startswith=prefix)
            .order_by("-code")
            .values_list("code", flat=True)
            .first()
        )
        next_num = 1
        if last:
            try:
                next_num = int(last.split("-")[-1]) + 1
            except Exception:
                next_num = TradeOrder.objects.filter(code__startswith=prefix).count() + 1
        return f"{prefix}{next_num:04d}"

    def perform_create(self, serializer):
        from django.db import IntegrityError

        user = self.request.user if self.request.user.is_authenticated else None
        # Idempotent code generation: retry up to 5x on IntegrityError (uniqueness clash).
        for attempt in range(5):
            sp = transaction.savepoint()
            try:
                serializer.save(code=self._next_code(), created_by=user)
                transaction.savepoint_commit(sp)
                return
            except IntegrityError:
                transaction.savepoint_rollback(sp)
                if attempt == 4:
                    raise

    def destroy(self, request, *args, **kwargs):
        order = self.get_object()
        if order.status != "DRAFT":
            raise DRFValidationError("Only DRAFT trade orders can be deleted.")
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        order = self.get_object()
        with transaction.atomic():
            order = TradeOrder.objects.select_for_update().get(pk=order.pk)
            if order.status != "DRAFT":
                raise DRFValidationError(f"Cannot confirm order in status {order.status}.")
            if not order.items.exists():
                raise DRFValidationError("Add at least one line before confirming.")
            shortages = get_trade_order_stock_shortages(order=order)
            if shortages:
                raise DRFValidationError(shortages)
            order.status = "CONFIRMED"
            order.save(update_fields=["status", "updated_at"])
        return Response(self.get_serializer(order).data)

    @action(detail=True, methods=["post"], url_path="dispatch")
    def dispatch_order(self, request, pk=None):
        """
        Atomically consume stock and mark the order DISPATCHED.

        NOTE on naming: this method is `dispatch_order`, not `dispatch`, because
        `dispatch` is the HTTP entry-point method inherited from `django.views.View`
        via `ViewSet.dispatch()`. Overriding it would break the entire viewset.
        The URL path stays `/dispatch/` (set via `url_path="dispatch"`) — only the
        Python method name changes. This is the standard DRF workaround.
        """
        order = self.get_object()
        try:
            dispatch_trade_order(order=order, user=request.user if request.user.is_authenticated else None)
        except DjValidationError as exc:
            raise DRFValidationError(getattr(exc, "messages", str(exc)))
        order.refresh_from_db()
        return Response(self.get_serializer(order).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        order = self.get_object()
        with transaction.atomic():
            order = TradeOrder.objects.select_for_update().get(pk=order.pk)
            if order.status in {"DISPATCHED", "INVOICED", "CANCELLED"}:
                raise DRFValidationError(f"Cannot cancel order in status {order.status}.")
            order.status = "CANCELLED"
            order.save(update_fields=["status", "updated_at"])
        return Response(self.get_serializer(order).data)
