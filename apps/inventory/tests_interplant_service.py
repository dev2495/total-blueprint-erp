import importlib.util
from decimal import Decimal
import unittest

from django.test import TestCase

from apps.factory.models import Plant
from apps.inventory.models import InventoryLocation, InventoryRoll
from apps.inventory.services.challan_pdf import ChallanPDFService
from apps.inventory.services.inter_plant import InterPlantService
from apps.materials.models import InventoryMaterial
from apps.production.models import ProductionJob
from apps.recipes.models import RecipeGrade
from apps.routing.models import RoutingRule


class InterPlantServiceTests(TestCase):
    def setUp(self):
        self.plant_a = Plant.objects.create(name="Plant A", code="PA")
        self.plant_b = Plant.objects.create(name="Plant B", code="PB")

        self.a_wip = InventoryLocation.objects.create(
            plant=self.plant_a,
            code="A-WIP",
            name="A WIP",
            type="WIP",
            is_system=False,
        )
        self.a_transit = InventoryLocation.objects.create(
            plant=self.plant_a,
            code="IN_TRANSIT",
            name="A Transit",
            type="TRANSIT",
            is_system=True,
        )
        self.b_wip = InventoryLocation.objects.create(
            plant=self.plant_b,
            code="B-WIP",
            name="B WIP",
            type="WIP",
            is_system=False,
        )

        self.grade = RecipeGrade.objects.create(name="G1")
        self.material = InventoryMaterial.objects.create(
            code="FV-TEST",
            name="Test Variant",
            category="FILM_VARIANT",
        )

        self.routing = RoutingRule.objects.create(
            name="Route-IP",
            ordered_processes=["P1", "P2"],
        )

        self.source_job = ProductionJob.objects.create(
            job_number="JOB-IP-SRC",
            routing_rule=self.routing,
            current_step_index=0,
            quantity=Decimal("100.00"),
            remaining_qty=Decimal("0.0000"),
            produced_qty=Decimal("100.0000"),
            from_location=self.a_wip,
            to_location=self.a_wip,
            status="COMPLETED",
            job_state="COMPLETED",
            uom="KG",
        )
        self.target_job = ProductionJob.objects.create(
            job_number="JOB-IP-TGT",
            routing_rule=self.routing,
            current_step_index=1,
            quantity=Decimal("100.00"),
            remaining_qty=Decimal("100.0000"),
            from_location=self.b_wip,
            to_location=self.b_wip,
            status="QUEUED",
            job_state="WAITING",
            uom="KG",
        )

    def _create_roll(self, label="ROLL-IP-001", weight="42.500"):
        return InventoryRoll.objects.create(
            label_id=label,
            material=self.material,
            thickness_micron=Decimal("30.00"),
            width_mm=Decimal("500.00"),
            grade=self.grade,
            weight_kg=Decimal(weight),
            location=self.a_wip,
            plant=self.plant_a,
            status="AVAILABLE",
            production_job=self.source_job,
            created_by_job=self.source_job,
            current_step_index=1,
            stage_index=1,
        )

    def test_dispatch_creates_line_items_and_marks_in_transit(self):
        roll = self._create_roll()

        challan = InterPlantService.create_challan(
            from_plant_id=str(self.plant_a.id),
            to_plant_id=str(self.plant_b.id),
            source_job_id=str(self.source_job.id),
            target_job_id=str(self.target_job.id),
            is_system_generated=True,
        )

        InterPlantService.dispatch_challan(
            challan_id=str(challan.id),
            roll_ids=[str(roll.id)],
            target_location_id=str(self.b_wip.id),
        )

        challan.refresh_from_db()
        roll.refresh_from_db()

        self.assertEqual(challan.status, "IN_TRANSIT")
        self.assertTrue(challan.dc_no)
        self.assertIsNotNone(challan.dispatched_at)
        self.assertEqual(roll.location_id, self.a_transit.id)

        item = challan.items.get()
        self.assertEqual(item.line_type, "ROLL")
        self.assertEqual(item.status, "DISPATCHED")
        self.assertEqual(item.from_location_id, self.a_wip.id)
        self.assertEqual(item.to_location_id, self.b_wip.id)
        self.assertEqual(item.dispatched_qty_kg, Decimal("42.500"))

    def test_receive_marks_received_and_releases_target_job(self):
        roll = self._create_roll(label="ROLL-IP-002", weight="10.000")
        challan = InterPlantService.create_challan(
            from_plant_id=str(self.plant_a.id),
            to_plant_id=str(self.plant_b.id),
            source_job_id=str(self.source_job.id),
            target_job_id=str(self.target_job.id),
            is_system_generated=True,
        )
        InterPlantService.dispatch_challan(
            challan_id=str(challan.id),
            roll_ids=[str(roll.id)],
            target_location_id=str(self.b_wip.id),
        )

        InterPlantService.receive_challan(
            challan_id=str(challan.id),
            target_location_id=str(self.b_wip.id),
        )

        challan.refresh_from_db()
        roll.refresh_from_db()
        self.target_job.refresh_from_db()

        self.assertEqual(challan.status, "RECEIVED")
        self.assertIsNotNone(challan.received_at)
        self.assertEqual(self.target_job.job_state, "RELEASED")
        self.assertEqual(roll.location_id, self.b_wip.id)
        self.assertEqual(challan.items.get().status, "RECEIVED")

    @unittest.skipUnless(importlib.util.find_spec("reportlab"), "reportlab is not installed")
    def test_pdf_generator_returns_pdf_bytes(self):
        roll = self._create_roll(label="ROLL-IP-003", weight="12.000")
        challan = InterPlantService.create_challan(
            from_plant_id=str(self.plant_a.id),
            to_plant_id=str(self.plant_b.id),
        )
        InterPlantService.dispatch_challan(
            challan_id=str(challan.id),
            roll_ids=[str(roll.id)],
            target_location_id=str(self.b_wip.id),
        )

        pdf_bytes = ChallanPDFService.generate_pdf_bytes(challan)

        self.assertTrue(pdf_bytes.startswith(b"%PDF"))
