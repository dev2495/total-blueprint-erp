from django.db import models
from django.core.exceptions import ValidationError
import uuid
from decimal import Decimal


class CommercialFamily(models.Model):
    FORM_CHOICES = [
        ("ROLL", "Roll"),
        ("POUCH", "Pouch"),
    ]

    REPORTING_GROUP_CHOICES = [
        ("FILM", "Film"),
        ("PRINTED", "Printed"),
        ("LAMINATED", "Laminated"),
        ("SEMI_FG", "Semi-Finished"),
        ("FG", "Finished Goods"),
        ("PACKAGING", "Packaging"),
        ("OTHER", "Other"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=50, unique=True, db_index=True)
    name = models.CharField(max_length=120)
    default_form = models.CharField(max_length=10, choices=FORM_CHOICES, default="ROLL")
    default_reporting_group = models.CharField(max_length=20, choices=REPORTING_GROUP_CHOICES, default="FILM")
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "commercial_families"
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({self.code})"

class InventoryMaterial(models.Model):
    """
    Consolidated Master for all physical materials.
    Atomic Truth: ONE table, behavior by category.
    """
    CATEGORY_CHOICES = [
        ('FILM_FAMILY', 'Film Family'),
        ('FILM_VARIANT', 'Film Variant'),
        ('GRANULE', 'Granule'),
        ('INK', 'Ink'),
        ('SOLVENT', 'Solvent'),
        ('ADHESIVE', 'Adhesive'),
        ('PACKAGING', 'Packaging'),
        ('ADDON', 'Add-On'),
        ('POD', 'POD Film'),
    ]
    
    UNIT_CHOICES = [
        ('KG', 'Kilograms (KG)'),
        ('PCS', 'Pieces (PCS)'),
        ('METER', 'Meters (M)'),
    ]

    # Addon Weight Modes
    WEIGHT_MODE_CHOICES = [
        ('PER_MM', 'Per MM'),
        ('PER_PIECE', 'Per Piece'),
        ('FIXED', 'Fixed Weight'),
    ]

    PACKAGING_KIND_CHOICES = [
        ('INNER_POUCH', 'Inner Pouch'),
        ('GONNY', 'Gonny'),
        ('TAPE', 'Tape'),
        ('SHEET', 'Sheet'),
        ('FILM', 'Film'),
        ('BOX', 'Box'),
        ('LABEL', 'Label'),
        ('TAG', 'Tag'),
        ('OTHER', 'Other'),
    ]

    PACKAGING_SUPPLY_MODE_CHOICES = [
        ('PURCHASED', 'Purchased'),
        ('IN_HOUSE', 'In House'),
        ('BOTH', 'Both'),
    ]

    POD_TYPE_CHOICES = [
        ('SINGLE', 'Single POD'),
        ('DOUBLE', 'Double POD'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=100, unique=True, db_index=True)
    name = models.CharField(max_length=255, blank=True)
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, db_index=True)
    base_uom = models.CharField(max_length=10, choices=UNIT_CHOICES, default='KG')
    commercial_family = models.ForeignKey(
        CommercialFamily,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='materials',
        help_text="Controlled business-facing family alias used for naming, stock grouping, and reporting.",
    )

    # Film Specific
    density_gcm3 = models.DecimalField(max_digits=6, decimal_places=4, null=True, blank=True, help_text="Density in g/cm3 - Mandatory for FILM_FAMILY")
    parent_family = models.ForeignKey(
        'self', 
        on_delete=models.PROTECT, 
        null=True, 
        blank=True, 
        related_name='variants', 
        limit_choices_to={'category': 'FILM_FAMILY'},
        help_text="Mandatory for FILM_VARIANT"
    )
    grade = models.ForeignKey(
        'recipes.RecipeGrade', 
        on_delete=models.PROTECT, 
        null=True, 
        blank=True, 
        related_name='materials',
        help_text="Mandatory for FILM_VARIANT"
    )
    is_extrudable = models.BooleanField(default=False, help_text="TRUE enables recipe engineering for this variant")
    is_purchasable = models.BooleanField(default=True, help_text="TRUE if this material can be purchased directly")

    # Addon Specific
    weight_mode = models.CharField(max_length=20, choices=WEIGHT_MODE_CHOICES, null=True, blank=True)
    weight_value = models.FloatField(null=True, blank=True, help_text="Formula input value (g) based on weight_mode")

    # Packaging Specific
    packaging_kind = models.CharField(
        max_length=20,
        choices=PACKAGING_KIND_CHOICES,
        null=True,
        blank=True,
    )
    packaging_supply_mode = models.CharField(
        max_length=20,
        choices=PACKAGING_SUPPLY_MODE_CHOICES,
        null=True,
        blank=True,
    )
    production_template = models.ForeignKey(
        "templates.TemplateBlueprint",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="packaging_materials",
        help_text="Linked in-house template/blueprint used when this packaging SKU is manufactured as PACKAGING_STOCK.",
    )
    packaging_defaults_json = models.JSONField(
        default=dict,
        blank=True,
        help_text="Optional branded packaging defaults and tare settings used by packing-yard flows.",
    )
    tare_weight_kg = models.DecimalField(
        max_digits=10,
        decimal_places=4,
        null=True,
        blank=True,
        help_text="Default tare weight per packaging unit used for packing and dispatch gross-weight math.",
    )
    per_sheet_base_qty = models.DecimalField(
        max_digits=12,
        decimal_places=6,
        null=True,
        blank=True,
        help_text="Base-UOM qty represented by one sheet (used when a sheet line is entered in PCS).",
    )

    # POD profile (formula-driven, master-authoritative)
    pod_type = models.CharField(max_length=20, choices=POD_TYPE_CHOICES, null=True, blank=True)
    pod_fixed_height_mm = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    pod_thickness_micron = models.DecimalField(max_digits=10, decimal_places=3, null=True, blank=True)
    pod_panel_count = models.PositiveIntegerField(null=True, blank=True)
    pod_is_inhouse_produced = models.BooleanField(default=False)

    status = models.CharField(max_length=10, default='ACTIVE', choices=[('ACTIVE', 'Active'), ('INACTIVE', 'Inactive')])
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'inventory_materials'
        verbose_name = "Material Master"
        verbose_name_plural = "Material Master"

    def __str__(self):
        return f"[{self.code}] {self.name}"

    def clean(self):
        # 1. FILM_FAMILY Density Validation
        if self.category == 'FILM_FAMILY' and self.density_gcm3 is None:
            raise ValidationError({'density_gcm3': "Film Family must have a density (g/cm³)."})
        
        # 2. FILM_VARIANT Parent Validation
        if self.category == 'FILM_VARIANT' and not self.parent_family:
            raise ValidationError({'parent_family': "Film Variant must belong to a parent family."})
        
        # 3. ADDON Validation
        if self.category == 'ADDON':
            if not self.weight_mode:
                raise ValidationError({'weight_mode': "Addon must have a weight mode (PER_MM, PER_PIECE, FIXED)."})
            if self.weight_value is None:
                raise ValidationError({'weight_value': "Addon must have a weight value (float)."})

        # 4. Packaging Validation
        if self.category == 'PACKAGING':
            if not self.packaging_kind:
                raise ValidationError({'packaging_kind': "Packaging material must have a packaging kind."})
            if not self.packaging_supply_mode:
                raise ValidationError({'packaging_supply_mode': "Packaging material must have a packaging supply mode."})
            in_house_kinds = {"INNER_POUCH", "SHEET", "FILM"}
            if self.packaging_supply_mode in {"IN_HOUSE", "BOTH"}:
                if self.packaging_kind not in in_house_kinds:
                    raise ValidationError(
                        {"packaging_supply_mode": f"{self.packaging_kind} cannot be produced in house in this phase."}
                    )
                if not self.production_template:
                    raise ValidationError(
                        {"production_template": "In-house packaging materials must be linked to a production template."}
                    )
        else:
            invalid_fields = {}
            if self.packaging_kind:
                invalid_fields['packaging_kind'] = "packaging_kind must be null for non-PACKAGING materials."
            if self.packaging_supply_mode:
                invalid_fields['packaging_supply_mode'] = "packaging_supply_mode must be null for non-PACKAGING materials."
            if self.production_template_id:
                invalid_fields['production_template'] = "production_template must be null for non-PACKAGING materials."
            if self.packaging_defaults_json:
                invalid_fields['packaging_defaults_json'] = "packaging_defaults_json must be empty for non-PACKAGING materials."
            if self.tare_weight_kg is not None:
                invalid_fields['tare_weight_kg'] = "tare_weight_kg must be null for non-PACKAGING materials."
            if self.per_sheet_base_qty is not None:
                invalid_fields['per_sheet_base_qty'] = "per_sheet_base_qty must be null for non-PACKAGING materials."
            if invalid_fields:
                raise ValidationError(invalid_fields)

        # 5. POD validation
        if self.category == 'POD':
            pod_errors = {}
            if not self.pod_type:
                pod_errors['pod_type'] = "POD material must define pod_type."
            if self.pod_fixed_height_mm is None or Decimal(str(self.pod_fixed_height_mm or 0)) <= 0:
                pod_errors['pod_fixed_height_mm'] = "POD material must define fixed height (mm) > 0."
            if self.pod_thickness_micron is None or Decimal(str(self.pod_thickness_micron or 0)) <= 0:
                pod_errors['pod_thickness_micron'] = "POD material must define thickness (micron) > 0."
            if self.density_gcm3 is None or Decimal(str(self.density_gcm3 or 0)) <= 0:
                pod_errors['density_gcm3'] = "POD material must define density (g/cm³) > 0."
            if self.pod_panel_count is None or int(self.pod_panel_count or 0) <= 0:
                pod_errors['pod_panel_count'] = "POD material must define panel_count > 0."
            if self.base_uom != 'KG':
                pod_errors['base_uom'] = "POD material base_uom must be KG."
            if pod_errors:
                raise ValidationError(pod_errors)
        else:
            invalid_pod = {}
            if self.pod_type:
                invalid_pod['pod_type'] = "pod_type must be null for non-POD materials."
            if self.pod_fixed_height_mm is not None:
                invalid_pod['pod_fixed_height_mm'] = "pod_fixed_height_mm must be null for non-POD materials."
            if self.pod_thickness_micron is not None:
                invalid_pod['pod_thickness_micron'] = "pod_thickness_micron must be null for non-POD materials."
            if self.pod_panel_count is not None:
                invalid_pod['pod_panel_count'] = "pod_panel_count must be null for non-POD materials."
            if self.pod_is_inhouse_produced:
                invalid_pod['pod_is_inhouse_produced'] = "pod_is_inhouse_produced must be false for non-POD materials."
            if invalid_pod:
                raise ValidationError(invalid_pod)


class GranuleQualityCode(models.Model):
    """
    Quality code registry for a granule master.
    The physical material remains the same granule; this code adds a reporting
    and issue-control layer for inward, WCM issue, and consumption analytics.
    Vendors stay transaction-level metadata on GRN, not an owner of the code.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    granule = models.ForeignKey(
        InventoryMaterial,
        on_delete=models.CASCADE,
        related_name="quality_codes",
        limit_choices_to={"category": "GRANULE"},
    )
    code = models.CharField(max_length=80, db_index=True)
    status = models.CharField(max_length=10, default="ACTIVE", choices=[("ACTIVE", "Active"), ("INACTIVE", "Inactive")])
    notes = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "material_granule_quality_codes"
        ordering = ["granule__name", "code"]
        constraints = [
            models.UniqueConstraint(fields=["granule", "code"], name="uniq_granule_quality_code"),
        ]

    def clean(self):
        if self.granule_id and str(getattr(self.granule, "category", "") or "").upper() != "GRANULE":
            raise ValidationError({"granule": "Quality codes can only be attached to GRANULE materials."})

    def save(self, *args, **kwargs):
        self.code = str(self.code or "").strip().upper()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.granule.name} / {self.code}"


class PodSku(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=80, unique=True, db_index=True)
    name = models.CharField(max_length=255)
    family = models.CharField(max_length=120, blank=True, default="")
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "pod_skus"
        ordering = ["name", "code"]

    def __str__(self):
        return f"{self.code} - {self.name}"


class PodSkuVariant(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    pod_sku = models.ForeignKey(PodSku, on_delete=models.CASCADE, related_name="variants")
    material = models.ForeignKey(
        InventoryMaterial,
        on_delete=models.PROTECT,
        related_name="pod_sku_variants",
        limit_choices_to={"category": "POD"},
    )
    code = models.CharField(max_length=80)
    name = models.CharField(max_length=255)
    active = models.BooleanField(default=True)
    production_defaults_json = models.JSONField(default=dict, blank=True)
    reporting_attributes_json = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "pod_sku_variants"
        ordering = ["pod_sku__name", "name", "code"]
        constraints = [
            models.UniqueConstraint(fields=["pod_sku", "code"], name="pod_sku_variant_code_unique_per_sku"),
        ]

    def clean(self):
        errors = {}
        if self.material_id and str(getattr(self.material, "category", "") or "").upper() != "POD":
            errors["material"] = "POD SKU variants must link to a POD material."
        if self.material_id and str(getattr(self.material, "status", "") or "").upper() != "ACTIVE":
            errors["material"] = "POD SKU variants must link to an ACTIVE POD material."
        if errors:
            raise ValidationError(errors)

    def __str__(self):
        return f"{self.pod_sku.code} - {self.code}"

class ConsumableMaterial(models.Model):
    """
    Phase 67.2: Unified Bulk Consumption Engine.
    Represents a specific consumable resource linked to a master material.
    Allows defining density/usage properties for materials that might not have them in the core master.
    """
    CATEGORY_CHOICES = [
        ('INK', 'Ink'),
        ('ADHESIVE', 'Adhesive'),
        ('SOLVENT', 'Solvent'),
        ('GRANULE', 'Granule'),
        ('POD', 'POD Material'),
        ('ADDON', 'Add-on'),
        ('CHEMICAL', 'Chemical'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, db_index=True)
    unit = models.CharField(max_length=10, default='KG')
    
    # Optional physics properties overriding master
    density_gcm3 = models.DecimalField(max_digits=6, decimal_places=4, null=True, blank=True)
    gsm = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True, help_text="Common for Inks/Adhesives")
    
    # Link to Inventory Master
    # This allows us to deduct from the actual inventory stock
    master_material = models.ForeignKey(
        'InventoryMaterial',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='consumable_configurations'
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'materials_consumables'
        verbose_name = "Consumable Material"
        verbose_name_plural = "Consumable Materials"

    def __str__(self):
        return f"{self.name} ({self.get_category_display()})"
