"""How much one piece of a packing item is, in its stock unit, and where that comes from.

Packing items made in house are linked to a packaging Product Master variant; their weight
comes from that variant's BOM (the same physics an order uses), so a bag or inner pouch
weighs what its master says. Bought items, or items not linked yet, use the value entered
on the packaging master.

Rules for packing items (owner, 23 Oct 2026):
- Inner pouches made in house are taken off stock at the machine, by weight from the BOM,
  and are the only packing item the ERP demands automatically when an order is short.
- Bought inner pouches and every other packing item (gonny, carton, LD sheets and rolls,
  tape, extras) are taken off stock by the evening packing count; in-house ones are
  restocked by hand from the Stock launcher.
"""
from __future__ import annotations

import logging
from decimal import Decimal

from config.request_context import request_memo

logger = logging.getLogger(__name__)

IN_HOUSE_MODES = {"IN_HOUSE", "BOTH"}


def _dec(value) -> Decimal:
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal("0")


def is_in_house(material) -> bool:
    return str(getattr(material, "packaging_supply_mode", "") or "").upper() in IN_HOUSE_MODES


def is_inner_pouch(material) -> bool:
    return str(getattr(material, "packaging_kind", "") or "").upper() == "INNER_POUCH"


def taken_at_machine(material) -> bool:
    """Only in-house inner pouches come off stock as output is logged."""
    return is_inner_pouch(material) and is_in_house(material)


def auto_demand(material) -> bool:
    """Only in-house inner pouches are demanded automatically; the rest are restocked by hand."""
    return is_inner_pouch(material) and is_in_house(material)


def _linked_variant(material):
    variant = getattr(material, "produced_by_product_variant", None) if getattr(material, "produced_by_product_variant_id", None) else None
    master = getattr(variant, "master", None) if variant else None
    if not variant or not master or str(getattr(master, "product_kind", "") or "").upper() != "PACKAGING":
        return None
    return variant


def _compute_bom_measure(variant) -> dict | None:
    from apps.sales.services.order_service import SalesOrderService

    master = variant.master
    geometry = variant.geometry_snapshot or {}
    fixed = master.fixed_attributes if isinstance(master.fixed_attributes, dict) else {}
    template = getattr(master, "template", None) or getattr(master, "default_template", None)
    fg_type = str(geometry.get("finished_good_type") or fixed.get("fg_type") or getattr(template, "fg_type", "") or "POUCH").upper()
    payload = {
        "finished_good_type": fg_type,
        "geometry": geometry,
        "film_layers": variant.layer_snapshot or [],
        "printing": {"enabled": False},
        "chemicals": {},
        "addons": [],
        "packaging_snapshot": {},
        "roll_form": geometry.get("roll_form"),
    }
    if fg_type == "ROLL":
        # A roll has no piece; its BOM gives kg per metre: web width x grams per square metre.
        from apps.production.services.services_execution import ExecutionService

        layers = [layer for layer in (variant.layer_snapshot or []) if isinstance(layer, dict)]
        gsm = sum((ExecutionService._layer_gsm(layer) for layer in layers), Decimal("0"))
        width_mm = _dec(geometry.get("width_mm") or (geometry.get("base") or {}).get("width_mm") or max((_dec(layer.get("width_mm")) for layer in layers), default=0))
        kg_per_metre = (width_mm / Decimal("1000") * gsm / Decimal("1000")).quantize(Decimal("0.000001")) if width_mm > 0 and gsm > 0 else None
        return {"fg_type": fg_type, "weight_kg_per_piece": None, "kg_per_metre": kg_per_metre}
    preview = SalesOrderService.preview_sales_item({**payload, "order_qty": 1000, "uom": "PCS"})
    unit_weight_g = _dec(preview.get("unit_weight_g"))
    if unit_weight_g <= 0:
        return None
    return {"fg_type": fg_type, "weight_kg_per_piece": (unit_weight_g / Decimal("1000")).quantize(Decimal("0.000001")), "kg_per_metre": None}


