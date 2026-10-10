"""Gate pass (RGP / NRGP) API. View = documents.view; changes = gatepass.manage.

Every view re-checks the document right of the real account (the RBAC route
map is only a first gate); Watchman is refused by middleware and here.
"""
from django.http import HttpResponse
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from . import outward_services  # noqa: F401  (registers outward QR kinds / notifications)
from .gate_pass_pdf import render_gate_pass_pdf
from .gate_pass_serializers import GatePassInputSerializer, GatePassIssueSerializer, GatePassReasonSerializer, GatePassReceiveSerializer, GatePassUpdateSerializer
from .gate_pass_services import (
    cancel_gate_pass, create_gate_pass, filter_gate_passes, form_options, gate_pass_payload, gate_pass_queryset, get_gate_pass,
    issue_gate_pass, open_lines, receive_back, require_view, short_close_gate_pass, update_gate_pass,
)
from .views import FileNegotiation, GateView, paginated, uuid_param, validated


class GatePassView(GateView):
    permission_classes = [IsAuthenticated]


class GatePassListView(GatePassView):
    def get(self, request):
        source, counts = filter_gate_passes(gate_pass_queryset(request.user), request.query_params)
        response = paginated(source, request, lambda obj: gate_pass_payload(obj, request.user))
        response.data["counts"] = counts
        return response

    def post(self, request):
        return Response(create_gate_pass(request.user, validated(GatePassInputSerializer, request.data)), status=201)


class GatePassDetailView(GatePassView):
    def get(self, request, pk):
        return Response(gate_pass_payload(get_gate_pass(request.user, pk), request.user, detail=True))

    def patch(self, request, pk):
        gate_pass = get_gate_pass(request.user, pk)
        return Response(update_gate_pass(request.user, gate_pass, validated(GatePassUpdateSerializer, request.data)))


class GatePassActionView(GatePassView):
    ACTIONS = {
        "issue": (GatePassIssueSerializer, issue_gate_pass),
        "cancel": (GatePassReasonSerializer, cancel_gate_pass),
        "short-close": (GatePassReasonSerializer, short_close_gate_pass),
        "receive-back": (GatePassReceiveSerializer, receive_back),
    }

    def post(self, request, pk, action):
        serializer, handler = self.ACTIONS[action]
        gate_pass = get_gate_pass(request.user, pk)
        return Response(handler(request.user, gate_pass, validated(serializer, request.data)))


class GatePassPrintView(GatePassView):
    content_negotiation_class = FileNegotiation

    def get(self, request, pk):
        gate_pass = get_gate_pass(request.user, pk)
        data = render_gate_pass_pdf(gate_pass)
        response = HttpResponse(data, content_type="application/pdf")
        name = (gate_pass.number if gate_pass.status != "DRAFT" else f"gate-pass-draft-{str(gate_pass.id)[:8]}").replace("/", "-")
        response["Content-Disposition"] = f'inline; filename="{name}.pdf"'
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response


class GatePassOpenLinesView(GatePassView):
    """General Receipt RGP return picker (workstream B)."""

    def get(self, request):
        require_view(request.user)
        return Response(open_lines(request.user, vendor=uuid_param(request, "vendor"), party=request.query_params.get("party", ""), plant=uuid_param(request, "plant")))


class GatePassFormOptionsView(GatePassView):
    def get(self, request):
        return Response(form_options(request.user, plant=uuid_param(request, "plant"), query=request.query_params.get("q", "")))
