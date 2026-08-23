from __future__ import annotations

import logging
import os
from io import BytesIO
from pathlib import Path

from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)

try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        KeepTogether,
        ListFlowable,
        ListItem,
        PageBreak,
        Paragraph,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
    )
except Exception:  # pragma: no cover - exercised by runtime dependency check
    colors = None
    A4 = None
    ParagraphStyle = None
    getSampleStyleSheet = None
    mm = None
    KeepTogether = None
    ListFlowable = None
    ListItem = None
    PageBreak = None
    Paragraph = None
    SimpleDocTemplate = None
    Spacer = None
    Table = None
    TableStyle = None


# ──────────────────────────────────────────────────────────────────────────────
# Brand palette — Total Poly Print.
# ──────────────────────────────────────────────────────────────────────────────
BRAND_RED = "#C9303B"
BRAND_ORANGE = "#F58634"
BRAND_NAVY = "#29345D"
BRAND_NAVY_DEEP = "#1E2848"
BRAND_BLUE = "#1068A9"
INK = "#4B4B4D"
SLATE_900 = "#0F172A"
SLATE_700 = "#334155"
SLATE_500 = "#64748B"
SLATE_300 = "#CBD5E1"
SLATE_200 = "#E2E8F0"
SLATE_100 = "#F1F5F9"
SLATE_50 = "#F8FAFC"
SOFT_NAVY = "#EEF1F8"


# ──────────────────────────────────────────────────────────────────────────────
# Default terms & conditions — visible on every customer-facing PDF unless the
# quotation supplies its own custom_terms. Keep numbered, short, audit-friendly.
# ──────────────────────────────────────────────────────────────────────────────
DEFAULT_TERMS = [
    "Prices quoted are valid for the validity period stated above. Beyond expiry, a fresh quotation must be requested.",
    "GST as applicable will be charged extra at the prevailing rate at the time of dispatch.",
    "Delivery as per agreed Incoterm. Freight, transit insurance and unloading at customer's account unless explicitly included.",
    "Lead time begins on receipt of confirmed purchase order, signed artwork approval and 50% advance (where applicable).",
    "Standard manufacturing tolerance: +/- 10% on quantity, +/- 5% on web width and overall pouch dimensions.",
    "Artwork, cylinder and die charges are non-refundable and remain the property of Total Poly Print Pvt. Ltd.",
    "Material substitutions of equivalent grade may be applied where supply constraints arise; customer will be notified.",
    "Goods, once dispatched, will not be taken back unless a quality complaint is raised within 15 days of receipt.",
    "Payment as per agreed terms. Overdue amounts attract interest at 18% per annum from the due date.",
    "Disputes are subject to the jurisdiction of courts in Daman, U.T. (India).",
]


