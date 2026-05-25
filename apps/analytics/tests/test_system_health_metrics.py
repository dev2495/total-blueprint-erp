from django.test import TestCase

from apps.analytics.services import AnalyticsService


class SystemHealthMetricsTests(TestCase):
    def test_system_health_does_not_emit_synthetic_defaults(self):
        payload = AnalyticsService.get_system_health()

        self.assertEqual(payload["error_rate"], "0.00%")
        self.assertNotEqual(payload["version"], "v3.0.0-Premium")
        self.assertNotIn("System running normally. All services active.", [row.get("message") for row in payload["logs"]])
        self.assertGreaterEqual(payload["cpu_usage"], 0)
        self.assertGreaterEqual(payload["memory_usage"], 0)
        self.assertGreaterEqual(payload["disk_usage"], 0)
