import uuid
from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone


class GateAssignment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="gate_assignments")
    plant = models.ForeignKey("factory.Plant", on_delete=models.CASCADE, related_name="gate_assignments")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "plant"], name="gate_user_plant_unique")]


class GatePublicLink(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plant = models.OneToOneField("factory.Plant", on_delete=models.CASCADE, related_name="gate_public_link")
    token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)


class GoodsMovement(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plant = models.ForeignKey("factory.Plant", on_delete=models.PROTECT, related_name="gate_movements")
    direction = models.CharField(max_length=8, choices=[("INWARD", "Inward"), ("OUTWARD", "Outward")])
    invoice_number = models.CharField(max_length=80)
    invoice_normalized = models.CharField(max_length=80)
    invoice_date = models.DateField(null=True, blank=True)
    invoice_year = models.PositiveIntegerField()
    vehicle_number = models.CharField(max_length=40)
    party_kind = models.CharField(max_length=8, choices=[("VENDOR", "Vendor"), ("CUSTOMER", "Customer")])
    party_id = models.UUIDField()
    party_name = models.CharField(max_length=255)
    document_kind = models.CharField(max_length=20, blank=True)
    document_id = models.UUIDField(null=True, blank=True)
    document_snapshot = models.JSONField(default=dict, blank=True)
    reconciliation_status = models.CharField(max_length=16, default="UNMATCHED", choices=[("UNMATCHED", "Unmatched"), ("MATCHED", "Matched"), ("DISCREPANCY", "Discrepancy")])
    discrepancies = models.JSONField(default=list, blank=True)
    notes = models.CharField(max_length=500, blank=True)
    logged_at = models.DateTimeField(default=timezone.now, db_index=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="gate_movements")

    class Meta:
        ordering = ["-logged_at", "-id"]
        indexes = [models.Index(fields=["plant", "logged_at"]), models.Index(fields=["reconciliation_status", "logged_at"])]
        constraints = [models.UniqueConstraint(fields=["plant", "direction", "party_kind", "party_id", "invoice_normalized", "invoice_year"], name="gate_invoice_unique"), models.UniqueConstraint(fields=["plant", "direction", "document_kind", "document_id"], condition=Q(document_id__isnull=False), name="gate_document_unique")]


class GoodsLine(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    movement = models.ForeignKey(GoodsMovement, on_delete=models.PROTECT, related_name="lines")
    product_kind = models.CharField(max_length=12, choices=[("MATERIAL", "Material"), ("PRODUCT", "Product"), ("TRADING", "Trading good"), ("CONSUMABLE", "Consumable")])
    product_id = models.UUIDField()
    product_name = models.CharField(max_length=255)
    quantity = models.DecimalField(max_digits=16, decimal_places=4)
    uom = models.CharField(max_length=10)
    amount = models.DecimalField(max_digits=16, decimal_places=2, null=True, blank=True)

    class Meta:
        constraints = [models.CheckConstraint(condition=Q(quantity__gt=0), name="gate_line_quantity_positive"), models.CheckConstraint(condition=Q(amount__isnull=True) | Q(amount__gte=0), name="gate_line_amount_nonnegative")]


class VisitorVisit(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plant = models.ForeignKey("factory.Plant", on_delete=models.PROTECT, related_name="gate_visitors")
    name = models.CharField(max_length=120)
    mobile = models.CharField(max_length=16)
    purpose = models.CharField(max_length=80)
    company = models.CharField(max_length=160, blank=True)
    government_id_type = models.CharField(max_length=8, blank=True)
    government_id_encrypted = models.TextField(blank=True)
    government_id_suffix = models.CharField(max_length=4, blank=True)
    selfie_data = models.BinaryField(null=True, blank=True)
    source = models.CharField(max_length=12, default="PUBLIC", choices=[("PUBLIC", "Public QR"), ("OWNER", "Owner recovery"), ("WATCHMAN", "Legacy watchman")])
    status = models.CharField(max_length=10, default="PENDING", choices=[("PENDING", "Pending"), ("INSIDE", "Inside"), ("EXITED", "Exited"), ("CANCELLED", "Cancelled")])
    submitted_at = models.DateTimeField(default=timezone.now, db_index=True)
    consent_at = models.DateTimeField()
    entry_at = models.DateTimeField(null=True, blank=True)
    exit_at = models.DateTimeField(null=True, blank=True)
    entry_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="gate_visitor_entries")
    exit_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="gate_visitor_exits")

    class Meta:
        ordering = ["-submitted_at", "-id"]
        indexes = [models.Index(fields=["plant", "status", "submitted_at"])]
        constraints = [models.UniqueConstraint(fields=["plant", "mobile"], condition=Q(status__in=["PENDING", "INSIDE"]), name="gate_active_visitor_unique"), models.CheckConstraint(condition=Q(exit_at__isnull=True) | (Q(entry_at__isnull=False) & Q(exit_at__gte=models.F("entry_at"))), name="gate_exit_after_entry")]


class ImmutableQuerySet(models.QuerySet):
    def update(self, **kwargs):
        raise TypeError("Gate audit history is append-only.")

    def delete(self):
        raise TypeError("Gate audit history is append-only.")


class GateAuditEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plant = models.ForeignKey("factory.Plant", on_delete=models.PROTECT, related_name="gate_audit_events")
    object_id = models.UUIDField(db_index=True)
    object_type = models.CharField(max_length=12)
    action = models.CharField(max_length=24)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="gate_audit_events")
    reason = models.CharField(max_length=500, blank=True)
    before = models.JSONField(default=dict, blank=True)
    after = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(default=timezone.now, editable=False)
    objects = ImmutableQuerySet.as_manager()

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["plant", "created_at"])]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise TypeError("Gate audit history is append-only.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise TypeError("Gate audit history is append-only.")


class GateRequestReceipt(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    scope = models.CharField(max_length=128)
    token = models.UUIDField()
    fingerprint = models.CharField(max_length=64)
    response = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["scope", "token"], name="gate_request_unique")]


