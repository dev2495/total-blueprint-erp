from django.test import SimpleTestCase
from django.urls import resolve

from apps.sales.views_catalog import SalesSkuVariantViewSet, SalesSkuViewSet
from apps.sales.views_orders import SalesOrderViewSet
from apps.sales.views_quotations import QuotationViewSet


class SalesCanonicalUrlTests(SimpleTestCase):
    def test_sku_catalog_list_route_is_live_under_api_sales(self):
        match = resolve("/api/sales/sku-catalog/")
        self.assertIs(match.func.cls, SalesSkuViewSet)

    def test_sku_variant_list_route_is_live_under_api_sales(self):
        match = resolve("/api/sales/sku-variants/")
        self.assertIs(match.func.cls, SalesSkuVariantViewSet)

    def test_repeat_lines_action_is_live_under_api_sales_orders(self):
        match = resolve("/api/sales/orders/repeat-lines/")
        self.assertIs(match.func.cls, SalesOrderViewSet)
        self.assertEqual(match.func.actions["get"], "repeat_lines")

    def test_batch_create_action_is_live_under_api_sales_orders(self):
        match = resolve("/api/sales/orders/batch-create/")
        self.assertIs(match.func.cls, SalesOrderViewSet)
        self.assertEqual(match.func.actions["post"], "batch_create")

    def test_convert_quotation_to_order_action_is_live_under_api_sales(self):
        match = resolve("/api/sales/quotations/123e4567-e89b-12d3-a456-426614174000/convert-to-order/")
        self.assertIs(match.func.cls, QuotationViewSet)
        self.assertEqual(match.func.actions["post"], "convert_to_order")
