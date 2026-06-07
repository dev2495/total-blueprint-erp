from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.analytics.services import AnalyticsService, ReportingService
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

    def test_audit_ledger_searches_in_house_demand_and_exposes_exact_trace(self):
        audit = PermissionAuditLog.objects.create(
            user=self.admin,
            action="IN_HOUSE_DEMAND_TRIGGERED",
            method="POST",
            path="/api/sales/orders/create/",
            effective_role="ADMIN",
            details={
                "order_number": "SO-TRACE-001",
                "order_id": "11111111-1111-1111-1111-111111111111",
                "status": "planner demand created",
            },
        )

        payload = ReportingService.get_audit_ledger(
            {"q": "IN_HOUSE_DEMAND_TRIGGERED", "range": "all", "limit": 20}
        )

        self.assertEqual(payload["summary"]["filtered_count"], 1)
        self.assertEqual(payload["summary"]["page_count"], 1)
        row = payload["events"][0]
        self.assertEqual(row["action"], "IN_HOUSE_DEMAND_TRIGGERED")
        self.assertEqual(row["stream"], "trace")
        self.assertEqual(row["reference"], "SO-TRACE-001")
        self.assertEqual(row["traceable_reference"], f"permission:{audit.id}")
        self.assertTrue(row["trace_supported"])

    def test_trace_lookup_resolves_audit_action_and_exact_audit_event(self):
        audit = PermissionAuditLog.objects.create(
            user=self.admin,
            action="IN_HOUSE_DEMAND_TRIGGERED",
            method="POST",
            path="/api/sales/orders/create/",
            effective_role="ADMIN",
            details={"order_number": "SO-TRACE-002", "status": "planner demand created"},
        )

        action_payload = AnalyticsService.get_trace_lookup("IN_HOUSE_DEMAND_TRIGGERED")
        exact_payload = AnalyticsService.get_trace_lookup(f"permission:{audit.id}")

        self.assertEqual(action_payload["matched_by"], "audit_action")
        self.assertEqual(action_payload["entity"]["type"], "AUDIT_ACTION")
        self.assertEqual(action_payload["summary"]["event_count"], 1)
        self.assertEqual(exact_payload["matched_by"], "audit_event_id")
        self.assertEqual(exact_payload["entity"]["type"], "AUDIT_EVENT")
        self.assertEqual(exact_payload["summary"]["latest_reference"], "SO-TRACE-002")

    def test_admin_can_read_audit_ledger_api_with_backend_filters(self):
        PermissionAuditLog.objects.create(
            user=self.admin,
            action="IN_HOUSE_DEMAND_TRIGGERED",
            method="POST",
            path="/api/sales/orders/create/",
            effective_role="ADMIN",
            details={"order_number": "SO-TRACE-003", "status": "planner demand created"},
        )
        self.client.force_authenticate(user=self.admin)

        response = self.client.get(
            "/api/analytics/audit-ledger/",
            {"q": "IN_HOUSE_DEMAND_TRIGGERED", "range": "all", "limit": 20},
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data["summary"]["filtered_count"], 1)
        self.assertEqual(response.data["events"][0]["reference"], "SO-TRACE-003")
        self.assertEqual(response.data["events"][0]["stream"], "trace")

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
