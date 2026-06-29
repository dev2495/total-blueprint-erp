"""
Coverage for the WCM hardening surface added in this phase:

  - ScrapReason / DowntimeReason CRUD + parent/child taxonomy + serializer
  - read-only stalled-jobs query + endpoint
  - WCM queue-row enrichment (ink colors, cylinder + material readiness, timing)
  - WC machines payload live state (state / current_job_number / busy_until)
  - assign_machine busy-check -> HTTP 409 + work-center validation
"""

from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.artwork.models import Artwork
from apps.factory.models import Machine, Plant, Process, WorkCenter
from apps.factory.serializers import _resolve_machine_live_state
from apps.inventory.models import InventoryLocation
from apps.production.models import (
    DowntimeLog,
    DowntimeReason,
    JobExecutionLog,
    ProductionJob,
    ScrapReason,
    WorkCenterAssignment,
)
from apps.production.serializers import ScrapReasonSerializer
from apps.production.serializers import WorkCenterAssignmentSerializer
from apps.production.services.job_services import MachineBusyError, WCManagerService
from apps.production.services.queue_enrichment import build_queue_enrichment
from apps.production.services.stalled_jobs import get_stalled_jobs, is_job_stalled
from apps.production.views_reasons import (
    DowntimeReasonViewSet,
    ScrapReasonViewSet,
    stalled_jobs,
)
from apps.routing.models import RoutingRule
from apps.templates.models import TemplateBlueprint, TemplateProcessStep
from apps.tooling.models import Cylinder, CylinderSlotAssignment
from apps.users.models import Role, User


