from django.db import migrations, models


def hide_existing_cylinder_catalog(apps, schema_editor):
    Cylinder = apps.get_model("tooling", "Cylinder")
    Cylinder.objects.update(is_catalog_active=False)


def restore_existing_cylinder_catalog(apps, schema_editor):
    Cylinder = apps.get_model("tooling", "Cylinder")
    Cylinder.objects.update(is_catalog_active=True)


class Migration(migrations.Migration):

    dependencies = [
        ("tooling", "0007_cylinderslotassignment"),
    ]

    operations = [
        migrations.AddField(
            model_name="cylinder",
            name="is_catalog_active",
            field=models.BooleanField(default=True),
        ),
        migrations.RunPython(hide_existing_cylinder_catalog, restore_existing_cylinder_catalog),
    ]
