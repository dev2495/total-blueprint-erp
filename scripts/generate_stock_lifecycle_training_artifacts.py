#!/usr/bin/env python3
"""Generate stock lifecycle SVG and PDF training artifacts."""

from __future__ import annotations

from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from svglib.svglib import svg2rlg


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "docs" / "user-guides" / "artifacts"
SVG = OUT_DIR / "stock-lifecycle-flow-example.svg"
PDF = OUT_DIR / "stock-lifecycle-operator-guide.pdf"


def box(x: int, y: int, w: int, h: int, fill: str, stroke: str, title: str, body: list[str]) -> str:
    items = [
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="18" fill="{fill}" stroke="{stroke}" stroke-width="2"/>',
        f'<text x="{x + 20}" y="{y + 34}" class="box-title">{escape(title)}</text>',
    ]
    for idx, text in enumerate(body):
        items.append(f'<text x="{x + 20}" y="{y + 62 + idx * 22}" class="box-copy">{escape(text)}</text>')
    return "\n".join(items)


def arrow(x1: int, y1: int, x2: int, y2: int, label: str) -> str:
    mx = (x1 + x2) // 2
    my = (y1 + y2) // 2
    return (
        f'<path d="M{x1} {y1} L{x2} {y2}" class="arrow"/>'
        f'<rect x="{mx - 62}" y="{my - 17}" width="124" height="23" rx="11" fill="#fff" stroke="#dbe3ef"/>'
        f'<text x="{mx}" y="{my}" class="arrow-label">{escape(label)}</text>'
    )


