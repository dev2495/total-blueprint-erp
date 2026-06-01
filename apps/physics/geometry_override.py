from __future__ import annotations

import json
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List

from django.core.exceptions import ValidationError


POD_OVERRIDE_KEYS = {
    "pod_enabled",
    "pod_height_mm",
    "pod_type",
    "pod",
    "pod_summary",
}

POUCH_STYLE_MASTER_KEYS = {
    "pouch_style_master",
    "pouch_style_master_code",
    "pouch_style_version",
    "pouch_style_requires_gusset",
    "pouch_style_roll_axis",
}

POUCH_STOCK_GEOMETRY_KEYS = {
    "child_target_width_mm",
    "target_child_width_mm",
    "stock_width_mm",
    "film_area_width_mm",
    "stock_form",
    "width_basis",
    "slit_policy",
    "roll_width_mm",
    "input_roll_width_mm",
}

POUCH_STYLE_VALUES = {
    "THREE_SIDE_SEAL",
    "PILLOW",
    "STAND_UP",
    "SIDE_GUSSET",
    "QUAD_SEAL",
    "FLAT_BOTTOM",
    "SPOUT",
    "SHAPED",
    "SACHET",
    "STICK_PACK",
}

DIMENSION_IMPACT_VALUES = {"WIDTH", "HEIGHT", "BOTH", "NONE"}


def _default_gusset_rule(pouch_style: str) -> tuple[str, float]:
    style = str(pouch_style or "").upper().strip()
    if style == "STAND_UP":
        return "HEIGHT", 1.0
    if style in {"QUAD_SEAL", "FLAT_BOTTOM"}:
        return "WIDTH", 2.0
    if style in {"SIDE_GUSSET", "SPOUT"}:
        return "WIDTH", 1.0
    return "NONE", 1.0


def _normalize_dimension_impact(value: Any, default: str = "WIDTH") -> str:
    impact = str(value or default).upper().strip()
    aliases = {
        "W": "WIDTH",
        "H": "HEIGHT",
        "ALL": "BOTH",
        "BOTH_AXES": "BOTH",
        "NO": "NONE",
        "OFF": "NONE",
    }
    impact = aliases.get(impact, impact)
    return impact if impact in DIMENSION_IMPACT_VALUES else default


def _normalize_factor(value: Any, default: float = 1.0) -> float:
    number = _to_number(value)
    if number is None:
        return default
    return max(0.0, number)


def _to_decimal(value: Any) -> Decimal | None:
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None


def _to_number(value: Any) -> float | None:
    number = _to_decimal(value)
    if number is None:
        return None
    return float(number)


def _normalize_adjustments(value: Any) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    if not isinstance(value, list):
        return rows
    for row in value:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "").strip()
        if not name:
            continue
        impact = _normalize_dimension_impact(row.get("impact") or row.get("affects_dimension"), "WIDTH")
        if impact == "NONE":
            impact = "WIDTH"
        qty = _to_number(row.get("value"))
        rows.append(
            {
                "name": name,
                "value": qty if qty is not None else 0.0,
                "impact": impact,
            }
        )
    rows.sort(key=lambda x: (x["name"], x["impact"], x["value"]))
    return rows


