import io
import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from decimal import Decimal
from unittest.mock import patch
from zoneinfo import ZoneInfo

from cryptography.fernet import Fernet
from PIL import Image
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import DatabaseError, close_old_connections, connection, connections, transaction
from django.test import TestCase, TransactionTestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APIClient

from apps.factory.models import Plant
from apps.inventory.models import Vendor
from apps.materials.models import ConsumableMaterial, InventoryMaterial, ProductMaster, TradingGood
from apps.procurement.models import PurchaseOrder, PurchaseOrderItem, PurchaseOrderReceipt, PurchaseOrderReceiptLine
from apps.production.models import DeliveryChallan, DeliveryChallanItem
from apps.sales.models import Customer, CustomerDispatch, CustomerDispatchLine, SalesOrder, SalesOrderItem, TradeOrder, TradeOrderItem
from apps.templates.models import TemplateBlueprint
from apps.users.models import Role, User
from .models import GateAssignment, GateAuditEvent, GatePublicLink, GatePublicRateBucket, GateRequestReceipt, GoodsMovement, VisitorVisit
from .services import Conflict, create_goods, create_visitor, date_bounds, gate_today, transition_visitor


def fixture():
    owner_role, _ = Role.objects.get_or_create(code="OWNER", defaults={"name": "Owner"})
    watch_role, _ = Role.objects.get_or_create(code="WATCHMAN", defaults={"name": "Watchman"})
    owner = User.objects.create_user(username="gate-owner", role=owner_role, is_owner=True)
    watchman = User.objects.create_user(username="gate-watch", role=watch_role, extra_permissions=["*", "gate.reports", "gate.view"])
    plant = Plant.objects.create(code="GATE-P1", name="Factory one")
    other = Plant.objects.create(code="GATE-P2", name="Factory two")
    GateAssignment.objects.create(user=watchman, plant=plant)
    link, _ = GatePublicLink.objects.get_or_create(plant=plant)
    vendor = Vendor.objects.create(code="GATE-V1", name="Supplier one")
    material = InventoryMaterial.objects.create(code="GATE-RM1", name="Granules", category="GRANULE", base_uom="KG")
    return owner, watchman, plant, other, link, vendor, material


