from collections import defaultdict
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Count, Q

from apps.production.models import JobExecutionLog, JobMaterialRequirement, ProductionJob
from apps.production.services.shift_resolver import build_shift_fields_for_job


class Command(BaseCommand):
    help = "Backfill missing analytics telemetry from existing production state (dry-run by default)."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Persist the generated telemetry rows.")
        parser.add_argument("--plant", type=str, help="Optional plant id to scope the backfill.")

    def _coverage(self, jobs_qs):
        job_ids = list(jobs_qs.values_list("id", flat=True))
        total = len(job_ids)
        if total == 0:
            return {
                "total_jobs": 0,
                "execution_log_coverage": 0.0,
                "material_actual_coverage": 0.0,
                "shift_coverage": 0.0,
            }

        jobs_with_exec = JobExecutionLog.objects.filter(production_job_id__in=job_ids).values("production_job_id").distinct().count()
        jobs_with_material = JobMaterialRequirement.objects.filter(
            production_job_id__in=job_ids
        ).filter(
            Q(actual_issued_qty__gt=0) | Q(consumed_qty__gt=0) | Q(actual_returned_qty__gt=0)
        ).values("production_job_id").distinct().count()

        exec_qs = JobExecutionLog.objects.filter(production_job_id__in=job_ids)
        exec_total = exec_qs.count() or 1
        shift_rows = exec_qs.exclude(shift_code__isnull=True).exclude(shift_code="")
        return {
            "total_jobs": total,
            "execution_log_coverage": round((jobs_with_exec / total) * 100, 2),
            "material_actual_coverage": round((jobs_with_material / total) * 100, 2),
            "shift_coverage": round((shift_rows.count() / exec_total) * 100, 2),
        }

    def handle(self, *args, **options):
        apply = bool(options.get("apply"))
        plant_id = options.get("plant")
        exec_field_names = {f.name for f in JobExecutionLog._meta.fields}

        jobs = ProductionJob.objects.select_related("work_center", "machine").all()
        if plant_id:
            jobs = jobs.filter(work_center__plant_id=plant_id)

        before = self._coverage(jobs)
        jobs_without_exec = jobs.exclude(id__in=JobExecutionLog.objects.values_list("production_job_id", flat=True))

        execution_rows = 0
        requirement_rows = 0
        per_plant = defaultdict(lambda: {"jobs": 0, "exec_backfilled": 0, "material_backfilled": 0})

        with transaction.atomic():
            for job in jobs_without_exec:
                qty = Decimal(str(getattr(job, "produced_qty", 0) or 0))
                if qty <= 0:
                    qty = Decimal(str(getattr(job, "quantity", 0) or 0))
                if qty <= 0:
                    continue

                plant_key = str(getattr(getattr(job, "work_center", None), "plant_id", "UNKNOWN"))
                per_plant[plant_key]["jobs"] += 1

                if apply:
                    create_payload = {
                        "production_job": job,
                        "quantity": qty,
                        "uom": "KG",
                        **build_shift_fields_for_job(job, ts=getattr(job, "updated_at", None)),
                    }
                    if "is_estimated" in exec_field_names:
                        create_payload["is_estimated"] = True
                    JobExecutionLog.objects.create(
                        **create_payload,
                    )
                execution_rows += 1
                per_plant[plant_key]["exec_backfilled"] += 1

            reqs = JobMaterialRequirement.objects.select_related("production_job").filter(
                Q(actual_issued_qty=0),
                Q(actual_returned_qty=0),
                Q(actual_scrap_qty=0),
                Q(consumed_qty=0),
            )
            if plant_id:
                reqs = reqs.filter(production_job__work_center__plant_id=plant_id)

            for req in reqs:
                if Decimal(str(req.required_qty or 0)) <= 0:
                    continue
                planned = Decimal(str(req.planned_issue_qty or req.required_qty or 0))
                consumed = Decimal(str(req.required_qty or 0))
                theoretical = Decimal(str(req.theoretical_qty or 0))
                variance = consumed - theoretical
                plant_key = str(getattr(getattr(req.production_job, "work_center", None), "plant_id", "UNKNOWN"))
                if apply:
                    req.actual_issued_qty = planned
                    req.actual_returned_qty = Decimal("0")
                    req.actual_scrap_qty = Decimal("0")
                    req.consumed_qty = consumed
                    req.variance_qty = variance
                    req.is_estimated = True
                    req.save(
                        update_fields=[
                            "actual_issued_qty",
                            "actual_returned_qty",
                            "actual_scrap_qty",
                            "consumed_qty",
                            "variance_qty",
                            "is_estimated",
                            "updated_at",
                        ]
                    )
                requirement_rows += 1
                per_plant[plant_key]["material_backfilled"] += 1

            if not apply:
                transaction.set_rollback(True)

        after = self._coverage(jobs) if apply else before
        payload = {
            "mode": "APPLY" if apply else "DRY_RUN",
            "execution_rows_backfilled": execution_rows,
            "material_rows_backfilled": requirement_rows,
            "before": before,
            "after": after,
            "per_plant": dict(per_plant),
        }
        self.stdout.write(self.style.SUCCESS(str(payload)))
