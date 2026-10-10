"""QR gate stickers for ERP outward documents (roll-label printer, 4 x 2 inch).

The customer tax invoice is printed from Tally and the Epson tractor dispatch
slip keeps its fixed 96-column layout, so the office prints one small sticker
per dispatch and sticks it on the Tally bill or the dispatch slip. The
watchman scans it at the gate; the QR is the same signed token the ERP PDFs
carry (``apps.gate.qr.make_token``), so the departure links itself.

All text comes from the registered QR resolver snapshot (see
``apps.gate.outward_registry``), which never carries prices or amounts. A
record the resolver refuses (cancelled, draft gate pass, no factory) gets no
sticker (409); resolver warnings (e.g. a draft challan) print on the sticker.
"""
import re
import uuid
from dataclasses import dataclass
from datetime import datetime
from io import BytesIO

from rest_framework.exceptions import NotFound, ValidationError

from .outward_services import resolve_link
from .qr import QR_KINDS, make_token, qr_png_bytes
from .services import Conflict, gate_zone

try:
    from reportlab.lib.units import mm
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas
except Exception:  # pragma: no cover - explicit runtime failure below
    canvas = None

# Same stock as the roll identity labels (apps.inventory.services.roll_labels).
LABEL_WIDTH_MM = 101.6
LABEL_HEIGHT_MM = 50.8
MAX_COPIES = 5
HEADING = "GATE PASS QR — scan at gate"
DRAFT_WARNING = "DRAFT – not dispatched"

KIND_TITLES = {
    "SALES_DC": "Sales delivery challan",
    "CUSTOMER_DISPATCH": "Customer dispatch",
    "TRADE_ORDER": "Trade order",
    "INTERPLANT_DC": "Inter-plant challan",
    "JOBWORK_CHALLAN": "Job-work challan",
    "GATE_PASS": "Gate pass",
}


@dataclass(frozen=True)
class _Source:
    plant: object
    reference: str
    title: str
    invoice_no: str = ""
    draft: bool = False


@dataclass(frozen=True)
class GateQrLabel:
    kind: str
    object_id: str
    token: str
    title: str
    reference: str
    party_name: str
    invoice_no: str
    date_text: str
    summary: str
    plant_name: str
    warning: str

    @property
    def filename(self):
        slug = re.sub(r"[^A-Za-z0-9._-]+", "-", self.reference).strip("-.")[:60]
        return f"gate-qr-{slug or self.kind.lower()}.pdf"


# ------------------------------------------------------------------ sources
def _sales_dc(object_id):
    from apps.production.models import DeliveryChallan

    challan = DeliveryChallan.objects.select_related("plant").filter(id=object_id).first()
    if challan:
        return _Source(challan.plant, challan.dc_no, KIND_TITLES["SALES_DC"], draft=challan.status == "DRAFT")
    return None


def _customer_dispatch(object_id):
    from apps.sales.models import CustomerDispatch

    dispatch = CustomerDispatch.objects.select_related("plant").filter(id=object_id).first()
    if dispatch:
        return _Source(dispatch.plant, dispatch.code, KIND_TITLES["CUSTOMER_DISPATCH"], dispatch.invoice_no or "", dispatch.status == "DRAFT")
    return None


def _trade_order(object_id):
    from apps.sales.models import TradeOrder

    order = TradeOrder.objects.select_related("plant").filter(id=object_id).first()
    if order:
        return _Source(order.plant, order.code, KIND_TITLES["TRADE_ORDER"], order.invoice_no or "", order.status == "DRAFT")
    return None


def _interplant_dc(object_id):
    from apps.inventory.models import DeliveryChallan

    challan = DeliveryChallan.objects.select_related("from_plant").filter(id=object_id).first()
    if challan:
        reference = challan.dc_no or f"IP-{str(challan.id)[:8].upper()}"
        return _Source(challan.from_plant, reference, KIND_TITLES["INTERPLANT_DC"], draft=challan.status == "DRAFT")
    return None


def _jobwork_challan(object_id):
    from apps.inventory.models import JobWorkChallan

    try:  # registers the JOBWORK_CHALLAN resolver (import-time hook)
        import apps.inventory.services.job_work_integrations  # noqa: F401
    except ImportError:  # pragma: no cover - job work not installed
        pass
    challan = JobWorkChallan.objects.select_related("plant").filter(id=object_id).first()
    if challan:
        return _Source(challan.plant, challan.number, KIND_TITLES["JOBWORK_CHALLAN"])
    return None


