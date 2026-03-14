from decimal import Decimal
from math import ceil
from django.db import transaction
from django.utils import timezone
from apps.production.models import PackingUnit, FinishedGoodsBatch
from apps.inventory.services.packaging_service import PackagingService


class PackingService:
    """
    Service for creating and managing packing units (gonnies) from FG batches.
    """

    @staticmethod
    def _snapshot_for_batch(fg_batch: FinishedGoodsBatch) -> dict:
        if getattr(fg_batch, "sales_order_item", None):
            return dict(getattr(fg_batch.sales_order_item, "packaging_snapshot", {}) or {})
        job = getattr(fg_batch, "production_job", None)
        if job and getattr(job, "mts_order", None):
            return dict(getattr(job.mts_order, "packaging_snapshot", {}) or {})
        return {}

    @staticmethod
    def _legacy_secondary_cfg(snapshot) -> dict:
        payload = snapshot if isinstance(snapshot, dict) else {}
        cfg = payload.get("secondary_gonny") if isinstance(payload.get("secondary_gonny"), dict) else {}
        return cfg or {}

    @staticmethod
    def _primary_inner_cfg(snapshot) -> dict:
        payload = snapshot if isinstance(snapshot, dict) else {}
        cfg = payload.get("primary_inner_pack") if isinstance(payload.get("primary_inner_pack"), dict) else {}
        return cfg or {}

    @staticmethod
    @transaction.atomic
    def create_gonny(
        fg_batch_id: str,
        qty_pcs: int,
        user,
        gonny_material_id=None,
        packed_pcs=None,
        location_id=None,
        content_mode=None,
        primary_pack_count=None,
    ) -> PackingUnit:
        """
        Create a packing unit (gonny) from an FG batch.
        Deducts qty_pcs from the batch's available quantity.
        
        Args:
            fg_batch_id: UUID of the source FG batch
            qty_pcs: Number of pieces to pack
            user: User creating the gonny
            
        Returns:
            Created PackingUnit instance
            
        Raises:
            ValueError: If batch not found, insufficient quantity, or batch not AVAILABLE
        """
        try:
            fg_batch = FinishedGoodsBatch.objects.select_for_update().get(id=fg_batch_id)
        except FinishedGoodsBatch.DoesNotExist:
            raise ValueError(f"FG Batch {fg_batch_id} not found")
        
        if fg_batch.status != 'AVAILABLE':
            raise ValueError(f"FG Batch {fg_batch.batch_number} is not AVAILABLE for packing")
        
        effective_qty_pcs = int(qty_pcs)

        if effective_qty_pcs > fg_batch.qty_pcs:
            raise ValueError(f"Insufficient quantity: requested {effective_qty_pcs}, available {fg_batch.qty_pcs}")

        if effective_qty_pcs <= 0:
            raise ValueError("Quantity must be greater than 0")

        packaging_snapshot = PackingService._snapshot_for_batch(fg_batch)
        secondary_cfg = PackingService._legacy_secondary_cfg(packaging_snapshot)
        primary_cfg = PackingService._primary_inner_cfg(packaging_snapshot)
        selected_gonny_material_id = gonny_material_id or secondary_cfg.get("material_id")
        if not selected_gonny_material_id:
            raise ValueError("gonny_material_id is required for gonny creation.")

        inner_pack_enabled = bool(primary_cfg.get("enabled", False))
        pcs_per_pack = int(primary_cfg.get("pcs_per_pack") or 0) if inner_pack_enabled else 0
        resolved_content_mode = str(content_mode or "").upper() or (
            "PRIMARY_PACKS" if inner_pack_enabled else "LOOSE_POUCHES"
        )
        if resolved_content_mode not in {"LOOSE_POUCHES", "PRIMARY_PACKS"}:
            raise ValueError("content_mode must be LOOSE_POUCHES or PRIMARY_PACKS.")

        resolved_primary_pack_count = None
        if resolved_content_mode == "PRIMARY_PACKS":
            if primary_pack_count is not None and int(primary_pack_count) > 0:
                resolved_primary_pack_count = int(primary_pack_count)
            elif pcs_per_pack > 0:
                resolved_primary_pack_count = int(ceil(effective_qty_pcs / pcs_per_pack))
            else:
                raise ValueError("primary_pack_count is required when content_mode is PRIMARY_PACKS and no sales primary pack default exists.")

        location = fg_batch.location
        if location_id:
            from apps.inventory.models import InventoryLocation

            try:
                location = InventoryLocation.objects.get(id=location_id)
            except InventoryLocation.DoesNotExist:
                raise ValueError(f"Location {location_id} not found")

        reference = f"GONNY_CREATE:{fg_batch.batch_number}"
        PackagingService.consume_packaging_stock(
            material_id=selected_gonny_material_id,
            qty=1,
            input_uom="PCS",
            location_id=location.id,
            job_id=getattr(fg_batch, "production_job_id", None),
            sales_order_item_id=getattr(fg_batch, "sales_order_item_id", None),
            reference=reference,
            basis="PER_GONNY",
            meta_json={"fg_batch_id": str(fg_batch.id)},
        )
        
        # Generate unique label - include count of existing packing units
        existing_count = fg_batch.packing_units.count() + 1
        label_id = f"G-{fg_batch.batch_number}-{existing_count:03d}"
        
        # Create packing unit
        gonny = PackingUnit.objects.create(
            label_id=label_id,
            fg_batch=fg_batch,
            sales_order_item=fg_batch.sales_order_item,
            qty_pcs=effective_qty_pcs,
            content_mode=resolved_content_mode,
            primary_pack_count=resolved_primary_pack_count,
            location=location,
            status='OPEN',
            created_by=user,
            meta_json={
                "requested_qty_pcs": int(qty_pcs),
                "normalized_from_packed_pcs": packed_pcs is not None,
                "default_content_mode": "PRIMARY_PACKS" if inner_pack_enabled else "LOOSE_POUCHES",
                "sales_primary_pack_enabled": inner_pack_enabled,
                "sales_pcs_per_pack": pcs_per_pack or None,
            },
        )
        
        # Deduct from FG batch
        fg_batch.qty_pcs -= effective_qty_pcs
        if fg_batch.qty_pcs == 0:
            fg_batch.status = 'PACKED'
        fg_batch.save()
        
        return gonny

    @staticmethod
    @transaction.atomic
    def seal_gonny(gonny_id: str, weight_kg: Decimal, user, extras=None) -> PackingUnit:
        """
        Seal a packing unit with final weight.
        
        Args:
            gonny_id: UUID of the packing unit
            weight_kg: Final weight after sealing
            user: User sealing the gonny
            
        Returns:
            Updated PackingUnit instance
        """
        try:
            gonny = PackingUnit.objects.select_for_update().get(id=gonny_id)
        except PackingUnit.DoesNotExist:
            raise ValueError(f"Packing unit {gonny_id} not found")
        
        if gonny.status != 'OPEN':
            raise ValueError(f"Packing unit {gonny.label_id} is already {gonny.status}")
        
        gonny.weight_kg = Decimal(str(weight_kg))
        gonny.status = 'SEALED'
        gonny.sealed_at = timezone.now()
        gonny.meta_json = dict(getattr(gonny, "meta_json", {}) or {})
        gonny.save()

        packaging_snapshot = {}
        if getattr(gonny, "sales_order_item", None):
            packaging_snapshot = dict(getattr(gonny.sales_order_item, "packaging_snapshot", {}) or {})
        elif getattr(gonny, "fg_batch", None):
            packaging_snapshot = PackingService._snapshot_for_batch(gonny.fg_batch)

        secondary_cfg = PackingService._legacy_secondary_cfg(packaging_snapshot)
        source_lines = extras if extras is not None else (secondary_cfg.get("extras") or [])
        consumed_extras = []
        for line in source_lines:
            if not isinstance(line, dict):
                continue
            material_id = line.get("material_id")
            qty = Decimal(str(line.get("qty") or 0))
            uom = str(line.get("uom") or "").upper() or None
            basis = str(line.get("basis") or "PER_GONNY").upper()
            if basis != "PER_GONNY" or qty <= 0:
                continue
            if not material_id:
                raise ValueError("Extra packaging line missing material_id.")
            reference = f"GONNY_SEAL:{gonny.label_id}"
            PackagingService.consume_packaging_stock(
                material_id=material_id,
                qty=qty,
                input_uom=uom,
                location_id=gonny.location_id,
                job_id=getattr(gonny.fg_batch, "production_job_id", None) if gonny.fg_batch_id else None,
                sales_order_item_id=getattr(gonny, "sales_order_item_id", None),
                reference=reference,
                basis="PER_GONNY",
                meta_json={"gonny_id": str(gonny.id), "fg_batch_id": str(gonny.fg_batch_id)},
            )
            consumed_extras.append(
                {
                    "material_id": str(material_id),
                    "qty": float(qty),
                    "uom": uom or "",
                    "basis": "PER_GONNY",
                }
            )

        gonny.meta_json.update(
            {
                "sealed_weight_kg": float(gonny.weight_kg or 0),
                "seal_extras": consumed_extras,
            }
        )
        gonny.save(update_fields=["weight_kg", "status", "sealed_at", "meta_json"])

        return gonny

    @staticmethod
    def get_available_gonnies(plant_id: str = None, fg_batch_id: str = None):
        """
        Get gonnies available for dispatch (SEALED status).
        
        Args:
            plant_id: Optional filter by plant
            fg_batch_id: Optional filter by FG batch
            
        Returns:
            QuerySet of PackingUnit instances
        """
        qs = PackingUnit.objects.filter(status='SEALED')
        
        if plant_id:
            qs = qs.filter(location__plant_id=plant_id)
        
        if fg_batch_id:
            qs = qs.filter(fg_batch_id=fg_batch_id)
        
        return qs.select_related('fg_batch', 'location')

    @staticmethod
    def get_batch_packing_summary(fg_batch_id: str) -> dict:
        """
        Get packing summary for an FG batch.
        
        Returns:
            Dict with packed_pcs, remaining_pcs, gonnies count
        """
        try:
            fg_batch = FinishedGoodsBatch.objects.get(id=fg_batch_id)
        except FinishedGoodsBatch.DoesNotExist:
            raise ValueError(f"FG Batch {fg_batch_id} not found")
        
        gonnies = fg_batch.packing_units.all()
        packed_pcs = sum(g.qty_pcs for g in gonnies)
        
        return {
            'batch_number': fg_batch.batch_number,
            'original_qty': packed_pcs + fg_batch.qty_pcs,
            'packed_pcs': packed_pcs,
            'remaining_pcs': fg_batch.qty_pcs,
            'gonnies_open': gonnies.filter(status='OPEN').count(),
            'gonnies_sealed': gonnies.filter(status='SEALED').count(),
            'gonnies_dispatched': gonnies.filter(status='DISPATCHED').count(),
        }
