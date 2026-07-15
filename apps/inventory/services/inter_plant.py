from decimal import Decimal
from typing import Dict, List, Optional

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.inventory.models import (
    DeliveryChallan,
    InterPlantChallanItem,
    InventoryLocation,
    InventoryRoll,
)
from apps.inventory.services.bulk_service import BulkService
from apps.inventory.services.roll_service import RollService
from apps.materials.models import InventoryMaterial
from apps.materials.models import GranuleQualityCode


class InterPlantService:
    @classmethod
    def _next_dc_no(cls) -> str:
        date_part = timezone.now().strftime("%Y%m%d")
        prefix = f"IPDC-{date_part}-"
        last = (
            DeliveryChallan.objects.filter(dc_no__startswith=prefix)
            .order_by("-created_at")
            .values_list("dc_no", flat=True)
            .first()
        )
        seq = 0
        if last:
            try:
                seq = int(str(last).split("-")[-1])
            except Exception:
                seq = 0
        return f"{prefix}{seq + 1:04d}"

    @classmethod
    def _ensure_dc_no(cls, challan: DeliveryChallan) -> DeliveryChallan:
        if challan.dc_no:
            return challan

        while True:
            dc_no = cls._next_dc_no()
            exists = DeliveryChallan.objects.filter(dc_no=dc_no).exists()
            if exists:
                continue
            challan.dc_no = dc_no
            challan.save(update_fields=["dc_no", "updated_at"])
            return challan

    @classmethod
    def _get_transit_location(cls, plant_id: str) -> InventoryLocation:
        candidates = InventoryLocation.objects.filter(
            plant_id=plant_id,
            code="IN_TRANSIT",
        ).order_by("-is_system", "name", "id")

        transit = candidates.first()
        plant = candidates.first().plant if transit else None
        if candidates.count() > 1 and plant and plant.name:
            suffix = str(plant.name).strip().split(" ")[-1]
            preferred = candidates.filter(name__istartswith=f"{suffix} ").first()
            if preferred:
                transit = preferred

        if not transit:
            raise ValidationError("System location IN_TRANSIT not found for source plant.")
        return transit

    @classmethod
    @transaction.atomic
    def create_challan(
        cls,
        from_plant_id: str,
        to_plant_id: str,
        source_job_id: Optional[str] = None,
        target_job_id: Optional[str] = None,
        is_system_generated: bool = False,
        vehicle_no: str = "",
        driver_name: str = "",
        driver_phone: str = "",
        transporter_name: str = "",
        lr_number: str = "",
    ) -> DeliveryChallan:
        if str(from_plant_id) == str(to_plant_id):
            raise ValidationError("Source and Destination plants must be different.")

        challan = DeliveryChallan.objects.create(
            from_plant_id=from_plant_id,
            to_plant_id=to_plant_id,
            source_job_id=source_job_id,
            target_job_id=target_job_id,
            is_system_generated=is_system_generated,
            vehicle_no=vehicle_no or "",
            driver_name=driver_name or "",
            driver_phone=driver_phone or "",
            transporter_name=transporter_name or "",
            lr_number=lr_number or "",
            status="DRAFT",
        )
        return cls._ensure_dc_no(challan)

    @classmethod
    @transaction.atomic
    def dispatch_challan(
        cls,
        challan_id: str,
        roll_ids: Optional[List[str]] = None,
        bulk_items: Optional[List[Dict]] = None,
        target_location_id: Optional[str] = None,
    ) -> DeliveryChallan:
        """
        Dispatch selected lines from source plant to source IN_TRANSIT location.
        Persist line-level movement detail in InterPlantChallanItem.
        """
        challan = DeliveryChallan.objects.select_for_update().get(id=challan_id)
        if challan.status not in ["DRAFT", "APPROVED"]:
            raise ValidationError("Challan is not in DRAFT/APPROVED status.")

        roll_ids = [str(rid) for rid in (roll_ids or []) if rid]
        bulk_items = bulk_items or []

        if not roll_ids and not bulk_items:
            raise ValidationError("At least one roll or bulk item is required to dispatch challan.")

        cls._ensure_dc_no(challan)
        transit_loc = cls._get_transit_location(str(challan.from_plant_id))
        target_loc = None
        if target_location_id:
            target_loc = InventoryLocation.objects.get(id=target_location_id)
            if str(target_loc.plant_id) != str(challan.to_plant_id):
                raise ValidationError("target_location_id must belong to challan destination plant.")

        # 1) Roll lines
        if roll_ids:
            rolls = list(
                InventoryRoll.objects.select_related("location", "material")
                .filter(id__in=roll_ids)
            )
            found_ids = {str(r.id) for r in rolls}
            missing = [rid for rid in roll_ids if rid not in found_ids]
            if missing:
                raise ValidationError(f"Roll(s) not found: {', '.join(missing[:5])}")

            for roll in rolls:
                if not roll.location or str(roll.location.plant_id) != str(challan.from_plant_id):
                    raise ValidationError(f"Roll {roll.label_id} does not belong to source plant.")
                if roll.status != "AVAILABLE":
                    raise ValidationError(f"Roll {roll.label_id} is not AVAILABLE.")

                source_location = roll.location
                qty = Decimal(str(roll.weight_kg or 0))
                # Preserve transfer origin context for audit/traceability.
                # Remainder default policy is controlled in production execution logic.
                roll_meta = dict(roll.meta_json or {})
                roll_meta.update({
                    "interplant_source_location_id": str(source_location.id),
                    "interplant_source_location_name": source_location.name,
                    "interplant_source_plant_id": str(source_location.plant_id),
                    "interplant_source_plant_name": challan.from_plant.name,
                    "last_interplant_dc_no": challan.dc_no,
                })
                if roll.meta_json != roll_meta:
                    roll.meta_json = roll_meta
                    roll.save(update_fields=["meta_json"])

                # Move roll first, then persist exact dispatched snapshot.
                RollService.move_roll(
                    roll=roll,
                    to_location=transit_loc,
                    reason="INTER_PLANT",
                    reason_note=f"DC-OUT {challan.dc_no} to {challan.to_plant.code}",
                )

                InterPlantChallanItem.objects.create(
                    challan=challan,
                    line_type="ROLL",
                    status="DISPATCHED",
                    roll=roll,
                    material=roll.material,
                    from_location=source_location,
                    planned_qty_kg=qty,
                    dispatched_qty_kg=qty,
                    to_location=target_loc,
                )

        # 2) Bulk lines
        for item in bulk_items:
            material_id = item.get("material_id")
            qty = item.get("quantity")
            source_location_id = item.get("location_id")
            granule_code_id = item.get("granule_code_id") or item.get("granule_code")

            if not material_id:
                raise ValidationError("bulk_items.material_id is required.")
            if source_location_id is None:
                raise ValidationError("bulk_items.location_id is required.")
            if qty is None:
                raise ValidationError("bulk_items.quantity is required.")

            qty_d = Decimal(str(qty))
            if qty_d <= 0:
                raise ValidationError("bulk_items.quantity must be > 0.")

            source_loc = InventoryLocation.objects.get(id=source_location_id)
            if str(source_loc.plant_id) != str(challan.from_plant_id):
                raise ValidationError("Source location mismatch with challan from_plant.")

            material = InventoryMaterial.objects.get(id=material_id)
            granule_code = None
            if granule_code_id:
                granule_code = GranuleQualityCode.objects.filter(
                    id=granule_code_id,
                    granule=material,
                    status="ACTIVE",
                ).first()
                if not granule_code:
                    raise ValidationError("Selected granule code is inactive or does not belong to the material family.")
            elif str(material.category or "").upper() == "GRANULE" and material.quality_codes.filter(status="ACTIVE").exists():
                raise ValidationError("bulk_items.granule_code_id is required for coded granule stock.")

            BulkService.transfer_bulk(
                material_id=str(material.id),
                qty=float(qty_d),
                from_location_id=str(source_loc.id),
                to_location_id=str(transit_loc.id),
                reference=f"DC-OUT-BULK {challan.dc_no} to {challan.to_plant.code}",
                granule_code_id=str(granule_code.id) if granule_code else None,
                qty_uom=material.base_uom,
            )

            InterPlantChallanItem.objects.create(
                challan=challan,
                line_type="BULK",
                status="DISPATCHED",
                material=material,
                granule_code=granule_code,
                from_location=source_loc,
                to_location=target_loc,
                planned_qty_kg=qty_d,
                dispatched_qty_kg=qty_d,
            )

        challan.status = "IN_TRANSIT"
        challan.dispatched_at = timezone.now()
        challan.save(update_fields=["status", "dispatched_at", "updated_at"])
        return challan

    @classmethod
    def _receive_roll_line(cls, challan: DeliveryChallan, line: InterPlantChallanItem, target_loc: InventoryLocation) -> bool:
        if not line.roll_id:
            return False

        transit_loc = cls._get_transit_location(str(challan.from_plant_id))
        roll = InventoryRoll.objects.select_related("location").get(id=line.roll_id)
        if roll.location_id != transit_loc.id:
            raise ValidationError(f"Roll {roll.label_id} is not in source transit location.")

        remaining = Decimal(str(line.dispatched_qty_kg or 0)) - Decimal(str(line.received_qty_kg or 0))
        if remaining <= 0:
            line.status = "RECEIVED"
            line.save(update_fields=["status", "updated_at"])
            return False

        line_target = line.to_location if line.to_location_id and line.to_location.plant_id == challan.to_plant_id else target_loc
        RollService.move_roll(
            roll=roll,
            to_location=line_target,
            reason="INTER_PLANT",
            reason_note=f"DC-IN {challan.dc_no} from {challan.from_plant.code}",
        )

        line.received_qty_kg = Decimal(str(line.received_qty_kg or 0)) + remaining
        line.status = "RECEIVED"
        line.to_location = line_target
        line.save(update_fields=["received_qty_kg", "status", "to_location", "updated_at"])
        return True

    @classmethod
    def _receive_bulk_line(cls, challan: DeliveryChallan, line: InterPlantChallanItem, target_loc: InventoryLocation) -> bool:
        if not line.material_id:
            return False

        transit_loc = cls._get_transit_location(str(challan.from_plant_id))
        remaining = Decimal(str(line.dispatched_qty_kg or 0)) - Decimal(str(line.received_qty_kg or 0))
        if remaining <= 0:
            line.status = "RECEIVED"
            line.save(update_fields=["status", "updated_at"])
            return False

        line_target = line.to_location if line.to_location_id and line.to_location.plant_id == challan.to_plant_id else target_loc

        BulkService.transfer_bulk(
            material_id=str(line.material_id),
            qty=float(remaining),
            from_location_id=str(transit_loc.id),
            to_location_id=str(line_target.id),
            reference=f"DC-IN-BULK {challan.dc_no} from {challan.from_plant.code}",
            granule_code_id=str(line.granule_code_id) if line.granule_code_id else None,
            qty_uom=line.material.base_uom if line.material_id else None,
        )

        line.received_qty_kg = Decimal(str(line.received_qty_kg or 0)) + remaining
        line.status = "RECEIVED"
        line.to_location = line_target
        line.save(update_fields=["received_qty_kg", "status", "to_location", "updated_at"])
        return True

    @classmethod
    @transaction.atomic
    def receive_challan(
        cls,
        challan_id: str,
        target_location_id: str,
        roll_ids: Optional[List[str]] = None,
        bulk_items: Optional[List[Dict]] = None,
    ) -> DeliveryChallan:
        """
        Receive selected/all lines at destination plant.
        Uses challan item rows as source-of-truth whenever items exist.
        """
        challan = DeliveryChallan.objects.select_for_update().get(id=challan_id)
        if challan.status != "IN_TRANSIT":
            raise ValidationError("Challan is not IN_TRANSIT.")

        target_loc = InventoryLocation.objects.get(id=target_location_id)
        if str(target_loc.plant_id) != str(challan.to_plant_id):
            raise ValidationError("Target location must belong to destination plant.")

        roll_ids = {str(rid) for rid in (roll_ids or []) if rid}
        bulk_items = bulk_items or []
        requested_bulk_keys = {
            (str(item.get("material_id")), Decimal(str(item.get("quantity") or 0)))
            for item in bulk_items
            if item.get("material_id") and item.get("quantity") is not None
        }

        items_qs = challan.items.select_related("roll", "material", "to_location").all()
        has_line_items = items_qs.exists()

        received_any = False

        if has_line_items:
            candidate_items = list(items_qs)
            if roll_ids or requested_bulk_keys:
                filtered = []
                for line in candidate_items:
                    if line.line_type == "ROLL" and line.roll_id and str(line.roll_id) in roll_ids:
                        filtered.append(line)
                        continue
                    if line.line_type == "BULK" and line.material_id:
                        dispatched = Decimal(str(line.dispatched_qty_kg or 0))
                        key = (str(line.material_id), dispatched)
                        if key in requested_bulk_keys:
                            filtered.append(line)
                candidate_items = filtered

            for line in candidate_items:
                if line.line_type == "ROLL":
                    received_any = cls._receive_roll_line(challan, line, target_loc) or received_any
                elif line.line_type == "BULK":
                    received_any = cls._receive_bulk_line(challan, line, target_loc) or received_any

        else:
            # Legacy fallback for challans created before line tracking.
            transit_loc = cls._get_transit_location(str(challan.from_plant_id))
            if roll_ids:
                rolls = InventoryRoll.objects.filter(id__in=list(roll_ids))
                for roll in rolls:
                    if roll.location_id != transit_loc.id:
                        raise ValidationError(f"Roll {roll.label_id} is not in the source plant's transit zone.")
                    RollService.move_roll(
                        roll=roll,
                        to_location=target_loc,
                        reason="INTER_PLANT",
                        reason_note=f"DC-IN {challan.dc_no} from {challan.from_plant.code}",
                    )
                    received_any = True

            for item in bulk_items:
                material_id = item.get("material_id")
                qty = item.get("quantity")
                if not material_id or qty is None:
                    raise ValidationError("bulk_items requires material_id and quantity.")
                qty_d = Decimal(str(qty))
                if qty_d <= 0:
                    raise ValidationError("bulk_items.quantity must be > 0.")

                BulkService.transfer_bulk(
                    material_id=str(material_id),
                    qty=float(qty_d),
                    from_location_id=str(transit_loc.id),
                    to_location_id=str(target_loc.id),
                    reference=f"DC-IN-BULK {challan.dc_no} from {challan.from_plant.code}",
                    qty_uom=InventoryMaterial.objects.get(id=material_id).base_uom,
                )
                received_any = True

        if not received_any:
            raise ValidationError("Select at least one pending challan line to receive.")

        pending_count = challan.items.exclude(status="RECEIVED").count() if has_line_items else 0
        if not has_line_items or pending_count == 0:
            challan.status = "RECEIVED"
            challan.received_at = timezone.now()
            challan.save(update_fields=["status", "received_at", "updated_at"])

            # Route-output roll transfers may unlock their downstream job. Bulk
            # raw-material transfers only replenish the WCM issue store and must
            # never bypass machine assignment, code allocation, or WCM release.
            has_bulk_lines = challan.items.filter(line_type="BULK").exists() if has_line_items else bool(bulk_items)
            if (
                not has_bulk_lines
                and challan.target_job_id
                and challan.target_job
                and challan.target_job.job_state in ["WAITING", "PLANNED"]
            ):
                try:
                    from apps.production.services.job_services import JobService

                    JobService.release_job(str(challan.target_job_id))
                except Exception:
                    challan.target_job.job_state = "RELEASED"
                    challan.target_job.save(update_fields=["job_state", "updated_at"])

        return challan
