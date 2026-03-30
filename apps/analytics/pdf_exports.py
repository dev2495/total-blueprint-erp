from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from typing import Iterable

from django.utils import timezone

from apps.analytics.report_delivery import _safe_number
from apps.analytics.reports_service import ReportService
from apps.analytics.services import ReportingService

try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.graphics.shapes import Drawing, Rect, String
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
except Exception:  # pragma: no cover
    colors = None
    A4 = None
    ParagraphStyle = None
    getSampleStyleSheet = None
    mm = None
    Drawing = None
    Rect = None
    String = None
    Paragraph = None
    SimpleDocTemplate = None
    Spacer = None
    Table = None
    TableStyle = None


@dataclass
class RenderedAnalyticsPDF:
    file_name: str
    content: bytes


class AnalyticsPDFExportService:
    COMPANY_NAME = "TOTAL POLY PRINT ERP"

    @classmethod
    def export_report_tab_pdf(cls, tab: str, filters: dict | None = None) -> RenderedAnalyticsPDF:
        filters = dict(filters or {})
        payload = ReportService.get_report_tab(tab, filters)
        title = cls._report_title(tab)
        return RenderedAnalyticsPDF(
            file_name=f"{tab}-report-{timezone.localdate().isoformat()}.pdf",
            content=cls._build_pdf_bytes(title=title, subtitle="Filtered analytics export", filters=filters, payload=payload),
        )

    @classmethod
    def export_dashboard_summary_pdf(cls, filters: dict | None = None) -> RenderedAnalyticsPDF:
        filters = dict(filters or {})
        payload = ReportingService.get_dashboard_summary(filters)
        return RenderedAnalyticsPDF(
            file_name=f"reports-hub-{timezone.localdate().isoformat()}.pdf",
            content=cls._build_pdf_bytes(
                title="Reports Hub Summary",
                subtitle="Cross-functional KPI and summary export",
                filters=filters,
                payload=payload,
            ),
        )

    @classmethod
    def _build_pdf_bytes(cls, *, title: str, subtitle: str, filters: dict, payload: dict) -> bytes:
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
        story = []
        styles = cls._styles()

        story.append(Paragraph(cls.COMPANY_NAME, styles["eyebrow"]))
        story.append(Paragraph(title, styles["hero"]))
        story.append(Paragraph(subtitle, styles["muted"]))
        story.append(Paragraph(f"Generated {timezone.localtime().strftime('%d-%b-%Y %H:%M')}", styles["muted"]))
        story.append(Spacer(1, 5 * mm))

        if filters:
            filter_rows = [[key.replace("_", " ").title(), cls._as_text(value)] for key, value in filters.items() if value not in (None, "", "ALL")]
            if filter_rows:
                story.append(Paragraph("Filters", styles["section"]))
                filter_table = Table(filter_rows, colWidths=[48 * mm, 120 * mm])
                filter_table.setStyle(cls._table_style(striped=True))
                story.append(filter_table)
                story.append(Spacer(1, 4 * mm))

        kpi_pairs = cls._extract_kpis(payload)
        if kpi_pairs:
            story.append(Paragraph("KPI Summary", styles["section"]))
            rows = []
            for chunk_start in range(0, len(kpi_pairs), 3):
                chunk = kpi_pairs[chunk_start : chunk_start + 3]
                rows.append([cls._metric_html(label, value) for label, value in chunk])
            table = Table(rows, colWidths=[56 * mm, 56 * mm, 56 * mm])
            table.setStyle(
                TableStyle(
                    [
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("LEFTPADDING", (0, 0), (-1, -1), 0),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                        ("TOPPADDING", (0, 0), (-1, -1), 0),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                    ]
                )
            )
            story.append(table)
            story.append(Spacer(1, 4 * mm))

        chart_rows = cls._extract_chart_rows(payload)
        if chart_rows and Drawing is not None:
            story.append(Paragraph("Trend Snapshot", styles["section"]))
            story.append(cls._bar_chart(chart_rows))
            story.append(Spacer(1, 4 * mm))

        rows = cls._extract_rows(payload)
        if rows:
            story.append(Paragraph("Core Table", styles["section"]))
            headers = list(rows[0].keys())[:6]
            table_rows = [headers]
            for row in rows[:16]:
                table_rows.append([cls._as_text(row.get(header)) for header in headers])
            table = Table(table_rows, colWidths=[28 * mm] * len(headers))
            table.setStyle(cls._table_style(header=True))
            story.append(table)
            story.append(Spacer(1, 4 * mm))

        warnings = payload.get("warnings") or []
        if warnings:
            story.append(Paragraph("Warnings", styles["section"]))
            for warning in warnings:
                story.append(Paragraph(f"• {cls._escape(cls._as_text(warning))}", styles["body"]))

        doc.build(story)
        return buffer.getvalue()

    @classmethod
    def _extract_kpis(cls, payload: dict) -> list[tuple[str, str]]:
        values: list[tuple[str, str]] = []
        for bucket in ("summary", "kpis"):
            source = payload.get(bucket)
            if isinstance(source, dict):
                for key, value in source.items():
                    if isinstance(value, (dict, list)):
                        continue
                    values.append((key.replace("_", " ").title(), cls._as_text(value)))
        return values[:9]

    @classmethod
    def _extract_chart_rows(cls, payload: dict) -> list[dict]:
        for key in ("series", "trend", "monthly_trend", "daily_trend"):
            rows = payload.get(key)
            if isinstance(rows, list) and rows:
                return [row for row in rows if isinstance(row, dict)]
        charts = payload.get("charts") or {}
        for key in ("trend", "distribution"):
            rows = charts.get(key)
            if isinstance(rows, list) and rows:
                return [row for row in rows if isinstance(row, dict)]
        return []

    @classmethod
    def _extract_rows(cls, payload: dict) -> list[dict]:
        for key in ("rows", "pipeline", "top_customers", "customer_margin", "breakdown"):
            rows = payload.get(key)
            if isinstance(rows, list) and rows:
                return [row for row in rows if isinstance(row, dict)]
        return []

    @classmethod
    def _bar_chart(cls, rows: list[dict]):
        label_key = "date" if "date" in rows[0] else "name" if "name" in rows[0] else next(iter(rows[0].keys()))
        value_key = next((key for key in ("value", "count", "revenue", "cost", "margin", "created", "completed") if key in rows[0]), None)
        if not value_key:
            candidates = [key for key, value in rows[0].items() if isinstance(value, (int, float))]
            value_key = candidates[0] if candidates else None
        if not value_key:
            return Spacer(1, 0)

        drawing = Drawing(180 * mm, 48 * mm)
        max_value = max((_safe_number(row.get(value_key)) for row in rows[:7]), default=0) or 1
        y = 42 * mm
        for row in rows[:7]:
            label = cls._as_text(row.get(label_key))[:16]
            value = _safe_number(row.get(value_key))
            width = 110 * mm * (value / max_value)
            drawing.add(String(0, y + 1, label, fontName="Helvetica-Bold", fontSize=7, fillColor=colors.HexColor("#475569")))
            drawing.add(Rect(48 * mm, y, 115 * mm, 3.6 * mm, rx=1.6 * mm, ry=1.6 * mm, fillColor=colors.HexColor("#E2E8F0"), strokeColor=None))
            drawing.add(Rect(48 * mm, y, max(4, width), 3.6 * mm, rx=1.6 * mm, ry=1.6 * mm, fillColor=colors.HexColor("#4F46E5"), strokeColor=None))
            drawing.add(String(168 * mm, y + 1, cls._as_text(value), fontName="Helvetica-Bold", fontSize=7, fillColor=colors.HexColor("#0F172A"), textAnchor="end"))
            y -= 6.4 * mm
        return drawing

    @classmethod
    def _table_style(cls, *, header: bool = False, striped: bool = False) -> TableStyle:
        commands = [
            ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#CBD5E1")),
            ("INNERGRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#E2E8F0")),
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
            commands.append(("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]))
        return TableStyle(commands)

    @classmethod
    def _metric_html(cls, label: str, value: str) -> Paragraph:
        return Paragraph(
            f'<para backColor="#F8FAFC" borderColor="#CBD5E1" borderWidth="0.6" borderPadding="8">'
            f'<font size="7" color="#64748B"><b>{cls._escape(label.upper())}</b></font><br/>'
            f'<font size="13" color="#0F172A"><b>{cls._escape(value)}</b></font></para>',
            cls._styles()["body"],
        )

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
                fontSize=20,
                leading=23,
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
                leading=13,
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
                leading=10.5,
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

    @staticmethod
    def _report_title(tab: str) -> str:
        return f"{str(tab or '').replace('-', ' ').replace('_', ' ').title()} Report"

    @staticmethod
    def _as_text(value) -> str:
        if value in (None, ""):
            return "-"
        if isinstance(value, bool):
            return "Yes" if value else "No"
        if isinstance(value, float):
            return f"{value:,.2f}"
        return str(value)

    @staticmethod
    def _escape(value: str) -> str:
        return (
            str(value)
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        )
