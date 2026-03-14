from django.db.models.signals import post_save
from django.dispatch import receiver
from .models import InventoryLocation

@receiver(post_save, sender='factory.Plant')
def create_plant_locations(sender, instance, created, **kwargs):
    if created:
        # Code, Display Name, Type Mapping (Strict per Phase 13)
        location_configs = [
            # System Locations
            ('RM', 'Raw Materials Store', 'RM'),
            ('WAREHOUSE', 'Main Warehouse', 'WAREHOUSE'),
            ('WIP', 'WIP Staging', 'WIP'),
            ('FG', 'Finished Goods Store', 'FG'),
            ('SCRAP', 'Scrap Yard', 'SCRAP'),
            ('JOBWORK_OUT', 'Job Work Out (Virtual)', 'JOBWORK'),
            ('IN_TRANSIT', 'In-Transit Zone', 'TRANSIT'),
            ('TOOLING', 'Tool Room', 'TOOLING'),
        ]
        for code, name, loc_type in location_configs:
            InventoryLocation.objects.get_or_create(
                plant=instance,
                code=code,
                defaults={
                    'name': f"{instance.name} {name}",
                    'type': loc_type,
                    'is_system': True
                }
            )
