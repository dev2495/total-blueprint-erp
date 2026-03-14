from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from apps.dashboard.views import DashboardViewSet


class DashboardErrorStatusTests(SimpleTestCase):
    def test_stats_failure_returns_error_envelope(self):
        request = SimpleNamespace(user=SimpleNamespace())

        with patch("apps.dashboard.views.DashboardService.get_stats", side_effect=RuntimeError("stats exploded")):
            response = DashboardViewSet().stats(request)

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.data["status"], "error")
        self.assertEqual(response.data["message"], "Request failed.")
        self.assertEqual(response.data["detail"], "stats exploded")
        self.assertEqual(response.data["results"], [])
        self.assertEqual(response.data["data"], {})
        self.assertEqual(response.data["count"], 0)

