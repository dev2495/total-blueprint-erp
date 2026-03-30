"""
Phase 54: Roll Service
Core engine for roll operations: split, merge, consume, move, reserve, release.

Design Philosophy:
- Rolls are physical assets (like money in a bank)
- Never update weight directly
- Always SPLIT/CREATE/CONSUME to change quantities
- Full genealogy tracking via RollLink
"""
from decimal import Decimal
from typing import List, Optional, Dict, Any
from django.db import transaction
from django.utils import timezone
import uuid

from apps.inventory.models import (
    InventoryRoll, InventoryLocation, RollLink, RollConsumption, RollMovement
)
from apps.production.models import ProductionJob
from apps.factory.models import Process, Machine


class RollService:
    """
    Core service for all roll operations.
    All weight changes must go through this service.
    """

    # Stage index mapping for standard production flow
    STAGE_MAP = {
        'RM': 0,          # Raw Material
        'EXTRUDED': 1,    # After Extrusion
        'PRINTED': 2,     # After Printing
        'LAMINATED': 3,   # After Lamination
        'SLIT': 4,        # After Slitting
        'FG': 5,          # Finished Goods
    }

    @staticmethod
    def generate_roll_code(prefix: str = 'ROLL') -> str:
        """Generate unique roll code with date stamp."""
        from datetime import datetime
        date_str = datetime.now().strftime('%Y%m%d')
        unique_suffix = str(uuid.uuid4())[:8].upper()
        return f"{prefix}-{date_str}-{unique_suffix}"

    @staticmethod
    def _resolve_density_gcm3(material=None, roll: InventoryRoll = None):
        if roll is not None:
            existing = getattr(roll, "density_gcm3", None)
            if existing not in (None, ""):
                try:
                    return Decimal(str(existing))
                except Exception:
                    pass
            material = material or getattr(roll, "material", None)

        if material is None:
            return None

        family = getattr(material, "parent_family", None)
        family_density = getattr(family, "density_gcm3", None) if family else None
        if family_density not in (None, ""):
            try:
                return Decimal(str(family_density))
            except Exception:
                pass

        material_density = getattr(material, "density_gcm3", None)
        if material_density not in (None, ""):
            try:
                return Decimal(str(material_density))
            except Exception:
                pass
        return None

    @classmethod
    @transaction.atomic
    def create_roll(
        cls,
        material,
        weight_kg: Decimal,
        location: InventoryLocation,
        width_mm: Decimal,
        thickness_micron: Decimal,
        batch_no: str = None,
        length_m: Decimal = Decimal('0'),
        grade=None,
        is_fg: bool = False,
        plant=None,
        user=None,
        notes: str = ""
    ) -> InventoryRoll:
        """
        Create a new physical roll (e.g. from GRN or Job Work Inward).
        """
        if weight_kg <= 0:
            raise ValueError("Roll weight must be positive")
        if material is None:
            raise ValueError("Material is required for roll creation")
        if getattr(material, "category", None) != "FILM_VARIANT":
            raise ValueError("Roll material must be a FILM_VARIANT")
        if Decimal(str(width_mm or 0)) <= 0:
            raise ValueError("Roll width must be positive")
        if Decimal(str(thickness_micron or 0)) <= 0:
            raise ValueError("Roll thickness must be positive")
        grade_required = bool(getattr(material, "is_extrudable", False))
        if grade_required and grade is None:
            raise ValueError("Roll grade is required for extrudable variants")
        if not grade_required:
            grade = None

        if not batch_no:
            # Auto-generate batch if not provided
            from datetime import date
            import random, string
            date_str = date.today().strftime('%Y%m%d')
            suffix = ''.join(random.choices(string.ascii_uppercase + string.digits, k=4))
            batch_no = f"AUTO-{date_str}-{suffix}"

        roll = InventoryRoll.objects.create(
            label_id=cls.generate_roll_code(),
            material=material,
            batch_no=batch_no,
            weight_kg=weight_kg,
            original_weight_kg=weight_kg,
            location=location,
            width_mm=width_mm,
            thickness_micron=thickness_micron,
            density_gcm3=cls._resolve_density_gcm3(material=material),
            grade=grade,
            is_fg=is_fg,
            plant=plant or location.plant,
            status='AVAILABLE',
            stage_index=cls.STAGE_MAP.get(is_fg and 'FG' or 'RM', 0)
        )

        # Log initial movement (Creation)
        RollMovement.objects.create(
            roll=roll,
            to_location=location,
            reason='GRN' if not notes else 'ADJUSTMENT', # Default reasoning, can be refined
            reason_note=notes or "Initial Creation",
            moved_by=user
        )

        return roll

    @classmethod
    @transaction.atomic
    def split_roll(
        cls,
        parent_roll: InventoryRoll,
        splits: List[Dict[str, Any]],
        reason: str = 'SPLIT',
        user=None
    ) -> List[InventoryRoll]:
        """
        Split parent roll into multiple child rolls.
        
        Args:
            parent_roll: The roll to split
            splits: List of dicts with keys: weight_kg, label_suffix (optional)
            reason: Reason for split (for movement log)
            user: User performing the operation
            
        Returns:
            List of created child rolls
            
        Example:
            splits = [
                {'weight_kg': 80, 'label_suffix': 'USED'},
                {'weight_kg': 15, 'label_suffix': 'BAL'},
                {'weight_kg': 5, 'label_suffix': 'SCRAP'}
            ]
        """
        total_split = sum(Decimal(str(s['weight_kg'])) for s in splits)
        if total_split > parent_roll.weight_kg:
            raise ValueError(f"Split total ({total_split}kg) exceeds parent weight ({parent_roll.weight_kg}kg)")

        children = []
        for split in splits:
            weight = Decimal(str(split['weight_kg']))
            if weight <= 0:
                continue
                
            suffix = split.get('label_suffix', str(len(children) + 1))
            parent_meta = dict(parent_roll.meta_json or {})
            split_meta = split.get('meta') or {}
            merged_meta = {**parent_meta, **split_meta}
            child = InventoryRoll.objects.create(
                label_id=f"{parent_roll.label_id}-{suffix}",
                material=parent_roll.material,
                batch_no=parent_roll.batch_no,
                thickness_micron=parent_roll.thickness_micron,
                width_mm=parent_roll.width_mm,
                grade=parent_roll.grade,
                plant=parent_roll.plant,
                density_gcm3=cls._resolve_density_gcm3(roll=parent_roll),
                original_weight_kg=weight,
                weight_kg=weight,
                location=parent_roll.location,
                status='AVAILABLE',
                stage_index=parent_roll.stage_index,
                parent_roll=parent_roll,  # Legacy FK
                created_by_job=parent_roll.created_by_job,
                created_process=parent_roll.created_process,
                is_fg=parent_roll.is_fg,
                template=parent_roll.template,
                current_step_index=parent_roll.current_step_index,
                completed_step_index=parent_roll.completed_step_index,
                geometry_override=parent_roll.geometry_override or {},
                production_job=parent_roll.production_job,
                sales_order_item=parent_roll.sales_order_item,
                meta_json=merged_meta,
            )
            
            # Create genealogy link
            RollLink.objects.create(
                parent_roll=parent_roll,
                child_roll=child,
                relation_type='SPLIT',
                qty_used_kg=weight
            )
            
            children.append(child)

        # Close parent roll
        parent_roll.status = 'CONSUMED'
        parent_roll.weight_kg = Decimal('0')
        parent_roll.save()

        return children

    @classmethod
    @transaction.atomic
    def merge_rolls(
        cls,
        input_rolls: List[InventoryRoll],
        output_weight_kg: Decimal,
        output_location: InventoryLocation,
        job: ProductionJob = None,
        process: Process = None,
        user=None,
        label_prefix: str = 'MERGED'
    ) -> InventoryRoll:
        """
        Merge multiple rolls into one (e.g., lamination).
        
        Args:
            input_rolls: List of rolls to merge
            output_weight_kg: Weight of merged output
            output_location: Where to create the merged roll
            job: Production job (if applicable)
            process: Process performing the merge
            user: User performing the operation
            
        Returns:
            The newly created merged roll
        """
        if not input_rolls:
            raise ValueError("No input rolls provided for merge")

        # Use first roll as template for material properties
        template_roll = input_rolls[0]
        
        # Calculate stage index (next stage after highest input)
        max_stage = max(r.stage_index for r in input_rolls)
        new_stage = max_stage + 1

        # Create merged roll
        merged_roll = InventoryRoll.objects.create(
            label_id=cls.generate_roll_code(label_prefix),
                material=template_roll.material,
                batch_no=f"MERGE-{timezone.now().strftime('%Y%m%d')}",
                thickness_micron=sum(r.thickness_micron for r in input_rolls),  # Sum for lamination
                width_mm=template_roll.width_mm,
                density_gcm3=cls._resolve_density_gcm3(roll=template_roll),
                original_weight_kg=output_weight_kg,
                weight_kg=output_weight_kg,
                location=output_location,
                status='AVAILABLE',
            stage_index=new_stage,
            created_by_job=job,
            created_process=process,
            template=template_roll.template,
            sales_order_item=template_roll.sales_order_item,
        )

        # Create genealogy links for all parents
        for input_roll in input_rolls:
            RollLink.objects.create(
                parent_roll=input_roll,
                child_roll=merged_roll,
                relation_type='MERGE',
                qty_used_kg=input_roll.weight_kg
            )
            
            # Log consumption for traceability if this is part of a production job
            if job and process:
                RollConsumption.objects.create(
                    job=job,
                    process=process,
                    input_roll=input_roll,
                    output_roll=merged_roll if input_roll == input_rolls[0] else None, # Link to first one for logic
                    consumed_kg=input_roll.weight_kg,
                    output_kg=output_weight_kg if input_roll == input_rolls[0] else Decimal('0'),
                    machine=None, # Machine might not be relevant for simple merge? Or pass it in.
                    operator=user
                )

            # Mark input roll as consumed
            input_roll.status = 'CONSUMED'
            input_roll.weight_kg = Decimal('0')
            input_roll.save()

        # Log movement
        cls.log_movement(
            roll=merged_roll,
            to_location=output_location,
            reason='PRODUCTION',
            job=job,
            user=user
        )

        return merged_roll

    @classmethod
    @transaction.atomic
    def consume_roll(
        cls,
        input_roll: InventoryRoll,
        job: ProductionJob,
        process: Process,
        machine: Machine,
        used_kg: Decimal,
        scrap_kg: Decimal = Decimal('0'),
        output_location: InventoryLocation = None,
        user=None,
        notes: str = ''
    ) -> Dict[str, Optional[InventoryRoll]]:
        """
        Process consumption with automatic child roll creation.
        
        Creates up to 3 child rolls:
        - output_roll: The processed output
        - balance_roll: Remaining unused material
        - scrap_roll: Waste material (if any)
        
        Args:
            input_roll: Roll being consumed
            job: Production job
            process: Process performing consumption
            machine: Machine used
            used_kg: Weight consumed for output
            scrap_kg: Weight lost as scrap
            output_location: Where to place output (defaults to input location)
            user: Operator
            notes: Additional notes
            
        Returns:
            Dict with keys: output_roll, balance_roll, scrap_roll (any can be None)
        """
        if input_roll.status not in ('AVAILABLE', 'RESERVED', 'IN_PROCESS'):
            raise ValueError(f"Roll {input_roll.label_id} is not available for consumption (status: {input_roll.status})")

        total_consumed = used_kg + scrap_kg
        if total_consumed > input_roll.weight_kg:
            raise ValueError(f"Total consumption ({total_consumed}kg) exceeds roll weight ({input_roll.weight_kg}kg)")

        balance_kg = input_roll.weight_kg - total_consumed
        output_loc = output_location or input_roll.location
        
        result = {
            'output_roll': None,
            'balance_roll': None,
            'scrap_roll': None
        }

        # Calculate new stage index
        new_stage = input_roll.stage_index + 1

        # Create output roll (if there's actual output)
        if used_kg > 0:
            output_roll = InventoryRoll.objects.create(
                label_id=cls.generate_roll_code('OUT'),
                material=input_roll.material,
                batch_no=input_roll.batch_no,
                thickness_micron=input_roll.thickness_micron,
                width_mm=input_roll.width_mm,
                density_gcm3=cls._resolve_density_gcm3(roll=input_roll),
                original_weight_kg=used_kg,
                weight_kg=used_kg,
                location=output_loc,
                status='AVAILABLE',
                stage_index=new_stage,
                parent_roll=input_roll,
                created_by_job=job,
                created_process=process,
                template=input_roll.template,
                sales_order_item=input_roll.sales_order_item,
            )
            RollLink.objects.create(
                parent_roll=input_roll,
                child_roll=output_roll,
                relation_type='PROCESS_OUTPUT',
                qty_used_kg=used_kg
            )
            result['output_roll'] = output_roll
            
            # Log movement for output
            if output_loc != input_roll.location:
                cls.log_movement(
                    roll=output_roll,
                    from_location=input_roll.location,
                    to_location=output_loc,
                    reason='PRODUCTION',
                    job=job,
                    user=user
                )

        # Create balance roll (if there's remaining material)
        if balance_kg > 0:
            balance_roll = InventoryRoll.objects.create(
                label_id=f"{input_roll.label_id}-BAL",
                material=input_roll.material,
                batch_no=input_roll.batch_no,
                thickness_micron=input_roll.thickness_micron,
                width_mm=input_roll.width_mm,
                density_gcm3=cls._resolve_density_gcm3(roll=input_roll),
                original_weight_kg=balance_kg,
                weight_kg=balance_kg,
                location=input_roll.location,
                status='AVAILABLE',
                stage_index=input_roll.stage_index,  # Same stage as parent
                parent_roll=input_roll,
                template=input_roll.template,
                sales_order_item=input_roll.sales_order_item,
            )
            RollLink.objects.create(
                parent_roll=input_roll,
                child_roll=balance_roll,
                relation_type='SPLIT',
                qty_used_kg=balance_kg
            )
            result['balance_roll'] = balance_roll

        # Create scrap roll (if there's scrap)
        if scrap_kg > 0:
            # Get or create scrap location
            scrap_location = InventoryLocation.objects.filter(
                plant=input_roll.location.plant,
                type='SCRAP'
            ).first() or input_roll.location
            
            scrap_roll = InventoryRoll.objects.create(
                label_id=f"{input_roll.label_id}-SCRAP",
                material=input_roll.material,
                batch_no=input_roll.batch_no,
                thickness_micron=input_roll.thickness_micron,
                width_mm=input_roll.width_mm,
                density_gcm3=cls._resolve_density_gcm3(roll=input_roll),
                original_weight_kg=scrap_kg,
                weight_kg=scrap_kg,
                location=scrap_location,
                status='SCRAPPED',
                stage_index=input_roll.stage_index,
                parent_roll=input_roll,
            )
            RollLink.objects.create(
                parent_roll=input_roll,
                child_roll=scrap_roll,
                relation_type='SPLIT',
                qty_used_kg=scrap_kg
            )
            result['scrap_roll'] = scrap_roll
            
            # Log scrap movement
            if scrap_location != input_roll.location:
                cls.log_movement(
                    roll=scrap_roll,
                    from_location=input_roll.location,
                    to_location=scrap_location,
                    reason='SCRAP',
                    job=job,
                    user=user
                )

        # Mark input roll as consumed
        input_roll.status = 'CONSUMED'
        input_roll.weight_kg = Decimal('0')
        input_roll.save()

        # Create consumption record
        RollConsumption.objects.create(
            job=job,
            process=process,
            input_roll=input_roll,
            output_roll=result.get('output_roll'),
            balance_roll=result.get('balance_roll'),
            scrap_roll=result.get('scrap_roll'),
            consumed_kg=total_consumed,
            scrap_kg=scrap_kg,
            balance_kg=balance_kg,
            output_kg=used_kg,
            machine=machine,
            operator=user,
            notes=notes
        )

        return result

    @classmethod
    @transaction.atomic
    def consume_input_only(
        cls,
        input_roll: InventoryRoll,
        used_kg: Decimal,
        job: ProductionJob = None,
        process: Process = None,
        machine: Machine = None,
        user=None,
        notes: str = "",
    ) -> Dict[str, Optional[InventoryRoll]]:
        """
        Consume an input roll strictly through roll genealogy without creating
        a downstream output roll. Used when BOM-driven material issue consumes
        an assigned source roll but the process output is tracked elsewhere.
        """
        if input_roll.status not in ("AVAILABLE", "RESERVED", "IN_PROCESS"):
            raise ValueError(
                f"Roll {input_roll.label_id} is not available for consumption (status: {input_roll.status})"
            )
        if used_kg <= 0:
            raise ValueError("Consumed weight must be positive")
        if used_kg > input_roll.weight_kg:
            raise ValueError(f"Consumption ({used_kg}kg) exceeds roll weight ({input_roll.weight_kg}kg)")

        balance_kg = input_roll.weight_kg - used_kg
        result = {"balance_roll": None}

        if balance_kg > 0:
            balance_roll = InventoryRoll.objects.create(
                label_id=f"{input_roll.label_id}-BAL",
                material=input_roll.material,
                batch_no=input_roll.batch_no,
                thickness_micron=input_roll.thickness_micron,
                width_mm=input_roll.width_mm,
                density_gcm3=cls._resolve_density_gcm3(roll=input_roll),
                original_weight_kg=balance_kg,
                weight_kg=balance_kg,
                location=input_roll.location,
                status="AVAILABLE",
                stage_index=input_roll.stage_index,
                parent_roll=input_roll,
                template=input_roll.template,
                sales_order_item=input_roll.sales_order_item,
            )
            RollLink.objects.create(
                parent_roll=input_roll,
                child_roll=balance_roll,
                relation_type="SPLIT",
                qty_used_kg=balance_kg,
            )
            result["balance_roll"] = balance_roll

        input_roll.status = "CONSUMED"
        input_roll.weight_kg = Decimal("0")
        input_roll.save()

        if job is not None and process is not None:
            RollConsumption.objects.create(
                job=job,
                process=process,
                input_roll=input_roll,
                output_roll=None,
                balance_roll=result.get("balance_roll"),
                scrap_roll=None,
                consumed_kg=used_kg,
                scrap_kg=Decimal("0"),
                balance_kg=balance_kg,
                output_kg=Decimal("0"),
                machine=machine,
                operator=user,
                notes=notes or "Direct material issue consumption",
            )

        return result

    @classmethod
    @transaction.atomic
    def move_roll(
        cls,
        roll: InventoryRoll,
        to_location: InventoryLocation,
        reason: str = 'ADJUSTMENT',
        reason_note: str = '',
        job: ProductionJob = None,
        user=None
    ) -> RollMovement:
        """
        Move a roll to a new location with full logging.
        """
        from_location = roll.location
        
        movement = cls.log_movement(
            roll=roll,
            from_location=from_location,
            to_location=to_location,
            reason=reason,
            reason_note=reason_note,
            job=job,
            user=user
        )
        
        roll.location = to_location
        roll.plant = to_location.plant
        roll.save(update_fields=['location', 'plant'])

        return movement

    @classmethod
    def log_movement(
        cls,
        roll: InventoryRoll,
        to_location: InventoryLocation,
        reason: str,
        from_location: InventoryLocation = None,
        reason_note: str = '',
        job: ProductionJob = None,
        user=None
    ) -> RollMovement:
        """Log a roll movement without changing the roll's location."""
        return RollMovement.objects.create(
            roll=roll,
            from_location=from_location,
            to_location=to_location,
            reason=reason,
            reason_note=reason_note,
            job=job,
            moved_by=user
        )

    @classmethod
    @transaction.atomic
    def reserve_rolls(
        cls,
        rolls: List[InventoryRoll],
        job: ProductionJob
    ) -> List[InventoryRoll]:
        """
        Reserve rolls for a production job.
        """
        reserved = []
        for roll in rolls:
            if roll.status != 'AVAILABLE':
                raise ValueError(f"Roll {roll.label_id} is not available (status: {roll.status})")
            roll.status = 'RESERVED'
            roll.save()
            reserved.append(roll)
        return reserved

    @classmethod
    @transaction.atomic
    def release_rolls(cls, rolls: List[InventoryRoll]) -> List[InventoryRoll]:
        """
        Release reserved rolls back to available.
        """
        released = []
        for roll in rolls:
            if roll.status == 'RESERVED':
                roll.status = 'AVAILABLE'
                roll.save()
                released.append(roll)
        return released

    @classmethod
    def get_genealogy(cls, roll: InventoryRoll, depth: int = 10) -> Dict[str, Any]:
        """
        Get full ancestral tree for a roll.
        
        Returns:
            Dict with roll info and list of ancestors
        """
        ancestors = []
        current = roll
        
        for _ in range(depth):
            parent_links = RollLink.objects.filter(child_roll=current).select_related('parent_roll')
            if not parent_links.exists():
                # Try legacy parent_roll FK
                if current.parent_roll:
                    ancestors.append({
                        'roll_id': str(current.parent_roll.id),
                        'label_id': current.parent_roll.label_id,
                        'relation_type': 'LEGACY',
                        'qty_used_kg': 0
                    })
                    current = current.parent_roll
                else:
                    break
            else:
                for link in parent_links:
                    ancestors.append({
                        'roll_id': str(link.parent_roll.id),
                        'label_id': link.parent_roll.label_id,
                        'relation_type': link.relation_type,
                        'qty_used_kg': float(link.qty_used_kg)
                    })
                # Follow first parent for linear ancestry
                current = parent_links.first().parent_roll

        return {
            'roll_id': str(roll.id),
            'label_id': roll.label_id,
            'stage_index': roll.stage_index,
            'weight_kg': float(roll.weight_kg),
            'ancestors': ancestors
        }

    @classmethod
    def get_descendants(cls, roll: InventoryRoll, depth: int = 10) -> List[Dict[str, Any]]:
        """
        Get all children recursively.
        """
        descendants = []
        to_process = [roll]
        processed = set()
        
        for _ in range(depth):
            if not to_process:
                break
            current = to_process.pop(0)
            if current.id in processed:
                continue
            processed.add(current.id)
            
            child_links = RollLink.objects.filter(parent_roll=current).select_related('child_roll')
            for link in child_links:
                child = link.child_roll
                descendants.append({
                    'roll_id': str(child.id),
                    'label_id': child.label_id,
                    'relation_type': link.relation_type,
                    'qty_used_kg': float(link.qty_used_kg),
                    'stage_index': child.stage_index,
                    'weight_kg': float(child.weight_kg),
                    'status': child.status
                })
                to_process.append(child)

        return descendants
