from django.db import models
from decimal import Decimal
import uuid
from apps.materials.models import InventoryMaterial
from django.db.models import UniqueConstraint

class Vendor(models.Model):
    """
    Vendor Master (Phase 19).
    Suppliers, Job Workers, Service Providers.
    """
    TYPE_CHOICES = [
        ('RM', 'Raw Material Supplier'),
        ('JOBWORK', 'Job Worker'),
        ('SERVICE', 'Service Provider'),
        ('BOTH', 'Both (Supplier & JW)'),
    ]
    
    STATUS_CHOICES = [
        ('ACTIVE', 'Active'),
        ('INACTIVE', 'Inactive'),
        ('BLACKLISTED', 'Blacklisted'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=50, unique=True)
    type = models.CharField(max_length=20, choices=TYPE_CHOICES, default='RM')
    
    under_group = models.CharField(max_length=255, blank=True, default="")
    gst_no = models.CharField(max_length=20, blank=True)
    pan_no = models.CharField(max_length=20, blank=True, default="")
    phone_number = models.CharField(max_length=30, blank=True, default="")
    email = models.EmailField(blank=True, default="")
    contact_person = models.CharField(max_length=255, blank=True, default="")
    address = models.TextField(blank=True)
    mailing_name = models.CharField(max_length=255, blank=True, default="")
    mailing_state = models.CharField(max_length=100, blank=True, default="")
    mailing_country = models.CharField(max_length=100, blank=True, default="")
    mailing_pincode = models.CharField(max_length=20, blank=True, default="")
    additional_addresses = models.JSONField(default=list, blank=True)
    
    payment_terms = models.CharField(max_length=100, blank=True, help_text="e.g. Net 30")
    credit_days = models.PositiveIntegerField(default=0)
    interest_calculation = models.CharField(max_length=255, blank=True, default="")
    bank_details = models.TextField(blank=True, default="")
    contact_details = models.TextField(blank=True, default="")
    tds_deductable = models.BooleanField(default=False)
    tcs_deductable = models.BooleanField(default=False)
    lead_time_days = models.IntegerField(default=0)
    jobwork_capabilities = models.JSONField(
        default=list,
        blank=True,
        help_text="Compatible process codes for jobwork (e.g. ['PRINTING','LAMINATION']). Empty means generic jobwork-capable.",
    )
    jobwork_plants = models.JSONField(
        default=list,
        blank=True,
        help_text="Plant IDs or codes this vendor serves for jobwork. Empty means all plants.",
    )
    turnaround_hours = models.PositiveIntegerField(default=48)
    qc_required = models.BooleanField(default=True)
    
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='ACTIVE')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.name} ({self.code})"

    class Meta:
        db_table = 'inventory_vendors'
        ordering = ['name']

class InkMaterial(InventoryMaterial):
    """
    Specialized Material for Inks (Phase 50).
    Tracks Poly/PET base and specific color names.
    """
    BASE_TYPE_CHOICES = [
        ("POLY", "POLY"),
        ("PET", "PET"),
    ]
    
    base_type = models.CharField(max_length=10, choices=BASE_TYPE_CHOICES)
    color_name = models.CharField(max_length=50) # RED, BLUE, CYAN, etc.

    class Meta:
        db_table = 'inventory_ink_materials'
        constraints = [
            UniqueConstraint(fields=['base_type', 'color_name'], name='unique_ink_per_base')
        ]

    def __str__(self):
        return f"INK-{self.base_type}-{self.color_name}"

    def save(self, *args, **kwargs):
        self.category = 'INK'
        if not self.code:
            self.code = f"INK-{self.base_type}-{self.color_name.upper()}"
        if not self.name:
            self.name = f"{self.base_type} {self.color_name.upper()}"
        super().save(*args, **kwargs)

