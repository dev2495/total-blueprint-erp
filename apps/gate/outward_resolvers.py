"""QR resolvers and office search for ERP sales / inter-plant documents.

Read-only: resolving or matching an outward photo never posts stock, never
marks delivery and never changes the source record. These ERP records have no
gate-out column of their own, so the departure link (OutwardDocumentLink) *is*
their gate-out record; ``on_gate_out`` is therefore not registered for them.
Gate passes register their own resolver in gate_pass_services.
"""
from decimal import Decimal

from django.db.models import Q
from rest_framework.exceptions import ValidationError

from apps.inventory.models import DeliveryChallan as InterPlantChallan
from apps.production.models import DeliveryChallan as SalesChallan
from apps.sales.models import CustomerDispatch, TradeOrder

from .outward_registry import NEAR_DEPARTURE, build_snapshot, register_outward_search
from .qr import register_qr_kind

OTHER_FACTORY = "This document belongs to another factory. It cannot be matched at this gate."


def _refuse(message):
    raise ValidationError({"code": message})


def _near(qs, around, *fields):
    if around is None:
        return qs
    start, end = around - NEAR_DEPARTURE, around + NEAR_DEPARTURE
    predicate = Q()
    for field in fields:
        predicate |= Q(**{f"{field}__gte": start, f"{field}__lte": end})
    return qs.filter(predicate)


# ---------------------------------------------------------------- sales DC
def _sales_dc_snapshot(challan, plant):
    groups = {}
    for item in challan.items.all():
        product = getattr(getattr(item, "sales_order_item", None), "product_master", None)
        if product is not None:
            name = product.name or product.code
        elif item.roll_id:
            name = "Roll"
        elif item.packing_unit_id:
            name = "Packed bag"
        else:
            name = "Dispatch unit"
        row = groups.setdefault(name, {"units": 0, "kg": Decimal("0"), "pcs": 0})
        row["units"] += 1
        row["kg"] += Decimal(str(item.weight_kg or 0))
        row["pcs"] += int(item.qty_pcs or 0)
    lines = []
    units = 0
    for name, row in groups.items():
        units += row["units"]
        label = f"{name} · {row['units']} unit{'' if row['units'] == 1 else 's'}"
        if row["pcs"]:
            label += f" · {row['pcs']:,} pcs"
        lines.append({"description": label, "quantity": row["kg"], "uom": "KG"})
    warnings = []
    if challan.status == "DRAFT":
        warnings.append("The ERP challan is still a draft: dispatch has not been posted in the ERP.")
    if challan.status in {"DELIVERED", "RETURNED"}:
        warnings.append(f"The ERP challan is already marked {challan.get_status_display().lower()}.")
    snapshot = build_snapshot(
        kind="SALES_DC", obj_id=challan.id, reference=challan.dc_no, party_name=challan.customer_name,
        plant=challan.plant, status=challan.status, document_date=challan.dispatch_date or challan.created_at,
        lines=lines, warnings=warnings,
    )
    total = sum((row["kg"] for row in groups.values()), Decimal("0"))
    snapshot["summary"] = f"{units} unit{'' if units == 1 else 's'}" + (f" · {total.normalize():f} KG" if total else "")
    return snapshot


def _sales_dc_queryset():
    return SalesChallan.objects.select_related("plant").prefetch_related("items__sales_order_item__product_master").exclude(status="CANCELLED")


def resolve_sales_dc(object_id, plant):
    challan = SalesChallan.objects.select_related("plant").prefetch_related("items__sales_order_item__product_master").filter(id=object_id).first()
    if not challan:
        _refuse("This delivery challan is not in the ERP.")
    if challan.plant_id != plant.id:
        _refuse(OTHER_FACTORY)
    if challan.status == "CANCELLED":
        _refuse(f"Delivery challan {challan.dc_no} is cancelled. It must not leave the gate.")
    return _sales_dc_snapshot(challan, plant)


