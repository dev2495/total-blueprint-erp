from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("templates", "0019_template_step_contract_fields"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="templateprocesssteprollspec",
            name="size_input_mode",
        ),
    ]

