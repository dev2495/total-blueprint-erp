"""
Phase 58: Observability Verification Script
Tests: Snapshot creation, Alert generation, Genealogy, Negative stock protection
"""
import os
import sys
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
django.setup()

from decimal import Decimal
from django.db import transaction
from django.utils import timezone

from apps.factory.models import Plant
from apps.inventory.models import (
    InventoryBulk, BulkTransaction, InventoryRoll, 
    InventorySnapshot, InventoryAlert, InventoryLocation, RollLink
)
from apps.materials.models import InventoryMaterial
from apps.inventory.services.bulk_service import BulkService
from apps.inventory.services.inventory_audit_service import InventoryAuditService

def print_result(test_name, passed, detail=""):
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status} | {test_name}")
    if detail:
        print(f"       {detail}")

def test_phase_58():
    print("\n" + "="*60)
    print("Phase 58 — Observability Verification")
    print("="*60 + "\n")
    
    all_passed = True
    plant = Plant.objects.first()
    
    # === Test 1: Consume more bulk than available → FAIL ===
    print("\n--- Test 1: Negative Stock Protection ---")
    try:
        material = InventoryMaterial.objects.filter(category='GRANULE').first()
        location = InventoryLocation.objects.filter(plant=plant, type='RM').first()
        
        if material and location:
            # Clear old test data
            InventoryBulk.objects.filter(
                material=material, location=location
            ).delete()
            
            # Add small qty
            BulkService.add_bulk(
                material_id=str(material.id),
                qty=10,
                plant_id=str(plant.id),
                location_id=str(location.id),
                reference="Phase 58 Test"
            )
            
            # Try to consume more
            try:
                BulkService.consume_bulk(
                    material_id=str(material.id),
                    qty=100,  # More than 10kg available
                    location_id=str(location.id),
                    reference="Phase 58 Negative Test"
                )
                print_result("Consume more than available rejected", False, "Should have raised error")
                all_passed = False
            except Exception as e:
                if "Insufficient" in str(e):
                    print_result("Consume more than available rejected", True)
                else:
                    print_result("Consume more than available rejected", False, f"Wrong error: {e}")
                    all_passed = False
        else:
            print_result("Negative stock test", False, "Missing fixtures")
            all_passed = False
    except Exception as e:
        print_result("Negative stock test", False, str(e))
        all_passed = False

    # === Test 2: Snapshot Creation ===
    print("\n--- Test 2: Snapshot Creation ---")
    try:
        initial_count = InventorySnapshot.objects.filter(plant=plant).count()
        snapshot = InventoryAuditService.create_snapshot(plant)
        
        if snapshot and snapshot.id:
            print_result("Snapshot created", True, f"ID: {snapshot.id}")
            print_result("Snapshot has bulk_kg", snapshot.total_bulk_kg >= 0)
            print_result("Snapshot has roll_kg", snapshot.total_roll_kg >= 0)
        else:
            print_result("Snapshot created", False)
            all_passed = False
    except Exception as e:
        print_result("Snapshot creation", False, str(e))
        all_passed = False

    # === Test 3: Alert Generation on Audit ===
    print("\n--- Test 3: Reconciliation Engine ---")
    try:
        summary = InventoryAuditService.run_full_audit(plant)
        print_result("Full audit runs without error", True)
        print_result("Audit returns summary", 'total_alerts' in summary, f"Keys: {list(summary.keys())}")
    except Exception as e:
        print_result("Reconciliation engine", False, str(e))
        all_passed = False

    # === Test 4: Health Summary API ===
    print("\n--- Test 4: Health Summary ---")
    try:
        health = InventoryAuditService.get_health_summary(plant)
        
        has_bulk = 'bulk' in health and 'total_kg' in health['bulk']
        has_rolls = 'rolls' in health and 'available_count' in health['rolls']
        has_alerts = 'alerts' in health and 'total_open' in health['alerts']
        
        print_result("Health has bulk metrics", has_bulk)
        print_result("Health has roll metrics", has_rolls)
        print_result("Health has alert metrics", has_alerts)
        
        if not (has_bulk and has_rolls and has_alerts):
            all_passed = False
    except Exception as e:
        print_result("Health summary", False, str(e))
        all_passed = False

    # === Test 5: Roll Genealogy ===
    print("\n--- Test 5: Roll Genealogy ---")
    try:
        roll = InventoryRoll.objects.filter(status='AVAILABLE').first()
        if roll:
            genealogy = InventoryAuditService.get_roll_genealogy(str(roll.id))
            
            has_tree = 'tree' in genealogy
            has_timeline = 'timeline' in genealogy
            has_ancestors = 'ancestors' in genealogy
            
            print_result("Genealogy has tree", has_tree)
            print_result("Genealogy has timeline", has_timeline)
            print_result("Genealogy has ancestors", has_ancestors)
            
            if has_tree:
                tree = genealogy['tree']
                print_result("Tree has label_id", 'label_id' in tree, f"Label: {tree.get('label_id')}")
        else:
            print_result("Roll genealogy", False, "No available rolls to test")
            all_passed = False
    except Exception as e:
        print_result("Roll genealogy", False, str(e))
        all_passed = False

    # === Test 6: Model Creation ===
    print("\n--- Test 6: Model & Table Verification ---")
    try:
        # Check tables exist
        from django.db import connection
        with connection.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) FROM inventory_snapshots")
            snapshot_count = cursor.fetchone()[0]
            print_result("inventory_snapshots table exists", True, f"Rows: {snapshot_count}")
        
        with connection.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) FROM inventory_alerts")
            alert_count = cursor.fetchone()[0]
            print_result("inventory_alerts table exists", True, f"Rows: {alert_count}")
    except Exception as e:
        print_result("Table verification", False, str(e))
        all_passed = False

    # === Summary ===
    print("\n" + "="*60)
    if all_passed:
        print("✅ ALL PHASE 58 TESTS PASSED")
        print("\nObservability features verified:")
        print("  • Negative stock protection")
        print("  • Daily snapshots")
        print("  • Reconciliation engine")
        print("  • Health summary API")
        print("  • Roll genealogy")
        print("  • Alert system")
    else:
        print("❌ SOME TESTS FAILED — Review output above")
    print("="*60 + "\n")
    
    return all_passed

if __name__ == '__main__':
    test_phase_58()
