
import os
import django
import sys
from decimal import Decimal
from django.utils import timezone
from django.db import transaction

# Setup Django Environment
sys.path.insert(0, os.getcwd())
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.factory.models import Plant, Process, WorkCenter, Machine, WorkCenterProcess
from apps.inventory.models import InventoryLocation, InventoryRoll, InventoryStock, InventoryLedger
from apps.production.models import ProductionJob, FinishedGoodsBatch, PackingUnit, DeliveryChallan, DeliveryChallanItem
from apps.production.services import JobService, OperatorService
from apps.production.services.packing_service import PackingService
from apps.production.services.dispatch_service import FGDispatchService
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.templates.models import TemplateBlueprint
from apps.routing.models import RoutingRule
from apps.materials.models import InventoryMaterial
from apps.users.models import User, Role

def verify_mango_flow():
    print("🚀 STARTING END-TO-END MANGO FLOW AUDIT...")
    
    try:
        with transaction.atomic():
            # 1. Setup Master Data
            print("\n--- 1. Setup Master Data ---")
            plant, _ = Plant.objects.get_or_create(code="PL-MANGO", name="Mango Production Plant")
            
            # Setup User/Admin
            admin_user = User.objects.filter(is_superuser=True).first()
            if not admin_user:
                role_admin, _ = Role.objects.get_or_create(role_code='SUPER_ADMIN', defaults={'name': 'Super Admin'})
                admin_user, _ = User.objects.get_or_create(username='admin_test', defaults={'email': 'admin@test.com', 'role': role_admin})

            # Setup Process & WC
            proc_printing, _ = Process.objects.get_or_create(code="PRINTING", defaults={"name": "Printing"})
            proc_pouching, _ = Process.objects.get_or_create(code="BAGGING", defaults={"name": "Bagging/Pouching"})
            
            wc_printing, _ = WorkCenter.objects.get_or_create(code="WC-PRINT", name="Printing Dept", plant=plant)
            WorkCenterProcess.objects.get_or_create(work_center=wc_printing, process=proc_printing)
            
            wc_pouching, _ = WorkCenter.objects.get_or_create(code="WC-POUCH", name="Pouching Dept", plant=plant)
            WorkCenterProcess.objects.get_or_create(work_center=wc_pouching, process=proc_pouching)
            
            mach_pouch, _ = Machine.objects.get_or_create(code="M-POUCH-01", name="Pouching Machine 1", work_center=wc_pouching)
            
            # Setup Material
            material, _ = InventoryMaterial.objects.get_or_create(
                code="MAT-MANGO", 
                defaults={"name": "Mango Film", "category": "FILM_VARIANT", "base_uom": "KG"}
            )
            
            # Setup Routing & Template
            routing_rule, _ = RoutingRule.objects.update_or_create(
                name="Mango Flow Routing",
                defaults={"ordered_processes": ["PRINTING", "BAGGING"]}
            )
            
            template, _ = TemplateBlueprint.objects.update_or_create(
                name="Mango Pouch Template",
                defaults={
                    "fg_type": "POUCH",
                    "status": "LIVE",
                    "routing_rule": routing_rule,
                    "geometry_schema": {
                        "base": {"width_mm": 150, "height_mm": 200},
                        "adjustments": [],
                        "multipliers": {"faces": 2, "repeats": 1}
                    },
                    "layer_schema": [
                        {
                            "variant_id": str(material.id),
                            "thickness_micron": 12,
                            "density_g_cm3": 1.4,
                            "percentage": 100
                        }
                    ]
                }
            )
            
            # Ensure locations exist
            rm_loc, _ = InventoryLocation.objects.get_or_create(plant=plant, type='RM', defaults={'name': 'Raw Materials', 'code': 'RM-MANGO'})
            wip_loc, _ = InventoryLocation.objects.get_or_create(plant=plant, type='WIP', defaults={'name': 'WIP Area', 'code': 'WIP-MANGO'})
            fg_loc, _ = InventoryLocation.objects.get_or_create(plant=plant, type='FG', defaults={'name': 'Finished Goods', 'code': 'FG-MANGO'})
            dispatch_loc, _ = InventoryLocation.objects.get_or_create(plant=plant, type='DISPATCH', defaults={'name': 'Dispatch Area', 'code': 'DISP-MANGO'})

            # 2. Create Sales Order
            print("\n--- 2. Create Sales Order ---")
            so = SalesOrder.objects.create(
                order_number=f"SO-MANGO-{timezone.now().strftime('%M%S')}",
                customer_name="Mango Fruit Co",
                status='CONFIRMED'
            )
            so_item = SalesOrderItem.objects.create(
                sales_order=so,
                template=template,
                qty_value=Decimal("1000.00"),
                qty_uom="PCS"
            )
            print(f"✅ Success: Sales Order {so.order_number} created.")

            # 3. Create & Release Jobs
            print("\n--- 3. Create & Release Jobs ---")
            jobs = JobService.create_jobs_for_so_item(so_item)
            print(f"✅ Created {len(jobs)} jobs for the SO.")
            
            for job in jobs:
                JobService.release_job(job.id)
                job.refresh_from_db()
                assert job.job_state == 'RELEASED'
            
            job_print = jobs[0] # Printing
            job_pouch = jobs[1] # Pouching

            # 4. Operator Execution (First Step: Printing)
            print("\n--- 4. Operator Execution: Printing ---")
            JobService.start_job(job_print)
            
            OperatorService.log_output(job_print.id, 50.0, admin_user) # 50 KG of printed film
            OperatorService.complete_job(job_print.id, admin_user)
            
            job_print.refresh_from_db()
            print(f"✅ Job {job_print.job_number} (PRINTING) COMPLETED.")
            assert job_print.status == 'COMPLETED'
            
            # Verify WIP Roll creation and lineage
            wip_roll = InventoryRoll.objects.filter(production_job=job_print, is_fg=False).first()
            assert wip_roll is not None, "WIP Roll should be created after intermediate step"
            print(f"✅ Lineage Check: WIP Roll {wip_roll.label_id} has SO Item: {wip_roll.sales_order_item}")
            assert wip_roll.sales_order_item == so_item, "WIP Roll should carry SO lineage"

            # 5. Operator Execution (Final Step: Pouching)
            print("\n--- 5. Operator Execution: Pouching ---")
            JobService.start_job(job_pouch)
            
            # Log output (Pouches)
            OperatorService.log_output(job_pouch.id, 1000, admin_user) # 1000 Pouches
            OperatorService.complete_job(job_pouch.id, admin_user)
            
            job_pouch.refresh_from_db()
            print(f"✅ Job {job_pouch.job_number} (BAGGING) COMPLETED.")
            assert job_pouch.status == 'COMPLETED'
            
            # Verify FG Batch creation and lineage
            fg_batch = FinishedGoodsBatch.objects.filter(production_job=job_pouch).first()
            assert fg_batch is not None, "FG Batch should be created after final pouching step"
            print(f"✅ Lineage Check: FG Batch {fg_batch.batch_number} has SO Item: {fg_batch.sales_order_item}")
            assert fg_batch.sales_order_item == so_item, "FG Batch should carry SO lineage"
            assert fg_batch.qty_pcs == 1000

            # 6. Packing into Gonnies
            print("\n--- 6. Packing into Gonnies ---")
            gonny = PackingService.create_gonny(fg_batch.id, 500, admin_user)
            PackingService.seal_gonny(gonny.id, Decimal("10.5"), admin_user)
            
            gonny.refresh_from_db()
            print(f"✅ Packed Gonny: {gonny.label_id} | Qty: {gonny.qty_pcs} | Status: {gonny.status}")
            print(f"✅ Lineage Check: Gonny {gonny.label_id} has SO Item: {gonny.sales_order_item}")
            assert gonny.sales_order_item == so_item, "Gonny should carry SO lineage"
            
            # Create a second gonny for the remaining 500
            gonny2 = PackingService.create_gonny(fg_batch.id, 500, admin_user)
            PackingService.seal_gonny(gonny2.id, Decimal("10.5"), admin_user)

            # 7. Create Challan & Dispatch
            print("\n--- 7. Create Challan & Dispatch ---")
            challan = FGDispatchService.create_challan(
                customer_name=so.customer_name,
                plant_id=plant.id,
                sales_order_id=so.id,
                vehicle_no="MH-12-AB-1234",
                gonny_ids=[str(gonny.id), str(gonny2.id)],
                user=admin_user
            )
            print(f"✅ Challan created: {challan.dc_no}")
            
            # Dispatch
            FGDispatchService.dispatch_challan(challan.id, admin_user)
            challan.refresh_from_db()
            print(f"✅ Challan Status: {challan.status}")
            assert challan.status == 'DISPATCHED'
            
            # Verify items lineage and movement
            for item in challan.items.all():
                print(f"   - Item: {item} | SO Item: {item.sales_order_item}")
                assert item.sales_order_item == so_item, "Challan item should carry SO lineage"
                if item.packing_unit:
                    assert item.packing_unit.status == 'DISPATCHED'
                    assert item.packing_unit.location.type == 'TRANSIT'

            # 8. Mark Delivered
            print("\n--- 8. Mark Delivered ---")
            FGDispatchService.mark_received(challan.id, admin_user)
            challan.refresh_from_db()
            print(f"✅ Final Status: {challan.status}")
            assert challan.status == 'DELIVERED'
            
            print("\n✨ E2E MANGO FLOW AUDIT COMPLETED SUCCESSFULLY! ✨")
            print("Summary:")
            print(f"  Sales Order: {so.order_number}")
            print(f"  FG Batch:    {fg_batch.batch_number}")
            print(f"  Challan:     {challan.dc_no}")
            print(f"  Lineage:     VERIFIED")
            
            # Print Movement Log (Inventory Ledger)
            print("\n--- Inventory Movement Log ---")
            ledger = InventoryLedger.objects.filter(reference_id__in=[job_print.id, job_pouch.id, challan.id]).order_by('created_at')
            for entry in ledger:
                # Handle possible None for material
                mat_uom = entry.material.base_uom if entry.material else "UOM"
                print(f"{entry.created_at.strftime('%H:%M:%S')} | {entry.transaction_type} | {entry.qty_change} {mat_uom} | {entry.dest_location}")

    except Exception as e:
        print(f"\n❌ ERROR DURING AUDIT: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    verify_mango_flow()