def _gate_pass(object_id):
    from .gate_pass_services import KIND_SHORT, display_number
    from .models import GatePass

    gate_pass = GatePass.objects.select_related("plant").filter(id=object_id).first()
    if gate_pass:
        return _Source(gate_pass.plant, display_number(gate_pass), f"Gate pass ({KIND_SHORT.get(gate_pass.kind, 'RGP')})")
    return None


SOURCES = {
    "SALES_DC": _sales_dc,
    "CUSTOMER_DISPATCH": _customer_dispatch,
    "TRADE_ORDER": _trade_order,
    "INTERPLANT_DC": _interplant_dc,
    "JOBWORK_CHALLAN": _jobwork_challan,
    "GATE_PASS": _gate_pass,
}


# ------------------------------------------------------------------ request
def parse_label_request(params):
    """(kind, uuid, copies) from ``?kind=&id=&copies=``; 400 on bad input."""
    kind = str(params.get("kind") or "").strip().upper()
    if kind not in QR_KINDS or kind not in SOURCES:
        raise ValidationError({"kind": "Choose a printable ERP document type."})
    raw_id = str(params.get("id") or "").strip()
    if not raw_id:
        raise ValidationError({"id": "Choose the ERP document to print a gate sticker for."})
    try:
        object_id = uuid.UUID(raw_id)
    except (ValueError, TypeError):
        raise ValidationError({"id": "Use a valid ERP document reference."}) from None
    raw_copies = str(params.get("copies") or "1").strip()
    if not re.fullmatch(r"[0-9]{1,2}", raw_copies) or not 1 <= int(raw_copies) <= MAX_COPIES:
        raise ValidationError({"copies": f"Print between 1 and {MAX_COPIES} stickers at a time."})
    return kind, object_id, int(raw_copies)


def _error_text(error):
    detail = getattr(error, "detail", error)
    if isinstance(detail, dict):
        detail = next(iter(detail.values()), "")
    if isinstance(detail, list):
        detail = detail[0] if detail else ""
    return str(detail)[:300]


def _factory_date(value):
    """Snapshot ISO date/datetime as factory (GATE_TIME_ZONE) wall time."""
    text = str(value or "").strip()
    if not text:
        return ""
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return text[:24]
    if len(text) <= 10:
        return parsed.strftime("%d %b %Y")
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(gate_zone())
    return parsed.strftime("%d %b %Y, %I:%M %p")


def build_label(kind, object_id):
    """Resolve one ERP record into sticker text. 404 missing, 409 not printable."""
    source = SOURCES[kind](object_id)
    if source is None:
        raise NotFound(f"This {KIND_TITLES[kind].lower()} is not in the ERP.")
    if source.plant is None:
        raise Conflict(f"{source.title} {source.reference} has no factory recorded. Set its factory before printing the gate sticker.")
    try:
        snapshot = resolve_link(kind, object_id, source.plant)
    except ValidationError as error:
        raise Conflict(_error_text(error) or "This document cannot leave the gate, so no gate sticker can be printed.") from None
    warnings = [str(text) for text in snapshot.get("warnings") or [] if text]
    if source.draft:
        warning = DRAFT_WARNING
    else:
        warning = warnings[0] if warnings else ""
    return GateQrLabel(
        kind=kind,
        object_id=str(object_id),
        token=make_token(kind, object_id),
        title=source.title,
        reference=source.reference or snapshot.get("reference", ""),
        party_name=str(snapshot.get("party_name") or ""),
        invoice_no=source.invoice_no,
        date_text=_factory_date(snapshot.get("document_date")),
        summary=str(snapshot.get("summary") or ""),
        plant_name=str(snapshot.get("plant_name") or ""),
        warning=warning,
    )


# ------------------------------------------------------------------- render
def _pdf_text(value):
    # Standard PDF fonts are WinAnsi (cp1252); other scripts print as "?".
    return " ".join(str(value or "").split()).encode("cp1252", "replace").decode("cp1252")


def _fit(pdf, text, font, size, width, min_size=5.5):
    text = _pdf_text(text)
    while pdf.stringWidth(text, font, size) > width and size > min_size:
        size -= 0.25
    if pdf.stringWidth(text, font, size) > width:
        while text and pdf.stringWidth(text + "...", font, size) > width:
            text = text[:-1]
        text = text.rstrip() + "..."
    return text, size


