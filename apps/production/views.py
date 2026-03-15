from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import transaction
from django.http import FileResponse
from django.db import connection
from .models import ProductionJob, WorkCenterAssignment
from .serializers import (
    ProductionJobSerializer, JobAssignmentSerializer, JobCompletionSerializer,
    WorkCenterAssignmentSerializer, PlannedStockOrderSerializer
)
from .models import PlannedStockOrder
from .services import JobService, WCManagerService, OperatorService
from .services.services_execution import ExecutionService


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
        
        # Determine user's role and assigned machines
        user = request.user
        role_code = getattr(user, 'effective_role_code', user.role.code if user.role else 'GUEST')
        is_admin = role_code in ['ADMIN', 'SUPER_ADMIN', 'OWNER'] or user.is_owner or user.is_superuser
        
        # Get user's assigned machine IDs
        from apps.users.models import MachineAssignment
        user_machine_ids = list(MachineAssignment.objects.filter(user=user).values_list('machine_id', flat=True))
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
                "split_outputs": request.data.get('split_outputs'),
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
    def batches(self, request):
        """Get available FG batches for packing."""
        from .models import FinishedGoodsBatch
        from django.db.models import Sum
        
        plant_id = request.query_params.get('plant_id')
        
        qs = FinishedGoodsBatch.objects.filter(
            status='AVAILABLE',
            sales_order_item__isnull=False,
        ).select_related('template', 'location', 'production_job', 'sales_order_item__sales_order')
        
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
                "gross_weight_kg": float(gonny.gross_weight_kg or 0) if gonny.gross_weight_kg is not None else None,
                "tare_breakdown_json": gonny.tare_breakdown_json or {},
                "status": gonny.status,
                "message": f"Gonny {gonny.label_id} created with {gonny.qty_pcs} pcs"
            }, status=status.HTTP_201_CREATED)
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=True, methods=['post'])
    def seal(self, request, pk=None):
        """Seal a packing unit with final weight."""
        from .services.packing_service import PackingService
        
        weight_kg = request.data.get('weight_kg')
        extras = request.data.get('extras') if 'extras' in request.data else None
        
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
            )
            return Response({
                "id": str(gonny.id),
                "label_id": gonny.label_id,
                "weight_kg": float(gonny.weight_kg),
                "net_product_weight_kg": float(gonny.net_product_weight_kg or 0),
                "inner_pack_tare_kg": float(gonny.inner_pack_tare_kg or 0),
                "secondary_pack_tare_kg": float(gonny.secondary_pack_tare_kg or 0),
                "extras_tare_kg": float(gonny.extras_tare_kg or 0),
                "gross_weight_kg": float(gonny.gross_weight_kg or 0),
                "tare_breakdown_json": gonny.tare_breakdown_json or {},
                "content_mode": gonny.content_mode,
                "primary_pack_count": gonny.primary_pack_count,
                "status": gonny.status,
                "message": f"Gonny {gonny.label_id} sealed at {weight_kg} kg"
            })
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=False, methods=['get'])
    def gonnies(self, request):
        """List all gonnies with optional filters."""
        from .models import PackingUnit
        
        plant_id = request.query_params.get('plant_id')
        status_filter = request.query_params.get('status')
        
        qs = PackingUnit.objects.select_related('fg_batch', 'location')
        qs = qs.filter(sales_order_item__isnull=False)
        
        if plant_id:
            qs = qs.filter(location__plant_id=plant_id)
        
        if status_filter:
            qs = qs.filter(status=status_filter)
        
        data = []
        for gonny in qs.select_related('location__plant', 'fg_batch'):
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
                    'gross_weight_kg': float(gonny.gross_weight_kg or 0) if gonny.gross_weight_kg is not None else None,
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


