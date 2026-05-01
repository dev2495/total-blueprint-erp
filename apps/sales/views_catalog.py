import re

from django.db import transaction
from django.db.models import Count, Max, Q
from rest_framework import status, viewsets
from rest_framework.response import Response

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
    versioned_edit_fields = {
        "sku",
        "code",
        "name",
        "finished_good_type",
        "roll_form",
        "geometry_snapshot",
        "layer_snapshot",
        "printing_snapshot",
        "chemicals_snapshot",
        "addons_snapshot",
        "packaging_snapshot",
    }

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

    @staticmethod
    def _version_root(code: str) -> str:
        root = re.sub(r"[-_\s]*V\d+$", "", str(code or "").strip(), flags=re.IGNORECASE).strip("-_ ")
        return root or str(code or "VARIANT").strip() or "VARIANT"

    def _next_version_code(self, instance: SalesSkuVariant, requested_code: str | None = None) -> str:
        requested = str(requested_code or "").strip().upper()
        if requested and requested != str(instance.code or "").upper():
            conflict = SalesSkuVariant.objects.filter(sku_id=instance.sku_id, code=requested).exclude(pk=instance.pk).exists()
            if not conflict:
                return requested[:80]

        root = self._version_root(instance.code).upper()
        for version in range(2, 1000):
            suffix = f"-V{version}"
            candidate = f"{root[:80 - len(suffix)]}{suffix}"
            if not SalesSkuVariant.objects.filter(sku_id=instance.sku_id, code=candidate).exists():
                return candidate
        raise ValueError("Unable to allocate the next sales variant version code.")

    @staticmethod
    def _payload_bool(value, default=True):
        if value is None:
            return default
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() not in {"0", "false", "no", "off"}

    def _versioned_update(self, request, partial=False):
        instance = self.get_object()
        changed_keys = set(request.data.keys())
        if changed_keys and changed_keys <= {"active"}:
            return super().update(request, partial=partial)

        incoming = request.data.copy()
        with transaction.atomic():
            instance.active = False
            instance.save(update_fields=["active", "updated_at"])

            payload = {
                "sku": str(instance.sku_id),
                "code": self._next_version_code(instance, incoming.get("code")),
                "name": instance.name,
                "active": True,
                "finished_good_type": instance.finished_good_type,
                "roll_form": instance.roll_form,
                "geometry_snapshot": instance.geometry_snapshot,
                "layer_snapshot": instance.layer_snapshot,
                "printing_snapshot": instance.printing_snapshot,
                "chemicals_snapshot": instance.chemicals_snapshot,
                "addons_snapshot": instance.addons_snapshot,
                "packaging_snapshot": instance.packaging_snapshot,
            }
            for field in self.versioned_edit_fields:
                if field in incoming and field != "code":
                    payload[field] = incoming.get(field)
            payload["active"] = self._payload_bool(incoming.get("active"), True)

            serializer = self.get_serializer(data=payload)
            serializer.is_valid(raise_exception=True)
            self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def update(self, request, *args, **kwargs):
        return self._versioned_update(request, partial=kwargs.pop("partial", False))

    def partial_update(self, request, *args, **kwargs):
        return self._versioned_update(request, partial=True)
