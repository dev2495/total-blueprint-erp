from __future__ import annotations

import hashlib
import json
import re
import uuid
from decimal import Decimal
from typing import Any

from django.core.exceptions import ValidationError

from apps.physics.geometry_override import normalize_geometry_override, sanitize_geometry_override
from apps.physics.services_physics import PhysicsEngine

from .naming import product_variant_code
from .models import InventoryMaterial, ProductMaster, ProductMasterSize, ProductVariant
from .stock_forms import (
    STOCK_FORM_OPEN_WEB,
    film_area_factor_for_stock_form,
    normalize_slit_policy,
    normalize_stock_form,
    normalize_width_basis,
)

GLOBAL_LAYER_AXIS_KEYS = {"thickness_um", "thickness_micron", "grade", "grade_id"}
LAYER_GRADE_AXIS_KEYS = ("layer_grades", "grade_by_layer", "layer_grade", "per_layer_grade")
LAYER_MATERIAL_AXIS_KEYS = (
    "layer_material_overrides",
    "layer_materials",
    "film_variant_by_layer",
    "layer_film_variants",
    "material_by_layer",
)
LAYER_MATERIAL_AXIS_TYPES = {
    "layer_material_enum",
    "per_layer_material_enum",
    "layer_film_variant_enum",
    "per_layer_film_variant_enum",
}
LAYER_MATERIAL_OPTION_KEYS = (
    "allowed_film_variant_codes",
    "alternate_film_variant_codes",
    "allowed_alternate_film_variant_codes",
    "allowed_material_codes",
    "alternate_material_codes",
    "material_options",
    "film_variant_options",
)
ROLL_WIDTH_AXIS_KEYS = {"layer_widths", "layer_roll_widths", "roll_width", "roll_width_mm", "per_layer_width_override"}
PACKAGING_AXIS_KEYS = {
    "packaging",
    "packaging_ref",
    "packaging_inner",
    "packaging_outer",
    "primary_inner_pack",
    "final_outer_pack",
}


def _canonical(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): _canonical(v) for k, v in sorted(value.items(), key=lambda item: str(item[0]))}
    if isinstance(value, list):
        return [_canonical(v) for v in value]
    if isinstance(value, Decimal):
        return float(value)
    return value


def canonical_axis_values(axis_values: dict[str, Any]) -> dict[str, Any]:
    return _canonical(axis_values if isinstance(axis_values, dict) else {})


def axis_signature(master: ProductMaster, axis_values: dict[str, Any]) -> str:
    canonical = json.dumps(canonical_axis_values(axis_values), sort_keys=True, separators=(",", ":"))
    seed = f"{master.invariant_signature or master.code}:{canonical}"
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()


def auto_variant_code(
    master: ProductMaster,
    axis_values: dict[str, Any],
    *,
    geometry: dict[str, Any] | None = None,
    layers: list[dict[str, Any]] | None = None,
) -> str:
    return product_variant_code(
        master_code=master.code,
        axis_values=axis_values,
        geometry=geometry,
        layers=layers,
        max_length=80,
    )


def _code_from_option(value: Any) -> str:
    if isinstance(value, dict):
        value = value.get("code") or value.get("material_code") or value.get("film_variant_code") or value.get("value")
    return str(value or "").strip()


def _codes_from_options(value: Any) -> set[str]:
    if value in (None, ""):
        return set()
    if isinstance(value, dict):
        codes: set[str] = set()
        for nested in value.values():
            codes.update(_codes_from_options(nested))
        return codes
    if isinstance(value, (list, tuple, set)):
        return {code for item in value if (code := _code_from_option(item))}
    code = _code_from_option(value)
    return {code} if code else set()


def _safe_uuid(value: Any) -> str | None:
    try:
        return str(uuid.UUID(str(value)))
    except Exception:
        return None


def _axis_master_data_source(axis: dict[str, Any]) -> str:
    return str((axis or {}).get("master_data_source") or (axis or {}).get("source") or "").strip().lower()


def _is_packaging_catalog_axis(axis: dict[str, Any], key: str, axis_type: str) -> bool:
    return (
        key in PACKAGING_AXIS_KEYS
        or axis_type in {"packaging_ref", "packaging_catalog_ref"}
        or _axis_master_data_source(axis) in {"packaging_material", "packaging", "packaging_master"}
    )


def _axis_value_refs(value: Any) -> list[str]:
    if value in (None, "", [], {}):
        return []
    if isinstance(value, dict):
        ref = (
            value.get("material_id")
            or value.get("packaging_material_id")
            or value.get("id")
            or value.get("code")
            or value.get("material_code")
            or value.get("value")
        )
        return [str(ref).strip()] if str(ref or "").strip() else []
    if isinstance(value, (list, tuple, set)):
        refs: list[str] = []
        for item in value:
            refs.extend(_axis_value_refs(item))
        return refs
    return [str(value).strip()] if str(value or "").strip() else []


