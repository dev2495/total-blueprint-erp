from decimal import Decimal

import django.core.validators
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0013_inward_bill_notifications"),
    ]

    operations = [
        migrations.AddField(
            model_name="role",
            name="revoked_permissions",
            field=models.JSONField(blank=True, db_default=models.Value([], output_field=models.JSONField()), default=list),
        ),
        migrations.AddField(
            model_name="companyprofile",
            name="waste_reason_threshold_pct",
            field=models.DecimalField(
                db_default=Decimal("5.00"),
                decimal_places=2,
                default=Decimal("5.00"),
                max_digits=5,
                validators=[
                    django.core.validators.MinValueValidator(Decimal("0")),
                    django.core.validators.MaxValueValidator(Decimal("100")),
                ],
            ),
        ),
    ]
