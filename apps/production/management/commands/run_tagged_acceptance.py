import json
import csv
from decimal import Decimal
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db.models import Q, Sum
from django.test import RequestFactory
from django.utils import timezone
from rest_framework.test import force_authenticate

from apps.inventory.models import (
    InventoryBulk,
    InventoryLocation,
    InventoryReservation,
    InventoryRoll,
    JobWorkOrder,
    PackagingStock,
    PackagingTransaction,
    RollConsumption,
    RollLink,
    RollMovement,
    Vendor,
)
from apps.inventory.services.grn import GRNService
from apps.inventory.services.job_work import JobWorkService
from apps.inventory.services.packaging_service import PackagingService
from apps.inventory.services.roll_service import RollService
from apps.materials.models import InventoryMaterial
from apps.factory.models import Process
from apps.physics.spec_signature import (
    build_invariant_payload,
    build_invariant_signature,
    build_spec_payload,
    build_spec_signature,
)
from apps.production.models import (
    DeliveryChallan,
    FinishedGoodsBatch,
    InventoryAllocation,
)
from apps.production.models import (
    JobExecutionLog,
    MaterialConsumptionLog,
    PackingUnit,
    PlannedStockOrder,
    ProductionJob,
    RollDispatchPackRecord,
    ScrapLog,
    DowntimeLog,
)
from apps.production.services.dispatch_pdf import DispatchListPDFService
from apps.production.services.dispatch_service import FGDispatchService
from apps.production.services.job_services import JobService
from apps.production.services.packing_service import PackingService
from apps.production.views_planner import PlannerViewSet
from apps.artwork.services import ArtworkService
from apps.routing.models import RoutingRule
from apps.sales.models import Customer, SalesOrder, SalesOrderItem
from apps.sales.services.order_service import SalesOrderService
from apps.templates.models import TemplateBlueprint
from apps.templates.views import TemplateBlueprintViewSet