class GateAPITests(TransactionTestCase):
    def setUp(self):
        self.owner, self.watchman, self.plant, self.other, self.link, self.vendor, self.material = fixture()
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        self.public = APIClient()

    def goods_data(self, **changes):
        data = {"client_token": str(uuid.uuid4()), "plant": str(self.plant.id), "direction": "INWARD", "invoice_number": "INV-100", "vehicle_number": "DD03U9802", "party_kind": "VENDOR", "party_id": str(self.vendor.id), "lines": [{"product_kind": "MATERIAL", "product_id": str(self.material.id), "quantity": "25.0000", "uom": "KG", "amount": "100.00"}]}
        data.update(changes)
        return data

    def visitor_data(self, **changes):
        data = {"client_token": str(uuid.uuid4()), "gate_token": str(self.link.token), "name": "A Visitor", "mobile": "9876543210", "purpose": "Meeting", "company": "Test company", "consent": True}
        data.update(changes)
        return data

    def registered(self, **changes):
        data = self.visitor_data(**changes)
        result = self.public.post("/api/gate/public/visitors/", data, format="json")
        self.assertEqual(result.status_code, 201, result.data)
        return VisitorVisit.objects.get(id=result.data["receipt_id"])

    def test_scope_denies_unassigned_plant_and_empty_gate(self):
        self.client.force_authenticate(self.watchman)
        response = self.client.post("/api/gate/goods/", self.goods_data(plant=str(self.other.id)), format="json")
        self.assertEqual(response.status_code, 403)
        GateAssignment.objects.filter(user=self.watchman).delete()
        self.assertEqual(self.client.get("/api/gate/masters/").status_code, 403)

    def test_goods_retries_conflicting_tokens_and_invoice_duplicate(self):
        data = self.goods_data()
        first = self.client.post("/api/gate/goods/", data, format="json")
        self.assertEqual(first.status_code, 201, first.data)
        again = self.client.post("/api/gate/goods/", data, format="json")
        self.assertTrue(again.data["replayed"])
        self.assertEqual(first.data["id"], again.data["id"])
        data["vehicle_number"] = "CHANGED"
        self.assertEqual(self.client.post("/api/gate/goods/", data, format="json").status_code, 409)
        duplicate = self.goods_data(invoice_number="  inv-100  ")
        self.assertEqual(self.client.post("/api/gate/goods/", duplicate, format="json").status_code, 409)
        self.assertEqual(GoodsMovement.objects.count(), 1)
        self.assertEqual(GateAuditEvent.objects.count(), 1)

    def test_numeric_and_active_master_validation(self):
        for value in ["-1", "0", "NaN", "Infinity"]:
            data = self.goods_data()
            data["lines"][0]["quantity"] = value
            self.assertEqual(self.client.post("/api/gate/goods/", data, format="json").status_code, 400)
        self.material.status = "INACTIVE"
        self.material.save()
        self.assertEqual(self.client.post("/api/gate/goods/", self.goods_data(), format="json").status_code, 400)
        self.assertFalse(GoodsMovement.objects.exists())

    def test_indian_fiscal_year_duplicate_boundary_and_correction(self):
        march = self.client.post("/api/gate/goods/", self.goods_data(invoice_date="2026-03-31"), format="json")
        april = self.client.post("/api/gate/goods/", self.goods_data(invoice_date="2026-04-01"), format="json")
        self.assertEqual(march.status_code, 201, march.data)
        self.assertEqual(april.status_code, 201, april.data)
        self.assertCountEqual(list(GoodsMovement.objects.values_list("invoice_year", flat=True)), [2025, 2026])
        self.assertEqual(self.client.post("/api/gate/goods/", self.goods_data(invoice_date="2026-02-01"), format="json").status_code, 409)
        self.client.force_authenticate(self.owner)
        changed = self.client.post(f"/api/gate/goods/{april.data['id']}/correct/", {"client_token": str(uuid.uuid4()), "reason": "Printed date was March", "invoice_date": "2026-03-31"}, format="json")
        self.assertEqual(changed.status_code, 409)
        self.assertEqual(GateAuditEvent.objects.count(), 2)

    def test_master_uom_and_consumable_units_preserved(self):
        item = ConsumableMaterial.objects.create(name="Cleaning fluid", category="CHEMICAL", unit="LTR")
        response = self.client.get("/api/gate/masters/", {"q": "Cleaning"})
        choices = response.data["products"]
        self.assertEqual(choices[0]["uom"], "LTR")
        data = self.goods_data()
        data["lines"] = [{"product_kind": "CONSUMABLE", "product_id": str(item.id), "quantity": "2", "uom": "LTR"}]
        self.assertEqual(self.client.post("/api/gate/goods/", data, format="json").status_code, 201)
        data["client_token"], data["invoice_number"], data["lines"][0]["uom"] = str(uuid.uuid4()), "INV-2", "KG"
        self.assertEqual(self.client.post("/api/gate/goods/", data, format="json").status_code, 400)

    def create_grn(self, invoice="INV-100"):
        po = PurchaseOrder.objects.create(code="GATE-PO", vendor=self.vendor, plant=self.plant)
        item = PurchaseOrderItem.objects.create(purchase_order=po, material=self.material, qty_ordered=25, qty_received=25, rate_per_uom=4, uom="KG")
        receipt = PurchaseOrderReceipt.objects.create(code="GATE-GRN", purchase_order=po, plant=self.plant, vendor_invoice_no=invoice, vendor_invoice_date=gate_today(), vehicle_no="DD03U9802")
        PurchaseOrderReceiptLine.objects.create(receipt=receipt, po_item=item, qty_received=25, rate=4)
        return receipt, item

    def test_grn_read_only_auto_fill_and_discrepancy(self):
        receipt, item = self.create_grn()
        data = self.goods_data()
        del data["lines"]
        data["document_kind"], data["document_id"] = "GRN", str(receipt.id)
        result = self.client.post("/api/gate/goods/", data, format="json")
        self.assertEqual(result.status_code, 201, result.data)
        self.assertEqual(result.data["reconciliation_status"], "MATCHED")
        self.assertEqual(Decimal(result.data["lines"][0]["quantity"]), Decimal("25"))
        item.refresh_from_db()
        self.assertEqual(item.qty_received, Decimal("25"))
        self.client.force_authenticate(self.owner)
        changed = self.client.post(f"/api/gate/goods/{result.data['id']}/correct/", {"client_token": str(uuid.uuid4()), "reason": "Invoice was copied incorrectly", "invoice_number": "UNRELATED", "invoice_date": str(gate_today()-timedelta(days=1))}, format="json")
        self.assertEqual(changed.status_code, 200, changed.data)
        self.assertEqual(changed.data["reconciliation_status"], "DISCREPANCY")
        self.assertIn("Invoice number differs from ERP reference.", changed.data["discrepancies"])
        self.assertIn("Invoice date differs from ERP reference.", changed.data["discrepancies"])
        self.assertEqual(GateAuditEvent.objects.count(), 2)

    def test_customer_dispatch_invoice_matching_uses_shipped_qty(self):
        customer = Customer.objects.create(code="GATE-C1", name="Buyer")
        product = ProductMaster.objects.create(code="GATE-PROD", name="Packing bags")
        order = SalesOrder.objects.create(order_number="GATE-SO", customer=customer, customer_name=customer.name)
        template = TemplateBlueprint.objects.create(name="Gate test template", fg_type="ROLL")
        item = SalesOrderItem.objects.create(sales_order=order, template=template, product_master=product, qty_value=500, qty_uom="KG", price_basis="KG", unit_price=100)
        dispatch = CustomerDispatch.objects.create(code="GATE-CD", sales_order=order, customer=customer, plant=self.plant, invoice_no="3156", status="CONFIRMED", vehicle_no="DD03U9802")
        CustomerDispatchLine.objects.create(dispatch=dispatch, sales_order_item=item, qty_dispatched="76.1", uom="KG")
        match = self.client.get("/api/gate/match/", {"plant": str(self.plant.id), "direction": "OUTWARD", "invoice_number": "3156"})
        self.assertEqual(match.status_code, 200, match.data)
        self.assertEqual(match.data["candidates"][0]["kind"], "DISPATCH")
        self.assertEqual(Decimal(match.data["candidates"][0]["lines"][0]["quantity"]), Decimal("76.1"))
        data = self.goods_data(direction="OUTWARD", invoice_number="3156", party_kind="CUSTOMER", party_id=str(customer.id), document_kind="DISPATCH", document_id=str(dispatch.id))
        del data["lines"]
        self.assertEqual(self.client.post("/api/gate/goods/", data, format="json").data["reconciliation_status"], "MATCHED")
        dispatch.refresh_from_db()
        self.assertEqual(dispatch.status, "CONFIRMED")

    def test_watchman_ceiling_and_history(self):
        result = self.client.post("/api/gate/goods/", self.goods_data(), format="json")
        self.client.force_authenticate(self.watchman)
        self.assertEqual(self.client.get(f"/api/gate/goods/{result.data['id']}/").status_code, 403)
        self.assertEqual(self.client.get("/api/gate/audit/").status_code, 403)
        self.assertEqual(self.client.get("/api/gate/reports/").status_code, 403)
        self.assertEqual(self.client.get("/api/gate/goods/", {"date_from": "2026-01-01", "date_to": "2026-01-01"}).status_code, 403)
        self.assertEqual(self.client.post(f"/api/gate/goods/{result.data['id']}/correct/", {"client_token": str(uuid.uuid4()), "reason": "Test correction", "vehicle_number": "X"}, format="json").status_code, 403)

    def test_owner_preview_with_padded_watchman_role_cannot_access_history(self):
        response = self.client.post("/api/gate/goods/", self.goods_data(), format="json")
        self.owner.effective_role_code = "  watchman  "
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.get(f"/api/gate/goods/{response.data['id']}/").status_code, 403)
        self.assertEqual(self.client.get("/api/gate/audit/").status_code, 403)
        self.assertEqual(self.client.get("/api/gate/reports/").status_code, 403)

    def test_gate_masters_have_full_history_private_images_qr_and_corrections_without_assignments(self):
        receipt, _ = self.create_grn()
        movement = self.client.post("/api/gate/goods/", self.goods_data(), format="json")
        self.assertEqual(movement.status_code, 201, movement.data)
        historical = timezone.now()-timedelta(days=400)
        GoodsMovement.objects.filter(id=movement.data["id"]).update(logged_at=historical)
        buffer = io.BytesIO()
        Image.new("RGB", (20, 20), "#112233").save(buffer, "JPEG")
        closed = VisitorVisit.objects.create(plant=self.other, name="Historical visitor", mobile="9876543211", purpose="Meeting", consent_at=historical, submitted_at=historical, status="EXITED", entry_at=historical, exit_at=historical+timedelta(hours=1), selfie_data=buffer.getvalue())
        policies = [("ADMIN", {}), ("SUPER_ADMIN", {}), ("OWNER", {}), ("SALES", {"is_owner": True}), ("SALES", {"is_superuser": True})]
        for index, (code, flags) in enumerate(policies):
            with self.subTest(role=code, flags=flags):
                role, _ = Role.objects.get_or_create(code=code, defaults={"name": code})
                master = User.objects.create_user(username=f"gate-master-{index}", role=role, **flags)
                self.assertFalse(GateAssignment.objects.filter(user=master).exists())
                self.client.force_authenticate(master)
                self.assertEqual(len(self.client.get("/api/gate/masters/").data["plants"]), 2)
                self.assertEqual(self.client.get("/api/gate/goods/").data["count"], 1)
                self.assertEqual(self.client.get(f"/api/gate/goods/{movement.data['id']}/").status_code, 200)
                self.assertEqual(self.client.get("/api/gate/visitors/", {"status": "EXITED"}).data["count"], 1)
                self.assertEqual(self.client.get(f"/api/gate/visitors/{closed.id}/selfie/", HTTP_ACCEPT="image/jpeg").status_code, 200)
                self.assertEqual(self.client.get("/api/gate/qr/", {"plant": str(self.other.id)}).status_code, 200)
                self.assertEqual(self.client.get("/api/gate/audit/").status_code, 200)
                self.assertEqual(self.client.get("/api/gate/reports/").status_code, 200)
                self.assertEqual(self.client.get("/api/gate/summary/", {"date_from": str(historical.date()), "date_to": str(historical.date())}).status_code, 200)
                changed = self.client.post(f"/api/gate/goods/{movement.data['id']}/correct/", {"client_token": str(uuid.uuid4()), "reason": "Master reviewed vehicle observation", "vehicle_number": f"DD03U98{index:02d}"}, format="json")
                self.assertEqual(changed.status_code, 200, changed.data)
                reconciled = self.client.post(f"/api/gate/goods/{movement.data['id']}/reconcile/", {"client_token": str(uuid.uuid4()), "reason": "Master selected original receipt", "document_kind": "GRN", "document_id": str(receipt.id)}, format="json")
                self.assertEqual(reconciled.status_code, 200, reconciled.data)
                self.assertEqual(reconciled.data["document_id"], str(receipt.id))
                self.assertTrue(GateAuditEvent.objects.filter(object_id=movement.data["id"], action="GOODS_CORRECTED", actor=master).exists())

    def test_watchman_ceiling_overrides_master_roles_and_flags_for_history_and_private_data(self):
        movement = self.client.post("/api/gate/goods/", self.goods_data(), format="json")
        legacy = VisitorVisit.objects.create(plant=self.plant, name="Pending visitor", mobile="9876543211", purpose="Meeting", consent_at=timezone.now(), selfie_data=b"private image")
        admin_role, _ = Role.objects.get_or_create(code="ADMIN", defaults={"name": "Administrator"})
        admin = User.objects.create_user(username="gate-admin-preview", role=admin_role, is_owner=True, is_superuser=True)
        admin.effective_role_code = "  watchman  "
        GateAssignment.objects.create(user=admin, plant=self.plant)
        self.watchman.is_owner = True
        self.watchman.is_superuser = True
        self.watchman.effective_role_code = "OWNER"
        for actor in [admin, self.watchman]:
            with self.subTest(actor=actor.username):
                self.client.force_authenticate(actor)
                for path in [f"/api/gate/goods/{movement.data['id']}/", "/api/gate/audit/", "/api/gate/reports/", "/api/gate/qr/"]:
                    self.assertEqual(self.client.get(path).status_code, 403)
                self.assertEqual(self.client.get(f"/api/gate/visitors/{legacy.id}/selfie/").status_code, 404)
                self.assertEqual(self.client.post(f"/api/gate/goods/{movement.data['id']}/correct/", {"client_token": str(uuid.uuid4()), "reason": "Attempted correction", "vehicle_number": "DD03U9802"}, format="json").status_code, 403)
                self.assertEqual(self.client.post(f"/api/gate/visitors/{legacy.id}/check-in/", {"client_token": str(uuid.uuid4())}, format="json").status_code, 403)

    def test_administrator_can_recover_legacy_pending_records(self):
        role, _ = Role.objects.get_or_create(code="ADMIN", defaults={"name": "Administrator"})
        administrator = User.objects.create_user(username="gate-admin-recovery", role=role)
        self.client.force_authenticate(administrator)
        created = self.client.post("/api/gate/visitors/", self.visitor_data(plant=str(self.other.id)), format="json")
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(created.data["status"], "PENDING")
        entered = self.client.post(f"/api/gate/visitors/{created.data['id']}/check-in/", {"client_token": str(uuid.uuid4())}, format="json")
        self.assertEqual(entered.status_code, 200, entered.data)
        visitor = VisitorVisit.objects.get(id=created.data["id"])
        self.assertEqual(visitor.entry_by, administrator)
        pending = self.client.post("/api/gate/visitors/", self.visitor_data(plant=str(self.other.id), mobile="9876543211"), format="json")
        cancelled = self.client.post(f"/api/gate/visitors/{pending.data['id']}/cancel/", {"client_token": str(uuid.uuid4()), "reason": "Visitor left"}, format="json")
        self.assertEqual(cancelled.status_code, 200, cancelled.data)
        self.assertEqual(cancelled.data["status"], "CANCELLED")
        self.assertIsNone(cancelled.data["entry_at"])

    def test_trading_outward_invoice_matches_only_dispatched_read_only(self):
        customer = Customer.objects.create(code="GATE-TC", name="Trading buyer")
        product = TradingGood.objects.create(code="GATE-TG", name="Ready pouch", base_uom="PCS")
        order = TradeOrder.objects.create(code="GATE-TO", customer=customer, plant=self.plant, status="DISPATCHED", dispatched_at=timezone.now(), invoice_no="TRADE-3156")
        row = TradeOrderItem.objects.create(trade_order=order, item_type="TRADING_GOOD", trading_good=product, qty=100, uom="PCS", rate=5, gst_pct=18, line_subtotal=500, line_gst=90, line_total=590)
        match = self.client.get("/api/gate/match/", {"plant": str(self.plant.id), "direction": "OUTWARD", "invoice_number": "TRADE-3156"})
        self.assertEqual(match.data["status"], "MATCHED")
        self.assertEqual(match.data["candidates"][0]["kind"], "TRADE")
        self.assertEqual(Decimal(match.data["candidates"][0]["amount"]), Decimal("590"))
        self.assertIsNone(match.data["candidates"][0]["invoice_date"])
        data = self.goods_data(direction="OUTWARD", invoice_number="TRADE-3156", party_kind="CUSTOMER", party_id=str(customer.id), document_kind="TRADE", document_id=str(order.id))
        del data["lines"]
        response = self.client.post("/api/gate/goods/", data, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["reconciliation_status"], "MATCHED")
        order.refresh_from_db()
        row.refresh_from_db()
        self.assertEqual(order.status, "DISPATCHED")
        self.assertEqual(row.qty, Decimal("100"))
        order.status = "CANCELLED"
        order.save()
        self.assertEqual(self.client.get("/api/gate/match/", {"plant": str(self.plant.id), "direction": "OUTWARD", "invoice_number": "TRADE-3156"}).data["status"], "UNMATCHED")

    def test_draft_challan_physical_observation_requires_owner_reconciliation(self):
        customer = Customer.objects.create(code="GATE-DC-C", name="Draft buyer")
        product = ProductMaster.objects.create(code="GATE-DC-P", name="Draft product")
        template = TemplateBlueprint.objects.create(name="Draft gate template", fg_type="ROLL")
        order = SalesOrder.objects.create(order_number="GATE-DC-SO", customer=customer, customer_name=customer.name)
        item = SalesOrderItem.objects.create(sales_order=order, template=template, product_master=product, qty_value=10, qty_uom="KG", price_basis="KG", unit_price=100)
        challan = DeliveryChallan.objects.create(dc_no="DRAFT-DC1", customer_name=customer.name, sales_order=order, plant=self.plant, status="DRAFT", vehicle_no="DD03U9802")
        DeliveryChallanItem.objects.create(challan=challan, sales_order_item=item, weight_kg=10)
        data = self.goods_data(direction="OUTWARD", invoice_number="DRAFT-DC1", party_kind="CUSTOMER", party_id=str(customer.id), document_kind="CHALLAN", document_id=str(challan.id))
        del data["lines"]
        response = self.client.post("/api/gate/goods/", data, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["reconciliation_status"], "DISCREPANCY")
        self.assertTrue(any("draft" in warning for warning in response.data["discrepancies"]))
        challan.refresh_from_db()
        self.assertEqual(challan.status, "DRAFT")

    def test_public_registration_records_entry_private_and_idempotent(self):
        data = self.visitor_data()
        first = self.public.post("/api/gate/public/visitors/", data, format="json")
        again = self.public.post("/api/gate/public/visitors/", data, format="json")
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(first["Cache-Control"], "no-store")
        self.assertTrue(again.data["replayed"])
        self.assertEqual(set(first.data), {"receipt_id", "status", "entry_at", "message", "replayed"})
        self.assertEqual(first.data["status"], "INSIDE")
        visitor = VisitorVisit.objects.get()
        self.assertEqual(first.data["entry_at"], visitor.entry_at.isoformat())
        self.assertEqual(again.data["entry_at"], first.data["entry_at"])
        self.assertEqual({key: value for key, value in first.data.items() if key != "replayed"}, {key: value for key, value in again.data.items() if key != "replayed"})
        self.assertEqual(visitor.entry_at, visitor.submitted_at)
        self.assertEqual(visitor.entry_at, visitor.consent_at)
        self.assertIsNone(visitor.entry_by)
        self.assertIsNone(visitor.exit_at)
        events = GateAuditEvent.objects.filter(object_id=visitor.id)
        self.assertEqual(events.count(), 2)
        self.assertEqual(set(events.values_list("action", flat=True)), {"VISITOR_REGISTERED", "VISITOR_ENTERED"})
        self.assertFalse(events.filter(actor__isnull=False).exists())
        self.assertEqual(events.get(action="VISITOR_ENTERED").after["entry_at"], visitor.entry_at.isoformat())
        self.assertEqual(GateRequestReceipt.objects.count(), 1)
        self.assertEqual(self.public.get("/api/gate/public/visitors/").status_code, 405)
        self.assertNotEqual(self.public.get("/api/gate/visitors/").status_code, 200)
        self.assertEqual(self.public.get("/api/gate/public/config/", {"gate_token": str(self.link.token)}).status_code, 200)
        self.assertEqual(self.public.get("/api/gate/public/config/").status_code, 404)
        self.assertEqual(self.public.get(f"/api/gate/public/visitors/{first.data['receipt_id']}/").status_code, 404)

    def test_watchman_exit_only_duplicate_mobile_and_retry(self):
        self.client.force_authenticate(self.watchman)
        visitor = self.registered()
        self.assertEqual(self.public.post("/api/gate/public/visitors/", self.visitor_data(), format="json").status_code, 409)
        action = {"client_token": str(uuid.uuid4())}
        self.assertEqual(self.client.post("/api/gate/visitors/", self.visitor_data(plant=str(self.plant.id)), format="json").status_code, 403)
        self.assertEqual(self.client.post(f"/api/gate/visitors/{visitor.id}/check-in/", action, format="json").status_code, 403)
        self.assertEqual(self.client.post(f"/api/gate/visitors/{visitor.id}/cancel/", {**action, "reason": "Visitor left"}, format="json").status_code, 403)
        exited = self.client.post(f"/api/gate/visitors/{visitor.id}/check-out/", action, format="json")
        self.assertEqual(exited.status_code, 200, exited.data)
        retry = self.client.post(f"/api/gate/visitors/{visitor.id}/check-out/", action, format="json")
        self.assertTrue(retry.data["replayed"])
        self.assertEqual(retry.data["exit_at"], exited.data["exit_at"])
        self.assertEqual(self.client.post(f"/api/gate/visitors/{visitor.id}/check-out/", {"client_token": str(uuid.uuid4())}, format="json").status_code, 409)
        visitor.refresh_from_db()
        self.assertGreaterEqual(visitor.exit_at, visitor.entry_at)
        self.assertEqual(visitor.exit_by, self.watchman)
        self.assertEqual(GateAuditEvent.objects.filter(object_id=visitor.id, action="VISITOR_EXITED").count(), 1)
        self.assertEqual(self.client.get("/api/gate/visitors/").data["count"], 0)
        self.assertEqual(self.registered().status, "INSIDE")

    def test_owner_recovers_pending_visitors_without_watchman_entry_privileges(self):
        self.client.force_authenticate(self.owner)
        created = self.client.post("/api/gate/visitors/", self.visitor_data(plant=str(self.plant.id)), format="json")
        self.assertEqual(created.status_code, 201, created.data)
        visitor = VisitorVisit.objects.get(id=created.data["id"])
        self.assertEqual(visitor.source, "OWNER")
        self.assertEqual(visitor.status, "PENDING")
        self.assertIsNone(visitor.entry_at)
        self.client.force_authenticate(self.watchman)
        self.assertEqual(self.client.get("/api/gate/visitors/").data["count"], 0)
        self.assertEqual(self.client.get("/api/gate/visitors/", {"status": "PENDING"}).status_code, 403)
        for action in ["check-in", "cancel"]:
            data = {"client_token": uuid.uuid4(), "reason": "Visitor left"}
            self.assertEqual(self.client.post(f"/api/gate/visitors/{visitor.id}/{action}/", data, format="json").status_code, 403)
            with self.assertRaises(PermissionDenied):
                transition_visitor(self.watchman, visitor, data, action)
        with self.assertRaises(PermissionDenied):
            create_visitor(self.plant, self.visitor_data(), self.watchman)
        self.assertEqual(self.client.post(f"/api/gate/visitors/{visitor.id}/check-out/", {"client_token": str(uuid.uuid4())}, format="json").status_code, 409)
        self.client.force_authenticate(self.owner)
        action = {"client_token": str(uuid.uuid4())}
        entered = self.client.post(f"/api/gate/visitors/{visitor.id}/check-in/", action, format="json")
        self.assertEqual(entered.status_code, 200, entered.data)
        self.assertTrue(self.client.post(f"/api/gate/visitors/{visitor.id}/check-in/", action, format="json").data["replayed"])
        visitor.refresh_from_db()
        self.assertEqual(visitor.entry_by, self.owner)
        other = self.client.post("/api/gate/visitors/", self.visitor_data(plant=str(self.plant.id), mobile="9876543211"), format="json")
        self.assertEqual(other.status_code, 201, other.data)
        cancelled = self.client.post(f"/api/gate/visitors/{other.data['id']}/cancel/", {"client_token": str(uuid.uuid4()), "reason": "Visitor left"}, format="json")
        self.assertEqual(cancelled.status_code, 200, cancelled.data)
        self.assertEqual(cancelled.data["status"], "CANCELLED")
        self.assertIsNone(cancelled.data["entry_at"])

    def test_operational_queues_page_oldest_first_beyond_one_hundred_visitors(self):
        now = timezone.now()
        pending, inside = [], []
        for index in range(125):
            pending.append(VisitorVisit(plant=self.plant, name=f"Pending {index}", mobile=str(9876000000+index), purpose="Meeting", consent_at=now, submitted_at=now-timedelta(minutes=index)))
            inside.append(VisitorVisit(plant=self.plant, name=f"Inside {index}", mobile=str(9976000000+index), purpose="Meeting", consent_at=now, status="INSIDE", entry_by=self.watchman, entry_at=now-timedelta(minutes=index), submitted_at=now-timedelta(days=1+(124-index)%3)))
        VisitorVisit.objects.bulk_create(pending+inside)
        for status, prefix in [("PENDING", "Pending"), ("INSIDE", "Inside")]:
            self.client.force_authenticate(self.owner if status == "PENDING" else self.watchman)
            first = self.client.get("/api/gate/visitors/", {"status": status, "page_size": "100"})
            second = self.client.get("/api/gate/visitors/", {"status": status, "page_size": "100", "page": "2"})
            self.assertEqual(first.status_code, 200, first.data)
            self.assertEqual(first.data["count"], 125)
            self.assertEqual(first.data["results"][0]["name"], f"{prefix} 124")
            self.assertEqual(first.data["results"][-1]["name"], f"{prefix} 25")
            self.assertEqual(second.data["results"][0]["name"], f"{prefix} 24")
            self.assertEqual(second.data["results"][-1]["name"], f"{prefix} 0")
            self.assertEqual(len({row["id"] for row in first.data["results"]+second.data["results"]}), 125)
        default = self.client.get("/api/gate/visitors/")
        self.assertEqual(default.data["count"], 125)
        self.assertEqual(default.data["results"][0]["name"], "Inside 124")
        self.client.force_authenticate(self.owner)
        history = self.client.get("/api/gate/visitors/")
        self.assertEqual(history.data["results"][0]["name"], "Pending 0")

    @override_settings(GATE_ID_ENCRYPTION_KEY="")
    def test_id_encryption_failure_closed_no_receipt_and_masked_success(self):
        data = self.visitor_data(government_id_type="PAN", government_id_number="ABCDE1234F")
        with patch.dict("os.environ", {"GATE_ID_ENCRYPTION_KEY": ""}):
            failed = self.public.post("/api/gate/public/visitors/", data, format="json")
        self.assertEqual(failed.status_code, 503, failed.data)
        self.assertEqual(failed.data["code"], "GATE_ID_STORAGE_UNAVAILABLE")
        self.assertFalse(VisitorVisit.objects.exists())
        key = Fernet.generate_key().decode()
        with override_settings(GATE_ID_ENCRYPTION_KEY=key):
            success = self.public.post("/api/gate/public/visitors/", data, format="json")
        self.assertEqual(success.status_code, 201, success.data)
        obj = VisitorVisit.objects.get()
        self.assertNotIn("ABCDE1234F", obj.government_id_encrypted)
        self.assertEqual(Fernet(key.encode()).decrypt(obj.government_id_encrypted.encode()).decode(), "ABCDE1234F")
        result = self.client.get("/api/gate/visitors/").data
        self.assertNotIn("ABCDE1234F", json.dumps(result))
        self.assertIn("1234F"[-4:], result["results"][0]["government_id_masked"])
        self.assertNotIn("ABCDE1234F", json.dumps(list(GateAuditEvent.objects.values("before", "after"))))

    def test_selfie_sanitized_scoped_private_and_list_does_not_load_images(self):
        self.client.force_authenticate(self.watchman)
        buffer = io.BytesIO()
        Image.new("RGB", (1200, 1600), "#11aabb").save(buffer, "PNG")
        data = self.visitor_data()
        data["selfie"] = SimpleUploadedFile("photo.png", buffer.getvalue(), content_type="image/png")
        response = self.public.post("/api/gate/public/visitors/", data, format="multipart")
        self.assertEqual(response.status_code, 201, response.data)
        visitor = VisitorVisit.objects.get()
        photo = Image.open(io.BytesIO(bytes(visitor.selfie_data)))
        self.assertEqual(photo.format, "JPEG")
        self.assertLessEqual(max(photo.size), 640)
        with CaptureQueriesContext(connection) as queries:
            result = self.client.get("/api/gate/visitors/")
        self.assertTrue(result.data["results"][0]["has_selfie"])
        self.assertFalse(any('SELECT "gate_visitorvisit"."id", "gate_visitorvisit"."selfie_data"' in row["sql"] for row in queries))
        image = self.client.get(f"/api/gate/visitors/{visitor.id}/selfie/", HTTP_ACCEPT="image/jpeg")
        self.assertEqual(image.status_code, 200)
        self.assertEqual(image["Cache-Control"], "private, no-store")
        self.assertNotEqual(self.public.get(f"/api/gate/visitors/{visitor.id}/selfie/").status_code, 200)
        legacy = VisitorVisit.objects.create(plant=self.plant, name="Legacy pending", mobile="9876543211", purpose="Meeting", consent_at=timezone.now(), source="WATCHMAN", selfie_data=visitor.selfie_data)
        self.assertEqual(self.client.get(f"/api/gate/visitors/{legacy.id}/selfie/", HTTP_ACCEPT="image/jpeg").status_code, 404)
        visitor.status = "EXITED"
        visitor.entry_at = timezone.now()
        visitor.exit_at = timezone.now()
        visitor.save()
        self.assertEqual(self.client.get(f"/api/gate/visitors/{visitor.id}/selfie/").status_code, 404)
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.get(f"/api/gate/visitors/{visitor.id}/selfie/").status_code, 200)
        self.assertEqual(self.client.get(f"/api/gate/visitors/{legacy.id}/selfie/").status_code, 200)

    def test_invalid_selfie_and_consent_rejected(self):
        data = self.visitor_data(consent=False)
        self.assertEqual(self.public.post("/api/gate/public/visitors/", data, format="json").status_code, 400)
        data = self.visitor_data()
        data["selfie"] = SimpleUploadedFile("not-an-image.jpg", b"fake image", content_type="image/jpeg")
        self.assertEqual(self.public.post("/api/gate/public/visitors/", data, format="multipart").status_code, 400)

    def test_owner_audit_immutable_application_and_database(self):
        response = self.client.post("/api/gate/goods/", self.goods_data(), format="json")
        event = GateAuditEvent.objects.get()
        with self.assertRaises(TypeError):
            event.save()
        with self.assertRaises(TypeError):
            GateAuditEvent.objects.filter(id=event.id).update(reason="tamper")
        if connection.vendor == "postgresql":
            with self.assertRaises(DatabaseError), transaction.atomic():
                with connection.cursor() as cursor:
                    cursor.execute("UPDATE gate_gateaudit_event SET reason=%s WHERE id=%s".replace("gate_gateaudit_event", GateAuditEvent._meta.db_table), ["tamper", str(event.id)])
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.get("/api/gate/audit/").data["count"], 1)

    def test_explicit_reports_permission_all_plants_no_visitor_pii_and_csv_formula_safe(self):
        self.vendor.name = "=TEST()"
        self.vendor.save()
        self.client.post("/api/gate/goods/", self.goods_data(), format="json")
        self.registered()
        role, _ = Role.objects.get_or_create(code="SALES", defaults={"name": "Sales"})
        reader = User.objects.create_user(username="gate-report-reader", role=role, extra_permissions=["gate.reports"])
        self.client.force_authenticate(reader)
        report = self.client.get("/api/gate/reports/")
        self.assertEqual(report.status_code, 200, report.data)
        self.assertEqual(report.data["summary"]["goods_total"], 1)
        self.assertNotIn("9876543210", json.dumps(report.data))
        self.assertNotIn("A Visitor", json.dumps(report.data))
        csv = self.client.get("/api/gate/reports/csv/", HTTP_ACCEPT="text/csv")
        self.assertEqual(csv.status_code, 200)
        self.assertIn("'=TEST()", csv.content.decode())
        self.assertEqual(self.client.get("/api/gate/visitors/").status_code, 403)
        self.assertEqual(self.client.get("/api/gate/reports/", {"date_from": "2026-10-07", "date_to": "2026-10-06"}).status_code, 400)
        self.assertEqual(self.client.get("/api/gate/reports/", {"date_from": "2024-01-01", "date_to": "2026-10-07"}).status_code, 400)

    def test_business_day_india_timezone_and_pagination_bounds(self):
        self.client.force_authenticate(self.watchman)
        instant = datetime(2026, 10, 6, 19, 0, tzinfo=ZoneInfo("UTC"))
        with patch("apps.gate.services.timezone.now", return_value=instant):
            self.assertEqual(str(gate_today()), "2026-10-07")
        start, end = date_bounds(gate_today(), gate_today())
        self.assertEqual(start.utcoffset(), timedelta(hours=5, minutes=30))
        self.assertEqual(end-start, timedelta(days=1))
        for size in ["0", "101", "abc"]:
            self.assertEqual(self.client.get("/api/gate/goods/", {"page_size": size}).status_code, 400)

    def test_qr_owner_only_real_svg_no_public_plant_inventory(self):
        self.client.force_authenticate(self.watchman)
        self.assertEqual(self.client.get("/api/gate/qr/", {"plant": str(self.plant.id)}).status_code, 403)
        self.client.force_authenticate(self.owner)
        qr = self.client.get("/api/gate/qr/", {"plant": str(self.plant.id)})
        self.assertEqual(qr.status_code, 200)
        self.assertIn(f"/visit/{self.link.token}", qr.data["public_url"])
        svg = self.client.get(qr.data["svg_url"], HTTP_ACCEPT="image/svg+xml")
        self.assertEqual(svg.status_code, 200)
        self.assertIn(b"<svg", svg.content)
        config = self.public.get("/api/gate/public/config/", {"gate_token": str(self.link.token)})
        self.assertNotIn("plants", config.data)
        self.assertNotIn(str(self.plant.id), json.dumps(config.data))

    def test_new_plant_qr_is_automatic_and_existing_token_is_preserved(self):
        plant = Plant.objects.create(code="GATE-NEW", name="New factory gate")
        link = GatePublicLink.objects.get(plant=plant)
        token = link.token
        self.client.force_authenticate(self.owner)
        response = self.client.get("/api/gate/qr/", {"plant": str(plant.id)})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["gate_token"], str(token))
        plant.name = "Renamed factory gate"
        plant.save()
        link.refresh_from_db()
        self.assertEqual(link.token, token)
        self.assertEqual(GatePublicLink.objects.filter(plant=plant).count(), 1)

    def test_public_global_rate_limit_enforced(self):
        for _ in range(20):
            response = self.public.post("/api/gate/public/visitors/", self.visitor_data(mobile="invalid"), format="json")
            self.assertEqual(response.status_code, 400)
        self.assertEqual(self.public.post("/api/gate/public/visitors/", self.visitor_data(), format="json").status_code, 429)


