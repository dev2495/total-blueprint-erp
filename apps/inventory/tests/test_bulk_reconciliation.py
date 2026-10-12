"""Nightly bulk reconciliation: per-quality-code comparison and alert upkeep."""
from decimal import Decimal
from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from apps.factory.models import Plant
from apps.inventory.models import BulkTransaction, InventoryAlert, InventoryBulk, InventoryLocation
from apps.inventory.services.inventory_audit_service import InventoryAuditService
from apps.materials.models import GranuleQualityCode, InventoryMaterial


class BulkReconciliationTests(TestCase):
    def setUp(self):
        self.plant = Plant.objects.create(name="Plant A", code="PA", include_in_official_reports=True)
        self.location = InventoryLocation.objects.create(plant=self.plant, code="RM", name="RM Store", type="RM")
        self.granule = InventoryMaterial.objects.create(code="G-LLDPE", name="LLDPE", category="GRANULE", base_uom="KG")
        self.code_a = GranuleQualityCode.objects.create(granule=self.granule, code="A")
        self.code_b = GranuleQualityCode.objects.create(granule=self.granule, code="B")

    def _stock(self, code, qty):
        return InventoryBulk.objects.create(material=self.granule, granule_code=code, plant=self.plant, location=self.location, qty_kg=Decimal(qty))

    def _ledger(self, code, qty, tx_type="INWARD"):
        return BulkTransaction.objects.create(material=self.granule, granule_code=code, location=self.location, type=tx_type, qty_kg=Decimal(qty), reference="seed")

    def _open(self, alert_type="TXN_MISMATCH"):
        return InventoryAlert.objects.filter(type=alert_type, resolved=False)

    def test_stock_split_by_quality_code_ties_to_its_own_ledger(self):
        self._stock(self.code_a, "300"); self._ledger(self.code_a, "300")
        self._stock(self.code_b, "200"); self._ledger(self.code_b, "200")
        self.assertEqual(InventoryAuditService.bulk_ledger_gaps(self.plant), [])
        self.assertEqual(InventoryAuditService.run_bulk_reconciliation(self.plant), [])
        self.assertFalse(self._open().exists())

    def test_real_gap_raises_one_alert_and_keeps_it_current(self):
        self._stock(self.code_a, "375"); self._ledger(self.code_a, "300")
        self._stock(None, "50")  # no ledger at all
        first = InventoryAuditService.run_bulk_reconciliation(self.plant)
        self.assertEqual(len(first), 2)
        self.assertEqual(self._open().count(), 2)
        keyed = self._open().get(scope_key=InventoryAuditService.bulk_scope_key(self.granule.id, self.code_a.id, self.location.id))
        self.assertEqual((keyed.expected_value, keyed.actual_value, keyed.severity), (Decimal("300.000"), Decimal("375.000"), "HIGH"))
        self.assertIn("[A]", keyed.message)

        InventoryAuditService.run_bulk_reconciliation(self.plant)
        InventoryAuditService.run_full_audit(self.plant)
        self.assertEqual(self._open().count(), 2, "a second run must update, not duplicate")
        self.assertEqual(InventoryAlert.objects.filter(type="TXN_MISMATCH").count(), 2)
        keyed.refresh_from_db()
        self.assertIsNotNone(keyed.last_seen_at)

        gaps = InventoryAuditService.bulk_ledger_gaps(self.plant)
        self.assertEqual(sorted(g["gap"] for g in gaps), [Decimal("50"), Decimal("75")])
        self.assertEqual([g["has_ledger"] for g in gaps if g["bulk"].granule_code_id is None], [False])

    def test_alert_resolves_itself_when_the_gap_is_corrected(self):
        self._stock(self.code_a, "375"); self._ledger(self.code_a, "300")
        InventoryAuditService.run_bulk_reconciliation(self.plant)
        alert = self._open().get()
        self._ledger(self.code_a, "75", tx_type="OPENING_BALANCE_ADJUST")
        self.assertEqual(InventoryAuditService.run_bulk_reconciliation(self.plant), [])
        alert.refresh_from_db()
        self.assertTrue(alert.resolved)
        self.assertEqual(alert.resolution_note, InventoryAuditService.AUTO_RESOLUTION_NOTE)
        # Alerts the reconciliation does not own are left alone.
        other = InventoryAlert.objects.create(type="LOW_STOCK", message="x", material=self.granule, plant=self.plant, scope_key="custom")
        InventoryAuditService.run_full_audit(self.plant)
        other.refresh_from_db()
        self.assertFalse(other.resolved)

    def test_collapse_command_resolves_legacy_pile_and_reraises_once(self):
        self._stock(self.code_a, "375"); self._ledger(self.code_a, "300")
        for _ in range(5):
            InventoryAlert.objects.create(type="TXN_MISMATCH", message="legacy", material=self.granule, plant=self.plant)
        InventoryAlert.objects.create(type="STUCK_WIP", message="legacy", plant=self.plant)
        out = StringIO()
        call_command("collapse_inventory_alerts", "--dry-run", stdout=out)
        self.assertEqual(InventoryAlert.objects.filter(resolved=False).count(), 6)
        call_command("collapse_inventory_alerts", stdout=out)
        self.assertEqual(InventoryAlert.objects.filter(resolved=True, scope_key="").count(), 6)
        self.assertEqual(self._open().count(), 1)
        call_command("collapse_inventory_alerts", stdout=out)
        self.assertEqual(self._open().count(), 1, "running twice must not change anything")

    def test_gap_list_command_is_read_only(self):
        self._stock(self.code_a, "375"); self._ledger(self.code_a, "300")
        out = StringIO()
        call_command("bulk_ledger_gaps", "--plant", "PA", stdout=out)
        text = out.getvalue()
        self.assertIn("G-LLDPE", text)
        self.assertIn("+75.000", text)
        self.assertIn("1 row(s) with a gap", text)
        self.assertFalse(InventoryAlert.objects.exists())
        self.assertEqual(BulkTransaction.objects.count(), 1)
