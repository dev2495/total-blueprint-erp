from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase, override_settings
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.artwork.models import Artwork
from apps.materials.models import InventoryMaterial, PodSku, PodSkuVariant, ProductMaster, ProductMasterSize, ProductVariant
from apps.materials.views import ProductMasterViewSet
from apps.sales.models import Customer, CustomerProductOverlay, SalesOrder, SalesOrderItem, SalesSku, SalesSkuVariant
from apps.sales.services.bom_preview import BOMPreviewService
from apps.sales.services import order_service
from apps.sales.services.order_service import SalesOrderService
from apps.templates.models import TemplateBlueprint


class ProductConfiguredOrderTests(TestCase):
    @patch("apps.sales.services.bom_preview.OrderResolutionService.resolve_line")
    @patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item")
    def test_bom_preview_blocks_missing_configured_pod_variant(
        self, preview_sales_item, resolve_line
    ):
        resolve_line.return_value = {"preview_payload": {}}
        preview_sales_item.return_value = {
            "bom": {"planning_lines": [], "is_complete": True},
        }

        preview = BOMPreviewService.for_line(
            {
                "packaging_snapshot": {
                    "pod": {
                        "enabled": True,
                        "pod_sku_variant_id": str(uuid4()),
                    }
                }
            }
        )

        self.assertFalse(preview["is_complete"])
        self.assertIn("no longer exists", " ".join(preview["errors"]))

    def setUp(self):
        self.customer = Customer.objects.create(code="ACME", name="Acme Retail")
        self.product = ProductMaster.objects.create(
            code="DRY-STANDUP",
            name="Dry Fruit Standup Pouch",
            product_kind="POUCH",
            default_reporting_group="FG",
        )
        self.overlay = CustomerProductOverlay.objects.create(
            product_master=self.product,
            customer=self.customer,
            customer_item_code="ACME-DRY-100",
            customer_display_name="Acme Dry Fruit 100g",
            default_price_basis="PCS",
        )
        self.template = TemplateBlueprint.objects.create(
            name="Dry Fruit Pouch Template",
            fg_type="POUCH",
            status="LIVE",
            pouch_style="STAND_UP",
        )

    @patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item")
    @patch("apps.sales.services.order_service._normalize_layer_snapshot", return_value=[])
    @patch("apps.sales.services.order_service.validate_pouch_geometry_contract")
    def test_order_line_can_be_created_from_product_config_without_sku_variant(
        self,
        validate_geometry,
        _normalize_layers,
        preview_sales_item,
    ):
        validate_geometry.return_value = {
            "finished_good_type": "POUCH",
            "base": {"width_mm": 100, "height_mm": 160, "gusset_mm": 30},
        }
        preview_sales_item.return_value = {
            "unit_weight_g": 5,
            "total_weight_kg": 5,
            "bom": {"layers": [], "inks": []},
        }

        order = SalesOrderService.create_sales_order(
            {
                "customer": str(self.customer.id),
                "delivery_date": "2026-05-15",
                "items": [
                    {
                        "product_master": str(self.product.id),
                        "customer_product_overlay": str(self.overlay.id),
                        "template_id": str(self.template.id),
                        "mode": "TEMPLATE",
                        "qty_value": 1000,
                        "qty_uom": "PCS",
                        "unit_price": 2.5,
                        "price_basis": "PCS",
                        "geometry": {"base": {"width_mm": 100, "height_mm": 160, "gusset_mm": 30}},
                        "film_layers": [],
                        "printing": {"enabled": False},
                        "addons": [],
                    }
                ],
            }
        )

        item = order.items.get()
        self.assertIsNone(item.sku_variant_id)
        self.assertEqual(item.product_master_id, self.product.id)
        self.assertEqual(item.customer_product_overlay_id, self.overlay.id)
        self.assertEqual(SalesSku.objects.count(), 0)
        self.assertEqual(SalesSkuVariant.objects.count(), 0)

    def test_same_product_multiple_sizes_do_not_require_sku_variants(self):
        order = SalesOrder.objects.create(customer=self.customer, customer_name=self.customer.name)
        first = SalesOrderItem.objects.create(
            sales_order=order,
            template=self.template,
            product_master=self.product,
            customer_product_overlay=self.overlay,
            geometry_snapshot={"base": {"width_mm": 100, "height_mm": 160}},
            printing_snapshot={"enabled": False},
            qty_value=100,
            unit_price=1,
        )
        second = SalesOrderItem.objects.create(
            sales_order=order,
            template=self.template,
            product_master=self.product,
            customer_product_overlay=self.overlay,
            geometry_snapshot={"base": {"width_mm": 250, "height_mm": 320}},
            printing_snapshot={"enabled": False},
            qty_value=100,
            unit_price=1,
        )

        self.assertEqual(first.product_master_id, second.product_master_id)
        self.assertIsNone(first.sku_variant_id)
        self.assertIsNone(second.sku_variant_id)

    @override_settings(ERP_V3_DEFAULT=False)
    def test_v3_product_master_flow_can_be_disabled_by_feature_flag(self):
        with self.assertRaisesMessage(Exception, "Product Master sales flow is disabled by ERP_V3_DEFAULT"):
            SalesOrderService.create_sales_order(
                {
                    "customer": str(self.customer.id),
                    "delivery_date": "2026-05-15",
                    "items": [
                        {
                            "product_master": str(self.product.id),
                            "template_id": str(self.template.id),
                            "qty_value": 1000,
                            "qty_uom": "PCS",
                            "unit_price": 2.5,
                            "price_basis": "PCS",
                            "geometry": {"base": {"width_mm": 100, "height_mm": 160}},
                            "film_layers": [],
                            "printing": {"enabled": False},
                            "addons": [],
                        }
                    ],
                }
            )

    def test_sales_order_rejects_non_current_product_master(self):
        old_product = ProductMaster.objects.create(
            code="DRY-STANDUP-OLD",
            name="Dry Fruit Standup Pouch old",
            product_kind="POUCH",
            default_reporting_group="FG",
            active=True,
            is_current_version=False,
        )

        with self.assertRaises(ValidationError) as ctx:
            SalesOrderService.create_sales_order(
                {
                    "customer": str(self.customer.id),
                    "delivery_date": "2026-05-15",
                    "items": [
                        {
                            "product_master": str(old_product.id),
                            "template_id": str(self.template.id),
                            "qty_value": 1000,
                            "qty_uom": "PCS",
                            "unit_price": 2.5,
                            "price_basis": "PCS",
                            "geometry": {"base": {"width_mm": 100, "height_mm": 160}},
                            "film_layers": [],
                            "printing": {"enabled": False},
                            "addons": [],
                        }
                    ],
                }
            )

        self.assertIn("not the current version", str(ctx.exception))

    def test_axis_addon_codes_are_hydrated_for_legacy_geometry_contract(self):
        InventoryMaterial.objects.create(
            code="ZIPPER-T",
            name="Press-to-close zipper",
            category="ADDON",
            base_uom="PCS",
            weight_mode="PER_MM",
            weight_value=0.012,
        )

        from_axis = order_service._addons_from_axis_values({"addons": ["ZIPPER-T"]})
        from_frontend_payload = order_service._addons_from_axis_values([{"code": "ZIPPER-T", "quantity": 2}])

        self.assertEqual(from_axis[0]["weight_mode"], "PER_MM")
        self.assertEqual(from_axis[0]["applies_to"], "WIDTH")
        self.assertEqual(from_frontend_payload[0]["code"], "ZIPPER-T")
        self.assertEqual(from_frontend_payload[0]["quantity"], 2.0)
        self.assertEqual(from_frontend_payload[0]["applies_to"], "WIDTH")

    @patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item")
    def test_order_line_uses_per_layer_thickness_grade_and_addons_as_axes(self, preview_sales_item):
        family = InventoryMaterial.objects.create(
            code="MLD-LD-PER-LAYER-T",
            name="MLD LD per-layer family",
            category="FILM_FAMILY",
            base_uom="KG",
            density_gcm3="0.9200",
        )
        InventoryMaterial.objects.create(
            code="LDNAT-46-T",
            name="LD NAT 46 test",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            is_extrudable=True,
            is_purchasable=True,
        )
        InventoryMaterial.objects.create(
            code="CORONA-TREAT-T",
            name="Corona treatment",
            category="ADDON",
            base_uom="PCS",
            weight_mode="FIXED",
            weight_value=0,
        )
        pack = InventoryMaterial.objects.create(
            code="ROLL-WRAP-T",
            name="Roll stretch wrap",
            category="PACKAGING",
            base_uom="PCS",
            packaging_kind="SHEET",
            packaging_supply_mode="PURCHASED",
        )
        roll_template = TemplateBlueprint.objects.create(
            name="MLD Roll Per Layer Template",
            fg_type="ROLL",
            status="LIVE",
        )
        roll_master = ProductMaster.objects.create(
            code="PM-MLD-LDNAT-PER-LAYER-T",
            name="MLD LDNAT per-layer roll",
            product_kind="ROLL",
            template=roll_template,
            default_template=roll_template,
            layer_template=[
                {
                    "role": "base-film",
                    "material_code": "LDNAT-46-T",
                    "thickness_micron": 46,
                    "default_grade": "GP",
                    "grade_options": ["GP", "FOOD-A"],
                }
            ],
            variant_axes=[
                {"axis": "size", "type": "geometry", "required": True, "options": ["ROLL-1050"]},
                {"axis": "addons", "type": "multi_enum", "required": False, "options": ["CORONA-TREAT-T"]},
                {"axis": "packaging", "type": "packaging_ref", "required": False, "options": ["ROLL-WRAP-T"]},
            ],
            fixed_attributes={"fg_type": "ROLL", "layer_count": 1, "roll_form": "FLAT", "print_capable": False},
            invariant_signature="INV-PM-MLD-LDNAT-PER-LAYER-T",
        )
        ProductMasterSize.objects.create(
            product_master=roll_master,
            code="ROLL-1050",
            label="1050mm roll",
            width_mm=1050,
            roll_width_mm=1050,
            standard_qty=1200,
            qty_uom="KG",
        )
        overlay = CustomerProductOverlay.objects.create(
            product_master=roll_master,
            customer=self.customer,
            axis_values={"size": "ROLL-1050"},
            customer_item_code="ACME-ROLL-1050-GP",
            customer_display_name="Acme MLD LDNAT 1050 GP",
            default_packing_note="Loose roll; final stretch wrap.",
            default_packing_recipe={"roll_dispatch_pack": {"material_code": pack.code}},
            default_price_basis="KG",
            moq_kg=100,
        )
        preview_sales_item.return_value = {
            "unit_weight_g": 0,
            "total_weight_kg": 1200,
            "bom": {"planning_lines": [], "is_complete": True},
        }

        order = SalesOrderService.create_sales_order(
            {
                "customer": str(self.customer.id),
                "delivery_date": "2026-05-18",
                "items": [
                    {
                        "product_master": str(roll_master.id),
                        "customer_product_overlay": str(overlay.id),
                        "template_id": str(roll_template.id),
                        "qty_value": 1200,
                        "qty_uom": "KG",
                        "unit_price": 145,
                        "price_basis": "KG",
                        "axis_values": {
                            "size": "ROLL-1050",
                            "addons": ["CORONA-TREAT-T"],
                            "packaging": "ROLL-WRAP-T",
                        },
                        "printing": {"enabled": False},
                    }
                ],
            }
        )

        item = order.items.get()
        self.assertIsNone(item.sku_variant_id)
        self.assertIsNotNone(item.product_variant_id)
        self.assertEqual(item.axis_values["addons"], ["CORONA-TREAT-T"])
        self.assertEqual(item.geometry_snapshot["roll_width_mm"], 1050)
        self.assertEqual(item.geometry_snapshot["thickness_um"], 46)
        self.assertEqual(item.layer_snapshot[0]["material_code"], "LDNAT-46-T")
        self.assertEqual(item.layer_snapshot[0]["thickness_micron"], 46)
        self.assertEqual(item.layer_snapshot[0]["grade_code"], "GP")
        self.assertEqual(item.addons_snapshot[0]["code"], "CORONA-TREAT-T")
        self.assertEqual(item.packaging_snapshot["primary_inner_pack"]["material_id"], str(pack.id))

    @patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item")
    def test_layer_material_resolves_by_id_when_saved_code_is_stale(self, preview_sales_item):
        family = InventoryMaterial.objects.create(
            code="SYNC-FAM-T",
            name="Sync family test",
            category="FILM_FAMILY",
            base_uom="KG",
        )
        film = InventoryMaterial.objects.create(
            code="SYNC-FILM-20-T",
            name="Sync Film 20 test",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            is_extrudable=True,
        )
        template = TemplateBlueprint.objects.create(
            name="Sync Code Template",
            fg_type="ROLL",
            status="LIVE",
        )
        master = ProductMaster.objects.create(
            code="PM-SYNC-CODE-T",
            name="Sync Code Roll",
            product_kind="ROLL",
            template=template,
            default_template=template,
            layer_template=[
                {
                    "role": "base-film",
                    "film_variant_id": str(film.id),
                    "film_variant_code": "OLD-CODE-20",
                    "thickness_micron": 20,
                    "default_grade": "GP",
                }
            ],
            variant_axes=[{"axis": "size", "type": "geometry", "required": True, "options": ["ROLL-440"]}],
            fixed_attributes={"fg_type": "ROLL", "layer_count": 1, "roll_form": "FLAT", "print_capable": False},
            invariant_signature="INV-PM-SYNC-CODE-T",
        )
        ProductMasterSize.objects.create(
            product_master=master,
            code="ROLL-440",
            label="440mm roll",
            width_mm=440,
            roll_width_mm=440,
            standard_qty=1000,
            qty_uom="KG",
        )
        preview_sales_item.return_value = {
            "unit_weight_g": 0,
            "total_weight_kg": 1000,
            "bom": {"planning_lines": [], "is_complete": True},
        }

        preview = BOMPreviewService.for_line(
            {
                "product_master": str(master.id),
                "template_id": str(template.id),
                "axis_values": {"size": "ROLL-440"},
                "quantity": 1000,
                "quantity_uom": "KG",
                "printing": {"enabled": False},
            }
        )

        self.assertEqual(preview["layer_snapshot"][0]["material_code"], "SYNC-FILM-20-T")

    def test_preview_bom_returns_blockers_not_http_error_for_missing_required_axes(self):
        family = InventoryMaterial.objects.create(
            code="PREVIEW-BLOCK-FAM-T",
            name="Preview blocker family test",
            category="FILM_FAMILY",
            base_uom="KG",
        )
        InventoryMaterial.objects.create(
            code="PREVIEW-BLOCK-FILM-T",
            name="Preview blocker film test",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            is_extrudable=True,
        )
        template = TemplateBlueprint.objects.create(
            name="Preview Blocker Template",
            fg_type="POUCH",
            status="LIVE",
        )
        master = ProductMaster.objects.create(
            code="PM-PREVIEW-BLOCK-T",
            name="Preview Block Pouch",
            product_kind="POUCH",
            template=template,
            default_template=template,
            layer_template=[{"role": "sealant", "material_code": "PREVIEW-BLOCK-FILM-T", "thickness_micron": 40, "default_grade": "GP"}],
            variant_axes=[
                {"axis": "size", "type": "geometry", "required": True, "options": ["100x160"]},
                {"axis": "packaging_inner", "type": "packaging_ref", "required": True, "master_data_source": "packaging_material"},
            ],
            fixed_attributes={"fg_type": "POUCH", "layer_count": 1, "print_capable": False},
            invariant_signature="INV-PREVIEW-BLOCK-T",
        )
        user = get_user_model().objects.create_user(username="preview-admin", password="test")
        factory = APIRequestFactory()
        request = factory.post(
            f"/api/master/products/{master.id}/preview-bom/",
            {
                "product_master": str(master.id),
                "template_id": str(template.id),
                "axis_values": {"size": "100x160"},
                "quantity": 1000,
                "quantity_uom": "PCS",
                "printing": {"enabled": False},
            },
            format="json",
        )
        force_authenticate(request, user=user)
        response = ProductMasterViewSet.as_view({"post": "preview_bom"})(request, pk=str(master.id))

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["is_complete"])
        self.assertIn("packaging_inner", " ".join(response.data["blockers"]))

    @patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item")
    def test_preview_line_hydrates_inner_pack_axis_when_pcs_override_is_sent(self, preview_sales_item):
        family = InventoryMaterial.objects.create(
            code="PREVIEW-PACK-FAM-T",
            name="Preview pack family test",
            category="FILM_FAMILY",
            base_uom="KG",
        )
        InventoryMaterial.objects.create(
            code="PREVIEW-PACK-FILM-T",
            name="Preview pack film test",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            is_extrudable=True,
        )
        inner_pack = InventoryMaterial.objects.create(
            code="INNER-OVERRIDE-T",
            name="Inner override pack",
            category="PACKAGING",
            base_uom="PCS",
            packaging_kind="INNER_POUCH",
            packaging_supply_mode="PURCHASED",
            packaging_defaults_json={"pcs_per_pack": 24},
            status="ACTIVE",
        )
        template = TemplateBlueprint.objects.create(
            name="Preview Inner Override Template",
            fg_type="POUCH",
            status="LIVE",
        )
        master = ProductMaster.objects.create(
            code="PM-PREVIEW-INNER-OVERRIDE-T",
            name="Preview inner override pouch",
            product_kind="POUCH",
            template=template,
            default_template=template,
            layer_template=[{"role": "sealant", "material_code": "PREVIEW-PACK-FILM-T", "thickness_micron": 40, "default_grade": "GP"}],
            variant_axes=[
                {"axis": "size", "type": "geometry", "required": True, "options": ["100x160"]},
                {
                    "axis": "packaging_inner",
                    "type": "packaging_ref",
                    "required": True,
                    "master_data_source": "packaging_material",
                    "master_data_filter": {"packaging_kind": "INNER_POUCH"},
                },
            ],
            fixed_attributes={"fg_type": "POUCH", "layer_count": 1, "print_capable": False},
            invariant_signature="INV-PREVIEW-INNER-OVERRIDE-T",
        )
        ProductMasterSize.objects.create(
            product_master=master,
            code="100x160",
            label="100 x 160",
            width_mm=100,
            height_mm=160,
            roll_width_mm=220,
            active=True,
        )

        def _preview(payload):
            primary = payload["packaging_snapshot"]["primary_inner_pack"]
            self.assertEqual(primary["material_code"], inner_pack.code)
            self.assertEqual(primary["pcs_per_pack"], 100)
            return {
                "unit_weight_g": 5,
                "total_weight_kg": 5,
                "bom": {"planning_lines": [], "is_complete": True},
            }

        preview_sales_item.side_effect = _preview

        preview = BOMPreviewService.for_line(
            {
                "product_master": str(master.id),
                "template_id": str(template.id),
                "axis_values": {"size": "100x160", "packaging_inner": inner_pack.code},
                "qty": 1000,
                "quantity_uom": "PCS",
                "printing": {"enabled": False},
                "packaging_snapshot": {
                    "primary_inner_pack": {
                        "enabled": True,
                        "pcs_per_pack": 100,
                        "basis": "PCS_PER_PACK",
                    }
                },
            }
        )

        self.assertTrue(preview["is_complete"])
        self.assertEqual(preview["packaging_snapshot"]["primary_inner_pack"]["material_id"], str(inner_pack.id))

    @patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item")
    def test_preview_line_returns_validation_blockers_without_framework_error_text(self, preview_sales_item):
        family = InventoryMaterial.objects.create(
            code="PREVIEW-ERROR-FAM-T",
            name="Preview error family test",
            category="FILM_FAMILY",
            base_uom="KG",
        )
        InventoryMaterial.objects.create(
            code="PREVIEW-ERROR-FILM-T",
            name="Preview error film test",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            is_extrudable=True,
        )
        template = TemplateBlueprint.objects.create(
            name="Preview Error Template",
            fg_type="ROLL",
            status="LIVE",
        )
        master = ProductMaster.objects.create(
            code="PM-PREVIEW-ERROR-T",
            name="Preview error roll",
            product_kind="ROLL",
            template=template,
            default_template=template,
            layer_template=[{"role": "base", "material_code": "PREVIEW-ERROR-FILM-T", "thickness_micron": 40, "default_grade": "GP"}],
            variant_axes=[{"axis": "size", "type": "geometry", "required": True, "options": ["ROLL-500"]}],
            fixed_attributes={"fg_type": "ROLL", "layer_count": 1, "print_capable": False},
            invariant_signature="INV-PREVIEW-ERROR-T",
        )
        ProductMasterSize.objects.create(
            product_master=master,
            code="ROLL-500",
            label="500mm roll",
            width_mm=500,
            roll_width_mm=500,
            active=True,
        )
        preview_sales_item.side_effect = ValidationError({"layer_1": ["Layer grade must come from Product Master allowed grade options."]})

        preview = BOMPreviewService.for_line(
            {
                "product_master": str(master.id),
                "template_id": str(template.id),
                "axis_values": {"size": "ROLL-500"},
                "qty": 100,
                "quantity_uom": "KG",
                "printing": {"enabled": False},
            }
        )

        self.assertFalse(preview["is_complete"])
        self.assertIn("layer_1: Layer grade", " ".join(preview["errors"]))
        self.assertNotIn("error_list", " ".join(preview["errors"]))

    @patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item")
    def test_order_line_rejects_global_thickness_and_grade_axis_values(self, preview_sales_item):
        family = InventoryMaterial.objects.create(
            code="NO-GLOBAL-FAM-T",
            name="No global family",
            category="FILM_FAMILY",
            base_uom="KG",
        )
        InventoryMaterial.objects.create(
            code="NO-GLOBAL-LD-T",
            name="No global LD",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            is_extrudable=True,
        )
        roll_template = TemplateBlueprint.objects.create(
            name="No Global Template",
            fg_type="ROLL",
            status="LIVE",
        )
        roll_master = ProductMaster.objects.create(
            code="PM-NO-GLOBAL-T",
            name="No Global Roll",
            product_kind="ROLL",
            template=roll_template,
            default_template=roll_template,
            layer_template=[{"role": "base-film", "material_code": "NO-GLOBAL-LD-T", "thickness_micron": 46, "default_grade": "GP"}],
            variant_axes=[{"axis": "size", "type": "geometry", "required": True, "options": ["ROLL-1050"]}],
            fixed_attributes={"fg_type": "ROLL", "layer_count": 1, "roll_form": "FLAT", "print_capable": False},
            invariant_signature="INV-PM-NO-GLOBAL-T",
        )
        ProductMasterSize.objects.create(
            product_master=roll_master,
            code="ROLL-1050",
            label="1050mm roll",
            width_mm=1050,
            roll_width_mm=1050,
            standard_qty=1200,
            qty_uom="KG",
        )
        preview_sales_item.return_value = {
            "unit_weight_g": 0,
            "total_weight_kg": 1200,
            "bom": {"planning_lines": [], "is_complete": True},
        }

        with self.assertRaisesMessage(Exception, "Global thickness/grade axes are not valid"):
            SalesOrderService.create_sales_order(
                {
                    "customer": str(self.customer.id),
                    "delivery_date": "2026-05-18",
                    "items": [
                        {
                            "product_master": str(roll_master.id),
                            "template_id": str(roll_template.id),
                            "qty_value": 1200,
                            "qty_uom": "KG",
                            "unit_price": 145,
                            "price_basis": "KG",
                            "axis_values": {"size": "ROLL-1050", "thickness_um": 46, "grade": "GP"},
                            "printing": {"enabled": False},
                        }
                    ],
                }
            )

    @patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item")
    @patch("apps.sales.services.order_service.validate_pouch_geometry_contract")
    def test_order_line_axis_values_create_product_variant_snapshot(
        self,
        validate_geometry,
        preview_sales_item,
    ):
        family = InventoryMaterial.objects.create(
            code="DRY-LD-FAM-T",
            name="Dry LD family test",
            category="FILM_FAMILY",
            base_uom="KG",
        )
        InventoryMaterial.objects.create(
            code="LDPE-NAT",
            name="LDPE Natural",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            is_extrudable=True,
        )
        self.product.template = self.template
        self.product.default_template = self.template
        self.product.layer_template = [{"role": "sealant", "material_code": "LDPE-NAT", "thickness_micron": 65, "default_grade": "FOOD"}]
        self.product.variant_axes = [
            {"axis": "size", "type": "geometry", "required": True, "options": ["100x160"]},
        ]
        self.product.fixed_attributes = {"fg_type": "POUCH", "pouch_style": "STAND_UP", "layer_count": 1}
        self.product.invariant_signature = "INV-DRY-STANDUP"
        self.product.save()
        validate_geometry.side_effect = lambda **kwargs: kwargs["geometry"]
        preview_sales_item.return_value = {
            "unit_weight_g": 5,
            "total_weight_kg": 5,
            "bom": {"layers": [], "inks": []},
        }

        order = SalesOrderService.create_sales_order(
            {
                "customer": str(self.customer.id),
                "delivery_date": "2026-05-15",
                "items": [
                    {
                        "product_master": str(self.product.id),
                        "customer_product_overlay": str(self.overlay.id),
                        "template_id": str(self.template.id),
                        "qty_value": 1000,
                        "qty_uom": "PCS",
                        "unit_price": 2.5,
                        "price_basis": "PCS",
                        "axis_values": {"size": "100x160"},
                        "printing": {"enabled": False},
                        "addons": [],
                    }
                ],
            }
        )

        item = order.items.get()
        self.assertIsNone(item.sku_variant_id)
        self.assertIsNotNone(item.product_variant_id)
        self.assertEqual(item.axis_values["size"], "100x160")
        self.assertEqual(item.geometry_snapshot["size_code"], "100x160")
        self.assertEqual(item.geometry_snapshot["thickness_um"], 65)
        self.assertGreater(item.geometry_snapshot["roll_width_mm"], 0)
        self.assertEqual(item.layer_snapshot[0]["grade_code"], "FOOD")
        self.assertEqual(item.layer_snapshot[0]["roll_width_mm"], item.geometry_snapshot["roll_width_mm"])

    @patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item")
    @patch("apps.sales.services.order_service.validate_pouch_geometry_contract")
    def test_overlay_packaging_recipe_creates_real_bom_lines_without_zero_axis_placeholder(self, validate_geometry, preview_sales_item):
        family = InventoryMaterial.objects.create(
            code="PACK-OVERLAY-FAM-T",
            name="Packaging overlay family test",
            category="FILM_FAMILY",
            base_uom="KG",
        )
        InventoryMaterial.objects.create(
            code="PACK-OVERLAY-LD-T",
            name="Packaging overlay LD test",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            is_extrudable=True,
        )
        zero_rule_pack = InventoryMaterial.objects.create(
            code="AXIS-PACK-ZERO-T",
            name="Axis pack without pack rule",
            category="PACKAGING",
            base_uom="KG",
            packaging_kind="OUTER_BAG",
            packaging_supply_mode="IN_HOUSE",
        )
        overlay_pack = InventoryMaterial.objects.create(
            code="OVERLAY-INNER-PACK-T",
            name="Overlay inner pouch pack",
            category="PACKAGING",
            base_uom="PCS",
            packaging_kind="INNER_POUCH",
            packaging_supply_mode="IN_HOUSE",
        )
        overlay_gunny = InventoryMaterial.objects.create(
            code="OVERLAY-GUNNY-PACK-T",
            name="Overlay final gunny pack",
            category="PACKAGING",
            base_uom="PCS",
            packaging_kind="GONNY",
            packaging_supply_mode="PURCHASED",
            packaging_defaults_json={"kg_per_bag": 5},
        )
        self.product.template = self.template
        self.product.default_template = self.template
        self.product.layer_template = [{"role": "sealant", "material_code": "PACK-OVERLAY-LD-T", "thickness_micron": 65, "default_grade": "FOOD"}]
        self.product.variant_axes = [
            {"axis": "size", "type": "geometry", "required": True, "options": ["PACK-100"]},
            {"axis": "packaging", "type": "packaging_ref", "required": False, "options": ["AXIS-PACK-ZERO-T"]},
        ]
        self.product.fixed_attributes = {"fg_type": "POUCH", "pouch_style": "STAND_UP", "layer_count": 1}
        self.product.invariant_signature = "INV-PACK-OVERLAY"
        self.product.save()
        ProductMasterSize.objects.create(
            product_master=self.product,
            code="PACK-100",
            label="Pack 100",
            width_mm=100,
            height_mm=160,
            gusset_mm=30,
            standard_qty=1000,
            qty_uom="PCS",
        )
        self.overlay.axis_values = {"size": "PACK-100"}
        self.overlay.default_packing_recipe = {
            "packaging_lines": [
                {"material_code": overlay_pack.code, "role": "PRIMARY_INNER", "basis": "PCS_PER_PACK", "pcs_per_pack": 24},
                {"material_code": overlay_gunny.code, "role": "FINAL_GUNNY", "basis": "KG_PER_PACK", "kg_per_pack": 5},
            ]
        }
        self.overlay.save()
        validate_geometry.side_effect = lambda **kwargs: kwargs["geometry"]
        preview_sales_item.return_value = {
            "unit_weight_g": 6,
            "total_weight_kg": 6,
            "bom": {"planning_lines": [], "is_complete": True},
        }

        order = SalesOrderService.create_sales_order(
            {
                "customer": str(self.customer.id),
                "delivery_date": "2026-05-18",
                "items": [
                    {
                        "product_master": str(self.product.id),
                        "customer_product_overlay": str(self.overlay.id),
                        "template_id": str(self.template.id),
                        "qty_value": 240,
                        "qty_uom": "PCS",
                        "unit_price": 4,
                        "price_basis": "PCS",
                        "axis_values": {"size": "PACK-100", "packaging": zero_rule_pack.code},
                        "printing": {"enabled": False},
                    }
                ],
            }
        )

        item = order.items.get()
        self.assertEqual(item.packaging_snapshot["primary_inner_pack"]["material_id"], str(zero_rule_pack.id))
        packaging_lines = item.packaging_snapshot["packaging_lines"]
        self.assertEqual(len(packaging_lines), 2)
        lines_by_code = {line["material_code"]: line for line in packaging_lines}
        self.assertEqual(lines_by_code[overlay_pack.code]["pcs_per_pack"], 24)
        self.assertEqual(lines_by_code[overlay_pack.code]["qty"], 10.0)
        self.assertEqual(lines_by_code[overlay_gunny.code]["kg_per_pack"], 5.0)
        self.assertEqual(lines_by_code[overlay_gunny.code]["qty"], 2.0)

    @patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item")
    def test_live_preview_resolves_axis_snapshots_without_creating_variant(self, preview_sales_item):
        family = InventoryMaterial.objects.create(
            code="PREVIEW-FILM-FAM-T",
            name="Preview film family test",
            category="FILM_FAMILY",
            base_uom="KG",
        )
        InventoryMaterial.objects.create(
            code="PET",
            name="PET",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            is_extrudable=True,
        )
        InventoryMaterial.objects.create(
            code="LDPE",
            name="LDPE",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            is_extrudable=True,
        )
        self.product.template = self.template
        self.product.default_template = self.template
        self.product.layer_template = [
            {"role": "print-web", "material_code": "PET", "thickness_micron": 12, "default_grade": "FOOD"},
            {"role": "sealant", "material_code": "LDPE", "thickness_micron": 53, "default_grade": "FOOD"},
        ]
        self.product.variant_axes = [
            {"axis": "size", "type": "geometry", "required": True, "options": ["140x210"]},
            {"axis": "layer_grades", "type": "layer_enum", "required": False, "options": ["FOOD", "GP"], "scope": "per_layer"},
        ]
        self.product.fixed_attributes = {"fg_type": "POUCH", "pouch_style": "STAND_UP", "layer_count": 2}
        self.product.invariant_signature = "INV-PREVIEW-DRY"
        self.product.save()
        preview_sales_item.return_value = {
            "unit_weight_g": 7.5,
            "total_weight_kg": 7.5,
            "physics": {"ok": True},
            "bom": {
                "planning_lines": [
                    {"step_sequence": 1, "step_name": "Extrusion", "material_code": "LDPE", "planned_issue_qty": 4.5, "theoretical_qty": 4.5, "uom": "KG"},
                    {"step_sequence": 2, "step_name": "Printing", "material_code": "INK-CYAN", "planned_issue_qty": 0.2, "theoretical_qty": 0.2, "uom": "KG"},
                ],
                "is_complete": True,
            },
            "bom_preview": {"components": []},
        }

        preview = BOMPreviewService.for_line(
            {
                "product_master": str(self.product.id),
                "customer": str(self.customer.id),
                "customer_product_overlay": str(self.overlay.id),
                "template_id": str(self.template.id),
                "axis_values": {"size": "140x210", "layer_grades": ["GP", "GP"]},
                "qty": 1000,
                "quantity_uom": "PCS",
                "printing": {"enabled": False},
                "addons": [],
                "packaging_snapshot": {"customer_overlay": str(self.overlay.id)},
            }
        )

        self.assertEqual(ProductVariant.objects.filter(master=self.product).count(), 0)
        self.assertEqual(preview["geometry_snapshot"]["size_code"], "140x210")
        self.assertEqual(preview["geometry_snapshot"]["thickness_um"], 65.0)
        self.assertEqual(preview["layer_snapshot"][0]["grade_code"], "GP")
        self.assertEqual(preview["packaging_snapshot"]["customer_overlay"]["id"], str(self.overlay.id))
        self.assertEqual(preview["bom_by_step"][0]["step_name"], "Extrusion")
        self.assertEqual(preview["total_weight_kg"], 7.5)

    @patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item")
    def test_mld_ldnat_roll_axes_packaging_and_overlay_create_product_variant_not_sales_sku(self, preview_sales_item):
        family = InventoryMaterial.objects.create(
            code="MLD-LD-T",
            name="Multilayer LD test family",
            category="FILM_FAMILY",
            base_uom="KG",
            density_gcm3="0.9200",
        )
        InventoryMaterial.objects.create(
            code="LDNAT-ML-T",
            name="LD NATURAL - ML",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            is_extrudable=True,
            is_purchasable=True,
        )
        pack = InventoryMaterial.objects.create(
            code="ROLL-WRAP-T",
            name="Roll stretch wrap",
            category="PACKAGING",
            base_uom="PCS",
            packaging_kind="SHEET",
            packaging_supply_mode="PURCHASED",
        )
        InventoryMaterial.objects.create(
            code="CORONA-TREAT-T",
            name="Corona treatment",
            category="ADDON",
            base_uom="PCS",
            weight_mode="FIXED",
            weight_value=0,
        )
        roll_template = TemplateBlueprint.objects.create(
            name="MLD Roll Template",
            fg_type="ROLL",
            status="LIVE",
        )
        roll_master = ProductMaster.objects.create(
            code="PM-MLD-LDNAT-T",
            name="MLD LDNAT roll",
            product_kind="ROLL",
            template=roll_template,
            default_template=roll_template,
            layer_template=[{"role": "base-film", "material_code": "LDNAT-ML-T", "thickness_micron": 40, "default_grade": "GP"}],
            variant_axes=[
                {"axis": "size", "type": "geometry", "required": True, "options": ["ROLL-1050"]},
                {"axis": "layer_thicknesses", "type": "layer_number", "required": False, "options": [40, 46], "scope": "per_layer"},
                {"axis": "layer_grades", "type": "layer_enum", "required": False, "options": ["GP", "FOOD-A"], "scope": "per_layer"},
                {"axis": "addons", "type": "multi_enum", "required": False, "options": ["CORONA-TREAT-T"]},
                {"axis": "packaging", "type": "packaging_ref", "required": False, "options": ["ROLL-WRAP-T"]},
            ],
            fixed_attributes={"fg_type": "ROLL", "layer_count": 1, "roll_form": "FLAT", "print_capable": False},
            invariant_signature="INV-PM-MLD-LDNAT-T",
        )
        ProductMasterSize.objects.create(
            product_master=roll_master,
            code="ROLL-1050",
            label="1050mm roll",
            width_mm=1050,
            roll_width_mm=1050,
            thickness_micron=40,
            standard_qty=1200,
            qty_uom="KG",
        )
        overlay = CustomerProductOverlay.objects.create(
            product_master=roll_master,
            customer=self.customer,
            axis_values={"size": "ROLL-1050", "layer_grades": ["GP"]},
            customer_item_code="ACME-ROLL-1050-GP",
            customer_display_name="Acme MLD LDNAT 1050 GP",
            default_packing_note="Loose/stretched roll; final gunny if bundled.",
            default_packing_recipe={"roll_dispatch_pack": {"material_code": pack.code}},
            default_price_basis="KG",
            moq_kg=100,
        )
        preview_sales_item.return_value = {
            "unit_weight_g": 0,
            "total_weight_kg": 1200,
            "bom": {"planning_lines": [], "is_complete": True},
        }

        order = SalesOrderService.create_sales_order(
            {
                "customer": str(self.customer.id),
                "delivery_date": "2026-05-18",
                "items": [
                    {
                        "product_master": str(roll_master.id),
                        "customer_product_overlay": str(overlay.id),
                        "template_id": str(roll_template.id),
                        "qty_value": 1200,
                        "qty_uom": "KG",
                        "unit_price": 145,
                        "price_basis": "KG",
                        "axis_values": {
                            "size": "ROLL-1050",
                            "layer_thicknesses": [46],
                            "layer_grades": ["GP"],
                            "addons": ["CORONA-TREAT-T"],
                            "packaging": "ROLL-WRAP-T",
                        },
                        "printing": {"enabled": False},
                    }
                ],
            }
        )

        item = order.items.get()
        self.assertIsNone(item.sku_variant_id)
        self.assertEqual(SalesSku.objects.count(), 0)
        self.assertEqual(SalesSkuVariant.objects.count(), 0)
        self.assertIsNotNone(item.product_variant_id)
        self.assertEqual(ProductVariant.objects.filter(master=roll_master).count(), 1)
        self.assertEqual(item.geometry_snapshot["roll_width_mm"], 1050)
        self.assertEqual(item.geometry_snapshot["thickness_um"], 46)
        self.assertEqual(item.layer_snapshot[0]["material_code"], "LDNAT-ML-T")
        self.assertEqual(item.layer_snapshot[0]["thickness_micron"], 46)
        self.assertEqual(item.layer_snapshot[0]["roll_width_mm"], 1050)
        self.assertEqual(item.packaging_snapshot["customer_overlay"]["moq_kg"], 100.0)
        self.assertEqual(item.packaging_snapshot["primary_inner_pack"]["material_id"], str(pack.id))

    @patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item")
    @patch("apps.sales.services.order_service.validate_pouch_geometry_contract")
    def test_pouch_axes_hydrate_packaging_and_pod_snapshots_without_sales_sku(self, validate_geometry, preview_sales_item):
        family = InventoryMaterial.objects.create(
            code="PET-LD-POD-FAM-T",
            name="PET LD POD family test",
            category="FILM_FAMILY",
            base_uom="KG",
            density_gcm3="0.9200",
        )
        InventoryMaterial.objects.create(
            code="PET-POD-T",
            name="PET POD test",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            is_extrudable=False,
            is_purchasable=True,
        )
        InventoryMaterial.objects.create(
            code="LD-POD-T",
            name="LD POD test",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            is_extrudable=True,
            is_purchasable=True,
        )
        pack = InventoryMaterial.objects.create(
            code="INNER-POUCH-PACK-T",
            name="Inner pouch pack test",
            category="PACKAGING",
            base_uom="PCS",
            packaging_kind="INNER_POUCH",
            packaging_supply_mode="IN_HOUSE",
        )
        pod_material = InventoryMaterial.objects.create(
            code="POD-INHOUSE-T",
            name="In-house POD test",
            category="POD",
            status="ACTIVE",
            base_uom="KG",
            density_gcm3="0.9200",
            pod_type="SINGLE",
            pod_fixed_height_mm=25,
            pod_thickness_micron=35,
            pod_panel_count=1,
            pod_is_inhouse_produced=True,
            is_purchasable=True,
            is_extrudable=False,
        )
        pod_sku = PodSku.objects.create(code="POD-SKU-T", name="POD SKU test", family="POD", active=True)
        pod_variant = PodSkuVariant.objects.create(
            pod_sku=pod_sku,
            material=pod_material,
            code="POD-25-T",
            name="POD 25 test",
            active=True,
            production_defaults_json={"height_mm": 25, "in_house": True},
        )
        pouch_template = TemplateBlueprint.objects.create(
            name="POD pouch template",
            fg_type="POUCH",
            status="LIVE",
            pouch_style="STAND_UP",
        )
        master = ProductMaster.objects.create(
            code="PM-POD-POUCH-T",
            name="POD-ready pouch test",
            product_kind="POUCH",
            template=pouch_template,
            default_template=pouch_template,
            layer_template=[
                {"role": "print-web", "material_code": "PET-POD-T", "thickness_micron": 12, "default_grade": ""},
                {"role": "sealant", "material_code": "LD-POD-T", "thickness_micron": 65, "default_grade": "FOOD"},
            ],
            variant_axes=[
                {"axis": "size", "type": "geometry", "required": True, "options": ["POD-100"]},
                {"axis": "packaging", "type": "packaging_ref", "required": True, "options": ["INNER-POUCH-PACK-T"]},
                {"axis": "pod", "type": "pod_ref", "required": False, "options": ["POD-25-T"]},
            ],
            fixed_attributes={"fg_type": "POUCH", "layer_count": 2, "print_capable": False, "default_pouch_style": "STAND_UP"},
            invariant_signature="INV-PM-POD-POUCH-T",
        )
        ProductMasterSize.objects.create(
            product_master=master,
            code="POD-100",
            label="POD 100g",
            width_mm=100,
            height_mm=150,
            gusset_mm=30,
            standard_qty=1000,
            qty_uom="PCS",
            geometry_config={"multipliers": {"faces": 2}, "pouch_style": "STAND_UP"},
        )
        validate_geometry.side_effect = lambda **kwargs: kwargs["geometry"]
        preview_sales_item.return_value = {
            "unit_weight_g": 6,
            "total_weight_kg": 6,
            "bom": {"planning_lines": [], "is_complete": True},
        }

        order = SalesOrderService.create_sales_order(
            {
                "customer": str(self.customer.id),
                "delivery_date": "2026-05-18",
                "items": [
                    {
                        "product_master": str(master.id),
                        "template_id": str(pouch_template.id),
                        "qty_value": 1000,
                        "qty_uom": "PCS",
                        "unit_price": 4,
                        "price_basis": "PCS",
                        "axis_values": {"size": "POD-100", "packaging": "INNER-POUCH-PACK-T", "pod": "POD-25-T"},
                        "printing": {"enabled": False},
                    }
                ],
            }
        )

        item = order.items.get()
        self.assertIsNone(item.sku_variant_id)
        self.assertIsNotNone(item.product_variant_id)
        self.assertEqual(SalesSku.objects.count(), 0)
        self.assertEqual(SalesSkuVariant.objects.count(), 0)
        self.assertEqual(item.packaging_snapshot["primary_inner_pack"]["material_id"], str(pack.id))
        self.assertTrue(item.packaging_snapshot["pod"]["enabled"])
        self.assertEqual(item.packaging_snapshot["pod"]["pod_sku_variant_id"], str(pod_variant.id))
        self.assertEqual(item.packaging_snapshot["pod"]["pod_profile_id"], str(pod_material.id))
        self.assertEqual(item.packaging_snapshot["pod"]["pod_sku_code"], "POD-25-T")
        self.assertEqual(item.geometry_snapshot["thickness_um"], 77.0)
        self.assertEqual(item.layer_snapshot[0]["grade_code"], "")
        self.assertEqual(item.layer_snapshot[1]["grade_code"], "FOOD")

    @patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item")
    @patch("apps.sales.services.order_service.validate_pouch_geometry_contract")
    def test_v33_catalog_axes_hydrate_inner_outer_pack_and_pod_without_sales_sku(
        self,
        validate_geometry,
        preview_sales_item,
    ):
        family = InventoryMaterial.objects.create(
            code="PET-LD-V33-FAM-T",
            name="PET LD V33 family test",
            category="FILM_FAMILY",
            base_uom="KG",
            density_gcm3="0.9200",
        )
        InventoryMaterial.objects.create(
            code="PET-V33-T",
            name="PET V33 test",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            is_purchasable=True,
        )
        InventoryMaterial.objects.create(
            code="LD-V33-T",
            name="LD V33 test",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            is_extrudable=True,
            is_purchasable=True,
        )
        inner_pack = InventoryMaterial.objects.create(
            code="INNER-POUCH-V33-T",
            name="Inner pouch V33 test",
            category="PACKAGING",
            base_uom="PCS",
            packaging_kind="INNER_POUCH",
            packaging_supply_mode="IN_HOUSE",
            packaging_defaults_json={"pcs_per_pack": 24},
        )
        outer_pack = InventoryMaterial.objects.create(
            code="OUTER-GUNNY-V33-T",
            name="Outer gunny V33 test",
            category="PACKAGING",
            base_uom="PCS",
            packaging_kind="GONNY",
            packaging_supply_mode="PURCHASED",
            packaging_defaults_json={"inners_per_gunny": 12},
        )
        pod_material = InventoryMaterial.objects.create(
            code="POD-V33-MAT-T",
            name="POD V33 material test",
            category="POD",
            status="ACTIVE",
            base_uom="KG",
            density_gcm3="0.9200",
            pod_type="SINGLE",
            pod_fixed_height_mm=25,
            pod_thickness_micron=35,
            pod_panel_count=1,
            pod_is_inhouse_produced=True,
            is_purchasable=True,
        )
        pod_sku = PodSku.objects.create(code="POD-V33-SKU-T", name="POD V33 SKU test", family="POD", active=True)
        pod_variant = PodSkuVariant.objects.create(
            pod_sku=pod_sku,
            material=pod_material,
            code="POD-V33-25-T",
            name="POD V33 25 test",
            active=True,
            production_defaults_json={"height_mm": 25, "in_house": True},
        )
        pouch_template = TemplateBlueprint.objects.create(
            name="V33 catalog axis pouch template",
            fg_type="POUCH",
            status="LIVE",
            pouch_style="STAND_UP",
        )
        master = ProductMaster.objects.create(
            code="PM-V33-CATALOG-POUCH-T",
            name="V33 catalog-backed pouch test",
            product_kind="POUCH",
            template=pouch_template,
            default_template=pouch_template,
            layer_template=[
                {"role": "print-web", "material_code": "PET-V33-T", "thickness_micron": 12, "default_grade": ""},
                {"role": "sealant", "material_code": "LD-V33-T", "thickness_micron": 65, "default_grade": "FOOD"},
            ],
            variant_axes=[
                {"axis": "size", "type": "geometry", "required": True, "options": ["V33-100"]},
                {
                    "axis": "packaging_inner",
                    "type": "catalog_ref",
                    "required": True,
                    "master_data_source": "packaging_material",
                    "master_data_filter": {"packaging_kind": "INNER_POUCH"},
                    "options": ["STALE-INNER-OPTION-T"],
                    "qty_formula": "ceil(total_pouches / pcs_per_inner)",
                    "auto_demand_in_house": True,
                },
                {
                    "axis": "packaging_outer",
                    "type": "catalog_ref",
                    "required": False,
                    "master_data_source": "packaging_material",
                    "master_data_filter": {"packaging_kind": "GONNY"},
                    "options": ["OUTER-GUNNY-V33-T"],
                    "qty_per_pcs": 0,
                    "auto_demand_in_house": False,
                },
                {
                    "axis": "pod_variant",
                    "type": "catalog_ref",
                    "required": False,
                    "master_data_source": "pod_sku_variant",
                    "options": ["POD-V33-25-T"],
                    "qty_per_pcs": 1,
                    "auto_demand_in_house": True,
                },
            ],
            fixed_attributes={"fg_type": "POUCH", "layer_count": 2, "print_capable": False, "default_pouch_style": "STAND_UP"},
            invariant_signature="INV-PM-V33-CATALOG-POUCH-T",
        )
        ProductMasterSize.objects.create(
            product_master=master,
            code="V33-100",
            label="V33 100g",
            width_mm=100,
            height_mm=150,
            gusset_mm=30,
            standard_qty=1000,
            qty_uom="PCS",
            geometry_config={"multipliers": {"faces": 2}, "pouch_style": "STAND_UP"},
        )
        validate_geometry.side_effect = lambda **kwargs: kwargs["geometry"]
        preview_sales_item.return_value = {
            "unit_weight_g": 6,
            "total_weight_kg": 6,
            "bom": {"planning_lines": [], "is_complete": True},
        }

        order = SalesOrderService.create_sales_order(
            {
                "customer": str(self.customer.id),
                "delivery_date": "2026-05-18",
                "items": [
                    {
                        "product_master": str(master.id),
                        "template_id": str(pouch_template.id),
                        "qty_value": 1000,
                        "qty_uom": "PCS",
                        "unit_price": 4,
                        "price_basis": "PCS",
                        "axis_values": {
                            "size": "V33-100",
                            "packaging_inner": "INNER-POUCH-V33-T",
                            "packaging_outer": "OUTER-GUNNY-V33-T",
                            "pod_variant": "POD-V33-25-T",
                        },
                        "printing": {"enabled": False},
                    }
                ],
            }
        )

        item = order.items.get()
        self.assertIsNone(item.sku_variant_id)
        self.assertIsNotNone(item.product_variant_id)
        self.assertEqual(SalesSku.objects.count(), 0)
        self.assertEqual(SalesSkuVariant.objects.count(), 0)
        self.assertEqual(item.axis_values["packaging_inner"], "INNER-POUCH-V33-T")
        self.assertEqual(item.axis_values["packaging_outer"], "OUTER-GUNNY-V33-T")
        self.assertEqual(item.axis_values["pod_variant"], "POD-V33-25-T")
        self.assertEqual(item.packaging_snapshot["primary_inner_pack"]["material_id"], str(inner_pack.id))
        self.assertEqual(item.packaging_snapshot["final_outer_pack"]["material_id"], str(outer_pack.id))
        self.assertTrue(item.packaging_snapshot["final_outer_pack"]["counted_at_packing"])
        self.assertEqual(item.packaging_snapshot["final_outer_pack"]["basis"], "COUNTED_AT_PACKING")
        self.assertEqual(item.packaging_snapshot["final_outer_pack"]["packaging_kind"], "GONNY")
        packaging_line_ids = {row.get("material_id") for row in item.packaging_snapshot.get("packaging_lines", [])}
        self.assertIn(str(inner_pack.id), packaging_line_ids)
        self.assertNotIn(str(outer_pack.id), packaging_line_ids)
        self.assertTrue(item.packaging_snapshot["pod"]["enabled"])
        self.assertEqual(item.packaging_snapshot["pod"]["pod_sku_variant_id"], str(pod_variant.id))
        self.assertEqual(item.packaging_snapshot["pod"]["pod_profile_id"], str(pod_material.id))
        self.assertEqual(item.packaging_snapshot["pod"]["pod_sku_code"], "POD-V33-25-T")

    @patch("apps.sales.services.order_service.validate_pouch_geometry_contract")
    def test_preview_includes_packaging_as_bom_and_planning_lines(self, validate_geometry):
        film = InventoryMaterial.objects.create(
            code="PET-PACK-BOM-T",
            name="PET packing BOM test",
            category="FILM_VARIANT",
            base_uom="KG",
            density_gcm3="1.4000",
            is_purchasable=True,
        )
        inner_pack = InventoryMaterial.objects.create(
            code="INNER-PACK-BOM-T",
            name="Inner pack BOM test",
            category="PACKAGING",
            base_uom="PCS",
            packaging_kind="INNER_POUCH",
            packaging_supply_mode="IN_HOUSE",
            packaging_defaults_json={"pcs_per_pack": 25},
        )
        gunny = InventoryMaterial.objects.create(
            code="GUNNY-PACK-BOM-T",
            name="Gunny BOM test",
            category="PACKAGING",
            base_uom="PCS",
            packaging_kind="GONNY",
            packaging_supply_mode="PURCHASED",
            packaging_defaults_json={"kg_per_bag": 50},
        )
        validate_geometry.side_effect = lambda **kwargs: kwargs["geometry"]

        preview = SalesOrderService.preview_sales_item(
            {
                "finished_good_type": "POUCH",
                "geometry": {
                    "finished_good_type": "POUCH",
                    "base": {"width_mm": 100, "height_mm": 150, "gusset_mm": 30},
                    "multipliers": {"faces": 2},
                    "pouch_style": "STAND_UP",
                },
                "film_layers": [
                    {
                        "variant_id": str(film.id),
                        "material_code": film.code,
                        "name": film.name,
                        "role": "print-web",
                        "thickness_micron": 12,
                        "roll_width_mm": 260,
                    }
                ],
                "printing": {"enabled": False},
                "addons": [],
                "packaging_snapshot": {
                    "packaging_lines": [
                        {"material_id": str(inner_pack.id), "role": "PRIMARY_INNER", "basis": "PCS_PER_PACK", "pcs_per_pack": 25},
                        {"material_id": str(gunny.id), "role": "FINAL_GUNNY", "basis": "KG_PER_PACK", "kg_per_pack": 50},
                    ]
                },
                "order_qty": 1000,
                "uom": "PCS",
            }
        )

        bom = preview["bom"]
        packaging_codes = {row["material_code"] for row in bom.get("packaging", [])}
        self.assertEqual(packaging_codes, {"INNER-PACK-BOM-T", "GUNNY-PACK-BOM-T"})
        packaging_plan = [row for row in bom["planning_lines"] if row["category_code"] == "PACKAGING"]
        self.assertEqual({row["material_code"] for row in packaging_plan}, packaging_codes)
        self.assertTrue(all(row["policy_source"] == "PACKAGING_CONTRACT" for row in packaging_plan))
        self.assertIn("PCS", bom["planning_summary"]["theoretical_totals_by_uom"])

    @patch("apps.sales.services.order_service.validate_pouch_geometry_contract")
    def test_preview_inner_pack_with_kg_base_keeps_count_and_converted_stock_weight(self, validate_geometry):
        film = InventoryMaterial.objects.create(
            code="PET-KG-INNER-BOM-T",
            name="PET KG inner BOM test",
            category="FILM_VARIANT",
            base_uom="KG",
            density_gcm3="1.4000",
            is_purchasable=True,
        )
        inner_pack = InventoryMaterial.objects.create(
            code="PP-BAG-KG-INNER-T",
            name="PP bag KG inner test",
            category="PACKAGING",
            base_uom="KG",
            packaging_kind="INNER_POUCH",
            packaging_supply_mode="PURCHASED",
            packaging_defaults_json={"pcs_per_pack": 100},
            per_sheet_base_qty="0.008500",
        )
        validate_geometry.side_effect = lambda **kwargs: kwargs["geometry"]

        preview = SalesOrderService.preview_sales_item(
            {
                "finished_good_type": "POUCH",
                "geometry": {
                    "finished_good_type": "POUCH",
                    "base": {"width_mm": 100, "height_mm": 150, "gusset_mm": 30},
                    "multipliers": {"faces": 2},
                    "pouch_style": "STAND_UP",
                },
                "film_layers": [
                    {
                        "variant_id": str(film.id),
                        "material_code": film.code,
                        "name": film.name,
                        "role": "print-web",
                        "thickness_micron": 12,
                        "roll_width_mm": 260,
                    }
                ],
                "printing": {"enabled": False},
                "addons": [],
                "packaging_snapshot": {
                    "packaging_lines": [
                        {
                            "material_id": str(inner_pack.id),
                            "role": "PRIMARY_INNER",
                            "basis": "PCS_PER_PACK",
                            "pcs_per_pack": 100,
                        },
                    ]
                },
                "order_qty": 1000,
                "uom": "PCS",
            }
        )

        pack_row = preview["bom"]["packaging"][0]
        self.assertEqual(pack_row["material_code"], "PP-BAG-KG-INNER-T")
        self.assertEqual(pack_row["qty"], 10.0)
        self.assertEqual(pack_row["uom"], "PCS")
        self.assertEqual(pack_row["stock_uom"], "KG")
        self.assertEqual(pack_row["stock_qty"], 0.085)
        self.assertEqual(pack_row["weight_kg"], 0.085)
        self.assertEqual(pack_row["pack_count_pcs"], 10.0)

        packaging_plan = [row for row in preview["bom"]["planning_lines"] if row["category_code"] == "PACKAGING"]
        self.assertEqual(packaging_plan[0]["uom"], "PCS")
        self.assertEqual(packaging_plan[0]["theoretical_qty"], 10.0)
        self.assertEqual(packaging_plan[0]["stock_uom"], "KG")
        self.assertEqual(packaging_plan[0]["stock_qty"], 0.085)
        self.assertEqual(packaging_plan[0]["formula_params"]["unit_weight_kg"], 0.0085)

    def test_product_master_preview_uses_selected_adhesive_and_solvent_defaults(self):
        pet = InventoryMaterial.objects.create(
            code="PET-CHEM-PM-T",
            name="PET chemistry PM test",
            category="FILM_VARIANT",
            base_uom="KG",
            density_gcm3="1.3800",
            is_purchasable=True,
            is_extrudable=False,
            status="ACTIVE",
        )
        ldpe = InventoryMaterial.objects.create(
            code="LD-CHEM-PM-T",
            name="LD chemistry PM test",
            category="FILM_VARIANT",
            base_uom="KG",
            density_gcm3="0.9200",
            is_purchasable=True,
            is_extrudable=False,
            status="ACTIVE",
        )
        adhesive = InventoryMaterial.objects.create(
            code="ADH-PM-T",
            name="PM selected adhesive",
            category="ADHESIVE",
            base_uom="KG",
            status="ACTIVE",
        )
        solvent = InventoryMaterial.objects.create(
            code="SOL-PM-T",
            name="PM selected solvent",
            category="SOLVENT",
            base_uom="KG",
            status="ACTIVE",
        )
        master = ProductMaster.objects.create(
            code="PM-CHEM-PREVIEW-T",
            name="Chem preview pouch",
            product_kind="POUCH",
            template=self.template,
            default_template=self.template,
            default_reporting_group="FG",
            layer_template=[
                {"role": "print-web", "material_code": pet.code, "thickness_micron": 12, "default_grade": ""},
                {"role": "sealant", "material_code": ldpe.code, "thickness_micron": 60, "default_grade": ""},
            ],
            variant_axes=[{"axis": "size", "type": "geometry", "required": True, "options": ["CHEM-100"]}],
            fixed_attributes={
                "fg_type": "POUCH",
                "layer_count": 2,
                "print_capable": False,
                "adhesive_material_id": str(adhesive.id),
                "adhesive_gsm": 2.5,
                "solvent_material_id": str(solvent.id),
                "solvent_gsm": 0.8,
            },
        )
        ProductMasterSize.objects.create(
            product_master=master,
            code="CHEM-100",
            label="Chem 100",
            width_mm=100,
            height_mm=120,
            gusset_mm=20,
            qty_uom="PCS",
        )

        preview = BOMPreviewService.for_line(
            {
                "product_master": str(master.id),
                "axis_values": {"size": "CHEM-100"},
                "qty": 1000,
                "uom": "PCS",
                "printing": {"enabled": False},
            }
        )

        chemicals = {row["type"]: row for row in preview["bom"]["chemicals"]}
        self.assertEqual(chemicals["ADHESIVE"]["code"], adhesive.code)
        self.assertEqual(chemicals["SOLVENT"]["code"], solvent.code)
        self.assertEqual(chemicals["ADHESIVE"]["gsm"], 2.5)
        self.assertEqual(chemicals["SOLVENT"]["gsm"], 0.8)

        planning = [row for row in preview["bom"]["planning_lines"] if row["category_code"] in {"ADHESIVE", "SOLVENT"}]
        self.assertEqual({row["material_code"] for row in planning}, {adhesive.code, solvent.code})
        self.assertTrue(all(row["planned_issue_qty"] > 0 for row in planning))

    def test_live_preview_uses_artwork_ink_gsm_contract_for_bom(self):
        pet_film = InventoryMaterial.objects.create(
            code="PET-12-ART-INK-T",
            name="PET 12 artwork ink test",
            category="FILM_VARIANT",
            base_uom="KG",
            density_gcm3="1.3100",
            is_purchasable=True,
            status="ACTIVE",
        )
        artwork = Artwork.objects.create(
            design_code="ART-SALES-INK-GSM-T",
            name="Sales ink GSM test",
            print_type="FLEXO",
            substrate_mode="SHEET",
            front_colors=["RED", "BLACK"],
            front_colors_count=2,
            back_colors=[],
            back_colors_count=0,
            color_list=["RED", "BLACK"],
            colors_count=2,
            ink_gsm_total="1.5000",
            status="APPROVED",
        )

        preview = SalesOrderService.preview_sales_item(
            {
                "finished_good_type": "POUCH",
                "fg_type": "POUCH",
                "geometry": {
                    "base": {"width_mm": 100, "height_mm": 100, "gusset_mm": 0},
                    "multipliers": {"faces": 2},
                },
                "film_layers": [{"variant_id": str(pet_film.id), "thickness_micron": 12}],
                "printing": {
                    "enabled": True,
                    "type": "FLEXO",
                    "method": "FLEXO",
                    "substrate_mode": "SHEET",
                    "front_colors_count": 2,
                    "back_colors_count": 0,
                    "artwork_id": str(artwork.id),
                },
                "order_qty": 1,
                "uom": "PCS",
                "packaging_snapshot": {},
            }
        )

        self.assertEqual(len(preview["bom"]["inks"]), 1)
        ink_row = preview["bom"]["inks"][0]
        self.assertEqual(ink_row["color"], "TOTAL")
        self.assertEqual(ink_row["ink_base_family"], "PET")
        self.assertIsNone(ink_row["material_id"])
        self.assertEqual(ink_row["code"], "INK-THEORY")
        self.assertEqual(ink_row["gsm_total"], 1.5)

    @patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item")
    def test_bom_preview_surfaces_layer_resolved_pet_ink_family(self, preview_sales_item):
        pet_film = InventoryMaterial.objects.create(
            code="PET-FAMILY-PREVIEW-T",
            name="PET family preview test",
            category="FILM_VARIANT",
            base_uom="KG",
            density_gcm3="1.3100",
            is_purchasable=True,
            status="ACTIVE",
        )
        template = TemplateBlueprint.objects.create(
            name="PET family preview pouch template",
            fg_type="POUCH",
            status="LIVE",
        )
        master = ProductMaster.objects.create(
            code="PM-PET-FAMILY-PREVIEW-T",
            name="PET family preview pouch",
            product_kind="POUCH",
            template=template,
            default_template=template,
            layer_template=[
                {
                    "role": "outer",
                    "film_variant_id": str(pet_film.id),
                    "film_variant_code": pet_film.code,
                    "thickness_micron": 12,
                }
            ],
            variant_axes=[{"axis": "size", "type": "geometry", "required": True, "options": ["PET-100"]}],
            fixed_attributes={"fg_type": "POUCH", "layer_count": 1, "print_capable": True},
        )
        ProductMasterSize.objects.create(
            product_master=master,
            code="PET-100",
            label="PET 100",
            width_mm=100,
            height_mm=120,
            qty_uom="PCS",
        )
        preview_sales_item.return_value = {
            "unit_weight_g": 4,
            "total_weight_kg": 4,
            "bom": {"planning_lines": [], "is_complete": True},
        }

        preview = BOMPreviewService.for_line(
            {
                "product_master": str(master.id),
                "template_id": str(template.id),
                "axis_values": {"size": "PET-100"},
                "quantity": 1000,
                "quantity_uom": "PCS",
                "printing": {"enabled": False},
            }
        )

        self.assertEqual(preview["printing_snapshot"]["ink_base_family"], "PET")
