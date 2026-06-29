import logging
from copy import deepcopy
from decimal import Decimal, ROUND_CEILING
import uuid

logger = logging.getLogger(__name__)

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.artwork.compatibility import (
    product_master_print_context,
    substrate_mode_from_stock_form,
    validate_artwork_compatibility,
)
from apps.artwork.models import Artwork
from apps.artwork.print_contract import (
    get_artwork_contract,
    normalize_printing_snapshot as shared_normalize_printing_snapshot,
    resolve_ink_base_from_layers as shared_resolve_ink_base_from_layers,
    resolve_ink_contract,
    validate_frozen_printing_snapshot,
    validate_roto_cylinder_readiness,
)
from apps.bom.services_resolver import BOMResolverService
from apps.physics.geometry_override import (
    normalize_geometry_override,
    sanitize_geometry_override,
    validate_pouch_geometry_contract,
)
from apps.physics.spec_signature import (
    build_spec_payload,
    build_spec_signature,
    build_invariant_payload,
    build_invariant_signature,
)
from apps.physics.services_physics import PhysicsEngine
from apps.materials.chemistry_defaults import chemicals_payload_from_fixed_attributes
from apps.materials.models import InventoryMaterial, PodSkuVariant, ProductMaster, ProductVariant
from apps.materials.product_spec import build_product_label
from apps.materials.services_product_variant import find_or_create_product_variant
from apps.templates.models import TemplateBlueprint, TemplateProcessStep
from ..models import CustomerProductOverlay, SalesOrder, SalesOrderItem, SalesSkuVariant


def _as_int(value, default=0):
    try:
        return int(value)
    except Exception:
        return int(default)


