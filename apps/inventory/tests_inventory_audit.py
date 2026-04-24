from decimal import Decimal

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import RequestFactory, TestCase
from django.utils import timezone

from apps.factory.models import Plant
from apps.inventory.models import (
    BulkTransaction,
    InventoryAuditBatch,
    InventoryAuditLine,
    InventoryBulk,
    InventoryFinancialPeriod,
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

    def test_stock_card_filters_to_financial_year_and_excludes_closing_snapshot(self):
        prior_batch = InventoryAuditBatch.objects.create(
            type="OPENING_STOCK",
            plant=self.plant,
            financial_year="2025-2026",
            cutoff_at=timezone.datetime(2025, 4, 1, tzinfo=timezone.get_current_timezone()),
            status="POSTED",
        )
        InventoryAuditLine.objects.create(
            batch=prior_batch,
            stock_class="BULK",
            material=self.granule,
            granule_code=self.granule_code,
            plant=self.plant,
            location=self.location,
            opening_qty=Decimal("7"),
        )
        closing_batch = InventoryAuditBatch.objects.create(
            type="FY_CLOSE",
            plant=self.plant,
            financial_year="2026-2027",
            cutoff_at=timezone.datetime(2027, 3, 31, 23, 59, tzinfo=timezone.get_current_timezone()),
            status="LOCKED",
        )
        InventoryAuditLine.objects.create(
            batch=closing_batch,
            stock_class="BULK",
            material=self.granule,
            granule_code=self.granule_code,
            plant=self.plant,
            location=self.location,
            opening_qty=Decimal("999"),
            counted_qty=Decimal("999"),
        )
        current_batch = self._batch()
        InventoryAuditService.import_lines(
            batch=current_batch,
            rows=[{"stock_class": "BULK", "material": str(self.granule.id), "granule_code": str(self.granule_code.id), "location": str(self.location.id), "quantity": "12"}],
        )
        InventoryAuditService.post_batch(batch=current_batch, user=self.user)

        card = InventoryAuditService.stock_card(material_id=str(self.granule.id), plant_id=str(self.plant.id), financial_year="2026-2027")

        self.assertEqual(card["opening_qty"], 12)
        self.assertFalse(any(row["source"] == "FY_CLOSE" for row in card["rows"]))
        self.assertTrue(all("2026-2027" in row["reference"] for row in card["rows"] if row["source"] == "OPENING_STOCK"))

    def test_fy_correction_requires_closed_period_and_syncs_next_opening(self):
        InventoryBulk.objects.create(material=self.granule, granule_code=self.granule_code, plant=self.plant, location=self.location, qty_kg=Decimal("100"))
        current_period = InventoryFinancialPeriod.objects.create(
            financial_year="2026-2027",
            start_date=timezone.datetime(2026, 4, 1).date(),
            end_date=timezone.datetime(2027, 3, 31).date(),
            status="OPEN",
        )
        with self.assertRaisesMessage(Exception, "FY correction can only be created for a closed financial year"):
            InventoryAuditService.create_batch(
                payload={
                    "type": "FY_CORRECTION",
                    "plant": str(self.plant.id),
                    "financial_year": current_period.financial_year,
                    "notes": "Wrong year",
                },
                user=self.user,
            )

        closed_period = InventoryFinancialPeriod.objects.create(
            financial_year="2025-2026",
            start_date=timezone.datetime(2025, 4, 1).date(),
            end_date=timezone.datetime(2026, 3, 31).date(),
            status="CLOSED",
        )
        next_opening = InventoryAuditBatch.objects.create(
            type="OPENING_STOCK",
            plant=self.plant,
            financial_year="2026-2027",
            cutoff_at=timezone.datetime(2026, 4, 1, tzinfo=timezone.get_current_timezone()),
            status="POSTED",
        )
        next_line = InventoryAuditLine.objects.create(
            batch=next_opening,
            stock_class="BULK",
            material=self.granule,
            granule_code=self.granule_code,
            plant=self.plant,
            location=self.location,
            opening_qty=Decimal("100"),
            system_qty=Decimal("100"),
            counted_qty=Decimal("100"),
        )
        closed_period.opening_batch_next_year = next_opening
        closed_period.save(update_fields=["opening_batch_next_year", "updated_at"])

        correction = InventoryAuditService.create_batch(
            payload={
                "type": "FY_CORRECTION",
                "plant": str(self.plant.id),
                "financial_year": "2025-2026",
                "notes": "Approved late count correction",
            },
            user=self.user,
        )
        self.assertEqual(correction.cutoff_at.date(), closed_period.end_date)
        InventoryAuditService.import_lines(
            batch=correction,
            rows=[
                {
                    "stock_class": "BULK",
                    "material": str(self.granule.id),
                    "granule_code": str(self.granule_code.id),
                    "location": str(self.location.id),
                    "counted_qty": "115",
                }
            ],
        )
        InventoryAuditService.post_batch(batch=correction, user=self.user)

        next_line.refresh_from_db()
        self.assertEqual(next_line.opening_qty, Decimal("115.0000"))
        self.assertEqual(InventoryBulk.objects.get(material=self.granule, granule_code=self.granule_code).qty_kg, Decimal("115.0000"))
        self.assertEqual(next_line.posted_reference_json["fy_corrections"][0]["delta_qty"], 15.0)

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

    def test_full_lifecycle_math_open_count_close_correction_and_stock_card(self):
        checker = User.objects.create_user(username="checker-cycle", password="pass1234", role=self.role)
        period = InventoryAuditService.start_period(financial_year="2026-2027", user=self.user)

        opening = self._batch()
        InventoryAuditService.import_lines(
            batch=opening,
            rows=[
                {
                    "stock_class": "BULK",
                    "material": str(self.granule.id),
                    "granule_code": str(self.granule_code.id),
                    "location": str(self.location.id),
                    "quantity": "100",
                    "rate": "10",
                }
            ],
        )
        self.assertEqual(InventoryAuditService.preview_batch(batch=opening)["transaction_count"], 1)
        opening = InventoryAuditService.submit_batch(batch=opening, user=self.user)
        opening = InventoryAuditService.approve_batch(batch=opening, user=checker)
        InventoryAuditService.post_batch(batch=opening, user=checker)
        self.assertEqual(InventoryBulk.objects.get(material=self.granule, granule_code=self.granule_code).qty_kg, Decimal("100.0000"))

        count = self._batch("PHYSICAL_COUNT")
        InventoryAuditService.import_lines(
            batch=count,
            rows=[
                {
                    "stock_class": "BULK",
                    "material": str(self.granule.id),
                    "granule_code": str(self.granule_code.id),
                    "location": str(self.location.id),
                    "counted_qty": "88",
                    "rate": "10",
                }
            ],
        )
        line = count.lines.get()
        self.assertEqual(line.system_qty, Decimal("100.0000"))
        self.assertEqual(line.variance_qty, Decimal("-12.0000"))
        self.assertEqual(line.value, Decimal("120.0000"))
        count = InventoryAuditService.submit_batch(batch=count, user=self.user)
        count = InventoryAuditService.approve_batch(batch=count, user=checker)
        InventoryAuditService.post_batch(batch=count, user=checker)
        self.assertEqual(InventoryBulk.objects.get(material=self.granule, granule_code=self.granule_code).qty_kg, Decimal("88.0000"))
        short_tx = BulkTransaction.objects.filter(type="COUNT_SHORT").latest("created_at")
        self.assertEqual(short_tx.qty_kg, Decimal("-12.0000"))

        before_close_card = InventoryAuditService.stock_card(material_id=str(self.granule.id), plant_id=str(self.plant.id), financial_year="2026-2027")
        self.assertEqual(before_close_card["opening_qty"], 100.0)
        self.assertEqual(before_close_card["movement_qty"], -12.0)
        self.assertEqual(before_close_card["closing_qty"], 88.0)

        close_preview = InventoryAuditService.closing_preview(plant_id=str(self.plant.id), financial_year="2026-2027")
        self.assertEqual(close_preview["totals"]["bulk_kg"], 88.0)
        self.assertEqual(close_preview["blockers"], [])
        closed = InventoryAuditService.close_period(period=period, plant_id=str(self.plant.id), user=checker)
        self.assertEqual(closed.status, "CLOSED")
        next_opening_line = closed.opening_batch_next_year.lines.get(stock_class="BULK", material=self.granule, granule_code=self.granule_code)
        self.assertEqual(next_opening_line.opening_qty, Decimal("88.0000"))

        after_close_card = InventoryAuditService.stock_card(material_id=str(self.granule.id), plant_id=str(self.plant.id), financial_year="2026-2027")
        self.assertEqual(after_close_card["closing_qty"], 88.0)
        self.assertFalse(any(row["source"] == "FY_CLOSE" for row in after_close_card["rows"]))

        correction = InventoryAuditService.create_batch(
            payload={
                "type": "FY_CORRECTION",
                "plant": str(self.plant.id),
                "financial_year": "2026-2027",
                "notes": "Owner approved: missed physical bag found during statutory audit.",
            },
            user=self.user,
        )
        InventoryAuditService.import_lines(
            batch=correction,
            rows=[
                {
                    "stock_class": "BULK",
                    "material": str(self.granule.id),
                    "granule_code": str(self.granule_code.id),
                    "location": str(self.location.id),
                    "counted_qty": "90",
                    "rate": "10",
                }
            ],
        )
        correction = InventoryAuditService.submit_batch(batch=correction, user=self.user)
        correction = InventoryAuditService.approve_batch(batch=correction, user=checker)
        InventoryAuditService.post_batch(batch=correction, user=checker)

        self.assertEqual(InventoryBulk.objects.get(material=self.granule, granule_code=self.granule_code).qty_kg, Decimal("90.0000"))
        self.assertTrue(BulkTransaction.objects.filter(type="FY_CORRECTION", qty_kg=Decimal("2.0000")).exists())
        next_opening_line.refresh_from_db()
        self.assertEqual(next_opening_line.opening_qty, Decimal("90.0000"))

        corrected_closed_year = InventoryAuditService.stock_card(material_id=str(self.granule.id), plant_id=str(self.plant.id), financial_year="2026-2027")
        next_year_card = InventoryAuditService.stock_card(material_id=str(self.granule.id), plant_id=str(self.plant.id), financial_year="2027-2028")
        self.assertEqual(corrected_closed_year["closing_qty"], 90.0)
        self.assertEqual(next_year_card["opening_qty"], 90.0)
        self.assertEqual(next_year_card["closing_qty"], 90.0)

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
