from decimal import Decimal
import re

from django.db import IntegrityError, models
from django.db.models import Q
from django.core.validators import MaxValueValidator, MinValueValidator
from django.core.exceptions import ValidationError
import uuid
from apps.templates.models import TemplateBlueprint
from apps.sales.models import SalesOrderItem, SalesOrder
from apps.routing.models import RoutingRule
from apps.factory.models import Process, WorkCenter, Machine, Plant
from apps.inventory.models import InventoryLocation, InventoryRoll


def _next_year_scoped_sequence(model_cls, field_name: str, prefix: str, year: int) -> str:
    base_prefix = f"{prefix}-{year}-"
    values = model_cls.objects.filter(**{f"{field_name}__startswith": base_prefix}).values_list(field_name, flat=True)
    max_suffix = 0
    pattern = re.compile(rf"^{re.escape(base_prefix)}(\d+)$")
    for value in values:
        match = pattern.match(str(value or ""))
        if not match:
            continue
        try:
            suffix = int(match.group(1))
        except (TypeError, ValueError):
            continue
        if suffix > max_suffix:
            max_suffix = suffix
    return f"{base_prefix}{max_suffix + 1:04d}"

class ProductionJob(models.Model):
    ORIGIN_CHOICES = [
        ('MTO', 'Make To Order'),
        ('STOCK', 'Stock Order'),
        ('MTS', 'Make To Stock'),
    ]

    MODE_CHOICES = [
        ('ROLL', 'Roll'),
        ('QUANTITY', 'Quantity'),
    ]

    STATUS_CHOICES = [
        ('QUEUED', 'Queued'),
        ('ASSIGNED', 'Assigned'),
        ('RUNNING', 'Running'),
        ('COMPLETED', 'Completed'),
        ('CANCELLED', 'Cancelled'),
    ]

    SOURCE_CHOICES = [
        ('SALES', 'Sales Order'),
        ('STOCK', 'Stock Order'),
        ('MTS', 'Make To Stock'),
        ('REWORK', 'Rework'),
        ('JOBWORK_RETURN', 'Job Work Return'),
    ]

    STATE_CHOICES = [
        ('WAITING', 'Waiting'),
        ('PLANNED', 'Planned'),
        ('RELEASED', 'Released'),
        ('EXECUTING', 'Executing'),
        ('PAUSED', 'Paused'),
        ('COMPLETED', 'Completed'),
        ('CANCELLED', 'Cancelled'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    job_number = models.CharField(max_length=50, unique=True)
    
    origin = models.CharField(max_length=10, choices=ORIGIN_CHOICES, default='MTO')
    source_type = models.CharField(max_length=20, choices=SOURCE_CHOICES, default='SALES')
    execution_model_version = models.PositiveSmallIntegerField(
        default=2,
        validators=[MinValueValidator(2), MaxValueValidator(2)],
    )
    job_state = models.CharField(max_length=20, choices=STATE_CHOICES, default='PLANNED')
    
    # Relationships
    template = models.ForeignKey(TemplateBlueprint, on_delete=models.PROTECT, null=True, blank=True)
    sales_order_item = models.ForeignKey(SalesOrderItem, on_delete=models.SET_NULL, null=True, blank=True)
    mts_order = models.ForeignKey('PlannedStockOrder', on_delete=models.SET_NULL, null=True, blank=True, related_name='jobs')
    routing_rule = models.ForeignKey(RoutingRule, on_delete=models.PROTECT)
    
    # Execution Tracking (Phase 28)
    current_step_index = models.IntegerField(default=0)
    current_process = models.ForeignKey(Process, on_delete=models.PROTECT, related_name='active_jobs', null=True, blank=True)
    
    # Legacy - will be removed after data migration
    routing_step_index = models.IntegerField(default=0)
    process = models.ForeignKey(Process, on_delete=models.PROTECT, related_name='jobs', null=True, blank=True)
    
    work_center = models.ForeignKey(WorkCenter, on_delete=models.PROTECT, related_name='jobs', null=True, blank=True)
    machine = models.ForeignKey(Machine, on_delete=models.PROTECT, null=True, blank=True, related_name='jobs')
    operator = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='operated_jobs')
    
    # Planning
    priority = models.IntegerField(default=100)
    planned_date = models.DateField(null=True, blank=True)
    is_on_hold = models.BooleanField(default=False)
    hold_reason = models.CharField(max_length=255, null=True, blank=True)
    planner_notes = models.TextField(null=True, blank=True)
    current_step_issue_policy_overrides = models.JSONField(
        default=list,
        blank=True,
        help_text="Current-step WCM overrides for material planning lines.",
    )
    current_step_material_confirmations = models.JSONField(
        default=list,
        blank=True,
        help_text="WCM-selected current-step material actuals, including granule code split issue rows.",
    )

    # Forms (Physics-Driven)
    INPUT_FORM_CHOICES = [
        ('NONE', 'None'),
        ('BULK', 'Bulk'),
        ('ROLL', 'Roll'),
    ]
    OUTPUT_FORM_CHOICES = [
        ('BULK', 'Bulk'),
        ('ROLL', 'Roll'),
    ]
    input_form = models.CharField(max_length=10, choices=INPUT_FORM_CHOICES, default='BULK')
    output_form = models.CharField(max_length=10, choices=OUTPUT_FORM_CHOICES, default='ROLL')

    # Quantities (Phase 28)
    produced_qty = models.DecimalField(max_digits=12, decimal_places=4, default=0)
    remaining_qty = models.DecimalField(max_digits=12, decimal_places=4, default=0)
    closed_with_variance = models.BooleanField(default=False)
    completion_variance_kg = models.DecimalField(max_digits=12, decimal_places=4, default=0)
    completion_force_reason = models.TextField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    closed_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='closed_production_jobs'
    )

    # Inventory flow
    from_location = models.ForeignKey(InventoryLocation, on_delete=models.PROTECT, related_name='jobs_from', null=True, blank=True)
    to_location = models.ForeignKey(InventoryLocation, on_delete=models.PROTECT, related_name='jobs_to', null=True, blank=True)
    
    quantity = models.DecimalField(max_digits=12, decimal_places=2) # Planned Target Qty
    uom = models.CharField(max_length=10, default='KG')
    
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='QUEUED')
    
    start_date = models.DateTimeField(null=True, blank=True)
    end_date = models.DateTimeField(null=True, blank=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'production_jobs'
        # constraints = [
        #     models.CheckConstraint(
        #         check=Q(execution_model_version=2),
        #         name='production_job_execution_model_version_v2_only',
        #     ),
        # ]

    @property
    def sales_order_no(self):
        if self.sales_order_item:
            return self.sales_order_item.sales_order.order_number
        if hasattr(self, 'mts_order') and self.mts_order:
            return self.mts_order.order_number
        return "STOCK"

    @property
    def customer_name(self):
        if self.sales_order_item:
            return self.sales_order_item.sales_order.customer_name
        if hasattr(self, 'mts_order') and self.mts_order:
            return "INTERNAL STOCK"
        return "INTERNAL STOCK"

    @property
    def product_name(self):
        return self.template.name if self.template else "CUSTOM"

    @property
    def total_routing_steps(self):
        return len(self.routing_rule.ordered_processes)

    def __str__(self):
        proc_code = self.current_process.code if self.current_process else "NO_PROC"
        return f"{self.job_number} | {proc_code} ({self.current_step_index + 1}/{self.total_routing_steps}) | {self.status}"

class PlannedOrder(models.Model):
    STATUS_CHOICES = [
        ('DRAFT', 'Draft'),
        ('RELEASED', 'Released'),
        ('CANCELLED', 'Cancelled'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    reference_code = models.CharField(max_length=50, unique=True, blank=True)
    
    template = models.ForeignKey(TemplateBlueprint, on_delete=models.PROTECT)
    quantity = models.DecimalField(max_digits=12, decimal_places=2)
    plant = models.ForeignKey('factory.Plant', on_delete=models.PROTECT)
    
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='DRAFT')
    
    created_by = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True, related_name='planned_orders')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'production_planned_orders'

    @classmethod
    def _next_reference_code(cls, now=None) -> str:
        from django.utils import timezone

        current_time = now or timezone.now()
        return _next_year_scoped_sequence(cls, "reference_code", "MTS", current_time.year)

    def save(self, *args, **kwargs):
        if not self.reference_code:
            self.reference_code = self._next_reference_code()
        for attempt in range(3):
            try:
                super().save(*args, **kwargs)
                return
            except IntegrityError as exc:
                if self.pk or not self.reference_code or "reference_code" not in str(exc):
                    raise
                if attempt == 2:
                    raise
                self.reference_code = self._next_reference_code()

    def __str__(self):
        return f"{self.reference_code} | {self.template.name} ({self.status})"

class PlannedStockOrder(models.Model):
    """
    Internal storage model for Stock Orders (Sales-like MTS refactor).
    """
    STATUS_CHOICES = [
        ('DRAFT', 'Draft'),
        ('PLANNING_REQUIRED', 'Planning Required'),
        ('PLANNED', 'Planned'),
        ('RELEASED', 'Released'),
        ('STOCK_READY', 'Stock Ready'),
        ('COMPLETED', 'Completed'),
        ('CANCELLED', 'Cancelled'),
    ]
    STOCK_PURPOSE_CHOICES = [
        ('PRODUCT', 'Product'),
        ('PACKAGING', 'Packaging Material'),
    ]
    STOCK_STRATEGY_CHOICES = [
        ('FINAL_STOCK', 'Final Stock'),
        ('INTERMEDIATE_POOL', 'Intermediate Pool'),
        ('PACKAGING_STOCK', 'Packaging Stock'),
    ]
    PLANNER_STOCK_CLASS_CHOICES = [
        ('FINAL_PRODUCT', 'Final Product'),
        ('FINAL_PLAIN_ROLL', 'Final Plain Roll'),
        ('EXTRUDED_BASE_ROLL', 'Extruded/Base Roll'),
        ('SHARED_INVARIANT_ROLL', 'Shared Invariant Roll'),
        ('PACKAGING_STOCK', 'Packaging Stock'),
    ]
    QUANTITY_UOM_CHOICES = [
        ('KG', 'Kilograms'),
        ('PCS', 'Pieces'),
        ('METER', 'Meter'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order_number = models.CharField(max_length=50, unique=True, blank=True)
    internal_name = models.CharField(max_length=255, blank=True, default='')
    
    template = models.ForeignKey(TemplateBlueprint, on_delete=models.PROTECT)
    plant = models.ForeignKey('factory.Plant', on_delete=models.PROTECT, null=True, blank=True)
    
    target_qty = models.DecimalField(max_digits=12, decimal_places=2)
    quantity_uom = models.CharField(max_length=10, choices=QUANTITY_UOM_CHOICES, default='KG')
    produced_qty = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    geometry_override = models.JSONField(default=dict, blank=True)
    geometry_snapshot = models.JSONField(default=dict, blank=True)
    layer_snapshot = models.JSONField(default=list, blank=True)
    printing_snapshot = models.JSONField(default=dict, blank=True)
    addons_snapshot = models.JSONField(default=list, blank=True)
    packaging_snapshot = models.JSONField(default=dict, blank=True)
    bom_snapshot = models.JSONField(default=dict, blank=True)
    planner_origin_meta = models.JSONField(default=dict, blank=True)
    spec_signature = models.CharField(max_length=128, blank=True, default='')
    invariant_signature = models.CharField(max_length=128, blank=True, default='')
    unit_weight_g = models.DecimalField(max_digits=12, decimal_places=4, default=0)
    total_weight_kg = models.DecimalField(max_digits=12, decimal_places=4, default=0)
    output_type = models.CharField(max_length=20, default='WIP_ROLL')
    stock_purpose = models.CharField(max_length=20, choices=STOCK_PURPOSE_CHOICES, default='PRODUCT')
    stock_strategy = models.CharField(max_length=30, choices=STOCK_STRATEGY_CHOICES, default='FINAL_STOCK')
    planner_stock_class = models.CharField(
        max_length=30,
        choices=PLANNER_STOCK_CLASS_CHOICES,
        blank=True,
        default='',
    )
    packaging_material = models.ForeignKey(
        'materials.InventoryMaterial',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='packaging_stock_orders',
    )
    artwork_assignment_required = models.BooleanField(default=False)
    assigned_artwork = models.ForeignKey(
        'artwork.Artwork',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='planned_stock_orders_assigned',
    )
    start_step_index = models.IntegerField(default=0, help_text="Routing step index to start execution from")
    stop_step_index = models.IntegerField(null=True, blank=True, help_text="Optional: Stop production at this routing step")
    target_step_index = models.IntegerField(null=True, blank=True, help_text="Optional: Stop production at this routing step")
    
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='DRAFT')
    
    created_by = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True, related_name='stock_planner_orders')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'production_mts_orders'
        ordering = ['-created_at']

    @classmethod
    def _next_order_number(cls, now=None) -> str:
        from django.utils import timezone

        current_time = now or timezone.now()
        return _next_year_scoped_sequence(cls, "order_number", "STK", current_time.year)

    def save(self, *args, **kwargs):
        generated_order_number = False
        if not self.order_number:
            self.order_number = self._next_order_number()
            generated_order_number = True
        if not self.planner_stock_class:
            self.planner_stock_class = self.derive_planner_stock_class()
        for attempt in range(3):
            try:
                super().save(*args, **kwargs)
                return
            except IntegrityError as exc:
                if self.pk or not self.order_number or not generated_order_number:
                    raise
                if attempt == 2:
                    raise
                self.order_number = self._next_order_number()
                generated_order_number = True

    def __str__(self):
        return f"{self.order_number} | {self.internal_name or self.template.name}"

    def clean(self):
        if self.stock_purpose == 'PACKAGING':
            if not self.packaging_material:
                raise ValidationError({'packaging_material': 'packaging_material is required for PACKAGING purpose stock orders.'})
            if str(self.packaging_material.category or '').upper() != 'PACKAGING':
                raise ValidationError({'packaging_material': 'packaging_material must be category=PACKAGING.'})
            material_uom = str(self.packaging_material.base_uom or '').upper()
            if material_uom not in {'KG', 'PCS'}:
                raise ValidationError({'packaging_material': 'In-house PACKAGING output supports only KG/PCS base_uom in V1.'})
            if str(self.quantity_uom or '').upper() != material_uom:
                raise ValidationError({'quantity_uom': f'quantity_uom must match packaging material base_uom ({material_uom}).'})
            if self.stock_strategy != 'PACKAGING_STOCK':
                raise ValidationError({'stock_strategy': 'PACKAGING purpose orders must use stock_strategy=PACKAGING_STOCK.'})
            if self.planner_stock_class and self.planner_stock_class != 'PACKAGING_STOCK':
                raise ValidationError({'planner_stock_class': 'PACKAGING purpose orders must use planner_stock_class=PACKAGING_STOCK.'})
        elif self.packaging_material_id:
            raise ValidationError({'packaging_material': 'packaging_material must be null when stock_purpose is PRODUCT.'})
        elif self.stock_strategy == 'PACKAGING_STOCK':
            raise ValidationError({'stock_strategy': 'PACKAGING_STOCK is only valid when stock_purpose=PACKAGING.'})

    def derive_planner_stock_class(self):
        stock_purpose = str(self.stock_purpose or 'PRODUCT').upper()
        if stock_purpose == 'PACKAGING':
            return 'PACKAGING_STOCK'
        template = getattr(self, 'template', None)
        route_steps = (getattr(getattr(template, 'routing_rule', None), 'ordered_processes', None) or []) if template else []
        route_last = max(0, len(route_steps) - 1)
        stop_idx = self.stop_step_index if self.stop_step_index is not None else route_last
        try:
            stop_idx = int(stop_idx)
        except Exception:
            stop_idx = route_last
        fg_type = str(getattr(template, 'fg_type', '') or '').upper()
        if stop_idx < route_last:
            if stop_idx <= 0:
                return 'EXTRUDED_BASE_ROLL'
            return 'SHARED_INVARIANT_ROLL'
        if fg_type == 'ROLL':
            return 'FINAL_PLAIN_ROLL'
        return 'FINAL_PRODUCT'


class PlannerSku(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=64, unique=True)
    name = models.CharField(max_length=255)
    template = models.ForeignKey(TemplateBlueprint, on_delete=models.PROTECT, related_name="planner_skus")
    default_plant = models.ForeignKey(
        'factory.Plant',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='planner_skus',
    )
    active = models.BooleanField(default=True)
    notes = models.TextField(blank=True, default="")
    created_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='planner_skus',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "production_planner_skus"
        ordering = ["name", "code"]

    def __str__(self):
        return f"{self.code} | {self.name}"


class PlannerSkuVariant(models.Model):
    LAUNCH_KIND_CHOICES = [
        ('FINAL_ROLL', 'Final Roll'),
        ('SHARED_INVARIANT_ROLL', 'Shared Invariant Roll'),
        ('BASE_UPSTREAM_ROLL', 'Base / Upstream Roll'),
        ('PACKAGING_STOCK', 'Packaging Stock'),
        ('POD_STOCK', 'POD Stock'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sku = models.ForeignKey(PlannerSku, on_delete=models.CASCADE, related_name="variants")
    code = models.CharField(max_length=64, unique=True)
    name = models.CharField(max_length=255)
    active = models.BooleanField(default=True)
    launch_kind = models.CharField(max_length=32, choices=LAUNCH_KIND_CHOICES)
    template = models.ForeignKey(
        TemplateBlueprint,
        on_delete=models.PROTECT,
        related_name="planner_sku_variants",
        null=True,
        blank=True,
    )
    default_plant = models.ForeignKey(
        'factory.Plant',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='planner_sku_variants',
    )
    default_qty = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    quantity_uom = models.CharField(max_length=10, choices=PlannedStockOrder.QUANTITY_UOM_CHOICES, default='KG')
    stock_purpose = models.CharField(max_length=20, choices=PlannedStockOrder.STOCK_PURPOSE_CHOICES, default='PRODUCT')
    stock_strategy = models.CharField(max_length=30, choices=PlannedStockOrder.STOCK_STRATEGY_CHOICES, default='FINAL_STOCK')
    planner_stock_class = models.CharField(
        max_length=30,
        choices=PlannedStockOrder.PLANNER_STOCK_CLASS_CHOICES,
        blank=True,
        default='',
    )
    start_step_index = models.IntegerField(default=0)
    stop_step_index = models.IntegerField(null=True, blank=True)
    geometry_snapshot = models.JSONField(default=dict, blank=True)
    layer_snapshot = models.JSONField(default=list, blank=True)
    printing_snapshot = models.JSONField(default=dict, blank=True)
    addons_snapshot = models.JSONField(default=list, blank=True)
    packaging_snapshot = models.JSONField(default=dict, blank=True)
    packaging_material = models.ForeignKey(
        'materials.InventoryMaterial',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='planner_sku_variants',
    )
    pod_sku_variant = models.ForeignKey(
        'materials.PodSkuVariant',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='planner_variants',
    )
    planner_origin_meta = models.JSONField(default=dict, blank=True)
    spec_signature = models.CharField(max_length=128, blank=True, default='')
    invariant_signature = models.CharField(max_length=128, blank=True, default='')
    created_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='planner_sku_variants',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "production_planner_sku_variants"
        ordering = ["sku__name", "name", "code"]

    def clean(self):
        if self.launch_kind == 'PACKAGING_STOCK':
            if self.stock_purpose != 'PACKAGING':
                raise ValidationError({'stock_purpose': 'Packaging planner presets must use stock_purpose=PACKAGING.'})
            if not self.packaging_material:
                raise ValidationError({'packaging_material': 'Packaging planner presets require packaging_material.'})
        if self.launch_kind == 'POD_STOCK' and not self.pod_sku_variant:
            raise ValidationError({'pod_sku_variant': 'POD planner presets require pod_sku_variant.'})

    def save(self, *args, **kwargs):
        if not self.template_id and self.sku_id:
            self.template_id = self.sku.template_id
        if not self.default_plant_id and self.sku_id and self.sku.default_plant_id:
            self.default_plant_id = self.sku.default_plant_id
        if not self.planner_stock_class and self.launch_kind != 'POD_STOCK':
            synthetic = PlannedStockOrder(
                template=self.template or self.sku.template,
                stock_purpose=self.stock_purpose,
                stock_strategy=self.stock_strategy,
                stop_step_index=self.stop_step_index,
            )
            self.planner_stock_class = synthetic.derive_planner_stock_class()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.code} | {self.name}"


class PlannedBulkStockOrder(models.Model):
    STATUS_CHOICES = [
        ('DRAFT', 'Draft'),
        ('PLANNING_REQUIRED', 'Planning Required'),
        ('PLANNED', 'Planned'),
        ('RELEASED', 'Released'),
        ('STOCK_READY', 'Stock Ready'),
        ('COMPLETED', 'Completed'),
        ('CANCELLED', 'Cancelled'),
    ]
    BULK_CLASS_CHOICES = [
        ('POD_BULK', 'POD Bulk'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order_number = models.CharField(max_length=50, unique=True, blank=True)
    internal_name = models.CharField(max_length=255, blank=True, default='')
    bulk_class = models.CharField(max_length=20, choices=BULK_CLASS_CHOICES, default='POD_BULK')
    material = models.ForeignKey(
        'materials.InventoryMaterial',
        on_delete=models.PROTECT,
        related_name='planned_bulk_stock_orders',
    )
    plant = models.ForeignKey('factory.Plant', on_delete=models.PROTECT, null=True, blank=True)
    target_qty_kg = models.DecimalField(max_digits=12, decimal_places=4)
    produced_qty_kg = models.DecimalField(max_digits=12, decimal_places=4, default=0)
    pod_profile_snapshot = models.JSONField(default=dict, blank=True)
    planner_origin_meta = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='PLANNING_REQUIRED')
    created_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='planned_bulk_stock_orders',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'production_mts_bulk_orders'
        ordering = ['-created_at']

    @classmethod
    def _next_order_number(cls, now=None) -> str:
        from django.utils import timezone

        current_time = now or timezone.now()
        return _next_year_scoped_sequence(cls, "order_number", "PBK", current_time.year)

    def save(self, *args, **kwargs):
        generated_order_number = False
        if not self.order_number:
            self.order_number = self._next_order_number()
            generated_order_number = True
        for attempt in range(3):
            try:
                super().save(*args, **kwargs)
                return
            except IntegrityError as exc:
                if self.pk or not self.order_number or not generated_order_number:
                    raise
                if attempt == 2:
                    raise
                self.order_number = self._next_order_number()
                generated_order_number = True

    def clean(self):
        if str(getattr(self.material, 'category', '') or '').upper() != 'POD':
            raise ValidationError({'material': 'PlannedBulkStockOrder currently supports only POD materials.'})
        if Decimal(str(self.target_qty_kg or 0)) <= 0:
            raise ValidationError({'target_qty_kg': 'target_qty_kg must be > 0.'})

    def __str__(self):
        return f"{self.order_number} | {self.material.code} ({self.status})"

class WorkCenterAssignment(models.Model):
    STATUS_CHOICES = [
        ('WC_READY', 'Ready for Preparation'),
        ('ASSIGNED', 'Resource Assigned'),
        ('EXECUTION_READY', 'Ready for Operator'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    production_job = models.OneToOneField(ProductionJob, on_delete=models.CASCADE, related_name='assignment')
    work_center = models.ForeignKey(WorkCenter, on_delete=models.PROTECT, related_name='assignments')
    
    assigned_machine = models.ForeignKey(Machine, on_delete=models.SET_NULL, null=True, blank=True, related_name='assignments')
    allocated_rolls = models.ManyToManyField('inventory.InventoryRoll', blank=True, related_name='assignments')
    
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='WC_READY')
    
    assigned_by = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True, blank=True)
    assigned_at = models.DateTimeField(null=True, blank=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'production_work_center_assignments'

    @property
    def rolls(self):
        return self.assigned_rolls.all()

    def __str__(self):
        return f"Assignment for {self.production_job.job_number} | {self.status}"

class JobExecutionLog(models.Model):
    """
    Event Log: Operator logs Good Quantity output.
    Event-Driven: Each log is a discrete event.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    production_job = models.ForeignKey(ProductionJob, on_delete=models.PROTECT, related_name='execution_logs')
    
    quantity = models.DecimalField(max_digits=12, decimal_places=4)
    uom = models.CharField(max_length=10, default='KG')
    shift_code = models.CharField(max_length=20, blank=True, default="", db_index=True)
    shift_date = models.DateField(null=True, blank=True, db_index=True)
    
    logged_by = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True)
    logged_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'production_execution_logs'

class ScrapLog(models.Model):
    """
    Event Log: Operator logs Scrap.
    """
    REASON_CHOICES = [
        ('SETUP', 'Setup Waste'),
        ('TRIM', 'Trim Loss'),
        ('DEFECT', 'Print/Quality Defect'),
        ('MACHINE', 'Machine Fault'),
        ('MATERIAL', 'Material Issue'),
        ('OTHER', 'Other'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    production_job = models.ForeignKey(ProductionJob, on_delete=models.PROTECT, related_name='scrap_logs')
    
    quantity = models.DecimalField(max_digits=12, decimal_places=4)
    uom = models.CharField(max_length=10, default='KG')
    
    reason = models.CharField(max_length=20, choices=REASON_CHOICES)
    notes = models.TextField(blank=True)
    shift_code = models.CharField(max_length=20, blank=True, default="", db_index=True)
    shift_date = models.DateField(null=True, blank=True, db_index=True)
    
    logged_by = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True)
    logged_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'production_scrap_logs'

class DowntimeLog(models.Model):
    """
    Event Log: Machine Downtime.
    """
    REASON_CHOICES = [
        ('BREAKDOWN', 'Machine Breakdown'),
        ('MAINTENANCE', 'Scheduled Maintenance'),
        ('MATERIAL', 'Material Shortage'),
        ('MANPOWER', 'Manpower Shortage'),
        ('POWER', 'Power Failure'),
        ('OTHER', 'Other'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    production_job = models.ForeignKey(ProductionJob, on_delete=models.PROTECT, related_name='downtime_logs')
    
    start_time = models.DateTimeField()
    end_time = models.DateTimeField(null=True, blank=True)
    
    reason = models.CharField(max_length=20, choices=REASON_CHOICES)
    notes = models.TextField(blank=True)
    shift_code = models.CharField(max_length=20, blank=True, default="", db_index=True)
    shift_date = models.DateField(null=True, blank=True, db_index=True)
    
    logged_by = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'production_downtime_logs'
    
    @property
    def duration_minutes(self):
        if self.end_time and self.start_time:
            delta = self.end_time - self.start_time
            return delta.total_seconds() / 60
        return 0

class MaterialConsumptionLog(models.Model):
    """
    Event Log: Actual Material Consumption (Auto-logged or Manual).
    Links to InventoryRoll (for rolls) or Material (for bulk).
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    production_job = models.ForeignKey(ProductionJob, on_delete=models.PROTECT, related_name='consumption_logs')
    
    # Generic Link to Material (for aggregation)
    material = models.ForeignKey('materials.InventoryMaterial', on_delete=models.PROTECT)
    granule_code = models.ForeignKey(
        'materials.GranuleQualityCode',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='consumption_logs',
        help_text='Optional granule vendor quality code used for consumption reporting.',
    )
    
    # Specific Link to Roll (if applicable)
    roll = models.ForeignKey('inventory.InventoryRoll', on_delete=models.PROTECT, null=True, blank=True)
    
    quantity = models.DecimalField(max_digits=12, decimal_places=4)
    uom = models.CharField(max_length=10, default='KG')
    
    is_estimated = models.BooleanField(default=False, help_text="If true, calculated by BOM, not measured.")
    
    logged_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'production_consumption_logs'

class FinishedGoodsBatch(models.Model):
    """
    Represents a batch of Finished Goods for POUCH-type products.
    Unlike Rolls which are tracked individually, Pouches are tracked as batches.
    """
    STATUS_CHOICES = [
        ('AVAILABLE', 'Available'),
        ('PACKED', 'Packed'),
        ('DISPATCHED', 'Dispatched'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch_number = models.CharField(max_length=100, unique=True)
    
    # Links
    template = models.ForeignKey(TemplateBlueprint, on_delete=models.PROTECT, related_name='fg_batches')
    production_job = models.ForeignKey(ProductionJob, on_delete=models.PROTECT, related_name='fg_batches')
    sales_order_item = models.ForeignKey(SalesOrderItem, on_delete=models.PROTECT, related_name='fg_batches', db_index=True, null=True, blank=True)
    
    # Quantity
    qty_pcs = models.IntegerField(help_text="Primary UOM: Pieces")
    dispatched_qty_pcs = models.IntegerField(default=0, help_text="Quantity already dispatched")
    qty_kg = models.DecimalField(max_digits=12, decimal_places=4, null=True, blank=True, help_text="Weight in KG")
    geometry_override = models.JSONField(default=dict, blank=True)
    meta_json = models.JSONField(default=dict, blank=True)
    completed_step_index = models.IntegerField(default=0, help_text="Canonical completed route step index")
    
    # Location & Status
    location = models.ForeignKey('inventory.InventoryLocation', on_delete=models.PROTECT, related_name='fg_batches')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='AVAILABLE')
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    @property
    def sales_order_no(self):
        return self.sales_order_item.sales_order.order_number if self.sales_order_item else "N/A"

    @property
    def customer_name(self):
        return self.sales_order_item.sales_order.customer_name if self.sales_order_item else "N/A"

    class Meta:
        db_table = 'production_fg_batches'
        verbose_name = "Finished Goods Batch"
        verbose_name_plural = "Finished Goods Batches"

    def __str__(self):
        return f"{self.batch_number} | {self.template.name} | {self.qty_pcs} PCS"


class PackingUnit(models.Model):
    """
    Gonny: A packed unit containing pouches from an FG Batch.
    Used for tracking pouches during dispatch.
    """
    STATUS_CHOICES = [
        ('OPEN', 'Open'),
        ('SEALED', 'Sealed'),
        ('DISPATCHED', 'Dispatched'),
    ]
    CONTENT_MODE_CHOICES = [
        ('LOOSE_POUCHES', 'Loose Pouches'),
        ('PRIMARY_PACKS', 'Primary Packs'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    label_id = models.CharField(max_length=100, unique=True)
    
    # Link to source FG Batch & SO Item
    fg_batch = models.ForeignKey(FinishedGoodsBatch, on_delete=models.PROTECT, related_name='packing_units')
    sales_order_item = models.ForeignKey(SalesOrderItem, on_delete=models.PROTECT, related_name='packing_units', db_index=True, null=True, blank=True)
    
    # Quantity
    qty_pcs = models.IntegerField(help_text="Number of pieces packed")
    content_mode = models.CharField(max_length=30, choices=CONTENT_MODE_CHOICES, default='LOOSE_POUCHES')
    primary_pack_count = models.IntegerField(null=True, blank=True)
    weight_kg = models.DecimalField(max_digits=12, decimal_places=4, null=True, blank=True, help_text="Weight after sealing")
    net_product_weight_kg = models.DecimalField(max_digits=12, decimal_places=4, null=True, blank=True, help_text="Net product content weight excluding packaging tare.")
    inner_pack_tare_kg = models.DecimalField(max_digits=12, decimal_places=4, default=0, help_text="Primary inner-pack tare weight.")
    secondary_pack_tare_kg = models.DecimalField(max_digits=12, decimal_places=4, default=0, help_text="Gonny / secondary pack tare weight.")
    extras_tare_kg = models.DecimalField(max_digits=12, decimal_places=4, default=0, help_text="Seal extras / tape / tags tare weight.")
    gross_weight_kg = models.DecimalField(max_digits=12, decimal_places=4, null=True, blank=True, help_text="Gross shipment weight after sealing.")
    tare_breakdown_json = models.JSONField(default=dict, blank=True)
    meta_json = models.JSONField(default=dict, blank=True)
    
    # Location & Status
    location = models.ForeignKey('inventory.InventoryLocation', on_delete=models.PROTECT, related_name='packing_units')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='OPEN')
    
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='created_packing_units')
    sealed_at = models.DateTimeField(null=True, blank=True)

    @property
    def sales_order_no(self):
        return self.sales_order_item.sales_order.order_number if self.sales_order_item else "N/A"

    @property
    def customer_name(self):
        return self.sales_order_item.sales_order.customer_name if self.sales_order_item else "N/A"

    class Meta:
        db_table = 'production_packing_units'
        verbose_name = "Packing Unit (Gonny)"
        verbose_name_plural = "Packing Units (Gonnies)"

    def __str__(self):
        if self.content_mode == 'PRIMARY_PACKS' and self.primary_pack_count:
            return f"{self.label_id} | {self.qty_pcs} PCS | {self.primary_pack_count} PACKS | {self.status}"
        return f"{self.label_id} | {self.qty_pcs} PCS | {self.status}"


class DeliveryChallan(models.Model):
    """
    Dispatch document for FG shipments.
    Tracks status from DRAFT -> DISPATCHED -> RECEIVED.
    """
    STATUS_CHOICES = [
        ('DRAFT', 'Draft'),
        ('DISPATCHED', 'Dispatched'),
        ('IN_TRANSIT', 'In Transit'),
        ('DELIVERED', 'Delivered'),
        ('RETURNED', 'Returned'),
        ('CANCELLED', 'Cancelled'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    dc_no = models.CharField(max_length=50, unique=True)
    
    # Customer & Order
    customer_name = models.CharField(max_length=200)
    sales_order = models.ForeignKey(SalesOrder, on_delete=models.SET_NULL, null=True, blank=True, related_name='challans')
    plant = models.ForeignKey(Plant, on_delete=models.PROTECT, related_name='challans')
    
    # Status & Transport
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='DRAFT')
    vehicle_no = models.CharField(max_length=50, blank=True)
    driver_name = models.CharField(max_length=100, blank=True)
    driver_phone = models.CharField(max_length=20, blank=True)
    
    # Timestamps
    dispatch_date = models.DateTimeField(null=True, blank=True)
    received_date = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='created_challans')

    class Meta:
        db_table = 'production_delivery_challans'
        verbose_name = "Delivery Challan"
        verbose_name_plural = "Delivery Challans"
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.dc_no} | {self.customer_name} | {self.status}"


class DeliveryChallanItem(models.Model):
    """
    Line item in Delivery Challan - either a Roll or a Gonny (PackingUnit).
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    challan = models.ForeignKey(DeliveryChallan, on_delete=models.CASCADE, related_name='items')
    sales_order_item = models.ForeignKey(SalesOrderItem, on_delete=models.PROTECT, related_name='challan_items', db_index=True, null=True, blank=True)
    
    # One of these will be set
    roll = models.ForeignKey(InventoryRoll, on_delete=models.SET_NULL, null=True, blank=True, related_name='challan_items')
    packing_unit = models.ForeignKey(PackingUnit, on_delete=models.SET_NULL, null=True, blank=True, related_name='challan_items')
    fg_batch = models.ForeignKey(FinishedGoodsBatch, on_delete=models.SET_NULL, null=True, blank=True, related_name='challan_items')
    
    # Quantity/Weight
    weight_kg = models.DecimalField(max_digits=12, decimal_places=4)
    qty_pcs = models.IntegerField(null=True, blank=True, help_text="For gonnies/pouches only")
    
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'production_delivery_challan_items'
        verbose_name = "Delivery Challan Item"
        verbose_name_plural = "Delivery Challan Items"

    def __str__(self):
        item_type = "Roll" if self.roll else "Gonny"
        item_id = self.roll.label_id if self.roll else (self.packing_unit.label_id if self.packing_unit else "N/A")
        return f"{item_type}: {item_id} | {self.weight_kg} KG"


class RollDispatchPackRecord(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    roll = models.ForeignKey('inventory.InventoryRoll', on_delete=models.CASCADE, related_name='dispatch_pack_records')
    sales_order_item = models.ForeignKey(SalesOrderItem, on_delete=models.PROTECT, related_name='roll_dispatch_pack_records')
    packed_by = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='roll_pack_actions')
    packed_at = models.DateTimeField(auto_now_add=True)
    lines = models.JSONField(default=list, blank=True)
    tx_ids = models.JSONField(default=list, blank=True)
    meta_json = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = 'production_roll_dispatch_pack_records'
        ordering = ['-packed_at']
        constraints = [
            models.UniqueConstraint(fields=['roll', 'sales_order_item'], name='uniq_roll_dispatch_pack_record'),
        ]

    def __str__(self):
        return f"{self.roll.label_id} packed for {self.sales_order_item_id}"


class JobMaterialRequirement(models.Model):
    """
    Planned vs Actual material usage for a job.
    Generated from BOM Explosion at job creation/planning.
    Critically links Execution to Planning.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    production_job = models.ForeignKey(ProductionJob, on_delete=models.CASCADE, related_name='material_requirements')
    material = models.ForeignKey('materials.InventoryMaterial', on_delete=models.PROTECT, related_name='job_requirements')
    
    # Phase 70: Link to specific process step for per-step consumption
    process_step = models.ForeignKey('templates.TemplateProcessStep', on_delete=models.SET_NULL, 
        null=True, blank=True, related_name='job_requirements',
        help_text="Which process step this requirement belongs to")
    
    required_qty = models.DecimalField(max_digits=12, decimal_places=4, default=0, help_text="Total calculated requirement")
    theoretical_qty = models.DecimalField(max_digits=12, decimal_places=4, default=0, help_text="Ideal no-loss theoretical requirement")
    planned_issue_qty = models.DecimalField(max_digits=12, decimal_places=4, default=0, help_text="Planned issue after applying issue policy")
    assigned_qty = models.DecimalField(max_digits=12, decimal_places=4, default=0, help_text="Total currently assigned/reserved")
    actual_issued_qty = models.DecimalField(max_digits=12, decimal_places=4, default=0, help_text="Actual gross issued quantity")
    actual_returned_qty = models.DecimalField(max_digits=12, decimal_places=4, default=0, help_text="Actual returned usable quantity")
    consumed_qty = models.DecimalField(max_digits=12, decimal_places=4, default=0, help_text="Total actually consumed")
    actual_scrap_qty = models.DecimalField(max_digits=12, decimal_places=4, default=0, help_text="Actual scrap quantity")
    variance_qty = models.DecimalField(max_digits=12, decimal_places=4, default=0, help_text="Consumed minus theoretical variance")
    is_estimated = models.BooleanField(default=False, help_text="True when actual values were estimated instead of directly captured")
    
    uom = models.CharField(max_length=10, default='KG')
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'production_job_material_requirements'
        unique_together = ['production_job', 'material', 'process_step']
        verbose_name = "Job Material Requirement"

    def __str__(self):
        return f"{self.production_job.job_number} -> {self.material.code}: {self.assigned_qty}/{self.required_qty}"


class InkBlendTransaction(models.Model):
    """
    Tracks ink return lineage when a returned color is remixed into another ink.
    """
    RETURN_MODE_CHOICES = [
        ("EXACT_COLOR_RETURN", "Exact Color Return"),
        ("REMIXED_RETURN", "Remixed Return"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    production_job = models.ForeignKey(
        ProductionJob,
        on_delete=models.CASCADE,
        related_name="ink_blend_transactions",
    )
    process_step = models.ForeignKey(
        "templates.TemplateProcessStep",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="ink_blend_transactions",
    )
    source_requirement = models.ForeignKey(
        JobMaterialRequirement,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="ink_blend_source_transactions",
    )
    source_material = models.ForeignKey(
        "materials.InventoryMaterial",
        on_delete=models.PROTECT,
        related_name="ink_blend_source_transactions",
    )
    target_material = models.ForeignKey(
        "materials.InventoryMaterial",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="ink_blend_target_transactions",
    )
    return_mode = models.CharField(max_length=30, choices=RETURN_MODE_CHOICES, default="EXACT_COLOR_RETURN")
    returned_qty_kg = models.DecimalField(max_digits=12, decimal_places=4, default=0)
    created_by = models.ForeignKey("users.User", on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "production_ink_blend_transactions"
        ordering = ["-created_at"]

    def __str__(self):
        src = getattr(self.source_material, "code", "SRC")
        tgt = getattr(self.target_material, "code", None) or src
        return f"{self.production_job.job_number}: {src} -> {tgt} ({self.returned_qty_kg}kg)"


class InventoryAllocation(models.Model):
    STATUS_CHOICES = [
        ('ACTIVE', 'Active'),
        ('CONSUMED', 'Consumed'),
        ('RELEASED', 'Released'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    sales_order = models.ForeignKey(
        SalesOrder,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='inventory_allocations',
    )
    mts_order = models.ForeignKey(
        PlannedStockOrder,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='inventory_allocations',
    )

    inventory_roll = models.ForeignKey(
        InventoryRoll,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='planner_allocations',
    )
    fg_batch = models.ForeignKey(
        FinishedGoodsBatch,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='planner_allocations',
    )

    allocated_qty_kg = models.DecimalField(max_digits=12, decimal_places=4)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='ACTIVE')
    created_by = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'production_inventory_allocations'
        # constraints = [
        #     models.CheckConstraint(
        #         check=(
        #             (models.Q(sales_order__isnull=False) & models.Q(mts_order__isnull=True))
        #             | (models.Q(sales_order__isnull=True) & models.Q(mts_order__isnull=False))
        #         ),
        #         name='allocation_exactly_one_order_fk',
        #     ),
        #     models.CheckConstraint(
        #         check=(
        #             (models.Q(inventory_roll__isnull=False) & models.Q(fg_batch__isnull=True))
        #             | (models.Q(inventory_roll__isnull=True) & models.Q(fg_batch__isnull=False))
        #         ),
        #         name='allocation_exactly_one_inventory_fk',
        #     ),
        #     models.CheckConstraint(
        #         check=models.Q(allocated_qty_kg__gt=0),
        #         name='allocation_qty_positive',
        #     ),
        # ]

    def __str__(self):
        target = self.sales_order.order_number if self.sales_order_id else self.mts_order.order_number
        inventory = self.inventory_roll.label_id if self.inventory_roll_id else self.fg_batch.batch_number
        return f"{target} <- {inventory} ({self.allocated_qty_kg} KG)"
