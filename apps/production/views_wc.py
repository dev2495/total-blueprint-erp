from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.db import transaction
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
from .serializers import WorkCenterAssignmentSerializer, ProductionJobSerializer, _sales_item_display_label
from .services.job_services import JobService, WCManagerService, MachineBusyError
from .services.roll_allocation_service import RollAllocationService
from .services.services_execution import ExecutionService
from .services.granule_availability import GranuleAvailabilityService, GranuleStockConflict
from apps.inventory.serializers import InventoryRollSerializer
from apps.inventory.models import InventoryBulk, InventoryLocation


def _actor_label(user):
    if not user or not getattr(user, "is_authenticated", False):
        return "system"
    return (
        getattr(user, "get_full_name", lambda: "")()
        or getattr(user, "username", "")
        or getattr(user, "email", "")
        or "user"
    )


def _bounded_int(value, *, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except Exception:
        return default
    return max(minimum, min(maximum, parsed))


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

        GranuleAvailabilityService.validate_allocations(
            material=req.material,
            issued_qty=issued,
            allocations=raw_allocations,
            issue_location_id=source_location_id,
            issue_plant_id=source_plant_id,
            lock=True,
        )

class WCQueueViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Get WC queue: job info, template name, SO, customer, qty, specs snapshot, assignment status.
    """
    serializer_class = WorkCenterAssignmentSerializer

    @staticmethod
    def _merge_queue_enrichment(row: dict, extra: dict):
        row.update(extra)
        job_details = row.get("job_details")
        if isinstance(job_details, dict):
            for key in (
                "artwork_id",
                "artwork_code",
                "artwork_name",
                "committed_artwork_id",
                "committed_artwork_code",
                "committed_artwork_name",
                "ink_colors",
                "front_colors",
                "back_colors",
                "color_revision_no",
                "color_revision_changed_at",
                "color_revision_changed_by",
                "color_revision_reason",
                "previous_front_colors",
                "previous_back_colors",
                "operator_notice_required",
                "cylinder_ready",
                "cylinder_status",
                "current_step_print_capable",
            ):
                if key in extra:
                    job_details[key] = extra.get(key)
        return row

    def get_queryset(self):
        wc_id = self.kwargs.get('wc_id')
        return (
            WorkCenterAssignment.objects.filter(
                work_center_id=wc_id,
                status__in=['WC_READY', 'ASSIGNED', 'EXECUTION_READY']
            ).exclude(
                production_job__job_state__in=['COMPLETED', 'CANCELLED']
            ).exclude(
                production_job__status__in=['COMPLETED', 'CANCELLED']
            ).select_related(
                'work_center',
                'assigned_machine',
                'assigned_by',
                'production_job',
                'production_job__template',
                'production_job__work_center',
                'production_job__machine',
                'production_job__operator',
                'production_job__current_process',
                'production_job__process',
                'production_job__sales_order_item',
                'production_job__sales_order_item__sales_order',
                'production_job__sales_order_item__product_master',
                'production_job__sales_order_item__product_variant',
                'production_job__sales_order_item__sku_variant',
                'production_job__sales_order_item__customer_product_overlay',
                'production_job__sales_order_item__assigned_artwork',
                'production_job__mts_order',
                'production_job__mts_order__committed_artwork',
            ).prefetch_related('allocated_rolls').order_by('created_at')
        )

    def _summary_requested(self, request):
        raw = str(
            request.query_params.get("summary")
            or request.query_params.get("compact")
            or ""
        ).strip().lower()
        return raw in {"1", "true", "yes", "y", "on"}

    def _json_dict(self, value):
        return value if isinstance(value, dict) else {}

    def _json_list(self, value):
        return value if isinstance(value, list) else []

    def _job_source(self, job):
        source = getattr(job, "sales_order_item", None)
        if source is not None:
            return source
        source = getattr(job, "mts_order", None)
        if source is not None:
            return source
        return None

    def _snapshot(self, job, name, default):
        source = self._job_source(job)
        if source is None:
            return default
        value = getattr(source, f"{name}_snapshot", default)
        if isinstance(default, list):
            return self._json_list(value)
        return self._json_dict(value)

    def _compact_unit_weight_g(self, job):
        source = self._job_source(job)
        try:
            return float(getattr(source, "unit_weight_g", 0) or 0) if source is not None else 0.0
        except Exception:
            return 0.0

    def _compact_total_weight_kg(self, job):
        try:
            qty = float(getattr(job, "quantity", 0) or 0)
            if str(getattr(job, "uom", "") or "").upper() == "KG":
                return qty
            unit_weight = self._compact_unit_weight_g(job)
            if unit_weight > 0:
                return (qty * unit_weight) / 1000.0
            source = self._job_source(job)
            return float(getattr(source, "total_weight_kg", 0) or 0) if source is not None else 0.0
        except Exception:
            return 0.0

    def _compact_order_placed_at(self, job):
        source = getattr(job, "sales_order_item", None)
        if source is not None and getattr(source, "sales_order", None) is not None:
            return source.sales_order.created_at
        mts = getattr(job, "mts_order", None)
        if mts is not None and getattr(mts, "created_at", None):
            return mts.created_at
        return job.created_at

    def _compact_product_name(self, job):
        source = getattr(job, "sales_order_item", None)
        if source is not None:
            label = _sales_item_display_label(source)
            if label:
                return label
            overlay = getattr(source, "customer_product_overlay", None)
            master = getattr(source, "product_master", None)
            sku_variant = getattr(source, "sku_variant", None)
            for value in (
                getattr(source, "line_name", ""),
                getattr(overlay, "customer_display_name", ""),
                getattr(master, "name", ""),
                getattr(sku_variant, "name", ""),
            ):
                value = str(value or "").strip()
                if value:
                    return value
        return str(getattr(job, "product_name", "") or "Sales product")

    def _compact_variant_fields(self, job):
        source = getattr(job, "sales_order_item", None)
        if source is None:
            return "", ""
        product_variant = getattr(source, "product_variant", None)
        sku_variant = getattr(source, "sku_variant", None)
        code = str(getattr(product_variant, "code", "") or getattr(sku_variant, "code", "") or "").strip()
        name = str(getattr(product_variant, "name", "") or getattr(sku_variant, "name", "") or code).strip()
        return code, name

    def _target_stock_contract_summary(self, geometry):
        base = geometry.get("base") if isinstance(geometry.get("base"), dict) else {}
        width = (
            geometry.get("child_target_width_mm")
            or geometry.get("target_child_width_mm")
            or geometry.get("roll_width_mm")
            or geometry.get("effective_width_mm")
            or base.get("width_mm")
            or geometry.get("width_mm")
            or geometry.get("width")
            or 0
        )
        return {
            "stock_form": geometry.get("roll_form") or geometry.get("stock_form") or "OPEN_WEB",
            "slit_policy": "ALLOWED",
            "width_mm": width,
            "width_basis": geometry.get("width_basis") or geometry.get("calculation_axis") or "snapshot",
            "film_area_width_mm": width,
            "source": "queue_summary",
        }

    def _compact_job_details(self, job):
        from .services.queue_enrichment import print_color_contract_for_job, resolve_committed_artwork

        process = getattr(job, "current_process", None) or getattr(job, "process", None)
        artwork = resolve_committed_artwork(job)
        geometry = self._snapshot(job, "geometry", {})
        layers = [dict(row) for row in self._snapshot(job, "layer", []) if isinstance(row, dict)]
        printing = self._snapshot(job, "printing", {})
        addons = self._snapshot(job, "addons", [])
        unit_weight_g = self._compact_unit_weight_g(job)
        total_weight_kg = self._compact_total_weight_kg(job)
        variant_code, variant_name = self._compact_variant_fields(job)
        qty = float(getattr(job, "quantity", 0) or 0)
        uom = str(getattr(job, "uom", "") or "KG").upper()
        return {
            "id": str(job.id),
            "job_number": job.job_number,
            "status": job.status,
            "job_state": job.job_state,
            "origin": job.origin,
            "source_type": getattr(job, "source_type", ""),
            "priority": job.priority,
            "planned_date": job.planned_date,
            "created_at": job.created_at,
            "updated_at": job.updated_at,
            "template": str(job.template_id) if job.template_id else None,
            "template_name": getattr(getattr(job, "template", None), "name", ""),
            "order_placed_at": self._compact_order_placed_at(job),
            "current_process": str(job.current_process_id) if job.current_process_id else None,
            "process_code": getattr(process, "code", "N/A") if process else "N/A",
            "process_category": "OTHERS",
            "roll_behavior": getattr(process, "roll_behavior", None) if process else None,
            "layer_count": len(layers) or 1,
            "work_center": str(job.work_center_id) if job.work_center_id else None,
            "work_center_name": getattr(getattr(job, "work_center", None), "name", ""),
            "machine": str(job.machine_id) if job.machine_id else None,
            "machine_name": getattr(getattr(job, "machine", None), "name", ""),
            "operator": str(job.operator_id) if job.operator_id else None,
            "operator_name": getattr(getattr(job, "operator", None), "username", ""),
            "quantity": qty,
            "produced_qty": float(getattr(job, "produced_qty", 0) or 0),
            "remaining_qty": float(getattr(job, "remaining_qty", 0) or 0),
            "uom": uom,
            "customer_name": getattr(job, "customer_name", ""),
            "order_number": getattr(job, "sales_order_no", ""),
            "product_name": self._compact_product_name(job),
            "variant_code": variant_code,
            "variant_name": variant_name,
            "current_step_index": job.current_step_index,
            "input_form": job.input_form,
            "output_form": job.output_form,
            "execution_model_version": 2,
            "geometry": geometry,
            "layers": layers,
            "printing": printing,
            "addons": addons,
            "unit_weight_g": unit_weight_g,
            "total_weight_kg": total_weight_kg,
            "step_target_kg": total_weight_kg if uom == "PCS" else qty,
            "step_target_primary": qty,
            "step_remaining_primary": float(getattr(job, "remaining_qty", 0) or qty),
            "primary_uom": uom,
            "order_reference_target_kg": total_weight_kg,
            "step_target_source": "QUEUE_SUMMARY",
            "order_target_source": "QUEUE_SUMMARY",
            "committed_artwork_id": str(artwork.id) if artwork else None,
            "committed_artwork_code": getattr(artwork, "design_code", "") if artwork else "",
            "committed_artwork_name": getattr(artwork, "name", "") if artwork else "",
            **print_color_contract_for_job(job),
            "current_step_print_capable": bool(process and (getattr(process, "print_capable", False) or getattr(process, "has_artwork", False))),
        }

    def _compact_assignment_row(self, assignment):
        job = assignment.production_job
        job_details = self._compact_job_details(job)
        return {
            "id": str(assignment.id),
            "production_job": str(assignment.production_job_id),
            "job_details": job_details,
            "work_center": str(assignment.work_center_id),
            "work_center_name": getattr(getattr(assignment, "work_center", None), "name", ""),
            "plant_id": str(getattr(assignment.work_center, "plant_id", "") or ""),
            "assigned_machine": str(assignment.assigned_machine_id) if assignment.assigned_machine_id else None,
            "assigned_machine_name": getattr(getattr(assignment, "assigned_machine", None), "name", None),
            "status": assignment.status,
            "allocated_rolls": [str(roll.id) for roll in assignment.allocated_rolls.all()],
            "target_stock_contract": self._target_stock_contract_summary(job_details.get("geometry") or {}),
            "assigned_by": str(assignment.assigned_by_id) if assignment.assigned_by_id else None,
            "assigned_at": assignment.assigned_at,
            "created_at": assignment.created_at,
            "queue_payload_mode": "summary",
        }

    def _apply_execution_targets(self, payload):
        import logging
        logger = logging.getLogger(__name__)
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
            normalized_order_reference = order_reference_target_kg if order_reference_target_kg > 0 else max(raw_total_kg, 0.0)
            job_details["execution_model_version"] = 2
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
        return payload

    def _reconcile_assignments(self, assignments):
        for assignment in assignments:
            previous = assignment.status
            previous_machine_id = assignment.assigned_machine_id
            WCManagerService._sync_assignment_status(assignment)
            changed_fields = []
            if assignment.status != previous:
                changed_fields.append('status')
            if assignment.assigned_machine_id != previous_machine_id:
                changed_fields.append('assigned_machine')
            if changed_fields:
                assignment.save(update_fields=changed_fields + ['updated_at'])

    @action(detail=False, methods=['get'], url_path='queue')
    def queue(self, request, wc_id=None):
        summary = self._summary_requested(request)
        search = str(request.query_params.get("q") or request.query_params.get("search") or "").strip()
        limit = _bounded_int(
            request.query_params.get("limit"),
            default=150 if summary else 35,
            minimum=1,
            maximum=300 if summary else 60,
        )
        queryset = self.get_queryset()
        if search:
            queryset = queryset.filter(
                Q(production_job__job_number__icontains=search)
                | Q(production_job__sales_order_item__sales_order__order_number__icontains=search)
                | Q(production_job__sales_order_item__sales_order__customer_name__icontains=search)
                | Q(production_job__sales_order_item__line_name__icontains=search)
                | Q(production_job__template__name__icontains=search)
                | Q(assigned_machine__name__icontains=search)
            )
        queryset = list(queryset[:limit])

        if summary:
            payload = []
            for assignment in queryset:
                job = assignment.production_job
                job_state = str(getattr(job, "job_state", "") or "").upper()
                job_status = str(getattr(job, "status", "") or "").upper()
                if job_state in {"COMPLETED", "CANCELLED"} or job_status in {"COMPLETED", "CANCELLED"}:
                    continue
                payload.append(self._compact_assignment_row(assignment))
            from .services.queue_enrichment import build_queue_enrichment
            enrichment = build_queue_enrichment(queryset, include_material=False)
            for row in payload:
                job_id = str((row.get("job_details") or {}).get("id") or "")
                extra = enrichment.get(job_id)
                if extra:
                    self._merge_queue_enrichment(row, extra)
            return Response(payload)

        serializer = self.get_serializer(queryset, many=True)
        payload = []
        for row in serializer.data:
            job_details = row.get("job_details") or {}
            job_state = str(job_details.get("job_state") or "").upper()
            job_status = str(job_details.get("status") or "").upper()
            if job_state in {"COMPLETED", "CANCELLED"} or job_status in {"COMPLETED", "CANCELLED"}:
                continue
            payload.append(row)

        # Queue-row enrichment (ink colors, cylinder + material readiness,
        # elapsed/last-log timing, stall flag). Computed from the live ORM rows
        # in a small fixed number of grouped queries (read-only, no mutation).
        from .services.queue_enrichment import build_queue_enrichment
        kept_job_ids = {
            str((row.get("job_details") or {}).get("id"))
            for row in payload
            if (row.get("job_details") or {}).get("id")
        }
        enrichment = build_queue_enrichment(
            [a for a in queryset if str(a.production_job_id) in kept_job_ids]
        )
        for row in payload:
            job_id = str((row.get("job_details") or {}).get("id") or "")
            extra = enrichment.get(job_id)
            if extra:
                self._merge_queue_enrichment(row, extra)
        return Response(self._apply_execution_targets(payload))

    def retrieve(self, request, *args, **kwargs):
        assignment = self.get_object()
        serializer = self.get_serializer(assignment)
        row = serializer.data
        from .services.queue_enrichment import build_queue_enrichment
        job_id = str((row.get("job_details") or {}).get("id") or assignment.production_job_id)
        extra = build_queue_enrichment([assignment], include_material=True).get(job_id)
        if extra:
            self._merge_queue_enrichment(row, extra)
        row["queue_payload_mode"] = "detail"
        return Response(self._apply_execution_targets([row])[0])

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
        base_qs = WorkCenterAssignment.objects.filter(work_center_id=wc_id).select_related(
            "production_job",
            "production_job__current_process",
            "production_job__process",
            "assigned_machine",
        )

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
            with transaction.atomic():
                material_confirmations = request.data.get("material_confirmations")
                before = WorkCenterAssignment.objects.select_for_update(of=("self",)).select_related(
                    "production_job",
                    "production_job__work_center",
                    "production_job__from_location",
                    "work_center",
                    "assigned_machine",
                ).get(id=assignment_id)
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
                response_data = WorkCenterAssignmentSerializer(assignment).data
            return Response(response_data)
        except WorkCenterAssignment.DoesNotExist:
            return Response({"error": "Assignment not found."}, status=status.HTTP_404_NOT_FOUND)
        except MachineBusyError as e:
            return Response(
                {"detail": str(e), "conflicting_job_number": e.conflicting_job_number},
                status=status.HTTP_409_CONFLICT,
            )
        except GranuleStockConflict as e:
            return Response(
                {"detail": str(e), "code": "GRANULE_STOCK_CHANGED"},
                status=status.HTTP_409_CONFLICT,
            )
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'], url_path='request-material-transfer')
    def request_material_transfer(self, request):
        assignment_id = request.data.get("assignment_id")
        requirement_id = request.data.get("requirement_id")
        granule_code_id = request.data.get("granule_code_id")
        source_location_id = request.data.get("source_location_id")
        try:
            quantity = _decimal(request.data.get("qty_kg"), "Transfer quantity")
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        if not all([assignment_id, requirement_id, granule_code_id, source_location_id]) or quantity <= 0:
            return Response(
                {"error": "assignment_id, requirement_id, granule_code_id, source_location_id and positive qty_kg are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            from apps.inventory.models import DeliveryChallan
            from apps.inventory.serializers import DeliveryChallanSerializer
            from apps.inventory.services.inter_plant import InterPlantService
            from apps.materials.models import GranuleQualityCode

            assignment = WorkCenterAssignment.objects.select_related(
                "production_job__work_center__plant",
                "production_job__from_location__plant",
                "work_center",
            ).get(id=assignment_id)
            job = assignment.production_job
            destination = WCManagerService._ensure_job_source_location(job)
            current_step = int(job.current_step_index or 0) + 1
            requirement = JobMaterialRequirement.objects.select_related("material", "process_step").get(
                id=requirement_id,
                production_job=job,
                process_step__sequence_number=current_step,
                material__category="GRANULE",
            )
            granule_code = GranuleQualityCode.objects.get(
                id=granule_code_id,
                granule=requirement.material,
                status="ACTIVE",
                merged_into__isnull=True,
            )
            source = InventoryLocation.objects.select_related("plant").get(id=source_location_id, is_active=True)
            if str(source.code or "").upper() == "IN_TRANSIT" or str(source.type or "").upper() == "TRANSIT":
                raise ValueError("In-transit stock cannot be allocated or transferred again.")
            if str(source.plant_id) == str(destination.plant_id):
                raise ValueError("This code is already in the destination plant; select it directly for allocation.")

            available = InventoryBulk.objects.filter(
                material=requirement.material,
                granule_code=granule_code,
                location=source,
                qty_kg__gt=0,
            ).aggregate(total=Sum("qty_kg")).get("total") or Decimal("0")
            if Decimal(str(available)) < quantity:
                raise ValueError(
                    f"Only {Decimal(str(available)).quantize(Decimal('0.0001'))} kg of {granule_code.code} is available at {source.name}."
                )
            open_transfer = DeliveryChallan.objects.filter(
                target_job=job,
                status__in=["DRAFT", "APPROVED", "IN_TRANSIT"],
                items__material=requirement.material,
                items__granule_code=granule_code,
            ).distinct().first()
            if open_transfer:
                raise ValueError(f"Transfer {open_transfer.dc_no} is already open for {granule_code.code}.")

            with transaction.atomic():
                challan = InterPlantService.create_challan(
                    from_plant_id=str(source.plant_id),
                    to_plant_id=str(destination.plant_id),
                    target_job_id=str(job.id),
                    is_system_generated=True,
                )
                InterPlantService.dispatch_challan(
                    challan_id=str(challan.id),
                    bulk_items=[{
                        "material_id": str(requirement.material_id),
                        "granule_code_id": str(granule_code.id),
                        "quantity": quantity,
                        "location_id": str(source.id),
                    }],
                    target_location_id=str(destination.id),
                )
            challan.refresh_from_db()
            _write_wcm_audit(
                assignment,
                "MATERIAL_TRANSFER_REQUEST",
                user=request.user,
                before_status=assignment.status,
                payload={
                    "dc_no": challan.dc_no,
                    "requirement_id": str(requirement.id),
                    "material": requirement.material.name,
                    "granule_code": granule_code.code,
                    "qty_kg": float(quantity),
                    "from_location": source.name,
                    "from_plant": source.plant.name,
                    "to_location": destination.name,
                    "to_plant": destination.plant.name,
                },
            )
            return Response(DeliveryChallanSerializer(challan).data, status=status.HTTP_201_CREATED)
        except WorkCenterAssignment.DoesNotExist:
            return Response({"error": "Assignment not found."}, status=status.HTTP_404_NOT_FOUND)
        except JobMaterialRequirement.DoesNotExist:
            return Response({"error": "Current-step granule requirement not found."}, status=status.HTTP_404_NOT_FOUND)
        except Exception as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'], url_path='receive-material-transfer')
    def receive_material_transfer(self, request):
        assignment_id = request.data.get("assignment_id")
        challan_id = request.data.get("challan_id")
        if not assignment_id or not challan_id:
            return Response({"error": "assignment_id and challan_id are required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            from apps.inventory.models import DeliveryChallan
            from apps.inventory.serializers import DeliveryChallanSerializer
            from apps.inventory.services.inter_plant import InterPlantService

            assignment = WorkCenterAssignment.objects.select_related("production_job__from_location").get(id=assignment_id)
            job = assignment.production_job
            destination = WCManagerService._ensure_job_source_location(job)
            challan = DeliveryChallan.objects.get(id=challan_id, target_job=job)
            InterPlantService.receive_challan(
                challan_id=str(challan.id),
                target_location_id=str(destination.id),
            )
            challan.refresh_from_db()
            _write_wcm_audit(
                assignment,
                "MATERIAL_TRANSFER_RECEIPT",
                user=request.user,
                before_status=assignment.status,
                payload={
                    "dc_no": challan.dc_no,
                    "to_location": destination.name,
                    "status": challan.status,
                },
            )
            return Response(DeliveryChallanSerializer(challan).data)
        except WorkCenterAssignment.DoesNotExist:
            return Response({"error": "Assignment not found."}, status=status.HTTP_404_NOT_FOUND)
        except DeliveryChallan.DoesNotExist:
            return Response({"error": "Transfer not found for this job."}, status=status.HTTP_404_NOT_FOUND)
        except Exception as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

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
            started = (
                str(job.job_state or '').upper() in {'EXECUTING', 'PAUSED'} or
                str(job.status or '').upper() == 'RUNNING' or
                JobExecutionLog.objects.filter(production_job=job).exists() or
                ScrapLog.objects.filter(production_job=job).exists() or
                DowntimeLog.objects.filter(production_job=job).exists() or
                MaterialConsumptionLog.objects.filter(production_job=job).exists()
            )

            if mode == 'CANCEL' and started:
                return Response(
                    {"error": "Cancel is only allowed before machine start. Use short close once execution or consumption has started."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if mode == 'SHORT_CLOSE' and not started:
                return Response(
                    {"error": "Short close is only allowed after machine start. Use cancel before execution starts."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            now = timezone.now()
            if mode == 'SHORT_CLOSE':
                from apps.production.services import JobService

                _write_wcm_audit(
                    assignment,
                    mode,
                    user=request.user,
                    before_status=before_status,
                    reason=reason,
                    payload={"job_state": job.job_state, "job_status": job.status, "started": started},
                )
                if str(job.job_state or '').upper() not in {'EXECUTING', 'PAUSED'}:
                    job.job_state = 'PAUSED'
                    if str(job.status or '').upper() not in {'RUNNING', 'IN_PROGRESS'}:
                        job.status = 'RUNNING'
                    job.save(update_fields=['job_state', 'status', 'updated_at'])
                closed_job = JobService.complete_step(
                    job,
                    user=request.user if getattr(request, 'user', None) and request.user.is_authenticated else None,
                    force_reason=reason,
                    material_confirmations=getattr(job, "current_step_material_confirmations", None) or [],
                    require_material_confirmations=False,
                )
                return Response({
                    "id": str(assignment_id),
                    "production_job": str(closed_job.id),
                    "status": "COMPLETED",
                    "job_details": ProductionJobSerializer(closed_job).data,
                })

            from apps.production.services import JobService

            action_label = 'Cancelled by WCM'
            JobService._release_active_roll_reservations(job)
            assignment.allocated_rolls.clear()
            job.closed_at = now
            job.closed_by = request.user if getattr(request, 'user', None) and request.user.is_authenticated else None
            job.closed_with_variance = False
            job.completion_force_reason = f"{action_label}: {reason}"
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
            if getattr(job, "sales_order_item_id", None):
                from apps.sales.services.order_service import SalesOrderService

                item = job.sales_order_item
                if str(getattr(item, "line_status", "") or "").upper() not in {"CANCELLED", "SHORT_CLOSED", "COMPLETED"}:
                    item.line_status = "PLANNING_REQUIRED"
                    item.save(update_fields=["line_status"])
                    SalesOrderService.sync_order_status_from_lines(item.sales_order)
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

    @action(detail=False, methods=['post'], url_path='skip-next-step')
    def skip_next_step(self, request):
        previous_job_id = request.data.get('previous_job_id')
        next_job_id = request.data.get('next_job_id')
        reason = str(request.data.get('reason') or '').strip()
        if not previous_job_id or not next_job_id:
            return Response({"error": "previous_job_id and next_job_id are required."}, status=status.HTTP_400_BAD_REQUEST)
        if len(reason) < 3:
            return Response({"error": "Reason must be at least 3 characters."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            previous_job = ProductionJob.objects.select_related('work_center', 'machine').get(id=previous_job_id)
            next_job = ProductionJob.objects.select_related('work_center', 'machine', 'production_batch').get(id=next_job_id)
            before_status = next_job.job_state
            skipped_job = JobService.skip_route_step(
                next_job,
                user=request.user if getattr(request, 'user', None) and request.user.is_authenticated else None,
                reason=reason,
                decision_source="WCM",
                previous_job=previous_job,
            )
            work_center = previous_job.work_center or skipped_job.work_center
            if work_center:
                ProductionWcmAuditEvent.objects.create(
                    production_job=skipped_job,
                    work_center=work_center,
                    assignment=None,
                    machine=previous_job.machine or skipped_job.machine,
                    action="ROUTE_STEP_SKIP",
                    actor=request.user if getattr(request, 'user', None) and request.user.is_authenticated else None,
                    reason=reason,
                    before_status=before_status or "",
                    after_status=skipped_job.job_state or "",
                    payload=getattr(skipped_job, "_route_step_decision", {}) or {},
                )
            return Response(ProductionJobSerializer(skipped_job).data)
        except ProductionJob.DoesNotExist:
            return Response({"error": "Previous or next job not found."}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
