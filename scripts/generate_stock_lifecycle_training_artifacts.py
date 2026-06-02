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
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from svglib.svglib import svg2rlg


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "docs" / "user-guides" / "artifacts"
IMG_DIR = OUT_DIR / "stock-lifecycle-guide-images"
SVG = OUT_DIR / "stock-lifecycle-flow-example.svg"
PDF = OUT_DIR / "stock-lifecycle-operator-guide.pdf"

PAGE_SIZE = landscape(A4)
LEFT = RIGHT = 13 * mm
TOP = 12 * mm
BOTTOM = 12 * mm
CONTENT_W = PAGE_SIZE[0] - LEFT - RIGHT


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
        f'<rect x="{mx - 68}" y="{my - 17}" width="136" height="24" rx="12" fill="#fff" stroke="#dbe3ef"/>'
        f'<text x="{mx}" y="{my}" class="arrow-label">{escape(label)}</text>'
    )


def build_svg() -> str:
    boxes = [
        box(60, 150, 250, 145, "#ecfdf5", "#4fbd84", "1. Live stock", ["Bulk by material + code", "Rolls by label + form", "Packing by SKU + location"]),
        box(380, 150, 260, 145, "#eef2ff", "#6366f1", "2. Count scope", ["Plant, location, class, item", "Roll form or granule code", "Only entered rows post"]),
        box(710, 150, 260, 145, "#fff7ed", "#fb923c", "3. Variance post", ["2 percent needs reason", "Short = consumption", "Excess = count gain"]),
        box(1040, 150, 270, 145, "#fdf2f8", "#db2777", "4. Month close", ["Capture month snapshot", "Keep count-sheet proof", "No FY lock here"]),
        box(380, 410, 260, 145, "#f8fafc", "#64748b", "Audit history", ["Scope label preserved", "Posted sheets immutable", "Draft blockers visible"]),
        box(710, 410, 260, 145, "#f0f9ff", "#0ea5e9", "Stock card proof", ["Opening + movement", "Material and FY drill", "Source references"]),
        box(1040, 410, 270, 145, "#f5f3ff", "#8b5cf6", "Annual FY close", ["Clear blockers", "Lock Indian FY", "Create next opening"]),
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
<rect x="60" y="70" width="610" height="52" rx="26" fill="#0f172a"/>
<text x="86" y="104" class="pill">TOTAL POLY PRINT ERP - STOCK LIFECYCLE USER TRAINING</text>
<text x="60" y="145" class="title">One inventory truth: open, count, prove, close</text>
{"".join(boxes)}
{arrow(310, 222, 380, 222, "load rows")}
{arrow(640, 222, 710, 222, "post batch")}
{arrow(970, 222, 1040, 222, "month end")}
{arrow(510, 295, 510, 410, "sheet proof")}
{arrow(640, 482, 710, 482, "ledger proof")}
{arrow(970, 482, 1040, 482, "annual lock")}
<text x="60" y="645" class="subtitle">Example: count only LDPE code A at Raw Store, only lay-flat rolls at WIP, then post Packing Yard EOD count.</text>
<text x="60" y="675" class="subtitle">Daily counts, month snapshots, stock cards, and FY close all point back to posted audit sheets and stock ledgers.</text>
</svg>'''


def make_styles():
    st = getSampleStyleSheet()
    st.add(ParagraphStyle("CoverTitle", parent=st["Title"], alignment=TA_CENTER, fontSize=25, leading=30, textColor=colors.HexColor("#0f172a"), spaceAfter=7))
    st.add(ParagraphStyle("CoverSub", parent=st["BodyText"], alignment=TA_CENTER, fontSize=10.5, leading=15, textColor=colors.HexColor("#475569"), spaceAfter=8))
    st.add(ParagraphStyle("H1", parent=st["Heading1"], fontSize=18, leading=22, textColor=colors.HexColor("#0f172a"), spaceAfter=6))
    st.add(ParagraphStyle("H2", parent=st["Heading2"], fontSize=12.5, leading=16, textColor=colors.HexColor("#111827"), spaceBefore=4, spaceAfter=4))
    st.add(ParagraphStyle("Body", parent=st["BodyText"], fontSize=8.8, leading=12.2, textColor=colors.HexColor("#334155"), spaceAfter=4))
    st.add(ParagraphStyle("Small", parent=st["BodyText"], fontSize=7.7, leading=10.4, textColor=colors.HexColor("#475569"), spaceAfter=3))
    st.add(ParagraphStyle("Note", parent=st["BodyText"], fontSize=8.3, leading=11.5, textColor=colors.HexColor("#1e3a8a"), backColor=colors.HexColor("#eff6ff"), borderColor=colors.HexColor("#bfdbfe"), borderWidth=0.4, borderPadding=6, spaceAfter=5))
    st.add(ParagraphStyle("Warn", parent=st["BodyText"], fontSize=8.3, leading=11.5, textColor=colors.HexColor("#7f1d1d"), backColor=colors.HexColor("#fef2f2"), borderColor=colors.HexColor("#fecaca"), borderWidth=0.4, borderPadding=6, spaceAfter=5))
    st.add(ParagraphStyle("Caption", parent=st["BodyText"], alignment=TA_LEFT, fontSize=7.5, leading=9.5, textColor=colors.HexColor("#64748b"), spaceBefore=2))
    return st


def p(st, text: str, style: str = "Body") -> Paragraph:
    return Paragraph(text, st[style])


def table(rows, widths, header=True, font_size=7.6, leading=9.6) -> Table:
    wrapped = [[Paragraph(str(cell), get_cell_style(header and row_idx == 0, font_size, leading)) for cell in row] for row_idx, row in enumerate(rows)]
    tbl = Table(wrapped, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT")
    commands = [
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), font_size),
        ("LEADING", (0, 0), (-1, -1), leading),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#dbe3ef")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if header:
        commands += [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f172a")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
        ]
    else:
        commands.append(("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]))
    tbl.setStyle(TableStyle(commands))
    return tbl


def get_cell_style(is_header: bool, font_size: float, leading: float) -> ParagraphStyle:
    return ParagraphStyle(
        "CellHeader" if is_header else "Cell",
        fontName="Helvetica-Bold" if is_header else "Helvetica",
        fontSize=font_size,
        leading=leading,
        textColor=colors.white if is_header else colors.HexColor("#334155"),
        spaceAfter=0,
    )


def image_flowable(path: Path, width: float) -> Image | Paragraph:
    if not path.exists():
        return Paragraph(f"Missing screenshot: {path.name}", ParagraphStyle("Missing", fontSize=9, textColor=colors.red))
    iw, ih = ImageReader(str(path)).getSize()
    ratio = ih / iw
    img = Image(str(path), width=width, height=width * ratio)
    img.hAlign = "CENTER"
    return img


def screenshot_page(st, title: str, image_name: str, notes: list[tuple[str, str]], caption: str):
    image_path = IMG_DIR / image_name
    img_w = 174 * mm
    notes_w = CONTENT_W - img_w - 7 * mm
    note_rows = [[p(st, f"<b>{head}</b><br/>{body}", "Small")] for head, body in notes]
    note_table = Table(note_rows, colWidths=[notes_w])
    note_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#dbe3ef")),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#e5e7eb")),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return [
        p(st, title, "H1"),
        Table(
            [[image_flowable(image_path, img_w), note_table]],
            colWidths=[img_w, notes_w],
            style=TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]),
        ),
        p(st, caption, "Caption"),
    ]


def cover_cards(st):
    rows = [
        [
            p(st, "<b>Main route</b><br/>/inventory/stock-lifecycle", "Small"),
            p(st, "<b>Packing EOD route</b><br/>/logistics/packing/consumption", "Small"),
            p(st, "<b>Use for</b><br/>Opening, counts, snapshots, history, stock-card proof, FY close", "Small"),
        ],
        [
            p(st, "<b>Do not use for</b><br/>GRN, WCM issue, output log, dispatch, or packing execution", "Small"),
            p(st, "<b>Partial counts</b><br/>Plant, location, item, stock class, roll form, or granule code", "Small"),
            p(st, "<b>Golden rule</b><br/>Only rows with entered counted quantity post", "Small"),
        ],
    ]
    tbl = Table(rows, colWidths=[CONTENT_W / 3 - 3 * mm] * 3, hAlign="CENTER")
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#dbe3ef")),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#e2e8f0")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return tbl


def build_pdf() -> None:
    st = make_styles()
    doc = SimpleDocTemplate(str(PDF), pagesize=PAGE_SIZE, leftMargin=LEFT, rightMargin=RIGHT, topMargin=TOP, bottomMargin=BOTTOM)
    story = [
        Paragraph("Stock Lifecycle User Training Guide", st["CoverTitle"]),
        Paragraph("End-to-end operator manual for stock opening, physical count, packing EOD count, monthly proof, stock-card drill, and annual FY close.", st["CoverSub"]),
        Spacer(1, 2 * mm),
        cover_cards(st),
        Spacer(1, 4 * mm),
    ]
    if SVG.exists():
        drawing = svg2rlg(str(SVG))
        scale = 0.43
        drawing.scale(scale, scale)
        drawing.width *= scale
        drawing.height *= scale
        story += [drawing]
    story += [
        Spacer(1, 2 * mm),
        p(st, "<b>Operator promise:</b> if an item was not physically counted, leave it blank. Blank rows are ignored and stay unchanged.", "Note"),
        PageBreak(),
    ]

    story += [
        p(st, "1. What This Module Controls", "H1"),
        p(st, "Stock Lifecycle is the inventory control cockpit. Other modules create movement. Stock Lifecycle proves, corrects, snapshots, and closes the inventory balance."),
        table([
            ["Area", "Use Stock Lifecycle for", "Do not use it for"],
            ["Opening stock", "First FY opening or migration stock, by material, location, roll label, and packing item.", "Daily inward GRNs after operations are live."],
            ["Physical count", "Full or partial count by plant, location, item, stock class, roll form, or granule inward code.", "Issuing material to WCM or recording machine output."],
            ["Packing EOD", "Closing manual packing SKUs from Packing EOD or Physical count with Packing scope.", "Inner pouch and gonny execution already posted by packing flow."],
            ["Month close", "Monthly reporting snapshot plus count-sheet proof. No lock.", "Annual FY locking."],
            ["FY close", "Annual Indian FY lock after all blockers are cleared. Creates next opening.", "Daily or monthly count work."],
        ], [36 * mm, 116 * mm, 112 * mm]),
        Spacer(1, 3 * mm),
        p(st, "<b>Common misunderstanding:</b> Month close is a reporting snapshot. FY close is the annual lock. They are intentionally separate.", "Warn"),
        PageBreak(),
    ]

    story += [
        p(st, "2. Button And Tab Map", "H1"),
        table([
            ["Button / tab", "When to click", "What happens"],
            ["Overview", "Start here at the beginning of the day or before review.", "Shows valuation, class split, ageing, movement waterfall, dead stock, and trend status."],
            ["Open stock", "Only for first migration or FY opening stock.", "Posts opening audit sheet. Do not use for normal GRN."],
            ["Physical count", "Daily count, surprise audit, EOD count, item correction, roll-form count, or granule-code count.", "Builds and posts a physical count batch from entered rows only."],
            ["FY close", "At annual close after all draft sheets and blockers are cleared.", "Locks the FY and creates the next opening batch."],
            ["Month close & history", "At month-end and whenever proof is needed.", "Shows monthly tracker, audit sheet history, stock-card drill, and capture month-end snapshot."],
            ["Export", "When a controller needs Excel evidence.", "Exports the current view where supported."],
            ["Post physical count", "After counted rows are entered and required reasons are filled.", "Posts variance movements and creates immutable audit proof."],
            ["Capture month-end snapshot", "Current month only, after month-end count work.", "Captures live stock as a monthly reporting snapshot. FY remains open."],
            ["Close Financial Year", "Only after blockers show clear.", "Closes the annual FY. This is not reversible as a daily operation."],
            ["Packing EOD - Post count", "At packing yard EOD for manual packing materials.", "Short stock becomes packing consumption; excess becomes count adjustment."],
        ], [48 * mm, 98 * mm, 118 * mm]),
        PageBreak(),
    ]

    story += screenshot_page(
        st,
        "3. Overview - Read The Stock Position First",
        "01-overview.png",
        [
            ("Plant and FY selectors", "Always verify plant and financial year before trusting numbers."),
            ("Physical count tab", "Use this for daily counts and partial counts."),
            ("Movement proof", "Opening + Ins - Outs +/- Adjustments = Closing. Use this before arguing with totals."),
            ("Export", "Use export when the review needs a file trail."),
        ],
        "Screenshot captured from the local running stack with guide callouts.",
    )
    story.append(PageBreak())

    story += screenshot_page(
        st,
        "4. Physical Count - The Daily Operator Flow",
        "02-physical-count.png",
        [
            ("Scope buttons", "All, Bulk, Rolls, and Packing decide the stock class in the count batch."),
            ("Location filter", "Use this for store-wise or yard-wise count. Only selected rows post."),
            ("Roll form filter", "For rolls, filter by open web, lay-flat tube, or folded web when form matters."),
            ("Granule code filter", "For bulk/granule stock, count only one inward code without affecting other codes."),
            ("Post physical count", "Disabled until at least one row is valid. Variance over 2 percent needs a reason."),
        ],
        "Use Physical count for plant-wide, location-wise, item-wise, class-wise, roll-form, and granule-code counts.",
    )
    story.append(PageBreak())

    story += [
        p(st, "5. Worked Examples - What To Enter", "H1"),
        table([
            ["Example", "Screen setup", "What to enter", "Expected proof"],
            ["Granule code partial count", "Physical count -> Bulk -> location Raw Store -> granule inward code A.", "Enter counted kg only on code A rows. Leave code B blank.", "Code A posts short/excess movement. Code B remains unchanged."],
            ["Roll stock-form count", "Physical count -> Rolls -> roll form Lay-flat tube.", "Enter counted qty for physical roll labels checked. Add reason if variance crosses threshold.", "Audit line stores roll label, material, width, thickness, grade, status, and stock form."],
            ["Packing EOD count", "Packing EOD page or Physical count -> Packing -> Packing Yard.", "Enter closing qty for counted manual packing SKUs.", "Short = packing consumption. Excess = count adjustment. Sheet appears in Stock Lifecycle history."],
            ["Item-only surprise count", "Physical count -> search exact item code/name.", "Enter counted qty for that item only.", "Only that item posts. Unentered items do not become zero."],
            ["Location-only cycle count", "Physical count -> location filter -> leave uncounted rows blank.", "Enter only rows physically checked in that location.", "Batch label says location partial count and preserves location metadata."],
        ], [42 * mm, 74 * mm, 72 * mm, 76 * mm], font_size=7.2, leading=9.4),
        Spacer(1, 3 * mm),
        p(st, "<b>Reason rule:</b> if variance is 2 percent or more, write a real reason: damage found, missing bundle, wrong location, supplier shortage, label mismatch, or counting correction.", "Note"),
        PageBreak(),
    ]

    story += screenshot_page(
        st,
        "6. Packing EOD - Same Stock-Cycle Truth",
        "07-packing-eod.png",
        [
            ("Date", "Use the actual EOD count date."),
            ("Copy book qty", "Use only when physical stock equals the system balance."),
            ("Post count", "Posts the packing count into the same audit/stock lifecycle truth."),
            ("Posting rule", "Short stock becomes packing consumption. Excess stock becomes count adjustment."),
            ("Stock Lifecycle chip", "Jump back to the Stock Lifecycle count/history proof."),
        ],
        "Packing EOD is not a separate truth. It is a focused shortcut for packing stock counts.",
    )
    story.append(PageBreak())

    story += screenshot_page(
        st,
        "7. Month Close & History - Monthly Proof, Not Annual Lock",
        "03-month-history.png",
        [
            ("Monthly close tracker", "Shows month status: pending, snapshot captured, or count posted."),
            ("Capture month-end snapshot", "Use for current month after count work is done."),
            ("Closed periods", "Shows FY locks separately from monthly proof."),
            ("Audit sheet history", "All opening, count, and close sheets are visible below."),
        ],
        "Month close captures evidence for reporting. It does not stop inventory operations.",
    )
    story.append(PageBreak())

    story += screenshot_page(
        st,
        "8. Stock Card Drill - Ledger Proof",
        "04-stock-card-drill.png",
        [
            ("Audit sheet list", "Use this to find posted count sheets and unfinished draft blockers."),
            ("Material search", "Search material before opening stock-card proof."),
            ("Opening + movement = closing", "This is the controller proof for a selected material and FY."),
            ("Posted sheets immutable", "Posted evidence should not be edited. Correct through a new posted adjustment/count."),
        ],
        "Use stock card drill when the question is: why is this material balance what it is?",
    )
    story.append(PageBreak())

    story += screenshot_page(
        st,
        "9. FY Close - Preview And Blockers",
        "05-fy-close.png",
        [
            ("FY override", "Confirm the annual financial year before close."),
            ("Annual close blockers", "Draft sheets, open challans, negative stock, and unresolved critical alerts block close."),
            ("Closing snapshot", "Review value and class movement before the annual lock."),
            ("Monthly close note", "Monthly stock close is handled in Month close & history, not here."),
        ],
        "FY close is annual. It should be run by authorised users only after operational cleanup is complete.",
    )
    story.append(PageBreak())

    story += screenshot_page(
        st,
        "10. FY Close - Final Action",
        "06-fy-close-action.png",
        [
            ("Closing math", "Review class-wise opening, inward, outward, adjustment, closing, and value."),
            ("Close Financial Year", "Click only after blockers are clear and numbers are approved."),
            ("Result", "System creates a locked close batch and a next-year opening batch."),
            ("If blocked", "Go to Month close & history and cancel unfinished draft sheets or resolve operational blockers."),
        ],
        "The final close action is intentionally separated from monthly snapshot work.",
    )
    story.append(PageBreak())

    story += [
        p(st, "11. End-To-End Operating Sequence", "H1"),
        table([
            ["When", "Operator action", "Button / tab", "Proof to check"],
            ["First setup", "Enter beginning balances by material/location/label.", "Open stock -> Post Opening Stock", "Opening audit sheet in history."],
            ["Daily raw count", "Count actual raw stock for checked rows only.", "Physical count -> Bulk -> Post physical count", "Count batch and stock card movement."],
            ["Daily roll count", "Count roll labels and stock forms.", "Physical count -> Rolls -> roll form filter", "Roll audit line with label/form/status."],
            ["Packing EOD", "Count manual packing SKU closing balance.", "Packing EOD -> Post count", "Packing transaction and Stock Lifecycle audit history."],
            ["Month end", "Capture current month stock proof.", "Month close & history -> Capture month-end snapshot", "Monthly tracker updated; FY remains open."],
            ["Controller review", "Explain any material balance.", "Month close & history -> Stock card drill", "Opening + movement = closing."],
            ["Annual close", "Clear blockers, approve closing, lock FY.", "FY close -> Close Financial Year", "Closed FY plus next opening batch."],
        ], [34 * mm, 86 * mm, 72 * mm, 68 * mm]),
        Spacer(1, 3 * mm),
        p(st, "Use this exact sequence during training. The system supports partial counts, but the training example should start with one location and one or two items so operators see what changes and what does not.", "Note"),
        PageBreak(),
    ]

    story += [
        p(st, "12. Operator Checklist And Troubleshooting", "H1"),
        table([
            ["Question / problem", "What to do"],
            ["The Post button is disabled.", "Enter at least one counted quantity. If variance is over 2 percent, add a reason. If a found row has no location, select a location."],
            ["I only counted one item. Will other items become zero?", "No. Blank rows are ignored. Only rows with entered counted quantity post."],
            ["Where do monthly closes happen?", "Month close & history. Use Capture month-end snapshot for the current month. It does not lock the FY."],
            ["Why is FY close blocked?", "Look at Annual close blockers. Draft count/opening sheets can be cancelled from Month close & history if unfinished."],
            ["Where do packing counts show?", "Packing EOD posts into the same Stock Lifecycle proof. Check audit history and stock card; packaging proof is via packaging transactions plus posted audit sheets."],
            ["How do I prove a balance to management?", "Open Month close & history, use Stock card drill for the material and FY, then export if needed."],
            ["What if a counted row has a large variance?", "Do not post without a real reason. Write damage, missing bundle, found in another location, issue not recorded, or count correction."],
        ], [70 * mm, 194 * mm]),
        Spacer(1, 4 * mm),
        table([
            ["Before posting any count", "After posting any count"],
            ["Correct plant and FY are selected.", "Toast confirms physical count posted."],
            ["Correct scope: All, Bulk, Rolls, or Packing.", "Audit sheet appears in Month close & history."],
            ["Correct location/roll form/granule code filter if partial.", "Stock card movement matches the variance."],
            ["Only physically counted rows have counted qty.", "Overview and closing preview refresh."],
            ["Reasons filled for variance over 2 percent.", "Month-end snapshot can be captured when month work is complete."],
        ], [132 * mm, 132 * mm]),
        Spacer(1, 3 * mm),
        p(st, "<b>Rollback-safe proof command for trainers:</b><br/><font name='Courier'>/Users/devarshthakkar/local_repos/erp total/venv/bin/python scripts/prove_stock_lifecycle_local_flow.py</font>", "Small"),
    ]

    def footer(canvas, doc_):
        canvas.saveState()
        canvas.setFillColor(colors.white)
        canvas.rect(0, 0, PAGE_SIZE[0], PAGE_SIZE[1], stroke=0, fill=1)
        canvas.setFont("Helvetica", 7.2)
        canvas.setFillColor(colors.HexColor("#64748b"))
        canvas.drawString(LEFT, 7 * mm, "Total Poly Print ERP - Stock Lifecycle User Training Guide")
        canvas.drawRightString(PAGE_SIZE[0] - RIGHT, 7 * mm, f"Page {doc_.page}")
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
