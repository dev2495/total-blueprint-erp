"""Job-work API under /api/inventory/job-work/ (orders, challans, returns,
close, reports, legacy reconciliation). Business rules live in
apps.inventory.services.job_work; this module validates input, checks
permissions and shapes responses."""
from __future__ import annotations

import logging
from decimal import Decimal

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Q
from django.http import HttpResponse
from django.utils.dateparse import parse_date
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.inventory.models import InventoryRoll, JobWorkChallan, JobWorkOrder, Vendor
from apps.inventory.serializers import (
    JobWorkCancelSerializer,
    JobWorkCloseSerializer,
    JobWorkCreateSerializer,
    JobWorkDispatchSerializer,
    JobWorkLateBillSerializer,
    JobWorkLegacyReconcileSerializer,
    JobWorkReleaseStepSerializer,
    JobWorkReturnSerializer,
    JobWorkShortCloseSerializer,
    JobWorkVendorRateSerializer,
)
from apps.inventory.services import job_work_integrations  # noqa: F401  (registers QR, bill kind, notifications)
from apps.inventory.services import job_work_bills
from apps.inventory.services.fsm import TransitionError
from apps.inventory.services.job_work import (
    JobWorkService,
    messages_of,
    require_jobwork_permission,
    require_owner,
    resolve_job_plant,
    roll_rate_per_kg,
    vendor_rate_card,
)
from apps.inventory.services.job_work_payloads import annotate_balances, filter_orders, num, order_detail, order_row, tab_counts
from apps.inventory.services.job_work_reports import legacy_report, material_at_vendors, yield_by_vendor
from apps.production.models import ProductionJob
from apps.users.permissions import RoleBasedAccessPermission

logger = logging.getLogger(__name__)
UUID_RE = r"[0-9a-fA-F-]{36}"


def jobwork_exception_handler(exc, context):
    """Keep the specific reason in ``message`` (the global handler writes a
    generic "Request failed."), map Django/FSM refusals to 400/409."""
    from config.views import custom_exception_handler

    if isinstance(exc, DjangoValidationError):
        exc = ValidationError(messages_of(exc))
    elif isinstance(exc, TransitionError):
        from apps.inventory.services.job_work import Conflict

        exc = Conflict(str(exc))
    response = custom_exception_handler(exc, context)
    if response is None or response.status_code >= 500:
        return response
    detail = response.data.get("detail") if isinstance(response.data, dict) else None
    message = _first_message(detail)
    if message:
        response.data["message"] = message
    if response.status_code == 409:
        response.data["code"] = "CONFLICT"
    elif response.status_code == 400:
        response.data["code"] = "VALIDATION_ERROR"
        if isinstance(detail, dict):
            response.data["field_errors"] = detail
    return response


def _first_message(detail):
    if detail is None:
        return ""
    if isinstance(detail, (list, tuple)):
        parts = [_first_message(item) for item in detail]
        return " ".join(part for part in parts if part)
    if isinstance(detail, dict):
        parts = [_first_message(value) for value in detail.values()]
        return " ".join(part for part in parts if part)
    return str(detail)


class JobWorkPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 100

    def paginate_queryset(self, queryset, request, view=None):
        raw = request.query_params.get("page_size")
        if raw is not None and (not raw.isdigit() or not 1 <= int(raw) <= 100):
            raise ValidationError({"page_size": "Choose a page size between 1 and 100."})
        return super().paginate_queryset(queryset, request, view)


