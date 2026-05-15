from __future__ import annotations

import hashlib
import json
import re
from decimal import Decimal
from typing import Any


def normalize_code(value: Any, *, fallback: str = "X", max_length: int = 100) -> str:
    """
    Canonical ERP code normalizer.

    Codes are stable, uppercase, ASCII-like tokens with separators preserved
    where operators already use them in material masters.
    """
    raw = str(value or "").strip().upper()
    normalized = re.sub(r"[^A-Z0-9._-]+", "-", raw).strip("-._")
    normalized = re.sub(r"-{2,}", "-", normalized)
    normalized = normalized or fallback
    return normalized[:max_length].strip("-._") or fallback[:max_length]


def short_hash(payload: Any, *, length: int = 6) -> str:
    body = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(body.encode("utf-8")).hexdigest()[:length].upper()


def number_token(value: Any) -> str:
    if value in (None, ""):
        return ""
    try:
        numeric = Decimal(str(value))
    except Exception:
        return normalize_code(value, max_length=20)
    if numeric == numeric.to_integral_value():
        return str(int(numeric))
    return str(numeric.normalize()).replace(".", "P")


def product_master_code(*, family: str, form: str, layer_count: Any = None, qualifier: str = "") -> str:
    parts = ["PM", family, form]
    if layer_count not in (None, ""):
        parts.append(f"{number_token(layer_count)}L")
    if qualifier:
        parts.append(qualifier)
    return normalize_code("-".join(str(part) for part in parts if str(part or "").strip()), max_length=80)


def product_master_size_code(*, width_mm: Any, height_mm: Any, gusset_mm: Any = None, roll_width_mm: Any = None) -> str:
    parts = [f"{number_token(width_mm)}X{number_token(height_mm)}"]
    if gusset_mm not in (None, "", 0, "0"):
        parts.append(f"G{number_token(gusset_mm)}")
    return normalize_code("-".join(parts), max_length=80)


def material_code(*, category: str, family: str = "", spec: str = "", kind: str = "") -> str:
    category_prefixes = {
        "FILM_FAMILY": "FF",
        "FILM_VARIANT": "FV",
        "GRANULE": "GR",
        "INK": "INK",
        "SOLVENT": "SOL",
        "ADHESIVE": "ADH",
        "PACKAGING": "PKG",
        "ADDON": "ADD",
        "POD": "POD",
    }
    prefix = category_prefixes.get(str(category or "").upper(), normalize_code(category, max_length=10))
    parts = [prefix, kind, family, spec]
    return normalize_code("-".join(str(part) for part in parts if str(part or "").strip()), max_length=100)


def _canonical(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _canonical(child) for key, child in sorted(value.items(), key=lambda item: str(item[0]))}
    if isinstance(value, list):
        return [_canonical(child) for child in value]
    if isinstance(value, Decimal):
        return str(value)
    return value


def _axis_code(axis_values: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = axis_values.get(key)
        if isinstance(value, dict):
            value = value.get("code") or value.get("material_code") or value.get("pod_sku_code") or value.get("value")
        if value not in (None, "", [], {}):
            if isinstance(value, list):
                value = "+".join(str(item) for item in value if item not in (None, ""))
            return normalize_code(value, max_length=36)
    return ""


def _final_size_token(axis_values: dict[str, Any], geometry: dict[str, Any] | None) -> str:
    axis_token = _axis_code(axis_values, "size", "size_code", "size_variant_code", "geometry")
    if axis_token:
        return axis_token

    sources: list[dict[str, Any]] = []
    axis_geometry = axis_values.get("geometry")
    if isinstance(axis_geometry, dict):
        sources.append(axis_geometry)
        base = axis_geometry.get("base")
        if isinstance(base, dict):
            sources.append(base)
    if isinstance(geometry, dict):
        sources.append(geometry)
        base = geometry.get("base")
        if isinstance(base, dict):
            sources.append(base)
    sources.append(axis_values)

    for source in sources:
        width = source.get("width_mm")
        height = source.get("height_mm")
        if width not in (None, "", 0, "0") and height not in (None, "", 0, "0"):
            return product_master_size_code(
                width_mm=width,
                height_mm=height,
                gusset_mm=source.get("gusset_mm"),
            )
    return ""


def _thickness_token(axis_values: dict[str, Any], geometry: dict[str, Any] | None, layers: list[dict[str, Any]] | None) -> str:
    if isinstance(geometry, dict):
        thickness = geometry.get("thickness_um") or geometry.get("total_thickness_micron") or geometry.get("thickness_micron")
        if thickness not in (None, "", 0, "0"):
            return f"T{number_token(thickness)}U"
    if isinstance(layers, list):
        total = Decimal("0")
        for row in layers:
            if not isinstance(row, dict):
                continue
            try:
                total += Decimal(str(row.get("thickness_micron") or row.get("thickness_um") or 0))
            except Exception:
                pass
        if total > 0:
            return f"T{number_token(total)}U"
    layer_thicknesses = axis_values.get("layer_thicknesses") if isinstance(axis_values.get("layer_thicknesses"), dict) else {}
    total = Decimal("0")
    for value in layer_thicknesses.values():
        try:
            total += Decimal(str(value or 0))
        except Exception:
            pass
    if total > 0:
        return f"T{number_token(total)}U"
    return ""


def product_variant_code(
    *,
    master_code: str,
    axis_values: dict[str, Any],
    geometry: dict[str, Any] | None = None,
    layers: list[dict[str, Any]] | None = None,
    max_length: int = 80,
) -> str:
    axis_values = axis_values if isinstance(axis_values, dict) else {}
    tokens = [
        _final_size_token(axis_values, geometry),
        _thickness_token(axis_values, geometry, layers),
        _axis_code(axis_values, "pod_variant", "pod", "pod_sku_variant"),
        _axis_code(axis_values, "packaging_inner", "packaging_ref"),
    ]
    tokens = [token for token in tokens if token]
    digest = short_hash({"axis": _canonical(axis_values), "geometry": _canonical(geometry or {}), "layers": _canonical(layers or [])})
    base = normalize_code("-".join([master_code, "V", *tokens]), max_length=max_length)
    suffix = f"-{digest}"
    if len(base) + len(suffix) > max_length:
        base = base[: max_length - len(suffix)].rstrip("-._")
    return f"{base}{suffix}"
