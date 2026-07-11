from rest_framework import serializers
from .models import RoutingRule
from apps.factory.models import Process

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
        codes = [str(code or "").strip() for code in value]
        if not codes or any(not code for code in codes):
            raise serializers.ValidationError("A route must contain one or more non-empty Process codes.")
        if len({code.upper() for code in codes}) != len(codes):
            raise serializers.ValidationError("A route cannot contain the same Process more than once.")
        known_rows = list(Process.objects.filter(code__in=codes).values_list("code", flat=True))
        canonical_by_upper = {code.upper(): code for code in known_rows}
        missing = [code for code in codes if code.upper() not in canonical_by_upper]
        if missing:
            raise serializers.ValidationError(
                f"Unknown Process code(s): {', '.join(missing)}. Create or select the Process Master before saving the route."
            )
        return [canonical_by_upper[code.upper()] for code in codes]

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
        cleaned = dict(value)
        for policy_key in ("execution_policy", "batch_execution_policy", "batch_policy"):
            cleaned.pop(policy_key, None)
        return cleaned
