from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Iterable

from apps.materials.stock_forms import (
    SLIT_POLICY_ALLOWED,
    normalize_slit_policy,
    normalize_stock_form,
)


MODE_PRESERVE = "PRESERVE"
MODE_TARGET_DECIDES = "TARGET_DECIDES"
MODE_OPERATOR_DECIDES = "OPERATOR_DECIDES"
MODE_CONVERTS_FORM = "CONVERTS_FORM"


@dataclass(frozen=True)
class StockFormContract:
    """Canonical stock-form target used by planning, allocation, and execution.

    This is intentionally separate from Process Master. Product/sales/pouch
    data says what is required for the job; Process Master says whether a step
    can physically accept or produce it.
    """

    stock_form: str
    slit_policy: str = SLIT_POLICY_ALLOWED
    width_mm: Decimal = Decimal("0")
    width_basis: str = ""
    source: str = "legacy"

    def as_dict(self) -> dict:
        return {
            "stock_form": self.stock_form,
            "slit_policy": self.slit_policy,
            "width_mm": str(self.width_mm),
            "width_basis": self.width_basis,
            "source": self.source,
        }


def _decimal(value: Any) -> Decimal:
    try:
        return Decimal(str(value or 0))
    except Exception:
        return Decimal("0")


def _dict_sources(*sources: Any) -> Iterable[dict]:
    for source in sources:
        if isinstance(source, dict):
            yield source


class StockFormResolver:
    """Resolve stock-form requirements without spreading guesses across modules."""

    @classmethod
    def from_geometry(cls, geometry: dict | None, *, source: str = "geometry") -> StockFormContract | None:
        if not isinstance(geometry, dict):
            return None
        form = geometry.get("stock_form")
        if not form:
            return None
        stock_form = normalize_stock_form(form)
        width = _decimal(
            geometry.get("planned_parent_width_mm")
            or geometry.get("child_target_width_mm")
            or geometry.get("film_area_width_mm")
            or geometry.get("width_mm")
        )
        return StockFormContract(
            stock_form=stock_form,
            slit_policy=normalize_slit_policy(geometry.get("slit_policy"), stock_form=stock_form),
            width_mm=width,
            width_basis=str(geometry.get("width_basis") or ""),
            source=source,
        )

    @classmethod
    def from_sales_order_item(cls, sales_order_item: Any) -> StockFormContract | None:
        if sales_order_item is None:
            return None
        for key in ("geometry_snapshot", "variant_snapshot", "bom_snapshot"):
            contract = cls.from_geometry(getattr(sales_order_item, key, None), source=f"sales_order_item.{key}")
            if contract:
                return contract
        return None

    @classmethod
    def from_job(cls, job: Any) -> StockFormContract:
        soi_contract = cls.from_sales_order_item(getattr(job, "sales_order_item", None))
        if soi_contract:
            return soi_contract

        meta = getattr(job, "meta_json", None)
        for source in _dict_sources(meta, (meta or {}).get("geometry_snapshot") if isinstance(meta, dict) else None):
            contract = cls.from_geometry(source, source="job.meta_json")
            if contract:
                return contract

        return StockFormContract(stock_form=normalize_stock_form(None), source="legacy_default")

    @staticmethod
    def _allowed(process: Any, attr: str) -> list[str]:
        raw = getattr(process, attr, None)
        if not isinstance(raw, list):
            return []
        cleaned = []
        for item in raw:
            form = normalize_stock_form(item)
            if form not in cleaned:
                cleaned.append(form)
        return cleaned

    @classmethod
    def process_accepts_input(cls, process: Any, stock_form: Any) -> bool:
        allowed = cls._allowed(process, "allowed_input_stock_forms")
        return not allowed or normalize_stock_form(stock_form) in allowed

    @classmethod
    def process_can_output(cls, process: Any, stock_form: Any) -> bool:
        allowed = cls._allowed(process, "allowed_output_stock_forms")
        return not allowed or normalize_stock_form(stock_form) in allowed

    @classmethod
    def resolve_output_stock_form(
        cls,
        process: Any,
        *,
        input_stock_form: Any = None,
        target_contract: StockFormContract | dict | None = None,
        operator_stock_form: Any = None,
    ) -> str:
        if isinstance(target_contract, StockFormContract):
            target_form = target_contract.stock_form
        elif isinstance(target_contract, dict):
            target_form = target_contract.get("stock_form")
        else:
            target_form = None

        mode = str(getattr(process, "stock_form_output_mode", "") or MODE_PRESERVE).upper()
        if mode == MODE_OPERATOR_DECIDES:
            chosen = operator_stock_form or target_form or input_stock_form
        elif mode in {MODE_TARGET_DECIDES, MODE_CONVERTS_FORM}:
            chosen = target_form or operator_stock_form or input_stock_form
        else:
            chosen = input_stock_form or target_form or operator_stock_form

        form = normalize_stock_form(chosen)
        if not cls.process_can_output(process, form):
            allowed = ", ".join(cls._allowed(process, "allowed_output_stock_forms")) or "none"
            raise ValueError(f"Process {getattr(process, 'code', '') or getattr(process, 'name', '')} cannot output {form}. Allowed: {allowed}.")
        return form
