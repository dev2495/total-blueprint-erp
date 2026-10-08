from types import SimpleNamespace
from unittest.mock import patch
import uuid

from django.db import IntegrityError, connection, transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.factory.models import Plant
from apps.gate.models import GateAssignment, InwardBillIntake, InwardBillPage
from apps.users.models import Notification, NotificationDeliveryAttempt, NotificationRule, Role, User
from apps.users.permission_service import PermissionService
from apps.users.permission_registry import resolve_required_permission
from apps.users.services.bill_notifications import EVENT_KEY, publish_bill_arrival
from apps.users.services.notification_service import NotificationService


class PermissionRoleReadBudgetTests(TestCase):
    def test_unassigned_user_keeps_explicit_grants_without_loading_guest_role(self):
        Role.objects.create(code="GUEST", name="Guest", default_permissions=["sales.manage"])
        user = User.objects.create_user(username="unassigned-board", extra_permissions=["production.view"])
        with self.assertNumQueries(0):
            permissions = PermissionService.get_user_permissions(user)
        self.assertIn("production.view", permissions)
        self.assertNotIn("sales.manage", permissions)
        self.assertNotIn("gate.bill.review", permissions)

    def test_loaded_actual_role_retains_extensions_without_an_extra_query(self):
        role = Role.objects.create(code="RECEIPT_REVIEWER", name="Reviewer", default_permissions=["gate.bill.review", "inventory.manage"])
        user = User.objects.create_user(username="loaded-reviewer", role=role)
        with self.assertNumQueries(0):
            permissions = PermissionService.get_user_permissions(user)
        self.assertIn("inventory.manage", permissions)
        self.assertIn("gate.bill.review", permissions)

    def test_preview_still_reads_target_role_extensions_and_actual_review_ceiling(self):
        actual = Role.objects.create(code="SALES", name="Sales")
        Role.objects.create(code="STORE", name="Store", default_permissions=["inventory.audit.view"])
        user = User.objects.create_user(username="preview-role-query", role=actual)
        user.effective_role_code = "STORE"
        with self.assertNumQueries(1):
            permissions = PermissionService.get_user_permissions(user)
        self.assertIn("inventory.audit.view", permissions)
        self.assertNotIn("gate.bill.review", permissions)


