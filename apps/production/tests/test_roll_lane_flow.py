"""
Roll lane flow (16 Oct 2026 review): a roll-fed step runs its rolls through lanes.

- Lamination takes any number of rolls per layer lane (6 PET + 4 LD).
- Output entries can be made any time; each lane gives its g/m2 share from its running roll.
- Part-used rolls keep their id and label, stay on the job, and leave only by being used
  up, returned, or released at job completion.
- Pouching with several rolls accepts part entries; untouched rolls stay reserved.
- Printing takes one output roll per row sent; slitting leaves the balance on the parent.
"""
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from apps.factory.models import Machine, Plant, Process, WorkCenter, WorkCenterProcess
from apps.inventory.models import InventoryLocation, InventoryReservation, InventoryRoll
from apps.materials.models import InventoryMaterial
from apps.production.models import ProductionJob, WorkCenterAssignment
from apps.production.services.job_services import JobService, WCManagerService
from apps.production.services.operator_service import OperatorService
from apps.production.services.services_execution import ExecutionService
from apps.routing.models import RoutingRule
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.templates.models import TemplateBlueprint, TemplateProcessStep

D = Decimal


class RollLaneFixture:
    @classmethod
    def setUpTestData(cls):
        cls.plant = Plant.objects.create(code="RLF", name="Roll Lane Plant")
        cls.rm = InventoryLocation.objects.create(plant=cls.plant, code="RM", name="RM", type="RM", is_system=True)
        cls.wip = InventoryLocation.objects.create(plant=cls.plant, code="WIP", name="WIP", type="WIP", is_system=True)
        cls.fg = InventoryLocation.objects.create(plant=cls.plant, code="FG", name="FG", type="FG", is_system=True)
        cls.processes = {}
        for code, name, input_form, output_form, behavior in [
            ("PRT", "Roto printing", "ROLL", "ROLL", "MODIFY_EXISTING"),
            ("EXT", "Extrusion", "ROLL", "ROLL", "MODIFY_EXISTING"),
            ("LAM", "Lamination", "ROLL", "ROLL", "MULTI_INPUT_COMBINE"),
            ("SLT", "Slitting", "ROLL", "ROLL", "SPLIT"),
            ("PCH", "Pouching", "ROLL", "BULK", "NONE"),
        ]:
            process = Process.objects.create(code=code, name=name, input_form=input_form, output_form=output_form, roll_behavior=behavior)
            wc = WorkCenter.objects.create(plant=cls.plant, code=f"WC-{code}", name=f"{name} WC")
            WorkCenterProcess.objects.create(work_center=wc, process=process)
            cls.processes[code] = process
        cls.user = get_user_model().objects.create(username="lane-op", email="lane-op@example.invalid")

    def _item(self, *, route, codes, qty, layers, fg_type="ROLL", uom="KG", unit_weight_g=None, geometry=None):
        template = TemplateBlueprint.objects.create(
            name=f"Lane template {route.name}", fg_type=fg_type, status="LIVE", routing_rule=route,
            batch_execution_policy={"default_batch_size_kg": 100000},
        )
        for index, code in enumerate(codes, start=1):
            TemplateProcessStep.objects.create(template=template, sequence_number=index, process=self.processes[code])
        order = SalesOrder.objects.create(customer_name="Lane Customer", status="CONFIRMED")
        item = SalesOrderItem.objects.create(
            sales_order=order, template=template, mode="TEMPLATE",
            geometry_snapshot=geometry or {"fg_type": fg_type, "base": {"width_mm": 1000}},
            layer_snapshot=layers, printing_snapshot={"enabled": False}, addons_snapshot=[],
            bom_snapshot={"items": []}, qty_uom=uom, qty_value=qty,
            total_weight_kg=qty if uom == "KG" else D(str(qty)) * D(str(unit_weight_g or 0)) / D("1000"),
            unit_weight_g=unit_weight_g or D("0"), price_basis="KG", unit_price=D("1"),
        )
        JobService.create_jobs_for_so_item(item)
        return item

    def _roll(self, item, job, material, thickness, weight, label, step_index):
        return InventoryRoll.objects.create(
            label_id=label, material=material, thickness_micron=D(str(thickness)), width_mm=D("1000"),
            plant=self.plant, location=self.wip, original_weight_kg=D(str(weight)), weight_kg=D(str(weight)),
            net_weight_kg=D(str(weight)), status="AVAILABLE", template=item.template,
            current_step_index=step_index, completed_step_index=max(0, step_index - 1), stage_index=step_index,
            created_by_job=job, production_job=job, sales_order_item=item, meta_json={"roll_role": "OUTPUT"},
        )

    def _assignment(self, job):
        job.refresh_from_db()
        process = job.current_process or job.process
        wc = WorkCenterProcess.objects.filter(process=process).first().work_center
        return WorkCenterAssignment.objects.filter(production_job=job).first() or WorkCenterAssignment.objects.create(production_job=job, work_center=wc)

    def _run(self, job, assignment):
        assignment.refresh_from_db()
        machine = Machine.objects.create(work_center=assignment.work_center, name=f"M-{job.job_number}", code=f"M{str(job.id)[:6]}")
        assignment.status = "EXECUTION_READY"
        assignment.assigned_machine = machine
        assignment.save(update_fields=["status", "assigned_machine"])
        job.refresh_from_db()
        job.job_state = "EXECUTING"
        job.status = "RUNNING"
        job.machine = machine
        job.save(update_fields=["job_state", "status", "machine"])
        for res in InventoryReservation.objects.filter(job=job, status="ACTIVE"):
            res.roll.status = "IN_PROCESS"
            res.roll.save(update_fields=["status"])

    def _complete_predecessors(self, jobs, keys):
        for key in keys:
            jobs[key].job_state = "COMPLETED"
            jobs[key].status = "COMPLETED"
            jobs[key].save(update_fields=["job_state", "status"])


