from django.core.management.base import BaseCommand
from apps.materials.models import InventoryMaterial

class Command(BaseCommand):
    help = 'Seeds POD materials into InventoryMaterial master'

    def handle(self, *args, **options):
        pod_materials = [
            {
                'code': 'POD-SINGLE-30MIC',
                'name': 'POD SINGLE (200MM) 30MIC',
                'category': 'POD',
                'base_uom': 'KG',
                'pod_type': 'SINGLE',
                'pod_fixed_height_mm': 200,
                'pod_thickness_micron': 30,
                'density_gcm3': 0.92,
                'pod_panel_count': 1,
                'pod_is_inhouse_produced': True,
                'status': 'ACTIVE'
            },
            {
                'code': 'POD-DOUBLE-30MIC',
                'name': 'POD DOUBLE (240MM) 30MIC',
                'category': 'POD',
                'base_uom': 'KG',
                'pod_type': 'DOUBLE',
                'pod_fixed_height_mm': 240,
                'pod_thickness_micron': 30,
                'density_gcm3': 0.92,
                'pod_panel_count': 2,
                'pod_is_inhouse_produced': True,
                'status': 'ACTIVE'
            },
        ]

        for pod in pod_materials:
            obj, created = InventoryMaterial.objects.update_or_create(
                code=pod['code'],
                defaults=pod
            )
            if created:
                self.stdout.write(self.style.SUCCESS(f"Created POD material: {pod['code']}"))
            else:
                self.stdout.write(self.style.WARNING(f"Updated POD material: {pod['code']}"))
