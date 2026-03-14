from django.core.management.base import BaseCommand
from django.db.models import Exists, OuterRef

from apps.inventory.models import InventoryRoll
from apps.production.models import FinishedGoodsBatch, PlannedStockOrder, ProductionJob
from apps.sales.models import SalesOrderItem
from apps.templates.models import TemplateBlueprint


class Command(BaseCommand):
    help = "Delete unreferenced legacy templates and hide referenced legacy templates from active use."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Apply the cleanup. Without this flag, the command runs in dry-run mode.",
        )

    def handle(self, *args, **options):
        apply_changes = bool(options.get("apply"))

        legacy_name_prefixes = ("Auto V2 Template", "API CHECK", "SMOKE")
        qs = (
            TemplateBlueprint.objects.annotate(
                has_sales=Exists(SalesOrderItem.objects.filter(template=OuterRef("pk"))),
                has_stock=Exists(PlannedStockOrder.objects.filter(template=OuterRef("pk"))),
                has_jobs=Exists(ProductionJob.objects.filter(template=OuterRef("pk"))),
                has_rolls=Exists(InventoryRoll.objects.filter(template=OuterRef("pk"))),
                has_batches=Exists(FinishedGoodsBatch.objects.filter(template=OuterRef("pk"))),
            )
            .order_by("created_at")
        )

        delete_ids = []
        obsolete_ids = []
        keep_ids = []

        for template in qs:
            has_references = any(
                [
                    bool(getattr(template, "has_sales", False)),
                    bool(getattr(template, "has_stock", False)),
                    bool(getattr(template, "has_jobs", False)),
                    bool(getattr(template, "has_rolls", False)),
                    bool(getattr(template, "has_batches", False)),
                ]
            )
            is_legacy = (
                not template.routing_rule_id
                or template.status == "OBSOLETE"
                or template.name.startswith(legacy_name_prefixes)
                or template.process_steps.count() == 0
            )

            if not is_legacy:
                keep_ids.append(template.id)
                continue

            if has_references:
                obsolete_ids.append(template.id)
            else:
                delete_ids.append(template.id)

        self.stdout.write(
            self.style.NOTICE(
                f"Template cleanup plan: keep={len(keep_ids)} hide_obsolete={len(obsolete_ids)} hard_delete={len(delete_ids)}"
            )
        )

        if not apply_changes:
            self.stdout.write(self.style.WARNING("Dry run only. Re-run with --apply to execute cleanup."))
            return

        deleted_count = 0
        if delete_ids:
            deleted_count, _ = TemplateBlueprint.objects.filter(id__in=delete_ids).delete()

        hidden_count = 0
        if obsolete_ids:
            hidden_count = TemplateBlueprint.objects.filter(id__in=obsolete_ids).exclude(status="OBSOLETE").update(status="OBSOLETE")

        self.stdout.write(
            self.style.SUCCESS(
                f"Template cleanup applied: deleted={deleted_count} marked_obsolete={hidden_count}"
            )
        )
