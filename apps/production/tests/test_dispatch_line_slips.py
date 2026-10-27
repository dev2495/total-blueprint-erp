from django.test import TestCase

import apps.production.tests.test_dispatch_reservation_guardrails as guard
from apps.production.models import DeliveryChallan, DeliveryChallanItem
from apps.production.services.dispatch_service import FGDispatchService

_fixture = guard.DispatchReservationGuardrailTests


class DispatchLineSlipTests(TestCase):
    """Dispatch Bay tray: one slip per sales-order line, vehicle optional, all or none."""

    setUp = _fixture.setUp
    _item = _fixture._item
    _order = _fixture._order
    _roll = _fixture._roll
    _gonny = _fixture._gonny

    def _slips(self, groups, **extra):
        return FGDispatchService.create_line_slips(
            groups,
            transporter_name=extra.pop("transporter_name", "Line Slip Transport"),
            **extra,
        )

    def test_each_line_gets_its_own_slip_across_orders_without_a_vehicle(self):
        first_order, first_line = self._order()
        second_line = self._item(first_order)
        other_order, other_line = self._order()
        rolls = [self._roll(first_line), self._roll(first_line), self._roll(second_line)]
        other_roll = self._roll(other_line)

        challans = self._slips(
            [
                {"sales_order_id": str(first_order.id), "roll_ids": [str(roll.id) for roll in rolls]},
                {"sales_order_id": str(other_order.id), "roll_ids": [str(other_roll.id)]},
            ]
        )

        self.assertEqual(len(challans), 3)
        for challan in challans:
            line_ids = set(challan.items.values_list("sales_order_item_id", flat=True))
            self.assertEqual(len(line_ids), 1, "a slip must carry exactly one order line")
            self.assertEqual(challan.vehicle_no, "")
            self.assertEqual(challan.status, "DRAFT")
        by_line = {
            str(challan.items.first().sales_order_item_id): challan.items.count() for challan in challans
        }
        self.assertEqual(by_line[str(first_line.id)], 2)
        self.assertEqual(by_line[str(second_line.id)], 1)
        self.assertEqual(by_line[str(other_line.id)], 1)

    def test_vehicle_and_transport_details_are_saved_when_given(self):
        order, line = self._order()
        roll = self._roll(line)

        challan = self._slips(
            [{"sales_order_id": str(order.id), "roll_ids": [str(roll.id)]}],
            vehicle_no="gj-05-bt-4412",
            driver_name="Ramesh",
            lr_number="LR-77",
        )[0]

        self.assertEqual(challan.vehicle_no, "GJ-05-BT-4412")
        self.assertEqual(challan.driver_name, "Ramesh")
        self.assertEqual(challan.lr_number, "LR-77")

    def test_units_of_one_line_at_two_plants_get_two_slips(self):
        order, line = self._order()
        here = self._roll(line)
        there = self._roll(line, location=self.other_location)

        challans = self._slips([{"sales_order_id": str(order.id), "roll_ids": [str(here.id), str(there.id)]}])

        self.assertEqual(len(challans), 2)
        self.assertEqual({challan.plant_id for challan in challans}, {self.plant.id, self.other_plant.id})

    def test_gonnies_and_rolls_split_by_line(self):
        order, pouch_line = self._order(template=self.pouch_template, qty_uom="PCS")
        roll_line = self._item(order)
        gonny = self._gonny(pouch_line)
        roll = self._roll(roll_line)

        challans = self._slips(
            [{"sales_order_id": str(order.id), "gonny_ids": [str(gonny.id)], "roll_ids": [str(roll.id)]}]
        )

        self.assertEqual(len(challans), 2)
        kinds = sorted(
            "GONNY" if challan.items.filter(packing_unit__isnull=False).exists() else "ROLL" for challan in challans
        )
        self.assertEqual(kinds, ["GONNY", "ROLL"])

    def test_a_bad_entry_creates_no_slip_at_all(self):
        order, line = self._order()
        good = self._roll(line)
        unreleased = self._roll(line, release=False)
        other_order, other_line = self._order()
        other = self._roll(other_line)

        with self.assertRaisesMessage(ValueError, "not released"):
            self._slips(
                [
                    {"sales_order_id": str(other_order.id), "roll_ids": [str(other.id)]},
                    {"sales_order_id": str(order.id), "roll_ids": [str(good.id), str(unreleased.id)]},
                ]
            )
        self.assertFalse(DeliveryChallan.objects.exists())
        self.assertFalse(DeliveryChallanItem.objects.filter(reservation_active=True).exists())

    def test_transporter_stays_required_and_empty_tray_is_refused(self):
        order, line = self._order()
        roll = self._roll(line)

        with self.assertRaisesMessage(ValueError, "Transport name is required"):
            self._slips([{"sales_order_id": str(order.id), "roll_ids": [str(roll.id)]}], transporter_name="")
        with self.assertRaisesMessage(ValueError, "Add at least one line"):
            self._slips([])
        with self.assertRaisesMessage(ValueError, "has no units"):
            self._slips([{"sales_order_id": str(order.id), "roll_ids": []}])


