from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from .models import WorkCenterAssignment, ProductionJob
from .serializers import WorkCenterAssignmentSerializer, ProductionJobSerializer
from .services.job_services import WCManagerService
from .services.roll_allocation_service import RollAllocationService
from .services.services_execution import ExecutionService
from apps.inventory.serializers import InventoryRollSerializer

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
        Fetch historical jobs for this work center (Executing, Completed, Cancelled).
        Since WorkCenterAssignment records are deleted upon step completion, 
        we query ProductionJob directly and wrap them to match the expected UI schema.
        """
        import logging
        logger = logging.getLogger(__name__)

        from django.db.models import Q
        # Fetch jobs sent to machine (EXECUTING) or already done
        queryset = ProductionJob.objects.filter(
            Q(work_center_id=wc_id) & 
            (
                Q(job_state__in=['EXECUTING', 'COMPLETED', 'CANCELLED']) |
                Q(status__in=['RUNNING', 'COMPLETED', 'CANCELLED']) |
                Q(assignment__status='EXECUTION_READY')
            )
        ).select_related(
            'current_process',
            'process',
            'template',
            'sales_order_item__sales_order',
            'machine',
            'assignment'
        ).order_by('-updated_at')[:50]

        from apps.production.serializers import ProductionJobSerializer
        
        # Serialize the jobs
        jobs_data = ProductionJobSerializer(queryset, many=True).data
        jobs_by_id = {str(j["id"]): j for j in jobs_data}

        payload = []
        for job_obj in queryset:
            job_dict = jobs_by_id.get(str(job_obj.id), {})
            assignment = getattr(job_obj, 'assignment', None)
            
            # Manually construct the shape expected by the UI (WorkCenterAssignmentSerializer output)
            # The UI needs: id, status, job_details, assigned_machine_name, updated_at
            # If an assignment exists, use its ID. Otherwise use job ID to prevent React key collision.
            
            payload.append({
                "id": str(assignment.id) if assignment else str(job_obj.id),
                "production_job": str(job_obj.id),
                "work_center": str(wc_id),
                "status": assignment.status if assignment else ("EXECUTION_READY" if job_obj.job_state == "EXECUTING" else "COMPLETED"),
                "assigned_machine": str(job_obj.machine_id) if job_obj.machine_id else None,
                "assigned_machine_name": job_obj.machine.name if getattr(job_obj, 'machine', None) else "Machine Assigned",
                "job_details": job_dict,
                "updated_at": assignment.updated_at if assignment else job_obj.updated_at
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
            assignment = WCManagerService.assign_machine(
                assignment_id, 
                machine_id, 
                roll_ids=roll_ids,
                user=request.user,
                manual_override=manual_override,
                override_reason=override_reason,
            )
            serializer = WorkCenterAssignmentSerializer(assignment)
            return Response(serializer.data)
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
            assignment = WCManagerService.assign_rolls(
                assignment_id,
                roll_ids,
                user=request.user,
                manual_override=manual_override,
                override_reason=override_reason,
            )
            serializer = WorkCenterAssignmentSerializer(assignment)
            return Response(serializer.data)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'], url_path='unassign-roll')
    def unassign_roll(self, request):
        assignment_id = request.data.get('assignment_id')
        reservation_id = request.data.get('reservation_id')
        if not assignment_id or not reservation_id:
            return Response({"error": "assignment_id and reservation_id are required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            assignment = WCManagerService.unassign_roll(assignment_id, reservation_id, user=request.user)
            serializer = WorkCenterAssignmentSerializer(assignment)
            return Response(serializer.data)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'], url_path='unassign-roll-by-roll')
    def unassign_roll_by_roll(self, request):
        assignment_id = request.data.get('assignment_id')
        roll_id = request.data.get('roll_id')
        if not assignment_id or not roll_id:
            return Response({"error": "assignment_id and roll_id are required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            assignment = WCManagerService.unassign_roll_by_roll(assignment_id, roll_id, user=request.user)
            serializer = WorkCenterAssignmentSerializer(assignment)
            return Response(serializer.data)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'], url_path='ready')
    def mark_ready(self, request):
        assignment_id = request.data.get('assignment_id')
        if not assignment_id:
            return Response({"error": "assignment_id is required"}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            material_confirmations = request.data.get("material_confirmations")
            assignment = WCManagerService.mark_execution_ready(
                assignment_id,
                material_confirmations=material_confirmations,
            )
            serializer = WorkCenterAssignmentSerializer(assignment)
            return Response(serializer.data)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
