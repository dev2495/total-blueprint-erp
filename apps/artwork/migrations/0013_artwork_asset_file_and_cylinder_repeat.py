from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("artwork", "0012_backfill_artwork_ink_gsm_defaults"),
    ]

    operations = [
        migrations.AddField(
            model_name="artwork",
            name="cylinder_circumference_mm",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=10),
        ),
        migrations.AlterField(
            model_name="artwork",
            name="image",
            field=models.FileField(blank=True, null=True, upload_to="artworks/"),
        ),
        migrations.AlterField(
            model_name="artworkimage",
            name="image",
            field=models.FileField(upload_to="artworks/"),
        ),
    ]
