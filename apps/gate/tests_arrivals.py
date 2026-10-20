"""Goods coming back in at the gate, and the Goods in & out register."""
from decimal import Decimal

from django.test import TestCase, override_settings
from django.utils import timezone

from apps.gate.models import GateArrival, GateAssignment
from apps.gate.outward_services import _gate_out
from apps.gate.qr import make_token
from apps.inventory.models import DeliveryChallan, InterPlantChallanItem, InventoryRoll, JobWorkChallan
from apps.inventory.services.goods_movements import movement_register
from apps.inventory.tests_job_work_base import JobWorkFixtureMixin, token


class ArrivalFixture(JobWorkFixtureMixin):
    def setUp(self):
        super().setUp()
        GateAssignment.objects.create(user=self.watchman, plant=self.plant)
        self.watch = self.client_for(self.watchman)

    def row(self, kind, obj_id, **kw):
        rows = movement_register(kind=kind, **kw)["results"]
        return next((r for r in rows if r["id"] == str(obj_id)), None)

    def interplant(self, status="IN_TRANSIT"):
        roll = self.make_roll(f"IP-{status}", "92.300")
        challan = DeliveryChallan.objects.create(
            from_plant=self.plant, to_plant=self.other_plant, dc_no=f"IPC-T-{status}", status=status,
            dispatched_at=timezone.now() if status != "DRAFT" else None, vehicle_no="DD01A1111",
        )
        InterPlantChallanItem.objects.create(challan=challan, line_type="ROLL", roll=roll, planned_qty_kg=Decimal("92.3"), dispatched_qty_kg=Decimal("92.3"))
        return challan


class JobWorkArrivalTests(ArrivalFixture, TestCase):
    def test_job_work_out_back_at_gate_then_received(self):
        job = self.make_job("ARR")
        rolls = [self.make_roll("ARR-1", "120"), self.make_roll("ARR-2", "110")]
        order = self.api.post("/api/inventory/job-work/", {
            "client_token": token(), "vendor": str(self.vendor.id), "production_job": str(job.id), "mode": "PLANNED_STEP",
            "expected_output_kind": "FG_PCS", "expected_qty": "20000", "expected_uom": "PCS",
            "expected_return_date": (timezone.localdate()).isoformat(),
        }, format="json").data["order"]
        self.assertEqual(self.row("JOBWORK", order["id"])["stage"], "PREPARED")
        sent = self.api.post(f"/api/inventory/job-work/{order['id']}/dispatch/", {
            "client_token": token(), "rolls": [{"roll_id": str(r.id)} for r in rolls], "hsn_code": "3920",
        }, format="json")
        self.assertEqual(sent.status_code, 201, sent.data)
        challan = JobWorkChallan.objects.get(order_id=order["id"])
        row = self.row("JOBWORK", order["id"])
        self.assertEqual(row["stage"], "OUTSIDE")
        self.assertEqual(row["arrival"], {"kind": "JOBWORK_CHALLAN", "object_id": str(challan.id), "plant": str(self.plant.id)})
        self.assertFalse(row["left_at_gate"])

        # The watchman scans our challan when the vendor's tempo brings the pouches back.
        code = make_token("JOBWORK_CHALLAN", challan.id)
        preview = self.watch.get("/api/gate/arrivals/preview/", {"plant": str(self.plant.id), "code": code})
        self.assertEqual(preview.status_code, 200, preview.data)
        self.assertEqual(preview.data["party_name"], "From Vee Dee Enterprises")
        client_token = token()
        saved = self.watch.post("/api/gate/arrivals/", {"plant": str(self.plant.id), "code": code, "vehicle_number": "gj15ab1234", "client_token": client_token}, format="json")
        self.assertEqual(saved.status_code, 201, saved.data)
        self.assertEqual(saved.data["arrival"]["vehicle_number"], "GJ15AB1234")
        self.assertEqual(saved.data["arrival"]["link"], f"/inventory/job-work/{order['id']}")
        again = self.watch.post("/api/gate/arrivals/", {"plant": str(self.plant.id), "code": code, "vehicle_number": "gj15ab1234", "client_token": client_token}, format="json")
        self.assertTrue(again.data["replayed"])
        self.assertEqual(GateArrival.objects.count(), 1, "a retried scan records once")
        self.assertEqual(self.row("JOBWORK", order["id"])["stage"], "AT_GATE")
        # Nothing moved in stock at the gate.
        self.assertEqual(InventoryRoll.objects.filter(id__in=[r.id for r in rolls], status="SENT_JOBWORK").count(), 2)

        detail = self.api.get(f"/api/inventory/job-work/{order['id']}/").data
        lines = [{"sent_line_id": line["id"], "disposition": "PROCESSED"} for line in detail["sent_lines"]]
        ret = self.api.post(f"/api/inventory/job-work/{order['id']}/returns/", {
            "client_token": token(), "vendor_document_no": "VD/1", "vendor_document_date": timezone.localdate().isoformat(),
            "sent_lines": lines, "fg": {"qty_pcs": 20000, "boxes": 40, "location_id": str(self.fg.id)},
            "wastage": {"kg": "30", "bags": 2, "returned_to_factory": True},
        }, format="json")
        self.assertEqual(ret.status_code, 201, ret.data)
        self.assertEqual(self.row("JOBWORK", order["id"])["stage"], "DONE")

    def test_watchman_of_another_factory_and_closed_orders_are_refused(self):
        job = self.make_job("ARR2")
        roll = self.make_roll("ARR2-1", "100")
        order = self.api.post("/api/inventory/job-work/", {
            "client_token": token(), "vendor": str(self.vendor.id), "production_job": str(job.id), "mode": "PLANNED_STEP",
            "expected_output_kind": "FG_PCS", "expected_qty": "10000", "expected_uom": "PCS",
        }, format="json").data["order"]
        self.api.post(f"/api/inventory/job-work/{order['id']}/dispatch/", {"client_token": token(), "rolls": [{"roll_id": str(roll.id)}], "hsn_code": "3920"}, format="json")
        challan = JobWorkChallan.objects.get(order_id=order["id"])
        GateAssignment.objects.create(user=self.watchman, plant=self.other_plant)
        refused = self.watch.post("/api/gate/arrivals/", {"plant": str(self.other_plant.id), "code": make_token("JOBWORK_CHALLAN", challan.id), "client_token": token()}, format="json")
        self.assertEqual(refused.status_code, 400)
        self.assertIn("another factory", str(refused.data))
        self.assertFalse(GateArrival.objects.exists())


