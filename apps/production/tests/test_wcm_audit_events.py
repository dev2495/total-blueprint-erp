from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.factory.models import Machine, Plant, Process, WorkCenter
from apps.inventory.models import InventoryBulk, InventoryLocation
from apps.materials.models import GranuleQualityCode, InventoryMaterial
from apps.production.models import (
    JobMaterialRequirement,
    ProductionJob,
    ProductionWcmAuditEvent,
    WorkCenterAssignment,
)
from apps.production.views_wc import JobAllocationViewSet, _validate_wcm_material_confirmations
from apps.routing.models import RoutingRule
from apps.templates.models import TemplateBlueprint, TemplateProcessStep
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
