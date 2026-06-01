from django.db import migrations
from decimal import Decimal


def repair_legacy_open_web_widths(apps, schema_editor):
    ProductMasterSize = apps.get_model("materials", "ProductMasterSize")

    for size in ProductMasterSize.objects.select_related("product_master").all():
        product = getattr(size, "product_master", None)
        is_pouch = str(getattr(product, "product_kind", "") or "").upper() == "POUCH"
        if not is_pouch or getattr(size, "pouch_style_master_id", None) or getattr(size, "child_target_override", False):
            continue
        stock_form = str(getattr(size, "stock_form", "") or "OPEN_WEB").upper()
        if stock_form != "OPEN_WEB" or getattr(size, "width_mm", None) is None:
            continue

        geometry_config = getattr(size, "geometry_config", None)
        if not isinstance(geometry_config, dict):
            geometry_config = {}
        trim_loss = Decimal(str(geometry_config.get("trim_loss_mm") if geometry_config.get("trim_loss_mm") not in (None, "") else 10))
        trim_apply_to = str(geometry_config.get("trim_apply_to") or "WIDTH").upper()
        width_trim = trim_loss if trim_apply_to in {"WIDTH", "BOTH"} else Decimal("0")
        width = Decimal(str(size.width_mm))
        old_two_wall = (width * Decimal("2")).quantize(Decimal("0.01"))
        expected = ((width * Decimal("2")) + width_trim).quantize(Decimal("0.01"))

        updates = {}
        child_target = getattr(size, "child_target_width_mm", None)
        film_area = getattr(size, "film_area_width_mm", None)
        if child_target is None or Decimal(str(child_target)).quantize(Decimal("0.01")) == old_two_wall:
            updates["child_target_width_mm"] = expected
        if film_area is None or Decimal(str(film_area)).quantize(Decimal("0.01")) == old_two_wall:
            updates["film_area_width_mm"] = expected
        if updates:
            ProductMasterSize.objects.filter(pk=size.pk).update(**updates)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("materials", "0045_backfill_size_film_area_width"),
    ]

    operations = [
        migrations.RunPython(repair_legacy_open_web_widths, noop_reverse),
        migrations.RemoveField(
            model_name="pouchstylemaster",
            name="faces",
        ),
    ]
