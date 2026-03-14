#!/usr/bin/env python
"""
Phase 68 Verification Script: Universal Flow Engine

Tests the core Phase 68 fields and API methods:
1. Process model has rolls_required and modifies_existing_roll fields
2. ExecutionService methods are callable

Run with:
    cd /Users/devarshthakkar/Documents/total_blueprint_erp
    source venv_311/bin/activate
    python scripts/verify_phase_68.py
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
from apps.factory.models import Process
from apps.production.services.services_execution import ExecutionService
import uuid

def verify_process_model_fields():
    """Verify Phase 68 fields exist on Process model"""
    print("\n[TEST 1] Verifying Process Model Phase 68 Fields...")
    
    # Check that fields exist on model
    field_names = [f.name for f in Process._meta.get_fields()]
    
    assert 'rolls_required' in field_names, "rolls_required field not found on Process model"
    assert 'modifies_existing_roll' in field_names, "modifies_existing_roll field not found on Process model"
    
    print(f"   ✓ rolls_required field exists")
    print(f"   ✓ modifies_existing_roll field exists")
    
    # Create a test process to verify defaults
    test_code = f"P68_TEST_{uuid.uuid4().hex[:6]}"
    process = Process.objects.create(
        code=test_code,
        name="Phase 68 Test Process",
        input_form='ROLL',
        output_form='ROLL'
    )
    
    assert process.rolls_required == 1, f"Default rolls_required should be 1, got {process.rolls_required}"
    assert process.modifies_existing_roll == False, f"Default modifies_existing_roll should be False"
    
    print(f"   ✓ Default rolls_required = 1")
    print(f"   ✓ Default modifies_existing_roll = False")
    
    # Cleanup
    process.delete()
    print(f"   ✓ Cleanup complete")

def verify_execution_service_methods():
    """Verify ExecutionService has Phase 68 methods"""
    print("\n[TEST 2] Verifying ExecutionService Phase 68 Methods...")
    
    # Check that methods exist
    assert hasattr(ExecutionService, 'get_wip_pool'), "get_wip_pool method missing"
    assert hasattr(ExecutionService, 'get_wip_pool_grouped'), "get_wip_pool_grouped method missing"
    assert hasattr(ExecutionService, 'get_satisfaction_status'), "get_satisfaction_status method missing"
    assert hasattr(ExecutionService, 'auto_satisfy_inputs'), "auto_satisfy_inputs method missing"
    
    print(f"   ✓ get_wip_pool() exists")
    print(f"   ✓ get_wip_pool_grouped() exists")
    print(f"   ✓ get_satisfaction_status() exists")
    print(f"   ✓ auto_satisfy_inputs() exists")

def verify_process_field_values():
    """Test that different process configurations work correctly"""
    print("\n[TEST 3] Verifying Process Field Configurations...")
    
    test_prefix = f"P68_V_{uuid.uuid4().hex[:6]}"
    
    try:
        # Create test processes with different configurations
        extrusion = Process.objects.create(
            code=f"{test_prefix}_EXT",
            name=f"{test_prefix} Extrusion",
            input_form='BULK',
            output_form='ROLL',
            rolls_required=0,
            modifies_existing_roll=False
        )
        
        printing = Process.objects.create(
            code=f"{test_prefix}_PRINT",
            name=f"{test_prefix} Printing",
            input_form='ROLL',
            output_form='ROLL',
            rolls_required=1,
            modifies_existing_roll=True
        )
        
        lamination = Process.objects.create(
            code=f"{test_prefix}_LAM",
            name=f"{test_prefix} Lamination",
            input_form='ROLL',
            output_form='ROLL',
            rolls_required=2,
            modifies_existing_roll=False
        )
        
        assert extrusion.rolls_required == 0, "Extrusion should require 0 rolls"
        assert extrusion.modifies_existing_roll == False
        print(f"   ✓ Extrusion: rolls_required=0, modifies=False")
        
        assert printing.rolls_required == 1
        assert printing.modifies_existing_roll == True, "Printing should modify roll"
        print(f"   ✓ Printing: rolls_required=1, modifies=True")
        
        assert lamination.rolls_required == 2, "Lamination should require 2 rolls"
        assert lamination.modifies_existing_roll == False
        print(f"   ✓ Lamination: rolls_required=2, modifies=False")
        
    finally:
        # Cleanup
        Process.objects.filter(code__startswith=test_prefix).delete()
        print(f"   ✓ Cleanup complete")

def verify_api_endpoints_registered():
    """Verify that the new API endpoints are registered"""
    print("\n[TEST 4] Verifying API Endpoint Registration...")
    
    from apps.production.urls import router
    
    # Get all registered viewsets and their basenames
    # router.registry is a list of (prefix, viewset, basename) tuples
    registered_basenames = [r[2] for r in router.registry]
    
    assert 'flow-engine' in registered_basenames, f"flow-engine endpoint not registered. Found: {registered_basenames}"
    print(f"   ✓ flow-engine endpoint registered")
    
    # Check that ExecutionViewSet is importable
    from apps.production.views import ExecutionViewSet
    assert ExecutionViewSet is not None
    print(f"   ✓ ExecutionViewSet imported successfully")

def main():
    print("\n" + "="*60)
    print("Phase 68 Verification: Universal Flow Engine")
    print("="*60)
    
    try:
        verify_process_model_fields()
        verify_execution_service_methods()
        verify_process_field_values()
        verify_api_endpoints_registered()
        
        print("\n" + "="*60)
        print("✅ ALL PHASE 68 TESTS PASSED!")
        print("="*60 + "\n")
        
    except AssertionError as e:
        print(f"\n❌ TEST FAILED: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ UNEXPECTED ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
