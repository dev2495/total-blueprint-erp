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

        call_command("fold_setup", "--apply-sizes", "--apply-process", "--apply-styles", stdout=StringIO())
        styles = {s.code: s for s in PouchStyleMaster.objects.filter(style_for="ROLL")}
        self.assertEqual(set(styles), {"ROLL-OPEN", "ROLL-FOLDED", "ROLL-JFOLD-20", "ROLL-JFOLD-30", "ROLL-JFOLD-40", "ROLL-TUBE", "ROLL-TUBE-SEAL-8"})
        self.assertTrue(all(s.locked and s.formula_kind == "SHAPED_OVERRIDE" for s in styles.values()))
        folded = styles["ROLL-FOLDED"]
        self.assertEqual((folded.default_stock_form, folded.default_width_basis, folded.default_slit_policy), ("FOLDED_WEB", "FOLDED_WIDTH", "EXACT_ONLY"))
        call_command("fold_setup", "--apply-styles", stdout=StringIO())
        self.assertEqual(PouchStyleMaster.objects.filter(style_for="ROLL").count(), 7, "runs twice safely")
        size.refresh_from_db()
        self.assertEqual(size.stock_form, "LAYFLAT_TUBE")
        process = Process.objects.get(code="Fold")
        self.assertEqual((process.roll_behavior, process.stock_form_output_mode), ("MODIFY_EXISTING", "TARGET_DECIDES"))
        self.assertEqual(process.allowed_output_stock_forms, ["OPEN_WEB", "FOLDED_WEB", "LAYFLAT_TUBE"])


