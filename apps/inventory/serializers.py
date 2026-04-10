from decimal import Decimal
from rest_framework import serializers
from .models import (
    InventoryLocation, InventoryRoll, InventoryBulk, BulkTransaction,
    JobWorkOrder, DeliveryChallan, InterPlantChallanItem, RollLink, RollConsumption, RollMovement,
    PackagingStock, PackagingTransaction,
)
from apps.materials.models import InventoryMaterial

LEGACY_STAGE_NAMES = {
    0: 'Raw Material',
    1: 'Extruded',
    2: 'Printed',
    3: 'Laminated',
    4: 'Slit',
    5: 'Finished Good',
}

PROCESS_STAGE_HINTS = [
    ("SLIT", "Slit"),
    ("LAM", "Laminated"),
    ("PRINT", "Printed"),
    ("FLEXO", "Printed"),
    ("EXTR", "Extruded"),
    ("BLOWN", "Extruded"),
    ("FG", "Finished Good"),
    ("PACK", "Finished Good"),
]


def _process_code_to_stage(code: str):
    token = str(code or "").upper()
    if not token:
        return None
    for hint, stage_name in PROCESS_STAGE_HINTS:
        if hint in token:
            return stage_name
    return None


def _is_high_confidence_remainder(roll, meta):
    if not roll or not getattr(roll, "parent_roll_id", None):
        return False

    if any(meta.get(key) for key in ("source_stage_index", "source_stage_name", "source_process_code", "source_roll_label", "remainder_of", "balance_of")):
        return True

    label = str(getattr(roll, "label_id", "") or "").upper()
    if any(marker in label for marker in ("REMAINDER", "REM", "BAL", "BALANCE")):
        return True

    parent = getattr(roll, "parent_roll", None)
    if not parent:
        return False
    try:
        parent_weight = Decimal(str(parent.weight_kg or 0))
        child_weight = Decimal(str(roll.weight_kg or 0))
    except Exception:
        parent_weight = Decimal("0")
        child_weight = Decimal("0")

    same_job = bool(
        parent.production_job_id
        and roll.production_job_id
        and str(parent.production_job_id) == str(roll.production_job_id)
    )
    parent_open = str(parent.status or "").upper() in {"AVAILABLE", "RESERVED", "IN_PROCESS"}
    parent_consumed = str(parent.status or "").upper() == "CONSUMED"

    # Legacy partial-consumption pattern where parent stayed open.
    if same_job and parent_open and child_weight > parent_weight and not bool(getattr(roll, "is_fg", False)):
        return True

    # Canonical split pattern: parent consumed, child keeps source stage/step.
    if same_job and parent_consumed and not bool(getattr(roll, "is_fg", False)):
        same_stage = getattr(roll, "stage_index", None) == getattr(parent, "stage_index", None)
        same_step = getattr(roll, "current_step_index", None) == getattr(parent, "current_step_index", None)
        same_created_process = (
            getattr(roll, "created_process_id", None)
            and getattr(parent, "created_process_id", None)
            and str(getattr(roll, "created_process_id", "")) == str(getattr(parent, "created_process_id", ""))
        )
        if (same_stage and same_step) or (same_stage and same_created_process):
            return True

    # If parent is consumed and child did not advance stage, treat as balance/remainder.
    if parent_consumed and getattr(roll, "stage_index", None) == getattr(parent, "stage_index", None):
        return True

    return False


def resolve_roll_role(roll):
    if not roll:
        return None
    meta = roll.meta_json or {}
    explicit = str(meta.get('roll_role') or '').upper()
    if explicit:
        return explicit
    if bool(meta.get('is_remainder')):
        return 'REMAINDER'
    if _is_high_confidence_remainder(roll, meta):
        return 'REMAINDER'
    if roll.is_fg:
        return 'FG'
    if roll.created_by_job_id or roll.production_job_id:
        return 'OUTPUT'
    return 'INPUT_STOCK'


