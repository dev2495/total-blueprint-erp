from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0048_materialconsumptionlog_granule_code"),
    ]

    operations = [
        migrations.AddField(
            model_name="productionjob",
            name="current_step_material_confirmations",
            field=models.JSONField(
                blank=True,
                default=list,
                help_text="WCM-selected current-step material actuals, including granule code split issue rows.",
            ),
        ),
    ]
