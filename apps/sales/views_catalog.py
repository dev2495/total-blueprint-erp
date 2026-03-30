from django.db.models import Count, Max, Q
from rest_framework import viewsets

from .models import SalesSku, SalesSkuVariant
from .serializers_orders import SalesSkuSerializer, SalesSkuVariantSerializer


class SalesSkuViewSet(viewsets.ModelViewSet):
    serializer_class = SalesSkuSerializer
    search_fields = ["code", "name", "default_line_name", "template__name", "commercial_family__name"]
    filterset_fields = ["active", "template", "commercial_family"]

    def get_queryset(self):
        queryset = SalesSku.objects.select_related("template", "commercial_family").prefetch_related("variants").order_by("name", "code")
        customer_id = str(self.request.query_params.get("customer_id") or "").strip()
        if customer_id:
            queryset = queryset.annotate(
                customer_usage_count=Count(
                    "variants__sales_order_items",
                    filter=Q(variants__sales_order_items__sales_order__customer_id=customer_id),
                    distinct=True,
                ),
                customer_last_used_at=Max(
                    "variants__sales_order_items__sales_order__created_at",
                    filter=Q(variants__sales_order_items__sales_order__customer_id=customer_id),
                ),
            ).order_by("-customer_usage_count", "-customer_last_used_at", "name", "code")
        return queryset


class SalesSkuVariantViewSet(viewsets.ModelViewSet):
    serializer_class = SalesSkuVariantSerializer
    search_fields = ["code", "name", "sku__code", "sku__name"]
    filterset_fields = ["active", "sku", "finished_good_type"]

    def get_queryset(self):
        queryset = SalesSkuVariant.objects.select_related("sku", "sku__template").order_by("sku__name", "name", "code")
        customer_id = str(self.request.query_params.get("customer_id") or "").strip()
        sku_id = str(self.request.query_params.get("sku_id") or "").strip()
        if sku_id:
            queryset = queryset.filter(sku_id=sku_id)
        if customer_id:
            queryset = queryset.annotate(
                customer_usage_count=Count(
                    "sales_order_items",
                    filter=Q(sales_order_items__sales_order__customer_id=customer_id),
                    distinct=True,
                ),
                customer_last_used_at=Max(
                    "sales_order_items__sales_order__created_at",
                    filter=Q(sales_order_items__sales_order__customer_id=customer_id),
                ),
            ).order_by("-customer_usage_count", "-customer_last_used_at", "sku__name", "name", "code")
        return queryset
