"""Regression tests for the inventory review hardening (2026-10-11).

Covers write authority on inventory endpoints, the read-only roll API,
location master guards, roll move/quarantine rules, retired legacy actions,
split mass balance, the WCM roll picker, bulk transfer classification and
the stock-adjustment ledger, plant/UOM checks and maker-checker posting.
"""
import importlib
from decimal import Decimal

from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext

from apps.inventory.models import (
    BulkTransaction,
    InventoryBulk,
    InventoryLocation,
    InventoryReservation,
    InventoryRoll,
    RollMovement,
    StockAdjustment,
)
from apps.inventory.services.bulk_service import BulkService
from apps.inventory.services.grn_history import GRNHistoryService
from apps.inventory.services.roll_service import RollService
from apps.inventory.tests_job_work_base import JobWorkFixtureMixin
from apps.users.permission_registry import MASTER_DATA_GRANTS
from apps.users.models import Role, User


@override_settings(STRICT_RBAC=True)
class InventoryWriteAuthorityTests(JobWorkFixtureMixin, TestCase):
    def setUp(self):
        super().setUp()
        wcm = Role.objects.get_or_create(code="WORK_CENTER_MANAGER", defaults={"name": "WCM"})[0]
        self.engineer = User.objects.create_user(username="hard-eng", extra_permissions=list(MASTER_DATA_GRANTS))
        self.wcm = User.objects.create_user(username="hard-wcm", role=wcm)

    def test_non_inventory_roles_cannot_change_stock_or_locations(self):
        roll = self.make_roll("HARD-AUTH-1", "100")
        for user in (self.sales, self.engineer):
            client = self.client_for(user)
            checks = [
                client.post("/api/inventory/locations/", {"plant": str(self.plant.id), "code": "X1", "name": "x", "type": "WAREHOUSE"}, format="json"),
                client.patch(f"/api/inventory/locations/{self.rm.id}/", {"name": "renamed"}, format="json"),
                client.post("/api/inventory/grn/create/", {"klass": "BULK", "lines": [{"qty": 1}], "vendor_id": str(self.vendor.id)}, format="json"),
                client.post("/api/inventory/inter-plant/", {"from_plant": str(self.plant.id), "to_plant": str(self.other_plant.id)}, format="json"),
                client.post(f"/api/inventory/rolls/{roll.id}/move/", {"to_location_id": str(self.fg.id), "reason": "FG_TRANSFER"}, format="json"),
                client.post(f"/api/inventory/rolls/{roll.id}/quarantine/", {"reason": "probe"}, format="json"),
                client.post("/api/inventory/bulk/transfer/", {}, format="json"),
                client.post("/api/inventory/ink-floor/issue/", {}, format="json"),
            ]
            for response in checks:
                self.assertEqual(response.status_code, 403, (user.username, response.request["PATH_INFO"], response.data))
        self.rm.refresh_from_db()
        self.assertNotEqual(self.rm.name, "renamed")
        self.assertFalse(InventoryLocation.objects.filter(code="X1").exists())

    def test_reads_stay_open_to_signed_in_staff(self):
        self.make_roll("HARD-READ-1", "10")
        client = self.client_for(self.sales)
        self.assertEqual(client.get("/api/inventory/rolls/").status_code, 200)
        self.assertEqual(client.get("/api/inventory/locations/").status_code, 200)
        self.assertEqual(client.get("/api/inventory/bulk/").status_code, 200)

    def test_shop_floor_can_move_material_between_plants(self):
        response = self.client_for(self.wcm).post(
            "/api/inventory/inter-plant/", {"from_plant": str(self.plant.id), "to_plant": str(self.other_plant.id)}, format="json"
        )
        self.assertEqual(response.status_code, 201, response.data)

    def test_floor_roles_keep_their_inventory_screens(self):
        from apps.inventory.models import InventoryAlert

        roll = self.make_roll("HARD-CONV-1", "50")
        # Permission passes for the work center (validation decides the rest).
        converted = self.client_for(self.wcm).post(f"/api/inventory/rolls/{roll.id}/convert-stock-form/", {}, format="json")
        self.assertNotEqual(converted.status_code, 403, converted.data)
        alert = InventoryAlert.objects.create(type="TXN_MISMATCH", severity="HIGH", message="Probe", plant=self.plant)
        resolved = self.client_for(self.planner).post(f"/api/inventory/alerts/{alert.id}/resolve/", {"resolution_note": "Checked"}, format="json")
        self.assertEqual(resolved.status_code, 200, resolved.data)
        refused = self.client_for(self.sales).post(f"/api/inventory/rolls/{roll.id}/convert-stock-form/", {}, format="json")
        self.assertEqual(refused.status_code, 403)

    def test_denials_are_audited_after_the_rollback(self):
        from apps.users.models import PermissionAuditLog

        self.client_for(self.sales).post("/api/inventory/locations/", {}, format="json")
        self.assertTrue(PermissionAuditLog.objects.filter(action="DENIED", user=self.sales, path="/api/inventory/locations/").exists())


