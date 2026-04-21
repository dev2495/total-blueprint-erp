from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Any, Dict, Iterable, List, Optional

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from apps.factory.models import Plant
from apps.inventory.models import (
    BulkTransaction,
    DeliveryChallan,
    InventoryAlert,
    InventoryAuditBatch,
    InventoryAuditLine,
    InventoryBulk,
    InventoryFinancialPeriod,
    InventoryLocation,
    InventoryRoll,
    JobWorkOrder,
    PackagingStock,
    PackagingTransaction,
    RollMovement,
)
from apps.inventory.services.bulk_service import BulkService
from apps.inventory.services.packaging_service import PackagingService
from apps.inventory.services.roll_service import RollService
from apps.materials.models import GranuleQualityCode, InventoryMaterial


def _dec(value: Any, fallback: str = "0") -> Decimal:
    if value in (None, ""):
        return Decimal(fallback)
    return Decimal(str(value))


def current_indian_financial_year(today: Optional[date] = None) -> str:
    today = today or timezone.localdate()
    start_year = today.year if today.month >= 4 else today.year - 1
    return f"{start_year}-{start_year + 1}"


def financial_year_dates(financial_year: str) -> tuple[date, date]:
    try:
        start_year = int(str(financial_year).split("-", 1)[0])
    except Exception as exc:
        raise ValidationError("Financial year must be like 2026-2027.") from exc
    return date(start_year, 4, 1), date(start_year + 1, 3, 31)


