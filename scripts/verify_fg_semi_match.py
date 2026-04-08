import os
import sys
import uuid
import django
from decimal import Decimal

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings_script')
os.environ.setdefault("SKIP_ADMIN_APP_IMPORT", "1")
django.setup()

from apps.templates.models import TemplateBlueprint
from apps.inventory.models import InventoryRoll, InventoryLocation
from apps.factory.models import Plant
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.production.views_planner import PlannerViewSet
from apps.physics.spec_signature import build_spec_payload, build_spec_signature, build_invariant_payload, build_invariant_signature

def run_verification():
    print("🚀 Starting FG and Semi-FG Matching Verification")
    
    template = TemplateBlueprint.objects.first()
    if not template:
        print("❌ No templates found. Run seeds first.")
        return
        
    plant, _ = Plant.objects.get_or_create(name="Test Plant", defaults={"code": "TEST-PLT"})
    location, _ = InventoryLocation.objects.get_or_create(
        name="Test Location", 
        plant=plant,
        defaults={"code": "TEST-LOC"}
    )

    # Simulate payloads
    fake_variant_id = str(uuid.uuid4())
    fake_family_id = str(uuid.uuid4())
    layer_snapshot = [{"family_id": fake_family_id, "variant_id": fake_variant_id, "thickness_micron": 50}]
    printing_snapshot = {"enabled": False}
    
    # 1. Exact FG Setup
    geom_fg = {"width_mm": 100, "height_mm": 200}
    spec_payload_fg = build_spec_payload(
        fg_type="POUCH", roll_form="", geometry=geom_fg, 
        film_layers=layer_snapshot, printing=printing_snapshot, addons=[]
    )
    spec_sig_fg = build_spec_signature(spec_payload_fg)
    
    print("\n--- 1. Testing Exact FG Match ---")
    route_last_idx = len(template.routing_rule.ordered_processes) - 1 if template.routing_rule else 3
    
    fg_roll = InventoryRoll.objects.create(
        label_id=f"TEST-FG-{uuid.uuid4().hex[:6]}",
        template=template,
        status="AVAILABLE",
        weight_kg=Decimal("150.00"),
        width_mm=100,
        thickness_micron=50,
        completed_step_index=route_last_idx,
        location=location,
        meta_json={"spec_signature": spec_sig_fg}
    )
    
    so_fg = SalesOrder.objects.create(customer_name="Test FG Customer", status="PLANNING_REQUIRED")
    so_item_fg = SalesOrderItem.objects.create(
        sales_order=so_fg,
        template=template,
        qty_value=100,
        spec_signature=spec_sig_fg,
        geometry_snapshot=geom_fg,
        layer_snapshot=layer_snapshot
    )
    
    planner = PlannerViewSet()
    options_fg = planner._eligible_inventory_for_order(
        order_kind="sales",
        order_obj=so_fg,
        template=template,
        order_signature=spec_sig_fg,
        order_invariant_signature="",
        required_start_step=route_last_idx,
        route_last_index=route_last_idx,
        roll_alloc_map={},
        fg_alloc_map={},
        order_layer_snapshot=layer_snapshot
    )
    
    if any(opt['inventory_id'] == str(fg_roll.id) and opt['is_final_step'] for opt in options_fg):
        print("✅ Exact FG Roll matched correctly in eligible inventory.")
    else:
        print("❌ Failed to match Exact FG Roll.")


    # 2. Semi-FG (WIP) Setup
    geom_order2 = {"width_mm": 120, "height_mm": 200} # Different width
    spec_payload_semi = build_spec_payload(
        fg_type="POUCH", roll_form="", geometry=geom_order2, 
        film_layers=layer_snapshot, printing=printing_snapshot, addons=[]
    )
    spec_sig_semi = build_spec_signature(spec_payload_semi)
    
    inv_payload = build_invariant_payload(film_layers=layer_snapshot, printing=printing_snapshot)
    inv_sig = build_invariant_signature(inv_payload)
    
    print("\n--- 2. Testing Semi-FG (Invariant) Match ---")
    semi_roll = InventoryRoll.objects.create(
        label_id=f"TEST-SEMI-{uuid.uuid4().hex[:6]}",
        template=template,
        status="AVAILABLE",
        weight_kg=Decimal("200.00"),
        width_mm=120,
        thickness_micron=50,
        completed_step_index=0,
        location=location,
        meta_json={
            "spec_signature": "SOME-OTHER-SIG-THAT-DOESNT-MATCH-ORDER2",
            "invariant_signature": inv_sig
        }
    )
    
    so_semi = SalesOrder.objects.create(customer_name="Test Semi Customer", status="PLANNING_REQUIRED")
    so_item_semi = SalesOrderItem.objects.create(
        sales_order=so_semi,
        template=template,
        qty_value=150,
        spec_signature=spec_sig_semi,
        invariant_signature=inv_sig,
        geometry_snapshot=geom_order2,
        layer_snapshot=layer_snapshot
    )
    
    options_semi = planner._eligible_inventory_for_order(
        order_kind="sales",
        order_obj=so_semi,
        template=template,
        order_signature=spec_sig_semi,
        order_invariant_signature=inv_sig,
        required_start_step=0,
        route_last_index=route_last_idx,
        roll_alloc_map={},
        fg_alloc_map={},
        order_layer_snapshot=layer_snapshot
    )
    matching_semi = [opt for opt in options_semi if opt['inventory_id'] == str(semi_roll.id)]
    
    if matching_semi and not matching_semi[0]['is_final_step']:
        print("✅ Semi-FG Roll matched correctly via invariant signature!")
    else:
        print("❌ Failed to match Semi-FG Roll via invariant signature.")
        
    print("\n✨ Verification Complete!")

if __name__ == "__main__":
    run_verification()
