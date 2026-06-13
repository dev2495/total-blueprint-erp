from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.factory.models import Plant
from apps.inventory.models import InkFloorCountLine, InkFloorMovement, InkMaterial, InventoryBulk, InventoryLocation
from apps.inventory.services.bulk_service import BulkService
from apps.inventory.services.ink_floor import InkFloorService


class InkFloorStockTests(TestCase):
    def setUp(self):
        self.plant = Plant.objects.create(name="Ink Floor Plant", code="INK-FLOOR-P")
        self.store = InventoryLocation.objects.create(
            plant=self.plant,
            code="INK-STORE",
            name="Ink Store",
            type="RM",
        )
        self.floor = InventoryLocation.objects.create(
            plant=self.plant,
            code="INK-FLOOR",
            name="Ink Floor",
            type="WIP",
        )
        self.ink = InkMaterial.objects.create(base_type="POLY", color_name="CYAN")
        self.user = get_user_model().objects.create_user(username="ink-floor-user", password="testpass123")
        BulkService.add_bulk(
            str(self.ink.id),
            Decimal("20.0000"),
            str(self.plant.id),
            str(self.store.id),
            cost=Decimal("100.0000"),
            reference="Opening ink store",
            qty_uom="KG",
        )

    def test_issue_and_return_move_ink_between_store_and_floor_with_audit_rows(self):
        event_at = timezone.now()

        issue = InkFloorService.issue_to_floor(
            material_id=str(self.ink.id),
            qty_kg=Decimal("10.0000"),
            from_location_id=str(self.store.id),
            floor_location_id=str(self.floor.id),
            event_at=event_at,
            shift_code="A",
            reference="ISS-1",
        )
        returned = InkFloorService.return_from_floor(
            material_id=str(self.ink.id),
            qty_kg=Decimal("2.0000"),
            floor_location_id=str(self.floor.id),
            to_location_id=str(self.store.id),
            event_at=event_at,
            shift_code="A",
            reference="RET-1",
        )

        self.assertEqual(issue.type, "ISSUE")
        self.assertEqual(returned.type, "RETURN")
        self.assertEqual(InventoryBulk.objects.get(material=self.ink, location=self.floor).qty_kg, Decimal("8.0000"))
        self.assertEqual(InventoryBulk.objects.get(material=self.ink, location=self.store).qty_kg, Decimal("12.0000"))
        self.assertEqual(InkFloorMovement.objects.filter(material=self.ink).count(), 2)

    def test_mix_return_creates_mix_master_and_moves_source_floor_stock(self):
        InkFloorService.issue_to_floor(
            material_id=str(self.ink.id),
            qty_kg=Decimal("5.0000"),
            from_location_id=str(self.store.id),
            floor_location_id=str(self.floor.id),
            reference="ISS-MIX",
        )

        movement = InkFloorService.mix_return(
            source_material_id=str(self.ink.id),
            qty_kg=Decimal("3.0000"),
            floor_location_id=str(self.floor.id),
            to_location_id=str(self.store.id),
            target_base_type="POLY",
            target_color_name="GOLD MIX",
            reference="MIX-RET-1",
        )

        mix = movement.target_material
        self.assertEqual(movement.type, "MIX_RETURN")
        self.assertIsNotNone(mix)
        self.assertTrue(mix.is_mix)
        self.assertEqual(mix.color_name, "GOLD MIX")
        self.assertEqual(InventoryBulk.objects.get(material=self.ink, location=self.floor).qty_kg, Decimal("2.0000"))
        self.assertEqual(InventoryBulk.objects.get(material=mix, location=self.store).qty_kg, Decimal("3.0000"))

    def test_count_posts_variance_and_reconciliation_uses_open_issue_return_close_math(self):
        start_at = timezone.now()
        InkFloorService.issue_to_floor(
            material_id=str(self.ink.id),
            qty_kg=Decimal("10.0000"),
            from_location_id=str(self.store.id),
            floor_location_id=str(self.floor.id),
            event_at=start_at,
            shift_code="A",
            reference="ISS-COUNT",
        )
        InkFloorService.return_from_floor(
            material_id=str(self.ink.id),
            qty_kg=Decimal("2.0000"),
            floor_location_id=str(self.floor.id),
            to_location_id=str(self.store.id),
            event_at=start_at,
            shift_code="A",
            reference="RET-COUNT",
        )
        session = InkFloorService.post_count(
            plant_id=str(self.plant.id),
            location_id=str(self.floor.id),
            counted_at=start_at,
            shift_code="A",
            lines=[{"material_id": str(self.ink.id), "counted_qty_kg": Decimal("3.0000")}],
            reference="COUNT-1",
        )

        self.assertEqual(session.status, "POSTED")
        count_line = InkFloorCountLine.objects.get(session=session, material=self.ink)
        self.assertEqual(count_line.system_qty_kg, Decimal("8.0000"))
        self.assertEqual(count_line.counted_qty_kg, Decimal("3.0000"))
        self.assertEqual(count_line.variance_qty_kg, Decimal("-5.0000"))
        self.assertEqual(InventoryBulk.objects.get(material=self.ink, location=self.floor).qty_kg, Decimal("3.0000"))

        reconciliation = InkFloorService.reconcile(
            plant_id=str(self.plant.id),
            location_id=str(self.floor.id),
            start_at=start_at,
            end_at=start_at,
            theory_rows=[{"job_number": "JOB-1", "sales_order": "SO-1", "theory_ink_kg": Decimal("4.0000")}],
        )

        self.assertEqual(reconciliation["totals"]["actual_consumed_kg"], 5.0)
        self.assertEqual(reconciliation["totals"]["theory_ink_kg"], 4.0)
        self.assertEqual(reconciliation["totals"]["variance_kg"], 1.0)
        self.assertEqual(reconciliation["allocations"][0]["actual_allocated_kg"], 5.0)

    def test_sessions_api_filters_by_shift_date_for_stock_lifecycle_proof(self):
        first_count_at = timezone.now()
        second_count_at = first_count_at + timedelta(days=1)
        first = InkFloorService.post_count(
            plant_id=str(self.plant.id),
            location_id=str(self.floor.id),
            counted_at=first_count_at,
            shift_code="A",
            lines=[{"material_id": str(self.ink.id), "counted_qty_kg": Decimal("0.0000")}],
            reference="COUNT-DAY-1",
        )
        second = InkFloorService.post_count(
            plant_id=str(self.plant.id),
            location_id=str(self.floor.id),
            counted_at=second_count_at,
            shift_code="B",
            lines=[{"material_id": str(self.ink.id), "counted_qty_kg": Decimal("0.0000")}],
            reference="COUNT-DAY-2",
        )

        client = APIClient()
        client.force_authenticate(user=self.user)
        response = client.get(
            "/api/inventory/ink-floor/sessions/",
            {
                "plant": str(self.plant.id),
                "shift_date": first.shift_date.isoformat(),
                "status": "POSTED",
            },
        )

        self.assertEqual(response.status_code, 200, response.content)
        references = {row["reference"] for row in response.data}
        self.assertIn(first.reference, references)
        self.assertNotIn(second.reference, references)
