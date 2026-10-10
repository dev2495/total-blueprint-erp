"""Late and monthly job-work bills.

A job worker's bill often arrives after the material came back — sometimes
after the order closed, and a monthly bill may charge several returns of
several orders of the same job worker. This module links such a bill to
returns received earlier without one.

Returns are append-only, so each link is a ``JobWorkBillLink`` row plus the
bill reference written by ``attach_receipt_to_bill`` (bill locked, vendor and
invoice consistency, one bill per return, PARTIAL_GRN / RECEIPTED, audit), all
in one transaction and idempotent per client token. Quantity, rate and amount
differences are saved as warnings; they never block the link.
"""
from __future__ import annotations

import uuid
from datetime import timedelta
from decimal import Decimal
from typing import Dict, Iterable, List, Optional, Set

from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from apps.inventory.models import JobWorkBillLink, JobWorkOrder, JobWorkReturn, Vendor
from apps.inventory.services.job_work import (
    RATE4,
    STATUS_LABELS,
    ZERO,
    Conflict,
    audit,
    bill_invoice_number,
    canonical_payload,
    kg3,
    money,
    order_process,
    replay_or_run,
    require_jobwork_permission,
    vendor_rate,
)
from apps.users.permission_service import PermissionService

RECEIPT_KIND = "JOBWORK_RETURN"
OPEN_BILL_STATUSES = {"PENDING_GRN", "PARTIAL_GRN"}
MAX_LINK_RETURNS = 60
LIST_LIMIT = 200


def _num(value) -> Optional[str]:
    if value is None:
        return None
    text = format(Decimal(str(value)).normalize(), "f")
    return "0" if text in {"-0", ""} else text


def require_bill_rights(user) -> None:
    if not PermissionService.has_inventory_bill_review(user):
        raise PermissionDenied("Linking a bill needs bill-receiving rights (Inventory store or an administrator).")


def bill_vendor_ids(bill) -> Set[str]:
    return {str(value) for value in [getattr(bill, "vendor_id", None), (bill.review_data or {}).get("vendor_id")] if value}


def bill_plant_ids(bill) -> Set[str]:
    return {str(value) for value in [bill.plant_id, getattr(bill, "ship_to_plant_id", None)] if value}


def billed_elsewhere_ids(return_ids: Iterable) -> Dict[str, str]:
    """return id → bill id for returns already billed by any path."""
    from apps.gate.models import InwardBillReceiptReference

    ids = [str(value) for value in return_ids]
    found: Dict[str, str] = {}
    for ret_id, bill_id in JobWorkReturn.objects.filter(id__in=ids, bill__isnull=False).values_list("id", "bill_id"):
        found[str(ret_id)] = str(bill_id)
    for ret_id, bill_id in JobWorkBillLink.objects.filter(job_work_return_id__in=ids).values_list("job_work_return_id", "bill_id"):
        found.setdefault(str(ret_id), str(bill_id))
    for object_id, bill_id in InwardBillReceiptReference.objects.filter(kind=RECEIPT_KIND, object_id__in=ids).values_list("object_id", "intake_id"):
        found.setdefault(str(object_id), str(bill_id))
    return found


def unbilled_queryset():
    from apps.gate.models import InwardBillReceiptReference

    referenced = InwardBillReceiptReference.objects.filter(kind=RECEIPT_KIND).values("object_id")
    return (
        JobWorkReturn.objects.select_related("order", "order__vendor", "order__process", "order__production_job", "order__production_job__current_process", "plant")
        .filter(bill__isnull=True, late_bill_link__isnull=True)
        .exclude(id__in=referenced)
        .exclude(order__status="CANCELLED")
    )


def received_in(ret: JobWorkReturn, uom: str) -> Optional[Decimal]:
    if uom == "PCS":
        return Decimal(int(ret.output_pcs or 0))
    if uom == "KG":
        return Decimal(str(ret.output_kg or 0))
    return None


