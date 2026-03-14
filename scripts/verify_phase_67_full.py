
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

from apps.factory.models import Plant, Process, WorkCenter, Machine, WorkCenterProcess, ProcessMaterialRule
from apps.inventory.models import InventoryLocation, InventoryRoll, InventoryReservation, InventoryBulk
from apps.production.models import ProductionJob, FinishedGoodsBatch
from apps.production.services.job_services import JobService
from apps.production.services.services_execution import ExecutionService
from apps.production.services.operator_service import OperatorService
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.templates.models import TemplateBlueprint
from apps.routing.models import RoutingRule
from apps.materials.models import InventoryMaterial, ConsumableMaterial
from apps.users.models import User, Role

def verify_phase_67():
    print("🚀 STARTING PHASE 67 VERIFICATION (Execution & Bulk Logic)...")
    
    try:
        with transaction.atomic():
            # 1. Setup Master Data
            print("\n--- 1. Setup Master Data ---")
            plant, _ = Plant.objects.get_or_create(code="PL-PH67", name="Phase 67 Plant")
            
            # Locations
            rm_loc, _ = InventoryLocation.objects.get_or_create(plant=plant, type='RM', defaults={'name': 'RM Store'})
            wip_loc, _ = InventoryLocation.objects.get_or_create(plant=plant, type='WIP', defaults={'name': 'Production Floor'})
            fg_loc, _ = InventoryLocation.objects.get_or_create(plant=plant, type='FG', defaults={'name': 'FG Store'})

            # Admin User
            admin_user = User.objects.filter(is_superuser=True).first()
            if not admin_user:
                admin_user = User.objects.create(username='admin_ph67', is_superuser=True)

            # Processes
            proc_ext, _ = Process.objects.get_or_create(code="EXTRUSION", defaults={"name": "Extrusion", "input_form": "BULK", "output_form": "ROLL"})
            proc_print, _ = Process.objects.get_or_create(code="PRINTING", defaults={"name": "Printing", "input_form": "ROLL", "output_form": "ROLL"})
            proc_pouch, _ = Process.objects.get_or_create(code="POUCHING", defaults={"name": "Pouching", "input_form": "ROLL", "output_form": "BULK"})

            # Work Centers
            wc_ext, _ = WorkCenter.objects.get_or_create(code="WC-EXT", name="Extrusion Line", plant=plant, defaults={'default_wip_location': wip_loc})
            WorkCenterProcess.objects.get_or_create(work_center=wc_ext, process=proc_ext)
            
            wc_print, _ = WorkCenter.objects.get_or_create(code="WC-PRINT", name="Printing Press", plant=plant, defaults={'default_wip_location': wip_loc})
            WorkCenterProcess.objects.get_or_create(work_center=wc_print, process=proc_print)

            wc_pouch, _ = WorkCenter.objects.get_or_create(code="WC-POUCH", name="Pouching Machine", plant=plant, defaults={'default_wip_location': wip_loc})
            WorkCenterProcess.objects.get_or_create(work_center=wc_pouch, process=proc_pouch)

            # Materials
            # 1. Consumables (Ink)
            ink_mat, _ = InventoryMaterial.objects.get_or_create(code="INK-CYAN", defaults={"name": "Cyan Ink", "category": "INK", "base_uom": "KG"})
            ConsumableMaterial.objects.get_or_create(master_material=ink_mat, category='INK') # Link
            
            # Stock up Ink
            InventoryBulk.objects.update_or_create(
                material=ink_mat, location=wip_loc, # Stock at WIP for auto-consumption
                defaults={'qty_kg': 100.0, 'plant': plant}
            )
            print("✅ Ink Stock Initialized: 100kg")

            # 2. Product Materials
            granule, _ = InventoryMaterial.objects.get_or_create(code="GRANULE-A", defaults={"name": "Granule A", "category": "GRANULE", "base_uom": "KG"})
            film_variant, _ = InventoryMaterial.objects.get_or_create(code="FILM-PH67", defaults={"name": "Test Film", "category": "FILM_VARIANT", "base_uom": "KG"})
            
            # Rules (Phase 67.2)
            # Printing consumes INK based on PHYSICS or RECIPE. Let's use FIXED_QTY for simplicity first, or RECIPE.
            # Let's test RECIPE mode: 5% Ink by weight of output?
            ProcessMaterialRule.objects.create(
                process=proc_print,
                material_category='INK',
                calculation_mode='RECIPE', # Simple %-based consumption
                default_value=5.0
            )
            print("✅ Process Rule Created: PRINTING consumes 5% INK")

            # 2. Create Order & Jobs
            print("\n--- 2. Create Order & Jobs ---")
            routing_rule, _ = RoutingRule.objects.update_or_create(
                name="Phase 67 Flow",
                defaults={"ordered_processes": ["EXTRUSION", "PRINTING", "POUCHING"]}
            )
            
            template, _ = TemplateBlueprint.objects.update_or_create(
                name="Phase 67 Template",
                defaults={
                    "fg_type": "POUCH",
                    "routing_rule": routing_rule,
                    "status": "LIVE",
                    "layer_schema": [{"variant_id": str(film_variant.id), "percentage": 100}]
                }
            )

            so = SalesOrder.objects.create(order_number="SO-PH67-001", customer_name="Test Customer")
            so_item = SalesOrderItem.objects.create(
                sales_order=so, template=template, qty_value=1000, qty_uom="PCS",
                # variant=film_variant # REMOVED: Not a valid field
                layer_snapshot=[{"variant_id": str(film_variant.id), "percentage": 100}] # Mock Snapshot
            )
            
            jobs = JobService.create_jobs_for_so_item(so_item)
            job_ext = jobs[0]
            job_print = jobs[1]
            job_pouch = jobs[2]
            
            for j in jobs:
                 JobService.release_job(j.id)
            
            print(f"✅ Jobs Created: {len(jobs)}")

            # 3. EXTRUSION (Bulk -> Roll)
            print("\n--- 3. Extrusion Execution ---")
            JobService.start_job(job_ext)
            
            # Complete Extrusion: Produce 50kg Roll
            print("Completing Extrusion: 50kg...")
            # Use new ExecutionService logic via JobService
            JobService.complete_job(job_ext, 50.0)
            
            job_ext.refresh_from_db()
            print(f"Extrusion Status: {job_ext.status}")
            
            # Verify Output Roll
            roll_1 = InventoryRoll.objects.filter(production_job=job_ext).first()
            assert roll_1 is not None, "Extrusion should create a roll"
            assert roll_1.weight_kg == 50.0
            assert roll_1.status == 'AVAILABLE'
            print(f"✅ Extrusion Roll Created: {roll_1.label_id} (50kg)")

            # 4. PRINTING (Roll -> Roll + Ink Consumption)
            print("\n--- 4. Printing Execution ---")
            # Assign Roll 1 to Printing
            print("Assigning Extrusion Roll to Printing...")
            ExecutionService.assign_roll_to_job(job_print.id, roll_1.id, admin_user)
            roll_1.refresh_from_db()
            assert roll_1.status == 'RESERVED', "Roll should be reserved"
            
            JobService.start_job(job_print)
            
            # Complete Printing: Produce 52kg (50kg film + ink?)
            # Prompt Logic: "modify first eligible roll ... IF roll assigned: create new roll"
            # Here we assigned a roll, so it should CREATE NEW ROLL and Consume Old.
            print("Completing Printing: 52kg...")
            JobService.complete_job(job_print, 52.0)
            
            job_print.refresh_from_db()
            
            # Verify Input Roll Consumed
            roll_1.refresh_from_db()
            print(f"Input Roll 1 Status: {roll_1.status}")
            assert roll_1.status == 'CONSUMED', "Input roll should be consumed"
            
            # Verify Output Roll Created
            roll_2 = InventoryRoll.objects.filter(production_job=job_print).first()
            assert roll_2 is not None
            assert roll_2.id != roll_1.id
            assert roll_2.weight_kg == 52.0
            print(f"✅ Printing Output Roll: {roll_2.label_id} (52kg)")
            
            # Verify Ink Consumption (Bulk)
            ink_stock = InventoryBulk.objects.get(material=ink_mat, location=wip_loc)
            print(f"Ink Stock Remaining: {ink_stock.qty_kg}")
            # Expected Consumption: 5% of 52kg = 2.6kg
            # Initial 100. Obs: 100 - 2.6 = 97.4
            assert ink_stock.qty_kg < 100.0, "Ink should be consumed"
            consumed_qty = 100.0 - float(ink_stock.qty_kg)
            print(f"✅ Ink Consumed: {consumed_qty}kg")

            # 5. POUCHING (Roll -> Bulk/FG)
            print("\n--- 5. Pouching Execution ---")
            # Auto-Forwarding Check: Pouching should see Roll 2 in WIP Pool even if not assigned?
            # Let's check pool
            pool = ExecutionService.get_wip_pool(job_pouch.id)
            print(f"Pouching WIP Pool: {[r.label_id for r in pool]}")
            assert roll_2 in pool, "Printing roll should be auto-forwarded to Pouching"
            
            # Assign it explicitly or rely on auto?
            # Prompt says "Assign Rolls to populate".
            # But let's try Manual Assignment to be safe for this test.
            ExecutionService.assign_roll_to_job(job_pouch.id, roll_2.id, admin_user)
            
            JobService.start_job(job_pouch)
            
            # Complete Pouching: 1000 Pouches
            print("Completing Pouching: 1000 Pcs...")
            JobService.complete_job(job_pouch, 1000)
            
            # Verify Input Consumed
            roll_2.refresh_from_db()
            assert roll_2.status == 'CONSUMED'
            print(f"✅ Input Roll 2 Consumed")
            
            # Verify FG Batch
            fg = FinishedGoodsBatch.objects.filter(production_job=job_pouch).first()
            assert fg is not None
            assert fg.qty_pcs == 1000
            print(f"✅ FG Batch Created: {fg.batch_number} (1000 pcs)")
            
            print("\n✨ PHASE 67 VERIFICATION SUCCESSFUL! ✨")

    except Exception as e:
        print(f"\n❌ VERIFICATION FAILED: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    verify_phase_67()
