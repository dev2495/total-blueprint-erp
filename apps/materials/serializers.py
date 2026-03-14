from rest_framework import serializers
from django.utils.text import slugify
from .models import InventoryMaterial
from apps.inventory.models import InkMaterial
import uuid

class InventoryMaterialLiteSerializer(serializers.ModelSerializer):
    class Meta:
        model = InventoryMaterial
        fields = ['id', 'code', 'name', 'category', 'status']

class InventoryMaterialSerializer(serializers.ModelSerializer):
    category_display = serializers.CharField(source='get_category_display', read_only=True)
    class Meta:
        model = InventoryMaterial
        fields = [
            'id', 'code', 'name', 'category', 'category_display', 
            'base_uom', 'status', 'is_extrudable', 'is_purchasable',
            'packaging_kind', 'packaging_supply_mode', 'per_sheet_base_qty'
        ]

class FilmFamilySerializer(serializers.ModelSerializer):
    class Meta:
        model = InventoryMaterial
        fields = ['id', 'name', 'density_gcm3', 'status', 'created_at']
        read_only_fields = ['id', 'created_at']
    
    def create(self, validated_data):
        name = validated_data.get('name', '')
        # Auto-generate code if not provided (Film families usually don't need manual codes)
        validated_data['code'] = f"{slugify(name)}-{str(uuid.uuid4())[:8]}"
        validated_data['category'] = 'FILM_FAMILY'
        validated_data['base_uom'] = 'KG' # Default
        validated_data['is_purchasable'] = True
        validated_data['is_extrudable'] = False
        return super().create(validated_data)

class FilmVariantSerializer(serializers.ModelSerializer):
    parent_family_name = serializers.CharField(source='parent_family.name', read_only=True)
    grade_name = serializers.CharField(source='grade.name', read_only=True)

    class Meta:
        model = InventoryMaterial
        fields = [
            'id', 'code', 'name', 'parent_family', 'parent_family_name', 
            'grade', 'grade_name', 'is_extrudable', 'is_purchasable', 
            'status', 'created_at'
        ]
        read_only_fields = ['id', 'created_at']

    def validate(self, attrs):
        is_extrudable = attrs.get('is_extrudable', getattr(self.instance, 'is_extrudable', False))
        grade = attrs.get('grade', getattr(self.instance, 'grade', None))
        if is_extrudable and not grade:
            raise serializers.ValidationError({'grade': "Grade is required for extrudable film variants."})
        if not is_extrudable:
            attrs['grade'] = None
        return attrs

    def create(self, validated_data):
        validated_data['category'] = 'FILM_VARIANT'
        # variants usually use same UOM as family or specific? Assuming KG for film
        validated_data['base_uom'] = 'KG' 
        return super().create(validated_data)

class GranuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = InventoryMaterial
        fields = ['id', 'code', 'name', 'status', 'created_at']
        read_only_fields = ['id', 'created_at']

    def create(self, validated_data):
        validated_data['category'] = 'GRANULE'
        validated_data['base_uom'] = 'KG'
        return super().create(validated_data)

class InkSerializer(serializers.ModelSerializer):
    name = serializers.CharField(required=False, allow_blank=True)
    
    class Meta:
        model = InkMaterial
        fields = ['id', 'code', 'name', 'base_type', 'color_name', 'status', 'created_at']
        read_only_fields = ['id', 'code', 'created_at']

    def validate_color_name(self, value):
        return value.upper().strip()

    def create(self, validated_data):
        # InkMaterial.save() handles category='INK' and code/name generation
        # We just need to ensure standard permissions
        return super().create(validated_data)

class AdhesiveSolventSerializer(serializers.ModelSerializer):
    class Meta:
        model = InventoryMaterial
        fields = ['id', 'code', 'name', 'category', 'status', 'created_at']
        read_only_fields = ['id', 'created_at']

    def validate_category(self, value):
        if value not in ['ADHESIVE', 'SOLVENT']:
            raise serializers.ValidationError("Category must be ADHESIVE or SOLVENT")
        return value

    def create(self, validated_data):
        validated_data['base_uom'] = 'KG'
        return super().create(validated_data)

class AddonSerializer(serializers.ModelSerializer):
    class Meta:
        model = InventoryMaterial
        fields = ['id', 'code', 'name', 'weight_mode', 'weight_value', 'status', 'created_at']
        read_only_fields = ['id', 'created_at']

    def create(self, validated_data):
        validated_data['category'] = 'ADDON'
        validated_data['base_uom'] = 'KG' # Usually KG or Unit? Base UOM KG is fine, weight_mode handles consumption.
        return super().create(validated_data)

class PODSerializer(serializers.ModelSerializer):
    class Meta:
        model = InventoryMaterial
        fields = [
            'id',
            'code',
            'name',
            'pod_type',
            'pod_fixed_height_mm',
            'pod_thickness_micron',
            'pod_panel_count',
            'pod_is_inhouse_produced',
            'density_gcm3',
            'status',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at']

    def create(self, validated_data):
        validated_data['category'] = 'POD'
        validated_data['base_uom'] = 'KG'
        code = str(validated_data.get('code') or '').upper()
        pod_type = str(validated_data.get('pod_type') or '').upper()
        if not pod_type:
            pod_type = 'DOUBLE' if 'DOUBLE' in code else 'SINGLE'
            validated_data['pod_type'] = pod_type
        if validated_data.get('pod_fixed_height_mm') is None:
            validated_data['pod_fixed_height_mm'] = 240 if pod_type == 'DOUBLE' else 200
        if validated_data.get('pod_thickness_micron') is None:
            validated_data['pod_thickness_micron'] = 30
        if validated_data.get('density_gcm3') is None:
            validated_data['density_gcm3'] = 0.92
        if validated_data.get('pod_panel_count') is None:
            validated_data['pod_panel_count'] = 2 if pod_type == 'DOUBLE' else 1
        if validated_data.get('pod_is_inhouse_produced') is None:
            validated_data['pod_is_inhouse_produced'] = True
        return super().create(validated_data)


class PackagingSerializer(serializers.ModelSerializer):
    class Meta:
        model = InventoryMaterial
        fields = [
            'id',
            'code',
            'name',
            'base_uom',
            'packaging_kind',
            'packaging_supply_mode',
            'per_sheet_base_qty',
            'status',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at']

    def validate(self, attrs):
        kind = attrs.get('packaging_kind', getattr(self.instance, 'packaging_kind', None))
        supply_mode = attrs.get('packaging_supply_mode', getattr(self.instance, 'packaging_supply_mode', None))
        if not kind:
            raise serializers.ValidationError({'packaging_kind': 'packaging_kind is required for packaging materials.'})
        if not supply_mode:
            raise serializers.ValidationError({'packaging_supply_mode': 'packaging_supply_mode is required for packaging materials.'})
        if kind == 'GONNY' and supply_mode == 'IN_HOUSE':
            raise serializers.ValidationError({'packaging_supply_mode': 'GONNY cannot be IN_HOUSE.'})
        return attrs

    def create(self, validated_data):
        validated_data['category'] = 'PACKAGING'
        return super().create(validated_data)
