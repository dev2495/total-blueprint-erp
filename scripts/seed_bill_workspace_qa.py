"""Seed a synthetic bill-workspace QA fixture in the isolated `tpp_ws_a` database only.

Creates one plant, a store user and an owner (random passwords written privately
to `.runtime/ws-a/credentials.json`, mode 0600, never printed), a vendor, a few
materials, an open PO, a receiving warehouse and one inward gate bill with two
generated JPEG pages that look like a photographed tax invoice. Page 2 is stored
sideways (as phone photos often are) so the rotate / "save rotation for
everyone" path can be exercised. Every page carries a "SYNTHETIC QA" watermark.

Run from the repo root (or a backend snapshot) with DB_NAME=tpp_ws_a:
    venv/bin/python manage.py shell -c "exec(open('scripts/seed_bill_workspace_qa.py').read())"
"""
import hashlib
import io
import json
import math
import os
import secrets
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from apps.factory.models import Plant
from apps.gate.models import InwardBillIntake, InwardBillPage
from apps.inventory.models import InventoryLocation, Vendor
from apps.materials.models import InventoryMaterial
from apps.procurement.models import PurchaseOrder, PurchaseOrderItem
from apps.users.models import Role, User

DB_REQUIRED = "tpp_ws_a"
FONT_DIR = Path("/System/Library/Fonts/Supplemental")


def font(size, bold=False):
    name = "Arial Bold.ttf" if bold else "Arial.ttf"
    try:
        return ImageFont.truetype(str(FONT_DIR / name), size)
    except OSError:
        return ImageFont.load_default(size=size)


LINES = [
    ("LDPE Granules 1022FA (Reliance)", "39011010", "1,500.000", "KG", "112.50", "1,68,750.00"),
    ("LLDPE Granules 218W (SABIC)", "39014010", "1,000.000", "KG", "109.80", "1,09,800.00"),
    ("White Masterbatch WM-60", "32061190", "250.000", "KG", "142.00", "35,500.00"),
    ("Slip Additive SA-5 Masterbatch", "38123990", "75.000", "KG", "188.00", "14,100.00"),
    ("Polyurethane Adhesive PU-2251 (A)", "35069190", "180.000", "KG", "265.00", "47,700.00"),
    ("Hardener PU-2251 (B)", "35069190", "60.000", "KG", "310.00", "18,600.00"),
    ("Ethyl Acetate (Solvent)", "29153100", "400.000", "KG", "96.50", "38,600.00"),
    ("Printing Ink Cyan NC-Base", "32151190", "45.000", "KG", "420.00", "18,900.00"),
]


