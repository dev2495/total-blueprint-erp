from rest_framework import serializers
from django.utils.text import slugify
from .models import CommercialFamily, GranuleQualityCode, InventoryMaterial, MaterialCodeAlias, PodSku, PodSkuVariant, PouchStyleMaster, ProductMaster, ProductMasterSize, ProductVariant, WebWidthPolicy
from .chemistry_defaults import normalize_product_master_chemistry_defaults
from .naming import normalize_code
from .stock_forms import normalize_slit_policy, normalize_stock_form, normalize_width_basis
from apps.inventory.models import InkMaterial
from apps.recipes.qty_formula import evaluate_qty_formula
from apps.recipes.models import RecipeGrade
from apps.sales.models import CustomerProductOverlay
from django.core.exceptions import ValidationError as DjangoValidationError
import uuid
import hashlib
import json

GLOBAL_PRODUCT_LAYER_AXES = {"thickness_um", "thickness_micron", "grade", "grade_id"}
LAYER_THICKNESS_AXIS_KEYS = {"layer_thicknesses", "layer_thickness", "thickness_by_layer", "per_layer_thickness"}
LAYER_GRADE_AXIS_KEYS = {"layer_grades", "layer_grade", "grade_by_layer", "per_layer_grade"}
CATALOG_AXIS_SOURCES = {"pod_sku_variant", "packaging_material", "addon"}
LAYER_MATERIAL_AXIS_KEYS = {
    "layer_material_overrides",
    "layer_materials",
    "film_variant_by_layer",
    "layer_film_variants",
    "material_by_layer",
}
LAYER_MATERIAL_AXIS_TYPES = {
    "layer_material_enum",
    "per_layer_material_enum",
    "layer_film_variant_enum",
    "per_layer_film_variant_enum",
}
LAYER_MATERIAL_OPTION_KEYS = {
    "allowed_film_variant_codes",
    "alternate_film_variant_codes",
    "allowed_alternate_film_variant_codes",
    "allowed_material_codes",
    "alternate_material_codes",
    "material_options",
    "film_variant_options",
}
ROUTE_ROTO_TOKENS = ("ROTO", "ROTOGRAVURE", "GRAVURE")
ROUTE_FLEXO_TOKENS = ("FLEXO", "FLEXOGRAPHIC")


def _template_route_print_type(template):
    route = getattr(template, "routing_rule", None)
    if route is None:
        return ""
    process_codes = list(getattr(route, "ordered_processes", None) or [])
    if not process_codes:
        return ""
    fragments = [str(code or "") for code in process_codes]
    try:
        from apps.factory.models import Process

        for process in Process.objects.filter(code__in=process_codes).only("code", "name"):
            fragments.extend([process.code, process.name])
    except Exception:
        pass
    route_text = " ".join(fragments).upper()
    has_roto = any(token in route_text for token in ROUTE_ROTO_TOKENS)
    has_flexo = any(token in route_text for token in ROUTE_FLEXO_TOKENS)
    if has_roto and has_flexo:
        return "MIXED"
    if has_roto:
        return "ROTO"
    if has_flexo:
        return "FLEXO"
    return ""


def _ensure_live_current_template(template, field_name="template"):
    if not template:
        return
    if str(getattr(template, "status", "") or "").upper() != "LIVE" or not bool(getattr(template, "is_current_version", False)):
        raise serializers.ValidationError({field_name: "Select the current LIVE template. Draft, disabled, and superseded templates cannot be linked."})


def _product_master_physical_fg_type(product_kind, packaging_kind=None):
    normalized = str(product_kind or "").upper()
    pack_kind = str(packaging_kind or "").upper()
    if normalized in {"ROLL", "POD"}:
        return "ROLL"
    if normalized == "PACKAGING" and pack_kind == "SHEET":
        return "ROLL"
    return "POUCH"


def _material_codes_from_options(value):
    if value in (None, ""):
        return set()
    if isinstance(value, dict):
        code = value.get("code") or value.get("material_code") or value.get("film_variant_code") or value.get("value")
        if code:
            return {str(code).strip()}
        codes = set()
        for nested in value.values():
            codes.update(_material_codes_from_options(nested))
        return codes
    if isinstance(value, (list, tuple, set)):
        codes = set()
        for item in value:
            codes.update(_material_codes_from_options(item))
        return codes
    return {str(value).strip()} if str(value).strip() else set()


def _layer_allowed_material_codes(row):
    codes = set()
    for key in LAYER_MATERIAL_OPTION_KEYS:
        if isinstance(row, dict) and row.get(key) not in (None, ""):
            codes.update(_material_codes_from_options(row.get(key)))
    return codes


def _catalog_default_exists(source, default_value, filters=None):
    if not default_value:
        return True
    filters = filters if isinstance(filters, dict) else {}
    ref = str(default_value).strip()
    if source == "pod_sku_variant":
        return PodSkuVariant.objects.filter(code__iexact=ref, active=True).exists()
    if source == "packaging_material":
        queryset = InventoryMaterial.objects.filter(code__iexact=ref, category="PACKAGING", status="ACTIVE")
        packaging_kind = filters.get("packaging_kind")
        if packaging_kind:
            if isinstance(packaging_kind, (list, tuple, set)):
                queryset = queryset.filter(packaging_kind__in=[str(kind).upper() for kind in packaging_kind if str(kind).strip()])
            else:
                queryset = queryset.filter(packaging_kind=str(packaging_kind).upper())
        return queryset.exists()
    if source == "addon":
        return InventoryMaterial.objects.filter(code__iexact=ref, category="ADDON", status="ACTIVE").exists()
    return False


def _missing_film_variant_codes(codes):
    missing = []
    for code in sorted({str(item or "").strip() for item in (codes or []) if str(item or "").strip()}):
        if not _resolve_film_variant(code):
            missing.append(code)
    return missing


def _resolve_film_variant(code=None, material_id=None):
    """Resolve current code first, then a persisted former-code alias."""
    material = (
        InventoryMaterial.objects.filter(id=material_id, category="FILM_VARIANT").first()
        if material_id
        else None
    )
    if material:
        return material
    ref = str(code or "").strip()
    if not ref:
        return None
    material = InventoryMaterial.objects.filter(code__iexact=ref, category="FILM_VARIANT").first()
    if material:
        return material
    alias = (
        MaterialCodeAlias.objects.select_related("material")
        .filter(alias__iexact=ref, category="FILM_VARIANT", active=True, material__status="ACTIVE")
        .first()
    )
    return alias.material if alias else None


def _canonical_material_option(value):
    if isinstance(value, dict):
        cleaned = dict(value)
        for key in ("code", "material_code", "film_variant_code", "value"):
            if cleaned.get(key):
                material = _resolve_film_variant(cleaned.get(key))
                if material:
                    cleaned[key] = material.code
                    break
        return cleaned
    material = _resolve_film_variant(value)
    return material.code if material else value


def _canonicalize_layer_material_options(row):
    """Persist aliases as canonical codes once a Product Master is saved."""
    for key in LAYER_MATERIAL_OPTION_KEYS:
        value = row.get(key) if isinstance(row, dict) else None
        if isinstance(value, list):
            row[key] = [_canonical_material_option(item) for item in value]
        elif isinstance(value, tuple):
            row[key] = [_canonical_material_option(item) for item in value]
        elif isinstance(value, dict):
            row[key] = {item_key: _canonical_material_option(item) for item_key, item in value.items()}
        elif value not in (None, ""):
            row[key] = _canonical_material_option(value)


def _grade_name_exists(name):
    if not str(name or "").strip():
        return False
    return RecipeGrade.objects.filter(name__iexact=str(name).strip(), is_active=True).exists()


def _normalize_grade_options(value):
    if value in (None, ""):
        return []
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    if isinstance(value, (list, tuple, set)):
        return [str(item).strip() for item in value if str(item).strip()]
    return [str(value).strip()] if str(value).strip() else []


