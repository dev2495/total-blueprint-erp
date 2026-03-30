from contextlib import nullcontext
from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from apps.sales.services.order_service import SalesOrderService


class SalesOrderBatchCreateTests(SimpleTestCase):
    @patch("apps.sales.services.order_service.transaction.atomic")
    @patch("apps.sales.services.order_service.SalesOrderService.confirm_sales_order")
    @patch("apps.sales.services.order_service.SalesOrderService.create_sales_order")
    def test_batch_create_creates_and_confirms_each_row(
        self,
        mock_create_sales_order,
        mock_confirm_sales_order,
        mock_atomic,
    ):
        mock_atomic.return_value = nullcontext()
        first_order = Mock(id="so-1", order_number="SO00001")
        second_order = Mock(id="so-2", order_number="SO00002")
        mock_create_sales_order.side_effect = [first_order, second_order]
        mock_confirm_sales_order.side_effect = [first_order, second_order]

        result = SalesOrderService.create_sales_order_batch(
            {
                "customer": "cust-1",
                "customer_name": "Acme Flex",
                "orders": [
                    {
                        "client_reference": "draft-1",
                        "source_type": "SKU",
                        "order_name": "Courier bag 10x12",
                        "delivery_date": "2026-03-20",
                        "items": [{"template_id": "tpl-1"}],
                    },
                    {
                        "client_reference": "draft-2",
                        "source_type": "CUSTOM",
                        "order_name": "Pouch trial",
                        "delivery_date": "2026-03-22",
                        "items": [{"template_id": "tpl-2"}],
                    },
                ],
            }
        )

        self.assertEqual(result["created_count"], 2)
        self.assertEqual(result["failed_count"], 0)
        self.assertEqual(
            [row["sales_order_number"] for row in result["results"]],
            ["SO00001", "SO00002"],
        )
        self.assertEqual(mock_create_sales_order.call_count, 2)
        self.assertEqual(mock_confirm_sales_order.call_count, 2)
        self.assertEqual(
            mock_create_sales_order.call_args_list[1].args[0]["items"][0]["mode"],
            "CUSTOM",
        )

    @patch("apps.sales.services.order_service.transaction.atomic")
    @patch("apps.sales.services.order_service.SalesOrderService.confirm_sales_order")
    @patch("apps.sales.services.order_service.SalesOrderService.create_sales_order")
    def test_batch_create_keeps_successes_when_one_row_fails(
        self,
        mock_create_sales_order,
        mock_confirm_sales_order,
        mock_atomic,
    ):
        mock_atomic.return_value = nullcontext()
        first_order = Mock(id="so-1", order_number="SO00001")
        mock_create_sales_order.side_effect = [first_order, ValueError("template_id is required")]
        mock_confirm_sales_order.return_value = first_order

        result = SalesOrderService.create_sales_order_batch(
            {
                "customer": "cust-1",
                "customer_name": "Acme Flex",
                "orders": [
                    {
                        "client_reference": "draft-1",
                        "source_type": "REPEAT",
                        "order_name": "Repeat bag",
                        "delivery_date": "2026-03-20",
                        "items": [{"template_id": "tpl-1"}],
                    },
                    {
                        "client_reference": "draft-2",
                        "source_type": "SKU",
                        "order_name": "Broken row",
                        "delivery_date": "2026-03-21",
                        "items": [{"template_id": ""}],
                    },
                ],
            }
        )

        self.assertEqual(result["created_count"], 1)
        self.assertEqual(result["failed_count"], 1)
        self.assertEqual(result["results"][0]["status"], "created")
        self.assertEqual(result["results"][1]["status"], "failed")
        self.assertIn("template_id is required", result["results"][1]["error"])
        self.assertEqual(mock_confirm_sales_order.call_count, 1)