def _template_base_geometry(template_geometry: Dict[str, Any]) -> Dict[str, Any]:
    source = dict(template_geometry or {})
    base = source.get("base") if isinstance(source.get("base"), dict) else {}
    width = _to_number(source.get("width_mm"))
    height = _to_number(source.get("height_mm"))
    if _to_number(base.get("width_mm")) is not None:
        width = _to_number(base.get("width_mm"))
    if _to_number(base.get("height_mm")) is not None:
        height = _to_number(base.get("height_mm"))

    pouch_style = str(source.get("pouch_style") or "").upper().strip()
    if pouch_style not in POUCH_STYLE_VALUES:
        pouch_style = ""
    default_gusset_apply_to, default_gusset_factor = _default_gusset_rule(pouch_style)

    normalized: Dict[str, Any] = {
        "base": {
            "width_mm": width if width is not None else 0.0,
            "height_mm": height if height is not None else 0.0,
        },
        "adjustments": _normalize_adjustments(source.get("adjustments")),
        "trim_apply_to": _normalize_dimension_impact(source.get("trim_apply_to"), "WIDTH"),
        "gusset_apply_to": _normalize_dimension_impact(source.get("gusset_apply_to"), default_gusset_apply_to),
        "gusset_factor": _normalize_factor(source.get("gusset_factor"), default_gusset_factor),
    }

    for key in ("gusset_mm", "trim_loss_mm", "flap_tape_mm"):
        number = _to_number(source.get(key))
        if number is not None:
            normalized[key] = number

    for key in ("pod_enabled", "pod_height_mm", "pod_type", "pod"):
        if key in source:
            normalized[key] = source.get(key)
    if pouch_style:
        normalized["pouch_style"] = pouch_style
    return normalized


def sanitize_geometry_override(override_geometry: Any) -> Dict[str, Any]:
    """
    Keep only geometry override keys allowed for Sales/MTS.
    POD keys are intentionally ignored.
    """
    if not isinstance(override_geometry, dict):
        return {}

    base = override_geometry.get("base") if isinstance(override_geometry.get("base"), dict) else {}
    payload: Dict[str, Any] = {}

    width = _to_number(override_geometry.get("width_mm"))
    if width is None:
        width = _to_number(base.get("width_mm"))
    if width is not None:
        payload["width_mm"] = width

    height = _to_number(override_geometry.get("height_mm"))
    if height is None:
        height = _to_number(base.get("height_mm"))
    if height is not None:
        payload["height_mm"] = height

    gusset = _to_number(override_geometry.get("gusset_mm"))
    if gusset is not None:
        payload["gusset_mm"] = gusset

    trim_loss = _to_number(override_geometry.get("trim_loss_mm"))
    if trim_loss is not None:
        payload["trim_loss_mm"] = trim_loss

    flap_tape = _to_number(override_geometry.get("flap_tape_mm"))
    if flap_tape is not None:
        payload["flap_tape_mm"] = flap_tape

    pouch_style = str(override_geometry.get("pouch_style") or "").upper().strip()
    if pouch_style in POUCH_STYLE_VALUES:
        payload["pouch_style"] = pouch_style
    default_gusset_apply_to, default_gusset_factor = _default_gusset_rule(pouch_style)

    if "trim_apply_to" in override_geometry:
        payload["trim_apply_to"] = _normalize_dimension_impact(override_geometry.get("trim_apply_to"), "WIDTH")
    if "gusset_apply_to" in override_geometry:
        payload["gusset_apply_to"] = _normalize_dimension_impact(
            override_geometry.get("gusset_apply_to"),
            default_gusset_apply_to,
        )
    if "gusset_factor" in override_geometry:
        payload["gusset_factor"] = _normalize_factor(override_geometry.get("gusset_factor"), default_gusset_factor)

    if "adjustments" in override_geometry:
        payload["adjustments"] = _normalize_adjustments(override_geometry.get("adjustments"))
    elif "adjustments" in base:
        payload["adjustments"] = _normalize_adjustments(base.get("adjustments"))
    else:
        payload["adjustments"] = []

    for key in POUCH_STYLE_MASTER_KEYS:
        if key in override_geometry:
            payload[key] = override_geometry.get(key)

    for key in POUCH_STOCK_GEOMETRY_KEYS:
        if key not in override_geometry:
            continue
        if key in {"stock_form", "width_basis", "slit_policy"}:
            payload[key] = str(override_geometry.get(key) or "").upper()
        else:
            number = _to_number(override_geometry.get(key))
            if number is not None:
                payload[key] = number

    return payload


