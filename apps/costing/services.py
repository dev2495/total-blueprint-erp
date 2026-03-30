from __future__ import annotations

import calendar
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any

from django.db import connection, transaction
from django.db.models import Avg, Case, Count, DecimalField, ExpressionWrapper, F, Q, Sum, Value, When
from django.db.models.functions import Coalesce
from django.utils import timezone

from apps.inventory.models import BulkTransaction, PackagingTransaction
from apps.materials.models import InventoryMaterial
from apps.production.models import JobMaterialRequirement, ProductionJob
from apps.sales.models import SalesOrderItem

from .models import (
    CostAbsorptionGroup,
    JobCost,
    JobRuntimeSession,
    MaterialCostSnapshot,
    OrderCost,
    PlantCostPoolLine,
    PlantCostPoolMonth,
    ProcessCostRate,
)

logger = logging.getLogger(__name__)

ZERO = Decimal("0")


@dataclass
class PoolRates:
    conversion_rate_per_hour: Decimal = ZERO
    overhead_rate_per_hour: Decimal = ZERO
    productive_hours: Decimal = ZERO
    unabsorbed_pool_value: Decimal = ZERO
    month_record: PlantCostPoolMonth | None = None
    pool_line: PlantCostPoolLine | None = None


class CostingService:
    COSTING_MODE_ACTUAL = "ACTUAL"
    COSTING_MODE_HYBRID = "HYBRID"
    COSTING_MODE_ESTIMATED = "ESTIMATED"

    @staticmethod
    def _to_decimal(value: Any) -> Decimal:
        if isinstance(value, Decimal):
            return value
        try:
            return Decimal(str(value or 0))
        except Exception:
            return ZERO

    @staticmethod
    def get_material_rate(material: InventoryMaterial) -> Decimal:
        snapshot = MaterialCostSnapshot.objects.filter(material=material).first()
        if snapshot:
            return snapshot.avg_rate_per_kg

        category = str(material.category or "").upper()
        if category in ["GRANULE", "INK", "ADHESIVE", "SOLVENT"]:
            return Decimal("250.00")
        if category in ["FILM_VARIANT", "POD"]:
            return Decimal("180.00")
        if category == "PACKAGING":
            return Decimal("12.00")
        return Decimal("100.00")

    @classmethod
    def resolve_cost_absorption_group(
        cls,
        *,
        machine=None,
        work_center=None,
        template_step=None,
        plant=None,
    ) -> CostAbsorptionGroup | None:
        if machine and getattr(machine, "cost_absorption_group_id", None):
            return machine.cost_absorption_group
        if work_center and getattr(work_center, "default_cost_absorption_group_id", None):
            return work_center.default_cost_absorption_group
        if template_step and getattr(template_step, "cost_absorption_group_id", None):
            return template_step.cost_absorption_group
        if plant and getattr(plant, "default_cost_absorption_group_id", None):
            return plant.default_cost_absorption_group
        return None

    @classmethod
    def get_job_context(cls, job: ProductionJob) -> dict[str, Any]:
        machine = getattr(job, "machine", None)
        work_center = getattr(job, "work_center", None) or getattr(machine, "work_center", None)
        plant = getattr(work_center, "plant", None)
        process = getattr(job, "current_process", None) or getattr(job, "process", None)

        template_step = None
        if getattr(job, "template_id", None):
            try:
                steps = list(job.template.process_steps.select_related("cost_absorption_group", "process").order_by("sequence_number"))
                if steps and 0 <= int(job.current_step_index or 0) < len(steps):
                    template_step = steps[int(job.current_step_index or 0)]
            except Exception:
                template_step = None

        return {
            "machine": machine,
            "work_center": work_center,
            "plant": plant,
            "process": process,
            "template_step": template_step,
            "cost_group": cls.resolve_cost_absorption_group(
                machine=machine,
                work_center=work_center,
                template_step=template_step,
                plant=plant,
            ),
        }

    @classmethod
    def open_runtime_session(cls, job: ProductionJob, user=None, ts: datetime | None = None) -> JobRuntimeSession | None:
        context = cls.get_job_context(job)
        plant = context["plant"]
        if not plant:
            return None

        active = job.runtime_sessions.filter(ended_at__isnull=True).first()
        if active:
            # Refresh mapping if setup changed between assignment and execution.
            changed = False
            if active.machine_id != getattr(context["machine"], "id", None):
                active.machine = context["machine"]
                changed = True
            if active.work_center_id != getattr(context["work_center"], "id", None):
                active.work_center = context["work_center"]
                changed = True
            if active.process_id != getattr(context["process"], "id", None):
                active.process = context["process"]
                changed = True
            if active.cost_absorption_group_id != getattr(context["cost_group"], "id", None):
                active.cost_absorption_group = context["cost_group"]
                changed = True
            if changed:
                active.save(update_fields=["machine", "work_center", "process", "cost_absorption_group"])
            return active

        started_at = ts or timezone.now()
        return JobRuntimeSession.objects.create(
            job=job,
            plant=plant,
            work_center=context["work_center"],
            machine=context["machine"],
            process=context["process"],
            cost_absorption_group=context["cost_group"],
            started_at=started_at,
            started_by=user,
        )

    @classmethod
    def close_runtime_session(
        cls,
        job: ProductionJob,
        close_reason: str,
        user=None,
        ts: datetime | None = None,
    ) -> None:
        ended_at = ts or timezone.now()
        for session in job.runtime_sessions.filter(ended_at__isnull=True).order_by("started_at"):
            if ended_at < session.started_at:
                ended_at = session.started_at
            session.ended_at = ended_at
            session.ended_by = user
            session.close_reason = close_reason
            session.save(update_fields=["ended_at", "ended_by", "close_reason"])

    @classmethod
    def get_job_productive_minutes(cls, job: ProductionJob, as_of: datetime | None = None) -> Decimal:
        as_of = as_of or timezone.now()
        total_seconds = ZERO
        for session in job.runtime_sessions.all():
            end_ts = session.ended_at or as_of
            if end_ts <= session.started_at:
                continue
            total_seconds += Decimal(str((end_ts - session.started_at).total_seconds()))
        return (total_seconds / Decimal("60")).quantize(Decimal("0.0001"))

    @classmethod
    def _month_window(cls, year: int, month: int) -> tuple[datetime, datetime]:
        start = timezone.make_aware(datetime(year, month, 1, 0, 0, 0))
        last_day = calendar.monthrange(year, month)[1]
        end = timezone.make_aware(datetime(year, month, last_day, 23, 59, 59))
        return start, end

    @classmethod
    def get_productive_hours_for_pool(
        cls,
        month_record: PlantCostPoolMonth,
        cost_group: CostAbsorptionGroup,
    ) -> Decimal:
        window_start, window_end = cls._month_window(month_record.year, month_record.month)
        sessions = JobRuntimeSession.objects.filter(
            plant=month_record.plant,
            cost_absorption_group=cost_group,
            started_at__lte=window_end,
        ).filter(Q(ended_at__isnull=True) | Q(ended_at__gte=window_start))

        total_seconds = ZERO
        for session in sessions:
            start_ts = max(session.started_at, window_start)
            end_ts = min(session.ended_at or window_end, window_end)
            if end_ts <= start_ts:
                continue
            total_seconds += Decimal(str((end_ts - start_ts).total_seconds()))
        return (total_seconds / Decimal("3600")).quantize(Decimal("0.0001"))

    @classmethod
    def get_pool_rates_for_timestamp(
        cls,
        *,
        plant,
        cost_group,
        target_dt: datetime | None = None,
    ) -> PoolRates:
        if not plant or not cost_group:
            return PoolRates()

        target_dt = target_dt or timezone.now()
        month_record = PlantCostPoolMonth.objects.filter(
            plant=plant,
            year=target_dt.year,
            month=target_dt.month,
        ).prefetch_related("lines__cost_group").first()
        if not month_record:
            return PoolRates()

        pool_line = month_record.lines.filter(cost_group=cost_group).first()
        if not pool_line:
            return PoolRates(month_record=month_record)

        productive_hours = cls.get_productive_hours_for_pool(month_record, cost_group)
        conversion_total = (
            cls._to_decimal(pool_line.electricity_cost)
            + cls._to_decimal(pool_line.labor_cost)
        )
        overhead_total = (
            cls._to_decimal(pool_line.overhead_cost)
            + cls._to_decimal(pool_line.maintenance_cost)
            + cls._to_decimal(pool_line.service_burden_cost)
        )

        if productive_hours <= 0:
            return PoolRates(
                productive_hours=ZERO,
                unabsorbed_pool_value=(conversion_total + overhead_total),
                month_record=month_record,
                pool_line=pool_line,
            )

        return PoolRates(
            conversion_rate_per_hour=(conversion_total / productive_hours).quantize(Decimal("0.0001")),
            overhead_rate_per_hour=(overhead_total / productive_hours).quantize(Decimal("0.0001")),
            productive_hours=productive_hours,
            month_record=month_record,
            pool_line=pool_line,
        )

    @classmethod
    def get_material_actual_cost(cls, job: ProductionJob) -> tuple[Decimal, bool, list[dict[str, Any]], list[str]]:
        total_cost = ZERO
        has_actuals = False
        flags: list[str] = []
        breakdown: list[dict[str, Any]] = []

        requirements = job.material_requirements.select_related("material", "process_step")
        if not requirements.exists():
            flags.append("NO_JOB_MATERIAL_REQUIREMENTS")
            return total_cost, has_actuals, breakdown, flags

        for requirement in requirements:
            issued = cls._to_decimal(requirement.actual_issued_qty)
            returned = cls._to_decimal(requirement.actual_returned_qty)
            consumed = cls._to_decimal(requirement.consumed_qty)
            scrap = cls._to_decimal(requirement.actual_scrap_qty)
            actual_seen = any(value > 0 for value in [issued, returned, consumed, scrap])
            if not actual_seen:
                flags.append(f"MATERIAL_ACTUALS_MISSING:{requirement.material.code}")
                continue

            has_actuals = True
            actual_qty = issued - returned
            if actual_qty <= 0:
                actual_qty = consumed + scrap
            if actual_qty < 0:
                actual_qty = ZERO

            rate = cls.get_material_rate(requirement.material)
            cost = (actual_qty * rate).quantize(Decimal("0.0001"))
            total_cost += cost
            breakdown.append(
                {
                    "material_code": requirement.material.code,
                    "actual_qty": float(actual_qty),
                    "rate": float(rate),
                    "cost": float(cost),
                    "process_step_id": str(requirement.process_step_id) if requirement.process_step_id else None,
                }
            )

        if not has_actuals:
            flags.append("MATERIAL_ACTUALS_UNAVAILABLE")
        return total_cost, has_actuals, breakdown, flags

    @classmethod
    def get_order_estimated_material_cost(cls, order_item: SalesOrderItem) -> tuple[Decimal, list[dict[str, Any]], list[str]]:
        bom = order_item.bom_snapshot or {}
        if not bom:
            return ZERO, [], ["BOM_SNAPSHOT_MISSING"]

        total_mat_cost = ZERO
        mat_breakdown: list[dict[str, Any]] = []

        for category in ["films", "granules", "inks", "chemicals", "pod", "packaging"]:
            for item in bom.get(category, []):
                qty = cls._to_decimal(item.get("weight_kg") or item.get("qty_kg") or item.get("qty") or 0)
                material_id = item.get("material_id") or item.get("variant_id") or item.get("granule_id")
                if not material_id or qty <= 0:
                    continue
                try:
                    material = InventoryMaterial.objects.get(id=material_id)
                except InventoryMaterial.DoesNotExist:
                    continue
                rate = cls.get_material_rate(material)
                cost = (qty * rate).quantize(Decimal("0.0001"))
                total_mat_cost += cost
                mat_breakdown.append(
                    {
                        "material_code": material.code,
                        "qty": float(qty),
                        "rate": float(rate),
                        "cost": float(cost),
                        "source": "bom_snapshot",
                    }
                )

        flags = [] if total_mat_cost > 0 else ["BOM_ESTIMATE_EMPTY"]
        return total_mat_cost, mat_breakdown, flags

    @classmethod
    def get_estimated_conversion_cost(cls, order_item: SalesOrderItem) -> tuple[Decimal, list[dict[str, Any]], list[str]]:
        total_conv_cost = ZERO
        breakdown: list[dict[str, Any]] = []
        flags: list[str] = []
        routing = getattr(getattr(order_item, "template", None), "routing_rule", None)
        ordered_processes = getattr(routing, "ordered_processes", []) if routing else []
        total_kg = cls._to_decimal(order_item.total_weight_kg or order_item.qty_value)

        if total_kg <= 0:
            flags.append("ORDER_WEIGHT_ZERO")
            return ZERO, breakdown, flags

        if not ordered_processes:
            flags.append("ROUTING_RULE_MISSING")
            return ZERO, breakdown, flags

        for step in ordered_processes:
            process = step.get("process") if isinstance(step, dict) else step
            process_code = process.code if hasattr(process, "code") else str(process or "")
            rate_obj = ProcessCostRate.objects.filter(process__code=process_code, is_active=True).first()
            rate = cls._to_decimal(getattr(rate_obj, "cost_per_hour", ZERO) or Decimal("800.00"))
            est_hours = (total_kg / Decimal("150.0")).quantize(Decimal("0.0001"))
            conv_cost = (est_hours * rate).quantize(Decimal("0.0001"))
            total_conv_cost += conv_cost
            breakdown.append(
                {
                    "process_code": process_code,
                    "estimated_hours": float(est_hours),
                    "rate": float(rate),
                    "cost": float(conv_cost),
                    "source": "legacy_process_rate",
                }
            )

        if total_conv_cost <= 0:
            flags.append("CONVERSION_ESTIMATE_EMPTY")
        return total_conv_cost, breakdown, flags

    @classmethod
    def calculate_job_cost(cls, job: ProductionJob) -> JobCost:
        context = cls.get_job_context(job)
        plant = context["plant"]
        cost_group = context["cost_group"]

        material_cost_actual, material_actual_present, material_breakdown, flags = cls.get_material_actual_cost(job)
        runtime_minutes = cls.get_job_productive_minutes(job)
        runtime_present = runtime_minutes > 0
        if not runtime_present:
            flags.append("RUNTIME_MISSING")
        if not cost_group:
            flags.append("COST_GROUP_UNMAPPED")

        conversion_cost_actual = ZERO
        overhead_cost_absorbed = ZERO
        pool_rates = PoolRates()
        if runtime_present and plant and cost_group:
            reference_dt = (
                job.end_date
                or job.start_date
                or (job.runtime_sessions.order_by("-started_at").values_list("started_at", flat=True).first())
                or timezone.now()
            )
            pool_rates = cls.get_pool_rates_for_timestamp(
                plant=plant,
                cost_group=cost_group,
                target_dt=reference_dt,
            )
            hours = (runtime_minutes / Decimal("60")).quantize(Decimal("0.0001"))
            if pool_rates.pool_line and pool_rates.productive_hours > 0:
                conversion_cost_actual = (hours * pool_rates.conversion_rate_per_hour).quantize(Decimal("0.0001"))
                overhead_cost_absorbed = (hours * pool_rates.overhead_rate_per_hour).quantize(Decimal("0.0001"))
            elif not pool_rates.pool_line:
                flags.append("POOL_LINE_MISSING")
            else:
                flags.append("POOL_UNABSORBED_ZERO_PRODUCTIVE_HOURS")

        actual_components = [
            1 if material_actual_present else 0,
            1 if runtime_present else 0,
            1 if (runtime_present and pool_rates.pool_line and pool_rates.productive_hours > 0) else 0,
        ]
        actual_cost_coverage_pct = (Decimal(sum(actual_components)) / Decimal("3") * Decimal("100")).quantize(Decimal("0.01"))

        if actual_cost_coverage_pct >= Decimal("99.99"):
            costing_mode = cls.COSTING_MODE_ACTUAL
        elif actual_cost_coverage_pct > 0:
            costing_mode = cls.COSTING_MODE_HYBRID
        else:
            costing_mode = cls.COSTING_MODE_ESTIMATED

        total_cost = (material_cost_actual + conversion_cost_actual + overhead_cost_absorbed).quantize(Decimal("0.0001"))
        quantity_basis = cls._to_decimal(job.produced_qty or job.quantity)
        cost_per_kg = (total_cost / quantity_basis).quantize(Decimal("0.0001")) if quantity_basis > 0 else ZERO

        job_cost, _ = JobCost.objects.update_or_create(
            job=job,
            defaults={
                "plant": plant,
                "cost_absorption_group": cost_group,
                "material_cost": material_cost_actual,
                "process_cost": conversion_cost_actual,
                "overhead_cost_absorbed": overhead_cost_absorbed,
                "total_cost": total_cost,
                "material_cost_actual": material_cost_actual,
                "conversion_cost_actual": conversion_cost_actual,
                "runtime_minutes_productive": runtime_minutes,
                "costing_mode": costing_mode,
                "actual_cost_coverage_pct": actual_cost_coverage_pct,
                "coverage_flags": flags,
                "cost_per_kg": cost_per_kg,
                "cost_per_piece": ZERO,
                "calculation_log": {
                    "material_breakdown": material_breakdown,
                    "pool_month_id": str(pool_rates.month_record.id) if pool_rates.month_record else None,
                    "pool_line_id": str(pool_rates.pool_line.id) if pool_rates.pool_line else None,
                    "conversion_rate_per_hour": float(pool_rates.conversion_rate_per_hour),
                    "overhead_rate_per_hour": float(pool_rates.overhead_rate_per_hour),
                    "productive_hours_in_month": float(pool_rates.productive_hours),
                    "unabsorbed_pool_value": float(pool_rates.unabsorbed_pool_value),
                },
            },
        )
        return job_cost

    @classmethod
    def _get_sales_item_revenue(cls, order_item: SalesOrderItem) -> Decimal:
        return cls._to_decimal(getattr(order_item, "line_amount", ZERO))

    @classmethod
    def calculate_order_cost(cls, order_item: SalesOrderItem) -> OrderCost | None:
        linked_jobs = ProductionJob.objects.filter(sales_order_item=order_item).select_related("work_center__plant", "machine")
        job_costs = [cls.calculate_job_cost(job) for job in linked_jobs]

        actual_material = sum((cls._to_decimal(cost.material_cost_actual) for cost in job_costs), ZERO)
        actual_conversion = sum((cls._to_decimal(cost.conversion_cost_actual) for cost in job_costs), ZERO)
        actual_overhead = sum((cls._to_decimal(cost.overhead_cost_absorbed) for cost in job_costs), ZERO)

        packaging_actual = PackagingTransaction.objects.filter(
            Q(sales_order_item=order_item) | Q(job__sales_order_item=order_item),
            type__in=["CONSUME", "PRODUCE"],
        ).aggregate(
            total=Sum(
                ExpressionWrapper(
                    Coalesce(F("avg_cost"), Value(0, output_field=DecimalField(max_digits=12, decimal_places=4)))
                    * F("qty"),
                    output_field=DecimalField(max_digits=18, decimal_places=4),
                )
            )
        )["total"] or ZERO

        bulk_actual = BulkTransaction.objects.filter(
            job__sales_order_item=order_item,
            type="CONSUME",
        ).aggregate(
            total=Sum(
                ExpressionWrapper(
                    Coalesce(F("avg_cost"), Value(0, output_field=DecimalField(max_digits=12, decimal_places=4)))
                    * F("qty_kg"),
                    output_field=DecimalField(max_digits=18, decimal_places=4),
                )
            )
        )["total"] or ZERO

        actual_material += cls._to_decimal(packaging_actual) + cls._to_decimal(bulk_actual)

        estimated_material = ZERO
        estimated_conversion = ZERO
        flags: list[str] = []
        if actual_material <= 0:
            estimated_material, _, est_flags = cls.get_order_estimated_material_cost(order_item)
            flags.extend(est_flags)
        if actual_conversion <= 0:
            estimated_conversion, _, est_flags = cls.get_estimated_conversion_cost(order_item)
            flags.extend(est_flags)

        material_component = actual_material if actual_material > 0 else estimated_material
        conversion_component = actual_conversion if actual_conversion > 0 else estimated_conversion
        overhead_component = actual_overhead

        actual_cost_coverage_pct = ZERO
        coverage_components = [
            1 if actual_material > 0 else 0,
            1 if actual_conversion > 0 else 0,
            1 if actual_overhead > 0 else 0,
        ]
        actual_cost_coverage_pct = (Decimal(sum(coverage_components)) / Decimal("3") * Decimal("100")).quantize(Decimal("0.01"))
        if actual_cost_coverage_pct >= Decimal("99.99"):
            costing_mode = cls.COSTING_MODE_ACTUAL
        elif actual_cost_coverage_pct > 0:
            costing_mode = cls.COSTING_MODE_HYBRID
        else:
            costing_mode = cls.COSTING_MODE_ESTIMATED

        selling_price = cls._get_sales_item_revenue(order_item)
        total_cost = (material_component + conversion_component + overhead_component).quantize(Decimal("0.0001"))
        contribution_margin = (selling_price - material_component - conversion_component).quantize(Decimal("0.0001"))
        absorbed_margin = (selling_price - total_cost).quantize(Decimal("0.0001"))
        contribution_margin_pct = (
            (contribution_margin / selling_price) * Decimal("100")
        ).quantize(Decimal("0.01")) if selling_price > 0 else ZERO
        absorbed_margin_pct = (
            (absorbed_margin / selling_price) * Decimal("100")
        ).quantize(Decimal("0.01")) if selling_price > 0 else ZERO

        order_cost, _ = OrderCost.objects.update_or_create(
            sales_order_item=order_item,
            defaults={
                "material_cost": material_component,
                "conversion_cost": conversion_component,
                "overhead_cost_absorbed": overhead_component,
                "total_cost": total_cost,
                "material_cost_actual": actual_material,
                "conversion_cost_actual": actual_conversion,
                "selling_price": selling_price,
                "margin_value": absorbed_margin,
                "margin_percent": absorbed_margin_pct,
                "contribution_margin": contribution_margin,
                "contribution_margin_percent": contribution_margin_pct,
                "absorbed_margin": absorbed_margin,
                "absorbed_margin_percent": absorbed_margin_pct,
                "costing_mode": costing_mode,
                "actual_cost_coverage_pct": actual_cost_coverage_pct,
                "coverage_flags": flags,
                "is_frozen": False,
            },
        )
        return order_cost

    @classmethod
    def ensure_costs_for_period(cls, date_from=None, date_to=None):
        items = SalesOrderItem.objects.select_related("sales_order", "template")
        if date_from:
            items = items.filter(sales_order__created_at__date__gte=date_from)
        if date_to:
            items = items.filter(sales_order__created_at__date__lte=date_to)
        for item in items.exclude(sales_order__status="CANCELLED"):
            cls.calculate_order_cost(item)

    @classmethod
    def purge_orphan_order_costs(cls) -> int:
        try:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    DELETE FROM costing_order_costs AS coc
                    WHERE NOT EXISTS (
                        SELECT 1
                        FROM sales_order_items AS soi
                        WHERE soi.id = coc.sales_order_item_id
                    )
                    """
                )
                removed = int(cursor.rowcount or 0)
            if removed:
                logger.warning("Purged %s orphan costing_order_costs rows before financial summary.", removed)
            return removed
        except Exception:
            logger.exception("Failed to purge orphan costing_order_costs rows.")
            return 0

    @classmethod
    def get_financial_summary(
        cls,
        year: int = None,
        month: int = None,
        date_from=None,
        date_to=None,
        ensure_costs: bool = False,
    ) -> dict[str, Any]:
        today = timezone.now().date()
        if not year and not month and not date_from:
            year = today.year
            month = today.month

        if date_from and date_to:
            start_date = date_from
            end_date = date_to
        elif year and month:
            start_date = datetime(year, month, 1).date()
            end_date = datetime(year, month, calendar.monthrange(year, month)[1]).date()
        else:
            start_date = datetime(year, 1, 1).date()
            end_date = today

        if ensure_costs:
            cls.purge_orphan_order_costs()
            cls.ensure_costs_for_period(date_from=start_date, date_to=end_date)

        items = SalesOrderItem.objects.filter(
            sales_order__created_at__date__gte=start_date,
            sales_order__created_at__date__lte=end_date,
        ).exclude(sales_order__status="CANCELLED")
        order_costs = OrderCost.objects.filter(sales_order_item__in=items)

        revenue = sum((cls._get_sales_item_revenue(item) for item in items), ZERO)
        aggregate = order_costs.aggregate(
            total_material_actual=Sum("material_cost_actual"),
            total_conversion_actual=Sum("conversion_cost_actual"),
            total_overhead=Sum("overhead_cost_absorbed"),
            total_cost=Sum("total_cost"),
            total_contribution=Sum("contribution_margin"),
            total_absorbed=Sum("absorbed_margin"),
            avg_coverage=Avg("actual_cost_coverage_pct"),
            actual_count=Count("id", filter=Q(costing_mode=cls.COSTING_MODE_ACTUAL)),
            hybrid_count=Count("id", filter=Q(costing_mode=cls.COSTING_MODE_HYBRID)),
            estimated_count=Count("id", filter=Q(costing_mode=cls.COSTING_MODE_ESTIMATED)),
        )

        pool_months = PlantCostPoolMonth.objects.filter(
            year__gte=start_date.year,
            year__lte=end_date.year,
        )
        if start_date.year == end_date.year:
            pool_months = pool_months.filter(month__gte=start_date.month, month__lte=end_date.month)
        pool_lines = PlantCostPoolLine.objects.filter(month_record__in=pool_months)
        pool_totals = pool_lines.aggregate(
            electricity=Sum("electricity_cost"),
            labor=Sum("labor_cost"),
            overhead=Sum("overhead_cost"),
            maintenance=Sum("maintenance_cost"),
            service=Sum("service_burden_cost"),
        )

        absorbed_overhead = cls._to_decimal(aggregate["total_overhead"])
        pool_overhead_total = (
            cls._to_decimal(pool_totals["overhead"])
            + cls._to_decimal(pool_totals["maintenance"])
            + cls._to_decimal(pool_totals["service"])
        )
        unabsorbed_pool_value = max(pool_overhead_total - absorbed_overhead, ZERO)

        material_cost = cls._to_decimal(aggregate["total_material_actual"])
        conversion_cost = cls._to_decimal(aggregate["total_conversion_actual"])
        total_cost = cls._to_decimal(aggregate["total_cost"])
        contribution = cls._to_decimal(aggregate["total_contribution"])
        absorbed = cls._to_decimal(aggregate["total_absorbed"])
        gross_margin_pct = (contribution / revenue * Decimal("100")).quantize(Decimal("0.01")) if revenue > 0 else ZERO
        net_margin_pct = (absorbed / revenue * Decimal("100")).quantize(Decimal("0.01")) if revenue > 0 else ZERO

        period_label = f"{start_date.isoformat()} → {end_date.isoformat()}"
        return {
            "period": period_label,
            "revenue": float(revenue),
            "cogs_material": float(material_cost),
            "cogs_conversion": float(conversion_cost),
            "absorbed_overhead": float(absorbed_overhead),
            "total_cogs": float(total_cost),
            "gross_profit": float(contribution),
            "gross_margin_pct": float(gross_margin_pct),
            "net_profit": float(absorbed),
            "net_margin_pct": float(net_margin_pct),
            "overheads": {
                "electricity": float(cls._to_decimal(pool_totals["electricity"])),
                "labor": float(cls._to_decimal(pool_totals["labor"])),
                "other": float(pool_overhead_total),
                "total_overheads": float(pool_overhead_total),
                "unabsorbed_pool_value": float(unabsorbed_pool_value),
            },
            "coverage": {
                "avg_actual_cost_coverage_pct": float(cls._to_decimal(aggregate["avg_coverage"])),
                "actual_count": aggregate["actual_count"] or 0,
                "hybrid_count": aggregate["hybrid_count"] or 0,
                "estimated_count": aggregate["estimated_count"] or 0,
            },
        }
