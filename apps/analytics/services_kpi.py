from datetime import timedelta
from decimal import Decimal

from django.db import models
from django.db.models import Avg, Count, Max, Q, Sum
from django.utils import timezone

from apps.analytics.decorators import safe_service
from apps.factory.models import Machine, WorkCenter
from apps.inventory.models import InventoryBulk, InventoryRoll
from apps.production.models import DowntimeLog, JobExecutionLog, ScrapLog
from apps.sales.models import SalesOrder


class KPIService:
    @staticmethod
    @safe_service(default_value=0.0)
    def calculate_utilization(machine_id, days=1):
        """
        Utilization = (available runtime / total period runtime) * 100.
        """
        now = timezone.now()
        start_time = now - timedelta(days=max(1, int(days)))
        total_seconds = max(1, int(days)) * 24 * 3600

        downtime = DowntimeLog.objects.filter(
            production_job__machine_id=machine_id,
            start_time__gte=start_time,
        ).exclude(end_time__isnull=True)
        downtime_seconds = 0.0
        for row in downtime.only("start_time", "end_time"):
            if row.start_time and row.end_time and row.end_time > row.start_time:
                downtime_seconds += (row.end_time - row.start_time).total_seconds()

        runtime_seconds = max(0.0, total_seconds - downtime_seconds)
        return round((runtime_seconds / total_seconds) * 100, 1)

    @staticmethod
    @safe_service(
        default_value={
            "oee": 0,
            "scrap_rate": 0,
            "utilization": 0,
            "on_time_delivery": 0,
            "sales_velocity": {"current_30d": 0, "previous_30d": 0, "growth": 0},
            "inventory_summary": {"fg_kg": 0, "rm_kg": 0},
            "efficiency_score": 0,
            "trends": {"production": [], "scrap": []},
        }
    )
    def get_real_metrics(work_center_ids=None):
        today = timezone.now().date()
        last_30_days = today - timedelta(days=30)
        prev_30_days = last_30_days - timedelta(days=30)
        last_7d = today - timedelta(days=7)

        # Optional scope filter by work center.
        execution_scope = {}
        scrap_scope = {}
        sales_scope = {}
        inv_roll_scope = {}
        bulk_scope = {}
        if work_center_ids:
            wc_ids = list(work_center_ids)
            execution_scope["production_job__work_center_id__in"] = wc_ids
            scrap_scope["production_job__work_center_id__in"] = wc_ids
            inv_roll_scope["production_job__work_center_id__in"] = wc_ids
            plant_ids = list(
                WorkCenter.objects.filter(id__in=wc_ids)
                .exclude(plant_id__isnull=True)
                .values_list("plant_id", flat=True)
                .distinct()
            )
            if plant_ids:
                bulk_scope["plant_id__in"] = plant_ids

        produced_today = Decimal(
            str(
                JobExecutionLog.objects.filter(
                    logged_at__date=today,
                    **execution_scope,
                ).aggregate(total=Sum("quantity"))["total"]
                or 0
            )
        )
        scrap_today = Decimal(
            str(
                ScrapLog.objects.filter(
                    logged_at__date=today,
                    **scrap_scope,
                ).aggregate(total=Sum("quantity"))["total"]
                or 0
            )
        )

        if produced_today == 0 and scrap_today == 0:
            produced = Decimal(
                str(
                    JobExecutionLog.objects.filter(
                        logged_at__date__gte=last_7d,
                        **execution_scope,
                    ).aggregate(total=Sum("quantity"))["total"]
                    or 0
                )
            )
            scrap = Decimal(
                str(
                    ScrapLog.objects.filter(
                        logged_at__date__gte=last_7d,
                        **scrap_scope,
                    ).aggregate(total=Sum("quantity"))["total"]
                    or 0
                )
            )
        else:
            produced = produced_today
            scrap = scrap_today

        scrap_rate = float((scrap / (produced + scrap) * 100) if (produced + scrap) > 0 else 0)

        machines = Machine.objects.all()
        if work_center_ids:
            machines = machines.filter(work_center_id__in=work_center_ids)
        machine_ids = list(machines.values_list("id", flat=True))
        total_util = 0.0
        for machine_id in machine_ids:
            total_util += KPIService.calculate_utilization(machine_id, days=7)
        avg_utilization = round(total_util / max(len(machine_ids), 1), 1) if machine_ids else 0.0

        # OEE proxy from utilization (availability) and quality.
        quality = max(0.0, 100.0 - scrap_rate)
        oee_proxy = round((avg_utilization * quality) / 100.0, 1)

        # OTIF proxy from dispatch evidence against requested delivery date.
        # Historical order statuses are inconsistent, so use the latest dispatch
        # timestamp when available and fall back to completed/dispatched-like statuses
        # only for the delivered population.
        delivered = SalesOrder.objects.filter(**sales_scope).annotate(
            last_dispatch_at=Max("challans__dispatch_date")
        ).filter(
            Q(last_dispatch_at__isnull=False)
            | Q(status__in=["DELIVERED", "DISPATCHED", "DISPATCH_READY", "COMPLETED"])
        )
        delivered_count = delivered.count()
        on_time_count = delivered.filter(
            delivery_date__isnull=False,
            last_dispatch_at__isnull=False,
            last_dispatch_at__date__lte=models.F("delivery_date"),
        ).count()
        on_time_delivery = round((on_time_count / delivered_count * 100.0), 1) if delivered_count else 0.0

        current_sales = Decimal(
            str(
                SalesOrder.objects.filter(created_at__date__gte=last_30_days, **sales_scope).aggregate(
                    total=Sum("items__total_weight_kg")
                )["total"]
                or 0
            )
        )
        previous_sales = Decimal(
            str(
                SalesOrder.objects.filter(
                    created_at__date__gte=prev_30_days,
                    created_at__date__lt=last_30_days,
                    **sales_scope,
                ).aggregate(total=Sum("items__total_weight_kg"))["total"]
                or 0
            )
        )
        growth = 0.0
        if previous_sales > 0:
            growth = float(((current_sales - previous_sales) / previous_sales) * 100)
        elif current_sales > 0:
            growth = 100.0

        fg_kg = Decimal(
            str(
                InventoryRoll.objects.filter(
                    is_fg=True,
                    status__in=["AVAILABLE", "RESERVED", "IN_PROCESS"],
                    **inv_roll_scope,
                ).aggregate(total=Sum("weight_kg"))["total"]
                or 0
            )
        )
        rm_kg = Decimal(str(InventoryBulk.objects.filter(**bulk_scope).aggregate(total=Sum("qty_kg"))["total"] or 0))

        production_trend = (
            JobExecutionLog.objects.filter(logged_at__date__gte=last_30_days, **execution_scope)
            .extra(select={"day": "date(logged_at)"})
            .values("day")
            .annotate(value=Sum("quantity"))
            .order_by("day")
        )
        scrap_trend = (
            ScrapLog.objects.filter(logged_at__date__gte=last_30_days, **scrap_scope)
            .extra(select={"day": "date(logged_at)"})
            .values("day")
            .annotate(value=Sum("quantity"))
            .order_by("day")
        )

        efficiency_score = round((oee_proxy * 0.6) + (quality * 0.4), 1)

        return {
            "oee": oee_proxy,
            "scrap_rate": round(scrap_rate, 2),
            "utilization": avg_utilization,
            "on_time_delivery": on_time_delivery,
            "sales_velocity": {
                "current_30d": round(float(current_sales), 3),
                "previous_30d": round(float(previous_sales), 3),
                "growth": round(growth, 2),
            },
            "inventory_summary": {
                "fg_kg": round(float(fg_kg), 3),
                "rm_kg": round(float(rm_kg), 3),
            },
            "efficiency_score": efficiency_score,
            "trends": {
                "production": [
                    {"date": str(row["day"]), "value": round(float(row["value"] or 0), 3)}
                    for row in production_trend
                ],
                "scrap": [
                    {"date": str(row["day"]), "value": round(float(row["value"] or 0), 3)}
                    for row in scrap_trend
                ],
            },
        }
