"""A mutating request that ends with an error status commits nothing."""
from django.db import transaction
from django.test import TestCase, override_settings
from django.urls import path
from django.utils.decorators import method_decorator
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.test import APIClient, APIRequestFactory
from rest_framework.views import APIView

from apps.factory.models import Plant
from config.api_transactions import keep_request_writes


class _ProbeView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def _write(self, request):
        Plant.objects.create(code=str(request.data.get("code") or request.query_params.get("code")), name="Probe")

    def post(self, request):
        self._write(request)
        if request.data.get("keep"):
            keep_request_writes(request)
        return Response({"status": "x"}, status=int(request.data.get("reply", 400)))

    def get(self, request):
        self._write(request)
        return Response({"status": "x"}, status=400)


@method_decorator(transaction.non_atomic_requests, name="dispatch")
class _NonAtomicProbeView(_ProbeView):
    pass


urlpatterns = [
    path("probe/", _ProbeView.as_view()),
    path("probe-non-atomic/", _NonAtomicProbeView.as_view()),
]


@override_settings(ROOT_URLCONF="config.tests.test_api_transactions")
class FailedMutationRollbackTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_error_reply_rolls_back_writes(self):
        self.assertEqual(self.client.post("/probe/", {"code": "ROLLED"}, format="json").status_code, 400)
        self.assertFalse(Plant.objects.filter(code="ROLLED").exists())
        self.assertEqual(self.client.post("/probe/", {"code": "ROLLED-500", "reply": 500}, format="json").status_code, 500)
        self.assertFalse(Plant.objects.filter(code="ROLLED-500").exists())

    def test_success_reply_commits(self):
        self.assertEqual(self.client.post("/probe/", {"code": "KEPT-201", "reply": 201}, format="json").status_code, 201)
        self.assertTrue(Plant.objects.filter(code="KEPT-201").exists())

    def test_explicit_keep_after_external_boundary(self):
        self.assertEqual(self.client.post("/probe/", {"code": "KEPT-EVIDENCE", "keep": True, "reply": 502}, format="json").status_code, 502)
        self.assertTrue(Plant.objects.filter(code="KEPT-EVIDENCE").exists())

    def test_reads_and_non_atomic_views_are_untouched(self):
        self.client.get("/probe/", {"code": "GET-WRITE"})
        self.assertTrue(Plant.objects.filter(code="GET-WRITE").exists())
        self.client.post("/probe-non-atomic/", {"code": "NON-ATOMIC"}, format="json")
        self.assertTrue(Plant.objects.filter(code="NON-ATOMIC").exists())

    def test_direct_view_calls_are_not_affected(self):
        request = APIRequestFactory().post("/probe/", {"code": "DIRECT"}, format="json")
        self.assertEqual(_ProbeView.as_view()(request).status_code, 400)
        # Outside the request handler nothing marks the caller's transaction.
        self.assertTrue(Plant.objects.filter(code="DIRECT").exists())
