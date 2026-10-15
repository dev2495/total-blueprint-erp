"""
Preventive maintenance: machine checks, technician jobs, faults and their records.

Record keeping and reports only. Spares are a note on a job (item, quantity,
cost), never a stock movement. Downtime stays on the production DowntimeLog so
OEE, breakdown history and maintenance read one timeline.
"""
import uuid

from django.conf import settings
from django.db import models


class MaintenanceSchedule(models.Model):
    KIND_CHOICES = [("OPERATOR_CHECK", "Operator check"), ("TECH_SERVICE", "Technician service")]
    INTERVAL_CHOICES = [("DAILY", "Daily"), ("WEEKLY", "Weekly"), ("MONTHLY", "Monthly"), ("RUN_HOURS", "Every N running hours")]
    DUE_RULE_CHOICES = [
        ("FIXED_CALENDAR", "Fixed calendar (a late completion does not move the next date)"),
        ("AFTER_LAST_SERVICE", "Interval after the last completion"),
    ]
    ROLE_CHOICES = [("OPERATOR", "Operator on the machine"), ("MAINTENANCE_TECH", "Maintenance technician")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    machine = models.ForeignKey("factory.Machine", on_delete=models.CASCADE, related_name="maintenance_schedules")
    name = models.CharField(max_length=160)
    name_hi = models.CharField(max_length=160, blank=True, default="", help_text="Hindi label shown on the phone")
    kind = models.CharField(max_length=20, choices=KIND_CHOICES, default="OPERATOR_CHECK")
    interval_type = models.CharField(max_length=12, choices=INTERVAL_CHOICES, default="DAILY")
    interval_value = models.PositiveIntegerField(default=1, help_text="Every N days/weeks/months, or every N running hours")
    due_rule = models.CharField(max_length=24, choices=DUE_RULE_CHOICES, default="FIXED_CALENDAR")
    anchor_date = models.DateField(help_text="First due date; fixed-calendar schedules repeat from here")
    # Checklist items: [{"code","label","label_hi","kind":"OK_ISSUE"|"READING","unit","min","max"}]
    checklist = models.JSONField(default=list, blank=True)
    assigned_role = models.CharField(max_length=24, choices=ROLE_CHOICES, default="OPERATOR")
    responsible_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="responsible_maintenance_schedules")
    requires_verification = models.BooleanField(default=False, help_text="A supervisor signs off completed work")
    is_critical = models.BooleanField(default=False, help_text="Safety, electrical, hydraulics: always verified")
    estimated_minutes = models.PositiveIntegerField(default=0)
    needs_production_stop = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    last_completed_at = models.DateTimeField(null=True, blank=True)
    next_due_date = models.DateField(null=True, blank=True, db_index=True)
    run_hours_anchor_at = models.DateTimeField(null=True, blank=True, help_text="Running hours are counted from here")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["machine__code", "kind", "name"]
        indexes = [models.Index(fields=["machine", "is_active"])]

    def __str__(self):
        return f"{self.machine.code} · {self.name}"


class MachineFault(models.Model):
    SEVERITY_CHOICES = [("LOW", "Low"), ("MEDIUM", "Medium"), ("HIGH", "High"), ("CRITICAL", "Critical")]
    STATUS_CHOICES = [
        ("OPEN", "Open"), ("ASSIGNED", "Assigned"), ("IN_REPAIR", "In repair"),
        ("RESOLVED", "Resolved"), ("CLOSED", "Closed"), ("DISMISSED", "Dismissed"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    machine = models.ForeignKey("factory.Machine", on_delete=models.CASCADE, related_name="faults")
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True, default="")
    severity = models.CharField(max_length=10, choices=SEVERITY_CHOICES, default="MEDIUM")
    machine_running = models.BooleanField(default=True, help_text="False when the fault stopped the machine")
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default="OPEN", db_index=True)
    reported_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="reported_faults")
    reported_at = models.DateTimeField(auto_now_add=True, db_index=True)
    assigned_to = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="assigned_faults")
    assigned_at = models.DateTimeField(null=True, blank=True)
    source_job = models.ForeignKey("maintenance.MaintenanceJob", on_delete=models.SET_NULL, null=True, blank=True, related_name="raised_faults", help_text="Check or service that found it")
    production_job = models.ForeignKey("production.ProductionJob", on_delete=models.SET_NULL, null=True, blank=True, related_name="faults")
    downtime_log = models.ForeignKey("production.DowntimeLog", on_delete=models.SET_NULL, null=True, blank=True, related_name="faults")
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="resolved_faults")
    resolution_note = models.TextField(blank=True, default="")
    closed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-reported_at"]

    def __str__(self):
        return f"{self.machine.code} · {self.title}"


