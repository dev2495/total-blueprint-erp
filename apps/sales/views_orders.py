from django.conf import settings
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import SalesOrder, SalesOrderItem
from .serializers_orders import (
    RepeatLineCandidateSerializer,
    SalesOrderBatchResultSerializer,
    SalesOrderSerializer,
)
from .services import SalesOrderService
from .services.bom_preview import BOMPreviewService
from .services.order_block_resolver import resolve_block_reasons


class SalesOrderViewSet(viewsets.ModelViewSet):
    queryset = SalesOrder.objects.all().order_by("-created_at")
    serializer_class = SalesOrderSerializer

    def _bounded_int(self, value, *, default: int, minimum: int, maximum: int) -> int:
        try:
            parsed = int(value)
        except Exception:
            return default
        return max(minimum, min(maximum, parsed))

    def get_queryset(self):
        queryset = (
            SalesOrder.objects.all()
            .prefetch_related(
                "items__inventory_rolls",
                "items__fg_batches",
                "items__packing_units",
                "items__sku_variant",
                "items__product_master",
                "items__product_variant",
                "items__customer_product_overlay",
                "items__template",
                "items__assigned_artwork__images",
            )
            .order_by("-created_at")
        )
        request = getattr(self, "request", None)
        params = getattr(request, "query_params", {})
        status_filter = str(params.get("status") or "").strip().upper()
        if status_filter and status_filter != "ALL":
            queryset = queryset.filter(status=status_filter)

        customer_id = str(params.get("customer") or params.get("customer_id") or "").strip()
        if customer_id:
            queryset = queryset.filter(Q(customer_id=customer_id) | Q(ship_to_customer_id=customer_id))

        search = str(params.get("q") or params.get("search") or "").strip()
        if search:
            queryset = queryset.filter(
                Q(order_number__icontains=search)
                | Q(order_name__icontains=search)
                | Q(customer__name__icontains=search)
                | Q(ship_to_customer__name__icontains=search)
                | Q(items__line_name__icontains=search)
                | Q(items__product_master__code__icontains=search)
                | Q(items__product_master__name__icontains=search)
            ).distinct()
        return queryset

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        limit = self._bounded_int(
            request.query_params.get("limit") or request.query_params.get("page_size"),
            default=80,
            minimum=1,
            maximum=150,
        )
        offset = self._bounded_int(request.query_params.get("offset"), default=0, minimum=0, maximum=10000)
        page = list(queryset[offset : offset + limit])
        serializer = self.get_serializer(page, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def create(self, request, *args, **kwargs):
        if request.data.get("mode") == "CUSTOM":
            return Response(
                {"detail": "Configuration Error: Custom R&D requests must be submitted via the Engineering Portal. Sales Orders require a LIVE Template."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            order = SalesOrderService.create_sales_order(request.data)
            if not request.data.get("save_as_draft"):
                order = SalesOrderService.confirm_sales_order(order.id)
            serializer = self.get_serializer(order)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        except Exception as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=["post"], url_path="preview-item")
    def preview_item(self, request):
        try:
            preview = SalesOrderService.preview_sales_item(request.data)
            return Response(preview, status=status.HTTP_200_OK)
        except Exception as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=["post"], url_path="preview-line")
    def preview_line(self, request):
        if not bool(getattr(settings, "ERP_V3_DEFAULT", True)):
            return Response({"detail": "Product Master sales flow is disabled by ERP_V3_DEFAULT."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            preview = BOMPreviewService.for_line(request.data)
            return Response(preview, status=status.HTTP_200_OK)
        except Exception as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=["get"], url_path="repeat-lines")
    def repeat_lines(self, request):
        customer_id = str(request.query_params.get("customer_id") or "").strip()
        search = str(request.query_params.get("q") or "").strip()
        queryset = list(
            SalesOrderItem.objects.select_related("sales_order", "template", "sku_variant")
            .filter(sales_order__status__in=["DRAFT", "PLANNING_REQUIRED", "PLANNED", "RELEASED", "PACKING_READY", "DISPATCH_READY", "COMPLETED"])
            .order_by("-sales_order__created_at", "-created_at")
        )
        if customer_id:
            queryset = [row for row in queryset if str(getattr(row.sales_order, "customer_id", "") or "") == customer_id]
        if search:
            normalized = search.lower()
            queryset = [
                row
                for row in queryset
                if normalized in str(row.line_name or "").lower()
                or normalized in str(getattr(row.template, "name", "") or "").lower()
                or normalized in str(getattr(row.sales_order, "order_number", "") or "").lower()
                or normalized in str(getattr(row.sales_order, "order_name", "") or "").lower()
                or normalized in str(getattr(getattr(row, "sku_variant", None), "name", "") or "").lower()
                or normalized in str(getattr(getattr(row, "sku_variant", None), "code", "") or "").lower()
            ]

        frequency_by_key = {}
        for row in queryset:
            key = str(getattr(row, "sku_variant_id", "") or "") or f"{row.template_id}:{str(row.line_name or '').strip().lower()}"
            frequency_by_key[key] = frequency_by_key.get(key, 0) + 1

        queryset.sort(
            key=lambda row: (
                getattr(getattr(row, "sales_order", None), "created_at", None),
                frequency_by_key.get(
                    str(getattr(row, "sku_variant_id", "") or "") or f"{row.template_id}:{str(row.line_name or '').strip().lower()}",
                    0,
                ),
            ),
            reverse=True,
        )

        serializer = RepeatLineCandidateSerializer(queryset[:50], many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=False, methods=["post"], url_path="batch-create")
    def batch_create(self, request):
        try:
            result = SalesOrderService.create_sales_order_batch(request.data)
            serializer = SalesOrderBatchResultSerializer(result["results"], many=True)
            return Response(
                {
                    "customer": result.get("customer"),
                    "customer_name": result.get("customer_name"),
                    "created_count": result.get("created_count", 0),
                    "failed_count": result.get("failed_count", 0),
                    "results": serializer.data,
                },
                status=status.HTTP_200_OK,
            )
        except Exception as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        try:
            order = SalesOrderService.confirm_sales_order(pk)
            serializer = self.get_serializer(order)
            return Response(serializer.data, status=status.HTTP_200_OK)
        except Exception as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        try:
            order = SalesOrderService.cancel_sales_order(
                pk,
                user=request.user,
                reason=str(request.data.get("reason") or "").strip(),
            )
            serializer = self.get_serializer(order)
            return Response(serializer.data, status=status.HTTP_200_OK)
        except Exception as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)


class SalesOrderBlockReasonView(APIView):
    def get(self, request, pk):
        try:
            order = get_object_or_404(SalesOrder, pk=pk)
            reasons = resolve_block_reasons(order)
            return Response(
                {
                    "order_number": order.order_number,
                    "status": order.status,
                    "can_confirm": len(reasons) == 0,
                    "reasons": reasons,
                }
            )
        except Exception as exc:
            return Response(
                {
                    "status": "error",
                    "message": "Request failed.",
                    "detail": str(exc),
                    "results": [],
                    "data": {"reasons": [], "can_confirm": False},
                    "count": 0,
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
