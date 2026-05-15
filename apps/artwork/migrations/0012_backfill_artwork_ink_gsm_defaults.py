from decimal import Decimal

from django.db import migrations


DEFAULT_LEGACY_INK_GSM = Decimal("1.2000")


def backfill_legacy_artwork_ink_gsm(apps, schema_editor):
    Artwork = apps.get_model("artwork", "Artwork")

    for artwork in Artwork.objects.all().only("id", "ink_gsm_total", "ink_gsm_split_mode"):
        current_total = artwork.ink_gsm_total or Decimal("0")
        if current_total > 0:
            continue
        artwork.ink_gsm_total = DEFAULT_LEGACY_INK_GSM
        artwork.ink_gsm_split_mode = "EQUAL"
        artwork.ink_gsm_color_percentages = {}
        artwork.ink_gsm_by_color = {}
        artwork.save(
            update_fields=[
                "ink_gsm_total",
                "ink_gsm_split_mode",
                "ink_gsm_color_percentages",
                "ink_gsm_by_color",
            ]
        )


class Migration(migrations.Migration):

    dependencies = [
        ("artwork", "0011_artwork_ink_gsm_contract"),
    ]

    operations = [
        migrations.RunPython(backfill_legacy_artwork_ink_gsm, migrations.RunPython.noop),
    ]