class GatePublicRateBucket(models.Model):
    key = models.CharField(max_length=100, primary_key=True)
    count = models.PositiveIntegerField(default=0)
    expires_at = models.DateTimeField(db_index=True)


DOCUMENT_SOURCES = [("GATE", "Gate arrival"), ("OFFICE", "Received at office")]
DOCUMENT_TYPES = [
    ("TAX_INVOICE", "Tax invoice"),
    ("DELIVERY_CHALLAN", "Delivery challan"),
    ("LR_TRANSPORT", "Transport LR / consignment note"),
    ("DEBIT_NOTE", "Debit note"),
    ("CREDIT_NOTE", "Credit note"),
    ("SERVICE_REPORT", "Service report"),
    ("UTILITY_BILL", "Utility bill"),
    ("OTHER", "Other document"),
]
DOCUMENT_CATEGORIES = [
    ("STOCK", "Stock items (GRN)"),
    ("JOBWORK", "Job work"),
    ("SPARES", "Spares and parts"),
    ("MACHINERY", "Machinery and equipment"),
    ("SERVICE", "Service / repair"),
    ("UTILITY", "Utility"),
    ("PROFESSIONAL_STATUTORY", "Professional / statutory fee"),
    ("TRANSPORT", "Transport / freight"),
    ("OTHER_EXPENSE", "Other expense"),
]
# Categories that finish by filing the paper as a record (no receipt needed).
RECORD_ONLY_CATEGORIES = {"UTILITY", "PROFESSIONAL_STATUTORY", "TRANSPORT", "OTHER_EXPENSE"}
# Categories that finish with a General Receipt (goods/service confirmation).
GENERAL_RECEIPT_CATEGORIES = {"SPARES", "MACHINERY", "SERVICE"}


