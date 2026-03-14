from django.db import transaction
from .models import Artwork
from apps.templates.models import TemplateBlueprint
from apps.tooling.models import Cylinder

class ArtworkService:
    @staticmethod
    @transaction.atomic
    def create_from_template(template_id):
        template = TemplateBlueprint.objects.get(id=template_id)

        # V2: template is policy-only; color identity belongs to artwork/sales snapshots.
        color_names = []
        colors_count = 0
        
        # Create Design Code from template ID or name
        design_code = f"ART-{str(template.id)[:8].upper()}"
        
        artwork, created = Artwork.objects.get_or_create(
            design_code=design_code,
            defaults={
                'name': f"Artwork for {template.name}",
                'colors_count': colors_count,
                'color_list': color_names,
                'status': 'DRAFT'
            }
        )
        
        if not created:
            artwork.colors_count = colors_count
            artwork.color_list = color_names
            artwork.save()

        return artwork

    @staticmethod
    def approve_artwork(artwork_id, user):
        from django.core.exceptions import ValidationError
        from django.utils import timezone
        
        artwork = Artwork.objects.get(id=artwork_id)
        
        # 1. Image Check
        if not artwork.file_path and not artwork.image:
             raise ValidationError("Cannot approve artwork without an uploaded file/image asset.")
             
        front_count = int(artwork.front_colors_count or 0)
        back_count = int(artwork.back_colors_count or 0)
        front_colors = [str(v).strip().upper() for v in (artwork.front_colors or []) if str(v).strip()]
        back_colors = [str(v).strip().upper() for v in (artwork.back_colors or []) if str(v).strip()]

        if front_count + back_count <= 0:
            raise ValidationError("Artwork must define front/back color counts before approval.")
        if front_count and len(front_colors) != front_count:
            raise ValidationError("Front color list must exactly match front color count.")
        if back_count and len(back_colors) != back_count:
            raise ValidationError("Back color list must exactly match back color count.")

        all_colors = front_colors + back_colors

        print_type = str(getattr(artwork, "print_type", "FLEXO") or "FLEXO").upper()
        if print_type == "ROTO":
            required_front_slots = set(range(1, front_count + 1))
            required_back_slots = set(range(1, back_count + 1))

            front_rows = list(
                Cylinder.objects.filter(
                    artwork_id=artwork.id,
                    side="FRONT",
                    side_slot_index__in=required_front_slots or {1},
                    is_draft=False,
                )
            )
            back_rows = list(
                Cylinder.objects.filter(
                    artwork_id=artwork.id,
                    side="BACK",
                    side_slot_index__in=required_back_slots or {1},
                    is_draft=False,
                )
            )

            front_slots_ready = {int(c.side_slot_index or 0) for c in front_rows if int(c.side_slot_index or 0) > 0}
            back_slots_ready = {int(c.side_slot_index or 0) for c in back_rows if int(c.side_slot_index or 0) > 0}
            missing_front = sorted(required_front_slots - front_slots_ready)
            missing_back = sorted(required_back_slots - back_slots_ready)
            if missing_front:
                raise ValidationError(f"ROTO approval blocked: finalized front cylinders missing for slots {missing_front}.")
            if missing_back:
                raise ValidationError(f"ROTO approval blocked: finalized back cylinders missing for slots {missing_back}.")

            def _row_incomplete(row):
                return (
                    not str(row.code or "").strip()
                    or not str(row.name or "").strip()
                    or not str(row.color_name or "").strip()
                    or row.diameter_mm is None
                    or row.width_mm is None
                    or row.circumference is None
                    or float(row.diameter_mm or 0) <= 0
                    or float(row.width_mm or 0) <= 0
                    or float(row.circumference or 0) <= 0
                    or int(row.cell_depth_microns or 0) <= 0
                    or str(row.lifecycle_status or "DRAFT").upper() == "DRAFT"
                )

            incomplete_slots = []
            for cyl in front_rows + back_rows:
                if _row_incomplete(cyl):
                    side = str(cyl.side or "FRONT").upper()
                    slot = int(cyl.side_slot_index or 0)
                    incomplete_slots.append(f"{side}-{slot}")
            if incomplete_slots:
                raise ValidationError(
                    "ROTO approval blocked: finalize cylinder technical details for slots "
                    f"{sorted(incomplete_slots)}."
                )

        artwork.status = 'APPROVED'
        artwork.approved_by = user
        artwork.approved_at = timezone.now()
        artwork.print_type = print_type
        artwork.color_list = all_colors
        artwork.colors_count = len(all_colors)
        artwork.save()
        return artwork
