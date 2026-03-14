import json
from datetime import datetime
from pathlib import Path
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.inventory.models import (
    BulkTransaction,
    DeliveryChallan as InventoryDeliveryChallan,
    InterPlantChallanItem,
    InventoryAlert,
    InventoryBulk,
    InventoryReservation,
    InventoryRoll,
    InventorySnapshot,
    JobWorkOrder,
    PackagingStock,
    PackagingTransaction,
    RollConsumption,
    RollLink,
    RollMovement,
    Vendor,
)
from apps.production.models import (
    DeliveryChallan,
    DeliveryChallanItem,
    FinishedGoodsBatch,
    InventoryAllocation,
    JobExecutionLog,
    JobMaterialRequirement,
    MaterialConsumptionLog,
    PackingUnit,
    PlannedOrder,
    PlannedStockOrder,
    ProductionJob,
    RollDispatchPackRecord,
    ScrapLog,
    DowntimeLog,
    WorkCenterAssignment,
)
from apps.sales.models import Customer, SalesOrder, SalesOrderItem
from apps.templates.models import (
    TemplateBlueprint,
    TemplateProcessStep,
    TemplateProcessStepMaterial,
    TemplateProcessStepRollSpec,
)
from apps.materials.models import InventoryMaterial, ConsumableMaterial
from apps.recipes.models import RecipeGrade, ExtrusionRecipe, ExtrusionRecipeComponent
from apps.factory.models import Plant, Process, WorkCenter, WorkCenterProcess, Machine
from apps.routing.models import RoutingRule


RESET_TOKEN = "RESET_LOCAL_CLEAN_SLATE"


