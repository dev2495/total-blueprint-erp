from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0052_qualityreading"),
        ("sales", "0021_salesorder_remarks_salesorder_ship_to_customer_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="salesskuvariant",
            name="derived_from_planner_variant",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="sales_variants",
                to="production.plannerskuvariant",
            ),
        ),
    ]
