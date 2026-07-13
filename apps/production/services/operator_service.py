from decimal import Decimal
from django.db import transaction, models
from django.utils import timezone
from apps.production.models import ProductionJob, JobExecutionLog, ScrapLog, DowntimeLog, WorkCenterAssignment
from apps.inventory.models import InventoryLocation, InventoryRoll
from apps.production.services.material_service import MaterialConsumptionService
from apps.production.services import JobService
from apps.inventory.services.roll_service import RollService
from apps.production.services.shift_resolver import build_shift_fields_for_job

class OperatorService:
    @staticmethod
    def get_operator_dashboard(work_center_id: str = None, machine_id: str = None, user_machines=None, user_machine_ids=None):
        """
        Returns jobs for the operator.
        Criteria:
        1. Assignment Status is EXECUTION_READY (Ready to start)
        2. OR Job State is EXECUTING / PAUSED (Already started/in-progress)
        3. Filter by Work Center (optional if machine_id provided)
        4. Filter by Machine Scope (Assigned to User or Unassigned)
        
        Args:
            user_machines: QuerySet of machines (legacy)
            user_machine_ids: List of machine UUIDs assigned to user
        """
        qs = ProductionJob.objects.select_related('assignment', 'template', 'production_batch', 'sales_order_item')
        
        if work_center_id:
            qs = qs.filter(work_center_id=work_center_id)

        if machine_id:
            # Specific machine filter (e.g. from UI dropdown)
            qs = qs.filter(machine_id=machine_id)
        
        # Strict Machine Scope: ONLY machines assigned to user
        from django.db.models import Q
        
        if user_machine_ids is None:
            # Admin/superuser scope: no machine-level restriction.
            pass
        elif user_machine_ids:
            qs = qs.filter(machine_id__in=user_machine_ids)
        else:
            # If no machine IDs provided/assigned, return empty (Strict filtering)
            return qs.none()

        # Complex filter:
        # (Assignment == EXECUTION_READY AND State != COMPLETED) OR (State IN ['EXECUTING', 'PAUSED'])
        qs = qs.filter(
            Q(assignment__status='EXECUTION_READY', job_state__in=['RELEASED', 'WAITING', 'PLANNED']) |
            Q(job_state__in=['EXECUTING', 'PAUSED'])
        ).exclude(job_state__in=['COMPLETED', 'CANCELLED'])
        
        return qs.order_by('priority', 'planned_date')

    @staticmethod
    def start_job(job_id: str, user):
        job = ProductionJob.objects.get(id=job_id)
        
        # Validation
        if job.job_state == 'COMPLETED':
            raise ValueError("Cannot start a completed job.")
        
        if job.job_state == 'CANCELLED':
            raise ValueError("Cannot start a cancelled job.")
        
        # If Paused, Resume
        if job.job_state == 'PAUSED':
            return JobService.resume_job(job.id, user=user)
        
        # For RELEASED/other states, check machine assignment or WCM prep
        if job.job_state != 'EXECUTING':
            # Machine Terminal path: If machine is assigned, job can start directly
            if job.machine_id:
                # Machine is assigned - job is ready for execution
                pass
            else:
                # Traditional WCM path: require EXECUTION_READY assignment
                try:
                    assignment = job.assignment
                except WorkCenterAssignment.DoesNotExist:
                    raise ValueError("Job is not prepared for execution (no work center assignment).")

                if assignment.status != 'EXECUTION_READY':
                    raise ValueError("Job is not pushed by WCM yet (not EXECUTION_READY).")
                raise ValueError("Machine not assigned. WCM must assign a machine before execution.")

        # Standard Start
        from apps.production.services.services_execution import ExecutionService
        try:
            ExecutionService.auto_satisfy_inputs(str(job.id), user=user)
        except Exception:
            # Continue to explicit satisfaction check below.
            pass
        satisfaction = ExecutionService.get_satisfaction_status(str(job.id))
        if not satisfaction.get('is_satisfied'):
            missing_lines = []
            if satisfaction.get('rolls_missing'):
                missing_lines.append(f"rolls missing: {satisfaction.get('rolls_missing')}")
            for row in (satisfaction.get('bulk_consumption') or []):
                req = Decimal(str(row.get('required_qty') if row.get('required_qty') is not None else row.get('required_qty_kg') or 0))
                avail = Decimal(str(row.get('available_qty') if row.get('available_qty') is not None else row.get('available_qty_kg') or 0))
                uom = str(row.get("uom") or row.get("mode") or "KG").upper()
                if req > avail:
                    missing_lines.append(f"{row.get('material_name') or row.get('category')}: short {(req - avail):.3f} {uom.lower()}")
            detail = f" ({'; '.join(missing_lines[:3])})" if missing_lines else ""
            raise ValueError(f"Cannot start job: requirements not satisfied{detail}.")
        return JobService.start_job(job, user=user)

    @staticmethod
    def pause_job(job_id: str, reason: str, user):
        # Log Downtime implicitly or explicitly? 
        # Requirement: "Downtime Logging (Optional)". 
        # If pausing for a break, maybe simple pause. If machine breakdown, downtime log.
        # For now, just change state.
        return JobService.pause_job(job_id, reason)

    @staticmethod
    def resume_job(job_id: str, user):
        return JobService.resume_job(job_id, user=user)

    @staticmethod
    @transaction.atomic
    def log_output(job_id: str, quantity: float, user):
        """
        Logs incremental output.
        Phase 71: Simplified to log event and delegate to JobService.
        """
        job = ProductionJob.objects.get(id=job_id)
        if job.job_state != 'EXECUTING':
            raise ValueError("Output can only be logged when job is EXECUTING.")
        
        qty = Decimal(str(quantity))
        
        # Log the event
        JobExecutionLog.objects.create(
            production_job=job,
            quantity=qty,
            uom=job.uom if job.output_form != 'ROLL' else 'KG',
            logged_by=user,
            **build_shift_fields_for_job(job),
        )
        
        # We don't partial-complete or create rolls here anymore in the simple 'log' event.
        # Rolls/Batches are created at 'complete_session' or 'complete_job'.
        return job

    @staticmethod
    @transaction.atomic
    def log_output_step(job_id: str, output_weight_kg: float, user, **kwargs):
        """
        Machine-terminal output logging (KG-primary).
        Applies physics immediately and keeps step open until explicitly completed.
        """
        job = ProductionJob.objects.get(id=job_id)
        if job.job_state != 'EXECUTING':
            raise ValueError("Job must be EXECUTING to log output.")

        qty_kg = Decimal(str(output_weight_kg))
        if qty_kg <= 0:
            raise ValueError("Output weight must be > 0.")

        from apps.production.services.services_execution import ExecutionService
        # Re-satisfy input reservation before each log to support repeated
        # MODIFY_EXISTING logs while keeping remainders at stage-0 AVAILABLE.
        # If reservation evaluation fails, do not create untraceable output.
        ExecutionService.auto_satisfy_inputs(str(job.id), user=user)

        return JobService.log_output_event(job, qty_kg, completion_meta=kwargs, user=user)

    @staticmethod
    def log_scrap(job_id: str, quantity: float, reason: str, notes: str, user):
        job = ProductionJob.objects.get(id=job_id)
        
        ScrapLog.objects.create(
            production_job=job,
            quantity=Decimal(str(quantity)),
            uom=job.uom, # Scrap usually in base UOM (KG)
            reason=reason,
            notes=notes,
            logged_by=user,
            **build_shift_fields_for_job(job),
        )
        return job

    @staticmethod
    def log_downtime(job_id: str, start_time, end_time, reason: str, user, notes: str = ""):
        job = ProductionJob.objects.get(id=job_id)
        
        DowntimeLog.objects.create(
            production_job=job,
            start_time=start_time,
            end_time=end_time,
            reason=reason,
            notes=notes or "",
            logged_by=user,
            **build_shift_fields_for_job(job, ts=start_time),
        )
        return job

    @staticmethod
    @transaction.atomic
    def complete_job(job_id: str, user):
        """
        Finalizes a partial or full output from the operator (Phase 28).
        1. Aggregates Output & Scrap for THIS event.
        2. Delegates to JobService for final state management.
        """
        job = ProductionJob.objects.get(id=job_id)
        
        if job.job_state != 'EXECUTING':
            raise ValueError("Job must be EXECUTING to complete.")

        # 1. Aggregate Output logged since last completion
        # NOTE: For partials, we might want to only aggregate logs that haven't been 'processed' yet.
        # But for now, we assume operator logs everything, hits 'Complete', and we process the delta.
        # Simplification: Operator enters 'Good Qty' in a field, and we use that directly.
        
        # If the UI sends the total produced in this session:
        # total_produced = request.data.get('actual_qty')
        # For compatibility with existing UI that logs before completing:
        total_good_qty = job.execution_logs.aggregate(total=models.Sum('quantity'))['total'] or Decimal(0)
        # Subtract what was already produced/accounted for in previous partial completions
        current_session_good = total_good_qty - job.produced_qty
        
        if current_session_good <= 0:
            raise ValueError("No new output logged since last completion.")

        # 5. Delegate to JobService (JobService now handles consumption and WIP/FG creation)
        return JobService.complete_job(job, current_session_good, user=user)

    @staticmethod
    @transaction.atomic
    def complete_step(
        job_id: str,
        user,
        force_reason: str | None = None,
        material_confirmations=None,
        require_material_confirmations: bool = False,
    ):
        """
        Close-only completion for machine terminal.
        """
        job = ProductionJob.objects.get(id=job_id)
        return JobService.complete_step(
            job,
            user=user,
            force_reason=force_reason,
            material_confirmations=material_confirmations,
            require_material_confirmations=require_material_confirmations,
        )

    @staticmethod
    @transaction.atomic
    def complete_session(job_id: str, actual_qty: float, user, **kwargs):
        """
        Phase 71: Records a 'Session Completion' event.
        Creates output roll/batch and consumes inputs.
        Delegates to JobService for routing advancement logic.
        """
        job = ProductionJob.objects.get(id=job_id)
        if job.job_state != 'EXECUTING':
            raise ValueError("Job must be EXECUTING to complete session.")
        if not job.machine_id:
            raise ValueError("Machine not assigned. Cannot complete without machine.")

        qty = Decimal(str(actual_qty))
        if qty <= 0:
            raise ValueError("actual_qty must be > 0.")

        # New contract: complete_session acts as LOG OUTPUT (+ auto-close when done).
        # This keeps legacy clients compatible while aligning with machine-terminal flow.
        updated = OperatorService.log_output_step(job_id, float(qty), user, **kwargs)
        from apps.production.services.services_execution import ExecutionService
        step_profile = ExecutionService.get_step_execution_profile(updated.id)
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
        if remaining <= tolerance:
            return JobService.complete_step(updated, user=user)
        return updated