def normalize_geometry_override(template_geometry: Any, override_geometry: Any) -> Dict[str, Any]:
    """
    Build canonical geometry for physics/BOM.
    Template geometry is the default; override can change geometry + adjustments only.
    POD is always kept from template.
    """
    normalized = _template_base_geometry(template_geometry or {})
    override = sanitize_geometry_override(override_geometry)

    if "width_mm" in override:
        normalized["base"]["width_mm"] = override["width_mm"]
    if "height_mm" in override:
        normalized["base"]["height_mm"] = override["height_mm"]
    if "gusset_mm" in override:
        normalized["gusset_mm"] = override["gusset_mm"]
    if "trim_loss_mm" in override:
        normalized["trim_loss_mm"] = override["trim_loss_mm"]
    if "flap_tape_mm" in override:
        normalized["flap_tape_mm"] = override["flap_tape_mm"]
    if "pouch_style" in override:
        normalized["pouch_style"] = override["pouch_style"]
        default_gusset_apply_to, default_gusset_factor = _default_gusset_rule(override["pouch_style"])
        if "gusset_apply_to" not in override:
            normalized["gusset_apply_to"] = default_gusset_apply_to
        if "gusset_factor" not in override:
            normalized["gusset_factor"] = default_gusset_factor
    if "trim_apply_to" in override:
        normalized["trim_apply_to"] = override["trim_apply_to"]
    if "gusset_apply_to" in override:
        normalized["gusset_apply_to"] = override["gusset_apply_to"]
    if "gusset_factor" in override:
        normalized["gusset_factor"] = override["gusset_factor"]
    if "adjustments" in override:
        normalized["adjustments"] = override.get("adjustments") or []
    for key in POUCH_STYLE_MASTER_KEYS:
        if key in override:
            normalized[key] = override.get(key)
    for key in POUCH_STOCK_GEOMETRY_KEYS:
        if key in override:
            normalized[key] = override.get(key)

    return normalized


def _canonicalize(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _canonicalize(v) for k, v in sorted(value.items(), key=lambda item: item[0])}
    if isinstance(value, list):
        return [_canonicalize(v) for v in value]
    if isinstance(value, float):
        return float(round(value, 6))
    if isinstance(value, Decimal):
        return float(round(float(value), 6))
    return value


def geometry_signature(template_geometry: Any, override_geometry: Any) -> str:
    normalized = normalize_geometry_override(template_geometry, override_geometry)
    return json.dumps(_canonicalize(normalized), sort_keys=True, separators=(",", ":"))


def _normalize_addon_rows(addons: Any) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    if not isinstance(addons, list):
        return rows
    for row in addons:
        if not isinstance(row, dict):
            continue
        code = str(row.get("code") or row.get("material_code") or row.get("name") or "").strip()
        weight_mode = str(row.get("weight_mode") or row.get("type") or "FIXED").upper().strip()
        applies_to = str(row.get("applies_to") or row.get("affects_dimension") or "NONE").upper().strip()
        qty = _to_number(row.get("quantity") or row.get("qty") or 1)
        weight_value = _to_number(row.get("weight_value"))
        rows.append(
            {
                "code": code,
                "weight_mode": weight_mode or "FIXED",
                "applies_to": applies_to or "NONE",
                "quantity": qty if qty is not None else 1.0,
                "weight_value": weight_value if weight_value is not None else 0.0,
            }
        )
    return rows


