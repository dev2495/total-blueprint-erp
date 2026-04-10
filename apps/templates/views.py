from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.response import Response
from django.db import OperationalError, ProgrammingError

from apps.factory.models import Process
from apps.users.audit_mixins import MasterDataAuditMixin

from .models import TemplateBlueprint, TemplateProcessStep, TemplateProcessStepMaterial, TemplateProcessStepRollSpec
from .serializers import (
    TemplateBlueprintSerializer,
    TemplateDetailSerializer,
    TemplateProcessStepMaterialSerializer,
    TemplateProcessStepRollHandlingSerializer,
    TemplateProcessStepSerializer,
    TemplateSummarySerializer,
)
from .services import TemplateGovernanceService


def _template_bad_request(message, *, field_errors=None, detail=None):
    payload = {
        "status": "error",
        "message": message,
    }
    if detail:
        payload["detail"] = detail
    if field_errors:
        payload["field_errors"] = field_errors
    return Response(payload, status=status.HTTP_400_BAD_REQUEST)


def _default_roll_handling_for_step(step):
    process = step.process
    behavior = (getattr(process, "roll_behavior", None) or "NONE").upper()
    input_form = (getattr(process, "input_form", None) or "BULK").upper()
    output_form = (getattr(process, "output_form", None) or "ROLL").upper()

    defaults = {
        "input_roll_count": 0,
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
        defaults["thickness_rule"] = "SUM_INPUTS"
        defaults["width_rule"] = "MIN_INPUT"
    elif behavior == "SPLIT":
        defaults["input_roll_count"] = 1
        defaults["thickness_rule"] = "INHERIT_INPUT"
        defaults["width_rule"] = "OPERATOR_GRID"
        defaults["operator_entry_mode"] = "GRID_SPLIT"
    elif behavior == "NONE" and input_form == "ROLL" and output_form == "BULK":
        # Pouching-style roll->bulk steps consume at least one reserved roll by default.
        defaults["input_roll_count"] = 1
        defaults["operator_entry_mode"] = "DISCRETE_ONLY"
    return defaults


class TemplateBlueprintViewSet(MasterDataAuditMixin, viewsets.ModelViewSet):
    audit_area = "MASTER_TEMPLATE"
    queryset = TemplateBlueprint.objects.all().order_by("-created_at")
    lookup_value_regex = r"[0-9a-fA-F-]{36}"

    def get_queryset(self):
        qs = super().get_queryset()
        status_param = self.request.query_params.get("status")
        include_obsolete = str(self.request.query_params.get("include_obsolete") or "").lower() in {"1", "true", "yes"}
        if getattr(self, "action", None) == "retrieve":
            return qs
        if status_param:
            qs = qs.filter(status=status_param)
        elif not include_obsolete:
            qs = qs.exclude(status="OBSOLETE")
        return qs

    def get_serializer_class(self):
        if self.action == "list":
            return TemplateSummarySerializer
        if self.action == "retrieve":
            return TemplateDetailSerializer
        return TemplateBlueprintSerializer

    def perform_create(self, serializer):
        instance = serializer.save(created_by=self.request.user)
        self._audit_master_change("CREATE", instance)

    def _schema_error_response(self, exc):
        return Response(
            {
                "status": "error",
                "message": "Template schema is out of date.",
                "detail": f"{exc}. Run `manage.py migrate templates` to repair the templates app schema.",
            },
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer_class = self.get_serializer_class()
        try:
            serializer = serializer_class(instance, context=self.get_serializer_context())
            return Response(serializer.data)
        except (ProgrammingError, OperationalError) as exc:
            return self._schema_error_response(exc)

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.status in {"LIVE", "OBSOLETE"}:
            return Response(
                {"detail": "Live and obsolete templates are immutable and cannot be updated."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().update(request, *args, **kwargs)

    @action(detail=False, methods=["get"], url_path="schema-health")
    def schema_health(self, request):
        try:
            TemplateProcessStepMaterial.objects.only(
                "id",
                "issue_policy_mode",
                "issue_policy_value",
                "capture_mode",
            ).first()
            TemplateProcessStepRollSpec.objects.only(
                "id",
                "operator_entry_mode",
            ).first()
            return Response(
                {
                    "healthy": True,
                    "message": "Template schema is compatible.",
                }
            )
        except (ProgrammingError, OperationalError) as exc:
            return Response(
                {
                    "healthy": False,
                    "message": "Template schema is out of date.",
                    "detail": f"{exc}. Run `manage.py migrate templates` to repair the templates app schema.",
                }
            )

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        try:
            template = TemplateGovernanceService.approve_template(pk, request.user)
            return Response({"status": "template approved", "id": template.id})
        except Exception as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["post"])
    def publish(self, request, pk=None):
        try:
            template = TemplateGovernanceService.publish_template(pk)
            return Response({"status": "template is now LIVE", "id": template.id})
        except Exception as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    def _route_sync_plan(self, template):
        ordered_codes = list(template.routing_rule.ordered_processes if template.routing_rule else [])
        processes = {p.code: p for p in Process.objects.filter(code__in=ordered_codes)}
        existing_steps = list(template.process_steps.select_related("process").all().order_by("sequence_number", "created_at"))
        active_steps = [step for step in existing_steps if not step.is_removed_from_route]
        unmatched_existing = list(active_steps)
        matched_steps = []
        created_defs = []

        for seq, code in enumerate(ordered_codes, start=1):
            proc = processes.get(code)
            chosen = None
            exact = next((step for step in unmatched_existing if step.sequence_number == seq and step.process_id == getattr(proc, "id", None)), None)
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

    def _serialize_route_sync_preview(self, plan):
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

    def _apply_route_sync(self, template, *, destructive=False):
        plan = self._route_sync_plan(template)
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
                    defaults=_default_roll_handling_for_step(step),
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
                defaults=_default_roll_handling_for_step(step),
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
                defaults=_default_roll_handling_for_step(step),
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

    @action(detail=True, methods=["get"], url_path="route-steps")
    def route_steps(self, request, pk=None):
        template = self.get_object()
        if not template.routing_rule:
            return Response([])
        steps = []
        ordered_codes = template.routing_rule.ordered_processes
        processes = {p.code: p for p in Process.objects.filter(code__in=ordered_codes)}
        for index, code in enumerate(ordered_codes):
            proc = processes.get(code)
            steps.append(
                {
                    "index": index,
                    "label": f"Step {index} - {proc.name if proc else code}",
                    "process_code": proc.code if proc else code,
                    "name": proc.name if proc else code,
                    "input_form": proc.input_form if proc else "BULK",
                    "output_form": proc.output_form if proc else "ROLL",
                    "roll_behavior": proc.roll_behavior if proc else "NONE",
                    "notes": "",
                }
            )
        return Response(steps)

    @action(detail=True, methods=["get", "post"], url_path="process-steps")
    def process_steps(self, request, pk=None):
        template = self.get_object()

        if request.method == "GET":
            steps = template.process_steps.select_related("process").prefetch_related("materials").all()
            try:
                return Response(TemplateProcessStepSerializer(steps, many=True).data)
            except (ProgrammingError, OperationalError) as exc:
                return self._schema_error_response(exc)

        if template.status in {"LIVE", "OBSOLETE"}:
            return Response({"detail": "Cannot modify process steps on a LIVE or OBSOLETE template"}, status=status.HTTP_400_BAD_REQUEST)

        process_id = request.data.get("process_id")
        sequence = request.data.get("sequence_number")
        notes = request.data.get("notes", "")
        if not process_id or sequence is None:
            return Response({"detail": "process_id and sequence_number required"}, status=status.HTTP_400_BAD_REQUEST)

        step = TemplateProcessStep.objects.create(
            template=template,
            process_id=process_id,
            sequence_number=sequence,
            notes=notes,
        )
        TemplateProcessStepRollSpec.objects.get_or_create(template_step=step, defaults=_default_roll_handling_for_step(step))
        return Response(TemplateProcessStepSerializer(step).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["put", "delete"], url_path="process-steps/(?P<step_id>[^/.]+)")
    def process_step_detail(self, request, pk=None, step_id=None):
        template = self.get_object()
        if template.status in {"LIVE", "OBSOLETE"}:
            return Response({"detail": "Cannot modify process steps on a LIVE or OBSOLETE template"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            step = TemplateProcessStep.objects.get(id=step_id, template=template)
        except TemplateProcessStep.DoesNotExist:
            return Response({"detail": "Step not found"}, status=status.HTTP_404_NOT_FOUND)

        if request.method == "PUT":
            if "process_id" in request.data:
                step.process_id = request.data["process_id"]
            if "sequence_number" in request.data:
                step.sequence_number = request.data["sequence_number"]
            if "notes" in request.data:
                step.notes = request.data["notes"]
            step.save()
            return Response(TemplateProcessStepSerializer(step).data)

        step.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["get", "patch"], url_path="process-steps/(?P<step_id>[^/.]+)/roll-handling")
    def process_step_roll_handling(self, request, pk=None, step_id=None):
        template = self.get_object()
        try:
            step = TemplateProcessStep.objects.select_related("process").get(id=step_id, template=template)
        except TemplateProcessStep.DoesNotExist:
            return Response({"detail": "Step not found"}, status=status.HTTP_404_NOT_FOUND)

        try:
            spec, _ = TemplateProcessStepRollSpec.objects.get_or_create(
                template_step=step,
                defaults=_default_roll_handling_for_step(step),
            )
        except (ProgrammingError, OperationalError) as exc:
            return self._schema_error_response(exc)
        if request.method == "GET":
            try:
                return Response(TemplateProcessStepRollHandlingSerializer(spec).data)
            except (ProgrammingError, OperationalError) as exc:
                return self._schema_error_response(exc)
        if template.status in {"LIVE", "OBSOLETE"}:
            return Response({"detail": "Cannot modify roll handling on a LIVE or OBSOLETE template"}, status=status.HTTP_400_BAD_REQUEST)

        serializer = TemplateProcessStepRollHandlingSerializer(spec, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        try:
            serializer.save()
            return Response(serializer.data)
        except (ProgrammingError, OperationalError) as exc:
            return self._schema_error_response(exc)

    @action(detail=True, methods=["get", "post"], url_path="process-steps/(?P<step_id>[^/.]+)/materials")
    def step_materials(self, request, pk=None, step_id=None):
        template = self.get_object()
        try:
            step = TemplateProcessStep.objects.get(id=step_id, template=template)
        except TemplateProcessStep.DoesNotExist:
            return Response(
                {
                    "status": "error",
                    "message": "Step not found.",
                    "detail": "Invalid step for this template.",
                },
                status=status.HTTP_404_NOT_FOUND,
            )

        if request.method == "GET":
            rows = step.materials.select_related("material").all()
            try:
                return Response(TemplateProcessStepMaterialSerializer(rows, many=True).data)
            except (ProgrammingError, OperationalError) as exc:
                return self._schema_error_response(exc)

        if template.status in {"LIVE", "OBSOLETE"}:
            return _template_bad_request(
                "Cannot modify materials for this template.",
                detail="Template is LIVE or OBSOLETE.",
            )

        source_kind = str(request.data.get("source_kind") or "CATEGORY").upper()
        category_code = str(request.data.get("category_code") or "").strip().upper()
        if source_kind != "CATEGORY":
            return _template_bad_request(
                "Only CATEGORY mapping is allowed.",
                field_errors={"source_kind": ["Only CATEGORY mapping is allowed."]},
            )
        if not category_code:
            return _template_bad_request(
                "category_code required for CATEGORY mapping.",
                field_errors={"category_code": ["category_code is required for CATEGORY mapping."]},
            )

        existing = TemplateProcessStepMaterial.objects.filter(
            template_step=step,
            source_kind="CATEGORY",
            category_code=category_code,
        ).first()
        if existing:
            data = TemplateProcessStepMaterialSerializer(existing).data
            return Response(
                {
                    "status": "ok",
                    "message": "Category already mapped; returning existing mapping.",
                    "data": data,
                },
                status=status.HTTP_200_OK,
            )

        payload = {
            "template_step": step.id,
            "source_kind": "CATEGORY",
            "category_code": category_code,
        }
        optional_fields = [
            "consumption_basis",
            "formula_driver",
            "formula_params",
            "issue_policy_mode",
            "issue_policy_value",
            "capture_mode",
            "quantity_mode",
            "value",
            "is_optional",
        ]
        for field in optional_fields:
            if field in request.data and request.data.get(field) is not None:
                payload[field] = request.data.get(field)
        serializer = TemplateProcessStepMaterialSerializer(data=payload)
        try:
            serializer.is_valid(raise_exception=True)
            serializer.save(template_step=step, material=None)
        except DRFValidationError as exc:
            detail = exc.detail if hasattr(exc, "detail") else str(exc)
            field_errors = detail if isinstance(detail, dict) else None
            return _template_bad_request(
                "Material mapping request failed.",
                field_errors=field_errors,
                detail="Check mapping fields and try again.",
            )
        return Response(
            {
                "status": "ok",
                "message": "Category mapped to step.",
                "data": serializer.data,
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["put", "delete"], url_path="process-steps/(?P<step_id>[^/.]+)/materials/(?P<mat_id>[^/.]+)")
    def process_step_material_detail(self, request, pk=None, step_id=None, mat_id=None):
        template = self.get_object()
        if template.status in {"LIVE", "OBSOLETE"}:
            return _template_bad_request(
                "Cannot modify materials for this template.",
                detail="Template is LIVE or OBSOLETE.",
            )
        try:
            row = TemplateProcessStepMaterial.objects.get(id=mat_id, template_step_id=step_id)
        except TemplateProcessStepMaterial.DoesNotExist:
            return Response({"detail": "Material mapping not found"}, status=status.HTTP_404_NOT_FOUND)

        if request.method == "PUT":
            serializer = TemplateProcessStepMaterialSerializer(row, data=request.data, partial=True)
            try:
                serializer.is_valid(raise_exception=True)
                serializer.save(material=None, source_kind="CATEGORY")
            except DRFValidationError as exc:
                detail = exc.detail if hasattr(exc, "detail") else str(exc)
                field_errors = detail if isinstance(detail, dict) else None
                return _template_bad_request(
                    "Material mapping update failed.",
                    field_errors=field_errors,
                    detail="Check update fields and try again.",
                )
            return Response(serializer.data)

        row.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"], url_path="sync-workflow-preview")
    def sync_workflow_preview(self, request, pk=None):
        template = self.get_object()
        if not template.routing_rule:
            return Response({"detail": "Template has no routing rule"}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {
                "status": "preview",
                **self._serialize_route_sync_preview(self._route_sync_plan(template)),
            }
        )

    @action(detail=True, methods=["post"], url_path="sync-workflow-apply")
    def sync_workflow_apply(self, request, pk=None):
        template = self.get_object()
        if template.status in {"LIVE", "OBSOLETE"}:
            return Response(
                {"detail": "Cannot modify process steps on a LIVE or OBSOLETE template. Please create a new version."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not template.routing_rule:
            return Response({"detail": "Template has no routing rule"}, status=status.HTTP_400_BAD_REQUEST)
        result = self._apply_route_sync(template, destructive=False)
        return Response(
            {
                "status": "synced",
                "steps_created": len(result["created_steps"]),
                "steps_preserved": len(result["kept_steps"]),
                "steps_marked_removed": len(result["stale_steps"]),
                "steps": TemplateProcessStepSerializer(
                    template.process_steps.select_related("process").prefetch_related("materials").all(),
                    many=True,
                ).data,
            }
        )

    @action(detail=True, methods=["post"], url_path="rebuild-from-route")
    def rebuild_from_route(self, request, pk=None):
        template = self.get_object()
        if template.status in {"LIVE", "OBSOLETE"}:
            return Response(
                {"detail": "Cannot rebuild steps on a LIVE or OBSOLETE template. Please create a new version."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not template.routing_rule:
            return Response({"detail": "Template has no routing rule"}, status=status.HTTP_400_BAD_REQUEST)
        result = self._apply_route_sync(template, destructive=True)
        return Response(
            {
                "status": "rebuilt",
                "steps_created": len(result["created_steps"]),
                "steps": TemplateProcessStepSerializer(result["created_steps"], many=True).data,
            }
        )