def search_sales_dc(plant, query, *, around=None, limit=10):
    qs = _sales_dc_queryset().filter(plant=plant)
    if query:
        qs = qs.filter(Q(dc_no__icontains=query) | Q(customer_name__icontains=query) | Q(vehicle_no__icontains=query) | Q(sales_order__order_number__icontains=query))
    else:
        qs = _near(qs, around, "dispatch_date", "created_at")
    return [_sales_dc_snapshot(obj, plant) for obj in qs.order_by("-created_at")[:limit]]


# --------------------------------------------------------- customer dispatch
def _dispatch_snapshot(dispatch, plant):
    lines = []
    for line in dispatch.lines.all():
        product = getattr(line.sales_order_item, "product_master", None)
        lines.append({"description": (product.name if product else "") or "Sales order line", "quantity": line.qty_dispatched, "uom": line.uom})
    warnings = []
    if dispatch.status == "DRAFT":
        warnings.append("The ERP dispatch is still a draft: it has not been confirmed in the ERP.")
    customer = dispatch.customer or getattr(dispatch.sales_order, "customer", None)
    reference = dispatch.code + (f" · Inv {dispatch.invoice_no}" if dispatch.invoice_no else "")
    return build_snapshot(
        kind="CUSTOMER_DISPATCH", obj_id=dispatch.id, reference=reference,
        party_name=customer.name if customer else getattr(dispatch.sales_order, "customer_name", ""),
        plant=dispatch.plant, status=dispatch.status, document_date=dispatch.dispatched_at or dispatch.dispatch_date,
        lines=lines, warnings=warnings,
    )


def _dispatch_queryset():
    return CustomerDispatch.objects.select_related("plant", "customer", "sales_order").prefetch_related("lines__sales_order_item__product_master").exclude(status="CANCELLED")


def resolve_customer_dispatch(object_id, plant):
    dispatch = CustomerDispatch.objects.select_related("plant", "customer", "sales_order").prefetch_related("lines__sales_order_item__product_master").filter(id=object_id).first()
    if not dispatch:
        _refuse("This customer dispatch is not in the ERP.")
    if dispatch.plant_id is None:
        _refuse(f"Customer dispatch {dispatch.code} has no factory recorded. Ask the sales team to set its factory.")
    if dispatch.plant_id != plant.id:
        _refuse(OTHER_FACTORY)
    if dispatch.status == "CANCELLED":
        _refuse(f"Customer dispatch {dispatch.code} is cancelled. It must not leave the gate.")
    return _dispatch_snapshot(dispatch, plant)


def search_customer_dispatch(plant, query, *, around=None, limit=10):
    qs = _dispatch_queryset().filter(plant=plant)
    if query:
        qs = qs.filter(Q(code__icontains=query) | Q(invoice_no__icontains=query) | Q(customer__name__icontains=query) | Q(vehicle_no__icontains=query) | Q(sales_order__order_number__icontains=query))
    else:
        qs = _near(qs, around, "dispatched_at", "created_at")
    return [_dispatch_snapshot(obj, plant) for obj in qs.order_by("-created_at")[:limit]]


# ---------------------------------------------------------------- trade order
def _trade_snapshot(order, plant):
    lines = [{"description": item.display_name, "quantity": item.qty, "uom": item.uom} for item in order.items.all()]
    warnings = []
    if order.status == "DRAFT":
        warnings.append("The trade order is still a draft: dispatch has not been posted in the ERP.")
    reference = order.code + (f" · Inv {order.invoice_no}" if order.invoice_no else "")
    return build_snapshot(
        kind="TRADE_ORDER", obj_id=order.id, reference=reference, party_name=order.customer.name if order.customer_id else "",
        plant=order.plant, status=order.status, document_date=order.dispatched_at or order.order_date,
        lines=lines, warnings=warnings,
    )


