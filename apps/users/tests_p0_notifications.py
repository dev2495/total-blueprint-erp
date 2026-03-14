from unittest.mock import patch

from django.test import TestCase

from apps.users.models import Notification, NotificationDeliveryAttempt, Role, User
from apps.users.services.notification_service import NotificationService


class NotificationP0Tests(TestCase):
    def setUp(self):
        self.dispatch_role = Role.objects.create(
            code="DISPATCH",
            name="Dispatch",
            default_permissions=["notifications.view"],
        )
        self.store_role = Role.objects.create(
            code="STORE",
            name="Store",
            default_permissions=["notifications.view"],
        )
        self.dispatch_user = User.objects.create_user(
            username="dispatch1",
            email="dispatch1@example.com",
            password="pass1234",
            role=self.dispatch_role,
        )

    @patch("apps.users.tasks.deliver_notification_email_task.delay")
    def test_fg_ready_routes_in_app_only_for_dispatch_and_store(self, mock_delay):
        NotificationService.emit_event(
            event_key="production.fg_ready",
            notification_type="FG_READY",
            title="FG Ready",
            message="Batch is ready",
            related_object_type="FinishedGoodsBatch",
            priority="NORMAL",
            idempotency_key="event-fg-1",
        )

        role_targets = sorted(Notification.objects.values_list("target_role", flat=True))
        self.assertEqual(role_targets, ["DISPATCH", "STORE"])

        attempts = NotificationDeliveryAttempt.objects.filter(channel="EMAIL").count()
        self.assertEqual(attempts, 0)
        self.assertEqual(mock_delay.call_count, 0)

    @patch("apps.users.tasks.deliver_notification_email_task.delay")
    def test_low_stock_routes_email_for_critical_store_alerts(self, mock_delay):
        NotificationService.emit_event(
            event_key="inventory.low_stock",
            notification_type="LOW_STOCK",
            title="Low stock",
            message="Reorder now",
            idempotency_key="stock-alert-email-1",
        )

        attempts = NotificationDeliveryAttempt.objects.filter(channel="EMAIL").count()
        self.assertEqual(attempts, 2)
        self.assertEqual(mock_delay.call_count, 2)

    @patch("apps.users.tasks.deliver_notification_email_task.delay")
    def test_idempotency_prevents_duplicates(self, _mock_delay):
        NotificationService.emit_event(
            event_key="inventory.low_stock",
            notification_type="LOW_STOCK",
            title="Low stock",
            message="Reorder now",
            idempotency_key="stock-alert-abc",
        )
        initial_count = Notification.objects.count()
        NotificationService.emit_event(
            event_key="inventory.low_stock",
            notification_type="LOW_STOCK",
            title="Low stock",
            message="Reorder now",
            idempotency_key="stock-alert-abc",
        )
        self.assertEqual(Notification.objects.count(), initial_count)

    @patch("apps.users.tasks.deliver_notification_email_task.delay")
    def test_non_uuid_related_object_id_is_soft_ignored(self, _mock_delay):
        notification = NotificationService.emit_event(
            event_key="reports.daily_pack_failed",
            notification_type="SYSTEM",
            title="Report failed",
            message="Preview audit run created",
            related_object_type="ReportDispatchRun",
            related_object_id="1",
            idempotency_key="report-failed-soft-ignore",
        )

        self.assertIsNone(notification.related_object_id)

    @patch("apps.users.tasks.deliver_notification_email_task.delay")
    def test_report_email_skipped_is_in_app_only(self, mock_delay):
        NotificationService.emit_event(
            event_key="reports.daily_pack_email_skipped",
            notification_type="SYSTEM",
            title="Report email skipped",
            message="PDF and workbook were generated locally but email is not configured.",
            idempotency_key="report-email-skipped-1",
        )

        attempts = NotificationDeliveryAttempt.objects.filter(channel="EMAIL").count()
        self.assertEqual(attempts, 0)
        self.assertEqual(mock_delay.call_count, 0)