def resolve_roll_stage_name(roll):
    if not roll:
        return None
    meta = roll.meta_json or {}
    role = resolve_roll_role(roll)
    if role == "REMAINDER":
        source_stage_name = str(meta.get("source_stage_name") or "").strip()
        if source_stage_name:
            return source_stage_name
        source_process_code = meta.get("source_process_code")
        mapped = _process_code_to_stage(source_process_code)
        if mapped:
            return mapped
        source_stage_index = meta.get("source_stage_index")
        try:
            if source_stage_index is not None:
                return LEGACY_STAGE_NAMES.get(int(source_stage_index), f"Stage {source_stage_index}")
        except Exception:
            pass
        parent = getattr(roll, "parent_roll", None)
        if parent:
            return resolve_roll_stage_name(parent)
    if roll.is_fg:
        return "Finished Good"
    process = getattr(roll, "created_process", None)
    process_tokens = []
    if process:
        process_tokens.append(str(getattr(process, "code", "") or "").upper())
        process_tokens.append(str(getattr(process, "name", "") or "").upper())
    for token in process_tokens:
        mapped = _process_code_to_stage(token)
        if mapped:
            return mapped
    try:
        return LEGACY_STAGE_NAMES.get(int(roll.stage_index), f'Stage {roll.stage_index}')
    except Exception:
        return 'Unknown'


class InventoryLocationSerializer(serializers.ModelSerializer):
    plant_name = serializers.CharField(source='plant.name', read_only=True)
    
    class Meta:
        model = InventoryLocation
        fields = ['id', 'plant', 'plant_name', 'code', 'name', 'type', 'is_system', 'is_active']
        read_only_fields = ['id', 'is_system']

    def validate_code(self, value):
        return value.upper()

class InventoryRollSerializer(serializers.ModelSerializer):
    material_name = serializers.CharField(source='material.name', read_only=True)
    material_code = serializers.CharField(source='material.code', read_only=True)
    variant_id = serializers.SerializerMethodField()
    family_name = serializers.CharField(source='material.parent_family.name', read_only=True)
    location_name = serializers.CharField(source='location.name', read_only=True)
    plant_name = serializers.CharField(source='plant.name', read_only=True, allow_null=True)
    # Phase 56: Grade FK
    grade_name = serializers.CharField(source='grade.name', read_only=True, allow_null=True)
    # Phase 54 fields
    stage_name = serializers.SerializerMethodField()
    roll_role = serializers.SerializerMethodField()
    is_quarantined = serializers.SerializerMethodField()
    
    class Meta:
        model = InventoryRoll
        fields = [
            'id', 'label_id', 'material', 'variant_id', 'material_name', 'material_code', 'family_name',
            'batch_no', 'thickness_micron', 'width_mm', 'density_gcm3', 'length_m',
            'grade', 'grade_name',  # Phase 56: Grade
            'plant', 'plant_name',  # Phase 56: Plant
            'original_weight_kg', 'weight_kg', 'location', 'location_name', 
            'status', 'stage_index', 'stage_name', 'roll_role', 'is_quarantined', 'is_fg', 'current_step_index', 
            'created_by_job', 'created_process', 'created_at'
        ]
    
    def get_variant_id(self, obj):
        return str(obj.material_id) if getattr(obj, 'material_id', None) else None

    def get_stage_name(self, obj):
        return resolve_roll_stage_name(obj)

    def get_roll_role(self, obj):
        return resolve_roll_role(obj)

    def get_is_quarantined(self, obj):
        meta = obj.meta_json or {}
        return bool(meta.get("is_quarantined"))



# --- Job Work Order ---

