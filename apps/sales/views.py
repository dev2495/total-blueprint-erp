from rest_framework import viewsets, status
from rest_framework.views import APIView
from rest_framework.decorators import action
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from .models import SalesOrder
from .serializers import SalesOrderSerializer
from .services.order_block_resolver import resolve_block_reasons

from .services import SalesOrderService

class SalesOrderViewSet(viewsets.ModelViewSet):
    queryset = SalesOrder.objects.all().order_by('-created_at')
    serializer_class = SalesOrderSerializer

    def get_queryset(self):
        return (
            SalesOrder.objects.all()
            .prefetch_related("items__inventory_rolls", "items__fg_batches")
            .order_by("-created_at")
        )

    def create(self, request, *args, **kwargs):
        # STRICT GUARD: Custom R&D cannot create Sales Orders
        if request.data.get('mode') == 'CUSTOM':
            return Response(
                {"detail": "Configuration Error: Custom R&D requests must be submitted via the Engineering Portal. Sales Orders require a LIVE Template."},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            order = SalesOrderService.create_sales_order(request.data)
            serializer = self.get_serializer(order)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'], url_path='preview-item')
    def preview_item(self, request):
        try:
            preview = SalesOrderService.preview_sales_item(request.data)
            return Response(preview, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'])
    def confirm(self, request, pk=None):
        try:
            order = SalesOrderService.confirm_sales_order(pk)
            serializer = self.get_serializer(order)
            return Response(serializer.data, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

class SalesOrderBlockReasonView(APIView):
    """
    Exposes why a SalesOrder is currently on hold or blocked.
    """
    def get(self, request, pk):
        try:
            order = get_object_or_404(SalesOrder, pk=pk)
            reasons = resolve_block_reasons(order)
            
            return Response({
                "order_number": order.order_number,
                "status": order.status,
                "can_confirm": len(reasons) == 0,
                "reasons": reasons
            })
        except Exception as e:
            return Response({
                "status": "error",
                "message": "Request failed.",
                "detail": str(e),
                "results": [],
                "data": {
                    "reasons": [],
                    "can_confirm": False,
                },
                "count": 0,
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
