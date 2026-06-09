from decimal import Decimal, InvalidOperation

from django.db import migrations, models


STOCK_FORM_OPTIONS = {
    "OPEN_WEB": {
        "enabled": True,
        "film_area_factor": 1,
        "width_basis": "OPEN_WEB_WIDTH",
        "slit_policy": "SLIT_ALLOWED",
    },
    "LAYFLAT_TUBE": {
        "enabled": True,
        "film_area_factor": 2,
        "width_basis": "LAYFLAT_WIDTH",
        "slit_policy": "EXACT_ONLY",
    },
    "FOLDED_WEB": {
        "enabled": True,
        "film_area_factor": 2,
        "width_basis": "FOLDED_WIDTH",
        "slit_policy": "SLIT_ALLOWED",
    },
}


STYLE_ROWS = [
    {
        "code": "PILLOW",
        "name": "Pillow pouch",
        "default_roll_axis": "WIDTH",
        "allowed_fields": {
            "W": {"required": True, "label": "Width"},
            "H": {"required": True, "label": "Height"},
        },
        "field_adjustments": {"trim_axis": "WIDTH", "trim_default_mm": 10},
        "formula_kind": "SIMPLE_DOUBLE",
        "formula_params": {"trim_mm": 10},
        "formula_expression": "2W + trim",
        "sort_order": 10,
    },
    {
        "code": "THREE_SIDE_SEAL",
        "name": "Three-side seal pouch",
        "default_roll_axis": "WIDTH",
        "allowed_fields": {
            "W": {"required": True, "label": "Width"},
            "H": {"required": True, "label": "Height"},
        },
        "field_adjustments": {"trim_axis": "WIDTH", "trim_default_mm": 10},
        "formula_kind": "THREE_SIDE_SEAL",
        "formula_params": {"trim_mm": 10},
        "formula_expression": "2W + trim",
        "sort_order": 20,
    },
    {
        "code": "GUSSETED_SIDE",
        "name": "Side gusset pouch",
        "default_roll_axis": "WIDTH",
        "allowed_fields": {
            "W": {"required": True, "label": "Width"},
            "H": {"required": True, "label": "Height"},
            "gusset": {"required": True, "label": "Side gusset"},
        },
        "field_adjustments": {"gusset_axis": "BOTH", "trim_axis": "WIDTH", "trim_default_mm": 10},
        "formula_kind": "GUSSETED_SIDE",
        "formula_params": {"trim_mm": 10},
        "formula_expression": "2(W + G) + trim",
        "sort_order": 30,
    },
    {
        "code": "STAND_UP_K",
        "name": "K-stand-up pouch",
        "default_roll_axis": "WIDTH",
        "allowed_fields": {
            "W": {"required": True, "label": "Width"},
            "H": {"required": True, "label": "Height"},
            "gusset": {"required": True, "label": "Bottom gusset"},
            "bottom_factor": {"required": False, "default": 1, "label": "Bottom factor"},
        },
        "field_adjustments": {"gusset_axis": "WIDTH", "trim_axis": "WIDTH", "trim_default_mm": 10},
        "formula_kind": "GUSSETED_BOTTOM",
        "formula_params": {"trim_mm": 10, "bottom_factor": 1},
        "formula_expression": "2W + G x bottom_factor + trim",
        "sort_order": 40,
    },
    {
        "code": "QUAD_SEAL",
        "name": "Quad seal pouch",
        "default_roll_axis": "WIDTH",
        "allowed_fields": {
            "W": {"required": True, "label": "Width"},
            "H": {"required": True, "label": "Height"},
            "gusset": {"required": True, "label": "Gusset"},
        },
        "field_adjustments": {"gusset_axis": "BOTH", "trim_axis": "WIDTH", "trim_default_mm": 10},
        "formula_kind": "QUAD_SEAL",
        "formula_params": {"trim_mm": 10},
        "formula_expression": "2(W + G) + trim",
        "sort_order": 50,
    },
    {
        "code": "FLAT_BOTTOM",
        "name": "Flat-bottom pouch",
        "default_roll_axis": "WIDTH",
        "allowed_fields": {
            "W": {"required": True, "label": "Width"},
            "H": {"required": True, "label": "Height"},
            "gusset": {"required": True, "label": "Gusset"},
        },
        "field_adjustments": {"gusset_axis": "BOTH", "trim_axis": "WIDTH", "trim_default_mm": 10},
        "formula_kind": "FLAT_BOTTOM",
        "formula_params": {"trim_mm": 10},
        "formula_expression": "2W + 2G + trim",
        "sort_order": 60,
    },
    {
        "code": "CENTER_SEAL",
        "name": "Center-seal pouch",
        "default_roll_axis": "HEIGHT",
        "allowed_fields": {
            "W": {"required": True, "label": "Width"},
            "H": {"required": True, "label": "Height"},
            "overlap": {"required": False, "default": 10, "label": "Seal overlap"},
        },
        "field_adjustments": {"trim_axis": "HEIGHT", "trim_default_mm": 10},
        "formula_kind": "CENTER_SEAL_H",
        "formula_params": {"trim_mm": 10, "overlap_mm": 10},
        "formula_expression": "H + overlap + trim",
        "sort_order": 70,
    },
    {
        "code": "SPOUT",
        "name": "Spout pouch",
        "default_roll_axis": "WIDTH",
        "allowed_fields": {
            "W": {"required": True, "label": "Width"},
            "H": {"required": True, "label": "Height"},
            "flap": {"required": True, "label": "Spout flap reach"},
        },
        "field_adjustments": {"trim_axis": "WIDTH", "trim_default_mm": 10},
        "formula_kind": "SPOUT",
        "formula_params": {"trim_mm": 10},
        "formula_expression": "2W + flap + trim",
        "sort_order": 80,
    },
    {
        "code": "STICK_PACK",
        "name": "Stick pack",
        "default_roll_axis": "WIDTH",
        "allowed_fields": {
            "W": {"required": True, "label": "Width"},
            "H": {"required": True, "label": "Length"},
            "stick_factor": {"required": False, "default": 1.05, "label": "Stick factor"},
        },
        "field_adjustments": {"trim_axis": "WIDTH", "trim_default_mm": 3},
        "formula_kind": "STICK_PACK",
        "formula_params": {"trim_mm": 3, "stick_factor": 1.05},
        "formula_expression": "W x stick_factor + trim",
        "sort_order": 90,
    },
    {
        "code": "SACHET",
        "name": "Sachet",
        "default_roll_axis": "WIDTH",
        "allowed_fields": {
            "W": {"required": True, "label": "Width"},
            "H": {"required": True, "label": "Height"},
        },
        "field_adjustments": {"trim_axis": "WIDTH", "trim_default_mm": 3},
        "formula_kind": "SACHET",
        "formula_params": {"trim_mm": 3},
        "formula_expression": "2W + trim",
        "sort_order": 100,
    },
    {
        "code": "SHAPED_CUSTOM",
        "name": "Shaped / custom pouch",
        "default_roll_axis": "WIDTH",
        "allowed_fields": {
            "W": {"required": False, "label": "Approx width"},
            "H": {"required": False, "label": "Approx height"},
            "override_width": {"required": True, "label": "Direct stock width"},
        },
        "field_adjustments": {"trim_axis": "NONE", "trim_default_mm": 0},
        "formula_kind": "SHAPED_OVERRIDE",
        "formula_params": {},
        "formula_expression": "operator-entered stock width",
        "sort_order": 110,
    },
]


