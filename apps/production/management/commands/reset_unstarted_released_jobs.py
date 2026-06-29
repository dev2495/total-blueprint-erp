from django.core.management.base import BaseCommand
from django.db import transaction

from apps.costing.models import JobRuntimeSession
from apps.production.models import (
    DowntimeLog,
    JobExecutionLog,
    MaterialConsumptionLog,
    ProductionJob,
    ScrapLog,
    WorkCenterAssignment,
)
from apps.production.services.job_services import JobService


class Command(BaseCommand):
    help = (
        "Dry-run or move released-but-not-started jobs back to planner queue. "
        "Completed, executing, machine-assigned, and logged production jobs are never changed."
    )

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Apply changes. Default is dry run.")
        parser.add_argument("--dry-run", action="store_true", help="Preview eligible jobs without changing data.")
        parser.add_argument("--limit", type=int, default=500, help="Maximum rows to inspect.")
        parser.add_argument("--job-id", default="", help="Optional single job id.")
        parser.add_argument("--work-center-id", default="", help="Optional work center id.")

    def _blocked_job_ids(self, job_ids):
        blocked = set()
        for model in (JobExecutionLog, ScrapLog, DowntimeLog, MaterialConsumptionLog):
            blocked.update(
                str(value)
                for value in model.objects.filter(production_job_id__in=job_ids).values_list("production_job_id", flat=True)
            )
        blocked.update(
            str(value)
            for value in JobRuntimeSession.objects.filter(job_id__in=job_ids).values_list("job_id", flat=True)
        )
        return blocked

    def handle(self, *args, **options):
        apply_changes = bool(options.get("apply"))
        limit = max(1, int(options.get("limit") or 500))
        job_id = str(options.get("job_id") or "").strip()
        work_center_id = str(options.get("work_center_id") or "").strip()

        qs = (
            ProductionJob.objects.select_related("sales_order_item", "work_center")
            .filter(job_state="RELEASED")
            .exclude(status__in=["RUNNING", "COMPLETED", "CANCELLED"])
            .order_by("-updated_at")
        )
        if job_id:
            qs = qs.filter(id=job_id)
        if work_center_id:
            qs = qs.filter(work_center_id=work_center_id)
        jobs = list(qs[:limit])
        job_ids = [str(job.id) for job in jobs]
        blocked_ids = self._blocked_job_ids(job_ids)
        assignments = {
            str(row.production_job_id): row
            for row in WorkCenterAssignment.objects.filter(production_job_id__in=job_ids).select_related("assigned_machine")
        }

        eligible = []
        skipped = []
        for job in jobs:
            assignment = assignments.get(str(job.id))
            reasons = []
            if str(job.id) in blocked_ids:
                reasons.append("execution records exist")
            if job.machine_id:
                reasons.append("job has machine")
            if job.start_date:
                reasons.append("job has start_date")
            if assignment and assignment.assigned_machine_id:
                reasons.append("assignment has machine")
            if str(job.job_state or "").upper() in {"EXECUTING", "PAUSED", "COMPLETED", "CANCELLED"}:
                reasons.append(f"state {job.job_state}")
            if reasons:
                skipped.append((job, ", ".join(reasons)))
            else:
                eligible.append((job, assignment))

        self.stdout.write(f"Inspected released jobs: {len(jobs)}")
        self.stdout.write(f"Eligible to reset: {len(eligible)}")
        self.stdout.write(f"Skipped: {len(skipped)}")
        for job, assignment in eligible[:80]:
            wc_code = getattr(getattr(job, "work_center", None), "code", "") or "-"
            self.stdout.write(f"- RESET {job.job_number} | {job.origin} | {wc_code} | assignment={bool(assignment)}")
        for job, reason in skipped[:30]:
            self.stdout.write(f"- SKIP {job.job_number}: {reason}")

        if not apply_changes:
            self.stdout.write(self.style.WARNING("Dry run only. Re-run with --apply to reset eligible jobs."))
            return

        with transaction.atomic():
            for job, assignment in eligible:
                if assignment:
                    assignment.allocated_rolls.clear()
                    assignment.delete()
                JobService._release_active_roll_reservations(job)
                job.job_state = "PLANNED"
                job.status = "QUEUED"
                job.machine = None
                job.operator = None
                job.work_center = None
                job.current_step_material_confirmations = []
                job.save(update_fields=[
                    "job_state",
                    "status",
                    "machine",
                    "operator",
                    "work_center",
                    "current_step_material_confirmations",
                    "updated_at",
                ])
                item = getattr(job, "sales_order_item", None)
                if item and str(item.line_status or "").upper() == "RELEASED":
                    item.line_status = "PLANNED"
                    item.save(update_fields=["line_status"])

        self.stdout.write(self.style.SUCCESS(f"Reset {len(eligible)} jobs back to planner queue."))