def page_one():
    W, H = 1240, 1754
    img = Image.new("RGB", (W, H), (252, 251, 247))
    d = ImageDraw.Draw(img)
    d.rectangle([40, 40, W - 40, H - 40], outline=(40, 40, 40), width=2)
    d.text((70, 70), "VEE DEE POLYMERS & CHEMICALS", font=font(40, True), fill=(20, 30, 60))
    d.text((70, 122), "Plot 14, GIDC Phase II, Vatva, Ahmedabad 382445 (synthetic address)", font=font(20), fill=(40, 40, 40))
    d.text((70, 150), "GSTIN 24AAACV0000Q1ZX (sample) · PAN AAACV0000Q · Ph 079-0000 0000", font=font(20), fill=(40, 40, 40))
    d.rectangle([W - 380, 70, W - 70, 130], outline=(20, 30, 60), width=3)
    d.text((W - 352, 82), "TAX INVOICE", font=font(34, True), fill=(20, 30, 60))
    d.line([40, 200, W - 40, 200], fill=(40, 40, 40), width=2)
    meta = [
        ("Invoice No.", "VDP/2627/0418"),
        ("Invoice Date", "08-10-2026"),
        ("E-way Bill", "3410 0000 0418 (sample)"),
        ("Vehicle No.", "GJ-01-AT-4471"),
        ("Transporter", "Shree Ram Roadlines"),
        ("PO Ref.", "PO-WSA-OPEN"),
    ]
    for i, (k, v) in enumerate(meta):
        x = 70 if i % 2 == 0 else 650
        y = 220 + (i // 2) * 40
        d.text((x, y), f"{k}:", font=font(22, True), fill=(30, 30, 30))
        d.text((x + 175, y), v, font=font(22), fill=(30, 30, 30))
    d.line([40, 350, W - 40, 350], fill=(40, 40, 40), width=2)
    d.text((70, 365), "Bill to / Ship to", font=font(22, True), fill=(30, 30, 30))
    d.text((70, 398), "Total Poly Print · Workspace QA Factory", font=font(22), fill=(30, 30, 30))
    d.text((70, 428), "Survey 221, Changodar, Ahmedabad (synthetic)", font=font(22), fill=(30, 30, 30))
    d.text((650, 365), "State: Gujarat (24)   Place of supply: Gujarat", font=font(22), fill=(30, 30, 30))
    top = 480
    cols = [70, 130, 560, 700, 840, 920, 1040, W - 70]
    heads = ["Sr", "Description of goods", "HSN", "Qty", "Unit", "Rate", "Amount (₹)"]
    d.rectangle([cols[0] - 10, top, cols[-1], top + 48], fill=(230, 233, 240), outline=(40, 40, 40), width=2)
    for i, h in enumerate(heads):
        d.text((cols[i], top + 12), h.replace("₹", "Rs"), font=font(21, True), fill=(20, 20, 20))
    y = top + 48
    for n, (desc, hsn, qty, unit, rate, amt) in enumerate(LINES, start=1):
        d.line([cols[0] - 10, y + 62, cols[-1], y + 62], fill=(170, 170, 170), width=1)
        d.text((cols[0], y + 18), str(n), font=font(22), fill=(20, 20, 20))
        d.text((cols[1], y + 18), desc, font=font(22), fill=(20, 20, 20))
        d.text((cols[2], y + 18), hsn, font=font(22), fill=(20, 20, 20))
        d.text((cols[3], y + 18), qty, font=font(22), fill=(20, 20, 20))
        d.text((cols[4], y + 18), unit, font=font(22), fill=(20, 20, 20))
        d.text((cols[5], y + 18), rate, font=font(22), fill=(20, 20, 20))
        d.text((cols[6], y + 18), amt, font=font(22), fill=(20, 20, 20))
        y += 62
    for x in cols[1:-1]:
        d.line([x - 12, top, x - 12, y], fill=(120, 120, 120), width=1)
    d.rectangle([cols[0] - 10, top, cols[-1], y], outline=(40, 40, 40), width=2)
    d.text((cols[1], y + 24), "Sub-total (page 1)", font=font(24, True), fill=(20, 20, 20))
    d.text((cols[6], y + 24), "4,51,950.00", font=font(24, True), fill=(20, 20, 20))
    d.text((70, H - 160), "Continued on page 2 …", font=font(22), fill=(60, 60, 60))
    d.text((70, H - 120), "Goods once sold will not be taken back. Interest @18% p.a. after due date. Subject to Ahmedabad jurisdiction.", font=font(18), fill=(80, 80, 80))
    return watermark_and_photo(img, tilt=-0.8)


def page_two():
    W, H = 1240, 1754
    img = Image.new("RGB", (W, H), (251, 250, 246))
    d = ImageDraw.Draw(img)
    d.rectangle([40, 40, W - 40, H - 40], outline=(40, 40, 40), width=2)
    d.text((70, 70), "VEE DEE POLYMERS & CHEMICALS · Invoice VDP/2627/0418 · Page 2 of 2", font=font(26, True), fill=(20, 30, 60))
    rows = [
        ("Taxable value", "4,51,950.00"),
        ("CGST @ 9%", "40,675.50"),
        ("SGST @ 9%", "40,675.50"),
        ("Freight (as per LR 77812)", "6,500.00"),
        ("Round off", "-1.00"),
        ("Invoice total", "5,39,800.00"),
    ]
    y = 160
    for k, v in rows:
        bold = k == "Invoice total"
        d.rectangle([600, y, W - 70, y + 56], outline=(80, 80, 80), width=1, fill=(232, 236, 244) if bold else None)
        d.text((620, y + 14), k, font=font(24, bold), fill=(20, 20, 20))
        d.text((960, y + 14), v, font=font(24, bold), fill=(20, 20, 20))
        y += 56
    d.text((70, 160), "Amount in words:", font=font(22, True), fill=(20, 20, 20))
    d.text((70, 196), "Rupees Five Lakh Thirty-Nine", font=font(22), fill=(20, 20, 20))
    d.text((70, 226), "Thousand Eight Hundred only", font=font(22), fill=(20, 20, 20))
    d.text((70, 560), "HSN summary", font=font(24, True), fill=(20, 20, 20))
    hsn = [("39011010", "1,68,750.00"), ("39014010", "1,09,800.00"), ("32061190", "35,500.00"), ("35069190", "66,300.00"), ("29153100", "38,600.00")]
    y = 600
    for code, val in hsn:
        d.text((70, y), code, font=font(22), fill=(20, 20, 20))
        d.text((300, y), val, font=font(22), fill=(20, 20, 20))
        d.line([70, y + 34, 560, y + 34], fill=(190, 190, 190), width=1)
        y += 44
    d.text((70, 900), "Bank: Sample Co-op Bank · A/c 000000000418 · IFSC SAMP0000418 (synthetic)", font=font(22), fill=(30, 30, 30))
    d.text((70, 940), "Payment terms: 45 days from invoice date · Due 22-11-2026", font=font(22), fill=(30, 30, 30))
    d.text((W - 470, H - 260), "For VEE DEE POLYMERS & CHEMICALS", font=font(22, True), fill=(20, 20, 20))
    d.line([W - 470, H - 150, W - 120, H - 150], fill=(40, 40, 40), width=2)
    d.text((W - 400, H - 140), "Authorised signatory", font=font(20), fill=(60, 60, 60))
    d.text((70, H - 140), "Received in good condition: ______________", font=font(22), fill=(40, 40, 40))
    photo = watermark_and_photo(img, tilt=0.6)
    # Stored sideways, as a phone photo often is.
    return photo.rotate(90, expand=True)


def watermark_and_photo(img, tilt):
    W, H = img.size
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    text = "SYNTHETIC QA DOCUMENT · NOT A REAL INVOICE"
    od.text((W * 0.08, H * 0.48), text, font=font(54, True), fill=(200, 40, 40, 46))
    overlay = overlay.rotate(28, center=(W / 2, H / 2))
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    # Gentle lighting falloff + tilt so it reads like a photographed sheet.
    shade = Image.new("L", (W, H))
    sd = shade.load()
    for yy in range(0, H, 4):
        for xx in range(0, W, 4):
            v = int(255 - 26 * (math.hypot((xx - W * 0.45) / W, (yy - H * 0.4) / H)))
            for dy in range(4):
                for dx in range(4):
                    if xx + dx < W and yy + dy < H:
                        sd[xx + dx, yy + dy] = v
    img = Image.composite(img, Image.new("RGB", (W, H), (150, 148, 140)), shade)
    img = img.rotate(tilt, resample=Image.Resampling.BICUBIC, expand=False, fillcolor=(96, 92, 86))
    return img.filter(ImageFilter.GaussianBlur(0.45))


def jpeg(img):
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=84, optimize=True)
    return out.getvalue()