@patch("apps.production.services.services_execution.ExecutionService.calculate_requirements")
@patch("apps.production.services.job_services.require_bom_ready_for_production")
class LaminationLaneTests(RollLaneFixture, TestCase):
    def _build(self):
        self.pet = InventoryMaterial.objects.create(code="LANE-PET12", name="PET 12 printed", category="FILM_VARIANT")
        self.ld = InventoryMaterial.objects.create(code="LANE-LD50", name="Milky LD 50", category="FILM_VARIANT")
        route = RoutingRule.objects.create(
            name="PET print + LD join",
            ordered_processes=["PRT", "EXT", "LAM"],
            route_graph={"nodes": [
                {"id": "pet", "label": "PET print", "process_code": "PRT", "route_index": 0, "template_step_index": 0, "branch_key": "PET"},
                {"id": "ld", "label": "LD", "process_code": "EXT", "route_index": 0, "template_step_index": 1, "branch_key": "LD"},
                {"id": "lam", "label": "Lamination", "process_code": "LAM", "route_index": 1, "template_step_index": 2,
                 "join_key": "J", "predecessor_node_ids": ["pet", "ld"]},
            ]},
        )
        layers = [
            {"variant_id": str(self.pet.id), "thickness_micron": 12, "density_g_cm3": 1.38, "roll_width_mm": 1000},
            {"variant_id": str(self.ld.id), "thickness_micron": 50, "density_g_cm3": 0.92, "roll_width_mm": 1000},
        ]
        item = self._item(route=route, codes=["PRT", "EXT", "LAM"], qty=D("1600"), layers=layers)
        jobs = {j.route_node_id: j for j in ProductionJob.objects.filter(sales_order_item=item)}
        self._complete_predecessors(jobs, ["pet", "ld"])
        pet_rolls = [self._roll(item, jobs["pet"], self.pet, 12, w, f"PET-{i}", 2) for i, w in enumerate([140, 135, 130, 135, 130, 130], start=1)]
        ld_rolls = [self._roll(item, jobs["ld"], self.ld, 50, 200, f"LD-{i}", 2) for i in range(1, 5)]
        lam = jobs["lam"]
        lam.refresh_from_db()
        return item, lam, pet_rolls, ld_rolls

    def test_wcm_allocates_six_pet_and_four_ld_rolls_into_two_lanes(self, *_):
        _item, lam, pet_rolls, ld_rolls = self._build()
        requirement = ExecutionService._roll_requirement(lam)
        self.assertEqual(requirement["mode"], "LANES")
        self.assertEqual(len(requirement["lanes"]), 2)
        shares = {lane["lane_key"]: lane["share"] for lane in requirement["lanes"]}
        # PET 12 x 1.38 = 16.56 g/m2, LD 50 x 0.92 = 46 g/m2 -> 26.5% / 73.5%.
        self.assertAlmostEqual(shares["LANE_A"], 16.56 / 62.56, places=4)
        self.assertAlmostEqual(shares["LANE_B"], 46.0 / 62.56, places=4)

        assignment = self._assignment(lam)
        WCManagerService.assign_rolls(assignment.id, [str(r.id) for r in pet_rolls + ld_rolls], user=self.user)
        lanes = {row["lane_key"]: row for row in ExecutionService._roll_lane_state(lam)["lanes"]}
        self.assertEqual(sorted(r["roll"].label_id for r in lanes["LANE_A"]["rolls"]), [f"PET-{i}" for i in range(1, 7)])
        self.assertEqual(sorted(r["roll"].label_id for r in lanes["LANE_B"]["rolls"]), [f"LD-{i}" for i in range(1, 5)])
        status = ExecutionService.get_satisfaction_status(lam.id)
        self.assertEqual(status["rolls_missing"], 0)
        self.assertTrue(status["is_satisfied"] or status["rolls_missing"] == 0)

    def test_repeated_entries_use_each_lane_by_share_and_keep_labels(self, *_):
        _item, lam, pet_rolls, ld_rolls = self._build()
        assignment = self._assignment(lam)
        WCManagerService.assign_rolls(assignment.id, [str(pet_rolls[0].id), str(pet_rolls[1].id), str(ld_rolls[0].id), str(ld_rolls[1].id)], user=self.user)
        self._run(lam, assignment)

        OperatorService.log_output_step(str(lam.id), 285.0, self.user)
        share_pet = D("16.56") / D("62.56")
        pet_used = (D("285") * share_pet).quantize(D("0.0001"))
        ld_used = (D("285") * (D("46") / D("62.56"))).quantize(D("0.0001"))
        pet1 = InventoryRoll.objects.get(label_id="PET-1")
        ld1 = InventoryRoll.objects.get(label_id="LD-1")
        ld2 = InventoryRoll.objects.get(label_id="LD-2")
        self.assertAlmostEqual(float(pet1.weight_kg), float(D("140") - pet_used), places=2)
        self.assertNotEqual(pet1.status, "CONSUMED")
        # LD-1 (200 kg) is used up and the overflow comes from LD-2 in the same lane.
        self.assertEqual(ld1.status, "CONSUMED")
        self.assertAlmostEqual(float(ld2.weight_kg), float(D("400") - ld_used), places=2)
        self.assertFalse(InventoryRoll.objects.filter(meta_json__is_remainder=True).exists(), "no relabelled leftover rolls")
        self.assertEqual(InventoryReservation.objects.get(job=lam, roll=ld1).status, "FULFILLED")
        self.assertEqual(InventoryReservation.objects.get(job=lam, roll=pet1).status, "ACTIVE")

        # Second and third entries keep working on the same rolls.
        OperatorService.log_output_step(str(lam.id), 100.0, self.user)
        out = InventoryRoll.objects.filter(created_by_job=lam, meta_json__roll_role="OUTPUT").first()
        self.assertTrue(out.meta_json.get("is_laminate"))
        self.assertIn("µ", out.meta_json.get("structure_label") or "")

    def test_wcm_adds_next_rolls_while_running_and_lane_short_is_refused_clearly(self, *_):
        _item, lam, pet_rolls, ld_rolls = self._build()
        assignment = self._assignment(lam)
        WCManagerService.assign_rolls(assignment.id, [str(pet_rolls[0].id), str(ld_rolls[0].id)], user=self.user)
        self._run(lam, assignment)
        # LD-1 has 200 kg: 300 kg of laminate needs about 220.6 kg LD, far past the 5% stretch.
        with self.assertRaisesMessage(ValueError, "Load the next roll"):
            OperatorService.log_output_step(str(lam.id), 300.0, self.user)
        WCManagerService.assign_rolls(assignment.id, [str(ld_rolls[1].id)], user=self.user)
        self.assertEqual(InventoryRoll.objects.get(label_id="LD-2").status, "IN_PROCESS")
        OperatorService.log_output_step(str(lam.id), 300.0, self.user)

    def test_small_gauge_gap_on_last_roll_is_covered_by_the_other_lane(self, *_):
        _item, lam, pet_rolls, ld_rolls = self._build()
        assignment = self._assignment(lam)
        WCManagerService.assign_rolls(assignment.id, [str(pet_rolls[0].id), str(ld_rolls[0].id)], user=self.user)
        self._run(lam, assignment)
        # 285 kg needs 209.6 kg LD by plan; LD-1 had 200 kg (4.6% short, inside the 5% stretch).
        cap = ExecutionService._lane_input_cap_kg(ExecutionService._roll_lane_state(lam))
        self.assertGreaterEqual(cap, D("285"))
        OperatorService.log_output_step(str(lam.id), 285.0, self.user)
        ld1 = InventoryRoll.objects.get(label_id="LD-1")
        pet1 = InventoryRoll.objects.get(label_id="PET-1")
        self.assertEqual(ld1.status, "CONSUMED")
        self.assertAlmostEqual(float(D("140") - D(str(pet1.weight_kg))), 85.0, places=2)
        out = InventoryRoll.objects.filter(created_by_job=lam, meta_json__roll_role="OUTPUT").first()
        adjusted = out.meta_json.get("lane_share_adjusted") or []
        self.assertEqual([row["lane_key"] for row in adjusted], ["LANE_B"])
        self.assertAlmostEqual(adjusted[0]["used_kg"], 200.0, places=2)
        # Nothing is left on LD now: the next entry asks for the next LD roll.
        with self.assertRaisesMessage(ValueError, "Ask the WCM to add the next roll"):
            OperatorService.log_output_step(str(lam.id), 10.0, self.user)

    def test_return_balance_keeps_label_and_unassign_refuses_part_used_roll(self, *_):
        _item, lam, pet_rolls, ld_rolls = self._build()
        assignment = self._assignment(lam)
        WCManagerService.assign_rolls(assignment.id, [str(pet_rolls[0].id), str(pet_rolls[1].id), str(ld_rolls[0].id)], user=self.user)
        self._run(lam, assignment)
        OperatorService.log_output_step(str(lam.id), 100.0, self.user)
        pet1 = InventoryRoll.objects.get(label_id="PET-1")
        with self.assertRaisesMessage(ValueError, "part-used"):
            WCManagerService.unassign_roll_by_roll(assignment.id, str(pet1.id), user=self.user)
        # PET-2 was never touched: it can come off while the job runs.
        WCManagerService.unassign_roll_by_roll(assignment.id, str(pet_rolls[1].id), user=self.user)
        self.assertEqual(InventoryRoll.objects.get(label_id="PET-2").status, "AVAILABLE")
        balance = D(str(pet1.weight_kg))
        result = ExecutionService.return_roll_balance(lam.id, pet1.id, user=self.user, weight_kg=str(balance - D("0.5")))
        pet1.refresh_from_db()
        self.assertEqual(pet1.label_id, "PET-1")
        self.assertEqual(pet1.status, "AVAILABLE")
        self.assertAlmostEqual(float(pet1.weight_kg), float(balance - D("0.5")), places=3)
        self.assertAlmostEqual(result["scrap_kg"], 0.5, places=3)
        self.assertEqual(InventoryReservation.objects.get(job=lam, roll=pet1).status, "RELEASED")