def _trade_queryset():
    return TradeOrder.objects.select_related("plant", "customer").prefetch_related("items__trading_good", "items__inventory_material").exclude(status="CANCELLED")


def resolve_trade_order(object_id, plant):
    order = TradeOrder.objects.select_related("plant", "customer").prefetch_related("items__trading_good", "items__inventory_material").filter(id=object_id).first()
    if not order:
        _refuse("This trade order is not in the ERP.")
    if order.plant_id is None:
        _refuse(f"Trade order {order.code} has no factory recorded. Ask the sales team to set its factory.")
    if order.plant_id != plant.id:
        _refuse(OTHER_FACTORY)
    if order.status == "CANCELLED":
        _refuse(f"Trade order {order.code} is cancelled. It must not leave the gate.")
    return _trade_snapshot(order, plant)


def search_trade_order(plant, query, *, around=None, limit=10):
    qs = _trade_queryset().filter(plant=plant)
    if query:
        qs = qs.filter(Q(code__icontains=query) | Q(invoice_no__icontains=query) | Q(customer__name__icontains=query))
    else:
        qs = _near(qs, around, "dispatched_at", "created_at")
    return [_trade_snapshot(obj, plant) for obj in qs.order_by("-created_at")[:limit]]


# ------------------------------------------------------- inter-plant challan
def _interplant_snapshot(challan, plant):
    lines = []
    for item in challan.items.all():
        if item.line_type == "ROLL" and item.roll_id:
            label = f"Roll {item.roll.label_id}"
        elif item.material_id:
            label = item.material.name or item.material.code
        else:
            label = item.get_line_type_display()
        quantity = item.dispatched_qty_kg if item.dispatched_qty_kg else item.planned_qty_kg
        lines.append({"description": label, "quantity": quantity, "uom": "KG"})
    warnings = []
    if challan.status == "DRAFT":
        warnings.append("The inter-plant challan is still a draft: it has not been approved for dispatch.")
    if challan.status == "RECEIVED":
        warnings.append("The inter-plant challan is already marked received at the destination factory.")
    return build_snapshot(
        kind="INTERPLANT_DC", obj_id=challan.id, reference=challan.dc_no or f"IP-{str(challan.id)[:8].upper()}",
        party_name=f"To {challan.to_plant.name}" if challan.to_plant_id else "", plant=challan.from_plant,
        status=challan.status, document_date=challan.dispatched_at or challan.created_at, lines=lines, warnings=warnings,
    )


def _interplant_queryset():
    return InterPlantChallan.objects.select_related("from_plant", "to_plant").prefetch_related("items__roll", "items__material")


def resolve_interplant_dc(object_id, plant):
    challan = _interplant_queryset().filter(id=object_id).first()
    if not challan:
        _refuse("This inter-plant challan is not in the ERP.")
    if challan.from_plant_id != plant.id:
        _refuse(OTHER_FACTORY)
    return _interplant_snapshot(challan, plant)


def search_interplant_dc(plant, query, *, around=None, limit=10):
    qs = _interplant_queryset().filter(from_plant=plant)
    if query:
        qs = qs.filter(Q(dc_no__icontains=query) | Q(to_plant__name__icontains=query) | Q(vehicle_no__icontains=query))
    else:
        qs = _near(qs, around, "dispatched_at", "created_at")
    return [_interplant_snapshot(obj, plant) for obj in qs.order_by("-created_at")[:limit]]


register_qr_kind("SALES_DC", resolve_sales_dc)
register_qr_kind("CUSTOMER_DISPATCH", resolve_customer_dispatch)
register_qr_kind("TRADE_ORDER", resolve_trade_order)
register_qr_kind("INTERPLANT_DC", resolve_interplant_dc)
register_outward_search("SALES_DC", search_sales_dc)
register_outward_search("CUSTOMER_DISPATCH", search_customer_dispatch)
register_outward_search("TRADE_ORDER", search_trade_order)
register_outward_search("INTERPLANT_DC", search_interplant_dc)
