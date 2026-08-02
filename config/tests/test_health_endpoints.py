from unittest.mock import patch

from django.test import TestCase, override_settings


class HealthEndpointTests(TestCase):
    def test_live_endpoint(self):
        response = self.client.get("/api/health/live/")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body.get("status"), "ok")
        self.assertIn("timestamp", body)

    def test_live_endpoint_allows_head_probe(self):
        response = self.client.head("/api/health/live/")
        self.assertEqual(response.status_code, 200)

    def test_ready_endpoint_contract(self):
        response = self.client.get("/api/health/ready/")
        self.assertIn(response.status_code, (200, 503))
        body = response.json()
        self.assertIn(body.get("status"), ("ready", "degraded"))
        self.assertIn("checks", body)
        self.assertIn("database", body["checks"])
        self.assertIn("redis", body["checks"])
        self.assertIn("celery", body["checks"])
        self.assertIn("backup", body["checks"])

    def test_ready_endpoint_allows_head_probe(self):
        response = self.client.head("/api/health/ready/")
        self.assertIn(response.status_code, (200, 503))

    @override_settings(IS_PRODUCTION=True)
    @patch("apps.platformops.services.metrics_service.OpsMetricsService.summary")
    def test_production_public_readiness_hides_component_inventory(self, summary):
        summary.return_value = {"backups": {"fresh": True}}
        response = self.client.get("/api/health/ready/")

        self.assertIn(response.status_code, (200, 503))
        body = response.json()
        self.assertIn("status", body)
        self.assertNotIn("checks", body)
        self.assertNotIn("required_checks", body)
