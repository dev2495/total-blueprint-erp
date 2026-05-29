from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.test import TestCase, override_settings

from apps.factory.models import Plant, Process
from apps.inventory.models import InventoryLocation
from apps.production.models import DowntimeLog, ProductionJob
from apps.production.services.shift_inference import infer_shift, shift_window_for
from apps.routing.models import RoutingRule
from apps.templates.models import TemplateBlueprint
from apps.users.models import CompanyProfile


@override_settings(TIME_ZONE="Asia/Kolkata", USE_TZ=True)
class ShiftInferenceTests(TestCase):
    def setUp(self):
        CompanyProfile.objects.update_or_create(
            id=1,
            defaults={
                "shift_boundaries": {
                    "A": ["08:00", "16:00"],
                    "B": ["16:00", "23:00"],
                    "C": ["23:00", "08:00"],
                }
            },
        )
        self.plant = Plant.objects.create(name="Shift Plant", code="SHIFT")
        self.wip = InventoryLocation.objects.create(
            plant=self.plant,
            code="SHIFT-WIP",
            name="Shift WIP",
            type="WIP",
        )
        self.process = Process.objects.create(
            code="SHIFT-PROC",
            name="Shift Process",
            input_form="ROLL",
            output_form="ROLL",
        )
        self.routing = RoutingRule.objects.create(
            name="Shift Route",
            ordered_processes=[self.process.code],
        )
        self.template = TemplateBlueprint.objects.create(
            name="Shift Template",
            fg_type="ROLL",
            status="DRAFT",
            routing_rule=self.routing,
        )
        self.job = ProductionJob.objects.create(
            job_number="JOB-SHIFT-001",
            origin="MTO",
            source_type="SALES",
            routing_rule=self.routing,
            template=self.template,
            current_step_index=0,
            current_process=self.process,
            process=self.process,
            from_location=self.wip,
            to_location=self.wip,
            input_form="ROLL",
            output_form="ROLL",
            quantity=Decimal("10.000"),
            remaining_qty=Decimal("10.000"),
            uom="KG",
            status="QUEUED",
            job_state="PLANNED",
        )

    def _dt(self, hour: int) -> datetime:
        return datetime(2026, 5, 26, hour, 0, tzinfo=ZoneInfo("Asia/Kolkata"))

    def test_company_profile_boundaries_drive_shift_inference(self):
        self.assertEqual(infer_shift(self._dt(8)), "A")
        self.assertEqual(infer_shift(self._dt(16)), "B")
        self.assertEqual(infer_shift(self._dt(23)), "C")
        self.assertEqual(infer_shift(self._dt(3)), "C")

    def test_cross_midnight_shift_window(self):
        window = shift_window_for(self._dt(3))
        self.assertEqual(window["shift_code"], "C")
        self.assertEqual(window["started_at"].date().isoformat(), "2026-05-25")
        self.assertEqual(window["ends_at"].date().isoformat(), "2026-05-26")

    def test_downtime_log_autostamps_shift_code_without_overwriting(self):
        log = DowntimeLog.objects.create(
            production_job=self.job,
            start_time=self._dt(3),
            reason="OTHER",
        )
        self.assertEqual(log.shift_code, "C")
        self.assertEqual(log.shift_date.isoformat(), "2026-05-26")

        log.shift_code = "MANUAL"
        log.save(update_fields=["shift_code"])
        log.refresh_from_db()
        self.assertEqual(log.shift_code, "MANUAL")
