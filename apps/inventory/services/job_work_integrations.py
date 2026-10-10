"""Job work hooks into the gate, bill and notification foundations.

* QR ``JOBWORK_CHALLAN`` (apps.gate.qr): the watchman scans a printed job-work
  challan; ``resolve`` returns an OutwardLinkSnapshot (no prices) and
  ``on_gate_out`` stamps the challan's gate-out time. Neither moves stock.
* Office outward search for the same kind (apps.gate.outward_registry).
* Bill receipt kind ``JOBWORK_RETURN`` (apps.gate.bill_services) so a job
  worker's bill can be linked to the return it charges for.
* Notification ``jobwork.return_overdue`` (documents.manage) and the daily
  overdue / ITC-04 ageing run used by ``apps.inventory.tasks``.

Registration happens at import time; the views module and the task import
this module.
"""
from __future__ import annotations

import logging
from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.inventory.models import JOBWORK_FINAL_STATUSES, JobWorkChallan, JobWorkOrder, JobWorkReturn
from apps.inventory.services.job_work import ITC04_LIMIT_DAYS, ITC04_WARNING_DAYS, audit, line_balances

logger = logging.getLogger(__name__)

QR_KIND = "JOBWORK_CHALLAN"
RECEIPT_KIND = "JOBWORK_RETURN"
OVERDUE_EVENT = "jobwork.return_overdue"
NEAR_DEPARTURE = timedelta(days=4)
RETURN_BEFORE_BILL_DAYS = 120


def _factory_time(value):
    """Factory (gate) local time for user-facing dates; the server runs in UTC."""
    from apps.gate.services import gate_zone

    return value.astimezone(gate_zone())


def _refuse(message):
    raise ValidationError({"code": message})


def _plant_id(plant):
    return getattr(plant, "id", plant)


def _plant_obj(challan, plant):
    return plant if hasattr(plant, "name") else challan.plant


# ------------------------------------------------------------------- QR
def challan_snapshot(challan: JobWorkChallan, plant=None) -> dict:
    lines = []
    for line in challan.lines.all().order_by("line_no"):
        lines.append({"description": line.description, "quantity": line.quantity, "uom": line.uom})
    rolls = sum(1 for line in challan.lines.all() if line.kind == "ROLL")
    warnings = []
    order = challan.order
    if order.status == "CANCELLED":
        warnings.append("The job-work order is cancelled.")
    if challan.gate_out_at:
        warnings.append(f"This challan already left the gate at {_factory_time(challan.gate_out_at):%d %b %H:%M}.")
    summary = f"{rolls} roll{'' if rolls == 1 else 's'} · {Decimal(challan.total_qty_kg).normalize():f} KG" if rolls else f"{len(lines)} line{'' if len(lines) == 1 else 's'}"
    summary += f" to {challan.vendor.name} for {challan.purpose}"
    try:
        from apps.gate.outward_registry import build_snapshot

        snapshot = build_snapshot(
            kind=QR_KIND, obj_id=challan.id, reference=f"{challan.number} · {order.number}", party_name=challan.vendor.name,
            plant=_plant_obj(challan, plant), status="GATE_OUT" if challan.gate_out_at else "ISSUED",
            document_date=challan.issued_at, lines=lines, summary=summary, warnings=warnings,
        )
    except ImportError:  # outward registry not installed (older gate build)
        snapshot = {
            "kind": QR_KIND, "id": str(challan.id), "reference": f"{challan.number} · {order.number}", "party_name": challan.vendor.name,
            "plant": str(challan.plant_id), "plant_name": challan.plant.name, "status": "GATE_OUT" if challan.gate_out_at else "ISSUED",
            "document_date": _factory_time(challan.issued_at).isoformat(),
            "lines": [{"description": row["description"], "quantity": format(Decimal(row["quantity"]).normalize(), "f"), "uom": row["uom"]} for row in lines],
            "summary": summary, "warnings": warnings,
        }
    return snapshot


def resolve_jobwork_challan(object_id, plant):
    challan = JobWorkChallan.objects.select_related("order", "vendor", "plant").filter(id=object_id).first()
    if challan is None:
        _refuse("This job-work challan is not in the ERP.")
    if plant is not None and str(challan.plant_id) != str(_plant_id(plant)):
        _refuse("This challan belongs to another factory. It cannot be matched at this gate.")
    if challan.order.status == "CANCELLED":
        _refuse(f"Job-work order {challan.order.number} is cancelled. Challan {challan.number} must not leave the gate.")
    return challan_snapshot(challan, plant)


def gate_out_jobwork_challan(object_id, departed_at, user):
    """Stamp the physical exit once. Never moves stock (dispatch already did)."""
    with transaction.atomic():
        challan = JobWorkChallan.objects.select_for_update().select_related("order").filter(id=object_id).first()
        if challan is None or challan.gate_out_at:
            return
        challan.gate_out_at = departed_at or timezone.now()
        challan.gate_out_by = user if getattr(user, "pk", None) else None
        challan.save(update_fields=["gate_out_at", "gate_out_by"])
        audit(challan.order, "JW_GATE_OUT", user, "", {"challan": challan.number, "at": challan.gate_out_at})


def search_jobwork_challans(plant, query, *, around=None, limit=10):
    qs = JobWorkChallan.objects.select_related("order", "vendor", "plant").filter(plant_id=_plant_id(plant)).exclude(order__status="CANCELLED")
    if query:
        qs = qs.filter(Q(number__icontains=query) | Q(order__number__icontains=query) | Q(vendor__name__icontains=query) | Q(vehicle_no__icontains=query))
    elif around is not None:
        qs = qs.filter(issued_at__gte=around - NEAR_DEPARTURE, issued_at__lte=around + NEAR_DEPARTURE)
    return [challan_snapshot(challan, plant) for challan in qs.order_by("-issued_at")[: max(1, min(int(limit or 10), 25))]]


