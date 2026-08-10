from decimal import Decimal

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
    margin_floor_pct = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        help_text=(
            "Customer-specific minimum margin % for this product. "
            "Wins over pouch-style and plant defaults in the quotation costing cascade."
        ),
    )
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
        if self.default_artwork_id:
            from apps.artwork.compatibility import product_master_print_context, validate_artwork_compatibility

            if str(getattr(self.default_artwork, 'status', '') or '').upper() != 'APPROVED':
                raise ValidationError({'default_artwork': 'Default artwork must be APPROVED.'})
            axis_values = self.axis_values if isinstance(self.axis_values, dict) else {}
            if self.size_variant_code and not axis_values.get('size'):
                axis_values = {**axis_values, 'size': self.size_variant_code}
            context = product_master_print_context(self.product_master, axis_values=axis_values)
            try:
                validate_artwork_compatibility(
                    self.default_artwork,
                    print_type=context["print_type"],
                    substrate_mode=context["substrate_mode"],
                    require_asset=False,
                )
            except ValidationError as exc:
                raise ValidationError({'default_artwork': f'Default artwork is not compatible with this Product Master: {exc}'}) from exc

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
    source_quotation_revision = models.OneToOneField(
        'Quotation',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='converted_order',
    )
    ship_to_customer = models.ForeignKey('Customer', on_delete=models.PROTECT, null=True, blank=True, related_name='ship_to_sales_orders')
    ship_to_customer_name = models.CharField(max_length=255, blank=True, default="")
    address_override = models.TextField(blank=True, default="")
    bill_to_address = models.TextField(blank=True, default="")
    ship_to_address = models.TextField(blank=True, default="")
    customer_po_reference = models.CharField(max_length=160, blank=True, default="")
    payment_terms = models.TextField(blank=True, default="")
    delivery_terms = models.TextField(blank=True, default="")
    currency = models.CharField(max_length=10, default="INR")
    quote_commercial_snapshot = models.JSONField(default=dict, blank=True)
    quote_cost_snapshot = models.JSONField(default=dict, blank=True)
    quote_acceptance_snapshot = models.JSONField(default=dict, blank=True)
    remarks = models.TextField(blank=True, default="")
    
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='DRAFT')
    execution_model_version = models.PositiveSmallIntegerField(
        default=2,
        validators=[MinValueValidator(2), MaxValueValidator(2)],
    )
    geometry_override = models.JSONField(default=dict, blank=True)
    commercial_confirmed_at = models.DateTimeField(null=True, blank=True)
    delivery_date = models.DateField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'sales_orders'
        indexes = [
            models.Index(fields=["status", "-created_at"], name="sales_so_status_created"),
            models.Index(fields=["customer_name", "-created_at"], name="sales_so_customer_created"),
            models.Index(fields=["status", "-completed_at"], name="sales_so_status_completed"),
        ]
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
    LINE_STATUS_CHOICES = [
        ('OPEN', 'Open'),
        ('PLANNING_REQUIRED', 'Planning Required'),
        ('PLANNED', 'Planned'),
        ('RELEASED', 'Released'),
        ('IN_PRODUCTION', 'In Production'),
        ('PACKING_READY', 'Packing Ready'),
        ('DISPATCH_READY', 'Dispatch Ready'),
        ('PARTIAL', 'Partial'),
        ('SHORT_CLOSED', 'Short Closed'),
        ('CANCELLED', 'Cancelled'),
        ('COMPLETED', 'Completed'),
    ]

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

    # ─ Final-model production-lane fields ────────────────────────────────
    preferred_lane_count = models.PositiveSmallIntegerField(
        default=1,
        help_text="How many lanes (N-up) this order runs at. Defaults to last successful order for same customer + size.",
    )
    planned_parent_width_mm = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Derived from child_target × preferred_lane + policy trim. Set at order confirm.",
    )
    lane_count_source = models.CharField(
        max_length=24,
        default="POLICY_DEFAULT",
        help_text="REPEAT_DEFAULT | OPERATOR_CHOICE | POLICY_DEFAULT",
    )
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
    quote_variant_snapshot = models.JSONField(
        default=dict,
        blank=True,
        help_text="Immutable quote-scoped configuration and Base Product Master lineage carried from the accepted quotation revision.",
    )
    quote_cost_snapshot = models.JSONField(default=dict, blank=True)
    bom_material_cost = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    bom_margin_pct = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)

    # Physics Results
    unit_weight_g = models.DecimalField(max_digits=16, decimal_places=6, default=0)
    total_weight_kg = models.DecimalField(max_digits=16, decimal_places=6, default=0)

    # Quantity
    qty_uom = models.CharField(max_length=10, choices=UOM_CHOICES, default='KG')
    qty_value = models.DecimalField(max_digits=12, decimal_places=2)
    price_basis = models.CharField(max_length=10, choices=PRICE_BASIS_CHOICES, default='KG')
    unit_price = models.DecimalField(max_digits=12, decimal_places=4, default=0)
    line_status = models.CharField(max_length=24, choices=LINE_STATUS_CHOICES, default='OPEN', db_index=True)
    qty_cancelled = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    qty_short_closed = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    line_closed_reason = models.TextField(blank=True, default="")
    line_closed_at = models.DateTimeField(null=True, blank=True)
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

    @property
    def qty_dispatched(self):
        """Sum of qty_dispatched across CustomerDispatchLines whose parent dispatch is
        CONFIRMED or DISPATCHED. Returns Decimal so callers can compare safely.
        """
        from decimal import Decimal
        total = Decimal("0")
        # Lazy access: dispatch_lines reverse relation appears once
        # apps/sales/models_dispatch.py is registered.
        try:
            lines = self.dispatch_lines.all()
        except Exception:
            return total
        for line in lines:
            parent_status = getattr(getattr(line, "dispatch", None), "status", "") or ""
            if str(parent_status).upper() in {"CONFIRMED", "DISPATCHED"}:
                total += Decimal(str(line.qty_dispatched or 0))
        return total

    @property
    def qty_open(self):
        """qty_value - dispatched - cancelled - short-closed, never negative."""
        from decimal import Decimal
        ordered = Decimal(str(self.qty_value or 0))
        cancelled = Decimal(str(self.qty_cancelled or 0))
        short_closed = Decimal(str(self.qty_short_closed or 0))
        return max(ordered - self.qty_dispatched - cancelled - short_closed, Decimal("0"))

    @property
    def qty_closed_without_dispatch(self):
        from decimal import Decimal
        return Decimal(str(self.qty_cancelled or 0)) + Decimal(str(self.qty_short_closed or 0))

    class Meta:
        db_table = 'sales_order_items'
        indexes = [
            models.Index(fields=["sales_order", "line_status"], name="sales_soi_order_status"),
            models.Index(fields=["product_master", "line_status"], name="sales_soi_pm_status"),
            models.Index(fields=["line_status", "-created_at"], name="sales_soi_status_created"),
        ]


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
        if self.template_id and (
            str(getattr(self.template, 'status', '') or '').upper() != 'LIVE'
            or not bool(getattr(self.template, 'is_current_version', False))
        ):
            raise ValidationError({'template': 'Sales SKU must link to the current LIVE template.'})

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
        ("PENDING_APPROVAL", "Pending Approval"),
        ("APPROVED", "Approved For Release"),
        ("SENT", "Sent"),
        ("ACCEPTED", "Accepted By Customer"),
        ("REJECTED", "Rejected"),
        ("EXPIRED", "Expired"),
        ("CANCELLED", "Cancelled"),
        ("VOID", "Void"),
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
    enquiry_reference = models.CharField(max_length=120, blank=True, default="")
    contact_name = models.CharField(max_length=255, blank=True, default="")
    contact_email = models.EmailField(blank=True, default="")
    contact_phone = models.CharField(max_length=40, blank=True, default="")
    billing_address = models.TextField(blank=True, default="")
    shipping_address = models.TextField(blank=True, default="")
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
    payment_terms = models.TextField(blank=True, default="")
    delivery_terms = models.TextField(blank=True, default="")
    requested_delivery_date = models.DateField(null=True, blank=True)
    place_of_supply = models.CharField(max_length=120, blank=True, default="")
    tax_snapshot = models.JSONField(default=dict, blank=True)
    notes = models.TextField(blank=True, default="")
    totals_snapshot = models.JSONField(default=dict, blank=True)
    converted_sales_order = models.ForeignKey(
        "SalesOrder",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="source_quotations",
    )
    parent_quotation = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="revisions",
    )
    revision_root_id = models.UUIDField(default=uuid.uuid4, db_index=True)
    revision_no = models.PositiveIntegerField(default=1)
    sent_at = models.DateTimeField(null=True, blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="approved_quotations",
    )
    # V37 deep workspace — commercials, lifecycle, rejection metadata
    discount_pct = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("0"))
    discount_amount = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    freight_amount = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    freight_included = models.BooleanField(default=True)
    other_charges = models.JSONField(
        default=list,
        blank=True,
        help_text="List of [{label, amount}] for tooling/samples/etc.",
    )
    custom_terms = models.TextField(blank=True, default="")
    gst_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("18"))
    status_history = models.JSONField(
        default=list,
        blank=True,
        help_text="Append-only [{status, at, by_id, by_name, note}].",
    )
    rejection_reason = models.TextField(blank=True, default="")
    sent_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="quotations_sent",
    )
    rejected_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="quotations_rejected",
    )
    accepted_at = models.DateTimeField(null=True, blank=True)
    accepted_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="quotations_acceptance_recorded",
    )
    acceptance_reference = models.CharField(max_length=160, blank=True, default="")
    acceptance_channel = models.CharField(max_length=40, blank=True, default="")
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="quotations_cancelled",
    )
    cancellation_reason = models.TextField(blank=True, default="")
    voided_at = models.DateTimeField(null=True, blank=True)
    voided_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="quotations_voided",
    )
    void_reason = models.TextField(blank=True, default="")
    frozen_at = models.DateTimeField(null=True, blank=True)
    frozen_snapshot = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sales_quotations"
        ordering = ["-updated_at", "-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["revision_root_id", "revision_no"],
                name="sales_quote_root_revision_unique",
            ),
        ]

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
    product_master = models.ForeignKey(
        "materials.ProductMaster",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="quotation_items",
    )
    product_master_size = models.ForeignKey(
        "materials.ProductMasterSize",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="quotation_items",
    )
    product_variant = models.ForeignKey(
        "materials.ProductVariant",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="quotation_items",
    )
    pouch_style_master = models.ForeignKey(
        "materials.PouchStyleMaster",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="quotation_items",
    )
    artwork = models.ForeignKey(
        "artwork.Artwork",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="quotation_items",
    )
    revised_from_item = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="revision_items",
    )
    converted_sales_order_item = models.OneToOneField(
        "SalesOrderItem",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="source_quotation_item",
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
    canonical_source_snapshot = models.JSONField(default=dict, blank=True)
    spec_signature = models.CharField(max_length=128, blank=True, default="", db_index=True)
    cost_snapshot_checksum = models.CharField(max_length=64, blank=True, default="")

    unit_weight_g = models.DecimalField(max_digits=16, decimal_places=6, default=0)
    total_weight_kg = models.DecimalField(max_digits=16, decimal_places=6, default=0)
    quoted_unit_price = models.DecimalField(max_digits=12, decimal_places=4, default=0)
    quoted_line_total = models.DecimalField(max_digits=15, decimal_places=4, default=0)

    LINE_KIND_CHOICES = [
        ("CATALOG", "Existing ready product / variant"),
        ("AD_HOC", "Quote-scoped variant under Base Product Master"),
    ]
    line_kind = models.CharField(
        max_length=12, choices=LINE_KIND_CHOICES, default="CATALOG"
    )
    spec_snapshot = models.JSONField(
        default=dict,
        blank=True,
        help_text=(
            "Immutable quote-scoped configuration derived from an existing Base Product Master. Shape: "
            "{ pouch_style_id, width_mm, height_mm, gusset_mm, flap_mm, "
            "layers: [{material_id, micron, gsm}], inks, adhesives, solvents, additives, "
            "addons, child_web_width_mm }. It never creates or mutates master data."
        ),
    )
    margin_lock = models.BooleanField(
        default=True,
        help_text=(
            "True = margin% pinned, rate computed. "
            "False = rate pinned, margin computed."
        ),
    )
    manual_rate_override = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        help_text=(
            "Operator-typed rate that overrides system suggestion. "
            "Stays even if cost changes underneath."
        ),
    )
    hsn_code = models.CharField(max_length=20, blank=True, default="")
    gst_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("0"))

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sales_quotation_items"
        ordering = ["created_at", "id"]

    def __str__(self):
        return f"{self.quotation.quote_number} - {self.line_name or self.finished_good_type}"