class RollApiTests(JobWorkFixtureMixin, TestCase):
    def test_roll_rows_have_no_raw_create_update_or_delete(self):
        roll = self.make_roll("HARD-RAW-1", "100")
        self.assertEqual(self.api.patch(f"/api/inventory/rolls/{roll.id}/", {"weight_kg": "1"}, format="json").status_code, 405)
        self.assertEqual(self.api.put(f"/api/inventory/rolls/{roll.id}/", {"weight_kg": "1"}, format="json").status_code, 405)
        self.assertEqual(self.api.delete(f"/api/inventory/rolls/{roll.id}/").status_code, 405)
        created = self.api.post("/api/inventory/rolls/", {"label_id": "PHANTOM", "material": str(self.film.id), "weight_kg": "500", "width_mm": "830", "thickness_micron": "12", "location": str(self.rm.id), "status": "AVAILABLE"}, format="json")
        self.assertEqual(created.status_code, 405)
        roll.refresh_from_db()
        self.assertEqual(roll.weight_kg, Decimal("100.000"))
        self.assertFalse(InventoryRoll.objects.filter(label_id="PHANTOM").exists())

    def test_retired_legacy_actions_return_gone(self):
        roll = self.make_roll("HARD-RET-1", "40")
        for path, body in (
            ("/api/inventory/rolls/reserve/", {"roll_ids": [str(roll.id)], "job_id": str(roll.id)}),
            ("/api/inventory/rolls/release/", {"roll_ids": [str(roll.id)]}),
            ("/api/inventory/rolls/consume/", {}),
            ("/api/inventory/bulk/inward/", {}),
        ):
            response = self.api.post(path, body, format="json")
            self.assertEqual(response.status_code, 410, (path, response.data))
        roll.refresh_from_db()
        self.assertEqual(roll.status, "AVAILABLE")

    def test_move_rules(self):
        consumed = self.make_roll("HARD-MOVE-C", "10", status="CONSUMED")
        response = self.api.post(f"/api/inventory/rolls/{consumed.id}/move/", {"to_location_id": str(self.fg.id), "reason": "FG_TRANSFER"}, format="json")
        self.assertEqual(response.status_code, 400)

        roll = self.make_roll("HARD-MOVE-A", "10")
        virtual = self.api.post(f"/api/inventory/rolls/{roll.id}/move/", {"to_location_id": str(self.jw_out.id), "reason": "ADJUSTMENT"}, format="json")
        self.assertEqual(virtual.status_code, 400)
        cross_plant = self.api.post(f"/api/inventory/rolls/{roll.id}/move/", {"to_location_id": str(self.other_rm.id), "reason": "ADJUSTMENT"}, format="json")
        self.assertEqual(cross_plant.status_code, 400)
        system_reason = self.api.post(f"/api/inventory/rolls/{roll.id}/move/", {"to_location_id": str(self.fg.id), "reason": "DISPATCH"}, format="json")
        self.assertEqual(system_reason.status_code, 400)

        job = self.make_job("HARD-MOVE")
        reservation = InventoryReservation.objects.create(job=job, roll=roll, material=self.film, quantity=Decimal("10"))
        reserved = self.api.post(f"/api/inventory/rolls/{roll.id}/move/", {"to_location_id": str(self.fg.id), "reason": "FG_TRANSFER"}, format="json")
        self.assertEqual(reserved.status_code, 400)
        reservation.status = "RELEASED"
        reservation.save(update_fields=["status"])

        before = RollMovement.objects.filter(roll=roll).count()
        moved = self.api.post(f"/api/inventory/rolls/{roll.id}/move/", {"to_location_id": str(self.fg.id), "reason": "FG_TRANSFER"}, format="json")
        self.assertEqual(moved.status_code, 200, moved.data)
        roll.refresh_from_db()
        self.assertEqual(roll.location_id, self.fg.id)
        self.assertEqual(RollMovement.objects.filter(roll=roll).count(), before + 1)

    def test_quarantine_needs_reason_and_keeps_history(self):
        roll = self.make_roll("HARD-Q-1", "10")
        self.assertEqual(self.api.post(f"/api/inventory/rolls/{roll.id}/quarantine/", {}, format="json").status_code, 400)
        self.assertEqual(self.api.post(f"/api/inventory/rolls/{roll.id}/quarantine/", {"reason": "Pinholes"}, format="json").status_code, 200)
        self.assertEqual(self.api.post(f"/api/inventory/rolls/{roll.id}/quarantine/", {"reason": "Again"}, format="json").status_code, 400)
        self.assertEqual(self.api.post(f"/api/inventory/rolls/{roll.id}/unquarantine/", {"reason": "Cleared by QC"}, format="json").status_code, 200)
        roll.refresh_from_db()
        self.assertFalse(roll.meta_json["is_quarantined"])
        self.assertEqual([row["action"] for row in roll.meta_json["quarantine_history"]], ["QUARANTINED", "RELEASED"])

    def test_wcm_picker_filters_quarantine_in_the_database_and_validates_input(self):
        keep = self.make_roll("HARD-WCM-1", "10")
        held = self.make_roll("HARD-WCM-2", "10")
        held.meta_json = {**held.meta_json, "is_quarantined": True}
        held.save(update_fields=["meta_json"])
        rows = self.api.get("/api/inventory/rolls/for-wcm/", {"plant": str(self.plant.id)}).data
        labels = {row["label_id"] for row in rows}
        self.assertIn(keep.label_id, labels)
        self.assertNotIn(held.label_id, labels)
        self.assertEqual(self.api.get("/api/inventory/rolls/for-wcm/", {"stage_index": "x"}).status_code, 400)
        self.assertEqual(self.api.get("/api/inventory/rolls/", {"width_min": "wide"}).status_code, 400)
        self.assertEqual(self.api.get("/api/inventory/rolls/for-wcm/", {"material": "not-a-uuid"}).status_code, 400)

    def test_roll_list_query_count_does_not_grow_per_roll(self):
        job = self.make_job("HARD-NPLUS1")
        for index in range(5):
            self.make_roll(f"HARD-N-{index}", "10", job=job)
        with CaptureQueriesContext(connection) as few:
            self.api.get("/api/inventory/rolls/")
        for index in range(5, 25):
            self.make_roll(f"HARD-N-{index}", "10", job=job)
        with CaptureQueriesContext(connection) as many:
            self.api.get("/api/inventory/rolls/")
        self.assertLessEqual(len(many.captured_queries) - len(few.captured_queries), 2)