class DeliveryChallanViewSet(viewsets.ViewSet):
    """
    API for Delivery Challan management.
    """
    queryset = ProductionJob.objects.none() # Dummy for DRF consistency
    
    @action(detail=False, methods=['get'])
    def so_with_fg(self, request):
        """List Sales Orders that have goods ready for dispatch."""
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
        for item in challan.items.select_related('roll', 'packing_unit', 'fg_batch'):
            packing_unit = item.packing_unit
            items.append({
                "id": str(item.id),
                "type": "roll" if item.roll else ("gonny" if item.packing_unit else "batch"),
                "label": item.roll.label_id if item.roll else (item.packing_unit.label_id if item.packing_unit else (item.fg_batch.batch_number if item.fg_batch else "N/A")),
                "batch_no": item.roll.batch_no if item.roll else (item.fg_batch.batch_number if item.fg_batch else None),
                "weight_kg": float(item.weight_kg),
                "qty_pcs": item.qty_pcs,
                "content_mode": packing_unit.content_mode if packing_unit else None,
                "primary_pack_count": packing_unit.primary_pack_count if packing_unit else None,
                "net_product_weight_kg": float(getattr(packing_unit, "net_product_weight_kg", 0) or 0) if packing_unit else None,
                "inner_pack_tare_kg": float(getattr(packing_unit, "inner_pack_tare_kg", 0) or 0) if packing_unit else None,
                "secondary_pack_tare_kg": float(getattr(packing_unit, "secondary_pack_tare_kg", 0) or 0) if packing_unit else None,
                "extras_tare_kg": float(getattr(packing_unit, "extras_tare_kg", 0) or 0) if packing_unit else None,
                "gross_weight_kg": float(getattr(packing_unit, "gross_weight_kg", 0) or 0) if packing_unit else None,
            })
        
        return Response({
            "id": str(challan.id),
            "dc_no": challan.dc_no,
            "customer_name": challan.customer_name,
            "status": challan.status,
            "vehicle_no": challan.vehicle_no,
            "driver_name": challan.driver_name,
            "driver_phone": challan.driver_phone,
            "dispatch_date": challan.dispatch_date.isoformat() if challan.dispatch_date else None,
            "received_date": challan.received_date.isoformat() if challan.received_date else None,
            "plant": challan.plant.name if challan.plant else None,
            "sales_order": _safe_sales_order_number(challan.sales_order_id),
            "items": items,
            "total_weight_kg": sum(i['weight_kg'] for i in items),
            "total_net_weight_kg": sum(float(i.get('net_product_weight_kg') or 0) for i in items if i.get("type") == "gonny") + sum(float(i['weight_kg']) for i in items if i.get("type") == "roll"),
            "total_gross_weight_kg": sum(float(i.get('gross_weight_kg') or i['weight_kg'] or 0) for i in items),
            "total_pcs": sum(i['qty_pcs'] or 0 for i in items)
        })

    @action(detail=True, methods=['get'], url_path='print-list')
    def print_list(self, request, pk=None):
        """Generate printable dispatch list (supports both gonnies and rolls)."""
        from .models import DeliveryChallan
        from .services.dispatch_pdf import DispatchListPDFService

        try:
            challan = DeliveryChallan.objects.select_related("plant").get(id=pk)
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


class ExecutionViewSet(viewsets.ViewSet):
    """
    Phase 68: Universal Flow Engine API.
    Provides endpoints for WIP pool, satisfaction status, and auto-satisfy.
    """

    def _serialize_current_step_policy(self, job):
        current_step_sequence = int(getattr(job, "current_step_index", 0) or 0) + 1
        bom_snapshot = ExecutionService._job_bom_snapshot(job) or {}
        planning_lines = bom_snapshot.get("planning_lines") if isinstance(bom_snapshot, dict) else []
        items = []
        for row in planning_lines if isinstance(planning_lines, list) else []:
            if not isinstance(row, dict):
                continue
            if int(row.get("step_sequence") or 0) != current_step_sequence:
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
            try:
                value = float(row.get("issue_policy_value") or 0)
            except Exception:
                value = 0.0
            normalized.append(
                {
                    "policy_key": policy_key,
                    "issue_policy_mode": mode,
                    "issue_policy_value": value,
                    "reason": str(row.get("reason") or "").strip(),
                }
            )
        return normalized
    
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

        job.current_step_issue_policy_overrides = self._normalize_current_step_overrides(
            request.data.get("overrides") or []
        )
        job.save(update_fields=["current_step_issue_policy_overrides", "updated_at"])
        return Response(self._serialize_current_step_policy(job))

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
