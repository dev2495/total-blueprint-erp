#!/usr/bin/env python
"""
Phase 17.5 Verification Script: FG Creation & Inventory Verification
Tests both ROLL FG and POUCH FG creation flows end-to-end.
"""
import os
import sys
import django

# Setup Django
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from decimal import Decimal
from django.utils import timezone
from apps.users.models import User
from apps.factory.models import Plant, WorkCenter, Machine, Process
from apps.inventory.models import InventoryLocation, InventoryRoll, InventoryStock, InventoryLedger
from apps.materials.models import InventoryMaterial
from apps.templates.models import TemplateBlueprint
from apps.routing.models import RoutingRule
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.production.models import ProductionJob, FinishedGoodsBatch, WorkCenterAssignment
from apps.production.services import JobService
from apps.production.services.operator_service import OperatorService
from apps.production.services.dispatch_service import FGDispatchService


def setup_test_data():
    """Creates minimal test data for verification."""
    print("\n=== Setting up Test Data ===")
    
    # User
    user, _ = User.objects.get_or_create(username="test_operator", defaults={"email": "op@test.com"})
    
    # Plant
    plant, _ = Plant.objects.get_or_create(code="P-TEST", defaults={"name": "Test Plant"})
    
    # Locations
    wip_loc, _ = InventoryLocation.objects.get_or_create(
        plant=plant, code="WIP-TEST", defaults={"name": "Test WIP", "type": "WIP"}
    )
    fg_loc, _ = InventoryLocation.objects.get_or_create(
        plant=plant, code="FG-TEST", defaults={"name": "Test FG", "type": "FG"}
    )
    rm_loc, _ = InventoryLocation.objects.get_or_create(
        plant=plant, code="RM-TEST", defaults={"name": "Test RM", "type": "RM"}
    )
    
    # Process
    extrusion, _ = Process.objects.get_or_create(
        code="EXTRUSION", 
        defaults={"name": "Extrusion", "category": "EXTRUSION", "output_mode": "ROLL"}
    )
    printing, _ = Process.objects.get_or_create(
        code="PRINTING", 
        defaults={"name": "Printing", "category": "PRINTING", "output_mode": "ROLL"}
    )
    bag_making, _ = Process.objects.get_or_create(
        code="BAG_MAKING", 
        defaults={"name": "Bag Making", "category": "BAG_MAKING", "output_mode": "QUANTITY"}
    )
    
    # Work Center
    wc, _ = WorkCenter.objects.get_or_create(
        code="WC-TEST", plant=plant, defaults={"name": "Test Work Center"}
    )
    
    # Machine
    machine, _ = Machine.objects.get_or_create(
        code="M-TEST", work_center=wc, defaults={"name": "Test Machine"}
    )
    
    # Material (Film Variant)
    mat_film, _ = InventoryMaterial.objects.get_or_create(
        code="FILM-TEST", 
        defaults={"name": "Test Film", "category": "FILM_VARIANT", "base_uom": "KG"}
    )
    
    # Material (Granule for consumption)
    mat_granule, _ = InventoryMaterial.objects.get_or_create(
        code="GR-TEST", 
        defaults={"name": "Test Granule", "category": "GRANULE", "base_uom": "KG"}
    )
    
    # Material (Packaging for POUCH FG Ledger)
    mat_pkg, _ = InventoryMaterial.objects.get_or_create(
        code="PKG-TEST", 
        defaults={"name": "Test Packaging", "category": "PACKAGING", "base_uom": "PCS"}
    )
    
    # Routing Rules
    # Routing for ROLL FG (ends at Printing)
    routing_roll, _ = RoutingRule.objects.get_or_create(
        name="Test Routing - Roll FG",
        defaults={"ordered_processes": ["EXTRUSION", "PRINTING"]}
    )
    
    # Routing for POUCH FG (ends at Bag Making)
    routing_pouch, _ = RoutingRule.objects.get_or_create(
        name="Test Routing - Pouch FG",
        defaults={"ordered_processes": ["EXTRUSION", "PRINTING", "BAG_MAKING"]}
    )
    
    # Templates
    template_roll, _ = TemplateBlueprint.objects.get_or_create(
        name="Test Template - Roll FG",
        defaults={
            "fg_type": "ROLL",
            "status": "LIVE",
            "routing_rule": routing_roll,
            "geometry_schema": {
                "base_width_mm": 500,
                "base_height_mm": 1000,
                "multipliers": {"faces": 1, "repeats": 1}
            },
            "layer_schema": [{"material_id": str(mat_film.id), "thickness": 50}]
        }
    )
    
    template_pouch, _ = TemplateBlueprint.objects.get_or_create(
        name="Test Template - Pouch FG",
        defaults={
            "fg_type": "POUCH",
            "status": "LIVE",
            "routing_rule": routing_pouch,
            "geometry_schema": {
                "base_width_mm": 200,
                "base_height_mm": 300,
                "multipliers": {"faces": 2, "repeats": 1}
            },
            "layer_schema": [{"material_id": str(mat_film.id), "thickness": 50}]
        }
    )
    
    # Granule Stock for consumption
    InventoryStock.objects.update_or_create(
        material=mat_granule, location=rm_loc,
        defaults={"quantity": Decimal("1000"), "uom": "KG"}
    )
    
    return {
        "user": user,
        "plant": plant,
        "wc": wc,
        "machine": machine,
        "rm_loc": rm_loc,
        "wip_loc": wip_loc,
        "fg_loc": fg_loc,
        "mat_film": mat_film,
        "mat_granule": mat_granule,
        "template_roll": template_roll,
        "template_pouch": template_pouch,
        "routing_roll": routing_roll,
        "routing_pouch": routing_pouch,
        "extrusion": extrusion,
        "printing": printing,
        "bag_making": bag_making,
    }