class InterPlantArrivalTests(ArrivalFixture, TestCase):
    def test_left_one_gate_and_arrived_at_the_other(self):
        challan = self.interplant()
        self.assertEqual(self.row("INTERPLANT", challan.id)["stage"], "OUTSIDE")
        _gate_out("INTERPLANT_DC", challan.id, timezone.now(), self.watchman)
        challan.refresh_from_db()
        self.assertIsNotNone(challan.gate_out_at)
        self.assertTrue(self.row("INTERPLANT", challan.id)["left_at_gate"])

        code = make_token("INTERPLANT_DC", challan.id)
        at_sender = self.watch.post("/api/gate/arrivals/", {"plant": str(self.plant.id), "code": code, "client_token": token()}, format="json")
        self.assertEqual(at_sender.status_code, 400, "the challan arrives at Kachigam, not back at Dabhel")
        GateAssignment.objects.create(user=self.watchman, plant=self.other_plant)
        ok = self.watch.post("/api/gate/arrivals/", {"plant": str(self.other_plant.id), "code": code, "client_token": token()}, format="json")
        self.assertEqual(ok.status_code, 201, ok.data)
        challan.refresh_from_db()
        self.assertIsNotNone(challan.gate_in_at)
        self.assertEqual(challan.status, "IN_TRANSIT", "the store receives; the gate never moves stock")
        self.assertEqual(self.row("INTERPLANT", challan.id)["stage"], "AT_GATE")

    def test_received_challans_cannot_arrive_again(self):
        challan = self.interplant(status="RECEIVED")
        GateAssignment.objects.create(user=self.watchman, plant=self.other_plant)
        refused = self.watch.post("/api/gate/arrivals/", {"plant": str(self.other_plant.id), "code": make_token("INTERPLANT_DC", challan.id), "client_token": token()}, format="json")
        self.assertEqual(refused.status_code, 400)
        self.assertIn("already received", str(refused.data))

    def test_store_records_from_the_office_planner_cannot(self):
        challan = self.interplant()
        payload = {"plant": str(self.other_plant.id), "kind": "INTERPLANT_DC", "object_id": str(challan.id), "client_token": token()}
        self.assertEqual(self.client_for(self.planner).post("/api/gate/arrivals/", payload, format="json").status_code, 403)
        ok = self.api.post("/api/gate/arrivals/", payload, format="json")
        self.assertEqual(ok.status_code, 201, ok.data)
        self.assertEqual(ok.data["arrival"]["party_name"], f"From {self.plant.name}")

    @override_settings(STRICT_RBAC=True)
    def test_register_is_for_stock_viewers(self):
        self.interplant()
        self.assertEqual(self.client_for(self.store).get("/api/inventory/goods-movements/").status_code, 200)
        self.assertEqual(self.client_for(self.sales).get("/api/inventory/goods-movements/").status_code, 403)
        body = self.client_for(self.store).get("/api/inventory/goods-movements/", {"stage": "OUTSIDE", "kind": "INTERPLANT"}).data
        self.assertEqual(body["counts"]["OUTSIDE"], 1)
        self.assertEqual(body["results"][0]["party"], "Dabhel → Kachigam")
        self.assertEqual(self.client_for(self.store).get("/api/inventory/goods-movements/", {"stage": "NOPE"}).status_code, 400)


