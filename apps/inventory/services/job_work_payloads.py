"""Read models for the job-work API (list rows, order detail, timeline)."""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Dict, List, Optional

from django.db.models import Count, DecimalField, ExpressionWrapper, F, OuterRef, Q, Subquery, Sum, Value
from django.db.models.functions import Coalesce
from django.utils import timezone

from apps.inventory.models import (
    JOBWORK_FINAL_STATUSES,
    JobWorkChallan,
    JobWorkOrder,
    JobWorkReturn,
    JobWorkSentLine,
    JobWorkSettlement,
)
from apps.inventory.services.job_work import (
    ITC04_LIMIT_DAYS,
    ITC04_WARNING_DAYS,
    OUTPUT_LABELS,
    STATUS_LABELS,
    has_jobwork_permission,
    is_legacy_capable,
    legacy_stuck_rolls,
    line_balances,
    order_process,
    order_totals,
    unit_weight_g,
    vendor_rate,
)
from apps.users.permission_service import PermissionService

ACTION_LABELS = {
    "JW_CREATED": "Order created",
    "JW_DISPATCHED": "Material sent",
    "JW_GATE_OUT": "Left the gate",
    "JW_RETURNED": "Material received back",
    "JW_CLOSED": "Order closed",
    "JW_SHORT_CLOSED": "Order closed short",
    "JW_CANCELLED": "Draft cancelled",
    "JW_RECONCILED": "Legacy rolls reconciled",
}
OPEN_FOR_LIST = ("DRAFT", "SENT", "PARTIAL", "PARTLY_RETURNED", "RETURNED")
DEC0 = Value(Decimal("0"), output_field=DecimalField(max_digits=14, decimal_places=3))


def num(value) -> Optional[str]:
    if value is None:
        return None
    text = format(Decimal(str(value)).normalize(), "f")
    return "0" if text in {"-0", ""} else text


def iso(value) -> Optional[str]:
    if value is None:
        return None
    if hasattr(value, "tzinfo") and value.tzinfo is not None:
        return timezone.localtime(value).isoformat()
    return value.isoformat()


def today() -> date:
    return timezone.localdate()


def annotate_balances(queryset):
    """Per order: sent kg, settled kg, open sent lines count and oldest open sent date."""
    sent = JobWorkSentLine.objects.filter(order=OuterRef("pk")).values("order").annotate(total=Sum("qty_kg")).values("total")
    settled = JobWorkSettlement.objects.filter(order=OuterRef("pk")).values("order").annotate(
        total=Sum(F("consumed_kg") + F("returned_kg"))
    ).values("total")
    line_settled = JobWorkSettlement.objects.filter(sent_line=OuterRef("pk")).values("sent_line").annotate(
        total=Sum(F("consumed_qty") + F("returned_qty"))
    ).values("total")
    open_lines = JobWorkSentLine.objects.filter(order=OuterRef("pk")).annotate(
        settled=Coalesce(Subquery(line_settled, output_field=DecimalField(max_digits=14, decimal_places=3)), DEC0)
    ).filter(quantity__gt=F("settled"))
    oldest = open_lines.order_by("sent_at").values("sent_at")[:1]
    open_count = open_lines.values("order").annotate(c=Count("id")).values("c")
    return queryset.annotate(
        sent_kg_total=Coalesce(Subquery(sent, output_field=DecimalField(max_digits=14, decimal_places=3)), DEC0),
        settled_kg_total=Coalesce(Subquery(settled, output_field=DecimalField(max_digits=14, decimal_places=3)), DEC0),
        oldest_open_sent_at=Subquery(oldest),
        open_line_count=Coalesce(Subquery(open_count), Value(0)),
    ).annotate(
        at_vendor_kg_total=ExpressionWrapper(F("sent_kg_total") - F("settled_kg_total"), output_field=DecimalField(max_digits=14, decimal_places=3)),
    )


def is_overdue(order, *, open_lines: int, oldest_open) -> bool:
    if order.status in JOBWORK_FINAL_STATUSES or open_lines <= 0:
        return False
    if order.expected_return_date and order.expected_return_date < today():
        return True
    return bool(oldest_open and (timezone.now() - oldest_open).days >= ITC04_WARNING_DAYS)


