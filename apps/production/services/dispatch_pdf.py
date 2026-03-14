from __future__ import annotations

from decimal import Decimal
from io import BytesIO

from django.utils import timezone
from django.db import connection

from apps.production.models import DeliveryChallan

try:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas
except Exception:  # pragma: no cover
    A4 = None
    mm = None
    canvas = None


class DispatchListPDFService:
    """
    Printable dispatch list for production challans.
    Optimized for gate/warehouse printouts (dot-matrix friendly monospace layout).
    """

    @staticmethod
    def _fmt_dt(value):
        if not value:
            return "-"
        local = timezone.localtime(value) if timezone.is_aware(value) else value
        return local.strftime("%d-%b-%Y %H:%M")

    @staticmethod
    def _safe_sales_order_number(challan: DeliveryChallan) -> str:
        if not challan.sales_order_id:
            return "-"
        try:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT order_number FROM sales_orders WHERE id = %s::uuid",
                    [str(challan.sales_order_id)],
                )
                row = cursor.fetchone()
                return row[0] if row and row[0] else "-"
        except Exception:
            return "-"

    @staticmethod
    def _load_item_rows(challan_id):
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    i.id,
                    i.roll_id,
                    i.packing_unit_id,
                    i.fg_batch_id,
                    i.weight_kg,
                    i.qty_pcs,
                    r.label_id AS roll_label,
                    r.batch_no AS roll_batch_no,
                    m.name AS material_name,
                    rl.name AS roll_location,
                    pu.label_id AS gonny_label,
                    pu.content_mode AS gonny_content_mode,
                    pu.primary_pack_count AS gonny_primary_pack_count,
                    pl.name AS gonny_location,
                    pfg.batch_number AS gonny_batch_number,
                    fg.batch_number AS batch_number
                FROM production_delivery_challan_items i
                LEFT JOIN inventory_rolls r ON r.id = i.roll_id
                LEFT JOIN inventory_materials m ON m.id = r.material_id
                LEFT JOIN inventory_locations rl ON rl.id = r.location_id
                LEFT JOIN production_packing_units pu ON pu.id = i.packing_unit_id
                LEFT JOIN inventory_locations pl ON pl.id = pu.location_id
                LEFT JOIN production_fg_batches pfg ON pfg.id = pu.fg_batch_id
                LEFT JOIN production_fg_batches fg ON fg.id = i.fg_batch_id
                WHERE i.challan_id = %s::uuid
                ORDER BY i.created_at ASC
                """,
                [str(challan_id)],
            )
            cols = [col[0] for col in cursor.description]
            return [dict(zip(cols, row)) for row in cursor.fetchall()]

    @classmethod
    def render(cls, challan: DeliveryChallan) -> BytesIO:
        if canvas is None:
            raise RuntimeError("PDF engine unavailable: reportlab is not installed.")

        buffer = BytesIO()
        pdf = canvas.Canvas(buffer, pagesize=A4)
        width, height = A4

        y = height - 14 * mm
        pdf.setFont("Courier-Bold", 13)
        pdf.drawString(12 * mm, y, "TOTAL POLY PRINT ERP")
        pdf.setFont("Courier-Bold", 11)
        pdf.drawRightString(width - 12 * mm, y, "DISPATCH ITEM LIST")

        y -= 7 * mm
        pdf.setLineWidth(0.5)
        pdf.line(12 * mm, y, width - 12 * mm, y)

        y -= 7 * mm
        pdf.setFont("Courier", 9)
        pdf.drawString(12 * mm, y, f"DC NO      : {challan.dc_no}")
        pdf.drawString(85 * mm, y, f"STATUS: {challan.status}")
        pdf.drawRightString(width - 12 * mm, y, f"PRINT: {cls._fmt_dt(timezone.now())}")

        y -= 5 * mm
        pdf.drawString(12 * mm, y, f"CUSTOMER   : {challan.customer_name or '-'}")
        pdf.drawString(85 * mm, y, f"PLANT : {challan.plant.name if challan.plant else '-'}")

        y -= 5 * mm
        pdf.drawString(12 * mm, y, f"SALES ORDER: {cls._safe_sales_order_number(challan)}")
        pdf.drawString(85 * mm, y, f"VEHICLE: {challan.vehicle_no or '-'}")

        y -= 5 * mm
        pdf.drawString(12 * mm, y, f"DRIVER     : {challan.driver_name or '-'} / {challan.driver_phone or '-'}")
        pdf.drawString(85 * mm, y, f"DISPATCH: {cls._fmt_dt(challan.dispatch_date)}")

        y -= 8 * mm
        pdf.setFont("Courier-Bold", 8)
        pdf.drawString(12 * mm, y, "SR")
        pdf.drawString(20 * mm, y, "TYPE")
        pdf.drawString(36 * mm, y, "LABEL")
        pdf.drawString(104 * mm, y, "REF")
        pdf.drawRightString(152 * mm, y, "PCS")
        pdf.drawRightString(183 * mm, y, "KG")
        pdf.drawRightString(width - 12 * mm, y, "LOCATION")

        y -= 2 * mm
        pdf.line(12 * mm, y, width - 12 * mm, y)
        y -= 4 * mm

        items = cls._load_item_rows(challan.id)

        total_kg = Decimal("0")
        total_pcs = 0
        roll_count = 0
        gonny_count = 0

        pdf.setFont("Courier", 8)
        for idx, item in enumerate(items, start=1):
            if y < 18 * mm:
                pdf.showPage()
                y = height - 16 * mm
                pdf.setFont("Courier-Bold", 10)
                pdf.drawString(12 * mm, y, f"DISPATCH ITEM LIST (CONT.) - {challan.dc_no}")
                y -= 7 * mm
                pdf.setFont("Courier-Bold", 8)
                pdf.drawString(12 * mm, y, "SR")
                pdf.drawString(20 * mm, y, "TYPE")
                pdf.drawString(36 * mm, y, "LABEL")
                pdf.drawString(104 * mm, y, "REF")
                pdf.drawRightString(152 * mm, y, "PCS")
                pdf.drawRightString(183 * mm, y, "KG")
                pdf.drawRightString(width - 12 * mm, y, "LOCATION")
                y -= 2 * mm
                pdf.line(12 * mm, y, width - 12 * mm, y)
                y -= 4 * mm
                pdf.setFont("Courier", 8)

            is_roll = bool(item.get("roll_id"))
            is_gonny = bool(item.get("packing_unit_id"))
            kind = "ROLL" if is_roll else ("GONNY" if is_gonny else "BATCH")
            label = (
                item.get("roll_label") if is_roll else
                item.get("gonny_label") if item.get("packing_unit_id") else
                item.get("batch_number") if item.get("fg_batch_id") else "-"
            )
            gonny_mode = str(item.get("gonny_content_mode") or "LOOSE_POUCHES").upper()
            gonny_pack_count = item.get("gonny_primary_pack_count")
            ref = (
                (
                    (f"{item.get('roll_batch_no') or '-'} | {item.get('material_name') or '-'}")
                    if is_roll
                    else "-"
                )
                if is_roll else
                (
                    (
                        f"{item.get('gonny_batch_number') or '-'} | "
                        f"{'PRIMARY' if gonny_mode == 'PRIMARY_PACKS' else 'LOOSE'}"
                        f"{f' x{gonny_pack_count}' if gonny_mode == 'PRIMARY_PACKS' and gonny_pack_count else ''}"
                    )
                    if is_gonny
                    else (item.get("batch_number") if item.get("fg_batch_id") else "-")
                )
            )
            location = (
                item.get("roll_location") if is_roll else
                item.get("gonny_location") if item.get("packing_unit_id") else
                "-"
            )
            pcs = int(item.get("qty_pcs") or 0)
            kg = Decimal(str(item.get("weight_kg") or 0))

            if is_roll:
                roll_count += 1
            elif is_gonny:
                gonny_count += 1
            total_pcs += pcs
            total_kg += kg

            pdf.drawString(12 * mm, y, str(idx))
            pdf.drawString(20 * mm, y, kind)
            pdf.drawString(36 * mm, y, str(label)[:34])
            pdf.drawString(104 * mm, y, str(ref)[:22])
            pdf.drawRightString(152 * mm, y, str(pcs) if pcs else "-")
            pdf.drawRightString(183 * mm, y, f"{kg:.3f}")
            pdf.drawRightString(width - 12 * mm, y, str(location)[:24])
            y -= 4.8 * mm

        y -= 2 * mm
        pdf.line(12 * mm, y, width - 12 * mm, y)
        y -= 6 * mm
        pdf.setFont("Courier-Bold", 8.5)
        pdf.drawString(12 * mm, y, f"ROLL LINES: {roll_count}")
        pdf.drawString(50 * mm, y, f"GONNY LINES: {gonny_count}")
        pdf.drawString(98 * mm, y, f"POUCH PCS: {total_pcs}")
        pdf.drawString(138 * mm, y, f"TOTAL KG: {total_kg:.3f}")

        y -= 8 * mm
        pdf.setFont("Courier", 8)
        pdf.drawString(12 * mm, y, "Dispatch Incharge: ____________________")
        pdf.drawString(88 * mm, y, "Driver: ____________________")
        pdf.drawString(144 * mm, y, "Receiver: ____________________")

        y -= 6 * mm
        pdf.drawString(12 * mm, y, "This list is system generated and valid with DC reference.")

        pdf.showPage()
        pdf.save()
        buffer.seek(0)
        return buffer
