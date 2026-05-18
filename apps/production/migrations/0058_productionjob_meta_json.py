from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0057_salesorderiteminhousedemand"),
    ]

    operations = [
        migrations.AddField(
            model_name="productionjob",
            name="meta_json",
            field=models.JSONField(
                blank=True,
                default=dict,
                help_text="Planner/runtime metadata such as layer signatures, gang groups, and stock-launch provenance.",
            ),
        ),
    ]
