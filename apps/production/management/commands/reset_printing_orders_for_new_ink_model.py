import json
from collections import defaultdict
from datetime import datetime
from decimal import Decimal
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q

from apps.costing.models import JobCost, JobRuntimeSession, OrderCost
from apps.inventory.models import (
    BulkTransaction,
    DeliveryChallan as InventoryDeliveryChallan,
    InterPlantChallanItem,
    InventoryBulk,
    InventoryReservation,
    InventoryRoll,
    JobWorkOrder,
    PackagingStock,
    PackagingTransaction,
    RollConsumption,
    RollLink,
    RollMovement,
    StockAdjustment,
    StockAdjustmentLine,
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
    PlannedStockOrder,
    ProductionJob,
    ProductionWcmAuditEvent,
    QualityReading,
    RollAllocationBatchRequest,
    RollDispatchPackRecord,
    SalesOrderItemInHouseDemand,
    ScrapLog,
    WorkCenterAssignment,
)
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.sales.models_dispatch import CustomerDispatch, CustomerDispatchLine


RESET_TOKEN = "RESET_PRINTING_ORDERS_FOR_NEW_INK_MODEL"


def _str_id(value):
    return str(value) if value else ""


def _as_decimal(value):
    try:
        return Decimal(str(value or 0))
    except Exception:
        return Decimal("0")


def _is_printing_item(item):
    printing = item.printing_snapshot if isinstance(item.printing_snapshot, dict) else {}
    master = getattr(item, "product_master", None)
    fixed = getattr(master, "fixed_attributes", None) if master else {}
    if not isinstance(fixed, dict):
        fixed = {}
    return bool(
        printing.get("enabled")
        or item.assigned_artwork_id
        or item.artwork_assignment_required
        or fixed.get("print_capable")
    )


