from rest_framework import serializers
from .models import ProductionJob, WorkCenterAssignment, ScrapReason, DowntimeReason
from apps.factory.models import Machine
from apps.materials.models import PodSkuVariant
from apps.users.models import User

class ProductionJobSerializer(serializers.ModelSerializer):
    customer_name = serializers.ReadOnlyField()
    order_number = serializers.ReadOnlyField(source='sales_order_no')
    product_name = serializers.ReadOnlyField()
    work_center_name = serializers.ReadOnlyField(source='work_center.name')
    machine_name = serializers.ReadOnlyField(source='machine.name')
    operator_name = serializers.ReadOnlyField(source='operator.username')
    template_name = serializers.ReadOnlyField(source='template.name')
    process_code = serializers.SerializerMethodField()
    process_category = serializers.SerializerMethodField()
    roll_behavior = serializers.SerializerMethodField()
    layer_count = serializers.SerializerMethodField()
    product_spec = serializers.SerializerMethodField()
    order_placed_at = serializers.SerializerMethodField()

    def get_process_code(self, obj):
        proc = obj.current_process or obj.process
        return proc.code if proc else "N/A"
    
    def get_process_category(self, obj):
        # Process model no longer has category. 
        # We can derive it or remove it. For now, defaulting to OTHERS.
        return "OTHERS"

    def get_roll_behavior(self, obj):
        proc = obj.current_process or obj.process
        return proc.roll_behavior if proc else None

    def get_layer_count(self, obj):
        if obj.sales_order_item and obj.sales_order_item.layer_snapshot:
            return len(obj.sales_order_item.layer_snapshot)
        if getattr(obj, "mts_order", None) and getattr(obj.mts_order, "layer_snapshot", None):
            return len(obj.mts_order.layer_snapshot)
        return 1

    def get_order_placed_at(self, obj):
        if getattr(obj, "sales_order_item", None) and getattr(obj.sales_order_item, "sales_order", None):
            return obj.sales_order_item.sales_order.created_at
        if getattr(obj, "mts_order", None) and getattr(obj.mts_order, "created_at", None):
            return obj.mts_order.created_at
        return obj.created_at
    
    # V2 snapshots for WCM/Shop Floor visibility.
    geometry = serializers.SerializerMethodField()
    layers = serializers.SerializerMethodField()
    printing = serializers.SerializerMethodField()
    addons = serializers.SerializerMethodField()
    bom_snapshot = serializers.SerializerMethodField()
    unit_weight_g = serializers.SerializerMethodField()
    total_weight_kg = serializers.SerializerMethodField()
    execution_profile = serializers.SerializerMethodField()

    # Artwork commitment derived from sales/MTS source
    committed_artwork_id = serializers.SerializerMethodField()
    committed_artwork_code = serializers.SerializerMethodField()
    committed_artwork_name = serializers.SerializerMethodField()
    ink_colors = serializers.SerializerMethodField()
    current_step_print_capable = serializers.SerializerMethodField()

    def _resolve_committed_artwork(self, obj):
        try:
            if getattr(obj, "sales_order_item_id", None) and getattr(obj.sales_order_item, "assigned_artwork_id", None):
                return obj.sales_order_item.assigned_artwork
        except Exception:
            pass
        try:
            mts = getattr(obj, "mts_order", None)
            if mts and getattr(mts, "committed_artwork_id", None):
                return mts.committed_artwork
        except Exception:
            pass
        return None

    def get_committed_artwork_id(self, obj):
        artwork = self._resolve_committed_artwork(obj)
        return str(artwork.id) if artwork else None

    def get_committed_artwork_code(self, obj):
        artwork = self._resolve_committed_artwork(obj)
        return getattr(artwork, "design_code", "") if artwork else ""

    def get_committed_artwork_name(self, obj):
        artwork = self._resolve_committed_artwork(obj)
        return getattr(artwork, "name", "") if artwork else ""

    def get_ink_colors(self, obj):
        from .services.queue_enrichment import ink_colors_for_artwork

        return ink_colors_for_artwork(self._resolve_committed_artwork(obj))

    def get_current_step_print_capable(self, obj):
        proc = getattr(obj, "current_process", None) or getattr(obj, "process", None)
        if not proc:
            return False
        return bool(getattr(proc, "print_capable", False) or getattr(proc, "has_artwork", False))

    def get_geometry(self, obj):
        if obj.sales_order_item:
            return obj.sales_order_item.geometry_snapshot
        if getattr(obj, "mts_order", None):
            return obj.mts_order.geometry_snapshot or {}
        return {}

    def get_layers(self, obj):
        layers = []
        if obj.sales_order_item:
            layers = list(obj.sales_order_item.layer_snapshot)
        elif getattr(obj, "mts_order", None):
            layers = list(obj.mts_order.layer_snapshot or [])
        
        if not layers:
            return []

        # Resolve IDs to human-readable names
        grade_ids = [L.get('grade_id') for L in layers if L.get('grade_id')]
        variant_ids = [L.get('variant_id') for L in layers if L.get('variant_id')]
        
        from apps.recipes.models import RecipeGrade
        from apps.materials.models import InventoryMaterial
        
        # Batch fetch for efficiency
        grades = {str(g.id): g.name for g in RecipeGrade.objects.filter(id__in=grade_ids)}
        variants = {str(v.id): v.name for v in InventoryMaterial.objects.filter(id__in=variant_ids)}
        
        for L in layers:
            gid = L.get('grade_id')
            vid = L.get('variant_id')
            
            grade_name = grades.get(str(gid)) if gid else None
            variant_name = variants.get(str(vid)) if vid else None
            
            # The user wants "exact layer names"
            # We provide a clean 'name' field that defaults to variant > grade > code > 'Material'
            L['name'] = variant_name or grade_name or L.get('code') or 'Material'
            L['grade_name'] = grade_name
            L['variant_name'] = variant_name
            
        return layers

    def get_printing(self, obj):
        if obj.sales_order_item:
            return obj.sales_order_item.printing_snapshot
        if getattr(obj, "mts_order", None):
            return obj.mts_order.printing_snapshot or {}
        return {}

    def get_addons(self, obj):
        if obj.sales_order_item:
            return obj.sales_order_item.addons_snapshot
        if getattr(obj, "mts_order", None):
            return obj.mts_order.addons_snapshot or []
        return []

    def get_bom_snapshot(self, obj):
        if obj.sales_order_item:
            return obj.sales_order_item.bom_snapshot or {}
        if getattr(obj, "mts_order", None):
            return obj.mts_order.bom_snapshot or {}
        return {}

    def get_execution_profile(self, obj):
        from apps.production.services.services_execution import ExecutionService
        return ExecutionService.get_step_execution_profile(obj.id)

    def get_unit_weight_g(self, obj):
        if obj.sales_order_item:
            return float(obj.sales_order_item.unit_weight_g or 0)
        if getattr(obj, "mts_order", None):
            return float(obj.mts_order.unit_weight_g or 0)
        return 0

    def get_total_weight_kg(self, obj):
        # Calculation logic:
        # If UOM is KG, weight is quantity.
        # If UOM is PCS, weight is quantity * unit_weight / 1000.
        try:
            qty = float(obj.quantity or 0)
            if obj.uom == 'KG':
                return qty
            
            # Fallback to unit weight
            unit_weight = float(self.get_unit_weight_g(obj))
            if unit_weight > 0:
                return (qty * unit_weight) / 1000.0
            
            if obj.sales_order_item:
                return float(obj.sales_order_item.total_weight_kg or 0)
            if getattr(obj, "mts_order", None):
                return float(obj.mts_order.total_weight_kg or 0)
        except (ValueError, TypeError):
            pass
            
        return 0

    def get_product_spec(self, obj):
        from apps.materials.product_spec import build_product_spec

        sales_item = getattr(obj, "sales_order_item", None)
        mts_order = getattr(obj, "mts_order", None)
        geometry = self.get_geometry(obj)
        layers = self.get_layers(obj)
        printing = self.get_printing(obj)
        addons = self.get_addons(obj)
        packaging = getattr(sales_item, "packaging_snapshot", None) if sales_item else getattr(mts_order, "packaging_snapshot", None) if mts_order else {}
        sku_variant = getattr(sales_item, "sku_variant", None) if sales_item else None
        product_master = getattr(sales_item, "product_master", None) if sales_item else None
        product_variant = getattr(sales_item, "product_variant", None) if sales_item else None
        overlay = getattr(sales_item, "customer_product_overlay", None) if sales_item else None
        axis_values = getattr(sales_item, "axis_values", None) if sales_item else {}
        if not isinstance(axis_values, dict) and product_variant is not None:
            axis_values = getattr(product_variant, "axis_values", {}) or {}
        product_name = (
            str(getattr(overlay, "customer_display_name", "") or "").strip()
            or str(getattr(product_master, "name", "") or "").strip()
            or str(getattr(obj, "product_name", "") or "").strip()
        )
        variant_code = (
            str(getattr(product_variant, "code", "") or "").strip()
            or str(getattr(sku_variant, "code", "") or "").strip()
        )
        variant_name = (
            str(getattr(product_variant, "code", "") or "").strip()
            or str(getattr(sku_variant, "name", "") or "").strip()
        )
        return build_product_spec(
            geometry=geometry,
            layers=layers,
            printing=printing,
            addons=addons,
            packaging=packaging or {},
            customer_name=str(getattr(obj, "customer_name", "") or ""),
            order_number=str(getattr(obj, "sales_order_no", "") or ""),
            product_name=product_name,
            template_name=str(getattr(getattr(obj, "template", None), "name", "") or ""),
            variant_code=variant_code,
            variant_name=variant_name,
            product_master_code=str(getattr(product_master, "code", "") or ""),
            product_master_name=str(getattr(product_master, "name", "") or ""),
            product_variant_code=str(getattr(product_variant, "code", "") or ""),
            product_variant_name=str(getattr(product_variant, "code", "") or ""),
            customer_item_code=str(getattr(overlay, "customer_item_code", "") or ""),
            axis_values=axis_values if isinstance(axis_values, dict) else {},
            qty_value=getattr(obj, "quantity", None),
            qty_uom=str(getattr(obj, "uom", "") or ""),
        )

    class Meta:
        model = ProductionJob
        fields = [
            'id', 'job_number', 'status', 'job_state', 'origin', 
            'priority', 'planned_date', 'template', 'template_name',
            'order_placed_at',
            'current_process', 'process_code', 'process_category', 'roll_behavior', 'layer_count',
            'work_center', 'work_center_name', 'machine', 'machine_name',
            'operator', 'operator_name', 'quantity', 'produced_qty', 'remaining_qty', 'uom',
            'closed_with_variance', 'completion_variance_kg', 'completion_force_reason', 'closed_at', 'closed_by',
            'customer_name', 'order_number', 'product_name',
            'current_step_index', 'input_form', 'output_form', 'from_location', 'to_location',
            'execution_model_version',
            'geometry', 'layers', 'printing', 'addons',
            'bom_snapshot', 'unit_weight_g', 'total_weight_kg',
            'execution_profile', 'product_spec',
            'committed_artwork_id', 'committed_artwork_code', 'committed_artwork_name',
            'ink_colors',
            'current_step_print_capable',
        ]
        read_only_fields = ['job_number', 'status']

