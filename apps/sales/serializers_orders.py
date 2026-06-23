from decimal import Decimal, ROUND_HALF_UP

from rest_framework import serializers

from apps.materials.models import InventoryMaterial
from apps.physics.geometry_override import validate_pouch_geometry_contract
from apps.templates.models import TemplateBlueprint

from .models import CustomerProductOverlay, SalesOrder, SalesOrderItem, SalesSku, SalesSkuVariant
from .services.order_block_resolver import resolve_block_reasons
from .services.order_service import SalesOrderService, _normalize_packaging_snapshot


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
    product_master_name = serializers.ReadOnlyField(source="product_master.name")
    product_master_code = serializers.ReadOnlyField(source="product_master.code")
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
            "product_master",
            "product_master_name",
            "product_master_code",
            "axis_values_template",
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
            "product_master_name",
            "product_master_code",
            "customer_usage_count",
            "customer_last_used_at",
            "created_at",
            "updated_at",
        ]

    def validate_template(self, value):
        if str(getattr(value, "status", "") or "").upper() != "LIVE" or not bool(getattr(value, "is_current_version", False)):
            raise serializers.ValidationError("Sales SKU must link to the current LIVE template.")
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
    product_master = serializers.ReadOnlyField(source="product_master_id")
    product_master_code = serializers.ReadOnlyField(source="product_master.code")
    product_master_name = serializers.ReadOnlyField(source="product_master.name")
    product_variant = serializers.ReadOnlyField(source="product_variant_id")
    customer_product_overlay = serializers.ReadOnlyField(source="customer_product_overlay_id")
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
            "product_master",
            "product_master_code",
            "product_master_name",
            "product_variant",
            "customer_product_overlay",
            "line_name",
            "qty_value",
            "qty_uom",
            "price_basis",
            "unit_price",
            "axis_values",
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
    line_status_display = serializers.ReadOnlyField(source="get_line_status_display")
    qty_dispatched = serializers.SerializerMethodField()
    qty_open = serializers.SerializerMethodField()
    qty_final_output = serializers.SerializerMethodField()
    qty_dispatchable = serializers.SerializerMethodField()
    qty_replan_remaining = serializers.SerializerMethodField()
    qty_closed_without_dispatch = serializers.SerializerMethodField()
    routing_assigned = serializers.SerializerMethodField()
    has_stock_claims = serializers.SerializerMethodField()
    claimed_stock_order_nos = serializers.SerializerMethodField()
    production_batch_summary = serializers.SerializerMethodField()
    artwork_preview = serializers.SerializerMethodField()
    sku_variant_name = serializers.ReadOnlyField(source="sku_variant.name")
    sku_variant_code = serializers.ReadOnlyField(source="sku_variant.code")
    product_variant = serializers.ReadOnlyField(source="product_variant_id")
    product_variant_code = serializers.ReadOnlyField(source="product_variant.code")
    product_master_name = serializers.ReadOnlyField(source="product_master.name")
    product_master_code = serializers.ReadOnlyField(source="product_master.code")
    customer_product_overlay_name = serializers.ReadOnlyField(source="customer_product_overlay.customer_display_name")
    customer_item_code = serializers.ReadOnlyField(source="customer_product_overlay.customer_item_code")
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
            "line_status",
            "line_status_display",
            "qty_dispatched",
            "qty_open",
            "qty_final_output",
            "qty_dispatchable",
            "qty_replan_remaining",
            "qty_cancelled",
            "qty_short_closed",
            "qty_closed_without_dispatch",
            "line_closed_reason",
            "line_closed_at",
            "product_master",
            "product_master_name",
            "product_master_code",
            "product_variant",
            "product_variant_code",
            "axis_values",
            "customer_product_overlay",
            "customer_product_overlay_name",
            "customer_item_code",
            "sku_variant",
            "sku_variant_name",
            "sku_variant_code",
            "repeat_source_item",
            "repeat_source_order_number",
            "artwork_assignment_required",
            "assigned_artwork",
            "artwork_preview",
            "geometry_snapshot",
            "layer_snapshot",
            "printing_snapshot",
            "addons_snapshot",
            "packaging_snapshot",
            "bom_snapshot",
            "routing_assigned",
            "has_stock_claims",
            "claimed_stock_order_nos",
            "production_batch_summary",
        ]

    def get_qty_dispatched(self, obj):
        return obj.qty_dispatched

    def get_qty_open(self, obj):
        return obj.qty_open

    def get_qty_final_output(self, obj):
        if str(getattr(obj, "line_status", "") or "").upper() != "PARTIAL":
            return Decimal("0")
        return SalesOrderService.line_final_output_qty(obj)

    def get_qty_dispatchable(self, obj):
        return SalesOrderService.line_dispatchable_qty(obj)

    def get_qty_replan_remaining(self, obj):
        return SalesOrderService.line_replan_remaining_qty(obj)

    def get_qty_closed_without_dispatch(self, obj):
        return obj.qty_closed_without_dispatch

    def _absolute_media_url(self, url):
        if not url:
            return ""
        request = self.context.get("request") if hasattr(self, "context") else None
        if request is not None:
            return request.build_absolute_uri(url)
        return url

    def get_artwork_preview(self, obj):
        artwork = getattr(obj, "assigned_artwork", None)
        printing = obj.printing_snapshot if isinstance(obj.printing_snapshot, dict) else {}
        if artwork is None and not printing.get("artwork_id") and not printing.get("artwork_design_code"):
            return None

        image_url = ""
        if artwork is not None:
            image = getattr(artwork, "image", None)
            if image:
                try:
                    image_url = image.url
                except Exception:
                    image_url = ""
            if not image_url:
                first_image = None
                images = getattr(artwork, "images", None)
                if images is not None:
                    try:
                        first_image = images.first()
                    except Exception:
                        first_image = None
                if first_image is not None and getattr(first_image, "image", None):
                    try:
                        image_url = first_image.image.url
                    except Exception:
                        image_url = ""

        raw_color_count = (
            getattr(artwork, "colors_count", 0)
            or printing.get("colors_count")
            or printing.get("front_colors_count")
            or 0
        )
        try:
            color_count = int(Decimal(str(raw_color_count)))
        except Exception:
            color_count = 0

        return {
            "artwork_id": str(getattr(artwork, "id", "") or printing.get("artwork_id") or ""),
            "design_code": str(getattr(artwork, "design_code", "") or printing.get("artwork_design_code") or ""),
            "name": str(getattr(artwork, "name", "") or printing.get("artwork_name") or ""),
            "thumbnail_url": self._absolute_media_url(image_url),
            "color_count": color_count,
        }

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

    def get_production_batch_summary(self, obj):
        from apps.production.services.batch_route_service import BatchExecutionService

        return BatchExecutionService.line_summary(obj)


