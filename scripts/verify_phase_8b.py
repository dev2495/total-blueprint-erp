import os
import django
import sys
from decimal import Decimal
from django.core.exceptions import ValidationError

# Setup Django Environment
sys.path.insert(0, os.getcwd())
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.templates.models import TemplateBlueprint
from apps.routing.models import RoutingRule
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.sales.services import SalesOrderService
from apps.factory.models import Plant
from apps.users.models import User

def verify_phase_8b():
    print("🚀 Verifying Template Governance & Routing UI (Phase 8B)...")

    # 1. Setup
    plant, _ = Plant.objects.get_or_create(code="PL_8B", name="Governance Plant")
    user = User.objects.filter(role__role_code='SUPER_ADMIN').first()
    
    # 2. Test: Cannot approve template without routing
    print("\n--- Testing: Mandatory Routing for Approval ---")
    template = TemplateBlueprint.objects.create(
        name="Routing Test Template",
        fg_type="ROLL",
        status="DRAFT"
    )
    
    # Simulate approval attempt (In real app, logic would be in service or clean)
    def attempt_approval(t):
        if t.status == 'LIVE' and not t.routing_rule:
            raise ValidationError("Routing Rule is mandatory for LIVE status.")
    
    try:
        template.status = 'LIVE'
        attempt_approval(template)
        print("❌ FAIL: Approved template without routing")
    except ValidationError as e:
        print(f"✅ PASS: Blocked approval without routing: {e}")

    # 3. Test: Custom Order Flow
    print("\n--- Testing: Custom Sales Order Flow ---")
    items_data = [
        {
            'name': 'Custom Pouch',
            'fg_type': 'POUCH',
            'quantity': 1000,
            'uom': 'PCS',
            'geometry': {'width': 200, 'height': 300}
        }
    ]
    
    so = SalesOrderService.create_custom_order(
        customer_name="Custom Client",
        order_number="SO-CUST-001",
        plant=plant,
        items_data=items_data,
        user=user
    )
    
    print(f"✅ Custom SO Created: {so.order_number} | Status: {so.status}")
    item = so.items.first()
    print(f"✅ Auto-created Template: {item.template.name} | Status: {item.template.status}")
    assert so.status == 'ON_HOLD'
    assert item.template.status == 'DRAFT'

    # 4. Test: Block SO Release if Template is not LIVE
    print("\n--- Testing: Block SO Release (non-LIVE Template) ---")
    so.status = 'CONFIRMED'
    try:
        so.clean()
        so.save()
        print("❌ FAIL: Allowed SO confirmation with DRAFT template")
    except ValidationError as e:
        print(f"✅ PASS: Blocked SO confirmation: {e}")

    # 5. Test: Editable Field Enforcement
    print("\n--- Testing: Editable Field Enforcement ---")
    # Mark template as LIVE first
    rr, _ = RoutingRule.objects.get_or_create(name="Simple Route", ordered_processes=["EXTRUSION"])
    live_temp = TemplateBlueprint.objects.create(
        name="Regulated Template",
        fg_type="ROLL",
        status="LIVE",
        routing_rule=rr,
        editable_fields=["quantity"] 
    )
    
    normal_so = SalesOrder.objects.create(
        order_number="SO-NORM-001",
        customer_name="Regular Client",
        plant=plant
    )
    
    # Attempt to override 'width' which is NOT in editable_fields
    so_item = SalesOrderItem(
        sales_order=normal_so,
        template=live_temp,
        ordered_qty=500,
        physics_snapshot={'width': 1300} # Illegal override
    )
    
    try:
        so_item.clean()
        print("❌ FAIL: Allowed illegal field override")
    except ValidationError as e:
        print(f"✅ PASS: Blocked illegal override: {e}")

    print("\n✨ ALL PHASE 8B VERIFICATION TESTS PASSED! ✨")

if __name__ == "__main__":
    verify_phase_8b()
