from django.core.exceptions import ValidationError
from django.contrib.auth import get_user_model
from django.test import TestCase

from apps.sales.models import Customer, SalesOrder, SalesOrderItem
from apps.sales.models_dispatch import CustomerDispatch, CustomerDispatchLine
from apps.sales.services.order_service import SalesOrderService
from apps.sales.views_dispatch import CustomerDispatchSerializer, CustomerDispatchViewSet
from apps.templates.models import TemplateBlueprint
from rest_framework.test import APIRequestFactory, force_authenticate


class SalesOrderCancelAndShipToTests(TestCase):
    def _template(self, name="Mono LD"):
        return TemplateBlueprint.objects.create(name=name, fg_type="ROLL", status="LIVE")

    def _line(self, order, template, *, name, qty=100, status="PLANNING_REQUIRED"):
        return SalesOrderItem.objects.create(
            sales_order=order,
            template=template,
            line_name=name,
            qty_value=qty,
            qty_uom="KG",
            total_weight_kg=qty,
            line_status=status,
        )

    def test_ship_to_defaults_to_bill_to_and_remarks_are_stored(self):
        customer = Customer.objects.create(name="Bill To Customer", code="BILLTO")

        order = SalesOrder.objects.create(
            customer=customer,
            customer_name=customer.name,
            ship_to_customer=customer,
            ship_to_customer_name=customer.name,
            remarks="Urgent dispatch note",
            status="PLANNING_REQUIRED",
        )

        self.assertEqual(order.ship_to_customer_id, customer.id)
        self.assertEqual(order.ship_to_customer_name, "Bill To Customer")
        self.assertEqual(order.remarks, "Urgent dispatch note")

    def test_order_can_be_cancelled_before_planner_release(self):
        customer = Customer.objects.create(name="Cancel Customer", code="CANCEL")
        order = SalesOrder.objects.create(
            customer=customer,
            customer_name=customer.name,
            ship_to_customer=customer,
            ship_to_customer_name=customer.name,
            status="PLANNING_REQUIRED",
        )

        cancelled = SalesOrderService.cancel_sales_order(order.id, reason="Customer stopped order")

        self.assertEqual(cancelled.status, "CANCELLED")

    def test_order_cannot_be_cancelled_after_release(self):
        customer = Customer.objects.create(name="Released Customer", code="RELEASED")
        order = SalesOrder.objects.create(
            customer=customer,
            customer_name=customer.name,
            ship_to_customer=customer,
            ship_to_customer_name=customer.name,
            status="RELEASED",
        )

        with self.assertRaisesMessage(ValidationError, "Order cannot be cancelled from status RELEASED."):
            SalesOrderService.cancel_sales_order(order.id, reason="Too late")

    def test_selected_lines_can_be_cancelled_before_release(self):
        customer = Customer.objects.create(name="Line Cancel Customer", code="LINEC")
        template = self._template()
        order = SalesOrder.objects.create(
            customer=customer,
            customer_name=customer.name,
            status="PLANNING_REQUIRED",
        )
        cancelled_line = self._line(order, template, name="Trial roll", qty=80)
        kept_line = self._line(order, template, name="Main roll", qty=120)

        updated = SalesOrderService.cancel_sales_order_lines(
            order.id,
            item_ids=[str(cancelled_line.id)],
            reason="Customer cancelled trial line",
        )

        cancelled_line.refresh_from_db()
        kept_line.refresh_from_db()
        self.assertEqual(updated.status, "PLANNING_REQUIRED")
        self.assertEqual(cancelled_line.line_status, "CANCELLED")
        self.assertEqual(cancelled_line.qty_cancelled, cancelled_line.qty_value)
        self.assertEqual(cancelled_line.qty_open, 0)
        self.assertEqual(kept_line.line_status, "PLANNING_REQUIRED")
        self.assertEqual(kept_line.qty_open, kept_line.qty_value)

    def test_planner_short_close_partial_keeps_produced_balance_dispatchable(self):
        customer = Customer.objects.create(name="Partial Customer", code="PART")
        template = self._template()
        order = SalesOrder.objects.create(
            customer=customer,
            customer_name=customer.name,
            status="PLANNING_REQUIRED",
        )
        line = self._line(order, template, name="500 kg line", qty=500, status="PARTIAL")

        updated = SalesOrderService.planner_short_close_sales_order_item(
            line.id,
            reason="Customer accepts 200 kg balance only",
            close_qty_kg=300,
        )

        line.refresh_from_db()
        self.assertEqual(updated.status, "PACKING_READY")
        self.assertEqual(line.line_status, "PACKING_READY")
        self.assertEqual(line.qty_short_closed, 300)
        self.assertEqual(line.qty_open, 200)

    def test_planner_cancel_line_closes_remaining_before_machine_activity(self):
        customer = Customer.objects.create(name="Planner Cancel Customer", code="PCAN")
        template = self._template()
        order = SalesOrder.objects.create(
            customer=customer,
            customer_name=customer.name,
            status="RELEASED",
        )
        line = self._line(order, template, name="Released but not started", qty=75, status="RELEASED")

        updated = SalesOrderService.planner_cancel_sales_order_item(
            line.id,
            reason="Customer cancelled after planner release before machine start",
        )

        line.refresh_from_db()
        self.assertEqual(updated.status, "CANCELLED")
        self.assertEqual(line.line_status, "CANCELLED")
        self.assertEqual(line.qty_cancelled, 75)
        self.assertEqual(line.qty_open, 0)

    def test_dispatch_rejects_partial_line_until_planner_resolution(self):
        customer = Customer.objects.create(name="Dispatch Guard Customer", code="DGUARD")
        template = self._template()
        order = SalesOrder.objects.create(
            customer=customer,
            customer_name=customer.name,
            status="PLANNING_REQUIRED",
        )
        line = self._line(order, template, name="Partial unresolved", qty=500, status="PARTIAL")

        serializer = CustomerDispatchSerializer(
            data={
                "sales_order": str(order.id),
                "customer": str(customer.id),
                "dispatch_date": "2026-06-16",
                "lines": [{"sales_order_item": str(line.id), "qty_dispatched": "200", "uom": "KG"}],
            }
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("not ready for dispatch", str(serializer.errors))

    def test_dispatch_cancel_reopens_line_status(self):
        customer = Customer.objects.create(name="Dispatch Cancel Customer", code="DCAN")
        template = self._template()
        order = SalesOrder.objects.create(
            customer=customer,
            customer_name=customer.name,
            status="PACKING_READY",
        )
        line = self._line(order, template, name="Ready line", qty=100, status="PACKING_READY")
        dispatch = CustomerDispatch.objects.create(
            sales_order=order,
            customer=customer,
            status="CONFIRMED",
        )
        CustomerDispatchLine.objects.create(
            dispatch=dispatch,
            sales_order_item=line,
            qty_dispatched=100,
            uom="KG",
        )
        line.line_status = "COMPLETED"
        line.save(update_fields=["line_status"])

        request = APIRequestFactory().post("/")
        user = get_user_model().objects.create_user(username="dispatch-test", password="x")
        force_authenticate(request, user=user)
        response = CustomerDispatchViewSet.as_view({"post": "cancel"})(request, pk=dispatch.id)

        self.assertEqual(response.status_code, 200)
        line.refresh_from_db()
        self.assertEqual(line.qty_open, 100)
        self.assertEqual(line.line_status, "PACKING_READY")
