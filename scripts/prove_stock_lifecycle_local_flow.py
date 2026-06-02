#!/usr/bin/env python3
"""Rollback-safe local proof for the stock lifecycle flow."""

from __future__ import annotations

import os
import sys
from datetime import date, datetime, time
from decimal import Decimal
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django  # noqa: E402

django.setup()

from django.db import transaction  # noqa: E402
from django.utils import timezone  # noqa: E402

from apps.factory.models import Plant  # noqa: E402
from apps.inventory.models import (  # noqa: E402
    InventoryAuditBatch,
    InventoryBulk,
    InventoryFinancialPeriod,
    InventoryLocation,
    PackagingStock,
    PackagingTransaction,
)
from apps.inventory.services.audit import InventoryAuditService, financial_year_dates  # noqa: E402
from apps.inventory.services.inventory_audit_service import InventoryAuditService as SnapshotService  # noqa: E402
from apps.inventory.services.roll_service import RollService  # noqa: E402
from apps.materials.models import GranuleQualityCode, InventoryMaterial  # noqa: E402
from apps.materials.stock_forms import STOCK_FORM_LAYFLAT_TUBE, WIDTH_BASIS_LAYFLAT  # noqa: E402


def dec(value: str) -> Decimal:
    return Decimal(value)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def proof_fy() -> str:
    for start in range(3126, 3190):
        fy = f"{start}-{start + 1}"
        if not InventoryFinancialPeriod.objects.filter(financial_year=fy).exists():
            return fy
    raise AssertionError("No temporary proof FY available.")


def cutoff(fy: str):
    start, _ = financial_year_dates(fy)
    return timezone.make_aware(datetime.combine(date(start.year, 4, 30), time(hour=18)))


def post_batch(batch_type: str, plant: Plant, fy: str, notes: str, rows: list[dict]) -> InventoryAuditBatch:
    batch = InventoryAuditService.create_batch(
        payload={"type": batch_type, "plant": str(plant.id), "financial_year": fy, "cutoff_at": cutoff(fy), "notes": notes}
    )
    InventoryAuditService.import_lines(batch=batch, rows=rows)
    posted = InventoryAuditService.post_batch(batch=batch)
    posted.refresh_from_db()
    return posted


