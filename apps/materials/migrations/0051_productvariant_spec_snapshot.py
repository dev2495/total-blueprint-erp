from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("materials", "0050_canonical_granule_quality_codes")]

    operations = [
        migrations.AddField(
            model_name="productvariant",
            name="spec_snapshot",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
