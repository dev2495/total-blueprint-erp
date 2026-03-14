from decimal import Decimal

from django.db import transaction
from django.db.models import Count, Max, Q, Sum
from django.core.exceptions import ObjectDoesNotExist, ValidationError
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.factory.models import WorkCenter
from apps.inventory.models import InventoryRoll
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
from apps.sales.models import SalesOrderItem, SalesOrder
from apps.sales.services.order_service import (
    SalesOrderService,
    _planned_issue_qty,
    _summarize_material_plan_lines,
    _normalize_packaging_snapshot,
    _normalize_layer_snapshot,
    _normalize_printing_snapshot,
    _validate_printing_snapshot_for_confirm,
)
from apps.artwork.models import Artwork
from apps.materials.models import InventoryMaterial
from apps.templates.models import TemplateBlueprint

from apps.physics.services_physics import PhysicsEngine
from .models import FinishedGoodsBatch, InventoryAllocation, PlannedStockOrder, ProductionJob, JobExecutionLog
from .serializers import ProductionJobSerializer
from .services.job_services import JobService


def _jsonify(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, dict):
        return {k: _jsonify(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_jsonify(v) for v in value]
    return value


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

            if pending <= 0 and item.sales_order.status in ["DISPATCH_READY", "COMPLETED"]:
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
        backlog_states = ["PLANNED", "RELEASED", "WAITING", "EXECUTING", "PAUSED", "COMPLETED"]
        jobs = ProductionJob.objects.filter(job_state__in=backlog_states).order_by("-updated_at")
        serializer = ProductionJobSerializer(jobs, many=True)
        return Response(serializer.data)

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

    @action(detail=False, methods=["post"], url_path="create-stock-order")
    def create_stock_order(self, request):
        def _payload_value(primary_key, secondary_key):
            if primary_key in request.data:
                return request.data.get(primary_key)
            if secondary_key in request.data:
                return request.data.get(secondary_key)
            return None

        template_id = request.data.get("template_id")
        internal_name = str(request.data.get("name") or request.data.get("internal_name") or "").strip()
        quantity = request.data.get("quantity", request.data.get("qty"))
        quantity_uom = str(request.data.get("quantity_uom", "KG")).upper()
        stock_purpose = str(request.data.get("stock_purpose", "PRODUCT") or "PRODUCT").upper()
        requested_stock_strategy = request.data.get("stock_strategy")
        packaging_material_id = request.data.get("packaging_material_id") or request.data.get("packaging_material")
        start_step_index = request.data.get("start_step_index")
        stop_step_index = request.data.get("stop_step_index")
        preferred_plant_id = request.data.get("preferred_plant_id") or request.data.get("plant_id")
        geometry_override = sanitize_geometry_override(request.data.get("geometry_override") or {})
        geometry_snapshot_payload = _payload_value("geometry", "geometry_snapshot")
        layer_snapshot_payload = _payload_value("film_layers", "layer_snapshot")
        printing_snapshot_payload = _payload_value("printing", "printing_snapshot")
        addons_snapshot_payload = _payload_value("addons", "addons_snapshot")
        packaging_snapshot_payload = _payload_value("packaging_snapshot", "packaging")
        normalized_packaging_snapshot = _normalize_packaging_snapshot(packaging_snapshot_payload or {})

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

        packaging_material = None
        if stock_purpose == "PACKAGING":
            if not packaging_material_id:
                return Response({"error": "packaging_material_id is required when stock_purpose=PACKAGING"}, status=status.HTTP_400_BAD_REQUEST)
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
        if template.status != "LIVE":
            return Response({"error": "Template must be LIVE for Stock Order creation"}, status=status.HTTP_400_BAD_REQUEST)

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

        normalized_geometry = normalize_geometry_override({}, geometry_snapshot_payload or geometry_override)
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
        else:
            normalized_geometry.pop("roll_form", None)
            roll_form = ""

        try:
            layer_snapshot = _normalize_layer_snapshot(layer_snapshot_payload or [])
        except ValidationError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        printing_snapshot = _normalize_printing_snapshot(printing_snapshot_payload if isinstance(printing_snapshot_payload, dict) else {})
        addons_snapshot = addons_snapshot_payload if isinstance(addons_snapshot_payload, list) else []

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
                "roll_form": roll_form or None,
                "order_qty": float(qty_input),
                "uom": quantity_uom,
            }
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
        bom_snapshot = _jsonify(preview.get("bom") or {})
        mts_order = PlannedStockOrder.objects.create(
            internal_name=internal_name or f"{template.name} Stock",
            template=template,
            plant_id=preferred_plant_id,
            target_qty=target_qty,
            quantity_uom=execution_uom,
            geometry_override=geometry_override,
            geometry_snapshot=normalized_geometry,
            layer_snapshot=layer_snapshot,
            printing_snapshot=printing_snapshot,
            addons_snapshot=addons_snapshot,
            packaging_snapshot=normalized_packaging_snapshot,
            bom_snapshot=bom_snapshot,
            spec_signature=spec_signature,
            invariant_signature=invariant_signature,
            unit_weight_g=Decimal(str(preview.get("unit_weight_g") or 0)),
            total_weight_kg=target_qty_kg,
            output_type=output_type,
            stock_purpose=stock_purpose,
            stock_strategy=stock_strategy,
            packaging_material=packaging_material,
            artwork_assignment_required=bool(artwork_required),
            assigned_artwork_id=assigned_artwork_id,
            start_step_index=start_step_index,
            stop_step_index=stop_step_index,
            target_step_index=stop_step_index,
            status="PLANNING_REQUIRED",
            created_by=request.user if request.user.is_authenticated else None,
        )

        return Response(
            {
                "status": "created",
                "stock_order_id": str(mts_order.id),
                "order_id": str(mts_order.id),
                "order_number": mts_order.order_number,
                "name": mts_order.internal_name,
                "quantity_kg": float(target_qty_kg),
                "target_qty_kg": float(target_qty_kg),
                "quantity_uom": mts_order.quantity_uom,
                "final_product_type": str(template.fg_type or "").upper() if stock_purpose == "PRODUCT" else None,
                "planned_output_type": "PACKAGING_STOCK" if stock_purpose == "PACKAGING" else mts_order.output_type,
                "stock_strategy": mts_order.stock_strategy,
                "start_step_index": mts_order.start_step_index,
                "stop_step_index": mts_order.stop_step_index,
                "spec_signature": mts_order.spec_signature,
            },
            status=status.HTTP_201_CREATED,
        )

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
            packaging_material=packaging_material,
            output_type=str(default_output_type or "WIP_ROLL").upper(),
            start_step_index=0,
            stop_step_index=route_last,
            target_step_index=route_last,
            status="PLANNING_REQUIRED",
            created_by=created_by,
        )

        return Response(
            {
                "status": "created",
                "order_kind": "stock",
                "order_id": str(clone.id),
                "order_number": clone.order_number,
                "name": clone.internal_name,
            },
            status=status.HTTP_201_CREATED,
        )

    # ---------------------------------------------------------------------
    # Control Hub APIs
    # ---------------------------------------------------------------------
    def _route_last_index(self, template) -> int:
        ordered = (template.routing_rule.ordered_processes if template and template.routing_rule else []) or []
        return max(0, len(ordered) - 1)

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

    def _sales_primary_template(self, sales_order):
        first_item = sales_order.items.select_related("template", "template__routing_rule").first()
        return first_item.template if first_item else None

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
        shortfall_kg = target_kg - produced_kg
        if shortfall_kg < 0:
            shortfall_kg = Decimal("0")
        shortfall_pct = Decimal("0")
        if target_kg > 0:
            shortfall_pct = (shortfall_kg * Decimal("100")) / target_kg
        requires_replan = bool(
            shortfall_kg > 0 and shortfall_pct > Decimal("5.0")
        )
        return {
            "target_kg": target_kg,
            "produced_kg": produced_kg,
            "shortfall_kg": shortfall_kg,
            "shortfall_pct": shortfall_pct,
            "requires_replan": requires_replan,
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

    def _matching_stock_orders_for_sales(self, template, order_signature: str, order_invariant_signature: str, required_start_step: int):
        matches = []
        stock_orders = (
            PlannedStockOrder.objects.filter(template=template, status__in=["PLANNED", "RELEASED"])
            .order_by("-updated_at")
        )
        for stock in stock_orders:
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
            stock_strategy = self._normalize_stock_strategy(
                stock_strategy=getattr(stock, "stock_strategy", ""),
                template=template,
                stock_purpose=getattr(stock, "stock_purpose", "PRODUCT"),
                stop_step_index=stock_stop,
            )
            if stock_strategy == "PACKAGING_STOCK":
                continue
            if stock_strategy == "FINAL_STOCK":
                if order_signature and stock_sig == order_signature:
                    matches_sig = True
            else:
                if order_invariant_signature and stock_inv_sig == order_invariant_signature:
                    matches_sig = True
            
            if not matches_sig:
                continue

            active_alloc = (
                InventoryAllocation.objects.filter(status="ACTIVE", mts_order=stock)
                .aggregate(total=Sum("allocated_qty_kg"))
                .get("total")
                or Decimal("0")
            )
            remaining_qty = Decimal(str(stock.target_qty or 0)) - Decimal(str(stock.produced_qty or 0)) - Decimal(str(active_alloc or 0))
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
                    "remaining_qty_kg": float(max(Decimal("0"), remaining_qty)),
                    "produced_qty_kg": float(stock.produced_qty or 0),
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
        if bool(row.get("printing_enabled")) and bool(row.get("artwork_assignment_required")):
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
        if bool(source.get("has_wip")):
            return "WIP_CONTINUE"
        return "FRESH"

    def _row_source_summary(self, row: dict):
        source = row.get("source_availability") if isinstance(row.get("source_availability"), dict) else {}
        matching_stock_orders = row.get("matching_stock_orders") if isinstance(row.get("matching_stock_orders"), list) else []
        recommendation = self._recommended_source_option(row)
        recommendation_label = {
            "FG": "Use existing finished goods first.",
            "WIP_CONTINUE": "Continue from compatible WIP before scheduling fresh conversion.",
            "FRESH": "No compatible stock is available. Fresh production is required.",
        }.get(recommendation, "Review source options.")
        return {
            "fg_match_count": int(source.get("fg_match_count") or 0),
            "wip_match_count": int(source.get("wip_match_count") or 0),
            "matching_stock_order_count": len(matching_stock_orders),
            "recommended_option": recommendation,
            "recommended_label": recommendation_label,
        }

    def _row_order_fact_sheet(self, row: dict):
        return {
            "order_number": str(row.get("order_number") or ""),
            "order_kind": str(row.get("order_kind") or "").upper(),
            "customer_name": str(row.get("customer_name") or "").strip(),
            "display_name": str(row.get("display_name") or row.get("template_name") or "").strip(),
            "delivery_date": row.get("delivery_date"),
            "template_name": str(row.get("template_name") or "").strip(),
            "status": str(row.get("status") or "").upper(),
            "fg_type": str(row.get("final_product_type") or row.get("fg_type") or "").upper(),
            "planned_output_type": str(row.get("planned_output_type") or "").upper(),
            "stock_strategy": str(row.get("stock_strategy") or "").upper(),
            "required_qty_kg": float(row.get("required_qty_kg") or 0),
            "required_qty_pcs": float(row.get("required_qty_pcs") or 0) if row.get("required_qty_pcs") is not None else None,
            "qty_uom": str(row.get("qty_uom") or "KG").upper(),
            "print_type": str(row.get("print_type") or "").upper(),
            "front_colors_count": int(row.get("front_colors_count") or 0),
            "back_colors_count": int(row.get("back_colors_count") or 0),
            "partial_shortfall_kg": float(row.get("partial_shortfall_kg") or 0),
            "partial_replan_required": bool(row.get("partial_replan_required")),
            "release_risk": "HIGH" if any(
                str((blocker or {}).get("severity") or "").upper() == "HIGH"
                for blocker in (row.get("blockers") or [])
            ) else ("MEDIUM" if row.get("blockers") else "LOW"),
        }

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
            "front_colors_count": int(primary_item.get("front_colors_count") or row.get("front_colors_count") or 0),
            "back_colors_count": int(primary_item.get("back_colors_count") or row.get("back_colors_count") or 0),
        }

    def _row_release_checklist(self, row: dict):
        blockers = row.get("blockers") if isinstance(row.get("blockers"), list) else []
        inventory_options = row.get("inventory_options") if isinstance(row.get("inventory_options"), list) else []
        material_lines = row.get("material_plan_lines") if isinstance(row.get("material_plan_lines"), list) else []
        artwork_gate = self._row_artwork_gate(row)
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
                "status": "READY" if material_lines else "BLOCKED",
                "message": "Material policy lines are available." if material_lines else "Material plan is missing.",
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
        source = self._row_source_summary(row)
        return {
            "key": str(source.get("recommended_option") or "FRESH"),
            "label": str(source.get("recommended_label") or "Review source selection"),
            "description": "Follow the recommended source path, then release when the checklist is green."
            if checklist.get("release_ready")
            else "Clear remaining checklist blockers, then release.",
            "tone": "info",
        }

    def _decorate_control_hub_row(self, row: dict):
        row["source_availability"] = self._source_availability(row)
        row["blockers"] = self._row_blockers(row)
        row["summary"] = self._row_summary(row)
        row["workspace"] = self._row_workspace(row)
        row["source_summary"] = self._row_source_summary(row)
        row["artwork_gate"] = self._row_artwork_gate(row)
        row["release_checklist"] = self._row_release_checklist(row)
        row["action_recommendation"] = self._row_action_recommendation(row)
        row["order_fact_sheet"] = self._row_order_fact_sheet(row)
        return row

    def _source_availability(self, row: dict):
        inventory_options = row.get("inventory_options") if isinstance(row.get("inventory_options"), list) else []
        required_start_step = int(row.get("required_start_step") or 0)
        fg_match_count = 0
        wip_match_count = 0
        for option in inventory_options:
            if not isinstance(option, dict):
                continue
            is_final = bool(option.get("is_final_step"))
            completed = int(option.get("completed_step_index") or 0)
            if is_final:
                fg_match_count += 1
            if not is_final and completed >= required_start_step:
                wip_match_count += 1
        return {
            "fg_match_count": fg_match_count,
            "wip_match_count": wip_match_count,
            "has_fg": fg_match_count > 0,
            "has_wip": wip_match_count > 0,
        }

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
        template,
        order_signature: str,
        order_invariant_signature: str,
        required_start_step: int,
        route_last_index: int,
        roll_alloc_map,
        fg_alloc_map,
        order_layer_snapshot=None,
    ):
        options = []
        order_routing_rule_id = getattr(template, "routing_rule_id", None)

        # Relaxed filtering for step 0: allow rolls with matching material but no template (raw materials/remainders)
        filter_q = Q(status="AVAILABLE") & Q(completed_step_index__gte=required_start_step)
        
        if required_start_step == 0:
            # Step-0 compat should use order snapshots, not template technical spec.
            first_layer_material_id = None
            if isinstance(order_layer_snapshot, list) and len(order_layer_snapshot) > 0 and isinstance(order_layer_snapshot[0], dict):
                first_layer_material_id = (
                    order_layer_snapshot[0].get("material_id")
                    or order_layer_snapshot[0].get("variant_id")
                )
            
            if first_layer_material_id:
                import uuid
                try:
                    uuid.UUID(str(first_layer_material_id))
                    filter_q &= (Q(template=template) | Q(template__isnull=True, material_id=first_layer_material_id))
                except ValueError:
                    filter_q &= Q(template=template)
            else:
                filter_q &= Q(template=template)
        else:
            filter_q &= Q(template=template)

        rolls = (
            InventoryRoll.objects.filter(filter_q)
            .select_related("template", "material", "sales_order_item")
            .order_by("completed_step_index", "created_at")
        )

        for roll in rolls:
            roll_route_id = getattr(getattr(roll, "template", None), "routing_rule_id", None)
            if order_routing_rule_id and roll.template_id and roll_route_id != order_routing_rule_id:
                continue
            inv_sig = self._roll_signature(roll)
            inv_inv_sig = self._roll_invariant_signature(roll)
            completed_step_index = int(roll.completed_step_index or 0)
            is_final_step = completed_step_index == route_last_index
            matches_sig = False
            signature_match_mode = None
            stock_strategy = "FINAL_STOCK" if is_final_step else "INTERMEDIATE_POOL"

            if required_start_step == 0 and completed_step_index == 0:
                # Stage-0 raw/purchasable rolls can be used as fresh input without historical signature.
                matches_sig = True
                signature_match_mode = "STEP0_RAW"
                stock_strategy = "INTERMEDIATE_POOL"
            elif is_final_step:
                if order_signature and inv_sig == order_signature:
                    matches_sig = True
                    signature_match_mode = "FINAL_SPEC"
            else:
                if order_invariant_signature and inv_inv_sig == order_invariant_signature:
                    matches_sig = True
                    signature_match_mode = "SEMI_INVARIANT"
            
            if not matches_sig:
                continue
            physical = Decimal(str(roll.weight_kg or 0))
            allocated = roll_alloc_map.get(str(roll.id), Decimal("0"))
            allocatable = physical - allocated
            if allocatable <= 0:
                continue
            options.append(
                {
                    "inventory_type": "ROLL",
                    "inventory_id": str(roll.id),
                    "label": roll.label_id,
                    "completed_step_index": completed_step_index,
                    "quantity_kg": float(physical),
                    "allocated_qty_kg": float(max(Decimal("0"), allocated)),
                    "allocatable_qty_kg": float(allocatable),
                    "is_final_step": is_final_step,
                    "stock_strategy": stock_strategy,
                    "signature_match_mode": signature_match_mode or ("FINAL_SPEC" if is_final_step else "SEMI_INVARIANT"),
                }
            )

        fg_batches = (
            FinishedGoodsBatch.objects.filter(
                status="AVAILABLE",
                template=template,
                completed_step_index__gte=required_start_step,
            )
            .select_related("template", "sales_order_item")
            .order_by("completed_step_index", "created_at")
        )

        for batch in fg_batches:
            batch_route_id = getattr(getattr(batch, "template", None), "routing_rule_id", None)
            if order_routing_rule_id and batch_route_id != order_routing_rule_id:
                continue
            if order_signature and self._fg_signature(batch) != order_signature:
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
                    "completed_step_index": int(batch.completed_step_index or 0),
                    "quantity_kg": float(physical),
                    "allocated_qty_kg": float(max(Decimal("0"), allocated)),
                    "allocatable_qty_kg": float(allocatable),
                    "is_final_step": int(batch.completed_step_index or 0) == route_last_index,
                    "stock_strategy": "FINAL_STOCK",
                    "signature_match_mode": "FINAL_SPEC",
                }
            )
        options.sort(
            key=lambda row: (
                0 if row["inventory_type"] == "FG_BATCH" and row["is_final_step"] else 1,
                row["completed_step_index"],
                row["label"],
            )
        )
        return options

    @action(detail=False, methods=["get"], url_path="control-hub")
    def control_hub(self, request):
        roll_alloc_map, fg_alloc_map = self._inventory_active_allocation_maps()
        planning_queue = []
        active_orders = []
        order_history = []

        # --- Sales Orders ---
        all_sales = (
            SalesOrder.objects.exclude(status__in=["DRAFT", "CANCELLED"])
            .prefetch_related("items__template__routing_rule")
            .order_by("-created_at")
        )

        for order in all_sales:
            try:
                template = self._sales_primary_template(order)
                if not template:
                    continue
                route_last = self._route_last_index(template)
                required_start_step = 0
                partial_metrics = self._sales_partial_metrics(order, route_last)
                pending_print_items = self._pending_sales_print_items(order)
                pending_artwork_items = self._pending_sales_print_items_payload(order, pending_print_items)
                so_item = pending_print_items[0] if pending_print_items else order.items.first()
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
                    "required_qty_kg": float(row_required_qty_kg),
                    "required_qty_pcs": None if str(template.fg_type or "").upper() == "ROLL" else qty_pcs,
                    "qty_uom": qty_uom,
                    "math_valid": math_valid,
                    "math_error": math_error,
                    "required_start_step": required_start_step,
                    "route_last_step_index": route_last,
                    "geometry_override": order.geometry_override or {},
                    "spec_signature": spec_signature,
                    "effective_dims": eff_dims,
                    "roll_invariants": roll_invariants,
                    "created_at": order.created_at.isoformat() if order.created_at else None,
                    "artwork_assignment_required": bool(pending_print_items),
                    "assigned_artwork_id": str(getattr(so_item, "assigned_artwork_id", "") or ""),
                    "pending_artwork_items": pending_artwork_items,
                    "printing_enabled": bool((so_item.printing_snapshot or {}).get("enabled", False)) if so_item else False,
                    "print_type": str((so_item.printing_snapshot or {}).get("type") or (so_item.printing_snapshot or {}).get("method") or "").upper() if so_item else "",
                    "front_colors_count": int((so_item.printing_snapshot or {}).get("front_colors_count") or 0) if so_item else 0,
                    "back_colors_count": int((so_item.printing_snapshot or {}).get("back_colors_count") or 0) if so_item else 0,
                    "partial_replan_required": bool(partial_metrics["requires_replan"]),
                    "partial_shortfall_kg": float(partial_metrics["shortfall_kg"]),
                    "partial_shortfall_pct": float(partial_metrics["shortfall_pct"]),
                    "partial_produced_kg": float(partial_metrics["produced_kg"]),
                    "partial_target_kg": float(partial_metrics["target_kg"]),
                }
                if so_item:
                    material_plan_lines, material_plan_summary = self._material_plan_payload(so_item.bom_snapshot or {})
                    row["material_plan_lines"] = material_plan_lines
                    row["material_plan_summary"] = material_plan_summary

                jobs_qs = ProductionJob.objects.filter(sales_order_item__sales_order=order)
                job_count = jobs_qs.count()
                needs_planning_queue = (
                    order.status == "PLANNING_REQUIRED"
                    or (order.status == "CONFIRMED" and job_count == 0)
                )

                if needs_planning_queue:
                    options = self._eligible_inventory_for_order(
                        template=template,
                        order_signature=sig,
                        order_invariant_signature=inv_sig,
                        required_start_step=required_start_step,
                        route_last_index=route_last,
                        roll_alloc_map=roll_alloc_map,
                        fg_alloc_map=fg_alloc_map,
                        order_layer_snapshot=order_layer_snapshot,
                    )
                    row["inventory_options"] = options
                    row["matching_stock_orders"] = self._matching_stock_orders_for_sales(
                        template=template,
                        order_signature=sig,
                        order_invariant_signature=inv_sig,
                        required_start_step=required_start_step,
                    )
                    planning_queue.append(self._decorate_control_hub_row(row))
                elif order.status in ("PLANNED", "RELEASED") or (order.status == "CONFIRMED" and job_count > 0):
                    row["job_count"] = job_count
                    row["jobs_released"] = jobs_qs.filter(job_state="RELEASED").count()
                    row["jobs_completed"] = jobs_qs.filter(job_state__in=["COMPLETED", "DONE"]).count()
                    active_orders.append(self._decorate_control_hub_row(row))
                else:
                    order_history.append(self._decorate_control_hub_row(row))
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

        # --- Stock Orders ---
        all_mts = list(
            PlannedStockOrder.objects.exclude(status__in=["CANCELLED"])
            .select_related("template", "template__routing_rule")
            .order_by("-created_at")
        )
        for order in all_mts:
            try:
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
                    "required_qty_kg": float(required_qty_kg),
                    "required_qty_pcs": required_qty_pcs if required_qty_pcs and required_qty_pcs > 0 else None,
                    "qty_uom": quantity_uom,
                    "math_valid": math_valid,
                    "math_error": math_error,
                    "required_start_step": required_start_step,
                    "route_last_step_index": route_last,
                    "geometry_override": order.geometry_override or {},
                    "spec_signature": getattr(order, "spec_signature", ""),
                    "effective_dims": eff_dims,
                    "roll_invariants": roll_invariants,
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
                    options = []
                    try:
                        options = self._eligible_inventory_for_order(
                            template=template,
                            order_signature=sig,
                            order_invariant_signature=inv_sig,
                            required_start_step=required_start_step,
                            route_last_index=route_last,
                            roll_alloc_map=roll_alloc_map,
                            fg_alloc_map=fg_alloc_map,
                            order_layer_snapshot=order.layer_snapshot or [],
                        )
                    except Exception as exc:
                        row["inventory_options_error"] = str(exc)
                    row["inventory_options"] = options
                    planning_queue.append(self._decorate_control_hub_row(row))
                elif order.status in ("PLANNED", "RELEASED"):
                    jobs_qs = ProductionJob.objects.filter(mts_order=order)
                    row["job_count"] = jobs_qs.count()
                    row["jobs_released"] = jobs_qs.filter(job_state="RELEASED").count()
                    row["jobs_completed"] = jobs_qs.filter(job_state__in=["COMPLETED", "DONE"]).count()
                    active_orders.append(self._decorate_control_hub_row(row))
                else:
                    order_history.append(self._decorate_control_hub_row(row))
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

    def _order_job_queryset(self, order_kind: str, order_obj):
        if order_kind == "sales":
            return ProductionJob.objects.filter(sales_order_item__sales_order=order_obj)
        return ProductionJob.objects.filter(mts_order=order_obj)

    def _order_has_artwork_gate(self, order_kind: str, order_obj) -> bool:
        if order_kind == "sales":
            for item in order_obj.items.all():
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
        for item in rows:
            printing = item.printing_snapshot or {}
            line_name = str(getattr(item, "line_name", "") or "").strip()
            template_name = str(getattr(getattr(item, "template", None), "name", "") or "").strip()
            payload.append(
                {
                    "id": str(item.id),
                    "label": line_name or template_name or f"Item {str(item.id)[:8]}",
                    "line_name": line_name,
                    "template_name": template_name,
                    "print_type": str(printing.get("type") or printing.get("method") or "").upper(),
                    "front_colors_count": int(printing.get("front_colors_count") or 0),
                    "back_colors_count": int(printing.get("back_colors_count") or 0),
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
    ):
        if option in {"FG", "WIP_CONTINUE"} and not allocation_rows:
            raise ValueError("allocations are required for FG/WIP_CONTINUE")

        if order_kind == "sales":
            so_item = order_obj.items.select_related("template").first()
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

                created.append(
                    InventoryAllocation.objects.create(
                        sales_order=order_obj if order_kind == "sales" else None,
                        mts_order=order_obj if order_kind == "stock" else None,
                        inventory_roll=roll,
                        allocated_qty_kg=qty,
                        status="ACTIVE",
                        created_by=created_by,
                    )
                )
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

                created.append(
                    InventoryAllocation.objects.create(
                        sales_order=order_obj if order_kind == "sales" else None,
                        mts_order=order_obj if order_kind == "stock" else None,
                        fg_batch=batch,
                        allocated_qty_kg=qty,
                        status="ACTIVE",
                        created_by=created_by,
                    )
                )
                continue

            raise ValueError(f"Unsupported inventory_type: {inv_type}")

        return created

    @action(
        detail=False,
        methods=["post"],
        url_path=r"control-hub/(?P<order_kind>sales|stock)/(?P<order_id>[^/.]+)/plan",
    )
    def control_hub_plan(self, request, order_kind=None, order_id=None):
        option = str(request.data.get("option") or "").upper()
        if option not in {"FG", "WIP_CONTINUE", "FRESH"}:
            return Response({"error": "option must be FG, WIP_CONTINUE, or FRESH"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            order_kind, order_obj, template, route_last = self._get_order_for_kind(order_kind, order_id)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        if order_obj.status != "PLANNING_REQUIRED":
            return Response(
                {"error": f"Order must be PLANNING_REQUIRED. Current status: {order_obj.status}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        partial_replan_required = False
        partial_remaining_kg = Decimal("0")
        if order_kind == "sales":
            partial_metrics = self._sales_partial_metrics(order_obj, route_last)
            partial_replan_required = bool(partial_metrics.get("requires_replan"))
            partial_remaining_kg = Decimal(str(partial_metrics.get("shortfall_kg") or 0))

        if partial_replan_required and option == "FG":
            return Response(
                {"error": "Order has >5% production shortfall. Use WIP_CONTINUE/FRESH for remaining run, or planner short-close."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        existing_jobs = self._order_job_queryset(order_kind, order_obj).exclude(job_state="CANCELLED")
        active_existing_jobs = existing_jobs.exclude(job_state__in=["COMPLETED", "CANCELLED"])
        if active_existing_jobs.exists() and option in {"WIP_CONTINUE", "FRESH"}:
            return Response({"error": "Production jobs already exist for this order."}, status=status.HTTP_400_BAD_REQUEST)

        start_step = request.data.get("start_step_index")
        stop_step = request.data.get("stop_step_index")

        if option == "FG":
            start_step = route_last
            stop_step = route_last
        elif option == "FRESH":
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

        allocation_rows = request.data.get("allocations") or []

        try:
            with transaction.atomic():
                created_allocations = []
                if option in {"FG", "WIP_CONTINUE"}:
                    created_allocations = self._create_inventory_allocations(
                        order_kind=order_kind,
                        order_obj=order_obj,
                        template=template,
                        route_last=route_last,
                        start_step=start_step,
                        option=option,
                        allocation_rows=allocation_rows,
                        created_by=request.user if request.user.is_authenticated else None,
                    )
                elif allocation_rows:
                    return Response(
                        {"error": "FRESH planning does not take allocations."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                jobs_created = []
                if option in {"WIP_CONTINUE", "FRESH"}:
                    if order_kind == "sales":
                        for item in order_obj.items.select_related("template", "template__routing_rule").all():
                            if not item.template or not item.template.routing_rule:
                                raise ValueError("Sales order item has missing template routing.")
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
                            jobs_created.extend(
                                JobService.create_jobs_for_so_item(
                                    item,
                                    start_index=start_step,
                                    stop_index=stop_step,
                                    quantity_override=qty_override,
                                    quantity_uom_override=qty_uom_override,
                                    planner_note_prefix=planner_note,
                                )
                            )
                        if partial_replan_required and not jobs_created and partial_remaining_kg > 0:
                            raise ValueError("No remaining shortfall quantity found to re-release.")
                        order_obj.status = "PLANNED"
                        order_obj.save(update_fields=["status"])
                    else:
                        order_obj.start_step_index = start_step
                        order_obj.stop_step_index = stop_step
                        order_obj.target_step_index = stop_step
                        jobs_created = JobService.create_jobs_for_planned_order(
                            order_obj,
                            start_index=start_step,
                            stop_index=stop_step,
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
                        order_obj.status = "DISPATCH_READY"
                        order_obj.save(update_fields=["status"])
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

        if order_obj.status != "PLANNING_REQUIRED":
            return Response(
                {"error": f"Order must be PLANNING_REQUIRED to short-close. Current: {order_obj.status}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            with transaction.atomic():
                if order_kind == "sales":
                    metrics = self._sales_partial_metrics(order_obj, route_last)
                    order_obj.status = "DISPATCH_READY"
                    order_obj.save(update_fields=["status"])

                    so_item = order_obj.items.first()
                    if so_item:
                        final_job = (
                            ProductionJob.objects.filter(
                                sales_order_item=so_item,
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

        if self._order_has_artwork_gate(order_kind, order_obj):
            return Response(
                {"error": "Artwork assignment is required before release for printing-enabled order."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if order_obj.status != "PLANNED":
            return Response(
                {"error": f"Order must be PLANNED before release. Current: {order_obj.status}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        jobs = self._order_job_queryset(order_kind, order_obj).order_by("current_step_index", "created_at")
        first_job = next((job for job in jobs if job.job_state in ["PLANNED", "WAITING"]), None)
        if not first_job:
            return Response({"error": "No pending jobs found for release."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            JobService.release_job(first_job.id)
            order_obj.status = "RELEASED"
            if order_kind == "sales":
                order_obj.save(update_fields=["status"])
            else:
                order_obj.save(update_fields=["status", "updated_at"])

        return Response(
            {
                "status": "released",
                "order_kind": order_kind,
                "order_id": str(order_obj.id),
                "order_status": order_obj.status,
                "released_job_id": str(first_job.id),
            }
        )