def order_row(order: JobWorkOrder) -> dict:
    """List row. Expects annotate_balances() on the queryset."""
    job = order.production_job
    process = order_process(order)
    open_lines = int(getattr(order, "open_line_count", 0) or 0)
    oldest = getattr(order, "oldest_open_sent_at", None)
    days = (timezone.now() - oldest).days if oldest else None
    return {
        "id": str(order.id),
        "number": order.number,
        "status": "PARTLY_RETURNED" if order.status == "PARTIAL" else order.status,
        "status_label": STATUS_LABELS.get(order.status, order.status),
        "mode": order.mode,
        "plant": str(order.plant_id),
        "plant_name": order.plant.name,
        "vendor": str(order.vendor_id) if order.vendor_id else None,
        "vendor_name": order.vendor.name if order.vendor_id else order.vendor_name,
        "production_job": str(job.id) if job else None,
        "production_job_number": job.job_number if job else None,
        "process_code": getattr(process, "code", None),
        "process_name": getattr(process, "name", None),
        "expected_output_kind": order.expected_output_kind,
        "expected_output_label": OUTPUT_LABELS.get(order.expected_output_kind, order.expected_output_kind),
        "expected_qty": num(order.expected_qty),
        "expected_uom": order.expected_uom,
        "rate": num(order.rate),
        "rate_uom": order.rate_uom,
        "expected_return_date": iso(order.expected_return_date),
        "dispatched_at": iso(order.dispatched_at),
        "created_at": iso(order.created_at),
        "closed_at": iso(order.closed_at),
        "sent_kg": num(getattr(order, "sent_kg_total", None)),
        "at_vendor_kg": num(max(Decimal(str(getattr(order, "at_vendor_kg_total", 0) or 0)), Decimal("0"))) if open_lines else "0",
        "open_lines": open_lines,
        "oldest_open_days": days,
        "overdue": is_overdue(order, open_lines=open_lines, oldest_open=oldest),
        "itc04_alert": bool(days is not None and days >= ITC04_WARNING_DAYS),
        "is_legacy": is_legacy_capable(order),
    }


def _user_name(user) -> Optional[str]:
    if not user:
        return None
    full = f"{getattr(user, 'first_name', '')} {getattr(user, 'last_name', '')}".strip()
    return full or user.username


def sent_line_payload(line: JobWorkSentLine, balance: dict) -> dict:
    age = (timezone.now() - line.sent_at).days if line.sent_at else None
    return {
        "id": str(line.id),
        "challan_id": str(line.challan_id) if line.challan_id else None,
        "challan_number": line.challan.number if line.challan_id else None,
        "line_no": line.line_no,
        "kind": line.kind,
        "is_legacy": line.is_legacy,
        "roll_id": str(line.roll_id) if line.roll_id else None,
        "roll_label": line.roll_label,
        "roll_status": line.roll.status if line.roll_id else None,
        "material_id": str(line.material_id) if line.material_id else None,
        "material_name": line.material_name,
        "description": line.description,
        "hsn_code": line.hsn_code,
        "quantity": num(line.quantity),
        "uom": line.uom,
        "qty_kg": num(line.qty_kg),
        "width_mm": num(line.width_mm),
        "thickness_micron": num(line.thickness_micron),
        "value": num(line.value),
        "sent_at": iso(line.sent_at),
        "age_days": age,
        "open_qty": num(balance["open_qty"]),
        "open_kg": num(balance["open_kg"]),
        "is_open": balance["is_open"],
        "consumed_kg": num(balance["consumed_kg"]),
        "returned_kg": num(balance["returned_kg"]),
        "itc04_alert": bool(balance["is_open"] and age is not None and age >= ITC04_WARNING_DAYS),
        "itc04_overdue": bool(balance["is_open"] and age is not None and age >= ITC04_LIMIT_DAYS),
    }