def test_roll_fg_creation(data):
    """
    Test 1: Mango Roll FG
    - Routing ends at Printing
    - Verify FG Roll created with is_fg=True
    """
    print("\n=== TEST 1: ROLL FG Creation ===")
    
    # Create Sales Order (minimal)
    so = SalesOrder.objects.create(
        order_number=f"SO-ROLL-{timezone.now().strftime('%H%M%S')}",
        customer_name="Test Customer - Roll"
    )
    # Empty BOM Snapshot to bypass physics calculation
    empty_bom = {
        "granules": [],
        "inks": [],
        "chemicals": [],
        "addons": [],
        "films": []
    }
    
    so_item = SalesOrderItem.objects.create(
        sales_order=so,
        template=data['template_roll'],
        qty_value=Decimal("100"),
        qty_uom="KG",
        bom_snapshot=empty_bom
    )
    
    # Create Job for FINAL step (Printing - step index 1)
    job = ProductionJob.objects.create(
        job_number=f"JOB-ROLL-{timezone.now().strftime('%H%M%S')}",
        template=data['template_roll'],
        sales_order_item=so_item,
        routing_rule=data['routing_roll'],
        routing_step_index=1,  # Final step (0-indexed, 2 steps total)
        process=data['printing'],
        work_center=data['wc'],
        machine=data['machine'],
        quantity=Decimal("100"),
        uom="KG",
        output_mode="ROLL",
        from_location=data['wip_loc'],
        to_location=data['fg_loc'],
        job_state="EXECUTING",
        status="RUNNING"  # Required for JobService.complete_job
    )
    
    # Create WC Assignment
    WorkCenterAssignment.objects.create(
        production_job=job,
        work_center=data['wc'],
        machine=data['machine'],
        status='EXECUTION_READY'
    )
    
    # Log Output
    OperatorService.log_output(str(job.id), 95.0, data['user'])
    OperatorService.log_scrap(str(job.id), 5.0, "TRIM", "Test trim loss", data['user'])
    
    print(f"Job: {job.job_number}")
    print(f"Routing Step: {job.routing_step_index + 1}/{job.total_routing_steps}")
    print(f"Is Final Step: {job.routing_step_index == job.total_routing_steps - 1}")
    
    # Complete Job
    try:
        OperatorService.complete_job(str(job.id), data['user'])
        print("✅ Job completed successfully")
    except Exception as e:
        print(f"❌ Job completion failed: {e}")
        return False
    
    # Verify FG Roll Created
    fg_rolls = InventoryRoll.objects.filter(production_job=job, is_fg=True)
    if fg_rolls.exists():
        fg_roll = fg_rolls.first()
        print(f"✅ FG Roll created: {fg_roll.label_id}")
        print(f"   Weight: {fg_roll.weight_kg} KG")
        print(f"   Location: {fg_roll.location.name}")
        print(f"   is_fg: {fg_roll.is_fg}")
    else:
        print("❌ No FG Roll found!")
        return False
    
    # Verify Ledger Entry
    ledger_entries = InventoryLedger.objects.filter(reference_id=job.id, transaction_type='PRODUCTION_RECEIPT')
    if ledger_entries.exists():
        print(f"✅ Ledger entry created: {ledger_entries.first().reference_note}")
    else:
        print("❌ No ledger entry found!")
        return False
    
    # Verify Dispatch Readiness
    dispatch_result = FGDispatchService.get_dispatchable_units(job_id=str(job.id))
    print(f"✅ Dispatch Summary: {dispatch_result['summary']}")
    
    return True