class MaintenanceJob(models.Model):
    STATUS_CHOICES = [
        ("DUE", "Due"), ("IN_PROGRESS", "In progress"), ("DONE", "Done"),
        ("AWAITING_VERIFICATION", "Awaiting verification"), ("VERIFIED", "Verified"),
        ("ISSUE_FOUND", "Issue found"), ("UNABLE", "Could not complete"), ("CANCELLED", "Cancelled"),
    ]
    OUTCOME_CHOICES = [("", "Not recorded"), ("COMPLETED", "Completed"), ("ISSUE", "Issue found"), ("UNABLE", "Unable to complete")]
    SOURCE_CHOICES = [("SCHEDULE", "Schedule"), ("FAULT", "Fault follow-up"), ("MANUAL", "Added by hand")]
    OPEN_STATUSES = ("DUE", "IN_PROGRESS", "ISSUE_FOUND", "UNABLE")

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    machine = models.ForeignKey("factory.Machine", on_delete=models.CASCADE, related_name="maintenance_jobs")
    schedule = models.ForeignKey(MaintenanceSchedule, on_delete=models.SET_NULL, null=True, blank=True, related_name="jobs")
    fault = models.ForeignKey(MachineFault, on_delete=models.SET_NULL, null=True, blank=True, related_name="jobs")
    source = models.CharField(max_length=10, choices=SOURCE_CHOICES, default="SCHEDULE")
    kind = models.CharField(max_length=20, choices=MaintenanceSchedule.KIND_CHOICES, default="OPERATOR_CHECK")
    title = models.CharField(max_length=200)
    title_hi = models.CharField(max_length=200, blank=True, default="")
    planned_date = models.DateField(db_index=True, help_text="Kept even when the job closes late")
    assigned_role = models.CharField(max_length=24, choices=MaintenanceSchedule.ROLE_CHOICES, default="OPERATOR")
    assigned_to = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="assigned_maintenance_jobs")
    status = models.CharField(max_length=24, choices=STATUS_CHOICES, default="DUE", db_index=True)
    outcome = models.CharField(max_length=10, choices=OUTCOME_CHOICES, blank=True, default="")
    outcome_reason = models.TextField(blank=True, default="", help_text="Why it could not be completed, or what the issue is")
    checklist = models.JSONField(default=list, blank=True, help_text="Snapshot of the schedule checklist at creation")
    # [{"code","status":"OK"|"ISSUE"|"SKIPPED","reading":12.5,"note":""}]
    checklist_results = models.JSONField(default=list, blank=True)
    # [{"item":"Bearing 6205","qty":2,"cost":480}] - a note, not stock
    spares_used = models.JSONField(default=list, blank=True)
    spares_cost = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    time_minutes = models.PositiveIntegerField(default=0)
    notes = models.TextField(blank=True, default="")
    requires_verification = models.BooleanField(default=False)
    started_at = models.DateTimeField(null=True, blank=True)
    started_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    completed_at = models.DateTimeField(null=True, blank=True, db_index=True)
    completed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="completed_maintenance_jobs")
    verified_at = models.DateTimeField(null=True, blank=True)
    verified_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="verified_maintenance_jobs")
    verification_note = models.TextField(blank=True, default="")
    downtime_log = models.ForeignKey("production.DowntimeLog", on_delete=models.SET_NULL, null=True, blank=True, related_name="maintenance_jobs")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["planned_date", "machine__code", "title"]
        indexes = [models.Index(fields=["machine", "status"]), models.Index(fields=["assigned_to", "status"])]

    def __str__(self):
        return f"{self.machine.code} · {self.title} · {self.planned_date}"

    @property
    def is_open(self):
        return self.status in self.OPEN_STATUSES


class MaintenanceAttachment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    job = models.ForeignKey(MaintenanceJob, on_delete=models.CASCADE, null=True, blank=True, related_name="attachments")
    fault = models.ForeignKey(MachineFault, on_delete=models.CASCADE, null=True, blank=True, related_name="attachments")
    file = models.FileField(upload_to="maintenance/%Y/%m/")
    original_name = models.CharField(max_length=255, blank=True, default="")
    content_type = models.CharField(max_length=100, blank=True, default="")
    size_bytes = models.PositiveIntegerField(default=0)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]


class MaintenanceEditLog(models.Model):
    """Every change to a job or fault after creation: who, when, what."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    object_type = models.CharField(max_length=16, db_index=True)  # JOB | FAULT | SCHEDULE
    object_id = models.UUIDField(db_index=True)
    action = models.CharField(max_length=40)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    before = models.JSONField(default=dict, blank=True)
    after = models.JSONField(default=dict, blank=True)
    note = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
