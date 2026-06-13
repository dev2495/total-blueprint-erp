from __future__ import annotations

import hashlib
import json
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List

from apps.physics.geometry_override import normalize_geometry_override


def _to_decimal(value: Any, default: Decimal = Decimal("0")) -> Decimal:
    try:
        if value in (None, ""):
            return default
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return default


def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return int(default)


def _canon(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(round(value, 6))
    if isinstance(value, float):
        return float(round(value, 6))
    if isinstance(value, dict):
        return {k: _canon(v) for k, v in sorted(value.items(), key=lambda row: row[0])}
    if isinstance(value, list):
        return [_canon(v) for v in value]
    return value


def _normalize_layers(layers: Any, *, include_width: bool = True) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for row in layers if isinstance(layers, list) else []:
        if not isinstance(row, dict):
            continue
        normalized = {
            "family_id": str(row.get("family_id") or ""),
            "variant_id": str(row.get("variant_id") or ""),
            "grade_id": str(row.get("grade_id") or ""),
            "thickness_micron": float(_to_decimal(row.get("thickness_micron"))),
            "density_g_cm3": float(_to_decimal(row.get("density_g_cm3"))),
        }
        if include_width:
            normalized["width_mm"] = float(_to_decimal(row.get("width_mm") or row.get("roll_width_mm") or 0))
        rows.append(normalized)
    return rows


def _normalize_printing(printing: Any) -> Dict[str, Any]:
    src = printing if isinstance(printing, dict) else {}
    enabled = bool(src.get("enabled", False))
    if not enabled:
        return {"enabled": False}

    print_type = str(src.get("type") or src.get("method") or "").upper().strip()
    substrate_mode = str(src.get("substrate_mode") or "").upper().strip()
    front_count = max(0, _to_int(src.get("front_colors_count"), 0))
    back_count = max(0, _to_int(src.get("back_colors_count"), 0))
    ink_gsm_total = _to_decimal(src.get("ink_gsm_total") or src.get("ink_gsm") or src.get("gsm_per_color") or 0)

    front_colors = [str(v).strip().upper() for v in (src.get("front_colors") or []) if str(v).strip()]
    back_colors = [str(v).strip().upper() for v in (src.get("back_colors") or []) if str(v).strip()]
    color_names = [str(v).strip().upper() for v in (src.get("color_names") or []) if str(v).strip()]

    return {
        "enabled": True,
        "type": print_type,
        "substrate_mode": substrate_mode,
        "front_colors_count": front_count,
        "back_colors_count": back_count,
        "ink_gsm_total": float(ink_gsm_total),
        "artwork_id": str(src.get("artwork_id") or ""),
        "front_colors": front_colors,
        "back_colors": back_colors,
        "color_names": color_names,
    }


def _normalize_addons(addons: Any) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for row in addons if isinstance(addons, list) else []:
        if not isinstance(row, dict):
            continue
        rows.append(
            {
                "addon_id": str(row.get("addon_id") or ""),
                "qty": float(_to_decimal(row.get("qty") or row.get("quantity") or 0)),
                "applies_to": str(row.get("applies_to") or "NONE").upper(),
                "weight_mode": str(row.get("weight_mode") or "").upper(),
                "weight_value": float(_to_decimal(row.get("weight_value") or 0)),
            }
        )
    rows.sort(key=lambda r: (r["addon_id"], r["applies_to"], r["qty"], r["weight_mode"], r["weight_value"]))
    return rows


def build_spec_payload(
    *,
    fg_type: str,
    roll_form: str | None,
    geometry: Any,
    film_layers: Any,
    printing: Any,
    addons: Any,
) -> Dict[str, Any]:
    normalized_fg_type = str(fg_type or "").upper().strip()
    normalized_geometry = normalize_geometry_override({}, geometry or {})
    normalized_layers = _normalize_layers(film_layers)

    payload = {
        "fg_type": normalized_fg_type,
        "roll_form": str(roll_form or "").upper().strip() if normalized_fg_type == "ROLL" else "",
        "geometry": normalized_geometry if normalized_fg_type != "ROLL" else {},
        "pouch_style": str(normalized_geometry.get("pouch_style") or "").upper().strip() if normalized_fg_type == "POUCH" else "",
        "film_layers": normalized_layers,
        "printing": _normalize_printing(printing),
        "addons": _normalize_addons(addons),
    }
    if normalized_fg_type == "ROLL":
        first_layer = normalized_layers[0] if normalized_layers else {}
        payload["roll_invariants"] = {
            "variant_id": str(first_layer.get("variant_id") or ""),
            "family_id": str(first_layer.get("family_id") or ""),
            "grade_id": str(first_layer.get("grade_id") or ""),
            "thickness_micron": float(_to_decimal(first_layer.get("thickness_micron"))),
            "density_g_cm3": float(_to_decimal(first_layer.get("density_g_cm3"))),
            "width_mm": float(_to_decimal(first_layer.get("width_mm") or 0)),
        }
    return payload

def build_invariant_payload(
    *,
    film_layers: Any,
    printing: Any,
) -> Dict[str, Any]:
    """
    Strips geometry, layer width, addons, POD, and focuses on material
    composition and printing configuration for semi-rolls / WIP. Width is
    matched separately so wider rolls can remain valid slitting candidates.
    """
    return {
        "film_layers": _normalize_layers(film_layers, include_width=False),
        "printing": _normalize_printing(printing),
    }


def build_spec_signature(payload: Dict[str, Any]) -> str:
    canonical = _canon(payload)
    serialized = json.dumps(canonical, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()

def build_invariant_signature(payload: Dict[str, Any]) -> str:
    canonical = _canon(payload)
    serialized = json.dumps(canonical, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()
