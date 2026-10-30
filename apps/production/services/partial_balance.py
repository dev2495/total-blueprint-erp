"""
Partial runs: a step that closes short sends what it did not make back to the queue.

A sales-line step may run on less material than the order needs (a mass-fed step starts with
one roll). When it closes short beyond the close tolerance (the operator gives a reason), the
unmade part of the order is not lost:

- the later steps of the same batch are cut to what this step actually made (they can never
  make more than they receive), and
- a balance batch of the same line gets one job for this step and every step after it, sized
  to the unmade part. Its first job is released to this step's work center, so it is back in
  the WC queue (tagged as a balance) and runs when material is there; the rest wait for it.

Leftover on part-used rolls is not handled here: the operator returns it (same label) on the
terminal, and whatever is still loaded at close is released back to stock.

Stock orders and jobs without a production batch keep the old behaviour (short close; at the
final step the planner's Partial re-plan picks the line up).
"""
import logging
from decimal import Decimal, ROUND_HALF_UP

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.production.models import ProductionBatch, ProductionJob

logger = logging.getLogger(__name__)

# Step targets that follow the loaded rolls rather than the order (a short there is unused
# roll, not unmade order): the balance is measured against the job's own order quantity.
RESERVED_MASS_TARGETS = {
    "V2_COMBINE_RESERVED_TOTAL",
    "V2_STEP0_RESERVED_TOTAL",
    "V2_STEP0_RESERVED_ACTUAL_WEIGHT",
}
CLOSED_LINE_STATES = {"CANCELLED", "SHORT_CLOSED", "COMPLETED"}
CLOSED_JOB_STATES = ("COMPLETED", "CANCELLED")
# Runtime keys never copied from a source job onto its balance job.
RUNTIME_META_KEYS = {
    "route_step_decision",
    "partial_balance",
    "partial_balance_out",
    "quantity_reduced",
    "quantity_basis",
}


def _dec(value):
    try:
        return Decimal(str(value or 0))
    except Exception:
        return Decimal("0")


def _job_qty_step(uom):
    return Decimal("1") if str(uom or "").upper() == "PCS" else Decimal("0.01")


def _round_qty(qty, uom):
    return _dec(qty).quantize(_job_qty_step(uom), rounding=ROUND_HALF_UP)


