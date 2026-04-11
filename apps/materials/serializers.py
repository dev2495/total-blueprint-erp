from rest_framework import serializers
from django.utils.text import slugify
from .models import CommercialFamily, GranuleQualityCode, InventoryMaterial, PodSku, PodSkuVariant
from apps.inventory.models import InkMaterial
import uuid

class InventoryMaterialLiteSerializer(serializers.ModelSerializer):
    class Meta:
        model = InventoryMaterial
        fields = ['id', 'code', 'name', 'category', 'status']


class CommercialFamilySerializer(serializers.ModelSerializer):
    class Meta:
        model = CommercialFamily
        fields = [
            'id',
            'code',
            'name',
            'default_form',
            'default_reporting_group',
            'active',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate_code(self, value):
        return str(value or '').upper().strip()

class InventoryMaterialSerializer(serializers.ModelSerializer):
    category_display = serializers.CharField(source='get_category_display', read_only=True)
    commercial_family_name = serializers.CharField(source='commercial_family.name', read_only=True, allow_null=True)
    class Meta:
        model = InventoryMaterial
        fields = [
            'id', 'code', 'name', 'category', 'category_display', 
            'base_uom', 'status', 'is_extrudable', 'is_purchasable',
            'packaging_kind', 'packaging_supply_mode', 'per_sheet_base_qty',
            'commercial_family', 'commercial_family_name',
        ]

class FilmFamilySerializer(serializers.ModelSerializer):
    commercial_family_name = serializers.CharField(source='commercial_family.name', read_only=True, allow_null=True)
    class Meta:
        model = InventoryMaterial
        fields = ['id', 'name', 'density_gcm3', 'status', 'created_at', 'commercial_family', 'commercial_family_name']
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
    commercial_family_name = serializers.CharField(source='commercial_family.name', read_only=True, allow_null=True)

    class Meta:
        model = InventoryMaterial
        fields = [
            'id', 'code', 'name', 'parent_family', 'parent_family_name', 
            'grade', 'grade_name', 'is_extrudable', 'is_purchasable', 
            'status', 'created_at', 'commercial_family', 'commercial_family_name'
        ]
        read_only_fields = ['id', 'created_at']

    def validate(self, attrs):
        # Grade is a transaction-level physical spec: sales/order layer, GRN roll,
        # produced roll, and recipe selector own it. The variant master remains
        # a reusable material identity such as Milky, Metalized, or Transparent.
        attrs['grade'] = None
        return attrs

    def create(self, validated_data):
        validated_data['category'] = 'FILM_VARIANT'
        # variants usually use same UOM as family or specific? Assuming KG for film
        validated_data['base_uom'] = 'KG' 
        return super().create(validated_data)

class GranuleQualityCodeSerializer(serializers.ModelSerializer):
    granule_name = serializers.CharField(source="granule.name", read_only=True)
    granule_material_code = serializers.CharField(source="granule.code", read_only=True)

    class Meta:
        model = GranuleQualityCode
        fields = [
            "id",
            "granule",
            "granule_name",
            "granule_material_code",
            "code",
            "status",
            "notes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "granule_name", "granule_material_code"]

    def validate_code(self, value):
        value = str(value or "").strip().upper()
        if not value:
            raise serializers.ValidationError("Quality code is required.")
        return value

    def validate(self, attrs):
        granule = attrs.get("granule") or getattr(self.instance, "granule", None)
        if granule and str(getattr(granule, "category", "") or "").upper() != "GRANULE":
            raise serializers.ValidationError({"granule": "Quality code can only be attached to a granule."})
        return attrs


class GranuleSerializer(serializers.ModelSerializer):
    quality_codes = GranuleQualityCodeSerializer(many=True, read_only=True)
    quality_code_count = serializers.SerializerMethodField()

    class Meta:
        model = InventoryMaterial
        fields = ['id', 'code', 'name', 'status', 'created_at', 'quality_codes', 'quality_code_count']
        read_only_fields = ['id', 'created_at']

    def get_quality_code_count(self, obj):
        return obj.quality_codes.count()

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
    production_template_name = serializers.CharField(source="production_template.name", read_only=True, allow_null=True)

    class Meta:
        model = InventoryMaterial
        fields = [
            'id',
            'code',
            'name',
            'base_uom',
            'packaging_kind',
            'packaging_supply_mode',
            'production_template',
            'production_template_name',
            'packaging_defaults_json',
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
        in_house_kinds = {"INNER_POUCH", "SHEET"}
        if supply_mode in {'IN_HOUSE', 'BOTH'} and kind not in in_house_kinds:
            raise serializers.ValidationError({'packaging_supply_mode': f'{kind} cannot be IN_HOUSE in this phase.'})
        if supply_mode in {'IN_HOUSE', 'BOTH'} and not attrs.get('production_template', getattr(self.instance, 'production_template', None)):
            raise serializers.ValidationError({'production_template': 'In-house packaging materials require a linked production template.'})
        return attrs

    def create(self, validated_data):
        validated_data['category'] = 'PACKAGING'
        return super().create(validated_data)


class PodSkuVariantSerializer(serializers.ModelSerializer):
    pod_sku_code = serializers.CharField(source='pod_sku.code', read_only=True)
    pod_sku_name = serializers.CharField(source='pod_sku.name', read_only=True)
    material_code = serializers.CharField(source='material.code', read_only=True)
    material_name = serializers.CharField(source='material.name', read_only=True)
    material_status = serializers.CharField(source='material.status', read_only=True)
    pod_type = serializers.CharField(source='material.pod_type', read_only=True, allow_null=True)
    pod_fixed_height_mm = serializers.DecimalField(source='material.pod_fixed_height_mm', max_digits=10, decimal_places=2, read_only=True)
    pod_thickness_micron = serializers.DecimalField(source='material.pod_thickness_micron', max_digits=10, decimal_places=3, read_only=True)
    pod_panel_count = serializers.IntegerField(source='material.pod_panel_count', read_only=True)
    pod_is_inhouse_produced = serializers.BooleanField(source='material.pod_is_inhouse_produced', read_only=True)
    density_gcm3 = serializers.DecimalField(source='material.density_gcm3', max_digits=6, decimal_places=4, read_only=True)

    class Meta:
        model = PodSkuVariant
        fields = [
            'id',
            'pod_sku',
            'pod_sku_code',
            'pod_sku_name',
            'material',
            'material_code',
            'material_name',
            'material_status',
            'code',
            'name',
            'active',
            'production_defaults_json',
            'reporting_attributes_json',
            'pod_type',
            'pod_fixed_height_mm',
            'pod_thickness_micron',
            'pod_panel_count',
            'pod_is_inhouse_produced',
            'density_gcm3',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class PodSkuSerializer(serializers.ModelSerializer):
    variants = PodSkuVariantSerializer(many=True, read_only=True)
    active_variant_count = serializers.SerializerMethodField()

    class Meta:
        model = PodSku
        fields = [
            'id',
            'code',
            'name',
            'family',
            'active',
            'variants',
            'active_variant_count',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_active_variant_count(self, obj):
        return obj.variants.filter(active=True).count()