def _filter_value_matches(actual: Any, expected: Any) -> bool:
    if expected in (None, "", [], {}):
        return True
    actual_text = str(actual or "").strip().upper()
    if isinstance(expected, (list, tuple, set)):
        return actual_text in {str(item or "").strip().upper() for item in expected}
    return actual_text == str(expected or "").strip().upper()


def _validate_packaging_catalog_axis_value(axis: dict[str, Any], value: Any) -> str | None:
    refs = _axis_value_refs(value)
    if not refs:
        return None
    filters = (axis or {}).get("master_data_filter") if isinstance((axis or {}).get("master_data_filter"), dict) else {}
    for ref in refs:
        material_id = _safe_uuid(ref)
        qs = InventoryMaterial.objects.filter(category="PACKAGING", status="ACTIVE")
        material = qs.filter(id=material_id).first() if material_id else qs.filter(code__iexact=ref).first()
        if not material:
            return "Selected packaging material is not active in the packaging catalog."
        if not _filter_value_matches(material.packaging_kind, filters.get("packaging_kind") or filters.get("kind")):
            return "Selected packaging material is not allowed for this Product Master."
        if not _filter_value_matches(
            material.packaging_supply_mode,
            filters.get("packaging_supply_mode") or filters.get("supply_mode"),
        ):
            return "Selected packaging material supply mode is not allowed for this Product Master."
    return None


def _layer_keys(index: int, raw: dict[str, Any], material_code: Any) -> list[str]:
    return [
        str(index),
        str(index + 1),
        str(raw.get("role") or ""),
        str(material_code or ""),
        str(raw.get("film_variant_code") or ""),
        str(raw.get("material_code") or ""),
        str(raw.get("name") or ""),
    ]


def _axis_options_for_layer(options: Any, *, index: int, raw: dict[str, Any], material_code: Any) -> set[str]:
    if isinstance(options, dict):
        codes: set[str] = set()
        for key in _layer_keys(index, raw, material_code):
            if key and options.get(key) not in (None, ""):
                codes.update(_codes_from_options(options.get(key)))
        return codes
    return _codes_from_options(options)


def _layer_grade_axis_options(master: ProductMaster, *, index: int, raw: dict[str, Any], material_code: Any) -> set[str]:
    axes = master.variant_axes if isinstance(master.variant_axes, list) else []
    options: set[str] = set()
    for axis in axes:
        if not isinstance(axis, dict):
            continue
        key = str(axis.get("axis") or "").strip()
        if key not in LAYER_GRADE_AXIS_KEYS:
            continue
        options.update(
            _axis_options_for_layer(
                axis.get("options") or axis.get("allowed") or axis.get("allowed_by_layer"),
                index=index,
                raw=raw,
                material_code=material_code,
            )
        )
    return options


def _layer_allowed_material_codes(raw: dict[str, Any]) -> set[str]:
    codes: set[str] = set()
    for key in LAYER_MATERIAL_OPTION_KEYS:
        if raw.get(key) not in (None, ""):
            codes.update(_codes_from_options(raw.get(key)))
    return codes


def _layer_material_ref(raw: dict[str, Any]) -> tuple[InventoryMaterial | None, str]:
    material_id = raw.get("film_variant_id") or raw.get("material_id") or raw.get("variant_id")
    material = None
    if material_id:
        material = InventoryMaterial.objects.filter(id=material_id, category="FILM_VARIANT").first()

    material_code = (
        raw.get("film_variant_code")
        or raw.get("material_code")
        or raw.get("code")
        or raw.get("layer")
        or raw.get("name")
    )
    if not material and material_code:
        material = _material_by_code(str(material_code or ""))
        if material and material.category != "FILM_VARIANT":
            material = None
    if material:
        return material, str(material.code or "")
    return None, str(material_code or "")


def _material_axis_configs(master: ProductMaster) -> dict[str, dict[str, Any]]:
    axes = master.variant_axes if isinstance(master.variant_axes, list) else []
    configs: dict[str, dict[str, Any]] = {}
    for axis in axes:
        if not isinstance(axis, dict):
            continue
        key = str(axis.get("axis") or "").strip()
        axis_type = str(axis.get("type") or "").strip()
        if key in LAYER_MATERIAL_AXIS_KEYS or axis_type in LAYER_MATERIAL_AXIS_TYPES:
            configs[key] = axis
    return configs


def _material_override_source(axis_values: dict[str, Any]) -> tuple[str | None, Any]:
    for key in LAYER_MATERIAL_AXIS_KEYS:
        if key in axis_values and axis_values.get(key) not in (None, "", {}, []):
            return key, axis_values.get(key)
    return None, None


