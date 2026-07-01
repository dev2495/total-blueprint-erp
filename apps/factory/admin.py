from django.contrib import admin

from .models import Machine, Plant, PlantLegalProfile, Process, WorkCenter, WorkCenterProcess


@admin.register(Plant)
class PlantAdmin(admin.ModelAdmin):
    list_display = ("name", "code")
    search_fields = ("name", "code")


@admin.register(PlantLegalProfile)
class PlantLegalProfileAdmin(admin.ModelAdmin):
    list_display = ("plant", "legal_name", "gstin", "is_verified", "updated_at")
    list_filter = ("is_verified",)
    search_fields = ("plant__name", "plant__code", "legal_name", "gstin")


@admin.register(Process)
class ProcessAdmin(admin.ModelAdmin):
    list_display = (
        "code",
        "name",
        "input_form",
        "output_form",
        "roll_behavior",
        "allows_optional_at_planning",
        "allows_skip_after_previous_output",
    )
    search_fields = ("code", "name")
    list_filter = (
        "input_form",
        "output_form",
        "roll_behavior",
        "allows_optional_at_planning",
        "allows_skip_after_previous_output",
    )


@admin.register(WorkCenter)
class WorkCenterAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "plant", "default_wip_location")
    search_fields = ("name", "code", "plant__name", "plant__code")
    list_filter = ("plant",)


@admin.register(WorkCenterProcess)
class WorkCenterProcessAdmin(admin.ModelAdmin):
    list_display = ("work_center", "process")
    search_fields = ("work_center__name", "work_center__code", "process__name", "process__code")


@admin.register(Machine)
class MachineAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "work_center", "status", "assigned_operator")
    search_fields = ("name", "code", "work_center__name")
    list_filter = ("status", "work_center")
