"""Fold rule and roll styles (2 Nov 2026).

open web = 2W + flap + seal + trim; film area of folded / tube stock = 2W + flap + seal.
A roll style (style_for=ROLL) keeps the size's roll width and brings the form and fold.
"""
from decimal import Decimal

from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from apps.factory.models import Process
from apps.materials.models import PouchStyleMaster, ProductMaster, ProductMasterSize
from apps.materials.serializers import PouchStyleSerializer, ProductMasterSizeSerializer
from apps.materials.services_pouch_style import compute_stock_geometry
from apps.materials.stock_forms import (
    convert_width,
    describe_form,
    film_area_factor_for_stock_form,
    film_area_width_for,
    folded_width_from_open,
    open_width_for,
)

D = Decimal
J_FOLD = {"flap_mm": 20, "trim_mm": 10}


class FoldRuleTests(TestCase):
    def test_open_width_and_back(self):
        self.assertEqual(open_width_for("FOLDED_WEB", 300, J_FOLD), D("630.00"))
        self.assertEqual(open_width_for("FOLDED_WEB", 300), D("600.00"), "plain C-fold is two walls")
        self.assertEqual(open_width_for("LAYFLAT_TUBE", 250, {"seal_mm": 8, "trim_mm": 4}), D("512.00"))
        self.assertEqual(open_width_for("OPEN_WEB", 640, J_FOLD), D("640"), "open web is itself")
        self.assertEqual(folded_width_from_open(630, J_FOLD), D("300.00"))
        self.assertEqual(folded_width_from_open(20, J_FOLD), D("0"))

    def test_film_area_counts_both_walls_and_flap_not_trim(self):
        self.assertEqual(film_area_factor_for_stock_form("FOLDED_WEB"), 2)
        self.assertEqual(film_area_width_for("FOLDED_WEB", 300, J_FOLD), D("620.00"))
        self.assertEqual(film_area_width_for("OPEN_WEB", 640, J_FOLD), D("640.00"))

    def test_convert_width_by_form_pair(self):
        self.assertEqual(convert_width("OPEN_WEB", "FOLDED_WEB", 630, J_FOLD), D("300.00"))
        self.assertEqual(convert_width("FOLDED_WEB", "OPEN_WEB", 300, J_FOLD), D("620.00"), "unfold gives the film back, trim was cut off")
        self.assertEqual(convert_width("FOLDED_WEB", "LAYFLAT_TUBE", 300, J_FOLD), D("300.00"))
        self.assertEqual(convert_width("OPEN_WEB", "OPEN_WEB", 640), D("640.00"))

    def test_floor_text(self):
        self.assertEqual(describe_form("FOLDED_WEB", 300, J_FOLD), "Folded 300 mm + 20 flap")
        self.assertEqual(describe_form("LAYFLAT_TUBE", 250), "Tube 250 mm")
        self.assertEqual(describe_form("OPEN_WEB", 640, J_FOLD), "Open 640 mm")


class RollStyleTests(TestCase):
    def _roll_style(self, form="FOLDED_WEB", fold=None):
        serializer = PouchStyleSerializer(data={
            "code": f"ROLL-{form}",
            "name": f"Roll {form}",
            "style_for": "ROLL",
            "formula_kind": "LINEAR",
            "default_stock_form": form,
            "stock_form_options": {form: {**(fold or J_FOLD), "enabled": True}},
        })
        self.assertTrue(serializer.is_valid(), serializer.errors)
        style = serializer.save()
        style.locked = True
        style.save()
        return style

    def test_roll_style_pins_no_formula_and_cleans_fold_numbers(self):
        style = self._roll_style()
        self.assertEqual((style.style_for, style.formula_kind, style.default_roll_axis), ("ROLL", "SHAPED_OVERRIDE", "NONE"))
        self.assertEqual(style.stock_form_options["FOLDED_WEB"]["flap_mm"], 20.0)
        bad = PouchStyleSerializer(data={"code": "ROLL-BAD", "name": "Bad", "style_for": "ROLL", "default_stock_form": "FOLDED_WEB",
                                         "stock_form_options": {"FOLDED_WEB": {"flap_mm": -5}}})
        self.assertFalse(bad.is_valid())

    def test_roll_style_geometry_keeps_size_width(self):
        style = self._roll_style()
        geometry = compute_stock_geometry(style, {"override_width": 300})
        self.assertEqual(geometry["stock_form"], "FOLDED_WEB")
        self.assertEqual(geometry["stock_width_mm"], D("300.00"))
        self.assertEqual(geometry["film_area_width_mm"], D("620.00"))
        self.assertEqual(geometry["open_width_mm"], D("630.00"))
        self.assertEqual(geometry["fold"], {"flap_mm": 20.0, "seal_mm": 0.0, "trim_mm": 10.0})

    def test_roll_size_takes_form_and_fold_from_its_roll_style(self):
        style = self._roll_style()
        master = ProductMaster.objects.create(code="PM-FOLD-ROLL", name="Folded LD roll", product_kind="ROLL")
        serializer = ProductMasterSizeSerializer(data={
            "product_master": str(master.id), "code": "300", "label": "300", "roll_width_mm": "300",
            "pouch_style_master": str(style.id), "qty_uom": "KG", "active": True,
        })
        self.assertTrue(serializer.is_valid(), serializer.errors)
        size = serializer.save()
        self.assertEqual((size.stock_form, size.width_basis, size.slit_policy), ("FOLDED_WEB", "FOLDED_WIDTH", "EXACT_ONLY"))
        self.assertEqual(size.child_target_width_mm, D("300.00"))
        self.assertEqual(size.film_area_width_mm, D("620.00"))
        self.assertEqual(size.geometry_config["fold"], {"flap_mm": 20.0, "seal_mm": 0.0, "trim_mm": 10.0})

    def test_roll_style_is_refused_on_a_pouch_size(self):
        style = self._roll_style()
        master = ProductMaster.objects.create(code="PM-FOLD-POUCH", name="Pouch", product_kind="POUCH")
        serializer = ProductMasterSizeSerializer(data={
            "product_master": str(master.id), "code": "100X200", "label": "100 x 200", "width_mm": "100", "height_mm": "200",
            "pouch_style_master": str(style.id), "qty_uom": "PCS", "active": True,
        })
        self.assertFalse(serializer.is_valid())
        self.assertIn("roll products only", str(serializer.errors["pouch_style_master"]))

    def test_size_with_own_fold_keeps_it(self):
        style = self._roll_style()
        master = ProductMaster.objects.create(code="PM-FOLD-OWN", name="Folded own flap", product_kind="ROLL")
        own = {"flap_mm": 35, "seal_mm": 0, "trim_mm": 10}
        serializer = ProductMasterSizeSerializer(data={
            "product_master": str(master.id), "code": "300", "label": "300", "roll_width_mm": "300",
            "pouch_style_master": str(style.id), "qty_uom": "KG", "active": True, "geometry_config": {"fold": own},
        })
        self.assertTrue(serializer.is_valid(), serializer.errors)
        size = serializer.save()
        self.assertEqual(size.geometry_config["fold"], own)

    def test_pouch_style_on_folded_film_keeps_its_formula(self):
        style = PouchStyleMaster.objects.create(
            code="SS-JFOLD", name="Side seal on J-fold", locked=True, formula_kind="LINEAR",
            default_stock_form="FOLDED_WEB", stock_form_options={"FOLDED_WEB": {"flap_mm": 25}},
            allowed_fields={"H": {"required": True}},
            formula_params={"terms": [{"factors": [{"kind": "FIELD", "field": "H"}]}], "trim_mm": 0},
            default_roll_axis="HEIGHT",
        )
        self.assertEqual(style.style_for, "POUCH")
        geometry = compute_stock_geometry(style, {"H": 280})
        self.assertEqual(geometry["stock_width_mm"], D("280.00"))
        self.assertEqual(geometry["open_width_mm"], D("585.00"))


