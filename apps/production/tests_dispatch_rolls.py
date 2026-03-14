from decimal import Decimal

from django.test import TestCase

from apps.factory.models import Plant
from apps.inventory.models import InventoryLocation, InventoryRoll
from apps.materials.models import InventoryMaterial
from apps.production.models import DeliveryChallanItem
from apps.production.services.dispatch_service import FGDispatchService
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.templates.models import TemplateBlueprint


class FGDispatchRollListTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.plant = Plant.objects.create(name="Dispatch Plant", code="DSP")
        cls.fg_location = InventoryLocation.objects.create(
            plant=cls.plant,
            code="FG-STORE",
            name="FG Store",
            type="FG",
        )
        cls.material = InventoryMaterial.objects.create(
            code="FILM-DSP-001",
            name="Dispatch Film",
            category="FILM_VARIANT",
            is_extrudable=False,
            is_purchasable=True,
        )
        cls.template = TemplateBlueprint.objects.create(
            name="Dispatch Roll Template",
            fg_type="ROLL",
            status="DRAFT",
        )

    def _create_sales_order_with_fg_rolls(self, roll_count=5, roll_weight=Decimal("100.000")):
        sales_order = SalesOrder.objects.create(
            customer_name="Dispatch Test Customer",
            status="CONFIRMED",
        )
        item = SalesOrderItem.objects.create(
            sales_order=sales_order,
            template=self.template,
            mode="TEMPLATE",
            geometry_snapshot={"fg_type": "ROLL", "base": {"width_mm": 500}},
            layer_snapshot=[{"family": "PE", "thickness_micron": 40}],
            printing_snapshot={"enabled": False},
            addons_snapshot=[],
            bom_snapshot={"items": []},
            qty_uom="KG",
            qty_value=Decimal(str(roll_count)) * roll_weight,
            unit_weight_g=Decimal("0"),
            total_weight_kg=Decimal(str(roll_count)) * roll_weight,
            price_basis="KG",
            unit_price=Decimal("1.0000"),
        )

        rolls = []
        for idx in range(roll_count):
            roll = InventoryRoll.objects.create(
                label_id=f"FG-DSP-{sales_order.order_number}-{idx+1}",
                material=self.material,
                batch_no=f"RB-{idx+1}",
                thickness_micron=Decimal("40"),
                width_mm=Decimal("1200"),
                length_m=Decimal("1000"),
                original_weight_kg=roll_weight,
                weight_kg=roll_weight,
                location=self.fg_location,
                plant=self.plant,
                status="AVAILABLE",
                is_fg=True,
                template=self.template,
                sales_order_item=item,
            )
            rolls.append(roll)
        return sales_order, item, rolls

    def test_dispatchable_summary_lists_each_fg_roll_for_sales_order(self):
        so, _, rolls = self._create_sales_order_with_fg_rolls(roll_count=5, roll_weight=Decimal("100.000"))

        summary = FGDispatchService.get_dispatchable_units_by_so(str(so.id))

        self.assertEqual(len(summary["rolls"]), 5)
        self.assertEqual(summary["available_for_dispatch"]["rolls_count"], 5)
        self.assertEqual(Decimal(str(summary["available_for_dispatch"]["rolls_kg"])), Decimal("500"))

        ids_from_summary = {row["id"] for row in summary["rolls"]}
        self.assertEqual(ids_from_summary, {str(r.id) for r in rolls})
        self.assertTrue(all(row.get("batch_no") for row in summary["rolls"]))

    def test_create_and_dispatch_challan_creates_one_line_per_roll(self):
        so, _, rolls = self._create_sales_order_with_fg_rolls(roll_count=5, roll_weight=Decimal("100.000"))

        challan = FGDispatchService.create_challan(
            customer_name=so.customer_name,
            plant_id=str(self.plant.id),
            sales_order_id=str(so.id),
            roll_ids=[str(r.id) for r in rolls],
            user=None,
        )

        item_rows = list(challan.items.select_related("roll"))
        self.assertEqual(len(item_rows), 5)
        self.assertEqual(
            {str(row.roll_id) for row in item_rows},
            {str(r.id) for r in rolls},
        )
        self.assertEqual(DeliveryChallanItem.objects.filter(challan=challan).count(), 5)

        FGDispatchService.dispatch_challan(str(challan.id), user=None)
        statuses = set(
            InventoryRoll.objects.filter(id__in=[r.id for r in rolls]).values_list("status", flat=True)
        )
        self.assertEqual(statuses, {"IN_TRANSIT"})