class JobWorkOrderSerializer(serializers.ModelSerializer):
    plant_name = serializers.CharField(source='plant.name', read_only=True)
    vendor_name = serializers.SerializerMethodField()
    production_job_number = serializers.CharField(source='production_job.job_number', read_only=True, allow_null=True)
    
    class Meta:
        model = JobWorkOrder
        fields = '__all__'
        read_only_fields = ['id', 'status', 'created_at', 'updated_at']
        extra_kwargs = {
            'vendor': {'required': True, 'allow_null': False},
            'vendor_name': {'required': False},
        }

    def validate_vendor(self, value):
        if not value:
            raise serializers.ValidationError("Vendor is required.")
        if str(value.status or "").upper() != "ACTIVE":
            raise serializers.ValidationError("Only active vendors can be selected.")
        if str(value.type or "").upper() not in {"JOBWORK", "BOTH"}:
            raise serializers.ValidationError("Vendor must be JOBWORK or BOTH type.")
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        instance = getattr(self, "instance", None)

        mode = str(
            attrs.get("mode")
            or getattr(instance, "mode", None)
            or "EMERGENCY"
        ).upper()
        emergency_reason = str(
            attrs.get("emergency_reason")
            if "emergency_reason" in attrs
            else getattr(instance, "emergency_reason", "")
        ).strip()
        production_job = attrs.get("production_job") or getattr(instance, "production_job", None)
        vendor = attrs.get("vendor") or getattr(instance, "vendor", None)

        if mode not in {"PLANNED_STEP", "EMERGENCY"}:
            raise serializers.ValidationError({"mode": "Mode must be PLANNED_STEP or EMERGENCY."})
        if mode == "EMERGENCY" and not emergency_reason:
            raise serializers.ValidationError({"emergency_reason": "Emergency reason is required for EMERGENCY jobwork."})
        if mode == "PLANNED_STEP" and not production_job:
            raise serializers.ValidationError({"production_job": "production_job is required for PLANNED_STEP jobwork."})
        if mode == "PLANNED_STEP" and production_job:
            attrs["route_step_index"] = attrs.get("route_step_index", getattr(production_job, "current_step_index", 0))

        if production_job and vendor:
            from apps.inventory.services.job_work import JobWorkService

            process = getattr(production_job, "current_process", None) or getattr(production_job, "process", None)
            process_code = str(getattr(process, "code", "") or "").upper()
            plant = None
            if getattr(production_job, "work_center_id", None) and getattr(production_job, "work_center", None):
                plant = production_job.work_center.plant
            if not plant and getattr(production_job, "from_location_id", None) and getattr(production_job, "from_location", None):
                plant = production_job.from_location.plant
            if not plant and getattr(production_job, "to_location_id", None) and getattr(production_job, "to_location", None):
                plant = production_job.to_location.plant
            verdict = JobWorkService.vendor_matches_jobwork(vendor, process_code=process_code, plant=plant)
            if not verdict["match"]:
                raise serializers.ValidationError({"vendor": " ".join(verdict["reasons"]) or "Vendor is not compatible for this job."})

        return attrs

    def get_vendor_name(self, obj):
        if getattr(obj, "vendor_id", None) and getattr(obj, "vendor", None):
            return obj.vendor.name
        return str(getattr(obj, "vendor_name", "") or "")

    def create(self, validated_data):
        vendor = validated_data.get("vendor")
        if vendor:
            validated_data["vendor_name"] = vendor.name
        return super().create(validated_data)

    def update(self, instance, validated_data):
        vendor = validated_data.get("vendor") or instance.vendor
        if vendor:
            validated_data["vendor_name"] = vendor.name
        return super().update(instance, validated_data)

# --- Delivery Challan ---

