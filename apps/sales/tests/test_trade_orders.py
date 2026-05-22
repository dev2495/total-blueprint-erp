from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.factory.models import Plant
from apps.inventory.models import InventoryBulk, InventoryLocation, InventoryRoll
from apps.materials.models import InventoryMaterial, TradingGood, TradingGoodStock
from apps.sales.models import Customer, TradeOrder
from apps.users.models import Role


class TradeOrderFlowTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin_role = Role.objects.create(
            code="ADMIN",
            name="Admin",
            default_permissions=["*"],
        )
        self.admin = get_user_model().objects.create_user(
            username="trade_admin",
            email="trade_admin@example.com",
            password="trade-admin-123",
            role=self.admin_role,
        )
        self.client.force_authenticate(self.admin)

        self.plant = Plant.objects.create(name="Trade Plant", code="TRD")
        self.location = InventoryLocation.objects.create(
            plant=self.plant,
            code="TRD-FG",
            name="Trade FG",
            type="FG",
        )
        self.customer = Customer.objects.create(name="Trade Customer", code="TCUST")

        self.sellable_granule = InventoryMaterial.objects.create(
            code="TRD-GRANULE",
            name="Trade Granule",
            category="GRANULE",
            base_uom="KG",
            is_sellable=True,
            default_gst_pct=Decimal("18.00"),
        )
        self.non_sellable_granule = InventoryMaterial.objects.create(
            code="NO-SELL-GRANULE",
            name="No Sell Granule",
            category="GRANULE",
            base_uom="KG",
            is_sellable=False,
        )
        InventoryBulk.objects.create(
            material=self.sellable_granule,
            plant=self.plant,
            location=self.location,
            qty_kg=Decimal("25.0000"),
        )

        self.trading_good = TradingGood.objects.create(
            code="TG-READY-POUCH",
            name="Ready Pouch",
            base_uom="PCS",
            default_gst_pct=Decimal("18.00"),
            default_sale_rate=Decimal("2.50"),
        )
        TradingGoodStock.objects.create(
            trading_good=self.trading_good,
            plant=self.plant,
            qty=Decimal("100.000"),
            avg_cost=Decimal("1.25"),
        )

    def test_sellable_materials_endpoint_only_returns_active_sellable_rows(self):
        response = self.client.get("/api/sales/sellable-materials/")

        self.assertEqual(response.status_code, 200, response.content)
        returned_ids = {str(row["id"]) for row in response.data}
        self.assertIn(str(self.sellable_granule.id), returned_ids)
        self.assertNotIn(str(self.non_sellable_granule.id), returned_ids)
        row = next(r for r in response.data if str(r["id"]) == str(self.sellable_granule.id))
        self.assertEqual(Decimal(str(row["current_stock_qty"])), Decimal("25.0000"))

    def test_trade_order_item_options_only_returns_items_available_at_selected_plant(self):
        empty_plant = Plant.objects.create(name="Empty Trade Plant", code="ETP")

        response = self.client.get(f"/api/sales/trade-order-item-options/?plant={self.plant.id}")
        self.assertEqual(response.status_code, 200, response.content)
        keys = {row["key"] for row in response.data}
        self.assertIn(f"TG:{self.trading_good.id}", keys)
        self.assertIn(f"IM:{self.sellable_granule.id}", keys)
        self.assertTrue(all(Decimal(str(row["available_qty"])) > 0 for row in response.data))

        empty_response = self.client.get(f"/api/sales/trade-order-item-options/?plant={empty_plant.id}")
        self.assertEqual(empty_response.status_code, 200, empty_response.content)
        self.assertEqual(empty_response.data, [])

    def test_trade_order_create_requires_dispatch_stock_plant(self):
        response = self.client.post(
            "/api/sales/trade-orders/",
            {
                "customer": str(self.customer.id),
                "items": [
                    {
                        "line_no": 1,
                        "item_type": "TRADING_GOOD",
                        "trading_good_id": str(self.trading_good.id),
                        "qty": "1.000",
                        "uom": "PCS",
                        "rate": "2.50",
                        "gst_pct": "18.00",
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("Dispatch stock plant", str(response.data))

    def test_trade_order_create_rejects_lines_above_available_stock(self):
        response = self.client.post(
            "/api/sales/trade-orders/",
            {
                "customer": str(self.customer.id),
                "plant": str(self.plant.id),
                "items": [
                    {
                        "line_no": 1,
                        "item_type": "TRADING_GOOD",
                        "trading_good_id": str(self.trading_good.id),
                        "qty": "101.000",
                        "uom": "PCS",
                        "rate": "2.50",
                        "gst_pct": "18.00",
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("available at plant", str(response.data))

    def test_trade_order_create_aggregates_duplicate_item_stock_checks(self):
        response = self.client.post(
            "/api/sales/trade-orders/",
            {
                "customer": str(self.customer.id),
                "plant": str(self.plant.id),
                "items": [
                    {
                        "line_no": 1,
                        "item_type": "TRADING_GOOD",
                        "trading_good_id": str(self.trading_good.id),
                        "qty": "60.000",
                        "uom": "PCS",
                        "rate": "2.50",
                        "gst_pct": "18.00",
                    },
                    {
                        "line_no": 2,
                        "item_type": "TRADING_GOOD",
                        "trading_good_id": str(self.trading_good.id),
                        "qty": "41.000",
                        "uom": "PCS",
                        "rate": "2.50",
                        "gst_pct": "18.00",
                    },
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("requested 101.000", str(response.data))

    def test_trade_order_rejects_non_sellable_inventory_material(self):
        response = self.client.post(
            "/api/sales/trade-orders/",
            {
                "customer": str(self.customer.id),
                "plant": str(self.plant.id),
                "items": [
                    {
                        "line_no": 1,
                        "item_type": "INVENTORY_MATERIAL",
                        "inventory_material_id": str(self.non_sellable_granule.id),
                        "qty": "1.000",
                        "uom": "KG",
                        "rate": "10.00",
                        "gst_pct": "18.00",
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("Only ACTIVE materials flagged sellable", str(response.data))

    def test_trade_order_rejects_uom_mismatch(self):
        response = self.client.post(
            "/api/sales/trade-orders/",
            {
                "customer": str(self.customer.id),
                "plant": str(self.plant.id),
                "items": [
                    {
                        "line_no": 1,
                        "item_type": "INVENTORY_MATERIAL",
                        "inventory_material_id": str(self.sellable_granule.id),
                        "qty": "1.000",
                        "uom": "PCS",
                        "rate": "10.00",
                        "gst_pct": "18.00",
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("UOM must match material base UOM", str(response.data))

    def test_confirm_requires_stock_and_dispatch_decrements_trading_good_stock(self):
        create_response = self.client.post(
            "/api/sales/trade-orders/",
            {
                "customer": str(self.customer.id),
                "plant": str(self.plant.id),
                "items": [
                    {
                        "line_no": 1,
                        "item_type": "TRADING_GOOD",
                        "trading_good_id": str(self.trading_good.id),
                        "qty": "4.000",
                        "uom": "PCS",
                        "rate": "2.50",
                        "gst_pct": "18.00",
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(create_response.status_code, 201, create_response.content)
        order_id = create_response.data["id"]

        confirm_response = self.client.post(f"/api/sales/trade-orders/{order_id}/confirm/")
        self.assertEqual(confirm_response.status_code, 200, confirm_response.content)
        self.assertEqual(confirm_response.data["status"], "CONFIRMED")

        dispatch_response = self.client.post(f"/api/sales/trade-orders/{order_id}/dispatch/")
        self.assertEqual(dispatch_response.status_code, 200, dispatch_response.content)
        self.assertEqual(dispatch_response.data["status"], "DISPATCHED")

        stock = TradingGoodStock.objects.get(trading_good=self.trading_good, plant=self.plant)
        self.assertEqual(stock.qty, Decimal("96.000"))

    def test_confirm_blocks_order_without_plant(self):
        order = TradeOrder.objects.create(
            code="TO-NO-PLANT",
            customer=self.customer,
            status="DRAFT",
            created_by=self.admin,
        )
        order.items.create(
            line_no=1,
            item_type="TRADING_GOOD",
            trading_good=self.trading_good,
            qty=Decimal("1.000"),
            uom="PCS",
            rate=Decimal("2.50"),
            gst_pct=Decimal("18.00"),
        )

        response = self.client.post(f"/api/sales/trade-orders/{order.id}/confirm/")

        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("plant", str(response.data).lower())

    def test_dispatch_only_consumes_available_film_rolls_not_reserved_rolls(self):
        film_variant = InventoryMaterial.objects.create(
            code="TRD-FILM",
            name="Trade Film",
            category="FILM_VARIANT",
            base_uom="KG",
            is_sellable=True,
        )
        reserved = InventoryRoll.objects.create(
            label_id="TRD-ROLL-RESERVED",
            material=film_variant,
            plant=self.plant,
            location=self.location,
            width_mm=Decimal("500.00"),
            thickness_micron=Decimal("50.00"),
            weight_kg=Decimal("10.000"),
            status="RESERVED",
        )
        available = InventoryRoll.objects.create(
            label_id="TRD-ROLL-AVAILABLE",
            material=film_variant,
            plant=self.plant,
            location=self.location,
            width_mm=Decimal("500.00"),
            thickness_micron=Decimal("50.00"),
            weight_kg=Decimal("5.000"),
            status="AVAILABLE",
        )
        order = TradeOrder.objects.create(
            code="TO-FILM-RESERVED",
            customer=self.customer,
            plant=self.plant,
            status="DRAFT",
            created_by=self.admin,
        )
        order.items.create(
            line_no=1,
            item_type="INVENTORY_MATERIAL",
            inventory_material=film_variant,
            qty=Decimal("6.000"),
            uom="KG",
            rate=Decimal("100.00"),
            gst_pct=Decimal("18.00"),
        )

        response = self.client.post(f"/api/sales/trade-orders/{order.id}/confirm/")

        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("insufficient stock", str(response.data).lower())
        reserved.refresh_from_db()
        available.refresh_from_db()
        self.assertEqual(reserved.weight_kg, Decimal("10.000"))
        self.assertEqual(available.weight_kg, Decimal("5.000"))

    def test_confirmed_or_dispatched_orders_are_not_mutated_or_deleted(self):
        order = TradeOrder.objects.create(
            code="TO-LOCKED",
            customer=self.customer,
            plant=self.plant,
            status="CONFIRMED",
            created_by=self.admin,
        )
        order.items.create(
            line_no=1,
            item_type="TRADING_GOOD",
            trading_good=self.trading_good,
            qty=Decimal("1.000"),
            uom="PCS",
            rate=Decimal("2.50"),
            gst_pct=Decimal("18.00"),
        )

        patch_response = self.client.patch(
            f"/api/sales/trade-orders/{order.id}/",
            {"notes": "should not change"},
            format="json",
        )
        delete_response = self.client.delete(f"/api/sales/trade-orders/{order.id}/")

        self.assertEqual(patch_response.status_code, 400, patch_response.content)
        self.assertEqual(delete_response.status_code, 400, delete_response.content)
