"""Printable job-work delivery challan (GST Rule 45), A4, with a gate QR."""
from __future__ import annotations

import io
from decimal import Decimal
from hashlib import sha1

from django.utils import timezone

from apps.inventory.models import JobWorkChallan

try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas
except Exception:  # pragma: no cover - explicit runtime failure below
    colors = A4 = mm = ImageReader = canvas = None

NAVY = "#0F172A"
LINE = "#CBD5E1"
MUTED = "#475569"


def _factory_time(value=None):
    """Statutory paper shows factory (gate) time, never the server's UTC."""
    from apps.gate.services import gate_zone

    return (value or timezone.now()).astimezone(gate_zone())


def _fmt_date(value):
    if not value:
        return "-"
    if hasattr(value, "tzinfo") and getattr(value, "tzinfo", None) is not None:
        value = _factory_time(value)
    return value.strftime("%d-%b-%Y")


def _num(value, places=3):
    return f"{Decimal(str(value or 0)):,.{places}f}"


def _inr(value):
    value = Decimal(str(value or 0)).quantize(Decimal("0.01"))
    sign = "-" if value < 0 else ""
    whole, frac = f"{abs(value):.2f}".split(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        whole = ",".join(groups + [tail])
    return f"{sign}Rs {whole}.{frac}"


class JobWorkChallanPDF:
    TITLE = "DELIVERY CHALLAN FOR JOB WORK"
    SUBTITLE = "Under Rule 45 of the CGST Rules, 2017 (goods sent for job work — not a sale)"

    @staticmethod
    def _wrap(pdf, text, x, y, width, *, font="Helvetica", size=7.6, leading=3.3 * 2.83465, max_lines=3):
        words = str(text or "-").split()
        lines, current = [], []
        for word in words:
            trial = " ".join(current + [word])
            if pdf.stringWidth(trial, font, size) <= width or not current:
                current.append(word)
            else:
                lines.append(" ".join(current))
                current = [word]
        if current:
            lines.append(" ".join(current))
        pdf.setFont(font, size)
        for index, line in enumerate(lines[:max_lines]):
            suffix = "…" if index == max_lines - 1 and len(lines) > max_lines else ""
            pdf.drawString(x, y - index * leading, line + suffix)
        return y - min(len(lines), max_lines) * leading

    @classmethod
    def _party_block(cls, pdf, x, y, title, party):
        pdf.setStrokeColor(colors.HexColor(LINE))
        pdf.rect(x, y - 30 * mm, 93 * mm, 30 * mm, fill=0, stroke=1)
        pdf.setFillColor(colors.HexColor(MUTED))
        pdf.setFont("Helvetica-Bold", 7)
        pdf.drawString(x + 3 * mm, y - 4.5 * mm, title)
        pdf.setFillColor(colors.black)
        pdf.setFont("Helvetica-Bold", 9)
        pdf.drawString(x + 3 * mm, y - 9.5 * mm, str(party.get("name") or "-")[:52])
        pdf.setFont("Helvetica", 7.8)
        pdf.drawString(x + 3 * mm, y - 14 * mm, f"GSTIN: {party.get('gstin') or 'Not registered / not on file'}")
        cls._wrap(pdf, party.get("address") or "-", x + 3 * mm, y - 18.5 * mm, 86 * mm, max_lines=3)
        state = party.get("state")
        if state:
            pdf.setFont("Helvetica", 7.6)
            pdf.drawString(x + 3 * mm, y - 28.2 * mm, f"State: {state}")

    @classmethod
    def generate(cls, challan: JobWorkChallan) -> bytes:
        if canvas is None:
            raise RuntimeError("PDF engine unavailable: reportlab is not installed in the backend runtime.")
        from apps.gate.qr import make_token, qr_png_bytes

        challan = JobWorkChallan.objects.select_related("order", "order__production_job", "order__process", "vendor", "plant", "issued_by").get(id=challan.id)
        order = challan.order
        lines = list(challan.lines.all().order_by("line_no"))
        consignor = challan.consignor or {}
        consignee = challan.consignee or {}

        buffer = io.BytesIO()
        pdf = canvas.Canvas(buffer, pagesize=A4)
        pdf.setTitle(f"{challan.number} job-work challan")
        width, height = A4

        def header():
            pdf.setFillColor(colors.HexColor(NAVY))
            pdf.rect(10 * mm, 280 * mm, 190 * mm, 14 * mm, fill=1, stroke=0)
            pdf.setFillColor(colors.white)
            pdf.setFont("Helvetica-Bold", 12.5)
            pdf.drawString(14 * mm, 288 * mm, str(consignor.get("name") or challan.plant.name)[:48])
            pdf.setFont("Helvetica-Bold", 10.5)
            pdf.drawRightString(196 * mm, 288 * mm, cls.TITLE)
            pdf.setFont("Helvetica", 7)
            pdf.drawRightString(196 * mm, 283 * mm, cls.SUBTITLE)
            pdf.setFillColor(colors.black)

        header()
        # Document box + QR
        pdf.setStrokeColor(colors.HexColor(LINE))
        pdf.rect(10 * mm, 247 * mm, 152 * mm, 30 * mm, fill=0, stroke=1)
        rows = [
            ("Challan No", challan.number, "Challan date", _fmt_date(challan.issued_at)),
            ("Job-work order", order.number, "Expected return", _fmt_date(challan.expected_return_date)),
            ("Purpose", challan.purpose, "Place of supply", challan.place_of_supply or "-"),
            ("Production job", getattr(order.production_job, "job_number", None) or "-", "Vehicle", challan.vehicle_no or "-"),
        ]
        y = 271.5 * mm
        for left_label, left_value, right_label, right_value in rows:
            pdf.setFont("Helvetica-Bold", 7.6)
            pdf.drawString(13 * mm, y, left_label)
            pdf.drawString(92 * mm, y, right_label)
            pdf.setFont("Helvetica", 8.4)
            pdf.drawString(40 * mm, y, str(left_value)[:30])
            pdf.drawString(119 * mm, y, str(right_value)[:24])
            y -= 6.4 * mm
        token = make_token("JOBWORK_CHALLAN", challan.id)
        pdf.drawImage(ImageReader(io.BytesIO(qr_png_bytes(token))), 166 * mm, 247 * mm, 30 * mm, 30 * mm)
        pdf.setFont("Helvetica", 6)
        pdf.setFillColor(colors.HexColor(MUTED))
        pdf.drawCentredString(181 * mm, 244.5 * mm, "Gate scan")
        pdf.setFillColor(colors.black)

        cls._party_block(pdf, 10 * mm, 241 * mm, "CONSIGNOR (PRINCIPAL)", consignor)
        cls._party_block(pdf, 107 * mm, 241 * mm, "CONSIGNEE (JOB WORKER)", consignee)

        def table_header(top):
            pdf.setFillColor(colors.HexColor("#F1F5F9"))
            pdf.rect(10 * mm, top - 7 * mm, 190 * mm, 7 * mm, fill=1, stroke=0)
            pdf.setFillColor(colors.HexColor(NAVY))
            pdf.setFont("Helvetica-Bold", 7.6)
            pdf.drawString(12 * mm, top - 4.6 * mm, "#")
            pdf.drawString(18 * mm, top - 4.6 * mm, "DESCRIPTION OF GOODS")
            pdf.drawString(118 * mm, top - 4.6 * mm, "HSN")
            pdf.drawRightString(152 * mm, top - 4.6 * mm, "QUANTITY")
            pdf.drawString(154 * mm, top - 4.6 * mm, "UNIT")
            pdf.drawRightString(198 * mm, top - 4.6 * mm, "VALUE")
            pdf.setFillColor(colors.black)
            return top - 11.5 * mm

        y = table_header(206 * mm)
        for line in lines:
            if y < 62 * mm:
                pdf.setFont("Helvetica", 7)
                pdf.drawRightString(200 * mm, 12 * mm, "continued…")
                pdf.showPage()
                header()
                y = table_header(275 * mm)
            pdf.setFont("Helvetica", 7.8)
            pdf.drawString(12 * mm, y, str(line.line_no))
            end = cls._wrap(pdf, line.description, 18 * mm, y, 97 * mm, size=7.8, max_lines=2)
            pdf.setFont("Helvetica", 7.8)
            pdf.drawString(118 * mm, y, line.hsn_code or "-")
            pdf.drawRightString(152 * mm, y, _num(line.quantity))
            pdf.drawString(154 * mm, y, line.uom)
            pdf.drawRightString(198 * mm, y, _inr(line.value))
            y = min(end, y - 5.2 * mm) - 1.2 * mm
            pdf.setStrokeColor(colors.HexColor("#E2E8F0"))
            pdf.line(10 * mm, y + 2.4 * mm, 200 * mm, y + 2.4 * mm)

        rolls = sum(1 for line in lines if line.kind == "ROLL")
        y -= 2 * mm
        pdf.setStrokeColor(colors.HexColor(LINE))
        pdf.rect(110 * mm, y - 14 * mm, 90 * mm, 14 * mm, fill=0, stroke=1)
        pdf.setFont("Helvetica-Bold", 8.2)
        pdf.drawString(113 * mm, y - 4.8 * mm, f"Total: {len(lines)} line(s){f' · {rolls} roll(s)' if rolls else ''}")
        pdf.drawString(113 * mm, y - 9 * mm, f"Total quantity: {_num(challan.total_qty_kg)} kg")
        pdf.drawString(113 * mm, y - 13 * mm, f"Total value: {_inr(challan.total_value)}")
        pdf.setFont("Helvetica", 7.2)
        notes = [
            "Goods are sent for job work and remain the property of the consignor; no sale is involved.",
            "Return the processed goods, unused material and waste with your delivery challan quoting this challan number.",
            "Inputs must return within one year of this challan (capital goods: three years) — Sec. 143 CGST Act.",
        ]
        if challan.notes:
            notes.insert(0, f"Note: {challan.notes}")
        note_y = y - 4.8 * mm
        for text in notes:
            note_y = cls._wrap(pdf, text, 10 * mm, note_y, 96 * mm, size=7.2, max_lines=2) - 0.8 * mm

        sign_y = min(note_y, y - 16 * mm) - 22 * mm
        if sign_y < 14 * mm:
            pdf.showPage()
            header()
            sign_y = 230 * mm
        blocks = [
            (10 * mm, f"For {str(consignor.get('name') or challan.plant.name)[:34]}", consignor.get("signatory_name") or "Authorised signatory", consignor.get("signatory_designation") or ""),
            (73 * mm, "Transporter / driver", challan.vehicle_no or "", ""),
            (136 * mm, f"Received by {str(consignee.get('name') or challan.vendor.name)[:28]}", "", "Date and seal"),
        ]
        for x, title, name, role in blocks:
            pdf.setStrokeColor(colors.HexColor(LINE))
            pdf.rect(x, sign_y, 64 * mm, 20 * mm, fill=0, stroke=1)
            pdf.setFont("Helvetica-Bold", 7.4)
            pdf.drawString(x + 2.5 * mm, sign_y + 16 * mm, title)
            pdf.setFont("Helvetica", 7)
            if name:
                pdf.drawString(x + 2.5 * mm, sign_y + 11.5 * mm, name[:40])
            if role:
                pdf.drawString(x + 2.5 * mm, sign_y + 7.5 * mm, role[:40])
            pdf.drawString(x + 2.5 * mm, sign_y + 2.5 * mm, "Signature: ______________________")

        digest = sha1(f"{challan.id}|{challan.number}|{challan.total_value}".encode()).hexdigest()[:12].upper()
        pdf.setFont("Helvetica", 6.8)
        pdf.setFillColor(colors.HexColor(MUTED))
        issuer = challan.issued_by
        issued_by = ((issuer.get_full_name() or "").strip() or issuer.username) if issuer is not None else "-"
        pdf.drawString(10 * mm, 6 * mm, f"Issued by {issued_by} · printed {_factory_time():%d-%b-%Y %H:%M}")
        pdf.drawRightString(200 * mm, 6 * mm, f"{challan.number} · ref {digest}")
        pdf.showPage()
        pdf.save()
        return buffer.getvalue()