def validate_pouch_geometry_contract(
    *,
    fg_type: str,
    geometry: Any,
    addons: Any = None,
    template_pouch_style: str = "",
    context_label: str = "Pouch",
) -> Dict[str, Any]:
    normalized = normalize_geometry_override({}, geometry or {})
    normalized_addons = _normalize_addon_rows(addons)
    if str(fg_type or "").upper() != "POUCH":
        return normalized

    errors: Dict[str, str] = {}
    base = normalized.get("base") if isinstance(normalized.get("base"), dict) else {}
    width_mm = _to_decimal(base.get("width_mm")) or Decimal("0")
    height_mm = _to_decimal(base.get("height_mm")) or Decimal("0")
    gusset_mm = _to_decimal(normalized.get("gusset_mm")) or Decimal("0")
    trim_loss_mm = _to_decimal(normalized.get("trim_loss_mm")) or Decimal("0")
    flap_tape_mm = _to_decimal(normalized.get("flap_tape_mm")) or Decimal("0")
    pouch_style = str(
        normalized.get("pouch_style") or template_pouch_style or ""
    ).upper().strip()

    if width_mm <= 0:
        errors["width_mm"] = f"{context_label}: width_mm must be greater than zero."
    if height_mm <= 0:
        errors["height_mm"] = f"{context_label}: height_mm must be greater than zero."
    if trim_loss_mm < 0:
        errors["trim_loss_mm"] = f"{context_label}: trim_loss_mm cannot be negative."
    if flap_tape_mm < 0:
        errors["flap_tape_mm"] = f"{context_label}: flap_tape_mm cannot be negative."
    if gusset_mm < 0:
        errors["gusset_mm"] = f"{context_label}: gusset_mm cannot be negative."

    if pouch_style and pouch_style not in POUCH_STYLE_VALUES:
        errors["pouch_style"] = f"{context_label}: unsupported pouch_style {pouch_style}."

    gusset_required_styles = {"STAND_UP", "SIDE_GUSSET", "QUAD_SEAL", "FLAT_BOTTOM", "SPOUT"}
    style_master_bound = bool(normalized.get("pouch_style_master"))
    style_master_requires_gusset = (
        bool(normalized.get("pouch_style_requires_gusset"))
        if "pouch_style_requires_gusset" in normalized
        else True
    )
    gusset_rule_applies = (not style_master_bound) or style_master_requires_gusset
    if gusset_rule_applies and pouch_style in gusset_required_styles and gusset_mm <= 0:
        errors["gusset_mm"] = f"{context_label}: {pouch_style.replace('_', ' ').title()} requires gusset_mm > 0."

    if pouch_style == "SPOUT":
        has_spout_addon = any(
            any(token in str(row.get("code") or "").upper() for token in ("SPOUT", "FITMENT", "VALVE"))
            for row in normalized_addons
        )
        if not has_spout_addon:
            errors["addons"] = f"{context_label}: SPOUT style requires a spout or fitment add-on row."

    for index, row in enumerate(normalized_addons, start=1):
        weight_mode = str(row.get("weight_mode") or "FIXED").upper()
        applies_to = str(row.get("applies_to") or "NONE").upper()
        quantity = _to_decimal(row.get("quantity")) or Decimal("0")
        weight_value = _to_decimal(row.get("weight_value")) or Decimal("0")

        if weight_mode not in {"FIXED", "PER_PIECE", "PER_MM"}:
            errors[f"addons[{index}]"] = (
                f"{context_label}: add-on {index} has unsupported weight_mode {weight_mode}."
            )
            continue
        if quantity <= 0:
            errors[f"addons[{index}].quantity"] = f"{context_label}: add-on {index} quantity must be greater than zero."
        if weight_value < 0:
            errors[f"addons[{index}].weight_value"] = f"{context_label}: add-on {index} weight_value cannot be negative."
        if weight_mode == "PER_MM" and applies_to not in {"WIDTH", "HEIGHT", "BOTH"}:
            errors[f"addons[{index}].applies_to"] = (
                f"{context_label}: add-on {index} with PER_MM must apply to WIDTH, HEIGHT, or BOTH."
            )

    for index, adjustment in enumerate(normalized.get("adjustments") or [], start=1):
        adj_value = _to_decimal(adjustment.get("value")) or Decimal("0")
        if adj_value < 0:
            errors[f"adjustments[{index}]"] = f"{context_label}: geometry adjustment {index} cannot be negative."

    if errors:
        raise ValidationError(errors)
    return normalized