class RollFormSyncTests(TestCase):
    def test_roll_form_picker_sets_the_stock_form_and_film_area(self):
        master = ProductMaster.objects.create(code="PM-TUBING", name="LD tubing", product_kind="ROLL")
        serializer = ProductMasterSizeSerializer(data={
            "product_master": str(master.id), "code": "250", "label": "250", "width_mm": "250",
            "roll_form": "TUBING", "qty_uom": "KG", "active": True,
        })
        self.assertTrue(serializer.is_valid(), serializer.errors)
        size = serializer.save()
        self.assertEqual((size.stock_form, size.width_basis, size.slit_policy), ("LAYFLAT_TUBE", "LAYFLAT_WIDTH", "EXACT_ONLY"))
        self.assertEqual(size.film_area_width_mm, D("500.00"))
        self.assertEqual(ProductMasterSizeSerializer(size).data["stock_form"], "LAYFLAT_TUBE")

        size.geometry_config = {**size.geometry_config, "roll_form": "FOLDED", "fold": {"flap_mm": 20}}
        size.save()
        self.assertEqual((size.stock_form, size.film_area_width_mm), ("FOLDED_WEB", D("520.00")))

    def test_pouch_sizes_are_left_alone(self):
        master = ProductMaster.objects.create(code="PM-POUCH-RF", name="Pouch", product_kind="POUCH")
        size = ProductMasterSize.objects.create(product_master=master, code="A", label="A", width_mm=D("100"),
                                                geometry_config={"roll_form": "TUBING"})
        self.assertEqual(size.stock_form, "OPEN_WEB")

    def test_fold_setup_reports_then_applies(self):
        master = ProductMaster.objects.create(code="PM-OLD-TUBE", name="Old tubing", product_kind="ROLL")
        size = ProductMasterSize.objects.create(product_master=master, code="20", label="20", width_mm=D("500"))
        ProductMasterSize.objects.filter(id=size.id).update(geometry_config={"roll_form": "TUBING"})  # saved by the old editor
        Process.objects.create(code="Fold", name="Folding", input_form="ROLL", output_form="ROLL", roll_behavior="MULTI_INPUT_COMBINE",
                               allowed_input_stock_forms=["OPEN_WEB"], allowed_output_stock_forms=["OPEN_WEB"])

        out = StringIO()
        call_command("fold_setup", stdout=out)
        self.assertIn("Roll form not on their stock form: 1", out.getvalue())
        size.refresh_from_db()
        self.assertEqual(size.stock_form, "OPEN_WEB", "report only")

        call_command("fold_setup", "--apply-sizes", "--apply-process", stdout=StringIO())
        size.refresh_from_db()
        self.assertEqual(size.stock_form, "LAYFLAT_TUBE")
        process = Process.objects.get(code="Fold")
        self.assertEqual((process.roll_behavior, process.stock_form_output_mode), ("MODIFY_EXISTING", "TARGET_DECIDES"))
        self.assertEqual(process.allowed_output_stock_forms, ["OPEN_WEB", "FOLDED_WEB", "LAYFLAT_TUBE"])
