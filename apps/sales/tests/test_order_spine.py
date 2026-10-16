"""Order spine: the seven-station summary every screen shows for an order."""
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from apps.production.models import ProductionJob
from apps.production.tests import test_roll_lane_flow as lane_tests
from apps.production.tests.test_roll_lane_flow import RollLaneFixture
from apps.sales.services.order_spine_service import OrderSpineService

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

    def test_endpoints_return_the_spine(self, *_):
        item, jobs = self._linear(["PRT", "PCH"], fg_type="POUCH", uom="PCS", qty=D("5000"), unit_weight_g=D("6.85"),
                                  geometry={"fg_type": "POUCH", "base": {"width_mm": 160, "height_mm": 230}})
        client = APIClient()
        client.force_authenticate(self.user)
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
