from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("sales", "0035_sales_hot_path_indexes"),
    ]

    operations = [
        migrations.AlterField(
            model_name="quotationitem",
            name="unit_weight_g",
            field=models.DecimalField(decimal_places=6, default=0, max_digits=16),
        ),
        migrations.AlterField(
            model_name="quotationitem",
            name="total_weight_kg",
            field=models.DecimalField(decimal_places=6, default=0, max_digits=16),
        ),
        migrations.AlterField(
            model_name="salesorderitem",
            name="unit_weight_g",
            field=models.DecimalField(decimal_places=6, default=0, max_digits=16),
        ),
        migrations.AlterField(
            model_name="salesorderitem",
            name="total_weight_kg",
            field=models.DecimalField(decimal_places=6, default=0, max_digits=16),
        ),
    ]