def challan_payload(challan: JobWorkChallan, balances: Dict[str, dict]) -> dict:
    lines = [sent_line_payload(line, balances[str(line.id)]) for line in challan.lines.all() if str(line.id) in balances]
    return {
        "id": str(challan.id),
        "number": challan.number,
        "issued_at": iso(challan.issued_at),
        "issued_by_name": _user_name(challan.issued_by),
        "purpose": challan.purpose,
        "expected_return_date": iso(challan.expected_return_date),
        "place_of_supply": challan.place_of_supply,
        "vehicle_no": challan.vehicle_no,
        "notes": challan.notes,
        "total_qty_kg": num(challan.total_qty_kg),
        "total_value": num(challan.total_value),
        "line_count": len(lines),
        "gate_out_at": iso(challan.gate_out_at),
        "gate_out_by_name": _user_name(challan.gate_out_by),
        "pdf_url": f"/api/inventory/job-work/{challan.order_id}/challans/{challan.id}/pdf/",
        "lines": lines,
    }


def return_payload(ret: JobWorkReturn) -> dict:
    lines = []
    for line in ret.lines.all():
        lines.append({
            "id": str(line.id),
            "line_no": line.line_no,
            "kind": line.kind,
            "quantity": num(line.quantity),
            "uom": line.uom,
            "qty_kg": num(line.qty_kg),
            "boxes": line.boxes,
            "bags": line.bags,
            "returned_to_factory": line.returned_to_factory,
            "location_name": line.location.name if line.location_id else None,
            "sent_line_id": str(line.sent_line_id) if line.sent_line_id else None,
            "material_name": (line.material.name or line.material.code) if line.material_id else None,
            "roll_id": str(line.roll_id) if line.roll_id else None,
            "roll_label": line.roll_label or None,
            "fg_batch_id": str(line.fg_batch_id) if line.fg_batch_id else None,
            "fg_batch_number": line.fg_batch.batch_number if line.fg_batch_id else None,
            "scrap_log_id": str(line.scrap_log_id) if line.scrap_log_id else None,
            "meta": line.meta_json or {},
        })
    bill = ret.bill
    return {
        "id": str(ret.id),
        "number": ret.number,
        "received_at": iso(ret.received_at),
        "received_by_name": _user_name(ret.received_by),
        "vendor_document_no": ret.vendor_document_no,
        "vendor_document_date": iso(ret.vendor_document_date),
        "bill": {"id": str(bill.id), "status": bill.status} if bill else None,
        "settled_sent_kg": num(ret.settled_sent_kg),
        "output_kg": num(ret.output_kg),
        "output_pcs": ret.output_pcs,
        "balance_kg": num(ret.balance_kg),
        "wastage_kg": num(ret.wastage_kg),
        "variance_kg": num(ret.variance_kg),
        "variance_pct": num(ret.variance_pct),
        "variance_reason": ret.variance_reason,
        "billed_qty": num(ret.billed_qty),
        "billed_uom": ret.billed_uom,
        "billed_rate": num(ret.billed_rate),
        "billed_amount": num(ret.billed_amount),
        "warnings": ret.warnings or [],
        "notes": ret.notes,
        "lines": lines,
    }


def timeline(order: JobWorkOrder) -> List[dict]:
    from apps.gate.models import GateAuditEvent

    rows = []
    for event in GateAuditEvent.objects.filter(object_type="JOBWORK", object_id=order.id).select_related("actor").order_by("created_at", "id"):
        rows.append({
            "at": iso(event.created_at),
            "action": event.action,
            "label": ACTION_LABELS.get(event.action, event.action.replace("_", " ").title()),
            "actor_name": _user_name(event.actor),
            "reason": event.reason,
            "details": event.after or {},
        })
    return rows


def inner_pack_enabled(job) -> bool:
    from apps.production.services.services_execution import ExecutionService

    packaging = ExecutionService._job_packaging_snapshot(job) or {}
    primary = packaging.get("primary_inner_pack") if isinstance(packaging, dict) else None
    return bool(isinstance(primary, dict) and primary.get("enabled"))