def return_row(ret: JobWorkReturn, bill=None) -> dict:
    from apps.inventory.services.job_work_integrations import RETURN_BEFORE_BILL_DAYS

    order = ret.order
    process = order_process(order)
    blocked = None
    if bill is not None and ret.received_at < bill.arrival_at - timedelta(days=RETURN_BEFORE_BILL_DAYS):
        blocked = f"Received more than {RETURN_BEFORE_BILL_DAYS} days before this bill arrived."
    job = order.production_job
    return {
        "id": str(ret.id),
        "number": ret.number,
        "received_at": timezone.localtime(ret.received_at).isoformat(),
        "vendor_document_no": ret.vendor_document_no,
        "plant": str(ret.plant_id),
        "plant_name": ret.plant.name,
        "order_id": str(order.id),
        "order_number": order.number,
        "order_status": "PARTLY_RETURNED" if order.status == "PARTIAL" else order.status,
        "order_status_label": STATUS_LABELS.get(order.status, order.status),
        "vendor": str(order.vendor_id) if order.vendor_id else None,
        "vendor_name": order.vendor.name if order.vendor_id else order.vendor_name,
        "process_name": getattr(process, "name", None),
        "production_job_number": getattr(job, "job_number", None),
        "expected_output_kind": order.expected_output_kind,
        "output_pcs": int(ret.output_pcs or 0),
        "output_kg": _num(ret.output_kg),
        "settled_sent_kg": _num(ret.settled_sent_kg),
        "order_rate": _num(order.rate),
        "order_rate_uom": order.rate_uom,
        "vendor_rate": vendor_rate(order.vendor, getattr(process, "code", ""), order.rate_uom) if (process is not None and order.vendor_id) else None,
        "blocked_reason": blocked,
    }


# -------------------------------------------------------------------- read
def unbilled_returns(*, user, params) -> dict:
    """Returns of one job worker that have no bill yet (any order status)."""
    require_jobwork_permission(user, "inventory.view")
    bill = None
    bill_param = str(params.get("bill") or "").strip()
    if bill_param:
        require_bill_rights(user)
        from apps.gate.bill_services import get_bill

        if not _is_uuid(bill_param):
            raise NotFound("This inward bill is unavailable.")
        bill = get_bill(user, bill_param)  # plant scope: 404 for bills this account cannot see
    vendor_id = str(params.get("vendor") or "").strip()
    if not vendor_id and bill is not None:
        vendors = bill_vendor_ids(bill)
        vendor_id = next(iter(vendors)) if len(vendors) == 1 else ""
    if not vendor_id:
        raise ValidationError({"vendor": "Choose the job worker (or classify the bill's vendor first)."})
    vendor = Vendor.objects.filter(id=vendor_id).first() if _is_uuid(vendor_id) else None
    if vendor is None:
        raise ValidationError({"vendor": "This vendor does not exist."})
    if bill is not None and bill_vendor_ids(bill) and str(vendor.id) not in bill_vendor_ids(bill):
        raise ValidationError({"vendor": "This bill is from another vendor."})
    qs = unbilled_queryset().filter(order__vendor=vendor)
    if bill is not None:
        qs = qs.filter(plant_id__in=bill_plant_ids(bill))
    elif params.get("plant"):
        qs = qs.filter(plant_id=params.get("plant"))
    rows = [return_row(ret, bill) for ret in qs.order_by("-received_at", "-id")[:LIST_LIMIT]]
    return {
        "results": rows,
        "count": len(rows),
        "vendor": {"id": str(vendor.id), "name": vendor.name},
        "bill": {
            "id": str(bill.id), "status": bill.status, "open": bill.status in OPEN_BILL_STATUSES,
            "invoice_number": bill_invoice_number(bill), "taxable_amount": _num(getattr(bill, "taxable_amount", None)),
            "category": getattr(bill, "category", "") or "",
        } if bill is not None else None,
    }


