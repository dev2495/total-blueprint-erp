from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("templates", "0034_templateblueprint_batch_execution_policy"),
    ]

    operations = [
        migrations.AddField(
            model_name="templateprocessstep",
            name="optional_at_planning",
            field=models.BooleanField(
                default=False,
                help_text="Planner may skip this route step while releasing or replanning this template route.",
            ),
        ),
        migrations.AddField(
            model_name="templateprocessstep",
            name="skippable_after_previous_output",
            field=models.BooleanField(
                default=False,
                help_text="WCM may skip this step for a produced batch after the previous route step output is posted.",
            ),
        ),
    ]
