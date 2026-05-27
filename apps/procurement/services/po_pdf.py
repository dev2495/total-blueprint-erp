"""
PO PDF rendering — letterhead-grade A4. Brand strip, vendor block, lines table,
totals, T&C, signatures. Uses CompanyProfile for letterhead.
"""

from __future__ import annotations

import logging
from io import BytesIO
from pathlib import Path

from django.conf import settings

logger = logging.getLogger(__name__)

try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        PageBreak,
        Paragraph,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
    )
except Exception:  # pragma: no cover
    colors = None
    A4 = None
    ParagraphStyle = None
    getSampleStyleSheet = None
    mm = None
    PageBreak = None
    Paragraph = None
    SimpleDocTemplate = None
    Spacer = None
    Table = None
    TableStyle = None


BRAND_RED = "#C9303B"
BRAND_ORANGE = "#F58634"
BRAND_NAVY = "#1F2C50"
BRAND_BLUE = "#3554A2"
SLATE_300 = "#CBD5E1"
SLATE_500 = "#64748B"
SLATE_700 = "#334155"
SLATE_900 = "#0F172A"


def _esc(text: str) -> str:
    return (
        str(text or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _indian_money(n) -> str:
    try:
        v = float(n or 0)
    except Exception:
        return "0.00"
    sign = "-" if v < 0 else ""
    v = abs(v)
    int_part, frac = f"{v:.2f}".split(".")
    if len(int_part) <= 3:
        body = int_part
    else:
        last3 = int_part[-3:]
        rest = int_part[:-3]
        groups = []
        while len(rest) > 2:
            groups.insert(0, rest[-2:])
            rest = rest[:-2]
        if rest:
            groups.insert(0, rest)
        body = ",".join(groups) + "," + last3
    return f"{sign}{body}.{frac}"


class PurchaseOrderPDFService:
    COMPANY_NAME = "TOTAL POLY PRINT PVT. LTD."
    COMPANY_ADDRESS = (
        "Survey No. 261/3-A, Opp. Dabhel Cricket Ground, "
        "Dabhel, Daman (U.T.), India 396210"
    )
    COMPANY_PHONE = "+91 72111 35002 / +91 98985 85118"
    COMPANY_EMAIL = "info@totalpolyprint.com"
    COMPANY_WEBSITE = "www.totalpolyprint.com"

    @classmethod
    def render_pdf_bytes(cls, po) -> bytes:
        if SimpleDocTemplate is None or Paragraph is None:
            raise RuntimeError("PDF engine unavailable: reportlab is not installed.")

        try:
            from apps.users.models import CompanyProfile

            profile = CompanyProfile.get_solo()
        except Exception:
            profile = None

        legal_name = (
            (getattr(profile, "legal_name", None) or cls.COMPANY_NAME)
            if profile
            else cls.COMPANY_NAME
        )

        buffer = BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=A4,
            topMargin=14 * mm,
            bottomMargin=18 * mm,
            leftMargin=14 * mm,
            rightMargin=14 * mm,
            title=f"Purchase Order {po.code}",
            author=legal_name,
        )

        styles = cls._styles()
        story = []

        story.append(cls._letterhead(po, styles, profile, legal_name))
        story.append(Spacer(1, 4 * mm))
        story.append(cls._vendor_meta_block(po, styles))
        story.append(Spacer(1, 3 * mm))
        story.append(cls._meta_strip(po, styles))
        story.append(Spacer(1, 4 * mm))

        story.append(Paragraph("LINE ITEMS", styles["section"]))
        story.append(Spacer(1, 1 * mm))
        story.append(cls._items_table(po, styles))
        story.append(Spacer(1, 4 * mm))
        story.append(cls._totals_card(po, styles))
        story.append(Spacer(1, 4 * mm))

        if po.notes:
            story.append(Paragraph("NOTES", styles["section"]))
            story.append(
                Paragraph(_esc(po.notes).replace("\n", "<br/>"), styles["body"])
            )
            story.append(Spacer(1, 3 * mm))

        story.append(PageBreak())
        story.append(Paragraph("TERMS &amp; CONDITIONS", styles["section_big"]))
        story.append(Spacer(1, 2 * mm))
        story.append(cls._terms(po, styles))
        story.append(Spacer(1, 6 * mm))
        story.append(cls._signature_block(styles, legal_name))

        doc.build(
            story,
            onFirstPage=lambda c, d: cls._page_chrome(c, d, po, legal_name),
            onLaterPages=lambda c, d: cls._page_chrome(c, d, po, legal_name),
        )
        return buffer.getvalue()

    # ── Styles ────────────────────────────────────────────────────────────
    @classmethod
    def _styles(cls):
        ss = getSampleStyleSheet()
        return {
            "h1": ParagraphStyle("h1", parent=ss["Heading1"], fontSize=18, leading=22, textColor=colors.HexColor(BRAND_NAVY), spaceAfter=2),
            "h2": ParagraphStyle("h2", parent=ss["Heading2"], fontSize=12, leading=15, textColor=colors.HexColor(BRAND_NAVY)),
            "section": ParagraphStyle("section", parent=ss["Heading3"], fontSize=10, leading=12, textColor=colors.HexColor(BRAND_BLUE), spaceAfter=2, fontName="Helvetica-Bold"),
            "section_big": ParagraphStyle("section_big", parent=ss["Heading2"], fontSize=12.5, leading=15, textColor=colors.HexColor(BRAND_NAVY)),
            "body": ParagraphStyle("body", parent=ss["BodyText"], fontSize=8.8, leading=12, textColor=colors.HexColor(SLATE_900)),
            "small": ParagraphStyle("small", parent=ss["BodyText"], fontSize=7.5, leading=10, textColor=colors.HexColor(SLATE_700)),
            "muted": ParagraphStyle("muted", parent=ss["BodyText"], fontSize=7.5, leading=10, textColor=colors.HexColor(SLATE_500)),
            "right": ParagraphStyle("right", parent=ss["BodyText"], fontSize=9, leading=11, alignment=2, textColor=colors.HexColor(SLATE_900)),
            "right_b": ParagraphStyle("right_b", parent=ss["BodyText"], fontSize=10, leading=12, alignment=2, fontName="Helvetica-Bold", textColor=colors.HexColor(BRAND_NAVY)),
            "kv": ParagraphStyle("kv", parent=ss["BodyText"], fontSize=8.5, leading=11, textColor=colors.HexColor(SLATE_700)),
        }

    # ── Letterhead ────────────────────────────────────────────────────────
    @classmethod
    def _letterhead(cls, po, styles, profile, legal_name):
        address = cls.COMPANY_ADDRESS
        contact = f"{cls.COMPANY_PHONE}  ·  {cls.COMPANY_EMAIL}  ·  {cls.COMPANY_WEBSITE}"
        statutory = ""
        if profile is not None:
            parts = [
                getattr(profile, "address_line1", "") or "",
                getattr(profile, "address_line2", "") or "",
            ]
            l2 = ", ".join([p for p in [
                getattr(profile, "city", "") or "",
                getattr(profile, "state", "") or "",
                getattr(profile, "country", "") or "",
                getattr(profile, "pincode", "") or "",
            ] if p])
            address_out = ", ".join([p for p in parts if p])
            if l2:
                address_out = (address_out + ", " + l2) if address_out else l2
            if address_out:
                address = address_out
            phones = " / ".join([p for p in [getattr(profile, "phone_primary", "") or "", getattr(profile, "phone_secondary", "") or ""] if p]) or "—"
            email = getattr(profile, "email", "") or ""
            website = (getattr(profile, "website", "") or "").replace("https://", "").replace("http://", "").strip("/")
            contact = "  ·  ".join([b for b in [phones, email, website] if b])
            stat_bits = []
            for label, field in [("GSTIN", "gstin"), ("PAN", "pan"), ("CIN", "cin")]:
                v = (getattr(profile, field, "") or "").strip()
                if v:
                    stat_bits.append(f"{label} {v}")
            statutory = "  ·  ".join(stat_bits)

        left = [
            cls._tpp_logo_flowable(profile),
            Paragraph(_esc(legal_name), styles["h1"]),
            Paragraph(_esc(address), styles["small"]),
            Paragraph(_esc(contact), styles["small"]),
        ]
        if statutory:
            left.append(Paragraph(_esc(statutory), styles["muted"]))

        right = [
            Paragraph("<b>PURCHASE ORDER</b>", styles["h2"]),
            Paragraph(f"<b>PO No:</b> {_esc(po.code)}", styles["kv"]),
            Paragraph(f"<b>Date:</b> {po.order_date.strftime('%d-%b-%Y')}", styles["kv"]),
            Paragraph(f"<b>Status:</b> {_esc(po.status)}", styles["kv"]),
        ]

        tbl = Table([[left, right]], colWidths=[112 * mm, 70 * mm])
        tbl.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        return tbl

    @classmethod
    def _tpp_logo_flowable(cls, profile=None):
        """Embed the brand SVG logo via svglib; fall back to a drawn TPP mark.

        Mirrors apps/sales/services/quotation_pdf.py — looks under
        `frontend_v2/public/<profile.logo_path>` (default `brand/tpp-logo-pdf.svg`)
        and scales to ~36mm × 12mm. Any failure (missing file, parse error)
        silently falls back to a hand-drawn ReportLab Drawing so the PDF
        never crashes.
        """
        from reportlab.graphics.shapes import Drawing, Polygon, Rect

        target_w = 36 * mm
        target_h = 12 * mm

        try:
            rel_path = (getattr(profile, "logo_path", None) if profile else None) or "brand/tpp-logo-pdf.svg"
            base = Path(getattr(settings, "BASE_DIR", "."))
            candidates = [
                base / "frontend_v2" / "public" / rel_path,
                base.parent / "frontend_v2" / "public" / rel_path,
                Path.cwd() / "frontend_v2" / "public" / rel_path,
            ]
            svg_path = next((p for p in candidates if p.exists()), None)
            if svg_path is not None:
                from svglib.svglib import svg2rlg  # type: ignore
                drawing = svg2rlg(str(svg_path))
                if drawing is not None:
                    src_w = float(getattr(drawing, "width", 0) or 0) or 1.0
                    src_h = float(getattr(drawing, "height", 0) or 0) or 1.0
                    scale = min(target_w / src_w, target_h / src_h)
                    drawing.width = src_w * scale
                    drawing.height = src_h * scale
                    drawing.scale(scale, scale)
                    return drawing
                logger.warning("svg2rlg returned None for %s", svg_path)
            else:
                logger.warning("PO PDF: logo SVG not found for %s", rel_path)
        except Exception:
            logger.warning("PO PDF: SVG logo embed failed; using drawn mark.", exc_info=True)

        # Fallback: hand-drawn brand mark.
        d = Drawing(target_w, target_h)
        stripe_w = target_w / 3.0
        d.add(Rect(0, 0, stripe_w, target_h, fillColor=colors.HexColor(BRAND_RED), strokeColor=None))
        d.add(Rect(stripe_w, 0, stripe_w, target_h, fillColor=colors.HexColor(BRAND_ORANGE), strokeColor=None))
        d.add(Rect(2 * stripe_w, 0, stripe_w, target_h, fillColor=colors.HexColor(BRAND_NAVY), strokeColor=None))
        # Subtle triangle accent so fallback is visibly distinct from text.
        d.add(Polygon(
            [2 * mm, 1 * mm, 6 * mm, 1 * mm, 4 * mm, target_h - 1 * mm],
            fillColor=colors.white,
            strokeColor=None,
        ))
        return d

    @classmethod
    def _vendor_meta_block(cls, po, styles):
        v = po.vendor
        vendor_lines = [
            Paragraph("<b>VENDOR</b>", styles["section"]),
            Paragraph(_esc(v.name), styles["body"]),
        ]
        if getattr(v, "address", None):
            vendor_lines.append(Paragraph(_esc(v.address).replace("\n", "<br/>"), styles["small"]))
        if getattr(v, "gst_no", None):
            vendor_lines.append(Paragraph(f"<b>GSTIN:</b> {_esc(v.gst_no)}", styles["small"]))
        if getattr(v, "phone_number", None) or getattr(v, "email", None):
            vendor_lines.append(Paragraph(f"{_esc(v.phone_number or '')}  ·  {_esc(v.email or '')}", styles["muted"]))

        ship_lines = [
            Paragraph("<b>SHIP TO</b>", styles["section"]),
            Paragraph(_esc(po.plant.name if po.plant else "—"), styles["body"]),
        ]
        if po.delivery_address:
            ship_lines.append(Paragraph(_esc(po.delivery_address).replace("\n", "<br/>"), styles["small"]))

        tbl = Table([[vendor_lines, ship_lines]], colWidths=[91 * mm, 91 * mm])
        tbl.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor(SLATE_300)),
            ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor(SLATE_300)),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        return tbl

    @classmethod
    def _meta_strip(cls, po, styles):
        rows = [
            [Paragraph("<b>Expected</b>", styles["muted"]),
             Paragraph(po.expected_delivery_date.strftime("%d-%b-%Y") if po.expected_delivery_date else "—", styles["body"]),
             Paragraph("<b>Payment Terms</b>", styles["muted"]),
             Paragraph(_esc(po.payment_terms or "—"), styles["body"])],
            [Paragraph("<b>Freight</b>", styles["muted"]),
             Paragraph(_esc(po.freight_terms or "—"), styles["body"]),
             Paragraph("<b>Currency</b>", styles["muted"]),
             Paragraph(_esc(po.currency or "INR"), styles["body"])],
        ]
        tbl = Table(rows, colWidths=[24 * mm, 67 * mm, 24 * mm, 67 * mm])
        tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F8FAFC")),
            ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor(SLATE_300)),
            ("INNERGRID", (0, 0), (-1, -1), 0.2, colors.HexColor(SLATE_300)),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        return tbl

    @classmethod
    def _items_table(cls, po, styles):
        head = ["#", "Material", "Qty", "UOM", "Rate", "GST %", "Amount"]
        rows = [head]
        for it in po.items.all():
            rows.append([
                Paragraph(str(it.line_no), styles["body"]),
                Paragraph(_esc(f"{it.material.code} — {it.material.name}"), styles["body"]),
                Paragraph(f"{float(it.qty_ordered):.3f}", styles["right"]),
                Paragraph(_esc(it.uom), styles["body"]),
                Paragraph(_indian_money(it.rate_per_uom), styles["right"]),
                Paragraph(f"{float(it.gst_pct):.1f}%", styles["right"]),
                Paragraph(_indian_money(it.line_total), styles["right_b"]),
            ])
        tbl = Table(rows, colWidths=[10 * mm, 70 * mm, 20 * mm, 16 * mm, 22 * mm, 16 * mm, 28 * mm], repeatRows=1)
        tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(BRAND_NAVY)),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, 0), 8.5),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 5),
            ("TOPPADDING", (0, 0), (-1, 0), 5),
            ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor(SLATE_300)),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 1), (-1, -1), 4),
            ("RIGHTPADDING", (0, 1), (-1, -1), 4),
            ("TOPPADDING", (0, 1), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 1), (-1, -1), 3),
        ]))
        return tbl

    @classmethod
    def _totals_card(cls, po, styles):
        rows = [
            [Paragraph("Subtotal", styles["right"]), Paragraph(_indian_money(po.subtotal), styles["right"])],
            [Paragraph("GST", styles["right"]), Paragraph(_indian_money(po.gst_total), styles["right"])],
            [Paragraph("Freight", styles["right"]), Paragraph(_indian_money(po.freight_amount), styles["right"])],
            [Paragraph("<b>Grand Total</b>", styles["right_b"]), Paragraph(f"<b>INR {_indian_money(po.grand_total)}</b>", styles["right_b"])],
        ]
        tbl = Table(rows, colWidths=[140 * mm, 42 * mm])
        tbl.setStyle(TableStyle([
            ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
            ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#F1F5F9")),
            ("LINEABOVE", (0, -1), (-1, -1), 0.6, colors.HexColor(BRAND_NAVY)),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        return tbl

    @classmethod
    def _terms(cls, po, styles):
        defaults = [
            "Goods must match the specification stated above. Any deviation will be returned at vendor cost.",
            "Vendor must enclose a tax invoice and material test certificate (where applicable) with every consignment.",
            "Payment will be released as per the agreed payment terms, after material is QC-approved and received.",
            "Delivery delays beyond the expected date must be communicated 24 hours in advance, in writing.",
            "Buyer reserves the right to cancel the PO if material is not delivered within 7 days of the expected date.",
            "All disputes are subject to Daman, U.T. jurisdiction.",
        ]
        rows = [[Paragraph(f"{i + 1}.", styles["body"]), Paragraph(_esc(t), styles["body"])] for i, t in enumerate(defaults)]
        tbl = Table(rows, colWidths=[8 * mm, 174 * mm])
        tbl.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 2),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ]))
        return tbl

    @classmethod
    def _signature_block(cls, styles, legal_name):
        rows = [
            [Paragraph("<b>For Vendor</b>", styles["body"]), Paragraph(f"<b>For {_esc(legal_name)}</b>", styles["body"])],
            [Paragraph("&nbsp;<br/>&nbsp;<br/>____________________<br/>Authorised Signatory", styles["small"]),
             Paragraph("&nbsp;<br/>&nbsp;<br/>____________________<br/>Authorised Signatory", styles["small"])],
        ]
        tbl = Table(rows, colWidths=[91 * mm, 91 * mm])
        tbl.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        return tbl

    @classmethod
    def _page_chrome(cls, canvas, doc, po, legal_name):
        page_w, page_h = A4
        bar_top = page_h - 3 * mm
        bar_h = 2.4 * mm
        stripe_w = page_w / 3.0
        canvas.setFillColor(colors.HexColor(BRAND_RED))
        canvas.rect(0, bar_top, stripe_w, bar_h, fill=1, stroke=0)
        canvas.setFillColor(colors.HexColor(BRAND_ORANGE))
        canvas.rect(stripe_w, bar_top, stripe_w, bar_h, fill=1, stroke=0)
        canvas.setFillColor(colors.HexColor(BRAND_NAVY))
        canvas.rect(2 * stripe_w, bar_top, stripe_w, bar_h, fill=1, stroke=0)

        canvas.setStrokeColor(colors.HexColor(SLATE_300))
        canvas.setLineWidth(0.4)
        canvas.line(14 * mm, 14 * mm, page_w - 14 * mm, 14 * mm)
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(colors.HexColor(SLATE_500))
        canvas.drawString(14 * mm, 10 * mm, f"{legal_name}  ·  PO {po.code}")
        canvas.drawRightString(
            page_w - 14 * mm, 10 * mm, f"Page {doc.page}"
        )
