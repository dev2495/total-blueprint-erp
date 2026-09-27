"""Read-only application smoke check against an isolated restored database."""
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.contrib.auth import get_user_model
from apps.sales.models import SalesOrder
from apps.production.models import ProductionJob
from apps.inventory.models import InventoryRoll
from apps.procurement.models import PurchaseOrder


class Command(BaseCommand):
    help = 'Verify schema and representative ORM reads on tpp_restore_drill_* only.'

    def handle(self, *args, **options):
        if not str(connection.settings_dict['NAME']).startswith('tpp_restore_drill_'):
            raise CommandError('Restore verification requires an isolated tpp_restore_drill_* database.')
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute('SET TRANSACTION READ ONLY')
                cursor.execute("SET LOCAL statement_timeout = '30s'")
            executor = MigrationExecutor(connection)
            if executor.migration_plan(executor.loader.graph.leaf_nodes()):
                raise CommandError('Restored database schema does not match this application release.')
            # Full-row reads detect missing columns that COUNT(*) would overlook.
            for model in (get_user_model(), SalesOrder, ProductionJob, InventoryRoll, PurchaseOrder):
                list(model.objects.order_by('pk')[:1])
        self.stdout.write('TPP_RESTORE_SMOKE_PASS')