def _validate_layer_material_overrides(master: ProductMaster, axis_values: dict[str, Any]) -> None:
    source_key, source = _material_override_source(axis_values)
    if not source_key:
        return

    configs = _material_axis_configs(master)
    if source_key not in configs:
        raise ValidationError(
            {
                source_key: (
                    "Layer material identity is fixed by Product Master. "
                    "Enable a controlled per-layer material override axis before changing film variants."
                )
            }
        )

    layer_template = master.layer_template if isinstance(master.layer_template, list) and master.layer_template else master.canonical_layer_stack
    template_rows = [row for row in (layer_template or []) if isinstance(row, dict)]
    axis_config = configs[source_key]
    errors: dict[str, str] = {}

    for index, raw in enumerate(template_rows):
        _, base_code = _layer_material_ref(raw)
        override_code = _layer_axis_value(source, index=index, role=raw.get("role"), material_code=base_code)
        override_code = _code_from_option(override_code)
        if not override_code:
            continue
        if str(override_code).lower() == str(base_code or "").lower():
            continue

        allowed = _layer_allowed_material_codes(raw)
        axis_options = axis_config.get("options") or axis_config.get("allowed") or axis_config.get("allowed_by_layer")
        if isinstance(axis_options, dict):
            allowed.update(
                _axis_options_for_layer(
                    axis_options,
                    index=index,
                    raw=raw,
                    material_code=base_code,
                )
            )
        allowed_lookup = {str(code).strip().upper() for code in allowed if str(code or "").strip()}
        if str(override_code).strip().upper() not in allowed_lookup:
            errors[f"layer_{index + 1}"] = (
                "Film variant changes are only allowed for Product Master layer alternates. "
                f"{override_code} is not approved for layer {index + 1}."
            )
            continue
        material = _material_by_code(override_code)
        if not material or material.category != "FILM_VARIANT":
            errors[f"layer_{index + 1}"] = f"{override_code} is not a valid film variant."

    if errors:
        raise ValidationError({source_key: errors})


def _resolve_layer_material_code(master: ProductMaster, axis_values: dict[str, Any], raw: dict[str, Any], index: int, base_code: Any) -> tuple[str, bool]:
    source_key, source = _material_override_source(axis_values)
    if not source_key:
        return str(base_code or ""), False
    _validate_layer_material_overrides(master, axis_values)
    override_code = _code_from_option(_layer_axis_value(source, index=index, role=raw.get("role"), material_code=base_code))
    if override_code and str(override_code).lower() != str(base_code or "").lower():
        return override_code, True
    return str(base_code or ""), False


def validate_axis_values(master: ProductMaster, axis_values: dict[str, Any]) -> None:
    axes = master.variant_axes if isinstance(master.variant_axes, list) else []
    errors: dict[str, str] = {}
    forbidden_values = sorted(key for key in GLOBAL_LAYER_AXIS_KEYS if key in (axis_values or {}))
    if forbidden_values:
        errors["axis_values"] = "Global thickness/grade axes are not valid for Product Master; use per-layer layer_thicknesses/layer_grades or layer defaults."
    for axis in axes:
        key = str((axis or {}).get("axis") or "").strip()
        if not key:
            continue
        if key in GLOBAL_LAYER_AXIS_KEYS:
            errors[key] = "Global thickness/grade axes are not valid for Product Master."
            continue
        value = axis_values.get(key)
        if (axis or {}).get("required") and value in (None, "") and key not in ROLL_WIDTH_AXIS_KEYS:
            errors[key] = "This axis is required."
            continue
        options = (axis or {}).get("options")
        axis_type = str((axis or {}).get("type") or "")
        allow_ad_hoc = bool(
            (axis or {}).get("allow_ad_hoc")
            or (axis or {}).get("allow_custom")
            or (axis or {}).get("allow_new")
        )
        if value not in (None, "") and _is_packaging_catalog_axis(axis or {}, key, axis_type):
            error = _validate_packaging_catalog_axis_value(axis or {}, value)
            if error:
                errors[key] = error
            continue
        if value not in (None, "") and isinstance(options, list) and options:
            normalized_options = {str(option) for option in options} | _codes_from_options(options)
            if isinstance(value, list):
                invalid = [item for item in value if str(item) not in normalized_options]
                if invalid and not allow_ad_hoc:
                    errors[key] = "One or more selected values are not allowed for this Product Master."
                continue
            if isinstance(value, dict):
                if axis_type in {"layer_number", "layer_enum", "per_layer_number", "per_layer_enum"}:
                    invalid = [item for item in value.values() if str(item) not in normalized_options]
                    if invalid and not allow_ad_hoc:
                        errors[key] = "One or more per-layer values are not allowed for this Product Master."
                continue
            if axis_type in {"geometry", "pod_ref", "packaging_ref", "multi_enum", "layer_number", "layer_enum", "per_layer_number", "per_layer_enum", *LAYER_MATERIAL_AXIS_TYPES}:
                if axis_type == "geometry" and str(value) not in normalized_options and not allow_ad_hoc:
                    errors[key] = "Size is not allowed for this Product Master."
                continue
            if str(value) not in normalized_options and not allow_ad_hoc:
                errors[key] = "Value is not allowed for this Product Master."
    if errors:
        raise ValidationError(errors)
    _validate_layer_material_overrides(master, axis_values)


