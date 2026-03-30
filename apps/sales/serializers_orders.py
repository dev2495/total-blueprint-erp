from decimal import Decimal

from rest_framework import serializers

from apps.physics.geometry_override import validate_pouch_geometry_contract
from apps.templates.models import TemplateBlueprint

from .models import SalesOrder, SalesOrderItem, SalesSku, SalesSkuVariant
from .services.order_block_resolver import resolve_block_reasons
from .services.order_service import _normalize_packaging_snapshot


class SalesSkuVariantSerializer(serializers.ModelSerializer):
    sku_code = serializers.ReadOnlyField(source="sku.code")
    sku_name = serializers.ReadOnlyField(source="sku.name")
    template = serializers.ReadOnlyField(source="sku.template_id")
    template_name = serializers.ReadOnlyField(source="sku.template.name")

    class Meta:
        model = SalesSkuVariant
        fields = [
            "id",
            "sku",
            "sku_code",
            "sku_name",
            "code",
            "name",
            "active",
            "finished_good_type",
            "roll_form",
            "geometry_snapshot",
            "layer_snapshot",
            "printing_snapshot",
            "chemicals_snapshot",
            "addons_snapshot",
            "packaging_snapshot",
            "template",
            "template_name",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "sku_code", "sku_name", "template", "template_name", "created_at", "updated_at"]

    def validate(self, attrs):
        sku = attrs.get("sku", getattr(self.instance, "sku", None))
        fg_type = str(attrs.get("finished_good_type", getattr(self.instance, "finished_good_type", "POUCH")) or "POUCH").upper()
        if sku and str(getattr(sku.template, "fg_type", "") or "").upper() != fg_type:
            raise serializers.ValidationError({"finished_good_type": "Variant fg_type must match the linked template fg_type."})
        if fg_type == "ROLL":
            attrs["roll_form"] = str(attrs.get("roll_form", getattr(self.instance, "roll_form", "FLAT")) or "FLAT").upper()
        else:
            attrs["roll_form"] = ""
            geometry_snapshot = attrs.get("geometry_snapshot", getattr(self.instance, "geometry_snapshot", {})) or {}
            addons_snapshot = attrs.get("addons_snapshot", getattr(self.instance, "addons_snapshot", [])) or []
            template_pouch_style = ""
            if sku and getattr(sku, "template", None):
                template_pouch_style = str(getattr(sku.template, "pouch_style", "") or "")
            try:
                attrs["geometry_snapshot"] = validate_pouch_geometry_contract(
                    fg_type=fg_type,
                    geometry=geometry_snapshot,
                    addons=addons_snapshot,
                    template_pouch_style=template_pouch_style,
                    context_label="SKU variant",
                )
            except Exception as exc:
                raise serializers.ValidationError(getattr(exc, "message_dict", {"geometry_snapshot": str(exc)}))
        return attrs


class SalesSkuSerializer(serializers.ModelSerializer):
    template_name = serializers.ReadOnlyField(source="template.name")
    commercial_family_name = serializers.ReadOnlyField(source="commercial_family.name")
    variants = SalesSkuVariantSerializer(many=True, read_only=True)
    customer_usage_count = serializers.IntegerField(read_only=True, default=0)
    customer_last_used_at = serializers.DateTimeField(read_only=True, allow_null=True)

    class Meta:
        model = SalesSku
        fields = [
            "id",
            "code",
            "name",
            "template",
            "template_name",
            "commercial_family",
            "commercial_family_name",
            "default_line_name",
            "active",
            "variants",
            "customer_usage_count",
            "customer_last_used_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "template_name",
            "commercial_family_name",
            "customer_usage_count",
            "customer_last_used_at",
            "created_at",
            "updated_at",
        ]

    def validate_template(self, value):
        if str(getattr(value, "status", "") or "").upper() != "LIVE":
            raise serializers.ValidationError("Sales SKU must link to a LIVE template.")
        return value


