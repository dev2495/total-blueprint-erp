from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from apps.production.services.material_service import MaterialConsumptionService


class MaterialConsumptionStrictnessTests(SimpleTestCase):
    databases = {"default"}

    @patch("apps.production.services.material_service.RollService.consume_input_only")
    @patch("apps.production.services.material_service.InventoryRoll.objects.get")
    @patch("apps.production.services.material_service.MaterialConsumptionLog.objects.create")
    @patch("apps.production.services.material_service.MaterialConsumptionService.calculate_projected_consumption")
    def test_finalize_consumption_routes_roll_issue_through_roll_service(
        self,
        calculate_projected_consumption,
        log_create,
        roll_get,
        consume_input_only,
    ):
        roll = SimpleNamespace(id="roll-1", label_id="ROLL-1")
        roll_get.return_value = roll
        calculate_projected_consumption.return_value = [
            {
                "type": "ROLL",
                "roll_id": "roll-1",
                "material_id": "mat-1",
                "quantity": Decimal("4.500"),
                "uom": "KG",
                "source": "Films",
            }
        ]

        job = SimpleNamespace(
            job_number="JOB-100",
            input_form="BULK",
            current_process=SimpleNamespace(id="proc-1"),
            from_location=None,
        )

        MaterialConsumptionService.finalize_consumption(job, Decimal("10"))

        log_create.assert_called_once()
        roll_get.assert_called_once_with(id="roll-1")
        consume_input_only.assert_called_once_with(
            input_roll=roll,
            used_kg=Decimal("4.500"),
            job=job,
            process=job.current_process,
            machine=None,
            user=None,
            notes="Projected BOM issue for Job JOB-100",
        )

    def test_projected_consumption_blocks_incomplete_frozen_print_contract(self):
        job = SimpleNamespace(
            template=SimpleNamespace(fg_type="POUCH"),
            uom="KG",
            assignment=None,
            sales_order_item=SimpleNamespace(
                geometry_snapshot={"base": {"width_mm": 120, "height_mm": 180}},
                layer_snapshot=[{"density_g_cm3": 0.92}],
                printing_snapshot={
                    "enabled": True,
                    "type": "FLEXO",
                    "substrate_mode": "SHEET",
                    "front_colors_count": 1,
                    "back_colors_count": 0,
                    "ink_gsm_total": 1.2,
                    "artwork_id": "art-1",
                    "front_colors": ["CYAN"],
                    "back_colors": [],
                    "color_names": ["CYAN"],
                    "ink_base_family": "POLY",
                    "cylinder_required": False,
                },
                addons_snapshot=[],
                bom_snapshot={},
            ),
            mts_order=None,
        )

        with self.assertRaisesMessage(Exception, "artwork_design_code"):
            MaterialConsumptionService.calculate_projected_consumption(job, Decimal("25"))
