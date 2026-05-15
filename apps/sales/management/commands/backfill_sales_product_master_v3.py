from copy import deepcopy

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.materials.services_product_variant import find_or_create_product_variant
from apps.sales.models import CustomerProductOverlay, SalesOrderItem


def _axis_values_for_item(item):
    sku = getattr(item.sku_variant, "sku", None)
    sources = [
        item.axis_values,
        getattr(sku, "axis_values_template", None),
        (item.geometry_snapshot or {}).get("axis_values") if isinstance(item.geometry_snapshot, dict) else None,
        (item.sku_variant.geometry_snapshot or {}).get("axis_values") if isinstance(item.sku_variant.geometry_snapshot, dict) else None,
    ]
    for source in sources:
        if isinstance(source, dict) and source:
            return deepcopy(source)
    return {}


class Command(BaseCommand):
    help = "Backfill historical SalesOrderItem rows from Sales SKU variants into the Product Master model."

    def add_arguments(self, parser):
        parser.add_argument("--confirm", action="store_true", help="Apply updates. Without this flag the command is a dry run.")

    def handle(self, *args, **options):
        confirm = bool(options.get("confirm"))
        self.stdout.write("PRODUCT MASTER V3 BACKFILL")
        if not confirm:
            self.stdout.write("DRY RUN - pass --confirm to update rows.")

        queryset = (
            SalesOrderItem.objects.select_related(
                "sales_order",
                "sales_order__customer",
                "sku_variant",
                "sku_variant__sku",
                "sku_variant__sku__product_master",
            )
            .filter(product_master__isnull=True, sku_variant__isnull=False, sku_variant__sku__product_master__isnull=False)
            .order_by("created_at", "id")
        )

        scanned = queryset.count()
        backfilled = 0
        skipped = 0

        for item in queryset:
            sku = item.sku_variant.sku
            product_master = sku.product_master
            axis_values = _axis_values_for_item(item)
            if not axis_values:
                skipped += 1
                self.stdout.write(f"SKIP {item.id}: no axis values")
                continue

            if not confirm:
                backfilled += 1
                self.stdout.write(f"WOULD BACKFILL {item.id}: {product_master.code} {axis_values}")
                continue

            with transaction.atomic():
                product_variant, _created = find_or_create_product_variant(
                    product_master,
                    axis_values,
                    code=getattr(item.sku_variant, "code", None),
                )
                overlay = CustomerProductOverlay.find_for(
                    customer=getattr(item.sales_order, "customer", None),
                    product_master=product_master,
                    axis_values=axis_values,
                )
                update_fields = ["product_master", "product_variant", "axis_values"]
                item.product_master = product_master
                item.product_variant = product_variant
                item.axis_values = axis_values
                if overlay:
                    item.customer_product_overlay = overlay
                    update_fields.append("customer_product_overlay")
                if not item.geometry_snapshot:
                    item.geometry_snapshot = deepcopy(product_variant.geometry_snapshot or {})
                    update_fields.append("geometry_snapshot")
                if not item.layer_snapshot:
                    item.layer_snapshot = deepcopy(product_variant.layer_snapshot or [])
                    update_fields.append("layer_snapshot")
                item.save(update_fields=update_fields)
                backfilled += 1

        if confirm:
            self.stdout.write(f"Backfilled {backfilled} of {scanned} rows. Skipped {skipped}.")
        else:
            self.stdout.write(f"DRY RUN complete. {backfilled} rows can be backfilled. Skipped {skipped}.")