class _BaseWcmCase(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.role = Role.objects.create(code="OWNER", name="Owner", default_permissions=["production.manage"])
        self.user = User.objects.create_user(username="wcm-hardening", password="pass12345", role=self.role)
        self.user.is_owner = True
        self.user.save(update_fields=["is_owner"])

        self.plant = Plant.objects.create(name="Hard Plant", code="HARD-P")
        self.location = InventoryLocation.objects.create(plant=self.plant, code="HARD-RM", name="RM", type="RM")
        self.wc = WorkCenter.objects.create(
            plant=self.plant, name="Print WC", code="HARD_WC", default_wip_location=self.location
        )
        self.other_wc = WorkCenter.objects.create(
            plant=self.plant, name="Other WC", code="HARD_WC2", default_wip_location=self.location
        )
        self.machine = Machine.objects.create(work_center=self.wc, name="Press 1", code="HARD_M1")
        self.other_machine = Machine.objects.create(work_center=self.other_wc, name="Press 2", code="HARD_M2")
        self.process = Process.objects.create(code="PRINT_HARD", name="Printing", print_capable=True)
        self.route = RoutingRule.objects.create(name="Hard Route", ordered_processes=["PRINT_HARD"])
        self.template = TemplateBlueprint.objects.create(name="Hard Roll", fg_type="ROLL", status="DRAFT")
        TemplateProcessStep.objects.create(template=self.template, sequence_number=1, process=self.process)

    def _make_job(self, number, job_state="EXECUTING", machine=None, wc=None):
        return ProductionJob.objects.create(
            job_number=number,
            template=self.template,
            routing_rule=self.route,
            current_step_index=0,
            current_process=self.process,
            process=self.process,
            work_center=wc or self.wc,
            machine=machine,
            from_location=self.location,
            quantity=Decimal("100.00"),
            remaining_qty=Decimal("100.0000"),
            job_state=job_state,
        )


class ReasonCodeCrudTests(_BaseWcmCase):
    def _list(self, viewset_cls, params=None):
        request = self.factory.get("/api/production/reasons/", params or {})
        force_authenticate(request, user=self.user)
        return viewset_cls.as_view({"get": "list"})(request)

    def test_scrap_reason_serializer_contract_fields(self):
        parent = ScrapReason.objects.create(code="P1", label="Parent", sort_order=1)
        child = ScrapReason.objects.create(code="C1", label="Child", parent=parent, sort_order=2)
        data = ScrapReasonSerializer(child).data
        self.assertEqual(
            set(data.keys()),
            {"id", "code", "label", "parent_id", "parent_code", "is_active", "sort_order"},
        )
        self.assertEqual(str(data["parent_id"]), str(parent.id))
        self.assertEqual(data["parent_code"], "P1")

    def test_create_top_level_and_sub_code(self):
        request = self.factory.post(
            "/api/production/scrap-reasons/", {"code": "TOP", "label": "Top", "sort_order": 5}, format="json"
        )
        force_authenticate(request, user=self.user)
        resp = ScrapReasonViewSet.as_view({"post": "create"})(request)
        self.assertEqual(resp.status_code, 201, resp.data)
        top_id = resp.data["id"]

        request = self.factory.post(
            "/api/production/scrap-reasons/",
            {"code": "SUB", "label": "Sub", "parent_id": top_id},
            format="json",
        )
        force_authenticate(request, user=self.user)
        resp = ScrapReasonViewSet.as_view({"post": "create"})(request)
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(str(resp.data["parent_id"]), str(top_id))
        self.assertEqual(resp.data["parent_code"], "TOP")

    def test_reject_two_level_nesting(self):
        parent = ScrapReason.objects.create(code="GP", label="Grandparent")
        child = ScrapReason.objects.create(code="P", label="Parent", parent=parent)
        request = self.factory.post(
            "/api/production/scrap-reasons/",
            {"code": "GC", "label": "Grandchild", "parent_id": str(child.id)},
            format="json",
        )
        force_authenticate(request, user=self.user)
        resp = ScrapReasonViewSet.as_view({"post": "create"})(request)
        self.assertEqual(resp.status_code, 400)
        # The project's custom exception handler nests field errors under "detail".
        detail = resp.data.get("detail", resp.data)
        self.assertIn("parent_id", detail)

    def test_list_hides_inactive_unless_requested(self):
        ScrapReason.objects.create(code="ACT", label="Active", is_active=True)
        ScrapReason.objects.create(code="INACT", label="Inactive", is_active=False)
        active_only = self._list(ScrapReasonViewSet)
        self.assertTrue(all(row["is_active"] for row in active_only.data))
        codes = {row["code"] for row in active_only.data}
        self.assertIn("ACT", codes)
        self.assertNotIn("INACT", codes)

        with_inactive = self._list(ScrapReasonViewSet, {"include_inactive": "1"})
        codes = {row["code"] for row in with_inactive.data}
        self.assertIn("INACT", codes)

    def test_delete_parent_deactivates_rather_than_orphaning_children(self):
        parent = ScrapReason.objects.create(code="DP", label="Del Parent")
        ScrapReason.objects.create(code="DC", label="Del Child", parent=parent)
        request = self.factory.delete("/api/production/scrap-reasons/")
        force_authenticate(request, user=self.user)
        resp = ScrapReasonViewSet.as_view({"delete": "destroy"})(request, pk=str(parent.id))
        self.assertEqual(resp.status_code, 204)
        parent.refresh_from_db()
        self.assertFalse(parent.is_active)  # soft-deactivated, child preserved
        self.assertTrue(ScrapReason.objects.filter(code="DC").exists())

    def test_delete_leaf_hard_deletes(self):
        leaf = DowntimeReason.objects.create(code="LEAF", label="Leaf")
        request = self.factory.delete("/api/production/downtime-reasons/")
        force_authenticate(request, user=self.user)
        resp = DowntimeReasonViewSet.as_view({"delete": "destroy"})(request, pk=str(leaf.id))
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(DowntimeReason.objects.filter(code="LEAF").exists())


class StalledJobsTests(_BaseWcmCase):
    def test_executing_job_with_no_logs_past_window_is_stalled(self):
        job = self._make_job("STALL-1", job_state="EXECUTING", machine=self.machine)
        # Backdate start so it has been running > 60 min with zero logs.
        ProductionJob.objects.filter(id=job.id).update(
            start_date=timezone.now() - timedelta(minutes=120)
        )
        rows = get_stalled_jobs(work_center=str(self.wc.id))
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["job_number"], "STALL-1")
        self.assertEqual(row["machine_name"], "Press 1")
        self.assertIsNone(row["last_event_at"])
        self.assertGreaterEqual(row["idle_minutes"], 60)
        self.assertEqual(
            set(row.keys()),
            {
                "job_id",
                "job_number",
                "work_center_name",
                "machine_name",
                "customer_name",
                "product_name",
                "started_at",
                "last_event_at",
                "idle_minutes",
            },
        )

    def test_recent_log_keeps_job_active(self):
        job = self._make_job("FRESH-1", job_state="EXECUTING", machine=self.machine)
        ProductionJob.objects.filter(id=job.id).update(start_date=timezone.now() - timedelta(minutes=120))
        JobExecutionLog.objects.create(production_job=job, quantity=Decimal("5"), uom="KG")
        rows = get_stalled_jobs(work_center=str(self.wc.id))
        self.assertEqual(rows, [])

    def test_non_executing_job_is_never_stalled(self):
        job = self._make_job("PLAN-1", job_state="PLANNED", machine=self.machine)
        ProductionJob.objects.filter(id=job.id).update(start_date=timezone.now() - timedelta(minutes=300))
        self.assertEqual(get_stalled_jobs(), [])
        stalled, _started, _idle = is_job_stalled(job, None)
        self.assertFalse(stalled)

    def test_plant_filter(self):
        job = self._make_job("STALL-PLANT", job_state="EXECUTING", machine=self.machine)
        ProductionJob.objects.filter(id=job.id).update(start_date=timezone.now() - timedelta(minutes=120))
        self.assertEqual(len(get_stalled_jobs(plant=str(self.plant.id))), 1)
        other_plant = Plant.objects.create(name="Empty", code="EMPTY-P")
        self.assertEqual(get_stalled_jobs(plant=str(other_plant.id)), [])

    def test_endpoint_returns_200_with_list(self):
        request = self.factory.get("/api/production/stalled-jobs/", {"work_center": str(self.wc.id)})
        force_authenticate(request, user=self.user)
        resp = stalled_jobs(request)
        self.assertEqual(resp.status_code, 200)
        self.assertIsInstance(resp.data, list)


