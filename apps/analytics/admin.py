from django.contrib import admin

from .models import ReportDispatchRun, ReportDistributionProfile


@admin.register(ReportDistributionProfile)
class ReportDistributionProfileAdmin(admin.ModelAdmin):
    list_display = ("report_code", "active", "updated_at")
    list_filter = ("report_code", "active")
    search_fields = ("report_code",)


@admin.register(ReportDispatchRun)
class ReportDispatchRunAdmin(admin.ModelAdmin):
    list_display = ("report_code", "report_date", "status", "recipient_count", "triggered_manually", "created_at")
    list_filter = ("report_code", "status", "triggered_manually")
    search_fields = ("report_code", "provider_message_id", "pdf_file_name")