class DeliveryChallanSerializer(serializers.ModelSerializer):
    from_plant_name = serializers.CharField(source='from_plant.name', read_only=True)
    to_plant_name = serializers.CharField(source='to_plant.name', read_only=True)
    source_job_number = serializers.CharField(source='source_job.job_number', read_only=True, allow_null=True)
    target_job_number = serializers.CharField(source='target_job.job_number', read_only=True, allow_null=True)
    items = serializers.SerializerMethodField()
    transfer_summary = serializers.SerializerMethodField()
    item_preview = serializers.SerializerMethodField()

    class Meta:
        model = DeliveryChallan
        fields = '__all__'
        read_only_fields = ['id', 'status', 'dc_no', 'created_at', 'updated_at']

    def get_items(self, obj):
        return InterPlantChallanItemSerializer(
            obj.items.select_related('roll', 'material', 'from_location', 'to_location'),
            many=True
        ).data

    def get_transfer_summary(self, obj):
        items_qs = obj.items.all()
        roll_lines = items_qs.filter(line_type='ROLL').count()
        bulk_lines = items_qs.filter(line_type='BULK').count()
        total_lines = roll_lines + bulk_lines
        dispatched_total = sum(float(i.dispatched_qty_kg or 0) for i in items_qs)
        received_total = sum(float(i.received_qty_kg or 0) for i in items_qs)
        output_lines = 0
        remainder_lines = 0
        output_dispatched = 0.0
        output_received = 0.0
        remainder_dispatched = 0.0
        remainder_received = 0.0
        for line in items_qs:
            if line.line_type != 'ROLL':
                continue
            role = resolve_roll_role(line.roll) if line.roll else None
            dispatched = float(line.dispatched_qty_kg or 0)
            received = float(line.received_qty_kg or 0)
            if role == 'REMAINDER':
                remainder_lines += 1
                remainder_dispatched += dispatched
                remainder_received += received
            else:
                output_lines += 1
                output_dispatched += dispatched
                output_received += received
        return {
            'total_lines': total_lines,
            'roll_lines': roll_lines,
            'bulk_lines': bulk_lines,
            'dispatched_total_kg': round(dispatched_total, 4),
            'received_total_kg': round(received_total, 4),
            'output_lines': output_lines,
            'remainder_lines': remainder_lines,
            'output_dispatched_kg': round(output_dispatched, 4),
            'output_received_kg': round(output_received, 4),
            'remainder_dispatched_kg': round(remainder_dispatched, 4),
            'remainder_received_kg': round(remainder_received, 4),
        }

    def get_item_preview(self, obj):
        rows = obj.items.select_related('roll', 'material', 'from_location', 'to_location').order_by('created_at')[:3]
        out = []
        for line in rows:
            roll_role = resolve_roll_role(line.roll)
            out.append({
                'line_type': line.line_type,
                'roll_label': line.roll.label_id if line.roll else None,
                'material_name': line.material.name if line.material else None,
                'roll_role': roll_role,
                'dispatched_qty_kg': float(line.dispatched_qty_kg or 0),
                'from_location_name': line.from_location.name if line.from_location else None,
                'to_location_name': line.to_location.name if line.to_location else None,
            })
        return out


class InterPlantChallanItemSerializer(serializers.ModelSerializer):
    roll_label = serializers.CharField(source='roll.label_id', read_only=True, allow_null=True)
    material_name = serializers.CharField(source='material.name', read_only=True, allow_null=True)
    from_location_name = serializers.CharField(source='from_location.name', read_only=True, allow_null=True)
    to_location_name = serializers.CharField(source='to_location.name', read_only=True, allow_null=True)
    roll_role = serializers.SerializerMethodField()

    class Meta:
        model = InterPlantChallanItem
        fields = [
            'id',
            'line_type',
            'status',
            'roll',
            'roll_label',
            'roll_role',
            'material',
            'material_name',
            'from_location',
            'from_location_name',
            'to_location',
            'to_location_name',
            'planned_qty_kg',
            'dispatched_qty_kg',
            'received_qty_kg',
            'created_at',
            'updated_at',
        ]

    def get_roll_role(self, obj):
        if not obj.roll_id:
            return None
        return resolve_roll_role(obj.roll)

# --- Payload Serializers (Validation Only) ---

