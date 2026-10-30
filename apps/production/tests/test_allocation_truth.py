"""Reported 30 Oct 2026 on live:

- Release planning listed rolls held by other order lines (leftovers of closed SO-2026-0651) and
  Plan & Release then refused them ("already linked to another sales order").
- A roll->bulk step (side sealing from purchased BOPP) got every roll in the plant, cut to the
  heaviest 400 before any film check, so the exact 850 mm rolls never reached the picker.
- The WC terminal showed machines "Down" because downtime stayed open on completed jobs.
"""
import importlib
from decimal import Decimal
from unittest.mock import patch

from django.apps import apps as django_apps
from django.db.models import Q
from django.test import TestCase
from django.utils import timezone

from apps.factory.models import Plant, Process, WorkCenter
from apps.factory.serializers import machine_live_state
from apps.inventory.models import InventoryLocation, InventoryRoll
from apps.materials.models import InventoryMaterial
from apps.production.models import DowntimeLog, ProductionJob
from apps.production.services.job_services import JobService, WCManagerService
from apps.production.services.roll_allocation_service import RollAllocationService
from apps.production.services.services_execution import ExecutionService
from apps.production.tests import test_wcm_audit_events as fixtures
from apps.production.views_planner import PlannerViewSet
from apps.routing.models import RoutingRule
from apps.sales.models import SalesOrder, SalesOrderItem


class RollToBulkContractTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.plant = Plant.objects.create(code="SSP", name="Side Sealing Plant")
        cls.rm = InventoryLocation.objects.create(plant=cls.plant, code="SSP-RM", name="RM", type="RM", is_system=True)
        cls.process = Process.objects.create(
            code="SS-TRUTH", name="Side sealing", input_form="ROLL", output_form="BULK",
            roll_behavior="NONE", allowed_input_stock_forms=["OPEN_WEB"],
        )
        cls.work_center = WorkCenter.objects.create(plant=cls.plant, code="WC-SS-TRUTH", name="Side Sealing")
        cls.route = RoutingRule.objects.create(name="Side seal route", ordered_processes=["SS-TRUTH"])
        cls.bopp = InventoryMaterial.objects.create(code="BOPP-TT", name="BOPP", category="FILM_VARIANT", base_uom="KG")
        cls.ld = InventoryMaterial.objects.create(code="LD-NAT-T", name="LD NAT", category="FILM_VARIANT", base_uom="KG")
        cls.job = ProductionJob.objects.create(
            job_number="SO-TRUTH-B01-1", routing_rule=cls.route, current_step_index=0,
            current_process=cls.process, process=cls.process, work_center=cls.work_center,
            from_location=cls.rm, to_location=cls.rm, quantity=Decimal("600"), uom="KG",
            input_form="ROLL", output_form="BULK", job_state="RELEASED",
        )

    def spec(self):
        return [{
            "variant_id": str(self.bopp.id), "thickness_micron": 51, "stock_form": "OPEN_WEB",
            "slit_policy": "SLIT_ALLOWED", "min_width_mm": 850, "max_auto_width_mm": 870,
        }]

    def roll(self, label, material, width, weight, thickness="51", **extra):
        return InventoryRoll.objects.create(
            label_id=label, material=material, plant=self.plant, location=self.rm, status="AVAILABLE",
            thickness_micron=Decimal(thickness), width_mm=Decimal(width), stock_form="OPEN_WEB",
            original_weight_kg=Decimal(weight), weight_kg=Decimal(weight), stage_index=0,
            current_step_index=0, completed_step_index=0, **extra,
        )

    def patches(self):
        return (
            patch.object(ExecutionService, "_build_step_target_specs", return_value=self.spec()),
            patch.object(ExecutionService, "_resolve_job_lineage_filter", return_value=Q(label_id__startswith="OWN-")),
            patch.object(ExecutionService, "_resolve_step_roll_spec", return_value={"input_roll_count": 1}),
        )

    def test_plant_stock_must_be_the_specified_film_and_exact_rolls_lead_the_list(self):
        heavy_wrong = [self.roll(f"LD-HEAVY-{i}", self.ld, "850", "600") for i in range(3)]
        exact = self.roll("BOPP-850", self.bopp, "850", "250")
        wide = self.roll("BOPP-1060", self.bopp, "1060", "570")
        thin = self.roll("BOPP-850-THIN", self.bopp, "850", "300", thickness="40")
        a, b, c = self.patches()
        with a, b, c:
            eligible = list(RollAllocationService.get_eligible_rolls(self.job, include_non_lineage_fallback=True, include_remainder=True))
            ids = [roll.id for roll in eligible]
            self.assertNotIn(heavy_wrong[0].id, ids, "a roll->bulk step no longer takes any film in the plant")
            self.assertNotIn(thin.id, ids)
            self.assertIn(exact.id, ids)
            self.assertIn(wide.id, ids, "a wider roll of the right film stays eligible (slit / override)")
            self.assertLess(ids.index(exact.id), ids.index(wide.id), "the as-is width roll comes before heavier wider stock")
            # The SQL pre-filter drops the wrong film too (fewer rows loaded, same answer).
            prefiltered = set(
                InventoryRoll.objects.filter(ExecutionService._roll_candidate_prefilter(self.job, self.process, strict=False))
                .values_list("id", flat=True)
            )
            self.assertNotIn(heavy_wrong[0].id, prefiltered)
            self.assertIn(exact.id, prefiltered)

    def test_verdict_matches_what_allocation_accepts(self):
        exact = self.roll("BOPP-850-V", self.bopp, "850", "250")
        wide = self.roll("BOPP-1060-V", self.bopp, "1060", "570")
        wrong = self.roll("LD-850-V", self.ld, "850", "600")
        own_laminate = self.roll("OWN-LAM-1", self.ld, "860", "300", thickness="120", meta_json={"roll_role": "OUTPUT"})
        a, b, c = self.patches()
        with a, b, c:
            specs = self.spec()
            exact_v = ExecutionService.roll_pick_verdict(self.job, self.process, exact, specs)
            wide_v = ExecutionService.roll_pick_verdict(self.job, self.process, wide, specs)
            wrong_v = ExecutionService.roll_pick_verdict(self.job, self.process, wrong, specs)
            own_v = ExecutionService.roll_pick_verdict(self.job, self.process, own_laminate, specs)
        self.assertEqual(exact_v, {"contract_ok": True, "auto_window_ok": True, "own_flow": False})
        self.assertEqual(wide_v, {"contract_ok": True, "auto_window_ok": False, "own_flow": False}, "wider than +20 mm needs slitting or override")
        self.assertFalse(wrong_v["contract_ok"])
        self.assertEqual(own_v, {"contract_ok": True, "auto_window_ok": True, "own_flow": True}, "the order's own laminate feeds the step as it is")


