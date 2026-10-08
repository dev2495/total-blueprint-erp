"""Transaction-local, user-targeted inward bill alerts. No external delivery."""

from django.db import transaction
from django.db.models import Count

from apps.users.models import Notification, User
from apps.users.permission_service import PermissionService

EVENT_KEY = "gate.inward_bill_uploaded"
OBJECT_TYPE = "GateInwardBill"
QUEUE_LINK = "/inventory/gate-bills"


@transaction.atomic
def publish_bill_arrival(bill):
    """Persist once per eligible account, inside the bill upload transaction."""
    from .notification_service import NotificationService

    created_count = 0
    for user in User.objects.filter(is_active=True).select_related("role").iterator():
        if not PermissionService.has_inventory_bill_review(user):
            continue
        if not PermissionService.inventory_review_plants(user).filter(pk=bill.plant_id).exists():
            continue
        notification, created = Notification.objects.get_or_create(
            user=user, event_key=EVENT_KEY, related_object_id=bill.pk,
            defaults={
                "type": "SYSTEM", "title": "Inward bill ready for GRN",
                "message": f"A bill arrived at {bill.plant.name}. Review the saved pages and record or match its receipt.",
                "priority": "HIGH", "channels": ["IN_APP"],
                "related_object_type": OBJECT_TYPE, "plant_id": bill.plant_id,
                "deep_link": f"{QUEUE_LINK}/{bill.pk}",
                "idempotency_key": f"gate-bill:{bill.pk}:{user.pk}",
            },
        )
        if created:
            NotificationService._create_delivery_attempts(notification)
            created_count += 1
    return created_count


def visible_bill_notifications(queryset, user):
    """Recheck current real-account authority, including after role revocation."""
    from django.db.models import Q

    ordinary = ~Q(event_key=EVENT_KEY)
    if not PermissionService.has_inventory_bill_review(user):
        return queryset.filter(ordinary)
    return queryset.filter(ordinary | Q(event_key=EVENT_KEY, plant__in=PermissionService.inventory_review_plants(user)))


def pending_bill_summary(user, plant_id=None):
    from apps.gate.models import InwardBillIntake

    plants = PermissionService.inventory_review_plants(user)
    if plant_id:
        plants = plants.filter(pk=plant_id)
    pending = InwardBillIntake.objects.filter(plant__in=plants, status__in=["PENDING_GRN", "PARTIAL_GRN"])
    notices = Notification.objects.filter(
        user=user, event_key=EVENT_KEY, plant__in=plants, is_read=False,
    )
    return {
        "pending_count": pending.count(), "unread_count": notices.count(),
        "plant_counts": [
            {"plant": str(row["plant_id"]), "plant_name": row["plant__name"], "pending_count": row["pending_count"]}
            for row in pending.values("plant_id", "plant__name").annotate(pending_count=Count("id")).order_by("plant__name")
        ],
        "deep_link": QUEUE_LINK, "poll_interval_seconds": 5,
        "scope": "ALL_PLANTS",
    }
