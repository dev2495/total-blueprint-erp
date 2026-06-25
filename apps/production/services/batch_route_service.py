from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
import re

from django.db import transaction
from django.db.models import Q


def _safe_int(value, default=0):
    try:
        return int(value)
    except Exception:
        return int(default)


def _safe_decimal(value, default="0"):
    try:
        if value in (None, ""):
            return Decimal(str(default))
        return Decimal(str(value))
    except Exception:
        return Decimal(str(default))


def _slug(value):
    text = re.sub(r"[^A-Za-z0-9]+", "_", str(value or "").strip()).strip("_")
    return text[:48] or "NODE"


class RouteGraphService:
    """
    Runtime adapter for route-master graph semantics.

    Existing route masters store a linear ordered_processes list. route_graph is
    optional and can define a DAG with branches/joins. Every caller receives the
    same normalized graph shape, so old linear routes and new graph routes share
    one execution path.
    """

    @classmethod
    def normalize(cls, routing_rule):
        ordered = list(getattr(routing_rule, "ordered_processes", None) or [])
        raw = getattr(routing_rule, "route_graph", None) or {}
        if not isinstance(raw, dict):
            raw = {}
        raw_nodes = raw.get("nodes") if isinstance(raw.get("nodes"), list) else []

        nodes = []
        seen = set()
        if raw_nodes:
            for idx, row in enumerate(raw_nodes):
                if not isinstance(row, dict):
                    continue
                process_code = str(
                    row.get("process_code")
                    or row.get("process")
                    or row.get("code")
                    or (ordered[idx] if idx < len(ordered) else "")
                ).strip()
                if not process_code:
                    continue
                raw_index = row.get("route_index", row.get("step_index", row.get("sequence_number", idx)))
                route_index = _safe_int(raw_index, idx)
                if "sequence_number" in row and "route_index" not in row and route_index > 0:
                    route_index -= 1
                node_id = str(row.get("id") or row.get("node_id") or f"step_{route_index + 1}_{_slug(process_code)}").strip()
                if not node_id or node_id in seen:
                    node_id = f"step_{route_index + 1}_{_slug(process_code)}_{idx + 1}"
                seen.add(node_id)
                nodes.append(
                    {
                        "id": node_id,
                        "label": str(row.get("label") or row.get("name") or process_code).strip(),
                        "process_code": process_code,
                        "route_index": max(0, route_index),
                        "branch_key": str(row.get("branch_key") or row.get("branch") or "MAIN").strip() or "MAIN",
                        "join_key": str(row.get("join_key") or "").strip(),
                        "parallel_group": str(row.get("parallel_group") or "").strip(),
                        "matching_rule": row.get("matching_rule") if isinstance(row.get("matching_rule"), dict) else {},
                        "raw": row,
                    }
                )
        else:
            for idx, process_code in enumerate(ordered):
                nodes.append(
                    {
                        "id": f"step_{idx + 1}_{_slug(process_code)}",
                        "label": str(process_code),
                        "process_code": str(process_code),
                        "route_index": idx,
                        "branch_key": "MAIN",
                        "join_key": "",
                        "parallel_group": "",
                        "matching_rule": {},
                        "raw": {},
                    }
                )

        nodes.sort(key=lambda node: (node["route_index"], node["id"]))
        node_ids = {node["id"] for node in nodes}
        predecessors = {node["id"]: set() for node in nodes}
        successors = {node["id"]: set() for node in nodes}

        def add_edge(src, dst):
            src = str(src or "").strip()
            dst = str(dst or "").strip()
            if src in node_ids and dst in node_ids and src != dst:
                successors[src].add(dst)
                predecessors[dst].add(src)

        raw_edges = raw.get("edges") if isinstance(raw.get("edges"), list) else []
        for edge in raw_edges:
            if isinstance(edge, dict):
                add_edge(edge.get("from") or edge.get("source"), edge.get("to") or edge.get("target"))
            elif isinstance(edge, (list, tuple)) and len(edge) >= 2:
                add_edge(edge[0], edge[1])

        for node in nodes:
            raw_node = node.get("raw") if isinstance(node.get("raw"), dict) else {}
            deps = (
                raw_node.get("predecessor_node_ids")
                or raw_node.get("depends_on")
                or raw_node.get("dependencies")
                or []
            )
            if isinstance(deps, str):
                deps = [deps]
            for dep in deps if isinstance(deps, list) else []:
                add_edge(dep, node["id"])

        if not any(successors.values()) and len(nodes) > 1:
            for current, next_node in zip(nodes, nodes[1:]):
                add_edge(current["id"], next_node["id"])

        for node in nodes:
            node["predecessor_node_ids"] = sorted(predecessors[node["id"]])
            node["successor_node_ids"] = sorted(successors[node["id"]])
            node["is_join"] = len(node["predecessor_node_ids"]) > 1
            node["is_parallel_start"] = len(node["successor_node_ids"]) > 1

        return {
            "nodes": nodes,
            "by_id": {node["id"]: node for node in nodes},
            "predecessors": {key: sorted(value) for key, value in predecessors.items()},
            "successors": {key: sorted(value) for key, value in successors.items()},
        }

    @classmethod
    def public_snapshot(cls, routing_rule):
        graph = cls.normalize(routing_rule)
        return {
            "nodes": [
                {
                    "id": node["id"],
                    "label": node["label"],
                    "process_code": node["process_code"],
                    "route_index": node["route_index"],
                    "branch_key": node["branch_key"],
                    "join_key": node["join_key"],
                    "parallel_group": node["parallel_group"],
                    "predecessor_node_ids": node["predecessor_node_ids"],
                    "successor_node_ids": node["successor_node_ids"],
                    "is_join": node["is_join"],
                    "is_parallel_start": node["is_parallel_start"],
                }
                for node in graph["nodes"]
            ]
        }

    @classmethod
    def nodes_for_span(cls, routing_rule, start_index=0, stop_index=None):
        graph = cls.normalize(routing_rule)
        nodes = graph["nodes"]
        if not nodes:
            return []
        start = max(0, _safe_int(start_index, 0))
        stop = max(node["route_index"] for node in nodes) if stop_index is None else _safe_int(stop_index, 0)
        return [node for node in nodes if start <= int(node["route_index"]) <= stop]

    @classmethod
    def initial_node_ids(cls, nodes):
        selected_ids = {node["id"] for node in nodes}
        return {
            node["id"]
            for node in nodes
            if not [pred for pred in node.get("predecessor_node_ids", []) if pred in selected_ids]
        }

    @classmethod
    def node_for_job(cls, job):
        graph = cls.normalize(job.routing_rule)
        node_id = str(getattr(job, "route_node_id", "") or "").strip()
        if node_id and node_id in graph["by_id"]:
            return graph["by_id"][node_id]
        current_index = int(getattr(job, "current_step_index", 0) or 0)
        for node in graph["nodes"]:
            if int(node["route_index"]) == current_index:
                return node
        return graph["nodes"][0] if graph["nodes"] else None

    @classmethod
    def route_payload_for_job(cls, job):
        node = cls.node_for_job(job)
        if not node:
            return {
                "route_node_id": "",
                "route_branch_key": "",
                "predecessor_node_ids": [],
                "successor_node_ids": [],
                "is_join": False,
                "is_parallel_start": False,
            }
        return {
            "route_node_id": node["id"],
            "route_node_label": node["label"],
            "route_branch_key": node["branch_key"],
            "join_key": node["join_key"],
            "parallel_group": node["parallel_group"],
            "predecessor_node_ids": node["predecessor_node_ids"],
            "successor_node_ids": node["successor_node_ids"],
            "is_join": node["is_join"],
            "is_parallel_start": node["is_parallel_start"],
        }

    @classmethod
    def predecessor_jobs_complete(cls, candidate):
        node = cls.node_for_job(candidate)
        if not node:
            return True
        predecessor_ids = list(node.get("predecessor_node_ids") or [])
        if not predecessor_ids:
            return True

        base = ProductionJob.objects.filter(routing_rule=candidate.routing_rule, job_state="COMPLETED")
        if getattr(candidate, "production_batch_id", None):
            base = base.filter(production_batch_id=candidate.production_batch_id)
        elif getattr(candidate, "sales_order_item_id", None):
            base = base.filter(sales_order_item_id=candidate.sales_order_item_id)
        elif getattr(candidate, "mts_order_id", None):
            base = base.filter(mts_order_id=candidate.mts_order_id)
        else:
            return False

        completed = set(base.exclude(route_node_id="").values_list("route_node_id", flat=True))
        if not completed:
            # Legacy fallback for jobs that predate route_node_id.
            completed_indexes = set(base.values_list("current_step_index", flat=True))
            graph = cls.normalize(candidate.routing_rule)
            completed = {
                node["id"]
                for node in graph["nodes"]
                if int(node["route_index"]) in completed_indexes
            }
        return all(pred in completed for pred in predecessor_ids)

    @classmethod
    def ready_successor_jobs(cls, completed_job):
        filters = {
            "routing_rule": completed_job.routing_rule,
            "job_state": "WAITING",
        }
        if getattr(completed_job, "production_batch_id", None):
            filters["production_batch_id"] = completed_job.production_batch_id
        elif getattr(completed_job, "sales_order_item_id", None):
            filters["sales_order_item_id"] = completed_job.sales_order_item_id
        elif getattr(completed_job, "mts_order_id", None):
            filters["mts_order_id"] = completed_job.mts_order_id
        else:
            return []

        graph = cls.normalize(completed_job.routing_rule)
        completed_node = cls.node_for_job(completed_job)
        successor_ids = set((completed_node or {}).get("successor_node_ids") or [])
        candidates = (
            ProductionJob.objects.filter(**filters)
            .select_related("work_center__plant", "from_location__plant", "to_location__plant", "production_batch")
            .order_by("current_step_index", "created_at")
        )
        ready = []
        for candidate in candidates:
            node = cls.node_for_job(candidate)
            if not node:
                continue
            if successor_ids and node["id"] not in successor_ids:
                # Parallel branches can make a downstream join ready after the
                # last predecessor closes; only consider graph descendants.
                preds = set(node.get("predecessor_node_ids") or [])
                if completed_node and completed_node["id"] not in preds:
                    continue
            if cls.predecessor_jobs_complete(candidate):
                ready.append(candidate)
        if ready or (completed_node and successor_ids):
            return ready

        # Linear legacy fallback.
        return list(
            ProductionJob.objects.filter(**filters, current_step_index__gt=completed_job.current_step_index)
            .order_by("current_step_index", "created_at")[:1]
        )


