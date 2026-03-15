from django.http import HttpResponse
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Quotation
from .serializers_quotations import QuotationSerializer
from .services.quotation_pdf import QuotationPDFService
from .services.quotation_service import QuotationService


class QuotationViewSet(viewsets.ModelViewSet):
    queryset = (
        Quotation.objects.select_related("customer", "plant", "plant__legal_profile", "converted_sales_order")
        .prefetch_related("items", "items__template")
        .order_by("-updated_at", "-created_at")
    )
    serializer_class = QuotationSerializer

    def create(self, request, *args, **kwargs):
        try:
            quotation = QuotationService.create_quotation(request.data)
            return Response(self.get_serializer(quotation).data, status=status.HTTP_201_CREATED)
        except Exception as exc:
            return Response({"detail": self._error_detail(exc)}, status=self._error_status(exc))

    def update(self, request, *args, **kwargs):
        quotation = self.get_object()
        try:
            quotation = QuotationService.update_quotation(quotation, request.data)
            return Response(self.get_serializer(quotation).data)
        except Exception as exc:
            return Response({"detail": self._error_detail(exc)}, status=self._error_status(exc))

    def partial_update(self, request, *args, **kwargs):
        return self.update(request, *args, **kwargs)

    @action(detail=False, methods=["post"], url_path="preview-line")
    def preview_line(self, request):
        try:
            preview = QuotationService.preview_line(request.data)
            return Response(preview)
        except Exception as exc:
            return Response({"detail": self._error_detail(exc)}, status=self._error_status(exc))

    @action(detail=True, methods=["get"], url_path="pdf")
    def pdf(self, request, pk=None):
        quotation = self.get_object()
        try:
            pdf_bytes = QuotationPDFService.render_pdf_bytes(quotation)
            response = HttpResponse(pdf_bytes, content_type="application/pdf")
            response["Content-Disposition"] = f'inline; filename="{quotation.quote_number}.pdf"'
            return response
        except Exception as exc:
            return Response({"detail": self._error_detail(exc)}, status=self._error_status(exc))

    @action(detail=True, methods=["post"], url_path="duplicate")
    def duplicate(self, request, pk=None):
        quotation = self.get_object()
        try:
            duplicate = QuotationService.duplicate_quotation(quotation)
            return Response(self.get_serializer(duplicate).data, status=status.HTTP_201_CREATED)
        except Exception as exc:
            return Response({"detail": self._error_detail(exc)}, status=self._error_status(exc))

    @action(detail=True, methods=["post"], url_path="convert-to-order")
    def convert_to_order(self, request, pk=None):
        quotation = self.get_object()
        try:
            order = QuotationService.convert_to_sales_order(quotation)
            return Response(
                {
                    "sales_order_id": str(order.id),
                    "sales_order_number": order.order_number,
                    "quotation_id": str(quotation.id),
                    "quotation_number": quotation.quote_number,
                }
            )
        except Exception as exc:
            return Response({"detail": self._error_detail(exc)}, status=self._error_status(exc))

    @staticmethod
    def _error_detail(exc):
        if hasattr(exc, "message_dict"):
            return exc.message_dict
        if hasattr(exc, "messages"):
            msgs = getattr(exc, "messages")
            if len(msgs) == 1:
                return msgs[0]
            return msgs
        return str(exc)

    @staticmethod
    def _error_status(exc):
        if exc.__class__.__name__ == "ValidationError":
            return status.HTTP_400_BAD_REQUEST
        return status.HTTP_500_INTERNAL_SERVER_ERROR
