from django.db import models
import uuid
from apps.materials.models import InventoryMaterial
from apps.factory.models import Process, Machine, Plant, WorkCenter
from apps.production.models import ProductionJob
from apps.sales.models import SalesOrderItem

class MaterialCostSnapshot(models.Model):
    """
    Freeze cost at time of run.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    material = models.ForeignKey(InventoryMaterial, on_delete=models.CASCADE, related_name='cost_snapshots')
    avg_rate_per_kg = models.DecimalField(max_digits=15, decimal_places=4)
    uom = models.CharField(max_length=10, default='KG')
    effective_date = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'costing_material_snapshots'
        ordering = ['-effective_date']

    def __str__(self):
        return f"{self.material.code} @ {self.avg_rate_per_kg} ({self.effective_date.date()})"


class CostAbsorptionGroup(models.Model):
    """
    Stable costing bucket independent of extensible process names.
    Used to absorb monthly plant costs into productive runtime.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=60, unique=True)
    label = models.CharField(max_length=120)
    description = models.TextField(blank=True, default="")
    default_intensity_factor = models.DecimalField(max_digits=8, decimal_places=4, default=1)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "costing_absorption_groups"
        ordering = ["code"]

    def __str__(self):
        return f"{self.code} · {self.label}"


class PlantCostPoolMonth(models.Model):
    ENTRY_MODE_CHOICES = [
        ("DIRECT", "Direct Entry"),
        ("ALLOCATED", "Top-down Allocation"),
    ]
    STATUS_CHOICES = [
        ("DRAFT", "Draft"),
        ("REVIEWED", "Reviewed"),
        ("LOCKED", "Locked"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plant = models.ForeignKey(Plant, on_delete=models.CASCADE, related_name="cost_pool_months")
    year = models.PositiveIntegerField()
    month = models.PositiveSmallIntegerField()
    entry_mode = models.CharField(max_length=20, choices=ENTRY_MODE_CHOICES, default="DIRECT")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="DRAFT")

    plant_total_electricity = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    plant_total_labor = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    plant_total_overhead = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    plant_total_maintenance = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    plant_total_service_burden = models.DecimalField(max_digits=15, decimal_places=2, default=0)

    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "costing_plant_cost_pool_months"
        ordering = ["-year", "-month", "plant__code"]
        unique_together = [("plant", "year", "month")]

    def __str__(self):
        return f"{self.plant.code} {self.year}-{self.month:02d}"


class PlantCostPoolLine(models.Model):
    ENTRY_MODE_CHOICES = [
        ("DIRECT", "Direct Entry"),
        ("ALLOCATED", "Allocated"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    month_record = models.ForeignKey(PlantCostPoolMonth, on_delete=models.CASCADE, related_name="lines")
    cost_group = models.ForeignKey(CostAbsorptionGroup, on_delete=models.PROTECT, related_name="pool_lines")
    entry_mode = models.CharField(max_length=20, choices=ENTRY_MODE_CHOICES, default="DIRECT")
    allocation_percent = models.DecimalField(max_digits=8, decimal_places=4, default=0)

    electricity_cost = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    labor_cost = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    overhead_cost = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    maintenance_cost = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    service_burden_cost = models.DecimalField(max_digits=15, decimal_places=2, default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "costing_plant_cost_pool_lines"
        ordering = ["month_record__year", "month_record__month", "cost_group__code"]
        unique_together = [("month_record", "cost_group")]

    @property
    def pool_total(self):
        return (
            self.electricity_cost
            + self.labor_cost
            + self.overhead_cost
            + self.maintenance_cost
            + self.service_burden_cost
        )

    def __str__(self):
        return f"{self.month_record} · {self.cost_group.code}"

class ProcessCostRate(models.Model):
    """
    Cost per hour of each process/machine.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    process = models.ForeignKey(Process, on_delete=models.CASCADE, related_name='cost_rates')
    machine = models.ForeignKey(Machine, on_delete=models.SET_NULL, null=True, blank=True, related_name='cost_rates')
    
    cost_per_hour = models.DecimalField(max_digits=15, decimal_places=2, help_text="Total cost per hour")
    power_cost_per_hour = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    labor_cost_per_hour = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    overhead_cost_per_hour = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'costing_process_rates'
        unique_together = ['process', 'machine']

    def __str__(self):
        machine_info = f" | {self.machine.code}" if self.machine else ""
        return f"{self.process.code}{machine_info} -> ₹{self.cost_per_hour}/hr"


class JobRuntimeSession(models.Model):
    CLOSE_REASON_CHOICES = [
        ("PAUSE", "Paused"),
        ("COMPLETE", "Completed"),
        ("CANCEL", "Cancelled"),
        ("MANUAL", "Manual"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    job = models.ForeignKey(ProductionJob, on_delete=models.CASCADE, related_name="runtime_sessions")
    plant = models.ForeignKey(Plant, on_delete=models.PROTECT, related_name="runtime_sessions")
    work_center = models.ForeignKey(WorkCenter, on_delete=models.PROTECT, null=True, blank=True, related_name="runtime_sessions")
    machine = models.ForeignKey(Machine, on_delete=models.PROTECT, null=True, blank=True, related_name="runtime_sessions")
    process = models.ForeignKey(Process, on_delete=models.PROTECT, null=True, blank=True, related_name="runtime_sessions")
    cost_absorption_group = models.ForeignKey(
        CostAbsorptionGroup,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="runtime_sessions",
    )
    started_at = models.DateTimeField()
    ended_at = models.DateTimeField(null=True, blank=True)
    started_by = models.ForeignKey("users.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="started_runtime_sessions")
    ended_by = models.ForeignKey("users.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="ended_runtime_sessions")
    close_reason = models.CharField(max_length=20, choices=CLOSE_REASON_CHOICES, blank=True, default="")
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "costing_job_runtime_sessions"
        ordering = ["-started_at"]

    def __str__(self):
        return f"{self.job.job_number} @ {self.started_at.isoformat()}"

class JobCost(models.Model):
    """
    Per job calculation result.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    job = models.OneToOneField(ProductionJob, on_delete=models.CASCADE, related_name='costing')
    plant = models.ForeignKey(Plant, on_delete=models.PROTECT, null=True, blank=True, related_name="job_costs")
    cost_absorption_group = models.ForeignKey(
        CostAbsorptionGroup,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="job_costs",
    )
    
    material_cost = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    process_cost = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    overhead_cost_absorbed = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    total_cost = models.DecimalField(max_digits=15, decimal_places=4, default=0)

    material_cost_actual = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    conversion_cost_actual = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    runtime_minutes_productive = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    costing_mode = models.CharField(max_length=20, default="ESTIMATED")
    actual_cost_coverage_pct = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    coverage_flags = models.JSONField(default=list, blank=True)
    
    cost_per_kg = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    cost_per_piece = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    
    calculation_log = models.JSONField(default=dict, help_text="Breakdown of how cost was calculated")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'costing_job_costs'

    def __str__(self):
        return f"Cost for {self.job.job_number}: ₹{self.total_cost}"

class OrderCost(models.Model):
    """
    Per Sales Order / Item calculation.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sales_order_item = models.OneToOneField(SalesOrderItem, on_delete=models.CASCADE, related_name='costing')
    
    material_cost = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    conversion_cost = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    overhead_cost_absorbed = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    total_cost = models.DecimalField(max_digits=15, decimal_places=4, default=0)

    material_cost_actual = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    conversion_cost_actual = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    contribution_margin = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    contribution_margin_percent = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    absorbed_margin = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    absorbed_margin_percent = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    costing_mode = models.CharField(max_length=20, default="ESTIMATED")
    actual_cost_coverage_pct = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    coverage_flags = models.JSONField(default=list, blank=True)
    
    selling_price = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    margin_value = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    margin_percent = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    
    is_frozen = models.BooleanField(default=False, help_text="True if cost is locked for historical reference")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'costing_order_costs'

    def __str__(self):
        return f"Order Cost: {self.sales_order_item.sales_order.order_number} | Margin: {self.margin_percent}%"

class MonthlyOverhead(models.Model):
    """
    Monthly Fixed Cost Bookings (Electricity, Labor, Overheads).
    Used to calculate actual net profit.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    year = models.IntegerField()
    month = models.IntegerField()
    
    electricity_cost = models.DecimalField(max_digits=15, decimal_places=2, default=0, help_text="Total electricity bill for the month")
    labor_cost = models.DecimalField(max_digits=15, decimal_places=2, default=0, help_text="Total labor cost (salary, wages) for the month")
    other_overheads = models.DecimalField(max_digits=15, decimal_places=2, default=0, help_text="Rent, admin, depreciation, etc.")
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'costing_monthly_overheads'
        unique_together = ['year', 'month']
        
    def __str__(self):
        return f"Overheads for {self.month:02d}/{self.year}: Total {self.electricity_cost + self.labor_cost + self.other_overheads}"
