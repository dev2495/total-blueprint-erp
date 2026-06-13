import json
from datetime import datetime
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.inventory.models import (
    BulkTransaction,
    DeliveryChallan as InventoryDeliveryChallan,
    InterPlantChallanItem,
    InventoryAlert,
    InventoryAuditBatch,
    InventoryAuditLine,
    InventoryBulk,
    InventoryCorrectionAudit,
    InventoryReservation,
    InventoryRoll,
    InventorySnapshot,
    JobWorkOrder,
    PackagingStock,
    PackagingTransaction,
    RollConsumption,
    RollLink,
    RollMovement,
)
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
from apps.sales.models import Quotation, QuotationItem, SalesOrder, SalesOrderItem, SalesSku, SalesSkuVariant


RESET_TOKEN = "RESET_OPERATIONS_FOR_NEW_MODEL"


class Command(BaseCommand):
    help = "Reset sales, planner, production, WIP/FG, and inventory movement state while preserving plants, templates, customers, overlays, artwork, and master data."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Apply the reset. Omit for dry-run counts.")
        parser.add_argument(
            "--confirm",
            type=str,
            default="",
            help=f"Required confirmation token with --apply: {RESET_TOKEN}",
        )
        parser.add_argument(
            "--backup-file",
            type=str,
            default="",
            help="Optional local/server path for a JSON counts snapshot before and after the reset.",
        )

    @property
    def reset_models(self):
        return [
            ("production_sales_order_item_in_house_demands", SalesOrderItemInHouseDemand),
            ("production_inventory_allocations", InventoryAllocation),
            ("production_roll_dispatch_pack_records", RollDispatchPackRecord),
            ("production_delivery_challan_items", DeliveryChallanItem),
            ("production_delivery_challans", DeliveryChallan),
            ("production_packing_units", PackingUnit),
            ("production_finished_goods_batches", FinishedGoodsBatch),
            ("production_job_material_requirements", JobMaterialRequirement),
            ("production_quality_readings", QualityReading),
            ("production_material_consumption_logs", MaterialConsumptionLog),
            ("production_scrap_logs", ScrapLog),
            ("production_downtime_logs", DowntimeLog),
            ("production_job_execution_logs", JobExecutionLog),
            ("production_wcm_audit_events", ProductionWcmAuditEvent),
            ("production_work_center_assignments", WorkCenterAssignment),
            ("inventory_roll_consumptions", RollConsumption),
            ("inventory_roll_links", RollLink),
            ("inventory_roll_movements", RollMovement),
            ("inventory_reservations", InventoryReservation),
            ("inventory_snapshots", InventorySnapshot),
            ("inventory_alerts", InventoryAlert),
            ("inventory_bulk_transactions", BulkTransaction),
            ("inventory_packaging_transactions", PackagingTransaction),
            ("inventory_correction_audits", InventoryCorrectionAudit),
            ("inventory_audit_lines", InventoryAuditLine),
            ("inventory_audit_batches", InventoryAuditBatch),
            ("inventory_rolls", InventoryRoll),
            ("inventory_bulk", InventoryBulk),
            ("inventory_packaging_stock", PackagingStock),
            ("inventory_interplant_challan_items", InterPlantChallanItem),
            ("inventory_delivery_challans", InventoryDeliveryChallan),
            ("inventory_job_work_orders", JobWorkOrder),
            ("production_jobs", ProductionJob),
            ("production_planned_bulk_stock_orders", PlannedBulkStockOrder),
            ("production_planned_stock_orders", PlannedStockOrder),
            ("production_planned_orders", PlannedOrder),
            ("production_planner_sku_variants", PlannerSkuVariant),
            ("production_planner_skus", PlannerSku),
            ("sales_quotation_items", QuotationItem),
            ("sales_quotations", Quotation),
            ("sales_order_items", SalesOrderItem),
            ("sales_orders", SalesOrder),
            ("sales_sku_variants", SalesSkuVariant),
            ("sales_skus", SalesSku),
        ]

    def counts_snapshot(self):
        payload = {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "models": {},
            "preserved": {
                "customers": None,
                "customer_overlays": None,
                "product_masters": None,
                "artworks": None,
                "template_blueprints": None,
                "plants": None,
            },
        }
        for key, model in self.reset_models:
            payload["models"][key] = model.objects.count()

        from apps.artwork.models import Artwork
        from apps.factory.models import Plant
        from apps.materials.models import ProductMaster
        from apps.sales.models import Customer, CustomerProductOverlay
        from apps.templates.models import TemplateBlueprint

        payload["preserved"] = {
            "customers": Customer.objects.count(),
            "customer_overlays": CustomerProductOverlay.objects.count(),
            "product_masters": ProductMaster.objects.count(),
            "artworks": Artwork.objects.count(),
            "template_blueprints": TemplateBlueprint.objects.count(),
            "plants": Plant.objects.count(),
        }
        payload["addon_master_flags"] = {
            "total_addons": InventoryMaterial.objects.filter(category="ADDON").count(),
            "purchasable_addons": InventoryMaterial.objects.filter(category="ADDON", is_purchasable=True).count(),
            "purchased_addons": InventoryMaterial.objects.filter(category="ADDON", addon_is_purchased=True).count(),
        }
        return payload

    def write_snapshot(self, path, payload):
        if not path:
            return
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")

    def handle(self, *args, **options):
        apply = bool(options["apply"])
        if apply and options["confirm"] != RESET_TOKEN:
            raise CommandError(f"Refusing reset. Pass --confirm {RESET_TOKEN}.")

        before = self.counts_snapshot()
        result = {"before": before, "after": None, "deleted": {}, "applied": apply}

        if not apply:
            self.write_snapshot(options["backup_file"], result)
            self.stdout.write(json.dumps(result, indent=2, default=str))
            self.stdout.write(self.style.WARNING("Dry run only. No rows were deleted."))
            return

        with transaction.atomic():
            for key, model in self.reset_models:
                count, _ = model.objects.all().delete()
                result["deleted"][key] = count

        result["after"] = self.counts_snapshot()
        self.write_snapshot(options["backup_file"], result)
        self.stdout.write(json.dumps(result, indent=2, default=str))
        self.stdout.write(self.style.SUCCESS("Operations reset complete. Master data, templates, plants, customers, overlays, and artwork were preserved."))
