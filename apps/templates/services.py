from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.factory.models import Process, WorkCenter, WorkCenterProcess

from .models import (
    TemplateBlueprint,
    TemplateProcessStep,
    TemplateProcessStepMaterial,
    TemplateProcessStepRollSpec,
)


class RouteDispatchError(ValueError):
    def __init__(self, message, *, candidates=None, template_step=None):
        super().__init__(message)
        self.candidates = candidates or []
        self.template_step = template_step


class TemplateDispatchService:
    AUTO_IF_SINGLE = "AUTO_IF_SINGLE"
    AUTO_DEFAULT = "AUTO_DEFAULT"
    PLANNER_REQUIRED = "PLANNER_REQUIRED"

    @staticmethod
    def normalize_work_center_ids(values):
        if not isinstance(values, list):
            return []
        seen = set()
        normalized = []
        for value in values:
            text = str(value or "").strip()
            if text and text not in seen:
                seen.add(text)
                normalized.append(text)
        return normalized

    @classmethod
    def candidate_work_centers(cls, process, *, plant=None):
        if not process:
            return []
        qs = (
            WorkCenterProcess.objects.select_related("work_center", "work_center__plant")
            .filter(process=process)
            .order_by("work_center__plant__code", "work_center__code", "work_center__name")
        )
        if plant is not None:
            qs = qs.filter(work_center__plant=plant)
        return [row.work_center for row in qs]

    @classmethod
    def get_template_step(cls, *, template, step_index, process=None):
        if not template:
            return None
        qs = TemplateProcessStep.objects.select_related(
            "process",
            "default_work_center",
            "default_work_center__plant",
        ).filter(
            template=template,
            sequence_number=int(step_index or 0) + 1,
            is_removed_from_route=False,
        )
        if process is not None:
            qs = qs.filter(process=process)
        return qs.first()

    @classmethod
    def serialize_work_center(cls, wc):
        if not wc:
            return None
        plant = getattr(wc, "plant", None)
        return {
            "id": str(wc.id),
            "code": wc.code,
            "name": wc.name,
            "plant_id": str(getattr(plant, "id", "") or ""),
            "plant_code": getattr(plant, "code", "") or "",
            "plant_name": getattr(plant, "name", "") or "",
            "label": f"{getattr(plant, 'code', '') or 'Plant'} / {wc.code} - {wc.name}",
        }

    @classmethod
    def step_status(cls, step, *, plant=None):
        candidates = cls.candidate_work_centers(step.process, plant=plant)
        candidate_ids = {str(wc.id) for wc in candidates}
        allowed_ids = cls.normalize_work_center_ids(getattr(step, "allowed_work_center_ids", None) or [])
        configured_default_id = str(getattr(step, "default_work_center_id", "") or "")
        filtered = [wc for wc in candidates if not allowed_ids or str(wc.id) in set(allowed_ids)]
        default_valid = bool(configured_default_id and configured_default_id in {str(wc.id) for wc in filtered})
        policy = str(getattr(step, "work_center_selection_policy", "") or cls.AUTO_IF_SINGLE).upper()
        if not candidates:
            status = "NO_CAPABILITY"
        elif allowed_ids and not filtered:
            status = "INVALID_ALLOWED_WORK_CENTERS"
        elif configured_default_id and configured_default_id not in candidate_ids:
            status = "INVALID_DEFAULT_WORK_CENTER"
        elif default_valid:
            status = "CONFIGURED"
        elif len(filtered) == 1 and policy != cls.PLANNER_REQUIRED:
            status = "AUTO_RESOLVABLE"
        elif len(filtered) > 1:
            status = "NEEDS_DECISION"
        else:
            status = "NO_CAPABILITY"
        return {
            "status": status,
            "candidate_count": len(candidates),
            "filtered_candidate_count": len(filtered),
            "candidates": [cls.serialize_work_center(wc) for wc in candidates],
            "valid_candidates": [cls.serialize_work_center(wc) for wc in filtered],
            "allowed_work_center_ids": allowed_ids,
            "default_work_center": cls.serialize_work_center(getattr(step, "default_work_center", None)),
            "default_work_center_valid": default_valid,
            "selection_policy": policy,
        }

    @classmethod
    def resolve_work_center(cls, process, *, plant=None, template=None, step_index=None, strict=True):
        step = cls.get_template_step(template=template, step_index=step_index, process=process)
        candidates = cls.candidate_work_centers(process, plant=plant)
        allowed_ids = cls.normalize_work_center_ids(getattr(step, "allowed_work_center_ids", None) or []) if step else []
        policy = str(getattr(step, "work_center_selection_policy", "") or cls.AUTO_IF_SINGLE).upper() if step else cls.AUTO_IF_SINGLE
        default_id = str(getattr(step, "default_work_center_id", "") or "") if step else ""
        filtered = [wc for wc in candidates if not allowed_ids or str(wc.id) in set(allowed_ids)]

        if default_id:
            default_wc = next((wc for wc in filtered if str(wc.id) == default_id), None)
            if default_wc:
                return default_wc
            if strict:
                label = getattr(process, "code", "UNKNOWN")
                raise RouteDispatchError(
                    f"Route dispatch default work center is invalid for process {label}. Update Route Dispatch Setup.",
                    candidates=[cls.serialize_work_center(wc) for wc in candidates],
                    template_step=step,
                )

        if len(filtered) == 1 and policy != cls.PLANNER_REQUIRED:
            return filtered[0]

        if not candidates:
            if strict:
                raise RouteDispatchError(
                    f"No work center capability is mapped for process {getattr(process, 'code', 'UNKNOWN')}.",
                    candidates=[],
                    template_step=step,
                )
            return None

        if not filtered:
            if strict:
                raise RouteDispatchError(
                    f"Route dispatch allow-list leaves no valid work center for process {getattr(process, 'code', 'UNKNOWN')}.",
                    candidates=[cls.serialize_work_center(wc) for wc in candidates],
                    template_step=step,
                )
            return None

        if strict:
            step_label = f"step {int(step_index or 0) + 1}" if step_index is not None else "route step"
            raise RouteDispatchError(
                f"Route dispatch needs a work center decision for {getattr(process, 'code', 'UNKNOWN')} at {step_label}.",
                candidates=[cls.serialize_work_center(wc) for wc in filtered],
                template_step=step,
            )
        return filtered[0]

    @classmethod
    def update_step_dispatch(cls, step, *, allowed_work_center_ids=None, default_work_center_id=None, selection_policy=None, notes=None):
        allowed_ids = cls.normalize_work_center_ids(allowed_work_center_ids or [])
        if allowed_ids:
            valid_ids = {
                str(wc.id)
                for wc in cls.candidate_work_centers(step.process)
            }
            invalid = [wc_id for wc_id in allowed_ids if wc_id not in valid_ids]
            if invalid:
                raise ValidationError(f"Allowed work center is not capable for {step.process.code}: {', '.join(invalid)}")
        default_id = str(default_work_center_id or "").strip()
        if default_id:
            default_wc = WorkCenter.objects.filter(id=default_id).first()
            if not default_wc:
                raise ValidationError("Default work center does not exist.")
            capable_ids = {str(wc.id) for wc in cls.candidate_work_centers(step.process)}
            if default_id not in capable_ids:
                raise ValidationError(f"Default work center cannot run {step.process.code}.")
            if allowed_ids and default_id not in allowed_ids:
                allowed_ids.append(default_id)
            step.default_work_center = default_wc
        else:
            step.default_work_center = None
        if selection_policy:
            policy = str(selection_policy).upper()
            valid_policies = {choice[0] for choice in TemplateProcessStep.WORK_CENTER_SELECTION_POLICIES}
            if policy not in valid_policies:
                raise ValidationError("Invalid work center selection policy.")
            step.work_center_selection_policy = policy
        step.allowed_work_center_ids = allowed_ids
        if notes is not None:
            step.dispatch_notes = str(notes or "")
        step.dispatch_updated_at = timezone.now()
        step.save(update_fields=[
            "allowed_work_center_ids",
            "default_work_center",
            "work_center_selection_policy",
            "dispatch_notes",
            "dispatch_updated_at",
            "updated_at",
        ])
        return step

    @classmethod
    def audit_steps(cls, *, include_obsolete=False, include_samples=False):
        qs = TemplateProcessStep.objects.select_related(
            "template",
            "process",
            "default_work_center",
            "default_work_center__plant",
        ).filter(is_removed_from_route=False).order_by("process__code", "template__name", "sequence_number")
        if not include_obsolete:
            qs = qs.exclude(template__status="OBSOLETE")
        if not include_samples:
            qs = qs.exclude(template__name__startswith="TEST_").exclude(template__name__startswith="CODEX_SAMPLE")
        rows = []
        for step in qs:
            status = cls.step_status(step)
            rows.append({
                "step_id": str(step.id),
                "template_id": str(step.template_id),
                "template_name": step.template.name,
                "template_status": step.template.status,
                "sequence_number": step.sequence_number,
                "process_id": str(step.process_id),
                "process_code": step.process.code,
                "process_name": step.process.name,
                "dispatch_notes": step.dispatch_notes,
                **status,
            })
        return rows

    @classmethod
    def backfill_auto_resolvable_steps(cls, *, apply=False, include_samples=False):
        rows = cls.audit_steps(include_samples=include_samples)
        changed = 0
        for row in rows:
            if row["status"] != "AUTO_RESOLVABLE" or row["allowed_work_center_ids"] or row["default_work_center"]:
                continue
            valid = row["valid_candidates"]
            if len(valid) != 1:
                continue
            if apply:
                step = TemplateProcessStep.objects.select_related("process").get(id=row["step_id"])
                cls.update_step_dispatch(
                    step,
                    allowed_work_center_ids=[valid[0]["id"]],
                    default_work_center_id=valid[0]["id"],
                    selection_policy=cls.AUTO_DEFAULT,
                    notes=step.dispatch_notes or "Auto-filled from the only capable work center.",
                )
            changed += 1
        return {"eligible": changed, "applied": changed if apply else 0}


