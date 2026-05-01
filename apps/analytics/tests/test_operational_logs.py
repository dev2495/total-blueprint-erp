from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.analytics.services import ReportingService
from apps.users.models import PermissionAuditLog, Role


class AnalyticsOperationalLogsTests(TestCase):
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

    def test_operational_logs_forbid_non_admin_user(self):
        self.client.force_authenticate(user=self.sales_user)

        response = self.client.get("/api/analytics/operational-logs/")

        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(response.data["detail"], "Forbidden")

    def test_operational_logs_include_users_and_system_audit_events(self):
        PermissionAuditLog.objects.create(
            user=self.sales_user,
            action="USER_LOGIN",
            method="POST",
            path="/api/users/login/",
            effective_role="SALES",
            details={"status": "authenticated"},
        )
        PermissionAuditLog.objects.create(
            user=self.sales_user,
            action="DENIED",
            method="GET",
            path="/api/analytics/trace/",
            required_permission="analytics.admin",
            effective_role="SALES",
            details={"reason": "rbac_permission_missing"},
        )
        PermissionAuditLog.objects.create(
            user=self.admin,
            action="ROLE_CHANGED",
            method="PATCH",
            path="/api/users/users/123/",
            details={"updated_user": "sales1", "status": "updated"},
        )

        rows = ReportingService.get_operational_logs(filter_type="all", limit=20)

        login_row = next((row for row in rows if row.get("event_type") == "USER_LOGIN"), None)
        denied_row = next((row for row in rows if row.get("event_type") == "DENIED"), None)
        role_row = next((row for row in rows if row.get("event_type") == "ROLE_CHANGED"), None)

        self.assertIsNotNone(login_row)
        self.assertEqual(login_row["type"], "USERS")
        self.assertEqual(login_row["desc"], "User login")
        self.assertEqual(login_row["user"], "sales1")
        self.assertEqual(login_row["href"], "/system/audit")
        self.assertEqual(login_row["entity_type"], "PERMISSION_AUDIT_LOG")
        self.assertEqual(login_row["meta"]["effective_role"], "SALES")

        self.assertIsNotNone(denied_row)
        self.assertEqual(denied_row["type"], "SYSTEM")
        self.assertEqual(denied_row["val"], "analytics.admin")

        self.assertIsNotNone(role_row)
        self.assertEqual(role_row["type"], "SYSTEM")
        self.assertEqual(role_row["reference"], "sales1")

    def test_role_override_probe_logs_do_not_dominate_audit_console(self):
        PermissionAuditLog.objects.create(
            user=self.admin,
            action="ROLE_OVERRIDE",
            method="GET",
            path="/api/users/me",
            effective_role="ADMIN",
            details={"allowed": False, "override_role": "ADMIN"},
        )
        PermissionAuditLog.objects.create(
            user=self.sales_user,
            action="DENIED",
            method="GET",
            path="/api/analytics/trace/",
            required_permission="analytics.admin",
            effective_role="SALES",
            details={"reason": "rbac_permission_missing"},
        )

        rows = ReportingService.get_operational_logs(filter_type="all", limit=20)
        self.assertFalse(any(row.get("event_type") == "ROLE_OVERRIDE" for row in rows))

        payload = ReportingService.get_audit_console()
        permission_events = payload["modes"]["permissions"]["items"]
        self.assertFalse(any(row.get("action") == "ROLE_OVERRIDE" for row in permission_events))
        self.assertTrue(any(row.get("action") == "DENIED" for row in permission_events))
        self.assertGreaterEqual(payload["counts"]["role_override_audit"], 1)

    def test_admin_can_read_operational_logs_with_normalized_audit_shape(self):
        PermissionAuditLog.objects.create(
            user=self.sales_user,
            action="USER_LOGOUT",
            method="POST",
            path="/api/users/logout/",
            effective_role="SALES",
            details={"status": "cookie_cleared"},
        )
        self.client.force_authenticate(user=self.admin)

        response = self.client.get("/api/analytics/operational-logs/", {"type": "users", "limit": 10})

        self.assertEqual(response.status_code, 200, response.content)
        self.assertGreaterEqual(len(response.data), 1)
        row = response.data[0]
        for key in ("date", "type", "desc", "val", "user", "reference", "href", "event_type", "entity_type", "meta"):
            self.assertIn(key, row)
        self.assertEqual(row["type"], "USERS")
        self.assertEqual(row["event_type"], "USER_LOGOUT")
