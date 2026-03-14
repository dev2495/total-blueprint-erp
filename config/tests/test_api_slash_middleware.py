from django.test import SimpleTestCase
from django.test.client import RequestFactory
from django.urls import resolve
from django.urls.exceptions import Resolver404

from config.api_slash_middleware import ApiSlashCompatMiddleware


class ApiSlashMiddlewareTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.middleware = ApiSlashCompatMiddleware(lambda req: req)

    def _resolves(self, path: str) -> bool:
        try:
            resolve(path)
            return True
        except Resolver404:
            return False

    def test_api_me_without_slash_resolves(self):
        """
        /api/users/me should resolve even without trailing slash.
        """
        req = self.factory.get("/api/users/me")
        resp = self.middleware(req)
        self.assertTrue(self._resolves(resp.path_info))

    def test_api_me_with_slash_resolves(self):
        """
        /api/users/me/ should also resolve.
        """
        req = self.factory.get("/api/users/me/")
        resp = self.middleware(req)
        self.assertTrue(self._resolves(resp.path_info))

    def test_health_both_forms_resolve(self):
        req = self.factory.get("/api/health")
        resp = self.middleware(req)
        self.assertTrue(self._resolves(resp.path_info))

        req = self.factory.get("/api/health/")
        resp = self.middleware(req)
        self.assertTrue(self._resolves(resp.path_info))

