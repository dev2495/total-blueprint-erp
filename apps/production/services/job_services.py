from django.db import transaction
from django.db.models import Q, Sum
from decimal import Decimal
from django.conf import settings
from apps.production.models import ProductionJob, JobExecutionLog, WorkCenterAssignment
from apps.factory.models import Process, WorkCenter, WorkCenterProcess, Plant
from apps.inventory.models import InventoryLocation, InventoryRoll, InventoryReservation
from apps.production.services.shift_resolver import build_shift_fields_for_job

class JobService:
    KG_EPSILON = Decimal("0.0001")
    PCS_EPSILON = Decimal("0.01")
    PARTIAL_SHORTFALL_THRESHOLD_PCT = Decimal("5.0")

    @classmethod
    def _job_layer_count_from_source(cls, source):
        snapshot = getattr(source, "layer_snapshot", None) or []
        if not isinstance(snapshot, list):
            return 0
        return len([row for row in snapshot if isinstance(row, dict)])

    @classmethod
    def _lamination_pass_index_for_route(cls, processes, index):
        pass_index = 0
        try:
            combine_codes = set(
                Process.objects.filter(
                    code__in=list(processes),
                    roll_behavior="MULTI_INPUT_COMBINE",
                ).values_list("code", flat=True)
            )
            for idx, code in enumerate(processes):
                if idx > index:
                    break
                if code in combine_codes:
                    pass_index += 1
        except Exception:
            pass_index = 0
        return max(pass_index, 1)

    @classmethod
    def _route_step_active_for_source(cls, *, source, template, process, processes, index):
        if not process or str(getattr(process, "roll_behavior", "") or "").upper() != "MULTI_INPUT_COMBINE":
            return True
        layer_count = cls._job_layer_count_from_source(source)
        if layer_count <= 0:
            return True
        active_min = 0
        try:
            from apps.templates.models import TemplateProcessStep

            step = (
                TemplateProcessStep.objects.select_related("roll_spec")
                .filter(template=template, sequence_number=int(index) + 1)
                .first()
            )
            roll_spec = getattr(step, "roll_spec", None) if step else None
            if roll_spec and str(getattr(roll_spec, "combine_mode", "") or "").upper() == "LANE_GROUPS":
                active_min = int(getattr(roll_spec, "active_min_layer_count", 0) or 0)
        except Exception:
            active_min = 0
        pass_index = cls._lamination_pass_index_for_route(processes, index)
        if active_min <= 0:
            active_min = 2 if pass_index <= 1 else pass_index + 1
        return layer_count >= active_min

    @classmethod
    def _resolve_job_plant_id(cls, job):
        if job.work_center_id and job.work_center and job.work_center.plant_id:
            return str(job.work_center.plant_id)
        if job.to_location_id and job.to_location and job.to_location.plant_id:
            return str(job.to_location.plant_id)
        if job.from_location_id and job.from_location and job.from_location.plant_id:
            return str(job.from_location.plant_id)
        return None

    @classmethod
    def _resolve_work_center_for_process(cls, process, *, plant=None):
        if not process:
            return None

        mapped_qs = WorkCenterProcess.objects.select_related("work_center", "work_center__plant").filter(process=process)
        if plant is not None:
            mapped_for_plant = mapped_qs.filter(work_center__plant=plant).first()
            if mapped_for_plant:
                return mapped_for_plant.work_center

        mapped = mapped_qs.first()
        if mapped:
            return mapped.work_center

        wc_qs = WorkCenter.objects.select_related("plant")
        if plant is not None:
            plant_wc = wc_qs.filter(plant=plant).first()
            if plant_wc:
                return plant_wc

        return wc_qs.first()

    @classmethod
    def _release_active_roll_reservations(cls, job):
        """
        Release stale ACTIVE reservations and unlock rolls for downstream transfer.
        """
        active_reservations = list(
            InventoryReservation.objects.select_related("roll").filter(
                job=job,
                status="ACTIVE",
                roll__isnull=False,
            )
        )
        for reservation in active_reservations:
            roll = reservation.roll
            reservation.status = "RELEASED"
            reservation.save(update_fields=["status"])
            if roll and roll.status == "RESERVED":
                has_other_active = InventoryReservation.objects.filter(
                    roll=roll,
                    status="ACTIVE",
                ).exclude(job=job).exists()
                if not has_other_active:
                    roll.status = "AVAILABLE"
                    roll.save(update_fields=["status"])

    @classmethod
    def _auto_pause_for_planned_jobwork(cls, job):
        """
        Route-step jobwork gate:
        if current process is a jobwork step, auto-create/refresh a PLANNED_STEP
        order and keep the job paused until vendor return closes it.
        """
        process = job.current_process or job.process
        process_code = str(getattr(process, "code", "") or "").upper()
        if "JOBWORK" not in process_code:
            return None

        from apps.inventory.services.job_work import JobWorkService
        from apps.inventory.models import JobWorkOrder

        # Resolve plant in job context.
        plant = None
        if job.work_center and job.work_center.plant:
            plant = job.work_center.plant
        elif job.from_location and job.from_location.plant:
            plant = job.from_location.plant
        elif job.to_location and job.to_location.plant:
            plant = job.to_location.plant
        if not plant:
            raise ValueError("Could not resolve plant for planned jobwork step.")

        existing = JobWorkOrder.objects.filter(
            production_job=job,
            mode="PLANNED_STEP",
            status__in=["DRAFT", "SENT", "PARTIAL"],
        ).order_by("-created_at").first()

        if existing:
            order = existing
        else:
            candidates = JobWorkService.compatible_vendors(process_code=process_code, plant=plant)
            vendor = next((candidate for candidate, verdict in candidates if verdict.get("match")), None)
            if not vendor:
                raise ValueError(
                    f"No compatible active jobwork vendor found for process {process_code or 'UNKNOWN'} in plant {plant.code}."
                )
            order = JobWorkService.create_order(
                plant=plant,
                vendor=vendor,
                sent_material_type="WIP",
                expected_return="WIP",
                production_job=job,
                notes=f"Auto-created planned route-step jobwork for {job.job_number}",
                mode="PLANNED_STEP",
                route_step_index=job.current_step_index,
            )

        job.job_state = "PAUSED"
        job.is_on_hold = True
        job.hold_reason = f"Planned Job Work pending return ({order.vendor_name})"
        job.save(update_fields=["job_state", "is_on_hold", "hold_reason", "updated_at"])
        return order

    @classmethod
    def _create_and_dispatch_interplant_dc(cls, source_job, target_job):
        from apps.inventory.services.inter_plant import InterPlantService

        source_plant_id = cls._resolve_job_plant_id(source_job)
        target_plant_id = cls._resolve_job_plant_id(target_job)
        if not source_plant_id or not target_plant_id or source_plant_id == target_plant_id:
            return None

        cls._release_active_roll_reservations(source_job)

        process = source_job.current_process or source_job.process
        behavior = ((process.roll_behavior if process else None) or "NONE").upper()

        reserved_by_other = set(
            InventoryReservation.objects.filter(
                status="ACTIVE",
                roll__isnull=False,
            ).exclude(job=source_job).values_list("roll_id", flat=True)
        )

        output_rolls = []
        if behavior == "MODIFY_EXISTING":
            source_roll_ids = list(
                InventoryReservation.objects.filter(
                    job=source_job,
                    roll__isnull=False,
                    status__in=["ACTIVE", "FULFILLED", "RELEASED"],
                ).values_list("roll_id", flat=True)
            )
            if source_roll_ids:
                output_rolls = list(
                    InventoryRoll.objects.select_related("location")
                    .filter(
                        id__in=source_roll_ids,
                        production_job=source_job,
                        location__plant_id=source_plant_id,
                    )
                    .exclude(location__code="IN_TRANSIT")
                    .exclude(id__in=list(reserved_by_other))
                    .order_by("created_at")
                )

        if not output_rolls:
            output_rolls = list(
                InventoryRoll.objects.select_related("location")
                .filter(
                    Q(production_job=source_job) | Q(created_by_job=source_job),
                    location__plant_id=source_plant_id,
                )
                .exclude(location__code="IN_TRANSIT")
                .exclude(id__in=list(reserved_by_other))
                .order_by("created_at")
            )

        def _roll_weight(roll):
            try:
                return Decimal(str(roll.weight_kg or 0))
            except Exception:
                return Decimal("0")

        def _resolve_roll_role(roll):
            try:
                from apps.inventory.serializers import resolve_roll_role

                role = str(resolve_roll_role(roll) or "").upper()
                if role:
                    return role
            except Exception:
                pass
            meta = dict(getattr(roll, "meta_json", None) or {})
            if bool(meta.get("is_remainder")):
                return "REMAINDER"
            if roll.is_fg:
                return "FG"
            return "OUTPUT"

        def _pick_roll_subset(candidates, target_kg):
            if not candidates:
                return []
            target = Decimal(str(target_kg or 0))
            if target <= 0:
                return [max(candidates, key=_roll_weight)]

            weighted = [(roll, _roll_weight(roll)) for roll in candidates if _roll_weight(roll) > 0]
            if not weighted:
                return [candidates[0]]

            # Exact/near subset selection for small lists.
            if len(weighted) <= 12:
                best = None
                from itertools import combinations

                for r in range(1, len(weighted) + 1):
                    for combo in combinations(weighted, r):
                        total = sum((w for _, w in combo), Decimal("0"))
                        delta = abs(total - target)
                        key = (delta, r, total)
                        if best is None or key < best[0]:
                            best = (key, [roll for roll, _ in combo])
                            if delta <= cls.KG_EPSILON:
                                return best[1]
                return best[1] if best else [weighted[0][0]]

            # Greedy fallback for larger pools.
            picked = []
            running = Decimal("0")
            for roll, weight in sorted(weighted, key=lambda row: abs(row[1] - target)):
                if running >= target:
                    break
                picked.append(roll)
                running += weight
            return picked or [weighted[0][0]]

        # Safety default: system auto-transfer should move only step output rolls.
        # Remainder fallback stays disabled unless explicitly enabled in code path.
        allow_remainder_fallback = False and bool(getattr(settings, "ALLOW_INTERPLANT_REMAINDER_FALLBACK", False))
        preferred_roles = {"OUTPUT", "SPLIT_OUTPUT", "FG"}
        preferred_rolls = [roll for roll in output_rolls if _resolve_roll_role(roll) in preferred_roles]
        remainder_rolls = [roll for roll in output_rolls if _resolve_roll_role(roll) == "REMAINDER"]

        # InterPlant dispatch requires AVAILABLE roll status.
        for roll in preferred_rolls + remainder_rolls:
            if roll.status == "AVAILABLE":
                continue
            has_active = InventoryReservation.objects.filter(
                roll=roll,
                status="ACTIVE",
            ).exists()
            if not has_active:
                roll.status = "AVAILABLE"
                roll.save(update_fields=["status"])
        preferred_rolls = [roll for roll in preferred_rolls if roll.status == "AVAILABLE"]
        remainder_rolls = [roll for roll in remainder_rolls if roll.status == "AVAILABLE"]

        try:
            from apps.production.services.services_execution import ExecutionService

            produced_target_kg = Decimal(
                str((ExecutionService.get_step_execution_profile(str(source_job.id)) or {}).get("step_produced_kg") or 0)
            )
        except Exception:
            produced_target_kg = Decimal("0")

        if preferred_rolls:
            output_rolls = _pick_roll_subset(preferred_rolls, produced_target_kg)
        elif allow_remainder_fallback and remainder_rolls:
            output_rolls = _pick_roll_subset(remainder_rolls, produced_target_kg)
        else:
            raise ValueError(
                "No transferable step output rolls found for inter-plant transfer. "
                "Remainder rolls are excluded by default. Complete output logging and verify roll roles."
            )

        if not output_rolls:
            raise ValueError("No transferable WIP output rolls found for inter-plant transfer.")

        challan = InterPlantService.create_challan(
            from_plant_id=source_plant_id,
            to_plant_id=target_plant_id,
            source_job_id=str(source_job.id),
            target_job_id=str(target_job.id),
            is_system_generated=True,
        )
        dispatched = InterPlantService.dispatch_challan(
            challan_id=str(challan.id),
            roll_ids=[str(r.id) for r in output_rolls],
            target_location_id=str(target_job.from_location_id) if target_job.from_location_id else None,
        )
        return dispatched

    @classmethod
    def _unit_weight_g(cls, job):
        value = getattr(getattr(job, "sales_order_item", None), "unit_weight_g", None)
        if value in (None, "", 0):
            value = getattr(getattr(job, "mts_order", None), "unit_weight_g", None)
        try:
            return Decimal(str(value or 0))
        except Exception:
            return Decimal("0")

    @classmethod
    def _kg_to_job_uom(cls, job, qty_kg):
        qty_kg = Decimal(str(qty_kg or 0))
        if qty_kg <= 0:
            return Decimal("0")
        job_uom = str(job.uom or "KG").upper()
        if job_uom == "KG":
            return qty_kg
        if job_uom == "PCS":
            unit_weight = cls._unit_weight_g(job)
            if unit_weight > 0:
                return (qty_kg * Decimal("1000")) / unit_weight
            # Fallback for legacy data with missing conversion.
            return qty_kg
        return qty_kg

    @classmethod
    def _completion_epsilon(cls, job):
        return cls.KG_EPSILON if str(job.uom or "KG").upper() == "KG" else cls.PCS_EPSILON

    @classmethod
    def _next_unique_job_number(cls, base_job_number: str) -> str:
        candidate = str(base_job_number)
        if not ProductionJob.objects.filter(job_number=candidate).exists():
            return candidate
        rev = 1
        while True:
            candidate = f"{base_job_number}-R{rev}"
            if not ProductionJob.objects.filter(job_number=candidate).exists():
                return candidate
            rev += 1

    @classmethod
    def _is_final_route_step(cls, job):
        ordered = list(getattr(job.routing_rule, "ordered_processes", None) or [])
        if not ordered:
            return True
        return int(job.current_step_index or 0) >= (len(ordered) - 1)

    @classmethod
    def _sales_item_final_output_kg(cls, so_item, route_last_index):
        total = JobExecutionLog.objects.filter(
            production_job__sales_order_item=so_item,
            production_job__current_step_index=route_last_index,
            production_job__job_state="COMPLETED",
        ).aggregate(total=Sum("quantity")).get("total") or 0
        return Decimal(str(total or 0))

    @classmethod
    def _sales_item_shortfall_metrics(cls, so_item, route_last_index):
        target_kg = Decimal(str(getattr(so_item, "total_weight_kg", 0) or 0))
        produced_kg = cls._sales_item_final_output_kg(so_item, route_last_index)
        shortfall_kg = target_kg - produced_kg
        if shortfall_kg < 0:
            shortfall_kg = Decimal("0")
        shortfall_pct = Decimal("0")
        if target_kg > 0:
            shortfall_pct = (shortfall_kg * Decimal("100")) / target_kg
        return {
            "target_kg": target_kg,
            "produced_kg": produced_kg,
            "shortfall_kg": shortfall_kg,
            "shortfall_pct": shortfall_pct,
            "requires_replan": bool(
                shortfall_kg > 0
                and shortfall_pct > cls.PARTIAL_SHORTFALL_THRESHOLD_PCT
            ),
        }

    @classmethod
    def _update_sales_order_post_final_step(cls, job):
        so_item = getattr(job, "sales_order_item", None)
        if not so_item:
            return
        sales_order = getattr(so_item, "sales_order", None)
        if not sales_order:
            return

        route_last_index = max(0, len(list(job.routing_rule.ordered_processes or [])) - 1)
        metrics = cls._sales_item_shortfall_metrics(so_item, route_last_index)

        # Any non-terminal jobs keep the order in active release lifecycle.
        active_jobs_exist = ProductionJob.objects.filter(
            sales_order_item__sales_order=sales_order
        ).exclude(job_state__in=["COMPLETED", "CANCELLED"]).exists()
        if active_jobs_exist:
            return

        if metrics["requires_replan"]:
            sales_order.status = "PLANNING_REQUIRED"
            sales_order.save(update_fields=["status"])
            return

        # Completed production goes to Packing Yard first; only packing release
        # should make the order dispatch-ready.
        sales_order.status = "PACKING_READY"
        sales_order.save(update_fields=["status"])

    @classmethod
    def _update_stock_order_post_terminal_step(cls, job):
        mts_order = getattr(job, "mts_order", None)
        if not mts_order:
            return

        active_jobs_exist = ProductionJob.objects.filter(
            mts_order=mts_order
        ).exclude(job_state__in=["COMPLETED", "CANCELLED"]).exists()
        if active_jobs_exist:
            return

        mts_order.status = "STOCK_READY"
        mts_order.save(update_fields=["status", "updated_at"])

    @classmethod
    def _finalize_step_completion(
        cls,
        job,
        user=None,
        closed_with_variance=False,
        variance_kg=None,
        force_reason=None,
    ):
        """
        Close the current step and advance routing/inter-plant logic.
        """
        from django.utils import timezone

        now = timezone.now()
        variance = Decimal(str(variance_kg or 0))
        job.status = "COMPLETED"
        job.job_state = "COMPLETED"
        job.end_date = now
        job.closed_at = now
        job.closed_by = user
        job.closed_with_variance = bool(closed_with_variance)
        job.completion_variance_kg = max(variance, Decimal("0"))
        job.completion_force_reason = (force_reason or "").strip() or None
        job.save(
            update_fields=[
                "status",
                "job_state",
                "end_date",
                "closed_at",
                "closed_by",
                "closed_with_variance",
                "completion_variance_kg",
                "completion_force_reason",
                "updated_at",
            ]
        )
        setattr(job, "_completion_mode", "FORCED_VARIANCE" if closed_with_variance else "NORMAL")
        setattr(job, "_completion_variance_kg", float(max(variance, Decimal("0"))))
        setattr(job, "_completion_force_reason", (force_reason or "").strip() or None)

        filters = {
            "routing_rule": job.routing_rule,
            "job_state": "WAITING",
        }
        if job.sales_order_item:
            filters["sales_order_item"] = job.sales_order_item
        elif job.mts_order:
            filters["mts_order"] = job.mts_order

        next_job = (
            ProductionJob.objects.filter(**filters)
            .filter(current_step_index__gt=job.current_step_index)
            .select_related("work_center__plant", "from_location__plant", "to_location__plant")
            .order_by("current_step_index", "created_at")
            .first()
        )
        if next_job:
            current_plant_id = cls._resolve_job_plant_id(job)
            next_plant_id = cls._resolve_job_plant_id(next_job)
            if current_plant_id and next_plant_id and current_plant_id != next_plant_id:
                interplant_dc = cls._create_and_dispatch_interplant_dc(job, next_job)
                setattr(job, "_interplant_dc", interplant_dc)
            else:
                cls.release_job(next_job.id)

        cls._release_active_roll_reservations(job)
        assignment = WorkCenterAssignment.objects.filter(production_job=job).first()
        if assignment:
            assignment.allocated_rolls.clear()
            assignment.delete()

        if cls._is_final_route_step(job) and getattr(job, "sales_order_item_id", None):
            cls._update_sales_order_post_final_step(job)
        if getattr(job, "mts_order_id", None):
            cls._update_stock_order_post_terminal_step(job)
        return job

    @classmethod
    def log_output_event(cls, job, output_weight_kg, completion_meta=None, user=None):
        """
        Physics execution event: consume inputs/create outputs and update step progress.
        `output_weight_kg` is canonical machine input (KG primary).
        """
        if job.job_state != "EXECUTING" or job.status != "RUNNING":
            raise ValueError("Job must be EXECUTING to log output.")

        output_weight_kg = Decimal(str(output_weight_kg or 0))
        if output_weight_kg <= 0:
            raise ValueError("Output weight must be > 0.")

        from apps.production.services.services_execution import ExecutionService

        with transaction.atomic():
            ExecutionService.execute_completion(job.id, output_weight_kg, user=user, **(completion_meta or {}))

            output_pcs = None
            if isinstance(completion_meta, dict):
                raw_output_pcs = completion_meta.get("output_pcs")
                if raw_output_pcs not in (None, ""):
                    try:
                        output_pcs = Decimal(str(raw_output_pcs))
                    except Exception:
                        output_pcs = None

            if str(job.uom or "KG").upper() == "PCS" and output_pcs is not None and output_pcs > 0:
                produced_increment = output_pcs
            else:
                produced_increment = cls._kg_to_job_uom(job, output_weight_kg)
            current_produced = Decimal(str(job.produced_qty or 0))
            target_qty = Decimal(str(job.quantity or 0))

            new_produced = current_produced + produced_increment
            if target_qty > 0 and new_produced > target_qty:
                new_produced = target_qty

            remaining = target_qty - new_produced
            if remaining < 0:
                remaining = Decimal("0")

            job.produced_qty = new_produced
            job.remaining_qty = remaining
            job.save(update_fields=["produced_qty", "remaining_qty", "updated_at"])

            JobExecutionLog.objects.create(
                production_job=job,
                quantity=output_weight_kg,
                uom="KG",
                logged_by=user,
                **build_shift_fields_for_job(job),
            )

        return job

    @classmethod
    def complete_step(
        cls,
        job,
        user=None,
        force_reason=None,
        material_confirmations=None,
        require_material_confirmations=False,
    ):
        """
        Close-only completion: step closure is based on step-aware target, not order-total.
        If short beyond tolerance, `force_reason` is required.
        """
        if isinstance(job, (str, bytes)):
            job = ProductionJob.objects.get(id=job)
        if job.job_state not in ["EXECUTING", "PAUSED"]:
            raise ValueError("Only EXECUTING/PAUSED jobs can be completed.")

        from apps.production.services.services_execution import ExecutionService
        step_profile = ExecutionService.get_step_execution_profile(job.id)
        primary_uom = str(step_profile.get("primary_uom") or "KG").upper()
        remaining = Decimal(
            str(
                step_profile.get("step_remaining_primary")
                if step_profile.get("step_remaining_primary") is not None
                else step_profile.get("step_remaining_kg")
                or 0
            )
        )
        tolerance = Decimal(
            str(
                step_profile.get("tolerance_primary")
                if step_profile.get("tolerance_primary") is not None
                else step_profile.get("tolerance_kg")
                or 0.25
            )
        )
        remaining_kg = Decimal(str(step_profile.get("step_remaining_kg") or 0))
        force_reason = (force_reason or "").strip()
        needs_force = remaining > tolerance
        if needs_force and not force_reason:
            raise ValueError(
                f"Step remaining is {remaining:.4f} {primary_uom}, above tolerance {tolerance:.4f} {primary_uom}. "
                f"Provide force_reason to complete with variance."
            )

        with transaction.atomic():
            # Reconcile current-step bulk consumption to produced ratio before close.
            consumption_location_id = job.from_location_id or (
                job.work_center.default_wip_location_id if job.work_center else None
            )
            produced_kg = Decimal(str(step_profile.get("step_produced_kg") or 0))
            ExecutionService._reconcile_step_bulk_consumption(
                job=job,
                produced_kg=produced_kg,
                consumption_location_id=consumption_location_id,
                user=user,
            )
            ExecutionService.reconcile_step_material_actuals(
                job=job,
                material_confirmations=material_confirmations or [],
                consumption_location_id=consumption_location_id,
                user=user,
                strict=require_material_confirmations,
            )
            return cls._finalize_step_completion(
                job,
                user=user,
                closed_with_variance=bool(needs_force),
                variance_kg=remaining_kg if needs_force else Decimal("0"),
                force_reason=force_reason if needs_force else None,
            )

    @classmethod
    def create_jobs_from_order(cls, sales_order_id):
        from apps.sales.models import SalesOrder
        order = SalesOrder.objects.get(id=sales_order_id)
        all_jobs = []
        for item in order.items.all():
            jobs = cls.create_jobs_for_so_item(item)
            all_jobs.extend(jobs)
        return all_jobs

    @classmethod
    def create_jobs_for_so_item(
        cls,
        so_item,
        start_index=0,
        stop_index=None,
        quantity_override=None,
        quantity_uom_override=None,
        planner_note_prefix=None,
    ):
        template = so_item.template
        if not template.routing_rule:
            return []
        
        # Backward compatible fallback if caller does not specify start.
        if start_index in (None, 0):
            allocated_rolls = so_item.inventory_rolls.all()
            if allocated_rolls.exists():
                # We start from the first step that hasn't been completed by ANY roll
                # Usually if we have multiple rolls, they should be at the same stage.
                # If they differ, we take the minimum (safest).
                start_index = min(max(0, r.current_step_index) for r in allocated_rolls)

        processes = template.routing_rule.ordered_processes
        if stop_index is None:
            stop_index = len(processes) - 1
        start_index = max(0, int(start_index or 0))
        stop_index = min(len(processes) - 1, int(stop_index))
        if start_index > stop_index:
            return []
        jobs = []

        target_qty = Decimal(str(quantity_override)) if quantity_override is not None else Decimal(str(so_item.qty_value or 0))
        if target_qty <= 0:
            return []
        target_uom = str(quantity_uom_override or so_item.qty_uom or "KG").upper()

        for index, process_code in enumerate(processes):
            if index < start_index or index > stop_index:
                continue
                
            process = Process.objects.get(code=process_code)
            if not cls._route_step_active_for_source(
                source=so_item,
                template=template,
                process=process,
                processes=processes,
                index=index,
            ):
                continue
            wc = cls._resolve_work_center_for_process(process)

            # Resolve plant per-step from the resolved work center (future-proof for multi-plant).
            # Fallback to first plant if the process isn't mapped to any work center.
            plant = wc.plant if wc else Plant.objects.first()
            plant_locations = InventoryLocation.objects.filter(plant=plant) if plant else InventoryLocation.objects.none()
            
            from_loc, to_loc = None, None
            if plant_locations.exists():
                def _pick_loc(qs):
                    # Prefer system-defined locations when duplicates exist (common in seeded/dev DBs).
                    return qs.filter(is_system=True).first() or qs.first()

                rm_loc = _pick_loc(plant_locations.filter(type='RM'))
                fg_loc = _pick_loc(plant_locations.filter(type='FG'))
                wip_loc = wc.default_wip_location if wc and wc.default_wip_location_id else _pick_loc(plant_locations.filter(type='WIP'))

                if index == start_index:
                    # Input from RM if first step, else WIP
                    from_loc = rm_loc if index == 0 else wip_loc
                else:
                    from_loc = wip_loc
                
                if index == len(processes) - 1:
                    to_loc = fg_loc
                else:
                    to_loc = wip_loc

            base_job_number = f"{so_item.sales_order.order_number}-{so_item.id.hex[:4]}-{index+1}"
            job = ProductionJob.objects.create(
                job_number=cls._next_unique_job_number(base_job_number),
                origin='MTO',
                template=template,
                sales_order_item=so_item,
                execution_model_version=2,
                routing_rule=template.routing_rule,
                current_step_index=index,
                current_process=process,
                input_form=process.input_form,
                output_form=process.output_form,
                work_center=wc,
                from_location=from_loc,
                to_location=to_loc,
                quantity=target_qty,
                remaining_qty=target_qty,
                uom=target_uom,
                status='QUEUED',
                job_state='PLANNED' if index == start_index else 'WAITING',
                planner_notes=(
                    f"{(planner_note_prefix or '').strip()} | step:{index + 1}"
                    if planner_note_prefix
                    else None
                ),
            )
            
            # Phase 71: Explode BOM into Requirements
            from apps.production.services.services_execution import ExecutionService
            ExecutionService.calculate_requirements(job.id)
            
            jobs.append(job)
        return jobs

    @classmethod
    def create_jobs_for_planned_order(cls, planned_order, start_index=None, stop_index=None, quantity_kg=None):
        template = planned_order.template
        if not template.routing_rule:
            return []

        processes = template.routing_rule.ordered_processes
        jobs = []

        start_index = (getattr(planned_order, 'start_step_index', 0) if start_index is None else int(start_index))
        if stop_index is None:
            if getattr(planned_order, 'stop_step_index', None) is not None:
                stop_index = planned_order.stop_step_index
            elif getattr(planned_order, 'target_step_index', None) is not None:
                stop_index = planned_order.target_step_index
            else:
                stop_index = len(processes) - 1
        stop_index = int(stop_index)

        start_index = max(0, start_index)
        stop_index = min(len(processes) - 1, stop_index)
        if start_index > stop_index:
            return []

        if hasattr(planned_order, 'start_step_index') and hasattr(planned_order, 'stop_step_index'):
            if planned_order.start_step_index != start_index or planned_order.stop_step_index != stop_index:
                planned_order.start_step_index = start_index
                planned_order.stop_step_index = stop_index
                if hasattr(planned_order, 'target_step_index'):
                    planned_order.target_step_index = stop_index
                update_fields = ['start_step_index', 'stop_step_index']
                if hasattr(planned_order, 'target_step_index'):
                    update_fields.append('target_step_index')
                if hasattr(planned_order, 'updated_at'):
                    update_fields.append('updated_at')
                planned_order.save(update_fields=update_fields)

        target_qty_source = getattr(planned_order, 'target_qty', None)
        if target_qty_source is None:
            target_qty_source = getattr(planned_order, 'quantity', 0)
        target_qty = Decimal(str(quantity_kg if quantity_kg is not None else target_qty_source or 0))
        if target_qty <= 0:
            return []
        target_uom = str(getattr(planned_order, 'quantity_uom', 'KG') or 'KG').upper()
        if target_uom not in {'KG', 'PCS', 'METER'}:
            target_uom = 'KG'

        for index, process_code in enumerate(processes):
            if index < start_index or index > stop_index:
                continue
                
            process = Process.objects.get(code=process_code)
            if not cls._route_step_active_for_source(
                source=planned_order,
                template=template,
                process=process,
                processes=processes,
                index=index,
            ):
                continue
            wc = cls._resolve_work_center_for_process(process, plant=planned_order.plant)
            
            # Resolve Plant: If order has no plant, take from first work center resolved
            plant = planned_order.plant
            if not plant and wc:
                plant = wc.plant
                # Save it back for future reference
                planned_order.plant = plant
                planned_order.save()
            
            plant_locations = InventoryLocation.objects.filter(plant=plant) if plant else None
            
            from_loc, to_loc = None, None
            if plant_locations:
                def _pick_loc(qs):
                    # Prefer system-defined locations when duplicates exist (common in seeded/dev DBs).
                    return qs.filter(is_system=True).first() or qs.first()

                if index == 0:
                    from_loc = _pick_loc(plant_locations.filter(type='RM'))
                else:
                    from_loc = _pick_loc(plant_locations.filter(type='WIP'))
                    
                # to_location logic
                is_last_step_of_route = (index == len(processes) - 1)
                is_terminal_step_for_this_order = (index == stop_index)
                
                if is_last_step_of_route:
                    # Final step always goes to FG
                    to_loc = _pick_loc(plant_locations.filter(type='FG'))
                elif is_terminal_step_for_this_order:
                    # If this is where we "Stop", usually goes to WIP (e.g. Stock laminated rolls)
                    # unless it's already the last step
                    to_loc = _pick_loc(plant_locations.filter(type='WIP'))
                else:
                    to_loc = _pick_loc(plant_locations.filter(type='WIP'))

            base_job_number = f"{planned_order.order_number}-{index+1}"
            job = ProductionJob.objects.create(
                job_number=cls._next_unique_job_number(base_job_number),
                origin='STOCK',
                template=template,
                mts_order=planned_order,
                execution_model_version=2,
                routing_rule=template.routing_rule,
                current_step_index=index,
                current_process=process,
                input_form=process.input_form,
                output_form=process.output_form,
                work_center=wc,
                from_location=from_loc,
                to_location=to_loc,
                quantity=target_qty,
                remaining_qty=target_qty,
                uom=target_uom,
                status='QUEUED',
                source_type='STOCK',
                job_state='PLANNED' if index == start_index else 'WAITING'
            )
            
            # Phase 71: Explode BOM into Requirements
            from apps.production.services.services_execution import ExecutionService
            ExecutionService.calculate_requirements(job.id)
            
            jobs.append(job)
        return jobs

    @classmethod
    def get_work_center_queue(cls, work_center_id):
        return ProductionJob.objects.filter(
            work_center_id=work_center_id,
            job_state='RELEASED'
        ).order_by('priority', 'planned_date', 'current_step_index')

    @classmethod
    def assign_job(cls, job, machine, operator):
        if job.status not in ['QUEUED', 'ASSIGNED']:
            raise ValueError(f"Cannot assign job in {job.status} status.")
        job.machine = machine
        job.operator = operator
        job.status = 'ASSIGNED'
        job.save()
        return job

    @classmethod
    def start_job(cls, job, user=None):
        from django.utils import timezone
        from apps.inventory.models import InventoryReservation, InventoryRoll
        from apps.costing.services import CostingService
        
        with transaction.atomic():
            job.status = 'RUNNING'
            job.job_state = 'EXECUTING'
            job.start_date = timezone.now()
            job.save()
            CostingService.open_runtime_session(job, user=user, ts=job.start_date)
            
            # Phase 64B: Move Reserved Rolls directly to IN_PROCESS
            reservations = InventoryReservation.objects.filter(job=job, status='ACTIVE', roll__isnull=False)
            for res in reservations:
                roll = res.roll
                if roll.status == 'RESERVED':
                    roll.status = 'IN_PROCESS'
                    roll.save()
                    
        return job

    @classmethod
    def complete_job(cls, job, actual_qty, completion_meta=None, user=None):
        """
        Process-Driven Completion logic (Phase 28).
        Handles output creation based on form and advances routing on full completion.
        """
        if job.status != 'RUNNING':
            raise ValueError("Only RUNNING jobs can be completed.")
        
        from apps.production.services.services_execution import ExecutionService
        from apps.costing.services import CostingService
        # from apps.production.services.operator_service import OperatorService # Deprecated for Completion
        
        with transaction.atomic():
            # 1. Universal Execution (Phase 67)
            # Handles Physics-driven Consumption and Output Creation
            ExecutionService.execute_completion(job.id, actual_qty, user=user, **(completion_meta or {}))

            # 3. Update Quantities
            job.produced_qty += actual_qty
            job.remaining_qty -= actual_qty
            if job.remaining_qty < 0: job.remaining_qty = 0
            
            # 4. State Advancement
            is_fully_done = (job.remaining_qty <= 0)
            
            if is_fully_done:
                CostingService.close_runtime_session(job, close_reason='COMPLETE', user=user)
                cls._finalize_step_completion(job, user=user)
            else:
                # Partial Completion: Job remains RELEASED/RUNNING but with updated remaining_qty
                # Revert status to RELEASED so it shows in queue, OR keep RUNNING?
                # User said: "job remains RELEASED"
                job.status = 'ASSIGNED' # Or 'RUNNING' if still on machine? 
                # Let's use 'ASSIGNED' so operator has to 'start' again, or just 'RELEASED'?
                # Usually partial means operator stops for now.
                job.job_state = 'RELEASED'
                job.status = 'QUEUED' # Re-queue for next shift/session
                job.save()
                
                job.status = 'QUEUED' # Re-queue for next shift/session
                job.save()
                CostingService.close_runtime_session(job, close_reason='PAUSE', user=user)
                
        return job

    @classmethod
    def release_job(cls, job_id):
        job = ProductionJob.objects.get(id=job_id)
        if job.job_state not in ['PLANNED', 'WAITING']:
            raise ValueError(f"Can only release PLANNED or WAITING jobs. Current state: {job.job_state}")
        
        with transaction.atomic():
            job.job_state = 'RELEASED'
            job.save()
            planned_jobwork_order = cls._auto_pause_for_planned_jobwork(job)
            setattr(job, "_planned_jobwork_order", planned_jobwork_order)
            if not planned_jobwork_order:
                # This will create or get the WorkCenterAssignment
                WCManagerService.prepare_job_for_wc(job)
        return job

    @classmethod
    def pause_job(cls, job_id, reason=None):
        job = ProductionJob.objects.get(id=job_id)
        if job.job_state not in ['EXECUTING', 'RELEASED']:
            raise ValueError(f"Cannot pause job in {job.job_state} state.")
        from apps.costing.services import CostingService
        CostingService.close_runtime_session(job, close_reason='PAUSE')
        job.job_state = 'PAUSED'
        if reason:
            job.hold_reason = reason
        job.save()
        return job

    @classmethod
    def resume_job(cls, job_id, user=None):
        job = ProductionJob.objects.get(id=job_id)
        if job.job_state != 'PAUSED':
            raise ValueError("Can only resume PAUSED jobs.")
        if job.status == 'RUNNING':
            job.job_state = 'EXECUTING'
            from apps.costing.services import CostingService
            CostingService.open_runtime_session(job, user=user)
        else:
            job.job_state = 'RELEASED'
        job.save()
        return job

    @classmethod
    def reprioritize_job(cls, job_id, new_priority):
        job = ProductionJob.objects.get(id=job_id)
        job.priority = new_priority
        job.save()
        return job

    @classmethod
    def toggle_hold(cls, job_id, reason=None):
        job = ProductionJob.objects.get(id=job_id)
        job.is_on_hold = not job.is_on_hold
        if job.is_on_hold:
            job.hold_reason = reason
        else:
            job.hold_reason = None
        job.save()
        return job

    @classmethod
    def split_job(cls, job_id, split_qty):
        from decimal import Decimal
        job = ProductionJob.objects.get(id=job_id)
        split_qty = Decimal(str(split_qty))
        
        if split_qty >= job.quantity:
            raise ValueError("Split quantity must be less than current job quantity.")
        if job.job_state != 'PLANNED':
            raise ValueError("Only PLANNED jobs can be split.")

        with transaction.atomic():
            original_qty = job.quantity
            job.quantity = original_qty - split_qty
            job.save()

            child_job = ProductionJob.objects.create(
                job_number=f"{job.job_number}-S",
                origin=job.origin,
                source_type=job.source_type,
                job_state='PLANNED',
                template=job.template,
                sales_order_item=job.sales_order_item,
                routing_rule=job.routing_rule,
                current_step_index=job.current_step_index,
                current_process=job.current_process,
                work_center=job.work_center,
                priority=job.priority,
                planned_date=job.planned_date,
                input_form=job.input_form,
                output_form=job.output_form,
                from_location=job.from_location,
                to_location=job.to_location,
                quantity=split_qty,
                remaining_qty=split_qty,
                uom=job.uom,
                status='QUEUED'
            )
            return job, child_job

    @classmethod
    def send_to_jobwork(
        cls,
        job_id,
        *,
        vendor_id=None,
        mode: str = "EMERGENCY",
        emergency_reason: str = "",
        notes: str = "",
    ):
        from django.core.exceptions import ValidationError
        from apps.inventory.models import Vendor, JobWorkOrder
        from apps.inventory.services.job_work import JobWorkService

        job = ProductionJob.objects.select_related(
            "current_process",
            "process",
            "work_center__plant",
            "from_location__plant",
            "to_location__plant",
        ).get(id=job_id)

        if job.job_state not in {"RELEASED", "EXECUTING", "PAUSED"}:
            raise ValidationError(
                f"Only RELEASED, EXECUTING, or PAUSED jobs can be sent to jobwork. Current state: {job.job_state}"
            )

        normalized_mode = str(mode or "EMERGENCY").upper()
        if normalized_mode not in {"PLANNED_STEP", "EMERGENCY"}:
            raise ValidationError("mode must be PLANNED_STEP or EMERGENCY.")

        process = job.current_process or job.process
        process_code = str(getattr(process, "code", "") or "").upper()
        if normalized_mode == "PLANNED_STEP" and "JOBWORK" not in process_code:
            raise ValidationError(
                "PLANNED_STEP jobwork can only be initiated on a configured jobwork route step."
            )

        emergency_reason = str(emergency_reason or "").strip()
        if normalized_mode == "EMERGENCY" and not emergency_reason:
            raise ValidationError("Emergency reason is required for EMERGENCY jobwork.")

        # Resolve plant from job context (WC -> from_location -> to_location).
        plant = None
        if job.work_center and job.work_center.plant:
            plant = job.work_center.plant
        elif job.from_location and job.from_location.plant:
            plant = job.from_location.plant
        elif job.to_location and job.to_location.plant:
            plant = job.to_location.plant
        if not plant:
            plant = Plant.objects.first()
        if not plant:
            raise ValidationError("Could not resolve plant for this job.")

        vendor = None
        if vendor_id:
            vendor = Vendor.objects.get(id=vendor_id)
            verdict = JobWorkService.vendor_matches_jobwork(
                vendor,
                process_code=process_code,
                plant=plant,
            )
            if not verdict["match"]:
                raise ValidationError(" ".join(verdict["reasons"]) or "Vendor is not compatible for this job.")
        else:
            candidates = JobWorkService.compatible_vendors(process_code=process_code, plant=plant)
            vendor = next((candidate for candidate, verdict in candidates if verdict.get("match")), None)
            if not vendor:
                raise ValidationError("No compatible active jobwork vendor found for this process/plant.")

        existing = JobWorkOrder.objects.filter(
            production_job=job,
            status__in=["DRAFT", "SENT", "PARTIAL"],
        ).order_by("-created_at").first()

        if existing:
            update_fields = []
            if vendor and existing.vendor_id != vendor.id:
                existing.vendor = vendor
                existing.vendor_name = vendor.name
                update_fields.extend(["vendor", "vendor_name"])
            if existing.mode != normalized_mode:
                existing.mode = normalized_mode
                update_fields.append("mode")
            if existing.route_step_index != job.current_step_index:
                existing.route_step_index = job.current_step_index
                update_fields.append("route_step_index")
            if normalized_mode == "EMERGENCY" and emergency_reason and existing.emergency_reason != emergency_reason:
                existing.emergency_reason = emergency_reason
                update_fields.append("emergency_reason")
            if notes and existing.notes != notes:
                existing.notes = notes
                update_fields.append("notes")
            if update_fields:
                existing.save(update_fields=update_fields)
            order = existing
        else:
            order = JobWorkService.create_order(
                plant=plant,
                vendor=vendor,
                sent_material_type="WIP",
                expected_return="WIP",
                production_job=job,
                notes=notes or f"{normalized_mode} jobwork handoff from {job.job_number}",
                mode=normalized_mode,
                route_step_index=job.current_step_index,
                emergency_reason=emergency_reason,
            )

        pause_reason = (
            f"Sent to Job Work ({vendor.name})"
            if normalized_mode == "PLANNED_STEP"
            else f"Emergency Job Work: {emergency_reason}"
        )
        if job.job_state in {"RELEASED", "EXECUTING"}:
            job = cls.pause_job(job_id, reason=pause_reason)
        else:
            job.hold_reason = pause_reason
            job.save(update_fields=["hold_reason"])

        job.is_on_hold = True
        job.save(update_fields=["is_on_hold"])
        return job, order

