from django.db.models import Q
from apps.inventory.models import InventoryRoll
from decimal import Decimal

class RollAllocationService:
    @staticmethod
    def get_eligible_rolls(job, include_non_lineage_fallback: bool = False, include_remainder: bool = False):
        """
        Universal roll eligibility logic (Stock Order, WIP, Jobwork).
        Filter rules:
        - status == AVAILABLE
        - template == job.template
        - current_step_index >= job.current_step_index
        - plant == job.plant
        """
        import logging
        logger = logging.getLogger(__name__)
        
        logger.debug(
            "RollAllocationService job=%s include_non_lineage_fallback=%s include_remainder=%s",
            job.id,
            include_non_lineage_fallback,
            include_remainder,
        )
        process = getattr(job, 'current_process', None) or getattr(job, 'process', None)
        from apps.production.services.services_execution import ExecutionService
        is_v2 = ExecutionService._is_v2(job)
        roll_behavior = str(getattr(process, "roll_behavior", "") or "").upper()
        current_step_index = int(getattr(job, "current_step_index", 0) or 0)
        try:
            from apps.inventory.serializers import resolve_roll_role
        except Exception:
            resolve_roll_role = None

        plant_id = ExecutionService._resolve_job_plant_id(job)
        lineage_filter = ExecutionService._resolve_job_lineage_filter(job)
        target_specs = ExecutionService._build_step_target_specs(job, process)

        base_filters = Q(
            status__in=['AVAILABLE', 'RESERVED'],
            thickness_micron__gt=0,
            width_mm__gt=0,
        )
        if plant_id:
            base_filters &= Q(location__plant_id=plant_id)

        qs_all = (
            InventoryRoll.objects.filter(base_filters)
            .exclude(location__code='IN_TRANSIT')
            .select_related('location', 'material', 'material__parent_family', 'grade')
        )

        step0_primary_roll = (
            is_v2
            and current_step_index == 0
            and roll_behavior in {"MODIFY_EXISTING", "SPLIT"}
        )
        purchasable_variant_ids = (
            ExecutionService._step0_purchasable_variant_ids(job)
            if step0_primary_roll
            else set()
        )

        if step0_primary_roll:
            # Step-0 modify/split draws from raw/purchasable stage-0 pool.
            lineage_qs = qs_all.filter(stage_index=0)
        elif lineage_filter is not None:
            lineage_qs = qs_all.filter(lineage_filter)
        else:
            lineage_qs = qs_all

        downstream_modify_existing = (
            is_v2
            and current_step_index > 0
            and roll_behavior == "MODIFY_EXISTING"
        )
        if downstream_modify_existing:
            lineage_qs = lineage_qs.filter(
                current_step_index__gte=current_step_index,
                created_by_job__isnull=False,
            )

        eligible_ids = []
        seen_ids = set()
        from apps.inventory.models import InventoryReservation
        reserved_by_other_active = set(
            InventoryReservation.objects.filter(
                status='ACTIVE',
                roll__isnull=False,
            )
            .exclude(job=job)
            .exclude(job__job_state__in=['COMPLETED', 'CANCELLED'])
            .values_list('roll_id', flat=True)
        )

        def collect_compatible_ids(rows, *, allow_input_stock_fallback: bool = False):
            for roll in rows:
                if roll.id in seen_ids:
                    continue
                role = None
                if resolve_roll_role:
                    try:
                        role = str(resolve_roll_role(roll) or "").upper()
                    except Exception:
                        role = None
                if not role:
                    role = str(((getattr(roll, "meta_json", None) or {}).get("roll_role") or "")).upper()
                is_remainder = role == "REMAINDER" or bool((getattr(roll, "meta_json", None) or {}).get("is_remainder"))
                # Self-heal stale remainder indices from older logs so they remain
                # allocatable in strict stage-0 semantics.
                if is_remainder and int(getattr(roll, "stage_index", 0) or 0) == 0:
                    desired_current = 0
                    desired_completed = 0
                    if int(getattr(roll, "current_step_index", 0) or 0) != desired_current or int(getattr(roll, "completed_step_index", 0) or 0) != desired_completed:
                        roll.current_step_index = desired_current
                        roll.completed_step_index = desired_completed
                        roll.save(update_fields=["current_step_index", "completed_step_index"])
                if not include_remainder:
                    if is_remainder:
                        continue
                if str(getattr(roll, "status", "")).upper() == "RESERVED":
                    if roll.id in reserved_by_other_active:
                        continue
                    # Heal stale reservations from closed jobs so valid rolls remain allocatable.
                    try:
                        ExecutionService._unlock_roll_if_stale_reserved(roll, job=job)
                        roll.refresh_from_db(fields=["status"])
                    except Exception:
                        continue
                    if str(getattr(roll, "status", "")).upper() != "AVAILABLE":
                        continue
                if bool((getattr(roll, "meta_json", None) or {}).get("is_quarantined")):
                    continue
                if is_v2 and current_step_index == 0 and roll_behavior in {"MODIFY_EXISTING", "SPLIT"}:
                    if int(getattr(roll, "stage_index", 0) or 0) != 0:
                        continue
                    if purchasable_variant_ids and str(getattr(roll, "material_id", "") or "") not in purchasable_variant_ids:
                        continue
                if not ExecutionService._is_roll_step_compatible(
                    job,
                    process,
                    roll,
                    target_specs,
                    allow_input_stock_fallback=allow_input_stock_fallback,
                ):
                    continue
                seen_ids.add(roll.id)
                eligible_ids.append(roll.id)

        # Primary pool: lineage-matched rolls.
        collect_compatible_ids(lineage_qs, allow_input_stock_fallback=False)
        
        logger.debug("RollAllocationService job=%s lineage eligible count=%s", job.id, len(eligible_ids))

        if include_non_lineage_fallback and not downstream_modify_existing:
            required_rolls = 0
            try:
                step_roll_spec = ExecutionService._resolve_step_roll_spec(job, process)
                required_rolls = ExecutionService._required_roll_count(job, process, step_roll_spec)
            except Exception:
                required_rolls = 0

            needs_fallback = (len(eligible_ids) == 0) or (required_rolls > 0 and len(eligible_ids) < required_rolls)
            if needs_fallback:
                if lineage_filter is not None:
                    fallback_qs = qs_all.exclude(lineage_filter)
                else:
                    fallback_qs = qs_all
                collect_compatible_ids(fallback_qs, allow_input_stock_fallback=True)
        
        logger.debug("RollAllocationService job=%s fallback eligible count=%s", job.id, len(eligible_ids))

        if not eligible_ids:
            return InventoryRoll.objects.none()

        filtered = InventoryRoll.objects.filter(id__in=eligible_ids).select_related(
            'location', 'material', 'material__parent_family', 'grade'
        )

        if job.sales_order_item:
            from django.db.models import Case, When, Value, IntegerField
            filtered = filtered.annotate(
                priority=Case(
                    When(sales_order_item=job.sales_order_item, then=Value(1)),
                    default=Value(2),
                    output_field=IntegerField(),
                )
            ).order_by('priority', '-weight_kg', '-created_at', 'id')
        else:
            filtered = filtered.order_by('-weight_kg', '-created_at', 'id')

        return filtered
