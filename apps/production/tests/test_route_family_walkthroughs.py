"""
Route-family walkthroughs mirroring the other live templates (17 Oct 2026):

- PURCHASED_2PLY_PRINTED: PRT -> Lam -> Slt -> Pch  (both films bought; LD loaded raw at lamination)
- 3PLY_PRINTED:          EXT -> PRT -> Lam -> Lam -> Slt -> Pch  (second pass takes the first laminate + layer 3)
- PURCHASED_2PLY_PLAIN:  Lam -> Slt -> Pch  (lamination is the first step, both lanes raw)
- COURIER_BAG:           EXT -> SS  (bags straight from the extruded rolls, pieces counted)

Each run asserts the WIP pool before every roll step shows exactly the rolls the previous step
made (plus purchased stock where the route buys the film), that allocation and output logging
work without manual override, and that the finished pieces land in a batch.
"""
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase

from apps.factory.models import Machine, Plant, Process, WorkCenter, WorkCenterProcess
from apps.inventory.models import InventoryLocation, InventoryRoll
from apps.inventory.services.bulk_service import BulkService
from apps.materials.models import InventoryMaterial, WebWidthPolicy
from apps.production.models import FinishedGoodsBatch, ProductionJob, WorkCenterAssignment
from apps.production.services.job_services import JobService, WCManagerService
from apps.production.services.operator_service import OperatorService
from apps.production.services.roll_allocation_service import RollAllocationService
from apps.production.services.services_execution import ExecutionService
from apps.recipes.models import ExtrusionRecipe, ExtrusionRecipeComponent, RecipeGrade
from apps.routing.models import RoutingRule
from apps.sales.models import Customer, SalesOrder, SalesOrderItem
from apps.sales.services.order_service import SalesOrderService
from apps.templates.models import TemplateBlueprint, TemplateProcessStep

D = Decimal

PROCESS_DEFS = {
    "EXT": ("Extrusion", "BULK", "ROLL", "CREATE_NEW", {}),
    "PRT": ("Roto Printing", "ROLL", "ROLL", "MODIFY_EXISTING", {"has_artwork": True, "print_capable": True}),
    "Lam": ("Lamination", "ROLL", "ROLL", "MULTI_INPUT_COMBINE", {}),
    "Slt": ("Slitting", "ROLL", "ROLL", "SPLIT", {}),
    "Pch": ("Pouching", "ROLL", "BULK", "NONE", {}),
    "SS": ("Side Seal", "ROLL", "BULK", "NONE", {}),
}


def json_ready(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, dict):
        return {str(k): json_ready(v) for k, v in value.items()}
    if isinstance(value, list):
        return [json_ready(v) for v in value]
    return value


class RouteFamilyWalkthroughTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = get_user_model().objects.create(username="route-op", email="route-op@example.invalid", is_superuser=True)
        cls.plant = Plant.objects.create(code="RF", name="Route family plant")

        def system_location(kind, code, name):
            found = InventoryLocation.objects.filter(plant=cls.plant, type=kind).order_by("-is_system", "code").first()
            return found or InventoryLocation.objects.create(plant=cls.plant, code=code, name=name, type=kind, is_system=True)

        cls.rm = system_location("RM", "RM", "RM store")
        cls.wip = system_location("WIP", "WIP", "WIP")
        cls.fg = system_location("FG", "FG", "FG store")
        cls.processes = {}
        for code, (name, inp, out, beh, extra) in PROCESS_DEFS.items():
            process = Process.objects.create(code=code, name=name, input_form=inp, output_form=out, roll_behavior=beh, **extra)
            wc = WorkCenter.objects.create(plant=cls.plant, code=f"WC-{code}", name=f"{name} WC", default_wip_location=cls.rm if code == "EXT" else cls.wip)
            WorkCenterProcess.objects.create(work_center=wc, process=process)
            Machine.objects.create(work_center=wc, name=f"M-{code}", code=f"M{code}")
            cls.processes[code] = process
        pet_family = InventoryMaterial.objects.create(code="RF-PET-FAM", name="PET family", category="FILM_FAMILY", base_uom="KG", density_gcm3=D("1.40"))
        cls.pet = InventoryMaterial.objects.create(code="RF-PET12", name="PET 12", category="FILM_VARIANT", base_uom="KG", parent_family=pet_family, is_purchasable=True, is_extrudable=False)
        cls.metpet = InventoryMaterial.objects.create(code="RF-METPET12", name="Met PET 12", category="FILM_VARIANT", base_uom="KG", parent_family=pet_family, is_purchasable=True, is_extrudable=False)
        ld_family = InventoryMaterial.objects.create(code="RF-LD-FAM", name="LD family", category="FILM_FAMILY", base_uom="KG", density_gcm3=D("0.92"))
        cls.grade = RecipeGrade.objects.create(name="RF-FOOD", is_active=True)
        cls.ld = InventoryMaterial.objects.create(code="RF-LDWHITE", name="Milky LD", category="FILM_VARIANT", base_uom="KG", parent_family=ld_family, is_extrudable=True, is_purchasable=False, grade=cls.grade)
        cls.ld_bought = InventoryMaterial.objects.create(code="RF-LDBOUGHT", name="Bought LD", category="FILM_VARIANT", base_uom="KG", parent_family=ld_family, is_purchasable=True, is_extrudable=False)
        cls.gran = InventoryMaterial.objects.create(code="RF-LDPE", name="LDPE granule", category="GRANULE", base_uom="KG")
        recipe = ExtrusionRecipe.objects.create(film_variant=cls.ld, grade=cls.grade, thickness_min_micron=20, thickness_max_micron=120, is_active=True)
        ExtrusionRecipeComponent.objects.create(recipe=recipe, granule=cls.gran, percentage=100)
        cls.adhesive, _ = InventoryMaterial.objects.get_or_create(code="AD-ADHESIVE", defaults={"name": "Lamination adhesive", "category": "ADHESIVE", "base_uom": "KG"})
        cls.ink, _ = InventoryMaterial.objects.get_or_create(code="INK-PET", defaults={"name": "Roto ink, PET base", "category": "INK", "base_uom": "KG"})
        BulkService.add_bulk(material_id=cls.gran.id, qty=D("5000"), plant_id=cls.plant.id, location_id=cls.rm.id, cost=D("110"), reference="opening")
        # Adhesive is checked at the job's from-location: RM store for a route-root lamination, the WC's WIP otherwise.
        BulkService.add_bulk(material_id=cls.adhesive.id, qty=D("500"), plant_id=cls.plant.id, location_id=cls.wip.id, cost=D("400"), reference="opening")
        BulkService.add_bulk(material_id=cls.adhesive.id, qty=D("500"), plant_id=cls.plant.id, location_id=cls.rm.id, cost=D("400"), reference="opening")
        WebWidthPolicy.objects.update(is_default=False)
        WebWidthPolicy.objects.create(code="RF-POLICY", name="Route family policy", is_default=True, allowed_lanes=[1, 2, 3],
                                      slitting_waste_rule={"inter_cut_mm": 5, "edge_trim_mm": 2, "formula": "PER_CUT"})
        cls.customer = Customer.objects.create(code="RF-CUST", name="Route Family Foods")

    # ----------------------------------------------------------------- building blocks
    def _route(self, name, codes, parallel_roots=()):
        """Linear chain unless parallel_roots lists codes that feed the first join step."""
        nodes, edges = [], []
        prev = None
        for idx, code in enumerate(codes):
            node = {"id": f"step_{idx + 1}_{code}", "label": code, "process_code": code, "route_index": idx, "template_step_index": None, "branch_key": "MAIN"}
            nodes.append(node)
        if parallel_roots:
            root_ids = [n["id"] for n in nodes if n["process_code"] in parallel_roots and nodes.index(n) < len(parallel_roots)]
            join = next(n for n in nodes if n["id"] not in root_ids)
            for i, rid in enumerate(root_ids):
                nodes[i]["route_index"] = 0
                nodes[i]["branch_key"] = f"B{i + 1}"
            join["join_key"] = "JOIN"
            join["predecessor_node_ids"] = root_ids
            rest = [n for n in nodes if n["id"] not in root_ids]
            for k, node in enumerate(rest):
                node["route_index"] = k + 1
                if k > 0:
                    node["predecessor_node_ids"] = [rest[k - 1]["id"]]
        else:
            for k, node in enumerate(nodes):
                node["route_index"] = k
                if k > 0:
                    node["predecessor_node_ids"] = [nodes[k - 1]["id"]]
        rule = RoutingRule.objects.create(name=name, ordered_processes=list(codes), route_graph={"nodes": nodes})
        template = TemplateBlueprint.objects.create(name=name, fg_type="POUCH", status="LIVE", routing_rule=rule, pouch_style="THREE_SIDE_SEAL",
                                                    batch_execution_policy={"default_batch_size_kg": 100000})
        for index, code in enumerate(codes, start=1):
            TemplateProcessStep.objects.create(template=template, sequence_number=index, process=self.processes[code])
        return template

    def _order(self, template, layers, *, printed, qty=D("50000"), width=980, child=490):
        geometry = {"fg_type": "POUCH", "finished_good_type": "POUCH", "pouch_style": "THREE_SIDE_SEAL", "substrate_mode": "SHEET",
                    "base": {"width_mm": 150, "height_mm": 200}, "gusset_mm": 0, "multipliers": {"faces": 2}, "adjustments": [],
                    "roll_width_mm": width, "child_target_width_mm": child, "target_child_width_mm": child}
        printing = {"enabled": printed, "method": "ROTO", "substrate_mode": "SHEET", "ink_gsm_total": 1.5 if printed else 0, "color_names": ["RED", "BLUE"] if printed else [], "colors": 2 if printed else 0}
        chemicals = {"adhesive_gsm": 2.5, "adhesive_material_id": str(self.adhesive.id)} if len(layers) > 1 else {}
        if chemicals:
            printing["chemicals"] = chemicals
        preview = SalesOrderService.preview_sales_item({
            "finished_good_type": "POUCH", "geometry": geometry, "film_layers": layers, "printing": printing, "chemicals": chemicals,
            "addons": [], "packaging_snapshot": {}, "order_qty": int(qty), "uom": "PCS",
        })
        bom = preview["bom"]
        self.assertTrue(bom.get("is_complete", True), bom.get("errors"))
        order = SalesOrder.objects.create(customer=self.customer, customer_name=self.customer.name, order_name=template.name, order_type="MTO", status="DRAFT",
                                          geometry_override=geometry)
        item = SalesOrderItem.objects.create(
            sales_order=order, template=template, mode="TEMPLATE", line_name=template.name, geometry_snapshot=geometry, layer_snapshot=layers,
            printing_snapshot=json_ready({**(preview.get("printing_snapshot") or {}), **printing}), addons_snapshot=[], packaging_snapshot={},
            bom_snapshot=json_ready(bom), unit_weight_g=D(str(preview["unit_weight_g"])), total_weight_kg=D(str(preview["total_weight_kg"])),
            qty_uom="PCS", qty_value=qty, price_basis="PCS", unit_price=D("1"), preferred_lane_count=2, lane_count_source="OPERATOR_CHOICE",
        )
        SalesOrderService.confirm_sales_order(order.id)
        item.refresh_from_db()
        if printed:
            from apps.artwork.models import Artwork
            artwork = Artwork.objects.create(design_code=f"RF-{template.id.hex[:6]}", name="art", print_type="ROTO", substrate_mode="SHEET", colorway_name="RF",
                                             front_colors=["RED", "BLUE"], front_colors_count=2, back_colors=[], back_colors_count=0, color_list=["RED", "BLUE"],
                                             colors_count=2, ink_gsm_total=D("1.50"), file_path="/tmp/rf.pdf", status="APPROVED")
            item.assigned_artwork = artwork
            item.save(update_fields=["assigned_artwork"])
        if not ProductionJob.objects.filter(sales_order_item=item).exists():
            JobService.create_jobs_for_so_item(item)
        return item, {j.route_node_id: j for j in ProductionJob.objects.filter(sales_order_item=item)}

    def _layer(self, material, micron, density, width=980, grade=None):
        row = {"family_id": str(material.parent_family_id), "variant_id": str(material.id), "thickness_micron": micron, "density_g_cm3": density, "roll_width_mm": width, "name": material.name}
        if grade:
            row["grade_id"] = str(grade.id)
        return row

    def _raw_roll(self, material, micron, kg, label, width=989):
        return InventoryRoll.objects.create(label_id=label, material=material, thickness_micron=D(str(micron)), width_mm=D(str(width)), plant=self.plant, location=self.rm,
                                            original_weight_kg=D(str(kg)), weight_kg=D(str(kg)), net_weight_kg=D(str(kg)), status="AVAILABLE", stage_index=0,
                                            current_step_index=0, completed_step_index=0, meta_json={"roll_role": "RAW_MATERIAL"})

    def _pool(self, job):
        pool = ExecutionService._resolve_wip_pool_details_v2.__wrapped__(ExecutionService, job)
        return sorted(r.label_id for r in pool.get("discoverable_pool") or [])

    def _run(self, job, roll_ids=()):
        job.refresh_from_db()
        if job.job_state in {"PLANNED", "WAITING"}:
            JobService.release_job(job.id)
        job.refresh_from_db()
        assignment = WorkCenterAssignment.objects.get(production_job=job)
        machine = Machine.objects.get(work_center=assignment.work_center)
        if roll_ids:
            WCManagerService.assign_rolls(assignment.id, [str(r) for r in roll_ids], user=self.user)
        WCManagerService.assign_machine(assignment.id, str(machine.id), user=self.user)
        job.refresh_from_db()
        if job.job_state != "EXECUTING":
            OperatorService.start_job(str(job.id), self.user)
        job.refresh_from_db()
        self.assertEqual(job.job_state, "EXECUTING", job.job_number)

    def _outputs(self, job, role="OUTPUT"):
        return list(InventoryRoll.objects.filter(created_by_job=job, meta_json__roll_role=role).order_by("created_at"))

    def _target(self, job):
        job.refresh_from_db()
        return D(str(ExecutionService.get_step_execution_profile(str(job.id), job=job)["step_target_total_kg"]))

    def _extrude(self, job, rolls=4):
        self._run(job)
        per = (self._target(job) / rolls).quantize(D("0.01"))
        OperatorService.log_output_step(str(job.id), float(per * rolls), self.user, roll_outputs=[{"width_mm": 989, "weight_kg": str(per)} for _ in range(rolls)])
        JobService.complete_step(job, user=self.user, material_confirmations=[{"material_id": str(self.gran.id), "actual_issued_qty": str(per * rolls + 1), "actual_returned_qty": "0"}])
        return self._outputs(job)

    def _print(self, job, material, micron, rolls=2):
        target = self._target(job)
        inputs = [self._raw_roll(material, micron, (target / rolls).quantize(D("0.01")) + D("2"), f"RAW-{material.code}-{i}") for i in range(1, rolls + 1)]
        self.assertEqual(self._pool(job), sorted(r.label_id for r in inputs), "printing pool offers the purchased film only")
        self._run(job, roll_ids=[r.id for r in inputs])
        for roll in inputs:
            out = D(str(roll.weight_kg)) - D("1")
            OperatorService.log_output_step(str(job.id), float(out), self.user, roll_outputs=[{"weight_kg": str(out), "width_mm": 989}], scrap_qty=1)
        JobService.complete_step(job, user=self.user)
        return self._outputs(job)

    def _ready(self, job):
        job.refresh_from_db()
        if job.job_state == "WAITING":
            JobService.release_ready_frontier_jobs(ProductionJob.objects.filter(sales_order_item=job.sales_order_item))
            job.refresh_from_db()
        return job

    def _stock_for_lane(self, job, material, micron, rolls, label):
        """Purchased film loaded raw at a combine step: stock rolls sized to that lane's need.

        The lane coverage rule refuses stock rolls once a lane holds need + tolerance, so a
        store would issue roughly this much, not three oversized rolls."""
        self._ready(job)
        requirement = ExecutionService._roll_requirement(job)
        self.assertEqual(requirement["mode"], "LANES")
        lane = next(l for l in requirement["lanes"] if l.get("material_name") == material.name)
        per = (D(str(lane["need_kg"])) / rolls * D("1.02")).quantize(D("0.01"))
        return [self._raw_roll(material, micron, per, f"{label}-{i}") for i in range(1, rolls + 1)]

    def _laminate(self, job, lane_rolls, entries=2):
        self._ready(job)
        expected_pool = sorted(r.label_id for rolls in lane_rolls for r in rolls)
        self.assertEqual(self._pool(job), expected_pool, "lamination pool shows every lane's rolls")
        self._run(job, roll_ids=[r.id for rolls in lane_rolls for r in rolls])
        requirement = ExecutionService._roll_requirement(job)
        self.assertEqual(requirement["mode"], "LANES")
        # Each entry draws share × output from every lane, so the step can give at most
        # min(loaded / share) across lanes; run it close to the target like the floor would.
        def lane_loaded(lane):
            for rolls in lane_rolls:
                first = rolls[0]
                is_lam = bool((first.meta_json or {}).get("is_laminate"))
                if (lane.get("material_name") == "Laminate from earlier pass" and is_lam) or (not is_lam and lane.get("material_name") == first.material.name):
                    return sum((D(str(r.weight_kg)) for r in rolls), D("0"))
            self.fail(f"no rolls loaded for lane {lane}")
        capacity = min(lane_loaded(l) / D(str(l["share"])) for l in requirement["lanes"])
        total_out = min(capacity * D("0.98"), D(str(requirement["remaining_kg"])))
        per_entry = (total_out / entries).quantize(D("0.01"))
        for _ in range(entries):
            OperatorService.log_output_step(str(job.id), float(per_entry), self.user, roll_outputs=[{"weight_kg": str(per_entry), "width_mm": 989}])
        adhesive_req = job.material_requirements.filter(material=self.adhesive).first()
        confirmations = [{"material_id": str(self.adhesive.id), "actual_issued_qty": str(D(str(adhesive_req.required_qty)) * D("0.95")), "actual_returned_qty": "0"}] if adhesive_req else None
        JobService.complete_step(job, user=self.user, material_confirmations=confirmations)
        outs = self._outputs(job)
        self.assertEqual(len(outs), entries)
        self.assertTrue(all(r.meta_json.get("is_laminate") for r in outs))
        return outs

    def _slit(self, job, parents, child_width=490):
        job.refresh_from_db()
        if job.job_state == "WAITING":
            JobService.release_ready_frontier_jobs(ProductionJob.objects.filter(sales_order_item=job.sales_order_item))
        self.assertEqual(self._pool(job), sorted(r.label_id for r in parents), "slitting pool shows the laminate rolls")
        self.assertEqual(float(RollAllocationService.target_child_width(job)), float(child_width))
        self._run(job, roll_ids=[r.id for r in parents])
        for parent in parents:
            parent.refresh_from_db()
            half = (D(str(parent.weight_kg)) / 2 - D("0.5")).quantize(D("0.001"))
            OperatorService.log_output_step(str(job.id), float(half * 2), self.user, split_outputs=[{"width_mm": child_width, "weight_kg": str(half)}] * 2, trim_qty=1)
        JobService.complete_step(job, user=self.user)
        return self._outputs(job, role="SPLIT_OUTPUT")

    def _pouch(self, job, rolls, item):
        job.refresh_from_db()
        if job.job_state == "WAITING":
            JobService.release_ready_frontier_jobs(ProductionJob.objects.filter(sales_order_item=job.sales_order_item))
        self.assertEqual(self._pool(job), sorted(r.label_id for r in rolls), "pouching pool shows the rolls to run")
        self._run(job, roll_ids=[r.id for r in rolls])
        unit_g = D(str(item.unit_weight_g))
        film = sum((D(str(r.weight_kg)) for r in rolls), D("0"))
        # Count what the film allows, capped at the order quantity (whole thousands).
        pcs = int(min(film * D("0.98") * 1000 / unit_g, D(str(item.qty_value))) // 1000 * 1000)
        kg = (D(pcs) * unit_g / 1000).quantize(D("0.001"))
        OperatorService.log_output_step(str(job.id), float(kg), self.user, output_pcs=pcs, scrap_qty=0.5)
        JobService.complete_step(job, user=self.user)
        batch = FinishedGoodsBatch.objects.filter(production_job=job).first()
        self.assertIsNotNone(batch)
        self.assertEqual(int(batch.qty_pcs), pcs)
        return pcs

    # ----------------------------------------------------------------- the routes
    def test_purchased_two_ply_printed_pouch(self):
        template = self._route("2 PLY SHEET ROTO PRT", ["PRT", "Lam", "Slt", "Pch"])
        layers = [self._layer(self.pet, 12, 1.40), self._layer(self.ld_bought, 50, 0.92)]
        item, jobs = self._order(template, layers, printed=True)
        printed = self._print(jobs["step_1_PRT"], self.pet, 12, rolls=2)
        lam = jobs["step_2_Lam"]
        # The bought LD is loaded raw at lamination: stock rolls, no extrusion step.
        ld_rolls = self._stock_for_lane(lam, self.ld_bought, 50, 3, "RAW-LD")
        laminates = self._laminate(lam, [printed, ld_rolls], entries=2)
        children = self._slit(jobs["step_3_Slt"], laminates)
        self._pouch(jobs["step_4_Pch"], children, item)

    def test_three_ply_printed_two_lamination_passes(self):
        template = self._route("3 SIDE SEAL POUCH - 3 PLY - PRINTED", ["EXT", "PRT", "Lam", "Lam", "Slt", "Pch"], parallel_roots=("EXT", "PRT"))
        layers = [self._layer(self.pet, 12, 1.40), self._layer(self.metpet, 12, 1.40), self._layer(self.ld, 60, 0.92, grade=self.grade)]
        item, jobs = self._order(template, layers, printed=True)
        ld_rolls = self._extrude(jobs["step_1_EXT"], rolls=4)
        self.assertTrue(all(r.material_id == self.ld.id for r in ld_rolls), "extrusion makes the LD layer, not layer 1")
        printed = self._print(jobs["step_2_PRT"], self.pet, 12, rolls=2)
        first_lam = jobs["step_3_Lam"]
        met_rolls = self._stock_for_lane(first_lam, self.metpet, 12, 2, "RAW-MET")
        pass1 = self._laminate(first_lam, [printed, met_rolls], entries=2)
        second_lam = jobs["step_4_Lam"]
        pass2 = self._laminate(second_lam, [pass1, ld_rolls], entries=2)
        self.assertTrue(all(float(r.thickness_micron) == 84 for r in pass2), [float(r.thickness_micron) for r in pass2])
        children = self._slit(jobs["step_5_Slt"], pass2)
        self._pouch(jobs["step_6_Pch"], children, item)

    def test_purchased_two_ply_plain_lamination_first(self):
        template = self._route("3 SIDE SEAL POUCH - 2 PLY - PLAIN (PURCHASE)", ["Lam", "Slt", "Pch"])
        layers = [self._layer(self.pet, 12, 1.40), self._layer(self.ld_bought, 50, 0.92)]
        item, jobs = self._order(template, layers, printed=False)
        lam = jobs["step_1_Lam"]
        pet_rolls = self._stock_for_lane(lam, self.pet, 12, 2, "RAW-PET")
        ld_rolls = self._stock_for_lane(lam, self.ld_bought, 50, 3, "RAW-LD")
        laminates = self._laminate(jobs["step_1_Lam"], [pet_rolls, ld_rolls], entries=2)
        children = self._slit(jobs["step_2_Slt"], laminates)
        self._pouch(jobs["step_3_Pch"], children, item)

    def test_courier_bag_from_extruded_rolls(self):
        template = self._route("COURIER BAG PLN", ["EXT", "SS"])
        layers = [self._layer(self.ld, 60, 0.92, grade=self.grade)]
        item, jobs = self._order(template, layers, printed=False, qty=D("20000"), width=600, child=600)
        rolls = self._extrude(jobs["step_1_EXT"], rolls=3)
        self._pouch(jobs["step_2_SS"], rolls, item)
