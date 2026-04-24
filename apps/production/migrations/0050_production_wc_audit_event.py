import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("factory", "0023_machine_code_per_work_center"),
        ("production", "0049_productionjob_current_step_material_confirmations"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="ProductionWcmAuditEvent",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                (
                    "action",
                    models.CharField(
                        choices=[
                            ("ASSIGN_MACHINE", "Assign Machine"),
                            ("ALLOCATE_ROLLS", "Allocate Rolls"),
                            ("UNASSIGN_ROLL", "Unassign Roll"),
                            ("RELEASE_TO_MACHINE", "Release To Machine"),
                            ("MATERIAL_ISSUE", "Material Issue"),
                            ("SHORT_CLOSE", "Short Close"),
                            ("CANCEL", "Cancel"),
                        ],
                        max_length=32,
                    ),
                ),
                ("reason", models.TextField(blank=True, default="")),
                ("before_status", models.CharField(blank=True, default="", max_length=32)),
                ("after_status", models.CharField(blank=True, default="", max_length=32)),
                ("payload", models.JSONField(blank=True, default=dict)),
                ("occurred_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                (
                    "actor",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="wcm_audit_events",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "assignment",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="audit_events",
                        to="production.workcenterassignment",
                    ),
                ),
                (
                    "machine",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="wcm_audit_events",
                        to="factory.machine",
                    ),
                ),
                (
                    "production_job",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="wcm_audit_events",
                        to="production.productionjob",
                    ),
                ),
                (
                    "work_center",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="wcm_audit_events",
                        to="factory.workcenter",
                    ),
                ),
            ],
            options={
                "db_table": "production_wcm_audit_events",
            },
        ),
        migrations.AddIndex(
            model_name="productionwcmauditevent",
            index=models.Index(fields=["work_center", "-occurred_at"], name="prod_wcm_audit_wc_time"),
        ),
        migrations.AddIndex(
            model_name="productionwcmauditevent",
            index=models.Index(fields=["production_job", "-occurred_at"], name="prod_wcm_audit_job_time"),
        ),
        migrations.AddIndex(
            model_name="productionwcmauditevent",
            index=models.Index(fields=["action", "-occurred_at"], name="prod_wcm_audit_action_time"),
        ),
    ]
