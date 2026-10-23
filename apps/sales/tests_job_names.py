"""Job names (SalesOrder.order_name) are grouped in a report and never invented."""
from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.sales.job_name import clean_job_name
from apps.routing.models import RoutingRule
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.templates.models import TemplateBlueprint
from apps.users.models import Role, User


@override_settings(STRICT_RBAC=True)
class JobNameReportTests(TestCase):
    def setUp(self):
        role = Role.objects.create(code="SALES", name="Sales", default_permissions=["sales.view", "sales.manage", "users.self_manage"])
        self.api = APIClient(SERVER_NAME="127.0.0.1")
        self.api.force_authenticate(User.objects.create_user(username="jn-sales", password="pass12345", role=role))
        route = RoutingRule.objects.create(name="JN route", ordered_processes=["PCH"])
        template = TemplateBlueprint.objects.create(name="JN pouch", fg_type="POUCH", status="LIVE", routing_rule=route)

        def order(number, name, status="PLANNED", kg="100", pcs=None, completed=None, due=None):
            o = SalesOrder.objects.create(order_number=number, order_name=name, customer_name="Shivam Snacks", status=status, delivery_date=due)
            if completed:
                SalesOrder.objects.filter(id=o.id).update(completed_at=completed)
            SalesOrderItem.objects.create(
                sales_order=o, template=template, line_status="OPEN", qty_value=Decimal(pcs or kg), qty_uom="PCS" if pcs else "KG",
                price_basis="KG", unit_price=Decimal("150"), total_weight_kg=Decimal(kg), unit_weight_g=Decimal("4"),
                geometry_snapshot={"finished_good_type": "POUCH"},
            )
            return o

        order("SO-JN-1", "Diwali gift pack", kg="400", pcs="100000")
        order("SO-JN-2", "diwali gift pack ", kg="200", status="COMPLETED", completed=datetime(2026, 10, 1, tzinfo=ZoneInfo("Asia/Kolkata")), due=date(2026, 10, 5))
        order("SO-JN-3", "Order 2026-10-20", kg="50")
        order("SO-JN-4", "", kg="70")

    def test_auto_dates_are_not_job_names(self):
        self.assertEqual(clean_job_name("Order 2026-10-20"), "")
        self.assertEqual(clean_job_name("  Diwali gift pack "), "Diwali gift pack")

    def test_orders_club_by_job_name(self):
        data = self.api.get("/api/sales/orders/job-names/").data
        self.assertEqual(data["totals"]["job_names"], 1)
        self.assertEqual(data["totals"]["orders_unnamed"], 2)
        row = data["rows"][0]
        self.assertEqual((row["job_name"], row["orders"], row["open_orders"]), ("Diwali gift pack", 2, 1))
        self.assertEqual(row["ordered_kg"], 600.0)
        self.assertEqual(row["ordered_pcs"], 150000)
        self.assertEqual(row["on_time_pct"], 100.0)
        kpis = self.api.get("/api/sales/orders/kpis/").data
        self.assertEqual(kpis["job_names_open"], 1)