STYLE_ALIASES = {
    "CENTER_SEALING": "CENTER_SEAL",
    "CENTER-SEAL": "CENTER_SEAL",
    "CENTER-SEALING": "CENTER_SEAL",
    "SIDE_GUSSET": "GUSSETED_SIDE",
    "STAND_UP": "STAND_UP_K",
    "STANDUP": "STAND_UP_K",
    "K_STAND_UP": "STAND_UP_K",
    "K-STAND-UP": "STAND_UP_K",
    "THREE-SIDE-SEAL": "THREE_SIDE_SEAL",
    "3_SIDE_SEAL": "THREE_SIDE_SEAL",
    "3-SIDE-SEAL": "THREE_SIDE_SEAL",
}


def _dec(value, default=None):
    if value in (None, ""):
        return default
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return default


def _round(value):
    return Decimal(str(value)).quantize(Decimal("0.01"))


def _formula_width(row, size):
    width = _dec(getattr(size, "width_mm", None), Decimal("0"))
    height = _dec(getattr(size, "height_mm", None), Decimal("0"))
    gusset = _dec(getattr(size, "gusset_mm", None), Decimal("0"))
    config = getattr(size, "geometry_config", None)
    if not isinstance(config, dict):
        config = {}
    flap = _dec(config.get("flap_tape_mm", config.get("flap_mm")), Decimal("0"))
    params = row.get("formula_params") or {}
    trim = _dec(params.get("trim_mm"), _dec((row.get("field_adjustments") or {}).get("trim_default_mm"), Decimal("0")))
    kind = str(row.get("formula_kind") or "").upper()
    if kind in {"SIMPLE_DOUBLE", "THREE_SIDE_SEAL", "SACHET"}:
        return _round(width * 2 + trim)
    if kind in {"GUSSETED_SIDE", "QUAD_SEAL"}:
        return _round((width + gusset) * 2 + trim)
    if kind == "GUSSETED_BOTTOM":
        factor = _dec(params.get("bottom_factor"), Decimal("1"))
        return _round(width * 2 + gusset * factor + trim)
    if kind == "FLAT_BOTTOM":
        return _round(width * 2 + gusset * 2 + trim)
    if kind == "CENTER_SEAL_H":
        overlap = _dec(config.get("overlap_mm", params.get("overlap_mm")), Decimal("0"))
        return _round(height + overlap + trim)
    if kind == "SPOUT":
        return _round(width * 2 + flap + trim)
    if kind == "STICK_PACK":
        factor = _dec(params.get("stick_factor"), Decimal("1"))
        return _round(width * factor + trim)
    return Decimal("0.00")