def order_detail(order: JobWorkOrder, user) -> dict:
    order = JobWorkOrder.objects.select_related(
        "plant", "vendor", "process", "closed_by", "created_by", "production_job", "production_job__current_process",
        "production_job__process", "production_job__sales_order_item", "production_job__sales_order_item__sales_order",
        "production_job__mts_order", "production_job__template",
    ).get(id=order.id)
    lines = list(order.sent_lines.select_related("challan", "roll", "material").order_by("sent_at", "line_no"))
    balances = line_balances(order, lines=lines)
    totals = order_totals(order, balances)
    process = order_process(order)
    job = order.production_job
    open_rows = [row for row in balances.values() if row["is_open"]]
    oldest = min((row["line"].sent_at for row in open_rows), default=None)
    stuck = legacy_stuck_rolls(order)
    challans = list(order.challans.select_related("issued_by", "gate_out_by").prefetch_related("lines__roll", "lines__challan").order_by("issued_at"))
    returns = list(order.returns.select_related("received_by", "bill").prefetch_related("lines__location", "lines__material", "lines__fg_batch").order_by("received_at"))
    can_manage = has_jobwork_permission(user, "inventory.manage")
    status = "PARTLY_RETURNED" if order.status == "PARTIAL" else order.status
    open_status = status not in JOBWORK_FINAL_STATUSES
    so_item = getattr(job, "sales_order_item", None) if job else None
    card = vendor_rate(order.vendor, getattr(process, "code", ""), order.rate_uom) if process is not None else None
    return {
        "id": str(order.id),
        "number": order.number,
        "status": status,
        "status_label": STATUS_LABELS.get(order.status, order.status),
        "mode": order.mode,
        "plant": str(order.plant_id),
        "plant_name": order.plant.name,
        "vendor": {
            "id": str(order.vendor_id), "name": order.vendor.name, "code": order.vendor.code, "gst_no": order.vendor.gst_no,
            "state": order.vendor.mailing_state, "jobwork_rates": order.vendor.jobwork_rates or [],
        } if order.vendor_id else None,
        "vendor_name": order.vendor.name if order.vendor_id else order.vendor_name,
        "production_job": {
            "id": str(job.id), "job_number": job.job_number, "job_state": job.job_state, "is_on_hold": job.is_on_hold,
            "hold_reason": job.hold_reason, "uom": job.uom, "quantity": num(job.quantity), "produced_qty": num(job.produced_qty),
            "sales_order_number": getattr(getattr(so_item, "sales_order", None), "order_number", None),
            "unit_weight_g": num(unit_weight_g(job)),
            "inner_pack_enabled": inner_pack_enabled(job),
            "has_template": bool(job.template_id),
        } if job else None,
        "process": {"id": str(process.id), "code": process.code, "name": process.name} if process is not None else None,
        "route_step_index": order.route_step_index,
        "emergency_reason": order.emergency_reason,
        "notes": order.notes,
        "expected_output_kind": order.expected_output_kind,
        "expected_output_label": OUTPUT_LABELS.get(order.expected_output_kind, order.expected_output_kind),
        "expected_qty": num(order.expected_qty),
        "expected_uom": order.expected_uom,
        "rate": num(order.rate),
        "rate_uom": order.rate_uom,
        "vendor_rate": card,
        "wastage_tolerance_pct": num(order.wastage_tolerance_pct),
        "expected_return_date": iso(order.expected_return_date),
        "dispatched_at": iso(order.dispatched_at),
        "received_at": iso(order.received_at),
        "closed_at": iso(order.closed_at),
        "closed_by_name": _user_name(order.closed_by),
        "short_close_reason": order.short_close_reason,
        "cancel_reason": (order.meta_json or {}).get("cancel_reason") or "",
        "created_at": iso(order.created_at),
        "created_by_name": _user_name(order.created_by),
        "is_legacy": is_legacy_capable(order),
        "overdue": is_overdue(order, open_lines=len(open_rows), oldest_open=oldest),
        "at_vendor": {
            "kg": num(totals["at_vendor_kg"]),
            "lines": len(open_rows),
            "rolls": sum(1 for row in open_rows if row["line"].kind == "ROLL"),
            "value": num(sum((Decimal(str(row["line"].value)) * (row["open_qty"] / Decimal(str(row["line"].quantity))) for row in open_rows if Decimal(str(row["line"].quantity)) > 0), Decimal("0")).quantize(Decimal("0.01"))),
            "oldest_sent_at": iso(oldest),
            "oldest_days": (timezone.now() - oldest).days if oldest else None,
            "itc04_alert": bool(oldest and (timezone.now() - oldest).days >= ITC04_WARNING_DAYS),
        },
        "totals": {key: (num(value) if isinstance(value, Decimal) else value) for key, value in totals.items()},
        "sent_lines": [sent_line_payload(line, balances[str(line.id)]) for line in lines],
        "challans": [challan_payload(challan, balances) for challan in challans],
        "returns": [return_payload(ret) for ret in returns],
        "timeline": timeline(order),
        "legacy": {
            "stuck_rolls": len(stuck),
            "stuck_kg": num(sum((Decimal(str(roll.weight_kg or 0)) for roll in stuck), Decimal("0"))),
        },
        "permissions": {
            "can_manage": can_manage,
            "can_link_bill": PermissionService.has_inventory_bill_review(user),
            "can_reconcile": PermissionService.is_gate_master(user),
        },
        "actions": {
            "can_dispatch": can_manage and status in {"DRAFT", "SENT", "PARTLY_RETURNED", "RETURNED"} and not stuck,
            "can_receive": can_manage and status in {"SENT", "PARTLY_RETURNED", "RETURNED"} and not stuck,
            "can_close": can_manage and status == "RETURNED" and not open_rows and not stuck,
            "can_short_close": can_manage and status in {"SENT", "PARTLY_RETURNED", "RETURNED"} and not stuck,
            "can_cancel": can_manage and status == "DRAFT" and not lines,
        } if open_status else {"can_dispatch": False, "can_receive": False, "can_close": False, "can_short_close": False, "can_cancel": False},
    }


