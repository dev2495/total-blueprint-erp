from rest_framework import serializers

from .models import Quotation, QuotationItem


class QuotationItemSerializer(serializers.ModelSerializer):
    template_name = serializers.ReadOnlyField(source="template.name")

    class Meta:
        model = QuotationItem
        fields = [
            "id",
            "template",
            "template_name",
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
            "created_at",
            "updated_at",
        ]


class QuotationSerializer(serializers.ModelSerializer):
    items = QuotationItemSerializer(many=True, read_only=True)
    customer_code = serializers.ReadOnlyField(source="customer.code")
    plant_name = serializers.ReadOnlyField(source="plant.name")
    converted_sales_order_number = serializers.ReadOnlyField(source="converted_sales_order.order_number")

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
            "totals_snapshot",
            "converted_sales_order",
            "converted_sales_order_number",
            "items",
            "created_at",
            "updated_at",
        ]
