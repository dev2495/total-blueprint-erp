from decimal import Decimal

from django.db import migrations


def mark_films_and_granules_tradable(apps, schema_editor):
    InventoryMaterial = apps.get_model("materials", "InventoryMaterial")
    scope = InventoryMaterial.objects.filter(category__in=["FILM_VARIANT", "GRANULE"])
    scope.update(is_sellable=True)
    scope.filter(default_gst_pct__isnull=True).update(default_gst_pct=Decimal("18.00"))


def noop_reverse(apps, schema_editor):
    # Deliberately do not unset sellable flags on rollback. Once a material has
    # been exposed for trading, reversing the migration should not silently hide it.
    return None


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0039_web_width_policy_scope_strategy"),
    ]

    operations = [
        migrations.RunPython(mark_films_and_granules_tradable, noop_reverse),
    ]
