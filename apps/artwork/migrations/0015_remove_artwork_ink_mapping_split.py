from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("artwork", "0014_artwork_cylinder_length"),
    ]

    operations = [
        migrations.AlterField(
            model_name="artwork",
            name="color_list",
            field=models.JSONField(default=list, help_text="Free-text color names from the artwork."),
        ),
        migrations.RemoveField(
            model_name="artwork",
            name="color_mapping",
        ),
        migrations.RemoveField(
            model_name="artwork",
            name="ink_gsm_split_mode",
        ),
        migrations.RemoveField(
            model_name="artwork",
            name="ink_gsm_color_percentages",
        ),
        migrations.RemoveField(
            model_name="artwork",
            name="ink_gsm_by_color",
        ),
    ]