class QuotationCostSnapshot(models.Model):
    STATUS_CHOICES = [("DRAFT", "Draft"), ("FROZEN", "Frozen")]
    PRICING_DEFINITION_CHOICES = [
        ("MARKUP_ON_COST", "Markup On Cost"),
        ("GROSS_MARGIN_ON_SALES", "Gross Margin On Net Sales"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    quotation = models.OneToOneField(
        Quotation,
        on_delete=models.CASCADE,
        related_name="cost_build",
    )
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default="DRAFT")
    currency = models.CharField(max_length=10, default="INR")
    pricing_definition = models.CharField(
        max_length=32,
        choices=PRICING_DEFINITION_CHOICES,
        default="GROSS_MARGIN_ON_SALES",
    )
    target_percent = models.DecimalField(max_digits=8, decimal_places=4, default=Decimal("0"))
    material_cost = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal("0"))
    conversion_cost = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal("0"))
    total_cost = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal("0"))
    list_price = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal("0"))
    discount_amount = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal("0"))
    net_sale = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal("0"))
    tax_amount = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal("0"))
    rounding_amount = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal("0"))
    grand_total = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal("0"))
    contribution = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal("0"))
    markup_pct = models.DecimalField(max_digits=8, decimal_places=4, default=Decimal("0"))
    gross_margin_pct = models.DecimalField(max_digits=8, decimal_places=4, default=Decimal("0"))
    formula_version = models.CharField(max_length=40, default="QUOTE_COST_V2")
    sensitivity_snapshot = models.JSONField(default=dict, blank=True)
    readiness_snapshot = models.JSONField(default=dict, blank=True)
    source_snapshot = models.JSONField(default=dict, blank=True)
    effective_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    checksum = models.CharField(max_length=64, blank=True, default="", db_index=True)
    frozen_at = models.DateTimeField(null=True, blank=True)
    frozen_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="quotation_cost_snapshots_frozen",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sales_quotation_cost_snapshots"

    def save(self, *args, **kwargs):
        if self.pk:
            previous = type(self).objects.filter(pk=self.pk).only("status").first()
            if previous and previous.status == "FROZEN":
                raise ValidationError("A frozen quotation cost snapshot is immutable.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.status == "FROZEN":
            raise ValidationError("A frozen quotation cost snapshot cannot be deleted.")
        return super().delete(*args, **kwargs)


class QuotationCostComponent(models.Model):
    CATEGORY_CHOICES = [
        ("MATERIAL", "Raw Material"),
        ("PROCESS", "Machine / Process"),
        ("LABOUR", "Labour"),
        ("OVERHEAD", "Overhead"),
        ("WASTAGE", "Wastage / Yield"),
        ("PACKING", "Packing"),
        ("FREIGHT", "Freight"),
        ("OTHER", "Other"),
    ]
    SOURCE_CHOICES = [
        ("MATERIAL_COST_SNAPSHOT", "Material Cost Snapshot"),
        ("INVENTORY_FIFO", "Inventory FIFO Source"),
        ("INVENTORY_AVERAGE", "Inventory Average"),
        ("PROCESS_RATE", "Process Rate"),
        ("COST_POOL", "Plant Cost Pool"),
        ("PACKING_RECIPE", "Packing Recipe"),
        ("MASTER_POLICY", "Master Policy"),
        ("QUOTE_OVERRIDE", "Approved Quote Override"),
        ("MISSING", "Missing Source"),
    ]
    OVERRIDE_STATUS_CHOICES = [
        ("NOT_REQUIRED", "Not Required"),
        ("PENDING", "Pending Approval"),
        ("APPROVED", "Approved"),
        ("REJECTED", "Rejected"),
    ]
    READINESS_CHOICES = [
        ("READY", "Ready"),
        ("PENDING_APPROVAL", "Pending Approval"),
        ("MISSING_SOURCE", "Missing Source"),
        ("EXPIRED", "Expired"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    cost_snapshot = models.ForeignKey(
        QuotationCostSnapshot,
        on_delete=models.CASCADE,
        related_name="components",
    )
    quotation_item = models.ForeignKey(
        QuotationItem,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="cost_components",
    )
    sequence = models.PositiveIntegerField(default=1)
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES)
    role = models.CharField(max_length=40, blank=True, default="")
    label = models.CharField(max_length=180)
    material = models.ForeignKey(
        "materials.InventoryMaterial",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="quotation_cost_components",
    )
    material_cost_snapshot = models.ForeignKey(
        "costing.MaterialCostSnapshot",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="quotation_cost_components",
    )
    process = models.ForeignKey(
        "factory.Process",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="quotation_cost_components",
    )
    machine = models.ForeignKey(
        "factory.Machine",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="quotation_cost_components",
    )
    process_cost_rate = models.ForeignKey(
        "costing.ProcessCostRate",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="quotation_cost_components",
    )
    source_type = models.CharField(max_length=32, choices=SOURCE_CHOICES, default="MISSING")
    source_ref = models.CharField(max_length=180, blank=True, default="")
    source_version = models.CharField(max_length=80, blank=True, default="")
    source_lot_ref = models.CharField(max_length=120, blank=True, default="")
    source_effective_at = models.DateTimeField(null=True, blank=True)
    source_expires_at = models.DateTimeField(null=True, blank=True)
    baseline_quantity = models.DecimalField(max_digits=18, decimal_places=6, default=Decimal("0"))
    baseline_uom = models.CharField(max_length=16, blank=True, default="")
    baseline_rate = models.DecimalField(max_digits=18, decimal_places=6, default=Decimal("0"))
    baseline_available_qty = models.DecimalField(max_digits=18, decimal_places=6, default=Decimal("0"))
    quote_quantity = models.DecimalField(max_digits=18, decimal_places=6, default=Decimal("0"))
    quote_uom = models.CharField(max_length=16, blank=True, default="")
    effective_rate = models.DecimalField(max_digits=18, decimal_places=6, default=Decimal("0"))
    component_cost = models.DecimalField(max_digits=18, decimal_places=6, default=Decimal("0"))
    override_rate = models.DecimalField(max_digits=18, decimal_places=6, null=True, blank=True)
    override_reason = models.TextField(blank=True, default="")
    override_status = models.CharField(
        max_length=20,
        choices=OVERRIDE_STATUS_CHOICES,
        default="NOT_REQUIRED",
    )
    override_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="quotation_cost_overrides_entered",
    )
    override_at = models.DateTimeField(null=True, blank=True)
    override_expires_at = models.DateTimeField(null=True, blank=True)
    override_approved_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="quotation_cost_overrides_approved",
    )
    override_approved_at = models.DateTimeField(null=True, blank=True)
    readiness_status = models.CharField(
        max_length=24,
        choices=READINESS_CHOICES,
        default="MISSING_SOURCE",
    )
    provenance = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sales_quotation_cost_components"
        ordering = ["sequence", "created_at"]
        indexes = [
            models.Index(fields=["cost_snapshot", "category", "sequence"], name="sales_qcost_snap_cat_seq"),
            models.Index(fields=["material", "source_effective_at"], name="sales_qcost_mat_effective"),
        ]

    def clean(self):
        if self.category == "MATERIAL" and not self.material_id:
            raise ValidationError({"material": "Material cost components must reference the RM master."})
        if self.override_rate is not None:
            if not self.override_reason.strip():
                raise ValidationError({"override_reason": "Quote cost overrides require a reason."})
            if not self.override_by_id or not self.override_at or not self.override_expires_at:
                raise ValidationError("Quote cost overrides require actor, timestamp, and expiry.")

    def save(self, *args, **kwargs):
        if self.cost_snapshot_id:
            snapshot_status = QuotationCostSnapshot.objects.filter(pk=self.cost_snapshot_id).values_list("status", flat=True).first()
            if snapshot_status == "FROZEN":
                raise ValidationError("Components in a frozen quotation cost snapshot are immutable.")
        self.full_clean()
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.cost_snapshot.status == "FROZEN":
            raise ValidationError("Components in a frozen quotation cost snapshot cannot be deleted.")
        return super().delete(*args, **kwargs)


