"""
Notification Service - production-grade routing and delivery.
"""

import logging
import uuid
from typing import Iterable, List, Optional

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.users.models import Notification, NotificationDeliveryAttempt, NotificationRule, User
from apps.users.role_catalog import get_canonical_role_code

logger = logging.getLogger(__name__)


DEFAULT_EVENT_ROUTING = {
    "sales.confirmed": {"roles": ["PLANNER"], "channels": ["IN_APP"], "priority": "NORMAL"},
    "sales.planning_required": {"roles": ["PLANNER"], "channels": ["IN_APP"], "priority": "HIGH"},
    "production.job_released": {"roles": ["WORK_CENTER_MANAGER"], "channels": ["IN_APP"], "priority": "HIGH"},
    "production.machine_ready": {"roles": ["OPERATOR"], "channels": ["IN_APP"], "priority": "NORMAL"},
    "production.fg_ready": {"roles": ["DISPATCH", "STORE"], "channels": ["IN_APP"], "priority": "NORMAL"},
    "logistics.dispatch_ready": {"roles": ["DISPATCH"], "channels": ["IN_APP"], "priority": "HIGH"},
    "production.delayed": {"roles": ["PLANNER", "WORK_CENTER_MANAGER"], "channels": ["IN_APP", "EMAIL"], "priority": "URGENT"},
    "inventory.low_stock": {"roles": ["STORE", "PLANNER"], "channels": ["IN_APP", "EMAIL"], "priority": "HIGH"},
    "inventory.grn_posted": {"roles": ["STORE", "PLANNER"], "channels": ["IN_APP"], "priority": "NORMAL"},
    "inventory.interplant_dispatched": {"roles": ["STORE", "DISPATCH", "PLANT_MANAGER"], "channels": ["IN_APP"], "priority": "HIGH"},
    "inventory.interplant_received": {"roles": ["STORE", "PLANT_MANAGER"], "channels": ["IN_APP"], "priority": "NORMAL"},
    "inventory.jobwork_dispatched": {"roles": ["STORE", "PLANNER"], "channels": ["IN_APP"], "priority": "HIGH"},
    "inventory.jobwork_received": {"roles": ["STORE", "PLANNER"], "channels": ["IN_APP"], "priority": "NORMAL"},
    "reports.daily_pack_sent": {"roles": ["OWNER", "ADMIN"], "channels": ["IN_APP", "EMAIL"], "priority": "LOW"},
    "reports.daily_pack_email_skipped": {"roles": ["OWNER", "ADMIN"], "channels": ["IN_APP"], "priority": "NORMAL"},
    "reports.daily_pack_failed": {"roles": ["OWNER", "ADMIN"], "channels": ["IN_APP", "EMAIL"], "priority": "HIGH"},
}


