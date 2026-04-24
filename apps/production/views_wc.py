from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.db.models import Q, Sum
from .models import (
    WorkCenterAssignment,
    ProductionJob,
    ProductionWcmAuditEvent,
    JobExecutionLog,
    ScrapLog,
    DowntimeLog,
    MaterialConsumptionLog,
    JobMaterialRequirement,
)
from .serializers import WorkCenterAssignmentSerializer, ProductionJobSerializer
from .services.job_services import WCManagerService
from .services.roll_allocation_service import RollAllocationService
from .services.services_execution import ExecutionService
from apps.inventory.serializers import InventoryRollSerializer
from apps.inventory.models import InventoryBulk


def _actor_label(user):
    if not user or not getattr(user, "is_authenticated", False):
        return "system"
    return (
        getattr(user, "get_full_name", lambda: "")()
        or getattr(user, "username", "")
        or getattr(user, "email", "")
        or "user"
    )


def _audit_payload_event(event):
    actor = getattr(event, "actor", None)
    return {
        "id": str(event.id),
        "action": event.action,
        "actor": _actor_label(actor),
        "actor_id": str(actor.id) if actor else None,
        "reason": event.reason or "",
        "before_status": event.before_status or "",
        "after_status": event.after_status or "",
        "machine": event.machine.name if getattr(event, "machine", None) else "",
        "machine_id": str(event.machine_id) if event.machine_id else None,
        "payload": event.payload or {},
        "occurred_at": event.occurred_at,
    }


def _write_wcm_audit(assignment, action, user=None, before_status="", reason="", payload=None, machine=None):
    job = assignment.production_job
    return ProductionWcmAuditEvent.objects.create(
        production_job=job,
        work_center=assignment.work_center,
        assignment=assignment,
        machine=machine or assignment.assigned_machine or job.machine,
        action=action,
        actor=user if getattr(user, "is_authenticated", False) else None,
        reason=reason or "",
        before_status=before_status or "",
        after_status=assignment.status or "",
        payload=payload or {},
    )


def _decimal(value, field_name):
    try:
        parsed = Decimal(str(value or 0)).quantize(Decimal("0.0001"))
    except Exception as exc:
        raise ValueError(f"{field_name} must be a valid number.") from exc
    if parsed < 0:
        raise ValueError(f"{field_name} must be zero or positive.")
    return parsed


