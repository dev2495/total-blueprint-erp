from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase

from apps.production.views_planner import PlannerViewSet


class PlannerStockLauncherTests(TestCase):
    @patch.object(PlannerViewSet, "_prime_stock_order_for_release", return_value=[object()])
    @patch("apps.production.views_planner.PlannedStockOrder.objects.create")
    @patch("apps.production.views_planner.build_invariant_signature", return_value="inv-wip")
    @patch("apps.production.views_planner.build_invariant_payload", return_value={"layers": 2})
    @patch("apps.production.views_planner.build_spec_signature", return_value="spec-wip")
    @patch("apps.production.views_planner.build_spec_payload", return_value={"fg_type": "POUCH"})
    @patch("apps.production.views_planner.SalesOrderService.preview_sales_item")
    @patch("apps.production.views_planner._validate_printing_snapshot_for_confirm")
    @patch("apps.production.views_planner._normalize_printing_snapshot")
    @patch("apps.production.views_planner._normalize_layer_snapshot")
    @patch("apps.production.views_planner.TemplateBlueprint.objects.select_related")
    def test_create_stopped_wip_order_records_manual_roll_width(
        self,
        template_select,
        normalize_layers,
        normalize_printing,
        validate_printing,
        preview_sales_item,
        _build_spec_payload,
        _build_spec_signature,
        _build_invariant_payload,
        _build_invariant_signature,
        create_order,
        _prime_stock_order_for_release,
    ):
        template = SimpleNamespace(
            id="template-1",
            name="Center Seal Pouch",
            fg_type="POUCH",
            status="LIVE",
            default_stock_strategy="INTERMEDIATE_POOL",
            routing_rule=SimpleNamespace(
                ordered_processes=[SimpleNamespace(index=0), SimpleNamespace(index=1), SimpleNamespace(index=2)]
            ),
        )
        layer_snapshot = [
            {"material_code": "PET", "thickness_micron": 12, "roll_width_mm": 430},
            {"material_code": "PP", "thickness_micron": 50, "roll_width_mm": 430},
        ]
        request = SimpleNamespace(
            data={
                "template_id": "template-1",
                "quantity": "500",
                "quantity_uom": "KG",
                "start_step_index": 0,
                "stop_step_index": 1,
                "geometry": {
                    "finished_good_type": "POUCH",
                    "base": {"width_mm": 215, "height_mm": 280},
                    "roll_width_mm": 430,
                    "child_target_width_mm": 430,
                },
                "film_layers": layer_snapshot,
                "printing": {"enabled": False},
                "addons": [],
                "wip_roll_width_mm": 500,
                "auto_release": False,
            },
            user=SimpleNamespace(is_authenticated=False),
        )

        template_select.return_value.get.return_value = template
        normalize_layers.return_value = layer_snapshot
        normalize_printing.return_value = {"enabled": False}
        validate_printing.return_value = ({"enabled": False}, False, None)
        preview_sales_item.return_value = {
            "unit_weight_g": 0,
            "total_weight_kg": 500,
            "bom": {
                "planning_lines": [
                    {"material_code": "PET", "planned_issue_qty": 250, "uom": "KG"},
                ]
            },
        }
        create_order.return_value = SimpleNamespace(
            id="stock-order-1",
            order_number="STK-WIP",
            internal_name="WIP",
            quantity_uom="KG",
            stock_strategy="INTERMEDIATE_POOL",
            output_type="WIP_ROLL",
            planner_stock_class="SHARED_INVARIANT_ROLL",
            start_step_index=0,
            stop_step_index=1,
            spec_signature="spec-wip",
            invariant_signature="inv-wip",
            status="RELEASED",
        )

        response = PlannerViewSet().create_stock_order(request)

        self.assertEqual(response.status_code, 201)
        create_kwargs = create_order.call_args.kwargs
        self.assertEqual(create_kwargs["geometry_snapshot"]["base"]["width_mm"], 215)
        self.assertEqual(create_kwargs["geometry_snapshot"]["wip_roll_width_mm"], 500.0)
        self.assertEqual(create_kwargs["geometry_snapshot"]["roll_width_mm"], 500.0)
        self.assertEqual(create_kwargs["geometry_snapshot"]["base"]["roll_width_mm"], 500.0)
        self.assertEqual(create_kwargs["layer_snapshot"][0]["roll_width_mm"], 500.0)
        self.assertEqual(create_kwargs["layer_snapshot"][1]["input_roll_width_mm"], 500.0)
        self.assertEqual(create_kwargs["planner_origin_meta"]["wip_roll_width_mm"], 500.0)
        self.assertEqual(create_kwargs["output_type"], "WIP_ROLL")

    @patch.object(PlannerViewSet, "_prime_stock_order_for_release", return_value=[object()])
    @patch("apps.production.views_planner.PlannedStockOrder.objects.create")
    @patch("apps.production.views_planner.build_invariant_signature", return_value="inv-1")
    @patch("apps.production.views_planner.build_invariant_payload", return_value={"layers": 2})
    @patch("apps.production.views_planner.build_spec_signature", return_value="spec-1")
    @patch("apps.production.views_planner.build_spec_payload", return_value={"fg_type": "POUCH"})
    @patch("apps.production.views_planner.SalesOrderService.preview_sales_item")
    @patch("apps.production.views_planner._validate_printing_snapshot_for_confirm")
    @patch("apps.production.views_planner._normalize_printing_snapshot")
    @patch("apps.production.views_planner._normalize_layer_snapshot")
    @patch("apps.production.views_planner.TemplateBlueprint.objects.select_related")
    @patch("apps.production.views_planner.SalesSkuVariant.objects.select_related")
    def test_create_stock_order_seeds_from_sales_sku_variant(
        self,
        sales_variant_select,
        template_select,
        normalize_layers,
        normalize_printing,
        validate_printing,
        preview_sales_item,
        _build_spec_payload,
        _build_spec_signature,
        _build_invariant_payload,
        _build_invariant_signature,
        create_order,
        _prime_stock_order_for_release,
    ):
        sales_variant = SimpleNamespace(
            id="variant-1",
            sku_id="sales-sku-1",
            sku=SimpleNamespace(id="sales-sku-1", code="DRYFRUIT", name="Dry Fruit", template_id="template-1"),
            code="DRY-200X200",
            name="Dry Fruit 200 x 200",
            template_id="template-1",
            finished_good_type="POUCH",
            roll_form="",
            geometry_snapshot={"base": {"width_mm": 200, "height_mm": 200}},
            layer_snapshot=[{"family_id": "fam-1", "variant_id": "var-1", "thickness_micron": 50}],
            printing_snapshot={"enabled": False},
            chemicals_snapshot={"adhesive_gsm": 2, "solvent_gsm": 1},
            addons_snapshot=[{"addon_id": "zip", "qty": 1}],
            packaging_snapshot={"primary_inner_pack": {"enabled": True, "pcs_per_pack": 100}},
        )
        template = SimpleNamespace(
            id="template-1",
            name="Dry Fruit Pouch",
            fg_type="POUCH",
            status="LIVE",
            default_stock_strategy="FINAL_STOCK",
            routing_rule=SimpleNamespace(ordered_processes=[SimpleNamespace(index=0), SimpleNamespace(index=1), SimpleNamespace(index=2)]),
        )
        request = SimpleNamespace(
            data={
                "sales_sku_variant_id": "variant-1",
                "quantity": "1000",
                "quantity_uom": "PCS",
                "start_step_index": 0,
            },
            user=SimpleNamespace(is_authenticated=False),
        )

        sales_variant_select.return_value.get.return_value = sales_variant
        template_select.return_value.get.return_value = template
        normalize_layers.return_value = sales_variant.layer_snapshot
        normalize_printing.return_value = {"enabled": False, "chemicals": sales_variant.chemicals_snapshot}
        validate_printing.return_value = ({"enabled": False, "chemicals": sales_variant.chemicals_snapshot}, False, None)
        preview_sales_item.return_value = {"unit_weight_g": 6.25, "total_weight_kg": 6.25, "bom": {"layers": []}}
        create_order.return_value = SimpleNamespace(
            id="stock-order-1",
            order_number="STK-001",
            internal_name="DRYFRUIT-20260331",
            quantity_uom="KG",
            stock_strategy="FINAL_STOCK",
            output_type="FG_POUCH",
            planner_stock_class="FINAL_PRODUCT",
            start_step_index=0,
            stop_step_index=2,
            spec_signature="spec-1",
            invariant_signature="inv-1",
            status="PLANNED",
        )

        response = PlannerViewSet().create_stock_order(request)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["order_number"], "STK-001")

        create_kwargs = create_order.call_args.kwargs
        self.assertEqual(create_kwargs["template"], template)
        self.assertEqual(create_kwargs["geometry_snapshot"]["base"]["width_mm"], 200)
        self.assertEqual(create_kwargs["layer_snapshot"], sales_variant.layer_snapshot)
        self.assertEqual(create_kwargs["addons_snapshot"], sales_variant.addons_snapshot)
        self.assertEqual(create_kwargs["packaging_snapshot"]["primary_inner_pack"]["pcs_per_pack"], 100)
        self.assertEqual(create_kwargs["planner_origin_meta"]["sales_sku_id"], "sales-sku-1")
        self.assertEqual(create_kwargs["planner_origin_meta"]["sales_sku_variant_id"], "variant-1")
        self.assertEqual(create_kwargs["planner_origin_meta"]["naming_source"], "sales_sku")
