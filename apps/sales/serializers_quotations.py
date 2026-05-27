from rest_framework import serializers

from .models import Quotation, QuotationItem


class QuotationItemSerializer(serializers.ModelSerializer):
    template_name = serializers.ReadOnlyField(source="template.name")
    sku_variant_name = serializers.ReadOnlyField(source="sku_variant.name")
    sku_variant_code = serializers.ReadOnlyField(source="sku_variant.code")
    source_mode = serializers.SerializerMethodField()

    class Meta:
        model = QuotationItem
        fields = [
            "id",
            "template",
            "template_name",
            "sku_variant",
            "sku_variant_name",
            "sku_variant_code",
            "source_mode",
            "line_name",
            "finished_good_type",
            "roll_form",
            "qty_value",
            "qty_uom",
            "price_basis",
            "geometry_snapshot",
            "layer_snapshot",
            "printing_snapshot",
            "chemicals_snapshot",
            "addons_snapshot",
            "packaging_snapshot",
            "physics_snapshot",
            "bom_snapshot",
            "process_cost_rows",
            "commercial_snapshot",
            "costing_snapshot",
            "unit_weight_g",
            "total_weight_kg",
            "quoted_unit_price",
            "quoted_line_total",
            "line_kind",
            "spec_snapshot",
            "margin_lock",
            "manual_rate_override",
            "created_at",
            "updated_at",
        ]

    def get_source_mode(self, obj):
        return "SKU" if obj.sku_variant_id else "CUSTOM"


class QuotationSerializer(serializers.ModelSerializer):
    items = QuotationItemSerializer(many=True, read_only=True)
    customer_code = serializers.ReadOnlyField(source="customer.code")
    plant_name = serializers.ReadOnlyField(source="plant.name")
    converted_sales_order_number = serializers.ReadOnlyField(source="converted_sales_order.order_number")
    approved_by_name = serializers.SerializerMethodField()
    sent_by_name = serializers.SerializerMethodField()
    rejected_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Quotation
        fields = [
            "id",
            "quote_number",
            "customer",
            "customer_name",
            "customer_code",
            "plant",
            "plant_name",
            "status",
            "valid_until",
            "currency",
            "terms",
            "notes",
            "custom_terms",
            "discount_pct",
            "discount_amount",
            "freight_amount",
            "freight_included",
            "other_charges",
            "gst_rate",
            "status_history",
            "rejection_reason",
            "sent_at",
            "sent_by",
            "sent_by_name",
            "approved_at",
            "approved_by",
            "approved_by_name",
            "rejected_by",
            "rejected_by_name",
            "revision_no",
            "parent_quotation",
            "totals_snapshot",
            "converted_sales_order",
            "converted_sales_order_number",
            "items",
            "created_at",
            "updated_at",
        ]

    def _user_name(self, user):
        if not user:
            return None
        return (
            getattr(user, "full_name", None)
            or getattr(user, "get_full_name", lambda: "")()
            or getattr(user, "username", None)
            or getattr(user, "email", None)
        )

    def get_approved_by_name(self, obj):
        return self._user_name(getattr(obj, "approved_by", None))

    def get_sent_by_name(self, obj):
        return self._user_name(getattr(obj, "sent_by", None))

    def get_rejected_by_name(self, obj):
        return self._user_name(getattr(obj, "rejected_by", None))