class RollItemSerializer(serializers.Serializer):
    """Phase 56: Physical specs must be provided for each roll."""
    material_id = serializers.UUIDField(required=False)  # Optional, used if item differs from context
    label_id = serializers.CharField(required=False, allow_blank=True)
    batch_no = serializers.CharField(required=False, allow_blank=True)
    # Phase 56: Physical specs (required on Roll)
    thickness_micron = serializers.DecimalField(max_digits=10, decimal_places=2)  # Required
    width_mm = serializers.DecimalField(max_digits=10, decimal_places=2)  # Required
    weight_kg = serializers.DecimalField(max_digits=10, decimal_places=3)  # Required
    # Optional fields
    length_m = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, default=0)
    grade_id = serializers.UUIDField(required=False, allow_null=True)  # Required only for extrudable variants

    def to_internal_value(self, data):
        # DRF UUIDField doesn't natively handle empty strings well even with allow_null
        # So we cleanly nullify an empty grade_id before standard validation
        if 'grade_id' in data and data['grade_id'] in ["", b""]:
            data['grade_id'] = None
        return super().to_internal_value(data)

class BulkGRNSerializer(serializers.Serializer):
    """Phase 56: Bulk GRN with cost tracking."""
    material_id = serializers.UUIDField()
    location_id = serializers.UUIDField()
    vendor_id = serializers.UUIDField()
    plant_id = serializers.UUIDField(required=False)  # Optional, derived from location if not provided
    quantity = serializers.DecimalField(max_digits=15, decimal_places=4)
    cost = serializers.DecimalField(max_digits=12, decimal_places=4, required=False, default=0)  # Phase 56: Cost for avg calculation
    reference = serializers.CharField(required=False, allow_blank=True)
    granule_code_id = serializers.UUIDField(required=False, allow_null=True)
    granule_code = serializers.CharField(required=False, allow_blank=True)

class RollGRNSerializer(serializers.Serializer):
    material_id = serializers.UUIDField()
    location_id = serializers.UUIDField()
    vendor_id = serializers.UUIDField()
    plant_id = serializers.UUIDField(required=False)
    rolls = RollItemSerializer(many=True)
    reference = serializers.CharField(required=False, allow_blank=True)


class PackagingGRNSerializer(serializers.Serializer):
    material_id = serializers.UUIDField()
    location_id = serializers.UUIDField()
    vendor_id = serializers.UUIDField()
    plant_id = serializers.UUIDField(required=False)
    quantity = serializers.DecimalField(max_digits=15, decimal_places=4)
    cost = serializers.DecimalField(max_digits=12, decimal_places=4, required=False, default=0)
    reference = serializers.CharField(required=False, allow_blank=True)

class JobWorkDispatchSerializer(serializers.Serializer):
    roll_ids = serializers.ListField(child=serializers.UUIDField(), required=False)
    bulk_items = serializers.ListField(
        child=serializers.DictField(), # {material_id, quantity, location_id}
        required=False
    )

class JobWorkReceiveSerializer(serializers.Serializer):
    target_location_id = serializers.UUIDField()
    received_rolls = RollItemSerializer(many=True, required=False) # New rolls created from JW
    received_bulk = serializers.ListField(
        child=serializers.DictField(), # {material_id, quantity}
        required=False
    )

class ChallanDispatchSerializer(serializers.Serializer):
    target_location_id = serializers.UUIDField(required=False)
    roll_ids = serializers.ListField(child=serializers.UUIDField(), required=False)
    bulk_items = serializers.ListField(
        child=serializers.DictField(), # {material_id, quantity, location_id}
        required=False
    )

class ChallanReceiveSerializer(serializers.Serializer):
    target_location_id = serializers.UUIDField()
    roll_ids = serializers.ListField(child=serializers.UUIDField(), required=False)
    bulk_items = serializers.ListField(
        child=serializers.DictField(),  # {material_id, quantity}
        required=False
    )


# ============================================================================
# PHASE 54: ROLL TRACKING SERIALIZERS
# ============================================================================

