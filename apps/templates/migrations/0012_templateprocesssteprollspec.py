from decimal import Decimal
from django.db import migrations, models
import django.db.models.deletion
import uuid


def _as_decimal(value):
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value))
    except Exception:
        return None


def _layer_defaults(template):
    layer_schema = getattr(template, "layer_schema", None) or []
    if isinstance(layer_schema, list) and len(layer_schema) > 0 and isinstance(layer_schema[0], dict):
        l0 = layer_schema[0]
        return {
            "variant_id": l0.get("variant_id") or l0.get("material_id"),
            "grade_id": l0.get("grade_id"),
            "thickness_micron": _as_decimal(l0.get("thickness_micron") or l0.get("thickness")),
        }
    return {"variant_id": None, "grade_id": None, "thickness_micron": None}


def seed_roll_specs(apps, schema_editor):
    TemplateProcessStep = apps.get_model("templates", "TemplateProcessStep")
    TemplateProcessStepRollSpec = apps.get_model("templates", "TemplateProcessStepRollSpec")

    for step in TemplateProcessStep.objects.select_related("template", "process").all():
        process = getattr(step, "process", None)
        behavior = (getattr(process, "roll_behavior", None) or "NONE").upper()
        input_form = (getattr(process, "input_form", None) or "BULK").upper()
        output_form = (getattr(process, "output_form", None) or "ROLL").upper()

        layer = _layer_defaults(step.template)
        input_roll_count = 0
        thickness_rule = "TEMPLATE_DEFAULT"
        width_rule = "TEMPLATE_DEFAULT"
        size_input_mode = "NONE"
        fixed_thickness_micron = None

        if behavior == "CREATE_NEW":
            input_roll_count = 1 if input_form == "ROLL" else 0
            thickness_rule = "FIXED"
            width_rule = "OPERATOR"
            size_input_mode = "WIDTH_LENGTH"
            fixed_thickness_micron = layer["thickness_micron"]
        elif behavior == "MODIFY_EXISTING":
            input_roll_count = 1
            thickness_rule = "INHERIT_INPUT"
            width_rule = "LOCK_INPUT"
            size_input_mode = "NONE"
        elif behavior == "MULTI_INPUT_COMBINE":
            input_roll_count = 2
            thickness_rule = "SUM_INPUTS"
            width_rule = "MIN_INPUT"
            size_input_mode = "NONE"
        elif behavior == "SPLIT":
            input_roll_count = 1
            thickness_rule = "INHERIT_INPUT"
            width_rule = "OPERATOR_GRID"
            size_input_mode = "GRID"
        else:
            input_roll_count = 0
            thickness_rule = "TEMPLATE_DEFAULT"
            width_rule = "TEMPLATE_DEFAULT"
            size_input_mode = "NONE"

        if input_form != "ROLL":
            input_roll_count = 0 if behavior == "CREATE_NEW" else input_roll_count
        if output_form != "ROLL":
            layer["variant_id"] = None
            layer["grade_id"] = None
            fixed_thickness_micron = None

        TemplateProcessStepRollSpec.objects.update_or_create(
            template_step=step,
            defaults={
                "input_roll_count": max(0, int(input_roll_count or 0)),
                "output_variant_id": layer["variant_id"],
                "output_grade_id": layer["grade_id"],
                "thickness_rule": thickness_rule,
                "fixed_thickness_micron": fixed_thickness_micron,
                "width_rule": width_rule,
                "fixed_width_mm": None,
                "size_input_mode": size_input_mode,
                "notes": "",
            },
        )


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0001_initial"),
        ("recipes", "0001_initial"),
        ("templates", "0011_alter_templateprocessstepmaterial_value"),
    ]

    operations = [
        migrations.CreateModel(
            name="TemplateProcessStepRollSpec",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("input_roll_count", models.PositiveIntegerField(default=0)),
                (
                    "thickness_rule",
                    models.CharField(
                        choices=[
                            ("INHERIT_INPUT", "Inherit Input"),
                            ("SUM_INPUTS", "Sum Inputs"),
                            ("FIXED", "Fixed"),
                            ("TEMPLATE_DEFAULT", "Template Default"),
                        ],
                        default="TEMPLATE_DEFAULT",
                        max_length=20,
                    ),
                ),
                ("fixed_thickness_micron", models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True)),
                (
                    "width_rule",
                    models.CharField(
                        choices=[
                            ("LOCK_INPUT", "Lock Input Width"),
                            ("MIN_INPUT", "Min Input Width"),
                            ("FIXED", "Fixed"),
                            ("OPERATOR", "Operator Entered"),
                            ("OPERATOR_GRID", "Operator Grid"),
                            ("TEMPLATE_DEFAULT", "Template Default"),
                        ],
                        default="TEMPLATE_DEFAULT",
                        max_length=20,
                    ),
                ),
                ("fixed_width_mm", models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True)),
                (
                    "size_input_mode",
                    models.CharField(
                        choices=[
                            ("NONE", "None"),
                            ("WIDTH", "Width"),
                            ("WIDTH_LENGTH", "Width + Length"),
                            ("GRID", "Split Grid"),
                        ],
                        default="NONE",
                        max_length=20,
                    ),
                ),
                ("notes", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "output_grade",
                    models.ForeignKey(
                        blank=True,
                        help_text="Target output grade for this step",
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="template_step_roll_specs",
                        to="recipes.recipegrade",
                    ),
                ),
                (
                    "output_variant",
                    models.ForeignKey(
                        blank=True,
                        help_text="Target output variant/material for this step",
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="template_step_roll_specs",
                        to="materials.inventorymaterial",
                    ),
                ),
                (
                    "template_step",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="roll_spec",
                        to="templates.templateprocessstep",
                    ),
                ),
            ],
            options={
                "db_table": "template_process_step_roll_specs",
            },
        ),
        migrations.RunPython(seed_roll_specs, migrations.RunPython.noop),
    ]
