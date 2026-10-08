from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.users.models import Role, User


@override_settings(STRICT_RBAC=True)
class AnalyticsAccessTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.users = {}
        for code in ("OWNER", "ADMIN", "SALES", "PLANNER", "WORK_CENTER_MANAGER", "ENGINEERING", "STORE", "DISPATCH", "PLANT_MANAGER", "GUEST", "WATCHMAN"):
            role, _ = Role.objects.get_or_create(code=code, defaults={"name": code})
            self.users[code] = User.objects.create(username=f"access_{code}", role=role)

    def test_company_financial_reads_follow_entitlements_for_every_role(self):
        allowed = {"OWNER", "ADMIN", "SALES", "PLANNER", "WORK_CENTER_MANAGER", "PLANT_MANAGER"}
        paths = ("/api/analytics/reports/costing", "/api/analytics/reports/Costing/", "/api/analytics/reports/costing/export-pdf/", "/api/analytics/control-tower/")
        for code, user in self.users.items():
            self.client.force_authenticate(user)
            for path in paths:
                with self.subTest(role=code, path=path), patch("apps.analytics.views.ReportService.get_report_tab", return_value={}), patch("apps.analytics.views.AnalyticsPDFExportService.export_report_tab_pdf", return_value=SimpleNamespace(content=b"pdf", file_name="report.pdf")), patch("apps.analytics.views.AnalyticsService.get_control_tower_stats", return_value={}), patch("apps.analytics.views._build_control_tower_trading_block", return_value={}), patch("apps.analytics.views._build_control_tower_procurement_block", return_value={}), patch("apps.gate.services.summary_for_period", return_value={}):
                    self.assertEqual(self.client.get(path).status_code, 200 if code in allowed else 403)

    def test_shared_department_dashboard_and_report_consumers_remain_allowed(self):
        scenarios = [
            ("STORE", "/api/analytics/reports/inventory"),
            ("STORE", "/api/analytics/reports/inventory-lineage/"),
            ("DISPATCH", "/api/analytics/reports/interplant/"),
            ("DISPATCH", "/api/analytics/reports/dispatch"),
            ("ENGINEERING", "/api/analytics/factory-summary/"),
            ("ENGINEERING", "/api/analytics/kpis/"),
            ("ENGINEERING", "/api/analytics/scrap-analysis/"),
            ("ENGINEERING", "/api/analytics/downtime-analysis/"),
            ("SALES", "/api/analytics/order-tracking/?order_id=test"),
            ("PLANNER", "/api/analytics/planner-dashboard/"),
            ("WORK_CENTER_MANAGER", "/api/analytics/wcm-dashboard/"),
        ]
        with patch("apps.analytics.views.ReportService.get_report_tab", return_value={}), patch("apps.analytics.views.FactoryOverviewService.get_summary", return_value={}), patch("apps.analytics.views.KPIService.get_real_metrics", return_value={}), patch("apps.analytics.views.ReportingService.get_scrap_analysis", return_value={}), patch("apps.analytics.views.ReportingService.get_downtime_analysis", return_value={}), patch("apps.analytics.views.AnalyticsService.get_order_tracking", return_value={}), patch("apps.analytics.views.AnalyticsService.get_planner_dashboard_stats", return_value={}), patch("apps.analytics.views.AnalyticsService.get_wcm_dashboard_stats", return_value={}):
            for code, path in scenarios:
                with self.subTest(role=code, path=path):
                    self.client.force_authenticate(self.users[code])
                    self.assertEqual(self.client.get(path).status_code, 200)

    def test_explicit_report_page_grant_does_not_open_other_report_tabs(self):
        user = self.users["GUEST"]
        user.extra_permissions = ["page.analytics.reports_costing.view"]
        user.save(update_fields=["extra_permissions"])
        self.client.force_authenticate(user)
        with patch("apps.analytics.views.ReportService.get_report_tab", return_value={}):
            self.assertEqual(self.client.get("/api/analytics/reports/costing").status_code, 200)
            self.assertEqual(self.client.get("/api/analytics/reports/trading").status_code, 403)

    def test_explicit_analytics_grant_preserves_custom_role_access_except_gate(self):
        user = self.users["GUEST"]
        user.extra_permissions = ["analytics.view"]
        user.save(update_fields=["extra_permissions"])
        self.client.force_authenticate(user)
        with patch("apps.analytics.views.ReportService.get_report_tab", return_value={}):
            self.assertEqual(self.client.get("/api/analytics/reports/costing").status_code, 200)
            self.assertEqual(self.client.get("/api/analytics/reports/trading").status_code, 200)
            self.assertEqual(self.client.get("/api/analytics/reports/gate/").status_code, 403)

    def test_gate_only_delegate_reads_gate_artifacts_but_not_financial_data(self):
        user = self.users["GUEST"]
        user.extra_permissions = ["gate.reports"]
        user.save(update_fields=["extra_permissions"])
        self.client.force_authenticate(user)
        with patch("apps.analytics.views.ReportService.get_report_tab", return_value={}):
            self.assertEqual(self.client.get("/api/analytics/reports/gate/").status_code, 200)
            self.assertEqual(self.client.get("/api/analytics/reports/costing").status_code, 403)
        gate_run = SimpleNamespace(report_code="gate_register_daily", private_pdf_data=b"pdf", pdf_file_name="gate.pdf")
        with patch("apps.analytics.views.ReportDistributionService.get_run", return_value=gate_run):
            self.assertEqual(self.client.get("/api/analytics/report-runs/test/preview-pdf/").status_code, 200)
        other_run = SimpleNamespace(report_code="stock_standing_daily")
        with patch("apps.analytics.views.ReportDistributionService.get_run", return_value=other_run):
            self.assertEqual(self.client.get("/api/analytics/report-runs/test/preview-pdf/").status_code, 403)

    def test_watchman_stale_flags_and_unknown_actions_cannot_open_analytics(self):
        watchman = self.users["WATCHMAN"]
        watchman.is_owner = watchman.is_superuser = True
        watchman.extra_permissions = ["*", "gate.reports", "analytics.view"]
        watchman.save()
        self.client.force_authenticate(watchman)
        self.assertEqual(self.client.get("/api/analytics/reports/gate/").status_code, 403)
        from apps.analytics.permissions import AnalyticsAccessPermission
        self.assertFalse(AnalyticsAccessPermission().has_permission(SimpleNamespace(user=self.users["SALES"]), SimpleNamespace(action="future_action")))
