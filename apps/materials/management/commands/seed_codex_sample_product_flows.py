from __future__ import annotations

import json
from copy import deepcopy
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db.models import Q
from django.utils import timezone
from rest_framework.test import APIClient

from apps.artwork.models import Artwork
from apps.factory.models import Plant, Process
from apps.inventory.models import InkMaterial, InventoryLocation, Vendor
from apps.materials.models import (
    CommercialFamily,
    InventoryMaterial,
    PodSku,
    PodSkuVariant,
    ProductMaster,
    ProductMasterSize,
    ProductVariant,
)
from apps.materials.services_product_variant import find_or_create_product_variant
from apps.production.models import (
    DeliveryChallan,
    DeliveryChallanItem,
    FinishedGoodsBatch,
    PackingUnit,
    PlannedBulkStockOrder,
    PlannedStockOrder,
    RollDispatchPackRecord,
    SalesOrderItemInHouseDemand,
)
from apps.recipes.models import ExtrusionRecipe, ExtrusionRecipeComponent, RecipeGrade
from apps.routing.models import RoutingRule
from apps.sales.models import Customer, SalesOrder
from apps.sales.services.order_service import SalesOrderService
from apps.templates.models import TemplateBlueprint, TemplateProcessStep, TemplateProcessStepRollSpec
from apps.users.models import Role


def _json(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, dict):
        return {key: _json(child) for key, child in value.items()}
    if isinstance(value, list):
        return [_json(child) for child in value]
    return value


