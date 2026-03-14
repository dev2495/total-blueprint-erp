from django.test import TestCase


class HealthEndpointTests(TestCase):
    def test_live_endpoint(self):
        response = self.client.get("/api/health/live/")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body.get("status"), "ok")
        self.assertIn("timestamp", body)

    def test_ready_endpoint_contract(self):
        response = self.client.get("/api/health/ready/")
        self.assertIn(response.status_code, (200, 503))
        body = response.json()
        self.assertIn(body.get("status"), ("ready", "degraded"))
        self.assertIn("checks", body)
        self.assertIn("database", body["checks"])
        self.assertIn("redis", body["checks"])
        self.assertIn("celery", body["checks"])
