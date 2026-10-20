"""Goods in & out: one register of everything of ours that leaves a factory gate and what is
expected back, across the papers that move it.

Each paper keeps its own screen, rules and legal form (an inter-plant challan, a job-work challan
under GST Rule 45, a returnable or non-returnable gate pass). This register only reads them and
puts them on one list, with one set of stages:

    PREPARED  the paper exists; the goods have not left yet
    OUTSIDE   in transit to another factory, at a job worker, or out on a returnable pass
    AT_GATE   back at a gate (watchman recorded the arrival) and waiting for the store to receive
    DONE      received, returned, closed or cancelled

Nothing here changes a record.
"""
from datetime import timedelta
from decimal import Decimal

from django.db.models import Count, Q, Sum
from django.utils import timezone

STAGES = ("PREPARED", "OUTSIDE", "AT_GATE", "DONE")
KINDS = {
    "INTERPLANT": "Inter-plant transfer",
    "JOBWORK": "Job work",
    "RGP": "Returnable gate pass",
    "NRGP": "Non-returnable gate pass",
}
DONE_DAYS = 60
TRANSIT_LATE_DAYS = 2


def _kg(value) -> str:
    value = Decimal(str(value or 0)).quantize(Decimal("0.001"))
    text = format(value.normalize(), "f")
    return text


def _iso(value):
    if value is None:
        return None
    return timezone.localtime(value).isoformat() if hasattr(value, "tzinfo") and value.tzinfo else value.isoformat()


def _row(**kw):
    kw.setdefault("overdue", False)
    kw.setdefault("late_note", "")
    kw.setdefault("arrival", None)
    return kw


# ----------------------------------------------------------- inter-plant
def _interplant_rows(plant_ids, since, query):
    from apps.inventory.models import DeliveryChallan

    qs = DeliveryChallan.objects.select_related("from_plant", "to_plant", "source_job", "target_job").annotate(
        lines=Count("items"),
        planned_kg=Sum("items__planned_qty_kg"),
        dispatched_kg=Sum("items__dispatched_qty_kg"),
        received_kg=Sum("items__received_qty_kg"),
    )
    if plant_ids is not None:
        qs = qs.filter(Q(from_plant_id__in=plant_ids) | Q(to_plant_id__in=plant_ids))
    qs = qs.filter(~Q(status="RECEIVED") | Q(received_at__gte=since) | Q(updated_at__gte=since))
    if query:
        qs = qs.filter(Q(dc_no__icontains=query) | Q(from_plant__name__icontains=query) | Q(to_plant__name__icontains=query) | Q(vehicle_no__icontains=query))
    today = timezone.localdate()
    rows = []
    for c in qs.order_by("-created_at")[:600]:
        if c.status == "RECEIVED":
            stage = "DONE"
        elif c.status == "IN_TRANSIT":
            stage = "AT_GATE" if c.gate_in_at else "OUTSIDE"
        else:
            stage = "PREPARED"
        late = bool(stage == "OUTSIDE" and c.dispatched_at and (today - timezone.localtime(c.dispatched_at).date()).days >= TRANSIT_LATE_DAYS)
        moved = c.dispatched_kg or c.planned_kg or 0
        job = c.target_job or c.source_job
        rows.append(_row(
            kind="INTERPLANT", id=str(c.id), number=c.dc_no or f"IP-{str(c.id)[:8].upper()}",
            party=f"{c.from_plant.name} → {c.to_plant.name}", plant=str(c.from_plant_id), plant_name=c.from_plant.name,
            to_plant_name=c.to_plant.name, status=c.status, status_label=c.get_status_display(), stage=stage,
            summary=f"{c.lines} line{'' if c.lines == 1 else 's'} · {_kg(moved)} kg" + (f" · {_kg(c.received_kg)} kg received" if c.received_kg else ""),
            job_number=job.job_number if job else "", auto=c.is_system_generated,
            created_at=_iso(c.created_at), left_at=_iso(c.gate_out_at or c.dispatched_at), left_at_gate=bool(c.gate_out_at),
            expected_back=None, back_at_gate_at=_iso(c.gate_in_at), done_at=_iso(c.received_at),
            vehicle=c.vehicle_no, overdue=late, late_note="In transit for more than two days" if late else "",
            link=f"/inventory/inter-plant?challan={c.id}",
            # The receiving factory's gate records the arrival.
            arrival={"kind": "INTERPLANT_DC", "object_id": str(c.id), "plant": str(c.to_plant_id)} if stage == "OUTSIDE" else None,
        ))
    return rows


