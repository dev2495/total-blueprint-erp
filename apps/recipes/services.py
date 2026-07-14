from __future__ import annotations

import logging
from decimal import Decimal
from typing import Any, Iterable


logger = logging.getLogger(__name__)


def recipe_contract(recipe) -> dict[str, Any]:
    return {
        "film_variant_id": str(getattr(recipe, "film_variant_id", "") or ""),
        "film_variant_code": str(getattr(getattr(recipe, "film_variant", None), "code", "") or ""),
        "grade_id": str(getattr(recipe, "grade_id", "") or ""),
        "grade_name": str(getattr(getattr(recipe, "grade", None), "name", "") or ""),
        "thickness_min_micron": int(getattr(recipe, "thickness_min_micron", 0) or 0),
        "thickness_max_micron": int(getattr(recipe, "thickness_max_micron", 0) or 0),
    }


def layer_matches_recipe_contract(layer: Any, contract: dict[str, Any]) -> bool:
    if not isinstance(layer, dict) or not isinstance(contract, dict):
        return False

    variant_id = str(layer.get("variant_id") or layer.get("material_id") or "").strip()
    variant_code = str(
        layer.get("material_code")
        or layer.get("film_variant_code")
        or layer.get("code")
        or ""
    ).strip().upper()
    wanted_variant_id = str(contract.get("film_variant_id") or "").strip()
    wanted_variant_code = str(contract.get("film_variant_code") or "").strip().upper()
    if wanted_variant_id:
        if variant_id != wanted_variant_id:
            return False
    elif wanted_variant_code and variant_code != wanted_variant_code:
        return False

    grade_id = str(layer.get("grade_id") or "").strip()
    grade_name = str(layer.get("grade_code") or layer.get("grade") or "").strip().upper()
    wanted_grade_id = str(contract.get("grade_id") or "").strip()
    wanted_grade_name = str(contract.get("grade_name") or "").strip().upper()
    if wanted_grade_id:
        if grade_id and grade_id != wanted_grade_id:
            return False
        if not grade_id and wanted_grade_name and grade_name != wanted_grade_name:
            return False
    elif wanted_grade_name and grade_name != wanted_grade_name:
        return False

    try:
        thickness = Decimal(str(layer.get("thickness_micron") or layer.get("thickness_um") or 0))
        minimum = Decimal(str(contract.get("thickness_min_micron") or 0))
        maximum = Decimal(str(contract.get("thickness_max_micron") or 0))
    except Exception:
        return False
    return minimum > 0 and maximum >= minimum and minimum <= thickness <= maximum


def refresh_open_sales_boms_for_recipe_contracts(
    contracts: Iterable[dict[str, Any]],
    *,
    raise_on_error: bool = False,
) -> dict[str, int]:
    """Refresh mutable sales BOMs affected by a recipe create/edit/delete.

    Released/executing history remains immutable because the shared sales
    refresh service applies the normal pre-release locks and queue safeguards.
    """

    from apps.sales.models import SalesOrderItem
    from apps.sales.services.order_service import SalesOrderService

    contracts = [contract for contract in contracts if isinstance(contract, dict)]
    empty_stats = {
        "matched_items": 0,
        "checked": 0,
        "refreshed": 0,
        "failed": 0,
        "skipped": 0,
        "queues_rebuilt": 0,
        "queues_frozen": 0,
        "queues_planning_required": 0,
        "still_blocked": 0,
    }
    if not contracts:
        return empty_stats

    candidates = SalesOrderItem.objects.select_related("sales_order", "product_master").filter(
        sales_order__status__in={"DRAFT", "CONFIRMED", "PLANNING_REQUIRED", "PLANNED"},
        line_status__in={"OPEN", "PLANNING_REQUIRED", "PLANNED", ""},
        product_master__active=True,
        product_master__is_current_version=True,
    )
    matched_ids = []
    for item in candidates.iterator():
        layers = item.layer_snapshot if isinstance(item.layer_snapshot, list) else []
        if any(
            layer_matches_recipe_contract(layer, contract)
            for layer in layers
            for contract in contracts
        ):
            matched_ids.append(item.id)

    if not matched_ids:
        return empty_stats

    try:
        stats = SalesOrderService.refresh_open_snapshots_for_items(
            SalesOrderItem.objects.filter(id__in=matched_ids),
            reason="EXTRUSION_RECIPE_CHANGED",
            raise_on_error=raise_on_error,
        )
    except Exception:
        logger.exception("Recipe saved, but matching open BOM snapshots could not be refreshed.")
        if raise_on_error:
            raise
        return {**empty_stats, "matched_items": len(matched_ids), "failed": len(matched_ids)}

    still_blocked = 0
    for bom_snapshot in SalesOrderItem.objects.filter(id__in=matched_ids).values_list(
        "bom_snapshot", flat=True
    ):
        errors = bom_snapshot.get("errors") if isinstance(bom_snapshot, dict) else None
        if errors:
            still_blocked += 1
    return {
        **empty_stats,
        **stats,
        "matched_items": len(matched_ids),
        "still_blocked": still_blocked,
    }