class PartialBalanceService:
    @classmethod
    def _order_kg(cls, job):
        from apps.production.services.services_execution import ExecutionService

        qty = _dec(job.quantity)
        if str(job.uom or "KG").upper() == "KG":
            return qty
        unit_weight_g = _dec(ExecutionService._job_unit_weight_g(job))
        if unit_weight_g <= 0:
            return Decimal("0")
        return ExecutionService._convert_qty(qty, "PCS", "KG", unit_weight_g)

    @classmethod
    def ineligible_reason(cls, job):
        """Why a short close of this job cannot send its balance back (empty when it can)."""
        if not getattr(job, "sales_order_item_id", None):
            return "Only sales-order steps send a balance back; this one closes short."
        if not getattr(job, "routing_rule_id", None):
            return "This job has no route."
        line = job.sales_order_item
        if str(getattr(line, "line_status", "") or "").upper() in CLOSED_LINE_STATES:
            return "The order line is closed."
        return ""

    @classmethod
    def plan(cls, job, step_profile):
        """
        What a short close of this job leaves unmade, in the job's own unit:
        {balance_qty, covered_qty, uom, balance_kg}. None when nothing meaningful is left.
        """
        if cls.ineligible_reason(job):
            return None
        target_kg = _dec(step_profile.get("step_target_total_kg"))
        produced_kg = max(Decimal("0"), _dec(step_profile.get("step_produced_kg")))
        remaining_kg = max(Decimal("0"), _dec(step_profile.get("step_remaining_kg")))
        if str(step_profile.get("target_source") or "") in RESERVED_MASS_TARGETS or target_kg <= 0:
            target_kg = cls._order_kg(job)
            remaining_kg = max(Decimal("0"), target_kg - produced_kg)
        if target_kg <= 0 or remaining_kg <= 0:
            return None
        job_qty = _dec(job.quantity)
        uom = str(job.uom or "KG").upper()
        fraction = min(Decimal("1"), remaining_kg / target_kg)
        balance_qty = min(job_qty, _round_qty(job_qty * fraction, uom))
        if balance_qty <= 0:
            return None
        return {
            "balance_qty": balance_qty,
            "covered_qty": max(Decimal("0"), job_qty - balance_qty),
            "uom": uom,
            "balance_kg": remaining_kg.quantize(Decimal("0.001")),
        }

    @classmethod
    def preview(cls, job, step_profile):
        """For the close dialogs: what would go back to the queue if the step closed now."""
        reason = cls.ineligible_reason(job)
        planned = None if reason else cls.plan(job, step_profile)
        return {
            "eligible": bool(planned),
            "reason": reason,
            "balance_qty": float(planned["balance_qty"]) if planned else 0.0,
            "uom": planned["uom"] if planned else str(job.uom or "KG").upper(),
            "balance_kg": float(planned["balance_kg"]) if planned else 0.0,
            "work_center_name": getattr(getattr(job, "work_center", None), "name", "") or "",
        }

    @classmethod
    def _downstream_node_ids(cls, job):
        from apps.production.services.batch_route_service import RouteGraphService

        graph = RouteGraphService.normalize(job.routing_rule)
        start = RouteGraphService.node_for_job(job)
        if not start:
            return []
        by_id = graph.get("by_id") or {}
        seen, order = set(), []
        queue = list(start.get("successor_node_ids") or [])
        while queue:
            node_id = queue.pop(0)
            if node_id in seen or node_id not in by_id:
                continue
            seen.add(node_id)
            order.append(node_id)
            queue.extend(by_id[node_id].get("successor_node_ids") or [])
        return order

    @classmethod
    def _chain_jobs(cls, job):
        """Jobs of this batch at every step after this one, one per route node, in route order."""
        from apps.production.services.job_services import JobService

        scope = JobService._route_scope(job)
        node_ids = cls._downstream_node_ids(job) if job.route_node_id else []
        if node_ids:
            rows = list(scope.filter(route_node_id__in=node_ids).select_related("current_process", "process"))
        else:
            rows = list(
                scope.filter(current_step_index__gt=int(job.current_step_index or 0))
                .select_related("current_process", "process")
            )
        by_node = {}
        for row in sorted(rows, key=lambda r: (int(r.current_step_index or 0), r.created_at)):
            key = row.route_node_id or f"idx:{row.current_step_index}"
            by_node.setdefault(key, row)
        return list(by_node.values())

    @classmethod
    def _cut_downstream(cls, job, downstream, *, covered_qty, user=None):
        """Later steps of this batch can only make what this step made."""
        from apps.production.services.services_execution import ExecutionService

        job_qty = _dec(job.quantity)
        ratio = (covered_qty / job_qty) if job_qty > 0 else Decimal("0")
        changed = []
        for row in downstream:
            if row.job_state in CLOSED_JOB_STATES:
                continue
            current = _dec(row.quantity)
            candidate = covered_qty if str(row.uom or "").upper() == str(job.uom or "").upper() else current * ratio
            new_qty = max(_round_qty(min(current, candidate), row.uom), _dec(row.produced_qty))
            if new_qty >= current:
                continue
            if new_qty <= 0:
                # Nothing reaches this step from this batch: the balance batch carries it now.
                cls._retire(row, reason=f"Nothing made upstream ({job.job_number} closed short); the balance batch runs this step.", user=user)
                changed.append(row)
                continue
            meta = dict(row.meta_json or {})
            meta["quantity_basis"] = "JOB"
            meta["quantity_reduced"] = {
                "from_qty": str(current),
                "to_qty": str(new_qty),
                "uom": row.uom,
                "by_job": job.job_number,
                "at": timezone.now().isoformat(),
                "by": getattr(user, "username", "") or "",
            }
            row.quantity = new_qty
            row.remaining_qty = max(Decimal("0"), new_qty - _dec(row.produced_qty))
            row.meta_json = meta
            row.save(update_fields=["quantity", "remaining_qty", "meta_json", "updated_at"])
            ExecutionService.calculate_requirements(row.id)
            changed.append(row)
        return changed

    @classmethod
    def _retire(cls, row, *, reason, user=None):
        from apps.production.models import WorkCenterAssignment
        from apps.production.services.job_services import JobService

        JobService._release_active_roll_reservations(row)
        WorkCenterAssignment.objects.filter(production_job=row).delete()
        now = timezone.now()
        meta = dict(row.meta_json or {})
        meta["quantity_basis"] = "JOB"
        row.meta_json = meta
        row.status = "CANCELLED"
        row.job_state = "CANCELLED"
        row.closed_at = now
        row.closed_by = user if getattr(user, "pk", None) else None
        row.completion_force_reason = reason[:500]
        row.save(update_fields=["status", "job_state", "closed_at", "closed_by", "completion_force_reason", "meta_json", "updated_at"])

    @classmethod
    def _balance_batch(cls, job, *, qty, uom):
        from apps.production.services.batch_route_service import BatchExecutionService

        so_item = job.sales_order_item
        source = job.production_batch
        last = so_item.production_batches.order_by("-batch_sequence").first()
        sequence = int(getattr(last, "batch_sequence", 0) or 0) + 1
        return ProductionBatch.objects.create(
            batch_number=BatchExecutionService._next_batch_number(so_item, sequence),
            sales_order_item=so_item,
            template=source.template if source else job.template,
            routing_rule=job.routing_rule,
            parent_batch=source,
            batch_sequence=sequence,
            planned_qty=_dec(qty).quantize(Decimal("0.0001")),
            planned_uom=uom,
            source="MACHINE_OUTPUT",
            allow_partial_movement=bool(getattr(source, "allow_partial_movement", True)),
            route_snapshot=getattr(source, "route_snapshot", None) or {},
            policy_snapshot=getattr(source, "policy_snapshot", None) or {},
        )

    @classmethod
    def _clone_for_balance(cls, source, *, batch, qty, origin_job, first, user=None):
        from apps.production.services.job_services import JobService
        from apps.production.services.services_execution import ExecutionService

        so_item = source.sales_order_item
        index = int(source.current_step_index or 0)
        base_number = f"{so_item.sales_order.order_number}-{so_item.id.hex[:4]}-B{batch.batch_sequence:02d}-{index + 1}"
        meta = {k: v for k, v in dict(source.meta_json or {}).items() if k not in RUNTIME_META_KEYS}
        meta.update(JobService._source_layer_identity_meta(so_item))
        meta["production_batch_number"] = batch.batch_number
        meta["quantity_basis"] = "JOB"
        meta["partial_balance"] = {
            "of_job": origin_job.job_number,
            "of_job_id": str(origin_job.id),
            "qty": str(qty),
            "uom": source.uom,
            "at": timezone.now().isoformat(),
            "by": getattr(user, "username", "") or "",
        }
        node = source.route_node_id or ""
        job = ProductionJob.objects.create(
            job_number=JobService._next_unique_job_number(base_number),
            origin=source.origin,
            source_type=source.source_type,
            template=source.template,
            sales_order_item=so_item,
            production_batch=batch,
            execution_model_version=source.execution_model_version,
            routing_rule=source.routing_rule,
            current_step_index=index,
            current_process=source.current_process,
            process=source.process,
            routing_step_index=source.routing_step_index,
            route_node_id=node,
            route_branch_key=source.route_branch_key,
            route_predecessor_node_ids=list(source.route_predecessor_node_ids or []),
            route_successor_node_ids=list(source.route_successor_node_ids or []),
            input_form=source.input_form,
            output_form=source.output_form,
            work_center=source.work_center,
            from_location=source.from_location,
            to_location=source.to_location,
            priority=source.priority,
            planned_date=source.planned_date,
            quantity=qty,
            remaining_qty=qty,
            uom=source.uom,
            status="QUEUED",
            job_state="PLANNED" if first else "WAITING",
            planner_notes=f"PARTIAL_BALANCE of={origin_job.job_number} qty={qty} {source.uom} | batch:{batch.batch_number} | node:{node}",
            meta_json=meta,
        )
        ExecutionService.calculate_requirements(job.id)
        return job

    @classmethod
    def apply(cls, job, balance_plan, *, user=None):
        """
        Cut the later steps of this batch to what was made and queue the balance. Runs inside
        the close transaction, before the step is finalised, so the line never reads as
        finished while its balance is still to run.
        """
        from apps.production.services.batch_route_service import BatchExecutionService
        from apps.production.services.job_services import JobService

        if not balance_plan:
            return None
        if not getattr(job, "production_batch_id", None):
            BatchExecutionService.backfill_legacy_sales_item_batch(job.sales_order_item)
            job.refresh_from_db(fields=["production_batch"])
        balance_qty = _dec(balance_plan["balance_qty"])
        covered_qty = _dec(balance_plan["covered_qty"])
        uom = balance_plan["uom"]
        downstream = cls._chain_jobs(job)
        reduced = cls._cut_downstream(job, downstream, covered_qty=covered_qty, user=user)

        source_batch = job.production_batch
        if source_batch is not None and str(source_batch.planned_uom or "").upper() == uom:
            # The source batch now plans only what it made; the balance batch plans the rest.
            source_batch.planned_qty = max(Decimal("0"), _dec(source_batch.planned_qty) - balance_qty).quantize(Decimal("0.0001"))
            source_batch.save(update_fields=["planned_qty", "updated_at"])
        batch = cls._balance_batch(job, qty=balance_qty, uom=uom)
        ratio = balance_qty / _dec(job.quantity) if _dec(job.quantity) > 0 else Decimal("1")
        created = [cls._clone_for_balance(job, batch=batch, qty=balance_qty, origin_job=job, first=True, user=user)]
        for source in downstream:
            qty = balance_qty if str(source.uom or "").upper() == uom else _round_qty(_dec(source.quantity) * ratio, source.uom)
            created.append(cls._clone_for_balance(source, batch=batch, qty=qty, origin_job=job, first=False, user=user))
        BatchExecutionService.sync_batch_from_jobs(batch)

        first = created[0]
        release_error = ""
        try:
            with transaction.atomic():
                JobService.release_job(first.id)
        except (ValueError, ValidationError) as exc:
            # The balance still exists (planned); the planner releases it once the gate clears.
            release_error = str(exc)
            logger.info("Balance job %s stays planned: %s", first.job_number, exc)
        first.refresh_from_db()

        summary = {
            "batch_number": batch.batch_number,
            "first_job_id": str(first.id),
            "first_job_number": first.job_number,
            "job_numbers": [row.job_number for row in created],
            "qty": float(balance_qty),
            "uom": uom,
            "balance_kg": float(balance_plan.get("balance_kg") or 0),
            "work_center_name": getattr(first.work_center, "name", "") or "",
            "released": first.job_state == "RELEASED",
            "release_error": release_error,
            "reduced_jobs": [
                {"job_number": row.job_number, "qty": float(row.quantity), "uom": row.uom, "retired": row.job_state == "CANCELLED"}
                for row in reduced
            ],
        }
        meta = dict(job.meta_json or {})
        meta["partial_balance_out"] = summary
        job.meta_json = meta
        job.save(update_fields=["meta_json", "updated_at"])
        return summary
