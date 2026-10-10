"""Foundation for bills & documents: permissions/overrides, page views, numbering, QR, storage."""
import io
import uuid
from concurrent.futures import ThreadPoolExecutor

from PIL import Image
from django.db import close_old_connections, connection, transaction
from django.test import TestCase, TransactionTestCase, override_settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.users.models import Notification, Role, User
from apps.users.permission_registry import get_permission_catalog, resolve_required_permission
from apps.users.permission_service import PermissionService
from apps.users.services.bill_notifications import publish_document_event, register_document_event, visible_bill_notifications

from .models import DocumentPageView, DocumentSequence, InwardBillIntake, InwardBillPage
from .numbering import fiscal_label, next_document_number
from .qr import make_token, parse_token, qr_png_bytes, qr_svg
from .storage_monitor import run_storage_monitor, storage_report
from .tests import fixture

DOCS = ["documents.view", "documents.upload", "documents.manage", "gatepass.manage", "outward.reconcile"]


def jpeg(size=(1200, 1800), color="#f4f4f4"):
    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, "JPEG", quality=90)
    return buffer.getvalue()


def make_role(code, name=None, defaults=None):
    role, _ = Role.objects.get_or_create(code=code, defaults={"name": name or code.title()})
    if defaults is not None:
        role.default_permissions = defaults
        role.save(update_fields=["default_permissions"])
    return role


