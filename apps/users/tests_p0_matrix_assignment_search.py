from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.factory.models import Machine, Plant, Process, WorkCenter
from apps.production.models import ProductionJob
from apps.routing.models import RoutingRule
from apps.sales.models import SalesOrder
from apps.users.models import Role, WorkCenterAssignment


class MatrixAssignmentSearchP0Tests(TestCase):
    def setUp(self):
        self.client = APIClient()

        self.admin_role = Role.objects.create(code="ADMIN", name="Admin", default_permissions=["*"])
        self.wcm_role = Role.objects.create(
            code="WORK_CENTER_MANAGER",
            name="WCM",
            default_permissions=["users.self_manage", "dashboard.view", "production.view", "factory.view"],
        )

        self.admin = get_user_model().objects.create_user(
            username="admin_matrix",
            email="admin_matrix@example.com",
            password="adminpass123",
            role=self.admin_role,
        )
        self.wcm = get_user_model().objects.create_user(
            username="wcm_scope",
            email="wcm_scope@example.com",
            password="wcm123456",
            role=self.wcm_role,
        )

        self.plant = Plant.objects.create(name="Test Plant", code="TST_PLANT")
        self.wc_a = WorkCenter.objects.create(plant=self.plant, name="TEST-WC-A", code="TEST_WC_A")
        self.wc_b = WorkCenter.objects.create(plant=self.plant, name="TEST-WC-B", code="TEST_WC_B")

        self.machine_a = Machine.objects.create(work_center=self.wc_a, name="TEST-MACHINE-A", code="TEST_MAC_A")
        self.machine_b = Machine.objects.create(work_center=self.wc_b, name="TEST-MACHINE-B", code="TEST_MAC_B")

        process = Process.objects.create(code="TEST_PROC", name="Test Process")
        route = RoutingRule.objects.create(name="TEST_ROUTE", ordered_processes=["TEST_PROC"])

        self.job_a = ProductionJob.objects.create(
            job_number="TEST-JOB-A",
            routing_rule=route,
            quantity=10,
            work_center=self.wc_a,
            machine=self.machine_a,
            current_process=process,
            process=process,
        )
        self.job_b = ProductionJob.objects.create(
            job_number="TEST-JOB-B",
            routing_rule=route,
            quantity=12,
            work_center=self.wc_b,
            machine=self.machine_b,
            current_process=process,
            process=process,
        )

        SalesOrder.objects.create(order_number="SO_TEST_001", customer_name="TEST CUSTOMER", status="DRAFT")

    def _as_admin(self):
        self.client.force_authenticate(self.admin)

    def _as_wcm(self):
        self.client.force_authenticate(self.wcm)

    def test_permission_catalog_endpoint_returns_assignable_and_root_flags(self):
        self._as_admin()
        response = self.client.get("/api/users/roles/permissions/catalog/")
        self.assertEqual(response.status_code, 200, response.content)
        permissions = {row.get("permission"): row for row in response.data}

        self.assertIn("sales.view", permissions)
        self.assertTrue(permissions["sales.view"].get("assignable"))
        self.assertIn("*", permissions)
        self.assertFalse(permissions["*"].get("assignable"))

    def test_role_list_merges_canonical_defaults_for_stale_database_rows(self):
        Role.objects.create(
            code="STORE",
            name="Store",
            default_permissions=["users.self_manage", "inventory.view"],
        )
        self._as_admin()

        response = self.client.get("/api/users/roles/")
        self.assertEqual(response.status_code, 200, response.content)
        store_row = next(row for row in response.data if row.get("code") == "STORE")

        self.assertIn("inventory.view", store_row["default_permissions"])
        self.assertIn("inventory.manage", store_row["default_permissions"])
        self.assertIn("inventory.adjust", store_row["default_permissions"])

    def test_matrix_import_rejects_unknown_permissions(self):
        self._as_admin()
        previous_permissions = list(self.wcm_role.default_permissions)

        response = self.client.post(
            "/api/users/roles/matrix/import/",
            {
                "matrix": {
                    "WORK_CENTER_MANAGER": ["production.view", "unknown.permission"],
                }
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("invalid_permissions", response.data)
        self.assertIn("WORK_CENTER_MANAGER", response.data["invalid_permissions"])

        self.wcm_role.refresh_from_db()
        self.assertEqual(self.wcm_role.default_permissions, previous_permissions)

    def test_direct_machine_assignment_is_removed_from_active_flow(self):
        self._as_admin()

        wc_ok = self.client.post(
            f"/api/users/users/{self.wcm.id}/assign-work-centers/",
            {"work_center_ids": [str(self.wc_a.id), str(self.wc_b.id)]},
            format="json",
        )
        self.assertEqual(wc_ok.status_code, 200, wc_ok.content)

        machine_denied = self.client.post(
            f"/api/users/users/{self.wcm.id}/assign-machines/",
            {"machine_ids": [str(self.machine_a.id)]},
            format="json",
        )
        self.assertEqual(machine_denied.status_code, 400, machine_denied.content)

    def test_wcm_can_have_multiple_wc_but_machine_assignment_is_blocked(self):
        self._as_admin()

        wc_ok = self.client.post(
            f"/api/users/users/{self.wcm.id}/assign-work-centers/",
            {"work_center_ids": [str(self.wc_a.id), str(self.wc_b.id)]},
            format="json",
        )
        self.assertEqual(wc_ok.status_code, 200, wc_ok.content)

        machine_denied = self.client.post(
            f"/api/users/users/{self.wcm.id}/assign-machines/",
            {"machine_ids": [str(self.machine_a.id)]},
            format="json",
        )
        self.assertEqual(machine_denied.status_code, 400, machine_denied.content)

    def test_search_v2_scopes_machine_wc_job_for_wcm(self):
        WorkCenterAssignment.objects.create(user=self.wcm, work_center=self.wc_a)

        self._as_wcm()
        response = self.client.get("/api/dashboard/search-v2/?q=TEST")
        self.assertEqual(response.status_code, 200, response.content)

        payload = response.data
        self.assertIn("took_ms", payload)
        self.assertIn("counts_by_type", payload)
        self.assertIn("results", payload)

        results = payload["results"]
        machine_ids = {row["id"] for row in results if row.get("type") == "machine"}
        wc_ids = {row["id"] for row in results if row.get("type") == "work_center"}
        job_ids = {row["id"] for row in results if row.get("type") == "job"}

        self.assertIn(str(self.machine_a.id), machine_ids)
        self.assertNotIn(str(self.machine_b.id), machine_ids)

        self.assertIn(str(self.wc_a.id), wc_ids)
        self.assertNotIn(str(self.wc_b.id), wc_ids)

        self.assertIn(str(self.job_a.id), job_ids)
        self.assertNotIn(str(self.job_b.id), job_ids)

        # WCM role should not see sales entities without sales.view.
        self.assertFalse(any(row.get("type") == "order" for row in results))
        self.assertFalse(any(row.get("type") == "customer" for row in results))