def _size_from_axis(master: ProductMaster, axis_values: dict[str, Any]) -> dict[str, float]:
    raw_size = axis_values.get("size") or axis_values.get("size_code") or axis_values.get("geometry")
    size_row = None
    fixed = master.fixed_attributes if isinstance(master.fixed_attributes, dict) else {}
    fg_type = str(fixed.get("fg_type") or master.product_kind or "POUCH").upper()

    def clean_multipliers(value: Any) -> dict[str, Any]:
        if not isinstance(value, dict):
            return {}
        return {str(key): val for key, val in value.items() if str(key).lower() != "faces"}

    if raw_size not in (None, ""):
        raw = str(raw_size).strip()
        size_row = ProductMasterSize.objects.select_related("pouch_style_master").filter(product_master=master, code__iexact=raw).first()
        if not size_row:
            size_row = ProductMasterSize.objects.select_related("pouch_style_master").filter(product_master=master, label__iexact=raw).first()

    if size_row:
        geometry_defaults = getattr(size_row, "geometry_config", None) if isinstance(getattr(size_row, "geometry_config", None), dict) else {}
        if not geometry_defaults:
            legacy = size_row.default_packing if isinstance(size_row.default_packing, dict) else {}
            nested_legacy = legacy.get("geometry")
            if isinstance(nested_legacy, dict):
                geometry_defaults = nested_legacy
            else:
                geometry_defaults = {
                    key: legacy[key]
                    for key in (
                        "trim_loss_mm",
                        "trim_apply_to",
                        "flap_tape_mm",
                        "gusset_apply_to",
                        "gusset_factor",
                        "adjustments",
                        "multipliers",
                        "pouch_style",
                    )
                    if key in legacy
                }
        style_master = getattr(size_row, "pouch_style_master", None)
        style_allowed_fields = getattr(style_master, "allowed_fields", None) if style_master else {}
        if not isinstance(style_allowed_fields, dict):
            style_allowed_fields = {}
        style_requires_gusset = any(
            str(key) in {"G", "gusset", "gusset_mm"}
            and isinstance(definition, dict)
            and bool(definition.get("required"))
            for key, definition in style_allowed_fields.items()
        )
        return {
            "width_mm": float(size_row.width_mm or size_row.roll_width_mm or 0),
            "height_mm": float(size_row.height_mm or 0),
            "gusset_mm": float(size_row.gusset_mm or 0),
            "roll_width_mm": float(size_row.roll_width_mm or 0),
            "child_target_width_mm": float(size_row.child_target_width_mm or 0),
            "child_target_override": bool(getattr(size_row, "child_target_override", False)),
            "stock_form": normalize_stock_form(getattr(size_row, "stock_form", None)),
            "width_basis": normalize_width_basis(getattr(size_row, "width_basis", None), stock_form=getattr(size_row, "stock_form", None)),
            "film_area_width_mm": float(getattr(size_row, "film_area_width_mm", None) or 0),
            "slit_policy": normalize_slit_policy(getattr(size_row, "slit_policy", None), stock_form=getattr(size_row, "stock_form", None)),
            "pouch_style_master": str(size_row.pouch_style_master_id) if getattr(size_row, "pouch_style_master_id", None) else "",
            "pouch_style_master_code": str(getattr(style_master, "code", "") or ""),
            "pouch_style_roll_axis": str(getattr(style_master, "default_roll_axis", "") or ""),
            "pouch_style_requires_gusset": style_requires_gusset,
            "pouch_style_version": int(getattr(size_row, "pouch_style_version", 0) or 0),
            "trim_loss_mm": geometry_defaults.get("trim_loss_mm") if "trim_loss_mm" in geometry_defaults else None,
            "trim_apply_to": geometry_defaults.get("trim_apply_to") or "",
            "flap_tape_mm": geometry_defaults.get("flap_tape_mm") if "flap_tape_mm" in geometry_defaults else None,
            "gusset_apply_to": geometry_defaults.get("gusset_apply_to") or "",
            "gusset_factor": geometry_defaults.get("gusset_factor"),
            "adjustments": geometry_defaults.get("adjustments") if isinstance(geometry_defaults.get("adjustments"), list) else [],
            "multipliers": clean_multipliers(geometry_defaults.get("multipliers")),
            "pouch_style": geometry_defaults.get("pouch_style") or "",
            "size_code": size_row.code,
            "size_label": size_row.label,
        }

    if isinstance(raw_size, dict):
        src = raw_size
    else:
        src = axis_values
    width = src.get("width_mm")
    height = src.get("height_mm")
    if raw_size and (not width or not height):
        match = re.search(r"(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)", str(raw_size))
        if match:
            width = match.group(1)
            height = match.group(2)
    return {
        "width_mm": float(width or src.get("roll_width_mm") or 0),
        "height_mm": float(height or 0),
        "gusset_mm": float(src.get("gusset_mm") or 0),
        "roll_width_mm": float(src.get("roll_width_mm") or 0),
        "child_target_width_mm": float(src.get("child_target_width_mm") or 0),
        "child_target_override": bool(src.get("child_target_override") or False),
        "stock_form": normalize_stock_form(src.get("stock_form") or STOCK_FORM_OPEN_WEB),
        "width_basis": normalize_width_basis(src.get("width_basis"), stock_form=src.get("stock_form") or STOCK_FORM_OPEN_WEB),
        "film_area_width_mm": float(src.get("film_area_width_mm") or 0),
        "slit_policy": normalize_slit_policy(src.get("slit_policy"), stock_form=src.get("stock_form") or STOCK_FORM_OPEN_WEB),
        "pouch_style_master": str(src.get("pouch_style_master") or ""),
        "pouch_style_master_code": str(src.get("pouch_style_master_code") or ""),
        "pouch_style_roll_axis": str(src.get("pouch_style_roll_axis") or src.get("default_roll_axis") or ""),
        "pouch_style_version": int(src.get("pouch_style_version") or 0),
        "trim_loss_mm": src.get("trim_loss_mm"),
        "trim_apply_to": src.get("trim_apply_to") or "",
        "flap_tape_mm": src.get("flap_tape_mm"),
        "gusset_apply_to": src.get("gusset_apply_to") or "",
        "gusset_factor": src.get("gusset_factor"),
        "adjustments": src.get("adjustments") if isinstance(src.get("adjustments"), list) else [],
        "multipliers": clean_multipliers(src.get("multipliers")),
        "pouch_style": str(src.get("pouch_style") or "").upper(),
        "size_code": str(raw_size or "").strip(),
        "size_label": str(raw_size or "").strip(),
    }


