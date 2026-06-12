from decimal import Decimal

from rest_framework import serializers

from apps.procurement.models import (
    PurchaseOrder,
    PurchaseOrderItem,
    PurchaseOrderReceipt,
    PurchaseOrderReceiptLine,
    TradingGoodReceipt,
)


class PurchaseOrderItemSerializer(serializers.ModelSerializer):
    material_code = serializers.CharField(source="material.code", read_only=True)
    material_name = serializers.CharField(source="material.name", read_only=True)
    material_category = serializers.CharField(source="material.category", read_only=True)
    qty_open = serializers.SerializerMethodField()
    progress_pct = serializers.SerializerMethodField()

    class Meta:
        model = PurchaseOrderItem
        fields = [
            "id",
            "line_no",
            "material",
            "material_code",
            "material_name",
            "material_category",
            "description",
            "qty_ordered",
            "uom",
            "rate_per_uom",
            "gst_pct",
            "line_subtotal",
            "line_gst",
            "line_total",
            "expected_delivery_date",
            "qty_received",
            "qty_open",
            "progress_pct",
            "is_closed",
            "close_reason",
            "expected_width_mm",
            "expected_thickness_micron",
        ]
        read_only_fields = [
            "qty_received",
            "qty_open",
            "progress_pct",
            "line_subtotal",
            "line_gst",
            "line_total",
            "is_closed",
            "close_reason",
        ]

    def get_qty_open(self, obj):
        return float(obj.qty_open)

    def get_progress_pct(self, obj):
        return obj.progress_pct


class PurchaseOrderReceiptLineSerializer(serializers.ModelSerializer):
    po_item_line_no = serializers.IntegerField(source="po_item.line_no", read_only=True)
    material_code = serializers.CharField(source="po_item.material.code", read_only=True)
    material_name = serializers.CharField(source="po_item.material.name", read_only=True)

    class Meta:
        model = PurchaseOrderReceiptLine
        fields = [
            "id",
            "po_item",
            "po_item_line_no",
            "material_code",
            "material_name",
            "qty_received",
            "rate",
            "notes",
            "rejection_reason",
            "bulk_tx_id",
            "roll_id",
            "packaging_tx_id",
        ]


class PurchaseOrderReceiptSerializer(serializers.ModelSerializer):
    lines = PurchaseOrderReceiptLineSerializer(many=True, read_only=True)
    purchase_order_code = serializers.CharField(source="purchase_order.code", read_only=True)
    plant_name = serializers.CharField(source="plant.name", read_only=True)
    received_by_name = serializers.SerializerMethodField()

    class Meta:
        model = PurchaseOrderReceipt
        fields = [
            "id",
            "code",
            "purchase_order",
            "purchase_order_code",
            "plant",
            "plant_name",
            "received_at",
            "vendor_invoice_no",
            "vendor_invoice_date",
            "vehicle_no",
            "driver_name",
            "lr_no",
            "quality_status",
            "notes",
            "received_by",
            "received_by_name",
            "lines",
            "created_at",
        ]
        read_only_fields = ["code", "received_by", "lines", "created_at"]

    def get_received_by_name(self, obj):
        u = obj.received_by
        if not u:
            return ""
        return getattr(u, "full_name", "") or getattr(u, "username", "") or ""


