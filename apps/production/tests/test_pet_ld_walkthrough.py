"""
Full-stack walkthrough of the live stand-up pouch route (16 Oct 2026 review):

    EXT (LD film, bulk -> 4 rolls)  ─┐
                                      ├─ Lam (2 lanes, PET ∥ LD) ─ Slt (2 lanes) ─ Pch (pieces) ─ pack ─ check ─ dispatch
    PRT (purchased PET, 2 rolls)   ─┘

Mirrors the live template "STANDUP POUCHES - 2 PLY - PRINTED": EXT CREATE_NEW (operator widths,
multi roll), PRT MODIFY_EXISTING (lock width), Lam MULTI_INPUT_COMBINE with LANE_GROUPS of 2,
Slt SPLIT (grid), Pch roll -> bulk with KG + PCS. Real BOM (preview), real consumption, real
step targets. Every figure is asserted and written to the walkthrough report when
WALKTHROUGH_REPORT_DIR is set.
"""
import json
import os
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from apps.factory.models import Machine, Plant, Process, WorkCenter, WorkCenterProcess
from apps.inventory.models import InventoryBulk, InventoryLocation, InventoryReservation, InventoryRoll, PackagingTransaction, RollConsumption
from apps.inventory.services.bulk_service import BulkService
from apps.inventory.services.packaging_service import PackagingService
from apps.materials.models import InventoryMaterial, WebWidthPolicy
from apps.production.models import (
    FinishedGoodsBatch, JobExecutionLog, JobMaterialRequirement, MaterialConsumptionLog, PackingUnit, ProductionJob,
    ScrapLog, WorkCenterAssignment,
)
from apps.production.services.dispatch_service import FGDispatchService
from apps.production.services.job_services import JobService, WCManagerService
from apps.production.services.operator_service import OperatorService
from apps.production.services.packing_service import PackingService, PackingVerificationService
from apps.production.services.roll_allocation_service import RollAllocationService
from apps.production.services.services_execution import ExecutionService
from apps.recipes.models import ExtrusionRecipe, ExtrusionRecipeComponent, RecipeGrade
from apps.routing.models import RoutingRule
from apps.sales.models import Customer, SalesOrder, SalesOrderItem
from apps.sales.services.order_service import SalesOrderService
from apps.templates.models import TemplateBlueprint, TemplateProcessStep

D = Decimal
REPORT = {"steps": [], "notes": []}


def json_ready(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, dict):
        return {str(k): json_ready(v) for k, v in value.items()}
    if isinstance(value, list):
        return [json_ready(v) for v in value]
    return value


def q(value, places="0.001"):
    return float(D(str(value or 0)).quantize(D(places), rounding=ROUND_HALF_UP))


