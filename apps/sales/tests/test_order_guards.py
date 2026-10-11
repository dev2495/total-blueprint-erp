"""Confirmed sales orders are evidence: no raw edit/delete and no
client-supplied quotation snapshots."""
from django.test import TestCase, override_settings

from apps.inventory.tests_job_work_base import JobWorkFixtureMixin
from apps.production.models import ProductionJob
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.sales.services.order_service import _without_quote_snapshots


@override_settings(STRICT_RBAC=True)
class SalesOrderGuardTests(JobWorkFixtureMixin, TestCase):
    def test_confirmed_order_cannot_be_edited_or_deleted(self):
        job = self.make_job("GUARD")
        order = job.sales_order_item.sales_order
        sales = self.client_for(self.sales)

        edited = sales.patch(f"/api/sales/orders/{order.id}/", {"customer_name": "Someone Else", "delivery_date": "2020-01-01"}, format="json")
        self.assertEqual(edited.status_code, 409, edited.data)
        order.refresh_from_db()
        self.assertEqual(order.customer_name, "Sample Nutrition Co")

        deleted = sales.delete(f"/api/sales/orders/{order.id}/")
        self.assertEqual(deleted.status_code, 409)
        self.assertTrue(SalesOrder.objects.filter(id=order.id).exists())
        self.assertTrue(SalesOrderItem.objects.filter(id=job.sales_order_item_id).exists())
        job.refresh_from_db()
        self.assertIsNotNone(job.sales_order_item_id)

    def test_draft_order_can_still_be_edited_and_deleted(self):
        draft = SalesOrder.objects.create(customer_name="Draft Co", order_name="draft", order_type="MTO", status="DRAFT")
        sales = self.client_for(self.sales)
        self.assertEqual(sales.patch(f"/api/sales/orders/{draft.id}/", {"remarks": "Call first"}, format="json").status_code, 200)
        self.assertEqual(sales.delete(f"/api/sales/orders/{draft.id}/").status_code, 204)
        self.assertFalse(SalesOrder.objects.filter(id=draft.id).exists())

    def test_draft_with_production_jobs_is_not_deleted(self):
        job = self.make_job("GUARD-DRAFT")
        order = job.sales_order_item.sales_order
        SalesOrder.objects.filter(id=order.id).update(status="DRAFT")
        response = self.client_for(self.sales).delete(f"/api/sales/orders/{order.id}/")
        self.assertEqual(response.status_code, 409)
        self.assertTrue(ProductionJob.objects.filter(id=job.id, sales_order_item__sales_order=order).exists())

    def test_client_cannot_supply_quotation_evidence(self):
        payload = {
            "customer_name": "Forged",
            "quote_acceptance_snapshot": {"reference": "FAKE-PO"},
            "quote_commercial_snapshot": {"quote_number": "Q-1"},
            "quote_cost_snapshot": {"checksum": "x"},
            "items": [{"template_id": "t", "quote_variant_snapshot": {"x": 1}, "quote_cost_snapshot": {"y": 2}, "qty_value": "5"}],
        }
        cleaned = _without_quote_snapshots(payload)
        for key in ("quote_acceptance_snapshot", "quote_commercial_snapshot", "quote_cost_snapshot"):
            self.assertNotIn(key, cleaned)
        self.assertEqual(cleaned["items"], [{"template_id": "t", "qty_value": "5"}])
        self.assertEqual(cleaned["customer_name"], "Forged")
