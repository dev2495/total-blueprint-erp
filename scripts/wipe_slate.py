import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.apps import apps
from django.db import connection, transaction

def wipe_slate():
    models_to_clear = [
        # Factory
        'factory.Plant',
        'factory.WorkCenter',
        'factory.WorkCenterProcess',
        'factory.Machine',
        
        # Recipes & Routing
        'recipes.ExtrusionRecipe',
        'recipes.ExtrusionRecipeComponent',
        'routing.RoutingRule',
        
        # Templates & Sales
        'templates.TemplateBlueprint',
        'templates.TemplateRequest',
        'sales.Customer',
        'sales.SalesOrder',
        'sales.SalesOrderItem',
        
        # Inventory
        'inventory.Vendor',
        'inventory.InkMaterial',
        'inventory.InventoryLocation',
        'inventory.InventoryRoll',
        'inventory.InventoryStock',
        'inventory.InventoryLedger',
        'inventory.DeliveryChallan',
        'inventory.JobWorkOrder',
        
        # Production
        'production.ProductionJob',
        'production.PlannedOrder',
        'production.PlannedStockOrder',
        'production.WorkCenterAssignment',
        'production.JobExecutionLog',
        'production.ScrapLog',
        'production.DowntimeLog',
        'production.MaterialConsumptionLog',
        'production.FinishedGoodsBatch',
        'production.PackingUnit',
        'production.DeliveryChallanItem',
        'production.DeliveryChallan',
        
        # User dynamic assignments
        'users.WorkCenterAssignment',
        'users.MachineAssignment',
        
        # Master Data / Misc
        'tooling.Cylinder',
        'artwork.Artwork',
        'mrp.MRPPlan',
        'mrp.MRPRequirement',
        'mrp.MRPSuggestion',
        'costing.MaterialCostSnapshot',
        'costing.ProcessCostRate',
        'costing.JobCost',
        'costing.OrderCost',
    ]

    print("--- 🗑️ Starting SQL TRUNCATE Wipe ---")
    
    table_names = []
    for model_path in models_to_clear:
        try:
            app_label, model_name = model_path.split('.')
            model = apps.get_model(app_label, model_name)
            table_names.append(f'"{model._meta.db_table}"')
        except Exception as e:
            print(f"⚠️ Error getting table for {model_path}: {str(e)}")

    if not table_names:
        print("No tables found to clear.")
        return

    truncate_query = f"TRUNCATE TABLE {', '.join(table_names)} CASCADE;"

    with connection.cursor() as cursor:
        try:
            with transaction.atomic():
                print(f"Executing TRUNCATE on {len(table_names)} tables...")
                cursor.execute(truncate_query)

                # Special handling for factory.Process
                from apps.factory.models import Process
                table_name = Process._meta.db_table
                print(f"Cleaning {table_name} except 'JOB_WORK'...")
                cursor.execute(f"DELETE FROM \"{table_name}\" WHERE code != 'JOB_WORK';")

            print("--- ✅ Wipe Complete. 'JOB_WORK' and Users preserved. ---")
        except Exception as e:
            print(f"❌ Critical error during wipe: {str(e)}")
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    wipe_slate()