class QuotationPDFService:
    COMPANY_NAME = "TOTAL POLY PRINT PVT. LTD."
    COMPANY_TAGLINE = "Flexible Packaging · Pouches · Laminates"
    COMPANY_ADDRESS = (
        "Survey No. 261/3-A, Opp. Dabhel Cricket Ground, "
        "Dabhel, Daman (U.T.), India 396210"
    )
    COMPANY_PHONE = "+91 72111 35002 / +91 98985 85118"
    COMPANY_EMAIL = "info@totalpolyprint.com"
    COMPANY_WEBSITE = "www.totalpolyprint.com"
    # TODO: confirm with finance — these stay as placeholders until finance signs off.
    COMPANY_GSTIN = "[GSTIN PLACEHOLDER]"
    COMPANY_PAN = "[PAN PLACEHOLDER]"
    COMPANY_CIN = "[CIN PLACEHOLDER]"
    BANK_NAME = "[Bank Name — to be filled]"
    BANK_ACCOUNT = "[Account Number — to be filled]"
    BANK_IFSC = "[IFSC — to be filled]"
    BANK_BRANCH = "[Branch — to be filled]"

    @classmethod
    def render_pdf_bytes(cls, quotation, *, customer_view: bool = False) -> bytes:
        if SimpleDocTemplate is None or Paragraph is None:
            raise RuntimeError("PDF engine unavailable: reportlab is not installed.")

        # Load the editable CompanyProfile singleton and stash on the quotation
        # so the (class-method) helpers can read it without a global.
        try:
            from apps.users.models import CompanyProfile  # late import to avoid cycles
            profile = CompanyProfile.get_solo()
        except Exception:  # pragma: no cover - profile load failure is recoverable
            logger.warning("CompanyProfile not available; falling back to legacy constants", exc_info=True)
            profile = None
        quotation._company_profile = profile

        legal_name = (getattr(profile, "legal_name", None) or cls.COMPANY_NAME) if profile else cls.COMPANY_NAME

        buffer = BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=A4,
            topMargin=14 * mm,
            bottomMargin=18 * mm,
            leftMargin=14 * mm,
            rightMargin=14 * mm,
            pageCompression=0,
            title=f"Quotation {quotation.quote_number}",
            author=legal_name,
        )
        styles = cls._styles()
        story = []

        # ── Letterhead ────────────────────────────────────────────────────────
        story.append(cls._letterhead(quotation, styles))
        story.append(Spacer(1, 4 * mm))

        # ── Bill-to + Ship-to card row ────────────────────────────────────────
        story.append(cls._addresses_block(quotation, styles))
        story.append(Spacer(1, 3 * mm))

        # ── Meta strip ────────────────────────────────────────────────────────
        story.append(cls._meta_strip(quotation, styles))
        story.append(Spacer(1, 4 * mm))

        # ── Commercial Lines ──────────────────────────────────────────────────
        story.append(Paragraph("COMMERCIAL LINES", styles["section"]))
        story.append(Spacer(1, 1 * mm))
        story.append(cls._line_items_table(quotation, styles, customer_view=customer_view))
        story.append(Spacer(1, 4 * mm))

        # ── Summary card (right-aligned) ──────────────────────────────────────
        story.append(cls._summary_card(quotation, styles, customer_view=customer_view))
        story.append(Spacer(1, 3 * mm))
        if not customer_view:
            story.append(
                Paragraph(
                    "System costing remains estimated until production actuals and finance close the order.",
                    styles["muted"],
                )
            )
            story.append(Spacer(1, 2 * mm))

        # ── Amount in words ───────────────────────────────────────────────────
        totals = quotation.totals_snapshot or {}
        grand = float(totals.get("grand_total") or 0)
        if grand > 0:
            story.append(
                Paragraph(
                    f"<b>Amount in words:</b> {cls._escape(cls.num_to_indian_words(grand))}",
                    styles["amount_words"],
                )
            )
            story.append(Spacer(1, 3 * mm))

        # ── Special / custom terms ────────────────────────────────────────────
        custom_terms = (getattr(quotation, "custom_terms", "") or "").strip()
        if custom_terms:
            story.append(Paragraph("SPECIAL TERMS", styles["section"]))
            story.append(Paragraph(cls._escape(custom_terms).replace("\n", "<br/>"), styles["body"]))
            story.append(Spacer(1, 3 * mm))

        if quotation.notes and not customer_view:
            story.append(Paragraph("NOTES", styles["section"]))
            story.append(Paragraph(cls._escape(quotation.notes).replace("\n", "<br/>"), styles["body"]))
            story.append(Spacer(1, 3 * mm))

        # ── Page 2: Standard T&C + Bank + Signatures ──────────────────────────
        story.append(PageBreak())
        story.append(Paragraph("TERMS &amp; CONDITIONS", styles["section_big"]))
        story.append(Spacer(1, 2 * mm))
        story.append(cls._terms_list(quotation, styles))
        story.append(Spacer(1, 5 * mm))

        if profile and any(
            str(getattr(profile, field, "") or "").strip()
            for field in ("bank_name", "bank_account_no", "bank_ifsc", "bank_branch", "bank_upi")
        ):
            story.append(Paragraph("BANK DETAILS · FOR REMITTANCE", styles["section"]))
            story.append(cls._bank_block(styles, quotation))
            story.append(Spacer(1, 6 * mm))

        story.append(cls._signature_block(quotation, styles))

        # ── Internal-only appendix ────────────────────────────────────────────
        if not customer_view:
            history = list(getattr(quotation, "status_history", None) or [])
            if history:
                story.append(Spacer(1, 8 * mm))
                story.append(Paragraph("STATUS HISTORY (INTERNAL)", styles["section"]))
                hist_rows = [["Status", "At", "By", "Note"]]
                for entry in history:
                    hist_rows.append([
                        str(entry.get("status") or "-"),
                        str(entry.get("at") or "-")[:19].replace("T", " "),
                        str(entry.get("by_name") or "-"),
                        cls._escape(str(entry.get("note") or "")),
                    ])
                hist_table = Table(
                    hist_rows,
                    colWidths=[24 * mm, 36 * mm, 38 * mm, 80 * mm],
                    repeatRows=1,
                )
                hist_table.setStyle(cls._table_style(header=True))
                story.append(hist_table)

        doc.build(
            story,
            onFirstPage=lambda c, d: cls._draw_page_chrome(c, d, quotation),
            onLaterPages=lambda c, d: cls._draw_page_chrome(c, d, quotation),
        )
        return buffer.getvalue()

    # ──────────────────────────────────────────────────────────────────────
    # Page chrome (top brand strip + footer)
    # ──────────────────────────────────────────────────────────────────────

    # Profile helpers
    @staticmethod
    def _profile_value(quotation, field: str, fallback: str = "") -> str:
        profile = getattr(quotation, "_company_profile", None)
        if profile is None:
            return fallback
        value = getattr(profile, field, None)
        if value in (None, ""):
            return fallback
        return str(value)

    @classmethod
    def _profile_company_name(cls, quotation) -> str:
        return cls._profile_value(quotation, "legal_name", cls.COMPANY_NAME)

    @classmethod
    def _profile_website(cls, quotation) -> str:
        raw = cls._profile_value(quotation, "website", cls.COMPANY_WEBSITE)
        # Strip protocol for footer display.
        return raw.replace("https://", "").replace("http://", "").strip("/")

    @classmethod
    def _profile_address_block(cls, quotation) -> str:
        profile = getattr(quotation, "_company_profile", None)
        if profile is None:
            return cls.COMPANY_ADDRESS
        parts = [
            getattr(profile, "address_line1", "") or "",
            getattr(profile, "address_line2", "") or "",
        ]
        line2_parts = [
            getattr(profile, "city", "") or "",
            getattr(profile, "state", "") or "",
            getattr(profile, "country", "") or "",
            getattr(profile, "pincode", "") or "",
        ]
        line2 = ", ".join([p for p in line2_parts if p])
        out = ", ".join([p for p in parts if p])
        if line2:
            out = (out + ", " + line2) if out else line2
        return out or cls.COMPANY_ADDRESS

    @classmethod
    def _profile_contact_line(cls, quotation) -> str:
        profile = getattr(quotation, "_company_profile", None)
        if profile is None:
            return f"{cls.COMPANY_PHONE}  ·  {cls.COMPANY_EMAIL}  ·  {cls.COMPANY_WEBSITE}"
        phones = []
        for f in ("phone_primary", "phone_secondary"):
            v = (getattr(profile, f, "") or "").strip()
            if v:
                phones.append(v)
        phone_line = " / ".join(phones) if phones else "—"
        email = (getattr(profile, "email", "") or "").strip()
        website = cls._profile_website(quotation)
        bits = [phone_line, email, website]
        return "  ·  ".join([b for b in bits if b])

    @classmethod
    def _profile_statutory_line(cls, quotation) -> str:
        profile = getattr(quotation, "_company_profile", None)
        if profile is None:
            return ""
        bits = []
        for label, field in (
            ("GSTIN", "gstin"),
            ("PAN", "pan"),
            ("CIN", "cin"),
            ("Udyam", "udyam"),
            ("IEC", "iec_code"),
        ):
            v = (getattr(profile, field, "") or "").strip()
            if v:
                bits.append(f"{label} {v}")
        return "  ·  ".join(bits)

    @classmethod
    def _draw_page_chrome(cls, canvas, doc, quotation):
        page_w, page_h = A4
        # Top three-stripe brand bar (red · orange · navy)
        bar_top = page_h - 3 * mm
        bar_h = 2.4 * mm
        stripe_w = page_w / 3.0
        canvas.setFillColor(colors.HexColor(BRAND_RED))
        canvas.rect(0, bar_top, stripe_w, bar_h, fill=1, stroke=0)
        canvas.setFillColor(colors.HexColor(BRAND_ORANGE))
        canvas.rect(stripe_w, bar_top, stripe_w, bar_h, fill=1, stroke=0)
        canvas.setFillColor(colors.HexColor(BRAND_NAVY))
        canvas.rect(2 * stripe_w, bar_top, stripe_w, bar_h, fill=1, stroke=0)

        # Footer line
        canvas.setStrokeColor(colors.HexColor(SLATE_300))
        canvas.setLineWidth(0.4)
        canvas.line(14 * mm, 14 * mm, page_w - 14 * mm, 14 * mm)
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(colors.HexColor(SLATE_500))
        canvas.drawString(
            14 * mm,
            10 * mm,
            f"{cls._profile_company_name(quotation)}  ·  Quote {quotation.quote_number} R{quotation.revision_no}  ·  "
            f"Trace {((quotation.frozen_snapshot or {}).get('checksum') or 'DRAFT')[:12]}",
        )
        canvas.drawRightString(
            page_w - 14 * mm,
            10 * mm,
            f"Page {doc.page}  ·  Generated {timezone.now().strftime('%d-%b-%Y %H:%M')}",
        )

    # ──────────────────────────────────────────────────────────────────────
    # Letterhead — logo (drawn) + wordmark + address + quote stamp
    # ──────────────────────────────────────────────────────────────────────

    @classmethod
    def _letterhead(cls, quotation, styles) -> Table:
        # Left cell: embedded SVG logo (via svglib) + wordmark + address.
        company_name = cls._profile_company_name(quotation)
        tagline = cls._profile_value(quotation, "tagline", cls.COMPANY_TAGLINE)
        rows = [
            [cls._tpp_logo_flowable(quotation)],
            [Paragraph(cls._escape(company_name), styles["wordmark"])],
        ]
        if tagline:
            rows.append([Paragraph(cls._escape(tagline), styles["tagline"])])
        rows.append([Paragraph(cls._escape(cls._profile_address_block(quotation)), styles["address"])])
        rows.append([Paragraph(cls._escape(cls._profile_contact_line(quotation)), styles["address"])])
        statutory = cls._profile_statutory_line(quotation)
        if statutory:
            rows.append([Paragraph(cls._escape(statutory), styles["address_mono"])])
        left = Table(rows, colWidths=[112 * mm])
        left.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
        ]))

        # Right cell: quote-number stamp card.
        valid_until = quotation.valid_until.strftime("%d-%b-%Y") if quotation.valid_until else "—"
        stamp_rows = [
            [Paragraph("QUOTATION", styles["stamp_eyebrow"])],
            [Paragraph(cls._escape(quotation.quote_number), styles["stamp_number"])],
            [Paragraph(
                f"<b>Status</b>  {cls._escape(quotation.get_status_display())}",
                styles["stamp_meta"],
            )],
            [Paragraph(
                f"<b>Rev</b>  v{int(getattr(quotation, 'revision_no', 1) or 1)}",
                styles["stamp_meta"],
            )],
            [Paragraph(
                f"<b>Date</b>  {(quotation.frozen_at or quotation.created_at).strftime('%d-%b-%Y')}",
                styles["stamp_meta"],
            )],
            [Paragraph(
                f"<b>Valid&nbsp;until</b>  {valid_until}",
                styles["stamp_meta"],
            )],
        ]
        right = Table(stamp_rows, colWidths=[58 * mm])
        right.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(SOFT_NAVY)),
            ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor(BRAND_NAVY)),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]))

        outer = Table([[left, right]], colWidths=[112 * mm, 60 * mm])
        outer.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        return outer

    @classmethod
    def _tpp_logo_flowable(cls, quotation=None):
        """Embed the brand SVG logo via svglib; fall back to a drawn TPP mark.

        Logo source is `frontend_v2/public/<profile.logo_path>`. The drawing is
        scaled to fit a ~36mm × 12mm letterhead slot. Any failure (missing file,
        parse error) silently falls back to a hand-drawn ReportLab Drawing so
        the PDF never crashes.
        """
        from reportlab.graphics.shapes import Drawing, Polygon, Rect, String

        target_w = 36 * mm
        target_h = 14 * mm

        # Resolve logo file path from profile (if available).
        try:
            profile = getattr(quotation, "_company_profile", None) if quotation is not None else None
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
                logger.warning("Logo SVG not found at any candidate path for %s", rel_path)
        except Exception:
            logger.warning("Falling back to drawn TPP mark; svglib embed failed.", exc_info=True)

        # Fallback: hand-drawn brand mark.
        d = Drawing(target_w, target_h)
        d.add(Rect(0, 1.4 * mm, 32 * mm, 0.7 * mm, fillColor=colors.HexColor(BRAND_NAVY), strokeColor=None))
        d.add(Polygon(
            [0, 4 * mm, 6 * mm, 4 * mm, 3 * mm, 12 * mm],
            fillColor=colors.HexColor(BRAND_RED),
            strokeColor=None,
        ))
        d.add(Polygon(
            [5 * mm, 4 * mm, 11 * mm, 4 * mm, 8 * mm, 12 * mm],
            fillColor=colors.HexColor(BRAND_ORANGE),
            strokeColor=None,
        ))
        d.add(String(13 * mm, 5 * mm, "TPP", fontName="Helvetica-Bold", fontSize=16, fillColor=colors.HexColor(BRAND_NAVY)))
        return d

    # ──────────────────────────────────────────────────────────────────────
    # Bill-to + Ship-to row
    # ──────────────────────────────────────────────────────────────────────

    @classmethod
    def _addresses_block(cls, quotation, styles) -> Table:
        customer_name = (quotation.customer_name or "—").strip() or "—"
        customer = getattr(quotation, "customer", None)
        gstin = (getattr(customer, "gst_no", None) or "").strip() if customer else ""
        contact = (getattr(customer, "contact_person", None) or "").strip() if customer else ""
        phone = (getattr(customer, "phone", None) or "").strip() if customer else ""
        email = (getattr(customer, "email", None) or "").strip() if customer else ""
        address = (quotation.billing_address or getattr(customer, "billing_address", "") or "").strip()
        contact = (quotation.contact_name or contact).strip()
        phone = (quotation.contact_phone or phone).strip()
        email = (quotation.contact_email or email).strip()

        bill_to_lines = [Paragraph("BILL TO", styles["card_label"]), Paragraph(cls._escape(customer_name), styles["card_strong"])]
        if address:
            bill_to_lines.append(Paragraph(cls._escape(address).replace("\n", "<br/>"), styles["card_body"]))
        if contact:
            bill_to_lines.append(Paragraph(f"<b>Attn:</b> {cls._escape(contact)}", styles["card_body"]))
        if phone or email:
            bill_to_lines.append(
                Paragraph(
                    f"{cls._escape(phone or '—')}  ·  {cls._escape(email or '—')}",
                    styles["card_body"],
                )
            )
        if gstin:
            bill_to_lines.append(Paragraph(f"<b>GSTIN</b>&nbsp;&nbsp;{cls._escape(gstin)}", styles["pill"]))

        ship_to = (quotation.shipping_address or "").strip()
        ship_to_lines = [Paragraph("SHIP TO", styles["card_label"])]
        ship_to_lines.append(
            Paragraph(
                cls._escape(ship_to).replace("\n", "<br/>") if ship_to else "Address not supplied",
                styles["card_body"],
            )
        )

        bill_cell = Table([[line] for line in bill_to_lines], colWidths=[82 * mm])
        bill_cell.setStyle(cls._card_style())
        ship_cell = Table([[line] for line in ship_to_lines], colWidths=[82 * mm])
        ship_cell.setStyle(cls._card_style())

        outer = Table([[bill_cell, ship_cell]], colWidths=[88 * mm, 88 * mm])
        outer.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        return outer

    # ──────────────────────────────────────────────────────────────────────
    # Meta strip: salesperson · plant · ref · currency · payment terms
    # ──────────────────────────────────────────────────────────────────────

    @classmethod
    def _meta_strip(cls, quotation, styles) -> Table:
        plant = quotation.plant.name if quotation.plant_id else "—"
        currency = quotation.currency or "INR"
        terms_summary = (quotation.payment_terms or quotation.terms or "").strip().split("\n")[0] or "—"
        salesperson = (
            getattr(getattr(quotation, "sent_by", None), "full_name", None)
            or getattr(getattr(quotation, "sent_by", None), "username", None)
            or "—"
        )
        rows = [[
            cls._meta_cell("PLANT", plant, styles),
            cls._meta_cell("SALESPERSON", str(salesperson), styles),
            cls._meta_cell("CURRENCY", currency, styles),
            cls._meta_cell("REFERENCE", quotation.enquiry_reference or quotation.quote_number, styles),
            cls._meta_cell("PAYMENT", terms_summary[:36], styles),
        ]]
        t = Table(rows, colWidths=[35 * mm, 35 * mm, 24 * mm, 34 * mm, 48 * mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(SLATE_50)),
            ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor(SLATE_200)),
            ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor(SLATE_200)),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ]))
        return t

    @classmethod
    def _meta_cell(cls, label, value, styles):
        return Table(
            [[Paragraph(label, styles["meta_label"])], [Paragraph(cls._escape(str(value)), styles["meta_value"])]],
            colWidths=[None],
        )

    # ──────────────────────────────────────────────────────────────────────
    # Line items table
    # ──────────────────────────────────────────────────────────────────────

    @classmethod
    def _line_items_table(cls, quotation, styles, *, customer_view: bool) -> Table:
        header = [
            "#",
            "Product / Specification",
            "Qty",
            "UoM",
            "Rate",
            "Amount",
        ]
        rows = [header]
        for idx, item in enumerate(quotation.items.all(), start=1):
            costing = item.costing_snapshot or {}
            spec = item.spec_snapshot or {}
            geometry = (item.physics_snapshot or {}).get("geometry_snapshot") or {}
            variant_label = getattr(item.sku_variant, "name", "") if getattr(item, "sku_variant_id", None) else ""
            product_label = variant_label or item.line_name or (item.template.name if item.template_id else item.finished_good_type.title())
            base_geometry = item.geometry_snapshot.get("base", {}) if isinstance(item.geometry_snapshot, dict) else {}
            effective_width = geometry.get("effective_width_mm") or base_geometry.get("width_mm") or spec.get("width_mm")
            effective_height = geometry.get("effective_height_mm") or base_geometry.get("height_mm") or spec.get("height_mm")
            variant_code = getattr(item.sku_variant, "code", "") if getattr(item, "sku_variant_id", None) else ""
            governed_variant_code = getattr(getattr(item, "product_variant", None), "code", "") or spec.get("saved_variant_code") or ""
            pm_code = getattr(getattr(item, "product_master", None), "code", "") or spec.get("base_product_master_code") or spec.get("product_master_code") or ""
            style_code = getattr(getattr(item, "pouch_style_master", None), "code", "") or spec.get("pouch_style_code") or ""
            gusset = spec.get("gusset_mm")
            flap = spec.get("flap_mm")
            total_gsm = spec.get("total_gsm") or (item.physics_snapshot or {}).get("total_gsm")
            unit_weight = getattr(item, "unit_weight_g", None) or spec.get("unit_weight_g")
            identity = " · ".join(filter(None, [
                pm_code,
                governed_variant_code or ("Quote-scoped configuration" if item.line_kind == "AD_HOC" else ""),
                style_code,
            ]))
            dimensions = f"{cls._as_text(effective_width)} × {cls._as_text(effective_height)} mm"
            if gusset not in (None, "", 0, "0"):
                dimensions += f" · Gusset {cls._as_text(gusset)} mm"
            if flap not in (None, "", 0, "0"):
                dimensions += f" · Flap {cls._as_text(flap)} mm"
            layers = []
            for layer_index, layer in enumerate(spec.get("layers") or item.layer_snapshot or [], start=1):
                if not isinstance(layer, dict):
                    continue
                material = layer.get("material_code") or layer.get("material_name") or f"L{layer_index}"
                thickness = layer.get("micron") or layer.get("thickness_micron")
                gsm = layer.get("gsm")
                detail = f"L{layer_index} {material}"
                if thickness not in (None, "", 0, "0"):
                    detail += f" {cls._as_text(thickness)}µ"
                if gsm not in (None, "", 0, "0"):
                    detail += f" / {cls._as_text(gsm)} GSM"
                layers.append(detail)
            components = []
            for field, label in (("inks", "Ink"), ("adhesives", "Adhesive"), ("solvents", "Solvent"), ("additives", "Additive"), ("addons", "Add-on")):
                for value in spec.get(field) or []:
                    if isinstance(value, dict):
                        code = value.get("material_code") or value.get("code") or value.get("material_name") or value.get("name")
                        if code:
                            components.append(f"{label}: {code}")
            spec_lines = [identity, dimensions]
            if total_gsm not in (None, "", 0, "0"):
                weight_text = f"Total {cls._as_text(total_gsm)} GSM"
                if unit_weight not in (None, "", 0, "0"):
                    weight_text += f" · {cls._as_text(unit_weight)} g/pc"
                spec_lines.append(weight_text)
            if layers:
                spec_lines.append(" | ".join(layers))
            if components:
                spec_lines.append(" | ".join(components))
            if variant_code:
                spec_lines.insert(0, variant_code)
            cell_para = Paragraph(
                f"<b>{cls._escape(product_label)}</b><br/>"
                f"<font color='{SLATE_500}' size='7.3'>{'<br/>'.join(cls._escape(str(line)) for line in spec_lines if line)}</font>",
                styles["line_body"],
            )
            rate = item.quoted_unit_price or costing.get("unit_price")
            amount = item.quoted_line_total or costing.get("net_total")
            rows.append([
                str(idx),
                cell_para,
                cls._num(item.qty_value),
                item.qty_uom or "—",
                cls._money(rate, quotation.currency),
                cls._money(amount, quotation.currency),
            ])

        if len(rows) == 1:
            rows.append(["", Paragraph("<i>No lines yet — add a line in the workspace.</i>", styles["line_body"]), "", "", "", ""])

        t = Table(
            rows,
            colWidths=[10 * mm, 86 * mm, 18 * mm, 14 * mm, 24 * mm, 30 * mm],
            repeatRows=1,
        )
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(BRAND_NAVY)),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, 0), 8),
            ("ALIGN", (0, 0), (-1, 0), "LEFT"),
            ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
            ("ALIGN", (0, 0), (0, -1), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("FONTSIZE", (0, 1), (-1, -1), 8.5),
            ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
            ("FONTNAME", (4, 1), (5, -1), "Helvetica-Bold"),
            ("TEXTCOLOR", (0, 1), (-1, -1), colors.HexColor(SLATE_700)),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor(SLATE_50)]),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor(SLATE_300)),
            ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor(SLATE_200)),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        return t

    # ──────────────────────────────────────────────────────────────────────
    # Summary card (right-aligned)
    # ──────────────────────────────────────────────────────────────────────

    @classmethod
    def _summary_card(cls, quotation, styles, *, customer_view: bool) -> Table:
        totals = quotation.totals_snapshot or {}
        currency = quotation.currency or "INR"
        rows = []
        subtotal = totals.get("subtotal")
        rows.append(["Subtotal", cls._money(subtotal, currency)])
        discount_amount = float(totals.get("discount_amount") or 0)
        if discount_amount > 0:
            label = "Discount"
            if float(totals.get("discount_pct") or 0) > 0:
                label = f"Discount ({float(totals.get('discount_pct') or 0):g}%)"
            rows.append([label, f"- {cls._money(discount_amount, currency)}"])
        freight = float(totals.get("freight_amount") or 0)
        freight_included = bool(totals.get("freight_included", True))
        if freight > 0 and not freight_included:
            rows.append(["Freight (extra)", cls._money(freight, currency)])
        elif freight > 0 and freight_included:
            rows.append(["Freight", "Included in rate"])
        for charge in (getattr(quotation, "other_charges", None) or []):
            label = str((charge or {}).get("label") or "Charge")
            amount = float((charge or {}).get("amount") or 0)
            if amount > 0:
                rows.append([cls._escape(label), cls._money(amount, currency)])
        rows.append(["Taxable", cls._money(totals.get("taxable_amount") or totals.get("subtotal"), currency)])
        gst_rate = float(totals.get("gst_rate") or 0)
        gst_label = f"GST ({gst_rate:g}%)" if gst_rate else "GST"
        rows.append([gst_label, cls._money(totals.get("tax_total"), currency)])
        rows.append(["GRAND TOTAL", cls._money(totals.get("grand_total"), currency)])
        if not customer_view:
            cost_build = totals.get("cost_build") or {}
            margin_value = cost_build.get("gross_margin_pct")
            if margin_value in (None, ""):
                margin_value = totals.get("margin_percent") or 0
            rows.append(["Est. gross margin", f"{round(float(margin_value), 2)}%"])

        t = Table(rows, colWidths=[42 * mm, 38 * mm])
        t.hAlign = "RIGHT"

        style = [
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor(SLATE_300)),
            ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor(SLATE_200)),
            ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("ALIGN", (1, 0), (1, -1), "RIGHT"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
            ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor(SLATE_700)),
        ]
        # Locate the "GRAND TOTAL" row and emphasise.
        for i, row in enumerate(rows):
            if row[0] == "GRAND TOTAL":
                style.extend([
                    ("BACKGROUND", (0, i), (-1, i), colors.HexColor(BRAND_NAVY)),
                    ("TEXTCOLOR", (0, i), (-1, i), colors.white),
                    ("FONTNAME", (0, i), (-1, i), "Helvetica-Bold"),
                    ("FONTSIZE", (0, i), (-1, i), 11),
                    ("TOPPADDING", (0, i), (-1, i), 6),
                    ("BOTTOMPADDING", (0, i), (-1, i), 6),
                ])
        t.setStyle(TableStyle(style))
        return t

    # ──────────────────────────────────────────────────────────────────────
    # Page 2 — Terms list, bank, signatures
    # ──────────────────────────────────────────────────────────────────────

    @classmethod
    def _terms_list(cls, quotation, styles):
        profile = getattr(quotation, "_company_profile", None)
        raw = (quotation.terms or "").strip() or (getattr(profile, "quote_terms_text", "") or "").strip()
        terms = [line.strip().lstrip("0123456789.-) ").strip() for line in raw.splitlines() if line.strip()]
        if quotation.payment_terms:
            terms.append(f"Payment: {quotation.payment_terms.strip()}")
        if quotation.delivery_terms:
            terms.append(f"Delivery: {quotation.delivery_terms.strip()}")
        items = [
            ListItem(Paragraph(cls._escape(line), styles["body"]), leftIndent=6, value=i + 1)
            for i, line in enumerate(terms)
        ]
        return ListFlowable(items, bulletType="1", bulletFontSize=9, bulletColor=colors.HexColor(BRAND_NAVY), leftIndent=14, bulletIndent=0)

    @classmethod
    def _bank_block(cls, styles, quotation=None) -> Table:
        profile = getattr(quotation, "_company_profile", None) if quotation is not None else None
        bene_name = cls._profile_company_name(quotation) if quotation is not None else cls.COMPANY_NAME
        bank_name = (getattr(profile, "bank_name", "") or "").strip() if profile else ""
        bank_account = (getattr(profile, "bank_account_no", "") or "").strip() if profile else ""
        bank_ifsc = (getattr(profile, "bank_ifsc", "") or "").strip() if profile else ""
        bank_branch = (getattr(profile, "bank_branch", "") or "").strip() if profile else ""
        bank_upi = (getattr(profile, "bank_upi", "") or "").strip() if profile else ""

        rows = [[Paragraph("<b>Beneficiary</b>", styles["body"]), Paragraph(cls._escape(bene_name), styles["body"])]]
        if bank_name:
            rows.append([Paragraph("<b>Bank</b>", styles["body"]), Paragraph(cls._escape(bank_name), styles["body"])])
        if bank_account:
            rows.append([Paragraph("<b>Account</b>", styles["body"]), Paragraph(cls._escape(bank_account), styles["body_mono"])])
        if bank_ifsc:
            rows.append([Paragraph("<b>IFSC</b>", styles["body"]), Paragraph(cls._escape(bank_ifsc), styles["body_mono"])])
        if bank_branch:
            rows.append([Paragraph("<b>Branch</b>", styles["body"]), Paragraph(cls._escape(bank_branch), styles["body"])])
        if bank_upi:
            rows.append([Paragraph("<b>UPI</b>", styles["body"]), Paragraph(cls._escape(bank_upi), styles["body_mono"])])
        if len(rows) == 1:
            rows.append([Paragraph("<i>Bank details</i>", styles["body"]), Paragraph("<i>To be communicated separately.</i>", styles["body"])])
        t = Table(rows, colWidths=[32 * mm, 130 * mm])
        t.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor(SLATE_200)),
            ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor(SLATE_200)),
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(SLATE_50)),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        return t

    @classmethod
    def _signature_block(cls, quotation, styles) -> Table:
        company_name = cls._profile_company_name(quotation)
        sig_name = cls._profile_value(quotation, "authorised_signatory_name", "")
        sig_role = cls._profile_value(quotation, "authorised_signatory_role", "Authorised Signatory")
        sig_caption_text = sig_role
        if sig_name:
            sig_caption_text = f"{sig_name}<br/>{sig_role}"
        left = Table(
            [
                [Paragraph("FOR " + cls._escape(company_name), styles["sig_label"])],
                [Spacer(1, 14 * mm)],
                [Paragraph(sig_caption_text, styles["sig_caption"])],
                [Paragraph("Date: ____________________", styles["sig_caption"])],
            ],
            colWidths=[85 * mm],
        )
        right = Table(
            [
                [Paragraph("ACCEPTED BY CUSTOMER", styles["sig_label"])],
                [Spacer(1, 14 * mm)],
                [Paragraph("Authorised Signatory / Seal", styles["sig_caption"])],
                [Paragraph("Date: ____________________", styles["sig_caption"])],
            ],
            colWidths=[85 * mm],
        )
        for tbl in (left, right):
            tbl.setStyle(TableStyle([
                ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor(SLATE_300)),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LINEBELOW", (0, 1), (-1, 1), 0.4, colors.HexColor(SLATE_500)),
            ]))
        outer = Table([[left, right]], colWidths=[88 * mm, 88 * mm])
        outer.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ]))
        return outer

    # ──────────────────────────────────────────────────────────────────────
    # Styles
    # ──────────────────────────────────────────────────────────────────────

    @classmethod
    def _styles(cls):
        base = getSampleStyleSheet()
        for name in [
            "wordmark", "tagline", "address", "address_mono",
            "stamp_eyebrow", "stamp_number", "stamp_meta",
            "section", "section_big", "body", "body_mono", "amount_words",
            "card_label", "card_strong", "card_body", "pill",
            "meta_label", "meta_value", "line_body",
            "sig_label", "sig_caption", "muted",
        ]:
            if name in base.byName:
                del base.byName[name]
        base.add(ParagraphStyle("wordmark", parent=base["BodyText"], fontName="Helvetica-Bold", fontSize=14, leading=16, textColor=colors.HexColor(BRAND_NAVY), spaceAfter=0))
        base.add(ParagraphStyle("tagline", parent=base["BodyText"], fontName="Helvetica-Oblique", fontSize=8.5, leading=10, textColor=colors.HexColor(BRAND_RED), spaceAfter=2))
        base.add(ParagraphStyle("address", parent=base["BodyText"], fontName="Helvetica", fontSize=8, leading=10, textColor=colors.HexColor(SLATE_700), spaceAfter=0))
        base.add(ParagraphStyle("address_mono", parent=base["BodyText"], fontName="Helvetica", fontSize=7.5, leading=9.5, textColor=colors.HexColor(SLATE_500), spaceAfter=0))
        base.add(ParagraphStyle("stamp_eyebrow", parent=base["BodyText"], fontName="Helvetica-Bold", fontSize=7, leading=9, textColor=colors.HexColor(BRAND_NAVY), spaceAfter=0))
        base.add(ParagraphStyle("stamp_number", parent=base["BodyText"], fontName="Helvetica-Bold", fontSize=14, leading=17, textColor=colors.HexColor(BRAND_NAVY_DEEP), spaceAfter=2))
        base.add(ParagraphStyle("stamp_meta", parent=base["BodyText"], fontName="Helvetica", fontSize=8, leading=10, textColor=colors.HexColor(SLATE_700), spaceAfter=0))
        base.add(ParagraphStyle("section", parent=base["BodyText"], fontName="Helvetica-Bold", fontSize=9, leading=11, textColor=colors.HexColor(BRAND_NAVY), spaceBefore=2, spaceAfter=3))
        base.add(ParagraphStyle("section_big", parent=base["BodyText"], fontName="Helvetica-Bold", fontSize=12, leading=15, textColor=colors.HexColor(BRAND_NAVY), spaceAfter=4))
        base.add(ParagraphStyle("body", parent=base["BodyText"], fontName="Helvetica", fontSize=9, leading=12, textColor=colors.HexColor(SLATE_700)))
        base.add(ParagraphStyle("body_mono", parent=base["BodyText"], fontName="Helvetica", fontSize=9, leading=11, textColor=colors.HexColor(SLATE_700)))
        base.add(ParagraphStyle("amount_words", parent=base["BodyText"], fontName="Helvetica", fontSize=9, leading=12, textColor=colors.HexColor(BRAND_NAVY)))
        base.add(ParagraphStyle("card_label", parent=base["BodyText"], fontName="Helvetica-Bold", fontSize=7, leading=9, textColor=colors.HexColor(BRAND_NAVY), spaceAfter=2))
        base.add(ParagraphStyle("card_strong", parent=base["BodyText"], fontName="Helvetica-Bold", fontSize=11, leading=13, textColor=colors.HexColor(SLATE_900), spaceAfter=1))
        base.add(ParagraphStyle("card_body", parent=base["BodyText"], fontName="Helvetica", fontSize=8.5, leading=10.5, textColor=colors.HexColor(SLATE_700), spaceAfter=1))
        base.add(ParagraphStyle("pill", parent=base["BodyText"], fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=colors.HexColor(BRAND_NAVY), backColor=colors.HexColor(SOFT_NAVY), borderPadding=(2, 4, 2, 4), spaceAfter=0))
        base.add(ParagraphStyle("meta_label", parent=base["BodyText"], fontName="Helvetica-Bold", fontSize=6.5, leading=8, textColor=colors.HexColor(SLATE_500), spaceAfter=1))
        base.add(ParagraphStyle("meta_value", parent=base["BodyText"], fontName="Helvetica-Bold", fontSize=9, leading=11, textColor=colors.HexColor(SLATE_900), spaceAfter=0))
        base.add(ParagraphStyle("line_body", parent=base["BodyText"], fontName="Helvetica", fontSize=8.5, leading=11, textColor=colors.HexColor(SLATE_900)))
        base.add(ParagraphStyle("sig_label", parent=base["BodyText"], fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=colors.HexColor(BRAND_NAVY), spaceAfter=2))
        base.add(ParagraphStyle("sig_caption", parent=base["BodyText"], fontName="Helvetica", fontSize=8, leading=10, textColor=colors.HexColor(SLATE_500), spaceAfter=0))
        base.add(ParagraphStyle("muted", parent=base["BodyText"], fontName="Helvetica", fontSize=8, leading=10, textColor=colors.HexColor(SLATE_500)))
        return base

    @classmethod
    def _card_style(cls):
        return TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor(SLATE_300)),
            ("BACKGROUND", (0, 0), (-1, -1), colors.white),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ])

    @classmethod
    def _table_style(cls, *, header: bool = False, striped: bool = False) -> TableStyle:
        commands = [
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor(SLATE_300)),
            ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor(SLATE_200)),
            ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
            ("FONTSIZE", (0, 0), (-1, -1), 8.5),
            ("LEADING", (0, 0), (-1, -1), 10),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]
        if header:
            commands.extend([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(BRAND_NAVY)),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor(SLATE_50)]),
            ])
        elif striped:
            commands.append(("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, colors.HexColor(SLATE_50)]))
        return TableStyle(commands)

    # ──────────────────────────────────────────────────────────────────────
    # Helpers
    # ──────────────────────────────────────────────────────────────────────

    @staticmethod
    def _num(value):
        if value in (None, ""):
            return "—"
        try:
            n = float(value)
        except Exception:
            return str(value)
        if n == int(n):
            return f"{int(n):,}"
        return f"{n:,.3f}"

    @staticmethod
    def _money(value, currency="INR"):
        amount = float(value or 0)
        if (currency or "INR").upper() == "INR":
            # The built-in ReportLab Helvetica family has no rupee glyph.
            # Use the ISO label so every deployed PDF renders deterministically
            # instead of showing a client-facing replacement square.
            return f"INR {QuotationPDFService.format_inr(amount)}"
        return f"{currency} {amount:,.2f}"

    @staticmethod
    def format_inr(amount: float) -> str:
        """Indian-comma format: 1,42,250.00."""
        try:
            n = float(amount)
        except Exception:
            return "0.00"
        negative = n < 0
        n = abs(n)
        whole = int(n)
        frac = round((n - whole) * 100)
        if frac == 100:
            whole += 1
            frac = 0
        s = str(whole)
        if len(s) <= 3:
            grouped = s
        else:
            last3 = s[-3:]
            rest = s[:-3]
            chunks = []
            while len(rest) > 2:
                chunks.insert(0, rest[-2:])
                rest = rest[:-2]
            if rest:
                chunks.insert(0, rest)
            grouped = ",".join(chunks) + "," + last3
        out = f"{grouped}.{frac:02d}"
        return f"-{out}" if negative else out

    @staticmethod
    def num_to_indian_words(amount: float) -> str:
        try:
            from num2words import num2words  # type: ignore

            rupees = int(amount)
            paise = round((amount - rupees) * 100)
            words = num2words(rupees, lang="en_IN").title()
            tail = f" and {num2words(paise, lang='en_IN').title()} Paise" if paise else ""
            return f"Rupees {words}{tail} only"
        except Exception:
            rupees = int(amount)
            return f"Rupees {rupees:,} only"

    @staticmethod
    def _as_text(value) -> str:
        if value in (None, ""):
            return "—"
        try:
            n = float(value)
            if n == int(n):
                return f"{int(n)}"
            return f"{n:,.1f}"
        except Exception:
            return str(value)

    @staticmethod
    def _escape(value) -> str:
        return (
            str(value)
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        )
