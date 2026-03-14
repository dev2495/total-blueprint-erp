from django.db import transaction

from apps.artwork.models import Artwork

from .models import Cylinder


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
    @transaction.atomic
    def generate_for_artwork(artwork_id, force: bool = False):
        artwork = Artwork.objects.get(id=artwork_id)
        front_count = int(artwork.front_colors_count or 0)
        back_count = int(artwork.back_colors_count or 0)
        front_colors = [str(v).strip().upper() for v in (artwork.front_colors or []) if str(v).strip()]
        back_colors = [str(v).strip().upper() for v in (artwork.back_colors or []) if str(v).strip()]

        if front_count + back_count <= 0:
            raise ValueError("Artwork must have front/back colors configured before cylinder generation.")

        created = []
        existing_draft = []
        existing_finalized = []

        existing_by_slot = {}
        for row in artwork.cylinders.all():
            side = str(row.side or "FRONT").upper()
            slot = int(row.side_slot_index or 0)
            if slot <= 0:
                continue
            key = (side, slot)
            existing_by_slot.setdefault(key, []).append(row)

        def _create_side(side: str, count: int, colors):
            for slot in range(1, count + 1):
                key = (side, slot)
                current_rows = existing_by_slot.get(key, [])
                finalized = [row for row in current_rows if not row.is_draft]
                drafts = [row for row in current_rows if row.is_draft]

                if finalized:
                    existing_finalized.append(
                        {
                            "id": str(finalized[0].id),
                            "side": side,
                            "slot": slot,
                        }
                    )
                    continue
                if drafts and not force:
                    existing_draft.append(
                        {
                            "id": str(drafts[0].id),
                            "side": side,
                            "slot": slot,
                        }
                    )
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
                created.append(cyl)
                existing_by_slot.setdefault(key, []).append(cyl)

        _create_side("FRONT", front_count, front_colors)
        _create_side("BACK", back_count, back_colors)
        return {
            "created": created,
            "existing_draft": existing_draft,
            "existing_finalized": existing_finalized,
        }