def _wrap(pdf, text, font, size, width, max_lines):
    words = _pdf_text(text).split()
    lines, current = [], ""
    for word in words:
        trial = f"{current} {word}".strip()
        if pdf.stringWidth(trial, font, size) <= width or not current:
            current = trial
            continue
        lines.append(current)
        current = word
    if current:
        lines.append(current)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = lines[-1] + " ..."
    return [_fit(pdf, line, font, size, width, min_size=size)[0] for line in lines]


def _draw_label(pdf, label, copy_no, copies):
    width, height = LABEL_WIDTH_MM * mm, LABEL_HEIGHT_MM * mm
    margin = 2.5 * mm
    side = height - 2 * margin
    pdf.drawImage(ImageReader(BytesIO(qr_png_bytes(label.token, box_size=8))), margin, margin, side, side)
    x = margin + side + 2.5 * mm
    column = width - x - margin
    y = height - margin - 3 * mm

    text, size = _fit(pdf, HEADING, "Helvetica-Bold", 8.5, column)
    pdf.setFont("Helvetica-Bold", size)
    pdf.drawString(x, y, text)
    y -= 1.6 * mm
    pdf.setLineWidth(0.6)
    pdf.line(x, y, x + column, y)

    y -= 3.4 * mm
    text, size = _fit(pdf, label.title, "Helvetica", 7.5, column)
    pdf.setFont("Helvetica", size)
    pdf.drawString(x, y, text)
    y -= 5 * mm
    text, size = _fit(pdf, label.reference, "Helvetica-Bold", 13, column, min_size=8)
    pdf.setFont("Helvetica-Bold", size)
    pdf.drawString(x, y, text)

    rows = []
    for line in _wrap(pdf, label.party_name or "-", "Helvetica-Bold", 8, column, 2):
        rows.append((line, "Helvetica-Bold", 8))
    if label.invoice_no:
        rows.append((f"Invoice: {label.invoice_no}", "Helvetica-Bold", 8))
    if label.date_text:
        rows.append((f"Date: {label.date_text}", "Helvetica", 7.5))
    for line in _wrap(pdf, label.summary, "Helvetica", 7.5, column, 2):
        rows.append((line, "Helvetica", 7.5))
    if label.plant_name:
        rows.append((f"Plant: {label.plant_name}", "Helvetica", 7.5))
    warning_lines = _wrap(pdf, label.warning, "Helvetica-Bold", 7, column - 2 * mm, 2) if label.warning else []
    box = len(warning_lines) * 3.2 * mm + 1.2 * mm if warning_lines else 0
    floor = margin + box + 0.8 * mm
    y -= 1.2 * mm
    for text, font, size in rows:
        step = size * 1.25  # font size in points plus leading
        if y - step < floor:
            break  # never overprint the warning band; lower rows are least important
        y -= step
        text, fitted = _fit(pdf, text, font, size, column)
        pdf.setFont(font, fitted)
        pdf.drawString(x, y, text)

    if warning_lines:
        pdf.setFillGray(0)
        pdf.rect(x, margin, column, box, stroke=0, fill=1)
        pdf.setFillGray(1)
        pdf.setFont("Helvetica-Bold", 7)
        line_y = margin + box - 3.1 * mm
        for line in warning_lines:
            pdf.drawString(x + 1 * mm, line_y, line)
            line_y -= 3.2 * mm
        pdf.setFillGray(0)
    if copies > 1:
        pdf.setFont("Helvetica", 5.5)
        pdf.drawRightString(width - 1.5 * mm, height - 2 * mm, f"{copy_no}/{copies}")


def render_qr_labels(label, *, copies=1):
    """PDF bytes: one 101.6 x 50.8 mm page per copy."""
    if canvas is None:
        raise RuntimeError("PDF engine unavailable: reportlab is not installed in the backend runtime.")
    copies = max(1, min(int(copies), MAX_COPIES))
    stream = BytesIO()
    pdf = canvas.Canvas(stream, pagesize=(LABEL_WIDTH_MM * mm, LABEL_HEIGHT_MM * mm))
    pdf.setTitle(_pdf_text(f"{label.reference} gate QR sticker"))
    pdf.setAuthor("Total Poly Print ERP")
    # Machine-readable copy of the printed QR (lets audits verify the signature).
    pdf.setKeywords(f"tpp-gate-qr {label.token}")
    for copy_no in range(1, copies + 1):
        _draw_label(pdf, label, copy_no, copies)
        pdf.showPage()
    pdf.save()
    return stream.getvalue()
