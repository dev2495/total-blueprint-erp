from django.db.models import Q
from apps.inventory.models import InventoryRoll
from decimal import Decimal
import hashlib


# Per-process trim allowances (mm consumed by edge mechanics each step).
# Lookup key is uppercased Process.code substring match. Conservative defaults
# applied when no key matches.
PROCESS_TRIM_MM = {
    "SLIT": Decimal("5"),
    "LAMIN": Decimal("8"),
    "PRINT": Decimal("10"),
    "POUCH": Decimal("4"),
    "BAG": Decimal("4"),
    "EXTRU": Decimal("0"),  # extrusion edge waste typically baked into target
}


def resolve_process_trim_mm(process) -> Decimal:
    """Return the mm of width consumed by a single pass through this process."""
    if process is None:
        return Decimal("0")
    code = str(getattr(process, "code", "") or "").upper()
    name = str(getattr(process, "name", "") or "").upper()
    for key, val in PROCESS_TRIM_MM.items():
        if key in code or key in name:
            return val
    return Decimal("0")


def layer_signature_hash(layer_list) -> str:
    """
    Compute a stable SHA1 over an ordered list of layer descriptors.

    Each entry must be a dict with keys: variant_id (or family_id), thickness_micron.
    Order matters (top→bottom of the laminate). Used for strict ganging + generic
    jumbo matching.
    """
    parts = []
    for layer in layer_list or []:
        if not isinstance(layer, dict):
            continue
        vid = str(layer.get("variant_id") or layer.get("family_id") or "?")
        thk = layer.get("thickness_micron")
        try:
            thk_str = f"{int(float(thk or 0))}"
        except Exception:
            thk_str = "0"
        parts.append(f"{vid}/{thk_str}")
    payload = "|".join(parts)
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:16]


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

    @classmethod
    def derive_step_target_width(cls, job, process) -> Decimal:
        """
        Reverse-walk from size.roll_width_mm to compute the *input* width required
        at the start of a given process step.

        Final pouching feed width = size.roll_width_mm (the operator target).
        Each upstream step starts with a wider web equal to its downstream input
        plus that step's edge-trim allowance.
        """
        from apps.production.services.services_execution import ExecutionService

        final_target = Decimal("0")
        try:
            ctx = ExecutionService.get_job_context(str(job.id)) or {}
            specs = ctx.get("target_roll_invariant_list") or []
            for spec in specs:
                w = spec.get("min_width_mm") if isinstance(spec, dict) else None
                if w:
                    final_target = max(final_target, Decimal(str(w)))
                    break
        except Exception:
            pass

        if not final_target:
            return Decimal("0")

        try:
            template = getattr(job, "template", None) or getattr(job, "template_blueprint", None)
            if not template:
                return final_target + resolve_process_trim_mm(process)
            current_idx = int(getattr(job, "current_step_index", 0) or 0)
            steps = list(
                template.steps.select_related("process").order_by("step_index")
            )
            cumulative_trim = Decimal("0")
            for step in steps:
                if int(getattr(step, "step_index", 0) or 0) < current_idx:
                    continue
                cumulative_trim += resolve_process_trim_mm(getattr(step, "process", None))
            return final_target + cumulative_trim
        except Exception:
            return final_target + resolve_process_trim_mm(process)

    @classmethod
    def target_child_width(cls, job) -> Decimal:
        """
        Return the roll-width target for the child/output roll assigned to a job.

        This is intentionally the final slot width from ExecutionService, not the
        upstream input width that may include route trim. WCM slit children should
        match the job target slot; trim is accounted separately between children.
        """
        from apps.production.services.services_execution import ExecutionService

        try:
            ctx = ExecutionService.get_job_context(str(job.id)) or {}
            specs = ctx.get("target_roll_invariant_list") or []
        except Exception:
            specs = []

        for spec in specs:
            w = spec.get("min_width_mm") if isinstance(spec, dict) else None
            if w:
                try:
                    return Decimal(str(w))
                except Exception:
                    continue
        return Decimal("0")

    @classmethod
    def planned_parent_width(cls, job) -> Decimal:
        """
        Return the order-level parent web width WCM should allocate against.

        The final model keeps finished child width on the Product/Sales geometry
        and stores the production run width on SalesOrderItem. Older jobs and
        stock orders do not have that field, so they fall back to the legacy
        target_child_width from the execution context.
        """
        soi = getattr(job, "sales_order_item", None)
        for value in (
            getattr(soi, "planned_parent_width_mm", None) if soi else None,
            (getattr(job, "meta_json", None) or {}).get("planned_parent_width_mm"),
            cls.target_child_width(job),
        ):
            try:
                width = Decimal(str(value or 0))
            except Exception:
                width = Decimal("0")
            if width > 0:
                return width
        return Decimal("0")

    @classmethod
    def preferred_lane_count(cls, job) -> int:
        soi = getattr(job, "sales_order_item", None)
        try:
            lane = int(getattr(soi, "preferred_lane_count", None) or (getattr(job, "meta_json", None) or {}).get("preferred_lane_count") or 1)
        except Exception:
            lane = 1
        return max(1, lane)

    @classmethod
    def committed_gang_jobs(cls, job):
        """
        Return active jobs committed to the same gang as `job`, ordered with the
        current job first. A gang is only valid for the same route step/process;
        layer compatibility is validated when the gang is committed.
        """
        meta = dict(getattr(job, "meta_json", None) or {})
        gang_id = str(meta.get("gang_group_id") or "").strip()
        if not gang_id:
            return [job]

        from apps.production.models import ProductionJob

        qs = (
            ProductionJob.objects.filter(
                meta_json__gang_group_id=gang_id,
                current_step_index=int(getattr(job, "current_step_index", 0) or 0),
            )
            .exclude(status__in=["COMPLETED", "CANCELLED"])
            .exclude(job_state__in=["COMPLETED", "CANCELLED"])
            .select_related("sales_order_item", "current_process", "template")
        )
        process_id = getattr(job, "current_process_id", None)
        if process_id:
            qs = qs.filter(current_process_id=process_id)

        jobs = list(qs)
        if not any(str(getattr(j, "id", "")) == str(job.id) for j in jobs):
            return [job]
        jobs.sort(
            key=lambda j: (
                0 if str(j.id) == str(job.id) else 1,
                str(getattr(j, "job_number", "") or ""),
                str(j.id),
            )
        )
        return jobs

    @classmethod
    def committed_gang_child_plan(cls, job, *, strict: bool = False):
        """
        Build the backend-owned WCM slit plan for a committed gang.

        Returns (jobs, widths). When there is no valid multi-job gang, widths is
        empty so callers can fall back to the normal one-job slit behavior.
        """
        jobs = cls.committed_gang_jobs(job)
        if len(jobs) < 2:
            return [job], []

        widths = []
        for target_job in jobs:
            width = cls.planned_parent_width(target_job)
            if width <= 0:
                if strict:
                    raise ValueError(
                        f"Gang job {target_job.job_number} has no planned parent roll width; fix the Product Master/order lane before slitting."
                    )
                return [job], []
            widths.append(width)
        return jobs, widths

    @classmethod
    def allocate_tiered(cls, job, *, include_pool: bool = True):
        """
        Returns a ranked list of candidate rolls with tier labels for the WCM
        roll picker.

        Tiers:
          1 EXACT             — min_width ≤ w ≤ min_width × 1.10  (auto-safe)
          2 ORDER_BOUND       — already committed to this order/job (auto-safe)
          3 WIDER_OK_WITH_SLIT — w > min_width × 1.10, will slit + spawn remainder
          4 REMAINDER_POOL    — remainder rolls, same layer sig, manual confirm

        Each entry: {
            "roll": InventoryRoll,
            "tier": "EXACT" | "ORDER_BOUND" | "WIDER_OK_WITH_SLIT" | "REMAINDER_POOL",
            "slit_preview": {"child_widths_mm":[…], "remainder_mm": …, "trim_mm": …} | None,
        }
        """
        from apps.production.services.services_execution import ExecutionService

        process = getattr(job, "current_process", None) or getattr(job, "process", None)
        try:
            ctx = ExecutionService.get_job_context(str(job.id)) or {}
            specs = ctx.get("target_roll_invariant_list") or []
        except Exception:
            specs = []

        target_min_w = cls.planned_parent_width(job)

        auto_max = target_min_w * Decimal("1.10") if target_min_w else Decimal("0")
        process_trim = resolve_process_trim_mm(process)

        job_layer_sig = str((getattr(job, "meta_json", None) or {}).get("layer_signature_hash") or "")
        gang_jobs, gang_widths = cls.committed_gang_child_plan(job, strict=False)
        gang_active = len(gang_jobs) >= 2 and len(gang_widths) == len(gang_jobs)
        gang_group_id = ""
        if gang_active:
            gang_group_id = str(((getattr(job, "meta_json", None) or {}).get("gang_group_id") or "")).strip()

        eligible = cls.get_eligible_rolls(
            job,
            include_non_lineage_fallback=True,
            include_remainder=True,
        )

        results = []
        seen_ids = set()

        for roll in eligible:
            if roll.id in seen_ids:
                continue
            seen_ids.add(roll.id)
            roll_w = Decimal(str(getattr(roll, "width_mm", 0) or 0))
            meta = getattr(roll, "meta_json", None) or {}
            roll_role = str(meta.get("roll_role") or "").upper()
            is_remainder = bool(meta.get("is_remainder")) or roll_role == "REMAINDER"
            roll_sig = str(meta.get("layer_signature_hash") or "")

            tier = None
            slit_preview = None

            soi_id = getattr(roll, "sales_order_item_id", None)
            committed_for_this_job = (
                soi_id
                and getattr(job, "sales_order_item_id", None)
                and str(soi_id) == str(job.sales_order_item_id)
            )
            if committed_for_this_job and target_min_w and roll_w >= target_min_w:
                tier = "ORDER_BOUND"
            elif target_min_w and roll_w >= target_min_w and roll_w <= auto_max:
                tier = "REMAINDER_POOL" if is_remainder else "EXACT"
            elif target_min_w and roll_w > auto_max:
                if job_layer_sig and roll_sig and roll_sig != job_layer_sig:
                    continue
                if gang_active:
                    consumed = sum(gang_widths) + process_trim * Decimal(len(gang_widths))
                    if consumed > roll_w:
                        continue
                    children = list(gang_widths)
                    remaining = roll_w - consumed
                else:
                    children = []
                    remaining = roll_w
                    while remaining >= target_min_w + process_trim:
                        children.append(target_min_w)
                        remaining = remaining - target_min_w - process_trim
                if not children:
                    continue
                slit_preview = {
                    "child_widths_mm": [float(c) for c in children],
                    "remainder_mm": float(max(Decimal("0"), remaining)),
                    "trim_mm": float(process_trim),
                }
                if gang_active:
                    slit_preview.update({
                        "gang_group_id": gang_group_id,
                        "gang_job_count": len(gang_jobs),
                        "assign_job_ids": [str(g.id) for g in gang_jobs],
                    })
                tier = "WIDER_OK_WITH_SLIT"
            else:
                continue

            results.append({
                "roll": roll,
                "tier": tier,
                "slit_preview": slit_preview,
                "is_remainder": is_remainder,
            })

        tier_order = {"ORDER_BOUND": 0, "EXACT": 1, "REMAINDER_POOL": 2, "WIDER_OK_WITH_SLIT": 3}
        results.sort(key=lambda r: (tier_order.get(r["tier"], 9), 0 if r.get("is_remainder") else 1, -float(getattr(r["roll"], "weight_kg", 0) or 0)))

        if not include_pool:
            results = [r for r in results if r["tier"] in {"ORDER_BOUND", "EXACT"}]

        return results

    @classmethod
    def perform_slit_assign(cls, job, roll, child_widths_mm, *, user=None, reason: str = "", assign_jobs=None):
        """
        Execute the slit-and-assign operation:
          1. Mark parent roll CONSUMED.
          2. Create N child rolls per child_widths_mm.
          3. Create RollLink(SPLIT) parent → each child.
          4. Reserve child rolls to assigned jobs. For a committed gang, one
             child is assigned per gang job; otherwise the first child is assigned
             to this job.
          5. Spawn a remainder roll if remaining ≥ 200 mm, else mark waste.

        Returns dict with created roll ids and remainder info.
        """
        from django.db import transaction
        from apps.inventory.models import RollLink

        process = getattr(job, "current_process", None) or getattr(job, "process", None)
        trim_mm = resolve_process_trim_mm(process)
        parent_w = Decimal(str(getattr(roll, "width_mm", 0) or 0))
        parent_weight = Decimal(str(getattr(roll, "weight_kg", 0) or 0))

        widths = [Decimal(str(w)) for w in (child_widths_mm or []) if Decimal(str(w)) > 0]
        if not widths:
            raise ValueError("perform_slit_assign requires at least one child width")
        assigned_jobs = list(assign_jobs or [])
        if assigned_jobs and len(assigned_jobs) != len(widths):
            raise ValueError("Gang slit plan must have one child width per assigned job")

        consumed_w = sum(widths) + trim_mm * Decimal(len(widths))
        if consumed_w > parent_w:
            raise ValueError(
                f"Slit math invalid: requested children={consumed_w}mm > parent width={parent_w}mm"
            )
        remainder_w = parent_w - consumed_w
        remainder_w = max(Decimal("0"), remainder_w)

        out = {"child_ids": [], "remainder_id": None, "waste_mm": 0.0, "assigned_jobs": []}
        with transaction.atomic():
            for idx, child_w in enumerate(widths):
                target_job = assigned_jobs[idx] if assigned_jobs else (job if idx == 0 else None)
                target_meta = dict(getattr(target_job, "meta_json", None) or {}) if target_job else {}
                ratio = child_w / parent_w if parent_w > 0 else Decimal("0")
                child_weight = (parent_weight * ratio).quantize(Decimal("0.001"))
                child_meta = {
                    **(roll.meta_json or {}),
                    "roll_role": (
                        "ORDER_BOUND"
                        if target_job and getattr(target_job, "sales_order_item_id", None)
                        else "JOB_BOUND"
                        if target_job
                        else (roll.meta_json or {}).get("roll_role", "")
                    ),
                    "parent_roll_id": str(roll.id),
                    "slit_from_width_mm": float(parent_w),
                    "slit_trim_mm": float(trim_mm),
                    "slit_reason": reason,
                }
                if target_job:
                    child_meta.update({
                        "assigned_job_id": str(target_job.id),
                        "assigned_job_number": str(getattr(target_job, "job_number", "") or ""),
                    })
                    if target_meta.get("layer_signature_hash"):
                        child_meta["layer_signature_hash"] = target_meta.get("layer_signature_hash")
                    if target_meta.get("gang_group_id"):
                        child_meta["gang_group_id"] = target_meta.get("gang_group_id")
                        child_meta["gang_layer_sig"] = target_meta.get("gang_layer_sig") or target_meta.get("layer_signature_hash")
                        child_meta["gang_child_index"] = idx + 1
                child = InventoryRoll.objects.create(
                    label_id=f"{roll.label_id}-S{idx+1}",
                    material=roll.material,
                    batch_no=roll.batch_no,
                    thickness_micron=roll.thickness_micron,
                    width_mm=child_w,
                    density_gcm3=roll.density_gcm3,
                    grade=roll.grade,
                    plant=roll.plant,
                    length_m=roll.length_m,
                    original_weight_kg=child_weight,
                    weight_kg=child_weight,
                    net_weight_kg=child_weight,
                    location=roll.location,
                    status="AVAILABLE",
                    parent_roll=roll,
                    stage_index=roll.stage_index,
                    current_step_index=roll.current_step_index,
                    completed_step_index=roll.completed_step_index,
                    template=roll.template,
                    sales_order_item=target_job.sales_order_item if target_job else None,
                    meta_json=child_meta,
                )
                RollLink.objects.create(
                    parent_roll=roll,
                    child_roll=child,
                    relation_type="SPLIT",
                    qty_used_kg=child_weight,
                )
                out["child_ids"].append(str(child.id))

            min_remainder = Decimal("50")
            try:
                from apps.materials.models import WebWidthPolicy
                policy = WebWidthPolicy.objects.filter(is_default=True).first()
                if policy and policy.min_remainder_mm:
                    min_remainder = Decimal(str(policy.min_remainder_mm))
            except Exception:
                pass
            if remainder_w >= min_remainder:
                ratio = remainder_w / parent_w if parent_w > 0 else Decimal("0")
                rem_weight = (parent_weight * ratio).quantize(Decimal("0.001"))
                remainder = InventoryRoll.objects.create(
                    label_id=f"{roll.label_id}-REM",
                    material=roll.material,
                    batch_no=roll.batch_no,
                    thickness_micron=roll.thickness_micron,
                    width_mm=remainder_w,
                    density_gcm3=roll.density_gcm3,
                    grade=roll.grade,
                    plant=roll.plant,
                    length_m=roll.length_m,
                    original_weight_kg=rem_weight,
                    weight_kg=rem_weight,
                    net_weight_kg=rem_weight,
                    location=roll.location,
                    status="AVAILABLE",
                    parent_roll=roll,
                    stage_index=roll.stage_index,
                    current_step_index=roll.current_step_index,
                    completed_step_index=roll.completed_step_index,
                    template=roll.template,
                    meta_json={
                        **(roll.meta_json or {}),
                        "roll_role": "REMAINDER",
                        "is_remainder": True,
                        "parent_roll_id": str(roll.id),
                        "slit_from_width_mm": float(parent_w),
                    },
                )
                RollLink.objects.create(
                    parent_roll=roll,
                    child_roll=remainder,
                    relation_type="SPLIT",
                    qty_used_kg=rem_weight,
                )
                out["remainder_id"] = str(remainder.id)
            else:
                out["waste_mm"] = float(remainder_w)

            roll.status = "CONSUMED"
            roll.weight_kg = Decimal("0")
            roll.save(update_fields=["status", "weight_kg"])

            if out["child_ids"]:
                from apps.production.services.services_execution import ExecutionService

                if assigned_jobs:
                    assignment_pairs = list(zip(assigned_jobs, out["child_ids"]))
                else:
                    assignment_pairs = [(job, out["child_ids"][0])]
                for target_job, child_id in assignment_pairs:
                    override_reason = (reason or "WCM slit allocation").strip()
                    ExecutionService.assign_roll_to_job(
                        str(target_job.id),
                        child_id,
                        user=user,
                        manual_override=False,
                    )
                    out["assigned_jobs"].append({
                        "job_id": str(target_job.id),
                        "job_number": str(getattr(target_job, "job_number", "") or ""),
                        "child_roll_id": child_id,
                        "override_reason": override_reason,
                    })

        return out
