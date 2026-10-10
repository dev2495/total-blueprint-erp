"""Transaction-local, user-targeted inward bill alerts. No external delivery."""

from django.db import transaction
from django.db.models import Count, Q

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
        if not (PermissionService.has_inventory_bill_review(user) or PermissionService.has_document_permission(user, "documents.manage")):
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


# Document events (bills, outward photos, gate passes, job work, reminders).
# Each event key names the document permission a reader must hold *now*; a
# notification stays hidden after that right is revoked.
DOCUMENT_EVENT_PERMISSIONS = {}


def register_document_event(event_key, permission_code):
    from apps.users.permission_registry import DOCUMENT_PERMISSIONS

    if permission_code not in DOCUMENT_PERMISSIONS and permission_code != "inventory.bill_review":
        raise ValueError(f"Unknown document permission {permission_code}")
    DOCUMENT_EVENT_PERMISSIONS[event_key] = permission_code


def _holds(user, permission_code):
    if permission_code == "inventory.bill_review":
        return PermissionService.has_inventory_bill_review(user)
    return PermissionService.has_document_permission(user, permission_code)


@transaction.atomic
def publish_document_event(*, event_key, plant, object_id, object_type, title, message, deep_link, priority="NORMAL", dedupe_suffix=""):
    """Persist one IN_APP notification per account that currently holds the
    event's registered permission. Idempotent per (event, object, user[, suffix]).
    Call inside the business transaction so alerts commit with the record."""
    from .notification_service import NotificationService

    # Notification.priority accepts LOW / NORMAL / HIGH / URGENT; "MEDIUM" is a
    # common caller spelling of NORMAL, anything else falls back to NORMAL.
    valid = {code for code, _ in Notification.PRIORITY_CHOICES}
    priority = str(priority or "NORMAL").upper()
    priority = "NORMAL" if priority == "MEDIUM" or priority not in valid else priority
    permission_code = DOCUMENT_EVENT_PERMISSIONS.get(event_key)
    if not permission_code:
        raise ValueError(f"Register document event {event_key} before publishing it.")
    created_count = 0
    for user in User.objects.filter(is_active=True).select_related("role").iterator():
        if not _holds(user, permission_code):
            continue
        # Notification.idempotency_key is 120 chars: hash the long natural key.
        import hashlib
        natural = f"{event_key}:{object_id}:{user.pk}" + (f":{dedupe_suffix}" if dedupe_suffix else "")
        key = f"doc:{hashlib.sha256(natural.encode()).hexdigest()}"
        notification, created = Notification.objects.get_or_create(
            user=user, idempotency_key=key,
            defaults={
                "event_key": event_key, "type": "SYSTEM", "title": title[:255], "message": message,
                "priority": priority, "channels": ["IN_APP"], "related_object_type": object_type,
                "related_object_id": object_id, "plant_id": getattr(plant, "pk", plant), "deep_link": deep_link,
            },
        )
        if created:
            NotificationService._create_delivery_attempts(notification)
            created_count += 1
    return created_count


def visible_bill_notifications(queryset, user):
    """Recheck current real-account authority, including after role revocation."""
    from django.db.models import Q

    hidden = Q(event_key=EVENT_KEY) if not PermissionService.has_inventory_bill_review(user) and not PermissionService.has_document_permission(user, "documents.view") else Q(pk__in=[])
    for event_key, permission_code in DOCUMENT_EVENT_PERMISSIONS.items():
        if not _holds(user, permission_code):
            hidden |= Q(event_key=event_key)
    return queryset.exclude(hidden)


def summary_plants(user):
    """Plants whose bill queue this account may count: receipt review or documents.view."""
    from apps.factory.models import Plant

    plants = Plant.objects.none()
    if PermissionService.has_inventory_bill_review(user):
        plants = plants | PermissionService.inventory_review_plants(user)
    if PermissionService.has_document_permission(user, "documents.view"):
        plants = plants | PermissionService.document_plants(user)
    return plants


def pending_bill_summary(user, plant_id=None):
    from apps.gate.models import InwardBillIntake

    plants = summary_plants(user)
    if plant_id:
        plants = plants.filter(pk=plant_id)
    pending = InwardBillIntake.objects.filter(plant__in=plants, status__in=["PENDING_GRN", "PARTIAL_GRN"])
    notices = Notification.objects.filter(
        user=user, event_key=EVENT_KEY, plant__in=plants, is_read=False,
    )
    counts = pending.aggregate(
        pending_count=Count("id"),
        needs_classifying=Count("id", filter=Q(category="")),
        waiting_receipt=Count("id", filter=Q(status="PENDING_GRN") & ~Q(category="")),
        partial_count=Count("id", filter=Q(status="PARTIAL_GRN")),
    )
    return {
        "pending_count": counts["pending_count"], "unread_count": notices.count(),
        # Document inbox split (documents.view scope): open with no category yet,
        # classified and waiting for its first receipt, and partly received.
        "needs_classifying": counts["needs_classifying"], "waiting_receipt": counts["waiting_receipt"], "partial_count": counts["partial_count"],
        "plant_counts": [
            {"plant": str(row["plant_id"]), "plant_name": row["plant__name"], "pending_count": row["pending_count"]}
            for row in pending.values("plant_id", "plant__name").annotate(pending_count=Count("id")).order_by("plant__name")
        ],
        "deep_link": QUEUE_LINK, "poll_interval_seconds": 5,
        "scope": "ALL_PLANTS",
    }
