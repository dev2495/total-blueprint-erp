"""
Phase A · seed 11 standard pouch styles.

Each row matches the legacy enum behaviour. Tunable per-installation later.
"""

from django.db import migrations


SEED_ROWS = [
    {
        "code": "PILLOW",
        "name": "Pillow pouch",
        "description": "Simple flat pillow pouch · top + bottom seal.",
        "visual_emoji": "🛍",
        "faces": 2,
        "default_roll_axis": "WIDTH",
        "allowed_fields": {
            "W": {"required": True, "label": "Width"},
            "H": {"required": True, "label": "Height"},
        },
        "field_adjustments": {
            "trim_axis": "WIDTH",
            "trim_default_mm": 5,
            "default_lane_count": 1,
        },
        "formula_kind": "SIMPLE_DOUBLE",
        "formula_params": {"trim_mm": 5},
        "formula_expression": "2W + trim",
        "sort_order": 10,
    },
    {
        "code": "THREE_SIDE_SEAL",
        "name": "Three-side seal pouch",
        "description": "Three-side sealed pouch · open top, sealed sides + bottom.",
        "visual_emoji": "📦",
        "faces": 2,
        "default_roll_axis": "WIDTH",
        "allowed_fields": {
            "W": {"required": True, "label": "Width"},
            "H": {"required": True, "label": "Height"},
        },
        "field_adjustments": {"trim_axis": "WIDTH", "trim_default_mm": 5},
        "formula_kind": "THREE_SIDE_SEAL",
        "formula_params": {"trim_mm": 5},
        "formula_expression": "2W + trim",
        "sort_order": 20,
    },
    {
        "code": "GUSSETED_SIDE",
        "name": "Side gusset pouch",
        "description": "Side-gusseted pouch · gusset adds to both sides of the roll axis.",
        "visual_emoji": "📁",
        "faces": 2,
        "default_roll_axis": "WIDTH",
        "allowed_fields": {
            "W": {"required": True, "label": "Width"},
            "H": {"required": True, "label": "Height"},
            "gusset": {"required": True, "label": "Side gusset"},
        },
        "field_adjustments": {
            "gusset_axis": "BOTH",
            "trim_axis": "WIDTH",
            "trim_default_mm": 5,
        },
        "formula_kind": "GUSSETED_SIDE",
        "formula_params": {"trim_mm": 5},
        "formula_expression": "2(W + G) + trim",
        "sort_order": 30,
    },
    {
        "code": "STAND_UP_K",
        "name": "K-Stand-up pouch",
        "description": "Stand-up pouch with bottom k-fold gusset.",
        "visual_emoji": "🛒",
        "faces": 2,
        "default_roll_axis": "WIDTH",
        "allowed_fields": {
            "W": {"required": True, "label": "Width"},
            "H": {"required": True, "label": "Height"},
            "gusset": {"required": True, "label": "Bottom gusset"},
            "bottom_factor": {"required": False, "default": 1.0, "label": "Bottom factor"},
        },
        "field_adjustments": {
            "gusset_axis": "WIDTH",
            "trim_axis": "WIDTH",
            "trim_default_mm": 5,
        },
        "formula_kind": "GUSSETED_BOTTOM",
        "formula_params": {"trim_mm": 5, "bottom_factor": 1.0},
        "formula_expression": "2W + G × bottom_factor + trim",
        "sort_order": 40,
    },
    {
        "code": "QUAD_SEAL",
        "name": "Quad seal pouch",
        "description": "Quad-seal pouch · four-corner seam, side gusset.",
        "visual_emoji": "🟦",
        "faces": 2,
        "default_roll_axis": "WIDTH",
        "allowed_fields": {
            "W": {"required": True, "label": "Width"},
            "H": {"required": True, "label": "Height"},
            "gusset": {"required": True, "label": "Gusset"},
        },
        "field_adjustments": {"gusset_axis": "BOTH", "trim_axis": "WIDTH", "trim_default_mm": 5},
        "formula_kind": "QUAD_SEAL",
        "formula_params": {"trim_mm": 5},
        "formula_expression": "2(W + G) + trim",
        "sort_order": 50,
    },
    {
        "code": "FLAT_BOTTOM",
        "name": "Flat-bottom pouch",
        "description": "Flat-bottom box pouch · 5-panel construction.",
        "visual_emoji": "🧱",
        "faces": 2,
        "default_roll_axis": "WIDTH",
        "allowed_fields": {
            "W": {"required": True, "label": "Width"},
            "H": {"required": True, "label": "Height"},
            "gusset": {"required": True, "label": "Gusset"},
        },
        "field_adjustments": {"gusset_axis": "BOTH", "trim_axis": "WIDTH", "trim_default_mm": 5},
        "formula_kind": "FLAT_BOTTOM",
        "formula_params": {"trim_mm": 5},
        "formula_expression": "2W + 2G + trim",
        "sort_order": 60,
    },
    {
        "code": "CENTER_SEAL",
        "name": "Center-seal pouch",
        "description": "Center-seal pouch · roll axis runs on height.",
        "visual_emoji": "↕️",
        "faces": 1,
        "default_roll_axis": "HEIGHT",
        "allowed_fields": {
            "W": {"required": True, "label": "Width"},
            "H": {"required": True, "label": "Height"},
            "overlap": {"required": False, "default": 10, "label": "Seal overlap"},
        },
        "field_adjustments": {"trim_axis": "HEIGHT", "trim_default_mm": 5},
        "formula_kind": "CENTER_SEAL_H",
        "formula_params": {"trim_mm": 5, "overlap_mm": 10},
        "formula_expression": "H + overlap + trim",
        "sort_order": 70,
    },
    {
        "code": "SPOUT",
        "name": "Spout pouch",
        "description": "Spout pouch · extra reach for spout flap.",
        "visual_emoji": "🥤",
        "faces": 2,
        "default_roll_axis": "WIDTH",
        "allowed_fields": {
            "W": {"required": True, "label": "Width"},
            "H": {"required": True, "label": "Height"},
            "flap": {"required": True, "label": "Spout flap reach"},
        },
        "field_adjustments": {"trim_axis": "WIDTH", "trim_default_mm": 5},
        "formula_kind": "SPOUT",
        "formula_params": {"trim_mm": 5},
        "formula_expression": "2W + flap + trim",
        "sort_order": 80,
    },
    {
        "code": "STICK_PACK",
        "name": "Stick pack",
        "description": "Narrow stick / single-serve pack.",
        "visual_emoji": "📏",
        "faces": 1,
        "default_roll_axis": "WIDTH",
        "allowed_fields": {
            "W": {"required": True, "label": "Width"},
            "H": {"required": True, "label": "Length"},
            "stick_factor": {"required": False, "default": 1.05, "label": "Stick factor"},
        },
        "field_adjustments": {"trim_axis": "WIDTH", "trim_default_mm": 3},
        "formula_kind": "STICK_PACK",
        "formula_params": {"trim_mm": 3, "stick_factor": 1.05},
        "formula_expression": "W × stick_factor + trim",
        "sort_order": 90,
    },
    {
        "code": "SACHET",
        "name": "Sachet",
        "description": "Small sachet pouch.",
        "visual_emoji": "💊",
        "faces": 2,
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
        "description": "Operator enters target_child_width directly · no formula derivation.",
        "visual_emoji": "✂️",
        "faces": 2,
        "default_roll_axis": "WIDTH",
        "allowed_fields": {
            "W": {"required": False, "label": "Approx width"},
            "H": {"required": False, "label": "Approx height"},
            "override_width": {"required": True, "label": "Direct roll width"},
        },
        "field_adjustments": {"trim_axis": "NONE", "trim_default_mm": 0},
        "formula_kind": "SHAPED_OVERRIDE",
        "formula_params": {},
        "formula_expression": "operator-entered width",
        "sort_order": 110,
    },
]


def seed_pouch_styles(apps, schema_editor):
    PouchStyleMaster = apps.get_model("materials", "PouchStyleMaster")
    for row in SEED_ROWS:
        PouchStyleMaster.objects.update_or_create(
            code=row["code"],
            defaults={
                "name": row["name"],
                "description": row["description"],
                "version": 1,
                "locked": False,
                "visual_emoji": row.get("visual_emoji", "🛍️"),
                "faces": row["faces"],
                "default_roll_axis": row["default_roll_axis"],
                "allowed_fields": row["allowed_fields"],
                "field_adjustments": row["field_adjustments"],
                "formula_kind": row["formula_kind"],
                "formula_params": row["formula_params"],
                "formula_ast": {},
                "formula_expression": row["formula_expression"],
                "sort_order": row["sort_order"],
            },
        )


def unseed_pouch_styles(apps, schema_editor):
    PouchStyleMaster = apps.get_model("materials", "PouchStyleMaster")
    PouchStyleMaster.objects.filter(code__in=[r["code"] for r in SEED_ROWS]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0031_pouch_style_master"),
    ]

    operations = [
        migrations.RunPython(seed_pouch_styles, unseed_pouch_styles),
    ]