class PackingReleaseHistoryTests(TestCase):
    setUp = _fixture.setUp
    _item = _fixture._item
    _order = _fixture._order
    _roll = _fixture._roll
    _gonny = _fixture._gonny

    def test_released_units_are_listed_newest_first_with_their_slip(self):
        order, roll_line = self._order()
        pouch_line = self._item(order, template=self.pouch_template, qty_uom="PCS")
        first_roll = self._roll(roll_line)
        gonny = self._gonny(pouch_line)
        gonny.meta_json = {
            "released_to_dispatch": True,
            "released_to_dispatch_at": "2099-01-01T00:00:00+00:00",
            "released_to_dispatch_by_name": "Yard Lead",
            "dispatch_unit_no": "DU-1",
        }
        gonny.save(update_fields=["meta_json"])
        self._roll(roll_line, release=False)

        FGDispatchService.create_line_slips(
            [{"sales_order_id": str(order.id), "roll_ids": [str(first_roll.id)]}],
            transporter_name="History Transport",
        )
        history = FGDispatchService.get_packing_release_history()

        self.assertEqual(history["total"], 2)
        self.assertEqual([row["kind"] for row in history["results"]], ["GONNY", "ROLL"])
        newest = history["results"][0]
        self.assertEqual(newest["unit"], "DU-1")
        self.assertEqual(newest["released_by"], "Yard Lead")
        self.assertEqual(newest["sales_order"]["order_number"], order.order_number)
        self.assertEqual(newest["qty_pcs"], 100)
        self.assertIsNone(newest["slip"])
        roll_row = history["results"][1]
        self.assertEqual(roll_row["release_mode"], "UNPACKED")
        self.assertTrue(roll_row["slip"]["dc_no"].startswith("DC-"))

    def test_search_and_order_filter_and_paging(self):
        order, line = self._order()
        other_order, other_line = self._order()
        rolls = [self._roll(line) for _ in range(3)]
        self._roll(other_line)

        scoped = FGDispatchService.get_packing_release_history(sales_order_id=str(order.id), limit=2)
        self.assertEqual(scoped["total"], 3)
        self.assertEqual(len(scoped["results"]), 2)
        second_page = FGDispatchService.get_packing_release_history(sales_order_id=str(order.id), limit=2, offset=2)
        self.assertEqual(len(second_page["results"]), 1)

        from datetime import timedelta
        from django.utils import timezone

        today = timezone.localtime().replace(hour=0, minute=0, second=0, microsecond=0)
        self.assertEqual(FGDispatchService.get_packing_release_history(since=today)["total"], 4)
        self.assertEqual(FGDispatchService.get_packing_release_history(since=today + timedelta(days=1))["total"], 0)

        found = FGDispatchService.get_packing_release_history(search=rolls[0].label_id)
        self.assertEqual([row["id"] for row in found["results"]], [str(rolls[0].id)])
        self.assertEqual(FGDispatchService.get_packing_release_history(search=other_order.order_number)["total"], 1)


class PackingBoardTodayTests(TestCase):
    setUp = _fixture.setUp
    _item = _fixture._item
    _order = _fixture._order
    _roll = _fixture._roll
    _gonny = _fixture._gonny

    def test_snapshot_counts_ready_lines_and_todays_releases(self):
        order, first_line = self._order()
        second_line = self._item(order)
        self._roll(first_line, release=False)
        self._roll(first_line, release=False)
        self._roll(second_line, release=False)
        released = self._roll(second_line)

        snapshot = FGDispatchService.get_packing_board_snapshot()
        card = next(row for row in snapshot["orders"] if row["sales_order"]["id"] == str(order.id))

        self.assertEqual(card["ready_lines"], 2)
        self.assertAlmostEqual(card["ready_kg"], 30.0)
        self.assertEqual(snapshot["totals"]["ready_lines"], 2)
        self.assertAlmostEqual(snapshot["totals"]["ready_roll_kg"], 30.0)
        self.assertEqual(snapshot["totals"]["released_today_rolls"], 1)
        self.assertAlmostEqual(snapshot["totals"]["released_today_net_kg"], float(released.net_weight_kg))
        self.assertAlmostEqual(snapshot["totals"]["released_today_gross_kg"], float(released.gross_weight_kg))