class RollLinkSerializer(serializers.ModelSerializer):
    parent_label = serializers.CharField(source='parent_roll.label_id', read_only=True)
    child_label = serializers.CharField(source='child_roll.label_id', read_only=True)
    
    class Meta:
        model = RollLink
        fields = ['id', 'parent_roll', 'parent_label', 'child_roll', 'child_label', 
                  'relation_type', 'qty_used_kg', 'created_at']


class RollConsumptionSerializer(serializers.ModelSerializer):
    job_no = serializers.CharField(source='job.job_no', read_only=True)
    process_name = serializers.CharField(source='process.name', read_only=True)
    input_roll_label = serializers.CharField(source='input_roll.label_id', read_only=True)
    output_roll_label = serializers.CharField(source='output_roll.label_id', read_only=True, allow_null=True)
    balance_roll_label = serializers.CharField(source='balance_roll.label_id', read_only=True, allow_null=True)
    scrap_roll_label = serializers.CharField(source='scrap_roll.label_id', read_only=True, allow_null=True)
    machine_name = serializers.CharField(source='machine.name', read_only=True)
    operator_name = serializers.CharField(source='operator.username', read_only=True, allow_null=True)
    
    class Meta:
        model = RollConsumption
        fields = [
            'id', 'job', 'job_no', 'process', 'process_name',
            'input_roll', 'input_roll_label', 'output_roll', 'output_roll_label',
            'balance_roll', 'balance_roll_label', 'scrap_roll', 'scrap_roll_label',
            'consumed_kg', 'scrap_kg', 'balance_kg', 'output_kg',
            'machine', 'machine_name', 'operator', 'operator_name',
            'timestamp', 'notes'
        ]


class RollMovementSerializer(serializers.ModelSerializer):
    roll_label = serializers.CharField(source='roll.label_id', read_only=True)
    from_location_name = serializers.CharField(source='from_location.name', read_only=True, allow_null=True)
    to_location_name = serializers.CharField(source='to_location.name', read_only=True)
    job_no = serializers.CharField(source='job.job_no', read_only=True, allow_null=True)
    moved_by_name = serializers.CharField(source='moved_by.username', read_only=True, allow_null=True)
    
    class Meta:
        model = RollMovement
        fields = [
            'id', 'roll', 'roll_label', 
            'from_location', 'from_location_name', 'to_location', 'to_location_name',
            'reason', 'reason_note', 'job', 'job_no', 
            'moved_by', 'moved_by_name', 'timestamp'
        ]


