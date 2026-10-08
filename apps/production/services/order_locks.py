"""Common lock order for sales planning, snapshot revision and job release."""

from apps.sales.models import SalesOrder, SalesOrderItem


def lock_sales_order_items(item_ids):
    """Return fresh items, locking their orders before items inside an atomic block.

    A revision can affect multiple lines/orders. Lock the whole parent set in
    primary-key order first so two revisions cannot lock opposite orders. Only
    lock the requested tables, never nullable joins or template/master rows.
    """
    item_ids = list(item_ids)
    order_ids = SalesOrderItem.objects.filter(id__in=item_ids).values_list("sales_order_id", flat=True)
    orders = {
        order.id: order
        for order in SalesOrder.objects.select_for_update(of=("self",))
        .filter(id__in=order_ids).order_by("id")
    }
    items = list(
        SalesOrderItem.objects.select_for_update(of=("self",))
        .select_related("template", "product_master", "product_variant", "customer_product_overlay")
        .filter(id__in=item_ids).order_by("sales_order_id", "id")
    )
    for item in items:
        item.sales_order = orders[item.sales_order_id]
    return items


def lock_sales_order_item(item_id):
    items = lock_sales_order_items([item_id])
    if not items:
        raise SalesOrderItem.DoesNotExist("The requested sales line no longer exists.")
    return items[0]
