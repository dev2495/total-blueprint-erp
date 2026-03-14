import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.factory.models import Plant, Process, WorkCenter, Machine, WorkCenterProcess
from apps.inventory.models import InventoryLocation
from apps.routing.models import RoutingRule
from apps.templates.models import TemplateBlueprint
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.production.services import JobService
from apps.production.models import ProductionJob
from django.contrib.auth import get_user_model

User = get_user_model()

def seed_execution_data():
    print("Seeding execution data...")
    
    # 1. Ensure Plant & Locations
    plant, _ = Plant.objects.get_or_create(code='EXEC_P01', defaults={'name': 'Execution Plant'})
    # Locations are auto-created by signal for new plants.
    rm_loc = InventoryLocation.objects.get(plant=plant, code='RM')
    wip_loc = InventoryLocation.objects.get(plant=plant, code='WIP')
    fg_loc = InventoryLocation.objects.get(plant=plant, code='FG')

    # 2. Ensure Processes
    p_ext, _ = Process.objects.get_or_create(code='EXT-01', defaults={'name': 'Extrusion (Test)'})
    p_prt, _ = Process.objects.get_or_create(code='PRT-01', defaults={'name': 'Printing (Test)'})

    # 3. Ensure Work Centers & Machines
    wc1, _ = WorkCenter.objects.get_or_create(
        code='WC-EXT-01', 
        defaults={'name': 'Extrusion Line 1', 'plant': plant, 'default_wip_location': wip_loc}
    )
    WorkCenterProcess.objects.get_or_create(work_center=wc1, process=p_ext)
    
    m1, _ = Machine.objects.get_or_create(
        code='MACH-EXT-01', 
        defaults={'name': 'Extruder Alpha', 'work_center': wc1, 'status': 'ACTIVE'}
    )

    wc2, _ = WorkCenter.objects.get_or_create(
        code='WC-PRT-01', 
        defaults={'name': 'Printing Station 1', 'plant': plant, 'default_wip_location': wip_loc}
    )
    WorkCenterProcess.objects.get_or_create(work_center=wc2, process=p_prt)
    
    m2, _ = Machine.objects.get_or_create(
        code='MACH-PRT-01', 
        defaults={'name': 'Printer Beta', 'work_center': wc2, 'status': 'ACTIVE'}
    )

    # 4. Routing Rule
    rule, _ = RoutingRule.objects.get_or_create(
        name='Test Execution Rule',
        defaults={
            'ordered_processes': ['EXT-01', 'PRT-01'],
            'allowed_workcenters': ['WC-EXT-01', 'WC-PRT-01']
        }
    )

    # 5. Template & Sales Order
    template, _ = TemplateBlueprint.objects.get_or_create(
        name='Test Product Execution',
        defaults={'routing_rule': rule}
    )
    
    so, _ = SalesOrder.objects.get_or_create(
        order_number='SO-EXEC-001',
        defaults={
            'customer_name': 'Test Customer LLC', 
            'plant': plant, 
            'status': 'CONFIRMED',
            'order_type': 'TEMPLATE'
        }
    )
    
    so_item, _ = SalesOrderItem.objects.get_or_create(
        sales_order=so,
        template=template,
        defaults={'ordered_qty': 500, 'uom': 'KG'}
    )

    # 6. Generate Jobs
    # Clear existing jobs for this SO item to avoid clutter
    ProductionJob.objects.filter(sales_order_item=so_item).delete()
    jobs = JobService.create_jobs_for_so_item(so_item)
    print(f"Created {len(jobs)} production jobs for SO-EXEC-001")

    # 7. Ensure Operator
    admin = User.objects.filter(is_superuser=True).first()
    print(f"Ready for testing. Login as admin to assign job to yourself.")

if __name__ == "__main__":
    seed_execution_data()
