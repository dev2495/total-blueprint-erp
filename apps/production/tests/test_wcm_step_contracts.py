from decimal import Decimal
from unittest.mock import patch

from django.db.models import Q
from django.test import TestCase

from apps.factory.models import Plant, Process, WorkCenter
from apps.inventory.models import InventoryLocation, InventoryRoll
from apps.materials.models import InventoryMaterial
from apps.production.models import ProductionJob
from apps.production.services.roll_allocation_service import RollAllocationService
from apps.production.services.services_execution import ExecutionService
from apps.routing.models import RoutingRule


class WcmStepContractTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.plant = Plant.objects.create(code="WCM", name="WCM Plant")
        cls.rm = InventoryLocation.objects.create(
            plant=cls.plant,
            code="RM",
            name="Raw Materials Store",
            type="RM",
            is_system=True,
        )
        cls.process = Process.objects.create(
            code="FLEXO-WCM",
            name="Flexo Printing",
            input_form="ROLL",
            output_form="ROLL",
            roll_behavior="MODIFY_EXISTING",
            allowed_input_stock_forms=["OPEN_WEB"],
        )
        cls.work_center = WorkCenter.objects.create(
            plant=cls.plant,
            code="WC-FLEXO-WCM",
            name="Flexo WCM",
        )
        cls.route = RoutingRule.objects.create(
            name="WCM fallback route",
            ordered_processes=["PREP", "FLEXO-WCM"],
        )
        cls.material = InventoryMaterial.objects.create(
            code="TT-WCM",
            name="TT Film",
            category="FILM_VARIANT",
            base_uom="KG",
        )
        cls.job = ProductionJob.objects.create(
            job_number="SO-WCM-FALLBACK-2",
            routing_rule=cls.route,
            current_step_index=1,
            current_process=cls.process,
            process=cls.process,
            work_center=cls.work_center,
            from_location=cls.rm,
            to_location=cls.rm,
            quantity=Decimal("140"),
            uom="KG",
            input_form="ROLL",
            output_form="ROLL",
            job_state="RELEASED",
        )
        cls.exact_roll = InventoryRoll.objects.create(
            label_id="ROLL-WCM-EXACT-850",
            material=cls.material,
            plant=cls.plant,
            location=cls.rm,
            status="AVAILABLE",
            thickness_micron=Decimal("50"),
            width_mm=Decimal("850"),
            stock_form="OPEN_WEB",
            original_weight_kg=Decimal("315"),
            weight_kg=Decimal("315"),
            stage_index=0,
            current_step_index=0,
            completed_step_index=0,
        )

    @patch.object(
        ExecutionService,
        "_resolve_job_lineage_filter",
        return_value=Q(created_by_job__isnull=False),
    )
    @patch.object(
        ExecutionService,
        "_build_step_target_specs",
        return_value=[
            {
                "variant_id": None,
                "family_id": None,
                "thickness_micron": 50,
                "stock_form": "OPEN_WEB",
                "min_width_mm": 850,
                "max_auto_width_mm": 935,
            }
        ],
    )
    @patch.object(
        ExecutionService,
        "_resolve_step_roll_spec",
        return_value={"input_roll_count": 1},
    )
    def test_manual_discovery_includes_exact_plant_stock_for_downstream_modify_existing(
        self,
        _roll_spec,
        _target_specs,
        _lineage_filter,
    ):
        strict_lineage = RollAllocationService.get_eligible_rolls(
            self.job,
            include_non_lineage_fallback=False,
            include_remainder=True,
        )
        manual_discovery = RollAllocationService.get_eligible_rolls(
            self.job,
            include_non_lineage_fallback=True,
            include_remainder=True,
        )

        self.assertFalse(strict_lineage.filter(id=self.exact_roll.id).exists())
        self.assertTrue(manual_discovery.filter(id=self.exact_roll.id).exists())
