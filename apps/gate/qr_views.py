"""Signed document QR endpoints.

GET qr/resolve?code=&plant=  watchman (assigned gate) or outward reconciler:
    {kind, kind_label, id, reference, party_name, summary, status, warnings}
    — enough for the "Recognised: DC-2627-0412 · 3 units" chip; never prices.
GET qr/token?kind=&id=       inventory / logistics viewers: {kind, id, token, svg}
    for HTML print pages that need the same signed QR as the PDFs.
GET qr/label.pdf?kind=&id=[&copies=1..5]  same users: 101.6 x 50.8 mm QR gate
    sticker(s) to stick on the Tally bill or the dispatch slip (apps.gate.qr_labels).
    400 bad kind/id/copies, 404 missing record, 409 cancelled / not printable.
"""
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.users.permission_service import PermissionService

from .outward_services import KIND_LABELS, is_reconciler, resolve_link
from .qr import QR_KINDS, make_token, parse_token, qr_svg
from .qr_labels import build_label, parse_label_request, render_qr_labels
from .services import get_plant, is_owner, is_watchman
from .views import FileNegotiation, GateView, private_response, uuid_param

TOKEN_VIEW_PERMISSIONS = {"inventory.view", "inventory.manage", "logistics.view", "logistics.manage"}


class QRDocumentView(GateView):
    permission_classes = [IsAuthenticated]


class QRResolveView(QRDocumentView):
    def get(self, request):
        user = request.user
        watchman = is_watchman(user)
        if not (watchman or is_reconciler(user)):
            raise PermissionDenied("Scanning ERP document codes is for gate staff and the outward matching team.")
        plant_id = uuid_param(request, "plant", required=True)
        if watchman:
            plant = get_plant(user, plant_id)
        else:
            plant = PermissionService.document_plants(user).filter(id=plant_id).first()
            if plant is None:
                raise PermissionDenied("This factory is unavailable.")
        code = str(request.query_params.get("code") or "").strip()
        if not code or len(code) > 512:
            raise ValidationError({"code": "Scan or paste an ERP document code."})
        kind, object_id = parse_token(code)
        snapshot = resolve_link(kind, object_id, plant)
        data = {
            "kind": kind,
            "kind_label": KIND_LABELS.get(kind, kind),
            "id": str(object_id),
            "reference": snapshot.get("reference", ""),
            "party_name": snapshot.get("party_name", ""),
            "summary": snapshot.get("summary", ""),
            "status": snapshot.get("status", ""),
            "warnings": snapshot.get("warnings", []),
        }
        if not watchman:
            data["snapshot"] = snapshot
        return Response(data)


def can_mint_tokens(user):
    if is_watchman(user):
        return False
    if is_owner(user) or PermissionService.has_document_permission(user, "documents.view"):
        return True
    return bool(TOKEN_VIEW_PERMISSIONS & set(PermissionService.get_user_permissions(user)))


class QRTokenView(QRDocumentView):
    def get(self, request):
        if not can_mint_tokens(request.user):
            raise PermissionDenied("Document QR codes are for inventory and logistics users.")
        kind = str(request.query_params.get("kind") or "").strip().upper()
        if kind not in QR_KINDS:
            raise ValidationError({"kind": "Choose a printable ERP document type."})
        object_id = uuid_param(request, "id", required=True)
        token = make_token(kind, object_id)
        svg = qr_svg(token)
        if svg.startswith("<?xml"):
            svg = svg.split("?>", 1)[1].strip()
        return Response({"kind": kind, "id": str(object_id), "token": token, "svg": svg})


class QRLabelView(QRDocumentView):
    """Printable QR gate sticker(s) for one ERP outward document (one page per copy)."""

    content_negotiation_class = FileNegotiation

    def get(self, request):
        if not can_mint_tokens(request.user):
            raise PermissionDenied("Gate QR stickers are for inventory and logistics users.")
        kind, object_id, copies = parse_label_request(request.query_params)
        label = build_label(kind, object_id)
        response = private_response(render_qr_labels(label, copies=copies), "application/pdf")
        response["Content-Disposition"] = f'inline; filename="{label.filename}"'
        return response
