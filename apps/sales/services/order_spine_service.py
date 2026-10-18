"""
Order spine: one read-only summary of where an order stands, shown as the same strip on the
order page, the planner, the WC terminal, the machine screen and the packing yard.

Stations (always these seven, in this order):
  master -> quote -> order -> plan -> floor -> yard -> dispatch

Every figure here is derived from existing rows; nothing is written and no rule changes.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from apps.production.models import DeliveryChallan, DeliveryChallanItem, FinishedGoodsBatch, PackingUnit, PackingVerification, ProductionJob
from apps.sales.models import SalesOrder, SalesOrderItem

OPEN_JOB_STATES = {"PLANNED", "WAITING", "READY", "RELEASED", "QUEUED"}
RUNNING_JOB_STATES = {"EXECUTING", "PAUSED"}
CLOSED_JOB_STATES = {"COMPLETED", "CANCELLED", "SHORT_CLOSED"}


def _num(value: Any, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _text(*values: Any) -> str:
    for value in values:
        raw = str(value or "").strip()
        if raw and raw.lower() not in {"none", "null"}:
            return raw
    return ""


def _fmt_qty(value: float, uom: str) -> str:
    uom = (uom or "KG").upper()
    if uom == "PCS":
        return f"{int(round(value)):,} pcs"
    return f"{value:,.1f} kg"


class OrderSpineService:
    @classmethod
    def for_job(cls, job: ProductionJob) -> dict[str, Any] | None:
        item = getattr(job, "sales_order_item", None)
        order = getattr(item, "sales_order", None) if item else None
        if order is None:
            return None
        return cls.for_order(order, focus_job=job)

    @classmethod
    def for_order(cls, order: SalesOrder, *, focus_job: ProductionJob | None = None) -> dict[str, Any]:
        items = list(
            SalesOrderItem.objects.filter(sales_order=order)
            .select_related("product_master", "template", "template__routing_rule", "assigned_artwork")
            .order_by("created_at")
        )
        jobs = list(
            ProductionJob.objects.filter(sales_order_item__sales_order=order)
            .select_related("current_process", "process", "work_center", "machine")
            .order_by("sales_order_item_id", "current_step_index", "created_at")
        )
        batches = list(FinishedGoodsBatch.objects.filter(sales_order_item__sales_order=order))
        verifications = list(PackingVerification.objects.filter(fg_batch__in=[b.id for b in batches])) if batches else []
        units = list(PackingUnit.objects.filter(sales_order_item__sales_order=order)) if batches else []
        challans = list(DeliveryChallan.objects.filter(sales_order=order).order_by("created_at"))
        challan_items = list(DeliveryChallanItem.objects.filter(challan__in=[c.id for c in challans])) if challans else []

        stations = [
            cls._master_station(items),
            cls._quote_station(order),
            cls._order_station(order, items),
            cls._plan_station(order, items, jobs),
            cls._floor_station(order, jobs, focus_job),
            cls._yard_station(order, items, batches, verifications, units),
            cls._dispatch_station(order, items, challans, challan_items),
        ]
        return {
            "order_id": str(order.id),
            "order_number": order.order_number,
            "customer_name": order.customer_name,
            "status": order.status,
            "delivery_date": order.delivery_date.isoformat() if order.delivery_date else None,
            "stations": stations,
            "made": cls._made_summary(order, items),
            "focus_job_id": str(focus_job.id) if focus_job is not None else None,
        }

    # ------------------------------------------------------------------ stations
    @staticmethod
    def _station(key: str, label: str, state: str, value: str = "", href: str = "", detail: str = "") -> dict[str, Any]:
        return {"key": key, "label": label, "state": state, "value": value, "href": href, "detail": detail}

    @classmethod
    def _master_station(cls, items):
        masters = []
        for item in items:
            master = getattr(item, "product_master", None)
            if master is not None and master.id not in {m.id for m in masters}:
                masters.append(master)
        if masters:
            first = masters[0]
            value = first.code if len(masters) == 1 else f"{first.code} +{len(masters) - 1}"
            return cls._station("master", "Master", "done", value, f"/master/products/{first.id}", first.name)
        template = next((getattr(i, "template", None) for i in items if getattr(i, "template", None)), None)
        if template is not None:
            return cls._station("master", "Master", "done", template.name, f"/engineering/templates/{template.id}", "Template line")
        return cls._station("master", "Master", "pending", "—")

    @classmethod
    def _quote_station(cls, order):
        revision = getattr(order, "source_quotation_revision", None)
        if revision is None:
            return cls._station("quote", "Quote", "skipped", "no quote", "/sales/quotations", "Order placed directly")
        return cls._station(
            "quote", "Quote", "done",
            _text(getattr(revision, "quote_number", None), str(revision.id)[:8]),
            f"/sales/quotations/{revision.id}",
            f"Revision {getattr(revision, 'revision_no', 1)}",
        )

    @classmethod
    def _order_station(cls, order, items):
        qty_bits = []
        for item in items[:2]:
            qty_bits.append(_fmt_qty(_num(item.qty_value), item.qty_uom))
        if len(items) > 2:
            qty_bits.append(f"+{len(items) - 2} lines")
        state = "done" if order.status not in {"DRAFT", "CANCELLED"} else ("pending" if order.status == "DRAFT" else "skipped")
        return cls._station(
            "order", "Order", state,
            " · ".join([order.order_number, *qty_bits]) if qty_bits else order.order_number,
            f"/sales/orders/{order.id}",
            order.status.replace("_", " ").title(),
        )

    @classmethod
    def _plan_station(cls, order, items, jobs):
        lanes = [i for i in items if i.preferred_lane_count]
        lane_text = ""
        if lanes:
            first = lanes[0]
            lane_text = f"{first.preferred_lane_count} lane{'s' if first.preferred_lane_count != 1 else ''}"
            if first.planned_parent_width_mm:
                lane_text += f" · {_num(first.planned_parent_width_mm):g} mm"
        if not jobs:
            return cls._station("plan", "Plan", "pending", lane_text or "not released", "/dashboard/planner/control-tower/command", "No jobs yet")
        released = [j for j in jobs if str(j.job_state).upper() not in {"PLANNED"}]
        value = f"{len(jobs)} job{'s' if len(jobs) != 1 else ''}"
        if lane_text:
            value = f"{lane_text} · {value}"
        state = "done" if released or order.status in {"IN_PRODUCTION", "COMPLETED", "DISPATCHED", "PARTIALLY_DISPATCHED"} else "active"
        return cls._station("plan", "Plan", state, value, "/dashboard/planner/control-tower/command", f"{len(released)} released")

    @classmethod
    def _floor_station(cls, order, jobs, focus_job):
        if not jobs:
            return cls._station("floor", "Floor", "pending", "—", "/production/work-center")
        total = len(jobs)
        done = [j for j in jobs if str(j.job_state).upper() in CLOSED_JOB_STATES]
        running = [j for j in jobs if str(j.job_state).upper() in RUNNING_JOB_STATES]
        current = focus_job or (running[0] if running else next((j for j in jobs if str(j.job_state).upper() not in CLOSED_JOB_STATES), None))
        href = "/production/work-center"
        if current is not None and current.work_center_id:
            href = f"/production/work-center/{current.work_center_id}"
        if current is not None and current.machine_id and str(current.job_state).upper() in RUNNING_JOB_STATES:
            href = f"/production/machine/{current.machine_id}"
        if len(done) == total:
            return cls._station("floor", "Floor", "done", f"{total} of {total} steps done", href, "All steps complete")
        if current is None:
            return cls._station("floor", "Floor", "pending", f"{len(done)} of {total} steps", href)
        process = current.current_process or current.process
        step_label = _text(getattr(process, "name", None), getattr(process, "code", None), "Step")
        state = "active" if running or focus_job is not None else "pending"
        detail = current.job_number
        if current.machine_id and getattr(current, "machine", None) is not None:
            detail += f" · {current.machine.name}"
        return cls._station("floor", "Floor", state, f"{step_label} · {len(done)} of {total} done", href, detail)

    @classmethod
    def _yard_station(cls, order, items, batches, verifications, units):
        if not batches:
            return cls._station("yard", "Yard", "pending", "—", "/logistics/packing", "No finished batches yet")
        # Pieces move from the batch into gonnies/cartons as they are packed; count both.
        pcs = sum(int(b.qty_pcs or 0) for b in batches) + sum(int(u.qty_pcs or 0) for u in units)
        verified = [v for v in verifications if str(v.status).upper() == "VERIFIED"]
        held = [v for v in verifications if str(v.status).upper() == "HELD"]
        bits = [f"{len(batches)} batch{'es' if len(batches) != 1 else ''}", f"{pcs:,} pcs"]
        if units:
            bits.append(f"{len(units)} unit{'s' if len(units) != 1 else ''}")
        if verified:
            bits.append(f"{len(verified)} verified")
        if held:
            bits.append(f"{len(held)} held")
        state = "active"
        if held:
            state = "blocked"
        elif batches and len(verified) == len(batches):
            state = "done"
        return cls._station("yard", "Yard", state, " · ".join(bits), "/logistics/packing", "Packing check" if verifications else "Packing")

    @classmethod
    def _dispatch_station(cls, order, items, challans, challan_items):
        sent_states = {"DISPATCHED", "IN_TRANSIT", "RECEIVED", "DELIVERED", "POD_CONFIRMED"}
        sent = [c for c in challans if str(c.status).upper() in sent_states]
        sent_ids = {c.id for c in sent}
        dispatched_pcs = sum(int(ci.qty_pcs or 0) for ci in challan_items if ci.challan_id in sent_ids)
        loaded_pcs = sum(int(ci.qty_pcs or 0) for ci in challan_items)
        ordered_pcs = sum(int(round(_num(i.qty_value))) for i in items if str(i.qty_uom).upper() == "PCS")
        href = f"/sales/orders/{order.id}/dispatches"
        if not challans:
            return cls._station("dispatch", "Dispatch", "pending", "—", href)
        value = f"{len(challans)} challan{'s' if len(challans) != 1 else ''}"
        if dispatched_pcs:
            value += f" · {dispatched_pcs:,} pcs sent"
        elif loaded_pcs:
            value += f" · {loaded_pcs:,} pcs loading"
        state = "active"
        if ordered_pcs and dispatched_pcs >= ordered_pcs:
            state = "done"
        elif order.status in {"COMPLETED", "DISPATCHED"}:
            state = "done"
        detail = f"{len(sent)} on the road" if sent else "Draft challan · not yet dispatched"
        return cls._station("dispatch", "Dispatch", state, value, href, detail)

    # ------------------------------------------------------------------ what is to be made
    @staticmethod
    def _grade_names(layers) -> dict[str, str]:
        ids = {str(layer.get("grade_id")) for layer in layers if isinstance(layer, dict) and layer.get("grade_id")}
        if not ids:
            return {}
        try:
            from apps.recipes.models import RecipeGrade

            return {str(g.id): g.name for g in RecipeGrade.objects.filter(id__in=ids)}
        except Exception:
            return {}

    @classmethod
    def _made_summary(cls, order, items) -> dict[str, Any]:
        lines = [cls._made_line(item) for item in items]
        total_kg = sum(_num(item.total_weight_kg) for item in items)
        return {
            "headline": lines[0]["headline"] if lines else order.order_name or order.order_number,
            "structure": lines[0]["structure"] if lines else "",
            "print": lines[0]["print"] if lines else "",
            "route": lines[0]["route"] if lines else "",
            "lanes": lines[0]["lanes"] if lines else "",
            "unit_weight_g": lines[0]["unit_weight_g"] if lines else None,
            "layers": lines[0]["layers"] if lines else [],
            "size": lines[0]["size"] if lines else "",
            "pouch_style": lines[0]["pouch_style"] if lines else "",
            "artwork": lines[0]["artwork"] if lines else "",
            "colours": lines[0]["colours"] if lines else 0,
            "gauge_micron": lines[0]["gauge_micron"] if lines else None,
            "total_kg": round(total_kg, 3),
            "line_count": len(lines),
            "lines": lines,
            "due": order.delivery_date.isoformat() if order.delivery_date else None,
            "customer_name": order.customer_name,
        }

    @classmethod
    def _made_line(cls, item: SalesOrderItem) -> dict[str, Any]:
        geometry = item.geometry_snapshot if isinstance(item.geometry_snapshot, dict) else {}
        base = geometry.get("base") if isinstance(geometry.get("base"), dict) else geometry
        width = _num(base.get("width_mm") if isinstance(base, dict) else None)
        height = _num(base.get("height_mm") if isinstance(base, dict) else None)
        gusset = _num(geometry.get("gusset_mm") or (base.get("gusset_mm") if isinstance(base, dict) else None))
        fg_type = _text(geometry.get("fg_type"), geometry.get("finished_good_type"), "POUCH").upper()
        style = _text(geometry.get("pouch_style"), getattr(getattr(item, "template", None), "pouch_style", None))
        master = getattr(item, "product_master", None)
        product = _text(getattr(master, "name", None), item.line_name, getattr(getattr(item, "template", None), "name", None))

        size_bits = []
        if width and height:
            size_bits.append(f"{width:g} × {height:g}")
        elif width:
            size_bits.append(f"{width:g} mm")
        if gusset:
            size_bits.append(f"gusset {gusset:g}")
        qty = _fmt_qty(_num(item.qty_value), item.qty_uom)
        headline = " · ".join([qty, product, *size_bits]) if product else " · ".join([qty, *size_bits])

        layers = item.layer_snapshot if isinstance(item.layer_snapshot, list) else []
        layer_rows = []
        layer_bits = []
        gauge = 0.0
        grade_names = cls._grade_names(layers)
        films = {}
        bom = item.bom_snapshot if isinstance(item.bom_snapshot, dict) else {}
        for row in bom.get("films") or []:
            if isinstance(row, dict) and row.get("variant_id"):
                films[str(row["variant_id"])] = row
        for index, layer in enumerate(layers, start=1):
            if not isinstance(layer, dict):
                continue
            name = _text(layer.get("name"), layer.get("variant_name"), layer.get("variant_code"), layer.get("family_name"), "film")
            micron = _num(layer.get("thickness_micron") if layer.get("thickness_micron") is not None else layer.get("thickness"))
            grade = _text(layer.get("grade_name"), layer.get("grade"), grade_names.get(str(layer.get("grade_id") or "")))
            film_row = films.get(str(layer.get("variant_id") or ""), {})
            source = _text(film_row.get("source"), layer.get("source")).upper()
            gauge += micron
            label = f"{name} {micron:g} µ" if micron else name
            if grade:
                label += f" · {grade}"
            layer_bits.append(label)
            layer_rows.append({
                "index": index, "name": name, "micron": micron or None, "grade": grade, "source": source,
                "density": _num(layer.get("density_g_cm3") or layer.get("density")) or None,
                "width_mm": _num(layer.get("roll_width_mm") or layer.get("width_mm")) or None,
                "kg": round(_num(film_row.get("weight_kg")) * _num(item.qty_value), 3) if film_row.get("weight_kg") and str(item.qty_uom).upper() == "PCS" else None,
            })
        structure = " / ".join(layer_bits)
        if len(layer_bits) > 1 and gauge:
            structure += f" · {gauge:g} µ laminate"

        printing = item.printing_snapshot if isinstance(item.printing_snapshot, dict) else {}
        print_text = ""
        artwork_obj = getattr(item, "assigned_artwork", None)
        colours = 0
        artwork = ""
        if printing.get("enabled"):
            colours = int(_num(printing.get("front_colors_count")) + _num(printing.get("back_colors_count")))
            artwork = _text(getattr(artwork_obj, "design_code", None), printing.get("artwork_code"), printing.get("artwork_name"))
            print_text = "printed"
            if colours:
                print_text += f" · {colours} colour{'s' if colours != 1 else ''}"
            if artwork:
                print_text += f" · {artwork}"
        else:
            print_text = "plain"

        template = getattr(item, "template", None)
        rule = getattr(template, "routing_rule", None) if template is not None else None
        route = " → ".join(list(getattr(rule, "ordered_processes", None) or [])) if rule is not None else ""

        lanes = ""
        if item.preferred_lane_count:
            lanes = f"{item.preferred_lane_count} lane{'s' if item.preferred_lane_count != 1 else ''}"
            if item.planned_parent_width_mm:
                lanes += f" on {_num(item.planned_parent_width_mm):g} mm"

        return {
            "item_id": str(item.id),
            "headline": headline,
            "product": product,
            "fg_type": fg_type,
            "pouch_style": style,
            "size": " · ".join(size_bits),
            "width_mm": width or None,
            "height_mm": height or None,
            "gusset_mm": gusset or None,
            "layers": layer_rows,
            "gauge_micron": round(gauge, 2) if gauge else None,
            "colours": colours,
            "artwork": artwork,
            "print_method": _text(printing.get("method"), printing.get("type")).upper() if printing.get("enabled") else "",
            "qty": qty,
            "structure": structure,
            "print": print_text,
            "route": route,
            "lanes": lanes,
            "unit_weight_g": round(_num(item.unit_weight_g), 3) if item.unit_weight_g else None,
            "total_kg": round(_num(item.total_weight_kg), 3),
            "line_status": item.line_status,
        }
