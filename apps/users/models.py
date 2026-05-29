from django.db import models
from django.contrib.auth.models import AbstractUser
import uuid

class Role(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=50, unique=True) # OWNER, ADMIN, SALES, etc.
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    
    # Base Permissions (JSON list of codes)
    default_permissions = models.JSONField(default=list, blank=True)

    def __str__(self):
        return self.name

    class Meta:
        db_table = 'users_roles'

class User(AbstractUser):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    role = models.ForeignKey(Role, on_delete=models.SET_NULL, null=True, blank=True, related_name='users')
    phone_number = models.CharField(max_length=30, blank=True, default="")
    avatar_url = models.URLField(blank=True, default="")
    
    # Entitlements
    is_owner = models.BooleanField(default=False)
    extra_permissions = models.JSONField(default=list, blank=True) # Additive permissions
    
    # Context (Deprecated direct fields, use Assignments)
    # Keeping for migration if needed, but logic should use assignments
    
    class Meta:
        db_table = 'users_custom'

    def __str__(self):
        return f"{self.username} ({self.role.code if self.role else 'NO ROLE'})"


class UserProfileChangeRequest(models.Model):
    STATUS_CHOICES = [
        ("PENDING", "Pending"),
        ("APPROVED", "Approved"),
        ("REJECTED", "Rejected"),
        ("CANCELLED", "Cancelled"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    requested_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name="profile_change_requests")
    target_user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="profile_change_targets")
    requested_changes = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="PENDING")
    review_notes = models.TextField(blank=True)
    reviewed_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="profile_change_reviews",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "users_profile_change_requests"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "created_at"]),
            models.Index(fields=["target_user", "created_at"]),
        ]

    def __str__(self):
        return f"{self.target_user.username} [{self.status}]"

class WorkCenterAssignment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='assigned_work_centers')
    work_center = models.ForeignKey('factory.WorkCenter', on_delete=models.CASCADE, related_name='assignees')
    
    class Meta:
        db_table = 'users_wc_assignments'
        unique_together = ['user', 'work_center']

class MachineAssignment(models.Model):
    """
    Operator-Machine Assignment
    
    Rules:
    - One operator can have MANY machines
    - Must belong to ONE work center
    - Can ONLY be assigned machines from that same work center
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='assigned_machines')
    machine = models.ForeignKey('factory.Machine', on_delete=models.CASCADE, related_name='assignees')
    
    class Meta:
        db_table = 'users_machine_assignments'
        unique_together = ['user', 'machine']

    def clean(self):
        from django.core.exceptions import ValidationError
        
        # Get user's assigned work centers
        user_wc_ids = set(
            str(wc_id) for wc_id in 
            self.user.assigned_work_centers.values_list('work_center_id', flat=True)
        )
        
        # If user has work center assignments, enforce machine must be in one of them
        if user_wc_ids:
            machine_wc_id = str(self.machine.work_center_id)
            if machine_wc_id not in user_wc_ids:
                raise ValidationError({
                    'machine': f"Cannot assign machine '{self.machine.code}' - "
                               f"it belongs to a different work center than the operator's assigned work centers."
                })
    
    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)


class Notification(models.Model):
    """
    System notifications for role-based alerts.
    Phase 63: Notifications & Alerts system.
    """
    TYPE_CHOICES = [
        ('FG_READY', 'Finished Goods Ready'),
        ('CHALLAN_CREATED', 'Challan Created'),
        ('DISPATCH_READY', 'Ready for Dispatch'),
        ('LOW_STOCK', 'Low Stock Alert'),
        ('SCRAP_HIGH', 'High Scrap Rate'),
        ('DELAYED_JOB', 'Delayed Production Job'),
        ('JOB_COMPLETE', 'Job Completed'),
        ('ORDER_CREATED', 'Sales Order Created'),
        ('SYSTEM', 'System Alert'),
    ]
    
    PRIORITY_CHOICES = [
        ('LOW', 'Low'),
        ('NORMAL', 'Normal'),
        ('HIGH', 'High'),
        ('URGENT', 'Urgent'),
    ]
    CHANNEL_CHOICES = [
        ('IN_APP', 'In-App'),
        ('EMAIL', 'Email'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    # Target - can be specific user or role-based
    user = models.ForeignKey(User, on_delete=models.CASCADE, null=True, blank=True, related_name='notifications')
    target_role = models.CharField(max_length=50, blank=True, help_text="Target role code (e.g., DISPATCH, PLANNER)")
    
    # Notification content
    event_key = models.CharField(max_length=100, blank=True, help_text="Canonical event key for routing")
    type = models.CharField(max_length=30, choices=TYPE_CHOICES)
    title = models.CharField(max_length=255)
    message = models.TextField()
    priority = models.CharField(max_length=10, choices=PRIORITY_CHOICES, default='NORMAL')
    channels = models.JSONField(default=list, blank=True, help_text="Channels requested for delivery")
    
    # Reference to related object
    related_object_type = models.CharField(max_length=50, blank=True, help_text="e.g., SalesOrder, ProductionJob")
    related_object_id = models.UUIDField(null=True, blank=True)
    
    # Status
    is_read = models.BooleanField(default=False)
    read_at = models.DateTimeField(null=True, blank=True)
    first_delivered_at = models.DateTimeField(null=True, blank=True)
    delivery_state = models.JSONField(default=dict, blank=True, help_text="Delivery status by channel")
    idempotency_key = models.CharField(max_length=120, blank=True, db_index=True)
    
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'users_notifications'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', 'is_read']),
            models.Index(fields=['target_role', 'is_read']),
            models.Index(fields=['created_at']),
            models.Index(fields=['event_key', 'created_at']),
        ]

    def __str__(self):
        return f"{self.type}: {self.title}"


class NotificationRule(models.Model):
    """
    Declarative routing rule for system events.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event_key = models.CharField(max_length=100, unique=True)
    target_roles = models.JSONField(default=list, blank=True)
    channels = models.JSONField(default=list, blank=True, help_text="IN_APP/EMAIL")
    priority = models.CharField(max_length=10, choices=Notification.PRIORITY_CHOICES, default='NORMAL')
    active = models.BooleanField(default=True)
    escalation_minutes = models.PositiveIntegerField(default=0)
    email_subject_template = models.CharField(max_length=255, blank=True)
    email_body_template = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'users_notification_rules'
        ordering = ['event_key']

    def __str__(self):
        return self.event_key


