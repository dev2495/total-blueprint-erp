"""Folding as a route step (2 Nov 2026).

EXT -> FOLD -> SS for a courier bag made on J-folded film: the line needs FOLDED_WEB 300 mm with a
20 mm flap and 10 mm fold trim, so the open web is 2 x 300 + 20 + 10 = 630 mm.

- Extrusion (before the fold) makes open rolls, not "folded" ones.
- The fold step takes open rolls on a 630 mm web and puts out folded 300 mm rolls carrying the flap.
- Side sealing (after the fold) takes the folded rolls.
- A line whose form is open passes through the same fold step unchanged.
"""
from decimal import Decimal

from apps.factory.models import Machine, Process, WorkCenter, WorkCenterProcess
from apps.inventory.models import InventoryRoll
from apps.production.services.operator_service import OperatorService
from apps.production.services.roll_allocation_service import RollAllocationService
from apps.production.services.services_execution import ExecutionService
from apps.production.services.stock_form_resolver import StockFormResolver
from apps.production.services.job_services import JobService
from apps.production.tests import test_route_family_walkthroughs as walkthroughs

D = Decimal
FOLD = {"flap_mm": 20, "seal_mm": 0, "trim_mm": 10}


class FoldRouteTests(walkthroughs.RouteFamilyWalkthroughTests):
    test_purchased_two_ply_printed_pouch = None
    test_three_ply_printed_two_lamination_passes = None
    test_purchased_two_ply_plain_lamination_first = None
    test_courier_bag_from_extruded_rolls = None

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        process = Process.objects.create(
            code="FOLD", name="Folding", input_form="ROLL", output_form="ROLL", roll_behavior="MODIFY_EXISTING",
            allowed_input_stock_forms=["OPEN_WEB"], allowed_output_stock_forms=["OPEN_WEB", "FOLDED_WEB", "LAYFLAT_TUBE"],
            stock_form_output_mode="TARGET_DECIDES",
        )
        wc = WorkCenter.objects.create(plant=cls.plant, code="WC-FOLD", name="Folding WC", default_wip_location=cls.wip)
        WorkCenterProcess.objects.create(work_center=wc, process=process)
        Machine.objects.create(work_center=wc, name="M-FOLD", code="MFOLD")
        cls.processes["FOLD"] = process
        # Live masters: "Sheet Seal" folds and seals the printed sheet into a tube; gusseting and bottom
        # sealing take tubes only (diaper bags EXT -> PRT -> Sheet Seal -> GZT -> Bottom).
        extra = {
            "SEAL": ("Sheet Sealing", "MODIFY_EXISTING", "ROLL", ["OPEN_WEB"], ["OPEN_WEB", "FOLDED_WEB", "LAYFLAT_TUBE"], "TARGET_DECIDES"),
            "GZT": ("Gazzeting", "MODIFY_EXISTING", "ROLL", ["LAYFLAT_TUBE"], ["LAYFLAT_TUBE"], "PRESERVE"),
            "Bottom": ("Bottom Sealing", "NONE", "BULK", ["LAYFLAT_TUBE"], ["LAYFLAT_TUBE"], "PRESERVE"),
        }
        for code, (name, behavior, out, ins, outs, mode) in extra.items():
            proc = Process.objects.create(code=code, name=name, input_form="ROLL", output_form=out, roll_behavior=behavior,
                                          allowed_input_stock_forms=ins, allowed_output_stock_forms=outs, stock_form_output_mode=mode)
            wc = WorkCenter.objects.create(plant=cls.plant, code=f"WC-{code}", name=f"{name} WC", default_wip_location=cls.wip)
            WorkCenterProcess.objects.create(work_center=wc, process=proc)
            Machine.objects.create(work_center=wc, name=f"M-{code}", code=f"M{code}")
            cls.processes[code] = proc

    def _fold_order(self, *, stock_form="FOLDED_WEB", width=300):
        template = self._route(f"COURIER BAG FOLD {stock_form}", ["EXT", "FOLD", "SS"])
        layers = [self._layer(self.ld, 60, 0.92, width=width, grade=self.grade)]
        item, jobs = self._order(template, layers, printed=False, qty=D("20000"), width=width, child=width)
        geometry = dict(item.geometry_snapshot)
        geometry.update({"stock_form": stock_form, "width_basis": "FOLDED_WIDTH" if stock_form == "FOLDED_WEB" else "OPEN_WEB_WIDTH"})
        if stock_form == "FOLDED_WEB":
            geometry["fold"] = FOLD
        item.geometry_snapshot = geometry
        # One lane: the fixture plans 2-up, which would make the parent web 2W + trim.
        item.preferred_lane_count = 1
        item.planned_parent_width_mm = D(str(width))
        item.save(update_fields=["geometry_snapshot", "preferred_lane_count", "planned_parent_width_mm"])
        return item, jobs

    def _step(self, job):
        job.refresh_from_db()
        self._ready(job)
        job.refresh_from_db()
        return job

    def test_fold_step_turns_open_rolls_into_folded_rolls_with_flap(self):
        item, jobs = self._fold_order()
        ext, fold, ss = jobs["step_1_EXT"], jobs["step_2_FOLD"], jobs["step_3_SS"]

        # 1. Extrusion runs before the fold: its contract is the open 630 mm web, its rolls are open.
        ext.refresh_from_db()
        steps = StockFormResolver.for_job_step(ext)
        self.assertEqual((steps.input.stock_form, steps.output.stock_form), ("OPEN_WEB", "OPEN_WEB"))
        self.assertEqual(steps.output.width_mm, D("630.00"))
        self._run(ext)
        per = (self._target(ext) / 2).quantize(D("0.01"))
        OperatorService.log_output_step(str(ext.id), float(per * 2), self.user, roll_outputs=[{"width_mm": 640, "weight_kg": str(per)} for _ in range(2)])
        JobService.complete_step(ext, user=self.user, material_confirmations=[{"material_id": str(self.gran.id), "actual_issued_qty": str(per * 2 + 1), "actual_returned_qty": "0"}])
        extruded = self._outputs(ext)
        self.assertEqual({r.stock_form for r in extruded}, {"OPEN_WEB"}, "extrusion before the fold makes open rolls")

        # 2. The fold step takes the open rolls on the 630 mm web and puts out the line's folded form.
        fold = self._step(fold)
        steps = StockFormResolver.for_job_step(fold)
        self.assertEqual((steps.input.stock_form, steps.output.stock_form), ("OPEN_WEB", "FOLDED_WEB"))
        self.assertEqual(RollAllocationService.planned_parent_width(fold), D("630.00"))
        specs = ExecutionService._build_step_target_specs.__wrapped__(ExecutionService, fold)
        self.assertTrue(specs and all(s["stock_form"] == "OPEN_WEB" and float(s["min_width_mm"]) == 630.0 for s in specs), specs)
        contract = RollAllocationService.target_stock_contract(fold)
        self.assertEqual((contract["stock_form"], contract["output_stock_form"]), ("OPEN_WEB", "FOLDED_WEB"))
        self.assertEqual(self._pool(fold), sorted(r.label_id for r in extruded))
        self._run(fold, roll_ids=[r.id for r in extruded])
        context = ExecutionService.get_job_context(str(fold.id))
        step_form = context["step_form_contract"]
        self.assertTrue(step_form["converts"])
        self.assertEqual((step_form["input"]["stock_form"], step_form["output"]["stock_form"]), ("OPEN_WEB", "FOLDED_WEB"))
        self.assertEqual(D(step_form["output"]["width_mm"]), D("300"))
        # As the operator screen sends it: the first roll with the open width typed by habit and the
        # open form, the second with the folded width the screen fills in. Both must come out folded 300.
        typed = [{"width_mm": 640, "stock_form": "OPEN_WEB"}, {"width_mm": 300, "stock_form": "FOLDED_WEB"}]
        for roll, row in zip(extruded, typed):
            roll.refresh_from_db()
            out = D(str(roll.weight_kg)) - D("0.5")
            OperatorService.log_output_step(str(fold.id), float(out), self.user, roll_outputs=[{"weight_kg": str(out), **row}], scrap_qty=0.5)
        JobService.complete_step(fold, user=self.user)
        folded = self._outputs(fold)
        self.assertTrue(folded)
        for roll in folded:
            self.assertEqual((roll.stock_form, roll.width_basis, roll.width_mm), ("FOLDED_WEB", "FOLDED_WIDTH", D("300.00")))
            meta = roll.meta_json["fold"]
            self.assertEqual((meta["flap_mm"], meta["trim_mm"], meta["open_width_mm"], meta["edge_trim_mm"]), (20.0, 10.0, 630.0, 10.0))

        # 3. Side sealing comes after the fold: it takes folded 300 mm rolls.
        ss = self._step(ss)
        steps = StockFormResolver.for_job_step(ss)
        self.assertEqual((steps.input.stock_form, steps.output.stock_form), ("FOLDED_WEB", "FOLDED_WEB"))
        self.assertEqual(RollAllocationService.planned_parent_width(ss), D("300"))
        self._pouch(ss, [InventoryRoll.objects.get(id=r.id) for r in folded], item)

    def test_fold_step_refuses_an_open_roll_too_narrow_for_the_flap(self):
        item, jobs = self._fold_order()
        fold = jobs["step_2_FOLD"]
        fold.refresh_from_db()
        narrow = self._raw_roll(self.ld, 60, 50, "FOLD-NARROW", width=580)
        with self.assertRaisesMessage(ValueError, "needs 630 mm"):
            ExecutionService._form_change_output(fold, narrow, "FOLDED_WEB")

    def test_open_line_passes_through_the_fold_step_unchanged(self):
        item, jobs = self._fold_order(stock_form="OPEN_WEB", width=600)
        for key in ("step_1_EXT", "step_2_FOLD", "step_3_SS"):
            job = jobs[key]
            job.refresh_from_db()
            steps = StockFormResolver.for_job_step(job)
            self.assertIsNone(steps.fold_step_index)
            self.assertEqual((steps.input.stock_form, steps.output.stock_form), ("OPEN_WEB", "OPEN_WEB"))
        fold = jobs["step_2_FOLD"]
        fold.refresh_from_db()
        self.assertEqual(ExecutionService._run_web_width(fold, fold.current_process, 600), 600)

    def test_fold_and_seal_line_outputs_a_tube(self):
        item, jobs = self._fold_order(stock_form="LAYFLAT_TUBE", width=250)
        geometry = dict(item.geometry_snapshot)
        geometry["fold"] = {"flap_mm": 0, "seal_mm": 8, "trim_mm": 4}
        item.geometry_snapshot = geometry
        item.save(update_fields=["geometry_snapshot"])
        fold = jobs["step_2_FOLD"]
        fold.refresh_from_db()
        steps = StockFormResolver.for_job_step(fold)
        self.assertEqual((steps.input.stock_form, steps.output.stock_form), ("OPEN_WEB", "LAYFLAT_TUBE"))
        self.assertEqual(steps.input.width_mm, D("512.00"))
        open_roll = self._raw_roll(self.ld, 60, 50, "FOLD-TUBE-IN", width=520)
        width, meta = ExecutionService._form_change_output(fold, open_roll, "LAYFLAT_TUBE")
        self.assertEqual(width, D("250"))
        self.assertEqual((meta["seal_mm"], meta["open_width_mm"], meta["edge_trim_mm"]), (8.0, 512.0, 8.0))

    def test_two_lane_parent_web_grows_by_the_fold_per_lane(self):
        item, jobs = self._fold_order()
        item.preferred_lane_count = 2
        item.planned_parent_width_mm = D("609")  # 2 x 300 + 9 trim
        item.save(update_fields=["preferred_lane_count", "planned_parent_width_mm"])
        ext = jobs["step_1_EXT"]
        ext.refresh_from_db()
        # 2 x 630 + 9: each lane is open web ahead of the fold.
        self.assertEqual(ExecutionService._run_web_width(ext, ext.current_process, 300), 1269.0)

    def test_operator_may_fold_narrower_with_more_edge_trim(self):
        item, jobs = self._fold_order()
        fold = jobs["step_2_FOLD"]
        fold.refresh_from_db()
        open_roll = self._raw_roll(self.ld, 60, 50, "FOLD-NARROWER", width=640)
        width, meta = ExecutionService._form_change_output(fold, open_roll, "FOLDED_WEB")
        self.assertEqual(width, D("300"))
        # 290 typed: 2 x 290 + 20 + 10 = 610 fits the 640 roll, so it is a real fold (30 mm edge trim).
        from apps.materials.stock_forms import open_width_for
        self.assertLessEqual(open_width_for("FOLDED_WEB", 290, meta), D("640"))

    def test_sheet_seal_route_runs_open_until_the_seal_then_tube(self):
        template = self._route("DIAPER BAGS SHEET SEAL", ["EXT", "PRT", "SEAL", "GZT", "Bottom"])
        layers = [self._layer(self.ld, 60, 0.92, width=250, grade=self.grade)]
        item, jobs = self._order(template, layers, printed=True, qty=D("20000"), width=250, child=250)
        geometry = dict(item.geometry_snapshot)
        geometry.update({"stock_form": "LAYFLAT_TUBE", "width_basis": "LAYFLAT_WIDTH", "fold": {"seal_mm": 8, "trim_mm": 4}})
        item.geometry_snapshot = geometry
        item.preferred_lane_count = 1
        item.planned_parent_width_mm = D("250")
        item.save(update_fields=["geometry_snapshot", "preferred_lane_count", "planned_parent_width_mm"])
        expected = {
            "step_1_EXT": ("OPEN_WEB", "OPEN_WEB"),
            "step_2_PRT": ("OPEN_WEB", "OPEN_WEB"),
            "step_3_SEAL": ("OPEN_WEB", "LAYFLAT_TUBE"),
            "step_4_GZT": ("LAYFLAT_TUBE", "LAYFLAT_TUBE"),
            "step_5_Bottom": ("LAYFLAT_TUBE", "LAYFLAT_TUBE"),
        }
        for key, forms in expected.items():
            job = jobs[key]
            job.refresh_from_db()
            steps = StockFormResolver.for_job_step(job)
            self.assertEqual((steps.input.stock_form, steps.output.stock_form), forms, key)
        prt = jobs["step_2_PRT"]
        prt.refresh_from_db()
        self.assertEqual(RollAllocationService.planned_parent_width(prt), D("512.00"), "printing runs the 2 x 250 + 8 + 4 open web")
        # A printed open roll at the seal step outputs a tube; gusseting then accepts it.
        printed = self._raw_roll(self.ld, 60, 40, "DIAPER-PRINTED", width=512)
        seal = jobs["step_3_SEAL"]
        seal.refresh_from_db()
        width, meta = ExecutionService._form_change_output(seal, printed, "LAYFLAT_TUBE")
        self.assertEqual((width, meta["seal_mm"], meta["open_width_mm"]), (D("250"), 8.0, 512.0))
        self.assertTrue(StockFormResolver.process_accepts_input(self.processes["GZT"], "LAYFLAT_TUBE"))
