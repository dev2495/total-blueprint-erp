from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction

from apps.inventory.models import InventoryLocation, PackagingStock, PackagingTransaction
from apps.materials.models import InventoryMaterial


class PackagingService:
    @classmethod
    def _as_decimal(cls, value):
        return Decimal(str(value or 0))

    @classmethod
    def _validate_packaging_material(cls, material: InventoryMaterial):
        if not material:
            raise ValidationError("Packaging material is required.")
        if str(getattr(material, "category", "") or "").upper() != "PACKAGING":
            raise ValidationError(f"Material {material.code} is not a PACKAGING material.")

    @classmethod
    def _resolve_base_qty(cls, material: InventoryMaterial, qty, input_uom=None):
        base_uom = str(material.base_uom or "").upper()
        incoming_uom = str(input_uom or base_uom).upper()
        incoming_qty = cls._as_decimal(qty)

        if incoming_qty <= 0:
            raise ValidationError("Quantity must be greater than zero.")

        if incoming_uom == base_uom:
            return incoming_qty, {
                "input_qty": float(incoming_qty),
                "input_uom": incoming_uom,
                "base_qty": float(incoming_qty),
                "base_uom": base_uom,
                "conversion_factor": 1.0,
            }

        if incoming_uom == "PCS" and base_uom in {"KG", "METER"}:
            factor = cls._as_decimal(getattr(material, "per_sheet_base_qty", None))
            if factor <= 0:
                raise ValidationError(
                    f"Packaging material {material.code} requires a base qty per consumed unit for PCS->{base_uom} conversion."
                )
            base_qty = incoming_qty * factor
            return base_qty, {
                "input_qty": float(incoming_qty),
                "input_uom": incoming_uom,
                "base_qty": float(base_qty),
                "base_uom": base_uom,
                "conversion_factor": float(factor),
            }

        raise ValidationError(
            f"Unsupported packaging UOM conversion: {incoming_uom} -> {base_uom} for material {material.code}."
        )

    @classmethod
    @transaction.atomic
    def add_packaging_stock(
        cls,
        *,
        material_id,
        qty,
        location_id,
        cost=0,
        vendor_id=None,
        job_id=None,
        sales_order_item_id=None,
        mts_order_id=None,
        reference="",
        meta_json=None,
        tx_type="INWARD",
        input_uom=None,
    ):
        material = InventoryMaterial.objects.get(id=material_id)
        cls._validate_packaging_material(material)
        location = InventoryLocation.objects.get(id=location_id)

        base_qty, conversion_meta = cls._resolve_base_qty(material, qty, input_uom=input_uom)
        cost = cls._as_decimal(cost)

        stock, _ = PackagingStock.objects.select_for_update().get_or_create(
            material=material,
            plant=location.plant,
            location=location,
            defaults={"qty": Decimal("0"), "avg_cost": Decimal("0")},
        )

        if cost > 0:
            total_value = (cls._as_decimal(stock.qty) * cls._as_decimal(stock.avg_cost)) + (base_qty * cost)
            new_qty = cls._as_decimal(stock.qty) + base_qty
            stock.avg_cost = (total_value / new_qty) if new_qty > 0 else Decimal("0")
            stock.qty = new_qty
        else:
            stock.qty = cls._as_decimal(stock.qty) + base_qty
        stock.save()

        meta = dict(meta_json or {})
        meta.update(conversion_meta)

        return PackagingTransaction.objects.create(
            type=str(tx_type or "INWARD").upper(),
            material=material,
            location=location,
            qty=base_qty,
            avg_cost=cost if cost > 0 else stock.avg_cost,
            vendor_id=vendor_id,
            job_id=job_id,
            sales_order_item_id=sales_order_item_id,
            mts_order_id=mts_order_id,
            reference=reference,
            meta_json=meta,
        )

    @classmethod
    @transaction.atomic
    def consume_packaging_stock(
        cls,
        *,
        material_id,
        qty,
        location_id,
        job_id=None,
        sales_order_item_id=None,
        mts_order_id=None,
        reference="",
        meta_json=None,
        input_uom=None,
        basis=None,
        roll_id=None,
    ):
        material = InventoryMaterial.objects.get(id=material_id)
        cls._validate_packaging_material(material)
        location = InventoryLocation.objects.get(id=location_id)

        base_qty, conversion_meta = cls._resolve_base_qty(material, qty, input_uom=input_uom)

        stock = PackagingStock.objects.select_for_update().filter(
            material=material,
            plant=location.plant,
            location=location,
        ).first()
        if not stock:
            raise ValidationError(
                f"Packaging stock shortage: {material.code} required {base_qty} {material.base_uom}, available 0 {material.base_uom} at {location.name}."
            )

        available = cls._as_decimal(stock.qty)
        if available < base_qty:
            raise ValidationError(
                f"Packaging stock shortage: {material.code} required {base_qty} {material.base_uom}, available {available} {material.base_uom} at {location.name}."
            )

        stock.qty = available - base_qty
        stock.save(update_fields=["qty", "updated_at"])

        meta = dict(meta_json or {})
        meta.update(conversion_meta)
        if basis:
            meta["basis"] = basis
        if roll_id:
            meta["roll_id"] = str(roll_id)

        return PackagingTransaction.objects.create(
            type="CONSUME",
            material=material,
            location=location,
            qty=-base_qty,
            avg_cost=stock.avg_cost,
            job_id=job_id,
            sales_order_item_id=sales_order_item_id,
            mts_order_id=mts_order_id,
            reference=reference,
            meta_json=meta,
        )

    @classmethod
    @transaction.atomic
    def transfer_packaging_stock(
        cls,
        *,
        material_id,
        qty,
        from_location_id,
        to_location_id,
        reference="",
        input_uom=None,
    ):
        material = InventoryMaterial.objects.get(id=material_id)
        cls._validate_packaging_material(material)

        from_location = InventoryLocation.objects.get(id=from_location_id)
        to_location = InventoryLocation.objects.get(id=to_location_id)

        source_stock = PackagingStock.objects.select_for_update().filter(
            material=material,
            plant=from_location.plant,
            location=from_location,
        ).first()
        if not source_stock:
            raise ValidationError(
                f"No packaging stock for {material.code} at {from_location.name}."
            )
        avg_cost = cls._as_decimal(source_stock.avg_cost)

        cls.consume_packaging_stock(
            material_id=material_id,
            qty=qty,
            location_id=from_location_id,
            reference=f"TRANSFER_OUT: {reference}",
            input_uom=input_uom,
            meta_json={"transfer_to_location_id": str(to_location_id)},
        )

        return cls.add_packaging_stock(
            material_id=material_id,
            qty=qty,
            location_id=to_location_id,
            cost=avg_cost,
            reference=f"TRANSFER_IN: {reference}",
            tx_type="TRANSFER",
            input_uom=input_uom,
            meta_json={"transfer_from_location_id": str(from_location_id)},
        )

    @classmethod
    @transaction.atomic
    def adjust_packaging_stock(
        cls,
        *,
        material_id,
        qty,
        location_id,
        reference="",
        input_uom=None,
        meta_json=None,
    ):
        qty_dec = cls._as_decimal(qty)
        if qty_dec == 0:
            raise ValidationError("Adjustment quantity cannot be zero.")

        if qty_dec > 0:
            return cls.add_packaging_stock(
                material_id=material_id,
                qty=qty_dec,
                location_id=location_id,
                reference=reference,
                tx_type="ADJUST",
                input_uom=input_uom,
                meta_json=meta_json,
            )

        tx = cls.consume_packaging_stock(
            material_id=material_id,
            qty=abs(qty_dec),
            location_id=location_id,
            reference=reference,
            input_uom=input_uom,
            meta_json=meta_json,
        )
        tx.type = "ADJUST"
        tx.save(update_fields=["type"])
        return tx