class InwardBillIntake(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plant = models.ForeignKey("factory.Plant", on_delete=models.PROTECT, related_name="inward_bill_intakes")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="inward_bill_intakes")
    arrival_at = models.DateTimeField(default=timezone.now, db_index=True)
    status = models.CharField(max_length=16, default="PENDING_GRN", choices=[("PENDING_GRN", "Pending GRN"), ("PARTIAL_GRN", "Partially received"), ("RECEIPTED", "Receipted"), ("FILED", "Filed as record"), ("VOID", "Explained resolution")])
    content_hash = models.CharField(max_length=64, db_index=True)
    review_data = models.JSONField(default=dict, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="resolved_inward_bills")
    resolution_reason = models.CharField(max_length=500, blank=True)
    resolution_code = models.CharField(max_length=20, blank=True)
    duplicate_of = models.ForeignKey("self", on_delete=models.PROTECT, null=True, blank=True)
    # Document register header. Arrival evidence above stays immutable (DB
    # trigger); these office-entered fields describe the paper and may be
    # corrected with audit. New NOT NULL columns carry db_default so a
    # rolled-back application image can still insert arrivals.
    source = models.CharField(max_length=8, choices=DOCUMENT_SOURCES, default="GATE", db_default="GATE")
    doc_type = models.CharField(max_length=20, choices=DOCUMENT_TYPES, blank=True, default="", db_default="")
    category = models.CharField(max_length=24, choices=DOCUMENT_CATEGORIES, blank=True, default="", db_default="")
    vendor = models.ForeignKey("inventory.Vendor", on_delete=models.PROTECT, null=True, blank=True, related_name="inward_documents")
    party_name = models.CharField(max_length=255, blank=True, default="", db_default="")
    invoice_number = models.CharField(max_length=80, blank=True, default="", db_default="")
    invoice_normalized = models.CharField(max_length=80, blank=True, default="", db_default="", db_index=True)
    invoice_date = models.DateField(null=True, blank=True)
    invoice_fy = models.PositiveIntegerField(null=True, blank=True)
    taxable_amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    tax_amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    total_amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    due_date = models.DateField(null=True, blank=True)
    valid_until = models.DateField(null=True, blank=True)
    ship_to_plant = models.ForeignKey("factory.Plant", on_delete=models.PROTECT, null=True, blank=True, related_name="ship_to_inward_documents")
    attached_to = models.ForeignKey("self", on_delete=models.PROTECT, null=True, blank=True, related_name="supporting_documents")
    classified_at = models.DateTimeField(null=True, blank=True)
    classified_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="classified_inward_documents")
    header_version = models.PositiveIntegerField(default=0, db_default=0)

    class Meta:
        ordering = ["arrival_at", "id"]
        indexes = [
            models.Index(fields=["plant", "status", "arrival_at"]),
            models.Index(fields=["vendor", "invoice_normalized", "invoice_fy"], name="bill_vendor_invoice_idx"),
            models.Index(fields=["category", "status", "arrival_at"], name="bill_category_status_idx"),
            models.Index(fields=["plant", "source", "arrival_at"], name="bill_plant_source_idx"),
        ]
        constraints = [models.CheckConstraint(condition=Q(status__in=["PENDING_GRN", "PARTIAL_GRN"]) | Q(resolved_at__isnull=False), name="bill_resolution_timestamp")]


