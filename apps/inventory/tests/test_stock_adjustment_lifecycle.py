from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier

from django.db import close_old_connections, connection, connections, transaction
from django.test import TestCase, TransactionTestCase, skipUnlessDBFeature
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.factory.models import Plant
from apps.inventory.models import InventoryBulk, InventoryLocation, StockAdjustment, StockAdjustmentLine
from apps.inventory.services.adjustment import StockAdjustmentService
from apps.inventory.views_adjustment import StockAdjustmentSerializer, StockAdjustmentViewSet
from apps.materials.models import InventoryMaterial
from apps.users.models import User


class AdjustmentFixtures:
    def setUp(self):
        self.user = User.objects.create(username="adjustment-lifecycle-owner", is_owner=True)
        self.plant = Plant.objects.create(code="ADJ-LIFECYCLE", name="Adjustment lifecycle plant")
        self.location = InventoryLocation.objects.create(code="ADJ-LIFECYCLE-RM", name="Raw materials", plant=self.plant, type="RM")
        self.material = InventoryMaterial.objects.create(code="ADJ-LIFECYCLE-MAT", name="Adjustment lifecycle material", category="GRANULE")
        self.stock = InventoryBulk.objects.create(material=self.material, plant=self.plant, location=self.location, qty_kg=100)
        self.adjustment = StockAdjustment.objects.create(code="ADJ-LIFECYCLE-001", plant=self.plant)
        self.line = StockAdjustmentLine.objects.create(
            adjustment=self.adjustment, stock_class="BULK", inventory_material=self.material,
            location=self.location, delta_qty=10, uom="KG",
        )


class StockAdjustmentLifecycleTests(AdjustmentFixtures, TestCase):
    def test_stale_post_replay_does_not_apply_stock_twice(self):
        stale = StockAdjustment.objects.get(pk=self.adjustment.pk)
        StockAdjustmentService.post(adjustment=self.adjustment, user=self.user)

        replay = StockAdjustmentService.post(adjustment=stale, user=self.user)

        self.stock.refresh_from_db()
        self.assertEqual(self.stock.qty_kg, Decimal("110"))
        self.assertEqual(replay.status, "POSTED")

    def test_stale_void_replay_does_not_reverse_stock_twice(self):
        posted = StockAdjustmentService.post(adjustment=self.adjustment, user=self.user)
        stale = StockAdjustment.objects.get(pk=self.adjustment.pk)
        StockAdjustmentService.void(adjustment=posted, user=self.user)

        replay = StockAdjustmentService.void(adjustment=stale, user=self.user)

        self.stock.refresh_from_db()
        self.assertEqual(self.stock.qty_kg, Decimal("100"))
        self.assertEqual(replay.status, "VOID")

    def test_posted_and_voided_adjustment_history_cannot_be_deleted(self):
        view = StockAdjustmentViewSet.as_view({"delete": "destroy"})
        for status in ("POSTED", "VOID"):
            with self.subTest(status=status):
                adjustment = StockAdjustment.objects.create(code=f"ADJ-KEEP-{status}", plant=self.plant, status=status)
                request = APIRequestFactory().delete(f"/api/inventory/adjustments/{adjustment.pk}/")
                force_authenticate(request, self.user)
                # Match the real ATOMIC_REQUESTS boundary around DRF's
                # validation-error rollback when using APIRequestFactory.
                with transaction.atomic():
                    response = view(request, pk=str(adjustment.pk))
                self.assertEqual(response.status_code, 400, response.data)
                self.assertTrue(StockAdjustment.objects.filter(pk=adjustment.pk).exists())

    def test_draft_adjustment_can_be_deleted(self):
        request = APIRequestFactory().delete(f"/api/inventory/adjustments/{self.adjustment.pk}/")
        force_authenticate(request, self.user)
        response = StockAdjustmentViewSet.as_view({"delete": "destroy"})(request, pk=str(self.adjustment.pk))
        self.assertEqual(response.status_code, 204)
        self.assertFalse(StockAdjustment.objects.filter(pk=self.adjustment.pk).exists())

    def test_edit_validated_before_post_cannot_rewrite_posted_lines(self):
        serializer = StockAdjustmentSerializer(self.adjustment, data={"notes": "Stale draft edit"}, partial=True)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        StockAdjustmentService.post(adjustment=StockAdjustment.objects.get(pk=self.adjustment.pk), user=self.user)

        with self.assertRaises(ValidationError):
            serializer.save()

        self.adjustment.refresh_from_db()
        self.assertEqual(self.adjustment.notes, "")


@skipUnlessDBFeature("has_select_for_update")
class StockAdjustmentConcurrentTests(AdjustmentFixtures, TransactionTestCase):
    def _parallel(self, operation):
        gate = Barrier(2)

        def run(_index):
            close_old_connections()
            try:
                with connection.cursor() as cursor:
                    cursor.execute("SET lock_timeout = '5s'")
                    cursor.execute("SET statement_timeout = '10s'")
                stale = StockAdjustment.objects.get(pk=self.adjustment.pk)
                gate.wait(timeout=5)
                return operation(adjustment=stale).status
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as executor:
            return list(executor.map(run, range(2)))

    def test_concurrent_posts_apply_exactly_once(self):
        self.assertEqual(self._parallel(StockAdjustmentService.post), ["POSTED", "POSTED"])
        self.stock.refresh_from_db()
        self.assertEqual(self.stock.qty_kg, Decimal("110"))
        self.line.refresh_from_db()
        self.assertEqual(self.line.before_qty, Decimal("100"))
        self.assertEqual(self.line.after_qty, Decimal("110"))

    def test_concurrent_voids_reverse_exactly_once(self):
        StockAdjustmentService.post(adjustment=self.adjustment)
        self.assertEqual(self._parallel(StockAdjustmentService.void), ["VOID", "VOID"])
        self.stock.refresh_from_db()
        self.assertEqual(self.stock.qty_kg, Decimal("100"))