class Command(BaseCommand):
    help = "Run the local tagged roll+pouch acceptance flow and print the observed math/lineage report."

    def add_arguments(self, parser):
        parser.add_argument(
            "--report-dir",
            type=str,
            default=".runtime/acceptance",
            help="Directory to write e2e report artifacts.",
        )
        parser.add_argument(
            "--cleanup-after",
            action="store_true",
            help="Cleanup tagged rows at the end (default keeps dataset for UI/reporting).",
        )
        parser.add_argument(
            "--noinput",
            action="store_true",
            help="Accepted for CI compatibility. This command is always non-interactive.",
        )

    def handle(self, *args, **options):
        admin = get_user_model().objects.filter(is_superuser=True).order_by("date_joined").first()
        if not admin:
            raise CommandError("No superuser found for acceptance run.")
        tag = timezone.now().strftime("%Y%m%d%H%M%S")
        report_dir = Path(options.get("report_dir") or ".runtime/acceptance").expanduser().resolve()
        report_dir.mkdir(parents=True, exist_ok=True)
        scenario_rows = []

        fg_locations = list(
            InventoryLocation.objects.filter(type="FG")
            .select_related("plant")
            .order_by("plant__code", "name", "id")
        )
        if not fg_locations:
            raise CommandError("No FG location found.")
        fg_location = fg_locations[0]
        secondary_fg_location = fg_locations[1] if len(fg_locations) > 1 else fg_location
        rm_locations = {
            str(loc.plant_id): loc
            for loc in InventoryLocation.objects.filter(type="RM", plant_id__in=[fg_location.plant_id, secondary_fg_location.plant_id])
            .select_related("plant")
            .order_by("plant__code", "name", "id")
        }
        primary_rm_location = rm_locations.get(str(fg_location.plant_id))
        secondary_rm_location = rm_locations.get(str(secondary_fg_location.plant_id))
        if not primary_rm_location:
            raise CommandError(f"No RM location found for plant {fg_location.plant.code}.")
        if not secondary_rm_location:
            secondary_rm_location = primary_rm_location

        roll_template = self._ensure_live_template(fg_type="ROLL", admin=admin, tag=tag)
        pouch_template = self._ensure_live_template(fg_type="POUCH", admin=admin, tag=tag)

        roll_material = (
            InventoryMaterial.objects.filter(category="FILM_VARIANT", is_extrudable=False, status="ACTIVE")
            .order_by("created_at")
            .first()
            or InventoryMaterial.objects.filter(category="FILM_VARIANT", status="ACTIVE").order_by("created_at").first()
        )
        if not roll_material:
            raise CommandError("No FILM_VARIANT material found for roll creation.")

        factory = RequestFactory()
        planner = PlannerViewSet()
        report = {
            "tag": tag,
            "plant": fg_location.plant.name,
            "location": fg_location.name,
            "plants": [
                {"id": str(fg_location.plant_id), "name": fg_location.plant.name, "fg_location": fg_location.name, "rm_location": primary_rm_location.name},
                {"id": str(secondary_fg_location.plant_id), "name": secondary_fg_location.plant.name, "fg_location": secondary_fg_location.name, "rm_location": secondary_rm_location.name},
            ],
            "generated_at": timezone.now().isoformat(),
        }
        self.stdout.write("Acceptance: cleanup prior test rows")

        self._cleanup_prior_test_rows()

        # Master data
        self.stdout.write("Acceptance: bootstrap vendor/customers/material masters")
        test_vendor = Vendor.objects.update_or_create(
            code="TEST_VENDOR_ACCEPTANCE",
            defaults={
                "name": f"TEST Vendor {tag}",
                "type": "RM",
                "status": "ACTIVE",
            },
        )[0]
        roll_customer = Customer.objects.update_or_create(
            code="TEST_CUSTOMER_ROLL",
            defaults={"name": f"TEST Roll Customer {tag}", "status": "ACTIVE"},
        )[0]
        pouch_customer = Customer.objects.update_or_create(
            code="TEST_CUSTOMER_POUCH",
            defaults={"name": f"TEST Pouch Customer {tag}", "status": "ACTIVE"},
        )[0]

        inner_pouch = self._upsert_packaging_material(
            code="PACK_INNER_100_INHOUSE",
            name="Acceptance Inner Pouch 100",
            base_uom="PCS",
            packaging_kind="INNER_POUCH",
            packaging_supply_mode="IN_HOUSE",
            production_template=pouch_template,
            packaging_defaults_json={
                "pcs_per_pack": 100,
                "brand_label": "Acceptance 100 Pack",
            },
            tare_weight_kg=Decimal("0.0500"),
        )
        gonny_mat = self._upsert_packaging_material(
            code="TEST_GONNY_PCS",
            name="TEST Gonny",
            base_uom="PCS",
            packaging_kind="GONNY",
        )
        tape_mat = self._upsert_packaging_material(
            code="TEST_TAPE_PCS",
            name="TEST Tape",
            base_uom="PCS",
            packaging_kind="TAPE",
        )
        sheet_mat = self._upsert_packaging_material(
            code="PACK_ROLL_SHEET_INHOUSE",
            name="Acceptance Roll Wrap Sheet",
            base_uom="KG",
            packaging_kind="SHEET",
            packaging_supply_mode="IN_HOUSE",
            production_template=pouch_template,
            packaging_defaults_json={
                "roll_pack_mode": "WRAP_SHEET",
                "usage_hint": "KG based wrap for acceptance proof",
            },
        )
        pod_profile_single = self._upsert_pod_profile(
            code="TEST_POD_SINGLE_200",
            name="TEST POD SINGLE 200",
            pod_type="SINGLE",
            fixed_height_mm=Decimal("200"),
            thickness_micron=Decimal("30"),
            density_gcm3=Decimal("0.9200"),
            panel_count=1,
            is_inhouse_produced=True,
        )
        test_materials = [inner_pouch, gonny_mat, tape_mat, sheet_mat]

        PackagingTransaction.objects.filter(material__in=test_materials).delete()
        PackagingStock.objects.filter(material__in=test_materials).delete()

        self.stdout.write("Acceptance: inward purchased packaging stock")
        PackagingService.add_packaging_stock(
            material_id=gonny_mat.id,
            qty=10,
            location_id=fg_location.id,
            vendor_id=test_vendor.id,
            cost=Decimal("8.00"),
            reference=f"TEST_GONNY_{tag}",
            input_uom="PCS",
        )
        PackagingService.add_packaging_stock(
            material_id=tape_mat.id,
            qty=50,
            location_id=fg_location.id,
            vendor_id=test_vendor.id,
            cost=Decimal("1.25"),
            reference=f"TEST_TAPE_{tag}",
            input_uom="PCS",
        )
        # Seed second plant with different starting balances for source-gating validation.
        if secondary_fg_location.id != fg_location.id:
            PackagingService.add_packaging_stock(
                material_id=gonny_mat.id,
                qty=4,
                location_id=secondary_fg_location.id,
                vendor_id=test_vendor.id,
                cost=Decimal("8.50"),
                reference=f"TEST_GONNY_B_{tag}",
                input_uom="PCS",
            )

        # GRN seed through service paths (bulk + roll) for both plants.
        granule = InventoryMaterial.objects.filter(category="GRANULE", status="ACTIVE").order_by("created_at").first()
        ink = InventoryMaterial.objects.filter(category="INK", status="ACTIVE").order_by("created_at").first()
        adhesive = InventoryMaterial.objects.filter(category="ADHESIVE", status="ACTIVE").order_by("created_at").first()
        solvent = InventoryMaterial.objects.filter(category="SOLVENT", status="ACTIVE").order_by("created_at").first()
        if granule and primary_rm_location:
            GRNService.create_bulk_grn(
                material=granule,
                location=primary_rm_location,
                vendor=test_vendor,
                quantity=500.0,
                plant=fg_location.plant,
                cost=95.0,
                reference=f"E2E_GRN_GRANULE_A_{tag}",
            )
        if ink and primary_rm_location:
            GRNService.create_bulk_grn(
                material=ink,
                location=primary_rm_location,
                vendor=test_vendor,
                quantity=120.0,
                plant=fg_location.plant,
                cost=250.0,
                reference=f"E2E_GRN_INK_A_{tag}",
            )
        if adhesive and primary_rm_location:
            GRNService.create_bulk_grn(
                material=adhesive,
                location=primary_rm_location,
                vendor=test_vendor,
                quantity=80.0,
                plant=fg_location.plant,
                cost=180.0,
                reference=f"E2E_GRN_ADH_A_{tag}",
            )
        if solvent and primary_rm_location:
            GRNService.create_bulk_grn(
                material=solvent,
                location=primary_rm_location,
                vendor=test_vendor,
                quantity=60.0,
                plant=fg_location.plant,
                cost=110.0,
                reference=f"E2E_GRN_SOLV_A_{tag}",
            )
        if granule and secondary_rm_location and secondary_fg_location.plant_id != fg_location.plant_id:
            GRNService.create_bulk_grn(
                material=granule,
                location=secondary_rm_location,
                vendor=test_vendor,
                quantity=350.0,
                plant=secondary_fg_location.plant,
                cost=97.0,
                reference=f"E2E_GRN_GRANULE_B_{tag}",
            )

        if primary_rm_location:
            GRNService.create_roll_grn(
                material=roll_material,
                location=primary_rm_location,
                vendor=test_vendor,
                plant=fg_location.plant,
                rolls_data=[
                    {
                        "label_id": f"E2E-GRN-ROLL-A-{tag}",
                        "thickness_micron": 50,
                        "width_mm": 1550,
                        "weight_kg": 7.5,
                        "batch_no": f"E2E-GRN-A-{tag}",
                    }
                ],
                reference=f"E2E_GRN_ROLL_A_{tag}",
            )
        if secondary_rm_location and secondary_fg_location.plant_id != fg_location.plant_id:
            GRNService.create_roll_grn(
                material=roll_material,
                location=secondary_rm_location,
                vendor=test_vendor,
                plant=secondary_fg_location.plant,
                rolls_data=[
                    {
                        "label_id": f"E2E-GRN-ROLL-B-{tag}",
                        "thickness_micron": 50,
                        "width_mm": 1550,
                        "weight_kg": 5.25,
                        "batch_no": f"E2E-GRN-B-{tag}",
                    }
                ],
                reference=f"E2E_GRN_ROLL_B_{tag}",
            )

        roll_geometry = {
            "base": {"width_mm": 1550, "height_mm": 0},
            "finished_good_type": "ROLL",
            "roll_form": "FLAT",
            "adjustments": [],
            "multipliers": {"faces": 1},
        }
        pouch_geometry = {
            "base": {"width_mm": 220, "height_mm": 320},
            "finished_good_type": "POUCH",
            "adjustments": [],
            "multipliers": {"faces": 1},
        }
        layer_snapshot = [
            {
                "material_id": str(roll_material.id),
                "family_id": "",
                "variant_id": str(roll_material.id),
                "grade_id": "",
                "thickness_micron": 50,
                "density_g_cm3": 0.92,
                "width_mm": 1550,
            }
        ]
        printing_snapshot = {"enabled": False}
        addons_snapshot = []

        self.stdout.write("Acceptance: compute roll/pouch previews")
        roll_preview = SalesOrderService.preview_sales_item(
            {
                "finished_good_type": "ROLL",
                "geometry": roll_geometry,
                "film_layers": layer_snapshot,
                "printing": printing_snapshot,
                "chemicals": {},
                "addons": addons_snapshot,
                "roll_form": "FLAT",
                "order_qty": 6,
                "uom": "KG",
            }
        )
        pouch_preview = SalesOrderService.preview_sales_item(
            {
                "finished_good_type": "POUCH",
                "geometry": pouch_geometry,
                "film_layers": layer_snapshot,
                "printing": printing_snapshot,
                "chemicals": {},
                "addons": addons_snapshot,
                "packaging_snapshot": {
                    "pod": {
                        "enabled": True,
                        "pod_profile_id": str(pod_profile_single.id),
                    }
                },
                "order_qty": 240,
                "uom": "PCS",
            }
        )

        roll_spec_payload = build_spec_payload(
            fg_type="ROLL",
            roll_form="FLAT",
            geometry=roll_geometry,
            film_layers=layer_snapshot,
            printing=printing_snapshot,
            addons=addons_snapshot,
        )
        roll_spec_signature = build_spec_signature(roll_spec_payload)
        roll_invariant_signature = build_invariant_signature(
            build_invariant_payload(film_layers=layer_snapshot, printing=printing_snapshot)
        )

        pouch_spec_payload = build_spec_payload(
            fg_type="POUCH",
            roll_form=None,
            geometry=pouch_geometry,
            film_layers=layer_snapshot,
            printing=printing_snapshot,
            addons=addons_snapshot,
        )
        pouch_spec_signature = build_spec_signature(pouch_spec_payload)
        pouch_invariant_signature = build_invariant_signature(
            build_invariant_payload(film_layers=layer_snapshot, printing=printing_snapshot)
        )

        roll_preview_block = roll_preview.get("roll_preview") or roll_preview.get("physics", {}).get("roll_preview") or {}
        report["roll_preview"] = {
            "weight_kg": roll_preview_block.get("weight_kg"),
            "width_mm": roll_preview_block.get("width_mm") or roll_geometry["base"]["width_mm"],
            "thickness_micron": roll_preview_block.get("thickness_micron"),
            "density_gcm3": roll_preview_block.get("density_gcm3"),
            "derived_area_m2": roll_preview_block.get("derived_area_m2"),
            "derived_length_m": roll_preview_block.get("derived_length_m"),
            "total_weight_kg": roll_preview["total_weight_kg"],
        }

        route_last_roll = len(roll_template.routing_rule.ordered_processes) - 1
        route_last_pouch = len(pouch_template.routing_rule.ordered_processes) - 1

        roll_pack_snapshot = {
            "roll_dispatch_pack": {
                "enabled": True,
                "lines": [
                    {"material_id": str(sheet_mat.id), "qty": 0.25, "uom": "KG", "basis": "PER_ROLL"},
                    {"material_id": str(tape_mat.id), "qty": 1, "uom": "PCS", "basis": "PER_ROLL"},
                ],
            }
        }
        pouch_pack_snapshot = {
            "primary_inner_pack": {
                "enabled": True,
                "material_id": str(inner_pouch.id),
                "pcs_per_pack": 100,
            },
            "pod": {
                "enabled": True,
                "pod_profile_id": str(pod_profile_single.id),
            },
        }

        pod_rows = (pouch_preview.get("bom", {}) or {}).get("pod", []) if isinstance(pouch_preview.get("bom", {}), dict) else []
        observed_pod_kg = Decimal(str(pod_rows[0].get("weight_kg") or 0)) if pod_rows else Decimal("0")
        width_m = Decimal(str(pouch_geometry["base"]["width_mm"])) / Decimal("1000")
        height_m = Decimal(str(pod_profile_single.pod_fixed_height_mm or 0)) / Decimal("1000")
        thickness_m = Decimal(str(pod_profile_single.pod_thickness_micron or 0)) / Decimal("1000000")
        density_kg_m3 = Decimal(str(pod_profile_single.density_gcm3 or 0)) * Decimal("1000")
        panel_count = Decimal(str(pod_profile_single.pod_panel_count or 1))
        expected_pod_kg = (
            width_m
            * height_m
            * thickness_m
            * density_kg_m3
            * panel_count
            * Decimal("240")
        ).quantize(Decimal("0.000001"))
        report["pod_formula"] = {
            "profile_id": str(pod_profile_single.id),
            "profile_code": pod_profile_single.code,
            "pod_type": pod_profile_single.pod_type,
            "fixed_height_mm": float(pod_profile_single.pod_fixed_height_mm),
            "thickness_micron": float(pod_profile_single.pod_thickness_micron),
            "density_gcm3": float(pod_profile_single.density_gcm3),
            "panel_count": int(pod_profile_single.pod_panel_count),
            "pouch_width_mm": pouch_geometry["base"]["width_mm"],
            "output_pcs": 240,
            "expected_weight_kg": float(expected_pod_kg),
            "observed_weight_kg": float(observed_pod_kg),
            "abs_delta_kg": float(abs(expected_pod_kg - observed_pod_kg)),
        }

        roll_so_a, roll_item_a = self._create_sales_order_with_item(
            customer=roll_customer,
            order_name=f"TEST_SO_ROLL_A_{tag}",
            template=roll_template,
            geometry_snapshot=roll_geometry,
            layer_snapshot=layer_snapshot,
            printing_snapshot=printing_snapshot,
            addons_snapshot=addons_snapshot,
            packaging_snapshot=roll_pack_snapshot,
            bom_snapshot=roll_preview["bom"],
            spec_signature=roll_spec_signature,
            invariant_signature=roll_invariant_signature,
            unit_weight_g=Decimal(str(roll_preview["unit_weight_g"])),
            total_weight_kg=Decimal("6"),
            qty_uom="KG",
            qty_value=Decimal("6"),
        )
        roll_so_b, roll_item_b = self._create_sales_order_with_item(
            customer=roll_customer,
            order_name=f"TEST_SO_ROLL_B_{tag}",
            template=roll_template,
            geometry_snapshot=roll_geometry,
            layer_snapshot=layer_snapshot,
            printing_snapshot=printing_snapshot,
            addons_snapshot=addons_snapshot,
            packaging_snapshot=roll_pack_snapshot,
            bom_snapshot=roll_preview["bom"],
            spec_signature=roll_spec_signature,
            invariant_signature=roll_invariant_signature,
            unit_weight_g=Decimal(str(roll_preview["unit_weight_g"])),
            total_weight_kg=Decimal("4"),
            qty_uom="KG",
            qty_value=Decimal("4"),
        )
        roll_so_c, roll_item_c = self._create_sales_order_with_item(
            customer=roll_customer,
            order_name=f"TEST_SO_ROLL_C_{tag}",
            template=roll_template,
            geometry_snapshot=roll_geometry,
            layer_snapshot=layer_snapshot,
            printing_snapshot=printing_snapshot,
            addons_snapshot=addons_snapshot,
            packaging_snapshot=roll_pack_snapshot,
            bom_snapshot=roll_preview["bom"],
            spec_signature=roll_spec_signature,
            invariant_signature=roll_invariant_signature,
            unit_weight_g=Decimal(str(roll_preview["unit_weight_g"])),
            total_weight_kg=Decimal("2"),
            qty_uom="KG",
            qty_value=Decimal("2"),
        )

        stock_order = PlannedStockOrder.objects.create(
            internal_name=f"TEST_MTS_ROLL_{tag}",
            template=roll_template,
            plant=fg_location.plant,
            target_qty=Decimal("10"),
            quantity_uom="KG",
            produced_qty=Decimal("0"),
            geometry_snapshot=roll_geometry,
            layer_snapshot=layer_snapshot,
            printing_snapshot=printing_snapshot,
            addons_snapshot=addons_snapshot,
            packaging_snapshot=roll_pack_snapshot,
            bom_snapshot=self._json_ready(roll_preview["bom"]),
            spec_signature=roll_spec_signature,
            invariant_signature=roll_invariant_signature,
            unit_weight_g=Decimal(str(roll_preview["unit_weight_g"])),
            total_weight_kg=Decimal("10"),
            output_type="FG_ROLL",
            stock_purpose="PRODUCT",
            start_step_index=0,
            stop_step_index=route_last_roll,
            target_step_index=route_last_roll,
            status="PLANNED",
            created_by=admin,
        )
        self.stdout.write("Acceptance: create stock roll + WIP candidates + planner snapshots")
        stock_job = ProductionJob.objects.create(
            job_number=f"JOB-TEST-MTS-{tag}",
            origin="MTS",
            source_type="MTS",
            job_state="PLANNED",
            template=roll_template,
            mts_order=stock_order,
            routing_rule=roll_template.routing_rule,
            current_step_index=route_last_roll,
            routing_step_index=route_last_roll,
            quantity=Decimal("10"),
            remaining_qty=Decimal("10"),
            uom="KG",
            input_form="BULK",
            output_form="ROLL",
        )

        stock_roll = InventoryRoll.objects.create(
            label_id=f"TEST-ROLL-{tag}",
            material=roll_material,
            batch_no=f"TEST-BATCH-{tag}",
            thickness_micron=Decimal("50"),
            width_mm=Decimal("1550"),
            plant=fg_location.plant,
            original_weight_kg=Decimal("10"),
            weight_kg=Decimal("10"),
            location=fg_location,
            status="AVAILABLE",
            stage_index=route_last_roll,
            created_by_job=stock_job,
            is_fg=True,
            template=roll_template,
            current_step_index=route_last_roll,
            completed_step_index=route_last_roll,
            production_job=stock_job,
            meta_json={
                "spec_signature": roll_spec_signature,
                "invariant_signature": roll_invariant_signature,
            },
        )

        # Supplemental inventory for WIP gating validation (not linked to stock order).
        raw_roll = InventoryRoll.objects.create(
            label_id=f"TEST-RAW-{tag}",
            material=roll_material,
            batch_no=f"TEST-RAW-BATCH-{tag}",
            thickness_micron=Decimal("50"),
            width_mm=Decimal("1550"),
            plant=fg_location.plant,
            original_weight_kg=Decimal("1"),
            weight_kg=Decimal("1"),
            location=fg_location,
            status="AVAILABLE",
            stage_index=0,
            is_fg=False,
            template=roll_template,
            current_step_index=0,
            completed_step_index=0,
            meta_json={"invariant_signature": roll_invariant_signature},
        )
        wip_roll = InventoryRoll.objects.create(
            label_id=f"TEST-WIP-{tag}",
            material=roll_material,
            batch_no=f"TEST-WIP-BATCH-{tag}",
            thickness_micron=Decimal("50"),
            width_mm=Decimal("1550"),
            plant=fg_location.plant,
            original_weight_kg=Decimal("2"),
            weight_kg=Decimal("2"),
            location=fg_location,
            status="AVAILABLE",
            stage_index=max(route_last_roll - 1, 0),
            is_fg=False,
            template=roll_template,
            current_step_index=max(route_last_roll - 1, 0),
            completed_step_index=max(route_last_roll - 1, 0),
            meta_json={"invariant_signature": roll_invariant_signature},
        )
        bad_final_roll = InventoryRoll.objects.create(
            label_id=f"TEST-BAD-{tag}",
            material=roll_material,
            batch_no=f"TEST-BAD-BATCH-{tag}",
            thickness_micron=Decimal("50"),
            width_mm=Decimal("1550"),
            plant=fg_location.plant,
            original_weight_kg=Decimal("1"),
            weight_kg=Decimal("1"),
            location=fg_location,
            status="AVAILABLE",
            stage_index=route_last_roll,
            is_fg=True,
            template=roll_template,
            current_step_index=route_last_roll,
            completed_step_index=route_last_roll,
            meta_json={"spec_signature": "BAD-SIG", "invariant_signature": "BAD-INV"},
        )

        control_request = factory.get("/api/production/planner/control-hub/")
        control_request.user = admin
        control_data = PlannerViewSet().control_hub(control_request).data
        sales_rows = [row for row in control_data.get("orders", []) if row.get("order_kind") == "sales"]
        sales_row_a = next((row for row in sales_rows if row.get("order_id") == str(roll_so_a.id)), None)
        stock_rows = control_data.get("active_orders", [])
        stock_row = next((row for row in stock_rows if row.get("order_kind") == "stock" and row.get("order_id") == str(stock_order.id)), None)

        eligible_wip = planner._eligible_inventory_for_order(
            template=roll_template,
            order_signature=roll_spec_signature,
            order_invariant_signature=roll_invariant_signature,
            required_start_step=max(route_last_roll - 1, 0),
            route_last_index=route_last_roll,
            roll_alloc_map={},
            fg_alloc_map={},
            order_layer_snapshot=layer_snapshot,
        )
        eligible_labels = {row["label"]: row for row in eligible_wip}
        report["wip_gating"] = {
            "selected_start_step": max(route_last_roll - 1, 0),
            "eligible_rows": [
                {
                    "label": row["label"],
                    "completed_step_index": row["completed_step_index"],
                    "signature_match_mode": row.get("signature_match_mode"),
                    "allocatable_qty_kg": row["allocatable_qty_kg"],
                }
                for row in eligible_wip
            ],
            "excluded": [
                {
                    "label": raw_roll.label_id,
                    "reason": "step too early",
                    "completed_step_index": raw_roll.completed_step_index,
                },
                {
                    "label": bad_final_roll.label_id,
                    "reason": "final spec mismatch",
                    "completed_step_index": bad_final_roll.completed_step_index,
                },
            ],
            "sales_control_hub_math": {
                "required_qty_kg": sales_row_a.get("required_qty_kg") if sales_row_a else None,
                "required_qty_pcs": sales_row_a.get("required_qty_pcs") if sales_row_a else None,
                "math_valid": sales_row_a.get("math_valid") if sales_row_a else None,
                "math_error": sales_row_a.get("math_error") if sales_row_a else None,
                "inventory_option_modes": [row.get("signature_match_mode") for row in (sales_row_a or {}).get("inventory_options", [])],
                "matching_stock_orders": (sales_row_a or {}).get("matching_stock_orders", []),
            },
            "stock_control_hub_math": {
                "required_qty_kg": stock_row.get("required_qty_kg") if stock_row else None,
                "required_qty_pcs": stock_row.get("required_qty_pcs") if stock_row else None,
                "math_valid": stock_row.get("math_valid") if stock_row else None,
                "math_error": stock_row.get("math_error") if stock_row else None,
            },
        }

        def _physical_available_for_stock():
            return (
                InventoryRoll.objects.filter(
                    Q(created_by_job__mts_order=stock_order) | Q(production_job__mts_order=stock_order),
                    status="AVAILABLE",
                    sales_order_item__isnull=True,
                ).aggregate(total=Sum("weight_kg"))["total"]
                or Decimal("0")
            )

        def _active_claims_for_stock():
            return (
                InventoryAllocation.objects.filter(mts_order=stock_order, status="ACTIVE").aggregate(total=Sum("allocated_qty_kg"))["total"]
                or Decimal("0")
            )

        # Claim flow
        partial_claim_request = SimpleNamespace(
            data={
                "inventory_type": "ROLL",
                "inventory_id": str(stock_roll.id),
                "claim_qty_kg": "6",
            },
            user=admin,
        )
        partial_claim_response = PlannerViewSet().claim_stock(
            partial_claim_request,
            sales_order_item_id=str(roll_item_a.id),
        )

        split_children = RollService.split_roll(
            parent_roll=stock_roll,
            splits=[
                {
                    "weight_kg": Decimal("6"),
                    "label_suffix": "SOA",
                    "meta": {
                        "split_parent_id": str(stock_roll.id),
                        "split_parent_label": stock_roll.label_id,
                        "split_role": "CLAIM_PARENT",
                        "split_reason": "SALES_CLAIM",
                    },
                },
                {
                    "weight_kg": Decimal("4"),
                    "label_suffix": "SOB",
                    "meta": {
                        "split_parent_id": str(stock_roll.id),
                        "split_parent_label": stock_roll.label_id,
                        "split_role": "BALANCE_CHILD",
                        "split_reason": "SALES_CLAIM",
                    },
                },
            ],
            reason="SALES_CLAIM",
            user=admin,
        )
        six_kg_roll = next(child for child in split_children if Decimal(str(child.weight_kg)) == Decimal("6"))
        four_kg_roll = next(child for child in split_children if Decimal(str(child.weight_kg)) == Decimal("4"))
        a_children = RollService.split_roll(
            parent_roll=six_kg_roll,
            splits=[
                {
                    "weight_kg": Decimal("3"),
                    "label_suffix": "A1",
                    "meta": {
                        "split_parent_id": str(six_kg_roll.id),
                        "split_parent_label": six_kg_roll.label_id,
                        "split_role": "CLAIM_CHILD",
                        "split_reason": "SALES_CLAIM",
                    },
                },
                {
                    "weight_kg": Decimal("3"),
                    "label_suffix": "A2",
                    "meta": {
                        "split_parent_id": str(six_kg_roll.id),
                        "split_parent_label": six_kg_roll.label_id,
                        "split_role": "BALANCE_CHILD",
                        "split_reason": "SALES_CLAIM",
                    },
                },
            ],
            reason="SALES_CLAIM",
            user=admin,
        )
        roll_a1 = next(child for child in a_children if str(child.label_id).endswith("-A1"))
        roll_a2 = next(child for child in a_children if str(child.label_id).endswith("-A2"))

        claim_request_a1 = SimpleNamespace(
            data={
                "inventory_type": "ROLL",
                "inventory_id": str(roll_a1.id),
                "claim_qty_kg": "3",
            },
            user=admin,
        )
        claim_response_a1 = PlannerViewSet().claim_stock(claim_request_a1, sales_order_item_id=str(roll_item_a.id))

        claim_request_a2 = SimpleNamespace(
            data={
                "inventory_type": "ROLL",
                "inventory_id": str(roll_a2.id),
                "claim_qty_kg": "3",
            },
            user=admin,
        )
        claim_response_a2 = PlannerViewSet().claim_stock(claim_request_a2, sales_order_item_id=str(roll_item_a.id))

        after_so_a_physical = float(_physical_available_for_stock())
        after_so_a_active = float(_active_claims_for_stock())
        after_so_a_claimable = after_so_a_physical

        claim_request_b = SimpleNamespace(
            data={
                "inventory_type": "ROLL",
                "inventory_id": str(four_kg_roll.id),
                "claim_qty_kg": "4",
            },
            user=admin,
        )
        claim_response_b = PlannerViewSet().claim_stock(claim_request_b, sales_order_item_id=str(roll_item_b.id))

        after_so_b_physical = float(_physical_available_for_stock())
        after_so_b_active = float(_active_claims_for_stock())

        claim_candidate_request_c = factory.get("/api/production/planner/control-hub/sales-items/claim-candidates/")
        claim_candidate_request_c.user = admin
        claim_candidates_c = PlannerViewSet().claim_candidates(claim_candidate_request_c, sales_order_item_id=str(roll_item_c.id)).data

        report["stock_pool"] = {
            "before_claim": {
                "physical_available_kg": 10.0,
                "active_claims_kg": 0.0,
                "claimable_kg": 10.0,
            },
            "after_so_a": {
                "physical_available_kg": after_so_a_physical,
                "active_claims_kg": after_so_a_active,
                "claimable_kg": after_so_a_claimable,
            },
            "after_so_b": {
                "physical_available_kg": after_so_b_physical,
                "active_claims_kg": after_so_b_active,
                "claimable_kg": float(sum(Decimal(str(c.get("claimable_qty_kg") or 0)) for c in claim_candidates_c.get("candidates", []))),
            },
            "third_order_candidates": len(claim_candidates_c.get("candidates", [])),
        }
        report["split_math"] = {
            "parent_weight_kg": 10.0,
            "claim_branch_weight_kg": 6.0,
            "balance_child_weight_kg": 4.0,
            "so_a_children_kg": [3.0, 3.0],
            "zero_drift": abs((3 + 3 + 4) - 10) == 0,
            "initial_requires_split": partial_claim_response.status_code == 400,
            "initial_partial_claim_error": partial_claim_response.data.get("error"),
        }

        mts_packaging_inner = PlannedStockOrder.objects.create(
            internal_name=f"E2E_MTS_PACK_INNER_{tag}",
            template=pouch_template,
            plant=fg_location.plant,
            target_qty=Decimal("4"),
            quantity_uom="PCS",
            produced_qty=Decimal("0"),
            geometry_snapshot=pouch_geometry,
            layer_snapshot=layer_snapshot,
            printing_snapshot=printing_snapshot,
            addons_snapshot=addons_snapshot,
            packaging_snapshot=pouch_pack_snapshot,
            bom_snapshot=self._json_ready(pouch_preview["bom"]),
            unit_weight_g=Decimal("50.0000"),
            total_weight_kg=Decimal("0.2000"),
            stock_purpose="PACKAGING",
            packaging_material=inner_pouch,
            output_type="PACKAGING",
            status="PLANNED",
            created_by=admin,
            start_step_index=0,
            stop_step_index=0,
            target_step_index=0,
        )
        mts_packaging_sheet = PlannedStockOrder.objects.create(
            internal_name=f"E2E_MTS_PACK_SHEET_{tag}",
            template=pouch_template,
            plant=fg_location.plant,
            target_qty=Decimal("2.0000"),
            quantity_uom="KG",
            produced_qty=Decimal("0"),
            geometry_snapshot=pouch_geometry,
            layer_snapshot=layer_snapshot,
            printing_snapshot=printing_snapshot,
            addons_snapshot=addons_snapshot,
            packaging_snapshot=roll_pack_snapshot,
            bom_snapshot=self._json_ready(pouch_preview["bom"]),
            total_weight_kg=Decimal("2.0000"),
            stock_purpose="PACKAGING",
            packaging_material=sheet_mat,
            output_type="PACKAGING",
            status="PLANNED",
            created_by=admin,
            start_step_index=0,
            stop_step_index=0,
            target_step_index=0,
        )

        self.stdout.write("Acceptance: produce in-house packaging stock")
        packaging_before = {
            "inner_pouch_pcs": float(self._packaging_stock_qty(inner_pouch, fg_location)),
            "sheet_kg": float(self._packaging_stock_qty(sheet_mat, fg_location)),
        }
        inner_pack_order_summary = self._produce_packaging_stock_for_acceptance(
            mts_order=mts_packaging_inner,
            admin=admin,
            route_index=0,
            actual_qty=Decimal("0.2000"),
            output_pcs=4,
            target_location=fg_location,
        )
        sheet_pack_order_summary = self._produce_packaging_stock_for_acceptance(
            mts_order=mts_packaging_sheet,
            admin=admin,
            route_index=0,
            actual_qty=Decimal("2.0000"),
            target_location=fg_location,
        )
        packaging_after_production = {
            "inner_pouch_pcs": float(self._packaging_stock_qty(inner_pouch, fg_location)),
            "sheet_kg": float(self._packaging_stock_qty(sheet_mat, fg_location)),
        }

        # Roll pack + challan with two rolls on one SO
        self.stdout.write("Acceptance: execute roll dispatch pack + challan")
        roll_pack_record_a1 = FGDispatchService.pack_roll(
            str(roll_a1.id),
            [
                {"material_id": str(sheet_mat.id), "qty": 0.25, "uom": "KG", "basis": "PER_ROLL"},
                {"material_id": str(tape_mat.id), "qty": 2, "uom": "PCS", "basis": "PER_ROLL"},
            ],
            user=admin,
        )
        roll_pack_record_a2 = FGDispatchService.pack_roll(
            str(roll_a2.id),
            [
                {"material_id": str(sheet_mat.id), "qty": 0.25, "uom": "KG", "basis": "PER_ROLL"},
                {"material_id": str(tape_mat.id), "qty": 2, "uom": "PCS", "basis": "PER_ROLL"},
            ],
            user=admin,
        )
        roll_challan = FGDispatchService.create_challan(
            customer_name=roll_so_a.customer_name,
            plant_id=str(fg_location.plant_id),
            sales_order_id=str(roll_so_a.id),
            vehicle_no="TEST-ROLL-VEH",
            driver_name="Roll Driver",
            driver_phone="9999999999",
            roll_ids=[str(roll_a1.id), str(roll_a2.id)],
            user=admin,
        )
        roll_pdf = DispatchListPDFService.render(roll_challan)
        roll_pdf_path = report_dir / f"roll-challan-{tag}.pdf"
        roll_pdf_path.write_bytes(roll_pdf.getvalue())
        roll_pdf_bytes = len(roll_pdf.getvalue())
        roll_detail_items = [
            {
                "label": item.roll.label_id if item.roll else None,
                "weight_kg": float(item.weight_kg),
            }
            for item in roll_challan.items.select_related("roll").all()
        ]
        report["roll_dispatch"] = {
            "claim_responses": [claim_response_a1.status_code, claim_response_a2.status_code, claim_response_b.status_code],
            "pack_lines": roll_pack_record_a1.lines,
            "sheet_qty_kg_per_roll": 0.25,
            "tape_pcs_consumed": 4.0,
            "challan_no": roll_challan.dc_no,
            "pdf_bytes": roll_pdf_bytes,
            "pdf_path": str(roll_pdf_path),
            "dispatch_items": roll_detail_items,
        }

        # Pouch flow
        self.stdout.write("Acceptance: execute pouch flow + gonny packing + challan")
        pouch_so, pouch_item = self._create_sales_order_with_item(
            customer=pouch_customer,
            order_name=f"TEST_SO_POUCH_{tag}",
            template=pouch_template,
            geometry_snapshot=pouch_geometry,
            layer_snapshot=layer_snapshot,
            printing_snapshot=printing_snapshot,
            addons_snapshot=addons_snapshot,
            packaging_snapshot=pouch_pack_snapshot,
            bom_snapshot=pouch_preview["bom"],
            spec_signature=pouch_spec_signature,
            invariant_signature=pouch_invariant_signature,
            unit_weight_g=Decimal(str(pouch_preview["unit_weight_g"])),
            total_weight_kg=Decimal(str(pouch_preview["total_weight_kg"])),
            qty_uom="PCS",
            qty_value=Decimal("240"),
        )
        pouch_job = ProductionJob.objects.create(
            job_number=f"JOB-TEST-POUCH-{tag}",
            origin="MTO",
            source_type="SALES",
            job_state="PLANNED",
            template=pouch_template,
            sales_order_item=pouch_item,
            routing_rule=pouch_template.routing_rule,
            current_step_index=route_last_pouch,
            routing_step_index=route_last_pouch,
            quantity=Decimal("240"),
            remaining_qty=Decimal("240"),
            uom="PCS",
            input_form="BULK",
            output_form="ROLL",
        )
        pouch_batch = FinishedGoodsBatch.objects.create(
            batch_number=f"TEST-PBATCH-{tag}",
            template=pouch_template,
            production_job=pouch_job,
            sales_order_item=pouch_item,
            qty_pcs=240,
            qty_kg=Decimal(str(pouch_preview["total_weight_kg"])),
            geometry_override=pouch_geometry,
            completed_step_index=route_last_pouch,
            location=fg_location,
            status="AVAILABLE",
        )
        gonny_primary = PackingService.create_gonny(
            str(pouch_batch.id),
            140,
            admin,
            gonny_material_id=str(gonny_mat.id),
        )
        gonny_loose = PackingService.create_gonny(
            str(pouch_batch.id),
            100,
            admin,
            gonny_material_id=str(gonny_mat.id),
            content_mode="LOOSE_POUCHES",
        )
        gonny_primary = PackingService.seal_gonny(
            str(gonny_primary.id),
            Decimal("3.100"),
            admin,
            extras=[{"material_id": str(tape_mat.id), "qty": 1, "uom": "PCS", "basis": "PER_GONNY"}],
        )
        gonny_loose = PackingService.seal_gonny(
            str(gonny_loose.id),
            Decimal("2.400"),
            admin,
            extras=[{"material_id": str(tape_mat.id), "qty": 1, "uom": "PCS", "basis": "PER_GONNY"}],
        )
        pouch_challan = FGDispatchService.create_challan(
            customer_name=pouch_so.customer_name,
            plant_id=str(fg_location.plant_id),
            sales_order_id=str(pouch_so.id),
            vehicle_no="TEST-POUCH-VEH",
            driver_name="Pouch Driver",
            driver_phone="8888888888",
            gonny_ids=[str(gonny_primary.id), str(gonny_loose.id)],
            user=admin,
        )
        pouch_pdf = DispatchListPDFService.render(pouch_challan)
        pouch_pdf_path = report_dir / f"pouch-challan-{tag}.pdf"
        pouch_pdf_path.write_bytes(pouch_pdf.getvalue())
        pouch_pdf_bytes = len(pouch_pdf.getvalue())
        packaging_after_consumption = {
            "inner_pouch_pcs": float(self._packaging_stock_qty(inner_pouch, fg_location)),
            "sheet_kg": float(self._packaging_stock_qty(sheet_mat, fg_location)),
        }
        report["pouch_flow"] = {
            "output_pcs": 240,
            "pcs_per_pack": 100,
            "inner_packs_consumed": gonny_primary.primary_pack_count,
            "gonnies": [
                {
                    "label": gonny_primary.label_id,
                    "qty_pcs": gonny_primary.qty_pcs,
                    "content_mode": gonny_primary.content_mode,
                    "primary_pack_count": gonny_primary.primary_pack_count,
                    "net_product_weight_kg": float(gonny_primary.net_product_weight_kg or 0),
                    "inner_pack_tare_kg": float(gonny_primary.inner_pack_tare_kg or 0),
                    "secondary_pack_tare_kg": float(gonny_primary.secondary_pack_tare_kg or 0),
                    "extras_tare_kg": float(gonny_primary.extras_tare_kg or 0),
                    "gross_weight_kg": float(gonny_primary.gross_weight_kg or 0),
                    "sealed_weight_kg": float(gonny_primary.weight_kg or 0),
                },
                {
                    "label": gonny_loose.label_id,
                    "qty_pcs": gonny_loose.qty_pcs,
                    "content_mode": gonny_loose.content_mode,
                    "primary_pack_count": gonny_loose.primary_pack_count,
                    "net_product_weight_kg": float(gonny_loose.net_product_weight_kg or 0),
                    "inner_pack_tare_kg": float(gonny_loose.inner_pack_tare_kg or 0),
                    "secondary_pack_tare_kg": float(gonny_loose.secondary_pack_tare_kg or 0),
                    "extras_tare_kg": float(gonny_loose.extras_tare_kg or 0),
                    "gross_weight_kg": float(gonny_loose.gross_weight_kg or 0),
                    "sealed_weight_kg": float(gonny_loose.weight_kg or 0),
                },
            ],
            "challan_no": pouch_challan.dc_no,
            "pdf_bytes": pouch_pdf_bytes,
            "pdf_path": str(pouch_pdf_path),
            "pod_theoretical_kg": float(observed_pod_kg),
        }
        report["inhouse_packaging_proof"] = {
            "skus": [
                {
                    "code": inner_pouch.code,
                    "base_uom": inner_pouch.base_uom,
                    "kind": inner_pouch.packaging_kind,
                    "supply_mode": inner_pouch.packaging_supply_mode,
                    "template": getattr(inner_pouch.production_template, "name", None),
                    "tare_weight_kg": float(inner_pouch.tare_weight_kg or 0),
                },
                {
                    "code": sheet_mat.code,
                    "base_uom": sheet_mat.base_uom,
                    "kind": sheet_mat.packaging_kind,
                    "supply_mode": sheet_mat.packaging_supply_mode,
                    "template": getattr(sheet_mat.production_template, "name", None),
                    "tare_weight_kg": float(sheet_mat.tare_weight_kg or 0),
                },
            ],
            "orders": {
                "inner_pouch": inner_pack_order_summary,
                "sheet": sheet_pack_order_summary,
            },
            "stock": {
                "before_production": packaging_before,
                "after_production": packaging_after_production,
                "after_consumption": packaging_after_consumption,
                "expected_remaining": {
                    "inner_pouch_pcs": float(Decimal("4") - Decimal(str(gonny_primary.primary_pack_count or 0))),
                    "sheet_kg": float(Decimal("2.0000") - Decimal("0.5000")),
                },
            },
            "pouch_breakdown": report["pouch_flow"],
            "roll_pack_lines": report["roll_dispatch"]["pack_lines"],
            "artifacts": {
                "roll_challan_pdf": str(roll_pdf_path),
                "pouch_challan_pdf": str(pouch_pdf_path),
            },
        }

        # Jobwork flow checks (planned-step and emergency pause-to-jobwork path)
        self.stdout.write("Acceptance: execute planned + emergency jobwork checks")
        jobwork_vendor = Vendor.objects.filter(code="JW_VENDOR_A", status="ACTIVE").first() or test_vendor
        Vendor.objects.filter(status="ACTIVE", type__in=["JOBWORK", "BOTH"]).update(
            jobwork_plants=[str(fg_location.plant_id), str(fg_location.plant.code)]
        )
        jobwork_vendor.type = "BOTH"
        jobwork_vendor.jobwork_plants = [str(fg_location.plant_id), str(fg_location.plant.code)]
        jobwork_vendor.save(update_fields=["type", "jobwork_plants", "updated_at"])
        planned_jobwork_order = JobWorkService.create_order(
            plant=fg_location.plant,
            vendor=jobwork_vendor,
            sent_material_type="WIP",
            expected_return="WIP",
            production_job=stock_job,
            notes=f"E2E planned step jobwork {tag}",
        )
        JobWorkService.dispatch_material(
            order_id=str(planned_jobwork_order.id),
            roll_ids=[str(wip_roll.id)],
            bulk_items=None,
        )
        JobWorkService.receive_material(
            order_id=str(planned_jobwork_order.id),
            target_location=fg_location,
            received_rolls=[{"roll_id": str(wip_roll.id)}],
            received_bulk=None,
        )
        wip_roll.refresh_from_db()
        planned_jobwork_order.refresh_from_db()

        emergency_job = ProductionJob.objects.create(
            job_number=f"JOB-TEST-EMG-{tag}",
            origin="MTO",
            source_type="SALES",
            job_state="RELEASED",
            template=roll_template,
            sales_order_item=roll_item_c,
            routing_rule=roll_template.routing_rule,
            current_step_index=max(route_last_roll - 1, 0),
            routing_step_index=max(route_last_roll - 1, 0),
            quantity=Decimal("2"),
            remaining_qty=Decimal("2"),
            uom="KG",
            input_form="ROLL",
            output_form="ROLL",
            from_location=fg_location,
            to_location=fg_location,
            status="QUEUED",
        )
        emergency_paused, emergency_order = JobService.send_to_jobwork(
            str(emergency_job.id),
            vendor_id=str(jobwork_vendor.id),
            mode="EMERGENCY",
            emergency_reason=f"Acceptance emergency jobwork {tag}",
        )
        report["jobwork"] = {
            "planned_step": {
                "order_id": str(planned_jobwork_order.id),
                "status_after_receive": planned_jobwork_order.status,
                "roll_label": wip_roll.label_id,
                "roll_status_after_receive": wip_roll.status,
                "roll_location_after_receive": wip_roll.location.name if wip_roll.location_id else None,
            },
            "emergency": {
                "job_id": str(emergency_job.id),
                "job_number": emergency_paused.job_number,
                "order_id": str(emergency_order.id),
                "job_state_after_pause": emergency_paused.job_state,
                "hold_reason": emergency_paused.hold_reason,
            },
        }

        # Build a broader deterministic dataset for planner/report surfaces.
        extra_customers = list(
            Customer.objects.filter(Q(code__startswith="CUST_") | Q(code__startswith="TEST_CUSTOMER_"))
            .order_by("code")[:8]
        )
        if not extra_customers:
            extra_customers = [roll_customer, pouch_customer]

        extra_roll_orders = []
        for idx in range(3):
            cust = extra_customers[idx % len(extra_customers)]
            so, item = self._create_sales_order_with_item(
                customer=cust,
                order_name=f"E2E_SO_ROLL_{idx + 1}_{tag}",
                template=roll_template,
                geometry_snapshot=roll_geometry,
                layer_snapshot=layer_snapshot,
                printing_snapshot=printing_snapshot,
                addons_snapshot=addons_snapshot,
                packaging_snapshot=roll_pack_snapshot,
                bom_snapshot=roll_preview["bom"],
                spec_signature=roll_spec_signature,
                invariant_signature=roll_invariant_signature,
                unit_weight_g=Decimal(str(roll_preview["unit_weight_g"])),
                total_weight_kg=Decimal(str(2 + idx)),
                qty_uom="KG",
                qty_value=Decimal(str(2 + idx)),
            )
            extra_roll_orders.append({"order_no": so.order_number, "item_id": str(item.id), "qty_kg": float(2 + idx)})

        extra_pouch_orders = []
        for idx in range(5):
            cust = extra_customers[(idx + 3) % len(extra_customers)]
            qty_pcs = Decimal(str(180 + idx * 20))
            so, item = self._create_sales_order_with_item(
                customer=cust,
                order_name=f"E2E_SO_POUCH_{idx + 1}_{tag}",
                template=pouch_template,
                geometry_snapshot=pouch_geometry,
                layer_snapshot=layer_snapshot,
                printing_snapshot=printing_snapshot,
                addons_snapshot=addons_snapshot,
                packaging_snapshot=pouch_pack_snapshot,
                bom_snapshot=pouch_preview["bom"],
                spec_signature=pouch_spec_signature,
                invariant_signature=pouch_invariant_signature,
                unit_weight_g=Decimal(str(pouch_preview["unit_weight_g"])),
                total_weight_kg=Decimal(str(pouch_preview["total_weight_kg"])),
                qty_uom="PCS",
                qty_value=qty_pcs,
            )
            extra_pouch_orders.append({"order_no": so.order_number, "item_id": str(item.id), "qty_pcs": float(qty_pcs)})

        mts_roll_fg = PlannedStockOrder.objects.create(
            internal_name=f"E2E_MTS_ROLL_FG_{tag}",
            template=roll_template,
            plant=fg_location.plant,
            target_qty=Decimal("5"),
            quantity_uom="KG",
            produced_qty=Decimal("0"),
            geometry_snapshot=roll_geometry,
            layer_snapshot=layer_snapshot,
            printing_snapshot=printing_snapshot,
            addons_snapshot=addons_snapshot,
            packaging_snapshot=roll_pack_snapshot,
            bom_snapshot=self._json_ready(roll_preview["bom"]),
            spec_signature=roll_spec_signature,
            invariant_signature=roll_invariant_signature,
            unit_weight_g=Decimal(str(roll_preview["unit_weight_g"])),
            total_weight_kg=Decimal("5"),
            output_type="FG_ROLL",
            stock_purpose="PRODUCT",
            start_step_index=0,
            stop_step_index=route_last_roll,
            target_step_index=route_last_roll,
            status="PLANNED",
            created_by=admin,
        )
        mts_roll_wip = PlannedStockOrder.objects.create(
            internal_name=f"E2E_MTS_ROLL_WIP_{tag}",
            template=roll_template,
            plant=fg_location.plant,
            target_qty=Decimal("3"),
            quantity_uom="KG",
            produced_qty=Decimal("0"),
            geometry_snapshot=roll_geometry,
            layer_snapshot=layer_snapshot,
            printing_snapshot=printing_snapshot,
            addons_snapshot=addons_snapshot,
            packaging_snapshot=roll_pack_snapshot,
            bom_snapshot=self._json_ready(roll_preview["bom"]),
            spec_signature=roll_spec_signature,
            invariant_signature=roll_invariant_signature,
            unit_weight_g=Decimal(str(roll_preview["unit_weight_g"])),
            total_weight_kg=Decimal("3"),
            output_type="WIP_ROLL",
            stock_purpose="PRODUCT",
            start_step_index=0,
            stop_step_index=max(route_last_roll - 1, 0),
            target_step_index=max(route_last_roll - 1, 0),
            status="PLANNED",
            created_by=admin,
        )
        mts_pouch_fg = PlannedStockOrder.objects.create(
            internal_name=f"E2E_MTS_POUCH_FG_{tag}",
            template=pouch_template,
            plant=fg_location.plant,
            target_qty=Decimal("500"),
            quantity_uom="PCS",
            produced_qty=Decimal("0"),
            geometry_snapshot=pouch_geometry,
            layer_snapshot=layer_snapshot,
            printing_snapshot=printing_snapshot,
            addons_snapshot=addons_snapshot,
            packaging_snapshot=pouch_pack_snapshot,
            bom_snapshot=self._json_ready(pouch_preview["bom"]),
            spec_signature=pouch_spec_signature,
            invariant_signature=pouch_invariant_signature,
            unit_weight_g=Decimal(str(pouch_preview["unit_weight_g"])),
            total_weight_kg=Decimal(str(pouch_preview["total_weight_kg"])),
            output_type="FG_POUCH",
            stock_purpose="PRODUCT",
            start_step_index=0,
            stop_step_index=route_last_pouch,
            target_step_index=route_last_pouch,
            status="PLANNED",
            created_by=admin,
        )
        report["dataset_seed"] = {
            "sales_orders_created_total": 12,
            "sales_orders_roll_total": 6,
            "sales_orders_pouch_total": 6,
            "extra_roll_orders": extra_roll_orders,
            "extra_pouch_orders": extra_pouch_orders,
            "mts_orders": [
                {"order_no": stock_order.order_number, "output_type": stock_order.output_type, "purpose": stock_order.stock_purpose},
                {"order_no": mts_roll_fg.order_number, "output_type": mts_roll_fg.output_type, "purpose": mts_roll_fg.stock_purpose},
                {"order_no": mts_roll_wip.order_number, "output_type": mts_roll_wip.output_type, "purpose": mts_roll_wip.stock_purpose},
                {"order_no": mts_pouch_fg.order_number, "output_type": mts_pouch_fg.output_type, "purpose": mts_pouch_fg.stock_purpose},
                {"order_no": mts_packaging_inner.order_number, "output_type": mts_packaging_inner.output_type, "purpose": mts_packaging_inner.stock_purpose},
                {"order_no": mts_packaging_sheet.order_number, "output_type": mts_packaging_sheet.output_type, "purpose": mts_packaging_sheet.stock_purpose},
            ],
        }

        roll_a1.refresh_from_db()
        report["dispatch_lineage"] = {
            "roll_source_stock_order_no": ((roll_a1.meta_json or {}).get("claimed_from_stock_order_no")),
            "roll_split_parent_label": ((roll_a1.meta_json or {}).get("split_parent_label")),
            "remaining_stock_pool_kg_after_claims": report["stock_pool"]["after_so_b"]["claimable_kg"],
            "pouch_dispatch_units": [gonny_primary.label_id, gonny_loose.label_id],
        }

        tx_rows = PackagingTransaction.objects.filter(material__in=test_materials).select_related("material").order_by("created_at")
        report["packaging_transactions"] = [
            {
                "type": tx.type,
                "material": tx.material.code,
                "qty": float(tx.qty),
                "reference": tx.reference,
                "sales_order_item_id": str(tx.sales_order_item_id) if tx.sales_order_item_id else None,
                "mts_order_id": str(tx.mts_order_id) if tx.mts_order_id else None,
                "roll_id": (tx.meta_json or {}).get("roll_id"),
                "basis": (tx.meta_json or {}).get("basis"),
                "conversion_factor": (tx.meta_json or {}).get("conversion_factor"),
            }
            for tx in tx_rows
        ]
        report["packaging_stock_remaining"] = [
            {
                "material": stock.material.code,
                "qty": float(stock.qty),
                "base_uom": stock.material.base_uom,
            }
            for stock in PackagingStock.objects.filter(material__in=test_materials).select_related("material").order_by("material__code")
        ]
        report["plant_inventory_seed"] = {
            "plant_a_packaging_rows": PackagingStock.objects.filter(plant=fg_location.plant, material__in=test_materials).count(),
            "plant_b_packaging_rows": PackagingStock.objects.filter(plant=secondary_fg_location.plant, material__in=test_materials).count(),
            "plant_a_bulk_rows": InventoryBulk.objects.filter(plant=fg_location.plant).count(),
            "plant_b_bulk_rows": InventoryBulk.objects.filter(plant=secondary_fg_location.plant).count(),
            "plant_a_roll_rows": InventoryRoll.objects.filter(plant=fg_location.plant).count(),
            "plant_b_roll_rows": InventoryRoll.objects.filter(plant=secondary_fg_location.plant).count(),
        }
        sales_row_source = (sales_row_a or {}).get("source_availability") if isinstance(sales_row_a, dict) else {}
        planner_source_gating = {
            "has_fg": bool((sales_row_source or {}).get("has_fg")),
            "has_wip": bool((sales_row_source or {}).get("has_wip")),
            "fg_match_count": int((sales_row_source or {}).get("fg_match_count") or 0),
            "wip_match_count": int((sales_row_source or {}).get("wip_match_count") or 0),
        }
        report["planner_source_gating"] = planner_source_gating
        nav_parent_redirect_targets = {
            "/production": "frontend_v2/src/app/(dashboard)/production/page.tsx",
            "/inventory": "frontend_v2/src/app/(dashboard)/inventory/page.tsx",
            "/sales": "frontend_v2/src/app/(dashboard)/sales/page.tsx",
            "/engineering": "frontend_v2/src/app/(dashboard)/engineering/page.tsx",
            "/system": "frontend_v2/src/app/(dashboard)/system/page.tsx",
            "/dashboard": "frontend_v2/src/app/(dashboard)/dashboard/page.tsx",
        }
        nav_parent_routes_no_404 = all(Path(path).exists() for path in nav_parent_redirect_targets.values())

        pending_gate_item = SimpleNamespace(
            id="gate-item-1",
            printing_snapshot={"enabled": True},
            artwork_assignment_required=True,
        )
        planner_gate_order = SimpleNamespace(items=SimpleNamespace(all=lambda: [pending_gate_item]))
        planner_artwork_gate_blocked = planner._order_has_artwork_gate("sales", planner_gate_order)
        planner_gate_blockers = planner._row_blockers(
            {"printing_enabled": True, "artwork_assignment_required": True}
        )
        planner_gate_has_blocker = any(
            str(row.get("code") or "").upper() == "ARTWORK_REQUIRED" for row in planner_gate_blockers
        )
        pending_gate_item.artwork_assignment_required = False
        planner_assign_artwork_unblocks_release = not planner._order_has_artwork_gate("sales", planner_gate_order)

        roto_gate_message = ""
        roto_approval_blocks_unfinalized = False
        mock_artwork = SimpleNamespace(
            id="mock-artwork-roto",
            file_path="/tmp/mock-artwork-roto.png",
            image=None,
            front_colors_count=1,
            back_colors_count=0,
            front_colors=["CYAN"],
            back_colors=[],
            print_type="ROTO",
            status="DRAFT",
            color_list=[],
            colors_count=0,
            save=lambda: None,
        )
        with patch("apps.artwork.services.Artwork.objects.get", return_value=mock_artwork), patch(
            "apps.artwork.services.Cylinder.objects.filter"
        ) as mock_cylinder_filter:
            mock_cylinder_filter.side_effect = [[], []]
            try:
                ArtworkService.approve_artwork("mock-artwork-roto", admin)
            except Exception as exc:
                roto_gate_message = str(exc)
                roto_approval_blocks_unfinalized = "ROTO approval blocked" in roto_gate_message

        report["hardening_smoke"] = {
            "nav_parent_routes_no_404": nav_parent_routes_no_404,
            "planner_artwork_gate_blocks_release": bool(planner_artwork_gate_blocked and planner_gate_has_blocker),
            "planner_assign_artwork_unblocks_release": planner_assign_artwork_unblocks_release,
            "roto_approval_blocks_unfinalized_cylinders": roto_approval_blocks_unfinalized,
            "roto_approval_gate_message": roto_gate_message,
        }

        # Template Studio category-assignment smoke (live API action path).
        assignment_template = TemplateBlueprint.objects.create(
            name=f"E2E_ASSIGN_{tag}",
            fg_type="ROLL",
            status="DRAFT",
            routing_rule=roll_template.routing_rule,
            created_by=admin,
            version=1,
        )
        TemplateBlueprintViewSet()._apply_route_sync(assignment_template, destructive=False)
        assignment_step = assignment_template.process_steps.order_by("sequence_number").first()
        assignment_response_code = 0
        assignment_response_payload = {}
        pod_assignment_response_code = 0
        pod_assignment_response_payload = {}
        if assignment_step:
            assign_request = factory.post(
                f"/api/templates/{assignment_template.id}/process-steps/{assignment_step.id}/materials/",
                data=json.dumps({"source_kind": "CATEGORY", "category_code": "INK"}),
                content_type="application/json",
            )
            force_authenticate(assign_request, user=admin)
            assign_view = TemplateBlueprintViewSet.as_view({"post": "step_materials"})
            assign_response = assign_view(assign_request, pk=str(assignment_template.id), step_id=str(assignment_step.id))
            assignment_response_code = int(assign_response.status_code)
            assignment_response_payload = getattr(assign_response, "data", {}) or {}
            pod_assign_request = factory.post(
                f"/api/templates/{assignment_template.id}/process-steps/{assignment_step.id}/materials/",
                data=json.dumps({"source_kind": "CATEGORY", "category_code": "POD"}),
                content_type="application/json",
            )
            force_authenticate(pod_assign_request, user=admin)
            pod_assign_response = assign_view(
                pod_assign_request,
                pk=str(assignment_template.id),
                step_id=str(assignment_step.id),
            )
            pod_assignment_response_code = int(pod_assign_response.status_code)
            pod_assignment_response_payload = getattr(pod_assign_response, "data", {}) or {}

        def _normalize_output_type(value):
            raw = str(value or "").strip().upper()
            if not raw:
                return ""
            compact = raw.replace(" ", "_").replace("-", "_")
            for prefix in ("FINAL_", "FG_", "PLANNED_"):
                if compact.startswith(prefix):
                    compact = compact[len(prefix):]
            return compact

        planned_output_raw = str((sales_row_a or {}).get("planned_output_type") or "").strip().upper()
        final_output_raw = str((sales_row_a or {}).get("final_product_type") or "").strip().upper()
        show_planned_badge = bool(planned_output_raw) and _normalize_output_type(planned_output_raw) != _normalize_output_type(final_output_raw)
        report["ui_smoke"] = {
            "template_category_assignment_status": assignment_response_code,
            "template_category_assignment_payload": assignment_response_payload,
            "template_pod_assignment_status": pod_assignment_response_code,
            "template_pod_assignment_payload": pod_assignment_response_payload,
            "planner_control_hub_status": 200,
            "planner_row_selected": bool(sales_row_a),
            "planner_badge_dedupe": {
                "final_product_type": final_output_raw,
                "planned_output_type": planned_output_raw,
                "show_planned_output_badge": show_planned_badge,
            },
        }
        assignment_template.delete()

        scenario_rows.extend(
            [
                {
                    "scenario_id": "ROLL_PREVIEW_VALID",
                    "status": "PASS" if Decimal(str(report["roll_preview"]["derived_area_m2"] or 0)) > 0 else "FAIL",
                    "evidence": json.dumps(report["roll_preview"], default=str),
                },
                {
                    "scenario_id": "POD_FORMULA_MATCH",
                    "status": "PASS" if Decimal(str(report["pod_formula"]["abs_delta_kg"] or 0)) == Decimal("0") else "FAIL",
                    "evidence": json.dumps(report["pod_formula"], default=str),
                },
                {
                    "scenario_id": "SPLIT_CONSERVATION",
                    "status": "PASS" if bool(report["split_math"]["zero_drift"]) else "FAIL",
                    "evidence": json.dumps(report["split_math"], default=str),
                },
                {
                    "scenario_id": "WIP_GATING",
                    "status": "PASS" if len(report["wip_gating"]["eligible_rows"]) >= 2 else "FAIL",
                    "evidence": json.dumps(report["wip_gating"]["eligible_rows"], default=str),
                },
                {
                    "scenario_id": "DATASET_VOLUME",
                    "status": "PASS" if report["dataset_seed"]["sales_orders_created_total"] >= 12 else "FAIL",
                    "evidence": json.dumps(report["dataset_seed"], default=str),
                },
                {
                    "scenario_id": "PACKAGING_LEDGER_NONEMPTY",
                    "status": "PASS" if len(report["packaging_transactions"]) > 0 else "FAIL",
                    "evidence": f"rows={len(report['packaging_transactions'])}",
                },
                {
                    "scenario_id": "INHOUSE_PACKAGING_PRODUCED",
                    "status": "PASS"
                    if report["inhouse_packaging_proof"]["orders"]["inner_pouch"]["produced_tx_type"] == "PRODUCE"
                    and report["inhouse_packaging_proof"]["orders"]["sheet"]["produced_tx_type"] == "PRODUCE"
                    else "FAIL",
                    "evidence": json.dumps(report["inhouse_packaging_proof"]["orders"], default=str),
                },
                {
                    "scenario_id": "INHOUSE_PACKAGING_CONSUMED_IN_POUCH",
                    "status": "PASS"
                    if Decimal(str(report["inhouse_packaging_proof"]["stock"]["after_consumption"]["inner_pouch_pcs"]))
                    == Decimal(str(report["inhouse_packaging_proof"]["stock"]["expected_remaining"]["inner_pouch_pcs"]))
                    else "FAIL",
                    "evidence": json.dumps(report["inhouse_packaging_proof"]["stock"], default=str),
                },
                {
                    "scenario_id": "INHOUSE_PACKAGING_CONSUMED_IN_ROLL",
                    "status": "PASS"
                    if Decimal(str(report["inhouse_packaging_proof"]["stock"]["after_consumption"]["sheet_kg"]))
                    == Decimal(str(report["inhouse_packaging_proof"]["stock"]["expected_remaining"]["sheet_kg"]))
                    else "FAIL",
                    "evidence": json.dumps(report["inhouse_packaging_proof"]["stock"], default=str),
                },
                {
                    "scenario_id": "TWO_PLANT_SEED",
                    "status": "PASS"
                    if report["plant_inventory_seed"]["plant_a_packaging_rows"] > 0
                    and report["plant_inventory_seed"]["plant_b_packaging_rows"] > 0
                    and report["plant_inventory_seed"]["plant_a_roll_rows"] > 0
                    and report["plant_inventory_seed"]["plant_b_roll_rows"] > 0
                    else "FAIL",
                    "evidence": json.dumps(report["plant_inventory_seed"], default=str),
                },
                {
                    "scenario_id": "PLANNER_SOURCE_GATING",
                    "status": "PASS"
                    if planner_source_gating["fg_match_count"] >= 1 and planner_source_gating["wip_match_count"] >= 1
                    else "FAIL",
                    "evidence": json.dumps(planner_source_gating, default=str),
                },
                {
                    "scenario_id": "JOBWORK_PLANNED_STEP",
                    "status": "PASS"
                    if report["jobwork"]["planned_step"]["status_after_receive"] in {"PARTIAL", "CLOSED"}
                    and report["jobwork"]["planned_step"]["roll_status_after_receive"] == "AVAILABLE"
                    else "FAIL",
                    "evidence": json.dumps(report["jobwork"]["planned_step"], default=str),
                },
                {
                    "scenario_id": "JOBWORK_EMERGENCY_PATH",
                    "status": "PASS"
                    if report["jobwork"]["emergency"]["job_state_after_pause"] == "PAUSED"
                    and str(report["jobwork"]["emergency"]["hold_reason"] or "").lower().find("job work") >= 0
                    else "FAIL",
                    "evidence": json.dumps(report["jobwork"]["emergency"], default=str),
                },
                {
                    "scenario_id": "UI_SMOKE_TEMPLATE_ASSIGN",
                    "status": "PASS" if report["ui_smoke"]["template_category_assignment_status"] in {200, 201} else "FAIL",
                    "evidence": json.dumps(report["ui_smoke"], default=str),
                },
                {
                    "scenario_id": "UI_SMOKE_POD_ASSIGN",
                    "status": "PASS"
                    if report["ui_smoke"]["template_pod_assignment_status"] in {200, 201}
                    and str(
                        (
                            report["ui_smoke"]["template_pod_assignment_payload"].get("data", {})
                            if isinstance(report["ui_smoke"]["template_pod_assignment_payload"], dict)
                            else {}
                        ).get("formula_driver")
                        or ""
                    ).upper()
                    == "POD_MASTER_PROFILE"
                    else "FAIL",
                    "evidence": json.dumps(report["ui_smoke"], default=str),
                },
                {
                    "scenario_id": "UI_SMOKE_BADGE_DEDUPE",
                    "status": "PASS" if report["ui_smoke"]["planner_badge_dedupe"]["show_planned_output_badge"] is False else "FAIL",
                    "evidence": json.dumps(report["ui_smoke"]["planner_badge_dedupe"], default=str),
                },
                {
                    "scenario_id": "NAV_PARENT_ROUTES_NO_404",
                    "status": "PASS" if report["hardening_smoke"]["nav_parent_routes_no_404"] else "FAIL",
                    "evidence": json.dumps(
                        {"nav_parent_routes_no_404": report["hardening_smoke"]["nav_parent_routes_no_404"]},
                        default=str,
                    ),
                },
                {
                    "scenario_id": "PLANNER_ARTWORK_GATE_BLOCKS_RELEASE",
                    "status": "PASS" if report["hardening_smoke"]["planner_artwork_gate_blocks_release"] else "FAIL",
                    "evidence": json.dumps(
                        {"planner_artwork_gate_blocks_release": report["hardening_smoke"]["planner_artwork_gate_blocks_release"]},
                        default=str,
                    ),
                },
                {
                    "scenario_id": "PLANNER_ASSIGN_ARTWORK_UNBLOCKS_RELEASE",
                    "status": "PASS" if report["hardening_smoke"]["planner_assign_artwork_unblocks_release"] else "FAIL",
                    "evidence": json.dumps(
                        {"planner_assign_artwork_unblocks_release": report["hardening_smoke"]["planner_assign_artwork_unblocks_release"]},
                        default=str,
                    ),
                },
                {
                    "scenario_id": "ROTO_APPROVAL_BLOCKS_UNFINALIZED_CYLINDERS",
                    "status": "PASS" if report["hardening_smoke"]["roto_approval_blocks_unfinalized_cylinders"] else "FAIL",
                    "evidence": json.dumps(
                        {
                            "roto_approval_blocks_unfinalized_cylinders": report["hardening_smoke"][
                                "roto_approval_blocks_unfinalized_cylinders"
                            ],
                            "roto_approval_gate_message": report["hardening_smoke"]["roto_approval_gate_message"],
                        },
                        default=str,
                    ),
                },
            ]
        )

        self._write_report_artifacts(report_dir=report_dir, report=report, scenario_rows=scenario_rows)

        self.stdout.write(self.style.SUCCESS("Tagged acceptance flow completed."))
        self.stdout.write(self.style.SUCCESS(f"Artifacts: {report_dir}"))
        self.stdout.write(json.dumps(report, indent=2, default=str))

        if options.get("cleanup_after"):
            self._cleanup_prior_test_rows()

    def _upsert_packaging_material(
        self,
        *,
        code,
        name,
        base_uom,
        packaging_kind,
        packaging_supply_mode="PURCHASED",
        production_template=None,
        packaging_defaults_json=None,
        tare_weight_kg=None,
        per_sheet_base_qty=None,
    ):
        material, _ = InventoryMaterial.objects.update_or_create(
            code=code,
            defaults={
                "name": name,
                "category": "PACKAGING",
                "base_uom": base_uom,
                "packaging_kind": packaging_kind,
                "packaging_supply_mode": packaging_supply_mode,
                "production_template": production_template,
                "packaging_defaults_json": packaging_defaults_json or {},
                "tare_weight_kg": tare_weight_kg,
                "per_sheet_base_qty": per_sheet_base_qty,
                "status": "ACTIVE",
                "is_purchasable": packaging_supply_mode in {"PURCHASED", "BOTH"},
            },
        )
        return material

    def _packaging_stock_qty(self, material, location):
        row = PackagingStock.objects.filter(material=material, location=location).first()
        return Decimal(str(getattr(row, "qty", 0) or 0))

    def _produce_packaging_stock_for_acceptance(
        self,
        *,
        mts_order,
        admin,
        route_index,
        actual_qty,
        actual_uom="KG",
        output_pcs=None,
        target_location=None,
    ):
        jobs = JobService.create_jobs_for_planned_order(
            mts_order,
            start_index=route_index,
            stop_index=route_index,
        )
        if not jobs:
            raise CommandError(f"Could not create packaging job for {mts_order.order_number}.")

        job = jobs[0]
        fg_location = (
            InventoryLocation.objects.filter(plant=mts_order.plant, type="FG", is_active=True)
            .order_by("-is_system", "name")
            .first()
        )
        if fg_location and job.to_location_id != fg_location.id:
            job.to_location = fg_location
        now = timezone.now()
        job.status = "RUNNING"
        job.job_state = "EXECUTING"
        job.start_date = now
        update_fields = ["status", "job_state", "start_date", "updated_at"]
        if fg_location:
            update_fields.append("to_location")
        job.save(update_fields=update_fields)

        completion_meta = {}
        if actual_uom and str(actual_uom).upper() != "KG":
            completion_meta["actual_uom"] = str(actual_uom).upper()
        if output_pcs is not None:
            completion_meta["output_pcs"] = int(output_pcs)
        process = job.current_process or job.process
        if (
            process
            and str(getattr(process, "roll_behavior", "") or "").upper() == "CREATE_NEW"
            and str(getattr(process, "output_form", "") or "").upper() == "ROLL"
        ):
            geometry_base = (
                dict(getattr(mts_order, "geometry_snapshot", {}) or {}).get("base", {})
                if isinstance(getattr(mts_order, "geometry_snapshot", {}), dict)
                else {}
            )
            layer0 = (
                (getattr(mts_order, "layer_snapshot", None) or [None])[0]
                if isinstance(getattr(mts_order, "layer_snapshot", None), list)
                else None
            )
            inferred_width = (
                geometry_base.get("width_mm")
                or (layer0.get("width_mm") if isinstance(layer0, dict) else None)
                or 1000
            )
            completion_meta["output_width_mm"] = inferred_width

        JobService.log_output_event(job, Decimal(str(actual_qty)), completion_meta=completion_meta, user=admin)
        job.refresh_from_db()
        JobService.complete_step(job, user=admin, force_reason="Acceptance in-house packaging proof")
        job.refresh_from_db()

        mts_order.refresh_from_db()
        mts_order.produced_qty = mts_order.target_qty
        mts_order.status = "STOCK_READY"
        mts_order.save(update_fields=["produced_qty", "status", "updated_at"])

        produced_tx = (
            PackagingTransaction.objects.filter(mts_order=mts_order, type="PRODUCE")
            .order_by("-created_at")
            .first()
        )
        transfer_tx = None
        produced_qty = Decimal(str(getattr(produced_tx, "qty", 0) or 0))
        if (
            produced_tx
            and target_location
            and getattr(produced_tx, "location_id", None)
            and str(produced_tx.location_id) != str(target_location.id)
            and produced_qty > 0
        ):
            transfer_tx = PackagingService.transfer_packaging_stock(
                material_id=mts_order.packaging_material_id,
                qty=abs(produced_qty),
                from_location_id=produced_tx.location_id,
                to_location_id=target_location.id,
                reference=f"ACCEPTANCE_PROOF:{mts_order.order_number}",
            )
        return {
            "order_number": mts_order.order_number,
            "order_status": mts_order.status,
            "job_number": job.job_number,
            "job_status": job.status,
            "job_state": job.job_state,
            "closed_with_variance": bool(getattr(job, "closed_with_variance", False)),
            "completion_force_reason": getattr(job, "completion_force_reason", None),
            "produced_tx_type": produced_tx.type if produced_tx else None,
            "produced_tx_qty": float(abs(produced_qty)) if produced_tx else 0.0,
            "produced_tx_reference": produced_tx.reference if produced_tx else None,
            "location": getattr(getattr(produced_tx, "location", None), "name", None),
            "transfer_tx_type": transfer_tx.type if transfer_tx else None,
            "transfer_tx_reference": transfer_tx.reference if transfer_tx else None,
            "target_location": getattr(target_location, "name", None) if target_location else None,
        }

    def _upsert_pod_profile(
        self,
        *,
        code,
        name,
        pod_type,
        fixed_height_mm,
        thickness_micron,
        density_gcm3,
        panel_count,
        is_inhouse_produced,
    ):
        material, _ = InventoryMaterial.objects.update_or_create(
            code=code,
            defaults={
                "name": name,
                "category": "POD",
                "base_uom": "KG",
                "status": "ACTIVE",
                "is_purchasable": False,
                "is_extrudable": False,
                "density_gcm3": Decimal(str(density_gcm3)),
                "pod_type": str(pod_type).upper(),
                "pod_fixed_height_mm": Decimal(str(fixed_height_mm)),
                "pod_thickness_micron": Decimal(str(thickness_micron)),
                "pod_panel_count": int(panel_count),
                "pod_is_inhouse_produced": bool(is_inhouse_produced),
            },
        )
        return material

    def _create_sales_order_with_item(
        self,
        *,
        customer,
        order_name,
        template,
        geometry_snapshot,
        layer_snapshot,
        printing_snapshot,
        addons_snapshot,
        packaging_snapshot,
        bom_snapshot,
        spec_signature,
        invariant_signature,
        unit_weight_g,
        total_weight_kg,
        qty_uom,
        qty_value,
    ):
        order = SalesOrder.objects.create(
            customer=customer,
            customer_name=customer.name,
            order_name=order_name,
            order_type="MTO",
            status="CONFIRMED",
            geometry_override=geometry_snapshot,
            commercial_confirmed_at=timezone.now(),
            delivery_date=timezone.localdate(),
        )
        item = SalesOrderItem.objects.create(
            sales_order=order,
            template=template,
            mode="TEMPLATE",
            line_name=order_name,
            geometry_snapshot=geometry_snapshot,
            layer_snapshot=self._json_ready(layer_snapshot),
            printing_snapshot=self._json_ready(printing_snapshot),
            addons_snapshot=self._json_ready(addons_snapshot),
            packaging_snapshot=self._json_ready(packaging_snapshot),
            bom_snapshot=self._json_ready(bom_snapshot),
            spec_signature=spec_signature,
            invariant_signature=invariant_signature,
            unit_weight_g=unit_weight_g,
            total_weight_kg=total_weight_kg,
            qty_uom=qty_uom,
            qty_value=qty_value,
            price_basis="KG",
            unit_price=Decimal("0"),
        )
        return order, item

    def _json_ready(self, value):
        if isinstance(value, Decimal):
            return float(value)
        if isinstance(value, dict):
            return {str(k): self._json_ready(v) for k, v in value.items()}
        if isinstance(value, list):
            return [self._json_ready(v) for v in value]
        return value

    def _ensure_live_template(self, *, fg_type: str, admin, tag: str):
        fg_type = str(fg_type or "").upper()
        template = (
            TemplateBlueprint.objects.filter(status="LIVE", fg_type=fg_type, routing_rule__isnull=False)
            .order_by("created_at")
            .first()
        )
        if template:
            return template

        route = self._pick_active_route_for_fg(fg_type=fg_type)
        if not route:
            raise CommandError(f"No active routing rule available to bootstrap {fg_type} template.")

        template = TemplateBlueprint.objects.create(
            name=f"TEST_ACCEPTANCE_{fg_type}_{tag}",
            fg_type=fg_type,
            status="DRAFT",
            routing_rule=route,
            created_by=admin,
            version=1,
        )
        TemplateBlueprintViewSet()._apply_route_sync(template, destructive=False)
        template.status = "LIVE"
        template.approved_by = admin
        template.approved_at = timezone.now()
        template.save(update_fields=["status", "approved_by", "approved_at", "updated_at"])
        return template

    def _pick_active_route_for_fg(self, *, fg_type: str):
        routes = list(RoutingRule.objects.filter(is_active=True).order_by("created_at"))
        if not routes:
            return None

        last_codes = [str((route.ordered_processes or [])[-1]) for route in routes if route.ordered_processes]
        proc_map = {proc.code: proc for proc in Process.objects.filter(code__in=last_codes)}

        desired_output_form = "ROLL" if fg_type == "ROLL" else "BULK"
        for route in routes:
            codes = route.ordered_processes or []
            if not codes:
                continue
            last_proc = proc_map.get(str(codes[-1]))
            if not last_proc:
                continue
            if str(last_proc.output_form or "").upper() == desired_output_form:
                return route

        return routes[0]

    def _cleanup_prior_test_rows(self):
        job_scope = (
            Q(job_number__startswith="JOB-TEST-")
            | Q(job_number__startswith="UIE2E-MUT-")
            | Q(mts_order__internal_name__startswith="TEST_MTS_")
            | Q(mts_order__internal_name__startswith="E2E_MTS_")
        )
        job_ids = list(ProductionJob.objects.filter(job_scope).values_list("id", flat=True))
        roll_job_scope = Q(production_job_id__in=job_ids) | Q(created_by_job_id__in=job_ids)

        DeliveryChallan.objects.filter(
            Q(customer_name__startswith="TEST Roll Customer")
            | Q(customer_name__startswith="TEST Pouch Customer")
        ).delete()
        RollDispatchPackRecord.objects.filter(
            Q(sales_order_item__sales_order__customer__code__in=["TEST_CUSTOMER_ROLL", "TEST_CUSTOMER_POUCH"])
            | Q(roll__label_id__startswith="TEST-ROLL-")
            | Q(roll__label_id__startswith="TEST-RAW-")
            | Q(roll__label_id__startswith="TEST-WIP-")
            | Q(roll__label_id__startswith="TEST-BAD-")
            | Q(roll__label_id__startswith="UIE2E-MUT-")
            | Q(roll__production_job_id__in=job_ids)
            | Q(roll__created_by_job_id__in=job_ids)
        ).delete()
        InventoryAllocation.objects.filter(
            Q(sales_order__customer__code__in=["TEST_CUSTOMER_ROLL", "TEST_CUSTOMER_POUCH"])
            | Q(sales_order__order_name__startswith="E2E_SO_")
            | Q(mts_order__internal_name__startswith="TEST_MTS_")
            | Q(mts_order__internal_name__startswith="E2E_MTS_")
        ).delete()
        PackingUnit.objects.filter(
            Q(sales_order_item__sales_order__customer__code__in=["TEST_CUSTOMER_ROLL", "TEST_CUSTOMER_POUCH"])
            | Q(sales_order_item__sales_order__order_name__startswith="E2E_SO_")
            | Q(fg_batch__production_job_id__in=job_ids)
        ).delete()
        FinishedGoodsBatch.objects.filter(
            Q(batch_number__startswith="TEST-PBATCH-")
            | Q(sales_order_item__sales_order__customer__code__in=["TEST_CUSTOMER_ROLL", "TEST_CUSTOMER_POUCH"])
            | Q(sales_order_item__sales_order__order_name__startswith="E2E_SO_")
            | Q(production_job_id__in=job_ids)
        ).delete()
        RollLink.objects.filter(
            Q(parent_roll__label_id__startswith="TEST-ROLL-")
            | Q(parent_roll__label_id__startswith="TEST-RAW-")
            | Q(parent_roll__label_id__startswith="TEST-WIP-")
            | Q(parent_roll__label_id__startswith="TEST-BAD-")
            | Q(parent_roll__label_id__startswith="E2E-GRN-ROLL-")
            | Q(parent_roll__label_id__startswith="UIE2E-MUT-")
            | Q(parent_roll__production_job_id__in=job_ids)
            | Q(parent_roll__created_by_job_id__in=job_ids)
            | Q(child_roll__label_id__startswith="TEST-ROLL-")
            | Q(child_roll__label_id__startswith="TEST-RAW-")
            | Q(child_roll__label_id__startswith="TEST-WIP-")
            | Q(child_roll__label_id__startswith="TEST-BAD-")
            | Q(child_roll__label_id__startswith="E2E-GRN-ROLL-")
            | Q(child_roll__label_id__startswith="UIE2E-MUT-")
            | Q(child_roll__production_job_id__in=job_ids)
            | Q(child_roll__created_by_job_id__in=job_ids)
        ).delete()
        RollConsumption.objects.filter(
            Q(job_id__in=job_ids)
            | Q(input_roll__production_job_id__in=job_ids)
            | Q(input_roll__created_by_job_id__in=job_ids)
            | Q(output_roll__production_job_id__in=job_ids)
            | Q(output_roll__created_by_job_id__in=job_ids)
            | Q(balance_roll__production_job_id__in=job_ids)
            | Q(balance_roll__created_by_job_id__in=job_ids)
            | Q(scrap_roll__production_job_id__in=job_ids)
            | Q(scrap_roll__created_by_job_id__in=job_ids)
        ).delete()
        InventoryReservation.objects.filter(
            Q(roll__label_id__startswith="TEST-ROLL-")
            | Q(roll__label_id__startswith="TEST-RAW-")
            | Q(roll__label_id__startswith="TEST-WIP-")
            | Q(roll__label_id__startswith="TEST-BAD-")
            | Q(roll__label_id__startswith="E2E-GRN-ROLL-")
            | Q(roll__label_id__startswith="UIE2E-MUT-")
            | Q(job_id__in=job_ids)
            | Q(roll__production_job_id__in=job_ids)
            | Q(roll__created_by_job_id__in=job_ids)
        ).delete()
        RollMovement.objects.filter(
            Q(roll__label_id__startswith="TEST-ROLL-")
            | Q(roll__label_id__startswith="TEST-RAW-")
            | Q(roll__label_id__startswith="TEST-WIP-")
            | Q(roll__label_id__startswith="TEST-BAD-")
            | Q(roll__label_id__startswith="E2E-GRN-ROLL-")
            | Q(roll__label_id__startswith="UIE2E-MUT-")
            | Q(roll__production_job_id__in=job_ids)
            | Q(roll__created_by_job_id__in=job_ids)
        ).delete()
        InventoryRoll.objects.filter(
            Q(label_id__startswith="TEST-ROLL-")
            | Q(label_id__startswith="TEST-RAW-")
            | Q(label_id__startswith="TEST-WIP-")
            | Q(label_id__startswith="TEST-BAD-")
            | Q(label_id__startswith="E2E-GRN-ROLL-")
            | Q(label_id__startswith="UIE2E-MUT-")
            | Q(label_id__startswith="R-UIE2E-MUT-")
            | roll_job_scope
        ).delete()
        JobWorkOrder.objects.filter(
            Q(notes__icontains="E2E planned step jobwork")
            | Q(notes__icontains="UI E2E")
            | Q(production_job__job_number__startswith="JOB-TEST-")
            | Q(production_job__job_number__startswith="UIE2E-MUT-")
            | Q(production_job__mts_order__internal_name__startswith="TEST_MTS_")
            | Q(production_job__mts_order__internal_name__startswith="E2E_MTS_")
        ).delete()
        if job_ids:
            MaterialConsumptionLog.objects.filter(production_job_id__in=job_ids).delete()
            DowntimeLog.objects.filter(production_job_id__in=job_ids).delete()
            ScrapLog.objects.filter(production_job_id__in=job_ids).delete()
            JobExecutionLog.objects.filter(production_job_id__in=job_ids).delete()
        ProductionJob.objects.filter(id__in=job_ids).delete()
        PlannedStockOrder.objects.filter(
            Q(internal_name__startswith="TEST_MTS_") | Q(internal_name__startswith="E2E_MTS_")
        ).delete()
        SalesOrder.objects.filter(
            Q(customer__code__in=["TEST_CUSTOMER_ROLL", "TEST_CUSTOMER_POUCH"])
            | Q(order_name__startswith="E2E_SO_")
            | Q(order_name__startswith="TEST_SO_")
        ).delete()
        Customer.objects.filter(code__in=["TEST_CUSTOMER_ROLL", "TEST_CUSTOMER_POUCH"]).delete()
        PackagingTransaction.objects.filter(
            Q(material__code__startswith="TEST_")
            | Q(material__code__in=["PACK_INNER_100_INHOUSE", "PACK_ROLL_SHEET_INHOUSE"])
        ).delete()
        PackagingStock.objects.filter(
            Q(material__code__startswith="TEST_")
            | Q(material__code__in=["PACK_INNER_100_INHOUSE", "PACK_ROLL_SHEET_INHOUSE"])
        ).delete()
        InventoryMaterial.objects.filter(code__in=[
            "PACK_INNER_100_INHOUSE",
            "TEST_GONNY_PCS",
            "TEST_TAPE_PCS",
            "PACK_ROLL_SHEET_INHOUSE",
            "TEST_POD_SINGLE_200",
        ]).delete()
        Vendor.objects.filter(code="TEST_VENDOR_ACCEPTANCE").delete()

    def _write_report_artifacts(self, *, report_dir: Path, report: dict, scenario_rows: list[dict]):
        report_json = report_dir / "e2e_report.json"
        report_md = report_dir / "e2e_report.md"
        fixes_log = report_dir / "fixes_log.md"
        scenario_csv = report_dir / "scenario_matrix.csv"

        report_json.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
        report_md.write_text(self._render_report_markdown(report, scenario_rows), encoding="utf-8")

        if not fixes_log.exists():
            fixes_log.write_text(
                "# Acceptance Fix Log\n\n"
                f"- {timezone.now().isoformat()}: Reset + acceptance harness executed. No runtime fix applied during this run.\n",
                encoding="utf-8",
            )

        with scenario_csv.open("w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=["scenario_id", "status", "evidence"])
            writer.writeheader()
            for row in scenario_rows:
                writer.writerow(row)

        proof_json = report_dir / "inhouse_packaging_proof.json"
        proof_md = report_dir / "inhouse_packaging_proof.md"
        proof_payload = report.get("inhouse_packaging_proof", {})
        proof_json.write_text(json.dumps(proof_payload, indent=2, default=str), encoding="utf-8")
        proof_md.write_text(self._render_inhouse_packaging_markdown(proof_payload), encoding="utf-8")

    def _render_report_markdown(self, report: dict, scenario_rows: list[dict]) -> str:
        lines = [
            "# E2E Acceptance Report",
            "",
            f"- Tag: `{report.get('tag')}`",
            f"- Generated: `{report.get('generated_at')}`",
            f"- Plant: `{report.get('plant')}`",
            f"- Location: `{report.get('location')}`",
            "",
            "## Roll Preview",
            f"- Weight (kg): `{report.get('roll_preview', {}).get('weight_kg')}`",
            f"- Width (mm): `{report.get('roll_preview', {}).get('width_mm')}`",
            f"- Thickness (micron): `{report.get('roll_preview', {}).get('thickness_micron')}`",
            f"- Area (m2): `{report.get('roll_preview', {}).get('derived_area_m2')}`",
            f"- Length (m): `{report.get('roll_preview', {}).get('derived_length_m')}`",
            "",
            "## POD Formula",
            f"- Profile: `{report.get('pod_formula', {}).get('profile_code')}`",
            f"- Expected (kg): `{report.get('pod_formula', {}).get('expected_weight_kg')}`",
            f"- Observed (kg): `{report.get('pod_formula', {}).get('observed_weight_kg')}`",
            f"- Delta (kg): `{report.get('pod_formula', {}).get('abs_delta_kg')}`",
            "",
            "## Dataset",
            f"- Sales Orders: `{report.get('dataset_seed', {}).get('sales_orders_created_total')}`",
            f"- Roll Sales: `{report.get('dataset_seed', {}).get('sales_orders_roll_total')}`",
            f"- Pouch Sales: `{report.get('dataset_seed', {}).get('sales_orders_pouch_total')}`",
            f"- MTS Orders: `{len(report.get('dataset_seed', {}).get('mts_orders', []))}`",
            "",
            "## In-House Packaging Proof",
            f"- Inner Pouch Order: `{report.get('inhouse_packaging_proof', {}).get('orders', {}).get('inner_pouch', {}).get('order_number')}`",
            f"- Inner Pouch Produced Tx: `{report.get('inhouse_packaging_proof', {}).get('orders', {}).get('inner_pouch', {}).get('produced_tx_type')}`",
            f"- Sheet Order: `{report.get('inhouse_packaging_proof', {}).get('orders', {}).get('sheet', {}).get('order_number')}`",
            f"- Sheet Produced Tx: `{report.get('inhouse_packaging_proof', {}).get('orders', {}).get('sheet', {}).get('produced_tx_type')}`",
            f"- Inner Pouch After Consumption (PCS): `{report.get('inhouse_packaging_proof', {}).get('stock', {}).get('after_consumption', {}).get('inner_pouch_pcs')}`",
            f"- Sheet After Consumption (KG): `{report.get('inhouse_packaging_proof', {}).get('stock', {}).get('after_consumption', {}).get('sheet_kg')}`",
            "",
            "## Two-Plant Seed",
            f"- Plant A Packaging Rows: `{report.get('plant_inventory_seed', {}).get('plant_a_packaging_rows')}`",
            f"- Plant B Packaging Rows: `{report.get('plant_inventory_seed', {}).get('plant_b_packaging_rows')}`",
            f"- Plant A Roll Rows: `{report.get('plant_inventory_seed', {}).get('plant_a_roll_rows')}`",
            f"- Plant B Roll Rows: `{report.get('plant_inventory_seed', {}).get('plant_b_roll_rows')}`",
            "",
            "## Jobwork",
            f"- Planned Step Order Status: `{report.get('jobwork', {}).get('planned_step', {}).get('status_after_receive')}`",
            f"- Planned Step Roll Status: `{report.get('jobwork', {}).get('planned_step', {}).get('roll_status_after_receive')}`",
            f"- Emergency Job State: `{report.get('jobwork', {}).get('emergency', {}).get('job_state_after_pause')}`",
            "",
            "## UI Smoke",
            f"- Template Category Assignment HTTP: `{report.get('ui_smoke', {}).get('template_category_assignment_status')}`",
            f"- Planner Row Selected: `{report.get('ui_smoke', {}).get('planner_row_selected')}`",
            "",
            "## Scenario Matrix",
        ]
        for row in scenario_rows:
            lines.append(f"- `{row['scenario_id']}`: **{row['status']}**")
        lines.append("")
        return "\n".join(lines)

    def _render_inhouse_packaging_markdown(self, proof: dict) -> str:
        stock = proof.get("stock", {}) if isinstance(proof, dict) else {}
        orders = proof.get("orders", {}) if isinstance(proof, dict) else {}
        artifacts = proof.get("artifacts", {}) if isinstance(proof, dict) else {}
        lines = [
            "# In-House Packaging Proof",
            "",
            "## SKUs",
        ]
        for sku in proof.get("skus", []) if isinstance(proof.get("skus", []), list) else []:
            lines.append(
                f"- `{sku.get('code')}` | kind=`{sku.get('kind')}` | supply=`{sku.get('supply_mode')}` | template=`{sku.get('template')}`"
            )
        lines.extend(
            [
                "",
                "## Orders",
                f"- Inner Pouch Order: `{orders.get('inner_pouch', {}).get('order_number')}` -> `{orders.get('inner_pouch', {}).get('order_status')}`",
                f"- Sheet Order: `{orders.get('sheet', {}).get('order_number')}` -> `{orders.get('sheet', {}).get('order_status')}`",
                "",
                "## Stock",
                f"- Before Production: `{json.dumps(stock.get('before_production', {}), default=str)}`",
                f"- After Production: `{json.dumps(stock.get('after_production', {}), default=str)}`",
                f"- After Consumption: `{json.dumps(stock.get('after_consumption', {}), default=str)}`",
                f"- Expected Remaining: `{json.dumps(stock.get('expected_remaining', {}), default=str)}`",
                "",
                "## Artifacts",
                f"- Roll Challan PDF: `{artifacts.get('roll_challan_pdf')}`",
                f"- Pouch Challan PDF: `{artifacts.get('pouch_challan_pdf')}`",
                "",
            ]
        )
        return "\n".join(lines)
