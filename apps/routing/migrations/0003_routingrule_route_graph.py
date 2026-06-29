from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("routing", "0002_routingrule_allowed_workcenters_and_more"),
    ]
    operations = [
        migrations.AddField(
            model_name="routingrule",
            name="route_graph",
            field=models.JSONField(
                blank=True,
                default=dict,
                help_text="Optional DAG route definition. Empty routes are interpreted from ordered_processes so existing linear routes keep working.",
            ),
        ),
    ]