class HeldStockReleasePlanningTests(TestCase):
    setUp = fixtures.WcmAuditEventTests.setUp

    def line(self, customer, line_status="OPEN"):
        order = SalesOrder.objects.create(customer_name=customer, status="PLANNING_REQUIRED")
        return SalesOrderItem.objects.create(sales_order=order, template=self.template, qty_value=100, unit_price=1, line_status=line_status)

    def fg_roll(self, label, holder=None):
        return InventoryRoll.objects.create(
            label_id=label, template=self.template, material=self.granule, sales_order_item=holder,
            weight_kg=90, width_mm=525, location=self.location, meta_json={"spec_signature": "wanted"},
        )

    def test_only_claimable_stock_is_offered_and_closed_leftovers_are_counted(self):
        self.template.routing_rule = self.route
        self.template.save(update_fields=["routing_rule"])
        own = self.line("Planning now")
        closed = self.line("Closed earlier", line_status="SHORT_CLOSED")
        still_open = self.line("Still running")
        mine = self.fg_roll("R-MINE", own)
        free = self.fg_roll("R-FREE")
        held_closed = self.fg_roll("R-CLOSED", closed)
        held_open = self.fg_roll("R-OPEN", still_open)
        held = {}
        rows = PlannerViewSet()._eligible_inventory_for_order(
            "sales", own.sales_order, self.template, "wanted", "", 0, 0, {}, {}, sales_item=own, held_summary=held,
        )
        offered = {row["inventory_id"] for row in rows}
        self.assertEqual(offered, {str(mine.id), str(free.id)})
        self.assertEqual(held["closed_count"], 1)
        self.assertEqual(held["closed_orders"], [closed.sales_order.order_number])
        self.assertEqual(held["open_line_count"], 1)
        self.assertNotIn(str(held_closed.id), offered)
        self.assertNotIn(str(held_open.id), offered)

    def test_claim_refuses_held_stock_before_writing_anything(self):
        from apps.production.models import InventoryAllocation

        self.template.routing_rule = self.route
        self.template.save(update_fields=["routing_rule"])
        own = self.line("Planning now")
        closed = self.line("Closed earlier", line_status="SHORT_CLOSED")
        held_closed = self.fg_roll("R-CLOSED-2", closed)
        with self.assertRaisesMessage(ValueError, "Move it to free stock"):
            PlannerViewSet()._create_inventory_allocations(
                order_kind="sales", order_obj=own.sales_order, template=self.template, route_last=0, start_step=0,
                option="FG", allocation_rows=[{"inventory_type": "ROLL", "inventory_id": str(held_closed.id), "allocated_qty_kg": 50}],
                created_by=None, sales_item_override=own,
            )
        self.assertFalse(InventoryAllocation.objects.filter(inventory_roll=held_closed).exists())
        self.assertTrue(PlannerViewSet._held_by_other_line(held_closed, "stock", ""), "a stock order can never take a sales line's roll")
        self.assertFalse(PlannerViewSet._held_by_other_line(held_closed, "sales", str(closed.id)))


