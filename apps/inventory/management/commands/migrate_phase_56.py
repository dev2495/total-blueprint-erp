from django.core.management.base import BaseCommand
from django.db import transaction
from apps.inventory.models import InventoryStock, InventoryBulk, BulkTransaction

class Command(BaseCommand):
    help = 'Migrate legacy InventoryStock to Phase 56 InventoryBulk'

    def handle(self, *args, **options):
        self.stdout.write("Starting Phase 56 Inventory Migration...")
        
        legacy_items = InventoryStock.objects.all()
        count = 0
        
        with transaction.atomic():
            for item in legacy_items:
                # Find or create Bulk entry
                bulk, created = InventoryBulk.objects.get_or_create(
                    material=item.material,
                    location=item.location,
                    defaults={
                        'qty_kg': item.quantity,
                        'plant': item.location.plant,
                        'avg_cost': 0 # Default to 0 for legacy items
                    }
                )
                
                if not created:
                    bulk.qty_kg += item.quantity
                    bulk.save()

                # Create audit trail for migration
                BulkTransaction.objects.create(
                    material=item.material,
                    location=item.location,
                    type='INWARD',
                    qty_kg=item.quantity,
                    reference='MIGRATION_PHASE_56'
                )
                
                count += 1
                self.stdout.write(f"Migrated {item.material.name} at {item.location.name}: {item.quantity}kg")

        self.stdout.write(self.style.SUCCESS(f"Successfully migrated {count} stock entries."))
