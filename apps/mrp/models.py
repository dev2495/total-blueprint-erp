from django.db import models
import uuid
from apps.materials.models import InventoryMaterial
from apps.factory.models import Plant

class MRPPlan(models.Model):
    STATUS_CHOICES = [
        ('DRAFT', 'Draft'),
        ('RUNNING', 'Running'),
        ('COMPLETED', 'Completed'),
        ('FAILED', 'Failed'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plant = models.ForeignKey(Plant, on_delete=models.CASCADE, related_name='mrp_plans', null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='DRAFT')
    
    # KPIs recorded at end of run
    total_demand_kg = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    total_available_kg = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    total_wip_kg = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    total_shortage_kg = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    purchase_value_est = models.DecimalField(max_digits=15, decimal_places=2, default=0)

    created_by = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True, related_name='mrp_plans')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'mrp_plans'
        ordering = ['-created_at']

    def __str__(self):
        return f"Plan {self.created_at.date()} | {self.status}"

class MRPRequirement(models.Model):
    SOURCE_CHOICES = [
        ('SO', 'Sales Order'),
        ('MTS', 'Make To Stock'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plan = models.ForeignKey(MRPPlan, on_delete=models.CASCADE, related_name='requirements')
    
    material = models.ForeignKey(InventoryMaterial, on_delete=models.CASCADE)
    required_qty_kg = models.DecimalField(max_digits=15, decimal_places=4)
    available_qty_kg = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    wip_qty_kg = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    shortage_qty_kg = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    
    source_type = models.CharField(max_length=20, choices=SOURCE_CHOICES)
    source_ref = models.CharField(max_length=100) # SO Number or MTS Number
    source_id = models.UUIDField(null=True, blank=True)

    class Meta:
        db_table = 'mrp_requirements'

class MRPSuggestion(models.Model):
    TYPE_CHOICES = [
        ('PURCHASE', 'Purchase Suggestion'),
        ('MTS_PRODUCE', 'Suggest MTS Production'),
        ('TRANSFER', 'Inter-Plant Transfer'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plan = models.ForeignKey(MRPPlan, on_delete=models.CASCADE, related_name='suggestions')
    
    type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    material = models.ForeignKey(InventoryMaterial, on_delete=models.CASCADE)
    qty = models.DecimalField(max_digits=15, decimal_places=4)
    reason = models.TextField(blank=True)
    required_date = models.DateField(null=True, blank=True)
    priority = models.CharField(max_length=20, default='MEDIUM')
    action_status = models.CharField(max_length=20, default='PENDING')
    draft_ref = models.CharField(max_length=100, blank=True, default='')
    last_action_at = models.DateTimeField(null=True, blank=True)
    last_action_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='mrp_suggestion_actions'
    )
    
    # For Transfer suggestions
    source_plant = models.ForeignKey(Plant, on_delete=models.SET_NULL, null=True, blank=True, related_name='mrp_transfer_sources')
    target_plant = models.ForeignKey(Plant, on_delete=models.CASCADE, related_name='mrp_suggestions', null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'mrp_suggestions'
