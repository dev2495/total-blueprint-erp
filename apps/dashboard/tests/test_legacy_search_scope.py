from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.factory.models import Machine, Plant, Process, WorkCenter
from apps.production.models import ProductionJob
from apps.routing.models import RoutingRule
from apps.sales.models import SalesOrder
from apps.users.models import Role, User, WorkCenterAssignment


@override_settings(STRICT_RBAC=True)
class LegacyDashboardSearchScopeTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.users = {}
        for code in ("OWNER", "SALES", "ENGINEERING", "GUEST", "WORK_CENTER_MANAGER", "PLANNER"):
            role = Role.objects.create(code=code, name=code)
            self.users[code] = User.objects.create_user(username=f"search-{code}", role=role)
        plant = Plant.objects.create(code="SEARCH-PLANT", name="Search plant")
        self.centers = [WorkCenter.objects.create(plant=plant, code=f"SEARCH-WC-{index}", name=f"Center {index}") for index in (1, 2)]
        process = Process.objects.create(code="SEARCH-PROCESS", name="Search process")
        route = RoutingRule.objects.create(name="Search route", ordered_processes=[process.code])
        self.jobs = []
        for index, center in enumerate(self.centers, start=1):
            machine = Machine.objects.create(work_center=center, code=f"SEARCH-MACHINE-{index}", name=f"Machine {index}")
            self.jobs.append(ProductionJob.objects.create(
                job_number=f"SEARCH-JOB-{index}", routing_rule=route, quantity=10,
                work_center=center, machine=machine, process=process, current_process=process,
            ))
        self.order = SalesOrder.objects.create(order_number="SEARCH-ORDER", customer_name="Search customer")

    def search(self, role, query="SEARCH"):
        self.client.force_authenticate(self.users[role])
        response = self.client.get("/api/dashboard/search/", {"q": query})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIsInstance(response.data, list)
        return response.data

    def test_guest_and_engineering_search_cannot_disclose_orders_or_jobs(self):
        self.assertEqual(self.search("GUEST"), [])
        self.assertEqual(self.search("ENGINEERING"), [])

    def test_wcm_job_results_follow_assigned_work_center_including_empty_scope(self):
        self.assertEqual(self.search("WORK_CENTER_MANAGER"), [])
        WorkCenterAssignment.objects.create(user=self.users["WORK_CENTER_MANAGER"], work_center=self.centers[0])
        rows = self.search("WORK_CENTER_MANAGER")
        self.assertEqual([row["label"] for row in rows], ["SEARCH-JOB-1"])
        self.assertEqual(rows[0]["type"], "Job")

    def test_authorized_sales_owner_and_planner_keep_legacy_response_shape(self):
        sales = self.search("SALES")
        self.assertEqual(len(sales), 1)
        self.assertEqual(sales[0], {
            "type": "Order", "label": "SEARCH-ORDER - Search customer",
            "href": f"/sales/orders/{self.order.pk}", "status": "DRAFT",
        })
        owner = self.search("OWNER")
        self.assertEqual({row["label"] for row in owner}, {"SEARCH-ORDER - Search customer", "SEARCH-JOB-1", "SEARCH-JOB-2"})
        self.assertTrue(all(set(row) == {"type", "label", "href", "status"} for row in owner))
        planner = self.search("PLANNER")
        self.assertEqual({row["label"] for row in planner}, {"SEARCH-ORDER - Search customer", "SEARCH-JOB-1", "SEARCH-JOB-2"})
        self.assertEqual(self.search("OWNER", "   "), [])
