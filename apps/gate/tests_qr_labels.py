"""QR gate stickers: GET /api/gate/qr/label.pdf (apps.gate.qr_labels)."""
import io
import uuid
from datetime import datetime, timedelta, timezone as dt_timezone
from decimal import Decimal

from PIL import Image, ImageChops
from django.test import TestCase, override_settings
from django.utils import timezone
from pypdf import PdfReader

from apps.inventory.models import DeliveryChallan as InterPlantChallan, JobWorkChallan, JobWorkOrder
from apps.production.models import DeliveryChallan
from apps.sales.models import Customer, CustomerDispatch, SalesOrder, TradeOrder
from apps.users.models import User

from .models import GatePass, GatePassLine
from .qr import parse_token, qr_png_bytes
from .qr_labels import LABEL_HEIGHT_MM, LABEL_WIDTH_MM
from .services import gate_today
from .tests import fixture
from .tests_outward import jwt, make_role, token_in

URL = "/api/gate/qr/label.pdf"
POINTS_PER_MM = 72 / 25.4


def pdf_text(content):
    return "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(content)).pages)


@override_settings(GATE_TIME_ZONE="Asia/Kolkata")
class QRLabelBase(TestCase):
    def setUp(self):
        self.owner, self.watchman, self.plant, self.other, _, self.vendor, self.material = fixture()
        self.store = User.objects.create_user(username="qrl-store", role=make_role("STORE"))
        self.dispatcher = User.objects.create_user(username="qrl-dispatch", role=make_role("DISPATCH"))
        self.engineer = User.objects.create_user(username="qrl-eng", role=make_role("ENGINEERING"))
        self.sales = User.objects.create_user(username="qrl-sales", role=make_role("SALES"))
        self.office = jwt(self.store)
        # 20:00 UTC on 9 Oct is 01:30 on 10 Oct in the factory (IST).
        self.dc = DeliveryChallan.objects.create(
            dc_no="DC-2627-0412", customer_name="Buyer One", plant=self.plant, status="DISPATCHED",
            dispatch_date=datetime(2026, 10, 9, 20, 0, tzinfo=dt_timezone.utc),
        )

    def label(self, kind, object_id, client=None, **params):
        return (client or self.office).get(URL, {"kind": kind, "id": str(object_id), **params})

    def assert_label(self, response, kind, object_id, pages=1):
        self.assertEqual(response.status_code, 200, getattr(response, "data", response.content[:300]))
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertTrue(response["Content-Disposition"].startswith('inline; filename="gate-qr-'))
        self.assertIn("no-store", response["Cache-Control"])
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")
        content = response.content
        self.assertTrue(content.startswith(b"%PDF"))
        reader = PdfReader(io.BytesIO(content))
        self.assertEqual(len(reader.pages), pages)
        for page in reader.pages:
            self.assertAlmostEqual(float(page.mediabox.width), LABEL_WIDTH_MM * POINTS_PER_MM, places=1)
            self.assertAlmostEqual(float(page.mediabox.height), LABEL_HEIGHT_MM * POINTS_PER_MM, places=1)
        token = token_in(content)
        self.assertEqual(parse_token(token), (kind, object_id), "the embedded token verifies and names this record")
        self.assertEqual(reader.metadata["/Keywords"], f"tpp-gate-qr {token}")
        # The printed QR is exactly the QR encoding of that verified token.
        images = reader.pages[0].images
        self.assertEqual(len(images), 1)
        printed = images[0].image.convert("L")
        expected = Image.open(io.BytesIO(qr_png_bytes(token, box_size=8))).convert("L")
        self.assertEqual(printed.size, expected.size)
        self.assertIsNone(ImageChops.difference(printed, expected).getbbox())
        return pdf_text(content)


