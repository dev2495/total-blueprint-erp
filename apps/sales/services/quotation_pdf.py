from __future__ import annotations

from io import BytesIO

from django.utils import timezone

try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
except Exception:  # pragma: no cover - exercised by runtime dependency check
    colors = None
    A4 = None
    ParagraphStyle = None
    getSampleStyleSheet = None
    mm = None
    Paragraph = None
    SimpleDocTemplate = None
    Spacer = None
    Table = None
    TableStyle = None


class QuotationPDFService:
    COMPANY_NAME = "TOTAL POLY PRINT ERP"

    @classmethod
    def render_pdf_bytes(cls, quotation) -> bytes:
        if SimpleDocTemplate is None or Paragraph is None:
            raise RuntimeError("PDF engine unavailable: reportlab is not installed.")

        buffer = BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=A4,
            topMargin=14 * mm,
            bottomMargin=14 * mm,
            leftMargin=14 * mm,
            rightMargin=14 * mm,
            pageCompression=0,
        )
        styles = cls._styles()
        story = []

        legal = getattr(getattr(quotation.plant, "legal_profile", None), "__dict__", {}) if quotation.plant_id else {}
        story.append(Paragraph(cls.COMPANY_NAME, styles["eyebrow"]))
        story.append(Paragraph("Customer Quotation", styles["hero"]))
        story.append(
            Paragraph(
                "System costing remains estimated. The quoted sell price shown here is the commercial price saved by sales.",
                styles["muted"],
            )
        )
        story.append(Spacer(1, 4 * mm))

        header_rows = [
            ["Quote Number", quotation.quote_number, "Status", quotation.get_status_display()],
            ["Customer", quotation.customer_name or "-", "Valid Until", quotation.valid_until.isoformat() if quotation.valid_until else "-"],
            ["Plant", quotation.plant.name if quotation.plant_id else "-", "Generated", timezone.now().strftime("%d-%b-%Y %H:%M")],
            ["Currency", quotation.currency or "INR", "Converted Order", getattr(quotation.converted_sales_order, "order_number", "-") or "-"],
        ]
        header_table = Table(header_rows, colWidths=[34 * mm, 60 * mm, 34 * mm, 46 * mm])
        header_table.setStyle(cls._table_style(striped=True))
        story.append(header_table)
        story.append(Spacer(1, 5 * mm))

        if legal.get("legal_name") or legal.get("gstin") or legal.get("address"):
            story.append(Paragraph("Issuing Legal Entity", styles["section"]))
            legal_lines = [legal.get("legal_name") or cls.COMPANY_NAME]
            if legal.get("gstin"):
                legal_lines.append(f"GSTIN: {legal['gstin']}")
            if legal.get("address"):
                legal_lines.append(str(legal["address"]))
            if legal.get("contact_phone") or legal.get("contact_email"):
                legal_lines.append(f"Contact: {legal.get('contact_phone') or '-'} | {legal.get('contact_email') or '-'}")
            for line in legal_lines:
                story.append(Paragraph(cls._escape(line), styles["body"]))
            story.append(Spacer(1, 4 * mm))

        line_rows = [[
            "Line",
            "Product / Specification",
            "Quantity",
            "Unit Price",
            "Line Total",
        ]]
        for idx, item in enumerate(quotation.items.all(), start=1):
            costing = item.costing_snapshot or {}
            geometry = (item.physics_snapshot or {}).get("geometry_snapshot") or {}
            variant_label = getattr(item.sku_variant, "name", "") if getattr(item, "sku_variant_id", None) else ""
            product_label = variant_label or item.line_name or (item.template.name if item.template_id else item.finished_good_type.title())
            base_geometry = item.geometry_snapshot.get("base", {}) if isinstance(item.geometry_snapshot, dict) else {}
            effective_width = geometry.get("effective_width_mm") or base_geometry.get("width_mm")
            effective_height = geometry.get("effective_height_mm") or base_geometry.get("height_mm")
            variant_code = getattr(item.sku_variant, "code", "") if getattr(item, "sku_variant_id", None) else ""
            spec_line = (
                f"{variant_code + ' · ' if variant_code else ''}{item.finished_good_type.title()} | "
                f"{cls._as_text(effective_width)} mm × "
                f"{cls._as_text(effective_height)} mm"
            )
            line_rows.append(
                [
                    str(idx),
                    Paragraph(f"<b>{cls._escape(product_label)}</b><br/>{cls._escape(spec_line)}", styles["body"]),
                    f"{item.qty_value} {item.qty_uom}",
                    cls._money(item.quoted_unit_price or costing.get("unit_price"), quotation.currency),
                    cls._money(item.quoted_line_total or costing.get("net_total"), quotation.currency),
                ]
            )
        line_table = Table(line_rows, colWidths=[12 * mm, 92 * mm, 28 * mm, 28 * mm, 28 * mm], repeatRows=1)
        line_table.setStyle(cls._table_style(header=True))
        story.append(Paragraph("Commercial Lines", styles["section"]))
        story.append(line_table)
        story.append(Spacer(1, 4 * mm))

        story.append(
            Paragraph(
                "Pricing guidance inside the ERP remains estimated. The commercial prices shown in this document are the values saved by sales.",
                styles["muted"],
            )
        )
        story.append(Spacer(1, 4 * mm))

        totals = quotation.totals_snapshot or {}
        summary_table = Table(
            [
                ["Subtotal", cls._money(totals.get("subtotal"), quotation.currency)],
                ["Tax", cls._money(totals.get("tax_total"), quotation.currency)],
                ["Grand Total", cls._money(totals.get("grand_total"), quotation.currency)],
                ["Estimated Margin", f"{round(float(totals.get('margin_percent') or 0), 2)}%"],
            ],
            colWidths=[48 * mm, 36 * mm],
        )
        summary_table.hAlign = "RIGHT"
        summary_table.setStyle(cls._table_style(striped=True))
        story.append(Paragraph("Commercial Summary", styles["section"]))
        story.append(summary_table)
        story.append(Spacer(1, 4 * mm))

        if quotation.terms:
            story.append(Paragraph("Terms", styles["section"]))
            story.append(Paragraph(cls._escape(quotation.terms).replace("\n", "<br/>"), styles["body"]))
            story.append(Spacer(1, 3 * mm))

        if quotation.notes:
            story.append(Paragraph("Notes", styles["section"]))
            story.append(Paragraph(cls._escape(quotation.notes).replace("\n", "<br/>"), styles["body"]))

        doc.build(story)
        return buffer.getvalue()

    @classmethod
    def _styles(cls):
        base = getSampleStyleSheet()
        base.add(
            ParagraphStyle(
                name="eyebrow",
                parent=base["BodyText"],
                fontName="Helvetica-Bold",
                fontSize=8,
                leading=10,
                textColor=colors.HexColor("#4F46E5"),
                spaceAfter=2,
            )
        )
        base.add(
            ParagraphStyle(
                name="hero",
                parent=base["Heading1"],
                fontName="Helvetica-Bold",
                fontSize=22,
                leading=26,
                textColor=colors.HexColor("#0F172A"),
                spaceAfter=2,
            )
        )
        base.add(
            ParagraphStyle(
                name="section",
                parent=base["Heading3"],
                fontName="Helvetica-Bold",
                fontSize=11,
                leading=14,
                textColor=colors.HexColor("#0F172A"),
                spaceAfter=4,
            )
        )
        base.add(
            ParagraphStyle(
                name="body",
                parent=base["BodyText"],
                fontName="Helvetica",
                fontSize=8.5,
                leading=11,
                textColor=colors.HexColor("#334155"),
            )
        )
        base.add(
            ParagraphStyle(
                name="muted",
                parent=base["BodyText"],
                fontName="Helvetica",
                fontSize=8.5,
                leading=10.5,
                textColor=colors.HexColor("#64748B"),
            )
        )
        return base

    @classmethod
    def _table_style(cls, *, header: bool = False, striped: bool = False) -> TableStyle:
        commands = [
            ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#CBD5E1")),
            ("INNERGRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#E2E8F0")),
            ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
            ("FONTSIZE", (0, 0), (-1, -1), 8.5),
            ("LEADING", (0, 0), (-1, -1), 10),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]
        if header:
            commands.extend(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F172A")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
                ]
            )
        elif striped:
            commands.extend(
                [
                    ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
                    ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                    ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
                ]
            )
        return TableStyle(commands)

    @staticmethod
    def _money(value, currency="INR"):
        amount = float(value or 0)
        prefix = "₹" if (currency or "INR").upper() == "INR" else f"{currency} "
        return f"{prefix}{amount:,.2f}"

    @staticmethod
    def _as_text(value) -> str:
        if value in (None, ""):
            return "-"
        if isinstance(value, float):
            return f"{value:,.3f}"
        return str(value)

    @staticmethod
    def _escape(value: str) -> str:
        return (
            str(value)
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        )
