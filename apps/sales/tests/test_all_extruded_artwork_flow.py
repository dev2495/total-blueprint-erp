from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase

from apps.artwork.models import Artwork
from apps.factory.models import Process
from apps.materials.models import InventoryMaterial, PodSku, PodSkuVariant, ProductMaster, ProductMasterSize
from apps.production.models import SalesOrderItemInHouseDemand
from apps.recipes.models import RecipeGrade
from apps.routing.models import RoutingRule
from apps.sales.models import Customer, CustomerProductOverlay
from apps.sales.services.order_service import SalesOrderService
from apps.templates.models import TemplateBlueprint, TemplateProcessStep


class AllExtrudedArtworkProductMasterFlowTests(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(code="FLOW-CUST", name="Flow Demo Customer")
        self.grade = RecipeGrade.objects.create(name="FOOD-GRADE-FLOW", is_active=True)
        self.template = self._make_template()

        ld_family = InventoryMaterial.objects.create(
            code="FLOW-LD-FAMILY",
            name="Flow LD family",
            category="FILM_FAMILY",
            base_uom="KG",
            density_gcm3=Decimal("0.9200"),
        )
        self.white_ld = InventoryMaterial.objects.create(
            code="FLOW-LD-WHITE",
            name="Flow LD white extruded film",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=ld_family,
            is_extrudable=True,
            is_purchasable=False,
            grade=self.grade,
        )
        self.clear_ld = InventoryMaterial.objects.create(
            code="FLOW-LD-CLEAR",
            name="Flow LD clear extruded film",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=ld_family,
            is_extrudable=True,
            is_purchasable=False,
            grade=self.grade,
        )
        self.seal_ld = InventoryMaterial.objects.create(
            code="FLOW-LLD-SEAL",
            name="Flow LLD sealant extruded film",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=ld_family,
            is_extrudable=True,
            is_purchasable=False,
            grade=self.grade,
        )

        self.addon = InventoryMaterial.objects.create(
            code="FLOW-ZIPPER",
            name="Flow press zipper",
            category="ADDON",
            base_uom="PCS",
            weight_mode="PER_MM",
            weight_value=Decimal("0.015"),
        )
        self.inner_pack = InventoryMaterial.objects.create(
            code="FLOW-INNER-24",
            name="Flow printed inner pouch pack of 24",
            category="PACKAGING",
            base_uom="PCS",
            packaging_kind="INNER_POUCH",
            packaging_supply_mode="IN_HOUSE",
            production_template=self.template,
            packaging_defaults_json={"pcs_per_pack": 24},
        )
        self.gonny = InventoryMaterial.objects.create(
            code="FLOW-GONNY-12",
            name="Flow counted gunny",
            category="PACKAGING",
            base_uom="PCS",
            packaging_kind="GONNY",
            packaging_supply_mode="PURCHASED",
            packaging_defaults_json={"inners_per_gunny": 12},
        )
        pod_material = InventoryMaterial.objects.create(
            code="FLOW-POD-220-MAT",
            name="Flow 220mm POD film",
            category="POD",
            base_uom="KG",
            density_gcm3=Decimal("0.9200"),
            pod_type="SINGLE",
            pod_fixed_height_mm=220,
            pod_thickness_micron=35,
            pod_panel_count=1,
            pod_is_inhouse_produced=True,
        )
        pod_sku = PodSku.objects.create(code="FLOW-POD", name="Flow POD")
        self.pod_variant = PodSkuVariant.objects.create(
            pod_sku=pod_sku,
            material=pod_material,
            code="FLOW-POD-220",
            name="Flow POD 220",
        )

    def _make_template(self):
        process_codes = ["EXTRUSION", "PRINTING", "POUCHING"]
        for code in process_codes:
            Process.objects.get_or_create(
                code=code,
                defaults={
                    "name": code.title(),
                    "input_form": "BULK" if code == "EXTRUSION" else "ROLL",
                    "output_form": "ROLL" if code != "POUCHING" else "POUCH",
                    "roll_behavior": "CREATE_NEW" if code == "EXTRUSION" else "MODIFY_EXISTING",
                },
            )
        routing = RoutingRule.objects.create(name="Flow all extruded printed route", ordered_processes=process_codes)
        template = TemplateBlueprint.objects.create(
            name="Flow all extruded printed pouch template",
            fg_type="POUCH",
            status="LIVE",
            routing_rule=routing,
            pouch_style="STAND_UP",
        )
        for index, code in enumerate(process_codes, start=1):
            TemplateProcessStep.objects.create(template=template, sequence_number=index, process=Process.objects.get(code=code))
        return template

    def _make_master(self, *, code, name, layers, size_code, width, height, gusset, pod_enabled):
        axes = [
            {"axis": "size", "type": "geometry", "required": True, "options": [size_code]},
            {"axis": "layer_thicknesses", "type": "per_layer_number", "required": True},
            {"axis": "addons", "type": "multi_enum", "required": False, "options": [self.addon.code]},
            {"axis": "packaging_inner", "type": "packaging_ref", "required": True, "options": [self.inner_pack.code]},
            {"axis": "packaging_outer", "type": "packaging_ref", "required": False, "options": [self.gonny.code]},
        ]
        if pod_enabled:
            axes.append({"axis": "pod_variant", "type": "pod_ref", "required": False, "options": [self.pod_variant.code]})
        master = ProductMaster.objects.create(
            code=code,
            name=name,
            product_kind="POUCH",
            template=self.template,
            default_template=self.template,
            layer_template=layers,
            variant_axes=axes,
            fixed_attributes={
                "fg_type": "POUCH",
                "layer_count": len(layers),
                "print_capable": True,
                "print_type": "FLEXO",
                "film_type": "SHEET",
                "default_front_colors": 2,
                "default_ink_gsm_total": 1.2,
                "default_pouch_style": "STAND_UP",
            },
            invariant_signature=f"INV-{code}",
        )
        ProductMasterSize.objects.create(
            product_master=master,
            code=size_code,
            label=size_code,
            width_mm=width,
            height_mm=height,
            gusset_mm=gusset,
            qty_uom="PCS",
            geometry_config={"pouch_style": "STAND_UP", "multipliers": {"faces": 2}},
        )
        return master

    def _make_artwork(self, *, master, design_code, colors):
        return Artwork.objects.create(
            design_code=design_code,
            name=f"{design_code} approved artwork",
            print_type="FLEXO",
            substrate_mode="SHEET",
            product_master=master,
            colorway_name=design_code,
            front_colors=colors,
            front_colors_count=len(colors),
            back_colors=[],
            back_colors_count=0,
            color_list=colors,
            colors_count=len(colors),
            ink_gsm_total=Decimal("1.20"),
            file_path=f"/tmp/{design_code}.pdf",
            status="APPROVED",
        )

    def _preview(self, preview_data):
        printing = preview_data.get("printing") or {}
        colors = printing.get("color_names") or printing.get("front_colors") or ["CYAN"]
        return {
            "unit_weight_g": Decimal("6.2500"),
            "total_weight_kg": Decimal("6.2500"),
            "bom": {
                "is_complete": True,
                "planning_lines": [
                    {"step_sequence": 1, "step_name": "Extrusion", "material_code": "FLOW-LD-WHITE", "planned_issue_qty": 3.0, "uom": "KG"},
                    {"step_sequence": 2, "step_name": "Printing", "material_code": "INK-POLY-CYAN", "planned_issue_qty": 0.1, "uom": "KG"},
                ],
                "inks": [{"color": color, "qty_kg": 0.05, "uom": "KG"} for color in colors],
            },
        }

    @patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item")
    def test_two_all_extruded_printed_product_masters_confirm_with_customer_artwork_and_catalog_axes(self, preview_sales_item):
        preview_sales_item.side_effect = self._preview
        master_a = self._make_master(
            code="FLOW-DF-EXT-2L",
            name="Flow dry fruit all extruded 2L printed pouch",
            layers=[
                {"role": "print-web", "material_code": self.white_ld.code, "thickness_micron": 45, "default_grade": self.grade.name, "grade_options": [self.grade.name]},
                {"role": "sealant", "material_code": self.seal_ld.code, "thickness_micron": 60, "default_grade": self.grade.name, "grade_options": [self.grade.name]},
            ],
            size_code="FLOW-140X200",
            width=140,
            height=200,
            gusset=40,
            pod_enabled=True,
        )
        master_b = self._make_master(
            code="FLOW-NK-EXT-3L",
            name="Flow namkeen all extruded 3L printed pouch",
            layers=[
                {"role": "print-web", "material_code": self.clear_ld.code, "thickness_micron": 35, "default_grade": self.grade.name, "grade_options": [self.grade.name]},
                {"role": "barrier-web", "material_code": self.white_ld.code, "thickness_micron": 40, "default_grade": self.grade.name, "grade_options": [self.grade.name]},
                {"role": "sealant", "material_code": self.seal_ld.code, "thickness_micron": 70, "default_grade": self.grade.name, "grade_options": [self.grade.name]},
            ],
            size_code="FLOW-170X260",
            width=170,
            height=260,
            gusset=45,
            pod_enabled=False,
        )
        artwork_a = self._make_artwork(master=master_a, design_code="FLOW-ART-DF-CM", colors=["CYAN", "MAGENTA"])
        artwork_b = self._make_artwork(master=master_b, design_code="FLOW-ART-NK-CBK", colors=["CYAN", "BLACK"])
        overlay_a = CustomerProductOverlay.objects.create(
            product_master=master_a,
            customer=self.customer,
            customer_item_code="FLOW-CUST-DF-140",
            customer_display_name="Flow Customer Dry Fruit 140x200",
            default_artwork=artwork_a,
            default_price_basis="PCS",
            moq_kg=Decimal("25.0000"),
        )
        overlay_b = CustomerProductOverlay.objects.create(
            product_master=master_b,
            customer=self.customer,
            customer_item_code="FLOW-CUST-NK-170",
            customer_display_name="Flow Customer Namkeen 170x260",
            default_artwork=artwork_b,
            default_price_basis="PCS",
            moq_kg=Decimal("30.0000"),
        )

        order = SalesOrderService.create_sales_order(
            {
                "customer": str(self.customer.id),
                "delivery_date": "2026-05-25",
                "items": [
                    {
                        "product_master": str(master_a.id),
                        "customer_product_overlay": str(overlay_a.id),
                        "qty_value": 1000,
                        "qty_uom": "PCS",
                        "unit_price": 3.25,
                        "price_basis": "PCS",
                        "axis_values": {
                            "size": "FLOW-140X200",
                            "layer_thicknesses": {"1": 45, "2": 60},
                            "addons": [self.addon.code],
                            "packaging_inner": self.inner_pack.code,
                            "packaging_outer": self.gonny.code,
                            "pod_variant": self.pod_variant.code,
                        },
                    },
                    {
                        "product_master": str(master_b.id),
                        "customer_product_overlay": str(overlay_b.id),
                        "qty_value": 1200,
                        "qty_uom": "PCS",
                        "unit_price": 2.85,
                        "price_basis": "PCS",
                        "axis_values": {
                            "size": "FLOW-170X260",
                            "layer_thicknesses": {"1": 35, "2": 40, "3": 70},
                            "addons": [self.addon.code],
                            "packaging_inner": self.inner_pack.code,
                            "packaging_outer": self.gonny.code,
                        },
                    },
                ],
            }
        )
        confirmed = SalesOrderService.confirm_sales_order(order.id)

        self.assertEqual(confirmed.status, "PLANNING_REQUIRED")
        items = list(confirmed.items.order_by("created_at"))
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0].customer_product_overlay_id, overlay_a.id)
        self.assertEqual(items[1].customer_product_overlay_id, overlay_b.id)
        self.assertIsNotNone(items[0].product_variant_id)
        self.assertIsNotNone(items[1].product_variant_id)
        self.assertEqual(items[0].printing_snapshot["artwork_design_code"], artwork_a.design_code)
        self.assertEqual(items[1].printing_snapshot["artwork_design_code"], artwork_b.design_code)
        self.assertEqual(set(items[0].printing_snapshot["color_names"]), {"CYAN", "MAGENTA"})
        self.assertEqual(set(items[1].printing_snapshot["color_names"]), {"CYAN", "BLACK"})
        self.assertEqual(items[0].packaging_snapshot["primary_inner_pack"]["material_code"], self.inner_pack.code)
        self.assertEqual(items[0].packaging_snapshot["pod"]["pod_sku_variant_id"], str(self.pod_variant.id))
        self.assertTrue(items[0].packaging_snapshot["final_outer_pack"]["counted_at_packing"])
        self.assertEqual(items[1].addons_snapshot[0]["code"], self.addon.code)
        self.assertTrue(
            SalesOrderItemInHouseDemand.objects.filter(sales_order_item=items[0], demand_kind="PACKAGING").exists()
        )
        self.assertTrue(
            SalesOrderItemInHouseDemand.objects.filter(sales_order_item=items[0], demand_kind="POD").exists()
        )

    @patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item")
    def test_sales_order_artwork_modes_confirm_direct_overlay_and_defer_without_stale_artwork(self, preview_sales_item):
        preview_sales_item.side_effect = self._preview
        direct_master = self._make_master(
            code="FLOW-DIRECT-ART",
            name="Flow direct artwork pouch",
            layers=[
                {"role": "print-web", "material_code": self.white_ld.code, "thickness_micron": 35, "default_grade": self.grade.name, "grade_options": [self.grade.name]},
                {"role": "sealant", "material_code": self.seal_ld.code, "thickness_micron": 55, "default_grade": self.grade.name, "grade_options": [self.grade.name]},
            ],
            size_code="FLOW-DIRECT-120",
            width=120,
            height=180,
            gusset=35,
            pod_enabled=False,
        )
        overlay_master = self._make_master(
            code="FLOW-OVERLAY-ART",
            name="Flow overlay artwork pouch",
            layers=[
                {"role": "print-web", "material_code": self.clear_ld.code, "thickness_micron": 40, "default_grade": self.grade.name, "grade_options": [self.grade.name]},
                {"role": "sealant", "material_code": self.seal_ld.code, "thickness_micron": 60, "default_grade": self.grade.name, "grade_options": [self.grade.name]},
            ],
            size_code="FLOW-OVERLAY-140",
            width=140,
            height=210,
            gusset=40,
            pod_enabled=False,
        )
        defer_master = self._make_master(
            code="FLOW-DEFER-ART",
            name="Flow deferred artwork pouch",
            layers=[
                {"role": "print-web", "material_code": self.white_ld.code, "thickness_micron": 42, "default_grade": self.grade.name, "grade_options": [self.grade.name]},
                {"role": "sealant", "material_code": self.seal_ld.code, "thickness_micron": 62, "default_grade": self.grade.name, "grade_options": [self.grade.name]},
            ],
            size_code="FLOW-DEFER-160",
            width=160,
            height=240,
            gusset=45,
            pod_enabled=False,
        )
        for master in (direct_master, overlay_master, defer_master):
            master.fixed_attributes["artwork_required"] = True
            master.save(update_fields=["fixed_attributes"])

        direct_artwork = self._make_artwork(master=direct_master, design_code="FLOW-DIRECT-CM", colors=["CYAN", "MAGENTA"])
        overlay_artwork = self._make_artwork(master=overlay_master, design_code="FLOW-OVERLAY-CB", colors=["CYAN", "BLACK"])
        stale_overlay_artwork = self._make_artwork(master=defer_master, design_code="FLOW-DEFER-CM", colors=["CYAN", "MAGENTA"])
        overlay = CustomerProductOverlay.objects.create(
            product_master=overlay_master,
            customer=self.customer,
            customer_item_code="FLOW-OVERLAY-CUST",
            customer_display_name="Flow overlay artwork customer item",
            default_artwork=overlay_artwork,
            default_price_basis="PCS",
        )
        defer_overlay = CustomerProductOverlay.objects.create(
            product_master=defer_master,
            customer=self.customer,
            customer_item_code="FLOW-DEFER-CUST",
            customer_display_name="Flow defer artwork customer item",
            default_artwork=stale_overlay_artwork,
            default_price_basis="PCS",
        )

        order = SalesOrderService.create_sales_order(
            {
                "customer": str(self.customer.id),
                "delivery_date": "2026-06-20",
                "items": [
                    {
                        "product_master": str(direct_master.id),
                        "qty_value": 750,
                        "qty_uom": "PCS",
                        "unit_price": 3.10,
                        "price_basis": "PCS",
                        "axis_values": {
                            "size": "FLOW-DIRECT-120",
                            "layer_thicknesses": {"1": 35, "2": 55},
                            "addons": [self.addon.code],
                            "packaging_inner": self.inner_pack.code,
                            "packaging_outer": self.gonny.code,
                        },
                        "printing": {
                            "enabled": True,
                            "print_type": "FLEXO",
                            "film_type": "SHEET",
                            "artwork_id": str(direct_artwork.id),
                        },
                    },
                    {
                        "product_master": str(overlay_master.id),
                        "customer_product_overlay": str(overlay.id),
                        "qty_value": 900,
                        "qty_uom": "PCS",
                        "unit_price": 3.40,
                        "price_basis": "PCS",
                        "axis_values": {
                            "size": "FLOW-OVERLAY-140",
                            "layer_thicknesses": {"1": 40, "2": 60},
                            "addons": [self.addon.code],
                            "packaging_inner": self.inner_pack.code,
                            "packaging_outer": self.gonny.code,
                        },
                    },
                    {
                        "product_master": str(defer_master.id),
                        "customer_product_overlay": str(defer_overlay.id),
                        "qty_value": 1100,
                        "qty_uom": "PCS",
                        "unit_price": 3.60,
                        "price_basis": "PCS",
                        "axis_values": {
                            "size": "FLOW-DEFER-160",
                            "layer_thicknesses": {"1": 42, "2": 62},
                            "addons": [self.addon.code],
                            "packaging_inner": self.inner_pack.code,
                            "packaging_outer": self.gonny.code,
                        },
                        "printing": {
                            "enabled": True,
                            "print_type": "FLEXO",
                            "film_type": "SHEET",
                            "defer_artwork_to_planner": True,
                        },
                    },
                ],
            }
        )
        confirmed = SalesOrderService.confirm_sales_order(order.id)

        items = list(confirmed.items.order_by("created_at"))
        self.assertEqual(confirmed.status, "PLANNING_REQUIRED")
        self.assertEqual(len(items), 3)
        self.assertEqual(items[0].printing_snapshot["artwork_id"], str(direct_artwork.id))
        self.assertEqual(items[0].assigned_artwork_id, direct_artwork.id)
        self.assertFalse(items[0].artwork_assignment_required)
        self.assertEqual(set(items[0].printing_snapshot["color_names"]), {"CYAN", "MAGENTA"})
        self.assertEqual(items[1].customer_product_overlay_id, overlay.id)
        self.assertEqual(items[1].printing_snapshot["artwork_id"], str(overlay_artwork.id))
        self.assertEqual(items[1].assigned_artwork_id, overlay_artwork.id)
        self.assertFalse(items[1].artwork_assignment_required)
        self.assertEqual(set(items[1].printing_snapshot["color_names"]), {"CYAN", "BLACK"})
        self.assertEqual(items[2].customer_product_overlay_id, defer_overlay.id)
        self.assertTrue(items[2].printing_snapshot["defer_artwork_to_planner"])
        self.assertFalse(items[2].printing_snapshot.get("artwork_id"))
        self.assertNotIn(stale_overlay_artwork.design_code, str(items[2].printing_snapshot))
        self.assertTrue(items[2].artwork_assignment_required)
        self.assertIsNone(items[2].assigned_artwork_id)
        self.assertEqual(items[2].printing_snapshot["color_names"], ["FRONT-1", "FRONT-2"])