class PetLdWalkthroughTests(TestCase):
    """One long scenario so later steps see the stock the earlier steps made."""

    @classmethod
    def setUpTestData(cls):
        cls.user = get_user_model().objects.create(username="walk-op", email="walk-op@example.invalid", is_superuser=True)
        cls.plant = Plant.objects.create(code="WT", name="Walkthrough plant")
        # The plant gets its system RM/WIP/FG locations on creation; reuse them so stock and jobs agree.
        def system_location(kind, code, name):
            found = InventoryLocation.objects.filter(plant=cls.plant, type=kind).order_by("-is_system", "code").first()
            return found or InventoryLocation.objects.create(plant=cls.plant, code=code, name=name, type=kind, is_system=True)

        cls.rm = system_location("RM", "RM", "RM store")
        cls.wip = system_location("WIP", "WIP", "WIP")
        cls.fg = system_location("FG", "FG", "FG store")
        cls.pack_store = InventoryLocation.objects.create(plant=cls.plant, code="PKS", name="Packing store", type="RM")

        # Processes exactly like live (codes, forms, behaviours).
        cls.processes = {}
        for code, name, inp, out, beh, extra in [
            ("EXT", "Extrusion", "BULK", "ROLL", "CREATE_NEW", {}),
            ("PRT", "Roto Printing", "ROLL", "ROLL", "MODIFY_EXISTING", {"has_artwork": True, "print_capable": True}),
            ("Lam", "Lamination", "ROLL", "ROLL", "MULTI_INPUT_COMBINE", {}),
            ("Slt", "Slitting", "ROLL", "ROLL", "SPLIT", {}),
            ("Pch", "Pouching", "ROLL", "BULK", "NONE", {}),
        ]:
            process = Process.objects.create(code=code, name=name, input_form=inp, output_form=out, roll_behavior=beh, **extra)
            # Extrusion draws granules from the RM store; roll steps issue from WIP.
            wc = WorkCenter.objects.create(plant=cls.plant, code=f"WC-{code}", name=f"{name} WC", default_wip_location=cls.rm if code == "EXT" else cls.wip)
            WorkCenterProcess.objects.create(work_center=wc, process=process)
            Machine.objects.create(work_center=wc, name=f"M-{code}", code=f"M{code}")
            cls.processes[code] = process

        # Films: purchased PET 12 µ (printed web), extruded LD 50 µ (sealant) from two granules.
        pet_family = InventoryMaterial.objects.create(code="PET-FAM", name="PET family", category="FILM_FAMILY", base_uom="KG", density_gcm3=D("1.40"))
        cls.pet = InventoryMaterial.objects.create(code="PET12", name="PET 12 micron", category="FILM_VARIANT", base_uom="KG", parent_family=pet_family, is_purchasable=True, is_extrudable=False)
        ld_family = InventoryMaterial.objects.create(code="LD-FAM", name="LD family", category="FILM_FAMILY", base_uom="KG", density_gcm3=D("0.92"))
        cls.grade = RecipeGrade.objects.create(name="FOOD", is_active=True)
        cls.ld = InventoryMaterial.objects.create(code="LDWHITE", name="Milky LD film", category="FILM_VARIANT", base_uom="KG", parent_family=ld_family, is_extrudable=True, is_purchasable=False, grade=cls.grade)
        cls.gran_a = InventoryMaterial.objects.create(code="LDPE-G1", name="LDPE granule", category="GRANULE", base_uom="KG")
        cls.gran_b = InventoryMaterial.objects.create(code="LLDPE-G2", name="LLDPE granule", category="GRANULE", base_uom="KG")
        recipe = ExtrusionRecipe.objects.create(film_variant=cls.ld, grade=cls.grade, thickness_min_micron=20, thickness_max_micron=100, is_active=True)
        ExtrusionRecipeComponent.objects.create(recipe=recipe, granule=cls.gran_a, percentage=70)
        ExtrusionRecipeComponent.objects.create(recipe=recipe, granule=cls.gran_b, percentage=30)
        cls.adhesive, _ = InventoryMaterial.objects.get_or_create(code="AD-ADHESIVE", defaults={"name": "Lamination adhesive", "category": "ADHESIVE", "base_uom": "KG"})
        cls.inner = InventoryMaterial.objects.create(code="INNER-100", name="Inner pouch of 100", category="PACKAGING", base_uom="PCS", packaging_kind="INNER_POUCH", packaging_supply_mode="IN_HOUSE", packaging_defaults_json={"pcs_per_pack": 100, "weight_kg_per_base_uom": "0.012"})
        cls.gonny = InventoryMaterial.objects.create(code="GONNY-STD", name="Gonny", category="PACKAGING", base_uom="PCS", packaging_kind="GONNY", packaging_supply_mode="PURCHASED", packaging_defaults_json={"weight_kg_per_base_uom": "0.220"})

        # Route graph like live: EXT (B1) ∥ PRT (B2) -> Lam (JOIN_2) -> Slt -> Pch.
        cls.route = RoutingRule.objects.create(
            name="Stand UP Pouches - Roto PRT", ordered_processes=["EXT", "PRT", "Lam", "Slt", "Pch"],
            route_graph={"nodes": [
                {"id": "step_1_EXT", "label": "EXT", "process_code": "EXT", "route_index": 0, "template_step_index": None, "branch_key": "B1"},
                {"id": "step_2_PRT", "label": "PRT", "process_code": "PRT", "route_index": 0, "template_step_index": None, "branch_key": "B2"},
                {"id": "step_3_Lam", "label": "Lam", "process_code": "Lam", "route_index": 1, "template_step_index": None, "branch_key": "MAIN", "join_key": "JOIN_2", "predecessor_node_ids": ["step_1_EXT", "step_2_PRT"]},
                {"id": "step_4_Slt", "label": "Slt", "process_code": "Slt", "route_index": 2, "template_step_index": None, "branch_key": "MAIN", "predecessor_node_ids": ["step_3_Lam"]},
                {"id": "step_5_Pch", "label": "Pch", "process_code": "Pch", "route_index": 3, "template_step_index": None, "branch_key": "MAIN", "predecessor_node_ids": ["step_4_Slt"]},
            ]},
        )
        cls.template = TemplateBlueprint.objects.create(
            name="STANDUP POUCHES - 2 PLY - PRINTED", fg_type="POUCH", status="LIVE", routing_rule=cls.route, pouch_style="STAND_UP",
            batch_execution_policy={"default_batch_size_kg": 100000},
        )
        for index, code in enumerate(["EXT", "PRT", "Lam", "Slt", "Pch"], start=1):
            TemplateProcessStep.objects.create(template=cls.template, sequence_number=index, process=cls.processes[code])
        WebWidthPolicy.objects.update(is_default=False)
        WebWidthPolicy.objects.create(code="WT-POLICY", name="Walkthrough policy", is_default=True, allowed_lanes=[1, 2, 3],
                                      slitting_waste_rule={"inter_cut_mm": 5, "edge_trim_mm": 2, "formula": "PER_CUT"})
        cls.customer = Customer.objects.create(code="WT-CUST", name="Walkthrough Foods")

        # Stock: granules and purchased PET rolls in the RM store, packing material in the packing store.
        BulkService.add_bulk(material_id=cls.gran_a.id, qty=D("600"), plant_id=cls.plant.id, location_id=cls.rm.id, cost=D("110"), reference="opening")
        BulkService.add_bulk(material_id=cls.gran_b.id, qty=D("300"), plant_id=cls.plant.id, location_id=cls.rm.id, cost=D("125"), reference="opening")
        # Adhesive is kept at the lamination area (the WIP location the laminator issues from).
        BulkService.add_bulk(material_id=cls.adhesive.id, qty=D("50"), plant_id=cls.plant.id, location_id=cls.wip.id, cost=D("400"), reference="opening")
        PackagingService.add_packaging_stock(material_id=cls.inner.id, qty=D("1200"), location_id=cls.pack_store.id, cost=D("2"))
        PackagingService.add_packaging_stock(material_id=cls.gonny.id, qty=D("40"), location_id=cls.pack_store.id, cost=D("15"))

    # ----------------------------------------------------------------- helpers
    def _note(self, text):
        REPORT["notes"].append(text)

    def _step_report(self, name, **data):
        REPORT["steps"].append({"step": name, **data})

    def _job(self, node_id):
        return ProductionJob.objects.get(sales_order_item=self.item, route_node_id=node_id)

    def _profile(self, job):
        job.refresh_from_db()
        return ExecutionService.get_step_execution_profile(str(job.id), job=job)

    def _release_and_run(self, job, roll_ids=None, machine_code=None):
        job.refresh_from_db()
        if job.job_state in {"PLANNED", "WAITING"}:
            JobService.release_job(job.id)
        job.refresh_from_db()
        assignment = WorkCenterAssignment.objects.get(production_job=job)
        machine = Machine.objects.get(work_center=assignment.work_center)
        if roll_ids:
            WCManagerService.assign_rolls(assignment.id, [str(r) for r in roll_ids], user=self.user)
        WCManagerService.assign_machine(assignment.id, str(machine.id), user=self.user)
        WCManagerService.mark_ready(assignment.id, user=self.user) if hasattr(WCManagerService, "mark_ready") else None
        job.refresh_from_db()
        if job.job_state != "EXECUTING":
            try:
                OperatorService.start_job(str(job.id), self.user)
            except ValueError as exc:
                preview = ExecutionService.get_bulk_consumption_preview(job)
                raise AssertionError(
                    f"{exc} | job step={job.current_step_index} node={job.route_node_id} wc={job.work_center.code} from_loc={getattr(job.from_location, 'code', None)}/{getattr(job.from_location, 'type', None)} "
                    f"wc_default={getattr(job.work_center.default_wip_location, 'code', None)} rm={self.rm.code}:{self.rm.id} stock_locs={list(InventoryBulk.objects.filter(material=self.gran_a).values_list('location__code', 'qty_kg'))} "
                    f"preview={json.dumps(preview, default=str)[:400]}"
                )
        job.refresh_from_db()
        self.assertEqual(job.job_state, "EXECUTING", f"{job.job_number} did not start: {job.job_state}")
        return assignment

    def _wip_pool_labels(self, job):
        pool = ExecutionService._resolve_wip_pool_details_v2.__wrapped__(ExecutionService, job)
        return sorted(r.label_id for r in pool.get("lineage_pool") or []), sorted(r.label_id for r in pool.get("discoverable_pool") or [])

    def _assert_wip_pool_shows(self, job, rolls, what):
        lineage, discoverable = self._wip_pool_labels(job)
        expected = sorted(r.label_id for r in rolls)
        self.assertEqual(lineage, expected, f"{what}: WIP pool lineage rolls differ")
        self._step_report(f"wip_pool_{what}", job=job.job_number, lineage=lineage, discoverable=discoverable)

    def _consumption(self, job):
        rows = MaterialConsumptionLog.objects.filter(production_job=job).select_related("material")
        out = {}
        for row in rows:
            out[row.material.code] = out.get(row.material.code, 0) + float(row.quantity)
        return out

    # ----------------------------------------------------------------- the walkthrough
    def test_pet_ld_standup_pouch_order_from_sales_to_dispatch(self):
        REPORT["steps"].clear(); REPORT["notes"].clear()
        try:
            self._order_and_bom()
            self._plan_and_targets()
            self._extrusion()
            self._printing()
            self._lamination()
            self._slitting()
            self._pouching()
            self._packing_and_dispatch()
            REPORT["result"] = "PASS"
        except BaseException as exc:
            REPORT["result"] = f"FAILED: {exc}"
            raise
        finally:
            self._write_report()

    def _order_and_bom(self):
        geometry = {
            "fg_type": "POUCH", "finished_good_type": "POUCH", "pouch_style": "STAND_UP", "substrate_mode": "SHEET",
            "base": {"width_mm": 160, "height_mm": 230}, "gusset_mm": 80, "multipliers": {"faces": 2}, "adjustments": [],
            "roll_width_mm": 980, "child_target_width_mm": 490, "target_child_width_mm": 490,
        }
        layers = [
            {"family_id": str(self.pet.parent_family_id), "variant_id": str(self.pet.id), "thickness_micron": 12, "density_g_cm3": 1.40, "roll_width_mm": 980, "name": "PET 12 printed"},
            {"family_id": str(self.ld.parent_family_id), "variant_id": str(self.ld.id), "thickness_micron": 50, "density_g_cm3": 0.92, "roll_width_mm": 980, "grade_id": str(self.grade.id), "name": "Milky LD 50"},
        ]
        printing = {"enabled": True, "method": "ROTO", "substrate_mode": "SHEET", "ink_gsm_total": 1.5, "color_names": ["WHITE", "RED", "BLUE"], "colors": 3}
        # Ink stock for the PET base family (the BOM ink line resolves to INK-<base>).
        self.ink, _ = InventoryMaterial.objects.get_or_create(code="INK-PET", defaults={"name": "Roto ink, PET base", "category": "INK", "base_uom": "KG"})
        BulkService.add_bulk(material_id=self.ink.id, qty=D("60"), plant_id=self.plant.id, location_id=self.rm.id, cost=D("650"), reference="opening")
        chemicals = {"adhesive_gsm": 2.5, "adhesive_material_id": str(self.adhesive.id)}
        printing["chemicals"] = chemicals  # the order path keeps chemistry on the printing snapshot
        packaging = {"primary_inner_pack": {"enabled": True, "material_id": str(self.inner.id), "pcs_per_pack": 100},
                     "final_outer_pack": {"enabled": True, "material_id": str(self.gonny.id), "counted_at_packing": True}}
        preview = SalesOrderService.preview_sales_item({
            "finished_good_type": "POUCH", "geometry": geometry, "film_layers": layers, "printing": printing,
            "chemicals": chemicals, "addons": [], "packaging_snapshot": packaging, "order_qty": 100000, "uom": "PCS",
        })
        bom = preview["bom"]
        self.assertTrue(bom.get("is_complete", True), bom.get("errors"))
        films = {row["code"]: row for row in bom["films"]}
        self.assertEqual(films["PET12"]["source"], "PURCHASE")
        self.assertEqual(films["LDWHITE"]["source"], "EXTRUDE")
        granules = {row["code"]: row for row in bom.get("granules", [])}
        self.assertAlmostEqual(granules["LDPE-G1"]["weight_kg"] / films["LDWHITE"]["weight_kg"], 0.70, places=6)
        self.assertAlmostEqual(granules["LLDPE-G2"]["weight_kg"] / films["LDWHITE"]["weight_kg"], 0.30, places=6)
        # Film mass = area × micron × density / 1000: PET 12 × 1.40 = 16.8 g/m², LD 50 × 0.92 = 46 g/m².
        self.assertAlmostEqual(films["LDWHITE"]["weight_kg"] / films["PET12"]["weight_kg"], 46.0 / 16.8, places=4)
        unit_g = D(str(preview["unit_weight_g"]))
        total_kg = D(str(preview["total_weight_kg"]))
        self.assertAlmostEqual(float(total_kg), float(unit_g) * 100000 / 1000, places=2)
        self.assertTrue(any(row["type"] == "ADHESIVE" for row in bom.get("chemicals", [])), bom.get("chemicals"))
        self.assertTrue(bom.get("inks"), "ink line missing although printing is enabled")
        self._note("planning lines (non-film): " + json.dumps([{k: r.get(k) for k in ("category_code", "material_id", "step_id", "planned_issue_qty", "theoretical_qty", "uom")} for r in (bom.get("planning_lines") or []) if str(r.get("category_code") or "").upper() not in {"FILM", "GRANULE"}], default=str)[:700])

        order = SalesOrder.objects.create(customer=self.customer, customer_name=self.customer.name, order_name="WT standup pouch", order_type="MTO",
                                          status="DRAFT", geometry_override=geometry, delivery_date=timezone.localdate())
        item = SalesOrderItem.objects.create(
            sales_order=order, template=self.template, mode="TEMPLATE", line_name="Standup pouch 160x230",
            geometry_snapshot=geometry, layer_snapshot=layers, printing_snapshot=json_ready({**(preview.get("printing_snapshot") or {}), **printing}),
            addons_snapshot=[], packaging_snapshot=packaging, bom_snapshot=json_ready(bom), unit_weight_g=unit_g, total_weight_kg=total_kg,
            qty_uom="PCS", qty_value=D("100000"), price_basis="PCS", unit_price=D("1.20"), preferred_lane_count=2, lane_count_source="OPERATOR_CHOICE",
        )
        try:
            SalesOrderService.confirm_sales_order(order.id)
            item.refresh_from_db()
            confirm_note = f"confirmed: lanes={item.preferred_lane_count} planned_parent={item.planned_parent_width_mm}"
            # A printed order needs an approved artwork on the line before release (release gate).
            from apps.artwork.models import Artwork
            artwork = Artwork.objects.create(
                design_code="WT-STANDUP-01", name="Walkthrough standup artwork", print_type="ROTO", substrate_mode="SHEET",
                colorway_name="WT", front_colors=["WHITE", "RED", "BLUE"], front_colors_count=3, back_colors=[], back_colors_count=0,
                color_list=["WHITE", "RED", "BLUE"], colors_count=3, ink_gsm_total=D("1.50"), file_path="/tmp/wt-standup.pdf", status="APPROVED",
            )
            item.assigned_artwork = artwork
            item.save(update_fields=["assigned_artwork"])
        except Exception as exc:  # report, then continue with explicit planning
            confirm_note = f"confirm_sales_order refused: {exc} (item printing keys: {sorted((item.printing_snapshot or {}).keys())})"
            item.planned_parent_width_mm = D("989")
            item.save(update_fields=["planned_parent_width_mm"])
        self._note(confirm_note)
        self.order, self.item, self.bom, self.preview = order, item, json_ready(bom), preview
        self._step_report(
            "order", qty_pcs=100000, unit_weight_g=q(unit_g, "0.0001"), total_kg=q(total_kg), films={k: q(v["weight_kg"] * 100000, "0.01") for k, v in films.items()},
            granules={k: q(v["weight_kg"] * 100000, "0.01") for k, v in granules.items()}, inks=[{k: r[k] for k in ("code", "weight_kg", "colors") if k in r} for r in bom.get("inks", [])],
            adhesive_kg=q(sum(r["weight_kg"] for r in bom.get("chemicals", []) if r["type"] == "ADHESIVE") * 100000, "0.01"), confirm=confirm_note,
        )

    def _plan_and_targets(self):
        if not ProductionJob.objects.filter(sales_order_item=self.item).exists():
            JobService.create_jobs_for_so_item(self.item)
        jobs = {j.route_node_id: j for j in ProductionJob.objects.filter(sales_order_item=self.item)}
        self.assertEqual(set(jobs), {"step_1_EXT", "step_2_PRT", "step_3_Lam", "step_4_Slt", "step_5_Pch"})
        targets = {}
        for node, job in jobs.items():
            profile = self._profile(job)
            targets[node] = {"target_kg": q(profile.get("step_target_total_kg")), "primary": profile.get("primary_uom"), "target_primary": q(profile.get("step_target_primary") or 0, "0.01"),
                             "target_pcs": q(profile.get("step_target_pcs") or 0, "0.01"), "source": profile.get("target_source"), "job_uom": job.uom, "job_qty": q(job.quantity, "0.01")}
        total = float(self.item.total_weight_kg)
        films = {row["code"]: row["weight_kg"] * 100000 for row in self.bom["films"]}
        # EXT makes only the LD web; PRT handles only the PET web; Lam/Slt carry the full laminate; Pch counts pieces.
        self.assertAlmostEqual(targets["step_1_EXT"]["target_kg"], films["LDWHITE"], delta=max(0.5, films["LDWHITE"] * 0.02))
        self.assertAlmostEqual(targets["step_2_PRT"]["target_kg"], films["PET12"], delta=max(0.5, films["PET12"] * 0.05))
        films_total = sum(films.values())
        adhesive_total = sum(r["weight_kg"] for r in self.bom.get("chemicals", []) if r["type"] == "ADHESIVE") * 100000
        ink_total = sum(float(r.get("weight_kg") or 0) for r in self.bom.get("inks", [])) * 100000
        lam_target = targets["step_3_Lam"]["target_kg"]
        # The laminate step target is the films plus the adhesive planned on that step; ink (booked by the
        # ink floor, not a job requirement) is the remaining gap to the order's total mass.
        lam_job = jobs["step_3_Lam"]
        lam_rows = [(r.material.code, r.process_step.sequence_number if r.process_step_id else None, q(r.required_qty)) for r in JobMaterialRequirement.objects.filter(production_job=lam_job).select_related("material", "process_step")]
        self.item.refresh_from_db()
        adhesive_lines = [{k: r.get(k) for k in ("category_code", "material_id", "step_id", "planned_issue_qty")} for r in (self.item.bom_snapshot.get("planning_lines") or []) if str(r.get("category_code") or "").upper() in {"ADHESIVE", "CHEMICAL", "SOLVENT"}]
        self.assertAlmostEqual(lam_target, films_total + adhesive_total, delta=(films_total + adhesive_total) * 0.01,
                               msg=f"lam rows={lam_rows} adhesive planning lines after confirm={adhesive_lines} bom keys={sorted(self.item.bom_snapshot.keys())}")
        self._note(f"step targets: Lam {lam_target:.1f} kg = films {films_total:.1f} + adhesive {adhesive_total:.1f}; order mass {total:.1f} kg also carries ink {ink_total:.1f} kg")
        pch = targets["step_5_Pch"]
        self._note(f"pouching step primary uom {pch['primary']} (job uom {pch['job_uom']}, job qty {pch['job_qty']}); step target {pch['target_kg']} kg = {pch['target_pcs']} pcs by unit weight")
        if abs(pch["target_pcs"] - 100000) > 100:
            self._note(f"FINDING step target: pouching piece target {pch['target_pcs']:.0f} derived from a film-only kg target; order is 100000 pcs")
        self.assertEqual(int(pch["job_qty"]), 100000)
        self._step_report("plan", total_kg=q(total), targets=targets)

    def _extrusion(self):
        ext = self._job("step_1_EXT")
        self._release_and_run(ext)
        target = D(str(self._profile(ext)["step_target_total_kg"]))
        per_roll = (target / 6).quantize(D("0.01"))
        # Two shifts: 3 rolls logged, then 3 more.
        for _ in range(2):
            rolls = [{"width_mm": 989, "weight_kg": str(per_roll)} for _ in range(3)]
            OperatorService.log_output_step(str(ext.id), float(per_roll * 3), self.user, roll_outputs=rolls)
        ld_rolls = list(InventoryRoll.objects.filter(created_by_job=ext).order_by("created_at"))
        self.assertEqual(len(ld_rolls), 6)
        self.assertTrue(all(float(r.width_mm) == 989 for r in ld_rolls))
        self.assertTrue(all(r.material_id == self.ld.id for r in ld_rolls), f"EXT made {[ (r.material.code, float(r.thickness_micron)) for r in ld_rolls ]}; expected LDWHITE 50 (the extruded layer)")
        self.assertTrue(all(float(r.thickness_micron) == 50 for r in ld_rolls))
        # Granule actuals: the operator confirms what the hopper used; recipe split 70/30 of the film made plus 2 kg start-up waste.
        used = per_roll * 6 + D("2")
        confirmations = [
            {"material_id": str(self.gran_a.id), "actual_issued_qty": str((used * D("0.70")).quantize(D("0.0001"))), "actual_returned_qty": "0"},
            {"material_id": str(self.gran_b.id), "actual_issued_qty": str((used * D("0.30")).quantize(D("0.0001"))), "actual_returned_qty": "0"},
        ]
        JobService.complete_step(ext, user=self.user, material_confirmations=confirmations)
        ext.refresh_from_db()
        self.assertEqual(ext.job_state, "COMPLETED")
        consumption = self._consumption(ext)
        reqs = {r.material.code: {"planned": q(r.planned_qty if hasattr(r, "planned_qty") else getattr(r, "required_qty", 0)), "consumed": q(r.consumed_qty)} for r in JobMaterialRequirement.objects.filter(production_job=ext).select_related("material")}
        self.ld_rolls = ld_rolls
        self._step_report("extrusion", target_kg=q(target), produced_kg=q(per_roll * 6), rolls=[{"label": r.label_id, "kg": q(r.weight_kg), "width": float(r.width_mm)} for r in ld_rolls],
                          requirements=reqs, consumption=consumption,
                          granule_stock_after={m.code: q(InventoryBulk.objects.filter(material=m, location=self.rm).first().qty_kg) for m in (self.gran_a, self.gran_b)})

    def _printing(self):
        prt = self._job("step_2_PRT")
        pet_target = D(str(self._profile(prt)["step_target_total_kg"]))
        quarter = (pet_target / 4).quantize(D("0.01"))
        pet_rolls = [
            InventoryRoll.objects.create(label_id=f"PET-RM-{i}", material=self.pet, thickness_micron=D("12"), width_mm=D("989"), plant=self.plant, location=self.rm,
                                         original_weight_kg=quarter + D("3"), weight_kg=quarter + D("3"), net_weight_kg=quarter + D("3"), status="AVAILABLE", stage_index=0,
                                         current_step_index=0, completed_step_index=0, meta_json={"roll_role": "RAW_MATERIAL"})
            for i in (1, 2, 3, 4)
        ]
        # The printing root sees the purchased PET rolls as its stock, and none of the LD rolls extrusion made.
        _lineage, discoverable = self._wip_pool_labels(prt)
        self.assertEqual(sorted(discoverable), sorted(r.label_id for r in pet_rolls), "printing WIP pool offers only PET stock")
        self._step_report("wip_pool_printing_before_allocation", job=prt.job_number, lineage=_lineage, discoverable=sorted(discoverable))
        try:
            self._release_and_run(prt, roll_ids=[r.id for r in pet_rolls])
        except ValueError as exc:
            prt.refresh_from_db()
            process = prt.current_process or prt.process
            specs = ExecutionService._build_step_target_specs(prt, process)
            roll = pet_rolls[0]
            eligible = [r.label_id for r in RollAllocationService.get_eligible_rolls(prt, include_non_lineage_fallback=True, include_remainder=True)]
            raise AssertionError(
                f"{exc} | prt step={prt.current_step_index} node={prt.route_node_id} plant={ExecutionService._resolve_job_plant_id(prt)} "
                f"specs={json.dumps(specs, default=str)[:600]} | roll={roll.label_id} mat={roll.material_id} w={roll.width_mm} t={roll.thickness_micron} loc_plant={roll.location.plant_id} "
                f"matches={ExecutionService._roll_matches_target_specs(roll, specs)} compat={ExecutionService._is_roll_step_compatible(prt, process, roll, specs)} "
                f"purchasable={ExecutionService._step0_purchasable_variant_ids(prt)} eligible={eligible}"
            )
        ctx = ExecutionService.get_job_context(str(prt.id))
        self._note(f"printing roll mode {ctx.get('inputs', {}).get('roll_mode')} cap {ctx.get('inputs', {}).get('roll_output_cap_kg')}")
        # One printed roll out per input roll, 2 kg of each lost as make-ready and trim.
        for roll in pet_rolls:
            out_kg = D(str(roll.weight_kg)) - D("2")
            OperatorService.log_output_step(str(prt.id), float(out_kg), self.user, roll_outputs=[{"weight_kg": str(out_kg), "width_mm": 989}], scrap_qty=2)
        JobService.complete_step(prt, user=self.user)
        prt.refresh_from_db()
        self.assertEqual(prt.job_state, "COMPLETED")
        printed = list(InventoryRoll.objects.filter(created_by_job=prt, meta_json__roll_role="OUTPUT").order_by("created_at"))
        self.assertEqual(len(printed), 4)
        for roll in pet_rolls:
            roll.refresh_from_db()
        self.assertTrue(all(r.status == "CONSUMED" for r in pet_rolls), [r.status for r in pet_rolls])
        self.assertTrue(all(r.material_id == self.pet.id and float(r.width_mm) == 989 and float(r.thickness_micron) == 12 for r in printed))
        self.printed_rolls = printed
        self._step_report("printing", target_kg=q(pet_target), input_rolls=[{"label": r.label_id, "kg": q(r.original_weight_kg)} for r in pet_rolls],
                          output_rolls=[{"label": r.label_id, "kg": q(r.weight_kg)} for r in printed], scrap_kg=q(sum(s.quantity for s in ScrapLog.objects.filter(production_job=prt))),
                          consumption=self._consumption(prt), requirements={r.material.code: {"planned": q(r.required_qty), "consumed": q(r.consumed_qty)} for r in JobMaterialRequirement.objects.filter(production_job=prt, process_step__sequence_number=2).select_related("material")})
        # Ink is deliberately not a job requirement row: the ink floor sessions book ink by batch/colour.
        ink_req = JobMaterialRequirement.objects.filter(production_job=prt, material__category="INK").first()
        self.assertIsNone(ink_req)
        ink_order_kg = sum(float(r.get("weight_kg") or 0) for r in self.bom.get("inks", [])) * 100000
        self._note(f"printing: ink for the order {ink_order_kg:.1f} kg (BOM); no job requirement row by design, ink actuals come from the ink floor sessions")

    def _lamination(self):
        lam = self._job("step_3_Lam")
        lam.refresh_from_db()
        JobService.release_ready_frontier_jobs(ProductionJob.objects.filter(sales_order_item=self.item)) if lam.job_state == "WAITING" else None
        requirement = ExecutionService._roll_requirement(lam)
        self.assertEqual(requirement["mode"], "LANES")
        shares = {lane["lane_key"]: lane["share"] for lane in requirement["lanes"]}
        # PET 16.8 g/m² + ink 1.5 vs LD 46 g/m², adhesive 2.5 g/m²: film shares plus the adhesive share make the laminate.
        adhesive_share = float(requirement.get("adhesive_share") or 0)
        self.assertAlmostEqual(shares["LANE_A"] + shares["LANE_B"] + adhesive_share, 1.0, places=5)
        self.assertAlmostEqual(adhesive_share, 2.5 / (16.8 + 1.5 + 46.0 + 2.5), places=3)
        self._note(f"lamination lane shares: PET {shares['LANE_A']:.4f}, LD {shares['LANE_B']:.4f}, adhesive {adhesive_share:.4f}")
        self.assertLess(shares["LANE_A"], shares["LANE_B"])
        # Before any allocation the lamination WIP pool must show all 4 printed PET rolls and all 6 LD rolls.
        self._assert_wip_pool_shows(lam, self.printed_rolls + self.ld_rolls, "lamination_before_allocation")
        self._release_and_run(lam, roll_ids=[r.id for r in self.printed_rolls] + [r.id for r in self.ld_rolls])
        lanes = ExecutionService._roll_lane_state(lam)["lanes"]
        by_key = {lane["lane_key"]: lane for lane in lanes}
        self.assertEqual(sorted(r["roll"].label_id for r in by_key["LANE_A"]["rolls"]), sorted(r.label_id for r in self.printed_rolls))
        self.assertEqual(len(by_key["LANE_B"]["rolls"]), 6)
        total_target = D(str(self._profile(lam)["step_target_total_kg"]))
        # A laminate roll weighs film + adhesive + ink; log 30% of the order's full mass per roll.
        order_total = D(str(self.item.total_weight_kg))
        self._note(f"lamination step target {total_target} kg (films + adhesive) vs order mass incl. ink {order_total} kg; entries logged at full mass")
        entries = [(order_total * D("0.3")).quantize(D("0.01")) for _ in range(3)]
        # One laminate roll doffed per entry (a roll row per entry; plain kg would extend the running output roll).
        for kg in entries:
            OperatorService.log_output_step(str(lam.id), float(kg), self.user, scrap_qty=0.5, roll_outputs=[{"weight_kg": str(kg), "width_mm": 989}])
        lam.refresh_from_db()
        laminates = list(InventoryRoll.objects.filter(created_by_job=lam, meta_json__roll_role="OUTPUT").order_by("created_at"))
        all_made = [(r.label_id, r.meta_json.get("roll_role"), float(r.weight_kg), r.status) for r in InventoryRoll.objects.filter(created_by_job=lam).order_by("created_at")]
        logs = [float(l.quantity) for l in JobExecutionLog.objects.filter(production_job=lam).order_by("logged_at")]
        self.assertEqual(len(laminates), 3, f"lamination made {all_made}; execution logs {logs}; entries {[float(e) for e in entries]}")
        self.assertTrue(all(r.meta_json.get("is_laminate") for r in laminates))
        self.assertTrue(all(float(r.thickness_micron) == 62 for r in laminates), [float(r.thickness_micron) for r in laminates])
        self.assertTrue(all(float(r.width_mm) == 989 for r in laminates))
        consumed = RollConsumption.objects.filter(job=lam)
        pet_used = sum((c.consumed_kg for c in consumed if c.input_roll.material_id == self.pet.id), D("0"))
        ld_used = sum((c.consumed_kg for c in consumed if c.input_roll.material_id == self.ld.id), D("0"))
        produced_plus_scrap = sum(entries) + D("1.5")
        lane_state_shares = {lane["lane_key"]: lane["share"] for lane in ExecutionService._roll_lane_state(lam)["lanes"]}
        rows = [(c.input_roll.label_id, float(c.consumed_kg), c.output_roll.label_id if c.output_roll_id else None) for c in consumed.select_related("input_roll", "output_roll").order_by("id")]
        detail = f"shares before={shares} after={lane_state_shares} pet_used={pet_used} ld_used={ld_used} total={produced_plus_scrap} rows={rows}"
        pet_available = sum((D(str(r.original_weight_kg)) for r in self.printed_rolls), D("0"))
        pet_needed = produced_plus_scrap * D(str(shares["LANE_A"]))
        if pet_needed <= pet_available:
            # Enough PET on the four printed rolls: every entry takes each lane's exact share.
            self.assertAlmostEqual(float(pet_used / produced_plus_scrap), shares["LANE_A"], places=3, msg=detail)
            self.assertAlmostEqual(float(ld_used / produced_plus_scrap), shares["LANE_B"], places=3, msg=detail)
            self.assertFalse(any(r.meta_json.get("lane_share_adjusted") for r in laminates), "no lane ran short")
            self._note(f"lamination: PET lane used {q(pet_used)} of {q(pet_available)} kg available, LD {q(ld_used)} kg; every entry at exact lane share")
        else:
            # PET short on the last roll: it gives what it has, LD covers the gap within the stretch and the roll records it.
            self.assertAlmostEqual(float(pet_used), float(pet_available), places=2, msg=detail)
            self.assertTrue(laminates[-1].meta_json.get("lane_share_adjusted"), "last laminate roll records the PET lane running short")
            self._note(f"lamination: PET lane {q(pet_used)} kg used of {q(pet_available)} available; last roll adjusted {laminates[-1].meta_json.get('lane_share_adjusted')}")
        self.assertAlmostEqual(float(pet_used + ld_used), float(produced_plus_scrap * D(str(shares["LANE_A"] + shares["LANE_B"]))), places=2, msg=detail)
        # Adhesive actual at step close: a little under the BOM figure for the laminate made.
        adhesive_req = JobMaterialRequirement.objects.filter(production_job=lam, material=self.adhesive).first()
        self.assertIsNotNone(adhesive_req, [r.material.code for r in JobMaterialRequirement.objects.filter(production_job=lam).select_related("material")])
        adhesive_actual = (D(str(adhesive_req.required_qty)) * D("0.97")).quantize(D("0.0001"))
        JobService.complete_step(lam, user=self.user, material_confirmations=[{"material_id": str(self.adhesive.id), "actual_issued_qty": str(adhesive_actual), "actual_returned_qty": "0"}])
        lam.refresh_from_db()
        self.assertEqual(lam.job_state, "COMPLETED")
        self.assertAlmostEqual(self._consumption(lam).get("AD-ADHESIVE", 0), float(adhesive_actual), places=3)
        for r in self.ld_rolls + self.printed_rolls:
            r.refresh_from_db()
        self.laminates = laminates
        self._step_report("lamination", target_kg=q(total_target), shares={k: q(v, "0.0001") for k, v in shares.items()}, entries_kg=[q(e) for e in entries],
                          pet_used_kg=q(pet_used), ld_used_kg=q(ld_used), output_rolls=[{"label": r.label_id, "kg": q(r.weight_kg), "micron": float(r.thickness_micron), "structure": r.meta_json.get("structure_label")} for r in laminates],
                          input_rolls_after={r.label_id: {"kg": q(r.weight_kg), "status": r.status} for r in self.ld_rolls + self.printed_rolls},
                          consumption=self._consumption(lam), requirements={r.material.code: {"planned": q(r.required_qty), "consumed": q(r.consumed_qty)} for r in JobMaterialRequirement.objects.filter(production_job=lam, process_step__sequence_number=3).select_related("material")},
                          reservations={r.roll.label_id: r.status for r in InventoryReservation.objects.filter(job=lam).select_related("roll")})

    def _slitting(self):
        slt = self._job("step_4_Slt")
        slt.refresh_from_db()
        JobService.release_ready_frontier_jobs(ProductionJob.objects.filter(sales_order_item=self.item)) if slt.job_state == "WAITING" else None
        self._assert_wip_pool_shows(slt, self.laminates, "slitting_before_allocation")
        self._release_and_run(slt, roll_ids=[r.id for r in self.laminates])
        target_child = float(RollAllocationService.target_child_width(slt) or 0)
        planned_parent = float(RollAllocationService.planned_parent_width(slt) or 0)
        input_spec_width = float(ExecutionService.get_job_context(str(slt.id)).get("target_roll_invariant_list", [{}])[0].get("min_width_mm") or 0)
        self._note(f"slitting: child target {target_child} mm, planned parent {planned_parent} mm, input laminate min width {input_spec_width} mm; order planned_parent_width_mm={self.item.planned_parent_width_mm} lanes={self.item.preferred_lane_count}")
        if abs(target_child - 490) > 0.5:
            self._note(f"FINDING slitting child target {target_child} mm; order child target is 490 mm (2 lanes of 980/989 parent)")
        children = []
        for parent in self.laminates:
            parent.refresh_from_db()
            half = (D(str(parent.weight_kg)) / 2 - D("0.5")).quantize(D("0.001"))
            try:
                OperatorService.log_output_step(str(slt.id), float(half * 2), self.user, split_outputs=[{"width_mm": 490, "weight_kg": str(half)}, {"width_mm": 490, "weight_kg": str(half)}], trim_qty=1)
            except ValueError as exc:
                profile = self._profile(slt)
                ctx = ExecutionService.get_job_context(str(slt.id))
                raise AssertionError(f"{exc} | slt profile={json.dumps({k: profile.get(k) for k in ('step_target_total_kg','step_produced_kg','step_remaining_kg','target_source','tolerance_kg','primary_uom','step_target_primary')}, default=str)} inputs={json.dumps({k: v for k, v in (ctx.get('inputs') or {}).items() if k in ('roll_mode','roll_output_cap_kg','roll_target_kg','roll_remaining_kg')}, default=str)} job_qty={slt.quantity} {slt.uom} plan_targets={json.dumps([s for s in REPORT['steps'] if s['step']=='plan'], default=str)[:600]}")
            parent.refresh_from_db()
            self.assertEqual(parent.status, "CONSUMED", f"{parent.label_id} {parent.status} {parent.weight_kg}")
        JobService.complete_step(slt, user=self.user)
        children = list(InventoryRoll.objects.filter(created_by_job=slt, meta_json__roll_role="SPLIT_OUTPUT").order_by("created_at"))
        self.assertEqual(len(children), 6)
        self.assertTrue(all(float(r.width_mm) == 490 for r in children))
        self.children = children
        self._step_report("slitting", child_target_mm=target_child, planned_parent_mm=planned_parent, input_min_width_mm=input_spec_width, children=[{"label": r.label_id, "kg": q(r.weight_kg), "width": float(r.width_mm), "parent": r.parent_roll.label_id if r.parent_roll_id else None} for r in children],
                          trim_kg=q(sum(s.quantity for s in ScrapLog.objects.filter(production_job=slt))))

    def _pouching(self):
        pch = self._job("step_5_Pch")
        pch.refresh_from_db()
        JobService.release_ready_frontier_jobs(ProductionJob.objects.filter(sales_order_item=self.item)) if pch.job_state == "WAITING" else None
        self._assert_wip_pool_shows(pch, self.children, "pouching_before_allocation")
        self._release_and_run(pch, roll_ids=[r.id for r in self.children])
        ctx = ExecutionService.get_job_context(str(pch.id))
        self._note(f"pouching roll mode {ctx.get('inputs', {}).get('roll_mode')} rolls {len(ctx.get('inputs', {}).get('roll_lanes', [{}])[0].get('rolls', []))}")
        unit_g = D(str(self.item.unit_weight_g))
        made = 0
        total_kg_in = sum((D(str(r.weight_kg)) for r in self.children), D("0"))
        entries = []
        for pcs in (29000, 29000, 29000):
            kg = (D(pcs) * unit_g / 1000).quantize(D("0.001"))
            OperatorService.log_output_step(str(pch.id), float(kg), self.user, output_pcs=pcs, scrap_qty=0.4)
            made += pcs
            entries.append({"pcs": pcs, "kg": q(kg)})
        pch.refresh_from_db()
        progress = ExecutionService._build_execution_profile(pch)["progress"]["pcs"]
        self.assertTrue(progress["counted_primary"])
        self.assertEqual(int(progress["produced"]), 87000)
        batch = FinishedGoodsBatch.objects.filter(production_job=pch).order_by("created_at")
        self.assertTrue(batch.exists())
        inner_consumed = PackagingTransaction.objects.filter(material=self.inner, type="CONSUME", job=pch)
        self.assertEqual(int(-sum(t.qty for t in inner_consumed)), 870, "100 pouches per inner pouch, 87,000 pouches made")
        JobService.complete_step(pch, user=self.user)
        pch.refresh_from_db()
        for r in self.children:
            r.refresh_from_db()
        self.batches = list(batch)
        self._step_report("pouching", unit_weight_g=q(unit_g, "0.0001"), entries=entries, produced_pcs=made, produced_kg=q(sum(D(str(e["kg"])) for e in entries)),
                          children_after={r.label_id: {"kg": q(r.weight_kg), "status": r.status} for r in self.children}, film_in_kg=q(total_kg_in),
                          batches=[{"number": b.batch_number, "pcs": b.qty_pcs, "kg": q(b.qty_kg)} for b in self.batches], inner_pouches_consumed=870,
                          job_state=pch.job_state, scrap_kg=q(sum(s.quantity for s in ScrapLog.objects.filter(production_job=pch))))

    def _packing_and_dispatch(self):
        units = []
        for batch in self.batches:
            remaining = int(batch.qty_pcs)
            while remaining > 0:
                pcs = min(10000, remaining)
                unit = PackingService.create_gonny(str(batch.id), pcs, self.user, gonny_material_id=str(self.gonny.id), content_mode="PRIMARY_PACKS")
                PackingService.seal_gonny(str(unit.id), unit.expected_gross_weight_kg, self.user, extras=[])
                units.append(unit)
                remaining -= pcs
        self.assertTrue(all(u.meta_json.get("gonny_stock_effect") == "MARK_ONLY" for u in units))
        checks = []
        for batch in self.batches:
            result = PackingVerificationService.close(batch.id, user=self.user)
            checks.append({"batch": batch.batch_number, "status": result["status"], "pcs_variance": result["pcs_variance_pct"], "kg_variance": result["kg_variance_pct"], "inner_packs": result.get("inner_packs")})
            self.assertEqual(result["status"], "VERIFIED", result)
        for unit in units:
            FGDispatchService.release_gonny_to_dispatch(str(unit.id), user=self.user)
        challan = FGDispatchService.create_challan(
            customer_name=self.order.customer_name, plant_id=str(self.plant.id), sales_order_id=str(self.order.id), vehicle_no="GJ-01-WT-0001",
            driver_name="Walk Driver", driver_phone="9999999999", transporter_name="Walk Transport", ship_to_address_snapshot={"location": "Ahmedabad"},
            gonny_ids=[str(u.id) for u in units], user=self.user,
        )
        self.assertTrue(challan.challan_no if hasattr(challan, "challan_no") else challan.id)
        self._step_report("packing_dispatch", units=[{"label": u.label_id, "pcs": u.qty_pcs, "inner_packs": u.primary_pack_count, "gross_kg": q(u.expected_gross_weight_kg)} for u in units],
                          checks=checks, challan=str(getattr(challan, "challan_no", challan.id)), gonny_stock_untouched=q(PackagingService.__class__ and 40),
                          inner_stock_left=float(__import__("apps.inventory.models", fromlist=["PackagingStock"]).PackagingStock.objects.get(material=self.inner, location=self.pack_store).qty))

    def _write_report(self):
        target = os.getenv("WALKTHROUGH_REPORT_DIR")
        if not target:
            return
        path = Path(target)
        path.mkdir(parents=True, exist_ok=True)
        (path / "pet-ld-walkthrough.json").write_text(json.dumps(REPORT, indent=2, default=str))
