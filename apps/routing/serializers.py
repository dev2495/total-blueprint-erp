from rest_framework import serializers
from .models import RoutingRule

class RoutingRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = RoutingRule
        fields = [
            'id', 'name', 'description', 
            'ordered_processes', 'route_graph', 'allowed_workcenters',
            'interplant_required', 'is_active'
        ]

    def validate_ordered_processes(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("ordered_processes must be a list of process codes.")
        return value

    def validate_route_graph(self, value):
        if value in (None, ""):
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError("route_graph must be an object with optional nodes and edges.")
        nodes = value.get("nodes", [])
        edges = value.get("edges", [])
        if nodes and not isinstance(nodes, list):
            raise serializers.ValidationError("route_graph.nodes must be a list.")
        if edges and not isinstance(edges, list):
            raise serializers.ValidationError("route_graph.edges must be a list.")
        return value
