from datetime import date, datetime, timezone as datetime_timezone
from io import BytesIO
import uuid

from django.test import TestCase, override_settings
from pypdf import PdfReader
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.analytics.gate_bill_reporting import daily_series, summary_for_period
from apps.analytics.models import ReportDistributionProfile
from apps.analytics.report_delivery import ReportDistributionService
from apps.factory.models import Plant
from apps.gate.models import GateAuditEvent, InwardBillIntake
from apps.users.models import Role, User


@override_settings(TIME_ZONE="UTC", GATE_TIME_ZONE="Asia/Kolkata", STRICT_RBAC=True)
class GateBillReportTests(TestCase):
    def setUp(self):
        self.plant = Plant.objects.create(code="BILL-REPORT-A", name="Bill report plant")
        self.other = Plant.objects.create(code="BILL-REPORT-B", name="Other bill report plant")
        master, _ = Role.objects.get_or_create(code="ADMIN", defaults={"name": "Admin"})
        self.admin = User.objects.create_user(username="bill-report-admin", role=master)
        role = Role.objects.create(code="BILL_REPORT_READER", name="Bill report reader")
        self.delegate = User.objects.create_user(username="bill-report-delegate", role=role, extra_permissions=["gate.reports"])
        self.start = date(2026, 10, 8)
        self.end = date(2026, 10, 10)

    def bill(self, timestamp, plant=None, status="PENDING_GRN", **kwargs):
        return InwardBillIntake.objects.create(plant=plant or self.plant, created_by=self.admin, arrival_at=timestamp, status=status, content_hash=uuid.uuid4().hex, review_data={"invoice_number": "SECRET-INVOICE", "notes": "SECRET-NOTES"}, **kwargs)

    @staticmethod
    def client_for(user):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
        return client

    def test_local_day_boundary_partial_backlog_resolution_and_scope(self):
        old = self.bill(datetime(2026, 10, 7, 18, 29, 59, tzinfo=datetime_timezone.utc))
        self.bill(datetime(2026, 10, 7, 18, 30, tzinfo=datetime_timezone.utc), status="PARTIAL_GRN")
        self.bill(datetime(2026, 10, 8, 18, 30, tzinfo=datetime_timezone.utc), status="RECEIPTED", resolved_at=datetime(2026, 10, 9, 18, 30, tzinfo=datetime_timezone.utc))
        self.bill(datetime(2026, 10, 8, 8, tzinfo=datetime_timezone.utc), plant=self.other)
        self.bill(datetime(2026, 10, 10, 18, 30, tzinfo=datetime_timezone.utc), status="VOID", resolved_at=datetime(2026, 10, 10, 18, 30, tzinfo=datetime_timezone.utc))
        summary = summary_for_period(self.start, self.end, [self.plant.pk])
        self.assertEqual(summary["bill_arrivals"], 2)
        self.assertEqual(summary["bill_received"], 1)
        self.assertEqual(summary["bill_voided"], 0)
        self.assertEqual(summary["bill_pending_grn"], 2)
        self.assertEqual(summary["bill_partial_grn"], 1)
        self.assertEqual(summary["bill_pending_oldest_arrival_at"], old.arrival_at.isoformat())
        self.assertEqual(daily_series(self.start, self.end, self.plant.pk), [
            {"date": "2026-10-08", "bill_arrivals": 1, "bill_received": 0, "bill_voided": 0},
            {"date": "2026-10-09", "bill_arrivals": 1, "bill_received": 0, "bill_voided": 0},
            {"date": "2026-10-10", "bill_arrivals": 0, "bill_received": 1, "bill_voided": 0},
        ])

    def test_delegate_report_and_pdf_have_aggregate_bills_without_private_contents(self):
        bill = self.bill(datetime(2026, 10, 8, 6, tzinfo=datetime_timezone.utc), status="PARTIAL_GRN")
        response = self.client_for(self.delegate).get(f"/api/analytics/reports/gate/?date_from=2026-10-08&date_to=2026-10-08&plant={self.plant.pk}")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data["summary"]["bill_arrivals"], 1)
        self.assertEqual(response.data["summary"]["bill_pending_grn"], 1)
        self.assertEqual(response.data["summary"]["goods_total"], 0)
        self.assertEqual(response.data["bill_series"][0]["bill_arrivals"], 1)
        for secret in ("SECRET-INVOICE", "SECRET-NOTES", str(bill.pk), "image_url", "pages"):
            self.assertNotIn(secret, str(response.data))
        rendered = ReportDistributionService.render_report("gate_register_daily", self.start)
        text = " ".join(page.extract_text() for page in PdfReader(BytesIO(rendered.pdf)).pages)
        self.assertIn("Bill arrivals 1", text)
        self.assertIn("Partially received now 1", text)
        self.assertNotIn("SECRET-INVOICE", text)
        self.assertNotIn("SECRET-NOTES", text)
        self.assertNotIn(str(bill.pk), text)

    def test_bill_event_flows_to_master_audit_and_delegate_denied(self):
        bill = self.bill(datetime(2026, 10, 8, 6, tzinfo=datetime_timezone.utc))
        event = GateAuditEvent.objects.create(plant=self.plant, object_id=bill.pk, object_type="BILL", action="BILL_ARRIVED", actor=self.admin, after={"status": "PENDING_GRN", "page_count": 1})
        response = self.client_for(self.admin).get("/api/analytics/audit-ledger/?stream=gate")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIn(f"gate:{event.pk}", str(response.data))
        self.assertEqual(self.client_for(self.delegate).get(f"/api/analytics/audit-ledger/gate:{event.pk}/").status_code, 403)
