from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.factory.models import Machine, Plant, Process, WorkCenter
from apps.inventory.models import (
    DeliveryChallan as InterPlantDeliveryChallan,
    InterPlantChallanItem,
    InventoryLocation,
    InventoryRoll,
)
from apps.materials.models import InventoryMaterial
from apps.production.models import DeliveryChallan, DeliveryChallanItem, JobExecutionLog, ProductionJob, ScrapLog
from apps.routing.models import RoutingRule
from apps.users.models import Role


class LiveReportTruthTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        role = Role.objects.create(code="ANALYTICS", name="Analytics", default_permissions=["analytics.view"])
        self.user = get_user_model().objects.create_user(
            username="analytics-truth",
            email="analytics-truth@example.com",
            password="pass1234",
            role=role,
        )
        self.client.force_authenticate(self.user)

        self.plant_a = Plant.objects.create(name="Plant A", code="PA")
        self.plant_b = Plant.objects.create(name="Plant B", code="PB")
        self.location_a = InventoryLocation.objects.create(name="FG A", code="FGA", plant=self.plant_a, type="FG")
        self.location_b = InventoryLocation.objects.create(name="FG B", code="FGB", plant=self.plant_b, type="FG")
        self.bulk_material = InventoryMaterial.objects.create(
            code="BULK-INT-1",
            name="Transit Bulk",
            category="GRANULE",
            base_uom="KG",
            status="ACTIVE",
        )

    def test_dispatch_report_uses_live_challan_data(self):
        challan = DeliveryChallan.objects.create(
            dc_no="DC-LIVE-001",
            customer_name="Hari Traders",
            plant=self.plant_a,
            status="IN_TRANSIT",
            vehicle_no="GJ01AB1234",
            dispatch_date=timezone.now(),
        )
        DeliveryChallanItem.objects.create(
            challan=challan,
            weight_kg=Decimal("245.500"),
            qty_pcs=10,
        )

        response = self.client.get("/api/analytics/reports/dispatch", {"date_from": timezone.now().date().isoformat()})

        self.assertEqual(response.status_code, 200, response.content)
        payload = response.json()
        self.assertEqual(payload["summary"]["total_challans"], 1)
        self.assertEqual(payload["summary"]["dispatched"], 1)
        self.assertEqual(payload["summary"]["total_weight_kg"], 245.5)
        self.assertEqual(payload["recent_challans"][0]["dc_no"], "DC-LIVE-001")
        self.assertEqual(payload["daily_trend"][0]["weight_kg"], 245.5)

    def test_production_report_exposes_richer_breakdowns_and_recent_jobs(self):
        process = Process.objects.create(code="PRINT-LIVE", name="Printing", input_form="ROLL", output_form="ROLL", roll_behavior="MODIFY_EXISTING")
        work_center = WorkCenter.objects.create(plant=self.plant_a, name="Printing WC", code="WC-PRINT-LIVE")
        machine = Machine.objects.create(work_center=work_center, name="Press 1", code="M-PRINT-LIVE", status="ACTIVE")
        routing_rule = RoutingRule.objects.create(name="Live Print Route", ordered_processes=["PRINT-LIVE"])
        job = ProductionJob.objects.create(
            job_number="JOB-LIVE-001",
            routing_rule=routing_rule,
            current_process=process,
            process=process,
            work_center=work_center,
            machine=machine,
            quantity=Decimal("120.00"),
            remaining_qty=Decimal("15.00"),
            produced_qty=Decimal("105.00"),
            status="RUNNING",
            job_state="EXECUTING",
            source_type="SALES",
            input_form="ROLL",
            output_form="ROLL",
            uom="KG",
        )
        JobExecutionLog.objects.create(
            production_job=job,
            quantity=Decimal("105.00"),
            uom="KG",
            shift_code="A",
            logged_by=self.user,
        )
        ScrapLog.objects.create(
            production_job=job,
            quantity=Decimal("5.00"),
            uom="KG",
            reason="DEFECT",
            shift_code="A",
            logged_by=self.user,
        )

        response = self.client.get("/api/analytics/reports/production/", {"date_from": timezone.now().date().isoformat()})

        self.assertEqual(response.status_code, 200, response.content)
        payload = response.json()
        self.assertIn("by_work_center", payload["breakdowns"])
        self.assertIn("by_shift", payload["breakdowns"])
        self.assertIn("by_job_state", payload["breakdowns"])
        self.assertIn("scrap_reasons", payload["breakdowns"])
        self.assertIn("by_operator", payload["breakdowns"])
        self.assertEqual(payload["rows"][0]["job_number"], "JOB-LIVE-001")
        self.assertEqual(payload["rows"][0]["machine"], "Press 1")
        self.assertEqual(payload["rows"][0]["scrap_kg"], 5.0)
        self.assertEqual(payload["summary"]["active_work_centers"], 1)
        self.assertEqual(payload["summary"]["jobs_with_scrap"], 1)

    def test_interplant_report_uses_live_challan_data(self):
        challan = InterPlantDeliveryChallan.objects.create(
            from_plant=self.plant_a,
            to_plant=self.plant_b,
            dc_no="IPC-LIVE-001",
            status="IN_TRANSIT",
            dispatched_at=timezone.now(),
        )
        InterPlantChallanItem.objects.create(
            challan=challan,
            line_type="BULK",
            material=self.bulk_material,
            from_location=self.location_a,
            to_location=self.location_b,
            planned_qty_kg=Decimal("120"),
            dispatched_qty_kg=Decimal("120"),
            received_qty_kg=Decimal("50"),
            status="PARTIAL",
        )

        response = self.client.get("/api/analytics/reports/interplant", {"date_from": timezone.now().date().isoformat()})

        self.assertEqual(response.status_code, 200, response.content)
        payload = response.json()
        self.assertEqual(payload["summary"]["total_challans"], 1)
        self.assertEqual(payload["summary"]["in_transit"], 1)
        self.assertEqual(payload["summary"]["dispatched_total_kg"], 120.0)
        self.assertEqual(payload["summary"]["received_total_kg"], 50.0)
        self.assertEqual(payload["rows"][0]["dc_no"], "IPC-LIVE-001")

    def test_inventory_report_exposes_item_type_variant_and_roll_rows(self):
        film = InventoryMaterial.objects.create(
            code="FILM-LIVE-001",
            name="Live Film Variant",
            category="FILM_VARIANT",
            base_uom="KG",
            status="ACTIVE",
        )
        InventoryRoll.objects.create(
            label_id="ROLL-LIVE-001",
            material=film,
            thickness_micron=Decimal("30"),
            width_mm=Decimal("500"),
            length_m=Decimal("1000"),
            weight_kg=Decimal("85.5"),
            original_weight_kg=Decimal("85.5"),
            location=self.location_a,
            plant=self.plant_a,
            status="AVAILABLE",
            stage_index=2,
            is_fg=False,
        )

        response = self.client.get("/api/analytics/reports/inventory/", {"plant": str(self.plant_a.id)})

        self.assertEqual(response.status_code, 200, response.content)
        payload = response.json()
        breakdowns = payload.get("breakdowns", {})
        self.assertIn("by_item_type", breakdowns)
        self.assertIn("by_variant", breakdowns)
        self.assertIn("by_material", breakdowns)
        self.assertIn("by_plant", breakdowns)
        self.assertTrue(any(row["item_type"] == "WIP_ROLL" for row in breakdowns["by_item_type"]))
        self.assertEqual(payload["rows"][0]["label_id"], "ROLL-LIVE-001")

    def test_scrap_report_exposes_live_kpis_breakdowns_and_recent_rows(self):
        process = Process.objects.create(code="LAM-LIVE", name="Lamination", input_form="ROLL", output_form="ROLL", roll_behavior="MULTI_INPUT_COMBINE")
        work_center = WorkCenter.objects.create(plant=self.plant_a, name="Lamination WC", code="WC-LAM-LIVE")
        machine = Machine.objects.create(work_center=work_center, name="Laminator 1", code="LAM-1", status="ACTIVE")
        routing_rule = RoutingRule.objects.create(name="Live Lam Route", ordered_processes=["LAM-LIVE"])
        job = ProductionJob.objects.create(
            job_number="JOB-SCRAP-001",
            routing_rule=routing_rule,
            current_process=process,
            process=process,
            work_center=work_center,
            machine=machine,
            quantity=Decimal("75.00"),
            remaining_qty=Decimal("8.00"),
            produced_qty=Decimal("67.00"),
            status="RUNNING",
            job_state="EXECUTING",
            source_type="SALES",
            input_form="ROLL",
            output_form="ROLL",
            uom="KG",
        )
        JobExecutionLog.objects.create(
            production_job=job,
            quantity=Decimal("67.00"),
            uom="KG",
            shift_code="B",
            logged_by=self.user,
        )
        ScrapLog.objects.create(
            production_job=job,
            quantity=Decimal("3.50"),
            uom="KG",
            reason="TRIM",
            shift_code="B",
            logged_by=self.user,
        )

        response = self.client.get("/api/analytics/reports/scrap/", {"date_from": timezone.now().date().isoformat()})

        self.assertEqual(response.status_code, 200, response.content)
        payload = response.json()
        self.assertGreater(payload["summary"]["total_scrap_kg"], 0)
        self.assertEqual(payload["summary"]["jobs_with_scrap"], 1)
        self.assertEqual(payload["summary"]["top_reason"], "TRIM")
        self.assertIn("by_reason", payload["breakdowns"])
        self.assertIn("by_machine", payload["breakdowns"])
        self.assertIn("by_process", payload["breakdowns"])
        self.assertIn("top_jobs", payload["breakdowns"])
        self.assertEqual(payload["breakdowns"]["top_jobs"][0]["job_number"], "JOB-SCRAP-001")
        self.assertEqual(payload["rows"][0]["job_number"], "JOB-SCRAP-001")
        self.assertEqual(payload["series"][0]["scrap_kg"], 3.5)

    def test_interplant_report_route_with_trailing_slash_is_live(self):
        response = self.client.get("/api/analytics/reports/interplant/")

        self.assertEqual(response.status_code, 200, response.content)
