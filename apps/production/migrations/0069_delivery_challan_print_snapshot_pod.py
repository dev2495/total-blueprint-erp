from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("production", "0068_wcm_material_transfer_audit_actions"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="deliverychallan",
            name="print_snapshot",
            field=models.JSONField(
                blank=True,
                default=dict,
                help_text="Immutable dispatch-slip rows and balances frozen when the challan is dispatched.",
            ),
        ),
        migrations.AddField(
            model_name="deliverychallan",
            name="pod_confirmed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="deliverychallan",
            name="pod_confirmed_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="pod_confirmed_challans",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="deliverychallan",
            name="pod_received_by",
            field=models.CharField(blank=True, default="", max_length=160),
        ),
        migrations.AddField(
            model_name="deliverychallan",
            name="pod_reference",
            field=models.CharField(blank=True, default="", max_length=120),
        ),
        migrations.AddField(
            model_name="deliverychallan",
            name="pod_notes",
            field=models.TextField(blank=True, default=""),
        ),
    ]
