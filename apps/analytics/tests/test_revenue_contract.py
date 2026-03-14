from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from apps.sales.models import SalesOrder, SalesOrderItem
from apps.templates.models import TemplateBlueprint
from apps.users.models import User


class AnalyticsEndpointsRegressionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="analytics-owner",
            password="pass1234",
            is_owner=True,
            is_staff=True,
        )
        self.client.force_authenticate(self.user)

        self.template = TemplateBlueprint.objects.create(
            name="Analytics Template",
            fg_type="POUCH",
            status="DRAFT",
            created_by=self.user,
        )

        self._create_sales_with_pricing()

    def _create_sales_with_pricing(self):
        so_kg = SalesOrder.objects.create(
            customer_name="Customer KG",
            delivery_date="2026-02-28",
            status="CONFIRMED",
            execution_model_version=2,
        )
        SalesOrderItem.objects.create(
            sales_order=so_kg,
            template=self.template,
            mode="TEMPLATE",
            qty_uom="KG",
            qty_value=Decimal("10"),
            total_weight_kg=Decimal("10"),
            unit_weight_g=Decimal("20"),
            price_basis="KG",
            unit_price=Decimal("100"),
            geometry_snapshot={"finished_good_type": "POUCH", "base": {"width_mm": 100, "height_mm": 120}},
            layer_snapshot=[{"family_id": "x", "variant_id": "y", "thickness_micron": 20, "density_g_cm3": 1.2}],
            printing_snapshot={"enabled": False},
            addons_snapshot=[],
            bom_snapshot={},
        )

        so_pcs = SalesOrder.objects.create(
            customer_name="Customer PCS",
            delivery_date="2026-02-28",
            status="CONFIRMED",
            execution_model_version=2,
        )
        SalesOrderItem.objects.create(
            sales_order=so_pcs,
            template=self.template,
            mode="TEMPLATE",
            qty_uom="PCS",
            qty_value=Decimal("500"),
            total_weight_kg=Decimal("5"),
            unit_weight_g=Decimal("10"),
            price_basis="PCS",
            unit_price=Decimal("2"),
            geometry_snapshot={"finished_good_type": "POUCH", "base": {"width_mm": 80, "height_mm": 110}},
            layer_snapshot=[{"family_id": "x", "variant_id": "y", "thickness_micron": 18, "density_g_cm3": 1.2}],
            printing_snapshot={"enabled": False},
            addons_snapshot=[],
            bom_snapshot={},
        )

    def test_control_tower_returns_commercial_revenue_metric(self):
        response = self.client.get("/api/analytics/control-tower/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("metrics", payload)
        metrics = payload.get("metrics", [])
        revenue = next((row for row in metrics if row.get("id") == "revenue"), None)
        self.assertIsNotNone(revenue)
        # Expected: 10*100 (KG basis) + 500*2 (PCS basis) = 2000
        self.assertAlmostEqual(float(revenue.get("value", 0)), 2000.0, places=2)

    def test_sales_dashboard_endpoint_returns_metrics_payload(self):
        response = self.client.get("/api/analytics/sales-dashboard/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("metrics", payload)
        self.assertIsInstance(payload.get("metrics"), list)