class DispatchLineBalanceTests(TestCase):
    setUp = _fixture.setUp
    _item = _fixture._item
    _order = _fixture._order
    _roll = _fixture._roll
    _gonny = _fixture._gonny

    def test_lines_carry_number_order_balance_draft_and_packing_left(self):
        from django.test import RequestFactory

        from apps.production.views import DeliveryChallanViewSet

        order, first_line = self._order()
        second_line = self._item(order)
        loaded = self._roll(first_line)
        self._roll(first_line)
        self._roll(second_line, release=False)

        challan = FGDispatchService.create_line_slips(
            [{"sales_order_id": str(order.id), "roll_ids": [str(loaded.id)]}],
            transporter_name="Balance Transport",
        )[0]
        summary = FGDispatchService.get_dispatchable_units_by_so(str(order.id))
        lines = {row["id"]: row for row in summary["lines"]}

        first, second = lines[str(first_line.id)], lines[str(second_line.id)]
        self.assertEqual((first["line_no"], second["line_no"]), (1, 2))
        self.assertEqual(summary["line_numbers"], {str(first_line.id): 1, str(second_line.id): 2})
        self.assertEqual(first["qty_uom"], "KG")
        self.assertEqual(first["ordered_qty"], 100.0)
        self.assertEqual(first["dispatched_qty"], 0.0)
        self.assertEqual(first["on_draft_units"], 1)
        self.assertAlmostEqual(first["on_draft_qty"], float(loaded.gross_weight_kg))
        self.assertEqual(second["pending"]["unreleased_rolls"], 1)
        self.assertEqual(second["on_draft_units"], 0)

        from rest_framework.request import Request

        rows = DeliveryChallanViewSet().list_challans(Request(RequestFactory().get("/challans/list_challans/"))).data
        self.assertIsInstance(rows, list, rows)
        row = next(item for item in rows if item["id"] == str(challan.id))
        self.assertEqual(row["units"], 1)
        self.assertEqual(row["rolls"], 1)
        self.assertEqual(row["line_no"], 1)
        self.assertEqual(row["sales_order_id"], str(order.id))
        self.assertAlmostEqual(row["gross_kg"], float(loaded.gross_weight_kg))
        self.assertTrue(row["line_name"])


class DispatchHistoryPagingTests(TestCase):
    """Dispatch Bay history is paged and filtered on the server, with counts and today's figures."""

    setUp = _fixture.setUp
    _item = _fixture._item
    _order = _fixture._order
    _roll = _fixture._roll
    _gonny = _fixture._gonny

    def _history(self, **params):
        from django.test import RequestFactory
        from rest_framework.request import Request

        from apps.production.views import DeliveryChallanViewSet

        return DeliveryChallanViewSet().history(Request(RequestFactory().get("/challans/history/", params)))

    def test_tabs_search_paging_and_today(self):
        from django.utils import timezone

        slips = []
        for index in range(3):
            order, line = self._order()
            slips += FGDispatchService.create_line_slips(
                [{"sales_order_id": str(order.id), "roll_ids": [str(self._roll(line).id)]}],
                transporter_name=f"History Transport {index}",
                vehicle_no=f"GJ01AB{index:04d}",
            )
        dispatched = slips[0]
        DeliveryChallan.objects.filter(pk=dispatched.pk).update(status="DISPATCHED", dispatch_date=timezone.now())

        response = self._history(limit="2")
        self.assertEqual(response.status_code, 200, response.data)
        data = response.data
        self.assertEqual(data["count"], 3)
        self.assertEqual(len(data["results"]), 2)
        self.assertEqual(data["tab_counts"]["ALL"], 3)
        self.assertEqual(data["tab_counts"]["DRAFT"], 2)
        self.assertEqual(data["tab_counts"]["POD"], 1)
        self.assertEqual(data["stats"]["slips_today"], 3)
        self.assertEqual(data["stats"]["dispatched_today"], 1)
        self.assertEqual(data["stats"]["shipped_today"], 1)
        self.assertEqual(data["status_counts"], {"DRAFT": 2, "DISPATCHED": 1})
        self.assertEqual(data["stats"]["vehicles_today"], ["GJ01AB0000"])
        self.assertEqual(len(data["stats"]["recent_transporters"]), 3)

        second_page = self._history(limit="2", offset="2").data
        self.assertEqual(len(second_page["results"]), 1)
        seen = {row["id"] for row in data["results"]} | {row["id"] for row in second_page["results"]}
        self.assertEqual(seen, {str(slip.id) for slip in slips})

        pod = self._history(tab="POD").data
        self.assertEqual([row["id"] for row in pod["results"]], [str(dispatched.id)])

        found = self._history(search=slips[2].dc_no).data
        self.assertEqual([row["id"] for row in found["results"]], [str(slips[2].id)])
        self.assertEqual(self._history(search="GJ01AB0001").data["count"], 1)

        self.assertEqual(self._history(tab="NOPE").status_code, 400)
        self.assertEqual(self._history(limit="x").status_code, 400)