# --------------------------------------------------------------- job work
def _jobwork_rows(plant_ids, since, query):
    from apps.gate.arrival_services import latest_arrival_map
    from apps.inventory.models import JobWorkChallan, JobWorkOrder, JobWorkReturn
    from apps.inventory.services.job_work_payloads import annotate_balances, order_row

    qs = JobWorkOrder.objects.select_related("plant", "vendor", "production_job", "process")
    if plant_ids is not None:
        qs = qs.filter(plant_id__in=plant_ids)
    qs = qs.filter(~Q(status__in=["CLOSED", "CANCELLED"]) | Q(closed_at__gte=since) | Q(updated_at__gte=since))
    if query:
        qs = qs.filter(Q(number__icontains=query) | Q(vendor__name__icontains=query) | Q(vendor_name__icontains=query) | Q(production_job__job_number__icontains=query))
    orders = list(annotate_balances(qs).order_by("-created_at")[:400])
    if not orders:
        return []
    ids = [o.id for o in orders]
    challans = {}
    for ch in JobWorkChallan.objects.filter(order_id__in=ids).order_by("issued_at").values("id", "order_id", "gate_out_at", "issued_at", "vehicle_no"):
        challans.setdefault(ch["order_id"], []).append(ch)
    arrivals = latest_arrival_map("JOBWORK_CHALLAN", [ch["id"] for rows in challans.values() for ch in rows])
    last_return = dict(JobWorkReturn.objects.filter(order_id__in=ids).values("order_id").annotate(last=Count("id")).values_list("order_id", "last"))
    last_return_at = {}
    for ret in JobWorkReturn.objects.filter(order_id__in=ids).values("order_id", "received_at").order_by("order_id", "-received_at"):
        last_return_at.setdefault(ret["order_id"], ret["received_at"])
    rows = []
    for o in orders:
        base = order_row(o)
        mine = challans.get(o.id, [])
        gate_outs = [ch["gate_out_at"] for ch in mine if ch["gate_out_at"]]
        arrived = [arrivals[str(ch["id"])] for ch in mine if str(ch["id"]) in arrivals]
        latest_arrival = max(arrived) if arrived else None
        returned_since = last_return_at.get(o.id)
        status = base["status"]
        if status in {"CLOSED", "CANCELLED"} or (status == "RETURNED" and not base["open_lines"]):
            stage = "DONE"
        elif status == "DRAFT":
            stage = "PREPARED"
        elif latest_arrival and (returned_since is None or latest_arrival > returned_since):
            stage = "AT_GATE"
        else:
            stage = "OUTSIDE"
        rows.append(_row(
            kind="JOBWORK", id=base["id"], number=base["number"] or f"JWO-{base['id'][:8].upper()}",
            party=base["vendor_name"] or "", plant=base["plant"], plant_name=base["plant_name"], to_plant_name="",
            status=status, status_label=base["status_label"], stage=stage,
            summary=(f"{base['process_name'] or base['process_code'] or 'Job work'} · {base['sent_kg'] or 0} kg sent"
                     + (f" · {base['at_vendor_kg']} kg at vendor" if base["open_lines"] else "")),
            job_number=base["production_job_number"] or "", auto=o.mode == "PLANNED_STEP",
            created_at=base["created_at"], left_at=_iso(min(gate_outs)) if gate_outs else base["dispatched_at"], left_at_gate=bool(gate_outs),
            expected_back=base["expected_return_date"], back_at_gate_at=_iso(latest_arrival), done_at=base["closed_at"],
            vehicle=(mine[-1]["vehicle_no"] if mine else ""), overdue=bool(base["overdue"] and stage in {"OUTSIDE", "AT_GATE"}),
            late_note=("Past the expected return date" if base["overdue"] else "") + (" · ITC-04 one-year limit near" if base["itc04_alert"] else ""),
            link=f"/inventory/job-work/{base['id']}", returns=last_return.get(o.id, 0),
            arrival=({"kind": "JOBWORK_CHALLAN", "object_id": str(mine[-1]["id"]), "plant": base["plant"]} if stage == "OUTSIDE" and mine else None),
        ))
    return rows