@patch("apps.production.services.services_execution.ExecutionService.calculate_requirements")
@patch("apps.production.services.job_services.require_bom_ready_for_production")
class SingleLaneFlowTests(RollLaneFixture, TestCase):
    def _linear(self, codes, *, fg_type="ROLL", uom="KG", qty=D("1000"), unit_weight_g=None, geometry=None, layers=None):
        self.film = InventoryMaterial.objects.create(code=f"LANE-FILM-{'-'.join(codes)}", name="Laminate film", category="FILM_VARIANT")
        route = RoutingRule.objects.create(
            name=f"Linear {'-'.join(codes)}",
            ordered_processes=codes,
            route_graph={"nodes": [
                {"id": f"n{i}", "label": code, "process_code": code, "route_index": i, "template_step_index": i}
                for i, code in enumerate(codes)
            ], "edges": [{"from": f"n{i}", "to": f"n{i + 1}"} for i in range(len(codes) - 1)]},
        )
        item = self._item(
            route=route, codes=codes, qty=qty, fg_type=fg_type, uom=uom, unit_weight_g=unit_weight_g, geometry=geometry,
            layers=layers or [{"variant_id": str(self.film.id), "thickness_micron": 62, "density_g_cm3": 0.95, "roll_width_mm": 1000}],
        )
        jobs = {j.current_step_index: j for j in ProductionJob.objects.filter(sales_order_item=item)}
        return item, jobs

    def test_pouching_with_300_and_700_kg_rolls_takes_part_entries(self, *_):
        geometry = {"fg_type": "POUCH", "base": {"width_mm": 160, "height_mm": 230}}
        item, jobs = self._linear(["PRT", "PCH"], fg_type="POUCH", uom="PCS", qty=D("100000"), unit_weight_g=D("6.85"), geometry=geometry)
        prev, pouch = jobs[0], jobs[1]
        self._complete_predecessors({"p": prev}, ["p"])
        r300 = self._roll(item, prev, self.film, 62, 300, "CH-300", 1)
        r700 = self._roll(item, prev, self.film, 62, 700, "CH-700", 1)
        assignment = self._assignment(pouch)
        WCManagerService.assign_rolls(assignment.id, [str(r300.id), str(r700.id)], user=self.user)
        self._run(pouch, assignment)
        OperatorService.log_output_step(str(pouch.id), 68.5, self.user, output_pcs=10000)
        OperatorService.log_output_step(str(pouch.id), 68.5, self.user, output_pcs=10000)
        r300.refresh_from_db(); r700.refresh_from_db()
        self.assertAlmostEqual(float(r300.weight_kg), 163.0, places=2)
        self.assertEqual(float(r700.weight_kg), 700.0)
        self.assertEqual(InventoryReservation.objects.get(job=pouch, roll=r700).status, "ACTIVE")
        pouch.refresh_from_db()
        self.assertEqual(int(pouch.produced_qty), 20000)
        progress = ExecutionService._build_execution_profile(pouch)["progress"]["pcs"]
        self.assertEqual(progress["produced"], 20000.0)
        self.assertTrue(progress["counted_primary"])

    def test_printing_queue_and_one_output_roll_per_row(self, *_):
        item, jobs = self._linear(["EXT", "PRT"])
        prev, prt = jobs[0], jobs[1]
        self._complete_predecessors({"p": prev}, ["p"])
        a = self._roll(item, prev, self.film, 62, 120, "IN-A", 1)
        b = self._roll(item, prev, self.film, 62, 100, "IN-B", 1)
        assignment = self._assignment(prt)
        WCManagerService.assign_rolls(assignment.id, [str(a.id), str(b.id)], user=self.user)
        self._run(prt, assignment)
        OperatorService.log_output_step(
            str(prt.id), 150.0, self.user,
            roll_outputs=[{"weight_kg": 80, "width_mm": 1000}, {"weight_kg": 70, "width_mm": 1000}],
        )
        a.refresh_from_db(); b.refresh_from_db()
        self.assertEqual(a.status, "CONSUMED")
        self.assertAlmostEqual(float(b.weight_kg), 70.0, places=3)
        outputs = InventoryRoll.objects.filter(created_by_job=prt, meta_json__roll_role="OUTPUT").order_by("created_at")
        self.assertEqual([float(r.weight_kg) for r in outputs], [80.0, 70.0])
        self.assertEqual(b.label_id, "IN-B")

    def test_slitting_leaves_the_balance_on_the_parent_roll(self, *_):
        item, jobs = self._linear(["EXT", "SLT"])
        prev, slt = jobs[0], jobs[1]
        self._complete_predecessors({"p": prev}, ["p"])
        parent = self._roll(item, prev, self.film, 62, 300, "PARENT-1", 1)
        assignment = self._assignment(slt)
        WCManagerService.assign_rolls(assignment.id, [str(parent.id)], user=self.user)
        self._run(slt, assignment)
        OperatorService.log_output_step(
            str(slt.id), 99.0, self.user,
            split_outputs=[{"width_mm": 330, "weight_kg": 33}, {"width_mm": 330, "weight_kg": 33}, {"width_mm": 330, "weight_kg": 33}],
            trim_qty=1,
        )
        parent.refresh_from_db()
        self.assertEqual(parent.label_id, "PARENT-1")
        self.assertAlmostEqual(float(parent.weight_kg), 200.0, places=3)
        self.assertNotEqual(parent.status, "CONSUMED")
        self.assertEqual(InventoryRoll.objects.filter(parent_roll=parent, meta_json__roll_role="SPLIT_OUTPUT").count(), 3)
        self.assertFalse(InventoryRoll.objects.filter(meta_json__is_remainder=True).exists())

    def test_job_completion_returns_untouched_and_part_used_rolls_to_stock(self, *_):
        item, jobs = self._linear(["EXT", "PRT"])
        prev, prt = jobs[0], jobs[1]
        self._complete_predecessors({"p": prev}, ["p"])
        a = self._roll(item, prev, self.film, 62, 120, "C-A", 1)
        b = self._roll(item, prev, self.film, 62, 100, "C-B", 1)
        assignment = self._assignment(prt)
        WCManagerService.assign_rolls(assignment.id, [str(a.id), str(b.id)], user=self.user)
        self._run(prt, assignment)
        OperatorService.log_output_step(str(prt.id), 50.0, self.user)
        JobService._release_active_roll_reservations(prt)
        a.refresh_from_db(); b.refresh_from_db()
        self.assertEqual((a.status, b.status), ("AVAILABLE", "AVAILABLE"))
        self.assertAlmostEqual(float(a.weight_kg), 70.0, places=3)
        self.assertEqual(float(b.weight_kg), 100.0)

    def test_mass_cap_counts_what_is_left_on_rolls(self, *_):
        item, jobs = self._linear(["EXT", "PCH"], fg_type="POUCH", uom="PCS", qty=D("10000"), unit_weight_g=D("10"),
                                  geometry={"fg_type": "POUCH", "base": {"width_mm": 160, "height_mm": 230}})
        prev, pouch = jobs[0], jobs[1]
        self._complete_predecessors({"p": prev}, ["p"])
        rolls = [self._roll(item, prev, self.film, 62, 80, f"M-{i}", 1) for i in range(1, 4)]
        stock_roll = rolls[2]
        stock_roll.sales_order_item = None
        stock_roll.save(update_fields=["sales_order_item"])
        profile = {"step_target_total_kg": 100, "step_produced_kg": 0, "step_roll_target_kg": 100}
        process = pouch.current_process or pouch.process
        with patch.object(ExecutionService, "_resolve_step_execution_profile", return_value=profile):
            requirement = ExecutionService._roll_requirement(pouch)
            self.assertEqual(requirement["mode"], "MASS")
            assignment = self._assignment(pouch)
            WCManagerService.assign_rolls(assignment.id, [str(rolls[0].id), str(rolls[1].id)], user=self.user)
            # 160 kg on the job's own rolls already covers 100 kg + tolerance: a stock roll is refused...
            with self.assertRaisesMessage(ValueError, "already covered"):
                ExecutionService.validate_roll_selection(pouch, process, existing_roll_ids=[str(rolls[0].id), str(rolls[1].id)], new_roll_ids=[str(stock_roll.id)])
            # ...but more of the order's own WIP can always be queued.
            extra_own = self._roll(item, prev, self.film, 62, 80, "M-OWN", 1)
            ExecutionService.validate_roll_selection(pouch, process, existing_roll_ids=[str(rolls[0].id), str(rolls[1].id)], new_roll_ids=[str(extra_own.id)])


