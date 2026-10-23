from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction

from apps.inventory.models import InventoryLocation, PackagingStock, PackagingTransaction
from apps.inventory.services.wac import apply_wac, dec, q4
from apps.materials.models import InventoryMaterial


class PackagingService:
    @classmethod
    def _as_decimal(cls, value):
        return dec(value)

    @classmethod
    def _validate_packaging_material(cls, material: InventoryMaterial):
        if not material:
            raise ValidationError("Packaging material is required.")
        if str(getattr(material, "category", "") or "").upper() != "PACKAGING":
            raise ValidationError(f"Material {material.code} is not a PACKAGING material.")

    @classmethod
    def _resolve_base_qty(cls, material: InventoryMaterial, qty, input_uom=None):
        base_uom = InventoryMaterial.normalize_master_uom(material.base_uom or "PCS")
        incoming_uom = InventoryMaterial.normalize_master_uom(input_uom or base_uom)
        incoming_qty = cls._as_decimal(qty)

        if incoming_qty <= 0:
            raise ValidationError("Quantity must be greater than zero.")

        if incoming_uom == base_uom:
            return q4(incoming_qty), {
                "input_qty": float(incoming_qty),
                "input_uom": incoming_uom,
                "base_qty": float(incoming_qty),
                "base_uom": base_uom,
                "conversion_factor": 1.0,
            }

        if incoming_uom == "PCS" and base_uom in {"KG", "METER"}:
            # Linked in-house items take it from their Product Master variant's BOM.
            from apps.inventory.services.packaging_measure import stock_qty_per_piece

            factor = stock_qty_per_piece(material)
            if factor <= 0:
                measure = "weight of one piece in kg" if base_uom == "KG" else "length of one piece in metres"
                raise ValidationError(
                    f"{material.code} is stocked in {base_uom} but has no {measure}: link it to its "
                    f"packaging Product Master variant (or enter it) in Masters > Packaging"
                )
            base_qty = q4(incoming_qty * factor)
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
        vendor_invoice_no="",
        manual_po_ref="",
        allow_duplicate_vendor_invoice=False,
    ):
        material = InventoryMaterial.objects.get(id=material_id)
        cls._validate_packaging_material(material)
        location = InventoryLocation.objects.get(id=location_id)

        base_qty, conversion_meta = cls._resolve_base_qty(material, qty, input_uom=input_uom)
        cost = q4(cost)

        invoice_no = (vendor_invoice_no or "").strip()
        if not invoice_no and isinstance(meta_json, dict):
            invoice_no = str(meta_json.get("vendor_invoice_no") or "").strip()
        if vendor_id and invoice_no and not allow_duplicate_vendor_invoice:
            from apps.inventory.models import Vendor
            Vendor.objects.select_for_update().filter(id=vendor_id).first()
            if PackagingTransaction.objects.filter(
                vendor_id=vendor_id, vendor_invoice_no=invoice_no
            ).exists():
                raise ValidationError(
                    f"Duplicate vendor invoice '{invoice_no}' for this vendor."
                )

        stock, _ = PackagingStock.objects.select_for_update().get_or_create(
            material=material,
            plant=location.plant,
            location=location,
            defaults={"qty": Decimal("0"), "avg_cost": Decimal("0")},
        )

        resolved_rate = cost if cost > 0 else q4(stock.avg_cost)
        new_qty, new_rate = apply_wac(
            balance_qty=stock.qty,
            balance_rate=stock.avg_cost,
            delta_qty=base_qty,
            posting_rate=resolved_rate,
        )
        stock.qty = new_qty
        stock.avg_cost = new_rate
        stock.save(update_fields=["qty", "avg_cost", "updated_at"])

        meta = dict(meta_json or {})
        meta.update(conversion_meta)

        return PackagingTransaction.objects.create(
            type=str(tx_type or "INWARD").upper(),
            material=material,
            location=location,
            qty=base_qty,
            avg_cost=resolved_rate,
            vendor_id=vendor_id,
            job_id=job_id,
            sales_order_item_id=sales_order_item_id,
            mts_order_id=mts_order_id,
            reference=reference,
            vendor_invoice_no=invoice_no or "",
            manual_po_ref=(manual_po_ref or "").strip(),
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

        available = q4(stock.qty)
        if available < base_qty:
            raise ValidationError(
                f"Packaging stock shortage: {material.code} required {base_qty} {material.base_uom}, available {available} {material.base_uom} at {location.name}."
            )

        stock.qty = q4(available - base_qty)
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
            avg_cost=q4(stock.avg_cost),
            job_id=job_id,
            sales_order_item_id=sales_order_item_id,
            mts_order_id=mts_order_id,
            reference=reference,
            meta_json=meta,
        )

    @classmethod
    @transaction.atomic
    def consume_packaging_stock_in_plant(
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
    ):
        """Consume from the given location first, then from other locations of the same plant.

        Packing material is often kept in a store while the packed goods sit elsewhere in the
        plant. Each location used gets its own CONSUME row, so the stock card stays exact.
        """
        material = InventoryMaterial.objects.get(id=material_id)
        cls._validate_packaging_material(material)
        location = InventoryLocation.objects.select_related("plant").get(id=location_id)
        base_qty, conversion_meta = cls._resolve_base_qty(material, qty, input_uom=input_uom)
        base_uom = InventoryMaterial.normalize_master_uom(material.base_uom or "PCS")

        stocks = list(
            PackagingStock.objects.select_for_update()
            .select_related("location")
            .filter(material=material, plant=location.plant)
        )
        stocks.sort(key=lambda row: (str(row.location_id) != str(location.id), -q4(row.qty)))
        available = sum((max(q4(row.qty), Decimal("0")) for row in stocks), Decimal("0"))
        if available < base_qty:
            where = ", ".join(
                f"{q4(row.qty)} at {row.location.name}" for row in stocks if q4(row.qty) > 0
            ) or "none in this plant"
            raise ValidationError(
                f"Packaging stock shortage: {material.code} needs {base_qty} {material.base_uom}, "
                f"plant has {available} {material.base_uom} ({where})."
            )

        transactions = []
        remaining = base_qty
        for stock in stocks:
            if remaining <= 0:
                break
            take = min(remaining, q4(stock.qty))
            if take <= 0:
                continue
            meta = dict(meta_json or {})
            meta.update(conversion_meta)
            if str(stock.location_id) != str(location.id):
                meta["drawn_from_location_id"] = str(stock.location_id)
                meta["requested_location_id"] = str(location.id)
            transactions.append(
                cls.consume_packaging_stock(
                    material_id=material.id,
                    qty=take,
                    input_uom=base_uom,
                    location_id=stock.location_id,
                    job_id=job_id,
                    sales_order_item_id=sales_order_item_id,
                    mts_order_id=mts_order_id,
                    reference=reference,
                    meta_json=meta,
                    basis=basis,
                )
            )
            remaining = q4(remaining - take)
        return transactions

    @classmethod
    def draw_inner_packs(cls, *, material_id, pack_count, location_id, **kwargs):
        """Take inner pouches off stock as output is logged; never block the output.

        Inner pouches are the one packing item consumed automatically. When the stock book
        cannot cover them (nothing booked in the plant, or a KG/METER material without the
        weight of one piece) the output still stands and the packs are left for the evening
        packing count, which takes the counted difference off stock for this order.
        Returns (transactions, reason); reason is "" when the packs were taken off stock.
        """
        try:
            with transaction.atomic():
                txs = cls.consume_packaging_stock_in_plant(
                    material_id=material_id,
                    qty=pack_count,
                    input_uom="PCS",
                    location_id=location_id,
                    **kwargs,
                )
            return txs, ""
        except ValidationError as exc:
            return [], " ".join(exc.messages)

    @classmethod
    @transaction.atomic
    def return_unused_packaging_stock(
        cls,
        *,
        material_id,
        qty,
        location_id,
        cost,
        job_id=None,
        sales_order_item_id=None,
        reference="",
        meta_json=None,
        basis="INNER_PACK_RETURN",
        input_uom=None,
    ):
        """Put back packing material that was consumed for an order but not used (ADJUST row)."""
        meta = dict(meta_json or {})
        meta["basis"] = basis
        return cls.add_packaging_stock(
            material_id=material_id,
            qty=qty,
            input_uom=input_uom,
            location_id=location_id,
            cost=cost,
            job_id=job_id,
            sales_order_item_id=sales_order_item_id,
            reference=reference,
            meta_json=meta,
            tx_type="ADJUST",
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