class JobWorkOrderViewSet(viewsets.ViewSet):
    # RBAC route map (STRICT_RBAC) first; every action re-checks inventory.view /
    # inventory.manage / Owner explicitly because tests and dev run non-strict.
    permission_classes = [IsAuthenticated, RoleBasedAccessPermission]
    lookup_value_regex = UUID_RE

    def get_exception_handler(self):
        return jobwork_exception_handler

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store"
        return response

    # ----------------------------------------------------------- helpers
    def _order(self, pk) -> JobWorkOrder:
        order = JobWorkOrder.objects.filter(id=pk).first()
        if order is None:
            raise NotFound("This job-work order does not exist.")
        return order

    def _detail_response(self, request, order_id, result, status_code=status.HTTP_200_OK):
        order = self._order(order_id)
        payload = {**result, "order": order_detail(order, request.user)}
        code = status.HTTP_200_OK if result.get("replayed") else status_code
        return Response(payload, status=code)

    @staticmethod
    def _valid(serializer_class, request):
        serializer = serializer_class(data=request.data)
        serializer.is_valid(raise_exception=True)
        return serializer.validated_data

    # --------------------------------------------------------- list/read
    def list(self, request):
        require_jobwork_permission(request.user, "inventory.view")
        base = annotate_balances(JobWorkOrder.objects.select_related("plant", "vendor", "process", "production_job", "production_job__current_process", "production_job__process"))
        scope = base
        if request.query_params.get("plant"):
            scope = scope.filter(plant_id=request.query_params["plant"])
        if request.query_params.get("vendor"):
            scope = scope.filter(vendor_id=request.query_params["vendor"])
        queryset = filter_orders(base, request.query_params).order_by("-created_at", "-id")
        paginator = JobWorkPagination()
        page = paginator.paginate_queryset(queryset, request, view=self)
        response = paginator.get_paginated_response([order_row(order) for order in page])
        response.data["tab_counts"] = tab_counts(scope)
        return response

    def retrieve(self, request, pk=None):
        require_jobwork_permission(request.user, "inventory.view")
        return Response(order_detail(self._order(pk), request.user))

    def create(self, request):
        require_jobwork_permission(request.user, "inventory.manage")
        data = self._valid(JobWorkCreateSerializer, request)
        result = JobWorkService.create_from_api(user=request.user, data=data)
        return self._detail_response(request, result["order_id"], result, status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"], url_path="vendor-candidates")
    def vendor_candidates(self, request):
        require_jobwork_permission(request.user, "inventory.view")
        process_code = str(request.query_params.get("process_code") or "").upper()
        plant = None
        production_job_id = request.query_params.get("production_job_id")
        if production_job_id:
            job = ProductionJob.objects.select_related("current_process", "process", "work_center__plant", "from_location__plant", "to_location__plant").filter(id=production_job_id).first()
            if job is None:
                raise NotFound("This production job does not exist.")
            process = job.current_process or job.process
            process_code = str(getattr(process, "code", process_code) or "").upper()
            plant = resolve_job_plant(job)
        elif request.query_params.get("plant_id"):
            from apps.factory.models import Plant

            plant = Plant.objects.filter(id=request.query_params["plant_id"]).first()
            if plant is None:
                raise ValidationError({"plant_id": "This plant does not exist."})
        rows = []
        for vendor, verdict in JobWorkService.compatible_vendors(process_code=process_code, plant=plant):
            rows.append({
                "id": str(vendor.id), "name": vendor.name, "code": vendor.code, "type": vendor.type, "status": vendor.status,
                "gst_no": vendor.gst_no, "state": vendor.mailing_state,
                "turnaround_hours": vendor.turnaround_hours, "qc_required": vendor.qc_required,
                "jobwork_capabilities": vendor.jobwork_capabilities or [], "jobwork_plants": vendor.jobwork_plants or [],
                "jobwork_rates": vendor.jobwork_rates or [], "process_rates": vendor_rate_card(vendor, process_code) if process_code else [],
                "vendor_capability_match": verdict["match"], "match_reasons": verdict["reasons"],
            })
        return Response({"results": rows, "process_code": process_code or None, "plant": str(plant.id) if plant else None})

    @action(detail=False, methods=["get"], url_path="eligible-jobs")
    def eligible_jobs(self, request):
        """Production jobs a job-work order can be raised for. Served here (inventory.view)
        because inventory accounts that raise job work need not hold production.view."""
        require_jobwork_permission(request.user, "inventory.view")
        qs = ProductionJob.objects.select_related(
            "current_process", "process", "template", "work_center__plant", "from_location__plant", "to_location__plant", "sales_order_item__sales_order",
        ).filter(job_state__in=["RELEASED", "EXECUTING", "PAUSED"])
        search = str(request.query_params.get("search") or "").strip()
        if search:
            qs = qs.filter(
                Q(job_number__icontains=search) | Q(sales_order_item__line_name__icontains=search)
                | Q(sales_order_item__sales_order__customer_name__icontains=search) | Q(sales_order_item__sales_order__order_number__icontains=search)
            )
        rows = []
        for job in qs.order_by("-created_at", "-id")[:200]:
            process = job.current_process or job.process
            item = job.sales_order_item
            sales_order = getattr(item, "sales_order", None)
            plant = resolve_job_plant(job)
            rows.append({
                "id": str(job.id), "job_number": job.job_number, "job_state": job.job_state,
                "process_code": getattr(process, "code", "") or "", "process_name": getattr(process, "name", "") or "",
                "product_name": getattr(item, "line_name", "") or "", "template_name": getattr(job.template, "name", "") or "",
                "customer_name": getattr(sales_order, "customer_name", "") or "", "order_number": getattr(sales_order, "order_number", "") or "",
                "quantity": num(job.quantity), "uom": job.uom, "work_center_name": getattr(job.work_center, "name", "") or "",
                "plant": str(plant.id) if plant else None, "plant_name": plant.name if plant else "",
            })
        return Response({"results": rows})

    @action(detail=True, methods=["get"], url_path="eligible-rolls")
    def eligible_rolls(self, request, pk=None):
        require_jobwork_permission(request.user, "inventory.view")
        order = self._order(pk)
        qs = InventoryRoll.objects.select_related("material", "location", "production_job").filter(
            location__plant=order.plant, status__in=["AVAILABLE", "RESERVED", "IN_PROCESS"], weight_kg__gt=0,
        ).exclude(location__type__in=["JOBWORK", "TRANSIT"])
        search = str(request.query_params.get("search") or "").strip()
        if search:
            qs = qs.filter(Q(label_id__icontains=search) | Q(material__name__icontains=search) | Q(material__code__icontains=search) | Q(production_job__job_number__icontains=search))
        scope = str(request.query_params.get("scope") or "job").lower()
        if order.production_job_id and scope == "job":
            qs = qs.filter(Q(production_job_id=order.production_job_id) | Q(created_by_job_id=order.production_job_id))
        reserved = {}
        from apps.inventory.models import InventoryReservation

        for res in InventoryReservation.objects.filter(roll__in=qs[:300], status="ACTIVE").select_related("job"):
            reserved[res.roll_id] = res
        rows = []
        for roll in qs.order_by("-created_at")[:300]:
            res = reserved.get(roll.id)
            other_job = res is not None and res.job_id != order.production_job_id
            rate = roll_rate_per_kg(roll)
            rows.append({
                "id": str(roll.id), "label_id": roll.label_id,
                "material_name": (roll.material.name or roll.material.code) if roll.material_id else None,
                "status": roll.status, "weight_kg": num(roll.weight_kg), "width_mm": num(roll.width_mm),
                "thickness_micron": num(roll.thickness_micron), "location_name": roll.location.name,
                "production_job_number": getattr(roll.production_job, "job_number", None),
                "linked_to_order_job": bool(order.production_job_id) and order.production_job_id in {roll.production_job_id, roll.created_by_job_id},
                "rate_per_kg": num(rate) if rate else None,
                "suggested_value": num((rate * roll.weight_kg).quantize(Decimal("0.01"))) if rate else None,
                "reserved_for_job": res.job.job_number if res is not None else None,
                "blocked_reason": f"Reserved for job {res.job.job_number}" if other_job else None,
            })
        return Response({"results": rows, "scope": scope if order.production_job_id else "plant"})

    @action(detail=True, methods=["get"], url_path="eligible-bulk")
    def eligible_bulk(self, request, pk=None):
        """Bulk stock of the order's plant that can be sent (pooled rows with quantity)."""
        require_jobwork_permission(request.user, "inventory.view")
        from apps.inventory.models import InventoryBulk
        from apps.inventory.services.job_work import bulk_rate

        order = self._order(pk)
        rows = []
        qs = InventoryBulk.objects.select_related("material", "location", "granule_code").filter(
            location__plant=order.plant, qty_kg__gt=0, location__is_active=True,
        ).exclude(location__type__in=["JOBWORK", "TRANSIT", "SCRAP"]).order_by("material__name", "location__name")
        for row in qs[:300]:
            rate = bulk_rate(row.material_id, row.location_id)
            rows.append({
                "material_id": str(row.material_id), "material_name": row.material.name or row.material.code,
                "category": row.material.category, "uom": row.material.base_uom,
                "location_id": str(row.location_id), "location_name": row.location.name,
                "granule_code_id": str(row.granule_code_id) if row.granule_code_id else None,
                "granule_code": getattr(row.granule_code, "code", None),
                "quantity": num(row.qty_kg), "rate": num(rate) if rate else None,
            })
        return Response({"results": rows})

    # ---------------------------------------------------------- actions
    @action(detail=True, methods=["post"], url_path="dispatch")
    def dispatch_order(self, request, pk=None):
        require_jobwork_permission(request.user, "inventory.manage")
        data = self._valid(JobWorkDispatchSerializer, request)
        result = JobWorkService.dispatch(order_id=pk, user=request.user, data=data)
        return self._detail_response(request, pk, result, status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="returns")
    def returns(self, request, pk=None):
        require_jobwork_permission(request.user, "inventory.manage")
        data = self._valid(JobWorkReturnSerializer, request)
        result = JobWorkService.receive_return(order_id=pk, user=request.user, data=data)
        return self._detail_response(request, pk, result, status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="close")
    def close(self, request, pk=None):
        require_jobwork_permission(request.user, "inventory.manage")
        data = self._valid(JobWorkCloseSerializer, request)
        return self._detail_response(request, pk, JobWorkService.close(order_id=pk, user=request.user, data=data))

    @action(detail=True, methods=["post"], url_path="short-close")
    def short_close(self, request, pk=None):
        require_jobwork_permission(request.user, "inventory.manage")
        data = self._valid(JobWorkShortCloseSerializer, request)
        return self._detail_response(request, pk, JobWorkService.short_close(order_id=pk, user=request.user, data=data))

    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel(self, request, pk=None):
        require_jobwork_permission(request.user, "inventory.manage")
        data = self._valid(JobWorkCancelSerializer, request)
        return self._detail_response(request, pk, JobWorkService.cancel(order_id=pk, user=request.user, data=data))

    @action(detail=True, methods=["post"], url_path="release-step")
    def release_step(self, request, pk=None):
        """Continue production with what's back: complete the planned route
        step now; the order stays open for the material still at the vendor."""
        require_jobwork_permission(request.user, "inventory.manage")
        data = self._valid(JobWorkReleaseStepSerializer, request)
        return self._detail_response(request, pk, JobWorkService.release_step(order_id=pk, user=request.user, data=data))

    @action(detail=True, methods=["get"], url_path=rf"challans/(?P<challan_id>{UUID_RE})/pdf")
    def challan_pdf(self, request, pk=None, challan_id=None):
        require_jobwork_permission(request.user, "inventory.view")
        from apps.inventory.services.job_work_pdf import JobWorkChallanPDF

        challan = JobWorkChallan.objects.filter(id=challan_id, order_id=pk).first()
        if challan is None:
            raise NotFound("This challan does not belong to the order.")
        response = HttpResponse(JobWorkChallanPDF.generate(challan), content_type="application/pdf")
        disposition = "attachment" if request.query_params.get("download") in {"1", "true"} else "inline"
        response["Content-Disposition"] = f'{disposition}; filename="{challan.number}.pdf"'
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response

    # ----------------------------------------------------- bill support
    @action(detail=False, methods=["get"], url_path="open-orders")
    def open_orders(self, request):
        """Open orders of one vendor (bill flow: pick the order a bill belongs to)."""
        require_jobwork_permission(request.user, "inventory.view")
        vendor_id = request.query_params.get("vendor")
        qs = annotate_balances(JobWorkOrder.objects.select_related("plant", "vendor", "process", "production_job", "production_job__current_process", "production_job__process"))
        qs = qs.filter(status__in=["SENT", "PARTIAL", "PARTLY_RETURNED", "RETURNED"])
        if vendor_id:
            if not Vendor.objects.filter(id=vendor_id).exists():
                raise ValidationError({"vendor": "This vendor does not exist."})
            qs = qs.filter(vendor_id=vendor_id)
        bill_id = request.query_params.get("bill")
        if bill_id:
            from apps.gate.models import InwardBillIntake

            bill = InwardBillIntake.objects.filter(id=bill_id).first()
            if bill is None:
                raise ValidationError({"bill": "This bill does not exist."})
            qs = qs.filter(Q(plant_id=bill.plant_id) | Q(plant_id=getattr(bill, "ship_to_plant_id", None)))
        elif request.query_params.get("plant"):
            qs = qs.filter(plant_id=request.query_params["plant"])
        rows = [order_row(order) for order in qs.order_by("dispatched_at", "created_at")[:100]]
        return Response({"results": rows, "count": len(rows)})

    @action(detail=False, methods=["get"], url_path="unbilled-returns")
    def unbilled_returns(self, request):
        """Returns of one job worker with no bill yet, any order status (late / monthly bills)."""
        return Response(job_work_bills.unbilled_returns(user=request.user, params=request.query_params))

    @action(detail=False, methods=["post"], url_path="link-bill")
    def link_bill(self, request):
        """Link an open job-work bill to returns received earlier (one transaction)."""
        require_jobwork_permission(request.user, "inventory.manage")
        data = self._valid(JobWorkLateBillSerializer, request)
        result = job_work_bills.link_bill(user=request.user, data=data)
        return Response(result, status=status.HTTP_200_OK if result.get("replayed") else status.HTTP_201_CREATED)

    # ---------------------------------------------------------- reports
    @action(detail=False, methods=["get"], url_path="reports/at-vendor")
    def report_at_vendor(self, request):
        require_jobwork_permission(request.user, "inventory.view")
        return Response(material_at_vendors(plant=request.query_params.get("plant") or None, vendor=request.query_params.get("vendor") or None))

    @action(detail=False, methods=["get"], url_path="reports/yield")
    def report_yield(self, request):
        require_jobwork_permission(request.user, "inventory.view")
        start = request.query_params.get("date_from")
        end = request.query_params.get("date_to")
        date_from = parse_date(start) if start else None
        date_to = parse_date(end) if end else None
        if (start and date_from is None) or (end and date_to is None):
            raise ValidationError({"date_from": "Use dates in YYYY-MM-DD format."})
        return Response(yield_by_vendor(plant=request.query_params.get("plant") or None, vendor=request.query_params.get("vendor") or None, date_from=date_from, date_to=date_to))

    # ------------------------------------------------------------- rates
    @action(detail=False, methods=["get", "post"], url_path="vendor-rates")
    def vendor_rates(self, request):
        if request.method == "GET":
            require_jobwork_permission(request.user, "inventory.view")
            vendor = Vendor.objects.filter(id=request.query_params.get("vendor")).first() if request.query_params.get("vendor") else None
            if vendor is None:
                raise ValidationError({"vendor": "Choose a vendor."})
            return Response({"vendor_id": str(vendor.id), "vendor_name": vendor.name, "jobwork_rates": vendor.jobwork_rates or []})
        require_jobwork_permission(request.user, "inventory.manage")
        data = self._valid(JobWorkVendorRateSerializer, request)
        result = JobWorkService.save_vendor_rate(user=request.user, data=data)
        return Response(result, status=status.HTTP_200_OK if result.get("replayed") else status.HTTP_201_CREATED)

    # ------------------------------------------------------------ legacy
    @action(detail=False, methods=["get"], url_path="legacy")
    def legacy(self, request):
        require_owner(request.user)
        return Response(legacy_report(plant=request.query_params.get("plant") or None))

    @action(detail=False, methods=["post"], url_path="legacy/reconcile")
    def legacy_reconcile(self, request):
        require_owner(request.user)
        data = self._valid(JobWorkLegacyReconcileSerializer, request)
        result = JobWorkService.reconcile_legacy(user=request.user, data=data)
        code = status.HTTP_200_OK if result.get("replayed") else status.HTTP_201_CREATED
        if result.get("order_id"):
            return Response({**result, "order": order_detail(self._order(result["order_id"]), request.user)}, status=code)
        return Response(result, status=code)
