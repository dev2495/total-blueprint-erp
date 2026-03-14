import os
import django
from decimal import Decimal

# Set up Django environment
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.factory.models import Plant, WorkCenter, Machine, WorkCenterProcess, Process
from apps.inventory.models import InventoryLocation, InventoryRoll, InventoryBulk, Vendor
from apps.sales.models import SalesOrder, SalesOrderItem, Customer
from apps.templates.models import TemplateBlueprint
from apps.materials.models import InventoryMaterial
from apps.recipes.models import RecipeGrade

def setup_e2e():
    print(">>> Starting E2E Environment Setup...")
    
    # 1. Create Plant
    plant, _ = Plant.objects.get_or_create(code="PL-MAIN", defaults={"name": "Main Production Facility"})
    print(f"Plant: {plant.name}")

    # 2. Create Locations
    loc_rm, _ = InventoryLocation.objects.get_or_create(
        plant=plant, code="LOC-RM", defaults={"name": "Raw Material Store", "type": "RM"}
    )
    loc_wip, _ = InventoryLocation.objects.get_or_create(
        plant=plant, code="LOC-WIP", defaults={"name": "WIP Staging", "type": "WIP"}
    )
    loc_fg, _ = InventoryLocation.objects.get_or_create(
        plant=plant, code="LOC-FG", defaults={"name": "FG Yard", "type": "FG"}
    )
    loc_dispatch, _ = InventoryLocation.objects.get_or_create(
        plant=plant, code="LOC-DISP", defaults={"name": "Dispatch Dock", "type": "DISPATCH"}
    )
    print("Locations created.")

    # 3. Create Work Centers & Machines
    # Get Processes from Template: ecb9d1e2-f26a-4d73-b8df-6cc21379e6ce
    # Step 1: PP-PRN-2512 (Printing)
    # Step 2: PP-PCH-2512 (Pouching)
    
    proc_prn = Process.objects.get(code='PP-PRN-2512')
    proc_pch = Process.objects.get(code='PP-PCH-2512')

    wc_prn, _ = WorkCenter.objects.get_or_create(
        plant=plant, code="WC-PRN", defaults={"name": "Printing Section", "default_wip_location": loc_wip}
    )
    WorkCenterProcess.objects.get_or_create(work_center=wc_prn, process=proc_prn)
    Machine.objects.get_or_create(work_center=wc_prn, code="M-PRN-01", defaults={"name": "Printing Machine 1"})

    wc_pch, _ = WorkCenter.objects.get_or_create(
        plant=plant, code="WC-PCH", defaults={"name": "Pouchman Section", "default_wip_location": loc_wip}
    )
    WorkCenterProcess.objects.get_or_create(work_center=wc_pch, process=proc_pch)
    Machine.objects.get_or_create(work_center=wc_pch, code="M-PCH-01", defaults={"name": "Pouching Machine 1"})
    print("Work Centers and Machines created.")

    # 4. Inventory Setup
    # Get Template BOM material
    template = TemplateBlueprint.objects.get(id='ecb9d1e2-f26a-4d73-b8df-6cc21379e6ce')
    
    # Find a film or create one for testing
    family, _ = InventoryMaterial.objects.get_or_create(
        code="FAM-PET", 
        defaults={"name": "PET Family", "category": "FILM_FAMILY", "density_gcm3": Decimal("1.4")}
    )
    
    film, _ = InventoryMaterial.objects.get_or_create(
        code="MAT-PET-12",
        defaults={
            "name": "12mic PET Film", 
            "category": "FILM_VARIANT", 
            "base_uom": "KG",
            "parent_family": family
        }
    )
    
    grade, _ = RecipeGrade.objects.get_or_create(name="Standard Grade")

    # Inward a Mother Roll to LOC-RM
    import uuid
    roll_label = f"ROLL-E2E-{uuid.uuid4().hex[:6].upper()}"
    roll = InventoryRoll.objects.create(
        label_id=roll_label,
        material=film,
        thickness_micron=Decimal("12"),
        width_mm=Decimal("500"),
        grade=grade,
        plant=plant,
        weight_kg=Decimal("100"),
        location=loc_rm,
        status="AVAILABLE"
    )
    print(f"Inwarded Mother Roll: {roll.label_id}")

    # 5. Customer & Sales Order
    customer, _ = Customer.objects.get_or_create(code="CUST-TEST", defaults={"name": "E2E Test Customer"})
    
    so = SalesOrder.objects.create(
        customer=customer,
        customer_name=customer.name,
        status="CONFIRMED",
        order_type="MTO"
    )
    
    # Create SO Item using the Pouch Template
    # We use a 1000 PCS order
    SalesOrderItem.objects.create(
        sales_order=so,
        template=template,
        qty_uom="PCS",
        qty_value=Decimal("1000"),
        unit_weight_g=Decimal("10"), # Mock unit weight if not set
        total_weight_kg=Decimal("10")
    )
    # 6. Generate Production Jobs
    from apps.production.services.job_services import JobService, WCManagerService
    jobs = JobService.create_jobs_from_order(so.id)
    print(f"Generated {len(jobs)} Production Jobs.")

    # 7. Assign and Release the first job (Printing)
    first_job = jobs[0]
    machine_prn = Machine.objects.get(code="M-PRN-01")
    
    # Prepare and Assign
    WCManagerService.prepare_job_for_wc(first_job)
    WCManagerService.assign_machine(first_job.assignment.id, machine_prn.id)
    JobService.release_job(first_job.id)
    print(f"Released first job ({first_job.job_number}) to Machine: {machine_prn.name}")

    print(">>> E2E Setup Complete. Case ready for execution testing.")

if __name__ == "__main__":
    setup_e2e()