class ClosedLineDispatchTests(TestCase):
    """Goods made for a line that was closed later: ship them on confirmation, or move them to stock."""

    setUp = _fixture.setUp
    _item = _fixture._item
    _order = _fixture._order
    _roll = _fixture._roll
    _gonny = _fixture._gonny

    def _short_close(self, line):
        line.qty_short_closed = line.qty_value
        line.line_status = "SHORT_CLOSED"
        line.save(update_fields=["qty_short_closed", "line_status"])

    def _slips(self, groups, **extra):
        return FGDispatchService.create_line_slips(groups, transporter_name="Closed Line Transport", **extra)

    def test_closed_line_ships_only_with_confirmation_and_pod_keeps_it_closed(self):
        order, line = self._order()
        roll = self._roll(line)
        self._short_close(line)
        group = [{"sales_order_id": str(order.id), "roll_ids": [str(roll.id)]}]

        with self.assertRaisesMessage(ValueError, "Confirm shipping the goods already made"):
            self._slips(group)
        self.assertEqual(DeliveryChallan.objects.count(), 0)

        challan = self._slips(group, ship_closed_lines=True)[0]
        with self.assertRaisesMessage(ValueError, "confirm shipping the goods already made"):
            FGDispatchService.dispatch_challan(str(challan.id))
        FGDispatchService.dispatch_challan(str(challan.id), ship_closed_lines=True)
        FGDispatchService.confirm_pod(str(challan.id), received_by="Receiver", reference="POD-1")

        line.refresh_from_db()
        order.refresh_from_db()
        # The line keeps its short-close; the order is done because its only line is closed and delivered.
        self.assertEqual(line.line_status, "SHORT_CLOSED")
        self.assertEqual(order.status, "COMPLETED")

    def test_completed_order_ships_on_confirmation_and_stays_completed(self):
        order, line = self._order()
        roll = self._roll(line)
        self._short_close(line)
        order.status = "COMPLETED"
        order.save(update_fields=["status"])
        group = [{"sales_order_id": str(order.id), "roll_ids": [str(roll.id)]}]

        with self.assertRaisesMessage(ValueError, "Closed lines on the tray"):
            self._slips(group)
        challan = self._slips(group, ship_closed_lines=True)[0]
        FGDispatchService.dispatch_challan(str(challan.id), ship_closed_lines=True)
        result = FGDispatchService.confirm_pod(str(challan.id), received_by="Receiver")
        order.refresh_from_db()
        self.assertEqual(order.status, "COMPLETED")
        self.assertFalse(result.order_closed)

    def test_draft_order_still_never_dispatches(self):
        order, line = self._order()
        roll = self._roll(line)
        order.status = "DRAFT"
        order.save(update_fields=["status"])
        with self.assertRaisesMessage(ValueError, "a challan cannot be created in this order state"):
            self._slips([{"sales_order_id": str(order.id), "roll_ids": [str(roll.id)]}], ship_closed_lines=True)

    def test_move_to_stock_frees_units_of_closed_lines_only(self):
        order, line = self._order()
        roll = self._roll(line)
        open_order, open_line = self._order()
        open_roll = self._roll(open_line)

        with self.assertRaisesMessage(ValueError, "still open"):
            FGDispatchService.move_units_to_stock(roll_ids=[str(open_roll.id)], reason="Customer stopped")
        with self.assertRaisesMessage(ValueError, "Say why"):
            FGDispatchService.move_units_to_stock(roll_ids=[str(roll.id)], reason="")

        self._short_close(line)
        result = FGDispatchService.move_units_to_stock(roll_ids=[str(roll.id)], reason="Customer stopped the order")
        self.assertEqual(result["count"], 1)
        roll.refresh_from_db()
        self.assertIsNone(roll.sales_order_item_id)
        self.assertEqual(roll.meta_json["free_stock"]["from_sales_order_no"], order.order_number)
        self.assertEqual(roll.meta_json["free_stock"]["from_line_no"], 1)
        self.assertFalse(FGDispatchService._roll_dispatch_release_map([str(roll.id)]).get(str(roll.id)))
        board_orders = {row["id"] for row in FGDispatchService.get_sales_orders_with_fg()}
        self.assertNotIn(str(order.id), board_orders)
        self.assertIn(str(open_order.id), board_orders)

    def test_units_on_a_draft_slip_cannot_move_to_stock(self):
        order, line = self._order()
        roll = self._roll(line)
        self._slips([{"sales_order_id": str(order.id), "roll_ids": [str(roll.id)]}])
        self._short_close(line)
        with self.assertRaises(ValueError):
            FGDispatchService.move_units_to_stock(roll_ids=[str(roll.id)], reason="Customer stopped")

    def test_summaries_mark_closed_lines(self):
        order, line = self._order()
        self._roll(line)
        self._short_close(line)
        summary = FGDispatchService.get_dispatchable_units_by_so(str(order.id))
        self.assertTrue(summary["lines"][0]["closed"])
        packing = FGDispatchService.get_packing_units_by_so(str(order.id))
        self.assertEqual(packing["closed_line_ids"], [str(line.id)])
        self.assertFalse(packing["order_closed"])


