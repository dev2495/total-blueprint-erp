"""Serializers for Trading Goods + Trade Orders."""

from decimal import Decimal
from rest_framework import serializers

from apps.materials.models import InventoryMaterial, TradingGood, TradingGoodStock
from apps.sales.models import TradeOrder, TradeOrderItem
from apps.sales.services.trade_dispatch import (
    get_available_stock_for_inventory_material,
    get_available_stock_for_trading_good,
    get_stock_rows_for_inventory_material,
)


# ──────────────────────────────────────────────────────────────────────────
# Trading Goods
# ──────────────────────────────────────────────────────────────────────────


class TradingGoodStockSerializer(serializers.ModelSerializer):
    plant_name = serializers.CharField(source="plant.name", read_only=True)
    plant_code = serializers.CharField(source="plant.code", read_only=True)

    class Meta:
        model = TradingGoodStock
        fields = ["id", "trading_good", "plant", "plant_name", "plant_code", "qty", "avg_cost", "updated_at"]
        read_only_fields = ["id", "updated_at", "plant_name", "plant_code"]


class TradingGoodSerializer(serializers.ModelSerializer):
    current_stock_qty = serializers.SerializerMethodField()
    stocks = TradingGoodStockSerializer(many=True, read_only=True)

    class Meta:
        model = TradingGood
        fields = [
            "id",
            "code",
            "name",
            "trade_type",
            "description",
            "base_uom",
            "hsn_code",
            "default_gst_pct",
            "default_sale_rate",
            "default_buy_rate",
            "is_active",
            "notes",
            "current_stock_qty",
            "stocks",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "current_stock_qty", "stocks"]

    def get_current_stock_qty(self, obj):
        qty_sum = Decimal("0")
        for s in obj.stocks.all():
            qty_sum += s.qty or Decimal("0")
        return qty_sum


# ──────────────────────────────────────────────────────────────────────────
# Sellable inventory materials (granules + film variants flagged is_sellable)
# ──────────────────────────────────────────────────────────────────────────


class SellableMaterialSerializer(serializers.ModelSerializer):
    parent_family_name = serializers.CharField(source="parent_family.name", read_only=True, allow_null=True)
    current_stock_qty = serializers.SerializerMethodField()
    plant_stock_qty = serializers.SerializerMethodField()
    stock_by_plant = serializers.SerializerMethodField()

    class Meta:
        model = InventoryMaterial
        fields = [
            "id",
            "code",
            "name",
            "category",
            "base_uom",
            "is_sellable",
            "default_gst_pct",
            "parent_family",
            "parent_family_name",
            "status",
            "current_stock_qty",
            "plant_stock_qty",
            "stock_by_plant",
        ]
        read_only_fields = fields

    def _plant(self):
        return self.context.get("plant")

    def get_stock_by_plant(self, obj):
        return get_stock_rows_for_inventory_material(material=obj)

    def get_current_stock_qty(self, obj):
        return sum((row.get("qty") or Decimal("0")) for row in self.get_stock_by_plant(obj))

    def get_plant_stock_qty(self, obj):
        plant = self._plant()
        if not plant:
            return None
        return get_available_stock_for_inventory_material(material=obj, plant=plant)


# ──────────────────────────────────────────────────────────────────────────
# Trade Orders
# ──────────────────────────────────────────────────────────────────────────


class TradeOrderItemSerializer(serializers.ModelSerializer):
    display_name = serializers.CharField(read_only=True)
    inventory_material_id = serializers.PrimaryKeyRelatedField(
        queryset=InventoryMaterial.objects.all(),
        source="inventory_material",
        write_only=True,
        required=False,
        allow_null=True,
    )
    trading_good_id = serializers.PrimaryKeyRelatedField(
        queryset=TradingGood.objects.all(),
        source="trading_good",
        write_only=True,
        required=False,
        allow_null=True,
    )

    class Meta:
        model = TradeOrderItem
        fields = [
            "id",
            "line_no",
            "item_type",
            "inventory_material",
            "inventory_material_id",
            "trading_good",
            "trading_good_id",
            "description",
            "qty",
            "uom",
            "rate",
            "gst_pct",
            "line_subtotal",
            "line_gst",
            "line_total",
            "display_name",
        ]
        read_only_fields = [
            "id",
            "inventory_material",
            "trading_good",
            "line_subtotal",
            "line_gst",
            "line_total",
            "display_name",
        ]

    def validate(self, attrs):
        item_type = attrs.get("item_type") or getattr(self.instance, "item_type", None)
        mat = attrs.get("inventory_material") or getattr(self.instance, "inventory_material", None)
        tg = attrs.get("trading_good") or getattr(self.instance, "trading_good", None)
        qty = attrs.get("qty", getattr(self.instance, "qty", Decimal("0")))
        rate = attrs.get("rate", getattr(self.instance, "rate", Decimal("0")))
        gst_pct = attrs.get("gst_pct", getattr(self.instance, "gst_pct", Decimal("0")))
        uom = str(attrs.get("uom", getattr(self.instance, "uom", "")) or "").upper()

        if qty is None or Decimal(str(qty)) <= 0:
            raise serializers.ValidationError({"qty": "Trade order line quantity must be greater than zero."})
        if rate is not None and Decimal(str(rate)) < 0:
            raise serializers.ValidationError({"rate": "Rate cannot be negative."})
        if gst_pct is not None and Decimal(str(gst_pct)) < 0:
            raise serializers.ValidationError({"gst_pct": "GST percent cannot be negative."})

        if item_type == "INVENTORY_MATERIAL" and not mat:
            raise serializers.ValidationError({"inventory_material_id": "Required when item_type=INVENTORY_MATERIAL"})
        if item_type == "TRADING_GOOD" and not tg:
            raise serializers.ValidationError({"trading_good_id": "Required when item_type=TRADING_GOOD"})
        if item_type == "INVENTORY_MATERIAL" and tg:
            raise serializers.ValidationError({"trading_good_id": "Do not send trading_good_id for inventory material lines."})
        if item_type == "TRADING_GOOD" and mat:
            raise serializers.ValidationError({"inventory_material_id": "Do not send inventory_material_id for trading good lines."})
        if item_type == "INVENTORY_MATERIAL" and mat:
            if not mat.is_sellable or str(mat.status or "").upper() != "ACTIVE":
                raise serializers.ValidationError(
                    {"inventory_material_id": "Only ACTIVE materials flagged sellable can be used on trade orders."}
                )
            expected_uom = str(mat.base_uom or "").upper()
            if expected_uom and not uom:
                attrs["uom"] = expected_uom
            elif expected_uom and uom != expected_uom:
                raise serializers.ValidationError({"uom": f"UOM must match material base UOM ({expected_uom})."})
        if item_type == "TRADING_GOOD" and tg:
            if not tg.is_active:
                raise serializers.ValidationError({"trading_good_id": "Only ACTIVE trading goods can be used on trade orders."})
            expected_uom = str(tg.base_uom or "").upper()
            if expected_uom and not uom:
                attrs["uom"] = expected_uom
            elif expected_uom and uom != expected_uom:
                raise serializers.ValidationError({"uom": f"UOM must match trading good base UOM ({expected_uom})."})
        return attrs


