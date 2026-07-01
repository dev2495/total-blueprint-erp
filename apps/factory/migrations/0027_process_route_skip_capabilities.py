from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("factory", "0026_process_stock_form_capabilities"),
    ]

    operations = [
        migrations.AddField(
            model_name="process",
            name="allows_optional_at_planning",
            field=models.BooleanField(
                default=False,
                help_text="Capability ceiling: route steps using this process may be configured as planner-skippable.",
            ),
        ),
        migrations.AddField(
            model_name="process",
            name="allows_skip_after_previous_output",
            field=models.BooleanField(
                default=False,
                help_text="Capability ceiling: route steps using this process may be configured as WCM-skippable after the prior output is posted.",
            ),
        ),
    ]
