from decimal import Decimal
from types import SimpleNamespace
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
                "slit_policy": "SLIT_ALLOWED",
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
    def test_manual_discovery_never_includes_thinner_or_narrower_rolls(
        self,
        _roll_spec,
        _target_specs,
        _lineage_filter,
    ):
        thinner = InventoryRoll.objects.create(
            label_id="ROLL-WCM-THINNER",
            material=self.material,
            plant=self.plant,
            location=self.rm,
            status="AVAILABLE",
            thickness_micron=Decimal("49"),
            width_mm=Decimal("850"),
            stock_form="OPEN_WEB",
            original_weight_kg=Decimal("100"),
            weight_kg=Decimal("100"),
        )
        narrower = InventoryRoll.objects.create(
            label_id="ROLL-WCM-NARROWER",
            material=self.material,
            plant=self.plant,
            location=self.rm,
            status="AVAILABLE",
            thickness_micron=Decimal("50"),
            width_mm=Decimal("849"),
            stock_form="OPEN_WEB",
            original_weight_kg=Decimal("100"),
            weight_kg=Decimal("100"),
        )

        eligible = RollAllocationService.get_eligible_rolls(
            self.job,
            include_non_lineage_fallback=True,
            include_remainder=True,
        )

        self.assertTrue(eligible.filter(id=self.exact_roll.id).exists())
        self.assertFalse(eligible.filter(id=thinner.id).exists())
        self.assertFalse(eligible.filter(id=narrower.id).exists())

    def test_exact_only_width_and_decimal_gauge_are_not_bucketed(self):
        exact_only = {
            "thickness_micron": Decimal("50"),
            "stock_form": "OPEN_WEB",
            "slit_policy": "EXACT_ONLY",
            "min_width_mm": Decimal("850"),
        }
        wider = InventoryRoll.objects.create(
            label_id="ROLL-WCM-WIDER",
            material=self.material,
            plant=self.plant,
            location=self.rm,
            status="AVAILABLE",
            thickness_micron=Decimal("50"),
            width_mm=Decimal("900"),
            stock_form="OPEN_WEB",
            original_weight_kg=Decimal("100"),
            weight_kg=Decimal("100"),
        )
        fractional_gauge = InventoryRoll.objects.create(
            label_id="ROLL-WCM-50-25",
            material=self.material,
            plant=self.plant,
            location=self.rm,
            status="AVAILABLE",
            thickness_micron=Decimal("50.25"),
            width_mm=Decimal("850"),
            stock_form="OPEN_WEB",
            original_weight_kg=Decimal("100"),
            weight_kg=Decimal("100"),
        )

        self.assertTrue(ExecutionService._roll_matches_target_specs(self.exact_roll, [exact_only]))
        self.assertFalse(ExecutionService._roll_matches_target_specs(wider, [exact_only]))
        self.assertFalse(ExecutionService._roll_matches_target_specs(fractional_gauge, [exact_only]))

    @patch.object(
        ExecutionService,
        "_job_layer_snapshot",
        return_value=[
            {
                "variant_id": "variant-tt",
                "family_id": "family-bopp",
                "thickness_micron": 51,
                "roll_width_mm": 900,
                "stock_form": "OPEN_WEB",
            }
        ],
    )
    @patch.object(
        ExecutionService,
        "_job_geometry_snapshot",
        return_value={"base": {"width_mm": 900}},
    )
    @patch.object(
        ExecutionService,
        "_resolve_step_roll_spec",
        return_value={"output_variant_id": "variant-tt"},
    )
    @patch(
        "apps.production.services.services_execution.StockFormResolver.from_job",
        return_value=SimpleNamespace(
            stock_form="OPEN_WEB",
            width_basis="OPEN_WEB_WIDTH",
            slit_policy="SLIT_ALLOWED",
        ),
    )
    def test_layer_contract_does_not_add_variant_only_escape_hatch(
        self,
        _stock_contract,
        _step_roll_spec,
        _geometry,
        _layers,
    ):
        specs = ExecutionService._build_step_target_specs(self.job, self.process)

        self.assertEqual(len(specs), 1)
        self.assertEqual(specs[0]["variant_id"], "variant-tt")
        self.assertEqual(specs[0]["thickness_micron"], 51)
        self.assertEqual(specs[0]["min_width_mm"], 900.0)

    @patch.object(
        ExecutionService,
        "_build_step_target_specs",
        return_value=[
            {
                "thickness_micron": 50,
                "stock_form": "OPEN_WEB",
                "slit_policy": "SLIT_ALLOWED",
                "min_width_mm": 850,
            }
        ],
    )
    def test_manual_override_cannot_bypass_physical_contract(self, _target_specs):
        thinner = InventoryRoll.objects.create(
            label_id="ROLL-WCM-OVERRIDE-THINNER",
            material=self.material,
            plant=self.plant,
            location=self.rm,
            status="AVAILABLE",
            thickness_micron=Decimal("49"),
            width_mm=Decimal("850"),
            stock_form="OPEN_WEB",
            original_weight_kg=Decimal("100"),
            weight_kg=Decimal("100"),
        )

        with self.assertRaisesRegex(ValueError, "Physical roll constraints cannot be overridden"):
            ExecutionService.assign_roll_to_job(
                str(self.job.id),
                str(thinner.id),
                manual_override=True,
                override_reason="operator requested",
            )

    @patch.object(ExecutionService, "_is_piece_primary_roll_to_bulk_job", return_value=True)
    def test_piece_order_keeps_pcs_as_primary_step_target(self, _is_piece_primary):
        job = SimpleNamespace(
            quantity=Decimal("10000"),
            produced_qty=Decimal("250"),
            remaining_qty=Decimal("9750"),
        )
        metrics = ExecutionService._resolve_primary_step_metrics(
            job,
            process=self.process,
            step_target_total_kg=Decimal("140"),
            step_produced_kg=Decimal("3.5"),
            step_remaining_kg=Decimal("136.5"),
            step_target_pcs=Decimal("10000"),
            step_produced_pcs=Decimal("250"),
            step_remaining_pcs=Decimal("9750"),
            tolerance_kg=Decimal("1"),
        )

        self.assertEqual(metrics["primary_uom"], "PCS")
        self.assertEqual(metrics["step_target_primary"], 10000.0)
        self.assertEqual(metrics["step_produced_primary"], 250.0)
        self.assertEqual(metrics["step_remaining_primary"], 9750.0)
