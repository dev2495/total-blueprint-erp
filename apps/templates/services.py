import logging

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q
from django.db.models.deletion import ProtectedError
from django.utils import timezone

from apps.factory.models import Process, WorkCenter, WorkCenterProcess

from .models import (
    TemplateBlueprint,
    TemplateProcessStep,
    TemplateProcessStepMaterial,
    TemplateProcessStepRollSpec,
)

logger = logging.getLogger(__name__)


class RouteDispatchError(ValueError):
    def __init__(self, message, *, candidates=None, template_step=None):
        super().__init__(message)
        self.candidates = candidates or []
        self.template_step = template_step


class TemplateDispatchService:
    AUTO_IF_SINGLE = "AUTO_IF_SINGLE"
    AUTO_DEFAULT = "AUTO_DEFAULT"
    PLANNER_REQUIRED = "PLANNER_REQUIRED"
    BLOCKING_STATUSES = {
        "NEEDS_DECISION",
        "NO_CAPABILITY",
        "INVALID_ALLOWED_WORK_CENTERS",
        "INVALID_DEFAULT_WORK_CENTER",
    }

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
        elif policy == cls.PLANNER_REQUIRED and filtered:
            status = "PLANNER_REQUIRED"
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
    def resolve_work_center(cls, process, *, plant=None, template=None, step_index=None, strict=True, selected_work_center_id=None):
        step = cls.get_template_step(template=template, step_index=step_index, process=process)
        candidates = cls.candidate_work_centers(process, plant=plant)
        allowed_ids = cls.normalize_work_center_ids(getattr(step, "allowed_work_center_ids", None) or []) if step else []
        policy = str(getattr(step, "work_center_selection_policy", "") or cls.AUTO_IF_SINGLE).upper() if step else cls.AUTO_IF_SINGLE
        default_id = str(getattr(step, "default_work_center_id", "") or "") if step else ""
        filtered = [wc for wc in candidates if not allowed_ids or str(wc.id) in set(allowed_ids)]
        selected_id = str(selected_work_center_id or "").strip()

        if selected_id:
            selected_wc = next((wc for wc in filtered if str(wc.id) == selected_id), None)
            if selected_wc:
                return selected_wc
            if strict:
                raise RouteDispatchError(
                    f"Selected work center cannot run {getattr(process, 'code', 'UNKNOWN')} for this route step.",
                    candidates=[cls.serialize_work_center(wc) for wc in filtered],
                    template_step=step,
                )
            return None

        if policy == cls.PLANNER_REQUIRED:
            if strict:
                step_label = f"step {int(step_index or 0) + 1}" if step_index is not None else "route step"
                raise RouteDispatchError(
                    f"Planner must choose a work center for {getattr(process, 'code', 'UNKNOWN')} at {step_label}.",
                    candidates=[cls.serialize_work_center(wc) for wc in filtered],
                    template_step=step,
                )
            return None

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
    @transaction.atomic
    def update_step_dispatch(
        cls,
        step,
        *,
        allowed_work_center_ids=None,
        default_work_center_id=None,
        selection_policy=None,
        notes=None,
        optional_at_planning=None,
        skippable_after_previous_output=None,
    ):
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
        if optional_at_planning is not None:
            if bool(optional_at_planning) and not step.process.allows_optional_at_planning:
                raise ValidationError(f"{step.process.code} is not planner-optional-capable in Process Master.")
            step.optional_at_planning = bool(optional_at_planning)
        if skippable_after_previous_output is not None:
            if bool(skippable_after_previous_output) and not step.process.allows_skip_after_previous_output:
                raise ValidationError(f"{step.process.code} is not WCM-skip-capable in Process Master.")
            step.skippable_after_previous_output = bool(skippable_after_previous_output)
        step.dispatch_updated_at = timezone.now()
        step.save(update_fields=[
            "allowed_work_center_ids",
            "default_work_center",
            "work_center_selection_policy",
            "dispatch_notes",
            "optional_at_planning",
            "skippable_after_previous_output",
            "dispatch_updated_at",
            "updated_at",
        ])
        cls.refresh_open_jobs_for_step(step)
        from apps.sales.services.order_service import SalesOrderService

        SalesOrderService.refresh_open_snapshots_for_template(
            step.template,
            reason="TEMPLATE_DISPATCH_EDIT",
            raise_on_error=True,
        )
        return step

    @classmethod
    def refresh_open_jobs_for_step(cls, step):
        """
        Keep unreleased WCM handoff rows aligned after a route dispatch edit.
        Running/paused/completed work is audit truth and must not be rewritten.
        """
        from apps.production.models import ProductionJob, WorkCenterAssignment
        from apps.production.services.job_services import JobService

        try:
            route_index = int(step.sequence_number or 1) - 1
        except Exception:
            route_index = 0
        route_index = max(0, route_index)

        jobs = (
            ProductionJob.objects.select_related(
                "template",
                "routing_rule",
                "current_process",
                "work_center",
                "from_location",
                "to_location",
            )
            .filter(
                template=step.template,
                current_step_index=route_index,
                current_process=step.process,
            )
            .exclude(job_state__in=["EXECUTING", "PAUSED", "COMPLETED", "CANCELLED"])
            .exclude(status__in=["RUNNING", "COMPLETED", "CANCELLED"])
        )
        refreshed = 0
        for job in jobs:
            assignment = (
                WorkCenterAssignment.objects.select_related("assigned_machine")
                .filter(production_job=job)
                .first()
            )
            if assignment and str(assignment.status or "").upper() == "EXECUTION_READY":
                continue
            try:
                resolved_wc = cls.resolve_work_center(
                    step.process,
                    plant=JobService._plant_constraint_for_release(job),
                    template=step.template,
                    step_index=route_index,
                    strict=True,
                    selected_work_center_id=None,
                )
            except RouteDispatchError:
                continue
            if not resolved_wc:
                continue
            route_last_index = max(
                0,
                len(list(getattr(job.routing_rule, "ordered_processes", None) or [])) - 1,
            )
            _, from_loc, to_loc = JobService._step_locations_for_work_center(
                work_center=resolved_wc,
                route_index=route_index,
                route_last_index=route_last_index,
            )
            job.work_center = resolved_wc
            job.from_location = from_loc
            job.to_location = to_loc
            job.save(update_fields=["work_center", "from_location", "to_location", "updated_at"])
            if assignment:
                assignment.work_center = resolved_wc
                update_fields = ["work_center", "updated_at"]
                assigned_machine = getattr(assignment, "assigned_machine", None)
                if (
                    assigned_machine
                    and getattr(assigned_machine, "work_center_id", None)
                    and assigned_machine.work_center_id != resolved_wc.id
                ):
                    assignment.assigned_machine = None
                    update_fields.append("assigned_machine")
                assignment.save(update_fields=update_fields)
            refreshed += 1
        return refreshed

    @classmethod
    def audit_steps(cls, *, include_obsolete=False, include_samples=False, include_versions=False):
        qs = TemplateProcessStep.objects.select_related(
            "template",
            "process",
            "default_work_center",
            "default_work_center__plant",
        ).filter(is_removed_from_route=False).order_by("process__code", "template__name", "sequence_number")
        if not include_obsolete:
            qs = qs.exclude(template__status="OBSOLETE")
        if not include_versions:
            qs = qs.filter(template__is_current_version=True)
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
                "optional_at_planning": step.optional_at_planning,
                "skippable_after_previous_output": step.skippable_after_previous_output,
                "process_allows_optional_at_planning": step.process.allows_optional_at_planning,
                "process_allows_skip_after_previous_output": step.process.allows_skip_after_previous_output,
                **status,
            })
        return rows

    @classmethod
    def backfill_auto_resolvable_steps(cls, *, apply=False, include_samples=False, include_versions=False):
        rows = cls.audit_steps(include_samples=include_samples, include_versions=include_versions)
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

    @classmethod
    def backfill_auto_resolvable_template_steps(cls, template, *, apply=False):
        rows = []
        changed = 0
        steps = template.process_steps.select_related("process", "default_work_center").filter(
            is_removed_from_route=False
        ).order_by("sequence_number")
        for step in steps:
            status = cls.step_status(step)
            rows.append({
                "step": step,
                **status,
            })
            if (
                status["status"] == "AUTO_RESOLVABLE"
                and not status["allowed_work_center_ids"]
                and not status["default_work_center"]
                and len(status["valid_candidates"]) == 1
            ):
                if apply:
                    valid = status["valid_candidates"][0]
                    cls.update_step_dispatch(
                        step,
                        allowed_work_center_ids=[valid["id"]],
                        default_work_center_id=valid["id"],
                        selection_policy=cls.AUTO_DEFAULT,
                        notes=step.dispatch_notes or "Auto-filled from the only capable work center before publish.",
                    )
                changed += 1
        return {"eligible": changed, "applied": changed if apply else 0, "rows": rows}

    @classmethod
    def dispatch_blockers_for_template(cls, template):
        blockers = []
        steps = template.process_steps.select_related("process", "default_work_center").filter(
            is_removed_from_route=False
        ).order_by("sequence_number")
        for step in steps:
            status = cls.step_status(step)
            code = status["status"]
            if code not in cls.BLOCKING_STATUSES:
                continue
            label = f"Step {step.sequence_number} {step.process.name}"
            if code == "NO_CAPABILITY":
                blockers.append(f"{label}: no capable work center is mapped for {step.process.code}.")
            elif code == "INVALID_ALLOWED_WORK_CENTERS":
                blockers.append(f"{label}: allowed work-center list has no valid capable center.")
            elif code == "INVALID_DEFAULT_WORK_CENTER":
                blockers.append(f"{label}: selected default work center cannot run {step.process.code}.")
            else:
                blockers.append(f"{label}: choose a default work center or set Planner chooses at release.")
        return blockers


