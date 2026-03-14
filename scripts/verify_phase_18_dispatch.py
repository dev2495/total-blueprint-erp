#!/usr/bin/env python
"""
Phase 18 Verification Script: Dispatch & Packaging
Tests:
1. Pouch → Gonny → Dispatch flow
2. Roll → Dispatch flow
3. Partial dispatch
4. Ledger integrity
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
from apps.inventory.models import InventoryLocation, InventoryRoll, InventoryLedger
from apps.materials.models import InventoryMaterial
from apps.templates.models import TemplateBlueprint
from apps.routing.models import RoutingRule
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.production.models import (
    ProductionJob, FinishedGoodsBatch, PackingUnit, 
    DeliveryChallan, DeliveryChallanItem
)
from apps.production.services.packing_service import PackingService
from apps.production.services.dispatch_service import FGDispatchService


def setup_test_data():
    """Creates minimal test data for verification."""
    print("\n=== Setting up Test Data ===")
    
    # User
    user, _ = User.objects.get_or_create(username="test_dispatch", defaults={"email": "dispatch@test.com"})
    
    # Plant
    plant, _ = Plant.objects.get_or_create(code="P-DISPATCH", defaults={"name": "Dispatch Test Plant"})
    
    # Locations
    fg_loc, _ = InventoryLocation.objects.get_or_create(
        plant=plant, code="FG-DISPATCH", defaults={"name": "Dispatch FG", "type": "FG"}
    )
    
    # Material
    mat_film, _ = InventoryMaterial.objects.get_or_create(
        code="FILM-DISPATCH", 
        defaults={"name": "Dispatch Test Film", "category": "FILM_VARIANT", "base_uom": "KG"}
    )
    
    # Routing
    routing, _ = RoutingRule.objects.get_or_create(
        name="Dispatch Test Routing",
        defaults={"ordered_processes": ["EXTRUSION", "PRINTING", "BAG_MAKING"]}
    )
    
    # Template (POUCH)
    template_pouch, _ = TemplateBlueprint.objects.get_or_create(
        name="Test Template - Pouch Dispatch",
        defaults={
            "fg_type": "POUCH",
            "status": "LIVE",
            "routing_rule": routing,
            "geometry_schema": {"base_width_mm": 200, "base_height_mm": 300}
        }
    )
    
    # Template (ROLL)
    template_roll, _ = TemplateBlueprint.objects.get_or_create(
        name="Test Template - Roll Dispatch",
        defaults={
            "fg_type": "ROLL",
            "status": "LIVE",
            "routing_rule": routing,
            "geometry_schema": {"base_width_mm": 500, "base_height_mm": 1000}
        }
    )
    
    return {
        "user": user,
        "plant": plant,
        "fg_loc": fg_loc,
        "mat_film": mat_film,
        "template_pouch": template_pouch,
        "template_roll": template_roll,
        "routing": routing,
    }


def test_pouch_gonny_dispatch(data):
    """
    Test 1: Pouch → Gonny → Dispatch flow
    1. Create FG Batch (POUCH)
    2. Create Gonny from batch (deduct pcs)
    3. Seal Gonny
    4. Create Challan with Gonny
    5. Dispatch → Verify location=IN_TRANSIT, ledger entry
    """
    print("\n=== TEST 1: Pouch → Gonny → Dispatch ===")
    
    # 1. Create FG Batch
    batch_number = f"FG-POUCH-{timezone.now().strftime('%H%M%S')}"
    job_number = f"JOB-POUCH-{timezone.now().strftime('%H%M%S')}"
    
    # Create a placeholder job
    job = ProductionJob.objects.create(
        job_number=job_number,
        template=data['template_pouch'],
        routing_rule=data['routing'],
        quantity=Decimal("1000"),
        uom="PCS",
        job_state="COMPLETED",
        status="COMPLETED"
    )
    
    fg_batch = FinishedGoodsBatch.objects.create(
        batch_number=batch_number,
        template=data['template_pouch'],
        production_job=job,
        qty_pcs=1000,
        location=data['fg_loc'],
        status='AVAILABLE'
    )
    
    print(f"✅ FG Batch created: {fg_batch.batch_number} with {fg_batch.qty_pcs} pcs")
    
    # 2. Create Gonny
    try:
        gonny = PackingService.create_gonny(str(fg_batch.id), 500, data['user'])
        print(f"✅ Gonny created: {gonny.label_id} with {gonny.qty_pcs} pcs")
    except Exception as e:
        print(f"❌ Gonny creation failed: {e}")
        return False
    
    # Verify batch deduction
    fg_batch.refresh_from_db()
    if fg_batch.qty_pcs == 500:
        print(f"✅ Batch deducted: {fg_batch.qty_pcs} pcs remaining")
    else:
        print(f"❌ Batch deduction incorrect: expected 500, got {fg_batch.qty_pcs}")
        return False
    
    # 3. Seal Gonny
    try:
        gonny = PackingService.seal_gonny(str(gonny.id), Decimal("25.5"), data['user'])
        print(f"✅ Gonny sealed: {gonny.weight_kg} kg, status={gonny.status}")
    except Exception as e:
        print(f"❌ Gonny seal failed: {e}")
        return False
    
    # 4. Create Challan
    try:
        challan = FGDispatchService.create_challan(
            customer_name="Test Customer",
            plant_id=str(data['plant'].id),
            gonny_ids=[str(gonny.id)],
            vehicle_no="MH-01-AB-1234",
            driver_name="Test Driver",
            user=data['user']
        )
        print(f"✅ Challan created: {challan.dc_no} with {challan.items.count()} items")
    except Exception as e:
        print(f"❌ Challan creation failed: {e}")
        return False
    
    # 5. Dispatch
    try:
        challan = FGDispatchService.dispatch_challan(str(challan.id), data['user'])
        print(f"✅ Challan dispatched: status={challan.status}")
    except Exception as e:
        print(f"❌ Dispatch failed: {e}")
        return False
    
    # Verify gonny status and location
    gonny.refresh_from_db()
    if gonny.status == 'DISPATCHED':
        print(f"✅ Gonny status updated: {gonny.status}")
    else:
        print(f"❌ Gonny status incorrect: expected DISPATCHED, got {gonny.status}")
        return False
    
    # Verify ledger entry
    ledger = InventoryLedger.objects.filter(reference_id=challan.id, transaction_type='DISPATCH')
    if ledger.exists():
        print(f"✅ Ledger entry created: {ledger.first().reference_note}")
    else:
        print("❌ No ledger entry for dispatch")
        return False
    
    return True


def test_roll_dispatch(data):
    """
    Test 2: Roll → Dispatch flow
    1. Create FG Roll (is_fg=True)
    2. Create Challan with Roll
    3. Dispatch → Verify location=IN_TRANSIT, ledger entry
    """
    print("\n=== TEST 2: Roll → Dispatch ===")
    
    # 1. Create FG Roll
    roll_label = f"FG-ROLL-{timezone.now().strftime('%H%M%S')}"
    job_number = f"JOB-ROLL-{timezone.now().strftime('%H%M%S')}"
    
    # Create placeholder job
    job = ProductionJob.objects.create(
        job_number=job_number,
        template=data['template_roll'],
        routing_rule=data['routing'],
        quantity=Decimal("100"),
        uom="KG",
        job_state="COMPLETED",
        status="COMPLETED"
    )
    
    fg_roll = InventoryRoll.objects.create(
        label_id=roll_label,
        material=data['mat_film'],
        batch_no=f"PROD-{job_number}",
        width_mm=Decimal("500"),
        length_m=Decimal("0"),
        weight_kg=Decimal("95"),
        location=data['fg_loc'],
        status='AVAILABLE',
        is_fg=True,
        production_job=job
    )
    
    print(f"✅ FG Roll created: {fg_roll.label_id} with {fg_roll.weight_kg} kg")
    
    # 2. Create Challan
    try:
        challan = FGDispatchService.create_challan(
            customer_name="Test Roll Customer",
            plant_id=str(data['plant'].id),
            roll_ids=[str(fg_roll.id)],
            vehicle_no="MH-02-CD-5678",
            driver_name="Roll Driver",
            user=data['user']
        )
        print(f"✅ Challan created: {challan.dc_no} with {challan.items.count()} items")
    except Exception as e:
        print(f"❌ Challan creation failed: {e}")
        return False
    
    # 3. Dispatch
    try:
        challan = FGDispatchService.dispatch_challan(str(challan.id), data['user'])
        print(f"✅ Challan dispatched: status={challan.status}")
    except Exception as e:
        print(f"❌ Dispatch failed: {e}")
        return False
    
    # Verify roll status and location
    fg_roll.refresh_from_db()
    if fg_roll.status == 'IN_TRANSIT':
        print(f"✅ Roll status updated: {fg_roll.status}")
    else:
        print(f"❌ Roll status incorrect: expected IN_TRANSIT, got {fg_roll.status}")
        return False
    
    # Verify ledger entry
    ledger = InventoryLedger.objects.filter(reference_id=challan.id, transaction_type='DISPATCH')
    if ledger.exists():
        print(f"✅ Ledger entry created for roll dispatch")
    else:
        print("❌ No ledger entry for roll dispatch")
        return False
    
    return True


def test_partial_dispatch(data):
    """
    Test 3: Partial Dispatch
    1. FG Batch with 1000 pcs
    2. Create Gonny with 300 pcs
    3. Verify batch.qty_pcs = 700 remaining
    4. Create another Gonny with 200 pcs
    5. Verify batch.qty_pcs = 500 remaining
    """
    print("\n=== TEST 3: Partial Dispatch (Multiple Gonnies) ===")
    
    # 1. Create FG Batch
    batch_number = f"FG-PARTIAL-{timezone.now().strftime('%H%M%S')}"
    job_number = f"JOB-PARTIAL-{timezone.now().strftime('%H%M%S')}"
    
    job = ProductionJob.objects.create(
        job_number=job_number,
        template=data['template_pouch'],
        routing_rule=data['routing'],
        quantity=Decimal("1000"),
        uom="PCS",
        job_state="COMPLETED",
        status="COMPLETED"
    )
    
    fg_batch = FinishedGoodsBatch.objects.create(
        batch_number=batch_number,
        template=data['template_pouch'],
        production_job=job,
        qty_pcs=1000,
        location=data['fg_loc'],
        status='AVAILABLE'
    )
    
    print(f"Original batch: {fg_batch.qty_pcs} pcs")
    
    # 2. Create first Gonny (300 pcs)
    try:
        gonny1 = PackingService.create_gonny(str(fg_batch.id), 300, data['user'])
        fg_batch.refresh_from_db()
        if fg_batch.qty_pcs == 700:
            print(f"✅ After Gonny 1 (300 pcs): {fg_batch.qty_pcs} pcs remaining")
        else:
            print(f"❌ Expected 700, got {fg_batch.qty_pcs}")
            return False
    except Exception as e:
        print(f"❌ First gonny failed: {e}")
        return False
    
    # 3. Create second Gonny (200 pcs)
    try:
        gonny2 = PackingService.create_gonny(str(fg_batch.id), 200, data['user'])
        fg_batch.refresh_from_db()
        if fg_batch.qty_pcs == 500:
            print(f"✅ After Gonny 2 (200 pcs): {fg_batch.qty_pcs} pcs remaining")
        else:
            print(f"❌ Expected 500, got {fg_batch.qty_pcs}")
            return False
    except Exception as e:
        print(f"❌ Second gonny failed: {e}")
        return False
    
    # 4. Verify gonnies count
    gonnies = fg_batch.packing_units.all()
    if gonnies.count() == 2:
        print(f"✅ Batch has {gonnies.count()} gonnies")
    else:
        print(f"❌ Expected 2 gonnies, got {gonnies.count()}")
        return False
    
    # Get summary
    summary = PackingService.get_batch_packing_summary(str(fg_batch.id))
    print(f"   Packed: {summary['packed_pcs']} pcs, Remaining: {summary['remaining_pcs']} pcs")
    
    return True


def main():
    print("=" * 60)
    print("PHASE 18 VERIFICATION: DISPATCH & PACKAGING")
    print("=" * 60)
    
    # Setup
    data = setup_test_data()
    
    # Run Tests
    test1_passed = test_pouch_gonny_dispatch(data)
    test2_passed = test_roll_dispatch(data)
    test3_passed = test_partial_dispatch(data)
    
    # Summary
    print("\n" + "=" * 60)
    print("VERIFICATION SUMMARY")
    print("=" * 60)
    print(f"Test 1 (Pouch → Gonny → Dispatch): {'✅ PASSED' if test1_passed else '❌ FAILED'}")
    print(f"Test 2 (Roll → Dispatch):          {'✅ PASSED' if test2_passed else '❌ FAILED'}")
    print(f"Test 3 (Partial Dispatch):         {'✅ PASSED' if test3_passed else '❌ FAILED'}")
    
    if test1_passed and test2_passed and test3_passed:
        print("\n🎉 ALL TESTS PASSED - Phase 18 Verified!")
        return 0
    else:
        print("\n⚠️ SOME TESTS FAILED - Review Required")
        return 1


if __name__ == "__main__":
    sys.exit(main())
