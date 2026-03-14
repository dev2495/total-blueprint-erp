from django.db import migrations, models


def backfill_consumption_basis(apps, schema_editor):
    TemplateProcessStepMaterial = apps.get_model("templates", "TemplateProcessStepMaterial")
    legacy_map = {
        "KG": "FIXED_KG",
        "PCS": "FIXED_PCS",
        "GSM": "SNAPSHOT_GSM",
        "PERCENT": "INVALID_LEGACY",
        "RECIPE": "INVALID_LEGACY",
    }
    for row in TemplateProcessStepMaterial.objects.all().only("id", "quantity_mode"):
        basis = legacy_map.get(str(row.quantity_mode or "KG").upper(), "FIXED_KG")
        TemplateProcessStepMaterial.objects.filter(id=row.id).update(consumption_basis=basis)


class Migration(migrations.Migration):

    dependencies = [
        ("templates", "0016_remove_templateblueprint_artwork_and_film_constraints"),
    ]

    operations = [
        migrations.AddField(
            model_name="templateprocessstepmaterial",
            name="consumption_basis",
            field=models.CharField(
                choices=[
                    ("SNAPSHOT_GSM", "Snapshot GSM"),
                    ("FIXED_KG", "Fixed KG"),
                    ("FIXED_PCS", "Fixed PCS"),
                    ("INVALID_LEGACY", "Invalid Legacy Mapping"),
                ],
                default="FIXED_KG",
                max_length=20,
            ),
        ),
        migrations.RunPython(backfill_consumption_basis, migrations.RunPython.noop),
    ]
