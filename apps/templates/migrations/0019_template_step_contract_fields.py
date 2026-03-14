from django.db import migrations, models


def backfill_roll_handling_and_capture(apps, schema_editor):
    TemplateProcessStepRollSpec = apps.get_model("templates", "TemplateProcessStepRollSpec")
    TemplateProcessStepMaterial = apps.get_model("templates", "TemplateProcessStepMaterial")

    size_mode_map = {
        "NONE": "PROCESS_DEFAULT",
        "WIDTH": "ROLL_SINGLE",
        "WIDTH_LENGTH": "ROLL_MULTI",
        "GRID": "GRID_SPLIT",
    }
    for row in TemplateProcessStepRollSpec.objects.all().only("id", "size_input_mode"):
        mode = size_mode_map.get(str(row.size_input_mode or "NONE").upper(), "PROCESS_DEFAULT")
        TemplateProcessStepRollSpec.objects.filter(id=row.id).update(operator_entry_mode=mode)

    chem_categories = {"INK", "INKS", "ADHESIVE", "SOLVENT", "CHEMICAL"}
    for row in TemplateProcessStepMaterial.objects.all().only("id", "category_code"):
        category = str(row.category_code or "").upper()
        capture_mode = "AUTO_ESTIMATED_CONFIRM" if category in chem_categories else "AUTO_FROM_OUTPUT"
        TemplateProcessStepMaterial.objects.filter(id=row.id).update(capture_mode=capture_mode)


class Migration(migrations.Migration):

    dependencies = [
        ("templates", "0018_templateprocessstepmaterial_issue_policy"),
    ]

    operations = [
        migrations.AddField(
            model_name="templateprocessstep",
            name="is_removed_from_route",
            field=models.BooleanField(
                default=False,
                help_text="Marks steps that no longer exist in the bound routing rule but are preserved for history/migration.",
            ),
        ),
        migrations.AddField(
            model_name="templateprocesssteprollspec",
            name="operator_entry_mode",
            field=models.CharField(
                choices=[
                    ("PROCESS_DEFAULT", "Process Default"),
                    ("ROLL_SINGLE", "Single Roll Output"),
                    ("ROLL_MULTI", "Multiple Roll Outputs"),
                    ("GRID_SPLIT", "Grid Split"),
                    ("DISCRETE_ONLY", "Discrete Only"),
                ],
                default="PROCESS_DEFAULT",
                help_text="Operator UI entry shape. Refines the process contract; does not override process input/output behavior.",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="templateprocessstepmaterial",
            name="capture_mode",
            field=models.CharField(
                choices=[
                    ("AUTO_FROM_OUTPUT", "Auto From Output"),
                    ("AUTO_ESTIMATED_CONFIRM", "Auto Estimated Then Confirm"),
                    ("OPERATOR_REQUIRED", "Operator Required"),
                ],
                default="AUTO_FROM_OUTPUT",
                help_text="Controls how the operator/execution surfaces collect actual usage for this line.",
                max_length=24,
            ),
        ),
        migrations.RunPython(backfill_roll_handling_and_capture, migrations.RunPython.noop),
    ]