def compute_geometry(master: ProductMaster, axis_values: dict[str, Any]) -> dict[str, Any]:
    fixed = master.fixed_attributes if isinstance(master.fixed_attributes, dict) else {}
    size = _size_from_axis(master, axis_values)
    fg_type = str(fixed.get("fg_type") or master.product_kind or "POUCH").upper()
    template_geometry = fixed.get("geometry_template") if isinstance(fixed.get("geometry_template"), dict) else {}
    default_trim_loss = fixed.get("trim_loss_mm", 10 if fg_type == "POUCH" else 0)
    raw_multipliers = size.get("multipliers") if isinstance(size.get("multipliers"), dict) else fixed.get("multipliers")
    if not isinstance(raw_multipliers, dict):
        raw_multipliers = {}

    override_geometry = sanitize_geometry_override(
        {
            "width_mm": size["width_mm"],
            "height_mm": 0 if fg_type == "ROLL" else size["height_mm"],
            "gusset_mm": size.get("gusset_mm") or fixed.get("gusset_mm") or 0,
            "trim_loss_mm": size.get("trim_loss_mm") if size.get("trim_loss_mm") not in (None, "") else default_trim_loss,
            "trim_apply_to": size.get("trim_apply_to") or fixed.get("trim_apply_to") or "WIDTH",
            "flap_tape_mm": size.get("flap_tape_mm") if size.get("flap_tape_mm") not in (None, "") else fixed.get("flap_tape_mm", 0),
            "gusset_apply_to": size.get("gusset_apply_to") or fixed.get("gusset_apply_to") or "",
            "gusset_factor": size.get("gusset_factor") if size.get("gusset_factor") not in (None, "") else fixed.get("gusset_factor"),
            "pouch_style": size.get("pouch_style") or fixed.get("pouch_style") or fixed.get("default_pouch_style") or "STAND_UP",
            "adjustments": size.get("adjustments") or fixed.get("adjustments") or [],
            "multipliers": {
                str(key): value
                for key, value in raw_multipliers.items()
                if str(key).lower() != "faces"
            },
        }
    )
    normalized = normalize_geometry_override(template_geometry, override_geometry)
    normalized["finished_good_type"] = fg_type
    normalized["size_code"] = size["size_code"]
    normalized["size_label"] = size["size_label"]
    normalized["axis_values"] = canonical_axis_values(axis_values)
    child_target_width = Decimal(str(size.get("child_target_width_mm") or 0))
    if child_target_width > 0:
        normalized["child_target_width_mm"] = float(child_target_width)
        normalized["target_child_width_mm"] = float(child_target_width)
        normalized["stock_width_mm"] = float(child_target_width)
    stock_form = normalize_stock_form(size.get("stock_form") or STOCK_FORM_OPEN_WEB)
    width_basis = normalize_width_basis(size.get("width_basis"), stock_form=stock_form)
    slit_policy = normalize_slit_policy(size.get("slit_policy"), stock_form=stock_form)
    film_area_width = Decimal(str(size.get("film_area_width_mm") or 0))
    if film_area_width <= 0 and child_target_width > 0:
        film_area_width = child_target_width * Decimal(str(film_area_factor_for_stock_form(stock_form)))
    normalized["stock_form"] = stock_form
    normalized["width_basis"] = width_basis
    normalized["slit_policy"] = slit_policy
    if film_area_width > 0:
        normalized["film_area_width_mm"] = float(film_area_width)
        normalized["consumption_web_width_mm"] = float(film_area_width)
    if size.get("pouch_style_roll_axis"):
        normalized["pouch_style_roll_axis"] = str(size.get("pouch_style_roll_axis") or "").upper()
    if size.get("pouch_style_master"):
        normalized["pouch_style_master"] = size.get("pouch_style_master")
        normalized["pouch_style_version"] = size.get("pouch_style_version") or 0
        normalized["pouch_style_master_code"] = size.get("pouch_style_master_code") or ""
        normalized["pouch_style_requires_gusset"] = bool(size.get("pouch_style_requires_gusset"))
    normalized["child_target_override"] = bool(size.get("child_target_override"))
    # Roll-width math — trim is applied once at the stock-width level.
    # PhysicsEngine.effective_width_mm already includes trim (used for the
    # film-area / weight calc since trim is real material consumed). New pouch
    # styles provide child_target_width_mm directly. Legacy sizes without that
    # field fall back to open-web two-wall width for compatibility.
    #
    #   legacy_open_web_width = (effective_axis − trim_on_axis) × 2 + trim_on_axis
    #
    # The explicit per-size roll_width_mm override still wins.
    def _legacy_open_web_axis_value(effective_axis: Decimal, trim_loss: Decimal, trim_apply_to: str, axis: str) -> Decimal:
        applies = trim_apply_to == "BOTH" or trim_apply_to == axis
        trim_on_axis = trim_loss if applies else Decimal("0")
        single_wall_axis = effective_axis - trim_on_axis
        return single_wall_axis * Decimal("2") + trim_on_axis

    if fg_type == "ROLL":
        dims = PhysicsEngine._effective_pouch_dimensions(normalized)
        explicit_width = Decimal(str(size.get("roll_width_mm") or 0))
        trim_loss = Decimal(str(dims.get("trim_loss_mm") or 0))
        trim_apply_to = str(dims.get("trim_apply_to") or "WIDTH").upper()
        auto_roll = dims["effective_width_mm"]
        resolved_roll_width = explicit_width if explicit_width > 0 else (child_target_width if child_target_width > 0 else auto_roll)
        normalized["roll_width_mm"] = float(resolved_roll_width)
        normalized["effective_width_mm"] = float(dims["effective_width_mm"])
        normalized["effective_height_mm"] = 0.0
        normalized["roll_form"] = str(fixed.get("roll_form") or "FLAT").upper()
    else:
        dims = PhysicsEngine._effective_pouch_dimensions(normalized)
        explicit_width = Decimal(str(size.get("roll_width_mm") or 0))
        trim_loss = Decimal(str(dims.get("trim_loss_mm") or 0))
        trim_apply_to = str(dims.get("trim_apply_to") or "WIDTH").upper()
        # Pouch styles declare which finished axis drives the child web width.
        # The old center-seal fallback stays for records that pre-date that flag.
        roll_axis = str(normalized.get("pouch_style_roll_axis") or "").upper()
        uses_height = roll_axis == "HEIGHT" or (
            not roll_axis and str(normalized.get("pouch_style") or "").upper() == "CENTER_SEAL"
        )
        if uses_height:
            auto_roll = _legacy_open_web_axis_value(dims["effective_height_mm"], trim_loss, trim_apply_to, "HEIGHT")
        else:
            auto_roll = _legacy_open_web_axis_value(dims["effective_width_mm"], trim_loss, trim_apply_to, "WIDTH")
        resolved_roll_width = explicit_width if explicit_width > 0 else (child_target_width if child_target_width > 0 else auto_roll)
        normalized["roll_width_mm"] = float(resolved_roll_width)
        normalized["effective_width_mm"] = float(dims["effective_width_mm"])
        normalized["effective_height_mm"] = float(dims["effective_height_mm"])
    return normalized


