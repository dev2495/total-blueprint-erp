from django.core.management import call_command
from django.test import TestCase

from apps.factory.models import Plant
from apps.inventory.models import InventoryLocation, InventoryRoll
from apps.materials.models import InventoryMaterial, ProductMaster, ProductVariant
from apps.production.models import FinishedGoodsBatch, PlannedStockOrder, ProductionJob
from apps.routing.models import RoutingRule
from apps.sales.models import Customer, CustomerProductOverlay, SalesOrder, SalesOrderItem, SalesSku, SalesSkuVariant
from apps.templates.models import TemplateBlueprint


RESET_TOKEN = "RESET_PRODUCT_SALES_PLANNER_WORKSPACE"


class ResetProductSalesPlannerWorkspaceTests(TestCase):
    def setUp(self):
        self.plant = Plant.objects.create(name="Reset Plant", code="RST")
        self.location = InventoryLocation.objects.create(
            plant=self.plant,
            code="FG",
            name="FG Store",
            type="FG",
        )
        self.route = RoutingRule.objects.create(name="Reset Route", ordered_processes=["RST_EXT"])
        self.template = TemplateBlueprint.objects.create(
            name="Reset Template",
            fg_type="POUCH",
            status="LIVE",
            routing_rule=self.route,
            pouch_style="STAND_UP",
        )
        self.customer = Customer.objects.create(name="Reset Customer", code="RST-CUST")
        self.roll_material = InventoryMaterial.objects.create(
            code="RST-FILM",
            name="Reset Film",
            category="FILM_VARIANT",
            base_uom="KG",
        )

    def _seed_workspace(self, *, fg_batch=False):
        master = ProductMaster.objects.create(
            code="RST-PM",
            name="Reset Product Master",
            product_kind="POUCH",
            template=self.template,
        )
        variant = ProductVariant.objects.create(
            master=master,
            code="RST-PM-V1",
            bom_signature="rst-v1",
            axis_values={"size": "100X200"},
        )
        linked_pack = InventoryMaterial.objects.create(
            code="RST-INNER-PACK",
            name="Reset Inner Pack",
            category="PACKAGING",
            base_uom="PCS",
            packaging_kind="INNER_POUCH",
            packaging_supply_mode="IN_HOUSE",
            produced_by_product_variant=variant,
        )
        CustomerProductOverlay.objects.create(
            product_master=master,
            customer=self.customer,
            customer_item_code="RST-CUST-PM",
        )
        sales_sku = SalesSku.objects.create(
            code="RST-SKU",
            name="Reset Sales SKU",
            template=self.template,
            product_master=master,
        )
        sku_variant = SalesSkuVariant.objects.create(
            sku=sales_sku,
            code="RST-SKU-V1",
            name="Reset SKU Variant",
        )
        order = SalesOrder.objects.create(customer=self.customer, customer_name=self.customer.name)
        item = SalesOrderItem.objects.create(
            sales_order=order,
            template=self.template,
            product_master=master,
            product_variant=variant,
            sku_variant=sku_variant,
            qty_value=100,
            qty_uom="PCS",
        )
        stock_order = PlannedStockOrder.objects.create(
            template=self.template,
            product_master=master,
            plant=self.plant,
            target_qty=100,
            quantity_uom="PCS",
            output_type="FG_POUCH",
        )
        job = ProductionJob.objects.create(
            job_number="RST-JOB",
            template=self.template,
            routing_rule=self.route,
            sales_order_item=item,
            mts_order=stock_order,
            quantity=100,
            uom="PCS",
            to_location=self.location,
        )
        roll = InventoryRoll.objects.create(
            label_id="RST-ROLL",
            material=self.roll_material,
            width_mm=500,
            original_weight_kg=10,
            weight_kg=10,
            location=self.location,
            production_job=job,
            created_by_job=job,
            sales_order_item=item,
        )
        batch = None
        if fg_batch:
            batch = FinishedGoodsBatch.objects.create(
                batch_number="RST-FG",
                template=self.template,
                production_job=job,
                sales_order_item=item,
                qty_pcs=100,
                location=self.location,
            )
        return linked_pack, roll, job, batch

    def test_reset_deletes_workspace_and_preserves_inventory_rows(self):
        linked_pack, roll, _job, _batch = self._seed_workspace()

        call_command("reset_product_sales_planner_workspace", "--apply", "--confirm", RESET_TOKEN)

        self.assertEqual(ProductMaster.objects.count(), 0)
        self.assertEqual(ProductVariant.objects.count(), 0)
        self.assertEqual(SalesOrder.objects.count(), 0)
        self.assertEqual(SalesSku.objects.count(), 0)
        self.assertEqual(CustomerProductOverlay.objects.count(), 0)
        self.assertEqual(PlannedStockOrder.objects.count(), 0)
        self.assertEqual(ProductionJob.objects.count(), 0)
        self.assertEqual(TemplateBlueprint.objects.count(), 1)
        self.assertTrue(Customer.objects.filter(id=self.customer.id).exists())

        roll.refresh_from_db()
        self.assertIsNone(roll.production_job_id)
        self.assertIsNone(roll.created_by_job_id)
        self.assertIsNone(roll.sales_order_item_id)
        linked_pack.refresh_from_db()
        self.assertIsNone(linked_pack.produced_by_product_variant_id)

    def test_reset_preserves_fg_inventory_backed_jobs_as_provenance(self):
        linked_pack, roll, job, batch = self._seed_workspace(fg_batch=True)

        call_command("reset_product_sales_planner_workspace", "--apply", "--confirm", RESET_TOKEN)

        self.assertEqual(ProductMaster.objects.count(), 0)
        self.assertEqual(SalesOrder.objects.count(), 0)
        self.assertEqual(ProductionJob.objects.count(), 1)
        self.assertEqual(FinishedGoodsBatch.objects.count(), 1)

        job.refresh_from_db()
        batch.refresh_from_db()
        roll.refresh_from_db()
        linked_pack.refresh_from_db()
        self.assertIsNone(job.sales_order_item_id)
        self.assertIsNone(job.mts_order_id)
        self.assertIsNone(batch.sales_order_item_id)
        self.assertEqual(batch.production_job_id, job.id)
        self.assertEqual(roll.production_job_id, job.id)
        self.assertEqual(roll.created_by_job_id, job.id)
        self.assertIsNone(roll.sales_order_item_id)
        self.assertIsNone(linked_pack.produced_by_product_variant_id)
