from decimal import Decimal

from django.test import TestCase

from apps.bom.services_resolver import BOMResolverService
from apps.factory.models import Process
from apps.materials.models import InventoryMaterial
from apps.sales.services import order_service
from apps.templates.models import TemplateBlueprint, TemplateProcessStep, TemplateProcessStepMaterial


class AddonUomPlanningTests(TestCase):
    def setUp(self):
        self.template = TemplateBlueprint.objects.create(name="Addon UOM Template", fg_type="POUCH", status="LIVE")
        self.process = Process.objects.create(code="ADDON_STEP", name="Addon Step")
        self.step = TemplateProcessStep.objects.create(template=self.template, sequence_number=1, process=self.process)
        TemplateProcessStepMaterial.objects.create(
            template_step=self.step,
            category_code="ADDON",
            consumption_basis="CATEGORY_FORMULA",
            formula_driver="ADDON_MASTER_WEIGHT_MODE",
            value=Decimal("0"),
            issue_policy_mode="NONE",
            capture_mode="AUTO_ESTIMATED_CONFIRM",
        )

    def _resolve(self, addon, *, qty=1, applies_to="WIDTH", order_qty=10):
        template_snapshot = {
            "template_id": str(self.template.id),
            "order_qty": order_qty,
            "uom": "PCS",
            "addons": [{"addon_id": str(addon.id), "qty": qty, "applies_to": applies_to}],
            "film_layers": [],
            "printing": {"enabled": False},
        }
        physics_snapshot = {
            "geometry_snapshot": {
                "finished_good_type": "POUCH",
                "effective_width_mm": 200,
                "effective_height_mm": 300,
            }
        }
        bom = BOMResolverService.resolve(template_snapshot, physics_snapshot)
        planning_lines = order_service._build_material_plan_lines(
            template_snapshot,
            bom,
            quantity_multiplier=order_qty,
        )
        return bom, planning_lines

    def test_meter_per_mm_addon_plans_meter_stock_not_weight_kg(self):
        zipper = InventoryMaterial.objects.create(
            code="ZIP-MTR-PLAN",
            name="Meter zipper planning",
            category="ADDON",
            base_uom="METER",
            weight_mode="PER_MM",
            weight_value=0.015,
            addon_is_purchased=True,
            addon_purchase_uom="METER",
        )

        bom, planning_lines = self._resolve(zipper, qty=2, applies_to="WIDTH", order_qty=10)

        addon_row = bom["addons"][0]
        self.assertEqual(addon_row["stock_uom"], "METER")
        self.assertEqual(Decimal(str(addon_row["stock_qty"])), Decimal("0.4"))
        self.assertEqual(Decimal(str(addon_row["weight_kg"])), Decimal("0.006"))

        plan = planning_lines[0]
        self.assertEqual(plan["material_code"], zipper.code)
        self.assertEqual(plan["uom"], "METER")
        self.assertEqual(Decimal(str(plan["theoretical_qty"])), Decimal("4.0"))
        self.assertEqual(Decimal(str(plan["planned_issue_qty"])), Decimal("4.0"))

    def test_piece_and_kg_addons_keep_their_stock_units(self):
        piece_addon = InventoryMaterial.objects.create(
            code="HANDLE-PCS-PLAN",
            name="Handle piece planning",
            category="ADDON",
            base_uom="PCS",
            weight_mode="PER_PIECE",
            weight_value=1.2,
            addon_is_purchased=True,
            addon_purchase_uom="PCS",
        )
        kg_addon = InventoryMaterial.objects.create(
            code="DUST-KG-PLAN",
            name="Dusting additive planning",
            category="ADDON",
            base_uom="KG",
            weight_mode="FIXED",
            weight_value=3.5,
            addon_is_purchased=True,
            addon_purchase_uom="KG",
        )

        _, piece_lines = self._resolve(piece_addon, qty=3, order_qty=10)
        _, kg_lines = self._resolve(kg_addon, qty=2, order_qty=10)

        self.assertEqual(piece_lines[0]["uom"], "PCS")
        self.assertEqual(Decimal(str(piece_lines[0]["theoretical_qty"])), Decimal("30.0"))
        self.assertEqual(kg_lines[0]["uom"], "KG")
        self.assertEqual(Decimal(str(kg_lines[0]["theoretical_qty"])), Decimal("0.07"))