class ProductionJobSummarySerializer(serializers.ModelSerializer):
    order_number = serializers.ReadOnlyField(source='sales_order_no')
    customer_name = serializers.ReadOnlyField()
    product_name = serializers.ReadOnlyField()
    template_name = serializers.ReadOnlyField(source='template.name')
    work_center_name = serializers.ReadOnlyField(source='work_center.name')
    machine_name = serializers.ReadOnlyField(source='machine.name')
    operator_name = serializers.ReadOnlyField(source='operator.username')
    process_code = serializers.SerializerMethodField()
    process_name = serializers.SerializerMethodField()
    total_weight_kg = serializers.SerializerMethodField()

    def _process(self, obj):
        return obj.current_process or obj.process

    def get_process_code(self, obj):
        proc = self._process(obj)
        return proc.code if proc else "N/A"

    def get_process_name(self, obj):
        proc = self._process(obj)
        return proc.name if proc else "Unassigned"

    def get_total_weight_kg(self, obj):
        try:
            qty = float(obj.quantity or 0)
            if str(obj.uom or "").upper() == "KG":
                return qty
            source = obj.sales_order_item or obj.mts_order
            unit_weight = float(getattr(source, "unit_weight_g", 0) or 0)
            if unit_weight > 0:
                return round((qty * unit_weight) / 1000.0, 3)
            return float(getattr(source, "total_weight_kg", 0) or 0)
        except Exception:
            return 0

    class Meta:
        model = ProductionJob
        fields = [
            'id', 'job_number', 'status', 'job_state', 'origin', 'source_type',
            'priority', 'planned_date', 'created_at', 'updated_at', 'closed_at',
            'template_name', 'order_number', 'customer_name', 'product_name',
            'current_step_index', 'process_code', 'process_name',
            'work_center_name', 'machine_name', 'operator_name',
            'quantity', 'produced_qty', 'remaining_qty', 'total_weight_kg', 'uom',
            'is_on_hold', 'hold_reason', 'closed_with_variance', 'completion_variance_kg',
        ]