def build_svg() -> str:
    boxes = [
        box(60, 150, 250, 145, "#ecfdf5", "#4fbd84", "1. Live stock", ["Bulk by material + code", "Rolls by label + stock form", "Packaging by SKU + location"]),
        box(380, 150, 260, 145, "#eef2ff", "#6366f1", "2. Physical count", ["Plant, location, class, item", "Roll form or granule code", "Only entered rows post"]),
        box(710, 150, 260, 145, "#fff7ed", "#fb923c", "3. Variance post", ["2 percent needs reason", "Short creates consumption", "Excess creates count gain"]),
        box(1040, 150, 270, 145, "#fdf2f8", "#db2777", "4. Month close", ["Capture month-end snapshot", "Keep posted count proof", "No FY lock here"]),
        box(380, 410, 260, 145, "#f8fafc", "#64748b", "Audit history", ["Scope label preserved", "Posted sheets immutable", "Draft blockers visible"]),
        box(710, 410, 260, 145, "#f0f9ff", "#0ea5e9", "Stock card proof", ["Opening + movement", "Material and FY drill", "Source document references"]),
        box(1040, 410, 270, 145, "#f5f3ff", "#8b5cf6", "FY close", ["Clear blockers", "Lock annual FY", "Create next opening"]),
    ]
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1380" height="740" viewBox="0 0 1380 740">
<defs>
<marker id="arrowhead" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#0f172a"/></marker>
<style>
.title {{ font: 800 42px Arial, sans-serif; fill:#0f172a; }}
.subtitle {{ font: 600 18px Arial, sans-serif; fill:#475569; }}
.box-title {{ font: 800 20px Arial, sans-serif; fill:#0f172a; }}
.box-copy {{ font: 600 15px Arial, sans-serif; fill:#334155; }}
.pill {{ font: 800 13px Arial, sans-serif; fill:#fff; }}
.arrow {{ stroke:#0f172a; stroke-width:3; fill:none; marker-end:url(#arrowhead); }}
.arrow-label {{ font: 800 12px Arial, sans-serif; fill:#334155; text-anchor:middle; }}
</style>
</defs>
<rect width="1380" height="740" fill="#f8fafc"/>
<rect x="35" y="35" width="1310" height="670" rx="26" fill="#fff" stroke="#dbe3ef" stroke-width="2"/>
<rect x="60" y="70" width="580" height="52" rx="26" fill="#0f172a"/>
<text x="86" y="104" class="pill">TOTAL POLY PRINT ERP - STOCK LIFECYCLE TRAINING FLOW</text>
<text x="60" y="145" class="title">One stock-cycle truth</text>
{"".join(boxes)}
{arrow(310, 222, 380, 222, "load rows")}
{arrow(640, 222, 710, 222, "post batch")}
{arrow(970, 222, 1040, 222, "month end")}
{arrow(510, 295, 510, 410, "sheet")}
{arrow(640, 482, 710, 482, "ledger")}
{arrow(970, 482, 1040, 482, "annual")}
<text x="60" y="645" class="subtitle">Example: count only LDPE code A at Raw Store, only lay-flat rolls at WIP, then post Packing Yard EOD count.</text>
<text x="60" y="675" class="subtitle">Daily counts, month snapshots, ledger proof, and annual close all point back to posted audit sheets and stock ledgers.</text>
</svg>'''


def make_styles():
    st = getSampleStyleSheet()
    st.add(ParagraphStyle("TitleCenter", parent=st["Title"], alignment=TA_CENTER, fontSize=24, leading=30, spaceAfter=8))
    st.add(ParagraphStyle("Sub", parent=st["BodyText"], alignment=TA_CENTER, fontSize=10, leading=14, textColor=colors.HexColor("#475569"), spaceAfter=8))
    st.add(ParagraphStyle("H", parent=st["Heading1"], fontSize=17, leading=21, textColor=colors.HexColor("#0f172a"), spaceAfter=8))
    st.add(ParagraphStyle("B", parent=st["BodyText"], fontSize=9, leading=12.5, textColor=colors.HexColor("#334155"), spaceAfter=6))
    return st


def make_table(rows, widths):
    tbl = Table(rows, colWidths=widths, repeatRows=1)
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f172a")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("LEADING", (0, 0), (-1, -1), 10),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#dbe3ef")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    return tbl


def para(st, text: str):
    return Paragraph(text, st["B"])


def build_pdf() -> None:
    st = make_styles()
    doc = SimpleDocTemplate(str(PDF), pagesize=landscape(A4), leftMargin=16 * mm, rightMargin=16 * mm, topMargin=14 * mm, bottomMargin=13 * mm)
    story = [Paragraph("Stock Lifecycle Operator Guide", st["TitleCenter"]), Paragraph("Open stock, physical count, month close, stock-card proof, and annual FY close.", st["Sub"])]
    drawing = svg2rlg(str(SVG))
    drawing.scale(0.55, 0.55)
    drawing.width *= 0.55
    drawing.height *= 0.55
    story += [drawing, Spacer(1, 4 * mm), para(st, "<b>Inventory control route:</b> /inventory/stock-lifecycle"), para(st, "<b>Packing EOD shortcut:</b> /logistics/packing/consumption opens the packing count route, but proof lives in Stock Lifecycle.")]
    story.append(PageBreak())
    story += [Paragraph("1. What Each Tab Does", st["H"])]
    story.append(make_table([
        ["Tab", "Use it for", "Rule"],
        ["Overview", "Live value, class split, ageing, movement waterfall, dead stock.", "Read-only analytics."],
        ["Open stock", "First migration or first FY opening stock.", "Blocked after real movements exist."],
        ["Physical count", "Plant, location, item, bulk, roll, packing, roll-form, granule-code count.", "Only entered rows post."],
        ["FY close", "Annual Indian FY lock and next FY opening generation.", "Not monthly close."],
        ["Month close & history", "Month snapshot, audit history, stock-card drill.", "Does not lock FY."],
    ], [38 * mm, 112 * mm, 104 * mm]))
    story.append(PageBreak())
    story += [Paragraph("2. Daily Physical Count Flow", st["H"])]
    story.append(make_table([
        ["Step", "Operator action", "System result"],
        ["1", "Select plant and open Physical count.", "Rows load from live stock snapshot."],
        ["2", "Choose All, Bulk, Rolls, or Packing.", "Class filter is stored in batch metadata."],
        ["3", "Optionally filter location, roll form, granule code, category, or item search.", "Scope label is preserved in history."],
        ["4", "Enter counted qty only for checked rows.", "Blank rows are ignored."],
        ["5", "Give reason when variance is 2 percent or above.", "Posting is blocked until reason is present."],
        ["6", "Post physical count.", "Bulk, roll, or packaging ledger updates are posted."],
        ["7", "Review history and stock card.", "Opening + Movement = Closing proof is available."],
    ], [18 * mm, 110 * mm, 126 * mm]))
    story.append(PageBreak())
    story += [Paragraph("3. Worked Example", st["H"])]
    story.append(make_table([
        ["Flow", "What operator does", "Expected proof"],
        ["Granule code count", "Bulk scope, Raw Store, granule code A, counted 95 kg against system 100 kg.", "COUNT_SHORT -5 kg; code B untouched."],
        ["Roll stock-form count", "Rolls scope, lay-flat tube form, count physical label.", "Audit line keeps label, width, thickness, form."],
        ["Packing EOD", "Packing scope, Packing Yard, enter closing qty.", "Packaging COUNT_SHORT/COUNT_EXCESS transaction; audit sheet in same history."],
        ["Month close", "Capture month-end snapshot after daily counts.", "Monthly tracker marks snapshot and count sheets."],
        ["FY close", "Clear blockers and close from FY close.", "Locked closing batch and next opening batch."],
    ], [45 * mm, 112 * mm, 98 * mm]))
    story.append(PageBreak())
    story += [Paragraph("4. Month Close Versus FY Close", st["H"])]
    story.append(make_table([
        ["Question", "Month close", "FY close"],
        ["Frequency", "Monthly, after count sheets are posted.", "Once per Indian financial year."],
        ["Locking", "No lock.", "Locks annual FY."],
        ["Creates", "Reporting snapshot and linked posted count proof.", "FY_CLOSE batch and next OPENING_STOCK batch."],
        ["Partial?", "Yes, proof can be scoped.", "No, annual plant close."],
        ["Review", "Monthly tracker, audit history, stock card.", "FY close and closed periods."],
    ], [52 * mm, 102 * mm, 102 * mm]))
    story += [Spacer(1, 4 * mm), para(st, "The older trend snapshot table is bulk/roll oriented. Packaging proof is still real through packaging transactions and posted audit batches; use Audit sheet history and Stock card drill for packaging review.")]
    story.append(PageBreak())
    story += [Paragraph("5. Operator Checklist And Proof Command", st["H"])]
    story.append(make_table([
        ["Before posting", "After posting"],
        ["Correct plant, scope, and location selected.", "Audit sheet appears in Month close & history."],
        ["Roll form or granule code filter applied if needed.", "Stock card shows the variance movement."],
        ["Only physically counted rows have counted qty.", "Overview and closing preview refresh."],
        ["Variance reason added when required.", "Packing EOD appears in same Stock Lifecycle truth."],
    ], [128 * mm, 128 * mm]))
    story += [Spacer(1, 4 * mm), para(st, "Rollback-safe local proof command:"), para(st, "<font name='Courier'>/Users/devarshthakkar/local_repos/erp total/venv/bin/python scripts/prove_stock_lifecycle_local_flow.py</font>")]

    def footer(canvas, doc_):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(colors.HexColor("#64748b"))
        canvas.drawString(16 * mm, 8 * mm, "Total Poly Print ERP - Stock Lifecycle Operator Guide")
        canvas.drawRightString(281 * mm, 8 * mm, f"Page {doc_.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    SVG.write_text(build_svg(), encoding="utf-8")
    build_pdf()
    print(f"SVG written: {SVG}")
    print(f"PDF written: {PDF}")


if __name__ == "__main__":
    main()