def test_pouch_fg_creation(data):
    """
    Test 2: Mango Pouch FG
    - Routing ends at Bag Making
    - Verify FinishedGoodsBatch created
    """
    print("\n=== TEST 2: POUCH FG Creation ===")
    
    # Create Sales Order
    so = SalesOrder.objects.create(
        order_number=f"SO-POUCH-{timezone.now().strftime('%H%M%S')}",
        customer_name="Test Customer - Pouch"
    )
    # Empty BOM Snapshot to bypass physics calculation
    empty_bom = {
        "granules": [],
        "inks": [],
        "chemicals": [],
        "addons": [],
        "films": []
    }
    
    so_item = SalesOrderItem.objects.create(
        sales_order=so,
        template=data['template_pouch'],
        qty_value=Decimal("1000"),
        qty_uom="PCS",
        bom_snapshot=empty_bom
    )
    
    # Create Job for FINAL step (Bag Making - step index 2)
    job = ProductionJob.objects.create(
        job_number=f"JOB-POUCH-{timezone.now().strftime('%H%M%S')}",
        template=data['template_pouch'],
        sales_order_item=so_item,
        routing_rule=data['routing_pouch'],
        routing_step_index=2,  # Final step (0-indexed, 3 steps total)
        process=data['bag_making'],
        work_center=data['wc'],
        machine=data['machine'],
        quantity=Decimal("1000"),
        uom="PCS",
        output_mode="QUANTITY",
        from_location=data['wip_loc'],
        to_location=data['fg_loc'],
        job_state="EXECUTING",
        status="RUNNING"  # Required for JobService.complete_job
    )
    
    # Create WC Assignment
    WorkCenterAssignment.objects.create(
        production_job=job,
        work_center=data['wc'],
        machine=data['machine'],
        status='EXECUTION_READY'
    )
    
    # Log Output
    OperatorService.log_output(str(job.id), 950, data['user'])
    OperatorService.log_scrap(str(job.id), 50, "DEFECT", "Test defects", data['user'])
    
    print(f"Job: {job.job_number}")
    print(f"Routing Step: {job.routing_step_index + 1}/{job.total_routing_steps}")
    print(f"Is Final Step: {job.routing_step_index == job.total_routing_steps - 1}")
    
    # Complete Job
    try:
        OperatorService.complete_job(str(job.id), data['user'])
        print("✅ Job completed successfully")
    except Exception as e:
        print(f"❌ Job completion failed: {e}")
        return False
    
    # Verify FG Batch Created
    fg_batches = FinishedGoodsBatch.objects.filter(production_job=job)
    if fg_batches.exists():
        fg_batch = fg_batches.first()
        print(f"✅ FG Batch created: {fg_batch.batch_number}")
        print(f"   Qty PCS: {fg_batch.qty_pcs}")
        print(f"   Location: {fg_batch.location.name}")
        print(f"   Status: {fg_batch.status}")
    else:
        print("❌ No FG Batch found!")
        return False
    
    # Verify NO FG Rolls exist for this job
    fg_rolls = InventoryRoll.objects.filter(production_job=job, is_fg=True)
    if not fg_rolls.exists():
        print("✅ Correctly no FG Rolls for POUCH job")
    else:
        print("❌ Unexpected FG Rolls found for POUCH job!")
        return False
    
    # Verify Dispatch Readiness
    dispatch_result = FGDispatchService.get_dispatchable_units(job_id=str(job.id))
    print(f"✅ Dispatch Summary: {dispatch_result['summary']}")
    
    return True


def main():
    print("=" * 60)
    print("PHASE 17.5 VERIFICATION: FG CREATION & INVENTORY")
    print("=" * 60)
    
    # Setup
    data = setup_test_data()
    
    # Run Tests
    test1_passed = test_roll_fg_creation(data)
    test2_passed = test_pouch_fg_creation(data)
    
    # Summary
    print("\n" + "=" * 60)
    print("VERIFICATION SUMMARY")
    print("=" * 60)
    print(f"Test 1 (ROLL FG):  {'✅ PASSED' if test1_passed else '❌ FAILED'}")
    print(f"Test 2 (POUCH FG): {'✅ PASSED' if test2_passed else '❌ FAILED'}")
    
    if test1_passed and test2_passed:
        print("\n🎉 ALL TESTS PASSED - Phase 17.5 Verified!")
        return 0
    else:
        print("\n⚠️ SOME TESTS FAILED - Review Required")
        return 1


if __name__ == "__main__":
    sys.exit(main())
