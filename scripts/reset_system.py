import os
import django

# Set up Django environment
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.factory.models import Plant, WorkCenter, Machine, WorkCenterProcess, Process
from apps.inventory.models import InventoryLocation, InventoryRoll, InventoryBulk, BulkTransaction, RollLink, RollMovement, RollConsumption, InventoryReservation
from apps.production.models import (
    ProductionJob, FinishedGoodsBatch, PackingUnit, DeliveryChallan, 
    DeliveryChallanItem, JobExecutionLog, ScrapLog, DowntimeLog, 
    MaterialConsumptionLog, WorkCenterAssignment, PlannedStockOrder,
    JobMaterialRequirement
)
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.routing.models import RoutingRule
from apps.artwork.models import Artwork
from apps.tooling.models import Cylinder
from apps.templates.models import TemplateBlueprint, TemplateProcessStep, TemplateProcessStepRollSpec, TemplateProcessStepMaterial, TemplateRequest

def reset_system():
    print(">>> Starting FULL System Reset (Transactional + Engineering Master Data)...")
    
    # 1. Clear Dispatch & Packing (Top of dependency chain)
    print("Clearing Dispatch & Packing Units...")
    DeliveryChallanItem.objects.all().delete()
    DeliveryChallan.objects.all().delete()
    PackingUnit.objects.all().delete()
    
    # 2. Clear Production Logs & Batches (Protect ProductionJob)
    print("Clearing Production Logs & FG Batches...")
    FinishedGoodsBatch.objects.all().delete()
    JobExecutionLog.objects.all().delete()
    ScrapLog.objects.all().delete()
    DowntimeLog.objects.all().delete()
    MaterialConsumptionLog.objects.all().delete()
    
    # 3. Clear Inventory Transactions (Protect InventoryRoll, ProductionJob)
    print("Clearing Inventory Consumption & Movements...")
    RollConsumption.objects.all().delete()
    RollMovement.objects.all().delete()
    InventoryReservation.objects.all().delete()
    BulkTransaction.objects.all().delete()
    
    # 4. Clear Rolls & Bulk Stock
    print("Clearing Inventory Rolls & Bulk Stock...")
    RollLink.objects.all().delete()
    InventoryRoll.objects.all().delete()
    InventoryBulk.objects.all().delete()
    
    # 5. Clear Planning & Requirements (Protect ProductionJob, Template)
    print("Clearing Job Requirements & Assignments...")
    JobMaterialRequirement.objects.all().delete()
    WorkCenterAssignment.objects.all().delete()
    PlannedStockOrder.objects.all().delete()
    
    # 6. Clear Jobs & Orders
    print("Clearing Production Jobs & Sales Orders...")
    ProductionJob.objects.all().delete()
    SalesOrderItem.objects.all().delete()
    SalesOrder.objects.all().delete()
    
    print("Clearing Engineering Masters (Templates, Artworks, Cylinders)...")
    TemplateProcessStepMaterial.objects.all().delete()
    TemplateProcessStepRollSpec.objects.all().delete()
    TemplateProcessStep.objects.all().delete()
    TemplateRequest.objects.all().delete()
    TemplateBlueprint.objects.all().delete()
    
    Artwork.objects.all().delete()
    Cylinder.objects.all().delete()
    
    RoutingRule.objects.all().delete()

    # 8. Clear Factory Masters
    print("Clearing Factory Master Data...")
    Machine.objects.all().delete()
    WorkCenterProcess.objects.all().delete()
    WorkCenter.objects.all().delete()
    InventoryLocation.objects.all().delete()
    Plant.objects.all().delete()
    
    print(">>> FULL System Reset Complete. All engineering masters and transaction data cleared.")

if __name__ == "__main__":
    reset_system()
