from django.db import migrations, models
import django.db.models.deletion


def hide_existing_artwork_catalog(apps, schema_editor):
    Artwork = apps.get_model("artwork", "Artwork")
    Artwork.objects.update(is_current_version=False)


def restore_existing_artwork_catalog(apps, schema_editor):
    Artwork = apps.get_model("artwork", "Artwork")
    Artwork.objects.update(is_current_version=True)


class Migration(migrations.Migration):

    dependencies = [
        ("artwork", "0008_artworkimage_sheet_back_color_cleanup"),
    ]

    operations = [
        migrations.AddField(
            model_name="artwork",
            name="is_current_version",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="artwork",
            name="previous_version",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="next_versions",
                to="artwork.artwork",
            ),
        ),
        migrations.RunPython(hide_existing_artwork_catalog, restore_existing_artwork_catalog),
    ]
