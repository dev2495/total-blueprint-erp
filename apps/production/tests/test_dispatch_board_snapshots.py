from decimal import Decimal
from uuid import uuid4

from django.test import RequestFactory, TestCase
from django.test.utils import CaptureQueriesContext
from django.db import connection

from apps.factory.models import Plant
from apps.inventory.models import InventoryLocation, InventoryRoll
from apps.materials.models import InventoryMaterial
from apps.production.models import (
    DeliveryChallan,
    DeliveryChallanItem,
    FinishedGoodsBatch,
    PackingUnit,
    ProductionJob,
)
from apps.production.services.dispatch_service import FGDispatchService
from apps.production.views import DeliveryChallanViewSet, PackingViewSet
from apps.routing.models import RoutingRule
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.templates.models import TemplateBlueprint


class DispatchBoardSnapshotTests(TestCase):
    def setUp(self):
        self.plant = Plant.objects.create(name="Board Snapshot Plant", code="BSP")
        self.location = InventoryLocation.objects.create(
            plant=self.plant,
            code="BOARD-FG",
            name="Board Finished Goods",
            type="FG",
        )
        self.material = InventoryMaterial.objects.create(
            code="BOARD-FILM",
            name="Board Film",
            category="FILM_VARIANT",
            is_extrudable=False,
            is_purchasable=True,
        )
        self.roll_template = TemplateBlueprint.objects.create(
            name="Board Roll Template",
            fg_type="ROLL",
            status="DRAFT",
        )
        self.pouch_template = TemplateBlueprint.objects.create(
            name="Board Pouch Template",
            fg_type="POUCH",
            status="DRAFT",
        )
        self.route = RoutingRule.objects.create(name="Board Snapshot Route", ordered_processes=[])
        self.sequence = 0
        self.order = SalesOrder.objects.create(
            customer_name="Board Snapshot Customer",
            ship_to_customer_name="Board Snapshot Customer",
            ship_to_address="12 Test Road, Pune",
            status="DISPATCH_READY",
        )
        self.item = SalesOrderItem.objects.create(
            sales_order=self.order,
            template=self.roll_template,
            mode="TEMPLATE",
            geometry_snapshot={"fg_type": "ROLL"},
            layer_snapshot=[],
            printing_snapshot={"enabled": False},
            addons_snapshot=[],
            bom_snapshot={"items": []},
            qty_uom="KG",
            qty_value=Decimal("100"),
            unit_weight_g=Decimal("0"),
            total_weight_kg=Decimal("100"),
            price_basis="KG",
            unit_price=Decimal("1"),
        )

    def _roll(self, *, weight="10", status="AVAILABLE", release=False):
        self.sequence += 1
        roll = InventoryRoll.objects.create(
            label_id=f"BOARD-ROLL-{self.sequence}",
            material=self.material,
            batch_no=f"BOARD-{self.sequence}",
            thickness_micron=Decimal("40"),
            width_mm=Decimal("500"),
            length_m=Decimal("1000"),
            original_weight_kg=Decimal(weight),
            weight_kg=Decimal(weight),
            net_weight_kg=Decimal(weight),
            tare_weight_kg=Decimal("1"),
            gross_weight_kg=Decimal(weight) + Decimal("1"),
            location=self.location,
            plant=self.plant,
            status=status,
            is_fg=True,
            template=self.roll_template,
            sales_order_item=self.item,
        )
        if release:
            FGDispatchService.release_roll_to_dispatch(
                str(roll.id),
                user=None,
                lines=[],
                release_mode="UNPACKED",
            )
        return roll

    def _gonny(self, *, status, released=False, pcs=100):
        self.sequence += 1
        job = ProductionJob.objects.create(
            job_number=f"BOARD-JOB-{self.sequence}",
            template=self.pouch_template,
            sales_order_item=self.item,
            routing_rule=self.route,
            from_location=self.location,
            to_location=self.location,
            quantity=Decimal(str(pcs)),
            remaining_qty=Decimal("0"),
            status="COMPLETED",
            job_state="COMPLETED",
            output_form="BULK",
            uom="PCS",
        )
        batch = FinishedGoodsBatch.objects.create(
            batch_number=f"BOARD-BATCH-{self.sequence}",
            template=self.pouch_template,
            production_job=job,
            sales_order_item=self.item,
            qty_pcs=pcs,
            qty_kg=Decimal("5"),
            location=self.location,
            status="PACKED",
        )
        return PackingUnit.objects.create(
            label_id=f"BOARD-GONNY-{self.sequence}",
            fg_batch=batch,
            sales_order_item=self.item,
            qty_pcs=pcs,
            weight_kg=Decimal("5"),
            net_product_weight_kg=Decimal("4.5"),
            gross_weight_kg=Decimal("5.5"),
            location=self.location,
            status=status,
            meta_json={"released_to_dispatch": True} if released else {},
        )

    def _reserve(self, *, roll=None, gonny=None):
        challan = DeliveryChallan.objects.create(
            dc_no=f"BOARD-DC-{uuid4().hex[:12]}",
            customer_name=self.order.customer_name,
            sales_order=self.order,
            plant=self.plant,
            status="DRAFT",
        )
        DeliveryChallanItem.objects.create(
            challan=challan,
            sales_order_item=self.item,
            roll=roll,
            packing_unit=gonny,
            weight_kg=Decimal("10"),
            reservation_active=True,
        )

    def test_board_summaries_match_existing_order_summaries_with_mixed_units(self):
        ready_roll = self._roll(weight="10", release=True)
        self._roll(weight="7", release=False)
        reserved_roll = self._roll(weight="6", release=True)
        dispatched_roll = self._roll(weight="3", status="CONSUMED")
        ready_gonny = self._gonny(status="SEALED", released=True, pcs=100)
        unreleased_gonny = self._gonny(status="SEALED", released=False, pcs=80)
        reserved_gonny = self._gonny(status="SEALED", released=True, pcs=40)
        self._gonny(status="OPEN", released=False, pcs=30)
        self._gonny(status="DISPATCHED", released=False, pcs=20)
        self._reserve(roll=reserved_roll)
        self._reserve(gonny=reserved_gonny)

        factory = RequestFactory()
        with CaptureQueriesContext(connection) as packing_queries:
            packing_actual = PackingViewSet().yard_snapshot(factory.get("/packing/yard-snapshot/")).data
        detailed_packing = FGDispatchService.get_packing_units_by_so(str(self.order.id))
        self.assertEqual(len(packing_actual["orders"]), 1)
        self.assertEqual(
            packing_actual["orders"][0],
            {
                "sales_order": detailed_packing["sales_order"],
                "pending": detailed_packing["packing_pending"],
                "ready_for_dispatch": detailed_packing["ready_for_dispatch"],
            },
        )
        self.assertEqual(packing_actual["totals"]["orders"], 1)
        self.assertLessEqual(len(packing_queries), 12)

        with CaptureQueriesContext(connection) as dispatch_queries:
            dispatch_actual = DeliveryChallanViewSet().board(factory.get("/challans/board/")).data
        detailed_dispatch = FGDispatchService.get_dispatchable_units_by_so(str(self.order.id))
        self.assertEqual(len(dispatch_actual["orders"]), 1)
        self.assertEqual(
            dispatch_actual["orders"][0],
            {
                "sales_order": detailed_dispatch["sales_order"],
                "available_for_dispatch": detailed_dispatch["available_for_dispatch"],
                "packing_pending": detailed_dispatch["packing_pending"],
                "dispatched_qty": detailed_dispatch["dispatched_qty"],
            },
        )
        self.assertEqual(dispatch_actual["totals"]["orders"], 1)
        self.assertLessEqual(len(dispatch_queries), 12)
        self.assertEqual(ready_roll.status, "AVAILABLE")
        self.assertEqual(ready_gonny.status, "SEALED")
        self.assertEqual(unreleased_gonny.status, "SEALED")
        self.assertEqual(dispatched_roll.status, "CONSUMED")
