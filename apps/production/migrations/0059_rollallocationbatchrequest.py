import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("production", "0058_productionjob_meta_json"),
    ]

    operations = [
        migrations.CreateModel(
            name="RollAllocationBatchRequest",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("client_token", models.CharField(db_index=True, max_length=120)),
                ("status", models.CharField(choices=[("RUNNING", "Running"), ("COMPLETED", "Completed")], default="RUNNING", max_length=20)),
                ("response_json", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="roll_allocation_batch_requests", to=settings.AUTH_USER_MODEL)),
                ("job", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="allocation_batch_requests", to="production.productionjob")),
            ],
            options={
                "db_table": "production_roll_allocation_batch_requests",
                "indexes": [
                    models.Index(fields=["job", "client_token"], name="production__job_id_fd526c_idx"),
                    models.Index(fields=["created_at"], name="production__created_02a593_idx"),
                ],
                "constraints": [
                    models.UniqueConstraint(condition=models.Q(("client_token__gt", "")), fields=("job", "client_token"), name="uniq_roll_alloc_batch_job_token"),
                ],
            },
        ),
    ]
