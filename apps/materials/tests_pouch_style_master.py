from decimal import Decimal

from django.test import TestCase

from apps.materials.models import PouchStyleMaster, ProductMaster
from apps.materials.serializers import ProductMasterSizeSerializer
from apps.materials.services_pouch_style import compute_child_target_width_mm


class PouchStyleMasterFormulaTests(TestCase):
    def test_closed_formula_computes_child_target_width(self):
        style = PouchStyleMaster.objects.create(
            code="TEST-STANDUP",
            name="Test standup",
            formula_kind="GUSSETED_BOTTOM",
            formula_params={"trim_mm": 5, "bottom_factor": 1},
        )

        value = compute_child_target_width_mm(style, {"W": 140, "H": 210, "gusset": 60})

        self.assertEqual(value, Decimal("345.00"))

    def test_custom_ast_is_safe_and_rounded(self):
        style = PouchStyleMaster.objects.create(
            code="TEST-AST",
            name="Test AST",
            formula_kind="CUSTOM_AST",
            formula_ast={
                "op": "+",
                "left": {"op": "*", "left": {"op": "VAR", "name": "W"}, "right": {"op": "NUM", "value": 2}},
                "right": {"op": "PARAM", "name": "trim_mm"},
            },
            formula_params={"trim_mm": 4.125},
        )

        value = compute_child_target_width_mm(style, {"W": 127.333})

        self.assertEqual(value, Decimal("258.79"))

    def test_linear_formula_can_mix_width_height_and_factor_fields(self):
        style = PouchStyleMaster.objects.create(
            code="TEST-WH",
            name="Width plus height",
            formula_kind="LINEAR",
            formula_params={
                "terms": [
                    {"factors": [{"kind": "NUMBER", "value": 1}, {"kind": "FIELD", "field": "W"}]},
                    {"factors": [{"kind": "NUMBER", "value": 1}, {"kind": "FIELD", "field": "H"}]},
                    {"factors": [{"kind": "FIELD", "field": "gusset"}, {"kind": "FIELD", "field": "bottom_factor"}]},
                ],
                "trim_mm": 6,
            },
            allowed_fields={
                "W": {"required": True, "label": "Width"},
                "H": {"required": True, "label": "Height"},
                "gusset": {"label": "Gusset"},
                "bottom_factor": {"label": "Bottom factor", "default": 0.5},
            },
        )

        value = compute_child_target_width_mm(style, {"W": 140, "H": 210, "gusset": 60, "bottom_factor": 0.5})

        self.assertEqual(value, Decimal("386.00"))

    def test_product_master_size_serializer_computes_child_target_from_style_defaults(self):
        style = PouchStyleMaster.objects.create(
            code="TEST-H-AXIS",
            name="Height axis",
            formula_kind="LINEAR",
            allowed_fields={
                "H": {"required": True, "label": "Height"},
                "overlap": {"label": "Overlap", "default": 12},
            },
            formula_params={
                "terms": [
                    {"factors": [{"kind": "NUMBER", "value": 1}, {"kind": "FIELD", "field": "H"}]},
                    {"factors": [{"kind": "NUMBER", "value": 1}, {"kind": "FIELD", "field": "overlap"}]},
                ],
                "trim_mm": 8,
            },
        )
        master = ProductMaster.objects.create(code="PM-H-AXIS", name="PM height axis", product_kind="POUCH")

        serializer = ProductMasterSizeSerializer(
            data={
                "product_master": str(master.id),
                "code": "H300",
                "label": "H 300",
                "width_mm": "120",
                "height_mm": "300",
                "pouch_style_master": str(style.id),
                "child_target_override": False,
                "qty_uom": "PCS",
                "active": True,
            }
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        size = serializer.save()

        self.assertEqual(size.child_target_width_mm, Decimal("320.00"))
        self.assertEqual(size.pouch_style_version, 1)
