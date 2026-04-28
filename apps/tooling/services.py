from django.db import transaction

from apps.artwork.print_contract import get_artwork_contract
from apps.artwork.models import Artwork

from .models import Cylinder, CylinderSlotAssignment


class CylinderService:
    @staticmethod
    def _next_code(artwork: Artwork, side: str, slot: int) -> str:
        base = f"CYL-{str(artwork.id)[:6].upper()}-{side[:1]}{slot:02d}"
        code = base
        bump = 1
        while Cylinder.objects.filter(code=code).exists():
            bump += 1
            code = f"{base}-{bump}"
        return code

    @staticmethod
    def _slot_color(artwork: Artwork, side: str, slot: int) -> str:
        colors = artwork.front_colors if side == "FRONT" else artwork.back_colors
        colors = colors if isinstance(colors, list) else []
        if 0 < slot <= len(colors):
            color = str(colors[slot - 1] or "").strip().upper()
            if color:
                return color
        return f"{side}-{slot}"

    @staticmethod
    def _normalize_targets(targets, front_count: int, back_count: int):
        if not targets:
            return [("FRONT", slot) for slot in range(1, front_count + 1)] + [
                ("BACK", slot) for slot in range(1, back_count + 1)
            ]
        normalized = []
        for row in targets:
            if isinstance(row, str):
                side, _, slot_text = row.partition(":")
                row = {"side": side, "slot": slot_text}
            side = str(row.get("side") or "FRONT").upper()
            slot = int(row.get("slot") or row.get("side_slot_index") or 0)
            if side not in {"FRONT", "BACK"} or slot <= 0:
                raise ValueError("Cylinder generation target must include side FRONT/BACK and slot greater than zero.")
            max_slot = front_count if side == "FRONT" else back_count
            if slot > max_slot:
                raise ValueError(f"Requested {side}-{slot} exceeds artwork color slots.")
            key = (side, slot)
            if key not in normalized:
                normalized.append(key)
        return normalized

    @staticmethod
    def _assignment_for_slot(artwork: Artwork, side: str, slot: int):
        return (
            CylinderSlotAssignment.objects.select_related("cylinder")
            .filter(artwork=artwork, side=side, side_slot_index=slot)
            .first()
        )

    @staticmethod
    def sync_direct_assignment(cylinder: Cylinder):
        if not cylinder or not cylinder.artwork_id:
            return None
        side = str(cylinder.side or "FRONT").upper()
        if side not in {"FRONT", "BACK"}:
            side = "FRONT"
        slot = int(cylinder.side_slot_index or 0)
        if slot <= 0:
            return None
        color_name = str(cylinder.color_name or "").strip().upper()
        assignment, _ = CylinderSlotAssignment.objects.update_or_create(
            artwork=cylinder.artwork,
            side=side,
            side_slot_index=slot,
            defaults={
                "cylinder": cylinder,
                "color_name": color_name or CylinderService._slot_color(cylinder.artwork, side, slot),
            },
        )
        return assignment

    @staticmethod
    @transaction.atomic
    def assign_existing_to_slot(*, artwork_id, cylinder_id, side: str, slot: int):
        artwork = Artwork.objects.get(id=artwork_id)
        cylinder = Cylinder.objects.select_related("artwork").get(id=cylinder_id)
        side = str(side or "FRONT").upper()
        slot = int(slot or 0)
        if side not in {"FRONT", "BACK"} or slot <= 0:
            raise ValueError("Reusable cylinder assignment needs side FRONT/BACK and slot greater than zero.")
        max_slot = int(artwork.front_colors_count or 0) if side == "FRONT" else int(artwork.back_colors_count or 0)
        if slot > max_slot:
            raise ValueError(f"Requested {side}-{slot} exceeds artwork color slots.")
        if bool(cylinder.is_draft):
            raise ValueError("Only finalized cylinders can be reused for artwork slots.")
        if not bool(getattr(cylinder, "is_catalog_active", True)):
            raise ValueError("Inactive legacy cylinders cannot be reused for artwork slots.")
        if float(cylinder.circumference or 0) <= 0:
            raise ValueError("Reusable cylinder must have a circumference.")
        if not cylinder.engraving_vendor_id or not cylinder.storage_location_id:
            raise ValueError("Reusable cylinder must have vendor and storage location.")
        color_name = CylinderService._slot_color(artwork, side, slot)
        assignment, _ = CylinderSlotAssignment.objects.update_or_create(
            artwork=artwork,
            side=side,
            side_slot_index=slot,
            defaults={"cylinder": cylinder, "color_name": color_name},
        )
        return assignment

    @staticmethod
    @transaction.atomic
    def generate_for_artwork(artwork_id, force: bool = False, targets=None):
        artwork = Artwork.objects.get(id=artwork_id)
        contract = get_artwork_contract(artwork, require_asset=False)
        front_count = int(contract["front_colors_count"] or 0)
        back_count = int(contract["back_colors_count"] or 0)
        front_colors = list(contract["front_colors"])
        back_colors = list(contract["back_colors"])
        target_slots = CylinderService._normalize_targets(targets, front_count, back_count)

        created = []
        existing_draft = []
        existing_finalized = []
        existing_assigned = []

        existing_by_slot = {}
        for row in artwork.cylinders.all():
            side = str(row.side or "FRONT").upper()
            slot = int(row.side_slot_index or 0)
            if slot <= 0:
                continue
            key = (side, slot)
            existing_by_slot.setdefault(key, []).append(row)

        def _create_side(side: str, count: int, colors):
            for slot in [slot for target_side, slot in target_slots if target_side == side]:
                key = (side, slot)
                assignment = CylinderService._assignment_for_slot(artwork, side, slot)
                if assignment:
                    assigned_cylinder = assignment.cylinder
                    target_bucket = existing_draft if assigned_cylinder.is_draft else existing_finalized
                    target_bucket.append(
                        {
                            "id": str(assigned_cylinder.id),
                            "assignment_id": str(assignment.id),
                            "side": side,
                            "slot": slot,
                        }
                    )
                    existing_assigned.append(str(assignment.id))
                    continue
                current_rows = existing_by_slot.get(key, [])
                finalized = [row for row in current_rows if not row.is_draft]
                drafts = [row for row in current_rows if row.is_draft]

                if len(finalized) > 1:
                    raise ValueError(
                        f"Duplicate finalized cylinders already exist for artwork slot {side}-{slot}. "
                        "Resolve the duplicate slot before generating more cylinders."
                    )
                if len(drafts) > 1 and not force:
                    raise ValueError(
                        f"Duplicate draft cylinders already exist for artwork slot {side}-{slot}. "
                        "Resolve the duplicate slot before generating more cylinders."
                    )

                if finalized:
                    existing_finalized.append(
                        {
                            "id": str(finalized[0].id),
                            "side": side,
                            "slot": slot,
                        }
                    )
                    CylinderService.sync_direct_assignment(finalized[0])
                    continue
                if drafts and not force:
                    existing_draft.append(
                        {
                            "id": str(drafts[0].id),
                            "side": side,
                            "slot": slot,
                        }
                    )
                    CylinderService.sync_direct_assignment(drafts[0])
                    continue

                color = colors[slot - 1] if slot - 1 < len(colors) else f"{side}-{slot}"
                code = CylinderService._next_code(artwork, side, slot)
                cyl = Cylinder.objects.create(
                    code=code,
                    name=f"{artwork.design_code} {side.title()} #{slot}",
                    artwork=artwork,
                    color_name=color,
                    side=side,
                    side_slot_index=slot,
                    is_draft=True,
                    lifecycle_status="DRAFT",
                    diameter_mm=100.00,
                    width_mm=500.00,
                    circumference=314.16,
                    status="ACTIVE",
                )
                CylinderService.sync_direct_assignment(cyl)
                created.append(cyl)
                existing_by_slot.setdefault(key, []).append(cyl)

        _create_side("FRONT", front_count, front_colors)
        _create_side("BACK", back_count, back_colors)
        return {
            "created": created,
            "existing_draft": existing_draft,
            "existing_finalized": existing_finalized,
            "existing_assigned": existing_assigned,
        }
