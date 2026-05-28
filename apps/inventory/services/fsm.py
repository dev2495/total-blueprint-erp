"""Lightweight FSM transition validator for InventoryRoll.status and ProductionJob.job_state.

Use `validate_transition(current, target, MAP, label="object")` at every site that mutates
a status field. Raises TransitionError on an illegal hop. A no-op transition (current==target)
is always allowed.
"""

from __future__ import annotations


class TransitionError(Exception):
    """Raised when an FSM transition is not permitted."""


def validate_transition(current, target, allowed_map, label: str = "object") -> None:
    """Raise TransitionError if ``current → target`` is not allowed by ``allowed_map``."""
    cur = str(current or "").upper()
    tgt = str(target or "").upper()
    if cur == tgt:
        return
    allowed = {str(x).upper() for x in (allowed_map.get(cur, set()) or set())}
    if tgt not in allowed:
        raise TransitionError(f"{label}: cannot transition {cur} -> {tgt}")


# ---------------------------------------------------------------------------
# InventoryRoll.status FSM
# ---------------------------------------------------------------------------
# Pragmatic map that mirrors what the existing services already do — we only
# block transitions that don't make sense (e.g. CONSUMED → AVAILABLE).
ROLL_TRANSITIONS = {
    "AVAILABLE": {"RESERVED", "IN_PROCESS", "CONSUMED", "SCRAPPED", "SENT_JOBWORK", "MISSING", "IN_TRANSIT"},
    "RESERVED": {"AVAILABLE", "IN_PROCESS", "CONSUMED", "SCRAPPED", "SENT_JOBWORK"},
    "IN_PROCESS": {"AVAILABLE", "CONSUMED", "SCRAPPED", "RESERVED"},
    "SENT_JOBWORK": {"AVAILABLE", "CONSUMED", "SCRAPPED"},
    "IN_TRANSIT": {"AVAILABLE", "CONSUMED"},
    "CONSUMED": set(),
    "SCRAPPED": set(),
    "MISSING": {"AVAILABLE", "SCRAPPED"},
}


# ---------------------------------------------------------------------------
# ProductionJob.job_state FSM
# ---------------------------------------------------------------------------
# Mirrors apps.production.models.ProductionJob.JOB_STATE_CHOICES. The known
# values are: DRAFT, PLANNED, RELEASED, EXECUTING, PAUSED, COMPLETED, CANCELLED.
JOB_STATE_TRANSITIONS = {
    "DRAFT": {"PLANNED", "CANCELLED"},
    "PLANNED": {"DRAFT", "RELEASED", "CANCELLED"},
    "RELEASED": {"EXECUTING", "PAUSED", "CANCELLED"},
    "EXECUTING": {"PAUSED", "COMPLETED", "CANCELLED"},
    "PAUSED": {"EXECUTING", "CANCELLED"},
    "COMPLETED": set(),
    "CANCELLED": set(),
}