class GatePassArrivalTests(ArrivalFixture, TestCase):
    def test_returnable_pass_out_back_at_gate_then_received(self):
        from apps.gate.models import GatePass, GatePassLine

        gate_pass = GatePass.objects.create(
            number="RGP-2627-0001", kind="RETURNABLE", plant=self.plant, party_name="Baba Vishwakarma Engg",
            purpose="REPAIR", expected_return_date=timezone.localdate(), status="OUT", out_at=timezone.now(), created_by=self.owner,
        )
        line = GatePassLine.objects.create(gate_pass=gate_pass, line_no=1, description="Rubber roller", quantity=Decimal("2"), uom="NOS")
        row = self.row("RGP", gate_pass.id)
        self.assertEqual((row["stage"], row["arrival"]["kind"]), ("OUTSIDE", "GATE_PASS"))
        saved = self.watch.post("/api/gate/arrivals/", {"plant": str(self.plant.id), "code": make_token("GATE_PASS", gate_pass.id), "client_token": token()}, format="json")
        self.assertEqual(saved.status_code, 201, saved.data)
        self.assertEqual(self.row("RGP", gate_pass.id)["stage"], "AT_GATE")
        back = self.api.post(f"/api/gate/gate-passes/{gate_pass.id}/receive-back/", {
            "client_token": token(), "lines": [{"line_id": str(line.id), "quantity": "2"}], "reason": "Both rollers back after milling",
        }, format="json")
        self.assertEqual(back.status_code, 200, back.data)
        self.assertEqual(self.row("RGP", gate_pass.id)["stage"], "DONE")

    def test_non_returnable_pass_never_comes_back(self):
        from apps.gate.models import GatePass, GatePassLine

        gate_pass = GatePass.objects.create(
            number="NRGP-2627-0001", kind="NON_RETURNABLE", plant=self.plant, party_name="Scrap buyer",
            purpose="SCRAP_SALE", status="CLOSED", out_at=timezone.now(), closed_at=timezone.now(), created_by=self.owner,
        )
        GatePassLine.objects.create(gate_pass=gate_pass, line_no=1, description="Trim waste", quantity=Decimal("120"), uom="KG")
        refused = self.watch.post("/api/gate/arrivals/", {"plant": str(self.plant.id), "code": make_token("GATE_PASS", gate_pass.id), "client_token": token()}, format="json")
        self.assertEqual(refused.status_code, 400)
        self.assertEqual(self.row("NRGP", gate_pass.id)["stage"], "DONE")
