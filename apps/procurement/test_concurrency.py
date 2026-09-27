from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from decimal import Decimal
from django.db import connection, connections, close_old_connections
from django.core.exceptions import ValidationError
from django.test import TransactionTestCase
from apps.procurement import tests as procurement_fixtures
from apps.procurement.services.po_receipt import PurchaseOrderReceiptService
from apps.procurement.models import PurchaseOrderReceipt, PurchaseOrder
from apps.inventory.models import InventoryBulk
from apps.mrp.models import MRPPlan, MRPSuggestion
from apps.mrp.services import MRPService


class ProcurementConcurrencyTests(TransactionTestCase):
    setUp = procurement_fixtures.PurchaseOrderReceiptServiceTests.setUp
    _sent_po = procurement_fixtures.PurchaseOrderReceiptServiceTests._sent_po

    def race(self, functions):
        gate = Barrier(len(functions))
        def run(fn):
            close_old_connections()
            try:
                with connection.cursor() as cursor:
                    cursor.execute("SET lock_timeout = '5s'")
                    cursor.execute("SET statement_timeout = '10s'")
                gate.wait(timeout=5)
                return fn()
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=len(functions)) as pool:
            return list(pool.map(run, functions))

    def test_same_vendor_invoice_across_different_pos_posts_once(self):
        pairs = [self._sent_po(), self._sent_po()]
        def receive(pair):
            po, item = pair
            try:
                PurchaseOrderReceiptService.create(po=po, user=None,
                    lines_data=[{'po_item_id': str(item.pk), 'qty_received': '10'}],
                    vendor_invoice_no=' INVOICE-RACE ')
                return 'posted'
            except ValidationError:
                return 'duplicate'
        results = self.race([lambda pair=p: receive(pair) for p in pairs])
        self.assertCountEqual(results, ['posted', 'duplicate'])
        self.assertEqual(PurchaseOrderReceipt.objects.filter(vendor_invoice_no='INVOICE-RACE').count(), 1)
        self.assertEqual(sum(InventoryBulk.objects.values_list('qty_kg', flat=True)), Decimal('10'))

    def test_concurrent_mrp_po_drafting_returns_same_purchase_order(self):
        plan = MRPPlan.objects.create(plant=self.plant)
        suggestion = MRPSuggestion.objects.create(plan=plan, material=self.material,
            type='PURCHASE', qty=10, target_plant=self.plant)
        results = self.race([lambda: MRPService.create_suggestion_draft(suggestion, 'po') for _ in range(4)])
        self.assertEqual(len({r['po_id'] for r in results}), 1)
        self.assertEqual(PurchaseOrder.objects.filter(source_mrp_suggestion=suggestion).count(), 1)

    def test_opposite_material_orders_post_without_deadlock(self):
        from apps.materials.models import InventoryMaterial
        from apps.procurement.models import PurchaseOrderItem
        other = InventoryMaterial.objects.create(code='PO-SECOND', name='Second granule', category='GRANULE', base_uom='KG')
        pairs = [self._sent_po(), self._sent_po()]
        items = []
        for po, first in pairs:
            second = PurchaseOrderItem.objects.create(purchase_order=po, line_no=2, material=other, qty_ordered=100, uom='KG', rate_per_uom=10)
            items.append([first, second])
        def receive(index):
            sequence = items[index] if index == 0 else list(reversed(items[index]))
            return PurchaseOrderReceiptService.create(po=pairs[index][0], user=None,
                lines_data=[{'po_item_id': str(i.pk), 'qty_received': '10'} for i in sequence],
                vendor_invoice_no=f'ORDER-RACE-{index}')
        results = self.race([lambda: receive(0), lambda: receive(1)])
        self.assertEqual(len(results), 2)
        self.assertEqual(sum(InventoryBulk.objects.values_list('qty_kg', flat=True)), Decimal('40'))

    def test_parallel_purchase_orders_have_unique_codes(self):
        results = self.race([lambda: PurchaseOrder.objects.create(vendor=self.vendor, plant=self.plant).code for _ in range(4)])
        self.assertEqual(len(set(results)), 4)

    def test_numbering_continues_after_four_digits(self):
        from django.utils import timezone
        year = timezone.now().year
        for suffix in ('9999', '10000'):
            PurchaseOrder.objects.create(code=f'PO-{year}-{suffix}', vendor=self.vendor, plant=self.plant)
        order = PurchaseOrder.objects.create(vendor=self.vendor, plant=self.plant)
        self.assertEqual(order.code, f'PO-{year}-10001')

    def test_overlapping_mrp_batches_lock_all_suggestions_before_numbering(self):
        from django.contrib.auth import get_user_model
        from rest_framework.test import APIRequestFactory, force_authenticate
        from apps.mrp.views import MRPSuggestionViewSet
        user = get_user_model().objects.create_user(username='batch-planner', extra_permissions=['mrp.manage'])
        plan = MRPPlan.objects.create(plant=self.plant)
        suggestions = [MRPSuggestion.objects.create(plan=plan, material=self.material, type='PURCHASE', qty=10, target_plant=self.plant) for _ in range(3)]
        ids = sorted(str(s.pk) for s in suggestions)
        def draft(batch):
            request = APIRequestFactory().post('/api/mrp/suggestions/bulk-draft-po/', {'suggestion_ids': batch}, format='json')
            force_authenticate(request, user=user)
            response = MRPSuggestionViewSet.as_view({'post': 'bulk_draft_po'})(request)
            self.assertEqual(response.status_code, 200, response.data)
            self.assertFalse(response.data['errors'], response.data)
            return response.data['results']
        result = self.race([lambda: draft(ids[:2]), lambda: draft(list(reversed(ids[1:])))])
        self.assertEqual(len(result), 2)
        self.assertEqual(PurchaseOrder.objects.filter(source_mrp_suggestion__in=suggestions).count(), 3)
