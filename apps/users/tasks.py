import logging
from datetime import timedelta

from celery import shared_task
from django.utils import timezone

from apps.users.models import Notification, NotificationDeliveryAttempt, User
from apps.users.services.email_service import EmailDeliveryService

logger = logging.getLogger(__name__)


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=True, retry_jitter=True, max_retries=4)
def deliver_notification_email_task(self, notification_id: str):
    notification = Notification.objects.filter(id=notification_id).first()
    if not notification:
        return {"status": "skipped", "reason": "notification_not_found"}

    channels = [str(c).upper() for c in (notification.channels or ["IN_APP"])]
    if "EMAIL" not in channels:
        return {"status": "skipped", "reason": "channel_not_enabled"}

    recipients: list[str] = []
    if notification.user and notification.user.email:
        recipients.append(notification.user.email)
    elif notification.target_role:
        recipients.extend(
            list(
                User.objects.filter(role__code=notification.target_role)
                .exclude(email="")
                .values_list("email", flat=True)
            )
        )

    attempt = NotificationDeliveryAttempt.objects.filter(
        notification=notification,
        channel="EMAIL",
        status__in=["PENDING", "FAILED"],
    ).order_by("-created_at").first()

    if not attempt:
        attempt = NotificationDeliveryAttempt.objects.create(
            notification=notification,
            channel="EMAIL",
            status="PENDING",
            attempt_no=1,
            idempotency_key=f"{notification.id}:email:1",
            recipient=notification.target_role or "",
        )

    try:
        result = EmailDeliveryService.send_email(
            subject=notification.title,
            body=notification.message,
            recipients=recipients,
            idempotency_key=attempt.idempotency_key or f"{notification.id}:email:{attempt.attempt_no}",
        )
    except Exception as exc:
        attempt.status = "FAILED"
        attempt.error_text = str(exc)
        attempt.next_retry_at = timezone.now() + timedelta(minutes=2 ** min(self.request.retries + 1, 6))
        attempt.save(update_fields=["status", "error_text", "next_retry_at"])
        notification.delivery_state = {**(notification.delivery_state or {}), "EMAIL": "RETRYING"}
        notification.save(update_fields=["delivery_state"])
        if self.request.retries >= self.max_retries:
            attempt.next_retry_at = None
            attempt.save(update_fields=["next_retry_at"])
            notification.delivery_state = {**(notification.delivery_state or {}), "EMAIL": "FAILED"}
            notification.save(update_fields=["delivery_state"])
            try:
                from apps.platformops.models import OperationalAlert

                OperationalAlert.objects.create(
                    category="NOTIFICATIONS",
                    severity=OperationalAlert.Severity.WARNING,
                    message="Notification moved to dead-letter state",
                    details={
                        "notification_id": str(notification.id),
                        "event_key": notification.event_key,
                        "error": str(exc),
                    },
                )
            except Exception:
                logger.warning("Failed to persist notification dead-letter alert", exc_info=True)
            return {"status": "dead_lettered", "notification_id": notification_id}
        raise

    attempt.status = "SUCCEEDED"
    attempt.delivered_at = timezone.now()
    attempt.provider_message_id = str(result.get("provider_message_id") or "")
    attempt.error_text = ""
    attempt.meta = {
        "provider": result.get("provider"),
        "recipient_count": len(recipients),
    }
    attempt.save(update_fields=["status", "delivered_at", "provider_message_id", "error_text", "meta"])

    notification.delivery_state = {**(notification.delivery_state or {}), "EMAIL": "DELIVERED"}
    if not notification.first_delivered_at:
        notification.first_delivered_at = timezone.now()
    notification.save(update_fields=["delivery_state", "first_delivered_at"])

    return {"status": "delivered", "notification_id": notification_id, "recipient_count": len(recipients)}
