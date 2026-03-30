from __future__ import annotations

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.users.models import Notification, NotificationDeliveryAttempt, NotificationRule, Role
from apps.users.permission_registry import effective_permissions_for_role
from apps.users.permission_service import PermissionService
from apps.users.role_catalog import CANONICAL_ROLE_LABELS, LEGACY_ROLE_CODE_ALIASES, get_canonical_role_code
from apps.users.services.notification_service import DEFAULT_EVENT_ROUTING


SAMPLE_INBOX_ROWS = [
    {
        "event_key": "sales.confirmed",
        "target_role": "PLANNER",
        "title": "New sales demand ready for planning",
        "message": "A confirmed sales order entered the planning queue and needs source selection.",
        "type": "ORDER_CREATED",
        "priority": "NORMAL",
    },
    {
        "event_key": "sales.planning_required",
        "target_role": "PLANNER",
        "title": "Artwork is still pending before release",
        "message": "Printing demand was confirmed without artwork. Planner must assign approved artwork before release.",
        "type": "SYSTEM",
        "priority": "HIGH",
    },
    {
        "event_key": "production.job_released",
        "target_role": "WORK_CENTER_MANAGER",
        "title": "Released job waiting for WCM readiness",
        "message": "A released job is ready for current-step readiness checks and policy review.",
        "type": "SYSTEM",
        "priority": "HIGH",
    },
    {
        "event_key": "production.machine_ready",
        "target_role": "OPERATOR",
        "title": "Machine queue has a ready assignment",
        "message": "An assigned machine has a ready job and can be started once setup is complete.",
        "type": "JOB_COMPLETE",
        "priority": "NORMAL",
    },
    {
        "event_key": "inventory.low_stock",
        "target_role": "STORE",
        "title": "Low stock exception requires review",
        "message": "A managed inventory line crossed its low stock threshold.",
        "type": "LOW_STOCK",
        "priority": "HIGH",
    },
    {
        "event_key": "inventory.grn_posted",
        "target_role": "STORE",
        "title": "GRN posted successfully",
        "message": "A goods receipt note posted stock and updated the inventory ledger.",
        "type": "SYSTEM",
        "priority": "NORMAL",
    },
    {
        "event_key": "inventory.interplant_dispatched",
        "target_role": "DISPATCH",
        "title": "Inter-plant transfer dispatched",
        "message": "A transfer challan has been dispatched and is now in transit.",
        "type": "DISPATCH_READY",
        "priority": "HIGH",
    },
    {
        "event_key": "inventory.interplant_received",
        "target_role": "PLANT_MANAGER",
        "title": "Inter-plant transfer received",
        "message": "An inbound inter-plant transfer was received and inventory is now available locally.",
        "type": "SYSTEM",
        "priority": "NORMAL",
    },
    {
        "event_key": "inventory.jobwork_dispatched",
        "target_role": "PLANNER",
        "title": "Jobwork order moved to vendor",
        "message": "A jobwork dispatch is now in vendor processing and should be tracked against due dates.",
        "type": "SYSTEM",
        "priority": "HIGH",
    },
    {
        "event_key": "inventory.jobwork_received",
        "target_role": "PLANNER",
        "title": "Jobwork material received back",
        "message": "Vendor-returned material has been received and is available for downstream planning.",
        "type": "SYSTEM",
        "priority": "NORMAL",
    },
    {
        "event_key": "logistics.dispatch_ready",
        "target_role": "DISPATCH",
        "title": "Dispatch pack is ready to move",
        "message": "A challan is ready. Dispatch can complete vehicle and document handoff now.",
        "type": "DISPATCH_READY",
        "priority": "HIGH",
    },
    {
        "event_key": "production.delayed",
        "target_role": "WORK_CENTER_MANAGER",
        "title": "Running job is delayed",
        "message": "A live job crossed its delay threshold and needs immediate floor attention.",
        "type": "DELAYED_JOB",
        "priority": "URGENT",
    },
    {
        "event_key": "production.fg_ready",
        "target_role": "DISPATCH",
        "title": "Finished goods batch ready for dispatch",
        "message": "A finished goods batch moved into dispatch-ready stock.",
        "type": "FG_READY",
        "priority": "NORMAL",
    },
    {
        "event_key": "reports.daily_pack_sent",
        "target_role": "ADMIN",
        "title": "Daily reports delivered",
        "message": "The daily production and stock standing report pipeline completed successfully.",
        "type": "SYSTEM",
        "priority": "LOW",
    },
    {
        "event_key": "reports.daily_pack_email_skipped",
        "target_role": "ADMIN",
        "title": "Daily reports generated without email",
        "message": "The report pack was generated and saved, but email delivery was skipped because the email provider is not configured.",
        "type": "SYSTEM",
        "priority": "NORMAL",
    },
    {
        "event_key": "reports.daily_pack_failed",
        "target_role": "OWNER",
        "title": "Daily report delivery failed",
        "message": "A scheduled report pack failed and needs admin review before the next send window.",
        "type": "SYSTEM",
        "priority": "HIGH",
    },
]