class RollSplitTests(JobWorkFixtureMixin, TestCase):
    def test_split_must_balance_and_logs_child_movements(self):
        roll = self.make_roll("HARD-SPLIT-1", "20")
        with self.assertRaises(ValueError):
            RollService.split_roll(roll, [{"weight_kg": "12"}])
        children = RollService.split_roll(roll, [{"weight_kg": "12"}, {"weight_kg": "8"}], reason="TEST")
        roll.refresh_from_db()
        self.assertEqual((roll.status, roll.weight_kg), ("CONSUMED", Decimal("0.000")))
        self.assertEqual(sum(child.weight_kg for child in children), Decimal("20"))
        for child in children:
            self.assertTrue(RollMovement.objects.filter(roll=child, to_location=self.rm).exists())
        with self.assertRaises(ValueError):
            RollService.split_roll(roll, [{"weight_kg": "1"}])

    def test_child_label_never_collides(self):
        roll = self.make_roll("HARD-SPLIT-2", "10")
        self.make_roll("HARD-SPLIT-2-A", "1")
        children = RollService.split_roll(roll, [{"weight_kg": "6", "label_suffix": "A"}, {"weight_kg": "4", "label_suffix": "B"}])
        self.assertEqual(len({child.label_id for child in children}), 2)
        self.assertNotIn("HARD-SPLIT-2-A", {child.label_id for child in children})


