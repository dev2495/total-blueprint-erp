from __future__ import annotations

from typing import Any

from django.core.exceptions import ValidationError

from apps.materials.stock_forms import STOCK_FORM_LAYFLAT_TUBE, normalize_stock_form

from .print_contract import get_artwork_contract


def normalize_print_type(value: Any, default: str = "FLEXO") -> str:
    raw = str(value or default or "").strip().upper()
    return raw if raw in {"FLEXO", "ROTO", "DIGITAL"} else str(default or "FLEXO").upper()


def normalize_substrate_mode(value: Any, default: str = "SHEET") -> str:
    raw = str(value or default or "").strip().upper()
    return raw if raw in {"SHEET", "TUBING"} else str(default or "SHEET").upper()


def substrate_mode_from_stock_form(value: Any, default: str = "SHEET") -> str:
    raw = str(value or "").strip().upper()
    if raw in {"SHEET", "TUBING"}:
        return raw
    if not raw:
        return normalize_substrate_mode(default)
    return "TUBING" if normalize_stock_form(raw) == STOCK_FORM_LAYFLAT_TUBE else "SHEET"


def _fixed_attributes(product_master: Any) -> dict[str, Any]:
    fixed = getattr(product_master, "fixed_attributes", {}) or {}
    return fixed if isinstance(fixed, dict) else {}


def _sizes(product_master: Any) -> list[Any]:
    manager = getattr(product_master, "sizes", None)
    if manager is None:
        return []
    try:
        if hasattr(manager, "all"):
            return list(manager.all())
        if isinstance(manager, (list, tuple)):
            return list(manager)
    except Exception:
        return []
    return []


def _product_master_stock_form(
    product_master: Any,
    fixed: dict[str, Any],
    axis_values: dict[str, Any] | None = None,
) -> Any:
    axis_values = axis_values if isinstance(axis_values, dict) else {}
    size_code = str(axis_values.get("size") or axis_values.get("size_code") or "").strip()
    if size_code:
        for size in _sizes(product_master):
            if str(getattr(size, "code", "") or "").strip().lower() == size_code.lower():
                return getattr(size, "stock_form", None) or getattr(size, "roll_form", None) or getattr(size, "width_basis", None)

    size_forms: list[str] = []
    for size in _sizes(product_master):
        active = getattr(size, "active", True)
        if active is False:
            continue
        raw = getattr(size, "stock_form", None) or getattr(size, "roll_form", None)
        if raw:
            size_forms.append(str(raw))
    normalized_size_forms = {normalize_stock_form(form) for form in size_forms if str(form or "").strip()}
    if len(normalized_size_forms) == 1:
        return next(iter(normalized_size_forms))
    if len(normalized_size_forms) > 1:
        return next(iter(sorted(normalized_size_forms)))

    for key in (
        "stock_form",
        "default_stock_form",
        "pouch_style_stock_form",
        "pouch_style_default_stock_form",
        "pouch_style_form",
        "roll_form",
    ):
        if fixed.get(key):
            return fixed.get(key)
    for attr in ("stock_form", "default_stock_form", "roll_form"):
        raw = getattr(product_master, attr, None)
        if raw:
            return raw
    return fixed.get("substrate_mode") or fixed.get("film_type") or "SHEET"


def product_master_print_context(
    product_master: Any,
    axis_values: dict[str, Any] | None = None,
) -> dict[str, str]:
    fixed = _fixed_attributes(product_master)
    stock_form = _product_master_stock_form(product_master, fixed, axis_values)
    return {
        "print_type": normalize_print_type(
            fixed.get("print_type") or fixed.get("printing_type") or fixed.get("method") or "FLEXO"
        ),
        "substrate_mode": substrate_mode_from_stock_form(stock_form),
    }


def validate_artwork_compatibility(
    artwork: Any,
    *,
    print_type: Any,
    substrate_mode: Any,
    require_asset: bool = True,
) -> dict[str, Any]:
    """Validate the only hard sales/planner artwork compatibility rules.

    Artwork is no longer product-master locked. A Product Master can declare that
    artwork is needed and can provide a default, but user selection is governed by
    print method and output form. Ink family and ROTO cylinder readiness are
    validated by the downstream print contract / ink resolver.
    """

    if str(getattr(artwork, "status", "") or "").upper() != "APPROVED":
        raise ValidationError("Artwork must be APPROVED.")

    expected_print = normalize_print_type(print_type)
    expected_substrate = normalize_substrate_mode(substrate_mode)
    contract = get_artwork_contract(artwork, require_asset=require_asset, require_ink_usage=False)

    artwork_print = normalize_print_type(contract.get("print_type"))
    if artwork_print != expected_print:
        raise ValidationError(
            f"Artwork print type {artwork_print} does not match selected print type {expected_print}."
        )

    artwork_substrate = normalize_substrate_mode(contract.get("substrate_mode"))
    if artwork_substrate != expected_substrate:
        raise ValidationError(
            f"Artwork film type {artwork_substrate} does not match selected film type {expected_substrate}."
        )

    return contract