def _material_by_code(code: str) -> InventoryMaterial | None:
    code = str(code or "").strip()
    if not code:
        return None
    material = InventoryMaterial.objects.select_related("parent_family").filter(code__iexact=code).first()
    if material:
        return material
    return InventoryMaterial.objects.select_related("parent_family").filter(name__iexact=code).first()


def _recipe_grade_id(value: Any) -> str | None:
    value = str(value or "").strip()
    if not value:
        return None
    try:
        import uuid

        return str(uuid.UUID(value))
    except Exception:
        pass
    try:
        from apps.recipes.models import RecipeGrade

        grade = RecipeGrade.objects.filter(name__iexact=value).first()
        return str(grade.id) if grade else None
    except Exception:
        return None


def _to_decimal(value: Any, default: str = "0") -> Decimal:
    if value in (None, ""):
        return Decimal(default)
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal(default)


def _row_number_options(raw: dict[str, Any], key: str) -> list[Decimal]:
    values = raw.get(key)
    if values in (None, ""):
        return []
    if not isinstance(values, (list, tuple, set)):
        values = [values]
    out: list[Decimal] = []
    for item in values:
        value = _to_decimal(item)
        if value > 0:
            out.append(value)
    return sorted(set(out))


def _row_string_options(raw: dict[str, Any], key: str) -> set[str]:
    values = raw.get(key)
    if values in (None, ""):
        return set()
    if isinstance(values, str):
        values = [item.strip() for item in values.split(",")]
    elif not isinstance(values, (list, tuple, set)):
        values = [values]
    return {str(item).strip() for item in values if str(item).strip()}
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal(default)