def filter_orders(queryset, params):
    status_filter = str(params.get("status") or params.get("tab") or "").upper()
    if status_filter == "OPEN":
        queryset = queryset.filter(status__in=OPEN_FOR_LIST)
    elif status_filter == "AT_VENDOR":
        queryset = queryset.filter(status__in=OPEN_FOR_LIST, open_line_count__gt=0)
    elif status_filter == "OVERDUE":
        cutoff = timezone.now() - timedelta(days=ITC04_WARNING_DAYS)
        queryset = queryset.filter(status__in=OPEN_FOR_LIST, open_line_count__gt=0).filter(
            Q(expected_return_date__lt=today()) | Q(oldest_open_sent_at__lte=cutoff)
        )
    elif status_filter == "CLOSED":
        queryset = queryset.filter(status__in=JOBWORK_FINAL_STATUSES)
    elif status_filter == "PARTLY_RETURNED":
        queryset = queryset.filter(status__in=["PARTLY_RETURNED", "PARTIAL"])
    elif status_filter in {"DRAFT", "SENT", "RETURNED", "CANCELLED"}:
        queryset = queryset.filter(status=status_filter)
    if params.get("vendor"):
        queryset = queryset.filter(vendor_id=params.get("vendor"))
    if params.get("plant"):
        queryset = queryset.filter(plant_id=params.get("plant"))
    if str(params.get("overdue") or "").lower() in {"1", "true", "yes"}:
        cutoff = timezone.now() - timedelta(days=ITC04_WARNING_DAYS)
        queryset = queryset.filter(status__in=OPEN_FOR_LIST, open_line_count__gt=0).filter(
            Q(expected_return_date__lt=today()) | Q(oldest_open_sent_at__lte=cutoff)
        )
    search = str(params.get("search") or "").strip()
    if search:
        queryset = queryset.filter(
            Q(number__icontains=search)
            | Q(challans__number__icontains=search)
            | Q(returns__number__icontains=search)
            | Q(returns__vendor_document_no__icontains=search)
            | Q(production_job__job_number__icontains=search)
            | Q(vendor__name__icontains=search)
            | Q(vendor_name__icontains=search)
        ).distinct()
    return queryset


def tab_counts(base_queryset) -> dict:
    cutoff = timezone.now() - timedelta(days=ITC04_WARNING_DAYS)
    open_qs = base_queryset.filter(status__in=OPEN_FOR_LIST)
    return {
        "OPEN": open_qs.count(),
        "AT_VENDOR": open_qs.filter(open_line_count__gt=0).count(),
        "OVERDUE": open_qs.filter(open_line_count__gt=0).filter(Q(expected_return_date__lt=today()) | Q(oldest_open_sent_at__lte=cutoff)).count(),
        "CLOSED": base_queryset.filter(status__in=JOBWORK_FINAL_STATUSES).count(),
    }

