"""Packing yard check: packed net (scale minus packing material) vs what the machine logged."""
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.production.models import FinishedGoodsBatch, PackingUnit, PackingVerification, ScrapLog
from apps.production.services.dispatch_service import FGDispatchService
from apps.production.services.packing_service import PackingVerificationService
from apps.production.models import ProductionJob
from apps.production.tests.test_roll_lane_flow import RollLaneFixture
from apps.routing.models import RoutingRule

D = Decimal


@override_settings(PACKING_VERIFY_PCS_PCT=2, PACKING_VERIFY_KG_PCT=2)
@patch("apps.production.services.services_execution.ExecutionService.calculate_requirements")
@patch("apps.production.services.job_services.require_bom_ready_for_production")
class PackingVerificationTests(RollLaneFixture, TestCase):
    def _batch(self, logged_pcs=10000, logged_kg="68.5"):
        route = RoutingRule.objects.create(
            name=f"Pouch only {logged_pcs}", ordered_processes=["PCH"],
            route_graph={"nodes": [{"id": "p", "label": "Pouching", "process_code": "PCH", "route_index": 0, "template_step_index": 0}]},
        )
        item = self._item(route=route, codes=["PCH"], qty=D(logged_pcs), layers=[], fg_type="POUCH", uom="PCS",
                          unit_weight_g=D("6.85"), geometry={"fg_type": "POUCH", "base": {"width_mm": 160, "height_mm": 230}})
        job = ProductionJob.objects.filter(sales_order_item=item).first()
        return FinishedGoodsBatch.objects.create(
            batch_number=f"BATCH-T-{logged_pcs}", template=item.template, production_job=job, sales_order_item=item,
            qty_pcs=logged_pcs, qty_kg=D(logged_kg), location=self.fg, status="AVAILABLE",
        )

    def _pack(self, batch, n, pcs, *, g_per_pc="6.92", tare="0.36", status="SEALED"):
        net = (D(pcs) * D(g_per_pc) / D("1000")).quantize(D("0.0001"))
        unit = PackingUnit.objects.create(
            label_id=f"{batch.batch_number}-G{n:03d}", fg_batch=batch, sales_order_item=batch.sales_order_item,
            qty_pcs=pcs, weight_kg=net + D(tare), gross_weight_kg=(net + D(tare)) if status != "OPEN" else None,
            inner_pack_tare_kg=D("0.16"), secondary_pack_tare_kg=D(tare) - D("0.16"), extras_tare_kg=D("0"),
            status=status, location=self.fg,
        )
        batch.qty_pcs -= pcs
        batch.save(update_fields=["qty_pcs"])
        return unit

    def test_within_limits_verifies_and_books_the_unpacked_balance(self, *_):
        batch = self._batch()
        for n, pcs in enumerate([2000, 2000, 2000, 2000, 1860], start=1):
            self._pack(batch, n, pcs)
        summary = PackingVerificationService.summary(batch)
        self.assertAlmostEqual(summary["tare_kg"], 1.8, places=3)
        self.assertAlmostEqual(summary["net_kg"], 9860 * 6.92 / 1000, places=3)
        result = PackingVerificationService.close(batch.id, user=self.user)
        self.assertEqual(result["status"], "VERIFIED")
        self.assertAlmostEqual(result["pcs_variance_pct"], -1.4, places=2)
        batch.refresh_from_db()
        self.assertEqual(batch.qty_pcs, 0)
        self.assertEqual(batch.status, "PACKED")
        scrap = ScrapLog.objects.get(production_job=batch.production_job)
        self.assertAlmostEqual(float(scrap.quantity), 68.5 * 140 / 10000, places=3)
        self.assertEqual(PackingVerification.objects.get(fg_batch=batch).shortfall_pcs, 140)

    def test_outside_limits_holds_dispatch_until_a_manager_accepts(self, *_):
        batch = self._batch(logged_pcs=10000)
        units = [self._pack(batch, n, 2250) for n in range(1, 5)]  # 9,000 pcs: 10% short
        result = PackingVerificationService.close(batch.id, user=self.user)
        self.assertEqual(result["status"], "HELD")
        with self.assertRaisesMessage(ValueError, "on hold at the packing check"):
            FGDispatchService.release_gonny_to_dispatch(str(units[0].id), user=self.user)
        with self.assertRaisesMessage(ValueError, "Only a production supervisor"):
            PackingVerificationService.accept(batch.id, user=self.user, reason="REJECTS")
        boss = get_user_model().objects.create(username="pack-boss", email="boss@example.invalid", is_superuser=True)
        # The packing screen lists held batches across orders with the order to open.
        client = APIClient()
        client.force_authenticate(boss)
        response = client.get("/api/production/packing/verification-queue/")
        self.assertEqual(response.status_code, 200)
        held = [row for row in response.json()["results"] if row["status"] == "HELD"]
        self.assertEqual([row["fg_batch_id"] for row in held], [str(batch.id)])
        self.assertEqual(held[0]["sales_order_id"], str(batch.sales_order_item.sales_order_id))
        with self.assertRaisesMessage(ValueError, "Write a note"):
            PackingVerificationService.accept(batch.id, user=boss, reason="OTHER")
        accepted = PackingVerificationService.accept(batch.id, user=boss, reason="REJECTS", note="Rejects removed at pouching")
        self.assertEqual(accepted["status"], "ACCEPTED")
        FGDispatchService.release_gonny_to_dispatch(str(units[0].id), user=self.user)

    def test_sample_weight_drives_the_weight_check_and_open_packs_block_close(self, *_):
        batch = self._batch()
        self._pack(batch, 1, 2000)
        self._pack(batch, 2, 500, status="OPEN")
        data = PackingVerificationService.record_sample(batch.id, sample_count=100, sample_weight_g_total="692", user=self.user)
        self.assertAlmostEqual(data["sample_weight_g"], 6.92, places=3)
        self.assertAlmostEqual(data["weight_variance_pct"], (6.92 - 6.85) / 6.85 * 100, places=2)
        with self.assertRaisesMessage(ValueError, "Seal or empty the open packs"):
            PackingVerificationService.close(batch.id, user=self.user)


