from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.sales.models import CustomerProductOverlay, SalesOrder, SalesSku, SalesSkuVariant


class Command(BaseCommand):
    help = "Local-only reset of sales/planner transaction data while keeping master data."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Show what would be deleted without deleting.")
        parser.add_argument("--confirm", action="store_true", help="Apply the reset. Requires DEBUG=True.")

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("reset_sales_planner_local is only available with DEBUG=True.")

        confirm = bool(options.get("confirm"))
        dry_run = bool(options.get("dry_run")) or not confirm
        counts = {
            "sales_orders": SalesOrder.objects.count(),
            "sales_skus": SalesSku.objects.count(),
            "sales_sku_variants": SalesSkuVariant.objects.count(),
            "customer_product_overlays": CustomerProductOverlay.objects.count(),
        }

        if dry_run:
            self.stdout.write("DRY RUN - sales/planner reset would delete:")
            for key, value in counts.items():
                self.stdout.write(f"- {key}: {value}")
            return

        with transaction.atomic():
            deleted_overlays, _ = CustomerProductOverlay.objects.all().delete()
            deleted_orders, _ = SalesOrder.objects.all().delete()
            deleted_variants, _ = SalesSkuVariant.objects.all().delete()
            deleted_skus, _ = SalesSku.objects.all().delete()

        self.stdout.write(
            "Deleted sales/planner local data: "
            f"{deleted_orders} order rows, {deleted_skus} SKU rows, "
            f"{deleted_variants} variant rows, {deleted_overlays} overlay rows."
        )
