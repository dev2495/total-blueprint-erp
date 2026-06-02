from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("inventory", "0046_inventoryroll_stock_form_inventoryroll_width_basis_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="rolllink",
            name="relation_type",
            field=models.CharField(
                choices=[
                    ("SPLIT", "Split"),
                    ("MERGE", "Merge"),
                    ("PROCESS_OUTPUT", "Process Output"),
                    ("FORM_CONVERT", "Stock Form Convert"),
                ],
                max_length=20,
            ),
        ),
    ]