class GateConcurrencyTests(TransactionTestCase):
    def setUp(self):
        self.owner, self.watchman, self.plant, self.other, self.link, self.vendor, self.material = fixture()

    def test_concurrent_duplicate_goods_records_exactly_one_event(self):
        if connection.vendor != "postgresql":
            self.skipTest("PostgreSQL row lock acceptance")
        def record(_):
            close_old_connections()
            user = User.objects.get(id=self.owner.id)
            data = {"client_token": uuid.uuid4(), "plant": self.plant.id, "direction": "INWARD", "invoice_number": "RACE-1", "vehicle_number": "DD03U9802", "party_kind": "VENDOR", "party_id": self.vendor.id, "lines": [{"product_kind": "MATERIAL", "product_id": self.material.id, "quantity": Decimal("1"), "uom": "KG", "amount": None}]}
            try:
                create_goods(user, data)
                return "created"
            except Conflict:
                return "conflict"
            finally:
                connections["default"].close()
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(record, [1, 2]))
        self.assertCountEqual(results, ["created", "conflict"])
        self.assertEqual(GoodsMovement.objects.count(), 1)
        self.assertEqual(GateAuditEvent.objects.count(), 1)

    def test_concurrent_checkout_records_one_exit(self):
        if connection.vendor != "postgresql":
            self.skipTest("PostgreSQL row lock acceptance")
        visitor = VisitorVisit.objects.create(plant=self.plant, name="Concurrent visitor", mobile="9876543210", purpose="Meeting", consent_at=timezone.now(), status="INSIDE", entry_at=timezone.now(), entry_by=self.watchman)
        def checkout(_):
            close_old_connections()
            try:
                result = transition_visitor(User.objects.get(id=self.watchman.id), VisitorVisit.objects.select_related("plant").get(id=visitor.id), {"client_token": uuid.uuid4()}, "check-out")
                return result["status"]
            except Conflict:
                return "conflict"
            finally:
                connections["default"].close()
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(checkout, [1, 2]))
        self.assertCountEqual(results, ["EXITED", "conflict"])
        self.assertEqual(GateAuditEvent.objects.filter(action="VISITOR_EXITED").count(), 1)
