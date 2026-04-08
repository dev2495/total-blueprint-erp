from django.test import RequestFactory, SimpleTestCase

from config.local_dev_csrf import LocalDevCsrfViewMiddleware


class LocalDevCsrfMiddlewareTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.middleware = LocalDevCsrfViewMiddleware(lambda request: None)

    def test_private_lan_origin_is_accepted_for_private_host(self):
        request = self.factory.post(
            "/api/users/login/",
            HTTP_HOST="192.168.0.133:8000",
            HTTP_ORIGIN="http://192.168.0.133:3000",
        )
        self.assertTrue(self.middleware._origin_verified(request))

    def test_public_origin_is_not_accepted(self):
        request = self.factory.post(
            "/api/users/login/",
            HTTP_HOST="192.168.0.133:8000",
            HTTP_ORIGIN="https://evil.example.com",
        )
        self.assertFalse(self.middleware._origin_verified(request))
