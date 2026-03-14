"""
Machine Terminal API - Machine-Centric Execution

This module provides the API endpoints for the Machine Terminal UI.
Jobs belong to machines. Operators control machines.
"""
import logging
from collections import defaultdict
from decimal import Decimal

from django.conf import settings
from django.db.models import Case, IntegerField, Sum, Value, When
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.utils.dateparse import parse_date

from apps.factory.models import Machine
from apps.production.models import ProductionJob, JobExecutionLog, ScrapLog
from apps.production.serializers import ProductionJobSerializer
from apps.production.services import OperatorService
from apps.production.services.services_execution import ExecutionService

logger = logging.getLogger(__name__)


def _is_admin_machine_actor(user) -> bool:
    if not user or not getattr(user, "is_authenticated", False):
        return False
    effective_role = str(getattr(user, "effective_role_code", "") or "").upper()
    primary_role = str(getattr(getattr(user, "role", None), "code", "") or "").upper()
    admin_roles = {"ADMIN", "SUPER_ADMIN", "OWNER"}
    return bool(
        user.is_superuser
        or user.is_owner
        or primary_role in admin_roles
        or (effective_role in admin_roles and bool(getattr(settings, "ALLOW_ROLE_OVERRIDE", False)))
    )


def _ensure_machine_scope(user, machine_id) -> bool:
    if _is_admin_machine_actor(user):
        return True
    from apps.users.models import MachineAssignment

    return MachineAssignment.objects.filter(user=user, machine_id=machine_id).exists()


def _scope_denied(machine_id):
    return Response(
        {
            "error": {
                "code": "MACHINE_SCOPE_DENIED",
                "message": "You are not assigned to this machine.",
                "machine_id": str(machine_id),
            }
        },
        status=status.HTTP_403_FORBIDDEN,
    )