class DocumentPermissionTests(TestCase):
    def setUp(self):
        self.owner, self.watchman, self.plant, self.other, _, self.vendor, _ = fixture()
        self.store = User.objects.create_user(username="doc-store", role=make_role("STORE", "Inventory"))
        self.planner = User.objects.create_user(username="doc-planner", role=make_role("PLANNER"))
        self.sales = User.objects.create_user(username="doc-sales", role=make_role("SALES"))
        self.admin = User.objects.create_user(username="doc-admin", role=make_role("ADMIN"))

    def test_store_holds_every_document_right_and_others_none_by_default(self):
        for code in DOCS:
            self.assertTrue(PermissionService.has_document_permission(self.store, code), code)
            self.assertTrue(PermissionService.has_document_permission(self.owner, code), code)
            self.assertTrue(PermissionService.has_document_permission(self.admin, code), code)
            self.assertFalse(PermissionService.has_document_permission(self.planner, code), code)
            self.assertFalse(PermissionService.has_document_permission(self.sales, code), code)
            self.assertFalse(PermissionService.has_document_permission(self.watchman, code), code)

    def test_role_matrix_override_grants_only_what_is_ticked(self):
        accounts = make_role("ACCOUNTS", "Accounts", ["documents.upload"])
        user = User.objects.create_user(username="doc-accounts", role=accounts)
        self.assertTrue(PermissionService.has_document_permission(user, "documents.upload"))
        self.assertTrue(PermissionService.has_document_permission(user, "documents.view"), "view is implied by any document right")
        self.assertFalse(PermissionService.has_document_permission(user, "documents.manage"))
        self.assertFalse(PermissionService.has_inventory_bill_review(user), "no stock posting without inventory/procurement manage")
        perms = set(PermissionService.get_user_permissions(user))
        self.assertTrue({"documents.upload", "documents.view", "page.inventory.gate_bills.view", "page.inventory.general_receipts.view"} <= perms)
        self.assertNotIn("page.inventory.outward_documents.view", perms)

    def test_custom_document_roles_land_on_a_workspace_they_can_open(self):
        accounts = User.objects.create_user(username="doc-accounts-landing", role=make_role("ACCOUNTS", "Accounts", ["documents.upload", "documents.view"]))
        self.assertEqual(PermissionService.get_landing_route(accounts), "/inventory/gate-bills")
        matcher = User.objects.create_user(username="doc-outward-landing", role=make_role("OUTWARD_DESK", "Outward desk", ["outward.reconcile"]))
        self.assertEqual(PermissionService.get_landing_route(matcher), "/inventory/outward-documents")
        bare = User.objects.create_user(username="doc-bare-landing", role=make_role("VISITOR_DESK", "Visitor desk", []))
        self.assertEqual(PermissionService.get_landing_route(bare), "/dashboard/admin", "unchanged fallback")
        self.assertEqual(PermissionService.get_landing_route(self.store), "/inventory/rolls", "built-in roles keep their landing")
        root = User.objects.create_superuser(username="doc-root-landing", password="x-unused-123")
        self.assertEqual(PermissionService.get_landing_route(root), "/dashboard/admin")

    def test_user_extra_permission_override_and_revocation(self):
        self.planner.extra_permissions = ["outward.reconcile"]
        self.planner.save(update_fields=["extra_permissions"])
        self.assertTrue(PermissionService.has_document_permission(self.planner, "outward.reconcile"))
        self.assertIn("page.inventory.outward_documents.view", PermissionService.get_user_permissions(self.planner))
        self.planner.extra_permissions = []
        self.planner.save(update_fields=["extra_permissions"])
        self.assertFalse(PermissionService.has_document_permission(self.planner, "outward.reconcile"))
        self.assertNotIn("page.inventory.outward_documents.view", PermissionService.get_user_permissions(self.planner))

    def test_wildcards_previews_and_watchman_flags_never_grant_documents(self):
        self.planner.extra_permissions = ["*"]
        self.planner.save(update_fields=["extra_permissions"])
        self.assertFalse(PermissionService.has_document_permission(self.planner, "documents.view"))
        self.planner.effective_role_code = "STORE"
        self.assertFalse(PermissionService.has_document_permission(self.planner, "documents.manage"), "a role preview adds no authority")
        self.watchman.is_owner = True
        self.watchman.extra_permissions = DOCS
        self.assertFalse(any(PermissionService.has_document_permission(self.watchman, code) for code in DOCS))
        watch_perms = set(PermissionService.get_user_permissions(self.watchman))
        self.assertIn("gate.outward.submit", watch_perms)
        self.assertFalse(set(DOCS) & watch_perms)

    def test_inactive_account_has_no_rights(self):
        self.store.is_active = False
        self.assertFalse(PermissionService.has_document_permission(self.store, "documents.view"))

    def test_entitlements_payload_and_catalog_group(self):
        ent = PermissionService.get_entitlements(self.store)
        self.assertEqual(ent["documents"], {code: True for code in sorted(DOCS)})
        catalog = {row["permission"]: row for row in get_permission_catalog()}
        for code in DOCS + ["page.inventory.gate_passes.view", "gate.bill.review"]:
            self.assertEqual(catalog[code]["module"], "bills_documents", code)
            self.assertTrue(catalog[code]["assignable"], code)
            self.assertTrue(catalog[code].get("label"), code)

    def test_route_resolution_for_new_paths(self):
        self.assertEqual(resolve_required_permission("/api/gate/inward-bills/office-upload/", "POST"), "documents.upload")
        self.assertEqual(resolve_required_permission(f"/api/gate/inward-bills/{uuid.uuid4()}/classify/", "POST"), "documents.manage")
        self.assertEqual(resolve_required_permission(f"/api/gate/inward-bills/{uuid.uuid4()}/file/", "POST"), "documents.manage")
        self.assertEqual(resolve_required_permission("/api/gate/outward-documents/", "GET"), "outward.reconcile")
        self.assertEqual(resolve_required_permission("/api/gate/gate-passes/", "POST"), "gatepass.manage")
        self.assertEqual(resolve_required_permission("/api/gate/gate-passes/", "GET"), "documents.view")
        self.assertEqual(resolve_required_permission("/api/procurement/general-receipts/", "POST"), "documents.manage")
        self.assertEqual(resolve_required_permission("/api/gate/document-pages/rotation/", "POST"), "documents.view")


