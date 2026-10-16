"""
Inner pouch and packing material flow (base rule, 16 Oct 2026).

- Inner pouches are the one packing item consumed automatically: at pouching, one per
  N pouches, from anywhere in the plant (the output location first).
- Once the packing check closes, inner pouches consumed but not used in packs go back
  to stock for that order.
- Gonnies, cartons, extras and in-house packing rolls are marked on the unit and taken
  off stock by the evening packing count, booked to the orders that marked them.
- In-house inner pouch demand nets stock already promised to other open orders and
  follows the product master's auto-demand switch.
"""
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.test import TestCase

from apps.inventory.models import InventoryLocation, PackagingStock, PackagingTransaction
from apps.inventory.services.packaging_service import PackagingService
from apps.materials.models import InventoryMaterial
from apps.production.models import FinishedGoodsBatch, PackingUnit
from apps.production.services.in_house_demand_service import InHouseDemandService
from apps.production.services.job_services import WCManagerService
from apps.production.services.operator_service import OperatorService
from apps.production.services.packing_count_service import PackingCountService
from apps.production.services.packing_service import PackingService, PackingVerificationService
from apps.production.tests import test_roll_lane_flow as lane_tests
from apps.production.tests.test_roll_lane_flow import RollLaneFixture
from apps.sales.services.order_service import _normalize_packaging_snapshot

D = Decimal


def _stock(material, location):
    row = PackagingStock.objects.filter(material=material, location=location).first()
    return D(str(row.qty)) if row else D("0")


