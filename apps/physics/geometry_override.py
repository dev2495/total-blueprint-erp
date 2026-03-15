from __future__ import annotations

import json
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List


POD_OVERRIDE_KEYS = {
    "pod_enabled",
    "pod_height_mm",
    "pod_type",
    "pod",
    "pod_summary",
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
        impact = str(row.get("impact") or row.get("affects_dimension") or "WIDTH").upper()
        if impact not in {"WIDTH", "HEIGHT", "BOTH"}:
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

    raw_multipliers = source.get("multipliers") if isinstance(source.get("multipliers"), dict) else {}
    faces = _to_number(raw_multipliers.get("faces"))

    normalized: Dict[str, Any] = {
        "base": {
            "width_mm": width if width is not None else 0.0,
            "height_mm": height if height is not None else 0.0,
        },
        "adjustments": _normalize_adjustments(source.get("adjustments")),
        "multipliers": {
            "faces": int(max(1, faces if faces is not None else 1)),
        },
    }

    for key in ("gusset_mm", "trim_loss_mm", "flap_tape_mm"):
        number = _to_number(source.get(key))
        if number is not None:
            normalized[key] = number

    for key in ("pod_enabled", "pod_height_mm", "pod_type", "pod"):
        if key in source:
            normalized[key] = source.get(key)
    pouch_style = str(source.get("pouch_style") or "").upper().strip()
    if pouch_style in POUCH_STYLE_VALUES:
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

    pouch_style = str(override_geometry.get("pouch_style") or "").upper().strip()
    if pouch_style in POUCH_STYLE_VALUES:
        payload["pouch_style"] = pouch_style

    if "adjustments" in override_geometry:
        payload["adjustments"] = _normalize_adjustments(override_geometry.get("adjustments"))
    elif "adjustments" in base:
        payload["adjustments"] = _normalize_adjustments(base.get("adjustments"))
    else:
        payload["adjustments"] = []

    multipliers = override_geometry.get("multipliers")
    if isinstance(multipliers, dict):
        faces = _to_number(multipliers.get("faces"))
        payload["multipliers"] = {
            "faces": int(max(1, faces if faces is not None else 1)),
        }

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
    if "pouch_style" in override:
        normalized["pouch_style"] = override["pouch_style"]
    if "adjustments" in override:
        normalized["adjustments"] = override.get("adjustments") or []
    if "multipliers" in override:
        normalized["multipliers"] = override.get("multipliers") or {}

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
