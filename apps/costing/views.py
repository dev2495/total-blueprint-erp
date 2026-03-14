from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import MaterialCostSnapshot, ProcessCostRate, JobCost, OrderCost, MonthlyOverhead
from .serializers import (
    MaterialCostSnapshotSerializer, ProcessCostRateSerializer,
    JobCostSerializer, OrderCostSerializer, MonthlyOverheadSerializer
)
from .services import CostingService
from apps.sales.models import SalesOrderItem

class MaterialCostSnapshotViewSet(viewsets.ModelViewSet):
    queryset = MaterialCostSnapshot.objects.all()
    serializer_class = MaterialCostSnapshotSerializer

class ProcessCostRateViewSet(viewsets.ModelViewSet):
    queryset = ProcessCostRate.objects.all()
    serializer_class = ProcessCostRateSerializer

class JobCostViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = JobCost.objects.all()
    serializer_class = JobCostSerializer

class OrderCostViewSet(viewsets.ModelViewSet):
    queryset = OrderCost.objects.all()
    serializer_class = OrderCostSerializer

class MonthlyOverheadViewSet(viewsets.ModelViewSet):
    queryset = MonthlyOverhead.objects.all().order_by('-year', '-month')
    serializer_class = MonthlyOverheadSerializer

    @action(detail=False, methods=['post'], url_path='calculate-item/(?P<item_id>[^/.]+)')
    def calculate_for_item(self, request, item_id=None):
        """
        Trigger calculation for a specific Sales Order Item.
        """
        try:
            order_item = SalesOrderItem.objects.get(id=item_id)
            cost_result = CostingService.calculate_order_cost(order_item)
            if cost_result:
                return Response(OrderCostSerializer(cost_result).data)
            return Response({"error": "Could not calculate cost. Check BOM snapshot."}, status=status.HTTP_400_BAD_REQUEST)
        except SalesOrderItem.DoesNotExist:
            return Response({"error": "Sales Order Item not found."}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=False, methods=['get'], url_path='dashboard-stats')
    def dashboard_stats(self):
        """
        Aggregate stats for Costing Center.
        """
        from django.db.models import Avg, Sum
        stats = OrderCost.objects.aggregate(
            avg_margin=Avg('margin_percent'),
            total_margin=Sum('margin_value'),
            total_cost=Sum('total_cost')
        )
        
        # Top Loss Orders (Negative Margin)
        loss_orders = OrderCost.objects.filter(margin_value__lt=0).order_by('margin_value')[:5]
        
        return Response({
            "kpis": {
                "avg_margin_percent": stats['avg_margin'] or 0,
                "total_margin_value": stats['total_margin'] or 0,
                "total_cost_volume": stats['total_cost'] or 0
            },
            "loss_alerts": OrderCostSerializer(loss_orders, many=True).data
        })
