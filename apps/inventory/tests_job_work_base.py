"""Shared fixtures for the job-work test modules (no tests here)."""
import uuid
from datetime import timedelta
from decimal import Decimal

from django.utils import timezone
from rest_framework.test import APIClient

from apps.factory.models import Plant, PlantLegalProfile, Process, WorkCenter
from apps.inventory.models import InventoryLocation, InventoryRoll, RollMovement, Vendor
from apps.materials.models import InventoryMaterial
from apps.production.models import ProductionJob
from apps.routing.models import RoutingRule
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.templates.models import TemplateBlueprint, TemplateProcessStep
from apps.users.models import Role, User


def token():
    return str(uuid.uuid4())


class JobWorkFixtureMixin:
    """Two plants, a job worker (Vee Dee), users for every role in the matrix,
    film materials and helpers to build jobs, rolls and orders."""

    def setUp(self):
        super().setUp()
        self.plant = Plant.objects.create(code="JW-P1", name="Dabhel")
        self.other_plant = Plant.objects.create(code="JW-P2", name="Kachigam")
        PlantLegalProfile.objects.create(
            plant=self.plant, legal_name="Total Poly Print Pvt Ltd", gstin="26AABCT1234F1Z5",
            address="Plot 12, Dabhel Industrial Estate, Daman 396210", authorized_signatory_name="R. Thakkar",
        )
        self.loc = lambda plant, code: InventoryLocation.objects.filter(plant=plant, code=code).order_by("-is_system").first()
        self.rm = self.loc(self.plant, "RM")
        self.fg = self.loc(self.plant, "FG")
        self.wip = self.loc(self.plant, "WIP")
        self.jw_out = self.loc(self.plant, "JOBWORK_OUT")
        self.other_rm = self.loc(self.other_plant, "RM")
        self.work_center = WorkCenter.objects.create(plant=self.plant, name="Pouching JW", code="JW-WC", default_wip_location=self.wip)
        self.vendor = Vendor.objects.create(
            code="VEEDEE", name="Vee Dee Enterprises", type="JOBWORK", gst_no="24ABCPV1234K1Z9",
            address="Plot 7, GIDC Vapi", mailing_state="Gujarat", mailing_pincode="396195",
            jobwork_rates=[{"process_code": "POUCH_JOBWORK", "rate": "2.75", "uom": "PCS"}],
        )
        self.other_vendor = Vendor.objects.create(code="LAMIJW", name="Lami Works", type="BOTH", mailing_state="Daman")
        self.pouch_process = Process.objects.create(code="POUCH_JOBWORK", name="Pouching (job work)", input_form="ROLL", output_form="BULK", roll_behavior="NONE")
        self.lam_process = Process.objects.create(code="LAM_JOBWORK", name="Lamination (job work)", input_form="ROLL", output_form="ROLL", roll_behavior="MULTI_INPUT_COMBINE")
        self.family = InventoryMaterial.objects.create(code="JW-PET-FAM", name="PET family", category="FILM_FAMILY", base_uom="KG", density_gcm3=Decimal("1.4000"))
        self.film = InventoryMaterial.objects.create(code="JW-PET12", name="Printed PET 12", category="FILM_VARIANT", base_uom="KG", parent_family=self.family, density_gcm3=Decimal("1.4000"))
        self.lam_film = InventoryMaterial.objects.create(code="JW-PETPE", name="PET/PE laminate", category="FILM_VARIANT", base_uom="KG", parent_family=self.family, density_gcm3=Decimal("1.1000"))
        self.granule = InventoryMaterial.objects.create(code="JW-LLDPE", name="LLDPE granules", category="GRANULE", base_uom="KG")
        self.gonny = InventoryMaterial.objects.create(code="JW-GONNY", name="Carton box", category="PACKAGING", base_uom="PCS")
        roles = {code: Role.objects.get_or_create(code=code, defaults={"name": code.title()})[0] for code in ["OWNER", "STORE", "PLANNER", "SALES", "WATCHMAN"]}
        desk = Role.objects.create(code="JOBWORK_DESK", name="Job-work desk", default_permissions=["inventory.view", "inventory.manage"])
        self.owner = User.objects.create_user(username="jw-owner", role=roles["OWNER"], is_owner=True)
        self.store = User.objects.create_user(username="jw-store", role=roles["STORE"])
        self.planner = User.objects.create_user(username="jw-planner", role=roles["PLANNER"])
        self.sales = User.objects.create_user(username="jw-sales", role=roles["SALES"])
        self.watchman = User.objects.create_user(username="jw-watch", role=roles["WATCHMAN"], extra_permissions=["inventory.manage"])
        self.desk_user = User.objects.create_user(username="jw-desk", role=desk)
        self.extra_user = User.objects.create_user(username="jw-extra", role=roles["SALES"], extra_permissions=["inventory.view", "inventory.manage"])
        self.api = self.client_for(self.store)

    # ---------------------------------------------------------------- helpers
    def client_for(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client

    def make_job(self, suffix, *, process=None, quantity="28825", uom="PCS", unit_weight_g="10", state="PAUSED", fg_type="POUCH", packaging=None):
        process = process or self.pouch_process
        total_kg = Decimal(quantity) if uom == "KG" else Decimal(quantity) * Decimal(unit_weight_g) / Decimal("1000")
        route = RoutingRule.objects.create(name=f"JW route {suffix}", ordered_processes=[process.code])
        template = TemplateBlueprint.objects.create(name=f"JW template {suffix}", fg_type=fg_type, status="DRAFT", routing_rule=route, pouch_style="PILLOW" if fg_type == "POUCH" else "")
        TemplateProcessStep.objects.create(template=template, sequence_number=1, process=process)
        order = SalesOrder.objects.create(
            customer_name="Sample Nutrition Co", order_name=f"Sample order {suffix}", order_type="MTO", status="CONFIRMED",
            geometry_override={"fg_type": fg_type}, commercial_confirmed_at=timezone.now(), delivery_date=timezone.localdate(),
        )
        item = SalesOrderItem.objects.create(
            sales_order=order, template=template, mode="TEMPLATE", line_name=f"Quick dry pouch {suffix}",
            geometry_snapshot={"fg_type": fg_type, "width_mm": 400, "height_mm": 71}, layer_snapshot=[], printing_snapshot={},
            addons_snapshot=[], packaging_snapshot=packaging or {}, bom_snapshot={},
            unit_weight_g=Decimal(unit_weight_g), total_weight_kg=total_kg, qty_uom=uom, qty_value=Decimal(quantity),
            price_basis=uom, unit_price=Decimal("1.0000"),
        )
        return ProductionJob.objects.create(
            job_number=f"JOB-JW-{suffix}", template=template, sales_order_item=item, routing_rule=route,
            current_step_index=0, current_process=process, process=process, work_center=self.work_center,
            from_location=self.wip, to_location=self.fg, input_form=process.input_form, output_form=process.output_form,
            quantity=Decimal(quantity), remaining_qty=Decimal(quantity), uom=uom, job_state=state,
            status="QUEUED", is_on_hold=state == "PAUSED",
        )

    def make_roll(self, label, weight, *, plant=None, location=None, job=None, material=None, status="AVAILABLE", rate="150"):
        location = location or (self.rm if plant in (None, self.plant) else self.other_rm)
        roll = InventoryRoll.objects.create(
            label_id=label, material=material or self.film, weight_kg=Decimal(str(weight)), original_weight_kg=Decimal(str(weight)),
            width_mm=Decimal("830"), thickness_micron=Decimal("12"), location=location, plant=location.plant, status=status,
            production_job=job, created_by_job=job, meta_json={"unit_cost_per_kg": rate},
        )
        RollMovement.objects.create(roll=roll, to_location=location, reason="GRN", reason_note="test stock")
        return roll

    def create_order(self, *, job=None, client=None, **extra):
        payload = {
            "client_token": token(), "vendor": str(self.vendor.id), "expected_output_kind": "FG_PCS" if job else "ROLLS",
            "expected_return_date": (timezone.localdate() + timedelta(days=10)).isoformat(),
        }
        if job is not None:
            payload.update({"production_job": str(job.id), "mode": "PLANNED_STEP", "expected_qty": "28825", "expected_uom": "PCS"})
        else:
            payload.update({"plant": str(self.plant.id), "mode": "EMERGENCY", "emergency_reason": "Pouch machine down"})
        payload.update(extra)
        response = (client or self.api).post("/api/inventory/job-work/", payload, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return response.data["order"]

    def dispatch(self, order_id, rolls, *, client=None, expect=201, **extra):
        payload = {"client_token": token(), "rolls": [{"roll_id": str(roll.id)} for roll in rolls], "hsn_code": "3920"}
        payload.update(extra)
        response = (client or self.api).post(f"/api/inventory/job-work/{order_id}/dispatch/", payload, format="json")
        self.assertEqual(response.status_code, expect, response.data)
        return response.data

    def sent_line(self, order_payload, roll):
        return next(line for line in order_payload["sent_lines"] if line["roll_id"] == str(roll.id))

    def post_return(self, order_id, payload, *, client=None, expect=201):
        body = {"client_token": token(), **payload}
        response = (client or self.api).post(f"/api/inventory/job-work/{order_id}/returns/", body, format="json")
        self.assertEqual(response.status_code, expect, response.data)
        return response.data