def run():
    if settings.DATABASES["default"]["NAME"] != DB_REQUIRED:
        raise RuntimeError(f"This fixture only seeds the isolated {DB_REQUIRED} database.")
    output = Path(os.environ.get("WS_A_CREDENTIALS") or Path(settings.BASE_DIR) / ".runtime" / "ws-a" / "credentials.json")
    if output.exists():
        print("Bill workspace QA fixture already exists; credentials preserved.")
        return
    data = {}
    with transaction.atomic():
        plant = Plant.objects.create(code="WSA_QA", name="Workspace QA Factory")
        for label, code, owner in [("store", "STORE", False), ("owner", "OWNER", True)]:
            role, _ = Role.objects.get_or_create(code=code, defaults={"name": code.title()})
            password = secrets.token_urlsafe(18)
            user = User.objects.create(username=f"ws_a_{label}", role=role, is_owner=owner)
            user.set_password(password)
            user.save(update_fields=["password"])
            data[label] = {"username": user.username, "password": password, "id": str(user.id)}
        store = User.objects.get(id=data["store"]["id"])
        vendor = Vendor.objects.create(code="WSA_VDP", name="Vee Dee Polymers & Chemicals")
        Vendor.objects.create(code="WSA_SRL", name="Shree Ram Roadlines (transport)")
        for code, name, cat in [
            ("WSA_LDPE_1022", "LDPE Granules 1022FA", "GRANULE"),
            ("WSA_LLDPE_218W", "LLDPE Granules 218W", "GRANULE"),
            ("WSA_WMB_60", "White Masterbatch WM-60", "GRANULE"),
            ("WSA_PU_2251A", "PU Adhesive 2251 (A)", "ADHESIVE"),
            ("WSA_ETAC", "Ethyl Acetate", "SOLVENT"),
        ]:
            InventoryMaterial.objects.create(code=code, name=name, category=cat, base_uom="KG")
        location = InventoryLocation.objects.create(plant=plant, code="WSA_RM_STORE", name="Raw Material Store", type="WAREHOUSE")
        po = PurchaseOrder.objects.create(code="PO-WSA-OPEN", vendor=vendor, plant=plant, status="SENT")
        PurchaseOrderItem.objects.create(
            purchase_order=po, line_no=1, material=InventoryMaterial.objects.get(code="WSA_LDPE_1022"),
            qty_ordered=Decimal("1500"), uom="KG", rate_per_uom=Decimal("112.50"),
        )
        pages = [jpeg(page_one()), jpeg(page_two())]
        digest = hashlib.sha256(b"".join(hashlib.sha256(p).digest() for p in pages)).hexdigest()
        bill = InwardBillIntake.objects.create(
            plant=plant,
            created_by=store,
            content_hash=digest,
            arrival_at=timezone.now() - timedelta(hours=2, minutes=14),
            review_data={
                "vendor_id": str(vendor.id),
                "vendor_name": vendor.name,
                "invoice_number": "VDP/2627/0418",
                "invoice_date": "2026-10-08",
                "vehicle_number": "GJ-01-AT-4471",
            },
        )
        for number, raw in enumerate(pages, start=1):
            with Image.open(io.BytesIO(raw)) as probe:
                width, height = probe.size
            InwardBillPage.objects.create(
                intake=bill, page_number=number, data=raw, width=width, height=height,
                byte_size=len(raw), sha256=hashlib.sha256(raw).hexdigest(),
            )
        data.update(plant=str(plant.id), vendor=str(vendor.id), location=str(location.id), po=str(po.id), bill=str(bill.id))
    output.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as stream:
        json.dump(data, stream)
    print("Bill workspace QA fixture seeded; credentials saved privately (not printed).")


run()
