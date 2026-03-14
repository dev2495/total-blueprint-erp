from django.db import transaction
from django.core.exceptions import ValidationError
from django.db.models import F
from apps.inventory.models import InventoryBulk, BulkTransaction, InventoryLocation
from apps.materials.models import InventoryMaterial

class BulkService:
    @classmethod
    @transaction.atomic
    def add_bulk(cls, material_id, qty, plant_id, location_id, cost=0, reference=""):
        """
        Increase bulk quantity and update average cost.
        Used by GRN and manual adjustments.
        """
        from decimal import Decimal
        qty = Decimal(str(qty))
        cost = Decimal(str(cost))
        
        if qty <= 0:
            raise ValidationError("Quantity to add must be positive.")

        bulk, created = InventoryBulk.objects.get_or_create(
            material_id=material_id,
            plant_id=plant_id,
            location_id=location_id,
            defaults={'qty_kg': 0, 'avg_cost': 0}
        )

        # Update Average Cost if cost is provided
        if cost > 0:
            total_value = (bulk.qty_kg * bulk.avg_cost) + (qty * cost)
            new_qty = bulk.qty_kg + qty
            bulk.avg_cost = total_value / new_qty
            bulk.qty_kg = new_qty
        else:
            bulk.qty_kg = F('qty_kg') + qty
        
        bulk.save()

        # Create Transaction
        return BulkTransaction.objects.create(
            material_id=material_id,
            location_id=location_id,
            type='INWARD',
            qty_kg=qty,
            avg_cost=cost if cost > 0 else bulk.avg_cost,
            reference=reference
        )

    @classmethod
    @transaction.atomic
    def consume_bulk(cls, material_id, qty, location_id, job_id=None, reference=""):
        """
        Deduct bulk quantity. Used by production.
        """
        from decimal import Decimal
        qty = Decimal(str(qty))
        
        if qty <= 0:
            raise ValidationError("Quantity to consume must be positive.")

        try:
            # We filter by location_id only as plant is implied by location
            bulk = InventoryBulk.objects.get(material_id=material_id, location_id=location_id)
        except InventoryBulk.DoesNotExist:
            raise ValidationError(f"No stock found for material {material_id} at location {location_id}.")

        if bulk.qty_kg < qty:
            raise ValidationError(f"Insufficient stock for {material_id}. Requested: {qty}, Available: {bulk.qty_kg}")

        bulk.qty_kg = F('qty_kg') - qty
        bulk.save()

        # Create Transaction
        return BulkTransaction.objects.create(
            material_id=material_id,
            location_id=location_id,
            type='CONSUME',
            qty_kg=-qty,
            avg_cost=bulk.avg_cost,
            reference=reference,
            job_id=job_id
        )

    @classmethod
    @transaction.atomic
    def transfer_bulk(cls, material_id, qty, from_location_id, to_location_id, reference=""):
        """
        Transfer bulk between locations.
        """
        if qty <= 0:
            raise ValidationError("Quantity to transfer must be positive.")

        # Deduct from source
        cls.consume_bulk(material_id, qty, from_location_id, reference=f"Transfer Out: {reference}")

        # Add to destination
        from_loc = InventoryLocation.objects.get(id=from_location_id)
        to_loc = InventoryLocation.objects.get(id=to_location_id)
        
        # Get source cost for destination (simplification: assume cost follows movement)
        source_bulk = InventoryBulk.objects.get(material_id=material_id, location_id=from_location_id)
        
        cls.add_bulk(material_id, qty, to_loc.plant_id, to_location_id, cost=source_bulk.avg_cost, reference=f"Transfer In: {reference}")

    @classmethod
    @transaction.atomic
    def adjust_bulk(cls, material_id, qty, location_id, adj_type='ADJUST', reference=""):
        """
        Manual adjustment of bulk stock. qty can be positive or negative.
        """
        location = InventoryLocation.objects.get(id=location_id)
        
        if qty > 0:
            cls.add_bulk(material_id, qty, location.plant_id, location_id, reference=reference)
        elif qty < 0:
            cls.consume_bulk(material_id, abs(qty), location_id, reference=reference)
        
        # Override transaction type to ADJUST if it was just created
        tx = BulkTransaction.objects.filter(material_id=material_id, location_id=location_id, reference=reference).first()
        if tx:
            tx.type = 'ADJUST'
            tx.save()
