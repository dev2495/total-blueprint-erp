from __future__ import annotations

from dataclasses import dataclass
from typing import Any
import logging

from django.core.exceptions import ValidationError

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class StopStepValidation:
    first_artwork_step_index: int | None
    message: str


def _legacy_code_looks_artwork(code: Any) -> bool:
    # Last-resort compatibility for old route rows that have not been migrated
    # to Process.has_artwork yet. Real v3 templates should use the process flag.
    normalized = str(code or "").upper()
    return any(token in normalized for token in ("PRINT", "ROTO", "FLEXO"))


def first_artwork_step_index(template) -> int | None:
    if not template:
        return None

    process_steps = getattr(template, "process_steps", None)
    if process_steps is not None:
        try:
            queryset = process_steps.select_related("process").filter(is_removed_from_route=False).order_by("sequence_number")
            for index, step in enumerate(queryset):
                process = getattr(step, "process", None)
                if process and bool(getattr(process, "has_artwork", False) or getattr(process, "print_capable", False)):
                    return index
        except Exception:
            logger.warning("Unable to inspect template process steps for artwork gate", exc_info=True)

    ordered = getattr(getattr(template, "routing_rule", None), "ordered_processes", None) or []
    if not ordered:
        return None
    codes = [getattr(row, "code", row) for row in ordered]
    try:
        from apps.factory.models import Process

        process_map = {
            process.code: process
            for process in Process.objects.filter(code__in=[str(code) for code in codes])
        }
        for index, code in enumerate(codes):
            process = process_map.get(str(code))
            if process and bool(process.has_artwork or process.print_capable):
                return index
    except Exception:
        logger.warning("Unable to inspect route process metadata for artwork gate", exc_info=True)

    for index, code in enumerate(codes):
        if _legacy_code_looks_artwork(code):
            return index
    return None


def validate_planner_stop_step(*, template, stop_step_index: int, commitment_scope: str, committed_artwork=None, committed_customer=None) -> StopStepValidation:
    scope = str(commitment_scope or "GENERIC").upper()
    first_artwork = first_artwork_step_index(template)
    if scope in {"CUSTOMER", "CUSTOMER_ARTWORK"} and not committed_customer:
        raise ValidationError({"committed_customer": "Customer commitment requires committed_customer."})
    if scope in {"ARTWORK", "CUSTOMER_ARTWORK"} and not committed_artwork:
        raise ValidationError({"committed_artwork": "Artwork commitment requires committed_artwork."})
    if scope in {"GENERIC", "CUSTOMER"}:
        if committed_artwork:
            raise ValidationError({"committed_artwork": "Generic/customer stock cannot be artwork-committed."})
        if first_artwork is not None and stop_step_index >= first_artwork:
            raise ValidationError({"stop_step_index": f"Generic/customer stock must stop before step {first_artwork + 1}, the first artwork-capable step."})
        return StopStepValidation(first_artwork, "Valid shared stock scope.")
    if scope in {"ARTWORK", "CUSTOMER_ARTWORK"}:
        if first_artwork is None:
            raise ValidationError({"stop_step_index": "Template has no artwork-capable step; artwork-committed stock is not valid."})
        if stop_step_index < first_artwork:
            raise ValidationError({"stop_step_index": f"Artwork-committed stock must stop at or after step {first_artwork + 1}, the first artwork-capable step."})
        return StopStepValidation(first_artwork, "Valid artwork-committed stock scope.")
    raise ValidationError({"commitment_scope": "Invalid commitment_scope."})
