from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase

from apps.factory.models import Process
from apps.materials.models import InventoryMaterial, ProductMaster, ProductMasterSize
from apps.recipes.models import RecipeGrade
from apps.routing.models import RoutingRule
from apps.sales.models import Customer, CustomerProductOverlay
from apps.sales.services.order_service import SalesOrderService
from apps.templates.models import TemplateBlueprint


class SalesProductLabelContractTests(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(code="AAP", name="A A Plast")
        self.process = Process.objects.create(
            code="POUCH-LABEL",
            name="Pouch label",
            input_form="ROLL",
            output_form="POUCH",
        )
        self.route = RoutingRule.objects.create(name="Label route", ordered_processes=[self.process.code])
        self.template = TemplateBlueprint.objects.create(
            name="Label template v9 hidden",
            fg_type="POUCH",
            status="LIVE",
            pouch_style="STAND_UP",
            routing_rule=self.route,
        )
        family = InventoryMaterial.objects.create(
            code="FAM-LABEL",
            name="Label film family",
            category="FILM_FAMILY",
            base_uom="KG",
            density_gcm3=Decimal("0.9200"),
        )
        InventoryMaterial.objects.create(
            code="PET12",
            name="PET 12",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            density_gcm3=Decimal("1.4000"),
            is_purchasable=True,
            is_extrudable=False,
        )
        InventoryMaterial.objects.create(
            code="LDMW",
            name="LDMW",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            density_gcm3=Decimal("0.9200"),
            is_purchasable=False,
            is_extrudable=True,
        )
        RecipeGrade.objects.create(name="GP", is_active=True)
        self.master = ProductMaster.objects.create(
            code="PM-LABEL",
            name="Dry fruit PM v4 hidden",
            product_kind="POUCH",
            template=self.template,
            default_template=self.template,
            layer_template=[
                {
                    "role": "print",
                    "film_variant_code": "PET12",
                    "thickness_micron": 12,
                    "input_roll_width_mm": 535,
                },
                {
                    "role": "sealant",
                    "film_variant_code": "LDMW",
                    "thickness_micron": 40,
                    "default_grade": "GP",
                    "grade_options": ["GP"],
                    "input_roll_width_mm": 535,
                },
            ],
            variant_axes=[
                {"axis": "size", "type": "geometry", "required": True, "options": ["220X320"]},
                {"axis": "layer_thicknesses", "type": "per_layer_number", "required": True},
                {"axis": "layer_grades", "type": "per_layer_enum", "required": False, "options": ["GP"]},
            ],
            fixed_attributes={"fg_type": "POUCH", "layer_count": 2, "print_capable": True},
        )
        ProductMasterSize.objects.create(
            product_master=self.master,
            code="220X320",
            label="220 x 320 + 35G",
            width_mm=220,
            height_mm=320,
            gusset_mm=35,
            roll_width_mm=535,
            qty_uom="KG",
            geometry_config={"pouch_style": "STAND_UP"},
        )
        self.overlay = CustomerProductOverlay.objects.create(
            customer=self.customer,
            product_master=self.master,
            customer_item_code="AAP-ALM-500G",
            customer_display_name="AAP Almond Pouch 500g",
            active=True,
        )

    @patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item")
    def test_order_create_stores_customer_first_canonical_label_and_policy_snapshot(self, preview_sales_item):
        preview_sales_item.return_value = {
            "unit_weight_g": Decimal("8.0000"),
            "total_weight_kg": Decimal("18.0000"),
            "bom": {
                "planning_lines": [],
                "planning_summary": {"line_count": 0},
                "issue_policy_overrides": [
                    {
                        "policy_key": "FILM:PET12",
                        "issue_policy_mode": "PERCENT_OVER_THEORY",
                        "issue_policy_value": 2,
                    }
                ],
                "is_complete": True,
            },
        }

        order = SalesOrderService.create_sales_order(
            {
                "customer": str(self.customer.id),
                "delivery_date": "2026-07-04",
                "items": [
                    {
                        "product_master": str(self.master.id),
                        "customer_product_overlay": str(self.overlay.id),
                        "axis_values": {
                            "size": "220X320",
                            "layer_thicknesses": {"1": 12, "2": 40},
                            "layer_grades": {"2": "GP"},
                        },
                        "qty_value": 2250,
                        "qty_uom": "KG",
                        "unit_price": 7.69,
                        "price_basis": "KG",
                        "printing": {
                            "enabled": True,
                            "type": "ROTO",
                            "front_colors_count": 5,
                            "back_colors_count": 1,
                            "ink_gsm_total": 2,
                            "chemicals": {"adhesive_gsm": 0.7, "solvent_gsm": 0.3},
                        },
                        "issue_policy_overrides": [
                            {
                                "policy_key": "FILM:PET12",
                                "issue_policy_mode": "PERCENT_OVER_THEORY",
                                "issue_policy_value": 2,
                            }
                        ],
                    }
                ],
            }
        )

        item = order.items.get()
        self.assertTrue(item.line_name.startswith("AAP Almond Pouch 500g - 220x320+35G"))
        self.assertIn("12+40", item.line_name)
        self.assertIn("PET/LDMW GP", item.line_name)
        self.assertIn("I2/A&S1", item.line_name)
        self.assertIn("ROTO6C", item.line_name)
        self.assertNotIn("v4", item.line_name.lower())
        self.assertNotIn("v9", item.line_name.lower())
        preview_payload = preview_sales_item.call_args.args[0]
        self.assertEqual(preview_payload["issue_policy_overrides"][0]["policy_key"], "FILM:PET12")
        self.assertEqual(item.bom_snapshot["issue_policy_overrides"][0]["policy_key"], "FILM:PET12")
