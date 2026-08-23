from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("sales", "0039_quotation_cost_entry_mode")]

    operations = [
        migrations.AlterField(
            model_name="quotationcostsnapshot",
            name="cost_entry_mode",
            field=models.CharField(
                choices=[
                    ("CONVERSION_TOTAL", "Conversion Cost Total"),
                    ("MARGIN_LED", "Margin-led Pricing"),
                    ("STEPWISE", "Step-wise Conversion Cost"),
                ],
                default="CONVERSION_TOTAL",
                help_text=(
                    "How the operator entered conversion cost. CONVERSION_TOTAL is the fast "
                    "per-line conversion-rate path; MARGIN_LED keeps that cost base while making "
                    "the target margin or markup the primary pricing control; STEPWISE itemises process, labour, overhead, "
                    "wastage, packing, freight and other components."
                ),
                max_length=24,
            ),
        ),
    ]
