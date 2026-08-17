import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("recipes", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="extrusionrecipe",
            name="revision_no",
            field=models.PositiveIntegerField(default=1),
        ),
        migrations.AddField(
            model_name="extrusionrecipe",
            name="updated_at",
            field=models.DateTimeField(auto_now=True),
        ),
        migrations.CreateModel(
            name="ExtrusionRecipeRevision",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("revision_no", models.PositiveIntegerField()),
                ("event", models.CharField(choices=[("CREATE", "Created"), ("BASELINE", "Baseline captured"), ("UPDATE", "Updated"), ("DISABLE", "Disabled"), ("ENABLE", "Enabled")], max_length=16)),
                ("change_reason", models.CharField(blank=True, default="", max_length=255)),
                ("contract_snapshot", models.JSONField(default=dict)),
                ("components_snapshot", models.JSONField(default=list)),
                ("impact_snapshot", models.JSONField(default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("changed_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="extrusion_recipe_revisions", to=settings.AUTH_USER_MODEL)),
                ("recipe", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="revisions", to="recipes.extrusionrecipe")),
            ],
            options={
                "db_table": "extrusion_recipe_revisions",
                "ordering": ["-revision_no", "-created_at"],
            },
        ),
        migrations.AddConstraint(
            model_name="extrusionreciperevision",
            constraint=models.UniqueConstraint(fields=("recipe", "revision_no"), name="uniq_extrusion_recipe_revision_no"),
        ),
    ]
