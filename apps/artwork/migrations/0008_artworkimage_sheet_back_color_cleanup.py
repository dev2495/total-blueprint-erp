from django.db import migrations, models
import django.db.models.deletion
import uuid


def seed_artwork_images(apps, schema_editor):
    Artwork = apps.get_model("artwork", "Artwork")
    ArtworkImage = apps.get_model("artwork", "ArtworkImage")
    for artwork in Artwork.objects.exclude(image=""):
        image_name = str(getattr(artwork, "image", "") or "").strip()
        if not image_name:
            continue
        ArtworkImage.objects.get_or_create(
            artwork=artwork,
            sort_order=0,
            defaults={"image": image_name},
        )


class Migration(migrations.Migration):

    dependencies = [
        ("artwork", "0007_artwork_substrate_mode"),
    ]

    operations = [
        migrations.CreateModel(
            name="ArtworkImage",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("image", models.ImageField(upload_to="artworks/")),
                ("sort_order", models.PositiveSmallIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "artwork",
                    models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="images", to="artwork.artwork"),
                ),
            ],
            options={
                "db_table": "artwork_images",
                "ordering": ["sort_order", "created_at"],
            },
        ),
        migrations.RunPython(seed_artwork_images, migrations.RunPython.noop),
    ]
