from datetime import date, datetime, timedelta
from unittest.mock import patch
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone

from apps.factory.models import Machine, Plant, Process, WorkCenter
from apps.inventory.models import InventoryLocation
from apps.maintenance.models import MachineFault, MaintenanceEditLog, MaintenanceJob, MaintenanceSchedule
from apps.maintenance.services import MaintenanceService
from apps.production.models import DowntimeLog, ProductionJob
from apps.routing.models import RoutingRule
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.templates.models import TemplateBlueprint, TemplateProcessStep
from apps.users.models import Role, User


class MaintenanceFixture(TestCase):
    def setUp(self):
        self.plant = Plant.objects.create(name="Maint Plant", code="MAINT-PLANT")
        self.location = InventoryLocation.objects.create(plant=self.plant, code="MAINT-RM", name="Maint RM", type="RM")
        self.work_center = WorkCenter.objects.create(plant=self.plant, name="Maint WC", code="MAINT_WC", default_wip_location=self.location)
        self.machine = Machine.objects.create(work_center=self.work_center, name="Mamata", code="MC-04")
        role, _ = Role.objects.get_or_create(code="MAINTENANCE_SUPERVISOR", defaults={"name": "Maintenance Supervisor"})
        self.supervisor = User.objects.create_user(username="maint-sup", password="x", role=role)
        self.tech = User.objects.create_user(username="maint-tech", password="x")