class MachineLiveStateTests(TestCase):
    setUp = fixtures.WcmAuditEventTests.setUp

    def downtime(self, job, **extra):
        return DowntimeLog.objects.create(production_job=job, start_time=timezone.now(), reason="MATERIAL", **extra)

    def test_downtime_left_on_a_completed_job_does_not_mark_the_machine_down(self):
        self.job.machine = self.machine
        self.job.save(update_fields=["machine"])
        self.downtime(self.job)
        # A legacy close that bypassed the model (as on live before this fix).
        ProductionJob.objects.filter(id=self.job.id).update(job_state="COMPLETED", status="COMPLETED")
        live = machine_live_state(self.machine)
        self.assertEqual(live["state"], "IDLE")

    def test_downtime_on_a_waiting_job_reads_down_with_its_reason(self):
        self.job.machine = self.machine
        self.job.job_state = "RELEASED"
        self.job.save(update_fields=["machine", "job_state"])
        self.downtime(self.job)
        live = machine_live_state(self.machine)
        self.assertEqual((live["state"], live["down_kind"]), ("DOWN", "DOWNTIME"))
        self.assertIn(self.job.job_number, live["down_reason"])

    def test_a_stopping_fault_wins_and_blocks_new_work(self):
        self.machine.status = "DOWN"
        self.machine.save(update_fields=["status"])
        live = machine_live_state(self.machine)
        self.assertEqual((live["state"], live["down_kind"]), ("DOWN", "FAULT"))
        with self.assertRaisesMessage(ValueError, "cannot take work"):
            WCManagerService.assign_machine(self.assignment.id, self.machine.id)

    def test_closing_a_job_by_any_path_ends_its_open_downtime(self):
        row = self.downtime(self.job)
        self.job.job_state = "CANCELLED"
        self.job.status = "CANCELLED"
        self.job.save(update_fields=["job_state", "status"])
        row.refresh_from_db()
        self.assertIsNotNone(row.end_time)
        self.assertGreaterEqual(row.end_time, row.start_time)

    def test_resume_ends_hand_logged_downtime_too(self):
        manual = self.downtime(self.job, source="MANUAL")
        pause = self.downtime(self.job, source="PAUSE")
        ProductionJob.objects.filter(id=self.job.id).update(job_state="PAUSED", status="RELEASED")
        JobService.resume_job(self.job.id)
        manual.refresh_from_db()
        pause.refresh_from_db()
        self.assertIsNotNone(manual.end_time)
        self.assertIsNotNone(pause.end_time)

    def test_migration_ends_downtime_of_closed_jobs_only(self):
        other = ProductionJob.objects.create(
            job_number="WCM-AUDIT-OPEN", template=self.template, routing_rule=self.route, current_step_index=0,
            current_process=self.process, process=self.process, work_center=self.work_center,
            from_location=self.location, quantity=Decimal("10"), remaining_qty=Decimal("10"),
        )
        stale = self.downtime(self.job)
        live_row = self.downtime(other)
        ProductionJob.objects.filter(id=self.job.id).update(job_state="COMPLETED", status="COMPLETED")
        migration = importlib.import_module("apps.production.migrations.0078_close_downtime_of_closed_jobs")
        migration.close_downtime_of_closed_jobs(django_apps, None)
        stale.refresh_from_db()
        live_row.refresh_from_db()
        self.assertIsNotNone(stale.end_time)
        self.assertIsNone(live_row.end_time)
