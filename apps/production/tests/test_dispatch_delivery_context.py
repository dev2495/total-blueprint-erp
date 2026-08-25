from types import SimpleNamespace

from django.test import SimpleTestCase

from apps.production.services.dispatch_service import FGDispatchService


def _customer(**overrides):
    values = {
        "name": "Illustrative Customer",
        "shipping_address": "Customer Master Address",
        "mailing_state": "Gujarat",
        "mailing_pincode": "390001",
        "mailing_country": "India",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _sales_order(**overrides):
    customer = overrides.pop("customer", _customer())
    values = {
        "id": "so-1",
        "order_number": "SO-TEST-1",
        "customer_name": "Illustrative Customer",
        "customer": customer,
        "ship_to_customer": customer,
        "ship_to_customer_id": "customer-1",
        "ship_to_customer_name": "Illustrative Customer Warehouse",
        "ship_to_address": "Sales Order Delivery Address",
        "address_override": "Legacy Order Override",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class DispatchDeliveryContextTests(SimpleTestCase):
    def test_sales_order_address_has_precedence_and_delivery_party_is_locked(self):
        context = FGDispatchService._sales_order_delivery_context(_sales_order())

        self.assertEqual(context["delivery_to"], "Illustrative Customer Warehouse")
        self.assertEqual(context["address"], "Sales Order Delivery Address")
        self.assertEqual(context["location"], "Sales Order Delivery Address")
        self.assertEqual(context["address_source"], "SALES_ORDER_SHIP_TO_ADDRESS")

    def test_dispatch_location_override_is_audited_without_rewriting_order_context(self):
        order = _sales_order()
        snapshot = FGDispatchService._dispatch_delivery_snapshot(
            order,
            {
                "location": "Dispatch-only Dock 4",
                "delivery_to": "Forged Party",
                "address": "Forged Address",
            },
            user=SimpleNamespace(
                id="user-1",
                username="dispatcher",
                get_full_name=lambda: "Dispatch Operator",
            ),
        )

        self.assertEqual(snapshot["delivery_to"], "Illustrative Customer Warehouse")
        self.assertEqual(snapshot["address"], "Sales Order Delivery Address")
        self.assertEqual(snapshot["location"], "Dispatch-only Dock 4")
        self.assertEqual(snapshot["location_source"], "DISPATCH_OVERRIDE")
        self.assertTrue(snapshot["location_overridden"])
        self.assertEqual(snapshot["captured_by_name"], "Dispatch Operator")
        self.assertEqual(order.ship_to_address, "Sales Order Delivery Address")

    def test_structured_customer_location_is_used_when_full_address_is_missing(self):
        customer = _customer(shipping_address="", mailing_state="Maharashtra", mailing_pincode="")
        context = FGDispatchService._sales_order_delivery_context(
            _sales_order(
                customer=customer,
                ship_to_customer=customer,
                ship_to_address="",
                address_override="",
            )
        )

        self.assertFalse(context["address_available"])
        self.assertEqual(context["location"], "Maharashtra, India")
        self.assertEqual(context["location_source"], "SHIP_TO_CUSTOMER_LOCATION")

    def test_missing_master_location_requires_explicit_dispatch_location(self):
        customer = _customer(
            shipping_address="",
            mailing_state="",
            mailing_pincode="",
            mailing_country="India",
        )
        order = _sales_order(
            customer=customer,
            ship_to_customer=customer,
            ship_to_address="",
            address_override="",
        )

        with self.assertRaisesMessage(ValueError, "Delivery location is missing"):
            FGDispatchService._dispatch_delivery_snapshot(order, {}, user=None)
