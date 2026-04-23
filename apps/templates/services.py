from django.core.exceptions import ValidationError
from django.utils import timezone

from apps.factory.models import Process

from .models import (
    TemplateBlueprint,
    TemplateProcessStep,
    TemplateProcessStepRollSpec,
)


class TemplateGovernanceService:
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
            defaults["operator_entry_mode"] = "DISCRETE_ONLY"
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

        if template.status not in {"DRAFT", "ENGINEERING"}:
            raise ValidationError(f"Cannot approve template in {template.status} state.")

        template.status = "APPROVED"
        template.approved_by = user
        template.approved_at = timezone.now()
        template.save(update_fields=["status", "approved_by", "approved_at", "updated_at"])
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
