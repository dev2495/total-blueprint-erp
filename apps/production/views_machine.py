"""
Machine Terminal API - Machine-Centric Execution

This module provides the API endpoints for the Machine Terminal UI.
Jobs belong to machines. Work Center Managers control machines in their assigned work centers.
"""
import logging
from collections import defaultdict
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db.models import Case, Count, IntegerField, Q, Sum, Value, When
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.factory.models import Machine
from apps.inventory.models import InventoryRoll
from apps.materials.models import GranuleQualityCode, InventoryMaterial
from apps.production.models import DowntimeLog, JobExecutionLog, MaterialConsumptionLog, ProductionJob, QualityReading, ScrapLog
from apps.production.serializers import ProductionJobSerializer
from apps.production.services import OperatorService
from apps.production.services.services_execution import ExecutionService

logger = logging.getLogger(__name__)


def _machine_validation_message(exc):
    messages = getattr(exc, "messages", None)
    if messages:
        return "; ".join(str(message) for message in messages)
    return str(exc)


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
    from apps.users.models import WorkCenterAssignment

    return WorkCenterAssignment.objects.filter(
        user=user,
        work_center_id__in=Machine.objects.filter(id=machine_id).values("work_center_id"),
    ).exists()


def _scope_denied(machine_id):
    return Response(
        {
            "error": {
                "code": "MACHINE_SCOPE_DENIED",
                "message": "This machine is outside your assigned work centers.",
                "machine_id": str(machine_id),
            }
        },
        status=status.HTTP_403_FORBIDDEN,
    )


def _user_label(user):
    if not user:
        return None
    try:
        return user.get_full_name() or user.username
    except Exception:
        return str(user)


def _artwork_payload_for_job(job):
    try:
        from apps.production.services.queue_enrichment import (
            print_color_contract_for_job,
            resolve_committed_artwork,
        )

        artwork = resolve_committed_artwork(job)
        if artwork is None:
            return {
                "artwork_id": None,
                "artwork_code": "",
                "artwork_name": "",
                "committed_artwork_id": None,
                "committed_artwork_code": "",
                "committed_artwork_name": "",
                **print_color_contract_for_job(job),
            }
        artwork_id = str(artwork.id)
        artwork_code = str(getattr(artwork, "design_code", "") or "")
        artwork_name = str(getattr(artwork, "name", "") or "")
        return {
            "artwork_id": artwork_id,
            "artwork_code": artwork_code,
            "artwork_name": artwork_name,
            "committed_artwork_id": artwork_id,
            "committed_artwork_code": artwork_code,
            "committed_artwork_name": artwork_name,
            **print_color_contract_for_job(job),
        }
    except Exception:
        logger.exception("Unable to resolve machine artwork payload for job_id=%s", getattr(job, "id", None))
        return {}


def _apply_artwork_payload(row, job):
    if isinstance(row, dict) and job is not None:
        row.update(_artwork_payload_for_job(job))
    return row


