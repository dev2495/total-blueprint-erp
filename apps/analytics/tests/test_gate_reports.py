from datetime import date, datetime, timedelta, timezone as datetime_timezone
from types import SimpleNamespace
from io import BytesIO
from pypdf import PdfReader
from unittest.mock import patch
from decimal import Decimal
import uuid

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.analytics.models import ReportDistributionProfile, ReportDispatchRun
from apps.analytics.report_delivery import ReportDistributionService
from apps.analytics.services import ReportingService
from apps.factory.models import Plant
from apps.gate.models import GateAuditEvent, GoodsLine, GoodsMovement
from apps.users.models import Role, User


class GateReportsAuthorizationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = self._user("gate_owner", "OWNER")
        self.admin = self._user("gate_admin", "ADMIN")
        self.sales = self._user("gate_sales", "SALES")
        self.store = self._user("gate_store", "STORE")
        self.delegate = self._user("gate_delegate", "SALES", extras=["gate.reports"])
        self.plant = Plant.objects.create(name="Gate reports plant", code="GATE_REPORT")

    def _user(self, name, role_code, extras=None):
        role, _ = Role.objects.get_or_create(code=role_code, defaults={"name": role_code, "default_permissions": ["*"] if role_code in {"ADMIN", "OWNER"} else []})
        return User.objects.create_user(username=name, email=f"{name}@example.com", password="Gate-Access-2026!", role=role, extra_permissions=extras or [])

    def test_gate_report_denies_sales_store_and_admin_wildcard(self):
        for user in (self.sales, self.store, self.admin):
            self.client.force_authenticate(user=user)
            for path in ("/api/analytics/reports/gate/", "/api/analytics/reports/Gate/", "/api/analytics/reports/gate/export-pdf/"):
                with self.subTest(user=user.username, path=path):
                    self.assertEqual(self.client.get(path).status_code, 403)

    def test_gate_report_allows_owner_and_explicit_delegate(self):
        for user in (self.owner, self.delegate):
            self.client.force_authenticate(user=user)
            with patch("apps.gate.services.report_payload_for_period", return_value={"summary": {"goods_total": 2, "visitor_entries": 1}, "rows": []}) as report:
                response = self.client.get("/api/analytics/reports/gate/?date_from=2026-10-01&date_to=2026-10-07")
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual(response.data["summary"]["goods_total"], 2)
            report.assert_called_once_with(date(2026, 10, 1), date(2026, 10, 7), plant_ids=None)

    def test_catalog_exposes_gate_only_to_owner_or_delegate(self):
        for user, visible in ((self.owner, True), (self.delegate, True), (self.admin, False), (self.sales, False), (self.store, False)):
            catalog = ReportingService.get_report_catalog(user)
            self.assertEqual(any(row["id"] == "gate" for row in catalog), visible, user.username)

    def test_gate_daily_pack_is_owner_only_default_and_hidden_from_admin(self):
        ReportDistributionService.ensure_defaults()
        profile = ReportDistributionProfile.objects.get(report_code="gate_register_daily")
        self.assertEqual(profile.target_roles, ["OWNER"])
        self.client.force_authenticate(user=self.admin)
        response = self.client.get("/api/analytics/report-distributions/")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("gate_register_daily", [row["report_code"] for row in response.data["profiles"]])
        self.assertEqual(self.client.put("/api/analytics/report-distributions/", {"profiles": [{"report_code": "gate_register_daily", "active": False}]}, format="json").status_code, 403)
        self.assertEqual(self.client.post("/api/analytics/report-distributions/gate_register_daily/send/", {}, format="json").status_code, 403)

    def test_gate_archived_pdf_is_private_and_admin_cannot_read(self):
        profile, _ = ReportDistributionProfile.objects.get_or_create(report_code="gate_register_daily")
        run = ReportDispatchRun.objects.create(profile=profile, report_code="gate_register_daily", report_date=date(2026, 10, 7), pdf_file_name="gate-private.pdf", private_pdf_data=b"%PDF-private")
        self.client.force_authenticate(user=self.admin)
        self.assertEqual(self.client.get(f"/api/analytics/report-runs/{run.id}/preview-pdf/").status_code, 403)
        self.client.force_authenticate(user=self.owner)
        response = self.client.get(f"/api/analytics/report-runs/{run.id}/preview-pdf/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(b"".join(response.streaming_content), b"%PDF-private")
        self.assertEqual(response["Cache-Control"], "private, no-store")
        self.assertIsNone(ReportDistributionService.stored_pdf_path(run))
        self.assertEqual(ReportingService.get_audit_event_detail(f"report:{run.id}", include_gate=True)["event"]["source_id"], str(run.id))
        self.assertIn("error", ReportingService.get_audit_event_detail(f"report:{run.id}", include_gate=False))
        self.client.force_authenticate(user=self.delegate)
        response = self.client.get(f"/api/analytics/report-runs/{run.id}/preview-pdf/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(b"".join(response.streaming_content), b"%PDF-private")

    def test_gate_report_filter_validation_returns_400(self):
        self.client.force_authenticate(user=self.owner)
        for query in ("date_from=wrong", "date_from=2026-02-31", "plant=wrong", "date_from=2020-01-01&date_to=2026-10-07", "date_from=2026-10-07&date_to=2026-10-01"):
            with self.subTest(query=query):
                response = self.client.get(f"/api/analytics/reports/gate/?{query}")
                self.assertEqual(response.status_code, 400, response.content)

    def test_daily_gate_renderer_keeps_flattened_goods_and_neutralizes_csv_formulas(self):
        payload = {"summary": {"inward": 1, "outward": 0, "unmatched": 1, "discrepancies": 0}, "rows": [{"logged_at": "2026-10-07T10:00:00+05:30", "plant": self.plant.name, "direction": "INWARD", "invoice_number": "=INVOICE", "vehicle_number": "MH12AA1000", "party_name": "Example supplier", "product_name": "Polymer granules", "quantity": "1000.0000", "uom": "KG", "amount": "123000.00", "reconciliation_status": "UNMATCHED"}]}
        with patch("apps.gate.services.report_payload_for_period", return_value=payload):
            rendered = ReportDistributionService.render_report("gate_register_daily", date(2026, 10, 7))
        self.assertTrue(rendered.pdf.startswith(b"%PDF"))
        self.assertEqual(rendered.window_start.utcoffset(), timedelta(hours=5, minutes=30))
        self.assertEqual(rendered.window_start.date(), date(2026, 10, 7))
        csv_text = rendered.detail_attachments[0].content.decode("utf-8-sig")
        self.assertIn("'=INVOICE", csv_text)
        self.assertIn("Polymer granules,1000.0000,KG,123000.00", csv_text)
        self.assertNotIn("mobile", csv_text.lower())
        with self.assertRaises(ValueError):
            ReportDistributionService.persist_rendered_artifacts(rendered)

    def test_send_gate_pack_persists_private_bytes_without_public_media(self):
        profile, _ = ReportDistributionProfile.objects.get_or_create(report_code="gate_register_daily")
        payload = {"summary": {"inward": 0, "outward": 0}, "rows": []}
        with patch("apps.gate.services.report_payload_for_period", return_value=payload), patch("apps.analytics.report_delivery.ReportDistributionService.persist_rendered_artifacts") as public_storage, patch("apps.users.services.notification_service.NotificationService.emit_event") as notify:
            run = ReportDistributionService.send_profile(profile, report_date=date(2026, 10, 7), triggered_by=self.owner, triggered_manually=True)
        public_storage.assert_not_called()
        run.refresh_from_db()
        self.assertTrue(bytes(run.private_pdf_data).startswith(b"%PDF"))
        self.assertTrue(run.private_detail_data)
        self.assertEqual(notify.call_args.kwargs["event_key"], "gate.daily_pack_generated")
        with self.assertRaises(PermissionError):
            ReportDistributionService.send_profile(profile, triggered_by=self.admin, triggered_manually=True)

    def test_filtered_gate_pdf_includes_all_rows_across_pages_and_business_columns(self):
        from apps.analytics.pdf_exports import AnalyticsPDFExportService
        base = {"logged_at": "2026-10-07T10:00:00+05:30", "plant": "Gate reports plant", "direction": "INWARD", "vehicle_number": "MH12AA1000", "party_name": "Supplier with a long name that must wrap within its column", "quantity": "1000.0000", "uom": "KG", "amount": "123000.00", "reconciliation_status": "UNMATCHED"}
        rows = [{**base, "invoice_number": f"INV-{index:03d}", "product_name": f"Polymer granules batch {index:03d}"} for index in range(100)]
        with patch("apps.gate.services.report_payload_for_period", return_value={"summary": {"inward": 100}, "rows": rows}):
            rendered = AnalyticsPDFExportService.export_report_tab_pdf("gate", {"date_from": "2026-10-07", "date_to": "2026-10-07"})
        reader = PdfReader(BytesIO(rendered.content))
        self.assertGreater(len(reader.pages), 1)
        text = "\n".join(page.extract_text() for page in reader.pages)
        for token in ("INV-000", "INV-099", "batch 099", "1000.0000 KG", "123000.00", "MH12AA1000"):
            self.assertIn(token, text)
        self.assertGreater(text.count("Date / time"), 1)

    def test_gate_audit_stream_is_owner_only_and_tracks_actor(self):
        event = GateAuditEvent.objects.create(plant=self.plant, object_id=self.plant.id, object_type="GOODS", action="GOODS_LOGGED", actor=self.owner, after={"invoice_number": "GATE-7", "reconciliation_status": "UNMATCHED"})
        self.client.force_authenticate(user=self.admin)
        self.assertEqual(self.client.get(f"/api/analytics/audit-ledger/gate:{event.id}/").status_code, 403)
        response = self.client.get("/api/analytics/audit-ledger/?stream=gate&range=24h")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["events"], [])
        self.client.force_authenticate(user=self.owner)
        response = self.client.get("/api/analytics/audit-ledger/?stream=gate&range=24h")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data["events"][0]["id"], f"gate:{event.id}")
        self.assertEqual(response.data["events"][0]["actor"], self.owner.username)

    def test_owner_intelligence_gate_summary_hidden_from_admin(self):
        for user, visible in ((self.owner, True), (self.admin, False)):
            self.client.force_authenticate(user=user)
            with patch("apps.analytics.views.AnalyticsService.get_control_tower_stats", return_value={}), patch("apps.analytics.views._build_control_tower_trading_block", return_value={}), patch("apps.analytics.views._build_control_tower_procurement_block", return_value={}), patch("apps.gate.services.summary_for_period", return_value={"inside_visitors": 3}):
                response = self.client.get("/api/analytics/control-tower/?timeframe=day")
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual("gate" in response.data, visible)

    @override_settings(TIME_ZONE="UTC", GATE_TIME_ZONE="Asia/Kolkata")
    def test_default_gate_reports_use_business_day_at_utc_midnight_boundary(self):
        from apps.analytics.reports_service import ReportService
        instant = datetime(2026, 10, 6, 20, 0, tzinfo=datetime_timezone.utc)
        with patch("django.utils.timezone.now", return_value=instant), patch("apps.gate.services.report_payload_for_period", return_value={"summary": {}, "rows": []}) as report:
            ReportService.get_report_tab("gate")
        report.assert_called_once_with(date(2026, 9, 7), date(2026, 10, 7), plant_ids=None)
        with patch("django.utils.timezone.now", return_value=instant), patch("apps.gate.services.report_payload_for_period", return_value={"summary": {}, "rows": []}):
            rendered = ReportDistributionService.render_report("gate_register_daily")
        self.assertEqual(rendered.report_date, date(2026, 10, 6))

    def test_due_gate_pack_uses_gate_date_independently_of_other_pack_dates(self):
        from apps.analytics.tasks import dispatch_due_report_packs_task
        ReportDistributionProfile.objects.update_or_create(report_code="gate_register_daily", defaults={"active": True, "target_roles": ["OWNER"]})
        ReportDistributionProfile.objects.exclude(report_code="gate_register_daily").update(active=False)
        with patch("apps.analytics.tasks.ReportDistributionService.report_date_for_run", return_value=date(2026, 10, 5)), patch("apps.gate.services.gate_today", return_value=date(2026, 10, 7)), patch("apps.analytics.tasks.ReportDistributionService.send_profile", return_value=SimpleNamespace(status="SUCCEEDED")) as send:
            dispatch_due_report_packs_task.run()
        self.assertEqual(send.call_args.kwargs["report_date"], date(2026, 10, 6))

    @override_settings(TIME_ZONE="UTC", GATE_TIME_ZONE="Asia/Kolkata")
    def test_gate_audit_today_and_date_filters_use_local_midnight(self):
        now = datetime(2026, 10, 6, 20, 0, tzinfo=datetime_timezone.utc)
        inside = GateAuditEvent.objects.create(plant=self.plant, object_id=self.plant.id, object_type="GOODS", action="GOODS_LOGGED", actor=self.owner, created_at=datetime(2026, 10, 6, 19, 0, tzinfo=datetime_timezone.utc))
        outside = GateAuditEvent.objects.create(plant=self.plant, object_id=self.plant.id, object_type="GOODS", action="GOODS_LOGGED", actor=self.owner, created_at=datetime(2026, 10, 6, 18, 0, tzinfo=datetime_timezone.utc))
        for params in ({"stream": "gate", "range": "today"}, {"stream": "gate", "date_from": "2026-10-07", "date_to": "2026-10-07"}):
            with patch("django.utils.timezone.now", return_value=now):
                result = ReportingService.get_audit_ledger(params, include_gate=True)
            ids = [event["id"] for event in result["events"]]
            self.assertIn(f"gate:{inside.id}", ids)
            self.assertNotIn(f"gate:{outside.id}", ids)

    @override_settings(TIME_ZONE="UTC", GATE_TIME_ZONE="Asia/Kolkata")
    def test_gate_daily_series_counts_movements_at_local_boundaries_and_fills_quiet_days(self):
        from apps.analytics.reports_service import ReportService
        other = Plant.objects.create(name="Other plant", code="GATE_TREND_OTHER")

        def movement(index, timestamp, direction="INWARD", plant=None):
            return GoodsMovement.objects.create(
                plant=plant or self.plant, direction=direction, invoice_number=f"TREND-{index}", invoice_normalized=f"TREND-{index}",
                invoice_year=2026, vehicle_number="MH12AA1000", party_kind="VENDOR", party_id=uuid.uuid4(),
                party_name="Trend supplier", logged_at=timestamp, created_by=self.owner,
            )

        movement(0, datetime(2026, 10, 6, 18, 29, 59, tzinfo=datetime_timezone.utc))
        first = movement(1, datetime(2026, 10, 6, 18, 30, tzinfo=datetime_timezone.utc))
        movement(2, datetime(2026, 10, 7, 18, 29, 59, tzinfo=datetime_timezone.utc), "OUTWARD")
        movement(3, datetime(2026, 10, 7, 18, 30, tzinfo=datetime_timezone.utc))
        movement(4, datetime(2026, 10, 9, 18, 30, tzinfo=datetime_timezone.utc))
        movement(5, datetime(2026, 10, 7, 9, 0, tzinfo=datetime_timezone.utc), plant=other)
        for uom, quantity in (("KG", "10"), ("PCS", "5")):
            GoodsLine.objects.create(movement=first, product_kind="MATERIAL", product_id=uuid.uuid4(), product_name=f"Trend product {uom}", quantity=quantity, uom=uom)

        result = ReportService.get_report_tab("gate", {"date_from": "2026-10-07", "date_to": "2026-10-09", "plant": str(self.plant.id)})
        self.assertEqual(result["series"], [
            {"date": "2026-10-07", "inward": 1, "outward": 1, "total": 2},
            {"date": "2026-10-08", "inward": 1, "outward": 0, "total": 1},
            {"date": "2026-10-09", "inward": 0, "outward": 0, "total": 0},
        ])
        self.assertEqual(sum(row["total"] for row in result["series"]), result["summary"]["goods_total"])
        self.assertEqual(Decimal(result["summary"]["quantity_by_uom"]["KG"]), Decimal("10"))
        self.assertEqual(Decimal(result["summary"]["quantity_by_uom"]["PCS"]), Decimal("5"))
        self.assertNotIn("quantity", result["series"][0])
