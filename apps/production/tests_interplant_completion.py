from decimal import Decimal

from django.test import TestCase

from apps.factory.models import Plant
from apps.inventory.models import InventoryLocation, InventoryRoll
from apps.materials.models import InventoryMaterial
from apps.production.models import ProductionJob
from apps.production.services.job_services import JobService
from apps.recipes.models import RecipeGrade
from apps.routing.models import RoutingRule


class InterPlantCompletionTests(TestCase):
    def test_cross_plant_helper_creates_and_dispatches_system_dc(self):
        plant_a = Plant.objects.create(name="A", code="A")
        plant_b = Plant.objects.create(name="B", code="B")

        a_wip = InventoryLocation.objects.create(
            plant=plant_a,
            code="A-WIP",
            name="A WIP",
            type="WIP",
            is_system=False,
        )
        InventoryLocation.objects.create(
            plant=plant_a,
            code="IN_TRANSIT",
            name="A Transit",
            type="TRANSIT",
            is_system=True,
        )
        b_wip = InventoryLocation.objects.create(
            plant=plant_b,
            code="B-WIP",
            name="B WIP",
            type="WIP",
            is_system=False,
        )

        grade = RecipeGrade.objects.create(name="G-IP")
        material = InventoryMaterial.objects.create(
            code="FV-IP",
            name="Interplant Variant",
            category="FILM_VARIANT",
        )
        route = RoutingRule.objects.create(name="IP Route", ordered_processes=["P1", "P2"])

        source_job = ProductionJob.objects.create(
            job_number="SRC-1",
            routing_rule=route,
            current_step_index=0,
            quantity=Decimal("50.00"),
            remaining_qty=Decimal("0"),
            produced_qty=Decimal("50"),
            from_location=a_wip,
            to_location=a_wip,
            status="COMPLETED",
            job_state="COMPLETED",
        )
        target_job = ProductionJob.objects.create(
            job_number="TGT-1",
            routing_rule=route,
            current_step_index=1,
            quantity=Decimal("50.00"),
            remaining_qty=Decimal("50"),
            from_location=b_wip,
            to_location=b_wip,
            status="QUEUED",
            job_state="WAITING",
        )

        roll = InventoryRoll.objects.create(
            label_id="ROLL-DC-001",
            material=material,
            thickness_micron=Decimal("25"),
            width_mm=Decimal("600"),
            grade=grade,
            weight_kg=Decimal("50"),
            location=a_wip,
            plant=plant_a,
            production_job=source_job,
            created_by_job=source_job,
            status="AVAILABLE",
            current_step_index=1,
            stage_index=1,
        )

        challan = JobService._create_and_dispatch_interplant_dc(source_job, target_job)

        self.assertIsNotNone(challan)
        self.assertEqual(challan.status, "IN_TRANSIT")
        self.assertTrue(challan.is_system_generated)
        self.assertEqual(challan.source_job_id, source_job.id)
        self.assertEqual(challan.target_job_id, target_job.id)

        roll.refresh_from_db()
        self.assertEqual(roll.location.code, "IN_TRANSIT")
        self.assertEqual(challan.items.count(), 1)
