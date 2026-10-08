"""Aggregate bill workflow reporting; never export captured/commercial contents."""

from datetime import timedelta

from django.db.models import Count, Min, Q
from django.db.models.functions import TruncDate


def summary_for_period(start_date, end_date, plant_ids=None):
    from apps.gate.models import InwardBillIntake
    from apps.gate.services import date_bounds

    start, next_day = date_bounds(start_date, end_date)
    bills = InwardBillIntake.objects.all()
    if plant_ids is not None:
        bills = bills.filter(plant_id__in=plant_ids)
    arrivals = bills.filter(arrival_at__gte=start, arrival_at__lt=next_day)
    resolved = bills.filter(resolved_at__gte=start, resolved_at__lt=next_day)
    pending = bills.filter(status__in=["PENDING_GRN", "PARTIAL_GRN"])
    oldest = pending.aggregate(oldest=Min("arrival_at"))["oldest"]
    return {
        "bill_arrivals": arrivals.count(),
        "bill_received": resolved.filter(status="RECEIPTED").count(),
        "bill_voided": resolved.filter(status="VOID").count(),
        "bill_pending_grn": pending.count(),
        "bill_partial_grn": pending.filter(status="PARTIAL_GRN").count(),
        "bill_pending_oldest_arrival_at": oldest.isoformat() if oldest else None,
        "bill_pending_scope": "Current unresolved bills in the selected plant scope, across all arrival dates.",
        "bill_resolution_note": "Bill arrival captures evidence only. Existing inventory receipt services post stock; completion confirms all bill lines were received.",
    }


def daily_series(start_date, end_date, plant_id=None):
    from apps.gate.models import InwardBillIntake
    from apps.gate.services import date_bounds, gate_zone

    start, next_day = date_bounds(start_date, end_date)
    bills = InwardBillIntake.objects.all()
    if plant_id:
        bills = bills.filter(plant_id=plant_id)
    arrivals = {
        row["day"]: row["count"]
        for row in bills.filter(arrival_at__gte=start, arrival_at__lt=next_day)
        .annotate(day=TruncDate("arrival_at", tzinfo=gate_zone())).values("day").annotate(count=Count("id"))
    }
    resolved = {
        row["day"]: row
        for row in bills.filter(resolved_at__gte=start, resolved_at__lt=next_day)
        .annotate(day=TruncDate("resolved_at", tzinfo=gate_zone())).values("day").annotate(
            bill_received=Count("id", filter=Q(status="RECEIPTED")),
            bill_voided=Count("id", filter=Q(status="VOID")),
        )
    }
    result = []
    cursor = start_date
    while cursor <= end_date:
        row = resolved.get(cursor, {})
        result.append({"date": cursor.isoformat(), "bill_arrivals": arrivals.get(cursor, 0), "bill_received": row.get("bill_received", 0), "bill_voided": row.get("bill_voided", 0)})
        cursor += timedelta(days=1)
    return result
