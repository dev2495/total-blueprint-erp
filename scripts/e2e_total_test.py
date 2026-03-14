import os
import django
from decimal import Decimal
import uuid

# Set up Django environment
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.factory.models import Plant, WorkCenter, Machine, WorkCenterProcess, Process
from apps.inventory.models import InventoryLocation, InventoryRoll, InventoryBulk
from apps.sales.models import SalesOrder, SalesOrderItem, Customer
from apps.templates.models import TemplateBlueprint
from apps.materials.models import InventoryMaterial
from apps.recipes.models import RecipeGrade
from apps.production.models import ProductionJob, FinishedGoodsBatch, PackingUnit, DeliveryChallan
from apps.production.services.job_services import JobService, WCManagerService
from apps.production.services.services_execution import ExecutionService
# from apps.inventory.services.stock import StockService

def e2e_total_test():
    print(">>> Starting Unified E2E Test (Roll + Pouch)...")
    
    # 1. Setup Base Infrastructure
    plant, _ = Plant.objects.get_or_create(code="PL-MAIN", defaults={"name": "Main Production Facility"})
    loc_rm, _ = InventoryLocation.objects.get_or_create(plant=plant, code="LOC-RM", defaults={"type": "RM"})
    loc_wip, _ = InventoryLocation.objects.get_or_create(plant=plant, code="LOC-WIP", defaults={"type": "WIP"})
    loc_fg, _ = InventoryLocation.objects.get_or_create(plant=plant, code="LOC-FG", defaults={"type": "FG"})
    
    # Ensure Machines and WorkCenters exist for used processes
    def setup_machine(wc_code, proc_code):
        try:
            proc = Process.objects.get(code=proc_code)
            wc, _ = WorkCenter.objects.get_or_create(plant=plant, code=wc_code, defaults={"default_wip_location": loc_wip})
            WorkCenterProcess.objects.get_or_create(work_center=wc, process=proc)
            m, _ = Machine.objects.get_or_create(work_center=wc, code=f"M-{wc_code}-01")
            return m
        except Process.DoesNotExist:
            print(f"Warning: Process {proc_code} not found.")
            return None

    # Process mapping
    process_machines = {}
    for code in ['RotoP', 'MLD-EXT', 'LAM', 'SLIT', 'pouch', 'EXTRUSION-68', 'PRINTING-68']:
        m = setup_machine(f"WC-{code}", code)
        if m: process_machines[code] = m
    
    # 2. Identify Templates
    pouch_template = TemplateBlueprint.objects.get(id='af287cb8-5f2d-4ec3-bc3f-0cdd8b3561ef')
    roll_template = TemplateBlueprint.objects.get(id='87a36e3d-6ed8-4275-8916-3da8cd2a76aa')
    
    # 3. Create Sales Order
    customer, _ = Customer.objects.get_or_create(code="CUST-E2E", defaults={"name": "E2E Final Customer"})
    so = SalesOrder.objects.create(customer=customer, customer_name=customer.name, status="CONFIRMED", order_type="MTO")
    
    # Item 1: Pouch (1000 PCS)
    SalesOrderItem.objects.create(
        sales_order=so, template=pouch_template, qty_uom="PCS", qty_value=Decimal("1000"),
        unit_weight_g=Decimal("10"), total_weight_kg=Decimal("10")
    )
    # Item 2: Roll (100 KG)
    SalesOrderItem.objects.create(
        sales_order=so, template=roll_template, qty_uom="KG", qty_value=Decimal("100"),
        total_weight_kg=Decimal("100")
    )
    
    print(f"Sales Order {so.order_number} created with 2 items.")
    
    # 4. Generate Production Jobs
    jobs = JobService.create_jobs_from_order(so.id)
    print(f"Generated {len(jobs)} total jobs.")
    
    # 5. Inventory Provisioning
    base_film = InventoryMaterial.objects.filter(category='FILM_VARIANT').first()
    if not base_film:
        family, _ = InventoryMaterial.objects.get_or_create(code="FAM-GEN", defaults={"name": "Generic Family", "category": "FILM_FAMILY", "density_gcm3": 1.0})
        base_film, _ = InventoryMaterial.objects.get_or_create(code="MAT-GEN-12", defaults={"name": "12mic Generic", "category": "FILM_VARIANT", "parent_family": family})

    grade, _ = RecipeGrade.objects.get_or_create(name="Standard")
    
    def provide_roll(qty, width=500):
        return InventoryRoll.objects.create(
            label_id=f"INPUT-{uuid.uuid4().hex[:6].upper()}",
            material=base_film, thickness_micron=Decimal("12"), width_mm=Decimal(width),
            grade=grade, plant=plant, weight_kg=Decimal(qty), location=loc_rm, status="AVAILABLE"
        )
    
    # 6. Execute Jobs Automagically
    jobs_qs = ProductionJob.objects.filter(sales_order_item__sales_order=so).order_by('sales_order_item', 'routing_step_index')
    for job_static in jobs_qs:
        job = ProductionJob.objects.get(id=job_static.id) # Refresh state
        print(f"\n>>> Processing Job: {job.job_number} ({job.current_process.name})")
        
        # Prepare & Release
        if not hasattr(job, 'assignment') or not job.assignment:
            WCManagerService.prepare_job_for_wc(job)
        
        target_machine = process_machines.get(job.current_process.code)
        if not target_machine:
            print(f"Skipping job {job.job_number} - no machine for {job.current_process.code}")
            continue

        WCManagerService.assign_machine(job.assignment.id, target_machine.id)
        
        if job.job_state in ['PLANNED', 'WAITING']:
            JobService.release_job(job.id)
            print(f"Job {job.job_number} released.")
        else:
            print(f"Job {job.job_number} already in state {job.job_state}, skipping release.")
        
        # 6a. Resource Allocation (If needed)
        # 1. Provide Bulk Stock for all requirements
        from apps.production.models import JobMaterialRequirement
        reqs = JobMaterialRequirement.objects.filter(production_job=job)
        consumption_location = job.from_location or loc_rm
        
        for req in reqs:
            InventoryBulk.objects.update_or_create(
                material=req.material,
                location=consumption_location,
                plant=plant,
                defaults={"qty_kg": Decimal("1000")} # Top up to 1000kg
            )
            print(f"Topped up bulk stock: {req.material.code}")

        # 2. Provide & Allocate Rolls
        step_roll_spec = ExecutionService._resolve_step_roll_spec(job, job.current_process)
        req_rolls = ExecutionService._required_roll_count(job, job.current_process, step_roll_spec)
        
        if req_rolls > 0:
            for _ in range(req_rolls):
                input_roll = provide_roll(job.quantity * Decimal("1.2"))
                ExecutionService.assign_roll_to_job(job.id, input_roll.id, manual_override=True, override_reason="E2E Test")
                print(f"Allocated roll: {input_roll.label_id}")

        # Start Job
        JobService.start_job(job)
        
        # 6b. Complete Job
        g = RecipeGrade.objects.first()
        completion_meta = {
            "output_width_mm": Decimal("500"),
            "output_thickness_micron": Decimal("12"),
            "output_grade_id": str(g.id) if g else None,
            "output_length_m": Decimal("100"),
            "scrap_qty": Decimal("0.1")
        }
        
        JobService.complete_job(job, job.quantity, completion_meta=completion_meta)
        print(f"Job {job.job_number} COMPLETED.")

    # 7. Verify FG
    fg_batches = FinishedGoodsBatch.objects.filter(sales_order_item__sales_order=so)
    print(f"\nTotal FG Batches Created: {fg_batches.count()}")
    for batch in fg_batches:
        print(f" - Batch {batch.batch_number}: {batch.quantity_value} {batch.uom} ({batch.sales_order_item.template.fg_type})")

    # 8. Dispatch (Simulate)
    from apps.production.services.dispatch_service import FGDispatchService
    
    print("\n>>> Simulating Dispatch...")
    
    # Collect items for dispatch
    pouch_batches = [{'batch_id': str(b.id), 'qty_pcs': int(b.qty_pcs or 0), 'weight_kg': float(b.qty_kg or 0)} for b in fg_batches if b.template.fg_type == 'POUCH']
    roll_ids = [str(r.id) for r in InventoryRoll.objects.filter(sales_order_item__sales_order=so, is_fg=True, status='AVAILABLE')]
    
    dc = FGDispatchService.create_challan(
        customer_name=customer.name,
        plant_id=str(plant.id),
        sales_order_id=str(so.id),
        batch_items=pouch_batches,
        roll_ids=roll_ids
    )
    
    FGDispatchService.dispatch_challan(dc.id)
    print(f"Delivery Challan {dc.dc_no} DISPATCHED.")

    print("\n>>> E2E TEST SUCCESSFUL! Both Roll and Pouch flows verified.")

if __name__ == "__main__":
    try:
        e2e_total_test()
    except Exception as e:
        print(f"E2E TEST FAILED: {str(e)}")
        import traceback
        traceback.print_exc()
