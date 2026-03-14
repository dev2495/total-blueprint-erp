from django.db import models
from django.db.models import Q
from django.core.validators import MaxValueValidator, MinValueValidator
import uuid
from apps.templates.models import TemplateBlueprint

class Customer(models.Model):
    """
    Customer Master (Phase 19).
    """
    STATUS_CHOICES = [
        ('ACTIVE', 'Active'),
        ('INACTIVE', 'Inactive'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=50, unique=True)
    gst_no = models.CharField(max_length=20, blank=True)
    
    billing_address = models.TextField(blank=True)
    shipping_address = models.TextField(blank=True)
    
    contact_person = models.CharField(max_length=255, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    
    credit_days = models.IntegerField(default=0)
    credit_limit = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='ACTIVE')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.name} ({self.code})"

    class Meta:
        db_table = 'sales_customers'
        ordering = ['name']

class SalesOrder(models.Model):
    STATUS_CHOICES = [
        ('DRAFT', 'Draft'),
        ('CONFIRMED', 'Confirmed'),
        ('PLANNING_REQUIRED', 'Planning Required'),
        ('PLANNED', 'Planned'),
        ('RELEASED', 'Released'),
        ('DISPATCH_READY', 'Dispatch Ready'),
        ('COMPLETED', 'Completed'),
        ('CANCELLED', 'Cancelled'),
        # Backward-compat legacy values kept to avoid breaking historical rows.
        ('ON_HOLD', 'On Hold'),
        ('READY', 'Ready'),
    ]

    ORDER_TYPE_CHOICES = [
        ('MTO', 'Make To Order'),
        ('REPEAT', 'Repeat Order'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order_number = models.CharField(max_length=50, unique=True, blank=True)
    customer_name = models.CharField(max_length=255)
    order_name = models.CharField(max_length=255, blank=True, default="")
    order_type = models.CharField(max_length=20, choices=ORDER_TYPE_CHOICES, default='MTO')
    
    # Linked Customer (New Phase 19)
    customer = models.ForeignKey('Customer', on_delete=models.PROTECT, null=True, blank=True, related_name='sales_orders')
    
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='DRAFT')
    execution_model_version = models.PositiveSmallIntegerField(
        default=2,
        validators=[MinValueValidator(2), MaxValueValidator(2)],
    )
    geometry_override = models.JSONField(default=dict, blank=True)
    commercial_confirmed_at = models.DateTimeField(null=True, blank=True)
    delivery_date = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'sales_orders'
        # constraints = [
        #     models.CheckConstraint(
        #         check=Q(execution_model_version=2),
        #         name='sales_order_execution_model_version_v2_only',
        #     ),
        # ]

    @property
    def total_weight_kg(self):
        """
        Sums total_weight_kg from all linked items.
        """
        from django.db.models import Sum
        return self.items.aggregate(total=Sum('total_weight_kg'))['total'] or 0

    def save(self, *args, **kwargs):
        if not self.order_number:
            # Robust order number generation
            from django.db.models import Max
            import re
            
            # Find the latest 'SO' order
            last_order = SalesOrder.objects.filter(order_number__startswith='SO').order_by('-created_at').first()
            
            new_seq = 1
            if last_order:
                # Try to extract number from SOxxxxx format
                match = re.search(r'SO(\d+)', last_order.order_number)
                if match:
                    try:
                        new_seq = int(match.group(1)) + 1
                    except ValueError:
                        pass
            
            self.order_number = f"SO{new_seq:05d}"
            
            # Final safety check: if collision, append random suffix
            while SalesOrder.objects.filter(order_number=self.order_number).exists():
                new_seq += 1
                self.order_number = f"SO{new_seq:05d}"
                
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.order_number} - {self.customer_name}"

class SalesOrderItem(models.Model):
    MODE_CHOICES = [
        ('TEMPLATE', 'Template'),
        ('CUSTOM', 'Custom'),
        ('REPEAT', 'Repeat'),
    ]

    UOM_CHOICES = [
        ('PCS', 'Pieces'),
        ('KG', 'Kilograms'),
    ]
    PRICE_BASIS_CHOICES = [
        ('KG', 'Per KG'),
        ('PCS', 'Per PCS'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sales_order = models.ForeignKey(SalesOrder, on_delete=models.CASCADE, related_name='items')
    template = models.ForeignKey(TemplateBlueprint, on_delete=models.PROTECT)
    mode = models.CharField(max_length=20, choices=MODE_CHOICES, default='TEMPLATE')
    line_name = models.CharField(max_length=255, blank=True, default="")

    # Snapshot (IMMUTABLE once confirmed)
    geometry_snapshot = models.JSONField(default=dict)
    layer_snapshot = models.JSONField(default=list)
    printing_snapshot = models.JSONField(default=dict)
    addons_snapshot = models.JSONField(default=list)
    packaging_snapshot = models.JSONField(default=dict, blank=True)
    bom_snapshot = models.JSONField(default=dict)
    spec_signature = models.CharField(max_length=128, blank=True, default='')
    invariant_signature = models.CharField(max_length=128, blank=True, default='')

    # Physics Results
    unit_weight_g = models.DecimalField(max_digits=12, decimal_places=4, default=0)
    total_weight_kg = models.DecimalField(max_digits=12, decimal_places=4, default=0)

    # Quantity
    qty_uom = models.CharField(max_length=10, choices=UOM_CHOICES, default='KG')
    qty_value = models.DecimalField(max_digits=12, decimal_places=2)
    price_basis = models.CharField(max_length=10, choices=PRICE_BASIS_CHOICES, default='KG')
    unit_price = models.DecimalField(max_digits=12, decimal_places=4, default=0)
    artwork_assignment_required = models.BooleanField(default=False)
    assigned_artwork = models.ForeignKey(
        'artwork.Artwork',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='sales_order_items_assigned',
    )

    created_at = models.DateTimeField(auto_now_add=True)

    @property
    def color_names(self):
        return self.printing_snapshot.get('color_names', [])

    @property
    def gsm_per_color(self):
        return self.printing_snapshot.get('gsm_per_color', 0)

    @property
    def primary_film_density(self):
        # Extract density from the first film layer in the snapshot
        if self.layer_snapshot and len(self.layer_snapshot) > 0:
            return self.layer_snapshot[0].get('density_g_cm3', 0)
        return 0

    @property
    def line_amount(self):
        from decimal import Decimal
        basis = str(self.price_basis or "KG").upper()
        unit_price = Decimal(str(self.unit_price or 0))
        if unit_price <= 0:
            return Decimal("0")
        if basis == "PCS":
            return Decimal(str(self.qty_value or 0)) * unit_price
        return Decimal(str(self.total_weight_kg or 0)) * unit_price

    class Meta:
        db_table = 'sales_order_items'
