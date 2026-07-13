from __future__ import annotations

from datetime import timedelta
import logging
from typing import Optional

from django.utils import timezone

from apps.factory.models import MachineShiftOverride, PlantShiftDefinition

logger = logging.getLogger(__name__)


def _normalize_timestamp(ts=None):
    if ts is None:
        ts = timezone.now()
    if timezone.is_naive(ts):
        ts = timezone.make_aware(ts, timezone.get_current_timezone())
    return timezone.localtime(ts)


def _job_plant_id(job) -> Optional[str]:
    try:
        if getattr(job, "work_center_id", None) and getattr(job.work_center, "plant_id", None):
            return str(job.work_center.plant_id)
    except Exception:
        logger.debug("Unable to resolve plant through job work center", exc_info=True)
    try:
        machine = getattr(job, "machine", None)
        if machine and getattr(machine, "work_center_id", None) and getattr(machine.work_center, "plant_id", None):
            return str(machine.work_center.plant_id)
    except Exception:
        logger.debug("Unable to resolve plant through job machine", exc_info=True)
    return None


def _shift_match(local_dt, shift):
    local_time = local_dt.time()
    local_date = local_dt.date()
    start = shift.start_time
    end = shift.end_time
    crosses = bool(getattr(shift, "crosses_midnight", False))

    if crosses:
        if local_time >= start:
            return True, local_date
        if local_time < end:
            return True, local_date - timedelta(days=1)
        return False, None

    if start <= local_time < end:
        return True, local_date
    return False, None


def resolve_shift_for_job_timestamp(job, ts=None):
    """
    Resolve shift code/date for a job at given timestamp.
    Priority:
    1) Active machine overrides (if machine assigned)
    2) Active plant shift definitions
    """
    local_dt = _normalize_timestamp(ts)
    machine_id = str(getattr(job, "machine_id", "") or "").strip() or None
    plant_id = _job_plant_id(job)
    if not plant_id:
        return {"shift_code": "", "shift_date": None, "shift_source": None}

    if machine_id:
        machine_rows = list(
            MachineShiftOverride.objects.filter(
                machine_id=machine_id,
                is_active=True,
            ).order_by("priority", "code")
        )
        for row in machine_rows:
            matched, shift_date = _shift_match(local_dt, row)
            if matched:
                return {
                    "shift_code": str(row.code).upper(),
                    "shift_date": shift_date,
                    "shift_source": "MACHINE_OVERRIDE",
                }

    plant_rows = list(
        PlantShiftDefinition.objects.filter(
            plant_id=plant_id,
            is_active=True,
        ).order_by("priority", "code")
    )
    for row in plant_rows:
        matched, shift_date = _shift_match(local_dt, row)
        if matched:
            return {
                "shift_code": str(row.code).upper(),
                "shift_date": shift_date,
                "shift_source": "PLANT_DEFAULT",
            }

    return {"shift_code": "", "shift_date": None, "shift_source": None}


def build_shift_fields_for_job(job, ts=None):
    resolved = resolve_shift_for_job_timestamp(job, ts=ts)
    return {
        "shift_code": str(resolved.get("shift_code") or ""),
        "shift_date": resolved.get("shift_date"),
    }