class ScheduleRulesTests(MaintenanceFixture):
    def test_fixed_calendar_does_not_drift_after_late_completion(self):
        schedule = MaintenanceSchedule.objects.create(
            machine=self.machine, name="Weekly lube", interval_type="WEEKLY", interval_value=1,
            due_rule="FIXED_CALENDAR", anchor_date=date(2026, 10, 5), assigned_role="MAINTENANCE_TECH",
        )
        MaintenanceService.initialize_schedule(schedule)
        self.assertEqual(schedule.next_due_date, date(2026, 10, 5))
        stats = MaintenanceService.generate_due_jobs(today=date(2026, 10, 14))
        self.assertEqual(stats["created"], 1)
        job = MaintenanceJob.objects.get(schedule=schedule)
        self.assertEqual(job.planned_date, date(2026, 10, 5))  # the missed date stays visible
        # A second run never duplicates the open job.
        self.assertEqual(MaintenanceService.generate_due_jobs(today=date(2026, 10, 14))["created"], 0)
        # Completed late on 14 Oct: next due is the next anchor step after 14 Oct, i.e. 19 Oct, not 21 Oct.
        # The completion clock is pinned to 14 Oct so the check does not depend on the day it runs.
        late = timezone.make_aware(datetime(2026, 10, 14, 15, 0))
        with patch("django.utils.timezone.now", return_value=late):
            MaintenanceService.complete_job(job, outcome="COMPLETED", user=self.tech)
        schedule.refresh_from_db()
        self.assertEqual(schedule.next_due_date, date(2026, 10, 19))
        job.refresh_from_db()
        self.assertEqual(job.planned_date, date(2026, 10, 5))
        self.assertIsNotNone(job.completed_at)
        self.assertEqual(job.status, "DONE")

    def test_after_last_service_counts_from_completion(self):
        schedule = MaintenanceSchedule.objects.create(
            machine=self.machine, name="Quarterly service", interval_type="MONTHLY", interval_value=3,
            due_rule="AFTER_LAST_SERVICE", anchor_date=date(2026, 10, 1), assigned_role="MAINTENANCE_TECH", is_critical=True,
        )
        MaintenanceService.initialize_schedule(schedule)
        self.assertTrue(schedule.requires_verification)
        MaintenanceService.generate_due_jobs(today=date(2026, 10, 12))
        job = MaintenanceJob.objects.get(schedule=schedule)
        MaintenanceService.complete_job(job, outcome="COMPLETED", user=self.tech, time_minutes=135, spares_used=[{"item": "Adhesive filter", "qty": 1, "cost": 1250}])
        job.refresh_from_db()
        self.assertEqual(job.status, "AWAITING_VERIFICATION")
        self.assertEqual(job.spares_cost, Decimal("1250.00"))
        schedule.refresh_from_db()
        completed_on = timezone.localtime(job.completed_at).date()
        self.assertEqual(schedule.next_due_date, date(completed_on.year + (1 if completed_on.month > 9 else 0), (completed_on.month + 3 - 1) % 12 + 1, completed_on.day))
        MaintenanceService.verify_job(job, user=self.supervisor, accepted=True, note="Checked nip rollers")
        job.refresh_from_db()
        self.assertEqual(job.status, "VERIFIED")
        self.assertTrue(MaintenanceEditLog.objects.filter(object_type="JOB", object_id=job.id, action="VERIFIED").exists())

    def test_unable_needs_reason_and_stays_open(self):
        schedule = MaintenanceSchedule.objects.create(machine=self.machine, name="Daily check", interval_type="DAILY", interval_value=1, due_rule="FIXED_CALENDAR", anchor_date=date(2026, 10, 14))
        MaintenanceService.initialize_schedule(schedule)
        MaintenanceService.generate_due_jobs(today=date(2026, 10, 14))
        job = MaintenanceJob.objects.get(schedule=schedule)
        with self.assertRaises(ValueError):
            MaintenanceService.complete_job(job, outcome="UNABLE", user=self.tech)
        MaintenanceService.complete_job(job, outcome="UNABLE", user=self.tech, outcome_reason="Machine running a rush order")
        job.refresh_from_db()
        self.assertEqual(job.status, "UNABLE")
        self.assertTrue(job.is_open)
        board = MaintenanceService.board(plant_id=self.plant.id, today=date(2026, 10, 15))
        self.assertEqual(board["counts"]["overdue"], 1)

    def test_issue_found_opens_a_fault(self):
        schedule = MaintenanceSchedule.objects.create(machine=self.machine, name="Noise check", interval_type="DAILY", interval_value=1, due_rule="FIXED_CALENDAR", anchor_date=date(2026, 10, 14))
        MaintenanceService.initialize_schedule(schedule)
        MaintenanceService.generate_due_jobs(today=date(2026, 10, 14))
        job = MaintenanceJob.objects.get(schedule=schedule)
        MaintenanceService.complete_job(job, outcome="ISSUE", user=self.tech, outcome_reason="Knocking from the gearbox", fault_severity="HIGH")
        fault = MachineFault.objects.get(machine=self.machine)
        self.assertEqual(fault.source_job, job)
        self.assertEqual(fault.severity, "HIGH")
        self.assertEqual(fault.status, "OPEN")
        fault, repair = MaintenanceService.assign_fault(fault, assigned_to=self.tech, user=self.supervisor)
        self.assertEqual(fault.status, "ASSIGNED")
        self.assertIsNotNone(repair)
        self.assertEqual(repair.kind, "TECH_SERVICE")
        self.assertTrue(repair.requires_verification)


class FaultPausesRunningJobTests(MaintenanceFixture):
    def setUp(self):
        super().setUp()
        self.process = Process.objects.create(code="MAINT_POUCH", name="Pouching", input_form="ROLL", output_form="BULK", roll_behavior="NONE")
        self.route = RoutingRule.objects.create(name="Maint Route", ordered_processes=[self.process.code])
        self.template = TemplateBlueprint.objects.create(name="Maint Template", fg_type="POUCH", status="LIVE")
        TemplateProcessStep.objects.create(template=self.template, sequence_number=1, process=self.process)
        order = SalesOrder.objects.create(customer_name="Maint Customer")
        item = SalesOrderItem.objects.create(sales_order=order, template=self.template, qty_value=10, qty_uom="PCS", unit_price=1, bom_snapshot={})
        self.job = ProductionJob.objects.create(
            job_number="JOB-MAINT-RUN", template=self.template, sales_order_item=item, routing_rule=self.route, current_step_index=0,
            current_process=self.process, process=self.process, work_center=self.work_center, from_location=self.location,
            quantity=Decimal("10"), uom="PCS", remaining_qty=Decimal("10"), machine=self.machine, status="RUNNING", job_state="EXECUTING", start_date=timezone.now(),
        )

    def test_stopping_fault_pauses_the_job_as_breakdown_and_marks_machine_down(self):
        fault = MaintenanceService.report_fault(machine=self.machine, title="Heater failed", severity="CRITICAL", machine_running=False, user=self.tech)
        self.job.refresh_from_db()
        self.assertEqual(self.job.job_state, "PAUSED")
        log = DowntimeLog.objects.get(production_job=self.job)
        self.assertEqual(log.reason, "BREAKDOWN")
        self.assertEqual(log.source, "PAUSE")
        self.assertEqual(fault.downtime_log, log)
        self.machine.refresh_from_db()
        self.assertEqual(self.machine.status, "DOWN")
        MaintenanceService.set_fault_status(fault, status="RESOLVED", user=self.tech, note="Heater replaced")
        self.machine.refresh_from_db()
        self.assertEqual(self.machine.status, "ACTIVE")
        history = MaintenanceService.machine_history(self.machine)
        kinds = {row["kind"] for row in history}
        self.assertEqual(kinds, {"FAULT", "DOWNTIME"})

    def test_running_fault_links_job_without_pausing(self):
        MaintenanceService.report_fault(machine=self.machine, title="Minor leak", severity="LOW", machine_running=True, user=self.tech)
        self.job.refresh_from_db()
        self.assertEqual(self.job.job_state, "EXECUTING")
        self.assertFalse(DowntimeLog.objects.filter(production_job=self.job).exists())