class RollDetailSerializer(serializers.ModelSerializer):
    """Full roll details with genealogy and movements. Phase 56: Includes grade and plant."""
    material_name = serializers.CharField(source='material.name', read_only=True)
    material_code = serializers.CharField(source='material.code', read_only=True)
    variant_id = serializers.SerializerMethodField()
    family_name = serializers.CharField(source='material.parent_family.name', read_only=True)
    location_name = serializers.CharField(source='location.name', read_only=True)
    location_type = serializers.CharField(source='location.type', read_only=True)
    plant_name = serializers.CharField(source='plant.name', read_only=True, allow_null=True)
    # Phase 56: Grade
    grade_name = serializers.CharField(source='grade.name', read_only=True, allow_null=True)
    stage_name = serializers.SerializerMethodField()
    roll_role = serializers.SerializerMethodField()
    is_quarantined = serializers.SerializerMethodField()
    
    # Genealogy
    parent_links = RollLinkSerializer(many=True, read_only=True)
    child_links = RollLinkSerializer(many=True, read_only=True)
    
    # Recent movements
    recent_movements = serializers.SerializerMethodField()
    reservation_id = serializers.SerializerMethodField()
    
    # Consumptions (as input)
    consumptions = serializers.SerializerMethodField()
    
    class Meta:
        model = InventoryRoll
        fields = [
            'id', 'label_id', 'material', 'variant_id', 'material_name', 'material_code', 'family_name',
            'batch_no', 'thickness_micron', 'width_mm', 'density_gcm3', 'length_m',
            'grade', 'grade_name',  # Phase 56: Grade
            'plant', 'plant_name',  # Phase 56: Plant
            'original_weight_kg', 'weight_kg', 'location', 'location_name', 'location_type',
            'status', 'stage_index', 'stage_name', 'roll_role', 'is_quarantined', 'is_fg', 'current_step_index',
            'created_by_job', 'created_process', 'production_job', 'sales_order_item',
            'meta_json', 'reservation_id', 'created_at',
            'parent_links', 'child_links', 'recent_movements', 'consumptions'
        ]
    
    def get_variant_id(self, obj):
        return str(obj.material_id) if getattr(obj, 'material_id', None) else None

    def get_stage_name(self, obj):
        return resolve_roll_stage_name(obj)

    def get_roll_role(self, obj):
        return resolve_roll_role(obj)

    def get_is_quarantined(self, obj):
        meta = obj.meta_json or {}
        return bool(meta.get("is_quarantined"))
    
    def get_recent_movements(self, obj):
        movements = obj.movements.all()[:5]
        return RollMovementSerializer(movements, many=True).data
    
    def get_consumptions(self, obj):
        consumptions = obj.consumptions_as_input.all()[:5]
        return RollConsumptionSerializer(consumptions, many=True).data

    def get_reservation_id(self, obj):
        # Optional: surfacing current reservation ID if job_id is in context
        job_id = self.context.get('production_job_id')
        if not job_id:
            return None
        from .models import InventoryReservation
        res = InventoryReservation.objects.filter(job_id=job_id, roll=obj, status='ACTIVE').first()
        return str(res.id) if res else None


# ============================================================================
# PHASE 56: BULK INVENTORY SERIALIZERS
# ============================================================================

from .models import InventoryBulk, BulkTransaction

class InventoryBulkSerializer(serializers.ModelSerializer):
    material_name = serializers.CharField(source='material.name', read_only=True)
    material_code = serializers.CharField(source='material.code', read_only=True)
    material_category = serializers.CharField(source='material.category', read_only=True)
    granule_quality_code = serializers.CharField(source='granule_code.code', read_only=True, allow_null=True)
    granule_quality_code_id = serializers.CharField(source='granule_code.id', read_only=True, allow_null=True)
    granule_quality_vendor_name = serializers.CharField(source='granule_code.vendor.name', read_only=True, allow_null=True)
    granule_quality_vendor_code = serializers.CharField(source='granule_code.vendor.code', read_only=True, allow_null=True)
    location_name = serializers.CharField(source='location.name', read_only=True)
    plant_name = serializers.CharField(source='plant.name', read_only=True)
    
    class Meta:
        model = InventoryBulk
        fields = '__all__'

class BulkTransactionSerializer(serializers.ModelSerializer):
    material_name = serializers.CharField(source='material.name', read_only=True)
    material_code = serializers.CharField(source='material.code', read_only=True)
    granule_quality_code = serializers.CharField(source='granule_code.code', read_only=True, allow_null=True)
    granule_quality_code_id = serializers.CharField(source='granule_code.id', read_only=True, allow_null=True)
    granule_quality_vendor_name = serializers.CharField(source='granule_code.vendor.name', read_only=True, allow_null=True)
    location_name = serializers.CharField(source='location.name', read_only=True)
    job_no = serializers.CharField(source='job.job_no', read_only=True, allow_null=True)
    
    class Meta:
        model = BulkTransaction
        fields = '__all__'


class PackagingStockSerializer(serializers.ModelSerializer):
    material_name = serializers.CharField(source='material.name', read_only=True)
    material_code = serializers.CharField(source='material.code', read_only=True)
    packaging_kind = serializers.CharField(source='material.packaging_kind', read_only=True)
    base_uom = serializers.CharField(source='material.base_uom', read_only=True)
    location_name = serializers.CharField(source='location.name', read_only=True)
    plant_name = serializers.CharField(source='plant.name', read_only=True)

    class Meta:
        model = PackagingStock
        fields = '__all__'


