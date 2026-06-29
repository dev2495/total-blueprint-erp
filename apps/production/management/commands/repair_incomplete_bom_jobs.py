from django.core.management.base import BaseCommand
from django.db import transaction

from apps.bom.readiness import bom_readiness_errors
from apps.costing.models import JobRuntimeSession
from apps.production.models import (
    DowntimeLog,
    JobExecutionLog,
    JobMaterialRequirement,
    MaterialConsumptionLog,
    ProductionJob,
    ScrapLog,
    WorkCenterAssignment,
)
from apps.production.services.job_services import JobService
from apps.sales.models import SalesOrderItem
from apps.sales.services.order_service import SalesOrderService


class Command(BaseCommand):
    help = (
        "Dry-run or reverse unstarted production jobs created from incomplete BOM snapshots. "
        "Eligible jobs are cancelled and the sales line is returned to PLANNING_REQUIRED."
    )

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Apply changes. Default is dry run.")
        parser.add_argument("--limit", type=int, default=500, help="Maximum sales lines to inspect.")
        parser.add_argument("--order-number", default="", help="Optional sales order number.")
        parser.add_argument("--item-id", default="", help="Optional sales order item id.")

    def _blocked_job_ids(self, job_ids):
        blocked = set()
        for model in (JobExecutionLog, ScrapLog, DowntimeLog, MaterialConsumptionLog):
            blocked.update(
                str(value)
                for value in model.objects.filter(production_job_id__in=job_ids).values_list(
                    "production_job_id",
                    flat=True,
                )
            )
        blocked.update(
            str(value)
            for value in JobRuntimeSession.objects.filter(job_id__in=job_ids).values_list("job_id", flat=True)
        )
        return blocked

    def _active_jobs_for_item(self, item):
        return list(
            ProductionJob.objects.select_related("work_center", "machine")
            .filter(sales_order_item=item)
            .exclude(job_state__in=["COMPLETED", "CANCELLED"])
            .order_by("current_step_index", "created_at")
        )

    def _job_skip_reasons(self, job, assignment, blocked_ids):
        reasons = []
        if str(job.id) in blocked_ids:
            reasons.append("execution records exist")
        if str(job.job_state or "").upper() in {"EXECUTING", "PAUSED", "COMPLETED", "CANCELLED"}:
            reasons.append(f"state {job.job_state}")
        if str(job.status or "").upper() in {"RUNNING", "COMPLETED", "CANCELLED"}:
            reasons.append(f"status {job.status}")
        if job.machine_id:
            reasons.append("job has machine")
        if job.start_date:
            reasons.append("job has start_date")
        if assignment and assignment.assigned_machine_id:
            reasons.append("assignment has machine")
        return reasons

    def handle(self, *args, **options):
        apply_changes = bool(options.get("apply"))
        limit = max(1, int(options.get("limit") or 500))
        order_number = str(options.get("order_number") or "").strip()
        item_id = str(options.get("item_id") or "").strip()

        qs = (
            SalesOrderItem.objects.select_related("sales_order", "template")
            .filter(productionjob__isnull=False)
            .distinct()
            .order_by("-created_at")
        )
        if order_number:
            qs = qs.filter(sales_order__order_number=order_number)
        if item_id:
            qs = qs.filter(id=item_id)

        items = list(qs[:limit])
        candidates = []
        skipped = []
        inspected_jobs = 0
        for item in items:
            errors = bom_readiness_errors(item.bom_snapshot)
            if not errors:
                continue

            jobs = self._active_jobs_for_item(item)
            if not jobs:
                skipped.append((item, "no active production jobs", errors))
                continue

            inspected_jobs += len(jobs)
            job_ids = [str(job.id) for job in jobs]
            blocked_ids = self._blocked_job_ids(job_ids)
            assignments = {
                str(row.production_job_id): row
                for row in WorkCenterAssignment.objects.filter(production_job_id__in=job_ids).select_related(
                    "assigned_machine"
                )
            }
            unsafe = []
            for job in jobs:
                reasons = self._job_skip_reasons(job, assignments.get(str(job.id)), blocked_ids)
                if reasons:
                    unsafe.append(f"{job.job_number}: {', '.join(reasons)}")

            if unsafe:
                skipped.append((item, " | ".join(unsafe), errors))
                continue

            candidates.append((item, jobs, assignments, errors))

        self.stdout.write(f"Inspected sales lines: {len(items)}")
        self.stdout.write(f"Inspected active jobs on incomplete BOM lines: {inspected_jobs}")
        self.stdout.write(f"Eligible sales lines to reverse: {len(candidates)}")
        self.stdout.write(f"Skipped sales lines: {len(skipped)}")
        for item, jobs, _assignments, errors in candidates[:80]:
            order_number = getattr(getattr(item, "sales_order", None), "order_number", "-")
            self.stdout.write(
                f"- REVERSE {order_number} / {item.id} | jobs={len(jobs)} | bom_error={'; '.join(errors)}"
            )
        for item, reason, errors in skipped[:40]:
            order_number = getattr(getattr(item, "sales_order", None), "order_number", "-")
            self.stdout.write(
                f"- SKIP {order_number} / {item.id}: {reason} | bom_error={'; '.join(errors)}"
            )

        if not apply_changes:
            self.stdout.write(self.style.WARNING("Dry run only. Re-run with --apply to reverse eligible jobs."))
            return

        with transaction.atomic():
            for item, jobs, assignments, errors in candidates:
                for job in jobs:
                    assignment = assignments.get(str(job.id))
                    if assignment:
                        assignment.allocated_rolls.clear()
                        assignment.delete()
                    JobService._release_active_roll_reservations(job)
                    JobMaterialRequirement.objects.filter(production_job=job).delete()
                    note = f"Cancelled by repair_incomplete_bom_jobs: {'; '.join(errors)}"
                    existing_notes = str(job.planner_notes or "").strip()
                    job.planner_notes = f"{existing_notes}\n{note}".strip() if existing_notes else note
                    job.job_state = "CANCELLED"
                    job.status = "CANCELLED"
                    job.machine = None
                    job.operator = None
                    job.work_center = None
                    job.current_step_material_confirmations = []
                    job.save(
                        update_fields=[
                            "planner_notes",
                            "job_state",
                            "status",
                            "machine",
                            "operator",
                            "work_center",
                            "current_step_material_confirmations",
                            "updated_at",
                        ]
                    )

                if str(item.line_status or "").upper() not in {"CANCELLED", "SHORT_CLOSED", "COMPLETED"}:
                    item.line_status = "PLANNING_REQUIRED"
                    item.save(update_fields=["line_status"])
                    SalesOrderService.sync_order_status_from_lines(item.sales_order)

        self.stdout.write(self.style.SUCCESS(f"Reversed {len(candidates)} sales lines back to planner queue."))