class BatchExecutionService:
    @classmethod
    def _policy_for_template(cls, template):
        policy = {}
        template_policy = getattr(template, "batch_execution_policy", None) or {}
        if isinstance(template_policy, dict):
            policy.update(template_policy)
        policy.setdefault("allow_partial_movement", True)
        policy.setdefault("auto_create_batch_from_machine_output", True)
        return policy

    @classmethod
    def _target_weight_kg(cls, source, qty, uom):
        qty = _safe_decimal(qty)
        uom = str(uom or "KG").upper()
        if uom == "KG":
            return qty
        if uom == "PCS":
            unit_weight = _safe_decimal(getattr(source, "unit_weight_g", 0))
            if unit_weight > 0:
                return (qty * unit_weight) / Decimal("1000")
        return _safe_decimal(getattr(source, "total_weight_kg", 0))

    @classmethod
    def _planned_quantities(cls, source, qty, uom, policy):
        qty = _safe_decimal(qty)
        uom = str(uom or "KG").upper()
        if qty <= 0:
            return []

        if uom == "PCS":
            batch_size = _safe_decimal(policy.get("default_batch_size_pcs"))
        else:
            batch_size = _safe_decimal(policy.get("default_batch_size_kg") or policy.get("default_batch_size"))

        if batch_size <= 0 or qty <= batch_size:
            return [{"qty": qty, "uom": uom}]

        rows = []
        remaining = qty
        while remaining > 0:
            part = min(batch_size, remaining)
            rows.append({"qty": part, "uom": uom})
            remaining -= part
        return rows

    @classmethod
    def _next_batch_number(cls, so_item, sequence):
        from apps.production.models import ProductionBatch

        order_no = str(getattr(getattr(so_item, "sales_order", None), "order_number", "") or "SO")
        base = f"{order_no}-{str(so_item.id).replace('-', '')[:4]}-B{int(sequence):02d}"
        candidate = base
        rev = 1
        while ProductionBatch.objects.filter(batch_number=candidate).exists():
            rev += 1
            candidate = f"{base}-R{rev}"
        return candidate

    @classmethod
    @transaction.atomic
    def ensure_batches_for_sales_item(cls, so_item, *, quantity=None, uom=None, source=None):
        from apps.production.models import ProductionBatch

        existing = list(so_item.production_batches.select_related("routing_rule", "template").order_by("batch_sequence", "created_at"))
        if existing:
            return existing

        template = so_item.template
        policy = cls._policy_for_template(template)
        planned = cls._planned_quantities(
            so_item,
            quantity if quantity is not None else getattr(so_item, "qty_value", 0),
            uom or getattr(so_item, "qty_uom", "KG"),
            policy,
        )
        route_snapshot = RouteGraphService.public_snapshot(template.routing_rule)
        auto_split = len(planned) > 1
        source = source or ("AUTO_SPLIT" if auto_split else "LEGACY_SINGLE")
        batches = []
        for idx, row in enumerate(planned, start=1):
            batch = ProductionBatch.objects.create(
                batch_number=cls._next_batch_number(so_item, idx),
                sales_order_item=so_item,
                template=template,
                routing_rule=template.routing_rule,
                batch_sequence=idx,
                planned_qty=row["qty"].quantize(Decimal("0.0001")),
                planned_uom=row["uom"],
                source=source,
                allow_partial_movement=bool(policy.get("allow_partial_movement", True)),
                route_snapshot=route_snapshot,
                policy_snapshot=policy,
            )
            batches.append(batch)
        return batches

    @classmethod
    @transaction.atomic
    def backfill_legacy_sales_item_batch(cls, so_item):
        from apps.production.models import ProductionBatch

        existing = list(so_item.production_batches.select_related("routing_rule", "template").order_by("batch_sequence", "created_at"))
        if existing:
            return existing[0]
        template = getattr(so_item, "template", None)
        route = getattr(template, "routing_rule", None)
        if not template or not route:
            return None
        jobs = list(
            ProductionJob.objects.filter(sales_order_item=so_item)
            .select_related("current_process", "process", "routing_rule")
            .order_by("current_step_index", "created_at")
        )
        if not jobs:
            return None
        route_snapshot = RouteGraphService.public_snapshot(route)
        batch = ProductionBatch.objects.create(
            batch_number=cls._next_batch_number(so_item, 1),
            sales_order_item=so_item,
            template=template,
            routing_rule=route,
            batch_sequence=1,
            planned_qty=_safe_decimal(getattr(so_item, "qty_value", 0)).quantize(Decimal("0.0001")),
            planned_uom=str(getattr(so_item, "qty_uom", "KG") or "KG").upper(),
            source="LEGACY_SINGLE",
            allow_partial_movement=True,
            route_snapshot=route_snapshot,
            policy_snapshot=cls._policy_for_template(template),
        )
        graph = RouteGraphService.normalize(route)
        for job in jobs:
            node = None
            job_process = getattr(job, "current_process", None) or getattr(job, "process", None)
            job_process_code = str(getattr(job_process, "code", "") or "").strip()
            for candidate in graph["nodes"]:
                if int(candidate["route_index"]) != int(getattr(job, "current_step_index", 0) or 0):
                    continue
                if job_process_code and str(candidate["process_code"]) != job_process_code:
                    continue
                node = candidate
                break
            if node is None:
                node = RouteGraphService.node_for_job(job)
            update_fields = ["production_batch", "updated_at"]
            job.production_batch = batch
            if node is not None:
                job.route_node_id = node["id"]
                job.route_branch_key = node.get("branch_key", "MAIN")
                job.route_predecessor_node_ids = node.get("predecessor_node_ids", [])
                job.route_successor_node_ids = node.get("successor_node_ids", [])
                update_fields.extend([
                    "route_node_id",
                    "route_branch_key",
                    "route_predecessor_node_ids",
                    "route_successor_node_ids",
                ])
            job.save(update_fields=update_fields)
        return cls.sync_batch_from_jobs(batch)

    @classmethod
    def sync_batch_from_jobs(cls, batch):
        from apps.inventory.models import InventoryRoll

        jobs = list(batch.jobs.all().order_by("current_step_index", "created_at"))
        fg_batches = list(batch.fg_batches.all())
        packing_units = list(batch.packing_units.all())
        rolls = list(
            InventoryRoll.objects.filter(
                Q(production_job__production_batch=batch) | Q(created_by_job__production_batch=batch),
                is_fg=True,
            ).distinct()
        )

        produced_kg = sum((_safe_decimal(getattr(row, "qty_kg", 0)) for row in fg_batches), Decimal("0"))
        produced_pcs = sum((_safe_decimal(getattr(row, "qty_pcs", 0)) for row in fg_batches), Decimal("0"))
        produced_kg += sum((_safe_decimal(getattr(row, "weight_kg", 0)) for row in rolls), Decimal("0"))

        packed_kg = sum(
            (
                _safe_decimal(getattr(row, "net_product_weight_kg", None) or getattr(row, "weight_kg", 0))
                for row in packing_units
            ),
            Decimal("0"),
        )
        packed_pcs = sum((_safe_decimal(getattr(row, "qty_pcs", 0)) for row in packing_units), Decimal("0"))
        dispatched_packing = [row for row in packing_units if str(getattr(row, "status", "") or "").upper() == "DISPATCHED"]
        dispatched_rolls = [row for row in rolls if str(getattr(row, "status", "") or "").upper() in {"IN_TRANSIT", "CONSUMED", "DISPATCHED"}]
        dispatched_kg = sum(
            (
                _safe_decimal(getattr(row, "net_product_weight_kg", None) or getattr(row, "weight_kg", 0))
                for row in dispatched_packing
            ),
            Decimal("0"),
        )
        dispatched_pcs = sum((_safe_decimal(getattr(row, "qty_pcs", 0)) for row in dispatched_packing), Decimal("0"))
        dispatched_kg += sum((_safe_decimal(getattr(row, "weight_kg", 0)) for row in dispatched_rolls), Decimal("0"))

        status = "PLANNED"
        active_jobs = [job for job in jobs if str(job.job_state).upper() not in {"COMPLETED", "CANCELLED"}]
        if any(bool(getattr(job, "is_on_hold", False)) for job in active_jobs):
            status = "HOLD"
        elif any(str(job.job_state).upper() == "EXECUTING" for job in jobs):
            status = "RUNNING"
        elif any(str(job.job_state).upper() == "RELEASED" for job in jobs):
            status = "RELEASED"
        elif (
            not any(str(job.job_state).upper() in {"PLANNED", "RELEASED", "EXECUTING", "PAUSED"} for job in active_jobs)
            and any(str(job.job_state).upper() == "WAITING" and not RouteGraphService.predecessor_jobs_complete(job) for job in jobs)
        ):
            status = "WAITING_JOIN"

        if jobs and not active_jobs:
            if dispatched_packing or dispatched_rolls:
                all_packed_dispatched = not packing_units or len(dispatched_packing) >= len(packing_units)
                all_rolls_dispatched = not rolls or len(dispatched_rolls) >= len(rolls)
                status = "COMPLETED" if all_packed_dispatched and all_rolls_dispatched else "DISPATCHED"
            elif packing_units and any(str(getattr(row, "status", "") or "").upper() == "SEALED" for row in packing_units):
                status = "DISPATCH_READY"
            elif fg_batches or rolls:
                status = "PACKING_READY"
            else:
                status = "COMPLETED"

        current_job = next((job for job in active_jobs if str(job.job_state).upper() in {"EXECUTING", "RELEASED", "PAUSED"}), None)
        if current_job is None and active_jobs:
            current_job = sorted(active_jobs, key=lambda job: (int(job.current_step_index or 0), job.created_at))[0]

        update_fields = [
            "status",
            "produced_qty_kg",
            "produced_qty_pcs",
            "packed_qty_kg",
            "packed_qty_pcs",
            "dispatched_qty_kg",
            "dispatched_qty_pcs",
            "updated_at",
        ]
        batch.status = status
        batch.produced_qty_kg = produced_kg.quantize(Decimal("0.0001"))
        batch.produced_qty_pcs = produced_pcs.quantize(Decimal("0.01"))
        batch.packed_qty_kg = packed_kg.quantize(Decimal("0.0001"))
        batch.packed_qty_pcs = packed_pcs.quantize(Decimal("0.01"))
        batch.dispatched_qty_kg = dispatched_kg.quantize(Decimal("0.0001"))
        batch.dispatched_qty_pcs = dispatched_pcs.quantize(Decimal("0.01"))
        if current_job is not None:
            batch.current_step_index = int(getattr(current_job, "current_step_index", 0) or 0)
            batch.current_route_node_id = str(getattr(current_job, "route_node_id", "") or "")
            batch.current_route_branch_key = str(getattr(current_job, "route_branch_key", "") or "")
            update_fields.extend(["current_step_index", "current_route_node_id", "current_route_branch_key"])
        batch.save(update_fields=update_fields)
        return batch

    @classmethod
    def sync_for_job(cls, job):
        batch = getattr(job, "production_batch", None)
        if batch:
            return cls.sync_batch_from_jobs(batch)
        return None

    @classmethod
    def line_summary(cls, so_item):
        batches = list(so_item.production_batches.all().order_by("batch_sequence", "created_at"))
        if not batches and ProductionJob.objects.filter(sales_order_item=so_item).exists():
            cls.backfill_legacy_sales_item_batch(so_item)
            batches = list(so_item.production_batches.all().order_by("batch_sequence", "created_at"))
        for batch in batches:
            cls.sync_batch_from_jobs(batch)
        batches = list(so_item.production_batches.all().order_by("batch_sequence", "created_at"))
        total = len(batches)
        status_counts = {}
        produced_kg = Decimal("0")
        dispatched_kg = Decimal("0")
        for batch in batches:
            status_counts[batch.status] = status_counts.get(batch.status, 0) + 1
            produced_kg += _safe_decimal(batch.produced_qty_kg)
            dispatched_kg += _safe_decimal(batch.dispatched_qty_kg)
        return {
            "batch_count": total,
            "status_counts": status_counts,
            "produced_kg": float(produced_kg.quantize(Decimal("0.0001"))),
            "dispatched_kg": float(dispatched_kg.quantize(Decimal("0.0001"))),
            "batches": [cls.serialize_batch(batch) for batch in batches],
        }

    @classmethod
    def serialize_batch(cls, batch):
        route_snapshot = batch.route_snapshot if isinstance(batch.route_snapshot, dict) else {}
        current_node_id = str(batch.current_route_node_id or "").strip()
        current_node = None
        for node in route_snapshot.get("nodes") or []:
            if isinstance(node, dict) and str(node.get("id") or "").strip() == current_node_id:
                current_node = node
                break
        if current_node is None and route_snapshot.get("nodes"):
            nodes = [node for node in route_snapshot.get("nodes") or [] if isinstance(node, dict)]
            current_index = int(batch.current_step_index or 0)
            current_node = next(
                (node for node in nodes if int(node.get("route_index") or 0) == current_index),
                nodes[0] if nodes else None,
            )
        jobs = list(
            batch.jobs.select_related("work_center", "machine", "operator", "current_process", "process")
            .order_by("current_step_index", "created_at")
        )
        return {
            "id": str(batch.id),
            "batch_number": batch.batch_number,
            "batch_sequence": batch.batch_sequence,
            "status": batch.status,
            "planned_qty": float(batch.planned_qty),
            "planned_uom": batch.planned_uom,
            "produced_qty_kg": float(batch.produced_qty_kg),
            "produced_qty_pcs": float(batch.produced_qty_pcs),
            "packed_qty_kg": float(batch.packed_qty_kg),
            "packed_qty_pcs": float(batch.packed_qty_pcs),
            "dispatched_qty_kg": float(batch.dispatched_qty_kg),
            "dispatched_qty_pcs": float(batch.dispatched_qty_pcs),
            "current_step_index": batch.current_step_index,
            "current_route_node_id": batch.current_route_node_id,
            "current_route_branch_key": batch.current_route_branch_key,
            "current_route_node_label": str((current_node or {}).get("label") or ""),
            "current_route_process_code": str((current_node or {}).get("process_code") or ""),
            "current_route_join_key": str((current_node or {}).get("join_key") or ""),
            "current_route_parallel_group": str((current_node or {}).get("parallel_group") or ""),
            "route_graph": route_snapshot,
            "allow_partial_movement": batch.allow_partial_movement,
            "required_input_refs": batch.required_input_refs or [],
            "matched_input_refs": batch.matched_input_refs or [],
            "source": batch.source,
            "jobs": [
                {
                    "id": str(job.id),
                    "job_number": job.job_number,
                    "job_state": job.job_state,
                    "status": job.status,
                    "quantity": float(job.quantity),
                    "uom": job.uom,
                    "produced_qty": float(job.produced_qty),
                    "remaining_qty": float(job.remaining_qty),
                    "work_center": getattr(getattr(job, "work_center", None), "name", "") or "",
                    "machine": getattr(getattr(job, "machine", None), "name", "") or "",
                    "operator": getattr(getattr(job, "operator", None), "full_name", "") or getattr(getattr(job, "operator", None), "username", "") or "",
                    "process_code": getattr(getattr(job, "current_process", None), "code", "") or getattr(getattr(job, "process", None), "code", "") or "",
                    "process_name": getattr(getattr(job, "current_process", None), "name", "") or getattr(getattr(job, "process", None), "name", "") or "",
                    "route_node_id": job.route_node_id,
                    "route_branch_key": job.route_branch_key,
                    "current_step_index": job.current_step_index,
                    "is_on_hold": bool(job.is_on_hold),
                }
                for job in jobs
            ],
        }


# Late import avoids circular model import during Django app loading.
from apps.production.models import ProductionJob  # noqa: E402