class TemplateGovernanceService:
    SUPPORTED_CATEGORY_CODES = {"GRANULE", "ADHESIVE", "SOLVENT", "ADDON", "POD"}

    @staticmethod
    def is_current_live_template(template: TemplateBlueprint | None) -> bool:
        return bool(
            template
            and str(getattr(template, "status", "LIVE") or "").upper() == "LIVE"
            and bool(getattr(template, "is_current_version", True))
        )

    @staticmethod
    def ensure_current_live_template(template: TemplateBlueprint | None, *, message: str | None = None):
        if not TemplateGovernanceService.is_current_live_template(template):
            raise ValidationError(
                message
                or "Template must be the current LIVE version. Draft, disabled, and superseded templates are not selectable."
            )
        return template

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
        missing_codes = [code for code in ordered_codes if code not in processes]
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
            "missing_codes": missing_codes,
        }

    @staticmethod
    def serialize_route_sync_preview(plan):
        return {
            "missing_process_codes": list(plan.get("missing_codes") or []),
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
        if plan.get("missing_codes"):
            raise ValidationError(
                "Routing Rule contains missing Process code(s): "
                + ", ".join(str(code) for code in plan["missing_codes"])
                + ". Route steps were not changed."
            )
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

        existing_steps = list(template.process_steps.all().order_by("sequence_number", "created_at"))
        if existing_steps:
            min_sequence = min([0] + [int(step.sequence_number or 0) for step in existing_steps])
            parking_base = min_sequence - len(existing_steps) - 1000
            for index, step in enumerate(existing_steps, start=1):
                step.sequence_number = parking_base - index
                step.save(update_fields=["sequence_number", "updated_at"])

        matched_step_ids = set()
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
            matched_step_ids.add(step.id)

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

        stale_step_ids = {step.id for step in plan["stale_steps"]}
        next_removed_sequence = max([0] + [int(row["target_sequence"]) for row in plan["matched_steps"] + plan["created_defs"]])
        for step in existing_steps:
            if step.id in matched_step_ids:
                continue
            next_removed_sequence += 1
            step.sequence_number = next_removed_sequence
            step.is_removed_from_route = True
            if step.id in stale_step_ids and "[STALE ROUTE STEP]" not in step.notes:
                step.notes = f"[STALE ROUTE STEP] {step.notes}".strip()
            step.save(update_fields=["sequence_number", "is_removed_from_route", "notes", "updated_at"])

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
        TemplateDispatchService.backfill_auto_resolvable_template_steps(template, apply=True)
        template.refresh_from_db()
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

        blockers.extend(TemplateDispatchService.dispatch_blockers_for_template(template))

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
    @transaction.atomic
    def publish_template(template_id: str):
        template = (
            TemplateBlueprint.objects.select_for_update()
            .get(id=template_id)
        )
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
        if not template.version_group:
            template.version_group = (
                TemplateBlueprint.objects.get(id=template.source_template_id).version_group
                if template.source_template_id
                else template.id
            )

        now = timezone.now()
        siblings = TemplateBlueprint.objects.select_for_update().filter(
            version_group=template.version_group,
        ).exclude(id=template.id)
        superseded_live_ids = list(
            siblings.filter(status="LIVE", is_current_version=True).values_list("id", flat=True)
        )
        siblings.filter(status="LIVE", is_current_version=True).update(
            status="OBSOLETE",
            is_current_version=False,
            superseded_by=template,
            updated_at=now,
        )
        siblings.filter(
            status__in=["DRAFT", "ENGINEERING", "APPROVED"],
            is_current_version=True,
        ).update(
            status="OBSOLETE",
            is_current_version=False,
            superseded_by=template,
            updated_at=now,
        )

        template.status = "LIVE"
        template.is_current_version = True
        template.superseded_by = None
        template.save(update_fields=["status", "version_group", "is_current_version", "superseded_by", "updated_at"])

        # Move current Product Master selectors as part of the same transaction.
        # A just-published template must not leave a master pointing at the
        # now-obsolete live version, even briefly after the publish completes.
        if superseded_live_ids:
            from apps.materials.models import ProductMaster
            from apps.sales.models import SalesOrderItem
            from apps.sales.services.order_service import SalesOrderService

            affected_masters = list(
                ProductMaster.objects.select_for_update()
                .filter(
                    Q(template_id__in=superseded_live_ids)
                    | Q(default_template_id__in=superseded_live_ids)
                )
                .values_list("id", flat=True)
            )
            if affected_masters:
                ProductMaster.objects.filter(id__in=affected_masters).update(
                    template=template,
                    default_template=template,
                )
                template._product_master_revision_summary = SalesOrderService.refresh_open_snapshots_for_items(
                    SalesOrderItem.objects.filter(product_master_id__in=affected_masters),
                    reason="TEMPLATE_PUBLISH",
                    raise_on_error=True,
                )
                template._revised_product_master_ids = [str(master_id) for master_id in affected_masters]
            else:
                template._product_master_revision_summary = {
                    "checked": 0,
                    "refreshed": 0,
                    "failed": 0,
                    "skipped": 0,
                    "queues_rebuilt": 0,
                    "queues_frozen": 0,
                }
                template._revised_product_master_ids = []
        return template

    @staticmethod
    @transaction.atomic
    def retire_template(template_id: str):
        template = TemplateBlueprint.objects.select_for_update().get(id=template_id)
        if template.status == "OBSOLETE":
            return template
        template.status = "OBSOLETE"
        template.is_current_version = False
        template.superseded_by = None
        template.save(update_fields=["status", "is_current_version", "superseded_by", "updated_at"])
        return template

    @staticmethod
    def _draft_cleanup_queryset():
        return TemplateBlueprint.objects.filter(status__in=["DRAFT", "ENGINEERING", "APPROVED"])

    @staticmethod
    def _draft_cleanup_protected_ref_counts(template):
        from apps.inventory.models import InventoryRoll
        from apps.production.models import (
            FinishedGoodsBatch,
            PlannedOrder,
            PlannedStockOrder,
            PlannerSku,
            ProductionJob,
        )
        from apps.sales.models import SalesOrderItem, SalesSku

        return {
            "sales_order_items": SalesOrderItem.objects.filter(template=template).count(),
            "sales_skus": SalesSku.objects.filter(template=template).count(),
            "production_jobs": ProductionJob.objects.filter(template=template).count(),
            "planned_orders": PlannedOrder.objects.filter(template=template).count(),
            "planned_stock_orders": PlannedStockOrder.objects.filter(template=template).count(),
            "planner_skus": PlannerSku.objects.filter(template=template).count(),
            "inventory_rolls": InventoryRoll.objects.filter(template=template).count(),
            "fg_batches": FinishedGoodsBatch.objects.filter(template=template).count(),
        }

    @staticmethod
    def _draft_cleanup_selector_ref_counts(template):
        from apps.materials.models import InventoryMaterial, ProductMaster
        from apps.production.models import PlannerSku, PlannerSkuVariant
        from apps.sales.models import QuotationItem, SalesSku

        return {
            "product_master_template": ProductMaster.objects.filter(template=template).count(),
            "product_master_default_template": ProductMaster.objects.filter(default_template=template).count(),
            "packaging_production_template": InventoryMaterial.objects.filter(production_template=template).count(),
            "sales_skus": SalesSku.objects.filter(template=template, active=True).count(),
            "planner_skus": PlannerSku.objects.filter(template=template, active=True).count(),
            "planner_sku_variants": PlannerSkuVariant.objects.filter(template=template).count(),
            "quotation_items": QuotationItem.objects.filter(template=template).count(),
        }

    @staticmethod
    def _unlink_draft_selector_refs(template):
        from apps.materials.models import InventoryMaterial, ProductMaster
        from apps.production.models import PlannerSku, PlannerSkuVariant
        from apps.sales.models import QuotationItem, SalesSku

        counts = TemplateGovernanceService._draft_cleanup_selector_ref_counts(template)
        ProductMaster.objects.filter(template=template).update(template=None)
        ProductMaster.objects.filter(default_template=template).update(default_template=None)
        InventoryMaterial.objects.filter(production_template=template).update(production_template=None)
        SalesSku.objects.filter(template=template).update(active=False)
        PlannerSku.objects.filter(template=template).update(active=False)
        PlannerSkuVariant.objects.filter(template=template).update(template=None, active=False)
        QuotationItem.objects.filter(template=template).update(template=None)
        return counts

    @staticmethod
    @transaction.atomic
    def purge_draft_templates(*, apply=False):
        qs = TemplateGovernanceService._draft_cleanup_queryset().select_for_update().order_by("created_at")
        result = {
            "scanned": qs.count(),
            "deleted": 0,
            "disabled": 0,
            "delete_ids": [],
            "disabled_ids": [],
            "blocked_refs": {},
            "selector_refs": {},
        }
        if not apply:
            for template in qs:
                ref_counts = TemplateGovernanceService._draft_cleanup_protected_ref_counts(template)
                selector_refs = TemplateGovernanceService._draft_cleanup_selector_ref_counts(template)
                if sum(selector_refs.values()) > 0:
                    result["selector_refs"][str(template.id)] = selector_refs
                if sum(ref_counts.values()) > 0:
                    result["disabled_ids"].append(str(template.id))
                    result["blocked_refs"][str(template.id)] = ref_counts
                else:
                    result["delete_ids"].append(str(template.id))
            result["deleted"] = len(result["delete_ids"])
            result["disabled"] = len(result["disabled_ids"])
            return result

        for template in list(qs):
            selector_refs = TemplateGovernanceService._unlink_draft_selector_refs(template)
            if sum(selector_refs.values()) > 0:
                result["selector_refs"][str(template.id)] = selector_refs
            ref_counts = TemplateGovernanceService._draft_cleanup_protected_ref_counts(template)
            if sum(ref_counts.values()) > 0:
                template.status = "OBSOLETE"
                template.is_current_version = False
                template.superseded_by = None
                template.save(update_fields=["status", "is_current_version", "superseded_by", "updated_at"])
                result["disabled"] += 1
                result["disabled_ids"].append(str(template.id))
                result["blocked_refs"][str(template.id)] = ref_counts
                continue
            try:
                template_id = str(template.id)
                template.delete()
                result["deleted"] += 1
                result["delete_ids"].append(template_id)
            except ProtectedError:
                template.status = "OBSOLETE"
                template.is_current_version = False
                template.superseded_by = None
                template.save(update_fields=["status", "is_current_version", "superseded_by", "updated_at"])
                result["disabled"] += 1
                result["disabled_ids"].append(str(template.id))
        return result

    @staticmethod
    @transaction.atomic
    def clone_template(template_id: str, user=None, *, correction_reason: str = ""):
        source = TemplateBlueprint.objects.select_for_update().get(id=template_id)
        return TemplateGovernanceService._copy_template(
            source,
            user=user,
            correction_reason=correction_reason,
        )

    @staticmethod
    @transaction.atomic
    def edit_draft(template_id: str, user=None, *, correction_reason: str = ""):
        source = (
            TemplateBlueprint.objects.select_for_update()
            .get(id=template_id)
        )
        if source.status in {"DRAFT", "ENGINEERING", "APPROVED"}:
            if correction_reason and not source.correction_reason:
                source.correction_reason = correction_reason
                source.save(update_fields=["correction_reason", "updated_at"])
            return source
        if source.status == "OBSOLETE" and source.superseded_by_id:
            source = TemplateBlueprint.objects.select_for_update().get(id=source.superseded_by_id)
        if source.status != "LIVE":
            raise ValidationError("Only live or editable templates can be opened for safe editing.")

        existing = (
            TemplateBlueprint.objects.select_for_update()
            .filter(
                source_template=source,
                status__in=["DRAFT", "ENGINEERING", "APPROVED"],
                is_current_version=True,
            )
            .order_by("-created_at")
            .first()
        )
        if existing:
            if correction_reason and not existing.correction_reason:
                existing.correction_reason = correction_reason
                existing.save(update_fields=["correction_reason", "updated_at"])
            return existing

        return TemplateGovernanceService._copy_template(
            source,
            user=user,
            correction_reason=correction_reason,
            preserve_name=True,
            source_template=source,
        )

    @staticmethod
    def _next_version_for_group(version_group):
        latest = (
            TemplateBlueprint.objects.filter(version_group=version_group)
            .order_by("-version", "-created_at")
            .values_list("version", flat=True)
            .first()
        )
        return int(latest or 0) + 1

    @staticmethod
    def _copy_template(
        source: TemplateBlueprint,
        *,
        user=None,
        correction_reason: str = "",
        preserve_name: bool = False,
        source_template: TemplateBlueprint | None = None,
    ):
        if not source.version_group:
            source.version_group = source.id
            source.save(update_fields=["version_group", "updated_at"])

        next_version = TemplateGovernanceService._next_version_for_group(source.version_group)
        name = source.name if preserve_name else f"{source.name} v{next_version}"
        clone = TemplateBlueprint.objects.create(
            name=name,
            fg_type=source.fg_type,
            status="DRAFT",
            commercial_family=source.commercial_family,
            routing_rule=source.routing_rule,
            default_stock_strategy=source.default_stock_strategy,
            batch_execution_policy=source.batch_execution_policy,
            pouch_style=source.pouch_style,
            version_group=source.version_group,
            version=next_version,
            is_current_version=True,
            source_template=source_template,
            correction_reason=str(correction_reason or "").strip(),
            created_by=user,
        )
        for step in source.process_steps.select_related(
            "process",
            "cost_absorption_group",
            "default_work_center",
        ).prefetch_related("materials").all():
            new_step = TemplateProcessStep.objects.create(
                template=clone,
                sequence_number=step.sequence_number,
                process=step.process,
                cost_absorption_group=step.cost_absorption_group,
                notes=step.notes,
                allowed_work_center_ids=list(step.allowed_work_center_ids or []),
                default_work_center=step.default_work_center,
                work_center_selection_policy=step.work_center_selection_policy,
                dispatch_notes=step.dispatch_notes,
                dispatch_updated_at=step.dispatch_updated_at,
                optional_at_planning=step.optional_at_planning,
                skippable_after_previous_output=step.skippable_after_previous_output,
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
