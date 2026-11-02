from __future__ import annotations

import logging
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Iterable

from apps.materials.stock_forms import (
    FOLDABLE_FORMS,
    SLIT_POLICY_ALLOWED,
    default_slit_policy,
    default_width_basis,
    fold_as_json,
    normalize_fold,
    normalize_slit_policy,
    normalize_stock_form,
    open_width_for,
)

logger = logging.getLogger(__name__)


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
    fold: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        data = {
            "stock_form": self.stock_form,
            "slit_policy": self.slit_policy,
            "width_mm": str(self.width_mm),
            "width_basis": self.width_basis,
            "source": self.source,
        }
        if self.stock_form in FOLDABLE_FORMS:
            data["fold"] = fold_as_json(self.fold)
            data["open_width_mm"] = str(open_width_for(self.stock_form, self.width_mm, self.fold))
        return data


@dataclass(frozen=True)
class StepFormContracts:
    """What one route step takes in and puts out.

    Before the route's fold step the web is still open (open width = 2W + flap + seal + trim);
    the fold step takes that open web and outputs the line's folded / tube form; later steps
    run on the folded / tube stock. Lines with no fold step take and give the line's form.
    """

    input: StockFormContract
    output: StockFormContract
    target: StockFormContract
    fold_step_index: int | None = None

    @property
    def fold_ahead(self) -> bool:
        """True while this step still runs the open web (this step is the fold or comes before it)."""
        return self.input.stock_form != self.target.stock_form


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
            fold=normalize_fold(geometry.get("fold")) if stock_form in FOLDABLE_FORMS else {},
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

    @classmethod
    def makes_form(cls, process: Any, stock_form: Any) -> bool:
        """True when this process turns its input into `stock_form` (a fold / fold-and-seal step).

        Read from Process Master: it must list its input forms, take its output form from the
        order (not PRESERVE), and be able to output a form it does not take in.
        """
        if process is None:
            return False
        mode = str(getattr(process, "stock_form_output_mode", "") or MODE_PRESERVE).upper()
        if mode == MODE_PRESERVE:
            return False
        inputs = cls._allowed(process, "allowed_input_stock_forms")
        outputs = cls._allowed(process, "allowed_output_stock_forms")
        form = normalize_stock_form(stock_form)
        return bool(inputs) and form in outputs and form not in inputs

    @classmethod
    def for_job_step(cls, job: Any) -> StepFormContracts:
        """Input / output contract of the job's current route step (cached on the job)."""
        step_index = int(getattr(job, "current_step_index", 0) or 0)
        cache = getattr(job, "_step_form_cache", None)
        if cache is not None and cache[0] == step_index:
            return cache[1]
        target = cls.from_job(job)
        result = StepFormContracts(input=target, output=target, target=target)
        if target.stock_form in FOLDABLE_FORMS:
            try:
                fold_step = cls._fold_step(job, target.stock_form)
            except Exception:
                logger.warning("fold step lookup failed for job=%s", getattr(job, "id", None), exc_info=True)
                fold_step = None
            if fold_step is not None:
                fold_index, fold_process = fold_step
                open_form = cls._allowed(fold_process, "allowed_input_stock_forms")[0]
                open_web = StockFormContract(
                    stock_form=open_form,
                    slit_policy=default_slit_policy(open_form),
                    width_mm=cls._open_run_width(target, target.width_mm, cls._child_width(job), cls._lanes(job)),
                    width_basis=default_width_basis(open_form),
                    source="route_before_fold",
                )
                if step_index < fold_index:
                    result = StepFormContracts(input=open_web, output=open_web, target=target, fold_step_index=fold_index)
                elif step_index == fold_index:
                    result = StepFormContracts(input=open_web, output=target, target=target, fold_step_index=fold_index)
                else:
                    result = StepFormContracts(input=target, output=target, target=target, fold_step_index=fold_index)
        try:
            job._step_form_cache = (step_index, result)
        except Exception:
            pass
        return result

    @classmethod
    def _fold_step(cls, job: Any, stock_form: str):
        """(route step index, Process) of the first step that makes `stock_form`, or None."""
        rule = getattr(job, "routing_rule", None)
        if rule is None:
            return None
        from apps.factory.models import Process
        from apps.production.services.batch_route_service import RouteGraphService

        nodes = [node for node in RouteGraphService.normalize(rule).get("nodes") or [] if isinstance(node, dict)]
        codes = {str(node.get("process_code") or "") for node in nodes if node.get("process_code")}
        if not codes:
            return None
        processes = {p.code: p for p in Process.objects.filter(code__in=codes)}
        found = None
        for node in nodes:
            process = processes.get(str(node.get("process_code") or ""))
            if not cls.makes_form(process, stock_form):
                continue
            index = RouteGraphService.step_index_for_node(node)
            if found is None or index < found[0]:
                found = (index, process)
        return found

    @classmethod
    def input_contract(cls, job: Any) -> StockFormContract:
        """The rolls this step takes: open web up to and including the fold step."""
        return cls.for_job_step(job).input

    @classmethod
    def output_contract(cls, job: Any) -> StockFormContract:
        """The rolls this step puts out: the line's form from the fold step on."""
        return cls.for_job_step(job).output

    @classmethod
    def widen_for_fold(cls, job: Any, run_width: Any, child_width: Any = None, lanes: int | None = None):
        """Run web for a step that still runs open web ahead of the fold.

        One lane: 2W + flap + seal + trim. A multi-lane parent web grows by that much per lane.
        Returns `run_width` unchanged when no fold is ahead (same type as given).
        """
        if run_width in (None, ""):
            return run_width
        steps = cls.for_job_step(job)
        if not steps.fold_ahead:
            return run_width
        child = child_width if child_width not in (None, "") else cls._child_width(job)
        widened = cls._open_run_width(steps.target, run_width, child, lanes if lanes is not None else cls._lanes(job))
        return float(widened) if isinstance(run_width, float) else widened

    @staticmethod
    def _open_run_width(target: StockFormContract, run_width: Any, child_width: Any, lanes: int) -> Decimal:
        run = _decimal(run_width)
        child = _decimal(child_width)
        if child <= 0 or child > run:
            child = run
        open_child = open_width_for(target.stock_form, child, target.fold)
        if lanes > 1 and run > child + Decimal("0.01"):
            return run + Decimal(lanes) * (open_child - child)
        return open_child

    @staticmethod
    def _child_width(job: Any) -> Decimal:
        """One lane's folded / lay-flat width from the line geometry."""
        for owner in (getattr(job, "sales_order_item", None), getattr(job, "mts_order", None)):
            geometry = getattr(owner, "geometry_snapshot", None) if owner is not None else None
            if not isinstance(geometry, dict):
                continue
            base = geometry.get("base") if isinstance(geometry.get("base"), dict) else {}
            for key in ("child_target_width_mm", "stock_width_mm", "roll_width_mm"):
                width = _decimal(geometry.get(key) or base.get(key))
                if width > 0:
                    return width
        return Decimal("0")

    @staticmethod
    def _lanes(job: Any) -> int:
        soi = getattr(job, "sales_order_item", None)
        try:
            return max(1, int(getattr(soi, "preferred_lane_count", None) or (getattr(job, "meta_json", None) or {}).get("preferred_lane_count") or 1))
        except Exception:
            return 1

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