def _is_uuid(value) -> bool:
    try:
        uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        return False
    return True


# ---------------------------------------------------------------- warnings
def link_warnings(bill, returns: List[JobWorkReturn], billed: dict, uom: str) -> List[dict]:
    """Bill-level checks across every selected return (warnings only)."""
    warnings: List[dict] = []
    qty, rate, amount = billed["billed_qty"], billed["billed_rate"], billed["billed_amount"]
    count = len(returns)
    noun = f"the {count} selected return{'s' if count != 1 else ''}"
    if qty is not None:
        if uom == "PCS":
            received = sum((Decimal(int(ret.output_pcs or 0)) for ret in returns), ZERO)
            if qty != received:
                warnings.append({"code": "BILLED_QTY", "message": f"The bill charges {qty.normalize():f} pcs but {noun} received {received.normalize():f} pcs."})
        elif uom == "KG":
            received = sum((Decimal(str(ret.output_kg or 0)) for ret in returns), ZERO)
            if abs(qty - received) > Decimal("0.5"):
                warnings.append({"code": "BILLED_QTY", "message": f"The bill charges {qty.normalize():f} kg but {noun} received {kg3(received)} kg of output."})
    if rate is not None:
        seen_orders, seen_cards = set(), set()
        agreed: Dict[tuple, List[str]] = {}
        for ret in returns:
            order = ret.order
            if order.id in seen_orders:
                continue
            seen_orders.add(order.id)
            if order.rate is not None and (not uom or not order.rate_uom or uom == order.rate_uom) and rate != Decimal(str(order.rate)).quantize(RATE4):
                agreed.setdefault((Decimal(str(order.rate)).normalize(), order.rate_uom or uom), []).append(order.number)
            process = order_process(order)
            card = vendor_rate(order.vendor, getattr(process, "code", ""), uom) if (process is not None and order.vendor_id) else None
            if card and (card["process_code"], card["uom"]) not in seen_cards:
                seen_cards.add((card["process_code"], card["uom"]))
                if Decimal(card["rate"]).quantize(RATE4) != rate:
                    warnings.append({"code": "RATE_CARD", "message": f"Billed rate ₹{rate.normalize():f} differs from {order.vendor.name}'s rate card ₹{Decimal(card['rate']).normalize():f} per {card['uom']} ({card['process_code']})."})
        for (agreed_rate, agreed_uom), numbers in agreed.items():
            warnings.append({"code": "RATE_ORDER", "message": f"Billed rate ₹{rate.normalize():f} differs from the ₹{agreed_rate:f} per {agreed_uom} agreed on {', '.join(numbers)}."})
    if qty is not None and rate is not None and amount is not None and abs(money(qty * rate) - amount) > Decimal("1.00"):
        warnings.append({"code": "AMOUNT", "message": f"Billed amount ₹{amount} is not {qty.normalize():f} × ₹{rate.normalize():f} = ₹{money(qty * rate)}."})
    taxable = getattr(bill, "taxable_amount", None)
    if amount is not None and taxable is not None and abs(Decimal(str(taxable)) - amount) > Decimal("1.00"):
        warnings.append({"code": "BILL_TAXABLE", "message": f"The bill's taxable value ₹{taxable} differs from the job-work amount ₹{amount}."})
    return warnings