class BulkTransferClassificationTests(JobWorkFixtureMixin, TestCase):
    def test_transfer_legs_are_transfers_not_receipts(self):
        BulkService.add_bulk(self.granule.id, Decimal("50"), self.plant.id, self.rm.id, cost=Decimal("100"), reference="GRN-1", vendor_id=self.vendor.id, vendor_invoice_no="INV-1")
        BulkService.transfer_bulk(str(self.granule.id), Decimal("20"), str(self.rm.id), str(self.wip.id), reference="WCM")
        legs = BulkTransaction.objects.filter(reference__startswith="Transfer")
        self.assertEqual(set(legs.values_list("type", flat=True)), {"TRANSFER"})
        history = GRNHistoryService.list_history({"source_type": "BULK"})
        self.assertEqual(len(history), 1)
        with self.assertRaises(Exception):
            BulkService.transfer_bulk(str(self.granule.id), Decimal("1"), str(self.rm.id), str(self.rm.id))

    def test_migration_retypes_only_unlinked_historical_legs(self):
        migration = importlib.import_module("apps.inventory.migrations.0057_retype_bulk_transfer_legs")
        bulk = InventoryBulk.objects.create(material=self.granule, plant=self.plant, location=self.wip, qty_kg=Decimal("5"))
        old_in = BulkTransaction.objects.create(material=self.granule, location=self.wip, type="INWARD", qty_kg=Decimal("5"), reference="Transfer In: legacy")
        old_out = BulkTransaction.objects.create(material=self.granule, location=self.rm, type="CONSUME", qty_kg=Decimal("-5"), reference="Transfer Out: legacy")
        real_grn = BulkTransaction.objects.create(material=self.granule, location=self.rm, type="INWARD", qty_kg=Decimal("5"), reference="Transfer In: odd", vendor=self.vendor, vendor_invoice_no="V-1")
        from django.apps import apps as global_apps

        migration.retype_transfer_legs(global_apps, None)
        old_in.refresh_from_db(); old_out.refresh_from_db(); real_grn.refresh_from_db()
        self.assertEqual((old_in.type, old_out.type, real_grn.type), ("TRANSFER", "TRANSFER", "INWARD"))
        self.assertTrue(bulk.pk)


