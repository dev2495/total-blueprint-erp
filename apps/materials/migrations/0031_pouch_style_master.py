"""
Phase A · Pouch Style Master.

Adds the PouchStyleMaster table and three new fields on ProductMasterSize:
  - pouch_style (FK)
  - pouch_style_version
  - child_target_width_mm
  - child_target_override

Schema-only. Seed comes in 0032.
"""

import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0030_soft_delete_legacy_inner_pouch"),
        ("users", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="PouchStyleMaster",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("code", models.CharField(db_index=True, max_length=80, unique=True)),
                ("name", models.CharField(max_length=160)),
                ("description", models.TextField(blank=True, default="")),
                ("version", models.PositiveIntegerField(default=1)),
                (
                    "locked",
                    models.BooleanField(
                        default=False,
                        help_text="Set true once first ProductMasterSize binds. Editing then spawns a new version.",
                    ),
                ),
                ("visual_emoji", models.CharField(blank=True, default="🛍️", max_length=8)),
                (
                    "visual_svg",
                    models.TextField(
                        blank=True,
                        default="",
                        help_text="Optional inline SVG cheat-sheet of the pouch shape.",
                    ),
                ),
                ("faces", models.PositiveSmallIntegerField(default=2)),
                (
                    "default_roll_axis",
                    models.CharField(
                        choices=[
                            ("WIDTH", "Width axis"),
                            ("HEIGHT", "Height axis"),
                            ("BOTH", "Both axes"),
                            ("NONE", "None"),
                        ],
                        default="WIDTH",
                        max_length=10,
                    ),
                ),
                ("allowed_fields", models.JSONField(blank=True, default=dict)),
                ("field_adjustments", models.JSONField(blank=True, default=dict)),
                (
                    "formula_kind",
                    models.CharField(
                        choices=[
                            ("SIMPLE_DOUBLE", "Standard sealed pouch · 2W + trim"),
                            ("THREE_SIDE_SEAL", "Three-side seal · 2W + trim"),
                            ("GUSSETED_SIDE", "Side gusset (both sides) · 2(W + G) + trim"),
                            ("GUSSETED_BOTTOM", "Bottom gusset · 2W + G × bottom_factor + trim"),
                            ("QUAD_SEAL", "Quad seal · 2(W + G) + trim"),
                            ("FLAT_BOTTOM", "Flat bottom · 2W + 2G + trim"),
                            ("CENTER_SEAL_H", "Center seal · H + overlap + trim"),
                            ("SPOUT", "Spout pouch · 2W + flap + trim"),
                            ("STICK_PACK", "Stick pack · W × stick_factor + trim"),
                            ("SACHET", "Sachet · 2W + trim"),
                            ("SHAPED_OVERRIDE", "Shaped / custom · operator enters target directly"),
                            ("CUSTOM_AST", "Custom formula (operator-built expression tree)"),
                        ],
                        default="SIMPLE_DOUBLE",
                        max_length=24,
                    ),
                ),
                ("formula_params", models.JSONField(blank=True, default=dict)),
                ("formula_ast", models.JSONField(blank=True, default=dict)),
                (
                    "formula_expression",
                    models.TextField(
                        blank=True,
                        default="",
                        help_text="Human-readable mirror of the AST/kind for display only.",
                    ),
                ),
                ("deprecated", models.BooleanField(default=False)),
                ("sort_order", models.PositiveIntegerField(default=0)),
                ("notes", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="pouch_styles_created",
                        to="users.user",
                    ),
                ),
                (
                    "updated_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="pouch_styles_updated",
                        to="users.user",
                    ),
                ),
            ],
            options={
                "db_table": "pouch_styles",
                "ordering": ["sort_order", "name"],
            },
        ),
        migrations.AddField(
            model_name="productmastersize",
            name="pouch_style_master",
            field=models.ForeignKey(
                blank=True,
                help_text="Pouch style master defining formula + allowed fields for this size.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="sizes",
                to="materials.pouchstylemaster",
            ),
        ),
        migrations.AddField(
            model_name="productmastersize",
            name="pouch_style_version",
            field=models.PositiveIntegerField(
                default=0,
                help_text="Snapshot of the bound pouch style's version at the time of binding.",
            ),
        ),
        migrations.AddField(
            model_name="productmastersize",
            name="child_target_width_mm",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="The pouch's finished web requirement. Auto-computed by the pouch style formula, with optional manual override.",
                max_digits=10,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="productmastersize",
            name="child_target_override",
            field=models.BooleanField(
                default=False,
                help_text="True when child_target_width_mm was set manually instead of computed.",
            ),
        ),
    ]
