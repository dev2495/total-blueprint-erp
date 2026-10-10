"""Purchased goods can never be received into virtual locations (phantom stock)."""
import uuid

from django.test import TestCase
from rest_framework.test import APIClient

from apps.factory.models import Plant
from apps.inventory.models import BulkTransaction, InventoryLocation, Vendor
from apps.materials.models import InventoryMaterial
from apps.users.models import Role, User


class VirtualReceiptLocationTests(TestCase):
    def setUp(self):
        role, _ = Role.objects.get_or_create(code="STORE", defaults={"name": "Inventory"})
        self.store = User.objects.create_user(username="virt-store", role=role)
        self.plant = Plant.objects.create(code="VIRT-P1", name="Virtual test plant")
        self.vendor = Vendor.objects.create(code="VIRT-V1", name="Granule supplier")
        self.material = InventoryMaterial.objects.create(code="VIRT-RM1", name="LLDPE granules", category="GRANULE", base_uom="KG")
        self.rm = InventoryLocation.objects.filter(plant=self.plant, code="RM").order_by("-is_system").first() or InventoryLocation.objects.create(plant=self.plant, code="VIRT-RM", name="RM store", type="RM")
        self.jobwork = InventoryLocation.objects.filter(plant=self.plant, code="JOBWORK_OUT").first() or InventoryLocation.objects.create(plant=self.plant, code="JOBWORK_OUT", name="Job work (virtual)", type="JOBWORK", is_system=True)
        self.transit = InventoryLocation.objects.filter(plant=self.plant, code="IN_TRANSIT").first() or InventoryLocation.objects.create(plant=self.plant, code="IN_TRANSIT", name="In transit (virtual)", type="TRANSIT", is_system=True)
        self.api = APIClient()
        self.api.force_authenticate(self.store)

    def grn(self, location, *, line_location=None):
        line = {"material_id": str(self.material.id), "qty": "25", "unit_cost": "100", "uom": "KG"}
        if line_location is not None:
            line["location_id"] = str(line_location.id)
        return self.api.post("/api/inventory/grn/create/", {
            "client_token": str(uuid.uuid4()), "klass": "BULK", "vendor_id": str(self.vendor.id),
            "vendor_invoice_no": f"VIRT-{uuid.uuid4().hex[:6]}", "plant_id": str(self.plant.id),
            "store_location_id": str(location.id), "lines": [line],
        }, format="json")

    def test_virtual_locations_are_refused_and_nothing_is_posted(self):
        for location in (self.jobwork, self.transit):
            refused = self.grn(location)
            self.assertEqual(refused.status_code, 400, refused.data)
            self.assertIn("virtual location", str(refused.data))
        refused_line = self.grn(self.rm, line_location=self.jobwork)
        self.assertEqual(refused_line.status_code, 400, refused_line.data)
        self.assertFalse(BulkTransaction.objects.filter(location__in=[self.jobwork, self.transit]).exists())

    def test_real_store_location_still_receives(self):
        ok = self.grn(self.rm)
        self.assertIn(ok.status_code, (200, 201), ok.data)
        self.assertTrue(BulkTransaction.objects.filter(location=self.rm, type="INWARD").exists())
