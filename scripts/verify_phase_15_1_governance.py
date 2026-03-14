import os
import sys
import django
import uuid
from decimal import Decimal
from pathlib import Path

# Add project root to sys.path
root_path = Path(__file__).resolve().parent.parent
sys.path.append(str(root_path))

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.templates.models import TemplateBlueprint
from apps.sales.services.order_service import SalesOrderService
from apps.sales.models import SalesOrder
from apps.users.models import User, Role
from django.core.exceptions import ValidationError
from apps.routing.models import RoutingRule
from apps.factory.models import Process

def verify_governance():
    print("--- Verifying Phase 15.1 Governance ---")
    
    # 0. Setup User and Routing
    role, _ = Role.objects.get_or_create(role_code='ENGINEER', defaults={'name': 'Engineer'})
    user, _ = User.objects.get_or_create(username='testengineer', defaults={'role': role})
    p1, _ = Process.objects.get_or_create(code='EXT', name='Extrusion')
    rule, _ = RoutingRule.objects.get_or_create(name='Test Rule', defaults={'ordered_processes': ['EXT']})

    # 1. Create Custom Order (Creates DRAFT Template)
    payload = {
        "customer_name": "Test Customer",
        "name": "Custom Product",
        "fg_type": "POUCH",
        "geometry": {"base": {"width_mm": 100, "height_mm": 200}},
        "film_layers": [],
        "qty_value": 1000,
        "qty_uom": "KG"
    }
    
    order = SalesOrderService.create_custom_order(payload)
    item = order.items.first()
    template = item.template
    
    print(f"Custom Order Created: {order.order_number}, Status: {order.status}")
    print(f"Auto-created Template: {template.name}, Status: {template.status}, Requires Engineering: {template.requires_engineering}")
    
    assert template.status == 'DRAFT'
    assert template.requires_engineering == True
    
    # 2. Try to confirm (Should FAIL)
    print("Trying to confirm order with DRAFT template...")
    try:
        SalesOrderService.confirm_sales_order(order.id)
        print("ERROR: Confirmation should have failed!")
    except ValidationError as e:
        print(f"Success: Confirmation blocked as expected: {e}")

    # 3. Approve Template (DRAFT -> APPROVED)
    print("Approving template...")
    template.approve(user)
    print(f"Template Status: {template.status}")
    assert template.status == 'APPROVED'

    # 4. Try to confirm (Should STILL FAIL - needs LIVE)
    print("Trying to confirm order with APPROVED template...")
    try:
        SalesOrderService.confirm_sales_order(order.id)
        print("ERROR: Confirmation should have failed!")
    except ValidationError as e:
        print(f"Success: Confirmation blocked as expected: {e}")

    # 5. Publish Template (APPROVED -> LIVE)
    print("Publishing template...")
    template.routing_rule = rule
    template.publish()
    print(f"Template Status: {template.status}")
    assert template.status == 'LIVE'

    # 6. Confirm Order (Should SUCCEED)
    print("Confirming order with LIVE template...")
    SalesOrderService.confirm_sales_order(order.id)
    order.refresh_from_db()
    print(f"Order Status: {order.status}")
    assert order.status == 'CONFIRMED'
    
    print("--- Governance Verification PASSED ---")

if __name__ == "__main__":
    verify_governance()
