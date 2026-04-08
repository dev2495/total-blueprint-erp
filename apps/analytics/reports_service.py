"""
Enterprise Reporting Service — Flexible Packaging ERP
=====================================================
Deep analytics with industry-standard KPIs:
- OEE (85% world-class benchmark)
- First Pass Yield (≥95% target)
- Material scrap rate (industry avg 3-5%)
- OTIF (≥95% target)
- Variance analysis: Theory vs Actual vs Issue vs Plan
"""

from django.db import models as django_models
from django.db.models import (
    Sum, Count, F, Avg, Q, Min, Max,
    ExpressionWrapper, DecimalField, DurationField,
    Case, When, Value, CharField,
)
from django.db.models.functions import TruncDate, TruncMonth, TruncWeek, Coalesce
from django.utils import timezone
from django.utils.dateparse import parse_date
from datetime import date as date_cls, datetime, timedelta
from decimal import Decimal
from collections import defaultdict
import logging

from apps.production.models import (
    ProductionJob,
    JobExecutionLog,
    ScrapLog,
    DowntimeLog,
    MaterialConsumptionLog,
    JobMaterialRequirement,
    DeliveryChallan,
    DeliveryChallanItem,
)
from apps.factory.models import Plant, WorkCenter, Machine, Process, PlantShiftDefinition
from apps.inventory.models import (
    DeliveryChallan as InterPlantDeliveryChallan,
    InterPlantChallanItem,
    InventoryRoll,
    InventoryBulk,
)

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────
# Industry Benchmarks (Flexible Packaging Standards)
# ─────────────────────────────────────────────────────────────
WORLD_CLASS_OEE = 85.0
TARGET_FPY = 95.0
TARGET_SCRAP_RATE = 5.0
TARGET_OTIF = 95.0
TARGET_GROSS_MARGIN = 25.0


def _safe(fn, default=None):
    """Wrap a call so exceptions don't crash the entire report."""
    try:
        return fn()
    except Exception as e:
        logger.warning("ReportService helper failed: %s", e)
        return default


def _has_material_evidence(summary, rows, breakdowns):
    summary = summary or {}
    numeric_keys = (
        "actual_issued_kg",
        "consumed_kg",
        "returned_kg",
        "scrap_kg",
        "ink_actual_issued_kg",
        "ink_consumed_kg",
        "ink_returned_kg",
    )
    if any(float(summary.get(key) or 0) > 0 for key in numeric_keys):
        return True
    if rows:
        return True
    for key in ("by_material", "job_variance", "waterfall"):
        if isinstance((breakdowns or {}).get(key), list) and (breakdowns or {}).get(key):
            return True
    return False