from .models import PlannedOrder

class PlannedOrderSerializer(serializers.ModelSerializer):
    template_name = serializers.ReadOnlyField(source='template.name')
    plant_name = serializers.ReadOnlyField(source='plant.name')
    planner_name = serializers.ReadOnlyField(source='created_by.username')

    class Meta:
        model = PlannedOrder
        fields = [
            'id', 'reference_code', 'template', 'template_name',
            'quantity', 'plant', 'plant_name', 'status',
            'planner_name', 'created_at', 'updated_at'
        ]
        read_only_fields = ['reference_code', 'status', 'created_at']

class JobAssignmentSerializer(serializers.Serializer):
    machine = serializers.PrimaryKeyRelatedField(queryset=Machine.objects.all())
    operator = serializers.PrimaryKeyRelatedField(queryset=User.objects.all())

class JobCompletionSerializer(serializers.Serializer):
    actual_qty = serializers.DecimalField(max_digits=12, decimal_places=2)

class WorkCenterAssignmentSerializer(serializers.ModelSerializer):
    job_details = ProductionJobSerializer(source='production_job', read_only=True)
    assigned_machine_name = serializers.ReadOnlyField(source='assigned_machine.name')
    work_center_name = serializers.ReadOnlyField(source='work_center.name')
    plant_id = serializers.ReadOnlyField(source='work_center.plant_id')
    allocated_roll_details = serializers.SerializerMethodField()
    target_stock_contract = serializers.SerializerMethodField()
    
    def get_allocated_roll_details(self, obj):
        from apps.inventory.serializers import RollDetailSerializer
        return RollDetailSerializer(
            obj.allocated_rolls.all(),
            many=True,
            context={'production_job_id': str(obj.production_job_id)}
        ).data

    def get_target_stock_contract(self, obj):
        try:
            from apps.production.services.roll_allocation_service import RollAllocationService
            return RollAllocationService.target_stock_contract(obj.production_job)
        except Exception:
            return {
                "stock_form": "OPEN_WEB",
                "slit_policy": "ALLOWED",
                "width_mm": "0",
                "width_basis": "",
                "source": "serializer_fallback",
            }
    
    class Meta:
        model = WorkCenterAssignment
        fields = [
            'id', 'production_job', 'job_details', 'work_center', 'work_center_name', 'plant_id',
            'assigned_machine', 'assigned_machine_name', 'status', 'allocated_rolls', 'allocated_roll_details',
            'target_stock_contract', 'assigned_by', 'assigned_at', 'created_at'
        ]
        read_only_fields = ['status', 'assigned_at']