class SalesOrderSerializer(serializers.ModelSerializer):
    items = SalesOrderItemSerializer(many=True, read_only=True)
    items_data = serializers.JSONField(write_only=True, required=False)
    status_display = serializers.ReadOnlyField(source="get_status_display")
    can_confirm = serializers.SerializerMethodField()
    block_reasons = serializers.SerializerMethodField()
    total_value = serializers.SerializerMethodField()
    item_summary = serializers.SerializerMethodField()
    qty_summary = serializers.SerializerMethodField()
    fulfillment_summary = serializers.SerializerMethodField()

    class Meta:
        model = SalesOrder
        fields = [
            "id",
            "order_number",
            "order_name",
            "customer",
            "customer_name",
            "ship_to_customer",
            "ship_to_customer_name",
            "address_override",
            "remarks",
            "order_type",
            "status",
            "status_display",
            "execution_model_version",
            "total_weight_kg",
            "total_value",
            "delivery_date",
            "geometry_override",
            "commercial_confirmed_at",
            "item_summary",
            "qty_summary",
            "fulfillment_summary",
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

    def _order_items(self, obj):
        return list(obj.items.all())

    def _first_item(self, obj):
        items = self._order_items(obj)
        return items[0] if items else None

    def _geometry_size_label(self, item):
        geometry = item.geometry_snapshot if isinstance(item.geometry_snapshot, dict) else {}
        base = geometry.get("base") if isinstance(geometry.get("base"), dict) else {}
        fg_type = str(geometry.get("finished_good_type") or getattr(item.template, "fg_type", "POUCH") or "POUCH").upper()
        if fg_type == "ROLL":
            return str(geometry.get("roll_form") or "FLAT").upper()
        width = base.get("width_mm") or geometry.get("width_mm") or 0
        height = base.get("height_mm") or geometry.get("height_mm") or 0
        return f"{width} x {height}"

    def _material_cache(self):
        cache = getattr(self, "_inventory_material_cache", None)
        if cache is None:
            cache = {}
            setattr(self, "_inventory_material_cache", cache)
        return cache

    def _get_material(self, material_id):
        if not material_id:
            return None
        key = str(material_id)
        cache = self._material_cache()
        if key not in cache:
            cache[key] = InventoryMaterial.objects.filter(id=key).first()
        return cache.get(key)

    def _layer_labels(self, item):
        labels = []
        for index, layer in enumerate(item.layer_snapshot or []):
            if not isinstance(layer, dict):
                continue
            material = self._get_material(layer.get("variant_id")) or self._get_material(layer.get("family_id"))
            code = str(getattr(material, "code", "") or layer.get("code") or layer.get("variant_code") or layer.get("family_code") or "").strip()
            name = str(getattr(material, "name", "") or layer.get("name") or layer.get("variant_name") or layer.get("family_name") or "").strip()
            if code and name and name.upper() != code.upper():
                labels.append(f"{code} · {name}")
            elif code:
                labels.append(code)
            elif name:
                labels.append(name)
            else:
                labels.append(f"Layer {index + 1}")
        return labels

    def _packaging_summary(self, item):
        packaging = item.packaging_snapshot if isinstance(item.packaging_snapshot, dict) else {}
        primary = packaging.get("primary_inner_pack") if isinstance(packaging.get("primary_inner_pack"), dict) else {}
        pod = packaging.get("pod") if isinstance(packaging.get("pod"), dict) else {}
        roll_dispatch = packaging.get("roll_dispatch_pack") if isinstance(packaging.get("roll_dispatch_pack"), dict) else {}
        parts = []

        if bool(primary.get("enabled")):
            material = self._get_material(primary.get("material_id"))
            material_label = str(getattr(material, "code", "") or getattr(material, "name", "") or "Pack").strip()
            pcs_per_pack = int(Decimal(str(primary.get("pcs_per_pack") or 0))) if primary.get("pcs_per_pack") not in (None, "") else 0
            if pcs_per_pack > 0:
                parts.append(f"{material_label} {pcs_per_pack} pcs/pack" if material_label and material_label != "Pack" else f"{pcs_per_pack} pcs/pack")
            else:
                parts.append(material_label)

        if bool(pod.get("enabled")):
            pod_label = str(pod.get("pod_sku_code") or pod.get("pod_sku_name") or "POD").strip()
            parts.append(f"POD {pod_label}" if pod_label and pod_label.upper() != "POD" else "POD enabled")

        if bool(roll_dispatch.get("enabled")):
            line_parts = []
            for line in (roll_dispatch.get("lines") or [])[:3]:
                if not isinstance(line, dict):
                    continue
                material = self._get_material(line.get("material_id"))
                material_label = str(getattr(material, "code", "") or getattr(material, "name", "") or "Sheet").strip()
                qty = Decimal(str(line.get("qty") or 0))
                uom = str(line.get("uom") or "PCS").upper()
                if qty > 0:
                    line_parts.append(f"{material_label} {qty.normalize()} {uom}/roll")
                else:
                    line_parts.append(f"{material_label} actual at packing")
            if line_parts:
                parts.extend(line_parts)

        return " · ".join(parts) if parts else "Standard pack"

    def _printing_summary(self, item):
        printing = item.printing_snapshot if isinstance(item.printing_snapshot, dict) else {}
        if not printing.get("enabled"):
            return "No print"
        print_type = str(printing.get("type") or "PRINT").upper()
        front = int(printing.get("front_colors_count") or 0)
        back = int(printing.get("back_colors_count") or 0)
        return f"{print_type} F{front}/B{back}"

    def _item_unit_weight_g(self, item):
        return Decimal(str(getattr(item, "unit_weight_g", 0) or 0))

    def _item_ordered_pcs(self, item):
        geometry = item.geometry_snapshot if isinstance(item.geometry_snapshot, dict) else {}
        fg_type = str(geometry.get("finished_good_type") or getattr(item.template, "fg_type", "POUCH") or "POUCH").upper()
        if fg_type == "ROLL":
            return None
        qty_uom = str(getattr(item, "qty_uom", "") or "").upper()
        qty_value = Decimal(str(getattr(item, "qty_value", 0) or 0))
        if qty_uom == "PCS":
            return qty_value
        unit_weight_g = self._item_unit_weight_g(item)
        if qty_uom == "KG" and unit_weight_g > 0:
            return (qty_value * Decimal("1000")) / unit_weight_g
        return None

    def _kg_to_pcs(self, item, value_kg):
        unit_weight_g = self._item_unit_weight_g(item)
        if unit_weight_g <= 0:
            return None
        qty_kg = Decimal(str(value_kg or 0))
        if qty_kg <= 0:
            return Decimal("0")
        return ((qty_kg * Decimal("1000")) / unit_weight_g).quantize(Decimal("1"), rounding=ROUND_HALF_UP)

    def get_item_summary(self, obj):
        items = self._order_items(obj)
        if not items:
            return {
                "line_count": 0,
                "claimed_stock_order_nos": [],
                "spec_facets": {},
            }
        item = items[0]
        packaging = item.packaging_snapshot if isinstance(item.packaging_snapshot, dict) else {}
        pod = packaging.get("pod") if isinstance(packaging.get("pod"), dict) else {}
        geometry = item.geometry_snapshot if isinstance(item.geometry_snapshot, dict) else {}
        fg_type = str(geometry.get("finished_good_type") or getattr(item.template, "fg_type", "POUCH") or "POUCH").upper()
        claimed_stock_order_nos = sorted(
            {
                str(source_no).strip()
                for row in items
                for source_no in SalesOrderItemSerializer().get_claimed_stock_order_nos(row)
                if str(source_no).strip()
            }
        )
        from apps.materials.product_spec import build_product_spec

        product_spec = build_product_spec(
            geometry=item.geometry_snapshot if isinstance(item.geometry_snapshot, dict) else {},
            layers=item.layer_snapshot or [],
            printing=item.printing_snapshot if isinstance(item.printing_snapshot, dict) else {},
            addons=item.addons_snapshot or [],
            packaging=packaging,
            customer_name=str(getattr(obj, "customer_name", "") or ""),
            order_number=str(getattr(obj, "order_number", "") or ""),
            product_name=str(getattr(item, "line_name", "") or ""),
            template_name=str(getattr(item.template, "name", "") or ""),
            variant_code=str(getattr(item.sku_variant, "code", "") or ""),
            variant_name=str(getattr(item.sku_variant, "name", "") or ""),
            qty_value=getattr(item, "qty_value", None),
            qty_uom=str(getattr(item, "qty_uom", "") or ""),
        )
        return {
            "variant_code": str(getattr(item.sku_variant, "code", "") or ""),
            "variant_name": str(getattr(item.sku_variant, "name", "") or ""),
            "template_name": str(getattr(item.template, "name", "") or ""),
            "template_tag": f"TPL {str(getattr(item.template, 'name', '') or '').strip()}".strip(),
            "finished_good_type": fg_type,
            "size_or_form": self._geometry_size_label(item),
            "layer_count": len(item.layer_snapshot or []),
            "layer_labels": self._layer_labels(item),
            "printing_summary": self._printing_summary(item),
            "pod_enabled": bool(pod.get("enabled", False)),
            "packaging_summary": self._packaging_summary(item),
            "addons_count": len(item.addons_snapshot or []),
            "claimed_stock_order_nos": claimed_stock_order_nos,
            "line_count": len(items),
            "unit_weight_g": float(Decimal(str(getattr(item, "unit_weight_g", 0) or 0))),
            "spec_facets": product_spec,
            "layers": product_spec.get("layers", []),
            "size": product_spec.get("size", {}),
            "pod_labels": product_spec.get("pod_labels", []),
            "addon_labels": product_spec.get("addon_labels", []),
            "search_text": product_spec.get("search_text", ""),
        }

    def get_qty_summary(self, obj):
        items = self._order_items(obj)
        ordered_kg = Decimal("0")
        ordered_pcs = Decimal("0")
        has_pcs = False
        for item in items:
            ordered_kg += Decimal(str(getattr(item, "total_weight_kg", 0) or 0))
            derived_pcs = self._item_ordered_pcs(item)
            if derived_pcs is not None:
                has_pcs = True
                ordered_pcs += derived_pcs
        return {
            "ordered_kg": float(ordered_kg),
            "ordered_pcs": float(ordered_pcs) if has_pcs else None,
        }

    def get_fulfillment_summary(self, obj):
        items = self._order_items(obj)
        ordered = self.get_qty_summary(obj)
        produced_kg = Decimal("0")
        dispatched_kg = Decimal("0")
        produced_pcs = Decimal("0")
        dispatched_pcs = Decimal("0")

        for item in items:
            item_produced_kg = Decimal("0")
            item_dispatched_kg = Decimal("0")
            item_produced_pcs = Decimal("0")
            item_dispatched_pcs = Decimal("0")
            rolls = [
                roll
                for roll in item.inventory_rolls.all()
                if not bool(((getattr(roll, "meta_json", None) or {}).get("is_internal_stock")))
            ]
            batches = [
                batch
                for batch in item.fg_batches.all()
                if not bool(((getattr(batch, "meta_json", None) or {}).get("is_internal_stock")))
            ]
            packing_units = list(item.packing_units.all())

            item_produced_kg += sum((Decimal(str(getattr(roll, "weight_kg", 0) or 0)) for roll in rolls), Decimal("0"))
            item_dispatched_kg += sum(
                (
                    Decimal(str(getattr(roll, "weight_kg", 0) or 0))
                    for roll in rolls
                    if str(getattr(roll, "status", "") or "").upper() in {"IN_TRANSIT", "CONSUMED"}
                ),
                Decimal("0"),
            )

            item_produced_kg += sum((Decimal(str(getattr(batch, "qty_kg", 0) or 0)) for batch in batches), Decimal("0"))
            item_produced_pcs += sum((Decimal(str(getattr(batch, "qty_pcs", 0) or 0)) for batch in batches), Decimal("0"))

            item_produced_kg += sum(
                (
                    Decimal(
                        str(
                            getattr(pack, "net_product_weight_kg", None)
                            or getattr(pack, "weight_kg", 0)
                            or 0
                        )
                    )
                    for pack in packing_units
                ),
                Decimal("0"),
            )
            item_produced_pcs += sum((Decimal(str(getattr(pack, "qty_pcs", 0) or 0)) for pack in packing_units), Decimal("0"))

            item_dispatched_kg += sum(
                (
                    Decimal(
                        str(
                            getattr(pack, "net_product_weight_kg", None)
                            or getattr(pack, "weight_kg", 0)
                            or 0
                        )
                    )
                    for pack in packing_units
                    if str(getattr(pack, "status", "") or "").upper() == "DISPATCHED"
                ),
                Decimal("0"),
            )
            item_dispatched_pcs += sum(
                (
                    Decimal(str(getattr(pack, "qty_pcs", 0) or 0))
                    for pack in packing_units
                    if str(getattr(pack, "status", "") or "").upper() == "DISPATCHED"
                ),
                Decimal("0"),
            )

            produced_kg += item_produced_kg
            dispatched_kg += item_dispatched_kg

            ordered_item_pcs = self._item_ordered_pcs(item)
            if ordered_item_pcs is not None:
                derived_produced_pcs = self._kg_to_pcs(item, item_produced_kg)
                derived_dispatched_pcs = self._kg_to_pcs(item, item_dispatched_kg)
                produced_pcs += item_produced_pcs if item_produced_pcs > 0 else (derived_produced_pcs or Decimal("0"))
                dispatched_pcs += item_dispatched_pcs if item_dispatched_pcs > 0 else (derived_dispatched_pcs or Decimal("0"))

        ordered_kg = Decimal(str(ordered.get("ordered_kg") or 0))
        ordered_pcs = Decimal(str(ordered.get("ordered_pcs") or 0)) if ordered.get("ordered_pcs") is not None else None
        remaining_kg = ordered_kg - dispatched_kg
        if remaining_kg < 0:
            remaining_kg = Decimal("0")
        remaining_pcs = None
        if ordered_pcs is not None:
            remaining_pcs = ordered_pcs - dispatched_pcs
            if remaining_pcs < 0:
                remaining_pcs = Decimal("0")

        if ordered_pcs is not None and ordered_pcs > 0:
            completion_percent = float((dispatched_pcs / ordered_pcs) * Decimal("100"))
        elif ordered_kg > 0:
            completion_percent = float((dispatched_kg / ordered_kg) * Decimal("100"))
        else:
            completion_percent = 0.0

        return {
            "produced_kg": float(produced_kg),
            "dispatched_kg": float(dispatched_kg),
            "remaining_kg": float(remaining_kg),
            "produced_pcs": float(produced_pcs) if ordered_pcs is not None else None,
            "dispatched_pcs": float(dispatched_pcs) if ordered_pcs is not None else None,
            "remaining_pcs": float(remaining_pcs) if remaining_pcs is not None else None,
            "completion_percent": max(0.0, min(100.0, completion_percent)),
        }

    def create(self, validated_data):
        items_data = validated_data.pop("items_data", [])
        order = SalesOrder.objects.create(**validated_data)
        for item in items_data:
            template_id = item.get("template")
            template = TemplateBlueprint.objects.get(id=template_id, status="LIVE", is_current_version=True)
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


class SalesOrderListSerializer(SalesOrderSerializer):
    """
    Compact serializer for high-traffic order list screens.

    Detail pages still use SalesOrderSerializer and include full line snapshots.
    List screens only need order identity, first-line summary, quantities, and
    coarse progress, so avoid returning the large items array.
    """

    class Meta(SalesOrderSerializer.Meta):
        fields = [
            "id",
            "order_number",
            "order_name",
            "customer",
            "customer_name",
            "ship_to_customer",
            "ship_to_customer_name",
            "order_type",
            "status",
            "status_display",
            "execution_model_version",
            "total_weight_kg",
            "total_value",
            "delivery_date",
            "commercial_confirmed_at",
            "item_summary",
            "qty_summary",
            "fulfillment_summary",
            "created_at",
        ]

    def _decimal_float(self, value):
        if value in (None, ""):
            return None
        try:
            return float(Decimal(str(value)))
        except Exception:
            return None

    def _snapshot_layer_rows(self, item):
        rows = []
        for index, layer in enumerate((item.layer_snapshot or [])[:4]):
            if not isinstance(layer, dict):
                continue
            code = str(layer.get("variant_code") or layer.get("material_code") or layer.get("family_code") or layer.get("code") or "").strip()
            name = str(layer.get("variant_name") or layer.get("material_name") or layer.get("family_name") or layer.get("name") or "").strip()
            thickness = layer.get("thickness_micron") or layer.get("thickness")
            width = layer.get("roll_width_mm") or layer.get("width_mm") or layer.get("width")
            label_parts = [f"L{index + 1}", code or name]
            if thickness not in (None, ""):
                label_parts.append(f"{thickness}u")
            if width not in (None, ""):
                label_parts.append(f"{width}mm")
            label = " · ".join(str(part) for part in label_parts if str(part or "").strip())
            rows.append({
                "label": label,
                "code": code,
                "name": name,
                "thickness_micron": thickness,
                "width_mm": width,
            })
        return rows

    def get_item_summary(self, obj):
        items = self._order_items(obj)
        if not items:
            return {
                "line_count": 0,
                "claimed_stock_order_nos": [],
                "spec_facets": {},
            }

        item = items[0]
        geometry = item.geometry_snapshot if isinstance(item.geometry_snapshot, dict) else {}
        base = geometry.get("base") if isinstance(geometry.get("base"), dict) else {}
        packaging = item.packaging_snapshot if isinstance(item.packaging_snapshot, dict) else {}
        pod = packaging.get("pod") if isinstance(packaging.get("pod"), dict) else {}
        fg_type = str(geometry.get("finished_good_type") or getattr(item.template, "fg_type", "POUCH") or "POUCH").upper()
        width = base.get("width_mm") or geometry.get("width_mm")
        height = base.get("height_mm") or geometry.get("height_mm")
        size = {
            "widthMm": self._decimal_float(width),
            "heightMm": self._decimal_float(height),
            "label": self._geometry_size_label(item),
        }
        layers = self._snapshot_layer_rows(item)
        addon_labels = [
            str(row.get("label") or row.get("name") or row.get("code") or "").strip()
            for row in (item.addons_snapshot or [])[:4]
            if isinstance(row, dict) and str(row.get("label") or row.get("name") or row.get("code") or "").strip()
        ]
        pod_label = str(pod.get("pod_sku_code") or pod.get("pod_sku_name") or "").strip()
        variant_code = str(getattr(item.sku_variant, "code", "") or "")
        variant_name = str(getattr(item.sku_variant, "name", "") or "")
        template_name = str(getattr(item.template, "name", "") or "")
        search_text = " ".join(
            part
            for part in [
                str(getattr(obj, "order_number", "") or ""),
                str(getattr(obj, "customer_name", "") or ""),
                str(getattr(item, "line_name", "") or ""),
                variant_code,
                variant_name,
                template_name,
                size.get("label") or "",
                " ".join(row.get("label", "") for row in layers),
            ]
            if part
        )
        spec_facets = {
            "qty_uom": str(getattr(item, "qty_uom", "") or ""),
            "size": size,
            "layers": layers,
        }
        return {
            "variant_code": variant_code,
            "variant_name": variant_name,
            "template_name": template_name,
            "template_tag": f"TPL {template_name}".strip(),
            "finished_good_type": fg_type,
            "size_or_form": self._geometry_size_label(item),
            "layer_count": len(item.layer_snapshot or []),
            "layer_labels": [row.get("label", "") for row in layers],
            "printing_summary": self._printing_summary(item),
            "pod_enabled": bool(pod.get("enabled", False)),
            "packaging_summary": "POD enabled" if bool(pod.get("enabled", False)) else "Standard pack",
            "addons_count": len(item.addons_snapshot or []),
            "claimed_stock_order_nos": [],
            "line_count": len(items),
            "unit_weight_g": self._decimal_float(getattr(item, "unit_weight_g", 0)) or 0.0,
            "spec_facets": spec_facets,
            "layers": layers,
            "size": size,
            "pod_labels": [pod_label] if pod_label else [],
            "addon_labels": addon_labels,
            "search_text": search_text,
        }

    def get_fulfillment_summary(self, obj):
        ordered = self.get_qty_summary(obj)
        ordered_kg = Decimal(str(ordered.get("ordered_kg") or 0))
        ordered_pcs = Decimal(str(ordered.get("ordered_pcs") or 0)) if ordered.get("ordered_pcs") is not None else None
        status_value = str(getattr(obj, "status", "") or "").upper()

        produced_kg = Decimal("0")
        dispatched_kg = Decimal("0")
        produced_pcs = Decimal("0")
        dispatched_pcs = Decimal("0")

        if status_value == "COMPLETED":
            produced_kg = ordered_kg
            dispatched_kg = ordered_kg
            if ordered_pcs is not None:
                produced_pcs = ordered_pcs
                dispatched_pcs = ordered_pcs
        elif status_value in {"PACKING_READY", "DISPATCH_READY"}:
            produced_kg = ordered_kg
            if ordered_pcs is not None:
                produced_pcs = ordered_pcs

        remaining_kg = max(ordered_kg - dispatched_kg, Decimal("0"))
        remaining_pcs = None
        if ordered_pcs is not None:
            remaining_pcs = max(ordered_pcs - dispatched_pcs, Decimal("0"))

        if ordered_pcs is not None and ordered_pcs > 0:
            completion_percent = float((dispatched_pcs / ordered_pcs) * Decimal("100"))
        elif ordered_kg > 0:
            completion_percent = float((dispatched_kg / ordered_kg) * Decimal("100"))
        else:
            completion_percent = 0.0

        return {
            "produced_kg": float(produced_kg),
            "dispatched_kg": float(dispatched_kg),
            "remaining_kg": float(remaining_kg),
            "produced_pcs": float(produced_pcs) if ordered_pcs is not None else None,
            "dispatched_pcs": float(dispatched_pcs) if ordered_pcs is not None else None,
            "remaining_pcs": float(remaining_pcs) if remaining_pcs is not None else None,
            "completion_percent": max(0.0, min(100.0, completion_percent)),
            "list_estimate": True,
        }