class DocumentNotificationTests(TestCase):
    def setUp(self):
        self.owner, self.watchman, self.plant, *_ = fixture()
        self.store = User.objects.create_user(username="note-store", role=make_role("STORE", "Inventory"))
        self.planner = User.objects.create_user(username="note-planner", role=make_role("PLANNER"))
        register_document_event("tests.outward_pending", "outward.reconcile")

    def test_publish_targets_current_holders_idempotently_and_hides_after_revocation(self):
        object_id = uuid.uuid4()
        kwargs = dict(event_key="tests.outward_pending", plant=self.plant, object_id=object_id, object_type="OutwardDocument", title="Outward photo needs matching", message="m", deep_link=f"/inventory/outward-documents/{object_id}")
        first = publish_document_event(**kwargs)
        again = publish_document_event(**kwargs)
        self.assertEqual(first, 2)  # owner + store
        self.assertEqual(again, 0)
        holders = set(Notification.objects.filter(event_key="tests.outward_pending").values_list("user_id", flat=True))
        self.assertEqual(holders, {self.owner.id, self.store.id})
        self.assertEqual(visible_bill_notifications(Notification.objects.filter(user=self.store), self.store).count(), 1)
        self.store.role = make_role("PLANNER")
        self.store.save(update_fields=["role"])
        self.assertEqual(visible_bill_notifications(Notification.objects.filter(user=self.store), self.store).count(), 0)

    def test_unregistered_event_is_refused(self):
        with self.assertRaises(ValueError):
            publish_document_event(event_key="tests.unknown", plant=self.plant, object_id=uuid.uuid4(), object_type="X", title="t", message="m", deep_link="/")


@override_settings(STRICT_RBAC=True)
class DocumentPageAndRbacApiTests(TransactionTestCase):
    def setUp(self):
        self.owner, self.watchman, self.plant, self.other, _, self.vendor, _ = fixture()
        self.store = User.objects.create_user(username="page-store", role=make_role("STORE", "Inventory"))
        self.planner = User.objects.create_user(username="page-planner", role=make_role("PLANNER"))
        self.bill = InwardBillIntake.objects.create(plant=self.plant, created_by=self.watchman, content_hash="x" * 64)
        data = jpeg()
        self.page = InwardBillPage.objects.create(intake=self.bill, page_number=1, data=data, width=1200, height=1800, byte_size=len(data), sha256="y" * 64)

    def jwt(self, user):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
        return client

    def rotate(self, user, rotation=90, page_kind="INWARD", page_id=None):
        return self.jwt(user).post("/api/gate/document-pages/rotation/", {"client_token": str(uuid.uuid4()), "page_kind": page_kind, "page_id": str(page_id or self.page.id), "rotation": rotation}, format="json")

    def test_rotation_is_shared_validated_and_permissioned(self):
        response = self.rotate(self.store, 90)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(DocumentPageView.objects.get().display_rotation, 90)
        self.assertEqual(self.rotate(self.store, 270).status_code, 200)
        self.assertEqual(DocumentPageView.objects.get().display_rotation, 270)
        self.assertEqual(self.rotate(self.store, 45).status_code, 400)
        self.assertEqual(self.rotate(self.store, 90, page_id=uuid.uuid4()).status_code, 404)
        self.assertEqual(self.rotate(self.planner, 0).status_code, 403)
        self.assertEqual(self.rotate(self.watchman, 0).status_code, 403)
        detail = self.jwt(self.store).get(f"/api/gate/inward-bills/{self.bill.id}/")
        self.assertEqual(detail.status_code, 200, detail.content)
        page = detail.json()["pages"][0]
        self.assertEqual(page["display_rotation"], 270)
        self.assertTrue(page["thumb_url"].endswith("?w=320"))
        self.assertEqual(bytes(InwardBillPage.objects.get().data), bytes(self.page.data), "rotation never touches image bytes")

    def test_thumbnail_is_small_private_jpeg_and_width_is_validated(self):
        client = self.jwt(self.store)
        url = f"/api/gate/inward-bills/{self.bill.id}/pages/{self.page.id}/"
        thumb = client.get(url + "?w=320")
        self.assertEqual(thumb.status_code, 200)
        self.assertEqual(thumb["Cache-Control"], "private, no-store")
        image = Image.open(io.BytesIO(thumb.content))
        self.assertEqual(image.format, "JPEG")
        self.assertEqual(image.width, 320)
        self.assertLess(len(thumb.content), self.page.byte_size)
        self.assertEqual(client.get(url + "?w=999").status_code, 400)
        self.assertEqual(len(client.get(url).content), self.page.byte_size)

    def test_watchman_scope_blocks_office_document_paths(self):
        client = self.jwt(self.watchman)
        for method, path in [("get", "/api/gate/gate-passes/"), ("post", "/api/gate/document-pages/rotation/"), ("get", "/api/gate/document-reports/storage/"), ("post", "/api/gate/inward-bills/office-upload/"), ("post", f"/api/gate/outward-documents/{uuid.uuid4()}/link/")]:
            response = getattr(client, method)(path, {}, format="json")
            self.assertEqual(response.status_code, 403, (method, path, response.status_code))

    def test_storage_report_is_owner_only(self):
        self.assertEqual(self.jwt(self.owner).get("/api/gate/document-reports/storage/").status_code, 200)
        self.assertEqual(self.jwt(self.store).get("/api/gate/document-reports/storage/").status_code, 403)
        self.assertEqual(self.jwt(self.planner).get("/api/gate/document-reports/storage/").status_code, 403)