class PackagingTransactionSerializer(serializers.ModelSerializer):
    material_name = serializers.CharField(source='material.name', read_only=True)
    material_code = serializers.CharField(source='material.code', read_only=True)
    base_uom = serializers.CharField(source='material.base_uom', read_only=True)
    location_name = serializers.CharField(source='location.name', read_only=True)
    job_no = serializers.CharField(source='job.job_number', read_only=True, allow_null=True)
    vendor_name = serializers.CharField(source='vendor.name', read_only=True, allow_null=True)

    class Meta:
        model = PackagingTransaction
        fields = '__all__'

class RollReserveSerializer(serializers.Serializer):
    roll_ids = serializers.ListField(child=serializers.UUIDField())
    job_id = serializers.UUIDField()


class RollReleaseSerializer(serializers.Serializer):
    roll_ids = serializers.ListField(child=serializers.UUIDField())


class RollMoveSerializer(serializers.Serializer):
    to_location_id = serializers.UUIDField()
    reason = serializers.ChoiceField(choices=RollMovement.REASON_CHOICES)
    reason_note = serializers.CharField(required=False, allow_blank=True)
    job_id = serializers.UUIDField(required=False, allow_null=True)


class RollConsumeInputSerializer(serializers.Serializer):
    roll_id = serializers.UUIDField()
    used_kg = serializers.DecimalField(max_digits=10, decimal_places=3)
    scrap_kg = serializers.DecimalField(max_digits=10, decimal_places=3, default=0)


class RollConsumeSerializer(serializers.Serializer):
    job_id = serializers.UUIDField()
    process_id = serializers.UUIDField()
    machine_id = serializers.UUIDField()
    inputs = RollConsumeInputSerializer(many=True)
    output_location_id = serializers.UUIDField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True)


# ============================================================
# Phase 58: Observability Serializers
# ============================================================

from .models import InventorySnapshot, InventoryAlert

class InventorySnapshotSerializer(serializers.ModelSerializer):
    plant_name = serializers.CharField(source='plant.name', read_only=True)
    plant_code = serializers.CharField(source='plant.code', read_only=True)
    
    class Meta:
        model = InventorySnapshot
        fields = [
            'id', 'created_at', 'plant', 'plant_name', 'plant_code',
            'total_bulk_kg', 'total_roll_kg', 'total_fg_kg', 'total_wip_kg',
            'reserved_roll_kg', 'scrap_kg',
            'bulk_sku_count', 'roll_count', 'fg_roll_count'
        ]
        read_only_fields = ['id', 'created_at']


class InventoryAlertSerializer(serializers.ModelSerializer):
    material_name = serializers.CharField(source='material.name', read_only=True, allow_null=True)
    material_code = serializers.CharField(source='material.code', read_only=True, allow_null=True)
    roll_label = serializers.CharField(source='roll.label_id', read_only=True, allow_null=True)
    plant_name = serializers.CharField(source='plant.name', read_only=True, allow_null=True)
    resolved_by_name = serializers.CharField(source='resolved_by.get_full_name', read_only=True, allow_null=True)
    type_display = serializers.CharField(source='get_type_display', read_only=True)
    severity_display = serializers.CharField(source='get_severity_display', read_only=True)
    
    class Meta:
        model = InventoryAlert
        fields = [
            'id', 'type', 'type_display', 'message', 'severity', 'severity_display',
            'material', 'material_name', 'material_code',
            'roll', 'roll_label',
            'plant', 'plant_name',
            'expected_value', 'actual_value',
            'resolved', 'resolved_at', 'resolved_by', 'resolved_by_name', 'resolution_note',
            'created_at'
        ]
        read_only_fields = ['id', 'created_at', 'type', 'message', 'severity', 'material', 'roll', 'plant']


class AlertResolveSerializer(serializers.Serializer):
    resolution_note = serializers.CharField(required=False, allow_blank=True)
