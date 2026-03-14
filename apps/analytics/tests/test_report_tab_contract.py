from django.test import TestCase
from rest_framework.test import APIClient

from apps.users.models import User


class ReportTabContractTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="analytics-contract",
            password="pass1234",
            is_owner=True,
            is_staff=True,
        )
        self.client.force_authenticate(self.user)

    def _assert_contract(self, payload):
        for key in ["summary", "series", "breakdowns", "rows", "coverage", "generated_at", "warnings"]:
            self.assertIn(key, payload)
        self.assertIsInstance(payload.get("coverage"), dict)
        self.assertIn("execution_log_coverage", payload["coverage"])
        self.assertIn("material_actual_coverage", payload["coverage"])
        self.assertIn("shift_coverage", payload["coverage"])

    def test_material_variance_endpoint_returns_canonical_shape(self):
        response = self.client.get("/api/analytics/reports/material-variance", {"date_from": "2026-03-01", "date_to": "2026-03-04"})
        self.assertEqual(response.status_code, 200)
        self._assert_contract(response.json())

    def test_ink_intelligence_endpoint_returns_canonical_shape(self):
        response = self.client.get("/api/analytics/reports/ink-intelligence", {"date_from": "2026-03-01", "date_to": "2026-03-04"})
        self.assertEqual(response.status_code, 200)
        self._assert_contract(response.json())

    def test_shift_performance_endpoint_returns_canonical_shape(self):
        response = self.client.get("/api/analytics/reports/shift-performance", {"date_from": "2026-03-01", "date_to": "2026-03-04"})
        self.assertEqual(response.status_code, 200)
        self._assert_contract(response.json())