class PurchaseOrderSerializer(serializers.ModelSerializer):
    items = PurchaseOrderItemSerializer(many=True, required=False)
    receipts = PurchaseOrderReceiptSerializer(many=True, read_only=True)
    vendor_name = serializers.CharField(source="vendor.name", read_only=True)
    vendor_gstin = serializers.CharField(source="vendor.gst_no", read_only=True)
    plant_name = serializers.CharField(source="plant.name", read_only=True)
    open_qty_total = serializers.SerializerMethodField()
    items_count = serializers.SerializerMethodField()
    qty_ordered_total = serializers.SerializerMethodField()
    qty_received_total = serializers.SerializerMethodField()
    progress_pct = serializers.SerializerMethodField()

    class Meta:
        model = PurchaseOrder
        fields = [
            "id",
            "code",
            "vendor",
            "vendor_name",
            "vendor_gstin",
            "plant",
            "plant_name",
            "order_date",
            "expected_delivery_date",
            "status",
            "currency",
            "payment_terms",
            "freight_terms",
            "delivery_address",
            "notes",
            "source_mrp_suggestion",
            "subtotal",
            "gst_total",
            "freight_amount",
            "grand_total",
            "sent_at",
            "acknowledged_at",
            "ack_ref",
            "completed_at",
            "cancelled_at",
            "cancel_reason",
            "status_history",
            "items",
            "receipts",
            "items_count",
            "open_qty_total",
            "qty_ordered_total",
            "qty_received_total",
            "progress_pct",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "code",
            "status",
            "subtotal",
            "gst_total",
            "grand_total",
            "sent_at",
            "acknowledged_at",
            "completed_at",
            "cancelled_at",
            "cancel_reason",
            "status_history",
            "receipts",
            "created_at",
            "updated_at",
        ]

    def get_open_qty_total(self, obj):
        return float(obj.open_qty_total)

    def get_items_count(self, obj):
        return obj.items.count()

    def get_qty_ordered_total(self, obj):
        return float(sum((it.qty_ordered or Decimal("0")) for it in obj.items.all()))

    def get_qty_received_total(self, obj):
        return float(sum((it.qty_received or Decimal("0")) for it in obj.items.all()))

    def get_progress_pct(self, obj):
        ordered = sum((it.qty_ordered or Decimal("0")) for it in obj.items.all())
        if not ordered:
            return 0.0
        received = sum((it.qty_received or Decimal("0")) for it in obj.items.all())
        return min(round(float(received) / float(ordered) * 100, 1), 100.0)

    def create(self, validated_data):
        from apps.procurement.services.purchase_order import PurchaseOrderService

        items_data = validated_data.pop("items", [])
        request = self.context.get("request")
        if request and getattr(request, "user", None) and request.user.is_authenticated:
            validated_data.setdefault("created_by", request.user)
        po = PurchaseOrder.objects.create(**validated_data)
        for idx, item in enumerate(items_data, start=1):
            item.setdefault("line_no", idx)
            PurchaseOrderItem.objects.create(purchase_order=po, **item)
        PurchaseOrderService.recalc_totals(po)
        po.refresh_from_db()
        return po

    def update(self, instance, validated_data):
        from apps.procurement.services.purchase_order import PurchaseOrderService

        items_data = validated_data.pop("items", None)
        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        instance.save()
        if items_data is not None:
            if instance.status != "DRAFT":
                raise serializers.ValidationError(
                    "Items can only be edited while the PO is in DRAFT."
                )
            instance.items.all().delete()
            for idx, item in enumerate(items_data, start=1):
                item.setdefault("line_no", idx)
                PurchaseOrderItem.objects.create(purchase_order=instance, **item)
            PurchaseOrderService.recalc_totals(instance)
            instance.refresh_from_db()
        return instance


class PurchaseOrderListSerializer(serializers.ModelSerializer):
    vendor_name = serializers.CharField(source="vendor.name", read_only=True)
    plant_name = serializers.CharField(source="plant.name", read_only=True)
    items_count = serializers.SerializerMethodField()
    open_qty_total = serializers.SerializerMethodField()
    qty_ordered_total = serializers.SerializerMethodField()
    qty_received_total = serializers.SerializerMethodField()
    progress_pct = serializers.SerializerMethodField()

    class Meta:
        model = PurchaseOrder
        fields = [
            "id",
            "code",
            "vendor",
            "vendor_name",
            "plant",
            "plant_name",
            "status",
            "grand_total",
            "order_date",
            "expected_delivery_date",
            "items_count",
            "open_qty_total",
            "qty_ordered_total",
            "qty_received_total",
            "progress_pct",
            "updated_at",
        ]

    def get_items_count(self, obj):
        return obj.items.count()

    def get_open_qty_total(self, obj):
        return float(obj.open_qty_total)

    def get_qty_ordered_total(self, obj):
        return float(sum((it.qty_ordered or Decimal("0")) for it in obj.items.all()))

    def get_qty_received_total(self, obj):
        return float(sum((it.qty_received or Decimal("0")) for it in obj.items.all()))

    def get_progress_pct(self, obj):
        ordered = sum((it.qty_ordered or Decimal("0")) for it in obj.items.all())
        if not ordered:
            return 0.0
        received = sum((it.qty_received or Decimal("0")) for it in obj.items.all())
        return min(round(float(received) / float(ordered) * 100, 1), 100.0)