# ------------------------------------------------------------------- write
def link_bill(*, user, data: dict) -> dict:
    """Link an open job-work bill to returns received earlier without one."""
    require_jobwork_permission(user, "inventory.manage")
    require_bill_rights(user)
    from apps.gate.bill_services import get_bill
    from apps.gate.models import InwardBillIntake

    visible = get_bill(user, data["bill_id"])  # plant scope: 404 for bills this account cannot see
    data = {**data, "return_ids": sorted(str(value) for value in data["return_ids"])}
    holder = {}

    def lock():
        # Same lock order as a return that links a bill: order rows (sorted)
        # first, then the bill.
        order_ids = sorted({str(value) for value in JobWorkReturn.objects.filter(id__in=data["return_ids"]).values_list("order_id", flat=True)})
        holder["orders"] = {
            str(order.id): order
            for order in JobWorkOrder.objects.select_for_update(of=("self",)).select_related(
                "vendor", "process", "production_job", "production_job__current_process", "production_job__process",
            ).filter(id__in=order_ids).order_by("id")
        }
        holder["bill"] = InwardBillIntake.objects.select_for_update(of=("self",)).select_related("plant").get(id=visible.id)

    return replay_or_run(
        scope=f"jobwork:link-bill:{visible.id}", token=data.get("client_token"), payload=canonical_payload(data),
        operation=lambda: _link_locked(user, holder["bill"], holder["orders"], data), lock=lock,
    )


