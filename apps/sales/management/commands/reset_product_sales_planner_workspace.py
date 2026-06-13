import json
from datetime import datetime
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.inventory.models import (
    BulkTransaction,
    InventoryBulk,
    InventoryReservation,
    InventoryRoll,
    JobWorkOrder,
    PackagingStock,
    PackagingTransaction,
    RollConsumption,
    RollMovement,
)
from apps.materials.models import InventoryMaterial, ProductMaster, ProductMasterSize, ProductVariant
from apps.production.models import (
    DeliveryChallan,
    DeliveryChallanItem,
    DowntimeLog,
    FinishedGoodsBatch,
    InventoryAllocation,
    JobExecutionLog,
    JobMaterialRequirement,
    MaterialConsumptionLog,
    PackingUnit,
    PlannedBulkStockOrder,
    PlannedOrder,
    PlannedStockOrder,
    PlannerSku,
    PlannerSkuVariant,
    ProductionJob,
    ProductionWcmAuditEvent,
    QualityReading,
    RollDispatchPackRecord,
    SalesOrderItemInHouseDemand,
    ScrapLog,
    WorkCenterAssignment,
)
from apps.sales.models import (
    Customer,
    CustomerProductOverlay,
    Quotation,
    QuotationItem,
    SalesOrder,
    SalesOrderItem,
    SalesSku,
    SalesSkuVariant,
)
from apps.templates.models import TemplateBlueprint


RESET_TOKEN = "RESET_PRODUCT_SALES_PLANNER_WORKSPACE"


