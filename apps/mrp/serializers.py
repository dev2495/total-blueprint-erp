from rest_framework import serializers
from .models import MRPPlan, MRPRequirement, MRPSuggestion
from apps.materials.serializers import InventoryMaterialLiteSerializer

class MRPSuggestionSerializer(serializers.ModelSerializer):
    material_details = InventoryMaterialLiteSerializer(source='material', read_only=True)
    action = serializers.SerializerMethodField()
    material_name = serializers.CharField(source='material.name', read_only=True)
    material_code = serializers.CharField(source='material.code', read_only=True)
    quantity = serializers.DecimalField(source='qty', max_digits=15, decimal_places=4, read_only=True)
    unit = serializers.SerializerMethodField()
    
    def get_action(self, obj):
        t = str(obj.type or '').upper()
        if t == 'MTS_PRODUCE':
            return 'PRODUCE'
        if t == 'PURCHASE':
            return 'PURCHASE'
        if t == 'TRANSFER':
            return 'TRANSFER'
        return t or 'UNKNOWN'

    def get_unit(self, obj):
        return str(getattr(obj.material, "base_uom", "") or "KG").upper()

    class Meta:
        model = MRPSuggestion
        fields = [
            'id',
            'plan',
            'type',
            'action',
            'material',
            'material_details',
            'material_name',
            'material_code',
            'qty',
            'quantity',
            'unit',
            'reason',
            'required_date',
            'priority',
            'action_status',
            'draft_ref',
            'source_plant',
            'target_plant',
            'created_at',
        ]

class MRPRequirementSerializer(serializers.ModelSerializer):
    material_details = InventoryMaterialLiteSerializer(source='material', read_only=True)
    unit = serializers.SerializerMethodField()

    def get_unit(self, obj):
        return str(getattr(obj.material, "base_uom", "") or "KG").upper()
    
    class Meta:
        model = MRPRequirement
        fields = '__all__'

class MRPPlanSerializer(serializers.ModelSerializer):
    requirements = MRPRequirementSerializer(many=True, read_only=True)
    suggestions = MRPSuggestionSerializer(many=True, read_only=True)
    created_by_name = serializers.CharField(source='created_by.get_full_name', read_only=True)
    plant_name = serializers.CharField(source='plant.name', read_only=True)

    class Meta:
        model = MRPPlan
        fields = [
            'id', 'plant', 'plant_name', 'status', 
            'total_demand_kg', 'total_available_kg', 'total_wip_kg', 'total_shortage_kg', 'purchase_value_est',
            'created_by', 'created_by_name', 'created_at', 'updated_at',
            'requirements', 'suggestions'
        ]