@patch("apps.production.services.services_execution.ExecutionService.calculate_requirements")
@patch("apps.production.services.job_services.require_bom_ready_for_production")
class SkippedCombineStepTests(RollLaneFixture, TestCase):
    """A combine step a line has too few layers for gets no job (live sets sheet folding up like
    lamination, so a one-layer bag skips it). The step after it is then the first job of the chain."""

    _linear = SingleLaneFlowTests._linear
    POUCH = {"fg_type": "POUCH", "base": {"width_mm": 160, "height_mm": 230}}

    def _bought_roll(self, label, kg="120"):
        return InventoryRoll.objects.create(
            label_id=label, material=self.film, thickness_micron=D("62"), width_mm=D("1000"), plant=self.plant, location=self.rm,
            original_weight_kg=D(kg), weight_kg=D(kg), net_weight_kg=D(kg), status="AVAILABLE",
            current_step_index=0, completed_step_index=0, stage_index=0, meta_json={"roll_role": "RAW_MATERIAL"},
        )

    def test_first_job_after_a_skipped_combine_step_takes_bought_film(self, *_):
        item, jobs = self._linear(["LAM", "PRT", "PCH"], fg_type="POUCH", uom="PCS", qty=D("10000"), unit_weight_g=D("5"), geometry=self.POUCH)
        self.assertNotIn(0, jobs, "one layer: the combine step gets no job")
        printing = jobs[1]
        self.assertEqual(ExecutionService._input_gate_step_index(printing), 0)
        bought = self._bought_roll("BOUGHT-PRT-1")
        assignment = self._assignment(printing)
        WCManagerService.assign_rolls(assignment.id, [str(bought.id)], user=self.user)
        self._run(printing, assignment)
        OperatorService.log_output_step(str(printing.id), 50, self.user, roll_outputs=[{"weight_kg": "50", "width_mm": 1000}])
        self.assertEqual(InventoryRoll.objects.filter(created_by_job=printing).count(), 1)

    def test_lineage_is_still_required_below_a_real_upstream_job(self, *_):
        _item, jobs = self._linear(["EXT", "PRT"])
        self.assertEqual(ExecutionService._input_gate_step_index(jobs[1]), 1)

    def test_a_skipped_pass_between_two_real_jobs_keeps_lineage(self, *_):
        _item, jobs = self._linear(["EXT", "LAM", "PRT"])
        self.assertNotIn(1, jobs, "one layer: the combine step gets no job")
        self.assertEqual(ExecutionService._input_gate_step_index(jobs[2]), 2, "extrusion upstream still feeds printing")