# --------------------------------------------------------------- bills
def return_receipt_snapshot(bill, pk, lock=False):
    from apps.inventory.services.job_work import bill_invoice_number

    qs = JobWorkReturn.objects.select_related("order", "order__vendor", "plant")
    if lock:
        qs = qs.select_for_update(of=("self",))
    ret = qs.filter(id=pk).first()
    if ret is None:
        raise ValidationError("This job-work return is unavailable.")
    vendor = ret.order.vendor
    if vendor is None:
        raise ValidationError("This job-work order has no vendor; it cannot receive a bill.")
    if ret.plant_id != bill.plant_id and getattr(bill, "ship_to_plant_id", None) != ret.plant_id:
        raise ValidationError("The job-work return must belong to this bill's plant.")
    now = timezone.now()
    if ret.received_at > now + timedelta(minutes=5):
        raise ValidationError("A job-work return cannot be dated in the future.")
    if ret.received_at < bill.arrival_at - timedelta(days=RETURN_BEFORE_BILL_DAYS):
        raise ValidationError(f"The return {ret.number} is more than {RETURN_BEFORE_BILL_DAYS} days older than the bill.")
    if ret.billed_qty is not None:
        quantity, uom = ret.billed_qty, ret.billed_uom or "PCS"
    elif ret.output_pcs:
        quantity, uom = Decimal(ret.output_pcs), "PCS"
    else:
        quantity, uom = ret.output_kg or ret.settled_sent_kg, "KG"
    invoice = ret.vendor_document_no or bill_invoice_number(bill)
    return {
        "kind": RECEIPT_KIND,
        "id": str(ret.id),
        "reference": f"{ret.number} · {ret.order.number}",
        "invoice_number": invoice,
        "vendor_id": str(vendor.id),
        "vendor_name": vendor.name,
        "plant": str(ret.plant_id),
        "received_at": ret.received_at.isoformat(),
        "quantity": str(quantity),
        "quantities_by_uom": {uom: str(quantity)},
        "uom": uom,
        "quality_status": "POSTED",
    }


# ----------------------------------------------------- overdue alerts
def run_jobwork_overdue_reminders(*, now=None) -> dict:
    """Daily: orders past their expected return date, and material at a job
    worker for 300+ days (GST ITC-04: inputs must return within one year)."""
    from apps.users.services.bill_notifications import publish_document_event

    now = now or timezone.now()
    today = _factory_time(now).date()
    stats = {"orders_checked": 0, "overdue": 0, "itc04": 0, "notified": 0}
    orders = JobWorkOrder.objects.exclude(status__in=JOBWORK_FINAL_STATUSES).exclude(status="DRAFT").select_related("plant", "vendor")
    for order in orders.iterator():
        stats["orders_checked"] += 1
        balances = line_balances(order)
        open_rows = [row for row in balances.values() if row["is_open"]]
        if not open_rows:
            continue
        open_kg = sum((row["open_kg"] for row in open_rows), Decimal("0"))
        link = f"/inventory/job-work/{order.id}"
        with transaction.atomic():
            if order.expected_return_date and order.expected_return_date < today:
                stats["overdue"] += 1
                days = (today - order.expected_return_date).days
                stats["notified"] += publish_document_event(
                    event_key=OVERDUE_EVENT, plant=order.plant, object_id=str(order.id), object_type="JobWorkOrder",
                    title=f"Job work {order.number} is {days} day{'' if days == 1 else 's'} overdue",
                    message=f"{order.vendor_name} still holds {open_kg.normalize():f} kg in {len(open_rows)} line(s). Expected back by {order.expected_return_date:%d %b %Y}.",
                    deep_link=link, priority="HIGH" if days > 7 else "NORMAL", dedupe_suffix=f"due:{order.expected_return_date.isoformat()}",
                )
            oldest = min(row["line"].sent_at for row in open_rows)
            age = (now - oldest).days
            if age >= ITC04_WARNING_DAYS:
                stats["itc04"] += 1
                limit_note = "past the one-year GST limit" if age >= ITC04_LIMIT_DAYS else f"{ITC04_LIMIT_DAYS - age} days before the one-year GST limit"
                stats["notified"] += publish_document_event(
                    event_key=OVERDUE_EVENT, plant=order.plant, object_id=str(order.id), object_type="JobWorkOrder",
                    title=f"Job work {order.number}: material {age} days at {order.vendor_name}",
                    message=f"Material sent on {_factory_time(oldest):%d %b %Y} is still at the job worker ({limit_note}). Bring it back or record it for ITC-04.",
                    deep_link=link, priority="HIGH", dedupe_suffix=f"itc04:{'limit' if age >= ITC04_LIMIT_DAYS else 'warn'}",
                )
    return stats


def register() -> None:
    from apps.gate.bill_services import register_receipt_kind
    from apps.gate.qr import register_qr_kind
    from apps.users.services.bill_notifications import register_document_event

    register_qr_kind(QR_KIND, resolve_jobwork_challan, gate_out_jobwork_challan)
    register_receipt_kind(RECEIPT_KIND, return_receipt_snapshot)
    register_document_event(OVERDUE_EVENT, "documents.manage")
    try:
        from apps.gate.outward_registry import register_outward_search
    except ImportError:
        logger.info("Outward registry not available; job-work challans resolve by QR only.")
    else:
        register_outward_search(QR_KIND, search_jobwork_challans)


register()