class ReportService:
    """
    Enterprise-grade report generation with deep drill-downs,
    industry benchmarks, and comprehensive variance analysis.
    """

    # ─── Shared Helpers ──────────────────────────────────────

    @staticmethod
    def _normalize_filters(filters=None):
        raw = dict(filters or {})

        def _as_date(value):
            if value is None or value == "":
                return None
            if isinstance(value, datetime):
                return value.date()
            if isinstance(value, date_cls):
                return value
            if isinstance(value, str):
                return parse_date(value.strip())
            return None

        start_date = _as_date(raw.get("start_date") or raw.get("date_from"))
        end_date = _as_date(raw.get("end_date") or raw.get("date_to"))
        if start_date and end_date and start_date > end_date:
            start_date, end_date = end_date, start_date

        raw["start_date"] = start_date
        raw["end_date"] = end_date
        raw["date_from"] = start_date
        raw["date_to"] = end_date

        plant = raw.get("plant_id") or raw.get("plant")
        raw["plant_id"] = str(plant).strip() if plant else None
        raw["plant"] = raw["plant_id"]

        for key in ("wc_id", "machine_id", "shift", "process", "machine"):
            value = raw.get(key)
            raw[key] = str(value).strip() if value not in (None, "") else None

        return raw

    @staticmethod
    def _apply_filters(queryset, filters, date_field='created_at'):
        if not filters:
            return queryset
        filters = ReportService._normalize_filters(filters)
        start_date = filters.get('start_date')
        end_date = filters.get('end_date')
        plant_id = filters.get('plant_id')
        wc_id = filters.get('wc_id')
        machine_id = filters.get('machine_id')
        shift = filters.get('shift')

        if start_date:
            queryset = queryset.filter(**{f"{date_field}__date__gte": start_date})
        if end_date:
            queryset = queryset.filter(**{f"{date_field}__date__lte": end_date})
        if plant_id:
            if hasattr(queryset.model, 'plant'):
                queryset = queryset.filter(plant_id=plant_id)
            elif hasattr(queryset.model, 'machine'):
                queryset = queryset.filter(machine__work_center__plant_id=plant_id)
            elif hasattr(queryset.model, 'production_job'):
                queryset = queryset.filter(
                    Q(production_job__work_center__plant_id=plant_id) |
                    Q(production_job__machine__work_center__plant_id=plant_id)
                )
        if wc_id and hasattr(queryset.model, 'work_center'):
            queryset = queryset.filter(work_center_id=wc_id)
        if machine_id and hasattr(queryset.model, 'machine'):
            queryset = queryset.filter(machine_id=machine_id)
        if shift:
            if hasattr(queryset.model, "shift_code"):
                queryset = queryset.filter(shift_code__iexact=shift)
            elif hasattr(queryset.model, "production_job"):
                queryset = queryset.filter(production_job__execution_logs__shift_code__iexact=shift).distinct()
            elif queryset.model.__name__ == "ProductionJob":
                queryset = queryset.filter(execution_logs__shift_code__iexact=shift).distinct()
        return queryset

    @staticmethod
    def _default_date_range(filters):
        """Ensure filters has date range; default to last 30 days."""
        filters = ReportService._normalize_filters(filters)
        if not filters.get('start_date') and not filters.get('end_date'):
            end = timezone.now().date()
            start = end - timedelta(days=30)
            filters['start_date'] = start
            filters['end_date'] = end
            filters['date_from'] = start
            filters['date_to'] = end
        return filters

    @staticmethod
    def _pct(num, denom, decimals=1):
        return round(num / denom * 100, decimals) if denom else 0.0

    @staticmethod
    def _delta_pct(current, previous, decimals=1):
        """Percentage change from previous to current period."""
        if not previous:
            return 0.0
        return round((current - previous) / previous * 100, decimals)

    # ═══════════════════════════════════════════════════════════
    # 1. PRODUCTION PERFORMANCE
    # ═══════════════════════════════════════════════════════════
    @staticmethod
    def get_production_performance(filters=None):
        filters = ReportService._default_date_range(filters or {})

        # Base queries
        logs = JobExecutionLog.objects.select_related(
            'production_job__machine', 'production_job__work_center',
            'production_job__current_process', 'production_job__process',
            'production_job__template', 'production_job__sales_order_item__sales_order',
            'logged_by'
        )
        logs = ReportService._apply_filters(logs, filters, date_field='logged_at')

        scrap_logs = ScrapLog.objects.select_related(
            'production_job__machine',
            'production_job__work_center',
            'production_job__current_process',
            'production_job__template',
            'logged_by',
        )
        scrap_logs = ReportService._apply_filters(scrap_logs, filters, date_field='logged_at')

        jobs = ProductionJob.objects.select_related(
            'template',
            'sales_order_item__sales_order',
            'current_process',
            'process',
            'work_center',
            'machine',
            'operator',
            'closed_by',
        )
        jobs = ReportService._apply_filters(jobs, filters, date_field='created_at')

        # ── Aggregates ──
        total_output = float(logs.aggregate(total=Sum('quantity'))['total'] or 0)
        total_scrap = float(scrap_logs.aggregate(total=Sum('quantity'))['total'] or 0)
        total_processed = total_output + total_scrap
        yield_pct = ReportService._pct(total_output, total_processed)
        scrap_rate = round(100 - yield_pct, 1)

        # Previous period comparison
        start = filters.get('start_date')
        end = filters.get('end_date')
        if start and end:
            duration = (end - start).days
            prev_end = start - timedelta(days=1)
            prev_start = prev_end - timedelta(days=duration)
            prev_output = float(
                JobExecutionLog.objects.filter(
                    logged_at__date__gte=prev_start, logged_at__date__lte=prev_end
                ).aggregate(total=Sum('quantity'))['total'] or 0
            )
        else:
            prev_output = 0
        output_trend_pct = ReportService._delta_pct(total_output, prev_output)

        # Jobs summary
        total_jobs = jobs.count()
        completed_jobs = jobs.filter(status='COMPLETED').count()
        running_jobs = jobs.filter(job_state='EXECUTING').count()
        planned_jobs = jobs.filter(job_state='PLANNED').count()
        released_jobs = jobs.filter(job_state='RELEASED').count()
        paused_jobs = jobs.filter(job_state='PAUSED').count()
        completion_rate = ReportService._pct(completed_jobs, total_jobs)
        active_work_centers = jobs.exclude(work_center__isnull=True).values('work_center_id').distinct().count()
        active_machines = jobs.exclude(machine__isnull=True).values('machine_id').distinct().count()
        avg_job_size = float(jobs.aggregate(avg=Avg('quantity'))['avg'] or 0)
        avg_output_per_machine = round(total_output / active_machines, 2) if active_machines else 0
        jobs_with_scrap = scrap_logs.values('production_job_id').distinct().count()

        # ── Machine Breakdown ──
        machine_stats = logs.values(
            'production_job__machine__name',
            'production_job__machine__code',
            'production_job__machine__standard_rate_kg_per_hour',
        ).annotate(
            actual_output=Sum('quantity'),
            log_count=Count('id'),
        ).order_by('-actual_output')

        breakdown = []
        for m in machine_stats:
            name = m['production_job__machine__name'] or "Unknown"
            code = m['production_job__machine__code'] or ""
            actual = float(m['actual_output'] or 0)
            std_rate = float(m['production_job__machine__standard_rate_kg_per_hour'] or 0)
            earned_hours = actual / std_rate if std_rate > 0 else 0

            # Scrap for this machine
            m_scrap = float(scrap_logs.filter(
                production_job__machine__name=name
            ).aggregate(s=Sum('quantity'))['s'] or 0)
            m_yield = ReportService._pct(actual, actual + m_scrap)

            breakdown.append({
                "machine": f"{name} ({code})" if code else name,
                "actual_output": round(actual, 2),
                "standard_rate": std_rate,
                "earned_hours": round(earned_hours, 2),
                "log_count": m['log_count'] or 0,
                "scrap_kg": round(m_scrap, 2),
                "yield_pct": m_yield,
            })

        # ── Process-wise Output ──
        by_process = logs.values(
            process_name=Coalesce(
                'production_job__current_process__name',
                'production_job__process__name',
                Value('Other'),
            )
        ).annotate(output=Sum('quantity')).order_by('-output')[:10]
        process_dist = [
            {"name": p['process_name'], "value": round(float(p['output'] or 0), 2)}
            for p in by_process
        ]

        # ── Work-center / shift / state / scrap reason splits ──
        by_work_center = logs.values(
            wc_name=Coalesce('production_job__work_center__name', Value('Unassigned')),
        ).annotate(
            output_kg=Sum('quantity'),
            log_count=Count('id'),
            job_count=Count('production_job_id', distinct=True),
        ).order_by('-output_kg')[:10]
        work_center_dist = [
            {
                "work_center": row['wc_name'],
                "output_kg": round(float(row['output_kg'] or 0), 2),
                "log_count": row['log_count'] or 0,
                "job_count": row['job_count'] or 0,
            }
            for row in by_work_center
        ]

        shift_output_map = {
            str(row['shift_code'] or 'UNSPECIFIED'): round(float(row['output_kg'] or 0), 2)
            for row in logs.values('shift_code').annotate(output_kg=Sum('quantity'))
        }
        shift_scrap_map = {
            str(row['shift_code'] or 'UNSPECIFIED'): round(float(row['scrap_kg'] or 0), 2)
            for row in scrap_logs.values('shift_code').annotate(scrap_kg=Sum('quantity'))
        }
        by_shift = []
        for shift_code in sorted(set(shift_output_map) | set(shift_scrap_map)):
            output_kg = float(shift_output_map.get(shift_code) or 0)
            scrap_kg = float(shift_scrap_map.get(shift_code) or 0)
            by_shift.append({
                "shift_code": shift_code,
                "output_kg": round(output_kg, 2),
                "scrap_kg": round(scrap_kg, 2),
                "yield_pct": ReportService._pct(output_kg, output_kg + scrap_kg),
            })
        by_shift.sort(key=lambda row: row["output_kg"], reverse=True)

        by_job_state = jobs.values('job_state').annotate(count=Count('id')).order_by('-count')
        state_dist = [
            {"state": row['job_state'] or 'UNKNOWN', "count": row['count'] or 0}
            for row in by_job_state
        ]

        scrap_reason_dist = [
            {
                "reason": row['reason'] or 'OTHER',
                "scrap_kg": round(float(row['scrap_kg'] or 0), 2),
                "event_count": row['event_count'] or 0,
            }
            for row in scrap_logs.values('reason').annotate(scrap_kg=Sum('quantity'), event_count=Count('id')).order_by('-scrap_kg')[:10]
        ]

        operator_dist = [
            {
                "operator": row['operator_name'],
                "output_kg": round(float(row['output_kg'] or 0), 2),
                "log_count": row['log_count'] or 0,
            }
            for row in logs.values(
                operator_name=Coalesce('logged_by__username', Value('Unassigned'))
            ).annotate(output_kg=Sum('quantity'), log_count=Count('id')).order_by('-output_kg')[:10]
        ]

        # ── Daily Trend ──
        trend_scrap_map = {
            row['date']: round(float(row['scrap_kg'] or 0), 2)
            for row in scrap_logs.annotate(date=TruncDate('logged_at')).values('date').annotate(
                scrap_kg=Sum('quantity')
            ).order_by('date')
        }
        trend_qs = logs.annotate(date=TruncDate('logged_at')).values('date').annotate(
            output_kg=Sum('quantity')
        ).order_by('date')
        trend = [
            {
                "date": t['date'].strftime("%Y-%m-%d"),
                "output_kg": round(float(t['output_kg'] or 0), 2),
                "scrap_kg": float(trend_scrap_map.get(t['date']) or 0),
                "yield_pct": ReportService._pct(float(t['output_kg'] or 0), float(t['output_kg'] or 0) + float(trend_scrap_map.get(t['date']) or 0)),
            }
            for t in trend_qs
        ]

        # Target line (avg * 1.1)
        avg_daily = total_output / max(len(trend), 1)
        target_daily = round(avg_daily * 1.1, 2)

        # ── Row-level production truth ──
        job_output_map = {
            row['production_job_id']: round(float(row['output_kg'] or 0), 2)
            for row in logs.values('production_job_id').annotate(output_kg=Sum('quantity'))
        }
        job_last_log_map = {
            row['production_job_id']: row['last_logged_at']
            for row in logs.values('production_job_id').annotate(last_logged_at=Max('logged_at'))
        }
        job_scrap_map = {
            row['production_job_id']: round(float(row['scrap_kg'] or 0), 2)
            for row in scrap_logs.values('production_job_id').annotate(scrap_kg=Sum('quantity'))
        }
        recent_jobs = []
        for job in jobs.order_by('-updated_at', '-created_at')[:60]:
            produced_kg = float(job_output_map.get(job.id) or job.produced_qty or 0)
            scrap_kg = float(job_scrap_map.get(job.id) or 0)
            planned_kg = float(job.quantity or 0)
            recent_jobs.append({
                "job_number": job.job_number,
                "source": job.source_type,
                "customer": getattr(getattr(job.sales_order_item, 'sales_order', None), 'customer_name', '') or 'Internal',
                "template": getattr(job.template, 'name', '') or 'Custom',
                "process": getattr(job.current_process, 'name', '') or getattr(job.process, 'name', '') or 'Pending',
                "work_center": getattr(job.work_center, 'name', '') or 'Unassigned',
                "machine": getattr(job.machine, 'name', '') or 'Unassigned',
                "operator": getattr(job.operator, 'username', '') or '—',
                "job_state": job.job_state,
                "status": job.status,
                "planned_qty_kg": round(planned_kg, 2),
                "produced_qty_kg": round(produced_kg, 2),
                "remaining_qty_kg": round(float(job.remaining_qty or max(planned_kg - produced_kg, 0)), 2),
                "scrap_kg": round(scrap_kg, 2),
                "yield_pct": ReportService._pct(produced_kg, produced_kg + scrap_kg),
                "last_log_at": job_last_log_map.get(job.id).isoformat() if job_last_log_map.get(job.id) else None,
            })

        warnings = []
        if total_jobs and not total_output:
            warnings.append("Jobs exist in the selected window but no execution output was logged.")
        if total_scrap > total_output and total_scrap > 0:
            warnings.append("Scrap exceeded good output in the selected production window.")

        breakdowns = {
            "by_process": process_dist,
            "by_work_center": work_center_dist,
            "by_shift": by_shift,
            "by_machine": breakdown,
            "by_job_state": state_dist,
            "scrap_reasons": scrap_reason_dist,
            "by_operator": operator_dist,
        }

        return {
            "summary": {
                "total_output_kg": round(total_output, 2),
                "total_scrap_kg": round(total_scrap, 2),
                "yield_pct": yield_pct,
                "scrap_rate": scrap_rate,
                "active_machines": active_machines,
                "active_work_centers": active_work_centers,
                "total_jobs": total_jobs,
                "completed_jobs": completed_jobs,
                "running_jobs": running_jobs,
                "planned_jobs": planned_jobs,
                "released_jobs": released_jobs,
                "paused_jobs": paused_jobs,
                "jobs_with_scrap": jobs_with_scrap,
                "completion_rate": completion_rate,
                "output_trend_pct": output_trend_pct,
                "target_daily_output": target_daily,
                "avg_job_size_kg": round(avg_job_size, 2),
                "avg_output_per_machine_kg": avg_output_per_machine,
            },
            "trend": trend,
            "series": trend,
            "breakdown": breakdown,
            "breakdowns": breakdowns,
            "by_process": process_dist,
            "by_work_center": work_center_dist,
            "by_shift": by_shift,
            "by_machine": breakdown,
            "by_job_state": state_dist,
            "scrap_reasons": scrap_reason_dist,
            "by_operator": operator_dist,
            "rows": recent_jobs,
            "warnings": warnings,
            "benchmarks": {
                "target_scrap_rate": TARGET_SCRAP_RATE,
                "target_fpy": TARGET_FPY,
            },
        }

    # ═══════════════════════════════════════════════════════════
    # 2. OEE DEEP DIVE
    # ═══════════════════════════════════════════════════════════
    @staticmethod
    def get_oee_deep_dive(filters=None):
        filters = ReportService._default_date_range(filters or {})
        start_date = filters.get("start_date")
        end_date = filters.get("end_date")

        machines = Machine.objects.select_related("work_center").filter(status="ACTIVE")
        if filters.get("plant_id"):
            machines = machines.filter(work_center__plant_id=filters["plant_id"])
        if filters.get("machine_id"):
            machines = machines.filter(id=filters["machine_id"])

        machine_list = list(machines)
        days_in_window = max((end_date - start_date).days + 1, 1)
        total_window_hours = float(days_in_window * 24)
        rows = []
        global_availability = []
        global_performance = []
        global_quality = []

        for machine in machine_list:
            downtime = DowntimeLog.objects.filter(
                production_job__machine=machine,
                start_time__date__gte=start_date,
                start_time__date__lte=end_date,
            ).aggregate(
                total=Sum(ExpressionWrapper(F("end_time") - F("start_time"), output_field=DurationField()))
            )["total"]
            downtime_hours = float(downtime.total_seconds() / 3600) if downtime else 0.0
            available_hours = max(total_window_hours - downtime_hours, 0.0)
            availability = (available_hours / total_window_hours) if total_window_hours > 0 else 0.0

            produced = float(
                JobExecutionLog.objects.filter(
                    production_job__machine=machine,
                    logged_at__date__gte=start_date,
                    logged_at__date__lte=end_date,
                ).aggregate(total=Sum("quantity"))["total"]
                or 0
            )
            scrap = float(
                ScrapLog.objects.filter(
                    production_job__machine=machine,
                    logged_at__date__gte=start_date,
                    logged_at__date__lte=end_date,
                ).aggregate(total=Sum("quantity"))["total"]
                or 0
            )

            standard_rate = float(machine.standard_rate_kg_per_hour or 0)
            theoretical_output = standard_rate * available_hours if standard_rate > 0 else 0.0
            performance = (produced / theoretical_output) if theoretical_output > 0 else 0.0
            total_processed = produced + scrap
            quality = (produced / total_processed) if total_processed > 0 else 0.0
            oee = availability * performance * quality

            row = {
                "machine_id": str(machine.id),
                "machine_name": machine.name,
                "machine_code": machine.code,
                "work_center": machine.work_center.name if machine.work_center else "Unassigned",
                "availability": round(availability * 100, 1),
                "performance": round(performance * 100, 1),
                "quality": round(quality * 100, 1),
                "oee": round(oee * 100, 1),
                "downtime_hours": round(downtime_hours, 2),
                "produced_kg": round(produced, 3),
                "scrap_kg": round(scrap, 3),
                "theoretical_output_kg": round(theoretical_output, 3),
            }
            rows.append(row)
            global_availability.append(availability)
            global_performance.append(performance)
            global_quality.append(quality)

        rows.sort(key=lambda row: float(row["oee"] or 0), reverse=True)
        top_machine = rows[0] if rows else None
        bottom_machine = rows[-1] if rows else None

        work_center_rollup = {}
        for row in rows:
            bucket = work_center_rollup.setdefault(
                row["work_center"],
                {
                    "work_center": row["work_center"],
                    "machine_count": 0,
                    "oee_total": 0.0,
                    "availability_total": 0.0,
                    "performance_total": 0.0,
                    "quality_total": 0.0,
                    "output_total": 0.0,
                    "scrap_total": 0.0,
                },
            )
            bucket["machine_count"] += 1
            bucket["oee_total"] += float(row["oee"] or 0)
            bucket["availability_total"] += float(row["availability"] or 0)
            bucket["performance_total"] += float(row["performance"] or 0)
            bucket["quality_total"] += float(row["quality"] or 0)
            bucket["output_total"] += float(row["produced_kg"] or 0)
            bucket["scrap_total"] += float(row["scrap_kg"] or 0)

        work_center_rows = sorted(
            [
                {
                    "work_center": value["work_center"],
                    "machines": value["machine_count"],
                    "avg_oee": round(value["oee_total"] / value["machine_count"], 1),
                    "avg_availability": round(value["availability_total"] / value["machine_count"], 1),
                    "avg_performance": round(value["performance_total"] / value["machine_count"], 1),
                    "avg_quality": round(value["quality_total"] / value["machine_count"], 1),
                    "output_kg": round(value["output_total"], 3),
                    "scrap_kg": round(value["scrap_total"], 3),
                }
                for value in work_center_rollup.values()
            ],
            key=lambda row: row["avg_oee"],
            reverse=True,
        )

        oee_band_rows = [
            {"band": "World Class", "machines": len([row for row in rows if float(row["oee"] or 0) >= 85]), "threshold": ">= 85%"},
            {"band": "Stable", "machines": len([row for row in rows if 60 <= float(row["oee"] or 0) < 85]), "threshold": "60-84.9%"},
            {"band": "Attention", "machines": len([row for row in rows if float(row["oee"] or 0) < 60]), "threshold": "< 60%"},
        ]
        oee_band_rows = [row for row in oee_band_rows if row["machines"] > 0]

        trend_data = []
        machine_ids = [machine.id for machine in machine_list]
        cursor = start_date
        while cursor <= end_date:
            day_output = Decimal(
                str(
                    JobExecutionLog.objects.filter(
                        production_job__machine_id__in=machine_ids,
                        logged_at__date=cursor,
                    ).aggregate(total=Sum("quantity"))["total"]
                    or 0
                )
            )
            day_scrap = Decimal(
                str(
                    ScrapLog.objects.filter(
                        production_job__machine_id__in=machine_ids,
                        logged_at__date=cursor,
                    ).aggregate(total=Sum("quantity"))["total"]
                    or 0
                )
            )
            day_downtime = DowntimeLog.objects.filter(
                production_job__machine_id__in=machine_ids,
                start_time__date=cursor,
            ).aggregate(
                total=Sum(ExpressionWrapper(F("end_time") - F("start_time"), output_field=DurationField()))
            )["total"]
            day_downtime_hours = Decimal(str(day_downtime.total_seconds() / 3600.0 if day_downtime else 0))
            total_machine_hours = Decimal(str(max(len(machine_ids), 1) * 24))
            available_hours = max(Decimal("0"), total_machine_hours - day_downtime_hours)
            std_rate_total = Decimal(str(sum(Decimal(str(machine.standard_rate_kg_per_hour or 0)) for machine in machine_list)))
            earned_hours = (day_output / std_rate_total) if std_rate_total > 0 else Decimal("0")
            availability = (available_hours / total_machine_hours) if total_machine_hours > 0 else Decimal("0")
            performance = (earned_hours / available_hours) if available_hours > 0 else Decimal("0")
            total_processed = day_output + day_scrap
            quality = (day_output / total_processed) if total_processed > 0 else Decimal("0")
            day_oee = availability * performance * quality * Decimal("100")
            trend_data.append(
                {
                    "date": cursor.strftime("%Y-%m-%d"),
                    "value": float(round(day_oee, 2)),
                    "output_kg": float(round(day_output, 3)),
                    "scrap_kg": float(round(day_scrap, 3)),
                    "downtime_hours": float(round(day_downtime_hours, 3)),
                }
            )
            cursor += timedelta(days=1)

        avg_availability = (sum(global_availability) / len(global_availability)) if global_availability else 0.0
        avg_performance = (sum(global_performance) / len(global_performance)) if global_performance else 0.0
        avg_quality = (sum(global_quality) / len(global_quality)) if global_quality else 0.0
        avg_oee = avg_availability * avg_performance * avg_quality * 100
        total_output = sum(float(row["produced_kg"] or 0) for row in rows)
        total_scrap = sum(float(row["scrap_kg"] or 0) for row in rows)

        return {
            "summary": {
                "avg_oee": round(avg_oee, 1),
                "machines_tracked": len(rows),
                "global_availability": round(avg_availability * 100, 1),
                "global_performance": round(avg_performance * 100, 1),
                "global_quality": round(avg_quality * 100, 1),
                "output_kg": round(total_output, 3),
                "scrap_kg": round(total_scrap, 3),
                "top_machine": top_machine["machine_name"] if top_machine else "—",
                "lowest_machine": bottom_machine["machine_name"] if bottom_machine else "—",
            },
            "kpis": {
                "avg_oee": round(avg_oee, 1),
                "machines_tracked": len(rows),
                "global_availability": round(avg_availability * 100, 1),
                "global_performance": round(avg_performance * 100, 1),
                "global_quality": round(avg_quality * 100, 1),
            },
            "breakdown": rows,
            "breakdowns": {
                "by_machine": rows,
                "by_work_center": work_center_rows,
                "oee_bands": oee_band_rows,
            },
            "trend": trend_data,
            "series": trend_data,
            "charts": {
                "trend": trend_data,
                "distribution": [{"name": row["machine_name"], "value": row["oee"]} for row in rows],
            },
            "rows": rows,
            "best_machine": {"name": top_machine["machine_name"], "oee": top_machine["oee"]} if top_machine else None,
            "worst_machine": {"name": bottom_machine["machine_name"], "oee": bottom_machine["oee"]} if bottom_machine else None,
            "benchmarks": {
                "world_class_oee": WORLD_CLASS_OEE,
                "target_availability": 90.0,
                "target_performance": 95.0,
                "target_quality": 99.0,
            },
            "warnings": [] if rows else ["No machine telemetry found in the selected window."],
        }

    # ═══════════════════════════════════════════════════════════
    # 3. DOWNTIME ANALYSIS
    # ═══════════════════════════════════════════════════════════
    @staticmethod
    def get_downtime_analysis(filters=None):
        filters = ReportService._default_date_range(filters or {})

        logs = DowntimeLog.objects.select_related('production_job__machine').filter(end_time__isnull=False)
        logs = ReportService._apply_filters(logs, filters, date_field='start_time')

        total_duration = logs.aggregate(
            total=Sum(ExpressionWrapper(F('end_time') - F('start_time'), output_field=DurationField()))
        )['total']
        total_minutes = int(total_duration.total_seconds() / 60) if total_duration else 0
        total_events = logs.count()
        mttr = round(total_minutes / total_events, 1) if total_events > 0 else 0

        # Pareto by reason
        reasons = logs.values('reason').annotate(
            duration=Sum(ExpressionWrapper(F('end_time') - F('start_time'), output_field=DurationField())),
            count=Count('id'),
        ).order_by('-duration')

        pareto = []
        cumulative = 0
        for r in reasons:
            mins = int(r['duration'].total_seconds() / 60) if r['duration'] else 0
            cumulative += mins
            pareto.append({
                "reason": r['reason'],
                "minutes": mins,
                "hours": round(mins / 60, 1),
                "count": r['count'],
                "pct": ReportService._pct(mins, total_minutes),
                "cumulative_pct": ReportService._pct(cumulative, total_minutes),
            })

        # Top offender machines
        offenders = logs.values('production_job__machine__name').annotate(
            duration=Sum(ExpressionWrapper(F('end_time') - F('start_time'), output_field=DurationField())),
            count=Count('id'),
        ).order_by('-duration')[:10]

        top_machines = [{
            "machine": o['production_job__machine__name'] or "Unknown",
            "minutes": int(o['duration'].total_seconds() / 60) if o['duration'] else 0,
            "count": o['count'],
        } for o in offenders]

        # Daily trend
        daily = logs.annotate(date=TruncDate('start_time')).values('date').annotate(
            duration=Sum(ExpressionWrapper(F('end_time') - F('start_time'), output_field=DurationField())),
            events=Count('id'),
        ).order_by('date')

        daily_trend = [{
            "date": d['date'].strftime("%Y-%m-%d"),
            "minutes": int(d['duration'].total_seconds() / 60) if d['duration'] else 0,
            "events": d['events'],
        } for d in daily]

        return {
            "summary": {
                "total_downtime_minutes": total_minutes,
                "total_downtime_hours": round(total_minutes / 60, 1),
                "total_events": total_events,
                "mttr_minutes": mttr,
                "avg_events_per_day": round(total_events / max(len(daily_trend), 1), 1),
            },
            "pareto": pareto,
            "top_machines": top_machines,
            "daily_trend": daily_trend,
        }

    # ═══════════════════════════════════════════════════════════
    # 4. SCRAP & YIELD
    # ═══════════════════════════════════════════════════════════
    @staticmethod
    def get_scrap_yield(filters=None):
        filters = ReportService._default_date_range(filters or {})

        scrap_logs = ScrapLog.objects.select_related(
            'production_job__machine', 'production_job__current_process',
            'production_job__process', 'logged_by',
        )
        scrap_logs = ReportService._apply_filters(scrap_logs, filters, date_field='logged_at')

        good_logs = JobExecutionLog.objects.all()
        good_logs = ReportService._apply_filters(good_logs, filters, date_field='logged_at')

        consumption_logs = MaterialConsumptionLog.objects.select_related(
            'production_job', 'material'
        )
        consumption_logs = ReportService._apply_filters(consumption_logs, filters, date_field='logged_at')

        total_scrap = float(scrap_logs.aggregate(total=Sum('quantity'))['total'] or 0)
        total_good = float(good_logs.aggregate(total=Sum('quantity'))['total'] or 0)
        total_consumed = float(consumption_logs.aggregate(total=Sum('quantity'))['total'] or 0)
        total_processed = total_good + total_scrap
        yield_pct = ReportService._pct(total_good, total_processed)
        scrap_rate = round(100 - yield_pct, 2)
        jobs_with_scrap = scrap_logs.values('production_job_id').distinct().count()
        total_events = scrap_logs.count()

        # Cost of scrap (use material cost snapshots if available)
        try:
            from apps.costing.models import MaterialCostSnapshot
            avg_cost = float(
                MaterialCostSnapshot.objects.aggregate(avg=Avg('avg_rate_per_kg'))['avg'] or 250
            )
        except Exception:
            avg_cost = 250.0
        cost_of_scrap = round(total_scrap * avg_cost, 2)

        # By Reason
        by_reason = scrap_logs.values('reason').annotate(
            quantity=Sum('quantity'), count=Count('id'),
        ).order_by('-quantity')
        reasons_data = [{
            "name": r['reason'], "value": round(float(r['quantity'] or 0), 2),
            "count": r['count'],
            "pct": ReportService._pct(float(r['quantity'] or 0), total_scrap),
        } for r in by_reason]

        # By Machine
        by_machine = scrap_logs.values('production_job__machine__name').annotate(
            quantity=Sum('quantity'),
        ).order_by('-quantity')[:8]
        machine_data = [{
            "machine": m['production_job__machine__name'] or "Unknown",
            "scrap": round(float(m['quantity'] or 0), 2),
        } for m in by_machine]

        # By Process
        by_process = scrap_logs.values(
            process_name=Coalesce(
                'production_job__current_process__name',
                'production_job__process__name',
                Value('Other'),
            )
        ).annotate(
            scrap=Sum('quantity'),
        ).order_by('-scrap')[:8]

        # For process yield, also get good output per process
        process_yield = []
        for p in by_process:
            proc_scrap = float(p['scrap'] or 0)
            proc_good = float(good_logs.filter(
                Q(production_job__current_process__name=p['process_name']) |
                Q(production_job__process__name=p['process_name'])
            ).aggregate(g=Sum('quantity'))['g'] or 0)
            proc_total = proc_good + proc_scrap
            process_yield.append({
                "process": p['process_name'],
                "scrap_kg": round(proc_scrap, 2),
                "good_kg": round(proc_good, 2),
                "yield_pct": ReportService._pct(proc_good, proc_total),
            })

        # By Operator
        by_operator = scrap_logs.values('logged_by__username').annotate(
            quantity=Sum('quantity'), count=Count('id'),
        ).order_by('-quantity')[:10]
        operator_scrap = [{
            "operator": o['logged_by__username'] or "System",
            "scrap_kg": round(float(o['quantity'] or 0), 2),
            "events": o['count'],
        } for o in by_operator]

        # Daily trend
        daily = scrap_logs.annotate(date=TruncDate('logged_at')).values('date').annotate(
            scrap=Sum('quantity'), events=Count('id'),
        ).order_by('date')
        daily_trend = [{
            "date": d['date'].strftime("%Y-%m-%d"),
            "scrap_kg": round(float(d['scrap'] or 0), 2),
            "events": d['events'],
            "cost": round(float(d['scrap'] or 0) * avg_cost, 2),
        } for d in daily]

        scrap_by_job = {
            row['production_job_id']: {
                'scrap_kg': float(row['scrap'] or 0),
                'events': int(row['events'] or 0),
            }
            for row in scrap_logs.values('production_job_id').annotate(
                scrap=Sum('quantity'),
                events=Count('id'),
            )
        }
        good_by_job = {
            row['production_job_id']: float(row['good'] or 0)
            for row in good_logs.values('production_job_id').annotate(good=Sum('quantity'))
        }
        job_ids = list(scrap_by_job.keys())
        jobs = {
            job.id: job
            for job in ProductionJob.objects.filter(id__in=job_ids).select_related(
                'machine',
                'current_process',
                'process',
                'template',
            )
        }
        top_jobs = []
        for job_id, totals in sorted(scrap_by_job.items(), key=lambda item: item[1]['scrap_kg'], reverse=True)[:15]:
            job = jobs.get(job_id)
            good_qty = float(good_by_job.get(job_id, 0))
            total_qty = good_qty + totals['scrap_kg']
            top_jobs.append({
                "job_id": str(job_id),
                "job_number": job.job_number if job else "Unknown",
                "template_name": job.template.name if job and job.template else "Custom",
                "machine_name": job.machine.name if job and job.machine else "Unassigned",
                "process_name": (
                    job.current_process.name if job and job.current_process else
                    (job.process.name if job and job.process else "Other")
                ),
                "good_kg": round(good_qty, 2),
                "scrap_kg": round(totals['scrap_kg'], 2),
                "events": totals['events'],
                "yield_pct": ReportService._pct(good_qty, total_qty),
            })

        recent_events = [{
            "timestamp": log.logged_at.isoformat() if log.logged_at else None,
            "reason": log.reason,
            "quantity_kg": round(float(log.quantity or 0), 2),
            "job_number": log.production_job.job_number if log.production_job else None,
            "machine_name": (
                log.production_job.machine.name
                if log.production_job and log.production_job.machine
                else "Unassigned"
            ),
            "process_name": (
                log.production_job.current_process.name
                if log.production_job and log.production_job.current_process
                else (
                    log.production_job.process.name
                    if log.production_job and log.production_job.process
                    else "Other"
                )
            ),
            "logged_by": log.logged_by.username if log.logged_by else "System",
        } for log in scrap_logs.order_by('-logged_at')[:60]]

        top_reason = reasons_data[0]["name"] if reasons_data else "None"
        top_machine = machine_data[0]["machine"] if machine_data else "Unknown"
        avg_scrap_per_event = round((total_scrap / total_events), 2) if total_events else 0.0

        return {
            "summary": {
                "total_scrap_kg": round(total_scrap, 2),
                "total_good_kg": round(total_good, 2),
                "total_processed_kg": round(total_processed, 2),
                "total_output_kg": round(total_good, 2),
                "total_consumed_kg": round(total_consumed, 2),
                "yield_pct": yield_pct,
                "scrap_rate": scrap_rate,
                "cost_of_scrap": cost_of_scrap,
                "avg_cost_per_kg": avg_cost,
                "total_events": total_events,
                "avg_scrap_per_event_kg": avg_scrap_per_event,
                "jobs_with_scrap": jobs_with_scrap,
                "top_reason": top_reason,
                "top_machine": top_machine,
            },
            "series": daily_trend,
            "rows": recent_events,
            "breakdowns": {
                "by_reason": reasons_data,
                "by_machine": machine_data,
                "by_process": process_yield,
                "by_operator": operator_scrap,
                "top_jobs": top_jobs,
            },
            "by_reason": reasons_data,
            "by_machine": machine_data,
            "by_process": process_yield,
            "by_operator": operator_scrap,
            "daily_trend": daily_trend,
            "top_jobs": top_jobs,
            "recent_events": recent_events,
            "benchmarks": {
                "target_scrap_rate": TARGET_SCRAP_RATE,
                "target_yield": TARGET_FPY,
            },
            "warnings": [] if total_events else ["No scrap events were logged for the selected filter window."],
        }

    # ═══════════════════════════════════════════════════════════
    # 5. INVENTORY HEALTH
    # ═══════════════════════════════════════════════════════════
    @staticmethod
    def get_inventory_health(filters=None):
        filters = filters or {}
        now = timezone.now()
        plant_filter = filters.get('plant_id') or filters.get('plant')

        rolls = InventoryRoll.objects.select_related('material', 'location', 'location__plant')
        if plant_filter:
            rolls = rolls.filter(Q(location__plant_id=plant_filter) | Q(plant_id=plant_filter))

        # Total weight & count
        agg = rolls.aggregate(total_weight=Sum('weight_kg'), count=Count('id'))
        total_weight = float(agg['total_weight'] or 0)
        total_count = agg['count'] or 0

        # Real valuation using MaterialCostSnapshot
        try:
            from apps.costing.models import MaterialCostSnapshot
            # Get latest cost per material
            cost_map = {}
            for snap in MaterialCostSnapshot.objects.order_by('material_id', '-effective_date').distinct('material_id'):
                cost_map[snap.material_id] = float(snap.avg_rate_per_kg)
            # Calculate real valuation
            estimated_value = 0
            for r in rolls.values('material_id').annotate(w=Sum('weight_kg')):
                mat_id = r['material_id']
                w = float(r['w'] or 0)
                rate = cost_map.get(mat_id, 250.0)  # fallback
                estimated_value += w * rate
        except Exception:
            estimated_value = total_weight * 250.0
        estimated_value = round(estimated_value, 2)

        # Aging analysis
        thirty = timedelta(days=30)
        sixty = timedelta(days=60)
        ninety = timedelta(days=90)

        aging_qs = rolls.annotate(
            age=ExpressionWrapper(now - F('created_at'), output_field=DurationField())
        )
        aging_buckets = aging_qs.aggregate(
            b0_30=Count('id', filter=Q(age__lte=thirty)),
            b31_60=Count('id', filter=Q(age__gt=thirty, age__lte=sixty)),
            b61_90=Count('id', filter=Q(age__gt=sixty, age__lte=ninety)),
            b90_plus=Count('id', filter=Q(age__gt=ninety)),
        )
        # Also weight by aging
        aging_weight = aging_qs.aggregate(
            w0_30=Coalesce(Sum('weight_kg', filter=Q(age__lte=thirty)), Value(0, output_field=DecimalField())),
            w31_60=Coalesce(Sum('weight_kg', filter=Q(age__gt=thirty, age__lte=sixty)), Value(0, output_field=DecimalField())),
            w61_90=Coalesce(Sum('weight_kg', filter=Q(age__gt=sixty, age__lte=ninety)), Value(0, output_field=DecimalField())),
            w90_plus=Coalesce(Sum('weight_kg', filter=Q(age__gt=ninety)), Value(0, output_field=DecimalField())),
        )

        aging_data = [
            {"range": "0-30 Days", "count": aging_buckets['b0_30'], "weight_kg": round(float(aging_weight['w0_30']), 2), "fill": "#10b981"},
            {"range": "31-60 Days", "count": aging_buckets['b31_60'], "weight_kg": round(float(aging_weight['w31_60']), 2), "fill": "#f59e0b"},
            {"range": "61-90 Days", "count": aging_buckets['b61_90'], "weight_kg": round(float(aging_weight['w61_90']), 2), "fill": "#f97316"},
            {"range": "90+ Days", "count": aging_buckets['b90_plus'], "weight_kg": round(float(aging_weight['w90_plus']), 2), "fill": "#ef4444"},
        ]

        # By stage (WIP vs FG vs Raw)
        by_stage = rolls.values('stage_index', 'is_fg').annotate(
            weight=Sum('weight_kg'),
            count=Count('id'),
        ).order_by('-weight')
        stage_dist = []
        for s in by_stage:
            is_fg = bool(s.get('is_fg'))
            stage_index = s.get('stage_index')
            if is_fg:
                stage_label = "FG"
            elif stage_index is None or int(stage_index) <= 0:
                stage_label = "RAW"
            else:
                stage_label = f"WIP_STEP_{int(stage_index)}"
            stage_dist.append(
                {
                    "stage": stage_label,
                    "weight_kg": round(float(s.get('weight') or 0), 2),
                    "count": s.get('count') or 0,
                }
            )

        # By inventory item type
        item_type_totals = defaultdict(lambda: {"count": 0, "weight_kg": Decimal("0")})
        for roll in rolls:
            if roll.is_fg:
                item_type = "FG_ROLL"
            elif roll.stage_index is None or int(roll.stage_index or 0) <= 0:
                item_type = "RAW_ROLL"
            else:
                item_type = "WIP_ROLL"
            item_type_totals[item_type]["count"] += 1
            item_type_totals[item_type]["weight_kg"] += Decimal(str(roll.weight_kg or 0))

        # By material
        by_material = rolls.values('material__name', 'material__code').annotate(
            weight=Sum('weight_kg'), count=Count('id'),
        ).order_by('-weight')[:10]
        material_data = [{
            "name": m['material__name'] or "Unknown",
            "code": m['material__code'] or "",
            "weight": round(float(m['weight'] or 0), 2),
            "count": m['count'],
        } for m in by_material]

        by_variant = [{
            "variant": f"{m['material__code'] or '—'} · {m['material__name'] or 'Unknown'}",
            "material_code": m['material__code'] or "",
            "material_name": m['material__name'] or "Unknown",
            "weight_kg": round(float(m['weight'] or 0), 2),
            "count": m['count'],
        } for m in by_material]

        # By location
        by_location = rolls.values('location__name').annotate(
            weight=Sum('weight_kg'), count=Count('id'),
        ).order_by('-weight')[:10]
        location_data = [{
            "location": l['location__name'] or "Unknown",
            "weight_kg": round(float(l['weight'] or 0), 2),
            "count": l['count'],
        } for l in by_location]

        by_plant = rolls.values('location__plant__name', 'plant__name').annotate(
            weight=Sum('weight_kg'), count=Count('id'),
        ).order_by('-weight')[:10]
        plant_data = [{
            "plant": p['location__plant__name'] or p['plant__name'] or "Unknown",
            "weight_kg": round(float(p['weight'] or 0), 2),
            "count": p['count'],
        } for p in by_plant]

        oldest_rolls = []
        for roll in rolls.order_by('created_at')[:40]:
            age_days = max((now - roll.created_at).days, 0) if roll.created_at else 0
            oldest_rolls.append({
                "label_id": roll.label_id,
                "material_code": roll.material.code if roll.material else "",
                "material_name": roll.material.name if roll.material else "Unknown",
                "plant_name": roll.location.plant.name if roll.location and roll.location.plant else (roll.plant.name if roll.plant else None),
                "location_name": roll.location.name if roll.location else None,
                "stage_name": "FG" if roll.is_fg else ("RAW" if roll.stage_index is None or int(roll.stage_index or 0) <= 0 else f"WIP_STEP_{int(roll.stage_index)}"),
                "weight_kg": round(float(roll.weight_kg or 0), 2),
                "age_days": age_days,
                "created_at": roll.created_at.isoformat() if roll.created_at else None,
            })

        # Bulk materials summary
        bulk_agg = InventoryBulk.objects.aggregate(
            total_weight=Sum('qty_kg'), count=Count('id')
        )
        bulk_weight = round(float(bulk_agg['total_weight'] or 0), 2)
        item_type_totals["BULK"]["count"] = int(bulk_agg['count'] or 0)
        item_type_totals["BULK"]["weight_kg"] = Decimal(str(bulk_weight or 0))

        item_type_data = [
            {
                "item_type": key,
                "count": value["count"],
                "weight_kg": round(float(value["weight_kg"] or 0), 2),
            }
            for key, value in item_type_totals.items()
        ]
        item_type_data.sort(key=lambda row: row["weight_kg"], reverse=True)

        return {
            "summary": {
                "total_weight_kg": round(total_weight, 2),
                "total_items": total_count,
                "estimated_value": estimated_value,
                "aged_stock_items": aging_buckets['b90_plus'],
                "aged_stock_weight_kg": round(float(aging_weight['w90_plus']), 2),
                "bulk_stock_kg": bulk_weight,
                "bulk_items": bulk_agg['count'] or 0,
            },
            "aging": aging_data,
            "by_stage": stage_dist,
            "by_material": material_data,
            "by_item_type": item_type_data,
            "by_variant": by_variant,
            "by_location": location_data,
            "by_plant": plant_data,
            "rows": oldest_rolls,
        }

    # ═══════════════════════════════════════════════════════════
    # 6. SALES FULFILLMENT
    # ═══════════════════════════════════════════════════════════
    @staticmethod
    def get_sales_fulfillment(filters=None):
        filters = ReportService._default_date_range(filters or {})
        from apps.sales.models import SalesOrder, SalesOrderItem, Quotation

        orders = SalesOrder.objects.exclude(status='CANCELLED')
        orders = ReportService._apply_filters(orders, filters, date_field='created_at')
        now = timezone.now().date()

        # Backlog & Overdue
        active = orders.exclude(status='COMPLETED')
        backlog = active.count()
        overdue = active.filter(delivery_date__lt=now).count()

        # OTIF
        # SalesOrder does not carry an updated_at field; use the latest dispatch timestamp
        # when available, then fall back to commercial confirmation / creation time.
        completed = orders.filter(status='COMPLETED').annotate(
            completion_ts=Coalesce(
                Max('challans__dispatch_date'),
                F('commercial_confirmed_at'),
                F('created_at'),
            )
        )
        completed_count = completed.count()
        on_time = completed.filter(completion_ts__date__lte=F('delivery_date')).count() if completed_count > 0 else 0
        otif_rate = ReportService._pct(on_time, completed_count)

        # Total weight ordered
        total_weight = float(
            SalesOrderItem.objects.filter(
                sales_order__in=orders
            ).aggregate(w=Sum('total_weight_kg'))['w'] or 0
        )

        # Revenue (prefer persisted line amount, fallback to unit_price * qty_value)
        item_qs = SalesOrderItem.objects.filter(sales_order__in=orders)
        item_field_names = {f.name for f in SalesOrderItem._meta.fields}
        if "line_amount" in item_field_names:
            total_revenue = float(item_qs.aggregate(r=Sum("line_amount"))["r"] or 0)
        else:
            total_revenue = float(
                item_qs.aggregate(
                    r=Sum(
                        ExpressionWrapper(
                            Coalesce(F("unit_price"), Value(0)) * Coalesce(F("qty_value"), Value(0)),
                            output_field=DecimalField(max_digits=18, decimal_places=4),
                        )
                    )
                )["r"]
                or 0
            )

        # Pipeline by status
        pipeline = orders.values('status').annotate(
            count=Count('id'),
        ).order_by('status')
        pipeline_data = [{
            "status": p['status'], "count": p['count'],
        } for p in pipeline]

        # Top customers
        top_customers = orders.values('customer_name').annotate(
            total_orders=Count('id'),
            total_weight=Sum('items__total_weight_kg'),
        ).order_by('-total_weight')[:8]
        customer_data = [{
            "name": c['customer_name'] or "Unknown",
            "weight_kg": round(float(c['total_weight'] or 0), 2),
            "orders": c['total_orders'],
        } for c in top_customers]

        # Monthly trend
        monthly = orders.annotate(month=TruncMonth('created_at')).values('month').annotate(
            created=Count('id'),
            completed=Count('id', filter=Q(status='COMPLETED')),
        ).order_by('month')
        trend = [{
            "date": m['month'].strftime('%Y-%m'),
            "created": m['created'],
            "completed": m['completed'],
        } for m in monthly if m['month']]

        # Overdue orders detail
        overdue_orders = list(
            active.filter(delivery_date__lt=now).values(
                'order_number', 'customer_name', 'delivery_date', 'status',
            ).order_by('delivery_date')[:15]
        )
        for o in overdue_orders:
            if o.get('delivery_date'):
                o['days_overdue'] = (now - o['delivery_date']).days
                o['delivery_date'] = o['delivery_date'].isoformat()

        sku_breakdown = item_qs.values(
            'sku_variant__sku__code',
            'sku_variant__code',
            'sku_variant__name',
            'template__name',
        ).annotate(
            weight_kg=Sum('total_weight_kg'),
            orders=Count('id'),
            value=Sum(
                Case(
                    When(
                        price_basis='PCS',
                        then=ExpressionWrapper(
                            F('qty_value') * F('unit_price'),
                            output_field=DecimalField(max_digits=18, decimal_places=4),
                        ),
                    ),
                    default=ExpressionWrapper(
                        F('total_weight_kg') * F('unit_price'),
                        output_field=DecimalField(max_digits=18, decimal_places=4),
                    ),
                    output_field=DecimalField(max_digits=18, decimal_places=4),
                )
            ),
            repeat_orders=Count('id', filter=Q(mode='REPEAT')),
        ).order_by('-weight_kg')[:10]
        sku_breakdown = [
            {
                "sku": " · ".join([
                    part for part in [row.get('sku_variant__sku__code'), row.get('sku_variant__code')] if part
                ]) or (row.get('sku_variant__name') or row.get('template__name') or "Unmapped SKU"),
                "weight_kg": round(float(row['weight_kg'] or 0), 2),
                "orders": row['orders'],
                "value": round(float(row['value'] or 0), 2),
                "repeat_orders": row['repeat_orders'],
            }
            for row in sku_breakdown
        ]

        repeat_mix = item_qs.aggregate(
            repeat_orders=Count('id', filter=Q(mode='REPEAT')),
            custom_orders=Count('id', filter=Q(mode='CUSTOM')),
            template_orders=Count('id', filter=Q(mode='TEMPLATE')),
        )
        filtered_quotes = ReportService._apply_filters(Quotation.objects.all(), filters, date_field='created_at')
        total_quotes = filtered_quotes.count()
        converted_quotes = filtered_quotes.exclude(converted_sales_order__isnull=True).count()

        return {
            "summary": {
                "backlog_count": backlog,
                "overdue_count": overdue,
                "otif_rate": otif_rate,
                "completed_count": completed_count,
                "total_weight_ordered_kg": round(total_weight, 2),
                "total_revenue": round(total_revenue, 2),
                "repeat_share_pct": round(ReportService._pct(repeat_mix.get('repeat_orders') or 0, item_qs.count()), 2),
                "quote_conversion_pct": round(ReportService._pct(converted_quotes, total_quotes), 2),
            },
            "pipeline": pipeline_data,
            "top_customers": customer_data,
            "trend": trend,
            "overdue_orders": overdue_orders,
            "sku_breakdown": sku_breakdown,
            "repeat_mix": {
                "repeat": repeat_mix.get('repeat_orders') or 0,
                "custom": repeat_mix.get('custom_orders') or 0,
                "template": repeat_mix.get('template_orders') or 0,
            },
            "quote_conversion": {
                "total_quotes": total_quotes,
                "converted_quotes": converted_quotes,
                "conversion_pct": round(ReportService._pct(converted_quotes, total_quotes), 2),
            },
            "benchmarks": {"target_otif": TARGET_OTIF},
        }

    # ═══════════════════════════════════════════════════════════
    # 7. MRP & CONSUMPTION VARIANCE  *** CRITICAL ***
    # Theory vs Actual vs Issue vs Plan
    # ═══════════════════════════════════════════════════════════
    @staticmethod
    def get_mrp_consumption(filters=None):
        """
        Deep variance analysis using JobMaterialRequirement fields:
        - theoretical_qty: Ideal no-loss requirement
        - required_qty: Calculated requirement (theory + waste factor)
        - planned_issue_qty: What was planned to be issued
        - actual_issued_qty: What was actually issued
        - consumed_qty: What was actually consumed
        - variance_qty: consumed - theoretical
        """
        filters = ReportService._default_date_range(filters or {})

        jobs = ProductionJob.objects.all()
        jobs = ReportService._apply_filters(jobs, filters, date_field='created_at')
        job_ids = list(jobs.values_list('id', flat=True))

        req = JobMaterialRequirement.objects.filter(production_job_id__in=job_ids)

        # ── Global Totals ──
        totals = req.aggregate(
            theoretical=Sum('theoretical_qty'),
            required=Sum('required_qty'),
            planned_issue=Sum('planned_issue_qty'),
            actual_issued=Sum('actual_issued_qty'),
            consumed=Sum('consumed_qty'),
            variance=Sum('variance_qty'),
            scrap=Sum('actual_scrap_qty'),
            returned=Sum('actual_returned_qty'),
        )

        t_theory = float(totals['theoretical'] or 0)
        t_required = float(totals['required'] or 0)
        t_planned_issue = float(totals['planned_issue'] or 0)
        t_actual_issued = float(totals['actual_issued'] or 0)
        t_consumed = float(totals['consumed'] or 0)
        t_variance = float(totals['variance'] or 0)
        t_scrap = float(totals['scrap'] or 0)
        t_returned = float(totals['returned'] or 0)

        planning_accuracy = ReportService._pct(t_theory, t_consumed) if t_consumed else 100.0
        issue_accuracy = ReportService._pct(t_planned_issue, t_actual_issued) if t_actual_issued else 100.0
        waste_factor_pct = ReportService._pct(t_required - t_theory, t_theory) if t_theory else 0

        # ── Material-wise Breakdown ──
        by_material = req.values('material__name', 'material__code').annotate(
            theoretical=Sum('theoretical_qty'),
            required=Sum('required_qty'),
            planned_issue=Sum('planned_issue_qty'),
            actual_issued=Sum('actual_issued_qty'),
            consumed=Sum('consumed_qty'),
            variance=Sum('variance_qty'),
            scrap=Sum('actual_scrap_qty'),
            job_count=Count('production_job', distinct=True),
        ).order_by('-consumed')[:20]

        material_data = []
        for m in by_material:
            theory = float(m['theoretical'] or 0)
            consumed = float(m['consumed'] or 0)
            variance = float(m['variance'] or 0)
            var_pct = ReportService._pct(abs(variance), theory) if theory else 0
            material_data.append({
                "name": m['material__name'] or "Unknown",
                "code": m['material__code'] or "",
                "theoretical": round(theory, 2),
                "required": round(float(m['required'] or 0), 2),
                "planned_issue": round(float(m['planned_issue'] or 0), 2),
                "actual_issued": round(float(m['actual_issued'] or 0), 2),
                "consumed": round(consumed, 2),
                "variance": round(variance, 2),
                "variance_pct": var_pct,
                "scrap": round(float(m['scrap'] or 0), 2),
                "jobs": m['job_count'],
                "status": "OVER" if variance > 0 else ("UNDER" if variance < 0 else "OK"),
            })

        # ── Job-wise Variance ──
        by_job = req.values(
            'production_job__job_number',
            'production_job__template__name',
        ).annotate(
            theoretical=Sum('theoretical_qty'),
            consumed=Sum('consumed_qty'),
            variance=Sum('variance_qty'),
            materials=Count('material', distinct=True),
        ).order_by(F('variance').desc(nulls_last=True))[:15]

        job_variance = [{
            "job_number": j['production_job__job_number'],
            "product": j['production_job__template__name'] or "Custom",
            "theoretical": round(float(j['theoretical'] or 0), 2),
            "consumed": round(float(j['consumed'] or 0), 2),
            "variance": round(float(j['variance'] or 0), 2),
            "materials": j['materials'],
        } for j in by_job]

        # ── Variance Waterfall ──
        waterfall = [
            {"name": "Theoretical Need", "value": round(t_theory, 2), "type": "base"},
            {"name": "Waste Factor", "value": round(t_required - t_theory, 2), "type": "add"},
            {"name": "Required Total", "value": round(t_required, 2), "type": "subtotal"},
            {"name": "Issue Delta", "value": round(t_actual_issued - t_planned_issue, 2), "type": "add" if t_actual_issued >= t_planned_issue else "subtract"},
            {"name": "Consumption", "value": round(t_consumed, 2), "type": "subtotal"},
            {"name": "Returns", "value": round(t_returned, 2), "type": "subtract"},
            {"name": "Scrap Loss", "value": round(t_scrap, 2), "type": "add"},
            {"name": "Net Variance", "value": round(t_variance, 2), "type": "total"},
        ]

        # ── Comparison chart data (for grouped bar chart) ──
        comparison_chart = [{
            "category": "Theoretical",
            "value": round(t_theory, 2),
        }, {
            "category": "BOM Required",
            "value": round(t_required, 2),
        }, {
            "category": "Planned Issue",
            "value": round(t_planned_issue, 2),
        }, {
            "category": "Actual Issued",
            "value": round(t_actual_issued, 2),
        }, {
            "category": "Consumed",
            "value": round(t_consumed, 2),
        }]

        return {
            "summary": {
                "theoretical_kg": round(t_theory, 2),
                "required_kg": round(t_required, 2),
                "planned_issue_kg": round(t_planned_issue, 2),
                "actual_issued_kg": round(t_actual_issued, 2),
                "consumed_kg": round(t_consumed, 2),
                "variance_kg": round(t_variance, 2),
                "scrap_kg": round(t_scrap, 2),
                "returned_kg": round(t_returned, 2),
                "planning_accuracy_pct": planning_accuracy,
                "issue_accuracy_pct": issue_accuracy,
                "waste_factor_pct": round(waste_factor_pct, 1),
                "total_jobs": len(job_ids),
                "total_materials": req.values('material').distinct().count(),
            },
            "by_material": material_data,
            "job_variance": job_variance,
            "waterfall": waterfall,
            "comparison_chart": comparison_chart,
        }

    # ═══════════════════════════════════════════════════════════
    # 8. OPERATOR PERFORMANCE
    # ═══════════════════════════════════════════════════════════
    @staticmethod
    def get_operator_performance(filters=None):
        filters = ReportService._default_date_range(filters or {})

        jobs = ProductionJob.objects.exclude(operator__isnull=True)
        jobs = ReportService._apply_filters(jobs, filters, date_field='created_at')

        by_operator = jobs.values('operator__username', 'operator__first_name', 'operator__last_name').annotate(
            job_count=Count('id'),
            completed_jobs=Count('id', filter=Q(status='COMPLETED')),
            total_produced=Sum('produced_qty'),
            total_scrap=Sum('scrap_logs__quantity'),
            total_target=Sum('quantity'),
        ).order_by('-total_produced')[:20]

        operators = []
        total_global_output = 0
        for op in by_operator:
            prod = float(op['total_produced'] or 0)
            scrap = float(op['total_scrap'] or 0)
            target = float(op['total_target'] or 0)
            total = prod + scrap
            efficiency = ReportService._pct(prod, total) if total else 100.0
            completion_rate = ReportService._pct(op['completed_jobs'], op['job_count'])
            target_achievement = ReportService._pct(prod, target) if target else 0

            name = op['operator__username'] or "Unknown"
            full_name = f"{op['operator__first_name'] or ''} {op['operator__last_name'] or ''}".strip()

            operators.append({
                "name": name,
                "full_name": full_name or name,
                "jobs": op['job_count'],
                "completed": op['completed_jobs'],
                "produced_kg": round(prod, 2),
                "scrap_kg": round(scrap, 2),
                "efficiency": efficiency,
                "scrap_rate": round(100 - efficiency, 1),
                "completion_rate": completion_rate,
                "target_achievement": target_achievement,
            })
            total_global_output += prod

        avg_efficiency = sum(o['efficiency'] for o in operators) / len(operators) if operators else 0
        best = max(operators, key=lambda o: o['efficiency']) if operators else None
        worst = min(operators, key=lambda o: o['efficiency']) if operators else None

        return {
            "summary": {
                "active_operators": len(operators),
                "total_output_kg": round(total_global_output, 2),
                "avg_efficiency": round(avg_efficiency, 1),
                "best_operator": best['name'] if best else "-",
                "worst_operator": worst['name'] if worst else "-",
            },
            "leaderboard": operators,
            "best": best,
            "worst": worst,
        }

    # ═══════════════════════════════════════════════════════════
    # 9. COSTING & PROFITABILITY  (NEW)
    # ═══════════════════════════════════════════════════════════
    @staticmethod
    def get_costing_profitability(filters=None):
        filters = ReportService._default_date_range(filters or {})

        try:
            from apps.costing.models import JobCost, OrderCost, PlantCostPoolLine, PlantCostPoolMonth
        except ImportError:
            return {"summary": {}, "error": "Costing module not available"}

        # Job Costs
        job_costs = JobCost.objects.select_related('job')
        if filters.get('start_date'):
            job_costs = job_costs.filter(created_at__date__gte=filters['start_date'])
        if filters.get('end_date'):
            job_costs = job_costs.filter(created_at__date__lte=filters['end_date'])

        jc_agg = job_costs.aggregate(
            total_material=Sum('material_cost_actual'),
            total_process=Sum('conversion_cost_actual'),
            total_overhead=Sum('overhead_cost_absorbed'),
            total_cost=Sum('total_cost'),
            avg_cost_per_kg=Avg('cost_per_kg'),
            job_count=Count('id'),
            avg_coverage=Avg('actual_cost_coverage_pct'),
        )

        total_material_cost = round(float(jc_agg['total_material'] or 0), 2)
        total_process_cost = round(float(jc_agg['total_process'] or 0), 2)
        total_overhead_cost = round(float(jc_agg['total_overhead'] or 0), 2)
        total_production_cost = round(float(jc_agg['total_cost'] or 0), 2)
        avg_ckg = round(float(jc_agg['avg_cost_per_kg'] or 0), 2)
        avg_coverage = round(float(jc_agg['avg_coverage'] or 0), 1)

        # Order Costs (margin analysis)
        order_costs = OrderCost.objects.select_related('sales_order_item', 'sales_order_item__sales_order')
        if filters.get('start_date'):
            order_costs = order_costs.filter(created_at__date__gte=filters['start_date'])
        if filters.get('end_date'):
            order_costs = order_costs.filter(created_at__date__lte=filters['end_date'])

        oc_agg = order_costs.aggregate(
            total_selling=Sum('selling_price'),
            total_cost=Sum('total_cost'),
            total_margin=Sum('absorbed_margin'),
            total_contribution=Sum('contribution_margin'),
            avg_margin_pct=Avg('absorbed_margin_percent'),
            avg_contribution_margin_pct=Avg('contribution_margin_percent'),
            avg_coverage=Avg('actual_cost_coverage_pct'),
            actual_count=Count('id', filter=Q(costing_mode='ACTUAL')),
            hybrid_count=Count('id', filter=Q(costing_mode='HYBRID')),
            estimated_count=Count('id', filter=Q(costing_mode='ESTIMATED')),
        )

        total_revenue = round(float(oc_agg['total_selling'] or 0), 2)
        total_order_cost = round(float(oc_agg['total_cost'] or 0), 2)
        total_margin = round(float(oc_agg['total_margin'] or 0), 2)
        total_contribution = round(float(oc_agg['total_contribution'] or 0), 2)
        avg_margin = round(float(oc_agg['avg_margin_pct'] or 0), 1)
        avg_contribution_margin = round(float(oc_agg['avg_contribution_margin_pct'] or 0), 1)
        order_coverage = round(float(oc_agg['avg_coverage'] or 0), 1)

        # Cost breakdown for donut chart
        cost_split = [
            {"name": "Material Cost", "value": total_material_cost},
            {"name": "Conversion Cost", "value": total_process_cost},
            {"name": "Absorbed Overhead", "value": total_overhead_cost},
        ]

        # Margin by customer (top 10)
        by_customer = order_costs.values(
            'sales_order_item__sales_order__customer_name'
        ).annotate(
            revenue=Sum('selling_price'),
            cost=Sum('total_cost'),
            margin=Sum('absorbed_margin'),
            contribution_margin=Sum('contribution_margin'),
            avg_margin=Avg('absorbed_margin_percent'),
            avg_coverage=Avg('actual_cost_coverage_pct'),
            orders=Count('id'),
        ).order_by('-revenue')[:10]

        customer_margin = [{
            "customer": c['sales_order_item__sales_order__customer_name'] or "Unknown",
            "revenue": round(float(c['revenue'] or 0), 2),
            "cost": round(float(c['cost'] or 0), 2),
            "margin": round(float(c['margin'] or 0), 2),
            "contribution_margin": round(float(c['contribution_margin'] or 0), 2),
            "margin_pct": round(float(c['avg_margin'] or 0), 1),
            "coverage_pct": round(float(c['avg_coverage'] or 0), 1),
            "orders": c['orders'],
        } for c in by_customer]

        # Monthly P&L trend
        monthly = order_costs.annotate(
            month=TruncMonth('created_at')
        ).values('month').annotate(
            revenue=Sum('selling_price'),
            cost=Sum('total_cost'),
            contribution_margin=Sum('contribution_margin'),
            margin=Sum('absorbed_margin'),
            coverage=Avg('actual_cost_coverage_pct'),
        ).order_by('month')

        monthly_trend = [{
            "date": m['month'].strftime('%Y-%m'),
            "revenue": round(float(m['revenue'] or 0), 2),
            "cost": round(float(m['cost'] or 0), 2),
            "contribution_margin": round(float(m['contribution_margin'] or 0), 2),
            "margin": round(float(m['margin'] or 0), 2),
            "coverage_pct": round(float(m['coverage'] or 0), 1),
        } for m in monthly if m['month']]

        # Monthly pools / unabsorbed overhead
        overhead_months = PlantCostPoolMonth.objects.order_by('-year', '-month')[:12]
        overhead_pairs = {(m.year, m.month): m for m in overhead_months}
        lines = PlantCostPoolLine.objects.filter(month_record__in=overhead_months).select_related('month_record')
        pools_by_month = {}
        for line in lines:
            key = (line.month_record.year, line.month_record.month)
            pools_by_month.setdefault(key, {"electricity": 0.0, "labor": 0.0, "other": 0.0})
            pools_by_month[key]["electricity"] += float(line.electricity_cost or 0)
            pools_by_month[key]["labor"] += float(line.labor_cost or 0)
            pools_by_month[key]["other"] += float((line.overhead_cost or 0) + (line.maintenance_cost or 0) + (line.service_burden_cost or 0))

        overheads = sorted(overhead_pairs.values(), key=lambda row: (row.year, row.month), reverse=True)
        overhead_trend = [{
            "date": f"{o.year}-{o.month:02d}",
            "electricity": pools_by_month.get((o.year, o.month), {}).get("electricity", 0),
            "labor": pools_by_month.get((o.year, o.month), {}).get("labor", 0),
            "other": pools_by_month.get((o.year, o.month), {}).get("other", 0),
            "total": (
                pools_by_month.get((o.year, o.month), {}).get("electricity", 0)
                + pools_by_month.get((o.year, o.month), {}).get("labor", 0)
                + pools_by_month.get((o.year, o.month), {}).get("other", 0)
            ),
            "status": o.status,
        } for o in overheads]

        # Cost per kg trend (monthly)
        cost_trend = job_costs.annotate(
            month=TruncMonth('created_at')
        ).values('month').annotate(
            avg_cost=Avg('cost_per_kg'),
        ).order_by('month')
        cpk_trend = [{
            "date": c['month'].strftime('%Y-%m'),
            "cost_per_kg": round(float(c['avg_cost'] or 0), 2),
        } for c in cost_trend if c['month']]

        return {
            "summary": {
                "total_material_cost": total_material_cost,
                "total_process_cost": total_process_cost,
                "total_overhead_cost": total_overhead_cost,
                "total_production_cost": total_production_cost,
                "avg_cost_per_kg": avg_ckg,
                "total_revenue": total_revenue,
                "total_contribution": total_contribution,
                "total_margin": total_margin,
                "avg_margin_pct": avg_margin,
                "avg_contribution_margin_pct": avg_contribution_margin,
                "avg_actual_cost_coverage_pct": avg_coverage,
                "avg_order_coverage_pct": order_coverage,
                "actual_count": oc_agg['actual_count'] or 0,
                "hybrid_count": oc_agg['hybrid_count'] or 0,
                "estimated_count": oc_agg['estimated_count'] or 0,
                "total_jobs_costed": jc_agg['job_count'] or 0,
            },
            "cost_split": cost_split,
            "customer_margin": customer_margin,
            "monthly_trend": monthly_trend,
            "overhead_trend": overhead_trend,
            "cost_per_kg_trend": cpk_trend,
            "benchmarks": {"target_gross_margin": TARGET_GROSS_MARGIN},
        }

    # ═══════════════════════════════════════════════════════════
    # 10. DISPATCH & LOGISTICS  (NEW)
    # ═══════════════════════════════════════════════════════════
    @staticmethod
    def get_dispatch_logistics(filters=None):
        filters = ReportService._default_date_range(filters or {})

        challans = DeliveryChallan.objects.select_related('plant', 'sales_order')
        if filters.get('plant_id'):
            challans = challans.filter(plant_id=filters['plant_id'])
        if filters.get('start_date'):
            challans = challans.filter(created_at__date__gte=filters['start_date'])
        if filters.get('end_date'):
            challans = challans.filter(created_at__date__lte=filters['end_date'])

        total_challans = challans.count()
        by_status = challans.values('status').annotate(count=Count('id'))
        status_map = {s['status']: s['count'] for s in by_status}

        dispatched = status_map.get('DISPATCHED', 0) + status_map.get('DELIVERED', 0) + status_map.get('IN_TRANSIT', 0)
        pending = status_map.get('DRAFT', 0)

        # Total dispatch weight
        challan_ids = challans.values_list('id', flat=True)
        items = DeliveryChallanItem.objects.filter(challan_id__in=challan_ids)
        total_weight = float(items.aggregate(w=Sum('weight_kg'))['w'] or 0)
        total_pcs = items.aggregate(p=Sum('qty_pcs'))['p'] or 0

        # By customer
        by_customer = challans.values('customer_name').annotate(
            challans=Count('id'),
            weight=Sum('items__weight_kg'),
        ).order_by('-weight')[:10]
        customer_data = [{
            "customer": c['customer_name'] or "Unknown",
            "challans": c['challans'],
            "weight_kg": round(float(c['weight'] or 0), 2),
        } for c in by_customer]

        # Daily trend
        daily = challans.annotate(date=TruncDate('created_at')).values('date').annotate(
            count=Count('id'),
            weight=Sum('items__weight_kg'),
        ).order_by('date')
        daily_trend = [{
            "date": d['date'].strftime("%Y-%m-%d"),
            "challans": d['count'],
            "weight_kg": round(float(d['weight'] or 0), 2),
        } for d in daily]

        # Pipeline
        pipeline = [{
            "status": s['status'],
            "count": s['count'],
        } for s in by_status]

        # Recent challans
        recent = challans.order_by('-created_at')[:15]
        recent_list = [{
            "dc_no": c.dc_no,
            "customer": c.customer_name,
            "status": c.status,
            "date": c.created_at.strftime("%Y-%m-%d"),
            "vehicle": c.vehicle_no or "-",
        } for c in recent]

        return {
            "summary": {
                "total_challans": total_challans,
                "dispatched": dispatched,
                "pending": pending,
                "total_weight_kg": round(total_weight, 2),
                "total_pcs": total_pcs or 0,
            },
            "pipeline": pipeline,
            "by_customer": customer_data,
            "daily_trend": daily_trend,
            "recent_challans": recent_list,
        }

    @staticmethod
    def get_interplant_logistics(filters=None):
        filters = ReportService._default_date_range(filters or {})

        challans = InterPlantDeliveryChallan.objects.select_related("from_plant", "to_plant")
        if filters.get("plant_id"):
            challans = challans.filter(Q(from_plant_id=filters["plant_id"]) | Q(to_plant_id=filters["plant_id"]))
        if filters.get("start_date"):
            challans = challans.filter(created_at__date__gte=filters["start_date"])
        if filters.get("end_date"):
            challans = challans.filter(created_at__date__lte=filters["end_date"])

        challan_ids = list(challans.values_list("id", flat=True))
        items = InterPlantChallanItem.objects.filter(challan_id__in=challan_ids)
        by_status = challans.values("status").annotate(count=Count("id"))
        status_map = {row["status"]: int(row["count"] or 0) for row in by_status}

        dispatched_total = Decimal(str(items.aggregate(total=Sum("dispatched_qty_kg"))["total"] or 0))
        received_total = Decimal(str(items.aggregate(total=Sum("received_qty_kg"))["total"] or 0))
        output_in_transit = Decimal("0")
        remainder_in_transit = Decimal("0")

        rows = []
        for challan in challans.order_by("-created_at")[:25]:
            line_rows = list(items.filter(challan=challan))
            dispatched_kg = sum(Decimal(str(line.dispatched_qty_kg or 0)) for line in line_rows)
            received_kg = sum(Decimal(str(line.received_qty_kg or 0)) for line in line_rows)
            remainder_dispatched_kg = sum(
                Decimal(str(line.dispatched_qty_kg or 0))
                for line in line_rows
                if str(getattr(getattr(line, "roll", None), "meta_json", {}).get("roll_role") or "").upper() == "REMAINDER"
            )
            output_dispatched_kg = dispatched_kg - remainder_dispatched_kg
            if str(challan.status or "").upper() == "IN_TRANSIT":
                output_in_transit += output_dispatched_kg - min(output_dispatched_kg, received_kg)
                remainder_in_transit += max(Decimal("0"), remainder_dispatched_kg - max(Decimal("0"), received_kg - output_dispatched_kg))

            rows.append(
                {
                    "challan_id": str(challan.id),
                    "dc_no": challan.dc_no or str(challan.id),
                    "status": challan.status,
                    "from_plant": challan.from_plant.name if challan.from_plant else None,
                    "to_plant": challan.to_plant.name if challan.to_plant else None,
                    "dispatched_at": challan.dispatched_at.isoformat() if challan.dispatched_at else None,
                    "received_at": challan.received_at.isoformat() if challan.received_at else None,
                    "dispatched_kg": round(float(dispatched_kg), 3),
                    "received_kg": round(float(received_kg), 3),
                    "output_dispatched_kg": round(float(output_dispatched_kg), 3),
                    "remainder_dispatched_kg": round(float(remainder_dispatched_kg), 3),
                }
            )

        trend = []
        for row in (
            challans.annotate(date=TruncDate("created_at"))
            .values("date")
            .annotate(dispatched_kg=Sum("items__dispatched_qty_kg"), challans=Count("id"))
            .order_by("date")
        ):
            trend.append(
                {
                    "date": row["date"].strftime("%Y-%m-%d"),
                    "challans": int(row["challans"] or 0),
                    "weight_kg": round(float(row["dispatched_kg"] or 0), 3),
                }
            )

        return {
            "summary": {
                "total_challans": challans.count(),
                "draft": status_map.get("DRAFT", 0),
                "in_transit": status_map.get("IN_TRANSIT", 0),
                "received": status_map.get("RECEIVED", 0),
                "dispatched_total_kg": round(float(dispatched_total), 3),
                "received_total_kg": round(float(received_total), 3),
                "output_in_transit_kg": round(float(output_in_transit), 3),
                "remainder_in_transit_kg": round(float(remainder_in_transit), 3),
            },
            "daily_trend": trend,
            "recent_challans": rows,
        }

    # ═══════════════════════════════════════════════════════════
    # 11. SHIFT PERFORMANCE
    # ═══════════════════════════════════════════════════════════
    @staticmethod
    def get_shift_performance(filters=None):
        filters = ReportService._default_date_range(filters or {})

        logs = JobExecutionLog.objects.select_related("production_job", "production_job__work_center")
        logs = ReportService._apply_filters(logs, filters, date_field="logged_at")
        scrap = ScrapLog.objects.select_related("production_job", "production_job__work_center")
        scrap = ReportService._apply_filters(scrap, filters, date_field="logged_at")
        downtime = DowntimeLog.objects.select_related("production_job", "production_job__work_center")
        downtime = ReportService._apply_filters(downtime, filters, date_field="start_time")

        output_by_shift = logs.values("shift_code").annotate(output_kg=Sum("quantity"), events=Count("id"))
        scrap_by_shift = scrap.values("shift_code").annotate(scrap_kg=Sum("quantity"))

        scrap_map = {str(r["shift_code"] or "").upper(): float(r["scrap_kg"] or 0) for r in scrap_by_shift}
        rows = []
        for row in output_by_shift:
            shift_code = str(row["shift_code"] or "UNASSIGNED").upper()
            output_kg = float(row["output_kg"] or 0)
            scrap_kg = float(scrap_map.get(shift_code, 0))
            yield_pct = ReportService._pct(output_kg, output_kg + scrap_kg)
            rows.append(
                {
                    "shift_code": shift_code,
                    "output_kg": round(output_kg, 3),
                    "scrap_kg": round(scrap_kg, 3),
                    "yield_pct": round(yield_pct, 2),
                    "events": int(row["events"] or 0),
                }
            )
        rows.sort(key=lambda r: r["output_kg"], reverse=True)

        # Shift/date series
        trend = logs.annotate(day=TruncDate("logged_at")).values("day", "shift_code").annotate(output_kg=Sum("quantity")).order_by("day", "shift_code")
        series = [
            {
                "date": t["day"].strftime("%Y-%m-%d") if t["day"] else None,
                "shift_code": str(t["shift_code"] or "UNASSIGNED").upper(),
                "value": round(float(t["output_kg"] or 0), 3),
            }
            for t in trend
        ]

        dt_map = defaultdict(float)
        now = timezone.now()
        for row in downtime.values("shift_code", "start_time", "end_time"):
            shift_code = str(row.get("shift_code") or "UNASSIGNED").upper()
            start_time = row.get("start_time")
            end_time = row.get("end_time") or now
            if not start_time or end_time <= start_time:
                continue
            dt_map[shift_code] += (end_time - start_time).total_seconds() / 60.0
        for row in rows:
            row["downtime_minutes"] = round(float(dt_map.get(row["shift_code"], 0.0)), 2)

        return {
            "summary": {
                "total_output_kg": round(sum(r["output_kg"] for r in rows), 3),
                "total_scrap_kg": round(sum(r["scrap_kg"] for r in rows), 3),
                "total_downtime_minutes": round(sum(r["downtime_minutes"] for r in rows), 2),
                "shift_count": len(rows),
            },
            "series": series,
            "rows": rows,
            "breakdowns": {
                "shift_oee_like": rows,
            },
            "warnings": [] if rows else ["No shift-tagged telemetry in selected period."],
        }

    # ═══════════════════════════════════════════════════════════
    # 12. MATERIAL VARIANCE TAB
    # ═══════════════════════════════════════════════════════════
    @staticmethod
    def get_material_variance(filters=None):
        filters = ReportService._default_date_range(filters or {})
        mrp = ReportService.get_mrp_consumption(filters)
        rows = mrp.get("by_material", [])
        summary = mrp.get("summary", {})
        series = mrp.get("comparison_chart", [])
        breakdowns = {
            "job_variance": mrp.get("job_variance", []),
            "waterfall": mrp.get("waterfall", []),
        }
        warnings = []
        if summary.get("total_jobs", 0) == 0:
            warnings.append("No material requirements found in selected period.")
        return {
            "summary": summary,
            "series": series,
            "rows": rows,
            "breakdowns": breakdowns,
            "warnings": warnings,
        }

    # ═══════════════════════════════════════════════════════════
    # 13. INK INTELLIGENCE TAB
    # ═══════════════════════════════════════════════════════════
    @staticmethod
    def get_ink_intelligence(filters=None):
        filters = ReportService._default_date_range(filters or {})
        jobs = ProductionJob.objects.all()
        jobs = ReportService._apply_filters(jobs, filters, date_field="created_at")
        job_ids = list(jobs.values_list("id", flat=True))

        reqs = JobMaterialRequirement.objects.select_related("material", "production_job").filter(
            production_job_id__in=job_ids,
            material__category__iexact="INK",
        )

        def _color_family(name: str):
            token = str(name or "").upper()
            if "CYAN" in token or token.startswith("C "):
                return "C"
            if "MAGENTA" in token or token.startswith("M "):
                return "M"
            if "YELLOW" in token or token.startswith("Y "):
                return "Y"
            if "BLACK" in token or "KEY" in token or token.startswith("K "):
                return "K"
            if "WHITE" in token or token.startswith("W "):
                return "W"
            if "SPECIAL" in token:
                return "SPECIAL"
            return "CUSTOM"

        grouped = defaultdict(
            lambda: {
                "theoretical_qty": Decimal("0"),
                "planned_issue_qty": Decimal("0"),
                "actual_issued_qty": Decimal("0"),
                "actual_returned_qty": Decimal("0"),
                "actual_scrap_qty": Decimal("0"),
                "actual_consumed_qty": Decimal("0"),
                "variance_qty": Decimal("0"),
                "jobs": set(),
            }
        )
        for req in reqs:
            fam = _color_family(getattr(req.material, "name", ""))
            bucket = grouped[fam]
            bucket["theoretical_qty"] += Decimal(str(req.theoretical_qty or 0))
            bucket["planned_issue_qty"] += Decimal(str(req.planned_issue_qty or 0))
            bucket["actual_issued_qty"] += Decimal(str(req.actual_issued_qty or 0))
            bucket["actual_returned_qty"] += Decimal(str(req.actual_returned_qty or 0))
            bucket["actual_scrap_qty"] += Decimal(str(req.actual_scrap_qty or 0))
            bucket["actual_consumed_qty"] += Decimal(str(req.consumed_qty or 0))
            bucket["variance_qty"] += Decimal(str(req.variance_qty or 0))
            bucket["jobs"].add(str(req.production_job_id))

        rows = []
        for family, vals in grouped.items():
            theoretical = vals["theoretical_qty"]
            planned = vals["planned_issue_qty"]
            issued = vals["actual_issued_qty"]
            returned = vals["actual_returned_qty"]
            consumed = vals["actual_consumed_qty"]
            variance = vals["variance_qty"]
            issue_discipline = ReportService._pct(float(issued), float(planned)) if planned else 0
            return_eff = ReportService._pct(float(returned), float(issued)) if issued else 0
            usage_discipline = ReportService._pct(float(consumed), float(theoretical)) if theoretical else 0
            variance_pct = ReportService._pct(abs(float(variance)), float(theoretical)) if theoretical else 0
            rows.append(
                {
                    "color_family": family,
                    "theoretical_qty": round(float(theoretical), 3),
                    "planned_issue_qty": round(float(planned), 3),
                    "actual_issued_qty": round(float(issued), 3),
                    "actual_returned_qty": round(float(returned), 3),
                    "actual_scrap_qty": round(float(vals["actual_scrap_qty"]), 3),
                    "actual_consumed_qty": round(float(consumed), 3),
                    "variance_qty": round(float(variance), 3),
                    "issue_discipline_pct": round(issue_discipline, 2),
                    "return_efficiency_pct": round(return_eff, 2),
                    "usage_discipline_pct": round(usage_discipline, 2),
                    "variance_pct": round(variance_pct, 2),
                    "job_count": len(vals["jobs"]),
                }
            )
        rows.sort(key=lambda r: abs(r["variance_qty"]), reverse=True)

        series = [
            {"name": row["color_family"], "value": row["actual_consumed_qty"]}
            for row in rows
        ]
        summary = {
            "color_families": len(rows),
            "ink_theoretical_kg": round(sum(r["theoretical_qty"] for r in rows), 3),
            "ink_planned_issue_kg": round(sum(r["planned_issue_qty"] for r in rows), 3),
            "ink_actual_issued_kg": round(sum(r["actual_issued_qty"] for r in rows), 3),
            "ink_returned_kg": round(sum(r["actual_returned_qty"] for r in rows), 3),
            "ink_consumed_kg": round(sum(r["actual_consumed_qty"] for r in rows), 3),
            "ink_variance_kg": round(sum(r["variance_qty"] for r in rows), 3),
        }
        warnings = [] if rows else ["No INK requirements found in selected period."]
        return {
            "summary": summary,
            "series": series,
            "rows": rows,
            "breakdowns": {"top_variance": rows[:10]},
            "warnings": warnings,
        }

    @staticmethod
    def _coverage(filters=None):
        filters = ReportService._default_date_range(filters or {})
        jobs = ProductionJob.objects.all()
        jobs = ReportService._apply_filters(jobs, filters, date_field="created_at")
        job_ids = list(jobs.values_list("id", flat=True))
        total_jobs = len(job_ids)
        if total_jobs == 0:
            return {
                "execution_log_coverage": 0.0,
                "material_actual_coverage": 0.0,
                "shift_coverage": 0.0,
            }

        jobs_with_exec = JobExecutionLog.objects.filter(production_job_id__in=job_ids).values("production_job_id").distinct().count()
        jobs_with_material = JobMaterialRequirement.objects.filter(
            production_job_id__in=job_ids,
        ).filter(
            Q(actual_issued_qty__gt=0) | Q(consumed_qty__gt=0) | Q(actual_returned_qty__gt=0)
        ).values("production_job_id").distinct().count()
        exec_rows = JobExecutionLog.objects.filter(production_job_id__in=job_ids)
        shift_rows = exec_rows.filter(shift_code__isnull=False).exclude(shift_code="")
        exec_count = exec_rows.count() or 1

        return {
            "execution_log_coverage": round((jobs_with_exec / total_jobs) * 100, 2),
            "material_actual_coverage": round((jobs_with_material / total_jobs) * 100, 2),
            "shift_coverage": round((shift_rows.count() / exec_count) * 100, 2),
        }

    @staticmethod
    def get_report_tab(tab, filters=None):
        key = str(tab or "").strip().lower()
        normalized = ReportService._default_date_range(filters or {})

        tab_map = {
            "production": ReportService.get_production_performance,
            "oee": ReportService.get_oee_deep_dive,
            "downtime": ReportService.get_downtime_analysis,
            "scrap": ReportService.get_scrap_yield,
            "inventory": ReportService.get_inventory_health,
            "inventory-lineage": ReportService.get_inventory_health,
            "interplant": ReportService.get_interplant_logistics,
            "sales": ReportService.get_sales_fulfillment,
            "mrp": ReportService.get_mrp_consumption,
            "operator": ReportService.get_operator_performance,
            "costing": ReportService.get_costing_profitability,
            "dispatch": ReportService.get_dispatch_logistics,
            "material-variance": ReportService.get_material_variance,
            "ink-intelligence": ReportService.get_ink_intelligence,
            "shift-performance": ReportService.get_shift_performance,
        }

        resolver = tab_map.get(key)
        if resolver is None:
            return {
                "tab": key,
                "summary": {},
                "series": [],
                "breakdowns": {},
                "rows": [],
                "coverage": ReportService._coverage(normalized),
                "generated_at": timezone.now().isoformat(),
                "warnings": [f"Unknown report tab '{key}'."],
            }

        payload = resolver(normalized) or {}
        summary = payload.get("summary", {})
        rows = payload.get("rows")
        if rows is None:
            rows = (
                payload.get("breakdown")
                or payload.get("by_material")
                or payload.get("job_variance")
                or payload.get("recent_challans")
                or []
            )
        series = payload.get("series")
        if series is None:
            series = (
                payload.get("trend")
                or payload.get("daily_trend")
                or payload.get("comparison_chart")
                or []
            )

        # Build a compact breakdown bag from known sections when explicit breakdowns
        # are not provided by the resolver.
        breakdowns = payload.get("breakdowns")
        if breakdowns is None:
            breakdowns = {}
            for key_name in (
                "by_process",
                "pipeline",
                "top_customers",
                "customer_margin",
                "cost_split",
                "waterfall",
                "by_customer",
                "aging",
                "by_stage",
                "by_item_type",
                "by_variant",
                "by_material",
                "by_location",
                "by_plant",
                "job_variance",
            ):
                if key_name in payload:
                    breakdowns[key_name] = payload.get(key_name)

        warnings = list(payload.get("warnings") or [])
        coverage = ReportService._coverage(normalized)
        material_evidence = _has_material_evidence(summary, rows, breakdowns)
        if coverage.get("execution_log_coverage", 0) <= 0:
            warnings.append("No telemetry in selected period.")
        if coverage.get("material_actual_coverage", 0) <= 0 and key in {"production", "material-variance", "ink-intelligence", "mrp"} and not material_evidence:
            warnings.append("No material actuals captured.")
        if coverage.get("shift_coverage", 0) <= 0:
            shift_qs = PlantShiftDefinition.objects.filter(is_active=True)
            if normalized.get("plant_id"):
                shift_qs = shift_qs.filter(plant_id=normalized.get("plant_id"))
            if shift_qs.exists():
                warnings.append("No shift tags captured in selected telemetry.")
            else:
                warnings.append("No shift schedule configured.")
        warnings = list(dict.fromkeys(warnings))
        # Preserve resolver-native keys (trend, breakdown, by_process, etc.)
        # for existing report pages while also returning the normalized contract.
        response = dict(payload)
        response.update({
            "tab": key,
            "summary": summary,
            "series": series or [],
            "breakdowns": breakdowns or {},
            "rows": rows or [],
            "coverage": coverage,
            "generated_at": timezone.now().isoformat(),
            "warnings": warnings,
        })
        return response