def _link_locked(user, bill, orders: Dict[str, JobWorkOrder], data: dict) -> dict:
    from apps.gate.bill_services import attach_receipt_to_bill

    if bill.status not in OPEN_BILL_STATUSES:
        raise Conflict("This bill is already closed. Open it from Bills & documents to see what it is linked to.")
    category = str(getattr(bill, "category", "") or "")
    if category and category != "JOBWORK":
        raise ValidationError({"bill_id": "This document is not classified as a job-work bill. Change its category in Bills & documents first."})
    return_ids = data["return_ids"]
    if not return_ids:
        raise ValidationError({"return_ids": "Pick at least one return the bill charges for."})
    if len(return_ids) != len(set(return_ids)):
        raise ValidationError({"return_ids": "Pick each return once."})
    if len(return_ids) > MAX_LINK_RETURNS:
        raise ValidationError({"return_ids": f"Link at most {MAX_LINK_RETURNS} returns at a time."})
    returns = list(JobWorkReturn.objects.select_for_update(of=("self",)).select_related("plant").filter(id__in=return_ids).order_by("received_at", "number"))
    if len(returns) != len(return_ids):
        raise ValidationError({"return_ids": f"{len(return_ids) - len(returns)} selected return(s) no longer exist. Refresh the list."})
    for ret in returns:
        ret.order = orders[str(ret.order_id)]

    already = billed_elsewhere_ids(return_ids)
    if already:
        numbers = ", ".join(ret.number for ret in returns if str(ret.id) in already)
        raise Conflict(f"Already billed: {numbers}. Refresh the list.")
    vendor_ids, plant_ids = bill_vendor_ids(bill), bill_plant_ids(bill)
    errors, vendors = [], set()
    for ret in returns:
        order = ret.order
        if not order.vendor_id:
            errors.append(f"{ret.number}: order {order.number} has no job worker.")
            continue
        vendors.add(str(order.vendor_id))
        if vendor_ids and str(order.vendor_id) not in vendor_ids:
            errors.append(f"{ret.number} is from {order.vendor.name}; this bill is from another vendor.")
        if str(ret.plant_id) not in plant_ids:
            errors.append(f"{ret.number} was received at {ret.plant.name}; this bill belongs to {bill.plant.name}.")
        if order.status == "CANCELLED":
            errors.append(f"{ret.number}: order {order.number} is cancelled.")
    if len(vendors) > 1:
        errors.append("One bill covers one job worker. Pick returns of the same job worker.")
    if errors:
        raise ValidationError({"return_ids": errors})

    billed = {
        "billed_qty": kg3(data["billed_qty"]) if data.get("billed_qty") not in (None, "") else None,
        "billed_uom": str(data.get("billed_uom") or "").upper(),
        "billed_rate": Decimal(str(data["billed_rate"])).quantize(RATE4) if data.get("billed_rate") not in (None, "") else None,
        "billed_amount": money(data["billed_amount"]) if data.get("billed_amount") not in (None, "") else None,
    }
    uom = billed["billed_uom"] or ("PCS" if any(ret.output_pcs for ret in returns) else "KG")
    if billed["billed_qty"] is not None and not billed["billed_uom"]:
        billed["billed_uom"] = uom
    warnings = link_warnings(bill, returns, billed, uom)

    received = {str(ret.id): received_in(ret, uom) for ret in returns}
    total = sum((value for value in received.values() if value is not None), ZERO)
    allocation: Dict[str, Optional[Decimal]] = {str(ret.id): None for ret in returns}
    if billed["billed_amount"] is not None:
        if total > 0:
            given = ZERO
            for index, ret in enumerate(returns):
                if index == len(returns) - 1:
                    allocation[str(ret.id)] = billed["billed_amount"] - given
                else:
                    share = money(billed["billed_amount"] * (received[str(ret.id)] or ZERO) / total)
                    allocation[str(ret.id)] = share
                    given += share
        elif len(returns) == 1:
            allocation[str(returns[0].id)] = billed["billed_amount"]

    complete = bool(data.get("complete"))
    request_key = str(data.get("client_token"))
    invoice = bill_invoice_number(bill)
    bill_result = None
    links, by_order = [], {}
    now = timezone.now()
    for index, ret in enumerate(returns):
        last = index == len(returns) - 1
        bill_result = attach_receipt_to_bill(
            user, bill.id, RECEIPT_KIND, ret.id, complete=complete and last,
            reason=(f"Job-work bill linked to {len(returns)} return(s) received earlier." if last else f"Job-work return {ret.number} ({ret.order.number}) billed later."),
        )
        link = JobWorkBillLink.objects.create(
            bill=bill, job_work_return=ret, order=ret.order, plant_id=ret.plant_id, vendor_id=ret.order.vendor_id,
            received_qty=kg3(received[str(ret.id)]) if received[str(ret.id)] is not None else None,
            allocated_amount=allocation[str(ret.id)], return_count=len(returns), bill_complete=complete,
            warnings=warnings, request_key=request_key[:64], linked_by=user, linked_at=now, **billed,
        )
        links.append({
            "return_id": str(ret.id), "return_number": ret.number, "order_id": str(ret.order_id), "order_number": ret.order.number,
            "received_qty": _num(link.received_qty), "allocated_amount": _num(link.allocated_amount),
        })
        by_order.setdefault(str(ret.order_id), {"order": ret.order, "returns": [], "amount": ZERO})
        by_order[str(ret.order_id)]["returns"].append(ret.number)
        if link.allocated_amount is not None:
            by_order[str(ret.order_id)]["amount"] += link.allocated_amount
    for row in by_order.values():
        audit(row["order"], "JW_BILL_LINKED", user, "", {
            "bill": str(bill.id), "invoice": invoice, "returns": row["returns"], "amount": row["amount"],
            "bill_returns": len(returns), "complete": complete, "warnings": [warning["code"] for warning in warnings],
        })
    return {
        "bill": bill_result,
        "links": links,
        "warnings": warnings,
        "return_count": len(returns),
        "billed_uom": billed["billed_uom"] or uom,
    }


def bill_link_payload(link: Optional[JobWorkBillLink]) -> Optional[dict]:
    if link is None:
        return None
    user = link.linked_by
    name = (f"{getattr(user, 'first_name', '')} {getattr(user, 'last_name', '')}".strip() or user.username) if user else None
    return {
        "bill_id": str(link.bill_id),
        "linked_at": timezone.localtime(link.linked_at).isoformat(),
        "linked_by_name": name,
        "billed_qty": _num(link.billed_qty),
        "billed_uom": link.billed_uom,
        "billed_rate": _num(link.billed_rate),
        "billed_amount": _num(link.billed_amount),
        "received_qty": _num(link.received_qty),
        "allocated_amount": _num(link.allocated_amount),
        "return_count": link.return_count,
        "bill_complete": link.bill_complete,
        "warnings": link.warnings or [],
    }