class WebBasisBomResolverTests(TestCase):
    def setUp(self):
        self.family = InventoryMaterial.objects.create(
            code="BOM-BOPP-FAM",
            name="BOM BOPP family",
            category="FILM_FAMILY",
            base_uom="KG",
            density_gcm3=Decimal("0.91"),
            status="ACTIVE",
        )
        self.variant = InventoryMaterial.objects.create(
            code="BOM-BOPP-37",
            name="BOM BOPP 37 micron",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=self.family,
            density_gcm3=Decimal("0.91"),
            status="ACTIVE",
        )

    def test_resolver_uses_physics_web_area_for_pouch_film_bom(self):
        template_snapshot = {
            "order_qty": 1000,
            "uom": "PCS",
            "film_layers": [
                {
                    "family_id": str(self.family.id),
                    "variant_id": str(self.variant.id),
                    "thickness_micron": 37,
                    "density_g_cm3": "0.91",
                }
            ],
            "printing": {"enabled": False},
        }
        physics_snapshot = {
            "total_weight_g": "7.2700",
            "geometry_snapshot": {
                "finished_good_type": "POUCH",
                "effective_width_mm": 270,
                "effective_height_mm": 330,
                "area_m2": 0.216,
                "area_basis": "WEB_BASIS",
                "film_area_width_mm": 800,
                "consumption_pitch_mm": 270,
            },
        }

        bom = BOMResolverService.resolve(template_snapshot, physics_snapshot)

        # 800 mm web x 270 mm pitch x 37 micron x 0.91 density / 1e6
        # = 7.27272 g/pouch = 0.00727272 kg/pouch, rounded by resolver.
        self.assertEqual(Decimal(str(bom["films"][0]["weight_kg"])), Decimal("0.00727272"))
        self.assertNotEqual(Decimal(str(bom["films"][0]["weight_kg"])), Decimal("0.006007"))

    def test_resolver_derives_web_area_from_width_and_pitch_when_area_missing(self):
        template_snapshot = {
            "order_qty": 1000,
            "uom": "PCS",
            "film_layers": [
                {
                    "family_id": str(self.family.id),
                    "variant_id": str(self.variant.id),
                    "thickness_micron": 37,
                    "density_g_cm3": "0.91",
                }
            ],
            "printing": {"enabled": False},
        }
        physics_snapshot = {
            "total_weight_g": "7.2700",
            "geometry_snapshot": {
                "finished_good_type": "POUCH",
                "effective_width_mm": 270,
                "effective_height_mm": 330,
                "film_area_width_mm": 800,
                "consumption_pitch_mm": 270,
            },
        }

        bom = BOMResolverService.resolve(template_snapshot, physics_snapshot)

        self.assertEqual(Decimal(str(bom["films"][0]["weight_kg"])), Decimal("0.00727272"))

    def test_sales_preview_uses_web_basis_for_unit_and_bom_weight(self):
        preview = order_service.SalesOrderService.preview_sales_item(
            {
                "finished_good_type": "POUCH",
                "order_qty": 1000,
                "uom": "PCS",
                "geometry": {
                    "base": {"width_mm": 270, "height_mm": 330},
                    "film_area_width_mm": 800,
                    "child_target_width_mm": 800,
                    "stock_width_mm": 800,
                    "pouch_style_roll_axis": "HEIGHT",
                    "stock_form": "OPEN_WEB",
                    "width_basis": "OPEN_WEB_WIDTH",
                },
                "film_layers": [
                    {
                        "family_id": str(self.family.id),
                        "variant_id": str(self.variant.id),
                        "thickness_micron": 37,
                        "density_g_cm3": "0.91",
                    }
                ],
                "printing": {"enabled": False},
            }
        )

        self.assertEqual(Decimal(str(preview["unit_weight_g"])).quantize(Decimal("0.001")), Decimal("7.273"))
        self.assertEqual(Decimal(str(preview["total_weight_kg"])).quantize(Decimal("0.001")), Decimal("7.273"))
        self.assertEqual(Decimal(str(preview["bom"]["films"][0]["weight_kg"])), Decimal("0.00727272"))

    def test_layflat_tube_web_basis_uses_doubled_area_width_without_faces(self):
        template_snapshot = {
            "order_qty": 1000,
            "uom": "PCS",
            "film_layers": [
                {
                    "family_id": str(self.family.id),
                    "variant_id": str(self.variant.id),
                    "thickness_micron": 37,
                    "density_g_cm3": "0.91",
                }
            ],
            "printing": {"enabled": False},
        }
        physics_snapshot = {
            "geometry_snapshot": {
                "finished_good_type": "POUCH",
                "stock_form": "LAYFLAT_TUBE",
                "width_basis": "LAYFLAT_WIDTH",
                "child_target_width_mm": 400,
                "film_area_width_mm": 800,
                "consumption_pitch_mm": 270,
                "area_basis": "WEB_BASIS",
            },
        }

        bom = BOMResolverService.resolve(template_snapshot, physics_snapshot)

        self.assertEqual(Decimal(str(bom["films"][0]["weight_kg"])), Decimal("0.00727272"))
