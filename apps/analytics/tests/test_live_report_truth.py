from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.factory.models import Plant
from apps.inventory.models import (
    DeliveryChallan as InterPlantDeliveryChallan,
    InterPlantChallanItem,
    InventoryLocation,
)
from apps.materials.models import InventoryMaterial
from apps.production.models import DeliveryChallan, DeliveryChallanItem
from apps.users.models import Role


class LiveReportTruthTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        role = Role.objects.create(code="ANALYTICS", name="Analytics", default_permissions=["analytics.view"])
        self.user = get_user_model().objects.create_user(
            username="analytics-truth",
            email="analytics-truth@example.com",
            password="pass1234",
            role=role,
        )
        self.client.force_authenticate(self.user)

        self.plant_a = Plant.objects.create(name="Plant A", code="PA")
        self.plant_b = Plant.objects.create(name="Plant B", code="PB")
        self.location_a = InventoryLocation.objects.create(name="FG A", code="FGA", plant=self.plant_a, type="FG")
        self.location_b = InventoryLocation.objects.create(name="FG B", code="FGB", plant=self.plant_b, type="FG")
        self.bulk_material = InventoryMaterial.objects.create(
            code="BULK-INT-1",
            name="Transit Bulk",
            category="GRANULE",
            base_uom="KG",
            status="ACTIVE",
        )

    def test_dispatch_report_uses_live_challan_data(self):
        challan = DeliveryChallan.objects.create(
            dc_no="DC-LIVE-001",
            customer_name="Hari Traders",
            plant=self.plant_a,
            status="IN_TRANSIT",
            vehicle_no="GJ01AB1234",
            dispatch_date=timezone.now(),
        )
        DeliveryChallanItem.objects.create(
            challan=challan,
            weight_kg=Decimal("245.500"),
            qty_pcs=10,
        )

        response = self.client.get("/api/analytics/reports/dispatch", {"date_from": timezone.now().date().isoformat()})

        self.assertEqual(response.status_code, 200, response.content)
        payload = response.json()
        self.assertEqual(payload["summary"]["total_challans"], 1)
        self.assertEqual(payload["summary"]["dispatched"], 1)
        self.assertEqual(payload["summary"]["total_weight_kg"], 245.5)
        self.assertEqual(payload["recent_challans"][0]["dc_no"], "DC-LIVE-001")
        self.assertEqual(payload["daily_trend"][0]["weight_kg"], 245.5)

    def test_interplant_report_uses_live_challan_data(self):
        challan = InterPlantDeliveryChallan.objects.create(
            from_plant=self.plant_a,
            to_plant=self.plant_b,
            dc_no="IPC-LIVE-001",
            status="IN_TRANSIT",
            dispatched_at=timezone.now(),
        )
        InterPlantChallanItem.objects.create(
            challan=challan,
            line_type="BULK",
            material=self.bulk_material,
            from_location=self.location_a,
            to_location=self.location_b,
            planned_qty_kg=Decimal("120"),
            dispatched_qty_kg=Decimal("120"),
            received_qty_kg=Decimal("50"),
            status="PARTIAL",
        )

        response = self.client.get("/api/analytics/reports/interplant", {"date_from": timezone.now().date().isoformat()})

        self.assertEqual(response.status_code, 200, response.content)
        payload = response.json()
        self.assertEqual(payload["summary"]["total_challans"], 1)
        self.assertEqual(payload["summary"]["in_transit"], 1)
        self.assertEqual(payload["summary"]["dispatched_total_kg"], 120.0)
        self.assertEqual(payload["summary"]["received_total_kg"], 50.0)
        self.assertEqual(payload["rows"][0]["dc_no"], "IPC-LIVE-001")