class QueueEnrichmentTests(_BaseWcmCase):
    def test_enrichment_fields_present_and_typed(self):
        job = self._make_job("ENR-1", job_state="EXECUTING", machine=self.machine)
        assignment = WorkCenterAssignment.objects.create(production_job=job, work_center=self.wc)
        enrichment = build_queue_enrichment([assignment])
        row = enrichment[str(job.id)]
        expected_keys = {
            "artwork_id",
            "artwork_code",
            "artwork_name",
            "ink_colors",
            "cylinder_ready",
            "cylinder_status",
            "material_blocked",
            "material_block_reason",
            "elapsed_minutes",
            "last_log_at",
            "is_stalled",
        }
        self.assertTrue(expected_keys.issubset(row.keys()))
        self.assertIsInstance(row["ink_colors"], list)
        self.assertIn(row["cylinder_status"], {"READY", "MISSING", "NOT_REQUIRED", "NA"})
        self.assertIsInstance(row["material_blocked"], bool)

    def test_cylinder_status_na_when_step_not_print_capable(self):
        non_print = Process.objects.create(code="SLIT_HARD", name="Slitting", print_capable=False)
        job = self._make_job("ENR-NA", job_state="RELEASED", machine=self.machine)
        ProductionJob.objects.filter(id=job.id).update(current_process=non_print, process=non_print)
        job.refresh_from_db()
        assignment = WorkCenterAssignment.objects.create(production_job=job, work_center=self.wc)
        row = build_queue_enrichment([assignment])[str(job.id)]
        self.assertEqual(row["cylinder_status"], "NA")
        self.assertFalse(row["cylinder_ready"])

    def test_flexo_artwork_does_not_require_cylinders(self):
        artwork = Artwork.objects.create(
            design_code="ART-FLEXO",
            name="Flexo Art",
            status="APPROVED",
            print_type="FLEXO",
            front_colors=["BLACK"],
            front_colors_count=1,
            ink_gsm_total=Decimal("1.20"),
        )
        job = self._make_job("ENR-FLEXO", job_state="RELEASED", machine=self.machine)
        assignment = WorkCenterAssignment.objects.create(production_job=job, work_center=self.wc)

        with patch("apps.production.services.queue_enrichment._resolve_committed_artwork", return_value=artwork):
            row = build_queue_enrichment([assignment])[str(job.id)]

        self.assertEqual(row["cylinder_status"], "NOT_REQUIRED")
        self.assertTrue(row["cylinder_ready"])

    def test_cylinder_ready_when_all_slots_assigned_to_active_cylinders(self):
        artwork = Artwork.objects.create(
            design_code="ART-HARD",
            name="Hard Art",
            status="APPROVED",
            front_colors=["BLACK", "RED"],
            front_colors_count=2,
        )
        # Attach committed artwork via the sales path is heavy; emulate the
        # readiness inputs directly through cylinder slot assignments.
        cyl1 = Cylinder.objects.create(code="CYL-A", name="A", diameter_mm=Decimal("100"), width_mm=Decimal("500"), status="ACTIVE", artwork=artwork)
        cyl2 = Cylinder.objects.create(code="CYL-B", name="B", diameter_mm=Decimal("100"), width_mm=Decimal("500"), status="ACTIVE", artwork=artwork)
        CylinderSlotAssignment.objects.create(artwork=artwork, cylinder=cyl1, side="FRONT", side_slot_index=1)
        CylinderSlotAssignment.objects.create(artwork=artwork, cylinder=cyl2, side="FRONT", side_slot_index=2)

        from apps.production.services import queue_enrichment as qe

        self.assertEqual(qe._ink_colors_for_artwork(artwork), ["BLACK", "RED"])
        self.assertEqual(qe._required_color_slots(artwork), 2)
        counts = qe._cylinder_slot_counts({artwork.id})
        self.assertEqual(counts.get(artwork.id), 2)


