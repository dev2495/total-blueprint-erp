"""Quotation ad-hoc costing service.

Stateless cost preview that takes a pouch spec + customer + plant and
returns a CostingResult with breakdown, margin cascade, and suggested rate.

All preview calls — `compute()` — are pure functions over the spec; no DB
writes. The view layer is responsible for persisting `costing_snapshot` on
QuotationItem when the user saves.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Optional


# Fallback company-wide defaults (cascade rank #4).
COMPANY_DEFAULT_MARGIN = Decimal("15.00")
COMPANY_DEFAULT_RATE_CARD = {
    "extrusion_per_kg": Decimal("26.00"),
    "lamination_per_kg": Decimal("14.00"),
    "printing_per_kg": Decimal("18.50"),
    "slitting_per_kg": Decimal("8.00"),
    "pouching_per_kg": Decimal("14.20"),
    "overhead_per_kg": Decimal("19.00"),
    "scrap_pct": Decimal("0.04"),
}

ALL_CONVERSION_STAGES = (
    "extrusion_per_kg",
    "lamination_per_kg",
    "printing_per_kg",
    "slitting_per_kg",
    "pouching_per_kg",
    "overhead_per_kg",
)


def _dec(value: Any, default: Decimal = Decimal("0")) -> Decimal:
    if value in (None, ""):
        return default
    try:
        return Decimal(str(value))
    except Exception:
        return default


def _round2(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


@dataclass
class CostingResult:
    material_cost_per_kg: Decimal
    conversion_cost_per_kg: Decimal
    total_cost_per_kg: Decimal
    margin_pct: Decimal
    margin_source: str
    suggested_rate: Decimal
    is_indicative: bool
    warnings: list
    breakdown: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "material_cost_per_kg": float(self.material_cost_per_kg),
            "conversion_cost_per_kg": float(self.conversion_cost_per_kg),
            "total_cost_per_kg": float(self.total_cost_per_kg),
            "margin_pct": float(self.margin_pct),
            "margin_source": self.margin_source,
            "suggested_rate": float(self.suggested_rate),
            "is_indicative": self.is_indicative,
            "warnings": list(self.warnings),
            "breakdown": self.breakdown,
        }


class QuotationCostingService:
    """Pure-function cost preview. No DB writes."""

    @classmethod
    def _material_cost(cls, spec: dict, warnings: list) -> tuple[Decimal, list]:
        """Compute material cost per kg of finished pouch.

        Formula: for each layer cost_contrib_per_kg =
          (layer_gsm / total_gsm) × layer_rate_per_kg
        Sum across layers + adhesive + ink + addons.
        """
        try:
            from apps.materials.models import InventoryMaterial
        except Exception:  # pragma: no cover
            InventoryMaterial = None  # type: ignore
        try:
            from apps.costing.models import MaterialCostSnapshot
        except Exception:  # pragma: no cover
            MaterialCostSnapshot = None  # type: ignore

        layers = spec.get("layers") or []
        rows = []
        material_map = {}
        material_ids = [
            str(layer.get("material_id"))
            for layer in layers
            if layer.get("material_id")
        ]
        if material_ids and InventoryMaterial is not None:
            try:
                material_map = {
                    str(mat.id): mat
                    for mat in InventoryMaterial.objects.only(
                        "id", "name", "density_gcm3"
                    ).filter(id__in=material_ids)
                }
            except Exception:
                material_map = {}

        def _layer_gsm(layer: dict) -> Decimal:
            gsm = _dec(layer.get("gsm"))
            if gsm > 0:
                return gsm
            micron = _dec(layer.get("micron"))
            density = _dec(layer.get("density_gcm3"))
            material_id = str(layer.get("material_id") or "")
            mat = material_map.get(material_id)
            if density <= 0 and mat is not None:
                density = _dec(getattr(mat, "density_gcm3", None))
            if micron > 0 and density > 0:
                return micron * density
            return Decimal("0")

        total_gsm = Decimal("0")
        for layer in layers:
            gsm = _layer_gsm(layer)
            total_gsm += gsm

        # Adhesive + ink also contribute to outflow weight.
        adhesive_gsm = _dec(spec.get("adhesive_gsm"))
        ink_gsm = _dec(spec.get("ink_gsm"))
        total_gsm += adhesive_gsm + ink_gsm

        if total_gsm <= 0:
            warnings.append("Total GSM is zero — material cost cannot be computed.")
            return Decimal("0"), rows

        running = Decimal("0")

        for layer in layers:
            gsm = _layer_gsm(layer)
            rate = _dec(layer.get("rate_per_kg"))
            material_id = layer.get("material_id")
            if rate <= 0 and material_id and InventoryMaterial is not None:
                try:
                    mat = material_map.get(str(material_id)) or InventoryMaterial.objects.only("id", "name", "density_gcm3").get(id=material_id)
                    snap = (
                        MaterialCostSnapshot.objects.filter(material=mat).first()
                        if MaterialCostSnapshot is not None
                        else None
                    )
                    if snap is not None:
                        rate = _dec(snap.avg_rate_per_kg)
                    else:
                        warnings.append(
                            f"Material {getattr(mat, 'name', material_id)} has no costing snapshot."
                        )
                except Exception:
                    warnings.append(f"Material {material_id} not found — using rate from spec.")
            if rate <= 0:
                warnings.append(
                    f"Layer '{layer.get('name') or material_id or 'unknown'}' has no rate_per_kg."
                )
            if gsm <= 0:
                warnings.append(
                    f"Layer '{layer.get('name') or material_id or 'unknown'}' has no GSM or density-backed micron."
                )
            contrib = (gsm / total_gsm) * rate
            running += contrib
            rows.append(
                {
                    "kind": "FILM",
                    "name": layer.get("name") or layer.get("material_id") or "Layer",
                    "micron": float(_dec(layer.get("micron"))),
                    "gsm": float(gsm),
                    "rate_per_kg": float(rate),
                    "contribution_per_kg": float(_round2(contrib)),
                }
            )

        if adhesive_gsm > 0:
            adhesive_rate = _dec(spec.get("adhesive_rate_per_kg"))
            contrib = (adhesive_gsm / total_gsm) * adhesive_rate
            running += contrib
            rows.append(
                {
                    "kind": "ADHESIVE",
                    "name": spec.get("adhesive_name") or "Adhesive",
                    "gsm": float(adhesive_gsm),
                    "rate_per_kg": float(adhesive_rate),
                    "contribution_per_kg": float(_round2(contrib)),
                }
            )

        if ink_gsm > 0:
            ink_rate = _dec(spec.get("ink_rate_per_kg"))
            contrib = (ink_gsm / total_gsm) * ink_rate
            running += contrib
            rows.append(
                {
                    "kind": "INK",
                    "name": spec.get("ink_name") or "Ink",
                    "gsm": float(ink_gsm),
                    "rate_per_kg": float(ink_rate),
                    "contribution_per_kg": float(_round2(contrib)),
                }
            )

        # Add-ons (zipper, valve, etc.) use qty × unit rate so quote costing
        # does not silently ignore multiple pieces per pouch.
        for addon in spec.get("addons") or []:
            qty = _dec(addon.get("qty_per_pouch") or 1)
            unit_rate = _dec(addon.get("unit_rate_per_kg") or addon.get("rate_per_kg"))
            flat_cost = _dec(addon.get("cost_per_kg")) if addon.get("cost_per_kg") is not None else (qty * unit_rate)
            running += flat_cost
            rows.append(
                {
                    "kind": "ADDON",
                    "name": addon.get("name") or "Add-on",
                    "qty_per_pouch": float(qty),
                    "unit_rate_per_kg": float(unit_rate),
                    "rate_per_kg": float(unit_rate),
                    "contribution_per_kg": float(_round2(flat_cost)),
                }
            )

        return _round2(running), rows

    @classmethod
    def _conversion_cost(
        cls,
        spec: dict,
        plant: Any,
        material_cost_per_kg: Decimal,
        warnings: list,
    ) -> tuple[Decimal, list, bool]:
        """Walk plant rate card. Return (cost_per_kg, rows, is_indicative)."""
        rate_card: dict = {}
        from_default = False
        if plant is not None:
            rate_card = getattr(plant, "rate_card", None) or {}
        if not rate_card:
            rate_card = dict(COMPANY_DEFAULT_RATE_CARD)
            from_default = True
            if plant is not None:
                warnings.append(
                    f"Plant {getattr(plant, 'code', '?')} has no rate_card configured — "
                    "using company defaults."
                )

        stages_filter = spec.get("conversion_stages") or []
        if not stages_filter:
            stages_filter = list(ALL_CONVERSION_STAGES)
        else:
            # frontend can pass short names ("extrusion", "printing")
            stages_filter = [
                s if s.endswith("_per_kg") else f"{s}_per_kg" for s in stages_filter
            ]

        running = Decimal("0")
        rows = []
        any_missing = False

        for stage in stages_filter:
            raw_value = rate_card.get(stage)
            if raw_value is None:
                any_missing = True
                warnings.append(f"Plant rate card missing stage '{stage}'.")
                continue
            rate = _dec(raw_value)
            running += rate
            rows.append(
                {
                    "stage": stage.replace("_per_kg", ""),
                    "rate_per_kg": float(rate),
                }
            )

        scrap_pct = _dec(rate_card.get("scrap_pct"), Decimal("0"))
        scrap_cost = (material_cost_per_kg + running) * scrap_pct
        if scrap_pct > 0:
            rows.append(
                {
                    "stage": "scrap",
                    "rate_per_kg": float(_round2(scrap_cost)),
                    "scrap_pct": float(scrap_pct),
                }
            )
            running += scrap_cost

        # Only flag indicative if a real plant card was passed AND a stage was missing.
        # Company-default fallback is "indicative" too because there's no concrete plant card.
        is_indicative = any_missing or from_default
        return _round2(running), rows, is_indicative

    @classmethod
    def _resolve_margin(
        cls,
        *,
        manual_margin_pct: Optional[Decimal],
        customer: Any,
        plant: Any,
        spec: dict,
    ) -> tuple[Decimal, str]:
        # 1. manual override
        if manual_margin_pct is not None:
            return _round2(_dec(manual_margin_pct)), "MANUAL"

        # 2. customer overlay — uses CustomerProductOverlay.margin_floor_pct
        # Resolution requires both a customer and a product_master pointer in the spec
        # (catalog lines carry product_master_id; ad-hoc lines may attach one when
        # the user chose to save the spec as a master).
        try:
            from apps.sales.models import CustomerProductOverlay
        except Exception:  # pragma: no cover
            CustomerProductOverlay = None  # type: ignore

        product_master_id = (
            spec.get("product_master_id")
            or spec.get("product_master")
            or spec.get("pm_id")
        )
        if (
            customer is not None
            and product_master_id
            and CustomerProductOverlay is not None
        ):
            try:
                overlay = (
                    CustomerProductOverlay.objects
                    .filter(
                        customer=customer,
                        product_master_id=product_master_id,
                        active=True,
                        margin_floor_pct__isnull=False,
                    )
                    .order_by("-updated_at")
                    .first()
                )
                if overlay is not None and overlay.margin_floor_pct is not None:
                    return _round2(_dec(overlay.margin_floor_pct)), "CUSTOMER"
            except Exception:  # pragma: no cover - defensive
                pass

        # 3. pouch_style.default_margin_pct
        pouch_style_id = spec.get("pouch_style_id")
        if pouch_style_id:
            try:
                from apps.materials.models import PouchStyleMaster
                ps = PouchStyleMaster.objects.only("default_margin_pct").get(id=pouch_style_id)
                if ps.default_margin_pct is not None:
                    return _round2(_dec(ps.default_margin_pct)), "POUCH_STYLE"
            except Exception:
                pass

        # 4. plant default
        if plant is not None and getattr(plant, "default_margin_pct", None) is not None:
            return _round2(_dec(plant.default_margin_pct)), "PLANT"

        # 5. company default
        return _round2(COMPANY_DEFAULT_MARGIN), "COMPANY_DEFAULT"

    @classmethod
    def compute(
        cls,
        *,
        spec: dict,
        customer: Any = None,
        plant: Any = None,
        manual_margin_pct: Optional[Decimal] = None,
        manual_rate: Optional[Decimal] = None,
    ) -> CostingResult:
        warnings: list = []

        material_cost_per_kg, material_rows = cls._material_cost(spec, warnings)
        conversion_cost_per_kg, conversion_rows, is_indicative = cls._conversion_cost(
            spec, plant, material_cost_per_kg, warnings
        )
        total_cost_per_kg = _round2(material_cost_per_kg + conversion_cost_per_kg)

        if manual_rate is not None and _dec(manual_rate) > 0:
            # Rate is pinned; back-compute margin.
            rate = _round2(_dec(manual_rate))
            if total_cost_per_kg > 0:
                margin_pct = _round2(
                    ((rate - total_cost_per_kg) / total_cost_per_kg) * Decimal("100")
                )
            else:
                margin_pct = Decimal("0")
            margin_source = "MANUAL"
            suggested_rate = rate
        else:
            margin_pct, margin_source = cls._resolve_margin(
                manual_margin_pct=manual_margin_pct,
                customer=customer,
                plant=plant,
                spec=spec,
            )
            suggested_rate = _round2(
                total_cost_per_kg * (Decimal("1") + margin_pct / Decimal("100"))
            )

        breakdown = {
            "materials": material_rows,
            "conversion": conversion_rows,
        }

        return CostingResult(
            material_cost_per_kg=material_cost_per_kg,
            conversion_cost_per_kg=conversion_cost_per_kg,
            total_cost_per_kg=total_cost_per_kg,
            margin_pct=margin_pct,
            margin_source=margin_source,
            suggested_rate=suggested_rate,
            is_indicative=is_indicative,
            warnings=warnings,
            breakdown=breakdown,
        )
