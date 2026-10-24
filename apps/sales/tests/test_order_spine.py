"""Order spine: the seven-station summary every screen shows for an order."""
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.production.models import ProductionJob
from apps.production.tests import test_roll_lane_flow as lane_tests
from apps.production.tests.test_roll_lane_flow import RollLaneFixture
from apps.sales.services.order_spine_service import OrderSpineService
from apps.users.models import Role

D = Decimal


@patch("apps.production.services.services_execution.ExecutionService.calculate_requirements")
@patch("apps.production.services.job_services.require_bom_ready_for_production")
class OrderSpineTests(RollLaneFixture, TestCase):
    _linear = lane_tests.SingleLaneFlowTests._linear

    def test_stations_follow_the_order_through_the_route(self, *_):
        geometry = {"fg_type": "POUCH", "base": {"width_mm": 160, "height_mm": 230}}
        item, jobs = self._linear(["PRT", "PCH"], fg_type="POUCH", uom="PCS", qty=D("100000"), unit_weight_g=D("6.85"), geometry=geometry)
        order = item.sales_order

        spine = OrderSpineService.for_order(order)
        keys = [s["key"] for s in spine["stations"]]
        self.assertEqual(keys, ["master", "quote", "order", "plan", "floor", "yard", "dispatch"])
        by_key = {s["key"]: s for s in spine["stations"]}
        self.assertEqual(by_key["quote"]["state"], "skipped", "no quotation behind this order")
        self.assertEqual(by_key["order"]["href"], f"/sales/orders/{order.id}")
        self.assertIn("100,000 pcs", by_key["order"]["value"])
        self.assertEqual(by_key["plan"]["value"].split(" · ")[-1], "2 jobs")
        self.assertIn("0 of 2 done", by_key["floor"]["value"])
        self.assertEqual(by_key["floor"]["href"], f"/production/work-center/{jobs[0].work_center_id}" if jobs[0].work_center_id else "/production/work-center")
        self.assertEqual(by_key["yard"]["state"], "pending")
        self.assertEqual(by_key["dispatch"]["state"], "pending")
        made = spine["made"]
        self.assertTrue(made["headline"].startswith("100,000 pcs"), made["headline"])
        self.assertIn("160 × 230", made["headline"])
        self.assertEqual(made["route"], "PRT → PCH")
        self.assertEqual(made["line_count"], 1)

        # Finish the first step: the floor station moves on and points at the next job.
        prev = jobs[0]
        self._complete_predecessors({"p": prev}, ["p"])
        spine = OrderSpineService.for_order(order)
        floor = next(s for s in spine["stations"] if s["key"] == "floor")
        self.assertIn("1 of 2 done", floor["value"])
        self.assertIn(jobs[1].job_number, floor["detail"])

        # By job: same order, with the job marked as the focus.
        from_job = OrderSpineService.for_job(ProductionJob.objects.get(id=jobs[1].id))
        self.assertEqual(from_job["order_id"], str(order.id))
        self.assertEqual(from_job["focus_job_id"], str(jobs[1].id))

    def test_made_carries_the_stock_web_and_the_job_name(self, *_):
        geometry = {
            "fg_type": "POUCH", "base": {"width_mm": 190, "height_mm": 380},
            "stock_form": "LAYFLAT_TUBE", "child_target_width_mm": 380, "roll_width_mm": 380,
            "film_area_width_mm": 760, "slit_policy": "EXACT_ONLY",
        }
        item, _jobs = self._linear(["PRT", "PCH"], fg_type="POUCH", uom="PCS", qty=D("1000"), unit_weight_g=D("5"), geometry=geometry)
        order = item.sales_order
        order.order_name = "Diwali gift pack"
        order.save(update_fields=["order_name"])
        made = OrderSpineService.for_order(order)["made"]
        self.assertEqual(made["job_name"], "Diwali gift pack")
        self.assertEqual(made["stock_web"], "Lay-flat tube · 380 mm roll (760 mm film) · exact width only")
        self.assertEqual(made["lines"][0]["stock_width_mm"], 380)
        # Auto-filled "Order YYYY-MM-DD" names are not job names.
        order.order_name = "Order 2026-10-24"
        order.save(update_fields=["order_name"])
        self.assertEqual(OrderSpineService.for_order(order)["made"]["job_name"], "")

    def _role_client(self, code):
        role, _ = Role.objects.get_or_create(code=code, defaults={"name": code.replace("_", " ").title()})
        user = get_user_model().objects.create(username=f"spine-{code.lower()}", email=f"spine-{code.lower()}@example.invalid", role=role)
        client = APIClient()
        client.force_authenticate(user)
        return client

    @override_settings(STRICT_RBAC=True)
    def test_endpoints_return_the_spine(self, *_):
        item, jobs = self._linear(["PRT", "PCH"], fg_type="POUCH", uom="PCS", qty=D("5000"), unit_weight_g=D("6.85"),
                                  geometry={"fg_type": "POUCH", "base": {"width_mm": 160, "height_mm": 230}})
        client = self._role_client("PLANNER")
        order_resp = client.get(f"/api/sales/orders/{item.sales_order_id}/spine/")
        self.assertEqual(order_resp.status_code, 200, order_resp.content[:300])
        self.assertEqual(len(order_resp.json()["stations"]), 7)
        job_resp = client.get(f"/api/production/jobs/{jobs[0].id}/spine/")
        self.assertEqual(job_resp.status_code, 200, job_resp.content[:300])
        self.assertEqual(job_resp.json()["order_id"], str(item.sales_order_id))
        detail = client.get(f"/api/sales/orders/{item.sales_order_id}/")
        self.assertEqual(detail.status_code, 200)
        for field in ("bill_to_address", "customer_po_reference", "payment_terms", "delivery_terms", "remarks"):
            self.assertIn(field, detail.json())

    @override_settings(STRICT_RBAC=True)
    def test_floor_and_yard_roles_can_read_the_spine_their_screens_use(self, *_):
        """WC terminal and machine screens read the job spine; the packing yard reads the order spine."""
        item, jobs = self._linear(["PRT", "PCH"], fg_type="POUCH", uom="PCS", qty=D("5000"), unit_weight_g=D("6.85"),
                                  geometry={"fg_type": "POUCH", "base": {"width_mm": 160, "height_mm": 230}})
        for code in ("WORK_CENTER_MANAGER", "OPERATOR", "MAINTENANCE_TECH"):
            resp = self._role_client(code).get(f"/api/production/jobs/{jobs[0].id}/spine/")
            self.assertEqual(resp.status_code, 200, f"{code}: {resp.content[:200]}")
        for code in ("DISPATCH", "SALES", "STORE"):
            resp = self._role_client(code).get(f"/api/sales/orders/{item.sales_order_id}/spine/")
            self.assertEqual(resp.status_code, 200, f"{code}: {resp.content[:200]}")


