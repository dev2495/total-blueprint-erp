from decimal import Decimal

from django.db.models import Avg, Count, Q, Sum
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.sales.models import SalesOrderItem

from .models import (
    CostAbsorptionGroup,
    JobCost,
    JobRuntimeSession,
    MaterialCostSnapshot,
    MonthlyOverhead,
    OrderCost,
    PlantCostPoolLine,
    PlantCostPoolMonth,
    ProcessCostRate,
)
from .serializers import (
    CostAbsorptionGroupSerializer,
    JobCostSerializer,
    JobRuntimeSessionSerializer,
    MaterialCostSnapshotSerializer,
    MonthlyOverheadSerializer,
    OrderCostSerializer,
    PlantCostPoolLineSerializer,
    PlantCostPoolMonthSerializer,
    ProcessCostRateSerializer,
)
from .services import CostingService


class MaterialCostSnapshotViewSet(viewsets.ModelViewSet):
    queryset = MaterialCostSnapshot.objects.all()
    serializer_class = MaterialCostSnapshotSerializer


class CostAbsorptionGroupViewSet(viewsets.ModelViewSet):
    queryset = CostAbsorptionGroup.objects.all()
    serializer_class = CostAbsorptionGroupSerializer
    pagination_class = None


class PlantCostPoolMonthViewSet(viewsets.ModelViewSet):
    queryset = PlantCostPoolMonth.objects.select_related("plant").prefetch_related("lines__cost_group").all()
    serializer_class = PlantCostPoolMonthSerializer

    @action(detail=True, methods=["post"], url_path="allocate-from-totals")
    def allocate_from_totals(self, request, pk=None):
        month_record = self.get_object()
        percentages = request.data.get("percentages") or {}
        if not isinstance(percentages, dict) or not percentages:
            return Response({"error": "percentages object is required."}, status=status.HTTP_400_BAD_REQUEST)

        totals = {
            "electricity_cost": Decimal(str(month_record.plant_total_electricity or 0)),
            "labor_cost": Decimal(str(month_record.plant_total_labor or 0)),
            "overhead_cost": Decimal(str(month_record.plant_total_overhead or 0)),
            "maintenance_cost": Decimal(str(month_record.plant_total_maintenance or 0)),
            "service_burden_cost": Decimal(str(month_record.plant_total_service_burden or 0)),
        }

        groups = CostAbsorptionGroup.objects.filter(
            Q(id__in=[key for key in percentages.keys() if "-" in str(key)]) | Q(code__in=list(percentages.keys()))
        )
        if not groups.exists():
            groups = CostAbsorptionGroup.objects.filter(is_active=True)

        for group in groups:
            percent = Decimal(str(percentages.get(str(group.id), percentages.get(group.code, 0)) or 0))
            defaults = {"entry_mode": "ALLOCATED", "allocation_percent": percent}
            for field, total in totals.items():
                defaults[field] = (total * percent / Decimal("100")).quantize(Decimal("0.01"))
            PlantCostPoolLine.objects.update_or_create(
                month_record=month_record,
                cost_group=group,
                defaults=defaults,
            )

        month_record.entry_mode = "ALLOCATED"
        month_record.save(update_fields=["entry_mode", "updated_at"])
        month_record.refresh_from_db()
        return Response(PlantCostPoolMonthSerializer(month_record).data)

    @action(detail=True, methods=["post"], url_path="lock")
    def lock_month(self, request, pk=None):
        month_record = self.get_object()
        month_record.status = "LOCKED"
        month_record.save(update_fields=["status", "updated_at"])
        return Response({"status": "LOCKED", "id": str(month_record.id)})

    @action(detail=True, methods=["post"], url_path="review")
    def review_month(self, request, pk=None):
        month_record = self.get_object()
        month_record.status = "REVIEWED"
        month_record.save(update_fields=["status", "updated_at"])
        return Response({"status": "REVIEWED", "id": str(month_record.id)})

    @action(detail=False, methods=["get"], url_path="dashboard-summary")
    def dashboard_summary(self, request):
        latest = (
            PlantCostPoolMonth.objects.select_related("plant")
            .prefetch_related("lines__cost_group")
            .order_by("-year", "-month", "plant__code")
            .first()
        )
        if not latest:
            return Response(
                {
                    "hero": {
                        "title": "Costing Command Deck",
                        "month_label": "No month configured",
                        "status": "DRAFT",
                    },
                    "kpis": {
                        "cost_group_count": 0,
                        "locked_months": 0,
                        "unabsorbed_pool_value": 0,
                        "avg_actual_cost_coverage_pct": 0,
                    },
                    "exceptions": [],
                }
            )

        line_ids = latest.lines.values_list("id", flat=True)
        pool_total = latest.lines.aggregate(
            electricity=Sum("electricity_cost"),
            labor=Sum("labor_cost"),
            overhead=Sum("overhead_cost"),
            maintenance=Sum("maintenance_cost"),
            service=Sum("service_burden_cost"),
        )
        order_costs = OrderCost.objects.filter(created_at__year=latest.year, created_at__month=latest.month)
        return Response(
            {
                "hero": {
                    "title": "Costing Command Deck",
                    "month_label": f"{latest.plant.code} · {latest.year}-{latest.month:02d}",
                    "status": latest.status,
                    "entry_mode": latest.entry_mode,
                },
                "kpis": {
                    "cost_group_count": latest.lines.count(),
                    "locked_months": PlantCostPoolMonth.objects.filter(status="LOCKED").count(),
                    "unabsorbed_pool_value": float(CostingService.get_financial_summary(year=latest.year, month=latest.month)["overheads"]["unabsorbed_pool_value"]),
                    "avg_actual_cost_coverage_pct": float(order_costs.aggregate(avg=Avg("actual_cost_coverage_pct"))["avg"] or 0),
                },
                "exceptions": list(
                    OrderCost.objects.filter(
                        created_at__year=latest.year,
                        created_at__month=latest.month,
                    )
                    .exclude(costing_mode=CostingService.COSTING_MODE_ACTUAL)
                    .values("sales_order_item__sales_order__order_number", "costing_mode", "coverage_flags")[:10]
                ),
                "line_count": len(line_ids),
                "pool_total": float(
                    (pool_total["electricity"] or 0)
                    + (pool_total["labor"] or 0)
                    + (pool_total["overhead"] or 0)
                    + (pool_total["maintenance"] or 0)
                    + (pool_total["service"] or 0)
                ),
            }
        )