class InwardBillPage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    intake = models.ForeignKey(InwardBillIntake, on_delete=models.PROTECT, related_name="pages")
    page_number = models.PositiveSmallIntegerField()
    data = models.BinaryField()
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()
    byte_size = models.PositiveIntegerField()
    sha256 = models.CharField(max_length=64)
    objects = ImmutableQuerySet.as_manager()

    class Meta:
        ordering = ["page_number"]
        constraints = [models.UniqueConstraint(fields=["intake", "page_number"], name="bill_page_order_unique")]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise TypeError("Bill images are immutable.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise TypeError("Bill images are immutable.")


class InwardBillReceiptReference(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    intake = models.ForeignKey(InwardBillIntake, on_delete=models.PROTECT, related_name="receipt_references")
    kind = models.CharField(max_length=16, choices=[(kind, kind) for kind in ["BULK", "ROLL", "PACKAGING", "PO_RECEIPT", "TRADING", "GENERAL_RECEIPT", "JOBWORK_RETURN"]])
    object_id = models.UUIDField()
    snapshot = models.JSONField(default=dict)
    linked_at = models.DateTimeField(default=timezone.now)
    linked_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    objects = ImmutableQuerySet.as_manager()

    class Meta:
        ordering = ["linked_at", "id"]
        constraints = [models.UniqueConstraint(fields=["kind", "object_id"], name="bill_receipt_source_unique")]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise TypeError("Bill receipt references are immutable.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise TypeError("Bill receipt references are immutable.")


class DocumentPageView(models.Model):
    """Shared, mutable reading preference for an immutable page (bytes never change)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    page_kind = models.CharField(max_length=8, choices=[("INWARD", "Inward page"), ("OUTWARD", "Outward page")])
    page_id = models.UUIDField()
    display_rotation = models.PositiveSmallIntegerField(default=0)
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="document_page_views")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["page_kind", "page_id"], name="document_page_view_unique"),
            models.CheckConstraint(condition=Q(display_rotation__in=[0, 90, 180, 270]), name="document_page_rotation_valid"),
        ]


class DocumentOriginalFile(models.Model):
    """Original uploaded file (e.g. office PDF) kept as evidence beside its rendered pages."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    intake = models.ForeignKey(InwardBillIntake, on_delete=models.PROTECT, related_name="original_files")
    file_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=80)
    byte_size = models.PositiveIntegerField()
    sha256 = models.CharField(max_length=64)
    page_count = models.PositiveSmallIntegerField()
    data = models.BinaryField()
    created_at = models.DateTimeField(default=timezone.now)
    objects = ImmutableQuerySet.as_manager()

    class Meta:
        ordering = ["created_at", "id"]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise TypeError("Original documents are immutable.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise TypeError("Original documents are immutable.")


class DocumentSequence(models.Model):
    """Gap-tolerant per financial-year counters for office documents (GR, RGP, NRGP, JWC...)."""
    key = models.CharField(max_length=24)
    fiscal_year = models.PositiveIntegerField()
    last_value = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["key", "fiscal_year"], name="document_sequence_unique")]


OUTWARD_STATUSES = [("PENDING_MATCH", "Pending match"), ("MATCHED", "Matched"), ("DISCREPANCY", "Discrepancy"), ("VOID", "Voided")]
OUTWARD_LINK_KINDS = [
    ("SALES_DC", "Sales delivery challan"),
    ("CUSTOMER_DISPATCH", "Customer dispatch / invoice"),
    ("TRADE_ORDER", "Trade order invoice"),
    ("INTERPLANT_DC", "Inter-plant challan"),
    ("JOBWORK_CHALLAN", "Job-work challan"),
    ("GATE_PASS", "Gate pass (RGP / NRGP)"),
    ("OTHER", "Other / unlisted document"),
]


class OutwardDocument(models.Model):
    """Watchman photo record of paper leaving the gate. Never moves stock."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plant = models.ForeignKey("factory.Plant", on_delete=models.PROTECT, related_name="outward_documents")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="outward_documents")
    departed_at = models.DateTimeField(default=timezone.now, db_index=True)
    content_hash = models.CharField(max_length=64, db_index=True)
    vehicle_number = models.CharField(max_length=40, blank=True, default="")
    scanned_refs = models.JSONField(default=list, blank=True)
    status = models.CharField(max_length=16, choices=OUTWARD_STATUSES, default="PENDING_MATCH")
    notes = models.CharField(max_length=500, blank=True, default="")
    matched_at = models.DateTimeField(null=True, blank=True)
    matched_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="matched_outward_documents")
    resolution_reason = models.CharField(max_length=500, blank=True, default="")
    discrepancies = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["-departed_at", "-id"]
        indexes = [models.Index(fields=["plant", "status", "departed_at"], name="outward_plant_status_idx")]


class OutwardDocumentPage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(OutwardDocument, on_delete=models.PROTECT, related_name="pages")
    page_number = models.PositiveSmallIntegerField()
    data = models.BinaryField()
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()
    byte_size = models.PositiveIntegerField()
    sha256 = models.CharField(max_length=64)
    objects = ImmutableQuerySet.as_manager()

    class Meta:
        ordering = ["page_number"]
        constraints = [models.UniqueConstraint(fields=["document", "page_number"], name="outward_page_order_unique")]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise TypeError("Outward document images are immutable.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise TypeError("Outward document images are immutable.")


class OutwardDocumentLink(models.Model):
    """Append-only link from a departure record to the ERP document it carried.
    A wrong link is removed by stamping removed_* (kept for audit), never deleted."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(OutwardDocument, on_delete=models.PROTECT, related_name="links")
    kind = models.CharField(max_length=20, choices=OUTWARD_LINK_KINDS)
    object_id = models.UUIDField(null=True, blank=True)
    reference = models.CharField(max_length=120, blank=True, default="")
    snapshot = models.JSONField(default=dict, blank=True)
    link_source = models.CharField(max_length=8, choices=[("QR", "QR scan"), ("MANUAL", "Office match")], default="MANUAL")
    linked_at = models.DateTimeField(default=timezone.now)
    linked_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="outward_links")
    removed_at = models.DateTimeField(null=True, blank=True)
    removed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="removed_outward_links")
    removed_reason = models.CharField(max_length=500, blank=True, default="")

    class Meta:
        ordering = ["linked_at", "id"]
        indexes = [models.Index(fields=["kind", "object_id"], name="outward_link_object_idx")]
        constraints = [models.UniqueConstraint(fields=["document", "kind", "object_id"], condition=Q(removed_at__isnull=True, object_id__isnull=False), name="outward_link_active_unique")]