class EveningCountSplitTests(TestCase):
    def test_pieces_are_shared_in_whole_pieces(self):
        from decimal import Decimal

        from apps.production.services.packing_count_service import PackingCountService

        shares = PackingCountService.split_count_usage(Decimal("1"), [Decimal("1")] * 14, whole_pieces=True)
        self.assertEqual(sum(shares), Decimal("1"))
        self.assertEqual(sorted(shares, reverse=True)[0], Decimal("1"))
        self.assertEqual(len([value for value in shares if value]), 1)

        shares = PackingCountService.split_count_usage(Decimal("7"), [Decimal("3"), Decimal("1"), Decimal("2")], whole_pieces=True)
        self.assertEqual(shares, [Decimal("4"), Decimal("1"), Decimal("2")])
        self.assertTrue(all(value == int(value) for value in shares))

        shares = PackingCountService.split_count_usage(Decimal("2.5"), [Decimal("1"), Decimal("1")], whole_pieces=True)
        self.assertEqual(sum(shares), Decimal("2.5"))

        kg = PackingCountService.split_count_usage(Decimal("1"), [Decimal("1"), Decimal("2")], whole_pieces=False)
        self.assertEqual(sum(kg), Decimal("1"))

    def test_an_item_marked_twice_on_one_unit_counts_once(self):
        from decimal import Decimal

        from apps.production.services.packing_count_service import one_mark_per_material

        gonny = "11111111-1111-1111-1111-111111111111"
        tape = "22222222-2222-2222-2222-222222222222"
        marks = one_mark_per_material(
            [
                {"material_id": gonny, "qty": 1.0, "capture_mode": "MARKED_FOR_COUNT"},  # chosen when sealed
                {"material_id": gonny, "qty": 1, "basis": "PER_GONNY_RELEASE"},  # ticked again at release
                {"material_id": tape, "qty": 1},
                {"material_id": tape, "qty": 3},  # an explicit quantity is kept
                {"material_id": ""},
                "not a mark",
            ]
        )
        by_material = {row["material_id"]: Decimal(str(row["qty"])) for row in marks}
        self.assertEqual(by_material, {gonny: Decimal("1"), tape: Decimal("3")})


# Borrowed fixture methods only; keep the guardrail suite from being collected here a second time.
del _fixture
