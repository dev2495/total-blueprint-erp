"""Which packing items carry a weight, where it comes from, and how each comes off stock.

Rules (owner, 23 Oct 2026):
- A dispatch unit weighs our product (the machine's logged output) + its inner pouches + the
  gonny. Only inner pouches and gonnies carry a weight.
- In-house inner pouches weigh what the BOM of their linked Product Master variant says.
  Bought inner pouches and gonnies weigh what is entered on the packaging master (required).
- In-house inner pouches are taken off stock at the machine (by weight) and are the only
  packing item demanded automatically.
- Bought inner pouches and every other packing item (gonny, cartons, LD sheets and rolls,
  tape, extras) come off stock at the evening packing count. Other items carry no weight:
  their Product Master BOM only says how to make them; in-house ones are restocked by hand
  from the Stock launcher.
"""
from __future__ import annotations

import logging
from decimal import Decimal

from config.request_context import request_memo

logger = logging.getLogger(__name__)

IN_HOUSE_MODES = {"IN_HOUSE", "BOTH"}
WEIGHED_KINDS = {"INNER_POUCH", "GONNY"}


def _dec(value) -> Decimal:
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal("0")


def _kind(material) -> str:
    return str(getattr(material, "packaging_kind", "") or "").upper()


def _mode(material) -> str:
    return str(getattr(material, "packaging_supply_mode", "") or "").upper()


def is_in_house(material) -> bool:
    return _mode(material) in IN_HOUSE_MODES


def is_inner_pouch(material) -> bool:
    return _kind(material) == "INNER_POUCH"


def is_weighed(material) -> bool:
    """Only inner pouches and gonnies are part of a dispatch unit's weight."""
    return _kind(material) in WEIGHED_KINDS


def taken_at_machine(material) -> bool:
    """Only in-house inner pouches come off stock as output is logged."""
    return is_inner_pouch(material) and is_in_house(material)


def auto_demand(material) -> bool:
    """Only in-house inner pouches are demanded automatically; the rest are restocked by hand."""
    return is_inner_pouch(material) and is_in_house(material)


def entered_weight_kg(material) -> Decimal:
    """Weight of one piece as entered on the packaging master (bought pouches, gonnies)."""
    if str(getattr(material, "base_uom", "") or "").upper() == "KG":
        return _dec(getattr(material, "per_sheet_base_qty", None))
    defaults = getattr(material, "packaging_defaults_json", None)
    defaults = defaults if isinstance(defaults, dict) else {}
    return _dec(defaults.get("weight_kg_per_base_uom"))


def _linked_variant(material):
    variant = getattr(material, "produced_by_product_variant", None) if getattr(material, "produced_by_product_variant_id", None) else None
    master = getattr(variant, "master", None) if variant else None
    if not variant or not master or str(getattr(master, "product_kind", "") or "").upper() != "PACKAGING":
        return None
    return variant


def bom_weight(material) -> dict | None:
    """Weight of one in-house inner pouch from its linked variant's BOM (None when not linked)."""
    if not taken_at_machine(material):
        return None
    variant = _linked_variant(material)
    if variant is None:
        return None

    def build():
        from apps.sales.services.order_service import SalesOrderService

        master = variant.master
        geometry = variant.geometry_snapshot or {}
        fixed = master.fixed_attributes if isinstance(master.fixed_attributes, dict) else {}
        try:
            preview = SalesOrderService.preview_sales_item({
                "finished_good_type": str(geometry.get("finished_good_type") or fixed.get("fg_type") or "POUCH").upper(),
                "geometry": geometry,
                "film_layers": variant.layer_snapshot or [],
                "printing": {"enabled": False},
                "chemicals": {},
                "addons": [],
                "packaging_snapshot": {},
                "order_qty": 1000,
                "uom": "PCS",
            })
        except Exception:
            logger.warning("Inner pouch BOM weight failed material=%s variant=%s", getattr(material, "code", ""), variant.code, exc_info=True)
            return None
        unit_weight_g = _dec(preview.get("unit_weight_g"))
        if unit_weight_g <= 0:
            return None
        return {
            "weight_kg": (unit_weight_g / Decimal("1000")).quantize(Decimal("0.000001")),
            "variant_id": str(variant.id),
            "variant_code": variant.code,
            "master_code": master.code,
            "master_name": master.name,
        }

    return request_memo(("inner_pouch_bom_weight", str(variant.id), variant.bom_signature), build)


def piece_weight(material) -> dict:
    """Weight in kg of one inner pouch or gonny and where it comes from.

    source: BOM (in-house pouch, linked variant), MASTER (entered), MISSING, or NOT_WEIGHED
    (every other packing item).
    """
    if not is_weighed(material):
        return {"weight_kg": None, "source": "NOT_WEIGHED", "bom": None}
    if taken_at_machine(material):
        bom = bom_weight(material)
        if bom:
            return {"weight_kg": bom["weight_kg"], "source": "BOM", "bom": bom}
        if _mode(material) == "BOTH" and entered_weight_kg(material) > 0:
            # A bought SKU that is also made here: its entered weight until it is linked.
            return {"weight_kg": entered_weight_kg(material), "source": "MASTER", "bom": None}
        return {"weight_kg": None, "source": "MISSING", "bom": None}
    entered = entered_weight_kg(material)
    if entered > 0:
        return {"weight_kg": entered, "source": "MASTER", "bom": None}
    return {"weight_kg": None, "source": "MISSING", "bom": None}


def stock_qty_per_piece(material) -> Decimal:
    """Stock-unit quantity of one piece: 1 for items stocked in pieces, the weight for
    pouches and gonnies stocked in kg, otherwise 0 (counted in their own unit)."""
    base_uom = str(getattr(material, "base_uom", "") or "PCS").upper()
    if base_uom == "PCS":
        return Decimal("1")
    if base_uom == "KG":
        return piece_weight(material).get("weight_kg") or Decimal("0")
    return Decimal("0")


def describe(material) -> dict:
    """What the packaging master and its Product Master link show for this item."""
    weight = piece_weight(material)
    bom = weight.get("bom") or None
    return {
        "base_uom": str(getattr(material, "base_uom", "") or "PCS").upper(),
        "weighed": is_weighed(material),
        "weight_kg_per_piece": float(weight["weight_kg"]) if weight.get("weight_kg") else None,
        "source": weight["source"],
        "bom": {
            "master_code": bom["master_code"],
            "master_name": bom["master_name"],
            "variant_code": bom["variant_code"],
        } if bom else None,
        "stock_rule": "AT_MACHINE" if taken_at_machine(material) else "EVENING_COUNT",
        "demand_rule": "AUTO" if auto_demand(material) else ("MANUAL_STOCK_LAUNCHER" if is_in_house(material) else "PURCHASE"),
    }
