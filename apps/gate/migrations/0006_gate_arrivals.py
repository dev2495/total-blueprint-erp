import uuid

import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("gate", "0005_backfill_document_headers"),
        ("factory", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="GateArrival",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("kind", models.CharField(choices=[("INTERPLANT_DC", "Inter-plant challan arriving"), ("JOBWORK_CHALLAN", "Job work coming back"), ("GATE_PASS", "Returnable gate pass coming back")], max_length=20)),
                ("object_id", models.UUIDField()),
                ("reference", models.CharField(blank=True, default="", max_length=120)),
                ("party_name", models.CharField(blank=True, default="", max_length=255)),
                ("snapshot", models.JSONField(blank=True, default=dict)),
                ("vehicle_number", models.CharField(blank=True, default="", max_length=40)),
                ("notes", models.CharField(blank=True, default="", max_length=500)),
                ("arrived_at", models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                ("created_by", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="gate_arrivals", to=settings.AUTH_USER_MODEL)),
                ("plant", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="gate_arrivals", to="factory.plant")),
            ],
            options={
                "ordering": ["-arrived_at", "-id"],
                "indexes": [
                    models.Index(fields=["plant", "arrived_at"], name="gate_arrival_plant_idx"),
                    models.Index(fields=["kind", "object_id"], name="gate_arrival_object_idx"),
                ],
            },
        ),
    ]
