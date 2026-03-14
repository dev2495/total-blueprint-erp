from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("inventory", "0023_inventoryreservation"),
    ]

    operations = [
        migrations.AddField(
            model_name="inventoryreservation",
            name="override_reason",
            field=models.TextField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="inventoryreservation",
            name="override_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="inventory_reservation_overrides",
                to="users.user",
            ),
        ),
    ]

