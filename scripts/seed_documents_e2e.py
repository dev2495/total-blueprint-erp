"""Seed the bills & documents / job-work end-to-end fixture in the isolated `tpp_e2e` database only.

Creates two plants (Dabhel, Kachigam) with legal profiles, one account per role
in the documents permission matrix (random local-only passwords written to
`.runtime/e2e/credentials.json`, mode 0600, never printed), the real vendor
masters used by the sample bills (re-using the rows already created by the
partner-name seed migration where they exist), machines, film materials, RM
rolls, a pouch job-work production job with six printed rolls, a sales DC and
an inter-plant challan for outward matching, and one synthetic gate bill
(Sai Enterprises S1001) whose page is generated here and watermarked
"SYNTHETIC QA".

Run from the repo root with DB_NAME=tpp_e2e:
    venv/bin/python manage.py shell -c "exec(open('scripts/seed_documents_e2e.py').read())"
"""
import hashlib
import io
import json
import os
import secrets
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from apps.factory.models import Machine, Plant, PlantLegalProfile, Process, WorkCenter
from apps.gate.models import GateAssignment, InwardBillIntake, InwardBillPage
from apps.inventory.models import DeliveryChallan as InterPlantChallan
from apps.inventory.models import InterPlantChallanItem, InventoryLocation, InventoryRoll, RollMovement, Vendor
from apps.materials.models import InventoryMaterial
from apps.production.models import DeliveryChallan as SalesChallan
from apps.production.models import DeliveryChallanItem, ProductionJob
from apps.routing.models import RoutingRule
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.templates.models import TemplateBlueprint, TemplateProcessStep
from apps.users.models import Role, User

DB_REQUIRED = "tpp_e2e"
CUSTOMER = "Sample Nutrition Co"
FONT_DIR = Path("/System/Library/Fonts/Supplemental")


def font(size, bold=False):
    try:
        return ImageFont.truetype(str(FONT_DIR / ("Arial Bold.ttf" if bold else "Arial.ttf")), size)
    except OSError:
        return ImageFont.load_default(size=size)


def synthetic_sai_invoice():
    """A synthetic, watermarked tax invoice for 6 BOPP rolls (no client document is used)."""
    W, H = 1240, 1754
    img = Image.new("RGB", (W, H), (252, 251, 247))
    d = ImageDraw.Draw(img)
    d.rectangle([40, 40, W - 40, H - 40], outline=(40, 40, 40), width=2)
    d.text((70, 70), "SAI ENTERPRISES", font=font(44, True), fill=(20, 30, 60))
    d.text((70, 128), "Film traders · synthetic QA address, Silvassa 396230", font=font(22), fill=(40, 40, 40))
    d.text((70, 158), "GSTIN 26AAAAA0000A1Z0 (sample)", font=font(22), fill=(40, 40, 40))
    d.rectangle([W - 380, 70, W - 70, 130], outline=(20, 30, 60), width=3)
    d.text((W - 352, 82), "TAX INVOICE", font=font(34, True), fill=(20, 30, 60))
    d.line([40, 210, W - 40, 210], fill=(40, 40, 40), width=2)
    meta = [("Invoice No.", "S1001"), ("Invoice Date", "08-10-2026"), ("LR No.", "NRD-0000000 (sample)"), ("Vehicle", "DD-03-X-0000")]
    for i, (k, v) in enumerate(meta):
        x = 70 if i % 2 == 0 else 650
        y = 232 + (i // 2) * 42
        d.text((x, y), f"{k}:", font=font(24, True), fill=(30, 30, 30))
        d.text((x + 180, y), v, font=font(24), fill=(30, 30, 30))
    top = 360
    cols = [70, 130, 620, 760, 900, 1030, W - 70]
    heads = ["Sr", "Description", "HSN", "Rolls", "Kg", "Rate"]
    d.rectangle([60, top, W - 70, top + 50], fill=(230, 233, 240), outline=(40, 40, 40), width=2)
    for i, h in enumerate(heads):
        d.text((cols[i], top + 12), h, font=font(24, True), fill=(20, 20, 20))
    d.text((cols[0], top + 80), "1", font=font(24), fill=(20, 20, 20))
    d.text((cols[1], top + 80), "BOPP plain film 20 mic x 830 mm", font=font(24), fill=(20, 20, 20))
    d.text((cols[2], top + 80), "39202020", font=font(24), fill=(20, 20, 20))
    d.text((cols[3], top + 80), "6", font=font(24), fill=(20, 20, 20))
    d.text((cols[4], top + 80), "540.000", font=font(24), fill=(20, 20, 20))
    d.text((cols[5], top + 80), "165.00", font=font(24), fill=(20, 20, 20))
    rows = [("Taxable value", "89,100.00"), ("IGST @ 18%", "16,038.00"), ("Invoice total", "1,05,138.00")]
    y = top + 200
    for k, v in rows:
        d.rectangle([600, y, W - 70, y + 56], outline=(80, 80, 80), width=1)
        d.text((620, y + 14), k, font=font(26, k == "Invoice total"), fill=(20, 20, 20))
        d.text((960, y + 14), v, font=font(26, k == "Invoice total"), fill=(20, 20, 20))
        y += 56
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(overlay).text((W * 0.08, H * 0.5), "SYNTHETIC QA DOCUMENT · NOT A REAL INVOICE", font=font(54, True), fill=(200, 40, 40, 60))
    overlay = overlay.rotate(28, center=(W / 2, H / 2))
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    img = img.rotate(-0.6, resample=Image.Resampling.BICUBIC, fillcolor=(96, 92, 86)).filter(ImageFilter.GaussianBlur(0.4))
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=84, optimize=True)
    return out.getvalue()


