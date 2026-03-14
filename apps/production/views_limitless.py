from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from apps.production.models import ProductionJob
from apps.production.services.services_execution import ExecutionService
from apps.production.services.job_services import JobService

class WCMExecutionViewSet(viewsets.ViewSet):
    """
    Phase 64B: WCM Execution API
    Handling Context, Roll Assignment, Start/Stop logic.
    """

    @action(detail=True, methods=['get'], url_path='execution-context')
    def execution_context(self, request, pk=None):
        try:
            context = ExecutionService.get_job_context(pk)
            return Response(context)
        except ProductionJob.DoesNotExist:
            return Response({'error': 'Job not found'}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='assign-rolls')
    def assign_rolls(self, request, pk=None):
        roll_id = request.data.get('roll_id')
        manual_override = bool(request.data.get('manual_override', False))
        override_reason = request.data.get('override_reason')
        if not roll_id:
            return Response({'error': 'roll_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            context = ExecutionService.assign_roll_to_job(
                pk,
                roll_id,
                user=request.user,
                manual_override=manual_override,
                override_reason=override_reason,
            )
            return Response(context)
        except Exception as e:
             return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='unassign-roll')
    def unassign_roll(self, request, pk=None):
        reservation_id = request.data.get('reservation_id')
        if not reservation_id:
            return Response({'error': 'reservation_id is required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
             context = ExecutionService.unassign_roll(pk, reservation_id)
             return Response(context)
        except Exception as e:
             return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='start')
    def start_job(self, request, pk=None):
        try:
            job = ProductionJob.objects.get(id=pk)
            JobService.start_job(job)
            # Return updated context
            return Response(ExecutionService.get_job_context(pk))
        except Exception as e:
             return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='complete')
    def complete_job(self, request, pk=None):
        actual_qty = request.data.get('actual_qty')
        if actual_qty is None:
             return Response({'error': 'actual_qty is required'}, status=status.HTTP_400_BAD_REQUEST)
             
        try:
            job = ProductionJob.objects.get(id=pk)
            # Use safe Decimal conversion
            from decimal import Decimal
            qty = Decimal(str(actual_qty))
            
            JobService.complete_job(job, qty, user=request.user)
            return Response(ExecutionService.get_job_context(pk))
        except Exception as e:
             return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
