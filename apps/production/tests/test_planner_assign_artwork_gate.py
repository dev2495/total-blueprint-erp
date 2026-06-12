from contextlib import nullcontext
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.test import SimpleTestCase, TestCase

from apps.factory.models import Process
from apps.materials.models import InventoryMaterial, ProductMaster, ProductMasterSize
from apps.production.views_planner import PlannerViewSet
from apps.routing.models import RoutingRule
from apps.sales.models import Customer, SalesOrder, SalesOrderItem
from apps.templates.models import TemplateBlueprint


class PlannerAssignArtworkGateTests(SimpleTestCase):
    @patch("apps.production.views_planner.transaction.atomic", return_value=nullcontext())
    @patch("apps.production.views_planner.Artwork.objects.get")
    @patch.object(PlannerViewSet, "_get_order_for_kind")
    @patch.object(PlannerViewSet, "_pending_sales_print_items")
    def test_rejects_item_id_not_in_pending_artwork_state(
        self,
        mock_pending,
        mock_get_order,
        mock_get_artwork,
        _mock_atomic,
    ):
        pending_item = SimpleNamespace(id="item-pending")
        non_pending_item = SimpleNamespace(id="item-non-pending")
        order_obj = SimpleNamespace(
            id="order-1",
            items=SimpleNamespace(all=lambda: [pending_item, non_pending_item], first=lambda: non_pending_item),
        )
        mock_get_order.return_value = ("sales", order_obj, None, 0)
        mock_pending.return_value = [pending_item]
        mock_get_artwork.return_value = SimpleNamespace(id="art-1", status="APPROVED")

        request = SimpleNamespace(data={"artwork_id": "art-1", "item_id": "item-non-pending"})
        response = PlannerViewSet().control_hub_assign_artwork(request, order_kind="sales", order_id="order-1")

        self.assertEqual(response.status_code, 400)
        self.assertIn("pending printing artwork-assignment", str(response.data.get("error")))

    @patch("apps.production.views_planner.transaction.atomic", return_value=nullcontext())
    @patch("apps.production.views_planner.Artwork.objects.get")
    @patch.object(PlannerViewSet, "_get_order_for_kind")
    @patch.object(PlannerViewSet, "_pending_sales_print_items")
    def test_rejects_assignment_when_no_pending_items_exist(
        self,
        mock_pending,
        mock_get_order,
        mock_get_artwork,
        _mock_atomic,
    ):
        order_obj = SimpleNamespace(id="order-2", items=SimpleNamespace(all=lambda: [], first=lambda: None))
        mock_get_order.return_value = ("sales", order_obj, None, 0)
        mock_pending.return_value = []
        mock_get_artwork.return_value = SimpleNamespace(id="art-2", status="APPROVED")

        request = SimpleNamespace(data={"artwork_id": "art-2"})
        response = PlannerViewSet().control_hub_assign_artwork(request, order_kind="sales", order_id="order-2")

        self.assertEqual(response.status_code, 400)
        self.assertIn("No pending printing item", str(response.data.get("error")))

    @patch("apps.production.views_planner.transaction.atomic", return_value=nullcontext())
    @patch("apps.production.views_planner.Artwork.objects.get")
    @patch.object(PlannerViewSet, "_get_order_for_kind")
    @patch.object(PlannerViewSet, "_pending_sales_print_items")
    @patch.object(PlannerViewSet, "_apply_artwork_to_sales_item")
    def test_assigns_when_item_is_pending(
        self,
        mock_apply,
        mock_pending,
        mock_get_order,
        mock_get_artwork,
        _mock_atomic,
    ):
        pending_item = SimpleNamespace(id="item-1")
        order_obj = SimpleNamespace(
            id="order-3",
            items=SimpleNamespace(all=lambda: [pending_item], first=lambda: pending_item),
        )
        artwork = SimpleNamespace(id="art-3", status="APPROVED")
        mock_get_order.return_value = ("sales", order_obj, None, 0)
        mock_pending.return_value = [pending_item]
        mock_get_artwork.return_value = artwork

        request = SimpleNamespace(data={"artwork_id": "art-3", "item_id": "item-1"})
        response = PlannerViewSet().control_hub_assign_artwork(request, order_kind="sales", order_id="order-3")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data.get("status"), "assigned")
        mock_apply.assert_called_once_with(pending_item, artwork)

    @patch("apps.production.views_planner.SalesOrderService.preview_sales_item")
    @patch("apps.production.views_planner._validate_printing_snapshot_for_confirm")
    def test_apply_artwork_to_sales_item_replaces_snapshot_artwork_and_clears_gate(
        self,
        mock_validate_printing,
        mock_preview,
    ):
        item = SimpleNamespace(
            id="item-apply-1",
            printing_snapshot={
                "enabled": True,
                "type": "ROTO",
                "substrate_mode": "SHEET",
                "front_colors_count": 1,
                "back_colors_count": 0,
                "artwork_id": "stale-artwork",
            },
            artwork_assignment_required=True,
            assigned_artwork_id="",
            geometry_snapshot={"finished_good_type": "POUCH"},
            layer_snapshot=[{"density_g_cm3": 0.92}],
            addons_snapshot=[],
            bom_snapshot={},
            qty_value=Decimal("100"),
            qty_uom="KG",
            template=SimpleNamespace(fg_type="POUCH"),
            save=lambda **kwargs: None,
        )
        artwork = SimpleNamespace(id="approved-artwork-1")
        mock_validate_printing.return_value = (
            {
                "enabled": True,
                "type": "ROTO",
                "substrate_mode": "SHEET",
                "front_colors_count": 1,
                "back_colors_count": 0,
                "artwork_id": "approved-artwork-1",
                "front_colors": ["CYAN"],
                "back_colors": [],
                "color_names": ["CYAN"],
                "color_mapping": {"CYAN": "ink-1"},
                "ink_base_family": "POLY",
                "artwork_design_code": "ART-APPROVED-1",
                "cylinder_required": True,
            },
            False,
            "approved-artwork-1",
        )
        mock_preview.return_value = {"bom": {"inks": []}, "unit_weight_g": 25.0, "total_weight_kg": 100.0}

        PlannerViewSet()._apply_artwork_to_sales_item(item, artwork)

        self.assertEqual(item.printing_snapshot["artwork_id"], "approved-artwork-1")
        self.assertFalse(item.artwork_assignment_required)
        self.assertEqual(item.assigned_artwork_id, "approved-artwork-1")

    @patch("apps.production.views_planner._validate_printing_snapshot_for_confirm")
    def test_release_validation_blocks_invalid_print_contract_even_without_pending_flag(self, mock_validate):
        item = SimpleNamespace(
            printing_snapshot={"enabled": True, "type": "FLEXO"},
            artwork_assignment_required=False,
        )
        order_obj = SimpleNamespace(items=SimpleNamespace(all=lambda: [item]))
        mock_validate.side_effect = ValidationError("Item X: artwork_id is invalid.")

        with self.assertRaises(ValidationError) as exc:
            PlannerViewSet()._validate_order_printing_for_release("sales", order_obj)

        self.assertIn("artwork_id is invalid", str(exc.exception))

    def test_light_pending_artwork_items_uses_current_product_master_print_context(self):
        product_master = SimpleNamespace(
            id="pm-current",
            code="PM-FLEXO-SHEET",
            version=4,
            is_current_version=True,
            fixed_attributes={
                "print_capable": True,
                "artwork_required": True,
                "print_type": "FLEXO",
            },
            sizes=[
                SimpleNamespace(
                    code="SHEET-200",
                    active=True,
                    stock_form="OPEN_WEB",
                )
            ],
        )
        item = SimpleNamespace(
            id="item-current-context",
            line_name="Current context line",
            product_master=product_master,
            axis_values={"size": "SHEET-200"},
            assigned_artwork_id="",
            printing_snapshot={
                "enabled": True,
                "type": "ROTO",
                "method": "ROTO",
                "substrate_mode": "TUBING",
                "front_colors_count": 1,
                "back_colors_count": 0,
            },
        )

        payload = PlannerViewSet()._light_pending_artwork_items(item)

        self.assertEqual(len(payload), 1)
        self.assertEqual(payload[0]["print_type"], "FLEXO")
        self.assertEqual(payload[0]["substrate_mode"], "SHEET")
        self.assertEqual(payload[0]["product_master_code"], "PM-FLEXO-SHEET")
        self.assertEqual(payload[0]["product_master_version"], 4)

    def test_light_pending_artwork_items_keeps_snapshot_required_line_visible(self):
        product_master = SimpleNamespace(
            id="pm-current",
            code="PM-SNAPSHOT-GATE",
            version=5,
            is_current_version=True,
            fixed_attributes={"print_capable": False},
            sizes=[],
        )
        item = SimpleNamespace(
            id="item-snapshot-required",
            line_name="Snapshot required line",
            product_master=product_master,
            axis_values={},
            assigned_artwork_id="",
            artwork_assignment_required=True,
            printing_snapshot={
                "enabled": True,
                "type": "FLEXO",
                "method": "FLEXO",
                "substrate_mode": "SHEET",
                "front_colors_count": 1,
                "back_colors_count": 0,
            },
        )

        payload = PlannerViewSet()._light_pending_artwork_items(item)

        self.assertEqual(len(payload), 1)
        self.assertEqual(payload[0]["print_type"], "FLEXO")
        self.assertEqual(payload[0]["substrate_mode"], "SHEET")
        self.assertEqual(payload[0]["product_master_code"], "PM-SNAPSHOT-GATE")


