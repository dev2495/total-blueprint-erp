from decimal import Decimal
from unittest.mock import MagicMock, patch
from uuid import uuid4

from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone

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
from apps.routing.models import RoutingRule
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.templates.models import TemplateBlueprint


class DispatchReservationGuardrailTests(TestCase):
    def setUp(self):
        self.plant = Plant.objects.create(name="Dispatch Guard Plant", code="DGP")
        self.location = InventoryLocation.objects.create(
            plant=self.plant,
            code="FG-GUARD",
            name="FG Guard Store",
            type="FG",
        )
        self.other_plant = Plant.objects.create(name="Other Dispatch Plant", code="ODP")
        self.other_location = InventoryLocation.objects.create(
            plant=self.other_plant,
            code="FG-OTHER",
            name="Other FG Store",
            type="FG",
        )
        self.material = InventoryMaterial.objects.create(
            code="FILM-DC-GUARD",
            name="Dispatch Guard Film",
            category="FILM_VARIANT",
            is_extrudable=False,
            is_purchasable=True,
        )
        self.roll_template = TemplateBlueprint.objects.create(
            name="Dispatch Guard Roll",
            fg_type="ROLL",
            status="DRAFT",
        )
        self.pouch_template = TemplateBlueprint.objects.create(
            name="Dispatch Guard Pouch",
            fg_type="POUCH",
            status="DRAFT",
        )
        self.route = RoutingRule.objects.create(
            name="Dispatch Guard Route",
            ordered_processes=[],
        )
        self.sequence = 0

    def _item(self, order, *, template=None, qty_uom="KG"):
        return SalesOrderItem.objects.create(
            sales_order=order,
            template=template or self.roll_template,
            mode="TEMPLATE",
            geometry_snapshot={"fg_type": (template or self.roll_template).fg_type},
            layer_snapshot=[],
            printing_snapshot={"enabled": False},
            addons_snapshot=[],
            bom_snapshot={"items": []},
            qty_uom=qty_uom,
            qty_value=Decimal("100"),
            unit_weight_g=Decimal("0"),
            total_weight_kg=Decimal("100"),
            price_basis=qty_uom,
            unit_price=Decimal("1"),
        )

    def _order(self, *, status="CONFIRMED", template=None, qty_uom="KG"):
        order = SalesOrder.objects.create(
            customer_name="Guardrail Customer",
            ship_to_customer_name="Guardrail Customer",
            ship_to_address="Guardrail delivery address",
            status=status,
        )
        return order, self._item(order, template=template, qty_uom=qty_uom)

    def _roll(self, item, *, location=None, release=True):
        self.sequence += 1
        location = location or self.location
        roll = InventoryRoll.objects.create(
            label_id=f"DC-GUARD-ROLL-{self.sequence}",
            material=self.material,
            batch_no=f"DCG-{self.sequence}",
            thickness_micron=Decimal("40"),
            width_mm=Decimal("500"),
            length_m=Decimal("1000"),
            original_weight_kg=Decimal("10"),
            weight_kg=Decimal("10"),
            net_weight_kg=Decimal("10"),
            tare_weight_kg=Decimal("1"),
            gross_weight_kg=Decimal("11"),
            location=location,
            plant=location.plant,
            status="AVAILABLE",
            is_fg=True,
            template=self.roll_template,
            sales_order_item=item,
        )
        if release:
            FGDispatchService.release_roll_to_dispatch(
                str(roll.id),
                user=None,
                lines=[],
                release_mode="UNPACKED",
            )
        return roll

    def _gonny(self, item, *, location=None):
        self.sequence += 1
        location = location or self.location
        job = ProductionJob.objects.create(
            job_number=f"DC-GUARD-JOB-{self.sequence}",
            template=self.pouch_template,
            sales_order_item=item,
            routing_rule=self.route,
            from_location=location,
            to_location=location,
            quantity=Decimal("100"),
            remaining_qty=Decimal("0"),
            status="COMPLETED",
            job_state="COMPLETED",
            output_form="BULK",
            uom="PCS",
        )
        batch = FinishedGoodsBatch.objects.create(
            batch_number=f"DC-GUARD-BATCH-{self.sequence}",
            template=self.pouch_template,
            production_job=job,
            sales_order_item=item,
            qty_pcs=100,
            qty_kg=Decimal("5"),
            location=location,
            status="PACKED",
        )
        return PackingUnit.objects.create(
            label_id=f"DC-GUARD-GONNY-{self.sequence}",
            fg_batch=batch,
            sales_order_item=item,
            qty_pcs=100,
            weight_kg=Decimal("5"),
            net_product_weight_kg=Decimal("5"),
            gross_weight_kg=Decimal("5.5"),
            location=location,
            status="SEALED",
            meta_json={"released_to_dispatch": True},
        )

    def _create_roll_challan(self, order, rolls, *, plant=None):
        return FGDispatchService.create_challan(
            customer_name=order.customer_name,
            plant_id=str((plant or self.plant).id),
            sales_order_id=str(order.id),
            roll_ids=[str(roll.id) for roll in rolls],
            transporter_name="Guardrail Transport",
            user=None,
        )

    def test_selection_ids_are_non_empty_unique_valid_and_exact(self):
        order, item = self._order()
        roll = self._roll(item)

        with self.assertRaisesMessage(ValueError, "At least one released roll or sealed gonny"):
            self._create_roll_challan(order, [])
        with self.assertRaisesMessage(ValueError, "contains a blank ID"):
            FGDispatchService.create_challan(
                order.customer_name,
                str(self.plant.id),
                str(order.id),
                roll_ids=[""],
                transporter_name="Guardrail Transport",
            )
        with self.assertRaisesMessage(ValueError, "contains invalid ID"):
            FGDispatchService.create_challan(
                order.customer_name,
                str(self.plant.id),
                str(order.id),
                roll_ids=["not-a-uuid"],
                transporter_name="Guardrail Transport",
            )
        with self.assertRaisesMessage(ValueError, "contains duplicate ID"):
            self._create_roll_challan(order, [roll, roll])
        missing_id = str(uuid4())
        with self.assertRaisesMessage(ValueError, missing_id):
            FGDispatchService.create_challan(
                order.customer_name,
                str(self.plant.id),
                str(order.id),
                roll_ids=[missing_id],
                transporter_name="Guardrail Transport",
            )

    def test_one_challan_allows_multiple_lines_only_within_one_sales_order(self):
        order, first_item = self._order()
        second_item = self._item(order)
        first_roll = self._roll(first_item)
        second_roll = self._roll(second_item)

        challan = self._create_roll_challan(order, [first_roll, second_roll])

        self.assertEqual(challan.sales_order_id, order.id)
        self.assertEqual(
            set(challan.items.values_list("sales_order_item_id", flat=True)),
            {first_item.id, second_item.id},
        )
        self.assertTrue(all(challan.items.values_list("reservation_active", flat=True)))

        other_order, _ = self._order(status="DISPATCH_READY")
        unreserved_roll = self._roll(first_item)
        with self.assertRaisesMessage(ValueError, "different Sales Order"):
            self._create_roll_challan(other_order, [unreserved_roll])

    def test_wrong_plant_status_and_release_are_rejected(self):
        order, item = self._order()
        other_plant_roll = self._roll(item, location=self.other_location)
        with self.assertRaisesMessage(ValueError, "different plant"):
            self._create_roll_challan(order, [other_plant_roll], plant=self.plant)

        order2, item2 = self._order(status="DISPATCH_READY")
        unreleased_roll = self._roll(item2, release=False)
        with self.assertRaisesMessage(ValueError, "not released from Packing Yard"):
            self._create_roll_challan(order2, [unreleased_roll])

        released_roll = self._roll(item2)
        released_roll.status = "RESERVED"
        released_roll.save(update_fields=["status"])
        with self.assertRaisesMessage(ValueError, "not AVAILABLE"):
            self._create_roll_challan(order2, [released_roll])

    def test_active_reservation_is_hidden_rejected_then_released_on_cancel(self):
        order, item = self._order()
        roll = self._roll(item)
        first = self._create_roll_challan(order, [roll])

        summary = FGDispatchService.get_dispatchable_units_by_so(str(order.id))
        self.assertNotIn(str(roll.id), {row["id"] for row in summary["rolls"]})
        with self.assertRaisesMessage(ValueError, first.dc_no):
            self._create_roll_challan(order, [roll])

        FGDispatchService.update_challan_status(str(first.id), "CANCELLED")
        first_item = first.items.get()
        self.assertFalse(first_item.reservation_active)
        self.assertEqual(first_item.reservation_release_reason, "CHALLAN_CANCELLED")
        self.assertIsNotNone(first_item.reservation_released_at)

        summary = FGDispatchService.get_dispatchable_units_by_so(str(order.id))
        self.assertIn(str(roll.id), {row["id"] for row in summary["rolls"]})
        replacement = self._create_roll_challan(order, [roll])
        self.assertEqual(replacement.items.get().roll_id, roll.id)

    def test_database_partial_unique_constraint_blocks_two_active_roll_reservations(self):
        order, item = self._order()
        roll = self._roll(item)
        first = self._create_roll_challan(order, [roll])
        second = DeliveryChallan.objects.create(
            dc_no="DC-GUARD-UNIQUE-2",
            customer_name=order.customer_name,
            sales_order=order,
            plant=self.plant,
            status="DRAFT",
        )

        with self.assertRaises(IntegrityError), transaction.atomic():
            DeliveryChallanItem.objects.create(
                challan=second,
                sales_order_item=item,
                roll=roll,
                weight_kg=Decimal("11"),
                reservation_active=True,
            )
        self.assertEqual(first.items.filter(reservation_active=True).count(), 1)

    def test_historical_inactive_duplicates_are_preserved_but_cannot_be_reselected(self):
        order, item = self._order()
        roll = self._roll(item)
        for suffix in (1, 2):
            historical = DeliveryChallan.objects.create(
                dc_no=f"DC-GUARD-HIST-{suffix}",
                customer_name=order.customer_name,
                sales_order=order,
                plant=self.plant,
                status="DISPATCHED",
            )
            DeliveryChallanItem.objects.create(
                challan=historical,
                sales_order_item=item,
                roll=roll,
                weight_kg=Decimal("11"),
                reservation_active=False,
            )

        self.assertEqual(DeliveryChallanItem.objects.filter(roll=roll).count(), 2)
        with self.assertRaisesMessage(ValueError, "already reserved or dispatched"):
            self._create_roll_challan(order, [roll])
        self.assertEqual(DeliveryChallanItem.objects.filter(roll=roll).count(), 2)

    def test_dispatch_revalidates_physical_state_before_any_movement(self):
        order, item = self._order()
        roll = self._roll(item)
        challan = self._create_roll_challan(order, [roll])
        roll.status = "RESERVED"
        roll.save(update_fields=["status"])

        with self.assertRaisesMessage(ValueError, "not AVAILABLE at dispatch time"):
            FGDispatchService.dispatch_challan(str(challan.id), user=None)

        challan.refresh_from_db()
        roll.refresh_from_db()
        self.assertEqual(challan.status, "DRAFT")
        self.assertEqual(roll.status, "RESERVED")

    def test_gonny_reservations_follow_the_same_picker_cancel_and_db_rules(self):
        order, item = self._order(
            status="DISPATCH_READY",
            template=self.pouch_template,
            qty_uom="PCS",
        )
        gonny = self._gonny(item)
        first = FGDispatchService.create_challan(
            order.customer_name,
            str(self.plant.id),
            str(order.id),
            gonny_ids=[str(gonny.id)],
            transporter_name="Guardrail Transport",
        )
        summary = FGDispatchService.get_dispatchable_units_by_so(str(order.id))
        self.assertNotIn(str(gonny.id), {row["id"] for row in summary["gonnies"]})
        with self.assertRaisesMessage(ValueError, first.dc_no):
            FGDispatchService.create_challan(
                order.customer_name,
                str(self.plant.id),
                str(order.id),
                gonny_ids=[str(gonny.id)],
                transporter_name="Guardrail Transport",
            )

        second = DeliveryChallan.objects.create(
            dc_no="DC-GUARD-GONNY-UNIQUE",
            customer_name=order.customer_name,
            sales_order=order,
            plant=self.plant,
            status="DRAFT",
        )
        with self.assertRaises(IntegrityError), transaction.atomic():
            DeliveryChallanItem.objects.create(
                challan=second,
                sales_order_item=item,
                packing_unit=gonny,
                weight_kg=Decimal("5.5"),
                qty_pcs=100,
                reservation_active=True,
            )

        FGDispatchService.update_challan_status(str(first.id), "CANCELLED")
        replacement = FGDispatchService.create_challan(
            order.customer_name,
            str(self.plant.id),
            str(order.id),
            gonny_ids=[str(gonny.id)],
            transporter_name="Guardrail Transport",
        )
        self.assertTrue(replacement.items.get().reservation_active)

    def test_membership_lock_targets_only_child_rows(self):
        mocked_manager = MagicMock()
        terminal_queryset = MagicMock()
        mocked_manager.select_for_update.return_value.filter.return_value.exclude.return_value.select_related.return_value.order_by.return_value = terminal_queryset

        with patch(
            "apps.production.services.dispatch_service.DeliveryChallanItem.objects",
            mocked_manager,
        ):
            result = FGDispatchService._active_memberships(roll_ids=[str(uuid4())])

        self.assertIs(result, terminal_queryset)
        mocked_manager.select_for_update.assert_called_once_with(of=("self",))

    def test_terminal_or_closed_sales_order_lines_cannot_create_a_challan(self):
        for line_status in ("CANCELLED", "COMPLETED", "SHORT_CLOSED"):
            with self.subTest(line_status=line_status):
                order, item = self._order(status="DISPATCH_READY")
                item.line_status = line_status
                item.save(update_fields=["line_status"])
                roll = self._roll(item)

                with self.assertRaisesMessage(ValueError, "cannot be dispatched"):
                    self._create_roll_challan(order, [roll])

        order, item = self._order(status="DISPATCH_READY")
        item.line_closed_at = timezone.now()
        item.save(update_fields=["line_closed_at"])
        roll = self._roll(item)
        with self.assertRaisesMessage(ValueError, "cannot be dispatched"):
            self._create_roll_challan(order, [roll])

    def test_dispatch_revalidates_sales_order_line_lifecycle(self):
        order, item = self._order(status="DISPATCH_READY")
        roll = self._roll(item)
        challan = self._create_roll_challan(order, [roll])
        item.line_status = "CANCELLED"
        item.line_closed_at = timezone.now()
        item.save(update_fields=["line_status", "line_closed_at"])

        with self.assertRaisesMessage(ValueError, "cannot be dispatched"):
            FGDispatchService.dispatch_challan(str(challan.id), user=None)

        challan.refresh_from_db()
        roll.refresh_from_db()
        self.assertEqual(challan.status, "DRAFT")
        self.assertEqual(roll.status, "AVAILABLE")

    def test_only_draft_can_cancel_and_post_dispatch_return_is_blocked(self):
        order, _ = self._order(status="DISPATCH_READY")
        for source_status in ("DISPATCHED", "IN_TRANSIT"):
            for target_status in ("CANCELLED", "RETURNED"):
                with self.subTest(source_status=source_status, target_status=target_status):
                    challan = DeliveryChallan.objects.create(
                        dc_no=f"DC-GUARD-{source_status}-{target_status}",
                        customer_name=order.customer_name,
                        sales_order=order,
                        plant=self.plant,
                        status=source_status,
                    )
                    with self.assertRaisesMessage(ValueError, "Invalid transition"):
                        FGDispatchService.update_challan_status(str(challan.id), target_status)

    def test_historical_returned_membership_remains_non_reusable(self):
        order, item = self._order(status="DISPATCH_READY")
        roll = self._roll(item)
        returned = DeliveryChallan.objects.create(
            dc_no="DC-GUARD-HIST-RETURNED",
            customer_name=order.customer_name,
            sales_order=order,
            plant=self.plant,
            status="RETURNED",
        )
        DeliveryChallanItem.objects.create(
            challan=returned,
            sales_order_item=item,
            roll=roll,
            weight_kg=Decimal("11"),
            reservation_active=False,
        )

        summary = FGDispatchService.get_dispatchable_units_by_so(str(order.id))
        self.assertNotIn(str(roll.id), {row["id"] for row in summary["rolls"]})
        with self.assertRaisesMessage(ValueError, returned.dc_no):
            self._create_roll_challan(order, [roll])

    def test_postgres_dc_number_allocation_uses_transaction_advisory_lock(self):
        fake_connection = MagicMock()
        fake_connection.vendor = "postgresql"
        cursor = fake_connection.cursor.return_value.__enter__.return_value

        with patch(
            "apps.production.services.dispatch_service.connection",
            fake_connection,
        ):
            FGDispatchService._lock_delivery_challan_number_namespace("DC-20260728-")

        cursor.execute.assert_called_once_with(
            "SELECT pg_advisory_xact_lock(hashtext(%s), 0)",
            ["production.delivery_challan:DC-20260728-"],
        )