@override_settings(PACKING_VERIFY_PCS_PCT=2, PACKING_VERIFY_KG_PCT=2)
@patch("apps.production.services.services_execution.ExecutionService.calculate_requirements")
@patch("apps.production.services.job_services.require_bom_ready_for_production")
class PackingCheckStartDateTests(PackingVerificationTests):
    """Batches made before the packing check started are never listed, closed or booked."""

    def test_batches_before_the_start_date_are_left_alone(self, *_):
        batch = self._batch(logged_pcs=10000)
        self._pack(batch, 1, 9000)
        FinishedGoodsBatch.objects.filter(id=batch.id).update(created_at="2026-10-01T10:00:00+05:30")
        batch.refresh_from_db()
        self.assertFalse(PackingVerificationService.in_scope(batch))
        with self.assertRaisesMessage(ValueError, "made before the packing check started"):
            PackingVerificationService.close(batch.id, user=self.user)
        batch.refresh_from_db()
        self.assertEqual(batch.qty_pcs, 1000)
        self.assertFalse(PackingVerification.objects.filter(fg_batch=batch).exclude(status="OPEN").exists())
        boss = get_user_model().objects.create(username="pack-boss-2", email="boss2@example.invalid", is_superuser=True)
        client = APIClient()
        client.force_authenticate(boss)
        rows = client.get("/api/production/packing/verification-queue/").json()["results"]
        self.assertNotIn(str(batch.id), [row["fg_batch_id"] for row in rows])
        # The plant can move the start earlier on purpose with the setting.
        with override_settings(PACKING_VERIFY_START_DATE="2026-09-30"):
            self.assertTrue(PackingVerificationService.in_scope(batch))
        with override_settings(PACKING_VERIFY_START_DATE="2026-10-01T12:00"):
            self.assertFalse(PackingVerificationService.in_scope(batch))

    # The inherited checks already ran in PackingVerificationTests.
    test_within_limits_verifies_and_books_the_unpacked_balance = None
    test_outside_limits_holds_dispatch_until_a_manager_accepts = None
    test_sample_weight_drives_the_weight_check_and_open_packs_block_close = None
