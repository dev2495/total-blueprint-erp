from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from hashlib import sha1
from io import BytesIO
from typing import Iterable, Optional

from django.utils import timezone

from apps.factory.models import Plant, PlantLegalProfile
from apps.inventory.models import DeliveryChallan, InterPlantChallanItem

try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas
except Exception:  # pragma: no cover - explicit runtime failure below
    colors = None
    A4 = None
    mm = None
    canvas = None


@dataclass
class _LegalSection:
    legal_name: str
    gstin: str
    address: str
    phone: str
    email: str
    signatory_name: str
    signatory_designation: str


class ChallanPDFService:
    TITLE = "INTER-PLANT DELIVERY CHALLAN"
    COMPANY_NAME = "TOTAL POLY PRINT ERP"

    @staticmethod
    def _fmt_dt(value):
        if not value:
            return "-"
        local = timezone.localtime(value) if timezone.is_aware(value) else value
        return local.strftime("%d-%b-%Y %H:%M")

    @classmethod
    def _get_legal_profile(cls, plant: Optional[Plant]) -> _LegalSection:
        if not plant:
            return _LegalSection(
                legal_name="Plant (Unmapped)",
                gstin="-",
                address="-",
                phone="-",
                email="-",
                signatory_name="Authorized Signatory",
                signatory_designation="",
            )
        profile = PlantLegalProfile.objects.filter(plant=plant).first()
        if not profile:
            return _LegalSection(
                legal_name=plant.name,
                gstin="-",
                address="-",
                phone="-",
                email="-",
                signatory_name="Authorized Signatory",
                signatory_designation="",
            )
        legal_name = profile.legal_name or plant.name
        address = profile.address or "-"
        return _LegalSection(
            legal_name=legal_name,
            gstin=profile.gstin or "-",
            address=address,
            phone=profile.contact_phone or "-",
            email=profile.contact_email or "-",
            signatory_name=profile.authorized_signatory_name or "Authorized Signatory",
            signatory_designation=profile.authorized_signatory_designation or "",
        )

    @classmethod
    def _draw_header(cls, pdf, challan: DeliveryChallan, source_legal: _LegalSection, dest_legal: _LegalSection):
        pdf.setFillColor(colors.HexColor("#0F172A"))
        pdf.rect(10 * mm, 282 * mm, 190 * mm, 12 * mm, fill=1, stroke=0)
        pdf.setFillColor(colors.white)
        pdf.setFont("Helvetica-Bold", 13)
        pdf.drawString(14 * mm, 286.5 * mm, cls.COMPANY_NAME)
        pdf.setFont("Helvetica-Bold", 11)
        pdf.drawRightString(196 * mm, 286.5 * mm, cls.TITLE)

        pdf.setFillColor(colors.black)
        pdf.setStrokeColor(colors.HexColor("#CBD5E1"))
        pdf.rect(10 * mm, 260 * mm, 190 * mm, 20 * mm, fill=0, stroke=1)

        pdf.setFont("Helvetica-Bold", 9)
        pdf.drawString(14 * mm, 274.5 * mm, "DC No")
        pdf.drawString(68 * mm, 274.5 * mm, "Status")
        pdf.drawString(108 * mm, 274.5 * mm, "Created")
        pdf.drawString(148 * mm, 274.5 * mm, "Dispatched")

        pdf.setFont("Helvetica", 9)
        pdf.drawString(14 * mm, 269.8 * mm, challan.dc_no or str(challan.id)[:8])
        pdf.drawString(68 * mm, 269.8 * mm, challan.status)
        pdf.drawString(108 * mm, 269.8 * mm, cls._fmt_dt(challan.created_at))
        pdf.drawString(148 * mm, 269.8 * mm, cls._fmt_dt(challan.dispatched_at))
        pdf.drawString(148 * mm, 265.2 * mm, f"Received: {cls._fmt_dt(challan.received_at)}")

        if challan.is_system_generated:
            pdf.setFillColor(colors.HexColor("#DBEAFE"))
            pdf.roundRect(14 * mm, 262 * mm, 34 * mm, 5 * mm, 1.5 * mm, fill=1, stroke=0)
            pdf.setFillColor(colors.HexColor("#1D4ED8"))
            pdf.setFont("Helvetica-Bold", 7)
            pdf.drawString(16 * mm, 263.7 * mm, "SYSTEM GENERATED")
            pdf.setFillColor(colors.black)

        if challan.source_job:
            pdf.setFont("Helvetica", 8)
            pdf.drawString(108 * mm, 265.2 * mm, f"Source Job: {challan.source_job.job_number}")
        if challan.target_job:
            pdf.setFont("Helvetica", 8)
            pdf.drawString(108 * mm, 261.0 * mm, f"Target Job: {challan.target_job.job_number}")

        cls._draw_legal_blocks(pdf, challan, source_legal, dest_legal)
        cls._draw_transport_block(pdf, challan)

    @classmethod
    def _draw_legal_blocks(cls, pdf, challan: DeliveryChallan, source_legal: _LegalSection, dest_legal: _LegalSection):
        pdf.setStrokeColor(colors.HexColor("#CBD5E1"))
        pdf.rect(10 * mm, 236 * mm, 93 * mm, 22 * mm, fill=0, stroke=1)
        pdf.rect(107 * mm, 236 * mm, 93 * mm, 22 * mm, fill=0, stroke=1)

        pdf.setFont("Helvetica-Bold", 8)
        pdf.drawString(13 * mm, 255 * mm, f"FROM PLANT: {challan.from_plant.name if challan.from_plant else '-'}")
        pdf.drawString(110 * mm, 255 * mm, f"TO PLANT: {challan.to_plant.name if challan.to_plant else '-'}")

        pdf.setFont("Helvetica", 7.6)
        pdf.drawString(13 * mm, 251 * mm, source_legal.legal_name[:60])
        pdf.drawString(13 * mm, 247 * mm, f"GSTIN: {source_legal.gstin}")
        cls._draw_wrapped(pdf, source_legal.address, 13 * mm, 243 * mm, 82 * mm, line_height=3.2 * mm, max_lines=2)
        pdf.drawString(13 * mm, 236.8 * mm, f"Ph: {source_legal.phone}  |  Email: {source_legal.email[:28]}")

        pdf.drawString(110 * mm, 251 * mm, dest_legal.legal_name[:60])
        pdf.drawString(110 * mm, 247 * mm, f"GSTIN: {dest_legal.gstin}")
        cls._draw_wrapped(pdf, dest_legal.address, 110 * mm, 243 * mm, 82 * mm, line_height=3.2 * mm, max_lines=2)
        pdf.drawString(110 * mm, 236.8 * mm, f"Ph: {dest_legal.phone}  |  Email: {dest_legal.email[:28]}")

    @classmethod
    def _draw_transport_block(cls, pdf, challan: DeliveryChallan):
        pdf.setStrokeColor(colors.HexColor("#CBD5E1"))
        pdf.rect(10 * mm, 224 * mm, 190 * mm, 9 * mm, fill=0, stroke=1)
        pdf.setFont("Helvetica-Bold", 8)
        pdf.drawString(13 * mm, 229.4 * mm, "TRANSPORT")
        pdf.setFont("Helvetica", 8)
        pdf.drawString(38 * mm, 229.4 * mm, f"Vehicle: {challan.vehicle_no or '-'}")
        pdf.drawString(86 * mm, 229.4 * mm, f"Driver: {challan.driver_name or '-'} ({challan.driver_phone or '-'})")
        pdf.drawString(145 * mm, 229.4 * mm, f"Transporter: {challan.transporter_name or '-'}")
        pdf.drawString(145 * mm, 225.8 * mm, f"LR No: {challan.lr_number or '-'}")

    @staticmethod
    def _line_label(item: InterPlantChallanItem) -> str:
        if item.line_type == "ROLL" and item.roll:
            return item.roll.label_id
        if item.material:
            return item.material.name
        return "-"

    @classmethod
    def _draw_table_header(cls, pdf, y: float):
        pdf.setFillColor(colors.HexColor("#F1F5F9"))
        pdf.rect(10 * mm, y - 6 * mm, 190 * mm, 7 * mm, fill=1, stroke=0)
        pdf.setFillColor(colors.HexColor("#0F172A"))
        pdf.setFont("Helvetica-Bold", 8)
        pdf.drawString(12 * mm, y - 2 * mm, "LINE")
        pdf.drawString(24 * mm, y - 2 * mm, "ITEM")
        pdf.drawString(73 * mm, y - 2 * mm, "FROM LOCATION")
        pdf.drawString(112 * mm, y - 2 * mm, "TO LOCATION")
        pdf.drawRightString(146 * mm, y - 2 * mm, "PLANNED KG")
        pdf.drawRightString(168 * mm, y - 2 * mm, "DISPATCHED KG")
        pdf.drawRightString(196 * mm, y - 2 * mm, "RECEIVED KG")

    @classmethod
    def _draw_items(
        cls,
        pdf,
        items: Iterable[InterPlantChallanItem],
        start_y: float,
    ):
        y = start_y
        cls._draw_table_header(pdf, y)
        y -= 7.5 * mm

        pdf.setFont("Helvetica", 7.8)
        totals = {
            "planned": Decimal("0"),
            "dispatched": Decimal("0"),
            "received": Decimal("0"),
            "count": 0,
        }
        for item in items:
            if y < 35 * mm:
                pdf.showPage()
                cls._draw_table_header(pdf, 280 * mm)
                y = 272 * mm
                pdf.setFont("Helvetica", 7.8)

            planned = Decimal(str(item.planned_qty_kg or 0))
            dispatched = Decimal(str(item.dispatched_qty_kg or 0))
            received = Decimal(str(item.received_qty_kg or 0))
            totals["planned"] += planned
            totals["dispatched"] += dispatched
            totals["received"] += received
            totals["count"] += 1

            label = f"{item.line_type}: {cls._line_label(item)}"
            from_loc = item.from_location.name if item.from_location else "-"
            to_loc = item.to_location.name if item.to_location else "-"

            pdf.drawString(12 * mm, y, str(totals["count"]))
            pdf.drawString(24 * mm, y, label[:34])
            pdf.drawString(73 * mm, y, from_loc[:22])
            pdf.drawString(112 * mm, y, to_loc[:22])
            pdf.drawRightString(146 * mm, y, f"{planned:.3f}")
            pdf.drawRightString(168 * mm, y, f"{dispatched:.3f}")
            pdf.drawRightString(196 * mm, y, f"{received:.3f}")
            y -= 5.4 * mm

        return y, totals

    @classmethod
    def _draw_totals(cls, pdf, y: float, totals: dict):
        y = max(y - 2 * mm, 26 * mm)
        pdf.setStrokeColor(colors.HexColor("#CBD5E1"))
        pdf.rect(110 * mm, y, 90 * mm, 13 * mm, fill=0, stroke=1)
        pdf.setFont("Helvetica-Bold", 8)
        pdf.drawString(113 * mm, y + 9.2 * mm, f"Total Lines: {totals['count']}")
        pdf.drawString(113 * mm, y + 5.4 * mm, f"Total Dispatched: {Decimal(totals['dispatched']):.3f} kg")
        pdf.drawString(113 * mm, y + 1.7 * mm, f"Total Received: {Decimal(totals['received']):.3f} kg")

    @classmethod
    def _draw_signatures(
        cls,
        pdf,
        y: float,
        source_legal: _LegalSection,
        dest_legal: _LegalSection,
    ):
        y = max(y - 2 * mm, 10 * mm)
        blocks = [
            (10 * mm, "Dispatch Incharge", source_legal.signatory_name, source_legal.signatory_designation),
            (73 * mm, "Transport/Driver", "", ""),
            (136 * mm, "Receiving Incharge", dest_legal.signatory_name, dest_legal.signatory_designation),
        ]
        for x, title, sign_name, sign_role in blocks:
            pdf.setStrokeColor(colors.HexColor("#CBD5E1"))
            pdf.rect(x, y, 58 * mm, 16 * mm, fill=0, stroke=1)
            pdf.setFont("Helvetica-Bold", 7.6)
            pdf.drawString(x + 2 * mm, y + 12.2 * mm, title)
            pdf.setFont("Helvetica", 7)
            pdf.drawString(x + 2 * mm, y + 7.8 * mm, f"Name: {sign_name or '-'}")
            pdf.drawString(x + 2 * mm, y + 4.2 * mm, f"Designation: {sign_role or '-'}")
            pdf.drawString(x + 2 * mm, y + 0.8 * mm, "Signature: ____________________")

    @classmethod
    def _draw_footer(cls, pdf, challan: DeliveryChallan):
        digest = sha1(
            f"{challan.id}|{challan.updated_at.isoformat() if challan.updated_at else ''}".encode("utf-8")
        ).hexdigest()[:12].upper()
        pdf.setFont("Helvetica", 7)
        pdf.setFillColor(colors.HexColor("#475569"))
        pdf.drawString(10 * mm, 6 * mm, f"Generated On: {cls._fmt_dt(timezone.now())}")
        pdf.drawRightString(200 * mm, 6 * mm, f"Document Ref: {challan.dc_no or challan.id} | Hash: {digest}")

    @classmethod
    def _draw_wrapped(
        cls,
        pdf,
        value: str,
        x: float,
        y: float,
        max_width: float,
        line_height: float,
        max_lines: int,
    ):
        text = (value or "").strip()
        if not text:
            pdf.drawString(x, y, "-")
            return
        words = text.split()
        lines = []
        cur = []
        for word in words:
            test = " ".join(cur + [word]).strip()
            if pdf.stringWidth(test, "Helvetica", 7.6) <= max_width:
                cur.append(word)
                continue
            lines.append(" ".join(cur).strip())
            cur = [word]
            if len(lines) >= max_lines:
                break
        if cur and len(lines) < max_lines:
            lines.append(" ".join(cur).strip())

        for i, line in enumerate(lines[:max_lines]):
            suffix = "..." if i == max_lines - 1 and len(words) > len(" ".join(lines).split()) else ""
            pdf.drawString(x, y - i * line_height, f"{line}{suffix}")

    @classmethod
    def generate_pdf_bytes(cls, challan: DeliveryChallan) -> bytes:
        if canvas is None or A4 is None or mm is None or colors is None:
            raise RuntimeError(
                "PDF engine unavailable: reportlab is not installed in backend runtime."
            )

        challan = DeliveryChallan.objects.select_related(
            "from_plant",
            "to_plant",
            "source_job",
            "target_job",
        ).prefetch_related(
            "items__roll",
            "items__material",
            "items__from_location",
            "items__to_location",
        ).get(id=challan.id)

        source_legal = cls._get_legal_profile(challan.from_plant)
        dest_legal = cls._get_legal_profile(challan.to_plant)

        buffer = BytesIO()
        pdf = canvas.Canvas(buffer, pagesize=A4)

        cls._draw_header(pdf, challan, source_legal, dest_legal)
        y, totals = cls._draw_items(pdf, challan.items.all().order_by("created_at"), 220 * mm)
        cls._draw_totals(pdf, y, totals)
        cls._draw_signatures(pdf, y - 16 * mm, source_legal, dest_legal)
        cls._draw_footer(pdf, challan)

        pdf.showPage()
        pdf.save()
        buffer.seek(0)
        return buffer.getvalue()
