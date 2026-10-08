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


class InwardBillIntake(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plant = models.ForeignKey("factory.Plant", on_delete=models.PROTECT, related_name="inward_bill_intakes")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="inward_bill_intakes")
    arrival_at = models.DateTimeField(default=timezone.now, db_index=True)
    status = models.CharField(max_length=16, default="PENDING_GRN", choices=[("PENDING_GRN", "Pending GRN"), ("PARTIAL_GRN", "Partially received"), ("RECEIPTED", "Receipted"), ("VOID", "Explained resolution")])
    content_hash = models.CharField(max_length=64, db_index=True)
    review_data = models.JSONField(default=dict, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="resolved_inward_bills")
    resolution_reason = models.CharField(max_length=500, blank=True)
    resolution_code = models.CharField(max_length=20, blank=True)
    duplicate_of = models.ForeignKey("self", on_delete=models.PROTECT, null=True, blank=True)

    class Meta:
        ordering = ["arrival_at", "id"]
        indexes = [models.Index(fields=["plant", "status", "arrival_at"])]
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
    kind = models.CharField(max_length=12, choices=[(kind, kind) for kind in ["BULK", "ROLL", "PACKAGING", "PO_RECEIPT", "TRADING"]])
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
