from types import SimpleNamespace

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from apps.analytics.services import AnalyticsService, ReportingService
from apps.analytics.views import AnalyticsViewSet
from apps.factory.models import Machine, Plant, WorkCenter
from apps.users.models import Role, User


class WcmDashboardScopeAndPerformanceTests(TestCase):
    def setUp(self):
        plant = Plant.objects.create(name="Main Plant", code="WCM-MAIN")
        self.wc_a = WorkCenter.objects.create(name="Printing", code="WCM-PRINT", plant=plant)
        self.wc_b = WorkCenter.objects.create(name="Lamination", code="WCM-LAM", plant=plant)
        Machine.objects.create(work_center=self.wc_a, name="Printer 1", code="P1", standard_rate_kg_per_hour=100)
        Machine.objects.create(work_center=self.wc_b, name="Laminator 1", code="L1", standard_rate_kg_per_hour=100)

    def test_wc_grid_is_batched_instead_of_querying_once_per_machine(self):
        with CaptureQueriesContext(connection) as captured:
            rows = ReportingService.get_wc_performance()

        self.assertEqual(len(rows), 2)
        self.assertLessEqual(len(captured), 6)
        self.assertEqual({row["work_center"]["code"] for row in rows}, {"WCM-PRINT", "WCM-LAM"})

    def test_explicit_empty_scope_never_falls_through_to_all_work_centers(self):
        self.assertEqual(ReportingService.get_wc_performance(work_center_ids=[]), [])

        payload = AnalyticsService.get_wcm_dashboard_stats(work_center_ids=[])
        self.assertEqual(payload["hero"]["active_work_centers"], 0)
        self.assertEqual(payload["work_centers"], [])
        self.assertEqual(payload["machine_clusters"][0]["count"], 0)

    def test_unassigned_wcm_api_responses_do_not_disclose_other_centers(self):
        role = Role.objects.create(code="WORK_CENTER_MANAGER", name="Work Center Manager")
        user = User.objects.create_user(username="unassigned-wcm", password="test-password", role=role)
        user.effective_role_code = "WORK_CENTER_MANAGER"
        request = SimpleNamespace(user=user, query_params={})

        wc_response = AnalyticsViewSet().wc_performance(request)
        dashboard_response = AnalyticsViewSet().wcm_dashboard(request)

        self.assertEqual(wc_response.status_code, 200)
        self.assertEqual(wc_response.data, [])
        self.assertEqual(dashboard_response.status_code, 200)
        self.assertEqual(dashboard_response.data["hero"]["active_work_centers"], 0)
        self.assertEqual(dashboard_response.data["work_centers"], [])
