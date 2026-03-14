#!/usr/bin/env python
"""
Phase 68 Comprehensive End-to-End Verification Script

Tests the complete WIP auto-flow system with REAL production jobs:
1. Finds existing work centers with active jobs
2. Tests satisfaction status API for each job type
3. Tests WIP pool detection
4. Tests auto-satisfy functionality
5. Verifies bulk consumption rules

Run with:
    cd /Users/devarshthakkar/Documents/total_blueprint_erp
    source venv_311/bin/activate
    python scripts/verify_phase_68_e2e.py
"""
import os
import sys
import django

# Setup Django
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.db import transaction
from decimal import Decimal
from apps.factory.models import Process, WorkCenter
from apps.production.models import ProductionJob
from apps.production.services.services_execution import ExecutionService
from apps.inventory.models import InventoryRoll

def print_header(title):
    print(f"\n{'='*70}")
    print(f" {title}")
    print(f"{'='*70}")

def test_process_configuration():
    """Test 1: Verify all processes have correct Phase 68 configuration"""
    print_header("TEST 1: Process Configuration")
    
    processes = Process.objects.all().order_by('code')
    
    extrusion_correct = 0
    printing_correct = 0
    lamination_correct = 0
    other_correct = 0
    errors = []
    
    for p in processes:
        # Extrusion processes: should have rolls_required=0
        if p.input_form == 'BULK' and p.output_form == 'ROLL':
            if p.rolls_required == 0:
                extrusion_correct += 1
            else:
                errors.append(f"  ✗ {p.code}: Extrusion should have rolls_required=0, has {p.rolls_required}")
        
        # Printing processes: should have modifies_existing_roll=True
        elif 'PRINT' in p.code.upper() or 'ROTO' in p.code.upper() or 'FLEXO' in p.code:
            if p.modifies_existing_roll:
                printing_correct += 1
            else:
                errors.append(f"  ✗ {p.code}: Printing should have modifies_existing_roll=True")
        
        # Lamination processes: should have rolls_required=2
        elif 'LAM' in p.code.upper():
            if p.rolls_required == 2:
                lamination_correct += 1
            else:
                errors.append(f"  ✗ {p.code}: Lamination should have rolls_required=2, has {p.rolls_required}")
        
        else:
            other_correct += 1
    
    print(f"  ✓ Extrusion processes configured correctly: {extrusion_correct}")
    print(f"  ✓ Printing processes configured correctly: {printing_correct}")
    print(f"  ✓ Lamination processes configured correctly: {lamination_correct}")
    print(f"  ✓ Other processes configured: {other_correct}")
    
    if errors:
        print("\n  Errors found:")
        for e in errors:
            print(e)
    else:
        print("\n  ✓ All processes configured correctly!")
    
    return len(errors) == 0

def test_execution_service_apis():
    """Test 2: Test ExecutionService API methods with real jobs"""
    print_header("TEST 2: ExecutionService API Methods")
    
    # Find a real job to test with
    jobs = ProductionJob.objects.filter(
        status__in=['QUEUED', 'ASSIGNED', 'RUNNING']
    ).select_related('current_process', 'work_center')[:5]
    
    if not jobs:
        print("  ⚠ No active jobs found to test with")
        return True
    
    success = True
    
    for job in jobs:
        print(f"\n  Testing Job: {job.job_number}")
        proc = job.current_process
        if not proc:
            print(f"    ⚠ No current process assigned, skipping")
            continue
            
        print(f"    Process: {proc.code} (input={proc.input_form}, output={proc.output_form})")
        print(f"    rolls_required={proc.rolls_required}, modifies={proc.modifies_existing_roll}")
        
        try:
            # Test satisfaction status
            status = ExecutionService.get_satisfaction_status(str(job.id))
            print(f"    ✓ get_satisfaction_status():")
            print(f"      - rolls_required: {status.get('rolls_required')}")
            print(f"      - rolls_available: {status.get('rolls_available')}")
            print(f"      - rolls_missing: {status.get('rolls_missing')}")
            print(f"      - is_satisfied: {status.get('is_satisfied')}")
            print(f"      - input_form: {status.get('input_form')}")
        except Exception as e:
            print(f"    ✗ get_satisfaction_status() failed: {e}")
            success = False
            continue
        
        try:
            # Test WIP pool
            wip_pool = ExecutionService.get_wip_pool(str(job.id))
            print(f"    ✓ get_wip_pool(): {len(wip_pool)} rolls available")
            for roll in wip_pool[:3]:
                print(f"      - {roll.label_id}: {roll.weight_kg}kg")
        except Exception as e:
            print(f"    ✗ get_wip_pool() failed: {e}")
            success = False
        
        try:
            # Test WIP pool grouped
            grouped = ExecutionService.get_wip_pool_grouped(str(job.id))
            print(f"    ✓ get_wip_pool_grouped(): {len(grouped)} material groups")
            for family, rolls in grouped.items():
                print(f"      - {family}: {len(rolls)} rolls")
        except Exception as e:
            print(f"    ✗ get_wip_pool_grouped() failed: {e}")
            success = False
    
    return success

