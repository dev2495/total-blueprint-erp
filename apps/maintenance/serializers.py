from rest_framework import serializers

from apps.maintenance.models import MachineFault, MaintenanceAttachment, MaintenanceEditLog, MaintenanceJob, MaintenanceSchedule


def _user_label(user):
    if not user:
        return ""
    return (user.get_full_name() or user.username) if hasattr(user, "get_full_name") else str(user)


class UserRefSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.SerializerMethodField()
    username = serializers.CharField()

    def get_name(self, obj):
        return _user_label(obj)


class MachineRefSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    code = serializers.CharField()
    name = serializers.CharField()
    status = serializers.CharField()
    work_center_name = serializers.CharField(source="work_center.name", default="")
    work_center_id = serializers.UUIDField(source="work_center.id", default=None)
    plant_id = serializers.UUIDField(source="work_center.plant.id", default=None)
    plant_name = serializers.CharField(source="work_center.plant.name", default="")


class ChecklistItemSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=40)
    label = serializers.CharField(max_length=160)
    label_hi = serializers.CharField(max_length=160, required=False, allow_blank=True, default="")
    kind = serializers.ChoiceField(choices=["OK_ISSUE", "READING"], default="OK_ISSUE")
    unit = serializers.CharField(max_length=20, required=False, allow_blank=True, default="")
    min = serializers.FloatField(required=False, allow_null=True, default=None)
    max = serializers.FloatField(required=False, allow_null=True, default=None)


class MaintenanceScheduleSerializer(serializers.ModelSerializer):
    machine_detail = MachineRefSerializer(source="machine", read_only=True)
    responsible_user_detail = UserRefSerializer(source="responsible_user", read_only=True)
    checklist = ChecklistItemSerializer(many=True, required=False)
    open_job_id = serializers.SerializerMethodField()
    run_hours_since = serializers.SerializerMethodField()

    class Meta:
        model = MaintenanceSchedule
        fields = [
            "id", "machine", "machine_detail", "name", "name_hi", "kind", "interval_type", "interval_value", "due_rule",
            "anchor_date", "checklist", "assigned_role", "responsible_user", "responsible_user_detail", "requires_verification",
            "is_critical", "estimated_minutes", "needs_production_stop", "is_active", "last_completed_at", "next_due_date",
            "run_hours_anchor_at", "open_job_id", "run_hours_since", "created_at", "updated_at",
        ]
        read_only_fields = ["last_completed_at", "next_due_date", "run_hours_anchor_at", "created_at", "updated_at"]

    def get_open_job_id(self, obj):
        job = getattr(obj, "_open_job", None)
        if job is None:
            job = obj.jobs.filter(status__in=MaintenanceJob.OPEN_STATUSES).order_by("planned_date").first()
        return str(job.id) if job else None

    def get_run_hours_since(self, obj):
        if obj.interval_type != "RUN_HOURS":
            return None
        from apps.maintenance.services import MaintenanceService
        return float(MaintenanceService.machine_run_hours(obj.machine, since=obj.run_hours_anchor_at or obj.last_completed_at))


class MaintenanceAttachmentSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()
    uploaded_by_name = serializers.SerializerMethodField()

    class Meta:
        model = MaintenanceAttachment
        fields = ["id", "job", "fault", "url", "original_name", "content_type", "size_bytes", "uploaded_by_name", "created_at"]

    def get_url(self, obj):
        return f"/api/maintenance/attachments/{obj.id}/file/"

    def get_uploaded_by_name(self, obj):
        return _user_label(obj.uploaded_by)


