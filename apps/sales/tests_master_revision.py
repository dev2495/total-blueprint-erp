from contextlib import ExitStack
from threading import Barrier, Event, Thread
import uuid
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.db import connection, connections
from django.test import TestCase, TransactionTestCase, skipUnlessDBFeature

from apps.factory.models import Plant, Process, WorkCenter, WorkCenterProcess
from apps.materials.models import ProductMaster
from apps.production.models import ProductionJob
from apps.routing.models import RoutingRule
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.sales.services.order_service import SalesOrderService
from apps.templates.models import TemplateBlueprint, TemplateProcessStep
from apps.templates.services import RouteDispatchError, TemplateDispatchService, TemplateGovernanceService


class MasterRevisionFixtures:
    def setUp(self):
        self.process = Process.objects.create(code="REV-QUEUE-PROC", name="Revision queue process")
        self.route = RoutingRule.objects.create(name="Revision queue route", ordered_processes=[self.process.code])
        self.template = TemplateBlueprint.objects.create(
            name="Revision queue template",
            fg_type="POUCH",
            status="LIVE",
            pouch_style="THREE_SIDE_SEAL",
            routing_rule=self.route,
        )
        self.master = ProductMaster.objects.create(
            code="REV-QUEUE-MASTER",
            name="Revision master",
            product_kind="POUCH",
            default_reporting_group="FG",
            template=self.template,
            default_template=self.template,
        )

    def _item(self, *, order_status="PLANNED", line_status="PLANNED", line_name="Customer display name"):
        order = SalesOrder.objects.create(customer_name="Revision customer", status=order_status)
        return SalesOrderItem.objects.create(
            sales_order=order,
            template=self.template,
            product_master=self.master,
            line_status=line_status,
            line_name=line_name,
            qty_value=100,
            qty_uom="PCS",
            price_basis="PCS",
            unit_price=1,
            geometry_snapshot={"finished_good_type": "POUCH"},
            printing_snapshot={"enabled": False},
        )