class RepeatLineCandidateSerializer(serializers.ModelSerializer):
    order_id = serializers.ReadOnlyField(source="sales_order_id")
    order_number = serializers.ReadOnlyField(source="sales_order.order_number")
    order_name = serializers.ReadOnlyField(source="sales_order.order_name")
    customer_id = serializers.ReadOnlyField(source="sales_order.customer_id")
    customer_name = serializers.ReadOnlyField(source="sales_order.customer_name")
    order_created_at = serializers.ReadOnlyField(source="sales_order.created_at")
    template_id = serializers.ReadOnlyField()
    template_name = serializers.ReadOnlyField(source="template.name")
    sku_variant_id = serializers.ReadOnlyField()
    sku_variant_name = serializers.ReadOnlyField(source="sku_variant.name")
    sku_variant_code = serializers.ReadOnlyField(source="sku_variant.code")
    chemicals_snapshot = serializers.SerializerMethodField()
    summary = serializers.SerializerMethodField()

    class Meta:
        model = SalesOrderItem
        fields = [
            "id",
            "order_id",
            "order_number",
            "order_name",
            "customer_id",
            "customer_name",
            "order_created_at",
            "template_id",
            "template_name",
            "sku_variant_id",
            "sku_variant_name",
            "sku_variant_code",
            "line_name",
            "qty_value",
            "qty_uom",
            "price_basis",
            "unit_price",
            "geometry_snapshot",
            "layer_snapshot",
            "printing_snapshot",
            "chemicals_snapshot",
            "addons_snapshot",
            "packaging_snapshot",
            "summary",
        ]

    def get_chemicals_snapshot(self, obj):
        printing = obj.printing_snapshot if isinstance(obj.printing_snapshot, dict) else {}
        chemicals = printing.get("chemicals")
        return chemicals if isinstance(chemicals, dict) else {}

    def get_summary(self, obj):
        geometry = obj.geometry_snapshot if isinstance(obj.geometry_snapshot, dict) else {}
        base = geometry.get("base") if isinstance(geometry.get("base"), dict) else {}
        printing = obj.printing_snapshot if isinstance(obj.printing_snapshot, dict) else {}
        packaging = obj.packaging_snapshot if isinstance(obj.packaging_snapshot, dict) else {}
        pod = packaging.get("pod") if isinstance(packaging.get("pod"), dict) else {}
        return {
            "finished_good_type": str(geometry.get("finished_good_type") or obj.template.fg_type or "POUCH").upper(),
            "roll_form": str(geometry.get("roll_form") or "").upper(),
            "pouch_style": str(geometry.get("pouch_style") or obj.template.pouch_style or "").upper(),
            "width_mm": base.get("width_mm") or geometry.get("width_mm") or 0,
            "height_mm": base.get("height_mm") or geometry.get("height_mm") or 0,
            "layer_count": len(obj.layer_snapshot or []),
            "printing_enabled": bool(printing.get("enabled", False)),
            "printing_type": str(printing.get("type") or "").upper(),
            "pod_enabled": bool(pod.get("enabled", False)),
            "addons_count": len(obj.addons_snapshot or []),
        }


class SalesOrderBatchResultSerializer(serializers.Serializer):
    client_reference = serializers.CharField(allow_blank=True, allow_null=True, required=False)
    source_type = serializers.CharField()
    status = serializers.ChoiceField(choices=["created", "failed"])
    sales_order_id = serializers.CharField(allow_blank=True, allow_null=True, required=False)
    sales_order_number = serializers.CharField(allow_blank=True, allow_null=True, required=False)
    error = serializers.CharField(allow_blank=True, allow_null=True, required=False)


class SalesOrderItemSerializer(serializers.ModelSerializer):
    template_name = serializers.ReadOnlyField(source="template.name")
    template_status = serializers.ReadOnlyField(source="template.status")
    routing_assigned = serializers.SerializerMethodField()
    has_stock_claims = serializers.SerializerMethodField()
    claimed_stock_order_nos = serializers.SerializerMethodField()
    sku_variant_name = serializers.ReadOnlyField(source="sku_variant.name")
    sku_variant_code = serializers.ReadOnlyField(source="sku_variant.code")
    repeat_source_order_number = serializers.ReadOnlyField(source="repeat_source_item.sales_order.order_number")

    class Meta:
        model = SalesOrderItem
        fields = [
            "id",
            "template",
            "template_name",
            "template_status",
            "qty_value",
            "qty_uom",
            "unit_weight_g",
            "total_weight_kg",
            "line_name",
            "price_basis",
            "unit_price",
            "sku_variant",
            "sku_variant_name",
            "sku_variant_code",
            "repeat_source_item",
            "repeat_source_order_number",
            "artwork_assignment_required",
            "assigned_artwork",
            "geometry_snapshot",
            "layer_snapshot",
            "printing_snapshot",
            "addons_snapshot",
            "packaging_snapshot",
            "bom_snapshot",
            "routing_assigned",
            "has_stock_claims",
            "claimed_stock_order_nos",
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
    status_display = serializers.ReadOnlyField(source="get_status_display")
    can_confirm = serializers.SerializerMethodField()
    block_reasons = serializers.SerializerMethodField()
    total_value = serializers.SerializerMethodField()

    class Meta:
        model = SalesOrder
        fields = [
            "id",
            "order_number",
            "order_name",
            "customer_name",
            "order_type",
            "status",
            "status_display",
            "execution_model_version",
            "total_weight_kg",
            "total_value",
            "delivery_date",
            "geometry_override",
            "commercial_confirmed_at",
            "items",
            "items_data",
            "can_confirm",
            "block_reasons",
            "created_at",
        ]
        read_only_fields = ["status", "created_at", "total_weight_kg", "commercial_confirmed_at", "execution_model_version"]

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
        items_data = validated_data.pop("items_data", [])
        order = SalesOrder.objects.create(**validated_data)
        for item in items_data:
            template_id = item.get("template")
            template = TemplateBlueprint.objects.get(id=template_id)
            price_basis = str(item.get("price_basis", "KG") or "KG").upper()
            if price_basis not in {"KG", "PCS"}:
                raise serializers.ValidationError({"items_data": "price_basis must be KG or PCS."})
            unit_price = Decimal(str(item.get("unit_price", 0) or 0))
            if unit_price <= 0:
                raise serializers.ValidationError({"items_data": "unit_price must be greater than zero."})
            SalesOrderItem.objects.create(
                sales_order=order,
                template=template,
                sku_variant_id=item.get("sku_variant"),
                repeat_source_item_id=item.get("repeat_source_item"),
                line_name=item.get("line_name", ""),
                qty_value=item.get("qty_value", item.get("ordered_qty", 0)),
                qty_uom=item.get("qty_uom", item.get("uom", "KG")),
                price_basis=price_basis,
                unit_price=unit_price,
                packaging_snapshot=_normalize_packaging_snapshot(item.get("packaging_snapshot") or {}),
            )
        return order
