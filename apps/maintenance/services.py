"""
Maintenance services: due-job generation, the job loop, faults, the board and reports.

Rules the client asked for:
- a late completion never silently moves the next date: FIXED_CALENDAR schedules
  repeat from the anchor; AFTER_LAST_SERVICE schedules count from the completion;
- planned date and actual completion are separate fields;
- three outcomes only: completed, issue found, unable (with a reason);
- critical work is verified by a supervisor; routine checks close on their own;
- every change after creation is logged with who, when and what.
"""
from __future__ import annotations

import logging
from calendar import monthrange
from datetime import date, datetime, timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Count, F, Q, Sum
from django.utils import timezone

from apps.factory.models import Machine
from apps.maintenance.models import MachineFault, MaintenanceEditLog, MaintenanceJob, MaintenanceSchedule

logger = logging.getLogger(__name__)


def _today() -> date:
    return timezone.localdate()


def _add_months(value: date, months: int) -> date:
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, monthrange(year, month)[1])
    return date(year, month, day)


def _step(value: date, schedule: MaintenanceSchedule) -> date:
    n = max(1, int(schedule.interval_value or 1))
    if schedule.interval_type == "DAILY":
        return value + timedelta(days=n)
    if schedule.interval_type == "WEEKLY":
        return value + timedelta(weeks=n)
    if schedule.interval_type == "MONTHLY":
        return _add_months(value, n)
    return value + timedelta(days=n)


def _log(object_type: str, object_id, action: str, actor=None, before=None, after=None, note: str = ""):
    MaintenanceEditLog.objects.create(
        object_type=object_type,
        object_id=object_id,
        action=action,
        actor=actor if getattr(actor, "pk", None) else None,
        before=before or {},
        after=after or {},
        note=note or "",
    )


