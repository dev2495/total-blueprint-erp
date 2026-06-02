from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("inventory", "0047_alter_rolllink_relation_type"),
    ]

    operations = [
        migrations.AddField(
            model_name="inkmaterial",
            name="swatch_hex",
            field=models.CharField(
                blank=True,
                default="",
                help_text="Exact UI swatch selected by the ink master user, e.g. #1D4ED8.",
                max_length=7,
            ),
        ),
    ]