def _is_production_like() -> bool:
    environment = str(
        getattr(settings, "ENVIRONMENT", "")
        or getattr(settings, "APP_ENV", "")
        or getattr(settings, "DJANGO_ENV", "")
        or ""
    ).strip().lower()
    return bool(environment in {"prod", "production"} or (not settings.DEBUG and environment))


class Command(BaseCommand):
    help = "Seed canonical roles, notification rules, visibility signoffs, and sample unread inbox notifications for non-production QA."

    def add_arguments(self, parser):
        parser.add_argument(
            "--allow-production",
            action="store_true",
            help="Allow execution in production-like environments.",
        )
        parser.add_argument(
            "--skip-sample-inbox",
            action="store_true",
            help="Skip creation of sample unread notifications.",
        )

    def handle(self, *args, **options):
        if _is_production_like() and not options["allow_production"]:
            raise CommandError("Refusing to seed notification baseline in production-like environment without --allow-production.")

        role_updates = 0
        for role_code, role_name in CANONICAL_ROLE_LABELS.items():
            role, created = Role.objects.get_or_create(
                code=role_code,
                defaults={
                    "name": role_name,
                    "default_permissions": effective_permissions_for_role(role_code),
                },
            )
            changed = []
            if role.name != role_name:
                role.name = role_name
                changed.append("name")
            desired_permissions = effective_permissions_for_role(role_code)
            if list(role.default_permissions or []) != desired_permissions:
                role.default_permissions = desired_permissions
                changed.append("default_permissions")
            if created or changed:
                role.save(update_fields=changed or None)
                role_updates += 1

        for alias_code, canonical_code in LEGACY_ROLE_CODE_ALIASES.items():
            alias_role = Role.objects.filter(code=alias_code).first()
            if not alias_role:
                continue
            desired_name = CANONICAL_ROLE_LABELS.get(get_canonical_role_code(alias_code), alias_role.name)
            desired_permissions = effective_permissions_for_role(canonical_code)
            changed = []
            if alias_role.name != desired_name:
                alias_role.name = desired_name
                changed.append("name")
            if list(alias_role.default_permissions or []) != desired_permissions:
                alias_role.default_permissions = desired_permissions
                changed.append("default_permissions")
            if changed:
                alias_role.save(update_fields=changed)
                role_updates += 1

        seeded_rules = 0
        for event_key, route in DEFAULT_EVENT_ROUTING.items():
            defaults = {
                "target_roles": list(route.get("roles") or []),
                "channels": list(route.get("channels") or ["IN_APP"]),
                "priority": str(route.get("priority") or "NORMAL"),
                "active": True,
                "email_subject_template": f"{event_key.replace('.', ' ').title()}",
                "email_body_template": f"Event {event_key} was emitted and routed by the ERP notification baseline.",
            }
            _, created = NotificationRule.objects.update_or_create(event_key=event_key, defaults=defaults)
            if created:
                seeded_rules += 1

        signoff_result = PermissionService.bootstrap_visibility_signoffs()

        seeded_notifications = 0
        if not options["skip_sample_inbox"]:
            now = timezone.now()
            for row in SAMPLE_INBOX_ROWS:
                notification, created = Notification.objects.update_or_create(
                    idempotency_key=f"seed-notification:{row['event_key']}:{row['target_role']}",
                    defaults={
                        "event_key": row["event_key"],
                        "type": row["type"],
                        "title": row["title"],
                        "message": row["message"],
                        "target_role": row["target_role"],
                        "priority": row["priority"],
                        "channels": ["IN_APP"],
                        "is_read": False,
                        "read_at": None,
                        "related_object_type": "SeededBaseline",
                        "related_object_id": None,
                        "delivery_state": {"IN_APP": "DELIVERED"},
                        "first_delivered_at": now,
                    },
                )
                NotificationDeliveryAttempt.objects.update_or_create(
                    notification=notification,
                    channel="IN_APP",
                    attempt_no=1,
                    defaults={
                        "status": "SUCCEEDED",
                        "delivered_at": now,
                        "idempotency_key": f"{notification.id}:seed:in_app",
                        "recipient": row["target_role"],
                        "meta": {"seeded": True, "event_key": row["event_key"]},
                    },
                )
                refresh_fields = [
                    "event_key",
                    "type",
                    "title",
                    "message",
                    "target_role",
                    "priority",
                    "channels",
                    "is_read",
                    "read_at",
                    "related_object_type",
                    "delivery_state",
                    "first_delivered_at",
                ]
                notification.created_at = now
                notification.save(update_fields=refresh_fields + ["created_at"])
                if created:
                    seeded_notifications += 1

        self.stdout.write(
            self.style.SUCCESS(
                "Notification baseline ready: "
                f"{role_updates} role(s) aligned, "
                f"{seeded_rules} new rule(s), "
                f"{signoff_result.get('created_rows', 0)} signoff row(s), "
                f"{seeded_notifications} sample notification(s)."
            )
        )
