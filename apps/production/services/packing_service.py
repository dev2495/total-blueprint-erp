import logging
from decimal import Decimal
from math import ceil
from django.conf import settings
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from apps.production.models import PackingUnit, FinishedGoodsBatch
from apps.inventory.services.packaging_service import PackagingService
from apps.materials.models import InventoryMaterial

logger = logging.getLogger(__name__)


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
            logger.warning(
                "Packing totals query failed fg_batch_id=%s; retrying aggregate query",
                getattr(fg_batch, "id", None),
                exc_info=True,
            )
            try:
                packed_qty = int(fg_batch.packing_units.aggregate(total=Sum("qty_pcs")).get("total") or 0)
            except Exception:
                logger.warning(
                    "Packing totals aggregate query failed fg_batch_id=%s; using zero packed quantity",
                    getattr(fg_batch, "id", None),
                    exc_info=True,
                )
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
            logger.warning(
                "Packaging material lookup failed material_id=%s while calculating packing tare",
                material_id,
                exc_info=True,
            )
            return Decimal("0")
        try:
            base_qty, _ = PackagingService._resolve_base_qty(material, qty, input_uom=input_uom)
        except Exception:
            logger.warning(
                "Packaging base-quantity resolution failed material_id=%s qty=%s input_uom=%s",
                material_id,
                qty,
                input_uom,
                exc_info=True,
            )
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

        # Base rule: only inner pouches are consumed automatically. The gonny (like extras and
        # roll-packing material) is marked on the unit and taken off stock by the evening
        # packing count, which books the count difference to the orders that marked it.
        gonny_auto_consume = bool(getattr(settings, "PACKING_GONNY_AUTO_CONSUME", False))
        if gonny_auto_consume:
            PackagingService.consume_packaging_stock(
                material_id=selected_gonny_material_id,
                qty=1,
                input_uom="PCS",
                location_id=location.id,
                job_id=getattr(fg_batch, "production_job_id", None),
                sales_order_item_id=getattr(fg_batch, "sales_order_item_id", None),
                reference=f"GONNY_CREATE:{fg_batch.batch_number}",
                basis="PER_GONNY",
                meta_json={"fg_batch_id": str(fg_batch.id)},
            )
        packaging_marks = [
            {
                "material_id": str(selected_gonny_material_id),
                "qty": 1.0,
                "uom": "PCS",
                "basis": "PER_GONNY",
                "capture_mode": "CONSUMED" if gonny_auto_consume else "MARKED_FOR_COUNT",
            }
        ]

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
                "packaging_marks": packaging_marks,
                "gonny_stock_effect": "CONSUMED" if gonny_auto_consume else "MARK_ONLY",
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