class PlannerProductMasterSyncTests(TestCase):
    def test_planner_read_syncs_clean_sales_line_to_current_product_master(self):
        film = InventoryMaterial.objects.create(
            code="PM-PLAN-SYNC-FILM",
            name="Planner sync film",
            category="FILM_VARIANT",
            base_uom="KG",
            is_purchasable=True,
            is_extrudable=False,
            density_gcm3="0.9200",
            status="ACTIVE",
        )
        old_process = Process.objects.create(code="PM-PLAN-SYNC-ROTO", name="Roto Printing")
        new_process = Process.objects.create(code="PM-PLAN-SYNC-FLEXO", name="Flexo Printing")
        old_route = RoutingRule.objects.create(name="PM plan sync roto route", ordered_processes=[old_process.code])
        new_route = RoutingRule.objects.create(name="PM plan sync flexo route", ordered_processes=[new_process.code])
        old_template = TemplateBlueprint.objects.create(
            name="PM plan sync roto template",
            fg_type="POUCH",
            status="LIVE",
            routing_rule=old_route,
            pouch_style="THREE_SIDE_SEAL",
        )
        current_template = TemplateBlueprint.objects.create(
            name="PM plan sync flexo template",
            fg_type="POUCH",
            status="LIVE",
            routing_rule=new_route,
            pouch_style="THREE_SIDE_SEAL",
        )
        source = ProductMaster.objects.create(
            code="PM-PLAN-SYNC",
            name="Planner sync source",
            product_kind="POUCH",
            default_reporting_group="FG",
            template=old_template,
            version_group="PM-PLAN-SYNC",
            version=1,
            is_current_version=False,
            active=False,
            layer_template=[
                {
                    "role": "L1",
                    "film_variant_code": film.code,
                    "film_variant_id": str(film.id),
                    "thickness_micron": 50,
                }
            ],
            variant_axes=[{"axis": "size", "type": "geometry", "required": True}],
            fixed_attributes={
                "fg_type": "POUCH",
                "print_capable": True,
                "artwork_required": True,
                "print_type": "ROTO",
                "default_pouch_style": "THREE_SIDE_SEAL",
            },
        )
        current = ProductMaster.objects.create(
            code="PM-PLAN-SYNC-V2",
            name="Planner sync current",
            product_kind="POUCH",
            default_reporting_group="FG",
            template=current_template,
            version_group="PM-PLAN-SYNC",
            version=2,
            is_current_version=True,
            active=True,
            layer_template=[
                {
                    "role": "L1",
                    "film_variant_code": film.code,
                    "film_variant_id": str(film.id),
                    "thickness_micron": 50,
                }
            ],
            variant_axes=[{"axis": "size", "type": "geometry", "required": True}],
            fixed_attributes={
                "fg_type": "POUCH",
                "print_capable": True,
                "artwork_required": True,
                "print_type": "FLEXO",
                "default_pouch_style": "THREE_SIDE_SEAL",
            },
        )
        ProductMaster.objects.filter(id=source.id).update(superseded_by=current)
        ProductMasterSize.objects.create(
            product_master=current,
            code="200X300",
            label="200 x 300",
            width_mm=200,
            height_mm=300,
            child_target_width_mm=420,
            roll_width_mm=420,
            stock_form="OPEN_WEB",
            qty_uom="KG",
        )
        customer = Customer.objects.create(code="CUST-PLAN-SYNC", name="Planner Sync Customer")
        order = SalesOrder.objects.create(
            customer=customer,
            customer_name=customer.name,
            status="CONFIRMED",
            order_type="MTO",
        )
        item = SalesOrderItem.objects.create(
            sales_order=order,
            template=old_template,
            product_master=source,
            mode="TEMPLATE",
            line_name=source.name,
            axis_values={"size": "200X300"},
            geometry_snapshot={
                "finished_good_type": "POUCH",
                "width_mm": 200,
                "height_mm": 300,
                "roll_width_mm": 420,
                "stock_form": "OPEN_WEB",
            },
            layer_snapshot=[
                {
                    "role": "L1",
                    "film_variant_code": film.code,
                    "material_code": film.code,
                    "thickness_micron": 50,
                    "width_mm": 420,
                }
            ],
            printing_snapshot={
                "enabled": True,
                "print_type": "ROTO",
                "type": "ROTO",
                "substrate_mode": "SHEET",
                "defer_artwork_to_planner": True,
            },
            artwork_assignment_required=True,
            qty_uom="KG",
            qty_value=100,
            price_basis="KG",
            unit_price=10,
        )

        view = PlannerViewSet()
        synced = view._maybe_sync_sales_item_product_master(item)

        self.assertEqual(synced.product_master_id, current.id)
        self.assertEqual(synced.template_id, current_template.id)
        self.assertEqual(synced.printing_snapshot["print_type"], "FLEXO")
        self.assertEqual(synced.printing_snapshot["substrate_mode"], "SHEET")
        order.refresh_from_db()
        self.assertEqual(order.status, "PLANNING_REQUIRED")