class WorkCenterStockFormContractTests(_BaseWcmCase):
    def test_assignment_serializer_exposes_resolved_tube_contract(self):
        job = self._make_job("STOCK-FORM-TUBE", job_state="RELEASED", machine=self.machine)
        job.meta_json = {
            "stock_form": "LAYFLAT_TUBE",
            "slit_policy": "EXACT_WIDTH_ONLY",
            "child_target_width_mm": "330",
            "width_basis": "LAYFLAT_WIDTH",
        }
        job.save(update_fields=["meta_json"])
        assignment = WorkCenterAssignment.objects.create(production_job=job, work_center=self.wc)

        contract = WorkCenterAssignmentSerializer(assignment).data["target_stock_contract"]

        self.assertEqual(contract["stock_form"], "LAYFLAT_TUBE")
        self.assertEqual(contract["slit_policy"], "EXACT_ONLY")
        self.assertEqual(contract["width_mm"], "330")
        self.assertEqual(contract["width_basis"], "LAYFLAT_WIDTH")
        self.assertEqual(contract["source"], "job.meta_json")

    def test_assignment_serializer_keeps_legacy_jobs_open_web(self):
        job = self._make_job("STOCK-FORM-LEGACY", job_state="RELEASED", machine=self.machine)
        assignment = WorkCenterAssignment.objects.create(production_job=job, work_center=self.wc)

        contract = WorkCenterAssignmentSerializer(assignment).data["target_stock_contract"]

        self.assertEqual(contract["stock_form"], "OPEN_WEB")
        self.assertEqual(contract["slit_policy"], "SLIT_ALLOWED")
        self.assertEqual(contract["source"], "legacy_default")

    def test_assignment_serializer_exposes_process_stock_form_capabilities(self):
        self.process.allowed_input_stock_forms = ["LAYFLAT_TUBE"]
        self.process.allowed_output_stock_forms = ["OPEN_WEB"]
        self.process.stock_form_output_mode = "CONVERTS_FORM"
        self.process.save(update_fields=[
            "allowed_input_stock_forms",
            "allowed_output_stock_forms",
            "stock_form_output_mode",
        ])
        job = self._make_job("STOCK-FORM-CONVERT", job_state="RELEASED", machine=self.machine)
        job.meta_json = {
            "stock_form": "OPEN_WEB",
            "slit_policy": "SLIT_ALLOWED",
            "child_target_width_mm": "800",
            "width_basis": "OPEN_WEB_WIDTH",
        }
        job.save(update_fields=["meta_json"])
        assignment = WorkCenterAssignment.objects.create(production_job=job, work_center=self.wc)

        contract = WorkCenterAssignmentSerializer(assignment).data["target_stock_contract"]

        self.assertEqual(contract["stock_form"], "OPEN_WEB")
        self.assertEqual(contract["process_capabilities"]["allowed_input_stock_forms"], ["LAYFLAT_TUBE"])
        self.assertEqual(contract["process_capabilities"]["allowed_output_stock_forms"], ["OPEN_WEB"])
        self.assertEqual(contract["process_capabilities"]["stock_form_output_mode"], "CONVERTS_FORM")