class QRLabelContentTests(QRLabelBase):
    def test_sales_dc_sticker_carries_reference_party_factory_time_and_summary(self):
        text = self.assert_label(self.label("sales_dc", self.dc.id), "SALES_DC", self.dc.id)
        for expected in ["GATE PASS QR", "scan at gate", "Sales delivery challan", "DC-2627-0412", "Buyer One", "Date: 10 Oct 2026, 01:30 AM", "Plant: Factory one", "0 units"]:
            self.assertIn(expected, text)
        self.assertNotIn("Invoice", text, "sales challans have no invoice number")
        self.assertNotIn("DRAFT", text)

    def test_frontend_url_with_trailing_slash_and_pdf_accept_header(self):
        response = self.office.get(URL + "/", {"kind": "SALES_DC", "id": str(self.dc.id)}, HTTP_ACCEPT="application/pdf")
        self.assert_label(response, "SALES_DC", self.dc.id)
        self.assertEqual(response["Content-Disposition"], 'inline; filename="gate-qr-DC-2627-0412.pdf"')
        cancelled = DeliveryChallan.objects.create(dc_no="DC-CANC-2", customer_name="Buyer", plant=self.plant, status="CANCELLED")
        refused = self.office.get(URL + "/", {"kind": "SALES_DC", "id": str(cancelled.id)}, HTTP_ACCEPT="application/pdf")
        self.assertEqual(refused.status_code, 409, "errors still render as JSON for a PDF request")
        self.assertIn("cancelled", refused.json()["detail"])

    def test_copies_print_one_page_each(self):
        text = self.assert_label(self.label("SALES_DC", self.dc.id, copies="3"), "SALES_DC", self.dc.id, pages=3)
        self.assertIn("3/3", text)
        self.assertEqual(text.count("DC-2627-0412"), 3)
        for copies in ["0", "6", "x", "-1", "2.5", "\u00b2", "002"]:
            self.assertEqual(self.label("SALES_DC", self.dc.id, copies=copies).status_code, 400, copies)

    def test_draft_dc_prints_with_a_warning_and_cancelled_dc_is_refused(self):
        draft = DeliveryChallan.objects.create(dc_no="DC-DRAFT-7", customer_name="Buyer", plant=self.plant, status="DRAFT")
        text = self.assert_label(self.label("SALES_DC", draft.id), "SALES_DC", draft.id)
        self.assertIn("DRAFT – not dispatched", text)
        cancelled = DeliveryChallan.objects.create(dc_no="DC-CANC-1", customer_name="Buyer", plant=self.plant, status="CANCELLED")
        refused = self.label("SALES_DC", cancelled.id)
        self.assertEqual(refused.status_code, 409)
        self.assertIn("DC-CANC-1 is cancelled", str(refused.data["detail"]))

    def test_customer_dispatch_and_trade_order_show_invoice_but_never_prices(self):
        customer = Customer.objects.create(code="QRL-C1", name="Invoice Buyer")
        order = SalesOrder.objects.create(order_number="QRL-SO", customer=customer, customer_name=customer.name)
        dispatch = CustomerDispatch.objects.create(code="QRL-CD", sales_order=order, customer=customer, plant=self.plant, invoice_no="TALLY-0042", status="CONFIRMED")
        text = self.assert_label(self.label("CUSTOMER_DISPATCH", dispatch.id), "CUSTOMER_DISPATCH", dispatch.id)
        for expected in ["Customer dispatch", "QRL-CD", "Invoice Buyer", "Invoice: TALLY-0042", "0 lines"]:
            self.assertIn(expected, text)
        trade = TradeOrder.objects.create(
            code="QRL-TO", customer=customer, plant=self.plant, status="DISPATCHED", invoice_no="TALLY-0099",
            dispatched_at=timezone.now(), subtotal=Decimal("83700.25"), gst_total=Decimal("15066.05"), grand_total=Decimal("98766.30"),
        )
        trade.items.create(line_no=1, item_type="INVENTORY_MATERIAL", inventory_material=self.material, qty=Decimal("12.5"), uom="KG", rate=Decimal("6696.02"), line_total=Decimal("98766.30"))
        text = self.assert_label(self.label("TRADE_ORDER", trade.id), "TRADE_ORDER", trade.id)
        for expected in ["Trade order", "QRL-TO", "Invoice: TALLY-0099", "1 line", "12.5 KG"]:
            self.assertIn(expected, text)
        for price in ["98766", "98,766", "6696", "83700", "15066", "₹", "Rs", "Rate", "Amount", "Total"]:
            self.assertNotIn(price, text, price)
        no_plant = CustomerDispatch.objects.create(code="QRL-CD2", sales_order=order, customer=customer, invoice_no="X", status="CONFIRMED")
        refused = self.label("CUSTOMER_DISPATCH", no_plant.id)
        self.assertEqual(refused.status_code, 409)
        self.assertIn("no factory recorded", str(refused.data["detail"]))
        cancelled = TradeOrder.objects.create(code="QRL-TO2", customer=customer, plant=self.plant, status="CANCELLED")
        self.assertEqual(self.label("TRADE_ORDER", cancelled.id).status_code, 409)

    def test_interplant_gate_pass_and_job_work_challans(self):
        challan = InterPlantChallan.objects.create(from_plant=self.plant, to_plant=self.other, dc_no="IP-2627-0008", status="APPROVED")
        text = self.assert_label(self.label("INTERPLANT_DC", challan.id), "INTERPLANT_DC", challan.id)
        self.assertIn("IP-2627-0008", text)
        self.assertIn("To Factory two", text)

        gate_pass = GatePass.objects.create(
            number="RGP-QRL-0001", kind="RETURNABLE", plant=self.plant, vendor=self.vendor, party_name=self.vendor.name, purpose="REPAIR",
            expected_return_date=gate_today() + timedelta(days=5), status="ISSUED", issued_at=timezone.now(), issued_by=self.owner, created_by=self.owner,
        )
        GatePassLine.objects.create(gate_pass=gate_pass, line_no=1, description="Printing roller", quantity=2, uom="NOS")
        text = self.assert_label(self.label("GATE_PASS", gate_pass.id), "GATE_PASS", gate_pass.id)
        for expected in ["Gate pass (RGP)", "RGP-QRL-0001", "Supplier one", "RGP · 1 item"]:
            self.assertIn(expected, text)
        draft = GatePass.objects.create(number=f"DRAFT-{uuid.uuid4().hex[:8]}", kind="NON_RETURNABLE", plant=self.plant, party_name="Scrap buyer", purpose="SCRAP_SALE", status="DRAFT", created_by=self.owner)
        refused = self.label("GATE_PASS", draft.id)
        self.assertEqual(refused.status_code, 409)
        self.assertIn("still a draft", str(refused.data["detail"]))

        order = JobWorkOrder.objects.create(number="JWO-QRL-1", plant=self.plant, vendor=self.vendor, vendor_name=self.vendor.name, status="SENT")
        jw = JobWorkChallan.objects.create(number="JWC-QRL-1", order=order, plant=self.plant, vendor=self.vendor, purpose="Printing")
        text = self.assert_label(self.label("JOBWORK_CHALLAN", jw.id), "JOBWORK_CHALLAN", jw.id)
        self.assertIn("JWC-QRL-1", text)
        self.assertIn("Supplier one", text)
        JobWorkOrder.objects.filter(id=order.id).update(status="CANCELLED")
        refused = self.label("JOBWORK_CHALLAN", jw.id)
        self.assertEqual(refused.status_code, 409)
        self.assertIn("cancelled", str(refused.data["detail"]))

    def test_request_validation_and_missing_record(self):
        self.assertEqual(self.office.get(URL, {"kind": "NOPE", "id": str(self.dc.id)}).status_code, 400)
        self.assertEqual(self.office.get(URL, {"kind": "OTHER", "id": str(self.dc.id)}).status_code, 400)
        self.assertEqual(self.office.get(URL, {"kind": "SALES_DC"}).status_code, 400)
        self.assertEqual(self.office.get(URL, {"kind": "SALES_DC", "id": "not-a-uuid"}).status_code, 400)
        missing = self.office.get(URL, {"kind": "SALES_DC", "id": str(uuid.uuid4())})
        self.assertEqual(missing.status_code, 404)
        self.assertIn("not in the ERP", str(missing.data["detail"]))
        wrong_kind = self.office.get(URL, {"kind": "TRADE_ORDER", "id": str(self.dc.id)})
        self.assertEqual(wrong_kind.status_code, 404, "a token is only minted for an existing record of that kind")


