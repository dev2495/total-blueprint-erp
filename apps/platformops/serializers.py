from rest_framework import serializers

from apps.platformops.models import BackupRecord, RestoreDrillRecord


class BackupRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = BackupRecord
        fields = [
            "id",
            "kind",
            "status",
            "started_at",
            "finished_at",
            "duration_seconds",
            "file_name",
            "object_key",
            "storage_provider",
            "checksum_sha256",
            "size_bytes",
            "metadata",
            "error_text",
            "created_at",
        ]


class RestoreDrillRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = RestoreDrillRecord
        fields = [
            "id",
            "backup_record",
            "status",
            "started_at",
            "finished_at",
            "duration_seconds",
            "rpo_minutes",
            "rto_minutes",
            "smoke_test_command",
            "smoke_test_passed",
            "notes",
            "error_text",
            "details",
            "created_at",
        ]
