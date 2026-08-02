from decimal import Decimal

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase


class CanonicalGranuleCodeMigrationTests(TransactionTestCase):
    """Proves duplicate spellings merge stock without changing total quantity."""

    migrate_from = [
        ("materials", "0049_materialcodealias"),
        ("inventory", "0050_interplantchallanitem_granule_code"),
        ("production", "0070_delivery_challan_item_reservations"),
    ]
    migrate_to = [
        ("materials", "0050_canonical_granule_quality_codes"),
        ("inventory", "0050_interplantchallanitem_granule_code"),
        ("production", "0070_delivery_challan_item_reservations"),
    ]

    def setUp(self):
        super().setUp()
        executor = MigrationExecutor(connection)
        executor.migrate(self.migrate_from)
        old_apps = executor.loader.project_state(self.migrate_from).apps

        Plant = old_apps.get_model("factory", "Plant")
        Location = old_apps.get_model("inventory", "InventoryLocation")
        Material = old_apps.get_model("materials", "InventoryMaterial")
        QualityCode = old_apps.get_model("materials", "GranuleQualityCode")
        Bulk = old_apps.get_model("inventory", "InventoryBulk")

        plant = Plant.objects.create(name="Migration Plant", code="MIG-PLANT")
        location = Location.objects.create(
            plant=plant,
            code="MIG-RM",
            name="Migration RM",
            type="RM",
        )
        material = Material.objects.create(
            code="MIG-MASTER-BATCH",
            name="Migration Master Batch",
            category="GRANULE",
            base_uom="KG",
        )
        self.legacy_id = QualityCode.objects.create(
            granule=material,
            code="SLIP-110 C",
            status="ACTIVE",
        ).id
        self.canonical_id = QualityCode.objects.create(
            granule=material,
            code="SLIP-110-C",
            status="ACTIVE",
        ).id
        Bulk.objects.create(
            material=material,
            granule_code_id=self.legacy_id,
            plant=plant,
            location=location,
            qty_kg=Decimal("2000.0000"),
            avg_cost=Decimal("71.5000"),
        )
        Bulk.objects.create(
            material=material,
            granule_code_id=self.canonical_id,
            plant=plant,
            location=location,
            qty_kg=Decimal("5.0000"),
            avg_cost=Decimal("80.0000"),
        )

        executor = MigrationExecutor(connection)
        executor.migrate(self.migrate_to)
        self.apps = executor.loader.project_state(self.migrate_to).apps

    def tearDown(self):
        MigrationExecutor(connection).migrate(self.migrate_to)
        super().tearDown()

    def test_duplicate_stock_moves_to_exact_canonical_code_with_audit_entries(self):
        QualityCode = self.apps.get_model("materials", "GranuleQualityCode")
        Bulk = self.apps.get_model("inventory", "InventoryBulk")
        BulkTransaction = self.apps.get_model("inventory", "BulkTransaction")

        legacy = QualityCode.objects.get(pk=self.legacy_id)
        canonical = QualityCode.objects.get(pk=self.canonical_id)

        self.assertEqual(canonical.code, "SLIP-110-C")
        self.assertEqual(canonical.canonical_key, "SLIP-110-C")
        self.assertEqual(canonical.status, "ACTIVE")
        self.assertEqual(legacy.status, "INACTIVE")
        self.assertEqual(legacy.merged_into_id, canonical.id)
        self.assertEqual(
            Bulk.objects.get(granule_code_id=canonical.id).qty_kg,
            Decimal("2005.0000"),
        )
        self.assertEqual(
            Bulk.objects.get(granule_code_id=legacy.id).qty_kg,
            Decimal("0.0000"),
        )
        audit_rows = BulkTransaction.objects.filter(
            reference__startswith="SYSTEM-CANONICAL-CODE-MERGE:"
        )
        self.assertEqual(audit_rows.count(), 2)
        self.assertEqual(
            sum(audit_rows.values_list("qty_kg", flat=True), Decimal("0")),
            Decimal("0.0000"),
        )

