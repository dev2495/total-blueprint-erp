from __future__ import annotations

from typing import Any

from django.core.exceptions import ValidationError

from .print_contract import get_artwork_contract


def normalize_print_type(value: Any, default: str = "FLEXO") -> str:
    raw = str(value or default or "").strip().upper()
    return raw if raw in {"FLEXO", "ROTO", "DIGITAL"} else str(default or "FLEXO").upper()


def normalize_substrate_mode(value: Any, default: str = "SHEET") -> str:
    raw = str(value or default or "").strip().upper()
    return raw if raw in {"SHEET", "TUBING"} else str(default or "SHEET").upper()


def product_master_print_context(product_master: Any) -> dict[str, str]:
    fixed = getattr(product_master, "fixed_attributes", {}) or {}
    if not isinstance(fixed, dict):
        fixed = {}
    return {
        "print_type": normalize_print_type(
            fixed.get("print_type") or fixed.get("printing_type") or fixed.get("method") or "FLEXO"
        ),
        "substrate_mode": normalize_substrate_mode(
            fixed.get("film_type") or fixed.get("substrate_mode") or fixed.get("roll_form") or "SHEET"
        ),
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
