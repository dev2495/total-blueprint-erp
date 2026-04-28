from django.db import transaction
from .models import Artwork
from apps.templates.models import TemplateBlueprint
from apps.tooling.models import Cylinder  # Backward-compatible patch target for acceptance/test harnesses.
from .print_contract import get_artwork_contract, validate_roto_cylinder_readiness

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
        from django.utils import timezone
        
        artwork = Artwork.objects.get(id=artwork_id)
        print_type = str(getattr(artwork, "print_type", "FLEXO") or "FLEXO").upper()
        contract = (
            validate_roto_cylinder_readiness(artwork)
            if print_type == "ROTO"
            else get_artwork_contract(artwork, require_asset=True)
        )

        artwork.status = 'APPROVED'
        artwork.approved_by = user
        artwork.approved_at = timezone.now()
        artwork.print_type = contract["print_type"]
        artwork.substrate_mode = contract["substrate_mode"]
        artwork.color_list = contract["color_names"]
        artwork.colors_count = len(contract["color_names"])
        artwork.save()
        return artwork
