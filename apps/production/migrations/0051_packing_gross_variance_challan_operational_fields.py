from decimal import Decimal

from django.db import migrations, models


def backfill_gonny_expected_weights(apps, schema_editor):
    PackingUnit = apps.get_model("production", "PackingUnit")
    for unit in PackingUnit.objects.all().iterator():
        gross = unit.gross_weight_kg or unit.weight_kg
        update_fields = []
        if gross is not None and unit.expected_gross_weight_kg is None:
            unit.expected_gross_weight_kg = gross
            update_fields.append("expected_gross_weight_kg")
        if str(unit.status or "").upper() in {"SEALED", "DISPATCHED"} and gross is not None:
            if unit.gross_weight_kg is None:
                unit.gross_weight_kg = gross
                update_fields.append("gross_weight_kg")
            if unit.gross_variance_kg is None:
                unit.gross_variance_kg = Decimal("0")
                update_fields.append("gross_variance_kg")
            if unit.gross_variance_pct is None:
                unit.gross_variance_pct = Decimal("0")
                update_fields.append("gross_variance_pct")
        if update_fields:
            unit.save(update_fields=update_fields)


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0050_production_wc_audit_event"),
    ]

    operations = [
        migrations.AddField(
            model_name="packingunit",
            name="expected_gross_weight_kg",
            field=models.DecimalField(blank=True, decimal_places=4, help_text="System-calculated gross weight before actual seal capture.", max_digits=12, null=True),
        ),
        migrations.AddField(
            model_name="packingunit",
            name="gross_variance_kg",
            field=models.DecimalField(blank=True, decimal_places=4, help_text="Actual gross minus expected gross.", max_digits=12, null=True),
        ),
        migrations.AddField(
            model_name="packingunit",
            name="gross_variance_pct",
            field=models.DecimalField(blank=True, decimal_places=4, help_text="Gross variance percentage against expected gross.", max_digits=8, null=True),
        ),
        migrations.AddField(
            model_name="packingunit",
            name="gross_variance_reason",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="deliverychallan",
            name="transporter_name",
            field=models.CharField(blank=True, max_length=160),
        ),
        migrations.AddField(
            model_name="deliverychallan",
            name="lr_number",
            field=models.CharField(blank=True, max_length=80),
        ),
        migrations.AddField(
            model_name="deliverychallan",
            name="e_way_bill_number",
            field=models.CharField(blank=True, max_length=80),
        ),
        migrations.AddField(
            model_name="deliverychallan",
            name="dispatch_notes",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="deliverychallan",
            name="ship_to_address_snapshot",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.RunPython(backfill_gonny_expected_weights, migrations.RunPython.noop),
    ]
