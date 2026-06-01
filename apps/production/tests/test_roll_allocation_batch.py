"""
Tests for RollAllocationService.perform_slit_assign_batch + the
allocate-with-slit-batch endpoint.

The big rules verified here:
  - atomic success: all picks committed in one transaction.
  - validation failure: a CONSUMED roll in the middle of the picks list aborts
    everything; nothing else mutates.
  - mid-batch exception: monkeypatching perform_slit_assign to raise on pick #2
    rolls back pick #1.
  - idempotency: same Idempotency-Key returns cached result, no double-mutation.
  - coverage math: total_qty_allocated_kg equals the sum of child weights.
"""

from decimal import Decimal
from unittest.mock import patch

from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.factory.models import Plant, Process
from apps.inventory.models import InventoryLocation, InventoryRoll
from apps.materials.models import InventoryMaterial
from apps.production.models import ProductionJob, RollAllocationBatchRequest
from apps.production.services.roll_allocation_service import RollAllocationService
from apps.production.views import ProductionJobViewSet
from apps.routing.models import RoutingRule
from apps.templates.models import TemplateBlueprint
from apps.users.models import Role, User


class _FakeAssignMixin:
    """Patch ExecutionService.assign_roll_to_job and a couple of helpers so the
    pure roll allocation logic can be exercised without a full job execution
    context."""

    @staticmethod
    def _patch_execution_helpers():
        """Returns a context manager stacking the patches every test needs."""
        from contextlib import ExitStack

        stack = ExitStack()

        def fake_assign(job_id, roll_id, **_kwargs):
            InventoryRoll.objects.filter(id=roll_id).update(status="RESERVED")
            return {"job_id": job_id, "roll_id": roll_id}

        stack.enter_context(
            patch(
                "apps.production.services.services_execution.ExecutionService.assign_roll_to_job",
                side_effect=fake_assign,
            )
        )
        # Pretend job has the same plant as its rolls.
        stack.enter_context(
            patch(
                "apps.production.services.services_execution.ExecutionService._resolve_job_plant_id",
                return_value=None,
            )
        )
        return stack


