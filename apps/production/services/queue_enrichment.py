"""
WCM queue-row enrichment.

Given the set of ``WorkCenterAssignment`` rows shown in a work-center queue,
compute the operator-facing decoration fields the contract requires:

    ink_colors           list[str]  – ink color names for the committed artwork
    cylinder_ready       bool       – every required cylinder is mounted/ready
    cylinder_status      str        – "READY" | "MISSING" | "NOT_REQUIRED" | "NA"
    material_blocked     bool       – material availability blocks starting
    material_block_reason str       – human-readable reason
    elapsed_minutes      int|None   – minutes since assigned_at/started
    last_log_at          iso|None   – latest exec/scrap/downtime/quality log
    is_stalled           bool       – EXECUTING but idle (stalled-jobs rule)

Everything is computed in a small fixed number of grouped queries so the queue
endpoint stays cheap even with side-effect-free reads (no state mutation).
"""

from django.utils import timezone

from .stalled_jobs import _last_activity_map, is_job_stalled


def _resolve_committed_artwork(job):
    """Mirror of ProductionJobSerializer._resolve_committed_artwork (read-only)."""
    try:
        item = getattr(job, "sales_order_item", None)
        if item is not None and getattr(item, "assigned_artwork_id", None):
            return item.assigned_artwork
    except Exception:
        pass
    try:
        mts = getattr(job, "mts_order", None)
        if mts is not None and getattr(mts, "committed_artwork_id", None):
            return mts.committed_artwork
    except Exception:
        pass
    return None


def _ink_colors_for_artwork(artwork):
    """
    Derive a clean, de-duplicated list of ink color *names* for an artwork.

    Preference order: explicit front/back color name lists -> color_mapping keys
    (template color name -> ink material) -> raw color_list (hex/pantone).
    """
    if artwork is None:
        return []

    names = []

    for side_field in ("front_colors", "back_colors"):
        values = getattr(artwork, side_field, None) or []
        if isinstance(values, (list, tuple)):
            names.extend(str(v).strip() for v in values if str(v).strip())

    if not names:
        mapping = getattr(artwork, "color_mapping", None) or {}
        if isinstance(mapping, dict):
            names.extend(str(k).strip() for k in mapping.keys() if str(k).strip())

    if not names:
        color_list = getattr(artwork, "color_list", None) or []
        if isinstance(color_list, (list, tuple)):
            names.extend(str(v).strip() for v in color_list if str(v).strip())

    # De-duplicate while preserving order.
    seen = set()
    ordered = []
    for name in names:
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        ordered.append(name)
    return ordered


def _is_print_capable(process):
    if process is None:
        return False
    return bool(getattr(process, "print_capable", False) or getattr(process, "has_artwork", False))


def _cylinder_slot_counts(artwork_ids):
    """
    Return {artwork_id: count_of_active_cylinder_slot_assignments} so we can
    decide cylinder readiness without N+1 queries.

    A slot counts as "ready" only when its cylinder is in an ACTIVE status
    (i.e. not MAINTENANCE / RE_CHROME / SCRAP).
    """
    if not artwork_ids:
        return {}
    from apps.tooling.models import CylinderSlotAssignment

    counts = {}
    rows = (
        CylinderSlotAssignment.objects.filter(
            artwork_id__in=artwork_ids,
            cylinder__status="ACTIVE",
        )
        .values_list("artwork_id", flat=True)
    )
    for artwork_id in rows:
        counts[artwork_id] = counts.get(artwork_id, 0) + 1
    return counts


def _required_color_slots(artwork):
    """How many cylinder slots a committed artwork needs to be print-ready."""
    if artwork is None:
        return 0
    try:
        total = int(getattr(artwork, "total_side_colors", 0) or 0)
    except Exception:
        total = 0
    if total:
        return total
    # Fall back to ink-color count if side counts were never populated.
    return len(_ink_colors_for_artwork(artwork))


def _artwork_requires_cylinders(artwork):
    """Only roto artworks need cylinder readiness. Flexo/sheet work does not."""
    if artwork is None:
        return False
    return str(getattr(artwork, "print_type", "") or "").strip().upper() == "ROTO"


