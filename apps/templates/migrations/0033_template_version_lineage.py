import uuid

import django.db.models.deletion
from django.db import migrations, models


def backfill_version_groups(apps, schema_editor):
    TemplateBlueprint = apps.get_model("templates", "TemplateBlueprint")
    for template in TemplateBlueprint.objects.filter(version_group__isnull=True).only("id"):
        template.version_group = template.id
        template.save(update_fields=["version_group"])


class Migration(migrations.Migration):

    dependencies = [
        ("templates", "0032_template_step_route_dispatch"),
    ]

    operations = [
        migrations.AddField(
            model_name="templateblueprint",
            name="version_group",
            field=models.UUIDField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name="templateblueprint",
            name="is_current_version",
            field=models.BooleanField(
                db_index=True,
                default=True,
                help_text="Only current versions are shown in normal Template Studio selectors.",
            ),
        ),
        migrations.AddField(
            model_name="templateblueprint",
            name="source_template",
            field=models.ForeignKey(
                blank=True,
                help_text="Live template copied to create this editable correction draft.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="correction_drafts",
                to="templates.templateblueprint",
            ),
        ),
        migrations.AddField(
            model_name="templateblueprint",
            name="superseded_by",
            field=models.ForeignKey(
                blank=True,
                help_text="New live template that replaced this preserved historical version.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="superseded_versions",
                to="templates.templateblueprint",
            ),
        ),
        migrations.AddField(
            model_name="templateblueprint",
            name="correction_reason",
            field=models.TextField(
                blank=True,
                default="",
                help_text="Internal reason captured when a live template is safely edited.",
            ),
        ),
        migrations.RunPython(backfill_version_groups, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="templateblueprint",
            name="version_group",
            field=models.UUIDField(
                db_index=True,
                default=uuid.uuid4,
                help_text="Stable hidden lineage key for safe template corrections.",
            ),
        ),
    ]