class NotificationDeliveryAttempt(models.Model):
    """
    Channel-level delivery attempts for notification reliability.
    """
    STATUS_CHOICES = [
        ('PENDING', 'Pending'),
        ('SUCCEEDED', 'Succeeded'),
        ('FAILED', 'Failed'),
    ]
    CHANNEL_CHOICES = Notification.CHANNEL_CHOICES

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    notification = models.ForeignKey(Notification, on_delete=models.CASCADE, related_name='delivery_attempts')
    channel = models.CharField(max_length=20, choices=CHANNEL_CHOICES)
    recipient = models.CharField(max_length=255, blank=True)
    provider_message_id = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='PENDING')
    attempt_no = models.PositiveIntegerField(default=1)
    idempotency_key = models.CharField(max_length=160, blank=True, db_index=True)
    error_text = models.TextField(blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    next_retry_at = models.DateTimeField(null=True, blank=True)
    meta = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'users_notification_delivery_attempts'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status', 'created_at']),
            models.Index(fields=['channel', 'status']),
        ]


class RoleVisibilitySignoff(models.Model):
    """
    Department signoff matrix for role-module-action visibility.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    role_code = models.CharField(max_length=50)
    module_key = models.CharField(max_length=80)
    action_key = models.CharField(max_length=80)
    approved = models.BooleanField(default=False)
    approved_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='role_signoffs')
    approved_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'users_role_visibility_signoff'
        unique_together = ['role_code', 'module_key', 'action_key']
        ordering = ['role_code', 'module_key', 'action_key']


class PermissionAuditLog(models.Model):
    """
    Audits RBAC denials, role overrides, and role/permission governance events.
    """
    ACTION_CHOICES = [
        ('DENIED', 'Denied'),
        ('ROLE_OVERRIDE', 'Role Override'),
        ('ROLE_CHANGED', 'Role Changed'),
        ('SIGNOFF_UPDATED', 'Signoff Updated'),
        ('PASSWORD_CHANGED', 'Password Changed'),
        ('PROFILE_CHANGE_REQUESTED', 'Profile Change Requested'),
        ('PROFILE_CHANGE_REVIEWED', 'Profile Change Reviewed'),
        ('USER_LOGIN', 'User Login'),
        ('USER_LOGOUT', 'User Logout'),
        ('MASTER_DATA_CHANGED', 'Master Data Changed'),
        ('SALES_ORDER_CHANGED', 'Sales Order Changed'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='permission_audits')
    action = models.CharField(max_length=40, choices=ACTION_CHOICES)
    method = models.CharField(max_length=16, blank=True)
    path = models.CharField(max_length=255, blank=True)
    required_permission = models.CharField(max_length=100, blank=True)
    effective_role = models.CharField(max_length=50, blank=True)
    details = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'users_permission_audit_log'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['action', 'created_at']),
            models.Index(fields=['user', 'created_at']),
        ]


class CompanyProfile(models.Model):
    """Singleton row holding the company identity that appears on quotations,
    invoices, and other customer-facing documents."""

    id = models.PositiveSmallIntegerField(primary_key=True, default=1)
    # Identity
    legal_name = models.CharField(max_length=200, default="TOTAL POLY PRINT PVT. LTD.")
    trading_name = models.CharField(max_length=200, blank=True, default="")
    tagline = models.CharField(max_length=300, default="Leading manufacturer of Flexible Packaging")
    # Address
    address_line1 = models.CharField(max_length=200, default="Survey No. 261/3-A, Opp. Dabhel Cricket Ground")
    address_line2 = models.CharField(max_length=200, default="Dabhel")
    city = models.CharField(max_length=80, default="Daman")
    state = models.CharField(max_length=80, default="Daman (U.T.)")
    country = models.CharField(max_length=80, default="India")
    pincode = models.CharField(max_length=12, default="396210")
    # Contact
    phone_primary = models.CharField(max_length=40, default="+91 72111 35002")
    phone_secondary = models.CharField(max_length=40, blank=True, default="+91 98985 85118")
    email = models.EmailField(default="info@totalpolyprint.com")
    website = models.URLField(default="https://www.totalpolyprint.com")
    # Statutory
    gstin = models.CharField(max_length=20, blank=True, default="")
    pan = models.CharField(max_length=12, blank=True, default="")
    cin = models.CharField(max_length=24, blank=True, default="")
    udyam = models.CharField(max_length=24, blank=True, default="")
    iec_code = models.CharField(max_length=20, blank=True, default="")
    # Bank
    bank_name = models.CharField(max_length=100, blank=True, default="")
    bank_branch = models.CharField(max_length=100, blank=True, default="")
    bank_account_no = models.CharField(max_length=40, blank=True, default="")
    bank_ifsc = models.CharField(max_length=20, blank=True, default="")
    bank_upi = models.CharField(max_length=80, blank=True, default="")
    # Defaults shown on quote PDFs
    default_payment_terms = models.CharField(max_length=120, default="Net 45 days from invoice date")
    default_jurisdiction = models.CharField(max_length=100, default="Daman, India")
    quote_validity_days = models.PositiveSmallIntegerField(default=12)
    quote_terms_text = models.TextField(blank=True, default="")
    # Signatory
    authorised_signatory_name = models.CharField(max_length=120, default="")
    authorised_signatory_role = models.CharField(max_length=120, default="Authorised Signatory")
    # Logo path (relative to frontend_v2/public/)
    logo_path = models.CharField(max_length=200, default="brand/tpp-logo-pdf.svg")

    # Shift boundaries used for shift inference (HH:MM 24h, local time)
    shift_boundaries = models.JSONField(
        default=dict,
        blank=True,
        help_text=(
            "Mapping of shift_code -> [start_HHMM, end_HHMM] in local time. "
            "Default: A=06-14, B=14-22, C=22-06."
        ),
    )

    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )

    class Meta:
        db_table = "users_company_profile"
        verbose_name = "Company Profile"
        verbose_name_plural = "Company Profile"

    def __str__(self) -> str:
        return self.legal_name or "Company Profile"

    def save(self, *args, **kwargs):
        # Singleton: any save is pinned to id=1.
        self.id = 1
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):  # pragma: no cover - guard against accidental delete
        # The singleton must not be deletable; ignore the call instead of raising
        # so that any cascading delete code paths stay safe.
        return (0, {})

    @classmethod
    def get_solo(cls) -> "CompanyProfile":
        obj, _ = cls.objects.get_or_create(id=1)
        return obj