class NotificationService:
    """Service for creating, routing, and delivering notifications."""

    @staticmethod
    def _canonical_role_code(value: Optional[str]) -> str:
        return str(get_canonical_role_code(value) or "").strip().upper()

    @staticmethod
    def _normalize_related_object_id(value: Optional[str]):
        raw = str(value or "").strip()
        if not raw:
            return None
        try:
            return uuid.UUID(raw)
        except (ValueError, TypeError, AttributeError):
            logger.warning("Skipping non-UUID related_object_id for notification payload: %s", raw)
            return None

    @classmethod
    def _resolve_rule(
        cls,
        event_key: Optional[str],
        target_role: Optional[str],
        channels: Optional[Iterable[str]],
        priority: str,
    ):
        normalized_event = str(event_key or "").strip()
        if normalized_event:
            db_rule = NotificationRule.objects.filter(event_key=normalized_event, active=True).first()
            if db_rule:
                return {
                    "event_key": normalized_event,
                    "roles": list(db_rule.target_roles or []),
                    "channels": list(db_rule.channels or ["IN_APP"]),
                    "priority": db_rule.priority or priority,
                }

            fallback = DEFAULT_EVENT_ROUTING.get(normalized_event)
            if fallback:
                return {
                    "event_key": normalized_event,
                    "roles": list(fallback.get("roles") or []),
                    "channels": list(fallback.get("channels") or ["IN_APP"]),
                    "priority": str(fallback.get("priority") or priority),
                }

        role_list = [cls._canonical_role_code(target_role)] if target_role else []
        return {
            "event_key": normalized_event,
            "roles": [r for r in role_list if r],
            "channels": list(channels or ["IN_APP"]),
            "priority": priority,
        }

    @classmethod
    def _create_delivery_attempts(cls, notification: Notification):
        channels = [str(c).upper() for c in (notification.channels or ["IN_APP"])]
        if "IN_APP" in channels:
            NotificationDeliveryAttempt.objects.create(
                notification=notification,
                channel="IN_APP",
                status="SUCCEEDED",
                attempt_no=1,
                delivered_at=timezone.now(),
                idempotency_key=f"{notification.id}:in_app",
                recipient=(notification.user.username if notification.user else notification.target_role),
                meta={"reason": "in_app_persistence"},
            )

        if "EMAIL" in channels:
            NotificationDeliveryAttempt.objects.create(
                notification=notification,
                channel="EMAIL",
                status="PENDING",
                attempt_no=1,
                idempotency_key=f"{notification.id}:email:1",
                recipient=notification.target_role or (notification.user.email if notification.user else ""),
            )
            from apps.users.tasks import deliver_notification_email_task

            deliver_notification_email_task.delay(str(notification.id))

        state = {c: "QUEUED" for c in channels}
        if "IN_APP" in channels:
            state["IN_APP"] = "DELIVERED"
        notification.delivery_state = state
        notification.first_delivered_at = timezone.now() if "IN_APP" in channels else None
        notification.save(update_fields=["delivery_state", "first_delivered_at"])

    @classmethod
    @transaction.atomic
    def create_notification(
        cls,
        notification_type: str,
        title: str,
        message: str,
        user=None,
        target_role: str = None,
        related_object_type: str = None,
        related_object_id: str = None,
        priority: str = 'NORMAL',
        event_key: str = None,
        channels: Optional[Iterable[str]] = None,
        idempotency_key: str = None,
    ) -> Notification:
        if idempotency_key:
            existing = Notification.objects.filter(
                Q(idempotency_key=idempotency_key) | Q(idempotency_key__startswith=f"{idempotency_key}:")
            ).order_by("created_at").first()
            if existing:
                return existing

        rule = cls._resolve_rule(event_key=event_key, target_role=target_role, channels=channels, priority=priority)
        target_roles = list(
            dict.fromkeys(
                cls._canonical_role_code(r)
                for r in (rule.get("roles") or [])
                if cls._canonical_role_code(r)
            )
        )
        target_channels = list(dict.fromkeys([str(c).upper() for c in (rule.get("channels") or ["IN_APP"]) if c]))
        effective_priority = str(rule.get("priority") or priority)

        # If explicit user is provided, always keep user-targeted path.
        notifications: List[Notification] = []
        normalized_related_object_id = cls._normalize_related_object_id(related_object_id)
        if user is not None:
            notification = Notification.objects.create(
                event_key=rule.get("event_key", ""),
                type=notification_type,
                title=title,
                message=message,
                user=user,
                target_role='',
                related_object_type=related_object_type or '',
                related_object_id=normalized_related_object_id,
                priority=effective_priority,
                channels=target_channels,
                idempotency_key=idempotency_key or '',
            )
            notifications.append(notification)
        elif target_roles:
            for idx, role_code in enumerate(target_roles):
                role_idempotency = idempotency_key
                if role_idempotency and len(target_roles) > 1:
                    role_idempotency = f"{idempotency_key}:{role_code}"
                notification = Notification.objects.create(
                    event_key=rule.get("event_key", ""),
                    type=notification_type,
                    title=title,
                    message=message,
                    user=None,
                    target_role=role_code,
                    related_object_type=related_object_type or '',
                    related_object_id=normalized_related_object_id,
                    priority=effective_priority,
                    channels=target_channels,
                    idempotency_key=role_idempotency or '',
                )
                notifications.append(notification)
        else:
            notification = Notification.objects.create(
                event_key=rule.get("event_key", ""),
                type=notification_type,
                title=title,
                message=message,
                user=None,
                    target_role=cls._canonical_role_code(target_role),
                related_object_type=related_object_type or '',
                related_object_id=normalized_related_object_id,
                priority=effective_priority,
                channels=target_channels,
                idempotency_key=idempotency_key or '',
            )
            notifications.append(notification)

        for notification in notifications:
            cls._create_delivery_attempts(notification)

        return notifications[0]

    @classmethod
    def notify_fg_ready(cls, fg_batch):
        return cls.create_notification(
            notification_type='FG_READY',
            event_key='production.fg_ready',
            title=f"FG Batch Ready: {fg_batch.batch_number}",
            message=f"Finished goods batch {fg_batch.batch_number} is ready for packing. Qty: {fg_batch.qty_pcs} pcs.",
            target_role='DISPATCH',
            related_object_type='FinishedGoodsBatch',
            related_object_id=str(fg_batch.id),
            priority='NORMAL'
        )

    @classmethod
    def notify_challan_created(cls, challan, challan_type='DISPATCH'):
        return cls.create_notification(
            notification_type='CHALLAN_CREATED',
            event_key='logistics.dispatch_ready',
            title="Challan Created",
            message="Delivery challan has been created and is ready for dispatch.",
            target_role='DISPATCH',
            related_object_type='DeliveryChallan',
            related_object_id=str(challan.id),
            priority='NORMAL'
        )

    @classmethod
    def notify_low_stock(cls, material, current_qty, threshold):
        return cls.create_notification(
            notification_type='LOW_STOCK',
            event_key='inventory.low_stock',
            title=f"Low Stock: {material.name}",
            message=f"Stock of {material.name} is low. Current: {current_qty}kg, Threshold: {threshold}kg.",
            target_role='STORE',
            related_object_type='InventoryMaterial',
            related_object_id=str(material.id),
            priority='HIGH'
        )

    @classmethod
    def notify_high_scrap(cls, job, scrap_percent):
        return cls.create_notification(
            notification_type='SCRAP_HIGH',
            event_key='production.delayed',
            title=f"High Scrap Rate: Job {job.job_number}",
            message=f"Job {job.job_number} has a scrap rate of {scrap_percent:.1f}%. Review required.",
            target_role='PLANNER',
            related_object_type='ProductionJob',
            related_object_id=str(job.id),
            priority='HIGH'
        )

    @classmethod
    def notify_delayed_job(cls, job, delay_hours):
        return cls.create_notification(
            notification_type='DELAYED_JOB',
            event_key='production.delayed',
            title=f"Delayed Job: {job.job_number}",
            message=f"Job {job.job_number} is delayed by {delay_hours:.0f} hours. Review priority.",
            target_role='PLANNER',
            related_object_type='ProductionJob',
            related_object_id=str(job.id),
            priority='URGENT'
        )

    @classmethod
    def notify_job_complete(cls, job):
        return cls.create_notification(
            notification_type='JOB_COMPLETE',
            event_key='production.machine_ready',
            title=f"Job Complete: {job.job_number}",
            message=f"Production job {job.job_number} has been completed.",
            target_role='PLANNER',
            related_object_type='ProductionJob',
            related_object_id=str(job.id),
            priority='LOW'
        )

    @classmethod
    def emit_event(
        cls,
        event_key: str,
        title: str,
        message: str,
        notification_type: str = "SYSTEM",
        related_object_type: str = "",
        related_object_id: str = None,
        priority: str = "NORMAL",
        idempotency_key: str = None,
    ) -> Notification:
        return cls.create_notification(
            notification_type=notification_type,
            title=title,
            message=message,
            target_role=None,
            related_object_type=related_object_type,
            related_object_id=related_object_id,
            priority=priority,
            event_key=event_key,
            idempotency_key=idempotency_key,
        )

    @classmethod
    def get_notifications_for_user(cls, user, include_unread_only=False, limit=50):
        role_code = cls._canonical_role_code(getattr(getattr(user, "role", None), "code", ""))
        qs = Notification.objects.filter(
            Q(user=user) | Q(target_role=role_code)
        )

        if include_unread_only:
            qs = qs.filter(is_read=False)

        return qs.order_by('-created_at')[:limit]

    @classmethod
    def mark_as_read(cls, notification_id, user):
        try:
            notification = Notification.objects.get(id=notification_id)
            role_code = cls._canonical_role_code(getattr(getattr(user, "role", None), "code", ""))
            if notification.user == user or notification.target_role == role_code:
                notification.is_read = True
                notification.read_at = timezone.now()
                notification.save(update_fields=['is_read', 'read_at'])
                return True
        except Notification.DoesNotExist:
            pass
        return False

    @classmethod
    def get_unread_count(cls, user):
        role_code = cls._canonical_role_code(getattr(getattr(user, "role", None), "code", ""))

        return Notification.objects.filter(
            Q(user=user) | Q(target_role=role_code),
            is_read=False
        ).count()

    @classmethod
    def get_rules(cls):
        return NotificationRule.objects.filter(active=True).order_by('event_key')
