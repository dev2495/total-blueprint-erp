from django.http import HttpResponse
from django.test import RequestFactory, SimpleTestCase

from config.api_slash_middleware import ApiSlashCompatMiddleware


class ApiSlashCompatMiddlewareTests(SimpleTestCase):
    def setUp(self):
        self.rf = RequestFactory()

        def _ok_response(_request):
            return HttpResponse("ok")

        self.middleware = ApiSlashCompatMiddleware(_ok_response)

    def test_rewrites_known_api_route_without_slash(self):
        # DRF defines this as `/api/production/wc/<id>/queue/`.
        req = self.rf.get("/api/production/wc/TEST/queue")
        self.middleware(req)
        self.assertEqual(req.path_info, "/api/production/wc/TEST/queue/")

    def test_rewrites_health_without_slash(self):
        # config.urls defines `/api/health/` only.
        req = self.rf.get("/api/health")
        self.middleware(req)
        self.assertEqual(req.path_info, "/api/health/")

    def test_unknown_api_path_is_unchanged(self):
        req = self.rf.get("/api/does-not-exist")
        self.middleware(req)
        self.assertEqual(req.path_info, "/api/does-not-exist")

    def test_users_me_without_slash_resolves(self):
        # DRF often defines this as `/api/users/me/`.
        req = self.rf.get("/api/users/me")
        self.middleware(req)
        # It should rewrite to include the slash if that's what resolves.
        # We'll assume for this test that `/api/users/me/` is the canonical DRF route.
        self.assertEqual(req.path_info, "/api/users/me/")

    def test_users_me_with_slash_stays(self):
        req = self.rf.get("/api/users/me/")
        self.middleware(req)
        self.assertEqual(req.path_info, "/api/users/me/")