class Command(BaseCommand):
    help = "Reset local transactional sales/production/template data while preserving master data."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Apply destructive reset.")
        parser.add_argument(
            "--confirm",
            type=str,
            default="",
            help=f"Required confirmation token when --apply is set. Token: {RESET_TOKEN}",
        )
        parser.add_argument(
            "--backup-file",
            type=str,
            default="",
            help="Optional path for pre-delete summary JSON.",
        )
        parser.add_argument(
            "--preserve-categories",
            type=str,
            default="",
            help="Comma-separated InventoryMaterial categories to preserve (e.g. POD,ADDON).",
        )
        parser.add_argument(
            "--rebuild-masters",
            action="store_true",
            help="Rebuild core masters for a clean 2-plant validation environment.",
        )
        parser.add_argument(
            "--snapshot-dir",
            type=str,
            default=".runtime/acceptance",
            help="Directory to write reset_before/reset_after snapshots.",
        )

    def _counts_snapshot(self):
        return {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "sales_orders": SalesOrder.objects.count(),
            "sales_order_items": SalesOrderItem.objects.count(),
            "planned_orders": PlannedOrder.objects.count(),
            "planned_stock_orders": PlannedStockOrder.objects.count(),
            "production_jobs": ProductionJob.objects.count(),
            "workcenter_assignments": WorkCenterAssignment.objects.count(),
            "job_execution_logs": JobExecutionLog.objects.count(),
            "scrap_logs": ScrapLog.objects.count(),
            "downtime_logs": DowntimeLog.objects.count(),
            "material_consumption_logs": MaterialConsumptionLog.objects.count(),
            "job_material_requirements": JobMaterialRequirement.objects.count(),
            "finished_goods_batches": FinishedGoodsBatch.objects.count(),
            "packing_units": PackingUnit.objects.count(),
            "delivery_challans_production": DeliveryChallan.objects.count(),
            "delivery_challan_items_production": DeliveryChallanItem.objects.count(),
            "roll_dispatch_pack_records": RollDispatchPackRecord.objects.count(),
            "inventory_allocations": InventoryAllocation.objects.count(),
            "inventory_rolls": InventoryRoll.objects.count(),
            "inventory_bulk": InventoryBulk.objects.count(),
            "bulk_transactions": BulkTransaction.objects.count(),
            "packaging_stock": PackagingStock.objects.count(),
            "packaging_transactions": PackagingTransaction.objects.count(),
            "inventory_delivery_challans": InventoryDeliveryChallan.objects.count(),
            "interplant_challan_items": InterPlantChallanItem.objects.count(),
            "job_work_orders": JobWorkOrder.objects.count(),
            "roll_links": RollLink.objects.count(),
            "roll_consumptions": RollConsumption.objects.count(),
            "roll_movements": RollMovement.objects.count(),
            "inventory_snapshots": InventorySnapshot.objects.count(),
            "inventory_alerts": InventoryAlert.objects.count(),
            "inventory_reservations": InventoryReservation.objects.count(),
            "templates": TemplateBlueprint.objects.count(),
            "template_steps": TemplateProcessStep.objects.count(),
            "template_material_rules": TemplateProcessStepMaterial.objects.count(),
            "template_roll_handling_rules": TemplateProcessStepRollSpec.objects.count(),
            "materials_total": InventoryMaterial.objects.count(),
            "materials_pod": InventoryMaterial.objects.filter(category="POD").count(),
            "materials_addon": InventoryMaterial.objects.filter(category="ADDON").count(),
            "consumable_materials": ConsumableMaterial.objects.count(),
            "recipe_grades": RecipeGrade.objects.count(),
            "extrusion_recipes": ExtrusionRecipe.objects.count(),
            "plants": Plant.objects.count(),
            "processes": Process.objects.count(),
            "routing_rules": RoutingRule.objects.count(),
            "work_centers": WorkCenter.objects.count(),
            "machines": Machine.objects.count(),
            "vendors": Vendor.objects.count(),
            "customers": Customer.objects.count(),
        }

    def _write_backup(self, backup_path: Path, payload: dict):
        backup_path.parent.mkdir(parents=True, exist_ok=True)
        backup_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def _parse_preserve_categories(self, raw: str):
        categories = []
        for part in str(raw or "").split(","):
            value = str(part or "").strip().upper()
            if value:
                categories.append(value)
        return sorted(set(categories))

    def _rebuild_core_masters(self, preserve_categories):
        # Plants (system inventory locations are auto-created by inventory signals)
        plant_a, _ = Plant.objects.update_or_create(
            code="PLANT_A",
            defaults={"name": "Plant A"},
        )
        plant_b, _ = Plant.objects.update_or_create(
            code="PLANT_B",
            defaults={"name": "Plant B"},
        )

        # Processes
        process_specs = [
            ("EXTRUSION", "Extrusion", "BULK", "ROLL", "CREATE_NEW"),
            ("PRINTING", "Flexo Printing", "ROLL", "ROLL", "MODIFY_EXISTING"),
            ("LAMINATION", "Lamination", "ROLL", "ROLL", "MULTI_INPUT_COMBINE"),
            ("SLITTING", "Slitting", "ROLL", "ROLL", "SPLIT"),
            ("POUCHING", "Pouching", "ROLL", "BULK", "NONE"),
            ("JOBWORK_EXT", "External Jobwork Step", "ROLL", "ROLL", "MODIFY_EXISTING"),
        ]
        process_map = {}
        for code, name, input_form, output_form, roll_behavior in process_specs:
            proc, _ = Process.objects.update_or_create(
                code=code,
                defaults={
                    "name": name,
                    "description": f"Auto-rebuilt process: {name}",
                    "input_form": input_form,
                    "output_form": output_form,
                    "roll_behavior": roll_behavior,
                },
            )
            process_map[code] = proc

        # Work centers + process links + machines
        for plant in (plant_a, plant_b):
            wc_specs = [
                ("EXTRU", "Extrusion WC", ["EXTRUSION"]),
                ("PRINT", "Printing WC", ["PRINTING"]),
                ("LAMI", "Lamination WC", ["LAMINATION"]),
                ("SLIT", "Slitting WC", ["SLITTING"]),
                ("POUCH", "Pouching WC", ["POUCHING"]),
            ]
            for suffix, wc_name, process_codes in wc_specs:
                wc, _ = WorkCenter.objects.update_or_create(
                    code=f"{plant.code}_{suffix}",
                    defaults={
                        "plant": plant,
                        "name": f"{plant.name} {wc_name}",
                        "standard_operating_minutes_per_day": 480,
                    },
                )
                for process_code in process_codes:
                    WorkCenterProcess.objects.update_or_create(
                        work_center=wc,
                        process=process_map[process_code],
                    )
                Machine.objects.update_or_create(
                    code=f"{plant.code}_{suffix}_M1",
                    defaults={
                        "work_center": wc,
                        "name": f"{wc.name} Machine 1",
                        "status": "ACTIVE",
                        "standard_rate_kg_per_hour": Decimal("120.00"),
                    },
                )

        # Routes
        RoutingRule.objects.update_or_create(
            name="ROLL_ROUTE_STANDARD",
            defaults={
                "description": "Auto-rebuilt standard roll route",
                "ordered_processes": ["EXTRUSION", "PRINTING", "LAMINATION", "SLITTING"],
                "allowed_workcenters": [],
                "interplant_required": False,
                "is_active": True,
            },
        )
        RoutingRule.objects.update_or_create(
            name="POUCH_ROUTE_STANDARD",
            defaults={
                "description": "Auto-rebuilt standard pouch route",
                "ordered_processes": ["EXTRUSION", "PRINTING", "LAMINATION", "POUCHING"],
                "allowed_workcenters": [],
                "interplant_required": False,
                "is_active": True,
            },
        )
        RoutingRule.objects.update_or_create(
            name="POUCH_ROUTE_WITH_JOBWORK",
            defaults={
                "description": "Auto-rebuilt pouch route with planned external jobwork step",
                "ordered_processes": ["EXTRUSION", "JOBWORK_EXT", "LAMINATION", "POUCHING"],
                "allowed_workcenters": [],
                "interplant_required": False,
                "is_active": True,
            },
        )

        # Grades + materials
        grade_gp, _ = RecipeGrade.objects.update_or_create(name="GP", defaults={"is_active": True})
        grade_food, _ = RecipeGrade.objects.update_or_create(name="FOOD", defaults={"is_active": True})

        fam_mld, _ = InventoryMaterial.objects.update_or_create(
            code="FAM_MLD",
            defaults={
                "name": "MLD Family",
                "category": "FILM_FAMILY",
                "base_uom": "KG",
                "density_gcm3": Decimal("0.9200"),
                "status": "ACTIVE",
            },
        )
        fam_pet, _ = InventoryMaterial.objects.update_or_create(
            code="FAM_PET",
            defaults={
                "name": "PET Family",
                "category": "FILM_FAMILY",
                "base_uom": "KG",
                "density_gcm3": Decimal("1.3800"),
                "status": "ACTIVE",
            },
        )

        var_mld, _ = InventoryMaterial.objects.update_or_create(
            code="VAR_MLD_40",
            defaults={
                "name": "MLD Variant 40",
                "category": "FILM_VARIANT",
                "base_uom": "KG",
                "parent_family": fam_mld,
                "grade": grade_gp,
                "is_extrudable": True,
                "is_purchasable": True,
                "status": "ACTIVE",
            },
        )
        var_pet, _ = InventoryMaterial.objects.update_or_create(
            code="VAR_PET_12",
            defaults={
                "name": "PET Variant 12",
                "category": "FILM_VARIANT",
                "base_uom": "KG",
                "parent_family": fam_pet,
                "grade": grade_food,
                "is_extrudable": False,
                "is_purchasable": True,
                "status": "ACTIVE",
            },
        )

        granules = [
            ("GRANULE_LDPE", "LDPE Granule"),
            ("GRANULE_LLDPE", "LLDPE Granule"),
            ("GRANULE_MASTER", "Masterbatch Granule"),
        ]
        for code, name in granules:
            InventoryMaterial.objects.update_or_create(
                code=code,
                defaults={
                    "name": name,
                    "category": "GRANULE",
                    "base_uom": "KG",
                    "status": "ACTIVE",
                },
            )

        for code, name, category in [
            ("INK_CYAN", "Ink Cyan", "INK"),
            ("INK_MAGENTA", "Ink Magenta", "INK"),
            ("CHEM_ADH_01", "Adhesive A", "ADHESIVE"),
            ("CHEM_SOLV_01", "Solvent A", "SOLVENT"),
            ("PACK_INNER_100", "Inner Pouch 100", "PACKAGING"),
            ("PACK_GONNY_STD", "Gonny Standard", "PACKAGING"),
            ("PACK_TAPE_STD", "Tape Standard", "PACKAGING"),
            ("PACK_SHEET_STD", "Sheet Standard", "PACKAGING"),
        ]:
            defaults = {
                "name": name,
                "category": category,
                "base_uom": "KG" if category in {"INK", "ADHESIVE", "SOLVENT"} else "PCS",
                "status": "ACTIVE",
            }
            if category == "PACKAGING":
                defaults.update({
                    "base_uom": "PCS",
                    "packaging_kind": "OTHER",
                    "packaging_supply_mode": "PURCHASED",
                })
                if code == "PACK_INNER_100":
                    defaults["packaging_kind"] = "INNER_POUCH"
                elif code == "PACK_GONNY_STD":
                    defaults["packaging_kind"] = "GONNY"
                elif code == "PACK_TAPE_STD":
                    defaults["packaging_kind"] = "TAPE"
                elif code == "PACK_SHEET_STD":
                    defaults["packaging_kind"] = "SHEET"
                    defaults["base_uom"] = "KG"
                    defaults["per_sheet_base_qty"] = Decimal("0.250000")
            InventoryMaterial.objects.update_or_create(code=code, defaults=defaults)

        # Minimal extrusion recipe
        recipe, _ = ExtrusionRecipe.objects.update_or_create(
            film_variant=var_mld,
            grade=grade_gp,
            thickness_min_micron=20,
            thickness_max_micron=80,
            is_active=True,
            defaults={},
        )
        ExtrusionRecipeComponent.objects.update_or_create(
            recipe=recipe,
            granule=InventoryMaterial.objects.get(code="GRANULE_LDPE"),
            defaults={"percentage": 60},
        )
        ExtrusionRecipeComponent.objects.update_or_create(
            recipe=recipe,
            granule=InventoryMaterial.objects.get(code="GRANULE_LLDPE"),
            defaults={"percentage": 40},
        )

        # Vendors and customers
        vendors = [
            ("JW_VENDOR_A", "Jobwork Vendor A", "JOBWORK"),
            ("JW_VENDOR_B", "Jobwork Vendor B", "BOTH"),
            ("JW_VENDOR_C", "Jobwork Vendor C", "JOBWORK"),
        ]
        for code, name, vendor_type in vendors:
            Vendor.objects.update_or_create(
                code=code,
                defaults={"name": name, "type": vendor_type, "status": "ACTIVE"},
            )

        for idx in range(1, 9):
            Customer.objects.update_or_create(
                code=f"CUST_{idx:02d}",
                defaults={"name": f"Customer {idx:02d}", "status": "ACTIVE"},
            )

        # Keep preserved POD/ADDON categories alive and active.
        if "POD" in preserve_categories and not InventoryMaterial.objects.filter(category="POD").exists():
            InventoryMaterial.objects.update_or_create(
                code="POD_SINGLE_200",
                defaults={
                    "name": "POD SINGLE (200MM) 30MIC",
                    "category": "POD",
                    "base_uom": "KG",
                    "density_gcm3": Decimal("0.9200"),
                    "pod_type": "SINGLE",
                    "pod_fixed_height_mm": Decimal("200"),
                    "pod_thickness_micron": Decimal("30"),
                    "pod_panel_count": 1,
                    "pod_is_inhouse_produced": True,
                    "status": "ACTIVE",
                },
            )
        if "ADDON" in preserve_categories and not InventoryMaterial.objects.filter(category="ADDON").exists():
            InventoryMaterial.objects.update_or_create(
                code="ADDON_FIXED_001",
                defaults={
                    "name": "Addon Fixed 001",
                    "category": "ADDON",
                    "base_uom": "KG",
                    "weight_mode": "FIXED",
                    "weight_value": 2.5,
                    "status": "ACTIVE",
                },
            )

    def handle(self, *args, **options):
        before = self._counts_snapshot()
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        preserve_categories = self._parse_preserve_categories(options.get("preserve_categories") or "")
        snapshot_dir = Path(options.get("snapshot_dir") or ".runtime/acceptance").expanduser().resolve()
        snapshot_dir.mkdir(parents=True, exist_ok=True)
        before_snapshot_path = snapshot_dir / "reset_before.json"
        after_snapshot_path = snapshot_dir / "reset_after.json"

        backup_file = options.get("backup_file") or str(snapshot_dir / f"clean_slate_backup_{timestamp}.json")
        backup_path = Path(backup_file).expanduser().resolve()
        self._write_backup(backup_path, {"before": before})
        self._write_backup(before_snapshot_path, before)
        self.stdout.write(self.style.WARNING(f"Pre-reset summary written: {backup_path}"))
        self.stdout.write(json.dumps(before, indent=2))
        if preserve_categories:
            self.stdout.write(self.style.WARNING(f"Preserving material categories: {', '.join(preserve_categories)}"))

        if not options.get("apply"):
            self.stdout.write(
                self.style.WARNING(
                    f"Dry run only. Re-run with --apply --confirm {RESET_TOKEN} to execute deletion."
                )
            )
            return

        if str(options.get("confirm") or "") != RESET_TOKEN:
            raise CommandError(f"Confirmation token mismatch. Use --confirm {RESET_TOKEN}")

        with transaction.atomic():
            InventoryAllocation.objects.all().delete()
            RollDispatchPackRecord.objects.all().delete()
            DeliveryChallanItem.objects.all().delete()
            DeliveryChallan.objects.all().delete()
            PackingUnit.objects.all().delete()

            JobMaterialRequirement.objects.all().delete()
            MaterialConsumptionLog.objects.all().delete()
            JobExecutionLog.objects.all().delete()
            ScrapLog.objects.all().delete()
            DowntimeLog.objects.all().delete()
            WorkCenterAssignment.objects.all().delete()

            RollConsumption.objects.all().delete()
            RollLink.objects.all().delete()
            RollMovement.objects.all().delete()
            InventoryReservation.objects.all().delete()
            InventorySnapshot.objects.all().delete()
            InventoryAlert.objects.all().delete()
            BulkTransaction.objects.all().delete()
            PackagingTransaction.objects.all().delete()
            FinishedGoodsBatch.objects.all().delete()
            InventoryRoll.objects.all().delete()

            ProductionJob.objects.all().delete()
            PlannedOrder.objects.all().delete()
            PlannedStockOrder.objects.all().delete()
            SalesOrderItem.objects.all().delete()
            SalesOrder.objects.all().delete()

            InventoryBulk.objects.all().delete()
            PackagingStock.objects.all().delete()
            InterPlantChallanItem.objects.all().delete()
            InventoryDeliveryChallan.objects.all().delete()
            JobWorkOrder.objects.all().delete()

            TemplateProcessStepMaterial.objects.all().delete()
            TemplateProcessStepRollSpec.objects.all().delete()
            TemplateProcessStep.objects.all().delete()
            TemplateBlueprint.objects.all().delete()

            # Master resets (except explicitly preserved categories)
            ExtrusionRecipeComponent.objects.all().delete()
            ExtrusionRecipe.objects.all().delete()
            ConsumableMaterial.objects.all().delete()
            if preserve_categories:
                # Detach preserved materials from mutable master graph before deleting others.
                InventoryMaterial.objects.filter(category__in=preserve_categories).update(
                    parent_family=None,
                    grade=None,
                )
                materials_to_delete = InventoryMaterial.objects.exclude(category__in=preserve_categories)
            else:
                materials_to_delete = InventoryMaterial.objects.all()

            # Break self-referential PROTECT chains (variant -> family) prior to delete.
            materials_to_delete.update(parent_family=None, grade=None)
            materials_to_delete.delete()
            RecipeGrade.objects.all().delete()

            Vendor.objects.all().delete()
            Customer.objects.all().delete()

            Machine.objects.all().delete()
            WorkCenterProcess.objects.all().delete()
            WorkCenter.objects.all().delete()
            RoutingRule.objects.all().delete()
            Process.objects.all().delete()
            Plant.objects.all().delete()

            if options.get("rebuild_masters"):
                self._rebuild_core_masters(preserve_categories=preserve_categories)

        after = self._counts_snapshot()
        self._write_backup(after_snapshot_path, after)
        self._write_backup(backup_path, {"before": before, "after": after})
        self.stdout.write(self.style.SUCCESS("Local clean-slate reset completed."))
        self.stdout.write(self.style.SUCCESS(f"Before snapshot: {before_snapshot_path}"))
        self.stdout.write(self.style.SUCCESS(f"After snapshot: {after_snapshot_path}"))
        self.stdout.write(json.dumps(after, indent=2))
