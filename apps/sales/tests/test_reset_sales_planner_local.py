from io import StringIO

from django.core.management import call_command
from django.test import TestCase, override_settings

from apps.materials.models import ProductMaster
from apps.sales.models import Customer, SalesOrder, SalesSku
from apps.templates.models import TemplateBlueprint


class ResetSalesPlannerLocalCommandTests(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(code="CLEAN", name="Clean Customer")
        self.product = ProductMaster.objects.create(code="KEEP-PROD", name="Keep Product", product_kind="POUCH")
        self.template = TemplateBlueprint.objects.create(name="Keep Template", fg_type="POUCH", status="LIVE", pouch_style="STAND_UP")
        self.sku = SalesSku.objects.create(code="OLD-SKU", name="Old SKU", template=self.template, product_master=self.product)
        self.order = SalesOrder.objects.create(customer=self.customer, customer_name=self.customer.name)

    @override_settings(DEBUG=True)
    def test_dry_run_preserves_data_and_reports_counts(self):
        out = StringIO()
        call_command("reset_sales_planner_local", dry_run=True, stdout=out)

        self.assertIn("DRY RUN", out.getvalue())
        self.assertTrue(SalesOrder.objects.filter(id=self.order.id).exists())
        self.assertTrue(SalesSku.objects.filter(id=self.sku.id).exists())
        self.assertTrue(ProductMaster.objects.filter(id=self.product.id).exists())

    @override_settings(DEBUG=True)
    def test_confirmed_reset_deletes_sales_planner_but_keeps_product_customer_template(self):
        out = StringIO()
        call_command("reset_sales_planner_local", confirm=True, stdout=out)

        self.assertIn("deleted", out.getvalue().lower())
        self.assertFalse(SalesOrder.objects.filter(id=self.order.id).exists())
        self.assertFalse(SalesSku.objects.filter(id=self.sku.id).exists())
        self.assertTrue(ProductMaster.objects.filter(id=self.product.id).exists())
        self.assertTrue(Customer.objects.filter(id=self.customer.id).exists())
        self.assertTrue(TemplateBlueprint.objects.filter(id=self.template.id).exists())