class MaintenanceService:
    # ------------------------------------------------------------------ run hours
    @staticmethod
    def machine_run_hours(machine: Machine, since: datetime | None = None, until: datetime | None = None) -> Decimal:
        """Running hours from the costing runtime sessions of jobs on this machine."""
        from apps.costing.models import JobRuntimeSession
        until = until or timezone.now()
        qs = JobRuntimeSession.objects.filter(machine=machine, started_at__lt=until)
        if since:
            qs = qs.filter(Q(ended_at__isnull=True) | Q(ended_at__gt=since))
        total = timedelta(0)
        for started_at, ended_at in qs.values_list("started_at", "ended_at"):
            start = max(started_at, since) if since else started_at
            end = min(ended_at or until, until)
            if end > start:
                total += end - start
        return (Decimal(total.total_seconds()) / Decimal(3600)).quantize(Decimal("0.01"))

    # ------------------------------------------------------------------ due dates
    @classmethod
    def compute_next_due(cls, schedule: MaintenanceSchedule, *, completed_on: date | None = None, today: date | None = None) -> date | None:
        today = today or _today()
        if schedule.interval_type == "RUN_HOURS":
            # Not a date: the task runner checks running hours against the interval.
            return None
        if schedule.due_rule == "AFTER_LAST_SERVICE":
            base = completed_on or (schedule.last_completed_at and timezone.localtime(schedule.last_completed_at).date())
            if base:
                return _step(base, schedule)
            return schedule.anchor_date
        # FIXED_CALENDAR: walk the anchor forward to the first date after the last completion.
        due = schedule.anchor_date
        floor = completed_on or (schedule.last_completed_at and timezone.localtime(schedule.last_completed_at).date())
        guard = 0
        while floor and due <= floor and guard < 5000:
            due = _step(due, schedule)
            guard += 1
        return due

    @classmethod
    def run_hours_due(cls, schedule: MaintenanceSchedule) -> tuple[bool, Decimal]:
        if schedule.interval_type != "RUN_HOURS":
            return False, Decimal("0")
        hours = cls.machine_run_hours(schedule.machine, since=schedule.run_hours_anchor_at or schedule.last_completed_at)
        return hours >= Decimal(int(schedule.interval_value or 0)), hours

    @classmethod
    def initialize_schedule(cls, schedule: MaintenanceSchedule, *, user=None) -> MaintenanceSchedule:
        if schedule.interval_type == "RUN_HOURS":
            schedule.run_hours_anchor_at = schedule.run_hours_anchor_at or timezone.now()
            schedule.next_due_date = None
        else:
            schedule.next_due_date = cls.compute_next_due(schedule)
        if schedule.is_critical:
            schedule.requires_verification = True
        schedule.save(update_fields=["run_hours_anchor_at", "next_due_date", "requires_verification", "updated_at"])
        return schedule

    # ------------------------------------------------------------------ job creation
    @classmethod
    def open_job_for_schedule(cls, schedule: MaintenanceSchedule):
        return MaintenanceJob.objects.filter(schedule=schedule, status__in=MaintenanceJob.OPEN_STATUSES).order_by("planned_date").first()

    @classmethod
    def create_job_from_schedule(cls, schedule: MaintenanceSchedule, planned_date: date, *, user=None) -> MaintenanceJob:
        job = MaintenanceJob.objects.create(
            machine=schedule.machine,
            schedule=schedule,
            source="SCHEDULE",
            kind=schedule.kind,
            title=schedule.name,
            title_hi=schedule.name_hi or "",
            planned_date=planned_date,
            assigned_role=schedule.assigned_role,
            assigned_to=schedule.responsible_user,
            checklist=list(schedule.checklist or []),
            requires_verification=bool(schedule.requires_verification or schedule.is_critical),
            created_by=user if getattr(user, "pk", None) else None,
        )
        return job

    @classmethod
    def generate_due_jobs(cls, *, today: date | None = None, lookahead_days: int = 0, user=None) -> dict:
        """
        Every active schedule whose due date is today or earlier (or within the
        lookahead) gets one open job. Missed work stays visible: an existing open
        job is never replaced, and the overdue one keeps its planned date.
        """
        today = today or _today()
        horizon = today + timedelta(days=max(0, lookahead_days))
        created, checked = 0, 0
        for schedule in MaintenanceSchedule.objects.filter(is_active=True).select_related("machine"):
            checked += 1
            if cls.open_job_for_schedule(schedule):
                continue
            if schedule.interval_type == "RUN_HOURS":
                due, hours = cls.run_hours_due(schedule)
                if due:
                    job = cls.create_job_from_schedule(schedule, today, user=user)
                    job.notes = f"Due by running hours: {hours} h since last service (interval {schedule.interval_value} h)."
                    job.save(update_fields=["notes"])
                    created += 1
                continue
            if schedule.next_due_date is None:
                schedule.next_due_date = cls.compute_next_due(schedule, today=today)
                schedule.save(update_fields=["next_due_date", "updated_at"])
            if schedule.next_due_date and schedule.next_due_date <= horizon:
                cls.create_job_from_schedule(schedule, schedule.next_due_date, user=user)
                created += 1
        return {"checked": checked, "created": created, "today": today.isoformat()}

    @classmethod
    def create_manual_job(cls, *, machine: Machine, title: str, planned_date: date, kind: str = "TECH_SERVICE",
                          assigned_role: str = "MAINTENANCE_TECH", assigned_to=None, fault: MachineFault | None = None,
                          checklist=None, requires_verification: bool = False, notes: str = "", user=None) -> MaintenanceJob:
        job = MaintenanceJob.objects.create(
            machine=machine,
            fault=fault,
            source="FAULT" if fault else "MANUAL",
            kind=kind,
            title=title,
            planned_date=planned_date,
            assigned_role=assigned_role,
            assigned_to=assigned_to,
            checklist=list(checklist or []),
            requires_verification=requires_verification,
            notes=notes or "",
            created_by=user if getattr(user, "pk", None) else None,
        )
        if fault and fault.status == "OPEN":
            fault.status = "ASSIGNED" if assigned_to else fault.status
            fault.assigned_to = assigned_to or fault.assigned_to
            fault.assigned_at = timezone.now() if assigned_to else fault.assigned_at
            fault.save(update_fields=["status", "assigned_to", "assigned_at", "updated_at"])
        _log("JOB", job.id, "CREATED", user, after={"title": title, "planned_date": planned_date.isoformat()})
        return job

    # ------------------------------------------------------------------ job loop
    @classmethod
    def start_job(cls, job: MaintenanceJob, *, user=None) -> MaintenanceJob:
        if job.status not in ("DUE", "UNABLE", "ISSUE_FOUND"):
            raise ValueError(f"Job is {job.status}; only due work can be started.")
        before = {"status": job.status}
        job.status = "IN_PROGRESS"
        job.started_at = job.started_at or timezone.now()
        job.started_by = user if getattr(user, "pk", None) else None
        if user and getattr(user, "pk", None) and not job.assigned_to_id:
            job.assigned_to = user
        job.save(update_fields=["status", "started_at", "started_by", "assigned_to", "updated_at"])
        _log("JOB", job.id, "STARTED", user, before=before, after={"status": job.status})
        return job

    @classmethod
    def complete_job(cls, job: MaintenanceJob, *, outcome: str, user=None, checklist_results=None, time_minutes: int = 0,
                     spares_used=None, notes: str = "", outcome_reason: str = "", fault_title: str = "",
                     fault_severity: str = "MEDIUM", machine_running: bool = True) -> MaintenanceJob:
        outcome = str(outcome or "").upper()
        if outcome not in {"COMPLETED", "ISSUE", "UNABLE"}:
            raise ValueError("Outcome must be COMPLETED, ISSUE or UNABLE.")
        if outcome in {"ISSUE", "UNABLE"} and not str(outcome_reason or "").strip():
            raise ValueError("A reason is required when the work is not completed cleanly.")
        if job.status in {"DONE", "VERIFIED", "AWAITING_VERIFICATION", "CANCELLED"}:
            raise ValueError(f"Job is already {job.status}.")
        with transaction.atomic():
            before = {"status": job.status, "outcome": job.outcome}
            now = timezone.now()
            spares = []
            total_cost = Decimal("0")
            for row in spares_used or []:
                if not isinstance(row, dict):
                    continue
                item = str(row.get("item") or "").strip()
                if not item:
                    continue
                qty = Decimal(str(row.get("qty") or 0))
                cost = Decimal(str(row.get("cost") or 0))
                spares.append({"item": item, "qty": float(qty), "cost": float(cost)})
                total_cost += cost
            job.checklist_results = list(checklist_results or [])
            job.spares_used = spares
            job.spares_cost = total_cost.quantize(Decimal("0.01"))
            job.time_minutes = int(time_minutes or 0)
            job.notes = (notes or job.notes or "")[:4000]
            job.outcome = outcome
            job.outcome_reason = (outcome_reason or "")[:4000]
            job.completed_at = now
            job.completed_by = user if getattr(user, "pk", None) else None
            if not job.started_at:
                job.started_at = now
            if outcome == "COMPLETED":
                job.status = "AWAITING_VERIFICATION" if job.requires_verification else "DONE"
            elif outcome == "ISSUE":
                job.status = "ISSUE_FOUND"
            else:
                job.status = "UNABLE"
            job.save()
            fault = None
            if outcome == "ISSUE":
                fault = cls.report_fault(
                    machine=job.machine,
                    title=(fault_title or f"Issue found during {job.title}")[:200],
                    description=outcome_reason,
                    severity=fault_severity or "MEDIUM",
                    machine_running=machine_running,
                    user=user,
                    source_job=job,
                )
            if outcome == "COMPLETED" and job.schedule_id:
                cls._roll_schedule_forward(job.schedule, completed_at=now)
            _log("JOB", job.id, "COMPLETED", user, before=before,
                 after={"status": job.status, "outcome": outcome, "fault_id": str(fault.id) if fault else None, "time_minutes": job.time_minutes})
        return job

    @classmethod
    def _roll_schedule_forward(cls, schedule: MaintenanceSchedule, *, completed_at: datetime):
        schedule.last_completed_at = completed_at
        completed_on = timezone.localtime(completed_at).date()
        if schedule.interval_type == "RUN_HOURS":
            schedule.run_hours_anchor_at = completed_at
            schedule.next_due_date = None
        else:
            schedule.next_due_date = cls.compute_next_due(schedule, completed_on=completed_on)
        schedule.save(update_fields=["last_completed_at", "run_hours_anchor_at", "next_due_date", "updated_at"])

    @classmethod
    def verify_job(cls, job: MaintenanceJob, *, user=None, accepted: bool = True, note: str = "") -> MaintenanceJob:
        if job.status != "AWAITING_VERIFICATION":
            raise ValueError("Only completed work awaiting verification can be verified.")
        before = {"status": job.status}
        job.verified_at = timezone.now()
        job.verified_by = user if getattr(user, "pk", None) else None
        job.verification_note = (note or "")[:2000]
        if accepted:
            job.status = "VERIFIED"
        else:
            # Sent back: the work is due again on its original planned date.
            job.status = "DUE"
            job.outcome = ""
            job.completed_at = None
            job.completed_by = None
            if job.schedule_id and job.schedule.last_completed_at:
                # Undo the roll-forward so the schedule still shows this work as pending.
                schedule = job.schedule
                schedule.next_due_date = job.planned_date if schedule.interval_type != "RUN_HOURS" else None
                schedule.save(update_fields=["next_due_date", "updated_at"])
        job.save()
        _log("JOB", job.id, "VERIFIED" if accepted else "SENT_BACK", user, before=before, after={"status": job.status}, note=note)
        return job

    @classmethod
    def reassign_job(cls, job: MaintenanceJob, *, assigned_to=None, planned_date: date | None = None, user=None, note: str = "") -> MaintenanceJob:
        before = {"assigned_to": str(job.assigned_to_id) if job.assigned_to_id else None, "planned_date": job.planned_date.isoformat(), "status": job.status}
        if assigned_to is not None:
            job.assigned_to = assigned_to
        if planned_date:
            job.planned_date = planned_date
        if job.status in {"UNABLE", "ISSUE_FOUND"}:
            job.status = "DUE"
        job.save(update_fields=["assigned_to", "planned_date", "status", "updated_at"])
        _log("JOB", job.id, "REASSIGNED", user, before=before,
             after={"assigned_to": str(job.assigned_to_id) if job.assigned_to_id else None, "planned_date": job.planned_date.isoformat(), "status": job.status}, note=note)
        return job

    @classmethod
    def cancel_job(cls, job: MaintenanceJob, *, user=None, note: str = "") -> MaintenanceJob:
        if not note.strip():
            raise ValueError("A reason is required to cancel maintenance work.")
        before = {"status": job.status}
        job.status = "CANCELLED"
        job.save(update_fields=["status", "updated_at"])
        _log("JOB", job.id, "CANCELLED", user, before=before, after={"status": "CANCELLED"}, note=note)
        return job

    # ------------------------------------------------------------------ faults
    @classmethod
    def report_fault(cls, *, machine: Machine, title: str, description: str = "", severity: str = "MEDIUM",
                     machine_running: bool = True, user=None, source_job: MaintenanceJob | None = None) -> MachineFault:
        from apps.production.models import ProductionJob
        from apps.production.services.job_services import JobService
        with transaction.atomic():
            fault = MachineFault.objects.create(
                machine=machine,
                title=title[:200],
                description=description or "",
                severity=severity if severity in {"LOW", "MEDIUM", "HIGH", "CRITICAL"} else "MEDIUM",
                machine_running=bool(machine_running),
                reported_by=user if getattr(user, "pk", None) else None,
                source_job=source_job,
            )
            running = ProductionJob.objects.filter(machine=machine, job_state="EXECUTING", status="RUNNING").order_by("start_date").first()
            if running:
                fault.production_job = running
                if not machine_running:
                    # The machine has stopped: pause the running step as a breakdown so
                    # the downtime timeline and OEE see it without a second entry.
                    try:
                        JobService.pause_job(running.id, f"Fault: {title}", reason_bucket="BREAKDOWN", user=user)
                        from apps.production.models import DowntimeLog
                        fault.downtime_log = DowntimeLog.objects.filter(production_job=running, end_time__isnull=True, source="PAUSE").order_by("-start_time").first()
                    except Exception:
                        logger.warning("report_fault: could not pause running job %s", running.id, exc_info=True)
                fault.save(update_fields=["production_job", "downtime_log", "updated_at"])
            if not machine_running and machine.status == "ACTIVE":
                machine.status = "DOWN"
                machine.save(update_fields=["status"])
            _log("FAULT", fault.id, "REPORTED", user, after={"title": title, "severity": fault.severity, "machine_running": machine_running})
            cls._notify("maintenance.fault_reported", f"Fault on {machine.code}: {title}",
                        f"{machine.name} ({machine.code}) · {severity} · {'machine stopped' if not machine_running else 'machine running'}",
                        priority="HIGH" if (not machine_running or severity in {"HIGH", "CRITICAL"}) else "NORMAL",
                        related_object_type="MachineFault", related_object_id=str(fault.id))
        return fault

    @classmethod
    def assign_fault(cls, fault: MachineFault, *, assigned_to=None, user=None, create_job: bool = True, planned_date: date | None = None):
        before = {"status": fault.status, "assigned_to": str(fault.assigned_to_id) if fault.assigned_to_id else None}
        fault.assigned_to = assigned_to
        fault.assigned_at = timezone.now()
        fault.status = "ASSIGNED"
        fault.save(update_fields=["assigned_to", "assigned_at", "status", "updated_at"])
        job = None
        if create_job and not fault.jobs.filter(status__in=MaintenanceJob.OPEN_STATUSES).exists():
            job = cls.create_manual_job(
                machine=fault.machine, title=f"Repair: {fault.title}", planned_date=planned_date or _today(),
                kind="TECH_SERVICE", assigned_role="MAINTENANCE_TECH", assigned_to=assigned_to, fault=fault,
                requires_verification=fault.severity in {"HIGH", "CRITICAL"}, user=user,
            )
        _log("FAULT", fault.id, "ASSIGNED", user, before=before, after={"status": fault.status, "assigned_to": str(assigned_to.id) if assigned_to else None})
        return fault, job

    @classmethod
    def set_fault_status(cls, fault: MachineFault, *, status: str, user=None, note: str = "") -> MachineFault:
        status = str(status or "").upper()
        if status not in {"IN_REPAIR", "RESOLVED", "CLOSED", "DISMISSED", "OPEN"}:
            raise ValueError("Unknown fault status.")
        before = {"status": fault.status}
        now = timezone.now()
        fault.status = status
        if status == "RESOLVED":
            fault.resolved_at = now
            fault.resolved_by = user if getattr(user, "pk", None) else None
            fault.resolution_note = (note or fault.resolution_note or "")[:4000]
            if fault.machine.status == "DOWN" and not MachineFault.objects.filter(machine=fault.machine, machine_running=False, status__in=["OPEN", "ASSIGNED", "IN_REPAIR"]).exclude(id=fault.id).exists():
                fault.machine.status = "ACTIVE"
                fault.machine.save(update_fields=["status"])
        if status in {"CLOSED", "DISMISSED"}:
            fault.closed_at = now
            if status == "DISMISSED":
                fault.resolution_note = (note or fault.resolution_note or "")[:4000]
        fault.save()
        _log("FAULT", fault.id, status, user, before=before, after={"status": status}, note=note)
        return fault

    # ------------------------------------------------------------------ board & reports
    @classmethod
    def board(cls, *, plant_id=None, machine_id=None, today: date | None = None) -> dict:
        today = today or _today()
        jobs = MaintenanceJob.objects.select_related("machine", "machine__work_center", "assigned_to", "schedule")
        faults = MachineFault.objects.select_related("machine", "assigned_to", "reported_by")
        machines = Machine.objects.select_related("work_center", "work_center__plant")
        if plant_id:
            jobs = jobs.filter(machine__work_center__plant_id=plant_id)
            faults = faults.filter(machine__work_center__plant_id=plant_id)
            machines = machines.filter(work_center__plant_id=plant_id)
        if machine_id:
            jobs = jobs.filter(machine_id=machine_id)
            faults = faults.filter(machine_id=machine_id)
            machines = machines.filter(id=machine_id)
        open_jobs = jobs.filter(status__in=MaintenanceJob.OPEN_STATUSES)
        due_today = open_jobs.filter(planned_date=today)
        overdue = open_jobs.filter(planned_date__lt=today)
        open_faults = faults.filter(status__in=["OPEN", "ASSIGNED", "IN_REPAIR"])
        awaiting_repair = machines.filter(status="DOWN")
        awaiting_verification = jobs.filter(status="AWAITING_VERIFICATION")
        return {
            "today": today.isoformat(),
            "counts": {
                "due_today": due_today.count(),
                "overdue": overdue.count(),
                "open_faults": open_faults.count(),
                "machines_awaiting_repair": awaiting_repair.count(),
                "awaiting_verification": awaiting_verification.count(),
                "open_total": open_jobs.count(),
            },
            "due_today": list(due_today.order_by("machine__code", "title")[:200]),
            "overdue": list(overdue.order_by("planned_date", "machine__code")[:200]),
            "open_faults": list(open_faults.order_by("-severity", "-reported_at")[:200]),
            "awaiting_verification": list(awaiting_verification.order_by("completed_at")[:200]),
            "machines_awaiting_repair": list(awaiting_repair.order_by("code")[:200]),
        }

    @classmethod
    def compliance_report(cls, *, plant_id=None, machine_id=None, months: int = 3) -> list[dict]:
        today = _today()
        start = _add_months(today.replace(day=1), -max(1, months) + 1)
        qs = MaintenanceJob.objects.filter(planned_date__gte=start, source="SCHEDULE").exclude(status="CANCELLED").select_related("machine")
        if plant_id:
            qs = qs.filter(machine__work_center__plant_id=plant_id)
        if machine_id:
            qs = qs.filter(machine_id=machine_id)
        rows: dict[tuple, dict] = {}
        for job in qs:
            key = (str(job.machine_id), job.machine.code, job.machine.name, job.planned_date.strftime("%Y-%m"))
            row = rows.setdefault(key, {"machine_id": key[0], "machine_code": key[1], "machine_name": key[2], "month": key[3], "scheduled": 0, "on_time": 0, "late": 0, "missed": 0, "open": 0})
            row["scheduled"] += 1
            if job.status in {"DONE", "VERIFIED", "AWAITING_VERIFICATION"} and job.completed_at:
                done_on = timezone.localtime(job.completed_at).date()
                if done_on <= job.planned_date:
                    row["on_time"] += 1
                else:
                    row["late"] += 1
            elif job.status in MaintenanceJob.OPEN_STATUSES and job.planned_date < today:
                row["missed"] += 1
            elif job.status in MaintenanceJob.OPEN_STATUSES:
                row["open"] += 1
            else:
                row["missed"] += 1
        out = []
        for row in rows.values():
            closed = row["on_time"] + row["late"] + row["missed"]
            row["on_time_pct"] = round(100.0 * row["on_time"] / closed, 1) if closed else None
            out.append(row)
        return sorted(out, key=lambda r: (r["machine_code"], r["month"]))

    @classmethod
    def downtime_report(cls, *, plant_id=None, machine_id=None, days: int = 90) -> list[dict]:
        """Breakdown count and hours per machine per month from the production downtime log."""
        from apps.production.models import DowntimeLog
        since = timezone.now() - timedelta(days=max(1, days))
        qs = DowntimeLog.objects.filter(start_time__gte=since, production_job__machine__isnull=False).select_related("production_job__machine")
        if plant_id:
            qs = qs.filter(production_job__machine__work_center__plant_id=plant_id)
        if machine_id:
            qs = qs.filter(production_job__machine_id=machine_id)
        rows: dict[tuple, dict] = {}
        now = timezone.now()
        for log in qs:
            machine = log.production_job.machine
            key = (str(machine.id), timezone.localtime(log.start_time).strftime("%Y-%m"))
            row = rows.setdefault(key, {"machine_id": key[0], "machine_code": machine.code, "machine_name": machine.name, "month": key[1], "breakdowns": 0, "breakdown_hours": 0.0, "maintenance_hours": 0.0, "other_hours": 0.0, "events": 0})
            end = log.end_time or now
            hours = max(0.0, (end - log.start_time).total_seconds() / 3600.0)
            row["events"] += 1
            if log.reason == "BREAKDOWN":
                row["breakdowns"] += 1
                row["breakdown_hours"] += hours
            elif log.reason == "MAINTENANCE":
                row["maintenance_hours"] += hours
            else:
                row["other_hours"] += hours
        for row in rows.values():
            for k in ("breakdown_hours", "maintenance_hours", "other_hours"):
                row[k] = round(row[k], 2)
        return sorted(rows.values(), key=lambda r: (r["machine_code"], r["month"]))

    @classmethod
    def recurring_faults(cls, *, plant_id=None, machine_id=None, days: int = 90, limit: int = 20) -> list[dict]:
        since = timezone.now() - timedelta(days=max(1, days))
        qs = MachineFault.objects.filter(reported_at__gte=since).exclude(status="DISMISSED")
        if plant_id:
            qs = qs.filter(machine__work_center__plant_id=plant_id)
        if machine_id:
            qs = qs.filter(machine_id=machine_id)
        rows = (
            qs.values("machine_id", "machine__code", "machine__name", "title")
            .annotate(times=Count("id"), last_at=models_max("reported_at"), stopped=Count("id", filter=Q(machine_running=False)))
            .order_by("-times", "-last_at")[:limit]
        )
        return [
            {"machine_id": str(r["machine_id"]), "machine_code": r["machine__code"], "machine_name": r["machine__name"], "title": r["title"], "times": r["times"], "stopped_machine": r["stopped"], "last_at": r["last_at"].isoformat() if r["last_at"] else None}
            for r in rows
        ]

    @classmethod
    def spares_report(cls, *, plant_id=None, machine_id=None, months: int = 3) -> list[dict]:
        today = _today()
        start = _add_months(today.replace(day=1), -max(1, months) + 1)
        qs = MaintenanceJob.objects.filter(completed_at__date__gte=start).exclude(status="CANCELLED").select_related("machine")
        if plant_id:
            qs = qs.filter(machine__work_center__plant_id=plant_id)
        if machine_id:
            qs = qs.filter(machine_id=machine_id)
        rows: dict[tuple, dict] = {}
        for job in qs:
            key = (str(job.machine_id), timezone.localtime(job.completed_at).strftime("%Y-%m"))
            row = rows.setdefault(key, {"machine_id": key[0], "machine_code": job.machine.code, "machine_name": job.machine.name, "month": key[1], "jobs": 0, "spares_cost": 0.0, "time_hours": 0.0, "items": []})
            row["jobs"] += 1
            row["spares_cost"] += float(job.spares_cost or 0)
            row["time_hours"] += (job.time_minutes or 0) / 60.0
            for item in job.spares_used or []:
                row["items"].append({"job_id": str(job.id), "date": timezone.localtime(job.completed_at).date().isoformat(), **item})
        for row in rows.values():
            row["spares_cost"] = round(row["spares_cost"], 2)
            row["time_hours"] = round(row["time_hours"], 2)
        return sorted(rows.values(), key=lambda r: (r["machine_code"], r["month"]))

    @classmethod
    def workload_report(cls, *, plant_id=None, days: int = 30) -> list[dict]:
        today = _today()
        since = today - timedelta(days=max(1, days))
        qs = MaintenanceJob.objects.filter(Q(planned_date__gte=since) | Q(status__in=MaintenanceJob.OPEN_STATUSES)).exclude(status="CANCELLED").select_related("assigned_to")
        if plant_id:
            qs = qs.filter(machine__work_center__plant_id=plant_id)
        rows: dict[str, dict] = {}
        for job in qs:
            key = str(job.assigned_to_id) if job.assigned_to_id else "unassigned"
            name = job.assigned_to.get_full_name() or job.assigned_to.username if job.assigned_to_id else "Unassigned"
            row = rows.setdefault(key, {"user_id": key, "name": name, "open": 0, "overdue": 0, "done": 0, "avg_close_hours": None, "_close_hours": []})
            if job.status in MaintenanceJob.OPEN_STATUSES:
                row["open"] += 1
                if job.planned_date < today:
                    row["overdue"] += 1
            elif job.completed_at:
                row["done"] += 1
                if job.started_at:
                    row["_close_hours"].append((job.completed_at - job.started_at).total_seconds() / 3600.0)
        out = []
        for row in rows.values():
            hours = row.pop("_close_hours")
            row["avg_close_hours"] = round(sum(hours) / len(hours), 2) if hours else None
            out.append(row)
        return sorted(out, key=lambda r: (-r["overdue"], -r["open"], r["name"]))

    @classmethod
    def machine_history(cls, machine: Machine, *, limit: int = 200) -> list[dict]:
        from apps.production.models import DowntimeLog
        events: list[dict] = []
        for job in MaintenanceJob.objects.filter(machine=machine).exclude(status="CANCELLED").select_related("completed_by", "assigned_to").order_by("-planned_date")[:limit]:
            events.append({
                "kind": "JOB", "id": str(job.id), "at": (job.completed_at or timezone.make_aware(datetime.combine(job.planned_date, datetime.min.time()))).isoformat(),
                "title": job.title, "status": job.status, "outcome": job.outcome, "planned_date": job.planned_date.isoformat(),
                "by": (job.completed_by.get_full_name() or job.completed_by.username) if job.completed_by_id else ((job.assigned_to.get_full_name() or job.assigned_to.username) if job.assigned_to_id else ""),
                "spares_cost": float(job.spares_cost or 0), "time_minutes": job.time_minutes, "attachments": job.attachments.count(),
            })
        for fault in MachineFault.objects.filter(machine=machine).select_related("reported_by").order_by("-reported_at")[:limit]:
            events.append({
                "kind": "FAULT", "id": str(fault.id), "at": fault.reported_at.isoformat(), "title": fault.title, "status": fault.status,
                "severity": fault.severity, "machine_running": fault.machine_running,
                "by": (fault.reported_by.get_full_name() or fault.reported_by.username) if fault.reported_by_id else "",
                "resolved_at": fault.resolved_at.isoformat() if fault.resolved_at else None,
            })
        for log in DowntimeLog.objects.filter(production_job__machine=machine).select_related("production_job", "reason_code").order_by("-start_time")[:limit]:
            end = log.end_time
            events.append({
                "kind": "DOWNTIME", "id": str(log.id), "at": log.start_time.isoformat(), "title": log.reason_code.label if log.reason_code_id else dict(DowntimeLog.REASON_CHOICES).get(log.reason, log.reason),
                "reason": log.reason, "source": log.source, "hours": round(((end or timezone.now()) - log.start_time).total_seconds() / 3600.0, 2),
                "job_number": log.production_job.job_number if log.production_job_id else "", "notes": log.notes,
            })
        events.sort(key=lambda e: e["at"], reverse=True)
        return events[:limit]

    # ------------------------------------------------------------------ notifications
    @staticmethod
    def _notify(event_key: str, title: str, message: str, *, priority: str = "NORMAL", related_object_type: str = "", related_object_id: str | None = None, idempotency_key: str | None = None):
        try:
            from apps.users.services.notification_service import NotificationService
            NotificationService.emit_event(
                event_key=event_key, title=title, message=message, notification_type="MAINTENANCE",
                related_object_type=related_object_type, related_object_id=related_object_id, priority=priority, idempotency_key=idempotency_key,
            )
        except Exception:
            logger.warning("maintenance notification failed for %s", event_key, exc_info=True)

    @classmethod
    def notify_overdue(cls, *, today: date | None = None) -> int:
        today = today or _today()
        overdue = MaintenanceJob.objects.filter(status__in=MaintenanceJob.OPEN_STATUSES, planned_date__lt=today).select_related("machine")
        count = overdue.count()
        if count:
            sample = ", ".join(f"{j.machine.code} {j.title} ({j.planned_date.isoformat()})" for j in overdue.order_by("planned_date")[:5])
            cls._notify("maintenance.overdue", f"{count} maintenance job(s) overdue", sample, priority="HIGH",
                        related_object_type="MaintenanceBoard", idempotency_key=f"maintenance.overdue.{today.isoformat()}")
        return count


def models_max(field):
    from django.db.models import Max
    return Max(field)
