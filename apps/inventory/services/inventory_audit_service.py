"""
Phase 58: Inventory Audit & Reconciliation Service
Detects mismatches, generates alerts, creates snapshots.
"""
from decimal import Decimal
from typing import List, Dict, Any
from django.db import transaction
from django.db.models import Count, Max as models_Max, Sum, F, Q
from django.utils import timezone
from datetime import timedelta

from apps.inventory.models import (
    InventoryBulk, BulkTransaction, InventoryRoll, 
    InventorySnapshot, InventoryAlert, InventoryLocation,
    RollConsumption, RollLink
)
from apps.factory.models import Plant
from apps.production.models import ScrapLog
import logging

logger = logging.getLogger(__name__)


class InventoryAuditService:
    """
    Reconciliation engine for inventory auditing.
    Checks: 
    - Bulk: sum(BulkTransaction) == InventoryBulk.qty
    - Roll: original_weight == consumed + balance + scrap + children
    """

    @classmethod
    @transaction.atomic
    def create_snapshot(cls, plant: Plant) -> InventorySnapshot:
        """
        Creates a point-in-time snapshot of inventory state for a plant.
        """
        # Aggregate bulk
        bulk_totals = InventoryBulk.objects.filter(plant=plant).aggregate(
            total_kg=Sum('qty_kg'),
            count=Count('id'),
        )
        
        # Aggregate rolls
        rolls_qs = InventoryRoll.objects.filter(location__plant=plant)
        
        total_roll_kg = rolls_qs.filter(status='AVAILABLE').aggregate(total=Sum('weight_kg'))['total'] or Decimal('0')
        fg_roll_kg = rolls_qs.filter(status='AVAILABLE', is_fg=True).aggregate(total=Sum('weight_kg'))['total'] or Decimal('0')
        wip_roll_kg = rolls_qs.filter(status='AVAILABLE', is_fg=False).exclude(stage_index=0).aggregate(total=Sum('weight_kg'))['total'] or Decimal('0')
        reserved_kg = rolls_qs.filter(status='RESERVED').aggregate(total=Sum('weight_kg'))['total'] or Decimal('0')
        
        # Scrap from logs (last 24h)
        yesterday = timezone.now() - timedelta(days=1)
        scrap_kg = ScrapLog.objects.filter(
            production_job__work_center__plant=plant,
            logged_at__gte=yesterday
        ).aggregate(total=Sum('quantity'))['total'] or Decimal('0')
        
        # Counts
        roll_count = rolls_qs.filter(status='AVAILABLE').count()
        fg_roll_count = rolls_qs.filter(status='AVAILABLE', is_fg=True).count()
        bulk_sku_count = InventoryBulk.objects.filter(plant=plant, qty_kg__gt=0).count()
        
        snapshot = InventorySnapshot.objects.create(
            plant=plant,
            total_bulk_kg=bulk_totals['total_kg'] or Decimal('0'),
            total_roll_kg=total_roll_kg,
            total_fg_kg=fg_roll_kg,
            total_wip_kg=wip_roll_kg,
            reserved_roll_kg=reserved_kg,
            scrap_kg=scrap_kg,
            bulk_sku_count=bulk_sku_count,
            roll_count=roll_count,
            fg_roll_count=fg_roll_count
        )
        
        logger.info(f"Created inventory snapshot for {plant.code}: {snapshot.id}")
        return snapshot

    # Alert types the nightly reconciliation owns: it raises them, keeps the
    # open row current on every run, and resolves them when the condition
    # clears. Alerts of other types (LOW_STOCK, COST_MISMATCH) are untouched.
    RECONCILIATION_ALERT_TYPES = ("TXN_MISMATCH", "NEGATIVE_STOCK", "WEIGHT_MISMATCH", "ORPHAN_ROLL", "STUCK_WIP")
    AUTO_RESOLUTION_NOTE = "Resolved automatically: the condition was not found by the nightly reconciliation."

    @staticmethod
    def bulk_scope_key(material_id, granule_code_id, location_id) -> str:
        return f"bulk:{material_id}:{granule_code_id or '-'}:{location_id}"

    @staticmethod
    def roll_scope_key(roll_id) -> str:
        return f"roll:{roll_id}"

    @classmethod
    def _raise_alert(cls, *, scope_key: str, type: str, message: str, severity: str, seen: set, **context) -> InventoryAlert:
        """Update the open alert for this condition, or create it."""
        now = timezone.now()
        seen.add((type, scope_key))
        alert = InventoryAlert.objects.filter(type=type, scope_key=scope_key, resolved=False).order_by("created_at").first()
        if alert is None:
            return InventoryAlert.objects.create(type=type, scope_key=scope_key, message=message, severity=severity, last_seen_at=now, **context)
        alert.message = message
        alert.severity = severity
        alert.last_seen_at = now
        for field, value in context.items():
            setattr(alert, field, value)
        alert.save(update_fields=["message", "severity", "last_seen_at", *context.keys()])
        return alert

    @classmethod
    def _resolve_cleared(cls, types, seen: set, plant: Plant = None) -> int:
        """Resolve open keyed alerts of these types that this run did not re-raise."""
        qs = InventoryAlert.objects.filter(type__in=types, resolved=False).exclude(scope_key="")
        if plant:
            qs = qs.filter(plant=plant)
        resolved = 0
        for alert in qs.only("id", "type", "scope_key"):
            if (alert.type, alert.scope_key) in seen:
                continue
            InventoryAlert.objects.filter(pk=alert.pk, resolved=False).update(
                resolved=True, resolved_at=timezone.now(), resolution_note=cls.AUTO_RESOLUTION_NOTE
            )
            resolved += 1
        return resolved

    @classmethod
    def bulk_ledger_gaps(cls, plant: Plant = None, tolerance: Decimal = Decimal("0.01")) -> List[Dict[str, Any]]:
        """Stock rows whose quantity differs from their own ledger.

        Bulk stock is held per material + quality code + location, and the
        ledger rows carry the same three keys, so each stock row is compared
        with the ledger of its own quality code (a null code matches null).
        """
        bulk_qs = InventoryBulk.objects.select_related("material", "granule_code", "location", "plant")
        if plant:
            bulk_qs = bulk_qs.filter(plant=plant)
        ledger = {}
        last_seen = {}
        tx_qs = BulkTransaction.objects.values("material_id", "granule_code_id", "location_id").annotate(total=Sum("qty_kg"), last=models_Max("created_at"))
        if plant:
            tx_qs = tx_qs.filter(location__plant=plant)
        for row in tx_qs:
            key = (row["material_id"], row["granule_code_id"], row["location_id"])
            ledger[key] = row["total"] or Decimal("0")
            last_seen[key] = row["last"]
        gaps = []
        for bulk in bulk_qs.order_by("plant__code", "location__name", "material__code"):
            key = (bulk.material_id, bulk.granule_code_id, bulk.location_id)
            ledger_qty = ledger.get(key, Decimal("0"))
            stock_qty = bulk.qty_kg or Decimal("0")
            if abs(stock_qty - ledger_qty) <= tolerance:
                continue
            gaps.append({
                "bulk": bulk,
                "scope_key": cls.bulk_scope_key(bulk.material_id, bulk.granule_code_id, bulk.location_id),
                "stock_qty": stock_qty,
                "ledger_qty": ledger_qty,
                "gap": stock_qty - ledger_qty,
                "has_ledger": key in ledger,
                "last_ledger_at": last_seen.get(key),
            })
        return gaps

    @classmethod
    def run_bulk_reconciliation(cls, plant: Plant = None) -> List[InventoryAlert]:
        """
        Checks: sum(BulkTransaction) == InventoryBulk.qty_kg for each
        material + quality code + location. Keeps one open alert per stock
        row, and resolves alerts whose row now ties to its ledger.
        Returns the alerts that are open after this run.
        """
        alerts = []
        seen = set()
        for gap in cls.bulk_ledger_gaps(plant):
            bulk = gap["bulk"]
            code = f" [{bulk.granule_code.code}]" if bulk.granule_code_id else ""
            difference = abs(gap["gap"])
            alert = cls._raise_alert(
                scope_key=gap["scope_key"],
                type="TXN_MISMATCH",
                message=f"Bulk {bulk.material.code}{code} @ {bulk.location.name}: "
                        f"Expected {gap['ledger_qty']}kg from transactions, actual {gap['stock_qty']}kg",
                severity="HIGH" if difference > Decimal("10") else "MEDIUM",
                seen=seen,
                material=bulk.material,
                plant=bulk.plant,
                expected_value=gap["ledger_qty"],
                actual_value=gap["stock_qty"],
            )
            alerts.append(alert)
            logger.warning("Bulk mismatch detected: %s", alert.message)

        negative_qs = InventoryBulk.objects.filter(qty_kg__lt=0).select_related("material", "location", "plant")
        if plant:
            negative_qs = negative_qs.filter(plant=plant)
        for bulk in negative_qs:
            alert = cls._raise_alert(
                scope_key=cls.bulk_scope_key(bulk.material_id, bulk.granule_code_id, bulk.location_id),
                type="NEGATIVE_STOCK",
                message=f"Negative bulk stock: {bulk.material.code} @ {bulk.location.name} = {bulk.qty_kg}kg",
                severity="CRITICAL",
                seen=seen,
                material=bulk.material,
                plant=bulk.plant,
                actual_value=bulk.qty_kg,
            )
            alerts.append(alert)
            logger.error("Negative stock: %s", alert.message)

        cls._resolve_cleared(("TXN_MISMATCH", "NEGATIVE_STOCK"), seen, plant)
        return alerts

    @classmethod
    def run_roll_reconciliation(cls, plant: Plant = None) -> List[InventoryAlert]:
        """
        Checks roll weight integrity:
        original_weight == consumed + current_weight + scrap + children_weight
        Returns the alerts that are open after this run.
        """
        alerts = []
        seen = set()
        
        rolls_qs = InventoryRoll.objects.exclude(status='CONSUMED').exclude(original_weight_kg__isnull=True)
        if plant:
            rolls_qs = rolls_qs.filter(location__plant=plant)
        
        for roll in rolls_qs:
            original = roll.original_weight_kg or roll.weight_kg
            current = roll.weight_kg
            
            # Sum consumed weight from RollConsumption
            consumed = RollConsumption.objects.filter(
                input_roll=roll
            ).aggregate(total=Sum('consumed_kg'))['total'] or Decimal('0')
            
            # Sum children weight from RollLink
            children = RollLink.objects.filter(parent_roll=roll)
            children_weight = sum(
                c.child_roll.original_weight_kg or c.child_roll.weight_kg 
                for c in children if c.child_roll
            )
            
            # Scrap for this roll (if any)
            scrap = Decimal('0')  # Would need roll-specific scrap tracking
            
            # Calculate expected
            expected_remaining = original - consumed - Decimal(str(children_weight)) - scrap
            difference = abs(current - expected_remaining)
            
            if difference > Decimal('0.01') and children_weight > 0:
                alerts.append(cls._raise_alert(
                    scope_key=cls.roll_scope_key(roll.id),
                    type='WEIGHT_MISMATCH',
                    message=f"Roll {roll.label_id}: Original {original}kg, "
                            f"Consumed {consumed}kg, Children {children_weight}kg, "
                            f"Expected balance {expected_remaining}kg, Actual {current}kg",
                    severity='MEDIUM',
                    seen=seen,
                    roll=roll,
                    plant=roll.location.plant if roll.location else None,
                    expected_value=expected_remaining,
                    actual_value=current,
                ))
            
            # Check for orphan rolls (no parent, not from GRN)
            if roll.stage_index > 0:
                has_parent = RollLink.objects.filter(child_roll=roll).exists()
                if not has_parent:
                    # Check if created by production
                    if not roll.production_job:
                        alerts.append(cls._raise_alert(
                            scope_key=cls.roll_scope_key(roll.id),
                            type='ORPHAN_ROLL',
                            message=f"Roll {roll.label_id} (Stage {roll.stage_index}) has no parent link",
                            severity='LOW',
                            seen=seen,
                            roll=roll,
                            plant=roll.location.plant if roll.location else None,
                        ))
        
        cls._resolve_cleared(("WEIGHT_MISMATCH", "ORPHAN_ROLL"), seen, plant)
        return alerts

    @classmethod
    def check_stuck_wip(cls, plant: Plant = None, days_threshold: int = 7) -> List[InventoryAlert]:
        """
        Finds WIP rolls that haven't moved in N days. One open alert per roll;
        resolved once the roll moves on.
        """
        alerts = []
        seen = set()
        threshold_date = timezone.now() - timedelta(days=days_threshold)
        
        wip_qs = InventoryRoll.objects.filter(
            status='AVAILABLE',
            is_fg=False,
            stage_index__gt=0,
            created_at__lt=threshold_date
        )
        if plant:
            wip_qs = wip_qs.filter(location__plant=plant)
        
        for roll in wip_qs:
            days_stuck = (timezone.now() - roll.created_at).days
            alerts.append(cls._raise_alert(
                scope_key=cls.roll_scope_key(roll.id),
                type='STUCK_WIP',
                message=f"Roll {roll.label_id} stuck at Stage {roll.stage_index} for {days_stuck} days",
                severity='MEDIUM' if days_stuck < 14 else 'HIGH',
                seen=seen,
                roll=roll,
                plant=roll.location.plant if roll.location else None,
            ))
        
        cls._resolve_cleared(("STUCK_WIP",), seen, plant)
        return alerts

    @classmethod
    def run_full_audit(cls, plant: Plant = None) -> Dict[str, Any]:
        """
        Runs complete reconciliation and returns summary of open alerts.
        """
        bulk_alerts = cls.run_bulk_reconciliation(plant)
        roll_alerts = cls.run_roll_reconciliation(plant)
        wip_alerts = cls.check_stuck_wip(plant)
        
        all_alerts = bulk_alerts + roll_alerts + wip_alerts
        
        summary = {
            'total_alerts': len(all_alerts),
            'bulk_mismatches': len(bulk_alerts),
            'roll_issues': len(roll_alerts),
            'stuck_wip': len(wip_alerts),
            'critical_count': len([a for a in all_alerts if a.severity == 'CRITICAL']),
            'high_count': len([a for a in all_alerts if a.severity == 'HIGH']),
        }
        
        logger.info(f"Audit complete: {summary}")
        return summary

    @classmethod
    def get_roll_genealogy(cls, roll_id: str) -> Dict[str, Any]:
        """
        Returns complete genealogy tree for a roll.
        """
        try:
            roll = InventoryRoll.objects.get(id=roll_id)
        except InventoryRoll.DoesNotExist:
            return {'error': 'Roll not found'}
        
        def _stage_role(r):
            try:
                from apps.inventory.serializers import resolve_roll_role, resolve_roll_stage_name
                return {
                    "roll_role": resolve_roll_role(r),
                    "stage_name": resolve_roll_stage_name(r),
                }
            except Exception:
                return {
                    "roll_role": None,
                    "stage_name": None,
                }

        def build_tree(r):
            stage_role = _stage_role(r)
            node = {
                'id': str(r.id),
                'label_id': r.label_id,
                'material_name': r.material.name if r.material else None,
                'grade_name': r.grade.name if r.grade else None,
                'width_mm': float(r.width_mm or 0),
                'thickness_micron': float(r.thickness_micron or 0),
                'weight_kg': float(r.weight_kg),
                'original_weight_kg': float(r.original_weight_kg) if r.original_weight_kg else float(r.weight_kg),
                'status': r.status,
                'stage_index': r.stage_index,
                'stage_name': stage_role.get("stage_name"),
                'roll_role': stage_role.get("roll_role"),
                'created_at': r.created_at.isoformat() if r.created_at else None,
                'job_number': r.production_job.job_number if r.production_job else None,
                'location': r.location.name if r.location else None,
                'children': [],
                'consumptions': []
            }
            
            # Get children
            child_links = RollLink.objects.filter(parent_roll=r).select_related('child_roll')
            for link in child_links:
                if link.child_roll:
                    node['children'].append(build_tree(link.child_roll))
            
            # Get consumptions (input_roll is the correct field)
            consumptions = RollConsumption.objects.filter(input_roll=r)
            for c in consumptions:
                node['consumptions'].append({
                    'consumed_kg': float(c.consumed_kg),
                    'output_roll_id': str(c.output_roll_id) if c.output_roll_id else None,
                    'job_number': c.job.job_number if c.job else None,
                    'timestamp': c.timestamp.isoformat() if c.timestamp else None
                })
            
            return node
        
        # Find all roots (a DAG might have multiple roots)
        from collections import deque
        roots = set()
        queue = deque([roll])
        visited = set()
        
        while queue:
            current = queue.popleft()
            if current.id in visited:
                continue
            visited.add(current.id)
            
            parent_links = RollLink.objects.filter(child_roll=current).select_related('parent_roll')
            if not parent_links.exists():
                roots.add(current)
            else:
                for link in parent_links:
                    if link.parent_roll:
                        queue.append(link.parent_roll)
        
        trees = [build_tree(r) for r in roots]
        
        return {
            'roll_id': str(roll.id),
            'trees': trees,
            'ancestors': cls._get_ancestors(roll),
            'timeline': cls._get_timeline(roll)
        }

    @classmethod
    def _get_ancestors(cls, roll: InventoryRoll) -> List[Dict]:
        """Get list of parent rolls up to root (handles DAGs)."""
        ancestors = []
        from collections import deque
        queue = deque([roll])
        visited = set()
        
        while queue:
            current = queue.popleft()
            if current.id in visited:
                continue
            visited.add(current.id)
            
            parent_links = RollLink.objects.filter(child_roll=current).select_related('parent_roll')
            for link in parent_links:
                if link.parent_roll and link.parent_roll.id not in visited:
                    p = link.parent_roll
                    # Prevent duplicating in return list if multiple paths reach same node
                    if not any(a['id'] == str(p.id) for a in ancestors):
                        ancestors.append({
                            'id': str(p.id),
                            'label_id': p.label_id,
                            'stage_index': p.stage_index,
                            'weight_kg': float(p.weight_kg)
                        })
                    queue.append(p)
        
        return ancestors

    @classmethod
    def _get_timeline(cls, roll: InventoryRoll) -> List[Dict]:
        """Get movement and consumption timeline for a roll."""
        from apps.inventory.models import RollMovement
        
        timeline = []
        
        # Movements
        movements = RollMovement.objects.filter(roll=roll).order_by('timestamp')
        for m in movements:
            timeline.append({
                'type': 'MOVEMENT',
                'timestamp': m.timestamp.isoformat(),
                'from': m.from_location.name if m.from_location else 'NEW',
                'to': m.to_location.name if m.to_location else None,
                'reason': m.reason
            })
        
        # Consumptions (input_roll is the correct field)
        consumptions = RollConsumption.objects.filter(input_roll=roll).order_by('timestamp')
        for c in consumptions:
            timeline.append({
                'type': 'CONSUMPTION',
                'timestamp': c.timestamp.isoformat() if c.timestamp else None,
                'consumed_kg': float(c.consumed_kg),
                'job': c.job.job_number if c.job else None
            })
        
        # Sort by timestamp
        timeline.sort(key=lambda x: x.get('timestamp') or '')
        
        return timeline

    @classmethod
    def get_health_summary(cls, plant: Plant = None) -> Dict[str, Any]:
        """
        Returns current inventory health metrics.
        """
        # Bulk totals
        bulk_qs = InventoryBulk.objects.all()
        if plant:
            bulk_qs = bulk_qs.filter(plant=plant)
        
        bulk_total = bulk_qs.aggregate(total=Sum('qty_kg'))['total'] or Decimal('0')
        bulk_count = bulk_qs.filter(qty_kg__gt=0).count()
        
        # Roll totals
        roll_qs = InventoryRoll.objects.all()
        if plant:
            roll_qs = roll_qs.filter(location__plant=plant)
        
        available_rolls = roll_qs.filter(status='AVAILABLE')
        reserved_rolls = roll_qs.filter(status='RESERVED')
        fg_rolls = available_rolls.filter(is_fg=True)
        
        # Alerts
        alert_qs = InventoryAlert.objects.filter(resolved=False)
        if plant:
            alert_qs = alert_qs.filter(plant=plant)
        
        return {
            'bulk': {
                'total_kg': float(bulk_total),
                'sku_count': bulk_count
            },
            'rolls': {
                'available_count': available_rolls.count(),
                'available_kg': float(available_rolls.aggregate(total=Sum('weight_kg'))['total'] or 0),
                'reserved_count': reserved_rolls.count(),
                'reserved_kg': float(reserved_rolls.aggregate(total=Sum('weight_kg'))['total'] or 0),
                'fg_count': fg_rolls.count(),
                'fg_kg': float(fg_rolls.aggregate(total=Sum('weight_kg'))['total'] or 0)
            },
            'alerts': {
                'total_open': alert_qs.count(),
                'critical': alert_qs.filter(severity='CRITICAL').count(),
                'high': alert_qs.filter(severity='HIGH').count()
            }
        }

    # ------------------------------------------------------------------
    # Sprint 3 — Reorder policy / low-stock alert generator
    # ------------------------------------------------------------------
    @classmethod
    @transaction.atomic
    def generate_low_stock_alerts(cls, *, plant: Plant = None) -> Dict[str, int]:
        """For every InventoryMaterial with reorder_qty > 0, check current
        available stock (bulk + AVAILABLE rolls) against reorder_qty + safety_stock.

        Raises a LOW_STOCK alert (severity = HIGH if also < safety_stock else MEDIUM)
        and resolves any existing alert when stock recovers to reorder_qty + 10%.

        Per-plant when ``plant`` is provided; otherwise scans aggregate stock across all plants.

        Returns ``{"raised": int, "resolved": int, "scanned": int}``.
        """
        from apps.materials.models import InventoryMaterial

        materials = InventoryMaterial.objects.filter(
            reorder_qty__isnull=False, reorder_qty__gt=0, status="ACTIVE"
        )
        scanned = 0
        raised = 0
        resolved = 0
        for material in materials.iterator():
            scanned += 1
            reorder = Decimal(str(material.reorder_qty or 0))
            safety = Decimal(str(material.safety_stock or 0))
            # Stock roll-up: bulk + available rolls.
            bulk_qs = InventoryBulk.objects.filter(material=material)
            roll_qs = InventoryRoll.objects.filter(material=material, status="AVAILABLE")
            if plant:
                bulk_qs = bulk_qs.filter(plant=plant)
                roll_qs = roll_qs.filter(location__plant=plant)
            available = (
                (bulk_qs.aggregate(t=Sum("qty_kg"))["t"] or Decimal("0"))
                + (roll_qs.aggregate(t=Sum("weight_kg"))["t"] or Decimal("0"))
            )

            existing = InventoryAlert.objects.filter(
                material=material, type="LOW_STOCK", resolved=False, plant=plant
            ).first()

            if available < reorder:
                severity = "HIGH" if (safety > 0 and available < safety) else "MEDIUM"
                message = (
                    f"{material.code}: stock {available:.3f} {material.base_uom or 'KG'} "
                    f"below reorder {reorder:.3f}. Safety {safety:.3f}."
                )
                if existing:
                    existing.severity = severity
                    existing.message = message
                    existing.expected_value = reorder
                    existing.actual_value = available
                    existing.save(update_fields=["severity", "message", "expected_value", "actual_value"])
                else:
                    InventoryAlert.objects.create(
                        type="LOW_STOCK",
                        message=message,
                        severity=severity,
                        material=material,
                        plant=plant,
                        expected_value=reorder,
                        actual_value=available,
                    )
                    raised += 1
            else:
                # Recovery: resolve alert once stock is at reorder * 1.10 or better.
                if existing and available >= (reorder * Decimal("1.10")):
                    existing.resolved = True
                    existing.resolved_at = timezone.now()
                    existing.resolution_note = (
                        f"Stock recovered to {available:.3f}, above reorder {reorder:.3f} +10%."
                    )
                    existing.save(
                        update_fields=["resolved", "resolved_at", "resolution_note"]
                    )
                    resolved += 1
        logger.info(
            "generate_low_stock_alerts: scanned=%d raised=%d resolved=%d plant=%s",
            scanned,
            raised,
            resolved,
            getattr(plant, "code", "ALL"),
        )
        return {"raised": raised, "resolved": resolved, "scanned": scanned}