class RollAllocationBatchTests(_FakeAssignMixin, TestCase):
    def setUp(self):
        self.plant = Plant.objects.create(name="Batch Plant", code="BATCH")
        self.role = Role.objects.create(
            code="ADMIN-BATCH",
            name="Batch Admin",
            default_permissions=["production.view", "production.manage"],
        )
        self.user = User.objects.create_user(
            username="batch-admin", password="pass12345", role=self.role
        )
        self.wip = InventoryLocation.objects.create(
            plant=self.plant, code="BATCH-WIP", name="Batch WIP", type="WIP",
        )
        self.material = InventoryMaterial.objects.create(
            code="FILM-BATCH", name="Batch Film", category="FILM_VARIANT",
        )
        # Use an EXTRU-tagged process so the trim allowance is 0 mm — this lets
        # full-roll (EXACT-tier) picks pass perform_slit_assign without needing
        # a remainder. Matches the user's "600 kg needed, 100+300+200 = 600
        # available, allocate all at once" scenario.
        self.process = Process.objects.create(
            code="EXTRU-BATCH",
            name="Batch Extrusion",
            input_form="ROLL",
            output_form="ROLL",
            roll_behavior="SPLIT",
        )
        self.routing = RoutingRule.objects.create(
            name="Batch Route", ordered_processes=[self.process.code],
        )
        self.template = TemplateBlueprint.objects.create(
            name="Batch Roll Template",
            fg_type="ROLL",
            status="DRAFT",
            routing_rule=self.routing,
        )
        # Job needing 600 kg.
        # Target width matches the parent rolls (EXACT tier, no slit). With the
        # EXTRU process trim=0, _resolve_pick_plan returns [parent_w] and the
        # full roll is committed without a remainder. Maps to: 100+300+200 = 600.
        self.job = self._job(
            "JOB-BATCH-PARENT", quantity="600.00", target_width="500.00",
        )
        self.roll_a = self._roll("ROLL-A", width="500.00", weight="100.000")
        self.roll_b = self._roll("ROLL-B", width="500.00", weight="300.000")
        self.roll_c = self._roll("ROLL-C", width="500.00", weight="200.000")

    def _job(self, job_number, *, quantity, target_width):
        job = ProductionJob.objects.create(
            job_number=job_number,
            origin="MTO",
            source_type="SALES",
            routing_rule=self.routing,
            template=self.template,
            current_step_index=0,
            current_process=self.process,
            process=self.process,
            from_location=self.wip,
            to_location=self.wip,
            input_form="ROLL",
            output_form="ROLL",
            quantity=Decimal(quantity),
            remaining_qty=Decimal(quantity),
            uom="KG",
            status="QUEUED",
            job_state="PLANNED",
            meta_json={
                "planned_parent_width_mm": float(target_width),
                "layer_signature_hash": "sig-batch",
            },
        )
        return job

    def _roll(self, label, *, width, weight, stock_form="OPEN_WEB", width_basis="OPEN_WEB_WIDTH"):
        return InventoryRoll.objects.create(
            label_id=label,
            material=self.material,
            thickness_micron=Decimal("25.00"),
            width_mm=Decimal(width),
            stock_form=stock_form,
            width_basis=width_basis,
            plant=self.plant,
            location=self.wip,
            original_weight_kg=Decimal(weight),
            weight_kg=Decimal(weight),
            net_weight_kg=Decimal(weight),
            status="AVAILABLE",
            template=self.template,
            current_step_index=0,
            completed_step_index=0,
            meta_json={"layer_signature_hash": "sig-batch"},
        )

    # ── 1. Atomic success ──────────────────────────────────────────────────
    def test_atomic_success(self):
        picks = [
            {"roll_id": str(self.roll_a.id), "mode": "ONE", "reason": "batch-1"},
            {"roll_id": str(self.roll_b.id), "mode": "ONE", "reason": "batch-2"},
            {"roll_id": str(self.roll_c.id), "mode": "ONE", "reason": "batch-3"},
        ]
        with self._patch_execution_helpers():
            result = RollAllocationService.perform_slit_assign_batch(
                job=self.job, picks=picks, user=self.user,
            )

        self.assertEqual(result["picks_count"], 3)
        self.assertEqual(len(result["child_rolls"]), 3)
        for r in (self.roll_a, self.roll_b, self.roll_c):
            r.refresh_from_db()
            self.assertEqual(r.status, "CONSUMED", f"{r.label_id} should be CONSUMED")

    # ── 2. Atomic rollback on validation failure ──────────────────────────
    def test_atomic_rollback_on_validation_failure(self):
        # Pre-consume roll_b to trigger a validation error.
        self.roll_b.status = "CONSUMED"
        self.roll_b.save(update_fields=["status"])

        picks = [
            {"roll_id": str(self.roll_a.id), "mode": "ONE", "reason": "v1"},
            {"roll_id": str(self.roll_b.id), "mode": "ONE", "reason": "v2"},
            {"roll_id": str(self.roll_c.id), "mode": "ONE", "reason": "v3"},
        ]
        with self._patch_execution_helpers():
            with self.assertRaises(ValidationError):
                RollAllocationService.perform_slit_assign_batch(
                    job=self.job, picks=picks, user=self.user,
                )

        self.roll_a.refresh_from_db()
        self.roll_c.refresh_from_db()
        self.assertEqual(self.roll_a.status, "AVAILABLE")
        self.assertEqual(self.roll_c.status, "AVAILABLE")
        # No child rolls created.
        child_count = InventoryRoll.objects.filter(parent_roll__in=[self.roll_a, self.roll_c]).count()
        self.assertEqual(child_count, 0)

    # ── 3. Atomic rollback on mid-batch exception ─────────────────────────
    def test_atomic_rollback_on_mid_batch_exception(self):
        original = RollAllocationService.perform_slit_assign
        call_counter = {"n": 0}

        def flaky(job, roll, *args, **kwargs):
            call_counter["n"] += 1
            if call_counter["n"] == 2:
                raise RuntimeError("simulated mid-batch failure")
            return original(job, roll, *args, **kwargs)

        picks = [
            {"roll_id": str(self.roll_a.id), "mode": "ONE", "reason": "x1"},
            {"roll_id": str(self.roll_b.id), "mode": "ONE", "reason": "x2"},
        ]
        with self._patch_execution_helpers(), patch.object(
            RollAllocationService, "perform_slit_assign", side_effect=flaky
        ):
            with self.assertRaises(RuntimeError):
                RollAllocationService.perform_slit_assign_batch(
                    job=self.job, picks=picks, user=self.user,
                )

        self.roll_a.refresh_from_db()
        self.roll_b.refresh_from_db()
        self.assertEqual(
            self.roll_a.status, "AVAILABLE",
            "Pick #1 must roll back when pick #2 fails.",
        )
        self.assertEqual(self.roll_b.status, "AVAILABLE")
        # No surviving children.
        self.assertEqual(
            InventoryRoll.objects.filter(parent_roll=self.roll_a).count(), 0
        )

    # ── 4. Idempotency via the HTTP endpoint ──────────────────────────────
    def test_idempotency(self):
        cache.clear()
        factory = APIRequestFactory()
        view = ProductionJobViewSet.as_view({"post": "allocate_with_slit_batch"})

        picks_payload = {
            "picks": [
                {"roll_id": str(self.roll_a.id), "mode": "ONE", "reason": "idem"},
            ]
        }
        headers = {"HTTP_IDEMPOTENCY_KEY": "test-idem-1"}

        with self._patch_execution_helpers():
            request = factory.post(
                f"/api/production/jobs/{self.job.id}/allocate-with-slit-batch/",
                picks_payload,
                format="json",
                **headers,
            )
            force_authenticate(request, user=self.user)
            response_1 = view(request, pk=str(self.job.id))
        self.assertEqual(response_1.status_code, 200, response_1.data)
        first_payload = response_1.data
        self.roll_a.refresh_from_db()
        self.assertEqual(self.roll_a.status, "CONSUMED")
        children_after_first = InventoryRoll.objects.filter(parent_roll=self.roll_a).count()
        self.assertGreater(children_after_first, 0)

        # Second call with the same key should be a no-op.
        request = factory.post(
            f"/api/production/jobs/{self.job.id}/allocate-with-slit-batch/",
            picks_payload,
            format="json",
            **headers,
        )
        force_authenticate(request, user=self.user)
        with self._patch_execution_helpers():
            response_2 = view(request, pk=str(self.job.id))
        self.assertEqual(response_2.status_code, 200)
        self.assertEqual(response_2.data, first_payload)
        # No extra children.
        self.assertEqual(
            InventoryRoll.objects.filter(parent_roll=self.roll_a).count(),
            children_after_first,
        )
        record = RollAllocationBatchRequest.objects.get(
            job=self.job,
            client_token="test-idem-1",
        )
        self.assertEqual(record.status, "COMPLETED")
        self.assertEqual(record.response_json, first_payload)

    # ── 5. Coverage math: 100 + 300 + 200 = 600 ──────────────────────────
    def test_coverage_math(self):
        picks = [
            {"roll_id": str(self.roll_a.id), "mode": "ONE", "reason": "c1"},
            {"roll_id": str(self.roll_b.id), "mode": "ONE", "reason": "c2"},
            {"roll_id": str(self.roll_c.id), "mode": "ONE", "reason": "c3"},
        ]
        with self._patch_execution_helpers():
            result = RollAllocationService.perform_slit_assign_batch(
                job=self.job, picks=picks, user=self.user,
            )
        self.assertAlmostEqual(result["total_qty_allocated_kg"], 600.0, places=2)
        self.assertEqual(len(result["assigned_jobs"]), 3)

    def test_tiered_rolls_payload_includes_job_and_candidate_plant_fields(self):
        factory = APIRequestFactory()
        view = ProductionJobViewSet.as_view({"get": "tiered_rolls"})
        request = factory.get(f"/api/production/jobs/{self.job.id}/tiered-rolls/")
        force_authenticate(request, user=self.user)

        response = view(request, pk=str(self.job.id))

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["job_plant_id"], str(self.plant.id))
        self.assertTrue(response.data["candidates"])
        first = response.data["candidates"][0]
        self.assertEqual(first["plant_id"], str(self.plant.id))
        self.assertEqual(first["plant_code"], self.plant.code)

    def test_tube_stock_exact_width_allocates_without_slit(self):
        tube_job = self._job("JOB-TUBE-EXACT", quantity="100.00", target_width="500.00")
        tube_job.meta_json = {
            **(tube_job.meta_json or {}),
            "stock_form": "LAYFLAT_TUBE",
            "slit_policy": "EXACT_ONLY",
        }
        tube_job.save(update_fields=["meta_json"])
        tube_roll = self._roll(
            "ROLL-TUBE-EXACT",
            width="500.00",
            weight="100.000",
            stock_form="LAYFLAT_TUBE",
            width_basis="LAYFLAT_WIDTH",
        )

        with self._patch_execution_helpers():
            result = RollAllocationService.perform_slit_assign_batch(
                job=tube_job,
                picks=[{"roll_id": str(tube_roll.id), "mode": "ONE", "reason": "tube exact"}],
                user=self.user,
            )

        self.assertEqual(result["picks_count"], 1)
        self.assertEqual(len(result["child_rolls"]), 1)
        self.assertEqual(result["scrap_mm_total"], 0.0)
        child = InventoryRoll.objects.get(id=result["child_rolls"][0]["roll_id"])
        self.assertEqual(child.stock_form, "LAYFLAT_TUBE")
        self.assertEqual(child.width_basis, "LAYFLAT_WIDTH")

    def test_tube_stock_wider_roll_is_rejected_not_slit(self):
        tube_job = self._job("JOB-TUBE-WIDE", quantity="100.00", target_width="500.00")
        tube_job.meta_json = {
            **(tube_job.meta_json or {}),
            "stock_form": "LAYFLAT_TUBE",
            "slit_policy": "EXACT_ONLY",
        }
        tube_job.save(update_fields=["meta_json"])
        tube_roll = self._roll(
            "ROLL-TUBE-WIDE",
            width="700.00",
            weight="100.000",
            stock_form="LAYFLAT_TUBE",
            width_basis="LAYFLAT_WIDTH",
        )

        with self._patch_execution_helpers():
            with self.assertRaises(ValidationError):
                RollAllocationService.perform_slit_assign_batch(
                    job=tube_job,
                    picks=[{"roll_id": str(tube_roll.id), "mode": "ONE", "reason": "tube wide"}],
                    user=self.user,
                )

        tube_roll.refresh_from_db()
        self.assertEqual(tube_roll.status, "AVAILABLE")
        self.assertEqual(InventoryRoll.objects.filter(parent_roll=tube_roll).count(), 0)
