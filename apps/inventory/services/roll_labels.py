"""Optional physical labels. The database roll UUID is the durable scan identity."""
from io import BytesIO
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.graphics import renderPDF
from reportlab.pdfbase.pdfmetrics import stringWidth


def roll_label_snapshot(roll):
    return {
        "id": str(roll.id), "label_id": roll.label_id,
        "supplier_roll": str((roll.meta_json or {}).get("vendor_roll_label") or ""),
        "batch": str(roll.batch_no or ""),
        "material": roll.material.name, "grade": roll.grade.name if roll.grade else "",
        "width_mm": str(roll.width_mm), "thickness_micron": str(roll.thickness_micron),
        "weight_kg": str(roll.weight_kg), "stock_form": roll.stock_form,
        "location": roll.location.name if roll.location else "",
        "plant": roll.location.plant.name if roll.location and roll.location.plant else "",
    }


def generate_roll_labels(rows, *, width_mm=101.6, height_mm=50.8):
    stream = BytesIO()
    width, height = width_mm * mm, height_mm * mm
    pdf = canvas.Canvas(stream, pagesize=(width, height))
    pdf.setTitle("Roll identity labels")
    def line(text, x, y, max_width, size=8, bold=False):
        font = "Helvetica-Bold" if bold else "Helvetica"
        # Keep the full canonical human ID; shrink only that heading when needed.
        text = str(text).encode("latin-1", "replace").decode("latin-1")
        while stringWidth(text, font, size) > max_width and size > 5.5:
            size -= .25
        if stringWidth(text, font, size) > max_width:
            while text and stringWidth(text + "...", font, size) > max_width:
                text = text[:-1]
            text += "..."
        pdf.setFont(font, size)
        pdf.drawString(x, y, text)
    for row in rows:
        line(row['label_id'], 4*mm, height-6*mm, width-8*mm, 10, True)
        qr = QrCodeWidget(row['id'], barLevel='M')
        x1,y1,x2,y2 = qr.getBounds()
        side=26*mm
        drawing=Drawing(side,side,transform=[side/(x2-x1),0,0,side/(y2-y1),0,0])
        drawing.add(qr)
        renderPDF.draw(drawing,pdf,width-side-3*mm,12*mm)
        text_width=width-side-10*mm
        for idx,text in enumerate([
            row['material'], f"Grade: {row['grade'] or '-'}",
            f"{row['width_mm']} mm x {row['thickness_micron']} micron",
            f"{row['weight_kg']} kg | {row['stock_form']}",
            f"Supplier: {row['supplier_roll'] or '-'}",
            f"Batch: {row['batch'] or '-'}",
            f"{row['plant']} / {row['location']}",
        ]):
            line(text,4*mm,height-(11+idx*4)*mm,text_width,7)
        line("Identity only - confirm live weight, location and eligibility in ERP",4*mm,4*mm,width-8*mm,6)
        pdf.showPage()
    pdf.save()
    return stream.getvalue()
