import uuid

import django.db.models.deletion
from django.db import migrations, models
from django.db.models import Q


def seed_existing_direct_cylinder_slots(apps, schema_editor):
    Cylinder = apps.get_model("tooling", "Cylinder")
    CylinderSlotAssignment = apps.get_model("tooling", "CylinderSlotAssignment")
    for cylinder in Cylinder.objects.exclude(artwork_id=None):
        side = str(cylinder.side or "FRONT").upper()
        if side not in {"FRONT", "BACK"}:
            side = "FRONT"
        slot = int(cylinder.side_slot_index or 0)
        if slot <= 0:
            continue
        CylinderSlotAssignment.objects.get_or_create(
            artwork_id=cylinder.artwork_id,
            side=side,
            side_slot_index=slot,
            defaults={
                "cylinder_id": cylinder.id,
                "color_name": str(cylinder.color_name or "").strip().upper(),
            },
        )


class Migration(migrations.Migration):

    dependencies = [
        ("artwork", "0007_artwork_substrate_mode"),
        ("tooling", "0006_toolasset"),
    ]

    operations = [
        migrations.CreateModel(
            name="CylinderSlotAssignment",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("side", models.CharField(default="FRONT", max_length=10)),
                ("side_slot_index", models.PositiveIntegerField(default=1)),
                ("color_name", models.CharField(blank=True, default="", max_length=255)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "artwork",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="cylinder_slot_assignments",
                        to="artwork.artwork",
                    ),
                ),
                (
                    "cylinder",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="slot_assignments",
                        to="tooling.cylinder",
                    ),
                ),
            ],
            options={
                "db_table": "tooling_cylinder_slot_assignments",
                "ordering": ["artwork__design_code", "side", "side_slot_index"],
            },
        ),
        migrations.AddConstraint(
            model_name="cylinderslotassignment",
            constraint=models.UniqueConstraint(
                fields=("artwork", "side", "side_slot_index"),
                name="unique_cylinder_slot_assignment",
            ),
        ),
        migrations.AddConstraint(
            model_name="cylinderslotassignment",
            constraint=models.CheckConstraint(
                condition=Q(("side__in", ["FRONT", "BACK"])),
                name="cylinder_slot_assignment_side_valid",
            ),
        ),
        migrations.RunPython(seed_existing_direct_cylinder_slots, migrations.RunPython.noop),
    ]
