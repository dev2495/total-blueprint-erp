from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from apps.factory.models import Plant
from apps.inventory.models import (
    BulkTransaction,
    InventoryBulk,
    InventoryCorrectionAudit,
    InventoryLocation,
    InventoryRoll,
    PackagingTransaction,
    RollMovement,
    Vendor,
)
from apps.inventory.services.grn import GRNService
from apps.materials.models import InventoryMaterial, TradingGood, TradingGoodStock
from apps.procurement.services.trading_good_receipt import TradingGoodReceiptService
from apps.users.models import Role, User


class GRNHistoryTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.role, _ = Role.objects.get_or_create(
            code="STORE",
            defaults={"name": "Store", "default_permissions": ["inventory.view", "inventory.manage"]},
        )
        self.user = User.objects.create_user(username=f"store-grn-{self._testMethodName}", password="pass12345", role=self.role)
        self.client.force_authenticate(self.user)

        self.plant = Plant.objects.create(name="Plant GRN", code="P-GRN")
        self.second_plant = Plant.objects.create(name="Plant GRN 2", code="P-GRN2")
        self.location = InventoryLocation.objects.create(plant=self.plant, code="RM", name="RM Store", type="RM")
        self.second_location = InventoryLocation.objects.create(plant=self.second_plant, code="RM2", name="RM Store 2", type="RM")
        self.vendor = Vendor.objects.create(name="Vendor GRN", code="V-GRN", type="RM", status="ACTIVE")
        self.bulk_material = InventoryMaterial.objects.create(code="GRN-BULK", name="GRN Bulk", category="GRANULE", base_uom="KG")
        self.packaging_material = InventoryMaterial.objects.create(
            code="GRN-PACK",
            name="GRN Pack",
            category="PACKAGING",
            base_uom="PCS",
            packaging_kind="BOX",
            packaging_supply_mode="PURCHASED",
        )
        self.family = InventoryMaterial.objects.create(code="GRN-FAM", name="GRN Family", category="FILM_FAMILY", base_uom="KG")
        self.roll_material = InventoryMaterial.objects.create(
            code="GRN-ROLL",
            name="GRN Roll",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=self.family,
            is_purchasable=True,
            is_extrudable=False,
        )
        self.trading_good = TradingGood.objects.create(
            code="TG-GRN",
            name="Trading GRN Good",
            trade_type="READY_POUCH",
            base_uom="PCS",
            is_active=True,
        )

    def _seed_all_inwards(self):
        GRNService.create_bulk_grn(
            material=self.bulk_material,
            location=self.location,
            vendor=self.vendor,
            quantity=100,
            plant=self.plant,
            cost=90,
            reference="BULK-REF",
        )
        self.client.post(
            "/api/inventory/grn/packaging/",
            {
                "material_id": str(self.packaging_material.id),
                "location_id": str(self.location.id),
                "vendor_id": str(self.vendor.id),
                "quantity": "20",
                "cost": "4",
                "reference": "PACK-REF",
            },
            format="json",
        )
        GRNService.create_roll_grn(
            material=self.roll_material,
            location=self.location,
            vendor=self.vendor,
            plant=self.plant,
            rolls_data=[{"label_id": "GRN-ROLL-001", "thickness_micron": 50, "width_mm": 500, "weight_kg": 25}],
            reference="ROLL-REF",
        )

    def test_history_returns_bulk_packaging_and_roll_rows(self):
        self._seed_all_inwards()

        response = self.client.get("/api/inventory/grn/history/")

        self.assertEqual(response.status_code, 200)
        rows = response.json()["results"]
        self.assertEqual({row["source_type"] for row in rows}, {"BULK", "PACKAGING", "ROLL"})
        self.assertTrue(any(row["reference"].endswith("BULK-REF") for row in rows))
        self.assertTrue(any(row["label_id"] == "GRN-ROLL-001" for row in rows))

    def test_correction_requires_reason(self):
        GRNService.create_bulk_grn(
            material=self.bulk_material,
            location=self.location,
            vendor=self.vendor,
            quantity=100,
            plant=self.plant,
            cost=90,
            reference="BULK-REF",
        )
        tx = BulkTransaction.objects.get(type="INWARD")

        response = self.client.post(f"/api/inventory/grn/history/BULK/{tx.id}/correct/", {"quantity": "95"}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertIn("reason", response.json()["error"].lower())

    def test_bulk_correction_posts_adjustment_and_audit(self):
        GRNService.create_bulk_grn(
            material=self.bulk_material,
            location=self.location,
            vendor=self.vendor,
            quantity=100,
            plant=self.plant,
            cost=90,
            reference="BULK-REF",
        )
        tx = BulkTransaction.objects.get(type="INWARD")

        response = self.client.post(
            f"/api/inventory/grn/history/BULK/{tx.id}/correct/",
            {"quantity": "95", "avg_cost": "91", "reason": "Invoice quantity was 95 kg."},
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.json())
        self.assertTrue(BulkTransaction.objects.filter(type="ADJUST", reference__contains=str(tx.id)).exists())
        audit = InventoryCorrectionAudit.objects.get(source_type="BULK", source_id=tx.id)
        self.assertEqual(audit.actor, self.user)
        self.assertEqual(audit.before_json["quantity"], 100.0)
        self.assertEqual(audit.after_json["quantity"], 95.0)
        self.assertEqual(Decimal(str(audit.delta_json["quantity"])), Decimal("-5.0"))

    def test_bulk_correction_can_move_corrected_stock_to_another_location(self):
        GRNService.create_bulk_grn(
            material=self.bulk_material,
            location=self.location,
            vendor=self.vendor,
            quantity=100,
            plant=self.plant,
            cost=90,
            reference="BULK-REF",
        )
        tx = BulkTransaction.objects.get(type="INWARD")

        response = self.client.post(
            f"/api/inventory/grn/history/BULK/{tx.id}/correct/",
            {
                "quantity": "95",
                "location": str(self.second_location.id),
                "reason_code": "LOCATION_MISMATCH",
                "reason": "Material was unloaded into the second plant store.",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.json())
        old_stock = InventoryBulk.objects.get(material=self.bulk_material, location=self.location)
        new_stock = InventoryBulk.objects.get(material=self.bulk_material, location=self.second_location)
        self.assertEqual(old_stock.qty_kg, Decimal("0.0000"))
        self.assertEqual(new_stock.qty_kg, Decimal("95.0000"))
        audit = InventoryCorrectionAudit.objects.get(source_type="BULK", source_id=tx.id)
        self.assertTrue(audit.delta_json["location_changed"])
        self.assertEqual(audit.after_json["location"], str(self.second_location.id))

    def test_bulk_rate_only_correction_updates_effective_history_and_stock_rate(self):
        GRNService.create_bulk_grn(
            material=self.bulk_material,
            location=self.location,
            vendor=self.vendor,
            quantity=100,
            plant=self.plant,
            cost=90,
            reference="BULK-RATE-REF",
        )
        tx = BulkTransaction.objects.get(type="INWARD")

        response = self.client.post(
            f"/api/inventory/grn/history/BULK/{tx.id}/correct/",
            {"quantity": "100", "avg_cost": "91.5", "reason": "Invoice rate was corrected."},
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.json())
        stock = InventoryBulk.objects.get(material=self.bulk_material, location=self.location)
        self.assertEqual(stock.qty_kg, Decimal("100.0000"))
        self.assertEqual(stock.avg_cost, Decimal("91.5000"))

        history = self.client.get("/api/inventory/grn/history/", {"source_type": "BULK", "search": "BULK-RATE-REF"})
        self.assertEqual(history.status_code, 200, history.json())
        row = history.json()["results"][0]
        self.assertTrue(row["has_correction"])
        self.assertEqual(row["avg_cost"], 91.5)
        self.assertEqual(row["original_avg_cost"], 90.0)
        self.assertEqual(row["quantity"], 100.0)

    def test_packaging_correction_posts_adjustment_and_audit(self):
        self.client.post(
            "/api/inventory/grn/packaging/",
            {
                "material_id": str(self.packaging_material.id),
                "location_id": str(self.location.id),
                "vendor_id": str(self.vendor.id),
                "quantity": "20",
                "cost": "4",
                "reference": "PACK-REF",
            },
            format="json",
        )
        tx = PackagingTransaction.objects.get(type="INWARD")

        response = self.client.post(
            f"/api/inventory/grn/history/PACKAGING/{tx.id}/correct/",
            {"quantity": "25", "reason": "Five extra boxes found during unloading."},
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.json())
        self.assertTrue(PackagingTransaction.objects.filter(type="ADJUST", reference__contains=str(tx.id)).exists())
        self.assertTrue(InventoryCorrectionAudit.objects.filter(source_type="PACKAGING", source_id=tx.id).exists())

    def test_roll_correction_updates_physical_specs_with_reason_code(self):
        GRNService.create_roll_grn(
            material=self.roll_material,
            location=self.location,
            vendor=self.vendor,
            plant=self.plant,
            rolls_data=[{"label_id": "GRN-ROLL-SPEC", "thickness_micron": 50, "width_mm": 500, "weight_kg": 25, "stock_form": "OPEN_WEB"}],
            reference="ROLL-REF",
        )
        roll = InventoryRoll.objects.get(label_id="GRN-ROLL-SPEC")
        movement = RollMovement.objects.filter(roll=roll).order_by("timestamp").first()

        response = self.client.post(
            f"/api/inventory/grn/history/ROLL/{movement.id}/correct/",
            {
                "quantity": "26",
                "width_mm": "520",
                "thickness_micron": "52",
                "length_m": "300",
                "stock_form": "LAYFLAT_TUBE",
                "reason_code": "ROLL_IDENTITY",
                "reason": "Roll specs were keyed from the wrong line on vendor challan.",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.json())
        roll.refresh_from_db()
        self.assertEqual(roll.weight_kg, Decimal("26"))
        self.assertEqual(roll.width_mm, Decimal("520"))
        self.assertEqual(roll.thickness_micron, Decimal("52"))
        self.assertEqual(roll.length_m, Decimal("300"))
        self.assertEqual(roll.stock_form, "LAYFLAT_TUBE")
        audit = InventoryCorrectionAudit.objects.get(source_type="ROLL", source_id=movement.id)
        self.assertEqual(audit.delta_json["reason_code"], "ROLL_IDENTITY")
        self.assertIn("width_mm", audit.delta_json["fields"])

    def test_roll_correction_blocks_linked_or_consumed_roll(self):
        GRNService.create_roll_grn(
            material=self.roll_material,
            location=self.location,
            vendor=self.vendor,
            plant=self.plant,
            rolls_data=[{"label_id": "GRN-ROLL-LOCKED", "thickness_micron": 50, "width_mm": 500, "weight_kg": 25}],
            reference="ROLL-REF",
        )
        roll = InventoryRoll.objects.get(label_id="GRN-ROLL-LOCKED")
        child = InventoryRoll.objects.create(
            label_id="GRN-ROLL-CHILD",
            material=self.roll_material,
            plant=self.plant,
            location=self.location,
            thickness_micron=50,
            width_mm=400,
            weight_kg=5,
            parent_roll=roll,
        )
        roll.child_rolls.add(child, through_defaults={"relation_type": "SPLIT", "qty_used_kg": Decimal("5")})
        movement = RollMovement.objects.get(roll=roll, reason="ADJUSTMENT")

        response = self.client.post(
            f"/api/inventory/grn/history/ROLL/{movement.id}/correct/",
            {"quantity": "20", "reason": "Weight typo."},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("stock count", response.json()["error"].lower())

    def test_trading_correction_posts_stock_delta_and_audit(self):
        receipt = TradingGoodReceiptService.create(
            trading_good=self.trading_good,
            vendor=self.vendor,
            plant=self.plant,
            qty=Decimal("100"),
            rate=Decimal("12"),
            vendor_invoice_no="TG-INV-1",
            user=self.user,
        )

        response = self.client.post(
            f"/api/inventory/grn/history/TRADING/{receipt.id}/correct/",
            {
                "quantity": "90",
                "avg_cost": "13",
                "reason_code": "QTY_MISMATCH",
                "reason": "Trading good invoice was corrected after unloading.",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.json())
        stock = TradingGoodStock.objects.get(trading_good=self.trading_good, plant=self.plant)
        self.assertEqual(stock.qty, Decimal("90.000"))
        self.assertEqual(stock.avg_cost, Decimal("13.00"))
        audit = InventoryCorrectionAudit.objects.get(source_type="TRADING", source_id=receipt.id)
        self.assertEqual(audit.delta_json["reason_code"], "QTY_MISMATCH")
        self.assertEqual(Decimal(str(audit.delta_json["quantity"])), Decimal("-10.0"))