def _normalize_thickness_options(value, default_thickness):
    options = []
    if value not in (None, ""):
        source = value if isinstance(value, (list, tuple, set)) else [value]
        for item in source:
            try:
                option = float(item)
            except Exception as exc:
                raise serializers.ValidationError({"layer_template": "Layer thickness options must be numeric."}) from exc
            if option <= 0:
                raise serializers.ValidationError({"layer_template": "Layer thickness options must be greater than zero."})
            options.append(option)
    if default_thickness not in (None, ""):
        options.append(float(default_thickness))
    return sorted({round(option, 3) for option in options if option > 0})


def _axis_names(variant_axes):
    if not isinstance(variant_axes, list):
        return set()
    return {str((axis or {}).get("axis") or "").strip() for axis in variant_axes if isinstance(axis, dict)}


def _is_layer_setup_pending(row):
    if not isinstance(row, dict):
        return False
    return bool(
        row.get("setup_pending")
        or row.get("material_setup_pending")
        or row.get("layer_setup_pending")
    )


def _next_product_master_code(base_code, *, instance=None):
    normalized = normalize_code(base_code, max_length=80)
    if not normalized:
        raise serializers.ValidationError("Product Master code is required.")

    queryset = ProductMaster.objects.all()
    if instance is not None and getattr(instance, "pk", None):
        queryset = queryset.exclude(pk=instance.pk)
    if not queryset.filter(code__iexact=normalized).exists():
        return normalized

    for suffix in range(2, 10000):
        marker = f"-{suffix}"
        root = normalize_code(normalized, max_length=80 - len(marker))
        candidate = f"{root}{marker}"
        if not queryset.filter(code__iexact=candidate).exists():
            return candidate
    raise serializers.ValidationError("Unable to allocate a unique Product Master code.")


class InventoryMaterialLiteSerializer(serializers.ModelSerializer):
    class Meta:
        model = InventoryMaterial
        fields = ['id', 'code', 'name', 'category', 'base_uom', 'status']


def _product_master_link_summary(obj):
    variant = getattr(obj, "produced_by_product_variant", None)
    if not variant:
        return None
    master = getattr(variant, "master", None)
    if not master:
        return None
    return {
        "variant_id": str(variant.id),
        "variant_code": variant.code,
        "master_id": str(master.id),
        "master_code": master.code,
        "master_name": master.name,
        "product_kind": master.product_kind,
        "packaging_kind": master.packaging_kind,
    }


