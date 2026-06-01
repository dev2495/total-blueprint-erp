from decimal import Decimal

from django.db import migrations


def backfill_size_film_area_width(apps, schema_editor):
    ProductMasterSize = apps.get_model("materials", "ProductMasterSize")

    for size in ProductMasterSize.objects.select_related("product_master").all():
        updates = {}
        stock_form = str(getattr(size, "stock_form", "") or "OPEN_WEB").upper()
        if not getattr(size, "stock_form", None):
            updates["stock_form"] = "OPEN_WEB"
        if not getattr(size, "width_basis", None):
            updates["width_basis"] = "LAYFLAT_WIDTH" if stock_form == "LAYFLAT_TUBE" else "OPEN_WEB_WIDTH"
        if not getattr(size, "slit_policy", None):
            updates["slit_policy"] = "EXACT_ONLY" if stock_form == "LAYFLAT_TUBE" else "SLIT_ALLOWED"

        film_area_width = getattr(size, "film_area_width_mm", None)
        if film_area_width is None:
            child_target = getattr(size, "child_target_width_mm", None)
            if child_target is not None:
                factor = Decimal("2") if stock_form == "LAYFLAT_TUBE" else Decimal("1")
                updates["film_area_width_mm"] = (Decimal(str(child_target)) * factor).quantize(Decimal("0.01"))
            else:
                product = getattr(size, "product_master", None)
                is_pouch = str(getattr(product, "product_kind", "") or "").upper() == "POUCH"
                width = getattr(size, "width_mm", None)
                if is_pouch and width is not None:
                    geometry_config = getattr(size, "geometry_config", None)
                    if not isinstance(geometry_config, dict):
                        geometry_config = {}
                    trim_loss = Decimal(str(geometry_config.get("trim_loss_mm") if geometry_config.get("trim_loss_mm") not in (None, "") else 10))
                    trim_apply_to = str(geometry_config.get("trim_apply_to") or "WIDTH").upper()
                    width_trim = trim_loss if trim_apply_to in {"WIDTH", "BOTH"} else Decimal("0")
                    legacy_open_web_width = ((Decimal(str(width)) * Decimal("2")) + width_trim).quantize(Decimal("0.01"))
                    updates["child_target_width_mm"] = legacy_open_web_width
                    updates["film_area_width_mm"] = legacy_open_web_width

        if updates:
            ProductMasterSize.objects.filter(pk=size.pk).update(**updates)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("materials", "0044_pouchstylemaster_default_slit_policy_and_more"),
    ]

    operations = [
        migrations.RunPython(backfill_size_film_area_width, noop_reverse),
    ]