class FoldLinkTests(TestCase):
    """A pouch style read as the open web before the fold, and the route-aware link for existing sizes."""

    @staticmethod
    def _pouch_style(code="SS-TEST"):
        return PouchStyleMaster.objects.create(
            code=code, name="Side seal test", locked=True, formula_kind="LINEAR",
            allowed_fields={"W": {"required": True}, "H": {"required": True}},
            formula_params={"terms": [{"factors": [{"kind": "NUMBER", "value": 2}, {"kind": "FIELD", "field": "W"}]}], "trim_mm": 10},
            default_roll_axis="WIDTH",
        )

    @staticmethod
    def _process(code, behavior, ins, outs, mode="PRESERVE", out_form="ROLL"):
        return Process.objects.create(code=code, name=code, input_form="ROLL", output_form=out_form, roll_behavior=behavior,
                                      allowed_input_stock_forms=ins, allowed_output_stock_forms=outs, stock_form_output_mode=mode)

    def _route(self, name, processes):
        from apps.templates.models import TemplateBlueprint, TemplateProcessStep
        template = TemplateBlueprint.objects.create(name=name, fg_type="POUCH", status="LIVE")
        for index, process in enumerate(processes, start=1):
            TemplateProcessStep.objects.create(template=template, sequence_number=index, process=process)
        return template

    def test_formula_read_as_open_web_folds_to_the_stored_width(self):
        style = self._pouch_style()
        style.default_stock_form = "FOLDED_WEB"
        style.stock_form_options = {"FOLDED_WEB": {"formula_basis": "OPEN_WEB", "flap_mm": 20, "trim_mm": 10}}
        style.save()
        geometry = compute_stock_geometry(style, {"W": 150, "H": 200})
        # Formula 2 x 150 + 10 = 310 mm open web; folded = (310 - 20 - 10) / 2 = 140; open and film stay 310.
        self.assertEqual((geometry["open_width_mm"], geometry["stock_width_mm"], geometry["film_area_width_mm"]), (D("310.00"), D("140.00"), D("310.00")))
        self.assertEqual(open_width_for("FOLDED_WEB", geometry["stock_width_mm"], geometry["fold"]), D("310.00"))
        self.assertEqual(geometry["fold"]["formula_basis"], "OPEN_WEB")

    def test_link_moves_fold_route_sizes_onto_a_linked_style_and_keeps_the_open_math(self):
        ext = self._process("EXT-T", "CREATE_NEW", [], [])
        fold = self._process("FOLD-T", "MODIFY_EXISTING", ["OPEN_WEB"], ["OPEN_WEB", "FOLDED_WEB", "LAYFLAT_TUBE"], "TARGET_DECIDES")
        side_seal = self._process("SS-T", "NONE", [], [], out_form="BULK")
        gusset = self._process("GZT-T", "MODIFY_EXISTING", ["LAYFLAT_TUBE"], ["LAYFLAT_TUBE"])
        style = self._pouch_style()
        folded_master = ProductMaster.objects.create(code="PM-COURIER-T", name="Courier test", product_kind="POUCH",
                                                     template=self._route("COURIER T", [ext, fold, side_seal]))
        tube_master = ProductMaster.objects.create(code="PM-DIAPER-T", name="Diaper test", product_kind="POUCH",
                                                   template=self._route("DIAPER T", [ext, fold, gusset, side_seal]))
        plain_master = ProductMaster.objects.create(code="PM-PLAIN-T", name="Plain test", product_kind="POUCH",
                                                    template=self._route("PLAIN T", [ext, side_seal]))
        sizes = {}
        for master in (folded_master, tube_master, plain_master):
            serializer = ProductMasterSizeSerializer(data={
                "product_master": str(master.id), "code": "150X200", "label": "150 x 200", "width_mm": "150", "height_mm": "200",
                "pouch_style_master": str(style.id), "qty_uom": "PCS", "active": True,
            })
            self.assertTrue(serializer.is_valid(), serializer.errors)
            sizes[master.code] = serializer.save()
        before = sizes["PM-COURIER-T"]
        self.assertEqual((before.stock_form, before.child_target_width_mm, before.film_area_width_mm), ("OPEN_WEB", D("310.00"), D("310.00")))

        out = StringIO()
        call_command("fold_setup", stdout=out)
        self.assertIn("Pouch products on routes with a fold step: 2", out.getvalue())
        call_command("fold_setup", "--apply-links", stdout=StringIO())

        folded = ProductMasterSize.objects.get(id=sizes["PM-COURIER-T"].id)
        self.assertEqual(folded.pouch_style_master.code, "SS-TEST-ON-FOLD")
        self.assertEqual((folded.stock_form, folded.child_target_width_mm, folded.film_area_width_mm), ("FOLDED_WEB", D("155.00"), D("310.00")))
        self.assertEqual(open_width_for("FOLDED_WEB", folded.child_target_width_mm, folded.geometry_config["fold"]), D("310.00"))
        tube = ProductMasterSize.objects.get(id=sizes["PM-DIAPER-T"].id)
        self.assertEqual((tube.pouch_style_master.code, tube.stock_form, tube.child_target_width_mm), ("SS-TEST-ON-TUBE", "LAYFLAT_TUBE", D("155.00")))
        plain = ProductMasterSize.objects.get(id=sizes["PM-PLAIN-T"].id)
        self.assertEqual((plain.pouch_style_master_id, plain.stock_form), (style.id, "OPEN_WEB"), "routes without a fold step are left alone")

        call_command("fold_setup", "--apply-links", stdout=StringIO())
        self.assertEqual(PouchStyleMaster.objects.filter(code="SS-TEST-ON-FOLD").count(), 1, "runs twice safely")

    def test_preset_roll_styles_carry_their_fold(self):
        call_command("fold_setup", "--apply-styles", stdout=StringIO())
        jfold = PouchStyleMaster.objects.get(code="ROLL-JFOLD-40")
        self.assertEqual(jfold.stock_form_options["FOLDED_WEB"]["flap_mm"], 40)
        master = ProductMaster.objects.create(code="PM-JF40", name="Courier film", product_kind="ROLL")
        serializer = ProductMasterSizeSerializer(data={
            "product_master": str(master.id), "code": "300", "label": "300", "roll_width_mm": "300",
            "pouch_style_master": str(jfold.id), "qty_uom": "KG", "active": True,
        })
        self.assertTrue(serializer.is_valid(), serializer.errors)
        size = serializer.save()
        self.assertEqual((size.stock_form, size.geometry_config["fold"]["flap_mm"], size.film_area_width_mm), ("FOLDED_WEB", 40.0, D("640.00")))
        sealed = PouchStyleMaster.objects.get(code="ROLL-TUBE-SEAL-8")
        self.assertEqual((sealed.default_stock_form, sealed.stock_form_options["LAYFLAT_TUBE"]["seal_mm"]), ("LAYFLAT_TUBE", 8))

    def test_flap_from_the_formula_field_and_one_copy_per_style_version(self):
        ext = self._process("EXT-F", "CREATE_NEW", [], [])
        fold = self._process("FOLD-F", "MODIFY_EXISTING", ["OPEN_WEB"], ["OPEN_WEB", "FOLDED_WEB", "LAYFLAT_TUBE"], "TARGET_DECIDES")
        side_seal = self._process("SS-F", "NONE", [], [], out_form="BULK")
        terms = [
            {"factors": [{"kind": "NUMBER", "value": 2}, {"kind": "FIELD", "field": "H"}]},
            {"factors": [{"kind": "NUMBER", "value": 1}, {"kind": "FIELD", "field": "Flap"}]},
        ]
        styles = []
        for version in (3, 5):
            styles.append(PouchStyleMaster.objects.create(
                code="SIDE-SEAL-F", version=version, name="Side seal", locked=True, deprecated=version == 3, formula_kind="LINEAR",
                allowed_fields={"W": {"required": True}, "H": {"required": True}, "Flap": {"required": False}},
                formula_params={"terms": terms, "trim_mm": 0}, default_roll_axis="HEIGHT",
            ))
        master = ProductMaster.objects.create(code="PM-COURIER-F", name="Courier flap", product_kind="POUCH",
                                              template=self._route("COURIER F", [ext, fold, side_seal]))
        made = []
        for style, flap in zip(styles, (40, 30)):
            size = ProductMasterSize.objects.create(
                product_master=master, code=f"200-{flap}", label=f"250 x 200 + {flap}", width_mm=D("250"), height_mm=D("200"),
                pouch_style_master=style, pouch_style_version=style.version,
                geometry_config={"pouch_formula_inputs": {"Flap": flap}}, child_target_width_mm=D(str(400 + flap)),
                film_area_width_mm=D(str(400 + flap)),
            )
            made.append(size)
        call_command("fold_setup", "--apply-links", stdout=StringIO())
        for size, flap, version in zip(made, (40, 30), (3, 5)):
            size.refresh_from_db()
            self.assertEqual((size.pouch_style_master.code, size.pouch_style_master.version), ("SIDE-SEAL-F-ON-FOLD", version))
            # Open web = 2 x 200 + flap (unchanged); folded = the two walls = 200; the flap is the size's own.
            self.assertEqual((size.stock_form, size.child_target_width_mm, size.film_area_width_mm), ("FOLDED_WEB", D("200.00"), D(str(400 + flap)) + D("0.00")))
            self.assertEqual(size.geometry_config["fold"]["flap_mm"], float(flap))
            self.assertEqual(open_width_for("FOLDED_WEB", size.child_target_width_mm, size.geometry_config["fold"]), D(str(400 + flap)) + D("0.00"))
        copy = PouchStyleMaster.objects.get(code="SIDE-SEAL-F-ON-FOLD", version=5)
        self.assertEqual(copy.stock_form_options["FOLDED_WEB"]["flap_field"], "Flap")
