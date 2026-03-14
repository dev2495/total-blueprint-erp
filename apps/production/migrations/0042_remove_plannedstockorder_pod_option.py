from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0041_jobmaterialrequirement_planned_actual_fields"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="plannedstockorder",
            name="pod_option",
        ),
    ]

