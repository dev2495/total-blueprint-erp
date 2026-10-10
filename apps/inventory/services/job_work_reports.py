"""Job-work reports: material at job workers (ageing), yield and wastage by
vendor, and the Owner list of rolls left at JOBWORK_OUT by the old flow."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, time, timedelta
from decimal import Decimal

from django.db.models import Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.inventory.models import JOBWORK_FINAL_STATUSES, JobWorkOrder, JobWorkReturn, JobWorkSentLine, JobWorkSettlement
from apps.inventory.services.job_work import (
    ITC04_LIMIT_DAYS,
    ITC04_WARNING_DAYS,
    legacy_attribution,
    legacy_output_candidates,
    roll_rate_per_kg,
)
from apps.inventory.services.job_work_payloads import iso, num

AGE_BUCKETS = [
    ("0_30", "0–30 days", 0, 30),
    ("31_90", "31–90 days", 31, 90),
    ("91_180", "91–180 days", 91, 180),
    ("181_300", "181–300 days", 181, 300),
    ("301_365", "301–365 days", 301, 365),
    ("over_365", "Over a year", 366, None),
]
ZERO = Decimal("0")


def _bucket(age: int) -> str:
    for key, _, low, high in AGE_BUCKETS:
        if age >= low and (high is None or age <= high):
            return key
    return AGE_BUCKETS[-1][0]


def material_at_vendors(*, plant=None, vendor=None) -> dict:
    lines = JobWorkSentLine.objects.select_related("order", "order__vendor", "order__plant", "challan").exclude(order__status__in=["CANCELLED"])
    if plant:
        lines = lines.filter(order__plant_id=plant)
    if vendor:
        lines = lines.filter(order__vendor_id=vendor)
    settled = {
        row["sent_line_id"]: row
        for row in JobWorkSettlement.objects.filter(sent_line__in=lines).values("sent_line_id").annotate(q=Sum("consumed_qty") + Sum("returned_qty"), kg=Sum("consumed_kg") + Sum("returned_kg"))
    }
    now = timezone.now()
    vendors = {}
    for line in lines:
        done = settled.get(line.id, {})
        open_qty = Decimal(str(line.quantity)) - Decimal(str(done.get("q") or 0))
        if open_qty <= 0:
            continue
        open_kg = max(Decimal(str(line.qty_kg)) - Decimal(str(done.get("kg") or 0)), ZERO)
        value = (Decimal(str(line.value)) * open_qty / Decimal(str(line.quantity))) if Decimal(str(line.quantity)) > 0 else ZERO
        age = (now - line.sent_at).days
        order = line.order
        key = str(order.vendor_id) if order.vendor_id else f"name:{order.vendor_name}"
        row = vendors.setdefault(key, {
            "vendor": str(order.vendor_id) if order.vendor_id else None,
            "vendor_name": order.vendor.name if order.vendor_id else order.vendor_name,
            "kg": ZERO, "value": ZERO, "lines": 0, "orders": set(), "oldest_days": 0,
            "buckets": {bucket: ZERO for bucket, *_ in AGE_BUCKETS}, "itc04_alert_kg": ZERO, "itc04_overdue_kg": ZERO,
            "items": [],
        })
        row["kg"] += open_kg
        row["value"] += value
        row["lines"] += 1
        row["orders"].add(order.number)
        row["oldest_days"] = max(row["oldest_days"], age)
        row["buckets"][_bucket(age)] += open_kg
        if age >= ITC04_WARNING_DAYS:
            row["itc04_alert_kg"] += open_kg
        if age >= ITC04_LIMIT_DAYS:
            row["itc04_overdue_kg"] += open_kg
        row["items"].append({
            "order_id": str(order.id), "order_number": order.number, "challan_number": line.challan.number if line.challan_id else None,
            "plant_name": order.plant.name, "description": line.description, "open_qty": num(open_qty), "uom": line.uom,
            "open_kg": num(open_kg), "value": num(value.quantize(Decimal("0.01"))), "sent_at": iso(line.sent_at), "age_days": age,
        })
    legacy = legacy_attribution(plant_ids=[plant] if plant else None)
    legacy_orders = {str(o.id): o for o in JobWorkOrder.objects.filter(id__in=[k for k in legacy if k]).select_related("vendor")}
    for key, rolls in legacy.items():
        order = legacy_orders.get(key) if key else None
        if vendor and (order is None or str(order.vendor_id) != str(vendor)):
            continue
        vkey = (str(order.vendor_id) if order and order.vendor_id else f"name:{order.vendor_name}") if order else "unattributed"
        row = vendors.setdefault(vkey, {
            "vendor": str(order.vendor_id) if order and order.vendor_id else None,
            "vendor_name": (order.vendor.name if order.vendor_id else order.vendor_name) if order else "Not linked to an order",
            "kg": ZERO, "value": ZERO, "lines": 0, "orders": set(), "oldest_days": 0,
            "buckets": {bucket: ZERO for bucket, *_ in AGE_BUCKETS}, "itc04_alert_kg": ZERO, "itc04_overdue_kg": ZERO, "items": [],
        })
        for roll in rolls:
            age = (now - roll._legacy_sent_at).days
            kg = Decimal(str(roll.weight_kg or 0))
            row["kg"] += kg
            row["value"] += roll_rate_per_kg(roll) * kg
            row["lines"] += 1
            if order:
                row["orders"].add(order.number)
            row["oldest_days"] = max(row["oldest_days"], age)
            row["buckets"][_bucket(age)] += kg
            if age >= ITC04_WARNING_DAYS:
                row["itc04_alert_kg"] += kg
            if age >= ITC04_LIMIT_DAYS:
                row["itc04_overdue_kg"] += kg
            row["items"].append({
                "order_id": str(order.id) if order else None, "order_number": order.number if order else None, "challan_number": None,
                "plant_name": roll.location.plant.name, "description": f"Roll {roll.label_id} (sent before the upgrade, not reconciled)",
                "open_qty": num(kg), "uom": "KG", "open_kg": num(kg), "value": None, "sent_at": iso(roll._legacy_sent_at), "age_days": age, "legacy": True,
            })
    rows = []
    totals = {"kg": ZERO, "value": ZERO, "lines": 0, "buckets": {bucket: ZERO for bucket, *_ in AGE_BUCKETS}}
    for row in sorted(vendors.values(), key=lambda r: (-r["kg"], r["vendor_name"])):
        totals["kg"] += row["kg"]
        totals["value"] += row["value"]
        totals["lines"] += row["lines"]
        for bucket in row["buckets"]:
            totals["buckets"][bucket] += row["buckets"][bucket]
        rows.append({
            **{key: value for key, value in row.items() if key not in {"orders", "kg", "value", "buckets", "itc04_alert_kg", "itc04_overdue_kg", "items"}},
            "kg": num(row["kg"]), "value": num(row["value"].quantize(Decimal("0.01"))), "orders": sorted(row["orders"]),
            "buckets": {key: num(value) for key, value in row["buckets"].items()},
            "itc04_alert_kg": num(row["itc04_alert_kg"]), "itc04_overdue_kg": num(row["itc04_overdue_kg"]),
            "items": sorted(row["items"], key=lambda item: -item["age_days"]),
        })
    return {
        "generated_at": iso(now),
        "buckets": [{"key": key, "label": label} for key, label, *_ in AGE_BUCKETS],
        "rows": rows,
        "totals": {"kg": num(totals["kg"]), "value": num(totals["value"].quantize(Decimal("0.01"))), "lines": totals["lines"], "buckets": {k: num(v) for k, v in totals["buckets"].items()}},
    }


def yield_by_vendor(*, plant=None, vendor=None, date_from=None, date_to=None) -> dict:
    zone = timezone.get_current_timezone()
    end = date_to or timezone.localdate()
    start = date_from or (end - timedelta(days=90))
    if start > end or (end - start).days > 400:
        raise ValidationError({"date_from": "Choose an ordered date range of 400 days or fewer."})
    returns = JobWorkReturn.objects.select_related("order", "order__vendor").filter(
        received_at__gte=datetime.combine(start, time.min, tzinfo=zone),
        received_at__lt=datetime.combine(end + timedelta(days=1), time.min, tzinfo=zone),
    )
    if plant:
        returns = returns.filter(plant_id=plant)
    if vendor:
        returns = returns.filter(order__vendor_id=vendor)
    vendors = defaultdict(lambda: {"returns": 0, "orders": set(), "settled": ZERO, "output": ZERO, "pcs": 0, "balance": ZERO, "wastage": ZERO, "variance": ZERO})
    names = {}
    for ret in returns:
        order = ret.order
        key = str(order.vendor_id) if order.vendor_id else f"name:{order.vendor_name}"
        names[key] = (str(order.vendor_id) if order.vendor_id else None, order.vendor.name if order.vendor_id else order.vendor_name)
        row = vendors[key]
        row["returns"] += 1
        row["orders"].add(order.number)
        row["settled"] += ret.settled_sent_kg
        row["output"] += ret.output_kg
        row["pcs"] += ret.output_pcs
        row["balance"] += ret.balance_kg
        row["wastage"] += ret.wastage_kg
        row["variance"] += ret.variance_kg
    rows = []
    for key, row in vendors.items():
        processed = row["settled"] - row["balance"]
        rows.append({
            "vendor": names[key][0], "vendor_name": names[key][1], "returns": row["returns"], "orders": len(row["orders"]),
            "settled_kg": num(row["settled"]), "processed_kg": num(processed), "output_kg": num(row["output"]), "output_pcs": row["pcs"],
            "balance_kg": num(row["balance"]), "wastage_kg": num(row["wastage"]), "variance_kg": num(row["variance"]),
            "yield_pct": num((row["output"] / processed * 100).quantize(Decimal("0.1"))) if processed > 0 else None,
            "wastage_pct": num((row["wastage"] / processed * 100).quantize(Decimal("0.1"))) if processed > 0 else None,
            "variance_pct": num((row["variance"] / row["settled"] * 100).quantize(Decimal("0.1"))) if row["settled"] > 0 else None,
        })
    rows.sort(key=lambda r: r["vendor_name"])
    return {"date_from": start.isoformat(), "date_to": end.isoformat(), "rows": rows}


def legacy_report(*, plant=None) -> dict:
    grouped = legacy_attribution(plant_ids=[plant] if plant else None)
    orders = {str(order.id): order for order in JobWorkOrder.objects.filter(id__in=[key for key in grouped if key]).select_related("plant", "vendor", "production_job")}
    rows = []
    for key, rolls in grouped.items():
        order = orders.get(key) if key else None
        outputs = list(legacy_output_candidates(order)) if order else []
        rows.append({
            "order": {
                "id": str(order.id), "number": order.number, "status": order.status, "vendor_name": order.vendor_name,
                "plant": str(order.plant_id), "plant_name": order.plant.name, "production_job_number": getattr(order.production_job, "job_number", None),
                "dispatched_at": iso(order.dispatched_at), "received_at": iso(order.received_at),
            } if order else None,
            "rolls": [{
                "id": str(roll.id), "label_id": roll.label_id, "material_name": (roll.material.name or roll.material.code) if roll.material_id else None,
                "weight_kg": num(roll.weight_kg), "width_mm": num(roll.width_mm), "thickness_micron": num(roll.thickness_micron),
                "plant": str(roll.location.plant_id), "plant_name": roll.location.plant.name, "sent_at": iso(roll._legacy_sent_at), "age_days": (timezone.now() - roll._legacy_sent_at).days,
                "production_job_number": getattr(roll.production_job, "job_number", None),
            } for roll in rolls],
            "output_candidates": [{
                "id": str(out.id), "label_id": out.label_id, "material_name": (out.material.name or out.material.code) if out.material_id else None,
                "weight_kg": num(out.original_weight_kg or out.weight_kg), "status": out.status, "created_at": iso(out.created_at),
            } for out in outputs],
            "stuck_kg": num(sum((Decimal(str(roll.weight_kg or 0)) for roll in rolls), ZERO)),
        })
    rows.sort(key=lambda row: (row["order"] is None, row["order"]["number"] if row["order"] else ""))
    still_open = JobWorkOrder.objects.filter(status__in=["SENT", "PARTIAL", "PARTLY_RETURNED"]).exclude(status__in=JOBWORK_FINAL_STATUSES)
    return {"rows": rows, "stuck_rolls": sum(len(row["rolls"]) for row in rows), "open_legacy_orders": still_open.filter(number__startswith="JWO-L-").count()}
