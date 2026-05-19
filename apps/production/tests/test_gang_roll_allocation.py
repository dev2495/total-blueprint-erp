from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.factory.models import Plant, Process
from apps.inventory.models import InventoryLocation, InventoryRoll, RollLink
from apps.materials.models import InventoryMaterial
from apps.production.models import ProductionJob
from apps.production.services.roll_allocation_service import RollAllocationService
from apps.production.views_planner import PlannerViewSet
from apps.routing.models import RoutingRule
from apps.templates.models import TemplateBlueprint
from apps.users.models import Role, User


class GangRollAllocationTests(TestCase):
    def setUp(self):
        self.plant = Plant.objects.create(name="Gang Plant", code="GANG")
        self.role = Role.objects.create(code="ADMIN", name="Admin", default_permissions=["production.view"])
        self.user = User.objects.create_user(username="gang-admin", password="pass12345", role=self.role)
        self.wip = InventoryLocation.objects.create(
            plant=self.plant,
            code="GANG-WIP",
            name="Gang WIP",
            type="WIP",
        )
        self.material = InventoryMaterial.objects.create(
            code="FILM-GANG",
            name="Gang Film",
            category="FILM_VARIANT",
        )
        self.process = Process.objects.create(
            code="SLIT-GANG",
            name="Gang Slitting",
            input_form="ROLL",
            output_form="ROLL",
            roll_behavior="SPLIT",
        )
        self.routing = RoutingRule.objects.create(
            name="Gang Route",
            ordered_processes=[self.process.code],
        )
        self.template = TemplateBlueprint.objects.create(
            name="Gang Roll Template",
            fg_type="ROLL",
            status="DRAFT",
            routing_rule=self.routing,
        )
        self.job_a = self._job("JOB-GANG-A", quantity="100.00")
        self.job_b = self._job("JOB-GANG-B", quantity="125.00")
        self.roll = InventoryRoll.objects.create(
            label_id="ROLL-GANG-JUMBO",
            material=self.material,
            thickness_micron=Decimal("25.00"),
            width_mm=Decimal("1000.00"),
            plant=self.plant,
            location=self.wip,
            original_weight_kg=Decimal("100.000"),
            weight_kg=Decimal("100.000"),
            net_weight_kg=Decimal("100.000"),
            status="AVAILABLE",
            template=self.template,
            current_step_index=0,
            completed_step_index=0,
            meta_json={"layer_signature_hash": "sig-gang", "roll_role": "GENERIC_JUMBO"},
        )

    def _job(self, job_number, *, quantity="100.00", step=0, sig="sig-gang"):
        return ProductionJob.objects.create(
            job_number=job_number,
            origin="MTO",
            source_type="SALES",
            routing_rule=self.routing,
            template=self.template,
            current_step_index=step,
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
            meta_json={"layer_signature_hash": sig},
        )

    def _context_for(self, widths_by_job):
        def fake_context(job_id):
            width = widths_by_job[str(job_id)]
            return {"target_roll_invariant_list": [{"min_width_mm": width}]}

        return fake_context

    def test_commit_gang_requires_same_layer_and_route_step(self):
        factory = APIRequestFactory()
        view = PlannerViewSet.as_view({"post": "commit_gang"})

        request = factory.post(
            "/api/production/planner/commit-gang/",
            {"layer_signature_hash": "sig-gang", "job_ids": [str(self.job_a.id), str(self.job_b.id)]},
            format="json",
        )
        force_authenticate(request, user=self.user)
        response = view(request)

        self.assertEqual(response.status_code, 200)
        self.job_a.refresh_from_db()
        self.job_b.refresh_from_db()
        self.assertEqual(self.job_a.meta_json["gang_group_id"], response.data["gang_group_id"])
        self.assertEqual(self.job_b.meta_json["gang_group_id"], response.data["gang_group_id"])
        self.assertEqual(self.job_a.meta_json["gang_layer_sig"], "sig-gang")

        off_step = self._job("JOB-GANG-OFFSTEP", step=1)
        request = factory.post(
            "/api/production/planner/commit-gang/",
            {"layer_signature_hash": "sig-gang", "job_ids": [str(self.job_a.id), str(off_step.id)]},
            format="json",
        )
        force_authenticate(request, user=self.user)
        response = view(request)

        self.assertEqual(response.status_code, 400)
        self.assertIn("same route step", response.data["error"])

    def test_allocate_tiered_uses_backend_gang_widths_for_wider_roll_preview(self):
        self.job_a.meta_json.update({"gang_group_id": "gang-1", "gang_layer_sig": "sig-gang"})
        self.job_b.meta_json.update({"gang_group_id": "gang-1", "gang_layer_sig": "sig-gang"})
        self.job_a.save(update_fields=["meta_json"])
        self.job_b.save(update_fields=["meta_json"])

        widths = {
            str(self.job_a.id): Decimal("300.00"),
            str(self.job_b.id): Decimal("400.00"),
        }
        with patch(
            "apps.production.services.services_execution.ExecutionService.get_job_context",
            side_effect=self._context_for(widths),
        ), patch.object(
            RollAllocationService,
            "get_eligible_rolls",
            return_value=InventoryRoll.objects.filter(id=self.roll.id),
        ):
            tiered = RollAllocationService.allocate_tiered(self.job_a)

        self.assertEqual(tiered[0]["tier"], "WIDER_OK_WITH_SLIT")
        preview = tiered[0]["slit_preview"]
        self.assertEqual(preview["child_widths_mm"], [300.0, 400.0])
        self.assertEqual(preview["remainder_mm"], 290.0)
        self.assertEqual(preview["gang_job_count"], 2)
        self.assertEqual(preview["assign_job_ids"], [str(self.job_a.id), str(self.job_b.id)])

    def test_remainder_roll_wider_than_planned_parent_is_slit_again(self):
        self.job_a.meta_json.update({"planned_parent_width_mm": 600, "layer_signature_hash": "sig-gang"})
        self.job_a.save(update_fields=["meta_json"])
        self.roll.width_mm = Decimal("900.00")
        self.roll.meta_json = {"layer_signature_hash": "sig-gang", "roll_role": "REMAINDER", "is_remainder": True}
        self.roll.save(update_fields=["width_mm", "meta_json"])

        with patch.object(
            RollAllocationService,
            "get_eligible_rolls",
            return_value=InventoryRoll.objects.filter(id=self.roll.id),
        ):
            tiered = RollAllocationService.allocate_tiered(self.job_a)

        self.assertEqual(tiered[0]["tier"], "WIDER_OK_WITH_SLIT")
        self.assertEqual(tiered[0]["slit_preview"]["child_widths_mm"], [600.0])
        self.assertEqual(tiered[0]["slit_preview"]["remainder_mm"], 295.0)

    def test_perform_slit_assign_assigns_one_child_per_gang_job(self):
        self.job_a.meta_json.update({"gang_group_id": "gang-2", "gang_layer_sig": "sig-gang"})
        self.job_b.meta_json.update({"gang_group_id": "gang-2", "gang_layer_sig": "sig-gang"})
        self.job_a.save(update_fields=["meta_json"])
        self.job_b.save(update_fields=["meta_json"])

        def fake_assign(job_id, roll_id, **_kwargs):
            InventoryRoll.objects.filter(id=roll_id).update(status="RESERVED")
            return {"job_id": job_id}

        with patch(
            "apps.production.services.services_execution.ExecutionService.assign_roll_to_job",
            side_effect=fake_assign,
        ) as assign_mock:
            out = RollAllocationService.perform_slit_assign(
                self.job_a,
                self.roll,
                [Decimal("300.00"), Decimal("400.00")],
                reason="gang acceptance",
                assign_jobs=[self.job_a, self.job_b],
            )

        self.assertEqual(len(out["child_ids"]), 2)
        self.assertEqual(len(out["assigned_jobs"]), 2)
        self.assertIsNotNone(out["remainder_id"])
        self.assertEqual(out["waste_mm"], 0.0)
        self.assertEqual(assign_mock.call_count, 2)

        self.roll.refresh_from_db()
        self.assertEqual(self.roll.status, "CONSUMED")
        self.assertEqual(self.roll.weight_kg, Decimal("0.000"))
        children = list(InventoryRoll.objects.filter(parent_roll=self.roll).exclude(id=out["remainder_id"]).order_by("label_id"))
        self.assertEqual([child.width_mm for child in children], [Decimal("300.00"), Decimal("400.00")])
        self.assertEqual(children[0].meta_json["assigned_job_id"], str(self.job_a.id))
        self.assertEqual(children[1].meta_json["assigned_job_id"], str(self.job_b.id))
        self.assertEqual(children[0].meta_json["gang_group_id"], "gang-2")
        self.assertEqual(RollLink.objects.filter(parent_roll=self.roll).count(), 3)

    def test_perform_slit_assign_multi_slit_keeps_extra_children_available(self):
        def fake_assign(job_id, roll_id, **_kwargs):
            InventoryRoll.objects.filter(id=roll_id).update(status="RESERVED")
            return {"job_id": job_id}

        with patch(
            "apps.production.services.services_execution.ExecutionService.assign_roll_to_job",
            side_effect=fake_assign,
        ) as assign_mock:
            out = RollAllocationService.perform_slit_assign(
                self.job_a,
                self.roll,
                [Decimal("300.00"), Decimal("300.00")],
                reason="operator max slit",
            )

        self.assertEqual(len(out["child_ids"]), 2)
        self.assertEqual(len(out["assigned_jobs"]), 1)
        self.assertEqual(assign_mock.call_count, 1)
        self.assertIsNotNone(out["remainder_id"])
        self.roll.refresh_from_db()
        self.assertEqual(self.roll.status, "CONSUMED")

        first_child = InventoryRoll.objects.get(id=out["child_ids"][0])
        second_child = InventoryRoll.objects.get(id=out["child_ids"][1])
        remainder = InventoryRoll.objects.get(id=out["remainder_id"])
        self.assertEqual(first_child.status, "RESERVED")
        self.assertEqual(second_child.status, "AVAILABLE")
        self.assertEqual(second_child.width_mm, Decimal("300.00"))
        self.assertEqual(remainder.status, "AVAILABLE")
        self.assertEqual(remainder.width_mm, Decimal("390.00"))
        self.assertEqual(remainder.meta_json["roll_role"], "REMAINDER")
        self.assertEqual(RollLink.objects.filter(parent_roll=self.roll).count(), 3)
