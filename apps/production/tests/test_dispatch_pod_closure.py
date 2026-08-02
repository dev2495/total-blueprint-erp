from django.test import TestCase

from apps.factory.models import Plant
from apps.templates.models import TemplateBlueprint
from apps.production.models import DeliveryChallan, DeliveryChallanItem
from apps.production.services.dispatch_service import FGDispatchService
from apps.sales.models import SalesOrder, SalesOrderItem


class DispatchPODClosureTests(TestCase):
    def setUp(self):
        self.plant = Plant.objects.create(code="POD-P", name="POD Plant")
        self.template = TemplateBlueprint.objects.create(
            name="POD Roll",
            fg_type="ROLL",
            status="LIVE",
        )
        self.order = SalesOrder.objects.create(
            order_number="SO-POD-1",
            customer_name="POD Customer",
            status="DISPATCH_READY",
        )
        self.line = SalesOrderItem.objects.create(
            sales_order=self.order,
            template=self.template,
            qty_uom="KG",
            qty_value=100,
            line_status="DISPATCH_READY",
        )

    def _challan(self, number: str, weight: float) -> DeliveryChallan:
        challan = DeliveryChallan.objects.create(
            dc_no=number,
            customer_name=self.order.customer_name,
            sales_order=self.order,
            plant=self.plant,
            status="DISPATCHED",
        )
        DeliveryChallanItem.objects.create(
            challan=challan,
            sales_order_item=self.line,
            weight_kg=weight,
        )
        return challan

    def test_partial_pod_keeps_balance_order_open(self):
        challan = self._challan("DC-POD-1", 40)

        result = FGDispatchService.confirm_pod(
            str(challan.id),
            received_by="Customer Store",
            reference="STAMP-1",
        )

        self.order.refresh_from_db()
        self.line.refresh_from_db()
        self.assertEqual(result.status, "DELIVERED")
        self.assertEqual(result.pod_received_by, "Customer Store")
        self.assertEqual(result.pod_reference, "STAMP-1")
        self.assertFalse(result.order_closed)
        self.assertEqual(self.order.status, "DISPATCH_READY")
        self.assertNotEqual(self.line.line_status, "COMPLETED")

    def test_final_pod_closes_line_and_order(self):
        first = self._challan("DC-POD-1", 40)
        FGDispatchService.confirm_pod(str(first.id))
        final = self._challan("DC-POD-2", 60)

        result = FGDispatchService.confirm_pod(str(final.id), notes="Full delivery")

        self.order.refresh_from_db()
        self.line.refresh_from_db()
        self.assertTrue(result.order_closed)
        self.assertEqual(self.order.status, "COMPLETED")
        self.assertIsNotNone(self.order.completed_at)
        self.assertEqual(self.line.line_status, "COMPLETED")
        self.assertIsNotNone(self.line.line_closed_at)

    def test_pod_confirmation_is_idempotent(self):
        challan = self._challan("DC-POD-1", 100)
        first = FGDispatchService.confirm_pod(str(challan.id), reference="POD-100")
        second = FGDispatchService.confirm_pod(str(challan.id), reference="SHOULD-NOT-REWRITE")

        self.assertEqual(first.pod_confirmed_at, second.pod_confirmed_at)
        self.assertEqual(second.pod_reference, "POD-100")
        self.assertTrue(second.order_closed)
