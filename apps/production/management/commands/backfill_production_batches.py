from django.core.management.base import BaseCommand

from apps.production.models import ProductionJob
from apps.production.services.batch_route_service import BatchExecutionService


class Command(BaseCommand):
    help = "Backfill one legacy production batch per sales-order line for existing jobs without batch identity."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Report affected sales-order lines without writing.")
        parser.add_argument("--limit", type=int, default=0, help="Maximum number of sales-order lines to process.")
        parser.add_argument(
            "--sales-order-item-id",
            dest="sales_order_item_id",
            default="",
            help="Restrict backfill to one sales-order line id.",
        )
        parser.add_argument("--chunk-size", type=int, default=500, help="Candidate job stream chunk size.")

    def handle(self, *args, **options):
        dry_run = bool(options.get("dry_run"))
        limit = int(options.get("limit") or 0)
        sales_order_item_id = str(options.get("sales_order_item_id") or "").strip()
        chunk_size = max(1, int(options.get("chunk_size") or 500))
        jobs = (
            ProductionJob.objects.filter(sales_order_item__isnull=False, production_batch__isnull=True)
            .select_related("sales_order_item")
            .only("id", "sales_order_item_id", "created_at", "sales_order_item__id")
            .order_by("sales_order_item_id", "created_at")
        )
        if sales_order_item_id:
            jobs = jobs.filter(sales_order_item_id=sales_order_item_id)

        processed = 0
        created = 0
        seen_item_ids = set()
        for job in jobs.iterator(chunk_size=chunk_size):
            item_id = job.sales_order_item_id
            if item_id in seen_item_ids or not job.sales_order_item:
                continue
            seen_item_ids.add(item_id)
            processed += 1
            if dry_run:
                self.stdout.write(f"would backfill sales_order_item={item_id}")
            else:
                batch = BatchExecutionService.backfill_legacy_sales_item_batch(job.sales_order_item)
                if batch is not None:
                    created += 1
                    self.stdout.write(f"backfilled {batch.batch_number} for sales_order_item={item_id}")
            if limit > 0 and processed >= limit:
                break

        mode = "dry-run" if dry_run else "write"
        self.stdout.write(self.style.SUCCESS(f"{mode} complete: processed={processed} created={created}"))