class QuotationApproval(models.Model):
    GATE_CHOICES = [
        ("COMMERCIAL", "Commercial"),
        ("FINANCE", "Finance / Credit"),
        ("ENGINEERING", "Engineering"),
        ("DELIVERY", "Delivery Commitment"),
    ]
    STATUS_CHOICES = [
        ("PENDING", "Pending"),
        ("APPROVED", "Approved"),
        ("REJECTED", "Rejected"),
        ("NOT_REQUIRED", "Not Required"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    quotation = models.ForeignKey(Quotation, on_delete=models.CASCADE, related_name="approval_gates")
    gate = models.CharField(max_length=24, choices=GATE_CHOICES)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="PENDING")
    reason = models.TextField(blank=True, default="")
    requested_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="quotation_approvals_requested",
    )
    requested_at = models.DateTimeField(auto_now_add=True)
    decided_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="quotation_approvals_decided",
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    snapshot_checksum = models.CharField(max_length=64, blank=True, default="")

    class Meta:
        db_table = "sales_quotation_approvals"
        constraints = [
            models.UniqueConstraint(fields=["quotation", "gate"], name="sales_quote_gate_unique"),
        ]


class QuotationArtifact(models.Model):
    TYPE_CHOICES = [("CLIENT_PDF", "Client PDF"), ("INTERNAL_PDF", "Internal PDF")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    quotation = models.ForeignKey(Quotation, on_delete=models.PROTECT, related_name="artifacts")
    artifact_type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    filename = models.CharField(max_length=255)
    content_type = models.CharField(max_length=80, default="application/pdf")
    byte_length = models.PositiveBigIntegerField(default=0)
    checksum = models.CharField(max_length=64, db_index=True)
    provenance = models.JSONField(default=dict, blank=True)
    generated_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="quotation_artifacts_generated",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "sales_quotation_artifacts"
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        if self.pk and type(self).objects.filter(pk=self.pk).exists():
            raise ValidationError("Quotation artifacts are immutable.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Quotation artifacts cannot be deleted; void the quotation instead.")


class QuotationDelivery(models.Model):
    CHANNEL_CHOICES = [("EMAIL", "Email"), ("SECURE_LINK", "Secure Link"), ("PDF_RELEASE", "PDF Release")]
    STATUS_CHOICES = [("PENDING", "Pending"), ("DELIVERED", "Delivered"), ("FAILED", "Failed")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    quotation = models.ForeignKey(Quotation, on_delete=models.PROTECT, related_name="deliveries")
    artifact = models.ForeignKey(QuotationArtifact, on_delete=models.PROTECT, related_name="deliveries")
    channel = models.CharField(max_length=20, choices=CHANNEL_CHOICES)
    recipient = models.CharField(max_length=255)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="PENDING")
    provider = models.CharField(max_length=40, blank=True, default="")
    provider_message_id = models.CharField(max_length=160, blank=True, default="")
    idempotency_key = models.CharField(max_length=180, unique=True)
    attempted_at = models.DateTimeField(auto_now_add=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    error_text = models.TextField(blank=True, default="")
    requested_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="quotation_deliveries_requested",
    )

    class Meta:
        db_table = "sales_quotation_deliveries"
        ordering = ["-attempted_at"]


class QuotationAcceptance(models.Model):
    OUTCOME_CHOICES = [("ACCEPTED", "Accepted"), ("REJECTED", "Rejected")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    quotation = models.OneToOneField(Quotation, on_delete=models.PROTECT, related_name="client_outcome")
    outcome = models.CharField(max_length=20, choices=OUTCOME_CHOICES)
    reference = models.CharField(max_length=160, blank=True, default="")
    channel = models.CharField(max_length=40, blank=True, default="")
    reason = models.TextField(blank=True, default="")
    received_at = models.DateTimeField()
    recorded_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="quotation_outcomes_recorded",
    )
    snapshot_checksum = models.CharField(max_length=64)

    class Meta:
        db_table = "sales_quotation_acceptances"


class QuotationAuditEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    quotation = models.ForeignKey(Quotation, on_delete=models.PROTECT, related_name="audit_events")
    event_type = models.CharField(max_length=60, db_index=True)
    note = models.TextField(blank=True, default="")
    before_snapshot = models.JSONField(default=dict, blank=True)
    after_snapshot = models.JSONField(default=dict, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    actor = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="quotation_audit_events",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "sales_quotation_audit_events"
        ordering = ["created_at", "id"]

    def save(self, *args, **kwargs):
        if self.pk and type(self).objects.filter(pk=self.pk).exists():
            raise ValidationError("Quotation audit events are append-only.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Quotation audit events cannot be deleted.")


class QuotationActualVariance(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    quotation_item = models.OneToOneField(
        QuotationItem,
        on_delete=models.PROTECT,
        related_name="actual_variance",
    )
    sales_order_item = models.OneToOneField(
        SalesOrderItem,
        on_delete=models.PROTECT,
        related_name="quotation_variance",
    )
    quoted_material_cost = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal("0"))
    quoted_conversion_cost = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal("0"))
    quoted_total_cost = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal("0"))
    actual_material_cost = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal("0"))
    actual_conversion_cost = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal("0"))
    actual_total_cost = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal("0"))
    variance_amount = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal("0"))
    variance_percent = models.DecimalField(max_digits=10, decimal_places=4, default=Decimal("0"))
    actual_coverage_pct = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal("0"))
    source_snapshot = models.JSONField(default=dict, blank=True)
    calculated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sales_quotation_actual_variances"


# Trade Orders — resale flow, kept separate from manufacturing sales orders.
from apps.sales.models_trade import *  # noqa: E402,F401,F403

# CustomerDispatch — Sprint 2 lifecycle closure.
from apps.sales.models_dispatch import *  # noqa: E402,F401,F403
