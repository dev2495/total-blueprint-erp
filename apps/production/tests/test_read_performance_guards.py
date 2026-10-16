"""
Read-path performance guards (16 Oct 2026, "request took too long" on the floor terminals).

- Pure read computations (job context, WIP pool, eligible rolls) run once per GET request.
- Writes are never served from the memo.
- The SQL candidate pre-filter only removes rolls the Python compatibility check rejects,
  so eligible rolls and WIP pools are identical with and without it.
"""
from decimal import Decimal
from unittest.mock import patch

from django.db.models import Q
from django.test import TestCase, RequestFactory

from apps.inventory.models import InventoryRoll
from apps.production.models import ProductionJob
from apps.production.services.job_services import WCManagerService
from apps.production.services.roll_allocation_service import RollAllocationService
from apps.production.services.services_execution import ExecutionService
from apps.production.tests import test_roll_lane_flow as lane_tests
from apps.production.tests.test_roll_lane_flow import RollLaneFixture
from config.request_context import arm_request_memo, disarm_request_memo, request_memo
from config.request_context_middleware import RequestContextMiddleware

D = Decimal


class RequestMemoTests(TestCase):
    def test_memo_only_runs_inside_an_armed_read_request(self):
        calls = []

        def build():
            calls.append(1)
            return {"n": len(calls)}

        disarm_request_memo()
        self.assertEqual(request_memo(("k",), build)["n"], 1)
        self.assertEqual(request_memo(("k",), build)["n"], 2, "no memo outside a request")
        arm_request_memo()
        try:
            self.assertEqual(request_memo(("k",), build)["n"], 3)
            self.assertEqual(request_memo(("k",), build)["n"], 3, "same key served once per request")
            self.assertEqual(request_memo(("other",), build)["n"], 4)
        finally:
            disarm_request_memo()

    def test_middleware_arms_memo_for_get_and_not_for_post(self):
        seen = {}

        def view(request):
            seen[request.method] = request_memo(("probe",), lambda: object())
            seen[request.method + "-again"] = request_memo(("probe",), lambda: object())
            from django.http import HttpResponse
            return HttpResponse("ok")

        middleware = RequestContextMiddleware(view)
        factory = RequestFactory()
        middleware(factory.get("/api/production/wc/x/stats/"))
        middleware(factory.post("/api/production/wc/x/ready/"))
        self.assertIs(seen["GET"], seen["GET-again"])
        self.assertIsNot(seen["POST"], seen["POST-again"])
        # Nothing leaks past the request.
        self.assertIsNot(request_memo(("probe",), lambda: object()), request_memo(("probe",), lambda: object()))


@patch("apps.production.services.services_execution.ExecutionService.calculate_requirements")
@patch("apps.production.services.job_services.require_bom_ready_for_production")
class CandidatePrefilterEquivalenceTests(RollLaneFixture, TestCase):
    """Lamination (lanes, mixed stock) and pouching (roll to bulk) with raw rolls in the plant."""

    _build = lane_tests.LaminationLaneTests._build
    _linear = lane_tests.SingleLaneFlowTests._linear

    def _pools(self, job):
        proc = job.current_process or job.process
        eligible = set(str(r.id) for r in RollAllocationService._get_eligible_rolls(job, include_non_lineage_fallback=True, include_remainder=True))
        pool = ExecutionService._resolve_wip_pool_details_v2.__wrapped__(ExecutionService, job)
        return eligible, set(str(r.id) for r in pool["discoverable_pool"]), set(str(r.id) for r in pool["lineage_pool"])

    def _assert_same_with_and_without_prefilter(self, jobs):
        with_filter = {str(j.id): self._pools(j) for j in jobs}
        with patch.object(ExecutionService, "_roll_candidate_prefilter", classmethod(lambda cls, job, process, *, strict, step0_variant_gate=False: Q())):
            without = {str(j.id): self._pools(j) for j in jobs}
        self.assertEqual(with_filter, without)
        return with_filter

    def test_lamination_and_raw_stock_rolls_resolve_identically(self, *_):
        _item, lam, pet_rolls, ld_rolls = self._build()
        # Raw purchased film of both layers plus an unrelated film, all in the plant.
        other = __import__("apps.materials.models", fromlist=["InventoryMaterial"]).InventoryMaterial.objects.create(code="LANE-OTHER", name="Other film", category="FILM_VARIANT")
        for i in range(12):
            for mat, thick in ((self.pet, 12), (self.ld, 50), (other, 30)):
                InventoryRoll.objects.create(
                    label_id=f"RAW-{mat.code}-{i}", material=mat, thickness_micron=D(str(thick)), width_mm=D("1000"), plant=self.plant,
                    location=self.rm, original_weight_kg=D("200"), weight_kg=D("200"), net_weight_kg=D("200"), status="AVAILABLE",
                    stage_index=0, current_step_index=0, completed_step_index=0, meta_json={"roll_role": "RAW_MATERIAL"} if i % 2 else {},
                )
        assignment = self._assignment(lam)
        WCManagerService.assign_rolls(assignment.id, [str(pet_rolls[0].id), str(ld_rolls[0].id)], user=self.user)
        result = self._assert_same_with_and_without_prefilter([lam])
        eligible, pool, lineage = result[str(lam.id)]
        self.assertTrue(lineage, "lineage rolls still found")
        self.assertFalse(any(InventoryRoll.objects.get(id=rid).material_id == other.id for rid in pool), "other film never offered")

    def test_pouching_from_printed_rolls_and_raw_stock_resolve_identically(self, *_):
        geometry = {"fg_type": "POUCH", "base": {"width_mm": 160, "height_mm": 230}}
        item, jobs = self._linear(["PRT", "PCH"], fg_type="POUCH", uom="PCS", qty=D("100000"), unit_weight_g=D("6.85"), geometry=geometry)
        prev, pouch = jobs[0], jobs[1]
        self._complete_predecessors({"p": prev}, ["p"])
        self._roll(item, prev, self.film, 62, 300, "CH-300", 1)
        for i in range(20):
            InventoryRoll.objects.create(
                label_id=f"RAWF-{i}", material=self.film, thickness_micron=D("62"), width_mm=D("1000"), plant=self.plant, location=self.rm,
                original_weight_kg=D("250"), weight_kg=D("250"), net_weight_kg=D("250"), status="AVAILABLE", stage_index=0,
                current_step_index=0 if i % 3 else 3, completed_step_index=0, meta_json={"roll_role": "RAW_MATERIAL"},
            )
        result = self._assert_same_with_and_without_prefilter([prev, pouch])
        self.assertIn("CH-300", {InventoryRoll.objects.get(id=rid).label_id for rid in result[str(pouch.id)][2]})