class MasterRevisionSafetyTests(MasterRevisionFixtures, TestCase):
    @patch("apps.production.services.job_services.JobService.create_jobs_for_so_item", return_value=[])
    def test_pristine_queued_jobs_are_cancelled_and_rebuilt(self, create_jobs):
        item = self._item()
        job = ProductionJob.objects.create(
            job_number="REV-QUEUE-001",
            template=self.template,
            routing_rule=self.route,
            sales_order_item=item,
            quantity=100,
            remaining_qty=100,
            status="QUEUED",
            job_state="PLANNED",
        )

        result = SalesOrderService._rebuild_pristine_pre_release_jobs(item, reason="TEST_MASTER_EDIT")

        self.assertEqual(result["status"], "rebuilt")
        self.assertEqual(result["cancelled"], 1)
        create_jobs.assert_called_once()
        job.refresh_from_db()
        self.assertEqual(job.job_state, "CANCELLED")
        self.assertEqual(job.status, "CANCELLED")

    @patch(
        "apps.production.services.job_services.JobService.create_jobs_for_so_item",
        side_effect=RouteDispatchError("Planner must choose a work center for EXT at step 1."),
    )
    def test_pristine_queue_becomes_planning_required_when_dispatch_needs_decision(self, create_jobs):
        item = self._item(order_status="PLANNED", line_status="PLANNED")
        job = ProductionJob.objects.create(
            job_number="REV-QUEUE-DISPATCH",
            template=self.template,
            routing_rule=self.route,
            sales_order_item=item,
            quantity=100,
            remaining_qty=100,
            status="QUEUED",
            job_state="PLANNED",
        )

        result = SalesOrderService._rebuild_pristine_pre_release_jobs(item, reason="TEST_MASTER_EDIT")

        self.assertEqual(result["status"], "planner_decision_required")
        self.assertEqual(result["cancelled"], 1)
        create_jobs.assert_called_once()
        item.refresh_from_db()
        item.sales_order.refresh_from_db()
        job.refresh_from_db()
        self.assertEqual(item.line_status, "PLANNING_REQUIRED")
        self.assertEqual(item.sales_order.status, "PLANNING_REQUIRED")
        self.assertEqual(job.job_state, "CANCELLED")
        self.assertEqual(job.status, "CANCELLED")

    @patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item")
    @patch("apps.sales.services.axis_resolver.OrderResolutionService.resolve_line")
    def test_snapshot_refresh_preserves_customer_line_name(self, resolve_line, preview_sales_item):
        item = self._item(order_status="CONFIRMED", line_status="OPEN", line_name="Do not rename this line")
        resolve_line.return_value = {
            "template": str(self.template.id),
            "product_variant": None,
            "customer_product_overlay": None,
            "geometry_snapshot": {"finished_good_type": "POUCH"},
            "layer_snapshot": [],
            "printing_snapshot": {"enabled": False},
            "addons_snapshot": [],
            "packaging_snapshot": {},
        }
        preview_sales_item.return_value = {"unit_weight_g": 1, "total_weight_kg": 0.1, "bom": {}}

        result = SalesOrderService.refresh_open_snapshots_for_items(
            SalesOrderItem.objects.filter(id=item.id),
            reason="TEST_MASTER_EDIT",
        )

        self.assertEqual(result["refreshed"], 1, result)
        item.refresh_from_db()
        self.assertEqual(item.line_name, "Do not rename this line")
        self.assertEqual(item.line_status, "PLANNING_REQUIRED")

    @patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item")
    @patch("apps.sales.services.axis_resolver.OrderResolutionService.resolve_line")
    def test_strict_snapshot_refresh_rolls_back_all_lines_on_failure(self, resolve_line, preview_sales_item):
        first = self._item(order_status="CONFIRMED", line_status="OPEN", line_name="First line")
        second = self._item(order_status="CONFIRMED", line_status="OPEN", line_name="Second line")
        resolved = {
            "template": str(self.template.id),
            "product_variant": None,
            "customer_product_overlay": None,
            "geometry_snapshot": {"finished_good_type": "POUCH", "width_mm": 999},
            "layer_snapshot": [],
            "printing_snapshot": {"enabled": False},
            "addons_snapshot": [],
            "packaging_snapshot": {},
        }
        resolve_line.side_effect = [resolved, RuntimeError("forced second-line failure")]
        preview_sales_item.return_value = {"unit_weight_g": 1, "total_weight_kg": 0.1, "bom": {}}

        with self.assertRaises(ValidationError):
            SalesOrderService.refresh_open_snapshots_for_items(
                SalesOrderItem.objects.filter(id__in=[first.id, second.id]),
                reason="TEST_STRICT_MASTER_EDIT",
                raise_on_error=True,
            )

        first.refresh_from_db()
        second.refresh_from_db()
        self.assertNotIn("width_mm", first.geometry_snapshot)
        self.assertNotIn("width_mm", second.geometry_snapshot)
        self.assertEqual(first.line_status, "OPEN")
        self.assertEqual(second.line_status, "OPEN")

    @patch("apps.sales.services.order_service.SalesOrderService._rebuild_pristine_pre_release_jobs", side_effect=RuntimeError("queue rebuild failed"))
    @patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item")
    @patch("apps.sales.services.axis_resolver.OrderResolutionService.resolve_line")
    def test_non_strict_refresh_rolls_back_snapshot_when_queue_rebuild_fails(self, resolve_line, preview_sales_item, _rebuild):
        item = self._item()
        resolve_line.return_value = {
            "template": str(self.template.id),
            "geometry_snapshot": {"finished_good_type": "POUCH", "width_mm": 999},
            "layer_snapshot": [], "printing_snapshot": {"enabled": False},
            "addons_snapshot": [], "packaging_snapshot": {},
        }
        preview_sales_item.return_value = {"unit_weight_g": 1, "total_weight_kg": 0.1, "bom": {"revision": "new"}}

        result = SalesOrderService.refresh_open_snapshots_for_items(SalesOrderItem.objects.filter(id=item.id))

        self.assertEqual(result["failed"], 1)
        self.assertEqual(result["refreshed"], 0)
        item.refresh_from_db()
        self.assertNotIn("width_mm", item.geometry_snapshot)
        self.assertNotEqual(item.bom_snapshot.get("revision"), "new")


