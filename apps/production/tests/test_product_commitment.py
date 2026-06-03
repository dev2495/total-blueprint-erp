from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import TestCase

from apps.production.views_planner import PlannerViewSet


class PlannerProductCommitmentTests(TestCase):
    def test_commitment_scope_requires_matching_customer_and_artwork(self):
        view = PlannerViewSet()
        sales_item = SimpleNamespace(
            product_master_id="pm-1",
            sales_order=SimpleNamespace(customer_id="customer-ok"),
            assigned_artwork_id=None,
            printing_snapshot={"artwork_id": "artwork-ok"},
        )

        customer_artwork_stock = SimpleNamespace(
            product_master_id="pm-1",
            commitment_scope="CUSTOMER_ARTWORK",
            committed_customer_id="customer-ok",
            committed_artwork_id="artwork-ok",
        )
        wrong_customer_stock = SimpleNamespace(
            product_master_id="pm-1",
            commitment_scope="CUSTOMER_ARTWORK",
            committed_customer_id="customer-other",
            committed_artwork_id="artwork-ok",
        )
        wrong_artwork_stock = SimpleNamespace(
            product_master_id="pm-1",
            commitment_scope="ARTWORK",
            committed_customer_id=None,
            committed_artwork_id="artwork-other",
        )

        self.assertTrue(view._stock_commitment_matches_sales_item(customer_artwork_stock, sales_item))
        self.assertFalse(view._stock_commitment_matches_sales_item(wrong_customer_stock, sales_item))
        self.assertFalse(view._stock_commitment_matches_sales_item(wrong_artwork_stock, sales_item))

    def test_matching_stock_orders_skips_customer_committed_stock_for_other_customer(self):
        template = SimpleNamespace(routing_rule=None)
        sales_item = SimpleNamespace(
            product_master_id="pm-1",
            sales_order=SimpleNamespace(customer_id="customer-ok"),
            assigned_artwork_id=None,
            printing_snapshot={},
        )
        wrong_customer_stock = SimpleNamespace(
            id="mts-wrong-customer",
            order_number="MTS-WRONG-CUSTOMER",
            status="RELEASED",
            product_master_id="pm-1",
            commitment_scope="CUSTOMER",
            committed_customer_id="customer-other",
            committed_artwork_id=None,
            spec_signature="spec-required",
            invariant_signature="inv-required",
            geometry_snapshot={},
            geometry_override={},
            layer_snapshot=[],
            printing_snapshot={},
            addons_snapshot=[],
            start_step_index=0,
            stop_step_index=3,
            stock_strategy="FINAL_STOCK",
            stock_purpose="PRODUCT",
            target_qty=Decimal("10"),
            produced_qty=Decimal("0"),
        )
        matching_customer_stock = SimpleNamespace(
            id="mts-matching-customer",
            order_number="MTS-MATCHING-CUSTOMER",
            status="RELEASED",
            product_master_id="pm-1",
            commitment_scope="CUSTOMER",
            committed_customer_id="customer-ok",
            committed_artwork_id=None,
            spec_signature="spec-required",
            invariant_signature="inv-required",
            geometry_snapshot={},
            geometry_override={},
            layer_snapshot=[],
            printing_snapshot={},
            addons_snapshot=[],
            start_step_index=0,
            stop_step_index=3,
            stock_strategy="FINAL_STOCK",
            stock_purpose="PRODUCT",
            target_qty=Decimal("8"),
            produced_qty=Decimal("0"),
        )
        qs = MagicMock()
        qs.order_by.return_value = [wrong_customer_stock, matching_customer_stock]
        alloc_qs = MagicMock()
        alloc_qs.aggregate.return_value = {"total": Decimal("0")}

        with patch("apps.production.views_planner.PlannedStockOrder.objects.filter", return_value=qs), \
             patch("apps.production.views_planner.InventoryAllocation.objects.filter", return_value=alloc_qs):
            matches = PlannerViewSet()._matching_stock_orders_for_sales(
                template=template,
                order_signature="spec-required",
                order_invariant_signature="inv-required",
                required_start_step=0,
                sales_item=sales_item,
            )

        self.assertEqual([row["order_id"] for row in matches], ["mts-matching-customer"])

    @patch.object(PlannerViewSet, "_prime_stock_order_for_release", return_value=[object()])
    @patch("apps.production.views_planner.PlannedStockOrder.objects.create")
    @patch("apps.production.views_planner.build_invariant_signature", return_value="inv-product")
    @patch("apps.production.views_planner.build_invariant_payload", return_value={"layers": []})
    @patch("apps.production.views_planner.build_spec_signature", return_value="spec-product")
    @patch("apps.production.views_planner.build_spec_payload", return_value={"fg_type": "POUCH"})
    @patch("apps.production.views_planner.SalesOrderService.preview_sales_item")
    @patch("apps.production.views_planner._validate_printing_snapshot_for_confirm")
    @patch("apps.production.views_planner._normalize_printing_snapshot")
    @patch("apps.production.views_planner._normalize_layer_snapshot")
    @patch("apps.production.views_planner.TemplateBlueprint.objects.select_related")
    @patch("apps.production.views_planner.ProductMaster.objects.get")
    def test_create_stock_order_records_product_and_commitment_scope(
        self,
        product_master_get,
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
            name="Dry Fruit Pouch",
            fg_type="POUCH",
            status="LIVE",
            default_stock_strategy="FINAL_STOCK",
            routing_rule=SimpleNamespace(ordered_processes=["LAM", "PRINT", "POUCH"]),
        )
        product_master_get.return_value = SimpleNamespace(
            id="product-1",
            template_id="template-1",
            default_template_id=None,
        )
        template_select.return_value.get.return_value = template
        normalize_layers.return_value = []
        normalize_printing.return_value = {"enabled": False}
        validate_printing.return_value = ({"enabled": False}, False, None)
        preview_sales_item.return_value = {"unit_weight_g": 5, "total_weight_kg": 10, "bom": {"layers": []}}
        create_order.return_value = SimpleNamespace(
            id="stock-1",
            order_number="STK-001",
            internal_name="DRY-20260503",
            quantity_uom="KG",
            stock_strategy="FINAL_STOCK",
            output_type="FG_POUCH",
            planner_stock_class="FINAL_PRODUCT",
            start_step_index=0,
            stop_step_index=2,
            spec_signature="spec-product",
            invariant_signature="inv-product",
            status="PLANNED",
        )

        request = SimpleNamespace(
            data={
                "product_master": "product-1",
                "committed_customer": "customer-1",
                "committed_artwork": "artwork-1",
                "commitment_scope": "CUSTOMER_ARTWORK",
                "template_id": "template-1",
                "quantity": "1000",
                "quantity_uom": "PCS",
                "start_step_index": 0,
                "geometry": {"base": {"width_mm": 100, "height_mm": 160}},
                "film_layers": [],
                "printing": {"enabled": False},
                "addons": [],
            },
            user=SimpleNamespace(is_authenticated=False),
        )

        response = PlannerViewSet().create_stock_order(request)

        self.assertEqual(response.status_code, 201, response.data)
        create_kwargs = create_order.call_args.kwargs
        self.assertEqual(create_kwargs["product_master_id"], "product-1")
        self.assertEqual(create_kwargs["commitment_scope"], "CUSTOMER_ARTWORK")
        self.assertEqual(create_kwargs["committed_customer_id"], "customer-1")
        self.assertEqual(create_kwargs["committed_artwork_id"], "artwork-1")
        self.assertEqual(create_kwargs["planner_origin_meta"]["commitment_scope"], "CUSTOMER_ARTWORK")

    @patch.object(PlannerViewSet, "_prime_stock_order_for_release", return_value=[object()])
    @patch("apps.production.views_planner.PlannedStockOrder.objects.create")
    @patch("apps.production.views_planner.build_invariant_signature", return_value="inv-packaging")
    @patch("apps.production.views_planner.build_invariant_payload", return_value={"layers": []})
    @patch("apps.production.views_planner.build_spec_signature", return_value="spec-packaging")
    @patch("apps.production.views_planner.build_spec_payload", return_value={"fg_type": "POUCH"})
    @patch("apps.production.views_planner.SalesOrderService.preview_sales_item")
    @patch("apps.production.views_planner._validate_printing_snapshot_for_confirm")
    @patch("apps.production.views_planner._normalize_printing_snapshot")
    @patch("apps.production.views_planner._normalize_layer_snapshot")
    @patch("apps.production.views_planner.InventoryMaterial.objects.get")
    @patch("apps.production.views_planner.TemplateBlueprint.objects.select_related")
    @patch("apps.production.views_planner.ProductMaster.objects.get")
    def test_packaging_stock_can_run_full_route_without_artwork_commitment(
        self,
        product_master_get,
        template_select,
        packaging_get,
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
            name="Inner Pouch",
            fg_type="POUCH",
            status="LIVE",
            default_stock_strategy="FINAL_STOCK",
            routing_rule=SimpleNamespace(ordered_processes=["EXTRUSION", "PRINT", "POUCH"]),
        )
        product_master_get.return_value = SimpleNamespace(
            id="product-1",
            template_id="template-1",
            default_template_id=None,
            variant_axes=[],
        )
        packaging_get.return_value = SimpleNamespace(
            id="packaging-1",
            code="INNER-POUCH-IH",
            category="PACKAGING",
            base_uom="PCS",
        )
        template_select.return_value.get.return_value = template
        normalize_layers.return_value = [{"material_code": "LDPE", "thickness_micron": 50}]
        normalize_printing.return_value = {"enabled": False}
        validate_printing.return_value = ({"enabled": False}, False, None)
        preview_sales_item.return_value = {"unit_weight_g": 1.2, "total_weight_kg": 1.2, "bom": {"planning_lines": []}}
        create_order.return_value = SimpleNamespace(
            id="stock-packaging-1",
            order_number="STK-PACK-001",
            internal_name="INNER-POUCH-STOCK",
            quantity_uom="PCS",
            stock_strategy="PACKAGING_STOCK",
            output_type="FG_POUCH",
            planner_stock_class="PACKAGING_STOCK",
            start_step_index=0,
            stop_step_index=2,
            spec_signature="spec-packaging",
            invariant_signature="inv-packaging",
            status="PLANNED",
        )

        request = SimpleNamespace(
            data={
                "product_master": "product-1",
                "stock_purpose": "PACKAGING",
                "packaging_material": "packaging-1",
                "template_id": "template-1",
                "quantity": "1000",
                "quantity_uom": "PCS",
                "start_step_index": 0,
                "stop_step_index": 2,
                "commitment_scope": "GENERIC",
                "geometry": {"base": {"width_mm": 100, "height_mm": 120}},
                "film_layers": [{"material_code": "LDPE", "thickness_micron": 50}],
                "printing": {"enabled": False},
                "addons": [],
            },
            user=SimpleNamespace(is_authenticated=False),
        )

        response = PlannerViewSet().create_stock_order(request)

        self.assertEqual(response.status_code, 201, response.data)
        create_kwargs = create_order.call_args.kwargs
        self.assertEqual(create_kwargs["stock_purpose"], "PACKAGING")
        self.assertEqual(create_kwargs["stock_strategy"], "PACKAGING_STOCK")
        self.assertEqual(create_kwargs["planner_stock_class"], "PACKAGING_STOCK")
        self.assertEqual(create_kwargs["stop_step_index"], 2)
        self.assertEqual(create_kwargs["packaging_material"], packaging_get.return_value)

    def test_validate_packaging_stock_requires_catalog_sku_link(self):
        template = SimpleNamespace(
            id="template-1",
            fg_type="ROLL",
            routing_rule=SimpleNamespace(ordered_processes=["EXTRUSION"]),
        )
        product_master = SimpleNamespace(
            id="product-1",
            product_kind="PACKAGING",
            template=None,
            default_template=None,
        )
        request = SimpleNamespace(
            data={
                "product_master": "product-1",
                "stock_purpose": "PACKAGING",
                "template_id": "template-1",
                "quantity": "100",
                "quantity_uom": "KG",
                "stop_step_index": 0,
                "commitment_scope": "GENERIC",
            }
        )

        with patch("apps.production.views_planner.ProductMaster.objects.select_related") as product_select, \
             patch("apps.production.views_planner.TemplateBlueprint.objects.select_related") as template_select:
            product_select.return_value.get.return_value = product_master
            template_select.return_value.get.return_value = template

            response = PlannerViewSet().validate_stock_pool(request)

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["valid"])
        self.assertIn("linked packaging output SKU", response.data["error"])

    def test_create_pod_stock_requires_catalog_sku_link(self):
        request = SimpleNamespace(
            data={
                "launcher_mode": "POD_STOCK",
                "quantity": "100",
                "quantity_uom": "KG",
            },
            user=SimpleNamespace(is_authenticated=False),
        )

        response = PlannerViewSet().create_stock_order(request)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"], "pod_sku_variant_id is required when launcher_mode=POD_STOCK")

    def test_validate_marks_demand_counts_as_not_computed(self):
        template = SimpleNamespace(
            id="template-1",
            fg_type="ROLL",
            routing_rule=SimpleNamespace(ordered_processes=["EXTRUSION"]),
        )
        product_master = SimpleNamespace(
            id="product-1",
            product_kind="PACKAGING",
            fixed_attributes={},
            variant_axes=[],
            layer_template=[],
            template=None,
            default_template=None,
        )
        packaging_material = SimpleNamespace(
            id="packaging-1",
            code="PKG-INNER",
            category="PACKAGING",
        )
        request = SimpleNamespace(
            data={
                "product_master": "product-1",
                "stock_purpose": "PACKAGING",
                "packaging_material": "packaging-1",
                "template_id": "template-1",
                "quantity": "100",
                "quantity_uom": "KG",
                "stop_step_index": 0,
                "commitment_scope": "GENERIC",
                "geometry_snapshot": {"roll_width_mm": 500, "finished_good_type": "ROLL"},
                "layer_snapshot": [{"material_code": "LDPE", "thickness_micron": 50, "roll_width_mm": 500}],
                "printing": {"enabled": False},
                "addons": [],
            }
        )

        with patch("apps.production.views_planner.ProductMaster.objects.select_related") as product_select, \
             patch("apps.production.views_planner.TemplateBlueprint.objects.select_related") as template_select, \
             patch("apps.production.views_planner.InventoryMaterial.objects.get") as material_get, \
             patch("apps.production.views_planner.apply_layer_totals_to_geometry", side_effect=lambda geometry, layers: geometry), \
             patch("apps.production.views_planner.SalesOrderService.preview_sales_item") as preview_sales_item, \
             patch("apps.production.views_planner.build_invariant_payload", return_value={"layers": []}), \
             patch("apps.production.views_planner.build_invariant_signature", return_value="inv-packaging"):
            product_select.return_value.get.return_value = product_master
            template_select.return_value.get.return_value = template
            material_get.return_value = packaging_material
            preview_sales_item.return_value = {
                "unit_weight_g": None,
                "total_weight_kg": 100,
                "bom": {
                    "planning_lines": [
                        {
                            "step_sequence": 0,
                            "step_name": "Extrusion",
                            "category_code": "FILM",
                            "material_code": "LDPE",
                            "material_name": "LDPE",
                            "planned_issue_qty": 100,
                            "uom": "KG",
                        }
                    ]
                },
            }

            response = PlannerViewSet().validate_stock_pool(request)

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["valid"], response.data)
        self.assertFalse(response.data["eligible_demand"]["computed"])
