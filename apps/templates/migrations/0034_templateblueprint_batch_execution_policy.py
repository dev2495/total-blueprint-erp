from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("templates", "0033_template_version_lineage"),
    ]
    operations = [
        migrations.AddField(
            model_name="templateblueprint",
            name="batch_execution_policy",
            field=models.JSONField(
                blank=True,
                default=dict,
                help_text="Product execution defaults for live production batches, partial movement, auto batch creation, route joins, and matching rules.",
            ),
        ),
    ]
