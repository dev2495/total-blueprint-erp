"""Printable RGP / NRGP (A5 portrait) with the signed gate QR.

The QR carries only ``make_token("GATE_PASS", id)``; the watchman's scan is
resolved and plant-checked by the server. Drafts and cancelled passes print
with a watermark and no QR, so they can never be matched at the gate.
"""
from io import BytesIO

from django.utils import timezone

from apps.factory.models import PlantLegalProfile

from .gate_pass_services import display_number, is_draft_number
from .qr import make_token, qr_png_bytes
from .services import gate_zone

try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A5
    from reportlab.lib.units import mm
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas
except Exception:  # pragma: no cover - explicit runtime failure below
    canvas = None

QR_STATUSES = {"ISSUED", "OUT", "PARTLY_RETURNED", "RETURNED", "CLOSED", "SHORT_CLOSED"}
TITLES = {"RETURNABLE": "RETURNABLE GATE PASS (RGP)", "NON_RETURNABLE": "NON-RETURNABLE GATE PASS (NRGP)"}


def _local(value, fmt="%d-%b-%Y %H:%M"):
    if not value:
        return "-"
    if hasattr(value, "astimezone"):
        return value.astimezone(gate_zone()).strftime(fmt)
    return value.strftime("%d-%b-%Y")


def _wrap(pdf, text, width, font, size):
    words = str(text or "").split()
    lines, current = [], ""
    for word in words:
        trial = f"{current} {word}".strip()
        if pdf.stringWidth(trial, font, size) <= width:
            current = trial
            continue
        if current:
            lines.append(current)
        while pdf.stringWidth(word, font, size) > width and len(word) > 1:
            cut = len(word)
            while cut > 1 and pdf.stringWidth(word[:cut], font, size) > width:
                cut -= 1
            lines.append(word[:cut])
            word = word[cut:]
        current = word
    if current:
        lines.append(current)
    return lines or ["-"]


def qr_token_for(gate_pass):
    if gate_pass.status not in QR_STATUSES or is_draft_number(gate_pass.number):
        return None
    return make_token("GATE_PASS", gate_pass.id)


