from datetime import datetime
from unittest import mock

from django.test import TestCase
from django.utils import timezone

from apps.sales.models import SalesOrder


class SalesOrderNumberingTests(TestCase):
    def test_sales_order_numbering_is_year_scoped(self):
        SalesOrder.objects.create(order_number="SO-2025-9999", customer_name="Old Customer")
        SalesOrder.objects.create(order_number="SO-2026-0007", customer_name="Current Customer")
        SalesOrder.objects.create(order_number="SO00088", customer_name="Legacy Customer")

        now = timezone.make_aware(datetime(2026, 5, 10, 9, 30))
        with mock.patch("apps.sales.models.timezone.now", return_value=now):
            order = SalesOrder.objects.create(customer_name="New Customer")

        self.assertEqual(order.order_number, "SO-2026-0008")

    def test_sales_order_numbering_starts_new_year_at_one(self):
        SalesOrder.objects.create(order_number="SO-2026-0042", customer_name="Current Customer")

        now = timezone.make_aware(datetime(2027, 4, 1, 0, 5))
        with mock.patch("apps.sales.models.timezone.now", return_value=now):
            order = SalesOrder.objects.create(customer_name="New Year Customer")

        self.assertEqual(order.order_number, "SO-2027-0001")

    def test_manual_order_number_is_preserved(self):
        order = SalesOrder.objects.create(order_number="MANUAL-SO-1", customer_name="Manual Customer")

        self.assertEqual(order.order_number, "MANUAL-SO-1")