class QRLabelPermissionTests(QRLabelBase):
    def matrix(self):
        documents_only = User.objects.create_user(username="qrl-docs", role=make_role("ENGINEERING"), extra_permissions=["documents.view"])
        wildcard = User.objects.create_user(username="qrl-star", role=make_role("ENGINEERING"), extra_permissions=["*"])
        return [
            (self.owner, 200), (self.store, 200), (self.dispatcher, 200), (documents_only, 200),
            (self.engineer, 403), (self.sales, 403), (wildcard, 403), (self.watchman, 403),
        ]

    def check_matrix(self):
        for user, expected in self.matrix():
            response = self.label("SALES_DC", self.dc.id, client=jwt(user))
            self.assertEqual(response.status_code, expected, user.username)
            if expected == 403:
                self.assertNotIn(b"%PDF", response.content[:8])

    def test_permission_matrix(self):
        self.check_matrix()

    @override_settings(STRICT_RBAC=True)
    def test_strict_rbac_keeps_the_same_matrix(self):
        self.check_matrix()

    def test_watchman_refused_even_for_missing_or_cancelled_records(self):
        gate = jwt(self.watchman)
        self.assertEqual(gate.get(URL, {"kind": "SALES_DC", "id": str(uuid.uuid4())}).status_code, 403)
        self.assertEqual(gate.get(URL, {"kind": "NOPE", "id": "x"}).status_code, 403)
