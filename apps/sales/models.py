from django.db import models
from django.db.models import Q
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.utils import timezone
import re
import uuid
from apps.factory.models import Plant
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
    under_group = models.CharField(max_length=255, blank=True, default="")
    gst_no = models.CharField(max_length=20, blank=True)
    pan_no = models.CharField(max_length=20, blank=True, default="")
    
    billing_address = models.TextField(blank=True)
    shipping_address = models.TextField(blank=True)
    mailing_name = models.CharField(max_length=255, blank=True, default="")
    mailing_state = models.CharField(max_length=100, blank=True, default="")
    mailing_country = models.CharField(max_length=100, blank=True, default="")
    mailing_pincode = models.CharField(max_length=20, blank=True, default="")
    additional_addresses = models.JSONField(default=list, blank=True)
    
    contact_person = models.CharField(max_length=255, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    contact_details = models.TextField(blank=True, default="")
    
    credit_days = models.IntegerField(default=0)
    credit_limit = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    interest_calculation = models.CharField(max_length=255, blank=True, default="")
    bank_details = models.TextField(blank=True, default="")
    tds_deductable = models.BooleanField(default=False)
    tcs_deductable = models.BooleanField(default=False)
    
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='ACTIVE')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.name} ({self.code})"

    class Meta:
        db_table = 'sales_customers'
        ordering = ['name']


