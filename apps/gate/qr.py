"""Signed QR references printed on ERP outward documents.

Token format: ``TPP1.<KIND>.<uuid>.<sig>`` where ``sig`` is the first 16 hex
characters of HMAC-SHA256(SECRET_KEY, "<KIND>:<uuid>"). The token carries no
business data; scanning only identifies which ERP record a paper belongs to.
The server re-checks plant scope and permissions when resolving it.

Modules that print outward papers register a resolver for their kind::

    register_qr_kind("JOBWORK_CHALLAN", resolve=fn, on_gate_out=fn)

``resolve(object_id, plant)`` returns a snapshot dict (see OutwardLinkSnapshot
in docs/documents-jobwork/SPEC.md) or raises ValidationError when the record
does not exist / belongs to another plant / is not in a dispatchable state.
``on_gate_out(object_id, departed_at, user)`` (optional) stamps the physical
exit time on the source record. It must never move stock.
"""
import hashlib
import hmac
import re
import uuid

from django.conf import settings
from rest_framework.exceptions import ValidationError

QR_PREFIX = "TPP1"
QR_KINDS = {"SALES_DC", "CUSTOMER_DISPATCH", "TRADE_ORDER", "INTERPLANT_DC", "JOBWORK_CHALLAN", "GATE_PASS"}
_TOKEN = re.compile(r"^TPP1\.([A-Z_]{3,24})\.([0-9a-fA-F-]{36})\.([0-9a-f]{16})$")
QR_HANDLERS = {}


def _signature(kind, object_id):
    message = f"{kind}:{str(object_id).lower()}".encode()
    return hmac.new(settings.SECRET_KEY.encode(), message, hashlib.sha256).hexdigest()[:16]


def make_token(kind, object_id):
    if kind not in QR_KINDS:
        raise ValueError(f"Unknown QR kind {kind}")
    object_id = str(uuid.UUID(str(object_id)))
    return f"{QR_PREFIX}.{kind}.{object_id}.{_signature(kind, object_id)}"


def parse_token(raw):
    """Return (kind, uuid) for a valid signed token, else raise ValidationError."""
    value = str(raw or "").strip()
    match = _TOKEN.match(value)
    if not match:
        raise ValidationError({"code": "This QR code is not an ERP document code."})
    kind, object_id, signature = match.groups()
    if kind not in QR_KINDS:
        raise ValidationError({"code": "This QR code is not an ERP document code."})
    object_id = str(uuid.UUID(object_id))
    if not hmac.compare_digest(signature, _signature(kind, object_id)):
        raise ValidationError({"code": "This QR code could not be verified."})
    return kind, uuid.UUID(object_id)


def register_qr_kind(kind, resolve, on_gate_out=None):
    if kind not in QR_KINDS:
        raise ValueError(f"Unknown QR kind {kind}")
    QR_HANDLERS[kind] = {"resolve": resolve, "on_gate_out": on_gate_out}


def qr_svg(token, *, box_size=4):
    """Small SVG for HTML print pages."""
    import io

    import qrcode
    import qrcode.image.svg

    image = qrcode.make(token, image_factory=qrcode.image.svg.SvgPathImage, box_size=box_size, border=1)
    output = io.BytesIO()
    image.save(output)
    return output.getvalue().decode()


def qr_png_bytes(token, *, box_size=6):
    """PNG bytes for reportlab PDFs (``ImageReader(io.BytesIO(...))``)."""
    import io

    import qrcode

    image = qrcode.make(token, box_size=box_size, border=1)
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()