def _validate_wcm_material_confirmations(job, material_confirmations):
    confirmations = material_confirmations or []
    if not isinstance(confirmations, list):
        raise ValueError("material_confirmations must be a list.")
    if not confirmations:
        return

    step_seq = int(job.current_step_index or 0) + 1
    reqs = (
        JobMaterialRequirement.objects
        .select_related("material", "process_step")
        .filter(production_job=job, process_step__sequence_number=step_seq)
    )
    req_by_id = {str(req.id): req for req in reqs}
    if not req_by_id:
        raise ValueError("No current-step material requirements were found for this job.")

    source_location_id = job.from_location_id or (job.work_center.default_wip_location_id if job.work_center else None)
    source_plant_id = job.work_center.plant_id if job.work_center else None

    for row in confirmations:
        if not isinstance(row, dict):
            raise ValueError("Each material confirmation must be an object.")
        requirement_id = str(row.get("requirement_id") or "").strip()
        req = req_by_id.get(requirement_id)
        if not req:
            raise ValueError("Material confirmation is not for the current step.")
        material_id = str(row.get("material_id") or req.material_id)
        if material_id != str(req.material_id):
            raise ValueError(f"Material confirmation does not match {req.material.name}.")

        issued = _decimal(row.get("actual_issued_qty"), f"{req.material.name} issued kg")
        returned = _decimal(row.get("actual_returned_qty"), f"{req.material.name} returned kg")
        scrap = _decimal(row.get("actual_scrap_qty"), f"{req.material.name} scrap kg")
        if returned > 0 or scrap > 0:
            raise ValueError(f"WCM can only release issued kg for {req.material.name}; return and scrap are logged on machine output.")

        raw_allocations = row.get("granule_code_allocations") or row.get("code_allocations") or []
        if raw_allocations and not isinstance(raw_allocations, list):
            raise ValueError(f"Code allocations for {req.material.name} must be a list.")

        category = str(getattr(req.material, "category", "") or "").upper()
        if category != "GRANULE":
            if raw_allocations:
                raise ValueError(f"Code split is only allowed for granule rows, not {req.material.name}.")
            continue

        stock_qs = InventoryBulk.objects.filter(material=req.material, granule_code__isnull=False, qty_kg__gt=0)
        if source_location_id:
            stock_qs = stock_qs.filter(location_id=source_location_id)
        elif source_plant_id:
            stock_qs = stock_qs.filter(plant_id=source_plant_id)
        available_by_code = {
            str(row["granule_code_id"]): Decimal(str(row["available"] or 0)).quantize(Decimal("0.0001"))
            for row in stock_qs.values("granule_code_id").annotate(available=Sum("qty_kg"))
        }
        if issued > 0 and not available_by_code:
            raise ValueError(f"No coded stock is available for {req.material.name}.")
        if issued > 0 and available_by_code and not raw_allocations:
            raise ValueError(f"Select at least one code for {req.material.name}.")

        allocated_by_code = defaultdict(lambda: Decimal("0"))
        for allocation in raw_allocations:
            code_id = str(allocation.get("granule_code_id") or allocation.get("id") or "").strip()
            qty = _decimal(allocation.get("qty_kg") or allocation.get("quantity"), f"{req.material.name} code qty")
            if not code_id or qty <= 0:
                continue
            if code_id not in available_by_code:
                raise ValueError(f"Selected code is not available for {req.material.name}.")
            allocated_by_code[code_id] += qty

        allocated_total = sum(allocated_by_code.values(), Decimal("0")).quantize(Decimal("0.0001"))
        if allocated_total != issued:
            raise ValueError(f"Code split for {req.material.name} must total {issued} kg, got {allocated_total} kg.")
        for code_id, qty in allocated_by_code.items():
            if qty > available_by_code[code_id]:
                raise ValueError(f"Code allocation for {req.material.name} exceeds available coded stock.")

class WCQueueViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Get WC queue: job info, template name, SO, customer, qty, specs snapshot, assignment status.
    """
    serializer_class = WorkCenterAssignmentSerializer

    def get_queryset(self):
        wc_id = self.kwargs.get('wc_id')
        return (
            WorkCenterAssignment.objects.filter(
                work_center_id=wc_id,
                status__in=['WC_READY', 'ASSIGNED', 'EXECUTION_READY']
            ).exclude(
                production_job__job_state__in=['COMPLETED', 'CANCELLED', 'EXECUTING']
            ).exclude(
                production_job__status__in=['COMPLETED', 'CANCELLED', 'RUNNING']
            ).order_by('created_at')
        )

    @action(detail=False, methods=['get'], url_path='queue')
    def queue(self, request, wc_id=None):
        import logging
        logger = logging.getLogger(__name__)
        
        queryset = self.get_queryset().select_related(
            'production_job',
            'production_job__current_process',
            'production_job__process',
            'assigned_machine',
        ).prefetch_related('allocated_rolls')

        # Reconcile stale assignment states on every queue read so UI never shows
        # "ASSIGNED" when the underlying machine/roll conditions are no longer true.
        for assignment in queryset:
            previous = assignment.status
            WCManagerService._sync_assignment_status(assignment)
            if assignment.status != previous:
                assignment.save(update_fields=['status'])

        serializer = self.get_serializer(queryset, many=True)
        payload = []
        for row in serializer.data:
            job_details = row.get("job_details") or {}
            job_state = str(job_details.get("job_state") or "").upper()
            job_status = str(job_details.get("status") or "").upper()
            if job_state in {"COMPLETED", "CANCELLED"} or job_status in {"COMPLETED", "CANCELLED"}:
                continue
            payload.append(row)
        for row in payload:
            job_details = row.get("job_details") or {}
            job_id = job_details.get("id")
            if not job_id:
                continue
            try:
                profile = ExecutionService.get_step_execution_profile(str(job_id))
                logger.debug(f"[DEBUG] Job {job_id} step profile: {profile}")
            except Exception as e:
                logger.debug(f"[DEBUG] Job {job_id} step profile error: {e}")
                profile = {}
            try:
                order_reference_target_kg = float(ExecutionService.get_order_reference_target_kg(str(job_id)))
            except Exception as e:
                logger.debug(f"[DEBUG] Job {job_id} order reference error: {e}")
                order_reference_target_kg = 0.0
            step_target_kg = float(profile.get("step_target_total_kg") or 0)
            step_target_pcs = profile.get("step_target_pcs")
            step_target_primary = profile.get("step_target_primary")
            step_produced_primary = profile.get("step_produced_primary")
            step_remaining_primary = profile.get("step_remaining_primary")
            primary_uom = profile.get("primary_uom") or "KG"
            step_target_source = str(profile.get("target_source") or "V2_STEP_PROFILE")
            raw_total_kg = float(job_details.get("total_weight_kg") or 0)
            job_details["execution_model_version"] = 2
            normalized_order_reference = order_reference_target_kg if order_reference_target_kg > 0 else max(raw_total_kg, 0.0)
            job_details["order_target_source"] = "V2_ORDER_REFERENCE"
            job_details["step_adjusted_total_kg"] = step_target_kg if step_target_kg > 0 else 0.0
            job_details["step_target_kg"] = step_target_kg
            job_details["step_target_pcs"] = step_target_pcs
            job_details["primary_uom"] = primary_uom
            job_details["step_target_primary"] = step_target_primary
            job_details["step_produced_primary"] = step_produced_primary
            job_details["step_remaining_primary"] = step_remaining_primary
            job_details["step_target_source"] = step_target_source
            job_details["order_reference_target_kg"] = normalized_order_reference
            row["execution_model_version"] = 2
            row["step_target_source"] = step_target_source
            row["order_target_source"] = "V2_ORDER_REFERENCE"
            
            # Log job requirements details
            logger.debug(f"[DEBUG] Job {job_id} step_target_kg={step_target_kg}, order_ref={order_reference_target_kg}, raw_total={raw_total_kg}")
        return Response(payload)

    @action(detail=False, methods=['get'], url_path='history')
    def history(self, request, wc_id=None):
        """
        Fetch searchable WCM history for this work center.
        Defaults to the last 30 days, but search/status filters can inspect older records.
        """
        search = str(request.query_params.get("q") or request.query_params.get("search") or "").strip()
        status_filter = str(request.query_params.get("status") or "ALL").strip().upper()
        try:
            limit = int(request.query_params.get("limit") or 100)
        except Exception:
            limit = 100
        limit = max(1, min(limit, 300))
        days_raw = request.query_params.get("days")
        if days_raw is None or str(days_raw).strip() == "":
            days = None if search or status_filter != "ALL" else 30
        else:
            try:
                days = int(days_raw)
            except Exception:
                days = 30
            if days <= 0:
                days = None

        queryset = (
            ProductionJob.objects.filter(work_center_id=wc_id)
            .filter(
                Q(job_state__in=['RELEASED', 'EXECUTING', 'PAUSED', 'COMPLETED', 'CANCELLED']) |
                Q(status__in=['ASSIGNED', 'RUNNING', 'COMPLETED', 'CANCELLED']) |
                Q(assignment__status='EXECUTION_READY') |
                Q(wcm_audit_events__isnull=False)
            )
            .distinct()
            .select_related(
                'current_process',
                'process',
                'template',
                'sales_order_item__sales_order',
                'machine',
                'operator',
                'closed_by',
                'assignment',
                'assignment__assigned_machine',
            )
        )

        if days:
            since = timezone.now() - timedelta(days=days)
            queryset = queryset.filter(Q(updated_at__gte=since) | Q(wcm_audit_events__occurred_at__gte=since)).distinct()

        if status_filter != "ALL":
            queryset = queryset.filter(
                Q(job_state=status_filter) |
                Q(status=status_filter) |
                Q(wcm_audit_events__action=status_filter)
            ).distinct()

        if search:
            queryset = queryset.filter(
                Q(job_number__icontains=search) |
                Q(template__name__icontains=search) |
                Q(sales_order_item__sales_order__order_number__icontains=search) |
                Q(sales_order_item__sales_order__customer_name__icontains=search) |
                Q(machine__name__icontains=search) |
                Q(wcm_audit_events__reason__icontains=search) |
                Q(wcm_audit_events__action__icontains=search) |
                Q(wcm_audit_events__actor__username__icontains=search) |
                Q(wcm_audit_events__payload__icontains=search)
            ).distinct()

        queryset = list(queryset.order_by('-updated_at')[:limit])

        from apps.production.serializers import ProductionJobSerializer

        jobs_data = ProductionJobSerializer(queryset, many=True).data
        jobs_by_id = {str(j["id"]): j for j in jobs_data}
        job_ids = [job.id for job in queryset]

        output_by_job = defaultdict(lambda: Decimal("0"))
        for row in JobExecutionLog.objects.filter(production_job_id__in=job_ids).values("production_job_id", "uom").annotate(total=Sum("quantity")):
            output_by_job[row["production_job_id"]] += Decimal(str(row.get("total") or 0))

        scrap_by_job = defaultdict(lambda: Decimal("0"))
        for row in ScrapLog.objects.filter(production_job_id__in=job_ids).values("production_job_id", "uom").annotate(total=Sum("quantity")):
            scrap_by_job[row["production_job_id"]] += Decimal(str(row.get("total") or 0))

        material_by_job = defaultdict(list)
        material_rows = (
            MaterialConsumptionLog.objects
            .filter(production_job_id__in=job_ids)
            .select_related("material", "granule_code", "roll")
            .order_by("-logged_at")[:1000]
        )
        for row in material_rows:
            material_by_job[row.production_job_id].append({
                "material": row.material.name if row.material else "",
                "material_code": row.material.code if row.material else "",
                "granule_code": row.granule_code.code if row.granule_code else "",
                "roll": row.roll.label_id if row.roll else "",
                "quantity": float(row.quantity or 0),
                "uom": row.uom,
                "is_estimated": row.is_estimated,
                "logged_at": row.logged_at,
            })

        downtime_by_job = defaultdict(list)
        for row in DowntimeLog.objects.filter(production_job_id__in=job_ids).select_related("logged_by").order_by("-created_at")[:500]:
            downtime_by_job[row.production_job_id].append({
                "reason": row.reason,
                "notes": row.notes,
                "duration_minutes": row.duration_minutes,
                "logged_by": _actor_label(row.logged_by),
                "created_at": row.created_at,
            })

        events_by_job = defaultdict(list)
        events = (
            ProductionWcmAuditEvent.objects
            .filter(production_job_id__in=job_ids)
            .select_related("actor", "machine")
            .order_by("-occurred_at")
        )
        for event in events:
            events_by_job[event.production_job_id].append(_audit_payload_event(event))

        payload = []
        for job_obj in queryset:
            job_dict = jobs_by_id.get(str(job_obj.id), {})
            assignment = getattr(job_obj, 'assignment', None)
            machine = getattr(job_obj, "machine", None) or getattr(assignment, "assigned_machine", None)

            payload.append({
                "id": str(assignment.id) if assignment else str(job_obj.id),
                "production_job": str(job_obj.id),
                "work_center": str(wc_id),
                "status": assignment.status if assignment else ("EXECUTION_READY" if job_obj.job_state in {"RELEASED", "EXECUTING", "PAUSED"} else job_obj.job_state),
                "assigned_machine": str(machine.id) if machine else None,
                "assigned_machine_name": machine.name if machine else "",
                "job_details": job_dict,
                "updated_at": assignment.updated_at if assignment else job_obj.updated_at,
                "audit_events": events_by_job.get(job_obj.id, []),
                "history_summary": {
                    "output_qty": float(output_by_job[job_obj.id]),
                    "scrap_qty": float(scrap_by_job[job_obj.id]),
                    "material_rows": material_by_job.get(job_obj.id, []),
                    "downtime_rows": downtime_by_job.get(job_obj.id, []),
                    "closed_by": _actor_label(job_obj.closed_by) if job_obj.closed_by_id else "",
                    "closed_at": job_obj.closed_at,
                    "force_reason": job_obj.completion_force_reason or "",
                },
            })

        return Response(payload)

    @action(detail=False, methods=['get'], url_path='stats')
    def stats(self, request, wc_id=None):
        """
        Get quick stats for the work center terminal.
        """
        base_qs = WorkCenterAssignment.objects.filter(work_center_id=wc_id)
        
        waiting_count = base_qs.filter(
            status__in=['WC_READY', 'ASSIGNED']
        ).exclude(
            production_job__job_state__in=['COMPLETED', 'CANCELLED', 'EXECUTING']
        ).count()
        
        running_count = base_qs.filter(
            status='EXECUTION_READY'
        ).exclude(
            production_job__job_state__in=['COMPLETED', 'CANCELLED']
        ).count()
        
        # Add actual executing jobs if any
        executing_count = base_qs.filter(
            production_job__job_state='EXECUTING'
        ).count()

        return Response({
            'waiting': waiting_count,
            'running': running_count + executing_count,
            'total_active': waiting_count + running_count + executing_count
        })

class JobAllocationViewSet(viewsets.ViewSet):
    """
    Endpoints for machine assignment, roll allocation, and marking execution ready.
    """
    
    @action(detail=True, methods=['get'], url_path='eligible-rolls')
    def eligible_rolls(self, request, pk=None):
        import logging
        logger = logging.getLogger(__name__)
        job = ProductionJob.objects.get(id=pk)
        
        # DEBUG: Log job details
        logger.debug(f"[DEBUG] Getting eligible rolls for job {pk}")
        logger.debug(f"[DEBUG] Job template: {job.template_id}, SOI: {job.sales_order_item_id}, STOCK: {getattr(job, 'mts_order_id', None)}")
        logger.debug(f"[DEBUG] Job current_step_index: {job.current_step_index}")
        
        from apps.production.services.services_execution import ExecutionService
        from apps.production.services.roll_allocation_service import RollAllocationService
        
        process = job.current_process or job.process
        lineage_filter = ExecutionService._resolve_job_lineage_filter(job)
        target_specs = ExecutionService._build_step_target_specs(job, process)
        
        logger.debug(f"[DEBUG] Lineage filter: {lineage_filter}")
        logger.debug(f"[DEBUG] Target specs count: {len(target_specs)}")
        for i, spec in enumerate(target_specs):
            logger.debug(f"[DEBUG] Target spec {i}: {spec}")
        
        # Get layer snapshot for BOM info
        layer_snapshot = None
        if job.sales_order_item and getattr(job.sales_order_item, 'layer_snapshot', None):
            layer_snapshot = job.sales_order_item.layer_snapshot
        elif getattr(job, "mts_order", None) and getattr(job.mts_order, "layer_snapshot", None):
            layer_snapshot = job.mts_order.layer_snapshot
        logger.debug(f"[DEBUG] Layer snapshot: {layer_snapshot}")
        
        # Check BOM snapshot for films
        bom_snapshot = (
            (job.sales_order_item.bom_snapshot if getattr(job, 'sales_order_item', None) else None)
            or (job.mts_order.bom_snapshot if getattr(job, 'mts_order', None) else None)
            or {}
        )
        films = bom_snapshot.get('films', []) if isinstance(bom_snapshot, dict) else []
        logger.debug(f"[DEBUG] BOM films count: {len(films)}")
        for i, film in enumerate(films[:5]):
            logger.debug(f"[DEBUG] BOM film {i}: {film}")
        
        rolls = RollAllocationService.get_eligible_rolls(
            job,
            include_non_lineage_fallback=ExecutionService._allow_non_lineage_roll_discovery(
                job,
                job.current_process or job.process,
            ),
            include_remainder=True,
        )
        logger.debug(f"[DEBUG] Eligible rolls count (with remainder): {rolls.count()}")
        
        serializer = InventoryRollSerializer(rolls, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['post'], url_path='assign-machine')
    def assign_machine(self, request):
        assignment_id = request.data.get('assignment_id')
        machine_id = request.data.get('machine_id')
        roll_ids = request.data.get('roll_ids')
        manual_override = bool(request.data.get('manual_override', False))
        override_reason = request.data.get('override_reason')
        if not assignment_id or not machine_id:
            return Response({"error": "assignment_id and machine_id are required"}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            before = WorkCenterAssignment.objects.select_related("production_job", "work_center", "assigned_machine").get(id=assignment_id)
            before_status = before.status
            before_machine = before.assigned_machine.name if before.assigned_machine else ""
            assignment = WCManagerService.assign_machine(
                assignment_id, 
                machine_id, 
                roll_ids=roll_ids,
                user=request.user,
                manual_override=manual_override,
                override_reason=override_reason,
            )
            _write_wcm_audit(
                assignment,
                "ASSIGN_MACHINE",
                user=request.user,
                before_status=before_status,
                reason=override_reason or "",
                payload={
                    "before_machine": before_machine,
                    "after_machine": assignment.assigned_machine.name if assignment.assigned_machine else "",
                    "roll_ids": roll_ids or [],
                    "manual_override": manual_override,
                },
            )
            serializer = WorkCenterAssignmentSerializer(assignment)
            return Response(serializer.data)
        except WorkCenterAssignment.DoesNotExist:
            return Response({"error": "Assignment not found."}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'], url_path='allocate-rolls')
    def allocate_rolls(self, request):
        assignment_id = request.data.get('assignment_id')
        roll_ids = request.data.get('roll_ids', [])
        manual_override = bool(request.data.get('manual_override', False))
        override_reason = request.data.get('override_reason')
        if not assignment_id:
            return Response({"error": "assignment_id is required"}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            before = WorkCenterAssignment.objects.select_related("production_job", "work_center", "assigned_machine").get(id=assignment_id)
            before_status = before.status
            assignment = WCManagerService.assign_rolls(
                assignment_id,
                roll_ids,
                user=request.user,
                manual_override=manual_override,
                override_reason=override_reason,
            )
            _write_wcm_audit(
                assignment,
                "ALLOCATE_ROLLS",
                user=request.user,
                before_status=before_status,
                reason=override_reason or "",
                payload={
                    "roll_ids": roll_ids or [],
                    "allocated_roll_count": assignment.allocated_rolls.count(),
                    "manual_override": manual_override,
                },
            )
            serializer = WorkCenterAssignmentSerializer(assignment)
            return Response(serializer.data)
        except WorkCenterAssignment.DoesNotExist:
            return Response({"error": "Assignment not found."}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'], url_path='unassign-roll')
    def unassign_roll(self, request):
        assignment_id = request.data.get('assignment_id')
        reservation_id = request.data.get('reservation_id')
        if not assignment_id or not reservation_id:
            return Response({"error": "assignment_id and reservation_id are required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            before = WorkCenterAssignment.objects.select_related("production_job", "work_center", "assigned_machine").get(id=assignment_id)
            before_status = before.status
            assignment = WCManagerService.unassign_roll(assignment_id, reservation_id, user=request.user)
            _write_wcm_audit(
                assignment,
                "UNASSIGN_ROLL",
                user=request.user,
                before_status=before_status,
                payload={"reservation_id": str(reservation_id), "allocated_roll_count": assignment.allocated_rolls.count()},
            )
            serializer = WorkCenterAssignmentSerializer(assignment)
            return Response(serializer.data)
        except WorkCenterAssignment.DoesNotExist:
            return Response({"error": "Assignment not found."}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'], url_path='unassign-roll-by-roll')
    def unassign_roll_by_roll(self, request):
        assignment_id = request.data.get('assignment_id')
        roll_id = request.data.get('roll_id')
        if not assignment_id or not roll_id:
            return Response({"error": "assignment_id and roll_id are required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            before = WorkCenterAssignment.objects.select_related("production_job", "work_center", "assigned_machine").get(id=assignment_id)
            before_status = before.status
            assignment = WCManagerService.unassign_roll_by_roll(assignment_id, roll_id, user=request.user)
            _write_wcm_audit(
                assignment,
                "UNASSIGN_ROLL",
                user=request.user,
                before_status=before_status,
                payload={"roll_id": str(roll_id), "allocated_roll_count": assignment.allocated_rolls.count()},
            )
            serializer = WorkCenterAssignmentSerializer(assignment)
            return Response(serializer.data)
        except WorkCenterAssignment.DoesNotExist:
            return Response({"error": "Assignment not found."}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'], url_path='ready')
    def mark_ready(self, request):
        assignment_id = request.data.get('assignment_id')
        if not assignment_id:
            return Response({"error": "assignment_id is required"}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            material_confirmations = request.data.get("material_confirmations")
            before = WorkCenterAssignment.objects.select_related("production_job", "work_center", "assigned_machine").get(id=assignment_id)
            _validate_wcm_material_confirmations(before.production_job, material_confirmations)
            assignment = WCManagerService.mark_execution_ready(
                assignment_id,
                material_confirmations=material_confirmations,
            )
            if material_confirmations:
                _write_wcm_audit(
                    assignment,
                    "MATERIAL_ISSUE",
                    user=request.user,
                    before_status=before.status,
                    payload={"material_confirmations": material_confirmations},
                )
            _write_wcm_audit(
                assignment,
                "RELEASE_TO_MACHINE",
                user=request.user,
                before_status=before.status,
                payload={
                    "machine": assignment.assigned_machine.name if assignment.assigned_machine else "",
                    "material_confirmation_count": len(material_confirmations or []),
                },
            )
            serializer = WorkCenterAssignmentSerializer(assignment)
            return Response(serializer.data)
        except WorkCenterAssignment.DoesNotExist:
            return Response({"error": "Assignment not found."}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'], url_path='close-job')
    def close_job(self, request):
        assignment_id = request.data.get('assignment_id')
        mode = str(request.data.get('mode') or '').upper()
        reason = str(request.data.get('reason') or '').strip()
        if not assignment_id:
            return Response({"error": "assignment_id is required"}, status=status.HTTP_400_BAD_REQUEST)
        if mode not in {'SHORT_CLOSE', 'CANCEL'}:
            return Response({"error": "mode must be SHORT_CLOSE or CANCEL"}, status=status.HTTP_400_BAD_REQUEST)
        if len(reason) < 5:
            return Response({"error": "Reason must be at least 5 characters."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            assignment = WorkCenterAssignment.objects.select_related('production_job').get(id=assignment_id)
            job = assignment.production_job
            before_status = assignment.status
            now = timezone.now()
            action_label = 'Short closed by WCM' if mode == 'SHORT_CLOSE' else 'Cancelled by WCM'
            job.closed_at = now
            job.closed_by = request.user if getattr(request, 'user', None) and request.user.is_authenticated else None
            job.closed_with_variance = True
            job.completion_force_reason = f"{action_label}: {reason}"
            if mode == 'SHORT_CLOSE':
                job.status = 'COMPLETED'
                job.job_state = 'COMPLETED'
            else:
                job.status = 'CANCELLED'
                job.job_state = 'CANCELLED'
            job.save(update_fields=[
                'status',
                'job_state',
                'closed_at',
                'closed_by',
                'closed_with_variance',
                'completion_force_reason',
                'updated_at',
            ])
            assignment.updated_at = now
            assignment.save(update_fields=['updated_at'])
            _write_wcm_audit(
                assignment,
                mode,
                user=request.user,
                before_status=before_status,
                reason=reason,
                payload={
                    "job_state": job.job_state,
                    "job_status": job.status,
                    "closed_at": now.isoformat(),
                },
            )
            serializer = WorkCenterAssignmentSerializer(assignment)
            return Response(serializer.data)
        except WorkCenterAssignment.DoesNotExist:
            return Response({"error": "Assignment not found."}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
