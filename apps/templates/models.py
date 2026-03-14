from django.db import models
from django.core.exceptions import ValidationError
import uuid
from apps.routing.models import RoutingRule

class TemplateBlueprint(models.Model):
    """
    Route policy blueprint for manufacturing flow orchestration.
    Once LIVE, this record is Immutable.
    """
    FG_TYPE_CHOICES = [
        ('POUCH', 'Pouch'),
        ('ROLL', 'Roll'),
    ]

    STATUS_CHOICES = [
        ('DRAFT', 'Draft'),
        ('ENGINEERING', 'Engineering Review'),
        ('APPROVED', 'Approved'),
        ('LIVE', 'Live'),
        ('OBSOLETE', 'Obsolete'),
    ]
    STOCK_STRATEGY_CHOICES = [
        ('FINAL_STOCK', 'Final Stock'),
        ('INTERMEDIATE_POOL', 'Intermediate Pool'),
        ('PACKAGING_STOCK', 'Packaging Stock'),
    ]
    POUCH_STYLE_CHOICES = [
        ("THREE_SIDE_SEAL", "Three Side Seal"),
        ("PILLOW", "Pillow"),
        ("STAND_UP", "Stand Up"),
        ("SIDE_GUSSET", "Side Gusset"),
        ("QUAD_SEAL", "Quad Seal"),
        ("FLAT_BOTTOM", "Flat Bottom"),
        ("SPOUT", "Spout"),
        ("SHAPED", "Shaped"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    fg_type = models.CharField(max_length=20, choices=FG_TYPE_CHOICES)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='DRAFT')
    commercial_family = models.ForeignKey(
        'materials.CommercialFamily',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='templates',
        help_text="Controlled business-facing family alias used for naming, stock grouping, and reporting.",
    )

    # Routing (Mandatory for LIVE)
    routing_rule = models.ForeignKey(RoutingRule, on_delete=models.PROTECT, null=True, blank=True)
    version = models.IntegerField(default=1)
    default_stock_strategy = models.CharField(
        max_length=30,
        choices=STOCK_STRATEGY_CHOICES,
        default='FINAL_STOCK',
        help_text="Default planner consumption strategy for stock orders cloned or created from this template.",
    )
    pouch_style = models.CharField(
        max_length=32,
        choices=POUCH_STYLE_CHOICES,
        blank=True,
        default="",
        help_text="Controlled pouch taxonomy used for validation, repeat-order safety, and reporting.",
    )
    
    created_by = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True, related_name='templates_created')
    approved_by = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='templates_approved')
    approved_at = models.DateTimeField(null=True, blank=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'production_templates'

    def __str__(self):
        return f"{self.name} ({self.status})"

    def clean(self):
        # 1. LIVE requires Routing
        if self.status == 'LIVE' and not self.routing_rule:
            raise ValidationError({'routing_rule': "Template cannot be LIVE without a Routing Rule."})

    def approve(self, user):
        """Transition from ENGINEERING -> APPROVED"""
        # Logic is now more complex, handled in Service
        if self.status not in ['DRAFT', 'ENGINEERING']:
            raise ValidationError(f"Cannot approve template in {self.status} state.")
        self.status = 'APPROVED'
        self.approved_by = user
        from django.utils import timezone
        self.approved_at = timezone.now()
        self.save()

    def publish(self):
        """Transition from APPROVED -> LIVE"""
        if self.status != 'APPROVED':
            raise ValidationError(f"Cannot publish template. Current status: {self.status}. Must be APPROVED first.")
        if not self.routing_rule:
            raise ValidationError("Cannot publish template without a Routing Rule.")
        self.status = 'LIVE'
        self.save()


# ==============================================================================
# Phase 70: Step-Aware Template System
# ==============================================================================

class TemplateProcessStep(models.Model):
    """
    Defines a step in the template's manufacturing route.
    Replaces JSON-based routing with explicit database relationships.
    
    Example:
        Step 1 - Extrusion (process=EXTRUSION)
        Step 2 - Printing (process=ROTO_PRINT)
        Step 3 - Lamination (process=LAMINATION)
        Step 4 - Pouching (process=POUCH)
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    template = models.ForeignKey(TemplateBlueprint, on_delete=models.CASCADE, related_name='process_steps')
    sequence_number = models.IntegerField(help_text="Execution order (1, 2, 3...)")
    process = models.ForeignKey('factory.Process', on_delete=models.PROTECT, related_name='template_steps')
    
    # Optional notes for this step
    notes = models.TextField(blank=True)
    is_removed_from_route = models.BooleanField(
        default=False,
        help_text="Marks steps that no longer exist in the bound routing rule but are preserved for history/migration.",
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'template_process_steps'
        unique_together = ['template', 'sequence_number']
        ordering = ['sequence_number']

    def __str__(self):
        return f"{self.template.name} - Step {self.sequence_number}: {self.process.name}"


class TemplateProcessStepRollSpec(models.Model):
    """
    Explicit per-step roll handling rules.
    Source of truth for step-level roll handling refinements inside the owning Process contract.
    """
    THICKNESS_RULE_CHOICES = [
        ('INHERIT_INPUT', 'Inherit Input'),
        ('SUM_INPUTS', 'Sum Inputs'),
        ('FIXED', 'Fixed'),
        ('TEMPLATE_DEFAULT', 'Template Default'),
    ]

    WIDTH_RULE_CHOICES = [
        ('LOCK_INPUT', 'Lock Input Width'),
        ('MIN_INPUT', 'Min Input Width'),
        ('FIXED', 'Fixed'),
        ('OPERATOR', 'Operator Entered'),
        ('OPERATOR_GRID', 'Operator Grid'),
        ('TEMPLATE_DEFAULT', 'Template Default'),
    ]

    OPERATOR_ENTRY_MODE_CHOICES = [
        ('PROCESS_DEFAULT', 'Process Default'),
        ('ROLL_SINGLE', 'Single Roll Output'),
        ('ROLL_MULTI', 'Multiple Roll Outputs'),
        ('GRID_SPLIT', 'Grid Split'),
        ('DISCRETE_ONLY', 'Discrete Only'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    template_step = models.OneToOneField(
        TemplateProcessStep,
        on_delete=models.CASCADE,
        related_name='roll_spec'
    )

    # Input physics
    input_roll_count = models.PositiveIntegerField(default=0)

    thickness_rule = models.CharField(
        max_length=20,
        choices=THICKNESS_RULE_CHOICES,
        default='TEMPLATE_DEFAULT'
    )

    width_rule = models.CharField(
        max_length=20,
        choices=WIDTH_RULE_CHOICES,
        default='TEMPLATE_DEFAULT'
    )

    operator_entry_mode = models.CharField(
        max_length=20,
        choices=OPERATOR_ENTRY_MODE_CHOICES,
        default='PROCESS_DEFAULT',
        help_text="Operator UI entry shape. Refines the process contract; does not override process input/output behavior.",
    )

    notes = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'template_process_step_roll_specs'

    def __str__(self):
        return f"{self.template_step.template.name} - Step {self.template_step.sequence_number} Roll Handling"

    def clean(self):
        super().clean()
        if not self.operator_entry_mode:
            self.operator_entry_mode = "PROCESS_DEFAULT"

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)


class TemplateProcessStepMaterial(models.Model):
    """
    Defines material consumption for a specific process step.
    Phase 71 Refinement: Strictly separate responsibilities.
    Template = Quantities.
    """
    CONSUMPTION_BASIS_CHOICES = [
        ('SNAPSHOT_GSM', 'Snapshot GSM'),
        ('FIXED_KG', 'Fixed KG'),
        ('FIXED_PCS', 'Fixed PCS'),
        ('CATEGORY_FORMULA', 'Category Formula'),
        ('INVALID_LEGACY', 'Invalid Legacy Mapping'),
    ]
    FORMULA_DRIVER_CHOICES = [
        ('NONE', 'None'),
        ('ADDON_MASTER_WEIGHT_MODE', 'Addon Master Weight Mode'),
        ('POD_MASTER_PROFILE', 'POD Master Profile'),
    ]
    ISSUE_POLICY_MODE_CHOICES = [
        ('NONE', 'No Planned Over-Issue'),
        ('PERCENT_OVER_THEORY', 'Percent Over Theory'),
        ('FIXED_EXTRA_KG', 'Fixed Extra KG'),
        ('MINIMUM_ISSUE_KG', 'Minimum Issue KG'),
    ]
    CAPTURE_MODE_CHOICES = [
        ('AUTO_FROM_OUTPUT', 'Auto From Output'),
        ('AUTO_ESTIMATED_CONFIRM', 'Auto Estimated Then Confirm'),
        ('OPERATOR_REQUIRED', 'Operator Required'),
    ]
    QUANTITY_MODE_CHOICES = [
        ('KG', 'KG per Unit'),
        ('GSM', 'GSM Based (Area × GSM)'),
        ('PCS', 'Pieces per Unit'),
        ('PERCENT', 'Percentage of Total'),
        ('RECIPE', 'Recipe Based')
    ]

    SOURCE_KIND_CHOICES = [
        ('CATEGORY', 'Broad Category'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    template_step = models.ForeignKey(TemplateProcessStep, on_delete=models.CASCADE, related_name='materials')
    material = models.ForeignKey('materials.InventoryMaterial', on_delete=models.PROTECT, related_name='template_usages', null=True, blank=True)
    source_kind = models.CharField(max_length=20, choices=SOURCE_KIND_CHOICES, default='CATEGORY')
    category_code = models.CharField(max_length=30, blank=True, default='')
    
    consumption_basis = models.CharField(max_length=20, choices=CONSUMPTION_BASIS_CHOICES, default='FIXED_KG')
    formula_driver = models.CharField(
        max_length=40,
        choices=FORMULA_DRIVER_CHOICES,
        default='NONE',
        help_text="Formula driver for CATEGORY_FORMULA basis.",
    )
    formula_params = models.JSONField(default=dict, blank=True)
    issue_policy_mode = models.CharField(
        max_length=30,
        choices=ISSUE_POLICY_MODE_CHOICES,
        default='NONE',
    )
    issue_policy_value = models.DecimalField(
        max_digits=12,
        decimal_places=4,
        default=0,
        help_text="Planning-only over-issue policy value. Interpretation depends on issue_policy_mode.",
    )
    capture_mode = models.CharField(
        max_length=24,
        choices=CAPTURE_MODE_CHOICES,
        default='AUTO_FROM_OUTPUT',
        help_text="Controls how the operator/execution surfaces collect actual usage for this line.",
    )
    quantity_mode = models.CharField(max_length=10, choices=QUANTITY_MODE_CHOICES, default='KG')
    # NOTE: High precision is required for PCS-based consumptions (e.g. ink per pouch can be < 0.0001 kg/pc).
    value = models.DecimalField(max_digits=12, decimal_places=8, help_text="Quantity value based on mode")

    # Metadata
    is_optional = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'template_process_step_materials'
        unique_together = ['template_step', 'category_code']
        ordering = ['template_step__sequence_number', 'id']

    def __str__(self):
        label = self.category_code or self.source_kind
        return f"{self.template_step.template.name} - {label} ({self.value} {self.consumption_basis})"

    def _normalized_consumption_basis(self):
        raw = str(self.consumption_basis or "").strip().upper()
        if raw in {choice for choice, _label in self.CONSUMPTION_BASIS_CHOICES}:
            return raw
        legacy_mode = str(self.quantity_mode or "KG").strip().upper()
        legacy_map = {
            "KG": "FIXED_KG",
            "PCS": "FIXED_PCS",
            "GSM": "SNAPSHOT_GSM",
            "PERCENT": "INVALID_LEGACY",
            "RECIPE": "INVALID_LEGACY",
        }
        return legacy_map.get(legacy_mode, "FIXED_KG")

    def clean(self):
        super().clean()
        source_kind = str(self.source_kind or 'CATEGORY').upper()
        category_code = str(self.category_code or '').strip().upper()
        if source_kind != 'CATEGORY':
            raise ValidationError({'source_kind': "Only CATEGORY mappings are supported."})
        if self.material_id:
            raise ValidationError({'material': "Category mapping cannot include exact material."})
        if not category_code:
            raise ValidationError({'category_code': "category_code is required for category mapping."})
        self.source_kind = 'CATEGORY'
        self.category_code = category_code
        self.consumption_basis = self._normalized_consumption_basis()
        if self.category_code == "ADDON" and self.consumption_basis != "CATEGORY_FORMULA":
            raise ValidationError({'consumption_basis': "ADDON category must use CATEGORY_FORMULA basis."})
        if self.category_code == "POD" and self.consumption_basis != "CATEGORY_FORMULA":
            raise ValidationError({'consumption_basis': "POD category must use CATEGORY_FORMULA basis."})
        self.formula_driver = str(self.formula_driver or "NONE").upper()
        self.formula_params = self.formula_params if isinstance(self.formula_params, dict) else {}
        if self.consumption_basis == "CATEGORY_FORMULA":
            if self.formula_driver == "NONE" and self.category_code == "ADDON":
                self.formula_driver = "ADDON_MASTER_WEIGHT_MODE"
            if self.formula_driver == "NONE" and self.category_code == "POD":
                self.formula_driver = "POD_MASTER_PROFILE"
            if self.category_code == "ADDON" and self.formula_driver != "ADDON_MASTER_WEIGHT_MODE":
                raise ValidationError({'formula_driver': "ADDON formula basis requires ADDON_MASTER_WEIGHT_MODE."})
            if self.category_code == "POD" and self.formula_driver != "POD_MASTER_PROFILE":
                raise ValidationError({'formula_driver': "POD formula basis requires POD_MASTER_PROFILE."})
        else:
            self.formula_driver = "NONE"
            self.formula_params = {}
        if str(self.issue_policy_mode or 'NONE').upper() not in {choice for choice, _label in self.ISSUE_POLICY_MODE_CHOICES}:
            raise ValidationError({'issue_policy_mode': "Unsupported issue_policy_mode."})
        if self.issue_policy_value is None:
            self.issue_policy_value = 0
        if str(self.capture_mode or 'AUTO_FROM_OUTPUT').upper() not in {choice for choice, _label in self.CAPTURE_MODE_CHOICES}:
            raise ValidationError({'capture_mode': "Unsupported capture_mode."})

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)
