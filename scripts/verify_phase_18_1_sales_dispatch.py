import os
import django
import sys
import uuid
from decimal import Decimal
from django.utils import timezone

# Set up Django
sys.path.append('/Users/devarshthakkar/Documents/total_blueprint_erp')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.materials.models import InventoryMaterial
from apps.inventory.models import InventoryLocation, InventoryRoll, InventoryLedger
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.production.models import ProductionJob, TemplateBlueprint, FinishedGoodsBatch, PackingUnit, DeliveryChallan, DeliveryChallanItem
from apps.production.services.operator_service import OperatorService
from apps.production.services.packing_service import PackingService
from apps.production.services.dispatch_service import FGDispatchService
from apps.factory.models import Plant
from django.contrib.auth import get_user_model

def verify_sales_dispatch():
    print("🚀 Starting Phase 18.1: Sales Order Driven Dispatch Verification")
    
    # 1. Setup Data
    User = get_user_model()
    user = User.objects.first()
    plant = Plant.objects.first()
    if not plant:
        plant = Plant.objects.create(name="Test Plant", code="TP01")
    
    # Locations
    wh_location, _ = InventoryLocation.objects.get_or_create(
        name="Main Warehouse", 
        defaults={'plant': plant, 'type': 'WAREHOUSE', 'code': 'WH-MAIN'}
    )
    transit_location, _ = InventoryLocation.objects.get_or_create(
        name="In Transit", 
        defaults={'plant': plant, 'type': 'TRANSIT', 'code': 'TR-MAIN'}
    )
    
    # 2. Create Sales Order
    print("📝 Creating Sales Order...")
    so = SalesOrder.objects.create(
        order_number=f"SO-V-{uuid.uuid4().hex[:6].upper()}",
        customer_name="Global Retailers Inc",
        status='CONFIRMED',
        delivery_date=timezone.now() + timezone.timedelta(days=7)
    )
    
    # Multi-product order: 1 Pouch product, 1 Roll product
    material_pouch, _ = InventoryMaterial.objects.get_or_create(
        code="FG-POUCH-TEST",
        defaults={'name': 'Test Pouch FG', 'category': 'FILM_VARIANT', 'base_uom': 'PCS'}
    )
    material_roll, _ = InventoryMaterial.objects.get_or_create(
        code="FG-ROLL-TEST",
        defaults={'name': 'Test Roll FG', 'category': 'FILM_VARIANT', 'base_uom': 'KG'}
    )
    
    from apps.routing.models import RoutingRule
    routing_rule, _ = RoutingRule.objects.get_or_create(
        name="Test Routing",
        defaults={'ordered_processes': ['EXTRUSION', 'PRINTING', 'SLITTING', 'PACKING']}
    )

    # Create Templates
    template_pouch, _ = TemplateBlueprint.objects.get_or_create(
        name="Test Pouch Template",
        fg_type='POUCH',
        defaults={'status': 'LIVE', 'routing_rule': routing_rule}
    )
    template_roll, _ = TemplateBlueprint.objects.get_or_create(
        name="Test Roll Template",
        fg_type='ROLL',
        defaults={'status': 'LIVE', 'routing_rule': routing_rule}
    )

    so_item_pouch = SalesOrderItem.objects.create(
        sales_order=so,
        template=template_pouch,
        qty_value=5000,
        qty_uom='PCS'
    )
    
    so_item_roll = SalesOrderItem.objects.create(
        sales_order=so,
        template=template_roll,
        qty_value=500,
        qty_uom='KG'
    )
    
    # 3. Create Production Jobs linked to SO
    print("🏗️ Creating Production Jobs...")
    
    job_pouch = ProductionJob.objects.create(
        job_number=f"JOB-P-{uuid.uuid4().hex[:4].upper()}",
        template=template_pouch,
        sales_order_item=so_item_pouch,
        quantity=5000,
        uom='PCS',
        status='RUNNING',
        job_state='EXECUTING',
        routing_rule=template_pouch.routing_rule
    )
    
    job_roll = ProductionJob.objects.create(
        job_number=f"JOB-R-{uuid.uuid4().hex[:4].upper()}",
        template=template_roll,
        sales_order_item=so_item_roll,
        quantity=500,
        uom='KG',
        status='RUNNING',
        job_state='EXECUTING',
        routing_rule=template_roll.routing_rule
    )
    
    # 4. Produce FG (Verify auto-linkage to SO)
    print("🏭 Producing Finished Goods...")
    # Produce Pouch FG
    job_pouch.to_location = wh_location
    job_pouch.save()
    OperatorService._create_finished_goods(job_pouch, qty=Decimal('5000'))
    fg_batch = FinishedGoodsBatch.objects.filter(production_job=job_pouch).first()
    
    assert fg_batch.sales_order_item == so_item_pouch, "❌ FG Batch not linked to SO Item"
    print(f"✅ Produced Pouch FG Batch {fg_batch.batch_number} (Linked to SO)")
    
    # Produce Roll FG
    job_roll.to_location = wh_location
    job_roll.save()
    OperatorService._create_finished_goods(job_roll, qty=Decimal('250'))
    fg_roll = InventoryRoll.objects.filter(production_job=job_roll).first()
    
    assert fg_roll.sales_order_item == so_item_roll, "❌ FG Roll not linked to SO Item"
    print(f"✅ Produced FG Roll {fg_roll.label_id} (Linked to SO)")
    
    # 5. Packing (Create Gonnies)
    print("📦 Packing Pouch FG into Gonnies...")
    gonny1 = PackingService.create_gonny(str(fg_batch.id), qty_pcs=2500, user=user)
    gonny2 = PackingService.create_gonny(str(fg_batch.id), qty_pcs=2500, user=user)
    
    # Seal Gonnies
    PackingService.seal_gonny(str(gonny1.id), weight_kg=Decimal('60.2'), user=user)
    PackingService.seal_gonny(str(gonny2.id), weight_kg=Decimal('60.3'), user=user)
    
    # 6. Verify Dispatchable Summary Service
    print("📊 Verifying Dispatchable Summary Service...")
    summary = FGDispatchService.get_dispatchable_units_by_so(str(so.id))
    
    assert summary['ordered_qty'] == 5500, f"❌ Wrong ordered qty: {summary['ordered_qty']}"
    assert summary['produced_qty']['batches_pcs'] == 5000, "❌ Wrong produced batch qty"
    assert summary['packed_qty'] == 5000, "❌ Wrong packed qty"
    assert len(summary['rolls']) == 1, "❌ Roll missing from summary"
    assert len(summary['gonnies']) == 2, "❌ Gonnies missing from summary"
    print("✅ Dispatch summary verified")
    
    # 7. Create Delivery Challan
    print("🚚 Creating Delivery Challan for Partial Dispatch...")
    # Dispatch 1 Roll and 1 Gonny
    challan = FGDispatchService.create_challan(
        customer_name=so.customer_name,
        plant_id=str(plant.id),
        sales_order_id=str(so.id),
        vehicle_no="MH-04-ET-9988",
        roll_ids=[str(fg_roll.id)],
        gonny_ids=[str(gonny1.id)],
        user=user
    )
    assert challan.sales_order == so, "❌ Challan not linked to SO"
    assert challan.items.count() == 2, "❌ Challan missing items"
    print(f"✅ Delivery Challan {challan.dc_no} created")
    
    # Create another SO
    so2, _ = SalesOrder.objects.get_or_create(
        order_number="SO-OTHER", 
        defaults={'customer_name': "Other", 'status': 'CONFIRMED'}
    )
    so2_item = SalesOrderItem.objects.create(sales_order=so2, template=template_roll, qty_value=100)
    job2 = ProductionJob.objects.create(
        job_number=f"JOB-OTHER-{uuid.uuid4().hex[:4].upper()}", 
        template=template_roll, 
        sales_order_item=so2_item, 
        quantity=100, 
        routing_rule=template_roll.routing_rule
    )
    job2.to_location = wh_location
    job2.save()
    OperatorService._create_finished_goods(job2, qty=Decimal('50.0'))
    fg_roll_other = InventoryRoll.objects.filter(production_job=job2).first()
    
    try:
        FGDispatchService.create_challan(
            customer_name=so.customer_name,
            plant_id=str(plant.id),
            sales_order_id=str(so.id),
            roll_ids=[str(fg_roll_other.id)],
            user=user
        )
        print("❌ FAILED: Should have raised ValueError for SO mismatch")
    except ValueError as e:
        print(f"✅ Blocked cross-SO dispatch: {str(e)}")
    
    # 8. Dispatch & Transit tracking
    print("🛫 Dispatching Challan...")
    FGDispatchService.dispatch_challan(str(challan.id), user)
    challan.refresh_from_db()
    assert challan.status == 'DISPATCHED', "❌ Challan status not DISPATCHED"
    
    # Advance to IN_TRANSIT
    print("🛣️ Moving to IN_TRANSIT...")
    FGDispatchService.update_challan_status(str(challan.id), 'IN_TRANSIT', user)
    challan.refresh_from_db()
    assert challan.status == 'IN_TRANSIT', "❌ Challan status not IN_TRANSIT"
    
    # Finalize as DELIVERED
    print("🏁 Finalizing as DELIVERED...")
    FGDispatchService.update_challan_status(str(challan.id), 'DELIVERED', user)
    challan.refresh_from_db()
    assert challan.status == 'DELIVERED', "❌ Challan status not DELIVERED"
    assert challan.received_date is not None, "❌ Received date not set"
    
    # Verify Inventory status
    fg_roll.refresh_from_db()
    assert fg_roll.status == 'CONSUMED', "❌ Roll status not CONSUMED after delivery"
    
    print("\n✨ PHASE 18.1 VERIFICATION COMPLETE! ✨")

if __name__ == "__main__":
    verify_sales_dispatch()