def _style_code_from(size):
    product = getattr(size, "product_master", None)
    config = getattr(size, "geometry_config", None)
    if not isinstance(config, dict):
        config = {}
    fixed = getattr(product, "fixed_attributes", None)
    if not isinstance(fixed, dict):
        fixed = {}
    for source in (config, fixed):
        for key in ("pouch_style_master_code", "pouch_style_code", "pouch_style", "default_pouch_style"):
            value = str(source.get(key) or "").upper().strip()
            if value:
                return STYLE_ALIASES.get(value, value)
    return ""


def seed_canonical_styles_and_backfill_sizes(apps, schema_editor):
    PouchStyleMaster = apps.get_model("materials", "PouchStyleMaster")
    ProductMasterSize = apps.get_model("materials", "ProductMasterSize")

    row_by_code = {row["code"]: row for row in STYLE_ROWS}
    for row in STYLE_ROWS:
        PouchStyleMaster.objects.update_or_create(
            code=row["code"],
            version=1,
            defaults={
                "name": row["name"],
                "description": "Canonical approved pouch style for quote, sales-order, and Product Master sizing.",
                "locked": True,
                "visual_emoji": "",
                "visual_svg": "",
                "default_roll_axis": row["default_roll_axis"],
                "default_stock_form": "OPEN_WEB",
                "default_width_basis": "OPEN_WEB_WIDTH",
                "default_slit_policy": "SLIT_ALLOWED",
                "stock_form_options": STOCK_FORM_OPTIONS,
                "allowed_fields": row["allowed_fields"],
                "field_adjustments": row["field_adjustments"],
                "formula_kind": row["formula_kind"],
                "formula_params": row["formula_params"],
                "formula_ast": {},
                "formula_expression": row["formula_expression"],
                "deprecated": False,
                "sort_order": row["sort_order"],
                "notes": "System canonical style. Clone a new version for plant-specific changes.",
            },
        )

    styles = {style.code: style for style in PouchStyleMaster.objects.filter(code__in=row_by_code.keys(), version=1)}
    for size in ProductMasterSize.objects.select_related("product_master").all():
        product = getattr(size, "product_master", None)
        if str(getattr(product, "product_kind", "") or "").upper() != "POUCH":
            continue
        if getattr(size, "pouch_style_master_id", None):
            continue
        style_code = _style_code_from(size)
        style = styles.get(style_code)
        row = row_by_code.get(style_code)
        if not style or not row:
            continue

        computed_child = _formula_width(row, size)
        current_child = _dec(getattr(size, "child_target_width_mm", None), None)
        preserve_existing = current_child is not None and computed_child > 0 and _round(current_child) != computed_child
        final_child = _round(current_child) if preserve_existing and current_child is not None else computed_child

        config = getattr(size, "geometry_config", None)
        if not isinstance(config, dict):
            config = {}
        config = {
            **config,
            "pouch_style": style.code,
            "pouch_style_master": str(style.id),
            "pouch_style_master_code": style.code,
            "pouch_style_version": style.version,
            "pouch_style_roll_axis": style.default_roll_axis,
            "stock_form": style.default_stock_form,
            "width_basis": style.default_width_basis,
            "slit_policy": style.default_slit_policy,
        }
        if final_child > 0:
            config["child_target_width_mm"] = str(final_child)
            config["film_area_width_mm"] = str(final_child)

        updates = {
            "pouch_style_master_id": style.id,
            "pouch_style_version": style.version,
            "stock_form": style.default_stock_form,
            "width_basis": style.default_width_basis,
            "slit_policy": style.default_slit_policy,
            "child_target_override": preserve_existing,
            "geometry_config": config,
        }
        if final_child > 0:
            updates["child_target_width_mm"] = final_child
            if getattr(size, "film_area_width_mm", None) is None or not preserve_existing:
                updates["film_area_width_mm"] = final_child
        ProductMasterSize.objects.filter(pk=size.pk).update(**updates)


class Migration(migrations.Migration):
    dependencies = [
        ("materials", "0047_product_master_versioning"),
    ]

    operations = [
        migrations.AlterField(
            model_name="pouchstylemaster",
            name="formula_kind",
            field=models.CharField(
                choices=[
                    ("SIMPLE_DOUBLE", "Simple double wall"),
                    ("THREE_SIDE_SEAL", "Three-side seal"),
                    ("GUSSETED_SIDE", "Side gusset"),
                    ("GUSSETED_BOTTOM", "Bottom gusset / stand-up"),
                    ("QUAD_SEAL", "Quad seal"),
                    ("FLAT_BOTTOM", "Flat bottom"),
                    ("CENTER_SEAL_H", "Center seal on height axis"),
                    ("SPOUT", "Spout pouch"),
                    ("STICK_PACK", "Stick pack"),
                    ("SACHET", "Sachet"),
                    ("LINEAR", "Linear formula - sum(coefficient x field) + trim"),
                    ("SHAPED_OVERRIDE", "Operator enters target directly"),
                    ("CUSTOM_AST", "Custom expression tree (advanced)"),
                ],
                default="LINEAR",
                max_length=24,
            ),
        ),
        migrations.RunPython(seed_canonical_styles_and_backfill_sizes, migrations.RunPython.noop),
    ]
