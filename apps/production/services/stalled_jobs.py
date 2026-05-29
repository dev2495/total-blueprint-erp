"""
Read-only "stalled jobs" surface.

A stalled job is an EXECUTING production job that has shown no operator
activity for a while. This is a *surfaced list only* — nothing here pauses,
cancels, or otherwise mutates a job. The WCM / dashboard simply reads it.

Stall rule (matches the WCM queue ``is_stalled`` flag):
    job_state == 'EXECUTING'
    AND (
        no JobExecutionLog / ScrapLog / DowntimeLog / QualityReading in the
        last ``STALL_WINDOW_MINUTES`` minutes,
        OR
        zero such logs AND the job has been running (assigned_at / started)
        for more than ``STALL_WINDOW_MINUTES`` minutes
    )
"""

from datetime import timedelta

from django.db.models import Max
from django.utils import timezone

STALL_WINDOW_MINUTES = 60


def _last_activity_map(job_ids):
    """
    Return {job_id: latest_activity_datetime|None} across all four event logs
    for the given job ids, in a small fixed number of grouped queries.
    """
    from apps.production.models import (
        JobExecutionLog,
        ScrapLog,
        DowntimeLog,
        QualityReading,
    )

    if not job_ids:
        return {}

    latest = {jid: None for jid in job_ids}

    def _merge(rows, field):
        for row in rows:
            jid = row["production_job_id"]
            ts = row[field]
            if ts is None:
                continue
            current = latest.get(jid)
            if current is None or ts > current:
                latest[jid] = ts

    _merge(
        JobExecutionLog.objects.filter(production_job_id__in=job_ids)
        .values("production_job_id")
        .annotate(ts=Max("logged_at")),
        "ts",
    )
    _merge(
        ScrapLog.objects.filter(production_job_id__in=job_ids)
        .values("production_job_id")
        .annotate(ts=Max("logged_at")),
        "ts",
    )
    # Downtime is most-recent by start_time, falling back to created_at.
    _merge(
        DowntimeLog.objects.filter(production_job_id__in=job_ids)
        .values("production_job_id")
        .annotate(ts=Max("start_time")),
        "ts",
    )
    _merge(
        DowntimeLog.objects.filter(production_job_id__in=job_ids)
        .values("production_job_id")
        .annotate(ts=Max("created_at")),
        "ts",
    )
    _merge(
        QualityReading.objects.filter(production_job_id__in=job_ids)
        .values("production_job_id")
        .annotate(ts=Max("logged_at")),
        "ts",
    )
    return latest


def _job_started_at(job):
    """Best-effort 'when did this job begin executing' timestamp."""
    assignment = getattr(job, "assignment", None)
    candidates = [
        getattr(job, "start_date", None),
        getattr(assignment, "assigned_at", None) if assignment else None,
        getattr(job, "updated_at", None),
    ]
    for value in candidates:
        if value is not None:
            return value
    return getattr(job, "created_at", None)


def get_stalled_jobs(work_center=None, plant=None, now=None):
    """
    Return a list of stalled-job dicts matching the public API contract:
      [{job_id, job_number, work_center_name, machine_name, customer_name,
        product_name, started_at, last_event_at, idle_minutes}]

    Read-only. ``work_center`` / ``plant`` are optional UUID filters.
    """
    from apps.production.models import ProductionJob

    now = now or timezone.now()
    threshold = now - timedelta(minutes=STALL_WINDOW_MINUTES)

    qs = (
        ProductionJob.objects.filter(job_state="EXECUTING")
        .select_related(
            "work_center",
            "machine",
            "template",
            "sales_order_item__sales_order",
            "mts_order",
            "assignment",
            "assignment__assigned_machine",
        )
    )
    if work_center:
        qs = qs.filter(work_center_id=work_center)
    if plant:
        qs = qs.filter(work_center__plant_id=plant)

    jobs = list(qs)
    if not jobs:
        return []

    last_activity = _last_activity_map([job.id for job in jobs])

    results = []
    for job in jobs:
        last_event_at = last_activity.get(job.id)
        started_at = _job_started_at(job)

        if last_event_at is not None:
            # Stalled if the most recent activity is older than the window.
            if last_event_at > threshold:
                continue
            idle_from = last_event_at
        else:
            # Zero logs: stalled only once it has been running past the window.
            if started_at is None or started_at > threshold:
                continue
            idle_from = started_at

        idle_minutes = max(0, int((now - idle_from).total_seconds() // 60))

        machine = getattr(job, "machine", None)
        if machine is None:
            assignment = getattr(job, "assignment", None)
            machine = getattr(assignment, "assigned_machine", None) if assignment else None

        results.append(
            {
                "job_id": str(job.id),
                "job_number": job.job_number,
                "work_center_name": job.work_center.name if job.work_center else "",
                "machine_name": machine.name if machine else "",
                "customer_name": job.customer_name,
                "product_name": job.product_name,
                "started_at": started_at,
                "last_event_at": last_event_at,
                "idle_minutes": idle_minutes,
            }
        )

    # Most-idle first.
    results.sort(key=lambda row: row["idle_minutes"], reverse=True)
    return results


def is_job_stalled(job, last_event_at, now=None):
    """
    Single-job stall test used by the WCM queue serializer to set ``is_stalled``.

    ``last_event_at`` is the precomputed latest activity timestamp (or None).
    Returns a (is_stalled, started_at, idle_minutes) tuple so callers can reuse
    the derived values without recomputing.
    """
    now = now or timezone.now()
    threshold = now - timedelta(minutes=STALL_WINDOW_MINUTES)

    if str(getattr(job, "job_state", "") or "").upper() != "EXECUTING":
        return False, _job_started_at(job), None

    started_at = _job_started_at(job)
    if last_event_at is not None:
        if last_event_at > threshold:
            return False, started_at, None
        idle_from = last_event_at
    else:
        if started_at is None or started_at > threshold:
            return False, started_at, None
        idle_from = started_at

    idle_minutes = max(0, int((now - idle_from).total_seconds() // 60))
    return True, started_at, idle_minutes
