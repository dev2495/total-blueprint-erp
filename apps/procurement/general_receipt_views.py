"""/api/procurement/general-receipts/ — record and read non-stock receipts."""
from rest_framework.exceptions import NotFound
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.gate.bill_services import reader_plants
from apps.gate.views import GatePagination, GateView, period, uuid_param, validated

from .general_receipt_serializers import GeneralReceiptCreateSerializer, GeneralReceiptReverseSerializer
from .general_receipt_services import (
    create_general_receipt, description_suggestions, filter_receipts, get_receipt, machine_history, page_payloads, plant_for_options,
    receipt_options, receipt_payload, receipt_queryset, require_view, reverse_general_receipt,
)


class GeneralReceiptView(GateView):
    """Explicit document-right checks in every handler (Inventory by default)."""
    permission_classes = [IsAuthenticated]


class GeneralReceiptsView(GeneralReceiptView):
    def get(self, request):
        require_view(request.user)
        source = receipt_queryset().filter(plant__in=reader_plants(request.user))
        source = filter_receipts(source, request.query_params, lambda: period(request))
        paginator = GatePagination()
        page = paginator.paginate_queryset(source, request)
        return paginator.get_paginated_response(page_payloads(page, request.user))

    def post(self, request):
        payload, created = create_general_receipt(request.user, validated(GeneralReceiptCreateSerializer, request.data))
        return Response(payload, status=201 if created else 200)


class GeneralReceiptDetailView(GeneralReceiptView):
    def get(self, request, pk):
        return Response(receipt_payload(get_receipt(request.user, pk), request.user))


class GeneralReceiptReverseView(GeneralReceiptView):
    def post(self, request, pk):
        return Response(reverse_general_receipt(request.user, pk, validated(GeneralReceiptReverseSerializer, request.data)))


class MachineHistoryView(GeneralReceiptView):
    def get(self, request):
        machine = uuid_param(request, "machine")
        if not machine:
            require_view(request.user)
            raise NotFound("Choose a machine.")
        return Response(machine_history(request.user, machine))


class SuggestionsView(GeneralReceiptView):
    def get(self, request):
        rows = description_suggestions(request.user, request.query_params.get("q", "").strip()[:100], uuid_param(request, "vendor"))
        return Response({"results": rows})


class OptionsView(GeneralReceiptView):
    def get(self, request):
        require_view(request.user)
        ids = plant_for_options(request.user, request.query_params.getlist("plant"))
        return Response(receipt_options(request.user, ids))
