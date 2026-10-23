from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.db.models import Prefetch, ProtectedError, Q
from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import SalesOrder, SalesOrderItem
from .serializers_orders import (
    RepeatLineCandidateSerializer,
    SalesOrderBatchResultSerializer,
    SalesOrderListSerializer,
    SalesOrderSerializer,
)
from .services import SalesOrderService
from .services.bom_preview import BOMPreviewService
from .services.order_block_resolver import resolve_block_reasons
from config.archive import ArchiveScope, ArchiveScopedListMixin


class SalesOrderViewSet(ArchiveScopedListMixin, viewsets.ModelViewSet):
    """Sales orders.

    Only a DRAFT order can be edited or deleted. Once confirmed, an order is
    commercial and production evidence: it changes through confirm, cancel
    (whole order or lines) and the planner's short-close, never by a raw
    update or delete.
    """
    archive_scope = ArchiveScope("created_at", Q(status__in=["COMPLETED", "CANCELLED"]))

    queryset = SalesOrder.objects.all().order_by("-created_at")
    serializer_class = SalesOrderSerializer
    EDITABLE_STATUSES = {"DRAFT"}

    def _locked_order_response(self, order, verb):
        return Response(
            {
                "detail": (
                    f"Order {order.order_number or order.id} is {order.status}. Only a draft order can be {verb}; "
                    "use Cancel (whole order or selected lines) for a confirmed order."
                ),
                "code": "ORDER_NOT_DRAFT",
            },
            status=status.HTTP_409_CONFLICT,
        )

    def update(self, request, *args, **kwargs):
        order = self.get_object()
        if order.status not in self.EDITABLE_STATUSES:
            return self._locked_order_response(order, "edited")
        return super().update(request, *args, **kwargs)

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        order = SalesOrder.objects.select_for_update().get(pk=self.get_object().pk)
        if order.status not in self.EDITABLE_STATUSES:
            return self._locked_order_response(order, "deleted")
        from apps.production.models import ProductionJob

        if ProductionJob.objects.filter(sales_order_item__sales_order=order).exists():
            return Response(
                {"detail": "This draft already has production jobs. Cancel it instead of deleting it.", "code": "ORDER_HAS_JOBS"},
                status=status.HTTP_409_CONFLICT,
            )
        try:
            with transaction.atomic():
                order.delete()
        except ProtectedError:
            return Response(
                {"detail": "This draft is referenced by stock or dispatch records. Cancel it instead of deleting it.", "code": "ORDER_REFERENCED"},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)

    def _is_summary_request(self) -> bool:
        request = getattr(self, "request", None)
        if not request or getattr(self, "action", "") != "list":
            return False
        params = getattr(request, "query_params", None) or getattr(request, "GET", {})
        value = str(params.get("summary") or "").strip().lower()
        return value in {"1", "true", "yes", "compact"}

    def get_serializer_class(self):
        if self._is_summary_request():
            return SalesOrderListSerializer
        return SalesOrderSerializer

    def _bounded_int(self, value, *, default: int, minimum: int, maximum: int) -> int:
        try:
            parsed = int(value)
        except Exception:
            return default
        return max(minimum, min(maximum, parsed))

    def get_queryset(self):
        if self._is_summary_request():
            item_queryset = SalesOrderItem.objects.select_related(
                "template",
                "sku_variant",
                "product_master",
                "product_variant",
                "customer_product_overlay",
                "assigned_artwork",
            ).prefetch_related("production_batches", "assigned_artwork__images").order_by("created_at")
            queryset = (
                SalesOrder.objects.all()
                .select_related("customer", "ship_to_customer")
                .prefetch_related(Prefetch("items", queryset=item_queryset))
                .order_by("-created_at")
            )
        else:
            queryset = (
                SalesOrder.objects.all()
                .prefetch_related(
                    "items__inventory_rolls",
                    "items__fg_batches",
                    "items__packing_units",
                    "items__production_batches",
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
        if status_filter == "OPEN":
            # The orders queue: everything not completed or cancelled, however old.
            queryset = queryset.exclude(status__in=["COMPLETED", "CANCELLED"])
        elif status_filter and status_filter != "ALL":
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
                | Q(items__template__name__icontains=search)
                | Q(items__sku_variant__code__icontains=search)
                | Q(items__sku_variant__name__icontains=search)
                | Q(items__product_master__code__icontains=search)
                | Q(items__product_master__name__icontains=search)
                | Q(items__axis_values__icontains=search)
                | Q(items__geometry_snapshot__icontains=search)
                | Q(items__layer_snapshot__icontains=search)
                | Q(items__printing_snapshot__icontains=search)
                | Q(items__addons_snapshot__icontains=search)
                | Q(items__packaging_snapshot__icontains=search)
                | Q(items__assigned_artwork__design_code__icontains=search)
                | Q(items__assigned_artwork__name__icontains=search)
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

    @action(detail=False, methods=["get"])
    def kpis(self, request):
        """Header figures for the orders page over every order, not only the rows loaded on screen.

        Same definitions as the page: open = not completed/cancelled; age = whole days since the
        order was placed; value = the sum of line amounts (kg x rate, or pieces x rate for
        piece-priced lines); aged = open and 6+ days old.
        """
        from django.utils import timezone

        from .job_name import clean_job_name

        now = timezone.now()
        orders = list(SalesOrder.objects.values_list("id", "status", "created_at", "customer_id"))
        open_ids = {oid for oid, status_code, _, _ in orders if str(status_code or "").upper() not in {"COMPLETED", "CANCELLED"}}
        value_by_order, kg_by_order = {}, {}
        for item in SalesOrderItem.objects.filter(sales_order_id__in=open_ids).only(
            "sales_order_id", "price_basis", "qty_uom", "unit_price", "qty_value", "unit_weight_g", "total_weight_kg"
        ):
            value_by_order[item.sales_order_id] = value_by_order.get(item.sales_order_id, Decimal("0")) + Decimal(str(item.line_amount or 0))
            kg_by_order[item.sales_order_id] = kg_by_order.get(item.sales_order_id, Decimal("0")) + Decimal(str(item.total_weight_kg or 0))

        def age(created_at):
            return max(0, int((now - created_at).total_seconds() // 86400)) if created_at else 0

        open_rows = [(oid, status_code, age(created), customer) for oid, status_code, created, customer in orders if oid in open_ids]
        aged = [row for row in open_rows if row[2] >= 6]
        return Response({
            "total": len(orders),
            "open": len(open_rows),
            "awaiting": sum(1 for row in open_rows if str(row[1] or "").upper() == "PLANNING_REQUIRED"),
            "aged": len(aged),
            "aged_kg": float(sum((kg_by_order.get(row[0], Decimal("0")) for row in aged), Decimal("0"))),
            "created_today": sum(1 for _, _, created, _ in orders if age(created) == 0),
            "value_in_flight": float(sum(value_by_order.values(), Decimal("0"))),
            "avg_age": round(sum(row[2] for row in open_rows) / len(open_rows), 1) if open_rows else 0,
            "customers_open": len({row[3] for row in open_rows if row[3]}),
            "history_count": sum(1 for _, status_code, _, _ in orders if str(status_code or "").upper() == "COMPLETED"),
            "cancelled_count": sum(1 for _, status_code, _, _ in orders if str(status_code or "").upper() == "CANCELLED"),
            "job_names_open": len({
                clean_job_name(name).casefold()
                for name in SalesOrder.objects.filter(id__in=open_ids).values_list("order_name", flat=True)
                if clean_job_name(name)
            }),
        })

    @action(detail=False, methods=["get"], url_path="job-names")
    def job_names(self, request):
        """Orders grouped by the job name sales gave them when placing the order.

        Per job name: orders (open / all), lines, customers, kg and pcs ordered and dispatched,
        open kg, value, on-time share of completed orders, first and last order. Follows the
        header year picker (?fy=); orders without a job name are counted, not grouped.
        """
        from apps.production.models import DeliveryChallanItem
        from config.archive import apply_archive_scope

        from .job_name import clean_job_name

        orders = apply_archive_scope(SalesOrder.objects.all(), request, self.archive_scope)
        customer = str(request.query_params.get("customer") or "").strip()
        if customer:
            orders = orders.filter(customer_name__icontains=customer)
        rows = list(orders.values_list("id", "order_name", "status", "created_at", "delivery_date", "completed_at", "customer_name"))
        named = {oid: clean_job_name(name) for oid, name, *_ in rows}
        ids = [oid for oid, name in named.items() if name]
        lines = {}
        for item in SalesOrderItem.objects.filter(sales_order_id__in=ids).exclude(line_status="CANCELLED").only(
            "id", "sales_order_id", "qty_uom", "qty_value", "unit_weight_g", "total_weight_kg", "price_basis", "unit_price"
        ):
            kg = Decimal(str(item.total_weight_kg or 0))
            if str(item.qty_uom or "").upper() == "PCS":
                pcs = Decimal(str(item.qty_value or 0))
            else:
                unit = Decimal(str(item.unit_weight_g or 0))
                pcs = (kg * Decimal("1000") / unit) if unit > 0 else Decimal("0")
            bucket = lines.setdefault(item.sales_order_id, {"lines": 0, "kg": Decimal("0"), "pcs": Decimal("0"), "value": Decimal("0")})
            bucket["lines"] += 1
            bucket["kg"] += kg
            bucket["pcs"] += pcs
            bucket["value"] += Decimal(str(item.line_amount or 0))
        sent = {}
        for order_id, kg, pcs in DeliveryChallanItem.objects.filter(
            sales_order_item__sales_order_id__in=ids,
            challan__status__in=["DISPATCHED", "IN_TRANSIT", "DELIVERED"],
        ).values_list("sales_order_item__sales_order_id", "weight_kg", "qty_pcs"):
            bucket = sent.setdefault(order_id, {"kg": Decimal("0"), "pcs": 0})
            bucket["kg"] += Decimal(str(kg or 0))
            bucket["pcs"] += int(pcs or 0)

        groups = {}
        for oid, _name, status_code, created, due, completed, cust in rows:
            name = named.get(oid)
            if not name:
                continue
            key = name.casefold()
            g = groups.setdefault(key, {
                "job_name": name, "orders": 0, "open_orders": 0, "lines": 0, "customers": set(),
                "ordered_kg": Decimal("0"), "ordered_pcs": Decimal("0"), "dispatched_kg": Decimal("0"), "dispatched_pcs": 0,
                "value": Decimal("0"), "completed": 0, "on_time": 0, "first": created, "last": created, "order_ids": [],
            })
            g["orders"] += 1
            g["order_ids"].append(str(oid))
            is_open = str(status_code or "").upper() not in {"COMPLETED", "CANCELLED"}
            g["open_orders"] += 1 if is_open else 0
            if cust:
                g["customers"].add(cust)
            line = lines.get(oid) or {}
            g["lines"] += line.get("lines", 0)
            g["ordered_kg"] += line.get("kg", Decimal("0"))
            g["ordered_pcs"] += line.get("pcs", Decimal("0"))
            g["value"] += line.get("value", Decimal("0"))
            out = sent.get(oid) or {}
            g["dispatched_kg"] += out.get("kg", Decimal("0"))
            g["dispatched_pcs"] += out.get("pcs", 0)
            if str(status_code or "").upper() == "COMPLETED" and completed and due:
                g["completed"] += 1
                g["on_time"] += 1 if completed.date() <= due else 0
            if created and (g["first"] is None or created < g["first"]):
                g["first"] = created
            if created and (g["last"] is None or created > g["last"]):
                g["last"] = created

        def money(value):
            return float(value.quantize(Decimal("0.01")))

        out_rows = []
        for g in groups.values():
            open_kg = max(g["ordered_kg"] - g["dispatched_kg"], Decimal("0"))
            out_rows.append({
                "job_name": g["job_name"],
                "orders": g["orders"],
                "open_orders": g["open_orders"],
                "lines": g["lines"],
                "customers": sorted(g["customers"]),
                "ordered_kg": money(g["ordered_kg"]),
                "ordered_pcs": int(g["ordered_pcs"]),
                "dispatched_kg": money(g["dispatched_kg"]),
                "dispatched_pcs": g["dispatched_pcs"],
                "open_kg": money(open_kg),
                "value": money(g["value"]),
                "on_time_pct": round(g["on_time"] * 100 / g["completed"], 1) if g["completed"] else None,
                "first_order_at": g["first"],
                "last_order_at": g["last"],
                "order_ids": g["order_ids"][:50],
            })
        out_rows.sort(key=lambda row: (-row["open_kg"], -row["ordered_kg"], row["job_name"].casefold()))
        return Response({
            "rows": out_rows,
            "totals": {
                "job_names": len(out_rows),
                "job_names_open": sum(1 for row in out_rows if row["open_orders"]),
                "orders_named": len(ids),
                "orders_total": len(rows),
                "orders_unnamed": len(rows) - len(ids),
                "ordered_kg": money(sum((Decimal(str(r["ordered_kg"])) for r in out_rows), Decimal("0"))),
                "dispatched_kg": money(sum((Decimal(str(r["dispatched_kg"])) for r in out_rows), Decimal("0"))),
                "open_kg": money(sum((Decimal(str(r["open_kg"])) for r in out_rows), Decimal("0"))),
            },
        })

    @action(detail=True, methods=["get"])
    def spine(self, request, pk=None):
        """Read-only order spine: master -> quote -> order -> plan -> floor -> yard -> dispatch."""
        from .services.order_spine_service import OrderSpineService

        order = self.get_object()
        return Response(OrderSpineService.for_order(order))

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
            item_ids = request.data.get("item_ids") or request.data.get("line_item_ids") or []
            if item_ids:
                order = SalesOrderService.cancel_sales_order_lines(
                    pk,
                    item_ids=item_ids,
                    user=request.user,
                    reason=str(request.data.get("reason") or "").strip(),
                )
            else:
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
