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
            topMargin=16 * mm,
            bottomMargin=14 * mm,
            leftMargin=14 * mm,
            rightMargin=14 * mm,
            pageCompression=0,
        )
        styles = cls._styles()
        story = []

        legal = getattr(getattr(quotation.plant, "legal_profile", None), "__dict__", {}) if quotation.plant_id else {}
        header_lines = [cls.COMPANY_NAME]
        if legal.get("legal_name"):
            header_lines.append(str(legal["legal_name"]))
        if legal.get("gstin"):
            header_lines.append(f"GSTIN: {legal['gstin']}")
        if legal.get("address"):
            header_lines.append(str(legal["address"]))
        if legal.get("contact_phone") or legal.get("contact_email"):
            header_lines.append(
                f"Contact: {legal.get('contact_phone') or '-'} | {legal.get('contact_email') or '-'}"
            )

        story.append(Paragraph("Quotation", styles["hero"]))
        for line in header_lines:
            story.append(Paragraph(cls._escape(line), styles["muted"]))
        story.append(Spacer(1, 6 * mm))

        meta_table = Table(
            [
                ["Quote No", quotation.quote_number, "Status", quotation.get_status_display()],
                ["Customer", quotation.customer_name, "Valid Until", quotation.valid_until.isoformat() if quotation.valid_until else "-"],
                ["Plant", quotation.plant.name if quotation.plant_id else "-", "Generated", timezone.now().strftime("%d-%b-%Y %H:%M")],
                ["Currency", quotation.currency, "Converted Order", getattr(quotation.converted_sales_order, "order_number", "-") or "-"],
            ],
            colWidths=[28 * mm, 62 * mm, 30 * mm, 52 * mm],
        )
        meta_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), colors.white),
                    ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#CBD5E1")),
                    ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#E2E8F0")),
                    ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor("#0F172A")),
                    ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
                    ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                    ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                    ("LEADING", (0, 0), (-1, -1), 10),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
                ]
            )
        )
        story.append(meta_table)
        story.append(Spacer(1, 6 * mm))

        line_rows = [["Line", "Product", "Qty", "Basis", "Unit Price", "Line Total"]]
        for idx, item in enumerate(quotation.items.all(), start=1):
            costing = item.costing_snapshot or {}
            qty = f"{item.qty_value} {item.qty_uom}"
            product = item.line_name or (item.template.name if item.template_id else item.finished_good_type.title())
            line_rows.append(
                [
                    str(idx),
                    product,
                    qty,
                    item.price_basis,
                    cls._money(costing.get("unit_price"), quotation.currency),
                    cls._money(costing.get("net_total"), quotation.currency),
                ]
            )

        line_table = Table(line_rows, colWidths=[12 * mm, 67 * mm, 26 * mm, 18 * mm, 28 * mm, 28 * mm])
        line_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F172A")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                    ("LEADING", (0, 0), (-1, -1), 10),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
                    ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#CBD5E1")),
                    ("INNERGRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#E2E8F0")),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("ALIGN", (2, 1), (-1, -1), "RIGHT"),
                ]
            )
        )
        story.append(line_table)
        story.append(Spacer(1, 5 * mm))

        for idx, item in enumerate(quotation.items.all(), start=1):
            costing = item.costing_snapshot or {}
            preview = item.physics_snapshot or {}
            bom = item.bom_snapshot or {}
            components = (bom.get("planning_lines") or [])[:4]
            component_label = ", ".join(
                f"{row.get('material_name') or row.get('material_code')}: {row.get('planned_issue_qty') or row.get('theoretical_qty')} {row.get('uom') or 'KG'}"
                for row in components
            ) or "No BOM lines resolved"
            line_title = item.line_name or (item.template.name if item.template_id else f"{item.finished_good_type.title()} line {idx}")
            detail_text = (
                f"<b>{cls._escape(line_title)}</b><br/>"
                f"{item.finished_good_type} | Qty {item.qty_value} {item.qty_uom} | "
                f"Weight {item.total_weight_kg} KG | Unit {cls._money(costing.get('unit_price'), quotation.currency)} | "
                f"Margin {round(float(costing.get('margin_percent') or 0), 2)}%<br/>"
                f"Physics: area {round(float(((preview.get('geometry_snapshot') or {}).get('area_m2') or 0)), 4)} m2 | "
                f"width {round(float(((preview.get('geometry_snapshot') or {}).get('effective_width_mm') or 0)), 2)} mm<br/>"
                f"Top materials: {cls._escape(component_label)}"
            )
            story.append(Paragraph(detail_text, styles["body"]))
            story.append(Spacer(1, 3 * mm))

        totals = quotation.totals_snapshot or {}
        totals_table = Table(
            [
                ["Subtotal", cls._money(totals.get("subtotal"), quotation.currency)],
                ["Tax", cls._money(totals.get("tax_total"), quotation.currency)],
                ["Grand Total", cls._money(totals.get("grand_total"), quotation.currency)],
                ["Margin", f"{round(float(totals.get('margin_percent') or 0), 2)}%"],
            ],
            colWidths=[42 * mm, 38 * mm],
        )
        totals_table.hAlign = "RIGHT"
        totals_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F8FAFC")),
                    ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#CBD5E1")),
                    ("INNERGRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#E2E8F0")),
                    ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 9),
                    ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                ]
            )
        )
        story.append(Spacer(1, 2 * mm))
        story.append(totals_table)
        story.append(Spacer(1, 5 * mm))

        if quotation.terms:
            story.append(Paragraph("Terms", styles["section"]))
            story.append(Paragraph(cls._escape(quotation.terms).replace("\n", "<br/>"), styles["body"]))
            story.append(Spacer(1, 3 * mm))

        if quotation.notes:
            story.append(Paragraph("Notes", styles["section"]))
            story.append(Paragraph(cls._escape(quotation.notes).replace("\n", "<br/>"), styles["body"]))

        doc.build(story)
        return buffer.getvalue()

    @staticmethod
    def _styles():
        base = getSampleStyleSheet()
        base.add(
            ParagraphStyle(
                name="hero",
                parent=base["Heading1"],
                fontName="Helvetica-Bold",
                fontSize=22,
                leading=26,
                textColor=colors.HexColor("#0F172A"),
                spaceAfter=4,
            )
        )
        base.add(
            ParagraphStyle(
                name="section",
                parent=base["Heading3"],
                fontName="Helvetica-Bold",
                fontSize=11,
                leading=14,
                textColor=colors.HexColor("#1E293B"),
                spaceAfter=3,
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
                fontSize=8,
                leading=10,
                textColor=colors.HexColor("#64748B"),
            )
        )
        return base

    @staticmethod
    def _money(value, currency: str) -> str:
        prefix = "₹" if str(currency or "INR").upper() == "INR" else f"{currency} "
        try:
            amount = float(value or 0)
        except Exception:
            amount = 0.0
        return f"{prefix}{amount:,.2f}"

    @staticmethod
    def _escape(value: str) -> str:
        return (
            str(value or "")
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        )
