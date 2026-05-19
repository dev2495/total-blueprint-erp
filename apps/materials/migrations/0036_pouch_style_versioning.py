"""Allow multiple versions of the same pouch style code.

Drops unique on `code` and adds a composite unique on (code, version).
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0035_pouch_style_formula_choices"),
    ]

    operations = [
        migrations.AlterField(
            model_name="pouchstylemaster",
            name="code",
            field=models.CharField(db_index=True, max_length=80),
        ),
        migrations.AddConstraint(
            model_name="pouchstylemaster",
            constraint=models.UniqueConstraint(
                fields=["code", "version"],
                name="pouchstyle_code_version_unique",
            ),
        ),
        migrations.AlterModelOptions(
            name="pouchstylemaster",
            options={"ordering": ["sort_order", "name", "-version"]},
        ),
    ]
