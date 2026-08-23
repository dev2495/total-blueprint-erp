from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("sales", "0038_alter_quotationitem_line_kind_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="quotationcostsnapshot",
            name="cost_entry_mode",
            field=models.CharField(
                choices=[
                    ("CONVERSION_TOTAL", "Conversion Cost Total"),
                    ("STEPWISE", "Step-wise Conversion Cost"),
                ],
                default="CONVERSION_TOTAL",
                help_text=(
                    "How the operator entered conversion cost. CONVERSION_TOTAL is the fast "
                    "per-line conversion-rate path; STEPWISE itemises process, labour, overhead, "
                    "wastage, packing, freight and other components."
                ),
                max_length=24,
            ),
        ),
    ]
