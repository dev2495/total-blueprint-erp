from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.factory.models import Plant
from apps.inventory.models import InventoryLocation, InventoryRoll, StockAdjustment
from apps.materials.models import InventoryMaterial, TradingGood, TradingGoodStock
from apps.users.models import Role


class StockAdjustmentTradingTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.store_role = Role.objects.create(
            code="STORE",
            name="Store",
            default_permissions=["users.self_manage", "inventory.view", "inventory.adjust"],
        )
        self.sales_role = Role.objects.create(
            code="SALES",
            name="Sales",
            default_permissions=["users.self_manage", "sales.view"],
        )
        self.store_user = get_user_model().objects.create_user(
            username="stock_adjuster",
            email="stock_adjuster@example.com",
            password="stock-adjust-123",
            role=self.store_role,
        )
        self.sales_user = get_user_model().objects.create_user(
            username="stock_view_only",
            email="stock_view_only@example.com",
            password="stock-view-123",
            role=self.sales_role,
        )

        self.plant = Plant.objects.create(name="Adjustment Plant", code="ADJ")
        self.location = InventoryLocation.objects.create(
            plant=self.plant,
            code="ADJ-FG",
            name="Adjustment FG",
            type="FG",
        )
        self.good = TradingGood.objects.create(
            code="TG-ADJ",
            name="Adjustable Trading Good",
            base_uom="PCS",
        )

    def _as_store(self):
        self.client.force_authenticate(self.store_user)

    def _as_sales(self):
        self.client.force_authenticate(self.sales_user)

    def test_adjustment_permission_required(self):
        self._as_sales()

        response = self.client.post(
            "/api/inventory/adjustments/",
            {
                "plant": str(self.plant.id),
                "reason": "COUNT_CORRECTION",
                "lines": [
                    {
                        "line_no": 1,
                        "stock_class": "TRADING_GOOD",
                        "trading_good": str(self.good.id),
                        "delta_qty": "5.000",
                        "uom": "PCS",
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403, response.content)

    def test_trading_good_adjustment_posts_and_voids_through_audit_pipeline(self):
        self._as_store()

        create_response = self.client.post(
            "/api/inventory/adjustments/",
            {
                "plant": str(self.plant.id),
                "reason": "COUNT_CORRECTION",
                "notes": "Opening trade stock correction",
                "lines": [
                    {
                        "line_no": 1,
                        "stock_class": "TRADING_GOOD",
                        "trading_good": str(self.good.id),
                        "delta_qty": "5.000",
                        "uom": "PCS",
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(create_response.status_code, 201, create_response.content)
        adj_id = create_response.data["id"]

        post_response = self.client.post(f"/api/inventory/adjustments/{adj_id}/post/")
        self.assertEqual(post_response.status_code, 200, post_response.content)
        self.assertEqual(post_response.data["status"], "POSTED")

        stock = TradingGoodStock.objects.get(trading_good=self.good, plant=self.plant)
        self.assertEqual(stock.qty, Decimal("5.000"))

        void_response = self.client.post(f"/api/inventory/adjustments/{adj_id}/void/")
        self.assertEqual(void_response.status_code, 200, void_response.content)
        self.assertEqual(void_response.data["status"], "VOID")

        stock.refresh_from_db()
        self.assertEqual(stock.qty, Decimal("0.000"))

    def test_incomplete_adjustment_line_is_rejected_before_posting(self):
        self._as_store()

        response = self.client.post(
            "/api/inventory/adjustments/",
            {
                "plant": str(self.plant.id),
                "reason": "COUNT_CORRECTION",
                "lines": [
                    {
                        "line_no": 1,
                        "stock_class": "TRADING_GOOD",
                        "delta_qty": "5.000",
                        "uom": "PCS",
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("TRADING_GOOD adjustments require a trading good", str(response.data))

    def test_voiding_roll_write_off_restores_available_status_when_weight_returns(self):
        self._as_store()
        film_variant = InventoryMaterial.objects.create(
            code="ADJ-FILM",
            name="Adjustment Film",
            category="FILM_VARIANT",
            base_uom="KG",
        )
        roll = InventoryRoll.objects.create(
            label_id="ADJ-ROLL-001",
            material=film_variant,
            plant=self.plant,
            location=self.location,
            width_mm=Decimal("500.00"),
            thickness_micron=Decimal("50.00"),
            weight_kg=Decimal("2.000"),
            status="AVAILABLE",
        )

        create_response = self.client.post(
            "/api/inventory/adjustments/",
            {
                "plant": str(self.plant.id),
                "reason": "WRITE_OFF",
                "lines": [
                    {
                        "line_no": 1,
                        "stock_class": "ROLL",
                        "inventory_roll": str(roll.id),
                        "delta_qty": "-2.000",
                        "uom": "KG",
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(create_response.status_code, 201, create_response.content)
        adj_id = create_response.data["id"]

        post_response = self.client.post(f"/api/inventory/adjustments/{adj_id}/post/")
        self.assertEqual(post_response.status_code, 200, post_response.content)
        roll.refresh_from_db()
        self.assertEqual(roll.weight_kg, Decimal("0.000"))
        self.assertEqual(roll.status, "CONSUMED")

        void_response = self.client.post(f"/api/inventory/adjustments/{adj_id}/void/")
        self.assertEqual(void_response.status_code, 200, void_response.content)
        roll.refresh_from_db()
        self.assertEqual(roll.weight_kg, Decimal("2.000"))
        self.assertEqual(roll.status, "AVAILABLE")

        adjustment = StockAdjustment.objects.get(id=adj_id)
        self.assertEqual(adjustment.status, "VOID")
