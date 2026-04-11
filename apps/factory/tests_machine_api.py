from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.factory.models import Machine, Plant, WorkCenter
from apps.users.models import Role


class MachineApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin_role = Role.objects.create(code="ADMIN", name="Admin", default_permissions=["*"])
        self.sales_role = Role.objects.create(code="SALES", name="Sales", default_permissions=["sales.view"])

        self.admin = get_user_model().objects.create_user(
            username="admin-machine",
            email="admin-machine@example.com",
            password="AdminPass123!",
            role=self.admin_role,
        )
        self.sales_user = get_user_model().objects.create_user(
            username="sales-machine",
            email="sales-machine@example.com",
            password="SalesPass123!",
            role=self.sales_role,
        )

        self.plant = Plant.objects.create(code="PLANT-MAC", name="Machine Plant")
        self.work_center = WorkCenter.objects.create(
            plant=self.plant,
            code="WC-MAC",
            name="Machine Work Center",
        )
        self.secondary_work_center = WorkCenter.objects.create(
            plant=self.plant,
            code="WC-MAC-2",
            name="Second Machine Work Center",
        )

    def _csrf_headers(self, client: APIClient | None = None) -> dict:
        target = client or self.client
        if "csrftoken" not in target.cookies:
            target.get("/api/users/csrf/")
        token = target.cookies.get("csrftoken")
        return {"HTTP_X_CSRFTOKEN": str(getattr(token, "value", "") or "")}

    def _login(self, username: str, password: str):
        response = self.client.post(
            "/api/users/login/",
            {"identifier": username, "password": password},
            format="json",
            **self._csrf_headers(),
        )
        self.assertEqual(response.status_code, 200, response.content)

    def test_admin_can_create_machine(self):
        self._login("admin-machine", "AdminPass123!")

        response = self.client.post(
            "/api/factory/machines/",
            {
                "code": "MACHINE-API-01",
                "name": "Machine API 01",
                "work_center": str(self.work_center.id),
            },
            format="json",
            **self._csrf_headers(),
        )

        self.assertEqual(response.status_code, 201, response.content)
        self.assertTrue(Machine.objects.filter(code="MACHINE-API-01").exists())

    def test_non_admin_cannot_create_machine(self):
        self._login("sales-machine", "SalesPass123!")

        response = self.client.post(
            "/api/factory/machines/",
            {
                "code": "MACHINE-API-02",
                "name": "Machine API 02",
                "work_center": str(self.work_center.id),
            },
            format="json",
            **self._csrf_headers(),
        )

        self.assertEqual(response.status_code, 403, response.content)
        self.assertFalse(Machine.objects.filter(code="MACHINE-API-02").exists())

    def test_admin_can_reuse_machine_code_in_different_work_center(self):
        Machine.objects.create(work_center=self.work_center, code="MC-02", name="First MC-02")
        self._login("admin-machine", "AdminPass123!")

        response = self.client.post(
            "/api/factory/machines/",
            {
                "code": "MC-02",
                "name": "Second MC-02",
                "work_center": str(self.secondary_work_center.id),
            },
            format="json",
            **self._csrf_headers(),
        )

        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(Machine.objects.filter(code="MC-02").count(), 2)

    def test_admin_cannot_reuse_machine_code_in_same_work_center(self):
        Machine.objects.create(work_center=self.work_center, code="MC-02", name="Existing MC-02")
        self._login("admin-machine", "AdminPass123!")

        response = self.client.post(
            "/api/factory/machines/",
            {
                "code": "MC-02",
                "name": "Duplicate MC-02",
                "work_center": str(self.work_center.id),
            },
            format="json",
            **self._csrf_headers(),
        )

        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("already belongs to", str(response.content))
