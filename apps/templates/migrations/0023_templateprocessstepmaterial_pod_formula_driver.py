from django.db import migrations


def forward_set_pod_formula(apps, schema_editor):
    Model = apps.get_model("templates", "TemplateProcessStepMaterial")
    Model.objects.filter(category_code="POD").exclude(consumption_basis="CATEGORY_FORMULA").update(
        consumption_basis="CATEGORY_FORMULA"
    )
    Model.objects.filter(category_code="POD", consumption_basis="CATEGORY_FORMULA").update(
        formula_driver="POD_MASTER_PROFILE"
    )


def backward_unset_pod_formula(apps, schema_editor):
    Model = apps.get_model("templates", "TemplateProcessStepMaterial")
    Model.objects.filter(category_code="POD", formula_driver="POD_MASTER_PROFILE").update(
        formula_driver="NONE"
    )


class Migration(migrations.Migration):

    dependencies = [
        ("templates", "0022_alter_templateprocessstepmaterial_consumption_basis"),
    ]

    operations = [
        migrations.RunPython(forward_set_pod_formula, backward_unset_pod_formula),
    ]