class WCManagerService:
    @classmethod
    def prepare_job_for_wc(cls, job):
        from apps.production.models import WorkCenterAssignment

        if not job.work_center_id:
            fallback_plant = (
                getattr(job.mts_order, "plant", None)
                or getattr(job.from_location, "plant", None)
                or getattr(job.to_location, "plant", None)
            )
            resolved_wc = JobService._resolve_work_center_for_process(
                job.current_process or job.process,
                plant=fallback_plant,
            )
            if not resolved_wc:
                raise ValueError(
                    f"No work center is mapped for process {getattr(job.current_process or job.process, 'code', 'UNKNOWN')}."
                )
            job.work_center = resolved_wc
            job.save(update_fields=["work_center", "updated_at"])

        assignment, created = WorkCenterAssignment.objects.get_or_create(
            production_job=job,
            defaults={'work_center': job.work_center}
        )
        
        # Roll Flow (System-Owned): auto-forwarded rolls are discovered by the Flow Engine (WIP Pool)
        # and reserved only when pushing to operator (auto_satisfy_inputs). WCM never manually carries
        # WIP forward for steps > 0.
        
        return assignment

    @classmethod
    def _validate_roll_assignment_set(cls, job, process, roll_ids):
        from apps.inventory.models import InventoryRoll
        from apps.production.services.services_execution import ExecutionService

        selected_ids = [str(rid) for rid in (roll_ids or []) if rid]
        if not selected_ids:
            return
        rolls = list(
            InventoryRoll.objects.filter(id__in=selected_ids).select_related(
                "material",
                "material__parent_family",
                "grade",
                "location",
            )
        )
        if len(rolls) != len(set(selected_ids)):
            raise ValueError("One or more selected rolls could not be resolved for assignment.")
        validation = ExecutionService._summarize_roll_assignment_validation(
            job,
            process,
            rolls,
            allow_input_stock_fallback=True,
        )
        if not validation.get("slot_satisfied"):
            raise ValueError(
                "Selected rolls do not satisfy distinct target slots for this step. "
                "Review the layer/spec mix before assignment."
            )

    @classmethod
    def _sync_assignment_status(cls, assignment):
        """
        Keep assignment status consistent with actual resource readiness.
        - `WC_READY`: not enough resources selected yet
        - `ASSIGNED`: machine + required roll reservations are present
        """
        from apps.inventory.models import InventoryReservation, InventoryRoll
        from apps.production.models import JobExecutionLog, ScrapLog, DowntimeLog, MaterialConsumptionLog

        job = assignment.production_job
        process = job.current_process or job.process
        if not assignment.assigned_machine_id and getattr(job, "machine_id", None):
            assignment.assigned_machine_id = job.machine_id
        machine_ok = bool(assignment.assigned_machine_id)
        previous_status = str(getattr(assignment, "status", "") or "").upper()
        has_activity_logs = (
            JobExecutionLog.objects.filter(production_job=job).exists() or
            ScrapLog.objects.filter(production_job=job).exists() or
            DowntimeLog.objects.filter(production_job=job).exists() or
            MaterialConsumptionLog.objects.filter(production_job=job).exists()
        )
        runtime_state = (
            str(getattr(job, "job_state", "") or "").upper() in {"EXECUTING", "PAUSED"} or
            str(getattr(job, "status", "") or "").upper() == "RUNNING"
        )
        job_started = has_activity_logs or (previous_status == "EXECUTION_READY" and machine_ok and runtime_state)

        required_rolls = 0
        if process:
            from apps.production.services.services_execution import ExecutionService
            required_rolls = ExecutionService._required_roll_count(job, process)

        if job_started:
            reserved_rolls = assignment.allocated_rolls.count()
        else:
            # Count only physically valid active reservations.
            # This prevents stale "ASSIGNED" state when reservation rows exist
            # but rolls are no longer truly reserved/usable.
            active_reservations = InventoryReservation.objects.filter(
                job=job,
                status='ACTIVE',
                roll__isnull=False,
                roll__status='RESERVED',
            )
            reserved_rolls = active_reservations.count()
            # Keep legacy M2M mirror aligned with reservation source-of-truth.
            assignment.allocated_rolls.set(
                InventoryRoll.objects.filter(id__in=active_reservations.values_list('roll_id', flat=True))
            )

        roll_ok = (required_rolls == 0) or (reserved_rolls >= required_rolls)
        ready_core = machine_ok and roll_ok

        # Preserve machine execution once work has actually started. Active
        # reservations may already be consumed by then, so roll readiness is no
        # longer a preparation gate.
        if job_started:
            assignment.status = 'EXECUTION_READY'
        elif assignment.status == 'EXECUTION_READY':
            assignment.status = 'EXECUTION_READY' if ready_core else 'WC_READY'
        else:
            assignment.status = 'ASSIGNED' if ready_core else 'WC_READY'

        # If an unstarted job was previously pushed and then lost a preparation
        # requirement, pull the job state back from machine execution. This is
        # the source-of-truth repair that prevents WCM from showing unallocated
        # work as running/ready.
        if not job_started and assignment.status != 'EXECUTION_READY':
            next_job_status = 'ASSIGNED' if assignment.status == 'ASSIGNED' else 'QUEUED'
            updates = []
            if str(getattr(job, "job_state", "") or "").upper() == 'RELEASED':
                job.job_state = 'PLANNED'
                updates.append('job_state')
            if str(getattr(job, "status", "") or "").upper() in {'ASSIGNED', 'RUNNING'} and job.status != next_job_status:
                job.status = next_job_status
                updates.append('status')
            if updates:
                updates.append('updated_at')
                job.save(update_fields=updates)

    @classmethod
    def _ensure_pre_release_editable(cls, assignment):
        status = str(getattr(assignment, "status", "") or "").upper()
        job = getattr(assignment, "production_job", None)
        job_state = str(getattr(job, "job_state", "") or "").upper()
        job_status = str(getattr(job, "status", "") or "").upper()
        if status == "EXECUTION_READY" or job_state in {"EXECUTING", "PAUSED"} or job_status in {"RUNNING"}:
            raise ValueError("This job is already released to machine execution. Preparation changes are locked.")

    @classmethod
    def assign_machine(cls, assignment_id, machine_id, roll_ids=None, user=None, manual_override=False, override_reason=None):
        from apps.production.models import WorkCenterAssignment
        from apps.factory.models import Machine
        from django.db import transaction
        from django.utils import timezone
        
        with transaction.atomic():
            assignment = WorkCenterAssignment.objects.get(id=assignment_id)
            cls._ensure_pre_release_editable(assignment)
            machine = Machine.objects.get(id=machine_id)
            
            assignment.assigned_machine = machine
            
            # Optional: Assign Rolls in the same step
            if roll_ids:
                from apps.inventory.models import InventoryRoll
                from apps.inventory.models import InventoryReservation
                from apps.production.services.services_execution import ExecutionService
                from django.db.models import Q

                job = assignment.production_job
                process = job.current_process or job.process

                # Enforce physics-driven roll count (never user-defined).
                required_rolls = ExecutionService._required_roll_count(job, process)

                existing_reserved = set(
                    str(rid)
                    for rid in InventoryReservation.objects.filter(job=job, status='ACTIVE', roll__isnull=False)
                    .values_list('roll_id', flat=True)
                )
                requested = [str(rid) for rid in (roll_ids or [])]
                new_roll_ids = [rid for rid in requested if rid and rid not in existing_reserved]
                candidate_roll_ids = list(existing_reserved) + new_roll_ids

                if required_rolls == 0 and new_roll_ids:
                    raise ValueError("This process does not consume rolls.")
                if required_rolls and (len(existing_reserved) + len(new_roll_ids)) > required_rolls:
                    raise ValueError(f"Too many rolls selected. Required: {required_rolls}.")
                cls._validate_roll_assignment_set(job, process, candidate_roll_ids)

                # Create strict reservations (InventoryReservation is the source of truth).
                for rid in new_roll_ids:
                    # Auto-repair orphaned RESERVED rolls (status flipped without a reservation record).
                    # This can happen in dev/test flows when older code paths were used.
                    from apps.inventory.models import InventoryRoll
                    roll = InventoryRoll.objects.filter(id=rid).first()
                    if roll and roll.status == "RESERVED":
                        has_res = InventoryReservation.objects.filter(roll=roll, status="ACTIVE").exists()
                        if not has_res:
                            roll.status = "AVAILABLE"
                            roll.save(update_fields=["status"])
                    ExecutionService.assign_roll_to_job(
                        job.id,
                        rid,
                        user=user,
                        override_reason=override_reason,
                        manual_override=manual_override,
                    )

                # Keep legacy assignment linkage in sync for UI convenience.
                reserved_rolls = InventoryRoll.objects.filter(Q(id__in=existing_reserved) | Q(id__in=new_roll_ids))
                assignment.allocated_rolls.set(reserved_rolls)
                assignment.assigned_by = user
                assignment.assigned_at = timezone.now()

            cls._sync_assignment_status(assignment)
            assignment.save()
            
            job = assignment.production_job
            job.machine = machine
            job.save()
            
            return assignment

    @classmethod
    def assign_rolls(cls, assignment_id, roll_ids, user=None, manual_override=False, override_reason=None):
        from apps.production.models import WorkCenterAssignment
        from apps.inventory.models import InventoryRoll
        from apps.inventory.models import InventoryReservation
        from apps.production.services.services_execution import ExecutionService
        from django.utils import timezone
        from django.db.models import Q
        
        with transaction.atomic():
            assignment = WorkCenterAssignment.objects.get(id=assignment_id)
            cls._ensure_pre_release_editable(assignment)
            job = assignment.production_job
            process = job.current_process or job.process

            # Enforce physics-driven roll count (never user-defined).
            required_rolls = ExecutionService._required_roll_count(job, process)

            existing_reserved = set(
                str(rid)
                for rid in InventoryReservation.objects.filter(job=job, status='ACTIVE', roll__isnull=False)
                .values_list('roll_id', flat=True)
            )
            requested = [str(rid) for rid in (roll_ids or [])]
            new_roll_ids = [rid for rid in requested if rid and rid not in existing_reserved]
            candidate_roll_ids = list(existing_reserved) + new_roll_ids

            if required_rolls == 0 and new_roll_ids:
                raise ValueError("This process does not consume rolls.")
            if required_rolls and (len(existing_reserved) + len(new_roll_ids)) > required_rolls:
                raise ValueError(f"Too many rolls selected. Required: {required_rolls}.")
            cls._validate_roll_assignment_set(job, process, candidate_roll_ids)

            for rid in new_roll_ids:
                # Auto-repair orphaned RESERVED rolls (status flipped without a reservation record).
                from apps.inventory.models import InventoryRoll
                roll = InventoryRoll.objects.filter(id=rid).first()
                if roll and roll.status == "RESERVED":
                    has_res = InventoryReservation.objects.filter(roll=roll, status="ACTIVE").exists()
                    if not has_res:
                        roll.status = "AVAILABLE"
                        roll.save(update_fields=["status"])
                ExecutionService.assign_roll_to_job(
                    job.id,
                    rid,
                    user=user,
                    override_reason=override_reason,
                    manual_override=manual_override,
                )

            # Keep legacy assignment linkage in sync for UI convenience.
            reserved_rolls = InventoryRoll.objects.filter(Q(id__in=existing_reserved) | Q(id__in=new_roll_ids))
            assignment.allocated_rolls.set(reserved_rolls)
            assignment.assigned_by = user
            assignment.assigned_at = timezone.now()

            cls._sync_assignment_status(assignment)
            assignment.save()
            
        return assignment

    @classmethod
    def unassign_roll(cls, assignment_id, reservation_id, user=None):
        from apps.production.models import WorkCenterAssignment
        from apps.inventory.models import InventoryReservation, InventoryRoll
        from apps.production.services.services_execution import ExecutionService
        from django.utils import timezone

        with transaction.atomic():
            assignment = WorkCenterAssignment.objects.get(id=assignment_id)
            cls._ensure_pre_release_editable(assignment)
            job = assignment.production_job

            # Clear legacy links before unassigning to prevent any reconciliation
            # path from recreating a just-released reservation.
            assignment.allocated_rolls.clear()

            # Unassign reservation at the engine layer (reverts roll status + requirement).
            ExecutionService.unassign_roll(job.id, reservation_id)

            # Sync legacy linkage for UI convenience.
            reserved_roll_ids = InventoryReservation.objects.filter(
                job=job, status="ACTIVE", roll__isnull=False
            ).values_list("roll_id", flat=True)
            reserved_rolls = InventoryRoll.objects.filter(id__in=list(reserved_roll_ids))
            assignment.allocated_rolls.set(reserved_rolls)

            assignment.assigned_by = user
            assignment.assigned_at = timezone.now()
            cls._sync_assignment_status(assignment)
            assignment.save()

        return assignment

    @classmethod
    def unassign_roll_by_roll(cls, assignment_id, roll_id, user=None):
        from apps.production.models import WorkCenterAssignment
        from apps.inventory.models import InventoryReservation, InventoryRoll
        from apps.production.services.services_execution import ExecutionService
        from django.utils import timezone
        from django.db.models import Q

        with transaction.atomic():
            assignment = WorkCenterAssignment.objects.get(id=assignment_id)
            cls._ensure_pre_release_editable(assignment)
            job = assignment.production_job

            # Frontend may pass either roll_id or reservation_id in some legacy paths.
            # Accept both to make unassign idempotent and robust.
            res = InventoryReservation.objects.filter(
                Q(job=job, roll_id=roll_id, status="ACTIVE") |
                Q(job=job, id=roll_id, status="ACTIVE")
            ).first()

            # Clear legacy links before unassigning to prevent any reconciliation
            # path from recreating a just-released reservation.
            assignment.allocated_rolls.clear()

            if res:
                ExecutionService.unassign_roll(job.id, res.id)
            else:
                # Legacy recovery: release roll even if reservation is missing
                roll = InventoryRoll.objects.filter(id=roll_id).first()
                if roll and roll.status == "RESERVED":
                    roll.status = "AVAILABLE"
                    roll.save(update_fields=["status"])

            # Sync legacy linkage
            reserved_roll_ids = InventoryReservation.objects.filter(
                job=job, status="ACTIVE", roll__isnull=False
            ).values_list("roll_id", flat=True)
            reserved_rolls = InventoryRoll.objects.filter(id__in=list(reserved_roll_ids))
            assignment.allocated_rolls.set(reserved_rolls)

            assignment.assigned_by = user
            assignment.assigned_at = timezone.now()
            cls._sync_assignment_status(assignment)
            assignment.save()

        return assignment

    @classmethod
    def _ensure_job_source_location(cls, job):
        """
        Repair missing job.from_location before readiness checks.
        """
        if job.from_location_id:
            return job.from_location

        plant_id = None
        if job.work_center_id and job.work_center and job.work_center.plant_id:
            plant_id = job.work_center.plant_id
        elif job.to_location_id and job.to_location and job.to_location.plant_id:
            plant_id = job.to_location.plant_id
        if not plant_id:
            raise ValueError("Cannot resolve source location: job plant not found.")

        locations = InventoryLocation.objects.filter(plant_id=plant_id, is_active=True)
        if not locations.exists():
            raise ValueError("Cannot resolve source location: no active locations in plant.")

        preferred_types = ["RM", "WIP", "WAREHOUSE"] if (job.current_step_index or 0) == 0 else ["WIP", "RM", "WAREHOUSE"]
        chosen = None
        for loc_type in preferred_types:
            chosen = (
                locations.filter(type=loc_type, is_system=False).order_by("name").first()
                or locations.filter(type=loc_type).order_by("name").first()
            )
            if chosen:
                break
        if not chosen:
            chosen = locations.order_by("is_system", "name").first()
        if not chosen:
            raise ValueError("Cannot resolve source location for job.")

        job.from_location = chosen
        job.save(update_fields=["from_location", "updated_at"])
        return chosen

    @classmethod
    def mark_execution_ready(cls, assignment_id, material_confirmations=None):
        from apps.production.models import WorkCenterAssignment
        from apps.production.services.services_execution import ExecutionService
        from django.utils import timezone
        assignment = WorkCenterAssignment.objects.get(id=assignment_id)
        
        if not assignment.assigned_machine:
            # If rolls are auto-assigned but machine isn't, we still need a machine.
            # But the UI will handle machine assignment. The validation remains.
            raise ValueError("Machine must be assigned before marking as execution ready.")
        
        job = assignment.production_job
        # Route integrity guard: downstream step cannot be execution-ready while
        # any upstream lineage step is still open.
        lineage_qs = ProductionJob.objects.exclude(id=job.id)
        if getattr(job, "sales_order_item_id", None):
            lineage_qs = lineage_qs.filter(sales_order_item_id=job.sales_order_item_id)
        elif getattr(job, "mts_order_id", None):
            lineage_qs = lineage_qs.filter(mts_order_id=job.mts_order_id)
        elif getattr(job, "template_id", None):
            lineage_qs = lineage_qs.filter(template_id=job.template_id)
        else:
            lineage_qs = lineage_qs.none()

        upstream_open = lineage_qs.filter(
            current_step_index__lt=job.current_step_index
        ).exclude(
            job_state__in=["COMPLETED", "CANCELLED"]
        ).exclude(
            status__in=["COMPLETED", "CANCELLED"]
        ).order_by("current_step_index", "created_at").first()
        if upstream_open:
            raise ValueError(
                f"Cannot mark ready: upstream step {upstream_open.job_number} is not completed yet."
            )

        # Auto-prepare inputs before readiness check.
        cls._ensure_job_source_location(job)
        ExecutionService.top_up_bulk_source_location(job.id)
        ExecutionService.auto_satisfy_inputs(job.id)

        # Validation: requirements must be satisfied (rolls + bulk)
        job = assignment.production_job
        status = ExecutionService.get_satisfaction_status(job.id)
        if not status.get('is_satisfied'):
            pending_rows = []
            for row in status.get('bulk_consumption') or []:
                required = Decimal(str(row.get('required_qty_kg') or 0))
                available = Decimal(str(row.get('available_qty_kg') or 0))
                if required > available:
                    pending_rows.append(f"{row.get('material_name') or row.get('category')}: need {required - available} kg at source")
            if status.get('rolls_missing'):
                pending_rows.append(f"rolls missing: {status.get('rolls_missing')}")
            detail = f" ({'; '.join(pending_rows[:3])})" if pending_rows else ""
            raise ValueError(f"Cannot mark ready: requirements not satisfied{detail}.")

        if material_confirmations is not None:
            if not isinstance(material_confirmations, list):
                raise ValueError("material_confirmations must be a list.")
            job.current_step_material_confirmations = material_confirmations

        ready_timestamp = timezone.now()
        updated = WorkCenterAssignment.objects.filter(id=assignment.id).update(
            status='EXECUTION_READY',
            updated_at=ready_timestamp,
        )
        if not updated:
            raise ValueError("Assignment could not be marked execution ready.")
        assignment.status = 'EXECUTION_READY'
        assignment.updated_at = ready_timestamp
        
        # Also update job state/status so Operator dashboard can consistently discover it.
        job = assignment.production_job
        job.status = 'ASSIGNED'
        if job.job_state not in ['EXECUTING', 'PAUSED']:
            job.job_state = 'RELEASED'
        ProductionJob.objects.filter(id=job.id).update(
            status=job.status,
            job_state=job.job_state,
            current_step_material_confirmations=job.current_step_material_confirmations,
            updated_at=ready_timestamp,
        )
        job.updated_at = ready_timestamp
        
        return assignment
