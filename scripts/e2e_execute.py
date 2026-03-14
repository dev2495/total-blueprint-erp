import os
import django
from decimal import Decimal

# Set up Django environment
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.production.models import ProductionJob, FinishedGoodsBatch, PackingUnit, DeliveryChallan, DeliveryChallanItem
from apps.inventory.models import InventoryLocation, InventoryRoll, InventoryBulk, InventoryReservation
from apps.materials.models import InventoryMaterial
from apps.production.services.job_services import JobService, WCManagerService
from apps.production.services.services_execution import ExecutionService
from apps.users.models import User

def execute_e2e():
    print(">>> Starting E2E Execution...")
    user = User.objects.first()
    
    # --- PREREQUISITE: Inward Bulk Stock ---
    print("\n--- Prerequisite: Inwarding Bulk Stock ---")
    locs = InventoryLocation.objects.filter(code__in=['LOC-RM', 'LOC-WIP'])
    for loc in locs:
        for mat_code in ['PP-INK-2512', 'PP-ADH-2512']:
            mat = InventoryMaterial.objects.get(code=mat_code)
            bulk, created = InventoryBulk.objects.get_or_create(
                material=mat, plant=loc.plant, location=loc, 
                defaults={'qty_kg': Decimal("500.0000")}
            )
            if not created:
                bulk.qty_kg += Decimal("500.0000")
                bulk.save()
        print(f"Inwarded 500kg of stock to {loc.code}")

    # 2. Process Job 1 (Printing)
    job1 = ProductionJob.objects.filter(job_number__contains='-1').latest('created_at')
    if job1.status != 'COMPLETED':
        print(f"\nProcessing Job 1: {job1.job_number} ({job1.status})")
        roll = InventoryRoll.objects.filter(label_id__startswith='ROLL-E2E-', status__in=['AVAILABLE', 'RESERVED']).latest('created_at')
        
        # Allocate if not done
        if not InventoryReservation.objects.filter(job=job1, roll=roll, status='ACTIVE').exists():
            WCManagerService.assign_rolls(job1.assignment.id, [roll.id], user=user)
        
        if job1.job_state != 'RELEASED' and job1.status == 'QUEUED':
            JobService.release_job(job1.id)
            
        WCManagerService.mark_execution_ready(job1.assignment.id)
        JobService.start_job(job1)
        JobService.complete_job(job1, actual_qty=Decimal("100"), user=user, completion_meta={'output_width': roll.width_mm, 'output_length': Decimal("1000")})
        print("Job 1 Completed.")
    else:
        print(f"\nJob 1 {job1.job_number} already COMPLETED.")

    # 3. Process Job 2 (Pouching)
    job2 = ProductionJob.objects.filter(job_number__contains='-2').latest('created_at')
    if job2.status != 'COMPLETED':
        print(f"\nProcessing Job 2: {job2.job_number} ({job2.status})")
        
        if job2.job_state in ['PLANNED', 'WAITING']:
            JobService.release_job(job2.id)
        
        WCManagerService.prepare_job_for_wc(job2)
        from apps.factory.models import Machine
        machine_pch = Machine.objects.get(code="M-PCH-01")
        WCManagerService.assign_machine(job2.assignment.id, machine_pch.id, user=user)
        
        WCManagerService.mark_execution_ready(job2.assignment.id)
        JobService.start_job(job2)
        JobService.complete_job(job2, actual_qty=Decimal("95"), user=user, completion_meta={'output_pcs': 9500})
        print("Job 2 Completed.")
    else:
        print(f"\nJob 2 {job2.job_number} already COMPLETED.")

    # 4. Verification
    fg_batch = FinishedGoodsBatch.objects.filter(production_job=job2).latest('created_at')
    print(f"\nFinal Verification: FG Batch {fg_batch.batch_number}")
    print(f"Weight: {fg_batch.qty_kg} KG, Pieces: {fg_batch.qty_pcs} PCS")
    print(">>> E2E Execution Complete.")

if __name__ == "__main__":
    execute_e2e()