class TradeOrderSerializer(serializers.ModelSerializer):
    items = TradeOrderItemSerializer(many=True, required=False)
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    plant_name = serializers.CharField(source="plant.name", read_only=True, allow_null=True)

    class Meta:
        model = TradeOrder
        fields = [
            "id",
            "code",
            "customer",
            "customer_name",
            "plant",
            "plant_name",
            "order_date",
            "status",
            "notes",
            "subtotal",
            "gst_total",
            "grand_total",
            "dispatched_at",
            "invoice_no",
            "items",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "code",
            "customer_name",
            "plant_name",
            "status",
            "subtotal",
            "gst_total",
            "grand_total",
            "dispatched_at",
            "created_at",
            "updated_at",
        ]

    def _write_items(self, order, items_data):
        # Replace items wholesale for simplicity (DRAFT can be edited freely).
        order.items.all().delete()
        for idx, item in enumerate(items_data or [], start=1):
            line_no = item.get("line_no") or idx
            TradeOrderItem.objects.create(
                trade_order=order,
                line_no=line_no,
                item_type=item.get("item_type"),
                inventory_material=item.get("inventory_material"),
                trading_good=item.get("trading_good"),
                description=item.get("description") or "",
                qty=item.get("qty") or Decimal("0"),
                uom=item.get("uom") or "PCS",
                rate=item.get("rate") or Decimal("0"),
                gst_pct=item.get("gst_pct") or Decimal("0"),
            )

    def validate(self, attrs):
        plant = attrs.get("plant") or getattr(self.instance, "plant", None)
        items_data = attrs.get("items")

        if not plant:
            raise serializers.ValidationError({"plant": "Dispatch stock plant is required for trade orders."})
        if items_data is None:
            return attrs

        requested: dict[tuple[str, str], Decimal] = {}
        available_cache: dict[tuple[str, str], Decimal] = {}
        labels: dict[tuple[str, str], str] = {}

        for idx, item in enumerate(items_data or [], start=1):
            item_type = item.get("item_type")
            qty = Decimal(str(item.get("qty") or "0"))
            if qty <= 0:
                continue

            if item_type == "TRADING_GOOD":
                good = item.get("trading_good")
                if not good:
                    continue
                key = ("TG", str(good.id))
                available_cache.setdefault(
                    key,
                    get_available_stock_for_trading_good(trading_good=good, plant=plant),
                )
                labels[key] = f"Line #{idx}: {good.code} · {good.name}"
            elif item_type == "INVENTORY_MATERIAL":
                material = item.get("inventory_material")
                if not material:
                    continue
                key = ("IM", str(material.id))
                available_cache.setdefault(
                    key,
                    get_available_stock_for_inventory_material(material=material, plant=plant),
                )
                labels[key] = f"Line #{idx}: {material.code} · {material.name}"
            else:
                continue

            requested[key] = requested.get(key, Decimal("0")) + qty

        shortages = []
        for key, qty in requested.items():
            available = available_cache.get(key, Decimal("0"))
            if qty > available:
                shortages.append(f"{labels.get(key, 'Item')} — available at plant {available}, requested {qty}.")
        if shortages:
            raise serializers.ValidationError({"items": shortages})
        return attrs

    def create(self, validated_data):
        items_data = validated_data.pop("items", [])
        order = TradeOrder.objects.create(**validated_data)
        self._write_items(order, items_data)
        order.recompute_totals()
        return order

    def update(self, instance, validated_data):
        if instance.status != "DRAFT":
            raise serializers.ValidationError("Only DRAFT trade orders can be edited.")
        items_data = validated_data.pop("items", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if items_data is not None:
            self._write_items(instance, items_data)
        instance.recompute_totals()
        return instance