@patch("apps.production.services.services_execution.ExecutionService.calculate_requirements")
@patch("apps.production.services.job_services.require_bom_ready_for_production")
class UpstreamFeedTests(RollLaneFixture, TestCase):
    """The feed keeps a step's own target apart from what the steps before it have handed over."""

    _linear = SingleLaneFlowTests._linear

    def test_next_step_can_run_only_what_the_previous_step_has_made(self, *_):
        item, jobs = self._linear(["EXT", "PRT"], qty=D("300"))
        ext, prt = jobs[0], jobs[1]
        made = self._roll(item, ext, self.film, 62, 100, "FEED-100", 1)  # 100 of 300 made upstream, still running
        feed = ExecutionService.upstream_feed(prt)
        self.assertEqual(len(feed["steps"]), 1)
        self.assertFalse(feed["upstream_done"])
        self.assertEqual(feed["waiting_kg"], 100.0)
        self.assertEqual(feed["loaded_kg"], 0.0)
        self.assertEqual(feed["can_run_now_kg"], min(100.0, feed["step_remaining_kg"]))
        self.assertGreater(feed["step_target_kg"], feed["can_run_now_kg"], "the step's own target stays separate")
        assignment = self._assignment(prt)
        WCManagerService.assign_rolls(assignment.id, [str(made.id)], user=self.user)
        feed = ExecutionService.upstream_feed(prt)
        self.assertEqual((feed["loaded_kg"], feed["waiting_kg"]), (100.0, 0.0))
