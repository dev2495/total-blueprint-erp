from django.db import migrations, models
import django.db.models.deletion
import uuid


def backfill_pod_skus(apps, schema_editor):
    InventoryMaterial = apps.get_model("materials", "InventoryMaterial")
    PodSku = apps.get_model("materials", "PodSku")
    PodSkuVariant = apps.get_model("materials", "PodSkuVariant")

    for material in InventoryMaterial.objects.filter(category="POD"):
        sku_code = str(getattr(material, "code", "") or "").strip().upper()
        sku_name = str(getattr(material, "name", "") or sku_code).strip()
        pod_sku, _ = PodSku.objects.get_or_create(
            code=sku_code,
            defaults={
                "name": sku_name,
                "family": str(getattr(material, "pod_type", "") or "POD").strip().upper() or "POD",
                "active": str(getattr(material, "status", "") or "ACTIVE").upper() == "ACTIVE",
            },
        )
        if not pod_sku.name:
            pod_sku.name = sku_name
        pod_sku.family = str(getattr(material, "pod_type", "") or pod_sku.family or "POD").strip().upper() or "POD"
        pod_sku.active = str(getattr(material, "status", "") or "ACTIVE").upper() == "ACTIVE"
        pod_sku.save(update_fields=["name", "family", "active", "updated_at"])

        variant_code = "CORE"
        variant_name = sku_name
        PodSkuVariant.objects.get_or_create(
            pod_sku=pod_sku,
            code=variant_code,
            defaults={
                "name": variant_name,
                "material_id": material.id,
                "active": str(getattr(material, "status", "") or "ACTIVE").upper() == "ACTIVE",
                "production_defaults_json": {},
                "reporting_attributes_json": {
                    "pod_type": str(getattr(material, "pod_type", "") or "").upper(),
                },
            },
        )


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0011_inventorymaterial_packaging_defaults_json_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="PodSku",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("code", models.CharField(db_index=True, max_length=80, unique=True)),
                ("name", models.CharField(max_length=255)),
                ("family", models.CharField(blank=True, default="", max_length=120)),
                ("active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "db_table": "pod_skus",
                "ordering": ["name", "code"],
            },
        ),
        migrations.CreateModel(
            name="PodSkuVariant",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("code", models.CharField(max_length=80)),
                ("name", models.CharField(max_length=255)),
                ("active", models.BooleanField(default=True)),
                ("production_defaults_json", models.JSONField(blank=True, default=dict)),
                ("reporting_attributes_json", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("material", models.ForeignKey(limit_choices_to={"category": "POD"}, on_delete=django.db.models.deletion.PROTECT, related_name="pod_sku_variants", to="materials.inventorymaterial")),
                ("pod_sku", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="variants", to="materials.podsku")),
            ],
            options={
                "db_table": "pod_sku_variants",
                "ordering": ["pod_sku__name", "name", "code"],
            },
        ),
        migrations.AddConstraint(
            model_name="podskuvariant",
            constraint=models.UniqueConstraint(fields=("pod_sku", "code"), name="pod_sku_variant_code_unique_per_sku"),
        ),
        migrations.RunPython(backfill_pod_skus, migrations.RunPython.noop),
    ]
