from django.db import migrations, models


def infer_existing_substrate_mode(apps, schema_editor):
    Artwork = apps.get_model("artwork", "Artwork")
    Artwork.objects.filter(back_colors_count__gt=0).update(substrate_mode="TUBING")
    Artwork.objects.filter(back_colors_count=0).update(substrate_mode="SHEET")


class Migration(migrations.Migration):

    dependencies = [
        ("artwork", "0006_artwork_back_colors_artwork_back_colors_count_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="artwork",
            name="substrate_mode",
            field=models.CharField(
                choices=[("SHEET", "Sheet"), ("TUBING", "Tubing")],
                default="SHEET",
                max_length=12,
            ),
        ),
        migrations.RunPython(infer_existing_substrate_mode, migrations.RunPython.noop),
    ]
