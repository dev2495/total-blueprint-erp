from django.test import TestCase

from apps.factory.models import Process
from apps.production.models import ProductionJob
from apps.production.services.batch_route_service import RouteGraphService
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.templates.models import TemplateBlueprint
from apps.users.models import User
from rest_framework.test import APIRequestFactory, force_authenticate
from .models import RoutingRule
from .serializers import RoutingRuleSerializer
from .views import RoutingRuleViewSet


class RoutingRuleSerializerTests(TestCase):
    def test_route_graph_input_strips_batch_execution_policy(self):
        for code in ("EXT", "PRT", "LAM"):
            Process.objects.create(code=code, name=code)
        serializer = RoutingRuleSerializer(
            data={
                "name": "Flow only route",
                "description": "",
                "ordered_processes": ["EXT", "PRT", "LAM"],
                "route_graph": {
                    "execution_policy": {"default_batch_size_kg": 500},
                    "batch_policy": {"allow_partial_movement": True},
                    "nodes": [
                        {"id": "ext", "process_code": "EXT", "route_index": 0},
                        {"id": "prt", "process_code": "PRT", "route_index": 0},
                        {"id": "lam", "process_code": "LAM", "route_index": 1},
                    ],
                    "edges": [
                        {"from": "ext", "to": "lam"},
                        {"from": "prt", "to": "lam"},
                    ],
                },
            }
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
        route_graph = serializer.validated_data["route_graph"]
        self.assertNotIn("execution_policy", route_graph)
        self.assertNotIn("batch_policy", route_graph)
        self.assertEqual(len(route_graph["nodes"]), 3)

    def test_route_rejects_unknown_process_before_any_template_step_can_be_removed(self):
        serializer = RoutingRuleSerializer(
            data={
                "name": "Invalid route",
                "ordered_processes": ["MISSING-PROCESS"],
            }
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("Unknown Process", str(serializer.errors))

    def test_parallel_route_preserves_distinct_nodes_using_the_same_process(self):
        for code in ("EXT", "LAM"):
            Process.objects.create(code=code, name=code)
        graph = {
            "nodes": [
                {"id": "l1_ext", "process_code": "EXT", "route_index": 0, "template_step_index": 0},
                {"id": "l2_ext", "process_code": "EXT", "route_index": 0, "template_step_index": 1},
                {
                    "id": "lam", "process_code": "LAM", "route_index": 1,
                    "template_step_index": 2, "predecessor_node_ids": ["l1_ext", "l2_ext"],
                },
            ],
        }
        serializer = RoutingRuleSerializer(data={
            "name": "Dual extrusion join", "ordered_processes": ["EXT", "EXT", "LAM"],
            "route_graph": graph,
        })

        self.assertTrue(serializer.is_valid(), serializer.errors)
        route = serializer.save()
        self.assertEqual(route.ordered_processes, ["EXT", "EXT", "LAM"])
        self.assertEqual(route.route_graph, graph)

        update = RoutingRuleSerializer(route, data={
            "description": "Updated planner route", "ordered_processes": ["EXT", "EXT", "LAM"],
        }, partial=True)
        self.assertTrue(update.is_valid(), update.errors)
        update.save()
        route.refresh_from_db()
        self.assertEqual(route.ordered_processes, ["EXT", "EXT", "LAM"])
        self.assertEqual(route.route_graph, graph)

    def test_repeated_linear_processes_are_preserved_in_sequence(self):
        Process.objects.create(code="LAM", name="Lamination")
        serializer = RoutingRuleSerializer(data={
            "name": "Repeated lamination passes", "ordered_processes": ["LAM", "LAM"],
        })

        self.assertTrue(serializer.is_valid(), serializer.errors)
        serializer.save()
        self.assertEqual(RoutingRule.objects.get(name="Repeated lamination passes").ordered_processes, ["LAM", "LAM"])


class RoutingRuleHistoryTests(TestCase):
    def setUp(self):
        self.user = User.objects.create(username="route-history-owner", is_owner=True)
        self.process = Process.objects.create(code="ROUTE-HISTORY-EXT", name="Extrusion")
        self.graph = {"nodes": [
            {"id": "ext", "process_code": self.process.code, "route_index": 0},
            {"id": "lam", "process_code": self.process.code, "route_index": 1, "predecessor_node_ids": ["ext"]},
        ]}
        self.route = RoutingRule.objects.create(name="History route", ordered_processes=[self.process.code, self.process.code], route_graph=self.graph)

    def _patch_graph(self, graph):
        request = APIRequestFactory().patch(f"/api/routing/rules/{self.route.pk}/", {"route_graph": graph}, format="json")
        force_authenticate(request, self.user)
        return RoutingRuleViewSet.as_view({"patch": "partial_update"})(request, pk=str(self.route.pk))

    def test_graph_edit_is_locked_by_current_template(self):
        TemplateBlueprint.objects.create(name="Current graph template", routing_rule=self.route, status="LIVE")
        response = self._patch_graph({"nodes": [{"id": "new", "process_code": self.process.code, "route_index": 0}]})
        self.assertEqual(response.status_code, 409, response.data)
        self.route.refresh_from_db()
        self.assertEqual(self.route.route_graph, self.graph)

    def test_graph_edit_cannot_remove_released_job_dependency_on_obsolete_template(self):
        template = TemplateBlueprint.objects.create(name="Historical graph template", routing_rule=self.route, status="OBSOLETE", is_current_version=False)
        order = SalesOrder.objects.create(customer_name="Route history customer", status="RELEASED")
        item = SalesOrderItem.objects.create(sales_order=order, template=template, qty_value=10, unit_price=1, line_status="RELEASED")
        ProductionJob.objects.create(job_number="HISTORY-EXT", template=template, routing_rule=self.route, sales_order_item=item, route_node_id="ext", current_step_index=0, job_state="RELEASED", quantity=10, remaining_qty=10)
        waiting = ProductionJob.objects.create(job_number="HISTORY-LAM", template=template, routing_rule=self.route, sales_order_item=item, route_node_id="lam", current_step_index=1, job_state="WAITING", quantity=10, remaining_qty=10)
        self.assertFalse(RouteGraphService.predecessor_jobs_complete(waiting))
        changed = {"nodes": [
            {"id": "ext", "process_code": self.process.code, "route_index": 0},
            {"id": "lam", "process_code": self.process.code, "route_index": 1},
        ]}

        response = self._patch_graph(changed)

        self.assertEqual(response.status_code, 409, response.data)
        waiting.refresh_from_db()
        self.assertFalse(RouteGraphService.predecessor_jobs_complete(waiting))

    def test_unused_route_graph_remains_editable(self):
        changed = {"nodes": [{"id": "ext", "process_code": self.process.code, "route_index": 0}]}
        response = self._patch_graph(changed)
        self.assertEqual(response.status_code, 200, response.data)
        self.route.refresh_from_db()
        self.assertEqual(self.route.route_graph, changed)

    def test_null_graph_cannot_clear_a_current_template_dependency_graph(self):
        TemplateBlueprint.objects.create(name="Cannot clear graph template", routing_rule=self.route, status="LIVE")
        response = self._patch_graph(None)
        self.assertEqual(response.status_code, 409, response.data)
        self.route.refresh_from_db()
        self.assertEqual(self.route.route_graph, self.graph)

    def test_identical_graph_remains_saveable_for_linked_templates(self):
        TemplateBlueprint.objects.create(name="Unchanged graph template", routing_rule=self.route, status="LIVE")
        self.assertEqual(self._patch_graph(self.graph).status_code, 200)