from .models import PlannedStockOrder, PlannedBulkStockOrder, PlannerSku, PlannerSkuVariant


def _route_step_count(template):
    if not template:
        return 0
    process_steps = list(template.process_steps.select_related("process").filter(is_removed_from_route=False).order_by("sequence_number"))
    if process_steps:
        return len(process_steps)
    return len(getattr(getattr(template, "routing_rule", None), "ordered_processes", None) or [])


def _first_artwork_step_index(template):
    if not template:
        return None
    process_steps = list(template.process_steps.select_related("process").filter(is_removed_from_route=False).order_by("sequence_number"))
    for index, step in enumerate(process_steps):
        process = getattr(step, "process", None)
        if process and bool(getattr(process, "has_artwork", False) or getattr(process, "print_capable", False)):
            return index
    ordered_codes = getattr(getattr(template, "routing_rule", None), "ordered_processes", None) or []
    if not ordered_codes:
        return None
    from apps.factory.models import Process

    process_map = {p.code: p for p in Process.objects.filter(code__in=ordered_codes)}
    for index, code in enumerate(ordered_codes):
        process = process_map.get(code)
        if process and bool(process.has_artwork or process.print_capable):
            return index
    return None


def _validate_commitment_stop_rule(*, template, stop_idx, commitment_scope, committed_artwork):
    first_artwork_idx = _first_artwork_step_index(template)
    if commitment_scope in {"GENERIC", "CUSTOMER"}:
        if committed_artwork:
            raise serializers.ValidationError({"committed_artwork": "Generic/customer stock cannot be artwork-committed."})
        if first_artwork_idx is not None and stop_idx >= first_artwork_idx:
            raise serializers.ValidationError({"stop_step_index": "Generic/customer stock must stop before the first artwork-capable step."})
    if commitment_scope in {"ARTWORK", "CUSTOMER_ARTWORK"}:
        if first_artwork_idx is None:
            raise serializers.ValidationError({"stop_step_index": "Template has no artwork-capable step; artwork-committed stock is not valid."})
        if stop_idx < first_artwork_idx:
            raise serializers.ValidationError({"stop_step_index": "Artwork-committed stock must stop at or after the first artwork-capable step."})

