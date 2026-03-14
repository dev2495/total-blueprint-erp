"""
Phase 58: Nightly Inventory Snapshot Command
Creates snapshots, runs reconciliation, generates alerts.

Usage:
    python manage.py inventory_snapshot
    python manage.py inventory_snapshot --plant=PLANT1
"""
from django.core.management.base import BaseCommand
from apps.inventory.services.inventory_audit_service import InventoryAuditService
from apps.factory.models import Plant
import logging

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Create inventory snapshots and run reconciliation for all plants'

    def add_arguments(self, parser):
        parser.add_argument(
            '--plant',
            type=str,
            help='Specific plant code to snapshot (default: all plants)',
        )
        parser.add_argument(
            '--skip-reconciliation',
            action='store_true',
            help='Skip reconciliation checks (snapshot only)',
        )

    def handle(self, *args, **options):
        plant_code = options.get('plant')
        skip_recon = options.get('skip_reconciliation', False)
        
        self.stdout.write(self.style.NOTICE('Starting inventory snapshot...\n'))
        
        # Determine which plants to process
        if plant_code:
            try:
                plants = [Plant.objects.get(code=plant_code)]
            except Plant.DoesNotExist:
                self.stderr.write(self.style.ERROR(f'Plant {plant_code} not found'))
                return
        else:
            plants = list(Plant.objects.filter(is_active=True))
        
        if not plants:
            self.stdout.write(self.style.WARNING('No active plants found'))
            return
        
        total_alerts = 0
        
        for plant in plants:
            self.stdout.write(f'\n--- Processing {plant.name} ({plant.code}) ---')
            
            # 1. Create Snapshot
            try:
                snapshot = InventoryAuditService.create_snapshot(plant)
                self.stdout.write(self.style.SUCCESS(
                    f'  ✓ Snapshot created: {snapshot.id}\n'
                    f'    Bulk: {snapshot.total_bulk_kg}kg ({snapshot.bulk_sku_count} SKUs)\n'
                    f'    Rolls: {snapshot.total_roll_kg}kg ({snapshot.roll_count} rolls)\n'
                    f'    FG: {snapshot.total_fg_kg}kg, WIP: {snapshot.total_wip_kg}kg'
                ))
            except Exception as e:
                self.stderr.write(self.style.ERROR(f'  ✗ Snapshot failed: {e}'))
                logger.exception(f'Snapshot failed for {plant.code}')
                continue
            
            # 2. Run Reconciliation
            if not skip_recon:
                try:
                    summary = InventoryAuditService.run_full_audit(plant)
                    total_alerts += summary['total_alerts']
                    
                    if summary['total_alerts'] > 0:
                        self.stdout.write(self.style.WARNING(
                            f'  ⚠ Alerts generated: {summary["total_alerts"]}\n'
                            f'    Critical: {summary["critical_count"]}, High: {summary["high_count"]}\n'
                            f'    Bulk mismatches: {summary["bulk_mismatches"]}\n'
                            f'    Roll issues: {summary["roll_issues"]}\n'
                            f'    Stuck WIP: {summary["stuck_wip"]}'
                        ))
                    else:
                        self.stdout.write(self.style.SUCCESS('  ✓ No issues detected'))
                except Exception as e:
                    self.stderr.write(self.style.ERROR(f'  ✗ Reconciliation failed: {e}'))
                    logger.exception(f'Reconciliation failed for {plant.code}')
        
        # Summary
        self.stdout.write(self.style.NOTICE(
            f'\n=== Summary ===\n'
            f'Plants processed: {len(plants)}\n'
            f'Total alerts generated: {total_alerts}'
        ))
        
        if total_alerts > 0:
            self.stdout.write(self.style.WARNING(
                '\nRun `python manage.py shell` and check InventoryAlert.objects.filter(resolved=False)'
            ))
