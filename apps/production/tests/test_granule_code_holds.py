"""Issued-but-unused granule codes are held for their job; a short code can be re-split before output."""
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.test import TestCase
from rest_framework.test import force_authenticate

from apps.inventory.models import InventoryBulk
from apps.inventory.services.bulk_service import BulkService
from apps.materials.models import GranuleQualityCode
from apps.production.models import JobMaterialRequirement, ProductionJob, ProductionWcmAuditEvent
from apps.production.services.granule_availability import GranuleAvailabilityService, GranuleStockConflict
from apps.production.services.services_execution import ExecutionService
from apps.production.tests.test_wcm_audit_events import WcmAuditEventTests
from apps.production.views_wc import JobAllocationViewSet, _validate_wcm_material_confirmations


class GranuleCodeHoldTests(TestCase):
    """Borrows the WCM fixture: granule GR-WCM, code GA with 80 kg in WCM RM, self.job needs 10 kg."""

    _confirmation = WcmAuditEventTests._confirmation
    _confirmation_at = WcmAuditEventTests._confirmation_at

    def setUp(self):
        WcmAuditEventTests.setUp(self)
        self.code_c = GranuleQualityCode.objects.create(granule=self.granule, code="GC", status="ACTIVE")
        InventoryBulk.objects.create(material=self.granule, granule_code=self.code_c, plant=self.plant, location=self.location, qty_kg=Decimal("500"))

    def _other_job(self, number, issued, required=None, consumed="0", state="RELEASED", code=None):
        job = ProductionJob.objects.create(
            job_number=number,
            template=self.template,
            routing_rule=self.route,
            current_step_index=0,
            current_process=self.process,
            process=self.process,
            work_center=self.work_center,
            from_location=self.location,
            quantity=Decimal("100.00"),
            remaining_qty=Decimal("100.0000"),
            job_state=state,
        )
        req = JobMaterialRequirement.objects.create(
            production_job=job,
            material=self.granule,
            process_step=self.step,
            required_qty=Decimal(str(required or issued)),
            theoretical_qty=Decimal(str(required or issued)),
            planned_issue_qty=Decimal(str(required or issued)),
            consumed_qty=Decimal(consumed),
            uom="KG",
        )
        job.current_step_material_confirmations = [{
            "requirement_id": str(req.id),
            "material_id": str(self.granule.id),
            "actual_issued_qty": str(issued),
            "granule_code_allocations": [{
                "granule_code_id": str((code or self.code_a).id),
                "source_location_id": str(self.location.id),
                "qty_kg": float(issued),
            }],
        }]
        job.save(update_fields=["current_step_material_confirmations"])
        return job

    def _ga_option(self, job=None):
        options = GranuleAvailabilityService.options(
            self.granule,
            issue_location_id=str(self.location.id),
            issue_plant_id=str(self.plant.id),
            exclude_job_id=(job or self.job).id,
        )
        return next(option for option in options if option["code"] == "GA")

    def test_other_open_jobs_issue_is_held_and_not_offered_again(self):
        self._other_job("HOLD-1", 60)
        option = self._ga_option()
        self.assertEqual(option["on_hand_qty_kg"], 80.0)
        self.assertEqual(option["held_qty_kg"], 60.0)
        self.assertEqual(option["available_qty_kg"], 20.0)
        self.assertEqual(option["held_by_jobs"], ["HOLD-1"])
        self.assertTrue(option["can_allocate"])
        self.assertIn("HOLD-1", option["status_reason"])

    def test_fully_held_code_is_not_allocatable(self):
        self._other_job("HOLD-1", 50)
        self._other_job("HOLD-2", 40)
        option = self._ga_option()
        self.assertEqual(option["eligibility_status"], "HELD")
        self.assertFalse(option["can_allocate"])
        self.assertEqual(option["available_qty_kg"], 0.0)
        self.assertEqual(option["held_job_count"], 2)

    def test_issue_beyond_free_stock_is_refused_with_the_holding_jobs(self):
        self._other_job("HOLD-1", 75)
        with transaction.atomic(), self.assertRaises(GranuleStockConflict) as caught:
            _validate_wcm_material_confirmations(self.job, self._confirmation(issued="10.0000"))
        message = str(caught.exception)
        self.assertIn("HOLD-1", message)
        self.assertIn("Free to issue: 5.000 kg", message)
        # Within the free 5 kg passes.
        self.requirement.required_qty = Decimal("5")
        self.requirement.save(update_fields=["required_qty"])
        with transaction.atomic():
            _validate_wcm_material_confirmations(self.job, self._confirmation(issued="5.0000"))

    def test_hold_shrinks_as_output_consumes_and_ends_when_job_closes(self):
        busy = self._other_job("HOLD-1", 60, required=60, consumed="50")
        self.assertEqual(self._ga_option()["held_qty_kg"], 10.0)
        busy.job_state = "COMPLETED"
        busy.save(update_fields=["job_state"])
        self.assertEqual(self._ga_option()["held_qty_kg"], 0.0)

    def test_hold_is_only_what_the_step_still_needs(self):
        # 70 kg issued against a 30 kg requirement holds 30.
        self._other_job("HOLD-1", 70, required=30)
        self.assertEqual(self._ga_option()["held_qty_kg"], 30.0)

    def test_earlier_step_issue_does_not_hold(self):
        moved_on = self._other_job("HOLD-1", 60)
        moved_on.current_step_index = 1
        moved_on.save(update_fields=["current_step_index"])
        self.assertEqual(self._ga_option()["held_qty_kg"], 0.0)

    def test_own_issue_does_not_count_against_itself(self):
        self.job.current_step_material_confirmations = self._confirmation_at(self.location, issued="10.0000")
        self.job.save(update_fields=["current_step_material_confirmations"])
        self.assertEqual(self._ga_option(self.job)["available_qty_kg"], 80.0)
        other = self._other_job("HOLD-1", 5)
        self.assertEqual(self._ga_option(other)["held_by_jobs"], [self.job.job_number])
        self.assertEqual(self._ga_option(other)["available_qty_kg"], 70.0)

    def test_issue_screen_payload_shows_free_stock(self):
        self._other_job("HOLD-1", 60)
        rows = ExecutionService.get_bulk_consumption_preview(self.job)
        row = next(item for item in rows if str(item.get("material_id")) == str(self.granule.id))
        ga = next(option for option in row["granule_code_options"] if option["code"] == "GA")
        self.assertEqual(ga["available_qty_kg"], 20.0)

    # --- change codes on a released job -------------------------------------------------------------------

    def _release_with(self, code, issued="10.0000"):
        self.assignment.assigned_machine = self.machine
        self.assignment.status = "EXECUTION_READY"
        self.assignment.save(update_fields=["assigned_machine", "status"])
        self.job.job_state = "EXECUTING"
        self.job.current_step_material_confirmations = self._confirmation_at(self.location, code_id=code.id, issued=issued)
        self.job.save(update_fields=["job_state", "current_step_material_confirmations"])

    def _change(self, allocations):
        view = JobAllocationViewSet.as_view({"post": "change_codes"})
        request = self.factory.post(
            "/api/production/wc-allocation/change-codes/",
            {"assignment_id": str(self.assignment.id), "requirement_id": str(self.requirement.id), "granule_code_allocations": allocations},
            format="json",
        )
        force_authenticate(request, user=self.user)
        return view(request)

    def test_change_codes_resplits_a_released_issue(self):
        self._release_with(self.code_a)
        response = self._change([
            {"granule_code_id": str(self.code_a.id), "source_location_id": str(self.location.id), "qty_kg": "4"},
            {"granule_code_id": str(self.code_c.id), "source_location_id": str(self.location.id), "qty_kg": "6"},
        ])
        self.assertEqual(response.status_code, 200, response.data)
        self.job.refresh_from_db()
        allocations = self.job.current_step_material_confirmations[0]["granule_code_allocations"]
        self.assertEqual({(row["granule_code_id"], row["qty_kg"]) for row in allocations},
                         {(str(self.code_a.id), 4.0), (str(self.code_c.id), 6.0)})
        event = ProductionWcmAuditEvent.objects.get(production_job=self.job, action="MATERIAL_ISSUE")
        self.assertEqual(event.payload["change"], "CODES")
        self.assertEqual(len(event.payload["after"]), 2)

    def test_change_codes_must_keep_issued_total_and_free_stock(self):
        self._release_with(self.code_a)
        response = self._change([{"granule_code_id": str(self.code_c.id), "source_location_id": str(self.location.id), "qty_kg": "7"}])
        self.assertEqual(response.status_code, 400)
        self.assertIn("must total", response.data["error"])
        self._other_job("HOLD-1", 495, code=self.code_c)
        response = self._change([{"granule_code_id": str(self.code_c.id), "source_location_id": str(self.location.id), "qty_kg": "10"}])
        self.assertEqual(response.status_code, 409)
        self.assertIn("HOLD-1", response.data["detail"])

    def test_change_codes_refused_after_output_used_the_issue(self):
        self._release_with(self.code_a)
        self.requirement.consumed_qty = Decimal("3")
        self.requirement.save(update_fields=["consumed_qty"])
        response = self._change([{"granule_code_id": str(self.code_c.id), "source_location_id": str(self.location.id), "qty_kg": "10"}])
        self.assertEqual(response.status_code, 400)
        self.assertIn("codes are fixed", response.data["error"])

    # --- output time ----------------------------------------------------------------------------------------

    def test_short_code_at_output_names_material_code_store_and_free_codes(self):
        InventoryBulk.objects.filter(material=self.granule, granule_code=self.code_a).update(qty_kg=Decimal("4"))
        message = GranuleAvailabilityService.short_code_message(
            job=self.job, material=self.granule, code_id=str(self.code_a.id), needed_qty="10", location_id=str(self.location.id),
        )
        self.assertIn("WCM Granule", message)
        self.assertIn("10.000 kg of code GA", message)
        self.assertIn("WCM RM has only 4.000 kg", message)
        self.assertIn("Change codes", message)
        self.assertIn("GC 500.000 kg", message)
        self.assertIsNone(GranuleAvailabilityService.short_code_message(
            job=self.job, material=self.granule, code_id=str(self.code_a.id), needed_qty="4", location_id=str(self.location.id),
        ))

    def test_output_consumption_raises_the_plain_message(self):
        InventoryBulk.objects.filter(material=self.granule, granule_code=self.code_a).update(qty_kg=Decimal("4"))
        with self.assertRaisesMessage(ValueError, "this output needs 10.000 kg of code GA"):
            ExecutionService._reconcile_granule_code_consumption(
                job=self.job,
                requirement=self.requirement,
                allocations=[{"granule_code_id": str(self.code_a.id), "qty": Decimal("10")}],
                current_consumed=Decimal("0"),
                desired_consumed=Decimal("10"),
                consumption_location_id=str(self.location.id),
                location=self.location,
                estimated_flag=False,
                consume_reference="test",
            )

    def test_bulk_stock_error_names_material_and_store(self):
        with self.assertRaisesMessage(ValidationError, "Insufficient stock for WCM Granule (GR-WCM) / code GA at WCM RM"):
            BulkService.consume_bulk(
                material_id=str(self.granule.id), granule_code_id=str(self.code_a.id), qty=Decimal("90"),
                location_id=str(self.location.id), qty_uom="KG",
            )
