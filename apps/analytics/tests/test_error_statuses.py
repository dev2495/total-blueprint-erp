from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from apps.analytics.views import AnalyticsViewSet


class AnalyticsErrorStatusTests(SimpleTestCase):
    def test_system_health_failure_returns_error_envelope(self):
        request = SimpleNamespace(query_params={}, data={}, user=SimpleNamespace())

        with patch("apps.analytics.views.AnalyticsService.get_system_health", side_effect=RuntimeError("health exploded")):
            response = AnalyticsViewSet().system_health(request)

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.data["status"], "error")
        self.assertEqual(response.data["message"], "Request failed.")
        self.assertEqual(response.data["code"], "ANALYTICS_HEALTH_FAILED")
        self.assertEqual(response.data["detail"], "Analytics request failed.")
        self.assertEqual(response.data["results"], [])
        self.assertEqual(response.data["data"], {})
        self.assertEqual(response.data["count"], 0)