class InventoryAuditService:
    @classmethod
    def ensure_default_period(cls) -> InventoryFinancialPeriod:
        fy = current_indian_financial_year()
        start_date, end_date = financial_year_dates(fy)
        period, _ = InventoryFinancialPeriod.objects.get_or_create(
            financial_year=fy,
            defaults={"start_date": start_date, "end_date": end_date, "status": "OPEN"},
        )
        return period

    @classmethod
    def start_period(cls, *, financial_year: str, user=None) -> InventoryFinancialPeriod:
        start_date, end_date = financial_year_dates(financial_year)
        open_period = InventoryFinancialPeriod.objects.filter(status="OPEN").exclude(financial_year=financial_year).first()
        if open_period:
            raise ValidationError(f"Close {open_period.financial_year} before starting another open period.")
        period, created = InventoryFinancialPeriod.objects.get_or_create(
            financial_year=financial_year,
            defaults={"start_date": start_date, "end_date": end_date, "status": "OPEN"},
        )
        if not created and period.status == "CLOSED":
            raise ValidationError("Cannot reopen a closed financial year from this screen.")
        if period.status != "OPEN":
            period.status = "OPEN"
            period.save(update_fields=["status", "updated_at"])
        return period

    @classmethod
    def assert_period_allows_cutoff(cls, financial_year: str, cutoff_at) -> None:
        period = InventoryFinancialPeriod.objects.filter(financial_year=financial_year).first()
        if period and period.status == "CLOSED":
            raise ValidationError(
                f"Financial year {financial_year} is closed. Use an FY correction batch with approval trail."
            )
        if period and cutoff_at:
            cutoff_date = cutoff_at.date() if hasattr(cutoff_at, "date") else cutoff_at
            if cutoff_date < period.start_date or cutoff_date > period.end_date:
                raise ValidationError("Cutoff date must fall inside the selected financial year.")

    @classmethod
    def create_batch(cls, *, payload: Dict[str, Any], user=None) -> InventoryAuditBatch:
        batch_type = str(payload.get("type") or "").upper()
        if batch_type not in dict(InventoryAuditBatch.TYPE_CHOICES):
            raise ValidationError("Invalid audit batch type.")
        financial_year = str(payload.get("financial_year") or current_indian_financial_year()).strip()
        plant_id = payload.get("plant")
        cutoff_value = payload.get("cutoff_at")
        cutoff_at = cls._parse_cutoff(cutoff_value) if cutoff_value else timezone.now()
        if batch_type != "FY_CORRECTION":
            cls.assert_period_allows_cutoff(financial_year, cutoff_at)
        batch = InventoryAuditBatch.objects.create(
            type=batch_type,
            plant_id=plant_id,
            financial_year=financial_year,
            cutoff_at=cutoff_at,
            notes=payload.get("notes") or "",
            source_file_name=payload.get("source_file_name") or "",
            created_by=user if getattr(user, "is_authenticated", False) else None,
        )
        return batch

    @classmethod
    def _parse_cutoff(cls, value):
        if isinstance(value, datetime):
            return value if timezone.is_aware(value) else timezone.make_aware(value)
        if isinstance(value, date):
            return timezone.make_aware(datetime.combine(value, time.max))
        raw = str(value or "").strip()
        if not raw:
            return timezone.now()
        parsed = None
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            try:
                parsed = datetime.combine(date.fromisoformat(raw), time.max)
            except ValueError as exc:
                raise ValidationError("cutoff_at must be an ISO date or datetime.") from exc
        return parsed if timezone.is_aware(parsed) else timezone.make_aware(parsed)

    @classmethod
    @transaction.atomic
    def import_lines(cls, *, batch: InventoryAuditBatch, rows: Iterable[Dict[str, Any]]) -> List[InventoryAuditLine]:
        if batch.status != "DRAFT":
            raise ValidationError("Only draft batches can be edited.")
        created = []
        for row in rows:
            created.append(cls.upsert_line(batch=batch, payload=row))
        cls.refresh_batch_summary(batch)
        return created

    @classmethod
    def upsert_line(cls, *, batch: InventoryAuditBatch, payload: Dict[str, Any]) -> InventoryAuditLine:
        material = InventoryMaterial.objects.get(id=payload.get("material"))
        location = InventoryLocation.objects.select_related("plant").get(id=payload.get("location"))
        if str(location.plant_id) != str(batch.plant_id):
            raise ValidationError("Line location must belong to the batch plant.")

        line = InventoryAuditLine(
            batch=batch,
            stock_class=str(payload.get("stock_class") or "").upper(),
            material=material,
            granule_code_id=payload.get("granule_code") or payload.get("granule_code_id") or None,
            grade_id=payload.get("grade") or payload.get("grade_id") or None,
            plant=batch.plant,
            location=location,
            uom=payload.get("uom") or getattr(material, "base_uom", "KG") or "KG",
            system_qty=_dec(payload.get("system_qty")),
            counted_qty=_dec(payload.get("counted_qty")) if payload.get("counted_qty") not in (None, "") else None,
            opening_qty=_dec(payload.get("opening_qty") if payload.get("opening_qty") not in (None, "") else payload.get("quantity")),
            rate=_dec(payload.get("rate")) if payload.get("rate") not in (None, "") else None,
            label_id=str(payload.get("label_id") or "").strip(),
            batch_no=str(payload.get("batch_no") or "").strip(),
            width_mm=_dec(payload.get("width_mm")) if payload.get("width_mm") not in (None, "") else None,
            thickness_micron=_dec(payload.get("thickness_micron")) if payload.get("thickness_micron") not in (None, "") else None,
            length_m=_dec(payload.get("length_m")) if payload.get("length_m") not in (None, "") else None,
            is_fg=bool(payload.get("is_fg", False)),
            stage_index=int(payload.get("stage_index") or 0),
            status=str(payload.get("status") or "AVAILABLE").upper(),
            packaging_kind=str(payload.get("packaging_kind") or getattr(material, "packaging_kind", "") or ""),
            base_uom=str(payload.get("base_uom") or getattr(material, "base_uom", "") or ""),
        )
        line.row_errors = cls.validate_line(line)
        if batch.type in {"PHYSICAL_COUNT", "FY_CORRECTION"}:
            line.system_qty = cls.resolve_system_qty(line)
            if line.counted_qty is None:
                line.counted_qty = line.system_qty
        line.save()
        return line

    @classmethod
    def validate_line(cls, line: InventoryAuditLine) -> List[str]:
        errors: List[str] = []
        stock_class = str(line.stock_class or "").upper()
        category = str(getattr(line.material, "category", "") or "").upper()
        if stock_class not in {"BULK", "ROLL", "PACKAGING"}:
            errors.append("Stock class must be BULK, ROLL, or PACKAGING.")
        if not line.material_id:
            errors.append("Material is required.")
        if not line.location_id:
            errors.append("Location is required.")
        if line.granule_code_id:
            if category != "GRANULE":
                errors.append("Granule code can only be used with granule materials.")
            elif str(line.granule_code.granule_id) != str(line.material_id):
                errors.append("Granule code does not belong to this granule.")
        if stock_class == "PACKAGING" and category != "PACKAGING":
            errors.append("Packaging audit lines require a PACKAGING material.")
        if stock_class == "ROLL":
            if category != "FILM_VARIANT":
                errors.append("Roll audit lines require a FILM_VARIANT material.")
            if _dec(line.opening_qty) <= 0 and line.batch.type == "OPENING_STOCK":
                errors.append("Roll opening weight is required.")
            if _dec(line.width_mm) <= 0:
                errors.append("Roll width is required.")
            if _dec(line.thickness_micron) <= 0:
                errors.append("Roll thickness is required.")
            if getattr(line.material, "is_extrudable", False) and not line.grade_id:
                errors.append("Grade is required for extrudable roll stock.")
        if stock_class in {"BULK", "PACKAGING"} and line.batch.type == "OPENING_STOCK" and _dec(line.opening_qty) <= 0:
            errors.append("Opening quantity is required.")
        if line.batch.type in {"PHYSICAL_COUNT", "FY_CORRECTION"} and line.counted_qty is None:
            errors.append("Counted quantity is required.")
        return errors

    @classmethod
    def validate_batch(cls, *, batch: InventoryAuditBatch) -> Dict[str, Any]:
        errors = []
        for line in batch.lines.select_related("material", "location", "granule_code"):
            line.row_errors = cls.validate_line(line)
            if batch.type in {"PHYSICAL_COUNT", "FY_CORRECTION"}:
                line.system_qty = cls.resolve_system_qty(line)
            line.save(update_fields=["row_errors", "system_qty", "variance_qty", "value", "updated_at"])
            if line.row_errors:
                errors.append({"line_id": str(line.id), "errors": line.row_errors})
        cls.refresh_batch_summary(batch)
        return {"ok": not errors, "errors": errors, "summary": batch.summary_json}

    @classmethod
    def resolve_system_qty(cls, line: InventoryAuditLine) -> Decimal:
        stock_class = str(line.stock_class or "").upper()
        if stock_class == "BULK":
            qs = InventoryBulk.objects.filter(material=line.material, plant=line.plant, location=line.location)
            if line.granule_code_id:
                qs = qs.filter(granule_code=line.granule_code)
            return qs.aggregate(total=Sum("qty_kg")).get("total") or Decimal("0")
        if stock_class == "PACKAGING":
            stock = PackagingStock.objects.filter(material=line.material, plant=line.plant, location=line.location).first()
            return _dec(getattr(stock, "qty", 0))
        if stock_class == "ROLL":
            qs = InventoryRoll.objects.filter(material=line.material, location=line.location)
            if line.label_id:
                qs = qs.filter(label_id=line.label_id)
            if line.grade_id:
                qs = qs.filter(grade=line.grade)
            return qs.aggregate(total=Sum("weight_kg")).get("total") or Decimal("0")
        return Decimal("0")

    @classmethod
    @transaction.atomic
    def post_batch(cls, *, batch: InventoryAuditBatch, user=None) -> InventoryAuditBatch:
        batch = InventoryAuditBatch.objects.select_for_update().get(id=batch.id)
        if batch.status != "DRAFT":
            raise ValidationError("Only draft batches can be posted.")
        if batch.type != "FY_CORRECTION":
            cls.assert_period_allows_cutoff(batch.financial_year, batch.cutoff_at)
        validation = cls.validate_batch(batch=batch)
        if not validation["ok"]:
            raise ValidationError({"lines": validation["errors"]})
        if not batch.lines.exists():
            raise ValidationError("Add at least one audit line before posting.")

        for line in batch.lines.select_related("material", "location", "grade", "granule_code").order_by("created_at"):
            refs = cls._post_line(line=line, user=user)
            line.posted_reference_json = refs
            line.save(update_fields=["posted_reference_json", "updated_at"])

        batch.status = "POSTED"
        batch.posted_by = user if getattr(user, "is_authenticated", False) else None
        batch.posted_at = timezone.now()
        cls.refresh_batch_summary(batch, save=False)
        batch.save(update_fields=["status", "posted_by", "posted_at", "summary_json", "updated_at"])
        return batch

    @classmethod
    def _post_line(cls, *, line: InventoryAuditLine, user=None) -> Dict[str, Any]:
        if line.batch.type == "OPENING_STOCK":
            qty = _dec(line.opening_qty)
        elif line.batch.type in {"PHYSICAL_COUNT", "FY_CORRECTION"}:
            qty = _dec(line.counted_qty) - _dec(line.system_qty)
        elif line.batch.type == "FY_CLOSE":
            return {"snapshot": True}
        else:
            raise ValidationError("Unsupported audit batch type.")

        if qty == 0:
            return {"skipped": "zero_variance"}
        reference = f"{line.batch.type}:{line.batch.financial_year}:{line.batch.batch_no}"
        stock_class = str(line.stock_class).upper()
        if stock_class == "BULK":
            tx = cls._adjust_bulk(line=line, qty=qty, reference=reference)
            return {"bulk_transaction_id": str(tx.id)}
        if stock_class == "PACKAGING":
            tx = PackagingService.adjust_packaging_stock(
                material_id=str(line.material_id),
                qty=qty,
                location_id=str(line.location_id),
                reference=reference,
                input_uom=line.uom or getattr(line.material, "base_uom", None),
                meta_json={"inventory_audit_batch": str(line.batch_id), "inventory_audit_line": str(line.id)},
            )
            if tx.type != "ADJUST":
                tx.type = "ADJUST"
                tx.save(update_fields=["type"])
            return {"packaging_transaction_id": str(tx.id)}
        if stock_class == "ROLL":
            refs = cls._adjust_roll(line=line, qty=qty, reference=reference, user=user)
            return refs
        raise ValidationError("Unsupported stock class.")

    @classmethod
    def _adjust_bulk(cls, *, line: InventoryAuditLine, qty: Decimal, reference: str) -> BulkTransaction:
        if qty > 0:
            return BulkService.add_bulk(
                str(line.material_id),
                qty,
                str(line.plant_id),
                str(line.location_id),
                cost=line.rate or 0,
                reference=reference,
                tx_type="ADJUST",
                granule_code_id=str(line.granule_code_id) if line.granule_code_id else None,
            )
        tx = BulkService.consume_bulk(
            str(line.material_id),
            abs(qty),
            str(line.location_id),
            reference=reference,
            granule_code_id=str(line.granule_code_id) if line.granule_code_id else None,
        )
        tx.type = "ADJUST"
        tx.save(update_fields=["type"])
        return tx

    @classmethod
    def _adjust_roll(cls, *, line: InventoryAuditLine, qty: Decimal, reference: str, user=None) -> Dict[str, Any]:
        if qty > 0:
            roll = RollService.create_roll(
                material=line.material,
                weight_kg=qty,
                location=line.location,
                width_mm=line.width_mm,
                thickness_micron=line.thickness_micron,
                batch_no=line.batch_no or None,
                length_m=line.length_m or Decimal("0"),
                grade=line.grade,
                is_fg=line.is_fg,
                plant=line.plant,
                user=user if getattr(user, "is_authenticated", False) else None,
                notes=reference,
            )
            if line.label_id and line.label_id != roll.label_id:
                roll.label_id = line.label_id
                roll.save(update_fields=["label_id"])
            return {"roll_id": str(roll.id), "roll_label": roll.label_id}

        qs = InventoryRoll.objects.select_for_update().filter(material=line.material, location=line.location)
        if line.label_id:
            qs = qs.filter(label_id=line.label_id)
        roll = qs.order_by("created_at").first()
        if not roll:
            raise ValidationError("No roll exists for the negative roll adjustment.")
        new_weight = _dec(roll.weight_kg) + qty
        if new_weight < 0:
            raise ValidationError(f"Roll adjustment would make {roll.label_id} negative.")
        roll.weight_kg = new_weight
        if new_weight == 0:
            roll.status = "SCRAPPED"
        roll.save(update_fields=["weight_kg", "status"])
        movement = RollMovement.objects.create(
            roll=roll,
            from_location=roll.location,
            to_location=roll.location,
            reason="ADJUSTMENT",
            reason_note=reference,
            moved_by=user if getattr(user, "is_authenticated", False) else None,
        )
        return {"roll_id": str(roll.id), "roll_movement_id": str(movement.id)}

    @classmethod
    def refresh_batch_summary(cls, batch: InventoryAuditBatch, save: bool = True) -> Dict[str, Any]:
        summary = {
            "lines": batch.lines.count(),
            "bulk_kg": 0.0,
            "roll_kg": 0.0,
            "packaging_qty": 0.0,
            "wip_kg": 0.0,
            "fg_kg": 0.0,
            "scrap_kg": 0.0,
            "value": 0.0,
            "missing_rates": 0,
            "errors": 0,
        }
        for line in batch.lines.all():
            qty = _dec(line.opening_qty or line.counted_qty or line.system_qty)
            if batch.type in {"PHYSICAL_COUNT", "FY_CORRECTION"}:
                qty = abs(_dec(line.variance_qty))
            if line.stock_class == "BULK":
                summary["bulk_kg"] += float(qty)
            elif line.stock_class == "ROLL":
                summary["roll_kg"] += float(qty)
                if line.is_fg:
                    summary["fg_kg"] += float(qty)
                else:
                    summary["wip_kg"] += float(qty)
            elif line.stock_class == "PACKAGING":
                summary["packaging_qty"] += float(qty)
            summary["value"] += float(line.value or 0)
            if line.rate in (None, Decimal("0")):
                summary["missing_rates"] += 1
            if line.row_errors:
                summary["errors"] += 1
        batch.summary_json = summary
        if save:
            batch.save(update_fields=["summary_json", "updated_at"])
        return summary

    @classmethod
    def closing_preview(cls, *, plant_id: Optional[str], financial_year: Optional[str]) -> Dict[str, Any]:
        if not financial_year:
            financial_year = current_indian_financial_year()
        plant = Plant.objects.filter(id=plant_id).first() if plant_id else Plant.objects.first()
        if not plant:
            return {"financial_year": financial_year, "plant": None, "rows": [], "totals": {}, "blockers": []}
        rows = cls.current_stock_snapshot_rows(plant=plant)
        totals = cls._snapshot_totals(rows)
        movements = cls.period_movement_summary(plant=plant, financial_year=financial_year)
        blockers = cls.close_blockers(plant=plant)
        return {
            "financial_year": financial_year,
            "plant": {"id": str(plant.id), "name": plant.name, "code": plant.code},
            "rows": rows,
            "totals": totals,
            "movements": movements,
            "blockers": blockers,
        }

    @classmethod
    def current_stock_snapshot_rows(cls, *, plant: Plant) -> List[Dict[str, Any]]:
        rows: List[Dict[str, Any]] = []
        for bulk in InventoryBulk.objects.select_related("material", "granule_code", "location").filter(plant=plant, qty_kg__gt=0):
            rows.append({
                "stock_class": "BULK",
                "material": str(bulk.material_id),
                "material_code": bulk.material.code,
                "material_name": bulk.material.name,
                "granule_code": str(bulk.granule_code_id) if bulk.granule_code_id else None,
                "granule_code_label": bulk.granule_code.code if bulk.granule_code else None,
                "location": str(bulk.location_id),
                "location_name": bulk.location.name,
                "qty": float(bulk.qty_kg or 0),
                "uom": "KG",
                "rate": float(bulk.avg_cost or 0),
            })
        for roll in InventoryRoll.objects.select_related("material", "grade", "location").filter(location__plant=plant).exclude(status__in=["CONSUMED", "SCRAPPED"]):
            rows.append({
                "stock_class": "ROLL",
                "material": str(roll.material_id),
                "material_code": roll.material.code if roll.material else "",
                "material_name": roll.material.name if roll.material else "",
                "grade": str(roll.grade_id) if roll.grade_id else None,
                "grade_name": roll.grade.name if roll.grade else None,
                "location": str(roll.location_id),
                "location_name": roll.location.name,
                "qty": float(roll.weight_kg or 0),
                "uom": "KG",
                "label_id": roll.label_id,
                "batch_no": roll.batch_no,
                "width_mm": float(roll.width_mm or 0),
                "thickness_micron": float(roll.thickness_micron or 0),
                "length_m": float(roll.length_m or 0),
                "is_fg": bool(roll.is_fg),
                "stage_index": roll.stage_index,
                "status": roll.status,
                "rate": 0,
            })
        for stock in PackagingStock.objects.select_related("material", "location").filter(plant=plant, qty__gt=0):
            rows.append({
                "stock_class": "PACKAGING",
                "material": str(stock.material_id),
                "material_code": stock.material.code,
                "material_name": stock.material.name,
                "location": str(stock.location_id),
                "location_name": stock.location.name,
                "qty": float(stock.qty or 0),
                "uom": stock.material.base_uom,
                "packaging_kind": stock.material.packaging_kind,
                "base_uom": stock.material.base_uom,
                "rate": float(stock.avg_cost or 0),
            })
        return rows

    @classmethod
    def _snapshot_totals(cls, rows: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
        totals = defaultdict(float)
        for row in rows:
            stock_class = row["stock_class"]
            qty = float(row.get("qty") or 0)
            if stock_class == "BULK":
                totals["bulk_kg"] += qty
            elif stock_class == "ROLL":
                totals["roll_kg"] += qty
                totals["fg_kg" if row.get("is_fg") else "wip_kg"] += qty
            elif stock_class == "PACKAGING":
                totals["packaging_qty"] += qty
            totals["value"] += qty * float(row.get("rate") or 0)
        totals["rows"] = len(list(rows)) if not isinstance(rows, list) else len(rows)
        return dict(totals)

    @classmethod
    def period_movement_summary(cls, *, plant: Plant, financial_year: str) -> Dict[str, float]:
        start_date, end_date = financial_year_dates(financial_year)
        bulk_qs = BulkTransaction.objects.filter(location__plant=plant, created_at__date__gte=start_date, created_at__date__lte=end_date)
        packaging_qs = PackagingTransaction.objects.filter(location__plant=plant, created_at__date__gte=start_date, created_at__date__lte=end_date)
        roll_qs = RollMovement.objects.filter(to_location__plant=plant, timestamp__date__gte=start_date, timestamp__date__lte=end_date)
        movement = defaultdict(float)
        for tx in bulk_qs:
            movement[f"bulk_{tx.type.lower()}_kg"] += float(tx.qty_kg or 0)
        for tx in packaging_qs:
            movement[f"packaging_{tx.type.lower()}"] += float(tx.qty or 0)
        for mv in roll_qs.select_related("roll"):
            movement[f"roll_{mv.reason.lower()}_kg"] += float(getattr(mv.roll, "weight_kg", 0) or 0)
        return dict(movement)

    @classmethod
    def close_blockers(cls, *, plant: Plant) -> List[Dict[str, Any]]:
        blockers = []
        negative_bulk = InventoryBulk.objects.filter(plant=plant, qty_kg__lt=0).count()
        if negative_bulk:
            blockers.append({"code": "NEGATIVE_BULK", "label": "Negative bulk stock", "count": negative_bulk})
        open_challans = DeliveryChallan.objects.filter(from_plant=plant, status__in=["DRAFT", "APPROVED", "IN_TRANSIT"]).count()
        if open_challans:
            blockers.append({"code": "OPEN_INTERPLANT", "label": "Open inter-plant challans", "count": open_challans})
        open_jobwork = JobWorkOrder.objects.filter(plant=plant, status__in=["DRAFT", "SENT", "PARTIAL"]).count()
        if open_jobwork:
            blockers.append({"code": "OPEN_JOBWORK", "label": "Open jobwork orders", "count": open_jobwork})
        critical_alerts = InventoryAlert.objects.filter(plant=plant, resolved=False, severity="CRITICAL").count()
        if critical_alerts:
            blockers.append({"code": "CRITICAL_ALERTS", "label": "Unresolved critical inventory alerts", "count": critical_alerts})
        draft_batches = InventoryAuditBatch.objects.filter(plant=plant, status="DRAFT").count()
        if draft_batches:
            blockers.append({"code": "DRAFT_AUDIT_BATCHES", "label": "Draft inventory audit batches", "count": draft_batches})
        return blockers

    @classmethod
    @transaction.atomic
    def begin_close(cls, *, period: InventoryFinancialPeriod) -> InventoryFinancialPeriod:
        if period.status == "CLOSED":
            raise ValidationError("Financial year is already closed.")
        period.status = "CLOSING_IN_PROGRESS"
        period.save(update_fields=["status", "updated_at"])
        return period

    @classmethod
    @transaction.atomic
    def close_period(cls, *, period: InventoryFinancialPeriod, plant_id: str, user=None) -> InventoryFinancialPeriod:
        period = InventoryFinancialPeriod.objects.select_for_update().get(id=period.id)
        if period.status == "CLOSED":
            raise ValidationError("Financial year is already closed.")
        plant = Plant.objects.get(id=plant_id)
        blockers = cls.close_blockers(plant=plant)
        if blockers:
            raise ValidationError({"blockers": blockers})

        cutoff_at = timezone.make_aware(datetime.combine(period.end_date, time.max))
        close_batch = InventoryAuditBatch.objects.create(
            type="FY_CLOSE",
            plant=plant,
            financial_year=period.financial_year,
            cutoff_at=cutoff_at,
            status="LOCKED",
            posted_by=user if getattr(user, "is_authenticated", False) else None,
            posted_at=timezone.now(),
            locked_by=user if getattr(user, "is_authenticated", False) else None,
            locked_at=timezone.now(),
            notes="System generated closing stock snapshot.",
        )
        snapshot_rows = cls.current_stock_snapshot_rows(plant=plant)
        for row in snapshot_rows:
            line = cls._line_from_snapshot(close_batch, row)
            line.system_qty = _dec(row["qty"])
            line.counted_qty = _dec(row["qty"])
            line.opening_qty = _dec(row["qty"])
            line.save()
        cls.refresh_batch_summary(close_batch)

        next_start = period.end_date + timedelta(days=1)
        next_fy = f"{next_start.year}-{next_start.year + 1}"
        next_opening = InventoryAuditBatch.objects.create(
            type="OPENING_STOCK",
            plant=plant,
            financial_year=next_fy,
            cutoff_at=timezone.make_aware(datetime.combine(next_start, time.min)),
            status="POSTED",
            posted_by=user if getattr(user, "is_authenticated", False) else None,
            posted_at=timezone.now(),
            notes=f"System generated from closing batch {close_batch.batch_no}.",
        )
        for row in snapshot_rows:
            line = cls._line_from_snapshot(next_opening, row)
            line.opening_qty = _dec(row["qty"])
            line.posted_reference_json = {"generated_from_closing_batch": str(close_batch.id), "no_physical_repost": True}
            line.save()
        cls.refresh_batch_summary(next_opening)

        period.status = "CLOSED"
        period.closed_by = user if getattr(user, "is_authenticated", False) else None
        period.closed_at = timezone.now()
        period.closing_batch = close_batch
        period.opening_batch_next_year = next_opening
        period.save(update_fields=["status", "closed_by", "closed_at", "closing_batch", "opening_batch_next_year", "updated_at"])

        next_start_date, next_end_date = financial_year_dates(next_fy)
        InventoryFinancialPeriod.objects.get_or_create(
            financial_year=next_fy,
            defaults={"start_date": next_start_date, "end_date": next_end_date, "status": "OPEN"},
        )
        return period

    @classmethod
    def _line_from_snapshot(cls, batch: InventoryAuditBatch, row: Dict[str, Any]) -> InventoryAuditLine:
        return InventoryAuditLine(
            batch=batch,
            stock_class=row["stock_class"],
            material_id=row["material"],
            granule_code_id=row.get("granule_code"),
            grade_id=row.get("grade"),
            plant=batch.plant,
            location_id=row["location"],
            uom=row.get("uom") or "KG",
            rate=_dec(row.get("rate")) if row.get("rate") not in (None, "") else None,
            label_id=row.get("label_id") or "",
            batch_no=row.get("batch_no") or "",
            width_mm=_dec(row.get("width_mm")) if row.get("width_mm") not in (None, "") else None,
            thickness_micron=_dec(row.get("thickness_micron")) if row.get("thickness_micron") not in (None, "") else None,
            length_m=_dec(row.get("length_m")) if row.get("length_m") not in (None, "") else None,
            is_fg=bool(row.get("is_fg")),
            stage_index=int(row.get("stage_index") or 0),
            status=row.get("status") or "AVAILABLE",
            packaging_kind=row.get("packaging_kind") or "",
            base_uom=row.get("base_uom") or "",
        )

    @classmethod
    def stock_card(cls, *, material_id: Optional[str] = None, plant_id: Optional[str] = None, location_id: Optional[str] = None, date_from=None, date_to=None) -> Dict[str, Any]:
        rows: List[Dict[str, Any]] = []
        opening_total = Decimal("0")
        movement_total = Decimal("0")

        batch_lines = InventoryAuditLine.objects.select_related("batch", "material", "location").filter(batch__status__in=["POSTED", "LOCKED"])
        if material_id:
            batch_lines = batch_lines.filter(material_id=material_id)
        if plant_id:
            batch_lines = batch_lines.filter(plant_id=plant_id)
        if location_id:
            batch_lines = batch_lines.filter(location_id=location_id)
        for line in batch_lines.order_by("batch__cutoff_at", "created_at"):
            if date_from and line.batch.cutoff_at.date() < date_from:
                continue
            if date_to and line.batch.cutoff_at.date() > date_to:
                continue
            qty = _dec(line.opening_qty if line.batch.type == "OPENING_STOCK" else (line.variance_qty or line.counted_qty or line.system_qty))
            if line.batch.type == "OPENING_STOCK":
                opening_total += qty
            else:
                movement_total += qty
            rows.append(cls._stock_card_row(
                at=line.batch.cutoff_at,
                source=line.batch.type,
                reference=line.batch.batch_no,
                material=line.material,
                location=line.location,
                qty=qty,
                uom=line.uom,
                meta={"stock_class": line.stock_class, "line_id": str(line.id)},
            ))

        bulk = BulkTransaction.objects.select_related("material", "location").all()
        if material_id:
            bulk = bulk.filter(material_id=material_id)
        if plant_id:
            bulk = bulk.filter(location__plant_id=plant_id)
        if location_id:
            bulk = bulk.filter(location_id=location_id)
        if date_from:
            bulk = bulk.filter(created_at__date__gte=date_from)
        if date_to:
            bulk = bulk.filter(created_at__date__lte=date_to)
        for tx in bulk:
            qty = _dec(tx.qty_kg)
            movement_total += qty
            rows.append(cls._stock_card_row(tx.created_at, f"BULK_{tx.type}", tx.reference or str(tx.id), tx.material, tx.location, qty, "KG", {"transaction_id": str(tx.id)}))

        packaging = PackagingTransaction.objects.select_related("material", "location").all()
        if material_id:
            packaging = packaging.filter(material_id=material_id)
        if plant_id:
            packaging = packaging.filter(location__plant_id=plant_id)
        if location_id:
            packaging = packaging.filter(location_id=location_id)
        if date_from:
            packaging = packaging.filter(created_at__date__gte=date_from)
        if date_to:
            packaging = packaging.filter(created_at__date__lte=date_to)
        for tx in packaging:
            qty = _dec(tx.qty)
            movement_total += qty
            rows.append(cls._stock_card_row(tx.created_at, f"PACKAGING_{tx.type}", tx.reference or str(tx.id), tx.material, tx.location, qty, getattr(tx.material, "base_uom", ""), {"transaction_id": str(tx.id)}))

        rows.sort(key=lambda row: row["at"])
        return {
            "opening_qty": float(opening_total),
            "movement_qty": float(movement_total),
            "closing_qty": float(opening_total + movement_total),
            "rows": rows,
        }

    @classmethod
    def _stock_card_row(cls, at, source: str, reference: str, material, location, qty: Decimal, uom: str, meta: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "at": at.isoformat() if hasattr(at, "isoformat") else str(at),
            "source": source,
            "reference": reference,
            "material_id": str(material.id) if material else None,
            "material_code": getattr(material, "code", ""),
            "material_name": getattr(material, "name", ""),
            "location_id": str(location.id) if location else None,
            "location_name": getattr(location, "name", ""),
            "qty": float(qty),
            "uom": uom,
            "meta": meta,
        }
