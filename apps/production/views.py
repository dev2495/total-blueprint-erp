import re

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.core.exceptions import ValidationError
from django.db import transaction
from django.http import FileResponse
from django.db import connection
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from .models import ProductionBatch, ProductionJob, ProductionWcmAuditEvent, WorkCenterAssignment
from .serializers import (
    ProductionJobSerializer, JobAssignmentSerializer, JobCompletionSerializer,
    WorkCenterAssignmentSerializer, PlannedStockOrderSerializer, PlannedBulkStockOrderSerializer,
    PlannerSkuSerializer, PlannerSkuVariantSerializer, ProductionBatchSerializer,
)
from .models import PlannedStockOrder, PlannedBulkStockOrder, PlannerSku, PlannerSkuVariant
from .services import JobService, WCManagerService, OperatorService
from .services.services_execution import ExecutionService
from apps.factory.models import Machine


def _safe_sales_order_number(so_id):
    if not so_id:
        return "N/A"
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT order_number FROM sales_orders WHERE id = %s::uuid", [str(so_id)])
            row = cursor.fetchone()
            return row[0] if row and row[0] else "N/A"
    except Exception:
        return "N/A"


class ProductionJobViewSet(viewsets.ModelViewSet):
    def get_queryset(self):
        queryset = ProductionJob.objects.all().order_by('-created_at')
        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        job_state_filter = (self.request.query_params.get('job_state') or '').strip()
        if job_state_filter:
            states = [state.strip().upper() for state in job_state_filter.split(',') if state.strip()]
            if states:
                queryset = queryset.filter(job_state__in=states)
        job_number_filter = (self.request.query_params.get('job_number') or '').strip()
        if job_number_filter:
            queryset = queryset.filter(job_number=job_number_filter)
        return queryset
    serializer_class = ProductionJobSerializer

    @action(detail=True, methods=['post'])
    def assign(self, request, pk=None):
        job = self.get_object()
        serializer = JobAssignmentSerializer(data=request.data)
        if serializer.is_valid():
            try:
                JobService.assign_job(
                    job, 
                    serializer.validated_data['machine'], 
                    serializer.validated_data['operator']
                )
                return Response(ProductionJobSerializer(job).data)
            except ValueError as e:
                return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'])
    def start(self, request, pk=None):
        job = self.get_object()
        try:
            JobService.start_job(job)
            return Response(ProductionJobSerializer(job).data)
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        job = self.get_object()
        serializer = JobCompletionSerializer(data=request.data)
        if serializer.is_valid():
            try:
                JobService.complete_job(job, serializer.validated_data['actual_qty'], user=request.user)
                return Response(ProductionJobSerializer(job).data)
            except ValueError as e:
                return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'])
    def release(self, request, pk=None):
        try:
            job = JobService.release_job(pk)
            return Response(ProductionJobSerializer(job).data)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'])
    def pause(self, request, pk=None):
        reason = request.data.get('reason')
        try:
            job = JobService.pause_job(pk, reason)
            return Response(ProductionJobSerializer(job).data)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'])
    def resume(self, request, pk=None):
        try:
            job = JobService.resume_job(pk)
            return Response(ProductionJobSerializer(job).data)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'])
    def reprioritize(self, request, pk=None):
        priority = request.data.get('priority')
        if priority is None:
            return Response({"error": "priority is required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            job = JobService.reprioritize_job(pk, priority)
            return Response(ProductionJobSerializer(job).data)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'])
    def split(self, request, pk=None):
        qty = request.data.get('split_qty')
        if qty is None:
            return Response({"error": "split_qty is required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            original, child = JobService.split_job(pk, qty)
            return Response({
                "original": ProductionJobSerializer(original).data,
                "child": ProductionJobSerializer(child).data
            })
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='job-work')
    def job_work(self, request, pk=None):
        try:
            vendor_id = request.data.get('vendor_id')
            mode = request.data.get('mode') or 'EMERGENCY'
            emergency_reason = request.data.get('emergency_reason') or ''
            notes = request.data.get('notes') or ''

            job, order = JobService.send_to_jobwork(
                pk,
                vendor_id=vendor_id,
                mode=mode,
                emergency_reason=emergency_reason,
                notes=notes,
            )
            payload = ProductionJobSerializer(job).data
            payload["jobwork_order"] = {
                "id": str(order.id),
                "mode": order.mode,
                "status": order.status,
                "vendor_name": order.vendor_name,
                "route_step_index": order.route_step_index,
            }
            return Response(payload)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='toggle-hold')
    def toggle_hold(self, request, pk=None):
        reason = request.data.get('reason')
        try:
            job = JobService.toggle_hold(pk, reason)
            return Response(ProductionJobSerializer(job).data)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['get'], url_path='tiered-rolls')
    def tiered_rolls(self, request, pk=None):
        """Return ranked roll candidates with tier labels for the WCM picker."""
        from apps.production.services.roll_allocation_service import RollAllocationService
        from apps.production.models import ProductionJob
        try:
            job = ProductionJob.objects.get(pk=pk)
        except ProductionJob.DoesNotExist:
            return Response({"error": "Job not found"}, status=status.HTTP_404_NOT_FOUND)
        try:
            tiered = RollAllocationService.allocate_tiered(job)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        payload = []
        for entry in tiered:
            roll = entry["roll"]
            location = getattr(roll, "location", None)
            roll_plant = getattr(roll, "plant", None) or getattr(location, "plant", None)
            parent = getattr(roll, "parent_roll", None)
            creator_job = getattr(roll, "created_by_job", None)
            payload.append({
                "roll_id": str(roll.id),
                "label_id": roll.label_id,
                "width_mm": float(roll.width_mm or 0),
                "stock_form": getattr(roll, "stock_form", "OPEN_WEB"),
                "width_basis": getattr(roll, "width_basis", ""),
                "thickness_micron": float(roll.thickness_micron or 0),
                "weight_kg": float(roll.weight_kg or 0),
                "material_code": getattr(roll.material, "code", "") if roll.material else "",
                "material_name": getattr(roll.material, "name", "") if roll.material else "",
                "stage_index": int(roll.stage_index or 0),
                "tier": entry["tier"],
                "slit_preview": entry["slit_preview"],
                "meta": (roll.meta_json or {}),
                # Polish payload extensions
                "created_at": roll.created_at.isoformat() if getattr(roll, "created_at", None) else None,
                "received_at": (
                    roll.received_at.isoformat()
                    if getattr(roll, "received_at", None)
                    else (roll.created_at.isoformat() if getattr(roll, "created_at", None) else None)
                ),
                "plant_id": str(getattr(roll_plant, "id", "") or "") if roll_plant else "",
                "plant_code": getattr(roll_plant, "code", "") if roll_plant else "",
                "plant_name": getattr(roll_plant, "name", "") if roll_plant else "",
                "location_code": getattr(location, "code", "") if location else "",
                "location_name": getattr(location, "name", "") if location else "",
                "created_by_job": (
                    {
                        "job_number": getattr(creator_job, "job_number", ""),
                        "completed_at": creator_job.closed_at.isoformat() if getattr(creator_job, "closed_at", None) else None,
                    }
                    if creator_job
                    else None
                ),
                "parent_roll": (
                    {
                        "label_id": getattr(parent, "label_id", ""),
                        "width_mm": float(getattr(parent, "width_mm", 0) or 0),
                        "stock_form": getattr(parent, "stock_form", "OPEN_WEB"),
                    }
                    if parent
                    else None
                ),
            })
        target_w = None
        child_w = None
        lane_count = 1
        web_width_policy = None
        target_stock_contract = {}
        job_plant_id = ""
        job_plant_code = ""
        try:
            from apps.production.services.services_execution import ExecutionService

            resolved_plant_id = ExecutionService._resolve_job_plant_id(job)
            if resolved_plant_id:
                job_plant_id = str(resolved_plant_id)
                plant = getattr(job, "plant", None) or getattr(getattr(job, "from_location", None), "plant", None)
                if plant and str(getattr(plant, "id", "")) == job_plant_id:
                    job_plant_code = getattr(plant, "code", "") or ""
            target_w = float(RollAllocationService.planned_parent_width(job))
            child_w = float(RollAllocationService.target_child_width(job))
            lane_count = RollAllocationService.preferred_lane_count(job)
            target_stock_contract = RollAllocationService.target_stock_contract(job)
            from apps.materials.services_web_width_policy import resolve_web_width_policy, web_width_context_from_job
            policy = resolve_web_width_policy(web_width_context_from_job(job))
            if policy:
                web_width_policy = {
                    "id": str(policy.id),
                    "code": policy.code,
                    "name": policy.name,
                    "scope_type": getattr(policy, "scope_type", "GLOBAL"),
                    "scope_ref": getattr(policy, "scope_ref", ""),
                    "min_remainder_mm": float(policy.min_remainder_mm or 50),
                    "prefer_remainder_first": bool(policy.prefer_remainder_first),
                    "parent_width_strategy": getattr(policy, "parent_width_strategy", "CALCULATED"),
                }
        except Exception:
            target_w = None
        # Surface job's remaining quantity in kg so the dialog's coverage card
        # can compute "needed / picked / still need" without a second round-trip.
        remaining_qty_kg = None
        try:
            uom = str(getattr(job, "uom", "") or "").upper()
            remaining = getattr(job, "remaining_qty", None)
            if remaining is not None and uom == "KG":
                remaining_qty_kg = float(remaining)
        except Exception:
            remaining_qty_kg = None
        return Response({
            "candidates": payload,
            "target_width_mm": target_w,
            "planned_parent_width_mm": target_w,
            "child_target_width_mm": child_w,
            "preferred_lane_count": lane_count,
            "target_stock_contract": target_stock_contract,
            "web_width_policy": web_width_policy,
            "job_plant_id": job_plant_id,
            "job_plant_code": job_plant_code,
            "remaining_qty_kg": remaining_qty_kg,
        })

    @action(detail=True, methods=['post'], url_path='allocate-with-slit')
    def allocate_with_slit(self, request, pk=None):
        """
        Body: {roll_id, child_widths_mm: [620], reason?: str}
        Splits the parent jumbo, links via RollLink(SPLIT), and assigns child
        rolls. For a committed gang, child widths and target jobs are resolved
        server-side so the UI cannot accidentally create a partial gang.
        """
        from apps.production.services.roll_allocation_service import RollAllocationService
        from apps.production.models import ProductionJob
        from apps.inventory.models import InventoryRoll
        try:
            job = ProductionJob.objects.get(pk=pk)
        except ProductionJob.DoesNotExist:
            return Response({"error": "Job not found"}, status=status.HTTP_404_NOT_FOUND)

        roll_id = request.data.get('roll_id')
        widths = request.data.get('child_widths_mm') or []
        reason = (request.data.get('reason') or '').strip()
        if not roll_id:
            return Response({"error": "roll_id required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            parent = InventoryRoll.objects.get(pk=roll_id)
        except (InventoryRoll.DoesNotExist, ValueError, Exception) as exc:
            if isinstance(exc, InventoryRoll.DoesNotExist):
                return Response({"error": "Roll not found"}, status=status.HTTP_404_NOT_FOUND)
            return Response({"error": f"Invalid roll_id: {exc}"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            assign_jobs = None
            gang_group_id = ""
            gang_jobs, gang_widths = RollAllocationService.committed_gang_child_plan(job, strict=True)
            if len(gang_jobs) >= 2:
                assign_jobs = gang_jobs
                widths = [float(w) for w in gang_widths]
                gang_group_id = str(((job.meta_json or {}).get("gang_group_id") or "")).strip()
            if not widths:
                return Response({"error": "child_widths_mm required"}, status=status.HTTP_400_BAD_REQUEST)
            out = RollAllocationService.perform_slit_assign(
                job, parent, widths, user=request.user, reason=reason, assign_jobs=assign_jobs,
            )
            if gang_group_id:
                out["gang_group_id"] = gang_group_id
            return Response(out)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='allocate-with-slit-batch')
    def allocate_with_slit_batch(self, request, pk=None):
        """
        Atomic batch slit-and-assign.

        Body:
            {
              "picks": [
                {"roll_id": "<uuid>", "mode": "ONE"|"MAX"|"GANG", "reason": "..."},
                ...
              ]
            }

        Headers:
            Idempotency-Key: optional, dedupes the same batch within 24h.

        Behaviour: every pick is validated up-front under one transaction.
        If any pick fails validation or mutation, the entire batch rolls back —
        no partial allocation. Returns aggregated child/remainder/scrap/assignment
        info.
        """
        from apps.production.services.roll_allocation_service import RollAllocationService
        from apps.production.models import ProductionJob, RollAllocationBatchRequest
        from django.core.exceptions import ValidationError as DjangoValidationError
        from django.db import transaction

        try:
            job = ProductionJob.objects.get(pk=pk)
        except ProductionJob.DoesNotExist:
            return Response({"error": "Job not found"}, status=status.HTTP_404_NOT_FOUND)

        picks = request.data.get('picks') or []
        if not isinstance(picks, list) or not picks:
            return Response({"error": "picks (non-empty list) required"}, status=status.HTTP_400_BAD_REQUEST)

        client_token = str(request.headers.get("Idempotency-Key") or "").strip()[:120]
        if client_token:
            actor = request.user if getattr(request.user, "is_authenticated", False) else None
            try:
                with transaction.atomic():
                    record, _created = (
                        RollAllocationBatchRequest.objects.select_for_update().get_or_create(
                            job=job,
                            client_token=client_token,
                            defaults={"created_by": actor, "status": "RUNNING"},
                        )
                    )
                    if record.status == "COMPLETED" and isinstance(record.response_json, dict) and record.response_json:
                        return Response(record.response_json, status=status.HTTP_200_OK)

                    result = RollAllocationService.perform_slit_assign_batch(
                        job=job, picks=picks, user=request.user,
                    )
                    record.status = "COMPLETED"
                    record.response_json = result
                    if actor and not record.created_by_id:
                        record.created_by = actor
                    record.save(update_fields=["status", "response_json", "created_by", "updated_at"])
                    return Response(result, status=status.HTTP_200_OK)
            except DjangoValidationError as exc:
                payload = getattr(exc, "message_dict", None) or getattr(exc, "messages", None) or str(exc)
                return Response({"error": "Validation failed", "details": payload}, status=status.HTTP_400_BAD_REQUEST)
            except Exception as exc:
                return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        try:
            result = RollAllocationService.perform_slit_assign_batch(
                job=job, picks=picks, user=request.user,
            )
        except DjangoValidationError as exc:
            payload = getattr(exc, "message_dict", None) or getattr(exc, "messages", None) or str(exc)
            return Response({"error": "Validation failed", "details": payload}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(result, status=status.HTTP_200_OK)


class ProductionBatchViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = ProductionBatchSerializer

    def get_queryset(self):
        queryset = (
            ProductionBatch.objects.select_related(
                "sales_order_item",
                "sales_order_item__sales_order",
                "template",
                "routing_rule",
                "parent_batch",
            )
            .prefetch_related("jobs")
            .order_by("-updated_at", "batch_sequence")
        )
        sales_order_item_id = str(self.request.query_params.get("sales_order_item") or "").strip()
        if sales_order_item_id:
            queryset = queryset.filter(sales_order_item_id=sales_order_item_id)
        sales_order_id = str(self.request.query_params.get("sales_order") or "").strip()
        if sales_order_id:
            queryset = queryset.filter(sales_order_item__sales_order_id=sales_order_id)
        status_filter = str(self.request.query_params.get("status") or "").strip().upper()
        if status_filter and status_filter != "ALL":
            queryset = queryset.filter(status=status_filter)
        batch_number = str(self.request.query_params.get("batch_number") or "").strip()
        if batch_number:
            queryset = queryset.filter(batch_number__icontains=batch_number)
        return queryset


class WorkCenterAssignmentViewSet(viewsets.ModelViewSet):
    serializer_class = WorkCenterAssignmentSerializer

    def get_queryset(self):
        queryset = WorkCenterAssignment.objects.all().order_by('-created_at')
        
        # Scoped Access Logic
        user = self.request.user
        role_code = getattr(user, 'effective_role_code', user.role.code if user.role else 'GUEST')
        is_admin = role_code in ['ADMIN', 'SUPER_ADMIN', 'OWNER'] or user.is_owner or user.is_superuser
        
        if not is_admin:
             from apps.users.models import WorkCenterAssignment as UserWCAssignment
             # Get user's assigned WC IDs
             user_wc_ids = UserWCAssignment.objects.filter(user=user).values_list('work_center_id', flat=True)
             
             # Filter Job assignments that belong to these WCs
             queryset = queryset.filter(work_center_id__in=user_wc_ids)

        wc_id = self.request.query_params.get('work_center')
        if wc_id:
            queryset = queryset.filter(work_center_id=wc_id)

        job_number_filter = (self.request.query_params.get('job_number') or '').strip()
        if job_number_filter:
            queryset = queryset.filter(production_job__job_number=job_number_filter)
        
        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)
            
        return queryset

    @action(detail=True, methods=['post'], url_path='assign-machine')
    def assign_machine(self, request, pk=None):
        machine_id = request.data.get('machine_id')
        manual_override = bool(request.data.get('manual_override', False))
        override_reason = request.data.get('override_reason')
        if not machine_id:
            return Response({"error": "machine_id is required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            assignment = WCManagerService.assign_machine(
                pk,
                machine_id,
                user=request.user,
                manual_override=manual_override,
                override_reason=override_reason,
            )
            return Response(WorkCenterAssignmentSerializer(assignment).data)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='assign-rolls')
    def assign_rolls(self, request, pk=None):
        roll_ids = request.data.get('roll_ids', [])
        manual_override = bool(request.data.get('manual_override', False))
        override_reason = request.data.get('override_reason')
        try:
            assignment = WCManagerService.assign_rolls(
                pk,
                roll_ids,
                user=request.user,
                manual_override=manual_override,
                override_reason=override_reason,
            )
            return Response(WorkCenterAssignmentSerializer(assignment).data)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='ready-for-execution')
    def ready_for_execution(self, request, pk=None):
        try:
            assignment = WCManagerService.mark_execution_ready(pk)
            return Response(WorkCenterAssignmentSerializer(assignment).data)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


class OperatorViewSet(viewsets.ViewSet):
    """
    Operator Terminal API.
    Event-driven execution logic.
    """
    
    @action(detail=False, methods=['get'])
    def dashboard(self, request):
        wc_id = request.query_params.get('work_center_id')
        machine_id = request.query_params.get('machine_id')
        
        # Determine user's role and assigned work-center machine scope
        user = request.user
        role_code = getattr(user, 'effective_role_code', user.role.code if user.role else 'GUEST')
        is_admin = role_code in ['ADMIN', 'SUPER_ADMIN', 'OWNER'] or user.is_owner or user.is_superuser
        
        from apps.users.models import WorkCenterAssignment
        user_wc_ids = list(WorkCenterAssignment.objects.filter(user=user).values_list('work_center_id', flat=True))
        user_machine_ids = list(Machine.objects.filter(work_center_id__in=user_wc_ids).values_list('id', flat=True))
        machine_scope_ids = user_machine_ids
        if is_admin and len(user_machine_ids) == 0:
            machine_scope_ids = None
        
        try:
            # Strict Filtering: Only assigned machines
            jobs = OperatorService.get_operator_dashboard(wc_id, machine_id, user_machine_ids=machine_scope_ids)
            return Response(ProductionJobSerializer(jobs, many=True).data)
        except Exception as e:
            return Response([])

    @action(detail=True, methods=['post'])
    def start(self, request, pk=None):
        try:
            job = OperatorService.start_job(pk, request.user)
            return Response(ProductionJobSerializer(job).data)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'])
    def pause(self, request, pk=None):
        reason = request.data.get('reason', 'Operator Pause')
        try:
            job = OperatorService.pause_job(pk, reason, request.user)
            return Response(ProductionJobSerializer(job).data)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'])
    def resume(self, request, pk=None):
        try:
            job = OperatorService.resume_job(pk, request.user)
            return Response(ProductionJobSerializer(job).data)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='log-output')
    def log_output(self, request, pk=None):
        qty = request.data.get('quantity')
        if qty is None:
             return Response({"error": "quantity is required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            job = OperatorService.log_output(pk, float(qty), request.user)
            return Response(ProductionJobSerializer(job).data)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='log-scrap')
    def log_scrap(self, request, pk=None):
        qty = request.data.get('quantity')
        reason = request.data.get('reason')
        notes = request.data.get('notes', '')
        if qty is None or not reason:
             return Response({"error": "quantity and reason are required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            job = OperatorService.log_scrap(pk, float(qty), reason, notes, request.user)
            return Response(ProductionJobSerializer(job).data)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='log-downtime')
    def log_downtime(self, request, pk=None):
        start = request.data.get('start_time')
        end = request.data.get('end_time')
        reason = request.data.get('reason')
        if not start or not reason:
             return Response({"error": "start_time and reason are required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            job = OperatorService.log_downtime(pk, start, end, reason, request.user)
            return Response(ProductionJobSerializer(job).data)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='complete-session')
    def complete_session(self, request, pk=None):
        qty = request.data.get('actual_qty')
        if qty is None:
             return Response({"error": "actual_qty is required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            payload = {
                "scrap_qty": request.data.get('scrap_qty'),
                "output_width_mm": request.data.get('output_width_mm'),
                "output_length_m": request.data.get('output_length_m'),
                "output_stock_form": request.data.get('output_stock_form') or request.data.get('stock_form'),
                "roll_outputs": request.data.get('roll_outputs'),
                "split_outputs": request.data.get('split_outputs'),
                "trim_qty": request.data.get('trim_qty'),
                "process_scrap_qty": request.data.get('process_scrap_qty'),
                "output_pcs": request.data.get('output_pcs'),
            }
            job = OperatorService.complete_session(pk, float(qty), request.user, **payload)
            return Response(ProductionJobSerializer(job).data)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        """Legacy completion - delegates to session logic with 0 qty if nothing logged"""
        try:
            job = OperatorService.complete_job(pk, request.user)
            return Response(ProductionJobSerializer(job).data)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


class PackingViewSet(viewsets.ViewSet):
    """
    API for packing operations (Gonny creation).
    """
    queryset = ProductionJob.objects.none() # Dummy for DRF consistency

    @action(detail=False, methods=['get'])
    def orders(self, request):
        """List sales orders that currently have goods in Packing Yard."""
        from .services.dispatch_service import FGDispatchService
        try:
            result = FGDispatchService.get_sales_orders_for_packing()
            return Response(list(result))
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=False, methods=['get'], url_path='yard-snapshot')
    def yard_snapshot(self, request):
        """Board-level packing snapshot used by the Packing Yard UI before an order is selected."""
        from .services.dispatch_service import FGDispatchService

        try:
            order_rows = list(FGDispatchService.get_sales_orders_for_packing())
            cards = []
            totals = {
                "orders": 0,
                "pending_batches": 0,
                "pending_pcs": 0,
                "open_gonnies": 0,
                "sealed_waiting_release": 0,
                "ready_rolls": 0,
                "ready_rolls_kg": 0.0,
                "ready_rolls_gross_kg": 0.0,
                "ready_rolls_tare_kg": 0.0,
                "ready_gonnies": 0,
                "ready_gonnies_pcs": 0,
                "ready_gonnies_gross_kg": 0.0,
            }
            for row in order_rows:
                try:
                    summary = FGDispatchService.get_packing_units_by_so(row["id"])
                except Exception:
                    continue
                pending = summary.get("packing_pending", {})
                ready = summary.get("ready_for_dispatch", {})
                card = {
                    "sales_order": summary.get("sales_order") or row,
                    "pending": pending,
                    "ready_for_dispatch": ready,
                }
                cards.append(card)
                totals["orders"] += 1
                totals["pending_batches"] += int(pending.get("batches_count") or 0)
                totals["pending_pcs"] += int(pending.get("batches_pcs") or 0)
                totals["open_gonnies"] += int(pending.get("open_gonnies_count") or 0)
                totals["sealed_waiting_release"] += int(pending.get("sealed_gonnies_count") or 0)
                totals["ready_rolls"] += int(ready.get("rolls_count") or 0)
                totals["ready_rolls_kg"] += float(ready.get("rolls_kg") or 0)
                totals["ready_rolls_gross_kg"] += float(ready.get("rolls_gross_kg") or ready.get("rolls_kg") or 0)
                totals["ready_rolls_tare_kg"] += float(ready.get("rolls_tare_kg") or 0)
                totals["ready_gonnies"] += int(ready.get("gonnies_count") or 0)
                totals["ready_gonnies_pcs"] += int(ready.get("gonnies_pcs") or 0)
                totals["ready_gonnies_gross_kg"] += float(ready.get("gonnies_gross_kg") or 0)

            return Response({"totals": totals, "orders": cards})
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=False, methods=['get'])
    def so_summary(self, request):
        """Order-centric packing summary for FG batches, rolls, and gonnies."""
        from .services.dispatch_service import FGDispatchService

        so_id = request.query_params.get('sales_order_id')
        if not so_id:
            return Response({"error": "sales_order_id is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            result = FGDispatchService.get_packing_units_by_so(so_id)
            return Response(result)
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=False, methods=['get'])
    def batches(self, request):
        """Get available FG batches for packing."""
        from .models import FinishedGoodsBatch
        from django.db.models import Sum
        
        plant_id = request.query_params.get('plant_id')
        
        qs = FinishedGoodsBatch.objects.filter(
            status='AVAILABLE',
            sales_order_item__isnull=False,
        ).select_related('template', 'location', 'production_job', 'production_batch', 'sales_order_item__sales_order')
        
        if plant_id:
            qs = qs.filter(location__plant_id=plant_id)
        
        results = []
        for batch in qs:
            # Calculate packed quantity for this batch
            packed_qty = batch.packing_units.aggregate(total=Sum('qty_pcs'))['total'] or 0
            snapshot = dict(getattr(batch.sales_order_item, "packaging_snapshot", {}) or {})
            primary_cfg = snapshot.get("primary_inner_pack") if isinstance(snapshot.get("primary_inner_pack"), dict) else {}
            primary_enabled = bool(primary_cfg.get("enabled", False))
            pcs_per_pack = int(primary_cfg.get("pcs_per_pack") or 0) if primary_enabled else None
            
            results.append({
                'id': str(batch.id),
                'batch_number': batch.batch_number,
                'so_number': batch.sales_order_no,
                'customer': batch.customer_name,
                'qty_pcs': batch.qty_pcs, # Compatibility field
                'original_qty': batch.qty_pcs + packed_qty,
                'produced': batch.qty_pcs + packed_qty,
                'packed': packed_qty,
                'remaining': batch.qty_pcs,
                'product': batch.template.name if batch.template else "N/A",
                'template__name': batch.template.name if batch.template else "N/A", # Compatibility field
                'location': batch.location.name if batch.location else "N/A",
                'location__name': batch.location.name if batch.location else "N/A", # Compatibility field
                'status': batch.status,
                'primary_pack_enabled': primary_enabled,
                'pcs_per_pack': pcs_per_pack,
                'default_content_mode': 'PRIMARY_PACKS' if primary_enabled else 'LOOSE_POUCHES',
            })
            
        return Response(results)
    
    @action(detail=False, methods=['post'])
    def create_gonny(self, request):
        """Create a packing unit (gonny) from FG batch."""
        from .services.packing_service import PackingService
        
        fg_batch_id = request.data.get('fg_batch_id')
        qty_pcs = request.data.get('qty_pcs')
        gonny_material_id = request.data.get('gonny_material_id')
        packed_pcs = request.data.get('packed_pcs')
        location_id = request.data.get('location_id')
        content_mode = request.data.get('content_mode')
        primary_pack_count = request.data.get('primary_pack_count')
        
        if not fg_batch_id or not qty_pcs:
            return Response(
                {"error": "fg_batch_id and qty_pcs are required"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            gonny = PackingService.create_gonny(
                fg_batch_id,
                int(qty_pcs),
                request.user,
                gonny_material_id=str(gonny_material_id).strip() if gonny_material_id else None,
                packed_pcs=int(packed_pcs) if packed_pcs not in (None, "") else None,
                location_id=str(location_id).strip() if location_id else None,
                content_mode=str(content_mode).strip() if content_mode else None,
                primary_pack_count=int(primary_pack_count) if primary_pack_count not in (None, "") else None,
            )
            return Response({
                "id": str(gonny.id),
                "label_id": gonny.label_id,
                "qty_pcs": gonny.qty_pcs,
                "content_mode": gonny.content_mode,
                "primary_pack_count": gonny.primary_pack_count,
                "net_product_weight_kg": float(gonny.net_product_weight_kg or 0),
                "inner_pack_tare_kg": float(gonny.inner_pack_tare_kg or 0),
                "secondary_pack_tare_kg": float(gonny.secondary_pack_tare_kg or 0),
                "expected_gross_weight_kg": float(gonny.expected_gross_weight_kg or 0) if gonny.expected_gross_weight_kg is not None else None,
                "gross_weight_kg": float(gonny.gross_weight_kg or 0) if gonny.gross_weight_kg is not None else None,
                "gross_variance_kg": float(gonny.gross_variance_kg or 0) if gonny.gross_variance_kg is not None else None,
                "gross_variance_pct": float(gonny.gross_variance_pct or 0) if gonny.gross_variance_pct is not None else None,
                "gross_variance_reason": gonny.gross_variance_reason or "",
                "tare_breakdown_json": gonny.tare_breakdown_json or {},
                "status": gonny.status,
                "message": f"Gonny {gonny.label_id} created with {gonny.qty_pcs} pcs"
            }, status=status.HTTP_201_CREATED)
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except ValidationError as e:
            message = "; ".join(getattr(e, "messages", []) or []) or str(e)
            return Response({"error": message}, status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=True, methods=['post'])
    def seal(self, request, pk=None):
        """Seal a packing unit with final weight."""
        from .services.packing_service import PackingService
        
        weight_kg = request.data.get('weight_kg')
        extras = request.data.get('extras') if 'extras' in request.data else None
        variance_reason = request.data.get('gross_variance_reason') or request.data.get('variance_reason') or ''
        
        if not weight_kg:
            return Response(
                {"error": "weight_kg is required"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            gonny = PackingService.seal_gonny(
                pk,
                weight_kg,
                request.user,
                extras=extras if isinstance(extras, list) else None,
                variance_reason=variance_reason,
            )
            return Response({
                "id": str(gonny.id),
                "label_id": gonny.label_id,
                "weight_kg": float(gonny.weight_kg),
                "net_product_weight_kg": float(gonny.net_product_weight_kg or 0),
                "inner_pack_tare_kg": float(gonny.inner_pack_tare_kg or 0),
                "secondary_pack_tare_kg": float(gonny.secondary_pack_tare_kg or 0),
                "extras_tare_kg": float(gonny.extras_tare_kg or 0),
                "expected_gross_weight_kg": float(gonny.expected_gross_weight_kg or 0) if gonny.expected_gross_weight_kg is not None else None,
                "gross_weight_kg": float(gonny.gross_weight_kg or 0),
                "gross_variance_kg": float(gonny.gross_variance_kg or 0) if gonny.gross_variance_kg is not None else None,
                "gross_variance_pct": float(gonny.gross_variance_pct or 0) if gonny.gross_variance_pct is not None else None,
                "gross_variance_reason": gonny.gross_variance_reason or "",
                "tare_breakdown_json": gonny.tare_breakdown_json or {},
                "content_mode": gonny.content_mode,
                "primary_pack_count": gonny.primary_pack_count,
                "status": gonny.status,
                "message": f"Gonny {gonny.label_id} sealed at {weight_kg} kg"
            })
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except ValidationError as e:
            message = "; ".join(getattr(e, "messages", []) or []) or str(e)
            return Response({"error": message}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='release')
    def release(self, request, pk=None):
        """
        Release a sealed gonny to Dispatch Bay.

        Optional body:
          { "lines": [{ "material_id": "uuid", "qty": 2, "uom": "PCS", "notes": "" }, ...] }

        Each line marks an extra packing item (sheet wrap / tape / label / tag)
        used at release time against this gonny's sales order. Stock movement is
        still posted only from the timestamped packing stock count.
        """
        from .services.dispatch_service import FGDispatchService

        lines = request.data.get('lines') if isinstance(request.data.get('lines'), list) else []
        try:
            gonny = FGDispatchService.release_gonny_to_dispatch(pk, request.user, lines=lines)
            extras = (gonny.meta_json or {}).get("release_extras") or []
            return Response({
                "id": str(gonny.id),
                "label_id": gonny.label_id,
                "status": gonny.status,
                "released_to_dispatch": True,
                "extras": extras,
                "tx_ids": (gonny.meta_json or {}).get("release_extras_tx_ids") or [],
                "message": f"Gonny {gonny.label_id} sent to Dispatch Bay" + (
                    f" · marked {len(extras)} packing item(s)" if extras else ""
                ),
            })
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'], url_path='release-roll')
    def release_roll(self, request):
        """Pack/release a finished roll from Packing Yard to Dispatch Bay."""
        from .services.dispatch_service import FGDispatchService

        roll_id = request.data.get('roll_id')
        release_mode = request.data.get('release_mode', 'PACKED')
        lines = request.data.get('lines', [])
        if not roll_id:
            return Response({"error": "roll_id is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            record = FGDispatchService.release_roll_to_dispatch(
                roll_id=str(roll_id),
                user=request.user if request.user.is_authenticated else None,
                lines=lines if isinstance(lines, list) else [],
                release_mode=str(release_mode or 'PACKED'),
            )
            return Response({
                "id": str(record.id),
                "roll_id": str(record.roll_id),
                "sales_order_item_id": str(record.sales_order_item_id),
                "packed_at": record.packed_at.isoformat() if record.packed_at else None,
                "lines": record.lines,
                "tx_ids": record.tx_ids,
                "released_to_dispatch": True,
                "release_mode": str((record.meta_json or {}).get("release_mode") or ("PACKED" if record.lines else "UNPACKED")).upper(),
                "message": "Roll sent to Dispatch Bay",
            }, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'], url_path='bulk-release-rolls')
    def bulk_release_rolls(self, request):
        """Pack/release multiple finished rolls with one total roll-packing material issue."""
        from .services.dispatch_service import FGDispatchService

        roll_ids = request.data.get('roll_ids', [])
        release_mode = request.data.get('release_mode', 'PACKED')
        lines = request.data.get('lines', [])
        if not isinstance(roll_ids, list) or not roll_ids:
            return Response({"error": "roll_ids is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            records = FGDispatchService.release_rolls_to_dispatch(
                roll_ids=[str(value) for value in roll_ids],
                user=request.user if request.user.is_authenticated else None,
                lines=lines if isinstance(lines, list) else [],
                release_mode=str(release_mode or 'PACKED'),
            )
            return Response({
                "count": len(records),
                "records": [
                    {
                        "id": str(record.id),
                        "roll_id": str(record.roll_id),
                        "sales_order_item_id": str(record.sales_order_item_id),
                        "lines": record.lines,
                        "tx_ids": record.tx_ids,
                        "released_to_dispatch": True,
                        "release_mode": str((record.meta_json or {}).get("release_mode") or ("PACKED" if record.lines else "UNPACKED")).upper(),
                        "dispatch_unit_no": (record.meta_json or {}).get("dispatch_unit_no") or "",
                    }
                    for record in records
                ],
                "message": f"{len(records)} rolls sent to Dispatch Bay",
            }, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['get', 'post'], url_path='material-count')
    def material_count(self, request):
        """Timestamped packing-material count with order allocation."""
        from .services.packing_count_service import PackingCountService

        if request.method == 'GET':
            try:
                return Response(
                    PackingCountService.snapshot(
                        count_date=request.query_params.get('date') or request.query_params.get('count_date'),
                        counted_at=request.query_params.get('counted_at') or request.query_params.get('event_at'),
                        plant_id=request.query_params.get('plant_id') or request.query_params.get('plant'),
                        location_id=request.query_params.get('location_id') or request.query_params.get('location'),
                    )
                )
            except Exception as e:
                return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        try:
            result = PackingCountService.post_count(
                lines=request.data.get('lines') if isinstance(request.data.get('lines'), list) else [],
                count_date=request.data.get('date') or request.data.get('count_date'),
                counted_at=request.data.get('counted_at') or request.data.get('event_at'),
                user=request.user if request.user.is_authenticated else None,
                notes=request.data.get('notes') or '',
            )
            return Response(result, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=False, methods=['get'])
    def gonnies(self, request):
        """List all gonnies with optional filters."""
        from .models import PackingUnit
        
        plant_id = request.query_params.get('plant_id')
        status_filter = request.query_params.get('status')
        
        qs = PackingUnit.objects.select_related('fg_batch', 'production_batch', 'location')
        qs = qs.filter(sales_order_item__isnull=False)
        
        if plant_id:
            qs = qs.filter(location__plant_id=plant_id)
        
        if status_filter:
            qs = qs.filter(status=status_filter)
        
        data = []
        for gonny in qs.select_related('location__plant', 'fg_batch', 'production_batch'):
            data.append(
                {
                    'id': str(gonny.id),
                    'label_id': gonny.label_id,
                    'qty_pcs': gonny.qty_pcs,
                    'weight_kg': float(gonny.weight_kg) if gonny.weight_kg is not None else None,
                    'net_product_weight_kg': float(gonny.net_product_weight_kg or 0),
                    'inner_pack_tare_kg': float(gonny.inner_pack_tare_kg or 0),
                    'secondary_pack_tare_kg': float(gonny.secondary_pack_tare_kg or 0),
                    'extras_tare_kg': float(gonny.extras_tare_kg or 0),
                    'expected_gross_weight_kg': float(gonny.expected_gross_weight_kg or 0) if gonny.expected_gross_weight_kg is not None else None,
                    'gross_weight_kg': float(gonny.gross_weight_kg or 0) if gonny.gross_weight_kg is not None else None,
                    'gross_variance_kg': float(gonny.gross_variance_kg or 0) if gonny.gross_variance_kg is not None else None,
                    'gross_variance_pct': float(gonny.gross_variance_pct or 0) if gonny.gross_variance_pct is not None else None,
                    'gross_variance_reason': gonny.gross_variance_reason or '',
                    'tare_breakdown_json': gonny.tare_breakdown_json or {},
                    'status': gonny.status,
                    'content_mode': gonny.content_mode,
                    'primary_pack_count': gonny.primary_pack_count,
                    'fg_batch__batch_number': gonny.fg_batch.batch_number if gonny.fg_batch else None,
                    'batch_no': gonny.fg_batch.batch_number if gonny.fg_batch else None,
                    'location': {
                        'id': str(gonny.location.id) if gonny.location_id else None,
                        'name': gonny.location.name if gonny.location_id else None,
                        'plant_id': str(gonny.location.plant_id) if gonny.location_id else None,
                        'plant_name': gonny.location.plant.name if gonny.location_id else None,
                    },
                }
            )
        return Response(data)

    # ─────────────────────────────────────────────────────────────
    # Audit trail of per-order packing consumption.
    #
    # READ-ONLY. Returns every PackagingTransaction(type=CONSUME) that is
    # linked to a SalesOrderItem, plus release-time material marks saved on
    # dispatch metadata. Stock-affecting rows are written automatically by:
    #
    #   - PackingService.create_gonny       basis=PER_GONNY            (gonny SKU auto-consumed at create)
    #   - final production FG capture       basis=PER_PACK             (inner pouch SKU auto-consumed when inner packs are made)
    #   - PackingService.seal_gonny         basis=PER_GONNY            (extras marked at seal time, no stock movement)
    #   - FGDispatchService.release_gonny_to_dispatch
    #                                       basis=PER_GONNY_RELEASE    (extras marked at release-to-dispatch, no stock movement)
    #   - FGDispatchService.release_roll_to_dispatch
    #                                       basis=PER_ROLL_RELEASE     (items marked at roll release, no stock movement)
    #   - PackingCountService.post_count    basis=PACKING_EOD_COUNT    (EOD open-close diff allocated back to orders)
    #
    # There is no standalone "per-order tick" page any more — everything is
    # captured at the packing-yard moment (auto-consume on create, tag on
    # release) or via the EOD count.
    # ─────────────────────────────────────────────────────────────

    @action(detail=False, methods=['get'], url_path='order-consumption')
    def order_consumption_list(self, request):
        """
        Audit view of per-order packing consumption.

        Query params:
          - sales_order_id   (filter to one SO)
          - sales_order_no   (filter to one SO by number)
          - customer_id      (filter by customer)
          - material_id      (filter to one packing SKU)
          - date_from / date_to (ISO yyyy-mm-dd, inclusive)
          - limit            (default 200, max 1000)
        """
        from apps.inventory.models import PackagingTransaction
        from datetime import datetime, timedelta

        qs = (
            PackagingTransaction.objects.filter(type='CONSUME')
            .filter(sales_order_item__isnull=False)
            .select_related('material', 'location', 'sales_order_item', 'sales_order_item__sales_order')
            .order_by('-created_at')
        )

        so_id = request.query_params.get('sales_order_id')
        so_no = request.query_params.get('sales_order_no')
        customer_id = request.query_params.get('customer_id')
        material_id = request.query_params.get('material_id')
        date_from = request.query_params.get('date_from')
        date_to = request.query_params.get('date_to')

        if so_id:
            qs = qs.filter(sales_order_item__sales_order_id=so_id)
        if so_no:
            qs = qs.filter(sales_order_item__sales_order__order_number=so_no)
        if customer_id:
            qs = qs.filter(sales_order_item__sales_order__customer_id=customer_id)
        if material_id:
            qs = qs.filter(material_id=material_id)
        if date_from:
            try:
                d = datetime.fromisoformat(date_from)
                qs = qs.filter(created_at__gte=d)
            except ValueError:
                pass
        if date_to:
            try:
                d = datetime.fromisoformat(date_to) + timedelta(days=1)
                qs = qs.filter(created_at__lt=d)
            except ValueError:
                pass

        # Optional limit (default 200, ceiling 1000)
        try:
            limit = max(1, min(1000, int(request.query_params.get('limit') or 200)))
        except (TypeError, ValueError):
            limit = 200

        rows = []
        for tx in qs[:limit]:
            so = getattr(tx.sales_order_item, 'sales_order', None) if tx.sales_order_item else None
            rows.append({
                "id": str(tx.id),
                "created_at": tx.created_at.isoformat(),
                "sales_order_id": str(so.id) if so else None,
                "sales_order_no": so.order_number if so else "",
                "customer_id": str(so.customer_id) if so and so.customer_id else None,
                "customer_name": getattr(so, 'customer_name', '') if so else "",
                "material_id": str(tx.material_id),
                "material_code": tx.material.code,
                "material_name": tx.material.name,
                "packaging_kind": getattr(tx.material, 'packaging_kind', '') or '',
                "qty": float(tx.qty),
                "uom": tx.material.base_uom,
                "location_id": str(tx.location_id),
                "location_name": tx.location.name,
                "reference": tx.reference or "",
                "ticked_by": (tx.meta_json or {}).get("ticked_by") or "",
                "notes": (tx.meta_json or {}).get("notes") or "",
            })

        # Mark-only release evidence. These rows do not touch stock; the
        # timestamped packing count posts actual stock movement later.
        from .models import PackingUnit, RollDispatchPackRecord

        marked_rows = []
        gonny_qs = PackingUnit.objects.select_related(
            'sales_order_item',
            'sales_order_item__sales_order',
            'location',
        ).filter(sales_order_item__isnull=False)
        roll_qs = RollDispatchPackRecord.objects.select_related(
            'sales_order_item',
            'sales_order_item__sales_order',
            'roll',
            'roll__location',
        ).filter(sales_order_item__isnull=False)

        if so_id:
            gonny_qs = gonny_qs.filter(sales_order_item__sales_order_id=so_id)
            roll_qs = roll_qs.filter(sales_order_item__sales_order_id=so_id)
        if so_no:
            gonny_qs = gonny_qs.filter(sales_order_item__sales_order__order_number=so_no)
            roll_qs = roll_qs.filter(sales_order_item__sales_order__order_number=so_no)
        if customer_id:
            gonny_qs = gonny_qs.filter(sales_order_item__sales_order__customer_id=customer_id)
            roll_qs = roll_qs.filter(sales_order_item__sales_order__customer_id=customer_id)
        if date_from:
            try:
                d = datetime.fromisoformat(date_from)
                gonny_qs = gonny_qs.filter(created_at__gte=d)
                roll_qs = roll_qs.filter(packed_at__gte=d)
            except ValueError:
                pass
        if date_to:
            try:
                d = datetime.fromisoformat(date_to) + timedelta(days=1)
                gonny_qs = gonny_qs.filter(created_at__lt=d)
                roll_qs = roll_qs.filter(packed_at__lt=d)
            except ValueError:
                pass

        material_ids = set()
        mark_payloads = []
        for gonny in gonny_qs[:limit]:
            meta = gonny.meta_json if isinstance(gonny.meta_json, dict) else {}
            for line in meta.get("release_extras") or []:
                if isinstance(line, dict) and line.get("material_id"):
                    material_ids.add(str(line.get("material_id")))
                    mark_payloads.append(("gonny", gonny, line))
        for record in roll_qs[:limit]:
            for line in record.lines or []:
                if isinstance(line, dict) and line.get("material_id"):
                    material_ids.add(str(line.get("material_id")))
                    mark_payloads.append(("roll", record, line))

        from apps.materials.models import InventoryMaterial
        materials = {str(mat.id): mat for mat in InventoryMaterial.objects.filter(id__in=material_ids)}
        for source, obj, line in mark_payloads:
            mat = materials.get(str(line.get("material_id")))
            if material_id and str(line.get("material_id")) != str(material_id):
                continue
            if not mat:
                continue
            sales_item = getattr(obj, "sales_order_item", None)
            so = getattr(sales_item, "sales_order", None) if sales_item else None
            location = getattr(obj, "location", None) if source == "gonny" else getattr(getattr(obj, "roll", None), "location", None)
            occurred_at = (getattr(obj, "sealed_at", None) or getattr(obj, "created_at", None)) if source == "gonny" else getattr(obj, "packed_at", None)
            marked_rows.append({
                "id": f"mark:{source}:{getattr(obj, 'id', '')}:{line.get('material_id')}",
                "created_at": occurred_at.isoformat() if occurred_at else "",
                "sales_order_id": str(so.id) if so else None,
                "sales_order_no": so.order_number if so else "",
                "customer_id": str(so.customer_id) if so and so.customer_id else None,
                "customer_name": getattr(so, 'customer_name', '') if so else "",
                "material_id": str(mat.id),
                "material_code": mat.code,
                "material_name": mat.name,
                "packaging_kind": getattr(mat, 'packaging_kind', '') or '',
                "qty": float(line.get("qty") or 0),
                "uom": line.get("uom") or mat.base_uom,
                "location_id": str(location.id) if location else "",
                "location_name": location.name if location else "",
                "reference": "MARKED_USED_AT_RELEASE",
                "ticked_by": "",
                "notes": line.get("notes") or "",
                "stock_effect": "MARK_ONLY",
            })

        rows.extend(marked_rows)
        rows.sort(key=lambda row: row.get("created_at") or "", reverse=True)
        return Response({"count": len(rows[:limit]), "rows": rows[:limit]})


class DeliveryChallanViewSet(viewsets.ViewSet):
    """
    API for Delivery Challan management.
    """
    queryset = ProductionJob.objects.none() # Dummy for DRF consistency
    
    @action(detail=False, methods=['get'])
    def so_with_fg(self, request):
        """List Sales Orders that have units already released from Packing Yard."""
        from .services.dispatch_service import FGDispatchService
        try:
            result = FGDispatchService.get_sales_orders_with_fg()
            return Response(list(result))
        except Exception as e:
            return Response(
                {
                    "status": "error",
                    "message": "Request failed.",
                    "detail": str(e),
                    "results": [],
                    "data": {},
                    "count": 0,
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=False, methods=['get'], url_path='board')
    def board(self, request):
        """Dispatch board snapshot used before the dispatcher picks a sales order."""
        from .services.dispatch_service import FGDispatchService

        try:
            order_rows = list(FGDispatchService.get_sales_orders_with_fg())
            cards = []
            totals = {
                "orders": 0,
                "ready_rolls": 0,
                "ready_rolls_kg": 0.0,
                "ready_rolls_gross_kg": 0.0,
                "ready_rolls_tare_kg": 0.0,
                "ready_gonnies": 0,
                "ready_gonnies_pcs": 0,
                "ready_gonnies_gross_kg": 0.0,
                "pending_in_packing": 0,
            }
            for row in order_rows:
                try:
                    summary = FGDispatchService.get_dispatchable_units_by_so(row["id"])
                except Exception:
                    continue
                ready = summary.get("available_for_dispatch", {})
                pending = summary.get("packing_pending", {})
                cards.append(
                    {
                        "sales_order": summary.get("sales_order") or row,
                        "available_for_dispatch": ready,
                        "packing_pending": pending,
                        "dispatched_qty": summary.get("dispatched_qty", {}),
                    }
                )
                totals["orders"] += 1
                totals["ready_rolls"] += int(ready.get("rolls_count") or 0)
                totals["ready_rolls_kg"] += float(ready.get("rolls_kg") or 0)
                totals["ready_rolls_gross_kg"] += float(ready.get("rolls_gross_kg") or ready.get("rolls_kg") or 0)
                totals["ready_rolls_tare_kg"] += float(ready.get("rolls_tare_kg") or 0)
                totals["ready_gonnies"] += int(ready.get("gonnies_count") or 0)
                totals["ready_gonnies_pcs"] += int(ready.get("gonnies_pcs") or 0)
                totals["ready_gonnies_gross_kg"] += float(ready.get("gonnies_gross_kg") or 0)
                totals["pending_in_packing"] += int(pending.get("open_gonnies_count") or 0) + int(pending.get("unpacked_batch_count") or 0)

            return Response({"totals": totals, "orders": cards})
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
    @action(detail=False, methods=['get'])
    def list_challans(self, request):
        """List all challans with optional filters."""
        from .models import DeliveryChallan
        try:
            plant_id = request.query_params.get('plant_id')
            status_filter = request.query_params.get('status')
            
            qs = DeliveryChallan.objects.select_related('plant')
            
            if plant_id:
                qs = qs.filter(plant_id=plant_id)
            
            if status_filter:
                qs = qs.filter(status=status_filter)
            
            data = []
            for ch in qs:
                data.append({
                    'id': str(ch.id),
                    'dc_no': ch.dc_no,
                    'customer_name': ch.customer_name or "N/A",
                    'status': ch.status,
                    'vehicle_no': ch.vehicle_no or "",
                    'driver_name': ch.driver_name or "",
                    'driver_phone': ch.driver_phone or "",
                    'transporter_name': ch.transporter_name or "",
                    'lr_number': ch.lr_number or "",
                    'e_way_bill_number': ch.e_way_bill_number or "",
                    'dispatch_notes': ch.dispatch_notes or "",
                    'ship_to_address_snapshot': ch.ship_to_address_snapshot or {},
                    'dispatch_date': ch.dispatch_date.isoformat() if ch.dispatch_date else None,
                    'plant_name': ch.plant.name if ch.plant else "N/A",
                    'so_number': _safe_sales_order_number(ch.sales_order_id)
                })
            return Response(data)
        except Exception as e:
            return Response(
                {
                    "status": "error",
                    "message": "Request failed.",
                    "detail": str(e),
                    "results": [],
                    "data": {},
                    "count": 0,
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
    
    @action(detail=False, methods=['get'])
    def get_so_dispatchable_items(self, request):
        """Get dispatchable units for a specific Sales Order."""
        from .services.dispatch_service import FGDispatchService
        
        so_id = request.query_params.get('sales_order_id')
        if not so_id:
            return Response({"error": "sales_order_id is required"}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            result = FGDispatchService.get_dispatchable_units_by_so(so_id)
            return Response(result)
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=False, methods=['post'])
    def create_challan(self, request):
        """Create a new Delivery Challan."""
        from .services.dispatch_service import FGDispatchService
        
        required = ['customer_name', 'plant_id', 'sales_order_id']
        for field in required:
            if not request.data.get(field):
                return Response(
                    {"error": f"{field} is required"},
                    status=status.HTTP_400_BAD_REQUEST
                )
        
        try:
            challan = FGDispatchService.create_challan(
                customer_name=request.data.get('customer_name'),
                plant_id=request.data.get('plant_id'),
                sales_order_id=request.data.get('sales_order_id'),
                vehicle_no=request.data.get('vehicle_no', ''),
                driver_name=request.data.get('driver_name', ''),
                driver_phone=request.data.get('driver_phone', ''),
                transporter_name=request.data.get('transporter_name', ''),
                lr_number=request.data.get('lr_number', ''),
                e_way_bill_number=request.data.get('e_way_bill_number', ''),
                dispatch_notes=request.data.get('dispatch_notes', '') or request.data.get('notes', ''),
                ship_to_address_snapshot=request.data.get('ship_to_address_snapshot') if isinstance(request.data.get('ship_to_address_snapshot'), dict) else {},
                roll_ids=request.data.get('roll_ids', []),
                gonny_ids=request.data.get('gonny_ids', []),
                user=request.user
            )
            return Response({
                "id": str(challan.id),
                "dc_no": challan.dc_no,
                "status": challan.status,
                "items_count": challan.items.count(),
                "message": f"Challan {challan.dc_no} created"
            }, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'], url_path='pack_roll')
    def pack_roll(self, request):
        from .services.dispatch_service import FGDispatchService

        roll_id = request.data.get('roll_id')
        lines = request.data.get('lines', [])
        if not roll_id:
            return Response({"error": "roll_id is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            record = FGDispatchService.pack_roll(
                roll_id=roll_id,
                lines=lines if isinstance(lines, list) else [],
                user=request.user if request.user.is_authenticated else None,
            )
            return Response(
                {
                    "id": str(record.id),
                    "roll_id": str(record.roll_id),
                    "sales_order_item_id": str(record.sales_order_item_id),
                    "packed_at": record.packed_at.isoformat() if record.packed_at else None,
                    "lines": record.lines,
                    "tx_ids": record.tx_ids,
                    "packed_for_dispatch": True,
                },
                status=status.HTTP_201_CREATED,
            )
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=True, methods=['post'], url_path='dispatch')
    def dispatch_challan(self, request, pk=None):
        """Dispatch a challan - move items to IN_TRANSIT."""
        from .services.dispatch_service import FGDispatchService
        
        try:
            challan = FGDispatchService.dispatch_challan(pk, request.user)
            return Response({
                "id": str(challan.id),
                "dc_no": challan.dc_no,
                "status": challan.status,
                "dispatch_date": challan.dispatch_date.isoformat() if challan.dispatch_date else None,
                "message": f"Challan {challan.dc_no} dispatched successfully"
            })
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=True, methods=['post'])
    def update_status(self, request, pk=None):
        """Update challan status (IN_TRANSIT, DELIVERED, RETURNED, etc)."""
        from .services.dispatch_service import FGDispatchService
        
        new_status = request.data.get('status')
        if not new_status:
            return Response({"error": "status is required"}, status=status.HTTP_400_BAD_REQUEST)
            
        try:
            challan = FGDispatchService.update_challan_status(pk, new_status, request.user)
            return Response({
                "id": str(challan.id),
                "dc_no": challan.dc_no,
                "status": challan.status,
                "message": f"Challan {challan.dc_no} status updated to {challan.status}"
            })
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'])
    def mark_received(self, request, pk=None):
        """Mark a dispatched challan as received (delivered)."""
        from .services.dispatch_service import FGDispatchService
        
        try:
            challan = FGDispatchService.mark_received(pk, request.user)
            return Response({
                "id": str(challan.id),
                "dc_no": challan.dc_no,
                "status": challan.status,
                "received_date": challan.received_date.isoformat() if challan.received_date else None,
                "message": f"Challan {challan.dc_no} marked as received"
            })
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=True, methods=['get'])
    def detail(self, request, pk=None):
        """Get challan details with items."""
        from .models import DeliveryChallan
        
        try:
            challan = DeliveryChallan.objects.get(id=pk)
        except DeliveryChallan.DoesNotExist:
            return Response({"error": "Challan not found"}, status=status.HTTP_404_NOT_FOUND)
        
        items = []
        for item in challan.items.select_related('roll', 'packing_unit', 'packing_unit__production_batch', 'fg_batch', 'fg_batch__production_batch'):
            packing_unit = item.packing_unit
            roll = item.roll
            roll_net = float(getattr(roll, "net_weight_kg", None) or getattr(roll, "weight_kg", 0) or 0) if roll else None
            roll_tare = float(getattr(roll, "tare_weight_kg", 0) or 0) if roll else None
            roll_gross = float(getattr(roll, "gross_weight_kg", None) or ((roll_net or 0) + (roll_tare or 0))) if roll else None
            items.append({
                "id": str(item.id),
                "type": "roll" if roll else ("gonny" if item.packing_unit else "batch"),
                "label": roll.label_id if roll else (item.packing_unit.label_id if item.packing_unit else (item.fg_batch.batch_number if item.fg_batch else "N/A")),
                "batch_no": roll.batch_no if roll else (item.fg_batch.batch_number if item.fg_batch else None),
                "weight_kg": float(item.weight_kg),
                "qty_pcs": item.qty_pcs,
                "content_mode": packing_unit.content_mode if packing_unit else None,
                "primary_pack_count": packing_unit.primary_pack_count if packing_unit else None,
                "net_product_weight_kg": roll_net if roll else (float(getattr(packing_unit, "net_product_weight_kg", 0) or 0) if packing_unit else None),
                "tare_weight_kg": roll_tare,
                "inner_pack_tare_kg": float(getattr(packing_unit, "inner_pack_tare_kg", 0) or 0) if packing_unit else None,
                "secondary_pack_tare_kg": float(getattr(packing_unit, "secondary_pack_tare_kg", 0) or 0) if packing_unit else None,
                "extras_tare_kg": float(getattr(packing_unit, "extras_tare_kg", 0) or 0) if packing_unit else None,
                "expected_gross_weight_kg": float(getattr(packing_unit, "expected_gross_weight_kg", 0) or 0) if packing_unit else None,
                "gross_weight_kg": roll_gross if roll else (float(getattr(packing_unit, "gross_weight_kg", 0) or 0) if packing_unit else None),
                "gross_variance_kg": float(getattr(packing_unit, "gross_variance_kg", 0) or 0) if packing_unit else None,
                "gross_variance_pct": float(getattr(packing_unit, "gross_variance_pct", 0) or 0) if packing_unit else None,
                "gross_variance_reason": getattr(packing_unit, "gross_variance_reason", "") if packing_unit else "",
            })
        
        return Response({
            "id": str(challan.id),
            "dc_no": challan.dc_no,
            "customer_name": challan.customer_name,
            "status": challan.status,
            "vehicle_no": challan.vehicle_no,
            "driver_name": challan.driver_name,
            "driver_phone": challan.driver_phone,
            "transporter_name": challan.transporter_name,
            "lr_number": challan.lr_number,
            "e_way_bill_number": challan.e_way_bill_number,
            "dispatch_notes": challan.dispatch_notes,
            "ship_to_address_snapshot": challan.ship_to_address_snapshot or {},
            "dispatch_date": challan.dispatch_date.isoformat() if challan.dispatch_date else None,
            "received_date": challan.received_date.isoformat() if challan.received_date else None,
            "plant": challan.plant.name if challan.plant else None,
            "sales_order": _safe_sales_order_number(challan.sales_order_id),
            "items": items,
            "total_weight_kg": sum(i['weight_kg'] for i in items),
            "total_net_weight_kg": sum(float(i.get('net_product_weight_kg') or i['weight_kg'] or 0) for i in items),
            "total_gross_weight_kg": sum(float(i.get('gross_weight_kg') or i['weight_kg'] or 0) for i in items),
            "total_pcs": sum(i['qty_pcs'] or 0 for i in items)
        })

    @action(detail=True, methods=['get'], url_path='print-list')
    def print_list(self, request, pk=None):
        """Generate printable dispatch list (supports both gonnies and rolls)."""
        from .models import DeliveryChallan
        from .services.dispatch_pdf import DispatchListPDFService

        try:
            challan = DeliveryChallan.objects.select_related("plant", "sales_order").get(id=pk)
        except DeliveryChallan.DoesNotExist:
            return Response({"error": "Challan not found"}, status=status.HTTP_404_NOT_FOUND)

        try:
            pdf_buffer = DispatchListPDFService.render(challan)
        except RuntimeError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        except Exception as exc:
            return Response({"error": f"Failed to render dispatch print list: {exc}"}, status=status.HTTP_400_BAD_REQUEST)

        filename = f"{challan.dc_no}-dispatch-list.pdf"
        return FileResponse(pdf_buffer, as_attachment=False, filename=filename, content_type="application/pdf")

    @action(detail=False, methods=['get'], url_path='material-ready-slip')
    def material_ready_slip(self, request):
        """Generate a client-safe material-ready slip before challan details exist."""
        from .services.dispatch_pdf import DispatchListPDFService

        sales_order_id = request.query_params.get("sales_order_id")
        if not sales_order_id:
            return Response({"error": "sales_order_id is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            pdf_buffer = DispatchListPDFService.render_ready_slip(sales_order_id)
        except RuntimeError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        except Exception as exc:
            return Response({"error": f"Failed to render material ready slip: {exc}"}, status=status.HTTP_400_BAD_REQUEST)

        filename = f"material-ready-{sales_order_id}.pdf"
        return FileResponse(pdf_buffer, as_attachment=False, filename=filename, content_type="application/pdf")

class PlannedStockOrderViewSet(viewsets.ModelViewSet):
    queryset = PlannedStockOrder.objects.all().order_by('-created_at')
    serializer_class = PlannedStockOrderSerializer
    filterset_fields = ['status', 'plant']

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=['post'])
    def release(self, request, pk=None):
        """
        Transition Stock Order PLANNED -> RELEASED and release first pending job.
        """
        stock_order = self.get_object()
        if stock_order.status != 'PLANNED':
            return Response({"error": "Only PLANNED orders can be released"}, status=status.HTTP_400_BAD_REQUEST)
            
        try:
            with transaction.atomic():
                jobs = list(stock_order.jobs.order_by('current_step_index', 'created_at'))
                if not jobs:
                    return Response({"error": "No planned jobs found. Plan the order first."}, status=status.HTTP_400_BAD_REQUEST)

                stock_order.status = 'RELEASED'
                stock_order.save(update_fields=['status', 'updated_at'])
                
                first_job = next((j for j in jobs if j.job_state == 'PLANNED'), None) or jobs[0]
                JobService.release_job(first_job.id)
            
            return Response({
                "message": "Stock Order released",
                "jobs_count": len(jobs),
                "job_id": str(first_job.id) if jobs else None,
            })
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    # Backward-compat for older frontend clients.
    @action(detail=True, methods=['post'], url_path='create_job')
    def create_job(self, request, pk=None):
        return self.release(request, pk=pk)


class PlannedBulkStockOrderViewSet(viewsets.ModelViewSet):
    queryset = PlannedBulkStockOrder.objects.all().order_by('-created_at')
    serializer_class = PlannedBulkStockOrderSerializer
    filterset_fields = ['status', 'plant', 'bulk_class', 'material']

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class PlannerSkuViewSet(viewsets.ModelViewSet):
    serializer_class = PlannerSkuSerializer
    search_fields = ["code", "name", "template__name"]
    filterset_fields = ["active", "template", "default_plant"]

    def get_queryset(self):
        queryset = PlannerSku.objects.select_related("template", "default_plant").prefetch_related("variants").order_by("name", "code")
        template_id = str(self.request.query_params.get("template_id") or "").strip()
        active = self.request.query_params.get("active")
        if template_id:
            queryset = queryset.filter(template_id=template_id)
        if active in {"true", "false"}:
            queryset = queryset.filter(active=active == "true")
        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class PlannerSkuVariantViewSet(viewsets.ModelViewSet):
    serializer_class = PlannerSkuVariantSerializer
    search_fields = ["code", "name", "sku__code", "sku__name"]
    filterset_fields = ["active", "sku", "launch_kind", "template", "default_plant"]
    versioned_edit_fields = {
        "sku",
        "code",
        "name",
        "launch_kind",
        "template",
        "default_plant",
        "default_qty",
        "quantity_uom",
        "stock_purpose",
        "stock_strategy",
        "planner_stock_class",
        "start_step_index",
        "stop_step_index",
        "geometry_snapshot",
        "layer_snapshot",
        "printing_snapshot",
        "addons_snapshot",
        "packaging_snapshot",
        "packaging_material",
        "pod_sku_variant",
        "planner_origin_meta",
        "spec_signature",
        "invariant_signature",
    }

    def get_queryset(self):
        queryset = PlannerSkuVariant.objects.select_related(
            "sku",
            "template",
            "default_plant",
            "packaging_material",
            "pod_sku_variant",
        ).order_by("sku__name", "name", "code")
        sku_id = str(self.request.query_params.get("sku_id") or "").strip()
        launch_kind = str(self.request.query_params.get("launch_kind") or "").strip().upper()
        active = self.request.query_params.get("active")
        if sku_id:
            queryset = queryset.filter(sku_id=sku_id)
        if launch_kind:
            queryset = queryset.filter(launch_kind=launch_kind)
        if active in {"true", "false"}:
            queryset = queryset.filter(active=active == "true")
        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @staticmethod
    def _version_root(code: str) -> str:
        root = re.sub(r"[-_\s]*V\d+$", "", str(code or "").strip(), flags=re.IGNORECASE).strip("-_ ")
        return root or str(code or "PRESET").strip() or "PRESET"

    def _next_version_code(self, instance: PlannerSkuVariant, requested_code: str | None = None) -> str:
        requested = str(requested_code or "").strip().upper()
        if requested and requested != str(instance.code or "").upper():
            conflict = PlannerSkuVariant.objects.filter(code=requested).exclude(pk=instance.pk).exists()
            if not conflict:
                return requested[:64]

        root = self._version_root(instance.code).upper()
        for version in range(2, 1000):
            suffix = f"-V{version}"
            candidate = f"{root[:64 - len(suffix)]}{suffix}"
            if not PlannerSkuVariant.objects.filter(code=candidate).exists():
                return candidate
        raise ValueError("Unable to allocate the next planner variant version code.")

    @staticmethod
    def _payload_bool(value, default=True):
        if value is None:
            return default
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() not in {"0", "false", "no", "off"}

    def _versioned_update(self, request, partial=False):
        instance = self.get_object()
        changed_keys = set(request.data.keys())
        if changed_keys and changed_keys <= {"active"}:
            return super().update(request, partial=partial)

        incoming = request.data.copy()
        with transaction.atomic():
            instance.active = False
            instance.save(update_fields=["active", "updated_at"])

            payload = {
                "sku": str(instance.sku_id),
                "code": self._next_version_code(instance, incoming.get("code")),
                "name": instance.name,
                "active": True,
                "launch_kind": instance.launch_kind,
                "template": str(instance.template_id) if instance.template_id else None,
                "default_plant": str(instance.default_plant_id) if instance.default_plant_id else None,
                "default_qty": instance.default_qty,
                "quantity_uom": instance.quantity_uom,
                "stock_purpose": instance.stock_purpose,
                "stock_strategy": instance.stock_strategy,
                "planner_stock_class": instance.planner_stock_class,
                "start_step_index": instance.start_step_index,
                "stop_step_index": instance.stop_step_index,
                "geometry_snapshot": instance.geometry_snapshot,
                "layer_snapshot": instance.layer_snapshot,
                "printing_snapshot": instance.printing_snapshot,
                "addons_snapshot": instance.addons_snapshot,
                "packaging_snapshot": instance.packaging_snapshot,
                "packaging_material": str(instance.packaging_material_id) if instance.packaging_material_id else None,
                "pod_sku_variant": str(instance.pod_sku_variant_id) if instance.pod_sku_variant_id else None,
                "planner_origin_meta": {
                    **(instance.planner_origin_meta or {}),
                    "supersedes_variant_id": str(instance.id),
                    "supersedes_variant_code": str(instance.code or ""),
                },
                "spec_signature": instance.spec_signature,
                "invariant_signature": instance.invariant_signature,
            }
            for field in self.versioned_edit_fields:
                if field in incoming and field != "code":
                    payload[field] = incoming.get(field)
            payload["active"] = self._payload_bool(incoming.get("active"), True)
            payload["planner_origin_meta"] = {
                **(payload.get("planner_origin_meta") or {}),
                "supersedes_variant_id": str(instance.id),
                "supersedes_variant_code": str(instance.code or ""),
            }

            serializer = self.get_serializer(data=payload)
            serializer.is_valid(raise_exception=True)
            self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def update(self, request, *args, **kwargs):
        return self._versioned_update(request, partial=kwargs.pop("partial", False))

    def partial_update(self, request, *args, **kwargs):
        return self._versioned_update(request, partial=True)


class ExecutionViewSet(viewsets.ViewSet):
    """
    Phase 68: Universal Flow Engine API.
    Provides endpoints for WIP pool, satisfaction status, and auto-satisfy.
    """

    def _serialize_current_step_policy(self, job):
        current_step_sequence = int(getattr(job, "current_step_index", 0) or 0) + 1
        bom_snapshot = ExecutionService._job_bom_snapshot(job) or {}
        planning_lines = bom_snapshot.get("planning_lines") if isinstance(bom_snapshot, dict) else []
        items = ExecutionService.current_step_requirement_policy_items(job)
        if items:
            return {
                "job_id": str(job.id),
                "current_step_sequence": current_step_sequence,
                "current_process_name": getattr(getattr(job, "current_process", None), "name", None),
                "items": items,
            }
        items = []
        for row in planning_lines if isinstance(planning_lines, list) else []:
            if not isinstance(row, dict):
                continue
            if int(row.get("step_sequence") or 0) != current_step_sequence:
                continue
            if str(row.get("category_code") or "").strip().upper() in {"INK", "INKS"}:
                continue
            items.append(
                {
                    "policy_key": str(row.get("policy_key") or ""),
                    "material_name": str(row.get("material_name") or row.get("material_code") or "Material"),
                    "material_code": str(row.get("material_code") or ""),
                    "category_code": str(row.get("category_code") or ""),
                    "step_sequence": int(row.get("step_sequence") or current_step_sequence),
                    "step_name": str(row.get("step_name") or getattr(getattr(job, "current_process", None), "name", "") or ""),
                    "theoretical_qty": float(row.get("theoretical_qty") or 0),
                    "planned_issue_qty": float(row.get("planned_issue_qty") or 0),
                    "template_issue_policy_mode": str(row.get("template_issue_policy_mode") or "NONE"),
                    "template_issue_policy_value": float(row.get("template_issue_policy_value") or 0),
                    "effective_issue_policy_mode": str(row.get("effective_issue_policy_mode") or row.get("template_issue_policy_mode") or "NONE"),
                    "effective_issue_policy_value": float(row.get("effective_issue_policy_value") or row.get("template_issue_policy_value") or 0),
                    "policy_source": str(row.get("policy_source") or "TEMPLATE_DEFAULT"),
                    "override_reason": str(row.get("override_reason") or ""),
                }
            )
        return {
            "job_id": str(job.id),
            "current_step_sequence": current_step_sequence,
            "current_process_name": getattr(getattr(job, "current_process", None), "name", None),
            "items": items,
        }

    def _normalize_current_step_overrides(self, raw_rows):
        normalized = []
        for row in raw_rows if isinstance(raw_rows, list) else []:
            if not isinstance(row, dict):
                continue
            policy_key = str(row.get("policy_key") or "").strip()
            if not policy_key:
                continue
            mode = str(row.get("issue_policy_mode") or "NONE").strip().upper()
            if mode not in {"NONE", "PERCENT_OVER_THEORY", "FIXED_EXTRA_KG", "MINIMUM_ISSUE_KG"}:
                mode = "NONE"
            if mode == "NONE":
                continue
            try:
                value = float(row.get("issue_policy_value") or 0)
            except Exception:
                raise ValidationError("Issue policy value must be a valid number.")
            if value < 0:
                raise ValidationError("Issue policy value must be zero or positive.")
            reason = str(row.get("reason") or "").strip()
            if not reason:
                raise ValidationError("Reason is required before saving a WCM material policy override.")
            normalized.append(
                {
                    "policy_key": policy_key,
                    "issue_policy_mode": mode,
                    "issue_policy_value": value,
                    "reason": reason,
                }
            )
        return normalized

    def _policy_audit_brief(self, item):
        return {
            "mode": str(item.get("effective_issue_policy_mode") or "NONE"),
            "value": float(item.get("effective_issue_policy_value") or 0),
            "planned_issue_qty": float(item.get("planned_issue_qty") or 0),
            "source": str(item.get("policy_source") or "TEMPLATE_DEFAULT"),
            "reason": str(item.get("override_reason") or ""),
        }

    def _policy_audit_snapshot(self, policy_payload):
        rows = []
        for item in policy_payload.get("items") or []:
            rows.append({
                "policy_key": str(item.get("policy_key") or ""),
                "material_name": str(item.get("material_name") or "Material"),
                "category_code": str(item.get("category_code") or ""),
                "theoretical_qty": float(item.get("theoretical_qty") or 0),
                "template": {
                    "mode": str(item.get("template_issue_policy_mode") or "NONE"),
                    "value": float(item.get("template_issue_policy_value") or 0),
                },
                "effective": self._policy_audit_brief(item),
            })
        return rows

    def _policy_changed_rows(self, before_items, after_items):
        before_by_key = {str(item.get("policy_key") or ""): item for item in before_items if item.get("policy_key")}
        changed = []
        for after_item in after_items:
            policy_key = str(after_item.get("policy_key") or "")
            if not policy_key:
                continue
            before_item = before_by_key.get(policy_key, {})
            before_brief = self._policy_audit_brief(before_item)
            after_brief = self._policy_audit_brief(after_item)
            if before_brief == after_brief:
                continue
            changed.append({
                "policy_key": policy_key,
                "material_name": str(after_item.get("material_name") or before_item.get("material_name") or "Material"),
                "category_code": str(after_item.get("category_code") or before_item.get("category_code") or ""),
                "before": before_brief,
                "after": after_brief,
            })
        return changed

    def _write_current_step_policy_audit(self, job, before_policy, after_policy, changed_rows, user):
        assignment = (
            WorkCenterAssignment.objects
            .filter(production_job=job)
            .select_related("work_center", "assigned_machine")
            .order_by("-updated_at")
            .first()
        )
        work_center = getattr(assignment, "work_center", None) or getattr(job, "work_center", None)
        if not work_center:
            return None
        materials = ", ".join(row["material_name"] for row in changed_rows[:3]) or "current step materials"
        reasons = [str(row.get("after", {}).get("reason") or "").strip() for row in changed_rows]
        reasons = [reason for reason in dict.fromkeys(reasons) if reason]
        reason_text = "; ".join(reasons)
        summary = f"Material issue policy updated for {materials}"
        if reason_text:
            summary = f"{summary}. Reason: {reason_text}"
        return ProductionWcmAuditEvent.objects.create(
            production_job=job,
            work_center=work_center,
            assignment=assignment,
            machine=getattr(assignment, "assigned_machine", None) or getattr(job, "machine", None),
            action="MATERIAL_POLICY_OVERRIDE",
            actor=user if getattr(user, "is_authenticated", False) else None,
            reason=summary,
            before_status=getattr(assignment, "status", "") if assignment else str(getattr(job, "status", "") or ""),
            after_status=getattr(assignment, "status", "") if assignment else str(getattr(job, "status", "") or ""),
            payload={
                "summary": summary,
                "job_id": str(job.id),
                "job_number": str(getattr(job, "job_number", "") or ""),
                "work_center_id": str(getattr(work_center, "id", "") or ""),
                "work_center_name": str(getattr(work_center, "name", "") or ""),
                "step_sequence": int(after_policy.get("current_step_sequence") or before_policy.get("current_step_sequence") or 0),
                "process_name": str(after_policy.get("current_process_name") or before_policy.get("current_process_name") or ""),
                "changed_rows": changed_rows,
                "before": self._policy_audit_snapshot(before_policy),
                "after": self._policy_audit_snapshot(after_policy),
            },
        )
    
    @action(detail=True, methods=['get'], url_path='wip-pool')
    def wip_pool(self, request, pk=None):
        """Get WIP pool for a job (flat list)."""
        try:
            pool = ExecutionService.get_wip_pool(pk)
            return Response([{
                'id': str(roll.id),
                'label_id': roll.label_id,
                'material_name': roll.material.name if roll.material else 'N/A',
                'weight_kg': float(roll.weight_kg),
                'status': roll.status
            } for roll in pool])
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=True, methods=['get'], url_path='wip-pool-grouped')
    def wip_pool_grouped(self, request, pk=None):
        """Get WIP pool grouped by material family."""
        try:
            grouped = ExecutionService.get_wip_pool_grouped(pk)
            return Response(grouped)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=True, methods=['get'], url_path='satisfaction')
    def satisfaction_status(self, request, pk=None):
        """Get input satisfaction status for UI."""
        try:
            status_data = ExecutionService.get_satisfaction_status(pk)
            return Response(status_data)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=True, methods=['post'], url_path='auto-satisfy')
    def auto_satisfy(self, request, pk=None):
        """Attempt to auto-assign WIP pool to job requirements."""
        try:
            result = ExecutionService.auto_satisfy_inputs(pk, request.user)
            return Response(result)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=True, methods=['get'], url_path='context')
    def job_context(self, request, pk=None):
        """Get full job execution context."""
        try:
            context = ExecutionService.get_job_context(pk)
            return Response(context)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['get', 'post'], url_path='current-step-material-policy')
    def current_step_material_policy(self, request, pk=None):
        try:
            job = ProductionJob.objects.select_related("current_process").get(id=pk)
        except ProductionJob.DoesNotExist:
            return Response({"error": "Job not found"}, status=status.HTTP_404_NOT_FOUND)

        if request.method.lower() == "get":
            return Response(self._serialize_current_step_policy(job))

        try:
            overrides = self._normalize_current_step_overrides(request.data.get("overrides") or [])
        except ValidationError as exc:
            message = exc.messages[0] if getattr(exc, "messages", None) else str(exc)
            return Response({"error": message}, status=status.HTTP_400_BAD_REQUEST)

        before_policy = self._serialize_current_step_policy(job)
        before_items = before_policy.get("items") or []
        job.current_step_issue_policy_overrides = overrides
        job.save(update_fields=["current_step_issue_policy_overrides", "updated_at"])
        ExecutionService.sync_current_step_issue_policy_plan(job)
        job.refresh_from_db()
        after_policy = self._serialize_current_step_policy(job)
        changed_rows = self._policy_changed_rows(before_items, after_policy.get("items") or [])
        if changed_rows:
            self._write_current_step_policy_audit(job, before_policy, after_policy, changed_rows, request.user)
        return Response(after_policy)

    @action(detail=True, methods=['post'], url_path='unassign')
    def unassign(self, request, pk=None):
        """Unassign a roll from a job (release reservation)."""
        reservation_id = request.data.get('reservation_id')
        if not reservation_id:
             return Response({"error": "reservation_id is required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            context = ExecutionService.unassign_roll(pk, reservation_id)
            return Response(context)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def current_shift(request):
    """Return the active company-wide shift window based on CompanyProfile.shift_boundaries."""
    from apps.production.services.shift_inference import shift_window_for

    timestamp = None
    raw_at = request.query_params.get("at")
    if raw_at:
        timestamp = parse_datetime(str(raw_at))
        if timestamp is None:
            return Response({"detail": "Use ISO datetime format for at."}, status=400)
        if timezone.is_naive(timestamp):
            timestamp = timezone.make_aware(timestamp, timezone.get_current_timezone())
    payload = shift_window_for(timestamp)
    return Response({
        "shift_code": payload.get("shift_code") or "",
        "started_at": payload.get("started_at").isoformat() if payload.get("started_at") else None,
        "ends_at": payload.get("ends_at").isoformat() if payload.get("ends_at") else None,
    })
