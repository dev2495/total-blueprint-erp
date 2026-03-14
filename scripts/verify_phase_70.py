
import os
import sys
import django
from decimal import Decimal

# Setup Django
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.db import transaction
from apps.templates.models import TemplateBlueprint, TemplateProcessStep, TemplateMaterial
from apps.factory.models import Process, WorkCenter, Machine, Plant
from apps.production.models import ProductionJob, JobMaterialRequirement
from apps.inventory.models import InventoryRoll, InventoryMaterial, InventoryLocation
from apps.production.services.services_execution import ExecutionService
from apps.users.models import User

from apps.routing.models import RoutingRule

def print_header(title):
    print(f"\n{'='*70}")
    print(f" {title}")
    print(f"{'='*70}")

def verify_phase_70():
    print_header("PHASE 70 VERIFICATION START")

    # 1. Setup Data
    user = User.objects.first()
    
    # Ensure processes exist
    p_ext = Process.objects.filter(code='EXTRUSION').first()
    if not p_ext:
        p_ext = Process.objects.create(code='EXTRUSION', name='Extrusion', input_form='BULK', output_form='ROLL', rolls_required=0)
        
    p_print = Process.objects.filter(code='ROTO_PRINT').first()
    if not p_print:
        p_print = Process.objects.create(code='ROTO_PRINT', name='Rotogravure', input_form='ROLL', output_form='ROLL', rolls_required=1, modifies_existing_roll=True)

    # Create Routing Rule
    routing_rule, _ = RoutingRule.objects.get_or_create(
        name="Phase 70 Verification Route",
        defaults={
            'ordered_processes': ['EXTRUSION', 'ROTO_PRINT']
        }
    )

    # Create Plant & Location
    plant, _ = Plant.objects.get_or_create(code="PLANT-01", name="Main Plant")
    loc, _ = InventoryLocation.objects.get_or_create(code="WIP-LOC-01", defaults={'name': 'WIP Floor', 'plant': plant, 'type': 'SHOP_FLOOR'})
    
    # Create Work Center
    wc, _ = WorkCenter.objects.get_or_create(
        code="WC-EXT-01", 
        defaults={
            'name': 'Extrusion Line 1', 
            'plant': plant, 
            'default_wip_location': loc
        }
    )

    # Ensure Materials
    granules = InventoryMaterial.objects.filter(code='RM-GRANULE-001').first()
    if not granules:
         granules = InventoryMaterial.objects.create(code='RM-GRANULE-001', name='PE Granules', category='GRANULE')
         
    ink = InventoryMaterial.objects.filter(code='RM-INK-CYAN').first()
    if not ink:
         ink = InventoryMaterial.objects.create(code='RM-INK-CYAN', name='Cyan Ink', category='INK')

    # Seed Bulk Stock
    from apps.inventory.models import InventoryBulk
    InventoryBulk.objects.update_or_create(
        material=granules,
        location=loc,
        plant=plant,
        defaults={'qty_kg': 5000}
    )
    InventoryBulk.objects.update_or_create(
        material=ink,
        location=loc,
        plant=plant,
        defaults={'qty_kg': 500}
    )

    # 2. Create Step-Aware Template
    print("\n[1] Creating Step-Aware Template...")
    template = TemplateBlueprint.objects.create(name="Phase 70 Verification Template", status='DRAFT', fg_type='POUCH')
    
    # Step 1: Extrusion
    step1 = TemplateProcessStep.objects.create(template=template, sequence_number=1, process=p_ext)
    TemplateMaterial.objects.create(template=template, process_step=step1, material=granules, quantity=Decimal('1.0'), calculation_mode='PER_KG')
    
    # Step 2: Printing
    step2 = TemplateProcessStep.objects.create(template=template, sequence_number=2, process=p_print)
    TemplateMaterial.objects.create(template=template, process_step=step2, material=ink, quantity=Decimal('0.05'), calculation_mode='PER_KG')
    
    print("    Template Created with 2 Steps")
    
    # 3. Create Job
    print("\n[2] Creating Production Job...")
    
    # Cleanup existing
    existing_job = ProductionJob.objects.filter(job_number="JOB-P70-TEST-001").first()
    if existing_job:
        print("    Deleting existing job...")
        from apps.inventory.models import InventoryReservation
        InventoryReservation.objects.filter(job=existing_job).delete()
        JobMaterialRequirement.objects.filter(production_job=existing_job).delete()
        InventoryRoll.objects.filter(production_job=existing_job).delete()
        existing_job.delete()
        
    job = ProductionJob.objects.create(
        job_number="JOB-P70-TEST-001",
        template=template,
        quantity=1000,
        uom='KG',
        status='QUEUED',
        current_step_index=0,
        current_process=p_ext,
        routing_rule=routing_rule,
        work_center=wc
    )
    
    # 4. Calculate Requirements
    print("\n[3] Calculating Requirements (Step-Aware)...")
    reqs = ExecutionService.calculate_requirements(job.id)
    print(f"    Created {len(reqs)} requirements")
    
    for r in reqs:
        step_seq = r.process_step.sequence_number if r.process_step else 'None'
        print(f"    - {r.material.code}: {r.required_qty} kg (Step {step_seq})")
        
    # Verify Step 1 Req
    req1 = JobMaterialRequirement.objects.get(production_job=job, process_step=step1)
    if req1.required_qty == 1000:
        print("    ✓ Step 1 Requirement Correct (1000kg)")
    else:
        print(f"    ✗ Step 1 Requirement Incorrect: {req1.required_qty}")

    # 5. Execute Step 1 (Extrusion)
    print("\n[4] Executing Step 1 (Extrusion)...")
    
    # Mock auto-satisfy (Start)
    status = ExecutionService.get_satisfaction_status(job.id)
    if status['is_satisfied']:
        print("    ✓ Job Ready to Start (Bulk Input)")
    else:
        print("    ✗ Job NOT Ready")
        
    # Complete
    print("    Completing Step 1 with 1000kg output...")
    ctx = ExecutionService.execute_completion(job.id, 1000, user)
    
    # Verify Output Roll
    rolls = InventoryRoll.objects.filter(production_job=job, stage_index=0)
    print(f"    Created {rolls.count()} Output Rolls")
    if rolls.count() == 1:
        roll = rolls.first()
        print(f"    Roll: {roll.label_id}, Stat: {roll.status}, Wt: {roll.weight_kg}")
    
    # Verify Consumption
    req1.refresh_from_db()
    print(f"    Step 1 Consumption: {req1.consumed_qty}")
    if req1.consumed_qty == 1000:
        print("    ✓ Step 1 Material Auto-Consumed")
    else:
        print("    ✗ Step 1 Material NOT Consumed")
        
    # 6. Advance to Step 2
    print("\n[5] Advancing to Step 2 (Printing)...")
    job.current_step_index = 1
    job.current_process = p_print
    job.save()
    
    # 7. Check WIP Pool (Auto-Forward)
    print("\n[6] Checking WIP Pool (Auto-Forward)...")
    pool = ExecutionService.get_wip_pool(job.id)
    print(f"    WIP Pool Size: {len(pool)}")
    
    if len(pool) > 0 and pool[0].id == roll.id:
        print("    ✓ Output Roll from Step 1 Auto-Forwarded to Step 2")
    else:
        print("    ✗ Auto-Forward Failed")

    status = ExecutionService.get_satisfaction_status(job.id)
    print(f"    Satisfaction Status: Is Satisfied? {status['is_satisfied']}")
    print(f"    Rolls Available: {status['rolls_available']}")
    
    if status['is_satisfied']:
        print("    ✓ Step 2 Ready (Auto-Satisfied by WIP)")
    else:
         print("    ✗ Step 2 NOT Ready")

    print("\nPHASE 70 VERIFICATION COMPLETE")

if __name__ == "__main__":
    try:
        verify_phase_70()
    except Exception as e:
        import traceback
        traceback.print_exc()
        sys.exit(1)
