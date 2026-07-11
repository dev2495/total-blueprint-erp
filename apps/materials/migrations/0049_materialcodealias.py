# Generated manually for the material-code continuity guard.

import uuid

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0048_canonical_pouch_styles"),
    ]

    operations = [
        migrations.CreateModel(
            name="MaterialCodeAlias",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("alias", models.CharField(db_index=True, max_length=100, unique=True)),
                (
                    "category",
                    models.CharField(
                        choices=[
                            ("FILM_FAMILY", "Film Family"),
                            ("FILM_VARIANT", "Film Variant"),
                            ("GRANULE", "Granule"),
                            ("INK", "Ink"),
                            ("SOLVENT", "Solvent"),
                            ("ADHESIVE", "Adhesive"),
                            ("PACKAGING", "Packaging"),
                            ("ADDON", "Add-On"),
                            ("POD", "POD Film"),
                        ],
                        db_index=True,
                        max_length=20,
                    ),
                ),
                ("active", models.BooleanField(default=True)),
                ("notes", models.CharField(blank=True, default="", max_length=255)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "material",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="code_aliases",
                        to="materials.inventorymaterial",
                    ),
                ),
            ],
            options={"db_table": "inventory_material_code_aliases", "ordering": ["alias"]},
        ),
    ]