def _machine_job_or_response(user, machine_id, job_id):
    try:
        machine = Machine.objects.get(id=machine_id)
    except Machine.DoesNotExist:
        return None, None, Response({"error": "Machine not found"}, status=status.HTTP_404_NOT_FOUND)
    if not _ensure_machine_scope(user, machine.id):
        return machine, None, _scope_denied(machine.id)
    try:
        job = ProductionJob.objects.select_related("current_process", "process").get(id=job_id, machine=machine)
    except ProductionJob.DoesNotExist:
        return machine, None, Response({"error": "Job not found on this machine"}, status=status.HTTP_404_NOT_FOUND)
    return machine, job, None


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
    if not _ensure_machine_scope(request.user, machine.id):
        return _scope_denied(machine.id)
    
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
    
    current_job_payload = ProductionJobSerializer(current_job).data if current_job else None
    if current_job_payload is not None:
        _apply_artwork_payload(current_job_payload, current_job)

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
        'current_job': current_job_payload,
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
    if not _ensure_machine_scope(request.user, machine.id):
        return _scope_denied(machine.id)
    
    jobs = ProductionJob.objects.filter(
        machine=machine,
        job_state__in=['RELEASED', 'EXECUTING', 'PAUSED']
    ).select_related(
        'template',
        'production_batch',
        'current_process',
        'sales_order_item__sales_order',
        'sales_order_item__assigned_artwork',
        'mts_order__committed_artwork',
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
    
    job_by_id = {str(job.id): job for job in jobs}
    payload = ProductionJobSerializer(jobs, many=True).data
    for row in payload:
        _apply_artwork_payload(row, job_by_id.get(str(row.get("id"))))
        row["execution_model_version"] = 2
        try:
            profile = ExecutionService.get_step_execution_profile(str(row.get("id")))
        except Exception:
            profile = {}
        step_target_kg = Decimal(str(profile.get("step_target_total_kg") or 0))
        row["step_target_kg"] = float(step_target_kg)
        row["step_target_source"] = profile.get("target_source")
        row["primary_uom"] = profile.get("primary_uom") or "KG"
        row["step_target_primary"] = profile.get("step_target_primary")
        row["step_produced_primary"] = profile.get("step_produced_primary")
        row["step_remaining_primary"] = profile.get("step_remaining_primary")
        row["tolerance_primary"] = profile.get("tolerance_primary")
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
        job_for_completion = ProductionJob.objects.get(id=job_id, machine=machine)
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
        job_for_completion = ProductionJob.objects.get(id=job_id, machine=machine)
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
    - CREATE_NEW: { actual_qty, output_width_mm, output_length_m?, roll_outputs?, scrap_qty? }
      roll_outputs rows may include tare_weight_kg/core_tare_weight_kg and gross_weight_kg.
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
        roll_outputs = request.data.get('roll_outputs') or []
        if isinstance(roll_outputs, list) and roll_outputs:
            try:
                actual_qty = sum(float(item.get('weight_kg') or 0) for item in roll_outputs)
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
            "trim_qty": request.data.get('trim_qty'),
            "process_scrap_qty": request.data.get('process_scrap_qty'),
            "output_width_mm": request.data.get('output_width_mm'),
            "output_length_m": request.data.get('output_length_m'),
            "output_stock_form": request.data.get('output_stock_form') or request.data.get('stock_form'),
            "output_pcs": request.data.get('output_pcs'),
            "roll_outputs": request.data.get('roll_outputs'),
            "split_outputs": request.data.get('split_outputs'),
            "remainder_location_id": request.data.get('remainder_location_id'),
        }
        job = OperatorService.log_output_step(job_id, float(actual_qty), request.user, **payload)
        return Response(ProductionJobSerializer(job).data)
    except (ValueError, ValidationError) as exc:
        message = _machine_validation_message(exc)
        logger.warning(
            "Machine log-output validation failed machine_id=%s job_id=%s reason=%s",
            machine_id,
            job_id,
            message,
        )
        return Response(
            {"error": {"code": "MACHINE_LOG_OUTPUT_VALIDATION_FAILED", "message": message}},
            status=status.HTTP_400_BAD_REQUEST,
        )
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
        job_for_completion = ProductionJob.objects.get(id=job_id, machine=machine)
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
        if material_confirmations is None:
            material_confirmations = getattr(job_for_completion, "current_step_material_confirmations", None)
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
    except (ValueError, ValidationError) as exc:
        message = _machine_validation_message(exc)
        logger.warning(
            "Machine complete validation failed machine_id=%s job_id=%s reason=%s",
            machine_id,
            job_id,
            message,
        )
        return Response(
            {"error": {"code": "MACHINE_COMPLETE_VALIDATION_FAILED", "message": message}},
            status=status.HTTP_400_BAD_REQUEST,
        )
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
        if isinstance(context, dict) and isinstance(context.get("job"), dict):
            _apply_artwork_payload(context["job"], job)
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
        "production_batch",
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
                "production_batch_number": job.production_batch.batch_number if job.production_batch else "",
                "production_batch_status": job.production_batch.status if job.production_batch else "",
                "route_node_id": job.route_node_id or "",
                "route_branch_key": job.route_branch_key or "",
                "route_node": {
                    "id": job.route_node_id or "",
                    "branch_key": job.route_branch_key or "",
                },
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
    - Work Center Manager: Returns active machines under assigned work centers
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
    
    def _bounded_int(name, default=None, *, minimum=0, maximum=1000):
        raw = request.query_params.get(name)
        if raw in (None, ""):
            return default
        try:
            value = int(raw)
        except (TypeError, ValueError):
            return default
        return max(minimum, min(maximum, value))

    limit = _bounded_int("limit", None, minimum=1, maximum=1000)
    offset = _bounded_int("offset", 0, minimum=0, maximum=100000)
    search = str(request.query_params.get("q") or request.query_params.get("search") or "").strip()
    work_center_id = str(request.query_params.get("work_center_id") or "").strip()
    plant_id = str(request.query_params.get("plant_id") or "").strip()

    if is_admin:
        # Admin/Owner sees ALL machines
        machines = Machine.objects.filter(
            status='ACTIVE'
        ).select_related('work_center', 'work_center__plant')
    else:
        from apps.users.models import WorkCenterAssignment
        assigned_wc_ids = WorkCenterAssignment.objects.filter(
            user=user
        ).values_list('work_center_id', flat=True)
        
        machines = Machine.objects.filter(
            work_center_id__in=assigned_wc_ids,
            status='ACTIVE',
        ).select_related('work_center', 'work_center__plant')

    if search:
        machines = machines.filter(
            Q(code__icontains=search)
            | Q(name__icontains=search)
            | Q(work_center__code__icontains=search)
            | Q(work_center__name__icontains=search)
            | Q(work_center__plant__code__icontains=search)
            | Q(work_center__plant__name__icontains=search)
        )
    if work_center_id:
        machines = machines.filter(work_center_id=work_center_id)
    if plant_id:
        machines = machines.filter(work_center__plant_id=plant_id)

    machines = machines.order_by(
        "work_center__plant__code",
        "work_center__code",
        "code",
        "name",
        "id",
    )
    total_count = machines.count()
    if limit is not None:
        machines = machines[offset:offset + limit]
    elif offset:
        machines = machines[offset:]
    machine_rows = list(machines)
    machine_ids = [machine.id for machine in machine_rows]

    current_jobs = (
        ProductionJob.objects.filter(machine_id__in=machine_ids, job_state='EXECUTING')
        .select_related('template')
        .order_by("machine_id", "-updated_at", "-created_at")
    )
    current_by_machine = {}
    for job in current_jobs:
        current_by_machine.setdefault(job.machine_id, job)

    queue_counts = dict(
        ProductionJob.objects.filter(
            machine_id__in=machine_ids,
            job_state__in=['RELEASED', 'PAUSED'],
        )
        .values("machine_id")
        .annotate(total=Count("id"))
        .values_list("machine_id", "total")
    )
    
    result = []
    for machine in machine_rows:
        current_job = current_by_machine.get(machine.id)
        queue_count = int(queue_counts.get(machine.id, 0) or 0)
        work_center = machine.work_center
        plant = work_center.plant if work_center else None
        result.append({
            'id': str(machine.id),
            'code': machine.code,
            'name': machine.name,
            'status': machine.status,
            'work_center_name': work_center.name if work_center else None,
            'plant_name': plant.name if plant else None,
            'current_job': {
                'id': str(current_job.id),
                'job_number': current_job.job_number,
                'product_name': current_job.template.name if current_job.template else "N/A",
            } if current_job else None,
            'queue_count': queue_count,
        })
    
    if limit is None and offset == 0 and not search and not work_center_id and not plant_id:
        return Response(result)

    next_offset = offset + len(result)
    return Response({
        "results": result,
        "count": total_count,
        "limit": limit,
        "offset": offset,
        "next_offset": next_offset if next_offset < total_count else None,
        "has_more": next_offset < total_count,
    })


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


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def machine_log_downtime(request, machine_id, job_id):
    """
    Log downtime for a job on this machine.
    Route: POST /api/production/machine/<machine_id>/jobs/<job_id>/log-downtime/
    """
    _, job, error_response = _machine_job_or_response(request.user, machine_id, job_id)
    if error_response:
        return error_response

    reason = str(request.data.get("reason") or "").strip().upper()
    if reason not in {choice[0] for choice in DowntimeLog.REASON_CHOICES}:
        return Response({"error": "reason must be one of BREAKDOWN, MAINTENANCE, MATERIAL, MANPOWER, POWER, OTHER"}, status=status.HTTP_400_BAD_REQUEST)

    start_raw = request.data.get("start_time")
    end_raw = request.data.get("end_time")
    start_time = parse_datetime(start_raw) if start_raw else timezone.now()
    end_time = parse_datetime(end_raw) if end_raw else None
    if not start_time:
        return Response({"error": "Invalid start_time format."}, status=status.HTTP_400_BAD_REQUEST)
    if end_raw and not end_time:
        return Response({"error": "Invalid end_time format."}, status=status.HTTP_400_BAD_REQUEST)
    if end_time and end_time < start_time:
        return Response({"error": "end_time cannot be before start_time."}, status=status.HTTP_400_BAD_REQUEST)

    notes = str(request.data.get("notes") or "")
    auto_stop_raw = request.data.get("auto_stop")
    auto_stop = (
        str(auto_stop_raw).strip().lower() not in {"false", "0", "no", "off"}
        if auto_stop_raw is not None
        else reason in {"BREAKDOWN", "POWER"}
    )

    try:
        OperatorService.log_downtime(job.id, start_time, end_time, reason, request.user, notes=notes)
        if auto_stop and str(job.job_state).upper() == "EXECUTING":
            job = OperatorService.pause_job(job.id, f"Downtime: {reason}", request.user)
        payload = ProductionJobSerializer(job).data
        payload["downtime"] = {
            "reason": reason,
            "start_time": start_time.isoformat(),
            "end_time": end_time.isoformat() if end_time else None,
            "notes": notes,
            "auto_stop": auto_stop,
        }
        return Response(payload)
    except Exception:
        logger.exception("Machine log-downtime failed machine_id=%s job_id=%s", machine_id, job_id)
        return Response(
            {"error": {"code": "MACHINE_LOG_DOWNTIME_FAILED", "message": "Unable to log downtime."}},
            status=status.HTTP_400_BAD_REQUEST,
        )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def machine_log_consumption(request, machine_id, job_id):
    """
    Log a measured/manual material consumption row for this machine job.
    Route: POST /api/production/machine/<machine_id>/jobs/<job_id>/log-consumption/
    """
    _, job, error_response = _machine_job_or_response(request.user, machine_id, job_id)
    if error_response:
        return error_response

    material_id = str(request.data.get("material_id") or "").strip()
    roll_id = str(request.data.get("roll_id") or "").strip()
    quantity_raw = request.data.get("quantity")
    if not material_id and not roll_id:
        return Response({"error": "material_id or roll_id is required"}, status=status.HTTP_400_BAD_REQUEST)
    if quantity_raw in (None, ""):
        return Response({"error": "quantity is required"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        quantity = Decimal(str(quantity_raw))
    except Exception:
        return Response({"error": "quantity must be numeric"}, status=status.HTTP_400_BAD_REQUEST)
    if quantity <= 0:
        return Response({"error": "quantity must be greater than zero"}, status=status.HTTP_400_BAD_REQUEST)

    roll = None
    if roll_id:
        roll = InventoryRoll.objects.filter(id=roll_id).select_related("material").first()
        if not roll:
            return Response({"error": "roll_id is invalid"}, status=status.HTTP_400_BAD_REQUEST)
        if not material_id:
            material_id = str(roll.material_id)

    material = InventoryMaterial.objects.filter(id=material_id).first()
    if not material:
        return Response({"error": "material_id is invalid"}, status=status.HTTP_400_BAD_REQUEST)
    if roll and roll.material_id and str(roll.material_id) != str(material.id):
        return Response({"error": "roll_id does not belong to material_id"}, status=status.HTTP_400_BAD_REQUEST)

    granule_code_id = str(request.data.get("granule_code_id") or "").strip() or None
    granule_code = None
    if granule_code_id:
        granule_code = GranuleQualityCode.objects.filter(id=granule_code_id, granule=material).first()
        if not granule_code:
            return Response({"error": "granule_code_id does not belong to material_id"}, status=status.HTTP_400_BAD_REQUEST)

    uom = str(request.data.get("uom") or "KG").strip().upper() or "KG"
    is_estimated = bool(request.data.get("is_estimated"))

    try:
        log = MaterialConsumptionLog.objects.create(
            production_job=job,
            material=material,
            granule_code=granule_code,
            roll=roll,
            quantity=quantity,
            uom=uom,
            is_estimated=is_estimated,
        )
        return Response(
            {
                "id": str(log.id),
                "material_id": str(material.id),
                "material_code": material.code,
                "material_name": material.name,
                "granule_code_id": str(granule_code.id) if granule_code else None,
                "quantity": float(log.quantity),
                "uom": log.uom,
                "is_estimated": log.is_estimated,
                "logged_at": log.logged_at.isoformat() if log.logged_at else None,
            },
            status=status.HTTP_201_CREATED,
        )
    except Exception:
        logger.exception("Machine log-consumption failed machine_id=%s job_id=%s", machine_id, job_id)
        return Response(
            {"error": {"code": "MACHINE_LOG_CONSUMPTION_FAILED", "message": "Unable to log consumption."}},
            status=status.HTTP_400_BAD_REQUEST,
        )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def machine_log_quality(request, machine_id, job_id):
    """
    Log process-specific quality readings for this machine job.
    Route: POST /api/production/machine/<machine_id>/jobs/<job_id>/log-quality/
    """
    _, job, error_response = _machine_job_or_response(request.user, machine_id, job_id)
    if error_response:
        return error_response
    process = job.current_process or job.process
    if not process:
        return Response({"error": "Current process is required for quality readings."}, status=status.HTTP_400_BAD_REQUEST)

    readings = request.data.get("readings") or []
    if not isinstance(readings, list) or not readings:
        return Response({"error": "readings must contain at least one row"}, status=status.HTTP_400_BAD_REQUEST)

    created = []
    try:
        for row in readings:
            if not isinstance(row, dict):
                return Response({"error": "Each reading must be an object"}, status=status.HTTP_400_BAD_REQUEST)
            code = str(row.get("code") or row.get("parameter_code") or "").strip().upper()
            if not code:
                return Response({"error": "Each reading requires code"}, status=status.HTTP_400_BAD_REQUEST)

            def _decimal_or_none(key):
                value = row.get(key)
                if value in (None, ""):
                    return None
                return Decimal(str(value))

            reading = QualityReading.objects.create(
                production_job=job,
                process=process,
                parameter_code=code,
                value_numeric=_decimal_or_none("value_numeric"),
                value_text=str(row.get("value_text") or ""),
                spec_min=_decimal_or_none("spec_min"),
                spec_max=_decimal_or_none("spec_max"),
                in_spec=bool(row.get("in_spec", True)),
                logged_by=request.user,
            )
            created.append(str(reading.id))
        return Response({"created": created}, status=status.HTTP_201_CREATED)
    except Exception:
        logger.exception("Machine log-quality failed machine_id=%s job_id=%s", machine_id, job_id)
        return Response(
            {"error": {"code": "MACHINE_LOG_QUALITY_FAILED", "message": "Unable to log quality readings."}},
            status=status.HTTP_400_BAD_REQUEST,
        )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def machine_job_events(request, machine_id, job_id):
    """
    Mixed live event feed for the machine terminal.
    Route: GET /api/production/machine/<machine_id>/jobs/<job_id>/events/?limit=20
    """
    _, job, error_response = _machine_job_or_response(request.user, machine_id, job_id)
    if error_response:
        return error_response
    try:
        limit = int(request.query_params.get("limit") or 20)
    except Exception:
        limit = 20
    limit = max(1, min(100, limit))

    events = []
    for log in job.execution_logs.select_related("logged_by").order_by("-logged_at")[:limit]:
        events.append({
            "id": str(log.id),
            "type": "OUTPUT",
            "ts": log.logged_at.isoformat() if log.logged_at else None,
            "quantity": float(log.quantity or 0),
            "uom": log.uom,
            "label": f"{float(log.quantity or 0):.3f} {log.uom}",
            "user": _user_label(log.logged_by),
        })
    for log in job.scrap_logs.select_related("logged_by").order_by("-logged_at")[:limit]:
        events.append({
            "id": str(log.id),
            "type": "SCRAP",
            "ts": log.logged_at.isoformat() if log.logged_at else None,
            "quantity": float(log.quantity or 0),
            "uom": log.uom,
            "reason": log.reason,
            "label": f"{float(log.quantity or 0):.3f} {log.uom} · {log.reason}",
            "user": _user_label(log.logged_by),
        })
    for log in job.downtime_logs.select_related("logged_by").order_by("-created_at")[:limit]:
        events.append({
            "id": f"{log.id}-start",
            "type": "DOWNTIME_START",
            "ts": log.start_time.isoformat() if log.start_time else None,
            "reason": log.reason,
            "label": log.reason,
            "user": _user_label(log.logged_by),
        })
        if log.end_time:
            events.append({
                "id": f"{log.id}-end",
                "type": "DOWNTIME_END",
                "ts": log.end_time.isoformat(),
                "reason": log.reason,
                "duration_min": log.duration_minutes,
                "label": f"{log.duration_minutes:.0f} min · {log.reason}",
                "user": _user_label(log.logged_by),
            })
    for log in job.consumption_logs.select_related("material", "granule_code").order_by("-logged_at")[:limit]:
        events.append({
            "id": str(log.id),
            "type": "CONSUMPTION",
            "ts": log.logged_at.isoformat() if log.logged_at else None,
            "quantity": float(log.quantity or 0),
            "uom": log.uom,
            "material": log.material.code if log.material else None,
            "granule_code": log.granule_code.code if log.granule_code else None,
            "is_estimated": log.is_estimated,
            "label": f"{float(log.quantity or 0):.3f} {log.uom} · {log.material.code if log.material else 'Material'}",
            "user": "system" if log.is_estimated else None,
        })
    for log in job.quality_readings.select_related("logged_by").order_by("-logged_at")[:limit]:
        value = log.value_text or (str(log.value_numeric) if log.value_numeric is not None else "")
        events.append({
            "id": str(log.id),
            "type": "QUALITY",
            "ts": log.logged_at.isoformat() if log.logged_at else None,
            "parameter": log.parameter_code,
            "value": value,
            "in_spec": log.in_spec,
            "label": f"{log.parameter_code} · {value}".strip(" ·"),
            "user": _user_label(log.logged_by),
        })
    for event in job.wcm_audit_events.filter(action="PRINT_COLOR_CHANGE").select_related("actor").order_by("-occurred_at")[:limit]:
        before = list((event.payload or {}).get("previous_front_colors") or []) + list((event.payload or {}).get("previous_back_colors") or [])
        after = list((event.payload or {}).get("front_colors") or []) + list((event.payload or {}).get("back_colors") or [])
        events.append({
            "id": str(event.id),
            "type": "PRINT_COLOR_CHANGE",
            "ts": event.occurred_at.isoformat() if event.occurred_at else None,
            "reason": event.reason,
            "before_colors": before,
            "after_colors": after,
            "revision_no": int((event.payload or {}).get("revision_no") or 0),
            "label": f"Print colors changed: {', '.join(before)} -> {', '.join(after)}",
            "user": _user_label(event.actor),
        })

    events.sort(key=lambda event: event.get("ts") or "", reverse=True)
    return Response({"events": events[:limit]})