class CommercialFamilySerializer(serializers.ModelSerializer):
    class Meta:
        model = CommercialFamily
        fields = [
            'id',
            'code',
            'name',
            'default_form',
            'default_reporting_group',
            'active',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate_code(self, value):
        return normalize_code(value, max_length=50)


class ProductMasterSerializer(serializers.ModelSerializer):
    display_code = serializers.SerializerMethodField()
    default_template_name = serializers.CharField(source='default_template.name', read_only=True, allow_null=True)
    template_name = serializers.CharField(source='template.name', read_only=True, allow_null=True)
    commercial_family_name = serializers.CharField(source='commercial_family.name', read_only=True, allow_null=True)
    overlay_count = serializers.IntegerField(read_only=True, default=0)
    overlays_count = serializers.SerializerMethodField()
    sizes_count = serializers.SerializerMethodField()
    variants_count = serializers.SerializerMethodField()
    catalog_links_count = serializers.SerializerMethodField()
    default_reporting_group = serializers.ChoiceField(
        choices=CommercialFamily.REPORTING_GROUP_CHOICES,
        required=False,
        allow_blank=True,
        default="FG",
    )

    class Meta:
        model = ProductMaster
        fields = [
            'id',
            'code',
            'display_code',
            'name',
            'version_group',
            'version',
            'is_current_version',
            'superseded_by',
            'product_kind',
            'packaging_kind',
            'default_template',
            'default_template_name',
            'template',
            'template_name',
            'extrusion_recipe',
            'commercial_family',
            'commercial_family_name',
            'default_reporting_group',
            'reusable_policy',
            'canonical_layer_stack',
            'layer_template',
            'variant_axes',
            'fixed_attributes',
            'invariant_signature',
            'description',
            'active',
            'overlay_count',
            'overlays_count',
            'sizes_count',
            'variants_count',
            'catalog_links_count',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'display_code',
            'version_group',
            'version',
            'is_current_version',
            'superseded_by',
            'default_template_name',
            'template_name',
            'commercial_family_name',
            'overlay_count',
            'overlays_count',
            'sizes_count',
            'variants_count',
            'catalog_links_count',
            'created_at',
            'updated_at',
        ]
        extra_kwargs = {
            'code': {'validators': []},
        }

    def get_overlays_count(self, obj):
        annotated = getattr(obj, "overlay_count", None)
        if annotated is not None:
            return annotated
        return obj.customer_overlays.count()

    def get_display_code(self, obj):
        return str(getattr(obj, "version_group", "") or ProductMaster.version_root_from_code(obj.code))

    def to_representation(self, instance):
        """Keep internal revision mechanics out of normal user-facing APIs."""
        data = super().to_representation(instance)
        data["code"] = data.get("display_code") or data.get("code")
        for field in ("version_group", "version", "is_current_version", "superseded_by"):
            data.pop(field, None)
        return data

    def get_sizes_count(self, obj):
        return obj.sizes.count()

    def get_variants_count(self, obj):
        return obj.variants.count()

    def get_catalog_links_count(self, obj):
        annotated = getattr(obj, "catalog_links_count", None)
        if annotated is not None:
            return annotated
        product_kind = str(getattr(obj, "product_kind", "") or "").upper()
        if product_kind not in {"PACKAGING", "POD"}:
            return 0
        return InventoryMaterial.objects.filter(
            category=product_kind,
            status="ACTIVE",
            produced_by_product_variant__master=obj,
            produced_by_product_variant__active=True,
        ).count()

    def validate_code(self, value):
        normalized = normalize_code(value, max_length=80)
        if self.instance is None:
            return _next_product_master_code(normalized)
        if not normalized:
            raise serializers.ValidationError("Product Master code is required.")
        if normalized != self.instance.code:
            raise serializers.ValidationError(
                "Product Master code is an internal immutable identity. Change the customer-facing name, not the code."
            )
        if (
            ProductMaster.objects.exclude(pk=self.instance.pk)
            .filter(code__iexact=normalized)
            .exists()
        ):
            raise serializers.ValidationError("Product Master code already exists.")
        return normalized

    def validate_default_reporting_group(self, value):
        return value or "FG"

    def validate(self, attrs):
        template = attrs.get("template") or getattr(self.instance, "template", None)
        default_template = attrs.get("default_template") or getattr(self.instance, "default_template", None)
        if not template and default_template:
            attrs["template"] = default_template
            template = default_template
        if not default_template and template:
            attrs["default_template"] = template
            default_template = template
        _ensure_live_current_template(template, "template")
        _ensure_live_current_template(default_template, "default_template")
        if not attrs.get("layer_template") and attrs.get("canonical_layer_stack"):
            attrs["layer_template"] = attrs.get("canonical_layer_stack")
        if not attrs.get("canonical_layer_stack") and attrs.get("layer_template"):
            attrs["canonical_layer_stack"] = attrs.get("layer_template")
        product_kind = str(attrs.get("product_kind") or getattr(self.instance, "product_kind", "POUCH") or "POUCH").upper()
        raw_packaging_kind = attrs.get("packaging_kind") if "packaging_kind" in attrs else getattr(self.instance, "packaging_kind", None)
        packaging_kind = str(raw_packaging_kind or "").upper()
        fixed_attributes_supplied = "fixed_attributes" in attrs
        existing_fixed_attributes = getattr(self.instance, "fixed_attributes", None) if self.instance else None
        fixed_payload_source = attrs.get("fixed_attributes") if fixed_attributes_supplied else existing_fixed_attributes
        fixed_payload = fixed_payload_source if isinstance(fixed_payload_source, dict) else {}
        fixed_fg_hint = str(fixed_payload.get("fg_type") or "").upper()
        if product_kind == "PACKAGING":
            if packaging_kind not in {"INNER_POUCH", "SHEET"}:
                packaging_kind = "SHEET" if fixed_fg_hint == "ROLL" else "INNER_POUCH"
            attrs["packaging_kind"] = packaging_kind
        else:
            packaging_kind = None
            attrs["packaging_kind"] = None
        fixed_attributes = fixed_payload_source
        should_write_fixed_attributes = fixed_attributes_supplied or self.instance is None or "product_kind" in attrs or "packaging_kind" in attrs
        physical_fg_type = _product_master_physical_fg_type(product_kind, packaging_kind)
        if not fixed_attributes:
            if should_write_fixed_attributes:
                attrs["fixed_attributes"] = {"fg_type": physical_fg_type, "print_capable": True}
        elif isinstance(fixed_attributes, dict):
            fixed = dict(fixed_attributes)
            raw_fg_type = str(fixed.get("fg_type") or "").upper()
            if raw_fg_type not in {"POUCH", "ROLL"} or product_kind in {"ROLL", "POD", "PACKAGING"}:
                fixed["fg_type"] = physical_fg_type
            if should_write_fixed_attributes or fixed != fixed_attributes:
                attrs["fixed_attributes"] = fixed
        layer_template = attrs.get("layer_template")
        if layer_template is None and self.instance:
            layer_template = getattr(self.instance, "layer_template", None)
        variant_axes_for_layers = attrs.get("variant_axes")
        if variant_axes_for_layers is None and self.instance:
            variant_axes_for_layers = getattr(self.instance, "variant_axes", None)
        axis_names_for_layers = _axis_names(variant_axes_for_layers)
        has_layer_thickness_axis = bool(axis_names_for_layers & LAYER_THICKNESS_AXIS_KEYS)
        has_layer_grade_axis = bool(axis_names_for_layers & LAYER_GRADE_AXIS_KEYS)
        is_active_after_save = attrs.get("active", getattr(self.instance, "active", True))
        if isinstance(layer_template, list):
            for index, row in enumerate(layer_template):
                if not isinstance(row, dict):
                    raise serializers.ValidationError({"layer_template": f"Layer {index + 1} must be an object."})
                material_id = row.get("film_variant_id") or row.get("material_id")
                material_code = row.get("film_variant_code") or row.get("material_code") or row.get("code") or row.get("layer") or row.get("name")
                material = _resolve_film_variant(material_code, material_id)
                if not material:
                    if _is_layer_setup_pending(row):
                        if is_active_after_save:
                            raise serializers.ValidationError({"layer_template": f"Layer {index + 1} must select a valid film variant before the Product Master is active."})
                        row["film_variant_id"] = None
                        row["film_variant_code"] = ""
                        row["thickness_micron"] = 0
                        row["thickness_options"] = []
                        row["default_grade"] = ""
                        row["grade_options"] = []
                        row["grade_apportion"] = "variable" if has_layer_grade_axis else "fixed"
                        continue
                    raise serializers.ValidationError({"layer_template": f"Layer {index + 1} must select a valid film variant."})
                row.pop("setup_pending", None)
                row.pop("material_setup_pending", None)
                row.pop("layer_setup_pending", None)
                row["film_variant_id"] = str(material.id)
                row["film_variant_code"] = material.code
                _canonicalize_layer_material_options(row)
                raw_thickness = row.get("thickness_micron", row.get("thickness_um"))
                if raw_thickness in (None, ""):
                    if not has_layer_thickness_axis:
                        raise serializers.ValidationError({"layer_template": f"Layer {index + 1} thickness_micron is required unless thickness is a per-layer axis."})
                    thickness = 0
                else:
                    try:
                        thickness = float(raw_thickness)
                    except Exception as exc:
                        raise serializers.ValidationError({"layer_template": f"Layer {index + 1} thickness must be numeric."}) from exc
                    if thickness <= 0 and has_layer_thickness_axis:
                        thickness = 0
                    elif thickness <= 0:
                        raise serializers.ValidationError({"layer_template": f"Layer {index + 1} thickness must be greater than zero."})
                row["thickness_micron"] = thickness
                row["thickness_options"] = _normalize_thickness_options(row.get("thickness_options"), thickness if thickness > 0 else None)
                grade = row.get("default_grade") or row.get("grade_name") or row.get("grade")
                can_skip_grade = bool(material and material.is_purchasable and not material.is_extrudable)
                if can_skip_grade:
                    row["default_grade"] = ""
                    row["grade_options"] = []
                    row["grade_apportion"] = "fixed"
                elif not str(grade or "").strip():
                    if not has_layer_grade_axis:
                        raise serializers.ValidationError({"layer_template": f"Layer {index + 1} grade is required unless the selected film variant is purchasable-only or grade is a per-layer axis."})
                    options = _normalize_grade_options(row.get("grade_options"))
                    invalid_grades = [option for option in options if not _grade_name_exists(option)]
                    if invalid_grades:
                        raise serializers.ValidationError({"layer_template": f"Layer {index + 1} has invalid grade options: {', '.join(invalid_grades)}."})
                    row["default_grade"] = ""
                    row["grade_options"] = list(dict.fromkeys(options))
                else:
                    grade = str(grade).strip()
                    if not _grade_name_exists(grade):
                        raise serializers.ValidationError({"layer_template": f"Layer {index + 1} grade must come from the grade master."})
                    options = _normalize_grade_options(row.get("grade_options"))
                    if grade not in options:
                        options.insert(0, grade)
                    invalid_grades = [option for option in options if not _grade_name_exists(option)]
                    if invalid_grades:
                        raise serializers.ValidationError({"layer_template": f"Layer {index + 1} has invalid grade options: {', '.join(invalid_grades)}."})
                    row["default_grade"] = grade
                    row["grade_options"] = list(dict.fromkeys(options))
                if not can_skip_grade:
                    raw_grade_mode = str(row.get("grade_apportion") or row.get("grade_mode") or "").strip().lower()
                    if raw_grade_mode == "variable" or has_layer_grade_axis or (not raw_grade_mode and len(row.get("grade_options") or []) >= 2):
                        row["grade_apportion"] = "variable"
                    else:
                        row["grade_apportion"] = "fixed"
                        if row.get("default_grade"):
                            row["grade_options"] = [row["default_grade"]]
                raw_share = row.get("thickness_share", row.get("percent_of_total"))
                if raw_share not in (None, ""):
                    try:
                        share = float(raw_share)
                    except Exception as exc:
                        raise serializers.ValidationError({"layer_template": f"Layer {index + 1} share must be numeric."}) from exc
                    if share < 0:
                        raise serializers.ValidationError({"layer_template": f"Layer {index + 1} share cannot be negative."})
                alternate_codes = _layer_allowed_material_codes(row)
                if alternate_codes:
                    missing = _missing_film_variant_codes(alternate_codes)
                    if missing:
                        raise serializers.ValidationError(
                            {"layer_template": f"Layer {index + 1} alternate film variants are invalid: {', '.join(missing)}."}
                        )
        try:
            attrs["fixed_attributes"] = normalize_product_master_chemistry_defaults(
                attrs.get("fixed_attributes") or getattr(self.instance, "fixed_attributes", {}),
                layer_template=layer_template,
            )
        except DjangoValidationError as exc:
            raise serializers.ValidationError(getattr(exc, "message_dict", None) or getattr(exc, "messages", None) or str(exc)) from exc
        normalized_fixed = attrs.get("fixed_attributes") if isinstance(attrs.get("fixed_attributes"), dict) else {}
        if bool(normalized_fixed.get("print_capable")):
            declared_print_type = str(
                normalized_fixed.get("print_type")
                or normalized_fixed.get("printing_type")
                or normalized_fixed.get("method")
                or ""
            ).strip().upper()
            route_print_type = _template_route_print_type(template)
            if route_print_type == "MIXED":
                raise serializers.ValidationError(
                    {
                        "template": (
                            "Route template contains both FLEXO and ROTO print steps. "
                            "Use one print-bearing route per Product Master."
                        )
                    }
                )
            if declared_print_type and route_print_type and declared_print_type != route_print_type:
                raise serializers.ValidationError(
                    {
                        "fixed_attributes": (
                            f"Allowed print method {declared_print_type} does not match "
                            f"route template printing step {route_print_type}."
                        )
                    }
                )
        variant_axes = attrs.get("variant_axes")
        if variant_axes is None and self.instance:
            variant_axes = getattr(self.instance, "variant_axes", None)
        if isinstance(variant_axes, list):
            layer_rows = [row for row in (layer_template or []) if isinstance(row, dict)]
            layer_allowed_codes = set()
            for row in layer_rows:
                layer_allowed_codes.update(_layer_allowed_material_codes(row))
            forbidden = [
                str((axis or {}).get("axis") or "")
                for axis in variant_axes
                if isinstance(axis, dict) and str((axis or {}).get("axis") or "") in GLOBAL_PRODUCT_LAYER_AXES
            ]
            if forbidden:
                raise serializers.ValidationError({"variant_axes": f"Global thickness/grade axes are not valid: {', '.join(forbidden)}. Use layer_thicknesses/layer_grades or layer defaults."})
            for axis in variant_axes:
                if not isinstance(axis, dict):
                    continue
                key = str(axis.get("axis") or "").strip()
                axis_type = str(axis.get("type") or "").strip()
                catalog_source = axis.get("master_data_source")
                if catalog_source:
                    catalog_source = str(catalog_source).strip()
                    if catalog_source not in CATALOG_AXIS_SOURCES:
                        raise serializers.ValidationError(
                            {"variant_axes": f"{key or 'Catalog axis'} uses unsupported master_data_source '{catalog_source}'."}
                        )
                    if not key:
                        raise serializers.ValidationError({"variant_axes": "Catalog-backed axes require an axis name."})
                    if axis_type and axis_type not in {"catalog_ref", "packaging_ref", "pod_ref", "enum", "multi_enum"}:
                        raise serializers.ValidationError(
                            {"variant_axes": f"{key} must use catalog_ref, packaging_ref, pod_ref, enum, or multi_enum type."}
                        )
                    formula = axis.get("qty_formula")
                    if formula not in (None, ""):
                        try:
                            evaluate_qty_formula(
                                formula,
                                {
                                    "fixed_qty": 1,
                                    "pcs_per_inner": 24,
                                    "total_kg": 1,
                                    "total_pouches": 100,
                                    "total_pcs": 100,
                                },
                            )
                        except Exception as exc:
                            raise serializers.ValidationError(
                                {"variant_axes": f"{key} has invalid qty_formula: {exc}"}
                            ) from exc
                    qty_per_pcs = axis.get("qty_per_pcs")
                    if qty_per_pcs not in (None, ""):
                        try:
                            if float(qty_per_pcs) < 0:
                                raise ValueError("must be non-negative")
                        except Exception as exc:
                            raise serializers.ValidationError({"variant_axes": f"{key} qty_per_pcs must be non-negative numeric."}) from exc
                    if not _catalog_default_exists(catalog_source, axis.get("default_value"), axis.get("master_data_filter")):
                        raise serializers.ValidationError(
                            {"variant_axes": f"{key} default_value '{axis.get('default_value')}' was not found in {catalog_source}."}
                        )
                if key not in LAYER_MATERIAL_AXIS_KEYS and axis_type not in LAYER_MATERIAL_AXIS_TYPES:
                    continue
                axis_options = axis.get("options") or axis.get("allowed") or axis.get("allowed_by_layer")
                option_codes = _material_codes_from_options(axis_options)
                scoped_option_codes = _material_codes_from_options(axis_options) if isinstance(axis_options, dict) else set()
                allowed_codes = layer_allowed_codes | scoped_option_codes
                if not allowed_codes:
                    raise serializers.ValidationError(
                        {
                            "variant_axes": (
                                "Layer material override axes require approved alternates on the layer row or axis options. "
                                "Product Master layers are fixed by default."
                            )
                        }
                    )
                validate_codes = layer_allowed_codes | option_codes
                missing = _missing_film_variant_codes(validate_codes)
                if missing:
                    raise serializers.ValidationError(
                        {"variant_axes": f"Layer material override options are invalid film variants: {', '.join(missing)}."}
                    )
        if not attrs.get("invariant_signature"):
            seed = {
                "template": str(getattr(attrs.get("template") or getattr(self.instance, "template", None), "id", "") or ""),
                "layer_template": attrs.get("layer_template") or getattr(self.instance, "layer_template", []),
                "variant_axes": attrs.get("variant_axes") or getattr(self.instance, "variant_axes", []),
                "fixed_attributes": attrs.get("fixed_attributes") or getattr(self.instance, "fixed_attributes", {}),
            }
            attrs["invariant_signature"] = hashlib.sha256(
                json.dumps(seed, sort_keys=True, default=str, separators=(",", ":")).encode("utf-8")
            ).hexdigest()[:64]
        return attrs


class ProductVariantSerializer(serializers.ModelSerializer):
    master_code = serializers.CharField(source='master.code', read_only=True)
    master_name = serializers.CharField(source='master.name', read_only=True)
    # ── ProductMaster ↔ InventoryMaterial bridge ──────────────────────
    # For PACKAGING + POD masters the variant is linked manually to an
    # existing fixed catalog SKU. These fields surface that linkage so the PM
    # detail UI can show "this variant -> SKU X · Y pcs in stock" without a
    # second roundtrip.
    inventory_link = serializers.SerializerMethodField()

    class Meta:
        model = ProductVariant
        fields = [
            'id',
            'master',
            'master_code',
            'master_name',
            'code',
            'axis_values',
            'geometry_snapshot',
            'layer_snapshot',
            'bom_signature',
            'active',
            'inventory_link',
            'created_at',
        ]
        read_only_fields = ['id', 'master_code', 'master_name', 'inventory_link', 'created_at']

    def get_inventory_link(self, obj):
        # Cheap path — InventoryMaterial.produced_by_product_variant has a
        # related_name='inventory_links'. We take the first ACTIVE row
        # (there should be exactly one for the new model). Stock total is
        # summed across all PackagingStock rows for that material.
        link = obj.inventory_links.filter(status='ACTIVE').only('id', 'code', 'name', 'category', 'packaging_kind', 'base_uom').first()
        if not link:
            return None
        try:
            from apps.inventory.models import PackagingStock
            from django.db.models import Sum
            agg = PackagingStock.objects.filter(material_id=link.id).aggregate(total=Sum('qty'))
            stock_qty = float(agg['total'] or 0)
        except Exception:
            stock_qty = 0.0
        pod_sku_variant = None
        if str(link.category or "").upper() == "POD":
            pod_sku_variant = (
                PodSkuVariant.objects.select_related("pod_sku")
                .filter(material_id=link.id, active=True)
                .order_by("pod_sku__code", "code")
                .first()
            )
        return {
            'id': str(link.id),
            'code': link.code,
            'name': link.name or '',
            'category': link.category,
            'packaging_kind': link.packaging_kind or '',
            'base_uom': link.base_uom,
            'stock_qty': stock_qty,
            'pod_sku_variant_id': str(pod_sku_variant.id) if pod_sku_variant else None,
            'pod_sku_variant_code': pod_sku_variant.code if pod_sku_variant else None,
            'pod_sku_code': pod_sku_variant.pod_sku.code if pod_sku_variant else None,
        }


class ProductMasterSizeSerializer(serializers.ModelSerializer):
    product_master_code = serializers.SerializerMethodField()
    product_master_name = serializers.CharField(source="product_master.name", read_only=True)
    pouch_style_master_code = serializers.SerializerMethodField()
    pouch_style_roll_axis = serializers.SerializerMethodField()

    GEOMETRY_KEYS = {
        "trim_loss_mm",
        "trim_apply_to",
        "flap_tape_mm",
        "gusset_apply_to",
        "gusset_factor",
        "adjustments",
        "multipliers",
        "pouch_style",
        "roll_form",
        "stock_form",
        "width_basis",
        "film_area_width_mm",
        "slit_policy",
    }

    class Meta:
        model = ProductMasterSize
        fields = [
            "id",
            "product_master",
            "product_master_code",
            "product_master_name",
            "code",
            "label",
            "width_mm",
            "height_mm",
            "gusset_mm",
            "roll_width_mm",
            "thickness_micron",
            "standard_qty",
            "qty_uom",
            "geometry_config",
            "notes",
            "active",
            "sort_order",
            "pouch_style_master",
            "pouch_style_master_code",
            "pouch_style_roll_axis",
            "pouch_style_version",
            "child_target_width_mm",
            "child_target_override",
            "stock_form",
            "width_basis",
            "film_area_width_mm",
            "slit_policy",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "product_master_code", "product_master_name", "created_at", "updated_at"]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        geometry = data.get("geometry_config") if isinstance(data.get("geometry_config"), dict) else {}
        if geometry:
            geometry = dict(geometry)
            multipliers = geometry.get("multipliers")
            if isinstance(multipliers, dict):
                cleaned = {key: value for key, value in multipliers.items() if str(key).lower() != "faces"}
                if cleaned:
                    geometry["multipliers"] = cleaned
                else:
                    geometry.pop("multipliers", None)
                data["geometry_config"] = geometry
        for key in self.GEOMETRY_KEYS - {"multipliers"}:
            if key in geometry:
                data[key] = geometry.get(key)
        return data

    def get_pouch_style_master_code(self, obj):
        style = getattr(obj, "pouch_style_master", None)
        return getattr(style, "code", "") or ""

    def get_product_master_code(self, obj):
        master = getattr(obj, "product_master", None)
        return str(getattr(master, "version_group", "") or ProductMaster.version_root_from_code(getattr(master, "code", "")))

    def get_pouch_style_roll_axis(self, obj):
        style = getattr(obj, "pouch_style_master", None)
        return getattr(style, "default_roll_axis", "") or ""

    def to_internal_value(self, data):
        if isinstance(data, dict):
            data = data.copy()
            geometry = data.get("geometry_config") if isinstance(data.get("geometry_config"), dict) else {}
            geometry = dict(geometry)
            legacy = data.pop("default_packing", None)
            if isinstance(legacy, dict):
                nested = legacy.get("geometry")
                if isinstance(nested, dict):
                    geometry.update(nested)
                else:
                    geometry.update({key: legacy[key] for key in self.GEOMETRY_KEYS if key in legacy})
            for key in self.GEOMETRY_KEYS - {"multipliers"}:
                if key in data:
                    geometry[key] = data.pop(key)
            if "faces" in data:
                data.pop("faces")
            if "multipliers" in data and isinstance(data.get("multipliers"), dict):
                multipliers = geometry.get("multipliers") if isinstance(geometry.get("multipliers"), dict) else {}
                incoming = {key: value for key, value in data.pop("multipliers").items() if str(key).lower() != "faces"}
                merged = {**multipliers, **incoming}
                merged = {key: value for key, value in merged.items() if str(key).lower() != "faces"}
                if merged:
                    geometry["multipliers"] = merged
                else:
                    geometry.pop("multipliers", None)
            if geometry:
                data["geometry_config"] = geometry
        return super().to_internal_value(data)

    def validate_code(self, value):
        return normalize_code(value, max_length=80)

    def _value_from_attrs_or_instance(self, attrs, field):
        if field in attrs:
            return attrs.get(field)
        if self.instance is not None:
            return getattr(self.instance, field, None)
        return None

    def _formula_inputs(self, attrs, style):
        geometry = self._value_from_attrs_or_instance(attrs, "geometry_config")
        if not isinstance(geometry, dict):
            geometry = {}
        custom_inputs = geometry.get("pouch_formula_inputs") if isinstance(geometry.get("pouch_formula_inputs"), dict) else {}

        width = self._value_from_attrs_or_instance(attrs, "width_mm")
        height = self._value_from_attrs_or_instance(attrs, "height_mm")
        gusset = self._value_from_attrs_or_instance(attrs, "gusset_mm")
        child_target = self._value_from_attrs_or_instance(attrs, "child_target_width_mm")

        inputs = {}
        if width not in (None, ""):
            inputs["W"] = width
            inputs["width"] = width
            inputs["width_mm"] = width
        if height not in (None, ""):
            inputs["H"] = height
            inputs["height"] = height
            inputs["height_mm"] = height
        if gusset not in (None, ""):
            inputs["G"] = gusset
            inputs["gusset"] = gusset
            inputs["gusset_mm"] = gusset
        flap = geometry.get("flap_tape_mm")
        if flap not in (None, ""):
            inputs["flap"] = flap
            inputs["flap_mm"] = flap
        if child_target not in (None, ""):
            inputs["override_width"] = child_target

        inputs.update({str(k): v for k, v in custom_inputs.items() if v not in (None, "")})

        allowed = style.allowed_fields if isinstance(style.allowed_fields, dict) else {}
        for key, definition in allowed.items():
            if key in inputs:
                continue
            if isinstance(definition, dict) and definition.get("default") not in (None, ""):
                inputs[key] = definition.get("default")
        return inputs

    def _apply_pouch_style_target(self, attrs):
        style = attrs.get("pouch_style_master")
        if "pouch_style_master" in attrs and style is None:
            return attrs
        if style is None and self.instance is not None:
            style = self.instance.pouch_style_master
        if not style:
            return attrs

        override = attrs.get("child_target_override")
        if override is None and self.instance is not None:
            override = bool(getattr(self.instance, "child_target_override", False))
        if bool(override):
            return attrs

        try:
            from .services_pouch_style import compute_stock_geometry

            stock_form = attrs.get("stock_form")
            if stock_form in (None, "") and self.instance is not None:
                stock_form = getattr(self.instance, "stock_form", None)
            geometry = compute_stock_geometry(style, self._formula_inputs(attrs, style), stock_form=stock_form)
        except Exception as exc:
            raise serializers.ValidationError({"pouch_style_master": f"Could not compute child target width: {exc}"}) from exc
        value = geometry.get("child_target_width_mm")
        if value and value > 0:
            attrs["child_target_width_mm"] = value
            attrs["stock_form"] = geometry.get("stock_form") or attrs.get("stock_form")
            attrs["width_basis"] = geometry.get("width_basis") or attrs.get("width_basis")
            attrs["film_area_width_mm"] = geometry.get("film_area_width_mm")
            attrs["slit_policy"] = geometry.get("slit_policy") or attrs.get("slit_policy")
            attrs["pouch_style_version"] = getattr(style, "version", 1) or 1
        return attrs

    def validate(self, attrs):
        attrs = super().validate(attrs)
        style = attrs.get("pouch_style_master")
        if style is not None:
            existing_style_id = getattr(self.instance, "pouch_style_master_id", None) if self.instance is not None else None
            style_changed = str(existing_style_id or "") != str(getattr(style, "id", "") or "")
            if style_changed and (not getattr(style, "locked", False) or getattr(style, "deprecated", False)):
                raise serializers.ValidationError(
                    {
                        "pouch_style_master": (
                            "Only approved and locked pouch styles can be used on product sizes. "
                            "Approve the draft style first."
                        )
                    }
                )
        if "stock_form" in attrs:
            attrs["stock_form"] = normalize_stock_form(attrs.get("stock_form"))
        if "width_basis" in attrs or "stock_form" in attrs:
            stock_form = attrs.get("stock_form")
            if stock_form in (None, "") and self.instance is not None:
                stock_form = getattr(self.instance, "stock_form", None)
            attrs["width_basis"] = normalize_width_basis(attrs.get("width_basis"), stock_form=stock_form)
        if "slit_policy" in attrs or "stock_form" in attrs:
            stock_form = attrs.get("stock_form")
            if stock_form in (None, "") and self.instance is not None:
                stock_form = getattr(self.instance, "stock_form", None)
            attrs["slit_policy"] = normalize_slit_policy(attrs.get("slit_policy"), stock_form=stock_form)
        return self._apply_pouch_style_target(attrs)


class CustomerProductOverlaySerializer(serializers.ModelSerializer):
    product_master_name = serializers.CharField(source='product_master.name', read_only=True)
    product_master_code = serializers.CharField(source='product_master.code', read_only=True)
    customer_name = serializers.CharField(source='customer.name', read_only=True)
    customer_code = serializers.CharField(source='customer.code', read_only=True)
    default_artwork_design_code = serializers.CharField(source='default_artwork.design_code', read_only=True, allow_null=True)

    class Meta:
        model = CustomerProductOverlay
        fields = [
            'id',
            'product_master',
            'product_master_name',
            'product_master_code',
            'customer',
            'customer_name',
            'customer_code',
            'size_variant_code',
            'axis_values',
            'customer_item_code',
            'customer_display_name',
            'default_packing_note',
            'default_packing_recipe',
            'default_price_basis',
            'moq_kg',
            'default_artwork',
            'default_artwork_design_code',
            'notes',
            'margin_floor_pct',
            'active',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'product_master_name',
            'product_master_code',
            'customer_name',
            'customer_code',
            'default_artwork_design_code',
            'created_at',
            'updated_at',
        ]

class InventoryMaterialSerializer(serializers.ModelSerializer):
    category_display = serializers.CharField(source='get_category_display', read_only=True)
    commercial_family_name = serializers.CharField(source='commercial_family.name', read_only=True, allow_null=True)
    product_master_link = serializers.SerializerMethodField()

    class Meta:
        model = InventoryMaterial
        fields = [
            'id', 'code', 'name', 'category', 'category_display', 
            'base_uom', 'status', 'is_extrudable', 'is_purchasable',
            'packaging_kind', 'packaging_supply_mode', 'per_sheet_base_qty',
            'weight_mode', 'weight_value', 'addon_is_purchased', 'addon_purchase_uom',
            'packaging_defaults_json', 'production_template',
            'commercial_family', 'commercial_family_name',
            'product_master_link',
        ]

    def get_product_master_link(self, obj):
        return _product_master_link_summary(obj)

    def validate_code(self, value):
        return normalize_code(value, max_length=100)

    def update(self, instance, validated_data):
        old_code = str(instance.code or "")
        updated = super().update(instance, validated_data)
        if old_code and old_code != updated.code:
            MaterialCodeAlias.objects.update_or_create(
                alias=old_code,
                defaults={
                    "material": updated,
                    "category": updated.category,
                    "active": True,
                    "notes": "Automatically retained when material code changed.",
                },
            )
        return updated

class FilmFamilySerializer(serializers.ModelSerializer):
    commercial_family_name = serializers.CharField(source='commercial_family.name', read_only=True, allow_null=True)
    class Meta:
        model = InventoryMaterial
        fields = ['id', 'name', 'density_gcm3', 'status', 'created_at', 'commercial_family', 'commercial_family_name']
        read_only_fields = ['id', 'created_at']
    
    def create(self, validated_data):
        name = validated_data.get('name', '')
        # Auto-generate code if not provided (Film families usually don't need manual codes)
        validated_data['code'] = f"{slugify(name)}-{str(uuid.uuid4())[:8]}"
        validated_data['category'] = 'FILM_FAMILY'
        validated_data['base_uom'] = 'KG' # Default
        validated_data['is_purchasable'] = True
        validated_data['is_extrudable'] = False
        return super().create(validated_data)

class FilmVariantSerializer(serializers.ModelSerializer):
    parent_family_name = serializers.CharField(source='parent_family.name', read_only=True)
    grade_name = serializers.CharField(source='grade.name', read_only=True)
    commercial_family_name = serializers.CharField(source='commercial_family.name', read_only=True, allow_null=True)

    class Meta:
        model = InventoryMaterial
        fields = [
            'id', 'code', 'name', 'parent_family', 'parent_family_name',
            'grade', 'grade_name', 'is_extrudable', 'is_purchasable',
            'is_sellable', 'default_gst_pct',
            'status', 'created_at', 'commercial_family', 'commercial_family_name'
        ]
        read_only_fields = ['id', 'created_at']

    def validate(self, attrs):
        # Grade is a transaction-level physical spec: sales/order layer, GRN roll,
        # produced roll, and recipe selector own it. The variant master remains
        # a reusable material identity such as Milky, Metalized, or Transparent.
        attrs['grade'] = None
        return attrs

    def validate_code(self, value):
        return normalize_code(value, max_length=100)

    def create(self, validated_data):
        validated_data['category'] = 'FILM_VARIANT'
        # variants usually use same UOM as family or specific? Assuming KG for film
        validated_data['base_uom'] = 'KG' 
        return super().create(validated_data)

    def update(self, instance, validated_data):
        old_code = str(instance.code or "")
        updated = super().update(instance, validated_data)
        if old_code and old_code != updated.code:
            MaterialCodeAlias.objects.update_or_create(
                alias=old_code,
                defaults={
                    "material": updated,
                    "category": updated.category,
                    "active": True,
                    "notes": "Automatically retained when film variant code changed.",
                },
            )
        return updated

class GranuleQualityCodeSerializer(serializers.ModelSerializer):
    granule_name = serializers.CharField(source="granule.name", read_only=True)
    granule_material_code = serializers.CharField(source="granule.code", read_only=True)

    class Meta:
        model = GranuleQualityCode
        fields = [
            "id",
            "granule",
            "granule_name",
            "granule_material_code",
            "code",
            "status",
            "notes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "granule_name", "granule_material_code"]

    def validate_code(self, value):
        value = str(value or "").strip().upper()
        if not value:
            raise serializers.ValidationError("Quality code is required.")
        return value

    def validate(self, attrs):
        granule = attrs.get("granule") or getattr(self.instance, "granule", None)
        if granule and str(getattr(granule, "category", "") or "").upper() != "GRANULE":
            raise serializers.ValidationError({"granule": "Quality code can only be attached to a granule."})
        return attrs


class GranuleSerializer(serializers.ModelSerializer):
    quality_codes = GranuleQualityCodeSerializer(many=True, read_only=True)
    quality_code_count = serializers.SerializerMethodField()

    class Meta:
        model = InventoryMaterial
        fields = ['id', 'code', 'name', 'status', 'created_at', 'quality_codes', 'quality_code_count',
                  'is_sellable', 'default_gst_pct']
        read_only_fields = ['id', 'created_at']

    def get_quality_code_count(self, obj):
        return obj.quality_codes.count()

    def create(self, validated_data):
        validated_data['category'] = 'GRANULE'
        validated_data['base_uom'] = 'KG'
        return super().create(validated_data)

class InkSerializer(serializers.ModelSerializer):
    name = serializers.CharField(required=False, allow_blank=True)
    
    class Meta:
        model = InkMaterial
        fields = [
            'id',
            'code',
            'name',
            'base_type',
            'color_name',
            'swatch_hex',
            'is_mix',
            'mix_family',
            'mix_notes',
            'status',
            'created_at',
        ]
        read_only_fields = ['id', 'code', 'created_at']

    def validate_color_name(self, value):
        return value.upper().strip()

    def validate_swatch_hex(self, value):
        cleaned = str(value or "").strip().upper()
        if not cleaned:
            return ""
        import re

        if not re.fullmatch(r"#[0-9A-F]{6}", cleaned):
            raise serializers.ValidationError("Use a valid #RRGGBB color.")
        return cleaned

    def create(self, validated_data):
        # InkMaterial.save() handles category='INK' and code/name generation
        # We just need to ensure standard permissions
        return super().create(validated_data)

class AdhesiveSolventSerializer(serializers.ModelSerializer):
    class Meta:
        model = InventoryMaterial
        fields = ['id', 'code', 'name', 'category', 'status', 'created_at']
        read_only_fields = ['id', 'created_at']

    def validate_category(self, value):
        if value not in ['ADHESIVE', 'SOLVENT']:
            raise serializers.ValidationError("Category must be ADHESIVE or SOLVENT")
        return value

    def create(self, validated_data):
        validated_data['base_uom'] = 'KG'
        return super().create(validated_data)

class AddonSerializer(serializers.ModelSerializer):
    class Meta:
        model = InventoryMaterial
        fields = [
            'id', 'code', 'name', 'weight_mode', 'weight_value',
            'is_purchasable', 'addon_is_purchased', 'addon_purchase_uom', 'base_uom',
            'status', 'created_at',
        ]
        read_only_fields = ['id', 'created_at']

    def validate(self, attrs):
        if 'is_purchasable' in attrs:
            attrs['addon_is_purchased'] = bool(attrs.get('is_purchasable'))
        purchased = attrs.get('addon_is_purchased', getattr(self.instance, 'addon_is_purchased', False))
        attrs['is_purchasable'] = bool(purchased)
        try:
            purchase_uom = InventoryMaterial.normalize_master_uom(
                attrs.get('addon_purchase_uom', getattr(self.instance, 'addon_purchase_uom', 'KG')) or 'KG'
            )
        except DjangoValidationError as exc:
            raise serializers.ValidationError({'addon_purchase_uom': str(exc)}) from exc
        attrs['addon_purchase_uom'] = purchase_uom
        attrs['base_uom'] = purchase_uom if purchased else 'KG'
        return attrs

    def create(self, validated_data):
        validated_data['category'] = 'ADDON'
        validated_data['addon_is_purchased'] = bool(validated_data.get('addon_is_purchased', False))
        validated_data['is_purchasable'] = bool(validated_data['addon_is_purchased'])
        validated_data['base_uom'] = validated_data.get('addon_purchase_uom') if validated_data.get('addon_is_purchased') else 'KG'
        return super().create(validated_data)

class PODSerializer(serializers.ModelSerializer):
    product_master_link = serializers.SerializerMethodField()

    class Meta:
        model = InventoryMaterial
        fields = [
            'id',
            'code',
            'name',
            'pod_type',
            'pod_fixed_height_mm',
            'pod_thickness_micron',
            'pod_panel_count',
            'pod_is_inhouse_produced',
            'density_gcm3',
            'status',
            'base_uom',
            'product_master_link',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at']

    def get_product_master_link(self, obj):
        return _product_master_link_summary(obj)

    def create(self, validated_data):
        validated_data['category'] = 'POD'
        validated_data['base_uom'] = 'KG'
        code = str(validated_data.get('code') or '').upper()
        pod_type = str(validated_data.get('pod_type') or '').upper()
        if not pod_type:
            pod_type = 'DOUBLE' if 'DOUBLE' in code else 'SINGLE'
            validated_data['pod_type'] = pod_type
        if validated_data.get('pod_fixed_height_mm') is None:
            validated_data['pod_fixed_height_mm'] = 240 if pod_type == 'DOUBLE' else 200
        if validated_data.get('pod_thickness_micron') is None:
            validated_data['pod_thickness_micron'] = 30
        if validated_data.get('density_gcm3') is None:
            validated_data['density_gcm3'] = 0.92
        if validated_data.get('pod_panel_count') is None:
            validated_data['pod_panel_count'] = 2 if pod_type == 'DOUBLE' else 1
        if validated_data.get('pod_is_inhouse_produced') is None:
            validated_data['pod_is_inhouse_produced'] = True
        return super().create(validated_data)


class PackagingSerializer(serializers.ModelSerializer):
    production_template_name = serializers.CharField(source="production_template.name", read_only=True, allow_null=True)
    product_master_link = serializers.SerializerMethodField()

    class Meta:
        model = InventoryMaterial
        fields = [
            'id',
            'code',
            'name',
            'base_uom',
            'packaging_kind',
            'packaging_supply_mode',
            'production_template',
            'production_template_name',
            'packaging_defaults_json',
            'per_sheet_base_qty',
            'status',
            'product_master_link',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at']

    def get_product_master_link(self, obj):
        return _product_master_link_summary(obj)

    def validate(self, attrs):
        kind = attrs.get('packaging_kind', getattr(self.instance, 'packaging_kind', None))
        supply_mode = attrs.get('packaging_supply_mode', getattr(self.instance, 'packaging_supply_mode', None))
        production_template = attrs.get('production_template', getattr(self.instance, 'production_template', None))
        if not kind:
            raise serializers.ValidationError({'packaging_kind': 'packaging_kind is required for packaging materials.'})
        if not supply_mode:
            raise serializers.ValidationError({'packaging_supply_mode': 'packaging_supply_mode is required for packaging materials.'})
        in_house_kinds = {"INNER_POUCH", "SHEET"}
        if supply_mode in {'IN_HOUSE', 'BOTH'} and kind not in in_house_kinds:
            raise serializers.ValidationError({'packaging_supply_mode': f'{kind} cannot be IN_HOUSE in this phase.'})
        if supply_mode == 'PURCHASED' and production_template:
            raise serializers.ValidationError({'production_template': 'Purchased-only packaging must not carry a production template.'})
        _ensure_live_current_template(production_template, "production_template")
        return attrs

    def create(self, validated_data):
        validated_data['category'] = 'PACKAGING'
        return super().create(validated_data)


class PodSkuVariantSerializer(serializers.ModelSerializer):
    pod_sku_code = serializers.CharField(source='pod_sku.code', read_only=True)
    pod_sku_name = serializers.CharField(source='pod_sku.name', read_only=True)
    material_code = serializers.CharField(source='material.code', read_only=True)
    material_name = serializers.CharField(source='material.name', read_only=True)
    material_status = serializers.CharField(source='material.status', read_only=True)
    pod_type = serializers.CharField(source='material.pod_type', read_only=True, allow_null=True)
    pod_fixed_height_mm = serializers.DecimalField(source='material.pod_fixed_height_mm', max_digits=10, decimal_places=2, read_only=True)
    pod_thickness_micron = serializers.DecimalField(source='material.pod_thickness_micron', max_digits=10, decimal_places=3, read_only=True)
    pod_panel_count = serializers.IntegerField(source='material.pod_panel_count', read_only=True)
    pod_is_inhouse_produced = serializers.BooleanField(source='material.pod_is_inhouse_produced', read_only=True)
    density_gcm3 = serializers.DecimalField(source='material.density_gcm3', max_digits=6, decimal_places=4, read_only=True)
    material_base_uom = serializers.CharField(source='material.base_uom', read_only=True)
    material_product_master_link = serializers.SerializerMethodField()

    class Meta:
        model = PodSkuVariant
        fields = [
            'id',
            'pod_sku',
            'pod_sku_code',
            'pod_sku_name',
            'material',
            'material_code',
            'material_name',
            'material_status',
            'material_base_uom',
            'material_product_master_link',
            'code',
            'name',
            'active',
            'production_defaults_json',
            'reporting_attributes_json',
            'pod_type',
            'pod_fixed_height_mm',
            'pod_thickness_micron',
            'pod_panel_count',
            'pod_is_inhouse_produced',
            'density_gcm3',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_material_product_master_link(self, obj):
        return _product_master_link_summary(obj.material)


class PodSkuSerializer(serializers.ModelSerializer):
    variants = PodSkuVariantSerializer(many=True, read_only=True)
    active_variant_count = serializers.SerializerMethodField()

    class Meta:
        model = PodSku
        fields = [
            'id',
            'code',
            'name',
            'family',
            'active',
            'variants',
            'active_variant_count',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_active_variant_count(self, obj):
        return obj.variants.filter(active=True).count()


# ─────────────────────────────────────────────────────────────────────────────
# Pouch style master
# ─────────────────────────────────────────────────────────────────────────────


class PouchStyleSerializer(serializers.ModelSerializer):
    """Serializer for PouchStyleMaster. Supports CRUD + locked-edit versioning."""

    created_by_name = serializers.CharField(source="created_by.username", read_only=True, default="")
    updated_by_name = serializers.CharField(source="updated_by.username", read_only=True, default="")
    sizes_count = serializers.SerializerMethodField()

    class Meta:
        model = PouchStyleMaster
        fields = [
            "id",
            "code",
            "name",
            "description",
            "version",
            "locked",
            "visual_emoji",
            "visual_svg",
            "default_roll_axis",
            "default_stock_form",
            "default_width_basis",
            "default_slit_policy",
            "stock_form_options",
            "allowed_fields",
            "field_adjustments",
            "formula_kind",
            "formula_params",
            "formula_ast",
            "formula_expression",
            "deprecated",
            "sort_order",
            "notes",
            "sizes_count",
            "created_by_name",
            "updated_by_name",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "version",
            "locked",
            "sizes_count",
            "created_by_name",
            "updated_by_name",
            "created_at",
            "updated_at",
        ]

    def get_sizes_count(self, obj):
        return obj.sizes.count()

    def validate_code(self, value):
        return normalize_code(value, max_length=80).upper()

    def validate_allowed_fields(self, value):
        if value in (None, ""):
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError("allowed_fields must be an object.")
        return value

    def validate_field_adjustments(self, value):
        if value in (None, ""):
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError("field_adjustments must be an object.")
        cleaned = dict(value)
        # Lane-up is a sales order / production-run choice. It used to live in
        # pouch style field_adjustments, which made this master appear to own
        # run planning. Strip it on every save while preserving old DB rows.
        cleaned.pop("default_lane_count", None)
        return cleaned

    def validate_formula_params(self, value):
        if value in (None, ""):
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError("formula_params must be an object.")
        return value

    def validate_formula_ast(self, value):
        if value in (None, ""):
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError("formula_ast must be an object.")
        return value

    def validate_default_stock_form(self, value):
        return normalize_stock_form(value)

    def validate_default_width_basis(self, value):
        stock_form = self.initial_data.get("default_stock_form") if hasattr(self, "initial_data") else None
        if stock_form in (None, "") and self.instance is not None:
            stock_form = self.instance.default_stock_form
        return normalize_width_basis(value, stock_form=stock_form)

    def validate_default_slit_policy(self, value):
        stock_form = self.initial_data.get("default_stock_form") if hasattr(self, "initial_data") else None
        if stock_form in (None, "") and self.instance is not None:
            stock_form = self.instance.default_stock_form
        return normalize_slit_policy(value, stock_form=stock_form)

    def validate_stock_form_options(self, value):
        if value in (None, ""):
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError("stock_form_options must be an object.")
        normalized = {}
        for key, config in value.items():
            form = normalize_stock_form(key)
            cfg = config if isinstance(config, dict) else {}
            normalized[form] = {
                **cfg,
                "width_basis": normalize_width_basis(cfg.get("width_basis"), stock_form=form),
                "slit_policy": normalize_slit_policy(cfg.get("slit_policy"), stock_form=form),
            }
        return normalized

    def validate(self, attrs):
        # AST mode requires a non-empty AST.
        kind = (attrs.get("formula_kind") or getattr(self.instance, "formula_kind", "") or "").upper()
        ast = attrs.get("formula_ast", getattr(self.instance, "formula_ast", {}) or {})
        if kind == "CUSTOM_AST" and not ast:
            raise serializers.ValidationError({"formula_ast": "Custom AST mode requires a non-empty AST."})
        return super().validate(attrs)


class PouchStylePreviewSerializer(serializers.Serializer):
    """POST body for live formula preview without persisting."""

    formula_kind = serializers.CharField()
    formula_params = serializers.JSONField(required=False, default=dict)
    formula_ast = serializers.JSONField(required=False, default=dict)
    field_adjustments = serializers.JSONField(required=False, default=dict)
    inputs = serializers.JSONField(required=False, default=dict)
    stock_form = serializers.CharField(required=False, allow_blank=True, default="")


# ─────────────────────────────────────────────────────────────────────────────
# Web-width policy
# ─────────────────────────────────────────────────────────────────────────────


class WebWidthPolicySerializer(serializers.ModelSerializer):
    class Meta:
        model = WebWidthPolicy
        fields = [
            "id",
            "code",
            "name",
            "description",
            "is_default",
            "scope_type",
            "scope_ref",
            "allowed_lanes",
            "allowed_parent_widths",
            "parent_width_strategy",
            "min_parent_width_mm",
            "max_parent_width_mm",
            "slitting_waste_rule",
            "min_remainder_mm",
            "prefer_remainder_first",
            "deprecated",
            "notes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_code(self, value):
        return normalize_code(value, max_length=80).upper()

    def validate_allowed_lanes(self, value):
        if value in (None, ""):
            return []
        if not isinstance(value, list):
            raise serializers.ValidationError("allowed_lanes must be a list of integers.")
        out = []
        for v in value:
            try:
                n = int(v)
            except Exception:
                raise serializers.ValidationError("allowed_lanes entries must be integers.")
            if n < 1 or n > 12:
                raise serializers.ValidationError("Lane count must be between 1 and 12.")
            out.append(n)
        return sorted(set(out))

    def validate_allowed_parent_widths(self, value):
        if value in (None, ""):
            return []
        if not isinstance(value, list):
            raise serializers.ValidationError("allowed_parent_widths must be a list of numbers.")
        out = []
        for v in value:
            try:
                n = float(v)
            except Exception:
                raise serializers.ValidationError("allowed_parent_widths entries must be numeric.")
            if n <= 0:
                continue
            out.append(round(n, 2))
        return sorted(set(out))

    def validate_scope_type(self, value):
        value = str(value or "GLOBAL").upper()
        allowed = {choice[0] for choice in WebWidthPolicy.SCOPE_CHOICES}
        if value not in allowed:
            raise serializers.ValidationError(f"scope_type must be one of {', '.join(sorted(allowed))}.")
        return value

    def validate_parent_width_strategy(self, value):
        value = str(value or "CALCULATED").upper()
        allowed = {choice[0] for choice in WebWidthPolicy.PARENT_WIDTH_STRATEGY_CHOICES}
        if value not in allowed:
            raise serializers.ValidationError(f"parent_width_strategy must be one of {', '.join(sorted(allowed))}.")
        return value

    def validate_slitting_waste_rule(self, value):
        if value in (None, ""):
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError("slitting_waste_rule must be an object.")
        out = dict(value)
        formula = str(out.get("formula") or "PER_CUT").upper()
        if formula not in {"PER_CUT", "PER_LANE", "FIXED"}:
            raise serializers.ValidationError("slitting_waste_rule.formula must be PER_CUT, PER_LANE or FIXED.")
        out["formula"] = formula
        for key in ("inter_cut_mm", "edge_trim_mm"):
            try:
                n = float(out.get(key, 0) or 0)
            except Exception:
                raise serializers.ValidationError(f"slitting_waste_rule.{key} must be numeric.")
            if n < 0:
                raise serializers.ValidationError(f"slitting_waste_rule.{key} cannot be negative.")
            out[key] = round(n, 2)
        return out

    def validate(self, attrs):
        scope_type = attrs.get("scope_type", getattr(self.instance, "scope_type", "GLOBAL"))
        scope_ref = str(attrs.get("scope_ref", getattr(self.instance, "scope_ref", "")) or "").strip()
        if scope_type == "GLOBAL":
            attrs["scope_ref"] = ""
        elif not scope_ref:
            raise serializers.ValidationError({"scope_ref": "Scope reference is required for non-global policies."})

        strategy = attrs.get("parent_width_strategy", getattr(self.instance, "parent_width_strategy", "CALCULATED"))
        widths = attrs.get("allowed_parent_widths", getattr(self.instance, "allowed_parent_widths", []))
        if strategy == "STRICT_STANDARD" and not widths:
            raise serializers.ValidationError({"allowed_parent_widths": "Strict standard mode needs at least one parent width."})

        min_parent = attrs.get("min_parent_width_mm", getattr(self.instance, "min_parent_width_mm", None))
        max_parent = attrs.get("max_parent_width_mm", getattr(self.instance, "max_parent_width_mm", None))
        if min_parent not in (None, "") and max_parent not in (None, "") and min_parent > max_parent:
            raise serializers.ValidationError({"max_parent_width_mm": "Max parent width must be greater than min parent width."})
        return attrs
