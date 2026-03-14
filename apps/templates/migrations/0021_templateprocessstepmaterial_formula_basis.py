from django.db import migrations, models


def backfill_addon_formula_basis(apps, schema_editor):
    TemplateProcessStepMaterial = apps.get_model("templates", "TemplateProcessStepMaterial")

    addon_rows = TemplateProcessStepMaterial.objects.filter(category_code__iexact="ADDON")
    addon_rows.exclude(consumption_basis="CATEGORY_FORMULA").update(consumption_basis="CATEGORY_FORMULA")
    addon_rows.filter(formula_driver__isnull=True).update(formula_driver="ADDON_MASTER_WEIGHT_MODE")
    addon_rows.filter(formula_driver="").update(formula_driver="ADDON_MASTER_WEIGHT_MODE")
    addon_rows.filter(formula_driver="NONE").update(formula_driver="ADDON_MASTER_WEIGHT_MODE")

    TemplateProcessStepMaterial.objects.exclude(consumption_basis="CATEGORY_FORMULA").update(
        formula_driver="NONE",
        formula_params={},
    )


class Migration(migrations.Migration):
    dependencies = [
        ("templates", "0020_remove_templateprocesssteprollspec_size_input_mode"),
    ]

    operations = [
        migrations.AddField(
            model_name="templateprocessstepmaterial",
            name="formula_driver",
            field=models.CharField(
                choices=[("NONE", "None"), ("ADDON_MASTER_WEIGHT_MODE", "Addon Master Weight Mode")],
                default="NONE",
                help_text="Formula driver for CATEGORY_FORMULA basis.",
                max_length=40,
            ),
        ),
        migrations.AddField(
            model_name="templateprocessstepmaterial",
            name="formula_params",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.RunPython(backfill_addon_formula_basis, migrations.RunPython.noop),
    ]