class PlannedStockOrderSerializer(serializers.ModelSerializer):
    template_name = serializers.ReadOnlyField(source='template.name')
    plant_name = serializers.ReadOnlyField(source='plant.name')
    created_by_name = serializers.ReadOnlyField(source='created_by.username')
    product_master_name = serializers.ReadOnlyField(source='product_master.name')
    product_master_code = serializers.ReadOnlyField(source='product_master.code')
    committed_customer_name = serializers.ReadOnlyField(source='committed_customer.name')
    committed_artwork_design_code = serializers.ReadOnlyField(source='committed_artwork.design_code')
    target_step_index = serializers.SerializerMethodField()
    name = serializers.CharField(source='internal_name', required=False, allow_blank=True)
    quantity = serializers.DecimalField(source='target_qty', max_digits=12, decimal_places=2, required=False)
    geometry = serializers.JSONField(source='geometry_snapshot', required=False)
    film_layers = serializers.JSONField(source='layer_snapshot', required=False)
    printing = serializers.JSONField(source='printing_snapshot', required=False)
    addons = serializers.JSONField(source='addons_snapshot', required=False)
    axis_values = serializers.JSONField(required=False)
    derived_output_type = serializers.SerializerMethodField()
    planner_stock_class = serializers.SerializerMethodField()
    planner_origin_meta = serializers.JSONField(required=False)

    def get_derived_output_type(self, obj):
        template = getattr(obj, "template", None)
        route_steps = (getattr(getattr(template, "routing_rule", None), "ordered_processes", None) or []) if template else []
        route_last = max(0, len(route_steps) - 1)
        stop_idx = int(obj.stop_step_index if obj.stop_step_index is not None else route_last)
        if stop_idx < route_last:
            return "WIP_ROLL"
        fg_type = str(getattr(template, "fg_type", "") or "").upper()
        return "FG_POUCH" if fg_type == "POUCH" else "FG_ROLL"

    def get_target_step_index(self, obj):
        # Backward-compatible alias for older clients.
        if obj.stop_step_index is not None:
            return obj.stop_step_index
        return obj.target_step_index

    def get_planner_stock_class(self, obj):
        return str(getattr(obj, 'planner_stock_class', '') or obj.derive_planner_stock_class())

    def validate(self, attrs):
        stock_purpose = str(attrs.get('stock_purpose', getattr(self.instance, 'stock_purpose', 'PRODUCT')) or 'PRODUCT').upper()
        stock_strategy = str(attrs.get('stock_strategy', getattr(self.instance, 'stock_strategy', 'FINAL_STOCK')) or 'FINAL_STOCK').upper()
        packaging_material = attrs.get('packaging_material', getattr(self.instance, 'packaging_material', None))
        quantity_uom = str(attrs.get('quantity_uom', getattr(self.instance, 'quantity_uom', 'KG')) or 'KG').upper()
        start_step_index = attrs.get('start_step_index', getattr(self.instance, 'start_step_index', 0))
        stop_step_index = attrs.get('stop_step_index', getattr(self.instance, 'stop_step_index', None))
        commitment_scope = str(attrs.get('commitment_scope', getattr(self.instance, 'commitment_scope', 'GENERIC')) or 'GENERIC').upper()
        committed_customer = attrs.get('committed_customer', getattr(self.instance, 'committed_customer', None))
        committed_artwork = attrs.get('committed_artwork', getattr(self.instance, 'committed_artwork', None))

        if commitment_scope not in {'GENERIC', 'CUSTOMER', 'ARTWORK', 'CUSTOMER_ARTWORK'}:
            raise serializers.ValidationError({'commitment_scope': 'Invalid commitment scope.'})
        if commitment_scope in {'CUSTOMER', 'CUSTOMER_ARTWORK'} and not committed_customer:
            raise serializers.ValidationError({'committed_customer': 'Customer commitment requires committed_customer.'})
        if commitment_scope in {'ARTWORK', 'CUSTOMER_ARTWORK'} and not committed_artwork:
            raise serializers.ValidationError({'committed_artwork': 'Artwork commitment requires committed_artwork.'})
        if commitment_scope in {'GENERIC', 'CUSTOMER'}:
            if committed_artwork:
                raise serializers.ValidationError({'committed_artwork': 'Generic/customer WIP cannot be artwork-committed. Stop before print or choose an artwork scope.'})
            attrs['committed_customer'] = None
            if commitment_scope == 'CUSTOMER':
                attrs['committed_customer'] = committed_customer
            attrs['committed_artwork'] = None
        if committed_artwork and str(getattr(committed_artwork, 'status', '') or '').upper() != 'APPROVED':
            raise serializers.ValidationError({'committed_artwork': 'Committed artwork must be APPROVED.'})

        if stock_purpose == 'PACKAGING':
            if not packaging_material:
                raise serializers.ValidationError({'packaging_material': 'packaging_material is required when stock_purpose=PACKAGING.'})
            if str(getattr(packaging_material, 'category', '') or '').upper() != 'PACKAGING':
                raise serializers.ValidationError({'packaging_material': 'packaging_material must be category=PACKAGING.'})
            base_uom = str(getattr(packaging_material, 'base_uom', '') or '').upper()
            if base_uom not in {'KG', 'PCS'}:
                raise serializers.ValidationError({'packaging_material': 'In-house PACKAGING output supports only KG/PCS base_uom in V1.'})
            if quantity_uom != base_uom:
                raise serializers.ValidationError({'quantity_uom': f'quantity_uom must match packaging material base_uom ({base_uom}).'})
            if stock_strategy != 'PACKAGING_STOCK':
                raise serializers.ValidationError({'stock_strategy': 'PACKAGING purpose orders must use PACKAGING_STOCK.'})
        elif packaging_material:
            raise serializers.ValidationError({'packaging_material': 'packaging_material must be empty when stock_purpose=PRODUCT.'})
        elif stock_strategy == 'PACKAGING_STOCK':
            raise serializers.ValidationError({'stock_strategy': 'PACKAGING_STOCK is only valid when stock_purpose=PACKAGING.'})

        template = attrs.get('template', getattr(self.instance, 'template', None))
        route_len = _route_step_count(template)
        route_last = max(0, route_len - 1)
        try:
            stop_idx = int(route_last if stop_step_index is None else stop_step_index)
            start_idx = int(start_step_index or 0)
        except Exception:
            stop_idx = route_last
            start_idx = 0
        if stock_purpose == 'PRODUCT':
            if stop_idx < start_idx:
                raise serializers.ValidationError({'stop_step_index': 'stop_step_index must be >= start_step_index.'})
            if stop_idx < route_last and stock_strategy != 'INTERMEDIATE_POOL':
                raise serializers.ValidationError({'stock_strategy': 'Pre-final product stock orders must use INTERMEDIATE_POOL.'})
            if stop_idx >= route_last and stock_strategy not in {'FINAL_STOCK', 'INTERMEDIATE_POOL'}:
                raise serializers.ValidationError({'stock_strategy': 'Final product stock orders must use FINAL_STOCK or INTERMEDIATE_POOL.'})
            _validate_commitment_stop_rule(
                template=template,
                stop_idx=stop_idx,
                commitment_scope=commitment_scope,
                committed_artwork=committed_artwork,
            )
        return attrs

    class Meta:
        model = PlannedStockOrder
        fields = [
            'id', 'order_number', 'template', 'template_name',
            'plant', 'plant_name', 'name', 'internal_name',
            'product_master', 'product_master_name', 'product_master_code',
            'commitment_scope', 'committed_customer', 'committed_customer_name',
            'committed_artwork', 'committed_artwork_design_code',
            'quantity', 'target_qty', 'quantity_uom', 'produced_qty',
            'axis_values', 'geometry', 'geometry_snapshot', 'geometry_override',
            'film_layers', 'layer_snapshot', 'printing', 'printing_snapshot',
            'addons', 'addons_snapshot', 'packaging_snapshot',
            'bom_snapshot', 'spec_signature',
            'planner_origin_meta',
            'unit_weight_g', 'total_weight_kg',
            'stock_purpose', 'stock_strategy', 'planner_stock_class', 'packaging_material',
            'artwork_assignment_required', 'assigned_artwork',
            'derived_output_type',
            'start_step_index', 'stop_step_index', 'target_step_index',
            'status', 'created_by', 'created_by_name',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['order_number', 'produced_qty', 'status', 'created_by', 'created_at', 'target_step_index', 'internal_name', 'target_qty', 'geometry_snapshot', 'layer_snapshot', 'printing_snapshot', 'addons_snapshot']


class PlannedBulkStockOrderSerializer(serializers.ModelSerializer):
    material_name = serializers.ReadOnlyField(source='material.name')
    material_code = serializers.ReadOnlyField(source='material.code')
    pod_sku_variant = serializers.UUIDField(write_only=True, required=False, allow_null=True)
    pod_sku_variant_code = serializers.SerializerMethodField()
    pod_sku_variant_name = serializers.SerializerMethodField()
    plant_name = serializers.ReadOnlyField(source='plant.name')
    created_by_name = serializers.ReadOnlyField(source='created_by.username')
    quantity_kg = serializers.DecimalField(source='target_qty_kg', max_digits=12, decimal_places=4, required=False)
    name = serializers.CharField(source='internal_name', required=False, allow_blank=True)

    def get_pod_sku_variant_code(self, obj):
        snapshot = getattr(obj, 'pod_profile_snapshot', {}) or {}
        meta = getattr(obj, 'planner_origin_meta', {}) or {}
        return snapshot.get('pod_sku_variant_code') or meta.get('pod_variant_code') or meta.get('pod_sku_code')

    def get_pod_sku_variant_name(self, obj):
        snapshot = getattr(obj, 'pod_profile_snapshot', {}) or {}
        meta = getattr(obj, 'planner_origin_meta', {}) or {}
        return snapshot.get('pod_sku_name') or meta.get('pod_variant_name') or meta.get('pod_sku_name')

    def validate(self, attrs):
        attrs = super().validate(attrs) if hasattr(super(), "validate") else attrs
        pod_sku_variant_id = attrs.pop('pod_sku_variant', None)
        pod_sku_variant = None
        if pod_sku_variant_id:
            pod_sku_variant = PodSkuVariant.objects.select_related('pod_sku', 'material').get(id=pod_sku_variant_id, active=True)
        if pod_sku_variant:
            attrs['material'] = pod_sku_variant.material
            planner_origin_meta = dict(attrs.get('planner_origin_meta') or getattr(self.instance, 'planner_origin_meta', {}) or {})
            planner_origin_meta.update(
                {
                    "pod_sku_variant_id": str(pod_sku_variant.id),
                    "pod_sku_code": str(pod_sku_variant.code or pod_sku_variant.pod_sku.code),
                    "pod_sku_name": str(pod_sku_variant.name or pod_sku_variant.pod_sku.name),
                }
            )
            attrs['planner_origin_meta'] = planner_origin_meta
            attrs['pod_profile_snapshot'] = {
                "material_id": str(pod_sku_variant.material_id),
                "material_code": str(pod_sku_variant.material.code or ""),
                "material_name": str(pod_sku_variant.material.name or ""),
                "pod_type": str(getattr(pod_sku_variant.material, 'pod_type', '') or ""),
                "pod_fixed_height_mm": float(getattr(pod_sku_variant.material, 'pod_fixed_height_mm', 0) or 0),
                "pod_thickness_micron": float(getattr(pod_sku_variant.material, 'pod_thickness_micron', 0) or 0),
                "pod_panel_count": int(getattr(pod_sku_variant.material, 'pod_panel_count', 0) or 0),
                "density_gcm3": float(getattr(pod_sku_variant.material, 'density_gcm3', 0) or 0),
                "pod_sku_variant_id": str(pod_sku_variant.id),
                "pod_sku_code": str(pod_sku_variant.code or pod_sku_variant.pod_sku.code),
                "pod_sku_name": str(pod_sku_variant.name or pod_sku_variant.pod_sku.name),
            }
        return attrs

    class Meta:
        model = PlannedBulkStockOrder
        fields = [
            'id', 'order_number', 'bulk_class',
            'material', 'material_code', 'material_name',
            'pod_sku_variant', 'pod_sku_variant_code', 'pod_sku_variant_name',
            'plant', 'plant_name',
            'quantity_kg', 'target_qty_kg', 'produced_qty_kg',
            'name', 'internal_name',
            'pod_profile_snapshot', 'planner_origin_meta',
            'status', 'created_by', 'created_by_name',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'order_number', 'produced_qty_kg', 'created_by', 'created_by_name',
            'created_at', 'updated_at',
        ]


class PlannerSkuVariantSerializer(serializers.ModelSerializer):
    sku_code = serializers.ReadOnlyField(source="sku.code")
    sku_name = serializers.ReadOnlyField(source="sku.name")
    template_name = serializers.ReadOnlyField(source="template.name")
    default_plant_name = serializers.ReadOnlyField(source="default_plant.name")
    packaging_material_name = serializers.ReadOnlyField(source="packaging_material.name")
    pod_sku_variant_code = serializers.ReadOnlyField(source="pod_sku_variant.code")
    pod_sku_variant_name = serializers.ReadOnlyField(source="pod_sku_variant.name")
    product_master_name = serializers.ReadOnlyField(source="product_master.name")
    product_master_code = serializers.ReadOnlyField(source="product_master.code")
    committed_customer_name = serializers.ReadOnlyField(source="committed_customer.name")
    committed_artwork_design_code = serializers.ReadOnlyField(source="committed_artwork.design_code")

    class Meta:
        model = PlannerSkuVariant
        fields = [
            "id",
            "sku",
            "sku_code",
            "sku_name",
            "code",
            "name",
            "active",
            "launch_kind",
            "template",
            "template_name",
            "default_plant",
            "default_plant_name",
            "product_master",
            "product_master_name",
            "product_master_code",
            "commitment_scope",
            "committed_customer",
            "committed_customer_name",
            "committed_artwork",
            "committed_artwork_design_code",
            "default_qty",
            "quantity_uom",
            "stock_purpose",
            "stock_strategy",
            "planner_stock_class",
            "start_step_index",
            "stop_step_index",
            "axis_values",
            "geometry_snapshot",
            "layer_snapshot",
            "printing_snapshot",
            "addons_snapshot",
            "packaging_snapshot",
            "packaging_material",
            "packaging_material_name",
            "pod_sku_variant",
            "pod_sku_variant_code",
            "pod_sku_variant_name",
            "planner_origin_meta",
            "spec_signature",
            "invariant_signature",
            "created_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_by", "created_at", "updated_at"]

    def validate(self, attrs):
        instance = getattr(self, "instance", None)
        launch_kind = str(attrs.get("launch_kind", getattr(instance, "launch_kind", "")) or "").upper()
        stock_purpose = str(attrs.get("stock_purpose", getattr(instance, "stock_purpose", "PRODUCT")) or "PRODUCT").upper()
        packaging_material = attrs.get("packaging_material", getattr(instance, "packaging_material", None))
        pod_sku_variant = attrs.get("pod_sku_variant", getattr(instance, "pod_sku_variant", None))
        start_step_index = attrs.get("start_step_index", getattr(instance, "start_step_index", 0))
        stop_step_index = attrs.get("stop_step_index", getattr(instance, "stop_step_index", None))
        commitment_scope = str(attrs.get("commitment_scope", getattr(instance, "commitment_scope", "GENERIC")) or "GENERIC").upper()
        committed_customer = attrs.get("committed_customer", getattr(instance, "committed_customer", None))
        committed_artwork = attrs.get("committed_artwork", getattr(instance, "committed_artwork", None))

        errors = {}
        if launch_kind == "PACKAGING_STOCK":
            if stock_purpose != "PACKAGING":
                errors["stock_purpose"] = "Packaging planner presets must use stock_purpose=PACKAGING."
            if not packaging_material:
                errors["packaging_material"] = "Packaging planner presets require packaging_material."
        elif stock_purpose == "PACKAGING":
            errors["stock_purpose"] = "Only PACKAGING_STOCK presets may use stock_purpose=PACKAGING."
        if commitment_scope in {"CUSTOMER", "CUSTOMER_ARTWORK"} and not committed_customer:
            errors["committed_customer"] = "Customer commitment requires committed_customer."
        if commitment_scope in {"ARTWORK", "CUSTOMER_ARTWORK"} and not committed_artwork:
            errors["committed_artwork"] = "Artwork commitment requires committed_artwork."
        if commitment_scope == "GENERIC":
            attrs["committed_customer"] = None
            attrs["committed_artwork"] = None

        if launch_kind == "POD_STOCK":
            if not pod_sku_variant:
                errors["pod_sku_variant"] = "POD planner presets require pod_sku_variant."
        elif pod_sku_variant:
            errors["pod_sku_variant"] = "Only POD_STOCK presets may set pod_sku_variant."

        if launch_kind != "PACKAGING_STOCK" and packaging_material:
            errors["packaging_material"] = "Only PACKAGING_STOCK presets may set packaging_material."

        try:
            start_index = int(start_step_index or 0)
            stop_index = None if stop_step_index is None else int(stop_step_index)
            if stop_index is not None and stop_index < start_index:
                errors["stop_step_index"] = "stop_step_index must be greater than or equal to start_step_index."
        except Exception:
            errors["stop_step_index"] = "Invalid route span."

        if errors:
            raise serializers.ValidationError(errors)
        template = attrs.get("template", getattr(instance, "template", None))
        if stock_purpose == "PRODUCT" and template and stop_step_index is not None:
            _validate_commitment_stop_rule(
                template=template,
                stop_idx=int(stop_step_index),
                commitment_scope=commitment_scope,
                committed_artwork=committed_artwork,
            )
        return attrs


class PlannerSkuSerializer(serializers.ModelSerializer):
    template_name = serializers.ReadOnlyField(source="template.name")
    default_plant_name = serializers.ReadOnlyField(source="default_plant.name")
    product_master_name = serializers.ReadOnlyField(source="product_master.name")
    product_master_code = serializers.ReadOnlyField(source="product_master.code")
    variants = PlannerSkuVariantSerializer(many=True, read_only=True)

    class Meta:
        model = PlannerSku
        fields = [
            "id",
            "code",
            "name",
            "template",
            "template_name",
            "product_master",
            "product_master_name",
            "product_master_code",
            "default_plant",
            "default_plant_name",
            "active",
            "notes",
            "variants",
            "created_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_by", "created_at", "updated_at", "variants"]


class ReasonCodeSerializer(serializers.ModelSerializer):
    """
    Shared serializer for ScrapReason / DowntimeReason.

    Exposes the public contract fields:
      id, code, label, parent_id, parent_code, is_active, sort_order.
    ``parent_id`` is writable (FK to a top-level code in the same taxonomy);
    ``parent_code`` is a read-only convenience for the UI tree.
    """

    parent_code = serializers.ReadOnlyField(source="parent.code")

    class Meta:
        model = None  # bound by concrete subclasses
        fields = ["id", "code", "label", "parent_id", "parent_code", "is_active", "sort_order"]

    def get_fields(self):
        fields = super().get_fields()
        # Build the writable parent FK lazily so its queryset is scoped to the
        # concrete taxonomy (Scrap vs Downtime) without a class-time queryset.
        model = self.Meta.model
        if model is not None:
            fields["parent_id"] = serializers.PrimaryKeyRelatedField(
                source="parent",
                queryset=model.objects.all(),
                allow_null=True,
                required=False,
            )
        return fields

    def validate(self, attrs):
        parent = attrs.get("parent", getattr(self.instance, "parent", None))
        if parent is not None:
            if self.instance is not None and parent.id == self.instance.id:
                raise serializers.ValidationError({"parent_id": "A reason code cannot be its own parent."})
            if parent.parent_id:
                raise serializers.ValidationError(
                    {"parent_id": "Sub-codes cannot be nested more than one level deep."}
                )
        return attrs


class ScrapReasonSerializer(ReasonCodeSerializer):
    class Meta(ReasonCodeSerializer.Meta):
        model = ScrapReason


class DowntimeReasonSerializer(ReasonCodeSerializer):
    class Meta(ReasonCodeSerializer.Meta):
        model = DowntimeReason
