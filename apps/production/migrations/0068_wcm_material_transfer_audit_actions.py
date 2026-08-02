from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0067_bom_weight_precision"),
    ]

    operations = [
        migrations.AlterField(
            model_name="productionwcmauditevent",
            name="action",
            field=models.CharField(
                choices=[
                    ("ASSIGN_MACHINE", "Assign Machine"),
                    ("ALLOCATE_ROLLS", "Allocate Rolls"),
                    ("UNASSIGN_ROLL", "Unassign Roll"),
                    ("RELEASE_TO_MACHINE", "Release To Machine"),
                    ("MATERIAL_ISSUE", "Material Issue"),
                    ("MATERIAL_TRANSFER_REQUEST", "Material Transfer Request"),
                    ("MATERIAL_TRANSFER_RECEIPT", "Material Transfer Receipt"),
                    ("MATERIAL_POLICY_OVERRIDE", "Material Policy Override"),
                    ("ROUTE_STEP_SKIP", "Route Step Skip"),
                    ("SHORT_CLOSE", "Short Close"),
                    ("CANCEL", "Cancel"),
                ],
                max_length=32,
            ),
        ),
    ]
