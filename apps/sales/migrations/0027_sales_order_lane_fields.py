"""Add lane fields on SalesOrderItem for the production-lane model."""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("sales", "0026_salessku_axis_values_template"),
    ]

    operations = [
        migrations.AddField(
            model_name="salesorderitem",
            name="preferred_lane_count",
            field=models.PositiveSmallIntegerField(
                default=1,
                help_text="How many lanes (N-up) this order runs at. Defaults to last successful order for same customer + size.",
            ),
        ),
        migrations.AddField(
            model_name="salesorderitem",
            name="planned_parent_width_mm",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="Derived from child_target × preferred_lane + policy trim. Set at order confirm.",
                max_digits=10,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="salesorderitem",
            name="lane_count_source",
            field=models.CharField(
                default="POLICY_DEFAULT",
                help_text="REPEAT_DEFAULT | OPERATOR_CHOICE | POLICY_DEFAULT",
                max_length=24,
            ),
        ),
    ]