@override_settings(STRICT_RBAC=True)
class InwardBillPermissionNotificationTests(TestCase):
    def setUp(self):
        self.plant = Plant.objects.create(code="BILL-A", name="Bill plant A")
        self.other_plant = Plant.objects.create(code="BILL-B", name="Bill plant B")
        self.owner = self.user("bill-owner", "OWNER")
        self.admin = self.user("bill-admin", "ADMIN")
        self.store = self.user("bill-store", "STORE")
        self.dispatch = self.user("bill-dispatch", "DISPATCH")
        self.sales = self.user("bill-sales", "SALES", extras=["*"])
        self.reader = self.user("bill-reader", "BILL_READER", extras=["gate.bill.review"])
        self.reviewer = self.user("bill-reviewer", "BILL_REVIEWER", extras=["gate.bill.review", "procurement.manage"])
        self.watchman = self.user("bill-watchman", "WATCHMAN", extras=["*", "gate.bill.review", "inventory.manage"], is_owner=True, is_superuser=True)
        self.inactive = self.user("bill-inactive", "STORE", is_active=False)
        self.bill = SimpleNamespace(pk=uuid.uuid4(), plant_id=self.plant.id, plant=self.plant, arrival_at=timezone.now(), status="PENDING_GRN")

    @staticmethod
    def user(username, code, extras=None, **flags):
        role, _ = Role.objects.get_or_create(code=code, defaults={"name": code})
        return User.objects.create_user(username=username, email=f"{username}@example.test", role=role, extra_permissions=extras or [], **flags)

    @staticmethod
    def client_for(user):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
        return client

    def test_previous_image_can_insert_notification_without_added_columns(self):
        legacy = Notification(user=self.store, type="SYSTEM", title="Legacy notice", message="Existing workflow", created_at=timezone.now())
        fields = [field for field in Notification._meta.local_concrete_fields if field.name not in {"plant", "deep_link"}]
        columns = ", ".join(connection.ops.quote_name(field.column) for field in fields)
        values = [field.get_db_prep_save(field.value_from_object(legacy), connection) for field in fields]
        placeholders = ", ".join(["%s"] * len(fields))
        with connection.cursor() as cursor:
            cursor.execute(f"INSERT INTO {connection.ops.quote_name(Notification._meta.db_table)} ({columns}) VALUES ({placeholders})", values)
        saved = Notification.objects.get(pk=legacy.pk)
        self.assertEqual(saved.deep_link, "")
        self.assertIsNone(saved.plant_id)

    def test_actual_receipt_eligibility_and_global_existing_scope(self):
        for user in (self.owner, self.admin, self.store, self.reviewer):
            with self.subTest(user=user.pk):
                self.assertTrue(PermissionService.has_inventory_bill_review(user))
                self.assertEqual(set(PermissionService.inventory_review_plants(user).values_list("id", flat=True)), {self.plant.id, self.other_plant.id})
                self.assertTrue(PermissionService.get_entitlements(user)["inventory_bill_review"])
        for user in (self.dispatch, self.sales, self.reader, self.watchman, self.inactive):
            with self.subTest(user=user.pk):
                self.assertFalse(PermissionService.has_inventory_bill_review(user))
                self.assertFalse(PermissionService.inventory_review_plants(user).exists())

    def test_role_preview_does_not_grant_receipt_access_and_watchman_ceiling_wins(self):
        self.sales.effective_role_code = "STORE"
        self.assertFalse(PermissionService.has_inventory_bill_review(self.sales))
        self.assertNotIn("gate.bill.review", PermissionService.get_user_permissions(self.sales))
        self.admin.effective_role_code = "WATCHMAN"
        self.assertFalse(PermissionService.has_inventory_bill_review(self.admin))
        self.assertNotIn("gate.bill.review", PermissionService.get_user_permissions(self.admin))
        self.watchman.effective_role_code = "OWNER"
        self.assertFalse(PermissionService.has_inventory_bill_review(self.watchman))

    @patch("apps.users.tasks.deliver_notification_email_task.delay")
    def test_saved_notification_is_user_targeted_deduplicated_and_never_external(self, deliver_email):
        NotificationRule.objects.create(event_key=EVENT_KEY, target_roles=["SALES"], channels=["EMAIL"], priority="URGENT")
        self.assertEqual(publish_bill_arrival(self.bill), 4)
        self.assertEqual(publish_bill_arrival(self.bill), 0)
        notices = Notification.objects.filter(event_key=EVENT_KEY)
        self.assertEqual(set(notices.values_list("user_id", flat=True)), {self.owner.id, self.admin.id, self.store.id, self.reviewer.id})
        self.assertEqual(set(notices.values_list("target_role", flat=True)), {""})
        self.assertTrue(all(n.channels == ["IN_APP"] and n.delivery_state == {"IN_APP": "DELIVERED"} for n in notices))
        self.assertEqual(NotificationDeliveryAttempt.objects.filter(channel="IN_APP", status="SUCCEEDED").count(), 4)
        self.assertEqual(set(NotificationDeliveryAttempt.objects.values_list("recipient", flat=True)), {str(self.owner.pk), str(self.admin.pk), str(self.store.pk), str(self.reviewer.pk)})
        self.assertFalse(NotificationDeliveryAttempt.objects.filter(channel="EMAIL").exists())
        deliver_email.assert_not_called()
        with self.assertRaises(IntegrityError), transaction.atomic():
            Notification.objects.create(user=self.store, event_key=EVENT_KEY, related_object_id=self.bill.pk, type="SYSTEM", title="duplicate", message="duplicate")
        self.assertEqual(notices.count(), 4)

    def test_bill_and_notifications_share_transaction_rollback(self):
        with self.assertRaises(RuntimeError), transaction.atomic():
            publish_bill_arrival(self.bill)
            raise RuntimeError("upload transaction aborted")
        self.assertFalse(Notification.objects.filter(event_key=EVENT_KEY).exists())
        self.assertFalse(NotificationDeliveryAttempt.objects.exists())

    def test_notifications_are_per_user_and_recheck_revoked_authority(self):
        publish_bill_arrival(self.bill)
        store_notice = Notification.objects.get(user=self.store, event_key=EVENT_KEY)
        response = self.client_for(self.store).get("/api/users/notifications/list/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["plant"], str(self.plant.id))
        self.assertEqual(response.data[0]["deep_link"], f"/inventory/gate-bills/{self.bill.pk}")
        self.assertEqual(response["Cache-Control"], "private, no-store")
        self.assertEqual(self.client_for(self.store).get("/api/auth/notifications/list/").data, response.data)
        self.assertEqual(self.client_for(self.sales).post(f"/api/users/notifications/{store_notice.pk}/mark-read/").status_code, 404)
        self.assertFalse(NotificationService.mark_as_read(store_notice.pk, self.reviewer))
        self.assertEqual(NotificationService.get_unread_count(self.store), 1)
        self.store.role = self.sales.role
        self.store.save(update_fields=["role"])
        self.assertEqual(NotificationService.get_unread_count(self.store), 0)
        self.assertFalse(NotificationService.mark_as_read(store_notice.pk, self.store))
        self.assertEqual(list(NotificationService.get_notifications_for_user(self.store)), [])
        store_notice.refresh_from_db()
        self.assertFalse(store_notice.is_read)

    def test_user_without_role_never_inherits_other_user_empty_role_targets(self):
        publish_bill_arrival(self.bill)
        actor = User.objects.create_user(username="bill-no-role", extra_permissions=["gate.bill.review", "inventory.manage"])
        self.assertTrue(PermissionService.has_inventory_bill_review(actor))
        self.assertEqual(NotificationService.get_unread_count(actor), 0)
        self.assertEqual(list(NotificationService.get_notifications_for_user(actor)), [])
        other_notice = Notification.objects.get(user=self.store, event_key=EVENT_KEY)
        self.assertFalse(NotificationService.mark_as_read(other_notice.pk, actor))

    def intake(self, plant=None, status="PENDING_GRN", **kwargs):
        return InwardBillIntake.objects.create(plant=plant or self.plant, created_by=self.watchman, status=status, content_hash=uuid.uuid4().hex, **kwargs)

    def test_pending_summary_includes_partial_separates_plant_and_read_state(self):
        first = self.intake()
        self.intake(status="PARTIAL_GRN")
        self.intake(plant=self.other_plant)
        self.intake(status="RECEIPTED", resolved_at=timezone.now())
        self.intake(status="VOID", resolved_at=timezone.now())
        publish_bill_arrival(first)
        client = self.client_for(self.store)
        response = client.get("/api/users/notifications/inward-bill-summary/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data["pending_count"], 3)
        self.assertEqual(response.data["unread_count"], 1)
        response = client.get(f"/api/users/notifications/inward-bill-summary/?plant={self.plant.pk}")
        self.assertEqual(response.data["pending_count"], 2)
        self.assertEqual(response.data["plant_counts"], [{"plant": str(self.plant.pk), "plant_name": self.plant.name, "pending_count": 2}])
        notice = Notification.objects.get(user=self.store, related_object_id=first.pk)
        self.assertEqual(client.post(f"/api/users/notifications/{notice.pk}/mark-read/").status_code, 200)
        response = client.get("/api/users/notifications/inward-bill-summary/")
        self.assertEqual(response.data["unread_count"], 0)
        self.assertEqual(response.data["pending_count"], 3)
        self.assertEqual(client.get("/api/users/notifications/inward-bill-summary/?plant=bad").status_code, 400)
        self.assertEqual(client.get(f"/api/users/notifications/inward-bill-summary/?plant={uuid.uuid4()}").status_code, 404)
        self.assertEqual(self.client_for(self.dispatch).get("/api/users/notifications/inward-bill-summary/").status_code, 403)

    def test_real_jwt_bill_capture_reads_and_inventory_action_mapping(self):
        bill = self.intake()
        page = InwardBillPage.objects.create(intake=bill, page_number=1, data=b"private-test-jpeg", width=640, height=640, byte_size=17, sha256="f" * 64)
        GateAssignment.objects.create(user=self.watchman, plant=self.plant)
        other = self.intake(plant=self.other_plant)
        guard = self.client_for(self.watchman)
        for path in ("/api/gate/inward-bills/", "/api/gate/inward-bills", f"/api/gate/inward-bills/{bill.pk}/", f"/api/gate/inward-bills/{bill.pk}/pages/{page.pk}/"):
            with self.subTest(path=path):
                self.assertEqual(guard.get(path).status_code, 200)
        for path in (f"/api/gate/inward-bills/{bill.pk}/receipt-candidates/", f"/api/gate/inward-bills/{bill.pk}/review/", f"/api/gate/inward-bills/{bill.pk}/complete/"):
            with self.subTest(path=path):
                self.assertEqual(guard.get(path).status_code, 403)
                self.assertEqual(guard.post(path, {"client_token": str(uuid.uuid4())}, format="json").status_code, 403)
        self.assertEqual(guard.get(f"/api/gate/inward-bills/{other.pk}/").status_code, 404)
        self.assertEqual(guard.get("/api/gate/inward-bills/?status=ALL").status_code, 403)
        response = self.client_for(self.store).post(f"/api/gate/inward-bills/{bill.pk}/review/", {"client_token": str(uuid.uuid4()), "invoice_number": "Inventory typed invoice"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        for actor in (self.sales, self.dispatch, self.reader):
            with self.subTest(actor=actor.pk):
                self.assertEqual(self.client_for(actor).get(f"/api/gate/inward-bills/{bill.pk}/").status_code, 403)
        self.assertEqual(resolve_required_permission(f"/api/gate/inward-bills/{bill.pk}/review/", "POST"), "gate.bill.review")
        self.assertEqual(resolve_required_permission("/api/gate/inward-bills/", "POST"), "gate.bill.submit")

    @override_settings(ALLOW_ROLE_OVERRIDE=True)
    def test_ordinary_jwt_watchman_preview_cannot_read_saved_bill_alert(self):
        publish_bill_arrival(self.bill)
        response = self.client_for(self.admin).get("/api/users/notifications/list/", HTTP_X_ROLE_OVERRIDE="WATCHMAN")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.client_for(self.watchman).get("/api/users/notifications/inward-bill-summary/").status_code, 403)