class PurchaseOrderReceiptCreateLineSerializer(serializers.Serializer):
    po_item_id = serializers.UUIDField()
    qty_received = serializers.DecimalField(max_digits=14, decimal_places=3)
    rate = serializers.DecimalField(
        max_digits=14, decimal_places=2, required=False, allow_null=True
    )
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    rejection_reason = serializers.CharField(
        required=False, allow_blank=True, default=""
    )
    width_mm = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, allow_null=True
    )
    thickness_micron = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, allow_null=True
    )


class PurchaseOrderReceiptCreateSerializer(serializers.Serializer):
    purchase_order = serializers.UUIDField()
    location_id = serializers.UUIDField(required=False, allow_null=True)
    vendor_invoice_no = serializers.CharField(required=False, allow_blank=True, default="")
    vendor_invoice_date = serializers.DateField(required=False, allow_null=True)
    vehicle_no = serializers.CharField(required=False, allow_blank=True, default="")
    driver_name = serializers.CharField(required=False, allow_blank=True, default="")
    lr_no = serializers.CharField(required=False, allow_blank=True, default="")
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    quality_status = serializers.ChoiceField(
        choices=PurchaseOrderReceipt.QUALITY_CHOICES, default="PENDING", required=False
    )
    lines = PurchaseOrderReceiptCreateLineSerializer(many=True)


class TradingGoodReceiptSerializer(serializers.ModelSerializer):
    trading_good_code = serializers.CharField(source="trading_good.code", read_only=True)
    trading_good_name = serializers.CharField(source="trading_good.name", read_only=True)
    base_uom = serializers.CharField(source="trading_good.base_uom", read_only=True)
    vendor_code = serializers.CharField(source="vendor.code", read_only=True)
    vendor_name = serializers.CharField(source="vendor.name", read_only=True)
    plant_code = serializers.CharField(source="plant.code", read_only=True, default="")
    plant_name = serializers.CharField(source="plant.name", read_only=True)

    class Meta:
        model = TradingGoodReceipt
        fields = [
            "id",
            "code",
            "trading_good",
            "trading_good_code",
            "trading_good_name",
            "base_uom",
            "vendor",
            "vendor_code",
            "vendor_name",
            "plant",
            "plant_code",
            "plant_name",
            "qty_received",
            "rate",
            "gst_pct",
            "line_subtotal",
            "line_gst",
            "line_total",
            "vendor_invoice_no",
            "vendor_invoice_date",
            "vehicle_no",
            "driver_name",
            "lr_no",
            "notes",
            "received_at",
            "received_by",
            "created_at",
        ]
        read_only_fields = ["id", "code", "received_at", "received_by", "created_at"]


class TradingGoodReceiptCreateSerializer(serializers.Serializer):
    trading_good = serializers.UUIDField()
    vendor = serializers.UUIDField()
    plant = serializers.UUIDField()
    qty = serializers.DecimalField(max_digits=14, decimal_places=3)
    rate = serializers.DecimalField(max_digits=14, decimal_places=2)
    gst_pct = serializers.DecimalField(
        max_digits=5,
        decimal_places=2,
        required=False,
        allow_null=True,
    )
    vendor_invoice_no = serializers.CharField(required=False, allow_blank=True, default="")
    vendor_invoice_date = serializers.DateField(required=False, allow_null=True)
    vehicle_no = serializers.CharField(required=False, allow_blank=True, default="")
    driver_name = serializers.CharField(required=False, allow_blank=True, default="")
    lr_no = serializers.CharField(required=False, allow_blank=True, default="")
    notes = serializers.CharField(required=False, allow_blank=True, default="")