def run_proof() -> list[str]:
    tag = datetime.now().strftime("%Y%m%d%H%M%S")
    output: list[str] = []

    with transaction.atomic():
        fy = proof_fy()
        start_date, end_date = financial_year_dates(fy)
        period = InventoryFinancialPeriod.objects.create(financial_year=fy, start_date=start_date, end_date=end_date, status="CLOSING_IN_PROGRESS")
        plant = Plant.objects.create(code=f"SLP{tag[-8:]}", name=f"Stock Lifecycle Proof {tag}")
        raw = InventoryLocation.objects.create(plant=plant, code=f"RM{tag[-5:]}", name="Proof Raw Store", type="RM")
        wip = InventoryLocation.objects.create(plant=plant, code=f"WIP{tag[-5:]}", name="Proof WIP Store", type="WIP")
        pack_loc = InventoryLocation.objects.create(plant=plant, code=f"PK{tag[-5:]}", name="Proof Packing Yard", type="FG")

        granule = InventoryMaterial.objects.create(code=f"SLP-LDPE-{tag[-6:]}", name="Proof LDPE Granule", category="GRANULE", base_uom="KG", status="ACTIVE")
        code_a = GranuleQualityCode.objects.create(granule=granule, code=f"A-{tag[-5:]}")
        code_b = GranuleQualityCode.objects.create(granule=granule, code=f"B-{tag[-5:]}")
        family = InventoryMaterial.objects.create(code=f"SLP-FAM-{tag[-6:]}", name="Proof Film Family", category="FILM_FAMILY", base_uom="KG", density_gcm3=dec("0.9200"), status="ACTIVE")
        film = InventoryMaterial.objects.create(code=f"SLP-FILM-{tag[-6:]}", name="Proof Lay-flat Film Variant", category="FILM_VARIANT", base_uom="KG", parent_family=family, status="ACTIVE")
        packaging = InventoryMaterial.objects.create(code=f"SLP-PACK-{tag[-6:]}", name="Proof LD Sheet", category="PACKAGING", base_uom="PCS", packaging_kind="SHEET", packaging_supply_mode="PURCHASED", status="ACTIVE")

        opening = post_batch("OPENING_STOCK", plant, fy, "Proof opening stock.", [
            {"stock_class": "BULK", "material": str(granule.id), "granule_code": str(code_a.id), "location": str(raw.id), "uom": "KG", "quantity": "100", "rate": "72"},
            {"stock_class": "BULK", "material": str(granule.id), "granule_code": str(code_b.id), "location": str(raw.id), "uom": "KG", "quantity": "40", "rate": "74"},
            {"stock_class": "PACKAGING", "material": str(packaging.id), "location": str(pack_loc.id), "uom": "PCS", "quantity": "200", "rate": "2.5"},
        ])
        require(opening.status == "POSTED", "opening batch did not post")

        roll = RollService.create_roll(
            material=film,
            weight_kg=dec("25"),
            location=wip,
            width_mm=dec("500"),
            thickness_micron=dec("50"),
            batch_no=f"SLP-ROLL-{tag[-6:]}",
            stock_form=STOCK_FORM_LAYFLAT_TUBE,
            width_basis=WIDTH_BASIS_LAYFLAT,
            notes="Stock lifecycle proof lay-flat roll.",
        )

        snapshot = InventoryAuditService.stock_snapshot(plant_id=str(plant.id))
        require(any(row.get("granule_code") == str(code_a.id) for row in snapshot["rows"]), "granule code A missing from snapshot")
        require(any(row.get("granule_code") == str(code_b.id) for row in snapshot["rows"]), "granule code B missing from snapshot")
        require(any(row.get("label_id") == roll.label_id and row.get("stock_form") == STOCK_FORM_LAYFLAT_TUBE for row in snapshot["rows"]), "lay-flat roll missing from snapshot")
        require(any(row.get("stock_class") == "PACKAGING" and row.get("material") == str(packaging.id) for row in snapshot["rows"]), "packaging missing from snapshot")

        count_a = post_batch("PHYSICAL_COUNT", plant, fy, "Proof raw-store partial count: only code A.", [
            {"stock_class": "BULK", "material": str(granule.id), "granule_code": str(code_a.id), "location": str(raw.id), "uom": "KG", "counted_qty": "95", "notes": "Training variance."}
        ])
        require(InventoryBulk.objects.get(material=granule, granule_code=code_a, location=raw).qty_kg == dec("95.0000"), "code A did not become 95 kg")
        require(InventoryBulk.objects.get(material=granule, granule_code=code_b, location=raw).qty_kg == dec("40.0000"), "code B was changed")

        roll_count = post_batch("PHYSICAL_COUNT", plant, fy, "Proof roll-form partial count.", [
            {"stock_class": "ROLL", "material": str(film.id), "location": str(wip.id), "uom": "KG", "label_id": roll.label_id, "batch_no": roll.batch_no, "counted_qty": "25", "width_mm": "500", "thickness_micron": "50", "length_m": "0", "status": "AVAILABLE"}
        ])
        roll.refresh_from_db()
        require(roll.weight_kg == dec("25.000"), "zero-variance roll count changed weight")

        packing_count = post_batch("PHYSICAL_COUNT", plant, fy, "Proof packing EOD count.", [
            {"stock_class": "PACKAGING", "material": str(packaging.id), "location": str(pack_loc.id), "uom": "PCS", "counted_qty": "190", "notes": "Packing EOD shortage proof."}
        ])
        require(PackagingStock.objects.get(material=packaging, location=pack_loc).qty == dec("190.0000"), "packing stock did not become 190 pcs")
        require(PackagingTransaction.objects.filter(material=packaging, location=pack_loc, type="COUNT_SHORT").exists(), "packing count did not create COUNT_SHORT transaction")

        monthly = SnapshotService.create_snapshot(plant)
        require(monthly.total_bulk_kg == dec("135.000"), "monthly bulk snapshot did not equal 135 kg")
        require(monthly.total_roll_kg == dec("25.000"), "monthly roll snapshot did not equal 25 kg")

        card = InventoryAuditService.stock_card(material_id=str(granule.id), plant_id=str(plant.id), financial_year=fy)
        require(card["opening_qty"] == 140.0 and card["movement_qty"] == -5.0 and card["closing_qty"] == 135.0, "stock card did not balance")

        period = InventoryAuditService.close_period(period=period, plant_id=str(plant.id))
        period.refresh_from_db()
        require(period.status == "CLOSED", "FY close did not close period")
        require(period.closing_batch_id and period.opening_batch_next_year_id, "FY close did not create closing and next opening batches")
        require(InventoryAuditBatch.objects.filter(plant=plant, type="PHYSICAL_COUNT", status="POSTED").count() == 3, "posted count sheet count mismatch")

        output = [
            f"PASS plant={plant.code} fy={fy}",
            f"PASS opening_batch={opening.batch_no} posted",
            f"PASS granule_code_partial_count batch={count_a.batch_no} A=95kg B=40kg untouched",
            f"PASS roll_form_count batch={roll_count.batch_no} label={roll.label_id} form={roll.stock_form}",
            f"PASS packing_eod_count batch={packing_count.batch_no} packaging=190pcs transaction=COUNT_SHORT",
            f"PASS month_snapshot bulk={monthly.total_bulk_kg}kg roll={monthly.total_roll_kg}kg",
            f"PASS stock_card opening={card['opening_qty']} movement={card['movement_qty']} closing={card['closing_qty']}",
            f"PASS fy_close closing_batch={period.closing_batch.batch_no} next_opening={period.opening_batch_next_year.batch_no}",
            "PASS rollback_safe=True temporary proof data removed after transaction",
        ]
        transaction.set_rollback(True)

    return output


def main() -> None:
    for line in run_proof():
        print(line)


if __name__ == "__main__":
    main()
