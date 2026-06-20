from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0063_planner_hot_path_indexes"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="productionjob",
            index=models.Index(fields=["machine", "job_state"], name="prod_job_machine_state"),
        ),
    ]