class Command(BaseCommand):
    help = (
        "Delete only printing sales orders and their production/inventory trails "
        "for the floor-ink model cutover. Non-printing sales orders are preserved."
    )

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Apply the cleanup. Omit for dry-run.")
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
            help="Optional JSON output path for the dry-run/apply report.",
        )
        parser.add_argument(
            "--allow-blockers",
            action="store_true",
            help="Do not abort on mixed-lineage blockers. Intended only for emergency manual repair.",
        )

    def _printing_item_ids(self):
        ids = set()
        qs = (
            SalesOrderItem.objects
            .select_related("product_master")
            .only(
                "id",
                "sales_order_id",
                "printing_snapshot",
                "artwork_assignment_required",
                "assigned_artwork_id",
                "product_master__fixed_attributes",
            )
        )
        for item in qs.iterator(chunk_size=1000):
            if _is_printing_item(item):
                ids.add(str(item.id))
        return ids

    def _safe_planned_stock_ids(self, selected_item_ids):
        demand_qs = SalesOrderItemInHouseDemand.objects.filter(sales_order_item_id__in=selected_item_ids)
        candidate_stock_ids = {str(v) for v in demand_qs.exclude(planned_stock_order_id__isnull=True).values_list("planned_stock_order_id", flat=True)}
        candidate_bulk_ids = {str(v) for v in demand_qs.exclude(planned_bulk_stock_order_id__isnull=True).values_list("planned_bulk_stock_order_id", flat=True)}

        stock_ids = set()
        bulk_ids = set()
        blockers = []
        for stock_id in candidate_stock_ids:
            has_non_selected = SalesOrderItemInHouseDemand.objects.filter(
                planned_stock_order_id=stock_id,
            ).exclude(sales_order_item_id__in=selected_item_ids).exists()
            if has_non_selected:
                blockers.append(f"PlannedStockOrder {stock_id} also belongs to non-printing sales demand")
            else:
                stock_ids.add(stock_id)
        for bulk_id in candidate_bulk_ids:
            has_non_selected = SalesOrderItemInHouseDemand.objects.filter(
                planned_bulk_stock_order_id=bulk_id,
            ).exclude(sales_order_item_id__in=selected_item_ids).exists()
            if has_non_selected:
                blockers.append(f"PlannedBulkStockOrder {bulk_id} also belongs to non-printing sales demand")
            else:
                bulk_ids.add(bulk_id)
        return stock_ids, bulk_ids, blockers

    def _collect_scope(self):
        item_ids = self._printing_item_ids()
        order_ids = {
            str(v)
            for v in SalesOrderItem.objects.filter(id__in=item_ids)
            .values_list("sales_order_id", flat=True)
            .distinct()
        }
        all_item_ids = {
            str(v)
            for v in SalesOrderItem.objects.filter(sales_order_id__in=order_ids)
            .values_list("id", flat=True)
        }

        stock_order_ids, bulk_order_ids, blockers = self._safe_planned_stock_ids(all_item_ids)

        job_ids = {
            str(v)
            for v in ProductionJob.objects.filter(
                Q(sales_order_item_id__in=all_item_ids) | Q(mts_order_id__in=stock_order_ids)
            ).values_list("id", flat=True)
        }

        # Include jobs generated by linked packaging/bulk stock orders.
        stock_order_ids.update(
            str(v)
            for v in ProductionJob.objects.filter(id__in=job_ids)
            .exclude(mts_order_id__isnull=True)
            .values_list("mts_order_id", flat=True)
        )

        selected_roll_ids = {
            str(v)
            for v in InventoryRoll.objects.filter(
                Q(created_by_job_id__in=job_ids)
                | Q(production_job_id__in=job_ids)
                | Q(sales_order_item_id__in=all_item_ids)
            ).values_list("id", flat=True)
        }
        selected_fg_ids = {
            str(v)
            for v in FinishedGoodsBatch.objects.filter(
                Q(production_job_id__in=job_ids) | Q(sales_order_item_id__in=all_item_ids)
            ).values_list("id", flat=True)
        }
        selected_packing_unit_ids = {
            str(v)
            for v in PackingUnit.objects.filter(
                Q(fg_batch_id__in=selected_fg_ids) | Q(sales_order_item_id__in=all_item_ids)
            ).values_list("id", flat=True)
        }
        selected_roll_ids.update(
            str(v)
            for v in DeliveryChallanItem.objects.filter(sales_order_item_id__in=all_item_ids)
            .exclude(roll_id__isnull=True)
            .values_list("roll_id", flat=True)
        )

        consumption_qs = RollConsumption.objects.filter(job_id__in=job_ids)
        input_roll_ids = {str(v) for v in consumption_qs.values_list("input_roll_id", flat=True)}
        selected_roll_ids.update(
            str(v)
            for v in consumption_qs.exclude(output_roll_id__isnull=True).values_list("output_roll_id", flat=True)
        )
        selected_roll_ids.update(
            str(v)
            for v in consumption_qs.exclude(balance_roll_id__isnull=True).values_list("balance_roll_id", flat=True)
        )
        selected_roll_ids.update(
            str(v)
            for v in consumption_qs.exclude(scrap_roll_id__isnull=True).values_list("scrap_roll_id", flat=True)
        )

        child_link_qs = RollLink.objects.filter(child_roll_id__in=selected_roll_ids)
        restore_roll_ids = {
            str(v)
            for v in child_link_qs.exclude(parent_roll_id__in=selected_roll_ids).values_list("parent_roll_id", flat=True)
        }
        restore_roll_ids.update(input_roll_ids.difference(selected_roll_ids))
        restore_roll_ids.update(
            str(v)
            for v in InventoryReservation.objects.filter(job_id__in=job_ids)
            .exclude(roll_id__isnull=True)
            .exclude(roll_id__in=selected_roll_ids)
            .values_list("roll_id", flat=True)
        )

        blockers.extend(self._mixed_lineage_blockers(selected_roll_ids, restore_roll_ids, job_ids, all_item_ids, order_ids))

        return {
            "sales_order_ids": order_ids,
            "sales_order_item_ids": all_item_ids,
            "printing_item_ids": item_ids,
            "planned_stock_order_ids": stock_order_ids,
            "planned_bulk_stock_order_ids": bulk_order_ids,
            "production_job_ids": job_ids,
            "selected_roll_ids": selected_roll_ids,
            "restore_roll_ids": restore_roll_ids,
            "finished_goods_batch_ids": selected_fg_ids,
            "packing_unit_ids": selected_packing_unit_ids,
            "blockers": blockers,
        }

    def _mixed_lineage_blockers(self, selected_roll_ids, restore_roll_ids, job_ids, item_ids, order_ids):
        blockers = []
        non_selected_child_links = RollLink.objects.filter(parent_roll_id__in=restore_roll_ids).exclude(child_roll_id__in=selected_roll_ids)
        for row in non_selected_child_links.values("parent_roll_id", "child_roll_id")[:25]:
            blockers.append(
                f"Input roll {row['parent_roll_id']} has non-selected child roll {row['child_roll_id']}; cannot restore full parent weight"
            )

        non_selected_roll_consumptions = RollConsumption.objects.filter(
            Q(input_roll_id__in=selected_roll_ids)
            | Q(output_roll_id__in=selected_roll_ids)
            | Q(balance_roll_id__in=selected_roll_ids)
            | Q(scrap_roll_id__in=selected_roll_ids)
        ).exclude(job_id__in=job_ids)
        for row in non_selected_roll_consumptions.values("id", "job_id")[:25]:
            blockers.append(f"Selected roll is referenced by non-selected roll consumption {row['id']} job {row['job_id']}")

        non_selected_reservations = InventoryReservation.objects.filter(roll_id__in=selected_roll_ids).exclude(job_id__in=job_ids)
        for row in non_selected_reservations.values("id", "job_id", "roll_id")[:25]:
            blockers.append(f"Selected roll {row['roll_id']} has non-selected reservation {row['id']} job {row['job_id']}")

        selected_challan_ids = set(
            str(v)
            for v in DeliveryChallanItem.objects.filter(
                Q(sales_order_item_id__in=item_ids)
                | Q(roll_id__in=selected_roll_ids)
                | Q(packing_unit_id__in=self._packing_unit_ids_for_items(item_ids))
            ).values_list("challan_id", flat=True)
        )
        mixed_challans = DeliveryChallanItem.objects.filter(challan_id__in=selected_challan_ids).exclude(
            Q(sales_order_item_id__in=item_ids)
            | Q(roll_id__in=selected_roll_ids)
            | Q(packing_unit_id__in=self._packing_unit_ids_for_items(item_ids))
        )
        for row in mixed_challans.values("challan_id", "id")[:25]:
            blockers.append(f"DeliveryChallan {row['challan_id']} has non-selected line {row['id']}")

        mixed_dispatch = CustomerDispatchLine.objects.filter(dispatch__sales_order_id__in=order_ids).exclude(sales_order_item_id__in=item_ids)
        for row in mixed_dispatch.values("dispatch_id", "id")[:25]:
            blockers.append(f"CustomerDispatch {row['dispatch_id']} has non-selected line {row['id']}")
        return blockers

    def _packing_unit_ids_for_items(self, item_ids):
        return {
            str(v)
            for v in PackingUnit.objects.filter(sales_order_item_id__in=item_ids).values_list("id", flat=True)
        }

    def _counts(self, scope):
        job_ids = scope["production_job_ids"]
        item_ids = scope["sales_order_item_ids"]
        order_ids = scope["sales_order_ids"]
        stock_ids = scope["planned_stock_order_ids"]
        bulk_order_ids = scope["planned_bulk_stock_order_ids"]
        roll_ids = scope["selected_roll_ids"]
        restore_roll_ids = scope["restore_roll_ids"]
        fg_ids = scope["finished_goods_batch_ids"]
        packing_unit_ids = scope["packing_unit_ids"]

        challan_ids = set(
            str(v)
            for v in DeliveryChallan.objects.filter(sales_order_id__in=order_ids).values_list("id", flat=True)
        )
        challan_ids.update(
            str(v)
            for v in DeliveryChallanItem.objects.filter(
                Q(sales_order_item_id__in=item_ids)
                | Q(roll_id__in=roll_ids)
                | Q(fg_batch_id__in=fg_ids)
                | Q(packing_unit_id__in=packing_unit_ids)
            ).values_list("challan_id", flat=True)
        )
        interplant_challan_ids = set(
            str(v)
            for v in InventoryDeliveryChallan.objects.filter(
                Q(source_job_id__in=job_ids) | Q(target_job_id__in=job_ids)
            ).values_list("id", flat=True)
        )
        interplant_challan_ids.update(
            str(v)
            for v in InterPlantChallanItem.objects.filter(roll_id__in=roll_ids).values_list("challan_id", flat=True)
        )

        return {
            "sales_orders_delete": SalesOrder.objects.filter(id__in=order_ids).count(),
            "sales_orders_preserved_non_printing": SalesOrder.objects.exclude(id__in=order_ids).count(),
            "sales_order_items_delete": SalesOrderItem.objects.filter(id__in=item_ids).count(),
            "printing_items_detected": len(scope["printing_item_ids"]),
            "production_jobs_delete": ProductionJob.objects.filter(id__in=job_ids).count(),
            "planned_stock_orders_delete": PlannedStockOrder.objects.filter(id__in=stock_ids).count(),
            "planned_bulk_stock_orders_delete": PlannedBulkStockOrder.objects.filter(id__in=bulk_order_ids).count(),
            "rolls_delete": InventoryRoll.objects.filter(id__in=roll_ids).count(),
            "input_rolls_restore": InventoryRoll.objects.filter(id__in=restore_roll_ids).count(),
            "fg_batches_delete": FinishedGoodsBatch.objects.filter(id__in=fg_ids).count(),
            "packing_units_delete": PackingUnit.objects.filter(id__in=packing_unit_ids).count(),
            "delivery_challans_delete": DeliveryChallan.objects.filter(id__in=challan_ids).count(),
            "customer_dispatches_delete": CustomerDispatch.objects.filter(sales_order_id__in=order_ids).count(),
            "bulk_transactions_reverse_delete": BulkTransaction.objects.filter(job_id__in=job_ids).count(),
            "packaging_transactions_reverse_delete": PackagingTransaction.objects.filter(
                Q(job_id__in=job_ids) | Q(sales_order_item_id__in=item_ids) | Q(mts_order_id__in=stock_ids)
            ).count(),
            "roll_links_delete": RollLink.objects.filter(Q(parent_roll_id__in=roll_ids) | Q(child_roll_id__in=roll_ids)).count(),
            "roll_movements_delete": RollMovement.objects.filter(Q(job_id__in=job_ids) | Q(roll_id__in=roll_ids)).count(),
            "stock_adjustment_lines_for_selected_rolls_delete": StockAdjustmentLine.objects.filter(inventory_roll_id__in=roll_ids).count(),
            "interplant_challans_delete": InventoryDeliveryChallan.objects.filter(id__in=interplant_challan_ids).count(),
            "blocker_count": len(scope["blockers"]),
        }

    def _reverse_bulk_transactions(self, job_ids):
        reversed_by_stock = defaultdict(Decimal)
        for tx in BulkTransaction.objects.select_related("location").filter(job_id__in=job_ids):
            stock = InventoryBulk.objects.select_for_update().filter(
                material_id=tx.material_id,
                granule_code_id=tx.granule_code_id,
                location_id=tx.location_id,
                plant_id=tx.location.plant_id,
            ).first()
            if stock:
                stock.qty_kg = _as_decimal(stock.qty_kg) - _as_decimal(tx.qty_kg)
                stock.save(update_fields=["qty_kg", "updated_at"])
                reversed_by_stock[str(stock.id)] += -_as_decimal(tx.qty_kg)
        deleted, _ = BulkTransaction.objects.filter(job_id__in=job_ids).delete()
        return {"transactions_deleted": deleted, "stock_delta_by_id": {k: str(v) for k, v in reversed_by_stock.items()}}

    def _reverse_packaging_transactions(self, job_ids, item_ids, stock_ids):
        reversed_by_stock = defaultdict(Decimal)
        qs = PackagingTransaction.objects.select_related("location").filter(
            Q(job_id__in=job_ids) | Q(sales_order_item_id__in=item_ids) | Q(mts_order_id__in=stock_ids)
        )
        for tx in qs:
            stock = PackagingStock.objects.select_for_update().filter(
                material_id=tx.material_id,
                location_id=tx.location_id,
                plant_id=tx.location.plant_id,
            ).first()
            if stock:
                stock.qty = _as_decimal(stock.qty) - _as_decimal(tx.qty)
                stock.save(update_fields=["qty", "updated_at"])
                reversed_by_stock[str(stock.id)] += -_as_decimal(tx.qty)
        deleted, _ = qs.delete()
        return {"transactions_deleted": deleted, "stock_delta_by_id": {k: str(v) for k, v in reversed_by_stock.items()}}

    def _restore_input_rolls(self, restore_roll_ids):
        restored = []
        for roll in InventoryRoll.objects.select_for_update().filter(id__in=restore_roll_ids):
            original = _as_decimal(roll.original_weight_kg)
            if original <= 0:
                continue
            changed = []
            if _as_decimal(roll.weight_kg) != original:
                roll.weight_kg = original
                changed.append("weight_kg")
            if str(roll.status or "").upper() != "AVAILABLE":
                roll.status = "AVAILABLE"
                changed.append("status")
            if changed:
                roll.save(update_fields=changed)
                restored.append(str(roll.id))
        return restored

    def _delete_scope(self, scope):
        job_ids = scope["production_job_ids"]
        item_ids = scope["sales_order_item_ids"]
        order_ids = scope["sales_order_ids"]
        stock_ids = scope["planned_stock_order_ids"]
        bulk_order_ids = scope["planned_bulk_stock_order_ids"]
        roll_ids = scope["selected_roll_ids"]
        restore_roll_ids = scope["restore_roll_ids"]
        fg_ids = scope["finished_goods_batch_ids"]
        packing_unit_ids = scope["packing_unit_ids"]

        result = {"deleted": {}, "reversed": {}, "restored_input_roll_ids": []}

        result["reversed"]["bulk"] = self._reverse_bulk_transactions(job_ids)
        result["reversed"]["packaging"] = self._reverse_packaging_transactions(job_ids, item_ids, stock_ids)
        result["restored_input_roll_ids"] = self._restore_input_rolls(restore_roll_ids)

        def delete_qs(key, qs):
            count, details = qs.delete()
            result["deleted"][key] = count
            if details:
                result["deleted"][f"{key}_details"] = details

        selected_challan_ids = set(
            str(v)
            for v in DeliveryChallan.objects.filter(sales_order_id__in=order_ids).values_list("id", flat=True)
        )
        selected_challan_ids.update(
            str(v)
            for v in DeliveryChallanItem.objects.filter(
                Q(sales_order_item_id__in=item_ids)
                | Q(roll_id__in=roll_ids)
                | Q(fg_batch_id__in=fg_ids)
                | Q(packing_unit_id__in=packing_unit_ids)
            ).values_list("challan_id", flat=True)
        )
        interplant_challan_ids = set(
            str(v)
            for v in InventoryDeliveryChallan.objects.filter(
                Q(source_job_id__in=job_ids) | Q(target_job_id__in=job_ids)
            ).values_list("id", flat=True)
        )
        interplant_challan_ids.update(
            str(v)
            for v in InterPlantChallanItem.objects.filter(roll_id__in=roll_ids).values_list("challan_id", flat=True)
        )

        delete_qs("customer_dispatch_lines", CustomerDispatchLine.objects.filter(dispatch__sales_order_id__in=order_ids))
        delete_qs("customer_dispatches", CustomerDispatch.objects.filter(sales_order_id__in=order_ids))
        delete_qs("roll_dispatch_pack_records", RollDispatchPackRecord.objects.filter(Q(sales_order_item_id__in=item_ids) | Q(roll_id__in=roll_ids)))
        delete_qs("delivery_challan_items", DeliveryChallanItem.objects.filter(challan_id__in=selected_challan_ids))
        delete_qs("delivery_challans", DeliveryChallan.objects.filter(id__in=selected_challan_ids))
        delete_qs("packing_units", PackingUnit.objects.filter(Q(id__in=packing_unit_ids) | Q(sales_order_item_id__in=item_ids) | Q(fg_batch_id__in=fg_ids)))
        delete_qs("inventory_allocations", InventoryAllocation.objects.filter(Q(sales_order_id__in=order_ids) | Q(mts_order_id__in=stock_ids) | Q(inventory_roll_id__in=roll_ids) | Q(fg_batch_id__in=fg_ids)))
        delete_qs("finished_goods_batches", FinishedGoodsBatch.objects.filter(Q(id__in=fg_ids) | Q(production_job_id__in=job_ids) | Q(sales_order_item_id__in=item_ids)))
        delete_qs("interplant_challan_items", InterPlantChallanItem.objects.filter(Q(challan_id__in=interplant_challan_ids) | Q(roll_id__in=roll_ids)))
        delete_qs("interplant_delivery_challans", InventoryDeliveryChallan.objects.filter(id__in=interplant_challan_ids))
        delete_qs("inventory_job_work_orders", JobWorkOrder.objects.filter(production_job_id__in=job_ids))
        delete_qs("costing_job_runtime_sessions", JobRuntimeSession.objects.filter(job_id__in=job_ids))
        delete_qs("costing_job_costs", JobCost.objects.filter(job_id__in=job_ids))
        delete_qs("order_costs", OrderCost.objects.filter(sales_order_item_id__in=item_ids))
        delete_qs("roll_allocation_batch_requests", RollAllocationBatchRequest.objects.filter(job_id__in=job_ids))
        delete_qs("wcm_audit_events", ProductionWcmAuditEvent.objects.filter(production_job_id__in=job_ids))
        delete_qs("work_center_assignments", WorkCenterAssignment.objects.filter(production_job_id__in=job_ids))
        delete_qs("quality_readings", QualityReading.objects.filter(production_job_id__in=job_ids))
        delete_qs("material_consumption_logs", MaterialConsumptionLog.objects.filter(production_job_id__in=job_ids))
        delete_qs("scrap_logs", ScrapLog.objects.filter(production_job_id__in=job_ids))
        delete_qs("downtime_logs", DowntimeLog.objects.filter(production_job_id__in=job_ids))
        delete_qs("execution_logs", JobExecutionLog.objects.filter(production_job_id__in=job_ids))
        delete_qs("job_material_requirements", JobMaterialRequirement.objects.filter(production_job_id__in=job_ids))
        delete_qs("inventory_reservations", InventoryReservation.objects.filter(job_id__in=job_ids))
        delete_qs("roll_consumptions", RollConsumption.objects.filter(job_id__in=job_ids))
        delete_qs("roll_movements", RollMovement.objects.filter(Q(job_id__in=job_ids) | Q(roll_id__in=roll_ids)))
        delete_qs("roll_links", RollLink.objects.filter(Q(parent_roll_id__in=roll_ids) | Q(child_roll_id__in=roll_ids)))
        affected_adjustment_ids = {
            str(v)
            for v in StockAdjustmentLine.objects.filter(inventory_roll_id__in=roll_ids).values_list("adjustment_id", flat=True)
        }
        delete_qs("stock_adjustment_lines_for_selected_rolls", StockAdjustmentLine.objects.filter(inventory_roll_id__in=roll_ids))
        delete_qs("empty_stock_adjustments", StockAdjustment.objects.filter(id__in=affected_adjustment_ids, lines__isnull=True))
        delete_qs("selected_rolls", InventoryRoll.objects.filter(id__in=roll_ids))
        delete_qs("production_jobs", ProductionJob.objects.filter(id__in=job_ids))
        delete_qs("sales_in_house_demands", SalesOrderItemInHouseDemand.objects.filter(sales_order_item_id__in=item_ids))
        delete_qs("planned_stock_orders", PlannedStockOrder.objects.filter(id__in=stock_ids))
        delete_qs("planned_bulk_stock_orders", PlannedBulkStockOrder.objects.filter(id__in=bulk_order_ids))
        delete_qs("sales_orders", SalesOrder.objects.filter(id__in=order_ids))
        return result

    def _write_report(self, path, payload):
        if not path:
            return
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")

    def handle(self, *args, **options):
        apply = bool(options["apply"])
        if apply and options["confirm"] != RESET_TOKEN:
            raise CommandError(f"Refusing cleanup. Pass --confirm {RESET_TOKEN}.")

        scope = self._collect_scope()
        before_counts = self._counts(scope)
        report = {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "applied": apply,
            "confirm_token": RESET_TOKEN,
            "scope_sizes": {key: len(value) if isinstance(value, set) else value for key, value in scope.items() if key != "blockers"},
            "blockers": scope["blockers"],
            "before": before_counts,
            "after": None,
            "result": None,
        }

        if scope["blockers"] and apply and not options["allow_blockers"]:
            self._write_report(options["backup_file"], report)
            raise CommandError(f"Refusing cleanup because {len(scope['blockers'])} mixed-lineage blockers were found.")

        if apply:
            with transaction.atomic():
                report["result"] = self._delete_scope(scope)
                report["after"] = self._counts(self._collect_scope())

        self._write_report(options["backup_file"], report)
        self.stdout.write(json.dumps(report, indent=2, default=str))
        if apply:
            self.stdout.write(self.style.SUCCESS("Selective printing-order cleanup complete."))
        else:
            self.stdout.write(self.style.WARNING("Dry run only. No rows were changed."))
