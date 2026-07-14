from decimal import Decimal
from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from apps.materials.models import InventoryMaterial, PouchStyleMaster, ProductMaster, ProductMasterSize
from apps.materials.serializers import PouchStyleSerializer
from apps.materials.services_pouch_style import (
    formula_axis_contract_error,
    infer_formula_roll_axis,
)
from apps.materials.services_product_variant import compute_geometry, compute_layers, find_or_create_product_variant
from apps.sales.services.axis_resolver import OrderResolutionService
from apps.sales.services.order_service import SalesOrderService
from apps.templates.models import TemplateBlueprint


WIDTH_LINEAR_PARAMS = {
    "terms": [
        {
            "factors": [
                {"kind": "NUMBER", "value": 2},
                {"kind": "FIELD", "field": "W"},
            ]
        },
        {
            "factors": [
                {"kind": "NUMBER", "value": 1},
                {"kind": "FIELD", "field": "Flap"},
            ]
        },
    ],
    "trim_mm": 0,
}


class FormulaAxisContractUnitTests(TestCase):
    def test_all_closed_pouch_formulas_resolve_their_canonical_web_axis(self):
        expected = {
            "SIMPLE_DOUBLE": "WIDTH",
            "THREE_SIDE_SEAL": "WIDTH",
            "GUSSETED_SIDE": "WIDTH",
            "GUSSETED_BOTTOM": "WIDTH",
            "QUAD_SEAL": "WIDTH",
            "FLAT_BOTTOM": "WIDTH",
            "CENTER_SEAL_H": "HEIGHT",
            "SPOUT": "WIDTH",
            "STICK_PACK": "WIDTH",
            "SACHET": "WIDTH",
        }
        for formula_kind, axis in expected.items():
            with self.subTest(formula_kind=formula_kind):
                self.assertEqual(infer_formula_roll_axis(formula_kind, {}, {}), axis)

    def test_linear_dimension_inference_ignores_hd_and_auxiliary_fields(self):
        params = {
            "terms": WIDTH_LINEAR_PARAMS["terms"]
            + [{"factors": [{"kind": "NUMBER", "value": 2}, {"kind": "FIELD", "field": "HD"}]}]
        }
        self.assertEqual(infer_formula_roll_axis("LINEAR", params, {}), "WIDTH")

    def test_contract_reports_inverted_axis(self):
        error = formula_axis_contract_error(
            default_roll_axis="HEIGHT",
            formula_kind="LINEAR",
            formula_params=WIDTH_LINEAR_PARAMS,
            formula_ast={},
        )
        self.assertIn("Set default_roll_axis to WIDTH", error)

    def test_pouch_style_serializer_blocks_inverted_axis(self):
        serializer = PouchStyleSerializer(
            data={
                "code": "BAD-SIDE-SEAL",
                "name": "Bad side seal",
                "default_roll_axis": "HEIGHT",
                "formula_kind": "LINEAR",
                "formula_params": WIDTH_LINEAR_PARAMS,
                "formula_ast": {},
            }
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn("default_roll_axis", serializer.errors)


class IncidentBomMathRegressionTests(TestCase):
    def setUp(self):
        self.template = TemplateBlueprint.objects.create(
            name="Incident BOM template",
            fg_type="POUCH",
            status="LIVE",
        )
        self.family = InventoryMaterial.objects.create(
            code="INCIDENT-BOPP-FAMILY",
            name="Incident BOPP",
            category="FILM_FAMILY",
            base_uom="KG",
            density_gcm3=Decimal("0.9200"),
            status="ACTIVE",
        )
        self.tt = InventoryMaterial.objects.create(
            code="TT",
            name="BOPP",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=self.family,
            status="ACTIVE",
        )
        # Deliberately reproduce the corrupt live master. Runtime resolution
        # must infer WIDTH from the formula until the repair command corrects it.
        self.style = PouchStyleMaster.objects.create(
            code="INCIDENT-SIDE-SEAL",
            name="Incident side seal",
            version=1,
            locked=True,
            default_roll_axis="HEIGHT",
            formula_kind="LINEAR",
            formula_params=WIDTH_LINEAR_PARAMS,
            formula_expression="2 x W + Flap",
        )
        self.master = ProductMaster.objects.create(
            code="INCIDENT-BOPP-ROTO",
            name="Incident BOPP Roto",
            product_kind="POUCH",
            template=self.template,
            fixed_attributes={"fg_type": "POUCH", "print_capable": False},
            layer_template=[
                {
                    "role": "layer-1",
                    "film_variant_code": "TT",
                    "thickness_micron": 37,
                    "thickness_apportion": "variable",
                }
            ],
            variant_axes=[
                {"axis": "size", "type": "geometry", "required": True},
                {"axis": "layer_thicknesses", "type": "per_layer_number", "required": True},
            ],
        )
        self.size = ProductMasterSize.objects.create(
            product_master=self.master,
            code="255X305",
            label="255X305",
            width_mm=Decimal("305"),
            height_mm=Decimal("255"),
            gusset_mm=Decimal("0"),
            pouch_style_master=self.style,
            pouch_style_version=1,
            child_target_width_mm=Decimal("650"),
            film_area_width_mm=Decimal("650"),
            stock_form="OPEN_WEB",
            width_basis="OPEN_WEB_WIDTH",
        )
        self.axis_values = {
            "size": self.size.code,
            "layer_thicknesses": {"1": 37},
        }

    def test_exact_50000_piece_incident_math_and_material_plan(self):
        geometry = compute_geometry(self.master, self.axis_values)
        layers = compute_layers(self.master, self.axis_values, geometry)

        self.assertEqual(geometry["pouch_style_roll_axis"], "WIDTH")
        self.assertEqual(geometry["consumption_pitch_axis"], "HEIGHT")
        self.assertEqual(geometry["consumption_pitch_mm"], 255.0)
        self.assertEqual(layers[0]["density_g_cm3"], 0.92)

        preview = SalesOrderService.preview_sales_item(
            {
                "template_id": str(self.template.id),
                "finished_good_type": "POUCH",
                "order_qty": 50000,
                "uom": "PCS",
                "geometry": geometry,
                "film_layers": layers,
                "printing": {"enabled": False},
                "addons": [],
                "packaging_snapshot": {},
            }
        )

        self.assertEqual(Decimal(str(preview["unit_weight_g"])), Decimal("5.642130"))
        self.assertEqual(Decimal(str(preview["total_weight_kg"])), Decimal("282.106500"))
        film_line = next(row for row in preview["bom"]["planning_lines"] if row["category_code"] == "FILM")
        self.assertEqual(Decimal(str(film_line["theoretical_qty"])), Decimal("282.1065"))
        self.assertEqual(Decimal(str(preview["bom"]["summary"]["unit_weight_g"])), Decimal("5.64213"))
        self.assertEqual(Decimal(str(preview["bom"]["summary"]["total_weight_g"])), Decimal("282106.5"))

    def test_resolution_recomputes_instead_of_trusting_poisoned_variant_cache(self):
        variant, _created = find_or_create_product_variant(self.master, self.axis_values)
        poisoned_geometry = dict(variant.geometry_snapshot)
        poisoned_geometry.update(
            {
                "pouch_style_roll_axis": "HEIGHT",
                "consumption_pitch_axis": "WIDTH",
                "consumption_pitch_mm": 305,
            }
        )
        poisoned_layers = [dict(variant.layer_snapshot[0], density_g_cm3=0.91)]
        variant.geometry_snapshot = poisoned_geometry
        variant.layer_snapshot = poisoned_layers
        variant.save(update_fields=["geometry_snapshot", "layer_snapshot"])

        resolved = OrderResolutionService.resolve_line(
            {
                "product_master": str(self.master.id),
                "axis_values": self.axis_values,
                "qty": 50000,
                "quantity_uom": "PCS",
            },
            create_variant=False,
        )

        self.assertEqual(resolved["geometry_snapshot"]["pouch_style_roll_axis"], "WIDTH")
        self.assertEqual(resolved["geometry_snapshot"]["consumption_pitch_mm"], 255.0)
        self.assertEqual(resolved["layer_snapshot"][0]["density_g_cm3"], 0.92)

    def test_repair_command_is_dry_run_by_default_and_idempotent_when_applied(self):
        # The command identifies the canonical TT variant, so use the incident
        # family's starting density to reproduce production before applying.
        self.family.density_gcm3 = Decimal("0.9100")
        self.family.save(update_fields=["density_gcm3"])

        dry_output = StringIO()
        call_command("repair_bom_math_contracts", stdout=dry_output)
        self.style.refresh_from_db()
        self.family.refresh_from_db()
        self.assertEqual(self.style.default_roll_axis, "HEIGHT")
        self.assertEqual(self.family.density_gcm3, Decimal("0.9100"))

        apply_output = StringIO()
        call_command("repair_bom_math_contracts", "--apply", stdout=apply_output)
        self.style.refresh_from_db()
        self.family.refresh_from_db()
        self.assertEqual(self.style.default_roll_axis, "WIDTH")
        self.assertEqual(self.family.density_gcm3, Decimal("0.9200"))

        second_output = StringIO()
        call_command("repair_bom_math_contracts", "--apply", stdout=second_output)
        self.assertIn("Formula-axis styles requiring correction: 0", second_output.getvalue())