# ------------------------------------------------------------- gate passes
def _gate_pass_rows(plant_ids, since, query):
    from apps.gate.arrival_services import latest_arrival_map
    from apps.gate.gate_pass_services import display_number
    from apps.gate.models import GatePass, GatePassReturn

    qs = GatePass.objects.select_related("plant").annotate(
        line_count=Count("lines", distinct=True),
        qty=Sum("lines__quantity"),
        returned=Sum("lines__returned_quantity"),
    )
    if plant_ids is not None:
        qs = qs.filter(plant_id__in=plant_ids)
    qs = qs.filter(~Q(status__in=["RETURNED", "CLOSED", "SHORT_CLOSED", "CANCELLED"]) | Q(closed_at__gte=since) | Q(created_at__gte=since))
    if query:
        qs = qs.filter(Q(number__icontains=query) | Q(party_name__icontains=query) | Q(vehicle_number__icontains=query))
    passes = list(qs.order_by("-created_at")[:400])
    arrivals = latest_arrival_map("GATE_PASS", [p.id for p in passes])
    last_return_at = {}
    for ret in GatePassReturn.objects.filter(line__gate_pass_id__in=[p.id for p in passes]).values("line__gate_pass_id", "returned_at").order_by("line__gate_pass_id", "-returned_at"):
        last_return_at.setdefault(ret["line__gate_pass_id"], ret["returned_at"])
    today = timezone.localdate()
    rows = []
    for p in passes:
        returnable = p.kind == "RETURNABLE"
        latest_arrival = arrivals.get(str(p.id))
        if p.status in {"DRAFT", "ISSUED"}:
            stage = "PREPARED"
        elif p.status in {"RETURNED", "CLOSED", "SHORT_CLOSED", "CANCELLED"}:
            stage = "DONE"
        elif latest_arrival and (last_return_at.get(p.id) is None or latest_arrival > last_return_at[p.id]):
            stage = "AT_GATE"
        else:
            stage = "OUTSIDE"
        overdue = bool(returnable and stage in {"OUTSIDE", "AT_GATE"} and p.expected_return_date and p.expected_return_date < today)
        rows.append(_row(
            kind="RGP" if returnable else "NRGP", id=str(p.id), number=display_number(p), party=p.party_name,
            plant=str(p.plant_id), plant_name=p.plant.name, to_plant_name="", status=p.status, status_label=p.get_status_display(),
            stage=stage, summary=(f"{p.get_purpose_display()} · {p.line_count} item{'' if p.line_count == 1 else 's'}"
                                  + (f" · {_kg(p.returned)} of {_kg(p.qty)} back" if returnable and p.qty else "")),
            job_number="", auto=False, created_at=_iso(p.created_at), left_at=_iso(p.out_at), left_at_gate=bool(p.out_at),
            expected_back=p.expected_return_date.isoformat() if p.expected_return_date else None,
            back_at_gate_at=_iso(latest_arrival), done_at=_iso(p.closed_at), vehicle=p.vehicle_number, overdue=overdue,
            late_note="Past the expected return date" if overdue else "", link=f"/inventory/gate-passes/{p.id}",
            arrival={"kind": "GATE_PASS", "object_id": str(p.id), "plant": str(p.plant_id)} if returnable and stage == "OUTSIDE" else None,
        ))
    return rows


# --------------------------------------------------------------- register
SOURCES = {"INTERPLANT": _interplant_rows, "JOBWORK": _jobwork_rows, "RGP": _gate_pass_rows, "NRGP": _gate_pass_rows}


def movement_register(*, plant_ids=None, stage="", kind="", query="", overdue_only=False, page=1, page_size=50):
    since = timezone.now() - timedelta(days=DONE_DAYS)
    query = str(query or "").strip()[:80]
    wanted_kinds = [kind] if kind in KINDS else list(KINDS)
    rows, seen = [], set()
    for k in wanted_kinds:
        source = SOURCES[k]
        if source in seen:
            continue
        seen.add(source)
        rows.extend(source(plant_ids, since, query))
    if kind in KINDS:
        rows = [r for r in rows if r["kind"] == kind]
    counts = {s: 0 for s in STAGES}
    kinds = {k: 0 for k in KINDS}
    overdue_total = 0
    for r in rows:
        counts[r["stage"]] += 1
        if r["stage"] != "DONE":
            kinds[r["kind"]] += 1
        overdue_total += 1 if r["overdue"] else 0
    if stage in STAGES:
        rows = [r for r in rows if r["stage"] == stage]
    if overdue_only:
        rows = [r for r in rows if r["overdue"]]
    # Overdue first, then the newest movement.
    rows.sort(key=lambda r: (not r["overdue"], -(_ts(r.get("back_at_gate_at") or r.get("left_at") or r.get("created_at")))))
    page_size = max(1, min(int(page_size or 50), 200))
    page = max(1, int(page or 1))
    total = len(rows)
    start = (page - 1) * page_size
    return {
        "counts": counts, "open_by_kind": kinds, "overdue": overdue_total, "kinds": KINDS,
        "total": total, "page": page, "page_size": page_size, "results": rows[start:start + page_size],
        "done_window_days": DONE_DAYS,
    }


def _ts(value):
    from datetime import datetime

    if not value:
        return 0
    try:
        return datetime.fromisoformat(str(value)).timestamp()
    except ValueError:
        return 0

