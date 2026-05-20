from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from apps.factory.models import Plant
from apps.inventory.models import InventoryAuditBatch, InventoryBulk, InventoryLocation, InventoryRoll, PackagingStock, Vendor
from apps.materials.models import InventoryMaterial
from apps.users.models import Role, User


class InventoryV36ApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.role = Role.objects.create(
            code="STORE-V36",
            name="Store V36",
            default_permissions=[
                "inventory.view",
                "inventory.manage",
                "inventory.audit.view",
                "inventory.audit.manage",
                "inventory.period.close",
            ],
        )
        self.user = User.objects.create_user(username="store-v36", password="pass12345", role=self.role)
        self.client.force_authenticate(self.user)

        self.plant = Plant.objects.create(name="V36 Plant", code="V36-P")
        self.location = InventoryLocation.objects.create(plant=self.plant, code="RM-V36", name="V36 RM", type="RM")
        self.vendor = Vendor.objects.create(name="V36 Vendor", code="V36-V", type="RM", status="ACTIVE")
        self.bulk_material = InventoryMaterial.objects.create(code="V36-GRANULE", name="V36 Granule", category="GRANULE", base_uom="KG")
        self.family = InventoryMaterial.objects.create(code="V36-FAMILY", name="V36 Family", category="FILM_FAMILY", base_uom="KG")
        self.roll_material = InventoryMaterial.objects.create(
            code="V36-ROLL",
            name="V36 Roll",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=self.family,
            is_purchasable=True,
        )
        self.packaging_material = InventoryMaterial.objects.create(
            code="V36-CARTON",
            name="V36 Carton",
            category="PACKAGING",
            base_uom="PCS",
            is_purchasable=True,
        )
        self.pod_material = InventoryMaterial.objects.create(
            code="V36-POD",
            name="V36 POD roll",
            category="POD",
            base_uom="KG",
            is_purchasable=True,
        )

    def test_unified_bulk_grn_posts_to_snapshot(self):
        response = self.client.post(
            "/api/inventory/grn/create/",
            {
                "klass": "BULK",
                "vendor_id": str(self.vendor.id),
                "store_location_id": str(self.location.id),
                "vendor_invoice_no": "V36-INV-001",
                "lines": [
                    {
                        "material_code": self.bulk_material.code,
                        "qty": "125.5",
                        "uom": "KG",
                        "rate_per_uom": "82.5",
                        "lot_no": "LOT-V36",
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.json())
        self.assertEqual(response.json()["klass"], "BULK")
        stock = InventoryBulk.objects.get(material=self.bulk_material, location=self.location)
        self.assertEqual(stock.qty_kg, Decimal("125.5000"))

        snapshot = self.client.get("/api/inventory/snapshot/", {"plant_id": str(self.plant.id)})
        self.assertEqual(snapshot.status_code, 200, snapshot.json())
        self.assertTrue(any(row["material_code"] == self.bulk_material.code for row in snapshot.json()["bulk"]))

    def test_unified_roll_grn_validates_tare_math_and_creates_roll(self):
        response = self.client.post(
            "/api/inventory/grn/create/",
            {
                "klass": "ROLL",
                "vendor_id": str(self.vendor.id),
                "store_location_id": str(self.location.id),
                "vendor_invoice_no": "V36-ROLL-INV",
                "lines": [
                    {
                        "material_code": self.roll_material.code,
                        "roll_label": "V36-ROLL-001",
                        "qty": "50",
                        "net_weight_kg": "50",
                        "tare_weight_kg": "2",
                        "gross_weight_kg": "52",
                        "width_mm": "1050",
                        "thickness_um": "12",
                        "length_m": "4000",
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.json())
        roll = InventoryRoll.objects.get(label_id="V36-ROLL-001")
        self.assertEqual(roll.net_weight_kg, Decimal("50"))
        self.assertEqual(roll.gross_weight_kg, Decimal("52"))
        self.assertEqual(roll.tare_weight_kg, Decimal("2"))

        bad = self.client.post(
            "/api/inventory/grn/create/",
            {
                "klass": "ROLL",
                "vendor_id": str(self.vendor.id),
                "store_location_id": str(self.location.id),
                "lines": [
                    {
                        "material_code": self.roll_material.code,
                        "roll_label": "V36-ROLL-BAD",
                        "net_weight_kg": "50",
                        "tare_weight_kg": "2",
                        "gross_weight_kg": "51",
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(bad.status_code, 400)
        self.assertIn("gross weight", str(bad.json()).lower())

    def test_unified_pod_grn_posts_as_roll_stock(self):
        response = self.client.post(
            "/api/inventory/grn/create/",
            {
                "klass": "ROLL",
                "vendor_id": str(self.vendor.id),
                "store_location_id": str(self.location.id),
                "vendor_invoice_no": "V36-POD-INV",
                "lines": [
                    {
                        "material_code": self.pod_material.code,
                        "roll_label": "V36-POD-001",
                        "qty": "18",
                        "net_weight_kg": "18",
                        "width_mm": "420",
                        "thickness_um": "30",
                        "length_m": "2500",
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.json())
        self.assertEqual(response.json()["klass"], "ROLL")
        roll = InventoryRoll.objects.get(label_id="V36-POD-001")
        self.assertEqual(roll.material, self.pod_material)
        self.assertEqual(roll.net_weight_kg, Decimal("18"))

    def test_unified_packaging_grn_posts_to_packaging_stock(self):
        response = self.client.post(
            "/api/inventory/grn/create/",
            {
                "klass": "PACKAGING",
                "vendor_id": str(self.vendor.id),
                "store_location_id": str(self.location.id),
                "vendor_invoice_no": "V36-PKG-INV",
                "lines": [
                    {
                        "material_code": self.packaging_material.code,
                        "qty": "240",
                        "uom": "PCS",
                        "rate_per_uom": "4.25",
                        "lot_no": "PKG-LOT-V36",
                        "packaging_kind": "CARTON",
                        "pcs_per_pack": "1",
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.json())
        self.assertEqual(response.json()["klass"], "PACKAGING")
        stock = PackagingStock.objects.get(material=self.packaging_material, location=self.location)
        self.assertEqual(stock.qty, Decimal("240.0000"))

        snapshot = self.client.get("/api/inventory/snapshot/", {"plant_id": str(self.plant.id)})
        self.assertEqual(snapshot.status_code, 200, snapshot.json())
        self.assertTrue(any(row["material_code"] == self.packaging_material.code for row in snapshot.json()["packaging"]))

    def test_audit_batch_mobile_count_endpoints(self):
        InventoryBulk.objects.create(
            material=self.bulk_material,
            plant=self.plant,
            location=self.location,
            qty_kg=Decimal("40"),
        )
        create_response = self.client.post(
            "/api/inventory/audit/batches/",
            {"scope": "FULL", "plant_id": str(self.plant.id), "name": "V36 floor count"},
            format="json",
        )
        self.assertEqual(create_response.status_code, 201, create_response.json())
        batch_id = create_response.json()["id"]

        submit = self.client.post(
            f"/api/inventory/audit/batches/{batch_id}/submit-line/",
            {
                "ref_type": "BULK",
                "material_code": self.bulk_material.code,
                "location_code": self.location.code,
                "counted_qty": "39",
                "offline_uuid": "mobile-v36-1",
                "device_id": "test-device",
            },
            format="json",
        )
        self.assertEqual(submit.status_code, 200, submit.json())
        self.assertEqual(submit.json()["status"], "OK")

        locations = self.client.get(f"/api/inventory/audit/batches/{batch_id}/locations/")
        self.assertEqual(locations.status_code, 200, locations.json())
        self.assertEqual(locations.json()["items"][0]["counted"], 1)

        items = self.client.get(f"/api/inventory/audit/batches/{batch_id}/items/", {"location": self.location.code})
        self.assertEqual(items.status_code, 200, items.json())
        self.assertEqual(items.json()["items"][0]["materialCode"], self.bulk_material.code)

        finalize = self.client.post(f"/api/inventory/audit/batches/{batch_id}/finalize/")
        self.assertEqual(finalize.status_code, 200, finalize.json())
        batch = InventoryAuditBatch.objects.get(id=batch_id)
        self.assertEqual(batch.status, "SUBMITTED")
