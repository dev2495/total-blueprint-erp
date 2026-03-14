from django.db import models
import uuid
from apps.materials.models import InventoryMaterial
from apps.factory.models import Process, Machine
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

class JobCost(models.Model):
    """
    Per job calculation result.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    job = models.OneToOneField(ProductionJob, on_delete=models.CASCADE, related_name='costing')
    
    material_cost = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    process_cost = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    total_cost = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    
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
    total_cost = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    
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