class MachineLiveStateTests(_BaseWcmCase):
    def test_running_job_marks_machine_running(self):
        self._make_job("RUN-1", job_state="EXECUTING", machine=self.machine)
        state = _resolve_machine_live_state([self.machine])[str(self.machine.id)]
        self.assertEqual(state["state"], "RUNNING")
        self.assertEqual(state["current_job_number"], "RUN-1")

    def test_idle_machine(self):
        state = _resolve_machine_live_state([self.machine])[str(self.machine.id)]
        self.assertEqual(state["state"], "IDLE")
        self.assertIsNone(state["current_job_number"])

    def test_open_downtime_marks_machine_down(self):
        job = self._make_job("DOWN-1", job_state="PAUSED", machine=self.machine)
        DowntimeLog.objects.create(
            production_job=job, start_time=timezone.now(), reason="BREAKDOWN"
        )
        state = _resolve_machine_live_state([self.machine])[str(self.machine.id)]
        self.assertEqual(state["state"], "DOWN")


class AssignMachineBusyTests(_BaseWcmCase):
    def test_busy_machine_raises_with_conflicting_job_number(self):
        # A job already running on the machine.
        running = self._make_job("BUSY-RUN", job_state="EXECUTING", machine=self.machine)
        # The new job we want to assign to the same machine.
        target = self._make_job("BUSY-NEW", job_state="PLANNED", wc=self.wc)
        assignment = WorkCenterAssignment.objects.create(
            production_job=target, work_center=self.wc, status="WC_READY"
        )
        with self.assertRaises(MachineBusyError) as ctx:
            WCManagerService.assign_machine(str(assignment.id), str(self.machine.id), user=self.user)
        self.assertEqual(ctx.exception.conflicting_job_number, "BUSY-RUN")

    def test_machine_from_other_work_center_rejected(self):
        target = self._make_job("XWC-NEW", job_state="PLANNED", wc=self.wc)
        assignment = WorkCenterAssignment.objects.create(
            production_job=target, work_center=self.wc, status="WC_READY"
        )
        with self.assertRaisesRegex(ValueError, "does not belong to work center"):
            WCManagerService.assign_machine(str(assignment.id), str(self.other_machine.id), user=self.user)

    def test_idle_machine_assignment_succeeds(self):
        target = self._make_job("IDLE-NEW", job_state="PLANNED", wc=self.wc)
        assignment = WorkCenterAssignment.objects.create(
            production_job=target, work_center=self.wc, status="WC_READY"
        )
        result = WCManagerService.assign_machine(str(assignment.id), str(self.machine.id), user=self.user)
        self.assertEqual(result.assigned_machine_id, self.machine.id)
