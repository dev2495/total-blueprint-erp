import importlib.util
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.costing.models import MaterialCostSnapshot, ProcessCostRate
from apps.factory.models import Plant, PlantLegalProfile, Process
from apps.materials.models import InventoryMaterial, PouchStyleMaster, ProductMaster, ProductMasterSize
from apps.routing.models import RoutingRule
from apps.sales.models import Customer, SalesSku, SalesSkuVariant
from apps.sales.services.quotation_costing import QuotationCostingService
from apps.sales.services.quotation_pdf import QuotationPDFService
from apps.sales.services.quotation_service import QuotationService
from apps.templates.models import TemplateBlueprint


class QuotationModuleTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = get_user_model().objects.create_user(
            username="sales-user",
            email="sales@example.com",
            password="testpass123",
        )
        self.client.force_authenticate(self.user)
        self.customer = Customer.objects.create(name="Acme Flex", code="ACME")
        self.plant = Plant.objects.create(name="Main Plant", code="MAIN")
        PlantLegalProfile.objects.create(
            plant=self.plant,
            legal_name="Main Plant LLP",
            gstin="24ABCDE1234F1Z5",
            address="Industrial Zone, Ahmedabad",
            contact_phone="9999999999",
            contact_email="sales@example.com",
        )
        self.family = InventoryMaterial.objects.create(
            code="FILM-PE",
            name="PE Film",
            category="FILM_FAMILY",
            density_gcm3=Decimal("0.9200"),
            status="ACTIVE",
        )
        MaterialCostSnapshot.objects.create(material=self.family, avg_rate_per_kg=Decimal("205.0000"))
        self.process = Process.objects.create(
            code="PRINT",
            name="Printing",
            input_form="ROLL",
            output_form="ROLL",
            roll_behavior="MODIFY_EXISTING",
        )
        self.process_rate = ProcessCostRate.objects.create(
            process=self.process,
            cost_per_hour=Decimal("1200.00"),
            power_cost_per_hour=Decimal("300.00"),
            labor_cost_per_hour=Decimal("400.00"),
            overhead_cost_per_hour=Decimal("500.00"),
            is_active=True,
        )
        self.routing = RoutingRule.objects.create(name="Quote Route", ordered_processes=[self.process.code])
        self.template = TemplateBlueprint.objects.create(
            name="LIVE Printed Pouch",
            fg_type="POUCH",
            status="LIVE",
            routing_rule=self.routing,
        )
        self.sku = SalesSku.objects.create(
            code="UAT-QUOTE-SKU",
            name="UAT Quote SKU",
            template=self.template,
            default_line_name="UAT Quote SKU Line",
            active=True,
        )
        self.sku_variant = SalesSkuVariant.objects.create(
            sku=self.sku,
            code="UAT-QUOTE-SKU-120X180",
            name="UAT Quote SKU 120 x 180",
            active=True,
            finished_good_type="POUCH",
            roll_form="",
            geometry_snapshot={
                "base": {"width_mm": 120, "height_mm": 180},
                "adjustments": [],
                "multipliers": {"faces": 1},
            },
            layer_snapshot=[
                {
                    "family_id": str(self.family.id),
                    "thickness_micron": 50,
                    "density_g_cm3": 0.92,
                }
            ],
            printing_snapshot={"enabled": False},
            chemicals_snapshot={},
            addons_snapshot=[],
            packaging_snapshot={},
        )

    def _pouch_line(self, **overrides):
        payload = {
            "line_name": "Snack Pouch",
            "finished_good_type": "POUCH",
            "qty_value": 1000,
            "qty_uom": "PCS",
            "price_basis": "PCS",
            "geometry": {
                "base": {"width_mm": 120, "height_mm": 180},
                "adjustments": [],
                "multipliers": {"faces": 1},
            },
            "film_layers": [
                {
                    "family_id": str(self.family.id),
                    "thickness_micron": 50,
                    "density_g_cm3": 0.92,
                }
            ],
            "printing": {"enabled": False},
            "chemicals": {},
            "addons": [],
            "packaging_snapshot": {},
            "process_cost_rows": [
                {
                    "process_id": str(self.process.id),
                    "run_hours": 1.5,
                    "setup_hours": 0.25,
                }
            ],
            "commercial_snapshot": {
                "margin_target_percent": 18,
                "tax_percent": 18,
                "packing_value": 250,
            },
        }
        payload.update(overrides)
        return payload

    def _roll_line(self, **overrides):
        payload = {
            "line_name": "Printed Roll",
            "finished_good_type": "ROLL",
            "roll_form": "FLAT",
            "qty_value": 500,
            "qty_uom": "KG",
            "price_basis": "KG",
            "geometry": {"base": {"width_mm": 600, "height_mm": 0}, "adjustments": [], "multipliers": {"faces": 1}},
            "film_layers": [
                {
                    "family_id": str(self.family.id),
                    "thickness_micron": 35,
                    "density_g_cm3": 0.92,
                    "roll_width_mm": 600,
                }
            ],
            "printing": {"enabled": False},
            "chemicals": {},
            "addons": [],
            "packaging_snapshot": {},
            "commercial_snapshot": {"margin_target_percent": 12},
        }
        payload.update(overrides)
        return payload

    def test_preview_line_endpoint_returns_geometry_and_costing(self):
        response = self.client.post("/api/sales/quotations/preview-line/", self._pouch_line(), format="json")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertGreater(body["unit_weight_g"], 0)
        self.assertGreater(body["costing"]["material_cost"], 0)
        self.assertEqual(len(body["costing"]["process_lines"]), 1)
        self.assertGreater(body["costing"]["unit_price"], 0)

    def test_roll_preview_keeps_kg_authoritative_behavior(self):
        preview = QuotationService.preview_line(self._roll_line())

        self.assertEqual(preview["total_weight_kg"], 500.0)
        self.assertEqual(preview["price_basis"], "KG")
        self.assertGreater(preview["roll_preview"]["derived_length_m"], 0)
        self.assertGreater(preview["costing"]["net_total"], 0)

    def test_create_quotation_calculates_multi_line_totals(self):
        quotation = QuotationService.create_quotation(
            {
                "customer": str(self.customer.id),
                "plant": str(self.plant.id),
                "customer_name": self.customer.name,
                "valid_until": "2026-03-31",
                "terms": "Payment within 30 days",
                "items": [self._pouch_line(), self._roll_line()],
            }
        )

        self.assertTrue(quotation.quote_number.startswith("QT"))
        self.assertEqual(quotation.items.count(), 2)
        line_sum = sum(float(item.quoted_line_total) for item in quotation.items.all())
        self.assertAlmostEqual(float(quotation.totals_snapshot["subtotal"]), line_sum, places=3)
        self.assertEqual(quotation.totals_snapshot["item_count"], 2)

    def test_catalog_quotation_rejects_non_current_product_master(self):
        old_product = ProductMaster.objects.create(
            code="QUOTE-PM-OLD",
            name="Quote Product old",
            product_kind="POUCH",
            default_reporting_group="FG",
            template=self.template,
            active=True,
            is_current_version=False,
        )
        size = ProductMasterSize.objects.create(
            product_master=old_product,
            code="120X180",
            label="120 x 180",
            width_mm=120,
            height_mm=180,
            qty_uom="KG",
        )

        with self.assertRaises(ValidationError) as ctx:
            QuotationService.create_quotation(
                {
                    "customer": str(self.customer.id),
                    "plant": str(self.plant.id),
                    "customer_name": self.customer.name,
                    "items": [
                        {
                            "line_kind": "CATALOG",
                            "product_master": str(old_product.id),
                            "size": str(size.id),
                            "qty": 100,
                            "uom": "KG",
                            "rate": 50,
                        }
                    ],
                }
            )

        self.assertIn("not the current version", str(ctx.exception))

    def test_catalog_quotation_persists_current_master_and_size(self):
        product = ProductMaster.objects.create(
            code="QUOTE-PM-CURRENT",
            name="Quote Product current",
            product_kind="POUCH",
            default_reporting_group="FG",
            template=self.template,
            active=True,
            is_current_version=True,
        )
        size = ProductMasterSize.objects.create(
            product_master=product,
            code="130X210",
            label="130 x 210",
            width_mm=130,
            height_mm=210,
            qty_uom="KG",
        )

        quotation = QuotationService.create_quotation(
            {
                "customer": str(self.customer.id),
                "plant": str(self.plant.id),
                "customer_name": self.customer.name,
                "items": [
                    {
                        "line_kind": "CATALOG",
                        "product_master": str(product.id),
                        "size": str(size.id),
                        "line_name": "Repeat pouch",
                        "qty": 100,
                        "uom": "KG",
                        "rate": 75,
                        "spec_snapshot": {
                            "product_master_id": str(product.id),
                            "size_id": str(size.id),
                            "layers": [
                                {
                                    "material_id": str(self.family.id),
                                    "material_code": self.family.code,
                                    "material_name": self.family.name,
                                    "micron": 40,
                                    "gsm": 36.8,
                                    "rate_per_kg": 205,
                                }
                            ],
                        },
                    }
                ],
            }
        )

        item = quotation.items.get()
        self.assertEqual(item.template_id, self.template.id)
        self.assertEqual(item.spec_snapshot["product_master_id"], str(product.id))
        self.assertEqual(item.spec_snapshot["size_id"], str(size.id))
        self.assertEqual(item.spec_snapshot["width_mm"], 130.0)
        self.assertEqual(item.spec_snapshot["height_mm"], 210.0)

    def test_quotation_costing_includes_addons_without_fake_chemistry(self):
        result = QuotationCostingService.compute(
            spec={
                "layers": [
                    {
                        "name": "BOPP film",
                        "gsm": 100,
                        "rate_per_kg": 200,
                    }
                ],
                "adhesive_gsm": 0,
                "ink_gsm": 0,
                "addons": [
                    {
                        "name": "BOPP tape",
                        "qty_per_pouch": 2,
                        "rate_per_kg": 7.5,
                    }
                ],
                "conversion_stages": [],
            },
            manual_margin_pct=Decimal("10"),
        )

        self.assertEqual(result.material_cost_per_kg, Decimal("215.00"))
        material_rows = result.breakdown["materials"]
        self.assertEqual([row["kind"] for row in material_rows], ["FILM", "ADDON"])
        addon_row = material_rows[1]
        self.assertEqual(addon_row["qty_per_pouch"], 2.0)
        self.assertEqual(addon_row["unit_rate_per_kg"], 7.5)
        self.assertEqual(addon_row["contribution_per_kg"], 15.0)

    def test_quotation_costing_derives_layer_gsm_from_micron_and_density(self):
        result = QuotationCostingService.compute(
            spec={
                "layers": [
                    {
                        "name": "PE layer",
                        "material_id": str(self.family.id),
                        "micron": 50,
                        "gsm": 0,
                        "rate_per_kg": 205,
                    }
                ],
                "adhesive_gsm": 0,
                "ink_gsm": 0,
                "conversion_stages": [],
            },
            manual_margin_pct=Decimal("10"),
        )

        self.assertEqual(result.material_cost_per_kg, Decimal("205.00"))
        self.assertEqual(result.breakdown["materials"][0]["gsm"], 46.0)
        self.assertNotIn(
            "Total GSM is zero",
            " ".join(result.warnings),
        )

    def test_product_master_bom_suppresses_adhesive_for_single_layer_and_ink_when_not_printable(self):
        product = ProductMaster.objects.create(
            code="QUOTE-SINGLE-NO-PRINT",
            name="Single layer non-print pouch",
            product_kind="POUCH",
            default_reporting_group="FG",
            template=self.template,
            active=True,
            is_current_version=True,
            layer_template=[
                {
                    "position": "L1",
                    "material_code": self.family.code,
                    "thickness_micron": 40,
                }
            ],
            fixed_attributes={
                "print_capable": False,
                "artwork_required": False,
                "bom_defaults": {
                    "adhesive": {"name": "Should Hide", "gsm": 4, "rate_per_kg": 280},
                    "ink": {"name": "Should Hide Ink", "gsm": 3, "rate_per_kg": 400},
                },
            },
        )
        ProductMasterSize.objects.create(
            product_master=product,
            code="120X180",
            label="120 x 180",
            width_mm=120,
            height_mm=180,
            qty_uom="KG",
        )

        response = self.client.get(f"/api/master/products/{product.id}/bom/")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["adhesive"]["name"], "")
        self.assertEqual(body["adhesive"]["gsm"], 0)
        self.assertEqual(body["ink"]["name"], "")
        self.assertEqual(body["ink"]["gsm"], 0)
        self.assertFalse(body["print_capable"])
        self.assertFalse(body["artwork_required"])

    def test_adhoc_quote_promotes_base_master_into_new_product_and_size(self):
        pouch_style = PouchStyleMaster.objects.create(
            code="QUOTE-STYLE-SIMPLE",
            name="Quote simple open web",
            locked=True,
            formula_kind="LINEAR",
            default_stock_form="OPEN_WEB",
            default_width_basis="OPEN_WEB_WIDTH",
            default_slit_policy="SLIT_ALLOWED",
            allowed_fields={
                "W": {"required": True, "label": "Width"},
                "H": {"required": True, "label": "Height"},
                "G": {"label": "Gusset"},
            },
            formula_params={
                "terms": [
                    {"factors": [{"kind": "NUMBER", "value": 2}, {"kind": "FIELD", "field": "W"}]},
                    {"factors": [{"kind": "FIELD", "field": "G"}]},
                ],
                "trim_mm": 0,
            },
        )
        base_product = ProductMaster.objects.create(
            code="QUOTE-BASE-PM",
            name="Quote Base Master",
            product_kind="POUCH",
            default_reporting_group="FG",
            template=self.template,
            active=True,
            is_current_version=True,
            layer_template=[
                {
                    "position": "L1",
                    "material_code": self.family.code,
                    "thickness_micron": 40,
                }
            ],
            variant_axes=[{"axis": "SIZE", "type": "master_size", "required": True}],
            fixed_attributes={"route": "base"},
        )
        base_size = ProductMasterSize.objects.create(
            product_master=base_product,
            code="120X180",
            label="120 x 180",
            width_mm=120,
            height_mm=180,
            qty_uom="KG",
            pouch_style_master=pouch_style,
            pouch_style_version=pouch_style.version,
            child_target_width_mm=240,
            film_area_width_mm=240,
        )

        quotation = QuotationService.create_quotation(
            {
                "customer": str(self.customer.id),
                "plant": str(self.plant.id),
                "customer_name": self.customer.name,
                "items": [
                    {
                        "line_kind": "AD_HOC",
                        "line_name": "New custom quote pouch",
                        "qty": 250,
                        "uom": "KG",
                        "rate": 125,
                        "spec_snapshot": {
                            "base_product_master_id": str(base_product.id),
                            "base_product_master_code": base_product.code,
                            "base_product_master_name": base_product.name,
                            "base_size_id": str(base_size.id),
                            "base_size_label": base_size.label,
                            "pouch_style_id": str(pouch_style.id),
                            "pouch_style_code": pouch_style.code,
                            "pouch_style_roll_axis": pouch_style.default_roll_axis,
                            "stock_form": "OPEN_WEB",
                            "width_basis": "OPEN_WEB_WIDTH",
                            "child_target_width_mm": 290,
                            "film_area_width_mm": 290,
                            "width_mm": 135,
                            "height_mm": 220,
                            "gusset_mm": 20,
                            "flap_mm": 0,
                            "layers": [
                                {
                                    "material_id": str(self.family.id),
                                    "material_code": self.family.code,
                                    "material_name": self.family.name,
                                    "micron": 45,
                                    "gsm": 41.4,
                                    "rate_per_kg": 205,
                                }
                            ],
                            "adhesive": {"name": "Adhesive", "gsm": 0, "rate_per_kg": 0},
                            "ink": {"name": "Ink", "gsm": 0, "rate_per_kg": 0},
                            "addons": [],
                            "features": {},
                            "optional_inner_pack": None,
                            "save_as_master": True,
                        },
                    }
                ],
            }
        )

        sales_order = QuotationService.convert_to_sales_order(quotation)
        item = quotation.items.get()
        promoted_pm_id = item.spec_snapshot["product_master_id"]
        promoted_size_id = item.spec_snapshot["size_id"]

        self.assertNotEqual(promoted_pm_id, str(base_product.id))
        promoted = ProductMaster.objects.get(id=promoted_pm_id)
        promoted_size = ProductMasterSize.objects.get(id=promoted_size_id)
        self.assertEqual(promoted.product_kind, "POUCH")
        self.assertEqual(promoted.template_id, self.template.id)
        self.assertEqual(promoted.fixed_attributes["base_product_master_id"], str(base_product.id))
        self.assertEqual(promoted.variant_axes, base_product.variant_axes)
        self.assertEqual(promoted_size.product_master_id, promoted.id)
        self.assertEqual(promoted_size.width_mm, Decimal("135.00"))
        self.assertEqual(promoted_size.height_mm, Decimal("220.00"))
        self.assertEqual(promoted_size.gusset_mm, Decimal("20.00"))
        self.assertEqual(promoted_size.pouch_style_master_id, pouch_style.id)
        self.assertEqual(promoted_size.pouch_style_version, pouch_style.version)
        self.assertEqual(promoted_size.child_target_width_mm, Decimal("290.00"))
        self.assertEqual(promoted_size.film_area_width_mm, Decimal("290.00"))
        self.assertEqual(item.spec_snapshot["pouch_style_id"], str(pouch_style.id))
        self.assertEqual(item.spec_snapshot["child_target_width_mm"], 290.0)
        self.assertEqual(sales_order.items.count(), 1)
        self.assertEqual(sales_order.items.get().product_master_id, promoted.id)

    def test_sku_variant_quote_line_persists_and_seeds_template_defaults(self):
        quotation = QuotationService.create_quotation(
            {
                "customer": str(self.customer.id),
                "plant": str(self.plant.id),
                "customer_name": self.customer.name,
                "items": [
                    {
                        "sku_variant_id": str(self.sku_variant.id),
                        "qty_value": 1500,
                        "qty_uom": "PCS",
                        "price_basis": "PCS",
                        "geometry": {"base": {"width_mm": 125, "height_mm": 185}},
                        "commercial_snapshot": {"manual_unit_price": 9.25, "tax_percent": 18},
                    }
                ],
            }
        )

        item = quotation.items.get()
        self.assertEqual(item.sku_variant_id, self.sku_variant.id)
        self.assertEqual(item.template_id, self.template.id)
        self.assertEqual(item.line_name, self.sku_variant.name)
        self.assertEqual(item.geometry_snapshot["base"]["width_mm"], 125)
        self.assertEqual(item.geometry_snapshot["base"]["height_mm"], 185)
        self.assertGreater(float(item.quoted_line_total), 0)

    def test_api_round_trip_supports_create_list_and_patch(self):
        create_response = self.client.post(
            "/api/sales/quotations/",
            {
                "customer": str(self.customer.id),
                "plant": str(self.plant.id),
                "customer_name": self.customer.name,
                "status": "DRAFT",
                "items": [self._pouch_line()],
            },
            format="json",
        )

        self.assertEqual(create_response.status_code, 201)
        created = create_response.json()
        self.assertTrue(created["quote_number"].startswith("QT"))

        list_response = self.client.get("/api/sales/quotations/")
        self.assertEqual(list_response.status_code, 200)
        listed_payload = list_response.json()
        listed_rows = listed_payload["results"] if isinstance(listed_payload, dict) and "results" in listed_payload else listed_payload
        self.assertTrue(any(row["id"] == created["id"] for row in listed_rows))

        patch_response = self.client.patch(
            f"/api/sales/quotations/{created['id']}/",
            {
                "status": "SENT",
                "notes": "Updated after customer review",
                "items": [
                    self._pouch_line(
                        commercial_snapshot={
                            "margin_target_percent": 18,
                            "tax_percent": 18,
                            "manual_unit_price": 8.25,
                        }
                    )
                ],
            },
            format="json",
        )

        self.assertEqual(patch_response.status_code, 200)
        updated = patch_response.json()
        self.assertEqual(updated["status"], "SENT")
        self.assertEqual(updated["notes"], "Updated after customer review")
        self.assertEqual(len(updated["items"]), 1)
        self.assertGreater(updated["totals_snapshot"]["grand_total"], 0)

    def test_convert_rejects_missing_template(self):
        quotation = QuotationService.create_quotation(
            {
                "customer": str(self.customer.id),
                "plant": str(self.plant.id),
                "customer_name": self.customer.name,
                "items": [self._pouch_line()],
            }
        )

        with self.assertRaises(ValidationError):
            QuotationService.convert_to_sales_order(quotation)

    def test_convert_creates_sales_order_for_live_template_quote(self):
        quotation = QuotationService.create_quotation(
            {
                "customer": str(self.customer.id),
                "plant": str(self.plant.id),
                "customer_name": self.customer.name,
                "items": [self._pouch_line(template_id=str(self.template.id), process_cost_rows=[])],
            }
        )

        sales_order = QuotationService.convert_to_sales_order(quotation)
        quotation.refresh_from_db()

        self.assertEqual(sales_order.customer_name, self.customer.name)
        self.assertEqual(sales_order.items.count(), 1)
        self.assertEqual(quotation.status, "CONVERTED")
        self.assertEqual(quotation.converted_sales_order_id, sales_order.id)

    def test_convert_preserves_sku_variant_link_for_sku_quote(self):
        quotation = QuotationService.create_quotation(
            {
                "customer": str(self.customer.id),
                "plant": str(self.plant.id),
                "customer_name": self.customer.name,
                "items": [
                    {
                        "sku_variant_id": str(self.sku_variant.id),
                        "qty_value": 1500,
                        "qty_uom": "PCS",
                        "price_basis": "PCS",
                        "commercial_snapshot": {"manual_unit_price": 8.75, "tax_percent": 18},
                    }
                ],
            }
        )

        sales_order = QuotationService.convert_to_sales_order(quotation)
        order_item = sales_order.items.get()

        self.assertEqual(order_item.sku_variant_id, self.sku_variant.id)
        self.assertEqual(order_item.template_id, self.template.id)

    def test_duplicate_creates_new_quote_number(self):
        quotation = QuotationService.create_quotation(
            {
                "customer": str(self.customer.id),
                "plant": str(self.plant.id),
                "customer_name": self.customer.name,
                "items": [self._pouch_line()],
            }
        )

        duplicate = QuotationService.duplicate_quotation(quotation)

        self.assertNotEqual(quotation.id, duplicate.id)
        self.assertNotEqual(quotation.quote_number, duplicate.quote_number)
        self.assertEqual(duplicate.items.count(), quotation.items.count())
        self.assertEqual(duplicate.status, "DRAFT")

    def test_pdf_endpoint_returns_pdf_bytes(self):
        if importlib.util.find_spec("reportlab") is None:
            self.skipTest("reportlab is not installed")

        quotation = QuotationService.create_quotation(
            {
                "customer": str(self.customer.id),
                "plant": str(self.plant.id),
                "customer_name": self.customer.name,
                "items": [self._pouch_line()],
            }
        )

        response = self.client.get(f"/api/sales/quotations/{quotation.id}/pdf/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertTrue(response.content.startswith(b"%PDF"))
        pdf_bytes = QuotationPDFService.render_pdf_bytes(quotation)
        self.assertIn(quotation.quote_number.encode(), pdf_bytes)
        self.assertIn(self.customer.name.encode(), pdf_bytes)
        self.assertIn(b"System costing remains estimated", pdf_bytes)
