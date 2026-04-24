from django.core.management.base import BaseCommand
from django.db import transaction

from apps.production.models import (
    DowntimeLog,
    JobExecutionLog,
    MaterialConsumptionLog,
    ProductionJob,
    ScrapLog,
    WorkCenterAssignment,
)


class Command(BaseCommand):
    help = (
        "Dry-run or reset prematurely released WCM jobs back to the WCM queue. "
        "Only jobs without execution, scrap, downtime, or consumption logs are eligible."
    )

    def add_arguments(self, parser):
        parser.add_argument("--work-center-id", default="", help="Optional work center id to limit the reset.")
        parser.add_argument("--apply", action="store_true", help="Apply the reset. Without this flag the command is a dry run.")

    def handle(self, *args, **options):
        work_center_id = str(options.get("work_center_id") or "").strip()
        apply_changes = bool(options.get("apply"))

        assignments = WorkCenterAssignment.objects.select_related("production_job").filter(status="EXECUTION_READY")
        if work_center_id:
            assignments = assignments.filter(work_center_id=work_center_id)

        candidate_ids = [str(a.production_job_id) for a in assignments]
        blocked_ids = set()
        for model in (JobExecutionLog, ScrapLog, DowntimeLog, MaterialConsumptionLog):
            blocked_ids.update(
                str(value)
                for value in model.objects.filter(production_job_id__in=candidate_ids).values_list("production_job_id", flat=True)
            )

        eligible = [assignment for assignment in assignments if str(assignment.production_job_id) not in blocked_ids]

        self.stdout.write(f"Found {len(candidate_ids)} execution-ready assignments.")
        self.stdout.write(f"Eligible to reset: {len(eligible)}")
        if blocked_ids:
            self.stdout.write(f"Skipped with execution records: {len(blocked_ids)}")

        for assignment in eligible[:50]:
            job = assignment.production_job
            self.stdout.write(
                f"- {job.job_number} | {job.customer_name or '-'} | {job.product_name or '-'} | "
                f"{assignment.status} -> WC_READY"
            )

        if not apply_changes:
            self.stdout.write(self.style.WARNING("Dry run only. Re-run with --apply to reset eligible jobs."))
            return

        with transaction.atomic():
            for assignment in eligible:
                job = assignment.production_job
                assignment.status = "WC_READY"
                assignment.assigned_machine = None
                assignment.save(update_fields=["status", "assigned_machine", "updated_at"])
                job.machine = None
                job.status = "QUEUED"
                job.job_state = "PLANNED"
                job.current_step_material_confirmations = []
                job.save(update_fields=[
                    "machine",
                    "status",
                    "job_state",
                    "current_step_material_confirmations",
                    "updated_at",
                ])

        self.stdout.write(self.style.SUCCESS(f"Reset {len(eligible)} jobs back to WCM queue."))
