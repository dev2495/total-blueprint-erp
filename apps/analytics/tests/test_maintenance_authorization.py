from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.users.models import Role


class AnalyticsMaintenanceAuthorizationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin_role = Role.objects.create(code="ADMIN", name="Admin", default_permissions=["*"])
        self.sales_role = Role.objects.create(
            code="SALES",
            name="Sales",
            default_permissions=["analytics.view", "users.self_manage"],
        )
        self.admin = get_user_model().objects.create_user(
            username="admin1",
            email="admin1@example.com",
            password="adminpass123",
            role=self.admin_role,
        )
        self.sales_user = get_user_model().objects.create_user(
            username="sales1",
            email="sales1@example.com",
            password="salespass123",
            role=self.sales_role,
        )

    def test_non_admin_user_gets_403_and_service_is_not_called(self):
        self.client.force_authenticate(user=self.sales_user)

        with patch("apps.analytics.views.AnalyticsService.perform_maintenance") as maintenance:
            response = self.client.post(
                "/api/analytics/maintenance/",
                {"action": "clear_cache"},
                format="json",
            )

        self.assertEqual(response.status_code, 403, response.content)
        maintenance.assert_not_called()

    def test_admin_user_can_invoke_maintenance(self):
        self.client.force_authenticate(user=self.admin)

        with patch(
            "apps.analytics.views.AnalyticsService.perform_maintenance",
            return_value={"success": True, "message": "cleared"},
        ) as maintenance:
            response = self.client.post(
                "/api/analytics/maintenance/",
                {"action": "clear_cache"},
                format="json",
            )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data["success"], True)
        maintenance.assert_called_once_with(action="clear_cache")
