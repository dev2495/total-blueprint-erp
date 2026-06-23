from decimal import Decimal
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase

from apps.factory.models import Plant, Process, WorkCenter, WorkCenterProcess
from apps.inventory.models import InventoryLocation
from apps.production.models import ProductionBatch, ProductionJob
from apps.production.services.batch_route_service import BatchExecutionService, RouteGraphService
from apps.production.services.job_services import JobService
from apps.routing.models import RoutingRule
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.templates.models import TemplateBlueprint


class RouteGraphBatchExecutionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.plant = Plant.objects.create(code="RGB", name="Route Graph Plant")
        cls.rm = InventoryLocation.objects.create(plant=cls.plant, code="RM", name="RM", type="RM", is_system=True)
        cls.wip = InventoryLocation.objects.create(plant=cls.plant, code="WIP", name="WIP", type="WIP", is_system=True)
        cls.fg = InventoryLocation.objects.create(plant=cls.plant, code="FG", name="FG", type="FG", is_system=True)
        cls.processes = {}
        for code, name in [
            ("EXT", "Extrusion"),
            ("PRINT", "Printing"),
            ("COAT", "Coating"),
            ("LAM", "Lamination Join"),
        ]:
            process = Process.objects.create(code=code, name=name, input_form="ROLL", output_form="ROLL")
            wc = WorkCenter.objects.create(plant=cls.plant, code=f"WC-{code}", name=f"{name} WC")
            WorkCenterProcess.objects.create(work_center=wc, process=process)
            cls.processes[code] = process

    def _route(self):
        return RoutingRule.objects.create(
            name="Parallel print coat join",
            ordered_processes=["EXT", "PRINT", "LAM"],
            route_graph={
                "execution_policy": {"default_batch_size_kg": 500, "allow_partial_movement": True},
                "nodes": [
                    {"id": "ext", "label": "Extrusion", "process_code": "EXT", "route_index": 0},
                    {"id": "print", "label": "Print", "process_code": "PRINT", "route_index": 1, "branch_key": "PRINT"},
                    {"id": "coat", "label": "Coat", "process_code": "COAT", "route_index": 1, "branch_key": "COAT"},
                    {"id": "lam", "label": "Laminate", "process_code": "LAM", "route_index": 2, "join_key": "LAM_JOIN"},
                ],
                "edges": [
                    {"from": "ext", "to": "print"},
                    {"from": "ext", "to": "coat"},
                    {"from": "print", "to": "lam"},
                    {"from": "coat", "to": "lam"},
                ],
            },
        )

    def _template_and_item(self, qty=Decimal("1200")):
        route = self._route()
        template = TemplateBlueprint.objects.create(
            name="Route Graph Batch Template",
            fg_type="ROLL",
            status="LIVE",
            routing_rule=route,
            batch_execution_policy={"default_batch_size_kg": 500},
        )
        sales_order = SalesOrder.objects.create(customer_name="Route Customer", status="CONFIRMED")
        item = SalesOrderItem.objects.create(
            sales_order=sales_order,
            template=template,
            mode="TEMPLATE",
            geometry_snapshot={"fg_type": "ROLL", "base": {"width_mm": 500}},
            layer_snapshot=[],
            printing_snapshot={"enabled": False},
            addons_snapshot=[],
            bom_snapshot={"items": []},
            qty_uom="KG",
            qty_value=qty,
            total_weight_kg=qty,
            price_basis="KG",
            unit_price=Decimal("1.0000"),
        )
        return template, item

    def test_route_graph_normalizes_parallel_branch_and_join(self):
        route = self._route()
        graph = RouteGraphService.normalize(route)

        self.assertEqual(RouteGraphService.initial_node_ids(graph["nodes"]), {"ext"})
        self.assertEqual(set(graph["successors"]["ext"]), {"print", "coat"})
        self.assertEqual(set(graph["predecessors"]["lam"]), {"print", "coat"})
        self.assertTrue(graph["by_id"]["ext"]["is_parallel_start"])
        self.assertTrue(graph["by_id"]["lam"]["is_join"])

    @patch("apps.production.services.services_execution.ExecutionService.calculate_requirements")
    @patch("apps.production.services.job_services.require_bom_ready_for_production")
    def test_sales_line_splits_into_batches_and_one_job_per_batch_route_node(self, _bom_ready, _requirements):
        _template, item = self._template_and_item()

        jobs = JobService.create_jobs_for_so_item(item)

        self.assertEqual(len(jobs), 12)
        batches = list(ProductionBatch.objects.filter(sales_order_item=item).order_by("batch_sequence"))
        self.assertEqual([batch.planned_qty for batch in batches], [Decimal("500.0000"), Decimal("500.0000"), Decimal("200.0000")])
        self.assertEqual([batch.status for batch in batches], ["PLANNED", "PLANNED", "PLANNED"])
        first_batch_jobs = ProductionJob.objects.filter(production_batch=batches[0]).order_by("route_node_id")
        self.assertEqual(first_batch_jobs.count(), 4)
        self.assertEqual(
            set(first_batch_jobs.values_list("route_node_id", "job_state")),
            {("ext", "PLANNED"), ("print", "WAITING"), ("coat", "WAITING"), ("lam", "WAITING")},
        )

    @patch("apps.production.services.services_execution.ExecutionService.calculate_requirements")
    @patch("apps.production.services.job_services.require_bom_ready_for_production")
    def test_join_step_waits_until_all_parallel_predecessors_complete(self, _bom_ready, _requirements):
        _template, item = self._template_and_item(qty=Decimal("500"))
        JobService.create_jobs_for_so_item(item)
        batch = item.production_batches.get()
        jobs = {job.route_node_id: job for job in ProductionJob.objects.filter(production_batch=batch)}

        jobs["ext"].job_state = "COMPLETED"
        jobs["ext"].save(update_fields=["job_state"])
        self.assertEqual(
            {job.route_node_id for job in RouteGraphService.ready_successor_jobs(jobs["ext"])},
            {"print", "coat"},
        )

        jobs["print"].job_state = "COMPLETED"
        jobs["print"].save(update_fields=["job_state"])
        self.assertEqual(RouteGraphService.ready_successor_jobs(jobs["print"]), [])

        jobs["coat"].job_state = "COMPLETED"
        jobs["coat"].save(update_fields=["job_state"])
        self.assertEqual(
            {job.route_node_id for job in RouteGraphService.ready_successor_jobs(jobs["coat"])},
            {"lam"},
        )

    @patch("apps.production.services.services_execution.ExecutionService.calculate_requirements")
    @patch("apps.production.services.job_services.require_bom_ready_for_production")
    def test_sales_line_summary_reports_one_commercial_line_with_batch_statuses(self, _bom_ready, _requirements):
        _template, item = self._template_and_item()
        JobService.create_jobs_for_so_item(item)

        summary = BatchExecutionService.line_summary(item)

        self.assertEqual(summary["batch_count"], 3)
        self.assertEqual(summary["status_counts"], {"PLANNED": 3})
        self.assertEqual([row["planned_qty"] for row in summary["batches"]], [500.0, 500.0, 200.0])

    def test_backfill_command_targets_one_legacy_sales_line(self):
        template, item = self._template_and_item(qty=Decimal("500"))
        process = self.processes["EXT"]
        job = ProductionJob.objects.create(
            job_number="LEG-BF-001",
            template=template,
            sales_order_item=item,
            routing_rule=template.routing_rule,
            current_process=process,
            process=process,
            current_step_index=0,
            quantity=Decimal("500.00"),
            uom="KG",
            job_state="COMPLETED",
        )

        out = StringIO()
        call_command("backfill_production_batches", sales_order_item_id=str(item.id), stdout=out)

        job.refresh_from_db()
        batch = item.production_batches.get()
        self.assertEqual(job.production_batch_id, batch.id)
        self.assertEqual(batch.source, "LEGACY_SINGLE")
        self.assertIn("processed=1 created=1", out.getvalue())

    def test_sales_line_summary_backfills_legacy_jobs_into_one_batch(self):
        template, item = self._template_and_item(qty=Decimal("900"))
        job = ProductionJob.objects.create(
            job_number=f"{item.sales_order.order_number}-LEGACY-1",
            origin="MTO",
            template=template,
            sales_order_item=item,
            routing_rule=template.routing_rule,
            current_step_index=0,
            current_process=self.processes["EXT"],
            work_center=WorkCenter.objects.get(code="WC-EXT"),
            from_location=self.rm,
            to_location=self.wip,
            quantity=Decimal("900"),
            remaining_qty=Decimal("900"),
            uom="KG",
            status="QUEUED",
            job_state="RELEASED",
        )

        summary = BatchExecutionService.line_summary(item)

        job.refresh_from_db()
        self.assertIsNotNone(job.production_batch_id)
        self.assertEqual(summary["batch_count"], 1)
        self.assertEqual(summary["status_counts"], {"RELEASED": 1})
        self.assertEqual(summary["batches"][0]["source"], "LEGACY_SINGLE")
        self.assertEqual(summary["batches"][0]["planned_qty"], 900.0)
