from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase

from apps.factory.models import Plant, Process
from apps.inventory.models import InventoryBulk, InventoryLocation, PackagingStock
from apps.materials.models import (
    InventoryMaterial,
    PodSku,
    PodSkuVariant,
    ProductMaster,
    ProductMasterSize,
)
from apps.materials.services_product_variant import find_or_create_product_variant
from apps.production.models import PlannedBulkStockOrder, PlannedStockOrder, SalesOrderItemInHouseDemand
from apps.recipes.models import RecipeGrade
from apps.routing.models import RoutingRule
from apps.sales.models import Customer, SalesOrder
from apps.sales.services.order_service import SalesOrderService
from apps.templates.models import TemplateBlueprint, TemplateProcessStep


class PhotoProductMasterFlowTests(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(code="DR-FRUIT", name="Dry Fruit Customer")
        self.plant = Plant.objects.create(code="P1", name="Plant 1")
        self.rm_location = InventoryLocation.objects.create(
            plant=self.plant,
            code="RM",
            name="RM Store",
            type="RM",
        )
        self.grade = RecipeGrade.objects.create(name="FOOD")
        self.template = self._make_template(
            name="Photo pouch live route",
            fg_type="POUCH",
            pouch_style="STAND_UP",
            process_codes=["EXTRUSION", "PRINTING", "LAMINATION", "POUCHING"],
        )
        self._make_films()
        self.zipper = InventoryMaterial.objects.create(
            code="ZIPPER-POC",
            name="Press zipper",
            category="ADDON",
            base_uom="PCS",
            weight_mode="PER_MM",
            weight_value=0.013,
        )
        self.inner_pack = InventoryMaterial.objects.create(
            code="INNER-24-POC",
            name="Inner pouch pack of 24",
            category="PACKAGING",
            base_uom="PCS",
            packaging_kind="INNER_POUCH",
            packaging_supply_mode="IN_HOUSE",
            production_template=self.template,
            packaging_defaults_json={"pcs_per_pack": 24},
        )
        self.outer_gonny = InventoryMaterial.objects.create(
            code="GONNY-12-POC",
            name="Gonny counted at packing",
            category="PACKAGING",
            base_uom="PCS",
            packaging_kind="GONNY",
            packaging_supply_mode="PURCHASED",
            packaging_defaults_json={"inners_per_gunny": 12},
        )
        self.pod_220 = self._make_pod_variant("POD-220-POC", 220)
        self.pod_250 = self._make_pod_variant("POD-250-POC", 250)

    def _make_template(self, *, name, fg_type, pouch_style="", process_codes):
        for code in process_codes:
            Process.objects.get_or_create(
                code=code,
                defaults={
                    "name": code.title(),
                    "input_form": "ROLL" if code != "EXTRUSION" else "BULK",
                    "output_form": "ROLL",
                    "roll_behavior": "CREATE_NEW" if code == "EXTRUSION" else "MODIFY_EXISTING",
                },
            )
        routing = RoutingRule.objects.create(
            name=f"{name} route",
            ordered_processes=process_codes,
        )
        template = TemplateBlueprint.objects.create(
            name=name,
            fg_type=fg_type,
            status="LIVE",
            routing_rule=routing,
            pouch_style=pouch_style,
        )
        for index, code in enumerate(process_codes, start=1):
            process = Process.objects.get(code=code)
            TemplateProcessStep.objects.create(template=template, sequence_number=index, process=process)
        return template

    def _make_films(self):
        pet_family = InventoryMaterial.objects.create(
            code="PET-FAM-POC",
            name="PET family",
            category="FILM_FAMILY",
            base_uom="KG",
            density_gcm3=Decimal("1.4000"),
        )
        metpet_family = InventoryMaterial.objects.create(
            code="METPET-FAM-POC",
            name="MET PET family",
            category="FILM_FAMILY",
            base_uom="KG",
            density_gcm3=Decimal("1.4000"),
        )
        ld_family = InventoryMaterial.objects.create(
            code="LD-FAM-POC",
            name="LD family",
            category="FILM_FAMILY",
            base_uom="KG",
            density_gcm3=Decimal("0.9200"),
        )
        bopp_family = InventoryMaterial.objects.create(
            code="BOPP-FAM-POC",
            name="BOPP family",
            category="FILM_FAMILY",
            base_uom="KG",
            density_gcm3=Decimal("0.9100"),
        )
        InventoryMaterial.objects.create(
            code="PET-POC",
            name="PET film",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=pet_family,
            is_purchasable=True,
        )
        InventoryMaterial.objects.create(
            code="METPET-POC",
            name="MET PET film",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=metpet_family,
            is_purchasable=True,
        )
        InventoryMaterial.objects.create(
            code="LDNAT-POC",
            name="LD natural film",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=ld_family,
            is_extrudable=True,
            is_purchasable=True,
            grade=self.grade,
        )
        InventoryMaterial.objects.create(
            code="BOPP-POC",
            name="BOPP film",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=bopp_family,
            is_purchasable=True,
        )

    def _make_pod_variant(self, code, height_mm):
        material = InventoryMaterial.objects.create(
            code=f"{code}-MAT",
            name=f"{height_mm}mm POD material",
            category="POD",
            base_uom="KG",
            pod_type="SINGLE",
            pod_fixed_height_mm=height_mm,
            pod_thickness_micron=35,
            pod_panel_count=1,
            density_gcm3=Decimal("0.9200"),
            pod_is_inhouse_produced=True,
        )
        sku = PodSku.objects.create(code=code, name=f"{height_mm}mm POD")
        return PodSkuVariant.objects.create(
            pod_sku=sku,
            material=material,
            code=code,
            name=f"{height_mm}mm POD",
        )

    def _create_photo_masters(self):
        mango = ProductMaster.objects.create(
            code="PM-MANGO-SIDE-GUSSET-12-12-80",
            name="Mango side gusset pouch 1kg 12+12+80",
            product_kind="POUCH",
            template=self.template,
            default_template=self.template,
            layer_template=[
                {"role": "print-pet", "material_code": "PET-POC", "thickness_micron": 12, "default_grade": "FOOD"},
                {"role": "met-barrier", "material_code": "METPET-POC", "thickness_micron": 12, "default_grade": "FOOD"},
                {"role": "sealant", "material_code": "LDNAT-POC", "thickness_micron": 80, "default_grade": "FOOD"},
            ],
            variant_axes=[{"axis": "size", "type": "geometry", "required": True, "options": ["MANGO-1KG-210X260-G40X40"]}],
            fixed_attributes={"fg_type": "POUCH", "layer_count": 3, "print_capable": True, "default_pouch_style": "SIDE_GUSSET"},
            invariant_signature="INV-MANGO-SIDE-GUSSET-12-12-80",
        )
        ProductMasterSize.objects.create(
            product_master=mango,
            code="MANGO-1KG-210X260-G40X40",
            label="1kg 210x260mm gusset 40+40",
            width_mm=210,
            height_mm=260,
            gusset_mm=80,
            roll_width_mm=580,
            qty_uom="PCS",
            geometry_config={"pouch_style": "SIDE_GUSSET", "multipliers": {"faces": 2}},
        )

        dry_3ss = ProductMaster.objects.create(
            code="PM-DRYFRUIT-3SS-12-50",
            name="Dry fruit 3-side-seal PET+LD 12+50",
            product_kind="POUCH",
            template=self.template,
            default_template=self.template,
            layer_template=[
                {"role": "print-pet", "material_code": "PET-POC", "thickness_micron": 12, "default_grade": "FOOD"},
                {"role": "sealant", "material_code": "LDNAT-POC", "thickness_micron": 50, "default_grade": "FOOD"},
            ],
            variant_axes=[{"axis": "size", "type": "geometry", "required": True, "options": ["DF-100-115X150", "DF-250-140X200", "DF-500-170X250"]}],
            fixed_attributes={"fg_type": "POUCH", "layer_count": 2, "print_capable": True, "default_pouch_style": "THREE_SIDE_SEAL"},
            invariant_signature="INV-DRYFRUIT-3SS-12-50",
        )
        for code, label, width, height in [
            ("DF-100-115X150", "100g 115x150mm", 115, 150),
            ("DF-250-140X200", "250g 140x200mm", 140, 200),
            ("DF-500-170X250", "500g 170x250mm", 170, 250),
        ]:
            ProductMasterSize.objects.create(
                product_master=dry_3ss,
                code=code,
                label=label,
                width_mm=width,
                height_mm=height,
                qty_uom="PCS",
                geometry_config={"pouch_style": "THREE_SIDE_SEAL", "multipliers": {"faces": 2}},
            )

        dry_standup = ProductMaster.objects.create(
            code="PM-DRYFRUIT-STANDUP-ZIP-12-90",
            name="Dry fruit stand-up zipper PET+LD 12+90",
            product_kind="POUCH",
            template=self.template,
            default_template=self.template,
            layer_template=[
                {"role": "print-pet", "material_code": "PET-POC", "thickness_micron": 12, "default_grade": "FOOD"},
                {"role": "sealant", "material_code": "LDNAT-POC", "thickness_micron": 90, "default_grade": "FOOD"},
            ],
            variant_axes=[
                {"axis": "size", "type": "geometry", "required": True, "options": ["DF-SUP-250-140X200", "DF-SUP-500-170X250"]},
                {"axis": "addons", "type": "multi_enum", "required": False, "options": [self.zipper.code]},
            ],
            fixed_attributes={"fg_type": "POUCH", "layer_count": 2, "print_capable": True, "default_pouch_style": "STAND_UP"},
            invariant_signature="INV-DRYFRUIT-STANDUP-ZIP-12-90",
        )
        for code, label, width, height in [
            ("DF-SUP-250-140X200", "250g 140x200mm zipper", 140, 200),
            ("DF-SUP-500-170X250", "500g 170x250mm zipper", 170, 250),
        ]:
            ProductMasterSize.objects.create(
                product_master=dry_standup,
                code=code,
                label=label,
                width_mm=width,
                height_mm=height,
                gusset_mm=40,
                qty_uom="PCS",
                geometry_config={"pouch_style": "STAND_UP", "multipliers": {"faces": 2}},
            )
        return mango, dry_3ss, dry_standup

    def _create_bopp_axis_master(self):
        master = ProductMaster.objects.create(
            code="PM-BOPP-VARIABLE-POD",
            name="BOPP variable thickness and size pouch",
            product_kind="POUCH",
            template=self.template,
            default_template=self.template,
            layer_template=[
                {"role": "print-bopp", "material_code": "BOPP-POC", "thickness_micron": 12, "default_grade": "FOOD"},
                {"role": "sealant", "material_code": "LDNAT-POC", "thickness_micron": 50, "default_grade": "FOOD"},
            ],
            variant_axes=[
                {"axis": "size", "type": "geometry", "required": True, "options": ["BOPP-140X200", "BOPP-170X250"]},
                {"axis": "layer_thicknesses", "type": "per_layer_number", "required": False, "options": [12, 15, 18, 50, 60]},
                {"axis": "layer_widths", "type": "per_layer_number", "required": False},
                {"axis": "pod_variant", "type": "pod_ref", "required": False, "options": [self.pod_220.code, self.pod_250.code]},
                {"axis": "packaging_inner", "type": "packaging_ref", "required": False, "options": [self.inner_pack.code]},
                {"axis": "packaging_outer", "type": "packaging_ref", "required": False, "options": [self.outer_gonny.code]},
            ],
            fixed_attributes={"fg_type": "POUCH", "layer_count": 2, "print_capable": True, "default_pouch_style": "STAND_UP"},
            invariant_signature="INV-BOPP-VARIABLE-POD",
        )
        ProductMasterSize.objects.create(
            product_master=master,
            code="BOPP-140X200",
            label="140x200mm",
            width_mm=140,
            height_mm=200,
            gusset_mm=40,
            qty_uom="PCS",
            geometry_config={"pouch_style": "STAND_UP", "multipliers": {"faces": 2}},
        )
        ProductMasterSize.objects.create(
            product_master=master,
            code="BOPP-170X250",
            label="170x250mm",
            width_mm=170,
            height_mm=250,
            gusset_mm=40,
            roll_width_mm=360,
            qty_uom="PCS",
            geometry_config={"pouch_style": "STAND_UP", "multipliers": {"faces": 2}},
        )
        return master

    def test_photo_product_masters_and_bopp_axis_variants_resolve_without_sku_explosion(self):
        mango, dry_3ss, dry_standup = self._create_photo_masters()
        bopp = self._create_bopp_axis_master()

        mango_variant, _ = find_or_create_product_variant(mango, {"size": "MANGO-1KG-210X260-G40X40"})
        dry_variant, _ = find_or_create_product_variant(dry_3ss, {"size": "DF-250-140X200"})
        standup_variant, _ = find_or_create_product_variant(dry_standup, {"size": "DF-SUP-500-170X250", "addons": [self.zipper.code]})
        fallback_variant, _ = find_or_create_product_variant(
            bopp,
            {
                "size": "BOPP-140X200",
                "layer_thicknesses": {"1": 15, "2": 60},
                "pod_variant": self.pod_220.code,
            },
        )
        explicit_width_variant, _ = find_or_create_product_variant(
            bopp,
            {
                "size": "BOPP-170X250",
                "layer_thicknesses": {"1": 18, "2": 60},
                "layer_widths": {"1": 305, "2": 310},
                "pod_variant": self.pod_250.code,
            },
        )

        self.assertEqual([row["thickness_micron"] for row in mango_variant.layer_snapshot], [12.0, 12.0, 80.0])
        self.assertEqual([row["thickness_micron"] for row in dry_variant.layer_snapshot], [12.0, 50.0])
        self.assertEqual([row["thickness_micron"] for row in standup_variant.layer_snapshot], [12.0, 90.0])
        self.assertGreater(fallback_variant.geometry_snapshot["roll_width_mm"], 0)
        self.assertEqual(fallback_variant.layer_snapshot[0]["thickness_micron"], 15.0)
        self.assertEqual(fallback_variant.layer_snapshot[1]["thickness_micron"], 60.0)
        self.assertEqual(explicit_width_variant.layer_snapshot[0]["roll_width_mm"], 305.0)
        self.assertEqual(explicit_width_variant.layer_snapshot[1]["roll_width_mm"], 310.0)

    @patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item")
    def test_sales_confirm_uses_pod_and_inner_pack_stock_before_auto_demand(self, preview_sales_item):
        bopp = self._create_bopp_axis_master()
        PackagingStock.objects.create(
            material=self.inner_pack,
            plant=self.plant,
            location=self.rm_location,
            qty=Decimal("100"),
        )
        InventoryBulk.objects.create(
            material=self.pod_220.material,
            plant=self.plant,
            location=self.rm_location,
            qty_kg=Decimal("2.0000"),
        )
        preview_sales_item.return_value = {
            "unit_weight_g": Decimal("5.0000"),
            "total_weight_kg": Decimal("5.0000"),
            "bom": {
                "planning_lines": [
                    {
                        "category_code": "POD",
                        "material_id": str(self.pod_220.material_id),
                        "material_code": self.pod_220.material.code,
                        "planned_issue_qty": 1.25,
                    }
                ],
                "is_complete": True,
            },
        }

        order = SalesOrderService.create_sales_order(
            {
                "customer": str(self.customer.id),
                "delivery_date": "2026-05-20",
                "plant": str(self.plant.id),
                "items": [
                    {
                        "product_master": str(bopp.id),
                        "qty_value": 1000,
                        "qty_uom": "PCS",
                        "unit_price": 2.5,
                        "price_basis": "PCS",
                        "axis_values": {
                            "size": "BOPP-140X200",
                            "layer_thicknesses": {"1": 15, "2": 60},
                            "pod_variant": self.pod_220.code,
                            "packaging_inner": self.inner_pack.code,
                            "packaging_outer": self.outer_gonny.code,
                        },
                        "printing": {
                            "enabled": True,
                            "type": "ROTO",
                            "substrate_mode": "SHEET",
                            "front_colors_count": 4,
                            "defer_artwork_to_planner": True,
                        },
                    }
                ],
            }
        )
        item = order.items.get()
        self.assertIsNotNone(item.product_variant_id)
        self.assertIsNone(item.sku_variant_id)
        self.assertEqual(item.packaging_snapshot["pod"]["pod_sku_variant_id"], str(self.pod_220.id))
        self.assertEqual(item.packaging_snapshot["primary_inner_pack"]["material_code"], self.inner_pack.code)
        self.assertTrue(item.packaging_snapshot["final_outer_pack"]["counted_at_packing"])

        confirmed = SalesOrderService.confirm_sales_order(order.id)

        self.assertEqual(confirmed.status, "PLANNING_REQUIRED")
        self.assertFalse(SalesOrderItemInHouseDemand.objects.filter(sales_order_item=item).exists())
        self.assertEqual(PlannedBulkStockOrder.objects.count(), 0)
        self.assertEqual(PlannedStockOrder.objects.count(), 0)

    @patch("apps.sales.services.order_service.SalesOrderService.preview_sales_item")
    def test_sales_confirm_auto_demands_pod_and_inner_pack_shortage_when_stock_absent(self, preview_sales_item):
        bopp = self._create_bopp_axis_master()
        preview_sales_item.return_value = {
            "unit_weight_g": Decimal("5.0000"),
            "total_weight_kg": Decimal("5.0000"),
            "bom": {
                "planning_lines": [
                    {
                        "category_code": "POD",
                        "material_id": str(self.pod_250.material_id),
                        "material_code": self.pod_250.material.code,
                        "planned_issue_qty": 1.25,
                    }
                ],
                "is_complete": True,
            },
        }

        order = SalesOrderService.create_sales_order(
            {
                "customer": str(self.customer.id),
                "delivery_date": "2026-05-20",
                "plant": str(self.plant.id),
                "items": [
                    {
                        "product_master": str(bopp.id),
                        "qty_value": 1000,
                        "qty_uom": "PCS",
                        "unit_price": 2.5,
                        "price_basis": "PCS",
                        "axis_values": {
                            "size": "BOPP-170X250",
                            "layer_thicknesses": {"1": 18, "2": 60},
                            "layer_widths": {"1": 305, "2": 310},
                            "pod_variant": self.pod_250.code,
                            "packaging_inner": self.inner_pack.code,
                            "packaging_outer": self.outer_gonny.code,
                        },
                        "printing": {
                            "enabled": True,
                            "type": "ROTO",
                            "substrate_mode": "SHEET",
                            "front_colors_count": 4,
                            "defer_artwork_to_planner": True,
                        },
                    }
                ],
            }
        )
        SalesOrderService.confirm_sales_order(order.id)
        item = SalesOrder.objects.get(id=order.id).items.get()

        demands = {
            demand.demand_kind: demand
            for demand in SalesOrderItemInHouseDemand.objects.select_related("planned_stock_order", "planned_bulk_stock_order", "packaging_material").filter(sales_order_item=item)
        }
        self.assertEqual(demands["PACKAGING"].target_qty, Decimal("42.0000"))
        self.assertEqual(demands["PACKAGING"].planned_stock_order.stock_strategy, "PACKAGING_STOCK")
        self.assertEqual(demands["POD"].target_qty, Decimal("1.2500"))
        self.assertEqual(demands["POD"].planned_bulk_stock_order.target_qty_kg, Decimal("1.2500"))
