"""Update PouchStyleMaster.formula_kind choices to LINEAR / SHAPED_OVERRIDE / CUSTOM_AST."""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0034_clear_seeded_pouch_styles"),
    ]

    operations = [
        migrations.AlterField(
            model_name="pouchstylemaster",
            name="formula_kind",
            field=models.CharField(
                choices=[
                    ("LINEAR", "Linear formula · Σ (coefficient × field) + trim"),
                    ("SHAPED_OVERRIDE", "Operator enters target directly"),
                    ("CUSTOM_AST", "Custom expression tree (advanced)"),
                ],
                default="LINEAR",
                max_length=24,
            ),
        ),
    ]
