from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from apps.analytics.views import AnalyticsViewSet


class AnalyticsTraceLookupTests(SimpleTestCase):
    def _user(self, **overrides):
        base_role = SimpleNamespace(code="ADMIN")
        payload = {
            "is_authenticated": True,
            "is_superuser": False,
            "is_owner": False,
            "effective_role_code": "ADMIN",
            "role": base_role,
            "username": "admin",
        }
        payload.update(overrides)
        return SimpleNamespace(**payload)

    def test_trace_lookup_forbids_non_admin_audit_access(self):
        request = SimpleNamespace(query_params={"q": "SO00621"}, data={}, user=self._user(effective_role_code="STORE", role=SimpleNamespace(code="STORE")))

        response = AnalyticsViewSet().trace_lookup(request)

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["detail"], "Forbidden")

    def test_trace_lookup_requires_query(self):
        request = SimpleNamespace(query_params={}, data={}, user=self._user())

        response = AnalyticsViewSet().trace_lookup(request)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"], "q query param is required")

    def test_trace_lookup_returns_not_found_when_service_returns_error(self):
        request = SimpleNamespace(query_params={"q": "MISSING-REF"}, data={}, user=self._user())

        with patch(
            "apps.analytics.views.AnalyticsService.get_trace_lookup",
            return_value={"query": "MISSING-REF", "error": "No trace record found."},
        ):
            response = AnalyticsViewSet().trace_lookup(request)

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data["query"], "MISSING-REF")
        self.assertEqual(response.data["error"], "No trace record found.")

    def test_trace_lookup_returns_payload_when_service_finds_record(self):
        request = SimpleNamespace(query_params={"q": "SO00621"}, data={}, user=self._user())
        payload = {
            "query": "SO00621",
            "matched_by": "sales_order_number",
            "entity": {
                "type": "SALES_ORDER",
                "id": "123",
                "reference": "SO00621",
                "title": "SO00621",
                "subtitle": "UAT-GREEN Sales Customer",
                "status": "CONFIRMED",
            },
            "summary": {"customer_name": "UAT-GREEN Sales Customer"},
            "timeline": [{"event_type": "CREATED", "message": "Sales order created"}],
            "related": [],
            "specialized": {},
        }

        with patch("apps.analytics.views.AnalyticsService.get_trace_lookup", return_value=payload):
            response = AnalyticsViewSet().trace_lookup(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["entity"]["reference"], "SO00621")
        self.assertEqual(response.data["matched_by"], "sales_order_number")