def _make_json_serializable(obj):
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, dict):
        return {k: _make_json_serializable(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_make_json_serializable(v) for v in obj]
    return obj


def _planned_parent_width(child_w: float, lane_count: int, rule: dict | None = None) -> float:
    if not child_w or lane_count < 1:
        return 0.0
    rule = rule if isinstance(rule, dict) else {}
    inter_cut = float(rule.get("inter_cut_mm", 5) or 0)
    edge_trim = float(rule.get("edge_trim_mm", 2) or 0)
    formula = str(rule.get("formula") or "PER_CUT").upper()
    if formula == "PER_LANE":
        trim = lane_count * inter_cut + 2 * edge_trim
    elif formula == "FIXED":
        trim = inter_cut + 2 * edge_trim
    else:
        trim = max(0, lane_count - 1) * inter_cut + 2 * edge_trim
    return round(float(child_w) * lane_count + trim, 2)


def _item_label(item):
    try:
        return item.template.name
    except Exception:
        return "item"


def _canonical_sales_line_label(
    *,
    item_data,
    geometry,
    layers,
    printing,
    addons,
    packaging,
    product_master=None,
    product_variant=None,
    overlay=None,
    fallback="",
):
    item_data = item_data if isinstance(item_data, dict) else {}
    return build_product_label(
        geometry=geometry if isinstance(geometry, dict) else {},
        layers=layers if isinstance(layers, list) else [],
        printing=printing if isinstance(printing, dict) else {},
        addons=addons if isinstance(addons, list) else [],
        packaging=packaging if isinstance(packaging, dict) else {},
        product_name=str(item_data.get("line_name") or fallback or ""),
        product_master_name=str(getattr(product_master, "name", "") or ""),
        product_variant_name=str(getattr(product_variant, "name", "") or ""),
        customer_display_name=str(getattr(overlay, "customer_display_name", "") or ""),
        customer_item_code=str(getattr(overlay, "customer_item_code", "") or ""),
        axis_values=item_data.get("axis_values") if isinstance(item_data.get("axis_values"), dict) else {},
        qty_value=item_data.get("qty_value"),
        qty_uom=item_data.get("qty_uom"),
    )


def _safe_uuid_str(value):
    try:
        return str(uuid.UUID(str(value)))
    except Exception:
        return None


def _normalize_layer_snapshot(raw_layers, strict=True):
    src = raw_layers if isinstance(raw_layers, list) else []
    variant_ids = []
    family_ids = []
    for idx, row in enumerate(src):
        if not isinstance(row, dict):
            continue
        variant_id = row.get("variant_id")
        family_id = row.get("family_id")
        safe_variant = _safe_uuid_str(variant_id)
        safe_family = _safe_uuid_str(family_id)
        if safe_variant:
            variant_ids.append(safe_variant)
        if safe_family:
            family_ids.append(safe_family)

    variants_map = {
        str(v.id): v
        for v in InventoryMaterial.objects.select_related("parent_family").filter(id__in=variant_ids, category="FILM_VARIANT")
    }
    families_map = {
        str(f.id): f
        for f in InventoryMaterial.objects.filter(id__in=family_ids, category="FILM_FAMILY")
    }

    normalized = []
    for idx, row in enumerate(src):
        if not isinstance(row, dict):
            continue
        family_id = _safe_uuid_str(row.get("family_id")) or str(row.get("family_id") or "")
        variant_id = _safe_uuid_str(row.get("variant_id")) or str(row.get("variant_id") or "")
        grade_id = row.get("grade_id")
        thickness = Decimal(str(row.get("thickness_micron") or 0))
        # V2 rule: density is derived from master data (variant/family), never
        # trusted from user-entered payload density.
        density = Decimal("0")
        roll_width_mm = Decimal(str(row.get("roll_width_mm") or row.get("width_mm") or 0))
        variant_obj = variants_map.get(variant_id)
        family_obj = families_map.get(family_id)
        if variant_obj:
            density = Decimal(
                str(
                    variant_obj.density_gcm3
                    or (variant_obj.parent_family.density_gcm3 if getattr(variant_obj, "parent_family", None) else 0)
                    or density
                )
            )
        elif family_obj:
            density = Decimal(str(family_obj.density_gcm3 or density or 0))

        if strict and density <= 0:
            raise ValidationError(
                f"Layer {idx + 1}: density is missing in film family/variant master data."
            )

        if strict and variant_obj and bool(getattr(variant_obj, "is_extrudable", False)) and not grade_id:
            raise ValidationError(
                f"Layer {idx + 1}: grade is required for extrudable film variants."
            )

        normalized.append(
            {
                "family_id": family_id,
                "variant_id": variant_id or None,
                "grade_id": str(grade_id) if (grade_id and variant_obj and bool(getattr(variant_obj, "is_extrudable", False))) else None,
                "grade_code": str(row.get("grade_code") or row.get("grade") or ""),
                "material_code": str(row.get("material_code") or ""),
                "role": str(row.get("role") or ""),
                "name": str(row.get("name") or row.get("material_code") or ""),
                "thickness_micron": float(thickness),
                "density_g_cm3": float(density),
                "roll_width_mm": float(roll_width_mm) if roll_width_mm > 0 else 0.0,
                "kg_per_kg_fg": float(row.get("kg_per_kg_fg") or 0),
            }
        )
    return normalized


def _validate_template_film_constraints(template, layer_snapshot, item_label):
    # V2 hard-cut: template no longer controls sales/stock material identity constraints.
    # Product identity comes from sales/stock snapshots and BOM resolution only.
    return


def _resolve_ink_base_from_layers(layer_snapshot):
    return shared_resolve_ink_base_from_layers(layer_snapshot)


def _normalize_printing_snapshot(raw):
    return shared_normalize_printing_snapshot(raw)


def _normalize_packaging_snapshot(raw):
    src = raw if isinstance(raw, dict) else {}

    primary_src = src.get("primary_inner_pack") if isinstance(src.get("primary_inner_pack"), dict) else {}
    outer_src = src.get("final_outer_pack") if isinstance(src.get("final_outer_pack"), dict) else {}
    roll_src = src.get("roll_dispatch_pack") if isinstance(src.get("roll_dispatch_pack"), dict) else {}
    pod_src = src.get("pod") if isinstance(src.get("pod"), dict) else {}
    customer_overlay_raw = src.get("customer_overlay")
    customer_overlay_src = (
        customer_overlay_raw
        if isinstance(customer_overlay_raw, dict)
        else ({"id": str(customer_overlay_raw)} if customer_overlay_raw else {})
    )

    lines = []
    for line in roll_src.get("lines") if isinstance(roll_src.get("lines"), list) else []:
        if not isinstance(line, dict):
            continue
        material_id = _safe_uuid_str(line.get("material_id")) or str(line.get("material_id") or "").strip() or None
        qty = Decimal(str(line.get("qty") or 0))
        if not material_id:
            continue
        lines.append(
            {
                "material_id": material_id,
                "qty": float(qty),
                "uom": str(line.get("uom") or "PCS").upper(),
                "basis": str(line.get("basis") or "PER_ROLL").upper(),
            }
        )

    packaging_lines = _normalize_packaging_lines(src.get("packaging_lines") if isinstance(src.get("packaging_lines"), list) else [])

    if bool(primary_src.get("enabled", False)):
        primary_material = _packaging_material_from_ref(primary_src.get("material_id") or primary_src.get("material_code"))
        if primary_material:
            primary_line = _packaging_line_from_material(
                primary_material,
                {
                    **primary_src,
                    "role": primary_src.get("role") or "PRIMARY_INNER",
                    "basis": primary_src.get("basis") or "PCS_PER_PACK",
                },
            )
            if _packaging_line_has_quantity_rule(primary_line):
                packaging_lines.append(primary_line)

    for line in lines:
        material = _packaging_material_from_ref(line.get("material_id") or line.get("material_code"))
        if material:
            packaging_line = _packaging_line_from_material(
                material,
                {
                    **line,
                    "role": line.get("role") or "ROLL_DISPATCH",
                },
            )
            if _packaging_line_has_quantity_rule(packaging_line):
                packaging_lines.append(packaging_line)

    default_recipe = deepcopy(src.get("default_packing_recipe") or {}) if isinstance(src.get("default_packing_recipe"), dict) else {}
    for line in _packaging_lines_from_recipe(default_recipe):
        packaging_lines.append(line)

    packaging_lines = _dedupe_packaging_lines(packaging_lines)

    pod_enabled = bool(pod_src.get("enabled", False))
    if "pod_enabled" in src and src.get("pod_enabled") is not None:
        pod_enabled = bool(src.get("pod_enabled"))
    pod_profile_id = (
        _safe_uuid_str(pod_src.get("pod_profile_id"))
        or str(pod_src.get("pod_profile_id") or "").strip()
        or _safe_uuid_str(src.get("pod_profile_id"))
        or str(src.get("pod_profile_id") or "").strip()
        or None
    )
    pod_sku_variant_id = (
        _safe_uuid_str(pod_src.get("pod_sku_variant_id"))
        or str(pod_src.get("pod_sku_variant_id") or "").strip()
        or _safe_uuid_str(src.get("pod_sku_variant_id"))
        or str(src.get("pod_sku_variant_id") or "").strip()
        or None
    )

    return {
        "primary_inner_pack": {
            "enabled": bool(primary_src.get("enabled", False)),
            "material_id": _safe_uuid_str(primary_src.get("material_id")) or str(primary_src.get("material_id") or "").strip() or None,
            "material_code": str(primary_src.get("material_code") or "").strip(),
            "material_name": str(primary_src.get("material_name") or "").strip(),
            "supply_mode": str(primary_src.get("supply_mode") or "").upper(),
            "packaging_kind": str(primary_src.get("packaging_kind") or "").upper(),
            "pcs_per_pack": _as_int(primary_src.get("pcs_per_pack"), 0),
        },
        "final_outer_pack": {
            "enabled": bool(outer_src.get("enabled", False)),
            "material_id": _safe_uuid_str(outer_src.get("material_id")) or str(outer_src.get("material_id") or "").strip() or None,
            "material_code": str(outer_src.get("material_code") or "").strip(),
            "material_name": str(outer_src.get("material_name") or "").strip(),
            "supply_mode": str(outer_src.get("supply_mode") or "").upper(),
            "packaging_kind": str(outer_src.get("packaging_kind") or "").upper(),
            "counted_at_packing": bool(outer_src.get("counted_at_packing", True)),
            "basis": str(outer_src.get("basis") or "COUNTED_AT_PACKING").upper(),
            "inners_per_outer": _as_int(outer_src.get("inners_per_outer"), 0),
        },
        "roll_dispatch_pack": {
            "enabled": bool(roll_src.get("enabled", False)),
            "lines": lines,
        },
        "pod": {
            "enabled": pod_enabled,
            "pod_profile_id": pod_profile_id if pod_enabled else None,
            "pod_sku_variant_id": pod_sku_variant_id if pod_enabled else None,
        },
        "packaging_lines": packaging_lines,
        "customer_overlay": customer_overlay_src,
        "default_packing_note": str(src.get("default_packing_note") or "").strip(),
        "default_packing_recipe": default_recipe,
    }


def _hydrate_pod_snapshot(pod_cfg):
    config = dict(pod_cfg or {})
    enabled = bool(config.get("enabled"))
    if not enabled:
        return {"enabled": False, "pod_profile_id": None, "pod_sku_variant_id": None, "pod_sku_code": None, "pod_sku_name": None}

    pod_profile_id = str(config.get("pod_profile_id") or "").strip() or None
    pod_sku_variant_id = _safe_uuid_str(config.get("pod_sku_variant_id")) or str(config.get("pod_sku_variant_id") or "").strip() or None
    pod_sku_code = str(config.get("pod_sku_code") or "").strip() or None
    pod_sku_name = str(config.get("pod_sku_name") or "").strip() or None
    if pod_sku_variant_id and (not pod_profile_id or not pod_sku_code or not pod_sku_name):
        try:
            variant = PodSkuVariant.objects.select_related("material").get(id=pod_sku_variant_id, active=True)
        except PodSkuVariant.DoesNotExist as exc:
            raise ValidationError("Selected POD SKU variant is invalid or inactive.") from exc
        pod_profile_id = str(variant.material_id)
        pod_sku_code = pod_sku_code or str(variant.code or variant.pod_sku.code)
        pod_sku_name = pod_sku_name or str(variant.name or variant.pod_sku.name)

    if not pod_profile_id:
        raise ValidationError("POD profile is required when POD is enabled.")

    return {
        "enabled": True,
        "pod_profile_id": pod_profile_id,
        "pod_sku_variant_id": pod_sku_variant_id,
        "pod_sku_code": pod_sku_code,
        "pod_sku_name": pod_sku_name,
    }


def _packaging_material_from_ref(ref):
    if not ref:
        return None
    material_id = _safe_uuid_str(ref)
    qs = InventoryMaterial.objects.filter(category="PACKAGING", status="ACTIVE")
    if material_id:
        return qs.filter(id=material_id).first()
    return qs.filter(code__iexact=str(ref).strip()).first()


def _packaging_unit_base_qty(material, line=None):
    line = line if isinstance(line, dict) else {}
    defaults = getattr(material, "packaging_defaults_json", {}) if material is not None else {}
    defaults = defaults if isinstance(defaults, dict) else {}
    for value in (
        line.get("unit_base_qty"),
        line.get("base_qty_per_consumed_unit"),
        line.get("per_sheet_base_qty"),
        getattr(material, "per_sheet_base_qty", None),
        defaults.get("unit_base_qty"),
        defaults.get("base_qty_per_consumed_unit"),
        defaults.get("kg_per_inner_pouch"),
        defaults.get("kg_per_inner"),
        defaults.get("kg_per_piece"),
    ):
        try:
            qty = Decimal(str(value))
        except Exception:
            qty = Decimal("0")
        if qty > 0:
            return qty
    return Decimal("0")


def _packaging_material_meta(material, line=None):
    line = line if isinstance(line, dict) else {}
    base_uom = str(
        line.get("stock_uom")
        or line.get("base_uom")
        or getattr(material, "base_uom", None)
        or line.get("uom")
        or "PCS"
    ).upper()
    unit_base_qty = _packaging_unit_base_qty(material, line)
    return {
        "base_uom": base_uom,
        "stock_uom": base_uom,
        "unit_base_qty": float(unit_base_qty) if unit_base_qty > 0 else None,
        "unit_weight_kg": float(unit_base_qty) if base_uom == "KG" and unit_base_qty > 0 else None,
        "production_template_id": str(getattr(material, "production_template_id", "") or "") or None,
        "produced_by_product_variant_id": str(getattr(material, "produced_by_product_variant_id", "") or "") or None,
    }


def _packaging_count_qty_meta(line, material, count_qty):
    count_qty = Decimal(str(count_qty or 0))
    meta = _packaging_material_meta(material, line)
    base_uom = str(meta.get("base_uom") or "PCS").upper()
    unit_base_qty = Decimal(str(meta.get("unit_base_qty") or 0))
    display_qty = count_qty.quantize(Decimal("0.0001"))
    payload = {
        **meta,
        "qty": float(display_qty),
        "required_qty": float(display_qty),
        "required_uom": "PCS",
        "count_qty": float(display_qty),
        "count_uom": "PCS",
        "pack_count_pcs": float(display_qty),
        "uom": "PCS",
    }
    if base_uom == "PCS":
        payload["stock_qty"] = float(display_qty)
        payload["stock_uom"] = "PCS"
    elif unit_base_qty > 0:
        stock_qty = (count_qty * unit_base_qty).quantize(Decimal("0.0001"))
        payload["stock_qty"] = float(stock_qty)
        payload["stock_uom"] = base_uom
        if base_uom == "KG":
            payload["weight_kg"] = float(stock_qty)
    else:
        payload["stock_qty"] = None
        payload["stock_conversion_missing"] = True
    return payload


def _packaging_line_from_material(material, config=None):
    config = config if isinstance(config, dict) else {}
    defaults = material.packaging_defaults_json if isinstance(material.packaging_defaults_json, dict) else {}
    role = str(config.get("role") or defaults.get("role") or _default_packaging_role(material)).upper()
    basis = str(config.get("basis") or defaults.get("basis") or _default_packaging_basis(material)).upper()
    pcs_per_pack = _as_int(config.get("pcs_per_pack") or config.get("pcs") or defaults.get("pcs_per_pack") or defaults.get("pcs_per_carton"), 0)
    kg_per_pack = Decimal(str(config.get("kg_per_pack") or config.get("kg_per_bag") or defaults.get("kg_per_pack") or defaults.get("kg_per_bag") or 0))
    qty = Decimal(str(config.get("qty") or config.get("target_qty") or 0))
    row = {
        "material_id": str(material.id),
        "material_code": material.code,
        "material_name": material.name,
        "role": role,
        "basis": basis,
        "qty": float(qty),
        "uom": str(config.get("uom") or material.base_uom or "PCS").upper(),
        "pcs_per_pack": int(pcs_per_pack or 0),
        "kg_per_pack": float(kg_per_pack or 0),
        "supply_mode": str(material.packaging_supply_mode or "PURCHASED").upper(),
        "packaging_kind": str(material.packaging_kind or "").upper(),
        **_packaging_material_meta(material, config),
    }
    if config.get("required_qty") not in (None, ""):
        row["required_qty"] = float(Decimal(str(config.get("required_qty") or 0)))
    if config.get("qty_source"):
        row["qty_source"] = str(config.get("qty_source")).upper()
    return row


def _packaging_line_has_quantity_rule(line):
    if not isinstance(line, dict) or not line.get("material_id"):
        return False
    basis = str(line.get("basis") or "").upper()
    if basis == "PCS_PER_PACK":
        return _as_int(line.get("pcs_per_pack"), 0) > 0
    if basis == "KG_PER_PACK":
        try:
            return Decimal(str(line.get("kg_per_pack") or 0)) > 0
        except Exception:
            return False
    if basis in {"PER_ORDER", "PER_ROLL", "PRIMARY_INNER_PACK"}:
        try:
            return Decimal(str(line.get("qty") or 0)) > 0
        except Exception:
            return False
    return False


def _default_packaging_role(material):
    kind = str(material.packaging_kind or "").upper()
    if kind == "INNER_POUCH":
        return "PRIMARY_INNER"
    if kind == "OUTER_BAG":
        return "FINAL_OUTER"
    if kind == "GONNY":
        return "FINAL_GUNNY"
    if kind == "BOX":
        return "FINAL_CARTON"
    if kind == "SHEET":
        return "ROLL_DISPATCH"
    return "PACKAGING"


def _default_packaging_basis(material):
    defaults = material.packaging_defaults_json if isinstance(material.packaging_defaults_json, dict) else {}
    if defaults.get("pcs_per_pack") or defaults.get("pcs_per_carton"):
        return "PCS_PER_PACK"
    if defaults.get("kg_per_bag") or defaults.get("kg_per_pack"):
        return "KG_PER_PACK"
    kind = str(material.packaging_kind or "").upper()
    if kind in {"GONNY", "BOX", "INNER_POUCH", "OUTER_BAG"}:
        return "PCS_PER_PACK"
    if kind == "SHEET":
        return "PER_ROLL"
    return "PER_ORDER"


def _normalize_packaging_lines(raw_lines):
    rows = []
    for line in raw_lines if isinstance(raw_lines, list) else []:
        if not isinstance(line, dict):
            continue
        material = _packaging_material_from_ref(
            line.get("material_id") or line.get("packaging_material_id") or line.get("material_code") or line.get("code")
        )
        if material:
            row = _packaging_line_from_material(material, line)
            if _packaging_line_has_quantity_rule(row):
                rows.append(row)
    return rows


def _packaging_lines_from_recipe(recipe):
    if not isinstance(recipe, dict):
        return []
    rows = _normalize_packaging_lines(recipe.get("packaging_lines") if isinstance(recipe.get("packaging_lines"), list) else [])
    for key, role in (
        ("inner_pack", "PRIMARY_INNER"),
        ("primary_inner_pack", "PRIMARY_INNER"),
        ("outer_pack", "FINAL_OUTER"),
        ("final_pack", "FINAL_OUTER"),
        ("roll_dispatch_pack", "ROLL_DISPATCH"),
    ):
        cfg = recipe.get(key) if isinstance(recipe.get(key), dict) else {}
        material = _packaging_material_from_ref(cfg.get("material_id") or cfg.get("material_code") or cfg.get("code"))
        if material:
            row = _packaging_line_from_material(material, {**cfg, "role": cfg.get("role") or role})
            if _packaging_line_has_quantity_rule(row):
                rows.append(row)
        for nested in cfg.get("lines") if isinstance(cfg.get("lines"), list) else []:
            if not isinstance(nested, dict):
                continue
            nested_material = _packaging_material_from_ref(nested.get("material_id") or nested.get("material_code") or nested.get("code"))
            if nested_material:
                row = _packaging_line_from_material(nested_material, {**nested, "role": nested.get("role") or role})
                if _packaging_line_has_quantity_rule(row):
                    rows.append(row)
    for cfg in recipe.get("secondary_pack_options") if isinstance(recipe.get("secondary_pack_options"), list) else []:
        if not isinstance(cfg, dict):
            continue
        material = _packaging_material_from_ref(cfg.get("material_id") or cfg.get("material_code") or cfg.get("code"))
        if material:
            row = _packaging_line_from_material(material, {**cfg, "role": cfg.get("role") or "FINAL_OUTER"})
            if _packaging_line_has_quantity_rule(row):
                rows.append(row)
    return rows


def _dedupe_packaging_lines(lines):
    deduped = []
    seen = set()
    for line in lines:
        key = (line.get("material_id"), line.get("role"), line.get("basis"))
        if not line.get("material_id") or key in seen:
            continue
        seen.add(key)
        deduped.append(line)
    return deduped


_COMPUTED_GEOMETRY_KEYS = {
    "axis_values",
    "child_target_override",
    "child_target_width_mm",
    "effective_height_mm",
    "effective_width_mm",
    "film_area_width_mm",
    "input_roll_width_mm",
    "pod",
    "pod_enabled",
    "pod_height_mm",
    "pod_summary",
    "pod_type",
    "pouch_style_master",
    "pouch_style_master_code",
    "pouch_style_requires_gusset",
    "pouch_style_roll_axis",
    "pouch_style_version",
    "product_variant_code",
    "roll_width_mm",
    "slit_policy",
    "size_code",
    "size_label",
    "target_child_width_mm",
    "thickness_um",
    "stock_form",
    "stock_width_mm",
    "width_basis",
}


def _preserve_computed_geometry(base_geometry, source_geometry):
    merged = dict(base_geometry or {})
    source = source_geometry if isinstance(source_geometry, dict) else {}
    for key in _COMPUTED_GEOMETRY_KEYS:
        if key in source and source.get(key) not in (None, ""):
            merged[key] = deepcopy(source.get(key))
    source_base = source.get("base") if isinstance(source.get("base"), dict) else {}
    merged_base = merged.get("base") if isinstance(merged.get("base"), dict) else {}
    for key in (
        "child_target_width_mm",
        "effective_width_mm",
        "effective_height_mm",
        "roll_width_mm",
        "stock_width_mm",
        "film_area_width_mm",
        "size_code",
        "size_label",
        "target_child_width_mm",
        "thickness_um",
    ):
        if key in source_base and source_base.get(key) not in (None, ""):
            merged_base[key] = deepcopy(source_base.get(key))
    if merged_base:
        merged["base"] = merged_base
    return merged


def _addons_from_axis_values(axis_values):
    if isinstance(axis_values, list):
        selected = axis_values
    else:
        src = axis_values if isinstance(axis_values, dict) else {}
        selected = src.get("addons") or src.get("addon") or []
    if isinstance(selected, str):
        selected = [selected]
    if not isinstance(selected, list):
        return []
    rows = []
    for value in selected:
        addon = None
        addon_id = None
        qty = 1
        applies_to = "NONE"
        if isinstance(value, dict):
            addon_id = _safe_uuid_str(value.get("addon_id") or value.get("material_id") or value.get("id"))
            code = str(value.get("code") or value.get("material_code") or "").strip()
            qty = value.get("qty") or value.get("quantity") or 1
            applies_to = str(value.get("applies_to") or "NONE").upper()
        else:
            code = str(value or "").strip()
        if addon_id:
            addon = InventoryMaterial.objects.filter(id=addon_id, category="ADDON").first()
        elif code:
            addon = InventoryMaterial.objects.filter(code__iexact=code, category="ADDON").first()
        if not addon:
            continue
        weight_mode = str(addon.weight_mode or "").upper()
        if applies_to == "NONE" and weight_mode == "PER_MM":
            applies_to = "WIDTH"
        rows.append(
            {
                "addon_id": str(addon.id),
                "code": addon.code,
                "name": addon.name,
                "quantity": float(qty or 1),
                "qty": float(qty or 1),
                "applies_to": applies_to,
                "weight_mode": addon.weight_mode or "",
                "weight_value": float(addon.weight_value or 0),
            }
        )
    return rows


def _merge_axis_packaging_snapshot(raw_snapshot, axis_values, overlay=None, finished_good_type=None):
    snapshot = dict(raw_snapshot or {}) if isinstance(raw_snapshot, dict) else {}
    src = axis_values if isinstance(axis_values, dict) else {}
    fg_type = str(finished_good_type or "").upper()

    def _resolve_packaging_ref(ref):
        if isinstance(ref, dict):
            material_id = _safe_uuid_str(ref.get("material_id") or ref.get("id"))
            material = None
            if material_id:
                material = InventoryMaterial.objects.filter(id=material_id, category="PACKAGING").first()
            if not material and ref.get("code"):
                material = InventoryMaterial.objects.filter(code__iexact=str(ref.get("code")), category="PACKAGING").first()
            return material
        if ref:
            return InventoryMaterial.objects.filter(code__iexact=str(ref), category="PACKAGING").first()
        return None

    inner_packaging_ref = (
        src.get("packaging_inner")
        or src.get("packaging_inner_ref")
        or src.get("primary_inner_pack")
    )
    outer_packaging_ref = (
        src.get("packaging_outer")
        or src.get("packaging_outer_ref")
        or src.get("final_outer_pack")
    )
    roll_packaging_ref = None
    generic_axis_key = "packaging" if src.get("packaging") else ("packaging_ref" if src.get("packaging_ref") else "")
    generic_packaging_ref = src.get("packaging") or src.get("packaging_ref")
    generic_material = _resolve_packaging_ref(generic_packaging_ref)
    if not inner_packaging_ref and generic_material:
        # Legacy callers used a single `packaging` axis. Classify that material
        # by packaging kind so generic `packaging_ref` can still drive real
        # inner/outer/sheet defaults instead of falling back to a text note.
        generic_kind = str(generic_material.packaging_kind or "").upper()
        if generic_axis_key == "packaging":
            inner_packaging_ref = generic_packaging_ref
            if generic_kind == "SHEET" and fg_type == "ROLL":
                roll_packaging_ref = generic_packaging_ref
            elif not outer_packaging_ref and generic_kind in {"GONNY", "OUTER_BAG", "BOX", "SHEET"}:
                outer_packaging_ref = generic_packaging_ref
        elif generic_kind == "INNER_POUCH":
            inner_packaging_ref = generic_packaging_ref
        elif generic_kind == "SHEET" and fg_type == "ROLL":
            roll_packaging_ref = generic_packaging_ref
        elif not outer_packaging_ref and generic_kind in {"GONNY", "OUTER_BAG", "BOX", "SHEET"}:
            outer_packaging_ref = generic_packaging_ref
        else:
            inner_packaging_ref = generic_packaging_ref

    if inner_packaging_ref:
        primary = dict(snapshot.get("primary_inner_pack") or {})
        material = _resolve_packaging_ref(inner_packaging_ref)
        if isinstance(inner_packaging_ref, dict):
            primary["pcs_per_pack"] = _as_int(
                inner_packaging_ref.get("pcs_per_pack") or inner_packaging_ref.get("pcs"),
                primary.get("pcs_per_pack") or 0,
            )
        if material:
            primary["enabled"] = True
            primary["material_id"] = str(material.id)
            primary["material_code"] = material.code
            primary["material_name"] = material.name
            defaults = material.packaging_defaults_json if isinstance(material.packaging_defaults_json, dict) else {}
            if not primary.get("pcs_per_pack"):
                primary["pcs_per_pack"] = _as_int(defaults.get("pcs_per_pack") or defaults.get("pcs_per_carton"), 0)
            lines = list(snapshot.get("packaging_lines") or []) if isinstance(snapshot.get("packaging_lines"), list) else []
            row = _packaging_line_from_material(material, {**primary, "role": "PRIMARY_INNER"})
            if _packaging_line_has_quantity_rule(row):
                lines.append(row)
            snapshot["packaging_lines"] = lines
        snapshot["primary_inner_pack"] = primary

    if roll_packaging_ref:
        material = _resolve_packaging_ref(roll_packaging_ref)
        if material:
            defaults = material.packaging_defaults_json if isinstance(material.packaging_defaults_json, dict) else {}
            roll_pack = dict(snapshot.get("roll_dispatch_pack") or {})
            lines = list(roll_pack.get("lines") or []) if isinstance(roll_pack.get("lines"), list) else []
            lines.append(
                {
                    "material_id": str(material.id),
                    "material_code": material.code,
                    "material_name": material.name,
                    "role": "ROLL_DISPATCH",
                    "basis": str(defaults.get("basis") or "PER_ROLL").upper(),
                    "qty": float(defaults.get("qty") or defaults.get("target_qty") or 1),
                    "uom": str(material.base_uom or "PCS").upper(),
                }
            )
            roll_pack["enabled"] = True
            roll_pack["lines"] = lines
            snapshot["roll_dispatch_pack"] = roll_pack

    if outer_packaging_ref:
        outer = dict(snapshot.get("final_outer_pack") or {})
        material = _resolve_packaging_ref(outer_packaging_ref)
        if material:
            if fg_type == "ROLL" and str(material.packaging_kind or "").upper() == "SHEET":
                defaults = material.packaging_defaults_json if isinstance(material.packaging_defaults_json, dict) else {}
                roll_pack = dict(snapshot.get("roll_dispatch_pack") or {})
                lines = list(roll_pack.get("lines") or []) if isinstance(roll_pack.get("lines"), list) else []
                lines.append(
                    {
                        "material_id": str(material.id),
                        "material_code": material.code,
                        "material_name": material.name,
                        "role": "ROLL_DISPATCH",
                        "basis": str(defaults.get("basis") or "PER_ROLL").upper(),
                        "qty": float(defaults.get("qty") or defaults.get("target_qty") or 1),
                        "uom": str(material.base_uom or "PCS").upper(),
                    }
                )
                roll_pack["enabled"] = True
                roll_pack["lines"] = lines
                snapshot["roll_dispatch_pack"] = roll_pack
            else:
                defaults = material.packaging_defaults_json if isinstance(material.packaging_defaults_json, dict) else {}
                outer.update(
                    {
                        "enabled": True,
                        "material_id": str(material.id),
                        "material_code": material.code,
                        "material_name": material.name,
                        "supply_mode": str(material.packaging_supply_mode or "PURCHASED").upper(),
                        "packaging_kind": str(material.packaging_kind or "").upper(),
                        "counted_at_packing": True,
                        "basis": "COUNTED_AT_PACKING",
                        "inners_per_outer": _as_int(defaults.get("inners_per_outer") or defaults.get("inners_per_gunny"), 0),
                    }
                )
                snapshot["final_outer_pack"] = outer

    pod_ref = src.get("pod_variant") or src.get("pod") or src.get("pod_ref")
    if pod_ref and not isinstance(pod_ref, bool):
        pod = dict(snapshot.get("pod") or {})
        if isinstance(pod_ref, dict):
            pod["enabled"] = bool(pod_ref.get("enabled", True))
            pod["pod_sku_variant_id"] = _safe_uuid_str(pod_ref.get("pod_sku_variant_id") or pod_ref.get("id")) or pod.get("pod_sku_variant_id")
            pod["pod_profile_id"] = _safe_uuid_str(pod_ref.get("pod_profile_id") or pod_ref.get("material_id")) or pod.get("pod_profile_id")
        else:
            variant = PodSkuVariant.objects.filter(code__iexact=str(pod_ref), active=True).first()
            if variant:
                pod["enabled"] = True
                pod["pod_sku_variant_id"] = str(variant.id)
                pod["pod_profile_id"] = str(variant.material_id)
                pod["pod_sku_code"] = variant.code
                pod["pod_sku_name"] = variant.name
        snapshot["pod"] = pod

    if overlay:
        if getattr(overlay, "default_packing_note", "") and not snapshot.get("default_packing_note"):
            snapshot["default_packing_note"] = overlay.default_packing_note
        if getattr(overlay, "default_packing_recipe", None) and not snapshot.get("default_packing_recipe"):
            snapshot["default_packing_recipe"] = deepcopy(overlay.default_packing_recipe or {})
        if getattr(overlay, "default_packing_recipe", None):
            existing_lines = snapshot.get("packaging_lines") if isinstance(snapshot.get("packaging_lines"), list) else []
            snapshot["packaging_lines"] = [
                *existing_lines,
                *_packaging_lines_from_recipe(overlay.default_packing_recipe or {}),
            ]
        if getattr(overlay, "moq_kg", None) is not None:
            overlay_snapshot = snapshot.get("customer_overlay")
            if not isinstance(overlay_snapshot, dict):
                overlay_snapshot = {"id": str(overlay_snapshot)} if overlay_snapshot else {}
            overlay_snapshot["moq_kg"] = float(overlay.moq_kg or 0)
            snapshot["customer_overlay"] = overlay_snapshot
    return snapshot


def _resolve_source_item(raw_item):
    item_id = _safe_uuid_str(raw_item.get("repeat_source_item_id") or raw_item.get("repeat_source_item"))
    if not item_id:
        return None
    try:
        return SalesOrderItem.objects.select_related("template", "sku_variant", "sales_order").get(id=item_id)
    except SalesOrderItem.DoesNotExist as exc:
        raise ValidationError("repeat_source_item_id is invalid.") from exc


def _resolve_sku_variant(raw_item):
    variant_id = _safe_uuid_str(raw_item.get("sku_variant_id") or raw_item.get("sku_variant"))
    if not variant_id:
        return None
    try:
        variant = SalesSkuVariant.objects.select_related("sku", "sku__template").get(id=variant_id)
    except SalesSkuVariant.DoesNotExist as exc:
        raise ValidationError("sku_variant_id is invalid.") from exc
    if not variant.active or not variant.sku.active:
        raise ValidationError(f"SKU variant {variant.code} is inactive.")
    if str(getattr(variant.sku.template, "status", "") or "").upper() != "LIVE" or not bool(getattr(variant.sku.template, "is_current_version", False)):
        raise ValidationError(f"SKU {variant.sku.code} must link to the current LIVE template.")
    return variant


def _resolve_product_master(raw_item, overlay=None, variant=None):
    product_id = _safe_uuid_str(raw_item.get("product_master") or raw_item.get("product_master_id"))
    def ensure_current(product):
        if product and (not product.active or not product.is_current_version):
            raise ValidationError("product_master is invalid, inactive, or not the current version.")
        return product

    if not product_id and overlay:
        return ensure_current(overlay.product_master)
    if not product_id and variant and getattr(getattr(variant, "sku", None), "product_master_id", None):
        return ensure_current(variant.sku.product_master)
    if not product_id:
        return None
    try:
        product = ProductMaster.objects.get(id=product_id, active=True, is_current_version=True)
    except ProductMaster.DoesNotExist as exc:
        raise ValidationError("product_master is invalid, inactive, or not the current version.") from exc
    return product


def _resolve_product_variant(raw_item, product_master):
    if not product_master:
        return None
    variant_id = _safe_uuid_str(raw_item.get("product_variant") or raw_item.get("product_variant_id"))
    if variant_id:
        try:
            return ProductVariant.objects.get(id=variant_id, master=product_master, active=True)
        except ProductVariant.DoesNotExist as exc:
            raise ValidationError("product_variant does not belong to the selected product_master or is inactive.") from exc
    axis_values = raw_item.get("axis_values")
    if isinstance(axis_values, dict) and axis_values:
        variant, _created = find_or_create_product_variant(product_master, axis_values)
        return variant
    return None


def _resolve_customer_product_overlay(raw_item, *, customer=None):
    overlay_id = _safe_uuid_str(raw_item.get("customer_product_overlay") or raw_item.get("customer_product_overlay_id"))
    if not overlay_id:
        return None
    try:
        overlay = CustomerProductOverlay.objects.select_related("product_master", "customer", "default_artwork").get(id=overlay_id, active=True)
    except CustomerProductOverlay.DoesNotExist as exc:
        raise ValidationError("customer_product_overlay is invalid or inactive.") from exc
    if customer and overlay.customer_id != customer.id:
        raise ValidationError("customer_product_overlay does not belong to the sales order customer.")
    return overlay


def _merge_item_source_defaults(raw_item):
    item = dict(raw_item or {})
    variant = _resolve_sku_variant(item)
    repeat_source = _resolve_source_item(item)

    if variant:
        default_printing = deepcopy(variant.printing_snapshot or {})
        default_chemicals = deepcopy(variant.chemicals_snapshot or {})
        if default_chemicals and not isinstance(default_printing.get("chemicals"), dict):
            default_printing["chemicals"] = default_chemicals
        item.setdefault("template_id", str(variant.sku.template_id))
        if getattr(variant.sku, "product_master_id", None):
            item.setdefault("product_master", str(variant.sku.product_master_id))
        item.setdefault("fg_type", variant.finished_good_type)
        item.setdefault("roll_form", variant.roll_form or None)
        item.setdefault("geometry", deepcopy(variant.geometry_snapshot or {}))
        item.setdefault("film_layers", deepcopy(variant.layer_snapshot or []))
        item.setdefault("printing", default_printing)
        item.setdefault("chemicals", default_chemicals)
        item.setdefault("addons", deepcopy(variant.addons_snapshot or []))
        item.setdefault("packaging_snapshot", deepcopy(variant.packaging_snapshot or {}))
        item.setdefault("line_name", variant.name or variant.sku.default_line_name or variant.sku.name)

    if repeat_source:
        source_geometry = deepcopy(repeat_source.geometry_snapshot or {})
        source_printing = deepcopy(repeat_source.printing_snapshot or {})
        source_chemicals = source_printing.get("chemicals") if isinstance(source_printing.get("chemicals"), dict) else {}
        item.setdefault("template_id", str(repeat_source.template_id))
        item.setdefault("fg_type", source_geometry.get("finished_good_type") or getattr(repeat_source.template, "fg_type", "POUCH"))
        item.setdefault("roll_form", source_geometry.get("roll_form") or None)
        item.setdefault("geometry", source_geometry)
        item.setdefault("film_layers", deepcopy(repeat_source.layer_snapshot or []))
        item.setdefault("printing", source_printing)
        item.setdefault("chemicals", source_chemicals)
        item.setdefault("addons", deepcopy(repeat_source.addons_snapshot or []))
        item.setdefault("packaging_snapshot", deepcopy(repeat_source.packaging_snapshot or {}))
        item.setdefault("line_name", repeat_source.line_name or getattr(repeat_source.template, "name", ""))
        item.setdefault("price_basis", repeat_source.price_basis)
        item.setdefault("qty_uom", repeat_source.qty_uom)
        item.setdefault("unit_price", float(repeat_source.unit_price or 0))

    explicit_chemicals = item.get("chemicals")
    if isinstance(explicit_chemicals, dict):
        printing = item.get("printing") if isinstance(item.get("printing"), dict) else {}
        if explicit_chemicals:
            printing["chemicals"] = explicit_chemicals
        item["printing"] = printing

    if repeat_source and not item.get("mode"):
        item["mode"] = "REPEAT"
    elif not item.get("mode"):
        item["mode"] = "TEMPLATE"

    # v3 fallback: resolve template from product_master if still no template_id
    if not item.get("template_id") and item.get("product_master"):
        pm = _resolve_product_master(item)
        if pm:
            if getattr(pm, "template_id", None):
                item.setdefault("template_id", str(pm.template_id))
            elif getattr(pm, "default_template_id", None):
                item.setdefault("template_id", str(pm.default_template_id))
            item.setdefault("fg_type", str(pm.product_kind or "POUCH").upper())
            canonical = pm.canonical_layer_stack or []
            if canonical and not item.get("film_layers"):
                layers = []
                for i, entry in enumerate(canonical):
                    layers.append({
                        "name": str(entry.get("layer") or f"Layer {i+1}"),
                        "material_code": str(entry.get("layer") or "").split(" ")[0] if entry.get("layer") else "",
                        "role": str(entry.get("role") or ""),
                        "thickness_micron": 0,
                        "kg_per_kg_fg": round(100 / len(canonical), 1) if canonical else 100,
                    })
                item["film_layers"] = layers
                item["_v3_light_layers"] = True
            item.setdefault("printing", {})
            default_chemicals = chemicals_payload_from_fixed_attributes(
                getattr(pm, "fixed_attributes", {}) or {},
                layer_template=getattr(pm, "layer_template", None) or getattr(pm, "canonical_layer_stack", None),
            )
            if default_chemicals:
                if not isinstance(item.get("chemicals"), dict) or not item.get("chemicals"):
                    item["chemicals"] = deepcopy(default_chemicals)
                printing = item.get("printing") if isinstance(item.get("printing"), dict) else {}
                if not isinstance(printing.get("chemicals"), dict) or not printing.get("chemicals"):
                    printing["chemicals"] = deepcopy(default_chemicals)
                item["printing"] = printing
            item.setdefault("addons", [])
            default_packaging = {}
            fixed_attrs = getattr(pm, "fixed_attributes", {}) if isinstance(getattr(pm, "fixed_attributes", {}), dict) else {}
            if isinstance(fixed_attrs.get("packaging_lines"), list) and fixed_attrs.get("packaging_lines"):
                default_packaging["packaging_lines"] = deepcopy(fixed_attrs.get("packaging_lines") or [])
            if fixed_attrs.get("pod_enabled"):
                default_packaging["pod"] = {
                    "enabled": True,
                    "pod_sku_variant_id": fixed_attrs.get("pod_variant") or fixed_attrs.get("pod_variant_id") or fixed_attrs.get("pod_variant_code"),
                    "pod_sku_code": fixed_attrs.get("pod_variant_code") or "",
                    "pod_profile_id": fixed_attrs.get("pod_material") or fixed_attrs.get("pod_material_id"),
                }
            item.setdefault("packaging_snapshot", default_packaging)

    item["_resolved_sku_variant"] = variant
    item["_resolved_repeat_source_item"] = repeat_source
    return item


def _resolve_preview_fg_type(payload):
    src = payload if isinstance(payload, dict) else {}
    geometry = src.get("geometry") if isinstance(src.get("geometry"), dict) else {}
    fg_type = str(
        src.get("finished_good_type")
        or src.get("fg_type")
        or geometry.get("finished_good_type")
        or geometry.get("fg_type")
    ).upper()
    if fg_type in {"POUCH", "ROLL"}:
        return fg_type
    template_id = _safe_uuid_str(src.get("template_id"))
    if template_id:
        template = TemplateBlueprint.objects.filter(id=template_id).only("fg_type").first()
        if template and str(template.fg_type or "").upper() in {"POUCH", "ROLL"}:
            return str(template.fg_type).upper()
    return "POUCH"


def _planning_category_for_row(section_name, row):
    section = str(section_name or "").upper()
    if section == "FILMS":
        return "FILM"
    if section == "GRANULES":
        return "GRANULE"
    if section == "INKS":
        return "INK"
    if section == "CHEMICALS":
        typ = str((row or {}).get("type") or "").upper()
        if typ in {"ADHESIVE", "SOLVENT"}:
            return typ
        return "CHEMICAL"
    if section == "ADDONS":
        return "ADDON"
    if section == "POD":
        return "POD"
    return section.rstrip("S")


def _planning_material_identity(section_name, row):
    if not isinstance(row, dict):
        return None, None, None
    material_id = _safe_uuid_str(
        row.get("material_id")
        or row.get("variant_id")
        or row.get("granule_id")
        or row.get("addon_id")
        or row.get("ink_id")
        or row.get("chemical_id")
    )
    material_name = str(row.get("name") or row.get("code") or f"Unknown {section_name}").strip()
    material_code = str(row.get("code") or "").strip() or None
    return material_id, material_name, material_code


def _collect_template_issue_policies(template_id):
    template_id = _safe_uuid_str(template_id)
    if not template_id:
        return {}
    rows = (
        TemplateProcessStep.objects.filter(template_id=template_id)
        .select_related("process", "roll_spec")
        .prefetch_related("materials")
        .order_by("sequence_number")
    )
    mapping = {}
    for step in rows:
        for mat in step.materials.all():
            category_code = str(getattr(mat, "category_code", "") or "").strip().upper()
            if not category_code:
                continue
            try:
                roll_spec = getattr(step, "roll_spec", None)
            except Exception:
                roll_spec = None
            split_pct = Decimal("0")
            if category_code == "ADHESIVE" and roll_spec is not None:
                split_pct = Decimal(str(getattr(roll_spec, "adhesive_split_pct", 0) or 0))
            if category_code == "SOLVENT" and roll_spec is not None:
                split_pct = Decimal(str(getattr(roll_spec, "solvent_split_pct", 0) or 0))
            mapping.setdefault(category_code, []).append({
                "step_id": str(step.id),
                "step_sequence": int(step.sequence_number or 0),
                "step_name": str(getattr(step.process, "name", "") or f"Step {step.sequence_number}"),
                "consumption_basis": str(getattr(mat, "consumption_basis", "FIXED_KG") or "FIXED_KG").upper(),
                "formula_driver": str(getattr(mat, "formula_driver", "NONE") or "NONE").upper(),
                "formula_params": dict(getattr(mat, "formula_params", {}) or {}),
                "split_pct": split_pct,
                "issue_policy_mode": str(getattr(mat, "issue_policy_mode", "NONE") or "NONE").upper(),
                "issue_policy_value": Decimal(str(getattr(mat, "issue_policy_value", 0) or 0)),
                "capture_mode": str(getattr(mat, "capture_mode", "AUTO_FROM_OUTPUT") or "AUTO_FROM_OUTPUT").upper(),
            })
    if "GRANULE" not in mapping:
        fallback_step = next(
            (
                step
                for step in rows
                if str(getattr(getattr(step, "process", None), "input_form", "") or "").upper() == "BULK"
                and str(getattr(getattr(step, "process", None), "output_form", "") or "").upper() == "ROLL"
            ),
            None,
        )
        if fallback_step is None:
            fallback_step = next(
                (
                    step
                    for step in rows
                    if "EXTR" in str(
                        getattr(getattr(step, "process", None), "code", "")
                        or getattr(getattr(step, "process", None), "name", "")
                    ).upper()
                ),
                None,
            )
        if fallback_step is not None:
            mapping["GRANULE"] = [{
                "step_id": str(fallback_step.id),
                "step_sequence": int(fallback_step.sequence_number or 0),
                "step_name": str(getattr(fallback_step.process, "name", "") or f"Step {fallback_step.sequence_number}"),
                "consumption_basis": "FIXED_KG",
                "formula_driver": "NONE",
                "formula_params": {},
                "split_pct": Decimal("0"),
                "issue_policy_mode": "NONE",
                "issue_policy_value": Decimal("0"),
                "capture_mode": "AUTO_ESTIMATED_CONFIRM",
            }]
    return mapping


def _normalize_issue_policy_overrides(raw):
    src = raw if isinstance(raw, list) else []
    out = {}
    for row in src:
        if not isinstance(row, dict):
            continue
        policy_key = str(row.get("policy_key") or "").strip()
        if not policy_key:
            continue
        mode = str(row.get("issue_policy_mode") or "NONE").strip().upper()
        if mode not in {"NONE", "PERCENT_OVER_THEORY", "FIXED_EXTRA_KG", "MINIMUM_ISSUE_KG"}:
            mode = "NONE"
        try:
            value = Decimal(str(row.get("issue_policy_value") or 0))
        except Exception:
            value = Decimal("0")
        out[policy_key] = {
            "issue_policy_mode": mode,
            "issue_policy_value": value,
        }
    return out


def _planned_issue_qty(theoretical_qty: Decimal, mode: str, value: Decimal) -> Decimal:
    theoretical_qty = Decimal(str(theoretical_qty or 0))
    value = Decimal(str(value or 0))
    mode = str(mode or "NONE").upper()
    if theoretical_qty < 0:
        theoretical_qty = Decimal("0")
    if mode == "PERCENT_OVER_THEORY":
        return (theoretical_qty * (Decimal("1") + (value / Decimal("100")))).quantize(Decimal("0.0001"))
    if mode == "FIXED_EXTRA_KG":
        return (theoretical_qty + value).quantize(Decimal("0.0001"))
    if mode == "MINIMUM_ISSUE_KG":
        return max(theoretical_qty, value).quantize(Decimal("0.0001"))
    return theoretical_qty.quantize(Decimal("0.0001"))


def _planning_qty_and_uom(section_name, row):
    section = str(section_name or "").upper()
    src = row if isinstance(row, dict) else {}
    uom = str(src.get("uom") or src.get("stock_uom") or "KG").upper()
    if section == "ADDONS":
        material_id = _safe_uuid_str(src.get("material_id") or src.get("addon_id"))
        material = InventoryMaterial.objects.filter(id=material_id).only("base_uom", "addon_purchase_uom").first() if material_id else None
        uom = str(
            src.get("stock_uom")
            or src.get("uom")
            or getattr(material, "addon_purchase_uom", None)
            or getattr(material, "base_uom", None)
            or "KG"
        ).upper()
    if uom not in {"KG", "PCS", "METER"}:
        uom = "KG"

    if uom == "KG":
        qty = Decimal(str(src.get("stock_qty") if src.get("stock_qty") not in (None, "") else src.get("weight_kg") or 0))
    else:
        qty = Decimal(str(src.get("stock_qty") if src.get("stock_qty") not in (None, "") else src.get("quantity") or 0))
    return qty, uom


def _summarize_material_plan_lines(lines):
    src = lines if isinstance(lines, list) else []
    theoretical_total = Decimal("0")
    planned_total = Decimal("0")
    theoretical_by_uom = {}
    planned_by_uom = {}
    override_count = 0
    for row in src:
        if not isinstance(row, dict):
            continue
        uom = str(row.get("uom") or "KG").upper()
        theoretical_qty = Decimal(str(row.get("theoretical_qty") or 0))
        planned_qty = Decimal(str(row.get("planned_issue_qty") or 0))
        theoretical_by_uom[uom] = theoretical_by_uom.get(uom, Decimal("0")) + theoretical_qty
        planned_by_uom[uom] = planned_by_uom.get(uom, Decimal("0")) + planned_qty
        if uom == "KG":
            theoretical_total += theoretical_qty
            planned_total += planned_qty
        if str(row.get("policy_source") or "").upper() == "ORDER_OVERRIDE":
            override_count += 1
    uoms = sorted(theoretical_by_uom.keys() | planned_by_uom.keys())
    return {
        "line_count": len([row for row in src if isinstance(row, dict)]),
        "override_count": override_count,
        "default_count": max(0, len([row for row in src if isinstance(row, dict)]) - override_count),
        "theoretical_total_qty": float(theoretical_total.quantize(Decimal("0.0001"))),
        "planned_issue_total_qty": float(planned_total.quantize(Decimal("0.0001"))),
        "uom": uoms[0] if len(uoms) == 1 else ("MIXED" if uoms else "KG"),
        "theoretical_totals_by_uom": {
            uom: float(qty.quantize(Decimal("0.0001"))) for uom, qty in sorted(theoretical_by_uom.items())
        },
        "planned_issue_totals_by_uom": {
            uom: float(qty.quantize(Decimal("0.0001"))) for uom, qty in sorted(planned_by_uom.items())
        },
    }


def _build_material_plan_lines(
    template_snapshot,
    bom_result,
    *,
    quantity_multiplier=None,
    order_scoped_sections=None,
):
    template_snapshot = template_snapshot if isinstance(template_snapshot, dict) else {}
    bom_result = bom_result if isinstance(bom_result, dict) else {}
    template_policy_map = _collect_template_issue_policies(template_snapshot.get("template_id"))
    override_map = _normalize_issue_policy_overrides(template_snapshot.get("issue_policy_overrides"))
    try:
        multiplier = Decimal(str(quantity_multiplier if quantity_multiplier is not None else 1))
    except Exception:
        multiplier = Decimal("1")
    if multiplier <= 0:
        multiplier = Decimal("1")
    order_scoped = {str(value).lower() for value in (order_scoped_sections or set())}
    lines = []

    for section_name in ("films", "granules", "inks", "chemicals", "addons", "pod"):
        rows = bom_result.get(section_name) or []
        if not isinstance(rows, list):
            continue
        for row in rows:
            if not isinstance(row, dict):
                continue
            material_id, material_name, material_code = _planning_material_identity(section_name, row)
            theoretical_qty, line_uom = _planning_qty_and_uom(section_name, row)
            if theoretical_qty <= 0:
                continue
            if section_name not in order_scoped:
                theoretical_qty = theoretical_qty * multiplier
            category_code = _planning_category_for_row(section_name, row)
            template_policies = template_policy_map.get(category_code) or [{}]
            if not isinstance(template_policies, list):
                template_policies = [template_policies]
            split_capable = category_code in {"ADHESIVE", "SOLVENT"}
            if not split_capable:
                template_policies = template_policies[:1]
            non_zero_pct = sum((Decimal(str(policy.get("split_pct") or 0)) for policy in template_policies), Decimal("0"))
            default_pct = Decimal("100") / Decimal(str(max(1, len(template_policies))))
            for policy_index, template_policy in enumerate(template_policies, start=1):
                pct = Decimal(str(template_policy.get("split_pct") or 0))
                if split_capable and len(template_policies) > 1:
                    pct = pct if pct > 0 else (default_pct if non_zero_pct <= 0 else Decimal("0"))
                    if pct <= 0:
                        continue
                    line_theoretical_qty = (theoretical_qty * pct / Decimal("100")).quantize(Decimal("0.0001"))
                else:
                    pct = Decimal("100")
                    line_theoretical_qty = theoretical_qty
                policy_key_base = f"{category_code}:{material_id or material_code or material_name}"
                policy_key = (
                    f"{policy_key_base}@{template_policy.get('step_id')}"
                    if split_capable and len(template_policies) > 1 and template_policy.get("step_id")
                    else policy_key_base
                )
                override_policy = override_map.get(policy_key) or override_map.get(policy_key_base)
                template_mode = str(template_policy.get("issue_policy_mode", "NONE") or "NONE").upper()
                template_value = Decimal(str(template_policy.get("issue_policy_value", 0) or 0))
                effective_mode = str((override_policy or {}).get("issue_policy_mode") or template_mode or "NONE").upper()
                effective_value = Decimal(str((override_policy or {}).get("issue_policy_value", template_value) or template_value or 0))
                planned_qty = _planned_issue_qty(line_theoretical_qty, effective_mode, effective_value)
                lines.append(
                    {
                        "policy_key": policy_key,
                        "category_code": category_code,
                        "material_id": material_id,
                        "material_code": material_code,
                        "material_name": material_name,
                        "uom": line_uom,
                        "step_id": template_policy.get("step_id"),
                        "step_sequence": template_policy.get("step_sequence"),
                        "step_name": template_policy.get("step_name"),
                        "consumption_basis": template_policy.get("consumption_basis"),
                        "formula_driver": template_policy.get("formula_driver"),
                        "formula_params": template_policy.get("formula_params") or {},
                        "capture_mode": template_policy.get("capture_mode"),
                        "split_pct": float(pct.quantize(Decimal("0.01"))),
                        "theoretical_qty": float(line_theoretical_qty.quantize(Decimal("0.0001"))),
                        "planned_issue_qty": float(planned_qty),
                        "template_issue_policy_mode": template_mode,
                        "template_issue_policy_value": float(template_value),
                        "override_issue_policy_mode": (override_policy or {}).get("issue_policy_mode"),
                        "override_issue_policy_value": float((override_policy or {}).get("issue_policy_value", 0)) if override_policy else None,
                        "effective_issue_policy_mode": effective_mode,
                        "effective_issue_policy_value": float(effective_value),
                        "policy_source": "ORDER_OVERRIDE" if override_policy else "TEMPLATE_DEFAULT",
                    }
                )
    return lines


def _packaging_order_qty_context(payload, unit_weight_g, total_weight_kg):
    payload = payload if isinstance(payload, dict) else {}
    qty = Decimal(str(payload.get("order_qty") or payload.get("qty_value") or payload.get("quantity") or payload.get("qty") or 0))
    qty_uom = str(payload.get("uom") or payload.get("qty_uom") or payload.get("quantity_uom") or "PCS").upper()
    unit_weight = Decimal(str(unit_weight_g or payload.get("unit_weight_g") or 0))
    weight = Decimal(str(total_weight_kg or payload.get("total_weight_kg") or 0))
    if weight <= 0:
        weight = qty if qty_uom == "KG" else ((qty * unit_weight / Decimal("1000")) if qty_uom == "PCS" and unit_weight > 0 else Decimal("0"))
    pieces = qty if qty_uom == "PCS" else ((qty * Decimal("1000") / unit_weight) if qty_uom == "KG" and unit_weight > 0 else Decimal("0"))
    return qty, qty_uom, pieces, weight


def _estimate_packaging_line_qty_for_bom(line, payload, unit_weight_g, total_weight_kg):
    if not isinstance(line, dict):
        return Decimal("0")
    explicit = Decimal(str(line.get("qty") or line.get("target_qty") or 0))
    if explicit > 0:
        return explicit
    basis = str(line.get("basis") or "").upper()
    pcs_per_pack = Decimal(str(line.get("pcs_per_pack") or 0))
    kg_per_pack = Decimal(str(line.get("kg_per_pack") or line.get("kg_per_bag") or 0))
    _, _, pieces, weight = _packaging_order_qty_context(payload, unit_weight_g, total_weight_kg)

    if (basis in {"PCS_PER_PACK", "PRIMARY_INNER_PACK"} or pcs_per_pack > 0) and pieces > 0 and pcs_per_pack > 0:
        return (pieces / pcs_per_pack).to_integral_value(rounding=ROUND_CEILING)
    if (basis == "KG_PER_PACK" or kg_per_pack > 0) and weight > 0 and kg_per_pack > 0:
        return (weight / kg_per_pack).to_integral_value(rounding=ROUND_CEILING)
    return Decimal("0")


def _materialize_packaging_snapshot_quantities(packaging_snapshot, payload, unit_weight_g, total_weight_kg):
    snapshot = deepcopy(packaging_snapshot or {}) if isinstance(packaging_snapshot, dict) else {}
    lines = snapshot.get("packaging_lines") if isinstance(snapshot.get("packaging_lines"), list) else []
    materialized_lines = []
    for line in lines:
        if not isinstance(line, dict):
            continue
        row = deepcopy(line)
        required_qty = _estimate_packaging_line_qty_for_bom(row, payload, unit_weight_g, total_weight_kg)
        if required_qty > 0:
            material = _packaging_material_from_ref(row.get("material_id") or row.get("material_code"))
            row.update(_packaging_count_qty_meta(row, material, required_qty))
            row["qty_source"] = "ORDER_QUANTITY"
        materialized_lines.append(row)
    snapshot["packaging_lines"] = materialized_lines

    primary = snapshot.get("primary_inner_pack") if isinstance(snapshot.get("primary_inner_pack"), dict) else {}
    if primary.get("enabled") and primary.get("pcs_per_pack"):
        primary_material = primary.get("material_id")
        primary_line = next(
            (
                line
                for line in materialized_lines
                if str(line.get("role") or "").upper() == "PRIMARY_INNER"
                and (not primary_material or str(line.get("material_id")) == str(primary_material))
            ),
            None,
        )
        if primary_line:
            primary = deepcopy(primary)
            primary["qty"] = primary_line.get("qty") or 0
            primary["required_qty"] = primary_line.get("required_qty") or primary["qty"]
            snapshot["primary_inner_pack"] = primary

    roll_pack = snapshot.get("roll_dispatch_pack") if isinstance(snapshot.get("roll_dispatch_pack"), dict) else {}
    if isinstance(roll_pack.get("lines"), list):
        resolved_roll_lines = []
        for line in roll_pack.get("lines") or []:
            if not isinstance(line, dict):
                continue
            row = deepcopy(line)
            required_qty = _estimate_packaging_line_qty_for_bom(row, payload, unit_weight_g, total_weight_kg)
            if required_qty > 0:
                material = _packaging_material_from_ref(row.get("material_id") or row.get("material_code"))
                row.update(_packaging_count_qty_meta(row, material, required_qty))
                row["qty_source"] = "ORDER_QUANTITY"
            resolved_roll_lines.append(row)
        roll_pack = deepcopy(roll_pack)
        roll_pack["lines"] = resolved_roll_lines
        snapshot["roll_dispatch_pack"] = roll_pack
    return snapshot


def _build_packaging_bom_rows(payload, unit_weight_g, total_weight_kg):
    payload = payload if isinstance(payload, dict) else {}
    snapshot = payload.get("packaging_snapshot") or payload.get("packaging") or {}
    if not isinstance(snapshot, dict):
        return [], []
    rows = []
    planning_lines = []
    for index, line in enumerate(snapshot.get("packaging_lines") if isinstance(snapshot.get("packaging_lines"), list) else [], start=1):
        if not isinstance(line, dict):
            continue
        material_id = _safe_uuid_str(line.get("material_id")) or str(line.get("material_id") or "").strip() or None
        material_code = str(line.get("material_code") or "").strip()
        material_name = str(line.get("material_name") or material_code or "Packaging material").strip()
        material = _packaging_material_from_ref(material_id or material_code)
        if material:
            material_id = str(material.id)
            material_code = material_code or material.code
            material_name = material_name or material.name
        qty = _estimate_packaging_line_qty_for_bom(line, payload, unit_weight_g, total_weight_kg)
        if qty <= 0:
            continue
        qty_meta = _packaging_count_qty_meta(line, material, qty)
        uom = str(qty_meta.get("uom") or "PCS").upper()
        role = str(line.get("role") or line.get("kind") or "PACKAGING").upper()
        basis = str(line.get("basis") or "").upper()
        supply_mode = str(line.get("supply_mode") or getattr(material, "packaging_supply_mode", None) or "PURCHASED").upper()
        packaging_kind = str(line.get("packaging_kind") or getattr(material, "packaging_kind", None) or "").upper()
        bom_row = {
            "material_id": material_id,
            "material_code": material_code,
            "material_name": material_name,
            "name": material_name,
            "code": material_code,
            "role": role,
            "basis": basis,
            "uom": uom,
            "supply_mode": supply_mode,
            "packaging_kind": packaging_kind,
            "pcs_per_pack": line.get("pcs_per_pack"),
            "kg_per_pack": line.get("kg_per_pack"),
            **qty_meta,
        }
        rows.append(bom_row)
        policy_key = f"PACKAGING:{material_id or material_code or index}:{role}"
        formula_params = {
            "role": role,
            "basis": basis,
            "pcs_per_pack": line.get("pcs_per_pack"),
            "kg_per_pack": line.get("kg_per_pack"),
            "supply_mode": supply_mode,
            "packaging_kind": packaging_kind,
            "count_qty": qty_meta.get("count_qty"),
            "count_uom": qty_meta.get("count_uom"),
            "pack_count_pcs": qty_meta.get("pack_count_pcs"),
            "stock_qty": qty_meta.get("stock_qty"),
            "stock_uom": qty_meta.get("stock_uom"),
            "unit_base_qty": qty_meta.get("unit_base_qty"),
            "unit_weight_kg": qty_meta.get("unit_weight_kg"),
            "base_uom": qty_meta.get("base_uom"),
            "stock_conversion_missing": bool(qty_meta.get("stock_conversion_missing")),
            "production_template_id": qty_meta.get("production_template_id"),
            "produced_by_product_variant_id": qty_meta.get("produced_by_product_variant_id"),
        }
        planning_lines.append(
            {
                "policy_key": policy_key,
                "category_code": "PACKAGING",
                "material_id": material_id,
                "material_code": material_code,
                "material_name": material_name,
                "uom": uom,
                "step_id": None,
                "step_sequence": None,
                "step_name": "Packing",
                "consumption_basis": basis,
                "formula_driver": "PACKAGING_CONTRACT",
                "formula_params": formula_params,
                "capture_mode": "PACKAGING_CONTRACT",
                "split_pct": 100.0,
                "theoretical_qty": qty_meta.get("qty"),
                "planned_issue_qty": qty_meta.get("qty"),
                "stock_qty": qty_meta.get("stock_qty"),
                "stock_uom": qty_meta.get("stock_uom"),
                "count_qty": qty_meta.get("count_qty"),
                "count_uom": qty_meta.get("count_uom"),
                "pack_count_pcs": qty_meta.get("pack_count_pcs"),
                "weight_kg": qty_meta.get("weight_kg"),
                "base_uom": qty_meta.get("base_uom"),
                "unit_base_qty": qty_meta.get("unit_base_qty"),
                "unit_weight_kg": qty_meta.get("unit_weight_kg"),
                "stock_conversion_missing": bool(qty_meta.get("stock_conversion_missing")),
                "template_issue_policy_mode": "NONE",
                "template_issue_policy_value": 0.0,
                "override_issue_policy_mode": None,
                "override_issue_policy_value": None,
                "effective_issue_policy_mode": "NONE",
                "effective_issue_policy_value": 0.0,
                "policy_source": "PACKAGING_CONTRACT",
            }
        )
    return rows, planning_lines


def _normalize_pod_bom_to_unit_scope(bom_result, physics_result, fg_type: str):
    if str(fg_type or "").upper() != "POUCH":
        return
    rows = bom_result.get("pod") if isinstance(bom_result, dict) else None
    if not isinstance(rows, list) or not rows:
        return
    pod_unit_weight_g = Decimal(str((physics_result or {}).get("pod_unit_weight_g") or 0))
    if pod_unit_weight_g <= 0:
        return
    per_piece_kg = (pod_unit_weight_g / Decimal("1000")).quantize(Decimal("0.000001"))
    for row in rows:
        if isinstance(row, dict):
            row["weight_kg"] = float(per_piece_kg)
            row["scope"] = "PER_PIECE"


def _normalize_preview_geometry(raw_geometry, fg_type: str):
    geometry = normalize_geometry_override({}, raw_geometry or {})
    geometry["finished_good_type"] = fg_type
    multipliers = geometry.get("multipliers") if isinstance(geometry.get("multipliers"), dict) else {}
    if "repeats" in multipliers:
        multipliers.pop("repeats", None)
    geometry["multipliers"] = multipliers

    base = geometry.get("base") if isinstance(geometry.get("base"), dict) else {}
    if fg_type == "ROLL":
        base["height_mm"] = 0.0
        geometry["base"] = base
        geometry.pop("repeat_length_mm", None)
    return geometry


def _placeholder_color_names(front_count, back_count):
    front = [f"FRONT-{idx + 1}" for idx in range(max(0, int(front_count or 0)))]
    back = [f"BACK-{idx + 1}" for idx in range(max(0, int(back_count or 0)))]
    return front, back


def _line_size_stock_form(item, product_master):
    axis_values = item.axis_values if isinstance(getattr(item, "axis_values", None), dict) else {}
    size_code = str(axis_values.get("size") or axis_values.get("size_code") or "").strip()
    if not product_master or not size_code:
        return None
    try:
        size = product_master.sizes.filter(code__iexact=size_code).first()
    except Exception:
        return None
    if not size:
        return None
    return getattr(size, "stock_form", None) or getattr(size, "roll_form", None) or getattr(size, "width_basis", None)


def _declared_product_master_print_type(fixed_attrs):
    raw = (
        fixed_attrs.get("print_type")
        or fixed_attrs.get("printing_type")
        or fixed_attrs.get("method")
    )
    normalized = str(raw or "").strip().upper()
    return normalized if normalized in {"FLEXO", "ROTO"} else None


def _validate_printing_snapshot_for_confirm(item, allow_missing_artwork=False):
    printing = _normalize_printing_snapshot(item.printing_snapshot)
    if not printing.get("enabled", False):
        return printing, False, None

    fixed_attrs = {}
    product_master = None
    pm_print_context = None
    expected_line_stock_form = None
    if getattr(item, "product_master_id", None):
        product_master = getattr(item, "product_master", None)
        fixed_attrs = getattr(product_master, "fixed_attributes", {}) if product_master else {}
        fixed_attrs = fixed_attrs or {}
        if not isinstance(fixed_attrs, dict):
            fixed_attrs = {}
        if product_master:
            axis_values = item.axis_values if isinstance(getattr(item, "axis_values", None), dict) else {}
            pm_print_context = product_master_print_context(product_master, axis_values=axis_values)
            expected_line_stock_form = _line_size_stock_form(item, product_master)
        substrate_mode = str(
            printing.get("substrate_mode")
            or printing.get("film_type")
            or (substrate_mode_from_stock_form(expected_line_stock_form) if expected_line_stock_form else "")
            or (pm_print_context["substrate_mode"] if pm_print_context else "")
            or fixed_attrs.get("film_type")
            or "SHEET"
        ).upper()
        if substrate_mode not in {"SHEET", "TUBING"}:
            substrate_mode = "SHEET"
        printing["substrate_mode"] = substrate_mode
        printing["film_type"] = substrate_mode

        front_default = (
            fixed_attrs.get("default_front_colors")
            or fixed_attrs.get("front_colors_count")
            or fixed_attrs.get("default_color_count")
            or 1
        )
        back_default = (
            fixed_attrs.get("default_back_colors")
            or fixed_attrs.get("back_colors_count")
            or 0
        )
        front_count = int(printing.get("front_colors_count") or len(printing.get("front_colors") or []) or front_default or 1)
        back_count = int(printing.get("back_colors_count") or len(printing.get("back_colors") or []) or back_default or 0)
        if substrate_mode == "SHEET":
            back_count = 0
        printing["front_colors_count"] = max(0, front_count)
        printing["back_colors_count"] = max(0, back_count)

        # Authoritative ink GSM comes from the approved artwork ONLY. No
        # PM-level default-ink-gsm fallback any more — that would create
        # phantom ink rows for warning-print orders. If `printing.enabled`
        # is true here, an artwork must be on the line (or the PM
        # default-artwork fallback resolved below) and the artwork itself
        # supplies the GSM via the upstream `_printing_from_payload`. If no
        # GSM is present we leave it at the snapshot's current value
        # (likely 0) and let the downstream artwork lookup populate it.
        ink_gsm = Decimal(str(printing.get("ink_gsm_total") or printing.get("ink_gsm") or 0))
        printing["ink_gsm_total"] = float(ink_gsm)
        printing["ink_gsm"] = float(ink_gsm)

    print_type = str(printing.get("type") or printing.get("method") or "").upper()
    if not print_type:
        raise ValidationError(f"Item {_item_label(item)}: printing type is required when printing is enabled.")
    declared_print_type = _declared_product_master_print_type(fixed_attrs)
    if declared_print_type and print_type != declared_print_type:
        raise ValidationError(
            f"Item {_item_label(item)}: print type {print_type} does not match "
            f"Product Master allowed print method {declared_print_type}."
        )

    substrate_mode = str(printing.get("substrate_mode") or "").upper()
    if substrate_mode not in {"SHEET", "TUBING"}:
        raise ValidationError(f"Item {_item_label(item)}: substrate_mode must be SHEET or TUBING.")
    if expected_line_stock_form:
        expected_substrate_mode = substrate_mode_from_stock_form(expected_line_stock_form)
        if substrate_mode != expected_substrate_mode:
            raise ValidationError(
                f"Item {_item_label(item)}: artwork film type {substrate_mode} does not match "
                f"selected pouch-size stock form {expected_substrate_mode}."
            )

    front_count = int(printing.get("front_colors_count") or 0)
    back_count = int(printing.get("back_colors_count") or 0)
    if front_count < 0 or back_count < 0:
        raise ValidationError(f"Item {_item_label(item)}: front/back color counts cannot be negative.")
    if front_count + back_count <= 0:
        raise ValidationError(f"Item {_item_label(item)}: at least one color is required when printing is enabled.")
    if substrate_mode == "SHEET" and back_count > 0:
        raise ValidationError(f"Item {_item_label(item)}: sheet film supports front colors only.")
    # Ink GSM is only required once an artwork is actually attached. Until
    # then the BOM resolver treats the line as unprinted (no ink rows). If
    # the master forces artwork_required, the missing-artwork branch below
    # will block the confirm. We don't manufacture a placeholder ink_gsm here.
    artwork_id = printing.get("artwork_id")
    # PM-level default-fallback: if the order line has no artwork and no
    # customer-overlay artwork resolved it, fall back to the master's
    # fixed_attributes.default_artwork_id (optional · set on PM Edit).
    defer_to_planner = bool(printing.get("defer_artwork_to_planner"))
    if not artwork_id and not defer_to_planner and isinstance(fixed_attrs, dict):
        fallback_artwork_id = fixed_attrs.get("default_artwork_id")
        if fallback_artwork_id:
            artwork_id = fallback_artwork_id
            printing["artwork_id"] = fallback_artwork_id
            printing.setdefault("artwork_source", "PM_DEFAULT_FALLBACK")
    if not artwork_id:
        if not allow_missing_artwork:
            raise ValidationError(f"Item {_item_label(item)}: approved artwork is required when printing is enabled.")
        front_colors, back_colors = _placeholder_color_names(front_count, back_count)
        printing["front_colors"] = front_colors
        printing["back_colors"] = back_colors
        printing["color_names"] = front_colors + back_colors
        printing["ink_base_family"] = _resolve_ink_base_from_layers(item.layer_snapshot or [])
        printing["cylinder_required"] = print_type == "ROTO"
        printing = validate_frozen_printing_snapshot(
            printing,
            layer_snapshot=item.layer_snapshot or [],
            require_artwork=False,
            strict_inks=False,
        )
        return printing, True, None

    artwork = Artwork.objects.filter(id=artwork_id).first()
    if not artwork:
        raise ValidationError(f"Item {_item_label(item)}: artwork_id is invalid.")
    try:
        contract = validate_artwork_compatibility(
            artwork,
            print_type=print_type,
            substrate_mode=substrate_mode,
            require_asset=True,
        )
    except ValidationError as exc:
        raise ValidationError(f"Item {_item_label(item)}: {exc}") from exc
    art_front = contract["front_colors"]
    art_back = contract["back_colors"]
    art_front_count = int(contract["front_colors_count"] or len(art_front) or 0)
    art_back_count = int(contract["back_colors_count"] or len(art_back) or 0)
    # Artwork is the source of truth for side color counts. Product Master
    # declares whether art is required/defaulted and what print/form is valid;
    # the selected artwork extends the BOM with its own color + GSM contract.
    printing["front_colors_count"] = art_front_count
    printing["back_colors_count"] = art_back_count

    if print_type == "ROTO":
        try:
            validate_roto_cylinder_readiness(artwork)
        except ValidationError as exc:
            raise ValidationError(f"Item {_item_label(item)}: {exc}") from exc

    ink_contract = resolve_ink_contract(
        color_names=contract["color_names"],
        layer_snapshot=item.layer_snapshot or [],
        strict=True,
    )

    printing["front_colors"] = [str(v).strip().upper() for v in art_front]
    printing["back_colors"] = [str(v).strip().upper() for v in art_back]
    printing["color_names"] = ink_contract["color_names"]
    artwork_ink_gsm = Decimal(str(contract.get("ink_gsm_total") or 0))
    if artwork_ink_gsm <= 0:
        legacy_ink_gsm = Decimal(str(
            printing.get("ink_gsm_total")
            or printing.get("ink_gsm")
            or fixed_attrs.get("default_ink_gsm_total")
            or fixed_attrs.get("default_ink_gsm")
            or 0
        ))
        if legacy_ink_gsm <= 0:
            raise ValidationError(
                f"Item {_item_label(item)}: total ink GSM must be greater than zero "
                f"when an approved artwork is attached."
            )
        contract = {
            **contract,
            "ink_gsm_total": float(legacy_ink_gsm),
            "ink_gsm": float(legacy_ink_gsm),
        }
    printing["ink_gsm_total"] = contract["ink_gsm_total"]
    printing["ink_gsm"] = contract["ink_gsm_total"]
    printing["ink_base_family"] = ink_contract["ink_base_family"]
    printing["artwork_id"] = str(artwork.id)
    printing["artwork_design_code"] = artwork.design_code
    printing["cylinder_required"] = print_type == "ROTO"
    printing = validate_frozen_printing_snapshot(
        printing,
        layer_snapshot=item.layer_snapshot or [],
        require_artwork=True,
        strict_inks=True,
    )

    return printing, False, str(artwork.id)


class SalesOrderService:
    @staticmethod
    def create_sales_order(payload):
        with transaction.atomic():
            customer = None
            customer_name = payload.get("customer_name")
            ship_to_customer = None
            ship_to_customer_name = payload.get("ship_to_customer_name")
            if payload.get("customer"):
                from ..models import Customer

                try:
                    customer = Customer.objects.get(id=payload.get("customer"))
                    if not customer_name:
                        customer_name = customer.name
                except Customer.DoesNotExist:
                    pass
            ship_to_id = payload.get("ship_to_customer") or payload.get("ship_to")
            if ship_to_id:
                from ..models import Customer

                try:
                    ship_to_customer = Customer.objects.get(id=ship_to_id)
                    ship_to_customer_name = ship_to_customer.name
                except Customer.DoesNotExist:
                    raise ValidationError("Ship-to customer was not found.")
            elif customer:
                ship_to_customer = customer
                ship_to_customer_name = customer.name

            order_geometry_override = sanitize_geometry_override(payload.get("geometry_override") or payload.get("geometry") or {})
            order = SalesOrder.objects.create(
                customer=customer,
                customer_name=customer_name or "Unknown Customer",
                ship_to_customer=ship_to_customer,
                ship_to_customer_name=ship_to_customer_name or customer_name or "Unknown Customer",
                address_override=str(payload.get("address_override") or payload.get("extra_address") or "").strip(),
                remarks=str(payload.get("remarks") or "").strip(),
                order_name=str(payload.get("order_name") or "").strip(),
                order_type=payload.get("order_type", "MTO"),
                delivery_date=payload.get("delivery_date"),
                geometry_override=order_geometry_override,
                status="DRAFT",
                execution_model_version=2,
            )

            items_data = payload.get("items", [])
            if not items_data and payload.get("template_id"):
                items_data = [
                    {
                        "template_id": payload.get("template_id"),
                        "sku_variant_id": payload.get("sku_variant_id"),
                        "repeat_source_item_id": payload.get("repeat_source_item_id"),
                        "qty_value": payload.get("qty_value"),
                        "qty_uom": payload.get("qty_uom"),
                        "mode": payload.get("mode", "TEMPLATE"),
                        "fg_type": payload.get("fg_type"),
                        "roll_form": payload.get("roll_form"),
                        "geometry": payload.get("geometry"),
                        "film_layers": payload.get("film_layers"),
                        "printing": payload.get("printing"),
                        "chemicals": payload.get("chemicals"),
                        "addons": payload.get("addons"),
                        "packaging_snapshot": payload.get("packaging_snapshot"),
                        "issue_policy_overrides": payload.get("issue_policy_overrides"),
                        "line_name": payload.get("line_name"),
                        "price_basis": payload.get("price_basis"),
                        "unit_price": payload.get("unit_price"),
                        "product_master": payload.get("product_master") or payload.get("product_master_id"),
                        "customer_product_overlay": payload.get("customer_product_overlay") or payload.get("customer_product_overlay_id"),
                    }
                ]

            if not items_data:
                raise ValidationError("At least one order item is required.")

            for raw_item_data in items_data:
                item_data = _merge_item_source_defaults(raw_item_data)
                overlay = _resolve_customer_product_overlay(item_data, customer=customer)
                product_master = _resolve_product_master(item_data, overlay=overlay, variant=item_data.get("_resolved_sku_variant"))
                v3_requested = (
                    bool(item_data.get("axis_values"))
                    or bool(item_data.get("customer_product_overlay") or item_data.get("customer_product_overlay_id"))
                    or bool(product_master and not item_data.get("_resolved_sku_variant"))
                )
                if v3_requested and not bool(getattr(settings, "ERP_V3_DEFAULT", True)):
                    raise ValidationError("Product Master sales flow is disabled by ERP_V3_DEFAULT.")
                if overlay and product_master and overlay.product_master_id != product_master.id:
                    raise ValidationError("customer_product_overlay must belong to the selected product_master.")
                product_variant = None
                if product_master and isinstance(item_data.get("axis_values"), dict) and item_data.get("axis_values"):
                    from apps.sales.services.axis_resolver import OrderResolutionService

                    resolved_line = OrderResolutionService.resolve_line(
                        {
                            **item_data,
                            "product_master": str(product_master.id),
                            "customer": str(customer.id) if customer else item_data.get("customer"),
                            "customer_product_overlay": str(overlay.id) if overlay else item_data.get("customer_product_overlay"),
                            "qty": item_data.get("qty_value"),
                            "quantity_uom": item_data.get("qty_uom"),
                        },
                        create_variant=True,
                    )
                    item_data["template_id"] = resolved_line["template"]
                    item_data["axis_values"] = deepcopy(resolved_line.get("axis_values") or {})
                    item_data["geometry"] = deepcopy(resolved_line.get("geometry_snapshot") or {})
                    item_data["film_layers"] = deepcopy(resolved_line.get("layer_snapshot") or [])
                    item_data["printing"] = deepcopy(resolved_line.get("printing_snapshot") or {})
                    item_data["addons"] = deepcopy(resolved_line.get("addons_snapshot") or [])
                    item_data["packaging_snapshot"] = deepcopy(resolved_line.get("packaging_snapshot") or {})
                    overlay_id = resolved_line.get("customer_product_overlay")
                    if overlay_id and (not overlay or str(overlay.id) != str(overlay_id)):
                        overlay = CustomerProductOverlay.objects.select_related("product_master", "customer", "default_artwork").get(
                            id=overlay_id,
                            active=True,
                        )
                    variant_id = resolved_line.get("product_variant")
                    if variant_id:
                        product_variant = ProductVariant.objects.get(id=variant_id, master=product_master, active=True)
                else:
                    product_variant = _resolve_product_variant(item_data, product_master)
                variant_geometry_snapshot = None
                if product_variant:
                    item_data.setdefault("axis_values", deepcopy(product_variant.axis_values or {}))
                    variant_geometry_snapshot = deepcopy(product_variant.geometry_snapshot or {})
                    item_data["geometry"] = deepcopy(product_variant.geometry_snapshot or item_data.get("geometry") or {})
                    item_data["film_layers"] = deepcopy(product_variant.layer_snapshot or item_data.get("film_layers") or [])
                template_id = item_data.get("template_id")
                if not template_id:
                    raise ValidationError("template_id is required for every sales order item.")
                try:
                    template = TemplateBlueprint.objects.get(id=template_id, status="LIVE", is_current_version=True)
                except TemplateBlueprint.DoesNotExist as exc:
                    raise ValidationError("template_id must point to the current LIVE template.") from exc

                if item_data.get("film_layers") is None and not product_master:
                    raise ValidationError(f"Item {template.name}: film_layers snapshot is required.")
                if item_data.get("printing") is None and not product_master:
                    raise ValidationError(f"Item {template.name}: printing snapshot is required.")
                if item_data.get("addons") is None and not product_master:
                    raise ValidationError(f"Item {template.name}: addons snapshot is required.")
                if product_master and (not item_data.get("addons")):
                    axis_addons = _addons_from_axis_values(item_data.get("axis_values") or {})
                    if axis_addons:
                        item_data["addons"] = axis_addons

                item_geometry_override = sanitize_geometry_override(item_data.get("geometry") or item_data.get("geometry_override") or order.geometry_override)
                normalized_geometry = normalize_geometry_override({}, item_geometry_override)
                normalized_geometry = _preserve_computed_geometry(normalized_geometry, variant_geometry_snapshot or item_data.get("geometry") or {})
                fg_type = str(template.fg_type or "POUCH").upper()
                if fg_type not in {"POUCH", "ROLL"}:
                    raise ValidationError(f"Item {template.name}: fg_type must be POUCH or ROLL.")
                normalized_geometry["finished_good_type"] = fg_type
                if isinstance(item_data.get("axis_values"), dict):
                    normalized_geometry["axis_values"] = deepcopy(item_data.get("axis_values") or {})
                if product_variant:
                    normalized_geometry["product_variant_code"] = product_variant.code
                qty_uom = str(item_data.get("qty_uom", "KG") or "KG").upper()
                if fg_type == "ROLL":
                    normalized_geometry["roll_form"] = str(item_data.get("roll_form") or "FLAT").upper()
                    normalized_geometry.pop("repeat_length_mm", None)
                    base = normalized_geometry.get("base") if isinstance(normalized_geometry.get("base"), dict) else {}
                    base["height_mm"] = 0.0
                    normalized_geometry["base"] = base
                    qty_uom = "KG"
                else:
                    normalized_geometry.pop("roll_form", None)
                    normalized_geometry = validate_pouch_geometry_contract(
                        fg_type=fg_type,
                        geometry=normalized_geometry,
                        addons=item_data.get("addons") or [],
                        template_pouch_style=str(getattr(template, "pouch_style", "") or ""),
                        context_label=f"Item {template.name}",
                    )
                    normalized_geometry = _preserve_computed_geometry(normalized_geometry, variant_geometry_snapshot or item_data.get("geometry") or {})

                qty_value = Decimal(str(item_data.get("qty_value", 0) or 0))
                layer_snapshot = _normalize_layer_snapshot(item_data.get("film_layers") or [], strict=not bool(product_master))
                _validate_template_film_constraints(template, layer_snapshot, template.name)
                printing_snapshot = _normalize_printing_snapshot(item_data.get("printing"))
                addons_snapshot = item_data.get("addons") or []
                raw_packaging_snapshot = _merge_axis_packaging_snapshot(
                    item_data.get("packaging_snapshot") or {},
                    item_data.get("axis_values") or {},
                    overlay=overlay,
                )
                packaging_snapshot = _normalize_packaging_snapshot(raw_packaging_snapshot)
                if isinstance(raw_packaging_snapshot, dict):
                    for key in ("default_packing_note", "default_packing_recipe", "customer_overlay"):
                        if key in raw_packaging_snapshot:
                            packaging_snapshot[key] = deepcopy(raw_packaging_snapshot.get(key))
                if fg_type == "POUCH":
                    pod_cfg = packaging_snapshot.get("pod") if isinstance(packaging_snapshot.get("pod"), dict) else {}
                    packaging_snapshot["pod"] = _hydrate_pod_snapshot(pod_cfg)
                else:
                    packaging_snapshot["pod"] = {"enabled": False, "pod_profile_id": None, "pod_sku_variant_id": None}
                raw_line_name = str(item_data.get("line_name") or payload.get("line_name") or "").strip()
                line_name = raw_line_name
                if product_master or product_variant or overlay or item_data.get("axis_values"):
                    line_name = _canonical_sales_line_label(
                        item_data={**item_data, "line_name": raw_line_name},
                        geometry=normalized_geometry,
                        layers=layer_snapshot,
                        printing=printing_snapshot,
                        addons=addons_snapshot,
                        packaging=packaging_snapshot,
                        product_master=product_master,
                        product_variant=product_variant,
                        overlay=overlay,
                        fallback=str(getattr(template, "name", "") or ""),
                    )
                price_basis = str(item_data.get("price_basis") or payload.get("price_basis") or "KG").upper()
                if price_basis not in {"KG", "PCS"}:
                    raise ValidationError(f"Item {template.name}: price_basis must be KG or PCS.")
                if fg_type == "ROLL":
                    price_basis = "KG"
                unit_price = Decimal(str(item_data.get("unit_price", payload.get("unit_price", 0)) or 0))
                if unit_price <= 0:
                    raise ValidationError(f"Item {template.name}: unit_price must be greater than zero.")
                try:
                    preferred_lane_count = int(item_data.get("preferred_lane_count") or item_data.get("lane_count") or 1)
                except Exception:
                    preferred_lane_count = 1
                if preferred_lane_count < 1:
                    preferred_lane_count = 1
                lane_count_source = str(item_data.get("lane_count_source") or "POLICY_DEFAULT").upper()
                if lane_count_source not in {"REPEAT_DEFAULT", "OPERATOR_CHOICE", "POLICY_DEFAULT"}:
                    lane_count_source = "OPERATOR_CHOICE"
                spec_payload = build_spec_payload(
                    fg_type=fg_type,
                    roll_form=normalized_geometry.get("roll_form"),
                    geometry=normalized_geometry,
                    film_layers=layer_snapshot,
                    printing=printing_snapshot,
                    addons=addons_snapshot,
                )
                spec_signature = build_spec_signature(spec_payload)
                inv_payload = build_invariant_payload(film_layers=layer_snapshot, printing=printing_snapshot)

                item = SalesOrderItem.objects.create(
                    sales_order=order,
                    template=template,
                    mode=item_data.get("mode", "TEMPLATE"),
                    product_master=product_master,
                    product_variant=product_variant,
                    customer_product_overlay=overlay,
                    sku_variant=item_data.get("_resolved_sku_variant"),
                    repeat_source_item=item_data.get("_resolved_repeat_source_item"),
                    line_name=line_name,
                    qty_uom=qty_uom,
                    qty_value=qty_value,
                    price_basis=price_basis,
                    unit_price=unit_price,
                    axis_values=item_data.get("axis_values") or {},
                    source_chip=str(item_data.get("source_chip") or "WIZARD").upper(),
                    source_ref=str(item_data.get("source_ref") or ""),
                    material_overrides=item_data.get("material_overrides") or [],
                    geometry_snapshot=normalized_geometry,
                    layer_snapshot=layer_snapshot,
                    printing_snapshot=printing_snapshot,
                    addons_snapshot=addons_snapshot,
                    packaging_snapshot=packaging_snapshot,
                    spec_signature=spec_signature,
                    invariant_signature=build_invariant_signature(inv_payload),
                    preferred_lane_count=preferred_lane_count,
                    lane_count_source=lane_count_source,
                )

                preview_data = {
                    "finished_good_type": fg_type,
                    "geometry": item.geometry_snapshot,
                    "film_layers": item.layer_snapshot,
                    "printing": printing_snapshot,
                    "chemicals": printing_snapshot.get("chemicals") or {},
                    "addons": item.addons_snapshot,
                    "packaging_snapshot": item.packaging_snapshot,
                    "template_id": str(template.id),
                    "issue_policy_overrides": item_data.get("issue_policy_overrides") or [],
                    "roll_form": normalized_geometry.get("roll_form"),
                    "order_qty": float(item.qty_value),
                    "uom": qty_uom,
                }
                preview = SalesOrderService.preview_sales_item(preview_data)
                item.unit_weight_g = Decimal(str(preview["unit_weight_g"]))
                item.total_weight_kg = Decimal(str(preview["total_weight_kg"]))
                item.packaging_snapshot = _materialize_packaging_snapshot_quantities(
                    item.packaging_snapshot,
                    preview_data,
                    item.unit_weight_g,
                    item.total_weight_kg,
                )
                item.bom_snapshot = _make_json_serializable(preview["bom"])
                item.save(update_fields=["unit_weight_g", "total_weight_kg", "packaging_snapshot", "bom_snapshot"])

            return order

    @staticmethod
    def create_sales_order_batch(payload):
        customer_id = payload.get("customer")
        customer_name = payload.get("customer_name")
        orders_data = payload.get("orders") or []
        if not isinstance(orders_data, list) or not orders_data:
            raise ValidationError("orders must contain at least one queued sales order.")

        results = []
        for index, raw_order in enumerate(orders_data):
            row = raw_order if isinstance(raw_order, dict) else {}
            client_reference = str(row.get("client_reference") or "").strip()
            source_type = str(row.get("source_type") or "CUSTOM").upper()
            row_payload = {
                "customer": customer_id,
                "customer_name": customer_name,
                "ship_to_customer": row.get("ship_to_customer") or payload.get("ship_to_customer") or payload.get("ship_to"),
                "ship_to_customer_name": row.get("ship_to_customer_name") or payload.get("ship_to_customer_name"),
                "address_override": row.get("address_override") or row.get("extra_address") or payload.get("address_override") or payload.get("extra_address") or "",
                "remarks": row.get("remarks") or payload.get("remarks") or "",
                "order_name": str(row.get("order_name") or "").strip(),
                "order_type": str(row.get("order_type") or "MTO").upper(),
                "delivery_date": row.get("delivery_date"),
                "items": row.get("items") or [],
            }
            try:
                items = row_payload["items"]
                if not isinstance(items, list) or len(items) != 1:
                    raise ValidationError("Each queued sales order must contain exactly one item.")
                item = items[0]
                if not isinstance(item, dict):
                    raise ValidationError("Queued sales order item must be an object.")
                if source_type == "CUSTOM":
                    item.setdefault("mode", "CUSTOM")
                elif source_type == "REPEAT":
                    item.setdefault("mode", "REPEAT")
                else:
                    item.setdefault("mode", "TEMPLATE")

                with transaction.atomic():
                    order = SalesOrderService.create_sales_order(row_payload)
                    confirmed_order = SalesOrderService.confirm_sales_order(order.id)

                results.append(
                    {
                        "client_reference": client_reference or str(index),
                        "source_type": source_type,
                        "status": "created",
                        "sales_order_id": str(confirmed_order.id),
                        "sales_order_number": confirmed_order.order_number,
                        "error": "",
                    }
                )
            except Exception as exc:
                results.append(
                    {
                        "client_reference": client_reference or str(index),
                        "source_type": source_type,
                        "status": "failed",
                        "sales_order_id": "",
                        "sales_order_number": "",
                        "error": str(exc),
                    }
                )

        created_count = sum(1 for row in results if row["status"] == "created")
        failed_count = len(results) - created_count
        return {
            "customer": customer_id,
            "customer_name": customer_name,
            "created_count": created_count,
            "failed_count": failed_count,
            "results": results,
        }

    @staticmethod
    def preview_sales_item(payload):
        normalized_payload = dict(payload or {})
        fg_type = _resolve_preview_fg_type(normalized_payload)
        normalized_payload["finished_good_type"] = fg_type
        normalized_payload["geometry"] = _normalize_preview_geometry(normalized_payload.get("geometry") or {}, fg_type)
        if fg_type == "POUCH":
            normalized_payload["geometry"] = validate_pouch_geometry_contract(
                fg_type=fg_type,
                geometry=normalized_payload.get("geometry") or {},
                addons=normalized_payload.get("addons") or [],
                template_pouch_style=str(normalized_payload.get("pouch_style") or ""),
                context_label="Preview item",
            )
        normalized_payload["film_layers"] = _normalize_layer_snapshot(normalized_payload.get("film_layers") or [], strict=False)
        qty_uom = str(normalized_payload.get("uom", "KG") or "KG").upper()
        if fg_type == "ROLL" and qty_uom != "KG":
            raise ValidationError("Roll preview requires KG quantity.")
        if fg_type == "ROLL":
            normalized_payload["uom"] = "KG"
        packaging_source = normalized_payload.get("packaging_snapshot") or normalized_payload.get("packaging") or {}
        packaging_snapshot = _normalize_packaging_snapshot(packaging_source)
        if fg_type == "POUCH":
            pod_cfg = packaging_snapshot.get("pod") if isinstance(packaging_snapshot.get("pod"), dict) else {}
            packaging_snapshot["pod"] = _hydrate_pod_snapshot(pod_cfg) if pod_cfg.get("enabled") else {
                "enabled": False,
                "pod_profile_id": None,
                "pod_sku_variant_id": None,
                "pod_sku_code": None,
                "pod_sku_name": None,
            }
        else:
            packaging_snapshot["pod"] = {"enabled": False, "pod_profile_id": None, "pod_sku_variant_id": None}
        normalized_payload["packaging_snapshot"] = packaging_snapshot
        physics_result = PhysicsEngine.calculate(normalized_payload)
        unit_weight_g = physics_result.get("unit_weight_g", 0) or 0

        printing = normalized_payload.get("printing") or {}
        if printing.get("enabled") and printing.get("artwork_id"):
            artwork = Artwork.objects.filter(id=printing["artwork_id"]).first()
            if artwork:
                contract = get_artwork_contract(artwork, require_asset=False, require_ink_usage=False)
                art_front = [str(v).strip() for v in (contract.get("front_colors") or []) if str(v).strip()]
                art_back = [str(v).strip() for v in (contract.get("back_colors") or []) if str(v).strip()]
                if not art_front and not art_back:
                    legacy_colors = [str(v).strip() for v in (artwork.color_list or []) if str(v).strip()]
                    if legacy_colors:
                        art_front = legacy_colors
                printing["front_colors"] = [str(v).strip().upper() for v in art_front]
                printing["back_colors"] = [str(v).strip().upper() for v in art_back]
                printing["color_names"] = [str(v).strip().upper() for v in (art_front + art_back) if str(v).strip()]
                printing["ink_gsm_total"] = contract.get("ink_gsm_total") or printing.get("ink_gsm_total") or printing.get("ink_gsm") or 0
                printing["ink_gsm"] = printing["ink_gsm_total"]

        try:
            bom_result = BOMResolverService.resolve(normalized_payload, physics_result)
            _normalize_pod_bom_to_unit_scope(bom_result, physics_result, fg_type)
        except Exception as exc:
            bom_result = {
                "films": [],
                "granules": [],
                "inks": [],
                "chemicals": [],
                "addons": [],
                "is_complete": False,
                "errors": [str(exc)],
                "summary": {"unit_weight_g": float(round(unit_weight_g, 4))},
            }

        qty_value = Decimal(str(normalized_payload.get("order_qty", 0)))
        qty_uom = str(normalized_payload.get("uom", "KG") or "KG").upper()
        if fg_type == "ROLL":
            total_weight_kg = qty_value
        elif qty_uom == "KG":
            total_weight_kg = qty_value
        else:
            total_weight_kg = (Decimal(str(unit_weight_g)) * qty_value) / Decimal("1000")

        components = []
        roll_kg_absolute_mode = qty_uom == "KG" and fg_type == "ROLL"
        if fg_type == "ROLL":
            sim_qty = Decimal("1")
        elif qty_uom == "PCS":
            sim_qty = qty_value
        elif unit_weight_g > 0:
            sim_qty = (qty_value * Decimal("1000")) / Decimal(str(unit_weight_g))
        else:
            sim_qty = Decimal("1") if qty_uom == "KG" else Decimal("0")

        order_scoped_categories = set()
        for category in ["films", "granules", "inks", "chemicals", "addons", "pod"]:
            for row in bom_result.get(category, []):
                unit_weight = Decimal(str(row.get("weight_kg", 0)))
                total_qty = unit_weight if (roll_kg_absolute_mode or category in order_scoped_categories) else (unit_weight * sim_qty)
                material_name = row.get("name") or row.get("code") or f"Unknown {category[:-1]}"
                existing = next((c for c in components if c["material_name"] == material_name), None)
                if existing:
                    existing["qty"] = float(round(Decimal(str(existing["qty"])) + total_qty, 4))
                else:
                    components.append(
                        {
                            "material_name": material_name,
                            "qty": float(round(total_qty, 4)),
                            "uom": "KG",
                        }
                    )

        planning_lines = _build_material_plan_lines(
            normalized_payload,
            bom_result,
            quantity_multiplier=sim_qty,
            order_scoped_sections=order_scoped_categories,
        )
        packaging_rows, packaging_plan_lines = _build_packaging_bom_rows(
            normalized_payload,
            unit_weight_g,
            total_weight_kg,
        )
        if packaging_rows:
            bom_result["packaging"] = packaging_rows
            for row in packaging_rows:
                material_name = row.get("material_name") or row.get("material_code") or "Packaging material"
                components.append(
                    {
                        "material_name": material_name,
                        "qty": row.get("qty") or 0,
                        "uom": row.get("uom") or "PCS",
                    }
                )
        if packaging_plan_lines:
            planning_lines.extend(packaging_plan_lines)
        planning_summary = _summarize_material_plan_lines(planning_lines)
        bom_payload = dict(bom_result or {})
        bom_payload["planning_lines"] = planning_lines
        bom_payload["planning_summary"] = planning_summary
        bom_payload["issue_policy_overrides"] = (
            deepcopy(normalized_payload.get("issue_policy_overrides"))
            if isinstance(normalized_payload.get("issue_policy_overrides"), list)
            else []
        )

        theoretical_lines = [
            {
                "policy_key": row.get("policy_key"),
                "category_code": row.get("category_code"),
                "material_id": row.get("material_id"),
                "material_code": row.get("material_code"),
                "material_name": row.get("material_name"),
                "uom": row.get("uom") or "KG",
                "theoretical_qty": row.get("theoretical_qty"),
                "template_issue_policy_mode": row.get("template_issue_policy_mode"),
                "template_issue_policy_value": row.get("template_issue_policy_value"),
                "step_id": row.get("step_id"),
                "step_sequence": row.get("step_sequence"),
                "step_name": row.get("step_name"),
            }
            for row in planning_lines
        ]
        planned_issue_lines = [
            {
                "policy_key": row.get("policy_key"),
                "category_code": row.get("category_code"),
                "material_id": row.get("material_id"),
                "material_code": row.get("material_code"),
                "material_name": row.get("material_name"),
                "uom": row.get("uom") or "KG",
                "planned_issue_qty": row.get("planned_issue_qty"),
                "template_issue_policy_mode": row.get("template_issue_policy_mode"),
                "template_issue_policy_value": row.get("template_issue_policy_value"),
                "override_issue_policy_mode": row.get("override_issue_policy_mode"),
                "override_issue_policy_value": row.get("override_issue_policy_value"),
                "effective_issue_policy_mode": row.get("effective_issue_policy_mode"),
                "effective_issue_policy_value": row.get("effective_issue_policy_value"),
                "policy_source": row.get("policy_source"),
                "step_id": row.get("step_id"),
                "step_sequence": row.get("step_sequence"),
                "step_name": row.get("step_name"),
            }
            for row in planning_lines
        ]

        return {
            "unit_weight_g": float(round(unit_weight_g, 4)),
            "total_weight_kg": float(round(total_weight_kg, 4)),
            "physics": physics_result,
            "roll_preview": physics_result.get("roll_preview"),
            "final_product_type": fg_type,
            "bom": bom_payload,
            "bom_preview": {
                "components": components,
                "theoretical_lines": theoretical_lines,
                "planned_issue_lines": planned_issue_lines,
                "planning_summary": planning_summary,
            },
        }

    @staticmethod
    def preview_payload_from_item(item):
        fg_type = str(getattr(getattr(item, "template", None), "fg_type", "") or "").upper()
        return {
            "finished_good_type": fg_type or (item.geometry_snapshot or {}).get("finished_good_type"),
            "geometry": item.geometry_snapshot or {},
            "film_layers": item.layer_snapshot or [],
            "printing": item.printing_snapshot or {},
            "chemicals": (item.printing_snapshot or {}).get("chemicals") or {},
            "addons": item.addons_snapshot or [],
            "packaging_snapshot": item.packaging_snapshot or {},
            "roll_form": (item.geometry_snapshot or {}).get("roll_form"),
            "order_qty": float(item.qty_value or 0),
            "uom": "KG" if fg_type == "ROLL" else item.qty_uom,
        }

    @staticmethod
    def rebuild_bom_snapshot_for_item(item, *, save=True, require_ready=False):
        preview = SalesOrderService.preview_sales_item(SalesOrderService.preview_payload_from_item(item))
        item.bom_snapshot = _make_json_serializable(preview.get("bom") or {})
        try:
            from apps.production.services.roll_allocation_service import layer_signature_hash

            sig = layer_signature_hash(item.layer_snapshot or [])
            if isinstance(item.bom_snapshot, dict):
                item.bom_snapshot["layer_signature_hash"] = sig
        except Exception as exc:
            logger.warning(
                "rebuild_bom_snapshot_for_item: layer signature hash failed for item %s: %s",
                getattr(item, "id", None),
                exc,
                exc_info=True,
            )

        item.unit_weight_g = Decimal(str(preview.get("unit_weight_g") or 0))
        item.total_weight_kg = Decimal(str(preview.get("total_weight_kg") or 0))
        if require_ready:
            from apps.bom.readiness import require_bom_ready_for_production

            require_bom_ready_for_production(item, label=f"Sales line {getattr(item, 'id', '')}")
        if save:
            item.save(update_fields=["bom_snapshot", "unit_weight_g", "total_weight_kg"])
        return preview

    @staticmethod
    def create_custom_order(payload):
        raise ValidationError("Custom template/R&D sales flow is removed in V2 hard-cut.")

    @staticmethod
    def try_complete(order_id):
        """If every line on the order is fully dispatched (qty_open == 0),
        transition the SO to COMPLETED. Safe to call repeatedly; no-op on
        an already-COMPLETED or CANCELLED order. Returns the (re-fetched) order.
        """
        with transaction.atomic():
            order = (
                SalesOrder.objects.select_for_update()
                .prefetch_related("items", "items__dispatch_lines", "items__dispatch_lines__dispatch")
                .get(id=order_id)
            )
            if order.status in {"COMPLETED", "CANCELLED"}:
                return order
            items = list(order.items.all())
            if not items:
                return order
            for item in items:
                if (item.qty_open or Decimal("0")) > Decimal("0"):
                    return order
            order.status = "COMPLETED"
            order.completed_at = timezone.now()
            order.save(update_fields=["status", "completed_at"])
            return order

    @staticmethod
    def _line_qty_from_kg(item, qty_kg):
        qty_kg = Decimal(str(qty_kg or 0))
        if qty_kg <= 0:
            return Decimal("0")
        if str(getattr(item, "qty_uom", "") or "KG").upper() == "KG":
            return qty_kg
        unit_weight_g = Decimal(str(getattr(item, "unit_weight_g", 0) or 0))
        if unit_weight_g <= 0:
            return Decimal("0")
        return (qty_kg * Decimal("1000")) / unit_weight_g

    @staticmethod
    def line_final_output_kg(item):
        """Final-route output already completed for this sales line."""
        from apps.production.models import JobExecutionLog, ProductionJob

        if not item:
            return Decimal("0")
        jobs = (
            ProductionJob.objects.filter(sales_order_item=item, job_state="COMPLETED")
            .select_related("routing_rule")
            .only("id", "current_step_index", "routing_rule__ordered_processes")
        )
        final_job_ids = []
        for job in jobs:
            ordered = list(getattr(job.routing_rule, "ordered_processes", None) or [])
            route_last_index = max(0, len(ordered) - 1)
            if int(getattr(job, "current_step_index", 0) or 0) >= route_last_index:
                final_job_ids.append(job.id)
        if not final_job_ids:
            return Decimal("0")
        total = Decimal("0")
        unit_weight_g = Decimal(str(getattr(item, "unit_weight_g", 0) or 0))
        for log in JobExecutionLog.objects.filter(production_job_id__in=final_job_ids).only("quantity", "uom"):
            qty = Decimal(str(getattr(log, "quantity", 0) or 0))
            uom = str(getattr(log, "uom", "") or "KG").upper()
            if uom == "KG":
                total += qty
            elif uom == "PCS" and unit_weight_g > 0:
                total += (qty * unit_weight_g) / Decimal("1000")
        return total

    @staticmethod
    def line_final_output_qty(item):
        return SalesOrderService._line_qty_from_kg(item, SalesOrderService.line_final_output_kg(item))

    @staticmethod
    def line_dispatchable_qty(item):
        status = str(getattr(item, "line_status", "") or "").upper()
        if status in {"PACKING_READY", "DISPATCH_READY", "COMPLETED"}:
            return Decimal(str(getattr(item, "qty_open", 0) or 0))
        if status != "PARTIAL":
            return Decimal("0")
        final_output_qty = SalesOrderService.line_final_output_qty(item)
        already_dispatched = Decimal(str(getattr(item, "qty_dispatched", 0) or 0))
        open_qty = Decimal(str(getattr(item, "qty_open", 0) or 0))
        dispatchable = final_output_qty - already_dispatched
        if dispatchable <= 0:
            return Decimal("0")
        return min(dispatchable, open_qty)

    @staticmethod
    def line_replan_remaining_qty(item):
        open_qty = Decimal(str(getattr(item, "qty_open", 0) or 0))
        if str(getattr(item, "line_status", "") or "").upper() != "PARTIAL":
            return open_qty
        return max(Decimal("0"), open_qty - SalesOrderService.line_dispatchable_qty(item))

    @staticmethod
    def line_replan_remaining_kg(item):
        remaining_qty = SalesOrderService.line_replan_remaining_qty(item)
        if remaining_qty <= 0:
            return Decimal("0")
        if str(getattr(item, "qty_uom", "") or "KG").upper() == "KG":
            return remaining_qty
        unit_weight_g = Decimal(str(getattr(item, "unit_weight_g", 0) or 0))
        if unit_weight_g <= 0:
            return Decimal("0")
        return (remaining_qty * unit_weight_g) / Decimal("1000")

    @staticmethod
    def _close_item_remaining(item, *, mode, reason):
        remaining = Decimal(str(item.qty_open or 0))
        if remaining <= 0:
            return Decimal("0")
        if mode == "CANCEL":
            item.qty_cancelled = Decimal(str(item.qty_cancelled or 0)) + remaining
            item.line_status = "CANCELLED"
        elif mode == "SHORT_CLOSE":
            item.qty_short_closed = Decimal(str(item.qty_short_closed or 0)) + remaining
            item.line_status = "SHORT_CLOSED"
        else:
            raise ValidationError("Unsupported line close mode.")
        item.line_closed_reason = str(reason or "").strip()
        item.line_closed_at = timezone.now()
        item.save(
            update_fields=[
                "qty_cancelled",
                "qty_short_closed",
                "line_status",
                "line_closed_reason",
                "line_closed_at",
            ]
        )
        return remaining

    @staticmethod
    def _sync_order_after_line_closure(order):
        return SalesOrderService.sync_order_status_from_lines(order)

    @staticmethod
    def sync_order_status_from_lines(order):
        order.refresh_from_db()
        items = list(order.items.all())
        if not items:
            return order
        if all(str(item.line_status or "").upper() == "CANCELLED" for item in items):
            order.status = "CANCELLED"
            order.save(update_fields=["status"])
            return order
        if all(Decimal(str(item.qty_open or 0)) <= Decimal("0") for item in items):
            order.status = "COMPLETED"
            order.completed_at = timezone.now()
            order.save(update_fields=["status", "completed_at"])
            return order
        statuses = {str(item.line_status or "").upper() for item in items}
        if statuses & {"OPEN", "PLANNING_REQUIRED", "PARTIAL"}:
            next_status = "PLANNING_REQUIRED"
        elif statuses & {"RELEASED", "IN_PRODUCTION"}:
            next_status = "RELEASED"
        elif statuses & {"PLANNED"}:
            next_status = "PLANNED"
        elif statuses & {"PACKING_READY", "DISPATCH_READY"}:
            next_status = "PACKING_READY"
        else:
            next_status = order.status
        if next_status != order.status:
            order.status = next_status
            order.save(update_fields=["status"])
        return order

    @staticmethod
    def cancel_sales_order_lines(order_id, *, item_ids, user=None, reason=""):
        from apps.production.models import ProductionJob

        item_ids = [str(item_id) for item_id in (item_ids or []) if str(item_id or "").strip()]
        if not item_ids:
            raise ValidationError("Select at least one sales order line to cancel.")
        reason = str(reason or "").strip()
        if not reason:
            raise ValidationError("Reason is required to cancel sales order lines.")

        with transaction.atomic():
            order = SalesOrder.objects.select_for_update().prefetch_related("items").get(id=order_id)
            if order.status in ["RELEASED", "PACKING_READY", "DISPATCH_READY", "COMPLETED", "CANCELLED"]:
                raise ValidationError("Released orders must be changed from Planner, not Sales.")

            items = list(order.items.select_for_update().filter(id__in=item_ids))
            if len(items) != len(set(item_ids)):
                raise ValidationError("One or more selected lines do not belong to this sales order.")

            jobs = list(ProductionJob.objects.select_for_update().filter(sales_order_item__in=items))
            blocking = [
                job for job in jobs
                if str(job.job_state).upper() in {"RELEASED", "EXECUTING", "PAUSED", "COMPLETED"}
                or str(job.status).upper() in {"RUNNING", "COMPLETED"}
            ]
            if blocking:
                raise ValidationError("Selected line already has released, running, or completed production. Use Planner.")

            for job in jobs:
                job.job_state = "CANCELLED"
                job.status = "CANCELLED"
                job.hold_reason = reason[:255]
                job.save(update_fields=["job_state", "status", "hold_reason", "updated_at"])

            for item in items:
                SalesOrderService._close_item_remaining(item, mode="CANCEL", reason=reason)

            return SalesOrderService._sync_order_after_line_closure(order)

    @staticmethod
    def planner_cancel_sales_order_item(item_id, *, user=None, reason=""):
        from apps.production.models import (
            DowntimeLog,
            JobExecutionLog,
            MaterialConsumptionLog,
            ProductionJob,
            ScrapLog,
        )

        reason = str(reason or "").strip()
        if not reason:
            raise ValidationError("Reason is required to cancel a released line.")
        with transaction.atomic():
            item = SalesOrderItem.objects.select_for_update().select_related("sales_order").get(id=item_id)
            order = item.sales_order
            if order.status in {"COMPLETED", "CANCELLED"}:
                raise ValidationError(f"Order is already {order.status}.")
            if str(item.line_status or "").upper() in {"CANCELLED", "COMPLETED", "SHORT_CLOSED"}:
                raise ValidationError(f"Line is already {item.line_status}.")

            jobs = list(ProductionJob.objects.select_for_update().filter(sales_order_item=item))
            started = any(str(job.job_state).upper() in {"EXECUTING", "PAUSED"} or str(job.status).upper() == "RUNNING" for job in jobs)
            if (
                started
                or JobExecutionLog.objects.filter(production_job__in=jobs).exists()
                or ScrapLog.objects.filter(production_job__in=jobs).exists()
                or DowntimeLog.objects.filter(production_job__in=jobs).exists()
                or MaterialConsumptionLog.objects.filter(production_job__in=jobs).exists()
            ):
                raise ValidationError("Line has machine activity. Use short-close for the remaining quantity.")

            for job in jobs:
                if str(job.job_state).upper() != "COMPLETED":
                    job.job_state = "CANCELLED"
                    job.status = "CANCELLED"
                    job.hold_reason = reason[:255]
                    job.save(update_fields=["job_state", "status", "hold_reason", "updated_at"])

            SalesOrderService._close_item_remaining(item, mode="CANCEL", reason=reason)
            return SalesOrderService._sync_order_after_line_closure(order)

    @staticmethod
    def planner_short_close_sales_order_item(item_id, *, user=None, reason="", close_qty_kg=None):
        reason = str(reason or "").strip()
        if not reason:
            raise ValidationError("Reason is required for short-close.")
        with transaction.atomic():
            item = SalesOrderItem.objects.select_for_update().select_related("sales_order").get(id=item_id)
            order = item.sales_order
            if order.status in {"COMPLETED", "CANCELLED"}:
                raise ValidationError(f"Order is already {order.status}.")
            if str(item.line_status or "").upper() in {"CANCELLED", "COMPLETED", "SHORT_CLOSED"}:
                raise ValidationError(f"Line is already {item.line_status}.")

            if close_qty_kg is not None:
                close_qty = SalesOrderService._line_qty_from_kg(item, close_qty_kg)
                if close_qty <= 0:
                    raise ValidationError("Short-close quantity could not be resolved for this line.")
                current_open = Decimal(str(item.qty_open or 0))
                close_qty = min(close_qty, current_open)
                item.qty_short_closed = Decimal(str(item.qty_short_closed or 0)) + close_qty
                remaining_after = current_open - close_qty
                item.line_status = "SHORT_CLOSED" if remaining_after <= Decimal("0.001") else "PACKING_READY"
                item.line_closed_reason = reason
                item.line_closed_at = timezone.now()
                item.save(update_fields=["qty_short_closed", "line_status", "line_closed_reason", "line_closed_at"])
            else:
                SalesOrderService._close_item_remaining(item, mode="SHORT_CLOSE", reason=reason)

            order = SalesOrderService.sync_order_status_from_lines(order)
            SalesOrderService.try_complete(order.id)
            order.refresh_from_db()
            return order

    @staticmethod
    def confirm_sales_order(order_id):
        with transaction.atomic():
            order = SalesOrder.objects.select_for_update().get(id=order_id)
            if order.status not in ["DRAFT", "CONFIRMED"]:
                raise ValidationError(f"Order cannot be confirmed from status {order.status}.")

            for item in order.items.all():
                if item.template.status != "LIVE":
                    raise ValidationError(f"Item {item.template.name} is not LIVE.")
                has_routing = bool(
                    getattr(item.template, "routing_rule_id", None)
                    or getattr(item.template, "routing_rule", None)
                )
                if not has_routing:
                    raise ValidationError(f"Item {item.template.name} has no routing rule assigned.")

                if not hasattr(item, "geometry_snapshot"):
                    item.geometry_snapshot = {}
                if not hasattr(item, "layer_snapshot"):
                    item.layer_snapshot = []
                if not hasattr(item, "packaging_snapshot"):
                    item.packaging_snapshot = {}
                if not hasattr(item, "printing_snapshot"):
                    item.printing_snapshot = {}
                if not hasattr(item, "addons_snapshot"):
                    item.addons_snapshot = []

                normalized_geometry = normalize_geometry_override({}, item.geometry_snapshot or order.geometry_override)
                fg_type = str(item.template.fg_type or "POUCH").upper()
                if fg_type not in {"POUCH", "ROLL"}:
                    fg_type = "POUCH"
                normalized_geometry["finished_good_type"] = fg_type
                if fg_type == "ROLL":
                    normalized_geometry["roll_form"] = str((item.geometry_snapshot or {}).get("roll_form") or "FLAT").upper()
                    normalized_geometry.pop("repeat_length_mm", None)
                    base = normalized_geometry.get("base") if isinstance(normalized_geometry.get("base"), dict) else {}
                    base["height_mm"] = 0.0
                    normalized_geometry["base"] = base
                    item.qty_uom = "KG"
                    item.price_basis = "KG"
                else:
                    normalized_geometry.pop("roll_form", None)

                item.geometry_snapshot = _preserve_computed_geometry(
                    normalized_geometry,
                    item.geometry_snapshot or order.geometry_override,
                )
                item.layer_snapshot = _normalize_layer_snapshot(item.layer_snapshot or [])
                _validate_template_film_constraints(item.template, item.layer_snapshot, item.template.name)
                item.packaging_snapshot = _normalize_packaging_snapshot(item.packaging_snapshot or {})
                if fg_type == "POUCH":
                    pod_cfg = item.packaging_snapshot.get("pod") if isinstance(item.packaging_snapshot.get("pod"), dict) else {}
                    item.packaging_snapshot["pod"] = _hydrate_pod_snapshot(pod_cfg)
                else:
                    item.packaging_snapshot["pod"] = {"enabled": False, "pod_profile_id": None, "pod_sku_variant_id": None}
                (
                    normalized_printing,
                    artwork_required,
                    assigned_artwork_id,
                ) = _validate_printing_snapshot_for_confirm(
                    item,
                    allow_missing_artwork=True,
                )
                item.printing_snapshot = normalized_printing
                item.artwork_assignment_required = bool(artwork_required)
                item.assigned_artwork_id = assigned_artwork_id
                spec_payload = build_spec_payload(
                    fg_type=fg_type,
                    roll_form=item.geometry_snapshot.get("roll_form"),
                    geometry=item.geometry_snapshot,
                    film_layers=item.layer_snapshot or [],
                    printing=item.printing_snapshot or {},
                    addons=item.addons_snapshot or [],
                )
                item.spec_signature = build_spec_signature(spec_payload)
                inv_payload = build_invariant_payload(
                    film_layers=item.layer_snapshot or [],
                    printing=item.printing_snapshot or {}
                )
                item.invariant_signature = build_invariant_signature(inv_payload)

                preview_data = {
                    "finished_good_type": fg_type,
                    "geometry": item.geometry_snapshot,
                    "film_layers": item.layer_snapshot or [],
                    "printing": item.printing_snapshot or {},
                    "chemicals": (item.printing_snapshot or {}).get("chemicals") or {},
                    "addons": item.addons_snapshot or [],
                    "packaging_snapshot": item.packaging_snapshot or {},
                    "roll_form": item.geometry_snapshot.get("roll_form"),
                    "order_qty": float(item.qty_value),
                    "uom": "KG" if fg_type == "ROLL" else item.qty_uom,
                }
                preview = SalesOrderService.preview_sales_item(preview_data)

                if bool((item.printing_snapshot or {}).get("enabled", False)):
                    inks = ((preview or {}).get("bom") or {}).get("inks") or []
                    if not inks and not item.artwork_assignment_required:
                        raise ValidationError(f"Item {item.template.name}: printing enabled but no inks resolved.")

                item.bom_snapshot = _make_json_serializable(preview["bom"])
                try:
                    from apps.production.services.roll_allocation_service import layer_signature_hash
                    sig = layer_signature_hash(item.layer_snapshot or [])
                    if isinstance(item.bom_snapshot, dict):
                        item.bom_snapshot["layer_signature_hash"] = sig
                except Exception as exc:
                    logger.warning(
                        "confirm_sales_order: layer signature hash failed for item %s: %s",
                        getattr(item, "id", None),
                        exc,
                        exc_info=True,
                    )

                # Compute planned_parent_width_mm from lane count + effective web-width policy + child target.
                try:
                    from apps.materials.services_web_width_policy import (
                        evaluate_web_width_plan,
                        web_width_context_from_sales_order_item,
                    )

                    lane_count = int(getattr(item, "preferred_lane_count", None) or 1)
                    if lane_count < 1:
                        lane_count = 1
                    child_w = 0.0
                    geom = item.geometry_snapshot if isinstance(item.geometry_snapshot, dict) else {}
                    for key in ("child_target_width_mm", "target_child_width_mm", "roll_width_mm", "effective_roll_width_mm"):
                        if geom.get(key):
                            child_w = float(geom.get(key) or 0)
                            break
                    plan = evaluate_web_width_plan(
                        child_w,
                        lane_count,
                        context=web_width_context_from_sales_order_item(item),
                    )
                    planned = plan.get("planned_parent_width_mm") or 0
                    item.preferred_lane_count = lane_count
                    item.planned_parent_width_mm = Decimal(str(round(planned, 2))) if planned else None
                    if isinstance(item.geometry_snapshot, dict):
                        item.geometry_snapshot = {
                            **item.geometry_snapshot,
                            "preferred_lane_count": lane_count,
                            "planned_parent_width_mm": planned,
                            "web_width_policy": {
                                "policy_id": plan.get("policy_id"),
                                "policy_code": plan.get("policy_code"),
                                "policy_name": plan.get("policy_name"),
                                "scope_type": plan.get("scope_type"),
                                "scope_ref": plan.get("scope_ref"),
                                "parent_width_strategy": plan.get("parent_width_strategy"),
                                "computed_run_width_mm": plan.get("computed_run_width_mm"),
                                "trim_mm": plan.get("trim_mm"),
                                "remainder_mm": plan.get("remainder_mm"),
                                "remainder_disposition": plan.get("remainder_disposition"),
                            },
                        }
                except ValidationError:
                    raise
                except Exception as exc:
                    logger.warning(
                        "confirm_sales_order: web-width policy evaluation failed for item %s: %s",
                        item.id,
                        exc,
                        exc_info=True,
                    )

                item.unit_weight_g = Decimal(str(preview["unit_weight_g"]))
                item.total_weight_kg = Decimal(str(preview["total_weight_kg"]))
                if str(getattr(item, "line_status", "") or "").upper() != "CANCELLED":
                    item.line_status = "PLANNING_REQUIRED"
                item.save(
                    update_fields=[
                        "geometry_snapshot",
                        "layer_snapshot",
                        "printing_snapshot",
                        "packaging_snapshot",
                        "artwork_assignment_required",
                        "assigned_artwork",
                        "qty_uom",
                        "price_basis",
                        "spec_signature",
                        "invariant_signature",
                        "bom_snapshot",
                        "unit_weight_g",
                        "total_weight_kg",
                        "preferred_lane_count",
                        "planned_parent_width_mm",
                        "lane_count_source",
                        "line_status",
                    ]
                )

            order.status = "PLANNING_REQUIRED"
            order.execution_model_version = 2
            order.commercial_confirmed_at = timezone.now()
            order.save(update_fields=["status", "execution_model_version", "commercial_confirmed_at"])

            from apps.production.services.in_house_demand_service import InHouseDemandService
            InHouseDemandService.create_for_order(order)

            return order

    @staticmethod
    def cancel_sales_order(order_id, *, user=None, reason=""):
        with transaction.atomic():
            order = SalesOrder.objects.select_for_update().prefetch_related("items").get(id=order_id)
            if order.status in ["RELEASED", "PACKING_READY", "DISPATCH_READY", "COMPLETED", "CANCELLED"]:
                raise ValidationError(f"Order cannot be cancelled from status {order.status}.")

            from apps.production.models import ProductionJob

            jobs = list(ProductionJob.objects.select_for_update().filter(sales_order_item__sales_order=order))
            blocking = [job for job in jobs if str(job.job_state).upper() in {"RELEASED", "EXECUTING", "PAUSED", "COMPLETED"} or str(job.status).upper() in {"RUNNING", "COMPLETED"}]
            if blocking:
                raise ValidationError("Order already has released, executing, paused, or completed production jobs and cannot be cancelled from Sales.")

            for job in jobs:
                job.job_state = "CANCELLED"
                job.status = "CANCELLED"
                job.hold_reason = str(reason or "Sales order cancelled before planner release.")[:255]
                job.save(update_fields=["job_state", "status", "hold_reason", "updated_at"])

            for item in order.items.all():
                SalesOrderService._close_item_remaining(
                    item,
                    mode="CANCEL",
                    reason=reason or "Sales order cancelled before planner release.",
                )

            previous_status = order.status
            order.status = "CANCELLED"
            order.save(update_fields=["status"])

            try:
                from apps.users.models import PermissionAuditLog

                PermissionAuditLog.objects.create(
                    user=user if getattr(user, "is_authenticated", False) else None,
                    action="SALES_ORDER_CHANGED",
                    method="POST",
                    path=f"/api/sales/orders/{order.id}/cancel/",
                    required_permission="sales.manage",
                    effective_role=str(getattr(user, "effective_role_code", "") or getattr(user, "role_code", "") or ""),
                    details={
                        "operation": "CANCEL",
                        "order_id": str(order.id),
                        "order_number": order.order_number,
                        "previous_status": previous_status,
                        "new_status": order.status,
                        "cancelled_jobs": len(jobs),
                        "reason": str(reason or ""),
                    },
                )
            except Exception:
                pass
            return order