from django.test import override_settings
from rest_framework.test import APIClient


@override_settings(STRICT_RBAC=True)
class MaintenanceRbacTests(MaintenanceFixture):
    """Strict RBAC as in production: each role reaches exactly its maintenance and scan surfaces."""

    def _user(self, role_code):
        role, _ = Role.objects.get_or_create(code=role_code, defaults={"name": role_code.title()})
        return User.objects.create_user(username=f"rbac-{role_code.lower()}", password="x", role=role)

    def _client(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def test_watchman_is_refused_everywhere(self):
        client = self._client(self._user("WATCHMAN"))
        for url in ["/api/maintenance/board/", "/api/maintenance/jobs/", f"/api/maintenance/scan/machine/{self.machine.code}/",
                    f"/api/maintenance/scan/location/{self.location.code}/", "/api/maintenance/qr/targets/"]:
            self.assertEqual(client.get(url).status_code, 403, url)

    def test_store_reads_the_location_card_but_not_maintenance(self):
        client = self._client(self._user("STORE"))
        self.assertEqual(client.get(f"/api/maintenance/scan/location/{self.location.code}/").status_code, 200)
        self.assertEqual(client.get("/api/maintenance/board/").status_code, 403)

    def test_technician_records_work_and_reports_faults(self):
        client = self._client(self._user("MAINTENANCE_TECH"))
        self.assertEqual(client.get("/api/maintenance/board/").status_code, 200)
        self.assertEqual(client.get(f"/api/maintenance/scan/machine/{self.machine.code}/").status_code, 200)
        response = client.post("/api/maintenance/faults/", {"machine": str(self.machine.id), "title": "Belt slipping"}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        # Technicians do not manage schedules.
        response = client.post("/api/maintenance/schedules/", {"machine": str(self.machine.id), "name": "X", "anchor_date": "2026-10-15"}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_supervisor_manages_schedules(self):
        client = self._client(self.supervisor)
        response = client.post("/api/maintenance/schedules/", {
            "machine": str(self.machine.id), "name": "Daily check", "anchor_date": "2026-10-15",
            "checklist": [{"code": "OIL", "label": "Oil level", "kind": "OK_ISSUE"}],
        }, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.data["next_due_date"], "2026-10-15")
        self.assertEqual(client.post("/api/maintenance/schedules/generate-due/", {}, format="json").status_code, 200)

    def test_machine_card_shows_maintenance_panels_only_with_permission(self):
        tech = self._client(self._user("MAINTENANCE_TECH"))
        self.assertIn("maintenance", tech.get(f"/api/maintenance/scan/machine/{self.machine.code}/").data)
        planner = self._client(self._user("PLANNER"))
        data = planner.get(f"/api/maintenance/scan/machine/{self.machine.code}/").data
        self.assertNotIn("maintenance", data)
        self.assertIn("report_30d", data)
