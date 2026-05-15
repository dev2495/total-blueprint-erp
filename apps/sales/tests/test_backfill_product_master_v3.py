from io import StringIO

from django.core.management import call_command
from django.test import TestCase, override_settings

from apps.materials.models import InventoryMaterial, ProductMaster, ProductVariant
from apps.sales.models import Customer, CustomerProductOverlay, SalesOrder, SalesOrderItem, SalesSku, SalesSkuVariant
from apps.templates.models import TemplateBlueprint


class BackfillSalesProductMasterV3CommandTests(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(code="BF-CUST", name="Backfill Customer")
        self.template = TemplateBlueprint.objects.create(name="Backfill Pouch Route", fg_type="POUCH", status="LIVE", pouch_style="STAND_UP")
        family = InventoryMaterial.objects.create(
            code="BF-FILM-FAM",
            name="Backfill film family",
            category="FILM_FAMILY",
            base_uom="KG",
        )
        InventoryMaterial.objects.create(
            code="BF-LDPE-65",
            name="Backfill LDPE 65",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            is_extrudable=True,
        )
        self.product = ProductMaster.objects.create(
            code="PM-BF-DRY",
            name="Backfill Dry Fruit Pouch",
            product_kind="POUCH",
            template=self.template,
            default_template=self.template,
            layer_template=[{"role": "sealant", "material_code": "BF-LDPE-65", "thickness_micron": 65, "default_grade": "FOOD"}],
            variant_axes=[
                {"axis": "size", "type": "geometry", "required": True, "options": ["100x160"]},
            ],
            fixed_attributes={"fg_type": "POUCH", "pouch_style": "STAND_UP", "layer_count": 1},
        )
        self.overlay = CustomerProductOverlay.objects.create(
            product_master=self.product,
            customer=self.customer,
            axis_values={"size": "100x160"},
            customer_item_code="BF-100",
        )
        self.sku = SalesSku.objects.create(
            code="BF-SKU",
            name="Backfill preset",
            template=self.template,
            product_master=self.product,
            axis_values_template={"size": "100x160"},
        )
        self.sku_variant = SalesSkuVariant.objects.create(
            sku=self.sku,
            code="BF-OLD-VAR",
            name="Old bloated variant",
            finished_good_type="POUCH",
            geometry_snapshot={"axis_values": {"size": "100x160"}},
            layer_snapshot=[{"material_code": "BF-LDPE-65", "thickness_micron": 65, "grade_code": "FOOD"}],
            printing_snapshot={"enabled": False},
            addons_snapshot=[],
        )
        self.order = SalesOrder.objects.create(customer=self.customer, customer_name=self.customer.name)
        self.item = SalesOrderItem.objects.create(
            sales_order=self.order,
            template=self.template,
            sku_variant=self.sku_variant,
            line_name="Historical line",
            geometry_snapshot={"base": {"width_mm": 100, "height_mm": 160}},
            layer_snapshot=[],
            printing_snapshot={"enabled": False},
            addons_snapshot=[],
            qty_value=100,
            qty_uom="PCS",
            unit_price=2,
            price_basis="PCS",
        )

    @override_settings(DEBUG=True)
    def test_dry_run_reports_without_updating_rows(self):
        out = StringIO()
        call_command("backfill_sales_product_master_v3", stdout=out)

        self.item.refresh_from_db()
        self.assertIn("DRY RUN", out.getvalue())
        self.assertIsNone(self.item.product_master_id)
        self.assertEqual(ProductVariant.objects.count(), 0)

    @override_settings(DEBUG=True)
    def test_confirm_backfills_product_axis_variant_and_overlay(self):
        out = StringIO()
        call_command("backfill_sales_product_master_v3", confirm=True, stdout=out)

        self.item.refresh_from_db()
        self.assertIn("Backfilled 1", out.getvalue())
        self.assertEqual(self.item.product_master_id, self.product.id)
        self.assertEqual(self.item.axis_values, {"size": "100x160"})
        self.assertIsNotNone(self.item.product_variant_id)
        self.assertEqual(self.item.customer_product_overlay_id, self.overlay.id)
