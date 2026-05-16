from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("artwork", "0013_artwork_asset_file_and_cylinder_repeat"),
    ]

    operations = [
        migrations.AddField(
            model_name="artwork",
            name="cylinder_length_mm",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=10),
        ),
    ]
