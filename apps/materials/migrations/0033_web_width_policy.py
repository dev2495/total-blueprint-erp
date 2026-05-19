"""WebWidthPolicy table + seed one default policy."""

import uuid

from django.db import migrations, models


def seed_default(apps, schema_editor):
    WebWidthPolicy = apps.get_model("materials", "WebWidthPolicy")
    WebWidthPolicy.objects.update_or_create(
        code="STANDARD",
        defaults={
            "name": "Standard slit · 1-up to 3-up",
            "description": "Default for most pouch routes. Allows 1, 2 or 3 lanes. 5 mm slitter trim per cut. 50 mm minimum remainder.",
            "is_default": True,
            "allowed_lanes": [1, 2, 3],
            "allowed_parent_widths": [],
            "slitting_waste_rule": {
                "inter_cut_mm": 5,
                "edge_trim_mm": 2,
                "formula": "PER_CUT",
            },
            "min_remainder_mm": 50,
            "prefer_remainder_first": True,
        },
    )


def unseed_default(apps, schema_editor):
    WebWidthPolicy = apps.get_model("materials", "WebWidthPolicy")
    WebWidthPolicy.objects.filter(code="STANDARD").delete()


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0032_seed_pouch_styles"),
    ]

    operations = [
        migrations.CreateModel(
            name="WebWidthPolicy",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("code", models.CharField(db_index=True, max_length=80, unique=True)),
                ("name", models.CharField(max_length=160)),
                ("description", models.TextField(blank=True, default="")),
                (
                    "is_default",
                    models.BooleanField(
                        default=False,
                        help_text="True for the global fallback policy used when a route has none attached.",
                    ),
                ),
                ("allowed_lanes", models.JSONField(blank=True, default=list)),
                ("allowed_parent_widths", models.JSONField(blank=True, default=list)),
                (
                    "slitting_waste_rule",
                    models.JSONField(
                        blank=True,
                        default=dict,
                        help_text="JSON: { inter_cut_mm, edge_trim_mm, formula: PER_CUT|PER_LANE|FIXED }",
                    ),
                ),
                (
                    "min_remainder_mm",
                    models.PositiveIntegerField(
                        default=50,
                        help_text="Remainder rolls below this width go straight to scrap.",
                    ),
                ),
                ("prefer_remainder_first", models.BooleanField(default=True)),
                ("deprecated", models.BooleanField(default=False)),
                ("notes", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "db_table": "web_width_policies",
                "ordering": ["-is_default", "name"],
            },
        ),
        migrations.RunPython(seed_default, unseed_default),
    ]
