from decimal import Decimal
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase

from apps.factory.models import Plant, Process, WorkCenter, WorkCenterProcess
from apps.inventory.models import InventoryLocation, InventoryRoll
from apps.materials.models import InventoryMaterial
from apps.production.models import ProductionBatch, ProductionJob
from apps.production.services.batch_route_service import BatchExecutionService, RouteGraphService
from apps.production.services.job_services import JobService
from apps.production.services.roll_allocation_service import RollAllocationService
from apps.routing.models import RoutingRule
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.templates.models import TemplateBlueprint, TemplateProcessStep


class RouteGraphBatchExecutionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.plant = Plant.objects.create(code="RGB", name="Route Graph Plant")
        cls.rm = InventoryLocation.objects.create(plant=cls.plant, code="RM", name="RM", type="RM", is_system=True)
        cls.wip = InventoryLocation.objects.create(plant=cls.plant, code="WIP", name="WIP", type="WIP", is_system=True)
        cls.fg = InventoryLocation.objects.create(plant=cls.plant, code="FG", name="FG", type="FG", is_system=True)
        cls.processes = {}
        for code, name, roll_behavior in [
            ("EXT", "Extrusion", "MODIFY_EXISTING"),
            ("PRINT", "Printing", "MODIFY_EXISTING"),
            ("COAT", "Coating", "MODIFY_EXISTING"),
            ("LAM", "Lamination Join", "MULTI_INPUT_COMBINE"),
        ]:
            process = Process.objects.create(
                code=code,
                name=name,
                input_form="ROLL",
                output_form="ROLL",
                roll_behavior=roll_behavior,
            )
            wc = WorkCenter.objects.create(plant=cls.plant, code=f"WC-{code}", name=f"{name} WC")
            WorkCenterProcess.objects.create(work_center=wc, process=process)
            cls.processes[code] = process

    def _route(self):
        return RoutingRule.objects.create(
            name="Parallel print coat join",
            ordered_processes=["EXT", "PRINT", "LAM"],
            route_graph={
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

    def _three_layer_route(self):
        return RoutingRule.objects.create(
            name="Three layer print extrusion join",
            ordered_processes=["EXT", "PRINT", "LAM"],
            route_graph={
                "nodes": [
                    {"id": "base_ext", "label": "Base layer extrusion", "process_code": "EXT", "route_index": 0},
                    {
                        "id": "face_print",
                        "label": "Face layer print",
                        "process_code": "PRINT",
                        "route_index": 1,
                        "branch_key": "PRINT",
                        "parallel_group": "LAYER_PREP",
                    },
                    {
                        "id": "third_layer_ext",
                        "label": "Third layer extrusion",
                        "process_code": "EXT",
                        "route_index": 1,
                        "branch_key": "THIRD_LAYER",
                        "parallel_group": "LAYER_PREP",
                        "matching_rule": {"same_batch": True, "same_planned_qty": True},
                    },
                    {
                        "id": "lam",
                        "label": "Three layer lamination",
                        "process_code": "LAM",
                        "route_index": 2,
                        "join_key": "LAM_3L",
                        "matching_rule": {"same_batch": True, "quantity_tolerance_pct": 0},
                    },
                ],
                "edges": [
                    {"from": "base_ext", "to": "face_print"},
                    {"from": "base_ext", "to": "third_layer_ext"},
                    {"from": "face_print", "to": "lam"},
                    {"from": "third_layer_ext", "to": "lam"},
                ],
            },
        )

    def _linear_route(self):
        return RoutingRule.objects.create(
            name="Linear optional route",
            ordered_processes=["EXT", "PRINT", "LAM"],
            route_graph={
                "nodes": [
                    {"id": "ext", "label": "Extrusion", "process_code": "EXT", "route_index": 0},
                    {"id": "print", "label": "Print", "process_code": "PRINT", "route_index": 1},
                    {"id": "lam", "label": "Laminate", "process_code": "LAM", "route_index": 2},
                ],
                "edges": [
                    {"from": "ext", "to": "print"},
                    {"from": "print", "to": "lam"},
                ],
            },
        )

    def _compressed_parallel_route(self):
        return RoutingRule.objects.create(
            name="Compressed parallel print route",
            ordered_processes=["EXT", "PRINT", "LAM", "COAT"],
            route_graph={
                "nodes": [
                    {"id": "step_1_EXT", "label": "Extrusion", "process_code": "EXT", "route_index": 0, "branch_key": "B1"},
                    {"id": "step_2_PRINT", "label": "Print", "process_code": "PRINT", "route_index": 0, "branch_key": "B2"},
                    {
                        "id": "step_3_LAM",
                        "label": "Laminate",
                        "process_code": "LAM",
                        "route_index": 1,
                        "join_key": "JOIN_2",
                        "predecessor_node_ids": ["step_1_EXT", "step_2_PRINT"],
                    },
                    {
                        "id": "step_4_COAT",
                        "label": "Coat",
                        "process_code": "COAT",
                        "route_index": 2,
                        "predecessor_node_ids": ["step_3_LAM"],
                    },
                ],
            },
        )

    def _template_and_item(self, qty=Decimal("1200"), *, route=None, batch_size_kg=500, layer_snapshot=None):
        route = route or self._route()
        template = TemplateBlueprint.objects.create(
            name="Route Graph Batch Template",
            fg_type="ROLL",
            status="LIVE",
            routing_rule=route,
            batch_execution_policy={"default_batch_size_kg": batch_size_kg},
        )
        sales_order = SalesOrder.objects.create(customer_name="Route Customer", status="CONFIRMED")
        item = SalesOrderItem.objects.create(
            sales_order=sales_order,
            template=template,
            mode="TEMPLATE",
            geometry_snapshot={"fg_type": "ROLL", "base": {"width_mm": 500}},
            layer_snapshot=layer_snapshot or [],
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

    def _add_template_steps(self, template, codes, *, optional_codes=None, runtime_skip_codes=None):
        optional_codes = set(optional_codes or set())
        runtime_skip_codes = set(runtime_skip_codes or set())
        for index, code in enumerate(codes, start=1):
            TemplateProcessStep.objects.create(
                template=template,
                sequence_number=index,
                process=self.processes[code],
                optional_at_planning=code in optional_codes,
                skippable_after_previous_output=code in runtime_skip_codes,
            )

    def test_route_graph_normalizes_parallel_branch_and_join(self):
        route = self._route()
        graph = RouteGraphService.normalize(route)

        self.assertEqual(RouteGraphService.initial_node_ids(graph["nodes"]), {"ext"})
        self.assertEqual(set(graph["successors"]["ext"]), {"print", "coat"})
        self.assertEqual(set(graph["predecessors"]["lam"]), {"print", "coat"})
        self.assertTrue(graph["by_id"]["ext"]["is_parallel_start"])
        self.assertTrue(graph["by_id"]["lam"]["is_join"])

    def test_route_snapshot_includes_template_step_skip_policy(self):
        self.processes["PRINT"].allows_optional_at_planning = True
        self.processes["PRINT"].allows_skip_after_previous_output = True
        self.processes["PRINT"].save(
            update_fields=[
                "allows_optional_at_planning",
                "allows_skip_after_previous_output",
            ]
        )
        route = self._linear_route()
        template, _item = self._template_and_item(qty=Decimal("500"), route=route)
        self._add_template_steps(
            template,
            ["EXT", "PRINT", "LAM"],
            optional_codes={"PRINT"},
            runtime_skip_codes={"PRINT"},
        )

        snapshot = RouteGraphService.public_snapshot(route, template=template)
        print_node = next(node for node in snapshot["nodes"] if node["id"] == "print")

        self.assertTrue(print_node["optional_at_planning"])
        self.assertTrue(print_node["skippable_after_previous_output"])
        self.assertEqual(print_node["route_step_policy"], "OPTIONAL_AND_RUNTIME_SKIPPABLE")

    @patch("apps.production.services.services_execution.ExecutionService.calculate_requirements")
    @patch("apps.production.services.job_services.require_bom_ready_for_production")
    def test_compressed_parallel_route_uses_physical_template_step_indexes(self, _bom_ready, _requirements):
        route = self._compressed_parallel_route()
        template, item = self._template_and_item(qty=Decimal("500"), route=route, batch_size_kg=1000)
        self._add_template_steps(template, ["EXT", "PRINT", "LAM", "COAT"])

        jobs = JobService.create_jobs_for_so_item(item)

        by_node = {job.route_node_id: job for job in jobs}
        self.assertEqual(
            {node_id: job.current_step_index for node_id, job in by_node.items()},
            {
                "step_1_EXT": 0,
                "step_2_PRINT": 1,
                "step_3_LAM": 2,
                "step_4_COAT": 3,
            },
        )
        self.assertEqual(by_node["step_4_COAT"].to_location.type, "FG")
        self.assertEqual(RouteGraphService.initial_node_ids(RouteGraphService.nodes_for_span(route, 0, 3)), {"step_1_EXT", "step_2_PRINT"})

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
    def test_two_thousand_kg_three_layer_route_splits_into_parallel_batches(self, _bom_ready, _requirements):
        route = self._three_layer_route()
        _template, item = self._template_and_item(
            qty=Decimal("2000"),
            route=route,
            batch_size_kg=750,
            layer_snapshot=[
                {"material_code": "PET", "source_mode": "EXTRUDE"},
                {"material_code": "INK", "source_mode": "PRINT"},
                {"material_code": "PP", "source_mode": "EXTRUDE"},
            ],
        )

        jobs = JobService.create_jobs_for_so_item(item)

        self.assertEqual(len(jobs), 12)
        batches = list(ProductionBatch.objects.filter(sales_order_item=item).order_by("batch_sequence"))
        self.assertEqual([batch.planned_qty for batch in batches], [Decimal("750.0000"), Decimal("750.0000"), Decimal("500.0000")])
        self.assertEqual([batch.source for batch in batches], ["AUTO_SPLIT", "AUTO_SPLIT", "AUTO_SPLIT"])
        for batch in batches:
            batch_jobs = ProductionJob.objects.filter(production_batch=batch)
            self.assertEqual(batch_jobs.count(), 4)
            self.assertEqual(
                set(batch_jobs.values_list("route_node_id", "route_branch_key", "quantity")),
                {
                    ("base_ext", "MAIN", batch.planned_qty),
                    ("face_print", "PRINT", batch.planned_qty),
                    ("third_layer_ext", "THIRD_LAYER", batch.planned_qty),
                    ("lam", "MAIN", batch.planned_qty),
                },
            )
            lam_job = batch_jobs.get(route_node_id="lam")
            self.assertEqual(set(lam_job.route_predecessor_node_ids), {"face_print", "third_layer_ext"})

        summary = BatchExecutionService.line_summary(item)
        self.assertEqual(summary["batch_count"], 3)
        self.assertEqual([row["planned_qty"] for row in summary["batches"]], [750.0, 750.0, 500.0])
        first_route_nodes = summary["batches"][0]["route_graph"]["nodes"]
        self.assertTrue(any(node["is_join"] and node["id"] == "lam" for node in first_route_nodes))
        self.assertTrue(any(node["is_parallel_start"] and node["id"] == "base_ext" for node in first_route_nodes))

    @patch("apps.production.services.services_execution.ExecutionService.calculate_requirements")
    @patch("apps.production.services.job_services.require_bom_ready_for_production")
    def test_planner_skip_optional_step_releases_successor_after_previous_completion(self, _bom_ready, _requirements):
        self.processes["PRINT"].allows_optional_at_planning = True
        self.processes["PRINT"].save(update_fields=["allows_optional_at_planning"])
        route = self._linear_route()
        template, item = self._template_and_item(qty=Decimal("500"), route=route)
        self._add_template_steps(template, ["EXT", "PRINT", "LAM"], optional_codes={"PRINT"})
        JobService.create_jobs_for_so_item(item)
        batch = item.production_batches.get()
        jobs = {job.route_node_id: job for job in ProductionJob.objects.filter(production_batch=batch)}

        skipped = JobService.skip_route_step(jobs["print"], decision_source="PLANNER", reason="No print required")
        skipped.refresh_from_db()
        self.assertEqual(skipped.job_state, "COMPLETED")
        self.assertEqual(skipped.meta_json["route_step_decision"]["decision"], "PLANNED_SKIPPED")

        jobs["ext"].job_state = "COMPLETED"
        jobs["ext"].status = "COMPLETED"
        jobs["ext"].save(update_fields=["job_state", "status"])
        JobService._release_ready_successors(jobs["ext"])

        jobs["lam"].refresh_from_db()
        batch.refresh_from_db()
        self.assertEqual(jobs["lam"].job_state, "RELEASED")
        decisions = batch.meta_json.get("route_decisions", [])
        self.assertEqual(decisions[0]["route_node_id"], "print")
        self.assertEqual(decisions[0]["decision"], "PLANNED_SKIPPED")

    @patch("apps.production.services.services_execution.ExecutionService.calculate_requirements")
    @patch("apps.production.services.job_services.require_bom_ready_for_production")
    def test_wcm_skip_option_appears_after_previous_output_and_skips_batch_step(self, _bom_ready, _requirements):
        self.processes["PRINT"].allows_skip_after_previous_output = True
        self.processes["PRINT"].save(update_fields=["allows_skip_after_previous_output"])
        route = self._linear_route()
        template, item = self._template_and_item(qty=Decimal("500"), route=route)
        self._add_template_steps(template, ["EXT", "PRINT", "LAM"], runtime_skip_codes={"PRINT"})
        JobService.create_jobs_for_so_item(item)
        batch = item.production_batches.get()
        jobs = {job.route_node_id: job for job in ProductionJob.objects.filter(production_batch=batch)}

        self.assertEqual(JobService.runtime_skip_options_for_job(jobs["ext"]), [])
        jobs["ext"].job_state = "COMPLETED"
        jobs["ext"].status = "COMPLETED"
        jobs["ext"].save(update_fields=["job_state", "status"])

        options = JobService.runtime_skip_options_for_job(jobs["ext"])
        self.assertEqual([option["route_node_id"] for option in options], ["print"])

        skipped = JobService.skip_route_step(
            jobs["print"],
            decision_source="WCM",
            previous_job=jobs["ext"],
            reason="Produced roll can bypass print",
        )

        skipped.refresh_from_db()
        jobs["lam"].refresh_from_db()
        self.assertEqual(skipped.meta_json["route_step_decision"]["decision"], "RUNTIME_SKIPPED")
        self.assertEqual(jobs["lam"].job_state, "RELEASED")

    @patch("apps.production.services.services_execution.ExecutionService.calculate_requirements")
    @patch("apps.production.services.job_services.require_bom_ready_for_production")
    def test_three_layer_lamination_waits_for_matching_batch_predecessors(self, _bom_ready, _requirements):
        route = self._three_layer_route()
        _template, item = self._template_and_item(qty=Decimal("2000"), route=route, batch_size_kg=750)
        JobService.create_jobs_for_so_item(item)
        batch_1, batch_2, _batch_3 = list(item.production_batches.order_by("batch_sequence"))

        jobs_1 = {job.route_node_id: job for job in ProductionJob.objects.filter(production_batch=batch_1)}
        jobs_2 = {job.route_node_id: job for job in ProductionJob.objects.filter(production_batch=batch_2)}

        jobs_1["base_ext"].job_state = "COMPLETED"
        jobs_1["base_ext"].save(update_fields=["job_state"])
        self.assertEqual(
            {job.route_node_id for job in RouteGraphService.ready_successor_jobs(jobs_1["base_ext"])},
            {"face_print", "third_layer_ext"},
        )

        jobs_1["face_print"].job_state = "COMPLETED"
        jobs_1["face_print"].save(update_fields=["job_state"])
        jobs_2["third_layer_ext"].job_state = "COMPLETED"
        jobs_2["third_layer_ext"].save(update_fields=["job_state"])
        self.assertEqual(RouteGraphService.ready_successor_jobs(jobs_1["face_print"]), [])

        jobs_1["third_layer_ext"].job_state = "COMPLETED"
        jobs_1["third_layer_ext"].save(update_fields=["job_state"])
        self.assertEqual(
            {job.route_node_id for job in RouteGraphService.ready_successor_jobs(jobs_1["third_layer_ext"])},
            {"lam"},
        )

    @patch("apps.production.services.services_execution.ExecutionService.calculate_requirements")
    @patch("apps.production.services.job_services.require_bom_ready_for_production")
    def test_lamination_roll_pool_is_scoped_to_matching_batch(self, _bom_ready, _requirements):
        material = InventoryMaterial.objects.create(
            code="BATCH-PET",
            name="Batch PET",
            category="FILM_VARIANT",
        )
        route = self._three_layer_route()
        _template, item = self._template_and_item(
            qty=Decimal("2000"),
            route=route,
            batch_size_kg=750,
            layer_snapshot=[
                {"variant_id": str(material.id), "thickness_micron": 12, "roll_width_mm": 500},
                {"variant_id": str(material.id), "thickness_micron": 12, "roll_width_mm": 500},
                {"variant_id": str(material.id), "thickness_micron": 12, "roll_width_mm": 500},
            ],
        )
        JobService.create_jobs_for_so_item(item)
        batch_1, batch_2, _batch_3 = list(item.production_batches.order_by("batch_sequence"))
        jobs_1 = {job.route_node_id: job for job in ProductionJob.objects.filter(production_batch=batch_1)}
        jobs_2 = {job.route_node_id: job for job in ProductionJob.objects.filter(production_batch=batch_2)}

        def output_roll(label, source_job):
            return InventoryRoll.objects.create(
                label_id=label,
                material=material,
                thickness_micron=Decimal("12.00"),
                width_mm=Decimal("500.00"),
                plant=self.plant,
                location=self.wip,
                original_weight_kg=source_job.quantity,
                weight_kg=source_job.quantity,
                net_weight_kg=source_job.quantity,
                status="AVAILABLE",
                template=item.template,
                current_step_index=source_job.current_step_index,
                completed_step_index=source_job.current_step_index,
                stage_index=source_job.current_step_index,
                created_by_job=source_job,
                production_job=source_job,
                sales_order_item=item,
                meta_json={"roll_role": "OUTPUT"},
            )

        roll_batch_1 = output_roll("B1-PRINT-ROLL", jobs_1["face_print"])
        output_roll("B2-PRINT-ROLL", jobs_2["face_print"])

        eligible = list(RollAllocationService.get_eligible_rolls(jobs_1["lam"]))

        self.assertEqual([roll.label_id for roll in eligible], [roll_batch_1.label_id])

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
