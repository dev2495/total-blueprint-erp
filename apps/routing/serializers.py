from rest_framework import serializers
from .models import RoutingRule

class RoutingRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = RoutingRule
        fields = [
            'id', 'name', 'description', 
            'ordered_processes', 'allowed_workcenters', 
            'interplant_required', 'is_active'
        ]

    def validate_ordered_processes(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("ordered_processes must be a list of process codes.")
        return value
