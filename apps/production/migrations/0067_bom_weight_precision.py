from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("production", "0066_alter_productionwcmauditevent_action"),
    ]

    operations = [
        migrations.AlterField(
            model_name="plannedstockorder",
            name="unit_weight_g",
            field=models.DecimalField(decimal_places=6, default=0, max_digits=16),
        ),
        migrations.AlterField(
            model_name="plannedstockorder",
            name="total_weight_kg",
            field=models.DecimalField(decimal_places=6, default=0, max_digits=16),
        ),
    ]
