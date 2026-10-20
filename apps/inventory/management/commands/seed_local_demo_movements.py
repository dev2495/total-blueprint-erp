"""A few goods movements on the local stack, so Goods in & out has something to show (local only).

Through the same APIs the screens use, as the local admin:
* a returnable gate pass for two printing rollers out for milling, due back yesterday (late);
* a returnable gate pass for a load cell, issued but not yet out (prepared);
* a non-returnable gate pass for trim scrap, out and closed (done);
* an emergency job-work order at Vee Dee with one demo film roll on its challan (outside).
Runs once (marker: party "DEMO · ..."); refuses a production settings profile.
"""
import uuid
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from rest_framework.test import APIClient

from apps.factory.models import Machine, Plant
from apps.gate.gate_pass_services import mark_gate_pass_out
from apps.gate.models import GatePass
from apps.gate.services import gate_today
from apps.inventory.models import InventoryRoll, Vendor

MARK = "DEMO · "


def tok():
    return str(uuid.uuid4())


class Command(BaseCommand):
    help = "Seed a few demo goods movements (gate passes, job work) on the local stack."

    def add_arguments(self, parser):
        parser.add_argument("--plant", default="01")

    def handle(self, *args, **options):
        with transaction.atomic():
            self._seed(**options)

    def _seed(self, **options):
        if getattr(settings, "IS_PRODUCTION", False) or str(getattr(settings, "DJANGO_ENV", "")).lower().startswith("prod"):
            raise CommandError("Refusing to seed demo movements on a production settings profile.")
        if GatePass.objects.filter(party_name__startswith=MARK).exists():
            self.stdout.write("demo movements already seeded")
            return
        plant = Plant.objects.filter(code=options["plant"]).first()
        if plant is None:
            raise CommandError(f"Plant {options['plant']} not found.")
        admin = get_user_model().objects.filter(username="admin").first()
        if admin is None:
            raise CommandError("The local admin account is missing.")
        api = APIClient(SERVER_NAME="127.0.0.1")
        api.force_authenticate(admin)
        today = gate_today()
        printer = Machine.objects.filter(work_center__plant=plant, work_center__name__icontains="print").first() or Machine.objects.filter(work_center__plant=plant).first()

        def gate_pass(kind, party, purpose, lines, *, due=None, out=False):
            body = {"client_token": tok(), "plant": str(plant.id), "kind": kind, "party_name": f"{MARK}{party}", "purpose": purpose, "lines": lines}
            if due:
                body["expected_return_date"] = due.isoformat()
            made = api.post("/api/gate/gate-passes/", body, format="json")
            if made.status_code not in (200, 201):
                raise CommandError(f"gate pass {party}: {made.data}")
            issued = api.post(f"/api/gate/gate-passes/{made.data['id']}/issue/", {"client_token": tok(), "version": made.data["version"]}, format="json")
            if issued.status_code != 200:
                raise CommandError(f"issue {party}: {issued.data}")
            if out:
                mark_gate_pass_out(made.data["id"], timezone.now() - timedelta(days=5), admin)
            return GatePass.objects.get(id=made.data["id"])

        rollers = gate_pass("RETURNABLE", "Baba Vishwakarma Engg", "REPAIR", [
            {"description": "Rubber printing roller (milling)", "quantity": "2", "uom": "NOS", "machine": str(printer.id) if printer else None},
        ], due=today, out=True)
        # Back-date the due date so the register shows a late return (demo only).
        GatePass.objects.filter(id=rollers.id).update(expected_return_date=today - timedelta(days=1))
        gate_pass("RETURNABLE", "Prime Systems", "CALIBRATION", [{"description": "Load cell 500 kg (weighing scale)", "quantity": "1", "uom": "NOS"}], due=today + timedelta(days=7))
        gate_pass("NON_RETURNABLE", "Shree Scrap Traders", "SCRAP_SALE", [{"description": "LD trim waste", "quantity": "180", "uom": "KG"}], out=True)

        vendor = Vendor.objects.filter(code__iexact="VEEDEE").first() or Vendor.objects.filter(type__in=["JOBWORK", "BOTH"], status="ACTIVE").first()
        roll = InventoryRoll.objects.filter(label_id__startswith="LIVE-DEMO-", status="AVAILABLE", plant=plant).order_by("label_id").first()
        jw_note = "no job-work vendor or demo roll"
        if vendor and roll:
            order = api.post("/api/inventory/job-work/", {
                "client_token": tok(), "vendor": str(vendor.id), "plant": str(plant.id), "mode": "EMERGENCY",
                "emergency_reason": f"{MARK}printing line down; outside printing for one roll", "expected_output_kind": "ROLLS",
                "expected_return_date": (today + timedelta(days=3)).isoformat(),
            }, format="json")
            if order.status_code == 201:
                sent = api.post(f"/api/inventory/job-work/{order.data['order']['id']}/dispatch/", {
                    "client_token": tok(), "rolls": [{"roll_id": str(roll.id)}], "hsn_code": "3920", "vehicle_no": "GJ15JW0042",
                }, format="json")
                jw_note = f"{order.data['order']['number']} {'sent' if sent.status_code == 201 else sent.data}"
            else:
                jw_note = str(order.data)
        self.stdout.write(self.style.SUCCESS(f"demo movements: 3 gate passes, job work {jw_note}"))