class StockAdjustmentHardeningTests(JobWorkFixtureMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.second_store = User.objects.create_user(username="hard-store-2", role=self.store.role)
        BulkService.add_bulk(self.granule.id, Decimal("100"), self.plant.id, self.rm.id, cost=Decimal("80"), reference="GRN-ADJ", vendor_id=self.vendor.id, vendor_invoice_no="INV-ADJ")

    def _draft(self, client, lines, plant=None):
        response = client.post("/api/inventory/adjustments/", {"plant": str((plant or self.plant).id), "reason": "COUNT_CORRECTION", "lines": lines}, format="json")
        return response

    def _bulk_line(self, delta, location=None, uom="KG"):
        return {"stock_class": "BULK", "inventory_material": str(self.granule.id), "location": str((location or self.rm).id), "delta_qty": str(delta), "uom": uom}

    def test_second_person_posts_and_ledger_ties_out(self):
        draft = self._draft(self.api, [self._bulk_line("-10")])
        self.assertEqual(draft.status_code, 201, draft.data)
        self.assertFalse(draft.data["can_post"])
        own = self.api.post(f"/api/inventory/adjustments/{draft.data['id']}/post/")
        self.assertEqual(own.status_code, 400)
        posted = self.client_for(self.second_store).post(f"/api/inventory/adjustments/{draft.data['id']}/post/")
        self.assertEqual(posted.status_code, 200, posted.data)
        pool = InventoryBulk.objects.get(material=self.granule, location=self.rm)
        self.assertEqual(pool.qty_kg, Decimal("90.0000"))
        ledger_total = sum(BulkTransaction.objects.filter(material=self.granule, location=self.rm).values_list("qty_kg", flat=True))
        self.assertEqual(ledger_total, pool.qty_kg)

        voided = self.api.post(f"/api/inventory/adjustments/{draft.data['id']}/void/")
        self.assertEqual(voided.status_code, 200, voided.data)
        pool.refresh_from_db()
        self.assertEqual(pool.qty_kg, Decimal("100.0000"))
        ledger_total = sum(BulkTransaction.objects.filter(material=self.granule, location=self.rm).values_list("qty_kg", flat=True))
        self.assertEqual(ledger_total, pool.qty_kg)

    def test_owner_may_post_own_adjustment(self):
        owner = self.client_for(self.owner)
        draft = self._draft(owner, [self._bulk_line("5")])
        self.assertTrue(draft.data["can_post"])
        self.assertEqual(owner.post(f"/api/inventory/adjustments/{draft.data['id']}/post/").status_code, 200)

    def test_plant_uom_and_virtual_location_checks(self):
        self.assertEqual(self._draft(self.api, [self._bulk_line("5", location=self.other_rm)]).status_code, 400)
        self.assertEqual(self._draft(self.api, [self._bulk_line("5", uom="G")]).status_code, 400)
        self.assertEqual(self._draft(self.api, [self._bulk_line("5", location=self.jw_out)]).status_code, 400)

    def test_consumed_roll_cannot_be_revived_and_void_checks_roll_state(self):
        consumed = self.make_roll("HARD-ADJ-C", "10", status="CONSUMED")
        line = {"stock_class": "ROLL", "inventory_roll": str(consumed.id), "delta_qty": "5", "uom": "KG"}
        draft = self._draft(self.api, [line])
        self.assertEqual(draft.status_code, 201, draft.data)
        self.assertEqual(self.client_for(self.second_store).post(f"/api/inventory/adjustments/{draft.data['id']}/post/").status_code, 400)
        consumed.refresh_from_db()
        self.assertEqual(consumed.status, "CONSUMED")

        roll = self.make_roll("HARD-ADJ-A", "10")
        draft = self._draft(self.api, [{"stock_class": "ROLL", "inventory_roll": str(roll.id), "delta_qty": "-2", "uom": "KG"}])
        self.assertEqual(self.client_for(self.second_store).post(f"/api/inventory/adjustments/{draft.data['id']}/post/").status_code, 200)
        self.assertTrue(RollMovement.objects.filter(roll=roll, reason="ADJUSTMENT").exists())
        InventoryRoll.objects.filter(id=roll.id).update(weight_kg=Decimal("3"))
        self.assertEqual(self.api.post(f"/api/inventory/adjustments/{draft.data['id']}/void/").status_code, 400)
        self.assertEqual(StockAdjustment.objects.get(id=draft.data["id"]).status, "POSTED")