class PackingVerificationService:
    """
    Packing yard check: does what was packed match what the machine logged?

    Net packed = gross on the scale - inner packs - gonny/carton - extras, all from the
    sealed packs. Pieces are compared at close; weight per piece is compared all along,
    using a weighed sample when one is recorded. Machine logging is never changed: a
    shortfall is booked as packing loss on the pouching job, and finished stock follows
    the packed figures.
    """

    @staticmethod
    def _limits():
        from django.conf import settings
        pcs = Decimal(str(getattr(settings, "PACKING_VERIFY_PCS_PCT", 2) or 2))
        kg = Decimal(str(getattr(settings, "PACKING_VERIFY_KG_PCT", 2) or 2))
        return pcs, kg

    @staticmethod
    def _pct(actual, expected):
        expected = Decimal(str(expected or 0))
        if expected <= 0:
            return None
        return ((Decimal(str(actual or 0)) - expected) / expected * Decimal("100")).quantize(Decimal("0.001"))

    @classmethod
    def summary(cls, fg_batch: FinishedGoodsBatch) -> dict:
        from apps.production.models import PackingVerification

        verification = PackingVerification.objects.filter(fg_batch=fg_batch).first()
        units = list(fg_batch.packing_units.all().order_by("created_at"))
        sealed = [
            unit for unit in units
            if str(unit.status or "").upper() in {"SEALED", "DISPATCHED"} and unit.gross_weight_kg is not None
        ]
        open_units = [unit for unit in units if str(unit.status or "").upper() == "OPEN"]
        packed_pcs = sum(int(unit.qty_pcs or 0) for unit in units)
        sealed_pcs = sum(int(unit.qty_pcs or 0) for unit in sealed)
        gross = sum((Decimal(str(unit.gross_weight_kg or 0)) for unit in sealed), Decimal("0"))
        tare = sum(
            (
                Decimal(str(unit.inner_pack_tare_kg or 0))
                + Decimal(str(unit.secondary_pack_tare_kg or 0))
                + Decimal(str(unit.extras_tare_kg or 0))
                for unit in sealed
            ),
            Decimal("0"),
        )
        net = gross - tare
        closed = verification is not None and verification.status != "OPEN"
        logged_pcs = int(verification.logged_pcs) if closed else int(fg_batch.qty_pcs or 0) + packed_pcs
        logged_kg = Decimal(str(verification.logged_kg)) if closed else Decimal(str(fg_batch.qty_kg or 0))
        logged_g = (logged_kg * Decimal("1000") / Decimal(logged_pcs)) if logged_pcs > 0 else None
        packed_g = (net * Decimal("1000") / Decimal(sealed_pcs)) if sealed_pcs > 0 else None
        sample_g = Decimal(str(verification.sample_weight_g)) if verification and verification.sample_weight_g else None
        weight_check_g = sample_g or packed_g
        pcs_limit, kg_limit = cls._limits()
        weight_variance = cls._pct(weight_check_g, logged_g) if (weight_check_g is not None and logged_g) else None
        pcs_by_weight = int((net * Decimal("1000") / weight_check_g).quantize(Decimal("1"))) if weight_check_g and net > 0 else None
        rows = []
        for unit in units:
            unit_tare = (
                Decimal(str(unit.inner_pack_tare_kg or 0))
                + Decimal(str(unit.secondary_pack_tare_kg or 0))
                + Decimal(str(unit.extras_tare_kg or 0))
            )
            unit_net = (Decimal(str(unit.gross_weight_kg)) - unit_tare) if unit.gross_weight_kg is not None else None
            expected_net = (Decimal(int(unit.qty_pcs or 0)) * logged_g / Decimal("1000")) if logged_g else None
            rows.append({
                "id": str(unit.id),
                "label_id": unit.label_id,
                "status": unit.status,
                "qty_pcs": int(unit.qty_pcs or 0),
                "gross_kg": float(unit.gross_weight_kg) if unit.gross_weight_kg is not None else None,
                "tare_kg": float(unit_tare),
                "net_kg": float(unit_net) if unit_net is not None else None,
                "expected_net_kg": float(expected_net) if expected_net is not None else None,
                "variance_pct": float(cls._pct(unit_net, expected_net)) if (unit_net is not None and expected_net) else None,
            })
        return {
            "fg_batch_id": str(fg_batch.id),
            "batch_number": fg_batch.batch_number,
            "job_number": getattr(fg_batch.production_job, "job_number", None),
            "status": verification.status if verification else "OPEN",
            "logged_pcs": logged_pcs,
            "logged_kg": float(logged_kg),
            "logged_weight_per_pc_g": float(logged_g) if logged_g else None,
            "packed_pcs": packed_pcs,
            "sealed_pcs": sealed_pcs,
            "open_units": len(open_units),
            "unpacked_pcs": int(fg_batch.qty_pcs or 0),
            "gross_kg": float(gross),
            "tare_kg": float(tare),
            "net_kg": float(net),
            "packed_weight_per_pc_g": float(packed_g) if packed_g else None,
            "sample_weight_g": float(sample_g) if sample_g else None,
            "sample_size": verification.sample_size if verification else None,
            "weight_variance_pct": float(weight_variance) if weight_variance is not None else None,
            "pcs_by_weight": pcs_by_weight,
            "pcs_variance_pct": float(verification.pcs_variance_pct) if (closed and verification.pcs_variance_pct is not None) else (float(cls._pct(packed_pcs, logged_pcs)) if logged_pcs else None),
            "kg_variance_pct": float(verification.kg_variance_pct) if (closed and verification.kg_variance_pct is not None) else (float(cls._pct(net, logged_kg)) if logged_kg > 0 and sealed_pcs and sealed_pcs == packed_pcs else None),
            "limits": {"pcs_pct": float(pcs_limit), "kg_pct": float(kg_limit)},
            "shortfall_pcs": verification.shortfall_pcs if verification else 0,
            "shortfall_kg": float(verification.shortfall_kg) if verification else 0.0,
            "reason": verification.reason if verification else "",
            "note": verification.note if verification else "",
            "checked_at": verification.checked_at.isoformat() if verification and verification.checked_at else None,
            "decided_at": verification.decided_at.isoformat() if verification and verification.decided_at else None,
            "inner_packs": cls._inner_pack_summary(fg_batch, units),
            "in_scope": cls.in_scope(fg_batch),
            "units": rows,
        }

    @staticmethod
    def _inner_pack_summary(fg_batch, units) -> dict | None:
        primary = dict((fg_batch.meta_json or {}).get("primary_inner_pack") or {})
        if not primary.get("consumed_at_fg"):
            return None
        used = sum(int(getattr(unit, "primary_pack_count", 0) or 0) for unit in units if unit.content_mode == "PRIMARY_PACKS")
        return {
            "material_id": primary.get("material_id"),
            "pcs_per_pack": primary.get("pcs_per_pack"),
            "consumed_at_machine": int(primary.get("pack_count") or 0),
            "used_in_units": used,
            "returned": primary.get("returned_unused"),
        }

    _go_live_cache = None

    @classmethod
    def start_moment(cls):
        """From when batches go through the packing check (older batches are left as they were)."""
        from datetime import datetime, time

        from django.utils.dateparse import parse_date, parse_datetime

        raw = str(getattr(settings, "PACKING_VERIFY_START_DATE", "") or "").strip()
        if raw:
            moment = parse_datetime(raw)
            if moment is None and parse_date(raw):
                moment = datetime.combine(parse_date(raw), time.min)
            if moment is not None:
                return timezone.make_aware(moment) if timezone.is_naive(moment) else moment
        if cls._go_live_cache is None:
            from django.db.migrations.recorder import MigrationRecorder

            applied = (
                MigrationRecorder.Migration.objects.filter(app="production", name="0077_packing_check_and_roll_return")
                .values_list("applied", flat=True)
                .first()
            )
            cls._go_live_cache = applied or timezone.make_aware(datetime(2026, 10, 16))
        return cls._go_live_cache

    @classmethod
    def in_scope(cls, fg_batch) -> bool:
        created = getattr(fg_batch, "created_at", None)
        return created is None or created >= cls.start_moment()

    @classmethod
    def _batch(cls, fg_batch_id, *, for_change=False):
        try:
            fg_batch = FinishedGoodsBatch.objects.select_related("production_job").get(id=fg_batch_id)
        except FinishedGoodsBatch.DoesNotExist:
            raise ValueError("Finished goods batch not found.")
        if for_change and not cls.in_scope(fg_batch):
            raise ValueError(
                f"Batch {fg_batch.batch_number} was made before the packing check started "
                f"({timezone.localtime(cls.start_moment()):%d %b %Y %H:%M}), so it is not checked."
            )
        return fg_batch

    @classmethod
    @transaction.atomic
    def record_sample(cls, fg_batch_id, *, sample_count, sample_weight_g_total, user=None):
        from apps.production.models import PackingVerification

        fg_batch = cls._batch(fg_batch_id, for_change=True)
        try:
            count = int(sample_count)
            total = Decimal(str(sample_weight_g_total))
        except Exception:
            raise ValueError("Enter how many pouches were weighed and their total weight in grams.")
        if count <= 0 or total <= 0:
            raise ValueError("Sample count and weight must be more than zero.")
        verification, _ = PackingVerification.objects.select_for_update().get_or_create(fg_batch=fg_batch)
        if verification.status != "OPEN":
            raise ValueError("This batch is already checked.")
        verification.sample_size = count
        verification.sample_weight_g = (total / Decimal(count)).quantize(Decimal("0.0001"))
        verification.save(update_fields=["sample_size", "sample_weight_g", "updated_at"])
        return cls.summary(fg_batch)

    @classmethod
    @transaction.atomic
    def close(cls, fg_batch_id, *, user=None, note=""):
        from django.utils import timezone
        from apps.production.models import PackingVerification

        fg_batch = FinishedGoodsBatch.objects.select_for_update().get(id=cls._batch(fg_batch_id, for_change=True).id)
        verification, _ = PackingVerification.objects.select_for_update().get_or_create(fg_batch=fg_batch)
        if verification.status != "OPEN":
            raise ValueError("This batch is already checked.")
        data = cls.summary(fg_batch)
        if data["open_units"]:
            raise ValueError("Seal or empty the open packs before closing the check.")
        if data["packed_pcs"] <= 0:
            raise ValueError("Nothing is packed from this batch yet.")
        pcs_limit, kg_limit = cls._limits()
        verification.logged_pcs = data["logged_pcs"]
        verification.logged_kg = Decimal(str(data["logged_kg"]))
        verification.packed_pcs = data["packed_pcs"]
        verification.packed_gross_kg = Decimal(str(data["gross_kg"]))
        verification.packed_tare_kg = Decimal(str(data["tare_kg"]))
        verification.packed_net_kg = Decimal(str(data["net_kg"]))
        verification.pcs_variance_pct = cls._pct(data["packed_pcs"], data["logged_pcs"]) if data["logged_pcs"] else None
        verification.kg_variance_pct = cls._pct(data["net_kg"], data["logged_kg"]) if data["logged_kg"] else None
        verification.checked_by = user
        verification.checked_at = timezone.now()
        verification.note = str(note or "")[:2000]
        within = (
            (verification.pcs_variance_pct is None or abs(verification.pcs_variance_pct) <= pcs_limit)
            and (verification.kg_variance_pct is None or abs(verification.kg_variance_pct) <= kg_limit)
        )
        verification.status = "VERIFIED" if within else "HELD"
        verification.save()
        if within:
            cls._apply_stock(verification, user=user)
            fg_batch.refresh_from_db()
        return cls.summary(fg_batch)

    @classmethod
    @transaction.atomic
    def accept(cls, fg_batch_id, *, user=None, reason="", note=""):
        from django.utils import timezone
        from apps.production.models import PackingVerification
        from apps.users.permission_service import PermissionService

        perms = PermissionService.get_user_permissions(user) if user is not None else set()
        if not (getattr(user, "is_superuser", False) or getattr(user, "is_owner", False) or "*" in perms or "production.manage" in perms):
            raise ValueError("Only a production supervisor or manager can accept a held batch.")
        fg_batch = cls._batch(fg_batch_id, for_change=True)
        verification = PackingVerification.objects.select_for_update().filter(fg_batch=fg_batch).first()
        if verification is None or verification.status != "HELD":
            raise ValueError("Only a held batch can be accepted.")
        valid = {code for code, _ in PackingVerification.REASON_CHOICES}
        reason = str(reason or "").upper()
        if reason not in valid:
            raise ValueError("Choose a reason for accepting the difference.")
        if reason == "OTHER" and not str(note or "").strip():
            raise ValueError("Write a note when the reason is Other.")
        verification.reason = reason
        if note:
            verification.note = (verification.note + "\n" if verification.note else "") + str(note)[:2000]
        verification.status = "ACCEPTED"
        verification.decided_by = user
        verification.decided_at = timezone.now()
        verification.save()
        cls._apply_stock(verification, user=user)
        fg_batch.refresh_from_db()
        return cls.summary(fg_batch)

    @staticmethod
    def _apply_stock(verification, *, user=None):
        """Finished stock follows what was packed; the unpacked balance is booked as loss."""
        from apps.production.models import ScrapLog

        fg_batch = FinishedGoodsBatch.objects.select_for_update().get(id=verification.fg_batch_id)
        shortfall = int(fg_batch.qty_pcs or 0)
        shortfall_kg = Decimal("0")
        if shortfall > 0 and verification.logged_pcs:
            shortfall_kg = (Decimal(str(verification.logged_kg)) * Decimal(shortfall) / Decimal(verification.logged_pcs)).quantize(Decimal("0.0001"))
            if fg_batch.production_job_id and shortfall_kg > 0:
                ScrapLog.objects.create(
                    production_job_id=fg_batch.production_job_id,
                    quantity=shortfall_kg,
                    uom="KG",
                    reason="OTHER",
                    notes=f"Packing check {fg_batch.batch_number}: {shortfall} pcs logged but not packed",
                    logged_by=user,
                )
            fg_batch.qty_pcs = 0
        if str(fg_batch.status or "").upper() == "AVAILABLE":
            fg_batch.status = "PACKED"
        returned_packs = PackingVerificationService._return_unused_inner_packs(fg_batch, user=user)
        fg_batch.save(update_fields=["qty_pcs", "status", "meta_json", "updated_at"])
        verification.shortfall_pcs = shortfall
        verification.shortfall_kg = shortfall_kg
        if returned_packs:
            verification.note = (
                f"{verification.note}\n" if verification.note else ""
            ) + f"{returned_packs} inner pouch(es) consumed at the machine but not used in packs went back to stock."
        verification.save(update_fields=["shortfall_pcs", "shortfall_kg", "note", "updated_at"])

    @staticmethod
    def _return_unused_inner_packs(fg_batch, *, user=None) -> int:
        """Inner pouches are consumed at the machine from the logged pieces; once the batch is
        checked, any that did not go into a packed unit go back to stock for this order."""
        from apps.inventory.models import PackagingTransaction
        from apps.inventory.services.packaging_service import PackagingService

        meta = dict(fg_batch.meta_json or {})
        primary = dict(meta.get("primary_inner_pack") or {})
        if not primary.get("consumed_at_fg") or primary.get("returned_unused") is not None:
            return 0
        consumed = int(primary.get("pack_count") or 0)
        used = sum(
            int(unit.primary_pack_count or 0)
            for unit in fg_batch.packing_units.filter(content_mode="PRIMARY_PACKS")
        )
        unused = max(consumed - used, 0)
        primary["packs_used"] = used
        primary["returned_unused"] = unused
        meta["primary_inner_pack"] = primary
        fg_batch.meta_json = meta
        if unused <= 0 or not primary.get("material_id"):
            return 0
        source = (
            PackagingTransaction.objects.filter(id__in=primary.get("consume_tx_ids") or [], type="CONSUME")
            .order_by("qty")
            .first()
        ) or (
            PackagingTransaction.objects.filter(
                type="CONSUME",
                material_id=primary.get("material_id"),
                meta_json__fg_batch_id=str(fg_batch.id),
            )
            .order_by("qty")
            .first()
        )
        location_id = getattr(source, "location_id", None) or fg_batch.location_id
        if not location_id:
            return 0
        PackagingService.return_unused_packaging_stock(
            material_id=primary["material_id"],
            qty=unused,
            location_id=location_id,
            cost=getattr(source, "avg_cost", 0) or 0,
            job_id=fg_batch.production_job_id,
            sales_order_item_id=fg_batch.sales_order_item_id,
            reference=f"PACKING_CHECK:{fg_batch.batch_number}",
            meta_json={
                "fg_batch_id": str(fg_batch.id),
                "packs_consumed_at_machine": consumed,
                "packs_used_in_units": used,
                "actor": getattr(user, "username", "") if getattr(user, "is_authenticated", False) else "",
            },
        )
        return unused

    @staticmethod
    def held_batch_message(fg_batch_id) -> str | None:
        from apps.production.models import PackingVerification

        if not fg_batch_id:
            return None
        verification = PackingVerification.objects.filter(fg_batch_id=fg_batch_id, status="HELD").select_related("fg_batch").first()
        if verification is None:
            return None
        return (
            f"Batch {verification.fg_batch.batch_number} is on hold at the packing check "
            f"(pieces {verification.pcs_variance_pct}%, weight {verification.kg_variance_pct}%). "
            "A supervisor must accept it with a reason before dispatch."
        )