class PlantCostPoolLineViewSet(viewsets.ModelViewSet):
    queryset = PlantCostPoolLine.objects.select_related("month_record__plant", "cost_group").all()
    serializer_class = PlantCostPoolLineSerializer


class ProcessCostRateViewSet(viewsets.ModelViewSet):
    queryset = ProcessCostRate.objects.all()
    serializer_class = ProcessCostRateSerializer


class JobRuntimeSessionViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = JobRuntimeSession.objects.select_related(
        "job",
        "plant",
        "work_center",
        "machine",
        "cost_absorption_group",
    ).all()
    serializer_class = JobRuntimeSessionSerializer


class JobCostViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = JobCost.objects.select_related("job", "plant", "cost_absorption_group").all()
    serializer_class = JobCostSerializer


class OrderCostViewSet(viewsets.ModelViewSet):
    queryset = OrderCost.objects.select_related(
        "sales_order_item",
        "sales_order_item__sales_order",
        "sales_order_item__template",
        "sales_order_item__sku_variant",
    ).all()
    serializer_class = OrderCostSerializer

    @action(detail=False, methods=["post"], url_path="calculate-item/(?P<item_id>[^/.]+)")
    def calculate_for_item(self, request, item_id=None):
        try:
            order_item = SalesOrderItem.objects.get(id=item_id)
        except SalesOrderItem.DoesNotExist:
            return Response({"error": "Sales Order Item not found."}, status=status.HTTP_404_NOT_FOUND)

        try:
            cost_result = CostingService.calculate_order_cost(order_item)
            if cost_result:
                return Response(OrderCostSerializer(cost_result).data)
            return Response({"error": "Could not calculate cost."}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:
            return Response({"error": str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=False, methods=["get"], url_path="dashboard-stats")
    def dashboard_stats(self, request):
        stats = OrderCost.objects.aggregate(
            avg_margin=Avg("absorbed_margin_percent"),
            avg_coverage=Avg("actual_cost_coverage_pct"),
            total_margin=Sum("absorbed_margin"),
            total_cost=Sum("total_cost"),
            actual_count=Count("id", filter=Q(costing_mode=CostingService.COSTING_MODE_ACTUAL)),
            hybrid_count=Count("id", filter=Q(costing_mode=CostingService.COSTING_MODE_HYBRID)),
            estimated_count=Count("id", filter=Q(costing_mode=CostingService.COSTING_MODE_ESTIMATED)),
        )
        leakage_orders = OrderCost.objects.order_by("absorbed_margin")[:5]
        return Response(
            {
                "kpis": {
                    "avg_margin_percent": float(stats["avg_margin"] or 0),
                    "avg_actual_cost_coverage_pct": float(stats["avg_coverage"] or 0),
                    "total_margin_value": float(stats["total_margin"] or 0),
                    "total_cost_volume": float(stats["total_cost"] or 0),
                    "actual_count": stats["actual_count"] or 0,
                    "hybrid_count": stats["hybrid_count"] or 0,
                    "estimated_count": stats["estimated_count"] or 0,
                },
                "loss_alerts": OrderCostSerializer(leakage_orders, many=True).data,
            }
        )


class MonthlyOverheadViewSet(viewsets.ModelViewSet):
    queryset = MonthlyOverhead.objects.all().order_by("-year", "-month")
    serializer_class = MonthlyOverheadSerializer
