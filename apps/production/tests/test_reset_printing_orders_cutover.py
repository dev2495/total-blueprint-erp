from decimal import Decimal
from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from apps.factory.models import Plant, Process, WorkCenter
from apps.inventory.models import (
    BulkTransaction,
    InventoryBulk,
    InventoryLocation,
    InventoryRoll,
    PackagingStock,
    PackagingTransaction,
    StockAdjustment,
    StockAdjustmentLine,
)
from apps.materials.models import InventoryMaterial, ProductMaster
from apps.production.management.commands.reset_printing_orders_for_new_ink_model import RESET_TOKEN
from apps.production.models import ProductionJob
from apps.routing.models import RoutingRule
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.templates.models import TemplateBlueprint


class ResetPrintingOrdersCutoverCommandTests(TestCase):
    def setUp(self):
        self.plant = Plant.objects.create(name="Cutover Plant", code="CUTOVER")
        self.location = InventoryLocation.objects.create(
            plant=self.plant,
            code="CUTOVER-RM",
            name="Cutover RM",
            type="RM",
        )
        self.work_center = WorkCenter.objects.create(
            plant=self.plant,
            name="Cutover WC",
            code="CUTOVER-WC",
            default_wip_location=self.location,
        )
        self.process = Process.objects.create(code="CUTOVER-PROC", name="Cutover Process")
        self.route = RoutingRule.objects.create(name="Cutover Route", ordered_processes=[self.process.code])
        self.template = TemplateBlueprint.objects.create(
            name="Cutover Template",
            fg_type="POUCH",
            status="LIVE",
            routing_rule=self.route,
        )
        self.print_master = ProductMaster.objects.create(
            code="CUTOVER-PRINT-PM",
            name="Cutover Print PM",
            product_kind="POUCH",
            fixed_attributes={"print_capable": True},
            template=self.template,
        )
        self.plain_master = ProductMaster.objects.create(
            code="CUTOVER-PLAIN-PM",
            name="Cutover Plain PM",
            product_kind="POUCH",
            fixed_attributes={"print_capable": False},
            template=self.template,
        )
        self.granule = InventoryMaterial.objects.create(
            code="CUTOVER-GRANULE",
            name="Cutover Granule",
            category="GRANULE",
            base_uom="KG",
        )
        self.packaging = InventoryMaterial.objects.create(
            code="CUTOVER-GONNY",
            name="Cutover Gonny",
            category="PACKAGING",
            base_uom="PCS",
            packaging_kind="GONNY",
            packaging_supply_mode="PURCHASED",
        )

    def _order_item(self, *, order_no, customer, master, printing_enabled):
        order = SalesOrder.objects.create(order_number=order_no, customer_name=customer)
        item = SalesOrderItem.objects.create(
            sales_order=order,
            template=self.template,
            product_master=master,
            qty_value=Decimal("10"),
            qty_uom="KG",
            unit_price=Decimal("1"),
            printing_snapshot={"enabled": printing_enabled},
        )
        return order, item

    def _job(self, item, number):
        return ProductionJob.objects.create(
            job_number=number,
            template=self.template,
            sales_order_item=item,
            routing_rule=self.route,
            current_step_index=0,
            current_process=self.process,
            process=self.process,
            work_center=self.work_center,
            from_location=self.location,
            to_location=self.location,
            quantity=Decimal("10"),
            remaining_qty=Decimal("10"),
            uom="KG",
        )

    def test_apply_deletes_only_printing_orders_and_reverses_signed_stock(self):
        print_order, print_item = self._order_item(
            order_no="SO-CUTOVER-PRINT",
            customer="Print Customer",
            master=self.print_master,
            printing_enabled=True,
        )
        plain_order, _plain_item = self._order_item(
            order_no="SO-CUTOVER-PLAIN",
            customer="Plain Customer",
            master=self.plain_master,
            printing_enabled=False,
        )
        print_job = self._job(print_item, "JOB-CUTOVER-PRINT")

        InventoryBulk.objects.create(
            material=self.granule,
            plant=self.plant,
            location=self.location,
            qty_kg=Decimal("5.0000"),
        )
        BulkTransaction.objects.create(
            material=self.granule,
            location=self.location,
            type="CONSUME",
            qty_kg=Decimal("-2.0000"),
            job=print_job,
            reference="selected print consume",
        )
        PackagingStock.objects.create(
            material=self.packaging,
            plant=self.plant,
            location=self.location,
            qty=Decimal("10.0000"),
        )
        PackagingTransaction.objects.create(
            material=self.packaging,
            location=self.location,
            type="CONSUME",
            qty=Decimal("-3.0000"),
            job=print_job,
            sales_order_item=print_item,
            reference="selected print pack consume",
        )
        selected_roll = InventoryRoll.objects.create(
            label_id="ROLL-CUTOVER-PRINT",
            material=self.granule,
            plant=self.plant,
            location=self.location,
            width_mm=Decimal("1000"),
            thickness_micron=Decimal("50"),
            weight_kg=Decimal("10.000"),
            created_by_job=print_job,
            production_job=print_job,
            sales_order_item=print_item,
        )
        adjustment = StockAdjustment.objects.create(
            code="ADJ-CUTOVER-PRINT",
            plant=self.plant,
            status="POSTED",
            reason="COUNT_CORRECTION",
        )
        StockAdjustmentLine.objects.create(
            adjustment=adjustment,
            stock_class="ROLL",
            inventory_roll=selected_roll,
            location=self.location,
            before_qty=Decimal("9.000"),
            delta_qty=Decimal("1.000"),
            after_qty=Decimal("10.000"),
        )

        out = StringIO()
        call_command(
            "reset_printing_orders_for_new_ink_model",
            apply=True,
            confirm=RESET_TOKEN,
            stdout=out,
        )

        self.assertFalse(SalesOrder.objects.filter(id=print_order.id).exists())
        self.assertTrue(SalesOrder.objects.filter(id=plain_order.id).exists())
        self.assertFalse(ProductionJob.objects.filter(id=print_job.id).exists())
        self.assertFalse(BulkTransaction.objects.filter(job_id=print_job.id).exists())
        self.assertFalse(PackagingTransaction.objects.filter(job_id=print_job.id).exists())
        self.assertFalse(InventoryRoll.objects.filter(id=selected_roll.id).exists())
        self.assertFalse(StockAdjustmentLine.objects.filter(adjustment=adjustment).exists())
        self.assertFalse(StockAdjustment.objects.filter(id=adjustment.id).exists())
        self.assertEqual(InventoryBulk.objects.get(material=self.granule, location=self.location).qty_kg, Decimal("7.0000"))
        self.assertEqual(PackagingStock.objects.get(material=self.packaging, location=self.location).qty, Decimal("13.0000"))
