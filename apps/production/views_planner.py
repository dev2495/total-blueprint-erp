from decimal import Decimal
from datetime import timedelta
from types import SimpleNamespace

from django.db import transaction
from django.db.models import Count, Max, Prefetch, Q, Sum
from django.core.exceptions import ObjectDoesNotExist, ValidationError
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.factory.models import Process, WorkCenter
from apps.inventory.models import InventoryBulk, InventoryRoll, PackagingStock
from apps.inventory.serializers import resolve_roll_role
from apps.physics.geometry_override import (
    normalize_geometry_override,
    sanitize_geometry_override,
)
from apps.physics.spec_signature import (
    build_spec_payload,
    build_spec_signature,
    build_invariant_payload,
    build_invariant_signature,
)
from apps.sales.models import SalesOrderItem, SalesOrder, SalesSkuVariant
from apps.sales.services.order_service import (
    SalesOrderService,
    _planned_issue_qty,
    _summarize_material_plan_lines,
    _addons_from_axis_values,
    _merge_axis_packaging_snapshot,
    _hydrate_pod_snapshot,
    _normalize_packaging_snapshot,
    _normalize_layer_snapshot,
    _normalize_printing_snapshot,
    _preserve_computed_geometry,
    _validate_printing_snapshot_for_confirm,
)
from apps.artwork.models import Artwork
from apps.artwork.compatibility import product_master_print_context
from apps.materials.models import InventoryMaterial, PodSkuVariant, ProductMaster
from apps.materials.product_spec import build_product_spec
from apps.materials.services_product_variant import (
    apply_layer_totals_to_geometry,
    canonical_axis_values,
    compute_geometry,
    compute_layers,
)
from apps.templates.models import TemplateBlueprint
from apps.templates.services import TemplateDispatchService, TemplateGovernanceService
from apps.bom.readiness import bom_readiness_errors
from apps.production.services.stock_validator import first_artwork_step_index, validate_planner_stop_step

from apps.physics.services_physics import PhysicsEngine
from apps.inventory.services.roll_naming import build_roll_naming_payload
from .models import FinishedGoodsBatch, InventoryAllocation, PlannedStockOrder, PlannedBulkStockOrder, ProductionJob, JobExecutionLog, PlannerSkuVariant
from .serializers import ProductionJobSerializer, ProductionJobSummarySerializer, PlannedBulkStockOrderSerializer
from .services.job_services import JobService


def _jsonify(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, dict):
        return {k: _jsonify(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_jsonify(v) for v in value]
    return value


def _sales_item_display_label(item, order=None, product_master=None, template=None):
    product_master = product_master or getattr(item, "product_master", None)
    product_variant = getattr(item, "product_variant", None)
    sku_variant = getattr(item, "sku_variant", None)
    overlay = getattr(item, "customer_product_overlay", None)
    order = order or getattr(item, "sales_order", None)
    try:
        spec = build_product_spec(
            geometry=getattr(item, "geometry_snapshot", None) if isinstance(getattr(item, "geometry_snapshot", None), dict) else {},
            layers=getattr(item, "layer_snapshot", None) if isinstance(getattr(item, "layer_snapshot", None), list) else [],
            printing=getattr(item, "printing_snapshot", None) if isinstance(getattr(item, "printing_snapshot", None), dict) else {},
            addons=getattr(item, "addons_snapshot", None) if isinstance(getattr(item, "addons_snapshot", None), list) else [],
            packaging=getattr(item, "packaging_snapshot", None) if isinstance(getattr(item, "packaging_snapshot", None), dict) else {},
            customer_name=str(getattr(order, "customer_name", "") or ""),
            order_number=str(getattr(order, "order_number", "") or ""),
            product_name=str(getattr(item, "line_name", "") or ""),
            template_name=str(getattr(template or getattr(item, "template", None), "name", "") or ""),
            variant_code=str(getattr(sku_variant, "code", "") or ""),
            variant_name=str(getattr(sku_variant, "name", "") or ""),
            product_master_code=str(getattr(product_master, "code", "") or ""),
            product_master_name=str(getattr(product_master, "name", "") or ""),
            product_variant_code=str(getattr(product_variant, "code", "") or ""),
            product_variant_name=str(getattr(product_variant, "code", "") or ""),
            customer_display_name=str(getattr(overlay, "customer_display_name", "") or ""),
            customer_item_code=str(getattr(overlay, "customer_item_code", "") or ""),
            axis_values=getattr(item, "axis_values", None) if isinstance(getattr(item, "axis_values", None), dict) else {},
            qty_value=getattr(item, "qty_value", None),
            qty_uom=str(getattr(item, "qty_uom", "") or ""),
        )
        label = str(spec.get("display_label") or spec.get("line_label") or "").strip()
        if label:
            return label
    except Exception:
        pass
    return str(
        getattr(item, "line_name", "")
        or getattr(product_master, "code", "")
        or getattr(product_master, "name", "")
        or getattr(template, "name", "")
        or ""
    ).strip()


def _ensure_axis_value(product_master, axis_values, *, names=(), types=(), value=None):
    if not product_master or value in (None, ""):
        return
    axes = product_master.variant_axes if isinstance(product_master.variant_axes, list) else []
    normalized_names = {str(name).strip() for name in names if str(name).strip()}
    normalized_types = {str(kind).strip() for kind in types if str(kind).strip()}
    for axis in axes:
        if not isinstance(axis, dict):
            continue
        key = str(axis.get("axis") or "").strip()
        axis_type = str(axis.get("type") or "").strip()
        if key and (key in normalized_names or axis_type in normalized_types):
            axis_values.setdefault(key, value)
            return


def _resolve_product_master_snapshots(product_master, axis_values, geometry_payload, layer_payload, *, force_master=False):
    axis_values = canonical_axis_values(axis_values if isinstance(axis_values, dict) else {})
    geometry = geometry_payload if isinstance(geometry_payload, dict) else None
    layers = layer_payload if isinstance(layer_payload, list) else None
    if not product_master:
        return geometry_payload, layer_payload
    if not force_master and not axis_values and geometry is not None and layers is not None:
        if isinstance(geometry, dict) and isinstance(layers, list):
            geometry = apply_layer_totals_to_geometry(geometry, layers)
        return geometry, layers
    if force_master or not geometry:
        geometry = compute_geometry(product_master, axis_values)
    else:
        computed = compute_geometry(product_master, axis_values)
        for key in ("axis_values", "roll_width_mm", "effective_width_mm", "effective_height_mm", "size_code", "size_label", "thickness_um"):
            if key in computed and key not in geometry:
                geometry[key] = computed[key]
    if force_master or not layers:
        layers = compute_layers(product_master, axis_values, geometry or {})
    if isinstance(geometry, dict) and isinstance(layers, list):
        geometry = apply_layer_totals_to_geometry(geometry, layers)
    return geometry, layers


def _numeric(value) -> Decimal:
    try:
        if value in (None, ""):
            return Decimal("0")
        return Decimal(str(value))
    except Exception:
        return Decimal("0")


def _bounded_int(value, *, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except Exception:
        return default
    return max(minimum, min(maximum, parsed))


def _geometry_roll_width_mm(geometry):
    if not isinstance(geometry, dict):
        return Decimal("0")
    direct = _numeric(
        geometry.get("wip_roll_width_mm")
        or geometry.get("planned_parent_width_mm")
        or geometry.get("child_target_width_mm")
        or geometry.get("stock_width_mm")
        or geometry.get("roll_width_mm")
        or geometry.get("input_roll_width_mm")
        or geometry.get("effective_width_mm")
    )
    if direct > 0:
        return direct
    base = geometry.get("base") if isinstance(geometry.get("base"), dict) else {}
    return _numeric(
        base.get("wip_roll_width_mm")
        or base.get("planned_parent_width_mm")
        or base.get("child_target_width_mm")
        or base.get("stock_width_mm")
        or base.get("roll_width_mm")
        or base.get("width_mm")
        or base.get("effective_width_mm")
    )


def _snapshot_max_roll_width_mm(geometry_snapshot, layer_snapshot) -> Decimal:
    max_width = _geometry_roll_width_mm(geometry_snapshot)
    layers = layer_snapshot if isinstance(layer_snapshot, list) else []
    for layer in layers:
        if not isinstance(layer, dict):
            continue
        width = _numeric(
            layer.get("wip_roll_width_mm")
            or layer.get("roll_width_mm")
            or layer.get("input_roll_width_mm")
            or layer.get("width_mm")
        )
        if width > max_width:
            max_width = width
    return max_width


def _parse_optional_positive_mm(payload, *keys):
    payload = payload if isinstance(payload, dict) else {}
    for key in keys:
        if key not in payload:
            continue
        raw = payload.get(key)
        if raw in (None, ""):
            return None, None
        try:
            value = Decimal(str(raw))
        except Exception:
            return None, f"{key} must be a positive number."
        if value <= 0:
            return None, f"{key} must be greater than 0."
        return value, None
    return None, None


def _apply_wip_roll_width_to_snapshots(geometry_snapshot, layer_snapshot, width_mm):
    width = _numeric(width_mm)
    if width <= 0:
        return geometry_snapshot, layer_snapshot

    width_float = float(width)
    geometry = dict(geometry_snapshot or {})
    for key in (
        "wip_roll_width_mm",
        "planned_parent_width_mm",
        "child_target_width_mm",
        "stock_width_mm",
        "roll_width_mm",
        "input_roll_width_mm",
    ):
        geometry[key] = width_float

    base = dict(geometry.get("base") or {}) if isinstance(geometry.get("base"), dict) else {}
    # Preserve final pouch W/H while making the roll target explicit for WCM allocation.
    base.setdefault("roll_width_mm", width_float)
    base.setdefault("child_target_width_mm", width_float)
    base.setdefault("stock_width_mm", width_float)
    geometry["base"] = base

    layers = []
    for layer in layer_snapshot if isinstance(layer_snapshot, list) else []:
        if not isinstance(layer, dict):
            layers.append(layer)
            continue
        next_layer = dict(layer)
        next_layer["wip_roll_width_mm"] = width_float
        next_layer["roll_width_mm"] = width_float
        next_layer["input_roll_width_mm"] = width_float
        layers.append(next_layer)
    return geometry, layers


def _job_layer_signature(job) -> str:
    try:
        meta = getattr(job, "meta_json", None) or {}
        sig = str(meta.get("layer_signature_hash") or "")
        if sig:
            return sig
        src_item = getattr(job, "sales_order_item", None)
        if src_item is not None:
            bs = getattr(src_item, "bom_snapshot", None) or {}
            if isinstance(bs, dict):
                sig = str(bs.get("layer_signature_hash") or "")
                if sig:
                    return sig
        mts = getattr(job, "mts_order", None)
        if mts is not None:
            bs = getattr(mts, "bom_snapshot", None) or {}
            if isinstance(bs, dict):
                sig = str(bs.get("layer_signature_hash") or "")
                if sig:
                    return sig
    except Exception:
        return ""
    return ""


def _job_product_master_meta(job) -> dict:
    product_master = None
    src_item = getattr(job, "sales_order_item", None)
    if src_item is not None:
        product_master = getattr(src_item, "product_master", None)
    if product_master is None:
        mts_order = getattr(job, "mts_order", None)
        if mts_order is not None:
            product_master = getattr(mts_order, "product_master", None)
    meta = getattr(job, "meta_json", None) or {}
    code = str(getattr(product_master, "code", "") or meta.get("product_master_code") or "").strip()
    name = str(getattr(product_master, "name", "") or meta.get("product_master_name") or "").strip()
    product_master_id = str(getattr(product_master, "id", "") or meta.get("product_master_id") or "").strip()
    return {
        "id": product_master_id,
        "code": code,
        "name": name,
        "label": f"{code} · {name}" if code and name and code.lower() not in name.lower() else (code or name or str(meta.get("product_master_label") or "").strip()),
    }


def _job_quantity_kg(job) -> float:
    qty = _numeric(getattr(job, "quantity", None))
    uom = str(getattr(job, "uom", "") or "").upper()
    if uom == "KG":
        return float(qty)
    unit_weight_g = Decimal("0")
    src_item = getattr(job, "sales_order_item", None)
    if src_item is not None:
        unit_weight_g = _numeric(getattr(src_item, "unit_weight_g", None))
    if unit_weight_g <= 0:
        mts_order = getattr(job, "mts_order", None)
        if mts_order is not None:
            unit_weight_g = _numeric(getattr(mts_order, "unit_weight_g", None))
    if uom in {"PCS", "PC", "PIECE", "PIECES"} and unit_weight_g > 0:
        return float((qty * unit_weight_g) / Decimal("1000"))
    return float(qty)


def _stock_pool_structure_reasons(product_master, geometry_snapshot, layer_snapshot, *, stock_purpose="PRODUCT", bom_by_step=None):
    if str(stock_purpose or "PRODUCT").upper() != "PRODUCT":
        return []
    if not product_master or not hasattr(product_master, "layer_template"):
        return []

    reasons = []
    master_layers = product_master.layer_template if isinstance(getattr(product_master, "layer_template", None), list) else []
    layers = layer_snapshot if isinstance(layer_snapshot, list) else []
    if not master_layers:
        reasons.append("Product Master has no layer template. Add film layers before launching product stock.")
    if not layers:
        reasons.append("Selected axes did not resolve any film layers. Pick a complete size/layer axis set.")

    total_thickness = Decimal("0")
    max_width = _geometry_roll_width_mm(geometry_snapshot)
    for idx, layer in enumerate(layers, start=1):
        if not isinstance(layer, dict):
            reasons.append(f"Layer {idx} is not a valid layer snapshot.")
            continue
        material_code = (
            layer.get("material_code")
            or layer.get("film_variant_code")
            or layer.get("base_material_code")
            or ""
        )
        if not str(material_code).strip():
            reasons.append(f"Layer {idx} has no film material selected.")
        thickness = _numeric(layer.get("thickness_micron") or layer.get("thickness_um"))
        width = _numeric(layer.get("roll_width_mm") or layer.get("input_roll_width_mm") or layer.get("width_mm"))
        total_thickness += thickness
        if width > max_width:
            max_width = width
        if thickness <= 0:
            reasons.append(f"Layer {idx} has zero thickness.")
        if width <= 0 and max_width <= 0:
            reasons.append(f"Layer {idx} has no roll width and the selected size has no roll-width fallback.")

    if layers and total_thickness <= 0:
        reasons.append("Total film thickness is zero, so consumption math cannot be computed.")
    if layers and max_width <= 0:
        reasons.append("Roll width is zero. Select a Product Master size or enter layer roll width.")

    if bom_by_step is not None:
        has_material = any(
            bool(mat.get("material_code")) and _numeric(mat.get("qty")) > 0
            for group in (bom_by_step or [])
            if isinstance(group, dict)
            for mat in (group.get("materials") or [])
            if isinstance(mat, dict)
        )
        if not has_material:
            reasons.append("No BOM lines resolved for the selected stop step. Check layer materials and route recipe mapping.")

    return list(dict.fromkeys(str(reason) for reason in reasons if str(reason or "").strip()))


class PlannerViewSet(viewsets.ViewSet):
    """
    Planner APIs.
    - Dashboard endpoints (summary only)
    - Control-hub endpoints (planning actions)
    """

    # ---------------------------------------------------------------------
    # Dashboard / Summary Endpoints (No Planner Actions)
    # ---------------------------------------------------------------------
    @action(detail=False, methods=["get"])
    def demand(self, request):
        """
        Sales demand summary for planner landing dashboard.
        """
        items = (
            SalesOrderItem.objects.select_related("sales_order", "template")
            .exclude(sales_order__status__in=["CANCELLED", "COMPLETED"])
            .all()
        )

        demand_data = []
        for item in items:
            jobs = ProductionJob.objects.filter(sales_order_item=item)
            total_produced = jobs.aggregate(Max("produced_qty"))["produced_qty__max"] or 0
            pending = (item.total_weight_kg or Decimal("0")) - Decimal(str(total_produced or 0))

            if pending <= 0 and item.sales_order.status in ["PACKING_READY", "DISPATCH_READY", "COMPLETED"]:
                continue

            demand_data.append(
                {
                    "so_number": item.sales_order.order_number,
                    "customer": item.sales_order.customer_name,
                    "template_id": str(item.template.id) if item.template else None,
                    "template_name": item.template.name if item.template else "Custom",
                    "ordered_qty": float(item.total_weight_kg or 0),
                    "produced_qty": float(total_produced or 0),
                    "pending_qty": float(max(Decimal("0"), pending)),
                    "due_date": item.sales_order.delivery_date,
                    "so_item_id": str(item.id),
                    "material_status": "OK",
                }
            )

        return Response(demand_data)

    @action(detail=False, methods=["get"])
    def stock(self, request):
        """
        Inventory summary by template + completed_step_index.
        """
        stock_summary = (
            InventoryRoll.objects.filter(status="AVAILABLE")
            .values("template__id", "template__name", "completed_step_index")
            .annotate(total_weight=Sum("weight_kg"), roll_count=Count("id"))
            .order_by("template__name", "completed_step_index")
        )
        return Response(stock_summary)

    @action(detail=False, methods=["get"])
    def capacity(self, request):
        """
        Capacity summary for planner dashboard.
        """
        wcs = WorkCenter.objects.all()
        capacity_data = []

        for wc in wcs:
            machine_count = wc.machines.count()
            running_jobs = ProductionJob.objects.filter(work_center=wc, job_state="EXECUTING").count()
            pending_jobs = ProductionJob.objects.filter(
                work_center=wc, job_state__in=["PLANNED", "RELEASED", "WAITING"]
            )
            total_load_kg = pending_jobs.aggregate(total=Sum("quantity"))["total"] or 0
            estimated_hours = float(total_load_kg) / 100.0
            utilization = (running_jobs / machine_count * 100) if machine_count > 0 else 0

            capacity_data.append(
                {
                    "wc_id": str(wc.id),
                    "wc_name": wc.name,
                    "machine_count": machine_count,
                    "running_jobs": running_jobs,
                    "free_slots": max(0, machine_count - running_jobs),
                    "utilization": round(utilization, 1),
                    "pending_load_hours": round(estimated_hours, 1),
                }
            )

        return Response(capacity_data)

    @action(detail=False, methods=["get"])
    def jobs(self, request):
        requested_states = [
            state.strip().upper()
            for state in str(request.query_params.get("states") or request.query_params.get("job_state") or "").split(",")
            if state.strip()
        ]
        backlog_states = requested_states or ["PLANNED", "RELEASED", "WAITING", "EXECUTING", "PAUSED", "COMPLETED"]
        limit = _bounded_int(request.query_params.get("limit"), default=160, minimum=1, maximum=300)
        summary = str(request.query_params.get("summary", "0")).lower() in {"1", "true", "yes", "summary"}
        jobs = (
            ProductionJob.objects.filter(job_state__in=backlog_states)
            .select_related(
                "template",
                "current_process",
                "process",
                "work_center",
                "machine",
                "operator",
                "sales_order_item__sales_order",
                "sales_order_item__template",
                "sales_order_item__product_master",
                "mts_order",
            )
            .order_by("-updated_at")[:limit]
        )
        serializer_class = ProductionJobSummarySerializer if summary else ProductionJobSerializer
        serializer = serializer_class(jobs, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=["get"], url_path="live-summary")
    def live_summary(self, request):
        """
        Exact live-production aggregates for the Control Tower.

        The UI still loads a bounded job sample for cards/rails, but the headline
        numbers must be DB-wide so users do not see stale or capped counts.
        """
        params = getattr(request, "query_params", None) or getattr(request, "GET", {})
        active_states = ["PLANNED", "RELEASED", "WAITING", "EXECUTING", "PAUSED"]
        now = timezone.now()
        closed_cutoff = now - timedelta(hours=24)

        state_counts = {
            str(row["job_state"] or "UNKNOWN").upper(): int(row["count"] or 0)
            for row in ProductionJob.objects.values("job_state").annotate(count=Count("id"))
        }
        active_qs = ProductionJob.objects.filter(job_state__in=active_states)
        completed_24h_qs = ProductionJob.objects.filter(job_state__in=["COMPLETED", "DONE"]).filter(
            Q(closed_at__gte=closed_cutoff) | Q(closed_at__isnull=True, updated_at__gte=closed_cutoff)
        )
        source_rows = (
            active_qs.values("source_type", "origin")
            .annotate(count=Count("id"), quantity=Sum("quantity"), produced=Sum("produced_qty"))
            .order_by()
        )

        def _state_count(*states):
            return sum(int(state_counts.get(str(state).upper(), 0)) for state in states)

        active_kg = active_qs.aggregate(total=Sum("quantity"))["total"] or Decimal("0")
        return Response(
            {
                "generated_at": now.isoformat(),
                "state_counts": state_counts,
                "kpis": {
                    "executing_count": _state_count("EXECUTING"),
                    "released_count": _state_count("RELEASED"),
                    "waiting_count": _state_count("WAITING"),
                    "paused_count": _state_count("PAUSED"),
                    "planned_count": _state_count("PLANNED"),
                    "total_in_flight": _state_count(*active_states),
                    "active_kg": float(active_kg),
                    "closed_24h": completed_24h_qs.count(),
                    "variance_count": ProductionJob.objects.filter(
                        Q(job_state__in=active_states) | Q(job_state__in=["COMPLETED", "DONE"], closed_at__gte=closed_cutoff),
                        closed_with_variance=True,
                    ).count(),
                },
                "source_mix": [
                    {
                        "source_type": row.get("source_type") or "",
                        "origin": row.get("origin") or "",
                        "count": int(row.get("count") or 0),
                        "quantity": float(row.get("quantity") or 0),
                        "produced": float(row.get("produced") or 0),
                    }
                    for row in source_rows
                ],
                "params": {
                    "sample_limit": _bounded_int(params.get("limit"), default=160, minimum=1, maximum=300),
                },
            }
        )

    @action(detail=False, methods=["get"], url_path="completed-job-trace")
    def completed_job_trace(self, request):
        """
        Paginated completed-job ledger for Completed Trace.

        This intentionally bypasses Control Hub's order-history sampling. A
        completed trace page is an execution audit ledger, so every completed
        ProductionJob in the selected window must be discoverable.
        """
        params = getattr(request, "query_params", None) or getattr(request, "GET", {})
        limit = _bounded_int(params.get("limit"), default=50, minimum=1, maximum=200)
        offset = _bounded_int(params.get("offset"), default=0, minimum=0, maximum=100000)
        days = _bounded_int(params.get("days"), default=90, minimum=1, maximum=3650)
        query = str(params.get("q") or "").strip()
        source = str(params.get("source") or "").strip().upper()
        order_kind = str(params.get("order_kind") or "").strip().upper()
        customer = str(params.get("customer") or "").strip()

        cutoff = timezone.now() - timedelta(days=days)
        qs = (
            ProductionJob.objects.filter(job_state__in=["COMPLETED", "DONE"])
            .filter(Q(closed_at__gte=cutoff) | Q(closed_at__isnull=True, updated_at__gte=cutoff))
            .select_related(
                "template",
                "work_center",
                "machine",
                "operator",
                "closed_by",
                "current_process",
                "process",
                "sales_order_item__sales_order",
                "sales_order_item__template",
                "sales_order_item__product_master",
                "mts_order",
                "mts_order__template",
                "mts_order__product_master",
            )
        )
        if order_kind == "SALES":
            qs = qs.filter(sales_order_item__isnull=False)
        elif order_kind in {"STOCK", "MTS"}:
            qs = qs.filter(sales_order_item__isnull=True, mts_order__isnull=False)
        if source and source != "ALL":
            if source == "FG":
                qs = qs.filter(Q(source_type__icontains="FG") | Q(origin__icontains="FG"))
            elif source == "WIP":
                qs = qs.filter(
                    Q(source_type__icontains="WIP")
                    | Q(origin__icontains="WIP")
                    | Q(origin__icontains="STOCK")
                    | Q(origin__icontains="MTS")
                )
            elif source == "FRESH":
                qs = qs.filter(
                    Q(source_type__icontains="FRESH")
                    | Q(origin__icontains="FRESH")
                    | (Q(source_type__isnull=True) | Q(source_type="")) & (Q(origin__isnull=True) | Q(origin=""))
                )
            else:
                qs = qs.filter(Q(source_type__iexact=source) | Q(origin__iexact=source))
        if customer:
            qs = qs.filter(sales_order_item__sales_order__customer_name__iexact=customer)
        if query:
            qs = qs.filter(
                Q(job_number__icontains=query)
                | Q(sales_order_item__sales_order__order_number__icontains=query)
                | Q(sales_order_item__sales_order__customer_name__icontains=query)
                | Q(sales_order_item__template__name__icontains=query)
                | Q(sales_order_item__product_master__name__icontains=query)
                | Q(mts_order__order_number__icontains=query)
                | Q(mts_order__template__name__icontains=query)
                | Q(mts_order__product_master__name__icontains=query)
                | Q(template__name__icontains=query)
            )

        total_count = qs.count()
        completed_sales_orders = (
            qs.filter(sales_order_item__sales_order_id__isnull=False)
            .values("sales_order_item__sales_order_id")
            .distinct()
            .count()
        )
        completed_stock_orders = qs.filter(mts_order_id__isnull=False).values("mts_order_id").distinct().count()
        aggregates = qs.aggregate(
            planned_qty=Sum("quantity"),
            produced_qty=Sum("produced_qty"),
            remaining_qty=Sum("remaining_qty"),
            variance_qty=Sum("completion_variance_kg"),
            variance_jobs=Count("id", filter=Q(closed_with_variance=True)),
        )
        jobs = list(qs.order_by("-closed_at", "-updated_at", "-created_at")[offset: offset + limit])

        rows = []
        for job in jobs:
            row = self._serialize_completed_job_trace(job)
            completed_job_payload = dict(row)
            sales_item = getattr(job, "sales_order_item", None)
            sales_order = getattr(sales_item, "sales_order", None) if sales_item else None
            mts_order = getattr(job, "mts_order", None)
            source_kind = "sales" if sales_order else "stock"
            parent_order = sales_order or mts_order
            template = getattr(job, "template", None) or getattr(sales_item, "template", None) or getattr(mts_order, "template", None)
            product_master = getattr(sales_item, "product_master", None) or getattr(mts_order, "product_master", None)
            closed_at = row.get("closed_at")
            placed_at = getattr(parent_order, "created_at", None) or getattr(job, "created_at", None)
            display_name = (
                str(getattr(product_master, "name", "") or "").strip()
                or str(getattr(template, "name", "") or "").strip()
                or str(getattr(job, "product_name", "") or "").strip()
                or "Production job"
            )
            row.update(
                {
                    "job_id": str(job.id),
                    "order_kind": source_kind,
                    "order_id": str(getattr(parent_order, "id", "") or job.id),
                    "sales_order_item_id": str(getattr(sales_item, "id", "") or ""),
                    "order_number": str(getattr(parent_order, "order_number", "") or getattr(job, "job_number", "") or ""),
                    "customer_name": str(getattr(sales_order, "customer_name", "") or ("Internal stock" if mts_order else "")),
                    "display_name": display_name,
                    "template_id": str(getattr(template, "id", "") or ""),
                    "template_name": str(getattr(template, "name", "") or display_name),
                    "product_master_id": str(getattr(product_master, "id", "") or ""),
                    "product_master_name": str(getattr(product_master, "name", "") or ""),
                    "fg_type": str(getattr(template, "fg_type", "") or ""),
                    "final_product_type": str(getattr(template, "fg_type", "") or ""),
                    "required_qty_kg": float(getattr(job, "produced_qty", 0) or getattr(job, "quantity", 0) or 0),
                    "qty_uom": str(getattr(job, "uom", "") or "KG").upper(),
                    "status": str(getattr(parent_order, "status", "") or "COMPLETED"),
                    "parent_status": str(getattr(parent_order, "status", "") or ""),
                    "created_at": placed_at.isoformat() if getattr(placed_at, "isoformat", None) else None,
                    "completed_at": closed_at,
                    "closed_with_variance": bool(getattr(job, "closed_with_variance", False)),
                    "delivery_date": (
                        sales_order.delivery_date.isoformat()
                        if getattr(sales_order, "delivery_date", None)
                        else None
                    ),
                    "source_path": str(getattr(job, "source_type", "") or getattr(job, "origin", "") or source_kind).upper(),
                    "source_availability": {
                        "has_fg": False,
                        "has_wip": str(getattr(job, "origin", "") or "").upper() in {"STOCK", "MTS"},
                    },
                    "order_fact_sheet": {
                        "display_name": display_name,
                        "profile_label": str(getattr(job, "job_number", "") or ""),
                    },
                    "completed_jobs": [completed_job_payload],
                    "job_numbers": [str(getattr(job, "job_number", "") or "")],
                }
            )
            rows.append(row)

        return Response(
            {
                "results": rows,
                "count": total_count,
                "limit": limit,
                "offset": offset,
                "next_offset": offset + len(rows),
                "has_more": total_count > offset + len(rows),
                "kpis": {
                    "completed_jobs": total_count,
                    "completed_orders": completed_sales_orders + completed_stock_orders,
                    "planned_qty": float(aggregates.get("planned_qty") or 0),
                    "produced_qty": float(aggregates.get("produced_qty") or 0),
                    "remaining_qty": float(aggregates.get("remaining_qty") or 0),
                    "variance_qty": float(aggregates.get("variance_qty") or 0),
                    "variance_jobs": int(aggregates.get("variance_jobs") or 0),
                    "in_flight_jobs": ProductionJob.objects.filter(job_state__in=["PLANNED", "RELEASED", "WAITING", "EXECUTING", "PAUSED"]).count(),
                    "days": days,
                },
            }
        )

    # ---------------------------------------------------------------------
    # Planner Actions (legacy job actions kept)
    # ---------------------------------------------------------------------
    @action(detail=True, methods=["post"])
    def release(self, request, pk=None):
        try:
            job = JobService.release_job(pk)
            return Response({"status": "released", "job_id": str(job.id)})
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["post"])
    def hold(self, request, pk=None):
        reason = request.data.get("reason", "Planner Hold")
        try:
            job = JobService.toggle_hold(pk, reason)
            return Response({"status": "held" if job.is_on_hold else "resumed", "is_on_hold": job.is_on_hold})
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["post"])
    def split(self, request, pk=None):
        qty = request.data.get("qty")
        if not qty:
            return Response({"error": "qty is required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            job, child = JobService.split_job(pk, qty)
            return Response(
                {
                    "status": "split",
                    "original_job_id": str(job.id),
                    "child_job_id": str(child.id),
                    "child_job_number": child.job_number,
                }
            )
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["post"])
    def reprioritize(self, request, pk=None):
        priority = request.data.get("priority")
        if priority is None:
            return Response({"error": "priority is required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            job = JobService.reprioritize_job(pk, priority)
            return Response({"status": "updated", "priority": job.priority})
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=["get"], url_path="gang-candidates")
    def gang_candidates(self, request):
        """
        Group open production jobs by layer_signature_hash to surface ganging
        candidates — jobs that could share a single jumbo roll if combined.

        Returns: {groups: [{layer_signature_hash, jobs: [...], total_qty, eligible_for_ganging}]}
        """
        from collections import defaultdict

        open_states = ["PLANNED", "WAITING", "RELEASED", "QUEUED"]
        scan_limit = _bounded_int(request.query_params.get("scan_limit"), default=160, minimum=20, maximum=300)
        group_limit = _bounded_int(request.query_params.get("limit"), default=60, minimum=5, maximum=120)
        jobs = list(
            ProductionJob.objects.filter(job_state__in=open_states)
            .exclude(status__in=["COMPLETED", "CANCELLED"])
            .select_related("template", "production_batch", "sales_order_item__sales_order", "sales_order_item__product_master", "mts_order", "mts_order__product_master", "current_process")
            .order_by("-created_at")[:scan_limit]
        )

        groups_map = defaultdict(list)
        for j in jobs:
            sig = _job_layer_signature(j)
            if not sig:
                continue
            pm_meta = _job_product_master_meta(j)
            step_index = int(getattr(j, "current_step_index", 0) or 0)
            process_code = str(getattr(getattr(j, "current_process", None), "code", "") or "")
            process_id = str(getattr(j, "current_process_id", "") or "")
            groups_map[(sig, pm_meta.get("id") or "", step_index, process_id or process_code)].append(j)

        groups_payload = []
        for (sig, product_master_id, step_index, process_key), job_list in groups_map.items():
            if len(job_list) < 1:
                continue
            jobs_meta = []
            total_qty = 0.0
            product_master_ids = set()
            output_forms = set()
            for j in job_list:
                soi = getattr(j, "sales_order_item", None)
                so = getattr(soi, "sales_order", None) if soi else None
                cust = getattr(so, "customer", None) if so else None
                target_width = self._gang_candidate_target_width_mm(j)
                pm_meta = _job_product_master_meta(j)
                product_master_ids.add(str(pm_meta.get("id") or ""))
                output_forms.add(str(getattr(j, "output_form", "") or "").upper())
                jobs_meta.append({
                    "job_id": str(j.id),
                    "job_number": j.job_number,
                    "job_state": j.job_state,
                    "quantity": float(j.quantity or 0),
                    "quantity_kg": _job_quantity_kg(j),
                    "remaining_qty": float(j.remaining_qty or 0),
                    "uom": j.uom,
                    "target_width_mm": float(target_width) if target_width > 0 else 0.0,
                    "process_name": getattr(j.current_process, "name", "") if j.current_process_id else "",
                    "process_code": getattr(j.current_process, "code", "") if j.current_process_id else "",
                    "step_index": int(j.current_step_index or 0),
                    "input_form": str(getattr(j, "input_form", "") or ""),
                    "output_form": str(getattr(j, "output_form", "") or ""),
                    "product_master_id": str(pm_meta.get("id") or ""),
                    "product_master_code": str(pm_meta.get("code") or ""),
                    "product_master_name": str(pm_meta.get("name") or ""),
                    "product_master_label": str(pm_meta.get("label") or ""),
                    "template_name": j.template.name if j.template_id else "",
                    "sales_order_number": getattr(so, "order_number", "") if so else "",
                    "customer_name": getattr(cust, "name", "") if cust else "",
                    "origin": j.origin,
                    "is_generic_stock": bool(((getattr(j, "meta_json", None) or {}).get("is_generic_stock"))),
                })
                total_qty += _job_quantity_kg(j)
            process_code = str(jobs_meta[0].get("process_code") or process_key or "") if jobs_meta else ""
            product_master_labels = sorted({str(row.get("product_master_label") or "").strip() for row in jobs_meta if str(row.get("product_master_label") or "").strip()})
            missing_widths = [row for row in jobs_meta if (row.get("target_width_mm") or 0) <= 0]
            eligibility_reasons = []
            if len(jobs_meta) < 2:
                eligibility_reasons.append("Need at least 2 open orders.")
            if len({value for value in product_master_ids if value}) != 1:
                eligibility_reasons.append("Orders must share one Product Master.")
            if not product_master_id:
                eligibility_reasons.append("Product Master is missing on one or more jobs.")
            if missing_widths:
                eligibility_reasons.append("Target roll width is missing.")
            if any(form != "ROLL" for form in output_forms):
                eligibility_reasons.append("Current step must create roll output for jumbo slitting.")
            eligible = not eligibility_reasons
            groups_payload.append({
                "group_key": f"{sig}:{product_master_id}:{step_index}:{process_key}",
                "layer_signature_hash": sig,
                "product_master_id": str(product_master_id or ""),
                "product_master_code": str(jobs_meta[0].get("product_master_code") or "") if jobs_meta else "",
                "product_master_name": str(jobs_meta[0].get("product_master_name") or "") if jobs_meta else "",
                "product_master_label": product_master_labels[0] if len(product_master_labels) == 1 else "",
                "step_index": int(step_index or 0),
                "process_code": process_code,
                "output_form": sorted(output_forms)[0] if len(output_forms) == 1 else "",
                "jobs": jobs_meta,
                "job_count": len(jobs_meta),
                "total_qty_kg": total_qty,
                "eligible_for_ganging": eligible,
                "eligibility_reasons": eligibility_reasons,
            })

        groups_payload.sort(key=lambda g: (-int(g["eligible_for_ganging"]), -g["job_count"], -g["total_qty_kg"]))
        total_groups = len(groups_payload)
        return Response({
            "groups": groups_payload[:group_limit],
            "total_groups": total_groups,
            "scan_limit": scan_limit,
        })

    def _gang_candidate_target_width_mm(self, job):
        direct_sources = []
        snapshot_sources = []
        soi = getattr(job, "sales_order_item", None)
        if soi:
            direct_sources.append(getattr(soi, "planned_parent_width_mm", None))
            snapshot_sources.append((getattr(soi, "geometry_snapshot", None) or {}, getattr(soi, "layer_snapshot", None) or []))
        mts_order = getattr(job, "mts_order", None)
        if mts_order:
            direct_sources.append((getattr(mts_order, "planner_origin_meta", None) or {}).get("wip_roll_width_mm"))
            snapshot_sources.append((getattr(mts_order, "geometry_snapshot", None) or {}, getattr(mts_order, "layer_snapshot", None) or []))
        snapshot_sources.append((getattr(job, "meta_json", None) or {}, []))

        for source in direct_sources:
            width = _numeric(source)
            if width > 0:
                return width

        for geometry_snapshot, layer_snapshot in snapshot_sources:
            width = _snapshot_max_roll_width_mm(geometry_snapshot, layer_snapshot)
            if width > 0:
                return width
        return Decimal("0")

    @action(detail=False, methods=["post"], url_path="commit-gang")
    def commit_gang(self, request):
        """
        Mark the selected jobs as part of a ganged batch by stamping a shared
        gang_group_id on their meta_json. This is the lightweight commitment —
        actual roll-level slit happens at WCM time via allocate-with-slit/.
        """
        import uuid as _uuid
        job_ids = request.data.get("job_ids") or []
        layer_sig = str(request.data.get("layer_signature_hash") or "").strip()
        if not job_ids or not isinstance(job_ids, list):
            return Response({"error": "job_ids list required"}, status=status.HTTP_400_BAD_REQUEST)
        unique_ids = list(dict.fromkeys(str(jid) for jid in job_ids if str(jid or "").strip()))
        if len(unique_ids) < 2:
            return Response({"error": "Select at least 2 jobs to commit a gang."}, status=status.HTTP_400_BAD_REQUEST)
        open_states = ["PLANNED", "WAITING", "RELEASED", "QUEUED"]
        jobs = list(
            ProductionJob.objects.filter(id__in=unique_ids, job_state__in=open_states)
            .exclude(status__in=["COMPLETED", "CANCELLED"])
            .select_related("current_process", "sales_order_item__sales_order", "sales_order_item__product_master", "mts_order", "mts_order__product_master")
        )
        if len(jobs) != len(unique_ids):
            found = {str(j.id) for j in jobs}
            missing = [jid for jid in unique_ids if jid not in found]
            return Response(
                {"error": "Some selected jobs are not open or do not exist.", "missing_job_ids": missing},
                status=status.HTTP_400_BAD_REQUEST,
            )
        resolved_sigs = {_job_layer_signature(j) for j in jobs}
        resolved_sigs.discard("")
        if len(resolved_sigs) != 1:
            return Response(
                {"error": "Selected jobs must have one shared layer signature.", "layer_signatures": sorted(resolved_sigs)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        resolved_sig = next(iter(resolved_sigs))
        if layer_sig and layer_sig != resolved_sig:
            return Response(
                {"error": "Selected jobs do not match the requested layer signature."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        layer_sig = resolved_sig
        route_keys = {(int(j.current_step_index or 0), str(j.current_process_id or "")) for j in jobs}
        if len(route_keys) != 1:
            return Response(
                {"error": "Selected jobs must be at the same route step and process before they can share one jumbo."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        product_master_ids = {str(_job_product_master_meta(j).get("id") or "") for j in jobs}
        product_master_ids.discard("")
        if len(product_master_ids) != 1:
            return Response(
                {"error": "Selected jobs must use the same Product Master before they can share one jumbo.", "product_master_ids": sorted(product_master_ids)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        not_roll_output = [str(j.job_number) for j in jobs if str(getattr(j, "output_form", "") or "").upper() != "ROLL"]
        if not_roll_output:
            return Response(
                {"error": "Selected jobs must be at a roll-output step before they can share one jumbo.", "job_numbers": not_roll_output},
                status=status.HTTP_400_BAD_REQUEST,
            )
        missing_width_jobs = [str(j.job_number) for j in jobs if self._gang_candidate_target_width_mm(j) <= 0]
        if missing_width_jobs:
            return Response(
                {"error": "Selected jobs need target roll width before they can share one jumbo.", "job_numbers": missing_width_jobs},
                status=status.HTTP_400_BAD_REQUEST,
            )
        gang_id = str(_uuid.uuid4())[:8]
        affected = 0
        with transaction.atomic():
            for j in jobs:
                meta = dict(j.meta_json or {})
                meta["layer_signature_hash"] = layer_sig
                meta["gang_group_id"] = gang_id
                meta["gang_layer_sig"] = layer_sig
                meta["gang_committed_at"] = timezone.now().isoformat()
                if getattr(request, "user", None) and getattr(request.user, "is_authenticated", False):
                    meta["gang_committed_by"] = str(request.user.id)
                j.meta_json = meta
                j.save(update_fields=["meta_json"])
                affected += 1
        return Response({"gang_group_id": gang_id, "affected_jobs": affected})

    @action(detail=False, methods=["post"], url_path="stock-pools/validate")
    def validate_stock_pool(self, request):
        template_id = request.data.get("template_id") or request.data.get("template")
        product_master_id = request.data.get("product_master") or request.data.get("product_master_id")
        template = None
        product_master = None

        try:
            if product_master_id:
                product_master = ProductMaster.objects.select_related("template", "default_template").get(
                    id=product_master_id,
                    active=True,
                    is_current_version=True,
                )
            if template_id:
                template = TemplateBlueprint.objects.select_related("routing_rule").get(id=template_id)
            elif product_master:
                template = product_master.template or product_master.default_template
        except (TemplateBlueprint.DoesNotExist, ProductMaster.DoesNotExist):
            return Response({"error": "Invalid template_id or product_master."}, status=status.HTTP_400_BAD_REQUEST)

        if not template:
            return Response({"error": "template_id or product_master is required."}, status=status.HTTP_400_BAD_REQUEST)
        if not TemplateGovernanceService.is_current_live_template(template):
            return Response({"error": "Template must be the current LIVE version."}, status=status.HTTP_400_BAD_REQUEST)
        if not getattr(template, "routing_rule", None):
            return Response({"error": "Template has no routing rule."}, status=status.HTTP_400_BAD_REQUEST)

        route_last = self._route_last_index(template)
        raw_stop = request.data.get("stop_step_index")
        try:
            stop_step_index = route_last if raw_stop in (None, "") else int(raw_stop)
        except Exception:
            return Response({"error": "stop_step_index must be an integer."}, status=status.HTTP_400_BAD_REQUEST)
        if stop_step_index < 0 or stop_step_index > route_last:
            return Response(
                {"error": f"stop_step_index must be between 0 and {route_last}."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        commitment_scope = str(request.data.get("commitment_scope") or "GENERIC").upper()
        committed_customer = request.data.get("committed_customer") or request.data.get("committed_customer_id")
        committed_artwork = request.data.get("committed_artwork") or request.data.get("committed_artwork_id")
        stock_purpose = str(request.data.get("stock_purpose") or "PRODUCT").strip().upper()
        launcher_mode = str(request.data.get("launcher_mode") or "").strip().upper()
        pod_sku_variant_ref = (
            request.data.get("pod_sku_variant_id")
            or request.data.get("pod_sku_variant")
        )
        product_kind = str(getattr(product_master, "product_kind", "") or "").upper()
        if product_kind == "POD" and launcher_mode != "POD_STOCK" and not pod_sku_variant_ref:
            reason = "Select the linked POD output SKU before validating a POD Product Master stock launch."
            return Response({"valid": False, "error": reason, "reasons": [reason], "blockers": [reason]})
        if stock_purpose == "PACKAGING" or stock_purpose == "POD" or launcher_mode == "POD_STOCK":
            result = SimpleNamespace(
                first_artwork_step_index=first_artwork_step_index(template),
                message=(
                    "Valid POD stock route."
                    if stock_purpose == "POD" or launcher_mode == "POD_STOCK"
                    else "Valid packaging stock route."
                ),
            )
        else:
            try:
                result = validate_planner_stop_step(
                    template=template,
                    stop_step_index=stop_step_index,
                    commitment_scope=commitment_scope,
                    committed_artwork=committed_artwork,
                    committed_customer=committed_customer,
                )
            except ValidationError as exc:
                detail = getattr(exc, "message_dict", None) or getattr(exc, "messages", None) or str(exc)
                return Response({"valid": False, "error": detail, "detail": detail, "reasons": detail if isinstance(detail, list) else [str(detail)]})

        response_payload = {
            "valid": True,
            "first_artwork_step_index": result.first_artwork_step_index,
            "message": result.message,
            "route_last_step_index": route_last,
        }

        if product_master:
            try:
                axis_values = canonical_axis_values(request.data.get("axis_values") if isinstance(request.data.get("axis_values"), dict) else {})
                packaging_material_ref = (
                    request.data.get("packaging_material_id")
                    or request.data.get("packaging_material")
                )

                if stock_purpose == "PACKAGING" and not packaging_material_ref:
                    reason = "Select the linked packaging output SKU before validating a packaging Product Master."
                    return Response({"valid": False, "error": reason, "reasons": [reason], "blockers": [reason]})

                if stock_purpose == "PACKAGING" and packaging_material_ref:
                    packaging_material = None
                    try:
                        packaging_material = InventoryMaterial.objects.get(
                            id=packaging_material_ref,
                            category="PACKAGING",
                        )
                    except Exception:
                        packaging_material = InventoryMaterial.objects.filter(
                            code__iexact=str(packaging_material_ref),
                            category="PACKAGING",
                        ).first()
                    if not packaging_material:
                        return Response(
                            {"valid": False, "error": "Invalid packaging_material_id."},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    _ensure_axis_value(
                        product_master,
                        axis_values,
                        names=("packaging_inner", "packaging_outer", "packaging", "packaging_ref"),
                        types=("catalog_ref", "packaging_ref"),
                        value=str(packaging_material.code or ""),
                    )

                if launcher_mode == "POD_STOCK" and not pod_sku_variant_ref:
                    reason = "Select the linked POD output SKU before validating a POD stock launch."
                    return Response({"valid": False, "error": reason, "reasons": [reason], "blockers": [reason]})

                if launcher_mode == "POD_STOCK" or pod_sku_variant_ref:
                    pod_variant = None
                    try:
                        pod_variant = PodSkuVariant.objects.select_related("pod_sku", "material").get(
                            id=pod_sku_variant_ref,
                            active=True,
                        )
                    except Exception:
                        pod_variant = PodSkuVariant.objects.select_related("pod_sku", "material").filter(
                            code__iexact=str(pod_sku_variant_ref),
                            active=True,
                        ).first()
                    if not pod_variant:
                        return Response(
                            {"valid": False, "error": "Invalid pod_sku_variant_id."},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    _ensure_axis_value(
                        product_master,
                        axis_values,
                        names=("pod_variant", "pod", "pod_ref"),
                        types=("catalog_ref", "pod_ref"),
                        value=str(pod_variant.code or pod_variant.pod_sku.code or ""),
                    )

                geometry_payload = (
                    request.data.get("geometry_snapshot")
                    or request.data.get("geometry")
                    or request.data.get("geometry_override")
                )
                layer_payload = (
                    request.data.get("layer_snapshot")
                    or request.data.get("film_layers")
                    or request.data.get("layers")
                )
                geometry_snapshot, layer_snapshot = _resolve_product_master_snapshots(
                    product_master,
                    axis_values,
                    geometry_payload if isinstance(geometry_payload, dict) else None,
                    layer_payload if isinstance(layer_payload, list) else None,
                )
                requested_wip_width, wip_width_error = _parse_optional_positive_mm(
                    request.data,
                    "wip_roll_width_mm",
                    "target_roll_width_mm",
                    "planned_parent_width_mm",
                )
                if wip_width_error:
                    return Response(
                        {"valid": False, "error": wip_width_error, "reasons": [wip_width_error], "blockers": [wip_width_error]},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                if stock_purpose == "PRODUCT" and stop_step_index < route_last:
                    effective_wip_width = requested_wip_width or _snapshot_max_roll_width_mm(
                        geometry_snapshot or {},
                        layer_snapshot or [],
                    )
                    if effective_wip_width <= 0:
                        reason = "WIP roll width is required for a stopped-route stock pool."
                        return Response({"valid": False, "error": reason, "reasons": [reason], "blockers": [reason]})
                    geometry_snapshot, layer_snapshot = _apply_wip_roll_width_to_snapshots(
                        geometry_snapshot or {},
                        layer_snapshot or [],
                        effective_wip_width,
                    )
                structure_reasons = _stock_pool_structure_reasons(
                    product_master,
                    geometry_snapshot or {},
                    layer_snapshot or [],
                    stock_purpose=stock_purpose,
                )

                printing_snapshot = _normalize_printing_snapshot(
                    request.data.get("printing_snapshot")
                    if isinstance(request.data.get("printing_snapshot"), dict)
                    else request.data.get("printing")
                    if isinstance(request.data.get("printing"), dict)
                    else {}
                )
                addons_snapshot = request.data.get("addons_snapshot") or request.data.get("addons") or _addons_from_axis_values(axis_values)
                addons_snapshot = addons_snapshot if isinstance(addons_snapshot, list) else []
                packaging_snapshot = _merge_axis_packaging_snapshot(
                    request.data.get("packaging_snapshot")
                    if isinstance(request.data.get("packaging_snapshot"), dict)
                    else request.data.get("packaging")
                    if isinstance(request.data.get("packaging"), dict)
                    else {},
                    axis_values,
                )
                normalized_packaging_snapshot = _normalize_packaging_snapshot(packaging_snapshot or {})

                fixed = product_master.fixed_attributes if isinstance(product_master.fixed_attributes, dict) else {}
                fg_type = str(
                    (geometry_snapshot or {}).get("finished_good_type")
                    or template.fg_type
                    or fixed.get("fg_type")
                    or ("ROLL" if product_master.product_kind in {"ROLL", "PACKAGING", "POD"} else "POUCH")
                ).upper()
                if fg_type not in {"POUCH", "ROLL"}:
                    fg_type = "ROLL" if product_master.product_kind in {"ROLL", "PACKAGING", "POD"} else "POUCH"
                if fg_type == "ROLL":
                    normalized_packaging_snapshot["pod"] = {"enabled": False, "pod_profile_id": None, "pod_sku_variant_id": None}
                else:
                    normalized_packaging_snapshot["pod"] = _hydrate_pod_snapshot(normalized_packaging_snapshot.get("pod") or {})

                raw_qty = request.data.get("quantity") or request.data.get("target_qty") or 1
                try:
                    preview_qty = Decimal(str(raw_qty))
                    if preview_qty <= 0:
                        preview_qty = Decimal("1")
                except Exception:
                    preview_qty = Decimal("1")
                quantity_uom = str(request.data.get("quantity_uom") or request.data.get("uom") or "KG").upper()
                if fg_type == "ROLL":
                    quantity_uom = "KG"

                preview = SalesOrderService.preview_sales_item(
                    {
                        "finished_good_type": fg_type,
                        "geometry": geometry_snapshot or {},
                        "film_layers": layer_snapshot or [],
                        "printing": printing_snapshot,
                        "chemicals": printing_snapshot.get("chemicals") or {},
                        "addons": addons_snapshot,
                        "packaging_snapshot": normalized_packaging_snapshot,
                        "packaging": normalized_packaging_snapshot,
                        "roll_form": (geometry_snapshot or {}).get("roll_form"),
                        "order_qty": float(preview_qty),
                        "uom": quantity_uom,
                    }
                )
                bom_snapshot = preview.get("bom") or {}
                planning_lines = bom_snapshot.get("planning_lines") if isinstance(bom_snapshot, dict) else []
                bom_by_step = []
                by_key = {}
                for row in planning_lines or []:
                    if not isinstance(row, dict):
                        continue
                    step_sequence = row.get("step_sequence")
                    try:
                        step_index = int(step_sequence) if step_sequence not in (None, "") else 0
                    except Exception:
                        step_index = 0
                    key = str(step_index)
                    group = by_key.setdefault(
                        key,
                        {
                            "index": step_index,
                            "step_label": row.get("step_name") or self._route_step_label(template, step_index),
                            "step_kind": row.get("category_code") or "MATERIAL",
                            "description": "",
                            "materials": [],
                        },
                    )
                    group["materials"].append(
                        {
                            "material_code": row.get("material_code") or "",
                            "material_name": row.get("material_name") or row.get("material_code") or "",
                            "qty": float(
                                row.get("planned_issue_qty")
                                or row.get("planned_qty")
                                or row.get("theoretical_qty")
                                or 0
                            ),
                            "uom": row.get("uom") or "KG",
                            "waste_percent": float(row.get("waste_percent") or 0),
                        }
                    )
                bom_by_step = list(by_key.values())
                structure_reasons.extend(
                    _stock_pool_structure_reasons(
                        product_master,
                        geometry_snapshot or {},
                        layer_snapshot or [],
                        stock_purpose=stock_purpose,
                        bom_by_step=bom_by_step,
                    )
                )
                structure_reasons = list(dict.fromkeys(structure_reasons))
                first_material = next(
                    (
                        mat
                        for group in bom_by_step
                        for mat in group.get("materials", [])
                        if mat.get("material_code")
                    ),
                    None,
                )
                required_material = {}
                if first_material:
                    first_layer = next(
                        (
                            layer
                            for layer in (layer_snapshot or [])
                            if (
                                layer.get("material_code")
                                or layer.get("film_variant_code")
                                or layer.get("base_material_code")
                            )
                            == first_material.get("material_code")
                        ),
                        None,
                    )
                    required_material = {
                        "code": first_material.get("material_code") or "",
                        "material_code": first_material.get("material_code") or "",
                        "name": first_material.get("material_name") or first_material.get("material_code") or "",
                        "material_name": first_material.get("material_name") or first_material.get("material_code") or "",
                        "target_qty": first_material.get("qty") or 0,
                        "qty": first_material.get("qty") or 0,
                        "uom": first_material.get("uom") or "KG",
                        "grade": (first_layer or {}).get("grade") or (first_layer or {}).get("grade_code") or "",
                        "thickness_micron": (first_layer or {}).get("thickness_micron"),
                        "width_mm": (first_layer or {}).get("roll_width_mm") or (first_layer or {}).get("input_roll_width_mm"),
                    }
                inv_payload = build_invariant_payload(
                    film_layers=layer_snapshot or [],
                    printing=printing_snapshot or {},
                )
                response_payload.update(
                    {
                        "valid": not bool(structure_reasons),
                        "reasons": structure_reasons,
                        "blockers": structure_reasons,
                        "axis_values": axis_values,
                        "geometry_snapshot": _jsonify(geometry_snapshot or {}),
                        "layer_snapshot": _jsonify(layer_snapshot or []),
                        "printing_snapshot": _jsonify(printing_snapshot or {}),
                        "packaging_snapshot": _jsonify(normalized_packaging_snapshot or {}),
                        "addons_snapshot": _jsonify(addons_snapshot or []),
                        "unit_weight_g": preview.get("unit_weight_g"),
                        "total_weight_kg": preview.get("total_weight_kg"),
                        "invariant_signature": build_invariant_signature(inv_payload),
                        "bom_by_step": _jsonify(bom_by_step),
                        "bom_snapshot": _jsonify(bom_snapshot),
                        "required_material": required_material,
                        "eligible_demand": {
                            "computed": False,
                            "eligible_orders": 0,
                            "exact_match": 0,
                            "widening_allowed": 0,
                            "wrong_artwork": 0,
                        },
                        "commitment_safety": {
                            "scope": commitment_scope,
                            "customer_lock": committed_customer or None,
                            "artwork_lock": committed_artwork or None,
                            "match_window": (
                                "at_or_after_artwork_step"
                                if commitment_scope in {"ARTWORK", "CUSTOMER_ARTWORK"}
                                else "before_artwork_step"
                                if result.first_artwork_step_index is not None
                                else "full_route"
                            ),
                        },
                    }
                )
            except ValidationError as exc:
                detail = getattr(exc, "message_dict", None) or getattr(exc, "messages", None) or str(exc)
                return Response({"valid": False, "error": detail, "detail": detail, "reasons": detail if isinstance(detail, list) else [str(detail)]})
            except Exception as exc:
                return Response({"valid": False, "error": str(exc), "reasons": [str(exc)]})

        return Response(response_payload)

    @action(detail=False, methods=["post"], url_path="create-stock-order")
    def create_stock_order(self, request):
        def _payload_value(primary_key, secondary_key):
            if primary_key in request.data:
                return request.data.get(primary_key)
            if secondary_key in request.data:
                return request.data.get(secondary_key)
            return None

        planner_sku_variant_id = request.data.get("planner_sku_variant_id")
        sales_sku_variant_id = request.data.get("sales_sku_variant_id")
        pod_sku_variant_id = request.data.get("pod_sku_variant_id") or request.data.get("pod_sku_variant")
        launcher_mode = str(request.data.get("launcher_mode") or "").strip().upper()
        planner_variant = None
        sales_variant = None
        if planner_sku_variant_id:
            try:
                planner_variant = PlannerSkuVariant.objects.select_related(
                    "sku",
                    "template",
                    "default_plant",
                    "packaging_material",
                    "pod_sku_variant",
                    "product_master",
                    "committed_customer",
                    "committed_artwork",
                    "sku__product_master",
                ).get(id=planner_sku_variant_id, active=True)
            except PlannerSkuVariant.DoesNotExist:
                return Response({"error": "Invalid planner_sku_variant_id"}, status=status.HTTP_400_BAD_REQUEST)
        if sales_sku_variant_id:
            try:
                sales_variant = SalesSkuVariant.objects.select_related(
                    "sku",
                    "sku__template",
                    "sku__product_master",
                ).get(id=sales_sku_variant_id, active=True)
            except SalesSkuVariant.DoesNotExist:
                return Response({"error": "Invalid sales_sku_variant_id"}, status=status.HTTP_400_BAD_REQUEST)

        def _auto_internal_name(base_label: str) -> str:
            slug = str(base_label or "planner-stock").strip().replace(" ", "-").upper()
            stamp = timezone.now().strftime("%Y%m%d%H%M")
            return f"{slug}-{stamp}"

        template_id = request.data.get("template_id")
        internal_name = str(request.data.get("name") or request.data.get("internal_name") or "").strip()
        quantity = request.data.get("quantity", request.data.get("qty"))
        quantity_uom = str(request.data.get("quantity_uom", "KG")).upper()
        stock_purpose = str(request.data.get("stock_purpose", "PRODUCT") or "PRODUCT").upper()
        requested_stock_strategy = request.data.get("stock_strategy")
        requested_planner_stock_class = request.data.get("planner_stock_class")
        packaging_material_id = request.data.get("packaging_material_id") or request.data.get("packaging_material")
        product_master_id = request.data.get("product_master") or request.data.get("product_master_id")
        axis_values = request.data.get("axis_values") if isinstance(request.data.get("axis_values"), dict) else {}
        axis_values = dict(axis_values)
        commitment_scope = str(request.data.get("commitment_scope") or "GENERIC").strip().upper()
        committed_customer_id = request.data.get("committed_customer") or request.data.get("committed_customer_id")
        committed_artwork_id = request.data.get("committed_artwork") or request.data.get("committed_artwork_id")
        start_step_index = request.data.get("start_step_index")
        stop_step_index = request.data.get("stop_step_index")
        preferred_plant_id = request.data.get("preferred_plant_id") or request.data.get("plant_id")
        geometry_override = sanitize_geometry_override(request.data.get("geometry_override") or {})
        geometry_snapshot_payload = _payload_value("geometry", "geometry_snapshot")
        layer_snapshot_payload = _payload_value("film_layers", "layer_snapshot")
        printing_snapshot_payload = _payload_value("printing", "printing_snapshot")
        addons_snapshot_payload = _payload_value("addons", "addons_snapshot")
        if addons_snapshot_payload is None and axis_values:
            addons_snapshot_payload = _addons_from_axis_values(axis_values)
        packaging_payload_from_request = _payload_value("packaging_snapshot", "packaging")
        axis_has_packaging = any(
            key in axis_values
            for key in (
                "packaging_inner",
                "packaging_outer",
                "packaging",
                "packaging_ref",
                "primary_inner_pack",
                "pod_variant",
                "pod",
                "pod_ref",
            )
        )
        packaging_snapshot_payload = (
            _merge_axis_packaging_snapshot(packaging_payload_from_request or {}, axis_values)
            if packaging_payload_from_request is not None or axis_has_packaging
            else None
        )
        normalized_packaging_snapshot = _normalize_packaging_snapshot(packaging_snapshot_payload or {})

        if planner_variant:
            launcher_mode = str(planner_variant.launch_kind or "").upper()
            template_id = planner_variant.template_id or planner_variant.sku.template_id
            internal_name = internal_name or _auto_internal_name(planner_variant.code or planner_variant.name or planner_variant.sku.code)
            quantity = quantity if quantity is not None else planner_variant.default_qty
            quantity_uom = str(planner_variant.quantity_uom or quantity_uom).upper()
            stock_purpose = str(planner_variant.stock_purpose or stock_purpose).upper()
            requested_stock_strategy = planner_variant.stock_strategy or requested_stock_strategy
            requested_planner_stock_class = planner_variant.planner_stock_class or requested_planner_stock_class
            packaging_material_id = planner_variant.packaging_material_id
            product_master_id = product_master_id or planner_variant.product_master_id or planner_variant.sku.product_master_id
            axis_values = axis_values or (planner_variant.axis_values or {})
            commitment_scope = str(planner_variant.commitment_scope or commitment_scope).upper()
            committed_customer_id = committed_customer_id or planner_variant.committed_customer_id
            committed_artwork_id = committed_artwork_id or planner_variant.committed_artwork_id
            pod_sku_variant_id = planner_variant.pod_sku_variant_id
            start_step_index = planner_variant.start_step_index
            stop_step_index = planner_variant.stop_step_index
            preferred_plant_id = preferred_plant_id or planner_variant.default_plant_id or planner_variant.sku.default_plant_id
            geometry_snapshot_payload = planner_variant.geometry_snapshot or {}
            layer_snapshot_payload = planner_variant.layer_snapshot or []
            printing_snapshot_payload = planner_variant.printing_snapshot or {}
            addons_snapshot_payload = planner_variant.addons_snapshot or []
            packaging_snapshot_payload = _merge_axis_packaging_snapshot(planner_variant.packaging_snapshot or {}, axis_values)
            normalized_packaging_snapshot = _normalize_packaging_snapshot(packaging_snapshot_payload or {})
        elif sales_variant:
            sales_fg_type = str(getattr(sales_variant, "finished_good_type", "") or "POUCH").upper()
            sales_roll_form = str(getattr(sales_variant, "roll_form", "") or "").upper()
            template_id = (
                template_id
                or getattr(sales_variant, "template_id", None)
                or getattr(getattr(sales_variant, "sku", None), "template_id", None)
            )
            product_master_id = product_master_id or getattr(getattr(sales_variant, "sku", None), "product_master_id", None)
            internal_name = internal_name or _auto_internal_name(
                getattr(sales_variant, "code", "")
                or getattr(sales_variant, "name", "")
                or getattr(getattr(sales_variant, "sku", None), "code", "")
            )
            stock_purpose = str(request.data.get("stock_purpose") or stock_purpose or "PRODUCT").upper()
            quantity_uom = str(
                request.data.get("quantity_uom")
                or ("KG" if sales_fg_type == "ROLL" else "PCS")
            ).upper()
            variant_geometry = sales_variant.geometry_snapshot or {}
            geometry_snapshot_payload = geometry_snapshot_payload if geometry_snapshot_payload is not None else variant_geometry
            if isinstance(geometry_snapshot_payload, dict):
                geometry_snapshot_payload = dict(geometry_snapshot_payload)
                geometry_snapshot_payload.setdefault("finished_good_type", sales_fg_type)
                if sales_fg_type == "ROLL" and sales_roll_form:
                    geometry_snapshot_payload.setdefault("roll_form", sales_roll_form)
            layer_snapshot_payload = layer_snapshot_payload if layer_snapshot_payload is not None else (sales_variant.layer_snapshot or [])
            variant_printing_snapshot = sales_variant.printing_snapshot or {}
            if printing_snapshot_payload is None:
                merged_printing_snapshot = dict(variant_printing_snapshot) if isinstance(variant_printing_snapshot, dict) else {}
                if sales_variant.chemicals_snapshot and not merged_printing_snapshot.get("chemicals"):
                    merged_printing_snapshot["chemicals"] = sales_variant.chemicals_snapshot
                printing_snapshot_payload = merged_printing_snapshot
            addons_snapshot_payload = addons_snapshot_payload if addons_snapshot_payload is not None else (sales_variant.addons_snapshot or [])
            packaging_snapshot_payload = _merge_axis_packaging_snapshot(
                packaging_snapshot_payload if packaging_snapshot_payload is not None else (sales_variant.packaging_snapshot or {}),
                axis_values,
            )
            normalized_packaging_snapshot = _normalize_packaging_snapshot(packaging_snapshot_payload or {})

        product_master = None
        packaging_material = None
        needs_product_resolution = geometry_snapshot_payload is None or layer_snapshot_payload is None or not template_id
        needs_axis_injection = (
            (stock_purpose == "PACKAGING" and packaging_material_id)
            or launcher_mode == "POD_STOCK"
            or bool(pod_sku_variant_id)
        )
        if product_master_id:
            try:
                product_master = ProductMaster.objects.get(
                    id=product_master_id,
                    active=True,
                    is_current_version=True,
                )
            except Exception:
                return Response(
                    {"error": "Invalid, inactive, or old-version product_master_id"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if not template_id:
                template_id = product_master.template_id or product_master.default_template_id

        product_kind = str(getattr(product_master, "product_kind", "") or "").upper()
        if product_kind == "POD" and launcher_mode != "POD_STOCK" and not pod_sku_variant_id:
            return Response(
                {"error": "pod_sku_variant_id is required for POD Product Master stock launches."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if stock_purpose == "PACKAGING" and packaging_material_id:
            try:
                packaging_material = InventoryMaterial.objects.get(id=packaging_material_id)
            except Exception:
                return Response({"error": "Invalid packaging_material_id"}, status=status.HTTP_400_BAD_REQUEST)
            _ensure_axis_value(
                product_master,
                axis_values,
                names=("packaging_inner", "packaging_outer", "packaging", "packaging_ref"),
                types=("catalog_ref", "packaging_ref"),
                value=str(packaging_material.code or ""),
            )

        if launcher_mode == "POD_STOCK" and not pod_sku_variant_id:
            return Response({"error": "pod_sku_variant_id is required when launcher_mode=POD_STOCK"}, status=status.HTTP_400_BAD_REQUEST)

        if product_master_id:
            geometry_snapshot_payload, layer_snapshot_payload = _resolve_product_master_snapshots(
                product_master,
                axis_values,
                geometry_snapshot_payload,
                layer_snapshot_payload,
                force_master=bool(axis_values),
            )

        if launcher_mode == "POD_STOCK" or pod_sku_variant_id:
            if quantity is None:
                return Response({"error": "quantity is required for POD stock launch"}, status=status.HTTP_400_BAD_REQUEST)
            try:
                target_qty_kg = Decimal(str(quantity))
                if target_qty_kg <= 0:
                    raise ValueError
            except Exception:
                return Response({"error": "Invalid quantity"}, status=status.HTTP_400_BAD_REQUEST)
            try:
                pod_sku_variant = PodSkuVariant.objects.select_related("pod_sku", "material").get(id=pod_sku_variant_id, active=True)
            except Exception:
                return Response({"error": "Invalid pod_sku_variant_id"}, status=status.HTTP_400_BAD_REQUEST)
            _ensure_axis_value(
                product_master,
                axis_values,
                names=("pod_variant", "pod", "pod_ref"),
                types=("catalog_ref", "pod_ref"),
                value=str(pod_sku_variant.code or pod_sku_variant.pod_sku.code or ""),
            )

            planner_origin_meta = {
                "launch_kind": "POD_STOCK",
                "naming_source": "planner_preset" if planner_variant else "pod_sku",
                "product_master_id": str(product_master_id or ""),
                "axis_values": axis_values or {},
                "pod_sku_variant_id": str(pod_sku_variant.id),
                "pod_variant_code": str(pod_sku_variant.code or pod_sku_variant.pod_sku.code or ""),
                "pod_variant_name": str(pod_sku_variant.name or pod_sku_variant.pod_sku.name or ""),
            }
            if planner_variant:
                planner_origin_meta.update(
                    {
                        "planner_sku_id": str(planner_variant.sku_id),
                        "planner_sku_code": str(planner_variant.sku.code or ""),
                        "planner_sku_variant_id": str(planner_variant.id),
                        "planner_sku_variant_code": str(planner_variant.code or ""),
                    }
                )

            bulk_order = PlannedBulkStockOrder.objects.create(
                internal_name=internal_name or _auto_internal_name(planner_variant.code if planner_variant else (pod_sku_variant.code or pod_sku_variant.pod_sku.code)),
                material=pod_sku_variant.material,
                plant_id=preferred_plant_id,
                target_qty_kg=target_qty_kg,
                pod_profile_snapshot={
                    "material_id": str(pod_sku_variant.material_id),
                    "material_code": str(pod_sku_variant.material.code or ""),
                    "material_name": str(pod_sku_variant.material.name or ""),
                    "pod_sku_variant_id": str(pod_sku_variant.id),
                    "pod_sku_code": str(pod_sku_variant.code or pod_sku_variant.pod_sku.code),
                    "pod_sku_name": str(pod_sku_variant.name or pod_sku_variant.pod_sku.name),
                },
                planner_origin_meta=planner_origin_meta,
                created_by=request.user if getattr(request.user, "is_authenticated", False) else None,
            )
            serializer = PlannedBulkStockOrderSerializer(bulk_order)
            payload = dict(serializer.data)
            payload.update(
                {
                    "status": "planned",
                    "order_kind": "bulk",
                    "order_id": str(bulk_order.id),
                    "stock_order_id": str(bulk_order.id),
                    "order_number": bulk_order.order_number,
                    "name": bulk_order.internal_name,
                    "order_status": bulk_order.status,
                    "jobs_created": 0,
                    "quantity_kg": float(bulk_order.target_qty_kg),
                    "target_qty_kg": float(bulk_order.target_qty_kg),
                    "quantity_uom": "KG",
                    "planned_output_type": "POD_BULK",
                    "stock_strategy": "POD_BULK",
                    "planner_stock_class": "POD_STOCK",
                }
            )
            return Response(payload, status=status.HTTP_201_CREATED)

        if not template_id or quantity is None:
            return Response({"error": "template_id and quantity are required"}, status=status.HTTP_400_BAD_REQUEST)
        if start_step_index is None:
            return Response({"error": "start_step_index is required"}, status=status.HTTP_400_BAD_REQUEST)
        if quantity_uom not in {"KG", "PCS", "METER"}:
            return Response({"error": "quantity_uom must be KG, PCS, or METER"}, status=status.HTTP_400_BAD_REQUEST)
        if stock_purpose not in {"PRODUCT", "PACKAGING"}:
            return Response({"error": "stock_purpose must be PRODUCT or PACKAGING"}, status=status.HTTP_400_BAD_REQUEST)
        if quantity_uom == "METER":
            return Response({"error": "quantity_uom METER is not supported for stock-order execution in V1."}, status=status.HTTP_400_BAD_REQUEST)
        if geometry_snapshot_payload is None:
            return Response({"error": "geometry snapshot is required"}, status=status.HTTP_400_BAD_REQUEST)
        if layer_snapshot_payload is None:
            return Response({"error": "film_layers snapshot is required"}, status=status.HTTP_400_BAD_REQUEST)
        if printing_snapshot_payload is None:
            return Response({"error": "printing snapshot is required"}, status=status.HTTP_400_BAD_REQUEST)
        if addons_snapshot_payload is None:
            return Response({"error": "addons snapshot is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            qty_input = Decimal(str(quantity))
            if qty_input <= 0:
                raise ValueError("quantity must be > 0")
        except Exception:
            return Response({"error": "Invalid quantity"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            template = TemplateBlueprint.objects.select_related("routing_rule").get(id=template_id)
        except Exception:
            return Response({"error": "Invalid template_id"}, status=status.HTTP_400_BAD_REQUEST)

        if stock_purpose == "PACKAGING":
            if not packaging_material_id:
                return Response({"error": "packaging_material_id is required when stock_purpose=PACKAGING"}, status=status.HTTP_400_BAD_REQUEST)
            if packaging_material is None:
                try:
                    packaging_material = InventoryMaterial.objects.get(id=packaging_material_id)
                except Exception:
                    return Response({"error": "Invalid packaging_material_id"}, status=status.HTTP_400_BAD_REQUEST)
            if str(packaging_material.category or "").upper() != "PACKAGING":
                return Response({"error": "packaging_material must be category=PACKAGING"}, status=status.HTTP_400_BAD_REQUEST)
            base_uom = str(packaging_material.base_uom or "").upper()
            if base_uom not in {"KG", "PCS"}:
                return Response({"error": "In-house PACKAGING output supports only KG/PCS base_uom in V1."}, status=status.HTTP_400_BAD_REQUEST)
            if quantity_uom != base_uom:
                return Response({"error": f"quantity_uom must match packaging material base_uom ({base_uom})"}, status=status.HTTP_400_BAD_REQUEST)

        if not template.routing_rule:
            return Response({"error": "Template has no routing rule"}, status=status.HTTP_400_BAD_REQUEST)
        if not TemplateGovernanceService.is_current_live_template(template):
            return Response({"error": "Template must be the current LIVE version for Stock Order creation"}, status=status.HTTP_400_BAD_REQUEST)

        if commitment_scope not in {"GENERIC", "CUSTOMER", "ARTWORK", "CUSTOMER_ARTWORK"}:
            return Response({"error": "Invalid commitment_scope"}, status=status.HTTP_400_BAD_REQUEST)
        if commitment_scope in {"CUSTOMER", "CUSTOMER_ARTWORK"} and not committed_customer_id:
            return Response({"error": "committed_customer is required for customer-committed stock"}, status=status.HTTP_400_BAD_REQUEST)
        if commitment_scope in {"ARTWORK", "CUSTOMER_ARTWORK"} and not committed_artwork_id:
            return Response({"error": "committed_artwork is required for artwork-committed stock"}, status=status.HTTP_400_BAD_REQUEST)
        if commitment_scope == "GENERIC":
            committed_customer_id = None
            committed_artwork_id = None

        route_last = len(template.routing_rule.ordered_processes) - 1

        try:
            start_step_index = int(start_step_index)
            if start_step_index < 0:
                raise ValueError
        except Exception:
            return Response({"error": "start_step_index must be a non-negative integer"}, status=status.HTTP_400_BAD_REQUEST)

        if stop_step_index is None:
            stop_step_index = route_last
        try:
            stop_step_index = int(stop_step_index)
        except Exception:
            return Response({"error": "stop_step_index must be an integer"}, status=status.HTTP_400_BAD_REQUEST)

        if stop_step_index < start_step_index or stop_step_index > route_last:
            return Response(
                {"error": f"stop_step_index must be between {start_step_index} and {route_last}"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if stock_purpose != "PACKAGING":
            try:
                validate_planner_stop_step(
                    template=template,
                    stop_step_index=stop_step_index,
                    commitment_scope=commitment_scope,
                    committed_artwork=committed_artwork_id,
                    committed_customer=committed_customer_id,
                )
            except ValidationError as exc:
                detail = getattr(exc, "message_dict", None) or getattr(exc, "messages", None) or str(exc)
                return Response({"error": detail, "detail": detail}, status=status.HTTP_400_BAD_REQUEST)

        requested_wip_width, wip_width_error = _parse_optional_positive_mm(
            request.data,
            "wip_roll_width_mm",
            "target_roll_width_mm",
            "planned_parent_width_mm",
        )
        if wip_width_error:
            return Response({"error": wip_width_error, "detail": [wip_width_error]}, status=status.HTTP_400_BAD_REQUEST)

        normalized_geometry = normalize_geometry_override({}, geometry_snapshot_payload or geometry_override)
        normalized_geometry = _preserve_computed_geometry(normalized_geometry, geometry_snapshot_payload or {})
        fg_type = str(template.fg_type or "POUCH").upper()
        if fg_type not in {"POUCH", "ROLL"}:
            return Response({"error": "fg_type must be POUCH or ROLL"}, status=status.HTTP_400_BAD_REQUEST)
        normalized_geometry["finished_good_type"] = fg_type
        roll_form = str(request.data.get("roll_form") or normalized_geometry.get("roll_form") or "FLAT").upper()
        if fg_type == "ROLL":
            if quantity_uom != "KG":
                return Response({"error": "Roll stock orders require quantity_uom=KG"}, status=status.HTTP_400_BAD_REQUEST)
            if roll_form not in {"FLAT", "FOLDED", "TUBING"}:
                return Response({"error": "roll_form must be FLAT, FOLDED, or TUBING"}, status=status.HTTP_400_BAD_REQUEST)
            normalized_geometry["roll_form"] = roll_form
            base = normalized_geometry.get("base") if isinstance(normalized_geometry.get("base"), dict) else {}
            base["height_mm"] = 0.0
            normalized_geometry["base"] = base
            normalized_packaging_snapshot["pod"] = {"enabled": False, "pod_profile_id": None, "pod_sku_variant_id": None}
        else:
            normalized_geometry.pop("roll_form", None)
            roll_form = ""
            try:
                normalized_packaging_snapshot["pod"] = _hydrate_pod_snapshot(normalized_packaging_snapshot.get("pod") or {})
            except ValidationError as exc:
                detail = getattr(exc, "message_dict", None) or getattr(exc, "messages", None) or str(exc)
                return Response({"error": detail}, status=status.HTTP_400_BAD_REQUEST)

        try:
            layer_snapshot = _normalize_layer_snapshot(layer_snapshot_payload or [])
        except ValidationError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        effective_wip_width = None
        if stock_purpose == "PRODUCT" and stop_step_index < route_last:
            effective_wip_width = requested_wip_width or _snapshot_max_roll_width_mm(
                normalized_geometry,
                layer_snapshot,
            )
            if effective_wip_width <= 0:
                return Response(
                    {
                        "error": "WIP roll width is required for a stopped-route stock pool.",
                        "detail": ["WIP roll width is required for a stopped-route stock pool."],
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            normalized_geometry, layer_snapshot = _apply_wip_roll_width_to_snapshots(
                normalized_geometry,
                layer_snapshot,
                effective_wip_width,
            )
        printing_snapshot = _normalize_printing_snapshot(printing_snapshot_payload if isinstance(printing_snapshot_payload, dict) else {})
        addons_snapshot = addons_snapshot_payload if isinstance(addons_snapshot_payload, list) else []
        structure_reasons = _stock_pool_structure_reasons(
            product_master,
            normalized_geometry,
            layer_snapshot,
            stock_purpose=stock_purpose,
        )
        if structure_reasons:
            return Response(
                {
                    "error": "Stock order snapshots are incomplete.",
                    "detail": structure_reasons,
                    "reasons": structure_reasons,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        class _StockOrderItem:
            template = None
            layer_snapshot = None
            printing_snapshot = None

        validator_item = _StockOrderItem()
        validator_item.template = template
        validator_item.layer_snapshot = layer_snapshot
        validator_item.printing_snapshot = printing_snapshot
        try:
            (
                printing_snapshot,
                artwork_required,
                assigned_artwork_id,
            ) = _validate_printing_snapshot_for_confirm(
                validator_item,
                allow_missing_artwork=True,
            )
        except Exception as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        preview = SalesOrderService.preview_sales_item(
            {
                "finished_good_type": fg_type,
                "geometry": normalized_geometry,
                "film_layers": layer_snapshot,
                "printing": printing_snapshot,
                "chemicals": printing_snapshot.get("chemicals") or {},
                "addons": addons_snapshot,
                "packaging_snapshot": normalized_packaging_snapshot,
                "packaging": normalized_packaging_snapshot,
                "roll_form": roll_form or None,
                "order_qty": float(qty_input),
                "uom": quantity_uom,
            }
        )
        planning_lines = ((preview or {}).get("bom") or {}).get("planning_lines") or []
        strict_product_master_stock = isinstance(product_master, ProductMaster)
        if stock_purpose == "PRODUCT" and strict_product_master_stock and not planning_lines:
            return Response(
                {
                    "error": "No BOM lines resolved for this stock order.",
                    "detail": ["No BOM lines resolved for the selected Product Master axes and route stop."],
                    "reasons": ["No BOM lines resolved for the selected Product Master axes and route stop."],
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if bool((printing_snapshot or {}).get("enabled", False)) and not artwork_required:
            inks = ((preview or {}).get("bom") or {}).get("inks") or []
            if not inks:
                return Response({"error": "Printing enabled but no inks resolved from artwork."}, status=status.HTTP_400_BAD_REQUEST)

        target_qty_kg = Decimal(str(preview.get("total_weight_kg") or 0))
        if quantity_uom == "KG":
            target_qty_kg = qty_input
        if target_qty_kg <= 0:
            return Response({"error": "Could not derive target KG from stock-order snapshots."}, status=status.HTTP_400_BAD_REQUEST)
        target_qty = qty_input if stock_purpose == "PACKAGING" else target_qty_kg
        execution_uom = quantity_uom if stock_purpose == "PACKAGING" else "KG"

        spec_payload = build_spec_payload(
            fg_type=fg_type,
            roll_form=roll_form or None,
            geometry=normalized_geometry,
            film_layers=layer_snapshot,
            printing=printing_snapshot,
            addons=addons_snapshot,
        )
        spec_signature = build_spec_signature(spec_payload)
        inv_payload = build_invariant_payload(
            film_layers=layer_snapshot,
            printing=printing_snapshot
        )
        invariant_signature = build_invariant_signature(inv_payload)

        if stop_step_index < route_last:
            output_type = "WIP_ROLL"
        else:
            output_type = "FG_POUCH" if fg_type == "POUCH" else "FG_ROLL"
        stock_strategy = self._normalize_stock_strategy(
            stock_strategy=requested_stock_strategy,
            template=template,
            stock_purpose=stock_purpose,
            stop_step_index=stop_step_index,
        )
        planner_stock_class = self._derive_planner_stock_class(
            template=template,
            stock_purpose=stock_purpose,
            stop_step_index=stop_step_index,
            planner_stock_class=requested_planner_stock_class,
        )
        bom_snapshot = _jsonify(preview.get("bom") or {})
        try:
            from apps.production.services.roll_allocation_service import layer_signature_hash
            sig = layer_signature_hash(layer_snapshot or [])
            if isinstance(bom_snapshot, dict) and sig:
                bom_snapshot["layer_signature_hash"] = sig
        except Exception:
            pass
        planner_origin_meta = {}
        if planner_variant:
            planner_origin_meta = {
                "planner_sku_id": str(planner_variant.sku_id),
                "planner_sku_code": str(planner_variant.sku.code or ""),
                "planner_sku_variant_id": str(planner_variant.id),
                "planner_sku_variant_code": str(planner_variant.code or ""),
                "launch_kind": str(planner_variant.launch_kind or ""),
                "naming_source": "planner_preset",
            }
        elif sales_variant:
            planner_origin_meta = {
                "sales_sku_id": str(sales_variant.sku_id),
                "sales_sku_code": str(sales_variant.sku.code or ""),
                "sales_sku_variant_id": str(sales_variant.id),
                "sales_sku_variant_code": str(sales_variant.code or ""),
                "sales_sku_variant_name": str(sales_variant.name or ""),
                "launch_kind": launcher_mode or "SALES_SKU",
                "naming_source": "sales_sku",
            }
        planner_origin_meta.update(
            {
                "product_master_id": str(product_master_id or ""),
                "commitment_scope": commitment_scope,
                "committed_customer_id": str(committed_customer_id or ""),
                "committed_artwork_id": str(committed_artwork_id or ""),
                "axis_values": axis_values or {},
            }
        )
        if effective_wip_width is not None:
            planner_origin_meta["wip_roll_width_mm"] = float(effective_wip_width)
        with transaction.atomic():
            mts_order = PlannedStockOrder.objects.create(
                internal_name=internal_name or (planner_variant and _auto_internal_name(planner_variant.code)) or f"{template.name} Stock",
                template=template,
                plant_id=preferred_plant_id,
                product_master_id=product_master_id or None,
                axis_values=axis_values or {},
                commitment_scope=commitment_scope,
                committed_customer_id=committed_customer_id or None,
                committed_artwork_id=committed_artwork_id or None,
                target_qty=target_qty,
                quantity_uom=execution_uom,
                geometry_override=geometry_override,
                geometry_snapshot=normalized_geometry,
                layer_snapshot=layer_snapshot,
                printing_snapshot=printing_snapshot,
                addons_snapshot=addons_snapshot,
                packaging_snapshot=normalized_packaging_snapshot,
                bom_snapshot=bom_snapshot,
                planner_origin_meta=planner_origin_meta,
                spec_signature=spec_signature,
                invariant_signature=invariant_signature,
                unit_weight_g=Decimal(str(preview.get("unit_weight_g") or 0)),
                total_weight_kg=target_qty_kg,
                output_type=output_type,
                stock_purpose=stock_purpose,
                stock_strategy=stock_strategy,
                planner_stock_class=planner_stock_class,
                packaging_material=packaging_material,
                artwork_assignment_required=bool(artwork_required),
                assigned_artwork_id=assigned_artwork_id,
                start_step_index=start_step_index,
                stop_step_index=stop_step_index,
                target_step_index=stop_step_index,
                status="PLANNING_REQUIRED",
                created_by=request.user if request.user.is_authenticated else None,
            )
            jobs_created = self._prime_stock_order_for_release(mts_order)

            # auto_release: planner stock launcher fires straight to production with no gate.
            # The launcher is for stock-class production (no customer commitment) so we
            # bypass the explicit release step. Skips when artwork is required and absent.
            auto_release = bool(request.data.get("auto_release"))
            released_job_id = None
            if auto_release:
                # Refresh from DB to ensure jobs were persisted
                primed_jobs = self._order_job_queryset("stock", mts_order).order_by("current_step_index", "created_at")
                first_job = next((job for job in primed_jobs if job.job_state in ["PLANNED", "WAITING"]), None)
                if first_job is not None:
                    JobService.release_job(first_job.id)
                    mts_order.status = "RELEASED"
                    mts_order.save(update_fields=["status", "updated_at"])
                    released_job_id = str(first_job.id)

        return Response(
            {
                "status": "released" if released_job_id else "planned",
                "auto_released": bool(released_job_id),
                "released_job_id": released_job_id,
                "stock_order_id": str(mts_order.id),
                "order_id": str(mts_order.id),
                "order_number": mts_order.order_number,
                "name": mts_order.internal_name,
                "order_status": mts_order.status,
                "jobs_created": len(jobs_created),
                "quantity_kg": float(target_qty_kg),
                "target_qty_kg": float(target_qty_kg),
                "quantity_uom": mts_order.quantity_uom,
                "final_product_type": str(template.fg_type or "").upper() if stock_purpose == "PRODUCT" else None,
                "planned_output_type": "PACKAGING_STOCK" if stock_purpose == "PACKAGING" else mts_order.output_type,
                "stock_strategy": mts_order.stock_strategy,
                "planner_stock_class": mts_order.planner_stock_class,
                "start_step_index": mts_order.start_step_index,
                "stop_step_index": mts_order.stop_step_index,
                "spec_signature": mts_order.spec_signature,
                "invariant_signature": mts_order.invariant_signature,
            },
            status=status.HTTP_201_CREATED,
        )

    def _prime_stock_order_for_release(self, order: PlannedStockOrder):
        template = getattr(order, "template", None)
        if not template or not getattr(template, "routing_rule", None):
            raise ValueError("Stock order template has no routing rule.")

        route_last = self._route_last_index(template)
        start_step_index = int(getattr(order, "start_step_index", 0) or 0)
        raw_stop_step = getattr(order, "stop_step_index", None)
        stop_step_index = route_last if raw_stop_step is None else int(raw_stop_step)
        if start_step_index < 0 or stop_step_index < start_step_index or stop_step_index > route_last:
            raise ValueError(f"Invalid stock-order step range {start_step_index}..{stop_step_index} for route {route_last}.")

        existing_jobs = self._order_job_queryset("stock", order).exclude(job_state="CANCELLED")
        jobs_created = []
        if not existing_jobs.exists():
            jobs_created = JobService.create_jobs_for_planned_order(
                order,
                start_index=start_step_index,
                stop_index=stop_step_index,
            )
            if not jobs_created:
                raise ValueError("Could not create production jobs for stock order.")

        order.start_step_index = start_step_index
        order.stop_step_index = stop_step_index
        order.target_step_index = stop_step_index
        order.status = "PLANNED"
        order.save(
            update_fields=[
                "status",
                "start_step_index",
                "stop_step_index",
                "target_step_index",
                "updated_at",
            ]
        )
        return jobs_created

    @action(detail=False, methods=["post"], url_path="control-hub/clone")
    def control_hub_clone(self, request):
        order_kind = str(request.data.get("order_kind") or "").lower()
        order_id = str(request.data.get("order_id") or "").strip()
        clone_name = str(request.data.get("name") or "").strip()

        if not order_kind or not order_id:
            return Response({"error": "order_kind and order_id are required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            resolved_kind, source_order, template, route_last = self._get_order_for_kind(order_kind, order_id)
        except Exception as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        if not template or not template.routing_rule:
            return Response({"error": "Source order template has no routing rule."}, status=status.HTTP_400_BAD_REQUEST)

        created_by = request.user if request.user.is_authenticated else None

        if resolved_kind == "sales":
            soi = source_order.items.select_related("template").first()
            if not soi:
                return Response({"error": "Sales order has no items to clone."}, status=status.HTTP_400_BAD_REQUEST)

            geometry_snapshot = _jsonify(soi.geometry_snapshot or {})
            layer_snapshot = _jsonify(soi.layer_snapshot or [])
            printing_snapshot = _jsonify(soi.printing_snapshot or {})
            addons_snapshot = _jsonify(soi.addons_snapshot or [])
            bom_snapshot = _jsonify(soi.bom_snapshot or {})
            packaging_snapshot = _jsonify(_normalize_packaging_snapshot(soi.packaging_snapshot or {}))
            spec_signature = str(soi.spec_signature or "").strip()
            target_qty_kg = Decimal(str(soi.total_weight_kg or self._order_qty_kg("sales", source_order) or 0))
            unit_weight_g = Decimal(str(soi.unit_weight_g or 0))
            default_output_type = "FG_POUCH" if str(template.fg_type or "").upper() == "POUCH" else "FG_ROLL"
            stock_purpose = "PRODUCT"
            quantity_uom = "KG"
            packaging_material = None
            stock_strategy = self._normalize_stock_strategy(
                stock_strategy="FINAL_STOCK",
                template=template,
                stock_purpose=stock_purpose,
                stop_step_index=route_last,
            )
            planner_stock_class = self._derive_planner_stock_class(
                template=template,
                stock_purpose=stock_purpose,
                stop_step_index=route_last,
            )
        else:
            geometry_snapshot = _jsonify(source_order.geometry_snapshot or {})
            layer_snapshot = _jsonify(source_order.layer_snapshot or [])
            printing_snapshot = _jsonify(source_order.printing_snapshot or {})
            addons_snapshot = _jsonify(source_order.addons_snapshot or [])
            bom_snapshot = _jsonify(source_order.bom_snapshot or {})
            packaging_snapshot = _jsonify(_normalize_packaging_snapshot(getattr(source_order, "packaging_snapshot", {}) or {}))
            spec_signature = str(getattr(source_order, "spec_signature", "") or "").strip()
            target_qty_kg = Decimal(str(source_order.target_qty or 0))
            unit_weight_g = Decimal(str(source_order.unit_weight_g or 0))
            stock_purpose = str(getattr(source_order, "stock_purpose", "PRODUCT") or "PRODUCT").upper()
            quantity_uom = str(getattr(source_order, "quantity_uom", "KG") or "KG").upper()
            packaging_material = getattr(source_order, "packaging_material", None)
            source_stop = int(source_order.stop_step_index if source_order.stop_step_index is not None else route_last)
            if source_stop < route_last:
                default_output_type = "WIP_ROLL"
            else:
                default_output_type = "FG_POUCH" if str(template.fg_type or "").upper() == "POUCH" else "FG_ROLL"
            stock_strategy = self._normalize_stock_strategy(
                stock_strategy=getattr(source_order, "stock_strategy", ""),
                template=template,
                stock_purpose=stock_purpose,
                stop_step_index=source_stop,
            )
            planner_stock_class = self._derive_planner_stock_class(
                template=template,
                stock_purpose=stock_purpose,
                stop_step_index=source_stop,
                planner_stock_class=getattr(source_order, "planner_stock_class", ""),
            )

        if target_qty_kg <= 0:
            return Response({"error": "Source order has non-positive quantity and cannot be cloned."}, status=status.HTTP_400_BAD_REQUEST)

        if not spec_signature:
            spec_payload = build_spec_payload(
                fg_type=str(geometry_snapshot.get("finished_good_type") or template.fg_type or "POUCH").upper(),
                roll_form=geometry_snapshot.get("roll_form"),
                geometry=geometry_snapshot,
                film_layers=layer_snapshot,
                printing=printing_snapshot,
                addons=addons_snapshot,
            )
            spec_signature = build_spec_signature(spec_payload)

        inv_payload = build_invariant_payload(
            film_layers=layer_snapshot,
            printing=printing_snapshot
        )
        invariant_signature = build_invariant_signature(inv_payload)

        with transaction.atomic():
            clone = PlannedStockOrder.objects.create(
                internal_name=clone_name or f"Clone of {getattr(source_order, 'order_number', source_order.id)}",
                template=template,
                plant=getattr(source_order, "plant", None),
                target_qty=target_qty_kg,
                produced_qty=Decimal("0"),
                geometry_override=sanitize_geometry_override(geometry_snapshot or {}),
                geometry_snapshot=geometry_snapshot,
                layer_snapshot=layer_snapshot,
                printing_snapshot=printing_snapshot,
                addons_snapshot=addons_snapshot,
                packaging_snapshot=packaging_snapshot,
                bom_snapshot=bom_snapshot,
                spec_signature=spec_signature,
                invariant_signature=invariant_signature,
                unit_weight_g=unit_weight_g,
                total_weight_kg=target_qty_kg,
                quantity_uom=quantity_uom,
                stock_purpose=stock_purpose,
                stock_strategy=stock_strategy,
                planner_stock_class=planner_stock_class,
                packaging_material=packaging_material,
                output_type=str(default_output_type or "WIP_ROLL").upper(),
                start_step_index=0,
                stop_step_index=route_last,
                target_step_index=route_last,
                status="PLANNING_REQUIRED",
                created_by=created_by,
            )
            jobs_created = self._prime_stock_order_for_release(clone)

        return Response(
            {
                "status": "planned",
                "order_kind": "stock",
                "order_id": str(clone.id),
                "order_number": clone.order_number,
                "name": clone.internal_name,
                "order_status": clone.status,
                "jobs_created": len(jobs_created),
            },
            status=status.HTTP_201_CREATED,
        )

    # ---------------------------------------------------------------------
    # Control Hub APIs
    # ---------------------------------------------------------------------
    def _route_last_index(self, template) -> int:
        ordered = (template.routing_rule.ordered_processes if template and template.routing_rule else []) or []
        return max(0, len(ordered) - 1)

    def _route_step_label(self, template, step_index: int) -> str:
        ordered = (template.routing_rule.ordered_processes if template and template.routing_rule else []) or []
        try:
            index = int(step_index or 0)
        except Exception:
            index = 0
        if 0 <= index < len(ordered):
            step = ordered[index]
            process_name = getattr(getattr(step, "process", None), "name", "") or getattr(step, "name", "")
            if str(process_name or "").strip():
                return str(process_name).strip()
        return "Raw Material" if index <= 0 else f"Step {index}"

    def _first_roll_input_step(self, template) -> int:
        ordered = (template.routing_rule.ordered_processes if template and template.routing_rule else []) or []
        if not ordered:
            return 0
        process_map = {
            str(process.code): process
            for process in Process.objects.filter(code__in=ordered).only("code", "input_form")
        }
        for index, code in enumerate(ordered):
            process = process_map.get(str(code))
            if str(getattr(process, "input_form", "") or "").upper() == "ROLL":
                return index
        return 0

    def _route_step_input_form(self, template, step_index: int) -> str:
        routing_rule = getattr(template, "routing_rule", None) if template else None
        ordered = (routing_rule.ordered_processes if routing_rule else []) or []
        try:
            index = int(step_index or 0)
        except Exception:
            index = 0
        if index < 0 or index >= len(ordered):
            return ""
        code = str(ordered[index] or "")
        if not code:
            return ""
        try:
            process = Process.objects.filter(code=code).only("code", "input_form").first()
        except Exception:
            process = None
        return str(getattr(process, "input_form", "") or "").upper()

    def _route_step_accepts_roll_input(self, template, step_index: int) -> bool:
        return self._route_step_input_form(template, step_index) == "ROLL"

    def _route_step_tokens(self, template, step_index: int) -> str:
        routing_rule = getattr(template, "routing_rule", None) if template else None
        ordered = (routing_rule.ordered_processes if routing_rule else []) or []
        try:
            index = int(step_index or 0)
        except Exception:
            index = 0
        if index < 0 or index >= len(ordered):
            return ""
        code = str(ordered[index] or "")
        process = None
        if code:
            try:
                process = Process.objects.filter(code=code).only("code", "name").first()
            except Exception:
                process = None
        return f"{code} {getattr(process, 'name', '') or ''}".upper()

    def _route_step_is_extrusion(self, template, step_index: int) -> bool:
        tokens = self._route_step_tokens(template, step_index)
        return any(marker in tokens for marker in ("EXTR", "BLOWN FILM", "BLOW FILM"))

    def _route_step_can_start_from_purchased_roll(self, template, step_index: int) -> bool:
        if self._route_step_accepts_roll_input(template, step_index):
            return True
        tokens = self._route_step_tokens(template, step_index)
        if not tokens or self._route_step_is_extrusion(template, step_index):
            return False
        roll_consumer_markers = ("PRINT", "FLEXO", "ROTO", "LAMIN", "SLIT", "POUCH", "SEAL", "CUT")
        return any(marker in tokens for marker in roll_consumer_markers)

    def _upstream_stock_start_blocker(self, template, start_step_index: int) -> str:
        if self._route_step_can_start_from_purchased_roll(template, start_step_index):
            return ""
        step_label = self._route_step_label(template, start_step_index)
        input_form = self._route_step_input_form(template, start_step_index) or "UNKNOWN"
        return (
            f"Compatible roll input stock cannot start at {step_label}. "
            f"That step consumes {input_form}; use Fresh run or start from the next roll-input step."
        )

    def _sales_required_start_step(self, template, layer_snapshot) -> int:
        layers = layer_snapshot if isinstance(layer_snapshot, list) else []
        if not template or not getattr(template, "routing_rule", None) or not layers:
            return 0
        variant_ids = [
            str(layer.get("material_id") or layer.get("variant_id") or "").strip()
            for layer in layers
            if isinstance(layer, dict) and str(layer.get("material_id") or layer.get("variant_id") or "").strip()
        ]
        if not variant_ids:
            return 0
        unique_ids = list(dict.fromkeys(variant_ids))
        material_rows = {
            str(row["id"]): bool(row["is_extrudable"])
            for row in InventoryMaterial.objects.filter(id__in=unique_ids).values("id", "is_extrudable")
        }
        if len(material_rows) != len(unique_ids):
            return 0
        all_purchased = all(not bool(material_rows.get(variant_id, False)) for variant_id in unique_ids)
        return self._first_roll_input_step(template) if all_purchased else 0

    def _default_stock_strategy(self, *, template=None, stock_purpose="PRODUCT", stop_step_index=None):
        stock_purpose = str(stock_purpose or "PRODUCT").upper()
        if stock_purpose == "PACKAGING":
            return "PACKAGING_STOCK"
        route_last = self._route_last_index(template)
        stop_idx = route_last if stop_step_index is None else int(stop_step_index)
        if stop_idx < route_last:
            return "INTERMEDIATE_POOL"
        template_default = str(getattr(template, "default_stock_strategy", "") or "").upper()
        if template_default in {"FINAL_STOCK", "INTERMEDIATE_POOL"}:
            return template_default
        return "FINAL_STOCK"

    def _normalize_stock_strategy(self, *, stock_strategy=None, template=None, stock_purpose="PRODUCT", stop_step_index=None):
        requested = str(stock_strategy or "").strip().upper()
        normalized = requested or self._default_stock_strategy(
            template=template,
            stock_purpose=stock_purpose,
            stop_step_index=stop_step_index,
        )
        route_last = self._route_last_index(template)
        stop_idx = route_last if stop_step_index is None else int(stop_step_index)
        stock_purpose = str(stock_purpose or "PRODUCT").upper()
        if stock_purpose == "PACKAGING":
            return "PACKAGING_STOCK"
        if stop_idx < route_last:
            return "INTERMEDIATE_POOL"
        if normalized not in {"FINAL_STOCK", "INTERMEDIATE_POOL"}:
            return "FINAL_STOCK"
        return normalized

    def _derive_planner_stock_class(self, *, template=None, stock_purpose="PRODUCT", stop_step_index=None, planner_stock_class=None):
        requested = str(planner_stock_class or "").strip().upper()
        allowed = {"FINAL_PRODUCT", "FINAL_PLAIN_ROLL", "EXTRUDED_BASE_ROLL", "SHARED_INVARIANT_ROLL", "PACKAGING_STOCK"}
        if requested and requested not in allowed:
            requested = ""
        if requested:
            return requested
        stock_purpose = str(stock_purpose or "PRODUCT").upper()
        if stock_purpose == "PACKAGING":
            return "PACKAGING_STOCK"
        route_last = self._route_last_index(template)
        stop_idx = route_last if stop_step_index is None else int(stop_step_index)
        fg_type = str(getattr(template, "fg_type", "") or "").upper()
        if stop_idx < route_last:
            return "EXTRUDED_BASE_ROLL" if stop_idx <= 0 else "SHARED_INVARIANT_ROLL"
        if fg_type == "ROLL":
            return "FINAL_PLAIN_ROLL"
        return "FINAL_PRODUCT"

    def _is_same_order_lineage_roll(self, roll, order_kind: str, order_obj) -> bool:
        if order_kind == "sales":
            sales_order_id = str(getattr(order_obj, "id", "") or "")
            if not sales_order_id:
                return False
            direct_item = getattr(roll, "sales_order_item", None)
            if direct_item and str(getattr(direct_item, "sales_order_id", "") or "") == sales_order_id:
                return True
            origin_job = getattr(roll, "created_by_job", None) or getattr(roll, "production_job", None)
            source_item = getattr(origin_job, "sales_order_item", None) if origin_job else None
            return bool(source_item and str(getattr(source_item, "sales_order_id", "") or "") == sales_order_id)
        origin_stock_order = self._origin_stock_order_for_roll(roll)
        return bool(origin_stock_order and str(getattr(origin_stock_order, "id", "") or "") == str(getattr(order_obj, "id", "") or ""))

    def _planner_stock_class_for_order(self, order_obj, template=None) -> str:
        return str(
            getattr(order_obj, "planner_stock_class", "") or self._derive_planner_stock_class(
                template=template or getattr(order_obj, "template", None),
                stock_purpose=getattr(order_obj, "stock_purpose", "PRODUCT"),
                stop_step_index=getattr(order_obj, "stop_step_index", None),
            )
        )

    def _planner_stock_class_for_roll(self, roll) -> str:
        origin_stock_order = self._origin_stock_order_for_roll(roll)
        if origin_stock_order:
            return self._planner_stock_class_for_order(origin_stock_order, getattr(origin_stock_order, "template", None))
        if int(getattr(roll, "completed_step_index", 0) or 0) <= 0:
            return "EXTRUDED_BASE_ROLL"
        return ""

    def _planner_stock_class_for_batch(self, batch) -> str:
        origin_stock_order = self._origin_stock_order_for_batch(batch)
        if origin_stock_order:
            return self._planner_stock_class_for_order(origin_stock_order, getattr(origin_stock_order, "template", None))
        return "FINAL_PRODUCT"

    def _sales_primary_template(self, sales_order):
        first_item = sales_order.items.select_related("template", "template__routing_rule").first()
        return first_item.template if first_item else None

    def _sales_item_for_template(self, sales_order, template):
        items = list(sales_order.items.select_related("template").all())
        if not items:
            return None
        if template is None:
            return items[0]
        for item in items:
            if getattr(item, "template_id", None) == getattr(template, "id", None):
                return item
        return items[0]

    def _order_qty_kg(self, order_kind: str, order_obj) -> Decimal:
        if order_kind == "sales":
            return Decimal(str(order_obj.total_weight_kg or 0))
        return Decimal(str(order_obj.target_qty or 0))

    def _sales_item_partial_metrics(self, so_item, route_last_index: int):
        target_kg = Decimal(str(getattr(so_item, "total_weight_kg", 0) or 0))
        produced_kg = Decimal(
            str(
                JobExecutionLog.objects.filter(
                    production_job__sales_order_item=so_item,
                    production_job__current_step_index=route_last_index,
                    production_job__job_state="COMPLETED",
                ).aggregate(total=Sum("quantity")).get("total")
                or 0
            )
        )
        has_started_final_output = produced_kg > 0
        shortfall_kg = Decimal("0")
        shortfall_pct = Decimal("0")
        requires_replan = False
        if has_started_final_output:
            shortfall_kg = target_kg - produced_kg
            if shortfall_kg < 0:
                shortfall_kg = Decimal("0")
            if target_kg > 0:
                shortfall_pct = (shortfall_kg * Decimal("100")) / target_kg
            requires_replan = bool(shortfall_kg > 0 and shortfall_pct > Decimal("5.0"))
        return {
            "target_kg": target_kg,
            "produced_kg": produced_kg,
            "shortfall_kg": shortfall_kg,
            "shortfall_pct": shortfall_pct,
            "requires_replan": requires_replan,
            "has_started_final_output": has_started_final_output,
        }

    def _sales_partial_metrics(self, sales_order, route_last_index: int):
        so_item = sales_order.items.first()
        if not so_item:
            return {
                "target_kg": Decimal("0"),
                "produced_kg": Decimal("0"),
                "shortfall_kg": Decimal("0"),
                "shortfall_pct": Decimal("0"),
                "requires_replan": False,
            }
        return self._sales_item_partial_metrics(so_item, route_last_index)

    def _calculate_stock_pcs(self, order, template) -> float:
        """
        Calculates piece count for stock orders based on target quantity and physics.
        """
        try:
            if str(getattr(template, "fg_type", "") or "").upper() == "ROLL":
                return 0
            if str(getattr(order, "quantity_uom", "") or "").upper() == "PCS":
                return float(Decimal(str(getattr(order, "target_qty", 0) or 0)))
            unit_weight_g = Decimal(str(getattr(order, "unit_weight_g", 0) or 0))
            if unit_weight_g <= 0:
                norm_geo = order.geometry_snapshot or normalize_geometry_override({}, order.geometry_override)
                preview = SalesOrderService.preview_sales_item(
                    {
                        "finished_good_type": getattr(order, "geometry_snapshot", {}).get("finished_good_type") or template.fg_type,
                        "geometry": norm_geo,
                        "film_layers": order.layer_snapshot or [],
                        "printing": order.printing_snapshot or {},
                        "chemicals": (order.printing_snapshot or {}).get("chemicals") or {},
                        "addons": order.addons_snapshot or [],
                        "order_qty": float(order.target_qty or 0),
                        "uom": "KG",
                    }
                )
                unit_weight_g = Decimal(str(preview.get("unit_weight_g") or 0))
            if unit_weight_g > 0:
                return float((Decimal(str(order.target_qty)) * Decimal("1000")) / unit_weight_g)
        except Exception:
            pass
        return 0

    def _roll_invariants(self, *, layer_snapshot=None, required_qty_kg: Decimal = Decimal("0")):
        layers = layer_snapshot if isinstance(layer_snapshot, list) else []
        first = layers[0] if layers and isinstance(layers[0], dict) else {}
        width_mm = Decimal(str(first.get("roll_width_mm") or first.get("width_mm") or 0))
        thickness_micron = Decimal(str(first.get("thickness_micron") or 0))
        density_gcm3 = Decimal(str(first.get("density_g_cm3") or 0))
        area_m2 = Decimal("0")
        length_m = Decimal("0")
        if required_qty_kg > 0 and thickness_micron > 0 and density_gcm3 > 0:
            thickness_m = thickness_micron / Decimal("1000000")
            density_kg_m3 = density_gcm3 * Decimal("1000")
            area_m2 = PhysicsEngine.roll_area_m2(required_qty_kg, thickness_m, density_kg_m3)
            if width_mm > 0:
                length_m = PhysicsEngine.roll_length_m(area_m2, width_mm / Decimal("1000"))
        return {
            "width_mm": float(round(width_mm, 2)) if width_mm > 0 else None,
            "thickness_micron": float(round(thickness_micron, 4)) if thickness_micron > 0 else None,
            "density_gcm3": float(round(density_gcm3, 6)) if density_gcm3 > 0 else None,
            "derived_area_m2": float(round(area_m2, 6)) if area_m2 > 0 else None,
            "derived_length_m": float(round(length_m, 6)) if length_m > 0 else None,
        }

    def _math_state(self, *, required_qty_kg: Decimal, qty_uom: str, unit_weight_g: Decimal, fg_type: str = "POUCH", roll_invariants=None):
        if required_qty_kg <= 0:
            return False, "Could not derive required KG from current product math."
        if str(fg_type or "").upper() == "ROLL":
            inv = roll_invariants or {}
            if not inv.get("width_mm"):
                return False, "Roll width is missing."
            if not inv.get("thickness_micron"):
                return False, "Roll thickness is missing."
            if not inv.get("density_gcm3"):
                return False, "Roll density is missing."
            return True, ""
        if str(qty_uom or "").upper() == "PCS" and unit_weight_g <= 0:
            return False, "PCS-to-KG conversion is unavailable because unit weight is 0."
        return True, ""

    def _inventory_active_allocation_maps(self):
        roll_alloc = {
            str(row["inventory_roll"]): Decimal(str(row["total"] or 0))
            for row in InventoryAllocation.objects.filter(status="ACTIVE", inventory_roll__isnull=False)
            .values("inventory_roll")
            .annotate(total=Sum("allocated_qty_kg"))
        }
        fg_alloc = {
            str(row["fg_batch"]): Decimal(str(row["total"] or 0))
            for row in InventoryAllocation.objects.filter(status="ACTIVE", fg_batch__isnull=False)
            .values("fg_batch")
            .annotate(total=Sum("allocated_qty_kg"))
        }
        return roll_alloc, fg_alloc

    def _order_signature(
        self,
        *,
        spec_signature=None,
        geometry_snapshot=None,
        geometry_override=None,
        layer_snapshot=None,
        printing_snapshot=None,
        addons_snapshot=None,
        template=None,
    ):
        if spec_signature:
            return str(spec_signature)
        normalized_geometry = normalize_geometry_override({}, geometry_snapshot or geometry_override or {})
        fg_type = str(
            normalized_geometry.get("finished_good_type")
            or normalized_geometry.get("fg_type")
            or getattr(template, "fg_type", None)
            or "POUCH"
        ).upper()
        if fg_type not in {"POUCH", "ROLL"}:
            fg_type = "POUCH"
        normalized_geometry["finished_good_type"] = fg_type
        if fg_type != "ROLL":
            normalized_geometry.pop("roll_form", None)
        spec_payload = build_spec_payload(
            fg_type=fg_type,
            roll_form=normalized_geometry.get("roll_form"),
            geometry=normalized_geometry,
            film_layers=layer_snapshot or [],
            printing=printing_snapshot or {},
            addons=addons_snapshot or [],
        )
        return build_spec_signature(spec_payload)

    def _order_invariant_signature(
        self,
        *,
        invariant_signature=None,
        layer_snapshot=None,
        printing_snapshot=None,
    ):
        if invariant_signature:
            return str(invariant_signature)
        
        inv_payload = build_invariant_payload(
            film_layers=layer_snapshot or [],
            printing=printing_snapshot or {},
        )
        return build_invariant_signature(inv_payload)

    def _layer_only_invariant_signature(self, layer_snapshot=None):
        inv_payload = build_invariant_payload(
            film_layers=layer_snapshot or [],
            printing={"enabled": False},
        )
        return build_invariant_signature(inv_payload)

    def _is_pre_artwork_shared_stock(self, stock, template=None) -> bool:
        scope = str(getattr(stock, "commitment_scope", "") or "GENERIC").upper()
        if scope not in {"GENERIC", "CUSTOMER"}:
            return False
        route_template = template or getattr(stock, "template", None)
        first_artwork = first_artwork_step_index(route_template)
        if first_artwork is None:
            return False
        stock_stop = int(getattr(stock, "stop_step_index", 0) or 0)
        return stock_stop < int(first_artwork)

    def _roll_signature(self, roll):
        meta = getattr(roll, "meta_json", {}) or {}
        if meta.get("spec_signature"):
            return str(meta.get("spec_signature"))
        if getattr(roll, "sales_order_item", None) and getattr(roll.sales_order_item, "spec_signature", None):
            return str(roll.sales_order_item.spec_signature)
        origin_job = getattr(roll, "created_by_job", None) or getattr(roll, "production_job", None)
        if origin_job and getattr(origin_job, "mts_order", None) and getattr(origin_job.mts_order, "spec_signature", None):
            return str(origin_job.mts_order.spec_signature)
        return ""

    def _fg_signature(self, fg_batch):
        if getattr(fg_batch, "sales_order_item", None) and getattr(fg_batch.sales_order_item, "spec_signature", None):
            return str(fg_batch.sales_order_item.spec_signature)
        origin_job = getattr(fg_batch, "production_job", None)
        if origin_job and getattr(origin_job, "mts_order", None) and getattr(origin_job.mts_order, "spec_signature", None):
            return str(origin_job.mts_order.spec_signature)
        return ""

    def _roll_invariant_signature(self, roll):
        meta = getattr(roll, "meta_json", {}) or {}
        if meta.get("invariant_signature"):
            return str(meta.get("invariant_signature"))
        if getattr(roll, "sales_order_item", None) and getattr(roll.sales_order_item, "invariant_signature", None):
            return str(roll.sales_order_item.invariant_signature)
        origin_job = getattr(roll, "created_by_job", None) or getattr(roll, "production_job", None)
        if origin_job and getattr(origin_job, "mts_order", None) and getattr(origin_job.mts_order, "invariant_signature", None):
            return str(origin_job.mts_order.invariant_signature)
        return ""

    def _fg_invariant_signature(self, fg_batch):
        if getattr(fg_batch, "sales_order_item", None) and getattr(fg_batch.sales_order_item, "invariant_signature", None):
            return str(fg_batch.sales_order_item.invariant_signature)
        origin_job = getattr(fg_batch, "production_job", None)
        if origin_job and getattr(origin_job, "mts_order", None) and getattr(origin_job.mts_order, "invariant_signature", None):
            return str(origin_job.mts_order.invariant_signature)
        return ""

    @staticmethod
    def _safe_id(value) -> str:
        if value in (None, ""):
            return ""
        return str(value)

    def _stock_commitment_matches_sales_item(self, stock, sales_item) -> bool:
        if not stock or not sales_item:
            return True

        stock_product_master_id = self._safe_id(getattr(stock, "product_master_id", None) or getattr(getattr(stock, "product_master", None), "id", None))
        sales_product_master_id = self._safe_id(getattr(sales_item, "product_master_id", None) or getattr(getattr(sales_item, "product_master", None), "id", None))
        if stock_product_master_id and sales_product_master_id and stock_product_master_id != sales_product_master_id:
            return False

        scope = str(getattr(stock, "commitment_scope", "") or "GENERIC").upper()
        if scope == "GENERIC":
            return True
        if scope not in {"CUSTOMER", "ARTWORK", "CUSTOMER_ARTWORK"}:
            return False

        sales_order = getattr(sales_item, "sales_order", None)
        sales_customer_id = self._safe_id(
            getattr(sales_order, "customer_id", None) or getattr(getattr(sales_order, "customer", None), "id", None)
        )
        stock_customer_id = self._safe_id(
            getattr(stock, "committed_customer_id", None) or getattr(getattr(stock, "committed_customer", None), "id", None)
        )
        if scope in {"CUSTOMER", "CUSTOMER_ARTWORK"}:
            if not stock_customer_id or not sales_customer_id or stock_customer_id != sales_customer_id:
                return False

        printing = getattr(sales_item, "printing_snapshot", {}) or {}
        if not isinstance(printing, dict):
            printing = {}
        sales_artwork_ids = {
            self._safe_id(getattr(sales_item, "assigned_artwork_id", None)),
            self._safe_id(getattr(getattr(sales_item, "assigned_artwork", None), "id", None)),
            self._safe_id(printing.get("artwork_id")),
            self._safe_id(printing.get("artwork")),
            self._safe_id(printing.get("artwork_ref")),
        }
        sales_artwork_ids.discard("")
        stock_artwork_id = self._safe_id(
            getattr(stock, "committed_artwork_id", None) or getattr(getattr(stock, "committed_artwork", None), "id", None)
        )
        if scope in {"ARTWORK", "CUSTOMER_ARTWORK"}:
            if not stock_artwork_id or stock_artwork_id not in sales_artwork_ids:
                return False

        return True

    def _stock_commitment_mismatch_message(self, stock, sales_item, label: str) -> str:
        scope = str(getattr(stock, "commitment_scope", "") or "GENERIC").upper()
        if scope in {"CUSTOMER", "CUSTOMER_ARTWORK"}:
            sales_order = getattr(sales_item, "sales_order", None)
            sales_customer_id = self._safe_id(
                getattr(sales_order, "customer_id", None) or getattr(getattr(sales_order, "customer", None), "id", None)
            )
            stock_customer_id = self._safe_id(
                getattr(stock, "committed_customer_id", None) or getattr(getattr(stock, "committed_customer", None), "id", None)
            )
            if stock_customer_id != sales_customer_id:
                return f"{label} is committed to a different customer and cannot be claimed to this sales order."
        if scope in {"ARTWORK", "CUSTOMER_ARTWORK"}:
            return f"{label} is artwork-committed and cannot be claimed unless the sales item uses the same approved artwork."
        return f"{label} commitment scope does not match this sales order."

    def _sales_item_roll_width_mm(self, sales_item) -> Decimal:
        if not sales_item:
            return Decimal("0")
        direct = _numeric(getattr(sales_item, "planned_parent_width_mm", None))
        if direct > 0:
            return direct
        return _snapshot_max_roll_width_mm(
            getattr(sales_item, "geometry_snapshot", None) or {},
            getattr(sales_item, "layer_snapshot", None) or [],
        )

    def _stock_order_roll_width_mm(self, stock_order) -> Decimal:
        if not stock_order:
            return Decimal("0")
        width = _numeric((getattr(stock_order, "planner_origin_meta", None) or {}).get("wip_roll_width_mm"))
        if width > 0:
            return width
        return _snapshot_max_roll_width_mm(
            getattr(stock_order, "geometry_snapshot", None) or {},
            getattr(stock_order, "layer_snapshot", None) or [],
        )

    def _width_match_payload(self, stock_width: Decimal, required_width: Decimal):
        stock_width = _numeric(stock_width)
        required_width = _numeric(required_width)
        if stock_width <= 0 or required_width <= 0:
            return True, {
                "required_width_mm": float(required_width) if required_width > 0 else None,
                "stock_width_mm": float(stock_width) if stock_width > 0 else None,
                "width_match_mode": "WIDTH_NOT_REQUIRED",
                "can_slit_to_required_width": False,
            }
        tolerance = Decimal("0.01")
        if stock_width + tolerance < required_width:
            return False, {
                "required_width_mm": float(required_width),
                "stock_width_mm": float(stock_width),
                "width_match_mode": "TOO_NARROW",
                "can_slit_to_required_width": False,
            }
        exact = abs(stock_width - required_width) <= tolerance
        return True, {
            "required_width_mm": float(required_width),
            "stock_width_mm": float(stock_width),
            "width_match_mode": "EXACT_WIDTH" if exact else "WIDER_SLITTABLE",
            "can_slit_to_required_width": not exact,
        }

    def _stopped_stock_order_allocatable_roll_qty(self, stock_order, stop_step_index: int):
        if not getattr(stock_order, "_meta", None):
            return None
        roll_rows = list(
            InventoryRoll.objects.filter(
                status="AVAILABLE",
                sales_order_item__isnull=True,
                completed_step_index=int(stop_step_index or 0),
            )
            .filter(Q(created_by_job__mts_order=stock_order) | Q(production_job__mts_order=stock_order))
            .values("id", "weight_kg")
        )
        if not roll_rows:
            return None
        roll_ids = [row.get("id") for row in roll_rows if row.get("id")]
        allocation_rows = (
            InventoryAllocation.objects.filter(status="ACTIVE", inventory_roll_id__in=roll_ids)
            .values("inventory_roll_id")
            .annotate(total=Sum("allocated_qty_kg"))
        )
        allocated_by_roll = {
            str(row.get("inventory_roll_id")): Decimal(str(row.get("total") or 0))
            for row in allocation_rows
        }
        total = Decimal("0")
        for row in roll_rows:
            roll_id = str(row.get("id"))
            total += max(Decimal("0"), Decimal(str(row.get("weight_kg") or 0)) - allocated_by_roll.get(roll_id, Decimal("0")))
        return total

    def _matching_stock_orders_for_sales(self, template, order_signature: str, order_invariant_signature: str, required_start_step: int, sales_item=None):
        matches = []
        route_last = self._route_last_index(template)
        order_layer_only_signature = self._layer_only_invariant_signature(getattr(sales_item, "layer_snapshot", None)) if sales_item else ""
        required_width_mm = self._sales_item_roll_width_mm(sales_item)
        stock_orders = (
            PlannedStockOrder.objects.filter(template=template, status__in=["PLANNED", "RELEASED", "STOCK_READY", "COMPLETED"])
            .order_by("-updated_at")
        )
        for stock in stock_orders:
            if not self._stock_commitment_matches_sales_item(stock, sales_item):
                continue
            stock_sig = self._order_signature(
                spec_signature=getattr(stock, "spec_signature", ""),
                geometry_snapshot=stock.geometry_snapshot or {},
                geometry_override=stock.geometry_override or {},
                layer_snapshot=stock.layer_snapshot or [],
                printing_snapshot=stock.printing_snapshot or {},
                addons_snapshot=stock.addons_snapshot or [],
                template=template,
            )
            stock_inv_sig = self._order_invariant_signature(
                invariant_signature=getattr(stock, "invariant_signature", ""),
                layer_snapshot=stock.layer_snapshot or [],
                printing_snapshot=stock.printing_snapshot or {},
            )

            stock_stop = int(stock.stop_step_index if stock.stop_step_index is not None else self._route_last_index(template))
            if stock_stop < required_start_step:
                continue

            matches_sig = False
            match_mode = ""
            stock_strategy = self._normalize_stock_strategy(
                stock_strategy=getattr(stock, "stock_strategy", ""),
                template=template,
                stock_purpose=getattr(stock, "stock_purpose", "PRODUCT"),
                stop_step_index=stock_stop,
            )
            is_stopped_route_candidate = stock_strategy == "INTERMEDIATE_POOL" or stock_stop < route_last
            if stock_strategy == "PACKAGING_STOCK":
                continue
            if order_signature and stock_sig == order_signature:
                matches_sig = True
                match_mode = "EXACT_SPEC"
            elif is_stopped_route_candidate and order_invariant_signature and stock_inv_sig == order_invariant_signature:
                matches_sig = True
                match_mode = "SEMI_INVARIANT"
            elif (
                is_stopped_route_candidate
                and order_layer_only_signature
                and self._is_pre_artwork_shared_stock(stock, template)
                and self._layer_only_invariant_signature(stock.layer_snapshot or []) == order_layer_only_signature
            ):
                matches_sig = True
                match_mode = "PRE_ARTWORK_INVARIANT"
            
            if not matches_sig:
                continue

            width_payload = {}
            if is_stopped_route_candidate:
                width_ok, width_payload = self._width_match_payload(
                    self._stock_order_roll_width_mm(stock),
                    required_width_mm,
                )
                if not width_ok:
                    continue

            active_alloc = (
                InventoryAllocation.objects.filter(status="ACTIVE", mts_order=stock)
                .aggregate(total=Sum("allocated_qty_kg"))
                .get("total")
                or Decimal("0")
            )
            remaining_qty = Decimal(str(stock.target_qty or 0)) - Decimal(str(stock.produced_qty or 0)) - Decimal(str(active_alloc or 0))
            if is_stopped_route_candidate:
                stopped_roll_qty = self._stopped_stock_order_allocatable_roll_qty(stock, stock_stop)
                if stopped_roll_qty is not None:
                    remaining_qty = stopped_roll_qty
            if remaining_qty <= 0:
                continue

            matches.append(
                {
                    "order_id": str(stock.id),
                    "order_number": stock.order_number,
                    "status": stock.status,
                    "start_step_index": int(stock.start_step_index or 0),
                    "stop_step_index": stock_stop,
                    "stock_strategy": stock_strategy,
                    "planner_stock_class": self._planner_stock_class_for_order(stock, template),
                    "match_mode": match_mode,
                    "remaining_qty_kg": float(max(Decimal("0"), remaining_qty)),
                    "produced_qty_kg": float(stock.produced_qty or 0),
                    **width_payload,
                }
            )
        return matches

    def _compute_effective_dims(self, geometry_override, geometry_schema):
        """Compute effective W x H from base dims + adjustments."""
        geo = geometry_override or {}
        base = geo.get("base", geo)  # might be flat or nested
        w = float(base.get("width_mm", 0) or geometry_schema.get("base", {}).get("width_mm", 0))
        h = float(base.get("height_mm", 0) or geometry_schema.get("base", {}).get("height_mm", 0))
        for adj in geo.get("adjustments", []):
            val = float(adj.get("value", 0) or 0)
            impact = (adj.get("impact") or "WIDTH").upper()
            if impact in ("WIDTH", "BOTH"):
                w += val
            if impact in ("HEIGHT", "BOTH"):
                h += val

        return {"width_mm": round(w, 2), "height_mm": round(h, 2)}

    def _material_plan_payload(self, bom_snapshot):
        payload = bom_snapshot if isinstance(bom_snapshot, dict) else {}
        lines = payload.get("planning_lines") if isinstance(payload.get("planning_lines"), list) else []
        summary = payload.get("planning_summary") if isinstance(payload.get("planning_summary"), dict) else None
        if not summary:
            summary = _summarize_material_plan_lines(lines)
        return lines, summary

    def _bom_readiness_payload(self, bom_snapshot):
        errors = bom_readiness_errors(bom_snapshot)
        return {
            "bom_ready": not bool(errors),
            "bom_readiness_errors": errors,
        }

    def _purchasable_roll_input_variant_ids(self, template, layer_snapshot, required_start_step) -> set[str]:
        if not self._route_step_can_start_from_purchased_roll(template, int(required_start_step or 0)):
            return set()
        layers = layer_snapshot if isinstance(layer_snapshot, list) else []
        variant_ids = [
            str(layer.get("material_id") or layer.get("variant_id") or "").strip()
            for layer in layers
            if isinstance(layer, dict) and str(layer.get("material_id") or layer.get("variant_id") or "").strip()
        ]
        if not variant_ids:
            return set()
        return {
            str(row["id"])
            for row in InventoryMaterial.objects.filter(id__in=list(dict.fromkeys(variant_ids))).values("id", "is_purchasable")
            if bool(row.get("is_purchasable"))
        }

    def _purchasable_roll_input_error_identifiers(self, template, layer_snapshot, required_start_step) -> set[str]:
        purchasable_variant_ids = self._purchasable_roll_input_variant_ids(
            template,
            layer_snapshot,
            required_start_step,
        )
        if not purchasable_variant_ids:
            return set()

        identifiers = set(purchasable_variant_ids)
        for layer in layer_snapshot if isinstance(layer_snapshot, list) else []:
            if not isinstance(layer, dict):
                continue
            variant_id = str(layer.get("material_id") or layer.get("variant_id") or "").strip()
            if variant_id not in purchasable_variant_ids:
                continue
            # The BOM resolver reports missing extrusion recipes by grade id,
            # not by film variant id. Keep both ids tied to the same verified
            # purchasable layer so stale EXTRUDE snapshots do not block routes
            # that physically start from purchased roll stock.
            for key in ("grade_id", "material_grade_id"):
                value = str(layer.get(key) or "").strip()
                if value:
                    identifiers.add(value)
        return identifiers

    def _layer_material_ids(self, layer_snapshot) -> list[str]:
        ids = []
        for layer in layer_snapshot if isinstance(layer_snapshot, list) else []:
            if not isinstance(layer, dict):
                continue
            material_id = str(layer.get("material_id") or layer.get("variant_id") or "").strip()
            if material_id:
                ids.append(material_id)
        return list(dict.fromkeys(ids))

    def _missing_recipe_error_is_purchasable_roll_input(self, error: str, purchasable_variant_ids: set[str]) -> bool:
        text = str(error or "")
        if "No recipe for" not in text:
            return False
        return any(variant_id and variant_id in text for variant_id in purchasable_variant_ids)

    def _effective_bom_readiness_payload(self, bom_snapshot, *, template=None, layer_snapshot=None, required_start_step=None):
        errors = bom_readiness_errors(bom_snapshot)
        purchasable_error_identifiers = self._purchasable_roll_input_error_identifiers(
            template,
            layer_snapshot,
            required_start_step,
        )
        if purchasable_error_identifiers:
            errors = [
                error for error in errors
                if not self._missing_recipe_error_is_purchasable_roll_input(error, purchasable_error_identifiers)
            ]
        return {
            "bom_ready": not bool(errors),
            "bom_readiness_errors": errors,
        }

    def _roll_input_purchase_layer_snapshot(self, template, layer_snapshot, required_start_step):
        purchasable_variant_ids = self._purchasable_roll_input_variant_ids(
            template,
            layer_snapshot,
            required_start_step,
        )
        if not purchasable_variant_ids:
            return layer_snapshot
        adjusted = []
        changed = False
        for layer in layer_snapshot if isinstance(layer_snapshot, list) else []:
            if not isinstance(layer, dict):
                adjusted.append(layer)
                continue
            variant_id = str(layer.get("material_id") or layer.get("variant_id") or "").strip()
            if variant_id in purchasable_variant_ids:
                row = dict(layer)
                if str(row.get("source_mode") or "").upper() != "PURCHASE":
                    row["source_mode"] = "PURCHASE"
                    changed = True
                adjusted.append(row)
            else:
                adjusted.append(layer)
        return adjusted if changed else layer_snapshot

    def _row_blockers(self, row: dict):
        blockers = []
        if bool(row.get("row_error")):
            blockers.append(
                {
                    "code": "ROW_ERROR",
                    "message": str(row.get("row_error")),
                    "severity": "HIGH",
                    "resolvable": True,
                }
            )
        if row.get("math_valid") is False:
            blockers.append(
                {
                    "code": "MATH_INVALID",
                    "message": str(row.get("math_error") or "Planner math is invalid for this order."),
                    "severity": "HIGH",
                    "resolvable": True,
                }
            )
        bom_errors = row.get("bom_readiness_errors") if isinstance(row.get("bom_readiness_errors"), list) else []
        if bom_errors:
            first_error = str(bom_errors[0] or "BOM is not production-ready.").strip()
            blockers.append(
                {
                    "code": "BOM_NOT_READY",
                    "message": f"Recipe/BOM is not production-ready: {first_error}",
                    "severity": "HIGH",
                    "resolvable": True,
                }
            )
        if (
            bool(row.get("printing_enabled"))
            and bool(row.get("artwork_assignment_required"))
            and not str(row.get("assigned_artwork_id") or "").strip()
        ):
            blockers.append(
                {
                    "code": "ARTWORK_REQUIRED",
                    "message": "Artwork assignment is required before release.",
                    "severity": "MEDIUM",
                    "resolvable": True,
                }
            )
        if bool(row.get("inventory_options_error")):
            blockers.append(
                {
                    "code": "INVENTORY_LOOKUP_ERROR",
                    "message": str(row.get("inventory_options_error")),
                    "severity": "MEDIUM",
                    "resolvable": True,
                }
            )
        if bool(row.get("partial_replan_required")):
            shortfall = Decimal(str(row.get("partial_shortfall_kg") or 0))
            if shortfall > 0:
                blockers.append(
                    {
                        "code": "PARTIAL_SHORTFALL",
                        "message": f"Remaining {float(shortfall):.3f} KG still needs planning or short-close.",
                        "severity": "MEDIUM",
                        "resolvable": True,
                    }
                )
        return blockers

    def _row_summary(self, row: dict):
        summary = row.get("material_plan_summary") if isinstance(row.get("material_plan_summary"), dict) else {}
        required_qty_kg = Decimal(str(row.get("required_qty_kg") or 0))
        inventory_options = row.get("inventory_options") if isinstance(row.get("inventory_options"), list) else []
        allocatable_kg = Decimal("0")
        for option in inventory_options:
            try:
                allocatable_kg += Decimal(str((option or {}).get("allocatable_qty_kg") or 0))
            except Exception:
                continue
        coverage_pct = Decimal("0")
        if required_qty_kg > 0:
            coverage_pct = (allocatable_kg / required_qty_kg) * Decimal("100")
            if coverage_pct > 100:
                coverage_pct = Decimal("100")
        return {
            "required_qty_kg": float(required_qty_kg),
            "allocatable_qty_kg": float(allocatable_kg),
            "coverage_pct": float(coverage_pct.quantize(Decimal("0.01")) if required_qty_kg > 0 else Decimal("0")),
            "theoretical_total_qty": float(summary.get("theoretical_total_qty") or 0),
            "planned_issue_total_qty": float(summary.get("planned_issue_total_qty") or 0),
            "override_count": int(summary.get("override_count") or 0),
            "line_count": int(summary.get("line_count") or 0),
        }

    def _row_workspace(self, row: dict):
        return {
            "material_plan_lines": row.get("material_plan_lines") if isinstance(row.get("material_plan_lines"), list) else [],
            "material_plan_summary": row.get("material_plan_summary") if isinstance(row.get("material_plan_summary"), dict) else {},
            "inventory_options": row.get("inventory_options") if isinstance(row.get("inventory_options"), list) else [],
            "matching_stock_orders": row.get("matching_stock_orders") if isinstance(row.get("matching_stock_orders"), list) else [],
            "source_availability": row.get("source_availability") if isinstance(row.get("source_availability"), dict) else {},
        }

    def _recommended_source_option(self, row: dict):
        source = row.get("source_availability") if isinstance(row.get("source_availability"), dict) else {}
        if bool(source.get("has_fg")):
            return "FG"
        if bool(source.get("has_carry_forward_wip")):
            return "WIP_CONTINUE"
        if bool(source.get("has_shared_invariant_roll_stock")):
            return "SHARED_INVARIANT"
        if bool(source.get("has_compatible_upstream_roll")):
            return "UPSTREAM_STOCK"
        return "FRESH"

    def _row_source_summary(self, row: dict):
        source = row.get("source_availability") if isinstance(row.get("source_availability"), dict) else {}
        matching_stock_orders = row.get("matching_stock_orders") if isinstance(row.get("matching_stock_orders"), list) else []
        recommendation = self._recommended_source_option(row)
        recommendation_label = {
            "FG": "Use finished stock",
            "WIP_CONTINUE": "Carry forward WIP",
            "SHARED_INVARIANT": "Use shared invariant roll stock",
            "UPSTREAM_STOCK": "Use compatible upstream roll stock",
            "FRESH": "Plan fresh conversion",
        }.get(recommendation, "Review source options.")
        return {
            "fg_match_count": int(source.get("fg_match_count") or 0),
            "wip_match_count": int(source.get("wip_match_count") or 0),
            "carry_forward_wip_count": int(source.get("carry_forward_wip_count") or 0),
            "shared_invariant_roll_count": int(source.get("shared_invariant_roll_count") or 0),
            "compatible_upstream_roll_match_count": int(source.get("compatible_upstream_roll_match_count") or 0),
            "fresh_raw_input_count": int(source.get("fresh_raw_input_count") or 0),
            "pod_bulk_material_count": int(source.get("pod_bulk_material_count") or 0),
            "pod_bulk_qty_kg": float(source.get("pod_bulk_qty_kg") or 0),
            "pod_inhouse_producible_count": int(source.get("pod_inhouse_producible_count") or 0),
            "packaging_stock_material_count": int(source.get("packaging_stock_material_count") or 0),
            "packaging_inhouse_producible_count": int(source.get("packaging_inhouse_producible_count") or 0),
            "matching_stock_order_count": len(matching_stock_orders),
            "recommended_option": recommendation,
            "recommended_label": recommendation_label,
        }

    def _continuation_label_for_mode(self, mode: str) -> str:
        normalized = str(mode or "").upper()
        return {
            "EXACT_FG": "Use exact finished stock",
            "EXACT_STOCK_ROUTE": "Continue exact stock order route",
            "CARRY_FORWARD_WIP": "Continue carry-forward WIP",
            "SHARED_INVARIANT_ROUTE": "Use shared invariant continuation",
            "UPSTREAM_ROUTE": "Use upstream / base roll path",
            "POD_BULK": "Create POD replenishment",
            "PACKAGING_STOCK": "Create packaging replenishment",
            "FRESH": "Plan fresh conversion",
        }.get(normalized, "Review continuation path")

    def _continuation_reason_for_mode(self, mode: str) -> str:
        normalized = str(mode or "").upper()
        return {
            "EXACT_FG": "A matching final FG candidate is already available.",
            "EXACT_STOCK_ROUTE": "A planner stock order already carries the same final spec and can be continued instead of starting fresh.",
            "CARRY_FORWARD_WIP": "The same order lineage already has downstream-eligible WIP.",
            "SHARED_INVARIANT_ROUTE": "A compatible semi-finished invariant route can satisfy the remaining process span.",
            "UPSTREAM_ROUTE": "A compatible upstream/base roll can feed the remaining route safely.",
            "POD_BULK": "Planner-owned POD replenishment is required for this row.",
            "PACKAGING_STOCK": "Planner-owned packaging replenishment is required for this row.",
            "FRESH": "No direct reuse path is ready, so this row needs a fresh production run.",
        }.get(normalized, "Review the source path before release.")

    def _continuation_candidate_label(self, *, stock_strategy=None, planner_stock_class=None, source_bucket=None, is_stock_order=False, match_mode=None) -> str:
        strategy = str(stock_strategy or "").upper()
        planner_class = str(planner_stock_class or "").upper()
        bucket = str(source_bucket or "").upper()
        mode = str(match_mode or "").upper()

        if is_stock_order:
            if mode == "EXACT_SPEC":
                return "Stopped exact route"
            if strategy == "FINAL_STOCK":
                return "Exact stock order route"
            if planner_class == "SHARED_INVARIANT_ROLL":
                return "Stopped invariant route"
            if planner_class == "EXTRUDED_BASE_ROLL":
                return "Stopped upstream route"
            return "Stopped continuation route"

        if bucket == "FINISHED_STOCK" or strategy == "FINAL_STOCK":
            return "Final FG"
        if bucket == "CARRY_FORWARD_WIP":
            return "Carry-forward WIP"
        if bucket == "SHARED_INVARIANT_ROLL_STOCK" or planner_class == "SHARED_INVARIANT_ROLL":
            return "Shared invariant roll"
        if bucket == "COMPATIBLE_UPSTREAM_ROLL_STOCK" or planner_class == "EXTRUDED_BASE_ROLL":
            return "Upstream / base roll"
        if strategy == "PACKAGING_STOCK" or planner_class == "PACKAGING_STOCK":
            return "Packaging stock"
        return "Fresh route input"

    def _row_continuation(self, row: dict):
        inventory_options = row.get("inventory_options") if isinstance(row.get("inventory_options"), list) else []
        matching_stock_orders = row.get("matching_stock_orders") if isinstance(row.get("matching_stock_orders"), list) else []
        route_last = int(row.get("route_last_step_index") or 0)
        required_start = int(row.get("required_start_step") or 0)

        exact_fg_candidates = []
        carry_forward_candidates = []
        shared_invariant_candidates = []
        upstream_candidates = []

        for option in inventory_options:
            if not isinstance(option, dict):
                continue
            source_bucket = str(option.get("source_bucket") or "").upper()
            payload = {
                "candidate_type": "INVENTORY",
                "candidate_kind": "inventory",
                "inventory_type": str(option.get("inventory_type") or ""),
                "inventory_id": str(option.get("inventory_id") or ""),
                "label": str(option.get("label") or option.get("display_name") or option.get("family_display_name") or ""),
                "display_name": str(option.get("display_name") or option.get("family_display_name") or option.get("label") or ""),
                "planner_stock_class": str(option.get("planner_stock_class") or "").upper(),
                "stock_strategy": str(option.get("stock_strategy") or "").upper(),
                "source_bucket": source_bucket,
                "source_label": str(option.get("source_label") or ""),
                "completed_step_index": int(option.get("completed_step_index") or 0),
                "allocatable_qty_kg": float(option.get("allocatable_qty_kg") or 0),
                "candidate_label": self._continuation_candidate_label(
                    stock_strategy=option.get("stock_strategy"),
                    planner_stock_class=option.get("planner_stock_class"),
                    source_bucket=source_bucket,
                ),
                "reason_label": str(option.get("source_label") or "Compatible route input"),
                "resume_action_allowed": False,
                "claim_action_allowed": source_bucket == "FINISHED_STOCK",
                "recommended_action": "CLAIM_STOCK" if source_bucket == "FINISHED_STOCK" else "PLAN_WIP",
                "route_span_label": f"Step {required_start} -> {route_last}",
            }
            if source_bucket == "FINISHED_STOCK":
                exact_fg_candidates.append(payload)
            elif source_bucket == "CARRY_FORWARD_WIP":
                carry_forward_candidates.append(payload)
            elif source_bucket == "SHARED_INVARIANT_ROLL_STOCK":
                shared_invariant_candidates.append(payload)
            elif source_bucket == "COMPATIBLE_UPSTREAM_ROLL_STOCK":
                upstream_candidates.append(payload)

        exact_stock_route_candidates = []
        stopped_invariant_route_candidates = []
        stopped_upstream_route_candidates = []
        for match in matching_stock_orders:
            if not isinstance(match, dict):
                continue
            stock_strategy = str(match.get("stock_strategy") or "").upper()
            planner_stock_class = str(match.get("planner_stock_class") or "").upper()
            match_mode = str(match.get("match_mode") or "").upper()
            is_exact_spec_route = match_mode == "EXACT_SPEC"
            is_resume_compatible_route = match_mode in {"EXACT_SPEC", "SEMI_INVARIANT", "PRE_ARTWORK_INVARIANT"}
            is_stopped_route = int(match.get("stop_step_index") or 0) < route_last
            payload = {
                "candidate_type": "STOCK_ORDER",
                "candidate_kind": "stock_order",
                "order_id": str(match.get("order_id") or ""),
                "order_number": str(match.get("order_number") or ""),
                "status": str(match.get("status") or "").upper(),
                "start_step_index": int(match.get("start_step_index") or 0),
                "stop_step_index": int(match.get("stop_step_index") or 0),
                "remaining_qty_kg": float(match.get("remaining_qty_kg") or 0),
                "produced_qty_kg": float(match.get("produced_qty_kg") or 0),
                "planner_stock_class": planner_stock_class,
                "stock_strategy": stock_strategy,
                "match_mode": match_mode,
                "required_width_mm": match.get("required_width_mm"),
                "stock_width_mm": match.get("stock_width_mm"),
                "width_match_mode": str(match.get("width_match_mode") or ""),
                "can_slit_to_required_width": bool(match.get("can_slit_to_required_width")),
                "candidate_label": self._continuation_candidate_label(
                    stock_strategy=stock_strategy,
                    planner_stock_class=planner_stock_class,
                    is_stock_order=True,
                    match_mode=match_mode,
                ),
                "reason_label": (
                    "Exact final spec is already staged on a stopped planner route."
                    if is_exact_spec_route and is_stopped_route
                    else "Compatible semi-finished route can continue from this step."
                ),
                "resume_action_allowed": is_resume_compatible_route and is_stopped_route,
                "claim_action_allowed": False,
                "recommended_action": "RESUME_STOCK_ROUTE" if is_resume_compatible_route and is_stopped_route else "PLAN_WIP",
                "route_span_label": f"Step {required_start} -> {route_last}",
            }
            if is_exact_spec_route and is_stopped_route:
                exact_stock_route_candidates.append(payload)
            elif planner_stock_class == "SHARED_INVARIANT_ROLL":
                stopped_invariant_route_candidates.append(payload)
            else:
                stopped_upstream_route_candidates.append(payload)

        source_summary = self._row_source_summary(row)
        if str(source_summary.get("recommended_option") or "").upper() == "POD_BULK":
            recommended_mode = "POD_BULK"
        elif str(source_summary.get("recommended_option") or "").upper() == "PACKAGING_STOCK":
            recommended_mode = "PACKAGING_STOCK"
        elif exact_fg_candidates:
            recommended_mode = "EXACT_FG"
        elif exact_stock_route_candidates:
            recommended_mode = "EXACT_STOCK_ROUTE"
        elif carry_forward_candidates:
            recommended_mode = "CARRY_FORWARD_WIP"
        elif shared_invariant_candidates or stopped_invariant_route_candidates:
            recommended_mode = "SHARED_INVARIANT_ROUTE"
        elif upstream_candidates or stopped_upstream_route_candidates:
            recommended_mode = "UPSTREAM_ROUTE"
        else:
            recommended_mode = "FRESH"

        return {
            "recommended_mode": recommended_mode,
            "recommended_label": self._continuation_label_for_mode(recommended_mode),
            "recommended_reason": self._continuation_reason_for_mode(recommended_mode),
            "exact_fg_count": len(exact_fg_candidates),
            "exact_stock_route_count": len(exact_stock_route_candidates),
            "carry_forward_wip_count": len(carry_forward_candidates),
            "shared_invariant_count": len(shared_invariant_candidates) + len(stopped_invariant_route_candidates),
            "upstream_route_count": len(upstream_candidates) + len(stopped_upstream_route_candidates),
            "exact_fg_candidates": exact_fg_candidates,
            "exact_stock_route_candidates": exact_stock_route_candidates,
            "carry_forward_wip_candidates": carry_forward_candidates,
            "shared_invariant_candidates": shared_invariant_candidates,
            "stopped_invariant_route_candidates": stopped_invariant_route_candidates,
            "upstream_candidates": upstream_candidates,
            "stopped_upstream_route_candidates": stopped_upstream_route_candidates,
        }

    def _resume_allocations_for_sales_from_stock_route(
        self,
        *,
        sales_item: SalesOrderItem,
        stock_order: PlannedStockOrder,
        route_last: int,
        required_route_id,
        order_invariant_signature: str,
        order_layer_only_signature: str = "",
        allow_layer_only: bool = False,
        created_by=None,
    ):
        stop_step_index = int(stock_order.stop_step_index if stock_order.stop_step_index is not None else route_last)
        if stop_step_index >= route_last:
            raise ValueError(
                f"{stock_order.order_number} is not a stopped route candidate. Claim exact final stock instead."
            )

        remaining_qty = self._sales_item_remaining_qty_kg(sales_item)
        if remaining_qty <= 0:
            raise ValueError("Sales order item has no remaining KG to resume.")

        roll_alloc_map, _fg_alloc_map = self._inventory_active_allocation_maps()
        local_consumption = {}
        candidate_rows = []
        required_width_mm = self._sales_item_roll_width_mm(sales_item)

        rolls = (
            InventoryRoll.objects.filter(
                status="AVAILABLE",
                sales_order_item__isnull=True,
                completed_step_index=stop_step_index,
            )
            .filter(Q(created_by_job__mts_order=stock_order) | Q(production_job__mts_order=stock_order))
            .select_related("template", "created_by_job__mts_order", "production_job__mts_order")
            .order_by("created_at")
        )

        for roll in rolls:
            roll_route_id = getattr(getattr(roll, "template", None), "routing_rule_id", None)
            if required_route_id and roll.template_id and roll_route_id != required_route_id:
                continue
            if order_invariant_signature and self._roll_invariant_signature(roll) != order_invariant_signature:
                if not (
                    allow_layer_only
                    and order_layer_only_signature
                    and self._layer_only_invariant_signature(stock_order.layer_snapshot or []) == order_layer_only_signature
                ):
                    continue
            width_ok, _width_payload = self._width_match_payload(
                _numeric(getattr(roll, "width_mm", None)),
                required_width_mm,
            )
            if not width_ok:
                continue
            physical = Decimal(str(roll.weight_kg or 0))
            allocated = roll_alloc_map.get(str(roll.id), Decimal("0"))
            consumed_here = local_consumption.get(str(roll.id), Decimal("0"))
            allocatable = physical - allocated - consumed_here
            if allocatable <= 0:
                continue
            candidate_rows.append({"roll": roll, "allocatable": allocatable})

        if not candidate_rows:
            width_note = ""
            if required_width_mm > 0:
                width_note = f" at or above {float(required_width_mm):.2f} mm"
            raise ValueError(
                f"{stock_order.order_number} does not have allocatable stopped-route inventory{width_note} ready for continuation."
            )

        allocations = []
        qty_remaining = remaining_qty
        for row in candidate_rows:
            if qty_remaining <= Decimal("0"):
                break
            take = min(qty_remaining, Decimal(str(row["allocatable"] or 0)))
            if take <= 0:
                continue
            roll = row["roll"]
            allocations.append(
                InventoryAllocation.objects.create(
                    sales_order=sales_item.sales_order,
                    mts_order=stock_order,
                    inventory_roll=roll,
                    allocated_qty_kg=take,
                    status="ACTIVE",
                    created_by=created_by,
                )
            )
            qty_remaining -= take

        if qty_remaining > Decimal("0.0001"):
            raise ValueError(
                f"{stock_order.order_number} has stopped-route inventory, but only "
                f"{float(remaining_qty - qty_remaining):.3f} KG is allocatable for this sales item."
            )

        return allocations, min(route_last, stop_step_index + 1)

    def _row_order_fact_sheet(self, row: dict):
        layer_summary = row.get("layer_summary") if isinstance(row.get("layer_summary"), list) else []
        geometry = row.get("effective_dims") if isinstance(row.get("effective_dims"), dict) else {}
        width_mm = Decimal(str(geometry.get("width_mm") or 0))
        height_mm = Decimal(str(geometry.get("height_mm") or 0))
        geometry_label = ""
        if width_mm > 0 and height_mm > 0:
            geometry_label = f"{width_mm.quantize(Decimal('0.01'))} × {height_mm.quantize(Decimal('0.01'))} mm"
        roll_form = str(row.get("roll_form") or geometry.get("roll_form") or "").upper()
        fg_type = str(row.get("final_product_type") or row.get("fg_type") or "").upper()
        planned_output_type = str(row.get("planned_output_type") or "").upper()
        is_roll_context = fg_type == "ROLL" or planned_output_type in {"ROLL", "FINAL_PLAIN_ROLL", "SHARED_INVARIANT_ROLL", "EXTRUDED_BASE_ROLL"}
        roll_width_label = f"{width_mm.quantize(Decimal('0.01'))} mm" if width_mm > 0 else ""
        roll_form_label = roll_form.replace("_", " ").title() if roll_form else ""
        profile_label = geometry_label
        profile_kind = "POUCH"
        if is_roll_context:
            roll_bits = [bit for bit in [roll_width_label, roll_form_label] if bit]
            profile_label = " · ".join(roll_bits) or "Roll profile pending"
            profile_kind = "ROLL"
        print_type = str(row.get("print_type") or "").upper()
        front_colors = int(row.get("front_colors_count") or 0)
        back_colors = int(row.get("back_colors_count") or 0)
        return {
            "order_number": str(row.get("order_number") or ""),
            "order_kind": str(row.get("order_kind") or "").upper(),
            "customer_name": str(row.get("customer_name") or "").strip(),
            "display_name": str(row.get("display_name") or row.get("template_name") or "").strip(),
            "delivery_date": row.get("delivery_date"),
            "template_name": str(row.get("template_name") or "").strip(),
            "status": str(row.get("status") or "").upper(),
            "fg_type": fg_type,
            "planned_output_type": planned_output_type,
            "stock_strategy": str(row.get("stock_strategy") or "").upper(),
            "required_qty_kg": float(row.get("required_qty_kg") or 0),
            "required_qty_pcs": float(row.get("required_qty_pcs") or 0) if row.get("required_qty_pcs") is not None else None,
            "qty_uom": str(row.get("qty_uom") or "KG").upper(),
            "profile_kind": profile_kind,
            "profile_label": profile_label or "Geometry pending",
            "roll_form": roll_form or None,
            "print_type": print_type,
            "front_colors_count": front_colors,
            "back_colors_count": back_colors,
            "print_profile_label": (
                f"{print_type or 'NO PRINT'} · F{front_colors} / B{back_colors}"
                if print_type or front_colors or back_colors
                else "No printing"
            ),
            "partial_shortfall_kg": float(row.get("partial_shortfall_kg") or 0),
            "partial_replan_required": bool(row.get("partial_replan_required")),
            "has_started_final_output": bool(row.get("has_started_final_output")),
            "geometry_label": geometry_label,
            "route_span_label": f"Step {int(row.get('required_start_step') or 0)} → {int(row.get('route_last_step_index') or 0)}",
            "layer_count": len(layer_summary),
            "layer_summary": layer_summary,
            "release_risk": "HIGH" if any(
                str((blocker or {}).get("severity") or "").upper() == "HIGH"
                for blocker in (row.get("blockers") or [])
            ) else ("MEDIUM" if row.get("blockers") else "LOW"),
        }

    def _format_v2_decimal_label(self, value, places="0.01"):
        try:
            number = Decimal(str(value or 0))
        except Exception:
            number = Decimal("0")
        if number == number.to_integral_value():
            return str(int(number))
        try:
            return str(number.quantize(Decimal(str(places))).normalize())
        except Exception:
            return str(number.normalize())

    def _layer_material_label(self, layer: dict, index: int):
        variant_code = str(
            layer.get("variant_code")
            or layer.get("film_variant_code")
            or layer.get("material_code")
            or layer.get("base_material_code")
            or layer.get("code")
            or ""
        ).strip()
        variant_name = str(
            layer.get("variant_name")
            or layer.get("film_variant_name")
            or layer.get("material_name")
            or layer.get("name")
            or ""
        ).strip()
        if variant_code and variant_name and variant_code.lower() != variant_name.lower():
            return f"{variant_code} · {variant_name}"
        return variant_name or variant_code or f"Layer {index + 1}"

    def _row_spec_summary(self, row: dict):
        geometry = row.get("effective_dims") if isinstance(row.get("effective_dims"), dict) else {}
        width = Decimal(str(geometry.get("width_mm") or 0))
        height = Decimal(str(geometry.get("height_mm") or 0))
        layers = row.get("layer_snapshot") if isinstance(row.get("layer_snapshot"), list) else []
        thickness_values = []
        material_labels = []
        layer_labels = []
        layer_recipe = []
        for index, layer in enumerate(layers):
            if not isinstance(layer, dict):
                continue
            label = self._layer_material_label(layer, index)
            material_labels.append(label)
            try:
                thickness = Decimal(str(layer.get("thickness_micron") or layer.get("thickness_um") or 0))
            except Exception:
                thickness = Decimal("0")
            if thickness > 0:
                thickness_values.append(thickness)
                layer_labels.append(f"{label} {self._format_v2_decimal_label(thickness)}μ")
            else:
                layer_labels.append(label)
            try:
                width_value = Decimal(str(layer.get("roll_width_mm") or layer.get("input_roll_width_mm") or layer.get("width_mm") or 0))
            except Exception:
                width_value = Decimal("0")
            layer_recipe.append(
                {
                    "label": label,
                    "material_code": str(layer.get("variant_code") or layer.get("film_variant_code") or layer.get("material_code") or layer.get("base_material_code") or layer.get("code") or "").strip(),
                    "variant_code": str(layer.get("variant_code") or layer.get("film_variant_code") or layer.get("code") or "").strip(),
                    "variant_name": str(layer.get("variant_name") or layer.get("film_variant_name") or layer.get("material_name") or layer.get("name") or "").strip(),
                    "grade": str(layer.get("grade") or layer.get("grade_code") or layer.get("grade_name") or "").strip(),
                    "thickness_micron": float(thickness) if thickness > 0 else None,
                    "width_mm": float(width_value) if width_value > 0 else None,
                }
            )
        total_thickness = sum(thickness_values, Decimal("0"))
        thickness_expression = "+".join(self._format_v2_decimal_label(value) for value in thickness_values)
        layer_recipe_label = " + ".join(layer_labels)
        geometry_label = ""
        if width > 0 and height > 0:
            geometry_label = f"{self._format_v2_decimal_label(width)} x {self._format_v2_decimal_label(height)} mm"
        elif width > 0:
            geometry_label = f"{self._format_v2_decimal_label(width)} mm web"
        printing = row.get("printing_snapshot") if isinstance(row.get("printing_snapshot"), dict) else {}
        print_type = str(row.get("print_type") or printing.get("print_type") or printing.get("type") or printing.get("method") or "").upper()
        front_colors = int(row.get("front_colors_count") or printing.get("front_colors_count") or 0)
        back_colors = int(row.get("back_colors_count") or printing.get("back_colors_count") or 0)
        packaging_labels = self._row_packaging_summary(row)
        return {
            "width_mm": float(width) if width > 0 else None,
            "height_mm": float(height) if height > 0 else None,
            "total_thickness_micron": float(total_thickness) if total_thickness > 0 else None,
            "thickness_expression": thickness_expression,
            "layer_recipe": layer_recipe,
            "layer_recipe_label": layer_recipe_label,
            "layer_material_labels": material_labels,
            "layer_labels": layer_labels,
            "layer_count": len(material_labels),
            "size_label": geometry_label or str(row.get("display_geometry_label") or "Geometry pending"),
            "geometry_label": geometry_label or str(row.get("display_geometry_label") or ""),
            "print_label": (
                f"{print_type or 'NO PRINT'} · F{front_colors} / B{back_colors}"
                if print_type or front_colors or back_colors
                else "No print"
            ),
            "material_family": " + ".join(material_labels[:3]) if material_labels else "",
            "packaging_label": " · ".join(packaging_labels) if packaging_labels else "None",
        }

    def _row_production_trace(self, row: dict):
        steps = row.get("template_steps") if isinstance(row.get("template_steps"), list) else []
        completed_jobs = row.get("completed_jobs") if isinstance(row.get("completed_jobs"), list) else []
        job_count = int(row.get("job_count") or len(completed_jobs) or 0)
        jobs_completed = int(row.get("jobs_completed") or len(completed_jobs) or 0)
        jobs_released = int(row.get("jobs_released") or 0)
        required_start = int(row.get("required_start_step") or 0)
        route_last = int(row.get("route_last_step_index") or 0)
        blocked = bool(row.get("blockers"))
        status = str(row.get("status") or row.get("line_status") or "").upper()
        route_steps = []
        for index, step in enumerate(steps):
            try:
                route_index = int(step.get("route_index") if step.get("route_index") is not None else index)
            except Exception:
                route_index = index
            try:
                sequence = int(step.get("sequence_number") if step.get("sequence_number") is not None else route_index)
            except Exception:
                sequence = route_index
            if route_index < required_start:
                state = "SKIPPED"
            elif route_index > route_last:
                state = "OUT_OF_SCOPE"
            elif jobs_completed > route_index:
                state = "COMPLETED"
            elif jobs_released > 0 and jobs_completed <= route_index < max(jobs_completed + jobs_released, jobs_completed + 1):
                state = "ACTIVE"
            elif status in {"RELEASED", "IN_PRODUCTION"} and route_index == max(required_start, jobs_completed):
                state = "ACTIVE"
            elif blocked:
                state = "BLOCKED"
            else:
                state = "WAITING"
            dispatch_status = step.get("dispatch_status") if isinstance(step.get("dispatch_status"), dict) else {}
            default_wc = dispatch_status.get("default_work_center") if isinstance(dispatch_status.get("default_work_center"), dict) else {}
            route_steps.append(
                {
                    "step_id": str(step.get("step_id") or step.get("id") or ""),
                    "route_index": route_index,
                    "sequence_number": sequence,
                    "process_code": str(step.get("process_code") or ""),
                    "process_name": str(step.get("process_name") or step.get("step_name") or step.get("process_code") or f"Step {sequence}"),
                    "step_name": str(step.get("step_name") or step.get("process_name") or step.get("process_code") or f"Step {sequence}"),
                    "input_form": str(step.get("input_form") or ""),
                    "output_form": str(step.get("output_form") or ""),
                    "roll_behavior": str(step.get("roll_behavior") or step.get("process_roll_behavior") or ""),
                    "process_transition": str(step.get("process_transition") or step.get("transition") or ""),
                    "has_artwork": bool(step.get("has_artwork") or step.get("process_has_artwork")),
                    "work_center_selection_policy": str(step.get("work_center_selection_policy") or dispatch_status.get("selection_policy") or ""),
                    "default_work_center_code": str(step.get("default_work_center_code") or default_wc.get("code") or ""),
                    "default_work_center_name": str(step.get("default_work_center_name") or default_wc.get("name") or ""),
                    "dispatch_notes": str(step.get("dispatch_notes") or ""),
                    "dispatch_status": dispatch_status,
                    "roll_handling": step.get("roll_handling") if isinstance(step.get("roll_handling"), dict) else {},
                    "state": state,
                }
            )
        planned_qty = sum(Decimal(str((job or {}).get("planned_qty") or 0)) for job in completed_jobs if isinstance(job, dict))
        produced_qty = sum(Decimal(str((job or {}).get("produced_qty") or 0)) for job in completed_jobs if isinstance(job, dict))
        remaining_qty = sum(Decimal(str((job or {}).get("remaining_qty") or 0)) for job in completed_jobs if isinstance(job, dict))
        scrap_qty = sum(Decimal(str((job or {}).get("scrap_qty") or 0)) for job in completed_jobs if isinstance(job, dict))
        if planned_qty <= 0:
            planned_qty = Decimal(str(row.get("required_qty_kg") or 0))
        raw_remaining_qty = remaining_qty
        progress_pct = Decimal("0")
        if job_count > 0:
            progress_pct = (Decimal(str(min(jobs_completed, job_count))) / Decimal(str(job_count))) * Decimal("100")
        elif route_last >= required_start and status in {"COMPLETED", "STOCK_READY", "DONE"}:
            progress_pct = Decimal("100")
        route_complete_statuses = {"COMPLETED", "STOCK_READY", "DONE", "PACKING_READY", "SHORT_CLOSED", "CLOSED"}
        route_span_steps = [step for step in route_steps if required_start <= int(step.get("route_index", 0) or 0) <= route_last]
        route_complete = bool(route_span_steps) and all(str(step.get("state") or "").upper() == "COMPLETED" for step in route_span_steps)
        current_state = "BLOCKED" if blocked else "WAITING_FOR_PLAN"
        if bool(row.get("partial_replan_required")):
            current_state = "REPLAN_REQUIRED"
        elif progress_pct >= 100 or route_complete or status in route_complete_statuses:
            current_state = "COMPLETED"
        elif jobs_released > 0 or status in {"RELEASED", "IN_PRODUCTION"}:
            current_state = "IN_PRODUCTION"
        elif status == "PLANNED":
            current_state = "WCM_HANDOFF_READY"
        elif str(row.get("line_status") or "").upper() in {"PLANNING_REQUIRED", "OPEN"}:
            current_state = "PLANNING_REQUIRED"
        has_completed_job_rows = len(completed_jobs) > 0
        completion_mode = ""
        audit_state = "LIVE"
        audit_message = ""
        if current_state == "COMPLETED":
            progress_pct = Decimal("100")
            if not has_completed_job_rows:
                completion_mode = "STOCK_OR_PACKING_CLAIM"
                audit_state = "CLAIMED_NO_WCM_LOG"
                audit_message = "Closed by stock, packing, or planner claim; no WCM output log is attached."
                remaining_qty = Decimal("0")
                for step in route_steps:
                    try:
                        step_route_index = int(step.get("route_index") or 0)
                    except Exception:
                        step_route_index = 0
                    if required_start <= step_route_index <= route_last:
                        step["state"] = "CLOSED_BY_STOCK"
            else:
                completion_mode = "WCM_POSTED"
                remaining_qty = Decimal("0")
                if status == "SHORT_CLOSED" or raw_remaining_qty > 0:
                    audit_state = "POSTED_WITH_VARIANCE"
                    audit_message = "Closed with production variance or short-close balance captured for audit."
                else:
                    audit_state = "WCM_POSTED"
                    audit_message = "Closed from WCM posted output logs."
        source_summary = row.get("source_summary") if isinstance(row.get("source_summary"), dict) else {}
        availability = row.get("source_availability") if isinstance(row.get("source_availability"), dict) else {}
        continuation = row.get("continuation") if isinstance(row.get("continuation"), dict) else {}
        material_summary = row.get("material_plan_summary") if isinstance(row.get("material_plan_summary"), dict) else {}
        artwork_gate = row.get("artwork_gate") if isinstance(row.get("artwork_gate"), dict) else self._row_artwork_gate(row)
        release_checklist = row.get("release_checklist") if isinstance(row.get("release_checklist"), dict) else self._row_release_checklist(row)
        source_option = str(source_summary.get("recommended_option") or continuation.get("recommended_mode") or "").upper()
        if not source_option:
            if bool(availability.get("has_fg")):
                source_option = "FG"
            elif bool(availability.get("has_wip")):
                source_option = "WIP"
            else:
                source_option = "FRESH"
        source_label_map = {
            "FG": "Finished stock",
            "WIP": "Carry-forward WIP",
            "WIP_CONTINUE": "Carry-forward WIP",
            "UPSTREAM": "Upstream roll",
            "UPSTREAM_STOCK": "Upstream roll",
            "SHARED_INVARIANT": "Shared invariant",
            "POD_BULK": "POD bulk",
            "PACKAGING_STOCK": "Packaging stock",
            "FRESH": "Fresh production",
        }
        source_nodes = [
            {
                "label": source_label_map.get(source_option, source_option.replace("_", " ").title() or "Fresh production"),
                "state": "COMPLETED" if current_state == "COMPLETED" else "READY" if source_option not in {"FRESH", "PLANNING_REQUIRED"} else "WAITING",
                "detail": str(source_summary.get("recommended_label") or continuation.get("recommended_label") or ""),
            }
        ]
        combine_nodes = []
        combine_sources = [
            ("FG candidates", continuation.get("exact_fg_count")),
            ("Exact stock route", continuation.get("exact_stock_route_count")),
            ("Carry-forward WIP", continuation.get("carry_forward_wip_count")),
            ("Shared invariant", continuation.get("shared_invariant_count")),
            ("Upstream route", continuation.get("upstream_route_count")),
        ]
        for label, count in combine_sources:
            try:
                count_value = int(count or 0)
            except Exception:
                count_value = 0
            if count_value > 0:
                combine_nodes.append({"label": label, "state": "READY", "detail": f"{count_value} available"})
        if current_state == "COMPLETED":
            release_nodes = [
                {
                    "label": "Material",
                    "state": "COMPLETED",
                    "detail": f"{int(material_summary.get('line_count') or 0)} historical line(s)",
                },
                {
                    "label": "Artwork",
                    "state": "COMPLETED",
                    "detail": "Historical gate; not blocking closed line",
                },
                {
                    "label": "Release",
                    "state": "COMPLETED",
                    "detail": "Closed audit",
                },
                {
                    "label": "WCM handoff",
                    "state": "COMPLETED",
                    "detail": f"Step {required_start} to {route_last}",
                },
            ]
        else:
            release_nodes = [
                {
                    "label": "Material",
                    "state": "READY" if int(material_summary.get("line_count") or 0) > 0 else "BLOCKED",
                    "detail": f"{int(material_summary.get('line_count') or 0)} line(s)",
                },
                {
                    "label": "Artwork",
                    "state": "BLOCKED" if bool(artwork_gate.get("active")) else "READY",
                    "detail": str(artwork_gate.get("message") or "Artwork ready"),
                },
                {
                    "label": "Release",
                    "state": "READY" if bool(release_checklist.get("release_ready")) else "WAITING",
                    "detail": f"{int(release_checklist.get('blocked_count') or 0)} blocker(s)",
                },
                {
                    "label": "WCM handoff",
                    "state": current_state,
                    "detail": f"Step {required_start} to {route_last}",
                },
            ]
        route_topology = [
            {"key": "source", "label": "Source path", "role": "source", "nodes": source_nodes},
            {"key": "route", "label": "Production route", "role": "route", "nodes": route_steps},
            {
                "key": "release",
                "label": "Release gates",
                "role": "gate",
                "nodes": release_nodes,
            },
        ]
        if combine_nodes:
            route_topology.append({"key": "combine", "label": "Combine / reuse paths", "role": "parallel", "parallel": True, "nodes": combine_nodes})
        active_step_label = ""
        if current_state == "COMPLETED":
            active_step_label = "Production complete"
        else:
            active_step = next(
                (
                    step for step in route_steps
                    if required_start <= int(step.get("route_index", 0) or 0) <= route_last
                    and str(step.get("state") or "").upper() in {"ACTIVE", "WAITING", "BLOCKED"}
                ),
                None,
            )
            active_step_label = str((active_step or {}).get("process_name") or "") if active_step else ""
        return {
            "route_steps": route_steps,
            "route_topology": route_topology,
            "template_route_source": "template_process_steps" if any(step.get("step_id") for step in route_steps) else "routing_rule",
            "job_state": current_state,
            "wcm_handoff_state": current_state,
            "job_count": job_count,
            "jobs_released": jobs_released,
            "jobs_completed": jobs_completed,
            "planned_qty": float(planned_qty),
            "produced_qty": float(produced_qty),
            "remaining_qty": float(remaining_qty),
            "scrap_qty": float(scrap_qty),
            "closure_variance_qty": float(raw_remaining_qty if current_state == "COMPLETED" else Decimal("0")),
            "uom": str(row.get("qty_uom") or "KG").upper(),
            "progress_pct": float(progress_pct.quantize(Decimal("0.01"))),
            "current_step_label": active_step_label,
            "route_span_label": f"Step {required_start} to {route_last}",
            "jobs": completed_jobs,
            "completed_at": row.get("completed_at"),
            "completion_mode": completion_mode,
            "audit_status": audit_state,
            "trace_integrity": {
                "state": audit_state,
                "message": audit_message,
                "has_wcm_job_rows": has_completed_job_rows,
                "posted_qty": float(produced_qty),
                "closed_open_qty": float(raw_remaining_qty if current_state == "COMPLETED" else remaining_qty),
                "display_remaining_qty": float(remaining_qty),
            },
        }

    def _row_v2_analytics(self, row: dict):
        created_at = row.get("created_at")
        age_days = None
        if created_at:
            try:
                created_dt = timezone.datetime.fromisoformat(str(created_at).replace("Z", "+00:00"))
                if timezone.is_naive(created_dt):
                    created_dt = timezone.make_aware(created_dt, timezone.get_current_timezone())
                age_days = max(0, (timezone.now() - created_dt).days)
            except Exception:
                age_days = None
        due_bucket = "NO_DUE_DATE"
        delivery_date = row.get("delivery_date")
        if delivery_date:
            try:
                due_dt = timezone.datetime.fromisoformat(str(delivery_date).replace("Z", "+00:00"))
                if timezone.is_naive(due_dt):
                    due_dt = timezone.make_aware(due_dt, timezone.get_current_timezone())
                delta_days = (due_dt.date() - timezone.localdate()).days
                if delta_days < 0:
                    due_bucket = "LATE"
                elif delta_days == 0:
                    due_bucket = "TODAY"
                elif delta_days <= 3:
                    due_bucket = "NEXT_3_DAYS"
                else:
                    due_bucket = "FUTURE"
            except Exception:
                due_bucket = "NO_DUE_DATE"
        source_summary = row.get("source_summary") if isinstance(row.get("source_summary"), dict) else {}
        recommended = str(source_summary.get("recommended_option") or "").upper()
        if recommended == "FG":
            source_path = "FG"
        elif recommended == "WIP_CONTINUE":
            source_path = "WIP"
        elif recommended in {"UPSTREAM_STOCK", "SHARED_INVARIANT"}:
            source_path = "UPSTREAM"
        elif recommended in {"POD_BULK", "PACKAGING_STOCK"}:
            source_path = recommended
        else:
            source_path = "FRESH"
        material_summary = row.get("material_plan_summary") if isinstance(row.get("material_plan_summary"), dict) else {}
        release_checklist = row.get("release_checklist") if isinstance(row.get("release_checklist"), dict) else {}
        trace = row.get("production_trace") if isinstance(row.get("production_trace"), dict) else self._row_production_trace(row)
        completed_at = row.get("completed_at")
        on_time_status = "UNKNOWN"
        if completed_at and delivery_date:
            try:
                completed_dt = timezone.datetime.fromisoformat(str(completed_at).replace("Z", "+00:00"))
                due_dt = timezone.datetime.fromisoformat(str(delivery_date).replace("Z", "+00:00"))
                if timezone.is_naive(completed_dt):
                    completed_dt = timezone.make_aware(completed_dt, timezone.get_current_timezone())
                if timezone.is_naive(due_dt):
                    due_dt = timezone.make_aware(due_dt, timezone.get_current_timezone())
                on_time_status = "ON_TIME" if completed_dt <= due_dt + timezone.timedelta(days=1) else "LATE"
            except Exception:
                on_time_status = "UNKNOWN"
        return {
            "age_days": age_days,
            "due_bucket": due_bucket,
            "source_path": source_path,
            "blocker_count": len(row.get("blockers") or []),
            "route_progress_pct": float(trace.get("progress_pct") or 0),
            "wcm_state": str(trace.get("wcm_handoff_state") or ""),
            "material_line_count": int(material_summary.get("line_count") or 0),
            "release_ready": bool(release_checklist.get("release_ready")),
            "coverage_pct": float((row.get("summary") or {}).get("coverage_pct") or 0) if isinstance(row.get("summary"), dict) else 0,
            "on_time_status": on_time_status,
            "completed_at": completed_at,
        }

    def _row_packaging_summary(self, row: dict):
        snapshot = row.get("packaging_snapshot") if isinstance(row.get("packaging_snapshot"), dict) else {}
        labels = []
        primary_inner_pack = snapshot.get("primary_inner_pack") if isinstance(snapshot.get("primary_inner_pack"), dict) else {}
        if primary_inner_pack.get("enabled"):
            pcs = int(primary_inner_pack.get("pcs_per_pack") or 0)
            if pcs > 0:
                labels.append(f"Inner pack {pcs} pcs")
            else:
                labels.append("Inner pack")
        roll_dispatch_pack = snapshot.get("roll_dispatch_pack") if isinstance(snapshot.get("roll_dispatch_pack"), dict) else {}
        if roll_dispatch_pack.get("enabled"):
            lines = roll_dispatch_pack.get("lines") if isinstance(roll_dispatch_pack.get("lines"), list) else []
            labels.append(f"Dispatch pack {len(lines)} line{'s' if len(lines) != 1 else ''}")
        pod_count = int((row.get("source_availability") or {}).get("pod_bulk_material_count") or 0)
        packaging_count = int((row.get("source_availability") or {}).get("packaging_stock_material_count") or 0)
        if packaging_count > 0:
            labels.append(f"Packaging stock {packaging_count}")
        if pod_count > 0:
            labels.append(f"POD stock {pod_count}")
        return labels or ["None"]

    def _row_addons_summary(self, row: dict):
        addons = row.get("addons_snapshot") if isinstance(row.get("addons_snapshot"), list) else []
        summary = []
        for addon in addons:
            if not isinstance(addon, dict):
                continue
            base = str(addon.get("name") or addon.get("addon_name") or addon.get("addon_code") or addon.get("addon_id") or "Addon").strip()
            qty = int(addon.get("qty") or 0)
            applies_to = str(addon.get("applies_to") or "").strip().upper()
            bits = [base]
            if qty > 0:
                bits.append(f"x{qty}")
            if applies_to and applies_to != "NONE":
                bits.append(applies_to.replace("_", " ").title())
            summary.append(" · ".join(bits))
        return summary

    def _display_qty_label(self, qty, unit: str, decimals: int = 1):
        try:
            number = float(qty or 0)
        except Exception:
            number = 0.0
        if unit == "PCS":
            return f"{int(round(number))} PCS"
        return f"{number:.{decimals}f} {unit}"

    def _row_display_fields(self, row: dict):
        fact = row.get("order_fact_sheet") if isinstance(row.get("order_fact_sheet"), dict) else self._row_order_fact_sheet(row)
        continuation = row.get("continuation") if isinstance(row.get("continuation"), dict) else self._row_continuation(row)
        material_summary = row.get("material_plan_summary") if isinstance(row.get("material_plan_summary"), dict) else {}
        material_lines = row.get("material_plan_lines") if isinstance(row.get("material_plan_lines"), list) else []
        packaging_summary = self._row_packaging_summary(row)
        addons_summary = self._row_addons_summary(row)
        recommended_mode = str(continuation.get("recommended_mode") or "").upper()
        if recommended_mode == "EXACT_FG":
            action_label = "Ship from FG"
        elif recommended_mode in {"EXACT_STOCK_ROUTE", "CARRY_FORWARD_WIP"}:
            action_label = "Continue exact WIP"
        elif recommended_mode in {"SHARED_INVARIANT_ROUTE", "UPSTREAM_ROUTE"}:
            action_label = "Continue from invariant"
        else:
            action_label = "Run fresh production"

        required_qty_kg = float(fact.get("required_qty_kg") or row.get("required_qty_kg") or 0)
        required_qty_pcs = fact.get("required_qty_pcs")
        line_count = int(material_summary.get("line_count") or len(material_lines) or 0)
        planned_issue_total = float(material_summary.get("planned_issue_total_qty") or 0)
        issue_uom = str(material_summary.get("uom") or "").upper() or "KG"
        route_start = int(row.get("required_start_step") or 0)
        route_last = int(row.get("route_last_step_index") or 0)
        route_summary = f"Run steps {route_start} to {route_last}"
        if str((row.get("source_summary") or {}).get("recommended_option") or "").upper() == "FG":
            route_summary = "Ship directly from FG"
        elif str((row.get("source_summary") or {}).get("recommended_option") or "").upper() == "WIP_CONTINUE":
            route_summary = f"Continue route from step {route_start} to {route_last}"

        material_summary_label = (
            f"{line_count} material line{'s' if line_count != 1 else ''} ready · {planned_issue_total:.1f} {issue_uom} to issue"
            if line_count
            else "Material issue list not ready"
        )
        resolved_layer_summary = self._layer_stack_summary(row.get("layer_snapshot"))
        raw_layer_summary = fact.get("layer_summary")
        if resolved_layer_summary:
            display_layers = resolved_layer_summary
        elif isinstance(raw_layer_summary, list) and raw_layer_summary:
            display_layers = raw_layer_summary
        else:
            display_layers = []
        return {
            "display_qty_kg": self._display_qty_label(required_qty_kg, "KG", 1),
            "display_qty_pcs": self._display_qty_label(required_qty_pcs, "PCS", 0) if required_qty_pcs is not None else "",
            "display_geometry_label": str(fact.get("profile_label") or fact.get("geometry_label") or "Geometry pending"),
            "display_layers": display_layers,
            "display_printing_label": str(fact.get("print_profile_label") or "No printing"),
            "display_addons_label": " · ".join(addons_summary) if addons_summary else "No add-ons",
            "display_packaging_label": " · ".join(packaging_summary),
            "display_route_summary": route_summary,
            "display_material_summary": material_summary_label,
            "display_action_label": action_label,
            "display_action_help": str(continuation.get("recommended_reason") or "Review the best release path for this row."),
        }

    def _history_row_matches(self, row: dict, *, history_days: int | None = None, history_query: str = "", history_source: str = "", history_order_kind: str = ""):
        if history_days and history_days > 0:
            reference_value = row.get("completed_at") or row.get("last_job_completed_at") or row.get("created_at")
            if reference_value:
                try:
                    reference_dt = timezone.datetime.fromisoformat(str(reference_value).replace("Z", "+00:00"))
                    if timezone.is_naive(reference_dt):
                        reference_dt = timezone.make_aware(reference_dt, timezone.get_current_timezone())
                    if reference_dt < timezone.now() - timezone.timedelta(days=history_days):
                        return False
                except Exception:
                    pass

        normalized_query = str(history_query or "").strip().lower()
        if normalized_query:
            haystack = [
                str(row.get("order_number") or ""),
                str(row.get("customer_name") or ""),
                str(row.get("display_name") or ""),
                str(row.get("template_name") or ""),
                " ".join([str(job_no or "") for job_no in (row.get("job_numbers") or [])]),
            ]
            if not any(normalized_query in value.lower() for value in haystack if value) and not bool(row.get("_job_number_match")):
                return False

        normalized_source = str(history_source or "").strip().upper()
        if normalized_source and normalized_source != "ALL":
            source_option = str((row.get("source_summary") or {}).get("recommended_option") or "").upper()
            mapped_source = "FRESH"
            if source_option == "FG":
                mapped_source = "FG"
            elif source_option == "WIP_CONTINUE":
                mapped_source = "WIP"
            if mapped_source != normalized_source:
                return False

        normalized_kind = str(history_order_kind or "").strip().upper()
        if normalized_kind and normalized_kind != "ALL":
            row_kind = str(row.get("order_kind") or "").upper()
            mapped_kind = "SALES" if row_kind == "SALES" else "STOCK"
            if mapped_kind != normalized_kind:
                return False
        return True

    def _completed_job_trace_rows(self, jobs_qs):
        completed_jobs = (
            jobs_qs.filter(job_state__in=["COMPLETED", "DONE"])
            .select_related("work_center", "machine", "operator", "closed_by", "current_process", "process", "production_batch")
            .order_by("-closed_at", "-updated_at")[:12]
        )
        rows = []
        for job in completed_jobs:
            rows.append(self._serialize_completed_job_trace(job))
        return rows

    def _serialize_completed_job_trace(self, job):
        step_obj = getattr(job, "current_process", None) or getattr(job, "process", None)
        return {
            "id": str(job.id),
            "job_number": str(getattr(job, "job_number", "") or ""),
            "job_state": str(getattr(job, "job_state", "") or ""),
            "status": str(getattr(job, "status", "") or ""),
            "current_step_index": int(getattr(job, "current_step_index", 0) or 0),
            "step_label": str(getattr(step_obj, "name", "") or f"Step {int(getattr(job, 'current_step_index', 0) or 0)}"),
            "process_code": str(getattr(step_obj, "code", "") or ""),
            "input_form": str(getattr(job, "input_form", "") or ""),
            "output_form": str(getattr(job, "output_form", "") or ""),
            "planned_qty": float(getattr(job, "quantity", 0) or 0),
            "produced_qty": float(getattr(job, "produced_qty", 0) or 0),
            "remaining_qty": float(getattr(job, "remaining_qty", 0) or 0),
            "scrap_qty": float(getattr(job, "completion_variance_kg", 0) or 0),
            "uom": str(getattr(job, "uom", "") or "KG").upper(),
            "work_center_name": str(getattr(getattr(job, "work_center", None), "name", "") or ""),
            "machine_name": str(getattr(getattr(job, "machine", None), "name", "") or ""),
            "operator_name": str(getattr(getattr(job, "operator", None), "username", "") or ""),
            "closed_by_name": str(getattr(getattr(job, "closed_by", None), "username", "") or ""),
            "closed_at": (
                job.closed_at.isoformat()
                if getattr(job, "closed_at", None)
                else (job.updated_at.isoformat() if getattr(job, "updated_at", None) else None)
            ),
            "updated_at": job.updated_at.isoformat() if getattr(job, "updated_at", None) else None,
        }

    def _job_summary_maps(self, *, sales_order_ids=None, stock_order_ids=None):
        sales_map = {}
        stock_map = {}

        if sales_order_ids:
            sales_rows = (
                ProductionJob.objects.filter(sales_order_item__sales_order_id__in=sales_order_ids)
                .values("sales_order_item__sales_order_id")
                .annotate(
                    job_count=Count("id"),
                    jobs_released=Count("id", filter=Q(job_state="RELEASED")),
                    jobs_completed=Count("id", filter=Q(job_state__in=["COMPLETED", "DONE"])),
                    last_closed_at=Max("closed_at", filter=Q(job_state__in=["COMPLETED", "DONE"])),
                    last_updated_at=Max("updated_at", filter=Q(job_state__in=["COMPLETED", "DONE"])),
                )
            )
            for row in sales_rows:
                key = str(row.get("sales_order_item__sales_order_id") or "")
                if not key:
                    continue
                completed_at = row.get("last_closed_at") or row.get("last_updated_at")
                sales_map[key] = {
                    "job_count": int(row.get("job_count") or 0),
                    "jobs_released": int(row.get("jobs_released") or 0),
                    "jobs_completed": int(row.get("jobs_completed") or 0),
                    "completed_at": completed_at.isoformat() if completed_at else None,
                }

        if stock_order_ids:
            stock_rows = (
                ProductionJob.objects.filter(mts_order_id__in=stock_order_ids)
                .values("mts_order_id")
                .annotate(
                    job_count=Count("id"),
                    jobs_released=Count("id", filter=Q(job_state="RELEASED")),
                    jobs_completed=Count("id", filter=Q(job_state__in=["COMPLETED", "DONE"])),
                    last_closed_at=Max("closed_at", filter=Q(job_state__in=["COMPLETED", "DONE"])),
                    last_updated_at=Max("updated_at", filter=Q(job_state__in=["COMPLETED", "DONE"])),
                )
            )
            for row in stock_rows:
                key = str(row.get("mts_order_id") or "")
                if not key:
                    continue
                completed_at = row.get("last_closed_at") or row.get("last_updated_at")
                stock_map[key] = {
                    "job_count": int(row.get("job_count") or 0),
                    "jobs_released": int(row.get("jobs_released") or 0),
                    "jobs_completed": int(row.get("jobs_completed") or 0),
                    "completed_at": completed_at.isoformat() if completed_at else None,
                }

        return sales_map, stock_map

    def _sales_item_job_summary_map(self, sales_item_ids=None):
        sales_item_ids = [str(value) for value in (sales_item_ids or []) if str(value or "").strip()]
        if not sales_item_ids:
            return {}
        rows = (
            ProductionJob.objects.filter(sales_order_item_id__in=sales_item_ids)
            .values("sales_order_item_id")
            .annotate(
                job_count=Count("id"),
                jobs_released=Count("id", filter=Q(job_state="RELEASED")),
                jobs_completed=Count("id", filter=Q(job_state__in=["COMPLETED", "DONE"])),
                last_closed_at=Max("closed_at", filter=Q(job_state__in=["COMPLETED", "DONE"])),
                last_updated_at=Max("updated_at", filter=Q(job_state__in=["COMPLETED", "DONE"])),
            )
        )
        mapped = {}
        for row in rows:
            key = str(row.get("sales_order_item_id") or "")
            if not key:
                continue
            completed_at = row.get("last_closed_at") or row.get("last_updated_at")
            mapped[key] = {
                "job_count": int(row.get("job_count") or 0),
                "jobs_released": int(row.get("jobs_released") or 0),
                "jobs_completed": int(row.get("jobs_completed") or 0),
                "completed_at": completed_at.isoformat() if completed_at else None,
            }
        return mapped

    def _sales_item_history_job_number_matches(self, *, history_query: str, sales_item_ids=None):
        normalized_query = str(history_query or "").strip()
        sales_item_ids = [str(value) for value in (sales_item_ids or []) if str(value or "").strip()]
        if not normalized_query or not sales_item_ids:
            return set()
        rows = (
            ProductionJob.objects.filter(
                sales_order_item_id__in=sales_item_ids,
                job_state__in=["COMPLETED", "DONE"],
                job_number__icontains=normalized_query,
            )
            .values_list("sales_order_item_id", flat=True)
            .distinct()
        )
        return {str(value) for value in rows if value}

    def _history_job_number_match_maps(self, *, history_query: str, sales_order_ids=None, stock_order_ids=None):
        normalized_query = str(history_query or "").strip()
        if not normalized_query:
            return set(), set()

        job_qs = ProductionJob.objects.filter(job_state__in=["COMPLETED", "DONE"], job_number__icontains=normalized_query)
        sales_matches = set()
        stock_matches = set()

        if sales_order_ids:
            sales_rows = (
                job_qs.filter(sales_order_item__sales_order_id__in=sales_order_ids)
                .values_list("sales_order_item__sales_order_id", flat=True)
                .distinct()
            )
            sales_matches = {str(value) for value in sales_rows if value}

        if stock_order_ids:
            stock_rows = job_qs.filter(mts_order_id__in=stock_order_ids).values_list("mts_order_id", flat=True).distinct()
            stock_matches = {str(value) for value in stock_rows if value}

        return sales_matches, stock_matches

    def _attach_completed_job_history_payload(self, rows, *, jobs_per_row: int = 8):
        history_rows = rows if isinstance(rows, list) else []
        jobs_per_row = max(1, min(int(jobs_per_row or 8), 12))
        sales_item_ids = [
            str(row.get("sales_order_item_id") or "")
            for row in history_rows
            if str(row.get("order_kind") or "").lower() == "sales" and str(row.get("sales_order_item_id") or "")
        ]
        legacy_sales_ids = [
            str(row.get("order_id") or "")
            for row in history_rows
            if str(row.get("order_kind") or "").lower() == "sales"
            and not str(row.get("sales_order_item_id") or "")
            and str(row.get("order_id") or "")
        ]
        stock_ids = [str(row.get("order_id") or "") for row in history_rows if str(row.get("order_kind") or "").lower() == "stock" and str(row.get("order_id") or "")]
        if not sales_item_ids and not legacy_sales_ids and not stock_ids:
            return

        completed_jobs = (
            ProductionJob.objects.filter(job_state__in=["COMPLETED", "DONE"])
            .filter(
                Q(sales_order_item_id__in=sales_item_ids)
                | Q(sales_order_item__sales_order_id__in=legacy_sales_ids)
                | Q(mts_order_id__in=stock_ids)
            )
            .select_related("work_center", "machine", "operator", "closed_by", "current_process", "process", "production_batch", "sales_order_item", "mts_order")
            .order_by("-closed_at", "-updated_at")
        )

        grouped = {}
        for job in completed_jobs:
            if getattr(job, "sales_order_item_id", None):
                key = f"sales-item:{str(getattr(job, 'sales_order_item_id', '') or '')}"
            else:
                order_id = str(getattr(job, "mts_order_id", "") or "")
                key = f"stock:{order_id}" if order_id else ""
            if not key:
                continue
            bucket = grouped.setdefault(key, [])
            if len(bucket) < jobs_per_row:
                bucket.append(job)

        for row in history_rows:
            if str(row.get("order_kind") or "").lower() == "sales" and str(row.get("sales_order_item_id") or ""):
                key = f"sales-item:{str(row.get('sales_order_item_id') or '')}"
            else:
                key = f"{str(row.get('order_kind') or '').lower()}:{str(row.get('order_id') or '')}"
            jobs = grouped.get(key, [])
            row["job_numbers"] = [str(getattr(job, "job_number", "") or "") for job in jobs if str(getattr(job, "job_number", "") or "")]
            row["completed_jobs"] = [self._serialize_completed_job_trace(job) for job in jobs]
            if not row.get("completed_at") and jobs:
                first_job = jobs[0]
                row["completed_at"] = (
                    first_job.closed_at.isoformat()
                    if getattr(first_job, "closed_at", None)
                    else (first_job.updated_at.isoformat() if getattr(first_job, "updated_at", None) else None)
                )

    def _row_artwork_gate(self, row: dict):
        pending_items = row.get("pending_artwork_items") if isinstance(row.get("pending_artwork_items"), list) else []
        active = bool(row.get("printing_enabled")) and bool(row.get("artwork_assignment_required")) and bool(pending_items)
        primary_item = pending_items[0] if pending_items else {}
        if active:
            message = "Printing was confirmed without final artwork. Planner must assign approved artwork before release."
        else:
            message = ""
        return {
            "active": active,
            "message": message,
            "pending_count": len(pending_items),
            "selected_item": primary_item,
            "items": pending_items,
            "print_type": str(primary_item.get("print_type") or row.get("print_type") or "").upper(),
            "substrate_mode": str(primary_item.get("substrate_mode") or row.get("substrate_mode") or "").upper(),
            "ink_base_family": str(primary_item.get("ink_base_family") or row.get("ink_base_family") or "").upper(),
            "front_colors_count": int(primary_item.get("front_colors_count") or row.get("front_colors_count") or 0),
            "back_colors_count": int(primary_item.get("back_colors_count") or row.get("back_colors_count") or 0),
        }

    def _row_release_checklist(self, row: dict):
        blockers = row.get("blockers") if isinstance(row.get("blockers"), list) else []
        inventory_options = row.get("inventory_options") if isinstance(row.get("inventory_options"), list) else []
        material_lines = row.get("material_plan_lines") if isinstance(row.get("material_plan_lines"), list) else []
        bom_errors = row.get("bom_readiness_errors") if isinstance(row.get("bom_readiness_errors"), list) else []
        artwork_gate = self._row_artwork_gate(row)
        if bom_errors:
            material_status = "BLOCKED"
            material_message = f"Recipe/BOM is not production-ready: {str(bom_errors[0])}"
        elif material_lines:
            material_status = "READY"
            material_message = "Material policy lines are available."
        else:
            material_status = "BLOCKED"
            material_message = "Material plan is missing."
        items = [
            {
                "code": "ROW_HEALTH",
                "label": "Planner row health",
                "status": "BLOCKED" if row.get("row_error") else "READY",
                "message": str(row.get("row_error") or "Row computed successfully."),
            },
            {
                "code": "MATH_VALID",
                "label": "Math validation",
                "status": "BLOCKED" if row.get("math_valid") is False else "READY",
                "message": str(row.get("math_error") or "Spec and quantity math are valid."),
            },
            {
                "code": "ARTWORK_GATE",
                "label": "Artwork assignment",
                "status": "BLOCKED" if artwork_gate["active"] else "READY",
                "message": artwork_gate["message"] or "Artwork gate cleared.",
            },
            {
                "code": "MATERIAL_PLAN",
                "label": "Material plan",
                "status": material_status,
                "message": material_message,
            },
            {
                "code": "SOURCE_PATH",
                "label": "Source path",
                "status": "READY" if inventory_options or not blockers else "ATTENTION",
                "message": self._row_source_summary(row).get("recommended_label"),
            },
        ]
        release_ready = not any(item["status"] == "BLOCKED" for item in items)
        return {
            "release_ready": release_ready,
            "blocked_count": sum(1 for item in items if item["status"] == "BLOCKED"),
            "items": items,
        }

    def _row_action_recommendation(self, row: dict):
        checklist = self._row_release_checklist(row)
        artwork_gate = self._row_artwork_gate(row)
        if artwork_gate["active"]:
            return {
                "key": "ASSIGN_ARTWORK",
                "label": "Assign approved artwork",
                "description": artwork_gate["message"],
                "tone": "warning",
            }
        if row.get("row_error") or row.get("math_valid") is False:
            return {
                "key": "FIX_ROW",
                "label": "Repair planning data",
                "description": "Resolve row-health or math issues before releasing.",
                "tone": "critical",
            }
        continuation = row.get("continuation") if isinstance(row.get("continuation"), dict) else self._row_continuation(row)
        return {
            "key": str(continuation.get("recommended_mode") or "FRESH"),
            "label": str(continuation.get("recommended_label") or "Review continuation path"),
            "description": "Follow the recommended continuation path, then release when the checklist is green."
            if checklist.get("release_ready")
            else "Clear remaining checklist blockers, then release.",
            "tone": "info",
        }

    def _row_template_steps(self, row: dict):
        template_id = str(row.get("template_id") or "").strip()
        if not template_id:
            return []
        cache = getattr(self, "_control_hub_template_steps_cache", None)
        if isinstance(cache, dict) and template_id in cache:
            return cache[template_id]
        try:
            template = TemplateBlueprint.objects.select_related("routing_rule").get(id=template_id)
        except Exception:
            return []
        try:
            process_steps = list(
                template.process_steps.select_related(
                    "process",
                    "default_work_center",
                    "default_work_center__plant",
                    "roll_spec",
                )
                .filter(is_removed_from_route=False)
                .order_by("sequence_number")
            )
        except Exception:
            process_steps = []
        routing_rule = getattr(template, "routing_rule", None)
        route_nodes = []
        if routing_rule:
            try:
                from apps.production.services.batch_route_service import RouteGraphService

                graph = RouteGraphService.normalize(routing_rule)
                route_nodes = list(graph.get("nodes") or [])
            except Exception:
                route_nodes = []
        ordered = [node.get("process_code") for node in route_nodes if node.get("process_code")]
        if not route_nodes:
            ordered = (
                [str(getattr(getattr(step, "process", None), "code", "") or "") for step in process_steps]
                if process_steps
                else ((routing_rule.ordered_processes if routing_rule else []) or [])
            )
            route_nodes = [
                {
                    "id": f"step_{index + 1}_{code}",
                    "label": str(code),
                    "process_code": str(code),
                    "route_index": index,
                    "branch_key": "MAIN",
                    "join_key": "",
                    "parallel_group": "",
                    "predecessor_node_ids": [],
                    "successor_node_ids": [],
                    "is_join": False,
                    "is_parallel_start": False,
                }
                for index, code in enumerate(ordered)
            ]
        if not ordered:
            return []
        process_map = {
            str(process.code): process
            for process in Process.objects.filter(code__in=ordered)
        }
        step_map = {
            int(step.sequence_number or 0) - 1: step
            for step in process_steps
        }
        steps = []
        for node in route_nodes:
            index = int(node.get("route_index") or 0)
            code = str(node.get("process_code") or "")
            process = process_map.get(str(code))
            step = step_map.get(index)
            default_wc = getattr(step, "default_work_center", None) if step else None
            try:
                roll_spec = getattr(step, "roll_spec", None) if step else None
            except Exception:
                roll_spec = None
            try:
                dispatch_status = TemplateDispatchService.step_status(step) if step else None
            except Exception:
                dispatch_status = None
            roll_handling = {}
            if roll_spec:
                roll_handling = {
                    "input_roll_count": int(getattr(roll_spec, "input_roll_count", 0) or 0),
                    "combine_mode": str(getattr(roll_spec, "combine_mode", "") or ""),
                    "input_lane_count": int(getattr(roll_spec, "input_lane_count", 0) or 0),
                    "lamination_pass_index": int(getattr(roll_spec, "lamination_pass_index", 0) or 0),
                    "active_min_layer_count": int(getattr(roll_spec, "active_min_layer_count", 0) or 0),
                    "lane_schema": getattr(roll_spec, "lane_schema", None) if isinstance(getattr(roll_spec, "lane_schema", None), list) else [],
                    "thickness_rule": str(getattr(roll_spec, "thickness_rule", "") or ""),
                    "width_rule": str(getattr(roll_spec, "width_rule", "") or ""),
                    "operator_entry_mode": str(getattr(roll_spec, "operator_entry_mode", "") or ""),
                    "notes": str(getattr(roll_spec, "notes", "") or ""),
                }
            steps.append({
                "id": str(getattr(step, "id", "") or node.get("id") or ""),
                "step_id": str(getattr(step, "id", "") or node.get("id") or ""),
                "route_node_id": str(node.get("id") or ""),
                "route_branch_key": str(node.get("branch_key") or "MAIN"),
                "join_key": str(node.get("join_key") or ""),
                "parallel_group": str(node.get("parallel_group") or ""),
                "predecessor_node_ids": list(node.get("predecessor_node_ids") or []),
                "successor_node_ids": list(node.get("successor_node_ids") or []),
                "is_join": bool(node.get("is_join")),
                "is_parallel_start": bool(node.get("is_parallel_start")),
                "sequence_number": index,
                "display_sequence": index + 1,
                "process_code": str(code),
                "process_name": str(node.get("label") or getattr(process, "name", "") or code),
                "step_name": str(node.get("label") or getattr(process, "name", "") or code),
                "input_form": str(getattr(process, "input_form", "") or ""),
                "output_form": str(getattr(process, "output_form", "") or ""),
                "roll_behavior": str(getattr(process, "roll_behavior", "") or ""),
                "process_roll_behavior": str(getattr(process, "roll_behavior", "") or ""),
                "process_transition": str(getattr(process, "transition", "") or ""),
                "process_has_artwork": bool(getattr(process, "has_artwork", False)),
                "has_artwork": bool(getattr(process, "has_artwork", False)),
                "allowed_work_center_ids": getattr(step, "allowed_work_center_ids", None) if step and isinstance(getattr(step, "allowed_work_center_ids", None), list) else [],
                "default_work_center_code": str(getattr(default_wc, "code", "") or ""),
                "default_work_center_name": str(getattr(default_wc, "name", "") or ""),
                "work_center_selection_policy": str(getattr(step, "work_center_selection_policy", "") or "") if step else "",
                "dispatch_notes": str(getattr(step, "dispatch_notes", "") or "") if step else "",
                "dispatch_status": dispatch_status,
                "notes": str(getattr(step, "notes", "") or "") if step else "",
                "roll_handling": roll_handling,
            })
        if isinstance(cache, dict):
            cache[template_id] = steps
        return steps

    def _decorate_control_hub_row(self, row: dict):
        row["template_steps"] = self._row_template_steps(row)
        row["source_availability"] = row.get("source_availability") if isinstance(row.get("source_availability"), dict) else {
            "fg_match_count": 0,
            "wip_match_count": 0,
            "has_fg": False,
            "has_wip": False,
            "matching_stock_order_count": 0,
            "pod_bulk_material_count": 0,
            "packaging_stock_material_count": 0,
        }
        row["blockers"] = self._row_blockers(row)
        row["summary"] = self._row_summary(row)
        row["workspace"] = row.get("workspace") if isinstance(row.get("workspace"), dict) else self._row_workspace(row)
        source_counts = row.get("source_availability") or {}
        has_source_context = bool(row.get("continuation")) or any(
            int(source_counts.get(key) or 0) > 0
            for key in ("fg_match_count", "wip_match_count", "matching_stock_order_count", "pod_bulk_material_count", "packaging_stock_material_count")
        )
        row["source_summary"] = row.get("source_summary") if isinstance(row.get("source_summary"), dict) else (
            self._row_source_summary(row)
            if has_source_context
            else {
                "fg_match_count": int((row.get("source_availability") or {}).get("fg_match_count") or 0),
                "wip_match_count": int((row.get("source_availability") or {}).get("wip_match_count") or 0),
                "matching_stock_order_count": int((row.get("source_availability") or {}).get("matching_stock_order_count") or 0),
                "recommended_option": "FRESH",
                "recommended_label": "Fresh production",
            }
        )
        row["continuation"] = row.get("continuation") if isinstance(row.get("continuation"), dict) else {
            "recommended_mode": "FRESH",
            "recommended_label": "Plan fresh conversion",
            "recommended_reason": "No reusable source path is attached to this row.",
            "exact_fg_count": 0,
            "exact_stock_route_count": 0,
            "carry_forward_wip_count": 0,
            "shared_invariant_count": 0,
            "upstream_route_count": 0,
            "exact_fg_candidates": [],
            "exact_stock_route_candidates": [],
            "carry_forward_wip_candidates": [],
            "shared_invariant_candidates": [],
            "stopped_invariant_route_candidates": [],
            "upstream_candidates": [],
            "stopped_upstream_route_candidates": [],
        }
        row["artwork_gate"] = row.get("artwork_gate") if isinstance(row.get("artwork_gate"), dict) else self._row_artwork_gate(row)
        row["release_checklist"] = row.get("release_checklist") if isinstance(row.get("release_checklist"), dict) else self._row_release_checklist(row)
        row["action_recommendation"] = row.get("action_recommendation") if isinstance(row.get("action_recommendation"), dict) else self._row_action_recommendation(row)
        row["order_fact_sheet"] = row.get("order_fact_sheet") if isinstance(row.get("order_fact_sheet"), dict) else self._row_order_fact_sheet(row)
        row["spec_summary"] = row.get("spec_summary") if isinstance(row.get("spec_summary"), dict) else self._row_spec_summary(row)
        row["production_trace"] = row.get("production_trace") if isinstance(row.get("production_trace"), dict) else self._row_production_trace(row)
        row["analytics"] = row.get("analytics") if isinstance(row.get("analytics"), dict) else self._row_v2_analytics(row)
        display_fields = self._row_display_fields(row)
        for key, value in display_fields.items():
            row[key] = value
        return row

    def _summary_control_hub_row(self, row: dict):
        continuation = row.get("continuation") if isinstance(row.get("continuation"), dict) else {}
        if continuation:
            continuation = {
                key: value
                for key, value in continuation.items()
                if not str(key).endswith("_candidates")
            }
        workspace = row.get("workspace") if isinstance(row.get("workspace"), dict) else {}
        slim_workspace = {
            "route_span": workspace.get("route_span"),
            "material_plan_summary": workspace.get("material_plan_summary"),
            "source_availability": workspace.get("source_availability"),
        }
        keep_keys = {
            "order_kind",
            "order_id",
            "sales_order_item_id",
            "sales_order_line_index",
            "line_label",
            "line_status",
            "line_status_display",
            "line_status_reason",
            "qty_open",
            "qty_final_output",
            "qty_dispatchable",
            "qty_replan_remaining",
            "qty_replan_remaining_kg",
            "qty_cancelled",
            "qty_short_closed",
            "qty_dispatched",
            "parent_status",
            "order_number",
            "customer_name",
            "display_name",
            "delivery_date",
            "status",
            "template_id",
            "template_name",
            "product_master_id",
            "product_master_code",
            "product_master_name",
            "product_master_label",
            "fg_type",
            "final_product_type",
            "planned_output_type",
            "stock_strategy",
            "planner_stock_class",
            "required_qty_kg",
            "required_qty_pcs",
            "unit_weight_g",
            "qty_uom",
            "math_valid",
            "math_error",
            "required_start_step",
            "route_last_step_index",
            "required_roll_width_mm",
            "effective_dims",
            "spec_signature",
            "material_plan_summary",
            "bom_ready",
            "bom_readiness_errors",
            "artwork_assignment_required",
            "assigned_artwork_id",
            "printing_enabled",
            "print_type",
            "substrate_mode",
            "ink_base_family",
            "front_colors_count",
            "back_colors_count",
            "partial_replan_required",
            "partial_shortfall_kg",
            "partial_shortfall_pct",
            "partial_produced_kg",
            "partial_target_kg",
            "job_count",
            "jobs_released",
            "jobs_completed",
            "created_at",
            "completed_at",
            "job_numbers",
            "display_qty_kg",
            "display_qty_pcs",
            "display_geometry_label",
            "display_layers",
            "display_printing_label",
            "display_addons_label",
            "display_packaging_label",
            "display_route_summary",
            "display_material_summary",
            "display_action_label",
            "display_action_help",
            "row_error",
            "row_error_detail",
            "row_recoverable",
            "inventory_options_error",
            "blockers",
            "source_availability",
            "source_summary",
            "summary",
            "artwork_gate",
            "release_checklist",
            "action_recommendation",
            "order_fact_sheet",
            "spec_summary",
            "production_trace",
            "analytics",
        }
        slim = {key: row.get(key) for key in keep_keys if key in row}
        slim["continuation"] = continuation
        slim["workspace"] = slim_workspace
        slim["inventory_options"] = []
        slim["matching_stock_orders"] = []
        slim["pending_artwork_items"] = []
        # Keep the lightweight route graph for active/live boards. Heavy
        # inventory candidates are still stripped, but route stages are small
        # and are the only reliable way for the UI to show full line progress
        # when only the first job has been released.
        slim["template_steps"] = row.get("template_steps") if isinstance(row.get("template_steps"), list) else []
        slim["summary_mode"] = True
        slim["detail_required_for_release"] = True
        return slim

    def _control_hub_v2_analytics(self, planning_queue: list, active_orders: list, order_history: list):
        rows = [row for row in [*planning_queue, *active_orders, *order_history] if isinstance(row, dict)]

        def kg(row):
            try:
                return float(row.get("required_qty_kg") or 0)
            except Exception:
                return 0.0

        def add_bucket(bucket_map, key, row):
            label = str(key or "UNKNOWN").upper()
            entry = bucket_map.setdefault(label, {"key": label, "label": label.replace("_", " ").title(), "count": 0, "kg": 0.0})
            entry["count"] += 1
            entry["kg"] += kg(row)

        queue_buckets = {}
        stock_coverage = {}
        source_mix = {}
        route_progress = {}
        blocker_counts = {}
        def release_ready(row):
            checklist = row.get("release_checklist") if isinstance(row.get("release_checklist"), dict) else {}
            return bool(checklist.get("release_ready"))

        def artwork_waiting(row):
            gate = row.get("artwork_gate") if isinstance(row.get("artwork_gate"), dict) else {}
            return bool(gate.get("active"))

        for row in planning_queue:
            analytics = row.get("analytics") if isinstance(row.get("analytics"), dict) else {}
            if row.get("blockers"):
                add_bucket(queue_buckets, "BLOCKED", row)
            elif artwork_waiting(row):
                add_bucket(queue_buckets, "ARTWORK_WAITING", row)
            elif bool(row.get("partial_replan_required")):
                add_bucket(queue_buckets, "PARTIAL_REPLAN", row)
            elif release_ready(row):
                add_bucket(queue_buckets, "READY_FOR_RELEASE", row)
            else:
                add_bucket(queue_buckets, "PLANNING_REQUIRED", row)
            coverage_pct = float(analytics.get("coverage_pct") or 0)
            if coverage_pct >= 100:
                add_bucket(stock_coverage, "COVERED", row)
            elif coverage_pct >= 50:
                add_bucket(stock_coverage, "TIGHT", row)
            elif coverage_pct > 0:
                add_bucket(stock_coverage, "SHORT", row)
            else:
                add_bucket(stock_coverage, "NO_STOCK_MATCH", row)
            for blocker in row.get("blockers") or []:
                if not isinstance(blocker, dict):
                    continue
                code = str(blocker.get("code") or "BLOCKER").upper()
                entry = blocker_counts.setdefault(code, {"code": code, "label": code.replace("_", " ").title(), "count": 0})
                entry["count"] += 1
        for row in rows:
            analytics = row.get("analytics") if isinstance(row.get("analytics"), dict) else {}
            trace = row.get("production_trace") if isinstance(row.get("production_trace"), dict) else {}
            add_bucket(source_mix, analytics.get("source_path") or "FRESH", row)
            add_bucket(route_progress, trace.get("job_state") or analytics.get("wcm_state") or "UNKNOWN", row)

        rhythm_map = {}
        for row in order_history:
            analytics = row.get("analytics") if isinstance(row.get("analytics"), dict) else {}
            completed_at = analytics.get("completed_at") or row.get("completed_at")
            if not completed_at:
                continue
            try:
                completed_dt = timezone.datetime.fromisoformat(str(completed_at).replace("Z", "+00:00"))
                key = completed_dt.date().isoformat()
            except Exception:
                continue
            entry = rhythm_map.setdefault(key, {"date": key, "orders": 0, "kg": 0.0})
            entry["orders"] += 1
            entry["kg"] += kg(row)

        return {
            "queue_buckets": list(queue_buckets.values()),
            "source_mix": list(source_mix.values()),
            "blocker_counts": sorted(blocker_counts.values(), key=lambda item: item["count"], reverse=True),
            "route_progress": list(route_progress.values()),
            "stock_coverage": list(stock_coverage.values()),
            "output_rhythm": sorted(rhythm_map.values(), key=lambda item: item["date"])[-21:],
            "completion_funnel": {
                "planning_queue": len(planning_queue),
                "active_orders": len(active_orders),
                "completed_history": len(order_history),
                "blocked_queue": sum(1 for row in planning_queue if bool(row.get("blockers"))),
                "release_ready": sum(1 for row in planning_queue if release_ready(row)),
            },
        }

    def _control_hub_row_matches_queue_filters(self, row: dict, filters: dict):
        search = str(filters.get("search") or "").strip().lower()
        if search:
            haystack = " ".join(
                [
                    str(row.get("order_number") or ""),
                    str(row.get("customer_name") or ""),
                    str(row.get("display_name") or ""),
                    str(row.get("template_name") or ""),
                ]
            ).lower()
            if search not in haystack:
                return False

        fg_type = str(filters.get("fg_type") or "").upper()
        if fg_type and fg_type != "ALL":
            row_fg = str(row.get("fg_type") or row.get("final_product_type") or "").upper()
            if fg_type not in row_fg:
                return False

        customer = str(filters.get("customer") or "").strip()
        if customer and customer.upper() != "ALL" and str(row.get("customer_name") or "") != customer:
            return False

        template = str(filters.get("template") or "").strip()
        if template and template.upper() != "ALL" and str(row.get("template_name") or "") != template:
            return False

        material = str(filters.get("material") or "").strip().upper()
        if material and material != "ALL":
            layers = row.get("display_layers")
            if not isinstance(layers, list) or not layers:
                layers = [
                    str(layer.get("name") or layer.get("material_name") or "")
                    for layer in (row.get("layer_snapshot") if isinstance(row.get("layer_snapshot"), list) else [])
                    if isinstance(layer, dict)
                ]
            if material not in " ".join(str(value or "").upper() for value in layers):
                return False

        try:
            width = float((row.get("effective_dims") or {}).get("width_mm") or 0)
        except Exception:
            width = 0.0
        min_width = filters.get("min_width")
        max_width = filters.get("max_width")
        if min_width not in (None, ""):
            try:
                if width < float(min_width):
                    return False
            except Exception:
                pass
        if max_width not in (None, ""):
            try:
                if width > float(max_width):
                    return False
            except Exception:
                pass

        source_path = str(filters.get("source_path") or "").upper()
        if source_path and source_path != "ALL":
            availability = row.get("source_availability") if isinstance(row.get("source_availability"), dict) else {}
            continuation = row.get("continuation") if isinstance(row.get("continuation"), dict) else {}
            blockers = row.get("blockers") if isinstance(row.get("blockers"), list) else []
            has_fg = bool(availability.get("has_fg"))
            has_wip = bool(availability.get("has_wip"))
            has_upstream = (
                bool(availability.get("has_compatible_upstream_roll"))
                or bool(availability.get("has_shared_invariant_roll_stock"))
                or int(continuation.get("shared_invariant_count") or 0) > 0
                or int(continuation.get("upstream_route_count") or 0) > 0
                or int(availability.get("matching_stock_order_count") or 0) > 0
            )
            has_shared = (
                bool(availability.get("has_shared_invariant_roll_stock"))
                or
                int(continuation.get("shared_invariant_count") or 0) > 0
            )
            has_pod = int(availability.get("pod_bulk_material_count") or 0) > 0
            has_packaging = int(availability.get("packaging_stock_material_count") or 0) > 0
            if source_path == "FG" and not has_fg:
                return False
            if source_path == "WIP" and (has_fg or not has_wip):
                return False
            if source_path == "INVARIANT" and (has_fg or has_wip or not has_shared):
                return False
            if source_path in ("INPUT", "UPSTREAM") and (has_fg or has_wip or has_shared or not has_upstream):
                return False
            if source_path == "POD_BULK" and not has_pod:
                return False
            if source_path == "PACKAGING_STOCK" and not has_packaging:
                return False
            if source_path == "FRESH" and (has_fg or has_wip or has_shared or has_upstream or has_pod or has_packaging):
                return False
            if source_path == "BLOCKED" and not blockers:
                return False

        release = str(filters.get("release") or "").lower()
        if release and release != "all":
            blockers = row.get("blockers") if isinstance(row.get("blockers"), list) else []
            ready = row.get("math_valid") is not False and not blockers and (
                not bool(row.get("artwork_assignment_required")) or bool(row.get("assigned_artwork_id"))
            )
            blocked = bool(blockers) or row.get("math_valid") is False
            needs_artwork = bool(row.get("artwork_assignment_required")) and not bool(row.get("assigned_artwork_id"))
            if release == "ready" and not ready:
                return False
            if release == "blocked" and not blocked:
                return False
            if release == "artwork" and not needs_artwork:
                return False

        lifecycle = str(filters.get("lifecycle") or "").lower()
        if lifecycle and lifecycle != "all":
            line_status = str(row.get("line_status") or "").upper()
            replan_qty = Decimal(str(row.get("qty_replan_remaining_kg") or row.get("partial_shortfall_kg") or 0))
            dispatchable_qty = Decimal(str(row.get("qty_dispatchable") or 0))
            is_partial_replan = bool(row.get("partial_replan_required")) or line_status == "PARTIAL" or replan_qty > Decimal("0.001")
            if lifecycle == "partial_replan" and not is_partial_replan:
                return False
            if lifecycle == "partial_dispatchable" and not (is_partial_replan and dispatchable_qty > Decimal("0.001")):
                return False

        print_filter = str(filters.get("print") or "").upper()
        if print_filter and print_filter != "ALL":
            print_type = str(row.get("print_type") or "").upper()
            printing_enabled = bool(row.get("printing_enabled")) or int(row.get("front_colors_count") or 0) > 0
            if print_filter == "NO_PRINT":
                if printing_enabled:
                    return False
            elif print_type != print_filter:
                return False

        lifecycle = str(filters.get("lifecycle") or "").lower()
        if lifecycle and lifecycle != "all":
            try:
                replan_kg = Decimal(str(row.get("qty_replan_remaining_kg") or row.get("partial_shortfall_kg") or 0))
            except Exception:
                replan_kg = Decimal("0")
            try:
                dispatchable_qty = Decimal(str(row.get("qty_dispatchable") or 0))
            except Exception:
                dispatchable_qty = Decimal("0")
            is_partial_replan = (
                bool(row.get("partial_replan_required"))
                or str(row.get("line_status") or "").upper() == "PARTIAL"
                or replan_kg > Decimal("0.001")
            )
            if lifecycle == "partial_replan" and not is_partial_replan:
                return False
            if lifecycle == "partial_dispatchable" and not (is_partial_replan and dispatchable_qty > Decimal("0.001")):
                return False

        age = str(filters.get("age") or "").lower()
        if age and age != "all":
            created_at = row.get("created_at")
            if not created_at:
                return False
            try:
                created_dt = timezone.datetime.fromisoformat(str(created_at).replace("Z", "+00:00"))
                if timezone.is_naive(created_dt):
                    created_dt = timezone.make_aware(created_dt, timezone.get_current_timezone())
                days = max(0, int((timezone.now() - created_dt).total_seconds() // 86400))
            except Exception:
                return False
            if age == "0-3d" and not (0 <= days <= 3):
                return False
            if age == "4-7d" and not (4 <= days <= 7):
                return False
            if age == "8-14d" and not (8 <= days <= 14):
                return False
            if age == "15-30d" and not (15 <= days <= 30):
                return False
            if age == "30+d" and days < 30:
                return False

        overdue = str(filters.get("overdue_only") or "").lower() in {"1", "true", "yes", "on"}
        if overdue:
            due = row.get("delivery_date")
            if not due:
                return False
            try:
                due_dt = timezone.datetime.fromisoformat(str(due).replace("Z", "+00:00"))
                if timezone.is_naive(due_dt):
                    due_dt = timezone.make_aware(due_dt, timezone.get_current_timezone())
                if due_dt.date() >= timezone.localdate():
                    return False
            except Exception:
                return False

        return True

    def _control_hub_row_live_state(self, row: dict) -> str:
        if bool(row.get("partial_replan_required")) or str(row.get("line_status") or "").upper() == "PARTIAL":
            return "REPLAN_REQUIRED"
        trace = row.get("production_trace") if isinstance(row.get("production_trace"), dict) else {}
        return str(
            trace.get("job_state")
            or trace.get("wcm_handoff_state")
            or row.get("line_status")
            or row.get("status")
            or ""
        ).upper()

    def _control_hub_row_matches_active_filters(self, row: dict, filters: dict):
        filters = filters if isinstance(filters, dict) else {}
        search = str(filters.get("search") or "").strip().lower()
        if search:
            haystack = " ".join(
                [
                    str(row.get("order_number") or ""),
                    str(row.get("customer_name") or ""),
                    str(row.get("display_name") or ""),
                    str(row.get("line_label") or ""),
                    str(row.get("template_name") or ""),
                    str(row.get("product_master_label") or ""),
                    str(row.get("product_master_code") or ""),
                    str(row.get("product_master_name") or ""),
                ]
            ).lower()
            if search not in haystack:
                return False

        state_filter = str(filters.get("state") or "").strip().lower()
        state = self._control_hub_row_live_state(row)
        blockers = row.get("blockers") if isinstance(row.get("blockers"), list) else []
        if state_filter and state_filter != "all":
            if state_filter == "running" and state not in {"EXECUTING", "RUNNING", "IN_PRODUCTION"}:
                return False
            if state_filter == "released" and state not in {"RELEASED", "WCM_HANDOFF_READY", "PLANNED"}:
                return False
            if state_filter == "waiting" and state not in {"WAITING", "PAUSED"}:
                return False
            if state_filter == "replan" and state != "REPLAN_REQUIRED":
                return False
            if state_filter == "blocked" and not blockers and state != "BLOCKED":
                return False

        path_filter = str(filters.get("path") or "").strip().lower()
        if path_filter and path_filter != "all":
            if path_filter == "replan" and state != "REPLAN_REQUIRED":
                return False
            if path_filter == "handoff" and state not in {"WCM_HANDOFF_READY", "PLANNED", "RELEASED"}:
                return False
            if path_filter == "production" and state not in {"EXECUTING", "RUNNING", "IN_PRODUCTION", "WAITING", "PAUSED"}:
                return False

        return True

    def _inventory_source_bucket(self, option: dict, row: dict | None = None):
        if not isinstance(option, dict):
            return "UNKNOWN"
        explicit_bucket = str(option.get("source_bucket") or "").upper()
        if explicit_bucket:
            return explicit_bucket
        if bool(option.get("is_final_step")):
            return "FINISHED_STOCK"
        if str(option.get("signature_match_mode") or "").upper() == "STEP0_RAW":
            return "COMPATIBLE_UPSTREAM_ROLL_STOCK"
        completed_step_index = int(option.get("completed_step_index") or 0)
        required_start_step = int((row or {}).get("required_start_step") or 0)
        if completed_step_index <= 0:
            return "COMPATIBLE_UPSTREAM_ROLL_STOCK"
        if required_start_step > 0 and completed_step_index < required_start_step:
            return "COMPATIBLE_UPSTREAM_ROLL_STOCK"
        return "CARRY_FORWARD_WIP"

    def _pod_source_availability(self, row: dict):
        lines = row.get("material_plan_lines") if isinstance(row.get("material_plan_lines"), list) else []
        pod_material_ids = []
        for line in lines:
            if not isinstance(line, dict):
                continue
            if str(line.get("category_code") or "").upper() != "POD":
                continue
            material_id = str(line.get("material_id") or "").strip()
            if material_id:
                pod_material_ids.append(material_id)
        if not pod_material_ids:
            return {
                "pod_bulk_material_count": 0,
                "pod_bulk_qty_kg": Decimal("0"),
                "pod_inhouse_producible_count": 0,
                "has_pod_bulk_stock": False,
                "has_pod_inhouse_production": False,
            }
        pod_bulk_qty = (
            InventoryBulk.objects.filter(material_id__in=pod_material_ids)
            .aggregate(total=Sum("qty_kg"))
            .get("total")
            or Decimal("0")
        )
        pod_qs = InventoryMaterial.objects.filter(id__in=pod_material_ids, category="POD")
        inhouse_count = pod_qs.filter(pod_is_inhouse_produced=True).count()
        return {
            "pod_bulk_material_count": len(set(pod_material_ids)),
            "pod_bulk_qty_kg": Decimal(str(pod_bulk_qty or 0)),
            "pod_inhouse_producible_count": int(inhouse_count),
            "has_pod_bulk_stock": Decimal(str(pod_bulk_qty or 0)) > 0,
            "has_pod_inhouse_production": inhouse_count > 0,
        }

    def _packaging_source_availability(self, row: dict):
        packaging_snapshot = row.get("packaging_snapshot") if isinstance(row.get("packaging_snapshot"), dict) else {}
        primary_cfg = packaging_snapshot.get("primary_inner_pack") if isinstance(packaging_snapshot.get("primary_inner_pack"), dict) else {}
        roll_pack_cfg = packaging_snapshot.get("roll_dispatch_pack") if isinstance(packaging_snapshot.get("roll_dispatch_pack"), dict) else {}

        material_ids = set()
        primary_material_id = str(primary_cfg.get("material_id") or "").strip()
        if primary_material_id:
            material_ids.add(primary_material_id)
        for line in roll_pack_cfg.get("lines") if isinstance(roll_pack_cfg.get("lines"), list) else []:
            if not isinstance(line, dict):
                continue
            material_id = str(line.get("material_id") or "").strip()
            if material_id:
                material_ids.add(material_id)

        if not material_ids:
            return {
                "packaging_stock_material_count": 0,
                "packaging_stock_row_count": 0,
                "packaging_inhouse_producible_count": 0,
                "has_packaging_stock": False,
                "has_packaging_inhouse_production": False,
            }

        stock_row_count = PackagingStock.objects.filter(material_id__in=list(material_ids), qty__gt=0).count()
        material_qs = InventoryMaterial.objects.filter(id__in=list(material_ids), category="PACKAGING")
        inhouse_count = material_qs.filter(packaging_supply_mode__in=["IN_HOUSE", "BOTH"]).count()
        return {
            "packaging_stock_material_count": len(material_ids),
            "packaging_stock_row_count": int(stock_row_count),
            "packaging_inhouse_producible_count": int(inhouse_count),
            "has_packaging_stock": stock_row_count > 0,
            "has_packaging_inhouse_production": inhouse_count > 0,
        }

    def _source_availability(self, row: dict):
        inventory_options = row.get("inventory_options") if isinstance(row.get("inventory_options"), list) else []
        fg_match_count = 0
        carry_forward_wip_count = 0
        shared_invariant_roll_count = 0
        compatible_upstream_roll_match_count = 0
        for option in inventory_options:
            if not isinstance(option, dict):
                continue
            bucket = self._inventory_source_bucket(option, row=row)
            if bucket == "FINISHED_STOCK":
                fg_match_count += 1
            elif bucket == "CARRY_FORWARD_WIP":
                carry_forward_wip_count += 1
            elif bucket == "SHARED_INVARIANT_ROLL_STOCK":
                shared_invariant_roll_count += 1
            elif bucket == "COMPATIBLE_UPSTREAM_ROLL_STOCK":
                compatible_upstream_roll_match_count += 1
        availability = {
            "fg_match_count": fg_match_count,
            "wip_match_count": carry_forward_wip_count,
            "carry_forward_wip_count": carry_forward_wip_count,
            "shared_invariant_roll_count": shared_invariant_roll_count,
            "compatible_upstream_roll_match_count": compatible_upstream_roll_match_count,
            "fresh_raw_input_count": compatible_upstream_roll_match_count,
            "has_fg": fg_match_count > 0,
            "has_wip": carry_forward_wip_count > 0,
            "has_carry_forward_wip": carry_forward_wip_count > 0,
            "has_shared_invariant_roll_stock": shared_invariant_roll_count > 0,
            "has_compatible_upstream_roll": compatible_upstream_roll_match_count > 0,
            "has_fresh_raw_input": True,
            # Planner control tower only needs route-source signals here.
            # Packaging and POD stock counts are derived on dedicated flows and
            # were causing unnecessary per-row DB work on the hot planner path.
            "pod_bulk_material_count": 0,
            "pod_bulk_qty_kg": 0.0,
            "pod_inhouse_producible_count": 0,
            "has_pod_bulk_stock": False,
            "has_pod_inhouse_production": False,
            "packaging_stock_material_count": 0,
            "packaging_stock_row_count": 0,
            "packaging_inhouse_producible_count": 0,
            "has_packaging_stock": False,
            "has_packaging_inhouse_production": False,
        }
        return availability

    def _cheap_source_availability(
        self,
        *,
        template,
        required_start_step: int,
        route_last_index: int,
        order_signature: str = "",
        order_invariant_signature: str = "",
    ):
        fg_match_count = 0
        if order_signature:
            fg_batches = (
                FinishedGoodsBatch.objects.filter(
                    status="AVAILABLE",
                    template=template,
                    completed_step_index=route_last_index,
                )
                .select_related("sales_order_item", "production_job__mts_order")
            )
            fg_match_count = sum(1 for batch in fg_batches if self._fg_signature(batch) == order_signature)

        wip_match_count = 0
        if order_invariant_signature:
            wip_rolls = (
                InventoryRoll.objects.filter(
                    status="AVAILABLE",
                    template=template,
                    completed_step_index__gte=max(0, int(required_start_step or 0)),
                    completed_step_index__lt=route_last_index,
                )
                .select_related("sales_order_item", "created_by_job__mts_order", "production_job__mts_order")
            )
            wip_match_count = sum(1 for roll in wip_rolls if self._roll_invariant_signature(roll) == order_invariant_signature)
        return {
            "fg_match_count": int(fg_match_count),
            "wip_match_count": int(wip_match_count),
            "carry_forward_wip_count": int(wip_match_count),
            "shared_invariant_roll_count": 0,
            "compatible_upstream_roll_match_count": 0,
            "fresh_raw_input_count": 1,
            "has_fg": fg_match_count > 0,
            "has_wip": wip_match_count > 0,
            "has_carry_forward_wip": wip_match_count > 0,
            "has_shared_invariant_roll_stock": False,
            "has_compatible_upstream_roll": False,
            "has_fresh_raw_input": True,
            "pod_bulk_material_count": 0,
            "pod_bulk_qty_kg": 0.0,
            "pod_inhouse_producible_count": 0,
            "has_pod_bulk_stock": False,
            "has_pod_inhouse_production": False,
            "packaging_stock_material_count": 0,
            "packaging_stock_row_count": 0,
            "packaging_inhouse_producible_count": 0,
            "has_packaging_stock": False,
            "has_packaging_inhouse_production": False,
        }

    def _cheap_continuation_summary(self, source_availability: dict):
        has_fg = bool((source_availability or {}).get("has_fg"))
        has_wip = bool((source_availability or {}).get("has_wip"))
        if has_fg:
            mode = "EXACT_FG"
        elif has_wip:
            mode = "CARRY_FORWARD_WIP"
        else:
            mode = "FRESH"
        return {
            "recommended_mode": mode,
            "recommended_label": self._continuation_label_for_mode(mode),
            "recommended_reason": self._continuation_reason_for_mode(mode),
            "exact_fg_count": int((source_availability or {}).get("fg_match_count") or 0),
            "exact_stock_route_count": 0,
            "carry_forward_wip_count": int((source_availability or {}).get("wip_match_count") or 0),
            "shared_invariant_count": 0,
            "upstream_route_count": 0,
            "exact_fg_candidates": [],
            "exact_stock_route_candidates": [],
            "carry_forward_wip_candidates": [],
            "shared_invariant_candidates": [],
            "stopped_invariant_route_candidates": [],
            "upstream_candidates": [],
            "stopped_upstream_route_candidates": [],
        }

    def _layer_stack_summary(self, layer_snapshot, *, resolve_materials: bool = True):
        layers = layer_snapshot if isinstance(layer_snapshot, list) else []
        material_cache = getattr(self, "_planner_material_display_cache", None)
        if material_cache is None:
            material_cache = {}
            self._planner_material_display_cache = material_cache

        requested_ids = []
        if resolve_materials:
            for layer in layers:
                if not isinstance(layer, dict):
                    continue
                for key in ("variant_id", "material_id", "family_id"):
                    material_id = str(layer.get(key) or "").strip()
                    if material_id and material_id not in material_cache:
                        requested_ids.append(material_id)
        if resolve_materials and requested_ids:
            for material in InventoryMaterial.objects.filter(id__in=list(dict.fromkeys(requested_ids))):
                material_cache[str(material.id)] = {
                    "code": str(getattr(material, "code", "") or "").strip(),
                    "name": str(getattr(material, "name", "") or "").strip(),
                    "grade": str(getattr(material, "grade", "") or "").strip(),
                }

        summary = []
        for index, layer in enumerate(layers):
            if not isinstance(layer, dict):
                continue
            resolved = {}
            for key in ("variant_id", "material_id", "family_id"):
                material_id = str(layer.get(key) or "").strip()
                if material_id and material_cache.get(material_id):
                    resolved = material_cache.get(material_id) or {}
                    break
            material = (
                str(layer.get("variant_name") or layer.get("film_variant_name") or "").strip()
                or str(resolved.get("name") or "").strip()
                or str(layer.get("material_name") or "").strip()
                or str(layer.get("name") or "").strip()
                or str(layer.get("material_code") or "").strip()
                or str(resolved.get("code") or "").strip()
                or f"Layer {index + 1}"
            )
            material_code = (
                str(layer.get("material_code") or "").strip()
                or str(resolved.get("code") or "").strip()
            )
            grade = (
                str(layer.get("grade_code") or layer.get("grade_name") or "").strip()
                or str(resolved.get("grade") or "").strip()
            )
            thickness = Decimal(str(layer.get("thickness_micron") or 0))
            width = Decimal(str(layer.get("roll_width_mm") or layer.get("width_mm") or 0))
            parts = [material]
            if material_code and material_code.upper() != material.upper():
                parts.append(material_code)
            if grade:
                parts.append(grade)
            if thickness > 0:
                parts.append(f"{thickness.quantize(Decimal('0.01'))}μ")
            if width > 0:
                parts.append(f"{width.quantize(Decimal('0.1'))} mm")
            summary.append(" · ".join(parts))
        return summary

    def _apply_issue_policy_overrides_to_bom(self, bom_snapshot, issue_policy_overrides):
        payload = dict(bom_snapshot or {})
        src_lines = payload.get("planning_lines") if isinstance(payload.get("planning_lines"), list) else []
        raw_overrides = issue_policy_overrides if isinstance(issue_policy_overrides, list) else []
        override_map = {}
        for row in raw_overrides:
            if not isinstance(row, dict):
                continue
            policy_key = str(row.get("policy_key") or "").strip()
            if not policy_key:
                continue
            mode = str(row.get("issue_policy_mode") or "NONE").strip().upper()
            if mode not in {"NONE", "PERCENT_OVER_THEORY", "FIXED_EXTRA_KG", "MINIMUM_ISSUE_KG"}:
                mode = "NONE"
            try:
                value = Decimal(str(row.get("issue_policy_value") or 0))
            except Exception:
                value = Decimal("0")
            override_map[policy_key] = {
                "issue_policy_mode": mode,
                "issue_policy_value": value,
            }

        updated_lines = []
        serialized_overrides = []
        for row in src_lines:
            if not isinstance(row, dict):
                continue
            if str(row.get("category_code") or "").strip().upper() in {"INK", "INKS"}:
                next_row = dict(row)
                next_row["override_issue_policy_mode"] = None
                next_row["override_issue_policy_value"] = None
                next_row["effective_issue_policy_mode"] = "NONE"
                next_row["effective_issue_policy_value"] = 0.0
                next_row["planned_issue_qty"] = 0.0
                next_row["policy_source"] = "INK_FLOOR_RECONCILIATION"
                updated_lines.append(next_row)
                continue
            policy_key = str(row.get("policy_key") or "").strip()
            theoretical_qty = Decimal(str(row.get("theoretical_qty") or 0))
            template_mode = str(row.get("template_issue_policy_mode") or "NONE").upper()
            template_value = Decimal(str(row.get("template_issue_policy_value") or 0))
            override = override_map.get(policy_key)
            effective_mode = str((override or {}).get("issue_policy_mode") or template_mode or "NONE").upper()
            effective_value = Decimal(str((override or {}).get("issue_policy_value", template_value) or template_value or 0))
            planned_issue_qty = _planned_issue_qty(theoretical_qty, effective_mode, effective_value)

            next_row = dict(row)
            if override:
                next_row["override_issue_policy_mode"] = override["issue_policy_mode"]
                next_row["override_issue_policy_value"] = float(override["issue_policy_value"])
                next_row["policy_source"] = "ORDER_OVERRIDE"
                serialized_overrides.append(
                    {
                        "policy_key": policy_key,
                        "issue_policy_mode": override["issue_policy_mode"],
                        "issue_policy_value": float(override["issue_policy_value"]),
                    }
                )
            else:
                next_row["override_issue_policy_mode"] = None
                next_row["override_issue_policy_value"] = None
                next_row["policy_source"] = "TEMPLATE_DEFAULT"
            next_row["effective_issue_policy_mode"] = effective_mode
            next_row["effective_issue_policy_value"] = float(effective_value)
            next_row["planned_issue_qty"] = float(planned_issue_qty)
            updated_lines.append(next_row)

        payload["planning_lines"] = updated_lines
        payload["planning_summary"] = _summarize_material_plan_lines(updated_lines)
        payload["issue_policy_overrides"] = serialized_overrides
        return payload

    def _eligible_inventory_for_order(
        self,
        order_kind: str,
        order_obj,
        template,
        order_signature: str,
        order_invariant_signature: str,
        required_start_step: int,
        route_last_index: int,
        roll_alloc_map,
        fg_alloc_map,
        order_layer_snapshot=None,
        sales_item=None,
    ):
        options = []
        max_roll_candidates = 24
        max_fg_candidates = 12
        order_routing_rule_id = getattr(template, "routing_rule_id", None)

        required_start_step = int(required_start_step or 0)
        shared_invariant_min_step = max(0, required_start_step - 1)
        order_layer_only_signature = self._layer_only_invariant_signature(order_layer_snapshot or [])
        required_layer_material_ids = self._layer_material_ids(order_layer_snapshot or [])
        required_width_mm = self._sales_item_roll_width_mm(sales_item or order_obj) if order_kind == "sales" else _snapshot_max_roll_width_mm(
            getattr(order_obj, "geometry_snapshot", None) or {},
            order_layer_snapshot or getattr(order_obj, "layer_snapshot", None) or [],
        )
        stage0_roll_input_allowed = (
            required_start_step == 0
            and self._route_step_can_start_from_purchased_roll(template, 0)
        )

        # Stage-0 roll input must be exact layer material stock at stage 0.
        # Wider rolls can still appear because they are slittable, but later-stage
        # WIP/finished rolls must not masquerade as raw input stock.
        # For shared invariant WIP, the reusable roll is often stopped at the step immediately before
        # the sales route resumes, e.g. generic laminated roll before a print step.
        filter_q = Q(status="AVAILABLE") & Q(completed_step_index__gte=shared_invariant_min_step)
        
        if required_start_step == 0:
            if stage0_roll_input_allowed and required_layer_material_ids:
                filter_q &= Q(material_id__in=required_layer_material_ids, completed_step_index=0)
            elif required_layer_material_ids:
                import uuid
                uuid_layer_ids = []
                for material_id in required_layer_material_ids:
                    try:
                        uuid.UUID(str(material_id))
                        uuid_layer_ids.append(material_id)
                    except ValueError:
                        continue
                if uuid_layer_ids:
                    filter_q &= (Q(template=template) | Q(template__isnull=True, material_id__in=uuid_layer_ids))
                else:
                    filter_q &= Q(template=template)
            else:
                filter_q &= Q(template=template)
        else:
            filter_q &= Q(template=template)

        rolls = (
            InventoryRoll.objects.filter(filter_q)
            .select_related("template", "material", "sales_order_item", "location", "location__plant")
            .order_by("-created_at", "completed_step_index")
        )

        for roll in rolls:
            roll_route_id = getattr(getattr(roll, "template", None), "routing_rule_id", None)
            if order_routing_rule_id and roll.template_id and roll_route_id != order_routing_rule_id:
                continue
            inv_sig = self._roll_signature(roll)
            inv_inv_sig = self._roll_invariant_signature(roll)
            completed_step_index = int(roll.completed_step_index or 0)
            is_final_step = completed_step_index == route_last_index
            same_lineage = self._is_same_order_lineage_roll(roll, order_kind, order_obj)
            source_planner_class = self._planner_stock_class_for_roll(roll)
            source_stock_order = self._origin_stock_order_for_roll(roll)
            stage0_bulk_roll = (
                required_start_step == 0
                and completed_step_index == 0
                and not is_final_step
                and not stage0_roll_input_allowed
            )
            stage0_stock_continue = False
            if stage0_bulk_roll and source_stock_order:
                source_layer_sig = self._layer_only_invariant_signature(source_stock_order.layer_snapshot or [])
                stage0_stock_continue = bool(order_layer_only_signature and source_layer_sig == order_layer_only_signature)
            stage0_continuation_allowed = bool(stage0_bulk_roll and (same_lineage or stage0_stock_continue))
            if stage0_bulk_roll and not stage0_continuation_allowed:
                continue

            stage_name = self._route_step_label(roll.template, completed_step_index) if getattr(roll, "template", None) else None
            naming = build_roll_naming_payload(roll, role=resolve_roll_role(roll), stage_name=stage_name or "Raw Material")
            matches_sig = False
            signature_match_mode = None
            stock_strategy = "FINAL_STOCK" if is_final_step else "INTERMEDIATE_POOL"

            if is_final_step:
                if order_signature and inv_sig == order_signature:
                    matches_sig = True
                    signature_match_mode = "FINAL_SPEC"
            elif required_start_step == 0 and completed_step_index == 0:
                # Stage-0 raw/purchasable rolls can feed a route only when they
                # are not also the route's final stock AND the first executable
                # step consumes rolls. Bulk-input step 0 (extrusion) must start
                # from material planning unless this is already-produced WIP
                # that can resume at the next roll-input step.
                if stage0_roll_input_allowed and required_layer_material_ids and str(getattr(roll, "material_id", "") or "") not in required_layer_material_ids:
                    continue
                matches_sig = True
                signature_match_mode = "SEMI_INVARIANT" if stage0_continuation_allowed else "STEP0_RAW"
                if stage0_stock_continue and not same_lineage:
                    signature_match_mode = "PRE_ARTWORK_INVARIANT"
                stock_strategy = "INTERMEDIATE_POOL"
            else:
                if order_invariant_signature and inv_inv_sig == order_invariant_signature:
                    matches_sig = True
                    signature_match_mode = "SEMI_INVARIANT"
                elif (
                    order_layer_only_signature
                    and source_stock_order
                    and self._is_pre_artwork_shared_stock(source_stock_order, template)
                    and self._layer_only_invariant_signature(source_stock_order.layer_snapshot or []) == order_layer_only_signature
                ):
                    matches_sig = True
                    signature_match_mode = "PRE_ARTWORK_INVARIANT"
            
            if not matches_sig:
                continue
            if order_kind == "sales":
                if source_stock_order and not self._stock_commitment_matches_sales_item(source_stock_order, sales_item or order_obj):
                    continue
            width_ok, width_payload = self._width_match_payload(
                _numeric(getattr(roll, "width_mm", None)),
                required_width_mm,
            )
            if not width_ok:
                continue
            physical = Decimal(str(roll.weight_kg or 0))
            allocated = roll_alloc_map.get(str(roll.id), Decimal("0"))
            allocatable = physical - allocated
            if allocatable <= 0:
                continue
            source_bucket = "COMPATIBLE_UPSTREAM_ROLL_STOCK"
            source_label = "Compatible upstream roll stock"
            if is_final_step:
                source_bucket = "FINISHED_STOCK"
                source_label = "Finished stock"
            elif same_lineage:
                source_bucket = "CARRY_FORWARD_WIP"
                source_label = "Carry-forward WIP"
            elif stage0_stock_continue:
                source_bucket = "SHARED_INVARIANT_ROLL_STOCK"
                source_label = "Extruded base roll stock · continue from next step"
            elif source_planner_class == "SHARED_INVARIANT_ROLL" and completed_step_index in {shared_invariant_min_step, required_start_step}:
                source_bucket = "SHARED_INVARIANT_ROLL_STOCK"
                source_label = "Shared invariant roll stock"
                if required_start_step > 0 and completed_step_index == shared_invariant_min_step:
                    source_label = "Shared invariant roll stock · continue from next step"
            elif source_planner_class == "EXTRUDED_BASE_ROLL" or str(signature_match_mode or "").upper() == "STEP0_RAW":
                source_bucket = "COMPATIBLE_UPSTREAM_ROLL_STOCK"
                source_label = "Compatible upstream roll stock"
            options.append(
                {
                    "inventory_type": "ROLL",
                    "inventory_id": str(roll.id),
                    "label": roll.label_id,
                    "display_name": naming["variant_display_name"],
                    "family_display_name": naming["family_display_name"],
                    "size_line": naming["size_line"],
                    "process_state_label": naming["process_state_label"],
                    "completed_step_index": completed_step_index,
                    "quantity_kg": float(physical),
                    "allocated_qty_kg": float(max(Decimal("0"), allocated)),
                    "allocatable_qty_kg": float(allocatable),
                    "is_final_step": is_final_step,
                    "stock_strategy": stock_strategy,
                    "planner_stock_class": source_planner_class,
                    "signature_match_mode": signature_match_mode or ("FINAL_SPEC" if is_final_step else "SEMI_INVARIANT"),
                    "source_bucket": source_bucket,
                    "source_label": source_label,
                    "same_order_lineage": bool(same_lineage),
                    "location_id": str(roll.location_id) if getattr(roll, "location_id", None) else None,
                    "location_code": getattr(getattr(roll, "location", None), "code", "") or "",
                    "location_name": getattr(getattr(roll, "location", None), "name", "") or "",
                    "plant_id": str(getattr(getattr(roll, "location", None), "plant_id", "") or "") if getattr(roll, "location", None) else "",
                    "plant_code": getattr(getattr(getattr(roll, "location", None), "plant", None), "code", "") or "",
                    "plant_name": getattr(getattr(getattr(roll, "location", None), "plant", None), "name", "") or "",
                    **width_payload,
                }
            )
            if len(options) >= max_roll_candidates:
                break

        fg_batches = (
            FinishedGoodsBatch.objects.filter(
                status="AVAILABLE",
                template=template,
                completed_step_index=route_last_index,
            )
            .select_related("template", "sales_order_item", "location", "location__plant")
            .order_by("-created_at", "completed_step_index")
        )

        for batch in fg_batches:
            batch_route_id = getattr(getattr(batch, "template", None), "routing_rule_id", None)
            if order_routing_rule_id and batch_route_id != order_routing_rule_id:
                continue
            if not order_signature or self._fg_signature(batch) != order_signature:
                continue
            if order_kind == "sales":
                source_stock_order = self._origin_stock_order_for_batch(batch)
                if source_stock_order and not self._stock_commitment_matches_sales_item(source_stock_order, sales_item or order_obj):
                    continue
            physical = Decimal(str(batch.qty_kg or 0))
            allocated = fg_alloc_map.get(str(batch.id), Decimal("0"))
            allocatable = physical - allocated
            if allocatable <= 0:
                continue
            options.append(
                {
                    "inventory_type": "FG_BATCH",
                    "inventory_id": str(batch.id),
                    "label": batch.batch_number,
                    "display_name": str(getattr(getattr(batch, "template", None), "commercial_family", None) and batch.template.commercial_family.name or getattr(getattr(batch, "template", None), "name", "") or batch.batch_number),
                    "family_display_name": str(getattr(getattr(batch, "template", None), "commercial_family", None) and batch.template.commercial_family.name or getattr(getattr(batch, "template", None), "name", "") or "Finished Goods"),
                    "size_line": "",
                    "process_state_label": "Finished good · Final stock",
                    "completed_step_index": int(batch.completed_step_index or 0),
                    "quantity_kg": float(physical),
                    "allocated_qty_kg": float(max(Decimal("0"), allocated)),
                    "allocatable_qty_kg": float(allocatable),
                    "is_final_step": int(batch.completed_step_index or 0) == route_last_index,
                    "stock_strategy": "FINAL_STOCK",
                    "planner_stock_class": self._planner_stock_class_for_batch(batch),
                    "signature_match_mode": "FINAL_SPEC",
                    "source_bucket": "FINISHED_STOCK",
                    "source_label": "Finished stock",
                    "location_id": str(batch.location_id) if getattr(batch, "location_id", None) else None,
                    "location_code": getattr(getattr(batch, "location", None), "code", "") or "",
                    "location_name": getattr(getattr(batch, "location", None), "name", "") or "",
                    "plant_id": str(getattr(getattr(batch, "location", None), "plant_id", "") or "") if getattr(batch, "location", None) else "",
                    "plant_code": getattr(getattr(getattr(batch, "location", None), "plant", None), "code", "") or "",
                    "plant_name": getattr(getattr(getattr(batch, "location", None), "plant", None), "name", "") or "",
                }
            )
            if len(options) >= (max_roll_candidates + max_fg_candidates):
                break
        options.sort(
            key=lambda row: (
                0 if row["inventory_type"] == "FG_BATCH" and row["is_final_step"] else 1,
                row["completed_step_index"],
                row["label"],
            )
        )
        return options

    def _current_product_master_for_sales_item(self, so_item):
        product_master = getattr(so_item, "product_master", None)
        if not product_master:
            return None
        if bool(getattr(product_master, "is_current_version", False)):
            return product_master
        try:
            from apps.materials.services_product_master_rebase import sales_order_item_product_master_lock_reason

            if sales_order_item_product_master_lock_reason(so_item):
                return product_master
        except Exception:
            return product_master
        version_group = str(getattr(product_master, "version_group", "") or "").strip()
        if not version_group:
            try:
                version_group = ProductMaster.version_root_from_code(product_master.code)
            except Exception:
                version_group = str(getattr(product_master, "code", "") or "").strip()
        current = (
            ProductMaster.objects.filter(
                version_group=version_group,
                is_current_version=True,
                active=True,
            )
            .order_by("-version", "-updated_at")
            .first()
        )
        return current or product_master

    def _maybe_sync_sales_item_product_master(self, so_item):
        if not so_item:
            return so_item
        current_master = self._current_product_master_for_sales_item(so_item)
        if not current_master or str(getattr(current_master, "id", "") or "") == str(getattr(so_item, "product_master_id", "") or ""):
            return so_item
        try:
            from apps.materials.services_product_master_rebase import (
                _rebase_item_to_master,
                sales_order_item_product_master_lock_reason,
            )

            if sales_order_item_product_master_lock_reason(so_item):
                return so_item
            with transaction.atomic():
                locked = (
                    SalesOrderItem.objects.select_for_update()
                    .get(id=so_item.id)
                )
                if sales_order_item_product_master_lock_reason(locked):
                    return so_item
                latest = self._current_product_master_for_sales_item(locked)
                if latest and str(latest.id) != str(locked.product_master_id):
                    _rebase_item_to_master(locked, latest)
                    return (
                        SalesOrderItem.objects.select_related("sales_order", "template", "template__routing_rule", "product_master")
                        .get(id=locked.id)
                    )
        except Exception:
            return so_item
        return so_item

    def _sales_item_print_profile(self, so_item, *, prefer_current_product_master: bool = True):
        printing = so_item.printing_snapshot if isinstance(getattr(so_item, "printing_snapshot", None), dict) else {}
        axis_values = getattr(so_item, "axis_values", None)
        axis_values = axis_values if isinstance(axis_values, dict) else {}
        product_master = (
            self._current_product_master_for_sales_item(so_item)
            if prefer_current_product_master
            else getattr(so_item, "product_master", None)
        )
        fixed = getattr(product_master, "fixed_attributes", {}) if product_master else {}
        fixed = fixed if isinstance(fixed, dict) else {}
        context = {}
        if product_master:
            try:
                context = product_master_print_context(product_master, axis_values=axis_values)
            except Exception:
                context = {}
        # The current Product Master is the source of truth for method/form, but an
        # already print-required order line must not lose its planner gate because
        # older master data has print_capable unset/false.
        enabled = bool(
            fixed.get("print_capable")
            or printing.get("enabled")
            or getattr(so_item, "artwork_assignment_required", False)
            or getattr(so_item, "assigned_artwork_id", None)
        )
        return {
            "enabled": enabled,
            "print_type": str(
                context.get("print_type")
                or printing.get("print_type")
                or printing.get("type")
                or printing.get("method")
                or ""
            ).upper(),
            "substrate_mode": str(
                context.get("substrate_mode")
                or printing.get("substrate_mode")
                or printing.get("film_type")
                or ""
            ).upper(),
            "front_colors_count": int(printing.get("front_colors_count") or 0),
            "back_colors_count": int(printing.get("back_colors_count") or 0),
            "ink_base_family": str(printing.get("ink_base_family") or "").upper(),
            "product_master_id": str(getattr(product_master, "id", "") or ""),
            "product_master_code": str(getattr(product_master, "code", "") or ""),
            "product_master_version": int(getattr(product_master, "version", 0) or 0),
            "axis_values": axis_values,
        }

    def _light_pending_artwork_items(self, so_item, *, prefer_current_product_master: bool = True):
        if not so_item:
            return []
        profile = self._sales_item_print_profile(
            so_item,
            prefer_current_product_master=prefer_current_product_master,
        )
        if not bool(profile.get("enabled")):
            return []
        if str(getattr(so_item, "assigned_artwork_id", "") or "").strip():
            return []
        line_label = _sales_item_display_label(so_item) or str(getattr(so_item, "line_name", "") or "Pending artwork line").strip()
        return [
            {
                "id": str(so_item.id),
                "label": line_label,
                "line_name": str(getattr(so_item, "line_name", "") or "").strip(),
                "print_type": profile["print_type"],
                "substrate_mode": profile["substrate_mode"],
                "front_colors_count": profile["front_colors_count"],
                "back_colors_count": profile["back_colors_count"],
                "ink_base_family": profile["ink_base_family"],
                "product_master_id": profile["product_master_id"],
                "product_master_code": profile["product_master_code"],
                "product_master_version": profile["product_master_version"],
                "axis_values": profile["axis_values"],
                "artwork_id": None,
            }
        ]

    def _control_hub_lightweight(
        self,
        planning_limit: int,
        active_limit: int,
        history_limit: int,
        history_days: int | None = None,
        history_query: str = "",
        history_source: str = "",
        history_order_kind: str = "",
        history_offset: int = 0,
        history_job_limit: int = 8,
        summary: bool = False,
        detail_order_kind: str = "",
        detail_order_id: str = "",
        detail_sales_order_item_id: str = "",
        queue_filters: dict | None = None,
        active_filters: dict | None = None,
        scan_limit_override: int | None = None,
        v2: bool = False,
    ):
        planning_queue = []
        active_orders = []
        order_history = []
        detail_order_kind = str(detail_order_kind or "").strip().lower()
        detail_order_id = str(detail_order_id or "").strip()
        detail_sales_order_item_id = str(detail_sales_order_item_id or "").strip()
        detail_requested = bool(detail_order_id or detail_sales_order_item_id)
        history_offset = max(0, int(history_offset or 0))
        history_job_limit = max(1, min(int(history_job_limit or 8), 12))
        history_collect_limit = history_limit + history_offset + (1 if history_limit > 0 else 0)
        queue_filters = queue_filters if isinstance(queue_filters, dict) else {}
        has_queue_filters = any(str(value or "").strip() and str(value or "").strip().lower() not in {"all", "false", "0"} for value in queue_filters.values())
        active_filters = active_filters if isinstance(active_filters, dict) else {}
        has_active_filters = any(str(value or "").strip() and str(value or "").strip().lower() not in {"all", "false", "0"} for value in active_filters.values())
        scan_limit = int(scan_limit_override or max(48, planning_limit * 4 + active_limit * 3 + history_collect_limit * 2))
        if has_queue_filters or has_active_filters:
            scan_limit = max(scan_limit, 360)
        scan_limit = max(1, min(scan_limit, 600))
        roll_alloc_map, fg_alloc_map = self._inventory_active_allocation_maps()

        def is_detail_target(row: dict):
            if detail_sales_order_item_id and str(row.get("order_kind") or "").lower() == "sales":
                return str(row.get("sales_order_item_id") or "") == detail_sales_order_item_id
            return (
                detail_order_id
                and str(row.get("order_kind") or "").lower() == detail_order_kind
                and str(row.get("order_id") or "") == detail_order_id
            )

        def response_row(row: dict, *, force_detail: bool = False):
            decorated = self._decorate_control_hub_row(row)
            return decorated if force_detail or not summary else self._summary_control_hub_row(decorated)

        def should_stop_scanning() -> bool:
            if not (
                len(planning_queue) >= planning_limit
                and len(active_orders) >= active_limit
                and len(order_history) >= history_collect_limit
            ):
                return False
            return not detail_requested or detail_order is not None

        detail_order = None
        cheap_source_cache = {}
        required_start_cache = {}
        self._control_hub_template_steps_cache = {}

        def cached_cheap_source_availability(*, template, required_start_step: int, route_last_index: int, order_signature: str = "", order_invariant_signature: str = ""):
            cache_key = (
                str(getattr(template, "id", "") or ""),
                int(required_start_step or 0),
                int(route_last_index or 0),
                str(order_signature or ""),
                str(order_invariant_signature or ""),
            )
            if cache_key not in cheap_source_cache:
                cheap_source_cache[cache_key] = self._cheap_source_availability(
                    template=template,
                    required_start_step=required_start_step,
                    route_last_index=route_last_index,
                    order_signature=order_signature,
                    order_invariant_signature=order_invariant_signature,
                )
            return dict(cheap_source_cache[cache_key])

        def cached_sales_required_start_step(template, layer_snapshot):
            material_ids = tuple(
                str((layer or {}).get("material_id") or (layer or {}).get("variant_id") or "").strip()
                for layer in (layer_snapshot if isinstance(layer_snapshot, list) else [])
                if isinstance(layer, dict) and str((layer or {}).get("material_id") or (layer or {}).get("variant_id") or "").strip()
            )
            cache_key = (str(getattr(template, "id", "") or ""), material_ids)
            if cache_key not in required_start_cache:
                required_start_cache[cache_key] = self._sales_required_start_step(template, layer_snapshot)
            return int(required_start_cache.get(cache_key) or 0)

        item_prefetch = Prefetch(
            "items",
            queryset=SalesOrderItem.objects.select_related(
                "template__routing_rule",
                "product_master",
                "product_variant",
                "sku_variant",
                "customer_product_overlay",
            ).only(
                "id",
                "sales_order_id",
                "template_id",
                "product_master_id",
                "product_variant_id",
                "sku_variant_id",
                "customer_product_overlay_id",
                "product_master__id",
                "product_master__code",
                "product_master__name",
                "product_master__version_group",
                "product_master__version",
                "product_master__is_current_version",
                "product_master__active",
                "product_master__fixed_attributes",
                "product_variant__id",
                "product_variant__code",
                "sku_variant__id",
                "sku_variant__code",
                "sku_variant__name",
                "customer_product_overlay__id",
                "customer_product_overlay__customer_display_name",
                "customer_product_overlay__customer_item_code",
                "line_name",
                "line_status",
                "axis_values",
                "artwork_assignment_required",
                "qty_cancelled",
                "qty_short_closed",
                "line_closed_reason",
                "line_closed_at",
                "qty_uom",
                "qty_value",
                "total_weight_kg",
                "unit_weight_g",
                "geometry_snapshot",
                "layer_snapshot",
                "printing_snapshot",
                "addons_snapshot",
                "packaging_snapshot",
                "bom_snapshot",
                "spec_signature",
                "invariant_signature",
                "assigned_artwork_id",
            ),
        )

        queue_search = str(queue_filters.get("search") or "").strip()
        sales_qs = (
            SalesOrder.objects.exclude(status__in=["DRAFT", "CANCELLED"])
            .only("id", "order_number", "customer_name", "delivery_date", "status", "geometry_override", "created_at")
            .prefetch_related(item_prefetch)
            .order_by("-created_at")
        )
        if queue_search:
            sales_qs = sales_qs.filter(
                Q(order_number__icontains=queue_search)
                | Q(customer_name__icontains=queue_search)
                | Q(items__line_name__icontains=queue_search)
            ).distinct()
        all_sales = list(sales_qs[:scan_limit])
        if detail_order_kind == "sales" and detail_order_id:
            try:
                detail_sales = (
                    SalesOrder.objects.exclude(status__in=["DRAFT", "CANCELLED"])
                    .only("id", "order_number", "customer_name", "delivery_date", "status", "geometry_override", "created_at")
                    .prefetch_related(item_prefetch)
                    .get(id=detail_order_id)
                )
                if not any(str(order.id) == str(detail_sales.id) for order in all_sales):
                    all_sales.insert(0, detail_sales)
            except Exception:
                pass
        stock_qs = (
            PlannedStockOrder.objects.exclude(status__in=["CANCELLED"])
            .select_related("template", "template__routing_rule")
            .order_by("-created_at")
        )
        if queue_search:
            stock_qs = stock_qs.filter(
                Q(order_number__icontains=queue_search)
                | Q(internal_name__icontains=queue_search)
            )
        all_mts = list(stock_qs[:scan_limit])
        if detail_order_kind == "stock" and detail_order_id:
            try:
                detail_stock = (
                    PlannedStockOrder.objects.exclude(status__in=["CANCELLED"])
                    .select_related("template", "template__routing_rule")
                    .get(id=detail_order_id)
                )
                if not any(str(order.id) == str(detail_stock.id) for order in all_mts):
                    all_mts.insert(0, detail_stock)
            except Exception:
                pass

        sales_order_ids = [str(order.id) for order in all_sales if getattr(order, "id", None)]
        sales_item_ids = [
            str(item.id)
            for order in all_sales
            for item in order.items.all()
            if getattr(item, "id", None)
        ]
        stock_order_ids = [str(order.id) for order in all_mts if getattr(order, "id", None)]
        sales_job_map, stock_job_map = self._job_summary_maps(
            sales_order_ids=sales_order_ids,
            stock_order_ids=stock_order_ids,
        )
        sales_item_job_map = self._sales_item_job_summary_map(sales_item_ids)
        sales_job_query_matches, stock_job_query_matches = self._history_job_number_match_maps(
            history_query=history_query,
            sales_order_ids=sales_order_ids,
            stock_order_ids=stock_order_ids,
        )
        sales_item_job_query_matches = self._sales_item_history_job_number_matches(
            history_query=history_query,
            sales_item_ids=sales_item_ids,
        )

        limits_reached = False
        for order in all_sales:
            sales_items = list(order.items.all())
            for line_index, raw_item in enumerate(sales_items, start=1):
                raw_item_is_detail = (
                    (detail_sales_order_item_id and str(getattr(raw_item, "id", "") or "") == detail_sales_order_item_id)
                    or (
                        detail_order_kind == "sales"
                        and detail_order_id
                        and str(getattr(order, "id", "") or "") == detail_order_id
                    )
                )
                prefer_current_master = (not summary) or raw_item_is_detail
                so_item = self._maybe_sync_sales_item_product_master(raw_item) if prefer_current_master else raw_item
                template = getattr(so_item, "template", None)
                if not template:
                    continue
                route_last = self._route_last_index(template)
                geometry_snapshot = so_item.geometry_snapshot if isinstance(so_item.geometry_snapshot, dict) else {}
                layer_snapshot = so_item.layer_snapshot if isinstance(so_item.layer_snapshot, list) else []
                printing_snapshot = so_item.printing_snapshot if isinstance(so_item.printing_snapshot, dict) else {}
                product_master = getattr(so_item, "product_master", None)
                axis_values = getattr(so_item, "axis_values", None)
                axis_values = axis_values if isinstance(axis_values, dict) else {}
                if summary and not raw_item_is_detail:
                    fixed = getattr(product_master, "fixed_attributes", {}) if product_master else {}
                    fixed = fixed if isinstance(fixed, dict) else {}
                    print_profile = {
                        "enabled": bool(
                            fixed.get("print_capable")
                            or printing_snapshot.get("enabled")
                            or getattr(so_item, "artwork_assignment_required", False)
                            or getattr(so_item, "assigned_artwork_id", None)
                        ),
                        "print_type": str(
                            printing_snapshot.get("print_type")
                            or printing_snapshot.get("type")
                            or printing_snapshot.get("method")
                            or ""
                        ).upper(),
                        "substrate_mode": str(printing_snapshot.get("substrate_mode") or printing_snapshot.get("film_type") or "").upper(),
                        "front_colors_count": int(printing_snapshot.get("front_colors_count") or 0),
                        "back_colors_count": int(printing_snapshot.get("back_colors_count") or 0),
                        "ink_base_family": str(printing_snapshot.get("ink_base_family") or "").upper(),
                        "product_master_id": str(getattr(product_master, "id", "") or ""),
                        "product_master_code": str(getattr(product_master, "code", "") or ""),
                        "product_master_version": int(getattr(product_master, "version", 0) or 0),
                        "axis_values": axis_values,
                    }
                else:
                    print_profile = self._sales_item_print_profile(
                        so_item,
                        prefer_current_product_master=prefer_current_master,
                    )
                addons_snapshot = so_item.addons_snapshot if isinstance(so_item.addons_snapshot, list) else []
                packaging_snapshot = _normalize_packaging_snapshot(getattr(so_item, "packaging_snapshot", {}) or {})
                effective_dims = self._compute_effective_dims(order.geometry_override, geometry_snapshot)
                qty_uom = str(getattr(so_item, "qty_uom", "KG") or "KG").upper()
                unit_weight = Decimal(str(getattr(so_item, "unit_weight_g", 0) or 0))
                line_total_kg = Decimal(str(getattr(so_item, "total_weight_kg", 0) or 0))
                job_summary = sales_item_job_map.get(str(so_item.id), sales_job_map.get(str(order.id), {}))
                job_count = int(job_summary.get("job_count") or 0)
                line_status = str(getattr(so_item, "line_status", "") or "").upper()
                if not line_status:
                    line_status = "PLANNING_REQUIRED" if order.status == "PLANNING_REQUIRED" else "OPEN"
                needs_rich_line_metrics = bool((not summary) or raw_item_is_detail or line_status == "PARTIAL")
                if needs_rich_line_metrics:
                    partial_metrics = self._sales_item_partial_metrics(so_item, route_last)
                else:
                    partial_metrics = {
                        "target_kg": line_total_kg,
                        "produced_kg": Decimal("0"),
                        "shortfall_kg": Decimal("0"),
                        "shortfall_pct": Decimal("0"),
                        "requires_replan": False,
                        "has_started_final_output": False,
                    }
                partial_replan_required = bool(partial_metrics.get("requires_replan"))
                production_complete = (
                    job_count > 0
                    and int(job_summary.get("jobs_completed") or 0) >= job_count
                    and not partial_replan_required
                )
                closed_line = line_status in {"CANCELLED", "SHORT_CLOSED", "COMPLETED"} or production_complete
                needs_planning_queue = (
                    not closed_line
                    and (
                        line_status in {"OPEN", "PLANNING_REQUIRED"}
                        or (order.status == "CONFIRMED" and job_count == 0)
                    )
                )
                active_line = (
                    not closed_line
                    and (
                        line_status in {"PLANNED", "RELEASED", "IN_PRODUCTION", "PARTIAL"}
                        or (order.status in ("PLANNED", "RELEASED") and job_count > 0)
                        or partial_replan_required
                    )
                )
                required_qty_kg = Decimal(str(partial_metrics.get("shortfall_kg") or 0)) if partial_replan_required else line_total_kg
                required_qty_pcs = float(getattr(so_item, "qty_value", 0) or 0) if qty_uom == "PCS" and not partial_replan_required else None
                if required_qty_pcs is None and str(template.fg_type or "").upper() != "ROLL" and unit_weight > 0 and not partial_replan_required:
                    required_qty_pcs = float((line_total_kg * Decimal("1000")) / unit_weight)
                bom_snapshot = getattr(so_item, "bom_snapshot", {}) or {}
                material_plan_lines, material_plan_summary = self._material_plan_payload(bom_snapshot)
                if needs_rich_line_metrics:
                    qty_final_output = SalesOrderService.line_final_output_qty(so_item) if line_status == "PARTIAL" else Decimal("0")
                    qty_dispatchable = SalesOrderService.line_dispatchable_qty(so_item)
                    qty_replan_remaining = SalesOrderService.line_replan_remaining_qty(so_item)
                    qty_replan_remaining_kg = SalesOrderService.line_replan_remaining_kg(so_item)
                    qty_dispatched = Decimal(str(getattr(so_item, "qty_dispatched", 0) or 0))
                    qty_open = Decimal(str(getattr(so_item, "qty_open", 0) or 0))
                else:
                    qty_final_output = Decimal("0")
                    qty_dispatchable = Decimal("0")
                    qty_replan_remaining = Decimal("0")
                    qty_replan_remaining_kg = Decimal("0")
                    qty_dispatched = Decimal("0")
                    qty_open = max(
                        Decimal(str(getattr(so_item, "qty_value", 0) or 0))
                        - Decimal(str(getattr(so_item, "qty_cancelled", 0) or 0))
                        - Decimal(str(getattr(so_item, "qty_short_closed", 0) or 0)),
                        Decimal("0"),
                    )
                pending_artwork_items = (
                    self._light_pending_artwork_items(
                        so_item,
                        prefer_current_product_master=prefer_current_master,
                    )
                    if ((planning_limit > 0 and needs_planning_queue) or raw_item_is_detail or not summary)
                    else []
                )
                product_master_code = str(getattr(product_master, "code", "") or "").strip()
                product_master_name = str(getattr(product_master, "name", "") or "").strip()
                product_master_label = (
                    f"{product_master_code} · {product_master_name}"
                    if product_master_code and product_master_name and product_master_code.lower() not in product_master_name.lower()
                    else (product_master_code or product_master_name)
                )
                base_label = _sales_item_display_label(
                    so_item,
                    order=order,
                    product_master=product_master,
                    template=template,
                ) or product_master_label
                line_label = base_label or f"Line {line_index}"
                spec_signature = str(getattr(so_item, "spec_signature", "") or "")
                invariant_signature = str(getattr(so_item, "invariant_signature", "") or "")
                order_signature = self._order_signature(
                    spec_signature=spec_signature,
                    geometry_snapshot=geometry_snapshot,
                    geometry_override=order.geometry_override or {},
                    layer_snapshot=layer_snapshot,
                    printing_snapshot=printing_snapshot,
                    addons_snapshot=addons_snapshot,
                    template=template,
                )
                order_invariant_signature = self._order_invariant_signature(
                    invariant_signature=invariant_signature,
                    layer_snapshot=layer_snapshot,
                    printing_snapshot=printing_snapshot,
                )
                required_start_step = cached_sales_required_start_step(template, layer_snapshot)
                bom_readiness = self._effective_bom_readiness_payload(
                    bom_snapshot,
                    template=template,
                    layer_snapshot=layer_snapshot,
                    required_start_step=required_start_step,
                )
                row = {
                    "order_kind": "sales",
                    "order_id": str(order.id),
                    "sales_order_item_id": str(so_item.id),
                    "sales_order_line_index": line_index,
                    "line_label": line_label,
                    "line_status": line_status,
                    "line_status_display": str(so_item.get_line_status_display()) if hasattr(so_item, "get_line_status_display") else line_status.replace("_", " ").title(),
                    "line_status_reason": str(getattr(so_item, "line_closed_reason", "") or ""),
                    "qty_open": float(qty_open),
                    "qty_final_output": float(qty_final_output),
                    "qty_dispatchable": float(qty_dispatchable),
                    "qty_replan_remaining": float(qty_replan_remaining),
                    "qty_replan_remaining_kg": float(qty_replan_remaining_kg),
                    "qty_cancelled": float(Decimal(str(getattr(so_item, "qty_cancelled", 0) or 0))),
                    "qty_short_closed": float(Decimal(str(getattr(so_item, "qty_short_closed", 0) or 0))),
                    "qty_dispatched": float(qty_dispatched),
                    "parent_status": order.status,
                    "order_number": order.order_number,
                    "customer_name": str(order.customer_name or "").strip(),
                    "display_name": line_label,
                    "delivery_date": order.delivery_date.isoformat() if getattr(order, "delivery_date", None) else None,
                    "status": order.status,
                    "template_id": str(template.id),
                    "template_name": template.name,
                    "product_master_id": str(getattr(product_master, "id", "") or "") or None,
                    "product_master_code": product_master_code,
                    "product_master_name": product_master_name,
                    "product_master_label": product_master_label,
                    "fg_type": template.fg_type,
                    "final_product_type": str(template.fg_type or "").upper(),
                    "planned_output_type": str(template.fg_type or "").upper(),
                    "required_qty_kg": float(required_qty_kg),
                    "required_qty_pcs": required_qty_pcs,
                    "unit_weight_g": float(unit_weight),
                    "qty_uom": qty_uom,
                    "math_valid": True,
                    "math_error": "",
                    "required_start_step": required_start_step,
                    "route_last_step_index": route_last,
                    "required_roll_width_mm": float(self._sales_item_roll_width_mm(so_item)),
                    "geometry_override": order.geometry_override or {},
                    "geometry_snapshot": _jsonify(geometry_snapshot),
                    "spec_signature": spec_signature,
                    "effective_dims": effective_dims,
                    "layer_snapshot": _jsonify(layer_snapshot),
                    "layer_summary": self._layer_stack_summary(
                        layer_snapshot,
                        resolve_materials=((not summary) or raw_item_is_detail),
                    ),
                    "printing_snapshot": _jsonify(printing_snapshot),
                    "addons_snapshot": _jsonify(addons_snapshot),
                    "packaging_snapshot": _jsonify(packaging_snapshot),
                    "material_plan_lines": material_plan_lines,
                    "material_plan_summary": material_plan_summary,
                    **bom_readiness,
                    "inventory_options": [],
                    "matching_stock_orders": [],
                    "artwork_assignment_required": bool(pending_artwork_items),
                    "assigned_artwork_id": str(getattr(so_item, "assigned_artwork_id", "") or ""),
                    "pending_artwork_items": pending_artwork_items,
                    "printing_enabled": bool(print_profile.get("enabled")),
                    "print_type": str(print_profile.get("print_type") or "").upper(),
                    "substrate_mode": str(print_profile.get("substrate_mode") or "").upper(),
                    "ink_base_family": str(print_profile.get("ink_base_family") or "").upper(),
                    "front_colors_count": int(print_profile.get("front_colors_count") or 0),
                    "back_colors_count": int(print_profile.get("back_colors_count") or 0),
                    "partial_replan_required": partial_replan_required,
                    "partial_shortfall_kg": float(partial_metrics.get("shortfall_kg") or 0),
                    "partial_shortfall_pct": float(partial_metrics.get("shortfall_pct") or 0),
                    "partial_produced_kg": float(partial_metrics.get("produced_kg") or 0),
                    "partial_target_kg": float(partial_metrics.get("target_kg") or 0),
                    "created_at": order.created_at.isoformat() if order.created_at else None,
                    "job_count": job_count,
                    "jobs_released": int(job_summary.get("jobs_released") or 0),
                    "jobs_completed": int(job_summary.get("jobs_completed") or 0),
                    "completed_at": job_summary.get("completed_at"),
                    "job_numbers": [],
                    "completed_jobs": [],
                    "_job_number_match": str(so_item.id) in sales_item_job_query_matches or str(order.id) in sales_job_query_matches,
                }

                force_detail = is_detail_target(row)
                if needs_planning_queue:
                    if planning_limit > 0 or force_detail:
                        if summary and not force_detail:
                            row["source_availability"] = cached_cheap_source_availability(
                                template=template,
                                required_start_step=required_start_step,
                                route_last_index=route_last,
                                order_signature=order_signature,
                                order_invariant_signature=order_invariant_signature,
                            )
                            row["continuation"] = self._cheap_continuation_summary(row["source_availability"])
                        else:
                            row["inventory_options"] = self._eligible_inventory_for_order(
                                order_kind="sales",
                                order_obj=order,
                                template=template,
                                order_signature=order_signature,
                                order_invariant_signature=order_invariant_signature,
                                required_start_step=required_start_step,
                                route_last_index=route_last,
                                roll_alloc_map=roll_alloc_map,
                                fg_alloc_map=fg_alloc_map,
                                order_layer_snapshot=layer_snapshot,
                                sales_item=so_item,
                            )
                            row["matching_stock_orders"] = self._matching_stock_orders_for_sales(
                                template=template,
                                order_signature=order_signature,
                                order_invariant_signature=order_invariant_signature,
                                required_start_step=required_start_step,
                                sales_item=so_item,
                            )
                            row["source_availability"] = self._source_availability(row)
                            row["continuation"] = self._row_continuation(row)
                        decorated = response_row(row, force_detail=force_detail)
                        if force_detail:
                            detail_order = decorated
                        if self._control_hub_row_matches_queue_filters(row, queue_filters):
                            planning_queue.append(decorated)
                elif active_line:
                    if active_limit > 0 or force_detail:
                        decorated = response_row(row, force_detail=force_detail)
                        if force_detail:
                            detail_order = decorated
                        if self._control_hub_row_matches_active_filters(row, active_filters):
                            active_orders.append(decorated)
                else:
                    if history_limit > 0 or force_detail:
                        decorated = response_row(row, force_detail=force_detail)
                        if force_detail:
                            detail_order = decorated
                        order_history.append(decorated)
                if should_stop_scanning():
                    limits_reached = True
                    break
            if limits_reached:
                break

        for order in all_mts:
            template = getattr(order, "template", None)
            if not template:
                continue
            stock_order_is_detail = (
                detail_order_kind == "stock"
                and detail_order_id
                and str(getattr(order, "id", "") or "") == detail_order_id
            )
            route_last = self._route_last_index(template)
            geometry_snapshot = order.geometry_snapshot if isinstance(order.geometry_snapshot, dict) else {}
            layer_snapshot = order.layer_snapshot if isinstance(order.layer_snapshot, list) else []
            printing_snapshot = order.printing_snapshot if isinstance(order.printing_snapshot, dict) else {}
            addons_snapshot = order.addons_snapshot if isinstance(order.addons_snapshot, list) else []
            packaging_snapshot = _normalize_packaging_snapshot(getattr(order, "packaging_snapshot", {}) or {})
            effective_dims = self._compute_effective_dims(order.geometry_override, geometry_snapshot)
            quantity_uom = str(getattr(order, "quantity_uom", "KG") or "KG").upper()
            stock_purpose = str(getattr(order, "stock_purpose", "PRODUCT") or "PRODUCT").upper()
            bom_snapshot = getattr(order, "bom_snapshot", {}) or {}
            material_plan_lines, material_plan_summary = self._material_plan_payload(bom_snapshot)
            bom_readiness = self._bom_readiness_payload(bom_snapshot)
            job_summary = stock_job_map.get(str(order.id), {})
            job_count = int(job_summary.get("job_count") or 0)
            row = {
                "order_kind": "stock",
                "order_id": str(order.id),
                "order_number": order.order_number,
                "customer_name": "",
                "display_name": str(getattr(order, "internal_name", "") or template.name or "").strip(),
                "delivery_date": None,
                "status": order.status,
                "template_id": str(template.id),
                "template_name": template.name,
                "fg_type": template.fg_type,
                "final_product_type": None if stock_purpose == "PACKAGING" else str(template.fg_type or "").upper(),
                "planned_output_type": "PACKAGING_STOCK" if stock_purpose == "PACKAGING" else str(getattr(order, "output_type", "") or ""),
                "stock_strategy": self._normalize_stock_strategy(
                    stock_strategy=getattr(order, "stock_strategy", ""),
                    template=template,
                    stock_purpose=stock_purpose,
                    stop_step_index=getattr(order, "stop_step_index", None),
                ),
                "planner_stock_class": self._planner_stock_class_for_order(order, template),
                "required_qty_kg": float(self._order_qty_kg("stock", order)),
                "required_qty_pcs": None,
                "qty_uom": quantity_uom,
                "math_valid": True,
                "math_error": "",
                    "required_start_step": int(getattr(order, "start_step_index", 0) or 0),
                    "route_last_step_index": route_last,
                    "required_roll_width_mm": float(self._stock_order_roll_width_mm(order)),
                    "geometry_override": order.geometry_override or {},
                    "geometry_snapshot": _jsonify(geometry_snapshot),
                    "effective_dims": effective_dims,
                "layer_snapshot": _jsonify(layer_snapshot),
                "layer_summary": self._layer_stack_summary(
                    layer_snapshot,
                    resolve_materials=((not summary) or stock_order_is_detail),
                ),
                "printing_snapshot": _jsonify(printing_snapshot),
                "addons_snapshot": _jsonify(addons_snapshot),
                "packaging_snapshot": _jsonify(packaging_snapshot),
                "material_plan_lines": material_plan_lines,
                "material_plan_summary": material_plan_summary,
                **bom_readiness,
                "inventory_options": [],
                "matching_stock_orders": [],
                "artwork_assignment_required": bool(getattr(order, "artwork_assignment_required", False)),
                "assigned_artwork_id": str(getattr(order, "assigned_artwork_id", "") or ""),
                "pending_artwork_items": [],
                "printing_enabled": bool(printing_snapshot.get("enabled")),
                "print_type": str(printing_snapshot.get("type") or printing_snapshot.get("method") or "").upper(),
                "front_colors_count": int(printing_snapshot.get("front_colors_count") or 0),
                "back_colors_count": int(printing_snapshot.get("back_colors_count") or 0),
                "created_at": order.created_at.isoformat() if getattr(order, "created_at", None) else None,
                "job_count": job_count,
                "jobs_released": int(job_summary.get("jobs_released") or 0),
                "jobs_completed": int(job_summary.get("jobs_completed") or 0),
                "completed_at": job_summary.get("completed_at"),
                "job_numbers": [],
                "completed_jobs": [],
                "_job_number_match": str(order.id) in stock_job_query_matches,
            }
            stock_jobs_complete = job_count > 0 and int(row["jobs_completed"] or 0) >= int(job_count)

            force_detail = is_detail_target(row)
            if order.status == "PLANNING_REQUIRED":
                if planning_limit > 0 or force_detail:
                    row["source_availability"] = cached_cheap_source_availability(
                        template=template,
                        required_start_step=int(getattr(order, "start_step_index", 0) or 0),
                        route_last_index=route_last,
                        order_signature=str(getattr(order, "spec_signature", "") or ""),
                        order_invariant_signature=str(getattr(order, "invariant_signature", "") or ""),
                    )
                    row["continuation"] = self._cheap_continuation_summary(row["source_availability"])
                    decorated = response_row(row, force_detail=force_detail)
                    if force_detail:
                        detail_order = decorated
                    if self._control_hub_row_matches_queue_filters(row, queue_filters):
                        planning_queue.append(decorated)
            elif order.status in ("PLANNED", "RELEASED") and not stock_jobs_complete:
                if active_limit > 0 or force_detail:
                    decorated = response_row(row, force_detail=force_detail)
                    if force_detail:
                        detail_order = decorated
                    if self._control_hub_row_matches_active_filters(row, active_filters):
                        active_orders.append(decorated)
            else:
                if history_limit > 0 or force_detail:
                    decorated = response_row(row, force_detail=force_detail)
                    if force_detail:
                        detail_order = decorated
                    order_history.append(decorated)
            if should_stop_scanning():
                break

        filtered_history = [
            row for row in order_history
            if self._history_row_matches(
                row,
                history_days=history_days,
                history_query=history_query,
                history_source=history_source,
                history_order_kind=history_order_kind,
            )
        ]
        if history_limit > 0:
            final_history = filtered_history[history_offset:history_offset + history_limit]
            history_has_more = len(filtered_history) > history_offset + history_limit
        else:
            final_history = []
            history_has_more = False
        self._attach_completed_job_history_payload(final_history, jobs_per_row=history_job_limit)
        for history_row in final_history:
            if not isinstance(history_row, dict):
                continue
            history_row["production_trace"] = self._row_production_trace(history_row)
            history_row["analytics"] = self._row_v2_analytics(history_row)
        if isinstance(detail_order, dict) and str(detail_order.get("order_kind") or "").lower() in {"sales", "stock"}:
            self._attach_completed_job_history_payload([detail_order], jobs_per_row=history_job_limit)
            detail_order["production_trace"] = self._row_production_trace(detail_order)
            detail_order["analytics"] = self._row_v2_analytics(detail_order)

        payload = {
            "orders": planning_queue[:planning_limit],
            "active_orders": active_orders[:active_limit],
            "order_history": final_history,
            "kpis": {
                "planning_queue_count": len(planning_queue[:planning_limit]),
                "ready_released_count": len(active_orders[:active_limit]),
                "history_count": len(final_history),
                "history_offset": history_offset,
                "history_limit": history_limit,
                "history_next_offset": history_offset + len(final_history),
                "history_has_more": history_has_more,
                "queue_blocked_count": sum(1 for row in planning_queue[:planning_limit] if bool(row.get("blockers"))),
                "queue_recoverable_rows": sum(1 for row in planning_queue[:planning_limit] if bool(row.get("row_recoverable"))),
            },
            "detail_order": detail_order,
            "summary": bool(summary),
        }
        if v2:
            payload["v2"] = True
            payload["analytics"] = self._control_hub_v2_analytics(
                planning_queue[:planning_limit],
                active_orders[:active_limit],
                final_history,
            )
        return Response(payload)

    @action(detail=False, methods=["get"], url_path="control-hub")
    def control_hub(self, request):
        request_params = getattr(request, "query_params", None) or getattr(request, "GET", {})

        def _limit_param(name: str, default: int, maximum: int, minimum: int = 0):
            raw = request_params.get(name)
            try:
                value = int(raw) if raw is not None else int(default)
            except Exception:
                value = int(default)
            return max(minimum, min(value, maximum))

        planning_limit = _limit_param("planning_limit", 18, 100)
        active_limit = _limit_param("active_limit", 12, 240)
        history_limit = _limit_param("history_limit", 48, 200)
        history_offset = _limit_param("history_offset", 0, 5000, minimum=0)
        history_job_limit = _limit_param("history_job_limit", 8, 12, minimum=1)
        scan_limit = _limit_param("scan_limit", 0, 600, minimum=0)
        history_days_raw = request_params.get("history_days")
        history_days = None
        if history_days_raw is not None and str(history_days_raw).strip():
            try:
                parsed_history_days = int(history_days_raw)
                history_days = parsed_history_days if parsed_history_days > 0 else None
            except Exception:
                history_days = None
        history_query = str(request_params.get("history_query") or "").strip()
        history_source = str(request_params.get("history_source") or "").strip().upper()
        history_order_kind = str(request_params.get("history_order_kind") or "").strip().upper()
        summary = str(request_params.get("summary") or "").strip().lower() in {"1", "true", "yes", "on"}
        v2 = str(request_params.get("v2") or "").strip().lower() in {"1", "true", "yes", "on"}
        queue_filters = {
            "search": request_params.get("queue_search") or request_params.get("search") or "",
            "customer": request_params.get("queue_customer") or "",
            "template": request_params.get("queue_template") or "",
            "fg_type": request_params.get("queue_fg_type") or "",
            "material": request_params.get("queue_material") or "",
            "source_path": request_params.get("queue_source_path") or "",
            "release": request_params.get("queue_release") or "",
            "lifecycle": request_params.get("queue_lifecycle") or "",
            "age": request_params.get("queue_age") or "",
            "print": request_params.get("queue_print") or "",
            "lifecycle": request_params.get("queue_lifecycle") or "",
            "min_width": request_params.get("queue_min_width") or "",
            "max_width": request_params.get("queue_max_width") or "",
            "overdue_only": request_params.get("queue_overdue_only") or "",
        }
        active_filters = {
            "search": request_params.get("active_search") or "",
            "state": request_params.get("active_state") or "",
            "path": request_params.get("active_path") or "",
        }
        return self._control_hub_lightweight(
            planning_limit,
            active_limit,
            history_limit,
            history_days=history_days,
            history_query=history_query,
            history_source=history_source,
            history_order_kind=history_order_kind,
            history_offset=history_offset,
            history_job_limit=history_job_limit,
            summary=summary,
            detail_order_kind=str(request_params.get("detail_order_kind") or ""),
            detail_order_id=str(request_params.get("detail_order_id") or ""),
            detail_sales_order_item_id=str(request_params.get("detail_sales_order_item_id") or ""),
            queue_filters=queue_filters,
            active_filters=active_filters,
            scan_limit_override=scan_limit or None,
            v2=v2,
        )
        scan_limit = max(48, planning_limit * 4 + active_limit * 3 + history_limit * 3)
        roll_alloc_map, fg_alloc_map = self._inventory_active_allocation_maps()
        planning_queue = []
        active_orders = []
        order_history = []

        # --- Sales Orders ---
        item_prefetch = Prefetch(
            "items",
            queryset=SalesOrderItem.objects.select_related("template__routing_rule", "product_master").only(
                "id",
                "sales_order_id",
                "template_id",
                "product_master_id",
                "product_master__id",
                "product_master__code",
                "product_master__version_group",
                "product_master__version",
                "product_master__is_current_version",
                "product_master__active",
                "product_master__fixed_attributes",
                "line_name",
                "qty_uom",
                "qty_value",
                "total_weight_kg",
                "unit_weight_g",
                "geometry_snapshot",
                "layer_snapshot",
                "printing_snapshot",
                "addons_snapshot",
                "packaging_snapshot",
                "bom_snapshot",
                "spec_signature",
                "invariant_signature",
                "assigned_artwork_id",
            ),
        )
        all_sales = (
            SalesOrder.objects.exclude(status__in=["DRAFT", "CANCELLED"])
            .only("id", "order_number", "customer_name", "delivery_date", "status", "geometry_override", "created_at")
            .prefetch_related(item_prefetch)
            .order_by("-created_at")
        )[:scan_limit]

        for order in all_sales:
            try:
                order_status = str(getattr(order, "status", "") or "").upper()
                if order_status == "PLANNING_REQUIRED" and len(planning_queue) >= planning_limit:
                    continue
                if order_status in {"PLANNED", "RELEASED"} and len(active_orders) >= active_limit:
                    continue
                if order_status not in {"PLANNING_REQUIRED", "CONFIRMED", "PLANNED", "RELEASED"} and len(order_history) >= history_limit:
                    continue
                template = self._sales_primary_template(order)
                if not template:
                    continue
                route_last = self._route_last_index(template)
                required_start_step = 0
                partial_metrics = self._sales_partial_metrics(order, route_last)
                pending_print_items = self._pending_sales_print_items(order)
                pending_artwork_items = self._pending_sales_print_items_payload(order, pending_print_items)
                so_item = pending_print_items[0] if pending_print_items else order.items.first()
                so_item = self._maybe_sync_sales_item_product_master(so_item)
                print_profile = self._sales_item_print_profile(so_item) if so_item else {}
                if so_item:
                    pending_print_items = (
                        [so_item]
                        if bool(print_profile.get("enabled"))
                        and bool(getattr(so_item, "artwork_assignment_required", False))
                        and not str(getattr(so_item, "assigned_artwork_id", "") or "").strip()
                        else []
                    )
                    pending_artwork_items = self._pending_sales_print_items_payload(order, pending_print_items)
                order_geometry_snapshot = so_item.geometry_snapshot if so_item else {}
                order_layer_snapshot = so_item.layer_snapshot if so_item else []
                spec_signature = getattr(so_item, "spec_signature", "") if so_item else ""
                inv_signature = getattr(so_item, "invariant_signature", "") if so_item else ""
                sig = self._order_signature(
                    spec_signature=spec_signature,
                    geometry_snapshot=order_geometry_snapshot,
                    geometry_override=order.geometry_override,
                    layer_snapshot=order_layer_snapshot,
                    printing_snapshot=so_item.printing_snapshot if so_item else {},
                    addons_snapshot=so_item.addons_snapshot if so_item else [],
                    template=template,
                )
                inv_sig = self._order_invariant_signature(
                    invariant_signature=inv_signature,
                    layer_snapshot=order_layer_snapshot,
                    printing_snapshot=so_item.printing_snapshot if so_item else {},
                )
                eff_dims = self._compute_effective_dims(order.geometry_override, order_geometry_snapshot or {})
                qty_uom = so_item.qty_uom if so_item else 'KG'
                unit_weight = Decimal(str(getattr(so_item, "unit_weight_g", 0) or 0)) if so_item else Decimal("0")
                qty_pcs = None
                row_required_qty_kg = (
                    partial_metrics["shortfall_kg"]
                    if partial_metrics["requires_replan"]
                    else self._order_qty_kg("sales", order)
                )
                roll_invariants = None
                if so_item and str(template.fg_type or "").upper() == "ROLL":
                    roll_invariants = self._roll_invariants(
                        layer_snapshot=order_layer_snapshot,
                        required_qty_kg=row_required_qty_kg,
                    )
                elif so_item:
                    if partial_metrics["requires_replan"] and unit_weight > 0:
                        qty_pcs = float((row_required_qty_kg * Decimal("1000")) / Decimal(str(so_item.unit_weight_g)))
                    elif qty_uom == 'PCS':
                        qty_pcs = float(so_item.qty_value)
                    elif unit_weight > 0:
                        qty_pcs = float((so_item.total_weight_kg * 1000) / so_item.unit_weight_g)
                math_valid, math_error = self._math_state(
                    required_qty_kg=row_required_qty_kg,
                    qty_uom=qty_uom,
                    unit_weight_g=unit_weight,
                    fg_type=str(template.fg_type or "POUCH"),
                    roll_invariants=roll_invariants,
                )
                line_status = str(getattr(so_item, "line_status", "") or "").upper() if so_item else ""
                qty_final_output = SalesOrderService.line_final_output_qty(so_item) if so_item and line_status == "PARTIAL" else Decimal("0")
                qty_dispatchable = SalesOrderService.line_dispatchable_qty(so_item) if so_item else Decimal("0")
                qty_replan_remaining = SalesOrderService.line_replan_remaining_qty(so_item) if so_item else Decimal("0")
                qty_replan_remaining_kg = SalesOrderService.line_replan_remaining_kg(so_item) if so_item else Decimal("0")

                row = {
                    "order_kind": "sales",
                    "order_id": str(order.id),
                    "sales_order_item_id": str(so_item.id) if so_item else None,
                    "order_number": order.order_number,
                    "customer_name": str(order.customer_name or "").strip(),
                    "display_name": str(getattr(so_item, "line_name", "") or template.name or "").strip(),
                    "delivery_date": order.delivery_date.isoformat() if getattr(order, "delivery_date", None) else None,
                    "status": order.status,
                    "template_id": str(template.id),
                    "template_name": template.name,
                    "fg_type": template.fg_type,
                    "final_product_type": str(template.fg_type or "").upper(),
                    "planned_output_type": str(template.fg_type or "").upper(),
                    "planner_stock_class": None,
                    "required_qty_kg": float(row_required_qty_kg),
                    "required_qty_pcs": None if str(template.fg_type or "").upper() == "ROLL" else qty_pcs,
                    "qty_open": float(Decimal(str(getattr(so_item, "qty_open", 0) or 0))) if so_item else 0,
                    "qty_final_output": float(qty_final_output),
                    "qty_dispatchable": float(qty_dispatchable),
                    "qty_replan_remaining": float(qty_replan_remaining),
                    "qty_replan_remaining_kg": float(qty_replan_remaining_kg),
                    "qty_uom": qty_uom,
                    "math_valid": math_valid,
                    "math_error": math_error,
                    "required_start_step": required_start_step,
                    "route_last_step_index": route_last,
                    "required_roll_width_mm": float(self._sales_item_roll_width_mm(so_item)) if so_item else None,
                    "geometry_override": order.geometry_override or {},
                    "geometry_snapshot": _jsonify(order_geometry_snapshot or {}),
                    "spec_signature": spec_signature,
                    "effective_dims": eff_dims,
                    "roll_invariants": roll_invariants,
                    "layer_snapshot": _jsonify(order_layer_snapshot or []),
                    "layer_summary": self._layer_stack_summary(order_layer_snapshot),
                    "printing_snapshot": _jsonify(so_item.printing_snapshot or {}) if so_item else {},
                    "addons_snapshot": _jsonify(so_item.addons_snapshot or []) if so_item else [],
                    "packaging_snapshot": _jsonify(_normalize_packaging_snapshot(so_item.packaging_snapshot or {})) if so_item else {},
                    "created_at": order.created_at.isoformat() if order.created_at else None,
                    "artwork_assignment_required": bool(pending_print_items),
                    "assigned_artwork_id": str(getattr(so_item, "assigned_artwork_id", "") or ""),
                    "pending_artwork_items": pending_artwork_items,
                    "printing_enabled": bool(print_profile.get("enabled")),
                    "print_type": str(print_profile.get("print_type") or "").upper(),
                    "substrate_mode": str(print_profile.get("substrate_mode") or "").upper(),
                    "ink_base_family": str(print_profile.get("ink_base_family") or "").upper(),
                    "front_colors_count": int(print_profile.get("front_colors_count") or 0),
                    "back_colors_count": int(print_profile.get("back_colors_count") or 0),
                    "partial_replan_required": bool(partial_metrics["requires_replan"]),
                    "partial_shortfall_kg": float(partial_metrics["shortfall_kg"]),
                    "partial_shortfall_pct": float(partial_metrics["shortfall_pct"]),
                    "partial_produced_kg": float(partial_metrics["produced_kg"]),
                    "partial_target_kg": float(partial_metrics["target_kg"]),
                    "has_started_final_output": bool(partial_metrics.get("has_started_final_output")),
                }
                if so_item:
                    bom_snapshot = so_item.bom_snapshot or {}
                    material_plan_lines, material_plan_summary = self._material_plan_payload(bom_snapshot)
                    row["material_plan_lines"] = material_plan_lines
                    row["material_plan_summary"] = material_plan_summary
                    row.update(
                        self._effective_bom_readiness_payload(
                            bom_snapshot,
                            template=template,
                            layer_snapshot=so_item.layer_snapshot or [],
                            required_start_step=required_start_step,
                        )
                    )

                jobs_qs = ProductionJob.objects.filter(sales_order_item__sales_order=order)
                job_count = jobs_qs.count()
                needs_planning_queue = (
                    order.status == "PLANNING_REQUIRED"
                    or (order.status == "CONFIRMED" and job_count == 0)
                )

                if needs_planning_queue:
                    row["inventory_options"] = []
                    row["matching_stock_orders"] = []
                    row["source_availability"] = self._cheap_source_availability(
                        template=template,
                        required_start_step=required_start_step,
                        route_last_index=route_last,
                        order_signature=sig,
                        order_invariant_signature=inv_sig,
                    )
                    row["continuation"] = self._cheap_continuation_summary(row["source_availability"])
                    planning_queue.append(self._decorate_control_hub_row(row))
                elif order.status in ("PLANNED", "RELEASED") or (order.status == "CONFIRMED" and job_count > 0):
                    row["job_count"] = job_count
                    row["jobs_released"] = jobs_qs.filter(job_state="RELEASED").count()
                    row["jobs_completed"] = jobs_qs.filter(job_state__in=["COMPLETED", "DONE"]).count()
                    active_orders.append(row)
                else:
                    order_history.append(row)
                if len(planning_queue) >= planning_limit and len(active_orders) >= active_limit and len(order_history) >= history_limit:
                    break
            except Exception as exc:
                fallback_template = self._sales_primary_template(order)
                fallback_row = {
                    "order_kind": "sales",
                    "order_id": str(order.id),
                    "sales_order_item_id": None,
                    "order_number": order.order_number,
                    "customer_name": str(order.customer_name or "").strip(),
                    "display_name": str(getattr(fallback_template, "name", "") or "Sales Order").strip(),
                    "delivery_date": order.delivery_date.isoformat() if getattr(order, "delivery_date", None) else None,
                    "status": order.status,
                    "template_id": str(fallback_template.id) if fallback_template else "",
                    "template_name": fallback_template.name if fallback_template else "Unknown Template",
                    "fg_type": getattr(fallback_template, "fg_type", None),
                    "final_product_type": str(getattr(fallback_template, "fg_type", "") or "").upper() or None,
                    "planned_output_type": str(getattr(fallback_template, "fg_type", "") or "").upper() or None,
                    "required_qty_kg": 0.0,
                    "required_qty_pcs": None,
                    "qty_uom": "KG",
                    "math_valid": False,
                    "math_error": "Planner row failed to compute.",
                    "required_start_step": 0,
                    "route_last_step_index": self._route_last_index(fallback_template) if fallback_template else 0,
                    "required_roll_width_mm": None,
                    "geometry_override": order.geometry_override or {},
                    "effective_dims": self._compute_effective_dims(order.geometry_override, {}),
                    "roll_invariants": None,
                    "created_at": order.created_at.isoformat() if order.created_at else None,
                    "pending_artwork_items": [],
                    "material_plan_lines": [],
                    "material_plan_summary": {
                        "line_count": 0,
                        "override_count": 0,
                        "default_count": 0,
                        "theoretical_total_qty": 0.0,
                        "planned_issue_total_qty": 0.0,
                        "uom": "KG",
                    },
                    "inventory_options": [],
                    "matching_stock_orders": [],
                    "row_error": "This order has malformed planning data.",
                    "row_error_detail": str(exc),
                    "row_recoverable": True,
                }
                planning_queue.append(self._decorate_control_hub_row(fallback_row))
                if len(planning_queue) >= planning_limit and len(active_orders) >= active_limit and len(order_history) >= history_limit:
                    break

        # --- Stock Orders ---
        all_mts = (
            PlannedStockOrder.objects.exclude(status__in=["CANCELLED"])
            .select_related("template", "template__routing_rule")
            .order_by("-created_at")
        )[:scan_limit]
        for order in all_mts:
            try:
                order_status = str(getattr(order, "status", "") or "").upper()
                if order_status == "PLANNING_REQUIRED" and len(planning_queue) >= planning_limit:
                    continue
                if order_status in {"PLANNED", "RELEASED"} and len(active_orders) >= active_limit:
                    continue
                if order_status not in {"PLANNING_REQUIRED", "PLANNED", "RELEASED"} and len(order_history) >= history_limit:
                    continue
                template = order.template
                if not template:
                    continue
                route_last = self._route_last_index(template)
                required_start_step = int(order.start_step_index or 0)
                sig = self._order_signature(
                    spec_signature=getattr(order, "spec_signature", ""),
                    geometry_snapshot=order.geometry_snapshot or {},
                    geometry_override=order.geometry_override,
                    layer_snapshot=order.layer_snapshot or [],
                    printing_snapshot=order.printing_snapshot or {},
                    addons_snapshot=order.addons_snapshot or [],
                    template=template,
                )
                inv_sig = self._order_invariant_signature(
                    invariant_signature=getattr(order, "invariant_signature", ""),
                    layer_snapshot=order.layer_snapshot or [],
                    printing_snapshot=order.printing_snapshot or {},
                )
                eff_dims = self._compute_effective_dims(order.geometry_override, order.geometry_snapshot or {})
                stock_purpose = str(getattr(order, "stock_purpose", "PRODUCT") or "PRODUCT").upper()
                stock_strategy = self._normalize_stock_strategy(
                    stock_strategy=getattr(order, "stock_strategy", ""),
                    template=template,
                    stock_purpose=stock_purpose,
                    stop_step_index=getattr(order, "stop_step_index", None),
                )
                quantity_uom = str(getattr(order, "quantity_uom", "KG") or "KG").upper()
                required_qty_kg = self._order_qty_kg("stock", order)
                roll_invariants = None
                required_qty_pcs = None
                if stock_purpose == "PACKAGING":
                    if quantity_uom == "PCS":
                        required_qty_pcs = float(Decimal(str(order.target_qty or 0)))
                        required_qty_kg = Decimal("0")
                elif str(template.fg_type or "").upper() == "ROLL":
                    roll_invariants = self._roll_invariants(
                        layer_snapshot=order.layer_snapshot or [],
                        required_qty_kg=required_qty_kg,
                    )
                else:
                    required_qty_pcs = self._calculate_stock_pcs(order, template)
                if stock_purpose == "PACKAGING":
                    math_valid = Decimal(str(order.target_qty or 0)) > 0
                    math_error = "" if math_valid else "Packaging quantity must be greater than 0."
                else:
                    math_valid, math_error = self._math_state(
                        required_qty_kg=required_qty_kg,
                        qty_uom=quantity_uom,
                        unit_weight_g=Decimal(str(getattr(order, "unit_weight_g", 0) or 0)),
                        fg_type=str(template.fg_type or "POUCH"),
                        roll_invariants=roll_invariants,
                    )

                row = {
                    "order_kind": "stock",
                    "order_id": str(order.id),
                    "order_number": order.order_number,
                    "customer_name": "",
                    "display_name": str(order.internal_name or template.name or "").strip(),
                    "delivery_date": None,
                    "status": order.status,
                    "template_id": str(template.id),
                    "template_name": template.name,
                    "fg_type": template.fg_type,
                    "final_product_type": None if stock_purpose == "PACKAGING" else str(template.fg_type or "").upper(),
                    "planned_output_type": "PACKAGING_STOCK" if stock_purpose == "PACKAGING" else str(getattr(order, "output_type", "") or ""),
                    "stock_strategy": stock_strategy,
                    "planner_stock_class": self._planner_stock_class_for_order(order, template),
                    "required_qty_kg": float(required_qty_kg),
                    "required_qty_pcs": required_qty_pcs if required_qty_pcs and required_qty_pcs > 0 else None,
                    "qty_uom": quantity_uom,
                    "math_valid": math_valid,
                    "math_error": math_error,
                    "required_start_step": required_start_step,
                    "route_last_step_index": route_last,
                    "required_roll_width_mm": float(self._stock_order_roll_width_mm(order)),
                    "geometry_override": order.geometry_override or {},
                    "geometry_snapshot": _jsonify(order.geometry_snapshot or {}),
                    "spec_signature": getattr(order, "spec_signature", ""),
                    "effective_dims": eff_dims,
                    "roll_invariants": roll_invariants,
                    "layer_snapshot": _jsonify(order.layer_snapshot or []),
                    "layer_summary": self._layer_stack_summary(order.layer_snapshot or []),
                    "printing_snapshot": _jsonify(order.printing_snapshot or {}),
                    "addons_snapshot": _jsonify(order.addons_snapshot or []),
                    "packaging_snapshot": _jsonify(_normalize_packaging_snapshot(getattr(order, "packaging_snapshot", {}) or {})),
                    "created_at": order.created_at.isoformat() if hasattr(order, 'created_at') and order.created_at else None,
                    "artwork_assignment_required": bool(order.artwork_assignment_required),
                    "assigned_artwork_id": str(getattr(order, "assigned_artwork_id", "") or ""),
                    "printing_enabled": bool((order.printing_snapshot or {}).get("enabled", False)),
                    "print_type": str((order.printing_snapshot or {}).get("type") or (order.printing_snapshot or {}).get("method") or "").upper(),
                    "front_colors_count": int((order.printing_snapshot or {}).get("front_colors_count") or 0),
                    "back_colors_count": int((order.printing_snapshot or {}).get("back_colors_count") or 0),
                }
                material_plan_lines, material_plan_summary = self._material_plan_payload(order.bom_snapshot or {})
                row["material_plan_lines"] = material_plan_lines
                row["material_plan_summary"] = material_plan_summary
                if order.status == "PLANNING_REQUIRED":
                    row["inventory_options"] = []
                    row["source_availability"] = self._cheap_source_availability(
                        template=template,
                        required_start_step=required_start_step,
                        route_last_index=route_last,
                        order_signature=sig,
                        order_invariant_signature=inv_sig,
                    )
                    row["continuation"] = self._cheap_continuation_summary(row["source_availability"])
                    planning_queue.append(self._decorate_control_hub_row(row))
                elif order.status in ("PLANNED", "RELEASED"):
                    jobs_qs = ProductionJob.objects.filter(mts_order=order)
                    row["job_count"] = jobs_qs.count()
                    row["jobs_released"] = jobs_qs.filter(job_state="RELEASED").count()
                    row["jobs_completed"] = jobs_qs.filter(job_state__in=["COMPLETED", "DONE"]).count()
                    active_orders.append(row)
                else:
                    order_history.append(row)
                if len(planning_queue) >= planning_limit and len(active_orders) >= active_limit and len(order_history) >= history_limit:
                    break
            except Exception as exc:
                template = getattr(order, "template", None)
                fallback_row = {
                    "order_kind": "stock",
                    "order_id": str(order.id),
                    "order_number": order.order_number,
                    "customer_name": "",
                    "display_name": str(getattr(order, "internal_name", "") or getattr(template, "name", "") or "Stock Order").strip(),
                    "delivery_date": None,
                    "status": order.status,
                    "template_id": str(template.id) if template else "",
                    "template_name": template.name if template else "Unknown Template",
                    "fg_type": getattr(template, "fg_type", None),
                    "final_product_type": None if str(getattr(order, "stock_purpose", "PRODUCT") or "PRODUCT").upper() == "PACKAGING" else (str(getattr(template, "fg_type", "") or "").upper() or None),
                    "planned_output_type": "PACKAGING_STOCK" if str(getattr(order, "stock_purpose", "PRODUCT") or "PRODUCT").upper() == "PACKAGING" else str(getattr(order, "output_type", "") or ""),
                    "stock_strategy": self._normalize_stock_strategy(
                        stock_strategy=getattr(order, "stock_strategy", ""),
                        template=template,
                        stock_purpose=getattr(order, "stock_purpose", "PRODUCT"),
                        stop_step_index=getattr(order, "stop_step_index", None),
                    ),
                    "planner_stock_class": self._planner_stock_class_for_order(order, template) if template else None,
                    "required_qty_kg": 0.0,
                    "required_qty_pcs": None,
                    "qty_uom": str(getattr(order, "quantity_uom", "KG") or "KG").upper(),
                    "math_valid": False,
                    "math_error": "Planner row failed to compute.",
                    "required_start_step": int(getattr(order, "start_step_index", 0) or 0),
                    "route_last_step_index": self._route_last_index(template) if template else 0,
                    "geometry_override": order.geometry_override or {},
                    "effective_dims": self._compute_effective_dims(order.geometry_override, {}),
                    "roll_invariants": None,
                    "created_at": order.created_at.isoformat() if hasattr(order, "created_at") and order.created_at else None,
                    "material_plan_lines": [],
                    "material_plan_summary": {
                        "line_count": 0,
                        "override_count": 0,
                        "default_count": 0,
                        "theoretical_total_qty": 0.0,
                        "planned_issue_total_qty": 0.0,
                        "uom": "KG",
                    },
                    "inventory_options": [],
                    "row_error": "This stock order has malformed planning data.",
                    "row_error_detail": str(exc),
                    "row_recoverable": True,
                }
                planning_queue.append(self._decorate_control_hub_row(fallback_row))
                if len(planning_queue) >= planning_limit and len(active_orders) >= active_limit and len(order_history) >= history_limit:
                    break
        kpis = {
            "planning_queue_count": len(planning_queue),
            "ready_released_count": len(active_orders),
            "history_count": len(order_history),
            "queue_blocked_count": sum(1 for row in planning_queue if bool(row.get("blockers"))),
            "queue_recoverable_rows": sum(1 for row in planning_queue if bool(row.get("row_recoverable"))),
            "queue_required_qty_kg": float(sum(Decimal(str((row or {}).get("required_qty_kg") or 0)) for row in planning_queue)),
            "queue_allocatable_qty_kg": float(
                sum(
                    sum(Decimal(str((opt or {}).get("allocatable_qty_kg") or 0)) for opt in ((row or {}).get("inventory_options") or []))
                    for row in planning_queue
                )
            ),
        }
        return Response({
            "orders": planning_queue,  # backward compat: planning queue
            "active_orders": active_orders,
            "order_history": order_history,
            "kpis": kpis,
        })

    def _sales_item_remaining_qty_kg(self, so_item: SalesOrderItem) -> Decimal:
        target = Decimal(str(getattr(so_item, "total_weight_kg", 0) or 0))
        linked_rolls = (
            InventoryRoll.objects.filter(sales_order_item=so_item)
            .aggregate(total=Sum("weight_kg"))
            .get("total")
            or Decimal("0")
        )
        linked_batches = (
            FinishedGoodsBatch.objects.filter(sales_order_item=so_item)
            .aggregate(total=Sum("qty_kg"))
            .get("total")
            or Decimal("0")
        )
        remaining = target - Decimal(str(linked_rolls or 0)) - Decimal(str(linked_batches or 0))
        return remaining if remaining > 0 else Decimal("0")

    def _origin_stock_order_for_roll(self, roll: InventoryRoll):
        origin_job = getattr(roll, "created_by_job", None) or getattr(roll, "production_job", None)
        return getattr(origin_job, "mts_order", None) if origin_job else None

    def _origin_stock_order_for_batch(self, batch: FinishedGoodsBatch):
        origin_job = getattr(batch, "production_job", None)
        return getattr(origin_job, "mts_order", None) if origin_job else None

    def _append_claim_history(self, meta: dict | None, *, sales_item: SalesOrderItem, stock_order, qty_kg: Decimal, inventory_type: str):
        payload = dict(meta or {})
        claim_history = list(payload.get("claim_history") or [])
        claim_history.append(
            {
                "claimed_at": timezone.now().isoformat(),
                "sales_order_id": str(sales_item.sales_order_id),
                "sales_order_no": str(sales_item.sales_order.order_number),
                "sales_order_item_id": str(sales_item.id),
                "stock_order_id": str(stock_order.id) if stock_order else None,
                "stock_order_no": str(stock_order.order_number) if stock_order else None,
                "qty_kg": float(qty_kg),
                "inventory_type": inventory_type,
            }
        )
        payload["claim_history"] = claim_history
        payload["claim_origin"] = "STOCK_CLAIM"
        payload["claimed_from_stock_order_id"] = str(stock_order.id) if stock_order else None
        payload["claimed_from_stock_order_no"] = str(stock_order.order_number) if stock_order else None
        payload["dispatch_mode"] = "STOCK_CLAIM"
        return payload

    @action(
        detail=False,
        methods=["get"],
        url_path=r"control-hub/sales-items/(?P<sales_order_item_id>[^/.]+)/claim-candidates",
    )
    def claim_candidates(self, request, sales_order_item_id=None):
        try:
            so_item = SalesOrderItem.objects.select_related("sales_order", "template", "template__routing_rule").get(id=sales_order_item_id)
        except SalesOrderItem.DoesNotExist:
            return Response({"error": "Sales order item not found"}, status=status.HTTP_404_NOT_FOUND)

        if not so_item.template_id or not getattr(so_item.template, "routing_rule", None):
            return Response({"error": "Sales order item has no routable template."}, status=status.HTTP_400_BAD_REQUEST)

        route_last = self._route_last_index(so_item.template)
        required_route_id = getattr(so_item.template, "routing_rule_id", None)
        order_sig = self._order_signature(
            spec_signature=getattr(so_item, "spec_signature", ""),
            geometry_snapshot=so_item.geometry_snapshot or {},
            layer_snapshot=so_item.layer_snapshot or [],
            printing_snapshot=so_item.printing_snapshot or {},
            addons_snapshot=so_item.addons_snapshot or [],
            template=so_item.template,
        )
        order_inv_sig = self._order_invariant_signature(
            invariant_signature=getattr(so_item, "invariant_signature", ""),
            layer_snapshot=so_item.layer_snapshot or [],
            printing_snapshot=so_item.printing_snapshot or {},
        )
        remaining_qty = self._sales_item_remaining_qty_kg(so_item)
        roll_alloc_map, fg_alloc_map = self._inventory_active_allocation_maps()
        candidates = []

        roll_qs = (
            InventoryRoll.objects.filter(
                is_fg=True,
                status="AVAILABLE",
                sales_order_item__isnull=True,
                completed_step_index=route_last,
            )
            .exclude(meta_json__is_internal_stock=True)
            .filter(Q(created_by_job__mts_order__stock_purpose="PRODUCT") | Q(production_job__mts_order__stock_purpose="PRODUCT"))
            .select_related(
                "template",
                "sales_order_item",
                "created_by_job__mts_order",
                "production_job__mts_order",
            )
            .order_by("created_at")
        )

        for roll in roll_qs:
            source_stock_order = self._origin_stock_order_for_roll(roll)
            if not source_stock_order:
                continue
            if not self._stock_commitment_matches_sales_item(source_stock_order, so_item):
                continue
            roll_route_id = getattr(getattr(roll, "template", None), "routing_rule_id", None)
            if required_route_id and roll_route_id != required_route_id:
                continue
            if self._roll_signature(roll) != order_sig:
                continue
            if order_inv_sig and self._roll_invariant_signature(roll) != order_inv_sig:
                continue
            physical = Decimal(str(roll.weight_kg or 0))
            already_claimed = Decimal(str(roll_alloc_map.get(str(roll.id), Decimal("0")) or 0))
            if already_claimed > 0:
                continue
            requires_split = bool(remaining_qty > 0 and remaining_qty < physical)
            candidates.append(
                {
                    "inventory_type": "ROLL",
                    "inventory_id": str(roll.id),
                    "label": roll.label_id,
                    "source_stock_order_id": str(source_stock_order.id),
                    "source_stock_order_no": source_stock_order.order_number,
                    "current_qty_kg": float(physical),
                    "already_claimed_qty_kg": float(already_claimed),
                    "claimable_qty_kg": float(physical - already_claimed),
                    "requires_split_for_partial": requires_split,
                }
            )

        batch_qs = (
            FinishedGoodsBatch.objects.filter(
                status="AVAILABLE",
                sales_order_item__isnull=True,
                completed_step_index=route_last,
            )
            .exclude(meta_json__is_internal_stock=True)
            .filter(production_job__mts_order__stock_purpose="PRODUCT")
            .select_related("template", "production_job__mts_order")
            .order_by("created_at")
        )
        for batch in batch_qs:
            source_stock_order = self._origin_stock_order_for_batch(batch)
            if not source_stock_order:
                continue
            if not self._stock_commitment_matches_sales_item(source_stock_order, so_item):
                continue
            batch_route_id = getattr(getattr(batch, "template", None), "routing_rule_id", None)
            if required_route_id and batch_route_id != required_route_id:
                continue
            if self._fg_signature(batch) != order_sig:
                continue
            if order_inv_sig and self._fg_invariant_signature(batch) != order_inv_sig:
                continue
            physical = Decimal(str(batch.qty_kg or 0))
            if physical <= 0:
                continue
            already_claimed = Decimal(str(fg_alloc_map.get(str(batch.id), Decimal("0")) or 0))
            if already_claimed > 0:
                continue
            if remaining_qty > 0 and physical > remaining_qty:
                # Pouch batches do not support partial claim/split in V1.
                continue
            candidates.append(
                {
                    "inventory_type": "FG_BATCH",
                    "inventory_id": str(batch.id),
                    "label": batch.batch_number,
                    "source_stock_order_id": str(source_stock_order.id),
                    "source_stock_order_no": source_stock_order.order_number,
                    "current_qty_kg": float(physical),
                    "already_claimed_qty_kg": float(already_claimed),
                    "claimable_qty_kg": float(physical - already_claimed),
                    "requires_split_for_partial": False,
                }
            )

        return Response(
            {
                "sales_order_item_id": str(so_item.id),
                "spec_signature": order_sig,
                "invariant_signature": order_inv_sig,
                "remaining_qty_kg": float(remaining_qty),
                "candidates": candidates,
            }
        )

    @action(
        detail=False,
        methods=["post"],
        url_path=r"control-hub/sales-items/(?P<sales_order_item_id>[^/.]+)/claim-stock",
    )
    def claim_stock(self, request, sales_order_item_id=None):
        try:
            so_item = SalesOrderItem.objects.select_related("sales_order", "template", "template__routing_rule").get(id=sales_order_item_id)
        except SalesOrderItem.DoesNotExist:
            return Response({"error": "Sales order item not found"}, status=status.HTTP_404_NOT_FOUND)

        inventory_type = str(request.data.get("inventory_type") or "").upper()
        inventory_id = request.data.get("inventory_id")
        if inventory_type not in {"ROLL", "FG_BATCH", "FG"}:
            return Response({"error": "inventory_type must be ROLL or FG_BATCH"}, status=status.HTTP_400_BAD_REQUEST)
        if not inventory_id:
            return Response({"error": "inventory_id is required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            claim_qty = Decimal(str(request.data.get("claim_qty_kg") or 0))
        except Exception:
            return Response({"error": "claim_qty_kg must be numeric"}, status=status.HTTP_400_BAD_REQUEST)
        if claim_qty <= 0:
            return Response({"error": "claim_qty_kg must be > 0"}, status=status.HTTP_400_BAD_REQUEST)

        remaining_qty = self._sales_item_remaining_qty_kg(so_item)
        if remaining_qty > 0 and claim_qty > remaining_qty:
            return Response(
                {
                    "error": (
                        f"Claim exceeds remaining sales demand. Requested {claim_qty} KG, "
                        f"remaining {remaining_qty} KG for {so_item.sales_order.order_number}."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        order_sig = self._order_signature(
            spec_signature=getattr(so_item, "spec_signature", ""),
            geometry_snapshot=so_item.geometry_snapshot or {},
            layer_snapshot=so_item.layer_snapshot or [],
            printing_snapshot=so_item.printing_snapshot or {},
            addons_snapshot=so_item.addons_snapshot or [],
            template=so_item.template,
        )
        order_inv_sig = self._order_invariant_signature(
            invariant_signature=getattr(so_item, "invariant_signature", ""),
            layer_snapshot=so_item.layer_snapshot or [],
            printing_snapshot=so_item.printing_snapshot or {},
        )
        route_last = self._route_last_index(so_item.template)
        required_route_id = getattr(so_item.template, "routing_rule_id", None)

        with transaction.atomic():
            if inventory_type == "ROLL":
                try:
                    # Avoid FOR UPDATE across nullable joins; PostgreSQL rejects that query shape.
                    roll = InventoryRoll.objects.select_for_update().get(id=inventory_id)
                except InventoryRoll.DoesNotExist:
                    return Response({"error": "Roll not found"}, status=status.HTTP_404_NOT_FOUND)

                if roll.status != "AVAILABLE":
                    return Response({"error": f"Roll {roll.label_id} is not AVAILABLE."}, status=status.HTTP_400_BAD_REQUEST)
                if not bool(roll.is_fg) or int(roll.completed_step_index or 0) != route_last:
                    return Response(
                        {"error": f"Roll {roll.label_id} is not a final-step finished-good roll and cannot be claimed to sales."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                if roll.sales_order_item_id:
                    return Response({"error": f"Roll {roll.label_id} is already claimed to a sales order."}, status=status.HTTP_400_BAD_REQUEST)

                source_stock_order = self._origin_stock_order_for_roll(roll)
                if not source_stock_order or str(source_stock_order.stock_purpose or "").upper() != "PRODUCT":
                    return Response({"error": f"Roll {roll.label_id} is not product stock-order output."}, status=status.HTTP_400_BAD_REQUEST)
                if not self._stock_commitment_matches_sales_item(source_stock_order, so_item):
                    return Response(
                        {"error": self._stock_commitment_mismatch_message(source_stock_order, so_item, f"Roll {roll.label_id}")},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                roll_route_id = getattr(getattr(roll, "template", None), "routing_rule_id", None)
                if required_route_id and roll_route_id != required_route_id:
                    return Response({"error": f"Roll {roll.label_id} route lineage does not match this sales order."}, status=status.HTTP_400_BAD_REQUEST)
                if self._roll_signature(roll) != order_sig:
                    return Response({"error": f"Roll {roll.label_id} spec signature does not match the sales item."}, status=status.HTTP_400_BAD_REQUEST)
                if order_inv_sig and self._roll_invariant_signature(roll) != order_inv_sig:
                    return Response({"error": f"Roll {roll.label_id} invariant signature does not match the sales item."}, status=status.HTTP_400_BAD_REQUEST)
                if InventoryAllocation.objects.filter(inventory_roll=roll, status="ACTIVE").exists():
                    return Response({"error": f"Roll {roll.label_id} already has an active allocation."}, status=status.HTTP_400_BAD_REQUEST)

                physical = Decimal(str(roll.weight_kg or 0))
                if claim_qty > physical:
                    return Response(
                        {"error": f"Claim exceeds roll weight. Requested {claim_qty} KG, roll has {physical} KG."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                if claim_qty < physical:
                    return Response(
                        {
                            "error": (
                                f"Direct partial claim is not allowed for roll {roll.label_id}. "
                                "Split the roll first, then claim the child roll."
                            )
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                allocation = InventoryAllocation.objects.create(
                    sales_order=so_item.sales_order,
                    mts_order=source_stock_order,
                    inventory_roll=roll,
                    allocated_qty_kg=claim_qty,
                    status="ACTIVE",
                    created_by=request.user if request.user.is_authenticated else None,
                )
                roll.sales_order_item = so_item
                roll.meta_json = self._append_claim_history(
                    roll.meta_json,
                    sales_item=so_item,
                    stock_order=source_stock_order,
                    qty_kg=claim_qty,
                    inventory_type="ROLL",
                )
                roll.save(update_fields=["sales_order_item", "meta_json"])

                return Response(
                    {
                        "status": "claimed",
                        "inventory_type": "ROLL",
                        "inventory_id": str(roll.id),
                        "label": roll.label_id,
                        "sales_order_id": str(so_item.sales_order_id),
                        "sales_order_item_id": str(so_item.id),
                        "source_stock_order_id": str(source_stock_order.id),
                        "source_stock_order_no": source_stock_order.order_number,
                        "claimed_qty_kg": float(claim_qty),
                        "allocation_id": str(allocation.id),
                    },
                    status=status.HTTP_201_CREATED,
                )

            try:
                # Avoid FOR UPDATE across nullable joins; PostgreSQL rejects that query shape.
                batch = FinishedGoodsBatch.objects.select_for_update().get(id=inventory_id)
            except FinishedGoodsBatch.DoesNotExist:
                return Response({"error": "FG batch not found"}, status=status.HTTP_404_NOT_FOUND)

            if batch.status != "AVAILABLE":
                return Response({"error": f"FG batch {batch.batch_number} is not AVAILABLE."}, status=status.HTTP_400_BAD_REQUEST)
            if int(batch.completed_step_index or 0) != route_last:
                return Response(
                    {"error": f"FG batch {batch.batch_number} is not at the final route step and cannot be claimed to sales."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if batch.sales_order_item_id:
                return Response({"error": f"FG batch {batch.batch_number} is already claimed to a sales order."}, status=status.HTTP_400_BAD_REQUEST)

            source_stock_order = self._origin_stock_order_for_batch(batch)
            if not source_stock_order or str(source_stock_order.stock_purpose or "").upper() != "PRODUCT":
                return Response({"error": f"FG batch {batch.batch_number} is not product stock-order output."}, status=status.HTTP_400_BAD_REQUEST)
            if not self._stock_commitment_matches_sales_item(source_stock_order, so_item):
                return Response(
                    {"error": self._stock_commitment_mismatch_message(source_stock_order, so_item, f"FG batch {batch.batch_number}")},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            batch_route_id = getattr(getattr(batch, "template", None), "routing_rule_id", None)
            if required_route_id and batch_route_id != required_route_id:
                return Response({"error": f"FG batch {batch.batch_number} route lineage does not match this sales order."}, status=status.HTTP_400_BAD_REQUEST)
            if self._fg_signature(batch) != order_sig:
                return Response({"error": f"FG batch {batch.batch_number} spec signature does not match the sales item."}, status=status.HTTP_400_BAD_REQUEST)
            if order_inv_sig and self._fg_invariant_signature(batch) != order_inv_sig:
                return Response({"error": f"FG batch {batch.batch_number} invariant signature does not match the sales item."}, status=status.HTTP_400_BAD_REQUEST)
            if InventoryAllocation.objects.filter(fg_batch=batch, status="ACTIVE").exists():
                return Response({"error": f"FG batch {batch.batch_number} already has an active allocation."}, status=status.HTTP_400_BAD_REQUEST)

            physical = Decimal(str(batch.qty_kg or 0))
            if physical <= 0:
                return Response({"error": f"FG batch {batch.batch_number} has no claimable KG quantity."}, status=status.HTTP_400_BAD_REQUEST)
            if claim_qty != physical:
                return Response(
                    {
                        "error": (
                            f"FG batch claims must take the full batch in V1. "
                            f"Requested {claim_qty} KG, batch has {physical} KG."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            allocation = InventoryAllocation.objects.create(
                sales_order=so_item.sales_order,
                mts_order=source_stock_order,
                fg_batch=batch,
                allocated_qty_kg=claim_qty,
                status="ACTIVE",
                created_by=request.user if request.user.is_authenticated else None,
            )
            batch.sales_order_item = so_item
            batch.meta_json = self._append_claim_history(
                batch.meta_json,
                sales_item=so_item,
                stock_order=source_stock_order,
                qty_kg=claim_qty,
                inventory_type="FG_BATCH",
            )
            batch.save(update_fields=["sales_order_item", "meta_json"])

            return Response(
                {
                    "status": "claimed",
                    "inventory_type": "FG_BATCH",
                    "inventory_id": str(batch.id),
                    "label": batch.batch_number,
                    "sales_order_id": str(so_item.sales_order_id),
                    "sales_order_item_id": str(so_item.id),
                    "source_stock_order_id": str(source_stock_order.id),
                    "source_stock_order_no": source_stock_order.order_number,
                    "claimed_qty_kg": float(claim_qty),
                    "allocation_id": str(allocation.id),
                },
                status=status.HTTP_201_CREATED,
            )

    @action(
        detail=False,
        methods=["post"],
        url_path=r"control-hub/sales-items/(?P<sales_order_item_id>[^/.]+)/resume-stock-route",
    )
    def resume_stock_route(self, request, sales_order_item_id=None):
        try:
            so_item = SalesOrderItem.objects.select_related("sales_order", "template", "template__routing_rule").get(id=sales_order_item_id)
        except SalesOrderItem.DoesNotExist:
            return Response({"error": "Sales order item not found"}, status=status.HTTP_404_NOT_FOUND)

        stock_order_id = request.data.get("stock_order_id")
        if not stock_order_id:
            return Response({"error": "stock_order_id is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            stock_order = PlannedStockOrder.objects.select_related("template", "template__routing_rule").get(id=stock_order_id)
        except PlannedStockOrder.DoesNotExist:
            return Response({"error": "Stock order not found"}, status=status.HTTP_404_NOT_FOUND)

        if not so_item.template_id or not getattr(so_item.template, "routing_rule", None):
            return Response({"error": "Sales order item has no routable template."}, status=status.HTTP_400_BAD_REQUEST)

        route_last = self._route_last_index(so_item.template)
        order_sig = self._order_signature(
            spec_signature=getattr(so_item, "spec_signature", ""),
            geometry_snapshot=so_item.geometry_snapshot or {},
            layer_snapshot=so_item.layer_snapshot or [],
            printing_snapshot=so_item.printing_snapshot or {},
            addons_snapshot=so_item.addons_snapshot or [],
            template=so_item.template,
        )
        order_inv_sig = self._order_invariant_signature(
            invariant_signature=getattr(so_item, "invariant_signature", ""),
            layer_snapshot=so_item.layer_snapshot or [],
            printing_snapshot=so_item.printing_snapshot or {},
        )
        matches = self._matching_stock_orders_for_sales(
            template=so_item.template,
            order_signature=order_sig,
            order_invariant_signature=order_inv_sig,
            required_start_step=self._sales_required_start_step(so_item.template, so_item.layer_snapshot or []),
            sales_item=so_item,
        )
        eligible_match = next(
            (
                row for row in matches
                if str(row.get("order_id") or "") == str(stock_order.id)
                and str(row.get("match_mode") or "").upper() in {"EXACT_SPEC", "SEMI_INVARIANT", "PRE_ARTWORK_INVARIANT"}
            ),
            None,
        )
        if not eligible_match:
            return Response(
                {"error": "Stock order is not an eligible stopped-route continuation for this sales item."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        match_mode = str(eligible_match.get("match_mode") or "").upper()
        stop_step_index = int(eligible_match.get("stop_step_index") or 0)
        if stop_step_index >= route_last:
            return Response(
                {"error": "This stock order is already at the final route span. Use exact FG claim instead of route continuation."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if str(getattr(stock_order, "stock_purpose", "PRODUCT") or "PRODUCT").upper() != "PRODUCT":
            return Response({"error": "Only product stock orders can resume into sales demand."}, status=status.HTTP_400_BAD_REQUEST)
        if str(getattr(stock_order, "template_id", "") or "") != str(getattr(so_item, "template_id", "") or ""):
            return Response({"error": "Stock order template does not match the sales item template."}, status=status.HTTP_400_BAD_REQUEST)

        existing_jobs = self._order_job_queryset("sales", so_item.sales_order).exclude(job_state="CANCELLED")
        if existing_jobs.exists():
            return Response({"error": "Sales order already has production jobs. Resume route can only seed a fresh remaining route."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                created_allocations, start_step_index = self._resume_allocations_for_sales_from_stock_route(
                    sales_item=so_item,
                    stock_order=stock_order,
                    route_last=route_last,
                    required_route_id=getattr(so_item.template, "routing_rule_id", None),
                    order_invariant_signature=order_inv_sig,
                    order_layer_only_signature=self._layer_only_invariant_signature(so_item.layer_snapshot or []),
                    allow_layer_only=match_mode == "PRE_ARTWORK_INVARIANT",
                    created_by=request.user if request.user.is_authenticated else None,
                )
                planner_note = (
                    f"RESUME_STOCK_ROUTE source_stock_order={stock_order.order_number} "
                    f"source_stock_order_id={stock_order.id} start_step={start_step_index}"
                )
                jobs_created = JobService.create_jobs_for_so_item(
                    so_item,
                    start_index=start_step_index,
                    stop_index=route_last,
                    planner_note_prefix=planner_note,
                )
                if not jobs_created:
                    raise ValueError("Could not create remaining production jobs for the resumed route.")

                so_item.sales_order.status = "PLANNED"
                so_item.sales_order.save(update_fields=["status"])

            return Response(
                {
                    "status": "planned",
                    "order_kind": "sales",
                    "order_status": so_item.sales_order.status,
                    "sales_order_item_id": str(so_item.id),
                    "sales_order_no": str(so_item.sales_order.order_number),
                    "stock_order_id": str(stock_order.id),
                    "stock_order_no": str(stock_order.order_number),
                    "resume_mode": "EXACT_STOPPED_ROUTE" if match_mode == "EXACT_SPEC" else "COMPATIBLE_STOPPED_ROUTE",
                    "match_mode": match_mode,
                    "start_step_index": start_step_index,
                    "stop_step_index": stop_step_index,
                    "allocations_created": len(created_allocations),
                    "created_job_ids": [str(job.id) for job in jobs_created],
                    "created_job_numbers": [str(job.job_number) for job in jobs_created],
                },
                status=status.HTTP_201_CREATED,
            )
        except Exception as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    def _get_order_for_kind(self, order_kind: str, order_id: str):
        order_kind = str(order_kind or "").lower()
        if order_kind == "sales":
            order = SalesOrder.objects.prefetch_related("items__template__routing_rule").get(id=order_id)
            template = self._sales_primary_template(order)
            if not template:
                raise ValueError("Sales order has no template item to plan.")
            route_last = self._route_last_index(template)
            return order_kind, order, template, route_last
        if order_kind == "stock":
            order = PlannedStockOrder.objects.select_related("template", "template__routing_rule").get(id=order_id)
            template = order.template
            if not template:
                raise ValueError("Stock order has no template.")
            route_last = self._route_last_index(template)
            return order_kind, order, template, route_last
        raise ValueError("order_kind must be sales or stock")

    def _resolve_sales_control_item(self, order_obj, item_id=None, *, required=False):
        items = list(order_obj.items.select_related("template", "template__routing_rule").all())
        normalized_id = str(item_id or "").strip()
        if normalized_id:
            for item in items:
                if str(item.id) == normalized_id:
                    if not item.template or not item.template.routing_rule:
                        raise ValueError("Sales order line has missing template routing.")
                    return item
            raise ValueError("item_id does not belong to this sales order.")
        if len(items) == 1:
            item = items[0]
            if not item.template or not item.template.routing_rule:
                raise ValueError("Sales order line has missing template routing.")
            return item
        if required:
            raise ValueError("Select one sales order line for this planner action.")
        return None

    def _sync_sales_parent_after_planner_action(self, order_obj):
        return SalesOrderService.sync_order_status_from_lines(order_obj)

    def _order_items_for_planner(self, order_kind: str, order_obj):
        if order_kind == "sales":
            return list(order_obj.items.select_related("template").all())
        return [order_obj]

    def _aggregate_material_plan_lines(self, order_kind: str, order_obj):
        rows = []
        for item in self._order_items_for_planner(order_kind, order_obj):
            bom_snapshot = getattr(item, "bom_snapshot", {}) or {}
            material_plan_lines, _summary = self._material_plan_payload(bom_snapshot)
            rows.extend(material_plan_lines)
        return rows

    def _aggregate_packaging_requirements(self, order_kind: str, order_obj):
        requirements = {}
        warnings = []

        def _item_qty_context(item):
            qty_pcs = Decimal("0")
            qty_uom = str(getattr(item, "qty_uom", "KG") or "KG").upper()
            if qty_uom == "PCS":
                qty_pcs = Decimal(str(getattr(item, "qty_value", 0) or 0))
            unit_weight_g = Decimal(str(getattr(item, "unit_weight_g", 0) or 0))
            total_weight_kg = Decimal(str(getattr(item, "total_weight_kg", 0) or 0))
            if qty_pcs <= 0 and unit_weight_g > 0 and total_weight_kg > 0:
                qty_pcs = (total_weight_kg * Decimal("1000")) / unit_weight_g
            return qty_pcs, total_weight_kg

        def _add_requirement(material_id, uom, qty):
            material_key = str(material_id or "").strip()
            if not material_key:
                return
            qty_decimal = Decimal(str(qty or 0))
            if qty_decimal <= 0:
                return
            key = (material_key, str(uom or "PCS").upper())
            requirements[key] = requirements.get(key, Decimal("0")) + qty_decimal

        def _aggregate_packaging_line(item, line):
            if not isinstance(line, dict):
                return
            material_id = str(line.get("material_id") or "").strip()
            if not material_id:
                return
            basis = str(line.get("basis") or "").upper()
            uom = str(line.get("uom") or "PCS").upper()
            qty_pcs, total_weight_kg = _item_qty_context(item)
            pcs_per_pack = Decimal(str(line.get("pcs_per_pack") or 0))
            kg_per_pack = Decimal(str(line.get("kg_per_pack") or line.get("kg_per_bag") or 0))
            if basis in {"PCS_PER_PACK", "PRIMARY_INNER_PACK"} and qty_pcs > 0 and pcs_per_pack > 0:
                _add_requirement(material_id, uom, int((qty_pcs + pcs_per_pack - 1) // pcs_per_pack))
                return
            if basis == "KG_PER_PACK" and total_weight_kg > 0 and kg_per_pack > 0:
                _add_requirement(material_id, uom, int((total_weight_kg + kg_per_pack - 1) // kg_per_pack))
                return
            if basis == "PER_ORDER":
                _add_requirement(material_id, uom, line.get("qty") or 0)

        for item in self._order_items_for_planner(order_kind, order_obj):
            snapshot = getattr(item, "packaging_snapshot", {}) or {}
            snapshot = snapshot if isinstance(snapshot, dict) else {}
            packaging_lines = snapshot.get("packaging_lines") if isinstance(snapshot.get("packaging_lines"), list) else []
            if packaging_lines:
                for line in packaging_lines:
                    _aggregate_packaging_line(item, line)
                continue
            primary_cfg = snapshot.get("primary_inner_pack") if isinstance(snapshot.get("primary_inner_pack"), dict) else {}
            roll_pack_cfg = snapshot.get("roll_dispatch_pack") if isinstance(snapshot.get("roll_dispatch_pack"), dict) else {}

            material_id = str(primary_cfg.get("material_id") or "").strip()
            pcs_per_pack = int(primary_cfg.get("pcs_per_pack") or 0)
            if material_id and bool(primary_cfg.get("enabled")) and pcs_per_pack > 0:
                qty_pcs = Decimal("0")
                qty_uom = str(getattr(item, "qty_uom", "KG") or "KG").upper()
                if qty_uom == "PCS":
                    qty_pcs = Decimal(str(getattr(item, "qty_value", 0) or 0))
                else:
                    unit_weight_g = Decimal(str(getattr(item, "unit_weight_g", 0) or 0))
                    total_weight_kg = Decimal(str(getattr(item, "total_weight_kg", 0) or 0))
                    if unit_weight_g > 0 and total_weight_kg > 0:
                        qty_pcs = (total_weight_kg * Decimal("1000")) / unit_weight_g
                if qty_pcs > 0:
                    packs_needed = int((qty_pcs + Decimal(str(pcs_per_pack)) - 1) // Decimal(str(pcs_per_pack)))
                    key = (material_id, "PCS")
                    requirements[key] = requirements.get(key, Decimal("0")) + Decimal(str(packs_needed))

            for line in roll_pack_cfg.get("lines") if isinstance(roll_pack_cfg.get("lines"), list) else []:
                if not isinstance(line, dict):
                    continue
                material_id = str(line.get("material_id") or "").strip()
                qty = Decimal(str(line.get("qty") or 0))
                uom = str(line.get("uom") or "PCS").upper()
                basis = str(line.get("basis") or "PER_ROLL").upper()
                if not material_id:
                    continue
                if basis != "PER_ORDER" or qty <= 0:
                    continue
                key = (material_id, uom)
                requirements[key] = requirements.get(key, Decimal("0")) + qty
        return requirements, warnings

    def _create_pod_bulk_orders(self, *, order_kind: str, order_obj, created_by):
        lines = self._aggregate_material_plan_lines(order_kind, order_obj)
        created_orders = []
        skipped = []
        grouped = {}
        for row in lines:
            if not isinstance(row, dict):
                continue
            if str(row.get("category_code") or "").upper() != "POD":
                continue
            material_id = str(row.get("material_id") or "").strip()
            if not material_id:
                continue
            grouped[material_id] = grouped.get(material_id, Decimal("0")) + Decimal(str(row.get("planned_issue_qty") or 0))

        for material_id, required_qty in grouped.items():
            try:
                material = InventoryMaterial.objects.get(id=material_id, category="POD")
            except InventoryMaterial.DoesNotExist:
                skipped.append({"material_id": material_id, "reason": "POD material not found."})
                continue
            if not bool(getattr(material, "pod_is_inhouse_produced", False)):
                skipped.append({"material_id": material_id, "material_code": material.code, "reason": "POD material is not enabled for in-house production."})
                continue
            available = Decimal(str(
                InventoryBulk.objects.filter(material_id=material_id).aggregate(total=Sum("qty_kg")).get("total") or 0
            ))
            planned = Decimal(str(
                PlannedBulkStockOrder.objects.filter(
                    material_id=material_id,
                    status__in=["DRAFT", "PLANNING_REQUIRED", "PLANNED", "RELEASED", "STOCK_READY"],
                ).aggregate(total=Sum("target_qty_kg")).get("total") or 0
            ))
            shortage = required_qty - available - planned
            if shortage <= 0:
                skipped.append({"material_id": material_id, "material_code": material.code, "reason": "Existing POD stock and planned POD orders already cover the requirement."})
                continue
            profile_snapshot = {
                "pod_type": getattr(material, "pod_type", ""),
                "pod_fixed_height_mm": float(getattr(material, "pod_fixed_height_mm", 0) or 0),
                "pod_thickness_micron": float(getattr(material, "pod_thickness_micron", 0) or 0),
                "pod_panel_count": int(getattr(material, "pod_panel_count", 0) or 0),
            }
            order = PlannedBulkStockOrder.objects.create(
                internal_name=f"{material.name} POD Stock",
                material=material,
                plant=getattr(order_obj, "plant", None),
                target_qty_kg=shortage.quantize(Decimal("0.0001")),
                pod_profile_snapshot=profile_snapshot,
                planner_origin_meta={
                    "origin_kind": order_kind,
                    "origin_order_id": str(getattr(order_obj, "id", "")),
                    "origin_order_number": str(getattr(order_obj, "order_number", "")),
                },
                status="PLANNING_REQUIRED",
                created_by=created_by,
            )
            created_orders.append(order)
        return created_orders, skipped

    def _create_packaging_stock_orders(self, *, order_kind: str, order_obj, created_by):
        from apps.inventory.services.packaging_service import PackagingService

        requirements, warnings = self._aggregate_packaging_requirements(order_kind, order_obj)
        created_orders = []
        skipped = []
        for (material_id, requested_uom), required_qty in requirements.items():
            try:
                material = InventoryMaterial.objects.select_related("production_template", "production_template__routing_rule").get(
                    id=material_id,
                    category="PACKAGING",
                )
            except InventoryMaterial.DoesNotExist:
                skipped.append({"material_id": material_id, "reason": "Packaging material not found."})
                continue
            if str(getattr(material, "packaging_supply_mode", "") or "").upper() not in {"IN_HOUSE", "BOTH"}:
                skipped.append({"material_id": material_id, "material_code": material.code, "reason": "Packaging material is not enabled for in-house production."})
                continue
            if not getattr(material, "production_template", None):
                skipped.append({"material_id": material_id, "material_code": material.code, "reason": "Packaging material has no linked production template."})
                continue
            try:
                required_base_qty, _conversion = PackagingService._resolve_base_qty(material, required_qty, input_uom=requested_uom)
            except Exception as exc:
                skipped.append({"material_id": material_id, "material_code": material.code, "reason": str(exc)})
                continue
            available = Decimal(str(
                PackagingStock.objects.filter(material_id=material_id).aggregate(total=Sum("qty")).get("total") or 0
            ))
            planned = Decimal(str(
                PlannedStockOrder.objects.filter(
                    stock_purpose="PACKAGING",
                    packaging_material_id=material_id,
                    status__in=["DRAFT", "PLANNING_REQUIRED", "PLANNED", "RELEASED", "STOCK_READY"],
                ).aggregate(total=Sum("target_qty")).get("total") or 0
            ))
            shortage = required_base_qty - available - planned
            if shortage <= 0:
                skipped.append({"material_id": material_id, "material_code": material.code, "reason": "Existing packaging stock and planned packaging orders already cover the requirement."})
                continue

            defaults = dict(getattr(material, "packaging_defaults_json", {}) or {})
            geometry_snapshot = _jsonify(defaults.get("geometry") or {})
            layer_snapshot = _jsonify(defaults.get("film_layers") or [])
            printing_snapshot = _jsonify(defaults.get("printing") or {"enabled": False})
            addons_snapshot = _jsonify(defaults.get("addons") or [])
            packaging_snapshot = _jsonify(_normalize_packaging_snapshot(defaults.get("packaging_snapshot") or {}))
            if not geometry_snapshot or not isinstance(layer_snapshot, list):
                skipped.append({"material_id": material_id, "material_code": material.code, "reason": "packaging_defaults_json must include geometry and film_layers to auto-plan packaging stock."})
                continue

            template = material.production_template
            route_last = self._route_last_index(template)
            start_step_index = int(defaults.get("start_step_index", 0) or 0)
            stop_step_index = int(defaults.get("stop_step_index", route_last) or route_last)
            normalized_geometry = normalize_geometry_override({}, geometry_snapshot or {})
            preview = SalesOrderService.preview_sales_item(
                {
                    "finished_good_type": str(geometry_snapshot.get("finished_good_type") or template.fg_type or "POUCH").upper(),
                    "geometry": normalized_geometry,
                    "film_layers": layer_snapshot,
                    "printing": printing_snapshot,
                    "chemicals": (printing_snapshot or {}).get("chemicals") or {},
                    "addons": addons_snapshot,
                    "roll_form": geometry_snapshot.get("roll_form"),
                    "order_qty": float(shortage),
                    "uom": str(material.base_uom or requested_uom).upper(),
                }
            )
            spec_payload = build_spec_payload(
                fg_type=str(geometry_snapshot.get("finished_good_type") or template.fg_type or "POUCH").upper(),
                roll_form=geometry_snapshot.get("roll_form"),
                geometry=normalized_geometry,
                film_layers=layer_snapshot,
                printing=printing_snapshot,
                addons=addons_snapshot,
            )
            invariant_payload = build_invariant_payload(
                film_layers=layer_snapshot,
                printing=printing_snapshot,
            )
            try:
                with transaction.atomic():
                    order = PlannedStockOrder.objects.create(
                        internal_name=f"{material.name} Packaging Stock",
                        template=template,
                        plant=getattr(order_obj, "plant", None),
                        target_qty=shortage.quantize(Decimal("0.0001")),
                        quantity_uom=str(material.base_uom or requested_uom).upper(),
                        geometry_override=sanitize_geometry_override(normalized_geometry),
                        geometry_snapshot=normalized_geometry,
                        layer_snapshot=layer_snapshot,
                        printing_snapshot=printing_snapshot,
                        addons_snapshot=addons_snapshot,
                        packaging_snapshot=packaging_snapshot,
                        bom_snapshot=_jsonify(preview.get("bom") or {}),
                        spec_signature=build_spec_signature(spec_payload),
                        invariant_signature=build_invariant_signature(invariant_payload),
                        unit_weight_g=Decimal(str(preview.get("unit_weight_g") or 0)),
                        total_weight_kg=Decimal(str(preview.get("total_weight_kg") or 0)),
                        output_type="PACKAGING_STOCK",
                        stock_purpose="PACKAGING",
                        stock_strategy="PACKAGING_STOCK",
                        planner_stock_class="PACKAGING_STOCK",
                        packaging_material=material,
                        start_step_index=start_step_index,
                        stop_step_index=stop_step_index,
                        target_step_index=stop_step_index,
                        status="PLANNING_REQUIRED",
                        created_by=created_by,
                    )
                    self._prime_stock_order_for_release(order)
                created_orders.append(order)
            except Exception as exc:
                skipped.append({"material_id": material_id, "material_code": material.code, "reason": str(exc)})
        return created_orders, skipped, warnings

    def _order_job_queryset(self, order_kind: str, order_obj, *, sales_order_item=None):
        if order_kind == "sales":
            if sales_order_item is not None:
                return ProductionJob.objects.filter(sales_order_item=sales_order_item)
            return ProductionJob.objects.filter(sales_order_item__sales_order=order_obj)
        return ProductionJob.objects.filter(mts_order=order_obj)

    def _order_has_artwork_gate(self, order_kind: str, order_obj, *, sales_order_item=None) -> bool:
        if order_kind == "sales":
            items = [sales_order_item] if sales_order_item is not None else list(order_obj.items.all())
            for item in items:
                printing = item.printing_snapshot or {}
                if bool(printing.get("enabled", False)) and bool(item.artwork_assignment_required):
                    return True
            return False
        printing = order_obj.printing_snapshot or {}
        return bool(printing.get("enabled", False)) and bool(order_obj.artwork_assignment_required)

    def _pending_sales_print_items(self, sales_order):
        rows = []
        for item in sales_order.items.all():
            printing = item.printing_snapshot or {}
            if bool(printing.get("enabled", False)) and bool(item.artwork_assignment_required):
                rows.append(item)
        return rows

    def _pending_sales_print_items_payload(self, sales_order, pending_items=None):
        rows = pending_items if pending_items is not None else self._pending_sales_print_items(sales_order)
        payload = []
        from apps.artwork.compatibility import product_master_print_context

        for item in rows:
            printing = item.printing_snapshot or {}
            line_name = str(getattr(item, "line_name", "") or "").strip()
            template_name = str(getattr(getattr(item, "template", None), "name", "") or "").strip()
            axis_values = item.axis_values if isinstance(item.axis_values, dict) else {}
            product_master = getattr(item, "product_master", None)
            context = {}
            if product_master is not None:
                try:
                    context = product_master_print_context(product_master, axis_values=axis_values)
                except Exception:
                    context = {}
            print_type = str(
                context.get("print_type")
                or printing.get("print_type")
                or printing.get("type")
                or printing.get("method")
                or ""
            ).upper()
            substrate_mode = str(
                context.get("substrate_mode")
                or printing.get("substrate_mode")
                or printing.get("film_type")
                or ""
            ).upper()
            payload.append(
                {
                    "id": str(item.id),
                    "label": line_name or template_name or f"Item {str(item.id)[:8]}",
                    "line_name": line_name,
                    "template_name": template_name,
                    "product_master_id": str(getattr(item, "product_master_id", "") or "") or None,
                    "product_master_code": str(getattr(product_master, "code", "") or "") or None,
                    "axis_values": axis_values,
                    "print_type": print_type,
                    "substrate_mode": substrate_mode,
                    "front_colors_count": int(printing.get("front_colors_count") or 0),
                    "back_colors_count": int(printing.get("back_colors_count") or 0),
                    "ink_base_family": str(printing.get("ink_base_family") or "").upper(),
                    "artwork_id": str(printing.get("artwork_id") or "") or None,
                }
            )
        return payload

    def _apply_artwork_to_sales_item(self, item, artwork):
        printing = dict(item.printing_snapshot or {})
        printing["artwork_id"] = str(artwork.id)
        item.printing_snapshot = printing
        validated_printing, artwork_required, assigned_artwork_id = _validate_printing_snapshot_for_confirm(
            item,
            allow_missing_artwork=False,
        )
        if artwork_required:
            raise ValueError("Artwork assignment is still incomplete after validation.")
        item.printing_snapshot = validated_printing
        item.artwork_assignment_required = False
        item.assigned_artwork_id = assigned_artwork_id

        fg_type = str(
            (item.geometry_snapshot or {}).get("finished_good_type")
            or (item.geometry_snapshot or {}).get("fg_type")
            or item.template.fg_type
            or "POUCH"
        ).upper()
        preview = SalesOrderService.preview_sales_item(
            {
                "finished_good_type": fg_type,
                "geometry": item.geometry_snapshot or {},
                "film_layers": item.layer_snapshot or [],
                "printing": item.printing_snapshot or {},
                "chemicals": (item.printing_snapshot or {}).get("chemicals") or {},
                "addons": item.addons_snapshot or [],
                "roll_form": (item.geometry_snapshot or {}).get("roll_form"),
                "order_qty": float(item.qty_value or 0),
                "uom": item.qty_uom,
            }
        )

        item.bom_snapshot = _jsonify(preview.get("bom") or {})
        item.unit_weight_g = Decimal(str(preview.get("unit_weight_g") or 0))
        item.total_weight_kg = Decimal(str(preview.get("total_weight_kg") or 0))
        item.save(
            update_fields=[
                "printing_snapshot",
                "artwork_assignment_required",
                "assigned_artwork",
                "bom_snapshot",
                "unit_weight_g",
                "total_weight_kg",
            ]
        )
        return item

    def _apply_artwork_to_stock_order(self, stock_order, artwork):
        printing = dict(stock_order.printing_snapshot or {})
        if not bool(printing.get("enabled", False)):
            raise ValueError("Stock order printing is disabled; artwork assignment not required.")

        class _StockOrderItem:
            template = None
            layer_snapshot = None
            printing_snapshot = None

        validator_item = _StockOrderItem()
        validator_item.template = stock_order.template
        validator_item.layer_snapshot = stock_order.layer_snapshot or []
        printing["artwork_id"] = str(artwork.id)
        validator_item.printing_snapshot = printing

        validated_printing, artwork_required, assigned_artwork_id = _validate_printing_snapshot_for_confirm(
            validator_item,
            allow_missing_artwork=False,
        )
        if artwork_required:
            raise ValueError("Artwork assignment is still incomplete after validation.")

        fg_type = str(
            (stock_order.geometry_snapshot or {}).get("finished_good_type")
            or (stock_order.geometry_snapshot or {}).get("fg_type")
            or stock_order.template.fg_type
            or "POUCH"
        ).upper()
        preview = SalesOrderService.preview_sales_item(
            {
                "finished_good_type": fg_type,
                "geometry": stock_order.geometry_snapshot or {},
                "film_layers": stock_order.layer_snapshot or [],
                "printing": validated_printing,
                "chemicals": validated_printing.get("chemicals") or {},
                "addons": stock_order.addons_snapshot or [],
                "roll_form": (stock_order.geometry_snapshot or {}).get("roll_form"),
                "order_qty": float(stock_order.target_qty or 0),
                "uom": "KG",
            }
        )

        stock_order.printing_snapshot = validated_printing
        stock_order.artwork_assignment_required = False
        stock_order.assigned_artwork_id = assigned_artwork_id
        stock_order.bom_snapshot = _jsonify(preview.get("bom") or {})
        stock_order.unit_weight_g = Decimal(str(preview.get("unit_weight_g") or 0))
        stock_order.total_weight_kg = Decimal(str(preview.get("total_weight_kg") or stock_order.target_qty or 0))
        stock_order.save(
            update_fields=[
                "printing_snapshot",
                "artwork_assignment_required",
                "assigned_artwork",
                "bom_snapshot",
                "unit_weight_g",
                "total_weight_kg",
                "updated_at",
            ]
        )
        return stock_order

    def _validate_order_printing_for_release(self, order_kind: str, order_obj, *, sales_order_item=None):
        if order_kind == "sales":
            items = [sales_order_item] if sales_order_item is not None else list(order_obj.items.all())
            for item in items:
                printing = item.printing_snapshot or {}
                if bool(printing.get("enabled", False)):
                    _validate_printing_snapshot_for_confirm(item, allow_missing_artwork=False)
            return

        printing = order_obj.printing_snapshot or {}
        if not bool(printing.get("enabled", False)):
            return

        class _StockOrderItem:
            template = None
            layer_snapshot = None
            printing_snapshot = None

        validator_item = _StockOrderItem()
        validator_item.template = order_obj.template
        validator_item.layer_snapshot = order_obj.layer_snapshot or []
        validator_item.printing_snapshot = printing
        _validate_printing_snapshot_for_confirm(validator_item, allow_missing_artwork=False)

    def _create_inventory_allocations(
        self,
        *,
        order_kind,
        order_obj,
        template,
        route_last,
        start_step,
        option,
        allocation_rows,
        created_by,
        sales_item_override=None,
    ):
        if option in {"FG", "WIP_CONTINUE"} and not allocation_rows:
            raise ValueError("allocations are required for FG/WIP_CONTINUE")

        if order_kind == "sales":
            so_item = sales_item_override or self._sales_item_for_template(order_obj, template)
            order_geometry_snapshot = so_item.geometry_snapshot if so_item else {}
            order_layer_snapshot = so_item.layer_snapshot if so_item else []
            order_printing_snapshot = so_item.printing_snapshot if so_item else {}
            order_addons_snapshot = so_item.addons_snapshot if so_item else []
            order_signature = getattr(so_item, "spec_signature", "") if so_item else ""
        else:
            order_geometry_snapshot = getattr(order_obj, "geometry_snapshot", {}) or {}
            order_layer_snapshot = getattr(order_obj, "layer_snapshot", []) or []
            order_printing_snapshot = getattr(order_obj, "printing_snapshot", {}) or {}
            order_addons_snapshot = getattr(order_obj, "addons_snapshot", []) or []
            order_signature = getattr(order_obj, "spec_signature", "")
        order_sig = self._order_signature(
            spec_signature=order_signature,
            geometry_snapshot=order_geometry_snapshot,
            geometry_override=order_obj.geometry_override,
            layer_snapshot=order_layer_snapshot,
            printing_snapshot=order_printing_snapshot,
            addons_snapshot=order_addons_snapshot,
            template=template,
        )
        inv_sig = getattr(so_item if order_kind == "sales" else order_obj, "invariant_signature", "")
        order_inv_sig = self._order_invariant_signature(
            invariant_signature=inv_sig,
            layer_snapshot=order_layer_snapshot,
            printing_snapshot=order_printing_snapshot,
        )
        roll_alloc_map, fg_alloc_map = self._inventory_active_allocation_maps()
        local_consumption = {}
        created = []
        required_route_id = getattr(template, "routing_rule_id", None)

        for row in allocation_rows:
            inv_type = str(row.get("inventory_type") or row.get("kind") or "").upper()
            inv_id = row.get("inventory_id") or row.get("id")
            if not inv_type or not inv_id:
                raise ValueError("Each allocation requires inventory_type and inventory_id")

            try:
                qty = Decimal(str(row.get("allocated_qty_kg") or row.get("qty") or 0))
            except Exception:
                raise ValueError("allocated_qty_kg must be numeric")
            if qty <= 0:
                raise ValueError("allocated_qty_kg must be > 0")

            if inv_type == "ROLL":
                roll_qs = InventoryRoll.objects.select_related("template", "sales_order_item").filter(
                    id=inv_id,
                    status="AVAILABLE",
                )
                if option == "WIP_CONTINUE" and int(start_step or 0) == 0:
                    first_layer_material_id = None
                    if (
                        isinstance(order_layer_snapshot, list)
                        and order_layer_snapshot
                        and isinstance(order_layer_snapshot[0], dict)
                    ):
                        first_layer_material_id = (
                            order_layer_snapshot[0].get("material_id")
                            or order_layer_snapshot[0].get("variant_id")
                        )
                    if first_layer_material_id:
                        roll_qs = roll_qs.filter(
                            Q(template=template)
                            | Q(template__isnull=True, material_id=first_layer_material_id)
                        )
                    else:
                        roll_qs = roll_qs.filter(template=template)
                else:
                    roll_qs = roll_qs.filter(template=template)

                try:
                    roll = roll_qs.get()
                except ObjectDoesNotExist:
                    raise ValueError("Selected roll is not available for this template/order.")
                roll_route_id = getattr(getattr(roll, "template", None), "routing_rule_id", None)
                if required_route_id and roll.template_id and roll_route_id != required_route_id:
                    raise ValueError(f"Roll {roll.label_id} routing lineage does not match order route.")
                completed = int(roll.completed_step_index or 0)
                if option == "FG":
                    if completed != route_last:
                        raise ValueError(f"Roll {roll.label_id} is not at final route step")
                    if self._roll_signature(roll) != order_sig:
                        raise ValueError(f"Roll {roll.label_id} full signature does not match order.")
                elif option == "WIP_CONTINUE":
                    if completed < start_step:
                        raise ValueError(f"Roll {roll.label_id} completed step is below requested start step")
                    if int(start_step or 0) == 0 and completed == 0 and not self._route_step_accepts_roll_input(template, 0):
                        raise ValueError(self._upstream_stock_start_blocker(template, 0))
                    
                    if start_step == 0 and completed == 0:
                        pass
                    elif self._roll_invariant_signature(roll) != order_inv_sig:
                        raise ValueError(f"Roll {roll.label_id} invariant signature does not match order.")
                else:
                    if self._roll_signature(roll) != order_sig:
                        raise ValueError(f"Roll {roll.label_id} geometry does not match order geometry")

                physical = Decimal(str(roll.weight_kg or 0))
                allocated = roll_alloc_map.get(str(roll.id), Decimal("0"))
                consumed_here = local_consumption.get(("ROLL", str(roll.id)), Decimal("0"))
                allocatable = physical - allocated - consumed_here
                if qty > allocatable:
                    raise ValueError(
                        f"Insufficient allocatable quantity on roll {roll.label_id}. Requested {qty}, available {allocatable}."
                    )
                local_consumption[("ROLL", str(roll.id))] = consumed_here + qty
                source_stock_order = self._origin_stock_order_for_roll(roll)
                if order_kind == "sales" and so_item and source_stock_order and not self._stock_commitment_matches_sales_item(source_stock_order, so_item):
                    raise ValueError(self._stock_commitment_mismatch_message(source_stock_order, so_item, f"Roll {roll.label_id}"))

                allocation = InventoryAllocation.objects.create(
                    sales_order=order_obj if order_kind == "sales" else None,
                    mts_order=source_stock_order if order_kind == "sales" else order_obj if order_kind == "stock" else None,
                    inventory_roll=roll,
                    allocated_qty_kg=qty,
                    status="ACTIVE",
                    created_by=created_by,
                )
                created.append(allocation)

                if order_kind == "sales" and so_item:
                    if roll.sales_order_item_id and str(roll.sales_order_item_id) != str(so_item.id):
                        raise ValueError(f"Roll {roll.label_id} is already linked to another sales order.")
                    roll.sales_order_item = so_item
                    roll.meta_json = self._append_claim_history(
                        roll.meta_json,
                        sales_item=so_item,
                        stock_order=source_stock_order,
                        qty_kg=qty,
                        inventory_type="ROLL",
                    )
                    roll.save(update_fields=["sales_order_item", "meta_json"])
                continue

            if inv_type in {"FG_BATCH", "FG"}:
                try:
                    batch = FinishedGoodsBatch.objects.select_related("template", "sales_order_item").get(
                        id=inv_id, template=template, status="AVAILABLE"
                    )
                except ObjectDoesNotExist:
                    raise ValueError("Selected FG batch is not available for this template/order.")
                batch_route_id = getattr(getattr(batch, "template", None), "routing_rule_id", None)
                if required_route_id and batch_route_id != required_route_id:
                    raise ValueError(f"FG batch {batch.batch_number} routing lineage does not match order route.")
                completed = int(batch.completed_step_index or 0)
                if option == "FG":
                    if completed != route_last:
                        raise ValueError(f"FG batch {batch.batch_number} is not at final route step")
                    if self._fg_signature(batch) != order_sig:
                        raise ValueError(f"FG batch {batch.batch_number} full signature does not match order.")
                elif option == "WIP_CONTINUE":
                    if completed < start_step:
                        raise ValueError(
                            f"FG batch {batch.batch_number} completed step is below requested start step"
                        )
                    if self._fg_invariant_signature(batch) != order_inv_sig:
                        raise ValueError(f"FG batch {batch.batch_number} invariant signature does not match order.")
                else:
                    if self._fg_signature(batch) != order_sig:
                        raise ValueError(f"FG batch {batch.batch_number} geometry does not match order geometry")

                physical = Decimal(str(batch.qty_kg or 0))
                allocated = fg_alloc_map.get(str(batch.id), Decimal("0"))
                consumed_here = local_consumption.get(("FG_BATCH", str(batch.id)), Decimal("0"))
                allocatable = physical - allocated - consumed_here
                if qty > allocatable:
                    raise ValueError(
                        f"Insufficient allocatable quantity on FG batch {batch.batch_number}. Requested {qty}, available {allocatable}."
                    )
                local_consumption[("FG_BATCH", str(batch.id))] = consumed_here + qty
                source_stock_order = self._origin_stock_order_for_batch(batch)
                if order_kind == "sales" and so_item and source_stock_order and not self._stock_commitment_matches_sales_item(source_stock_order, so_item):
                    raise ValueError(self._stock_commitment_mismatch_message(source_stock_order, so_item, f"FG batch {batch.batch_number}"))

                allocation = InventoryAllocation.objects.create(
                    sales_order=order_obj if order_kind == "sales" else None,
                    mts_order=source_stock_order if order_kind == "sales" else order_obj if order_kind == "stock" else None,
                    fg_batch=batch,
                    allocated_qty_kg=qty,
                    status="ACTIVE",
                    created_by=created_by,
                )
                created.append(allocation)

                if order_kind == "sales" and so_item:
                    if batch.sales_order_item_id and str(batch.sales_order_item_id) != str(so_item.id):
                        raise ValueError(f"FG batch {batch.batch_number} is already linked to another sales order.")
                    batch.sales_order_item = so_item
                    batch.meta_json = self._append_claim_history(
                        batch.meta_json,
                        sales_item=so_item,
                        stock_order=source_stock_order,
                        qty_kg=qty,
                        inventory_type="FG_BATCH",
                    )
                    batch.save(update_fields=["sales_order_item", "meta_json"])
                continue

            raise ValueError(f"Unsupported inventory_type: {inv_type}")

        return created

    def _derive_wip_allocation_resume_points(self, allocation_rows, route_last: int):
        completed_steps = []
        for row in allocation_rows or []:
            inv_type = str(row.get("inventory_type") or row.get("kind") or "").upper()
            inv_id = row.get("inventory_id") or row.get("id")
            if not inv_type or not inv_id:
                continue
            source_bucket = str(row.get("source_bucket") or "").upper()
            match_mode = str(row.get("signature_match_mode") or row.get("match_mode") or "").upper()
            if source_bucket == "COMPATIBLE_UPSTREAM_ROLL_STOCK" or match_mode == "STEP0_RAW":
                continue

            if inv_type == "ROLL":
                roll = InventoryRoll.objects.filter(id=inv_id).only("completed_step_index").first()
                if roll is not None:
                    completed_steps.append(int(roll.completed_step_index or 0))
                continue

            if inv_type in {"FG_BATCH", "FG"}:
                batch = FinishedGoodsBatch.objects.filter(id=inv_id).only("completed_step_index").first()
                if batch is not None:
                    completed_steps.append(int(batch.completed_step_index or 0))

        if not completed_steps:
            return None, None

        validation_step = max(completed_steps)
        return validation_step, min(route_last, validation_step + 1)

    def _allocation_total_qty_kg(self, allocation_rows) -> Decimal:
        total = Decimal("0")
        for row in allocation_rows or []:
            if not isinstance(row, dict):
                continue
            try:
                qty = Decimal(str(row.get("allocated_qty_kg") or row.get("qty") or 0))
            except Exception:
                continue
            if qty > 0:
                total += qty
        return total.quantize(Decimal("0.0001"))

    def _work_center_overrides_from_payload(self, payload):
        raw_rows = []
        if isinstance(payload, dict):
            raw_rows = (
                payload.get("work_center_overrides")
                or payload.get("route_work_center_overrides")
                or []
            )
        if isinstance(raw_rows, dict):
            raw_rows = [{"step_index": key, "work_center_id": value} for key, value in raw_rows.items()]
        overrides = []
        for row in raw_rows if isinstance(raw_rows, list) else []:
            if not isinstance(row, dict):
                continue
            try:
                step_index = int(row.get("step_index"))
            except Exception:
                continue
            work_center_id = str(row.get("work_center_id") or row.get("work_center") or "").strip()
            if work_center_id:
                overrides.append({"step_index": step_index, "work_center_id": work_center_id})
        return overrides

    @action(
        detail=False,
        methods=["post"],
        url_path=r"control-hub/(?P<order_kind>sales|stock)/(?P<order_id>[^/.]+)/plan",
    )
    def control_hub_plan(self, request, order_kind=None, order_id=None):
        option = str(request.data.get("option") or "").upper()
        valid_options = {"FG", "WIP_CONTINUE", "SHARED_INVARIANT", "UPSTREAM_STOCK", "POD_BULK", "PACKAGING_STOCK", "FRESH"}
        if option not in valid_options:
            return Response({"error": "option must be FG, WIP_CONTINUE, SHARED_INVARIANT, UPSTREAM_STOCK, POD_BULK, PACKAGING_STOCK, or FRESH"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            order_kind, order_obj, template, route_last = self._get_order_for_kind(order_kind, order_id)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        sales_item_id = request.data.get("item_id") or request.data.get("sales_order_item_id")
        target_sales_item = None
        if order_kind == "sales":
            try:
                target_sales_item = self._resolve_sales_control_item(order_obj, sales_item_id, required=True)
                template = target_sales_item.template
                route_last = self._route_last_index(template)
            except Exception as exc:
                return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        if option == "POD_BULK":
            created_orders, skipped = self._create_pod_bulk_orders(
                order_kind=order_kind,
                order_obj=order_obj,
                created_by=request.user if request.user.is_authenticated else None,
            )
            return Response(
                {
                    "status": "replenishment_created",
                    "option": "POD_BULK",
                    "created_count": len(created_orders),
                    "created_orders": [
                        {
                            "order_id": str(order.id),
                            "order_number": order.order_number,
                            "bulk_class": order.bulk_class,
                            "material_id": str(order.material_id),
                            "material_code": str(order.material.code),
                            "target_qty_kg": float(order.target_qty_kg),
                        }
                        for order in created_orders
                    ],
                    "skipped": skipped,
                },
                status=status.HTTP_201_CREATED if created_orders else status.HTTP_200_OK,
            )

        if option == "PACKAGING_STOCK" and not (
            order_kind == "stock" and str(getattr(order_obj, "stock_purpose", "PRODUCT") or "PRODUCT").upper() == "PACKAGING"
        ):
            created_orders, skipped, warnings = self._create_packaging_stock_orders(
                order_kind=order_kind,
                order_obj=order_obj,
                created_by=request.user if request.user.is_authenticated else None,
            )
            return Response(
                {
                    "status": "replenishment_created",
                    "option": "PACKAGING_STOCK",
                    "created_count": len(created_orders),
                    "created_orders": [
                        {
                            "order_id": str(order.id),
                            "order_number": order.order_number,
                            "planner_stock_class": order.planner_stock_class,
                            "packaging_material_id": str(order.packaging_material_id),
                            "packaging_material_code": str(order.packaging_material.code),
                            "target_qty": float(order.target_qty),
                            "quantity_uom": order.quantity_uom,
                        }
                        for order in created_orders
                    ],
                    "skipped": skipped,
                    "warnings": warnings,
                },
                status=status.HTTP_201_CREATED if created_orders else status.HTTP_200_OK,
            )

        if option == "PACKAGING_STOCK":
            option_semantic = "FRESH"
        elif option in {"UPSTREAM_STOCK", "SHARED_INVARIANT"}:
            option_semantic = "WIP_CONTINUE"
        else:
            option_semantic = option

        if order_obj.status != "PLANNING_REQUIRED":
            return Response(
                {"error": f"Order must be PLANNING_REQUIRED. Current status: {order_obj.status}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        partial_replan_required = False
        partial_remaining_kg = Decimal("0")
        if order_kind == "sales":
            partial_metrics = self._sales_item_partial_metrics(target_sales_item, route_last)
            partial_replan_required = bool(partial_metrics.get("requires_replan"))
            partial_remaining_kg = Decimal(str(partial_metrics.get("shortfall_kg") or 0))

        if partial_replan_required and option_semantic == "FG":
            return Response(
                {"error": "Order has >5% production shortfall. Use WIP_CONTINUE/FRESH for remaining run, or planner short-close."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        existing_jobs = self._order_job_queryset(
            order_kind,
            order_obj,
            sales_order_item=target_sales_item,
        ).exclude(job_state="CANCELLED")
        active_existing_jobs = existing_jobs.exclude(job_state__in=["COMPLETED", "CANCELLED"])
        if active_existing_jobs.exists() and option_semantic in {"WIP_CONTINUE", "FRESH"}:
            return Response({"error": "Production jobs already exist for this order."}, status=status.HTTP_400_BAD_REQUEST)

        start_step = request.data.get("start_step_index")
        stop_step = request.data.get("stop_step_index")
        work_center_overrides = self._work_center_overrides_from_payload(request.data)
        plan_remaining_fresh_now = bool(request.data.get("plan_remaining_fresh_now"))

        if option_semantic == "FG":
            start_step = route_last
            stop_step = route_last
        elif option_semantic == "FRESH":
            if start_step is None and order_kind == "sales" and target_sales_item is not None:
                start_step = self._sales_required_start_step(
                    target_sales_item.template,
                    target_sales_item.layer_snapshot or [],
                )
            else:
                start_step = 0 if start_step is None else start_step
            stop_step = route_last if stop_step is None else stop_step
        else:  # WIP_CONTINUE
            if start_step is None:
                start_step = order_obj.start_step_index if order_kind == "stock" else 0
            stop_step = route_last if stop_step is None else stop_step

        try:
            start_step = int(start_step)
            stop_step = int(stop_step)
        except Exception:
            return Response({"error": "start_step_index/stop_step_index must be integers"}, status=status.HTTP_400_BAD_REQUEST)

        if start_step < 0 or stop_step < start_step or stop_step > route_last:
            return Response(
                {"error": f"Invalid step range. Expected 0 <= start <= stop <= {route_last}"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if option == "UPSTREAM_STOCK":
            upstream_start_blocker = self._upstream_stock_start_blocker(template, start_step)
            if upstream_start_blocker:
                return Response({"error": upstream_start_blocker}, status=status.HTTP_400_BAD_REQUEST)

        allocation_rows = request.data.get("allocations") or []
        allocation_validation_step = start_step
        job_start_step = start_step
        selected_continuation_qty_kg = Decimal("0")
        executable_continuation_qty_kg = Decimal("0")
        continuation_target_cap_kg = Decimal("0")
        fresh_balance_qty_kg = Decimal("0")
        if option_semantic == "WIP_CONTINUE" and option != "UPSTREAM_STOCK":
            selected_continuation_qty_kg = self._allocation_total_qty_kg(allocation_rows)
            derived_validation_step, derived_job_start = self._derive_wip_allocation_resume_points(
                allocation_rows=allocation_rows,
                route_last=route_last,
            )
            if derived_validation_step is not None:
                allocation_validation_step = derived_validation_step
            if derived_job_start is not None:
                job_start_step = derived_job_start

        if selected_continuation_qty_kg > 0:
            if order_kind == "sales":
                continuation_target_cap_kg = (
                    partial_remaining_kg
                    if partial_replan_required and partial_remaining_kg > 0
                    else Decimal(str(getattr(target_sales_item, "total_weight_kg", 0) or 0))
                )
            else:
                continuation_target_cap_kg = Decimal(str(getattr(order_obj, "target_qty", 0) or 0))
            executable_continuation_qty_kg = (
                min(selected_continuation_qty_kg, continuation_target_cap_kg)
                if continuation_target_cap_kg > 0
                else selected_continuation_qty_kg
            )

        try:
            with transaction.atomic():
                created_allocations = []
                if option_semantic in {"FG", "WIP_CONTINUE"}:
                    created_allocations = self._create_inventory_allocations(
                        order_kind=order_kind,
                        order_obj=order_obj,
                        template=template,
                        route_last=route_last,
                        start_step=allocation_validation_step,
                        option=option_semantic,
                        allocation_rows=allocation_rows,
                        created_by=request.user if request.user.is_authenticated else None,
                        sales_item_override=target_sales_item,
                    )
                elif allocation_rows:
                    return Response(
                        {"error": "FRESH planning does not take allocations."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                jobs_created = []
                if option_semantic in {"WIP_CONTINUE", "FRESH"}:
                    if order_kind == "sales":
                        for item in [target_sales_item]:
                            if not item.template or not item.template.routing_rule:
                                raise ValueError("Sales order item has missing template routing.")
                            route_adjusted_layers = self._roll_input_purchase_layer_snapshot(
                                item.template,
                                item.layer_snapshot or [],
                                job_start_step,
                            )
                            if route_adjusted_layers is not item.layer_snapshot and route_adjusted_layers != (item.layer_snapshot or []):
                                item.layer_snapshot = route_adjusted_layers
                                item.save(update_fields=["layer_snapshot"])
                            SalesOrderService.rebuild_bom_snapshot_for_item(item, require_ready=True)
                            qty_override = None
                            qty_uom_override = None
                            planner_note = None
                            if partial_replan_required:
                                item_route_last = self._route_last_index(item.template)
                                item_partial = self._sales_item_partial_metrics(item, item_route_last)
                                item_shortfall_kg = Decimal(str(item_partial.get("shortfall_kg") or 0))
                                if item_shortfall_kg <= 0:
                                    continue
                                qty_override = item_shortfall_kg
                                qty_uom_override = "KG"
                                planner_note = (
                                    f"PARTIAL_REPLAN remaining_kg={item_shortfall_kg.quantize(Decimal('0.0001'))}"
                                )
                            if selected_continuation_qty_kg > 0:
                                line_target_kg = (
                                    partial_remaining_kg
                                    if partial_replan_required and partial_remaining_kg > 0
                                    else Decimal(str(getattr(item, "total_weight_kg", 0) or 0))
                                )
                                execution_qty = (
                                    min(selected_continuation_qty_kg, line_target_kg)
                                    if line_target_kg > 0
                                    else selected_continuation_qty_kg
                                )
                                remaining_after_run = max(Decimal("0"), line_target_kg - execution_qty)
                                expected_return_kg = max(Decimal("0"), selected_continuation_qty_kg - execution_qty)
                                qty_override = execution_qty
                                qty_uom_override = "KG"
                                planner_note = (
                                    f"WIP_CONTINUE selected_kg={selected_continuation_qty_kg.quantize(Decimal('0.0001'))} "
                                    f"execute_kg={execution_qty.quantize(Decimal('0.0001'))} "
                                    f"expected_return_kg={expected_return_kg.quantize(Decimal('0.0001'))} "
                                    f"remaining_after_run_kg={remaining_after_run.quantize(Decimal('0.0001'))}"
                                )
                                fresh_balance_qty_kg = remaining_after_run if plan_remaining_fresh_now else Decimal("0")
                            jobs_created.extend(
                                JobService.create_jobs_for_so_item(
                                    item,
                                    start_index=job_start_step,
                                    stop_index=stop_step,
                                    quantity_override=qty_override,
                                    quantity_uom_override=qty_uom_override,
                                    planner_note_prefix=planner_note,
                                    work_center_overrides=work_center_overrides,
                                )
                            )
                            if fresh_balance_qty_kg > 0:
                                fresh_start_step = self._sales_required_start_step(
                                    item.template,
                                    item.layer_snapshot or [],
                                )
                                fresh_layers = self._roll_input_purchase_layer_snapshot(
                                    item.template,
                                    item.layer_snapshot or [],
                                    fresh_start_step,
                                )
                                if fresh_layers is not item.layer_snapshot and fresh_layers != (item.layer_snapshot or []):
                                    item.layer_snapshot = fresh_layers
                                    item.save(update_fields=["layer_snapshot"])
                                    SalesOrderService.rebuild_bom_snapshot_for_item(item, require_ready=True)
                                jobs_created.extend(
                                    JobService.create_jobs_for_so_item(
                                        item,
                                        start_index=fresh_start_step,
                                        stop_index=stop_step,
                                        quantity_override=fresh_balance_qty_kg,
                                        quantity_uom_override="KG",
                                        planner_note_prefix=(
                                            f"FRESH_BALANCE_FOR_WIP selected_wip_kg={executable_continuation_qty_kg.quantize(Decimal('0.0001'))} "
                                            f"fresh_balance_kg={fresh_balance_qty_kg.quantize(Decimal('0.0001'))}"
                                        ),
                                        work_center_overrides=work_center_overrides,
                                    )
                                )
                            item.line_status = "PLANNED"
                            item.save(update_fields=["line_status"])
                        if partial_replan_required and not jobs_created and partial_remaining_kg > 0:
                            raise ValueError("No remaining shortfall quantity found to re-release.")
                        order_obj = self._sync_sales_parent_after_planner_action(order_obj)
                    else:
                        order_obj.start_step_index = start_step
                        order_obj.stop_step_index = stop_step
                        order_obj.target_step_index = stop_step
                        jobs_created = JobService.create_jobs_for_planned_order(
                            order_obj,
                            start_index=job_start_step,
                            stop_index=stop_step,
                            quantity_kg=selected_continuation_qty_kg if selected_continuation_qty_kg > 0 else None,
                            work_center_overrides=work_center_overrides,
                        )
                        order_obj.status = "PLANNED"
                        order_obj.save(
                            update_fields=[
                                "status",
                                "start_step_index",
                                "stop_step_index",
                                "target_step_index",
                                "updated_at",
                            ]
                        )
                else:
                    if order_kind == "sales":
                        target_sales_item.line_status = "PACKING_READY"
                        target_sales_item.save(update_fields=["line_status"])
                        order_obj = self._sync_sales_parent_after_planner_action(order_obj)
                    else:
                        order_obj.status = "STOCK_READY"
                        order_obj.save(update_fields=["status", "updated_at"])

            return Response(
                {
                    "status": "planned",
                    "order_kind": order_kind,
                    "order_id": str(order_obj.id),
                    "order_status": order_obj.status,
                    "option": option,
                    "jobs_created": len(jobs_created),
                    "allocations_created": len(created_allocations),
                    "selected_qty_kg": float(selected_continuation_qty_kg) if selected_continuation_qty_kg > 0 else None,
                    "execution_qty_kg": float(executable_continuation_qty_kg) if executable_continuation_qty_kg > 0 else None,
                    "expected_return_qty_kg": float(max(Decimal("0"), selected_continuation_qty_kg - executable_continuation_qty_kg)) if selected_continuation_qty_kg > 0 else None,
                    "fresh_balance_qty_kg": float(fresh_balance_qty_kg) if fresh_balance_qty_kg > 0 else None,
                    "work_center_overrides": work_center_overrides,
                }
            )
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(
        detail=False,
        methods=["post"],
        url_path=r"control-hub/(?P<order_kind>sales|stock)/(?P<order_id>[^/.]+)/short-close",
    )
    def control_hub_short_close(self, request, order_kind=None, order_id=None):
        reason = str(request.data.get("reason") or "").strip()
        if not reason:
            return Response({"error": "reason is required for short-close."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            order_kind, order_obj, template, route_last = self._get_order_for_kind(order_kind, order_id)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        target_sales_item = None
        if order_kind == "sales":
            try:
                target_sales_item = self._resolve_sales_control_item(
                    order_obj,
                    request.data.get("item_id") or request.data.get("sales_order_item_id"),
                    required=True,
                )
                template = target_sales_item.template
                route_last = self._route_last_index(template)
            except Exception as exc:
                return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        if order_obj.status != "PLANNING_REQUIRED" and order_kind != "sales":
            return Response(
                {"error": f"Order must be PLANNING_REQUIRED to short-close. Current: {order_obj.status}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            with transaction.atomic():
                if order_kind == "sales":
                    metrics = self._sales_item_partial_metrics(target_sales_item, route_last)
                    close_qty_kg = Decimal(str(metrics.get("shortfall_kg") or 0)) if metrics.get("requires_replan") else None
                    order_obj = SalesOrderService.planner_short_close_sales_order_item(
                        target_sales_item.id,
                        user=request.user if request.user.is_authenticated else None,
                        reason=reason,
                        close_qty_kg=close_qty_kg,
                    )

                    final_job = (
                        ProductionJob.objects.filter(
                            sales_order_item=target_sales_item,
                            current_step_index=route_last,
                            job_state="COMPLETED",
                        )
                        .order_by("-closed_at", "-updated_at")
                        .first()
                    )
                    if final_job:
                        short_note = f"Planner short-close: {reason}"
                        existing = str(final_job.completion_force_reason or "").strip()
                        final_job.completion_force_reason = (
                            f"{existing} | {short_note}" if existing else short_note
                        )
                        final_job.save(update_fields=["completion_force_reason", "updated_at"])

                    return Response(
                        {
                            "status": "short_closed",
                            "order_kind": "sales",
                            "order_id": str(order_obj.id),
                            "sales_order_item_id": str(target_sales_item.id),
                            "order_status": order_obj.status,
                            "shortfall_kg": float(metrics.get("shortfall_kg") or 0),
                            "shortfall_pct": float(metrics.get("shortfall_pct") or 0),
                        }
                    )

                order_obj.status = "STOCK_READY"
                order_obj.save(update_fields=["status", "updated_at"])
                return Response(
                    {
                        "status": "short_closed",
                        "order_kind": "stock",
                        "order_id": str(order_obj.id),
                        "order_status": order_obj.status,
                    }
                )
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(
        detail=False,
        methods=["post"],
        url_path=r"control-hub/(?P<order_kind>sales|stock)/(?P<order_id>[^/.]+)/cancel",
    )
    def control_hub_cancel(self, request, order_kind=None, order_id=None):
        reason = str(request.data.get("reason") or "").strip()
        if not reason:
            return Response({"error": "reason is required for cancel."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            order_kind, order_obj, _template, _route_last = self._get_order_for_kind(order_kind, order_id)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        if order_kind != "sales":
            return Response(
                {"error": "Stock order cancel from Control Hub is not enabled here. Use the stock order lifecycle action."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            target_sales_item = self._resolve_sales_control_item(
                order_obj,
                request.data.get("item_id") or request.data.get("sales_order_item_id"),
                required=True,
            )
            order_obj = SalesOrderService.planner_cancel_sales_order_item(
                target_sales_item.id,
                user=request.user if request.user.is_authenticated else None,
                reason=reason,
            )
            return Response(
                {
                    "status": "cancelled",
                    "order_kind": "sales",
                    "order_id": str(order_obj.id),
                    "sales_order_item_id": str(target_sales_item.id),
                    "order_status": order_obj.status,
                }
            )
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(
        detail=False,
        methods=["post"],
        url_path=r"control-hub/(?P<order_kind>sales|stock)/(?P<order_id>[^/.]+)/assign-artwork",
    )
    def control_hub_assign_artwork(self, request, order_kind=None, order_id=None):
        artwork_id = str(request.data.get("artwork_id") or "").strip()
        if not artwork_id:
            return Response({"error": "artwork_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            artwork = Artwork.objects.get(id=artwork_id)
        except Artwork.DoesNotExist:
            return Response({"error": "Invalid artwork_id."}, status=status.HTTP_400_BAD_REQUEST)

        if artwork.status != "APPROVED":
            return Response({"error": "Artwork must be APPROVED before assignment."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            order_kind, order_obj, _template, _route_last = self._get_order_for_kind(order_kind, order_id)
        except Exception as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                if order_kind == "sales":
                    pending_items = self._pending_sales_print_items(order_obj)
                    pending_item_ids = {str(item.id) for item in pending_items}
                    item_id = str(request.data.get("item_id") or "").strip()
                    target_item = None
                    if item_id:
                        target_item = next((row for row in order_obj.items.all() if str(row.id) == item_id), None)
                        if not target_item:
                            raise ValueError("item_id does not belong to this sales order.")
                        if str(target_item.id) not in pending_item_ids:
                            raise ValueError("item_id is not in pending printing artwork-assignment state.")
                    else:
                        if len(pending_items) == 1:
                            target_item = pending_items[0]
                        elif len(pending_items) > 1:
                            raise ValueError("Multiple items require artwork. Pass item_id explicitly.")
                        else:
                            raise ValueError("No pending printing item requires artwork assignment.")
                    if not target_item:
                        raise ValueError("No sales order item available for artwork assignment.")
                    self._apply_artwork_to_sales_item(target_item, artwork)
                    return Response(
                        {
                            "status": "assigned",
                            "order_kind": "sales",
                            "order_id": str(order_obj.id),
                            "item_id": str(target_item.id),
                            "artwork_id": str(artwork.id),
                        }
                    )

                if not self._order_has_artwork_gate(order_kind, order_obj):
                    raise ValueError("Artwork assignment is not pending for this stock order.")
                self._apply_artwork_to_stock_order(order_obj, artwork)
                return Response(
                    {
                        "status": "assigned",
                        "order_kind": "stock",
                        "order_id": str(order_obj.id),
                        "artwork_id": str(artwork.id),
                    }
                )
        except Exception as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(
        detail=False,
        methods=["post"],
        url_path=r"control-hub/(?P<order_kind>sales|stock)/(?P<order_id>[^/.]+)/release",
    )
    def control_hub_release(self, request, order_kind=None, order_id=None):
        try:
            order_kind, order_obj, _template, _route_last = self._get_order_for_kind(order_kind, order_id)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        target_sales_item = None
        if order_kind == "sales":
            try:
                target_sales_item = self._resolve_sales_control_item(
                    order_obj,
                    request.data.get("item_id") or request.data.get("sales_order_item_id") or request.query_params.get("item_id"),
                    required=True,
                )
            except Exception as exc:
                return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        if self._order_has_artwork_gate(order_kind, order_obj, sales_order_item=target_sales_item):
            return Response(
                {"error": "Artwork assignment is required before release for printing-enabled order."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            self._validate_order_printing_for_release(order_kind, order_obj, sales_order_item=target_sales_item)
        except Exception as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        if order_kind == "sales":
            target_line_status = str(getattr(target_sales_item, "line_status", "") or "").upper()
            if target_line_status != "PLANNED":
                return Response(
                    {"error": f"Line must be PLANNED before release. Current: {target_line_status or order_obj.status}"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        elif order_obj.status != "PLANNED":
            return Response(
                {"error": f"Order must be PLANNED before release. Current: {order_obj.status}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        jobs = self._order_job_queryset(
            order_kind,
            order_obj,
            sales_order_item=target_sales_item,
        ).order_by("current_step_index", "created_at")
        pending_jobs = [job for job in jobs if job.job_state in ["PLANNED", "WAITING"]]
        first_job = next(
            (job for job in pending_jobs if "WIP_CONTINUE" in str(getattr(job, "planner_notes", "") or "")),
            None,
        ) or (pending_jobs[0] if pending_jobs else None)
        if not first_job:
            return Response({"error": "No pending jobs found for release."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            JobService.release_job(first_job.id)
            if order_kind == "sales":
                order_obj = self._sync_sales_parent_after_planner_action(order_obj)
            else:
                order_obj.status = "RELEASED"
                order_obj.save(update_fields=["status", "updated_at"])

        return Response(
            {
                "status": "released",
                "order_kind": order_kind,
                "order_id": str(order_obj.id),
                "sales_order_item_id": str(target_sales_item.id) if target_sales_item else None,
                "order_status": order_obj.status,
                "released_job_id": str(first_job.id),
            }
        )
