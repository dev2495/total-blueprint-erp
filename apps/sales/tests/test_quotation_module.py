import importlib.util
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.costing.models import MaterialCostSnapshot, ProcessCostRate
from apps.factory.models import Plant, PlantLegalProfile, Process
from apps.materials.models import InventoryMaterial
from apps.routing.models import RoutingRule
from apps.sales.models import Customer
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