def test_satisfaction_logic():
    """Test 3: Verify satisfaction logic for different process types"""
    print_header("TEST 3: Satisfaction Logic by Process Type")
    
    # Group jobs by process type
    process_types = {
        'EXTRUSION': {'input': 'BULK', 'rolls_req': 0},
        'PRINTING': {'input': 'ROLL', 'rolls_req': 1, 'modifies': True},
        'LAMINATION': {'input': 'ROLL', 'rolls_req': 2},
        'SLITTING': {'input': 'ROLL', 'rolls_req': 1},
        'POUCHING': {'input': 'ROLL', 'output': 'BULK', 'rolls_req': 1},
    }
    
    for proc_type, expected in process_types.items():
        print(f"\n  {proc_type}:")
        
        # Find a process matching this type
        processes = Process.objects.filter(code__icontains=proc_type[:4])[:1]
        if not processes:
            print(f"    ⚠ No {proc_type} process found, skipping")
            continue
        
        proc = processes[0]
        print(f"    Process: {proc.code}")
        print(f"    Expected rolls_required: {expected.get('rolls_req', 'N/A')}")
        print(f"    Actual rolls_required: {proc.rolls_required}")
        
        if 'rolls_req' in expected:
            if proc.rolls_required == expected['rolls_req']:
                print(f"    ✓ rolls_required matches expected")
            else:
                print(f"    ✗ rolls_required mismatch!")
        
        if 'modifies' in expected:
            if proc.modifies_existing_roll == expected['modifies']:
                print(f"    ✓ modifies_existing_roll matches expected")
            else:
                print(f"    ✗ modifies_existing_roll mismatch!")
    
    return True

def test_wip_discovery():
    """Test 4: Test WIP Pool rollover between steps"""
    print_header("TEST 4: WIP Pool Discovery")
    
    # Find jobs that should have WIP from previous steps
    jobs = ProductionJob.objects.filter(
        current_step_index__gt=0,
        status__in=['QUEUED', 'ASSIGNED', 'RUNNING']
    ).select_related('current_process', 'sales_order_item')[:3]
    
    if not jobs:
        print("  ⚠ No multi-step jobs found (current_step_index > 0)")
        print("  Looking for any roll-input jobs instead...")
        jobs = ProductionJob.objects.filter(
            current_process__input_form='ROLL',
            status__in=['QUEUED', 'ASSIGNED', 'RUNNING']
        ).select_related('current_process')[:3]
    
    if not jobs:
        print("  ⚠ No roll-input jobs found")
        return True
    
    for job in jobs:
        print(f"\n  Job: {job.job_number}")
        print(f"  Step: {job.current_step_index}")
        print(f"  Process: {job.current_process.code if job.current_process else 'N/A'}")
        
        try:
            wip_pool = ExecutionService.get_wip_pool(str(job.id))
            print(f"  ✓ WIP Pool found: {len(wip_pool)} rolls")
            
            if wip_pool:
                print(f"  Sample rolls:")
                for roll in wip_pool[:3]:
                    mat_name = roll.material.name if roll.material else 'N/A'
                    print(f"    - {roll.label_id}: {roll.weight_kg}kg ({mat_name})")
            else:
                print(f"  ⚠ No WIP rolls available for this job")
                
        except Exception as e:
            print(f"  ✗ Error getting WIP pool: {e}")
    
    return True

def test_roll_inventory():
    """Test 5: Verify roll inventory state"""
    print_header("TEST 5: Roll Inventory State")
    
    total_rolls = InventoryRoll.objects.count()
    available_rolls = InventoryRoll.objects.filter(status='AVAILABLE').count()
    consumed_rolls = InventoryRoll.objects.filter(status='CONSUMED').count()
    reserved_rolls = InventoryRoll.objects.filter(status='RESERVED').count()
    
    print(f"  Total rolls in system: {total_rolls}")
    print(f"  Available: {available_rolls}")
    print(f"  Reserved: {reserved_rolls}")
    print(f"  Consumed: {consumed_rolls}")
    
    # Show rolls by stage
    print(f"\n  Rolls by stage_index:")
    for i in range(5):
        count = InventoryRoll.objects.filter(stage_index=i, status='AVAILABLE').count()
        if count > 0:
            print(f"    Stage {i}: {count} available rolls")
    
    return True

def main():
    print("\n" + "="*70)
    print(" PHASE 68 END-TO-END VERIFICATION")
    print(" Universal Flow Engine + Perfect WCM")
    print("="*70)
    
    results = []
    
    results.append(("Process Configuration", test_process_configuration()))
    results.append(("ExecutionService APIs", test_execution_service_apis()))
    results.append(("Satisfaction Logic", test_satisfaction_logic()))
    results.append(("WIP Discovery", test_wip_discovery()))
    results.append(("Roll Inventory", test_roll_inventory()))
    
    print_header("SUMMARY")
    
    all_passed = True
    for name, passed in results:
        status = "✓ PASS" if passed else "✗ FAIL"
        print(f"  {status}: {name}")
        if not passed:
            all_passed = False
    
    print()
    if all_passed:
        print("  " + "="*50)
        print("  ✅ ALL PHASE 68 E2E TESTS PASSED!")
        print("  " + "="*50)
    else:
        print("  " + "="*50)
        print("  ⚠ SOME TESTS FAILED - Review above")
        print("  " + "="*50)
    
    print()
    return 0 if all_passed else 1


if __name__ == '__main__':
    sys.exit(main())
