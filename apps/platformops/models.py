import uuid

from django.conf import settings
from django.db import models


class BackupRecord(models.Model):
    class BackupKind(models.TextChoices):
        POSTGRES_DUMP = "POSTGRES_DUMP", "PostgreSQL Dump"

    class BackupStatus(models.TextChoices):
        PENDING = "PENDING", "Pending"
        RUNNING = "RUNNING", "Running"
        SUCCEEDED = "SUCCEEDED", "Succeeded"
        FAILED = "FAILED", "Failed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=40, choices=BackupKind.choices, default=BackupKind.POSTGRES_DUMP)
    status = models.CharField(max_length=20, choices=BackupStatus.choices, default=BackupStatus.PENDING)

    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    duration_seconds = models.PositiveIntegerField(null=True, blank=True)

    file_name = models.CharField(max_length=255, blank=True)
    object_key = models.CharField(max_length=512, blank=True)
    storage_provider = models.CharField(max_length=32, blank=True, default="LOCAL")
    checksum_sha256 = models.CharField(max_length=128, blank=True)
    size_bytes = models.BigIntegerField(null=True, blank=True)

    metadata = models.JSONField(default=dict, blank=True)
    error_text = models.TextField(blank=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="backup_records",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "platformops_backup_records"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "created_at"]),
            models.Index(fields=["kind", "created_at"]),
        ]


class RestoreDrillRecord(models.Model):
    class RestoreStatus(models.TextChoices):
        PENDING = "PENDING", "Pending"
        RUNNING = "RUNNING", "Running"
        SUCCEEDED = "SUCCEEDED", "Succeeded"
        FAILED = "FAILED", "Failed"
        SKIPPED = "SKIPPED", "Skipped"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    backup_record = models.ForeignKey(
        BackupRecord,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="restore_drills",
    )

    status = models.CharField(max_length=20, choices=RestoreStatus.choices, default=RestoreStatus.PENDING)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    duration_seconds = models.PositiveIntegerField(null=True, blank=True)

    rpo_minutes = models.PositiveIntegerField(null=True, blank=True)
    rto_minutes = models.PositiveIntegerField(null=True, blank=True)

    smoke_test_command = models.CharField(max_length=512, blank=True)
    smoke_test_passed = models.BooleanField(default=False)
    notes = models.TextField(blank=True)
    error_text = models.TextField(blank=True)
    details = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "platformops_restore_drills"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "created_at"]),
        ]


class OperationalAlert(models.Model):
    class Severity(models.TextChoices):
        INFO = "INFO", "Info"
        WARNING = "WARNING", "Warning"
        CRITICAL = "CRITICAL", "Critical"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    category = models.CharField(max_length=64)
    severity = models.CharField(max_length=16, choices=Severity.choices, default=Severity.WARNING)
    message = models.CharField(max_length=255)
    details = models.JSONField(default=dict, blank=True)

    resolved = models.BooleanField(default=False)
    resolved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "platformops_operational_alerts"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["resolved", "severity", "created_at"])]
