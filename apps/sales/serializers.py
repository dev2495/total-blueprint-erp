from rest_framework import serializers
from decimal import Decimal
from .models import SalesOrder, SalesOrderItem
from apps.templates.models import TemplateBlueprint
from apps.factory.models import Plant
from .services.order_block_resolver import resolve_block_reasons
from .services.order_service import _normalize_packaging_snapshot

class SalesOrderItemSerializer(serializers.ModelSerializer):
    template_name = serializers.ReadOnlyField(source='template.name')
    template_status = serializers.ReadOnlyField(source='template.status')
    routing_assigned = serializers.SerializerMethodField()
    has_stock_claims = serializers.SerializerMethodField()
    claimed_stock_order_nos = serializers.SerializerMethodField()

    class Meta:
        model = SalesOrderItem
        fields = [
            'id', 'template', 'template_name', 'template_status', 
            'qty_value', 'qty_uom', 'unit_weight_g', 'total_weight_kg',
            'line_name', 'price_basis', 'unit_price',
            'artwork_assignment_required', 'assigned_artwork',
            'geometry_snapshot', 'layer_snapshot', 'printing_snapshot', 'addons_snapshot', 'packaging_snapshot',
            'bom_snapshot', 'routing_assigned', 'has_stock_claims', 'claimed_stock_order_nos'
        ]

    def get_routing_assigned(self, obj):
        return obj.template.routing_rule is not None

    def get_has_stock_claims(self, obj):
        return len(self.get_claimed_stock_order_nos(obj)) > 0

    def get_claimed_stock_order_nos(self, obj):
        source_nos = set()
        for roll in obj.inventory_rolls.all():
            source_no = str(((getattr(roll, "meta_json", None) or {}).get("claimed_from_stock_order_no") or "")).strip()
            if source_no:
                source_nos.add(source_no)
        for batch in obj.fg_batches.all():
            source_no = str(((getattr(batch, "meta_json", None) or {}).get("claimed_from_stock_order_no") or "")).strip()
            if source_no:
                source_nos.add(source_no)
        return sorted(source_nos)


class SalesOrderSerializer(serializers.ModelSerializer):
    items = SalesOrderItemSerializer(many=True, read_only=True)
    items_data = serializers.JSONField(write_only=True, required=False)
    status_display = serializers.ReadOnlyField(source='get_status_display')
    can_confirm = serializers.SerializerMethodField()
    block_reasons = serializers.SerializerMethodField()
    total_value = serializers.SerializerMethodField()

    class Meta:
        model = SalesOrder
        fields = [
            'id',
            'order_number',
            'order_name',
            'customer_name',
            'order_type',
            'status',
            'status_display',
            'execution_model_version',
            'total_weight_kg',
            'total_value',
            'delivery_date',
            'geometry_override',
            'commercial_confirmed_at',
            'items',
            'items_data',
            'can_confirm',
            'block_reasons',
            'created_at',
        ]
        read_only_fields = ['status', 'created_at', 'total_weight_kg', 'commercial_confirmed_at', 'execution_model_version']

    def get_can_confirm(self, obj):
        return len(resolve_block_reasons(obj)) == 0

    def get_block_reasons(self, obj):
        return resolve_block_reasons(obj)

    def get_total_value(self, obj):
        total = Decimal("0")
        for item in obj.items.all():
            total += Decimal(str(getattr(item, "line_amount", 0) or 0))
        return float(total)

    def create(self, validated_data):
        items_data = validated_data.pop('items_data', [])
        order = SalesOrder.objects.create(**validated_data)
        for item in items_data:
            template_id = item.get('template')
            template = TemplateBlueprint.objects.get(id=template_id)
            price_basis = str(item.get('price_basis', 'KG') or 'KG').upper()
            if price_basis not in {'KG', 'PCS'}:
                raise serializers.ValidationError({'items_data': 'price_basis must be KG or PCS.'})
            unit_price = Decimal(str(item.get('unit_price', 0) or 0))
            if unit_price <= 0:
                raise serializers.ValidationError({'items_data': 'unit_price must be greater than zero.'})
            SalesOrderItem.objects.create(
                sales_order=order,
                template=template,
                line_name=item.get('line_name', ''),
                qty_value=item.get('qty_value', item.get('ordered_qty', 0)),
                qty_uom=item.get('qty_uom', item.get('uom', 'KG')),
                price_basis=price_basis,
                unit_price=unit_price,
                packaging_snapshot=_normalize_packaging_snapshot(item.get('packaging_snapshot') or {}),
            )
        return order
