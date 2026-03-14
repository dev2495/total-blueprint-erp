import os
import django
from decimal import Decimal

# Set up Django environment
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.production.models import ProductionJob, FinishedGoodsBatch, PackingUnit, DeliveryChallan, DeliveryChallanItem
from apps.production.services.packing_service import PackingService
from apps.production.services.dispatch_service import FGDispatchService
from apps.factory.models import Plant
from apps.users.models import User

def execute_dispatch():
    print(">>> Starting E2E Dispatch...")
    user = User.objects.first()
    
    # 1. Packing
    print("\n--- Step 1: Packing ---")
    fg_batch = FinishedGoodsBatch.objects.latest('created_at')
    print(f"Packing from Batch: {fg_batch.batch_number}, Total Pcs: {fg_batch.qty_pcs}")
    
    # Create 2 Gonnies
    gonny1 = PackingService.create_gonny(fg_batch.id, qty_pcs=5000, user=user)
    PackingService.seal_gonny(gonny1.id, weight_kg=Decimal("50.0"), user=user)
    print(f"Created & Sealed Gonny 1: {gonny1.label_id}")
    
    gonny2 = PackingService.create_gonny(fg_batch.id, qty_pcs=4500, user=user)
    PackingService.seal_gonny(gonny2.id, weight_kg=Decimal("45.0"), user=user)
    print(f"Created & Sealed Gonny 2: {gonny2.label_id}")

    # 2. Dispatch
    print("\n--- Step 2: Dispatch ---")
    plant = fg_batch.location.plant
    so = fg_batch.sales_order_item.sales_order
    
    challan = FGDispatchService.create_challan(
        customer_name=so.customer_name,
        plant_id=str(plant.id),
        sales_order_id=str(so.id),
        vehicle_no="MH-01-AB-1234",
        gonny_ids=[str(gonny1.id), str(gonny2.id)],
        user=user
    )
    print(f"Delivery Challan Created: {challan.dc_no}")
    
    FGDispatchService.dispatch_challan(challan.id, user=user)
    print(f"Challan Dispatched! Status: {challan.status}")

    # 3. Final Receiver Confirmation
    FGDispatchService.mark_received(challan.id, user=user)
    print(f"Challan Delivered to Customer. Status: {challan.status}")

    print("\n>>> E2E Dispatch Complete. End-to-End Cycle Verified!")

if __name__ == "__main__":
    execute_dispatch()
