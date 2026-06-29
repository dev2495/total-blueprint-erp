class BomReadinessError(ValueError):
    """Raised when a frozen BOM snapshot is not safe to release to production."""


def _as_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def bom_readiness_errors(bom_snapshot):
    if not isinstance(bom_snapshot, dict) or not bom_snapshot:
        return ["BOM snapshot is missing."]

    errors = [str(err).strip() for err in _as_list(bom_snapshot.get("errors")) if str(err).strip()]
    if errors:
        return errors

    is_complete = bom_snapshot.get("is_complete")
    if is_complete is False:
        return ["BOM resolver marked this line incomplete."]

    # Legacy snapshots did not always persist is_complete. Accept them only when
    # they already contain material truth, otherwise force a fresh preview.
    if is_complete is None:
        has_material_rows = any(
            bool(bom_snapshot.get(section))
            for section in (
                "films",
                "granules",
                "inks",
                "chemicals",
                "addons",
                "pod",
                "packaging",
                "planning_lines",
            )
        )
        if not has_material_rows:
            return ["BOM snapshot has no material rows."]

    return []


def require_bom_ready_for_production(source, *, label=None):
    errors = bom_readiness_errors(getattr(source, "bom_snapshot", None))
    if errors:
        prefix = f"{label}: " if label else ""
        raise BomReadinessError(f"{prefix}BOM is not production-ready: {'; '.join(errors)}")
    return getattr(source, "bom_snapshot", None) or {}