class TemplateGovernanceService:
    SUPPORTED_CATEGORY_CODES = {"GRANULE", "ADHESIVE", "SOLVENT", "ADDON", "POD"}

    @staticmethod
    def lock_field(template_id: str, field_name: str):
        # Legacy lock model removed in V2 hard-cut.
        return None

    @staticmethod
    def unlock_field(template_id: str, field_name: str):
        # Legacy lock model removed in V2 hard-cut.
        return None

    @staticmethod
    def set_routing(template_id: str, routing_rule_id: str):
        template = TemplateBlueprint.objects.get(id=template_id)
        if template.status == "LIVE":
            raise ValidationError("Cannot change routing on a LIVE template.")
        template.routing_rule_id = routing_rule_id
        template.save(update_fields=["routing_rule"])

    @staticmethod
    def default_roll_handling_for_step(step):
        process = step.process
        behavior = (getattr(process, "roll_behavior", None) or "NONE").upper()
        input_form = (getattr(process, "input_form", None) or "BULK").upper()
        output_form = (getattr(process, "output_form", None) or "ROLL").upper()

        defaults = {
            "input_roll_count": 0,
            "combine_mode": "STRICT_ROLL_COUNT",
            "input_lane_count": 0,
            "lamination_pass_index": 0,
            "active_min_layer_count": 0,
            "adhesive_split_pct": 0,
            "solvent_split_pct": 0,
            "lane_schema": [],
            "thickness_rule": "TEMPLATE_DEFAULT",
            "width_rule": "TEMPLATE_DEFAULT",
            "operator_entry_mode": "PROCESS_DEFAULT",
            "notes": "",
        }

        if behavior == "CREATE_NEW":
            defaults["input_roll_count"] = 1 if input_form == "ROLL" else 0
            defaults["thickness_rule"] = "FIXED"
            defaults["width_rule"] = "OPERATOR"
            defaults["operator_entry_mode"] = "ROLL_MULTI"
        elif behavior == "MODIFY_EXISTING":
            defaults["input_roll_count"] = 1
            defaults["thickness_rule"] = "INHERIT_INPUT"
            defaults["width_rule"] = "LOCK_INPUT"
        elif behavior == "MULTI_INPUT_COMBINE":
            defaults["input_roll_count"] = 2
            defaults["combine_mode"] = "LANE_GROUPS"
            defaults["input_lane_count"] = 2
            defaults["active_min_layer_count"] = 2
            defaults["thickness_rule"] = "SUM_INPUTS"
            defaults["width_rule"] = "MIN_INPUT"
        elif behavior == "SPLIT":
            defaults["input_roll_count"] = 1
            defaults["thickness_rule"] = "INHERIT_INPUT"
            defaults["width_rule"] = "OPERATOR_GRID"
            defaults["operator_entry_mode"] = "GRID_SPLIT"
        elif behavior == "NONE" and input_form == "ROLL" and output_form == "BULK":
            defaults["input_roll_count"] = 1
            defaults["operator_entry_mode"] = "KG_AND_PCS"
        return defaults

    @staticmethod
    def route_sync_plan(template: TemplateBlueprint):
        ordered_codes = list(template.routing_rule.ordered_processes if template.routing_rule else [])
        processes = {p.code: p for p in Process.objects.filter(code__in=ordered_codes)}
        existing_steps = list(
            template.process_steps.select_related("process").all().order_by("sequence_number", "created_at")
        )
        active_steps = [step for step in existing_steps if not step.is_removed_from_route]
        unmatched_existing = list(active_steps)
        matched_steps = []
        created_defs = []

        for seq, code in enumerate(ordered_codes, start=1):
            proc = processes.get(code)
            chosen = None
            exact = next(
                (
                    step
                    for step in unmatched_existing
                    if step.sequence_number == seq and step.process_id == getattr(proc, "id", None)
                ),
                None,
            )
            if exact:
                chosen = exact
            elif proc is not None:
                same_process = next((step for step in unmatched_existing if step.process_id == proc.id), None)
                if same_process:
                    chosen = same_process

            if chosen:
                unmatched_existing.remove(chosen)
                matched_steps.append(
                    {
                        "existing_step": chosen,
                        "target_sequence": seq,
                        "process": proc,
                    }
                )
            elif proc is not None:
                created_defs.append(
                    {
                        "target_sequence": seq,
                        "process": proc,
                    }
                )

        stale_steps = unmatched_existing
        return {
            "matched_steps": matched_steps,
            "created_defs": created_defs,
            "stale_steps": stale_steps,
            "ordered_codes": ordered_codes,
        }

    @staticmethod
    def serialize_route_sync_preview(plan):
        return {
            "steps_to_keep": [
                {
                    "step_id": str(row["existing_step"].id),
                    "from_sequence": row["existing_step"].sequence_number,
                    "to_sequence": row["target_sequence"],
                    "process_name": row["process"].name,
                    "process_code": row["process"].code,
                    "will_reorder": row["existing_step"].sequence_number != row["target_sequence"],
                }
                for row in plan["matched_steps"]
            ],
            "steps_to_create": [
                {
                    "target_sequence": row["target_sequence"],
                    "process_name": row["process"].name,
                    "process_code": row["process"].code,
                }
                for row in plan["created_defs"]
            ],
            "steps_to_mark_removed": [
                {
                    "step_id": str(step.id),
                    "sequence_number": step.sequence_number,
                    "process_name": step.process.name,
                    "process_code": step.process.code,
                }
                for step in plan["stale_steps"]
            ],
        }

    @staticmethod
    def apply_route_sync(template: TemplateBlueprint, *, destructive: bool = False):
        plan = TemplateGovernanceService.route_sync_plan(template)
        created_steps = []
        kept_steps = []

        if destructive:
            template.process_steps.all().delete()
            for row in plan["created_defs"] + plan["matched_steps"]:
                proc = row["process"]
                seq = row["target_sequence"]
                step = TemplateProcessStep.objects.create(
                    template=template,
                    sequence_number=seq,
                    process=proc,
                    is_removed_from_route=False,
                )
                TemplateProcessStepRollSpec.objects.get_or_create(
                    template_step=step,
                    defaults=TemplateGovernanceService.default_roll_handling_for_step(step),
                )
                created_steps.append(step)
            return {"created_steps": created_steps, "kept_steps": kept_steps, "stale_steps": []}

        for row in plan["matched_steps"]:
            step = row["existing_step"]
            step.sequence_number = row["target_sequence"]
            step.process = row["process"]
            step.is_removed_from_route = False
            step.save(update_fields=["sequence_number", "process", "is_removed_from_route", "updated_at"])
            TemplateProcessStepRollSpec.objects.get_or_create(
                template_step=step,
                defaults=TemplateGovernanceService.default_roll_handling_for_step(step),
            )
            kept_steps.append(step)

        for row in plan["created_defs"]:
            step = TemplateProcessStep.objects.create(
                template=template,
                sequence_number=row["target_sequence"],
                process=row["process"],
                is_removed_from_route=False,
            )
            TemplateProcessStepRollSpec.objects.get_or_create(
                template_step=step,
                defaults=TemplateGovernanceService.default_roll_handling_for_step(step),
            )
            created_steps.append(step)

        for step in plan["stale_steps"]:
            step.is_removed_from_route = True
            if "[STALE ROUTE STEP]" not in step.notes:
                step.notes = f"[STALE ROUTE STEP] {step.notes}".strip()
            step.save(update_fields=["is_removed_from_route", "notes", "updated_at"])

        return {
            "created_steps": created_steps,
            "kept_steps": kept_steps,
            "stale_steps": plan["stale_steps"],
        }

    @staticmethod
    def _require_routing_rule(template: TemplateBlueprint):
        if not template.routing_rule_id:
            raise ValidationError("Templates cannot be approved or published without a Routing Rule.")

    @staticmethod
    def _ensure_live_ready_workflow(template: TemplateBlueprint):
        TemplateGovernanceService.apply_route_sync(template, destructive=False)
        active_steps = template.process_steps.filter(is_removed_from_route=False)
        if not active_steps.exists():
            raise ValidationError("Sync workflow first. A LIVE template must contain at least one active route step.")
        readiness = TemplateGovernanceService.readiness(template)
        if not readiness["ready"]:
            raise ValidationError("; ".join(readiness["blockers"]) or "Template is not ready to publish.")

    @staticmethod
    def readiness(template: TemplateBlueprint) -> dict:
        blockers = []
        warnings = []
        active_steps = list(
            template.process_steps.select_related("process").prefetch_related("materials", "roll_spec").filter(
                is_removed_from_route=False
            ).order_by("sequence_number")
        )
        if not template.routing_rule_id:
            blockers.append("Select a routing rule before approval or LIVE publish.")
        if not active_steps:
            blockers.append("Sync workflow so the template has active route stages.")

        supported = TemplateGovernanceService.SUPPORTED_CATEGORY_CODES
        has_lamination = False
        lamination_passes = []
        for step in active_steps:
            behavior = str(getattr(step.process, "roll_behavior", "") or "").upper()
            if behavior == "MULTI_INPUT_COMBINE":
                has_lamination = True
                spec = getattr(step, "roll_spec", None)
                lane_count = int(getattr(spec, "input_lane_count", 0) or 0) if spec else 0
                if lane_count < 2:
                    blockers.append(f"Step {step.sequence_number} {step.process.name}: lamination needs two input lanes.")
                lamination_passes.append(
                    {
                        "step_id": str(step.id),
                        "sequence_number": step.sequence_number,
                        "process_name": step.process.name,
                        "pass_index": int(getattr(spec, "lamination_pass_index", 0) or 0) if spec else 0,
                        "lane_count": lane_count,
                        "adhesive_split_pct": float(getattr(spec, "adhesive_split_pct", 0) or 0) if spec else 0,
                        "solvent_split_pct": float(getattr(spec, "solvent_split_pct", 0) or 0) if spec else 0,
                    }
                )
            for material in step.materials.all():
                code = str(material.category_code or "").upper()
                if code == "CHEMICAL":
                    warnings.append(f"Step {step.sequence_number}: legacy CHEMICAL category is readable but should be split into ADHESIVE and SOLVENT.")
                elif code not in supported:
                    blockers.append(f"Step {step.sequence_number}: unsupported category {code}.")

        if has_lamination and not any(
            mat.category_code in {"ADHESIVE", "SOLVENT", "CHEMICAL"}
            for step in active_steps
            for mat in step.materials.all()
        ):
            warnings.append("Lamination route has no adhesive or solvent category mapping.")

        return {
            "ready": len(blockers) == 0,
            "blockers": blockers,
            "warnings": warnings,
            "active_steps": len(active_steps),
            "lamination_passes": lamination_passes,
            "supported_categories": sorted(supported),
        }

    @staticmethod
    def approve_template(template_id: str, user):
        template = TemplateBlueprint.objects.select_related("routing_rule").get(id=template_id)
        if template.status == "OBSOLETE":
            raise ValidationError("Obsolete templates cannot be approved.")
        if template.status == "LIVE":
            raise ValidationError("Template is already LIVE.")
        TemplateGovernanceService._require_routing_rule(template)

        if template.status == "APPROVED":
            return template

        if template.status == "DRAFT":
            TemplateGovernanceService._ensure_live_ready_workflow(template)
        elif template.status != "ENGINEERING":
            raise ValidationError("Template must be in ENGINEERING review before approval.")

        template.status = "APPROVED"
        template.approved_by = user
        template.approved_at = timezone.now()
        template.save(update_fields=["status", "approved_by", "approved_at", "updated_at"])
        return template

    @staticmethod
    def request_review(template_id: str, user=None):
        template = TemplateBlueprint.objects.select_related("routing_rule").get(id=template_id)
        if template.status == "OBSOLETE":
            raise ValidationError("Obsolete templates cannot be sent for review.")
        if template.status == "LIVE":
            raise ValidationError("LIVE templates are read-only. Clone a new version first.")
        if template.status == "APPROVED":
            return template
        if template.status != "DRAFT":
            raise ValidationError(f"Cannot send template in {template.status} state for review.")
        TemplateGovernanceService._require_routing_rule(template)
        TemplateGovernanceService._ensure_live_ready_workflow(template)
        template.status = "ENGINEERING"
        template.save(update_fields=["status", "updated_at"])
        return template

    @staticmethod
    def publish_template(template_id: str):
        template = TemplateBlueprint.objects.select_related("routing_rule").get(id=template_id)
        if template.status == "OBSOLETE":
            raise ValidationError("Obsolete templates cannot be published.")
        if template.status == "LIVE":
            if not template.process_steps.filter(is_removed_from_route=False).exists():
                TemplateGovernanceService._ensure_live_ready_workflow(template)
            return template

        TemplateGovernanceService._require_routing_rule(template)
        if template.status != "APPROVED":
            raise ValidationError("Template must be APPROVED before it can be published LIVE.")

        TemplateGovernanceService._ensure_live_ready_workflow(template)
        template.publish()
        return template

    @staticmethod
    @transaction.atomic
    def retire_template(template_id: str):
        template = TemplateBlueprint.objects.select_for_update().get(id=template_id)
        template.status = "OBSOLETE"
        template.routing_rule = None
        template.process_steps.all().delete()
        template.save(update_fields=["status", "routing_rule", "updated_at"])
        return template

    @staticmethod
    @transaction.atomic
    def clone_template(template_id: str, user=None):
        source = TemplateBlueprint.objects.get(id=template_id)
        clone = TemplateBlueprint.objects.create(
            name=f"{source.name} v{int(source.version or 1) + 1}",
            fg_type=source.fg_type,
            status="DRAFT",
            commercial_family=source.commercial_family,
            routing_rule=source.routing_rule,
            default_stock_strategy=source.default_stock_strategy,
            pouch_style=source.pouch_style,
            version=int(source.version or 1) + 1,
            created_by=user,
        )
        for step in source.process_steps.select_related("process", "cost_absorption_group").prefetch_related("materials").all():
            new_step = TemplateProcessStep.objects.create(
                template=clone,
                sequence_number=step.sequence_number,
                process=step.process,
                cost_absorption_group=step.cost_absorption_group,
                notes=step.notes,
                is_removed_from_route=step.is_removed_from_route,
            )
            spec = getattr(step, "roll_spec", None)
            defaults = TemplateGovernanceService.default_roll_handling_for_step(new_step)
            if spec:
                defaults.update(
                    {
                        "input_roll_count": spec.input_roll_count,
                        "combine_mode": spec.combine_mode,
                        "input_lane_count": spec.input_lane_count,
                        "lamination_pass_index": spec.lamination_pass_index,
                        "active_min_layer_count": spec.active_min_layer_count,
                        "adhesive_split_pct": spec.adhesive_split_pct,
                        "solvent_split_pct": spec.solvent_split_pct,
                        "lane_schema": spec.lane_schema,
                        "thickness_rule": spec.thickness_rule,
                        "width_rule": spec.width_rule,
                        "operator_entry_mode": spec.operator_entry_mode,
                        "notes": spec.notes,
                    }
                )
            TemplateProcessStepRollSpec.objects.create(template_step=new_step, **defaults)
            for mat in step.materials.all():
                TemplateProcessStepMaterial.objects.create(
                    template_step=new_step,
                    source_kind="CATEGORY",
                    category_code=mat.category_code,
                    consumption_basis=mat.consumption_basis,
                    formula_driver=mat.formula_driver,
                    formula_params=mat.formula_params,
                    issue_policy_mode=mat.issue_policy_mode,
                    issue_policy_value=mat.issue_policy_value,
                    capture_mode=mat.capture_mode,
                    quantity_mode=mat.quantity_mode,
                    value=mat.value,
                    is_optional=mat.is_optional,
                )
        return clone
