"""Lightweight shift inference based on CompanyProfile.shift_boundaries.

This is the simple, company-wide A/B/C inference required by the WCM
terminal and the auto-stamp hooks on JobExecutionLog/ScrapLog/DowntimeLog.

For machine/plant-scoped overrides see ``shift_resolver.resolve_shift_for_job_timestamp``.
"""
from __future__ import annotations

from datetime import datetime, time as _time, timedelta
from typing import Dict, List, Optional, Tuple

from django.utils import timezone


DEFAULT_SHIFT_BOUNDARIES: Dict[str, List[str]] = {
    "A": ["06:00", "14:00"],
    "B": ["14:00", "22:00"],
    "C": ["22:00", "06:00"],
}


def _parse_hhmm(value: str) -> _time:
    parts = str(value or "").strip().split(":")
    if len(parts) != 2:
        raise ValueError(f"Invalid HH:MM value {value!r}")
    return _time(int(parts[0]), int(parts[1]))


def _get_boundaries() -> Dict[str, Tuple[_time, _time]]:
    """Resolve the active company-wide shift boundaries.

    Falls back to the default 8-hour A/B/C rotation if CompanyProfile is
    missing or the JSON field is empty/malformed.
    """
    raw: Dict[str, List[str]] = {}
    try:
        # Local import to avoid circular import via apps registry on boot.
        from apps.users.models import CompanyProfile

        profile = CompanyProfile.objects.filter(id=1).only("shift_boundaries").first()
        if profile and isinstance(profile.shift_boundaries, dict) and profile.shift_boundaries:
            raw = profile.shift_boundaries
    except Exception:
        raw = {}

    if not raw:
        raw = DEFAULT_SHIFT_BOUNDARIES

    parsed: Dict[str, Tuple[_time, _time]] = {}
    for code, pair in raw.items():
        try:
            if not isinstance(pair, (list, tuple)) or len(pair) != 2:
                continue
            parsed[str(code).upper()] = (_parse_hhmm(pair[0]), _parse_hhmm(pair[1]))
        except Exception:
            continue
    if not parsed:
        parsed = {
            code: (_parse_hhmm(window[0]), _parse_hhmm(window[1]))
            for code, window in DEFAULT_SHIFT_BOUNDARIES.items()
        }
    return parsed


def _in_window(local_t: _time, start: _time, end: _time) -> bool:
    if start == end:
        return False
    if start < end:
        return start <= local_t < end
    # crosses midnight
    return local_t >= start or local_t < end


def infer_shift(timestamp: Optional[datetime] = None) -> str:
    """Return the active shift code ("A" / "B" / "C") for ``timestamp``.

    Falls back to "" if no window matches (should not happen with the
    default boundaries that cover 24h).
    """
    if timestamp is None:
        timestamp = timezone.now()
    if timezone.is_naive(timestamp):
        timestamp = timezone.make_aware(timestamp, timezone.get_current_timezone())
    local = timezone.localtime(timestamp)
    local_t = local.time()
    boundaries = _get_boundaries()
    # Preserve a stable order so overlapping windows return a deterministic answer.
    for code in sorted(boundaries.keys()):
        start, end = boundaries[code]
        if _in_window(local_t, start, end):
            return code
    return ""


def shift_window_for(timestamp: Optional[datetime] = None) -> Dict[str, object]:
    """Return ``{shift_code, started_at, ends_at}`` for the active shift.

    Used by the ``/api/production/current-shift/`` endpoint.
    """
    if timestamp is None:
        timestamp = timezone.now()
    if timezone.is_naive(timestamp):
        timestamp = timezone.make_aware(timestamp, timezone.get_current_timezone())
    local = timezone.localtime(timestamp)
    code = infer_shift(timestamp)
    if not code:
        return {"shift_code": "", "started_at": None, "ends_at": None}

    boundaries = _get_boundaries()
    start, end = boundaries[code]
    started_at = local.replace(hour=start.hour, minute=start.minute, second=0, microsecond=0)
    ends_at = local.replace(hour=end.hour, minute=end.minute, second=0, microsecond=0)
    if start <= end:
        # Same calendar day. If we somehow rolled past, no-op (shouldn't happen).
        if local.time() < start:
            started_at -= timedelta(days=1)
            ends_at -= timedelta(days=1)
    else:
        # crosses midnight
        if local.time() >= start:
            ends_at += timedelta(days=1)
        else:
            started_at -= timedelta(days=1)
    return {
        "shift_code": code,
        "started_at": started_at,
        "ends_at": ends_at,
    }