def bom_measure(material) -> dict | None:
    """The linked variant's BOM figures, or None when the item is not linked."""
    variant = _linked_variant(material)
    if variant is None:
        return None

    def build():
        try:
            result = _compute_bom_measure(variant)
        except Exception:
            logger.warning("Packaging BOM measure failed material=%s variant=%s", getattr(material, "code", ""), variant.code, exc_info=True)
            result = None
        if result is None:
            return None
        return {**result, "variant_id": str(variant.id), "variant_code": variant.code, "master_code": variant.master.code, "master_name": variant.master.name}

    return request_memo(("packaging_bom_measure", str(variant.id), variant.bom_signature), build)


def piece_measure(material) -> dict:
    """Stock-unit quantity of one piece (`per_piece`), its weight in kg, and where it came from.

    source: PCS (stocked in pieces), BOM (linked variant), MASTER (entered on the packaging
    master) or MISSING.
    """
    base_uom = str(getattr(material, "base_uom", "") or "PCS").upper()
    defaults = getattr(material, "packaging_defaults_json", None)
    defaults = defaults if isinstance(defaults, dict) else {}
    bom = bom_measure(material)
    bom_piece_kg = bom.get("weight_kg_per_piece") if bom else None
    entered = _dec(getattr(material, "per_sheet_base_qty", None))
    result = {"base_uom": base_uom, "per_piece": None, "weight_kg": None, "kg_per_metre": None, "source": "MISSING", "bom": bom}

    if base_uom == "PCS":
        result.update(per_piece=Decimal("1"), source="PCS")
        if bom_piece_kg:
            result.update(weight_kg=bom_piece_kg, weight_source="BOM")
        elif _dec(defaults.get("weight_kg_per_base_uom")) > 0:
            result.update(weight_kg=_dec(defaults.get("weight_kg_per_base_uom")), weight_source="MASTER")
        return result
    if base_uom == "KG":
        if bom_piece_kg:
            result.update(per_piece=bom_piece_kg, weight_kg=bom_piece_kg, source="BOM")
        elif entered > 0:
            result.update(per_piece=entered, weight_kg=entered, source="MASTER")
        return result
    if base_uom == "METER":
        kg_per_metre = (
            (bom or {}).get("kg_per_metre")
            or _dec(defaults.get("tare_kg_per_meter") or defaults.get("weight_kg_per_base_uom"))
            or None
        )
        result["kg_per_metre"] = kg_per_metre
        if entered > 0:
            result.update(per_piece=entered, source="MASTER")
            if kg_per_metre:
                result["weight_kg"] = (entered * kg_per_metre).quantize(Decimal("0.000001"))
        return result
    if entered > 0:
        result.update(per_piece=entered, source="MASTER")
    return result


def stock_qty_per_piece(material) -> Decimal:
    """Stock-unit quantity of one piece (0 when it cannot be worked out)."""
    return piece_measure(material).get("per_piece") or Decimal("0")


def describe(material) -> dict:
    """What the packaging master and its Product Master link show for this item."""
    measure = piece_measure(material)
    bom = measure.get("bom") or None
    in_house = is_in_house(material)
    machine = taken_at_machine(material)
    return {
        "base_uom": measure["base_uom"],
        "per_piece": float(measure["per_piece"]) if measure.get("per_piece") else None,
        "weight_kg_per_piece": float(measure["weight_kg"]) if measure.get("weight_kg") else None,
        "kg_per_metre": float(measure["kg_per_metre"]) if measure.get("kg_per_metre") else None,
        "source": measure["source"],
        "weight_source": measure.get("weight_source") or (measure["source"] if measure.get("weight_kg") else None),
        "bom": {
            "master_code": bom["master_code"],
            "master_name": bom["master_name"],
            "variant_code": bom["variant_code"],
            "fg_type": bom["fg_type"],
        } if bom else None,
        "stock_rule": "AT_MACHINE" if machine else "EVENING_COUNT",
        "demand_rule": "AUTO" if auto_demand(material) else ("MANUAL_STOCK_LAUNCHER" if in_house else "PURCHASE"),
    }
