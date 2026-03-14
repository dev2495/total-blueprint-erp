from decimal import Decimal
from typing import Dict, Optional

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.analytics.reports_service import ReportService
from apps.materials.models import InventoryMaterial
from apps.production.models import (
    DowntimeLog,
    InkBlendTransaction,
    JobExecutionLog,
    JobMaterialRequirement,
    ProductionJob,
    ScrapLog,
)
from apps.users.models import User


class Command(BaseCommand):
    help = "Seed controlled telemetry: shift-tagged execution/material actuals and one ink remix lineage."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Persist seed rows. Dry-run by default.")
        parser.add_argument("--jobs", type=int, default=12, help="Number of latest jobs to seed.")

    @staticmethod
    def _q(value: Decimal) -> Decimal:
        return Decimal(value).quantize(Decimal("0.0001"))

    def _upsert_req(
        self,
        *,
        job: ProductionJob,
        material: InventoryMaterial,
        payload: Dict[str, Decimal],
        apply: bool,
    ) -> Optional[JobMaterialRequirement]:
        qs = JobMaterialRequirement.objects.filter(
            production_job=job,
            material=material,
            process_step__isnull=True,
        ).order_by("created_at")
        req = qs.first()
        if req is None:
            if not apply:
                return None
            req = JobMaterialRequirement.objects.create(
                production_job=job,
                material=material,
                process_step=None,
                uom="KG",
            )
        if not apply:
            return req

        req.required_qty = payload["required_qty"]
        req.theoretical_qty = payload["theoretical_qty"]
        req.planned_issue_qty = payload["planned_issue_qty"]
        req.actual_issued_qty = payload["actual_issued_qty"]
        req.actual_returned_qty = payload["actual_returned_qty"]
        req.actual_scrap_qty = payload["actual_scrap_qty"]
        req.consumed_qty = payload["consumed_qty"]
        req.variance_qty = payload["variance_qty"]
        req.is_estimated = False
        req.assigned_qty = payload["planned_issue_qty"]
        req.save(
            update_fields=[
                "required_qty",
                "theoretical_qty",
                "planned_issue_qty",
                "actual_issued_qty",
                "actual_returned_qty",
                "actual_scrap_qty",
                "consumed_qty",
                "variance_qty",
                "is_estimated",
                "assigned_qty",
                "updated_at",
            ]
        )
        return req

    def handle(self, *args, **options):
        apply = bool(options["apply"])
        limit = int(options["jobs"] or 12)
        mode = "APPLY" if apply else "DRY_RUN"

        jobs = list(ProductionJob.objects.order_by("-created_at")[:limit])
        if not jobs:
            raise CommandError("No production jobs available to seed telemetry.")

        film = InventoryMaterial.objects.filter(category="FILM_VARIANT").order_by("created_at").first()
        adhesive = InventoryMaterial.objects.filter(category="ADHESIVE").order_by("created_at").first()
        solvent = InventoryMaterial.objects.filter(category="SOLVENT").order_by("created_at").first()
        inks = list(InventoryMaterial.objects.filter(category="INK").order_by("created_at")[:2])
        if film is None or adhesive is None or solvent is None or len(inks) < 2:
            raise CommandError("Missing seed materials. Need FILM_VARIANT, ADHESIVE, SOLVENT, and at least two INK materials.")

        cyan = inks[0]
        magenta = inks[1]
        user = User.objects.filter(is_superuser=True).first() or User.objects.order_by("date_joined").first()
        now = timezone.now()
        shift_codes = ["A", "B", "C"]

        created_exec = 0
        created_scrap = 0
        created_downtime = 0
        touched_requirements = 0
        remix_rows = 0

        for idx, job in enumerate(jobs):
            shift_code = shift_codes[idx % len(shift_codes)]
            shift_date = (now - timezone.timedelta(days=idx % 2)).date()

            exec_qty = self._q(Decimal("120") + Decimal(idx * 11))
            scrap_qty = self._q(Decimal("3.2") + Decimal(idx % 4))

            if apply:
                JobExecutionLog.objects.create(
                    production_job=job,
                    quantity=exec_qty,
                    uom="KG",
                    shift_code=shift_code,
                    shift_date=shift_date,
                    logged_by=user,
                )
            created_exec += 1

            if idx % 2 == 0:
                if apply:
                    ScrapLog.objects.create(
                        production_job=job,
                        quantity=scrap_qty,
                        uom="KG",
                        reason="TRIM",
                        notes="Controlled telemetry seed scrap.",
                        shift_code=shift_code,
                        shift_date=shift_date,
                        logged_by=user,
                    )
                created_scrap += 1

            if idx % 3 == 0:
                start_dt = now - timezone.timedelta(hours=2 + idx)
                end_dt = start_dt + timezone.timedelta(minutes=20 + (idx * 3))
                if apply:
                    DowntimeLog.objects.create(
                        production_job=job,
                        start_time=start_dt,
                        end_time=end_dt,
                        reason="MAINTENANCE",
                        notes="Controlled telemetry seed downtime.",
                        shift_code=shift_code,
                        shift_date=shift_date,
                        logged_by=user,
                    )
                created_downtime += 1

            base_film_theoretical = self._q(Decimal("72") + Decimal(idx * 2))
            film_required = self._q(base_film_theoretical * Decimal("1.06"))
            film_planned = self._q(film_required * Decimal("1.03"))
            film_issued = self._q(film_planned + Decimal("1.8"))
            film_returned = self._q(Decimal("2.4") + Decimal((idx % 3) * Decimal("0.3")))
            film_consumed = self._q(film_issued - film_returned)
            film_scrap = self._q(Decimal("0.8") + Decimal((idx % 2) * Decimal("0.2")))

            payload_film = {
                "theoretical_qty": base_film_theoretical,
                "required_qty": film_required,
                "planned_issue_qty": film_planned,
                "actual_issued_qty": film_issued,
                "actual_returned_qty": film_returned,
                "actual_scrap_qty": film_scrap,
                "consumed_qty": film_consumed,
                "variance_qty": self._q(film_consumed - base_film_theoretical),
            }

            adhesive_theoretical = self._q(Decimal("6.5") + Decimal(idx) * Decimal("0.2"))
            adhesive_planned = self._q(adhesive_theoretical * Decimal("1.04"))
            adhesive_issued = self._q(adhesive_planned + Decimal("0.3"))
            adhesive_returned = self._q(Decimal("0.35"))
            adhesive_consumed = self._q(adhesive_issued - adhesive_returned)
            payload_adhesive = {
                "theoretical_qty": adhesive_theoretical,
                "required_qty": self._q(adhesive_theoretical * Decimal("1.03")),
                "planned_issue_qty": adhesive_planned,
                "actual_issued_qty": adhesive_issued,
                "actual_returned_qty": adhesive_returned,
                "actual_scrap_qty": self._q(Decimal("0.12")),
                "consumed_qty": adhesive_consumed,
                "variance_qty": self._q(adhesive_consumed - adhesive_theoretical),
            }

            solvent_theoretical = self._q(Decimal("2.4") + Decimal(idx) * Decimal("0.08"))
            solvent_planned = self._q(solvent_theoretical * Decimal("1.05"))
            solvent_issued = self._q(solvent_planned + Decimal("0.15"))
            solvent_returned = self._q(Decimal("0.22"))
            solvent_consumed = self._q(solvent_issued - solvent_returned)
            payload_solvent = {
                "theoretical_qty": solvent_theoretical,
                "required_qty": self._q(solvent_theoretical * Decimal("1.02")),
                "planned_issue_qty": solvent_planned,
                "actual_issued_qty": solvent_issued,
                "actual_returned_qty": solvent_returned,
                "actual_scrap_qty": self._q(Decimal("0.07")),
                "consumed_qty": solvent_consumed,
                "variance_qty": self._q(solvent_consumed - solvent_theoretical),
            }

            cyan_theoretical = self._q(Decimal("1.35") + Decimal(idx) * Decimal("0.09"))
            cyan_planned = self._q(cyan_theoretical * Decimal("1.08"))
            cyan_issued = self._q(cyan_planned + Decimal("0.22"))
            cyan_returned = self._q(Decimal("0.28"))
            cyan_consumed = self._q(cyan_issued - cyan_returned)
            payload_cyan = {
                "theoretical_qty": cyan_theoretical,
                "required_qty": self._q(cyan_theoretical * Decimal("1.04")),
                "planned_issue_qty": cyan_planned,
                "actual_issued_qty": cyan_issued,
                "actual_returned_qty": cyan_returned,
                "actual_scrap_qty": self._q(Decimal("0.05")),
                "consumed_qty": cyan_consumed,
                "variance_qty": self._q(cyan_consumed - cyan_theoretical),
            }

            mag_theoretical = self._q(Decimal("1.15") + Decimal(idx) * Decimal("0.07"))
            mag_planned = self._q(mag_theoretical * Decimal("1.07"))
            mag_issued = self._q(mag_planned + Decimal("0.19"))
            mag_returned = self._q(Decimal("0.18"))
            mag_consumed = self._q(mag_issued - mag_returned)
            payload_mag = {
                "theoretical_qty": mag_theoretical,
                "required_qty": self._q(mag_theoretical * Decimal("1.03")),
                "planned_issue_qty": mag_planned,
                "actual_issued_qty": mag_issued,
                "actual_returned_qty": mag_returned,
                "actual_scrap_qty": self._q(Decimal("0.03")),
                "consumed_qty": mag_consumed,
                "variance_qty": self._q(mag_consumed - mag_theoretical),
            }

            req_film = self._upsert_req(job=job, material=film, payload=payload_film, apply=apply)
            req_adh = self._upsert_req(job=job, material=adhesive, payload=payload_adhesive, apply=apply)
            req_sol = self._upsert_req(job=job, material=solvent, payload=payload_solvent, apply=apply)
            req_cyan = self._upsert_req(job=job, material=cyan, payload=payload_cyan, apply=apply)
            req_mag = self._upsert_req(job=job, material=magenta, payload=payload_mag, apply=apply)

            touched_requirements += 5

            if idx == 0:
                if apply and req_cyan and req_mag:
                    # Ensure one explicit remix-return case in ledger.
                    req_cyan.actual_returned_qty = self._q(Decimal("1.2000"))
                    req_cyan.consumed_qty = self._q(req_cyan.actual_issued_qty - req_cyan.actual_returned_qty)
                    req_cyan.variance_qty = self._q(req_cyan.consumed_qty - req_cyan.theoretical_qty)
                    req_cyan.save(update_fields=["actual_returned_qty", "consumed_qty", "variance_qty", "updated_at"])

                    InkBlendTransaction.objects.filter(
                        production_job=job,
                        source_requirement=req_cyan,
                    ).delete()
                    InkBlendTransaction.objects.create(
                        production_job=job,
                        process_step=getattr(req_cyan, "process_step", None),
                        source_requirement=req_cyan,
                        source_material=cyan,
                        target_material=magenta,
                        return_mode="REMIXED_RETURN",
                        returned_qty_kg=Decimal("1.2000"),
                        created_by=user,
                    )
                remix_rows = 1

        # Also tag existing backfilled execution logs so shift coverage rises quickly.
        untagged_logs = JobExecutionLog.objects.filter(shift_code="").order_by("logged_at")
        for idx, row in enumerate(untagged_logs):
            if apply:
                code = shift_codes[idx % len(shift_codes)]
                row.shift_code = code
                row.shift_date = (row.logged_at or now).date()
                row.save(update_fields=["shift_code", "shift_date"])

        def report_snapshot():
            tabs = ["production", "oee", "scrap", "material-variance", "ink-intelligence", "shift-performance"]
            out = {}
            for t in tabs:
                payload = ReportService.get_report_tab(t, {"date_from": "2026-03-01", "date_to": "2026-03-04"})
                out[t] = {
                    "rows": len(payload.get("rows") or []),
                    "series": len(payload.get("series") or []),
                    "coverage": payload.get("coverage") or {},
                    "warnings": payload.get("warnings") or [],
                }
            return out

        summary = {
            "mode": mode,
            "jobs_touched": len(jobs),
            "execution_logs_created": created_exec,
            "scrap_logs_created": created_scrap,
            "downtime_logs_created": created_downtime,
            "material_requirements_touched": touched_requirements,
            "ink_remix_rows_created": remix_rows,
            "untagged_execution_logs_found": untagged_logs.count(),
            "report_snapshot": report_snapshot(),
        }
        self.stdout.write(self.style.SUCCESS(str(summary)))