def _layer_axis_value(source: Any, *, index: int, role: Any, material_code: Any) -> Any:
    if source in (None, ""):
        return None
    if isinstance(source, list):
        return source[index] if index < len(source) else None
    if isinstance(source, dict):
        # Browser forms and API examples normally submit layer rows as
        # one-based dictionaries: {"1": 12, "2": 65}. Older test/data paths
        # may still use zero-based keys. Detect the scheme so layer 2 does not
        # accidentally read layer 1's value from key "1".
        positional_keys = [str(index), str(index + 1)] if "0" in source else [str(index + 1), str(index)]
        keys = [
            *positional_keys,
            str(role or ""),
            str(material_code or ""),
        ]
        for key in keys:
            if key and source.get(key) not in (None, ""):
                return source.get(key)
    return None


def _axis_layer_value(axis_values: dict[str, Any], names: tuple[str, ...], *, index: int, role: Any, material_code: Any) -> Any:
    for name in names:
        if name in axis_values:
            value = _layer_axis_value(
                axis_values.get(name),
                index=index,
                role=role,
                material_code=material_code,
            )
            if value not in (None, ""):
                return value
    return None


def apply_layer_totals_to_geometry(geometry: dict[str, Any], layers: list[dict[str, Any]]) -> dict[str, Any]:
    resolved = dict(geometry or {})
    total_thickness = sum(_to_decimal(layer.get("thickness_micron")) for layer in (layers or []) if isinstance(layer, dict))
    if total_thickness > 0:
        total = float(total_thickness)
        resolved["thickness_um"] = total
        resolved["layer_thickness_total_um"] = total
        base = dict(resolved.get("base") or {}) if isinstance(resolved.get("base"), dict) else {}
        base["thickness_um"] = total
        resolved["base"] = base
    return resolved