# ==============================================================================
# Machine Detail & Queue
# ==============================================================================

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def machine_detail(request, machine_id):
    """
    Get machine details with current job and operator.
    Route: GET /api/production/machine/<machine_id>/
    """
    try:
        machine = Machine.objects.select_related(
            'work_center', 'work_center__plant', 'assigned_operator'
        ).get(id=machine_id)
    except Machine.DoesNotExist:
        return Response({"error": "Machine not found"}, status=status.HTTP_404_NOT_FOUND)
    
    # Get current executing job
    current_job = ProductionJob.objects.filter(
        machine=machine, 
        job_state='EXECUTING'
    ).select_related('template', 'current_process').first()
    
    # Queue count (released or paused jobs)
    queue_count = ProductionJob.objects.filter(
        machine=machine, 
        job_state__in=['RELEASED', 'PAUSED']
    ).count()
    
    return Response({
        'machine': {
            'id': str(machine.id),
            'code': machine.code,
            'name': machine.name,
            'status': machine.status,
            'work_center_id': str(machine.work_center_id),
            'work_center_name': machine.work_center.name,
            'plant_id': str(machine.work_center.plant_id),
            'plant_name': machine.work_center.plant.name,
        },
        'operator': {
            'id': str(machine.assigned_operator.id),
            'username': machine.assigned_operator.username,
            'name': machine.assigned_operator.get_full_name() or machine.assigned_operator.username,
        } if machine.assigned_operator else None,
        'current_job': ProductionJobSerializer(current_job).data if current_job else None,
        'queue_count': queue_count,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def machine_queue(request, machine_id):
    """
    Get jobs queued on a specific machine.
    Route: GET /api/production/machine/<machine_id>/queue/
    """
    try:
        machine = Machine.objects.get(id=machine_id)
    except Machine.DoesNotExist:
        return Response({"error": "Machine not found"}, status=status.HTTP_404_NOT_FOUND)
    
    jobs = ProductionJob.objects.filter(
        machine=machine,
        job_state__in=['RELEASED', 'EXECUTING', 'PAUSED']
    ).select_related(
        'template', 'current_process', 'sales_order_item__sales_order'
    ).order_by(
        Case(
            When(job_state="EXECUTING", then=Value(0)),
            When(job_state="PAUSED", then=Value(1)),
            When(job_state="RELEASED", then=Value(2)),
            default=Value(99),
            output_field=IntegerField(),
        ),
        'priority', 
        'created_at'
    )
    
    payload = ProductionJobSerializer(jobs, many=True).data
    for row in payload:
        row["execution_model_version"] = 2
        try:
            profile = ExecutionService.get_step_execution_profile(str(row.get("id")))
        except Exception:
            profile = {}
        step_target_kg = Decimal(str(profile.get("step_target_total_kg") or 0))
        row["step_target_kg"] = float(step_target_kg)
        row["step_target_source"] = profile.get("target_source")
        row["step_target_pcs"] = profile.get("step_target_pcs")
        row["step_produced_kg"] = float(profile.get("step_produced_kg") or 0)
        row["step_remaining_kg"] = float(profile.get("step_remaining_kg") or 0)
        try:
            order_reference_target_kg = Decimal(str(ExecutionService.get_order_reference_target_kg(str(row.get("id"))) or 0))
        except Exception:
            order_reference_target_kg = Decimal("0")
        raw_total_kg = Decimal(str(row.get("total_weight_kg") or 0))
        stable_order_reference = order_reference_target_kg if order_reference_target_kg > 0 else max(raw_total_kg, Decimal("0"))
        row["order_reference_target_kg"] = float(stable_order_reference)
        row["order_target_source"] = "V2_ORDER_REFERENCE"
        row["step_adjusted_total_kg"] = float(step_target_kg if step_target_kg > 0 else Decimal("0"))
    return Response(payload)


# ==============================================================================
# Machine Execution Actions
# ==============================================================================

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def machine_start_job(request, machine_id, job_id):
    """
    Start a job on this machine.
    Route: POST /api/production/machine/<machine_id>/jobs/<job_id>/start/
    """
    try:
        machine = Machine.objects.get(id=machine_id)
    except Machine.DoesNotExist:
        return Response({"error": "Machine not found"}, status=status.HTTP_404_NOT_FOUND)
    if not _ensure_machine_scope(request.user, machine.id):
        return _scope_denied(machine.id)
    try:
        ProductionJob.objects.get(id=job_id, machine=machine)
    except ProductionJob.DoesNotExist:
        return Response({"error": "Job not found on this machine"}, status=status.HTTP_404_NOT_FOUND)
    
    try:
        job = OperatorService.start_job(job_id, request.user)
        return Response(ProductionJobSerializer(job).data)
    except Exception:
        logger.exception("Machine start failed machine_id=%s job_id=%s", machine_id, job_id)
        return Response(
            {"error": {"code": "MACHINE_START_FAILED", "message": "Unable to start job."}},
            status=status.HTTP_400_BAD_REQUEST,
        )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def machine_stop_job(request, machine_id, job_id):
    """
    Stop/pause a job on this machine.
    Route: POST /api/production/machine/<machine_id>/jobs/<job_id>/stop/
    """
    try:
        machine = Machine.objects.get(id=machine_id)
    except Machine.DoesNotExist:
        return Response({"error": "Machine not found"}, status=status.HTTP_404_NOT_FOUND)
    if not _ensure_machine_scope(request.user, machine.id):
        return _scope_denied(machine.id)
    try:
        ProductionJob.objects.get(id=job_id, machine=machine)
    except ProductionJob.DoesNotExist:
        return Response({"error": "Job not found on this machine"}, status=status.HTTP_404_NOT_FOUND)
    
    reason = request.data.get('reason', 'Operator Stop')
    
    try:
        job = OperatorService.pause_job(job_id, reason, request.user)
        return Response(ProductionJobSerializer(job).data)
    except Exception:
        logger.exception("Machine stop failed machine_id=%s job_id=%s", machine_id, job_id)
        return Response(
            {"error": {"code": "MACHINE_STOP_FAILED", "message": "Unable to stop job."}},
            status=status.HTTP_400_BAD_REQUEST,
        )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def machine_log_output(request, machine_id, job_id):
    """
    Log machine output for current step (step remains open until explicit complete).
    Route: POST /api/production/machine/<machine_id>/jobs/<job_id>/log-output/
    
    Payload varies by roll_behavior:
    - CREATE_NEW: { actual_qty, output_width_mm, output_length_m?, scrap_qty? }
    - MODIFY_EXISTING: { actual_qty, scrap_qty? }
    - MULTI_INPUT_COMBINE: { actual_qty, scrap_qty? }
    - SPLIT: { split_outputs: [{width_mm, weight_kg}], scrap_qty? }
    """
    try:
        machine = Machine.objects.get(id=machine_id)
    except Machine.DoesNotExist:
        return Response({"error": "Machine not found"}, status=status.HTTP_404_NOT_FOUND)
    if not _ensure_machine_scope(request.user, machine.id):
        return _scope_denied(machine.id)
    try:
        job = ProductionJob.objects.get(id=job_id, machine=machine)
    except ProductionJob.DoesNotExist:
        return Response({"error": "Job not found on this machine"}, status=status.HTTP_404_NOT_FOUND)
    
    actual_qty = request.data.get('actual_qty')
    if actual_qty is None:
        split_outputs = request.data.get('split_outputs') or []
        if isinstance(split_outputs, list) and split_outputs:
            try:
                actual_qty = sum(float(item.get('weight_kg') or 0) for item in split_outputs)
            except Exception:
                actual_qty = None
    if actual_qty is None:
        output_pcs = request.data.get('output_pcs')
        if output_pcs not in (None, ""):
            try:
                pcs_val = Decimal(str(output_pcs))
                unit_weight_g = Decimal(
                    str(
                        getattr(
                            getattr(job, "sales_order_item", None),
                            "unit_weight_g",
                            0,
                        )
                        or 0
                    )
                )
                if pcs_val > 0 and unit_weight_g > 0:
                    actual_qty = float((pcs_val * unit_weight_g) / Decimal("1000"))
            except Exception:
                actual_qty = None
    if actual_qty is None:
        return Response({"error": "actual_qty is required"}, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        payload = {
            "scrap_qty": request.data.get('scrap_qty'),
            "output_width_mm": request.data.get('output_width_mm'),
            "output_length_m": request.data.get('output_length_m'),
            "output_pcs": request.data.get('output_pcs'),
            "split_outputs": request.data.get('split_outputs'),
            "remainder_location_id": request.data.get('remainder_location_id'),
        }
        job = OperatorService.log_output_step(job_id, float(actual_qty), request.user, **payload)
        return Response(ProductionJobSerializer(job).data)
    except Exception:
        logger.exception("Machine log-output failed machine_id=%s job_id=%s", machine_id, job_id)
        return Response(
            {"error": {"code": "MACHINE_LOG_OUTPUT_FAILED", "message": "Unable to record output."}},
            status=status.HTTP_400_BAD_REQUEST,
        )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def machine_complete_job(request, machine_id, job_id):
    """
    Complete/close current step for a job on this machine.
    Route: POST /api/production/machine/<machine_id>/jobs/<job_id>/complete/
    Close-only: requires remaining quantity to be zero (within epsilon).
    """
    try:
        machine = Machine.objects.get(id=machine_id)
    except Machine.DoesNotExist:
        return Response({"error": "Machine not found"}, status=status.HTTP_404_NOT_FOUND)
    if not _ensure_machine_scope(request.user, machine.id):
        return _scope_denied(machine.id)
    try:
        ProductionJob.objects.get(id=job_id, machine=machine)
    except ProductionJob.DoesNotExist:
        return Response({"error": "Job not found on this machine"}, status=status.HTTP_404_NOT_FOUND)

    if request.data and any(k in request.data for k in ["actual_qty", "output_width_mm", "output_length_m", "split_outputs"]):
        return Response(
            {"error": "Use /log-output/ for output entry. /complete/ is close-only."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        force_reason = (request.data.get("force_reason") or "").strip() if request.data else ""
        material_confirmations = request.data.get("material_confirmations") if request.data else None
        job = OperatorService.complete_step(
            job_id,
            request.user,
            force_reason=force_reason or None,
            material_confirmations=material_confirmations,
            require_material_confirmations=True,
        )
        response_data = ProductionJobSerializer(job).data
        response_data["completion_mode"] = getattr(job, "_completion_mode", "NORMAL")
        response_data["variance_kg"] = getattr(job, "_completion_variance_kg", 0.0)
        response_data["force_reason"] = getattr(job, "_completion_force_reason", None)
        interplant_dc = getattr(job, "_interplant_dc", None)
        if interplant_dc:
            response_data["interplant_dc"] = {
                "id": str(interplant_dc.id),
                "dc_no": interplant_dc.dc_no,
                "print_pdf_url": f"/api/inventory/inter-plant/{interplant_dc.id}/print-pdf/",
            }
        return Response(response_data)
    except Exception:
        logger.exception("Machine complete failed machine_id=%s job_id=%s", machine_id, job_id)
        return Response(
            {"error": {"code": "MACHINE_COMPLETE_FAILED", "message": "Unable to complete job step."}},
            status=status.HTTP_400_BAD_REQUEST,
        )


# ==============================================================================
# Machine Context & Satisfaction
# ==============================================================================

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def machine_job_context(request, machine_id, job_id):
    """
    Get full job execution context for machine terminal.
    Route: GET /api/production/machine/<machine_id>/jobs/<job_id>/context/
    """
    try:
        machine = Machine.objects.get(id=machine_id)
        job = ProductionJob.objects.get(id=job_id, machine=machine)
    except Machine.DoesNotExist:
        return Response({"error": "Machine not found"}, status=status.HTTP_404_NOT_FOUND)
    except ProductionJob.DoesNotExist:
        return Response({"error": "Job not found on this machine"}, status=status.HTTP_404_NOT_FOUND)
    
    try:
        context = ExecutionService.get_job_context(job_id)
        return Response(context)
    except Exception as e:
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def machine_job_satisfaction(request, machine_id, job_id):
    """
    Get input satisfaction status for a job on this machine.
    Route: GET /api/production/machine/<machine_id>/jobs/<job_id>/satisfaction/
    """
    try:
        machine = Machine.objects.get(id=machine_id)
        job = ProductionJob.objects.get(id=job_id, machine=machine)
    except Machine.DoesNotExist:
        return Response({"error": "Machine not found"}, status=status.HTTP_404_NOT_FOUND)
    except ProductionJob.DoesNotExist:
        return Response({"error": "Job not found on this machine"}, status=status.HTTP_404_NOT_FOUND)
    
    try:
        status_data = ExecutionService.get_satisfaction_status(job_id)
        return Response(status_data)
    except Exception as e:
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def machine_history(request, machine_id):
    """
    Machine history with Date + Status filters.
    Route: GET /api/production/machine/<machine_id>/history/
    Query:
      - date_from=YYYY-MM-DD
      - date_to=YYYY-MM-DD
      - status=ALL|NORMAL|FORCED_VARIANCE
    """
    try:
        machine = Machine.objects.select_related('work_center', 'work_center__plant').get(id=machine_id)
    except Machine.DoesNotExist:
        return Response({"error": "Machine not found"}, status=status.HTTP_404_NOT_FOUND)

    date_from_raw = request.query_params.get("date_from")
    date_to_raw = request.query_params.get("date_to")
    status_filter = str(request.query_params.get("status") or "ALL").upper()
    try:
        limit = int(request.query_params.get("limit") or 200)
    except Exception:
        limit = 200
    limit = max(1, min(1000, limit))

    if status_filter not in {"ALL", "NORMAL", "FORCED_VARIANCE"}:
        return Response(
            {"error": "status must be one of ALL, NORMAL, FORCED_VARIANCE"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    date_from = parse_date(date_from_raw) if date_from_raw else None
    date_to = parse_date(date_to_raw) if date_to_raw else None
    if date_from_raw and not date_from:
        return Response({"error": "Invalid date_from format. Use YYYY-MM-DD."}, status=status.HTTP_400_BAD_REQUEST)
    if date_to_raw and not date_to:
        return Response({"error": "Invalid date_to format. Use YYYY-MM-DD."}, status=status.HTTP_400_BAD_REQUEST)
    if date_from and date_to and date_from > date_to:
        return Response({"error": "date_from cannot be after date_to."}, status=status.HTTP_400_BAD_REQUEST)

    jobs_qs = ProductionJob.objects.filter(machine=machine, job_state="COMPLETED").select_related(
        "template",
        "current_process",
        "process",
        "sales_order_item",
    )
    if status_filter == "NORMAL":
        jobs_qs = jobs_qs.filter(closed_with_variance=False)
    elif status_filter == "FORCED_VARIANCE":
        jobs_qs = jobs_qs.filter(closed_with_variance=True)

    if date_from:
        jobs_qs = jobs_qs.filter(closed_at__date__gte=date_from)
    if date_to:
        jobs_qs = jobs_qs.filter(closed_at__date__lte=date_to)

    jobs = list(jobs_qs.order_by("-closed_at", "-updated_at")[:limit])
    job_ids = [job.id for job in jobs]
    job_map = {job.id: job for job in jobs}

    produced_by_job = defaultdict(lambda: Decimal("0"))
    if job_ids:
        produced_rows = (
            JobExecutionLog.objects.filter(production_job_id__in=job_ids)
            .values("production_job_id", "uom")
            .annotate(total=Sum("quantity"))
        )
        for row in produced_rows:
            job_id = row["production_job_id"]
            qty = Decimal(str(row.get("total") or 0))
            uom = str(row.get("uom") or "KG").upper()
            if uom == "KG":
                produced_by_job[job_id] += qty
                continue
            unit_weight_g = Decimal(
                str(getattr(getattr(job_map.get(job_id), "sales_order_item", None), "unit_weight_g", 0) or 0)
            )
            if uom == "PCS" and unit_weight_g > 0:
                produced_by_job[job_id] += (qty * unit_weight_g) / Decimal("1000")
            else:
                produced_by_job[job_id] += qty

    scrap_by_job = defaultdict(lambda: Decimal("0"))
    if job_ids:
        scrap_rows = (
            ScrapLog.objects.filter(production_job_id__in=job_ids)
            .values("production_job_id", "uom")
            .annotate(total=Sum("quantity"))
        )
        for row in scrap_rows:
            job_id = row["production_job_id"]
            qty = Decimal(str(row.get("total") or 0))
            uom = str(row.get("uom") or "KG").upper()
            if uom == "KG":
                scrap_by_job[job_id] += qty
                continue
            unit_weight_g = Decimal(
                str(getattr(getattr(job_map.get(job_id), "sales_order_item", None), "unit_weight_g", 0) or 0)
            )
            if uom == "PCS" and unit_weight_g > 0:
                scrap_by_job[job_id] += (qty * unit_weight_g) / Decimal("1000")
            else:
                scrap_by_job[job_id] += qty

    jobs_payload = []
    daily_map = defaultdict(lambda: {"produced_kg": Decimal("0"), "scrap_kg": Decimal("0"), "jobs_completed": 0})
    for job in jobs:
        produced_kg = produced_by_job[job.id]
        scrap_kg = scrap_by_job[job.id]
        step = job.current_process or job.process
        completed_day = job.closed_at.date().isoformat() if job.closed_at else None
        completion_mode = "FORCED_VARIANCE" if job.closed_with_variance else "NORMAL"

        jobs_payload.append(
            {
                "job_id": str(job.id),
                "job_number": job.job_number,
                "template_name": job.template.name if job.template else "Custom",
                "step_name": step.name if step else "Unknown",
                "completed_at": job.closed_at.isoformat() if job.closed_at else None,
                "completion_mode": completion_mode,
                "variance_kg": float(job.completion_variance_kg or 0),
                "produced_kg": float(produced_kg),
                "scrap_kg": float(scrap_kg),
            }
        )

        if completed_day:
            daily_map[completed_day]["produced_kg"] += produced_kg
            daily_map[completed_day]["scrap_kg"] += scrap_kg
            daily_map[completed_day]["jobs_completed"] += 1

    daily_payload = []
    for day in sorted(daily_map.keys(), reverse=True):
        row = daily_map[day]
        daily_payload.append(
            {
                "date": day,
                "produced_kg": float(row["produced_kg"]),
                "scrap_kg": float(row["scrap_kg"]),
                "jobs_completed": int(row["jobs_completed"]),
            }
        )

    summary = {
        "jobs_completed": len(jobs_payload),
        "produced_kg": float(sum((Decimal(str(item["produced_kg"])) for item in jobs_payload), Decimal("0"))),
        "scrap_kg": float(sum((Decimal(str(item["scrap_kg"])) for item in jobs_payload), Decimal("0"))),
        "forced_variance_count": sum(1 for item in jobs_payload if item["completion_mode"] == "FORCED_VARIANCE"),
    }

    return Response(
        {
            "machine": {
                "id": str(machine.id),
                "name": machine.name,
                "code": machine.code,
                "work_center_name": machine.work_center.name if machine.work_center else None,
                "plant_name": machine.work_center.plant.name if machine.work_center and machine.work_center.plant else None,
            },
            "filters": {
                "date_from": date_from.isoformat() if date_from else None,
                "date_to": date_to.isoformat() if date_to else None,
                "status": status_filter,
            },
            "summary": summary,
            "daily": daily_payload,
            "jobs": jobs_payload,
        }
    )


# ==============================================================================
# Operator Machines List (for Machine Selector)
# ==============================================================================

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def operator_machines(request):
    """
    Get list of machines for the current user.
    - Admin/Owner: Returns ALL machines
    - Operator: Returns only assigned machines
    Route: GET /api/production/operator/machines/
    """
    user = request.user
    
    # Check if user is admin/owner (has full access)
    is_admin = _is_admin_machine_actor(user)
    
    # Also check entitlements for role emulation
    entitlement_role = getattr(user, 'entitlements', {})
    if isinstance(entitlement_role, dict):
        emulated_role = entitlement_role.get('role', '')
        if emulated_role in ['ADMIN', 'OWNER', 'SUPER_ADMIN']:
            is_admin = True
    
    if is_admin:
        # Admin/Owner sees ALL machines
        machines = Machine.objects.filter(
            status='ACTIVE'
        ).select_related('work_center', 'work_center__plant')
    else:
        # Operators only see assigned machines
        from apps.users.models import MachineAssignment
        assigned_machine_ids = MachineAssignment.objects.filter(
            user=user
        ).values_list('machine_id', flat=True)
        
        machines = Machine.objects.filter(
            id__in=assigned_machine_ids
        ).select_related('work_center', 'work_center__plant')
    
    result = []
    for machine in machines:
        # Get current job if any
        current_job = ProductionJob.objects.filter(
            machine=machine,
            job_state='EXECUTING'
        ).select_related('template').first()
        
        # Queue count
        queue_count = ProductionJob.objects.filter(
            machine=machine,
            job_state__in=['RELEASED', 'PAUSED']
        ).count()
        
        result.append({
            'id': str(machine.id),
            'code': machine.code,
            'name': machine.name,
            'status': machine.status,
            'work_center_name': machine.work_center.name,
            'plant_name': machine.work_center.plant.name,
            'current_job': {
                'id': str(current_job.id),
                'job_number': current_job.job_number,
                'product_name': current_job.template.name if current_job.template else "N/A",
            } if current_job else None,
            'queue_count': queue_count,
        })
    
    return Response(result)


# ==============================================================================
# Scrap Logging
# ==============================================================================

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def machine_log_scrap(request, machine_id, job_id):
    """
    Log scrap for a job on this machine.
    Route: POST /api/production/machine/<machine_id>/jobs/<job_id>/log-scrap/
    """
    try:
        machine = Machine.objects.get(id=machine_id)
    except Machine.DoesNotExist:
        return Response({"error": "Machine not found"}, status=status.HTTP_404_NOT_FOUND)
    if not _ensure_machine_scope(request.user, machine.id):
        return _scope_denied(machine.id)
    try:
        ProductionJob.objects.get(id=job_id, machine=machine)
    except ProductionJob.DoesNotExist:
        return Response({"error": "Job not found on this machine"}, status=status.HTTP_404_NOT_FOUND)
    
    qty = request.data.get('quantity')
    reason = request.data.get('reason')
    notes = request.data.get('notes', '')
    
    if qty is None or not reason:
        return Response(
            {"error": "quantity and reason are required"}, 
            status=status.HTTP_400_BAD_REQUEST
        )
    
    try:
        job = OperatorService.log_scrap(job_id, float(qty), reason, notes, request.user)
        return Response(ProductionJobSerializer(job).data)
    except Exception:
        logger.exception("Machine log-scrap failed machine_id=%s job_id=%s", machine_id, job_id)
        return Response(
            {"error": {"code": "MACHINE_LOG_SCRAP_FAILED", "message": "Unable to log scrap."}},
            status=status.HTTP_400_BAD_REQUEST,
        )