class InventoryLocation(models.Model):


    # System & Policy Location Codes (Phase 13)
    # WIP: Work In Progress, FG: Finished Goods, SCRAP: Scrap Yard
    # JOBWORK_OUT: Virtual Job Work, IN_TRANSIT: Inter-Plant Transit
    
    TYPE_CHOICES = [
        ('WAREHOUSE', 'Warehouse'),
        ('RM', 'Raw Materials'),
        ('QC', 'Quality Control'),
        ('WIP', 'Work In Progress Area'),
        ('FG', 'Finished Goods Area'),
        ('SCRAP', 'Scrap Area'),
        ('JOBWORK', 'Job Work Zone'),
        ('TRANSIT', 'Transit Zone'),
        ('DISPATCH', 'Dispatch Area'),
        ('TOOLING', 'Tool Room'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plant = models.ForeignKey('factory.Plant', on_delete=models.CASCADE, related_name='locations')
    
    code = models.CharField(max_length=50)
    name = models.CharField(max_length=100)
    type = models.CharField(max_length=20, choices=TYPE_CHOICES, default='WAREHOUSE')
    
    is_system = models.BooleanField(default=False, help_text="System locations cannot be deleted")
    is_active = models.BooleanField(default=True)
    
    def __str__(self):
        return f"{self.name} ({self.plant.code})"

    class Meta:
        db_table = 'inventory_locations'
        unique_together = ['plant', 'code', 'name']

class InventoryRoll(models.Model):
    """
    The Physical Currency of the Factory.
    Everything flows as a Roll (except Granules/Chemicals which are Bulk).
    
    Phase 54: Enhanced with full genealogy tracking.
    - Rolls are physical assets like pallets/drums/coils
    - Never update weight directly, always SPLIT/CREATE/CONSUME
    - Full traceability: origin, consumption, scrap, balance, location
    """
    STATUS_CHOICES = [
        ('AVAILABLE', 'Available'),
        ('RESERVED', 'Reserved'),          # Phase 54: Reserved for a job
        ('IN_PROCESS', 'In Process'),      # Phase 54: Currently being processed
        ('SENT_JOBWORK', 'Sent to Job Work'),
        ('CONSUMED', 'Consumed'),
        ('MISSING', 'Missing after Stock Count'),
        ('SCRAPPED', 'Scrapped'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    label_id = models.CharField(max_length=50, unique=True, help_text="Human Readable Barcode ID (e.g., ROLL-20260131-00123)")
    
    # Phase 56: Master Reference (Variant = logical, physical specs on Roll)
    material = models.ForeignKey(InventoryMaterial, on_delete=models.PROTECT, null=True, blank=True, related_name='inventory_rolls', help_text="Film Variant (logical)")
    batch_no = models.CharField(max_length=100, blank=True)
    
    # Phase 56: Physical Specs (live ONLY on Roll)
    thickness_micron = models.DecimalField(max_digits=10, decimal_places=2, default=0, help_text="Thickness in microns")
    width_mm = models.DecimalField(max_digits=10, decimal_places=2)
    density_gcm3 = models.DecimalField(
        max_digits=10,
        decimal_places=4,
        null=True,
        blank=True,
        default=None,
        help_text="Density snapshot for stable derived area/length previews",
    )
    grade = models.ForeignKey('recipes.RecipeGrade', on_delete=models.SET_NULL, null=True, blank=True, related_name='inventory_rolls', help_text="Recipe Grade (for extrusion tracking)")
    
    # Phase 56: Plant reference (direct)
    plant = models.ForeignKey('factory.Plant', on_delete=models.PROTECT, null=True, blank=True, related_name='inventory_rolls')
    length_m = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    
    # Phase 54: Weight tracking (immutable original + mutable current)
    original_weight_kg = models.DecimalField(max_digits=10, decimal_places=3, default=0, help_text="Initial weight at creation (immutable)")
    weight_kg = models.DecimalField(max_digits=10, decimal_places=3, default=0, help_text="Current weight in KG")
    net_weight_kg = models.DecimalField(max_digits=10, decimal_places=3, null=True, blank=True, help_text="Product-only roll weight excluding core and packing tare. Falls back to weight_kg when not separately captured.")
    tare_weight_kg = models.DecimalField(max_digits=10, decimal_places=3, default=0, help_text="Core / sleeve / roll packing tare weight.")
    gross_weight_kg = models.DecimalField(max_digits=10, decimal_places=3, null=True, blank=True, help_text="Scale gross roll weight including core and packing tare.")
    
    location = models.ForeignKey(InventoryLocation, on_delete=models.PROTECT)
    
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='AVAILABLE')
    
    # Phase 54: Genealogy (supports multi-parent merge via RollLink)
    parent_rolls = models.ManyToManyField('self', symmetrical=False, through='RollLink', related_name='child_rolls')
    # Keep legacy field for backward compatibility
    parent_roll = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True, related_name='children')
    
    # Phase 54: Production Tracking
    stage_index = models.IntegerField(default=0, help_text="Current production stage (0=RM, 1=Extruded, 2=Printed, etc.)")
    created_by_job = models.ForeignKey('production.ProductionJob', on_delete=models.SET_NULL, null=True, blank=True, related_name='created_rolls', help_text="Job that created this roll")
    created_process = models.ForeignKey('factory.Process', on_delete=models.SET_NULL, null=True, blank=True, related_name='created_rolls', help_text="Process that created this roll")
    
    # FG Tracking
    is_fg = models.BooleanField(default=False, help_text="True if this roll is a Finished Good")
    template = models.ForeignKey('templates.TemplateBlueprint', on_delete=models.SET_NULL, null=True, blank=True, related_name='inventory_rolls')
    current_step_index = models.IntegerField(default=0, help_text="Current routing step this roll has completed")
    completed_step_index = models.IntegerField(default=0, help_text="Canonical completed route step index")
    geometry_override = models.JSONField(default=dict, blank=True)
    
    # Legacy production job FK (kept for existing output_rolls relation)
    production_job = models.ForeignKey('production.ProductionJob', on_delete=models.PROTECT, related_name='output_rolls', null=True, blank=True)
    sales_order_item = models.ForeignKey('sales.SalesOrderItem', on_delete=models.PROTECT, related_name='inventory_rolls', db_index=True, null=True, blank=True)
    
    # Phase 54: Extensible metadata
    meta_json = models.JSONField(default=dict, blank=True, help_text="Extensible metadata (e.g., quality notes, vendor info)")
    
    created_at = models.DateTimeField(auto_now_add=True)
    
    def __str__(self):
        return f"{self.label_id} ({self.material.code}) | {self.weight_kg}kg"
    
    def save(self, *args, **kwargs):
        if self.material_id and self.density_gcm3 in (None, ""):
            family = getattr(getattr(self.material, "parent_family", None), "density_gcm3", None)
            material_density = getattr(self.material, "density_gcm3", None)
            density_source = family if family not in (None, "") else material_density
            if density_source not in (None, ""):
                try:
                    self.density_gcm3 = Decimal(str(density_source))
                except Exception:
                    self.density_gcm3 = None

        grade_required = bool(
            self.material_id
            and getattr(self.material, "category", None) == "FILM_VARIANT"
            and getattr(self.material, "is_extrudable", False)
        )
        if not grade_required and self.grade_id:
            self.grade_id = None

        # Set original_weight_kg on first save if not set
        if not self.pk:
            # Enforce mandatory physical specs on creation
            if not self.material_id:
                raise ValueError("Roll material is required.")
            if Decimal(str(self.thickness_micron or 0)) <= 0:
                raise ValueError("Roll thickness must be > 0.")
            if Decimal(str(self.width_mm or 0)) <= 0:
                raise ValueError("Roll width must be > 0.")
            if grade_required and not self.grade_id:
                raise ValueError("Roll grade is required for extrudable variants.")
            if Decimal(str(self.weight_kg or 0)) <= 0:
                raise ValueError("Roll weight must be > 0.")
            if not self.location_id:
                raise ValueError("Roll location is required.")
            if not self.status:
                raise ValueError("Roll status is required.")

            if not self.original_weight_kg:
                self.original_weight_kg = self.weight_kg
        super().save(*args, **kwargs)

    class Meta:
        db_table = 'inventory_rolls'
        indexes = [
            models.Index(fields=['status']),
            models.Index(fields=['stage_index']),
            models.Index(fields=['location']),
            models.Index(fields=['completed_step_index']),
        ]


class InventoryBulk(models.Model):
    """
    Pooled quantity tracking for Bulk Materials (Granules, Ink, Chemicals).
    Phase 56: Follows Master-First Rule (Quantity only, no specs).
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    material = models.ForeignKey(InventoryMaterial, on_delete=models.PROTECT, related_name='bulk_stock')
    granule_code = models.ForeignKey(
        'materials.GranuleQualityCode',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='bulk_stock',
        help_text='Optional vendor quality code used only for granule stock reporting and issue control.',
    )
    plant = models.ForeignKey('factory.Plant', on_delete=models.CASCADE, related_name='bulk_inventory')
    location = models.ForeignKey(InventoryLocation, on_delete=models.PROTECT, related_name='bulk_inventory')

    qty_kg = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    avg_cost = models.DecimalField(max_digits=12, decimal_places=4, default=0)

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'inventory_bulk'
        constraints = [
            UniqueConstraint(
                fields=['material', 'granule_code', 'plant', 'location'],
                name='uniq_bulk_material_code_plant_location',
                nulls_distinct=False,
            ),
        ]

    def __str__(self):
        code = f" / {self.granule_code.code}" if self.granule_code_id else ""
        return f"{self.material.name}{code} @ {self.location.name}: {self.qty_kg}kg"

class BulkTransaction(models.Model):
    """
    Audit trail for all bulk movements.
    """
    TYPE_CHOICES = [
        ('INWARD', 'Inward (GRN)'),
        ('PRODUCE', 'In-House Production'),
        ('CONSUME', 'Production Consumption'),
        ('TRANSFER', 'Location Transfer'),
        ('ADJUST', 'Manual Adjustment'),
        ('OPENING_BALANCE', 'Opening Balance'),
        ('OPENING_BALANCE_ADJUST', 'Opening Balance Adjustment'),
        ('COUNT_SHORT', 'Physical Count Short'),
        ('COUNT_EXCESS', 'Physical Count Excess'),
        ('FY_ROLLFORWARD', 'FY Roll Forward'),
        ('FY_CORRECTION', 'FY Correction'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    material = models.ForeignKey(InventoryMaterial, on_delete=models.PROTECT, related_name='bulk_transactions')
    granule_code = models.ForeignKey(
        'materials.GranuleQualityCode',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='bulk_transactions',
    )
    location = models.ForeignKey(InventoryLocation, on_delete=models.PROTECT, related_name='bulk_transactions')

    type = models.CharField(max_length=30, choices=TYPE_CHOICES)
    qty_kg = models.DecimalField(max_digits=15, decimal_places=4)
    avg_cost = models.DecimalField(max_digits=12, decimal_places=4, null=True, blank=True)
    
    reference = models.CharField(max_length=255, null=True, blank=True)
    job = models.ForeignKey('production.ProductionJob', on_delete=models.SET_NULL, null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'inventory_bulk_transactions'
        ordering = ['-created_at']


class PackagingStock(models.Model):
    """
    Pooled quantity tracking for Packaging Materials.
    Quantity unit is always the material's base_uom (PCS/KG/METER).
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    material = models.ForeignKey(InventoryMaterial, on_delete=models.PROTECT, related_name='packaging_stock')
    plant = models.ForeignKey('factory.Plant', on_delete=models.CASCADE, related_name='packaging_inventory')
    location = models.ForeignKey(InventoryLocation, on_delete=models.PROTECT, related_name='packaging_inventory')
    qty = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    avg_cost = models.DecimalField(max_digits=12, decimal_places=4, default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'inventory_packaging_stock'
        unique_together = ('material', 'plant', 'location')

    def __str__(self):
        return f"{self.material.code} @ {self.location.name}: {self.qty} {self.material.base_uom}"


class PackagingTransaction(models.Model):
    TYPE_CHOICES = [
        ('INWARD', 'Inward (GRN)'),
        ('CONSUME', 'Consumption'),
        ('TRANSFER', 'Location Transfer'),
        ('ADJUST', 'Manual Adjustment'),
        ('PRODUCE', 'In-House Production'),
        ('OPENING_BALANCE', 'Opening Balance'),
        ('OPENING_BALANCE_ADJUST', 'Opening Balance Adjustment'),
        ('COUNT_SHORT', 'Physical Count Short'),
        ('COUNT_EXCESS', 'Physical Count Excess'),
        ('FY_ROLLFORWARD', 'FY Roll Forward'),
        ('FY_CORRECTION', 'FY Correction'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    type = models.CharField(max_length=30, choices=TYPE_CHOICES)
    material = models.ForeignKey(InventoryMaterial, on_delete=models.PROTECT, related_name='packaging_transactions')
    location = models.ForeignKey(InventoryLocation, on_delete=models.PROTECT, related_name='packaging_transactions')
    qty = models.DecimalField(max_digits=15, decimal_places=4, help_text="Signed quantity in material.base_uom")
    avg_cost = models.DecimalField(max_digits=12, decimal_places=4, null=True, blank=True)
    vendor = models.ForeignKey('Vendor', on_delete=models.SET_NULL, null=True, blank=True, related_name='packaging_transactions')
    job = models.ForeignKey('production.ProductionJob', on_delete=models.SET_NULL, null=True, blank=True, related_name='packaging_transactions')
    sales_order_item = models.ForeignKey('sales.SalesOrderItem', on_delete=models.SET_NULL, null=True, blank=True, related_name='packaging_transactions')
    mts_order = models.ForeignKey('production.PlannedStockOrder', on_delete=models.SET_NULL, null=True, blank=True, related_name='packaging_transactions')
    reference = models.CharField(max_length=255, null=True, blank=True)
    meta_json = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'inventory_packaging_transactions'
        ordering = ['-created_at']


class InventoryCorrectionAudit(models.Model):
    """
    Business audit trail for inventory corrections.

    Original inward rows stay immutable; this record captures the user's
    reason and the before/after payload used to post compensating entries.
    """
    SOURCE_CHOICES = [
        ("BULK", "Bulk GRN"),
        ("PACKAGING", "Packaging GRN"),
        ("ROLL", "Roll GRN"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    source_type = models.CharField(max_length=20, choices=SOURCE_CHOICES)
    source_id = models.UUIDField(db_index=True)
    correction_type = models.CharField(max_length=40, default="GRN_CORRECTION")
    reason = models.TextField()
    before_json = models.JSONField(default=dict, blank=True)
    after_json = models.JSONField(default=dict, blank=True)
    delta_json = models.JSONField(default=dict, blank=True)
    actor = models.ForeignKey("users.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="inventory_corrections")
    effective_role = models.CharField(max_length=50, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "inventory_correction_audit"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["source_type", "source_id"]),
            models.Index(fields=["created_at"]),
        ]


class InventoryAuditBatch(models.Model):
    TYPE_CHOICES = [
        ("OPENING_STOCK", "Opening Stock"),
        ("PHYSICAL_COUNT", "Physical Count"),
        ("FY_CLOSE", "Financial Year Close"),
        ("FY_CORRECTION", "Financial Year Correction"),
    ]
    STATUS_CHOICES = [
        ("DRAFT", "Draft"),
        ("SUBMITTED", "Submitted for Approval"),
        ("APPROVED", "Approved"),
        ("POSTED", "Posted"),
        ("LOCKED", "Locked"),
        ("CANCELLED", "Cancelled"),
        ("VOID", "Void"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch_no = models.CharField(max_length=60, unique=True, blank=True)
    type = models.CharField(max_length=30, choices=TYPE_CHOICES)
    plant = models.ForeignKey("factory.Plant", on_delete=models.PROTECT, related_name="inventory_audit_batches")
    financial_year = models.CharField(max_length=20, db_index=True)
    cutoff_at = models.DateTimeField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="DRAFT", db_index=True)
    posted_by = models.ForeignKey("users.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="posted_inventory_audit_batches")
    posted_at = models.DateTimeField(null=True, blank=True)
    locked_by = models.ForeignKey("users.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="locked_inventory_audit_batches")
    locked_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)
    source_file_name = models.CharField(max_length=255, blank=True)
    summary_json = models.JSONField(default=dict, blank=True)
    created_by = models.ForeignKey("users.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="created_inventory_audit_batches")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "inventory_audit_batches"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["type", "status"]),
            models.Index(fields=["financial_year", "plant"]),
            models.Index(fields=["cutoff_at"]),
        ]

    def save(self, *args, **kwargs):
        if not self.batch_no:
            prefix = {
                "OPENING_STOCK": "OPEN",
                "PHYSICAL_COUNT": "COUNT",
                "FY_CLOSE": "FYC",
                "FY_CORRECTION": "FYCOR",
            }.get(self.type, "AUD")
            self.batch_no = f"{prefix}-{self.financial_year}-{str(uuid.uuid4())[:8].upper()}"
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.batch_no} [{self.status}]"


class InventoryAuditLine(models.Model):
    STOCK_CLASS_CHOICES = [
        ("BULK", "Bulk"),
        ("ROLL", "Roll"),
        ("PACKAGING", "Packaging"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch = models.ForeignKey(InventoryAuditBatch, on_delete=models.CASCADE, related_name="lines")
    stock_class = models.CharField(max_length=20, choices=STOCK_CLASS_CHOICES)
    material = models.ForeignKey(InventoryMaterial, on_delete=models.PROTECT, related_name="inventory_audit_lines")
    granule_code = models.ForeignKey("materials.GranuleQualityCode", on_delete=models.PROTECT, null=True, blank=True, related_name="inventory_audit_lines")
    grade = models.ForeignKey("recipes.RecipeGrade", on_delete=models.PROTECT, null=True, blank=True, related_name="inventory_audit_lines")
    plant = models.ForeignKey("factory.Plant", on_delete=models.PROTECT, related_name="inventory_audit_lines")
    location = models.ForeignKey(InventoryLocation, on_delete=models.PROTECT, related_name="inventory_audit_lines")
    uom = models.CharField(max_length=20, blank=True, default="KG")
    system_qty = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    counted_qty = models.DecimalField(max_digits=15, decimal_places=4, null=True, blank=True)
    variance_qty = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    opening_qty = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    rate = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    value = models.DecimalField(max_digits=16, decimal_places=4, default=0)

    label_id = models.CharField(max_length=80, blank=True)
    batch_no = models.CharField(max_length=100, blank=True)
    width_mm = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    thickness_micron = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    length_m = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    is_fg = models.BooleanField(default=False)
    stage_index = models.IntegerField(default=0)
    status = models.CharField(max_length=20, blank=True, default="AVAILABLE")

    packaging_kind = models.CharField(max_length=20, blank=True)
    base_uom = models.CharField(max_length=20, blank=True)
    posted_reference_json = models.JSONField(default=dict, blank=True)
    row_errors = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "inventory_audit_lines"
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["stock_class", "material"]),
            models.Index(fields=["plant", "location"]),
            models.Index(fields=["label_id"]),
        ]

    def save(self, *args, **kwargs):
        qty_basis = self.opening_qty
        if self.batch_id and self.batch.type in {"PHYSICAL_COUNT", "FY_CORRECTION"}:
            counted = self.counted_qty if self.counted_qty is not None else 0
            self.variance_qty = Decimal(str(counted or 0)) - Decimal(str(self.system_qty or 0))
            qty_basis = abs(self.variance_qty)
        elif self.batch_id and self.batch.type == "FY_CLOSE":
            qty_basis = self.counted_qty if self.counted_qty is not None else self.system_qty
        elif self.opening_qty:
            self.variance_qty = self.opening_qty
        rate = Decimal(str(self.rate or 0))
        self.value = Decimal(str(qty_basis or 0)) * rate if rate > 0 else Decimal("0")
        if not self.uom and self.material_id:
            self.uom = getattr(self.material, "base_uom", "") or "KG"
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.batch.batch_no} {self.stock_class} {self.material.code}"


class InventoryFinancialPeriod(models.Model):
    STATUS_CHOICES = [
        ("OPEN", "Open"),
        ("CLOSING_IN_PROGRESS", "Closing In Progress"),
        ("CLOSED", "Closed"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    financial_year = models.CharField(max_length=20, unique=True)
    start_date = models.DateField()
    end_date = models.DateField()
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default="OPEN", db_index=True)
    closed_by = models.ForeignKey("users.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="closed_inventory_periods")
    closed_at = models.DateTimeField(null=True, blank=True)
    closing_batch = models.ForeignKey(InventoryAuditBatch, on_delete=models.SET_NULL, null=True, blank=True, related_name="closed_periods")
    opening_batch_next_year = models.ForeignKey(InventoryAuditBatch, on_delete=models.SET_NULL, null=True, blank=True, related_name="generated_from_periods")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "inventory_financial_periods"
        ordering = ["-start_date"]
        constraints = [
            models.UniqueConstraint(
                fields=["status"],
                condition=models.Q(status="OPEN"),
                name="uniq_open_inventory_financial_period",
            ),
        ]

    def __str__(self):
        return f"{self.financial_year} [{self.status}]"



class DeliveryChallan(models.Model):
    STATUS_CHOICES = [
        ('DRAFT', 'Draft'),
        ('APPROVED', 'Approved'),
        ('IN_TRANSIT', 'In Transit'),
        ('RECEIVED', 'Received'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    from_plant = models.ForeignKey('factory.Plant', on_delete=models.PROTECT, related_name='outgoing_challans')
    to_plant = models.ForeignKey('factory.Plant', on_delete=models.PROTECT, related_name='incoming_challans')
    dc_no = models.CharField(max_length=50, unique=True, blank=True, null=True)

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='DRAFT')
    dispatched_at = models.DateTimeField(null=True, blank=True)
    received_at = models.DateTimeField(null=True, blank=True)
    vehicle_no = models.CharField(max_length=50, blank=True)
    driver_name = models.CharField(max_length=100, blank=True)
    driver_phone = models.CharField(max_length=20, blank=True)
    transporter_name = models.CharField(max_length=120, blank=True)
    lr_number = models.CharField(max_length=80, blank=True)
    source_job = models.ForeignKey(
        'production.ProductionJob',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='source_interplant_challans'
    )
    target_job = models.ForeignKey(
        'production.ProductionJob',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='target_interplant_challans'
    )
    is_system_generated = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'inventory_delivery_challans'


class InterPlantChallanItem(models.Model):
    LINE_TYPE_CHOICES = [
        ('ROLL', 'Roll'),
        ('BULK', 'Bulk'),
    ]
    STATUS_CHOICES = [
        ('PENDING', 'Pending'),
        ('DISPATCHED', 'Dispatched'),
        ('PARTIAL', 'Partially Received'),
        ('RECEIVED', 'Received'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    challan = models.ForeignKey(DeliveryChallan, on_delete=models.CASCADE, related_name='items')
    line_type = models.CharField(max_length=10, choices=LINE_TYPE_CHOICES)
    roll = models.ForeignKey(
        InventoryRoll,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='interplant_challan_items'
    )
    material = models.ForeignKey(
        InventoryMaterial,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='interplant_challan_items'
    )
    from_location = models.ForeignKey(
        InventoryLocation,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='interplant_items_from'
    )
    to_location = models.ForeignKey(
        InventoryLocation,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='interplant_items_to'
    )
    planned_qty_kg = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    dispatched_qty_kg = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    received_qty_kg = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='PENDING')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'inventory_interplant_challan_items'
        ordering = ['created_at']

    def __str__(self):
        label = self.roll.label_id if self.roll else (self.material.code if self.material else "LINE")
        return f"{self.challan_id} - {self.line_type} - {label}"

class JobWorkOrder(models.Model):
    MODE_CHOICES = [
        ('PLANNED_STEP', 'Planned Route Step'),
        ('EMERGENCY', 'Emergency Handoff'),
    ]
    STATUS_CHOICES = [
        ('DRAFT', 'Draft'),
        ('SENT', 'Sent'),
        ('PARTIAL', 'Partially Received'),
        ('CLOSED', 'Closed'),
    ]
    
    MATERIAL_TYPE_CHOICES = [
        ('RM', 'Raw Material'),
        ('WIP', 'Work In Progress'),
        ('FG', 'Finished Goods'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plant = models.ForeignKey('factory.Plant', on_delete=models.PROTECT, related_name='job_work_orders')
    production_job = models.ForeignKey('production.ProductionJob', on_delete=models.SET_NULL, null=True, blank=True, related_name='job_work_orders')
    
    # Linked Vendor (New Phase 19)
    vendor = models.ForeignKey('Vendor', on_delete=models.PROTECT, null=True, blank=True, related_name='job_work_orders')
    # Backward compatibility field (can be deprecated later)
    vendor_name = models.CharField(max_length=255, blank=True)
    mode = models.CharField(max_length=20, choices=MODE_CHOICES, default='EMERGENCY')
    route_step_index = models.IntegerField(null=True, blank=True)
    emergency_reason = models.TextField(blank=True)
    
    sent_material_type = models.CharField(max_length=10, choices=MATERIAL_TYPE_CHOICES, default='RM')
    expected_return_type = models.CharField(max_length=10, choices=MATERIAL_TYPE_CHOICES, default='WIP')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='DRAFT')
    notes = models.TextField(blank=True)
    dispatched_at = models.DateTimeField(null=True, blank=True)
    received_at = models.DateTimeField(null=True, blank=True)
    meta_json = models.JSONField(default=dict, blank=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'inventory_job_work_orders'


# ============================================================================
# PHASE 54: ROLL TRACKING MODELS
# ============================================================================

class RollLink(models.Model):
    """
    Genealogy tree tracking parent-child roll relationships.
    Supports: SPLIT (one parent → many children), 
              MERGE (many parents → one child, e.g., lamination),
              PROCESS_OUTPUT (production transformation)
    """
    RELATION_TYPE_CHOICES = [
        ('SPLIT', 'Split'),
        ('MERGE', 'Merge'),
        ('PROCESS_OUTPUT', 'Process Output'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    parent_roll = models.ForeignKey(InventoryRoll, on_delete=models.PROTECT, related_name='child_links')
    child_roll = models.ForeignKey(InventoryRoll, on_delete=models.PROTECT, related_name='parent_links')
    
    relation_type = models.CharField(max_length=20, choices=RELATION_TYPE_CHOICES)
    qty_used_kg = models.DecimalField(max_digits=10, decimal_places=3, default=0, help_text="Amount from parent consumed to create child")
    
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'inventory_roll_links'
        unique_together = ['parent_roll', 'child_roll']
        indexes = [
            models.Index(fields=['parent_roll']),
            models.Index(fields=['child_roll']),
        ]

    def __str__(self):
        return f"{self.parent_roll.label_id} → {self.child_roll.label_id} ({self.relation_type})"


class RollConsumption(models.Model):
    """
    Tracks exact usage per job execution.
    Records consumed, scrap, and balance for every roll processed.
    This is the audit trail for all roll transformations.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    job = models.ForeignKey('production.ProductionJob', on_delete=models.PROTECT, related_name='roll_consumptions')
    process = models.ForeignKey('factory.Process', on_delete=models.PROTECT, related_name='roll_consumptions')
    
    input_roll = models.ForeignKey(InventoryRoll, on_delete=models.PROTECT, related_name='consumptions_as_input')
    output_roll = models.ForeignKey(InventoryRoll, on_delete=models.PROTECT, null=True, blank=True, related_name='consumptions_as_output', help_text="Output roll created from this consumption")
    balance_roll = models.ForeignKey(InventoryRoll, on_delete=models.PROTECT, null=True, blank=True, related_name='consumptions_as_balance', help_text="Remaining balance roll")
    scrap_roll = models.ForeignKey(InventoryRoll, on_delete=models.PROTECT, null=True, blank=True, related_name='consumptions_as_scrap', help_text="Scrap roll if any")
    
    consumed_kg = models.DecimalField(max_digits=10, decimal_places=3, help_text="Total weight consumed from input roll")
    scrap_kg = models.DecimalField(max_digits=10, decimal_places=3, default=0, help_text="Weight lost as scrap")
    balance_kg = models.DecimalField(max_digits=10, decimal_places=3, default=0, help_text="Remaining weight returned as balance roll")
    output_kg = models.DecimalField(max_digits=10, decimal_places=3, default=0, help_text="Weight produced as output")
    
    machine = models.ForeignKey('factory.Machine', on_delete=models.PROTECT, related_name='roll_consumptions', null=True, blank=True)
    operator = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='roll_consumptions')
    
    timestamp = models.DateTimeField(auto_now_add=True)
    notes = models.TextField(blank=True)

    class Meta:
        db_table = 'inventory_roll_consumptions'
        indexes = [
            models.Index(fields=['job']),
            models.Index(fields=['input_roll']),
            models.Index(fields=['timestamp']),
        ]

    def __str__(self):
        return f"Job {self.job.job_number}: {self.input_roll.label_id} → {self.consumed_kg}kg"


class RollMovement(models.Model):
    """
    Location tracking for physical roll movements.
    Records who moved what, when, where, and why.
    """
    REASON_CHOICES = [
        ('GRN', 'Goods Receipt'),
        ('PRODUCTION', 'Production Issue'),
        ('WIP_TRANSFER', 'WIP Transfer'),
        ('FG_TRANSFER', 'FG Storage'),
        ('DISPATCH', 'Dispatch'),
        ('JOBWORK_OUT', 'Job Work Send'),
        ('JOBWORK_IN', 'Job Work Return'),
        ('SCRAP', 'Scrap Yard'),
        ('ADJUSTMENT', 'Manual Adjustment'),
        ('INTER_PLANT', 'Inter-Plant Transfer'),
        ('OPENING_BALANCE', 'Opening Balance'),
        ('OPENING_BALANCE_ADJUST', 'Opening Balance Adjustment'),
        ('COUNT_SHORT', 'Physical Count Short'),
        ('COUNT_EXCESS', 'Physical Count Excess'),
        ('FY_ROLLFORWARD', 'FY Roll Forward'),
        ('FY_CORRECTION', 'FY Correction'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    roll = models.ForeignKey(InventoryRoll, on_delete=models.PROTECT, related_name='movements')
    
    from_location = models.ForeignKey(InventoryLocation, on_delete=models.PROTECT, related_name='roll_movements_from', null=True, blank=True, help_text="NULL for GRN (initial receipt)")
    to_location = models.ForeignKey(InventoryLocation, on_delete=models.PROTECT, related_name='roll_movements_to')
    
    reason = models.CharField(max_length=30, choices=REASON_CHOICES)
    reason_note = models.CharField(max_length=255, blank=True)
    
    job = models.ForeignKey('production.ProductionJob', on_delete=models.SET_NULL, null=True, blank=True, related_name='roll_movements')
    moved_by = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='roll_movements')
    
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'inventory_roll_movements'
        indexes = [
            models.Index(fields=['roll']),
            models.Index(fields=['timestamp']),
            models.Index(fields=['from_location']),
            models.Index(fields=['to_location']),
        ]
        ordering = ['-timestamp']

    def __str__(self):
        from_name = self.from_location.name if self.from_location else 'NEW'
        return f"{self.roll.label_id}: {from_name} → {self.to_location.name}"


# ============================================================
# Phase 58: Observability Models
# ============================================================

class InventorySnapshot(models.Model):
    """
    Daily snapshot of inventory state for auditing and trending.
    Created by nightly job.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    plant = models.ForeignKey('factory.Plant', on_delete=models.CASCADE, related_name='inventory_snapshots')
    
    total_bulk_kg = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    total_roll_kg = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    total_fg_kg = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    total_wip_kg = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    reserved_roll_kg = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    scrap_kg = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    
    # Counts
    bulk_sku_count = models.IntegerField(default=0)
    roll_count = models.IntegerField(default=0)
    fg_roll_count = models.IntegerField(default=0)
    
    class Meta:
        db_table = 'inventory_snapshots'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['plant', 'created_at']),
        ]

    def __str__(self):
        return f"{self.plant.code} @ {self.created_at.strftime('%Y-%m-%d')}"


class InventoryAlert(models.Model):
    """
    Auto-generated alerts for inventory anomalies.
    """
    ALERT_TYPES = [
        ('NEGATIVE_STOCK', 'Negative Stock'),
        ('LOW_STOCK', 'Low Stock'),
        ('ORPHAN_ROLL', 'Orphan Roll'),
        ('NO_PARENT', 'Missing Parent'),
        ('NO_CHILD', 'Missing Child'),
        ('STUCK_WIP', 'Stuck WIP'),
        ('COST_MISMATCH', 'Cost Mismatch'),
        ('WEIGHT_MISMATCH', 'Weight Mismatch'),
        ('TXN_MISMATCH', 'Transaction Mismatch'),
    ]
    
    SEVERITY_CHOICES = [
        ('LOW', 'Low'),
        ('MEDIUM', 'Medium'),
        ('HIGH', 'High'),
        ('CRITICAL', 'Critical'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    type = models.CharField(max_length=20, choices=ALERT_TYPES)
    message = models.TextField()
    severity = models.CharField(max_length=10, choices=SEVERITY_CHOICES, default='MEDIUM')
    
    # Context (one or both may be set)
    material = models.ForeignKey(InventoryMaterial, on_delete=models.CASCADE, null=True, blank=True, related_name='alerts')
    roll = models.ForeignKey(InventoryRoll, on_delete=models.CASCADE, null=True, blank=True, related_name='alerts')
    plant = models.ForeignKey('factory.Plant', on_delete=models.CASCADE, null=True, blank=True, related_name='inventory_alerts')
    
    # Details
    expected_value = models.DecimalField(max_digits=14, decimal_places=3, null=True, blank=True)
    actual_value = models.DecimalField(max_digits=14, decimal_places=3, null=True, blank=True)
    
    resolved = models.BooleanField(default=False)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='resolved_alerts')
    resolution_note = models.TextField(blank=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'inventory_alerts'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['type', 'resolved']),
            models.Index(fields=['severity', 'resolved']),
            models.Index(fields=['created_at']),
        ]

    def __str__(self):
        return f"[{self.severity}] {self.get_type_display()}: {self.message[:50]}"


class InventorySavedView(models.Model):
    """
    Server-backed saved filters for the V3.6 inventory workspaces.

    The UI still ships default views locally, but user-created views must live
    in the backend so they survive browser/cache/device changes.
    """
    WORKSPACE_CHOICES = [
        ("rolls", "Rolls"),
        ("bulk", "Bulk"),
        ("packaging", "Packaging"),
        ("addons", "Add-ons"),
        ("home", "Inventory Home"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.CharField(max_length=40, choices=WORKSPACE_CHOICES, db_index=True)
    name = models.CharField(max_length=120)
    icon = models.CharField(max_length=16, blank=True, default="")
    pinned = models.BooleanField(default=False)
    state = models.JSONField(default=dict, blank=True)
    user = models.ForeignKey(
        "users.User",
        on_delete=models.CASCADE,
        related_name="inventory_saved_views",
        null=True,
        blank=True,
    )
    shared_team = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "inventory_saved_views"
        ordering = ["-pinned", "name"]
        indexes = [
            models.Index(fields=["workspace", "user"]),
            models.Index(fields=["workspace", "shared_team"]),
        ]

    def __str__(self):
        return f"{self.workspace}: {self.name}"


class InventoryReservation(models.Model):
    """
    Hard allocation of inventory for a specific job.
    Ensures stock committed to a job cannot be used elsewhere.
    Phase 64B: Critical for Execution Engine.
    """
    STATUS_CHOICES = [
        ('ACTIVE', 'Active'),
        ('FULFILLED', 'Fulfilled'), # Consumed in production
        ('RELEASED', 'Released'),   # Cancelled/Unassigned
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    job = models.ForeignKey('production.ProductionJob', on_delete=models.CASCADE, related_name='reservations')
    
    # Can reserve specific Roll OR Bulk quantity
    roll = models.ForeignKey(InventoryRoll, on_delete=models.PROTECT, null=True, blank=True, related_name='reservations')
    material = models.ForeignKey('materials.InventoryMaterial', on_delete=models.PROTECT, related_name='reservations')
    
    quantity = models.DecimalField(max_digits=12, decimal_places=4, help_text="Reserved Amount")
    uom = models.CharField(max_length=10, default='KG')
    
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='ACTIVE')

    # Manual override traceability (WCM exceptional path)
    override_reason = models.TextField(null=True, blank=True)
    override_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='inventory_reservation_overrides'
    )

    # Lane-based roll assignment truth for lamination and other multi-input flows.
    target_lane_key = models.CharField(max_length=40, null=True, blank=True, db_index=True)
    target_lane_label = models.CharField(max_length=80, blank=True, default='')
    target_layer_index = models.PositiveIntegerField(null=True, blank=True)
    target_variant_id = models.CharField(max_length=64, blank=True, default='')
    target_grade_id = models.CharField(max_length=64, blank=True, default='')
    target_thickness_micron = models.DecimalField(max_digits=9, decimal_places=3, null=True, blank=True)
    target_width_mm = models.DecimalField(max_digits=10, decimal_places=3, null=True, blank=True)
    target_source_step_index = models.IntegerField(null=True, blank=True)
    target_lane_meta = models.JSONField(default=dict, blank=True)
    
    created_by = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'inventory_reservations'
        verbose_name = "Inventory Reservation"
        indexes = [
            models.Index(fields=['job', 'status']),
            models.Index(fields=['roll', 'status']),
            models.Index(fields=['material', 'status']),
        ]

    def __str__(self):
        target = self.roll.label_id if self.roll else self.material.code
        return f"RES: {target} -> {self.job.job_number} ({self.quantity} {self.uom})"


# Stock Adjustment unified audit models — imported here so Django sees them via apps.inventory.
from .models_adjustment import StockAdjustment, StockAdjustmentLine  # noqa: F401, E402
