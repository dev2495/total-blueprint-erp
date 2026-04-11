from django.db import models
import uuid

class Plant(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    code = models.CharField(max_length=20, unique=True)
    default_cost_absorption_group = models.ForeignKey(
        'costing.CostAbsorptionGroup',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='default_plants',
    )
    include_in_official_reports = models.BooleanField(
        default=True,
        help_text="When enabled, this plant is included in official daily PDF and spreadsheet report packs.",
    )
    
    def __str__(self):
        return f"{self.name} ({self.code})"
    
    class Meta:
        db_table = 'factory_plants'


class PlantLegalProfile(models.Model):
    """
    Plant-wise legal identity used for official dispatch/inter-plant documents.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plant = models.OneToOneField(
        Plant,
        on_delete=models.CASCADE,
        related_name='legal_profile',
    )
    legal_name = models.CharField(max_length=255)
    gstin = models.CharField(max_length=20, blank=True)
    address = models.TextField()
    contact_phone = models.CharField(max_length=20, blank=True)
    contact_email = models.EmailField(blank=True)
    authorized_signatory_name = models.CharField(max_length=120, blank=True)
    authorized_signatory_designation = models.CharField(max_length=120, blank=True)
    is_verified = models.BooleanField(default=False)
    notes = models.TextField(blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'factory_plant_legal_profiles'

    def __str__(self):
        return f"Legal Profile - {self.plant.name}"


class PlantShiftDefinition(models.Model):
    """
    Plant-scoped shift calendar used for reporting and telemetry bucketing.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plant = models.ForeignKey(Plant, on_delete=models.CASCADE, related_name="shift_definitions")
    code = models.CharField(max_length=20, help_text="Shift code (A/B/C or custom)")
    name = models.CharField(max_length=60, blank=True, default="")
    start_time = models.TimeField()
    end_time = models.TimeField()
    crosses_midnight = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    priority = models.PositiveIntegerField(default=100, help_text="Lower number wins when overlaps exist.")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "factory_plant_shift_definitions"
        ordering = ["plant__code", "priority", "code"]
        unique_together = [("plant", "code")]

    def __str__(self):
        label = self.name or self.code
        return f"{self.plant.code} Shift {label}"


class MachineShiftOverride(models.Model):
    """
    Optional machine-specific shift override.
    If enabled, this schedule is used before plant default shifts.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    machine = models.ForeignKey("Machine", on_delete=models.CASCADE, related_name="shift_overrides")
    code = models.CharField(max_length=20)
    name = models.CharField(max_length=60, blank=True, default="")
    start_time = models.TimeField()
    end_time = models.TimeField()
    crosses_midnight = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    priority = models.PositiveIntegerField(default=100, help_text="Lower number wins when overlaps exist.")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "factory_machine_shift_overrides"
        ordering = ["machine__code", "priority", "code"]
        unique_together = [("machine", "code")]

    def __str__(self):
        label = self.name or self.code
        return f"{self.machine.code} Shift {label}"

class Process(models.Model):
    """
    Process Model — Physical Transformation Rules Only
    
    This model defines ONLY physical transformation behavior:
    - What form of material it consumes (BULK/ROLL)
    - What form of material it produces (BULK/ROLL)
    
    IMPORTANT: FG/WIP determination is handled by Route position, NOT by Process.
    """
    INPUT_FORMS = [
        ("NONE", "None"),
        ("BULK", "Bulk"),
        ("ROLL", "Roll"),
    ]
    OUTPUT_FORMS = [
        ("BULK", "Bulk"),
        ("ROLL", "Roll"),
    ]
    ROLL_BEHAVIORS = [
        ("CREATE_NEW", "Create New Roll"),
        ("MODIFY_EXISTING", "Modify Existing Roll"),
        ("MULTI_INPUT_COMBINE", "Combine Multiple Rolls"),
        ("SPLIT", "Split Roll"),
        ("NONE", "None"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True, default="")
    
    # Physical IO
    input_form = models.CharField(max_length=10, choices=INPUT_FORMS, default='BULK')
    output_form = models.CharField(max_length=10, choices=OUTPUT_FORMS, default='ROLL')
    roll_behavior = models.CharField(max_length=30, choices=ROLL_BEHAVIORS, default='NONE')
    
    def __str__(self):
        return f"{self.name} ({self.code})"

    class Meta:
        db_table = 'factory_processes'

class WorkCenter(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plant = models.ForeignKey(Plant, on_delete=models.CASCADE, related_name='work_centers')
    name = models.CharField(max_length=100)
    code = models.CharField(max_length=50, unique=True)
    default_cost_absorption_group = models.ForeignKey(
        'costing.CostAbsorptionGroup',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='default_work_centers',
    )
    
    default_wip_location = models.ForeignKey(
        'inventory.InventoryLocation', 
        on_delete=models.SET_NULL, 
        null=True, 
        blank=True, 
        related_name='staging_work_centers'
    )
    
    # Capacity Planning (Phase Enterprise)
    standard_operating_minutes_per_day = models.PositiveIntegerField(
        default=480, 
        help_text="Standard daily operating time (e.g. 480 for 8h shift, 1440 for 24h)"
    )
    
    def __str__(self):
        return f"{self.name} @ {self.plant.code}"

    class Meta:
        db_table = 'factory_work_centers'

class WorkCenterProcess(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    work_center = models.ForeignKey(WorkCenter, on_delete=models.CASCADE, related_name='center_processes')
    process = models.ForeignKey(Process, on_delete=models.CASCADE, related_name='center_processes')

    class Meta:
        db_table = 'factory_work_center_processes'
        unique_together = ['work_center', 'process']

    def __str__(self):
        return f"{self.work_center.code} -> {self.process.code}"

class Machine(models.Model):
    """
    Machine = Execution Unit
    
    Jobs belong to machines. Operators control machines.
    One machine can have at most one assigned operator.
    One operator can control many machines (within same work center).
    """
    STATUS_CHOICES = [
        ('ACTIVE', 'Active'),
        ('DOWN', 'Down'),
        ('MAINTENANCE', 'Maintenance'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    work_center = models.ForeignKey(WorkCenter, on_delete=models.CASCADE, related_name='machines')
    name = models.CharField(max_length=100)
    code = models.CharField(max_length=50)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='ACTIVE')
    cost_absorption_group = models.ForeignKey(
        'costing.CostAbsorptionGroup',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='machines',
    )
    
    # Machine-Centric Execution: One machine → max one operator
    assigned_operator = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='operated_machines',
        help_text="Currently assigned operator for this machine"
    )

    # Performance Standards (Phase Enterprise)
    standard_rate_kg_per_hour = models.DecimalField(
        max_digits=10, 
        decimal_places=2, 
        default=0, 
        help_text="Standard output rate for OEE Performance calculation"
    )
    
    def __str__(self):
        return f"{self.name} ({self.code})"

    class Meta:
        db_table = 'factory_machines'
        constraints = [
            models.UniqueConstraint(fields=['work_center', 'code'], name='factory_machine_wc_code_unique'),
        ]