class NumberingTests(TransactionTestCase):
    def test_numbers_are_sequential_per_key_and_financial_year(self):
        with transaction.atomic():
            first = next_document_number("GR")
            second = next_document_number("GR")
            other = next_document_number("RGP")
        label = fiscal_label(DocumentSequence.objects.get(key="GR").fiscal_year)
        self.assertEqual(first, f"GR-{label}-000001")
        self.assertEqual(second, f"GR-{label}-000002")
        self.assertEqual(other, f"RGP-{label}-000001")
        with self.assertRaises(RuntimeError):
            next_document_number("GR")

    def test_rolled_back_number_is_reused_and_concurrent_issue_is_unique(self):
        try:
            with transaction.atomic():
                next_document_number("JWC")
                raise ValueError("rollback")
        except ValueError:
            pass
        with transaction.atomic():
            self.assertTrue(next_document_number("JWC").endswith("-000001"))

        def issue(_):
            close_old_connections()
            try:
                with transaction.atomic():
                    return next_document_number("NRGP")
            finally:
                connection.close()

        with ThreadPoolExecutor(max_workers=6) as pool:
            numbers = list(pool.map(issue, range(12)))
        self.assertEqual(len(set(numbers)), 12)


@override_settings(SECRET_KEY="qr-test-secret-0123456789abcdef0123456789abcdef")
class QrTokenTests(TestCase):
    def test_round_trip_and_tamper_detection(self):
        object_id = uuid.uuid4()
        token = make_token("GATE_PASS", object_id)
        self.assertEqual(parse_token(token), ("GATE_PASS", object_id))
        from rest_framework.exceptions import ValidationError

        tampered = token.replace("GATE_PASS", "SALES_DC")
        for bad in [tampered, token[:-1] + ("0" if token[-1] != "0" else "1"), "hello", "", f"TPP1.UNKNOWN.{object_id}.0123456789abcdef"]:
            with self.assertRaises(ValidationError):
                parse_token(bad)
        with self.assertRaises(ValueError):
            make_token("NOPE", object_id)
        self.assertIn("<svg", qr_svg(token))
        self.assertTrue(qr_png_bytes(token).startswith(b"\x89PNG"))


class StorageMonitorTests(TestCase):
    def setUp(self):
        self.owner, self.watchman, self.plant, *_ = fixture()

    def test_report_measures_pages_and_alerts_owners_once_per_day(self):
        bill = InwardBillIntake.objects.create(plant=self.plant, created_by=self.watchman, content_hash="z" * 64)
        data = jpeg()
        InwardBillPage.objects.create(intake=bill, page_number=1, data=data, width=1200, height=1800, byte_size=len(data), sha256="q" * 64)
        report = storage_report()
        self.assertEqual(report["page_counts"]["inward_pages"], 1)
        self.assertEqual(report["growth_30d_bytes"], len(data))
        self.assertEqual(report["storage_backend"], "POSTGRESQL")
        self.assertGreater(report["database_bytes"], 0)
        with self.settings():
            import os
            previous = os.environ.get("DOCUMENT_DB_WARN_GB")
            os.environ["DOCUMENT_DB_WARN_GB"] = "0.000001"
            try:
                result = run_storage_monitor()
                run_storage_monitor()
            finally:
                if previous is None:
                    os.environ.pop("DOCUMENT_DB_WARN_GB", None)
                else:
                    os.environ["DOCUMENT_DB_WARN_GB"] = previous
        self.assertEqual(result["status"], "ACTION_NEEDED")
        alerts = Notification.objects.filter(event_key="documents.storage_threshold")
        self.assertEqual(list(alerts.values_list("user_id", flat=True)), [self.owner.id])
