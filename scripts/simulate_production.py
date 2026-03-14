
import os
import django
import random
import uuid
from datetime import timedelta
from django.utils import timezone
from decimal import Decimal

import sys
sys.path.append(os.getcwd())

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.sales.models import SalesOrder, SalesOrderItem
from apps.templates.models import TemplateBlueprint
from apps.production.models import ProductionJob, JobExecutionLog, FinishedGoodsBatch, PackingUnit, DeliveryChallan, DeliveryChallanItem
from apps.inventory.models import InventoryRoll, InventoryLocation
from apps.factory.models import Machine, Process, Plant
from apps.users.models import User

def create_simulation():
    print("Starting Production Simulation...")

    # Cleanup existing SIM orders and related data
    print("Cleaning up old simulation data...")
    DeliveryChallan.objects.filter(dc_no__startswith="DC-SIM-").delete()
    PackingUnit.objects.filter(label_id__startswith="GNY-SIM-").delete()
    FinishedGoodsBatch.objects.filter(batch_number__startswith="FG-SIM-").delete()
    InventoryRoll.objects.filter(label_id__contains="SIM-").delete()
    ProductionJob.objects.filter(job_number__startswith="JOB-SIM-").delete()
    JobExecutionLog.objects.filter(production_job__job_number__startswith="JOB-SIM-").delete()
    SalesOrder.objects.filter(order_number__startswith="SIM-").delete()

    # 1. Setup Data
    template_id = 'af9aa7fd-86f6-41b8-b983-f21e4b8a875f' # Mango Template
    template = TemplateBlueprint.objects.get(id=template_id)
    plant = Plant.objects.first()
    admin_user = User.objects.filter(role__code='ADMIN').first() or User.objects.first()
    
    # Locations
    loc_wip = InventoryLocation.objects.filter(type='WIP').first() or InventoryLocation.objects.create(name="WIP Floor", type='WIP', plant=plant, code="WIP-01")
    loc_fg = InventoryLocation.objects.filter(type='FG').first() or InventoryLocation.objects.create(name="FG Store", type='FG', plant=plant, code="FG-01")
    loc_dispatch = InventoryLocation.objects.filter(type='DISPATCH').first() or InventoryLocation.objects.create(name="Dispatch Bay", type='DISPATCH', plant=plant, code="DSP-01")

    # Machines
    mach_printing = Machine.objects.filter(work_center__center_processes__process__code='PRINTING').first() or Machine.objects.first()
    mach_lamination = Machine.objects.filter(work_center__center_processes__process__code='LAMINATION').first() or Machine.objects.first()
    mach_slitting = Machine.objects.filter(work_center__center_processes__process__code='SLITTING').first() or Machine.objects.first()
    mach_pouching = Machine.objects.filter(work_center__center_processes__process__code='POUCHING').first() or Machine.objects.first()

    if not all([mach_printing, mach_lamination, mach_slitting, mach_pouching]):
        # Should not happen with fallback
        print("Warning: Missing some machines. Using fallback.")

    # 2. Create 5 Sales Orders
    orders_config = [
        {"suffix": "ORD-001", "stage": "CONFIRMED", "qty": 1000}, # Just ordered
        {"suffix": "PRD-002", "stage": "IN_PRODUCTION", "qty": 500}, # Job Started
        {"suffix": "WIP-003", "stage": "ROLLS_PRODUCED", "qty": 800}, # Rolls made
        {"suffix": "PKD-004", "stage": "PACKED", "qty": 2000}, # FG Batches made
        {"suffix": "DSP-005", "stage": "DISPATCHED", "qty": 1500}, # Delivered
    ]

    for conf in orders_config:
        order_num = f"SIM-{conf['suffix']}"
        print(f"Creating Order {order_num} [{conf['stage']}]...")
        
        # Create SO
        so = SalesOrder.objects.create(
            order_number=order_num,
            customer_name="Simulation Client",
            status='CONFIRMED',
            # plant=plant, # Removed
            # created_by=admin_user, # Removed
            delivery_date=timezone.now().date() + timedelta(days=7)
        )
        
        # Create SO Item
        item = SalesOrderItem.objects.create(
            sales_order=so,
            template=template,
            qty_uom='PCS',
            qty_value=conf['qty'],
            # rate=10.5, # Removed
            # amount=conf['qty'] * 10 # Removed
        )

        if conf['stage'] == "CONFIRMED":
            continue

        # Create Job
        job = ProductionJob.objects.create(
            job_number=f"JOB-{order_num}",
            sales_order_item=item,
            template=template,
            quantity=conf['qty'],
            # plant=plant, # Removed
            job_state='IN_PROGRESS',
            status='RELEASED',
            machine=mach_printing,
            routing_rule=template.routing_rule # Added likely required
        )
        
        # Log Job Start
        JobExecutionLog.objects.create(
            production_job=job,
            # activity_type='START', # Removed
            quantity=0,
            # notes="Job Started", # Removed
            logged_at=timezone.now() - timedelta(hours=4)
        )

        if conf['stage'] == "IN_PRODUCTION":
            continue

        # Produce Rolls (WIP)
        if conf['stage'] in ["ROLLS_PRODUCED", "PACKED", "DISPATCHED"]:
            # Create Printed Roll
            roll1 = InventoryRoll.objects.create(
                label_id=f"R-PRT-{order_num}-1",
                material=None, 
                weight_kg=Decimal("150.00"),
                width_mm=1000,
                location=loc_wip,
                status='CONSUMED' if conf['stage'] != "ROLLS_PRODUCED" else 'AVAILABLE',
                created_by_job=job,
                sales_order_item=item
            )
            job.job_state = 'COMPLETED'
            job.save()
            print(f"  -> Created Roll {roll1.label_id}")

        if conf['stage'] == "ROLLS_PRODUCED":
             continue

        # Create FG Batch & Packing
        if conf['stage'] in ["PACKED", "DISPATCHED"]:
            # Create Pouching Job
            job_pouch = ProductionJob.objects.create(
                job_number=f"JOB-PCH-{order_num}",
                sales_order_item=item,
                template=template,
                quantity=conf['qty'],
                # plant=plant, # Removed
                job_state='COMPLETED',
                status='COMPLETED',
                machine=mach_pouching,
                routing_rule=template.routing_rule
            )
            
            # Create FG Batch
            batch = FinishedGoodsBatch.objects.create(
                batch_number=f"FG-{order_num}",
                template=template,
                production_job=job_pouch,
                sales_order_item=item,
                qty_pcs=conf['qty'],
                qty_kg=Decimal("50.00"),
                location=loc_fg,
                status='AVAILABLE' if conf['stage'] == "PACKED" else 'DISPATCHED'
            )
            print(f"  -> Created FG Batch {batch.batch_number}")

            # Create Packing Unit (Gonny)
            gonny = PackingUnit.objects.create(
                label_id=f"GNY-{order_num}",
                fg_batch=batch,
                sales_order_item=item,
                qty_pcs=conf['qty'],
                weight_kg=Decimal("50.5"),
                location=loc_fg,
                status='SEALED' if conf['stage'] == "PACKED" else 'DISPATCHED'
            )
            print(f"  -> Created Packing Unit {gonny.label_id}")

        if conf['stage'] == "PACKED":
            continue

        # Dispatch
        if conf['stage'] == "DISPATCHED":
            challan = DeliveryChallan.objects.create(
                dc_no=f"DC-{order_num}",
                customer_name=so.customer_name,
                sales_order=so,
                plant=plant,
                status='DELIVERED',
                dispatch_date=timezone.now(),
                vehicle_no="gj03", # lowercase as per user pref
                driver_name="Raju Driver"
            )
            
            DeliveryChallanItem.objects.create(
                challan=challan,
                sales_order_item=item,
                packing_unit=gonny, # Using the variable from previous scope, safe in loop
                weight_kg=gonny.weight_kg,
                qty_pcs=gonny.qty_pcs
            )
            so.status = 'DISPATCHED'
            so.save()
            print(f"  -> Dispatched via Challan {challan.dc_no}")

    print("Simulation Complete!")

if __name__ == "__main__":
    create_simulation()