@skipUnlessDBFeature("has_select_for_update")
class MasterRevisionConcurrencyTests(MasterRevisionFixtures, TransactionTestCase):
    """Exercise the release/revision boundary on independent DB connections."""

    def setUp(self):
        super().setUp()
        self.item = self._item()
        self.job = ProductionJob.objects.create(
            job_number="REV-CONCURRENT", template=self.template, routing_rule=self.route,
            sales_order_item=self.item, current_process=self.process,
            quantity=100, remaining_qty=100, status="QUEUED", job_state="PLANNED",
        )
        plant = Plant.objects.create(code="REV-PLANT", name="Revision plant")
        self.work_center = WorkCenter.objects.create(code="REV-WC", name="Revision work center", plant=plant)
        WorkCenterProcess.objects.create(work_center=self.work_center, process=self.process)
        self.revised = {
            "template": str(self.template.id), "geometry_snapshot": {"finished_good_type": "POUCH", "width_mm": 999},
            "layer_snapshot": [], "printing_snapshot": {"enabled": False},
            "addons_snapshot": [], "packaging_snapshot": {},
        }
        self.preview = {"unit_weight_g": 1, "total_weight_kg": 0.1, "bom": {"revision": "new"}}

    def _patch_services(self, stack, *, bom_side_effect=None, preview_side_effect=None):
        # Leave DB reads, row locks, state checks, snapshot saves and cancellation
        # real; isolate unrelated BOM, dispatch and WCM fixture setup.
        stack.enter_context(patch("apps.sales.services.axis_resolver.OrderResolutionService.resolve_line", return_value=self.revised))
        stack.enter_context(patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item", return_value=self.preview, side_effect=preview_side_effect))
        stack.enter_context(patch("apps.production.services.job_services.require_bom_ready_for_production", side_effect=bom_side_effect))
        stack.enter_context(patch("apps.production.services.job_services.TemplateDispatchService.backfill_auto_resolvable_template_steps"))
        stack.enter_context(patch("apps.production.services.job_services.JobService._resolve_work_center_for_process", return_value=self.work_center))
        stack.enter_context(patch("apps.production.services.job_services.JobService._step_locations_for_work_center", return_value=(None, None, None)))
        stack.enter_context(patch("apps.production.services.batch_route_service.BatchExecutionService.sync_for_job"))
        stack.enter_context(patch("apps.production.services.job_services.JobService._auto_pause_for_planned_jobwork", return_value=None))
        stack.enter_context(patch("apps.production.services.job_services.WCManagerService.prepare_job_for_wc"))
        stack.enter_context(patch("apps.production.services.job_services.JobService.create_jobs_for_so_item", return_value=[]))

    def _worker(self, operation, result, *, query_started=None):
        def observe(execute, sql, params, many, context):
            if query_started is not None and '"sales_orders"' in sql and "FOR UPDATE" in sql:
                query_started.set()
            return execute(sql, params, many, context)

        def run():
            try:
                with connection.cursor() as cursor:
                    cursor.execute("SET lock_timeout = '5s'")
                    cursor.execute("SET statement_timeout = '10s'")
                with connection.execute_wrapper(observe):
                    result["value"] = operation()
            except Exception as exc:
                result["error"] = exc
            finally:
                connections.close_all()
                result["done"].set()

        thread = Thread(target=run, daemon=True)
        thread.start()
        return thread

    def _refresh(self):
        return SalesOrderService.refresh_open_snapshots_for_items(
            SalesOrderItem.objects.filter(id=self.item.id), reason="CONCURRENT_REVISION", raise_on_error=True,
        )

    def test_revision_first_blocks_release_and_does_not_revive_superseded_job(self):
        from apps.production.services.job_services import JobService

        release = {"done": Event()}
        release_query = Event()
        threads = []

        def preview(_payload):
            threads.append(self._worker(lambda: JobService.release_job(self.job.id), release, query_started=release_query))
            self.assertTrue(release_query.wait(5), "Release did not reach its order lock")
            self.assertFalse(release["done"].wait(0.15), "Release bypassed the revision's row locks")
            return self.preview

        with ExitStack() as stack:
            self._patch_services(stack, preview_side_effect=preview)
            try:
                stats = self._refresh()
            finally:
                for thread in threads:
                    thread.join(10)
            self.assertTrue(release["done"].is_set(), "Concurrent release did not finish")

        self.assertEqual(stats["refreshed"], 1)
        self.assertEqual(stats["queues_rebuilt"], 1)
        self.assertIsInstance(release.get("error"), ValueError, release)
        self.job.refresh_from_db()
        self.item.refresh_from_db()
        self.assertEqual(self.job.job_state, "CANCELLED")
        self.assertEqual(self.item.geometry_snapshot["width_mm"], 999)
        self.assertNotEqual(self.item.line_status, "RELEASED")

    def test_release_first_freezes_snapshot_before_any_revision_write(self):
        from apps.production.services.job_services import JobService

        release_ready, allow_release, refresh_query = Event(), Event(), Event()
        release, refresh = {"done": Event()}, {"done": Event()}

        def bom_gate(*_args, **_kwargs):
            release_ready.set()
            if not allow_release.wait(5):
                raise AssertionError("Test release gate timed out")

        with ExitStack() as stack:
            self._patch_services(stack, bom_side_effect=bom_gate)
            release_thread = self._worker(lambda: JobService.release_job(self.job.id), release)
            refresh_thread = None
            try:
                self.assertTrue(release_ready.wait(5), release)
                refresh_thread = self._worker(self._refresh, refresh, query_started=refresh_query)
                self.assertTrue(refresh_query.wait(5), "Revision did not reach its order lock")
                self.assertFalse(refresh["done"].wait(0.15), "Revision bypassed the release's row locks")
            finally:
                allow_release.set()
                release_thread.join(10)
                if refresh_thread:
                    refresh_thread.join(10)

        self.assertTrue(release["done"].is_set(), release)
        self.assertTrue(refresh["done"].is_set(), refresh)
        self.assertNotIn("error", release)
        self.assertNotIn("error", refresh)
        self.assertEqual(refresh["value"]["refreshed"], 0)
        self.assertEqual(refresh["value"]["skipped"], 1)
        self.job.refresh_from_db()
        self.item.refresh_from_db()
        self.assertEqual(self.job.job_state, "RELEASED")
        self.assertEqual(self.item.line_status, "RELEASED")
        self.assertNotIn("width_mm", self.item.geometry_snapshot)
        self.assertNotEqual(self.item.bom_snapshot.get("revision"), "new")

    def test_dispatch_edit_waits_for_release_without_inverting_source_and_job_locks(self):
        from apps.production.services.job_services import JobService

        step = TemplateProcessStep.objects.create(template=self.template, process=self.process, sequence_number=1)
        release_ready, allow_release, dispatch_query = Event(), Event(), Event()
        release, dispatch = {"done": Event()}, {"done": Event()}

        def bom_gate(*_args, **_kwargs):
            release_ready.set()
            if not allow_release.wait(5):
                raise AssertionError("Test release gate timed out")

        with ExitStack() as stack:
            self._patch_services(stack, bom_side_effect=bom_gate)
            release_thread = self._worker(lambda: JobService.release_job(self.job.id), release)
            dispatch_thread = None
            try:
                self.assertTrue(release_ready.wait(5), release)
                dispatch_thread = self._worker(
                    lambda: TemplateDispatchService.update_step_dispatch(
                        step, default_work_center_id=self.work_center.id, notes="Concurrent dispatch edit",
                    ),
                    dispatch, query_started=dispatch_query,
                )
                self.assertTrue(dispatch_query.wait(5), "Dispatch edit did not reach its source lock")
                self.assertFalse(dispatch["done"].wait(0.15), "Dispatch edit bypassed release's source locks")
            finally:
                allow_release.set()
                release_thread.join(10)
                if dispatch_thread:
                    dispatch_thread.join(10)

        self.assertTrue(release["done"].is_set(), release)
        self.assertTrue(dispatch["done"].is_set(), dispatch)
        self.assertNotIn("error", release)
        self.assertNotIn("error", dispatch)
        self.job.refresh_from_db()
        self.item.refresh_from_db()
        step.refresh_from_db()
        self.assertEqual(self.job.job_state, "RELEASED")
        self.assertEqual(step.dispatch_notes, "Concurrent dispatch edit")
        self.assertNotIn("width_mm", self.item.geometry_snapshot)

    def test_two_orders_sharing_auto_dispatch_release_without_cross_order_deadlock_or_replan(self):
        from apps.production.services.job_services import JobService

        step = TemplateProcessStep.objects.create(template=self.template, process=self.process, sequence_number=1)
        other_item = self._item()
        other_job = ProductionJob.objects.create(
            job_number="REV-CONCURRENT-OTHER", template=self.template, routing_rule=self.route,
            sales_order_item=other_item, current_process=self.process,
            quantity=100, remaining_qty=100, status="QUEUED", job_state="PLANNED",
        )
        gate = Barrier(2)
        real_backfill = TemplateDispatchService.backfill_auto_resolvable_template_steps

        def automatic_backfill(*args, **kwargs):
            # Both releases already hold their own source lock at this point.
            # Exercise the real automatic template persistence, not a stub.
            gate.wait(timeout=5)
            return real_backfill(*args, **kwargs)

        first, second = {"done": Event()}, {"done": Event()}
        with ExitStack() as stack:
            self._patch_services(stack)
            stack.enter_context(patch(
                "apps.production.services.job_services.TemplateDispatchService.backfill_auto_resolvable_template_steps",
                side_effect=automatic_backfill,
            ))
            first_thread = self._worker(lambda: JobService.release_job(self.job.id), first)
            second_thread = self._worker(lambda: JobService.release_job(other_job.id), second)
            first_thread.join(10)
            second_thread.join(10)

        self.assertTrue(first["done"].is_set(), first)
        self.assertTrue(second["done"].is_set(), second)
        self.assertNotIn("error", first)
        self.assertNotIn("error", second)
        self.assertEqual(ProductionJob.objects.count(), 2)
        self.job.refresh_from_db()
        other_job.refresh_from_db()
        step.refresh_from_db()
        self.assertEqual(self.job.job_state, "RELEASED")
        self.assertEqual(other_job.job_state, "RELEASED")
        self.assertEqual(step.default_work_center_id, self.work_center.id)

    def test_template_publish_and_old_queue_rebuild_complete_with_consistent_new_version(self):
        replacement = TemplateBlueprint.objects.create(
            name="Concurrent published revision", fg_type="POUCH", status="APPROVED",
            pouch_style="THREE_SIDE_SEAL", routing_rule=self.route,
            version_group=self.template.version_group, version=2, is_current_version=False,
            source_template=self.template,
        )
        publish = {"done": Event()}
        publish_source_query = Event()
        threads = []

        def resolved(payload, **_kwargs):
            master = ProductMaster.objects.get(id=payload["product_master"])
            return {**self.revised, "template": str(master.default_template_id)}

        def preview(_payload):
            if not threads:
                threads.append(self._worker(
                    lambda: TemplateGovernanceService.publish_template(replacement.id), publish,
                    query_started=publish_source_query,
                ))
                self.assertTrue(publish_source_query.wait(5), "Publisher did not reach its source lock")
                self.assertFalse(publish["done"].wait(0.15), "Publisher bypassed the revision's source lock")
            return self.preview

        def create_replacement(item, **_kwargs):
            # This real insertion exercises deferred FK validation at commit
            # against the old template held by the concurrent publisher.
            return [ProductionJob.objects.create(
                job_number=f"REV-PUBLISH-{uuid.uuid4().hex[:8]}", template=item.template,
                routing_rule=self.route, sales_order_item=item, current_process=self.process,
                quantity=100, remaining_qty=100, status="QUEUED", job_state="PLANNED",
            )]

        with ExitStack() as stack:
            self._patch_services(stack, preview_side_effect=preview)
            stack.enter_context(patch("apps.sales.services.axis_resolver.OrderResolutionService.resolve_line", side_effect=resolved))
            stack.enter_context(patch("apps.production.services.job_services.JobService.create_jobs_for_so_item", side_effect=create_replacement))
            stack.enter_context(patch("apps.templates.services.TemplateGovernanceService._ensure_live_ready_workflow"))
            try:
                stats = self._refresh()
            finally:
                for thread in threads:
                    thread.join(10)

        self.assertEqual(stats["refreshed"], 1)
        self.assertTrue(publish["done"].is_set(), publish)
        self.assertNotIn("error", publish)
        self.item.refresh_from_db()
        self.master.refresh_from_db()
        self.template.refresh_from_db()
        replacement.refresh_from_db()
        self.assertEqual(self.master.default_template_id, replacement.id)
        self.assertEqual(self.item.template_id, replacement.id)
        self.assertEqual(self.template.status, "OBSOLETE")
        self.assertEqual(replacement.status, "LIVE")
        active_job = ProductionJob.objects.exclude(job_state="CANCELLED").get()
        self.assertEqual(active_job.template_id, replacement.id)
