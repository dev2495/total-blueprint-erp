import json
from decimal import Decimal
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.inventory.models import (
    BulkTransaction,
    InventoryBulk,
    InventoryReservation,
    InventoryRoll,
    PackagingStock,
    PackagingTransaction,
)
from apps.materials.models import TradingGoodStock
from apps.procurement.models import TradingGoodReceipt


RESET_TOKEN = "RESET_INVENTORY_BEFORE_CUTOFF"


class Command(BaseCommand):
    help = (
        "Clear only inventory stock state before a cutoff and rebuild live pools "
        "from movements on/after the cutoff. Masters, sales, templates, plants, "
        "jobs, and post-cutoff GRNs are preserved."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--cutoff",
            required=True,
            help="Inclusive preserve cutoff, e.g. 2026-06-01T00:00:00+05:30. Rows before this are reset.",
        )
        parser.add_argument("--apply", action="store_true", help="Apply the reset. Omit for dry-run counts.")
        parser.add_argument(
            "--confirm",
            default="",
            help=f"Required with --apply: {RESET_TOKEN}",
        )
        parser.add_argument(
            "--backup-file",
            default="",
            help="Optional JSON path for before/after counts.",
        )

    def _parse_cutoff(self, raw):
        cutoff = parse_datetime(raw)
        if cutoff is None:
            raise CommandError("Could not parse --cutoff. Use ISO format, e.g. 2026-06-01T00:00:00+05:30.")
        if timezone.is_naive(cutoff):
            cutoff = timezone.make_aware(cutoff, timezone.get_current_timezone())
        return cutoff

    def _counts(self, cutoff):
        return {
            "cutoff": cutoff.isoformat(),
            "pre_cutoff": {
                "bulk_transactions": BulkTransaction.objects.filter(created_at__lt=cutoff).count(),
                "packaging_transactions": PackagingTransaction.objects.filter(created_at__lt=cutoff).count(),
                "trading_receipts": TradingGoodReceipt.objects.filter(received_at__lt=cutoff).count(),
                "active_rolls": InventoryRoll.objects.filter(
                    created_at__lt=cutoff,
                    status__in=["AVAILABLE", "RESERVED", "IN_PROCESS", "SENT_JOBWORK"],
                ).count(),
                "active_reservations": InventoryReservation.objects.filter(
                    created_at__lt=cutoff,
                    status="ACTIVE",
                ).count(),
            },
            "preserved_on_or_after_cutoff": {
                "bulk_transactions": BulkTransaction.objects.filter(created_at__gte=cutoff).count(),
                "packaging_transactions": PackagingTransaction.objects.filter(created_at__gte=cutoff).count(),
                "trading_receipts": TradingGoodReceipt.objects.filter(received_at__gte=cutoff).count(),
                "rolls": InventoryRoll.objects.filter(created_at__gte=cutoff).count(),
            },
            "live_rows_before_rebuild": {
                "bulk_stock_rows": InventoryBulk.objects.count(),
                "packaging_stock_rows": PackagingStock.objects.count(),
                "trading_stock_rows": TradingGoodStock.objects.count(),
                "available_or_reserved_rolls": InventoryRoll.objects.filter(status__in=["AVAILABLE", "RESERVED"]).count(),
            },
        }

    def _write_snapshot(self, path, payload):
        if not path:
            return
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")

    def _rebuild_bulk_stock(self, cutoff):
        InventoryBulk.objects.all().delete()
        rows = (
            BulkTransaction.objects.filter(created_at__gte=cutoff)
            .values("material_id", "granule_code_id", "location_id", "location__plant_id")
            .annotate(qty=Sum("qty_kg"))
        )
        created = 0
        for row in rows:
            qty = Decimal(str(row["qty"] or 0))
            if qty <= 0:
                continue
            rate = (
                BulkTransaction.objects.filter(
                    created_at__gte=cutoff,
                    material_id=row["material_id"],
                    granule_code_id=row["granule_code_id"],
                    location_id=row["location_id"],
                    qty_kg__gt=0,
                )
                .order_by("-created_at", "-id")
                .values_list("avg_cost", flat=True)
                .first()
            ) or Decimal("0")
            InventoryBulk.objects.create(
                material_id=row["material_id"],
                granule_code_id=row["granule_code_id"],
                plant_id=row["location__plant_id"],
                location_id=row["location_id"],
                qty_kg=qty,
                avg_cost=rate,
            )
            created += 1
        return created

    def _rebuild_packaging_stock(self, cutoff):
        PackagingStock.objects.all().delete()
        rows = (
            PackagingTransaction.objects.filter(created_at__gte=cutoff)
            .values("material_id", "location_id", "location__plant_id")
            .annotate(qty=Sum("qty"))
        )
        created = 0
        for row in rows:
            qty = Decimal(str(row["qty"] or 0))
            if qty <= 0:
                continue
            rate = (
                PackagingTransaction.objects.filter(
                    created_at__gte=cutoff,
                    material_id=row["material_id"],
                    location_id=row["location_id"],
                    qty__gt=0,
                )
                .order_by("-created_at", "-id")
                .values_list("avg_cost", flat=True)
                .first()
            ) or Decimal("0")
            PackagingStock.objects.create(
                material_id=row["material_id"],
                plant_id=row["location__plant_id"],
                location_id=row["location_id"],
                qty=qty,
                avg_cost=rate,
            )
            created += 1
        return created

    def _rebuild_trading_stock(self, cutoff):
        TradingGoodStock.objects.all().delete()
        rows = (
            TradingGoodReceipt.objects.filter(received_at__gte=cutoff)
            .values("trading_good_id", "plant_id")
            .annotate(qty=Sum("qty_received"))
        )
        created = 0
        for row in rows:
            qty = Decimal(str(row["qty"] or 0))
            if qty <= 0:
                continue
            receipts = TradingGoodReceipt.objects.filter(
                received_at__gte=cutoff,
                trading_good_id=row["trading_good_id"],
                plant_id=row["plant_id"],
            )
            total_value = sum((Decimal(str(r.qty_received or 0)) * Decimal(str(r.rate or 0))) for r in receipts)
            avg_cost = (total_value / qty) if qty else Decimal("0")
            TradingGoodStock.objects.create(
                trading_good_id=row["trading_good_id"],
                plant_id=row["plant_id"],
                qty=qty,
                avg_cost=avg_cost,
            )
            created += 1
        return created

    def handle(self, *args, **options):
        cutoff = self._parse_cutoff(options["cutoff"])
        apply = bool(options["apply"])
        if apply and options["confirm"] != RESET_TOKEN:
            raise CommandError(f"Refusing reset. Pass --confirm {RESET_TOKEN}.")

        before = self._counts(cutoff)
        result = {
            "applied": apply,
            "before": before,
            "deleted": {},
            "updated": {},
            "rebuilt": {},
            "after": None,
        }

        if not apply:
            self._write_snapshot(options["backup_file"], result)
            self.stdout.write(json.dumps(result, indent=2, default=str))
            self.stdout.write(self.style.WARNING("Dry run only. No rows were changed."))
            return

        with transaction.atomic():
            released = InventoryReservation.objects.filter(
                created_at__lt=cutoff,
                status="ACTIVE",
            ).update(status="RELEASED")
            result["updated"]["released_reservations"] = released

            stale_rolls = InventoryRoll.objects.filter(
                created_at__lt=cutoff,
                status__in=["AVAILABLE", "RESERVED", "IN_PROCESS", "SENT_JOBWORK"],
            )
            stale_roll_count = 0
            for roll in stale_rolls.select_for_update().only(
                "id", "status", "weight_kg", "net_weight_kg", "gross_weight_kg", "meta_json"
            ):
                meta = dict(roll.meta_json or {})
                meta["reset_before_cutoff"] = {
                    "cutoff": cutoff.isoformat(),
                    "previous_status": roll.status,
                    "previous_weight_kg": str(roll.weight_kg),
                }
                roll.status = "CONSUMED"
                roll.weight_kg = Decimal("0")
                roll.net_weight_kg = Decimal("0")
                roll.gross_weight_kg = Decimal("0")
                roll.meta_json = meta
                roll.save(update_fields=["status", "weight_kg", "net_weight_kg", "gross_weight_kg", "meta_json"])
                stale_roll_count += 1
            result["updated"]["zeroed_pre_cutoff_rolls"] = stale_roll_count

            deleted_bulk, _ = BulkTransaction.objects.filter(created_at__lt=cutoff).delete()
            deleted_packaging, _ = PackagingTransaction.objects.filter(created_at__lt=cutoff).delete()
            deleted_trading, _ = TradingGoodReceipt.objects.filter(received_at__lt=cutoff).delete()
            result["deleted"]["bulk_transaction_tree"] = deleted_bulk
            result["deleted"]["packaging_transaction_tree"] = deleted_packaging
            result["deleted"]["trading_receipt_tree"] = deleted_trading

            result["rebuilt"]["bulk_stock_rows"] = self._rebuild_bulk_stock(cutoff)
            result["rebuilt"]["packaging_stock_rows"] = self._rebuild_packaging_stock(cutoff)
            result["rebuilt"]["trading_stock_rows"] = self._rebuild_trading_stock(cutoff)

        result["after"] = self._counts(cutoff)
        self._write_snapshot(options["backup_file"], result)
        self.stdout.write(json.dumps(result, indent=2, default=str))
        self.stdout.write(self.style.SUCCESS("Inventory cutoff reset complete. June 1+ movements and all master data were preserved."))
