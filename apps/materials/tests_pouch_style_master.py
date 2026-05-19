from decimal import Decimal

from django.test import TestCase

from apps.materials.models import PouchStyleMaster
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
