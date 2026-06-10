from django.db import transaction
from django.core.exceptions import ValidationError
from decimal import Decimal, ROUND_HALF_UP
from django.db.models import Sum, Q, Max
from apps.artwork.print_contract import validate_frozen_printing_snapshot
from apps.production.models import (
    ProductionJob,
    JobMaterialRequirement,
    FinishedGoodsBatch,
    WorkCenterAssignment,
    MaterialConsumptionLog,
    JobExecutionLog,
    ScrapLog,
    InkBlendTransaction,
)
from apps.inventory.models import (
    InkMaterial,
    InventoryRoll,
    InventoryReservation,
    InventoryBulk,
    RollLink,
    RollConsumption,
    RollMovement,
    InventoryLocation,
)
from apps.materials.models import InventoryMaterial
from apps.materials.stock_forms import normalize_stock_form, normalize_width_basis
from apps.inventory.services.bulk_service import BulkService
from apps.production.services.stock_form_resolver import StockFormResolver

class ExecutionService:
    """
    Phase 64B: core Manufacturing Execution System (MES) logic.
    Handles BOM explosion, Rigorous Inventory Reservation, and Context Loading.
    """
    MACHINE_CLOSE_TOLERANCE_RATIO = Decimal("0.15")
    MACHINE_CLOSE_TOLERANCE_MIN_KG = Decimal("0.25")

    @classmethod
    def _execution_model_version(cls, job):
        # Hard-cut runtime: V2 only.
        return 2

    @classmethod
    def _is_v2(cls, job):
        return True

    @classmethod
    def _behavior_entry_mode(cls, behavior):
        return {
            "CREATE_NEW": "ROLL_MULTI",
            "MODIFY_EXISTING": "ROLL_SINGLE",
            "MULTI_INPUT_COMBINE": "ROLL_SINGLE",
            "SPLIT": "GRID_SPLIT",
            "NONE": "DISCRETE_ONLY",
        }.get(str(behavior or "").upper(), "PROCESS_DEFAULT")

    @classmethod
    def _target_source_label(cls, source):
        return {
            "V2_COMBINE_RESERVED_TOTAL": "Total weight of all reserved input rolls",
            "V2_STEP0_RESERVED_TOTAL": "Total weight of the reserved raw roll",
            "V2_STEP0_RESERVED_LAYER": "BOM layer matching the reserved roll material",
            "V2_STEP0_RESERVED_ACTUAL_WEIGHT": "Actual weight of reserved roll because it did not match a BOM layer",
            "V2_STEP0_HEAVIEST_PURCHASE_LAYER": "Heaviest purchasable BOM layer by density",
            "V2_COMBINE_FILM_SUM": "Sum of all BOM film layer weights for the order",
            "V2_STEP_VARIANT_MATCH": "Film layers matching the output variant",
            "V2_ROLL_MASS_TARGET": "Order quantity for roll-mass job",
            "V2_FINAL_STEP_ORDER_TARGET": "Final route step uses the full order target",
            "V2_FINAL_STEP_PARTIAL_REPLAN_TARGET": "Partial replan final step uses remaining job demand",
            "V2_TARGET_UNRESOLVED": "Target could not be resolved",
            "V2_DEFAULT": "Default target derivation",
        }.get(str(source or ""), "Unknown target derivation")

    @classmethod
    def _job_geometry_snapshot(cls, job):
        if getattr(job, "sales_order_item", None) and getattr(job.sales_order_item, "geometry_snapshot", None):
            return job.sales_order_item.geometry_snapshot
        if getattr(job, "mts_order", None) and getattr(job.mts_order, "geometry_snapshot", None):
            return job.mts_order.geometry_snapshot
        return {}

    @classmethod
    def _job_layer_snapshot(cls, job):
        if getattr(job, "sales_order_item", None) and getattr(job.sales_order_item, "layer_snapshot", None):
            return job.sales_order_item.layer_snapshot
        if getattr(job, "mts_order", None) and getattr(job.mts_order, "layer_snapshot", None):
            return job.mts_order.layer_snapshot
        return []

    @classmethod
    def _job_printing_snapshot(cls, job):
        if getattr(job, "sales_order_item", None) and getattr(job.sales_order_item, "printing_snapshot", None):
            return job.sales_order_item.printing_snapshot
        if getattr(job, "mts_order", None) and getattr(job.mts_order, "printing_snapshot", None):
            return job.mts_order.printing_snapshot
        return {}

    @classmethod
    def _generic_mix_return_ink(cls, source_material):
        base_type = str(getattr(source_material, "base_type", "") or "").strip().upper()
        if base_type not in {"POLY", "PET"}:
            identity = f"{getattr(source_material, 'code', '')} {getattr(source_material, 'name', '')}".upper()
            base_type = "PET" if "PET" in identity else "POLY"
        ink, _ = InkMaterial.objects.get_or_create(
            base_type=base_type,
            color_name="MIX RETURN",
            defaults={
                "code": f"INK-{base_type}-MIX-RETURN",
                "name": f"{base_type} MIX RETURN",
                "swatch_hex": "",
            },
        )
        return ink

    @classmethod
    def _job_addons_snapshot(cls, job):
        if getattr(job, "sales_order_item", None) and getattr(job.sales_order_item, "addons_snapshot", None):
            return job.sales_order_item.addons_snapshot
        if getattr(job, "mts_order", None) and getattr(job.mts_order, "addons_snapshot", None):
            return job.mts_order.addons_snapshot
        return []

    @classmethod
    def _planned_issue_qty(cls, theoretical_qty: Decimal, mode: str, value: Decimal) -> Decimal:
        theoretical_qty = Decimal(str(theoretical_qty or 0))
        value = Decimal(str(value or 0))
        mode = str(mode or "NONE").upper()
        if theoretical_qty < 0:
            theoretical_qty = Decimal("0")
        if mode == "PERCENT_OVER_THEORY":
            return (theoretical_qty * (Decimal("1") + (value / Decimal("100")))).quantize(Decimal("0.0001"))
        if mode == "FIXED_EXTRA_KG":
            return (theoretical_qty + value).quantize(Decimal("0.0001"))
        if mode == "MINIMUM_ISSUE_KG":
            return max(theoretical_qty, value).quantize(Decimal("0.0001"))
        return theoretical_qty.quantize(Decimal("0.0001"))

    @classmethod
    def _summarize_planning_lines(cls, rows):
        line_count = 0
        override_count = 0
        theoretical_total = Decimal("0")
        planned_total = Decimal("0")
        for row in rows if isinstance(rows, list) else []:
            if not isinstance(row, dict):
                continue
            line_count += 1
            theoretical_total += Decimal(str(row.get("theoretical_qty") or 0))
            planned_total += Decimal(str(row.get("planned_issue_qty") or 0))
            if str(row.get("policy_source") or "").upper() == "WCM_OVERRIDE":
                override_count += 1
        return {
            "line_count": line_count,
            "override_count": override_count,
            "default_count": max(0, line_count - override_count),
            "theoretical_total_qty": float(theoretical_total.quantize(Decimal("0.0001"))),
            "planned_issue_total_qty": float(planned_total.quantize(Decimal("0.0001"))),
            "uom": "KG",
        }

    @classmethod
    def _current_step_issue_policy_override_map(cls, job):
        override_map = {}
        raw_overrides = getattr(job, "current_step_issue_policy_overrides", None) or []
        if getattr(job, "pk", None):
            raw_overrides = (
                ProductionJob.objects
                .filter(pk=job.pk)
                .values_list("current_step_issue_policy_overrides", flat=True)
                .first()
                or raw_overrides
            )
        for row in raw_overrides:
            if not isinstance(row, dict):
                continue
            policy_key = str(row.get("policy_key") or "").strip()
            if not policy_key:
                continue
            mode = str(row.get("issue_policy_mode") or "NONE").upper()
            if mode not in {"NONE", "PERCENT_OVER_THEORY", "FIXED_EXTRA_KG", "MINIMUM_ISSUE_KG"}:
                mode = "NONE"
            if mode == "NONE":
                continue
            override_map[policy_key] = {
                "issue_policy_mode": mode,
                "issue_policy_value": Decimal(str(row.get("issue_policy_value") or 0)),
                "reason": str(row.get("reason") or "").strip(),
            }
        return override_map

    @classmethod
    def _requirement_policy_key(cls, requirement):
        return f"requirement:{requirement.id}"

    @classmethod
    def _requirement_category_aliases(cls, material):
        category = str(getattr(material, "category", "") or "").strip().upper()
        aliases = [category] if category else []
        if category in {"ADHESIVE", "SOLVENT"}:
            aliases.append("CHEMICAL")
        if category in {"GRANULE", "RAW_MATERIAL"}:
            aliases.extend(["GRANULE", "RAW_MATERIAL"])
        return list(dict.fromkeys([alias for alias in aliases if alias]))

    @classmethod
    def _resolve_requirement_template_material(cls, requirement):
        step = getattr(requirement, "process_step", None)
        material = getattr(requirement, "material", None)
        if not step or not material:
            return None
        rows = list(step.materials.select_related("material").all())
        exact_rows = [row for row in rows if row.material_id and str(row.material_id) == str(material.id)]
        if exact_rows:
            return exact_rows[0]
        category_aliases = set(cls._requirement_category_aliases(material))
        for row in rows:
            if str(row.category_code or "").strip().upper() in category_aliases:
                return row
        return None

    @classmethod
    def current_step_requirement_policy_items(cls, job, sync_requirements=False):
        current_step_sequence = int(getattr(job, "current_step_index", 0) or 0) + 1
        override_map = cls._current_step_issue_policy_override_map(job)
        requirements = (
            job.material_requirements
            .select_related("material", "process_step")
            .filter(process_step__sequence_number=current_step_sequence)
            .order_by("process_step__sequence_number", "material__name", "id")
        )
        items = []
        sync_updates = []
        for requirement in requirements:
            material = requirement.material
            template_row = cls._resolve_requirement_template_material(requirement)
            template_mode = str(getattr(template_row, "issue_policy_mode", "") or "NONE").upper()
            if template_mode not in {"NONE", "PERCENT_OVER_THEORY", "FIXED_EXTRA_KG", "MINIMUM_ISSUE_KG"}:
                template_mode = "NONE"
            template_value = Decimal(str(getattr(template_row, "issue_policy_value", 0) or 0))
            theoretical_qty = Decimal(str(requirement.theoretical_qty or requirement.required_qty or requirement.planned_issue_qty or 0))
            policy_key = cls._requirement_policy_key(requirement)
            override = override_map.get(policy_key)
            effective_mode = template_mode
            effective_value = template_value
            policy_source = "TEMPLATE_DEFAULT"
            override_reason = ""
            if override:
                effective_mode = str(override.get("issue_policy_mode") or template_mode or "NONE").upper()
                effective_value = Decimal(str(override.get("issue_policy_value") or 0))
                policy_source = "WCM_OVERRIDE"
                override_reason = str(override.get("reason") or "")
            planned_issue_qty = cls._planned_issue_qty(theoretical_qty, effective_mode, effective_value)
            item = {
                "policy_key": policy_key,
                "requirement_id": str(requirement.id),
                "material_id": str(requirement.material_id),
                "material_name": str(getattr(material, "name", "") or getattr(material, "code", "") or "Material"),
                "material_code": str(getattr(material, "code", "") or ""),
                "category_code": str(getattr(material, "category", "") or getattr(template_row, "category_code", "") or ""),
                "step_sequence": current_step_sequence,
                "step_name": str(getattr(getattr(requirement, "process_step", None), "process", None).name if getattr(getattr(requirement, "process_step", None), "process", None) else ""),
                "theoretical_qty": float(theoretical_qty),
                "stored_planned_issue_qty": float(Decimal(str(requirement.planned_issue_qty or 0)).quantize(Decimal("0.0001"))),
                "planned_issue_qty": float(planned_issue_qty),
                "required_qty": float(Decimal(str(requirement.required_qty or 0)).quantize(Decimal("0.0001"))),
                "template_issue_policy_mode": template_mode,
                "template_issue_policy_value": float(template_value),
                "effective_issue_policy_mode": effective_mode,
                "effective_issue_policy_value": float(effective_value),
                "policy_source": policy_source,
                "override_reason": override_reason,
                "capture_mode": str(getattr(template_row, "capture_mode", "") or ""),
            }
            items.append(item)
            if sync_requirements and Decimal(str(requirement.planned_issue_qty or 0)).quantize(Decimal("0.0001")) != planned_issue_qty:
                requirement.planned_issue_qty = planned_issue_qty
                sync_updates.append(requirement)
        if sync_updates:
            JobMaterialRequirement.objects.bulk_update(sync_updates, ["planned_issue_qty", "updated_at"])
        return items

    @classmethod
    def sync_current_step_issue_policy_plan(cls, job):
        return cls.current_step_requirement_policy_items(job, sync_requirements=True)

    @classmethod
    def _apply_current_step_issue_policy_overrides(cls, job, snapshot):
        payload = dict(snapshot or {})
        planning_lines = payload.get("planning_lines") if isinstance(payload.get("planning_lines"), list) else []
        if not planning_lines:
            return payload
        override_map = cls._current_step_issue_policy_override_map(job)
        if not override_map:
            return payload

        current_step_seq = int(getattr(job, "current_step_index", 0) or 0) + 1
        updated_lines = []
        for row in planning_lines:
            if not isinstance(row, dict):
                continue
            next_row = dict(row)
            if int(row.get("step_sequence") or 0) != current_step_seq:
                updated_lines.append(next_row)
                continue
            policy_key = str(row.get("policy_key") or "").strip()
            override = override_map.get(policy_key)
            if not override:
                updated_lines.append(next_row)
                continue
            theoretical_qty = Decimal(str(row.get("theoretical_qty") or 0))
            effective_mode = str(override.get("issue_policy_mode") or row.get("effective_issue_policy_mode") or row.get("template_issue_policy_mode") or "NONE").upper()
            effective_value = Decimal(str(override.get("issue_policy_value") or 0))
            next_row["override_issue_policy_mode"] = effective_mode
            next_row["override_issue_policy_value"] = float(effective_value)
            next_row["effective_issue_policy_mode"] = effective_mode
            next_row["effective_issue_policy_value"] = float(effective_value)
            next_row["planned_issue_qty"] = float(cls._planned_issue_qty(theoretical_qty, effective_mode, effective_value))
            next_row["policy_source"] = "WCM_OVERRIDE"
            next_row["override_reason"] = str(override.get("reason") or "")
            updated_lines.append(next_row)

        payload["planning_lines"] = updated_lines
        payload["planning_summary"] = cls._summarize_planning_lines(updated_lines)
        return payload

    @classmethod
    def _job_bom_snapshot(cls, job):
        if getattr(job, "sales_order_item", None) and getattr(job.sales_order_item, "bom_snapshot", None):
            return cls._apply_current_step_issue_policy_overrides(job, job.sales_order_item.bom_snapshot)
        if getattr(job, "mts_order", None) and getattr(job.mts_order, "bom_snapshot", None):
            return cls._apply_current_step_issue_policy_overrides(job, job.mts_order.bom_snapshot)
        return {}

    @classmethod
    def _job_packaging_snapshot(cls, job):
        if getattr(job, "sales_order_item", None) and getattr(job.sales_order_item, "packaging_snapshot", None):
            return job.sales_order_item.packaging_snapshot
        if getattr(job, "mts_order", None) and getattr(job.mts_order, "packaging_snapshot", None):
            return job.mts_order.packaging_snapshot
        return {}

    @classmethod
    def _is_roll_mass_job(cls, job):
        template = (
            getattr(job, "template", None)
            or getattr(getattr(job, "sales_order_item", None), "template", None)
            or getattr(getattr(job, "mts_order", None), "template", None)
        )
        return str(getattr(template, "fg_type", "") or "").upper() == "ROLL"

    @classmethod
    def _is_packaging_purpose_job(cls, job):
        mts_order = getattr(job, "mts_order", None)
        stock_purpose = (
            getattr(mts_order, "stock_purpose", None)
            if mts_order is not None
            else getattr(job, "stock_purpose", None)
        )
        return str(stock_purpose or "").upper() == "PACKAGING"

    @classmethod
    def _is_piece_primary_roll_to_bulk_job(cls, job, process=None):
        process = process or getattr(job, "current_process", None) or getattr(job, "process", None)
        if not cls._is_packaging_purpose_job(job):
            return False
        job_uom = getattr(job, "uom", None) or getattr(job, "quantity_uom", None) or "KG"
        if str(job_uom or "KG").upper() != "PCS":
            return False
        input_form = str(getattr(process, "input_form", "") or "").upper()
        output_form = str(getattr(process, "output_form", "") or "").upper()
        return input_form == "ROLL" and output_form == "BULK"

    @classmethod
    def _allow_non_lineage_roll_discovery(cls, job, process=None):
        process = process or getattr(job, "current_process", None) or getattr(job, "process", None)
        if not process:
            return False
        return str(getattr(process, "input_form", "") or "").upper() == "ROLL"

    @classmethod
    def _allow_non_lineage_roll_auto_pick(cls, job, process=None):
        process = process or getattr(job, "current_process", None) or getattr(job, "process", None)
        return cls._is_piece_primary_roll_to_bulk_job(job, process=process)

    @classmethod
    def _allow_non_lineage_roll_fallback(cls, job, process=None):
        # Backward-compatible alias for older call sites; auto-pick fallback
        # remains intentionally narrower than discovery.
        return cls._allow_non_lineage_roll_auto_pick(job, process=process)

    @classmethod
    def _resolve_primary_step_metrics(
        cls,
        job,
        *,
        process=None,
        step_target_total_kg,
        step_produced_kg,
        step_remaining_kg,
        step_target_pcs,
        step_produced_pcs,
        step_remaining_pcs,
        tolerance_kg,
    ):
        process = process or getattr(job, "current_process", None) or getattr(job, "process", None)
        target_kg = cls._safe_decimal(step_target_total_kg)
        produced_kg = cls._safe_decimal(step_produced_kg)
        remaining_kg = cls._safe_decimal(step_remaining_kg)
        target_pcs = cls._safe_decimal(step_target_pcs)
        produced_pcs = cls._safe_decimal(step_produced_pcs)
        remaining_pcs = cls._safe_decimal(step_remaining_pcs)
        tolerance_kg = cls._safe_decimal(tolerance_kg)

        if cls._is_piece_primary_roll_to_bulk_job(job, process=process):
            primary_uom = "PCS"
            secondary_uom = "KG"
            target_primary = cls._safe_decimal(getattr(job, "quantity", 0))
            produced_primary = cls._safe_decimal(getattr(job, "produced_qty", 0))
            remaining_primary = cls._safe_decimal(getattr(job, "remaining_qty", 0))
            if target_primary > 0 and produced_primary > target_primary:
                produced_primary = target_primary
            if remaining_primary <= 0 and target_primary > 0:
                remaining_primary = target_primary - produced_primary
            if remaining_primary < 0:
                remaining_primary = Decimal("0")
            target_pcs = target_primary
            produced_pcs = produced_primary
            remaining_pcs = remaining_primary
            tolerance_primary = Decimal("0.01")
        else:
            primary_uom = "KG"
            secondary_uom = "PCS" if any(
                value is not None
                for value in (step_target_pcs, step_produced_pcs, step_remaining_pcs)
            ) else None
            target_primary = target_kg
            produced_primary = produced_kg
            remaining_primary = remaining_kg
            tolerance_primary = tolerance_kg

        return {
            "primary_uom": primary_uom,
            "secondary_uom": secondary_uom,
            "step_target_pcs": float(target_pcs) if step_target_pcs is not None or primary_uom == "PCS" else None,
            "step_produced_pcs": float(produced_pcs) if step_produced_pcs is not None or primary_uom == "PCS" else None,
            "step_remaining_pcs": float(remaining_pcs) if step_remaining_pcs is not None or primary_uom == "PCS" else None,
            "step_target_primary": float(target_primary),
            "step_produced_primary": float(produced_primary),
            "step_remaining_primary": float(remaining_primary),
            "tolerance_primary": float(tolerance_primary),
        }

    @classmethod
    def _step0_purchasable_variant_ids(cls, job):
        variant_ids = set()
        snapshot = cls._job_bom_snapshot(job) or {}
        films = snapshot.get("films", []) if isinstance(snapshot, dict) else []
        for film in films:
            if not isinstance(film, dict):
                continue
            if str(film.get("source") or "").upper() != "PURCHASE":
                continue
            variant_id = film.get("variant_id") or film.get("material_id")
            if variant_id:
                variant_ids.add(str(variant_id))
        return variant_ids

    @classmethod
    def _first_layer_snapshot(cls, job):
        layer_snapshot = cls._job_layer_snapshot(job)
        if isinstance(layer_snapshot, list) and layer_snapshot and isinstance(layer_snapshot[0], dict):
            return layer_snapshot[0]
        return {}

    @classmethod
    def _job_layer_count(cls, job):
        layer_snapshot = cls._job_layer_snapshot(job)
        if not isinstance(layer_snapshot, list):
            return 0
        return len([layer for layer in layer_snapshot if isinstance(layer, dict)])

    @classmethod
    def _is_lane_group_combine_spec(cls, step_roll_spec):
        return str((step_roll_spec or {}).get("combine_mode") or "").upper() == "LANE_GROUPS"

    @classmethod
    def _infer_lamination_pass_index(cls, job, process=None):
        process = process or job.current_process or job.process
        if not process or str(getattr(process, "roll_behavior", "") or "").upper() != "MULTI_INPUT_COMBINE":
            return 0
        current_idx = int(getattr(job, "current_step_index", 0) or 0)
        pass_index = 0
        try:
            ordered_codes = list(getattr(getattr(job, "routing_rule", None), "ordered_processes", None) or [])
            if ordered_codes:
                from apps.factory.models import Process

                combine_codes = set(
                    Process.objects.filter(
                        code__in=ordered_codes,
                        roll_behavior="MULTI_INPUT_COMBINE",
                    ).values_list("code", flat=True)
                )
                for idx, code in enumerate(ordered_codes):
                    if idx > current_idx:
                        break
                    if code in combine_codes:
                        pass_index += 1
                return max(pass_index, 1)
        except Exception:
            pass
        return 1

    @classmethod
    def _lane_active_min_layer_count(cls, job, process=None, step_roll_spec=None):
        step_roll_spec = step_roll_spec or cls._resolve_step_roll_spec(job, process)
        explicit = int(step_roll_spec.get("active_min_layer_count") or 0)
        if explicit > 0:
            return explicit
        pass_index = int(step_roll_spec.get("lamination_pass_index") or cls._infer_lamination_pass_index(job, process) or 1)
        return 2 if pass_index <= 1 else pass_index + 1

    @classmethod
    def _is_step_active_for_layer_count(cls, job, process=None, step_roll_spec=None):
        process = process or job.current_process or job.process
        if not process or str(getattr(process, "roll_behavior", "") or "").upper() != "MULTI_INPUT_COMBINE":
            return True
        step_roll_spec = step_roll_spec or cls._resolve_step_roll_spec(job, process)
        if not cls._is_lane_group_combine_spec(step_roll_spec):
            return True
        layer_count = cls._job_layer_count(job)
        if layer_count <= 0:
            return True
        return layer_count >= cls._lane_active_min_layer_count(job, process, step_roll_spec)

    @classmethod
    def _route_lamination_step_count(cls, job):
        try:
            ordered_codes = list(getattr(getattr(job, "routing_rule", None), "ordered_processes", None) or [])
            if not ordered_codes:
                return 0
            from apps.factory.models import Process

            combine_codes = set(
                Process.objects.filter(
                    code__in=ordered_codes,
                    roll_behavior="MULTI_INPUT_COMBINE",
                ).values_list("code", flat=True)
            )
            return len([code for code in ordered_codes if code in combine_codes])
        except Exception:
            return 0

    @classmethod
    def _resolve_step_roll_spec(cls, job, process=None):
        process = process or job.current_process or job.process
        behavior = (getattr(process, "roll_behavior", None) or "NONE").upper()
        input_form = (getattr(process, "input_form", None) or "BULK").upper()
        output_form = (getattr(process, "output_form", None) or "ROLL").upper()
        layer0 = cls._first_layer_snapshot(job)

        default_input_count = 0
        if input_form == "ROLL":
            default_input_count = 2 if behavior == "MULTI_INPUT_COMBINE" else 1

        spec = {
            "template_step_id": None,
            "input_roll_count": default_input_count,
            "output_variant_id": str(layer0.get("variant_id") or layer0.get("material_id")) if (layer0.get("variant_id") or layer0.get("material_id")) else None,
            "output_variant_name": layer0.get("variant_name") or layer0.get("name"),
            "output_variant_code": layer0.get("variant_code") or layer0.get("material_code") or layer0.get("code"),
            "output_grade_id": str(layer0.get("grade_id")) if layer0.get("grade_id") else None,
            "output_grade_name": layer0.get("grade_name") or layer0.get("grade"),
            "thickness_rule": "TEMPLATE_DEFAULT",
            "fixed_thickness_micron": None,
            "width_rule": "TEMPLATE_DEFAULT",
            "fixed_width_mm": None,
            "operator_entry_mode": "PROCESS_DEFAULT",
            "combine_mode": "LANE_GROUPS" if behavior == "MULTI_INPUT_COMBINE" else "STRICT_ROLL_COUNT",
            "input_lane_count": 2 if behavior == "MULTI_INPUT_COMBINE" else 0,
            "lamination_pass_index": 0,
            "active_min_layer_count": 2 if behavior == "MULTI_INPUT_COMBINE" else 0,
            "adhesive_split_pct": None,
            "solvent_split_pct": None,
            "lane_schema": [],
            "source": "DEFAULT",
        }

        if behavior == "CREATE_NEW":
            spec["thickness_rule"] = "FIXED"
            spec["fixed_thickness_micron"] = layer0.get("thickness_micron") or layer0.get("thickness")
            spec["width_rule"] = "OPERATOR"
            spec["operator_entry_mode"] = "ROLL_MULTI"
        elif behavior == "MODIFY_EXISTING":
            spec["thickness_rule"] = "INHERIT_INPUT"
            spec["width_rule"] = "LOCK_INPUT"
        elif behavior == "MULTI_INPUT_COMBINE":
            spec["thickness_rule"] = "SUM_INPUTS"
            spec["width_rule"] = "MIN_INPUT"
        elif behavior == "SPLIT":
            spec["thickness_rule"] = "INHERIT_INPUT"
            spec["width_rule"] = "OPERATOR_GRID"
            spec["operator_entry_mode"] = "GRID_SPLIT"

        if output_form != "ROLL":
            spec["output_variant_id"] = None
            spec["output_variant_name"] = None
            spec["output_variant_code"] = None
            spec["output_grade_id"] = None
            spec["output_grade_name"] = None
            spec["fixed_thickness_micron"] = None

        try:
            from apps.templates.models import TemplateProcessStep

            if job.template_id:
                step = TemplateProcessStep.objects.select_related(
                    "roll_spec",
                ).filter(
                    template_id=job.template_id,
                    sequence_number=job.current_step_index + 1,
                ).first()
                if step:
                    spec["template_step_id"] = str(step.id)
                    rs = getattr(step, "roll_spec", None)
                    if rs:
                        # V2 hard-cut: template roll spec is policy-only. Keep runtime
                        # identity/dimensions sourced from sales or stock-order snapshots.
                        spec.update({
                            "input_roll_count": int(rs.input_roll_count or 0),
                            "combine_mode": getattr(rs, "combine_mode", None) or spec.get("combine_mode"),
                            "input_lane_count": int(getattr(rs, "input_lane_count", 0) or 0),
                            "lamination_pass_index": int(getattr(rs, "lamination_pass_index", 0) or 0),
                            "active_min_layer_count": int(getattr(rs, "active_min_layer_count", 0) or 0),
                            "adhesive_split_pct": getattr(rs, "adhesive_split_pct", None),
                            "solvent_split_pct": getattr(rs, "solvent_split_pct", None),
                            "lane_schema": getattr(rs, "lane_schema", None) or [],
                            "source": "STEP_SPEC",
                        })
                        if rs.thickness_rule and rs.thickness_rule != "TEMPLATE_DEFAULT":
                            spec["thickness_rule"] = rs.thickness_rule
                        if rs.width_rule and rs.width_rule != "TEMPLATE_DEFAULT":
                            spec["width_rule"] = rs.width_rule
                        if rs.operator_entry_mode and rs.operator_entry_mode != "PROCESS_DEFAULT":
                            spec["operator_entry_mode"] = rs.operator_entry_mode
        except Exception:
            pass

        if spec.get("operator_entry_mode") == "PROCESS_DEFAULT":
            spec["operator_entry_mode"] = cls._behavior_entry_mode(behavior)

        if behavior == "MULTI_INPUT_COMBINE" and str(spec.get("combine_mode") or "").upper() == "LANE_GROUPS":
            layer_count = cls._job_layer_count(job)
            route_lamination_steps = cls._route_lamination_step_count(job)
            if int(spec.get("input_lane_count") or 0) <= 0:
                spec["input_lane_count"] = 2
            if int(spec.get("input_roll_count") or 0) <= 0:
                spec["input_roll_count"] = int(spec.get("input_lane_count") or 2)
            if int(spec.get("lamination_pass_index") or 0) <= 0:
                spec["lamination_pass_index"] = cls._infer_lamination_pass_index(job, process)
            if int(spec.get("active_min_layer_count") or 0) <= 0:
                spec["active_min_layer_count"] = cls._lane_active_min_layer_count(job, process, spec)
            if (
                layer_count > int(spec.get("input_lane_count") or 0)
                and int(spec.get("lamination_pass_index") or 1) <= 1
                and route_lamination_steps <= 1
            ):
                spec["input_lane_count"] = layer_count
                spec["input_roll_count"] = max(int(spec.get("input_roll_count") or 0), layer_count)
                spec["active_min_layer_count"] = max(int(spec.get("active_min_layer_count") or 0), layer_count)

        return spec

    @classmethod
    def _required_roll_count(cls, job, process=None, step_roll_spec=None):
        process = process or job.current_process or job.process
        if not process:
            return 0
        # Keep attribute access resilient because tests and helper call sites
        # may pass lightweight process-like objects (e.g., SimpleNamespace).
        behavior = str(getattr(process, "roll_behavior", "NONE") or "NONE").upper()
        input_form = str(getattr(process, "input_form", "BULK") or "BULK").upper()
        output_form = str(getattr(process, "output_form", "ROLL") or "ROLL").upper()

        if input_form != "ROLL":
            return 0

        spec = step_roll_spec or cls._resolve_step_roll_spec(job, process)
        configured = int(spec.get("input_roll_count") or 0)
        inferred_layer_count = 0
        try:
            layer_snapshot = cls._job_layer_snapshot(job)
            if isinstance(layer_snapshot, list):
                inferred_layer_count = len([layer for layer in layer_snapshot if isinstance(layer, dict)])
        except Exception:
            inferred_layer_count = 0

        if behavior == "NONE":
            # Roll -> Bulk NONE mode is operationally one-input by default.
            # This prevents stale template counts from falsely blocking pouching-style steps.
            if output_form == "BULK":
                return 1
            if inferred_layer_count > 1:
                return max(configured, inferred_layer_count)
            # For NONE behavior, honor explicit step-spec count (including 0).
            # If spec is missing/legacy, keep safe fallback of one roll for roll-input steps.
            if "input_roll_count" in spec and spec.get("input_roll_count") is not None:
                return max(0, configured)
            return 1

        if behavior == "MULTI_INPUT_COMBINE":
            if cls._is_lane_group_combine_spec(spec):
                lanes = int(spec.get("input_lane_count") or 0)
                return max(2, lanes or configured or 2)
            if configured > 0 and inferred_layer_count > 0:
                return max(configured, inferred_layer_count)
            if configured > 0:
                return configured
            if inferred_layer_count > 0:
                return max(2, inferred_layer_count)
            return 2
        if behavior in ("MODIFY_EXISTING", "SPLIT"):
            return 1
        if behavior == "CREATE_NEW" and input_form != "ROLL":
            return 0
        return configured if configured > 0 else 1

    @classmethod
    def _safe_decimal(cls, value):
        try:
            return Decimal(str(value if value is not None else 0))
        except Exception:
            return Decimal("0")

    @classmethod
    def _resolve_runtime_output_cap_kg(cls, process, step_profile, input_rolls=None, scrap_qty=Decimal("0")):
        """
        Resolve physically allowed output cap for current log event.
        Rules:
        - Never exceed current step target plus the machine close tolerance.
        - For roll-input steps, never exceed reserved input roll weight minus scrap.
        """
        input_form = str(getattr(process, "input_form", "") or "").upper()
        step_profile = step_profile or {}
        step_remaining_kg = cls._safe_decimal(step_profile.get("step_remaining_kg"))
        step_target_kg = cls._safe_decimal(step_profile.get("step_target_total_kg"))
        step_produced_kg = cls._safe_decimal(step_profile.get("step_produced_kg"))
        tolerance_kg = cls._safe_decimal(step_profile.get("tolerance_kg"))
        if step_remaining_kg < 0:
            step_remaining_kg = Decimal("0")
        if step_target_kg > 0:
            allowed_total_kg = step_target_kg + max(tolerance_kg, Decimal("0"))
            step_cap_kg = allowed_total_kg - max(step_produced_kg, Decimal("0"))
            if step_cap_kg < 0:
                step_cap_kg = Decimal("0")
        else:
            step_cap_kg = step_remaining_kg if step_remaining_kg > 0 else None

        input_cap_kg = None
        if input_form == "ROLL":
            total_input_kg = Decimal("0")
            for roll in (input_rolls or []):
                total_input_kg += cls._safe_decimal(getattr(roll, "weight_kg", 0))
            total_input_kg = max(total_input_kg, Decimal("0"))
            input_cap_kg = total_input_kg - cls._safe_decimal(scrap_qty)
            if input_cap_kg < 0:
                input_cap_kg = Decimal("0")

        if step_cap_kg is not None and input_cap_kg is not None:
            return {
                "max_output_kg": min(step_cap_kg, input_cap_kg),
                "step_cap_kg": step_cap_kg,
                "input_cap_kg": input_cap_kg,
                "cap_source": "STEP_AND_INPUT",
            }
        if step_cap_kg is not None:
            return {
                "max_output_kg": step_cap_kg,
                "step_cap_kg": step_cap_kg,
                "input_cap_kg": input_cap_kg,
                "cap_source": "STEP_ONLY",
            }
        if input_cap_kg is not None:
            return {
                "max_output_kg": input_cap_kg,
                "step_cap_kg": step_cap_kg,
                "input_cap_kg": input_cap_kg,
                "cap_source": "INPUT_ONLY",
            }
        return {
            "max_output_kg": None,
            "step_cap_kg": step_cap_kg,
            "input_cap_kg": input_cap_kg,
            "cap_source": "UNBOUNDED",
        }

    @classmethod
    def _machine_close_tolerance_kg(cls, step_target_total_kg):
        target = cls._safe_decimal(step_target_total_kg)
        if target <= 0:
            return cls.MACHINE_CLOSE_TOLERANCE_MIN_KG
        return max(cls.MACHINE_CLOSE_TOLERANCE_MIN_KG, target * cls.MACHINE_CLOSE_TOLERANCE_RATIO)

    @classmethod
    def _resolve_roll_density(cls, roll):
        """
        Density precedence for auto-pick:
        1) material.parent_family.density_gcm3
        2) material.density_gcm3
        3) unresolved (None)
        """
        material = getattr(roll, "material", None)
        if not material:
            return None

        family = getattr(material, "parent_family", None)
        family_density = getattr(family, "density_gcm3", None) if family else None
        if family_density is not None:
            try:
                return Decimal(str(family_density))
            except Exception:
                return None

        material_density = getattr(material, "density_gcm3", None)
        if material_density is not None:
            try:
                return Decimal(str(material_density))
            except Exception:
                return None
        return None

    @classmethod
    def _resolve_density_gcm3(cls, material=None, roll=None, fallback=None):
        if roll is not None:
            existing = getattr(roll, "density_gcm3", None)
            if existing not in (None, ""):
                try:
                    return Decimal(str(existing))
                except Exception:
                    pass
            resolved = cls._resolve_roll_density(roll)
            if resolved is not None:
                return resolved

        ref_material = material or getattr(roll, "material", None)
        if ref_material is not None:
            family = getattr(ref_material, "parent_family", None)
            family_density = getattr(family, "density_gcm3", None) if family else None
            if family_density not in (None, ""):
                try:
                    return Decimal(str(family_density))
                except Exception:
                    pass
            material_density = getattr(ref_material, "density_gcm3", None)
            if material_density not in (None, ""):
                try:
                    return Decimal(str(material_density))
                except Exception:
                    pass

        if fallback not in (None, ""):
            try:
                return Decimal(str(fallback))
            except Exception:
                pass
        return None

    @classmethod
    def _job_unit_weight_g(cls, job):
        """
        Phase 73: Get robust unit weight for scaling.
        Ensures that (Component / Total) * Order Qty always yields correct mass.
        """
        try:
            if cls._is_roll_mass_job(job):
                return Decimal("0")
            # 1. Prefer Sum of BOM Snapshot Components (Most Accurate Source of Truth)
            # This accounts for pouch factors (2x), extra trims, etc. which geometry+layers might miss.
            snap = (job.sales_order_item.bom_snapshot if getattr(job, "sales_order_item", None) else None) or \
                   (getattr(job.template, "bom_schema", None) if getattr(job, "template", None) else None) or {}
            
            if isinstance(snap, dict):
                total_bom_kg = Decimal("0")
                # Sum films (These represent the final laminate layers)
                for f in snap.get('films', []):
                    if isinstance(f, dict):
                        total_bom_kg += Decimal(str(f.get('weight_kg', 0) or 0))
                
                # Exclude Granules: They are inputs to Extruded Films. 
                # Summing them + Films would double-count mass.
                
                # Sum inks/chemicals/addons if relevant (usually small, but good to include)
                for i in snap.get('inks', []):
                    if isinstance(i, dict):
                        total_bom_kg += Decimal(str(i.get('weight_kg', 0) or 0))

                for c in snap.get('chemicals', []):
                    if isinstance(c, dict):
                        total_bom_kg += Decimal(str(c.get('weight_kg', 0) or 0))
                
                for a in snap.get('addons', []):
                    if isinstance(a, dict):
                        total_bom_kg += Decimal(str(a.get('weight_kg', 0) or 0))

                if total_bom_kg > 0:
                     return total_bom_kg * Decimal("1000")

            # 2. Fallback to Physics (Layer Schema Sum)
            # Risk: might miss pouch factors (lines/up)
            layer_snap = cls._job_layer_snapshot(job)
            
            if isinstance(layer_snap, list) and layer_snap:
                total_g = Decimal("0")
                g_snap = cls._job_geometry_snapshot(job) or {}
                base = g_snap.get('base', g_snap)
                area_m2 = Decimal("0")
                try:
                    w = Decimal(str(base.get('width_mm', 0)))
                    h = Decimal(str(base.get('height_mm', 0)))
                    area_m2 = (w * h) / Decimal('1000000')
                except Exception:
                    pass

                for l in layer_snap:
                    if not isinstance(l, dict): continue
                    w_g = Decimal(str(l.get('weight_g', 0) or 0))
                    if w_g <= 0 and area_m2 > 0:
                        th = Decimal(str(l.get('thickness_micron', 0) or 0))
                        den = Decimal(str(l.get('density_g_cm3', 0) or 0.92))
                        w_g = area_m2 * th * den
                    total_g += w_g
                
                if total_g > 0:
                    return total_g
            
            # 3. Fallback to BOM snapshot summary (Last resort due to potential poisoning)
            if isinstance(snap, dict) and snap.get('summary', {}).get('unit_weight_g'):
                val = Decimal(str(snap['summary']['unit_weight_g']))
                # If poisoned summary is huge (> 5kg/unit for a pouch??), ignore it
                if val < 5000: 
                    return val
            
            # 4. Fallback to SO item metadata
            val = Decimal(str(getattr(getattr(job, "sales_order_item", None), "unit_weight_g", 0) or 0))
            if val > 0:
                return val
                    
            return Decimal("0")
        except Exception:
            return Decimal("0")

    @classmethod
    def _convert_qty(cls, qty, from_uom, to_uom, unit_weight_g):
        value = Decimal(str(qty or 0))
        from_uom = str(from_uom or "KG").upper()
        to_uom = str(to_uom or "KG").upper()
        unit_weight_g = Decimal(str(unit_weight_g or 0))

        if from_uom == to_uom:
            return value
        if value <= 0:
            return Decimal("0")
        if from_uom == "KG" and to_uom == "PCS":
            if unit_weight_g <= 0:
                return Decimal("0")
            return (value * Decimal("1000")) / unit_weight_g
        if from_uom == "PCS" and to_uom == "KG":
            if unit_weight_g <= 0:
                return Decimal("0")
            return (value * unit_weight_g) / Decimal("1000")
        return Decimal("0")

    @classmethod
    def _build_execution_profile(cls, job):
        """
        Canonical machine execution profile:
        - KG is primary execution truth.
        - PCS is secondary only for discrete-output steps.
        """
        process = job.current_process or job.process
        unit_weight_g = cls._job_unit_weight_g(job)
        job_uom = str(job.uom or "KG").upper()
        piece_primary = cls._is_piece_primary_roll_to_bulk_job(job, process=process)
        is_roll_mass_job = cls._is_roll_mass_job(job)
        supports_secondary_pcs = (
            not is_roll_mass_job
            and (
                str(getattr(process, "output_form", "") or "").upper() == "BULK"
                or job_uom == "PCS"
            )
        )
        derivation_available = supports_secondary_pcs and unit_weight_g > 0

        target_raw = Decimal(str(job.quantity or 0))
        logged_output_kg = Decimal("0")
        for evt in JobExecutionLog.objects.filter(production_job=job).only("quantity", "uom"):
            evt_qty = Decimal(str(evt.quantity or 0))
            evt_uom = str(evt.uom or "KG").upper()
            if evt_uom == "KG":
                logged_output_kg += evt_qty
            else:
                logged_output_kg += cls._convert_qty(evt_qty, evt_uom, "KG", unit_weight_g)

        if job_uom == "KG":
            target_kg = target_raw
            produced_kg = logged_output_kg
            remaining_kg = target_kg - produced_kg
            if remaining_kg < 0:
                remaining_kg = Decimal("0")
            target_pcs = cls._convert_qty(target_kg, "KG", "PCS", unit_weight_g) if derivation_available else None
            produced_pcs = cls._convert_qty(produced_kg, "KG", "PCS", unit_weight_g) if derivation_available else None
            remaining_pcs = cls._convert_qty(remaining_kg, "KG", "PCS", unit_weight_g) if derivation_available else None
        else:
            target_pcs = target_raw
            if piece_primary:
                produced_pcs = Decimal(str(job.produced_qty or 0))
            elif derivation_available:
                produced_pcs = cls._convert_qty(logged_output_kg, "KG", "PCS", unit_weight_g)
            else:
                produced_pcs = Decimal(str(job.produced_qty or 0))
            remaining_pcs = Decimal(str(job.remaining_qty or (target_pcs - produced_pcs) or 0))
            if remaining_pcs <= 0 and target_pcs > 0:
                remaining_pcs = target_pcs - produced_pcs
            if remaining_pcs < 0:
                remaining_pcs = Decimal("0")
            target_kg = cls._convert_qty(target_pcs, "PCS", "KG", unit_weight_g) if derivation_available else None
            produced_kg = (
                cls._convert_qty(produced_pcs, "PCS", "KG", unit_weight_g)
                if derivation_available
                else (logged_output_kg if logged_output_kg > 0 else None)
            )
            remaining_kg = cls._convert_qty(remaining_pcs, "PCS", "KG", unit_weight_g) if derivation_available else None

        def _flt(value):
            if value is None:
                return None
            try:
                return float(value)
            except Exception:
                return None

        return {
            "primary_unit": "PCS" if piece_primary else "KG",
            "secondary_unit": "KG" if piece_primary else ("PCS" if supports_secondary_pcs else None),
            "job_uom": job_uom,
            "unit_weight_g": float(unit_weight_g) if unit_weight_g > 0 else None,
            "derivation_available": bool(derivation_available),
            "progress": {
                "weight_kg": {
                    "target": _flt(target_kg),
                    "produced": _flt(produced_kg),
                    "remaining": _flt(remaining_kg),
                },
                "pcs": {
                    "target": _flt(target_pcs),
                    "produced": _flt(produced_pcs),
                    "remaining": _flt(remaining_pcs),
                },
            },
        }

    @classmethod
    def _process_code_to_stage_name(cls, process_code):
        token = str(process_code or "").upper()
        if not token:
            return None
        stage_hints = (
            ("SLIT", "Slit"),
            ("LAM", "Laminated"),
            ("PRINT", "Printed"),
            ("FLEXO", "Printed"),
            ("EXTR", "Extruded"),
            ("BLOWN", "Extruded"),
            ("FG", "Finished Good"),
            ("PACK", "Finished Good"),
        )
        for hint, stage_name in stage_hints:
            if hint in token:
                return stage_name
        return None

    @classmethod
    def _resolve_upstream_step_target_kg(cls, job):
        """
        For roll-input downstream steps, use previous-step target when direct
        roll-layer derivation is unavailable (avoids regressions to base order weight).
        """
        try:
            current_idx = int(job.current_step_index or 0)
        except Exception:
            return Decimal("0")
        if current_idx <= 0:
            return Decimal("0")

        prev_jobs = ProductionJob.objects.exclude(id=job.id)
        if getattr(job, "sales_order_item_id", None):
            prev_jobs = prev_jobs.filter(sales_order_item_id=job.sales_order_item_id)
        elif getattr(job, "mts_order_id", None):
            prev_jobs = prev_jobs.filter(mts_order_id=job.mts_order_id)
        elif getattr(job, "template_id", None):
            prev_jobs = prev_jobs.filter(template_id=job.template_id)
        else:
            return Decimal("0")

        prev_jobs = prev_jobs.filter(current_step_index=current_idx - 1).order_by(
            "-closed_at", "-updated_at", "-created_at"
        )
        best_target = Decimal("0")
        for prev_job in prev_jobs[:20]:
            try:
                prev_profile = cls._resolve_step_execution_profile(prev_job)
                prev_target = Decimal(str(prev_profile.get("step_target_total_kg") or 0))
                if prev_target > best_target:
                    best_target = prev_target
            except Exception:
                continue
        return best_target

    @classmethod
    def _resolve_order_reference_target_kg(cls, job):
        """
        Route-level display reference for "order total".
        - V2: deterministic sales-driven target (no lineage max inflation).
        - V1: max(step targets across lineage) with base order quantity as floor.
        """
        base_target = Decimal(
            str((((cls._build_execution_profile(job).get("progress") or {}).get("weight_kg") or {}).get("target")) or 0)
        )
        if cls._is_v2(job):
            # V2 must stay deterministic and sales-driven. Do not inflate with lineage maxima.
            item_target = Decimal(str(getattr(getattr(job, "sales_order_item", None), "total_weight_kg", 0) or 0))
            current_step_target = Decimal(
                str((cls._resolve_step_execution_profile(job) or {}).get("step_target_total_kg") or 0)
            )
            # Keep order reference aligned with terminal-step parity logic by
            # taking the strongest deterministic target from known V2 sources.
            return max(base_target, item_target, current_step_target, Decimal("0"))

        current_step_target = Decimal(
            str((cls._resolve_step_execution_profile(job) or {}).get("step_target_total_kg") or 0)
        )
        best_target = max(base_target, current_step_target, Decimal("0"))

        lineage_jobs = ProductionJob.objects.exclude(id=job.id)
        if getattr(job, "sales_order_item_id", None):
            lineage_jobs = lineage_jobs.filter(sales_order_item_id=job.sales_order_item_id)
        elif getattr(job, "mts_order_id", None):
            lineage_jobs = lineage_jobs.filter(mts_order_id=job.mts_order_id)
        elif getattr(job, "template_id", None):
            lineage_jobs = lineage_jobs.filter(template_id=job.template_id)
        else:
            return best_target

        for route_job in lineage_jobs.exclude(job_state="CANCELLED").order_by("current_step_index", "created_at"):
            try:
                route_target = Decimal(str((cls._resolve_step_execution_profile(route_job) or {}).get("step_target_total_kg") or 0))
            except Exception:
                route_target = Decimal("0")
            if route_target > best_target:
                best_target = route_target
        return best_target

    @classmethod
    def get_order_reference_target_kg(cls, job_or_id):
        if isinstance(job_or_id, ProductionJob):
            job = job_or_id
        else:
            job = ProductionJob.objects.select_related("sales_order_item", "template", "mts_order").get(id=job_or_id)
        return float(cls._resolve_order_reference_target_kg(job))

    @classmethod
    def _expected_input_stage_names(cls, job, process=None):
        process = process or job.current_process or job.process
        if not process or str(process.input_form or "").upper() != "ROLL":
            return set()

        behavior = str(process.roll_behavior or "NONE").upper()
        # Combine steps intentionally accept heterogeneous upstream/input-stock rolls.
        if behavior == "MULTI_INPUT_COMBINE":
            return set()

        ordered = list(getattr(job.routing_rule, "ordered_processes", None) or [])
        try:
            current_idx = int(job.current_step_index or 0)
        except Exception:
            current_idx = 0
        if current_idx <= 0 or current_idx > (len(ordered) - 1):
            return set()

        prev_step = ordered[current_idx - 1]
        prev_code = None
        if isinstance(prev_step, dict):
            prev_code = prev_step.get("code") or prev_step.get("process_code") or prev_step.get("name")
        elif isinstance(prev_step, str):
            prev_code = prev_step
        else:
            prev_code = getattr(prev_step, "code", None) or getattr(prev_step, "name", None)

        mapped = cls._process_code_to_stage_name(prev_code)
        if mapped:
            return {mapped}

        # Fallback: derive expected upstream stage from previous lineage step job
        # when routing step tokens are sparse/non-standard.
        try:
            prev_jobs = ProductionJob.objects.exclude(id=job.id)
            if getattr(job, "sales_order_item_id", None):
                prev_jobs = prev_jobs.filter(sales_order_item_id=job.sales_order_item_id)
            elif getattr(job, "mts_order_id", None):
                prev_jobs = prev_jobs.filter(mts_order_id=job.mts_order_id)
            elif getattr(job, "template_id", None):
                prev_jobs = prev_jobs.filter(template_id=job.template_id)
            else:
                return set()

            prev_job = prev_jobs.filter(
                current_step_index=current_idx - 1
            ).exclude(job_state="CANCELLED").order_by(
                "-closed_at", "-updated_at", "-created_at"
            ).select_related("current_process", "process").first()
            if not prev_job:
                return set()

            prev_process = prev_job.current_process or prev_job.process
            prev_code_fallback = (
                getattr(prev_process, "code", None)
                or getattr(prev_process, "name", None)
            )
            mapped_fallback = cls._process_code_to_stage_name(prev_code_fallback)
            return {mapped_fallback} if mapped_fallback else set()
        except Exception:
            return set()

    @classmethod
    def _resolve_step_execution_profile_v2(cls, job):
        process = job.current_process or job.process
        input_form = str(getattr(process, "input_form", "") or "").upper()
        roll_behavior = str(getattr(process, "roll_behavior", "") or "").upper()
        step_seq = (job.current_step_index or 0) + 1
        unit_weight_g = cls._job_unit_weight_g(job)
        is_roll_mass_job = cls._is_roll_mass_job(job)
        step_roll_spec = cls._resolve_step_roll_spec(job, process)

        # Keep requirements in sync with category mapping + SO BOM material identity.
        try:
            cls.calculate_requirements(job.id)
        except Exception:
            pass

        qty_uom = str(job.uom or "KG").upper()
        qty_value = Decimal(str(job.quantity or 0))
        order_qty_kg = Decimal("0")
        if qty_uom == "KG":
            order_qty_kg = qty_value
        elif unit_weight_g > 0:
            order_qty_kg = cls._convert_qty(qty_value, "PCS", "KG", unit_weight_g)

        order_qty_pcs = Decimal("0")
        if qty_uom == "PCS":
            order_qty_pcs = Decimal(str(job.quantity or 0))
        elif unit_weight_g > 0 and not is_roll_mass_job:
            order_qty_pcs = (Decimal(str(job.quantity or 0)) * Decimal("1000")) / unit_weight_g

        bom_snapshot = cls._job_bom_snapshot(job) or {}
        films = bom_snapshot.get("films", []) if isinstance(bom_snapshot, dict) else []

        def _as_decimal(value):
            try:
                return Decimal(str(value or 0))
            except Exception:
                return Decimal("0")

        def _film_density(film):
            den = _as_decimal(film.get("density_g_cm3"))
            if den > 0:
                return den
            mat_id = film.get("variant_id") or film.get("material_id")
            if not mat_id:
                return Decimal("0")
            mat = InventoryMaterial.objects.filter(id=str(mat_id)).select_related("parent_family").first()
            if not mat:
                return Decimal("0")
            fam_den = _as_decimal(getattr(getattr(mat, "parent_family", None), "density_gcm3", None))
            if fam_den > 0:
                return fam_den
            return _as_decimal(getattr(mat, "density_gcm3", None))

        step_roll_target_kg = Decimal("0")
        target_source = "V2_DEFAULT"
        if input_form == "ROLL":
            if is_roll_mass_job:
                reserved_total = (
                    InventoryReservation.objects.filter(
                        job=job,
                        status="ACTIVE",
                        roll__isnull=False,
                    ).aggregate(total=Sum("roll__weight_kg")).get("total")
                    or Decimal("0")
                )
                if roll_behavior == "MULTI_INPUT_COMBINE" and reserved_total > 0:
                    step_roll_target_kg = reserved_total
                    target_source = "V2_COMBINE_RESERVED_TOTAL"
                elif roll_behavior in {"MODIFY_EXISTING", "SPLIT"} and int(job.current_step_index or 0) == 0 and reserved_total > 0:
                    step_roll_target_kg = reserved_total
                    target_source = "V2_STEP0_RESERVED_TOTAL"
                else:
                    step_roll_target_kg = order_qty_kg
                    target_source = "V2_ROLL_MASS_TARGET"
            else:
                if roll_behavior == "MULTI_INPUT_COMBINE":
                    for film in films:
                        if not isinstance(film, dict):
                            continue
                        per_unit_kg = _as_decimal(film.get("weight_kg"))
                        if per_unit_kg > 0 and order_qty_pcs > 0:
                            step_roll_target_kg += per_unit_kg * order_qty_pcs
                    target_source = "V2_COMBINE_FILM_SUM"
                elif roll_behavior in {"MODIFY_EXISTING", "SPLIT"} and int(job.current_step_index or 0) == 0:
                    purch_films = [
                        row for row in films
                        if isinstance(row, dict) and str(row.get("source") or "").upper() == "PURCHASE"
                    ]
                    if not purch_films:
                        purch_films = [row for row in films if isinstance(row, dict)]

                    reserved = InventoryReservation.objects.filter(
                        job=job, status="ACTIVE", roll__isnull=False
                    ).select_related("roll").first()

                    chosen = None
                    if reserved and reserved.roll:
                        roll_mat_id = str(reserved.roll.material_id or "")
                        for film in purch_films:
                            variant_id = str(film.get("variant_id") or film.get("material_id") or "")
                            if variant_id and variant_id == roll_mat_id:
                                chosen = film
                                target_source = "V2_STEP0_RESERVED_LAYER"
                                break
                    if chosen is None and reserved and reserved.roll:
                        reserved_weight = _as_decimal(getattr(reserved.roll, "weight_kg", 0))
                        if reserved_weight > 0:
                            step_roll_target_kg = reserved_weight
                            target_source = "V2_STEP0_RESERVED_ACTUAL_WEIGHT"
                    if chosen is None and step_roll_target_kg <= 0 and purch_films:
                        chosen = max(
                            purch_films,
                            key=lambda row: (
                                _film_density(row),
                                _as_decimal(row.get("weight_kg")),
                            ),
                        )
                        target_source = "V2_STEP0_HEAVIEST_PURCHASE_LAYER"
                    if chosen is not None and order_qty_pcs > 0:
                        step_roll_target_kg = _as_decimal(chosen.get("weight_kg")) * order_qty_pcs
                else:
                    output_variant_id = str(step_roll_spec.get("output_variant_id") or "")
                    matched = []
                    for film in films:
                        if not isinstance(film, dict):
                            continue
                        if not output_variant_id:
                            matched.append(film)
                            continue
                        variant_id = str(film.get("variant_id") or film.get("material_id") or "")
                        if variant_id == output_variant_id:
                            matched.append(film)
                    for film in matched:
                        per_unit_kg = _as_decimal(film.get("weight_kg"))
                        if per_unit_kg > 0 and order_qty_pcs > 0:
                            step_roll_target_kg += per_unit_kg * order_qty_pcs
                    target_source = "V2_STEP_VARIANT_MATCH"

            if step_roll_target_kg <= 0:
                target_source = "V2_TARGET_UNRESOLVED"

        reqs = JobMaterialRequirement.objects.select_related("material", "process_step").filter(
            production_job=job,
            process_step__sequence_number=step_seq,
        )
        step_bulk_target_kg = Decimal("0")
        for req in reqs:
            cat = str(getattr(req.material, "category", "") or "").upper()
            if cat in ("FILM_VARIANT", "FILM_FAMILY"):
                continue
            step_bulk_target_kg += _as_decimal(req.required_qty)

        step_target_total_kg = step_roll_target_kg + step_bulk_target_kg

        # Terminal step for the order must represent full order mass.
        # For stock/semi-FG orders that intentionally stop before route end,
        # parity must apply on stop_step_index as well.
        current_idx = int(job.current_step_index or 0)
        route_last_index = cls._route_last_step_index(job)
        is_route_final_step = current_idx >= route_last_index

        is_order_stop_step = False
        mts_order_ref = getattr(job, "mts_order", None)
        if mts_order_ref is not None:
            try:
                stop_idx = getattr(mts_order_ref, "stop_step_index", None)
                if stop_idx is not None and current_idx >= int(stop_idx):
                    is_order_stop_step = True
            except Exception:
                is_order_stop_step = False

        # Also treat the highest existing downstream step as terminal when the
        # process outputs BULK/FG, which protects against stale route tails.
        is_highest_existing_lineage_step = False
        try:
            lineage_jobs = ProductionJob.objects.exclude(job_state="CANCELLED")
            if getattr(job, "sales_order_item_id", None):
                lineage_jobs = lineage_jobs.filter(sales_order_item_id=job.sales_order_item_id)
            elif getattr(job, "mts_order_id", None):
                lineage_jobs = lineage_jobs.filter(mts_order_id=job.mts_order_id)
            elif getattr(job, "template_id", None):
                lineage_jobs = lineage_jobs.filter(template_id=job.template_id)
            else:
                lineage_jobs = ProductionJob.objects.none()
            max_existing_idx = lineage_jobs.aggregate(max_idx=Max("current_step_index")).get("max_idx")
            if max_existing_idx is not None and current_idx >= int(max_existing_idx):
                out_form = str(getattr(process, "output_form", "") or "").upper()
                is_highest_existing_lineage_step = out_form in {"BULK", "FG", "FG_POUCH", "FG_ROLL"}
        except Exception:
            is_highest_existing_lineage_step = False

        is_terminal_order_step = (
            is_route_final_step
            or is_order_stop_step
            or is_highest_existing_lineage_step
        )

        if is_terminal_order_step:
            # Keep terminal target aligned with route/order card target first.
            # This avoids stale snapshot drift where so_item.total_weight_kg
            # can lag behind the active production job quantity basis.
            order_target_kg = _as_decimal(
                (((cls._build_execution_profile(job).get("progress") or {}).get("weight_kg") or {}).get("target"))
            )
            so_item = getattr(job, "sales_order_item", None)
            mts_order = mts_order_ref
            planner_notes = str(getattr(job, "planner_notes", "") or "").upper()
            is_partial_replan_job = "PARTIAL_REPLAN" in planner_notes
            if so_item is not None:
                order_target_kg = max(order_target_kg, _as_decimal(getattr(so_item, "total_weight_kg", 0)))
            if mts_order is not None:
                order_target_kg = max(order_target_kg, _as_decimal(getattr(mts_order, "target_qty", 0)))
                order_target_kg = max(order_target_kg, _as_decimal(getattr(mts_order, "total_weight_kg", 0)))

            # For planner-triggered partial replan jobs, final step target is the
            # remaining demand quantity passed into the continuation job.
            if is_partial_replan_job:
                partial_job_target_kg = Decimal("0")
                try:
                    job_qty = _as_decimal(getattr(job, "quantity", 0))
                    job_uom = str(getattr(job, "uom", "KG") or "KG").upper()
                    if job_qty > 0:
                        if job_uom == "KG":
                            partial_job_target_kg = job_qty
                        elif unit_weight_g > 0 and job_uom == "PCS":
                            partial_job_target_kg = cls._convert_qty(job_qty, "PCS", "KG", unit_weight_g)
                except Exception:
                    partial_job_target_kg = Decimal("0")
                if partial_job_target_kg > 0:
                    order_target_kg = partial_job_target_kg
                    target_source = "V2_FINAL_STEP_PARTIAL_REPLAN_TARGET"

            if order_target_kg <= 0:
                order_target_kg = Decimal("0")

            if order_target_kg > 0:
                step_target_total_kg = order_target_kg
                step_roll_target_kg = max(Decimal("0"), order_target_kg - step_bulk_target_kg)
                if target_source != "V2_FINAL_STEP_PARTIAL_REPLAN_TARGET":
                    target_source = "V2_FINAL_STEP_ORDER_TARGET"

        produced_kg = Decimal("0")
        for evt in JobExecutionLog.objects.filter(production_job=job).only("quantity", "uom"):
            evt_qty = _as_decimal(evt.quantity)
            evt_uom = str(evt.uom or "KG").upper()
            if evt_uom == "KG":
                produced_kg += evt_qty
            elif evt_uom == "PCS":
                produced_kg += cls._convert_qty(evt_qty, "PCS", "KG", unit_weight_g)
            else:
                produced_kg += cls._convert_qty(evt_qty, job.uom, "KG", unit_weight_g)

        remaining_kg = step_target_total_kg - produced_kg
        if remaining_kg < 0:
            remaining_kg = Decimal("0")
        tolerance_kg = cls._machine_close_tolerance_kg(step_target_total_kg)

        supports_secondary_pcs = (
            not is_roll_mass_job
            and (
                str(getattr(process, "output_form", "") or "").upper() == "BULK"
                or str(getattr(job, "uom", "KG") or "KG").upper() == "PCS"
            )
        )
        step_target_pcs = cls._convert_qty(step_target_total_kg, "KG", "PCS", unit_weight_g) if supports_secondary_pcs and unit_weight_g > 0 else None
        step_produced_pcs = cls._convert_qty(produced_kg, "KG", "PCS", unit_weight_g) if supports_secondary_pcs and unit_weight_g > 0 else None
        step_remaining_pcs = cls._convert_qty(remaining_kg, "KG", "PCS", unit_weight_g) if supports_secondary_pcs and unit_weight_g > 0 else None
        primary_metrics = cls._resolve_primary_step_metrics(
            job,
            process=process,
            step_target_total_kg=step_target_total_kg,
            step_produced_kg=produced_kg,
            step_remaining_kg=remaining_kg,
            step_target_pcs=step_target_pcs,
            step_produced_pcs=step_produced_pcs,
            step_remaining_pcs=step_remaining_pcs,
            tolerance_kg=tolerance_kg,
        )

        return {
            "step_roll_target_kg": float(step_roll_target_kg),
            "step_bulk_target_kg": float(step_bulk_target_kg),
            "step_target_total_kg": float(step_target_total_kg),
            "step_produced_kg": float(produced_kg),
            "step_remaining_kg": float(remaining_kg),
            "step_target_pcs": primary_metrics["step_target_pcs"],
            "step_produced_pcs": primary_metrics["step_produced_pcs"],
            "step_remaining_pcs": primary_metrics["step_remaining_pcs"],
            "tolerance_kg": float(tolerance_kg),
            "primary_uom": primary_metrics["primary_uom"],
            "secondary_uom": primary_metrics["secondary_uom"],
            "step_target_primary": primary_metrics["step_target_primary"],
            "step_produced_primary": primary_metrics["step_produced_primary"],
            "step_remaining_primary": primary_metrics["step_remaining_primary"],
            "tolerance_primary": primary_metrics["tolerance_primary"],
            "derivation_fallback": bool(step_roll_target_kg <= 0 and input_form == "ROLL"),
            "target_source": target_source,
            "target_source_label": cls._target_source_label(target_source),
            "target_source_detail": cls._target_source_label(target_source),
            "roll_spec_variant_id": step_roll_spec.get("output_variant_id") or None,
        }

    @classmethod
    def _resolve_step_execution_profile(cls, job):
        """
        Step-aware execution profile for machine terminal:
        step target = current-step consumables only.
        - For roll-input steps: roll-layer target + current-step bulk target.
        - For bulk-input steps: current-step bulk target only (upstream WIP is context, not target).
        """
        if cls._is_v2(job):
            return cls._resolve_step_execution_profile_v2(job)

        process = job.current_process or job.process
        input_form = str(getattr(process, "input_form", "") or "").upper()
        roll_behavior = str(getattr(process, "roll_behavior", "") or "").upper()
        step_seq = (job.current_step_index or 0) + 1
        unit_weight_g = cls._job_unit_weight_g(job)
        step_roll_spec = cls._resolve_step_roll_spec(job, process)

        order_qty_pcs = Decimal("0")
        if str(job.uom or "KG").upper() == "PCS":
            order_qty_pcs = Decimal(str(job.quantity or 0))
        elif unit_weight_g > 0:
            order_qty_pcs = (Decimal(str(job.quantity or 0)) * Decimal("1000")) / unit_weight_g

        output_variant_id = str(step_roll_spec.get("output_variant_id") or "")
        output_variant_code = str(step_roll_spec.get("output_variant_code") or "").upper()
        output_variant_name = str(step_roll_spec.get("output_variant_name") or "").strip().upper()

        bom_snapshot = (
            (job.sales_order_item.bom_snapshot if getattr(job, "sales_order_item", None) else None)
            or (getattr(job.template, "bom_schema", None) if getattr(job, "template", None) else None)
            or {}
        )
        films = bom_snapshot.get("films", []) if isinstance(bom_snapshot, dict) else []

        derivation_fallback = False
        step_roll_target_kg = Decimal("0")
        if input_form == "ROLL":
            # MULTI_INPUT_COMBINE consumes all required roll inputs into one output roll.
            # Step roll target must include all input film layers, not just output variant layer.
            if roll_behavior == "MULTI_INPUT_COMBINE":
                for film in films:
                    if not isinstance(film, dict):
                        continue
                    per_unit_kg = Decimal(str(film.get("weight_kg") or 0))
                    if per_unit_kg <= 0 or order_qty_pcs <= 0:
                        continue
                    step_roll_target_kg += (per_unit_kg * order_qty_pcs)
            else:
                # Phase 73: Impacting Step 1 MODIFY_EXISTING default target
                use_heaviest_layer = (job.current_step_index == 0 and roll_behavior == "MODIFY_EXISTING")
                
                heaviest_film = None
                max_criteria_value = Decimal("-1")

                # If using heaviest layer logic, pre-fetch densities
                density_map = {}
                if use_heaviest_layer:
                    try:
                        from apps.materials.models import InventoryMaterial
                        p_v_ids = [
                            f.get("variant_id") for f in films 
                            if isinstance(f, dict) and f.get("variant_id") and str(f.get("source") or "").upper() == "PURCHASE"
                        ]
                        if p_v_ids:
                            mats = InventoryMaterial.objects.filter(id__in=p_v_ids).only('id', 'density_gcm3')
                            density_map = {str(m.id): Decimal(str(m.density_gcm3 or 0)) for m in mats}
                    except Exception:
                        pass

                for film in films:
                    if not isinstance(film, dict):
                        continue
                    
                    per_unit_kg = Decimal(str(film.get("weight_kg") or 0))
                    if per_unit_kg <= 0:
                        continue
                    
                    if use_heaviest_layer:
                        # Only consider PURCHASABLE layers (Stage 0) for Step 1 default target
                        source = str(film.get("source") or "").upper()
                        if source == "PURCHASE":
                            # User Request: Use Density as the selection criteria
                            vid = str(film.get("variant_id") or "")
                            density = density_map.get(vid, Decimal("0"))
                            
                            # Fallback to weight if density is missing (though less likely for films)
                            criteria = density if density > 0 else per_unit_kg
                            
                            if criteria > max_criteria_value:
                                max_criteria_value = criteria
                                heaviest_film = film
                        continue

                    variant_id = str(film.get("variant_id") or "")
                    code = str(film.get("code") or "").upper()
                    name = str(film.get("name") or "").strip().upper()

                    matched = False
                    if output_variant_id and variant_id and output_variant_id == variant_id:
                        matched = True
                    elif output_variant_code and code and output_variant_code == code:
                        matched = True
                    elif output_variant_name and name and output_variant_name == name:
                        matched = True

                    if matched and order_qty_pcs > 0:
                        step_roll_target_kg += (per_unit_kg * order_qty_pcs)

                if use_heaviest_layer and heaviest_film and order_qty_pcs > 0:
                    w = Decimal(str(heaviest_film.get("weight_kg") or 0))
                    step_roll_target_kg = w * order_qty_pcs

            if step_roll_target_kg <= 0:
                upstream_target_kg = cls._resolve_upstream_step_target_kg(job)
                if upstream_target_kg > 0:
                    step_roll_target_kg = upstream_target_kg
                else:
                    # Final fallback only when no upstream target is resolvable.
                    derivation_fallback = True
                    order_profile = cls._build_execution_profile(job)
                    step_roll_target_kg = Decimal(
                        str((((order_profile.get("progress") or {}).get("weight_kg") or {}).get("target")) or 0)
                    )


        reqs = JobMaterialRequirement.objects.select_related("material", "process_step").filter(
            production_job=job,
            process_step__sequence_number=step_seq,
        )
        step_bulk_target_kg = Decimal("0")
        for req in reqs:
            cat = str(getattr(req.material, "category", "") or "").upper()
            if cat in ("FILM_VARIANT", "FILM_FAMILY"):
                continue
            step_bulk_target_kg += Decimal(str(req.required_qty or 0))

        step_target_total_kg = step_roll_target_kg + step_bulk_target_kg
        upstream_target_kg = cls._resolve_upstream_step_target_kg(job)

        # Keep downstream roll-input steps aligned with upstream carry-forward mass
        # when direct layer derivation is lower due sparse step metadata.
        if input_form == "ROLL" and upstream_target_kg > 0 and step_roll_target_kg > 0 and step_roll_target_kg < upstream_target_kg:
            step_roll_target_kg = upstream_target_kg
            step_target_total_kg = step_roll_target_kg + step_bulk_target_kg

        # If a step has no direct material target, carry upstream baseline.
        # Phase 73: 1st Step Target Overrides
        # For MODIFY_EXISTING/SPLIT at step 0, if rolls are already reserved,
        # the target weight should match the reserved rolls' mass exactly.
        if job.current_step_index == 0 and input_form == "ROLL" and roll_behavior in ("MODIFY_EXISTING", "SPLIT"):
            # Phase 73: Dynamic Target Switching (User Request)
            # If a roll is explicitly reserved, the step target should match THAT roll's layer weight in the BOM.
            # This overrides the default "Heaviest Density" logic.
            reserved_roll = InventoryReservation.objects.filter(
                job=job, status="ACTIVE", roll__isnull=False
            ).select_related('roll', 'roll__material').first()
            
            if reserved_roll and reserved_roll.roll:
                r_mat_id = str(reserved_roll.roll.material_id or "")
                # Find this material in the BOM films
                matched_layer_weight = Decimal("0")
                for film in films:
                    if not isinstance(film, dict):
                        continue
                    f_vid = str(film.get("variant_id") or "")
                    if f_vid == r_mat_id:
                        matched_layer_weight = Decimal(str(film.get("weight_kg") or 0))
                        break
                
                if matched_layer_weight > 0 and order_qty_pcs > 0:
                    step_roll_target_kg = matched_layer_weight * order_qty_pcs
                    step_target_total_kg = step_roll_target_kg + step_bulk_target_kg
            else:
                res_total = (
                    InventoryReservation.objects.filter(job=job, status="ACTIVE", roll__isnull=False)
                    .aggregate(total=Sum("roll__weight_kg"))
                    .get("total")
                    or Decimal("0")
                )
                if res_total > 0:
                    # Fallback to legacy behavior if we can't map back to BOM layer
                    step_roll_target_kg = res_total
                    step_target_total_kg = step_roll_target_kg + step_bulk_target_kg

        if step_target_total_kg <= 0 and upstream_target_kg > 0:
            step_roll_target_kg = max(step_roll_target_kg, upstream_target_kg)
            step_target_total_kg = step_roll_target_kg + step_bulk_target_kg

        # Safety check: if derivation resulted in a target significantly smaller than total job quantity
        # for a KG-primary job, fallback to the total job quantity to avoid ratio explosions.
        # Placed here to override any upstream/phase-73 logic that relies on broken piece counts.
        if str(job.uom or "KG").upper() == "KG" and step_roll_target_kg > 0:
            job_total_kg = Decimal(str(job.quantity or 0))
            if job_total_kg > 0 and step_roll_target_kg < (job_total_kg * Decimal("0.5")):
                step_roll_target_kg = job_total_kg
                step_target_total_kg = step_roll_target_kg + step_bulk_target_kg

        produced_kg = Decimal("0")
        for evt in JobExecutionLog.objects.filter(production_job=job).only("quantity", "uom"):
            evt_qty = Decimal(str(evt.quantity or 0))
            evt_uom = str(evt.uom or "KG").upper()
            if evt_uom == "KG":
                produced_kg += evt_qty
            elif evt_uom == "PCS":
                produced_kg += cls._convert_qty(evt_qty, "PCS", "KG", unit_weight_g)
            else:
                produced_kg += cls._convert_qty(evt_qty, job.uom, "KG", unit_weight_g)

        remaining_kg = step_target_total_kg - produced_kg
        if remaining_kg < 0:
            remaining_kg = Decimal("0")

        tolerance_kg = cls._machine_close_tolerance_kg(step_target_total_kg)

        supports_secondary_pcs = (
            str(getattr(process, "output_form", "") or "").upper() == "BULK"
            or str(getattr(job, "uom", "KG") or "KG").upper() == "PCS"
        )
        step_target_pcs = cls._convert_qty(step_target_total_kg, "KG", "PCS", unit_weight_g) if supports_secondary_pcs and unit_weight_g > 0 else None
        step_produced_pcs = cls._convert_qty(produced_kg, "KG", "PCS", unit_weight_g) if supports_secondary_pcs and unit_weight_g > 0 else None
        step_remaining_pcs = cls._convert_qty(remaining_kg, "KG", "PCS", unit_weight_g) if supports_secondary_pcs and unit_weight_g > 0 else None
        primary_metrics = cls._resolve_primary_step_metrics(
            job,
            process=process,
            step_target_total_kg=step_target_total_kg,
            step_produced_kg=produced_kg,
            step_remaining_kg=remaining_kg,
            step_target_pcs=step_target_pcs,
            step_produced_pcs=step_produced_pcs,
            step_remaining_pcs=step_remaining_pcs,
            tolerance_kg=tolerance_kg,
        )

        return {
            "step_roll_target_kg": float(step_roll_target_kg),
            "step_bulk_target_kg": float(step_bulk_target_kg),
            "step_target_total_kg": float(step_target_total_kg),
            "step_produced_kg": float(produced_kg),
            "step_remaining_kg": float(remaining_kg),
            "step_target_pcs": primary_metrics["step_target_pcs"],
            "step_produced_pcs": primary_metrics["step_produced_pcs"],
            "step_remaining_pcs": primary_metrics["step_remaining_pcs"],
            "tolerance_kg": float(tolerance_kg),
            "primary_uom": primary_metrics["primary_uom"],
            "secondary_uom": primary_metrics["secondary_uom"],
            "step_target_primary": primary_metrics["step_target_primary"],
            "step_produced_primary": primary_metrics["step_produced_primary"],
            "step_remaining_primary": primary_metrics["step_remaining_primary"],
            "tolerance_primary": primary_metrics["tolerance_primary"],
            "derivation_fallback": bool(derivation_fallback),
            "roll_spec_variant_id": output_variant_id or None,
            "roll_spec_variant_code": output_variant_code or None,
            "roll_spec_variant_name": output_variant_name or None,
        }

    @classmethod
    def _rank_roll_candidates(cls, candidates):
        """
        Deterministic roll ranking:
        - resolved density first
        - higher density first
        - earliest created_at first (FIFO tie-breaker)
        """
        def _sort_key(roll):
            density = cls._resolve_roll_density(roll)
            has_density = 1 if density is not None else 0
            density_score = density if density is not None else Decimal("-1")
            created_at = getattr(roll, "created_at", None)
            return (-has_density, -density_score, created_at, str(getattr(roll, "id", "")))

        return sorted(candidates, key=_sort_key)

    @classmethod
    def _unlock_roll_if_stale_reserved(cls, roll, job=None):
        if not roll or getattr(roll, "status", None) != "RESERVED":
            return False
        InventoryReservation.objects.filter(
            roll=roll,
            status="ACTIVE",
            job__job_state__in=["COMPLETED", "CANCELLED"],
        ).update(status="RELEASED")
        active_qs = InventoryReservation.objects.filter(
            roll=roll,
            status="ACTIVE",
        ).exclude(job__job_state__in=["COMPLETED", "CANCELLED"])
        if active_qs.exists():
            return False
        roll.status = "AVAILABLE"
        roll.save(update_fields=["status"])
        return True

    @classmethod
    def _auto_pick_rolls_for_job(cls, job, process, required_rolls, user=None):
        """
        Auto-pick + reserve rolls based on behavior.
        Returns assigned count/ids and remaining shortage.
        """
        if (process.input_form or "").upper() != "ROLL" or int(required_rolls or 0) <= 0:
            return {
                "auto_assigned": 0,
                "auto_assigned_roll_ids": [],
                "missing_after_auto": max(0, required_rolls),
            }

        current_step_index = int(getattr(job, "current_step_index", 0) or 0)
        roll_behavior = str(getattr(process, "roll_behavior", "") or "").upper()
        is_roll_to_bulk = (
            str(getattr(process, "input_form", "") or "").upper() == "ROLL"
            and str(getattr(process, "output_form", "") or "").upper() == "BULK"
        )
        is_step0_primary_roll_step = (
            current_step_index == 0 and roll_behavior in {"MODIFY_EXISTING", "SPLIT"}
        )

        # Enforce explicit first reservation on step-0 modify/split, but allow
        # subsequent in-step auto re-reservation after at least one output log.
        has_roll_progress = False
        if is_step0_primary_roll_step:
            has_roll_progress = InventoryReservation.objects.filter(
                job=job,
                status="FULFILLED",
                roll__isnull=False,
            ).exists() or Decimal(str(getattr(job, "produced_qty", 0) or 0)) > 0
            if not has_roll_progress:
                return {
                    "auto_assigned": 0,
                    "auto_assigned_roll_ids": [],
                    "missing_after_auto": max(0, required_rolls),
                }

        active_qs = InventoryReservation.objects.filter(
            job=job,
            status="ACTIVE",
            roll__isnull=False,
        )
        active_roll_ids = {str(rid) for rid in active_qs.values_list("roll_id", flat=True)}
        to_assign = max(0, required_rolls - len(active_roll_ids))
        if to_assign <= 0:
            return {
                "auto_assigned": 0,
                "auto_assigned_roll_ids": [],
                "missing_after_auto": 0,
            }

        # Build candidate pool from strict eligibility plus discoverable WIP pool.
        from apps.production.services.roll_allocation_service import RollAllocationService

        eligible = list(
            RollAllocationService.get_eligible_rolls(
                job,
                include_non_lineage_fallback=cls._allow_non_lineage_roll_auto_pick(job, process),
                include_remainder=(current_step_index == 0),
            ).select_related("material", "material__parent_family")
        )
        wip_details = cls._resolve_wip_pool_details(job)
        lineage_count = int(
            ((wip_details.get("meta") or {}).get("lineage_roll_count"))
            or len(wip_details.get("lineage_pool") or [])
            or 0
        )
        # Auto-pick is only for true shortage cases.
        # If the job already has enough lineage WIP rolls in pool, keep
        # allocation manual so operators can choose which roll(s) to consume.
        if lineage_count >= int(required_rolls or 0):
            return {
                "auto_assigned": 0,
                "auto_assigned_roll_ids": [],
                "missing_after_auto": max(0, to_assign),
            }
        pool = list(wip_details.get("pool") or [])

        candidate_map = {}
        for roll in eligible + pool:
            rid = str(getattr(roll, "id", ""))
            if not rid or rid in active_roll_ids:
                continue
            if getattr(roll, "status", None) == "RESERVED":
                cls._unlock_roll_if_stale_reserved(roll, job=job)
                roll.refresh_from_db(fields=["status"])
            if getattr(roll, "status", None) != "AVAILABLE":
                continue
            candidate_map[rid] = roll

        ranked = cls._rank_roll_candidates(list(candidate_map.values()))

        def _is_remainder_roll(candidate_roll):
            meta = dict(getattr(candidate_roll, "meta_json", None) or {})
            role = str(meta.get("roll_role") or "").upper()
            return bool(meta.get("is_remainder")) or role == "REMAINDER"

        # Downstream roll-input steps should consume forward lineage outputs,
        # not older/raw remainders from prior stages.
        if current_step_index > 0 and not cls._allow_non_lineage_roll_auto_pick(job, process):
            downstream_ranked = []
            for candidate in ranked:
                if _is_remainder_roll(candidate):
                    continue
                try:
                    candidate_step = int(getattr(candidate, "current_step_index", 0) or 0)
                except Exception:
                    candidate_step = 0
                if candidate_step < current_step_index:
                    continue
                downstream_ranked.append(candidate)
            ranked = downstream_ranked

        def _matches_single_spec(roll, spec, enforce_auto_width_window=False):
            if not isinstance(spec, dict):
                return False
            roll_variant_id = str(getattr(roll, "material_id", "") or "")
            roll_family_id = str(
                getattr(getattr(roll, "material", None), "parent_family_id", "") or ""
            )
            roll_grade_id = str(getattr(roll, "grade_id", "") or "")
            roll_width = getattr(roll, "width_mm", None)
            roll_thickness = getattr(roll, "thickness_micron", None)

            if spec.get("variant_id"):
                if roll_variant_id != str(spec.get("variant_id")):
                    return False
            elif spec.get("family_id"):
                if roll_family_id != str(spec.get("family_id")):
                    return False

            if spec.get("grade_id"):
                if roll_grade_id != str(spec.get("grade_id")):
                    return False

            if spec.get("thickness_micron") is not None:
                try:
                    if roll_thickness in (None, 0, Decimal("0")):
                        return False
                    if int(float(roll_thickness or 0)) != int(float(spec.get("thickness_micron") or 0)):
                        return False
                except Exception:
                    return False

            min_width = spec.get("min_width_mm")
            if min_width is not None:
                try:
                    if float(roll_width or 0) < float(min_width):
                        return False
                except Exception:
                    return False

            if enforce_auto_width_window:
                max_auto_width = spec.get("max_auto_width_mm")
                if max_auto_width is not None:
                    try:
                        if float(roll_width or 0) > float(max_auto_width):
                            return False
                    except Exception:
                        return False

            return True

        def _rollback_auto_reservations(assigned_roll_ids):
            if not assigned_roll_ids:
                return
            with transaction.atomic():
                auto_reservations = list(
                    InventoryReservation.objects.select_related("roll", "material")
                    .filter(job=job, status="ACTIVE", roll_id__in=assigned_roll_ids)
                )
                for res in auto_reservations:
                    roll = res.roll
                    if roll:
                        roll.status = "AVAILABLE"
                        roll.save(update_fields=["status"])
                    req = JobMaterialRequirement.objects.filter(
                        production_job=job,
                        material=res.material,
                    ).first()
                    if req:
                        req.assigned_qty = max(
                            Decimal("0"),
                            Decimal(str(req.assigned_qty or 0)) - Decimal(str(res.quantity or 0)),
                        )
                        req.save(update_fields=["assigned_qty"])
                    res.delete()

        if is_step0_primary_roll_step and has_roll_progress and ranked:
            preferred = []
            preferred_ids = set()
            for roll in ranked:
                meta = dict(getattr(roll, "meta_json", None) or {})
                is_remainder = bool(meta.get("is_remainder")) or str(meta.get("roll_role") or "").upper() == "REMAINDER"
                if is_remainder and str(getattr(roll, "created_by_job_id", "") or "") == str(job.id):
                    preferred.append(roll)
                    preferred_ids.add(str(roll.id))
            if preferred:
                others = [roll for roll in ranked if str(roll.id) not in preferred_ids]
                ranked = preferred + others

        # ROLL->BULK consumes downstream lineage rolls (often laminated/composite),
        # so strict single-layer target spec matching is intentionally skipped here.
        if is_roll_to_bulk and roll_behavior in {"NONE", ""}:
            if len(ranked) < to_assign:
                return {
                    "auto_assigned": 0,
                    "auto_assigned_roll_ids": [],
                    "missing_after_auto": max(0, to_assign),
                }
            assigned_ids = []
            for roll in ranked:
                if len(assigned_ids) >= to_assign:
                    break
                try:
                    cls.assign_roll_to_job(str(job.id), str(roll.id), user=user, manual_override=False)
                    assigned_ids.append(str(roll.id))
                except Exception:
                    continue
            if 0 < len(assigned_ids) < to_assign:
                _rollback_auto_reservations(assigned_ids)
                assigned_ids = []
            return {
                "auto_assigned": len(assigned_ids),
                "auto_assigned_roll_ids": assigned_ids,
                "missing_after_auto": max(0, to_assign - len(assigned_ids)),
            }

        # Universal strict auto-pick policy (all roll-input steps):
        # only auto-assign when every missing required slot has an exact match.
        strict_specs_all = [
            s for s in (cls._build_step_target_specs(job, process) or [])
            if isinstance(s, dict)
        ]
        if not strict_specs_all:
            return {
                "auto_assigned": 0,
                "auto_assigned_roll_ids": [],
                "missing_after_auto": max(0, to_assign),
            }

        layer_specs = []
        spec_by_layer = {}
        for spec in strict_specs_all:
            try:
                layer_idx = int(spec.get("layer_index"))
            except Exception:
                continue
            if layer_idx not in spec_by_layer:
                spec_by_layer[layer_idx] = spec
        if spec_by_layer:
            layer_specs = [spec_by_layer[idx] for idx in sorted(spec_by_layer.keys())]

        ordered_specs = list(layer_specs or strict_specs_all)
        if not ordered_specs:
            return {
                "auto_assigned": 0,
                "auto_assigned_roll_ids": [],
                "missing_after_auto": max(0, to_assign),
            }

        # Normalize spec slots to required roll count.
        if len(ordered_specs) < required_rolls:
            fallback_spec = ordered_specs[0]
            while len(ordered_specs) < required_rolls:
                ordered_specs.append(fallback_spec)
        elif len(ordered_specs) > required_rolls:
            ordered_specs = ordered_specs[:required_rolls]

        active_rolls = list(
            InventoryRoll.objects.filter(id__in=active_roll_ids).select_related("material", "material__parent_family")
        ) if active_roll_ids else []

        remaining_specs = list(ordered_specs)
        # Consume already-reserved rolls against exact specs first.
        for active_roll in active_rolls:
            match_idx = None
            for idx, spec in enumerate(remaining_specs):
                if _matches_single_spec(active_roll, spec, enforce_auto_width_window=True):
                    match_idx = idx
                    break
            if match_idx is not None:
                remaining_specs.pop(match_idx)

        # If current reservations don't map cleanly to required specs, stop auto-pick.
        if len(remaining_specs) != to_assign:
            return {
                "auto_assigned": 0,
                "auto_assigned_roll_ids": [],
                "missing_after_auto": max(0, to_assign),
            }

        # Missing specs must be fully satisfiable by exact matches.
        plan = []
        used_ids = set()
        for spec in remaining_specs:
            matched_roll = None
            for roll in ranked:
                rid = str(getattr(roll, "id", ""))
                if not rid or rid in used_ids:
                    continue
                if _matches_single_spec(roll, spec, enforce_auto_width_window=True):
                    matched_roll = roll
                    break
            if matched_roll is None:
                return {
                    "auto_assigned": 0,
                    "auto_assigned_roll_ids": [],
                    "missing_after_auto": max(0, to_assign),
                }
            plan.append(matched_roll)
            used_ids.add(str(matched_roll.id))
        ranked = plan + [roll for roll in ranked if str(getattr(roll, "id", "")) not in used_ids]
        assigned_ids = []
        for roll in ranked:
            if len(assigned_ids) >= to_assign:
                break
            try:
                cls.assign_roll_to_job(str(job.id), str(roll.id), user=user, manual_override=False)
                assigned_ids.append(str(roll.id))
            except Exception:
                # Keep searching next candidate; final shortage will drive manual fallback.
                continue

        # Avoid partial auto-allocation: either satisfy the full requirement or
        # release auto-picked reservations so operators can allocate explicitly.
        if 0 < len(assigned_ids) < to_assign:
            _rollback_auto_reservations(assigned_ids)
            assigned_ids = []

        missing_after = max(0, to_assign - len(assigned_ids))
        return {
            "auto_assigned": len(assigned_ids),
            "auto_assigned_roll_ids": assigned_ids,
            "missing_after_auto": missing_after,
        }

    @classmethod
    def _is_terminal_step(cls, job):
        return int(job.current_step_index or 0) >= cls._route_last_step_index(job)

    @classmethod
    def _is_terminal_order_step(cls, job):
        current_idx = int(job.current_step_index or 0)
        if current_idx >= cls._route_last_step_index(job):
            return True
        mts_order = getattr(job, "mts_order", None)
        if mts_order is None:
            return False
        stop_idx = getattr(mts_order, "stop_step_index", None)
        if stop_idx is None:
            return False
        try:
            return current_idx >= int(stop_idx)
        except Exception:
            return False

    @classmethod
    def _resolve_finished_good_type(cls, job):
        geometry_snapshot = cls._job_geometry_snapshot(job) or {}
        fg_type = str(
            (geometry_snapshot or {}).get("finished_good_type")
            or (geometry_snapshot or {}).get("fg_type")
            or getattr(job.template, "fg_type", "")
            or "POUCH"
        ).upper()
        return fg_type

    @classmethod
    def _is_terminal_pouch_fg_bulk_step(cls, job, process=None):
        process = process or job.current_process or job.process
        output_form = str(getattr(process, "output_form", "") or "").upper()
        if output_form != "BULK":
            return False
        if cls._is_packaging_purpose_job(job):
            return False
        if not cls._is_terminal_order_step(job):
            return False
        return cls._resolve_finished_good_type(job) == "POUCH"

    @classmethod
    def _roll_to_bulk_output_policy(cls, job, process=None, step_roll_spec=None):
        process = process or job.current_process or job.process
        input_form = str(getattr(process, "input_form", "") or "").upper()
        output_form = str(getattr(process, "output_form", "") or "").upper()
        template_mode = str(
            (step_roll_spec or {}).get("operator_entry_mode")
            or "PROCESS_DEFAULT"
        ).upper()
        is_roll_to_bulk = input_form == "ROLL" and output_form == "BULK"
        terminal_pouch_fg_bulk = cls._is_terminal_pouch_fg_bulk_step(job, process=process)

        if template_mode == "KG_ONLY":
            effective_mode = "KG_ONLY"
        elif template_mode == "KG_AND_PCS":
            effective_mode = "KG_AND_PCS"
        elif is_roll_to_bulk and terminal_pouch_fg_bulk:
            effective_mode = "KG_AND_PCS"
        else:
            effective_mode = template_mode or "PROCESS_DEFAULT"

        requires_output_pcs = bool(
            is_roll_to_bulk
            and terminal_pouch_fg_bulk
            and effective_mode in {"KG_AND_PCS", "DISCRETE_ONLY", "PROCESS_DEFAULT"}
        )
        allows_kg_only = bool(is_roll_to_bulk and terminal_pouch_fg_bulk and effective_mode == "KG_ONLY")
        return {
            "template_mode": template_mode,
            "effective_mode": effective_mode,
            "is_roll_to_bulk": is_roll_to_bulk,
            "is_terminal_pouch_fg_bulk": terminal_pouch_fg_bulk,
            "requires_output_pcs": requires_output_pcs,
            "allows_kg_only": allows_kg_only,
            "requires_output_kg": bool(is_roll_to_bulk),
        }

    @classmethod
    def _route_last_step_index(cls, job):
        """
        Resolve route terminal index for execution.
        RoutingRule order is authoritative; template-step max sequence is fallback.
        """
        routing_last = None
        ordered = list(getattr(getattr(job, "routing_rule", None), "ordered_processes", None) or [])
        if ordered:
            routing_last = max(0, len(ordered) - 1)

        template_last = None
        try:
            template_id = getattr(job, "template_id", None)
            if template_id:
                from apps.templates.models import TemplateProcessStep

                step_qs = TemplateProcessStep.objects.filter(template_id=template_id)
                # Keep template fallback aligned to active route codes when available.
                if ordered:
                    step_qs = step_qs.filter(process__code__in=ordered)
                max_seq = step_qs.aggregate(max_seq=Max("sequence_number")).get("max_seq")
                if max_seq:
                    template_last = max(0, int(max_seq) - 1)
        except Exception:
            template_last = None

        # Route ordering drives execution and should win over stale template
        # sequence tails (legacy leftovers / unsynced steps).
        if routing_last is not None:
            return routing_last

        if template_last is not None:
            return template_last

        return 0

    @classmethod
    def _build_continuation_banner(cls, job):
        route_last_index = cls._route_last_step_index(job)
        current_index = int(getattr(job, "current_step_index", 0) or 0)
        mts_order = getattr(job, "mts_order", None)

        if mts_order is not None:
            start_index = int(getattr(mts_order, "start_step_index", 0) or 0)
            stop_index = getattr(mts_order, "stop_step_index", None)
            stop_index = route_last_index if stop_index is None else int(stop_index)
            planner_stock_class = str(getattr(mts_order, "planner_stock_class", "") or "").upper()

            if start_index > 0:
                return {
                    "title": "Continuing a stopped route",
                    "body": (
                        f"This job resumes {mts_order.order_number} from step {start_index} "
                        f"to step {stop_index}. Operators are continuing prior WIP, not starting fresh raw input."
                    ),
                    "source_order_number": str(getattr(mts_order, "order_number", "") or ""),
                    "planner_stock_class": planner_stock_class,
                    "start_step_index": start_index,
                    "stop_step_index": stop_index,
                    "tone": "indigo",
                }

            if stop_index < route_last_index:
                return {
                    "title": "Building reusable semi-finished stock",
                    "body": (
                        f"This run intentionally stops at step {stop_index} so the plant can hold reusable stock "
                        f"before the final route is completed."
                    ),
                    "source_order_number": str(getattr(mts_order, "order_number", "") or ""),
                    "planner_stock_class": planner_stock_class,
                    "start_step_index": start_index,
                    "stop_step_index": stop_index,
                    "tone": "amber",
                }

            if planner_stock_class in {"SHARED_INVARIANT_ROLL", "EXTRUDED_BASE_ROLL", "FINAL_PLAIN_ROLL"}:
                return {
                    "title": "Planner stock route",
                    "body": (
                        f"This job is running against planner stock order {mts_order.order_number}. "
                        "Keep output and scrap exact so downstream reuse stays truthful."
                    ),
                    "source_order_number": str(getattr(mts_order, "order_number", "") or ""),
                    "planner_stock_class": planner_stock_class,
                    "start_step_index": start_index,
                    "stop_step_index": stop_index,
                    "tone": "sky",
                }

        if current_index > 0:
            return {
                "title": "Continuing route from existing WIP",
                "body": "This step starts from already-produced material. Do not treat this as fresh raw-input startup.",
                "source_order_number": None,
                "planner_stock_class": None,
                "start_step_index": current_index,
                "stop_step_index": route_last_index,
                "tone": "slate",
            }

        return None

    @classmethod
    def _resolve_terminal_fg_location_id(cls, job):
        if not cls._is_terminal_step(job):
            return None
        if not job.work_center_id or not getattr(job.work_center, "plant_id", None):
            return None
        try:
            from apps.inventory.models import InventoryLocation
            fg = (
                InventoryLocation.objects.filter(
                    plant_id=job.work_center.plant_id,
                    type="FG",
                    is_active=True,
                )
                .order_by("-is_system", "name")
                .first()
            )
            return fg.id if fg else None
        except Exception:
            return None

    @classmethod
    def _roll_matches_target_specs(cls, roll, target_roll_specs, enforce_auto_width_window: bool = False):
        specs = target_roll_specs or []
        if not specs:
            return True

        roll_variant_id = str(getattr(roll, "material_id", "") or "")
        roll_family_id = str(
            getattr(getattr(roll, "material", None), "parent_family_id", "") or ""
        )
        roll_grade_id = str(getattr(roll, "grade_id", "") or "")
        roll_width = getattr(roll, "width_mm", None)
        roll_thickness = getattr(roll, "thickness_micron", None)
        roll_stock_form = normalize_stock_form(getattr(roll, "stock_form", None))

        for spec in specs:
            if not isinstance(spec, dict):
                continue

            source_step_index = spec.get("source_step_index")
            if source_step_index is not None:
                try:
                    source_idx = int(source_step_index)
                    roll_stage_idx = int(getattr(roll, "stage_index", 0) or 0)
                    roll_current_idx = int(getattr(roll, "current_step_index", 0) or 0)
                    roll_completed_idx = int(getattr(roll, "completed_step_index", 0) or 0)
                    if max(roll_stage_idx, roll_current_idx, roll_completed_idx) < source_idx:
                        continue
                except Exception:
                    continue

            if str(spec.get("source_role") or "").upper() == "LAMINATED_WIP":
                meta = getattr(roll, "meta_json", None) or {}
                roll_role = str(meta.get("roll_role") or "").upper()
                roll_behavior = str(meta.get("source_behavior") or "").upper()
                if roll_role != "OUTPUT" or roll_behavior != "MULTI_INPUT_COMBINE":
                    continue

            variant_match = True
            family_match = True
            if spec.get("variant_id"):
                variant_match = roll_variant_id == str(spec.get("variant_id"))
            elif spec.get("family_id"):
                family_match = roll_family_id == str(spec.get("family_id"))
            if not (variant_match and family_match):
                continue

            if spec.get("stock_form") and roll_stock_form != normalize_stock_form(spec.get("stock_form")):
                continue

            # Strict Grade Check (User Request: "roll should match grade")
            # Must match exactly if defined in spec.
            if spec.get("grade_id") and roll_grade_id != str(spec.get("grade_id")):
                continue

            if spec.get("thickness_micron") is not None:
                try:
                    if roll_thickness in (None, 0, Decimal("0")):
                        continue
                     # Strict compatibility: Thickness must match exactly (int-cast safety)
                    if int(float(roll_thickness or 0)) != int(float(spec.get("thickness_micron") or 0)):
                        continue
                except Exception:
                    continue

            # Width gate: minimum width is always enforced.
            min_width = spec.get("min_width_mm")
            if min_width is not None:
                try:
                    if float(roll_width or 0) < float(min_width):
                         continue
                except Exception:
                    continue

            # Auto-allocation window: keep automatic picks within +10% width.
            # Manual override may intentionally pick larger rolls, so this gate
            # is only enabled by callers that request strict auto behavior.
            if enforce_auto_width_window:
                max_auto_width = spec.get("max_auto_width_mm")
                if max_auto_width is not None:
                    try:
                        if float(roll_width or 0) > float(max_auto_width):
                            continue
                    except Exception:
                        continue

            return True

        return False

    @classmethod
    def reconcile_assignment_reservations(cls, job):
        """
        Heal legacy WCM states where `allocated_rolls` was populated but no ACTIVE
        InventoryReservation exists. This keeps requirement counters, queue badge,
        and assigned roll cards consistent after page refresh/navigation.
        """
        try:
            assignment = WorkCenterAssignment.objects.get(production_job=job)
        except WorkCenterAssignment.DoesNotExist:
            if not getattr(job, "work_center_id", None):
                return 0
            assignment, _ = WorkCenterAssignment.objects.get_or_create(
                production_job=job,
                defaults={
                    "work_center": job.work_center,
                    "status": "WC_READY",
                },
            )
        if getattr(job, "work_center_id", None) and assignment.work_center_id != job.work_center_id:
            assignment.work_center = job.work_center
            assignment.save(update_fields=["work_center"])

        process = job.current_process or job.process
        job_state = str(getattr(job, "job_state", "") or "").upper()

        def _release_active_rolls_for_job():
            active_rows = InventoryReservation.objects.filter(
                job=job,
                status='ACTIVE',
                roll__isnull=False,
            ).select_related('roll')
            for res in active_rows:
                res.status = 'RELEASED'
                res.save(update_fields=['status'])
                if res.roll and res.roll.status == 'RESERVED':
                    has_other_active = InventoryReservation.objects.filter(
                        roll=res.roll,
                        status='ACTIVE',
                    ).exclude(job=job).exists()
                    if not has_other_active:
                        res.roll.status = 'AVAILABLE'
                        res.roll.save(update_fields=['status'])

        # Closed jobs must never regenerate ACTIVE reservations.
        if job_state in ("COMPLETED", "CANCELLED"):
            _release_active_rolls_for_job()
            if assignment.allocated_rolls.exists():
                assignment.allocated_rolls.clear()
            assignment.delete()
            return 0

        if not process or process.input_form != 'ROLL':
            _release_active_rolls_for_job()
            if assignment.allocated_rolls.exists():
                assignment.allocated_rolls.clear()
            return 0

        step_roll_spec = cls._resolve_step_roll_spec(job, process)
        required_rolls = cls._required_roll_count(job, process, step_roll_spec)
        lane_group_mode = cls._is_lane_group_combine_spec(step_roll_spec)
        roll_behavior = str(getattr(process, "roll_behavior", "") or "").upper()
        is_roll_to_bulk = (
            str(getattr(process, "input_form", "") or "").upper() == "ROLL"
            and str(getattr(process, "output_form", "") or "").upper() == "BULK"
        )
        current_step_index = int(getattr(job, "current_step_index", 0) or 0)
        lane_group_mode = cls._is_lane_group_combine_spec(step_roll_spec)
        target_specs = cls._build_step_target_slots(job, process) if lane_group_mode else cls._build_step_target_specs(job, process)
        active_rows = list(
            InventoryReservation.objects.filter(job=job, status='ACTIVE', roll__isnull=False)
            .select_related("roll")
        )
        # Drop stale ACTIVE reservations that no longer match current step physics.
        for res in active_rows:
            roll = res.roll
            if not roll:
                res.status = "RELEASED"
                res.save(update_fields=["status"])
                continue
            # ACTIVE reservations are explicit assignment truth. Preserve a
            # manually assigned fallback roll if it still satisfies current-step
            # roll physics; lineage strictness belongs to pool visibility, not
            # to reserved-input validity.
            if cls._is_roll_step_compatible(
                job,
                process,
                roll,
                target_specs,
                allow_input_stock_fallback=True,
            ):
                continue
            res.status = "RELEASED"
            res.save(update_fields=["status"])
            if roll.status == "RESERVED":
                has_other_active = InventoryReservation.objects.filter(
                    roll=roll,
                    status="ACTIVE",
                ).exclude(job=job).exists()
                if not has_other_active:
                    roll.status = "AVAILABLE"
                    roll.save(update_fields=["status"])

        active_roll_ids = set(
            InventoryReservation.objects.filter(job=job, status='ACTIVE', roll__isnull=False)
            .values_list('roll_id', flat=True)
        )
        if required_rolls == 0 and not is_roll_to_bulk:
            _release_active_rolls_for_job()
            if assignment.allocated_rolls.exists():
                assignment.allocated_rolls.clear()
            return 0

        created = 0
        for roll in assignment.allocated_rolls.all().order_by('-weight_kg'):
            if (not is_roll_to_bulk) and (not lane_group_mode) and required_rolls and (len(active_roll_ids) + created) >= required_rolls:
                break
            if roll.id in active_roll_ids:
                continue
            if roll.status not in ['AVAILABLE', 'RESERVED']:
                continue
            selected_lane_slot = None
            if lane_group_mode:
                for slot in target_specs:
                    if cls._is_roll_step_compatible(
                        job,
                        process,
                        roll,
                        [slot],
                        allow_input_stock_fallback=True,
                    ) and cls._roll_matches_target_specs(roll, [slot]):
                        selected_lane_slot = slot
                        break
            InventoryReservation.objects.create(
                job=job,
                roll=roll,
                material=roll.material,
                quantity=roll.weight_kg,
                status='ACTIVE',
                created_by=assignment.assigned_by,
                target_lane_key=(selected_lane_slot or {}).get("lane_key"),
                target_lane_label=(selected_lane_slot or {}).get("lane_label") or "",
                target_layer_index=(selected_lane_slot or {}).get("layer_index") or None,
                target_variant_id=str((selected_lane_slot or {}).get("variant_id") or ""),
                target_grade_id=str((selected_lane_slot or {}).get("grade_id") or ""),
                target_thickness_micron=(selected_lane_slot or {}).get("thickness_micron"),
                target_width_mm=(selected_lane_slot or {}).get("min_width_mm"),
                target_source_step_index=(selected_lane_slot or {}).get("source_step_index"),
                target_lane_meta=selected_lane_slot or {},
            )
            if roll.status != 'RESERVED':
                roll.status = 'RESERVED'
                roll.save(update_fields=['status'])
            created += 1

        # Keep assignment linkage synced back from reservation source-of-truth.
        # Reservation truth must remain explicit: lineage pool visibility is not
        # the same as an assigned input selection for the current step.
        synced_roll_ids = InventoryReservation.objects.filter(
            job=job, status='ACTIVE', roll__isnull=False
        ).values_list('roll_id', flat=True)
        assignment.allocated_rolls.set(InventoryRoll.objects.filter(id__in=synced_roll_ids))
        return created

    @classmethod
    def _resolve_job_plant_id(cls, job):
        if job.work_center_id and job.work_center and job.work_center.plant_id:
            return str(job.work_center.plant_id)
        if job.from_location_id and job.from_location and job.from_location.plant_id:
            return str(job.from_location.plant_id)
        if job.to_location_id and job.to_location and job.to_location.plant_id:
            return str(job.to_location.plant_id)
        return None

    @classmethod
    def _resolve_job_lineage_filter(cls, job):
        if job.sales_order_item_id:
            return (
                Q(sales_order_item_id=job.sales_order_item_id)
                | Q(created_by_job__sales_order_item_id=job.sales_order_item_id)
                | Q(production_job__sales_order_item_id=job.sales_order_item_id)
            )
        if getattr(job, "mts_order_id", None):
            return Q(created_by_job__mts_order_id=job.mts_order_id) | Q(production_job__mts_order_id=job.mts_order_id)
        if job.template_id:
            return (
                Q(template_id=job.template_id)
                | Q(created_by_job__template_id=job.template_id)
                | Q(production_job__template_id=job.template_id)
            )
        return None

    @classmethod
    def _build_step_target_specs(cls, job, process=None):
        process = process or job.current_process or job.process
        spec_hint = cls._resolve_step_roll_spec(job, process)
        stock_contract = StockFormResolver.from_job(job)
        specs = []
        seen = set()

        def _push(raw_spec):
            if not isinstance(raw_spec, dict):
                return
            clean = {k: v for k, v in raw_spec.items() if v is not None and v != ""}
            if not clean:
                return
            key = (
                str(clean.get("variant_id") or ""),
                str(clean.get("family_id") or ""),
                str(clean.get("grade_id") or ""),
                str(clean.get("thickness_micron") or ""),
                str(clean.get("stock_form") or ""),
            )
            if key in seen:
                return
            seen.add(key)
            specs.append(clean)

        req_width_mm = None
        try:
            geom = cls._job_geometry_snapshot(job) or {}
            base = geom.get("base") if isinstance(geom, dict) else None
            base = base if isinstance(base, dict) else geom
            req_width_mm = base.get("width_mm") if isinstance(base, dict) else None
            if req_width_mm is not None:
                req_width_mm = float(req_width_mm)
        except Exception:
            req_width_mm = None

        layer_snapshot = cls._job_layer_snapshot(job)

        if isinstance(layer_snapshot, list):
            for idx, layer in enumerate(layer_snapshot):
                if not isinstance(layer, dict):
                    continue
                layer_spec = {
                    "layer_index": idx + 1,
                    "variant_id": str(layer.get("variant_id") or layer.get("material_id"))
                    if (layer.get("variant_id") or layer.get("material_id"))
                    else None,
                    "family_id": str(layer.get("family_id")) if layer.get("family_id") else None,
                    "grade_id": str(layer.get("grade_id")) if layer.get("grade_id") else None,
                    "thickness_micron": layer.get("thickness_micron")
                    if layer.get("thickness_micron") is not None
                    else layer.get("thickness"),
                    "stock_form": layer.get("stock_form") or stock_contract.stock_form,
                    "width_basis": layer.get("width_basis") or stock_contract.width_basis,
                    "slit_policy": layer.get("slit_policy") or stock_contract.slit_policy,
                }
                # Roll compatibility width is snapshot-driven from stack layer
                # width when provided; fallback to geometry base width.
                layer_req_width = layer.get("roll_width_mm")
                if layer_req_width in (None, ""):
                    layer_req_width = layer.get("width_mm")
                try:
                    layer_req_width = float(layer_req_width) if layer_req_width is not None else None
                    if layer_req_width is not None and layer_req_width <= 0:
                        layer_req_width = None
                except Exception:
                    layer_req_width = None
                effective_req_width = layer_req_width if layer_req_width is not None else req_width_mm
                if effective_req_width is not None:
                    layer_spec["min_width_mm"] = effective_req_width
                    layer_spec["max_auto_width_mm"] = float(effective_req_width) * 1.10
                _push(layer_spec)

        fallback_spec = {
            "variant_id": spec_hint.get("output_variant_id"),
            "grade_id": spec_hint.get("output_grade_id"),
            "thickness_micron": spec_hint.get("fixed_thickness_micron"),
            "stock_form": stock_contract.stock_form,
            "width_basis": stock_contract.width_basis,
            "slit_policy": stock_contract.slit_policy,
        }
        if req_width_mm is not None:
            fallback_spec["min_width_mm"] = req_width_mm
            fallback_spec["max_auto_width_mm"] = float(req_width_mm) * 1.10
        _push(fallback_spec)
        return specs

    @classmethod
    def _build_step_target_slots(cls, job, process=None):
        process = process or job.current_process or job.process
        if not process or str(getattr(process, "input_form", "") or "").upper() != "ROLL":
            return []
        stock_contract = StockFormResolver.from_job(job)

        req_width_mm = None
        try:
            geom = cls._job_geometry_snapshot(job) or {}
            base = geom.get("base") if isinstance(geom, dict) else None
            base = base if isinstance(base, dict) else geom
            req_width_mm = base.get("width_mm") if isinstance(base, dict) else None
            if req_width_mm is not None:
                req_width_mm = float(req_width_mm)
        except Exception:
            req_width_mm = None

        step_roll_spec = cls._resolve_step_roll_spec(job, process)
        required_rolls = cls._required_roll_count(job, process, step_roll_spec)
        slots = []

        def _slot_payload(raw_spec, slot_index):
            if not isinstance(raw_spec, dict):
                return None
            raw_layer_index = raw_spec.get("layer_index")
            payload = {
                "slot_index": int(slot_index),
                "layer_index": raw_layer_index if raw_layer_index not in (None, "") else int(slot_index),
                "lane_key": raw_spec.get("lane_key"),
                "lane_label": raw_spec.get("lane_label"),
                "source_step_index": raw_spec.get("source_step_index"),
                "source_role": raw_spec.get("source_role"),
                "variant_id": str(raw_spec.get("variant_id")) if raw_spec.get("variant_id") else None,
                "family_id": str(raw_spec.get("family_id")) if raw_spec.get("family_id") else None,
                "grade_id": str(raw_spec.get("grade_id")) if raw_spec.get("grade_id") else None,
                "thickness_micron": raw_spec.get("thickness_micron"),
                "min_width_mm": raw_spec.get("min_width_mm"),
                "max_auto_width_mm": raw_spec.get("max_auto_width_mm"),
                "stock_form": raw_spec.get("stock_form") or stock_contract.stock_form,
                "width_basis": raw_spec.get("width_basis") or stock_contract.width_basis,
                "slit_policy": raw_spec.get("slit_policy") or stock_contract.slit_policy,
                "variant_name": raw_spec.get("variant_name"),
            }
            return {key: value for key, value in payload.items() if value not in (None, "")}

        layer_snapshot = cls._job_layer_snapshot(job)
        if cls._is_lane_group_combine_spec(step_roll_spec):
            pass_index = int(step_roll_spec.get("lamination_pass_index") or cls._infer_lamination_pass_index(job, process) or 1)
            layers = [layer for layer in (layer_snapshot if isinstance(layer_snapshot, list) else []) if isinstance(layer, dict)]

            def _layer_slot(layer, layer_index, slot_index, lane_key, lane_label):
                layer_req_width = layer.get("roll_width_mm")
                if layer_req_width in (None, ""):
                    layer_req_width = layer.get("width_mm")
                try:
                    layer_req_width = float(layer_req_width) if layer_req_width is not None else None
                    if layer_req_width is not None and layer_req_width <= 0:
                        layer_req_width = None
                except Exception:
                    layer_req_width = None
                effective_req_width = layer_req_width if layer_req_width is not None else req_width_mm
                return _slot_payload(
                    {
                        "slot_index": slot_index,
                        "lane_key": lane_key,
                        "lane_label": lane_label,
                        "layer_index": layer_index,
                        "variant_id": layer.get("variant_id") or layer.get("material_id"),
                        "family_id": layer.get("family_id"),
                        "grade_id": layer.get("grade_id"),
                        "thickness_micron": (
                            layer.get("thickness_micron")
                            if layer.get("thickness_micron") is not None
                            else layer.get("thickness")
                        ),
                        "min_width_mm": effective_req_width,
                        "max_auto_width_mm": float(effective_req_width) * 1.10 if effective_req_width is not None else None,
                        "variant_name": layer.get("variant_name") or layer.get("name"),
                        "source_role": "LAYER",
                        "stock_form": layer.get("stock_form") or stock_contract.stock_form,
                        "width_basis": layer.get("width_basis") or stock_contract.width_basis,
                        "slit_policy": layer.get("slit_policy") or stock_contract.slit_policy,
                    },
                    slot_index,
                )

            def _lane_key(slot_index):
                if 1 <= int(slot_index) <= 26:
                    return f"LANE_{chr(64 + int(slot_index))}"
                return f"LANE_{int(slot_index)}"

            if pass_index <= 1:
                lane_count = max(2, int(step_roll_spec.get("input_lane_count") or 2))
                lane_defs = [
                    (
                        layers[idx] if len(layers) > idx else {},
                        idx + 1,
                        idx + 1,
                        _lane_key(idx + 1),
                        f"Lane {_lane_key(idx + 1).replace('LANE_', '')} · Layer {idx + 1}",
                    )
                    for idx in range(lane_count)
                ]
                slots = [slot for args in lane_defs if (slot := _layer_slot(*args))]
            else:
                prior_source_step = max(0, int(getattr(job, "current_step_index", 0) or 0) - 1)
                prior_slot = _slot_payload(
                    {
                        "slot_index": 1,
                        "lane_key": "LANE_A",
                        "lane_label": f"Lane A · Pass {pass_index - 1} laminate",
                        "layer_index": 0,
                        "source_step_index": prior_source_step,
                        "source_role": "LAMINATED_WIP",
                    },
                    1,
                )
                layer_index = pass_index + 1
                layer = layers[layer_index - 1] if len(layers) >= layer_index else {}
                next_layer_slot = _layer_slot(layer, layer_index, 2, "LANE_B", f"Lane B · Layer {layer_index}")
                slots = [slot for slot in (prior_slot, next_layer_slot) if slot]

            if slots:
                return slots[: max(2, int(step_roll_spec.get("input_lane_count") or 2))]

        if isinstance(layer_snapshot, list):
            for idx, layer in enumerate(layer_snapshot):
                if not isinstance(layer, dict):
                    continue
                layer_req_width = layer.get("roll_width_mm")
                if layer_req_width in (None, ""):
                    layer_req_width = layer.get("width_mm")
                try:
                    layer_req_width = float(layer_req_width) if layer_req_width is not None else None
                    if layer_req_width is not None and layer_req_width <= 0:
                        layer_req_width = None
                except Exception:
                    layer_req_width = None
                effective_req_width = layer_req_width if layer_req_width is not None else req_width_mm
                slot = _slot_payload(
                    {
                        "layer_index": idx + 1,
                        "variant_id": layer.get("variant_id") or layer.get("material_id"),
                        "family_id": layer.get("family_id"),
                        "grade_id": layer.get("grade_id"),
                        "thickness_micron": (
                            layer.get("thickness_micron")
                            if layer.get("thickness_micron") is not None
                            else layer.get("thickness")
                        ),
                        "min_width_mm": effective_req_width,
                        "max_auto_width_mm": float(effective_req_width) * 1.10 if effective_req_width is not None else None,
                        "variant_name": layer.get("variant_name") or layer.get("name"),
                        "stock_form": layer.get("stock_form") or stock_contract.stock_form,
                        "width_basis": layer.get("width_basis") or stock_contract.width_basis,
                        "slit_policy": layer.get("slit_policy") or stock_contract.slit_policy,
                    },
                    idx + 1,
                )
                if slot:
                    slots.append(slot)

        if not slots:
            fallback_slot = _slot_payload(
                {
                    "variant_id": step_roll_spec.get("output_variant_id"),
                    "grade_id": step_roll_spec.get("output_grade_id"),
                    "thickness_micron": step_roll_spec.get("fixed_thickness_micron"),
                    "min_width_mm": req_width_mm,
                    "max_auto_width_mm": float(req_width_mm) * 1.10 if req_width_mm is not None else None,
                    "variant_name": step_roll_spec.get("output_variant_name"),
                    "stock_form": stock_contract.stock_form,
                    "width_basis": stock_contract.width_basis,
                    "slit_policy": stock_contract.slit_policy,
                },
                1,
            )
            if fallback_slot:
                slots.append(fallback_slot)

        if not slots or required_rolls <= 0:
            return []

        if len(slots) < required_rolls:
            template_slot = dict(slots[-1])
            while len(slots) < required_rolls:
                clone = dict(template_slot)
                clone["slot_index"] = len(slots) + 1
                clone.setdefault("layer_index", clone["slot_index"])
                slots.append(clone)
        elif len(slots) > required_rolls:
            slots = slots[:required_rolls]

        return slots

    @classmethod
    def _match_rolls_to_target_slots(cls, job, process, rolls, target_slots, *, enforce_auto_width_window=False, allow_input_stock_fallback=False):
        process = process or job.current_process or job.process
        slots = [slot for slot in (target_slots or []) if isinstance(slot, dict)]
        roll_rows = [roll for roll in (rolls or []) if roll is not None]
        if not slots:
            return {
                "matched_count": 0,
                "matched_roll_ids": [],
                "matched_target_slots": [],
                "unmatched_target_slots": [],
                "unmatched_roll_ids": [str(getattr(roll, "id", "")) for roll in roll_rows if getattr(roll, "id", None)],
            }

        adjacency = []
        for roll in roll_rows:
            options = []
            for slot in slots:
                if cls._is_roll_step_compatible(
                    job,
                    process,
                    roll,
                    [slot],
                    allow_input_stock_fallback=allow_input_stock_fallback,
                ) and cls._roll_matches_target_specs(
                    roll,
                    [slot],
                    enforce_auto_width_window=enforce_auto_width_window,
                ):
                    options.append(int(slot.get("slot_index") or 0))
            adjacency.append(options)

        slot_to_roll_idx = {}

        def _dfs(roll_idx, seen):
            for slot_idx in adjacency[roll_idx]:
                if slot_idx in seen:
                    continue
                seen.add(slot_idx)
                incumbent = slot_to_roll_idx.get(slot_idx)
                if incumbent is None or _dfs(incumbent, seen):
                    slot_to_roll_idx[slot_idx] = roll_idx
                    return True
            return False

        for roll_idx in range(len(roll_rows)):
            _dfs(roll_idx, set())

        roll_to_slot = {roll_idx: slot_idx for slot_idx, roll_idx in slot_to_roll_idx.items()}
        matched_target_slots = []
        unmatched_target_slots = []
        matched_roll_ids = []
        unmatched_roll_ids = []
        for slot in slots:
            slot_idx = int(slot.get("slot_index") or 0)
            roll_idx = slot_to_roll_idx.get(slot_idx)
            if roll_idx is None:
                unmatched_target_slots.append(dict(slot))
                continue
            roll = roll_rows[roll_idx]
            matched_roll_ids.append(str(getattr(roll, "id", "")))
            matched_target_slots.append({
                **dict(slot),
                "roll_id": str(getattr(roll, "id", "")),
                "roll_label": getattr(roll, "label_id", None),
                "material_name": getattr(getattr(roll, "material", None), "name", None),
            })
        for idx, roll in enumerate(roll_rows):
            if idx not in roll_to_slot:
                unmatched_roll_ids.append(str(getattr(roll, "id", "")))

        return {
            "matched_count": len(matched_target_slots),
            "matched_roll_ids": [row for row in matched_roll_ids if row],
            "matched_target_slots": matched_target_slots,
            "unmatched_target_slots": unmatched_target_slots,
            "unmatched_roll_ids": [row for row in unmatched_roll_ids if row],
        }

    @classmethod
    def _match_rolls_to_lane_slots(cls, job, process, rolls, target_slots, *, enforce_auto_width_window=False, allow_input_stock_fallback=False):
        slots = [slot for slot in (target_slots or []) if isinstance(slot, dict)]
        roll_rows = [roll for roll in (rolls or []) if roll is not None]
        lane_rows = {}
        matched_roll_ids = []
        unmatched_roll_ids = []

        for slot in slots:
            lane_key = str(slot.get("lane_key") or f"LANE_{slot.get('slot_index') or len(lane_rows) + 1}")
            lane_rows[lane_key] = {
                **dict(slot),
                "lane_key": lane_key,
                "rolls": [],
                "weight_kg": 0.0,
            }

        for roll in roll_rows:
            compatible_lane_keys = []
            for slot in slots:
                if cls._is_roll_step_compatible(
                    job,
                    process,
                    roll,
                    [slot],
                    allow_input_stock_fallback=allow_input_stock_fallback,
                ) and cls._roll_matches_target_specs(
                    roll,
                    [slot],
                    enforce_auto_width_window=enforce_auto_width_window,
                ):
                    compatible_lane_keys.append(str(slot.get("lane_key") or f"LANE_{slot.get('slot_index') or 1}"))
            matched_lane_key = None
            for lane_key in compatible_lane_keys:
                if not (lane_rows.get(lane_key) or {}).get("rolls"):
                    matched_lane_key = lane_key
                    break
            if not matched_lane_key and compatible_lane_keys:
                matched_lane_key = compatible_lane_keys[0]
            if not matched_lane_key:
                if getattr(roll, "id", None):
                    unmatched_roll_ids.append(str(roll.id))
                continue
            row = lane_rows.setdefault(matched_lane_key, {"lane_key": matched_lane_key, "rolls": [], "weight_kg": 0.0})
            row["rolls"].append({
                "roll_id": str(getattr(roll, "id", "")),
                "roll_label": getattr(roll, "label_id", None),
                "material_name": getattr(getattr(roll, "material", None), "name", None),
                "weight_kg": float(getattr(roll, "weight_kg", 0) or 0),
            })
            row["weight_kg"] = float(row.get("weight_kg") or 0) + float(getattr(roll, "weight_kg", 0) or 0)
            if getattr(roll, "id", None):
                matched_roll_ids.append(str(roll.id))

        matched_target_slots = []
        unmatched_target_slots = []
        for slot in slots:
            lane_key = str(slot.get("lane_key") or f"LANE_{slot.get('slot_index') or 1}")
            row = lane_rows.get(lane_key) or dict(slot)
            if row.get("rolls"):
                matched_target_slots.append(row)
            else:
                unmatched_target_slots.append(dict(slot))

        return {
            "matched_count": len(matched_target_slots),
            "matched_roll_ids": matched_roll_ids,
            "matched_target_slots": matched_target_slots,
            "unmatched_target_slots": unmatched_target_slots,
            "unmatched_roll_ids": unmatched_roll_ids,
            "lane_groups": list(lane_rows.values()),
        }

    @classmethod
    def _summarize_roll_assignment_validation(cls, job, process=None, rolls=None, *, allow_input_stock_fallback=False):
        process = process or job.current_process or job.process
        step_roll_spec = cls._resolve_step_roll_spec(job, process)
        required_rolls = cls._required_roll_count(job, process, step_roll_spec)
        behavior = str(getattr(process, "roll_behavior", "") or "").upper()
        assigned_rolls = [roll for roll in (rolls or []) if roll is not None]
        if behavior != "MULTI_INPUT_COMBINE":
            matched_roll_ids = [
                str(getattr(roll, "id", ""))
                for roll in assigned_rolls
                if getattr(roll, "id", None)
            ]
            return {
                "required_rolls": int(required_rolls or 0),
                "required_target_specs": [],
                "matched_target_slots": [],
                "unmatched_target_slots": [],
                "matched_roll_ids": matched_roll_ids,
                "unmatched_roll_ids": [],
                "assigned_roll_count": len(assigned_rolls),
                "slot_satisfied": True,
                "is_complete": len(assigned_rolls) >= int(required_rolls or 0) if required_rolls else True,
            }

        target_slots = cls._build_step_target_slots(job, process)
        if cls._is_lane_group_combine_spec(step_roll_spec):
            match = cls._match_rolls_to_lane_slots(
                job,
                process,
                assigned_rolls,
                target_slots,
                enforce_auto_width_window=False,
                allow_input_stock_fallback=allow_input_stock_fallback,
            )
        else:
            match = cls._match_rolls_to_target_slots(
                job,
                process,
                assigned_rolls,
                target_slots,
                enforce_auto_width_window=False,
                allow_input_stock_fallback=allow_input_stock_fallback,
            )
        lane_mode = cls._is_lane_group_combine_spec(step_roll_spec)
        return {
            "required_rolls": int(required_rolls or 0),
            "input_lane_count": int(step_roll_spec.get("input_lane_count") or required_rolls or 0),
            "required_target_specs": target_slots,
            "matched_target_slots": match.get("matched_target_slots") or [],
            "unmatched_target_slots": match.get("unmatched_target_slots") or [],
            "matched_roll_ids": match.get("matched_roll_ids") or [],
            "unmatched_roll_ids": match.get("unmatched_roll_ids") or [],
            "lane_groups": match.get("lane_groups") or [],
            "assigned_roll_count": len(assigned_rolls),
            "slot_satisfied": len(match.get("unmatched_roll_ids") or []) == 0 if lane_mode else len(match.get("matched_roll_ids") or []) == len(assigned_rolls),
            "is_complete": len(match.get("matched_target_slots") or []) >= int(required_rolls or 0) if required_rolls else True,
        }

    @classmethod
    def _is_roll_step_compatible(cls, job, process, roll, target_specs, allow_input_stock_fallback=False):
        if not process or (process.input_form or "").upper() != "ROLL":
            return True

        if not StockFormResolver.process_accepts_input(process, getattr(roll, "stock_form", None)):
            return False

        current_step_index = int(getattr(job, "current_step_index", 0) or 0)
        roll_behavior = str(getattr(process, "roll_behavior", "") or "").upper()
        is_roll_to_bulk = (
            str(getattr(process, "input_form", "") or "").upper() == "ROLL"
            and str(getattr(process, "output_form", "") or "").upper() == "BULK"
        )
        roll_meta = dict(getattr(roll, "meta_json", None) or {})
        roll_role = str(roll_meta.get("roll_role") or "").upper()
        is_remainder = bool(roll_meta.get("is_remainder")) or roll_role == "REMAINDER"
        try:
            source_stage_index = int(roll_meta.get("source_stage_index") or getattr(roll, "stage_index", 0) or 0)
        except Exception:
            source_stage_index = 0
        is_processed_remainder = is_remainder and source_stage_index > 0 and roll_role != "RAW_REMAINDER"

        # Roll->bulk must accept reusable semi-fg rolls carried forward as
        # remainders across orders. Layer-level target specs do not apply here.
        if is_roll_to_bulk:
            try:
                roll_step_index = int(getattr(roll, "current_step_index", 0) or 0)
            except Exception:
                roll_step_index = 0
            try:
                max_allowed_step = current_step_index + 1
                if int(roll_step_index) > max_allowed_step:
                    return False
            except Exception:
                pass
            return True

        if not target_specs:
            return False

        # Downstream steps consume forward lineage outputs.
        # Keep stage-0 remainder/raw rolls allocatable, but only for step 0.
        if current_step_index > 0 and is_remainder and not is_processed_remainder and not allow_input_stock_fallback:
            return False
        if current_step_index > 0 and roll_role in {"RAW_MATERIAL", "RAW"} and not allow_input_stock_fallback:
            return False
        if current_step_index > 0:
            try:
                roll_step_index = int(getattr(roll, "current_step_index", 0) or 0)
            except Exception:
                roll_step_index = 0
            if (
                roll_behavior != "MULTI_INPUT_COMBINE"
                and roll_step_index < current_step_index
                and not allow_input_stock_fallback
            ):
                return False

        # Step-compatible lineage: allow upstream rolls, block only obviously downstream/future rolls.
        roll_step = getattr(roll, "current_step_index", None)
        try:
            max_allowed_step = current_step_index + 1
            if roll_step is not None and int(roll_step) > max_allowed_step:
                return False
        except Exception:
            pass

        return cls._roll_matches_target_specs(roll, target_specs)

    @classmethod
    def _recent_lineage_rolls(cls, job, plant_id, limit=6):
        lineage_filter = cls._resolve_job_lineage_filter(job)
        if lineage_filter is None:
            return []

        try:
            from apps.inventory.serializers import resolve_roll_stage_name, resolve_roll_role
        except Exception:
            resolve_roll_stage_name = None
            resolve_roll_role = None

        qs = (
            InventoryRoll.objects.filter(lineage_filter)
            .exclude(location__code="IN_TRANSIT")
            .select_related("material", "location", "grade")
            .order_by("-created_at")
        )
        if plant_id:
            qs = qs.filter(location__plant_id=plant_id)

        rows = []
        for roll in qs[: max(limit * 4, limit)]:
            role = None
            if resolve_roll_role:
                try:
                    role = str(resolve_roll_role(roll) or "").upper()
                except Exception:
                    role = None
            if not role:
                role = str(((getattr(roll, "meta_json", None) or {}).get("roll_role") or "")).upper() or None
            if role == "REMAINDER" or bool((getattr(roll, "meta_json", None) or {}).get("is_remainder")):
                continue

            stage_name = None
            if resolve_roll_stage_name:
                try:
                    stage_name = resolve_roll_stage_name(roll)
                except Exception:
                    stage_name = None
            if not stage_name:
                try:
                    stage_name = f"Stage {int(getattr(roll, 'stage_index', 0) or 0)}"
                except Exception:
                    stage_name = "Raw"
            rows.append({
                "id": str(roll.id),
                "label_id": roll.label_id,
                "material_name": roll.material.name if roll.material else None,
                "weight_kg": float(roll.weight_kg or 0),
                "width_mm": float(roll.width_mm or 0),
                "thickness_micron": float(roll.thickness_micron or 0),
                "grade": roll.grade.name if getattr(roll, "grade", None) else None,
                "status": roll.status,
                "location_name": roll.location.name if roll.location else None,
                "stage": stage_name,
            })
            if len(rows) >= limit:
                break
        return rows

    @classmethod
    def _resolve_wip_pool_details_v2(cls, job):
        process = job.current_process or job.process
        plant_id = cls._resolve_job_plant_id(job)
        lineage_filter = cls._resolve_job_lineage_filter(job)
        required_for_step = bool(process and (process.input_form or "").upper() == "ROLL")
        step_roll_spec = cls._resolve_step_roll_spec(job, process)
        required_rolls = cls._required_roll_count(job, process, step_roll_spec)
        current_step_index = int(getattr(job, "current_step_index", 0) or 0)
        roll_behavior = str(getattr(process, "roll_behavior", "") or "").upper()
        purchasable_variant_ids = cls._step0_purchasable_variant_ids(job)
        lane_group_mode = cls._is_lane_group_combine_spec(step_roll_spec)
        target_specs = cls._build_step_target_slots(job, process) if lane_group_mode else cls._build_step_target_specs(job, process)
        discovery_allowed = required_for_step and cls._allow_non_lineage_roll_discovery(job, process)

        lineage_pool = []
        fallback_pool = []
        discoverable_pool = []
        seen = set()
        lineage_ids = set()
        fallback_ids = set()

        def _is_order_flow_roll(roll):
            # Downstream WIP lineage must be driven by rolls generated by prior
            # execution steps for this order flow (created_by_job source-of-truth).
            created_by_job = getattr(roll, "created_by_job", None)
            if not created_by_job:
                return False
            if getattr(job, "sales_order_item_id", None):
                if str(getattr(created_by_job, "sales_order_item_id", "") or "") == str(job.sales_order_item_id):
                    return True
                return str(getattr(roll, "sales_order_item_id", "") or "") == str(job.sales_order_item_id)
            if getattr(job, "mts_order_id", None):
                return str(getattr(created_by_job, "mts_order_id", "") or "") == str(job.mts_order_id)
            if getattr(job, "template_id", None):
                return str(getattr(created_by_job, "template_id", "") or "") == str(job.template_id)
            return False

        def _is_downstream_visible_roll(roll):
            meta = dict(getattr(roll, "meta_json", None) or {})
            role = str(meta.get("roll_role") or "").upper()
            try:
                source_stage_index = int(meta.get("source_stage_index") or getattr(roll, "stage_index", 0) or 0)
            except Exception:
                source_stage_index = 0
            is_processed_remainder = bool(meta.get("is_remainder")) and source_stage_index > 0 and role != "RAW_REMAINDER"
            if (bool(meta.get("is_remainder")) or role == "REMAINDER") and not is_processed_remainder:
                return False
            if role in {"RAW_MATERIAL", "RAW"}:
                return False
            # WIP pool must only show rolls generated by this order flow.
            # Pure input-stock/raw rows are allocation candidates, not WIP lineage.
            if not _is_order_flow_roll(roll):
                return False
            try:
                stage_idx = int(getattr(roll, "stage_index", 0) or 0)
            except Exception:
                stage_idx = 0
            if stage_idx == 0:
                return False
            if current_step_index <= 0:
                return True
            try:
                roll_idx = int(getattr(roll, "current_step_index", 0) or 0)
            except Exception:
                roll_idx = 0
            try:
                completed_idx = int(getattr(roll, "completed_step_index", roll_idx) or roll_idx)
            except Exception:
                completed_idx = roll_idx
            if roll_behavior == "MULTI_INPUT_COMBINE":
                return True
            return max(stage_idx, roll_idx, completed_idx) >= current_step_index

        def _matches_lineage(roll):
            if lineage_filter is None:
                return False
            try:
                return InventoryRoll.objects.filter(id=roll.id).filter(lineage_filter).exists()
            except Exception:
                return False

        def _roll_role(roll):
            meta = dict(getattr(roll, "meta_json", None) or {})
            role = str(meta.get("roll_role") or "").upper()
            if bool(meta.get("is_remainder")) and role != "REMAINDER":
                role = "REMAINDER"
            return role

        def _is_step0_raw_gate_allowed(roll):
            if current_step_index != 0 or roll_behavior not in {"MODIFY_EXISTING", "SPLIT"}:
                return True
            if int(getattr(roll, "stage_index", 0) or 0) != 0:
                return False
            if purchasable_variant_ids and str(getattr(roll, "material_id", "") or "") not in purchasable_variant_ids:
                return False
            return True

        def _fallback_source(roll):
            role = _roll_role(roll)
            if current_step_index == 0 and roll_behavior in {"MODIFY_EXISTING", "SPLIT"}:
                return "PURCHASED_FALLBACK"
            if role in {"RAW_MATERIAL", "RAW", "REMAINDER"}:
                return "PURCHASED_FALLBACK"
            if int(getattr(roll, "stage_index", 0) or 0) == 0 and not _is_order_flow_roll(roll):
                return "PURCHASED_FALLBACK"
            return "COMPATIBLE_FALLBACK"

        def _append_roll(roll, source):
            rid = getattr(roll, "id", None)
            if not rid or rid in seen:
                return
            discoverable_pool.append(roll)
            seen.add(rid)
            if source == "LINEAGE":
                lineage_pool.append(roll)
                lineage_ids.add(str(rid))
            else:
                fallback_pool.append(roll)
                fallback_ids.add(str(rid))

        reservations = InventoryReservation.objects.filter(job=job, status="ACTIVE", roll__isnull=False).select_related(
            "roll", "roll__material", "roll__location", "roll__grade"
        )
        for res in reservations:
            roll = res.roll
            if not roll or roll.id in seen:
                continue
            if plant_id and roll.location_id and str(roll.location.plant_id) != str(plant_id):
                continue
            if roll.location and roll.location.code == "IN_TRANSIT":
                continue
            if not _is_step0_raw_gate_allowed(roll):
                continue
            if _matches_lineage(roll) and _is_downstream_visible_roll(roll):
                if cls._is_roll_step_compatible(job, process, roll, target_specs):
                    _append_roll(roll, "LINEAGE")
                    continue
            if discovery_allowed and cls._is_roll_step_compatible(
                job,
                process,
                roll,
                target_specs,
                allow_input_stock_fallback=True,
            ):
                _append_roll(roll, _fallback_source(roll))

        blocked_reasons = []
        action_hints = []

        candidates_qs = (
            InventoryRoll.objects.filter(status__in=["AVAILABLE", "RESERVED"])
            .exclude(location__code="IN_TRANSIT")
            .select_related("material", "location", "grade")
        )
        if plant_id:
            candidates_qs = candidates_qs.filter(location__plant_id=plant_id)

        if lineage_filter is not None:
            lineage_qs = candidates_qs.filter(lineage_filter)
            if current_step_index > 0:
                lineage_qs = lineage_qs.filter(created_by_job__isnull=False)
        else:
            lineage_qs = InventoryRoll.objects.none()

        reserved_by_other = set(
            InventoryReservation.objects.filter(status="ACTIVE", roll__isnull=False)
            .exclude(job=job)
            .exclude(job__job_state__in=["COMPLETED", "CANCELLED"])
            .values_list("roll_id", flat=True)
        )

        if required_for_step:

            # Strict lineage pool for same order/item flow.
            for roll in lineage_qs:
                if roll.id in seen or roll.id in reserved_by_other:
                    continue
                if bool((getattr(roll, "meta_json", None) or {}).get("is_quarantined")):
                    continue
                if not cls._is_roll_step_compatible(job, process, roll, target_specs):
                    continue
                if not _is_downstream_visible_roll(roll):
                    continue
                if not _is_step0_raw_gate_allowed(roll):
                    continue
                _append_roll(roll, "LINEAGE")

            if discovery_allowed and len(lineage_pool) < int(required_rolls or 0):
                if lineage_filter is not None:
                    broad_qs = candidates_qs.exclude(lineage_filter)
                else:
                    broad_qs = candidates_qs
                for roll in broad_qs:
                    if roll.id in seen or roll.id in reserved_by_other:
                        continue
                    if bool((getattr(roll, "meta_json", None) or {}).get("is_quarantined")):
                        continue
                    if not _is_step0_raw_gate_allowed(roll):
                        continue
                    if not cls._is_roll_step_compatible(
                        job,
                        process,
                        roll,
                        target_specs,
                        allow_input_stock_fallback=True,
                    ):
                        continue
                    _append_roll(roll, _fallback_source(roll))
        else:
            # Preserve lineage visibility for bulk-input steps so WIP continuity
            # is visible after upstream roll-producing steps/inter-plant moves.
            for roll in lineage_qs:
                if roll.id in seen:
                    continue
                if bool((getattr(roll, "meta_json", None) or {}).get("is_quarantined")):
                    continue
                if not cls._is_roll_step_compatible(job, process, roll, target_specs):
                    continue
                if not _is_downstream_visible_roll(roll):
                    continue
                if not _is_step0_raw_gate_allowed(roll):
                    continue
                _append_roll(roll, "LINEAGE")

        discoverable_pool.sort(key=lambda r: Decimal(str(r.weight_kg or 0)), reverse=True)
        lineage_pool.sort(key=lambda r: Decimal(str(r.weight_kg or 0)), reverse=True)
        fallback_pool.sort(key=lambda r: Decimal(str(r.weight_kg or 0)), reverse=True)
        pool_weight = sum(Decimal(str(getattr(r, "weight_kg", 0) or 0)) for r in discoverable_pool)
        lineage_weight = sum(Decimal(str(getattr(r, "weight_kg", 0) or 0)) for r in lineage_pool)
        fallback_weight = sum(Decimal(str(getattr(r, "weight_kg", 0) or 0)) for r in fallback_pool)
        reserved_roll_list = [res.roll for res in reservations if getattr(res, "roll", None)]
        reserved_rolls = len(reserved_roll_list)
        lane_groups = []
        if lane_group_mode and required_for_step:
            lineage_validation = cls._match_rolls_to_lane_slots(
                job,
                process,
                lineage_pool,
                target_specs,
                allow_input_stock_fallback=True,
            )
            reservation_validation = cls._match_rolls_to_lane_slots(
                job,
                process,
                reserved_roll_list,
                target_specs,
                allow_input_stock_fallback=True,
            )
            discoverable_validation = cls._match_rolls_to_lane_slots(
                job,
                process,
                discoverable_pool,
                target_specs,
                allow_input_stock_fallback=True,
            )
            missing_lineage_rolls = len(lineage_validation.get("unmatched_target_slots") or [])
            missing_assignment_rolls = len(reservation_validation.get("unmatched_target_slots") or [])
            missing_discoverable_rolls = len(discoverable_validation.get("unmatched_target_slots") or [])
            lane_groups = discoverable_validation.get("lane_groups") or []
        else:
            missing_lineage_rolls = max(0, required_rolls - len(lineage_pool)) if required_for_step else 0
            missing_assignment_rolls = max(0, required_rolls - reserved_rolls) if required_for_step else 0
            missing_discoverable_rolls = max(0, required_rolls - len(discoverable_pool)) if required_for_step else 0
        if required_for_step and missing_assignment_rolls > 0:
            blocked_reasons.append(f"Roll assignment short: {missing_assignment_rolls} more roll(s) must be reserved.")
            action_hints.append("Reserve required rolls before machine start.")
        if required_for_step and missing_lineage_rolls > 0:
            blocked_reasons.append(f"True WIP short: {missing_lineage_rolls} downstream lineage roll(s) missing.")
            if len(fallback_pool) > 0:
                action_hints.append("Use compatible fallback rolls manually where true WIP is short.")
        if required_for_step and current_step_index == 0 and roll_behavior in {"MODIFY_EXISTING", "SPLIT"}:
            action_hints.append("Step 1 requires explicit raw/purchasable roll allocation.")

        return {
            "pool": discoverable_pool,
            "discoverable_pool": discoverable_pool,
            "lineage_pool": lineage_pool,
            "fallback_pool": fallback_pool,
            "lineage_ids": list(lineage_ids),
            "fallback_ids": list(fallback_ids),
            "meta": {
                "required_for_step": required_for_step,
                "eligible_count": len(lineage_pool),
                "eligible_weight_kg": float(lineage_weight),
                "lineage_roll_count": len(lineage_pool),
                "lineage_total_weight_kg": float(lineage_weight),
                "discoverable_roll_count": len(discoverable_pool),
                "discoverable_total_weight_kg": float(pool_weight),
                "fallback_roll_count": len(fallback_pool),
                "fallback_total_weight_kg": float(fallback_weight),
                "required_rolls": required_rolls if required_for_step else 0,
                "input_lane_count": int(step_roll_spec.get("input_lane_count") or required_rolls or 0) if required_for_step else 0,
                "lane_group_mode": lane_group_mode,
                "lane_groups": lane_groups,
                "required_target_specs": target_specs,
                "reserved_rolls": reserved_rolls,
                "missing_rolls": missing_assignment_rolls,
                "missing_lineage_rolls": missing_lineage_rolls,
                "missing_assignment_rolls": missing_assignment_rolls,
                "missing_discoverable_rolls": missing_discoverable_rolls,
                "blocked_reasons": blocked_reasons,
                "action_hints": action_hints,
                "execution_model_version": cls._execution_model_version(job),
            },
            "recent_lineage": cls._recent_lineage_rolls(job, plant_id),
        }

    @classmethod
    def _resolve_wip_pool_details(cls, job):
        if cls._is_v2(job):
            return cls._resolve_wip_pool_details_v2(job)

        process = job.current_process or job.process
        plant_id = cls._resolve_job_plant_id(job)
        lineage_filter = cls._resolve_job_lineage_filter(job)
        required_for_step = bool(process and (process.input_form or "").upper() == "ROLL")
        required_rolls = cls._required_roll_count(job, process, cls._resolve_step_roll_spec(job, process))
        current_step_index = int(getattr(job, "current_step_index", 0) or 0)
        roll_behavior = str(getattr(process, "roll_behavior", "") or "").upper()

        pool = []
        seen = set()
        blocked_reasons = []
        action_hints = []
        lineage_roll_count = 0
        lineage_total_weight = Decimal("0")

        if lineage_filter is not None:
            lineage_qs = (
                InventoryRoll.objects.filter(lineage_filter)
                .exclude(location__code='IN_TRANSIT')
                .filter(status__in=['AVAILABLE', 'RESERVED'])
            )
            if plant_id:
                lineage_qs = lineage_qs.filter(location__plant_id=plant_id)
            lineage_roll_count = lineage_qs.count()
            lineage_total_weight = (
                lineage_qs.aggregate(total=Sum("weight_kg")).get("total")
                or Decimal("0")
            )

        # Always include this job's explicit reservations first.
        reservations = InventoryReservation.objects.filter(job=job, status='ACTIVE').select_related(
            'roll',
            'roll__material',
            'roll__location',
            'roll__grade',
        )
        reserved_count = 0
        for res in reservations:
            if not res.roll:
                continue
            roll = res.roll
            if roll.id in seen:
                continue
            if plant_id and roll.location_id and str(roll.location.plant_id) != str(plant_id):
                continue
            if roll.location and roll.location.code == 'IN_TRANSIT':
                continue
            pool.append(roll)
            seen.add(roll.id)
            reserved_count += 1

        recent_lineage = cls._recent_lineage_rolls(job, plant_id)
        if not required_for_step:
            pool_weight = sum(Decimal(str(getattr(r, "weight_kg", 0) or 0)) for r in pool)
            pool.sort(key=lambda r: Decimal(str(r.weight_kg or 0)), reverse=True)
            return {
                "pool": pool,
                "meta": {
                    "required_for_step": False,
                    "eligible_count": len(pool),
                    "eligible_weight_kg": float(pool_weight),
                    "lineage_roll_count": int(lineage_roll_count),
                    "lineage_total_weight_kg": float(lineage_total_weight),
                    "required_rolls": 0,
                    "reserved_rolls": reserved_count,
                    "missing_rolls": 0,
                    "blocked_reasons": ["Current step does not require roll input."],
                    "action_hints": ["Continue with bulk execution; WIP shown for lineage continuity only."],
                },
                "recent_lineage": recent_lineage,
            }

        if lineage_filter is None:
            blocked_reasons.append("Unable to determine job lineage for WIP discovery.")
            action_hints.append("Link job to Sales Item, Stock order, or template lineage.")

        reserved_by_other_roll_ids = set(
            InventoryReservation.objects.filter(status='ACTIVE', roll__isnull=False)
            .exclude(job__job_state__in=['COMPLETED', 'CANCELLED'])
            .exclude(job=job)
            .values_list('roll_id', flat=True)
        )
        target_specs = cls._build_step_target_specs(job, process)
        expected_stage_names = cls._expected_input_stage_names(job, process)
        try:
            from apps.inventory.serializers import (
                resolve_roll_display_label as roll_display_label_resolver,
                resolve_roll_role as roll_role_resolver,
                resolve_roll_stage_name as stage_name_resolver,
            )
        except Exception:
            roll_display_label_resolver = None
            roll_role_resolver = None
            stage_name_resolver = None

        all_lineage_qs = (
            InventoryRoll.objects.filter(status__in=['AVAILABLE', 'RESERVED'])
            .exclude(location__code='IN_TRANSIT')
        )
        if plant_id:
            all_lineage_qs = all_lineage_qs.filter(location__plant_id=plant_id)
        if lineage_filter is not None:
            all_lineage_qs = all_lineage_qs.filter(lineage_filter)

        all_lineage_rolls = [
            roll for roll in all_lineage_qs.select_related("material", "location", "grade")
            if not bool((getattr(roll, "meta_json", None) or {}).get("is_quarantined"))
        ]
        if not all_lineage_rolls:
            blocked_reasons.append("No lineage-compatible rolls available in current plant.")
            action_hints.append("Receive transfer or release upstream output rolls for this lineage.")

        # Phase 73: Separate Discovery from True WIP
        # Discovered rolls are split into those belonging to immediate lineage (WIP)
        # and those found via broad search (Stock/Discovery).
        lineage_discovered_rolls = []
        broad_discovered_rolls = []
        
        for roll in all_lineage_rolls:
            if reserved_by_other_roll_ids and roll.id in reserved_by_other_roll_ids:
                continue
            meta = dict(getattr(roll, "meta_json", None) or {})
            role = None
            if roll_role_resolver:
                try:
                    role = str(roll_role_resolver(roll) or "").upper()
                except Exception:
                    role = None
            if not role:
                role = str((meta.get("roll_role") or "")).upper() or None
            # Remainder rolls are free reusable stock, but should not be auto-carried
            # as forward order WIP in step-required discovery.
            if role == "REMAINDER" or bool(meta.get("is_remainder")):
                continue
            # Non-combine roll-input steps should consume immediate/upstream
            # step outputs for the current progression, not older lineage stock.
            if roll_behavior != "MULTI_INPUT_COMBINE":
                try:
                    roll_step_index = int(getattr(roll, "current_step_index", 0) or 0)
                except Exception:
                    roll_step_index = 0
                if roll_step_index < current_step_index:
                    continue
            if (roll.thickness_micron or 0) <= 0:
                continue
            if (roll.width_mm or 0) <= 0:
                continue
            if not roll.grade_id:
                continue
            if expected_stage_names and stage_name_resolver:
                try:
                    stage_name = str(stage_name_resolver(roll) or "")
                except Exception:
                    stage_name = ""
                if stage_name and stage_name not in expected_stage_names:
                    continue
            lineage_discovered_rolls.append(roll)
        
        # Phase 73: Hardcore Step 1 Purity (User Request)
        # For Step 1, we strictly suppress lineage-based "Auto-Pool" suggestions.
        # This prevents "stale" rolls from appearing in the WIP sidebar and forces
        # all candidates (Raw Material & Remainders) into the main discovery list.
        if current_step_index == 0:
            lineage_discovered_rolls = []

        lineage_discovered_rolls.sort(key=lambda r: (Decimal(str(r.weight_kg or 0)), -(int(r.created_at.timestamp()) if getattr(r, "created_at", None) else 0)), reverse=True)

        if all_lineage_rolls and not lineage_discovered_rolls and current_step_index > 0:
            blocked_reasons.append("Lineage rolls are reserved by other jobs or missing physical specs.")
            action_hints.append("Release competing reservations or correct roll specs (grade/width/thickness).")

        eligible_lineage = []
        for roll in lineage_discovered_rolls:
            if roll.id in seen:
                continue
            if cls._is_roll_step_compatible(job, process, roll, target_specs):
                eligible_lineage.append(roll)

        if lineage_discovered_rolls and not eligible_lineage:
            blocked_reasons.append("No lineage rolls match current step input spec.")
            action_hints.append("Use WCM override assignment or move compatible upstream rolls.")

        # Phase 73: Broad search discovery for Step 1 (allow stock & remainder discovery)
        # Modified: ALWAYS run broad search for Step 1, even if some reservations exist.
        # This ensures all available raw material and remainders are visible in the main list.
        if current_step_index == 0:
            # User Request: Restrict Step 1 broad search to Purchasable/Raw Material rolls (Stage 0)
            # OR Remainder rolls (which are treated as Raw Material equivalents)
            broad_qs = InventoryRoll.objects.filter(status='AVAILABLE').exclude(location__code='IN_TRANSIT')
            
            # Remainder Stage 0 Enforcement is the source of truth here.
            broad_qs = broad_qs.filter(stage_index=0) 
            
            if plant_id:
                broad_qs = broad_qs.filter(location__plant_id=plant_id)
            
            # Find candidate materials from target_specs
            potential_v_ids = {str(s.get("variant_id")) for s in target_specs if s.get("variant_id")}
            potential_f_ids = {str(s.get("family_id")) for s in target_specs if s.get("family_id")}
            
            if potential_v_ids or potential_f_ids:
                from django.db.models import Q
                q_objs = Q()
                if potential_v_ids:
                    q_objs |= Q(material_id__in=list(potential_v_ids))
                if potential_f_ids:
                    q_objs |= Q(material__parent_family_id__in=list(potential_f_ids))
                
                broad_qs = broad_qs.filter(q_objs).select_related("material", "location", "grade")
                
                for roll in broad_qs[:50]:
                    if roll.id in seen:
                        continue
                    # Skip quarantined/remainder in broad search too
                    meta = dict(getattr(roll, "meta_json", None) or {})
                    if bool(meta.get("is_quarantined")):
                        continue
                    # Phase 73: Allow remainder rolls in broad search (User Request)
                    # if bool(meta.get("is_remainder")):
                    #      continue
                        
                    if cls._is_roll_step_compatible(job, process, roll, target_specs):
                         broad_discovered_rolls.append(roll)

        # Final Assembly: Combined pool for Modal, Separated for Sidebar
        eligible_all = eligible_lineage + broad_discovered_rolls
        
        for roll in eligible_all:
            if roll.id in seen:
                continue
            
            # Phase 73: Mask Remainder Role for Step 1 Allocation
            # User Feedback: "WIP Pool has rolls... this is 1st step"
            # If we mask the "REMAINDER" role, the Frontend treats it as standard Raw Material
            # (Main Search Results) instead of segregating it to the "Auto-Pool" (WIP sidebar).
            if current_step_index == 0:
                 meta = getattr(roll, "meta_json", None) or {}
                 if str(meta.get("roll_role") or "").upper() == "REMAINDER" or bool(meta.get("is_remainder")):
                     # Mask metadata in memory (does not affect DB)
                     new_meta = dict(meta)
                     new_meta["roll_role"] = None
                     new_meta["is_remainder"] = False
                     # Clear source stage if user wants "0 hardcore" raw appearance?
                     # Ideally yes, if it's treated as Raw, it shouldn't say "Printed".
                     if new_meta.get("source_stage_name"):
                         new_meta["source_stage_name"] = None
                     if new_meta.get("source_process_code"):
                         new_meta["source_process_code"] = None
                     roll.meta_json = new_meta

            pool.append(roll)
            seen.add(roll.id)

        pool.sort(key=lambda r: Decimal(str(r.weight_kg or 0)), reverse=True)
        pool_weight = sum(Decimal(str(getattr(r, "weight_kg", 0) or 0)) for r in pool)
        missing_rolls = max(0, required_rolls - len(pool))
        if missing_rolls > 0:
            blocked_reasons.append(f"Roll shortage: {missing_rolls} more roll(s) required.")
            action_hints.append("Open WCM assignment or Inter-Plant transfer to satisfy shortage.")

        try:
            from apps.inventory.serializers import resolve_roll_stage_name as _resolve_stage_name
        except Exception:
            _resolve_stage_name = None

        return {
            "pool": pool, # Combined (Reservations + Lineage-WIP + Broad-Discovery)
            "lineage_pool": eligible_lineage, # True WIP Only
            "meta": {
                "required_for_step": True,
                "eligible_count": len(pool),
                "eligible_weight_kg": float(pool_weight),
                "lineage_roll_count": int(lineage_roll_count),
                "lineage_total_weight_kg": float(lineage_total_weight),
                "required_rolls": required_rolls,
                "reserved_rolls": reserved_count,
                "missing_rolls": missing_rolls,
                "expected_stage_names": sorted(list(expected_stage_names or [])),
                "blocked_reasons": blocked_reasons,
                "action_hints": action_hints,
            },
            "recent_lineage": recent_lineage,
        }

    @classmethod
    def get_wip_pool(cls, job_id):
        """
        Strict WIP Pool resolver for machine execution.
        WIP Pool = lineage-scoped rolls available for the current step.
        """
        job = ProductionJob.objects.select_related(
            'template',
            'mts_order',
            'sales_order_item',
            'current_process',
            'process',
            'work_center__plant',
            'from_location__plant',
            'to_location__plant',
        ).get(id=job_id)

        details = cls._resolve_wip_pool_details(job)
        # User Request: Harder Core Isolation.
        # WIP Pool (Sidebar) should ONLY contain rolls created in previous steps of this order.
        # Broad discovery (Stock) is for the Allocation Modal only.
        lineage_pool = list(details.get("lineage_pool") or [])

        process = job.current_process or job.process
        if process and str(process.input_form or "").upper() == "ROLL":
            current_step_index = int(getattr(job, "current_step_index", 0) or 0)
            roll_behavior = str(getattr(process, "roll_behavior", "") or "").upper()
            filtered = []
            seen_ids = set()
            for roll in lineage_pool:
                if not roll or roll.id in seen_ids:
                    continue
                seen_ids.add(roll.id)
                meta = dict(getattr(roll, "meta_json", None) or {})
                roll_role = str(meta.get("roll_role") or "").upper()
                is_remainder = bool(meta.get("is_remainder")) or roll_role == "REMAINDER"
                try:
                    source_stage_index = int(meta.get("source_stage_index") or getattr(roll, "stage_index", 0) or 0)
                except Exception:
                    source_stage_index = 0
                is_processed_remainder = is_remainder and source_stage_index > 0 and roll_role != "RAW_REMAINDER"
                # Downstream steps must not show stage-0 raw/remainder rolls in WIP.
                if current_step_index > 0 and is_remainder and not is_processed_remainder:
                    continue
                if current_step_index > 0 and roll_role in {"RAW_MATERIAL", "RAW"}:
                    continue
                if current_step_index > 0 and roll_behavior != "MULTI_INPUT_COMBINE":
                    try:
                        roll_step_index = int(getattr(roll, "current_step_index", 0) or 0)
                    except Exception:
                        roll_step_index = 0
                    try:
                        roll_stage_index = int(getattr(roll, "stage_index", 0) or 0)
                    except Exception:
                        roll_stage_index = 0
                    if max(roll_step_index, roll_stage_index) < current_step_index:
                        continue
                filtered.append(roll)
            lineage_pool = filtered

        return lineage_pool

    @classmethod
    def calculate_missing_layers(cls, job, pool):
        """
        Phase 67: Dynamic Requirement Calculator.
        Compares Template/BOM requirements vs WIP Pool.
        Returns missing quantities per material variant.
        """
        requirements = cls.calculate_requirements(job.id) # Ensure reqs exist
        
        # Aggregate Pool Content
        pool_inventory = {} # material_id -> qty
        for roll in pool:
            mat_id = roll.material_id
            pool_inventory[mat_id] = pool_inventory.get(mat_id, 0) + float(roll.weight_kg)
            
        missing_report = []
        
        for req in requirements:
            required = float(req.required_qty)
            available = pool_inventory.get(req.material_id, 0)
            missing = max(0, required - available)
            
            if missing > 0:
                missing_report.append({
                    'family': req.material.parent_family.name if req.material.parent_family else 'N/A',
                    'variant': req.material.name,
                    'variant_id': str(req.material.id),
                    'required_qty': required,
                    'available_qty': available,
                    'missing_qty': missing
                })
                
        return missing_report

    @classmethod
    def calculate_requirements(cls, job_id):
        """
        Explodes the BOM for a job and creates/updates JobMaterialRequirement records.
        Phase 71 Refinement: Uses TemplateProcessStepMaterial.
        """
        job = ProductionJob.objects.select_related('template', 'sales_order_item').get(id=job_id)

        if cls._is_v2(job):
            return cls.calculate_requirements_v2(job)
        
        requirements = []

        # Unit conversion helpers:
        # - Jobs can be planned in KG or PCS (SalesOrderItem.qty_uom).
        # - TemplateProcessStepMaterial.value is expressed per "output unit" according to quantity_mode.
        #   In our UI, both KG/PCS modes are treated as "kg per unit", where the unit is KG or PCS respectively.
        # - For mismatch (e.g. PCS-mode mapping on a KG job), convert using robust unit weight.
        unit_weight_g = cls._job_unit_weight_g(job)

        def qty_in_units(target_uom: str) -> Decimal | None:
            """
            Convert the job's planned quantity into the requested unit.
            Returns None if conversion isn't possible (missing unit weight).
            """
            qty = Decimal(str(job.quantity or 0))
            job_uom = str(job.uom or "KG").upper()
            target_uom = str(target_uom or "").upper()

            if target_uom == job_uom:
                return qty

            if job_uom == "KG" and target_uom == "PCS":
                if unit_weight_g <= 0:
                    return None
                # pcs = (kg * 1000g) / (g/pc)
                return (qty * Decimal("1000")) / unit_weight_g

            if job_uom == "PCS" and target_uom == "KG":
                if unit_weight_g <= 0:
                    return None
                # kg = (pcs * g/pc) / 1000g
                return (qty * unit_weight_g) / Decimal("1000")

            return None

        def total_output_weight_kg() -> Decimal:
            qty = Decimal(str(job.quantity or 0))
            job_uom = str(job.uom or "KG").upper()
            if job_uom == "KG":
                return qty
            if job_uom == "PCS" and unit_weight_g > 0:
                return (qty * unit_weight_g) / Decimal("1000")
            return Decimal("0")
        
        # Phase 71 Final: Full BOM Explosion (All Steps)
        # ---------------------------------------------
        if job.template:
            from apps.templates.models import TemplateProcessStep
            
            # 1. Fetch ALL steps
            steps = TemplateProcessStep.objects.filter(template=job.template).order_by('sequence_number')
            
            with transaction.atomic():
                # Clear existing to ensure freshness (optional, but cleaner for re-calculation)
                # JobMaterialRequirement.objects.filter(production_job=job).delete() 
                # Keep update_or_create to preserve consumed_qty if re-calculating mid-job
                
                for step in steps:
                    # Phase 73: Special Case - 1st Step Roll Requirement
                    # If this is the first step of the routing and consumes a roll, explicitly 
                    # add the base film to the requirements table if not already there.
                    if step.sequence_number == 1 and job.input_form == 'ROLL':
                        layer0 = cls._first_layer_snapshot(job)
                        mat_id = layer0.get("variant_id") or layer0.get("material_id")
                        if mat_id:
                            from apps.inventory.models import InventoryMaterial
                            mat = InventoryMaterial.objects.filter(id=str(mat_id)).first()
                            if mat:
                                # Phase 73 FIX: Requirement for 1st step film layer should be its proportional
                                # weight from BOM, NOT the total job weight. 
                                layer0_weight_kg = Decimal('0')
                                if unit_weight_g > 0:
                                     l_g = Decimal(str(layer0.get('weight_g', 0) or 0))
                                     if l_g <= 0:
                                         # Dynamic calc from thickness/density/area
                                         try:
                                             g_snap = cls._job_geometry_snapshot(job) or {}
                                             base = g_snap.get('base', g_snap)
                                             w = Decimal(str(base.get('width_mm', 0)))
                                             h = Decimal(str(base.get('height_mm', 0)))
                                             area_m2 = (w * h) / Decimal('1000000')
                                             
                                             th = Decimal(str(layer0.get('thickness_micron', 0) or 0))
                                             den = Decimal(str(layer0.get('density_g_cm3', 0) or 0.92))
                                             if area_m2 > 0 and th > 0:
                                                 l_g = area_m2 * th * den
                                         except Exception:
                                             l_g = Decimal("0")

                                     if l_g > 0:
                                         layer0_weight_kg = (l_g / unit_weight_g) * total_output_weight_kg()
                                     
                                if layer0_weight_kg <= 0:
                                    # Final fallback: scale by layer count if weights missing
                                    layer_count = len(cls._job_layer_snapshot(job) or [{}])
                                    layer0_weight_kg = total_output_weight_kg() / Decimal(str(max(1, layer_count)))

                                JobMaterialRequirement.objects.update_or_create(
                                    production_job=job,
                                    material=mat,
                                    process_step=step,
                                    defaults={
                                        'required_qty': layer0_weight_kg,
                                        'uom': 'KG'
                                    }
                                )

                    step_materials = step.materials.all().select_related('material')
                    
                    for tm in step_materials:
                        material = tm.material
                        req_qty = Decimal('0.0')

                        # Special case: Consolidated Ink Pool requirements.
                        # Template Studio maps only ONE ink row (INK-POLY / INK-PET),
                        # but execution must consume per-color inks from APPROVED Artwork mapping.
                        if material and material.category == 'INK' and material.code in ['INK-POLY', 'INK-PET']:
                            printing_snapshot = cls._job_printing_snapshot(job) or {}
                            if bool((printing_snapshot or {}).get("enabled", False)):
                                try:
                                    printing_snapshot = validate_frozen_printing_snapshot(
                                        printing_snapshot,
                                        layer_snapshot=cls._job_layer_snapshot(job) or [],
                                        require_artwork=True,
                                        strict_inks=True,
                                    )
                                except ValidationError as exc:
                                    raise ValueError(f"Execution print contract is invalid for {material.code}: {exc}") from exc

                                color_names = printing_snapshot.get("color_names") or []
                                mapping = printing_snapshot.get("color_mapping") or {}

                                if len(color_names) > 0:
                                    # Compute consolidated requirement for this step, then split evenly per color.
                                    mode = str(getattr(tm, "consumption_basis", "") or tm.quantity_mode or "KG").upper()
                                    basis = {
                                        "KG": "FIXED_KG",
                                        "PCS": "FIXED_PCS",
                                        "GSM": "SNAPSHOT_GSM",
                                        "PERCENT": "INVALID_LEGACY",
                                        "RECIPE": "INVALID_LEGACY",
                                    }.get(mode, mode)
                                    if basis == "FIXED_KG":
                                        q = qty_in_units("KG")
                                        req_qty = tm.value * q if q is not None else Decimal("0.0")
                                    elif basis == "FIXED_PCS":
                                        q = qty_in_units("PCS")
                                        req_qty = tm.value * q if q is not None else Decimal("0.0")
                                    elif basis == "SNAPSHOT_GSM":
                                        raise ValueError(f"SNAPSHOT_GSM requirements must be resolved through the V2 BOM pipeline for {material.code}")
                                    else:
                                        raise ValueError(f"Unsupported legacy consumption basis for {material.code}")

                                    per_color_qty = (req_qty / Decimal(str(len(color_names)))) if len(color_names) else Decimal('0.0')

                                    for color in color_names:
                                        ink_id = mapping.get(color)
                                        ink_mat = InventoryMaterial.objects.filter(id=str(ink_id), category='INK').first()
                                        if not ink_mat:
                                            raise ValueError(
                                                f"Execution print contract resolved missing ink material for {material.code} color {color}."
                                            )

                                        JobMaterialRequirement.objects.update_or_create(
                                            production_job=job,
                                            material=ink_mat,
                                            process_step=step,
                                            defaults={
                                                'required_qty': per_color_qty,
                                                'uom': 'KG'
                                            }
                                        )
                                    # Skip creating a requirement row for the consolidated pool material.
                                    continue
                        
                        # Calculation Logic based on Mode
                        mode = str(getattr(tm, "consumption_basis", "") or tm.quantity_mode or "KG").upper()
                        basis = {
                            "KG": "FIXED_KG",
                            "PCS": "FIXED_PCS",
                            "GSM": "SNAPSHOT_GSM",
                            "PERCENT": "INVALID_LEGACY",
                            "RECIPE": "INVALID_LEGACY",
                        }.get(mode, mode)
                        if basis == "FIXED_KG":
                            q = qty_in_units("KG")
                            req_qty = tm.value * q if q is not None else Decimal("0.0")
                        elif basis == "FIXED_PCS":
                            q = qty_in_units("PCS")
                            req_qty = tm.value * q if q is not None else Decimal("0.0")
                        elif basis == 'SNAPSHOT_GSM':
                            raise ValueError(f"SNAPSHOT_GSM requirements must be resolved through the V2 BOM pipeline for {material.code}")
                        else:
                            raise ValueError(f"Unsupported legacy consumption basis for {material.code}")

                        req, created = JobMaterialRequirement.objects.update_or_create(
                            production_job=job,
                            material=material,
                            process_step=step, # Link to step
                            defaults={
                                'required_qty': req_qty,
                                'uom': 'KG' # Standardize consumption to KG for now
                            }
                        )
                        requirements.append(req)
                        
            return requirements

    @classmethod
    def calculate_requirements_v2(cls, job):
        """
        V2 requirements:
        - Exact consumable identities come from Sales BOM snapshot.
        - Template step mappings provide category placement only.
        """
        from apps.templates.models import TemplateProcessStep

        if not getattr(job, "template_id", None):
            return []

        steps = list(
            TemplateProcessStep.objects.filter(template=job.template).order_by("sequence_number")
        )
        if not steps:
            return []

        step_by_id = {str(step.id): step for step in steps}
        category_to_step = {}

        def _normalize_category_code(value):
            code = str(value or "").strip().upper()
            aliases = {
                "GRANULES": "GRANULE",
                "INKS": "INK",
                "CHEMS": "CHEMICAL",
                "CHEMICALS": "CHEMICAL",
                "ADDONS": "ADDON",
                "FILMS": "FILM",
            }
            return aliases.get(code, code)

        for step in steps:
            for mapping in step.materials.all():
                source_kind = str(getattr(mapping, "source_kind", "MATERIAL") or "MATERIAL").upper()
                if source_kind == "CATEGORY":
                    code = _normalize_category_code(getattr(mapping, "category_code", ""))
                    if code and code not in category_to_step:
                        category_to_step[code] = step

        if "GRANULE" not in category_to_step:
            fallback_step = next(
                (
                    step for step in steps
                    if str(getattr(getattr(step, "process", None), "input_form", "") or "").upper() == "BULK"
                    and str(getattr(getattr(step, "process", None), "output_form", "") or "").upper() == "ROLL"
                ),
                None,
            )
            if fallback_step is None:
                fallback_step = next(
                    (
                        step for step in steps
                        if "EXTR" in str(
                            getattr(getattr(step, "process", None), "code", "")
                            or getattr(getattr(step, "process", None), "name", "")
                        ).upper()
                    ),
                    None,
                )
            if fallback_step is not None:
                category_to_step["GRANULE"] = fallback_step

        bom = cls._job_bom_snapshot(job) or {}
        if not isinstance(bom, dict):
            bom = {}

        unit_weight_g = cls._job_unit_weight_g(job)
        qty_value = Decimal(str(getattr(job, "quantity", 0) or 0))
        qty_uom = str(getattr(job, "uom", "KG") or "KG").upper()
        order_qty_pcs = Decimal("0")
        if qty_uom == "PCS":
            order_qty_pcs = qty_value
        elif unit_weight_g > 0:
            order_qty_pcs = (qty_value * Decimal("1000")) / unit_weight_g

        def _to_decimal(value):
            try:
                return Decimal(str(value or 0))
            except Exception:
                return Decimal("0")

        def _resolve_material(row, section_name):
            for key in ("material_id", "variant_id", "granule_id", "addon_id", "ink_id", "chemical_id"):
                raw = row.get(key) if isinstance(row, dict) else None
                if raw:
                    mat = InventoryMaterial.objects.filter(id=str(raw)).first()
                    if mat:
                        return mat
            if not isinstance(row, dict):
                return None
            code = str(row.get("code") or "").strip()
            if code:
                mat = InventoryMaterial.objects.filter(code=code).first()
                if mat:
                    return mat
            if str(section_name or "").upper() == "INKS":
                ink_base = str(row.get("ink_base_family") or "").strip().upper()
                if ink_base in {"PET", "POLY"}:
                    base_code = f"INK-{ink_base}"
                    mat = InventoryMaterial.objects.filter(category="INK", code=base_code).first()
                    if mat:
                        return mat
            return None

        def _row_category(section_name, row):
            section = str(section_name or "").upper()
            if section == "FILMS":
                return _normalize_category_code("FILM")
            if section == "GRANULES":
                return _normalize_category_code("GRANULE")
            if section == "INKS":
                return _normalize_category_code("INK")
            if section == "CHEMICALS":
                typ = str((row or {}).get("type") or "").upper()
                if typ in {"ADHESIVE", "SOLVENT"}:
                    return _normalize_category_code(typ)
                return _normalize_category_code("CHEMICAL")
            if section == "ADDONS":
                return _normalize_category_code("ADDON")
            if section == "POD":
                return _normalize_category_code("POD")
            return _normalize_category_code(section)

        def _resolve_step_for_row(section_name, row):
            category_code = _row_category(section_name, row)
            if category_code == "ADHESIVE":
                return category_to_step.get("ADHESIVE") or category_to_step.get("CHEMICAL")
            if category_code == "SOLVENT":
                return category_to_step.get("SOLVENT") or category_to_step.get("CHEMICAL")
            return category_to_step.get(category_code)

        def _row_qty_and_uom(row, material, section_name):
            section = str(section_name or "").upper()
            uom = str(row.get("uom") or row.get("stock_uom") or getattr(material, "base_uom", None) or "KG").upper()
            if section in {"ADDONS", "ADDON"}:
                uom = str(
                    row.get("stock_uom")
                    or row.get("uom")
                    or getattr(material, "addon_purchase_uom", None)
                    or getattr(material, "base_uom", None)
                    or "KG"
                ).upper()
            if uom not in {"KG", "PCS", "METER"}:
                uom = "KG"
            if uom == "KG":
                qty = _to_decimal(row.get("stock_qty") if row.get("stock_qty") not in (None, "") else row.get("weight_kg"))
            else:
                qty = _to_decimal(row.get("stock_qty") if row.get("stock_qty") not in (None, "") else row.get("quantity"))
            return qty, uom

        # Aggregate material requirements by selected step.
        required_matrix = {}
        planning_lines = bom.get("planning_lines") if isinstance(bom.get("planning_lines"), list) else []
        if planning_lines:
            for row in planning_lines:
                if not isinstance(row, dict):
                    continue
                material_id = row.get("material_id")
                step_id = row.get("step_id")
                category_code = _normalize_category_code(row.get("category_code"))
                if not step_id and category_code:
                    fallback_step = category_to_step.get(category_code)
                    if fallback_step:
                        step_id = str(fallback_step.id)
                if not material_id or not step_id:
                    continue
                step = step_by_id.get(str(step_id))
                if not step:
                    continue
                material = InventoryMaterial.objects.filter(id=str(material_id)).first()
                if not material:
                    continue
                theoretical_qty = _to_decimal(row.get("theoretical_qty"))
                planned_issue_qty = _to_decimal(row.get("planned_issue_qty"))
                if planned_issue_qty <= 0:
                    continue
                row_uom = str(row.get("uom") or getattr(material, "base_uom", None) or "KG").upper()
                if row_uom not in {"KG", "PCS", "METER"}:
                    row_uom = "KG"
                key = (str(step.id), str(material.id))
                bucket = required_matrix.get(
                    key,
                    {"required_qty": Decimal("0"), "theoretical_qty": Decimal("0"), "uom": row_uom},
                )
                bucket["required_qty"] += planned_issue_qty
                bucket["theoretical_qty"] += theoretical_qty
                bucket["uom"] = bucket.get("uom") or row_uom
                required_matrix[key] = bucket
        else:
            for section_name in ("films", "granules", "inks", "chemicals", "addons", "pod"):
                rows = bom.get(section_name) or []
                if not isinstance(rows, list):
                    continue
                for row in rows:
                    if not isinstance(row, dict):
                        continue
                    material = _resolve_material(row, section_name)
                    if not material:
                        continue

                    step = _resolve_step_for_row(section_name, row)
                    if not step:
                        continue

                    per_unit_qty, row_uom = _row_qty_and_uom(row, material, section_name)
                    if per_unit_qty <= 0:
                        continue

                    if order_qty_pcs > 0:
                        required_qty = per_unit_qty * order_qty_pcs
                    elif qty_uom == "KG":
                        # ROLL KG invariant mode stores BOM rows as absolute order-level quantities.
                        required_qty = per_unit_qty
                    else:
                        required_qty = Decimal("0")
                    key = (str(step.id), str(material.id))
                    bucket = required_matrix.get(
                        key,
                        {"required_qty": Decimal("0"), "theoretical_qty": Decimal("0"), "uom": row_uom},
                    )
                    bucket["required_qty"] += required_qty
                    bucket["theoretical_qty"] += required_qty
                    bucket["uom"] = bucket.get("uom") or row_uom
                    required_matrix[key] = bucket

        requirements = []
        with transaction.atomic():
            for (step_id, material_id), qtys in required_matrix.items():
                step = step_by_id.get(step_id)
                material = InventoryMaterial.objects.filter(id=material_id).first()
                if not step or not material:
                    continue
                required_qty = _to_decimal(qtys.get("required_qty"))
                theoretical_qty = _to_decimal(qtys.get("theoretical_qty"))
                uom = str(qtys.get("uom") or getattr(material, "base_uom", None) or "KG").upper()
                if uom not in {"KG", "PCS", "METER"}:
                    uom = "KG"
                req, _created = JobMaterialRequirement.objects.update_or_create(
                    production_job=job,
                    material=material,
                    process_step=step,
                    defaults={
                        "theoretical_qty": theoretical_qty,
                        "planned_issue_qty": required_qty,
                        "required_qty": required_qty,
                        "uom": uom,
                    },
                )
                requirements.append(req)

        return requirements


    @classmethod
    def get_job_context(cls, job_id, reconcile_assignment=True):
        """
        Loads full execution context for the WCM Terminal.
        """
        import logging
        logger = logging.getLogger(__name__)
        
        job = ProductionJob.objects.get(id=job_id)
        process = job.current_process or job.process
        
        try:
            from apps.inventory.serializers import (
                resolve_roll_display_label as roll_display_label_resolver,
                resolve_roll_role as roll_role_resolver,
                resolve_roll_stage_name as stage_name_resolver,
            )
        except Exception:
            roll_display_label_resolver = None
            roll_role_resolver = None
            stage_name_resolver = None
        
        logger.debug(
            "get_job_context job=%s state=%s status=%s step=%s",
            job_id,
            job.job_state,
            job.status,
            job.current_step_index,
        )
        logger.debug(
            "get_job_context job=%s so_item=%s template=%s mts=%s",
            job_id,
            job.sales_order_item_id,
            job.template_id,
            getattr(job, "mts_order_id", None),
        )

        def _as_float(value, default=0.0):
            try:
                if value in (None, ""):
                    return float(default)
                return float(value)
            except Exception:
                return float(default)

        # Reconcile old assignment links into reservation source-of-truth.
        # For some mutation flows (notably unassign), callers may request
        # a context refresh without rehydrating legacy M2M links.
        if reconcile_assignment:
            cls.reconcile_assignment_reservations(job)

        # Resolve target substrate spec (for Step 0 roll selection UX).
        layer_snapshot = cls._job_layer_snapshot(job)
        if not isinstance(layer_snapshot, list):
            layer_snapshot = []
        resolver_qty = float(job.quantity or 0)

        # Normalize layer snapshot so downstream UI/filters always get:
        # - variant_name
        # - grade_name
        # - thickness_micron
        # even when older snapshots only stored IDs or alternate keys.
        if isinstance(layer_snapshot, list) and layer_snapshot:
            variant_ids = set()
            family_ids = set()
            grade_ids = set()
            unresolved_tokens_by_idx = {}
            for layer in layer_snapshot:
                if not isinstance(layer, dict):
                    continue
                v_id = layer.get("variant_id") or layer.get("material_id")
                f_id = layer.get("family_id")
                g_id = layer.get("grade_id")
                if v_id:
                    variant_ids.add(str(v_id))
                if f_id:
                    family_ids.add(str(f_id))
                if g_id:
                    grade_ids.add(str(g_id))

            # Resolve missing variant/family IDs from layer tokens (code/name snapshots).
            token_to_mat = {}
            try:
                with transaction.atomic():
                    unresolved_tokens = []
                    for idx, layer in enumerate(layer_snapshot):
                        if not isinstance(layer, dict):
                            continue
                        if layer.get("variant_id") or layer.get("material_id") or layer.get("family_id"):
                            continue
                        tokens = [
                            layer.get("variant_code"),
                            layer.get("material_code"),
                            layer.get("code"),
                            layer.get("variant_name"),
                            layer.get("material_name"),
                            layer.get("name"),
                            layer.get("family_name"),
                        ]
                        tokens = [str(t).strip() for t in tokens if t]
                        if tokens:
                            unresolved_tokens_by_idx[idx] = tokens
                            unresolved_tokens.extend(tokens)

                    unique_tokens = [t for t in sorted(set(unresolved_tokens)) if t]
                    if unique_tokens:
                        lookup_q = Q()
                        for token in unique_tokens:
                            lookup_q |= Q(code__iexact=token) | Q(name__iexact=token)
                        mats = InventoryMaterial.objects.filter(lookup_q).select_related('parent_family')[:300]
                        for mat in mats:
                            payload = {
                                "id": str(mat.id),
                                "category": mat.category,
                                "name": mat.name,
                                "code": mat.code,
                                "family_id": str(mat.parent_family_id) if mat.parent_family_id else None,
                                "family_name": mat.parent_family.name if mat.parent_family else None,
                            }
                            token_to_mat[mat.code.lower()] = payload
                            token_to_mat[mat.name.lower()] = payload

                    for idx, tokens in unresolved_tokens_by_idx.items():
                        matched = None
                        for token in tokens:
                            key = token.lower()
                            if key in token_to_mat:
                                matched = token_to_mat[key]
                                break
                        if not matched:
                            continue
                        layer = layer_snapshot[idx]
                        if matched.get("category") == "FILM_VARIANT":
                            layer["variant_id"] = layer.get("variant_id") or matched["id"]
                            layer["material_id"] = layer.get("material_id") or matched["id"]
                            layer["variant_name"] = layer.get("variant_name") or matched.get("name")
                            layer["code"] = layer.get("code") or matched.get("code")
                            if matched.get("family_id"):
                                layer["family_id"] = layer.get("family_id") or matched.get("family_id")
                                layer["family_name"] = layer.get("family_name") or matched.get("family_name")
                                family_ids.add(str(matched["family_id"]))
                            variant_ids.add(str(matched["id"]))
                        elif matched.get("category") == "FILM_FAMILY":
                            layer["family_id"] = layer.get("family_id") or matched["id"]
                            layer["family_name"] = layer.get("family_name") or matched.get("name")
                            family_ids.add(str(matched["id"]))
            except Exception:
                pass

            variant_map = {}
            family_map = {}
            if variant_ids or family_ids:
                try:
                    with transaction.atomic():
                        mats = InventoryMaterial.objects.filter(
                            Q(id__in=list(variant_ids)) | Q(id__in=list(family_ids))
                        ).select_related('parent_family')
                        for mat in mats:
                            variant_map[str(mat.id)] = {
                                "name": mat.name,
                                "code": mat.code,
                                "family_id": str(mat.parent_family_id) if mat.parent_family_id else None,
                                "family_name": mat.parent_family.name if mat.parent_family else None,
                            }
                            family_map[str(mat.id)] = mat.name
                except Exception:
                    variant_map = {}
                    family_map = {}

            grade_map = {}
            if grade_ids:
                try:
                    from apps.recipes.models import RecipeGrade
                    with transaction.atomic():
                        grade_map = {str(g.id): g.name for g in RecipeGrade.objects.filter(id__in=list(grade_ids))}
                except Exception:
                    grade_map = {}

            normalized_layers = []
            for layer in layer_snapshot:
                if not isinstance(layer, dict):
                    continue
                l = dict(layer)
                l["thickness_micron"] = (
                    l.get("thickness_micron")
                    if l.get("thickness_micron") is not None
                    else l.get("thickness")
                )

                variant_id = l.get("variant_id") or l.get("material_id")
                if variant_id:
                    vm = variant_map.get(str(variant_id))
                    if vm:
                        l["variant_id"] = str(variant_id)
                        l["variant_name"] = l.get("variant_name") or vm.get("name")
                        l["code"] = l.get("code") or vm.get("code")
                        l["family_id"] = l.get("family_id") or vm.get("family_id")
                        l["family_name"] = l.get("family_name") or vm.get("family_name")
                elif l.get("family_id"):
                    l["family_name"] = l.get("family_name") or family_map.get(str(l["family_id"]))

                if l.get("grade_id"):
                    l["grade_name"] = l.get("grade_name") or grade_map.get(str(l["grade_id"])) or l.get("grade")

                normalized_layers.append(l)

            layer_snapshot = normalized_layers

        target_roll_specs = []
        target_roll_spec = {}

        def _merge_target_spec(spec, bucket):
            """
            Merge roll specs while preserving unique (variant/family + thickness + grade)
            combinations. Keeps first non-empty values for display fields.
            """
            if not isinstance(spec, dict):
                return
            clean = {k: v for k, v in spec.items() if v is not None and v != ""}
            if not clean:
                return
            key = (
                str(clean.get("variant_id") or ""),
                str(clean.get("family_id") or ""),
                str(clean.get("thickness_micron") or ""),
                str(clean.get("grade_id") or ""),
            )
            for existing in bucket:
                ex_key = (
                    str(existing.get("variant_id") or ""),
                    str(existing.get("family_id") or ""),
                    str(existing.get("thickness_micron") or ""),
                    str(existing.get("grade_id") or ""),
                )
                if ex_key == key:
                    for k, v in clean.items():
                        if existing.get(k) in (None, "", 0):
                            existing[k] = v
                    return
            bucket.append(clean)
        if isinstance(layer_snapshot, list) and len(layer_snapshot) > 0 and isinstance(layer_snapshot[0], dict):
            for idx, layer in enumerate(layer_snapshot):
                if not isinstance(layer, dict):
                    continue
                spec = {
                    "layer_index": idx + 1,
                    "family_id": str(layer.get("family_id")) if layer.get("family_id") else None,
                    "variant_id": str(layer.get("variant_id") or layer.get("material_id")) if (layer.get("variant_id") or layer.get("material_id")) else None,
                    "grade_id": str(layer.get("grade_id")) if layer.get("grade_id") else None,
                    "thickness_micron": int(layer.get("thickness_micron")) if layer.get("thickness_micron") is not None else None,
                }
                spec = {k: v for k, v in spec.items() if v is not None}
                _merge_target_spec(spec, target_roll_specs)
            target_roll_spec = target_roll_specs[0] if target_roll_specs else {}

            # Phase 72: Re-resolve BOM for better UI grouping (ensure layer_index exists)
            from apps.bom.services_resolver import BOMResolverService
            
            # Build expected payloads for Resolver

            # Geometry & Area (Calc first for unit weight)
            g_snap = cls._job_geometry_snapshot(job) or {}
            
            # Ensure area_m2 exists
            if 'area_m2' not in g_snap:
                base = g_snap.get('base', g_snap)
                w = Decimal(str(base.get('width_mm', 0)))
                h = Decimal(str(base.get('height_mm', 0)))
                g_snap['area_m2'] = float((w * h) / Decimal('1000000'))

            # Calculate Unit Weight (Physics)
            unit_weight_g = 0.0
            for l in layer_snapshot:
                w_g = _as_float(l.get('weight_g', 0))
                if w_g == 0:
                     # dynamic calc: area (m2) * thickness (mic) * density
                     area = _as_float(g_snap.get('area_m2', 0))
                     th = _as_float(l.get('thickness_micron', 0))
                     den = _as_float(l.get('density_g_cm3', 0))
                     w_g = area * th * den
                unit_weight_g += w_g

            # Determine Order Qty for Resolver (Equivalent Pieces)
            # If UOM is KG, we need to find how many 'units' make up the total weight.
            resolver_qty = float(job.quantity)
            if job.uom == 'KG' and unit_weight_g > 0:
                resolver_qty = (float(job.quantity) * 1000) / unit_weight_g
            
            printing_snapshot = cls._job_printing_snapshot(job) or {}
            t_snap = {
                'film_layers': layer_snapshot,
                'printing': printing_snapshot,
                'chemicals': printing_snapshot.get('chemicals') or {},
                'addons': cls._job_addons_snapshot(job) or [],
                'order_qty': resolver_qty
            }
            
            # Calculate Physics Breakdown (Auto-calculate if missing)
            p_layers = []
            for l in layer_snapshot:
                w_g = _as_float(l.get('weight_g', 0))
                if w_g == 0:
                     # dynamic calc: area (m2) * thickness (mic) * density
                     area = _as_float(g_snap.get('area_m2', 0))
                     th = _as_float(l.get('thickness_micron', 0))
                     den = _as_float(l.get('density_g_cm3', 0))
                     w_g = area * th * den
                p_layers.append({'weight_g': w_g})

            p_snap = {
                'geometry_snapshot': g_snap,
                'breakdown': {
                    'film_layers': p_layers
                }
            }
            
            # Use resolve to get consistent mapping
            try:
                with transaction.atomic():
                    bom_res = BOMResolverService.resolve(t_snap, p_snap)
                bom_granules = bom_res.get('granules', []) or bom_res.get('extrusion_bom', [])
                bom_films = bom_res.get('films', [])
                bom_inks = bom_res.get('inks', [])
                bom_chemicals = bom_res.get('chemicals', [])
                bom_addons = bom_res.get('addons', [])
                bom_pod = bom_res.get('pod', [])
                bom_snapshot = {
                    'films': bom_films or [],
                    'granules': bom_granules or [],
                    'inks': bom_inks or [],
                    'chemicals': bom_chemicals or [],
                    'addons': bom_addons or [],
                    'pod': bom_pod or [],
                }
            except Exception as e:
                logger.debug("BOM resolver failed in get_job_context for job=%s: %s", job_id, e)
                # Fallback to existing snapshot if resolver fails
                from_snap = cls._job_bom_snapshot(job) or {}
                bom_granules = from_snap.get('granules', [])
                bom_films = from_snap.get('films', [])
                bom_inks = from_snap.get('inks', [])
                bom_chemicals = from_snap.get('chemicals', [])
                bom_addons = from_snap.get('addons', [])
                bom_pod = from_snap.get('pod', [])
                bom_snapshot = {
                    'films': bom_films or [],
                    'granules': bom_granules or [],
                    'inks': bom_inks or [],
                    'chemicals': bom_chemicals or [],
                    'addons': bom_addons or [],
                    'pod': bom_pod or [],
                }
                
                # Robust Layer Matching: Inject layer_index if missing
                # Strategy: Match granules to layers where variant_id or name matches
                for g in bom_granules:
                    if 'layer_index' not in g:
                        # Try to find which layer uses this variant_id or material
                        g_var = g.get('variant_id') or g.get('material_id')
                        g_name = g.get('material_name') or g.get('name')
                        
                        found = False
                        for idx, l in enumerate(layer_snapshot):
                            l_var = l.get('variant_id') or l.get('material_id')
                            l_name = l.get('material_name') or l.get('name')
                            
                            # Match by ID
                            if g_var and l_var and str(g_var) == str(l_var):
                                g['layer_index'] = idx + 1
                                found = True
                                break
                            # Match by Material Name (Fallback)
                            if not found and g_name and l_name and g_name.lower() in l_name.lower():
                                g['layer_index'] = idx + 1
                                found = True
                                break
                        
                        # If still no match and only one layer, assume Layer 1
                        if not found and len(layer_snapshot) == 1:
                            g['layer_index'] = 1

            # Expand target specs from resolved BOM film lines as well.
            # This ensures roll picker can include all valid layer variants (not just snapshot IDs).
            for film in (bom_films or []):
                if not isinstance(film, dict):
                    continue
                film_spec = {
                    "variant_id": str(film.get("variant_id")) if film.get("variant_id") else None,
                    "family_id": str(film.get("family_id")) if film.get("family_id") else None,
                    "grade_id": str(film.get("grade_id")) if film.get("grade_id") else None,
                    "thickness_micron": int(film.get("thickness_micron")) if film.get("thickness_micron") is not None else None,
                    "variant_name": film.get("variant_name") or film.get("name"),
                    "family_name": film.get("family_name"),
                    "code": film.get("code"),
                    "layer_index": film.get("layer_index"),
                }
                _merge_target_spec(film_spec, target_roll_specs)

            # Surface required width from layer snapshot roll-width where present.
            # Fallback to geometry width for legacy rows.
            try:
                # Ensure geometry adjustments have correct key names for UI
                for adj in g_snap.get('adjustments', []):
                    if 'impact' in adj and 'on' not in adj:
                        adj['on'] = adj['impact'].title()
                    if 'name' in adj and 'type' not in adj:
                        adj['type'] = adj['name']

                base = g_snap.get("base") if isinstance(g_snap, dict) else None
                base = base if isinstance(base, dict) else g_snap
                req_width_mm = base.get("width_mm") if isinstance(base, dict) else None
                req_width_mm = float(req_width_mm) if req_width_mm is not None else None
                if req_width_mm is not None and req_width_mm <= 0:
                    req_width_mm = None

                for spec in target_roll_specs:
                    layer_width = None
                    try:
                        layer_idx = int(spec.get("layer_index") or 0)
                    except Exception:
                        layer_idx = 0
                    if layer_idx > 0 and isinstance(layer_snapshot, list) and (layer_idx - 1) < len(layer_snapshot):
                        layer_row = layer_snapshot[layer_idx - 1]
                        if isinstance(layer_row, dict):
                            layer_width = layer_row.get("roll_width_mm")
                            if layer_width in (None, ""):
                                layer_width = layer_row.get("width_mm")
                    try:
                        layer_width = float(layer_width) if layer_width is not None else None
                        if layer_width is not None and layer_width <= 0:
                            layer_width = None
                    except Exception:
                        layer_width = None

                    effective_width = layer_width if layer_width is not None else req_width_mm
                    if effective_width is not None:
                        spec["min_width_mm"] = float(effective_width)
                        spec["max_auto_width_mm"] = float(effective_width) * 1.10

                if target_roll_specs:
                    target_roll_spec["min_width_mm"] = target_roll_specs[0].get("min_width_mm")
                    target_roll_spec["max_auto_width_mm"] = target_roll_specs[0].get("max_auto_width_mm")
            except Exception:
                pass

            # Human-friendly names for UI.
            try:
                with transaction.atomic():
                    from apps.materials.models import InventoryMaterial as Mat
                    for spec in target_roll_specs:
                        if spec.get("variant_id"):
                            v = Mat.objects.filter(id=spec["variant_id"]).select_related("parent_family").first()
                            if v:
                                spec["variant_name"] = v.name
                                if v.parent_family:
                                    spec["family_id"] = spec.get("family_id") or str(v.parent_family_id)
                                    spec["family_name"] = v.parent_family.name
                        elif spec.get("family_id"):
                            f = Mat.objects.filter(id=spec["family_id"]).first()
                            if f:
                                spec["family_name"] = f.name
            except Exception:
                pass

            try:
                with transaction.atomic():
                    from apps.recipes.models import RecipeGrade
                    for spec in target_roll_specs:
                        if spec.get("grade_id"):
                            g = RecipeGrade.objects.filter(id=spec["grade_id"]).first()
                            if g:
                                spec["grade_name"] = g.name
            except Exception:
                pass

            # Keep legacy single-spec field for existing UI consumers.
            if target_roll_specs:
                target_roll_spec = target_roll_specs[0]

        # Step-level roll physics is authoritative; ensure it is represented in target specs.
        step_roll_spec_hint = cls._resolve_step_roll_spec(job, process)
        step_target = {
            "variant_id": step_roll_spec_hint.get("output_variant_id"),
            "grade_id": step_roll_spec_hint.get("output_grade_id"),
            "thickness_micron": step_roll_spec_hint.get("fixed_thickness_micron"),
            "variant_name": step_roll_spec_hint.get("output_variant_name"),
            "variant_code": step_roll_spec_hint.get("output_variant_code"),
            "grade_name": step_roll_spec_hint.get("output_grade_name"),
        }
        if step_roll_spec_hint.get("width_rule") == "FIXED" and step_roll_spec_hint.get("fixed_width_mm") is not None:
            step_target["min_width_mm"] = step_roll_spec_hint.get("fixed_width_mm")
            step_target["max_auto_width_mm"] = float(step_roll_spec_hint.get("fixed_width_mm")) * 1.10
        _merge_target_spec(step_target, target_roll_specs)
        if target_roll_specs:
            target_roll_spec = target_roll_specs[0]
        
        # Ensure requirements are up-to-date (safe: update_or_create preserves consumed_qty).
        # This also self-heals jobs created before unit-conversion fixes.
        try:
            cls.calculate_requirements(job.id)
        except Exception:
            # Never block WCM UI due to requirement calculation issues.
            pass
            
        # 1. Requirements
        reqs = job.material_requirements.select_related('material', 'process_step').filter(
            process_step__sequence_number=job.current_step_index + 1
        )
        req_data = []
        for r in reqs:
            req_data.append({
                'material_id': str(r.material.id),
                'material_code': r.material.code,
                'material_name': r.material.name,
                'required_qty': float(r.required_qty),
                'assigned_qty': float(r.assigned_qty),
                'consumed_qty': float(r.consumed_qty),
                'status': 'Fulfilled' if r.assigned_qty >= r.required_qty else 'Pending'
            })
            
        # 2. Assigned Rolls (Reservations)
        reservations = job.reservations.filter(status='ACTIVE').select_related('roll', 'roll__location', 'material')
        active_reserved_rolls = [res.roll for res in reservations if getattr(res, "roll", None)]
        allocated_rolls = []
        for res in reservations:
            if res.roll:
                roll_meta = dict(getattr(res.roll, "meta_json", None) or {})
                roll_role = roll_role_resolver(res.roll) if roll_role_resolver else None
                if not roll_role:
                    roll_role = roll_meta.get("roll_role")
                allocated_rolls.append({
                    'id': str(res.roll.id),
                    'label_id': res.roll.label_id,
                    'variant_id': str(res.roll.material_id) if getattr(res.roll, "material_id", None) else None,
                    'material_code': res.material.code if res.material else 'N/A',
                    'material_name': res.material.name if res.material else 'N/A',
                    'quantity': float(res.quantity),
                    'reservation_id': str(res.id),
                    # UI-required fields
                    'status': res.roll.status,
                    'width_mm': float(res.roll.width_mm) if res.roll.width_mm else 0,
                    'thickness_micron': float(res.roll.thickness_micron) if res.roll.thickness_micron else 0,
                    'grade_name': res.roll.grade.name if getattr(res.roll, "grade", None) else None,
                    'weight_kg': float(res.roll.weight_kg),
                    'location_name': res.roll.location.name if res.roll.location else '-',
                    'roll_role': roll_role,
                    'is_remainder': bool(roll_meta.get("is_remainder")) or str(roll_role or "").upper() == "REMAINDER",
                    'target_lane_key': res.target_lane_key,
                    'target_lane_label': res.target_lane_label,
                    'target_layer_index': res.target_layer_index,
                    'target_variant_id': res.target_variant_id,
                    'target_grade_id': res.target_grade_id,
                    'target_thickness_micron': float(res.target_thickness_micron) if res.target_thickness_micron is not None else None,
                    'target_width_mm': float(res.target_width_mm) if res.target_width_mm is not None else None,
                    'target_lane_meta': res.target_lane_meta or {},
                    'stage_index': int(getattr(res.roll, "stage_index", 0) or 0),
                    'current_step_index': int(getattr(res.roll, "current_step_index", 0) or 0),
                    'completed_step_index': int(getattr(res.roll, "completed_step_index", 0) or 0),
                })

        # 3. Eligible Rolls (Suggestions)
        # Fetch rolls that MATCH the requirements and are AVAILABLE
        # Using existing service logic but expanding to new Context
        from apps.production.services.roll_allocation_service import RollAllocationService
        # Broad search for suggestions (Allocation Modal).
        # For Step 1, we must include Remainder rolls so they are visible in the "Allocate Rolls" list.
        eligible_qs = RollAllocationService.get_eligible_rolls(
            job, 
            include_non_lineage_fallback=cls._allow_non_lineage_roll_discovery(job, process),
            include_remainder=(int(getattr(job, "current_step_index", 0) or 0) == 0)
        )
        logger.debug("get_job_context job=%s target_roll_specs=%s", job_id, len(target_roll_specs))
        logger.debug("get_job_context job=%s eligible_roll_candidates=%s", job_id, eligible_qs.count())
        eligible_rolls = []
        # Enrich grade names (optional)
        grade_name_by_id = {}
        try:
            from apps.recipes.models import RecipeGrade
            spec_grade_ids = [s.get("grade_id") for s in (target_roll_specs or []) if s.get("grade_id")]
            if spec_grade_ids:
                grades = RecipeGrade.objects.filter(id__in=spec_grade_ids)
                grade_name_by_id = {str(g.id): g.name for g in grades}
        except Exception:
            pass

        # Step-1 manual allocation must still include all BOM-compatible variants,
        # even when strict grade/thickness data is incomplete in snapshots.
        required_variant_ids = {
            str(s.get("variant_id"))
            for s in (target_roll_specs or [])
            if s.get("variant_id")
        }
        required_family_ids = {
            str(s.get("family_id"))
            for s in (target_roll_specs or [])
            if s.get("family_id")
        }
        # Keep picker complete even when target_roll_specs is sparse by
        # backfilling from layer snapshot / resolved film lines.
        if isinstance(layer_snapshot, list):
            for layer in layer_snapshot:
                if not isinstance(layer, dict):
                    continue
                v_id = layer.get("variant_id") or layer.get("material_id")
                f_id = layer.get("family_id")
                if v_id:
                    required_variant_ids.add(str(v_id))
                if f_id:
                    required_family_ids.add(str(f_id))
        if 'bom_films' in locals() and isinstance(bom_films, list):
            for film in bom_films:
                if not isinstance(film, dict):
                    continue
                v_id = film.get("variant_id")
                f_id = film.get("family_id")
                if v_id:
                    required_variant_ids.add(str(v_id))
                if f_id:
                    required_family_ids.add(str(f_id))

        def _roll_matches_bom_family_or_variant(roll):
            if not required_variant_ids and not required_family_ids:
                return True
            roll_variant_id = str(getattr(roll, "material_id", "") or "")
            roll_family_id = str(
                getattr(getattr(roll, "material", None), "parent_family_id", "") or ""
            )
            if required_variant_ids and roll_variant_id in required_variant_ids:
                return True
            if required_family_ids and roll_family_id in required_family_ids:
                return True
            return False

        def _find_matching_spec(roll):
            specs = target_roll_specs or ([target_roll_spec] if target_roll_spec else [])
            if not specs:
                return None

            roll_variant_id = str(roll.material_id) if getattr(roll, "material_id", None) else None
            roll_family_id = str(roll.material.parent_family_id) if getattr(roll, "material", None) and getattr(roll.material, "parent_family_id", None) else None
            roll_grade_id = str(roll.grade_id) if getattr(roll, "grade_id", None) else None
            roll_thickness = getattr(roll, "thickness_micron", None)
            roll_width = getattr(roll, "width_mm", None)

            for spec in specs:
                # Material match (variant preferred, then family fallback)
                if spec.get("variant_id"):
                    if not roll_variant_id or str(spec["variant_id"]) != roll_variant_id:
                        continue
                elif spec.get("family_id"):
                    if not roll_family_id or str(spec["family_id"]) != roll_family_id:
                        continue

                # Thickness match when spec demands it.
                if spec.get("thickness_micron") is not None:
                    try:
                        if roll_thickness in (None, 0, Decimal('0')) or int(roll_thickness) != int(spec["thickness_micron"]):
                            continue
                    except Exception:
                        continue

                # Width guardrail REMOVED based on operator feedback (Phase 73).
                # Operators manually select width; system should not block/warn.
                pass

                # Grade match when required by spec.
                if spec.get("grade_id"):
                    if not roll_grade_id or str(spec["grade_id"]) != roll_grade_id:
                        continue

                return spec
            return None

        # Optimization: Limit to top 50 to prevent overload
        for roll in eligible_qs[:200]:
            logger.debug(
                "get_job_context job=%s processing_roll=%s material=%s grade=%s thickness=%s",
                job_id,
                roll.id,
                roll.material_id,
                roll.grade_id,
                roll.thickness_micron,
            )
            matched_spec = _find_matching_spec(roll)
            if target_roll_specs and matched_spec is None:
                if not _roll_matches_bom_family_or_variant(roll):
                    logger.debug(
                        "get_job_context job=%s roll=%s skipped_bom_mismatch target_specs=%s",
                        job_id,
                        roll.id,
                        len(target_roll_specs),
                    )
                    continue

            # User Request: Hardcore Step 1 Purity.
            # Suggestions in Step 1 modal should appear as Raw Material.
            is_step_1 = int(getattr(job, "current_step_index", 0) or 0) == 0
            
            raw_role = None
            if roll_role_resolver:
                try:
                    raw_role = roll_role_resolver(roll)
                except Exception:
                    raw_role = None
            if not raw_role:
                raw_role = str(((getattr(roll, "meta_json", None) or {}).get("roll_role") or "")).upper()
            
            role_to_show = raw_role
            if is_step_1 and raw_role == "REMAINDER":
                role_to_show = None # Mask label for Step 1 purity
            
            target_th = (matched_spec or target_roll_spec or {}).get("thickness_micron")
            target_grade = (matched_spec or target_roll_spec or {}).get("grade_id")
            th_known = getattr(roll, "thickness_micron", None) not in (None, 0, Decimal('0'))
            grade_known = bool(getattr(roll, "grade_id", None))
            spec_exact = True
            if target_th is not None:
                try:
                    spec_exact = spec_exact and th_known and int(roll.thickness_micron) == int(target_th)
                except Exception:
                    spec_exact = False
            if target_grade:
                spec_exact = spec_exact and grade_known and str(roll.grade_id) == str(target_grade)
            spec_missing = (target_th is not None and not th_known) or (bool(target_grade) and not grade_known)
            
            eligible_rolls.append({
                'id': str(roll.id),
                'label_id': roll.label_id,
                'material_id': str(roll.material_id) if getattr(roll, "material_id", None) else None,
                'variant_id': str(roll.material_id) if getattr(roll, "material_id", None) else None,
                'material_code': roll.material.code if roll.material else 'N/A',
                'material_name': roll.material.name if roll.material else 'N/A',
                'family_id': str(roll.material.parent_family_id) if roll.material and roll.material.parent_family_id else None,
                'family_name': roll.material.parent_family.name if roll.material and roll.material.parent_family else None,
                'width_mm': float(roll.width_mm or 0),
                'stock_form': getattr(roll, 'stock_form', 'OPEN_WEB') or 'OPEN_WEB',
                'width_basis': getattr(roll, 'width_basis', '') or '',
                'thickness_micron': float(roll.thickness_micron or 0),
                'grade_id': str(roll.grade_id) if roll.grade_id else None,
                'grade_name': (roll.grade.name if getattr(roll, "grade", None) else grade_name_by_id.get(str(roll.grade_id))) if roll.grade_id else None,
                'weight_kg': float(roll.weight_kg),
                'location': roll.location.name,
                'location_name': roll.location.name,
                'location_type': roll.location.type,
                'stage_index': int(getattr(roll, "stage_index", 0) or 0),
                'current_step_index': int(getattr(roll, "current_step_index", 0) or 0),
                'completed_step_index': int(getattr(roll, "completed_step_index", 0) or 0),
                'spec_exact': spec_exact,
                'spec_missing': spec_missing,
                'matched_layer_index': matched_spec.get("layer_index") if matched_spec else None,
                'matched_variant_name': matched_spec.get("variant_name") if matched_spec else None,
                'roll_role': role_to_show,
                'stage': (
                    stage_name_resolver(roll)
                    if (stage_name_resolver and not (is_step_1 and raw_role == "REMAINDER"))
                    else (f"Stage {int(getattr(roll, 'stage_index', 0) or 0)}" if not (is_step_1 and raw_role == "REMAINDER") else "RAW MATERIAL")
                )
            })
            if len(eligible_rolls) >= 50:
                break
        
        logger.debug("get_job_context job=%s final_eligible_rolls=%s", job_id, len(eligible_rolls))

        # 4. BOM Snapshot (resolved first, fallback to persisted snapshot)
        if 'bom_snapshot' not in locals() or not isinstance(bom_snapshot, dict):
            bom_snapshot = {}
        if 'bom_res' not in locals():
            bom_snapshot = (job.sales_order_item.bom_snapshot if job.sales_order_item else None) or \
                           (getattr(job.template, 'bom_schema', None) if job.template else None) or {}
            
            bom_films = bom_snapshot.get('films', [])
            bom_granules = bom_snapshot.get('granules', [])
            bom_inks = bom_snapshot.get('inks', [])
            bom_chemicals = bom_snapshot.get('chemicals', [])
            bom_addons = bom_snapshot.get('addons', [])
            bom_pod = bom_snapshot.get('pod', [])
        else:
            bom_snapshot = {
                'films': bom_films or [],
                'granules': bom_granules or [],
                'inks': bom_inks or [],
                'chemicals': bom_chemicals or [],
                'addons': bom_addons or [],
                'pod': bom_pod or [],
            }

        # 5. Material Requirements (grouped by step)
        step_requirements = {}
        for r in job.material_requirements.select_related('material', 'process_step').order_by('process_step__sequence_number'):
            if not r.process_step:
                continue
            step_seq = r.process_step.sequence_number
            if step_seq not in step_requirements:
                step_requirements[step_seq] = {
                    'process_name': r.process_step.process.name if r.process_step.process else "Unknown",
                    'materials': []
                }
            step_requirements[step_seq]['materials'].append({
                'material_id': str(r.material.id),
                'material_code': r.material.code,
                'material_name': r.material.name,
                'required_qty': float(r.required_qty),
                'assigned_qty': float(r.assigned_qty),
                'consumed_qty': float(r.consumed_qty),
                'uom': r.uom,
                'status': 'Fulfilled' if r.assigned_qty >= r.required_qty else 'Pending'
            })
        
        # 6. Current Process
        current_process = job.current_process or job.process
        current_step_seq = job.current_step_index + 1
        current_step_roll_spec = cls._resolve_step_roll_spec(job, current_process)
        required_rolls = cls._required_roll_count(job, current_process, current_step_roll_spec)
        reserved_rolls = InventoryReservation.objects.filter(
            job=job, status='ACTIVE', roll__isnull=False
        ).count()
        missing_rolls = max(0, required_rolls - reserved_rolls)

        # 10. Refined BOM Layers (Grouped for UI)
        # Match granules/materials to the specific film layer they belong to.
        # BOM snapshot weights are per-unit (per PCS) — scale by order qty for display.
        #
        # The BOMResolverService may return weight_kg=0 for films (it resolves
        # IDs but often doesn't calculate film weights). Fall back to original
        # bom_snapshot which stores correct per-unit weights from order creation.
        ogsnap = (job.sales_order_item.bom_snapshot if job.sales_order_item else None) or \
                 (getattr(job.template, 'bom_schema', None) if job.template else None) or {}
        ogsnap_films = ogsnap.get('films', [])
        ogsnap_granules = ogsnap.get('granules', [])

        refined_bom_layers = []
        if layer_snapshot:
            # Calculate scaling factor: BOM weights are per-unit, multiply by total order qty
            order_qty_for_scaling = float(job.quantity or 0)
            job_uom = str(job.uom or 'KG').upper()
            
            # Phase 73: Use robust unit weight for display scaling (same as requirements)
            robust_unit_weight_g = cls._job_unit_weight_g(job)
            
            if job_uom == 'KG' and robust_unit_weight_g > 0:
                # If job is in KG, convert to PCS equivalent for BOM scaling
                order_qty_for_scaling = (float(job.quantity or 0) * 1000) / float(robust_unit_weight_g)

            def _find_film_weight(layer_dict):
                """Find per-unit weight_kg from bom_films (resolver) or ogsnap_films (snapshot fallback)."""
                for src in [bom_films, ogsnap_films]:
                    for f in src:
                        if f.get('variant_id') == layer_dict.get('variant_id') or f.get('code') == layer_dict.get('code'):
                            w = float(f.get('weight_kg', 0))
                            if w > 0:
                                return w
                # Dynamic calc fallback: area_m2 * thickness_micron * density_g_cm3
                area = _as_float(g_snap.get('area_m2', 0))
                th = _as_float(layer_dict.get('thickness_micron', 0))
                den = _as_float(layer_dict.get('density_g_cm3', 0))
                if area > 0 and th > 0 and den > 0:
                    return (area * th * den) / 1000  # grams -> kg
                return 0

            def _find_granule_weight(granule_dict):
                """Find per-unit weight_kg from bom_granules or ogsnap_granules."""
                for src in [bom_granules, ogsnap_granules]:
                    for g in src:
                        if g.get('granule_id') == granule_dict.get('granule_id') or g.get('code') == granule_dict.get('code'):
                            w = float(g.get('weight_kg', 0))
                            if w > 0:
                                return w
                return float(granule_dict.get('weight_kg', 0))

            def _to_layer_index(raw_value):
                try:
                    if raw_value in (None, ""):
                        return None
                    return int(raw_value)
                except Exception:
                    return None

            # Merge granules from resolver + original snapshot and dedupe so layer breakdown is stable.
            merged_granules = []
            seen_granule_keys = set()
            for src in [bom_granules, ogsnap_granules]:
                for g in (src or []):
                    key = (
                        str(g.get('granule_id') or g.get('material_id') or g.get('code') or g.get('name') or ''),
                        _to_layer_index(g.get('layer_index')),
                    )
                    if key in seen_granule_keys:
                        continue
                    seen_granule_keys.add(key)
                    merged_granules.append(dict(g))

            for idx, layer in enumerate(layer_snapshot):
                layer_name = layer.get('variant_name') or layer.get('family_name') or layer.get('code') or f"Layer {idx+1}"
                
                # Get per-unit weight and scale by order quantity
                per_unit_weight = _find_film_weight(layer)
                layer_weight = round(per_unit_weight * order_qty_for_scaling, 3)
                
                layer_data = {
                    "index": idx + 1, # 1-based for consistency with resolver
                    "name": layer_name,
                    "variant_name": layer.get('variant_name') or layer_name,
                    "code": layer.get('code'),
                    "thickness": layer.get('thickness_micron') if layer.get('thickness_micron') is not None else layer.get('thickness'),
                    "thickness_micron": layer.get('thickness_micron') if layer.get('thickness_micron') is not None else layer.get('thickness'),
                    "grade": layer.get('grade_name') or layer.get('grade'),
                    "grade_name": layer.get('grade_name') or layer.get('grade'),
                    "weight_kg": layer_weight,
                    "materials": []
                }
                
                # Filter granules that belong to this layer index
                # If layer_index is missing and there's only one layer, assume it belongs here
                granules_found = False
                for g in merged_granules:
                    g_idx = _to_layer_index(g.get('layer_index'))
                    if g_idx == (idx + 1) or (g_idx is None and len(layer_snapshot) == 1):
                        # Scale granule weight too, using fallback for actual per-unit weight
                        scaled_g = dict(g)
                        per_unit_g = _find_granule_weight(g)
                        scaled_g['weight_kg'] = round(per_unit_g * order_qty_for_scaling, 3)
                        if scaled_g.get('percentage') in (None, '') and layer_weight > 0:
                            scaled_g['percentage'] = round((float(scaled_g['weight_kg']) / float(layer_weight)) * 100, 2)
                        layer_data["materials"].append(scaled_g)
                        granules_found = True
                
                # If no granules (e.g. Purchased Film), add the film itself as a material requirement
                if not granules_found:
                    for src in [bom_films, ogsnap_films]:
                        found_fallback = False
                        for f in (src or []):
                            f_idx = _to_layer_index(f.get('layer_index'))
                            if f_idx == (idx + 1) or \
                               f.get('variant_id') == layer.get('variant_id') or \
                               f.get('code') == layer.get('code'):
                                 
                                per_unit = _find_film_weight(layer)
                                layer_data["materials"].append({
                                    "material_id": f.get('variant_id') or f.get('family_id'),
                                    "code": f.get('code'),
                                    "name": f.get('name') or layer_name,
                                    "weight_kg": round(per_unit * order_qty_for_scaling, 3),
                                    "percentage": 100
                                })
                                found_fallback = True
                                break
                        if found_fallback:
                            break
                
                refined_bom_layers.append(layer_data)

        # 11. Other Requirements (Inks, Chemicals, Addons from JobMaterialRequirement)
        # Use actual requirement records instead of BOM resolver data (which often has 0 weights).
        other_requirements = []
        all_other_requirements = []
        seen_current_other = set()
        for req in job.material_requirements.select_related('material', 'process_step').filter(
            process_step__sequence_number=current_step_seq
        ):
            cat = req.material.category if req.material else ''
            # Only include non-film materials (inks, solvents, adhesives, chemicals, addons)
            if cat in ('FILM', 'FILM_VARIANT', 'FILM_FAMILY', 'GRANULE'):
                continue
            try:
                req_weight = Decimal(str(req.required_qty or 0))
            except Exception:
                req_weight = Decimal("0")
            if req_weight <= 0:
                continue
            dedupe_key = (
                str(req.material_id or ''),
                str(req.material.code if req.material else ''),
                int(current_step_seq),
            )
            if dedupe_key in seen_current_other:
                continue
            seen_current_other.add(dedupe_key)
            other_requirements.append({
                'material_id': str(req.material_id),
                'code': req.material.code if req.material else '',
                'name': req.material.name if req.material else '',
                'category': cat,
                'weight_kg': float(req_weight),
                'uom': req.uom,
            })
        seen_all_other = set()
        for req in job.material_requirements.select_related('material', 'process_step').order_by('process_step__sequence_number'):
            cat = req.material.category if req.material else ''
            if cat in ('FILM', 'FILM_VARIANT', 'FILM_FAMILY', 'GRANULE'):
                continue
            step_seq = req.process_step.sequence_number if req.process_step else None
            if step_seq and step_seq > current_step_seq:
                # WCM context should not classify future-step materials as prior/consumed context.
                continue
            try:
                req_weight = Decimal(str(req.required_qty or 0))
            except Exception:
                req_weight = Decimal("0")
            if req_weight <= 0:
                continue
            dedupe_key = (
                str(req.material_id or ''),
                str(req.material.code if req.material else ''),
                int(step_seq or 0),
            )
            if dedupe_key in seen_all_other:
                continue
            seen_all_other.add(dedupe_key)
            all_other_requirements.append({
                'material_id': str(req.material_id),
                'code': req.material.code if req.material else '',
                'name': req.material.name if req.material else '',
                'category': cat,
                'weight_kg': float(req_weight),
                'uom': req.uom,
                'step_sequence': step_seq,
                'step_name': req.process_step.process.name if (req.process_step and req.process_step.process) else None,
            })
        # Include only explicitly step-scoped addon fallbacks.
        # Unscoped BOM addons are intentionally skipped to avoid forward-step leakage in WCM.
        for addon in bom_addons:
            addon_step_seq = addon.get('step_sequence') or addon.get('sequence_number') or addon.get('step')
            try:
                addon_step_seq = int(addon_step_seq) if addon_step_seq is not None else None
            except Exception:
                addon_step_seq = None
            if addon_step_seq is None:
                continue
            addon_code = addon.get('code', '')
            addon_weight = addon.get('weight_kg')
            try:
                addon_weight_decimal = Decimal(str(addon_weight if addon_weight is not None else 0))
            except Exception:
                addon_weight_decimal = Decimal("0")
            if addon_weight_decimal <= 0:
                continue
            if addon_step_seq == current_step_seq and not any(r.get('code') == addon_code for r in other_requirements):
                other_requirements.append(addon)
            if addon_step_seq <= current_step_seq and not any(r.get('code') == addon_code for r in all_other_requirements):
                all_other_requirements.append({
                    **addon,
                    'step_sequence': addon_step_seq,
                    'step_name': current_process.name if current_process else None,
                })

        # If we have granules that weren't matched (or multi-layer)
        unmatched_granules = []
        if len(layer_snapshot) != 1:
            unmatched_granules = bom_granules

        try:
            satisfaction_status = cls.get_satisfaction_status(job_id)
        except Exception:
            satisfaction_status = {}

        wip_details = cls._resolve_wip_pool_details(job)
        wip_rolls = wip_details.get("lineage_pool") or []
        discoverable_rolls = wip_details.get("discoverable_pool") or wip_details.get("pool") or []
        fallback_rolls = wip_details.get("fallback_pool") or []
        wip_pool_meta = wip_details.get("meta") or {}
        wip_recent_lineage = wip_details.get("recent_lineage") or []
        process_input_form = str((current_process.input_form if current_process else job.input_form) or "").upper()
        process_output_form = str((current_process.output_form if current_process else job.output_form) or "").upper()
        roll_to_bulk_output_policy = cls._roll_to_bulk_output_policy(
            job,
            process=current_process,
            step_roll_spec=current_step_roll_spec,
        )
        lineage_roll_id_set = {str(getattr(row, "id", "")) for row in wip_rolls if getattr(row, "id", None)}
        fallback_roll_id_set = {str(getattr(row, "id", "")) for row in fallback_rolls if getattr(row, "id", None)}
        for row in eligible_rolls:
            roll_id = str(row.get("id") or "")
            raw_role = str(row.get("roll_role") or "").upper()
            if roll_id in lineage_roll_id_set:
                row["roll_source"] = "LINEAGE"
            elif roll_id in fallback_roll_id_set:
                row["roll_source"] = (
                    "PURCHASED_FALLBACK"
                    if raw_role in {"RAW_MATERIAL", "RAW", "REMAINDER"} or int(row.get("stage_index") or 0) == 0
                    else "COMPATIBLE_FALLBACK"
                )
            else:
                row["roll_source"] = "COMPATIBLE_FALLBACK"
        roll_assignment_validation = cls._summarize_roll_assignment_validation(
            job,
            current_process,
            active_reserved_rolls,
            allow_input_stock_fallback=True,
        ) if process_input_form == "ROLL" else {
            "required_rolls": 0,
            "required_target_specs": [],
            "matched_target_slots": [],
            "unmatched_target_slots": [],
            "matched_roll_ids": [],
            "unmatched_roll_ids": [],
            "assigned_roll_count": 0,
            "slot_satisfied": True,
            "is_complete": True,
        }
        order_profile = cls._build_execution_profile(job)
        step_profile = cls._resolve_step_execution_profile(job)
        runtime_output_cap = cls._resolve_runtime_output_cap_kg(
            current_process or process,
            step_profile,
            input_rolls=active_reserved_rolls,
            scrap_qty=Decimal("0"),
        )
        max_output_cap_kg = runtime_output_cap.get("max_output_kg")
        input_cap_kg = runtime_output_cap.get("input_cap_kg")
        order_reference_target_kg = cls._resolve_order_reference_target_kg(job)
        if cls._is_v2(job):
            effective_order_reference_target_kg = max(
                Decimal(str(order_reference_target_kg or 0)),
                Decimal("0"),
            )
        else:
            effective_order_reference_target_kg = max(
                Decimal(str(order_reference_target_kg or 0)),
                Decimal(str(step_profile.get("step_target_total_kg") or 0)),
                Decimal("0"),
            )
        order_progress = dict(order_profile.get("progress") or {})
        order_weight_progress = dict(order_progress.get("weight_kg") or {})
        order_pcs_progress = dict(order_progress.get("pcs") or {})
        if effective_order_reference_target_kg > 0:
            produced_weight = Decimal(str(order_weight_progress.get("produced") or 0))
            remaining_weight = effective_order_reference_target_kg - produced_weight
            if remaining_weight < 0:
                remaining_weight = Decimal("0")
            order_weight_progress["target"] = float(effective_order_reference_target_kg)
            order_weight_progress["remaining"] = float(remaining_weight)

            unit_weight = Decimal(str(order_profile.get("unit_weight_g") or 0))
            if str(order_profile.get("secondary_unit") or "").upper() == "PCS" and unit_weight > 0:
                target_pcs = (effective_order_reference_target_kg * Decimal("1000")) / unit_weight
                produced_pcs = Decimal(str(order_pcs_progress.get("produced") or 0))
                remaining_pcs = target_pcs - produced_pcs
                if remaining_pcs < 0:
                    remaining_pcs = Decimal("0")
                order_pcs_progress["target"] = float(target_pcs)
                order_pcs_progress["remaining"] = float(remaining_pcs)
        order_progress["weight_kg"] = order_weight_progress
        order_progress["pcs"] = order_pcs_progress
        progress_weight = {
            "target": step_profile.get("step_target_total_kg"),
            "produced": step_profile.get("step_produced_kg"),
            "remaining": step_profile.get("step_remaining_kg"),
        }
        progress_pcs = {
            "target": step_profile.get("step_target_pcs"),
            "produced": step_profile.get("step_produced_pcs"),
            "remaining": step_profile.get("step_remaining_pcs"),
        }
        progress_primary = {
            "uom": step_profile.get("primary_uom") or "KG",
            "target": step_profile.get("step_target_primary"),
            "produced": step_profile.get("step_produced_primary"),
            "remaining": step_profile.get("step_remaining_primary"),
            "tolerance": step_profile.get("tolerance_primary"),
        }
        execution_profile = {
            "primary_unit": step_profile.get("primary_uom") or order_profile.get("primary_unit") or "KG",
            "secondary_unit": step_profile.get("secondary_uom") or order_profile.get("secondary_unit"),
            "job_uom": order_profile.get("job_uom"),
            "unit_weight_g": order_profile.get("unit_weight_g"),
            "derivation_available": order_profile.get("derivation_available"),
            # Flattened target fields are retained for consumers that don't
            # traverse `progress.weight_kg` / `progress.pcs`.
            "step_target_total_kg": step_profile.get("step_target_total_kg"),
            "step_produced_kg": step_profile.get("step_produced_kg"),
            "step_remaining_kg": step_profile.get("step_remaining_kg"),
            "step_target_pcs": step_profile.get("step_target_pcs"),
            "step_produced_pcs": step_profile.get("step_produced_pcs"),
            "step_remaining_pcs": step_profile.get("step_remaining_pcs"),
            "step_target_primary": step_profile.get("step_target_primary"),
            "step_produced_primary": step_profile.get("step_produced_primary"),
            "step_remaining_primary": step_profile.get("step_remaining_primary"),
            "tolerance_primary": step_profile.get("tolerance_primary"),
            "route_target_total_kg": float(effective_order_reference_target_kg),
            "route_produced_kg": order_weight_progress.get("produced"),
            "route_remaining_kg": order_weight_progress.get("remaining"),
            "step_target_source": step_profile.get("target_source"),
            "order_target_source": "V2_ORDER_REFERENCE",
            "max_output_kg": float(max_output_cap_kg) if max_output_cap_kg is not None else None,
            "output_cap_source": runtime_output_cap.get("cap_source"),
            "progress": {
                "weight_kg": progress_weight,
                "pcs": progress_pcs,
                "primary": progress_primary,
            },
        }

        consumed_total = (
            MaterialConsumptionLog.objects.filter(production_job=job).aggregate(total=Sum("quantity")).get("total")
            or Decimal("0")
        )
        scrap_total = (
            ScrapLog.objects.filter(production_job=job).aggregate(total=Sum("quantity")).get("total")
            or Decimal("0")
        )
        rolls_created_qs = InventoryRoll.objects.filter(
            created_by_job=job,
            current_step_index=job.current_step_index + 1,
        )
        rolls_created_count = rolls_created_qs.count()
        rolls_created_kg = (
            rolls_created_qs.aggregate(total=Sum("weight_kg")).get("total")
            or Decimal("0")
        )
        roll_links_qs = RollLink.objects.filter(child_roll__created_by_job=job)
        rolls_consumed_kg = (
            roll_links_qs.aggregate(total=Sum("qty_used_kg")).get("total")
            or Decimal("0")
        )
        rolls_consumed_count = len(set(roll_links_qs.values_list("parent_roll_id", flat=True)))

        latest_execution_logs = list(
            JobExecutionLog.objects.filter(production_job=job).order_by("-logged_at")[:5]
        )
        latest_scrap_logs = list(
            ScrapLog.objects.filter(production_job=job).order_by("-logged_at")[:5]
        )
        live_events = []
        for evt in latest_execution_logs:
            live_events.append({
                "type": "OUTPUT",
                "timestamp": evt.logged_at.isoformat() if evt.logged_at else None,
                "quantity_kg": float(evt.quantity or 0),
                "uom": evt.uom,
            })
        for evt in latest_scrap_logs:
            live_events.append({
                "type": "SCRAP",
                "timestamp": evt.logged_at.isoformat() if evt.logged_at else None,
                "quantity_kg": float(evt.quantity or 0),
                "reason": evt.reason,
            })
        for evt in rolls_created_qs.order_by("-created_at")[:5]:
            live_events.append({
                "type": "ROLL_CREATED",
                "timestamp": evt.created_at.isoformat() if evt.created_at else None,
                "quantity_kg": float(evt.weight_kg or 0),
                "roll_label": evt.label_id,
            })
        live_events.sort(key=lambda item: item.get("timestamp") or "", reverse=True)
        live_events = live_events[:10]

        step_roll_behavior = (current_process.roll_behavior if current_process else 'NONE') or 'NONE'
        roll_spec_payload = {
            "output_variant": current_step_roll_spec.get("output_variant_name"),
            "output_variant_id": current_step_roll_spec.get("output_variant_id"),
            "thickness_rule": current_step_roll_spec.get("thickness_rule"),
            "width_rule": current_step_roll_spec.get("width_rule"),
            "operator_entry_mode": current_step_roll_spec.get("operator_entry_mode"),
            "behavior": step_roll_behavior,
            "output_capture_policy": roll_to_bulk_output_policy,
        }
        job_geometry = cls._job_geometry_snapshot(job) or {}
        base_geo = job_geometry.get("base") if isinstance(job_geometry, dict) else {}
        if not isinstance(base_geo, dict):
            base_geo = job_geometry if isinstance(job_geometry, dict) else {}
        explicit_effective_geo = {}
        if isinstance(job_geometry, dict):
            explicit_effective_geo = job_geometry.get("effective") or job_geometry.get("effective_geometry") or {}
        if not isinstance(explicit_effective_geo, dict):
            explicit_effective_geo = {}
        has_explicit_effective = bool(explicit_effective_geo)
        effective_geo = dict(explicit_effective_geo)

        def _geo_number(payload, keys):
            for key in keys:
                value = payload.get(key) if isinstance(payload, dict) else None
                if value in (None, ""):
                    continue
                try:
                    return float(value)
                except Exception:
                    continue
            return None

        adjustments = []
        if isinstance(job_geometry, dict) and isinstance(job_geometry.get("adjustments"), list):
            for row in job_geometry.get("adjustments")[:5]:
                if not isinstance(row, dict):
                    continue
                adj_name = row.get("name") or row.get("type") or row.get("impact") or "Adjustment"
                adj_on = row.get("on") or row.get("impact")
                adj_value = row.get("value")
                adj_unit = row.get("unit")
                if adj_unit in (None, "") and adj_on:
                    adj_unit = "mm"
                adjustments.append({
                    "name": adj_name,
                    "value": adj_value,
                    "unit": adj_unit,
                    "on": adj_on,
                })

        base_width = _geo_number(base_geo, ["width_mm", "width", "w_mm", "w"])
        base_height = _geo_number(base_geo, ["height_mm", "height", "h_mm", "h"])
        base_area = _geo_number(base_geo, ["area_m2", "area"])
        if (base_area is None or base_area <= 0) and base_width and base_height:
            base_area = (base_width * base_height) / 1_000_000.0

        effective_width = _geo_number(effective_geo, ["width_mm", "width", "w_mm", "w"])
        effective_height = _geo_number(effective_geo, ["height_mm", "height", "h_mm", "h"])
        effective_area = _geo_number(effective_geo, ["area_m2", "area"])

        if effective_width in (None, 0):
            effective_width = base_width
        if effective_height in (None, 0):
            effective_height = base_height

        # For templates that only store Base + Adjustments, derive Effective from those adjustments.
        if not has_explicit_effective and adjustments:
            for row in adjustments:
                try:
                    adj_value = float(row.get("value") or 0)
                except Exception:
                    adj_value = 0.0
                if adj_value == 0:
                    continue
                on_value = str(row.get("on") or row.get("name") or "").upper()
                if "HEIGHT" in on_value:
                    effective_height = (effective_height or 0.0) + adj_value
                elif "WIDTH" in on_value:
                    effective_width = (effective_width or 0.0) + adj_value
                elif "BOTH" in on_value:
                    effective_width = (effective_width or 0.0) + adj_value
                    effective_height = (effective_height or 0.0) + adj_value

        if (effective_area is None or effective_area <= 0) and effective_width and effective_height:
            effective_area = (effective_width * effective_height) / 1_000_000.0

        # Ensure geometry snapshot is always coherent in terminal.
        effective_geo = {
            **effective_geo,
            "width_mm": effective_width if effective_width is not None else base_width,
            "height_mm": effective_height if effective_height is not None else base_height,
            "area_m2": effective_area if effective_area is not None else base_area,
        }
        base_geo = {
            **base_geo,
            "width_mm": base_width,
            "height_mm": base_height,
            "area_m2": base_area,
        }

        pod_summary = {}
        if isinstance(job_geometry, dict):
            pod_summary = job_geometry.get("pod") or job_geometry.get("pod_summary") or {}
        if not isinstance(pod_summary, dict):
            pod_summary = {}

        last_transition = live_events[0] if live_events else None
        input_ready = bool(satisfaction_status.get("is_satisfied"))
        roll_shortage_count = int(satisfaction_status.get("rolls_missing") or 0)
        next_action_hint = "Ready to execute."
        if not input_ready:
            if wip_pool_meta.get("required_for_step") and roll_shortage_count > 0:
                next_action_hint = "Roll shortage: assign/release/transfer compatible roll inputs."
            else:
                next_action_hint = "Resolve pending requirements before execution."
        elif str(getattr(job, "job_state", "")).upper() in ("RELEASED", "PAUSED"):
            next_action_hint = "Start machine step to continue execution."

        show_pcs_secondary = bool(
            (str((current_process.output_form if current_process else job.output_form) or "").upper() == "BULK")
            and bool(order_profile.get("derivation_available"))
        )
        is_v2 = cls._is_v2(job)
        roll_behavior_upper = str(step_roll_behavior or "").upper()
        allocation_required_step0 = bool(
            is_v2
            and int(getattr(job, "current_step_index", 0) or 0) == 0
            and process_input_form == "ROLL"
            and roll_behavior_upper in {"MODIFY_EXISTING", "SPLIT"}
        )
        step_target_source_label = step_profile.get("target_source_label") or cls._target_source_label(step_profile.get("target_source"))

        def _serialize_context_roll(roll, source=None):
            raw_role = (
                roll_role_resolver(roll)
                if roll_role_resolver
                else (str(((getattr(roll, "meta_json", None) or {}).get("roll_role") or "")).upper() or None)
            )
            source_value = source
            if not source_value:
                if str(getattr(roll, "id", "")) in lineage_roll_id_set:
                    source_value = "LINEAGE"
                elif str(getattr(roll, "id", "")) in fallback_roll_id_set:
                    source_value = (
                        "PURCHASED_FALLBACK"
                        if str(raw_role or "").upper() in {"RAW_MATERIAL", "RAW", "REMAINDER"}
                        or int(getattr(roll, "stage_index", 0) or 0) == 0
                        else "COMPATIBLE_FALLBACK"
                    )
            return {
                'id': str(roll.id),
                'label_id': roll.label_id,
                'display_label': roll_display_label_resolver(roll) if roll_display_label_resolver else roll.label_id,
                'material_id': str(roll.material_id) if getattr(roll, 'material_id', None) else None,
                'variant_id': str(roll.material_id) if getattr(roll, 'material_id', None) else None,
                'material_name': roll.material.name if roll.material else None,
                'width_mm': float(roll.width_mm or 0),
                'thickness_micron': float(roll.thickness_micron or 0),
                'weight_kg': float(roll.weight_kg),
                'grade': roll.grade.name if getattr(roll, 'grade', None) else None,
                'location_name': roll.location.name if getattr(roll, 'location', None) else None,
                'status': roll.status,
                'roll_role': raw_role,
                'roll_source': source_value,
                'source_behavior': (getattr(roll, "meta_json", None) or {}).get("source_behavior"),
                'created_process_name': roll.created_process.name if getattr(roll, "created_process", None) else None,
                'stage': (
                    stage_name_resolver(roll)
                    if stage_name_resolver
                    else (f"Stage {int(getattr(roll, 'stage_index', 0) or 0)}")
                ),
                'stage_index': int(getattr(roll, "stage_index", 0) or 0),
                'current_step_index': int(getattr(roll, "current_step_index", 0) or 0),
                'completed_step_index': int(getattr(roll, "completed_step_index", 0) or 0),
            }

        continuation_banner = cls._build_continuation_banner(job)

        return {
            'display': {
                'template_name': job.template.name if job.template else "Custom",
                'product_name': job.template.name if job.template else job.product_name,
                'step_name': current_process.name if current_process else "Unknown",
                'step_code': current_process.code if current_process else "N/A",
                'roll_behavior': step_roll_behavior,
                'show_pcs_secondary': show_pcs_secondary,
            },
            'job': {
                'id': str(job.id),
                'job_number': job.job_number,
                'customer_name': job.sales_order_item.sales_order.customer_name if job.sales_order_item else (job.customer_name or "Stock"),
                'order_number': job.sales_order_item.sales_order.order_number if job.sales_order_item else "N/A",
                'template_name': job.template.name if job.template else "Custom",
                'product_name': job.product_name,
                'quantity': float(job.quantity),
                'produced_qty': float(job.produced_qty or 0),
                'remaining_qty': float(job.remaining_qty or 0),
                'target_weight_kg': step_profile.get("step_target_total_kg"),
                'order_target_weight_kg': float(effective_order_reference_target_kg),
                'estimated_pcs': step_profile.get("step_target_pcs"),
                'uom': job.uom,
                'current_step_index': job.current_step_index,
                'status': job.status,
                'job_state': job.job_state,
                'closed_with_variance': bool(getattr(job, "closed_with_variance", False)),
                'completion_variance_kg': float(getattr(job, "completion_variance_kg", 0) or 0),
                'completion_force_reason': getattr(job, "completion_force_reason", None),
                'roll_behavior': process.roll_behavior if process else 'NONE',
                'input_form': process.input_form if process else job.input_form,
                'output_form': process.output_form if process else job.output_form,
                'geometry': job_geometry,
                'from_location_id': str(job.from_location_id) if job.from_location_id else None,
                'from_location_name': job.from_location.name if job.from_location else None,
                'to_location_id': str(job.to_location_id) if job.to_location_id else None,
                'to_location_name': job.to_location.name if job.to_location else None,
                'execution_model_version': cls._execution_model_version(job),
            },
            'current_step': {
                'sequence': current_step_seq,
                'process_name': current_process.name if current_process else "Unknown",
                'process_code': current_process.code if current_process else "N/A",
                'input_form': current_process.input_form if current_process else "ROLL",
                'output_form': current_process.output_form if current_process else job.output_form,
            },
            'target_roll_invariants': target_roll_spec,
            'target_roll_invariant_list': target_roll_specs,
            'roll_handling': roll_spec_payload,
            'bom_snapshot': bom_snapshot,
            'bom_layers': refined_bom_layers,
            'other_requirements': other_requirements,
            'all_other_requirements': all_other_requirements,
            'allocated_rolls': allocated_rolls,
            'reservations': [
                {
                    'id': row.get('reservation_id') or row.get('id'),
                    'roll_id': row.get('id'),
                    'roll_label': row.get('label_id'),
                    'material_name': row.get('material_name'),
                    'qty_reserved': row.get('weight_kg') or row.get('quantity') or 0,
                }
                for row in allocated_rolls
            ],
            'eligible_rolls': eligible_rolls,
            'roll_assignment_validation': roll_assignment_validation,
            'input_form': job.input_form,
            'output_form': job.output_form,
            'satisfaction': satisfaction_status,
            'current_step_material_confirmations': getattr(job, 'current_step_material_confirmations', None) or [],
            'execution_profile': execution_profile,
            'execution_model_version': cls._execution_model_version(job),
            'step_target_source': step_profile.get("target_source"),
            'step_target_source_label': step_target_source_label,
            'step_target_source_detail': step_profile.get("target_source_detail") or step_target_source_label,
            'order_target_source': "V2_ORDER_REFERENCE",
            'step_execution': {
                'primary_uom': step_profile.get("primary_uom"),
                'secondary_uom': step_profile.get("secondary_uom"),
                'roll_target_kg': step_profile.get("step_roll_target_kg"),
                'bulk_target_kg': step_profile.get("step_bulk_target_kg"),
                'total_target_kg': step_profile.get("step_target_total_kg"),
                'produced_kg': step_profile.get("step_produced_kg"),
                'remaining_kg': step_profile.get("step_remaining_kg"),
                'max_output_kg': float(max_output_cap_kg) if max_output_cap_kg is not None else None,
                'input_cap_kg': float(input_cap_kg) if input_cap_kg is not None else None,
                'cap_source': runtime_output_cap.get("cap_source"),
                'target_pcs': step_profile.get("step_target_pcs"),
                'produced_pcs': step_profile.get("step_produced_pcs"),
                'remaining_pcs': step_profile.get("step_remaining_pcs"),
                'target_primary': step_profile.get("step_target_primary"),
                'produced_primary': step_profile.get("step_produced_primary"),
                'remaining_primary': step_profile.get("step_remaining_primary"),
                'tolerance_kg': step_profile.get("tolerance_kg"),
                'tolerance_primary': step_profile.get("tolerance_primary"),
                'derivation_fallback': step_profile.get("derivation_fallback"),
                'target_source': step_profile.get("target_source"),
                'target_source_label': step_target_source_label,
                'target_source_detail': step_profile.get("target_source_detail") or step_target_source_label,
                'closed_with_variance': bool(getattr(job, "closed_with_variance", False)),
            },
            'step_policy': {
                'execution_model_version': cls._execution_model_version(job),
                'allocation_required': allocation_required_step0,
                'allocation_mode': "EXACT_ONE_RESERVED_ROLL" if allocation_required_step0 else "STANDARD",
                'allocation_scope': "STAGE0_PURCHASABLE_ONLY" if allocation_required_step0 else "PROCESS_STANDARD",
                'roll_to_bulk_validation_mode': (
                    (
                        "KG_ONLY_WITH_GEOMETRY_CHECK"
                        if roll_to_bulk_output_policy.get("effective_mode") == "KG_ONLY"
                        else "KG_AND_PCS_REQUIRED_WITH_GEOMETRY_CHECK"
                    )
                    if (is_v2 and process_input_form == "ROLL" and process_output_form == "BULK")
                    else "NOT_APPLICABLE"
                ),
                'output_capture_policy': roll_to_bulk_output_policy,
                'step_target_source': step_profile.get("target_source"),
                'step_target_source_label': step_target_source_label,
                'step_target_source_detail': step_profile.get("target_source_detail") or step_target_source_label,
                'order_target_source': "V2_ORDER_REFERENCE",
                'tolerance_kg': step_profile.get("tolerance_kg"),
            },
            'progress': {
                'weight_kg': progress_weight,
                'pcs': progress_pcs,
                'primary': progress_primary,
            },
            'order_progress': order_progress,
            'inputs': {
                'rolls_required': int(satisfaction_status.get('rolls_required') or 0),
                'rolls_reserved': int(satisfaction_status.get('rolls_reserved') or 0),
                'bulk_preview': satisfaction_status.get('bulk_consumption') or [],
                'bulk_preview_theoretical': satisfaction_status.get('bulk_consumption') or [],
                'reserved_rolls': [
                    {
                        'id': row.get('id'),
                        'label_id': row.get('label_id'),
                        'weight_kg': row.get('weight_kg'),
                        'width_mm': row.get('width_mm'),
                        'thickness_micron': row.get('thickness_micron'),
                        'variant': row.get('material_name'),
                        'variant_id': row.get('variant_id'),
                        'grade': row.get('grade_name'),
                        'grade_id': row.get('grade_id'),
                        'location_name': row.get('location_name'),
                    }
                    for row in allocated_rolls
                ],
            },
            'geometry_cards': {
                'base_geometry': base_geo,
                'effective_geometry': effective_geo,
                'adjustments_summary': adjustments,
                'pod_summary': pod_summary,
            },
            'live_consumption': {
                'total_consumed_kg': float(consumed_total),
                'total_scrap_kg': float(scrap_total),
                'last_events': live_events,
            },
            'telemetry': {
                'execution_health': {
                    'input_ready': input_ready,
                    'roll_shortage_count': roll_shortage_count,
                    'primary_uom': step_profile.get("primary_uom"),
                    'step_target_primary': step_profile.get("step_target_primary"),
                    'step_produced_primary': step_profile.get("step_produced_primary"),
                    'step_remaining_primary': step_profile.get("step_remaining_primary"),
                    'step_target_kg': step_profile.get("step_target_total_kg"),
                    'step_produced_kg': step_profile.get("step_produced_kg"),
                    'step_remaining_kg': step_profile.get("step_remaining_kg"),
                    'next_action_hint': next_action_hint,
                    'last_transition': last_transition,
                },
                'inventory_counters': {
                    'bulk_consumed_kg': float(consumed_total),
                    'rolls_consumed_kg': float(rolls_consumed_kg),
                    'rolls_consumed_count': int(rolls_consumed_count),
                    'rolls_created_kg': float(rolls_created_kg),
                    'rolls_created_count': int(rolls_created_count),
                    'scrap_kg': float(scrap_total),
                    'live_logs': live_events,
                },
                # Legacy fields kept for backward compatibility.
                'bulk_consumed_kg': float(consumed_total),
                'rolls_consumed_kg': float(rolls_consumed_kg),
                'rolls_consumed_count': int(rolls_consumed_count),
                'rolls_created_kg': float(rolls_created_kg),
                'rolls_created_count': int(rolls_created_count),
                'scrap_kg': float(scrap_total),
                'live_logs': live_events,
            },
            
            # Phase 67: New Context Fields
            # User Request: Hardcore Sidebar Purity.
            # Sidebar Widget ('wip_pool') only shows True Lineage WIP (outputs of previous steps).
            # Allocation Modal ('eligible_rolls') shows everything including broad discovery.
            'wip_pool': [
                _serialize_context_roll(r, "LINEAGE")
                for r in wip_details.get('lineage_pool', [])
            ],
            'discoverable_pool': [_serialize_context_roll(r) for r in discoverable_rolls],
            'fallback_pool': [_serialize_context_roll(r) for r in fallback_rolls],
            'wip_pool_meta': wip_pool_meta,
            'wip_recent_lineage': wip_recent_lineage,
            'missing_layers': cls.calculate_missing_layers(job, wip_rolls),
            'current_step_roll_handling': current_step_roll_spec,
            'auto_assignment_result': {
                'required_rolls': required_rolls,
                'reserved_rolls': reserved_rolls,
                'missing_rolls': missing_rolls,
                'auto_first': True,
            },
            'override_required': bool((current_process and current_process.input_form == 'ROLL') and missing_rolls > 0),
            'override_reason_required': True,
            'process_config': {
                'code': (job.current_process or job.process).code if (job.current_process or job.process) else '',
                'roll_behavior': (job.current_process or job.process).roll_behavior if (job.current_process or job.process) else 'NONE',
                'input_form': (job.current_process or job.process).input_form if (job.current_process or job.process) else 'BULK'
            },
            'execution_model_version': cls._execution_model_version(job),
            'continuation_banner': continuation_banner,
        }

    @classmethod
    def assign_roll_to_job(cls, job_id, roll_id, user=None, override_reason=None, manual_override=False):
        """
        Strict Reservation Logic.
        """
        job = ProductionJob.objects.get(id=job_id)
        process = job.current_process or job.process
        roll = InventoryRoll.objects.get(id=roll_id)

        if roll.status != 'AVAILABLE':
            if roll.status == 'RESERVED':
                cls._unlock_roll_if_stale_reserved(roll, job=job)
                roll.refresh_from_db(fields=["status"])
        if roll.status != 'AVAILABLE':
            raise ValueError(f"Roll {roll.label_id} is not AVAILABLE (Status: {roll.status})")

        step_roll_spec = cls._resolve_step_roll_spec(job, process)
        required_rolls = cls._required_roll_count(job, process, step_roll_spec)
        lane_group_mode = cls._is_lane_group_combine_spec(step_roll_spec)
        is_roll_to_bulk = (
            str(getattr(process, "input_form", "") or "").upper() == "ROLL"
            and str(getattr(process, "output_form", "") or "").upper() == "BULK"
        )
        active_qs = InventoryReservation.objects.filter(job=job, status='ACTIVE', roll__isnull=False)
        active_count = active_qs.count()
        active_rolls = list(
            InventoryRoll.objects.filter(
                id__in=active_qs.values_list("roll_id", flat=True)
            ).select_related("material", "material__parent_family", "grade", "location")
        ) if active_count else []
        if required_rolls == 0 and not is_roll_to_bulk:
            raise ValueError("This process does not accept roll assignments.")
        if active_qs.filter(roll=roll).exists():
            raise ValueError(f"Roll {roll.label_id} is already reserved for this job.")
        if (not is_roll_to_bulk) and (not lane_group_mode) and active_count >= required_rolls:
            raise ValueError(f"Roll assignment already satisfied ({required_rolls} required). Unassign to change selection.")

        if cls._is_v2(job):
            roll_behavior = str(getattr(process, "roll_behavior", "") or "").upper()
            if int(getattr(job, "current_step_index", 0) or 0) == 0 and roll_behavior in {"MODIFY_EXISTING", "SPLIT"}:
                if int(getattr(roll, "stage_index", 0) or 0) != 0:
                    raise ValueError("Step 1 requires raw/purchasable rolls only (stage 0).")
                purchasable_variant_ids = cls._step0_purchasable_variant_ids(job)
                if purchasable_variant_ids and str(getattr(roll, "material_id", "") or "") not in purchasable_variant_ids:
                    raise ValueError("Step 1 requires allocation from purchasable BOM layers.")

        # Auto path should only accept physically eligible rolls.
        is_eligible = False
        eligible_lookup_failed = False
        try:
            from apps.production.services.roll_allocation_service import RollAllocationService
            eligible_ids = set(
                str(rid)
                for rid in RollAllocationService.get_eligible_rolls(
                    job, 
                    include_non_lineage_fallback=cls._allow_non_lineage_roll_discovery(job, process),
                    include_remainder=True
                ).values_list("id", flat=True)
            )
            is_eligible = str(roll.id) in eligible_ids
        except Exception:
            eligible_lookup_failed = True

        # If strict eligibility lookup is inconclusive, fall back to context target specs.
        if eligible_lookup_failed and not is_eligible:
            try:
                target_specs = cls.get_job_context(job_id).get("target_roll_invariant_list") or []
                is_eligible = cls._roll_matches_target_specs(
                    roll,
                    target_specs,
                    enforce_auto_width_window=not manual_override,
                )
            except Exception:
                is_eligible = False

        auto_window_ok = True
        roll_behavior = str(getattr(process, "roll_behavior", "") or "").upper()
        enforce_auto_window = (
            not manual_override
            and roll_behavior != "MULTI_INPUT_COMBINE"
            and not is_roll_to_bulk
        )
        if enforce_auto_window:
            try:
                strict_specs = cls._build_step_target_specs(job, process)
                if strict_specs:
                    auto_window_ok = cls._roll_matches_target_specs(
                        roll,
                        strict_specs,
                        enforce_auto_width_window=True,
                    )
            except Exception:
                auto_window_ok = True

        if not is_eligible and not manual_override:
            raise ValueError(
                "Selected roll does not satisfy current-step roll physics. Enable manual override and provide reason."
            )
        if not auto_window_ok and not manual_override:
            raise ValueError(
                "Selected roll width is outside the auto-allocation window (+10%). "
                "Use manual override with reason to allocate a larger roll."
            )
        if manual_override and not (override_reason or "").strip():
            raise ValueError("Override reason is required when manually overriding roll assignment.")

        assignment_validation = cls._summarize_roll_assignment_validation(
            job,
            process,
            active_rolls + [roll],
            allow_input_stock_fallback=True,
        )
        if not assignment_validation.get("slot_satisfied"):
            raise ValueError(
                "Selected rolls do not satisfy distinct target slots for this step. "
                "Assign rolls that cover the required layer/spec set."
            )

        selected_lane_slot = None
        if lane_group_mode:
            for slot in cls._build_step_target_slots(job, process):
                if cls._is_roll_step_compatible(
                    job,
                    process,
                    roll,
                    [slot],
                    allow_input_stock_fallback=True,
                ) and cls._roll_matches_target_specs(roll, [slot]):
                    selected_lane_slot = slot
                    break

        def _decimal_or_none(value):
            if value in (None, ""):
                return None
            try:
                return Decimal(str(value))
            except Exception:
                return None

        with transaction.atomic():
            # 1. Create Reservation
            InventoryReservation.objects.create(
                job=job,
                roll=roll,
                material=roll.material,
                quantity=roll.weight_kg,
                status='ACTIVE',
                created_by=user,
                override_reason=(override_reason or "").strip() or None,
                override_by=user if manual_override else None,
                target_lane_key=(selected_lane_slot or {}).get("lane_key"),
                target_lane_label=(selected_lane_slot or {}).get("lane_label") or "",
                target_layer_index=(selected_lane_slot or {}).get("layer_index") or None,
                target_variant_id=str((selected_lane_slot or {}).get("variant_id") or ""),
                target_grade_id=str((selected_lane_slot or {}).get("grade_id") or ""),
                target_thickness_micron=_decimal_or_none((selected_lane_slot or {}).get("thickness_micron")),
                target_width_mm=_decimal_or_none((selected_lane_slot or {}).get("min_width_mm")),
                target_source_step_index=(selected_lane_slot or {}).get("source_step_index"),
                target_lane_meta=selected_lane_slot or {},
            )
            
            # 2. Update Roll Status
            roll.status = 'RESERVED'
            roll.save()
            
            # 3. Update Requirement Tracking
            # Find the requirement for this material
            # Note: Rolls might have a specific variant, but requirement might be family or variant.
            # Logic: Exact Match first.
            req = job.material_requirements.filter(material=roll.material).first()
            if req:
                req.assigned_qty += roll.weight_kg
                req.save()
            
        return cls.get_job_context(job_id)

    @classmethod
    def unassign_roll(cls, job_id, reservation_id):
        with transaction.atomic():
            res = InventoryReservation.objects.get(id=reservation_id, job_id=job_id)
            roll = res.roll
            qty = res.quantity
            material = res.material
            
            # Revert Roll
            if roll:
                roll.status = 'AVAILABLE'
                roll.save()
            
            # Revert Requirement
            req = JobMaterialRequirement.objects.filter(production_job_id=job_id, material=material).first()
            if req:
                req.assigned_qty = max(Decimal("0"), (req.assigned_qty or Decimal("0")) - (qty or Decimal("0")))
                req.save()
                
            res.delete()

            assignment = WorkCenterAssignment.objects.filter(production_job_id=job_id).first()
            if assignment:
                remaining_roll_ids = InventoryReservation.objects.filter(
                    job_id=job_id,
                    status='ACTIVE',
                    roll__isnull=False,
                ).values_list('roll_id', flat=True)
                assignment.allocated_rolls.set(InventoryRoll.objects.filter(id__in=remaining_roll_ids))
            
        # Important: do not reconcile assignment->reservation links here.
        # Reconciliation during unassign can recreate a just-removed reservation
        # from stale legacy M2M links.
        return cls.get_job_context(job_id, reconcile_assignment=False)

    # =========================================================================
    # Phase 68: Universal Flow Engine Methods
    # =========================================================================
    
    @classmethod
    def get_wip_pool_grouped(cls, job_id):
        """
        Phase 68: Returns WIP pool grouped by material family.
        Used by UI to show available inputs organized logically.
        """
        pool = cls.get_wip_pool(job_id)
        grouped = {}
        try:
            from apps.inventory.serializers import (
                resolve_roll_display_label,
                resolve_roll_role,
                resolve_roll_stage_name,
            )
        except Exception:
            resolve_roll_display_label = None
            resolve_roll_role = None
            resolve_roll_stage_name = None
        for roll in pool:
            family = 'Unknown'
            if roll.material and hasattr(roll.material, 'parent_family') and roll.material.parent_family:
                family = roll.material.parent_family.name
            elif roll.material:
                family = roll.material.name
            
            if family not in grouped:
                grouped[family] = []
            roll_meta = dict(getattr(roll, "meta_json", None) or {})
            roll_role = resolve_roll_role(roll) if resolve_roll_role else None
            if not roll_role:
                roll_role = roll_meta.get("roll_role")
            grouped[family].append({
                'id': str(roll.id),
                'label_id': roll.label_id,
                'display_label': resolve_roll_display_label(roll) if resolve_roll_display_label else roll.label_id,
                'material_id': str(roll.material_id) if getattr(roll, 'material_id', None) else None,
                'variant_id': str(roll.material_id) if getattr(roll, 'material_id', None) else None,
                'material_name': roll.material.name if roll.material else 'N/A',
                'weight_kg': float(roll.weight_kg),
                'width_mm': float(roll.width_mm or 0),
                'status': roll.status,
                'roll_role': roll_role,
                'source_behavior': roll_meta.get("source_behavior"),
                'created_process_name': roll.created_process.name if getattr(roll, "created_process", None) else None,
                'is_remainder': bool(roll_meta.get("is_remainder")) or str(roll_role or "").upper() == "REMAINDER",
                'stage_index': int(getattr(roll, "stage_index", 0) or 0),
                'current_step_index': int(getattr(roll, "current_step_index", 0) or 0),
                'completed_step_index': int(getattr(roll, "completed_step_index", 0) or 0),
                'stage': (
                    resolve_roll_stage_name(roll)
                    if resolve_roll_stage_name
                    else (f"Stage {int(getattr(roll, 'stage_index', 0) or 0)}")
                )
            })
        return grouped

    @classmethod
    def get_satisfaction_status(cls, job_id):
        """
        Phase 68: Returns input satisfaction status for UI.
        Shows required/available/missing rolls & bulk consumption preview.
        """
        job = ProductionJob.objects.select_related('current_process', 'process', 'sales_order_item', 'template').get(id=job_id)
        process = job.current_process or job.process

        # Reconcile old assignment links into reservation source-of-truth.
        cls.reconcile_assignment_reservations(job)

        # Ensure step requirements are up-to-date for bulk preview.
        try:
            cls.calculate_requirements(job.id)
        except Exception:
            pass

        # WIP pool = strict lineage/spec eligible rolls for this job/step.
        # Keep satisfaction counters aligned with this strict pool to prevent
        # stale/phantom availability mismatches across WCM, machine, and queue UIs.
        wip_details = cls._resolve_wip_pool_details(job)
        wip_pool = wip_details.get("lineage_pool") or []
        discoverable_pool = wip_details.get("discoverable_pool") or wip_details.get("pool") or []
        wip_meta = wip_details.get("meta") or {}
        wip_count = len(wip_pool)
        discoverable_count = len(discoverable_pool)
        fallback_count = int(wip_meta.get("fallback_roll_count") or 0)

        # Roll requirement derives ONLY from process physics.
        current_step_roll_spec = cls._resolve_step_roll_spec(job, process)
        # Source-of-truth must be process physics, not discover-cache metadata.
        # This prevents stale UI states such as "required 2" after route transitions
        # where WIP meta still reflects an earlier step snapshot.
        rolls_required = cls._required_roll_count(job, process, current_step_roll_spec)

        # Explicit reservations (manual assign in WCM)
        # We also look at FULFILLED reservations because for satisfaction, 
        # a roll that was already consumed by THIS JOB satisfies its requirement part.
        reservation_qs = InventoryReservation.objects.filter(job=job, roll__isnull=False)
        reserved_count = reservation_qs.filter(status='ACTIVE').count()
        # Do not count fulfilled reservations from prior steps for current-step
        # readiness; that creates phantom READY states when no active roll is
        # assigned in this step.
        fulfilled_count = 0

        # Strictly aligned discoverable pool for this step.
        rolls_available = wip_count
        rolls_auto_forwarded = max(0, wip_count - reserved_count)
        rolls_pool = discoverable_count

        # IMPORTANT:
        # - `rolls_available` is strict discoverable stock for this step (WIP pool)
        # - execution readiness must be based on explicit reservations
        #   to prevent phantom "satisfied" states in WCM.
        rolls_missing_pool = max(0, rolls_required - rolls_pool)
        rolls_missing_lineage = max(0, rolls_required - rolls_available)

        # Current-step readiness depends on active assignments only.
        rolls_missing = max(0, rolls_required - reserved_count)
        roll_satisfied = (rolls_missing == 0)

        # Bulk consumption preview (step-aware)
        bulk_preview = cls.get_bulk_consumption_preview(job)
        bulk_satisfied = True
        for item in bulk_preview:
            required = Decimal(str(item.get('required_qty_kg') or 0))
            available = Decimal(str(item.get('available_qty_kg') or 0))
            if required > 0 and available < required:
                bulk_satisfied = False
                break

        is_satisfied = roll_satisfied and bulk_satisfied
        auto_assignment_result = {
            'required_rolls': rolls_required,
            'reserved_rolls': reserved_count,
            'missing_rolls': rolls_missing,
            'pool_rolls': rolls_pool,
            'auto_first': True,
        }
        override_required = bool(process and process.input_form == 'ROLL' and rolls_missing > 0)

        return {
            'job_id': str(job.id),
            'process_code': process.code if process else 'N/A',
            'input_form': process.input_form if process else 'ROLL',
            'roll_behavior': process.roll_behavior if process else 'NONE',
            'current_step_roll_handling': current_step_roll_spec,

            # Roll Requirements
            'rolls_required': rolls_required,
            'rolls_available': rolls_available,
            'rolls_reserved': reserved_count,
            'rolls_auto_forwarded': rolls_auto_forwarded,
            'rolls_pool': rolls_pool,
            'rolls_fallback_available': fallback_count,
            'rolls_missing': rolls_missing,
            'rolls_missing_pool': rolls_missing_pool,
            'rolls_missing_lineage': rolls_missing_lineage,

            # Bulk Consumption Preview
            'bulk_consumption': bulk_preview,
            'auto_assignment_result': auto_assignment_result,
            'override_required': override_required,
            'override_reason_required': True,

            # Overall Status
            'is_satisfied': is_satisfied,
            'can_start': is_satisfied,
            'status_message': 'Ready to start' if is_satisfied else 'Missing required materials'
        }

    @classmethod
    def auto_satisfy_inputs(cls, job_id, user=None):
        """
        Attempts to auto-assign rolls using behavior-aware rules.
        Manual intervention is required only when auto-pick cannot satisfy demand.
        """
        job = ProductionJob.objects.select_related('current_process', 'process').get(id=job_id)
        process = job.current_process or job.process

        if not process or process.input_form != 'ROLL':
            return {
                'auto_assigned': 0,
                'auto_assigned_roll_ids': [],
                'status': cls.get_satisfaction_status(job_id)
            }

        current_step_roll_spec = cls._resolve_step_roll_spec(job, process)
        required_rolls = cls._required_roll_count(job, process, current_step_roll_spec)
        auto_result = cls._auto_pick_rolls_for_job(
            job=job,
            process=process,
            required_rolls=required_rolls,
            user=user,
        )
        status = cls.get_satisfaction_status(job_id)
        return {
            'auto_assigned': auto_result.get('auto_assigned', 0),
            'auto_assigned_roll_ids': auto_result.get('auto_assigned_roll_ids', []),
            'current_step_roll_handling': current_step_roll_spec,
            'manual_required': bool(status.get('rolls_missing')),
            'missing_after_auto': int(status.get('rolls_missing') or 0),
            'status': status
        }

    @classmethod
    def get_step_execution_profile(cls, job_id):
        job = ProductionJob.objects.select_related(
            'current_process',
            'process',
            'template',
            'sales_order_item',
        ).filter(id=job_id).first()
        if job is None:
            return {
                'job_id': str(job_id or ''),
                'missing': True,
                'status': 'missing',
                'step_target_total_kg': 0,
                'step_produced_kg': 0,
                'step_remaining_kg': 0,
            }
        return cls._resolve_step_execution_profile(job)

    @classmethod
    def _resolve_requirement_capture_mode(cls, req):
        category = str(getattr(getattr(req, "material", None), "category", "") or "").upper()
        step = getattr(req, "process_step", None)
        if step is not None:
            try:
                direct = step.materials.filter(material_id=req.material_id).first()
                if direct and getattr(direct, "capture_mode", None):
                    return str(direct.capture_mode).upper()
            except Exception:
                pass
            try:
                if category:
                    mapped = step.materials.filter(
                        source_kind="CATEGORY",
                        category_code=category,
                    ).first()
                    if mapped and getattr(mapped, "capture_mode", None):
                        return str(mapped.capture_mode).upper()
            except Exception:
                pass
        if category == "GRANULE":
            return "AUTO_ESTIMATED_CONFIRM"
        if category in {"INK", "CHEMICAL"}:
            return "AUTO_ESTIMATED_CONFIRM"
        return "AUTO_FROM_OUTPUT"

    @classmethod
    def _build_material_confirmation_map(cls, material_confirmations):
        confirmations = material_confirmations or []
        by_requirement = {}
        by_material = {}
        for row in confirmations:
            if not isinstance(row, dict):
                continue
            requirement_id = str(row.get("requirement_id") or "").strip()
            material_id = str(row.get("material_id") or "").strip()
            if requirement_id:
                by_requirement[requirement_id] = row
            if material_id and material_id not in by_material:
                by_material[material_id] = row
        return by_requirement, by_material

    @classmethod
    def reconcile_step_material_actuals(
        cls,
        job,
        material_confirmations,
        consumption_location_id,
        user=None,
        strict=False,
    ):
        step_seq = (job.current_step_index or 0) + 1
        reqs = JobMaterialRequirement.objects.select_related("material", "process_step").filter(
            production_job=job,
            process_step__sequence_number=step_seq,
        )
        if not reqs.exists():
            return

        by_requirement, by_material = cls._build_material_confirmation_map(material_confirmations)
        location = None
        if consumption_location_id:
            location = InventoryLocation.objects.filter(id=consumption_location_id, is_active=True).first()

        for req in reqs:
            capture_mode = cls._resolve_requirement_capture_mode(req)
            current_consumed = Decimal(str(req.consumed_qty or 0)).quantize(Decimal("0.0001"))
            return_mode = "EXACT_COLOR_RETURN"
            remix_target_material_id = None
            granule_code_allocations = []

            if capture_mode == "AUTO_FROM_OUTPUT":
                desired_issued = Decimal(str(req.actual_issued_qty or 0)).quantize(Decimal("0.0001"))
                desired_returned = Decimal(str(req.actual_returned_qty or 0)).quantize(Decimal("0.0001"))
                if desired_issued <= 0 and desired_returned <= 0:
                    desired_issued = current_consumed
                    desired_returned = Decimal("0")
                desired_scrap = Decimal(str(req.actual_scrap_qty or 0)).quantize(Decimal("0.0001"))
                desired_consumed = current_consumed
                estimated_flag = False
            else:
                confirmation = by_requirement.get(str(req.id)) or by_material.get(str(req.material_id))
                if confirmation is None:
                    if strict:
                        raise ValueError(f"Actual confirmation is required for {req.material.name}.")
                    desired_issued = current_consumed
                    desired_returned = Decimal("0")
                    desired_scrap = Decimal(str(req.actual_scrap_qty or 0)).quantize(Decimal("0.0001"))
                    estimated_flag = True
                else:
                    desired_issued = Decimal(str(confirmation.get("actual_issued_qty") or 0)).quantize(Decimal("0.0001"))
                    desired_returned = Decimal(str(confirmation.get("actual_returned_qty") or 0)).quantize(Decimal("0.0001"))
                    desired_scrap = Decimal(str(confirmation.get("actual_scrap_qty") or 0)).quantize(Decimal("0.0001"))
                    estimated_flag = bool(confirmation.get("is_estimated"))
                    return_mode = str(confirmation.get("return_mode") or "EXACT_COLOR_RETURN").strip().upper()
                    remix_target_material_id = str(confirmation.get("target_ink_material_id") or "").strip() or None
                    raw_allocations = confirmation.get("granule_code_allocations") or confirmation.get("code_allocations") or []
                    if raw_allocations:
                        if str(getattr(req.material, "category", "") or "").upper() != "GRANULE":
                            raise ValueError(f"Granule code allocation is only allowed for granule material rows, not {req.material.name}.")
                        for allocation in raw_allocations:
                            code_id = str(allocation.get("granule_code_id") or allocation.get("id") or "").strip()
                            allocation_qty = Decimal(str(allocation.get("qty_kg") or allocation.get("quantity") or 0)).quantize(Decimal("0.0001"))
                            if code_id and allocation_qty > 0:
                                granule_code_allocations.append({
                                    "granule_code_id": code_id,
                                    "qty": allocation_qty,
                                })
                    if return_mode not in {"EXACT_COLOR_RETURN", "REMIXED_RETURN"}:
                        raise ValueError(f"Invalid return_mode for {req.material.name}.")
                if desired_issued < 0 or desired_returned < 0 or desired_scrap < 0:
                    raise ValueError(f"Actual quantities for {req.material.name} must be zero or positive.")
                desired_consumed = max(Decimal("0"), desired_issued - desired_returned).quantize(Decimal("0.0001"))

            delta = (desired_consumed - current_consumed).quantize(Decimal("0.0001"))
            if delta != 0:
                if not consumption_location_id:
                    raise ValueError(f"Cannot reconcile actual usage for {req.material.name}: source location is missing.")
                if delta > 0:
                    if granule_code_allocations:
                        allocated_total = sum((row["qty"] for row in granule_code_allocations), Decimal("0")).quantize(Decimal("0.0001"))
                        if allocated_total != delta:
                            raise ValueError(
                                f"Granule code allocations for {req.material.name} must total {delta} kg, got {allocated_total} kg."
                            )
                        for allocation in granule_code_allocations:
                            BulkService.consume_bulk(
                                material_id=req.material_id,
                                granule_code_id=allocation["granule_code_id"],
                                qty=allocation["qty"],
                                location_id=consumption_location_id,
                                job_id=job.id,
                                reference=f"Actual Reconcile: Step {step_seq} {job.job_number}",
                                qty_uom=req.uom,
                            )
                            MaterialConsumptionLog.objects.create(
                                production_job=job,
                                material=req.material,
                                granule_code_id=allocation["granule_code_id"],
                                quantity=allocation["qty"],
                                uom=req.uom,
                                is_estimated=estimated_flag,
                            )
                    else:
                        BulkService.consume_bulk(
                            material_id=req.material_id,
                            qty=delta,
                            location_id=consumption_location_id,
                            job_id=job.id,
                            reference=f"Actual Reconcile: Step {step_seq} {job.job_number}",
                            qty_uom=req.uom,
                        )
                        MaterialConsumptionLog.objects.create(
                            production_job=job,
                            material=req.material,
                            quantity=delta,
                            uom=req.uom,
                            is_estimated=estimated_flag,
                        )
                else:
                    return_qty = abs(delta)
                    if not location:
                        raise ValueError(f"Cannot return actual remainder for {req.material.name}: source location is invalid.")
                    return_material_id = req.material_id
                    if return_mode == "REMIXED_RETURN" and remix_target_material_id:
                        return_material_id = remix_target_material_id
                    elif return_mode == "REMIXED_RETURN":
                        return_material_id = str(cls._generic_mix_return_ink(req.material).id)
                    BulkService.add_bulk(
                        material_id=return_material_id,
                        qty=return_qty,
                        plant_id=location.plant_id,
                        location_id=consumption_location_id,
                        cost=0,
                        reference=f"Actual Return: Step {step_seq} {job.job_number}",
                        qty_uom=req.uom,
                    )
                    MaterialConsumptionLog.objects.create(
                        production_job=job,
                        material=req.material,
                        quantity=-return_qty,
                        uom=req.uom,
                        is_estimated=estimated_flag,
                    )

            req.actual_issued_qty = desired_issued
            req.actual_returned_qty = desired_returned
            req.actual_scrap_qty = desired_scrap
            req.consumed_qty = desired_consumed
            req.variance_qty = (desired_consumed - Decimal(str(req.theoretical_qty or 0))).quantize(Decimal("0.0001"))
            req.is_estimated = estimated_flag
            req.save(
                update_fields=[
                    "actual_issued_qty",
                    "actual_returned_qty",
                    "actual_scrap_qty",
                    "consumed_qty",
                    "variance_qty",
                    "is_estimated",
                ]
            )

            if str(getattr(req.material, "category", "") or "").upper() == "INK" and hasattr(req, "_meta"):
                InkBlendTransaction.objects.filter(
                    production_job=job,
                    process_step=getattr(req, "process_step", None),
                    source_requirement=req,
                ).delete()
                if desired_returned > 0:
                    target_material = None
                    if return_mode == "REMIXED_RETURN" and remix_target_material_id:
                        target_material = InventoryMaterial.objects.filter(id=remix_target_material_id).first()
                    elif return_mode == "REMIXED_RETURN":
                        target_material = cls._generic_mix_return_ink(req.material)
                    InkBlendTransaction.objects.create(
                        production_job=job,
                        process_step=getattr(req, "process_step", None),
                        source_requirement=req,
                        source_material=req.material,
                        target_material=target_material,
                        return_mode=return_mode,
                        returned_qty_kg=desired_returned,
                        created_by=user,
                    )

    @classmethod
    def _reconcile_step_bulk_consumption(cls, job, produced_kg, consumption_location_id, user=None):
        """
        Reconcile current-step bulk consumption to produced ratio at close time.
        Keeps short/force-completed steps proportional.
        """
        if not consumption_location_id:
            return

        step_seq = (job.current_step_index or 0) + 1
        reqs = JobMaterialRequirement.objects.select_related("material", "process_step").filter(
            production_job=job,
            process_step__sequence_number=step_seq,
        )
        if not reqs.exists():
            return

        step_profile = cls._resolve_step_execution_profile(job)
        step_target_total_kg = Decimal(str(step_profile.get("step_target_total_kg") or 0))
        produced_kg = Decimal(str(produced_kg or 0))

        if step_target_total_kg > 0:
            ratio = produced_kg / step_target_total_kg
        elif Decimal(str(job.quantity or 0)) > 0:
            # Legacy fallback when step target derivation is unavailable.
            ratio = produced_kg / Decimal(str(job.quantity or 0))
        else:
            ratio = Decimal("0")

        if ratio < 0:
            ratio = Decimal("0")
        if ratio > Decimal("1"):
            ratio = Decimal("1")

        location = InventoryLocation.objects.filter(id=consumption_location_id, is_active=True).first()
        if not location:
            raise ValueError("Cannot resolve consumption location for bulk reconciliation.")

        for req in reqs:
            category = str(getattr(req.material, "category", "") or "").upper()
            if category in ("FILM_VARIANT", "FILM_FAMILY"):
                continue
            capture_mode = cls._resolve_requirement_capture_mode(req)

            required_qty = Decimal(str(req.required_qty or 0))
            expected_consumed = (required_qty * ratio).quantize(Decimal("0.0001"))
            actual_consumed = Decimal(str(req.consumed_qty or 0)).quantize(Decimal("0.0001"))
            delta = (expected_consumed - actual_consumed).quantize(Decimal("0.0001"))

            if delta > 0:
                BulkService.consume_bulk(
                    material_id=req.material_id,
                    qty=delta,
                    location_id=consumption_location_id,
                    job_id=job.id,
                    reference=f"Reconcile Consume: Step {step_seq} {job.job_number}",
                    qty_uom=req.uom,
                )
                MaterialConsumptionLog.objects.create(
                    production_job=job,
                    material=req.material,
                    quantity=delta,
                    uom=req.uom,
                    is_estimated=False,
                )
            elif delta < 0:
                return_qty = abs(delta)
                BulkService.add_bulk(
                    material_id=req.material_id,
                    qty=return_qty,
                    plant_id=location.plant_id,
                    location_id=consumption_location_id,
                    cost=0,
                    reference=f"Reconcile Return: Step {step_seq} {job.job_number}",
                    qty_uom=req.uom,
                )
                MaterialConsumptionLog.objects.create(
                    production_job=job,
                    material=req.material,
                    quantity=-return_qty,
                    uom=req.uom,
                    is_estimated=False,
                )

            update_fields = []
            if req.consumed_qty != expected_consumed:
                req.consumed_qty = expected_consumed
                update_fields.append("consumed_qty")
            if capture_mode == "AUTO_FROM_OUTPUT":
                req.actual_issued_qty = expected_consumed
                req.actual_returned_qty = Decimal("0")
                req.variance_qty = (expected_consumed - Decimal(str(req.theoretical_qty or 0))).quantize(Decimal("0.0001"))
                req.is_estimated = False
                update_fields.extend(["actual_issued_qty", "actual_returned_qty", "variance_qty", "is_estimated"])
            if update_fields:
                req.save(update_fields=list(dict.fromkeys(update_fields)))

    @classmethod
    def get_bulk_consumption_preview(cls, job):
        """
        Phase 68: Previews bulk materials that will be auto-consumed.
        Returns list of materials and quantities for UI display.
        Shows requirements even when no location is configured (with 0 availability).
        """
        location_id = job.from_location_id or (job.work_center.default_wip_location_id if job.work_center else None)

        # Step-aware requirements only (Bulk mapping from template)
        current_step = job.current_step_index + 1
        reqs = job.material_requirements.select_related('material', 'process_step').filter(
            process_step__sequence_number=current_step
        )
        if not reqs.exists():
            # No bulk mapped for this step (valid). Do NOT fallback to other steps.
            return []

        step_profile = cls._resolve_step_execution_profile(job)
        step_target_total_kg = Decimal(str(step_profile.get("step_target_total_kg") or 0))
        produced_kg = Decimal(str(step_profile.get("step_produced_kg") or 0))
        if step_target_total_kg > 0:
            ratio = produced_kg / step_target_total_kg
        elif Decimal(str(job.quantity or 0)) > 0:
            ratio = produced_kg / Decimal(str(job.quantity or 0))
        else:
            ratio = Decimal("0")
        if ratio < 0:
            ratio = Decimal("0")
        if ratio > Decimal("1"):
            ratio = Decimal("1")

        # Phase 73: Determine roll materials to exclude from bulk listing.
        # If a step consumes a roll, that material should not be shown as "bulk".
        process = job.current_process or job.process
        input_spec = cls._resolve_step_roll_spec(job, process)
        excluded_m_ids = set()
        v_id = input_spec.get("input_variant_id") or input_spec.get("output_variant_id")
        if (process.input_form or "").upper() == "ROLL" and v_id:
            excluded_m_ids.add(str(v_id))

        policy_by_requirement_id = {
            str(row.get("requirement_id")): row
            for row in cls.current_step_requirement_policy_items(job)
            if row.get("requirement_id")
        }
        preview = []
        for req in reqs:
            if str(req.material_id) in excluded_m_ids:
                continue
            capture_mode = cls._resolve_requirement_capture_mode(req)
            theoretical_qty = Decimal(str(req.theoretical_qty or 0)).quantize(Decimal("0.0001"))
            planned_issue_qty = Decimal(str(req.planned_issue_qty or req.required_qty or 0)).quantize(Decimal("0.0001"))
            policy_item = policy_by_requirement_id.get(str(req.id)) or {}
            if policy_item:
                planned_issue_qty = Decimal(str(policy_item.get("planned_issue_qty") or planned_issue_qty)).quantize(Decimal("0.0001"))
            actual_issued_qty = Decimal(str(req.actual_issued_qty or 0)).quantize(Decimal("0.0001"))
            actual_returned_qty = Decimal(str(req.actual_returned_qty or 0)).quantize(Decimal("0.0001"))
            actual_scrap_qty = Decimal(str(req.actual_scrap_qty or 0)).quantize(Decimal("0.0001"))
            actual_consumed_qty = Decimal(str(req.consumed_qty or 0)).quantize(Decimal("0.0001"))
            variance_qty = Decimal(str(req.variance_qty or 0)).quantize(Decimal("0.0001"))
            estimated_actual_qty = (Decimal(str(req.required_qty or 0)) * ratio).quantize(Decimal("0.0001"))
            required = max(Decimal(str(req.required_qty)) - Decimal(str(req.consumed_qty)), Decimal('0'))
            
            # Source-location availability (exact consuming location)
            available = 0
            if location_id:
                available = InventoryBulk.objects.filter(
                    location_id=location_id,
                    material=req.material
                ).aggregate(total=Sum('qty_kg')).get('total') or 0

            # Current-plant availability (all active locations in same plant)
            plant_id = job.work_center.plant_id if job.work_center else None
            plant_available = 0
            if plant_id:
                plant_available = InventoryBulk.objects.filter(
                    plant_id=plant_id,
                    material=req.material
                ).aggregate(total=Sum('qty_kg')).get('total') or 0

            # Global availability (all plants)
            global_available = InventoryBulk.objects.filter(
                material=req.material
            ).aggregate(total=Sum('qty_kg')).get('total') or 0

            other_plants_available = Decimal(str(global_available)) - Decimal(str(plant_available))
            if other_plants_available < 0:
                other_plants_available = Decimal('0')
            req_uom = str(req.uom or getattr(req.material, "base_uom", None) or "KG").upper()
            if req_uom not in {"KG", "PCS", "METER"}:
                req_uom = "KG"

            granule_code_options = []
            if str(getattr(req.material, "category", "") or "").upper() == "GRANULE":
                code_stock = (
                    InventoryBulk.objects
                    .select_related("granule_code", "location", "plant")
                    .filter(material=req.material, granule_code__isnull=False, qty_kg__gt=0)
                )
                if location_id:
                    code_stock = code_stock.filter(location_id=location_id)
                elif plant_id:
                    code_stock = code_stock.filter(plant_id=plant_id)
                for stock in code_stock.order_by("granule_code__code", "location__name", "plant__name"):
                    granule_code = stock.granule_code
                    granule_code_options.append({
                        "granule_code_id": str(granule_code.id),
                        "code": granule_code.code,
                        "available_qty_kg": float(stock.qty_kg or 0),
                        "location_id": str(stock.location_id),
                        "location_name": stock.location.name if stock.location else "",
                        "plant_id": str(stock.plant_id),
                        "plant_name": stock.plant.name if stock.plant else "",
                    })

            preview.append({
                'material_id': str(req.material_id),
                'material_name': req.material.name,
                'category': req.material.category,
                'category_display': req.material.category,
                'mode': req_uom,
                'uom': req_uom,
                'required_qty': float(required),
                'available_qty': float(available),
                'plant_available_qty': float(plant_available),
                'global_available_qty': float(global_available),
                'source_location_available_qty': float(available),
                'current_plant_available_qty': float(plant_available),
                'other_plants_available_qty': float(other_plants_available),
                'theoretical_qty': float(theoretical_qty),
                'planned_issue_qty': float(planned_issue_qty),
                'actual_issued_qty': float(actual_issued_qty),
                'actual_returned_qty': float(actual_returned_qty),
                'actual_scrap_qty': float(actual_scrap_qty),
                'actual_consumed_qty': float(actual_consumed_qty),
                'variance_qty': float(variance_qty),
                'estimated_actual_qty': float(estimated_actual_qty),
                'required_qty_kg': float(required),
                # Backward-compatible legacy keys
                'available_qty_kg': float(available),
                'plant_available_qty_kg': float(plant_available),
                'global_available_qty_kg': float(global_available),
                # Explicit additive keys for frontend semantics
                'source_location_available_qty_kg': float(available),
                'current_plant_available_qty_kg': float(plant_available),
                'other_plants_available_qty_kg': float(other_plants_available),
                'location_id': str(location_id) if location_id else None,
                'location_name': job.from_location.name if job.from_location else None,
                'is_auto_deduct': True,
                'strategy': capture_mode,
                'requirement_id': str(req.id),
                'theoretical_qty_kg': float(theoretical_qty),
                'planned_issue_qty_kg': float(planned_issue_qty),
                'policy_key': policy_item.get("policy_key") or cls._requirement_policy_key(req),
                'template_issue_policy_mode': policy_item.get("template_issue_policy_mode") or "NONE",
                'template_issue_policy_value': float(policy_item.get("template_issue_policy_value") or 0),
                'effective_issue_policy_mode': policy_item.get("effective_issue_policy_mode") or policy_item.get("template_issue_policy_mode") or "NONE",
                'effective_issue_policy_value': float(policy_item.get("effective_issue_policy_value") or policy_item.get("template_issue_policy_value") or 0),
                'policy_source': policy_item.get("policy_source") or "TEMPLATE_DEFAULT",
                'override_reason': policy_item.get("override_reason") or "",
                'actual_issued_qty_kg': float(actual_issued_qty),
                'actual_returned_qty_kg': float(actual_returned_qty),
                'actual_scrap_qty_kg': float(actual_scrap_qty),
                'actual_consumed_qty_kg': float(actual_consumed_qty),
                'variance_qty_kg': float(variance_qty),
                'capture_mode': capture_mode,
                'estimated_actual_qty_kg': float(estimated_actual_qty),
                'granule_code_options': granule_code_options,
            })

        return preview

    @classmethod
    def _resolve_bulk_consumption_location_id(cls, job):
        return job.from_location_id or (job.work_center.default_wip_location_id if job.work_center else None)

    @classmethod
    def top_up_bulk_source_location(cls, job_id):
        """
        Ensure current-step bulk requirements are physically available at the job source location.
        Pulls stock from other same-plant locations before execution readiness checks.
        """
        job = ProductionJob.objects.select_related("work_center", "from_location").get(id=job_id)
        if not job.from_location_id:
            return {"moved_lines": 0, "moved_qty_kg": 0.0}

        plant_id = None
        if job.work_center_id and job.work_center and job.work_center.plant_id:
            plant_id = job.work_center.plant_id
        elif job.from_location and job.from_location.plant_id:
            plant_id = job.from_location.plant_id
        if not plant_id:
            return {"moved_lines": 0, "moved_qty_kg": 0.0}

        current_step = job.current_step_index + 1
        reqs = job.material_requirements.select_related("material", "process_step").filter(
            process_step__sequence_number=current_step
        )
        moved_lines = 0
        moved_qty = Decimal("0")

        for req in reqs:
            needed = max(Decimal(str(req.required_qty)) - Decimal(str(req.consumed_qty)), Decimal("0"))
            if needed <= 0:
                continue

            source_qty = (
                InventoryBulk.objects.filter(
                    location_id=job.from_location_id,
                    material_id=req.material_id,
                ).aggregate(total=Sum("qty_kg")).get("total")
                or Decimal("0")
            )
            shortage = needed - Decimal(str(source_qty))
            if shortage <= 0:
                continue

            donors = (
                InventoryBulk.objects.select_related("location")
                .filter(
                    plant_id=plant_id,
                    material_id=req.material_id,
                    qty_kg__gt=0,
                    location__is_active=True,
                )
                .exclude(location_id=job.from_location_id)
                .exclude(location__code="IN_TRANSIT")
                .order_by("-qty_kg")
            )

            for donor in donors:
                if shortage <= 0:
                    break
                donor_qty = Decimal(str(donor.qty_kg or 0))
                if donor_qty <= 0:
                    continue
                move_qty = min(shortage, donor_qty)
                if move_qty <= 0:
                    continue

                BulkService.transfer_bulk(
                    material_id=str(req.material_id),
                    qty=float(move_qty),
                    from_location_id=str(donor.location_id),
                    to_location_id=str(job.from_location_id),
                    reference=f"WCM-READY-TOPUP {job.job_number}",
                    qty_uom=req.uom,
                )
                moved_lines += 1
                moved_qty += move_qty
                shortage -= move_qty

        return {"moved_lines": moved_lines, "moved_qty_kg": float(moved_qty)}

    @classmethod
    def execute_completion(cls, job_id, actual_qty, user=None, **kwargs):
        """
        Phase 67 & 67.2: Universal Execution Logic.
        Handles physics-driven Output Creation and Bulk Consumption.
        """
        job = ProductionJob.objects.select_related(
            'current_process',
            'process',
            'template',
            'sales_order_item',
            'sales_order_item__sales_order',
            'mts_order',
            'work_center',
            'from_location',
            'to_location',
        ).get(id=job_id)
        process = job.current_process or job.process
        if not process:
            raise ValueError("Job has no process configured.")

        qty = Decimal(str(actual_qty))
        if qty <= 0:
            raise ValueError("Actual quantity must be > 0.")

        roll_behavior = (process.roll_behavior or "NONE").upper()
        step_roll_spec = cls._resolve_step_roll_spec(job, process)
        lane_group_mode = cls._is_lane_group_combine_spec(step_roll_spec)
        required_rolls = cls._required_roll_count(job, process, step_roll_spec)

        # Operator inputs (behavior-specific)
        output_width_mm = kwargs.get("output_width_mm")
        output_thickness_micron_input = kwargs.get("output_thickness_micron")
        raw_trim_qty = kwargs.get("trim_qty")
        raw_process_scrap_qty = kwargs.get("process_scrap_qty")
        split_waste_supplied = raw_trim_qty not in (None, "") or raw_process_scrap_qty not in (None, "")
        trim_qty = Decimal(str(raw_trim_qty or 0))
        process_scrap_qty = Decimal(str(raw_process_scrap_qty or 0))
        legacy_scrap_qty = Decimal(str(kwargs.get("scrap_qty") or 0))
        scrap_qty = (trim_qty + process_scrap_qty) if split_waste_supplied else legacy_scrap_qty
        split_outputs = kwargs.get("split_outputs") or []
        remainder_location_id = kwargs.get("remainder_location_id")
        if trim_qty < 0:
            raise ValueError("Trim cannot be negative.")
        if process_scrap_qty < 0 or legacy_scrap_qty < 0 or scrap_qty < 0:
            raise ValueError("Scrap cannot be negative.")

        # Machine payload quantity is KG-primary by default.
        # Legacy clients can pass `actual_uom=PCS` for conversion.
        unit_weight_g = Decimal(str(getattr(getattr(job, "sales_order_item", None), "unit_weight_g", 0) or 0))
        is_roll_mass_job = cls._is_roll_mass_job(job)
        actual_uom = str(kwargs.get("actual_uom") or "KG").upper()
        if is_roll_mass_job and str(process.output_form or "").upper() == "ROLL" and actual_uom == "PCS":
            raise ValueError("Roll output logging is KG-only for roll jobs.")
        if actual_uom == "PCS":
            if unit_weight_g <= 0:
                raise ValueError("Cannot convert PCS to KG without unit_weight_g.")
            output_weight_kg = (qty * unit_weight_g) / Decimal("1000")
        else:
            output_weight_kg = qty

        if process.output_form == 'ROLL' and roll_behavior == "CREATE_NEW":
            if output_width_mm in (None, "") and not kwargs.get("roll_outputs"):
                raise ValueError("Output width_mm is required for CREATE_NEW roll.")

        order_geometry_override = {}
        if job.sales_order_item_id and getattr(job.sales_order_item, "sales_order_id", None):
            order_geometry_override = dict(job.sales_order_item.sales_order.geometry_override or {})
        elif job.mts_order_id:
            order_geometry_override = dict(job.mts_order.geometry_override or {})

        roll_counter = InventoryRoll.objects.filter(production_job=job).count()
        target_stock_contract = StockFormResolver.from_job(job)
        operator_output_stock_form = kwargs.get("output_stock_form") or kwargs.get("stock_form")

        def _resolve_output_stock_form_for_row(input_roll=None, row=None):
            row = row or {}
            form = StockFormResolver.resolve_output_stock_form(
                process,
                input_stock_form=getattr(input_roll, "stock_form", None),
                target_contract=target_stock_contract,
                operator_stock_form=row.get("stock_form") or operator_output_stock_form,
            )
            basis = normalize_width_basis(row.get("width_basis") or "", stock_form=form)
            return form, basis

        def _next_job_roll_label(prefix=""):
            nonlocal roll_counter
            suffix = f"-{str(prefix).upper()}" if prefix else ""
            for _ in range(1000):
                roll_counter += 1
                candidate = f"R-{job.job_number}-{roll_counter:04d}{suffix}"
                if not InventoryRoll.objects.filter(label_id=candidate).exists():
                    return candidate

            job_token = str(getattr(job, "id", "") or "").replace("-", "")[:8] or "JOB"
            roll_counter += 1
            return f"R-{job.job_number}-{job_token}-{roll_counter:04d}{suffix}"

        def _resolve_rm_location_for_plant(plant_id):
            if not plant_id:
                return None
            return (
                InventoryLocation.objects.filter(plant_id=plant_id, type='RM', is_active=True)
                .order_by('-is_system', 'name')
                .first()
                or InventoryLocation.objects.filter(plant_id=plant_id, type='WAREHOUSE', is_active=True)
                .order_by('-is_system', 'name')
                .first()
                or InventoryLocation.objects.filter(plant_id=plant_id, is_active=True)
                .order_by('-is_system', 'name')
                .first()
            )

        def _is_processed_remainder_parent(parent_roll):
            meta = dict(getattr(parent_roll, "meta_json", None) or {})
            role = str(meta.get("roll_role") or "").upper()
            try:
                stage_idx = int(getattr(parent_roll, "stage_index", 0) or 0)
            except Exception:
                stage_idx = 0
            return bool(getattr(parent_roll, "created_by_job_id", None)) and stage_idx > 0 and role not in {"RAW", "RAW_MATERIAL"}

        def _resolve_remainder_target_location_id(parent_roll):
            if remainder_override_location_id:
                return remainder_override_location_id

            current_location = getattr(parent_roll, "location", None)
            current_plant_id = (
                getattr(current_location, "plant_id", None)
                or getattr(parent_roll, "plant_id", None)
            )
            default_source_location_id = parent_roll.location_id

            if _is_processed_remainder_parent(parent_roll):
                return default_source_location_id or output_location_id

            # Confirmed policy:
            # keep raw remainder in current plant and return it to current plant RM location by default.
            rm_location = _resolve_rm_location_for_plant(current_plant_id)
            if rm_location:
                return rm_location.id

            return default_source_location_id or output_location_id

        def _create_remainder_roll(parent_roll, remainder_qty: Decimal, source_behavior: str):
            source_location_id = parent_roll.location_id
            target_location_id = _resolve_remainder_target_location_id(parent_roll)
            target_location = InventoryLocation.objects.filter(id=target_location_id).select_related("plant").first() if target_location_id else None

            source_stage_name = None
            try:
                from apps.inventory.serializers import resolve_roll_stage_name
                source_stage_name = resolve_roll_stage_name(parent_roll)
            except Exception:
                source_stage_name = None

            remainder_meta = dict(parent_roll.meta_json or {})
            processed_remainder = _is_processed_remainder_parent(parent_roll)
            parent_stage_index = int(getattr(parent_roll, "stage_index", 0) or 0)
            parent_current_step_index = int(getattr(parent_roll, "current_step_index", 0) or 0)
            parent_completed_step_index = int(getattr(parent_roll, "completed_step_index", 0) or 0)
            remainder_meta.update({
                "is_remainder": True,
                "roll_role": "WIP_REMAINDER" if processed_remainder else "RAW_REMAINDER",
                "source_behavior": source_behavior,
                "source_roll_label": parent_roll.label_id,
                "source_stage_index": parent_roll.stage_index,
                "source_stage_name": source_stage_name,
                "source_process_code": parent_roll.created_process.code if parent_roll.created_process else None,
                "remainder_return_location_id": str(target_location_id) if target_location_id else None,
            })

            remainder_roll = InventoryRoll.objects.create(
                label_id=_next_job_roll_label("REM"),
                material=parent_roll.material,
                plant=(
                    target_location.plant
                    if target_location and target_location.plant_id
                    else (parent_roll.location.plant if parent_roll.location else parent_roll.plant)
                ),
                production_job=job,
                created_by_job=job,
                created_process=parent_roll.created_process,
                parent_roll=parent_roll,
                thickness_micron=parent_roll.thickness_micron,
                width_mm=parent_roll.width_mm,
                stock_form=parent_roll.stock_form,
                width_basis=parent_roll.width_basis,
                density_gcm3=cls._resolve_density_gcm3(roll=parent_roll),
                grade_id=parent_roll.grade_id,
                weight_kg=remainder_qty,
                original_weight_kg=remainder_qty,
                status='AVAILABLE',
                location_id=target_location_id,
                # Raw input leftovers return as raw RM; processed WIP leftovers retain route context.
                stage_index=parent_stage_index if processed_remainder else 0,
                current_step_index=parent_current_step_index if processed_remainder else 0,
                completed_step_index=parent_completed_step_index if processed_remainder else 0,
                template=parent_roll.template or job.template,
                # Remainder must stay attached to the current producing order flow
                # so downstream lineage/audit does not stick to an older source order.
                sales_order_item=job.sales_order_item or parent_roll.sales_order_item,
                meta_json=remainder_meta,
                is_fg=False
            )
            RollLink.objects.get_or_create(
                parent_roll=parent_roll,
                child_roll=remainder_roll,
                defaults={'relation_type': 'SPLIT', 'qty_used_kg': remainder_qty}
            )

            if source_location_id and target_location_id and str(source_location_id) != str(target_location_id):
                from_location = InventoryLocation.objects.filter(id=source_location_id).select_related("plant").first()
                cross_plant = bool(
                    from_location
                    and target_location
                    and from_location.plant_id
                    and target_location.plant_id
                    and str(from_location.plant_id) != str(target_location.plant_id)
                )
                RollMovement.objects.create(
                    roll=remainder_roll,
                    from_location_id=source_location_id,
                    to_location_id=target_location_id,
                    reason='INTER_PLANT' if cross_plant else 'WIP_TRANSFER',
                    reason_note='Remainder relocation after partial roll consumption',
                    job=job,
                    moved_by=user,
                )
            return remainder_roll

        def _consume_input_rolls_with_remainder(
            input_rolls,
            qty_kg: Decimal,
            source_behavior: str,
            consume_all_parents: bool = False,
        ):
            """
            Canonical roll physics:
            - Parent rolls are always fully consumed when touched.
            - Any balance returns as explicit REMAINDER child roll.
            Returns list of dicts: {parent_roll, used_qty_kg, remainder_qty_kg, remainder_roll}.
            """
            remaining = Decimal(str(qty_kg))
            usage = []
            epsilon = Decimal('0.0001')
            for parent_roll in input_rolls:
                if remaining <= epsilon and not consume_all_parents:
                    break
                input_weight = Decimal(str(parent_roll.weight_kg or 0))
                if input_weight <= 0:
                    continue

                effective_remaining = remaining if remaining > epsilon else Decimal("0")
                used_qty = min(input_weight, effective_remaining) if effective_remaining > 0 else Decimal("0")
                remainder_qty = input_weight - used_qty
                remainder_roll = None

                if remainder_qty > epsilon:
                    remainder_roll = _create_remainder_roll(parent_roll, remainder_qty, source_behavior)

                parent_roll.status = 'CONSUMED'
                parent_roll.weight_kg = Decimal('0')
                parent_roll.save(update_fields=['status', 'weight_kg'])

                usage.append({
                    "parent_roll": parent_roll,
                    "used_qty_kg": used_qty,
                    "remainder_qty_kg": remainder_qty if remainder_qty > epsilon else Decimal('0'),
                    "remainder_roll": remainder_roll,
                })
                if effective_remaining > 0:
                    remaining -= used_qty

            if remaining > epsilon:
                raise ValueError("Not enough input roll weight to cover output quantity.")
            return usage

        def _record_film_usage_actuals(usage, scrap_total_qty: Decimal):
            if not usage:
                return
            step_seq = (job.current_step_index or 0) + 1
            film_reqs = list(
                JobMaterialRequirement.objects.select_related("material").filter(
                    production_job=job,
                    process_step__sequence_number=step_seq,
                )
            )
            film_reqs = [
                req
                for req in film_reqs
                if str(getattr(req.material, "category", "") or "").upper() in {"FILM_VARIANT", "FILM_FAMILY"}
            ]
            if not film_reqs:
                return
            req_by_material = {str(req.material_id): req for req in film_reqs}
            single_req = film_reqs[0] if len(film_reqs) == 1 else None
            total_used = sum(Decimal(str(item.get("used_qty_kg") or 0)) for item in usage)
            updates = {}
            for item in usage:
                parent_roll = item.get("parent_roll")
                if not parent_roll:
                    continue
                req = req_by_material.get(str(parent_roll.material_id)) or single_req
                if not req:
                    continue
                bucket = updates.setdefault(
                    str(req.id),
                    {
                        "req": req,
                        "issued": Decimal("0"),
                        "returned": Decimal("0"),
                        "consumed": Decimal("0"),
                        "scrap": Decimal("0"),
                    },
                )
                used_qty = Decimal(str(item.get("used_qty_kg") or 0))
                remainder_qty = Decimal(str(item.get("remainder_qty_kg") or 0))
                bucket["issued"] += (used_qty + remainder_qty)
                bucket["returned"] += remainder_qty
                bucket["consumed"] += used_qty
                if total_used > 0 and scrap_total_qty > 0:
                    bucket["scrap"] += (scrap_total_qty * used_qty / total_used)
            for row in updates.values():
                req = row["req"]
                req.actual_issued_qty = (Decimal(str(req.actual_issued_qty or 0)) + row["issued"]).quantize(Decimal("0.0001"))
                req.actual_returned_qty = (Decimal(str(req.actual_returned_qty or 0)) + row["returned"]).quantize(Decimal("0.0001"))
                req.actual_scrap_qty = (Decimal(str(req.actual_scrap_qty or 0)) + row["scrap"]).quantize(Decimal("0.0001"))
                req.consumed_qty = (Decimal(str(req.consumed_qty or 0)) + row["consumed"]).quantize(Decimal("0.0001"))
                req.variance_qty = (Decimal(str(req.consumed_qty or 0)) - Decimal(str(req.theoretical_qty or 0))).quantize(Decimal("0.0001"))
                req.is_estimated = False
                req.save(
                    update_fields=[
                        "actual_issued_qty",
                        "actual_returned_qty",
                        "actual_scrap_qty",
                        "consumed_qty",
                        "variance_qty",
                        "is_estimated",
                    ]
                )

        def _record_roll_consumption_rows(usage, *, output_roll=None, output_kg_total=Decimal("0"), scrap_qty_total=Decimal("0")):
            if not usage:
                return
            total_used = sum(Decimal(str(item.get("used_qty_kg") or 0)) for item in usage)
            for item in usage:
                parent_roll = item.get("parent_roll")
                if not parent_roll:
                    continue
                used_qty = Decimal(str(item.get("used_qty_kg") or 0))
                remainder_roll = item.get("remainder_roll")
                remainder_qty = Decimal(str(item.get("remainder_qty_kg") or 0))
                proportional_output = Decimal("0")
                proportional_scrap = Decimal("0")
                if total_used > 0 and output_kg_total > 0:
                    proportional_output = (Decimal(str(output_kg_total)) * used_qty / total_used).quantize(Decimal("0.001"))
                if total_used > 0 and scrap_qty_total > 0:
                    proportional_scrap = (Decimal(str(scrap_qty_total)) * used_qty / total_used).quantize(Decimal("0.001"))
                RollConsumption.objects.create(
                    job=job,
                    process=process,
                    input_roll=parent_roll,
                    output_roll=output_roll,
                    balance_roll=remainder_roll,
                    consumed_kg=used_qty.quantize(Decimal("0.001")),
                    scrap_kg=proportional_scrap,
                    balance_kg=remainder_qty.quantize(Decimal("0.001")),
                    output_kg=proportional_output,
                    machine=getattr(job, "machine", None),
                    operator=user,
                )

        # Inventory locations:
        # - Bulk consumption comes from job.from_location when defined, else WC staging.
        # - Outputs go to job.to_location when defined, else WC staging.
        consumption_location_id = job.from_location_id or (job.work_center.default_wip_location_id if job.work_center else None)
        output_location_id = job.to_location_id or (job.work_center.default_wip_location_id if job.work_center else None)
        terminal_fg_location_id = cls._resolve_terminal_fg_location_id(job)
        if terminal_fg_location_id:
            output_location_id = terminal_fg_location_id
        # Guardrail: output inventory for current step must stay in source job plant.
        job_plant_id = cls._resolve_job_plant_id(job)
        if output_location_id and job_plant_id:
            out_loc = InventoryLocation.objects.filter(id=output_location_id).first()
            if out_loc and str(out_loc.plant_id) != str(job_plant_id):
                fallback_loc = (
                    InventoryLocation.objects.filter(
                        plant_id=job_plant_id,
                        type="WIP",
                        is_active=True,
                    ).order_by("-is_system", "name").first()
                    or InventoryLocation.objects.filter(
                        plant_id=job_plant_id,
                        is_active=True,
                    ).order_by("-is_system", "name").first()
                )
                if fallback_loc:
                    output_location_id = fallback_loc.id
        if not output_location_id:
            raise ValueError("Cannot resolve output location for job.")

        # Optional single override location for all remainder inventory.
        # Default remains each input roll's source location.
        remainder_override_location_id = None
        if remainder_location_id:
            remainder_loc = InventoryLocation.objects.filter(id=remainder_location_id, is_active=True).first()
            if not remainder_loc:
                raise ValueError("Invalid remainder_location_id.")
            job_plant_id = (
                getattr(getattr(job, "work_center", None), "plant_id", None)
                or getattr(getattr(job, "from_location", None), "plant_id", None)
                or getattr(getattr(job, "to_location", None), "plant_id", None)
            )
            if job_plant_id and str(remainder_loc.plant_id) != str(job_plant_id):
                raise ValueError("Remainder location must belong to the same plant as job.")
            remainder_override_location_id = remainder_loc.id

        packaging_purpose_job = cls._is_packaging_purpose_job(job)
        output_is_fg = bool(
            terminal_fg_location_id
            or (job.to_location and getattr(job.to_location, "type", None) == "FG")
        ) and not packaging_purpose_job
        internal_stock_meta = {"is_internal_stock": True} if packaging_purpose_job else {}

        # Get output material from Job Link (SO Item layers or Template layers)
        output_material = None
        first_layer = cls._first_layer_snapshot(job)
        variant_id = (
            kwargs.get("output_variant_id")
            or step_roll_spec.get("output_variant_id")
            or first_layer.get("variant_id")
            or first_layer.get("material_id")
        )
        if variant_id:
            output_material = InventoryMaterial.objects.filter(id=variant_id).first()
        output_grade_id = kwargs.get("output_grade_id") or step_roll_spec.get("output_grade_id") or first_layer.get("grade_id")
        output_thickness = step_roll_spec.get("fixed_thickness_micron") or first_layer.get("thickness_micron") or first_layer.get("thickness")

        # Capture target roll spec for traceability + eligibility filtering.
        # Many raw rolls in the system won't have these fields, but when present we enforce matches.
        roll_spec = {
            "variant_id": str(output_material.id) if output_material else None,
            "grade_id": str(output_grade_id) if output_grade_id else None,
            "thickness_micron": float(output_thickness) if output_thickness is not None else None,
            "operator_entry_mode": step_roll_spec.get("operator_entry_mode"),
            "thickness_rule": step_roll_spec.get("thickness_rule"),
            "width_rule": step_roll_spec.get("width_rule"),
            "template_step_id": step_roll_spec.get("template_step_id"),
        }
        if first_layer.get("family_id"):
            roll_spec["family_id"] = str(first_layer.get("family_id"))
        roll_spec = {k: v for k, v in roll_spec.items() if v is not None}

        def _release_unused_reserved_roll(roll):
            if not roll or str(getattr(roll, "status", "")).upper() == "CONSUMED":
                return

            source_location_id = getattr(roll, "location_id", None)
            target_location_id = source_location_id
            update_fields = []

            role = ""
            try:
                from apps.inventory.serializers import resolve_roll_role
                role = str(resolve_roll_role(roll) or "").upper()
            except Exception:
                role = str((getattr(roll, "meta_json", {}) or {}).get("roll_role") or "").upper()

            # Input stock allocated for the step (e.g., fresh RM roll) should return
            # to current-plant RM by default when it was not actually consumed.
            is_input_stock = role in {"INPUT_STOCK", "RAW_MATERIAL", "RAW", "PURCHASED"}
            if is_input_stock:
                if remainder_override_location_id:
                    target_location_id = remainder_override_location_id
                else:
                    current_plant_id = (
                        getattr(getattr(roll, "location", None), "plant_id", None)
                        or getattr(roll, "plant_id", None)
                        or job_plant_id
                    )
                    rm_location = _resolve_rm_location_for_plant(current_plant_id)
                    if rm_location:
                        target_location_id = rm_location.id
                # For strict step-0 modify/split policy, untouched reserved inputs
                # must return to raw allocatable state.
                if int(getattr(job, "current_step_index", 0) or 0) == 0 and roll_behavior in {"MODIFY_EXISTING", "SPLIT"}:
                    if int(getattr(roll, "stage_index", 0) or 0) != 0:
                        roll.stage_index = 0
                        update_fields.append("stage_index")
                    if int(getattr(roll, "current_step_index", 0) or 0) != 0:
                        roll.current_step_index = 0
                        update_fields.append("current_step_index")
                    if int(getattr(roll, "completed_step_index", 0) or 0) != 0:
                        roll.completed_step_index = 0
                        update_fields.append("completed_step_index")

            if str(getattr(roll, "status", "")).upper() != "AVAILABLE":
                roll.status = "AVAILABLE"
                update_fields.append("status")

            target_location = None
            if target_location_id and str(target_location_id) != str(source_location_id):
                target_location = InventoryLocation.objects.filter(id=target_location_id).select_related("plant").first()
                if target_location:
                    roll.location = target_location
                    update_fields.append("location")
                    if target_location.plant_id and str(getattr(roll, "plant_id", "")) != str(target_location.plant_id):
                        roll.plant = target_location.plant
                        update_fields.append("plant")

            if update_fields:
                roll.save(update_fields=list(dict.fromkeys(update_fields)))

            if target_location_id and str(target_location_id) != str(source_location_id):
                source_location = (
                    InventoryLocation.objects.filter(id=source_location_id).select_related("plant").first()
                    if source_location_id
                    else None
                )
                cross_plant = bool(
                    source_location
                    and target_location
                    and source_location.plant_id
                    and target_location.plant_id
                    and str(source_location.plant_id) != str(target_location.plant_id)
                )
                RollMovement.objects.create(
                    roll=roll,
                    from_location_id=source_location_id,
                    to_location_id=target_location_id,
                    reason="INTER_PLANT" if cross_plant else "WIP_TRANSFER",
                    reason_note="Unused reserved roll released after machine output log",
                    job=job,
                    moved_by=user,
                )

        with transaction.atomic():
            # 1. Step-aware Bulk Consumption (Template-driven)
            step_index = job.current_step_index + 1
            reqs = JobMaterialRequirement.objects.filter(
                production_job=job,
                process_step__sequence_number=step_index
            ).select_related('material')

            ratio = Decimal('0')
            step_profile = cls._resolve_step_execution_profile(job)
            step_target_total_kg = Decimal(str(step_profile.get("step_target_total_kg") or 0))
            ratio = Decimal("0")
            
            if step_target_total_kg > 0:
                ratio = output_weight_kg / step_target_total_kg
            elif job.quantity and Decimal(str(job.quantity)) > 0:
                # Legacy fallback when weight derivation is unavailable.
                ratio = qty / Decimal(str(job.quantity))
            
            if ratio < 0:
                ratio = Decimal("0")
            if ratio > Decimal("1"):
                ratio = Decimal("1")

            # Filter to skip film/roll materials in the bulk consumption loop
            # These are handled by the roll-specific logic later in this function
            bulk_reqs = reqs.exclude(material__category='FILM_VARIANT').exclude(material__category='FILM_FAMILY')
            for req in bulk_reqs:
                if not consumption_location_id:
                    raise ValueError("Cannot resolve consumption location for bulk materials.")

                consume_qty = (Decimal(str(req.required_qty)) * ratio).quantize(Decimal('0.0001'))
                
                # Capping logic: cannot consume more than remaining requirement for this step
                remaining_req = Decimal(str(req.required_qty or 0)) - Decimal(str(req.consumed_qty or 0))
                
                if remaining_req < 0:
                    remaining_req = Decimal("0")
                
                if consume_qty > remaining_req:
                    consume_qty = remaining_req

                if consume_qty <= 0:
                    continue

                BulkService.consume_bulk(
                    material_id=req.material.id,
                    qty=consume_qty,
                    location_id=consumption_location_id,
                    job_id=job.id,
                    reference=f"Auto-Consume: Step {step_index} {job.job_number}",
                    qty_uom=req.uom,
                )

                from apps.production.models import MaterialConsumptionLog
                MaterialConsumptionLog.objects.create(
                    production_job=job,
                    material=req.material,
                    quantity=consume_qty,
                    uom=req.uom,
                    is_estimated=False
                )

                req.consumed_qty += consume_qty
                req.save(update_fields=['consumed_qty'])

            # 2. Resolve input rolls (STRICT: must be reserved to avoid phantom consumption)
            roll_reservations = list(
                InventoryReservation.objects.filter(job=job, status='ACTIVE', roll__isnull=False)
                .select_related('roll')
                .order_by('created_at')
            )
            is_roll_to_bulk = (
                str(process.input_form or "").upper() == "ROLL"
                and str(process.output_form or "").upper() == "BULK"
            )

            if required_rolls == 0 and roll_reservations and not is_roll_to_bulk:
                raise ValueError("This process does not consume rolls, but roll reservations exist.")
            if required_rolls > 0 and len(roll_reservations) < required_rolls:
                raise ValueError("Missing reserved rolls. WCM must satisfy roll requirements before completion.")
            if is_roll_to_bulk and len(roll_reservations) <= 0:
                raise ValueError("ROLL->BULK requires at least one reserved input roll.")

            # ROLL->BULK and lane-group lamination can consume multiple reserved
            # physical rolls in one completion event. Strict behaviors stay
            # deterministic by required_roll_count policy.
            if is_roll_to_bulk or lane_group_mode:
                reservations_to_use = roll_reservations
                extra_reservations = []
            else:
                reservations_to_use = roll_reservations[:required_rolls] if required_rolls > 0 else []
                extra_reservations = roll_reservations[required_rolls:] if required_rolls > 0 else []
            input_rolls = [r.roll for r in reservations_to_use if r.roll]
            total_input_weight = sum(Decimal(str(r.weight_kg or 0)) for r in input_rolls)
            runtime_output_cap = cls._resolve_runtime_output_cap_kg(
                process,
                step_profile,
                input_rolls=input_rolls,
                scrap_qty=scrap_qty,
            )
            max_output_kg = runtime_output_cap.get("max_output_kg")
            epsilon = Decimal("0.001")
            if max_output_kg is not None and output_weight_kg > (max_output_kg + epsilon):
                raise ValueError(
                    f"Output ({output_weight_kg:.3f} kg) exceeds max allowed for this step "
                    f"({max_output_kg:.3f} kg)."
                )

            if roll_behavior in ('MODIFY_EXISTING', 'SPLIT') and len(input_rolls) != 1:
                raise ValueError(f"{roll_behavior} requires exactly one reserved roll.")
            if roll_behavior == 'MODIFY_EXISTING' and int(getattr(job, "current_step_index", 0) or 0) > 0:
                roll = input_rolls[0]
                roll_step = int(getattr(roll, "current_step_index", 0) or 0)
                if roll_step < int(getattr(job, "current_step_index", 0) or 0) or not getattr(roll, "created_by_job_id", None):
                    raise ValueError(
                        f"MODIFY_EXISTING at step {job.current_step_index} requires a lineage output roll "
                        f"from the previous production flow. Roll {roll.label_id} has current_step_index={roll_step}."
                    )
            if roll_behavior == 'MULTI_INPUT_COMBINE' and lane_group_mode:
                assignment_validation = cls._summarize_roll_assignment_validation(
                    job,
                    process,
                    input_rolls,
                    allow_input_stock_fallback=True,
                )
                if not assignment_validation.get("is_complete") or not assignment_validation.get("slot_satisfied"):
                    raise ValueError("MULTI_INPUT_COMBINE requires every lamination lane to have compatible reserved rolls.")
            elif roll_behavior == 'MULTI_INPUT_COMBINE' and len(input_rolls) != required_rolls:
                raise ValueError(f"MULTI_INPUT_COMBINE requires exactly {required_rolls} reserved rolls.")

            def _parse_decimal(value, field_name, allow_zero=False):
                if value in (None, ""):
                    return None
                try:
                    parsed = Decimal(str(value))
                except Exception:
                    raise ValueError(f"{field_name} must be numeric.")
                if parsed < 0 or (not allow_zero and parsed <= 0):
                    cmp_text = ">= 0" if allow_zero else "> 0"
                    raise ValueError(f"{field_name} must be {cmp_text}.")
                return parsed

            def _resolve_width(rule_name, inputs):
                rule = (rule_name or "").upper()
                if rule == "FIXED" and step_roll_spec.get("fixed_width_mm") is not None:
                    return Decimal(str(step_roll_spec.get("fixed_width_mm")))
                if rule == "MIN_INPUT":
                    values = [Decimal(str(r.width_mm)) for r in inputs if getattr(r, "width_mm", None) is not None]
                    return min(values) if values else None
                if rule == "LOCK_INPUT":
                    return Decimal(str(inputs[0].width_mm)) if inputs and getattr(inputs[0], "width_mm", None) is not None else None
                if rule in ("OPERATOR", "OPERATOR_GRID"):
                    return _parse_decimal(output_width_mm, "Output width_mm")
                return None

            def _resolve_thickness(rule_name, inputs):
                # Priority: Operator Input > Specific Rule > Step Spec > First Layer
                op_val = _parse_decimal(output_thickness_micron_input, "Output thickness_micron", allow_zero=False)
                if op_val:
                    return op_val

                rule = (rule_name or "").upper()
                if rule == "SUM_INPUTS":
                    return sum(Decimal(str(r.thickness_micron or 0)) for r in inputs)
                if rule == "INHERIT_INPUT":
                    return Decimal(str(inputs[0].thickness_micron or 0)) if inputs else Decimal("0")
                if step_roll_spec.get("fixed_thickness_micron") is not None:
                    return Decimal(str(step_roll_spec.get("fixed_thickness_micron")))
                return Decimal(str(output_thickness or 0))

            consumed_roll_ids = set()

            # 3. Output Creation + Roll Consumption (Behavior-Driven)
            if process.output_form == 'ROLL':
                def _find_active_output_roll(parent_roll=None):
                    qs = InventoryRoll.objects.filter(
                        created_by_job=job,
                        created_process=process,
                        current_step_index=job.current_step_index + 1,
                        status='AVAILABLE',
                        meta_json__roll_role="OUTPUT"
                    ).exclude(meta_json__is_remainder=True)
                    if parent_roll is not None:
                        qs = qs.filter(parent_roll=parent_roll)
                    return qs.order_by('-created_at').first()

                def _output_grade_required(material_obj):
                    return bool(
                        material_obj
                        and getattr(material_obj, "category", None) == "FILM_VARIANT"
                        and getattr(material_obj, "is_extrudable", False)
                    )

                def _roll_weight_breakdown(row, net_weight_kg: Decimal, path: str) -> dict:
                    payload = row if isinstance(row, dict) else {}
                    net = Decimal(str(net_weight_kg or 0))
                    tare_raw = payload.get("tare_weight_kg")
                    if tare_raw in (None, ""):
                        tare_raw = payload.get("core_tare_weight_kg")
                    tare = _parse_decimal(tare_raw, f"{path}.tare_weight_kg") if tare_raw not in (None, "") else Decimal("0")
                    gross_raw = payload.get("gross_weight_kg")
                    gross = _parse_decimal(gross_raw, f"{path}.gross_weight_kg") if gross_raw not in (None, "") else (net + tare)
                    if tare < 0:
                        raise ValueError(f"{path}.tare_weight_kg cannot be negative.")
                    if gross < net:
                        raise ValueError(f"{path}.gross_weight_kg cannot be less than net weight_kg.")
                    return {
                        "net_weight_kg": net,
                        "tare_weight_kg": tare,
                        "gross_weight_kg": gross,
                    }

                def _with_roll_weight_meta(meta: dict | None, breakdown: dict) -> dict:
                    payload = dict(meta or {})
                    payload["weight_breakdown"] = {
                        "net_weight_kg": float(breakdown["net_weight_kg"]),
                        "tare_weight_kg": float(breakdown["tare_weight_kg"]),
                        "gross_weight_kg": float(breakdown["gross_weight_kg"]),
                    }
                    return payload

                def _apply_roll_weight_breakdown(out_roll, breakdown: dict):
                    current_net = Decimal(str(getattr(out_roll, "net_weight_kg", None) or 0))
                    if current_net <= 0:
                        current_net = Decimal(str(getattr(out_roll, "weight_kg", 0) or 0)) - breakdown["net_weight_kg"]
                        if current_net < 0:
                            current_net = Decimal("0")
                    current_tare = Decimal(str(getattr(out_roll, "tare_weight_kg", 0) or 0))
                    current_gross = Decimal(str(getattr(out_roll, "gross_weight_kg", None) or 0))
                    if current_gross <= 0:
                        current_gross = current_net + current_tare
                    out_roll.net_weight_kg = current_net + breakdown["net_weight_kg"]
                    out_roll.tare_weight_kg = current_tare + breakdown["tare_weight_kg"]
                    out_roll.gross_weight_kg = current_gross + breakdown["gross_weight_kg"]
                    out_roll.meta_json = _with_roll_weight_meta(out_roll.meta_json, {
                        "net_weight_kg": out_roll.net_weight_kg,
                        "tare_weight_kg": out_roll.tare_weight_kg,
                        "gross_weight_kg": out_roll.gross_weight_kg,
                    })

                if roll_behavior == 'MODIFY_EXISTING':
                    if output_weight_kg <= 0:
                        raise ValueError("Produced weight must be > 0.")
                    roll = input_rolls[0]
                    input_weight = Decimal(str(roll.weight_kg or 0))
                    expected = output_weight_kg + scrap_qty
                    if expected > input_weight + Decimal('0.001'):
                        raise ValueError("Produced weight + scrap exceeds reserved input roll weight.")

                    usage = _consume_input_rolls_with_remainder(input_rolls, expected, "MODIFY_EXISTING")
                    consumed_roll_ids.update(str(item["parent_roll"].id) for item in usage)
                    _record_film_usage_actuals(usage, scrap_qty)

                    thickness_micron = _resolve_thickness(step_roll_spec.get("thickness_rule"), input_rolls)
                    width_mm = _resolve_width(step_roll_spec.get("width_rule"), input_rolls)
                    if width_mm is None and roll.width_mm is not None:
                        width_mm = Decimal(str(roll.width_mm))

                    out_material = output_material or roll.material
                    out_grade_id = output_grade_id or roll.grade_id
                    if not out_material:
                        raise ValueError("Output material is required for MODIFY_EXISTING.")
                    if _output_grade_required(out_material) and not out_grade_id:
                        raise ValueError("Output grade is required for MODIFY_EXISTING extrudable variant.")
                    if not _output_grade_required(out_material):
                        out_grade_id = None
                    if thickness_micron <= 0:
                        raise ValueError("Output thickness is required for MODIFY_EXISTING.")
                    if width_mm is None or width_mm <= 0:
                        raise ValueError("Output width is required for MODIFY_EXISTING.")

                    out_roll = _find_active_output_roll(parent_roll=roll)
                    weight_breakdown = _roll_weight_breakdown({}, output_weight_kg, "output_roll")
                    if out_roll:
                        out_roll.weight_kg += output_weight_kg
                        _apply_roll_weight_breakdown(out_roll, weight_breakdown)
                        if internal_stock_meta:
                            meta = dict(out_roll.meta_json or {})
                            meta.update(internal_stock_meta)
                            out_roll.meta_json = meta
                        out_roll.save(update_fields=['weight_kg', 'net_weight_kg', 'tare_weight_kg', 'gross_weight_kg', 'meta_json'])
                    else:
                        out_meta = dict(roll.meta_json or {})
                        if roll_spec:
                            out_meta.update({k: v for k, v in roll_spec.items() if v is not None})
                        out_meta.update({
                            "is_remainder": False,
                            "roll_role": "OUTPUT",
                            "source_behavior": "MODIFY_EXISTING",
                            "source_roll_label": roll.label_id,
                        })
                        out_meta.update(internal_stock_meta)
                        out_stock_form, out_width_basis = _resolve_output_stock_form_for_row(roll)

                        out_roll = InventoryRoll.objects.create(
                            label_id=_next_job_roll_label("MOD"),
                            material=out_material,
                            plant=job.work_center.plant if job.work_center else roll.plant,
                            production_job=job,
                            created_by_job=job,
                            created_process=process,
                            parent_roll=roll,
                            thickness_micron=thickness_micron,
                            width_mm=width_mm,
                            stock_form=out_stock_form,
                            width_basis=out_width_basis,
                            density_gcm3=cls._resolve_density_gcm3(material=out_material, roll=roll),
                            grade_id=out_grade_id,
                            weight_kg=output_weight_kg,
                            original_weight_kg=output_weight_kg,
                            net_weight_kg=weight_breakdown["net_weight_kg"],
                            tare_weight_kg=weight_breakdown["tare_weight_kg"],
                            gross_weight_kg=weight_breakdown["gross_weight_kg"],
                            status='AVAILABLE',
                            location_id=output_location_id,
                            stage_index=job.current_step_index + 1,
                            current_step_index=job.current_step_index + 1,
                            completed_step_index=job.current_step_index,
                            template=job.template,
                            sales_order_item=job.sales_order_item,
                            meta_json=_with_roll_weight_meta(out_meta, weight_breakdown),
                            is_fg=output_is_fg
                        )

                    link, created = RollLink.objects.get_or_create(
                        parent_roll=roll,
                        child_roll=out_roll,
                        defaults={'relation_type': 'PROCESS_OUTPUT', 'qty_used_kg': output_weight_kg}
                    )
                    if not created:
                        link.qty_used_kg += output_weight_kg
                        link.save(update_fields=['qty_used_kg'])

                elif roll_behavior == 'MULTI_INPUT_COMBINE':
                    if output_weight_kg <= 0:
                        raise ValueError("Produced weight must be > 0.")
                    expected = output_weight_kg + scrap_qty
                    if expected > total_input_weight + Decimal('0.001'):
                        raise ValueError("Produced weight + scrap exceeds total input roll weight.")

                    usage = _consume_input_rolls_with_remainder(
                        input_rolls,
                        expected,
                        "MULTI_INPUT_COMBINE",
                        consume_all_parents=True,
                    )
                    consumed_roll_ids.update(str(item["parent_roll"].id) for item in usage)
                    _record_film_usage_actuals(usage, scrap_qty)

                    # V2 deterministic combine physics is fixed:
                    # - output thickness = sum of input roll thicknesses
                    # - output width = minimum input width
                    width_candidates = [
                        Decimal(str(r.width_mm))
                        for r in input_rolls
                        if getattr(r, "width_mm", None) is not None
                    ]
                    width_mm = min(width_candidates) if width_candidates else Decimal("0")

                    thickness_micron = sum(
                        (Decimal(str(r.thickness_micron or 0)) for r in input_rolls),
                        Decimal("0"),
                    )
                    grade_id = output_grade_id or (input_rolls[0].grade_id if input_rolls else None)
                    material = output_material or (input_rolls[0].material if input_rolls else None)

                    if thickness_micron <= 0:
                        raise ValueError("Output thickness is required for MULTI_INPUT_COMBINE.")
                    if width_mm <= 0:
                        raise ValueError("Output width is required for MULTI_INPUT_COMBINE.")
                    if not material:
                        raise ValueError("Output material is required for MULTI_INPUT_COMBINE.")
                    if _output_grade_required(material) and not grade_id:
                        raise ValueError("Output grade is required for MULTI_INPUT_COMBINE extrudable variant.")
                    if not _output_grade_required(material):
                        grade_id = None

                    raw_roll_outputs = kwargs.get("roll_outputs") or []
                    parsed_roll_outputs = []
                    if isinstance(raw_roll_outputs, list):
                        for idx, row in enumerate(raw_roll_outputs, start=1):
                            if not isinstance(row, dict):
                                continue
                            row_width = _parse_decimal(row.get("width_mm"), f"roll_outputs[{idx}].width_mm")
                            row_weight = _parse_decimal(row.get("weight_kg"), f"roll_outputs[{idx}].weight_kg")
                            weight_breakdown = _roll_weight_breakdown(row, row_weight, f"roll_outputs[{idx}]")
                            parsed_roll_outputs.append({
                                "width_mm": row_width,
                                "weight_kg": row_weight,
                                "weight_breakdown": weight_breakdown,
                                "stock_form": row.get("stock_form"),
                                "width_basis": row.get("width_basis"),
                            })
                    if parsed_roll_outputs:
                        total_output_weight = sum((row["weight_kg"] for row in parsed_roll_outputs), Decimal("0"))
                        if abs(total_output_weight - output_weight_kg) > Decimal("0.001"):
                            raise ValueError("roll_outputs total weight must match actual output quantity.")

                    output_rows = parsed_roll_outputs or [{
                        "width_mm": width_mm,
                        "weight_kg": output_weight_kg,
                        "weight_breakdown": _roll_weight_breakdown({}, output_weight_kg, "output_roll"),
                        "stock_form": None,
                        "width_basis": None,
                    }]
                    reuse_active_output = not parsed_roll_outputs
                    created_rolls = []

                    for row in output_rows:
                        row_width_mm = row["width_mm"]
                        row_weight_kg = row["weight_kg"]
                        weight_breakdown = row["weight_breakdown"]
                        row_stock_form, row_width_basis = _resolve_output_stock_form_for_row(input_rolls[0] if input_rolls else None, row)
                        out_roll = _find_active_output_roll() if reuse_active_output else None
                        if out_roll:
                            out_roll.weight_kg += row_weight_kg
                            _apply_roll_weight_breakdown(out_roll, weight_breakdown)
                            if internal_stock_meta:
                                meta = dict(out_roll.meta_json or {})
                                meta.update(internal_stock_meta)
                                out_roll.meta_json = meta
                            out_roll.save(update_fields=['weight_kg', 'net_weight_kg', 'tare_weight_kg', 'gross_weight_kg', 'meta_json'])
                        else:
                            out_roll = InventoryRoll.objects.create(
                                label_id=_next_job_roll_label("COMB"),
                                material=material,
                                plant=job.work_center.plant if job.work_center else None,
                                production_job=job,
                                created_by_job=job,
                                created_process=process,
                                parent_roll=input_rolls[0],
                                thickness_micron=thickness_micron,
                                width_mm=row_width_mm,
                                stock_form=row_stock_form,
                                width_basis=row_width_basis,
                                density_gcm3=cls._resolve_density_gcm3(material=material, roll=input_rolls[0] if input_rolls else None),
                                grade_id=grade_id,
                                weight_kg=row_weight_kg,
                                original_weight_kg=row_weight_kg,
                                net_weight_kg=weight_breakdown["net_weight_kg"],
                                tare_weight_kg=weight_breakdown["tare_weight_kg"],
                                gross_weight_kg=weight_breakdown["gross_weight_kg"],
                                status='AVAILABLE',
                                location_id=output_location_id,
                                stage_index=job.current_step_index + 1,
                                current_step_index=job.current_step_index + 1,
                                completed_step_index=job.current_step_index,
                                template=job.template,
                                sales_order_item=job.sales_order_item,
                                meta_json=_with_roll_weight_meta({
                                    **(roll_spec or {}),
                                    "is_remainder": False,
                                    "roll_role": "OUTPUT",
                                    "source_behavior": "MULTI_INPUT_COMBINE",
                                    "lamination_pass_index": step_roll_spec.get("lamination_pass_index"),
                                    **internal_stock_meta,
                                }, weight_breakdown),
                                is_fg=output_is_fg
                            )
                        created_rolls.append((out_roll, row_weight_kg))

                    total_link_weight = sum((row_weight for _, row_weight in created_rolls), Decimal("0"))
                    for out_roll, row_weight_kg in created_rolls:
                        for item in usage:
                            parent = item["parent_roll"]
                            used_qty = item["used_qty_kg"]
                            link_qty = (used_qty * row_weight_kg / total_link_weight) if total_link_weight > 0 else Decimal("0")
                            link, created = RollLink.objects.get_or_create(
                                parent_roll=parent,
                                child_roll=out_roll,
                                defaults={'relation_type': 'MERGE', 'qty_used_kg': link_qty}
                            )
                            if not created:
                                link.qty_used_kg += link_qty
                                link.save(update_fields=['qty_used_kg'])

                elif roll_behavior == 'SPLIT':
                    if not isinstance(split_outputs, list) or len(split_outputs) == 0:
                        raise ValueError("Split outputs are required for SPLIT behavior.")

                    parent = input_rolls[0]
                    input_weight = Decimal(str(parent.weight_kg or 0))

                    parsed_outputs = []
                    total_output = Decimal('0')
                    for idx, out in enumerate(split_outputs, start=1):
                        width = _parse_decimal(out.get('width_mm'), f"split_outputs[{idx}].width_mm")
                        weight = _parse_decimal(out.get('weight_kg'), f"split_outputs[{idx}].weight_kg")
                        weight_breakdown = _roll_weight_breakdown(out, weight, f"split_outputs[{idx}]")
                        parsed_outputs.append({
                            'weight_kg': weight,
                            'width_mm': width,
                            'weight_breakdown': weight_breakdown,
                            'stock_form': out.get('stock_form'),
                            'width_basis': out.get('width_basis'),
                        })
                        total_output += weight

                    expected = total_output + scrap_qty
                    if expected > input_weight + Decimal('0.001'):
                        raise ValueError("Split outputs + scrap exceed input roll weight.")
                    if max_output_kg is not None and total_output > (max_output_kg + Decimal("0.001")):
                        raise ValueError(
                            f"Split output ({total_output:.3f} kg) exceeds max allowed for this step "
                            f"({max_output_kg:.3f} kg)."
                        )

                    remainder = input_weight - expected
                    for out in parsed_outputs:
                        weight_breakdown = out["weight_breakdown"]
                        out_stock_form, out_width_basis = _resolve_output_stock_form_for_row(parent, out)
                        child = InventoryRoll.objects.create(
                            label_id=_next_job_roll_label("SPL"),
                            material=parent.material,
                            plant=job.work_center.plant if job.work_center else None,
                            production_job=job,
                            created_by_job=job,
                            created_process=process,
                            parent_roll=parent,
                            thickness_micron=parent.thickness_micron,
                            width_mm=out['width_mm'],
                            stock_form=out_stock_form,
                            width_basis=out_width_basis,
                            density_gcm3=cls._resolve_density_gcm3(roll=parent),
                            grade_id=parent.grade_id,
                            weight_kg=out['weight_kg'],
                            original_weight_kg=out['weight_kg'],
                            net_weight_kg=weight_breakdown["net_weight_kg"],
                            tare_weight_kg=weight_breakdown["tare_weight_kg"],
                            gross_weight_kg=weight_breakdown["gross_weight_kg"],
                            status='AVAILABLE',
                            location_id=output_location_id,
                            stage_index=job.current_step_index + 1,
                            current_step_index=job.current_step_index + 1,
                            completed_step_index=job.current_step_index,
                            template=job.template,
                            sales_order_item=job.sales_order_item,
                            meta_json=_with_roll_weight_meta({
                                **(roll_spec or {}),
                                "is_remainder": False,
                                "roll_role": "SPLIT_OUTPUT",
                                "source_behavior": "SPLIT",
                                **internal_stock_meta,
                            }, weight_breakdown),
                            is_fg=output_is_fg
                        )
                        RollLink.objects.get_or_create(
                            parent_roll=parent,
                            child_roll=child,
                            defaults={'relation_type': 'SPLIT', 'qty_used_kg': out['weight_kg']}
                        )

                    if remainder > Decimal('0.001'):
                        _create_remainder_roll(parent, remainder, "SPLIT")

                    _record_film_usage_actuals(
                        [{
                            "parent_roll": parent,
                            "used_qty_kg": total_output,
                            "remainder_qty_kg": remainder if remainder > Decimal("0.001") else Decimal("0"),
                        }],
                        scrap_qty,
                    )

                    parent.status = 'CONSUMED'
                    parent.weight_kg = Decimal('0')
                    parent.save(update_fields=['status', 'weight_kg'])
                    consumed_roll_ids.add(str(parent.id))

                else:
                    # CREATE_NEW / fallback
                    raw_roll_outputs = kwargs.get("roll_outputs") or []
                    parsed_roll_outputs = []
                    if isinstance(raw_roll_outputs, list):
                        for idx, row in enumerate(raw_roll_outputs, start=1):
                            if not isinstance(row, dict):
                                continue
                            width = _parse_decimal(row.get("width_mm"), f"roll_outputs[{idx}].width_mm")
                            weight = _parse_decimal(row.get("weight_kg"), f"roll_outputs[{idx}].weight_kg")
                            weight_breakdown = _roll_weight_breakdown(row, weight, f"roll_outputs[{idx}]")
                            parsed_roll_outputs.append({
                                "width_mm": width,
                                "weight_kg": weight,
                                "weight_breakdown": weight_breakdown,
                                "stock_form": row.get("stock_form"),
                                "width_basis": row.get("width_basis"),
                            })

                    width_mm = _parse_decimal(output_width_mm, "Output width_mm")
                    if output_weight_kg <= 0:
                        raise ValueError("Produced weight must be > 0.")
                    if parsed_roll_outputs:
                        total_output_weight = sum((row["weight_kg"] for row in parsed_roll_outputs), Decimal("0"))
                        if abs(total_output_weight - output_weight_kg) > Decimal("0.001"):
                            raise ValueError("roll_outputs total weight must match actual output quantity.")
                        if max_output_kg is not None and total_output_weight > (max_output_kg + Decimal("0.001")):
                            raise ValueError(
                                f"Output ({total_output_weight:.3f} kg) exceeds max allowed for this step "
                                f"({max_output_kg:.3f} kg)."
                            )
                    elif width_mm is None or width_mm <= 0:
                        raise ValueError("Output width is required for CREATE_NEW.")

                    usage = []
                    if process.input_form == 'ROLL' and input_rolls:
                        usage = _consume_input_rolls_with_remainder(input_rolls, output_weight_kg + scrap_qty, "CREATE_NEW")
                        consumed_roll_ids.update(str(item["parent_roll"].id) for item in usage)
                        _record_film_usage_actuals(usage, scrap_qty)

                    parent_roll = input_rolls[0] if input_rolls else None
                    parent_meta = (parent_roll.meta_json or {}) if parent_roll else {}
                    out_meta = dict(parent_meta)
                    if roll_spec:
                        out_meta.update({k: v for k, v in roll_spec.items() if v is not None})

                    thickness_out = _resolve_thickness(step_roll_spec.get("thickness_rule"), input_rolls)
                    if thickness_out <= 0 and parent_roll:
                        thickness_out = Decimal(str(parent_roll.thickness_micron or 0))
                    grade_out = output_grade_id or (parent_roll.grade_id if parent_roll else None)
                    material_out = output_material or (parent_roll.material if parent_roll else None)

                    if not material_out:
                        raise ValueError("Output material could not be resolved for CREATE_NEW roll.")
                    if thickness_out <= 0:
                        raise ValueError("Output thickness is required for CREATE_NEW roll.")
                    if _output_grade_required(material_out) and not grade_out:
                        raise ValueError("Output grade is required for CREATE_NEW extrudable variant.")
                    if not _output_grade_required(material_out):
                        grade_out = None

                    output_rows = parsed_roll_outputs or [{
                        "width_mm": width_mm,
                        "weight_kg": output_weight_kg,
                        "weight_breakdown": _roll_weight_breakdown({}, output_weight_kg, "output_roll"),
                        "stock_form": None,
                        "width_basis": None,
                    }]
                    created_rolls = []
                    reuse_active_output = not parsed_roll_outputs

                    for row in output_rows:
                        row_width_mm = row["width_mm"]
                        row_weight_kg = row["weight_kg"]
                        weight_breakdown = row["weight_breakdown"]
                        row_stock_form, row_width_basis = _resolve_output_stock_form_for_row(parent_roll, row)
                        out_roll = _find_active_output_roll(parent_roll=parent_roll) if reuse_active_output else None
                        if out_roll:
                            out_roll.weight_kg += row_weight_kg
                            _apply_roll_weight_breakdown(out_roll, weight_breakdown)
                            if internal_stock_meta:
                                meta = dict(out_roll.meta_json or {})
                                meta.update(internal_stock_meta)
                                out_roll.meta_json = meta
                            out_roll.save(update_fields=['weight_kg', 'net_weight_kg', 'tare_weight_kg', 'gross_weight_kg', 'meta_json'])
                        else:
                            out_roll = InventoryRoll.objects.create(
                                label_id=_next_job_roll_label("NEW"),
                                material=material_out,
                                plant=job.work_center.plant if job.work_center else None,
                                production_job=job,
                                created_by_job=job,
                                created_process=process,
                                parent_roll=parent_roll,
                                thickness_micron=thickness_out,
                                width_mm=row_width_mm,
                                stock_form=row_stock_form,
                                width_basis=row_width_basis,
                                density_gcm3=cls._resolve_density_gcm3(material=material_out, roll=parent_roll),
                                grade_id=grade_out,
                                weight_kg=row_weight_kg,
                                original_weight_kg=row_weight_kg,
                                net_weight_kg=weight_breakdown["net_weight_kg"],
                                tare_weight_kg=weight_breakdown["tare_weight_kg"],
                                gross_weight_kg=weight_breakdown["gross_weight_kg"],
                                status='AVAILABLE',
                                location_id=output_location_id,
                                stage_index=job.current_step_index + 1,
                                current_step_index=job.current_step_index + 1,
                                completed_step_index=job.current_step_index,
                                template=job.template,
                                sales_order_item=job.sales_order_item,
                                meta_json=_with_roll_weight_meta({
                                    **out_meta,
                                    "is_remainder": False,
                                    "roll_role": "OUTPUT",
                                    "source_behavior": "CREATE_NEW",
                                    **internal_stock_meta,
                                }, weight_breakdown),
                                is_fg=output_is_fg
                            )
                        created_rolls.append((out_roll, row_weight_kg))

                    total_link_weight = sum((row_weight for _, row_weight in created_rolls), Decimal("0"))
                    for out_roll, row_weight_kg in created_rolls:
                        for item in usage:
                            parent = item["parent_roll"]
                            used_qty = item["used_qty_kg"]
                            if total_link_weight > 0:
                                link_qty = (used_qty * row_weight_kg) / total_link_weight
                            else:
                                link_qty = Decimal("0")
                            link, created = RollLink.objects.get_or_create(
                                parent_roll=parent,
                                child_roll=out_roll,
                                defaults={'relation_type': 'PROCESS_OUTPUT', 'qty_used_kg': link_qty}
                            )
                            if not created:
                                link.qty_used_kg += link_qty
                                link.save(update_fields=['qty_used_kg'])

            elif process.output_form == 'BULK':
                terminal_pouch_fg_bulk = cls._is_terminal_pouch_fg_bulk_step(job, process=process)
                roll_to_bulk_output_policy = cls._roll_to_bulk_output_policy(
                    job,
                    process=process,
                    step_roll_spec=step_roll_spec,
                )
                if str(process.input_form or "").upper() == "ROLL":
                    g_snap = cls._job_geometry_snapshot(job) or {}
                    base = g_snap.get("base") if isinstance(g_snap, dict) else {}
                    if not isinstance(base, dict):
                        base = g_snap if isinstance(g_snap, dict) else {}

                    def _num(payload, keys):
                        for key in keys:
                            value = payload.get(key) if isinstance(payload, dict) else None
                            if value in (None, ""):
                                continue
                            try:
                                return Decimal(str(value))
                            except Exception:
                                continue
                        return Decimal("0")

                    effective = g_snap.get("effective") if isinstance(g_snap, dict) else {}
                    if not isinstance(effective, dict):
                        effective = {}
                    eff_width = _num(effective, ["width_mm", "width"]) or _num(base, ["width_mm", "width"])
                    eff_height = _num(effective, ["height_mm", "height"]) or _num(base, ["height_mm", "height"])
                    if (eff_width or Decimal("0")) <= 0 or (eff_height or Decimal("0")) <= 0:
                        raise ValueError("Effective sales-order pouch geometry is required for roll-to-bulk logging.")

                    for src_roll in input_rolls:
                        try:
                            roll_width = Decimal(str(src_roll.width_mm or 0))
                        except Exception:
                            roll_width = Decimal("0")
                        if roll_width > 0 and eff_width > 0 and roll_width < (eff_width - Decimal("0.001")):
                            raise ValueError(
                                f"Input roll width ({roll_width} mm) is smaller than required pouch width ({eff_width} mm)."
                            )

                if process.input_form == 'ROLL' and input_rolls:
                    if output_weight_kg <= 0:
                        raise ValueError("Output weight must be > 0 for roll consumption.")
                    expected_roll_consumption = output_weight_kg + scrap_qty
                    if len(input_rolls) > 1 and expected_roll_consumption < (total_input_weight - Decimal('0.001')):
                        raise ValueError(
                            "ROLL->BULK with multiple reserved rolls must consume all reserved roll weight. "
                            "Increase output/scrap or unreserve unused rolls."
                        )
                    usage = _consume_input_rolls_with_remainder(input_rolls, expected_roll_consumption, "ROLL_TO_BULK")
                    consumed_roll_ids.update(str(item["parent_roll"].id) for item in usage)
                    _record_film_usage_actuals(usage, scrap_qty)
                    _record_roll_consumption_rows(
                        usage,
                        output_roll=None,
                        output_kg_total=output_weight_kg,
                        scrap_qty_total=scrap_qty,
                    )

                batch_count = FinishedGoodsBatch.objects.filter(production_job=job).count() + 1
                batch_no = f"BATCH-{job.job_number}-{batch_count:03d}"

                # Always capture both KG + PCS for roll->bulk style execution.
                output_pcs = kwargs.get("output_pcs")
                if output_pcs in ("", None):
                    output_pcs = None
                if output_pcs is not None:
                    try:
                        output_pcs = int(output_pcs)
                    except (ValueError, TypeError):
                        raise ValueError("output_pcs must be a whole number.")
                    if output_pcs < 0:
                        raise ValueError("output_pcs cannot be negative.")

                theoretical_pcs = None
                if unit_weight_g > 0:
                    theoretical_pcs = (output_weight_kg * Decimal("1000")) / unit_weight_g

                # If operator provides PCS, validate against KG physics.
                if output_pcs is not None and theoretical_pcs is not None:
                    delta = abs(Decimal(output_pcs) - theoretical_pcs)
                    allowed_delta = max(Decimal("2"), (theoretical_pcs * Decimal("0.03")))
                    if delta > allowed_delta:
                        raise ValueError(
                            f"output_pcs ({output_pcs}) does not align with output_weight_kg "
                            f"({output_weight_kg:.3f} kg). Expected approx {int(theoretical_pcs)} pcs."
                        )

                # For roll->bulk execution we require operator PCS + KG entry
                # and validate both together (no silent PCS auto-fill).
                if (
                    str(process.input_form or "").upper() == "ROLL"
                    and terminal_pouch_fg_bulk
                    and roll_to_bulk_output_policy.get("requires_output_pcs")
                    and output_pcs is None
                ):
                    raise ValueError("output_pcs is required for roll-to-bulk output logging.")

                # Legacy fallback for non roll-input bulk steps.
                # Never coerce KG directly into PCS (that causes 1kg => 1pcs errors).
                if (
                    output_pcs is None
                    and theoretical_pcs is not None
                    and terminal_pouch_fg_bulk
                    and not roll_to_bulk_output_policy.get("allows_kg_only")
                ):
                    output_pcs = int(theoretical_pcs.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
                if output_pcs is None and str(job.uom or 'KG').upper() == 'PCS' and terminal_pouch_fg_bulk:
                    raise ValueError("output_pcs is required for PCS-tracked bulk output.")

                fg_batch = None
                primary_pack_runtime_meta = None
                if terminal_pouch_fg_bulk:
                    packaging_snapshot = cls._job_packaging_snapshot(job) or {}
                    primary_pack = (packaging_snapshot or {}).get("primary_inner_pack") or {}
                    if bool(primary_pack.get("enabled")) and output_pcs is None:
                        raise ValueError("output_pcs is required when primary inner-pack packaging is enabled.")
                if terminal_pouch_fg_bulk and int(output_pcs or 0) > 0:
                    packaging_snapshot = cls._job_packaging_snapshot(job) or {}
                    primary_pack = (packaging_snapshot or {}).get("primary_inner_pack") or {}
                    if bool(primary_pack.get("enabled")):
                        material_id = primary_pack.get("material_id")
                        try:
                            pcs_per_pack = int(primary_pack.get("pcs_per_pack") or 0)
                        except Exception:
                            pcs_per_pack = 0
                        if not material_id:
                            raise ValueError("Packaging config missing primary_inner_pack.material_id.")
                        if pcs_per_pack <= 0:
                            raise ValueError("Packaging config primary_inner_pack.pcs_per_pack must be > 0.")
                        packs_needed = (int(output_pcs) + pcs_per_pack - 1) // pcs_per_pack
                        primary_pack_runtime_meta = {
                            "enabled": True,
                            "material_id": str(material_id),
                            "pcs_per_pack": pcs_per_pack,
                            "pack_count": packs_needed,
                            "consumed_at_fg": True,
                            "source": "FINAL_STEP",
                        }

                if terminal_pouch_fg_bulk:
                    fg_batch_meta = dict(internal_stock_meta or {})
                    fg_batch_meta["output_capture_policy"] = {
                        "effective_mode": roll_to_bulk_output_policy.get("effective_mode"),
                        "requires_output_pcs": bool(roll_to_bulk_output_policy.get("requires_output_pcs")),
                        "allows_kg_only": bool(roll_to_bulk_output_policy.get("allows_kg_only")),
                    }
                    fg_batch_meta["primary_uom"] = "KG" if roll_to_bulk_output_policy.get("allows_kg_only") and output_pcs is None else "PCS"
                    if primary_pack_runtime_meta:
                        fg_batch_meta["primary_inner_pack"] = primary_pack_runtime_meta
                    fg_batch = FinishedGoodsBatch.objects.create(
                        batch_number=batch_no,
                        qty_kg=output_weight_kg,  # Always capture weight
                        qty_pcs=output_pcs or 0,  # Always capture pieces
                        geometry_override=order_geometry_override,
                        meta_json=fg_batch_meta,
                        completed_step_index=job.current_step_index,
                        production_job=job,
                        sales_order_item=job.sales_order_item,
                        status='AVAILABLE',
                        location_id=output_location_id,
                        template=job.template
                    )

                # Primary inner-pack consumption is enforced at terminal pouch FG creation.
                if fg_batch and primary_pack_runtime_meta:
                    from apps.inventory.services.packaging_service import PackagingService

                    so_number = (
                        job.sales_order_item.sales_order.order_number
                        if getattr(job, "sales_order_item", None) and getattr(job.sales_order_item, "sales_order", None)
                        else "N/A"
                    )
                    reference = f"SO:{so_number} JOB:{job.job_number} FG_BATCH:{fg_batch.batch_number}"
                    PackagingService.consume_packaging_stock(
                        material_id=primary_pack_runtime_meta["material_id"],
                        qty=primary_pack_runtime_meta["pack_count"],
                        input_uom="PCS",
                        location_id=output_location_id,
                        job_id=job.id,
                        sales_order_item_id=getattr(job, "sales_order_item_id", None),
                        mts_order_id=getattr(job, "mts_order_id", None),
                        reference=reference,
                        basis="PER_PACK",
                        meta_json={
                            "fg_batch_id": str(fg_batch.id),
                            "applied_at": "FG_CREATION",
                            "pack_count": primary_pack_runtime_meta["pack_count"],
                        },
                    )

            # 4. Waste log (operator input). New machine terminal clients send
            # trim and process scrap separately; legacy clients still send only
            # scrap_qty and retain the old aggregate log shape.
            if split_waste_supplied:
                if trim_qty and trim_qty > 0:
                    from apps.production.models import ScrapLog
                    ScrapLog.objects.create(
                        production_job=job,
                        quantity=trim_qty,
                        uom='KG',
                        reason='TRIM',
                        notes='Operator trim entry',
                        logged_by=user
                    )
                if process_scrap_qty and process_scrap_qty > 0:
                    from apps.production.models import ScrapLog
                    ScrapLog.objects.create(
                        production_job=job,
                        quantity=process_scrap_qty,
                        uom='KG',
                        reason='DEFECT',
                        notes='Operator scrap entry',
                        logged_by=user
                    )
            elif scrap_qty and scrap_qty > 0:
                from apps.production.models import ScrapLog
                ScrapLog.objects.create(
                    production_job=job,
                    quantity=scrap_qty,
                    uom='KG',
                    reason='OTHER',
                    notes='Operator scrap entry',
                    logged_by=user
                )

            # 5. Close roll reservations precisely (no phantom fulfillment)
            for res in reservations_to_use:
                if res.roll_id and str(res.roll_id) in consumed_roll_ids:
                    res.status = 'FULFILLED'
                    res.save(update_fields=['status'])
                    continue
                # Reservation was not used in this event.
                if res.roll and res.roll.status != 'CONSUMED':
                    # Release any untouched roll back to free stock, even when
                    # machine start marked it IN_PROCESS.
                    _release_unused_reserved_roll(res.roll)
                res.status = 'RELEASED'
                res.save(update_fields=['status'])
            for res in extra_reservations:
                # Release unused reservations
                if res.roll and res.roll.status != 'CONSUMED':
                    _release_unused_reserved_roll(res.roll)
                res.status = 'RELEASED'
                res.save(update_fields=['status'])

            # PACKAGING-purpose stock orders credit PackagingStock at terminal completion.
            if packaging_purpose_job and cls._is_terminal_order_step(job):
                mts_order = getattr(job, "mts_order", None)
                packaging_material = getattr(mts_order, "packaging_material", None) if mts_order else None
                if packaging_material:
                    base_uom = str(packaging_material.base_uom or "").upper()
                    produced_qty = Decimal("0")
                    if base_uom == "KG":
                        produced_qty = Decimal(str(output_weight_kg or 0))
                    elif base_uom == "PCS":
                        output_pcs_value = kwargs.get("output_pcs")
                        if output_pcs_value in (None, ""):
                            raise ValueError("output_pcs is required to post PACKAGING stock in PCS.")
                        produced_qty = Decimal(str(int(output_pcs_value)))
                    if produced_qty > 0:
                        from apps.inventory.services.packaging_service import PackagingService
                        reference = f"STOCK_ORDER:{mts_order.order_number} JOB:{job.job_number}"
                        PackagingService.add_packaging_stock(
                            material_id=packaging_material.id,
                            qty=produced_qty,
                            input_uom=base_uom,
                            location_id=output_location_id,
                            job_id=job.id,
                            mts_order_id=mts_order.id,
                            reference=reference,
                            tx_type="PRODUCE",
                            meta_json={
                                "stock_purpose": "PACKAGING",
                                "is_internal_stock": True,
                                "process_code": getattr(process, "code", None),
                            },
                        )
                              
        return cls.get_job_context(job_id)