class CustomerProductOverlay(models.Model):
    PRICE_BASIS_CHOICES = [
        ('KG', 'Per KG'),
        ('PCS', 'Per PCS'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product_master = models.ForeignKey(
        'materials.ProductMaster',
        on_delete=models.CASCADE,
        related_name='customer_overlays',
    )
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name='product_overlays')
    size_variant_code = models.CharField(max_length=80, blank=True, default='')
    # v3: axis_values replaces size_variant_code for multi-axis matching
    axis_values = models.JSONField(default=dict, blank=True)
    customer_item_code = models.CharField(max_length=80, blank=True, default='')
    customer_display_name = models.CharField(max_length=255, blank=True, default='')
    default_packing_note = models.TextField(blank=True, default='')
    default_packing_recipe = models.JSONField(default=dict, blank=True)
    default_price_basis = models.CharField(max_length=10, choices=PRICE_BASIS_CHOICES, blank=True, default='')
    moq_kg = models.DecimalField(max_digits=12, decimal_places=3, null=True, blank=True)
    default_artwork = models.ForeignKey(
        'artwork.Artwork',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='customer_product_overlays',
    )
    notes = models.TextField(blank=True, default='')
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'customer_product_overlays'
        ordering = ['customer__name', 'product_master__name', 'customer_item_code']
        constraints = [
            models.UniqueConstraint(
                fields=['product_master', 'customer', 'customer_item_code'],
                name='customer_product_overlay_unique_item_code',
            ),
        ]

    def clean(self):
        if self.default_artwork_id and str(getattr(self.default_artwork, 'status', '') or '').upper() != 'APPROVED':
            raise ValidationError({'default_artwork': 'Default artwork must be APPROVED.'})

    @classmethod
    def find_for(cls, *, customer, product_master, axis_values=None):
        if not customer or not product_master:
            return None
        axis_values = axis_values if isinstance(axis_values, dict) else {}
        candidates = list(
            cls.objects.select_related('product_master', 'customer', 'default_artwork')
            .filter(product_master=product_master, customer=customer, active=True)
        )
        matches = []
        for overlay in candidates:
            overlay_axes = overlay.axis_values if isinstance(overlay.axis_values, dict) else {}
            if overlay_axes:
                if all(str(axis_values.get(key, "")) == str(value) for key, value in overlay_axes.items()):
                    matches.append((len(overlay_axes), overlay.updated_at, overlay))
                continue
            size_code = str(overlay.size_variant_code or "").strip()
            if size_code:
                order_size = str(axis_values.get("size") or axis_values.get("size_code") or "").strip()
                if order_size and order_size.lower() == size_code.lower():
                    matches.append((1, overlay.updated_at, overlay))
                continue
            matches.append((0, overlay.updated_at, overlay))
        if not matches:
            return None
        matches.sort(key=lambda row: (row[0], row[1]), reverse=True)
        return matches[0][2]

    def __str__(self):
        label = self.customer_display_name or self.customer_item_code or self.product_master.name
        return f"{self.customer.code} / {label}"


class SalesOrder(models.Model):
    STATUS_CHOICES = [
        ('DRAFT', 'Draft'),
        ('CONFIRMED', 'Confirmed'),
        ('PLANNING_REQUIRED', 'Planning Required'),
        ('PLANNED', 'Planned'),
        ('RELEASED', 'Released'),
        ('PACKING_READY', 'Packing Ready'),
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
    ship_to_customer = models.ForeignKey('Customer', on_delete=models.PROTECT, null=True, blank=True, related_name='ship_to_sales_orders')
    ship_to_customer_name = models.CharField(max_length=255, blank=True, default="")
    remarks = models.TextField(blank=True, default="")
    
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

    @classmethod
    def next_order_number(cls, *, now=None):
        current_year = (now or timezone.now()).year
        prefix = f"SO-{current_year}-"
        pattern = re.compile(rf"^{re.escape(prefix)}(\d+)$")
        max_seq = 0
        for value in cls.objects.filter(order_number__startswith=prefix).values_list("order_number", flat=True):
            match = pattern.match(str(value or ""))
            if not match:
                continue
            try:
                max_seq = max(max_seq, int(match.group(1)))
            except ValueError:
                continue
        return f"{prefix}{max_seq + 1:04d}"

    def save(self, *args, **kwargs):
        if not self.order_number:
            self.order_number = self.next_order_number()

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
    SOURCE_CHIP_CHOICES = [
        ('REORDER', 'Quick reorder'),
        ('PRESET', 'Saved preset'),
        ('CSV', 'Bulk paste'),
        ('WIZARD', 'Configure new line'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sales_order = models.ForeignKey(SalesOrder, on_delete=models.CASCADE, related_name='items')
    template = models.ForeignKey(TemplateBlueprint, on_delete=models.PROTECT)
    mode = models.CharField(max_length=20, choices=MODE_CHOICES, default='TEMPLATE')
    product_master = models.ForeignKey(
        'materials.ProductMaster',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='sales_order_items',
    )
    # v3: product_variant for axis-space identity
    product_variant = models.ForeignKey(
        'materials.ProductVariant',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='sales_order_items',
    )
    customer_product_overlay = models.ForeignKey(
        'CustomerProductOverlay',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='sales_order_items',
    )
    sku_variant = models.ForeignKey(
        'SalesSkuVariant',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='sales_order_items',
    )
    repeat_source_item = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='repeat_children',
    )
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

    # v3: axis values snapshot + source tracking
    axis_values = models.JSONField(default=dict, blank=True)
    source_chip = models.CharField(max_length=20, choices=SOURCE_CHIP_CHOICES, default='WIZARD')
    source_ref = models.CharField(max_length=80, blank=True, default='')
    material_overrides = models.JSONField(default=list, blank=True)
    bom_material_cost = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    bom_margin_pct = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)

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
        qty_uom = str(self.qty_uom or "KG").upper()
        unit_price = Decimal(str(self.unit_price or 0))
        if unit_price <= 0:
            return Decimal("0")
        if basis == "PCS":
            if qty_uom == "PCS":
                return Decimal(str(self.qty_value or 0)) * unit_price
            unit_weight_g = Decimal(str(self.unit_weight_g or 0))
            if qty_uom == "KG" and unit_weight_g > 0:
                derived_pcs = (Decimal(str(self.qty_value or 0)) * Decimal("1000")) / unit_weight_g
                return derived_pcs * unit_price
            return Decimal("0")
        return Decimal(str(self.total_weight_kg or 0)) * unit_price

    class Meta:
        db_table = 'sales_order_items'


class SalesSku(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=80, unique=True, db_index=True)
    name = models.CharField(max_length=255)
    template = models.ForeignKey(
        TemplateBlueprint,
        on_delete=models.PROTECT,
        related_name='sales_skus',
    )
    commercial_family = models.ForeignKey(
        'materials.CommercialFamily',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='sales_skus',
    )
    product_master = models.ForeignKey(
        'materials.ProductMaster',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='sales_skus',
    )
    axis_values_template = models.JSONField(default=dict, blank=True)
    default_line_name = models.CharField(max_length=255, blank=True, default="")
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'sales_skus'
        ordering = ['name', 'code']

    def clean(self):
        if self.template_id and str(getattr(self.template, 'status', '') or '').upper() != 'LIVE':
            raise ValidationError({'template': 'Sales SKU must link to a LIVE template.'})

    def __str__(self):
        return f"{self.code} - {self.name}"


class SalesSkuVariant(models.Model):
    FG_TYPE_CHOICES = [
        ('POUCH', 'Pouch'),
        ('ROLL', 'Roll'),
    ]
    ROLL_FORM_CHOICES = [
        ('', 'Not Applicable'),
        ('FLAT', 'Flat'),
        ('FOLDED', 'Folded'),
        ('TUBING', 'Tubing'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sku = models.ForeignKey(SalesSku, on_delete=models.CASCADE, related_name='variants')
    code = models.CharField(max_length=80)
    name = models.CharField(max_length=255)
    active = models.BooleanField(default=True)
    finished_good_type = models.CharField(max_length=20, choices=FG_TYPE_CHOICES, default='POUCH')
    roll_form = models.CharField(max_length=20, choices=ROLL_FORM_CHOICES, blank=True, default="")
    geometry_snapshot = models.JSONField(default=dict, blank=True)
    layer_snapshot = models.JSONField(default=list, blank=True)
    printing_snapshot = models.JSONField(default=dict, blank=True)
    chemicals_snapshot = models.JSONField(default=dict, blank=True)
    addons_snapshot = models.JSONField(default=list, blank=True)
    packaging_snapshot = models.JSONField(default=dict, blank=True)
    derived_from_planner_variant = models.ForeignKey(
        'production.PlannerSkuVariant',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='sales_variants',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'sales_sku_variants'
        ordering = ['sku__name', 'name', 'code']
        constraints = [
            models.UniqueConstraint(fields=['sku', 'code'], name='sales_sku_variant_code_unique_per_sku'),
        ]

    def __str__(self):
        return f"{self.sku.code} - {self.code}"


class Quotation(models.Model):
    STATUS_CHOICES = [
        ("DRAFT", "Draft"),
        ("SENT", "Sent"),
        ("APPROVED", "Approved"),
        ("REJECTED", "Rejected"),
        ("EXPIRED", "Expired"),
        ("CONVERTED", "Converted"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    quote_number = models.CharField(max_length=50, unique=True, blank=True)
    customer = models.ForeignKey(
        "Customer",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="quotations",
    )
    customer_name = models.CharField(max_length=255)
    plant = models.ForeignKey(
        Plant,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="quotations",
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="DRAFT")
    valid_until = models.DateField(null=True, blank=True)
    currency = models.CharField(max_length=10, default="INR")
    terms = models.TextField(blank=True, default="")
    notes = models.TextField(blank=True, default="")
    totals_snapshot = models.JSONField(default=dict, blank=True)
    converted_sales_order = models.ForeignKey(
        "SalesOrder",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="source_quotations",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sales_quotations"
        ordering = ["-updated_at", "-created_at"]

    def save(self, *args, **kwargs):
        if not self.quote_number:
            last_quote = Quotation.objects.filter(quote_number__startswith="QT").order_by("-created_at").first()
            next_seq = 1
            if last_quote:
                import re

                match = re.search(r"QT(\d+)", last_quote.quote_number or "")
                if match:
                    try:
                        next_seq = int(match.group(1)) + 1
                    except ValueError:
                        next_seq = 1
            self.quote_number = f"QT{next_seq:05d}"
            while Quotation.objects.filter(quote_number=self.quote_number).exists():
                next_seq += 1
                self.quote_number = f"QT{next_seq:05d}"
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.quote_number} - {self.customer_name}"


class QuotationItem(models.Model):
    FG_TYPE_CHOICES = [
        ("POUCH", "Pouch"),
        ("ROLL", "Roll"),
    ]
    UOM_CHOICES = [
        ("PCS", "Pieces"),
        ("KG", "Kilograms"),
    ]
    PRICE_BASIS_CHOICES = [
        ("KG", "Per KG"),
        ("PCS", "Per PCS"),
    ]
    ROLL_FORM_CHOICES = [
        ("", "Not Applicable"),
        ("FLAT", "Flat"),
        ("FOLDED", "Folded"),
        ("TUBING", "Tubing"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    quotation = models.ForeignKey(Quotation, on_delete=models.CASCADE, related_name="items")
    template = models.ForeignKey(TemplateBlueprint, on_delete=models.PROTECT, null=True, blank=True)
    sku_variant = models.ForeignKey(
        "SalesSkuVariant",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="quotation_items",
    )
    line_name = models.CharField(max_length=255, blank=True, default="")
    finished_good_type = models.CharField(max_length=20, choices=FG_TYPE_CHOICES, default="POUCH")
    roll_form = models.CharField(max_length=20, choices=ROLL_FORM_CHOICES, blank=True, default="")
    qty_value = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    qty_uom = models.CharField(max_length=10, choices=UOM_CHOICES, default="PCS")
    price_basis = models.CharField(max_length=10, choices=PRICE_BASIS_CHOICES, default="KG")

    geometry_snapshot = models.JSONField(default=dict, blank=True)
    layer_snapshot = models.JSONField(default=list, blank=True)
    printing_snapshot = models.JSONField(default=dict, blank=True)
    chemicals_snapshot = models.JSONField(default=dict, blank=True)
    addons_snapshot = models.JSONField(default=list, blank=True)
    packaging_snapshot = models.JSONField(default=dict, blank=True)

    physics_snapshot = models.JSONField(default=dict, blank=True)
    bom_snapshot = models.JSONField(default=dict, blank=True)
    process_cost_rows = models.JSONField(default=list, blank=True)
    commercial_snapshot = models.JSONField(default=dict, blank=True)
    costing_snapshot = models.JSONField(default=dict, blank=True)

    unit_weight_g = models.DecimalField(max_digits=12, decimal_places=4, default=0)
    total_weight_kg = models.DecimalField(max_digits=12, decimal_places=4, default=0)
    quoted_unit_price = models.DecimalField(max_digits=12, decimal_places=4, default=0)
    quoted_line_total = models.DecimalField(max_digits=15, decimal_places=4, default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sales_quotation_items"
        ordering = ["created_at", "id"]

    def __str__(self):
        return f"{self.quotation.quote_number} - {self.line_name or self.finished_good_type}"
