from decimal import Decimal
from math import ceil
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from apps.production.models import PackingUnit, FinishedGoodsBatch
from apps.inventory.services.packaging_service import PackagingService
from apps.materials.models import InventoryMaterial


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
        if not cfg:
            cfg = payload.get("final_outer_pack") if isinstance(payload.get("final_outer_pack"), dict) else {}
        return cfg or {}

    @staticmethod
    def _primary_inner_cfg(snapshot) -> dict:
        payload = snapshot if isinstance(snapshot, dict) else {}
        cfg = payload.get("primary_inner_pack") if isinstance(payload.get("primary_inner_pack"), dict) else {}
        return cfg or {}

    @staticmethod
    def _batch_primary_inner_cfg(fg_batch: FinishedGoodsBatch) -> dict:
        payload = dict(getattr(fg_batch, "meta_json", {}) or {})
        cfg = payload.get("primary_inner_pack") if isinstance(payload.get("primary_inner_pack"), dict) else {}
        return cfg or {}

    @staticmethod
    def _packing_qty_totals(fg_batch: FinishedGoodsBatch) -> int:
        try:
            packed_qty = sum(int(getattr(unit, "qty_pcs", 0) or 0) for unit in fg_batch.packing_units.all())
        except Exception:
            try:
                packed_qty = int(fg_batch.packing_units.aggregate(total=Sum("qty_pcs")).get("total") or 0)
            except Exception:
                packed_qty = 0
        return int(getattr(fg_batch, "qty_pcs", 0) or 0) + packed_qty

    @staticmethod
    def _net_product_weight_kg(fg_batch: FinishedGoodsBatch, qty_pcs: int) -> Decimal:
        total_weight = Decimal(str(getattr(fg_batch, "qty_kg", 0) or 0))
        total_qty_pcs = PackingService._packing_qty_totals(fg_batch)
        if total_weight <= 0 or total_qty_pcs <= 0 or qty_pcs <= 0:
            return Decimal("0")
        return (total_weight / Decimal(str(total_qty_pcs))) * Decimal(str(qty_pcs))

    @staticmethod
    def _packaging_mass_kg(material_id, qty, input_uom="PCS") -> Decimal:
        if not material_id:
            return Decimal("0")
        try:
            material = InventoryMaterial.objects.get(id=material_id)
        except Exception:
            return Decimal("0")
        try:
            base_qty, _ = PackagingService._resolve_base_qty(material, qty, input_uom=input_uom)
        except Exception:
            base_qty = Decimal("0")

        base_uom = str(getattr(material, "base_uom", "") or "").upper()
        if base_uom == "KG":
            return Decimal(str(base_qty or 0))

        defaults = dict(getattr(material, "packaging_defaults_json", {}) or {})
        weight_per_base_uom = Decimal(
            str(
                defaults.get("weight_kg_per_base_uom")
                or defaults.get("tare_kg_per_meter")
                or 0
            )
        )
        if base_uom in {"PCS", "METER"} and weight_per_base_uom > 0:
            return weight_per_base_uom * Decimal(str(base_qty or 0))
        return Decimal("0")

    @staticmethod
    def _tare_breakdown(*, net_product_weight_kg, inner_pack_tare_kg, secondary_pack_tare_kg, extras_tare_kg, content_mode, primary_pack_count):
        gross_weight_kg = (
            Decimal(str(net_product_weight_kg or 0))
            + Decimal(str(inner_pack_tare_kg or 0))
            + Decimal(str(secondary_pack_tare_kg or 0))
            + Decimal(str(extras_tare_kg or 0))
        )
        return {
            "content_mode": str(content_mode or "LOOSE_POUCHES").upper(),
            "primary_pack_count": int(primary_pack_count or 0) if primary_pack_count else None,
            "net_product_weight_kg": float(Decimal(str(net_product_weight_kg or 0))),
            "inner_pack_tare_kg": float(Decimal(str(inner_pack_tare_kg or 0))),
            "secondary_pack_tare_kg": float(Decimal(str(secondary_pack_tare_kg or 0))),
            "extras_tare_kg": float(Decimal(str(extras_tare_kg or 0))),
            "gross_weight_kg": float(gross_weight_kg),
            "expected_gross_weight_kg": float(gross_weight_kg),
        }

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
        batch_primary_cfg = PackingService._batch_primary_inner_cfg(fg_batch)
        resolved_primary_cfg = dict(primary_cfg or {})
        resolved_primary_cfg.update({key: value for key, value in batch_primary_cfg.items() if value not in (None, "")})
        selected_gonny_material_id = gonny_material_id or secondary_cfg.get("material_id")
        if not selected_gonny_material_id:
            raise ValueError("gonny_material_id is required for gonny creation.")

        inner_pack_enabled = bool(resolved_primary_cfg.get("enabled", False))
        pcs_per_pack = int(resolved_primary_cfg.get("pcs_per_pack") or 0) if inner_pack_enabled else 0
        primary_pack_consumed_at_fg = bool(batch_primary_cfg.get("consumed_at_fg"))
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
            if not resolved_primary_cfg.get("material_id"):
                raise ValueError("primary_inner_pack.material_id is required when content_mode is PRIMARY_PACKS.")

            if primary_pack_consumed_at_fg:
                total_prepacked = int(batch_primary_cfg.get("pack_count") or 0)
                if total_prepacked > 0:
                    try:
                        existing_primary_units = fg_batch.packing_units.filter(content_mode="PRIMARY_PACKS")
                        assigned_primary_pack_count = sum(
                            int(getattr(unit, "primary_pack_count", 0) or 0) for unit in existing_primary_units
                        )
                    except Exception:
                        assigned_primary_pack_count = 0
                    if assigned_primary_pack_count + resolved_primary_pack_count > total_prepacked:
                        remaining_packs = max(total_prepacked - assigned_primary_pack_count, 0)
                        raise ValueError(
                            f"Only {remaining_packs} pre-packed inner packs remain available for this batch."
                        )

        net_product_weight_kg = PackingService._net_product_weight_kg(fg_batch, effective_qty_pcs)
        inner_pack_tare_kg = (
            PackingService._packaging_mass_kg(
                resolved_primary_cfg.get("material_id"),
                resolved_primary_pack_count or 0,
                input_uom="PCS",
            )
            if resolved_content_mode == "PRIMARY_PACKS"
            else Decimal("0")
        )
        secondary_pack_tare_kg = PackingService._packaging_mass_kg(selected_gonny_material_id, 1, input_uom="PCS")
        tare_breakdown = PackingService._tare_breakdown(
            net_product_weight_kg=net_product_weight_kg,
            inner_pack_tare_kg=inner_pack_tare_kg,
            secondary_pack_tare_kg=secondary_pack_tare_kg,
            extras_tare_kg=Decimal("0"),
            content_mode=resolved_content_mode,
            primary_pack_count=resolved_primary_pack_count,
        )

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

        # Inner-pouch SKU is consumed at FG batch CREATION (last production
        # step, where pouches are actually filled into inner packs) — see
        # apps/production/services/services_execution.py:8364-8389. We do NOT
        # consume it here. If the FG batch never marked consumed_at_fg=true
        # for a PRIMARY_PACKS gonny, treat that as a config error and surface
        # it loudly instead of silently double-counting at this stage.
        if resolved_content_mode == "PRIMARY_PACKS" and resolved_primary_pack_count and not primary_pack_consumed_at_fg:
            raise ValueError(
                "Inner-pouch SKU was not consumed at FG batch creation but this "
                "gonny is PRIMARY_PACKS — the FG terminal step must record the "
                "inner-pack consumption (basis=PER_PACK, applied_at=FG_CREATION). "
                "Re-run the FG capture with output_pcs set so the inner-pouch "
                "transaction is created at the source."
            )
        
        # Generate compact operator-facing label; full FG batch lineage remains on the relation.
        existing_count = fg_batch.packing_units.count() + 1
        batch_token = str(getattr(fg_batch, "id", "") or fg_batch.batch_number or "UNIT")
        batch_token = "".join(ch for ch in batch_token.upper() if ch.isalnum())[:6] or "UNIT"
        label_id = f"GNY-{batch_token}-{existing_count:02d}"
        
        # Create packing unit
        gonny = PackingUnit.objects.create(
            label_id=label_id,
            fg_batch=fg_batch,
            production_batch=getattr(fg_batch, "production_batch", None),
            sales_order_item=fg_batch.sales_order_item,
            qty_pcs=effective_qty_pcs,
            content_mode=resolved_content_mode,
            primary_pack_count=resolved_primary_pack_count,
            net_product_weight_kg=net_product_weight_kg,
            inner_pack_tare_kg=inner_pack_tare_kg,
            secondary_pack_tare_kg=secondary_pack_tare_kg,
            extras_tare_kg=Decimal("0"),
            expected_gross_weight_kg=Decimal(str(tare_breakdown["expected_gross_weight_kg"])),
            gross_weight_kg=None,
            tare_breakdown_json=tare_breakdown,
            location=location,
            status='OPEN',
            created_by=user,
            meta_json={
                "requested_qty_pcs": int(qty_pcs),
                "normalized_from_packed_pcs": packed_pcs is not None,
                "default_content_mode": "PRIMARY_PACKS" if inner_pack_enabled else "LOOSE_POUCHES",
                "sales_primary_pack_enabled": inner_pack_enabled,
                "sales_pcs_per_pack": pcs_per_pack or None,
                "primary_packs_prepacked": primary_pack_consumed_at_fg,
                "primary_pack_source": "FINAL_STEP" if primary_pack_consumed_at_fg else "PACKING_YARD",
                "weight_breakdown": tare_breakdown,
            },
        )
        
        # Deduct from FG batch
        fg_batch.qty_pcs -= effective_qty_pcs
        if fg_batch.qty_pcs == 0:
            fg_batch.status = 'PACKED'
        fg_batch.save()
        if getattr(gonny, "production_batch_id", None):
            from apps.production.services.batch_route_service import BatchExecutionService

            BatchExecutionService.sync_batch_from_jobs(gonny.production_batch)
        
        return gonny

    @staticmethod
    @transaction.atomic
    def seal_gonny(gonny_id: str, weight_kg: Decimal, user, extras=None, variance_reason: str = "") -> PackingUnit:
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
        
        gross_weight_kg = Decimal(str(weight_kg))
        if gross_weight_kg <= 0:
            raise ValueError("Actual gross weight must be greater than 0.")
        gonny.status = 'SEALED'
        gonny.sealed_at = timezone.now()
        gonny.meta_json = dict(getattr(gonny, "meta_json", {}) or {})

        packaging_snapshot = {}
        if getattr(gonny, "sales_order_item", None):
            packaging_snapshot = dict(getattr(gonny.sales_order_item, "packaging_snapshot", {}) or {})
        elif getattr(gonny, "fg_batch", None):
            packaging_snapshot = PackingService._snapshot_for_batch(gonny.fg_batch)

        secondary_cfg = PackingService._legacy_secondary_cfg(packaging_snapshot)
        source_lines = extras if extras is not None else (secondary_cfg.get("extras") or [])
        marked_extras = []
        extras_tare_kg = Decimal("0")
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
            extras_tare_kg += PackingService._packaging_mass_kg(material_id, qty, input_uom=uom)
            marked_extras.append(
                {
                    "material_id": str(material_id),
                    "qty": float(qty),
                    "uom": uom or "",
                    "basis": "PER_GONNY",
                    "capture_mode": "MARKED_FOR_COUNT",
                }
            )

        net_product_weight_kg = Decimal(str(getattr(gonny, "net_product_weight_kg", 0) or 0))
        inner_pack_tare_kg = Decimal(str(getattr(gonny, "inner_pack_tare_kg", 0) or 0))
        secondary_pack_tare_kg = Decimal(str(getattr(gonny, "secondary_pack_tare_kg", 0) or 0))
        expected_gross_weight_kg = net_product_weight_kg + inner_pack_tare_kg + secondary_pack_tare_kg + extras_tare_kg
        variance_kg = gross_weight_kg - expected_gross_weight_kg
        variance_pct = Decimal("0")
        if expected_gross_weight_kg > 0:
            variance_pct = (variance_kg / expected_gross_weight_kg) * Decimal("100")
        normalized_reason = str(variance_reason or "").strip()
        if abs(variance_pct) > Decimal("2") and not normalized_reason:
            raise ValueError("Variance reason is required when actual gonny gross weight differs from expected by more than 2%.")

        tare_breakdown = PackingService._tare_breakdown(
            net_product_weight_kg=net_product_weight_kg,
            inner_pack_tare_kg=inner_pack_tare_kg,
            secondary_pack_tare_kg=secondary_pack_tare_kg,
            extras_tare_kg=extras_tare_kg,
            content_mode=gonny.content_mode,
            primary_pack_count=gonny.primary_pack_count,
        )
        tare_breakdown["gross_weight_kg"] = float(gross_weight_kg)
        tare_breakdown["actual_gross_weight_kg"] = float(gross_weight_kg)
        tare_breakdown["expected_gross_weight_kg"] = float(expected_gross_weight_kg)
        tare_breakdown["gross_variance_kg"] = float(variance_kg)
        tare_breakdown["gross_variance_pct"] = float(variance_pct)
        tare_breakdown["gross_variance_reason"] = normalized_reason

        gonny.weight_kg = gross_weight_kg
        gonny.gross_weight_kg = gross_weight_kg
        gonny.expected_gross_weight_kg = expected_gross_weight_kg
        gonny.gross_variance_kg = variance_kg
        gonny.gross_variance_pct = variance_pct
        gonny.gross_variance_reason = normalized_reason
        gonny.extras_tare_kg = extras_tare_kg
        gonny.tare_breakdown_json = tare_breakdown
        gonny.meta_json.update(
            {
                "sealed_weight_kg": float(gonny.weight_kg or 0),
                "seal_extras": marked_extras,
                "seal_extras_stock_effect": "MARK_ONLY",
                "weight_breakdown": tare_breakdown,
                "gross_variance_reason": normalized_reason,
            }
        )
        gonny.save(
            update_fields=[
                "weight_kg",
                "gross_weight_kg",
                "expected_gross_weight_kg",
                "gross_variance_kg",
                "gross_variance_pct",
                "gross_variance_reason",
                "extras_tare_kg",
                "tare_breakdown_json",
                "status",
                "sealed_at",
                "meta_json",
            ]
        )

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