GATE_PASS_KINDS = [("RETURNABLE", "Returnable gate pass (RGP)"), ("NON_RETURNABLE", "Non-returnable gate pass (NRGP)")]
GATE_PASS_PURPOSES = [
    ("REPAIR", "Repair"),
    ("CALIBRATION", "Calibration"),
    ("FABRICATION", "Fabrication / machining"),
    ("TRIAL", "Trial / testing"),
    ("LOAN", "Loan / demo"),
    ("SCRAP_SALE", "Scrap sale"),
    ("SAMPLE", "Sample"),
    ("RETURN_TO_SUPPLIER", "Return to supplier"),
    ("OTHER", "Other"),
]
GATE_PASS_STATUSES = [
    ("DRAFT", "Draft"),
    ("ISSUED", "Issued, waiting at gate"),
    ("OUT", "Out of factory"),
    ("PARTLY_RETURNED", "Partly returned"),
    ("RETURNED", "Returned"),
    ("CLOSED", "Closed"),
    ("SHORT_CLOSED", "Short-closed"),
    ("CANCELLED", "Cancelled"),
]


class GatePass(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    number = models.CharField(max_length=32, unique=True)
    kind = models.CharField(max_length=16, choices=GATE_PASS_KINDS)
    plant = models.ForeignKey("factory.Plant", on_delete=models.PROTECT, related_name="gate_passes")
    vendor = models.ForeignKey("inventory.Vendor", on_delete=models.PROTECT, null=True, blank=True, related_name="gate_passes")
    party_name = models.CharField(max_length=255)
    party_address = models.TextField(blank=True, default="")
    party_gstin = models.CharField(max_length=20, blank=True, default="")
    purpose = models.CharField(max_length=24, choices=GATE_PASS_PURPOSES)
    expected_return_date = models.DateField(null=True, blank=True)
    vehicle_number = models.CharField(max_length=40, blank=True, default="")
    carried_by = models.CharField(max_length=120, blank=True, default="")
    status = models.CharField(max_length=16, choices=GATE_PASS_STATUSES, default="DRAFT")
    notes = models.CharField(max_length=500, blank=True, default="")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_gate_passes")
    created_at = models.DateTimeField(default=timezone.now)
    issued_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="issued_gate_passes")
    issued_at = models.DateTimeField(null=True, blank=True)
    out_at = models.DateTimeField(null=True, blank=True)
    closed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="closed_gate_passes")
    closed_at = models.DateTimeField(null=True, blank=True)
    close_reason = models.CharField(max_length=500, blank=True, default="")
    version = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["plant", "status", "created_at"], name="gate_pass_plant_status_idx")]
        constraints = [models.CheckConstraint(condition=Q(kind="NON_RETURNABLE") | Q(expected_return_date__isnull=False) | Q(status__in=["DRAFT", "CANCELLED"]), name="gate_pass_rgp_return_date")]


class GatePassLine(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    gate_pass = models.ForeignKey(GatePass, on_delete=models.PROTECT, related_name="lines")
    line_no = models.PositiveSmallIntegerField()
    description = models.CharField(max_length=255)
    quantity = models.DecimalField(max_digits=14, decimal_places=3)
    uom = models.CharField(max_length=10)
    machine = models.ForeignKey("factory.Machine", on_delete=models.PROTECT, null=True, blank=True, related_name="gate_pass_lines")
    equipment_text = models.CharField(max_length=160, blank=True, default="")
    serial_no = models.CharField(max_length=80, blank=True, default="")
    approx_value = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    returned_quantity = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    remarks = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        ordering = ["line_no"]
        constraints = [
            models.UniqueConstraint(fields=["gate_pass", "line_no"], name="gate_pass_line_unique"),
            models.CheckConstraint(condition=Q(quantity__gt=0), name="gate_pass_line_qty_positive"),
            models.CheckConstraint(condition=Q(returned_quantity__gte=0) & Q(returned_quantity__lte=models.F("quantity")), name="gate_pass_line_returned_bounds"),
        ]


class GatePassReturn(models.Model):
    """Append-only return event for an RGP line (from a General Receipt line or direct receipt)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    line = models.ForeignKey(GatePassLine, on_delete=models.PROTECT, related_name="returns")
    quantity = models.DecimalField(max_digits=14, decimal_places=3)
    returned_at = models.DateTimeField(default=timezone.now)
    received_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="gate_pass_returns")
    general_receipt_line_id = models.UUIDField(null=True, blank=True)
    inward_document = models.ForeignKey(InwardBillIntake, on_delete=models.PROTECT, null=True, blank=True, related_name="gate_pass_returns")
    notes = models.CharField(max_length=500, blank=True, default="")
    objects = ImmutableQuerySet.as_manager()

    class Meta:
        ordering = ["returned_at", "id"]
        constraints = [models.CheckConstraint(condition=Q(quantity__gt=0), name="gate_pass_return_qty_positive")]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise TypeError("Gate pass returns are append-only.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise TypeError("Gate pass returns are append-only.")
