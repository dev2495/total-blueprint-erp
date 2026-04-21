from django.core.exceptions import ValidationError
from django.test import TestCase

from apps.sales.models import Customer, SalesOrder
from apps.sales.services.order_service import SalesOrderService


class SalesOrderCancelAndShipToTests(TestCase):
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

