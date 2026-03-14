from django.test import SimpleTestCase
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIRequestFactory

from config.views import custom_exception_handler


class ErrorContractTests(SimpleTestCase):
    def setUp(self):
        self.factory = APIRequestFactory()

    def test_internal_errors_are_sanitized(self):
        request = self.factory.get("/api/test/")
        request.request_id = "req-test-1"
        response = custom_exception_handler(RuntimeError("secret-stack-leak"), {"request": request})

        self.assertIsNotNone(response)
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.data.get("code"), "INTERNAL_ERROR")
        self.assertEqual(response.data.get("detail"), "Internal server error.")
        self.assertEqual(response.data.get("request_id"), "req-test-1")
        self.assertNotIn("secret-stack-leak", str(response.data))

    def test_validation_error_uses_stable_envelope(self):
        request = self.factory.post("/api/test/", {"field": "bad"}, format="json")
        request.request_id = "req-test-2"
        response = custom_exception_handler(ValidationError({"field": ["invalid"]}), {"request": request})

        self.assertIsNotNone(response)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data.get("code"), "BAD_REQUEST")
        self.assertIn("detail", response.data)
        self.assertEqual(response.data.get("request_id"), "req-test-2")