def compute_layers(master: ProductMaster, axis_values: dict[str, Any], geometry: dict[str, Any]) -> list[dict[str, Any]]:
    layer_template = master.layer_template if isinstance(master.layer_template, list) and master.layer_template else master.canonical_layer_stack
    template_rows = [row for row in (layer_template or []) if isinstance(row, dict)]
    prepared_rows: list[dict[str, Any]] = []
    for index, raw in enumerate(template_rows):
        if not isinstance(raw, dict):
            continue
        base_material, base_material_code = _layer_material_ref(raw)
        material_code, material_override_applied = _resolve_layer_material_code(master, axis_values, raw, index, base_material_code)
        material = _material_by_code(str(material_code or ""))
        if not material_override_applied and (not material or material.category != "FILM_VARIANT") and base_material:
            material = base_material
            material_code = base_material.code
        if not material or material.category != "FILM_VARIANT":
            raise ValidationError({f"layer_{index + 1}": "Layer film variant is required."})
        percent = _to_decimal(raw.get("percent_of_total") or raw.get("thickness_share"))
        row_thickness = _to_decimal(
            _axis_layer_value(
                axis_values,
                ("layer_thicknesses", "layer_thickness_um", "thickness_by_layer", "thickness_um_by_layer"),
                index=index,
                role=raw.get("role"),
                material_code=material_code,
            )
            or raw.get("thickness_micron")
            or raw.get("thickness_um")
            or raw.get("default_thickness_micron")
            or raw.get("default_thickness_um")
        )
        thickness_basis = "per_layer"
        if str(raw.get("thickness_apportion") or "per_stack_share") == "fixed_um":
            row_thickness = _to_decimal(raw.get("thickness_micron") or raw.get("thickness_um") or raw.get("fixed_thickness_um"))
            thickness_basis = "fixed_um"
        if row_thickness <= 0:
            raise ValidationError({f"layer_{index + 1}": "Layer thickness_micron is required."})
        row_width = _to_decimal(
            _axis_layer_value(
                axis_values,
                ("layer_widths", "layer_roll_widths", "roll_width_by_layer", "input_roll_widths", "input_roll_width_by_layer"),
                index=index,
                role=raw.get("role"),
                material_code=material_code,
            )
            or raw.get("input_roll_width_mm")
            or raw.get("roll_width_mm")
            or geometry.get("roll_width_mm")
            or (geometry.get("base") or {}).get("width_mm")
        )
        if row_width <= 0:
            raise ValidationError({f"layer_{index + 1}": "Layer roll width is required; provide layer roll width or resolvable size geometry."})

        layer_grade = _axis_layer_value(
            axis_values,
            ("layer_grades", "grade_by_layer", "layer_grade"),
            index=index,
            role=raw.get("role"),
            material_code=material_code,
        )
        if layer_grade not in (None, ""):
            grade = layer_grade
        else:
            grade = raw.get("default_grade") or raw.get("grade_name") or ""
        if not str(grade or "").strip() and not (material and material.category == "FILM_VARIANT" and material.is_purchasable and not material.is_extrudable):
            raise ValidationError({f"layer_{index + 1}": "Layer grade is required unless the film input is a purchasable-only roll/film."})
        grade_options = _row_string_options(raw, "grade_options") | _layer_grade_axis_options(
            master,
            index=index,
            raw=raw,
            material_code=material_code,
        )
        if (
            str(grade or "").strip()
            and grade_options
            and str(grade).strip().upper() not in {str(option).strip().upper() for option in grade_options}
        ):
            raise ValidationError(
                {
                    f"layer_{index + 1}": (
                        "Layer grade must come from Product Master allowed grade options."
                    )
                }
            )
        layer_grade_id = _axis_layer_value(
            axis_values,
            ("layer_grade_ids", "grade_id_by_layer", "layer_grade_id"),
            index=index,
            role=raw.get("role"),
            material_code=material_code,
        )
        if layer_grade_id not in (None, ""):
            grade_id = layer_grade_id
        else:
            grade_id = raw.get("default_grade_id") or raw.get("grade_id")
        if not grade_id and grade:
            grade_id = _recipe_grade_id(grade)
        prepared_rows.append(
            {
                "index": index,
                "raw": raw,
                "base_material_code": str(base_material_code or ""),
                "material_code": material_code,
                "material_override_applied": material_override_applied,
                "material": material,
                "row_thickness": row_thickness,
                "row_width": row_width,
                "percent": percent,
                "grade": grade,
                "grade_id": grade_id,
                "thickness_basis": thickness_basis,
            }
        )

    resolved_total_thickness = sum(row["row_thickness"] for row in prepared_rows if row["row_thickness"] > 0)
    rows: list[dict[str, Any]] = []
    for prepared in prepared_rows:
        index = prepared["index"]
        raw = prepared["raw"]
        material_code = prepared["material_code"]
        material = prepared["material"]
        row_thickness = prepared["row_thickness"]
        row_width = prepared["row_width"]
        percent = prepared["percent"]
        if resolved_total_thickness > 0 and row_thickness > 0:
            kg_per_kg_fg = row_thickness / resolved_total_thickness
        elif percent > 0:
            kg_per_kg_fg = percent / Decimal("100")
        else:
            kg_per_kg_fg = Decimal("0")
        layer = {
            "role": raw.get("role") or f"layer-{index + 1}",
            "name": raw.get("name") or raw.get("layer") or str(material_code or ""),
            "base_material_code": prepared["base_material_code"],
            "material_code": getattr(material, "code", None) or str(material_code or ""),
            "film_variant_code": getattr(material, "code", None) or str(material_code or ""),
            "material_override_applied": bool(prepared.get("material_override_applied")),
            "variant_id": str(material.id) if material and material.category == "FILM_VARIANT" else None,
            "family_id": str(material.parent_family_id) if material and material.category == "FILM_VARIANT" and material.parent_family_id else (str(material.id) if material and material.category == "FILM_FAMILY" else ""),
            "grade_code": str(prepared["grade"] or ""),
            "grade": str(prepared["grade"] or ""),
            "grade_id": str(prepared["grade_id"]) if prepared["grade_id"] else None,
            "thickness_micron": float(row_thickness),
            "roll_width_mm": float(row_width),
            "input_roll_width_mm": float(row_width),
            "density_g_cm3": float(getattr(material, "density_gcm3", None) or getattr(getattr(material, "parent_family", None), "density_gcm3", None) or 0),
            "kg_per_kg_fg": float(kg_per_kg_fg),
            "thickness_apportion": prepared["thickness_basis"],
        }
        rows.append(layer)
    return rows


def find_or_create_product_variant(master: ProductMaster, axis_values: dict[str, Any], code: str | None = None) -> tuple[ProductVariant, bool]:
    axis_values = canonical_axis_values(axis_values)
    validate_axis_values(master, axis_values)
    bom_signature = axis_signature(master, axis_values)
    geometry = compute_geometry(master, axis_values)
    layers = compute_layers(master, axis_values, geometry)
    geometry = apply_layer_totals_to_geometry(geometry, layers)
    variant, created = ProductVariant.objects.get_or_create(
        master=master,
        bom_signature=bom_signature,
        defaults={
            "axis_values": axis_values,
            "code": code or auto_variant_code(master, axis_values, geometry=geometry, layers=layers),
            "geometry_snapshot": geometry,
            "layer_snapshot": layers,
        },
    )
    if not created and (
        variant.axis_values != axis_values
        or variant.geometry_snapshot != geometry
        or variant.layer_snapshot != layers
        or not variant.code
    ):
        variant.axis_values = axis_values
        variant.geometry_snapshot = geometry
        variant.layer_snapshot = layers
        if not variant.code:
            variant.code = code or auto_variant_code(master, axis_values, geometry=geometry, layers=layers)
        variant.save(update_fields=["axis_values", "geometry_snapshot", "layer_snapshot", "code"])

    # PACKAGING + POD masters deliberately do not create catalog SKUs here.
    # Their variants are production contracts only; an admin must manually link
    # each variant to an existing fixed Packaging/POD catalog SKU.

    return variant, created