class MachineFaultSerializer(serializers.ModelSerializer):
    machine_detail = MachineRefSerializer(source="machine", read_only=True)
    reported_by_name = serializers.SerializerMethodField()
    assigned_to_detail = UserRefSerializer(source="assigned_to", read_only=True)
    resolved_by_name = serializers.SerializerMethodField()
    attachments = MaintenanceAttachmentSerializer(many=True, read_only=True)
    open_job_id = serializers.SerializerMethodField()
    production_job_number = serializers.CharField(source="production_job.job_number", read_only=True, default="")

    class Meta:
        model = MachineFault
        fields = [
            "id", "machine", "machine_detail", "title", "description", "severity", "machine_running", "status",
            "reported_by", "reported_by_name", "reported_at", "assigned_to", "assigned_to_detail", "assigned_at",
            "source_job", "production_job", "production_job_number", "downtime_log", "resolved_at", "resolved_by_name",
            "resolution_note", "closed_at", "attachments", "open_job_id", "created_at", "updated_at",
        ]
        read_only_fields = ["reported_by", "reported_at", "assigned_at", "resolved_at", "closed_at", "created_at", "updated_at", "downtime_log", "production_job", "source_job"]

    def get_reported_by_name(self, obj):
        return _user_label(obj.reported_by)

    def get_resolved_by_name(self, obj):
        return _user_label(obj.resolved_by)

    def get_open_job_id(self, obj):
        job = obj.jobs.filter(status__in=MaintenanceJob.OPEN_STATUSES).order_by("planned_date").first()
        return str(job.id) if job else None


class MaintenanceJobSerializer(serializers.ModelSerializer):
    machine_detail = MachineRefSerializer(source="machine", read_only=True)
    assigned_to_detail = UserRefSerializer(source="assigned_to", read_only=True)
    completed_by_name = serializers.SerializerMethodField()
    verified_by_name = serializers.SerializerMethodField()
    attachments = MaintenanceAttachmentSerializer(many=True, read_only=True)
    fault_title = serializers.CharField(source="fault.title", read_only=True, default="")
    schedule_name = serializers.CharField(source="schedule.name", read_only=True, default="")
    is_overdue = serializers.SerializerMethodField()

    class Meta:
        model = MaintenanceJob
        fields = [
            "id", "machine", "machine_detail", "schedule", "schedule_name", "fault", "fault_title", "source", "kind", "title", "title_hi",
            "planned_date", "assigned_role", "assigned_to", "assigned_to_detail", "status", "outcome", "outcome_reason",
            "checklist", "checklist_results", "spares_used", "spares_cost", "time_minutes", "notes", "requires_verification",
            "started_at", "completed_at", "completed_by_name", "verified_at", "verified_by_name", "verification_note",
            "downtime_log", "attachments", "is_overdue", "created_at", "updated_at",
        ]
        read_only_fields = [
            "status", "outcome", "outcome_reason", "checklist_results", "spares_used", "spares_cost", "time_minutes",
            "started_at", "completed_at", "verified_at", "verification_note", "downtime_log", "created_at", "updated_at",
        ]

    def get_completed_by_name(self, obj):
        return _user_label(obj.completed_by)

    def get_verified_by_name(self, obj):
        return _user_label(obj.verified_by)

    def get_is_overdue(self, obj):
        from django.utils import timezone
        return obj.status in MaintenanceJob.OPEN_STATUSES and obj.planned_date < timezone.localdate()


class MaintenanceEditLogSerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = MaintenanceEditLog
        fields = ["id", "object_type", "object_id", "action", "actor_name", "before", "after", "note", "created_at"]

    def get_actor_name(self, obj):
        return _user_label(obj.actor)


class JobCompleteSerializer(serializers.Serializer):
    outcome = serializers.ChoiceField(choices=["COMPLETED", "ISSUE", "UNABLE"])
    checklist_results = serializers.ListField(child=serializers.DictField(), required=False, default=list)
    time_minutes = serializers.IntegerField(required=False, min_value=0, default=0)
    spares_used = serializers.ListField(child=serializers.DictField(), required=False, default=list)
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    outcome_reason = serializers.CharField(required=False, allow_blank=True, default="")
    fault_title = serializers.CharField(required=False, allow_blank=True, default="")
    fault_severity = serializers.ChoiceField(choices=["LOW", "MEDIUM", "HIGH", "CRITICAL"], required=False, default="MEDIUM")
    machine_running = serializers.BooleanField(required=False, default=True)


class FaultReportSerializer(serializers.Serializer):
    machine = serializers.UUIDField()
    title = serializers.CharField(max_length=200)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    severity = serializers.ChoiceField(choices=["LOW", "MEDIUM", "HIGH", "CRITICAL"], required=False, default="MEDIUM")
    machine_running = serializers.BooleanField(required=False, default=True)
