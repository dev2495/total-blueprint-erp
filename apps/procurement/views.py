from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import HttpResponse
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.inventory.models import InventoryLocation, Vendor
from apps.procurement.models import (
    PurchaseOrder,
    PurchaseOrderReceipt,
    TradingGoodReceipt,
)
from apps.procurement.serializers import (
    PurchaseOrderListSerializer,
    PurchaseOrderReceiptCreateSerializer,
    PurchaseOrderReceiptSerializer,
    PurchaseOrderSerializer,
    TradingGoodReceiptCreateSerializer,
    TradingGoodReceiptSerializer,
)
from apps.procurement.services.po_pdf import PurchaseOrderPDFService
from apps.procurement.services.po_receipt import PurchaseOrderReceiptService
from apps.procurement.services.purchase_order import PurchaseOrderService
from apps.procurement.services.trading_good_receipt import TradingGoodReceiptService
from apps.procurement.services.vendor_performance import VendorPerformanceService


class PurchaseOrderViewSet(viewsets.ModelViewSet):
    queryset = PurchaseOrder.objects.all().select_related("vendor", "plant").prefetch_related("items", "items__material")

    def get_serializer_class(self):
        if self.action == "list":
            return PurchaseOrderListSerializer
        return PurchaseOrderSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        status_filter = params.get("status")
        status_in_filter = params.get("status__in") or params.get("statuses")
        vendor_filter = params.get("vendor")
        search = params.get("search")
        if status_in_filter:
            statuses = [s.strip().upper() for s in str(status_in_filter).split(",") if s.strip()]
            qs = qs.filter(status__in=statuses)
        elif status_filter:
            qs = qs.filter(status=status_filter)
        if vendor_filter:
            qs = qs.filter(vendor_id=vendor_filter)
        if search:
            qs = qs.filter(code__icontains=search)
        return qs

    @action(detail=True, methods=["post"])
    def send(self, request, pk=None):
        po = self.get_object()
        channel = request.data.get("channel", "pdf_only")
        try:
            PurchaseOrderService.send(po, request.user, channel=channel)
        except DjangoValidationError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        po.refresh_from_db()
        return Response(PurchaseOrderSerializer(po, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def acknowledge(self, request, pk=None):
        po = self.get_object()
        ack_ref = request.data.get("ack_ref", "")
        ack_date = request.data.get("ack_date") or None
        try:
            PurchaseOrderService.acknowledge(po, request.user, ack_ref, ack_date)
        except DjangoValidationError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        po.refresh_from_db()
        return Response(PurchaseOrderSerializer(po, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        po = self.get_object()
        reason = request.data.get("reason", "")
        try:
            PurchaseOrderService.cancel(po, request.user, reason)
        except DjangoValidationError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        po.refresh_from_db()
        return Response(PurchaseOrderSerializer(po, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="close_short")
    def close_short(self, request, pk=None):
        po = self.get_object()
        line_id = request.data.get("line_id") or None
        reason = request.data.get("reason", "")
        try:
            PurchaseOrderService.close_short(po, request.user, line_id, reason)
        except DjangoValidationError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        po.refresh_from_db()
        return Response(PurchaseOrderSerializer(po, context={"request": request}).data)

    @action(detail=True, methods=["get"])
    def pdf(self, request, pk=None):
        po = self.get_object()
        try:
            data = PurchaseOrderPDFService.render_pdf_bytes(po)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        resp = HttpResponse(data, content_type="application/pdf")
        resp["Content-Disposition"] = f'inline; filename="{po.code}.pdf"'
        return resp

    @action(detail=False, methods=["post"], url_path="from_mrp")
    def from_mrp(self, request):
        from apps.mrp.models import MRPSuggestion
        from apps.mrp.services import MRPService

        suggestion_id = request.data.get("suggestion_id")
        if not suggestion_id:
            return Response({"error": "suggestion_id is required."}, status=400)
        try:
            sug = MRPSuggestion.objects.get(pk=suggestion_id)
        except MRPSuggestion.DoesNotExist:
            return Response({"error": "Suggestion not found."}, status=404)
        try:
            payload = MRPService.create_suggestion_draft(sug, "po", user=request.user)
        except Exception as e:
            return Response({"error": str(e)}, status=400)
        po_id = payload.get("po_id")
        if po_id:
            try:
                po = PurchaseOrder.objects.get(pk=po_id)
                data = PurchaseOrderSerializer(po, context={"request": request}).data
                data.update(payload)
                return Response(data, status=status.HTTP_201_CREATED)
            except PurchaseOrder.DoesNotExist:
                pass
        return Response(payload, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"], url_path="vendor_performance")
    def vendor_performance(self, request):
        vendor_id = request.query_params.get("vendor")
        if not vendor_id:
            return Response({"error": "vendor query param is required."}, status=400)
        try:
            vendor = Vendor.objects.get(pk=vendor_id)
        except Vendor.DoesNotExist:
            return Response({"error": "Vendor not found."}, status=404)
        return Response(VendorPerformanceService.compute(vendor))


class PurchaseOrderReceiptViewSet(viewsets.ModelViewSet):
    queryset = PurchaseOrderReceipt.objects.all().select_related(
        "purchase_order", "plant"
    ).prefetch_related("lines")
    serializer_class = PurchaseOrderReceiptSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        po = self.request.query_params.get("purchase_order")
        if po:
            qs = qs.filter(purchase_order_id=po)
        return qs

    def create(self, request, *args, **kwargs):
        ser = PurchaseOrderReceiptCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        try:
            po = PurchaseOrder.objects.get(pk=data["purchase_order"])
        except PurchaseOrder.DoesNotExist:
            return Response({"error": "Purchase order not found"}, status=404)

        location = None
        if data.get("location_id"):
            try:
                location = InventoryLocation.objects.get(pk=data["location_id"])
            except InventoryLocation.DoesNotExist:
                return Response({"error": "Receiving location not found"}, status=404)
            if str(location.plant_id) != str(po.plant_id):
                return Response({"error": "Receiving location must belong to the PO plant."}, status=400)

        # ── Idempotency layer ─────────────────────────────────────────────
        # Accept either an Idempotency-Key header or a body-level client_token.
        client_token = (
            request.headers.get("Idempotency-Key")
            or request.data.get("client_token")
            or ""
        )
        client_token = str(client_token or "").strip()[:64]
        if client_token:
            existing = PurchaseOrderReceipt.objects.filter(
                purchase_order=po, client_token=client_token
            ).first()
            if existing:
                return Response(
                    PurchaseOrderReceiptSerializer(existing).data,
                    status=status.HTTP_200_OK,
                )

        try:
            receipt = PurchaseOrderReceiptService.create(
                po=po,
                user=request.user,
                lines_data=[dict(ld) for ld in data["lines"]],
                vendor_invoice_no=data.get("vendor_invoice_no", ""),
                vendor_invoice_date=data.get("vendor_invoice_date"),
                vehicle_no=data.get("vehicle_no", ""),
                driver_name=data.get("driver_name", ""),
                lr_no=data.get("lr_no", ""),
                notes=data.get("notes", ""),
                quality_status=data.get("quality_status", "PENDING"),
                location=location,
            )
        except DjangoValidationError as e:
            return Response({"error": str(e)}, status=400)

        # Stamp the token after the service created the row.
        if client_token and not receipt.client_token:
            receipt.client_token = client_token
            receipt.save(update_fields=["client_token"])

        return Response(
            PurchaseOrderReceiptSerializer(receipt).data,
            status=status.HTTP_201_CREATED,
        )


class TradingGoodReceiptViewSet(viewsets.ModelViewSet):
    """List/Create/Retrieve trading-good direct receipts."""

    queryset = TradingGoodReceipt.objects.all().select_related(
        "trading_good", "vendor", "plant"
    )
    serializer_class = TradingGoodReceiptSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if params.get("vendor"):
            qs = qs.filter(vendor_id=params["vendor"])
        if params.get("plant"):
            qs = qs.filter(plant_id=params["plant"])
        if params.get("trading_good"):
            qs = qs.filter(trading_good_id=params["trading_good"])
        if params.get("search"):
            qs = qs.filter(code__icontains=params["search"])
        return qs

    def create(self, request, *args, **kwargs):
        ser = TradingGoodReceiptCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data

        from apps.factory.models import Plant
        from apps.materials.models import TradingGood

        try:
            trading_good = TradingGood.objects.get(pk=data["trading_good"])
        except TradingGood.DoesNotExist:
            return Response({"error": "Trading good not found"}, status=404)
        try:
            vendor = Vendor.objects.get(pk=data["vendor"])
        except Vendor.DoesNotExist:
            return Response({"error": "Vendor not found"}, status=404)
        try:
            plant = Plant.objects.get(pk=data["plant"])
        except Plant.DoesNotExist:
            return Response({"error": "Plant not found"}, status=404)

        try:
            receipt = TradingGoodReceiptService.create(
                trading_good=trading_good,
                vendor=vendor,
                plant=plant,
                qty=data["qty"],
                rate=data["rate"],
                vendor_invoice_no=data.get("vendor_invoice_no", ""),
                vendor_invoice_date=data.get("vendor_invoice_date"),
                vehicle_no=data.get("vehicle_no", ""),
                driver_name=data.get("driver_name", ""),
                lr_no=data.get("lr_no", ""),
                notes=data.get("notes", ""),
                user=request.user,
            )
        except DjangoValidationError as e:
            return Response({"error": str(e)}, status=400)

        return Response(
            TradingGoodReceiptSerializer(receipt).data,
            status=status.HTTP_201_CREATED,
        )
