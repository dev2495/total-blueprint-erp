import logging

from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone
from decimal import Decimal
from django.conf import settings
from apps.production.models import ProductionJob, JobExecutionLog, WorkCenterAssignment
from apps.factory.models import Process, Plant
from apps.inventory.models import InventoryLocation, InventoryRoll, InventoryReservation
from apps.production.services.shift_resolver import build_shift_fields_for_job
from apps.templates.services import RouteDispatchError, TemplateDispatchService
from apps.bom.readiness import require_bom_ready_for_production

logger = logging.getLogger(__name__)


class MachineBusyError(Exception):
    """
    Raised by legacy callers that still enforce exclusive machine execution.
    WCM assignment/readiness can queue work behind a running job.
    """

    def __init__(self, message, conflicting_job_number=None):
        super().__init__(message)
        self.conflicting_job_number = conflicting_job_number


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
    def _resolve_work_center_for_process(cls, process, *, plant=None, template=None, step_index=None, strict=True, selected_work_center_id=None):
        return TemplateDispatchService.resolve_work_center(
            process,
            plant=plant,
            template=template,
            step_index=step_index,
            strict=strict,
            selected_work_center_id=selected_work_center_id,
        )

    @classmethod
    def _normalize_work_center_overrides(cls, overrides):
        if not overrides:
            return {}
        rows = overrides.items() if isinstance(overrides, dict) else overrides
        normalized = {}
        for row in rows:
            if isinstance(row, tuple) and len(row) == 2:
                raw_step, raw_wc = row
            elif isinstance(row, dict):
                raw_step = row.get("step_index")
                raw_wc = row.get("work_center_id") or row.get("work_center")
            else:
                continue
            try:
                step_index = int(raw_step)
            except Exception:
                continue
            wc_id = str(raw_wc or "").strip()
            if wc_id:
                normalized[step_index] = wc_id
        return normalized

    @classmethod
    def _step_locations_for_work_center(cls, *, work_center, route_index, route_last_index):
        plant = work_center.plant if work_center else Plant.objects.first()
        plant_locations = InventoryLocation.objects.filter(plant=plant) if plant else InventoryLocation.objects.none()
        if not plant_locations.exists():
            return plant, None, None

        def _pick_loc(qs):
            return qs.filter(is_system=True).first() or qs.first()

        rm_loc = _pick_loc(plant_locations.filter(type='RM'))
        fg_loc = _pick_loc(plant_locations.filter(type='FG'))
        wip_loc = work_center.default_wip_location if work_center and work_center.default_wip_location_id else _pick_loc(plant_locations.filter(type='WIP'))
        from_loc = rm_loc if int(route_index or 0) == 0 else wip_loc
        to_loc = fg_loc if int(route_index or 0) == int(route_last_index or 0) else wip_loc
        return plant, from_loc, to_loc

    @classmethod
    def _route_last_index(cls, routing_rule):
        if not routing_rule:
            return 0
        try:
            from apps.production.services.batch_route_service import RouteGraphService

            nodes = RouteGraphService.normalize(routing_rule).get("nodes") or []
            if nodes:
                return max(RouteGraphService.step_index_for_node(node) for node in nodes)
        except Exception:
            pass
        return max(0, len(list(getattr(routing_rule, "ordered_processes", None) or [])) - 1)

    @classmethod
    def _plant_constraint_for_release(cls, job):
        if getattr(job, "mts_order_id", None):
            return getattr(job.mts_order, "plant", None)
        if not getattr(job, "template_id", None):
            return (
                getattr(job.from_location, "plant", None)
                or getattr(job.to_location, "plant", None)
            )
        return None

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
        from apps.sales.services.order_service import SalesOrderService

        so_item = getattr(job, "sales_order_item", None)
        if not so_item:
            return
        sales_order = getattr(so_item, "sales_order", None)
        if not sales_order:
            return

        route_last_index = cls._route_last_index(job.routing_rule)
        metrics = cls._sales_item_shortfall_metrics(so_item, route_last_index)

        active_line_jobs_exist = ProductionJob.objects.filter(
            sales_order_item=so_item
        ).exclude(job_state__in=["COMPLETED", "CANCELLED"]).exists()
        if active_line_jobs_exist:
            return

        if metrics["requires_replan"]:
            so_item.line_status = "PARTIAL"
            so_item.save(update_fields=["line_status"])
            sales_order.status = "PLANNING_REQUIRED"
            sales_order.save(update_fields=["status"])
            return

        if metrics["shortfall_kg"] > 0:
            close_qty = SalesOrderService._line_qty_from_kg(so_item, metrics["shortfall_kg"])
            if close_qty > 0:
                so_item.qty_short_closed = Decimal(str(so_item.qty_short_closed or 0)) + min(
                    close_qty,
                    Decimal(str(so_item.qty_open or 0)),
                )
                so_item.line_closed_reason = "Auto short-close within production tolerance."
                so_item.line_closed_at = timezone.now()

        so_item.line_status = "PACKING_READY" if Decimal(str(so_item.qty_open or 0)) > Decimal("0") else "COMPLETED"
        so_item.save(update_fields=["qty_short_closed", "line_status", "line_closed_reason", "line_closed_at"])

        # Other non-terminal lines/jobs keep the parent order in active lifecycle.
        active_order_jobs_exist = ProductionJob.objects.filter(
            sales_order_item__sales_order=sales_order
        ).exclude(job_state__in=["COMPLETED", "CANCELLED"]).exists()
        if active_order_jobs_exist:
            return

        if sales_order.items.filter(line_status="PARTIAL").exists():
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
    def _route_decision_actor(cls, user):
        if not user:
            return ""
        return str(getattr(user, "username", "") or getattr(user, "email", "") or getattr(user, "id", "") or "")

    @classmethod
    def _record_route_step_decision(cls, job, decision):
        meta = job.meta_json if isinstance(job.meta_json, dict) else {}
        meta["route_step_decision"] = decision
        job.meta_json = meta
        if getattr(job, "production_batch_id", None):
            batch = job.production_batch
            batch_meta = batch.meta_json if isinstance(batch.meta_json, dict) else {}
            decisions = [row for row in batch_meta.get("route_decisions", []) if isinstance(row, dict)]
            route_node_id = str(decision.get("route_node_id") or "")
            decisions = [row for row in decisions if str(row.get("route_node_id") or "") != route_node_id]
            decisions.append(decision)
            batch_meta["route_decisions"] = decisions
            batch.meta_json = batch_meta
            batch.save(update_fields=["meta_json", "updated_at"])

    @classmethod
    def _release_ready_successors(cls, job, _visited=None):
        from apps.production.services.batch_route_service import RouteGraphService

        _visited = set(_visited or set())
        if str(job.id) in _visited:
            return []
        _visited.add(str(job.id))
        released = []
        for next_job in RouteGraphService.ready_successor_jobs(job):
            current_plant_id = cls._resolve_job_plant_id(job)
            next_plant_id = cls._resolve_job_plant_id(next_job)
            if current_plant_id and next_plant_id and current_plant_id != next_plant_id:
                interplant_dc = cls._create_and_dispatch_interplant_dc(job, next_job)
                setattr(job, "_interplant_dc", interplant_dc)
                released.append(next_job)
            else:
                released.append(cls.release_job(next_job.id))
        node = RouteGraphService.node_for_job(job)
        skipped_successor_ids = set((node or {}).get("successor_node_ids") or [])
        if skipped_successor_ids:
            skipped_qs = ProductionJob.objects.filter(
                routing_rule=job.routing_rule,
                job_state="COMPLETED",
                route_node_id__in=skipped_successor_ids,
            )
            if getattr(job, "production_batch_id", None):
                skipped_qs = skipped_qs.filter(production_batch_id=job.production_batch_id)
            elif getattr(job, "sales_order_item_id", None):
                skipped_qs = skipped_qs.filter(sales_order_item_id=job.sales_order_item_id)
            elif getattr(job, "mts_order_id", None):
                skipped_qs = skipped_qs.filter(mts_order_id=job.mts_order_id)
            else:
                skipped_qs = skipped_qs.none()
            for skipped in skipped_qs:
                meta = skipped.meta_json if isinstance(skipped.meta_json, dict) else {}
                decision = meta.get("route_step_decision") if isinstance(meta.get("route_step_decision"), dict) else {}
                if str(decision.get("decision") or "").upper() not in {"PLANNED_SKIPPED", "RUNTIME_SKIPPED"}:
                    continue
                released.extend(cls._release_ready_successors(skipped, _visited=_visited))
        return released

    @classmethod
    def release_ready_frontier_jobs(cls, jobs):
        """
        Release every currently-ready route frontier job for the provided order
        or batch scope. Parallel roots are released together; downstream joins
        still wait for RouteGraphService.predecessor_jobs_complete().
        """
        from apps.production.services.batch_route_service import RouteGraphService

        pending = [
            job for job in jobs
            if str(getattr(job, "job_state", "") or "").upper() in {"PLANNED", "WAITING"}
        ]
        ready = [job for job in pending if RouteGraphService.predecessor_jobs_complete(job)]
        wip_continue_ready = [
            job for job in ready
            if "WIP_CONTINUE" in str(getattr(job, "planner_notes", "") or "")
        ]
        candidates = wip_continue_ready or ready
        released = []
        seen = set()
        for job in candidates:
            job_id = str(job.id)
            if job_id in seen:
                continue
            seen.add(job_id)
            job.refresh_from_db(fields=["job_state"])
            if str(getattr(job, "job_state", "") or "").upper() not in {"PLANNED", "WAITING"}:
                continue
            if not RouteGraphService.predecessor_jobs_complete(job):
                continue
            released.append(cls.release_job(job.id))
        return released

    @classmethod
    def runtime_skip_options_for_job(cls, previous_job):
        if str(getattr(previous_job, "job_state", "") or "").upper() != "COMPLETED":
            return []
        from apps.production.services.batch_route_service import RouteGraphService

        options = []
        for next_job in RouteGraphService.ready_successor_jobs(previous_job, states=["WAITING", "PLANNED", "RELEASED"]):
            payload = RouteGraphService.route_payload_for_job(next_job)
            if not payload.get("skippable_after_previous_output"):
                continue
            if not cls._route_skip_replacement_source_ready(next_job, policy=payload, raise_error=False):
                continue
            options.append(
                {
                    "job_id": str(next_job.id),
                    "job_number": next_job.job_number,
                    "process_code": payload.get("process_code") or getattr(next_job.current_process, "code", ""),
                    "process_name": getattr(next_job.current_process, "name", ""),
                    "route_node_id": payload.get("route_node_id") or str(getattr(next_job, "route_node_id", "") or ""),
                    "route_node_label": payload.get("route_node_label") or "",
                    "route_step_policy": payload.get("route_step_policy") or "REQUIRED",
                }
            )
        return options

    @classmethod
    @transaction.atomic
    def skip_route_step(cls, job, *, user=None, reason="", decision_source="PLANNER", previous_job=None):
        from apps.production.services.batch_route_service import BatchExecutionService, RouteGraphService

        source = str(decision_source or "PLANNER").upper()
        if source not in {"PLANNER", "WCM"}:
            raise ValueError("Route skip source must be PLANNER or WCM.")
        if job.job_state not in {"PLANNED", "WAITING", "RELEASED"}:
            raise ValueError("Only planned, waiting, or released route jobs can be skipped.")

        policy = RouteGraphService.route_payload_for_job(job)
        if source == "PLANNER":
            allowed = bool(policy.get("optional_at_planning"))
            error = "This route step is not optional at planning."
            decision = "PLANNED_SKIPPED"
        else:
            allowed = bool(policy.get("skippable_after_previous_output"))
            error = "This route step cannot be skipped after previous output."
            decision = "RUNTIME_SKIPPED"
            if not previous_job or str(getattr(previous_job, "job_state", "") or "").upper() != "COMPLETED":
                raise ValueError("Previous route step must be completed before WCM can skip the next step.")
            ready_ids = {str(option["job_id"]) for option in cls.runtime_skip_options_for_job(previous_job)}
            if str(job.id) not in ready_ids:
                raise ValueError("This step is not ready to skip for the selected previous output.")
        if not allowed:
            raise ValueError(error)
        cls._route_skip_replacement_source_ready(job, policy=policy, raise_error=True)

        now = timezone.now()
        route_node_id = str(policy.get("route_node_id") or getattr(job, "route_node_id", "") or "")
        decision_payload = {
            "decision": decision,
            "source": source,
            "reason": str(reason or "").strip(),
            "route_node_id": route_node_id,
            "route_node_label": policy.get("route_node_label") or "",
            "process_code": getattr(job.current_process, "code", "") or policy.get("process_code") or "",
            "job_id": str(job.id),
            "job_number": job.job_number,
            "previous_job_id": str(getattr(previous_job, "id", "") or ""),
            "decided_at": now.isoformat(),
            "decided_by": cls._route_decision_actor(user),
        }
        cls._record_route_step_decision(job, decision_payload)

        job.status = "COMPLETED"
        job.job_state = "COMPLETED"
        job.end_date = now
        job.closed_at = now
        job.closed_by = user
        job.closed_with_variance = False
        job.completion_variance_kg = Decimal("0")
        job.completion_force_reason = f"{source.title()} skipped route step: {decision_payload['reason'] or 'No reason provided'}"
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
                "meta_json",
                "updated_at",
            ]
        )
        cls._release_active_roll_reservations(job)
        assignment = WorkCenterAssignment.objects.filter(production_job=job).first()
        if assignment:
            assignment.allocated_rolls.clear()
            assignment.delete()

        setattr(job, "_route_step_decision", decision_payload)
        cls._release_ready_successors(job)
        if cls._is_final_route_step(job) and getattr(job, "sales_order_item_id", None):
            cls._update_sales_order_post_final_step(job)
        if getattr(job, "mts_order_id", None):
            cls._update_stock_order_post_terminal_step(job)
        BatchExecutionService.sync_for_job(job)
        return job

    @classmethod
    def _route_skip_replacement_source_ready(cls, job, *, policy=None, raise_error=False):
        """
        A skipped roll-producing step still leaves its downstream layer demand in
        place. Skipping is only valid when that output can be sourced from a
        purchasable film master or compatible existing roll stock.
        """
        process = getattr(job, "current_process", None) or getattr(job, "process", None)
        if not process:
            return True
        behavior = str(getattr(process, "roll_behavior", "") or "").upper()
        output_form = str(getattr(process, "output_form", "") or "").upper()
        if output_form != "ROLL" or behavior != "CREATE_NEW":
            return True

        downstream_jobs = cls._downstream_roll_input_jobs(job, policy=policy)
        if not downstream_jobs:
            return True

        source_spec = cls._skipped_roll_source_spec(job)
        variant_id = str(source_spec.get("variant_id") or "").strip()
        if not variant_id:
            message = (
                f"Cannot skip {getattr(process, 'code', 'route step')}: downstream roll steps still require this output, "
                "but the skipped step has no film variant identity. Configure the Product Master layer or route roll spec first."
            )
            if raise_error:
                raise ValueError(message)
            return False

        if cls._source_spec_has_purchasable_material(source_spec):
            return True

        if cls._source_spec_has_available_roll(job, source_spec):
            return True

        message = (
            f"Cannot skip {getattr(process, 'code', 'route step')}: downstream roll steps still require "
            f"{cls._source_spec_label(source_spec)}, but no purchasable material master or compatible available roll exists. "
            "Skipping a producer step sources the layer from stock; it does not remove the layer from lamination."
        )
        if raise_error:
            raise ValueError(message)
        return False

    @classmethod
    def _downstream_roll_input_jobs(cls, job, *, policy=None):
        from apps.production.services.batch_route_service import RouteGraphService

        if not getattr(job, "routing_rule_id", None):
            return []
        graph = RouteGraphService.normalize(job.routing_rule)
        start_id = str((policy or {}).get("route_node_id") or getattr(job, "route_node_id", "") or "").strip()
        if not start_id:
            return []
        successors = graph.get("successors") or {}
        seen = set()
        queue = list(successors.get(start_id) or [])
        descendant_ids = []
        while queue:
            node_id = str(queue.pop(0) or "").strip()
            if not node_id or node_id in seen:
                continue
            seen.add(node_id)
            descendant_ids.append(node_id)
            queue.extend(successors.get(node_id) or [])
        if not descendant_ids:
            return []

        filters = {
            "routing_rule": job.routing_rule,
            "route_node_id__in": descendant_ids,
            "current_process__input_form": "ROLL",
        }
        if getattr(job, "production_batch_id", None):
            filters["production_batch_id"] = job.production_batch_id
        elif getattr(job, "sales_order_item_id", None):
            filters["sales_order_item_id"] = job.sales_order_item_id
        elif getattr(job, "mts_order_id", None):
            filters["mts_order_id"] = job.mts_order_id
        else:
            return []

        return list(
            ProductionJob.objects.filter(**filters)
            .select_related("current_process", "work_center__plant", "from_location__plant", "to_location__plant")
            .order_by("current_step_index", "created_at")
        )

    @classmethod
    def _skipped_roll_source_spec(cls, job):
        from apps.production.services.services_execution import ExecutionService

        process = getattr(job, "current_process", None) or getattr(job, "process", None)
        step_spec = ExecutionService._resolve_step_roll_spec(job, process) or {}
        layer = ExecutionService._first_layer_snapshot(job) or {}
        geometry = ExecutionService._job_geometry_snapshot(job) or {}
        base_geometry = geometry.get("base") if isinstance(geometry, dict) else None
        if not isinstance(base_geometry, dict):
            base_geometry = geometry if isinstance(geometry, dict) else {}

        def _first_value(*values):
            for value in values:
                if value not in (None, ""):
                    return value
            return None

        source_spec = {
            "variant_id": _first_value(
                step_spec.get("output_variant_id"),
                layer.get("variant_id"),
                layer.get("material_id"),
            ),
            "variant_code": _first_value(
                step_spec.get("output_variant_code"),
                layer.get("variant_code"),
                layer.get("material_code"),
                layer.get("code"),
            ),
            "variant_name": _first_value(
                step_spec.get("output_variant_name"),
                layer.get("variant_name"),
                layer.get("name"),
            ),
            "family_id": layer.get("family_id"),
            "grade_id": _first_value(step_spec.get("output_grade_id"), layer.get("grade_id")),
            "grade_name": _first_value(step_spec.get("output_grade_name"), layer.get("grade_name"), layer.get("grade")),
            "thickness_micron": _first_value(
                step_spec.get("fixed_thickness_micron"),
                layer.get("thickness_micron"),
                layer.get("thickness"),
            ),
            "min_width_mm": _first_value(layer.get("roll_width_mm"), layer.get("width_mm"), base_geometry.get("width_mm")),
            "stock_form": layer.get("stock_form"),
            "width_basis": layer.get("width_basis"),
            "slit_policy": layer.get("slit_policy"),
        }
        return {key: value for key, value in source_spec.items() if value not in (None, "")}

    @classmethod
    def _source_spec_has_purchasable_material(cls, source_spec):
        variant_id = str((source_spec or {}).get("variant_id") or "").strip()
        if not variant_id:
            return False
        from apps.materials.models import InventoryMaterial

        return InventoryMaterial.objects.filter(
            id=variant_id,
            category="FILM_VARIANT",
            is_purchasable=True,
        ).exists()

    @classmethod
    def _source_spec_has_available_roll(cls, job, source_spec):
        variant_id = str((source_spec or {}).get("variant_id") or "").strip()
        if not variant_id:
            return False
        from apps.production.services.services_execution import ExecutionService

        target_spec = {
            "variant_id": variant_id,
            "family_id": source_spec.get("family_id"),
            "grade_id": source_spec.get("grade_id"),
            "thickness_micron": source_spec.get("thickness_micron"),
            "min_width_mm": source_spec.get("min_width_mm"),
            "stock_form": source_spec.get("stock_form"),
            "width_basis": source_spec.get("width_basis"),
            "slit_policy": source_spec.get("slit_policy"),
        }
        target_spec = {key: value for key, value in target_spec.items() if value not in (None, "")}
        qs = (
            InventoryRoll.objects.filter(status__in=["AVAILABLE", "RESERVED"], material_id=variant_id)
            .exclude(location__code="IN_TRANSIT")
            .select_related("material", "location", "grade")
        )
        plant_id = cls._resolve_job_plant_id(job)
        if plant_id:
            qs = qs.filter(location__plant_id=plant_id)
        reserved_by_other = set(
            InventoryReservation.objects.filter(status="ACTIVE", roll__isnull=False)
            .exclude(job=job)
            .exclude(job__job_state__in=["COMPLETED", "CANCELLED"])
            .values_list("roll_id", flat=True)
        )
        for roll in qs[:200]:
            if roll.id in reserved_by_other:
                continue
            if bool((getattr(roll, "meta_json", None) or {}).get("is_quarantined")):
                continue
            if ExecutionService._roll_matches_target_specs(roll, [target_spec], enforce_auto_width_window=False):
                return True
        return False

    @classmethod
    def _source_spec_label(cls, source_spec):
        source_spec = source_spec or {}
        bits = [
            source_spec.get("variant_code") or source_spec.get("variant_name") or source_spec.get("variant_id") or "film",
            source_spec.get("grade_name"),
            f"{source_spec.get('thickness_micron')}u" if source_spec.get("thickness_micron") not in (None, "") else "",
            f"{source_spec.get('min_width_mm')}mm" if source_spec.get("min_width_mm") not in (None, "") else "",
        ]
        return " ".join(str(bit) for bit in bits if bit)

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

        from apps.production.services.batch_route_service import BatchExecutionService

        cls._release_ready_successors(job)

        cls._release_active_roll_reservations(job)
        assignment = WorkCenterAssignment.objects.filter(production_job=job).first()
        if assignment:
            assignment.allocated_rolls.clear()
            assignment.delete()

        if cls._is_final_route_step(job) and getattr(job, "sales_order_item_id", None):
            cls._update_sales_order_post_final_step(job)
        if getattr(job, "mts_order_id", None):
            cls._update_stock_order_post_terminal_step(job)
        BatchExecutionService.sync_for_job(job)
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
            from apps.production.services.batch_route_service import BatchExecutionService
            BatchExecutionService.sync_for_job(job)

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
            consumption_location_id = job.from_location_id or (
                job.work_center.default_wip_location_id if job.work_center else None
            )
            produced_kg = Decimal(str(step_profile.get("step_produced_kg") or 0))
            # WCM issue confirmations are the actual stock event. Persist those first so
            # the auto-ratio close pass never creates a negative return against issued material.
            ExecutionService.reconcile_step_material_actuals(
                job=job,
                material_confirmations=material_confirmations or [],
                consumption_location_id=consumption_location_id,
                user=user,
                strict=require_material_confirmations,
            )
            ExecutionService._reconcile_step_bulk_consumption(
                job=job,
                produced_kg=produced_kg,
                consumption_location_id=consumption_location_id,
                user=user,
                material_confirmations=material_confirmations or [],
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
        work_center_overrides=None,
    ):
        template = so_item.template
        if not template.routing_rule:
            return []
        TemplateDispatchService.backfill_auto_resolvable_template_steps(template, apply=True)
        from apps.production.services.batch_route_service import BatchExecutionService, RouteGraphService

        require_bom_ready_for_production(
            so_item,
            label=f"Sales line {getattr(so_item, 'id', '')}",
        )
        
        # Backward compatible fallback if caller does not specify start.
        if start_index in (None, 0):
            allocated_rolls = so_item.inventory_rolls.all()
            if allocated_rolls.exists():
                # We start from the first step that hasn't been completed by ANY roll
                # Usually if we have multiple rolls, they should be at the same stage.
                # If they differ, we take the minimum (safest).
                start_index = min(max(0, r.current_step_index) for r in allocated_rolls)

        processes = template.routing_rule.ordered_processes
        route_last_index = cls._route_last_index(template.routing_rule)
        if stop_index is None:
            stop_index = route_last_index
        start_index = max(0, int(start_index or 0))
        stop_index = min(route_last_index, int(stop_index))
        if start_index > stop_index:
            return []
        jobs = []
        work_center_overrides = cls._normalize_work_center_overrides(work_center_overrides)

        target_qty = Decimal(str(quantity_override)) if quantity_override is not None else Decimal(str(so_item.qty_value or 0))
        if target_qty <= 0:
            return []
        target_uom = str(quantity_uom_override or so_item.qty_uom or "KG").upper()

        graph_nodes = RouteGraphService.nodes_for_span(template.routing_rule, start_index, stop_index)
        initial_node_ids = RouteGraphService.initial_node_ids(graph_nodes)
        graph_processes = [node["process_code"] for node in RouteGraphService.normalize(template.routing_rule)["nodes"]]
        batches = BatchExecutionService.ensure_batches_for_sales_item(
            so_item,
            quantity=target_qty,
            uom=target_uom,
        )

        for batch in batches:
            batch_qty = Decimal(str(batch.planned_qty or target_qty))
            batch_uom = str(batch.planned_uom or target_uom).upper()
            for node in graph_nodes:
                index = RouteGraphService.step_index_for_node(node)
                process_code = node["process_code"]

                process = Process.objects.get(code=process_code)
                if not cls._route_step_active_for_source(
                    source=so_item,
                    template=template,
                    process=process,
                    processes=graph_processes or processes,
                    index=index,
                ):
                    continue
                wc = cls._resolve_work_center_for_process(
                    process,
                    template=template,
                    step_index=index,
                    strict=True,
                    selected_work_center_id=work_center_overrides.get(index),
                )
                _, from_loc, to_loc = cls._step_locations_for_work_center(
                    work_center=wc,
                    route_index=index,
                    route_last_index=route_last_index,
                )

                base_job_number = f"{so_item.sales_order.order_number}-{so_item.id.hex[:4]}-B{batch.batch_sequence:02d}-{index+1}"
                layer_sig_hash = ""
                try:
                    bs = getattr(so_item, "bom_snapshot", None) or {}
                    if isinstance(bs, dict):
                        layer_sig_hash = str(bs.get("layer_signature_hash") or "")
                except Exception:
                    layer_sig_hash = ""
                meta_json = {
                    "production_batch_number": batch.batch_number,
                    "route_node_label": node.get("label", ""),
                    "route_graph_version": "v3",
                }
                if layer_sig_hash:
                    meta_json["layer_signature_hash"] = layer_sig_hash
                job = ProductionJob.objects.create(
                    job_number=cls._next_unique_job_number(base_job_number),
                    origin='MTO',
                    template=template,
                    sales_order_item=so_item,
                    production_batch=batch,
                    execution_model_version=2,
                    routing_rule=template.routing_rule,
                    current_step_index=index,
                    current_process=process,
                    route_node_id=node["id"],
                    route_branch_key=node.get("branch_key", "MAIN"),
                    route_predecessor_node_ids=node.get("predecessor_node_ids", []),
                    route_successor_node_ids=node.get("successor_node_ids", []),
                    input_form=process.input_form,
                    output_form=process.output_form,
                    work_center=wc,
                    from_location=from_loc,
                    to_location=to_loc,
                    quantity=batch_qty,
                    remaining_qty=batch_qty,
                    uom=batch_uom,
                    status='QUEUED',
                    job_state='PLANNED' if node["id"] in initial_node_ids else 'WAITING',
                    planner_notes=(
                        f"{(planner_note_prefix or '').strip()} | batch:{batch.batch_number} | node:{node['id']}"
                        if planner_note_prefix
                        else f"batch:{batch.batch_number} | node:{node['id']}"
                    ),
                    meta_json=meta_json,
                )

                # Phase 71: Explode BOM into Requirements
                from apps.production.services.services_execution import ExecutionService
                ExecutionService.calculate_requirements(job.id)

                jobs.append(job)
            BatchExecutionService.sync_batch_from_jobs(batch)
        return jobs

    @classmethod
    def create_jobs_for_planned_order(cls, planned_order, start_index=None, stop_index=None, quantity_kg=None, work_center_overrides=None):
        template = planned_order.template
        if not template.routing_rule:
            return []
        TemplateDispatchService.backfill_auto_resolvable_template_steps(template, apply=True)

        processes = template.routing_rule.ordered_processes
        jobs = []

        start_index = (getattr(planned_order, 'start_step_index', 0) if start_index is None else int(start_index))
        if stop_index is None:
            if getattr(planned_order, 'stop_step_index', None) is not None:
                stop_index = planned_order.stop_step_index
            elif getattr(planned_order, 'target_step_index', None) is not None:
                stop_index = planned_order.target_step_index
            else:
                stop_index = cls._route_last_index(planned_order.template.routing_rule)
        stop_index = int(stop_index)

        start_index = max(0, start_index)
        route_last_index = cls._route_last_index(template.routing_rule)
        stop_index = min(route_last_index, stop_index)
        if start_index > stop_index:
            return []
        work_center_overrides = cls._normalize_work_center_overrides(work_center_overrides)

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

        from apps.production.services.batch_route_service import RouteGraphService

        graph_nodes = RouteGraphService.nodes_for_span(template.routing_rule, start_index, stop_index)
        initial_node_ids = RouteGraphService.initial_node_ids(graph_nodes)
        graph_processes = [node["process_code"] for node in RouteGraphService.normalize(template.routing_rule)["nodes"]]

        for node in graph_nodes:
            index = RouteGraphService.step_index_for_node(node)
            process_code = node["process_code"]
            process = Process.objects.get(code=process_code)
            if not cls._route_step_active_for_source(
                source=planned_order,
                template=template,
                process=process,
                processes=graph_processes or processes,
                index=index,
            ):
                continue
            wc = cls._resolve_work_center_for_process(
                process,
                plant=planned_order.plant,
                template=template,
                step_index=index,
                strict=True,
                selected_work_center_id=work_center_overrides.get(index),
            )

            # Resolve Plant: If order has no plant, take from resolved route-dispatch work center.
            plant = planned_order.plant
            if not plant and wc:
                plant = wc.plant
                # Save it back for future reference
                planned_order.plant = plant
                planned_order.save()
            _, from_loc, to_loc = cls._step_locations_for_work_center(
                work_center=wc,
                route_index=index,
                route_last_index=route_last_index,
            )

            base_job_number = f"{planned_order.order_number}-{index+1}"
            stock_meta = {}
            try:
                from apps.production.services.roll_allocation_service import layer_signature_hash
                bs = getattr(planned_order, "bom_snapshot", None) or {}
                layer_sig = ""
                if isinstance(bs, dict):
                    layer_sig = str(bs.get("layer_signature_hash") or "")
                if not layer_sig:
                    layer_sig = layer_signature_hash(getattr(planned_order, "layer_snapshot", None) or [])
                if layer_sig:
                    stock_meta["layer_signature_hash"] = layer_sig
                commitment_scope = str(getattr(planned_order, "commitment_scope", "") or "").upper()
                if commitment_scope == "GENERIC":
                    stock_meta["roll_role"] = "GENERIC_JUMBO"
                    stock_meta["is_generic_stock"] = True
            except Exception:
                pass
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
                job_state='PLANNED' if node["id"] in initial_node_ids else 'WAITING',
                route_node_id=node["id"],
                route_branch_key=node.get("branch_key", "MAIN"),
                route_predecessor_node_ids=node.get("predecessor_node_ids", []),
                route_successor_node_ids=node.get("successor_node_ids", []),
                meta_json=stock_meta,
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
            from apps.production.services.batch_route_service import BatchExecutionService
            BatchExecutionService.sync_for_job(job)
            if getattr(job, "sales_order_item_id", None):
                job.sales_order_item.line_status = "IN_PRODUCTION"
                job.sales_order_item.save(update_fields=["line_status"])
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

        # ── Artwork gate at release ────────────────────────────────────
        # If the linked sales-order item OR stock order requires an artwork
        # (artwork_assignment_required=true) AND no artwork has been assigned
        # yet (assigned_artwork_id is empty), block the release with a clear
        # error. Planner / sales must assign an approved artwork first.
        #
        # When print_capable=true but artwork is OPTIONAL on the master,
        # artwork_assignment_required is false and the release proceeds as
        # a warning-print run (no ink in BOM). This branch only blocks the
        # hard-required case.
        source_obj = getattr(job, "sales_order_item", None) or getattr(job, "mts_order", None)
        if source_obj is not None:
            if getattr(job, "sales_order_item_id", None):
                require_bom_ready_for_production(
                    source_obj,
                    label=f"Sales line {getattr(source_obj, 'id', '')}",
                )
            requires_artwork = bool(getattr(source_obj, "artwork_assignment_required", False))
            assigned_artwork_id = str(getattr(source_obj, "assigned_artwork_id", "") or "").strip()
            if requires_artwork and not assigned_artwork_id:
                label = getattr(source_obj, "order_number", None) or getattr(source_obj, "internal_name", None) or job.job_number
                raise ValueError(
                    f"Cannot release {job.job_number}: master requires an approved artwork "
                    f"and none is assigned on {label}. "
                    f"Assign an artwork in the sales order or planner artwork-picker first."
                )

        with transaction.atomic():
            process = job.current_process or job.process
            if job.template_id:
                TemplateDispatchService.backfill_auto_resolvable_template_steps(job.template, apply=True)
            resolver_step_index = job.current_step_index
            if job.routing_rule_id:
                try:
                    from apps.production.services.batch_route_service import RouteGraphService

                    route_node = RouteGraphService.node_for_job(job)
                    if route_node:
                        resolver_step_index = RouteGraphService.step_index_for_node(route_node)
                except Exception:
                    resolver_step_index = job.current_step_index
            plant = cls._plant_constraint_for_release(job)
            try:
                resolved_wc = cls._resolve_work_center_for_process(
                    process,
                    plant=plant,
                    template=job.template,
                    step_index=resolver_step_index,
                    strict=True,
                    selected_work_center_id=job.work_center_id,
                )
            except RouteDispatchError:
                if not job.work_center_id:
                    raise
                resolved_wc = cls._resolve_work_center_for_process(
                    process,
                    plant=plant,
                    template=job.template,
                    step_index=resolver_step_index,
                    strict=True,
                    selected_work_center_id=None,
                )
            route_last_index = cls._route_last_index(job.routing_rule)
            _, from_loc, to_loc = cls._step_locations_for_work_center(
                work_center=resolved_wc,
                route_index=resolver_step_index,
                route_last_index=route_last_index,
            )
            job.work_center = resolved_wc
            job.from_location = from_loc
            job.to_location = to_loc
            job.job_state = 'RELEASED'
            job.save(update_fields=["work_center", "from_location", "to_location", "job_state", "updated_at"])
            from apps.production.services.batch_route_service import BatchExecutionService
            BatchExecutionService.sync_for_job(job)
            if getattr(job, "sales_order_item_id", None):
                job.sales_order_item.line_status = "RELEASED"
                job.sales_order_item.save(update_fields=["line_status"])
                try:
                    from apps.sales.services.order_service import SalesOrderService

                    SalesOrderService.sync_order_status_from_lines(job.sales_order_item.sales_order)
                except Exception:
                    logger.warning(
                        "release_job: could not sync parent order status for job %s",
                        job.job_number,
                        exc_info=True,
                    )
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
            resolved_wc = JobService._resolve_work_center_for_process(
                job.current_process or job.process,
                plant=JobService._plant_constraint_for_release(job),
                template=job.template,
                step_index=job.current_step_index,
                strict=True,
                selected_work_center_id=job.work_center_id,
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
        if not created and assignment.work_center_id != job.work_center_id:
            assignment.work_center = job.work_center
            assignment.save(update_fields=["work_center", "updated_at"])
        
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
    def _running_job_for_machine(cls, machine_id, *, exclude_job_id=None):
        if not machine_id:
            return None
        qs = (
            ProductionJob.objects.filter(machine_id=machine_id)
            .filter(Q(job_state="EXECUTING") | Q(status="RUNNING"))
            .exclude(job_state__in=["COMPLETED", "CANCELLED"])
            .exclude(status__in=["COMPLETED", "CANCELLED"])
            .order_by("-updated_at")
        )
        if exclude_job_id:
            qs = qs.exclude(id=exclude_job_id)
        return qs.first()

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

            # Validate the chosen machine belongs to this assignment's work center.
            assignment_wc_id = getattr(assignment, "work_center_id", None)
            machine_wc_id = getattr(machine, "work_center_id", None)
            if assignment_wc_id and machine_wc_id and machine_wc_id != assignment_wc_id:
                wc_label = getattr(getattr(assignment, "work_center", None), "name", assignment_wc_id)
                raise ValueError(
                    f"Machine {machine.name} does not belong to work center {wc_label}."
                )

            assignment.assigned_machine = machine

            # Optional: Assign Rolls in the same step
            if roll_ids:
                from apps.inventory.models import InventoryRoll
                from apps.inventory.models import InventoryReservation
                from apps.production.services.services_execution import ExecutionService
                # NOTE: Q is imported at module scope; a local re-import here would
                # shadow it across the whole function and break the busy-check above.

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
                    defer_slot_validation=True,
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
