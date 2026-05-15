import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("artwork", "0009_artwork_versioning"),
        ("materials", "0018_productmaster"),
    ]

    operations = [
        migrations.AddField(
            model_name="artwork",
            name="colorway_name",
            field=models.CharField(blank=True, default="", max_length=120),
        ),
        migrations.AddField(
            model_name="artwork",
            name="design_family_code",
            field=models.CharField(blank=True, default="", max_length=80),
        ),
        migrations.AddField(
            model_name="artwork",
            name="product_master",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="artworks", to="materials.productmaster"),
        ),
    ]
