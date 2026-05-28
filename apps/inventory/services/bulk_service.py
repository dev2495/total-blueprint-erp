from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Sum
from apps.inventory.models import InventoryBulk, BulkTransaction, InventoryLocation
from apps.inventory.services.wac import apply_wac, dec, q4
from apps.materials.models import GranuleQualityCode, InventoryMaterial

class BulkService:
    @classmethod
    def _resolve_granule_code(cls, material_id, granule_code_id=None):
        if not granule_code_id:
            return None
        material = InventoryMaterial.objects.only("id", "category").get(id=material_id)
        if str(material.category or "").upper() != "GRANULE":
            raise ValidationError("Quality codes are only valid for granule materials.")
        try:
            quality_code = GranuleQualityCode.objects.select_related("granule").get(id=granule_code_id)
        except (GranuleQualityCode.DoesNotExist, ValueError, TypeError):
            raise ValidationError("Selected granule quality code does not exist.")
        if str(quality_code.granule_id) != str(material_id):
            raise ValidationError("Selected granule quality code does not belong to the selected granule.")
        if str(quality_code.status or "").upper() != "ACTIVE":
            raise ValidationError("Selected granule quality code is inactive.")
        return quality_code

    @classmethod
    @transaction.atomic
    def add_bulk(cls, material_id, qty, plant_id, location_id, cost=0, reference="", tx_type="INWARD", job_id=None, granule_code_id=None, vendor_id=None, vendor_invoice_no="", manual_po_ref=""):
        """
        Increase bulk quantity and update average cost.
        Used by GRN and manual adjustments.
        """
        qty = q4(qty)
        cost = q4(cost)

        if qty <= 0:
            raise ValidationError("Quantity to add must be positive.")
        quality_code = cls._resolve_granule_code(material_id, granule_code_id)

        # Vendor invoice dedup (partial unique by vendor + vendor_invoice_no).
        if vendor_id and vendor_invoice_no:
            if BulkTransaction.objects.filter(
                vendor_id=vendor_id, vendor_invoice_no=vendor_invoice_no
            ).exists():
                raise ValidationError(
                    f"Duplicate vendor invoice '{vendor_invoice_no}' for this vendor."
                )

        bulk, created = InventoryBulk.objects.select_for_update().get_or_create(
            material_id=material_id,
            granule_code_id=quality_code.id if quality_code else None,
            plant_id=plant_id,
            location_id=location_id,
            defaults={'qty_kg': 0, 'avg_cost': 0}
        )

        resolved_rate = cost if cost > 0 else q4(bulk.avg_cost)
        new_qty, new_rate = apply_wac(
            balance_qty=bulk.qty_kg,
            balance_rate=bulk.avg_cost,
            delta_qty=qty,
            posting_rate=resolved_rate,
        )
        bulk.qty_kg = new_qty
        bulk.avg_cost = new_rate
        bulk.save(update_fields=["qty_kg", "avg_cost", "updated_at"])

        # Create Transaction
        return BulkTransaction.objects.create(
            material_id=material_id,
            granule_code_id=quality_code.id if quality_code else None,
            location_id=location_id,
            type=tx_type,
            qty_kg=qty,
            avg_cost=resolved_rate,
            reference=reference,
            job_id=job_id,
            vendor_id=vendor_id,
            vendor_invoice_no=vendor_invoice_no or "",
            manual_po_ref=(manual_po_ref or "").strip(),
        )

    @classmethod
    @transaction.atomic
    def consume_bulk(cls, material_id, qty, location_id, job_id=None, reference="", granule_code_id=None):
        """
        Deduct bulk quantity. Used by production.
        """
        qty = q4(qty)
        
        if qty <= 0:
            raise ValidationError("Quantity to consume must be positive.")
        quality_code = cls._resolve_granule_code(material_id, granule_code_id)

        qs = InventoryBulk.objects.select_for_update().filter(material_id=material_id, location_id=location_id)
        if quality_code:
            qs = qs.filter(granule_code=quality_code)
        # Keep the row lock on InventoryBulk only. Ordering through the nullable
        # granule_code relation produces an outer join that PostgreSQL cannot
        # lock with SELECT FOR UPDATE.
        qs = qs.filter(qty_kg__gt=0).order_by("granule_code_id", "updated_at", "id")
        available = qs.aggregate(total=Sum("qty_kg")).get("total") or Decimal("0")
        if available <= 0:
            raise ValidationError(f"No stock found for material {material_id} at location {location_id}.")
        if available < qty:
            code_label = f" / code {quality_code.code}" if quality_code else ""
            raise ValidationError(f"Insufficient stock for {material_id}{code_label}. Requested: {qty}, Available: {available}")

        remaining = qty
        last_tx = None
        for bulk in qs:
            take = q4(min(remaining, dec(bulk.qty_kg)))
            if take <= 0:
                continue
            bulk.qty_kg = q4(dec(bulk.qty_kg) - take)
            bulk.save(update_fields=['qty_kg', 'updated_at'])
            last_tx = BulkTransaction.objects.create(
                material_id=material_id,
                granule_code_id=bulk.granule_code_id,
                location_id=location_id,
                type='CONSUME',
                qty_kg=-take,
                avg_cost=q4(bulk.avg_cost),
                reference=reference,
                job_id=job_id
            )
            remaining = q4(remaining - take)
            if remaining <= 0:
                break

        return last_tx

    @classmethod
    @transaction.atomic
    def transfer_bulk(cls, material_id, qty, from_location_id, to_location_id, reference="", granule_code_id=None):
        """
        Transfer bulk between locations.
        """
        if qty <= 0:
            raise ValidationError("Quantity to transfer must be positive.")

        # Deduct from source
        cls.consume_bulk(material_id, qty, from_location_id, reference=f"Transfer Out: {reference}", granule_code_id=granule_code_id)

        # Add to destination
        from_loc = InventoryLocation.objects.get(id=from_location_id)
        to_loc = InventoryLocation.objects.get(id=to_location_id)
        
        # Get source cost for destination (simplification: assume cost follows movement)
        source_qs = InventoryBulk.objects.filter(material_id=material_id, location_id=from_location_id)
        if granule_code_id:
            source_qs = source_qs.filter(granule_code_id=granule_code_id)
        source_bulk = source_qs.order_by("-updated_at").first()
        source_cost = source_bulk.avg_cost if source_bulk else 0
        
        cls.add_bulk(material_id, qty, to_loc.plant_id, to_location_id, cost=source_cost, reference=f"Transfer In: {reference}", granule_code_id=granule_code_id)

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
