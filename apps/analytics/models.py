from django.conf import settings
from django.db import models


class ReportDistributionProfile(models.Model):
    class ReportCode(models.TextChoices):
        OWNER_EXECUTIVE_DAILY = "owner_executive_daily", "Owner Executive Daily"
        PRODUCTION_DAILY = "production_daily", "Production Daily"
        DISPATCH_DAILY = "dispatch_daily", "Dispatch Daily"
        PACKING_DISPATCH_SUMMARY_DAILY = "packing_dispatch_summary_daily", "Packing Dispatch Summary Daily"
        STOCK_STANDING_DAILY = "stock_standing_daily", "Stock Standing Daily"

    report_code = models.CharField(max_length=64, choices=ReportCode.choices, unique=True)
    active = models.BooleanField(default=True)
    target_roles = models.JSONField(default=list, blank=True)
    extra_recipients = models.JSONField(default=list, blank=True)
    schedule_hour = models.PositiveSmallIntegerField(default=8)
    schedule_minute = models.PositiveSmallIntegerField(default=0)
    email_subject_template = models.CharField(max_length=255, blank=True, default="")
    email_body_template = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="updated_report_distribution_profiles",
    )

    class Meta:
        db_table = "analytics_report_distribution_profiles"
        ordering = ["report_code"]

    def __str__(self):
        return self.report_code


class ReportDispatchRun(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        SUCCEEDED = "SUCCEEDED", "Succeeded"
        FAILED = "FAILED", "Failed"
        SKIPPED = "SKIPPED", "Skipped"
        SKIPPED_EMAIL = "SKIPPED_EMAIL", "Skipped Email"

    profile = models.ForeignKey(
        ReportDistributionProfile,
        on_delete=models.CASCADE,
        related_name="runs",
    )
    report_code = models.CharField(max_length=64)
    report_date = models.DateField()
    window_start = models.DateTimeField(null=True, blank=True)
    window_end = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    recipients = models.JSONField(default=list, blank=True)
    recipient_count = models.PositiveIntegerField(default=0)
    warning_text = models.TextField(blank=True, default="")
    error_text = models.TextField(blank=True, default="")
    provider = models.CharField(max_length=32, blank=True, default="")
    provider_message_id = models.CharField(max_length=255, blank=True, default="")
    pdf_file_name = models.CharField(max_length=255, blank=True, default="")
    pdf_checksum_sha1 = models.CharField(max_length=40, blank=True, default="")
    pdf_size_bytes = models.PositiveIntegerField(default=0)
    detail_file_name = models.CharField(max_length=255, blank=True, default="")
    detail_checksum_sha1 = models.CharField(max_length=40, blank=True, default="")
    detail_size_bytes = models.PositiveIntegerField(default=0)
    triggered_manually = models.BooleanField(default=False)
    triggered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="triggered_report_dispatch_runs",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "analytics_report_dispatch_runs"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["report_code", "report_date"]),
            models.Index(fields=["status", "created_at"]),
        ]

    def __str__(self):
        return f"{self.report_code} {self.report_date} {self.status}"
