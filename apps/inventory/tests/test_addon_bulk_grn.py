from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase
from rest_framework.request import Request
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.factory.models import Plant
from apps.inventory.models import BulkTransaction, InventoryBulk, InventoryLocation, Vendor
from apps.inventory.serializers import BulkTransactionSerializer, InventoryBulkSerializer
from apps.inventory.services.bulk_service import BulkService
from apps.inventory.services.grn import GRNService
from apps.inventory.services.grn_history import GRNHistoryService
from apps.inventory.views import GRNViewSet, _stock_snapshot_payload
from apps.materials.models import InventoryMaterial
from apps.materials.serializers import InventoryMaterialSerializer


class AddonBulkGrnTests(TestCase):
    def setUp(self):
        self.plant = Plant.objects.create(name="Addon Plant", code="ADDON-PLANT")
        self.location = InventoryLocation.objects.create(
            plant=self.plant,
            code="ADDON-RM",
            name="Addon RM",
            type="RM",
        )
        self.vendor = Vendor.objects.create(name="Addon Vendor", code="ADDON-V", type="RM", status="ACTIVE")
        self.user = get_user_model().objects.create_user(
            username="grn-uom-admin",
            email="grn-uom-admin@example.com",
            password="pw",
        )

    def _post_unified_grn(self, payload):
        request = APIRequestFactory().post("/api/inventory/grn/create/", payload, format="json")
        force_authenticate(request, user=self.user)
        return GRNViewSet.as_view({"post": "create_unified"})(request)

    def test_purchased_pcs_addon_can_be_inwarded_as_bulk_stock(self):
        addon = InventoryMaterial.objects.create(
            code="ZIP-PCS",
            name="Purchased zipper",
            category="ADDON",
            base_uom="PCS",
            weight_mode="PER_PIECE",
            weight_value=1.2,
            addon_is_purchased=True,
            addon_purchase_uom="PCS",
        )

        tx = GRNService.create_bulk_grn(
            material=addon,
            location=self.location,
            vendor=self.vendor,
            quantity=Decimal("250"),
            plant=self.plant,
            cost=Decimal("0.75"),
            reference="ADDON-GRN-1",
        )

        stock = InventoryBulk.objects.get(material=addon, location=self.location)
        self.assertEqual(stock.qty_kg, Decimal("250.0000"))
        self.assertEqual(stock.material.category, "ADDON")
        self.assertEqual(stock.material.base_uom, "PCS")
        self.assertEqual(tx.material, addon)
        self.assertEqual(tx.qty_kg, Decimal("250.0000"))

    def test_purchased_meter_addon_can_be_inwarded_as_bulk_stock(self):
        addon = InventoryMaterial.objects.create(
            code="ZIP-METER",
            name="Purchased zipper meter roll",
            category="ADDON",
            base_uom="METER",
            weight_mode="PER_MM",
            weight_value=0.015,
            addon_is_purchased=True,
            addon_purchase_uom="METER",
        )

        tx = GRNService.create_bulk_grn(
            material=addon,
            location=self.location,
            vendor=self.vendor,
            quantity=Decimal("1250"),
            plant=self.plant,
            cost=Decimal("0.42"),
            reference="ADDON-METER-GRN-1",
        )

        stock = InventoryBulk.objects.get(material=addon, location=self.location)
        self.assertEqual(stock.qty_kg, Decimal("1250.0000"))
        self.assertEqual(stock.material.category, "ADDON")
        self.assertEqual(stock.material.base_uom, "METER")
        self.assertEqual(tx.material, addon)
        self.assertEqual(tx.qty_kg, Decimal("1250.0000"))

    def test_meter_addon_keeps_meter_uom_in_history_snapshot_and_serializers(self):
        addon = InventoryMaterial.objects.create(
            code="ZIP-METER-VIEW",
            name="Meter zipper view",
            category="ADDON",
            base_uom="METER",
            weight_mode="PER_MM",
            weight_value=0.015,
            addon_is_purchased=True,
            addon_purchase_uom="METER",
        )

        tx = GRNService.create_bulk_grn(
            material=addon,
            location=self.location,
            vendor=self.vendor,
            quantity=Decimal("1250"),
            plant=self.plant,
            cost=Decimal("0.42"),
            reference="ADDON-METER-VIEW-GRN",
            vendor_invoice_no="MTR-VIEW-001",
            manual_po_ref="VND-PO-MTR-001",
        )
        stock = InventoryBulk.objects.get(material=addon, location=self.location)

        self.assertEqual(InventoryBulkSerializer(stock).data["uom"], "METER")
        tx_payload = BulkTransactionSerializer(tx).data
        self.assertEqual(tx_payload["uom"], "METER")
        self.assertEqual(tx_payload["vendor_name"], "Addon Vendor")

        history = GRNHistoryService.list_history({"source_type": "BULK", "search": "ZIP-METER-VIEW"})
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]["uom"], "METER")
        self.assertEqual(history[0]["vendor_name"], "Addon Vendor")
        self.assertEqual(history[0]["manual_po_ref"], "VND-PO-MTR-001")

        request = Request(APIRequestFactory().get("/api/inventory/v36/snapshot/"))
        snapshot = _stock_snapshot_payload(request)
        row = next(item for item in snapshot["bulk"] if item["material_code"] == "ZIP-METER-VIEW")
        self.assertEqual(row["uom"], "METER")
        self.assertEqual(row["vendor_name"], "Addon Vendor")
        self.assertEqual(row["last_grn_no"], "MTR-VIEW-001")

    def test_meter_addon_consumption_reduces_meter_stock(self):
        addon = InventoryMaterial.objects.create(
            code="ZIP-METER-CONSUME",
            name="Meter zipper consume",
            category="ADDON",
            base_uom="METER",
            weight_mode="PER_MM",
            weight_value=0.015,
            addon_is_purchased=True,
            addon_purchase_uom="METER",
        )

        GRNService.create_bulk_grn(
            material=addon,
            location=self.location,
            vendor=self.vendor,
            quantity=Decimal("1250"),
            plant=self.plant,
            cost=Decimal("0.42"),
            reference="ADDON-METER-CONSUME-GRN",
            vendor_invoice_no="MTR-CONSUME-001",
        )
        tx = BulkService.consume_bulk(
            material_id=str(addon.id),
            qty=Decimal("250"),
            location_id=str(self.location.id),
            reference="SO-CONSUME-ZIP-METER",
        )

        stock = InventoryBulk.objects.get(material=addon, location=self.location)
        self.assertEqual(stock.qty_kg, Decimal("1000.0000"))
        self.assertEqual(tx.qty_kg, Decimal("-250.0000"))
        self.assertEqual(BulkTransaction.objects.filter(material=addon, type="CONSUME").count(), 1)
        self.assertEqual(BulkTransactionSerializer(tx).data["uom"], "METER")

    def test_snapshot_uses_legacy_reference_vendor_when_vendor_fk_is_missing(self):
        addon = InventoryMaterial.objects.create(
            code="ZIP-METER-LEGACY",
            name="Meter zipper legacy",
            category="ADDON",
            base_uom="METER",
            weight_mode="PER_MM",
            weight_value=0.015,
            addon_is_purchased=True,
            addon_purchase_uom="METER",
        )

        BulkService.add_bulk(
            material_id=str(addon.id),
            qty=Decimal("1250"),
            plant_id=str(self.plant.id),
            location_id=str(self.location.id),
            cost=Decimal("0.42"),
            reference="VENDOR:Legacy Zipper Vendor | LEGACY-GRN-001",
        )

        request = Request(APIRequestFactory().get("/api/inventory/v36/snapshot/"))
        snapshot = _stock_snapshot_payload(request)
        row = next(item for item in snapshot["bulk"] if item["material_code"] == "ZIP-METER-LEGACY")
        self.assertEqual(row["uom"], "METER")
        self.assertEqual(row["vendor_name"], "Legacy Zipper Vendor")
        self.assertEqual(row["last_grn_no"], "VENDOR:Legacy Zipper Vendor | LEGACY-GRN-001")

    def test_material_library_serializer_exposes_purchase_flags_for_grn_picker(self):
        addon = InventoryMaterial.objects.create(
            code="ZIP-LIB",
            name="Library purchased zipper",
            category="ADDON",
            base_uom="PCS",
            weight_mode="PER_PIECE",
            weight_value=1.2,
            addon_is_purchased=True,
            addon_purchase_uom="PCS",
        )

        data = InventoryMaterialSerializer(addon).data

        self.assertTrue(data["addon_is_purchased"])
        self.assertEqual(data["addon_purchase_uom"], "PCS")
        self.assertEqual(data["weight_mode"], "PER_PIECE")
        self.assertEqual(data["base_uom"], "PCS")

    def test_material_library_serializer_exposes_meter_purchase_uom(self):
        addon = InventoryMaterial.objects.create(
            code="ZIP-METER-LIB",
            name="Library meter zipper",
            category="ADDON",
            base_uom="METER",
            weight_mode="PER_MM",
            weight_value=0.015,
            addon_is_purchased=True,
            addon_purchase_uom="METER",
        )

        data = InventoryMaterialSerializer(addon).data

        self.assertTrue(data["addon_is_purchased"])
        self.assertEqual(data["addon_purchase_uom"], "METER")
        self.assertEqual(data["base_uom"], "METER")

    def test_non_purchased_addon_cannot_be_inwarded(self):
        addon = InventoryMaterial.objects.create(
            code="ZIP-INTERNAL",
            name="Internal zipper calc only",
            category="ADDON",
            base_uom="KG",
            weight_mode="PER_PIECE",
            weight_value=1.2,
            addon_is_purchased=False,
        )

        with self.assertRaises(ValidationError):
            GRNService.create_bulk_grn(
                material=addon,
                location=self.location,
                vendor=self.vendor,
                quantity=Decimal("10"),
                plant=self.plant,
                cost=Decimal("1"),
                reference="ADDON-GRN-2",
            )

    def test_unified_grn_posts_multi_line_invoice_atomically(self):
        lldpe = InventoryMaterial.objects.create(
            code="GRN-ML-LDPE",
            name="GRN multiline LDPE",
            category="GRANULE",
            base_uom="KG",
        )
        hdpe = InventoryMaterial.objects.create(
            code="GRN-ML-HDPE",
            name="GRN multiline HDPE",
            category="GRANULE",
            base_uom="KG",
        )

        response = self._post_unified_grn({
            "klass": "BULK",
            "vendor_id": str(self.vendor.id),
            "warehouse_id": str(self.location.id),
            "vendor_invoice_no": "ML-INV-001",
            "lines": [
                {"material_id": str(lldpe.id), "qty": "3125", "uom": "KG", "unit_cost": "100"},
                {"material_id": str(hdpe.id), "qty": "31725", "uom": "KG", "unit_cost": "110"},
            ],
        })

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(len(response.data["stock_movements"]), 2)
        self.assertEqual(BulkTransaction.objects.filter(vendor_invoice_no="ML-INV-001", type="INWARD").count(), 2)
        self.assertEqual(InventoryBulk.objects.get(material=lldpe, location=self.location).qty_kg, Decimal("3125.0000"))
        self.assertEqual(InventoryBulk.objects.get(material=hdpe, location=self.location).qty_kg, Decimal("31725.0000"))

    def test_unified_grn_rejects_stale_uom_before_any_stock_mutation(self):
        zipper = InventoryMaterial.objects.create(
            code="GRN-ZIP-METER",
            name="GRN zipper meter",
            category="ADDON",
            base_uom="METER",
            weight_mode="PER_MM",
            weight_value=0.015,
            addon_is_purchased=True,
            addon_purchase_uom="METER",
        )
        granule = InventoryMaterial.objects.create(
            code="GRN-STILL-NOT-POSTED",
            name="GRN second line should rollback",
            category="GRANULE",
            base_uom="KG",
        )

        response = self._post_unified_grn({
            "klass": "BULK",
            "vendor_id": str(self.vendor.id),
            "warehouse_id": str(self.location.id),
            "vendor_invoice_no": "STALE-UOM-001",
            "lines": [
                {"material_id": str(zipper.id), "qty": "500", "uom": "KG", "unit_cost": "2"},
                {"material_id": str(granule.id), "qty": "25", "uom": "KG", "unit_cost": "100"},
            ],
        })

        self.assertEqual(response.status_code, 400)
        self.assertIn("master UOM METER", str(response.data))
        self.assertFalse(InventoryBulk.objects.filter(material=zipper).exists())
        self.assertFalse(InventoryBulk.objects.filter(material=granule).exists())
        self.assertFalse(BulkTransaction.objects.filter(vendor_invoice_no="STALE-UOM-001").exists())

    def test_unified_grn_accepts_meter_addon_in_master_uom(self):
        zipper = InventoryMaterial.objects.create(
            code="GRN-ZIP-METER-OK",
            name="GRN zipper meter ok",
            category="ADDON",
            base_uom="METER",
            weight_mode="PER_MM",
            weight_value=0.015,
            addon_is_purchased=True,
            addon_purchase_uom="METER",
        )

        response = self._post_unified_grn({
            "klass": "BULK",
            "vendor_id": str(self.vendor.id),
            "warehouse_id": str(self.location.id),
            "vendor_invoice_no": "METER-UOM-001",
            "lines": [
                {"material_id": str(zipper.id), "qty": "1250", "uom": "METER", "unit_cost": "0.42"},
            ],
        })

        self.assertEqual(response.status_code, 201, response.data)
        stock = InventoryBulk.objects.get(material=zipper, location=self.location)
        self.assertEqual(stock.qty_kg, Decimal("1250.0000"))
        self.assertEqual(InventoryBulkSerializer(stock).data["uom"], "METER")
