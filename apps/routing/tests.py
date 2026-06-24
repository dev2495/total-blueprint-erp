from django.test import TestCase

from .serializers import RoutingRuleSerializer


class RoutingRuleSerializerTests(TestCase):
    def test_route_graph_input_strips_batch_execution_policy(self):
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
