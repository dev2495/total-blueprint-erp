import os
import django
import sys
from decimal import Decimal
import uuid

# Setup Django Environment
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.factory.models import Plant, Process, WorkCenter, WorkCenterProcess
from apps.materials.models import InventoryMaterial
from apps.recipes.models import ExtrusionRecipe, RecipeGrade, ExtrusionRecipeComponent
from apps.routing.models import RoutingRule
from apps.templates.models import TemplateBlueprint
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.sales.services import SalesOrderService
from apps.templates.services import TemplateGovernanceService
from apps.production.models import ProductionJob
from django.utils import timezone
from django.core.exceptions import ValidationError

def run_test():
    print(">>> Phase 14 Verification: Sales Order Backend Rebuild")

    # 1. Setup Master Data
    print("\n--- 1. Setup Master Data ---")
    plant, _ = Plant.objects.get_or_create(code="PLANT-01", defaults={'name': 'Main Plant'})
    
    # Materials
    pe_family, _ = InventoryMaterial.objects.get_or_create(
        code="FF-PE", defaults={'name': 'Polyethylene Family', 'category': 'FILM_FAMILY', 'base_uom': 'KG', 'density_gcm3': 0.92}
    )
    ldpe_variant, _ = InventoryMaterial.objects.get_or_create(
        code="FV-LDPE-50", defaults={'name': 'LDPE 50mic', 'category': 'FILM_VARIANT', 'base_uom': 'KG', 'parent_family': pe_family, 'is_extrudable': True}
    )
    granule, _ = InventoryMaterial.objects.get_or_create(
        code="GR-LDPE-GEN", defaults={'name': 'LDPE General', 'category': 'GRANULE', 'base_uom': 'KG'}
    )
    ink, _ = InventoryMaterial.objects.get_or_create(
        code="INK-POLY", defaults={'name': 'Poly Ink', 'category': 'INK', 'base_uom': 'KG'}
    )
    adh, _ = InventoryMaterial.objects.get_or_create(
        code="AD-ADHESIVE", defaults={'name': 'Lami Adhesive', 'category': 'ADHESIVE', 'base_uom': 'KG'}
    )
    sol, _ = InventoryMaterial.objects.get_or_create(
        code="AD-SOLVENT", defaults={'name': 'Solvent', 'category': 'SOLVENT', 'base_uom': 'KG'}
    )
    zipper, _ = InventoryMaterial.objects.get_or_create(
        code="ADD-ZIP-01", defaults={'name': 'Zipper 10mm', 'category': 'ADDON', 'base_uom': 'PCS', 'weight_mode': 'PER_MM', 'weight_value': 0.05}
    )

    grade, _ = RecipeGrade.objects.get_or_create(name="GENERAL")
    
    # Recipe
    recipe, _ = ExtrusionRecipe.objects.get_or_create(
        film_variant=ldpe_variant,
        grade=grade,
        thickness_min_micron=40,
        thickness_max_micron=60,
        defaults={'is_active': True}
    )
    ExtrusionRecipeComponent.objects.get_or_create(recipe=recipe, granule=granule, defaults={'percentage': 100})

    # Processes
    ext_proc, _ = Process.objects.get_or_create(code="EXTRUSION", defaults={'name': 'Extrusion', 'input_mode': 'QUANTITY', 'output_mode': 'ROLL'})
    prn_proc, _ = Process.objects.get_or_create(code="PRINTING", defaults={'name': 'Printing', 'input_mode': 'ROLL', 'output_mode': 'ROLL'})
    bag_proc, _ = Process.objects.get_or_create(code="BAGGING", defaults={'name': 'Bagging', 'input_mode': 'ROLL', 'output_mode': 'QUANTITY'})

    # Work Centers
    ext_wc, _ = WorkCenter.objects.get_or_create(code="EXT-01", defaults={'name': 'Extruder 1', 'plant': plant})
    WorkCenterProcess.objects.get_or_create(work_center=ext_wc, process=ext_proc)
    
    bag_wc, _ = WorkCenter.objects.get_or_create(code="BAG-01", defaults={'name': 'Bag Maker 1', 'plant': plant})
    WorkCenterProcess.objects.get_or_create(work_center=bag_wc, process=bag_proc)

    # Routing Rule
    routing, _ = RoutingRule.objects.get_or_create(
        name="POUCH-STD",
        defaults={'ordered_processes': ["EXTRUSION", "BAGGING"]}
    )

    print("Master Data Seeding Completed.")

    # 2. Test Preview
    print("\n--- 2. Test Sales Preview ---")
    preview_payload = {
        "finished_good_type": "POUCH",
        "geometry": {
            "base": {"width_mm": 200, "height_mm": 300},
            "adjustments": [{"name": "Bottom Gusset", "value": 50, "impact": "HEIGHT"}]
        },
        "film_layers": [
            {"variant_id": str(ldpe_variant.id), "thickness_micron": 50, "grade_id": str(grade.id), "density_g_cm3": 0.92}
        ],
        "is_printing_enabled": False,
        "addons": [
            {"addon_id": str(zipper.id), "applies_to": "WIDTH", "weight_mode": "PER_MM", "weight_value": 0.05}
        ],
        "order_qty": 1000,
        "uom": "PCS"
    }
    
    preview = SalesOrderService.preview_sales_item(preview_payload)
    print(f"Preview Unit Weight: {preview['unit_weight_g']}g")
    print(f"Preview Total Weight: {preview['total_weight_kg']}kg")
    
    # Area = 200 * (300+50) * 2 = 140,000 mm2 = 0.14 m2
    # Film Weight = 0.14 * 50 * 0.92 = 6.44g
    # Addon Weight = 0.05 * 200 = 10g
    # Total = 16.44g
    assert abs(preview['unit_weight_g'] - 16.44) < 0.01
    assert abs(preview['total_weight_kg'] - 16.44) < 0.01 # 16.44g * 1000 / 1000 = 16.44kg
    print("Preview math validated.")

    # 3. Test Custom Order & Auto-Template
    print("\n--- 3. Test Custom Order ---")
    custom_payload = {
        "customer_name": "Test Customer",
        "name": "Custom Pouch X",
        "fg_type": "POUCH",
        "geometry": preview_payload['geometry'],
        "film_layers": preview_payload['film_layers'],
        "printing": {"enabled": False},
        "addons": preview_payload['addons'],
        "qty_uom": "PCS",
        "qty_value": 1000
    }
    
    order = SalesOrderService.create_custom_order(custom_payload)
    print(f"Custom Order Created: {order.order_number}, Status: {order.status}")
    assert order.status == 'ON_HOLD'
    
    item = order.items.first()
    template = item.template
    print(f"Auto-created Template: {template.name}, Status: {template.status}")
    assert template.status == 'DRAFT'
    assert template.created_from == 'CUSTOM_ORDER'

    # 4. Test Confirmation Blocking
    print("\n--- 4. Test Confirmation Blocking ---")
    try:
        SalesOrderService.confirm_sales_order(order.id)
        print("Error: Confirmation should have failed (Template not LIVE)")
        sys.exit(1)
    except ValidationError as e:
        print(f"Expected failure: {e}")

    # 5. Test Template Governance
    print("\n--- 5. Test Template Governance ---")
    # Assign Routing
    template.routing_rule = routing
    template.save()
    
    TemplateGovernanceService.approve_template(template.id)
    template.refresh_from_db()
    print(f"Template Status after approve: {template.status}")
    assert template.status == 'APPROVED'
    
    TemplateGovernanceService.publish_template(template.id)
    template.refresh_from_db()
    print(f"Template Status after publish: {template.status}")
    assert template.status == 'LIVE'

    # 6. Test Confirmation & Snapshot
    print("\n--- 6. Test Confirmation & Snapshots ---")
    SalesOrderService.confirm_sales_order(order.id)
    order.refresh_from_db()
    item.refresh_from_db()
    print(f"Order Status after confirmation: {order.status}")
    assert order.status == 'CONFIRMED'
    
    print(f"Item Unit Weight: {item.unit_weight_g}g")
    assert item.unit_weight_g > 0
    assert item.geometry_snapshot['effective_height_mm'] == 350 # 300 + 50
    print("Snapshots confirmed.")

    # 7. Test Job Generation
    print("\n--- 7. Test Job Generation ---")
    jobs = ProductionJob.objects.filter(sales_order_item=item).order_by('routing_step_index')
    print(f"Generated {jobs.count()} production jobs.")
    assert jobs.count() == 2
    
    for job in jobs:
        print(f"Job: {job.job_number} | Process: {job.process.code} | Qty: {job.quantity} {job.uom}")
        assert job.origin == 'MTO'
        assert job.quantity == 1000
        assert job.status == 'QUEUED'

    print("\n>>> Phase 14 Verification SUCCESS!")

if __name__ == "__main__":
    try:
        with django.db.transaction.atomic():
            run_test()
    except Exception as e:
        print(f"\nFailed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
