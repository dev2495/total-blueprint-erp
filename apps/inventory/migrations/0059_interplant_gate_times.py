import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("inventory", "0058_inventory_alert_scope_key"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="deliverychallan",
            name="gate_out_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="deliverychallan",
            name="gate_out_by",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="gated_out_interplant_challans", to=settings.AUTH_USER_MODEL),
        ),
        migrations.AddField(
            model_name="deliverychallan",
            name="gate_in_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="deliverychallan",
            name="gate_in_by",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="gated_in_interplant_challans", to=settings.AUTH_USER_MODEL),
        ),
    ]
