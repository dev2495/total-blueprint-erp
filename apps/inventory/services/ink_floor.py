from __future__ import annotations

import logging
from decimal import Decimal
from typing import Any

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone

from apps.inventory.models import (
    BulkTransaction,
    InkFloorCountLine,
    InkFloorMovement,
    InkFloorSession,
    InkMaterial,
    InventoryBulk,
    InventoryLocation,
)
from apps.inventory.services.bulk_service import BulkService
from apps.inventory.services.wac import q4
from apps.materials.models import InventoryMaterial
from apps.production.services.shift_inference import shift_window_for

logger = logging.getLogger(__name__)


def _dec(value: Any) -> Decimal:
    try:
        return q4(value)
    except Exception as exc:
        raise ValidationError("Quantity must be numeric.") from exc


def _event_date(value):
    try:
        return timezone.localtime(value).date()
    except Exception:
        return timezone.now().date()


def _shift_fields(value):
    window = shift_window_for(value)
    code = str(window.get("shift_code") or "").strip().upper()
    started_at = window.get("started_at")
    if started_at:
        try:
            shift_date = timezone.localtime(started_at).date()
        except Exception:
            shift_date = _event_date(value)
    else:
        shift_date = _event_date(value)
    return code, shift_date


class InkFloorService:
    @classmethod
    def _stock_qty(cls, *, material_id, location_id) -> Decimal:
        return q4(
            InventoryBulk.objects.filter(material_id=material_id, location_id=location_id)
            .aggregate(total=Sum("qty_kg"))
            .get("total")
            or Decimal("0")
        )

    @classmethod
    def _source_cost(cls, *, material_id, location_id) -> Decimal:
        row = (
            InventoryBulk.objects.filter(material_id=material_id, location_id=location_id, qty_kg__gt=0)
            .order_by("-updated_at", "-id")
            .first()
        )
        return q4(getattr(row, "avg_cost", 0) or 0)

    @classmethod
    def _assert_ink(cls, material):
        if str(getattr(material, "category", "") or "").upper() != "INK":
            raise ValidationError("Ink floor movements accept INK materials only.")

    @classmethod
    def _assert_unlocked(cls, *, plant_id, location_id, event_at):
        locked = (
            InkFloorSession.objects.filter(
                plant_id=plant_id,
                location_id=location_id,
                status__in=["POSTED", "LOCKED"],
                opened_at__lte=event_at,
                closed_at__gte=event_at,
            )
            .only("id", "reference")
            .first()
        )
        if locked:
            label = locked.reference or locked.id
            raise ValidationError(f"Ink floor window {label} is already posted for this timestamp.")

    @classmethod
    def _transfer(cls, *, material_id, qty, from_location, to_location, reference, qty_uom="KG"):
        qty = _dec(qty)
        if qty <= 0:
            raise ValidationError("Quantity must be positive.")
        cost = cls._source_cost(material_id=material_id, location_id=from_location.id)
        out_tx = BulkService.consume_bulk(
            material_id=material_id,
            qty=qty,
            location_id=from_location.id,
            reference=f"Transfer Out: {reference}",
            qty_uom=qty_uom,
        )
        if out_tx:
            out_tx.type = "TRANSFER"
            out_tx.save(update_fields=["type"])
        in_tx = BulkService.add_bulk(
            material_id=material_id,
            qty=qty,
            plant_id=to_location.plant_id,
            location_id=to_location.id,
            cost=cost,
            reference=f"Transfer In: {reference}",
            tx_type="TRANSFER",
            qty_uom=qty_uom,
        )
        return in_tx

    @classmethod
    @transaction.atomic
    def issue_to_floor(
        cls,
        *,
        material_id,
        qty_kg,
        from_location_id,
        floor_location_id,
        event_at=None,
        shift_code="",
        shift_date=None,
        reference="",
        notes="",
        user=None,
    ) -> InkFloorMovement:
        event_at = event_at or timezone.now()
        source = InventoryLocation.objects.select_related("plant").get(id=from_location_id)
        floor = InventoryLocation.objects.select_related("plant").get(id=floor_location_id)
        if source.plant_id != floor.plant_id:
            raise ValidationError("Ink issue source and floor locations must be in the same plant.")
        material = InventoryMaterial.objects.get(id=material_id)
        cls._assert_ink(material)
        cls._assert_unlocked(plant_id=floor.plant_id, location_id=floor.id, event_at=event_at)
        resolved_shift_code, resolved_shift_date = _shift_fields(event_at)
        tx = cls._transfer(
            material_id=material.id,
            qty=qty_kg,
            from_location=source,
            to_location=floor,
            reference=reference or "Ink issue to floor",
        )
        return InkFloorMovement.objects.create(
            type="ISSUE",
            plant_id=floor.plant_id,
            material=material,
            source_location=source,
            destination_location=floor,
            qty_kg=_dec(qty_kg),
            event_at=event_at,
            shift_code=resolved_shift_code,
            shift_date=resolved_shift_date,
            reference=reference or "",
            notes=notes or "",
            bulk_transaction=tx,
            created_by=user if getattr(user, "is_authenticated", False) else None,
        )

    @classmethod
    @transaction.atomic
    def return_from_floor(
        cls,
        *,
        material_id,
        qty_kg,
        floor_location_id,
        to_location_id,
        event_at=None,
        shift_code="",
        shift_date=None,
        reference="",
        notes="",
        user=None,
    ) -> InkFloorMovement:
        event_at = event_at or timezone.now()
        floor = InventoryLocation.objects.select_related("plant").get(id=floor_location_id)
        destination = InventoryLocation.objects.select_related("plant").get(id=to_location_id)
        if floor.plant_id != destination.plant_id:
            raise ValidationError("Ink return source and destination locations must be in the same plant.")
        material = InventoryMaterial.objects.get(id=material_id)
        cls._assert_ink(material)
        cls._assert_unlocked(plant_id=floor.plant_id, location_id=floor.id, event_at=event_at)
        resolved_shift_code, resolved_shift_date = _shift_fields(event_at)
        tx = cls._transfer(
            material_id=material.id,
            qty=qty_kg,
            from_location=floor,
            to_location=destination,
            reference=reference or "Ink return from floor",
        )
        return InkFloorMovement.objects.create(
            type="RETURN",
            plant_id=floor.plant_id,
            material=material,
            source_location=floor,
            destination_location=destination,
            qty_kg=_dec(qty_kg),
            event_at=event_at,
            shift_code=resolved_shift_code,
            shift_date=resolved_shift_date,
            reference=reference or "",
            notes=notes or "",
            bulk_transaction=tx,
            created_by=user if getattr(user, "is_authenticated", False) else None,
        )

    @classmethod
    def _resolve_mix_target(cls, *, target_material_id=None, target_base_type="", target_color_name="", mix_notes=""):
        if target_material_id:
            target = InkMaterial.objects.get(id=target_material_id)
            target.is_mix = True
            if not target.mix_family:
                target.mix_family = target.color_name
            if mix_notes:
                target.mix_notes = mix_notes
            target.save(update_fields=["is_mix", "mix_family", "mix_notes"])
            return target
        base = str(target_base_type or "").strip().upper()
        color = str(target_color_name or "").strip().upper()
        if base not in {"POLY", "PET"}:
            raise ValidationError("Mix ink base type must be POLY or PET.")
        if not color:
            raise ValidationError("Mix ink color name is required.")
        target, _created = InkMaterial.objects.get_or_create(
            base_type=base,
            color_name=color,
            defaults={
                "is_mix": True,
                "mix_family": color,
                "mix_notes": mix_notes or "",
            },
        )
        updates = []
        if not target.is_mix:
            target.is_mix = True
            updates.append("is_mix")
        if not target.mix_family:
            target.mix_family = color
            updates.append("mix_family")
        if mix_notes and target.mix_notes != mix_notes:
            target.mix_notes = mix_notes
            updates.append("mix_notes")
        if updates:
            target.save(update_fields=updates)
        return target

    @classmethod
    @transaction.atomic
    def mix_return(
        cls,
        *,
        source_material_id,
        qty_kg,
        floor_location_id,
        to_location_id,
        target_material_id=None,
        target_base_type="",
        target_color_name="",
        event_at=None,
        shift_code="",
        shift_date=None,
        reference="",
        notes="",
        user=None,
    ) -> InkFloorMovement:
        event_at = event_at or timezone.now()
        floor = InventoryLocation.objects.select_related("plant").get(id=floor_location_id)
        destination = InventoryLocation.objects.select_related("plant").get(id=to_location_id)
        if floor.plant_id != destination.plant_id:
            raise ValidationError("Mix return source and destination locations must be in the same plant.")
        source = InventoryMaterial.objects.get(id=source_material_id)
        cls._assert_ink(source)
        cls._assert_unlocked(plant_id=floor.plant_id, location_id=floor.id, event_at=event_at)
        resolved_shift_code, resolved_shift_date = _shift_fields(event_at)
        target = cls._resolve_mix_target(
            target_material_id=target_material_id,
            target_base_type=target_base_type or getattr(source, "base_type", ""),
            target_color_name=target_color_name,
            mix_notes=notes,
        )
        qty = _dec(qty_kg)
        cost = cls._source_cost(material_id=source.id, location_id=floor.id)
        out_tx = BulkService.consume_bulk(
            material_id=source.id,
            qty=qty,
            location_id=floor.id,
            reference=f"Mix Return Out: {reference}",
            qty_uom="KG",
        )
        if out_tx:
            out_tx.type = "TRANSFER"
            out_tx.save(update_fields=["type"])
        in_tx = BulkService.add_bulk(
            material_id=target.id,
            qty=qty,
            plant_id=destination.plant_id,
            location_id=destination.id,
            cost=cost,
            reference=f"Mix Return In: {reference}",
            tx_type="TRANSFER",
            qty_uom="KG",
        )
        return InkFloorMovement.objects.create(
            type="MIX_RETURN",
            plant_id=floor.plant_id,
            material=source,
            target_material=target,
            source_location=floor,
            destination_location=destination,
            qty_kg=qty,
            event_at=event_at,
            shift_code=resolved_shift_code,
            shift_date=resolved_shift_date,
            reference=reference or "",
            notes=notes or "",
            bulk_transaction=in_tx,
            created_by=user if getattr(user, "is_authenticated", False) else None,
        )

    @classmethod
    @transaction.atomic
    def post_count(
        cls,
        *,
        plant_id,
        location_id,
        lines,
        counted_at=None,
        opened_at=None,
        shift_code="",
        shift_date=None,
        reference="",
        notes="",
        user=None,
    ) -> InkFloorSession:
        counted_at = counted_at or timezone.now()
        opened_at = opened_at or counted_at
        location = InventoryLocation.objects.select_related("plant").get(id=location_id)
        if str(location.plant_id) != str(plant_id):
            raise ValidationError("Count location does not belong to selected plant.")
        resolved_shift_code, resolved_shift_date = _shift_fields(counted_at)
        session = InkFloorSession.objects.create(
            plant_id=plant_id,
            location=location,
            opened_at=opened_at,
            counted_at=counted_at,
            closed_at=counted_at,
            shift_code=resolved_shift_code,
            shift_date=resolved_shift_date,
            status="POSTED",
            reference=reference or "",
            notes=notes or "",
            created_by=user if getattr(user, "is_authenticated", False) else None,
            posted_by=user if getattr(user, "is_authenticated", False) else None,
            posted_at=timezone.now(),
        )
        for raw in lines or []:
            material_id = raw.get("material_id") or raw.get("material")
            counted_qty = _dec(raw.get("counted_qty_kg") if raw.get("counted_qty_kg") is not None else raw.get("qty_kg"))
            material = InventoryMaterial.objects.get(id=material_id)
            cls._assert_ink(material)
            system_qty = cls._stock_qty(material_id=material.id, location_id=location.id)
            variance = q4(counted_qty - system_qty)
            tx = None
            if variance > 0:
                tx = BulkService.add_bulk(
                    material_id=material.id,
                    qty=variance,
                    plant_id=location.plant_id,
                    location_id=location.id,
                    cost=cls._source_cost(material_id=material.id, location_id=location.id),
                    reference=f"Count Excess: {reference}",
                    tx_type="COUNT_EXCESS",
                    qty_uom="KG",
                )
            elif variance < 0:
                tx = BulkService.consume_bulk(
                    material_id=material.id,
                    qty=abs(variance),
                    location_id=location.id,
                    reference=f"Count Short: {reference}",
                    qty_uom="KG",
                )
                if tx:
                    tx.type = "COUNT_SHORT"
                    tx.save(update_fields=["type"])
            InkFloorCountLine.objects.create(
                session=session,
                material=material,
                system_qty_kg=system_qty,
                counted_qty_kg=counted_qty,
                adjustment_transaction=tx,
            )
            if variance:
                InkFloorMovement.objects.create(
                    session=session,
                    type="COUNT_ADJUST",
                    plant_id=location.plant_id,
                    material=material,
                    source_location=location if variance < 0 else None,
                    destination_location=location if variance > 0 else None,
                    qty_kg=abs(variance),
                    event_at=counted_at,
                    shift_code=session.shift_code,
                    shift_date=session.shift_date,
                    reference=reference or "",
                    notes=notes or "",
                    bulk_transaction=tx,
                    created_by=user if getattr(user, "is_authenticated", False) else None,
                )
        return session

    @classmethod
    def _latest_count_qty(cls, *, plant_id, location_id, material_id, at, before_only=False) -> Decimal:
        qs = InkFloorCountLine.objects.filter(
            session__plant_id=plant_id,
            session__location_id=location_id,
            session__status__in=["POSTED", "LOCKED"],
            session__counted_at__lte=at,
            material_id=material_id,
        ).select_related("session")
        if before_only:
            qs = qs.filter(session__counted_at__lt=at)
        line = qs.order_by("-session__counted_at", "-created_at").first()
        if not line:
            return Decimal("0")
        return q4(line.counted_qty_kg)

    @classmethod
    def _movement_sum(cls, *, plant_id, location_id, material_id, start_at, end_at, movement_types, location_field) -> Decimal:
        filters = {
            "plant_id": plant_id,
            "material_id": material_id,
            "type__in": movement_types,
            "event_at__gte": start_at,
            "event_at__lte": end_at,
            f"{location_field}_id": location_id,
        }
        return q4(InkFloorMovement.objects.filter(**filters).aggregate(total=Sum("qty_kg")).get("total") or Decimal("0"))

    @staticmethod
    def _order_ink_kg(item) -> Decimal:
        """Theory ink for the whole order line. The BOM's ink rows are per piece; the planning
        lines carry the order total, so use those, else per-piece ink x pieces in the line."""
        bom = getattr(item, "bom_snapshot", None) or {}
        if not isinstance(bom, dict):
            return Decimal("0")
        planned = Decimal("0")
        for row in bom.get("planning_lines") or []:
            if isinstance(row, dict) and str(row.get("category_code") or "").upper() == "INK":
                planned += Decimal(str(row.get("theoretical_qty") or row.get("planned_issue_qty") or 0))
        if planned > 0:
            return planned
        inks = bom.get("inks") if isinstance(bom.get("inks"), list) else []
        per_unit = sum((Decimal(str(row.get("weight_kg") or 0)) for row in inks if isinstance(row, dict)), Decimal("0"))
        unit_g = Decimal(str(getattr(item, "unit_weight_g", 0) or 0))
        total_kg = Decimal(str(getattr(item, "total_weight_kg", 0) or 0))
        pieces = (total_kg * Decimal("1000") / unit_g) if unit_g > 0 and total_kg > 0 else Decimal("1")
        return per_unit * pieces

    @classmethod
    def _theory_rows_from_jobs(cls, *, plant_id, location_id, start_at, end_at):
        try:
            from apps.production.models import JobExecutionLog
        except Exception:
            logger.warning(
                "Ink-floor theory-row source import failed plant_id=%s location_id=%s",
                plant_id,
                location_id,
                exc_info=True,
            )
            return []
        rows = []
        logs = (
            JobExecutionLog.objects.filter(logged_at__gte=start_at, logged_at__lte=end_at)
            .select_related("production_job", "production_job__current_process", "production_job__process", "production_job__sales_order_item", "production_job__sales_order_item__sales_order")
            .order_by("logged_at")
        )
        if plant_id:
            logs = logs.filter(production_job__work_center__plant_id=plant_id)
        if location_id:
            logs = logs.filter(
                Q(production_job__work_center__default_wip_location_id=location_id)
                | Q(production_job__from_location_id=location_id)
                | Q(production_job__to_location_id=location_id)
            )
        # One theory row per print job: the order's BOM ink scaled by the share of the print step
        # that was logged in this window. Each output entry is not a fresh full-order ink charge,
        # and non-print steps (lamination, pouching) of a printed order carry no ink.
        logged = {}
        for log in logs:
            job = log.production_job
            process = getattr(job, "current_process", None) or getattr(job, "process", None)
            if not (getattr(process, "print_capable", False) or getattr(process, "has_artwork", False)):
                continue
            entry = logged.setdefault(job.id, {"job": job, "same_uom": Decimal("0"), "kg": Decimal("0")})
            qty = Decimal(str(log.quantity or 0))
            log_uom = str(log.uom or "KG").upper()
            if log_uom == "KG":
                entry["kg"] += qty  # measured against the print step's own kilo target
            elif log_uom == str(job.uom or "").upper():
                entry["same_uom"] += qty
            else:
                unit_g = Decimal(str(getattr(getattr(job, "sales_order_item", None), "unit_weight_g", 0) or 0))
                if unit_g > 0:
                    entry["kg"] += qty * unit_g / Decimal("1000")
                else:
                    entry["same_uom"] += qty
        if not logged:
            return rows
        from apps.production.services.services_execution import ExecutionService

        for entry in logged.values():
            job = entry["job"]
            item = getattr(job, "sales_order_item", None)
            order_ink = cls._order_ink_kg(item)
            if order_ink <= 0:
                continue
            share = Decimal("0")
            planned = Decimal(str(job.quantity or 0))
            if entry["same_uom"] > 0:
                share += entry["same_uom"] / planned if planned > 0 else Decimal("1")
            if entry["kg"] > 0:
                try:
                    target = Decimal(str(ExecutionService.get_step_execution_profile(str(job.id), job=job).get("step_target_total_kg") or 0))
                except Exception:
                    logger.warning("Ink theory: print step target unavailable for job=%s", getattr(job, "id", None), exc_info=True)
                    target = Decimal("0")
                share += entry["kg"] / target if target > 0 else Decimal("1")
            share = min(Decimal("1"), share)
            rows.append(
                {
                    "job_number": getattr(job, "job_number", ""),
                    "job_id": str(getattr(job, "id", "") or ""),
                    "sales_order": getattr(getattr(item, "sales_order", None), "order_number", "") if item else "",
                    "sales_order_item_id": str(getattr(item, "id", "") or "") if item else "",
                    "printed_share": float(q4(share)),
                    "theory_ink_kg": q4(order_ink * share),
                }
            )
        return rows
        from apps.production.services.services_execution import ExecutionService

        for entry in logged.values():
            job = entry["job"]
            item = getattr(job, "sales_order_item", None)
            bom = getattr(item, "bom_snapshot", None) or {}
            inks = bom.get("inks") if isinstance(bom, dict) else []
            if not isinstance(inks, list):
                inks = []
            order_ink = sum((Decimal(str(row.get("weight_kg") or 0)) for row in inks if isinstance(row, dict)), Decimal("0"))
            if order_ink <= 0:
                continue
            try:
                target = Decimal(str(ExecutionService.get_step_execution_profile(str(job.id), job=job).get("step_target_total_kg") or 0))
            except Exception:
                logger.warning("Ink theory: print step target unavailable for job=%s", getattr(job, "id", None), exc_info=True)
                target = Decimal("0")
            share = min(Decimal("1"), entry["kg"] / target) if target > 0 else Decimal("1")
            rows.append(
                {
                    "job_number": getattr(job, "job_number", ""),
                    "job_id": str(getattr(job, "id", "") or ""),
                    "sales_order": getattr(getattr(item, "sales_order", None), "order_number", "") if item else "",
                    "sales_order_item_id": str(getattr(item, "id", "") or "") if item else "",
                    "printed_kg": float(q4(entry["kg"])),
                    "theory_ink_kg": q4(order_ink * share),
                }
            )
        return rows

    @classmethod
    def reconcile(
        cls,
        *,
        plant_id,
        location_id,
        start_at,
        end_at,
        theory_rows=None,
    ) -> dict[str, Any]:
        material_ids = set(
            InkFloorMovement.objects.filter(
                plant_id=plant_id,
                event_at__gte=start_at,
                event_at__lte=end_at,
            )
            .filter(models_q_for_location(location_id))
            .values_list("material_id", flat=True)
        )
        material_ids.update(
            InkFloorCountLine.objects.filter(
                session__plant_id=plant_id,
                session__location_id=location_id,
                session__counted_at__lte=end_at,
            ).values_list("material_id", flat=True)
        )

        lines = []
        total_actual = Decimal("0")
        for material_id in sorted(str(mid) for mid in material_ids if mid):
            opening = cls._latest_count_qty(
                plant_id=plant_id,
                location_id=location_id,
                material_id=material_id,
                at=start_at,
                before_only=True,
            )
            issues = cls._movement_sum(
                plant_id=plant_id,
                location_id=location_id,
                material_id=material_id,
                start_at=start_at,
                end_at=end_at,
                movement_types=["ISSUE"],
                location_field="destination_location",
            )
            returns = cls._movement_sum(
                plant_id=plant_id,
                location_id=location_id,
                material_id=material_id,
                start_at=start_at,
                end_at=end_at,
                movement_types=["RETURN", "MIX_RETURN"],
                location_field="source_location",
            )
            closing = cls._latest_count_qty(
                plant_id=plant_id,
                location_id=location_id,
                material_id=material_id,
                at=end_at,
            )
            actual = q4(opening + issues - returns - closing)
            total_actual += actual
            material = InventoryMaterial.objects.filter(id=material_id).first()
            lines.append(
                {
                    "material_id": material_id,
                    "material_code": getattr(material, "code", ""),
                    "material_name": getattr(material, "name", ""),
                    "opening_kg": float(opening),
                    "issued_kg": float(issues),
                    "returned_kg": float(returns),
                    "closing_kg": float(closing),
                    "actual_consumed_kg": float(actual),
                }
            )

        normalized_theory = []
        for row in theory_rows if theory_rows is not None else cls._theory_rows_from_jobs(
            plant_id=plant_id,
            location_id=location_id,
            start_at=start_at,
            end_at=end_at,
        ):
            theory = _dec(row.get("theory_ink_kg") if isinstance(row, dict) else 0)
            normalized_theory.append({**row, "theory_ink_kg": theory})
        total_theory = sum((row["theory_ink_kg"] for row in normalized_theory), Decimal("0"))

        allocations = []
        for row in normalized_theory:
            share = (row["theory_ink_kg"] / total_theory) if total_theory > 0 else Decimal("0")
            actual_allocated = q4(total_actual * share)
            variance = q4(actual_allocated - row["theory_ink_kg"])
            allocations.append(
                {
                    "job_number": row.get("job_number", ""),
                    "job_id": row.get("job_id", ""),
                    "sales_order": row.get("sales_order", ""),
                    "sales_order_item_id": row.get("sales_order_item_id", ""),
                    "theory_ink_kg": float(row["theory_ink_kg"]),
                    "actual_allocated_kg": float(actual_allocated),
                    "variance_kg": float(variance),
                    "variance_pct": float((variance / row["theory_ink_kg"]) * Decimal("100")) if row["theory_ink_kg"] > 0 else None,
                }
            )

        variance_total = q4(total_actual - total_theory)
        return {
            "totals": {
                "opening_kg": float(sum((Decimal(str(row["opening_kg"])) for row in lines), Decimal("0"))),
                "issued_kg": float(sum((Decimal(str(row["issued_kg"])) for row in lines), Decimal("0"))),
                "returned_kg": float(sum((Decimal(str(row["returned_kg"])) for row in lines), Decimal("0"))),
                "closing_kg": float(sum((Decimal(str(row["closing_kg"])) for row in lines), Decimal("0"))),
                "actual_consumed_kg": float(q4(total_actual)),
                "theory_ink_kg": float(q4(total_theory)),
                "variance_kg": float(variance_total),
                "variance_pct": float((variance_total / total_theory) * Decimal("100")) if total_theory > 0 else None,
            },
            "lines": lines,
            "allocations": allocations,
        }


def models_q_for_location(location_id):
    from django.db.models import Q

    return Q(source_location_id=location_id) | Q(destination_location_id=location_id)