class Command(BaseCommand):
    help = (
        "Reset Product Master, sales, planner, and deletable job workspace data while preserving "
        "physical inventory stock, master data, templates, customers, artwork, and plant setup."
    )

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Apply the reset. Omit for dry-run counts.")
        parser.add_argument("--confirm", type=str, default="", help=f"Required token with --apply: {RESET_TOKEN}")
        parser.add_argument("--backup-file", type=str, default="", help="Optional JSON report path.")

    def counts_snapshot(self):
        fg_job_ids = set(
            FinishedGoodsBatch.objects.exclude(production_job_id=None).values_list("production_job_id", flat=True)
        )
        deletable_job_count = ProductionJob.objects.exclude(id__in=fg_job_ids).count()
        return {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "reset_scope": {
                "product_masters": ProductMaster.objects.count(),
                "product_master_sizes": ProductMasterSize.objects.count(),
                "product_variants": ProductVariant.objects.count(),
                "inventory_material_pm_links": InventoryMaterial.objects.filter(produced_by_product_variant__isnull=False).count(),
                "sales_orders": SalesOrder.objects.count(),
                "sales_order_items": SalesOrderItem.objects.count(),
                "sales_skus": SalesSku.objects.count(),
                "sales_sku_variants": SalesSkuVariant.objects.count(),
                "customer_product_overlays": CustomerProductOverlay.objects.count(),
                "quotations": Quotation.objects.count(),
                "quotation_items": QuotationItem.objects.count(),
                "planned_stock_orders": PlannedStockOrder.objects.count(),
                "planned_bulk_stock_orders": PlannedBulkStockOrder.objects.count(),
                "planned_orders": PlannedOrder.objects.count(),
                "planner_skus": PlannerSku.objects.count(),
                "planner_sku_variants": PlannerSkuVariant.objects.count(),
                "production_jobs_total": ProductionJob.objects.count(),
                "production_jobs_deletable_without_fg_inventory": deletable_job_count,
                "production_jobs_preserved_for_fg_inventory": len(fg_job_ids),
            },
            "preserved_inventory": {
                "inventory_rolls": InventoryRoll.objects.count(),
                "inventory_bulk_rows": InventoryBulk.objects.count(),
                "packaging_stock_rows": PackagingStock.objects.count(),
                "packaging_transactions": PackagingTransaction.objects.count(),
                "finished_goods_batches": FinishedGoodsBatch.objects.count(),
                "packing_units": PackingUnit.objects.count(),
            },
            "preserved_master_data": {
                "customers": Customer.objects.count(),
                "templates": TemplateBlueprint.objects.count(),
                "inventory_materials": InventoryMaterial.objects.count(),
            },
        }

    def write_snapshot(self, path, payload):
        if not path:
            return
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")

    def delete_qs(self, label, queryset, deleted):
        count, _ = queryset.delete()
        deleted[label] = count

    def handle(self, *args, **options):
        apply = bool(options["apply"])
        if apply and options["confirm"] != RESET_TOKEN:
            raise CommandError(f"Refusing reset. Pass --confirm {RESET_TOKEN}.")

        before = self.counts_snapshot()
        result = {
            "applied": apply,
            "before": before,
            "after": None,
            "deleted": {},
            "notes": [
                "Physical inventory rows are preserved.",
                "Production jobs tied to existing FinishedGoodsBatch rows are preserved as inventory provenance.",
            ],
        }

        if not apply:
            self.write_snapshot(options["backup_file"], result)
            self.stdout.write(json.dumps(result, indent=2, default=str))
            self.stdout.write(self.style.WARNING("Dry run only. No rows were deleted."))
            return

        deleted = result["deleted"]
        with transaction.atomic():
            fg_job_ids = set(
                FinishedGoodsBatch.objects.exclude(production_job_id=None).values_list("production_job_id", flat=True)
            )
            deletable_job_ids = list(
                ProductionJob.objects.exclude(id__in=fg_job_ids).values_list("id", flat=True)
            )

            InventoryMaterial.objects.filter(produced_by_product_variant__isnull=False).update(produced_by_product_variant=None)
            InventoryRoll.objects.filter(sales_order_item__isnull=False).update(sales_order_item=None)
            FinishedGoodsBatch.objects.filter(sales_order_item__isnull=False).update(sales_order_item=None)
            PackingUnit.objects.filter(sales_order_item__isnull=False).update(sales_order_item=None)
            DeliveryChallanItem.objects.filter(sales_order_item__isnull=False).update(sales_order_item=None)
            PackagingTransaction.objects.filter(sales_order_item__isnull=False).update(sales_order_item=None)
            DeliveryChallan.objects.filter(sales_order__isnull=False).update(sales_order=None)

            if deletable_job_ids:
                InventoryRoll.objects.filter(production_job_id__in=deletable_job_ids).update(production_job=None)
                InventoryRoll.objects.filter(created_by_job_id__in=deletable_job_ids).update(created_by_job=None)
                BulkTransaction.objects.filter(job_id__in=deletable_job_ids).update(job=None)
                PackagingTransaction.objects.filter(job_id__in=deletable_job_ids).update(job=None)
                RollMovement.objects.filter(job_id__in=deletable_job_ids).update(job=None)
                JobWorkOrder.objects.filter(production_job_id__in=deletable_job_ids).update(production_job=None)

                self.delete_qs(
                    "production_inventory_reservations",
                    InventoryReservation.objects.filter(job_id__in=deletable_job_ids),
                    deleted,
                )
                self.delete_qs(
                    "production_roll_consumptions",
                    RollConsumption.objects.filter(job_id__in=deletable_job_ids),
                    deleted,
                )
                for label, model in [
                    ("production_job_material_requirements", JobMaterialRequirement),
                    ("production_quality_readings", QualityReading),
                    ("production_material_consumption_logs", MaterialConsumptionLog),
                    ("production_scrap_logs", ScrapLog),
                    ("production_downtime_logs", DowntimeLog),
                    ("production_job_execution_logs", JobExecutionLog),
                    ("production_wcm_audit_events", ProductionWcmAuditEvent),
                    ("production_work_center_assignments", WorkCenterAssignment),
                ]:
                    self.delete_qs(label, model.objects.filter(production_job_id__in=deletable_job_ids), deleted)

                self.delete_qs(
                    "production_jobs",
                    ProductionJob.objects.filter(id__in=deletable_job_ids),
                    deleted,
                )

            self.delete_qs("sales_in_house_demands", SalesOrderItemInHouseDemand.objects.all(), deleted)
            self.delete_qs("production_roll_dispatch_pack_records", RollDispatchPackRecord.objects.all(), deleted)
            self.delete_qs("production_inventory_allocations_remaining", InventoryAllocation.objects.all(), deleted)
            self.delete_qs("planned_bulk_stock_orders", PlannedBulkStockOrder.objects.all(), deleted)
            self.delete_qs("planned_stock_orders", PlannedStockOrder.objects.all(), deleted)
            self.delete_qs("planned_orders", PlannedOrder.objects.all(), deleted)
            self.delete_qs("planner_sku_variants", PlannerSkuVariant.objects.all(), deleted)
            self.delete_qs("planner_skus", PlannerSku.objects.all(), deleted)

            self.delete_qs("quotation_items", QuotationItem.objects.all(), deleted)
            self.delete_qs("quotations", Quotation.objects.all(), deleted)
            self.delete_qs("sales_order_items", SalesOrderItem.objects.all(), deleted)
            self.delete_qs("sales_orders", SalesOrder.objects.all(), deleted)
            self.delete_qs("sales_sku_variants", SalesSkuVariant.objects.all(), deleted)
            self.delete_qs("sales_skus", SalesSku.objects.all(), deleted)
            self.delete_qs("customer_product_overlays", CustomerProductOverlay.objects.all(), deleted)

            self.delete_qs("product_master_sizes", ProductMasterSize.objects.all(), deleted)
            self.delete_qs("product_variants", ProductVariant.objects.all(), deleted)
            self.delete_qs("product_masters", ProductMaster.objects.all(), deleted)

        result["after"] = self.counts_snapshot()
        self.write_snapshot(options["backup_file"], result)
        self.stdout.write(json.dumps(result, indent=2, default=str))
        self.stdout.write(self.style.SUCCESS("Product/sales/planner workspace reset complete without deleting physical inventory rows."))