def render_gate_pass_pdf(gate_pass):
    if canvas is None:
        raise RuntimeError("PDF engine unavailable: reportlab is not installed in the backend runtime.")
    width, height = A5
    margin = 9 * mm
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A5)
    number = display_number(gate_pass)
    token = qr_token_for(gate_pass)
    pdf.setTitle(f"{number} gate pass")
    pdf.setAuthor("Total Poly Print ERP")
    if token:
        # Machine-readable copy of the printed QR (lets audits verify the signature).
        pdf.setKeywords(f"tpp-gate-qr {token}")
    profile = PlantLegalProfile.objects.filter(plant=gate_pass.plant).first()
    legal_name = (profile.legal_name if profile and profile.legal_name else gate_pass.plant.name)
    lines = list(gate_pass.lines.all())
    watermark = "DRAFT - NOT VALID AT GATE" if gate_pass.status == "DRAFT" else "CANCELLED" if gate_pass.status == "CANCELLED" else ""

    def header(first):
        top = height - margin
        pdf.setFillColor(colors.HexColor("#0F172A"))
        pdf.rect(margin, top - 9 * mm, width - 2 * margin, 9 * mm, fill=1, stroke=0)
        pdf.setFillColor(colors.white)
        pdf.setFont("Helvetica-Bold", 10)
        pdf.drawString(margin + 3 * mm, top - 6 * mm, legal_name[:48])
        pdf.setFont("Helvetica-Bold", 7.5)
        pdf.drawRightString(width - margin - 3 * mm, top - 6 * mm, TITLES[gate_pass.kind])
        pdf.setFillColor(colors.black)
        y = top - 13 * mm
        pdf.setFont("Helvetica", 7)
        if profile:
            pdf.drawString(margin, y, f"GSTIN: {profile.gstin or '-'}   Ph: {profile.contact_phone or '-'}")
            y -= 3.4 * mm
            for row in _wrap(pdf, profile.address, width - 2 * margin - (30 * mm if first and token else 0), "Helvetica", 7)[:2]:
                pdf.drawString(margin, y, row)
                y -= 3.2 * mm
        else:
            pdf.drawString(margin, y, gate_pass.plant.name)
            y -= 3.4 * mm
        return y

    def watermark_text():
        if not watermark:
            return
        pdf.saveState()
        pdf.setFillColor(colors.HexColor("#DC2626"))
        pdf.setFillAlpha(0.18)
        pdf.setFont("Helvetica-Bold", 30)
        pdf.translate(width / 2, height / 2)
        pdf.rotate(35)
        pdf.drawCentredString(0, 0, watermark)
        pdf.restoreState()

    watermark_text()
    y = header(True)
    qr_size = 27 * mm
    if token:
        image = ImageReader(BytesIO(qr_png_bytes(token)))
        qr_top = height - margin - 11 * mm
        pdf.drawImage(image, width - margin - qr_size, qr_top - qr_size, qr_size, qr_size)
        pdf.setFont("Helvetica", 6)
        pdf.drawCentredString(width - margin - qr_size / 2, qr_top - qr_size - 2.6 * mm, "Gate: scan this code")
    text_width = width - 2 * margin - (qr_size + 3 * mm if token else 0)
    y -= 1.5 * mm
    pdf.setFont("Helvetica-Bold", 12)
    pdf.drawString(margin, y, number)
    y -= 5 * mm
    pdf.setFont("Helvetica", 7.5)
    facts = [
        ("Issued", _local(gate_pass.issued_at)),
        ("Purpose", gate_pass.get_purpose_display()),
        ("Return by", gate_pass.expected_return_date.strftime("%d-%b-%Y") if gate_pass.expected_return_date else ("Not returnable" if gate_pass.kind == "NON_RETURNABLE" else "-")),
        ("Vehicle", gate_pass.vehicle_number or "-"),
        ("Carried by", gate_pass.carried_by or "-"),
    ]
    for label, value in facts:
        pdf.setFont("Helvetica-Bold", 7.5)
        pdf.drawString(margin, y, f"{label}:")
        pdf.setFont("Helvetica", 7.5)
        pdf.drawString(margin + 18 * mm, y, str(value)[:60])
        y -= 3.8 * mm
    y -= 1 * mm
    pdf.setStrokeColor(colors.HexColor("#CBD5E1"))
    party_rows = [f"To: {gate_pass.party_name}"]
    party_rows += _wrap(pdf, gate_pass.party_address, text_width - 4 * mm, "Helvetica", 7)[:3] if gate_pass.party_address else []
    if gate_pass.party_gstin:
        party_rows.append(f"GSTIN: {gate_pass.party_gstin}")
    box_height = (len(party_rows) * 3.4 + 3) * mm
    y = min(y, height - margin - 11 * mm - qr_size - 5 * mm) if token else y
    pdf.rect(margin, y - box_height + 2.5 * mm, width - 2 * margin, box_height, fill=0, stroke=1)
    for index, row in enumerate(party_rows):
        pdf.setFont("Helvetica-Bold" if index == 0 else "Helvetica", 8 if index == 0 else 7)
        pdf.drawString(margin + 2 * mm, y - index * 3.4 * mm, row[:90])
    y -= box_height + 2 * mm

    columns = [(margin, "#"), (margin + 6 * mm, "ITEM / MACHINE / SERIAL"), (width - margin - 46 * mm, "QTY"), (width - margin - 32 * mm, "UOM"), (width - margin - 20 * mm, "APPROX VALUE")]

    def table_header(y):
        pdf.setFillColor(colors.HexColor("#F1F5F9"))
        pdf.rect(margin, y - 1.6 * mm, width - 2 * margin, 5 * mm, fill=1, stroke=0)
        pdf.setFillColor(colors.HexColor("#0F172A"))
        pdf.setFont("Helvetica-Bold", 6.8)
        for x, label in columns:
            pdf.drawString(x + 1 * mm, y, label)
        pdf.setFillColor(colors.black)
        return y - 5 * mm

    y = table_header(y)
    description_width = width - 2 * margin - 54 * mm
    for line in lines:
        detail = []
        if line.machine_id:
            detail.append(f"Machine: {line.machine.name} ({line.machine.code})")
        elif line.equipment_text:
            detail.append(f"Equipment: {line.equipment_text}")
        if line.serial_no:
            detail.append(f"Sr: {line.serial_no}")
        if line.remarks:
            detail.append(line.remarks)
        rows = _wrap(pdf, line.description, description_width, "Helvetica", 7.2)
        extra = _wrap(pdf, " · ".join(detail), description_width, "Helvetica", 6.4) if detail else []
        needed = (len(rows) * 3.3 + len(extra) * 3 + 1.5) * mm
        if y - needed < 42 * mm:
            pdf.showPage()
            watermark_text()
            y = header(False) - 2 * mm
            pdf.setFont("Helvetica-Bold", 8)
            pdf.drawString(margin, y, f"{number} (continued)")
            y = table_header(y - 5 * mm)
        pdf.setFont("Helvetica", 7.2)
        pdf.drawString(columns[0][0] + 1 * mm, y, str(line.line_no))
        quantity = format(line.quantity.normalize(), "f")
        pdf.drawString(columns[2][0] + 1 * mm, y, quantity)
        pdf.drawString(columns[3][0] + 1 * mm, y, line.uom)
        pdf.drawString(columns[4][0] + 1 * mm, y, f"{line.approx_value:,.2f}" if line.approx_value is not None else "-")
        for row in rows:
            pdf.drawString(columns[1][0] + 1 * mm, y, row)
            y -= 3.3 * mm
        pdf.setFont("Helvetica", 6.4)
        pdf.setFillColor(colors.HexColor("#475569"))
        for row in extra:
            pdf.drawString(columns[1][0] + 1 * mm, y, row)
            y -= 3 * mm
        pdf.setFillColor(colors.black)
        pdf.setStrokeColor(colors.HexColor("#E2E8F0"))
        pdf.line(margin, y + 1.2 * mm, width - margin, y + 1.2 * mm)
        y -= 1.5 * mm

    y -= 1 * mm
    pdf.setFont("Helvetica", 7)
    statement = (
        f"Material sent for {gate_pass.get_purpose_display().lower()} and to be returned by "
        f"{gate_pass.expected_return_date:%d-%b-%Y}. Not for sale." if gate_pass.kind == "RETURNABLE" and gate_pass.expected_return_date
        else "Material is not returnable."
    )
    for row in _wrap(pdf, statement + (f" Note: {gate_pass.notes}" if gate_pass.notes else ""), width - 2 * margin, "Helvetica", 7)[:4]:
        pdf.drawString(margin, y, row)
        y -= 3.3 * mm

    signature_y = 14 * mm
    box_width = (width - 2 * margin - 6 * mm) / 4
    labels = ["Prepared by", "Authorised signatory", "Security (gate)", "Received by"]
    names = [gate_pass.created_by.get_full_name() or gate_pass.created_by.username, (profile.authorized_signatory_name if profile else "") or "", "", ""]
    for index, label in enumerate(labels):
        x = margin + index * (box_width + 2 * mm)
        pdf.setStrokeColor(colors.HexColor("#CBD5E1"))
        pdf.rect(x, signature_y, box_width, 15 * mm, fill=0, stroke=1)
        pdf.setFont("Helvetica-Bold", 6.4)
        pdf.drawString(x + 1.5 * mm, signature_y + 11.8 * mm, label)
        pdf.setFont("Helvetica", 6.2)
        if names[index]:
            pdf.drawString(x + 1.5 * mm, signature_y + 8.4 * mm, names[index][:26])
        pdf.drawString(x + 1.5 * mm, signature_y + 1.6 * mm, "Sign: ______________")
    pdf.setFont("Helvetica", 6)
    pdf.setFillColor(colors.HexColor("#475569"))
    pdf.drawString(margin, 8 * mm, f"Printed {timezone.now().astimezone(gate_zone()):%d-%b-%Y %H:%M} · Status: {gate_pass.get_status_display()}")
    pdf.drawRightString(width - margin, 8 * mm, f"Ref {str(gate_pass.id)[:8].upper()}")
    pdf.showPage()
    pdf.save()
    return buffer.getvalue()
