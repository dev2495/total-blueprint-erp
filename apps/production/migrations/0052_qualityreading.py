import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("factory", "0023_machine_code_per_work_center"),
        ("production", "0051_packing_gross_variance_challan_operational_fields"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="QualityReading",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("parameter_code", models.CharField(max_length=40)),
                ("value_numeric", models.DecimalField(blank=True, decimal_places=4, max_digits=12, null=True)),
                ("value_text", models.CharField(blank=True, default="", max_length=80)),
                ("spec_min", models.DecimalField(blank=True, decimal_places=4, max_digits=12, null=True)),
                ("spec_max", models.DecimalField(blank=True, decimal_places=4, max_digits=12, null=True)),
                ("in_spec", models.BooleanField(default=True)),
                ("logged_at", models.DateTimeField(auto_now_add=True)),
                (
                    "logged_by",
                    models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL),
                ),
                (
                    "process",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="quality_readings",
                        to="factory.process",
                    ),
                ),
                (
                    "production_job",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="quality_readings",
                        to="production.productionjob",
                    ),
                ),
            ],
            options={
                "db_table": "production_quality_readings",
            },
        ),
        migrations.AddIndex(
            model_name="qualityreading",
            index=models.Index(fields=["production_job", "-logged_at"], name="prod_quality_job_time"),
        ),
        migrations.AddIndex(
            model_name="qualityreading",
            index=models.Index(fields=["parameter_code", "-logged_at"], name="prod_quality_param_time"),
        ),
    ]