def location(plant, code):
    return InventoryLocation.objects.filter(plant=plant, code=code).order_by("-is_system").first()


def vendor(name, *, aliases=(), **fields):
    """Re-use the vendor master the partner seed migration already created (live-like data)."""
    found = None
    for candidate in (name, *aliases):
        found = Vendor.objects.filter(name__iexact=candidate).first()
        if found:
            break
    if found is None:
        code = "E2E-" + "".join(ch for ch in name.upper() if ch.isalnum())[:20]
        found = Vendor.objects.create(name=name, code=code, **fields)
        return found
    for key, value in fields.items():
        setattr(found, key, value)
    found.save()
    return found


def run():
    if settings.DATABASES["default"]["NAME"] != DB_REQUIRED or os.environ.get("DB_NAME") != DB_REQUIRED:
        raise RuntimeError(f"This fixture only seeds the isolated {DB_REQUIRED} database (DB_NAME={DB_REQUIRED}).")
    output = Path(settings.BASE_DIR) / ".runtime" / "e2e" / "credentials.json"
    # Idempotent on the database, not the credentials file: a fresh database is
    # always seeded (new local-only passwords replace the old file).
    if Plant.objects.filter(code="DBH-U1").exists():
        print("Documents E2E fixture already exists; credentials preserved.")
        return
    data = {"users": {}}
    now = timezone.now()
    with transaction.atomic():
        dabhel = Plant.objects.create(code="DBH-U1", name="Dabhel (Unit 1)")
        kachigam = Plant.objects.create(code="KCG-U2", name="Kachigam (Unit 2)")
        PlantLegalProfile.objects.create(
            plant=dabhel, legal_name="Total Poly Print Pvt Ltd", gstin="26AABCT1234F1Z5",
            address="Plot 12, Dabhel Industrial Estate, Nani Daman 396210", authorized_signatory_name="Plant Head",
        )
        PlantLegalProfile.objects.create(
            plant=kachigam, legal_name="Total Poly Print Pvt Ltd", gstin="26AABCT1234F2Z4",
            address="Sr No 375/14, Kachigam, Nani Daman 396210", authorized_signatory_name="Plant Head",
        )

        # ------------------------------------------------------------ roles & users
        roles = {code: Role.objects.get_or_create(code=code, defaults={"name": code.title()})[0] for code in ["OWNER", "STORE", "PLANNER", "DISPATCH", "WATCHMAN"]}
        roles["ACCOUNTS"] = Role.objects.create(code="ACCOUNTS", name="Accounts", description="Bill upload and register (E2E custom role)", default_permissions=["documents.upload", "documents.view"])
        accounts = [
            ("owner", "e2e-owner", "OWNER", True, [], "Owner"),
            ("store", "e2e-store", "STORE", False, [], "Store Desk"),
            ("planner", "e2e-planner", "PLANNER", False, [], "Planner"),
            ("planner_extra", "planner-extra", "PLANNER", False, ["outward.reconcile"], "Planner Extra"),
            ("dispatch", "e2e-dispatch", "DISPATCH", False, [], "Dispatch Desk"),
            ("watchman", "e2e-watchman", "WATCHMAN", False, [], "Gate Watchman"),
            ("accounts", "e2e-accounts", "ACCOUNTS", False, [], "Accounts Clerk"),
        ]
        for key, username, role_code, owner, extra, full_name in accounts:
            password = secrets.token_urlsafe(18)
            first, _, last = full_name.partition(" ")
            user = User.objects.create(username=username, role=roles[role_code], is_owner=owner, extra_permissions=extra, first_name=first, last_name=last)
            user.set_password(password)
            user.save(update_fields=["password"])
            data["users"][key] = {"username": username, "password": password, "id": str(user.id), "role": role_code}
        watchman = User.objects.get(id=data["users"]["watchman"]["id"])
        GateAssignment.objects.create(user=watchman, plant=dabhel)

        # ---------------------------------------------------------------- vendors
        vendors = {
            "sai": vendor("Sai Enterprises", type="RM", gst_no="26AAAAA0000A1Z0", mailing_state="Dadra and Nagar Haveli and Daman and Diu"),
            "veedee": vendor(
                "Vee Dee Enterprises", type="JOBWORK", gst_no="24ABCPV1234K1Z9", address="Plot 7, GIDC Vapi", mailing_state="Gujarat",
                mailing_pincode="396195", jobwork_capabilities=["POUCH_JOBWORK"],
                jobwork_rates=[{"process_code": "POUCH_JOBWORK", "rate": "2.75", "uom": "PCS"}],
            ),
            "dm": vendor("D.M. Corporation", aliases=("D.M.Corporation",), type="SERVICE", mailing_state="Gujarat"),
            "mamata": vendor("Mamata Machinery", aliases=("Mamata Machinery Limited",), type="RM", mailing_state="Gujarat"),
            "xl": vendor("XL Plastics Machinery", aliases=("XL Plastic Machinery Pvt. Ltd.", "XL Plastics"), type="SERVICE", mailing_state="Gujarat"),
            "baba": vendor("Baba Vishwakarma Engg Works", aliases=("Baba Vishwakarma Engg. Works",), type="SERVICE", mailing_state="Dadra and Nagar Haveli and Daman and Diu"),
            "prime": vendor("Prime Systems", type="SERVICE", mailing_state="Gujarat"),
            "shree": vendor("Shree Machinery", type="RM", mailing_state="Gujarat"),
            "schoeller": vendor("Schoeller India", aliases=("Schoeller India Industries Pvt. Ltd",), type="RM", mailing_state="Maharashtra"),
        }
        data["vendors"] = {key: {"id": str(v.id), "name": v.name} for key, v in vendors.items()}

        # ------------------------------------------------------- work centres, machines
        wip = location(dabhel, "WIP")
        fg = location(dabhel, "FG")
        rm = location(dabhel, "RM")
        pouch_wc = WorkCenter.objects.create(plant=dabhel, name="Pouching", code="DBH-POUCH", default_wip_location=wip)
        extr_wc = WorkCenter.objects.create(plant=dabhel, name="Extrusion", code="DBH-EXTR", default_wip_location=wip)
        qc_wc = WorkCenter.objects.create(plant=dabhel, name="Stores & QC", code="DBH-QC", default_wip_location=wip)
        WorkCenter.objects.create(plant=kachigam, name="Kachigam Printing", code="KCG-PRINT", default_wip_location=location(kachigam, "WIP"))
        machines = {
            "mamata": Machine.objects.create(work_center=pouch_wc, name="Mamata pouch machine", code="MAM-PM-1"),
            "zipper": Machine.objects.create(work_center=pouch_wc, name="Zipper machine", code="ZIP-1"),
            "extruder": Machine.objects.create(work_center=extr_wc, name="XL blown film extruder", code="XL-BF-1"),
            "scale": Machine.objects.create(work_center=qc_wc, name="Weighing scale 200 kg", code="WS-200"),
        }
        data["machines"] = {key: {"id": str(m.id), "name": m.name} for key, m in machines.items()}

        # ------------------------------------------------------------- materials
        bopp_family = InventoryMaterial.objects.create(code="E2E-BOPP-FAM", name="BOPP film", category="FILM_FAMILY", base_uom="KG", density_gcm3=Decimal("0.9100"))
        bopp = InventoryMaterial.objects.create(code="E2E-BOPP20", name="BOPP plain 20 mic", category="FILM_VARIANT", base_uom="KG", parent_family=bopp_family, density_gcm3=Decimal("0.9100"))
        pet_family = InventoryMaterial.objects.create(code="E2E-PET-FAM", name="PET film", category="FILM_FAMILY", base_uom="KG", density_gcm3=Decimal("1.4000"))
        printed = InventoryMaterial.objects.create(code="E2E-PRT-PETPE", name="Printed PET/PE laminate", category="FILM_VARIANT", base_uom="KG", parent_family=pet_family, density_gcm3=Decimal("1.1000"))
        data["materials"] = {"bopp": str(bopp.id), "bopp_family": str(bopp_family.id), "printed": str(printed.id)}

        def make_roll(label, weight, loc, *, material, job=None, rate="165"):
            roll = InventoryRoll.objects.create(
                label_id=label, material=material, weight_kg=Decimal(str(weight)), original_weight_kg=Decimal(str(weight)),
                width_mm=Decimal("830"), thickness_micron=Decimal("20"), location=loc, plant=loc.plant, status="AVAILABLE",
                production_job=job, created_by_job=job, meta_json={"unit_cost_per_kg": rate},
            )
            RollMovement.objects.create(roll=roll, to_location=loc, reason="GRN", reason_note="E2E opening stock")
            return roll

        for index, weight in enumerate(["91.4", "88.2", "90.6"], start=1):
            make_roll(f"E2E-BOPP-{index:03d}", weight, rm, material=bopp)

        # ----------------------------------------------------- job-work production job
        process = Process.objects.create(code="POUCH_JOBWORK", name="Pouching (job work)", input_form="ROLL", output_form="BULK", roll_behavior="NONE")
        route = RoutingRule.objects.create(name="Quick dry pouch route", ordered_processes=[process.code])
        template = TemplateBlueprint.objects.create(name="Quick dry pouch 400x71", fg_type="POUCH", status="DRAFT", routing_rule=route, pouch_style="PILLOW")
        TemplateProcessStep.objects.create(template=template, sequence_number=1, process=process)
        order = SalesOrder.objects.create(
            customer_name=CUSTOMER, order_name=f"{CUSTOMER} quick dry pouches", order_type="MTO", status="CONFIRMED",
            geometry_override={"fg_type": "POUCH"}, commercial_confirmed_at=now, delivery_date=timezone.localdate() + timedelta(days=12),
        )
        item = SalesOrderItem.objects.create(
            sales_order=order, template=template, mode="TEMPLATE", line_name="Quick dry pouch 400x71",
            geometry_snapshot={"fg_type": "POUCH", "width_mm": 400, "height_mm": 71}, layer_snapshot=[], printing_snapshot={},
            addons_snapshot=[], packaging_snapshot={}, bom_snapshot={},
            unit_weight_g=Decimal("10"), total_weight_kg=Decimal("288.2500"), qty_uom="PCS", qty_value=Decimal("28825"),
            price_basis="PCS", unit_price=Decimal("1.0000"),
        )
        job = ProductionJob.objects.create(
            job_number="JOB-2627-0418", template=template, sales_order_item=item, routing_rule=route,
            current_step_index=0, current_process=process, process=process, work_center=pouch_wc,
            from_location=wip, to_location=fg, input_form=process.input_form, output_form=process.output_form,
            quantity=Decimal("28825"), remaining_qty=Decimal("28825"), uom="PCS", job_state="PAUSED",
            status="QUEUED", is_on_hold=True,
        )
        printed_rolls = []
        for index, weight in enumerate(["87.4", "86.9", "88.1", "87.6", "86.4", "87.2"], start=1):
            printed_rolls.append(make_roll(f"PRT-0418-{index:02d}", weight, wip, material=printed, job=job, rate="240"))
        data["job"] = {"id": str(job.id), "number": job.job_number, "sales_order": str(order.id), "rolls": [str(r.id) for r in printed_rolls]}

        # --------------------------------------------- outward candidates (sales DC, IPC)
        dc = SalesChallan.objects.create(
            dc_no="DC-2627-0412", customer_name=CUSTOMER, sales_order=order, plant=dabhel, status="DISPATCHED",
            vehicle_no="DD03K4471", transporter_name="Shree Ram Roadlines", dispatch_date=now - timedelta(minutes=20),
        )
        DeliveryChallanItem.objects.create(challan=dc, sales_order_item=item, weight_kg=Decimal("212.5000"), qty_pcs=15000)
        ipc = InterPlantChallan.objects.create(
            from_plant=dabhel, to_plant=kachigam, dc_no="IPC-2627-0007", status="IN_TRANSIT", dispatched_at=now - timedelta(minutes=25),
            vehicle_no="DD03K9902",
        )
        moving = make_roll("E2E-BOPP-IPC", "92.3", rm, material=bopp)
        InterPlantChallanItem.objects.create(
            challan=ipc, line_type="ROLL", roll=moving, material=bopp, from_location=rm, to_location=location(kachigam, "RM"),
            planned_qty_kg=Decimal("92.3"), dispatched_qty_kg=Decimal("92.3"), status="DISPATCHED",
        )
        data["outward_candidates"] = {"sales_dc": {"id": str(dc.id), "number": dc.dc_no}, "interplant": {"id": str(ipc.id), "number": ipc.dc_no}}

        # -------------------------------- synthetic Sai Enterprises stock bill at the gate
        raw = synthetic_sai_invoice()
        with Image.open(io.BytesIO(raw)) as probe:
            width, height = probe.size
        bill = InwardBillIntake.objects.create(
            plant=dabhel, created_by=watchman, arrival_at=now - timedelta(hours=1, minutes=5),
            content_hash=hashlib.sha256(hashlib.sha256(raw).digest()).hexdigest(),
        )
        InwardBillPage.objects.create(intake=bill, page_number=1, data=raw, width=width, height=height, byte_size=len(raw), sha256=hashlib.sha256(raw).hexdigest())
        data["sai_bill"] = str(bill.id)
        data["plants"] = {"dabhel": str(dabhel.id), "kachigam": str(kachigam.id)}

        # Write the new local-only passwords before the seed commits, via a
        # private temp file and an atomic replace, so the database never holds
        # accounts whose passwords were lost.
        output.parent.mkdir(parents=True, exist_ok=True)
        temp = output.with_suffix(".json.tmp")
        if temp.exists():
            temp.unlink()
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as stream:
            json.dump(data, stream, indent=2)
        os.replace(temp, output)
    print("Documents E2E fixture seeded; credentials saved privately (not printed).")


run()