def _material_block(job):
    """
    Lightweight, side-effect-free material-availability check.

    Returns (blocked: bool, reason: str). We intentionally avoid the heavy
    ``get_satisfaction_status`` (which reconciles reservations and recomputes
    requirements) on a read path. Instead we use the cheap WIP-pool resolver
    which already aggregates roll shortage + bulk preview for the current step.
    """
    from .services_execution import ExecutionService

    process = getattr(job, "current_process", None) or getattr(job, "process", None)
    if process is None:
        return False, ""

    reasons = []

    # Roll inputs: compare physics-required roll count against the eligible pool.
    try:
        details = ExecutionService._resolve_wip_pool_details(job)
        meta = details.get("meta") or {}
        missing_rolls = int(meta.get("missing_rolls") or 0)
        if missing_rolls > 0 and str(getattr(process, "input_form", "") or "").upper() == "ROLL":
            reasons.append(f"Roll shortage: {missing_rolls} more roll(s) required.")
    except Exception:
        pass

    # Bulk inputs: any required bulk material with insufficient available qty.
    try:
        from decimal import Decimal

        bulk_preview = ExecutionService.get_bulk_consumption_preview(job)
        for item in bulk_preview or []:
            required = Decimal(str(item.get("required_qty_kg") or 0))
            available = Decimal(str(item.get("available_qty_kg") or 0))
            if required > 0 and available < required:
                name = item.get("material") or item.get("material_name") or "material"
                reasons.append(f"Insufficient {name}: need {float(required):g} kg, have {float(available):g} kg.")
                break
    except Exception:
        pass

    if reasons:
        return True, " ".join(reasons)
    return False, ""


def build_queue_enrichment(assignments):
    """
    Compute the enrichment map for a list of ``WorkCenterAssignment`` rows.

    Returns {job_id_str: {ink_colors, cylinder_ready, cylinder_status,
    material_blocked, material_block_reason, elapsed_minutes, last_log_at,
    is_stalled}}.
    """
    now = timezone.now()
    jobs = []
    for assignment in assignments:
        job = getattr(assignment, "production_job", None)
        if job is not None:
            jobs.append((assignment, job))

    job_ids = [job.id for _, job in jobs]
    last_activity = _last_activity_map(job_ids)

    # Batch-resolve committed artworks + cylinder readiness.
    artwork_by_job = {}
    artwork_ids = set()
    for _, job in jobs:
        artwork = _resolve_committed_artwork(job)
        artwork_by_job[job.id] = artwork
        if artwork is not None:
            artwork_ids.add(artwork.id)
    slot_counts = _cylinder_slot_counts(artwork_ids)

    enrichment = {}
    for assignment, job in jobs:
        process = getattr(job, "current_process", None) or getattr(job, "process", None)
        artwork = artwork_by_job.get(job.id)
        ink_colors = _ink_colors_for_artwork(artwork)

        # Cylinder readiness.
        if not _is_print_capable(process):
            cylinder_status = "NA"
            cylinder_ready = False
        else:
            if artwork is None:
                cylinder_status = "MISSING"
                cylinder_ready = False
            elif not _artwork_requires_cylinders(artwork):
                cylinder_status = "NOT_REQUIRED"
                cylinder_ready = True
            else:
                required_slots = _required_color_slots(artwork)
                ready_slots = slot_counts.get(artwork.id, 0) if artwork is not None else 0
                if required_slots > 0 and ready_slots >= required_slots:
                    cylinder_status = "READY"
                    cylinder_ready = True
                else:
                    cylinder_status = "MISSING"
                    cylinder_ready = False

        # Material blocking.
        material_blocked, material_block_reason = _material_block(job)

        # Timing + stall.
        last_event_at = last_activity.get(job.id)
        stalled, started_at, _idle = is_job_stalled(job, last_event_at, now=now)

        elapsed_minutes = None
        if started_at is not None:
            elapsed_minutes = max(0, int((now - started_at).total_seconds() // 60))

        enrichment[str(job.id)] = {
            "ink_colors": ink_colors,
            "cylinder_ready": cylinder_ready,
            "cylinder_status": cylinder_status,
            "material_blocked": material_blocked,
            "material_block_reason": material_block_reason,
            "elapsed_minutes": elapsed_minutes,
            "last_log_at": last_event_at,
            "is_stalled": stalled,
        }

    return enrichment
