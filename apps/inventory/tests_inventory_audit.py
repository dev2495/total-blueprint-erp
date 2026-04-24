from decimal import Decimal

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import RequestFactory, TestCase
from django.utils import timezone

from apps.factory.models import Plant
from apps.inventory.models import (
    BulkTransaction,
    InventoryAuditBatch,
    InventoryBulk,
    InventoryLocation,
    InventoryRoll,
    PackagingStock,
    PackagingTransaction,
    RollMovement,
)
from apps.inventory.services.audit import InventoryAuditService
from apps.materials.models import GranuleQualityCode, InventoryMaterial
from apps.recipes.models import RecipeGrade
from apps.users.models import Role, User
from apps.users.permissions import RoleBasedAccessPermission


class InventoryAuditServiceTests(TestCase):
    def setUp(self):
        self.plant = Plant.objects.create(name="Plant A", code="PA")
        self.location = InventoryLocation.objects.create(plant=self.plant, code="RM", name="RM Store", type="RM")
        self.fg_location = InventoryLocation.objects.create(plant=self.plant, code="FG", name="FG Store", type="FG")
        self.granule = InventoryMaterial.objects.create(code="G-LLDPE", name="LLDPE", category="GRANULE", base_uom="KG")
        self.granule_code = GranuleQualityCode.objects.create(granule=self.granule, code="G4")
        self.packaging = InventoryMaterial.objects.create(
            code="PK-SHEET",
            name="Packing Sheet",
            category="PACKAGING",
            base_uom="KG",
            packaging_kind="SHEET",
            packaging_supply_mode="PURCHASED",
        )
        self.family = InventoryMaterial.objects.create(
            code="PET-FAM",
            name="PET Family",
            category="FILM_FAMILY",
            base_uom="KG",
            density_gcm3=Decimal("0.9200"),
        )
        self.grade = RecipeGrade.objects.create(name="GP")
        self.variant = InventoryMaterial.objects.create(
            code="MILKY",
            name="Milky Variant",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=self.family,
            is_extrudable=True,
            is_purchasable=True,
        )
        self.role = Role.objects.create(code="STORE", name="Store", default_permissions=["inventory.audit.view", "inventory.audit.manage"])
        self.user = User.objects.create_user(username="store", password="pass1234", role=self.role)

    def _batch(self, batch_type="OPENING_STOCK"):
        return InventoryAuditService.create_batch(
            payload={
                "type": batch_type,
                "plant": str(self.plant.id),
                "financial_year": "2026-2027",
                "cutoff_at": timezone.now().isoformat(),
            },
            user=self.user,
        )

    def test_opening_stock_posts_bulk_packaging_and_roll_without_grn(self):
        batch = self._batch()
        InventoryAuditService.import_lines(
            batch=batch,
            rows=[
                {
                    "stock_class": "BULK",
                    "material": str(self.granule.id),
                    "granule_code": str(self.granule_code.id),
                    "location": str(self.location.id),
                    "quantity": "125.5000",
                    "rate": "80",
                },
                {
                    "stock_class": "PACKAGING",
                    "material": str(self.packaging.id),
                    "location": str(self.location.id),
                    "quantity": "42.0000",
                },
                {
                    "stock_class": "ROLL",
                    "material": str(self.variant.id),
                    "grade": str(self.grade.id),
                    "location": str(self.fg_location.id),
                    "quantity": "50.0000",
                    "label_id": "OPEN-ROLL-001",
                    "width_mm": "500",
                    "thickness_micron": "50",
                    "is_fg": True,
                    "stage_index": 5,
                },
            ],
        )

        posted = InventoryAuditService.post_batch(batch=batch, user=self.user)

        self.assertEqual(posted.status, "POSTED")
        self.assertEqual(
            InventoryBulk.objects.get(material=self.granule, granule_code=self.granule_code).qty_kg,
            Decimal("125.5000"),
        )
        self.assertEqual(PackagingStock.objects.get(material=self.packaging).qty, Decimal("42.0000"))
        roll = InventoryRoll.objects.get(label_id="OPEN-ROLL-001")
        self.assertEqual(roll.weight_kg, Decimal("50.0000"))
        self.assertTrue(roll.is_fg)
        self.assertTrue(BulkTransaction.objects.filter(type="OPENING_BALANCE", reference__startswith="OPENING_STOCK:2026-2027").exists())
        self.assertFalse(BulkTransaction.objects.filter(type="INWARD", reference__startswith="OPENING_STOCK").exists())
        self.assertTrue(PackagingTransaction.objects.filter(type="OPENING_BALANCE", reference__startswith="OPENING_STOCK:2026-2027").exists())
        self.assertTrue(RollMovement.objects.filter(roll=roll, reason="OPENING_BALANCE", reason_note__startswith="OPENING_STOCK").exists())

    def test_rate_is_optional_and_value_stays_zero_when_missing(self):
        batch = self._batch()
        InventoryAuditService.import_lines(
            batch=batch,
            rows=[{"stock_class": "BULK", "material": str(self.granule.id), "location": str(self.location.id), "quantity": "10"}],
        )
        line = batch.lines.get()
        self.assertIsNone(line.rate)
        self.assertEqual(line.value, Decimal("0.0000"))

    def test_opening_stock_blocks_after_movement_in_same_fy(self):
        BulkTransaction.objects.create(material=self.granule, granule_code=self.granule_code, location=self.location, type="INWARD", qty_kg=Decimal("25"), reference="GRN-1")
        batch = self._batch()
        InventoryAuditService.import_lines(
            batch=batch,
            rows=[{"stock_class": "BULK", "material": str(self.granule.id), "granule_code": str(self.granule_code.id), "location": str(self.location.id), "quantity": "10"}],
        )
        validation = InventoryAuditService.validate_batch(batch=batch)
        self.assertFalse(validation["ok"])
        self.assertIn("E-OS-05", validation["errors"][0]["errors"][0])

    def test_physical_count_posts_only_variance(self):
        BulkTransaction.objects.create(material=self.granule, granule_code=self.granule_code, location=self.location, type="ADJUST", qty_kg=Decimal("25"), reference="seed")
        InventoryBulk.objects.create(material=self.granule, granule_code=self.granule_code, plant=self.plant, location=self.location, qty_kg=Decimal("25"))
        batch = self._batch("PHYSICAL_COUNT")
        InventoryAuditService.import_lines(
            batch=batch,
            rows=[
                {
                    "stock_class": "BULK",
                    "material": str(self.granule.id),
                    "granule_code": str(self.granule_code.id),
                    "location": str(self.location.id),
                    "counted_qty": "30",
                }
            ],
        )
        InventoryAuditService.post_batch(batch=batch, user=self.user)
        self.assertEqual(InventoryBulk.objects.get(material=self.granule, granule_code=self.granule_code).qty_kg, Decimal("30.0000"))
        tx = BulkTransaction.objects.filter(reference__startswith="PHYSICAL_COUNT").latest("created_at")
        self.assertEqual(tx.qty_kg, Decimal("5.0000"))
        self.assertEqual(tx.type, "COUNT_EXCESS")

    def test_stock_card_includes_opening_rows_and_movements(self):
        batch = self._batch()
        InventoryAuditService.import_lines(
            batch=batch,
            rows=[{"stock_class": "BULK", "material": str(self.granule.id), "location": str(self.location.id), "quantity": "12"}],
        )
        InventoryAuditService.post_batch(batch=batch, user=self.user)
        card = InventoryAuditService.stock_card(material_id=str(self.granule.id), plant_id=str(self.plant.id))
        self.assertGreaterEqual(card["opening_qty"], 12)
        self.assertTrue(any(row["source"] == "OPENING_STOCK" for row in card["rows"]))
        self.assertFalse(any(row["source"] == "BULK_ADJUST" for row in card["rows"] if row["reference"].startswith("OPENING_STOCK")))
        self.assertIn("balance_qty", card["rows"][-1])

    def test_preview_submit_approve_and_post_workflow_records_state(self):
        checker = User.objects.create_user(username="checker", password="pass1234", role=self.role)
        batch = self._batch()
        InventoryAuditService.import_lines(
            batch=batch,
            rows=[{"stock_class": "BULK", "material": str(self.granule.id), "location": str(self.location.id), "quantity": "14"}],
        )
        preview = InventoryAuditService.preview_batch(batch=batch)
        self.assertTrue(preview["ok"])
        self.assertEqual(preview["transaction_count"], 1)

        submitted = InventoryAuditService.submit_batch(batch=batch, user=self.user)
        self.assertEqual(submitted.status, "SUBMITTED")
        approved = InventoryAuditService.approve_batch(batch=submitted, user=checker)
        self.assertEqual(approved.status, "APPROVED")
        posted = InventoryAuditService.post_batch(batch=approved, user=checker)
        self.assertEqual(posted.status, "POSTED")

    def test_load_batch_from_snapshot_replaces_lines_with_live_system_stock(self):
        InventoryBulk.objects.create(material=self.granule, granule_code=self.granule_code, plant=self.plant, location=self.location, qty_kg=Decimal("18.5000"))
        batch = self._batch("PHYSICAL_COUNT")
        InventoryAuditService.load_batch_from_snapshot(batch=batch, stock_class="BULK")
        line = batch.lines.get()
        self.assertEqual(line.material, self.granule)
        self.assertEqual(line.counted_qty, Decimal("18.5000"))
        self.assertEqual(line.system_qty, Decimal("18.5000"))

    def test_csv_import_file_adds_rows(self):
        batch = self._batch()
        uploaded = SimpleUploadedFile(
            "opening.csv",
            (
                "stock_class,material,location,quantity,rate,granule_code\n"
                f"BULK,{self.granule.id},{self.location.id},25,80,{self.granule_code.id}\n"
            ).encode("utf-8"),
            content_type="text/csv",
        )
        InventoryAuditService.import_file(batch=batch, uploaded_file=uploaded)
        line = batch.lines.get()
        self.assertEqual(line.material, self.granule)
        self.assertEqual(line.granule_code, self.granule_code)
        self.assertEqual(line.opening_qty, Decimal("25"))

    def test_batch_export_and_sample_template_generate_xlsx(self):
        batch = self._batch()
        InventoryAuditService.import_lines(
            batch=batch,
            rows=[{"stock_class": "BULK", "material": str(self.granule.id), "location": str(self.location.id), "quantity": "10"}],
        )
        content, file_name = InventoryAuditService.build_batch_workbook(batch=batch)
        sample_content, sample_name = InventoryAuditService.build_sample_template(batch_type="OPENING_STOCK", stock_class="BULK")
        self.assertTrue(file_name.endswith(".xlsx"))
        self.assertTrue(sample_name.endswith(".xlsx"))
        self.assertGreater(len(content), 100)
        self.assertGreater(len(sample_content), 100)


class InventoryAuditPermissionTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.permission = RoleBasedAccessPermission()
        self.view = type("StrictView", (), {"rbac_strict": True})()
        self.store_role = Role.objects.create(code="STORE", name="Store", default_permissions=["inventory.audit.view", "inventory.audit.manage"])
        self.planner_role = Role.objects.create(code="PLANNER", name="Planner", default_permissions=["inventory.audit.view"])
        self.sales_role = Role.objects.create(code="SALES", name="Sales", default_permissions=["sales.view"])
        self.store = User.objects.create_user(username="store-audit", password="pass", role=self.store_role)
        self.planner = User.objects.create_user(username="planner-audit", password="pass", role=self.planner_role)
        self.sales = User.objects.create_user(username="sales-audit", password="pass", role=self.sales_role)

    def _allows(self, user, method, path):
        request = getattr(self.factory, method.lower())(path)
        request.user = user
        return self.permission.has_permission(request, self.view)

    def test_store_can_post_planner_can_only_view_sales_cannot_access_audit(self):
        self.assertTrue(self._allows(self.store, "POST", "/api/inventory/audit/batches/"))
        self.assertTrue(self._allows(self.planner, "GET", "/api/inventory/audit/batches/"))
        self.assertFalse(self._allows(self.planner, "POST", "/api/inventory/audit/batches/"))
        self.assertFalse(self._allows(self.sales, "GET", "/api/inventory/audit/batches/"))
