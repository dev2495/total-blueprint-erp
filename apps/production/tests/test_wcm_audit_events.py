from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.factory.models import Machine, Plant, Process, WorkCenter
from apps.inventory.models import InventoryBulk, InventoryLocation
from apps.materials.models import GranuleQualityCode, InventoryMaterial
from apps.production.models import (
    JobExecutionLog,
    JobMaterialRequirement,
    ProductionJob,
    ProductionWcmAuditEvent,
    WorkCenterAssignment,
)
from apps.production.services.services_execution import ExecutionService
from apps.production.views import ExecutionViewSet
from apps.production.views_wc import JobAllocationViewSet, _validate_wcm_material_confirmations
from apps.production.services.job_services import WCManagerService
from apps.analytics.services import ReportingService
from apps.routing.models import RoutingRule
from apps.templates.models import TemplateBlueprint, TemplateProcessStep, TemplateProcessStepMaterial
from apps.users.models import Role, User


class WcmAuditEventTests(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.role = Role.objects.create(code="WORK_CENTER_MANAGER", name="WCM", default_permissions=["production.view"])
        self.user = User.objects.create_user(username="wcm-audit", password="pass12345", role=self.role)
        self.plant = Plant.objects.create(name="Audit Plant", code="WCM-AUD")
        self.location = InventoryLocation.objects.create(
            plant=self.plant,
            code="WCM-RM",
            name="WCM RM",
            type="RM",
        )
        self.work_center = WorkCenter.objects.create(
            plant=self.plant,
            name="Audit WC",
            code="WCM_AUDIT_WC",
            default_wip_location=self.location,
        )
        self.machine = Machine.objects.create(work_center=self.work_center, name="Audit Machine", code="WCM_AUDIT_MACHINE")
        self.process = Process.objects.create(code="EXT_AUDIT", name="Extrusion Audit")
        self.route = RoutingRule.objects.create(name="Audit Route", ordered_processes=["EXT_AUDIT"])
        self.template = TemplateBlueprint.objects.create(name="Audit Roll", fg_type="ROLL", status="DRAFT")
        self.step = TemplateProcessStep.objects.create(template=self.template, sequence_number=1, process=self.process)
        self.job = ProductionJob.objects.create(
            job_number="WCM-AUDIT-JOB",
            template=self.template,
            routing_rule=self.route,
            current_step_index=0,
            current_process=self.process,
            process=self.process,
            work_center=self.work_center,
            from_location=self.location,
            quantity=Decimal("100.00"),
            remaining_qty=Decimal("100.0000"),
        )
        self.assignment = WorkCenterAssignment.objects.create(production_job=self.job, work_center=self.work_center)
        self.granule = InventoryMaterial.objects.create(code="GR-WCM", name="WCM Granule", category="GRANULE", base_uom="KG")
        self.other_granule = InventoryMaterial.objects.create(code="GR-OTHER", name="Other Granule", category="GRANULE", base_uom="KG")
        self.code_a = GranuleQualityCode.objects.create(granule=self.granule, code="GA", status="ACTIVE")
        self.code_b = GranuleQualityCode.objects.create(granule=self.other_granule, code="GB", status="ACTIVE")
        InventoryBulk.objects.create(material=self.granule, granule_code=self.code_a, plant=self.plant, location=self.location, qty_kg=Decimal("80"))
        InventoryBulk.objects.create(material=self.other_granule, granule_code=self.code_b, plant=self.plant, location=self.location, qty_kg=Decimal("80"))
        self.requirement = JobMaterialRequirement.objects.create(
            production_job=self.job,
            material=self.granule,
            process_step=self.step,
            required_qty=Decimal("10.0000"),
            theoretical_qty=Decimal("10.0000"),
            planned_issue_qty=Decimal("10.0000"),
            uom="KG",
        )

    def _confirmation(self, code_id=None, issued="10.0000"):
        return [{
            "requirement_id": str(self.requirement.id),
            "material_id": str(self.granule.id),
            "actual_issued_qty": issued,
            "actual_returned_qty": 0,
            "actual_scrap_qty": 0,
            "is_estimated": False,
            "granule_code_allocations": [{
                "granule_code_id": str(code_id or self.code_a.id),
                "qty_kg": issued,
            }],
        }]

    def test_granule_code_split_must_use_code_for_that_granule(self):
        with self.assertRaisesMessage(ValueError, "Selected code is not available"):
            _validate_wcm_material_confirmations(self.job, self._confirmation(code_id=self.code_b.id))

    def test_granule_code_split_total_must_match_issued_qty(self):
        bad = self._confirmation(issued="10.0000")
        bad[0]["granule_code_allocations"][0]["qty_kg"] = "7.0000"
        with self.assertRaisesMessage(ValueError, "must total"):
            _validate_wcm_material_confirmations(self.job, bad)

    def test_assign_machine_writes_wcm_audit_event(self):
        view = JobAllocationViewSet.as_view({"post": "assign_machine"})

        def fake_assign_machine(*args, **kwargs):
            self.assignment.assigned_machine = self.machine
            self.assignment.status = "ASSIGNED"
            self.assignment.save(update_fields=["assigned_machine", "status"])
            return self.assignment

        request = self.factory.post(
            "/api/production/wc-allocation/assign-machine/",
            {"assignment_id": str(self.assignment.id), "machine_id": str(self.machine.id)},
            format="json",
        )
        force_authenticate(request, user=self.user)
        with patch("apps.production.views_wc.WCManagerService.assign_machine", side_effect=fake_assign_machine):
            response = view(request)

        self.assertEqual(response.status_code, 200)
        event = ProductionWcmAuditEvent.objects.get(action="ASSIGN_MACHINE")
        self.assertEqual(event.production_job, self.job)
        self.assertEqual(event.work_center, self.work_center)
        self.assertEqual(event.actor, self.user)
        self.assertEqual(event.payload["after_machine"], "Audit Machine")

    def test_ready_writes_material_issue_and_release_audit_events(self):
        view = JobAllocationViewSet.as_view({"post": "mark_ready"})
        self.assignment.assigned_machine = self.machine
        self.assignment.status = "ASSIGNED"
        self.assignment.save(update_fields=["assigned_machine", "status"])
        confirmations = self._confirmation()

        def fake_mark_ready(*args, **kwargs):
            self.assignment.status = "EXECUTION_READY"
            self.assignment.save(update_fields=["status"])
            self.job.current_step_material_confirmations = kwargs.get("material_confirmations") or []
            self.job.save(update_fields=["current_step_material_confirmations"])
            return self.assignment

        request = self.factory.post(
            "/api/production/wc-allocation/ready/",
            {"assignment_id": str(self.assignment.id), "material_confirmations": confirmations},
            format="json",
        )
        force_authenticate(request, user=self.user)
        with patch("apps.production.views_wc.WCManagerService.mark_execution_ready", side_effect=fake_mark_ready):
            response = view(request)

        self.assertEqual(response.status_code, 200)
        actions = list(ProductionWcmAuditEvent.objects.order_by("occurred_at").values_list("action", flat=True))
        self.assertEqual(actions, ["MATERIAL_ISSUE", "RELEASE_TO_MACHINE"])
        self.assertEqual(ProductionWcmAuditEvent.objects.get(action="MATERIAL_ISSUE").payload["material_confirmations"], confirmations)

    def test_release_to_machine_rejects_roll_step_without_allocated_roll(self):
        self.process.input_form = "ROLL"
        self.process.output_form = "BULK"
        self.process.roll_behavior = "NONE"
        self.process.save(update_fields=["input_form", "output_form", "roll_behavior"])
        self.job.input_form = "ROLL"
        self.job.output_form = "BULK"
        self.job.save(update_fields=["input_form", "output_form"])
        self.assignment.assigned_machine = self.machine
        self.assignment.status = "WC_READY"
        self.assignment.save(update_fields=["assigned_machine", "status"])
        view = JobAllocationViewSet.as_view({"post": "mark_ready"})

        request = self.factory.post(
            "/api/production/wc-allocation/ready/",
            {"assignment_id": str(self.assignment.id), "material_confirmations": self._confirmation()},
            format="json",
        )
        force_authenticate(request, user=self.user)
        response = view(request)

        self.assertEqual(response.status_code, 400)
        self.assertIn("requirements not satisfied", str(response.data))
        self.assignment.refresh_from_db()
        self.job.refresh_from_db()
        self.assertEqual(self.assignment.status, "WC_READY")
        self.assertNotEqual(self.job.job_state, "RELEASED")

    def test_sync_assignment_demotes_unstarted_stale_released_job_without_rolls(self):
        self.process.input_form = "ROLL"
        self.process.output_form = "BULK"
        self.process.roll_behavior = "NONE"
        self.process.save(update_fields=["input_form", "output_form", "roll_behavior"])
        self.job.input_form = "ROLL"
        self.job.output_form = "BULK"
        self.job.machine = self.machine
        self.job.status = "ASSIGNED"
        self.job.job_state = "RELEASED"
        self.job.save(update_fields=["input_form", "output_form", "machine", "status", "job_state"])
        self.assignment.assigned_machine = self.machine
        self.assignment.status = "EXECUTION_READY"
        self.assignment.save(update_fields=["assigned_machine", "status"])

        WCManagerService._sync_assignment_status(self.assignment)
        self.assignment.save(update_fields=["status"])

        self.assignment.refresh_from_db()
        self.job.refresh_from_db()
        self.assertEqual(self.assignment.status, "WC_READY")
        self.assertEqual(self.job.job_state, "PLANNED")
        self.assertEqual(self.job.status, "QUEUED")

    def test_current_step_policy_uses_template_requirement_fallback_and_updates_issue_plan(self):
        TemplateProcessStepMaterial.objects.create(
            template_step=self.step,
            category_code="GRANULE",
            consumption_basis="FIXED_KG",
            value=Decimal("10.0000"),
            issue_policy_mode="PERCENT_OVER_THEORY",
            issue_policy_value=Decimal("10.0000"),
        )
        view = ExecutionViewSet.as_view({"get": "current_step_material_policy", "post": "current_step_material_policy"})

        request = self.factory.get(f"/api/production/flow-engine/{self.job.id}/current-step-material-policy/")
        force_authenticate(request, user=self.user)
        response = view(request, pk=str(self.job.id))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["items"]), 1)
        item = response.data["items"][0]
        self.assertEqual(item["material_name"], "WCM Granule")
        self.assertEqual(item["template_issue_policy_mode"], "PERCENT_OVER_THEORY")
        self.assertEqual(item["planned_issue_qty"], 11.0)

        request = self.factory.post(
            f"/api/production/flow-engine/{self.job.id}/current-step-material-policy/",
            {
                "overrides": [
                    {
                        "policy_key": item["policy_key"],
                        "issue_policy_mode": "FIXED_EXTRA_KG",
                        "issue_policy_value": 5,
                        "reason": "extruder purge loss",
                    }
                ]
            },
            format="json",
        )
        force_authenticate(request, user=self.user)
        response = view(request, pk=str(self.job.id))

        self.assertEqual(response.status_code, 200)
        updated = response.data["items"][0]
        self.assertEqual(updated["policy_source"], "WCM_OVERRIDE")
        self.assertEqual(updated["effective_issue_policy_mode"], "FIXED_EXTRA_KG")
        self.assertEqual(updated["planned_issue_qty"], 15.0)
        self.requirement.refresh_from_db()
        self.assertEqual(self.requirement.planned_issue_qty, Decimal("15.0000"))
        preview = ExecutionService.get_bulk_consumption_preview(self.job)
        self.assertEqual(preview[0]["planned_issue_qty_kg"], 15.0)
        event = ProductionWcmAuditEvent.objects.get(action="MATERIAL_POLICY_OVERRIDE")
        self.assertEqual(event.actor, self.user)
        self.assertEqual(event.work_center, self.work_center)
        self.assertIn("WCM Granule", event.reason)
        self.assertIn("extruder purge loss", event.reason)
        self.assertEqual(event.payload["job_number"], "WCM-AUDIT-JOB")
        self.assertEqual(event.payload["step_sequence"], 1)
        self.assertEqual(event.payload["changed_rows"][0]["material_name"], "WCM Granule")
        self.assertEqual(event.payload["changed_rows"][0]["before"]["mode"], "PERCENT_OVER_THEORY")
        self.assertEqual(event.payload["changed_rows"][0]["after"]["mode"], "FIXED_EXTRA_KG")
        self.assertEqual(event.payload["changed_rows"][0]["after"]["planned_issue_qty"], 15.0)

        rows = ReportingService.get_operational_logs(filter_type="production", limit=20)
        audit_row = next((row for row in rows if row.get("event_type") == "MATERIAL_POLICY_OVERRIDE"), None)
        self.assertIsNotNone(audit_row)
        self.assertEqual(audit_row["reference"], "WCM-AUDIT-JOB")
        self.assertIn("WCM Granule", audit_row["desc"])

    def test_current_step_policy_override_requires_reason(self):
        TemplateProcessStepMaterial.objects.create(
            template_step=self.step,
            category_code="GRANULE",
            consumption_basis="FIXED_KG",
            value=Decimal("10.0000"),
            issue_policy_mode="PERCENT_OVER_THEORY",
            issue_policy_value=Decimal("10.0000"),
        )
        view = ExecutionViewSet.as_view({"get": "current_step_material_policy", "post": "current_step_material_policy"})

        request = self.factory.get(f"/api/production/flow-engine/{self.job.id}/current-step-material-policy/")
        force_authenticate(request, user=self.user)
        response = view(request, pk=str(self.job.id))
        item = response.data["items"][0]

        request = self.factory.post(
            f"/api/production/flow-engine/{self.job.id}/current-step-material-policy/",
            {
                "overrides": [
                    {
                        "policy_key": item["policy_key"],
                        "issue_policy_mode": "MINIMUM_ISSUE_KG",
                        "issue_policy_value": 20,
                        "reason": "",
                    }
                ]
            },
            format="json",
        )
        force_authenticate(request, user=self.user)
        response = view(request, pk=str(self.job.id))

        self.assertEqual(response.status_code, 400)
        self.assertIn("Reason is required", response.data["error"])
        self.assertFalse(ProductionWcmAuditEvent.objects.filter(action="MATERIAL_POLICY_OVERRIDE").exists())

    def test_cancel_is_blocked_after_machine_execution_starts(self):
        view = JobAllocationViewSet.as_view({"post": "close_job"})
        self.assignment.assigned_machine = self.machine
        self.assignment.status = "EXECUTION_READY"
        self.assignment.save(update_fields=["assigned_machine", "status"])
        self.job.machine = self.machine
        self.job.status = "RUNNING"
        self.job.job_state = "EXECUTING"
        self.job.save(update_fields=["machine", "status", "job_state"])
        JobExecutionLog.objects.create(production_job=self.job, quantity=Decimal("5.0000"), uom="KG", logged_by=self.user)

        request = self.factory.post(
            "/api/production/wc-allocation/close-job/",
            {"assignment_id": str(self.assignment.id), "mode": "CANCEL", "reason": "wrong setup"},
            format="json",
        )
        force_authenticate(request, user=self.user)
        response = view(request)

        self.assertEqual(response.status_code, 400)
        self.assertIn("Cancel is only allowed before machine start", str(response.data))
        self.job.refresh_from_db()
        self.assertEqual(self.job.job_state, "EXECUTING")

    def test_short_close_requires_started_machine_job(self):
        view = JobAllocationViewSet.as_view({"post": "close_job"})
        self.assignment.assigned_machine = self.machine
        self.assignment.status = "EXECUTION_READY"
        self.assignment.save(update_fields=["assigned_machine", "status"])
        self.job.machine = self.machine
        self.job.status = "ASSIGNED"
        self.job.job_state = "RELEASED"
        self.job.save(update_fields=["machine", "status", "job_state"])

        request = self.factory.post(
            "/api/production/wc-allocation/close-job/",
            {"assignment_id": str(self.assignment.id), "mode": "SHORT_CLOSE", "reason": "partial output"},
            format="json",
        )
        force_authenticate(request, user=self.user)
        response = view(request)

        self.assertEqual(response.status_code, 400)
        self.assertIn("Short close is only allowed after machine start", str(response.data))
        self.job.refresh_from_db()
        self.assertEqual(self.job.job_state, "RELEASED")