class Command(BaseCommand):
    help = "Seed Codex E2E product-master, stock-launcher, GRN, POD, and packaging sample flows."

    def handle(self, *args, **options):
        self.report = {"created_at": timezone.now().isoformat(), "samples": {}, "checks": []}

        owner = self._owner_user()
        self._reset_codex_flow_records()
        plant = self._plant()
        rm_location = self._location(plant, "RM", "Raw Material Store", "RM")
        fg_location = self._location(plant, "FG", "Finished Goods Store", "FG")
        vendor = self._vendor()
        grade = self._grade()
        template = self._template(owner)

        materials = self._materials(template, grade)
        self._recipes(materials, grade)
        pod_220, pod_260 = self._pod_variants(materials)
        product_masters = self._product_masters(template, grade, materials, pod_220, pod_260)

        self._create_variants(product_masters, grade, materials, pod_220, pod_260)
        self._post_grns(owner, vendor, plant, rm_location, materials, pod_220)
        self._create_sales_and_stock_orders(owner, plant, product_masters, materials, pod_220, pod_260)

        self._snapshot_counts()
        self.stdout.write(json.dumps(_json(self.report), indent=2, sort_keys=True))

    def _reset_codex_flow_records(self):
        deleted = {}
        current_sample_codes = [
            "PM-CODEX-DRYFRUIT-3L",
            "PM-CODEX-MANGO-3L",
            "PM-CODEX-BOPP-VARIABLE",
            "PM-CODEX-BOPP-1L-VARIABLE",
            "PM-CODEX-INNER-POUCH-PACK",
            "PM-CODEX-POD-FILM",
        ]
        legacy_demo_codes = [
            "PM-DRY-PET-LD",
            "PM-ECO-BOPP-PE",
            "PM-SNK-BOPP-MET-CPP",
        ]
        sample_master_filter = (
            Q(code__startswith="PM-E2E-CODEX")
            | Q(code__startswith="PM-CODEX")
            | Q(code__in=legacy_demo_codes)
        )
        SalesOrderItemInHouseDemand.objects.filter(
            sales_order_item__sales_order__order_name__startswith="CODEX",
        ).delete()
        deleted["challan_items"] = DeliveryChallanItem.objects.filter(
            sales_order_item__sales_order__order_name__startswith="CODEX",
        ).delete()[0]
        deleted["roll_pack_records"] = RollDispatchPackRecord.objects.filter(
            sales_order_item__sales_order__order_name__startswith="CODEX",
        ).delete()[0]
        deleted["packing_units"] = PackingUnit.objects.filter(
            sales_order_item__sales_order__order_name__startswith="CODEX",
        ).delete()[0]
        deleted["fg_batches"] = FinishedGoodsBatch.objects.filter(
            sales_order_item__sales_order__order_name__startswith="CODEX",
        ).delete()[0]
        deleted["challans"] = DeliveryChallan.objects.filter(
            sales_order__order_name__startswith="CODEX",
        ).delete()[0]
        deleted["sales_orders"] = SalesOrder.objects.filter(order_name__startswith="CODEX").delete()[0]
        deleted["stock_orders"] = PlannedStockOrder.objects.filter(template__name="CODEX_SAMPLE_POUCH_TEMPLATE_V36").delete()[0]
        deleted["stock_orders_by_master"] = PlannedStockOrder.objects.filter(product_master__code__startswith="PM-CODEX").delete()[0]
        deleted["bulk_stock_orders"] = PlannedBulkStockOrder.objects.filter(
            material__code__in=["POD-220-CODEX", "POD-260-CODEX"],
        ).delete()[0]
        deleted["artworks"] = Artwork.objects.filter(design_code__startswith="CODEX-ART").delete()[0]
        deleted["variants"] = ProductVariant.objects.filter(
            Q(master__code__startswith="PM-E2E-CODEX")
            | Q(master__code__startswith="PM-CODEX")
            | Q(master__code__in=legacy_demo_codes)
        ).delete()[0]
        deleted["product_masters"] = ProductMaster.objects.filter(sample_master_filter).delete()[0]
        self.report["samples"]["reset_deleted"] = deleted
        self.report["samples"]["fresh_product_master_codes"] = current_sample_codes

    def _owner_user(self):
        role, _ = Role.objects.update_or_create(
            code="OWNER",
            defaults={"name": "Owner", "default_permissions": ["inventory.manage", "production.manage", "sales.manage"]},
        )
        user_model = get_user_model()
        user, _ = user_model.objects.update_or_create(
            username="codex_e2e_owner",
            defaults={
                "email": "codex-e2e@example.local",
                "role": role,
                "is_owner": True,
                "is_staff": True,
                "is_superuser": True,
                "extra_permissions": ["inventory.manage", "production.manage", "sales.manage"],
            },
        )
        if not user.has_usable_password() or not user.check_password("codex-e2e-local"):
            user.set_password("codex-e2e-local")
            user.save(update_fields=["password"])
        self.report["samples"]["user"] = str(user.id)
        return user

    def _plant(self):
        plant, _ = Plant.objects.update_or_create(
            code="CODEX",
            defaults={"name": "Codex Demo Plant", "include_in_official_reports": False},
        )
        self.report["samples"]["plant"] = str(plant.id)
        return plant

    def _location(self, plant, code, name, loc_type):
        location, _ = InventoryLocation.objects.update_or_create(
            plant=plant,
            code=code,
            name=name,
            defaults={"type": loc_type, "is_active": True, "is_system": True},
        )
        return location

    def _vendor(self):
        vendor, _ = Vendor.objects.update_or_create(
            code="CODEX-VENDOR",
            defaults={"name": "Codex Sample Vendor", "type": "RM", "status": "ACTIVE", "qc_required": False},
        )
        self.report["samples"]["vendor"] = str(vendor.id)
        return vendor

    def _grade(self):
        grade, _ = RecipeGrade.objects.update_or_create(name="CODEX FOOD GRADE", defaults={"is_active": True})
        self.report["samples"]["grade"] = str(grade.id)
        return grade

    def _process(self, code, defaults):
        process, _ = Process.objects.update_or_create(code=code, defaults={"name": defaults.pop("name"), **defaults})
        return process

    def _template(self, owner):
        process_defs = [
            ("EXTRUSION", {"name": "Extrusion", "input_form": "BULK", "output_form": "ROLL", "roll_behavior": "CREATE_NEW", "transition": "BULK_TO_ROLL", "requires_recipe": True}),
            ("PRINTING", {"name": "Printing", "input_form": "ROLL", "output_form": "ROLL", "roll_behavior": "MODIFY_EXISTING", "transition": "ROLL_TO_ROLL", "has_artwork": True, "print_capable": True}),
            ("LAMINATION", {"name": "Lamination", "input_form": "ROLL", "output_form": "ROLL", "roll_behavior": "MULTI_INPUT_COMBINE", "transition": "ROLL_TO_ROLL", "requires_lamination_adhesive": True}),
            ("SLITTING", {"name": "Slitting", "input_form": "ROLL", "output_form": "ROLL", "roll_behavior": "SPLIT", "transition": "ROLL_TO_ROLL"}),
            ("POUCHING", {"name": "Pouching", "input_form": "ROLL", "output_form": "BULK", "roll_behavior": "NONE", "transition": "ROLL_TO_BULK"}),
        ]
        processes = [self._process(code, deepcopy(defaults)) for code, defaults in process_defs]
        route, _ = RoutingRule.objects.update_or_create(
            name="CODEX_SAMPLE_POUCH_ROUTE_V36",
            defaults={
                "description": "Codex E2E route: extrusion -> printing -> lamination -> slitting -> pouching",
                "ordered_processes": [p.code for p in processes],
                "is_active": True,
            },
        )
        template, _ = TemplateBlueprint.objects.update_or_create(
            name="CODEX_SAMPLE_POUCH_TEMPLATE_V36",
            defaults={
                "fg_type": "POUCH",
                "status": "LIVE",
                "routing_rule": route,
                "version": 1,
                "default_stock_strategy": "FINAL_STOCK",
                "pouch_style": "STAND_UP",
                "created_by": owner,
            },
        )
        for sequence, process in enumerate(processes, start=1):
            step, _ = TemplateProcessStep.objects.update_or_create(
                template=template,
                sequence_number=sequence,
                defaults={"process": process, "is_removed_from_route": False},
            )
            spec_defaults = {
                "input_roll_count": 1,
                "thickness_rule": "TEMPLATE_DEFAULT",
                "width_rule": "TEMPLATE_DEFAULT",
                "operator_entry_mode": "PROCESS_DEFAULT",
            }
            if process.roll_behavior == "CREATE_NEW":
                spec_defaults.update({"thickness_rule": "FIXED", "width_rule": "OPERATOR", "operator_entry_mode": "ROLL_SINGLE"})
            elif process.roll_behavior == "MODIFY_EXISTING":
                spec_defaults.update({"thickness_rule": "INHERIT_INPUT", "width_rule": "LOCK_INPUT", "operator_entry_mode": "ROLL_SINGLE"})
            elif process.roll_behavior == "MULTI_INPUT_COMBINE":
                spec_defaults.update({
                    "input_roll_count": 2,
                    "input_lane_count": 2,
                    "combine_mode": "LANE_GROUPS",
                    "thickness_rule": "SUM_INPUTS",
                    "width_rule": "MIN_INPUT",
                    "operator_entry_mode": "ROLL_SINGLE",
                    "adhesive_split_pct": Decimal("70"),
                    "solvent_split_pct": Decimal("30"),
                })
            elif process.roll_behavior == "SPLIT":
                spec_defaults.update({"thickness_rule": "INHERIT_INPUT", "width_rule": "OPERATOR_GRID", "operator_entry_mode": "GRID_SPLIT"})
            TemplateProcessStepRollSpec.objects.update_or_create(template_step=step, defaults=spec_defaults)
        self.report["samples"]["template"] = str(template.id)
        return template

    def _family(self, code, name, density, form="ROLL", reporting="FILM"):
        family, _ = CommercialFamily.objects.update_or_create(
            code=code,
            defaults={"name": name, "default_form": form, "default_reporting_group": reporting, "active": True},
        )
        return family

    def _material(self, code, defaults):
        material, _ = InventoryMaterial.objects.update_or_create(code=code, defaults=defaults)
        material.full_clean()
        material.save()
        return material

    def _ink_material(self, base_type, color_name):
        ink, _ = InkMaterial.objects.update_or_create(
            base_type=base_type,
            color_name=color_name.upper(),
            defaults={
                "code": f"INK-{base_type}-{color_name.upper()}-CODEX",
                "name": f"{base_type} {color_name.upper()} ink",
                "base_uom": "KG",
                "status": "ACTIVE",
            },
        )
        ink.save()
        return ink

    def _ink_mapping(self, colors):
        mapping = {}
        for color in colors:
            color_key = str(color or "").strip().upper()
            if not color_key:
                continue
            row = {}
            for base_type in ("POLY", "PET"):
                ink = InkMaterial.objects.filter(base_type=base_type, color_name=color_key).first()
                if ink:
                    row[base_type] = str(ink.id)
            if row:
                mapping[color_key] = row
        return mapping

    def _materials(self, template, grade):
        pet_family = self._material("PET-FAM", {"name": "PET Film Family", "category": "FILM_FAMILY", "base_uom": "KG", "density_gcm3": Decimal("1.3800")})
        bopp_family = self._material("BOPP-FAM", {"name": "BOPP Film Family", "category": "FILM_FAMILY", "base_uom": "KG", "density_gcm3": Decimal("0.9100")})
        vmpet_family = self._material("VMPET-FAM", {"name": "VMPET Film Family", "category": "FILM_FAMILY", "base_uom": "KG", "density_gcm3": Decimal("1.4000")})
        lldpe_family = self._material("LDPE-FAM", {"name": "LDPE Film Family", "category": "FILM_FAMILY", "base_uom": "KG", "density_gcm3": Decimal("0.9200")})
        materials = {
            "PET12": self._material("PET-12-CODEX", {"name": "PET 12 micron", "category": "FILM_VARIANT", "base_uom": "KG", "parent_family": pet_family, "is_extrudable": False, "is_purchasable": True}),
            "BOPP18": self._material("BOPP-18-CODEX", {"name": "BOPP 18 micron", "category": "FILM_VARIANT", "base_uom": "KG", "parent_family": bopp_family, "is_extrudable": False, "is_purchasable": True}),
            "BOPP_VAR": self._material("BOPP-VAR-CODEX", {"name": "BOPP purchased film variable thickness", "category": "FILM_VARIANT", "base_uom": "KG", "parent_family": bopp_family, "is_extrudable": False, "is_purchasable": True}),
            "METBOPP20": self._material("MET-BOPP-20-CODEX", {"name": "Metallized BOPP 20 micron", "category": "FILM_VARIANT", "base_uom": "KG", "parent_family": bopp_family, "is_extrudable": False, "is_purchasable": True}),
            "VMPET12": self._material("VMPET-12-CODEX", {"name": "VMPET 12 micron", "category": "FILM_VARIANT", "base_uom": "KG", "parent_family": vmpet_family, "is_extrudable": False, "is_purchasable": True}),
            "LDPE": self._material("LDPE-FOOD-CODEX", {"name": "LDPE Food Sealant Film", "category": "FILM_VARIANT", "base_uom": "KG", "parent_family": lldpe_family, "grade": grade, "is_extrudable": True, "is_purchasable": True}),
            "LDPE_GRANULE": self._material("GRANULE-LDPE-CODEX", {"name": "LDPE Food Grade Granule", "category": "GRANULE", "base_uom": "KG"}),
            "INK_CYAN": self._material("INK-CYAN-CODEX", {"name": "Cyan Ink", "category": "INK", "base_uom": "KG"}),
            "INK_RED": self._material("INK-RED-CODEX", {"name": "Red Ink", "category": "INK", "base_uom": "KG"}),
            "ADH": self._material("ADH-SOLVENTLESS-CODEX", {"name": "Solventless Adhesive", "category": "ADHESIVE", "base_uom": "KG"}),
            "SOL": self._material("SOL-ACETATE-CODEX", {"name": "Ethyl acetate solvent", "category": "SOLVENT", "base_uom": "KG"}),
            "ZIP": self._material("ZIP-PCS-CODEX", {"name": "Purchased zipper add-on", "category": "ADDON", "base_uom": "PCS", "weight_mode": "PER_PIECE", "weight_value": 1.2, "addon_is_purchased": True, "addon_purchase_uom": "PCS"}),
            "INNER_PURCHASED": self._material("INNER-POUCH-24-CODEX", {"name": "Purchased inner pouch 24 pcs", "category": "PACKAGING", "base_uom": "PCS", "packaging_kind": "INNER_POUCH", "packaging_supply_mode": "PURCHASED", "packaging_defaults_json": {"pcs_per_pack": 24, "basis": "PCS_PER_PACK"}}),
            "INNER_INHOUSE": self._material("INNER-POUCH-IH-CODEX", {"name": "In-house inner pouch 24 pcs", "category": "PACKAGING", "base_uom": "PCS", "packaging_kind": "INNER_POUCH", "packaging_supply_mode": "IN_HOUSE", "production_template": template, "packaging_defaults_json": {"pcs_per_pack": 24, "basis": "PCS_PER_PACK"}}),
            "GUNNY": self._material("GUNNY-50KG-CODEX", {"name": "Gunny bag 50kg", "category": "PACKAGING", "base_uom": "PCS", "packaging_kind": "GONNY", "packaging_supply_mode": "PURCHASED", "packaging_defaults_json": {"kg_per_bag": 50, "basis": "KG_PER_PACK"}}),
            "TAPE": self._material("TAPE-STD-CODEX", {"name": "Packing tape standard", "category": "PACKAGING", "base_uom": "PCS", "packaging_kind": "TAPE", "packaging_supply_mode": "PURCHASED", "packaging_defaults_json": {"basis": "COUNTED_AT_PACKING"}}),
            "SHEET": self._material("SHEET-SEPARATOR-CODEX", {"name": "Separator sheet", "category": "PACKAGING", "base_uom": "PCS", "packaging_kind": "SHEET", "packaging_supply_mode": "PURCHASED", "packaging_defaults_json": {"basis": "COUNTED_AT_PACKING"}}),
            "CARTON": self._material("CARTON-STD-CODEX", {"name": "Standard carton box", "category": "PACKAGING", "base_uom": "PCS", "packaging_kind": "BOX", "packaging_supply_mode": "PURCHASED", "packaging_defaults_json": {"basis": "COUNTED_AT_PACKING"}}),
        }
        for base_type in ("POLY", "PET"):
            for color in ("CYAN", "RED", "YELLOW", "BLACK", "GREEN", "BLUE"):
                self._ink_material(base_type, color)
        self.report["samples"]["materials"] = {key: str(value.id) for key, value in materials.items()}
        return materials

    def _recipes(self, materials, grade):
        recipe, _ = ExtrusionRecipe.objects.update_or_create(
            film_variant=materials["LDPE"],
            grade=grade,
            thickness_min_micron=20,
            thickness_max_micron=120,
            is_active=True,
        )
        ExtrusionRecipeComponent.objects.update_or_create(
            recipe=recipe,
            granule=materials["LDPE_GRANULE"],
            defaults={"percentage": 100.0},
        )
        self.report["samples"]["extrusion_recipe"] = str(recipe.id)

    def _pod_variants(self, materials):
        pod_material_220 = self._material("POD-220-CODEX", {"name": "POD film 220mm", "category": "POD", "base_uom": "KG", "density_gcm3": Decimal("0.9200"), "pod_type": "SINGLE", "pod_fixed_height_mm": Decimal("220"), "pod_thickness_micron": Decimal("30"), "pod_panel_count": 1, "pod_is_inhouse_produced": True})
        pod_material_260 = self._material("POD-260-CODEX", {"name": "POD film 260mm", "category": "POD", "base_uom": "KG", "density_gcm3": Decimal("0.9200"), "pod_type": "SINGLE", "pod_fixed_height_mm": Decimal("260"), "pod_thickness_micron": Decimal("30"), "pod_panel_count": 1, "pod_is_inhouse_produced": True})
        sku, _ = PodSku.objects.update_or_create(code="CODEX-POD-SKU", defaults={"name": "Codex POD set", "family": "Dry fruit pouch", "active": True})
        pod_220, _ = PodSkuVariant.objects.update_or_create(
            pod_sku=sku,
            code="CODEX-POD-220",
            defaults={"name": "220mm POD", "material": pod_material_220, "active": True},
        )
        pod_260, _ = PodSkuVariant.objects.update_or_create(
            pod_sku=sku,
            code="CODEX-POD-260",
            defaults={"name": "260mm POD no stock", "material": pod_material_260, "active": True},
        )
        self.report["samples"]["pod_variants"] = {"220": str(pod_220.id), "260": str(pod_260.id)}
        return pod_220, pod_260

    def _axes(self, sizes, grade, materials, pod_220, pod_260):
        return [
            {"axis": "size", "type": "geometry", "required": True, "options": sizes, "scope": "geometry"},
            {"axis": "layer_thicknesses", "type": "per_layer_number", "required": True, "scope": "bom"},
            {"axis": "layer_widths", "type": "per_layer_number", "required": True, "scope": "bom"},
            {"axis": "layer_grades", "type": "per_layer_enum", "required": False, "options": [grade.name], "scope": "bom"},
            {"axis": "pod_variant", "type": "catalog_ref", "required": False, "master_data_source": "pod_sku_variant", "options": [{"code": pod_220.code, "pod_sku_code": pod_220.code}, {"code": pod_260.code, "pod_sku_code": pod_260.code}], "qty_per_pcs": 1, "auto_demand_in_house": True, "scope": "packaging"},
            {"axis": "packaging_inner", "type": "catalog_ref", "required": False, "master_data_source": "packaging_material", "master_data_filter": {"packaging_kind": "INNER_POUCH"}, "options": [{"code": materials["INNER_PURCHASED"].code, "material_code": materials["INNER_PURCHASED"].code}, {"code": materials["INNER_INHOUSE"].code, "material_code": materials["INNER_INHOUSE"].code}], "qty_formula": "ceil(total_pouches / pcs_per_inner)", "auto_demand_in_house": True, "scope": "packaging"},
            {"axis": "packaging_outer", "type": "catalog_ref", "required": False, "master_data_source": "packaging_material", "master_data_filter": {"packaging_kind": ["GONNY", "SHEET"]}, "options": [{"code": materials["GUNNY"].code, "material_code": materials["GUNNY"].code}, {"code": materials["SHEET"].code, "material_code": materials["SHEET"].code}], "qty_per_pcs": 0, "auto_demand_in_house": False, "scope": "packaging"},
            {"axis": "addons", "type": "multi_enum", "required": False, "master_data_source": "addon", "options": [materials["ZIP"].code], "scope": "addons"},
        ]

    def _product_masters(self, template, grade, materials, pod_220, pod_260):
        pouch_family, _ = CommercialFamily.objects.update_or_create(
            code="CODEX-DRY-FRUIT",
            defaults={"name": "Codex Dry Fruit Pouch", "default_form": "POUCH", "default_reporting_group": "FG", "active": True},
        )
        dry_sizes = [
            ("DF-100-115X150", "Dry fruit 100g 115 x 150", 115, 150, 40, 270),
            ("DF-250-140X200", "Dry fruit 250g 140 x 200", 140, 200, 60, 330),
            ("DF-500-170X250", "Dry fruit 500g 170 x 250", 170, 250, 80, 420),
        ]
        mango_sizes = [("MANGO-1KG-210X260", "Mango 1kg 210 x 260", 210, 260, 80, 580)]
        bopp_sizes = [
            ("BOPP-140X200", "BOPP snack 140 x 200", 140, 200, 50, 330),
            ("BOPP-170X250", "BOPP snack 170 x 250", 170, 250, 70, 420),
        ]
        note_sizes = [("NOTE-170X250", "Note 170 x 250", 170, 250, 0, 340)]
        note_zip_sizes = [("NOTE-140X200", "Note 140 x 200", 140, 200, 0, 280)]

        masters = {
            "dry_fruit": self._master(
                code="PM-CODEX-DRYFRUIT-3L",
                name="Codex Dry Fruit Pouch 3 Layer",
                template=template,
                family=pouch_family,
                layer_template=[
                    {"role": "outer_print", "name": "PET print layer", "film_variant_code": materials["PET12"].code, "thickness_micron": 12, "thickness_options": [12]},
                    {"role": "barrier", "name": "Met BOPP barrier", "film_variant_code": materials["METBOPP20"].code, "thickness_micron": 20, "thickness_options": [20]},
                    {"role": "sealant", "name": "LDPE sealant", "film_variant_code": materials["LDPE"].code, "thickness_micron": 65, "thickness_options": [50, 65, 80], "default_grade": grade.name, "grade_options": [grade.name]},
                ],
                axes=self._axes([s[0] for s in dry_sizes], grade, materials, pod_220, pod_260),
                fixed={**self._chem_fixed(materials, "2.50", "0.90"), "layer_count": 3, "fg_type": "POUCH", "print_capable": True, "default_front_colors": 2, "default_ink_gsm_total": 1.2, "pouch_style": "STAND_UP"},
                sizes=dry_sizes,
            ),
            "mango": self._master(
                code="PM-CODEX-MANGO-3L",
                name="Codex Mango Pouch 3 Layer",
                template=template,
                family=pouch_family,
                layer_template=[
                    {"role": "outer_print", "name": "PET print layer", "film_variant_code": materials["PET12"].code, "thickness_micron": 12, "thickness_options": [12]},
                    {"role": "barrier", "name": "VMPET barrier", "film_variant_code": materials["VMPET12"].code, "thickness_micron": 12, "thickness_options": [12]},
                    {"role": "sealant", "name": "LDPE sealant", "film_variant_code": materials["LDPE"].code, "thickness_micron": 80, "thickness_options": [65, 80, 100], "default_grade": grade.name, "grade_options": [grade.name]},
                ],
                axes=self._axes([s[0] for s in mango_sizes], grade, materials, pod_220, pod_260),
                fixed={**self._chem_fixed(materials, "2.60", "0.95"), "layer_count": 3, "fg_type": "POUCH", "print_capable": True, "default_front_colors": 2, "default_ink_gsm_total": 1.2, "pouch_style": "STAND_UP"},
                sizes=mango_sizes,
            ),
            "bopp_variable": self._master(
                code="PM-CODEX-BOPP-VARIABLE",
                name="Codex BOPP Variable Size Thickness Pouch",
                template=template,
                family=pouch_family,
                layer_template=[
                    {"role": "outer_print", "name": "BOPP print layer", "film_variant_code": materials["BOPP_VAR"].code, "thickness_micron": 18, "thickness_options": [18, 20, 25]},
                    {"role": "sealant", "name": "LDPE sealant", "film_variant_code": materials["LDPE"].code, "thickness_micron": 40, "thickness_options": [40, 50], "default_grade": grade.name, "grade_options": [grade.name]},
                ],
                axes=self._axes([s[0] for s in bopp_sizes], grade, materials, pod_220, pod_260),
                fixed={**self._chem_fixed(materials, "2.20", "0.70"), "layer_count": 2, "fg_type": "POUCH", "print_capable": True, "default_front_colors": 2, "default_ink_gsm_total": 1.2, "pouch_style": "STAND_UP"},
                sizes=bopp_sizes,
            ),
            "note_side": self._master(
                code="PM-NOTE-SIDE-50",
                name="Note Side 50",
                template=template,
                family=pouch_family,
                layer_template=[
                    {"role": "outer_print", "name": "PET print", "film_variant_code": materials["PET12"].code, "thickness_micron": 12, "thickness_options": [12]},
                    {"role": "sealant", "name": "LD seal", "film_variant_code": materials["LDPE"].code, "thickness_micron": 50, "thickness_options": [50], "default_grade": grade.name, "grade_options": [grade.name]},
                ],
                axes=self._axes([s[0] for s in note_sizes], grade, materials, pod_220, pod_260),
                fixed={**self._chem_fixed(materials, "2.40", "0.80"), "layer_count": 2, "fg_type": "POUCH", "print_capable": True, "default_front_colors": 2, "default_ink_gsm_total": 1.2, "pouch_style": "THREE_SIDE_SEAL"},
                sizes=note_sizes,
            ),
            "note_zip": self._master(
                code="PM-NOTE-ZIP-50",
                name="Note Zip 50",
                template=template,
                family=pouch_family,
                layer_template=[
                    {"role": "outer_print", "name": "PET print", "film_variant_code": materials["PET12"].code, "thickness_micron": 12, "thickness_options": [12]},
                    {"role": "sealant", "name": "LD seal", "film_variant_code": materials["LDPE"].code, "thickness_micron": 50, "thickness_options": [50], "default_grade": grade.name, "grade_options": [grade.name]},
                ],
                axes=self._axes([s[0] for s in note_zip_sizes], grade, materials, pod_220, pod_260),
                fixed={**self._chem_fixed(materials, "2.40", "0.80"), "layer_count": 2, "fg_type": "POUCH", "print_capable": True, "default_front_colors": 2, "default_ink_gsm_total": 1.2, "pouch_style": "THREE_SIDE_SEAL"},
                sizes=note_zip_sizes,
            ),
            "bopp_single_layer": self._master(
                code="PM-CODEX-BOPP-1L-VARIABLE",
                name="Codex BOPP Single Layer Variable Size Thickness",
                template=template,
                family=pouch_family,
                layer_template=[
                    {"role": "single_web", "name": "BOPP purchased web", "film_variant_code": materials["BOPP_VAR"].code, "thickness_micron": 18, "thickness_options": [18, 20, 25]},
                ],
                axes=[
                    {"axis": "size", "type": "geometry", "required": True, "options": [s[0] for s in bopp_sizes], "scope": "geometry"},
                    {"axis": "layer_thicknesses", "type": "per_layer_number", "required": True, "scope": "bom"},
                    {"axis": "layer_widths", "type": "per_layer_number", "required": True, "scope": "bom"},
                ],
                fixed={"layer_count": 1, "fg_type": "POUCH", "print_capable": False, "pouch_style": "PILLOW"},
                sizes=bopp_sizes,
            ),
            "inner_packaging": self._master(
                code="PM-CODEX-INNER-POUCH-PACK",
                name="Codex Inner Pouch Packaging Product",
                template=template,
                family=pouch_family,
                product_kind="PACKAGING",
                layer_template=[
                    {"role": "single_layer", "name": "LDPE inner pouch", "film_variant_code": materials["LDPE"].code, "thickness_micron": 50, "thickness_options": [40, 50, 60], "default_grade": grade.name, "grade_options": [grade.name]},
                ],
                axes=[
                    {"axis": "size", "type": "geometry", "required": True, "options": ["INNER-100X120"], "scope": "geometry"},
                    {"axis": "layer_thicknesses", "type": "per_layer_number", "required": True, "scope": "bom"},
                    {"axis": "layer_widths", "type": "per_layer_number", "required": True, "scope": "bom"},
                    {"axis": "layer_grades", "type": "per_layer_enum", "required": False, "options": [grade.name], "scope": "bom"},
                    {"axis": "packaging_ref", "type": "packaging_ref", "required": True, "options": [{"code": materials["INNER_INHOUSE"].code, "material_code": materials["INNER_INHOUSE"].code}], "scope": "packaging"},
                ],
                fixed={"layer_count": 1, "fg_type": "POUCH", "print_capable": False, "packaging_material_code": materials["INNER_INHOUSE"].code, "pouch_style": "THREE_SIDE_SEAL"},
                sizes=[("INNER-100X120", "Inner pouch 100 x 120", 100, 120, 0, 220)],
            ),
            "pod_film": self._master(
                code="PM-CODEX-POD-FILM",
                name="Codex In-house POD Film Master",
                template=template,
                family=pouch_family,
                product_kind="POD",
                layer_template=[
                    {"role": "pod_web", "name": "LDPE POD film", "film_variant_code": materials["LDPE"].code, "thickness_micron": 30, "thickness_options": [25, 30, 35], "default_grade": grade.name, "grade_options": [grade.name]},
                ],
                axes=[
                    {"axis": "size", "type": "geometry", "required": True, "options": ["POD-220", "POD-260"], "scope": "geometry"},
                    {"axis": "layer_thicknesses", "type": "per_layer_number", "required": True, "scope": "bom"},
                    {"axis": "layer_widths", "type": "per_layer_number", "required": True, "scope": "bom"},
                    {"axis": "layer_grades", "type": "per_layer_enum", "required": False, "options": [grade.name], "scope": "bom"},
                    {"axis": "pod_ref", "type": "pod_ref", "required": True, "options": [{"code": pod_220.code, "pod_sku_code": pod_220.code}, {"code": pod_260.code, "pod_sku_code": pod_260.code}], "scope": "pod"},
                ],
                fixed={"layer_count": 1, "fg_type": "ROLL", "roll_form": "FLAT", "print_capable": False, "pod_master": True},
                sizes=[("POD-220", "POD roll 220mm", 220, 0, 0, 220), ("POD-260", "POD roll 260mm", 260, 0, 0, 260)],
            ),
        }
        materials["INNER_INHOUSE"].packaging_defaults_json = {
            **(materials["INNER_INHOUSE"].packaging_defaults_json or {}),
            "production_product_master_id": str(masters["inner_packaging"].id),
            "production_product_master_code": masters["inner_packaging"].code,
            "production_axis_values": {
                "size": "INNER-100X120",
                "layer_thicknesses": {"1": 50},
                "layer_widths": {"1": 220},
                "layer_grades": {"1": grade.name},
                "packaging_ref": materials["INNER_INHOUSE"].code,
            },
        }
        materials["INNER_INHOUSE"].save(update_fields=["packaging_defaults_json"])
        pod_220.production_defaults_json = {
            "production_product_master_id": str(masters["pod_film"].id),
            "production_product_master_code": masters["pod_film"].code,
            "production_axis_values": {"size": "POD-220", "layer_thicknesses": {"1": 30}, "layer_widths": {"1": 220}, "layer_grades": {"1": grade.name}, "pod_ref": pod_220.code},
        }
        pod_220.save(update_fields=["production_defaults_json"])
        pod_260.production_defaults_json = {
            "production_product_master_id": str(masters["pod_film"].id),
            "production_product_master_code": masters["pod_film"].code,
            "production_axis_values": {"size": "POD-260", "layer_thicknesses": {"1": 30}, "layer_widths": {"1": 260}, "layer_grades": {"1": grade.name}, "pod_ref": pod_260.code},
        }
        pod_260.save(update_fields=["production_defaults_json"])
        self.report["samples"]["product_masters"] = {key: str(value.id) for key, value in masters.items()}
        return masters

    def _master(self, *, code, name, template, family, layer_template, axes, fixed, sizes, product_kind="POUCH"):
        master, _ = ProductMaster.objects.update_or_create(
            code=code,
            defaults={
                "name": name,
                "product_kind": product_kind,
                "template": template,
                "default_template": template,
                "commercial_family": family,
                "default_reporting_group": "FG" if product_kind == "POUCH" else product_kind,
                "reusable_policy": "CONFIGURABLE",
                "layer_template": layer_template,
                "canonical_layer_stack": layer_template,
                "variant_axes": axes,
                "fixed_attributes": fixed,
                "description": "Codex seeded Product Master for E2E flow proof.",
                "active": True,
            },
        )
        master.invariant_signature = ""
        master.save()
        for sort_order, row in enumerate(sizes, start=1):
            code_value, label, width, height, gusset, roll_width = row
            ProductMasterSize.objects.update_or_create(
                product_master=master,
                code=code_value,
                defaults={
                    "label": label,
                    "width_mm": Decimal(str(width)),
                    "height_mm": Decimal(str(height)),
                    "gusset_mm": Decimal(str(gusset)),
                    "roll_width_mm": Decimal(str(roll_width)),
                    "qty_uom": "PCS",
                    "geometry_config": {"pouch_style": fixed.get("pouch_style") or "STAND_UP", "multipliers": {"faces": 2}},
                    "active": True,
                    "sort_order": sort_order,
                },
            )
        return master

    def _chem_fixed(self, materials, adhesive_gsm, solvent_gsm):
        adhesive = materials["ADH"]
        solvent = materials["SOL"]
        return {
            "adhesive_material_id": str(adhesive.id),
            "adhesive_material_code": adhesive.code,
            "adhesive_material_name": adhesive.name,
            "adhesive_gsm": float(Decimal(str(adhesive_gsm))),
            "solvent_material_id": str(solvent.id),
            "solvent_material_code": solvent.code,
            "solvent_material_name": solvent.name,
            "solvent_gsm": float(Decimal(str(solvent_gsm))),
        }

    def _axis_values(self, size, roll_width, layer_thicknesses, layer_count, grade=None, *, pod=None, inner=None, outer=None, addons=None):
        axis = {
            "size": size,
            "layer_thicknesses": {str(index): layer_thicknesses[index - 1] for index in range(1, layer_count + 1)},
            "layer_widths": {str(index): roll_width for index in range(1, layer_count + 1)},
            "pod_variant": pod,
            "packaging_inner": inner,
            "packaging_outer": outer,
            "addons": addons or [],
        }
        if grade is not None:
            axis["layer_grades"] = {str(layer_count): grade.name}
        return axis

    def _create_variants(self, masters, grade, materials, pod_220, pod_260):
        specs = {
            "dry_fruit_250": (masters["dry_fruit"], self._axis_values("DF-250-140X200", 330, [12, 20, 65], 3, grade, pod=pod_220.code, inner=materials["INNER_PURCHASED"].code, outer=materials["GUNNY"].code, addons=[materials["ZIP"].code])),
            "mango_1kg": (masters["mango"], self._axis_values("MANGO-1KG-210X260", 580, [12, 12, 80], 3, grade, pod=pod_260.code, inner=materials["INNER_INHOUSE"].code, outer=materials["SHEET"].code)),
            "bopp_220": (masters["bopp_variable"], self._axis_values("BOPP-140X200", 330, [18, 40], 2, grade, pod=pod_220.code, inner=materials["INNER_PURCHASED"].code, outer=materials["GUNNY"].code)),
            "bopp_260": (masters["bopp_variable"], self._axis_values("BOPP-170X250", 420, [25, 50], 2, grade, pod=pod_260.code, inner=materials["INNER_INHOUSE"].code, outer=materials["SHEET"].code)),
            "bopp_1l_18": (masters["bopp_single_layer"], self._axis_values("BOPP-140X200", 330, [18], 1, None)),
            "bopp_1l_25": (masters["bopp_single_layer"], self._axis_values("BOPP-170X250", 420, [25], 1, None)),
            "inner_pack": (masters["inner_packaging"], {"size": "INNER-100X120", "layer_thicknesses": {"1": 50}, "layer_widths": {"1": 220}, "layer_grades": {"1": grade.name}, "packaging_ref": materials["INNER_INHOUSE"].code}),
            "pod_220_product": (masters["pod_film"], {"size": "POD-220", "layer_thicknesses": {"1": 30}, "layer_widths": {"1": 220}, "layer_grades": {"1": grade.name}, "pod_ref": pod_220.code}),
            "pod_260_product": (masters["pod_film"], {"size": "POD-260", "layer_thicknesses": {"1": 30}, "layer_widths": {"1": 260}, "layer_grades": {"1": grade.name}, "pod_ref": pod_260.code}),
        }
        variants = {}
        for key, (master, axis_values) in specs.items():
            variant, _ = find_or_create_product_variant(master, axis_values)
            variants[key] = variant
        self.report["samples"]["product_variants"] = {key: str(value.id) for key, value in variants.items()}
        self.report["samples"]["axis_values"] = {key: axis for key, (_master, axis) in specs.items()}

    def _post_grns(self, owner, vendor, plant, location, materials, pod_220):
        client = APIClient()
        client.force_authenticate(user=owner)
        grns = {}
        payloads = {
            "roll": {
                "klass": "ROLL",
                "vendor_id": str(vendor.id),
                "plant_id": str(plant.id),
                "store_location_id": str(location.id),
                "vendor_invoice_no": "CODEX-ROLL-GRN",
                "lines": [
                    {
                        "material_id": str(materials["PET12"].id),
                        "gross_weight_kg": "52.00",
                        "tare_weight_kg": "2.00",
                        "width_mm": "330",
                        "thickness_micron": "12",
                        "length_m": "4000",
                        "unit_cost": "125",
                        "lot_no": "PET12-CODEX-LOT",
                    },
                    {
                        "material_id": str(materials["BOPP_VAR"].id),
                        "gross_weight_kg": "65.00",
                        "tare_weight_kg": "2.00",
                        "width_mm": "420",
                        "thickness_micron": "25",
                        "length_m": "6000",
                        "unit_cost": "138",
                        "lot_no": "BOPPVAR-CODEX-LOT",
                    },
                ],
            },
            "bulk_addon": {
                "klass": "BULK",
                "vendor_id": str(vendor.id),
                "plant_id": str(plant.id),
                "store_location_id": str(location.id),
                "vendor_invoice_no": "CODEX-ADDON-GRN",
                "lines": [{"material_id": str(materials["ZIP"].id), "qty": "250", "uom": "PCS", "unit_cost": "1.25", "lot_no": "ZIP-CODEX-LOT"}],
            },
            "bulk_granule": {
                "klass": "BULK",
                "vendor_id": str(vendor.id),
                "plant_id": str(plant.id),
                "store_location_id": str(location.id),
                "vendor_invoice_no": "CODEX-GRANULE-GRN",
                "lines": [{"material_id": str(materials["LDPE_GRANULE"].id), "qty": "500", "uom": "KG", "unit_cost": "115", "lot_no": "LDPE-GRANULE-CODEX-LOT"}],
            },
            "pod_220": {
                "klass": "BULK",
                "vendor_id": str(vendor.id),
                "plant_id": str(plant.id),
                "store_location_id": str(location.id),
                "vendor_invoice_no": "CODEX-POD220-GRN",
                "lines": [{"material_id": str(pod_220.material.id), "qty": "25", "uom": "KG", "unit_cost": "180", "lot_no": "POD220-CODEX-LOT"}],
            },
            "packaging": {
                "klass": "PACKAGING",
                "vendor_id": str(vendor.id),
                "plant_id": str(plant.id),
                "store_location_id": str(location.id),
                "vendor_invoice_no": "CODEX-PACK-GRN",
                "lines": [
                    {"material_id": str(materials["INNER_PURCHASED"].id), "qty": "5000", "uom": "PCS", "unit_cost": "0.15", "lot_no": "INNER-CODEX-LOT"},
                    {"material_id": str(materials["GUNNY"].id), "qty": "200", "uom": "PCS", "unit_cost": "18", "lot_no": "GUNNY-CODEX-LOT"},
                    {"material_id": str(materials["TAPE"].id), "qty": "50", "uom": "PCS", "unit_cost": "55", "lot_no": "TAPE-CODEX-LOT"},
                    {"material_id": str(materials["SHEET"].id), "qty": "1000", "uom": "PCS", "unit_cost": "0.75", "lot_no": "SHEET-CODEX-LOT"},
                    {"material_id": str(materials["CARTON"].id), "qty": "300", "uom": "PCS", "unit_cost": "16", "lot_no": "CARTON-CODEX-LOT"},
                ],
            },
        }
        for key, payload in payloads.items():
            response = client.post("/api/inventory/grn/create/", payload, format="json")
            grns[key] = {"status": response.status_code, "data": response.json() if hasattr(response, "json") else response.data}
            self.report["checks"].append({"name": f"grn_{key}", "ok": response.status_code == 201, "status": response.status_code})
        self.report["samples"]["grns"] = grns

    def _create_sales_and_stock_orders(self, owner, plant, masters, materials, pod_220, pod_260):
        customer, _ = Customer.objects.update_or_create(
            code="CODEX-CUST",
            defaults={"name": "Codex Sample Customer", "status": "ACTIVE"},
        )
        artwork_specs = {
            "df_blue_2f": ("CODEX-ART-DF-001", "Codex Dry Fruit Blue Red", "DF-FAMILY-001", "Blue/Red 2F", ["CYAN", "RED"]),
            "df_green_3f": ("CODEX-ART-DF-002", "Codex Dry Fruit Green Yellow Black", "DF-FAMILY-002", "Green/Yellow/Black 3F", ["GREEN", "YELLOW", "BLACK"]),
            "df_blue_alt_color": ("CODEX-ART-DF-001-ALT", "Codex Dry Fruit Blue Yellow", "DF-FAMILY-001", "Blue/Yellow 2F", ["CYAN", "YELLOW"]),
        }
        artworks = {}
        for key, (design_code, name, family_code, colorway_name, colors) in artwork_specs.items():
            artwork, _ = Artwork.objects.update_or_create(
                design_code=design_code,
                defaults={
                    "name": name,
                    "product_master": masters["dry_fruit"],
                    "print_type": "FLEXO",
                    "substrate_mode": "SHEET",
                    "design_family_code": family_code,
                    "colorway_name": colorway_name,
                    "front_colors": colors,
                    "front_colors_count": len(colors),
                    "back_colors": [],
                    "back_colors_count": 0,
                    "color_list": colors,
                    "color_mapping": self._ink_mapping(colors),
                    "colors_count": len(colors),
                    "file_path": f"codex://artwork/{design_code}.pdf",
                    "status": "APPROVED",
                    "approved_by": owner,
                    "approved_at": timezone.now(),
                },
            )
            artworks[key] = artwork
        axis_dry = self.report["samples"]["axis_values"]["dry_fruit_250"]
        axis_bopp_220 = self.report["samples"]["axis_values"]["bopp_220"]
        axis_bopp_260 = self.report["samples"]["axis_values"]["bopp_260"]

        sales_payloads = {
            "direct_sales": {
                "customer": str(customer.id),
                "customer_name": customer.name,
                "order_name": "CODEX direct sample order",
                "items": [{
                    "product_master": str(masters["dry_fruit"].id),
                    "axis_values": axis_dry,
                    "qty_value": "1000",
                    "qty_uom": "PCS",
                    "printing": {"enabled": False},
                    "addons": [{"code": materials["ZIP"].code, "material_code": materials["ZIP"].code}],
                    "unit_price": "3.50",
                    "price_basis": "PCS",
                    "line_name": "Dry fruit 250g no print",
                }],
            },
            "artwork_pending": {
                "customer": str(customer.id),
                "customer_name": customer.name,
                "order_name": "CODEX artwork pending order",
                "items": [{
                    "product_master": str(masters["dry_fruit"].id),
                    "axis_values": axis_dry,
                    "qty_value": "800",
                    "qty_uom": "PCS",
                    "printing": {"enabled": True, "type": "FLEXO", "method": "FLEXO", "substrate_mode": "SHEET", "front_colors_count": 2, "back_colors_count": 0, "ink_gsm_total": 1.2},
                    "addons": [],
                    "unit_price": "3.90",
                    "price_basis": "PCS",
                    "line_name": "Dry fruit 250g artwork gate",
                }],
            },
            "artwork_assigned_2f": {
                "customer": str(customer.id),
                "customer_name": customer.name,
                "order_name": "CODEX artwork assigned 2F order",
                "items": [{
                    "product_master": str(masters["dry_fruit"].id),
                    "axis_values": axis_dry,
                    "qty_value": "600",
                    "qty_uom": "PCS",
                    "printing": {"enabled": True, "type": "FLEXO", "method": "FLEXO", "substrate_mode": "SHEET", "front_colors_count": 2, "back_colors_count": 0, "ink_gsm_total": 1.2, "artwork_id": str(artworks["df_blue_2f"].id)},
                    "addons": [],
                    "unit_price": "4.10",
                    "price_basis": "PCS",
                    "line_name": "Dry fruit 250g approved 2F artwork",
                }],
            },
            "artwork_assigned_3f_other_design": {
                "customer": str(customer.id),
                "customer_name": customer.name,
                "order_name": "CODEX artwork assigned 3F order",
                "items": [{
                    "product_master": str(masters["dry_fruit"].id),
                    "axis_values": axis_dry,
                    "qty_value": "650",
                    "qty_uom": "PCS",
                    "printing": {"enabled": True, "type": "FLEXO", "method": "FLEXO", "substrate_mode": "SHEET", "front_colors_count": 3, "back_colors_count": 0, "ink_gsm_total": 1.6, "artwork_id": str(artworks["df_green_3f"].id)},
                    "addons": [],
                    "unit_price": "4.25",
                    "price_basis": "PCS",
                    "line_name": "Dry fruit 250g approved 3F artwork",
                }],
            },
            "artwork_same_design_alt_colorway": {
                "customer": str(customer.id),
                "customer_name": customer.name,
                "order_name": "CODEX same design alt colorway order",
                "items": [{
                    "product_master": str(masters["dry_fruit"].id),
                    "axis_values": axis_dry,
                    "qty_value": "700",
                    "qty_uom": "PCS",
                    "printing": {"enabled": True, "type": "FLEXO", "method": "FLEXO", "substrate_mode": "SHEET", "front_colors_count": 2, "back_colors_count": 0, "ink_gsm_total": 1.2, "artwork_id": str(artworks["df_blue_alt_color"].id)},
                    "addons": [],
                    "unit_price": "4.15",
                    "price_basis": "PCS",
                    "line_name": "Dry fruit 250g same design family alternate colorway",
                }],
            },
            "pod_220_stock_available": {
                "customer": str(customer.id),
                "customer_name": customer.name,
                "order_name": "CODEX BOPP POD 220 stock available",
                "items": [{
                    "product_master": str(masters["bopp_variable"].id),
                    "axis_values": axis_bopp_220,
                    "qty_value": "500",
                    "qty_uom": "PCS",
                    "printing": {"enabled": False},
                    "unit_price": "2.80",
                    "price_basis": "PCS",
                    "line_name": "BOPP with POD 220",
                }],
            },
            "pod_260_auto_demand": {
                "customer": str(customer.id),
                "customer_name": customer.name,
                "order_name": "CODEX BOPP POD 260 auto demand",
                "items": [{
                    "product_master": str(masters["bopp_variable"].id),
                    "axis_values": axis_bopp_260,
                    "qty_value": "900",
                    "qty_uom": "PCS",
                    "printing": {"enabled": False},
                    "unit_price": "3.20",
                    "price_basis": "PCS",
                    "line_name": "BOPP with POD 260 and in-house inner pack",
                }],
            },
            "bopp_single_layer_no_grade": {
                "customer": str(customer.id),
                "customer_name": customer.name,
                "order_name": "CODEX BOPP single layer no grade",
                "items": [{
                    "product_master": str(masters["bopp_single_layer"].id),
                    "axis_values": self.report["samples"]["axis_values"]["bopp_1l_25"],
                    "qty_value": "400",
                    "qty_uom": "PCS",
                    "printing": {"enabled": False},
                    "unit_price": "1.70",
                    "price_basis": "PCS",
                    "line_name": "Single layer BOPP 25u no grade selection",
                }],
            },
        }
        orders = {}
        for key, payload in sales_payloads.items():
            order = SalesOrderService.create_sales_order(payload)
            confirmed = SalesOrderService.confirm_sales_order(order.id)
            orders[key] = {
                "order_id": str(confirmed.id),
                "order_number": confirmed.order_number,
                "status": confirmed.status,
                "items": [
                    {
                        "item_id": str(item.id),
                        "artwork_required": item.artwork_assignment_required,
                        "total_weight_kg": float(item.total_weight_kg or 0),
                        "bom_lines": len((item.bom_snapshot or {}).get("planning_lines") or []),
                    }
                    for item in confirmed.items.all()
                ],
            }
        self.report["samples"]["sales_orders"] = orders
        self.report["samples"]["artworks"] = {key: str(value.id) for key, value in artworks.items()}

        client = APIClient()
        client.force_authenticate(user=owner)
        stock_payloads = {
            "generic_wip_roll": {
                "launcher_mode": "GENERIC",
                "product_master": str(masters["dry_fruit"].id),
                "template_id": str(masters["dry_fruit"].template_id),
                "axis_values": axis_dry,
                "quantity": "120",
                "quantity_uom": "KG",
                "start_step_index": 0,
                "stop_step_index": 0,
                "commitment_scope": "GENERIC",
                "preferred_plant_id": str(plant.id),
                "printing": {"enabled": False},
                "addons": [{"code": materials["ZIP"].code, "material_code": materials["ZIP"].code}],
            },
            "artwork_committed_wip": {
                "launcher_mode": "ARTWORK",
                "product_master": str(masters["dry_fruit"].id),
                "template_id": str(masters["dry_fruit"].template_id),
                "axis_values": axis_dry,
                "quantity": "80",
                "quantity_uom": "KG",
                "start_step_index": 0,
                "stop_step_index": 1,
                "commitment_scope": "ARTWORK",
                "committed_artwork": str(artworks["df_blue_2f"].id),
                "preferred_plant_id": str(plant.id),
                "printing": {"enabled": True, "type": "FLEXO", "method": "FLEXO", "substrate_mode": "SHEET", "front_colors_count": 2, "back_colors_count": 0, "ink_gsm_total": 1.2},
                "addons": [],
            },
            "customer_committed_wip": {
                "launcher_mode": "CUSTOMER",
                "product_master": str(masters["dry_fruit"].id),
                "template_id": str(masters["dry_fruit"].template_id),
                "axis_values": axis_dry,
                "quantity": "60",
                "quantity_uom": "KG",
                "start_step_index": 0,
                "stop_step_index": 0,
                "commitment_scope": "CUSTOMER",
                "committed_customer": str(customer.id),
                "preferred_plant_id": str(plant.id),
                "printing": {"enabled": False},
                "addons": [],
            },
            "customer_artwork_committed_wip": {
                "launcher_mode": "CUSTOMER_ARTWORK",
                "product_master": str(masters["dry_fruit"].id),
                "template_id": str(masters["dry_fruit"].template_id),
                "axis_values": axis_dry,
                "quantity": "45",
                "quantity_uom": "KG",
                "start_step_index": 0,
                "stop_step_index": 1,
                "commitment_scope": "CUSTOMER_ARTWORK",
                "committed_customer": str(customer.id),
                "committed_artwork": str(artworks["df_blue_alt_color"].id),
                "preferred_plant_id": str(plant.id),
                "printing": {"enabled": True, "type": "FLEXO", "method": "FLEXO", "substrate_mode": "SHEET", "front_colors_count": 2, "back_colors_count": 0, "ink_gsm_total": 1.2},
                "addons": [],
            },
            "packaging_stock": {
                "launcher_mode": "PACKAGING",
                "stock_purpose": "PACKAGING",
                "product_master": str(masters["inner_packaging"].id),
                "template_id": str(masters["inner_packaging"].template_id),
                "packaging_material": str(materials["INNER_INHOUSE"].id),
                "axis_values": self.report["samples"]["axis_values"]["inner_pack"],
                "quantity": "1000",
                "quantity_uom": "PCS",
                "start_step_index": 0,
                "stop_step_index": 4,
                "commitment_scope": "GENERIC",
                "preferred_plant_id": str(plant.id),
                "printing": {"enabled": False},
                "addons": [],
            },
            "pod_stock": {
                "launcher_mode": "POD_STOCK",
                "stock_purpose": "POD",
                "product_master": str(masters["pod_film"].id),
                "template_id": str(masters["pod_film"].template_id),
                "pod_sku_variant": str(pod_260.id),
                "axis_values": self.report["samples"]["axis_values"]["pod_260_product"],
                "quantity": "30",
                "quantity_uom": "KG",
                "start_step_index": 0,
                "stop_step_index": 0,
                "commitment_scope": "GENERIC",
                "preferred_plant_id": str(plant.id),
                "printing": {"enabled": False},
                "addons": [],
            },
        }
        stock_results = {}
        for key, payload in stock_payloads.items():
            validate = client.post("/api/production/planner/stock-pools/validate/", payload, format="json")
            create = client.post("/api/production/planner/create-stock-order/", payload, format="json")
            stock_results[key] = {
                "validate_status": validate.status_code,
                "validate": validate.json() if hasattr(validate, "json") else validate.data,
                "create_status": create.status_code,
                "create": create.json() if hasattr(create, "json") else create.data,
            }
            self.report["checks"].append({"name": f"stock_launcher_{key}", "ok": validate.status_code == 200 and create.status_code == 201, "validate_status": validate.status_code, "create_status": create.status_code})
        self.report["samples"]["stock_launcher"] = stock_results

        demand_scope = SalesOrderItemInHouseDemand.objects.filter(
            sales_order_item__sales_order__order_name__startswith="CODEX",
        )
        pod_demands = demand_scope.filter(demand_kind="POD").select_related("packaging_material", "planned_bulk_stock_order")
        packaging_demands = demand_scope.filter(demand_kind="PACKAGING").select_related("packaging_material", "planned_stock_order")
        self.report["samples"]["in_house_demands"] = {
            "pod": [
                {
                    "material_code": demand.packaging_material.code,
                    "target_qty": float(demand.target_qty),
                    "planned_bulk_order": str(demand.planned_bulk_stock_order_id or ""),
                }
                for demand in pod_demands
            ],
            "packaging": [
                {
                    "material_code": demand.packaging_material.code,
                    "target_qty": float(demand.target_qty),
                    "planned_stock_order": str(demand.planned_stock_order_id or ""),
                }
                for demand in packaging_demands
            ],
        }

    def _snapshot_counts(self):
        self.report["samples"]["db_counts"] = {
            "product_masters_codex": ProductMaster.objects.filter(code__startswith="PM-CODEX").count(),
            "stock_orders_codex": PlannedStockOrder.objects.filter(product_master__code__startswith="PM-CODEX").count(),
            "bulk_stock_orders_codex": PlannedBulkStockOrder.objects.filter(planner_origin_meta__product_master_id__isnull=False).count(),
            "sales_orders_codex": SalesOrder.objects.filter(order_name__startswith="CODEX").count(),
        }
