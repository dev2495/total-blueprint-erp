"""Year close moves finished records out of the day-to-day lists; ?fy= brings a year back."""
from datetime import datetime
from zoneinfo import ZoneInfo

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.inventory.models import InventoryFinancialPeriod
from apps.sales.models import SalesOrder
from apps.users.models import Role, User

IST = ZoneInfo("Asia/Kolkata")


@override_settings(STRICT_RBAC=True)
class ArchiveScopeTests(TestCase):
    def setUp(self):
        role = Role.objects.create(code="SALES", name="Sales", default_permissions=["sales.view", "sales.manage", "users.self_manage"])
        self.user = User.objects.create_user(username="arch-sales", password="pass12345", role=role)
        self.api = APIClient(SERVER_NAME="127.0.0.1")
        self.api.force_authenticate(self.user)

        def order(number, status, when):
            o = SalesOrder.objects.create(order_number=number, customer_name="Archive customer", status=status)
            SalesOrder.objects.filter(id=o.id).update(created_at=when)
            return o

        self.old_done = order("SO-OLD-DONE", "COMPLETED", datetime(2025, 9, 1, 10, tzinfo=IST))
        self.old_open = order("SO-OLD-OPEN", "PLANNED", datetime(2025, 9, 2, 10, tzinfo=IST))
        self.last_day = order("SO-OLD-31MAR", "COMPLETED", datetime(2026, 3, 31, 23, 30, tzinfo=IST))
        self.new_done = order("SO-NEW-DONE", "COMPLETED", datetime(2026, 4, 1, 0, 30, tzinfo=IST))

    def numbers(self, **params):
        response = self.api.get("/api/sales/orders/", params)
        self.assertEqual(response.status_code, 200, response.data)
        rows = response.data["results"] if isinstance(response.data, dict) else response.data
        return {row["order_number"] for row in rows}

    def test_nothing_is_archived_until_the_year_is_closed(self):
        self.assertEqual(self.numbers(), {"SO-OLD-DONE", "SO-OLD-OPEN", "SO-OLD-31MAR", "SO-NEW-DONE"})

    def test_closed_year_keeps_open_work_and_hides_finished_work(self):
        InventoryFinancialPeriod.objects.create(financial_year="2025-2026", start_date="2025-04-01", end_date="2026-03-31", status="CLOSED")
        self.assertEqual(self.numbers(), {"SO-OLD-OPEN", "SO-NEW-DONE"}, "31 March 23:30 IST belongs to the closed year")
        self.assertEqual(self.numbers(fy="2025-2026"), {"SO-OLD-DONE", "SO-OLD-OPEN", "SO-OLD-31MAR"})
        self.assertEqual(self.numbers(fy="all"), {"SO-OLD-DONE", "SO-OLD-OPEN", "SO-OLD-31MAR", "SO-NEW-DONE"})
        detail = self.api.get(f"/api/sales/orders/{self.old_done.id}/")
        self.assertEqual(detail.status_code, 200, "archived records still open by link")
        self.assertEqual(self.api.get("/api/sales/orders/", {"fy": "next year"}).status_code, 400)

    def test_year_list_for_the_header_picker(self):
        InventoryFinancialPeriod.objects.create(financial_year="2025-2026", start_date="2025-04-01", end_date="2026-03-31", status="CLOSED")
        data = self.api.get("/api/auth/financial-years/").data
        by_code = {row["code"]: row for row in data["years"]}
        self.assertTrue(by_code["2025-2026"]["archived"])
        self.assertIn(data["current"], by_code)
        self.assertTrue(by_code[data["current"]]["current"])
