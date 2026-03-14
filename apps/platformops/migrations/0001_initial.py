# Generated manually for platform operations models.
import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="BackupRecord",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                (
                    "kind",
                    models.CharField(
                        choices=[("POSTGRES_DUMP", "PostgreSQL Dump")],
                        default="POSTGRES_DUMP",
                        max_length=40,
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[("PENDING", "Pending"), ("RUNNING", "Running"), ("SUCCEEDED", "Succeeded"), ("FAILED", "Failed")],
                        default="PENDING",
                        max_length=20,
                    ),
                ),
                ("started_at", models.DateTimeField(blank=True, null=True)),
                ("finished_at", models.DateTimeField(blank=True, null=True)),
                ("duration_seconds", models.PositiveIntegerField(blank=True, null=True)),
                ("file_name", models.CharField(blank=True, max_length=255)),
                ("object_key", models.CharField(blank=True, max_length=512)),
                ("storage_provider", models.CharField(blank=True, default="LOCAL", max_length=32)),
                ("checksum_sha256", models.CharField(blank=True, max_length=128)),
                ("size_bytes", models.BigIntegerField(blank=True, null=True)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("error_text", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="backup_records",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "db_table": "platformops_backup_records",
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="OperationalAlert",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("category", models.CharField(max_length=64)),
                (
                    "severity",
                    models.CharField(
                        choices=[("INFO", "Info"), ("WARNING", "Warning"), ("CRITICAL", "Critical")],
                        default="WARNING",
                        max_length=16,
                    ),
                ),
                ("message", models.CharField(max_length=255)),
                ("details", models.JSONField(blank=True, default=dict)),
                ("resolved", models.BooleanField(default=False)),
                ("resolved_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "db_table": "platformops_operational_alerts",
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="RestoreDrillRecord",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("PENDING", "Pending"),
                            ("RUNNING", "Running"),
                            ("SUCCEEDED", "Succeeded"),
                            ("FAILED", "Failed"),
                            ("SKIPPED", "Skipped"),
                        ],
                        default="PENDING",
                        max_length=20,
                    ),
                ),
                ("started_at", models.DateTimeField(blank=True, null=True)),
                ("finished_at", models.DateTimeField(blank=True, null=True)),
                ("duration_seconds", models.PositiveIntegerField(blank=True, null=True)),
                ("rpo_minutes", models.PositiveIntegerField(blank=True, null=True)),
                ("rto_minutes", models.PositiveIntegerField(blank=True, null=True)),
                ("smoke_test_command", models.CharField(blank=True, max_length=512)),
                ("smoke_test_passed", models.BooleanField(default=False)),
                ("notes", models.TextField(blank=True)),
                ("error_text", models.TextField(blank=True)),
                ("details", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "backup_record",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="restore_drills",
                        to="platformops.backuprecord",
                    ),
                ),
            ],
            options={
                "db_table": "platformops_restore_drills",
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="backuprecord",
            index=models.Index(fields=["status", "created_at"], name="platformops__status_d6b1c4_idx"),
        ),
        migrations.AddIndex(
            model_name="backuprecord",
            index=models.Index(fields=["kind", "created_at"], name="platformops__kind_c5ca1f_idx"),
        ),
        migrations.AddIndex(
            model_name="operationalalert",
            index=models.Index(fields=["resolved", "severity", "created_at"], name="platformops__resolve_eb5f34_idx"),
        ),
        migrations.AddIndex(
            model_name="restoredrillrecord",
            index=models.Index(fields=["status", "created_at"], name="platformops__status_53cb54_idx"),
        ),
    ]