@patch("apps.production.services.services_execution.ExecutionService.calculate_requirements")
@patch("apps.production.services.job_services.require_bom_ready_for_production")
class InnerPouchFlowTests(RollLaneFixture, TestCase):
    """Uses the pouching fixture of the roll lane tests (PRT -> PCH)."""

    _linear = lane_tests.SingleLaneFlowTests._linear

    def _packing_setup(self, *, inner_in_store=D("150")):
        self.store = InventoryLocation.objects.create(plant=self.plant, code="PKS", name="Packing store", type="RM")
        self.inner = InventoryMaterial.objects.create(
            code="INNER-100", name="Inner pouch 100", category="PACKAGING", base_uom="PCS",
            packaging_kind="INNER_POUCH", packaging_supply_mode="IN_HOUSE",
        )
        self.gonny = InventoryMaterial.objects.create(
            code="GONNY-STD", name="Gonny", category="PACKAGING", base_uom="PCS",
            packaging_kind="GONNY", packaging_supply_mode="PURCHASED",
        )
        if inner_in_store:
            PackagingService.add_packaging_stock(material_id=self.inner.id, qty=inner_in_store, location_id=self.store.id, cost=D("2"))
        PackagingService.add_packaging_stock(material_id=self.gonny.id, qty=D("20"), location_id=self.store.id, cost=D("15"))
        geometry = {"fg_type": "POUCH", "base": {"width_mm": 160, "height_mm": 230}}
        item, jobs = self._linear(["PRT", "PCH"], fg_type="POUCH", uom="PCS", qty=D("100000"), unit_weight_g=D("6.85"), geometry=geometry)
        # An older order line that names its inner pouch by code only.
        item.packaging_snapshot = {"primary_inner_pack": {"enabled": True, "material_code": "INNER-100", "pcs_per_pack": 100}}
        item.save(update_fields=["packaging_snapshot"])
        prev, pouch = jobs[0], jobs[1]
        self._complete_predecessors({"p": prev}, ["p"])
        roll = self._roll(item, prev, self.film, 62, 300, "CH-INNER", 1)
        assignment = self._assignment(pouch)
        WCManagerService.assign_rolls(assignment.id, [str(roll.id)], user=self.user)
        self._run(pouch, assignment)
        return item, pouch

    def test_pouching_draws_inner_pouches_from_the_packing_store_and_returns_unused_at_the_check(self, *_):
        item, pouch = self._packing_setup()
        OperatorService.log_output_step(str(pouch.id), 68.5, self.user, output_pcs=10000)

        # 100 inner pouches came out of the packing store (none were at the output location).
        self.assertEqual(_stock(self.inner, self.store), D("50"))
        consume = PackagingTransaction.objects.get(material=self.inner, type="CONSUME")
        self.assertEqual(consume.location_id, self.store.id)
        self.assertEqual(consume.sales_order_item_id, item.id)
        self.assertEqual(consume.meta_json.get("drawn_from_location_id"), str(self.store.id))
        batch = FinishedGoodsBatch.objects.get(production_job=pouch)
        self.assertEqual(batch.meta_json["primary_inner_pack"]["pack_count"], 100)
        self.assertEqual(batch.meta_json["primary_inner_pack"]["consume_tx_ids"], [str(consume.id)])

        # The yard packs 9,860 pouches in 99 inner packs; the gonny is only marked.
        unit = PackingService.create_gonny.__wrapped__(
            str(batch.id), 9860, user=self.user, gonny_material_id=str(self.gonny.id), content_mode="PRIMARY_PACKS",
        )
        self.assertEqual(unit.primary_pack_count, 99)
        self.assertEqual(unit.meta_json["gonny_stock_effect"], "MARK_ONLY")
        self.assertFalse(PackagingTransaction.objects.filter(material=self.gonny, type="CONSUME").exists())
        self.assertEqual(_stock(self.gonny, self.store), D("20"))
        PackingService.seal_gonny(str(unit.id), unit.expected_gross_weight_kg, user=self.user, extras=[])

        result = PackingVerificationService.close(batch.id, user=self.user)
        self.assertEqual(result["status"], "VERIFIED")
        self.assertEqual(result["inner_packs"], {
            "material_id": str(self.inner.id), "pcs_per_pack": 100,
            "consumed_at_machine": 100, "used_in_units": 99, "returned": 1,
        })
        self.assertEqual(_stock(self.inner, self.store), D("51"))
        back = PackagingTransaction.objects.get(material=self.inner, type="ADJUST")
        self.assertEqual(back.meta_json["basis"], "INNER_PACK_RETURN")
        self.assertEqual(back.sales_order_item_id, item.id)
        self.assertEqual(D(str(back.qty)), D("1"))

        # Closing twice cannot return twice.
        batch.refresh_from_db()
        self.assertEqual(PackingVerificationService._return_unused_inner_packs(batch, user=self.user), 0)

        # Evening count: the store finds 19 gonnies; the one short goes to the order that marked it,
        # although the gonny sits in the FG store and the stock in the packing store.
        gonny_stock = PackagingStock.objects.get(material=self.gonny, location=self.store)
        PackingCountService.post_count(lines=[{"stock_id": str(gonny_stock.id), "counted_qty": 19}], user=self.user)
        booked = PackagingTransaction.objects.get(material=self.gonny, type="CONSUME")
        self.assertEqual(booked.sales_order_item_id, item.id)
        self.assertEqual(D(str(booked.qty)), D("-1"))
        self.assertEqual(booked.meta_json["allocation_basis"], "MARKED")

    def test_shortage_names_what_the_plant_has(self, *_):
        _item, pouch = self._packing_setup(inner_in_store=D("40"))
        with self.assertRaisesMessage(ValidationError, "plant has 40"):
            OperatorService.log_output_step(str(pouch.id), 68.5, self.user, output_pcs=10000)
        self.assertEqual(_stock(self.inner, self.store), D("40"))

    def test_inner_pouch_demand_nets_stock_promised_to_other_open_orders(self, *_):
        self.store = InventoryLocation.objects.create(plant=self.plant, code="PKS2", name="Packing store", type="RM")
        inner = InventoryMaterial.objects.create(
            code="INNER-DEMAND", name="Inner pouch", category="PACKAGING", base_uom="PCS",
            packaging_kind="INNER_POUCH", packaging_supply_mode="IN_HOUSE",
        )
        PackagingService.add_packaging_stock(material_id=inner.id, qty=D("1000"), location_id=self.store.id, cost=D("2"))
        geometry = {"fg_type": "POUCH", "base": {"width_mm": 160, "height_mm": 230}}
        first, _jobs = self._linear(["PRT", "PCH"], fg_type="POUCH", uom="PCS", qty=D("60000"), unit_weight_g=D("6.85"), geometry=geometry)
        second = self._item(
            route=first.template.routing_rule, codes=["PRT", "PCH"], qty=D("60000"), layers=first.layer_snapshot,
            fg_type="POUCH", uom="PCS", unit_weight_g=D("6.85"), geometry=geometry,
        )
        for item in (first, second):
            item.packaging_snapshot = {"primary_inner_pack": {"enabled": True, "material_id": str(inner.id), "pcs_per_pack": 100}}
            item.save(update_fields=["packaging_snapshot"])
        netting = InHouseDemandService._inner_pouch_netting(inner, item=second)
        self.assertEqual(netting["needed_by_other_orders"], D("600"))
        # Once 300 are consumed for the first order, only 300 more are promised to it.
        PackagingService.consume_packaging_stock(
            material_id=inner.id, qty=300, location_id=self.store.id, sales_order_item_id=first.id, basis="PER_PACK",
        )
        netting = InHouseDemandService._inner_pouch_netting(inner, item=second)
        self.assertEqual(netting["needed_by_other_orders"], D("300"))

        # 700 left in stock looks enough for 600, but 300 are promised to the first order: 200 short.
        created, skipped = [], []
        InHouseDemandService._ensure_packaging(second, created, skipped)
        self.assertEqual(created, [])
        self.assertEqual(skipped[-1]["reason"], "no_production_template")
        # Without the netting the same stock would have looked sufficient.
        with patch.object(
            InHouseDemandService, "_inner_pouch_netting",
            return_value={"needed_by_other_orders": D("0"), "pending_in_house": D("0"), "consumed_for_this_line": D("0")},
        ):
            created, skipped = [], []
            InHouseDemandService._ensure_packaging(second, created, skipped)
        self.assertEqual(skipped[-1]["reason"], "stock_available")

    def test_master_switch_and_code_only_snapshot(self, *_):
        inner = InventoryMaterial.objects.create(
            code="INNER-CODE", name="Inner pouch by code", category="PACKAGING", base_uom="PCS",
            packaging_kind="INNER_POUCH", packaging_supply_mode="BOTH", packaging_defaults_json={"pcs_per_pack": 50},
        )
        snapshot = _normalize_packaging_snapshot({"primary_inner_pack": {"enabled": True, "material_code": "inner-code"}})
        primary = snapshot["primary_inner_pack"]
        self.assertEqual(primary["material_id"], str(inner.id))
        self.assertEqual(primary["material_code"], "INNER-CODE")
        self.assertEqual(primary["supply_mode"], "BOTH")
        self.assertEqual(primary["pcs_per_pack"], 50)

        def item_with(axes):
            return SimpleNamespace(product_master=SimpleNamespace(variant_axes=axes))

        inner_line = {"role": "PRIMARY_INNER"}
        self.assertTrue(InHouseDemandService._master_allows_auto_demand(item_with([{"axis": "packaging_inner"}]), inner_line))
        self.assertFalse(InHouseDemandService._master_allows_auto_demand(
            item_with([{"axis": "packaging_inner", "auto_demand_in_house": False}]), inner_line,
        ))
        self.assertTrue(InHouseDemandService._master_allows_auto_demand(SimpleNamespace(product_master=None), inner_line))
        self.assertFalse(InHouseDemandService._master_allows_auto_demand(
            item_with([{"axis": "pod_variant", "auto_demand_in_house": False}]), {"role": "POD"},
        ))

