"""Collapse the nightly alert pile-up into one open alert per condition.

Before the reconciliation kept alerts in place, every nightly run created a
fresh TXN_MISMATCH / STUCK_WIP / WEIGHT_MISMATCH / ORPHAN_ROLL / NEGATIVE_STOCK
row for the same condition. This command resolves those legacy rows (the ones
without a scope key) and then runs the reconciliation once, which raises one
keyed alert per condition that still exists. Safe to run more than once.

    python manage.py collapse_inventory_alerts --dry-run
    python manage.py collapse_inventory_alerts
"""
from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Count
from django.utils import timezone

from apps.factory.models import Plant
from apps.inventory.models import InventoryAlert
from apps.inventory.services.inventory_audit_service import InventoryAuditService

NOTE = "Collapsed: the nightly reconciliation now keeps one open alert per condition and resolves it when the condition clears."


class Command(BaseCommand):
    help = "Resolve duplicated nightly reconciliation alerts and re-raise the current ones once."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Report what would change without writing")

    def handle(self, *args, **options):
        legacy = InventoryAlert.objects.filter(
            type__in=InventoryAuditService.RECONCILIATION_ALERT_TYPES, resolved=False, scope_key=""
        )
        counts = {row["type"]: row["n"] for row in legacy.values("type").order_by().annotate(n=Count("id"))}
        self.stdout.write(f"Open legacy alerts without a scope key: {sum(counts.values())} {counts}")
        if options["dry_run"]:
            self.stdout.write("Dry run: nothing changed.")
            return

        with transaction.atomic():
            resolved = legacy.update(resolved=True, resolved_at=timezone.now(), resolution_note=NOTE)
            plants = list(Plant.objects.filter(include_in_official_reports=True).order_by("code"))
            summary = {}
            for plant in plants:
                summary[plant.code] = InventoryAuditService.run_full_audit(plant)
        open_now = InventoryAlert.objects.filter(type__in=InventoryAuditService.RECONCILIATION_ALERT_TYPES, resolved=False).count()
        self.stdout.write(f"Resolved {resolved} legacy alert(s). Reconciliation re-run: {summary}")
        self.stdout.write(f"Open reconciliation alerts now: {open_now}")