class OrderListKpiTests(TestCase):
    """The orders page header counts every order, and the queue asks for open orders only."""

    def test_kpis_count_every_open_order_and_the_open_filter_skips_closed_ones(self):
        from datetime import timedelta
        from django.utils import timezone
        from apps.sales.models import SalesOrder, SalesOrderItem

        role, _ = Role.objects.get_or_create(code="SALES", defaults={"name": "Sales"})
        client = APIClient()
        client.force_authenticate(get_user_model().objects.create(username="kpi-sales", email="kpi@example.invalid", role=role))
        from apps.routing.models import RoutingRule
        from apps.templates.models import TemplateBlueprint

        template = TemplateBlueprint.objects.create(name="KPI template", fg_type="ROLL", status="LIVE", routing_rule=RoutingRule.objects.create(name="KPI route", ordered_processes=[]))
        for n in range(3):
            order = SalesOrder.objects.create(customer_name=f"Open {n}", status="PLANNING_REQUIRED")
            SalesOrderItem.objects.create(sales_order=order, template=template, mode="TEMPLATE", qty_value=D("100"), qty_uom="KG", total_weight_kg=D("100"), price_basis="KG", unit_price=D("2"))
        old = SalesOrder.objects.create(customer_name="Old open", status="CONFIRMED")
        SalesOrder.objects.filter(id=old.id).update(created_at=timezone.now() - timedelta(days=9))
        SalesOrder.objects.create(customer_name="Done", status="COMPLETED")
        SalesOrder.objects.create(customer_name="Dropped", status="CANCELLED")

        kpis = client.get("/api/sales/orders/kpis/").json()
        self.assertEqual((kpis["open"], kpis["awaiting"], kpis["aged"]), (4, 3, 1))
        self.assertEqual(kpis["value_in_flight"], 600.0)
        self.assertEqual((kpis["history_count"], kpis["cancelled_count"]), (1, 1))

        rows = client.get("/api/sales/orders/", {"status": "OPEN", "summary": 1, "limit": 150}).json()
        self.assertEqual(len(rows), 4)
        self.assertNotIn("COMPLETED", {row["status"] for row in rows})
