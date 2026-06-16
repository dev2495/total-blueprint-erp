from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.response import Response
from django.core.exceptions import ValidationError as DjangoValidationError
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
from .services import TemplateDispatchService, TemplateGovernanceService


def _is_admin_actor(user) -> bool:
    role_code = str(getattr(getattr(user, "role", None), "code", "") or "").upper()
    return bool(getattr(user, "is_authenticated", False) and (getattr(user, "is_superuser", False) or getattr(user, "is_owner", False) or role_code in {"ADMIN", "SUPER_ADMIN", "OWNER"}))


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
    return TemplateGovernanceService.default_roll_handling_for_step(step)


class TemplateBlueprintViewSet(MasterDataAuditMixin, viewsets.ModelViewSet):
    audit_area = "MASTER_TEMPLATE"
    queryset = TemplateBlueprint.objects.all().order_by("-created_at")
    lookup_value_regex = r"[0-9a-fA-F-]{36}"

    def get_queryset(self):
        qs = super().get_queryset()
        status_param = str(self.request.query_params.get("status") or "").upper()
        include_obsolete = str(self.request.query_params.get("include_obsolete") or "").lower() in {"1", "true", "yes"}
        if getattr(self, "action", None) == "retrieve":
            return qs
        if status_param:
            qs = qs.filter(status=status_param)
            if status_param == "OBSOLETE" and not include_obsolete:
                qs = qs.none()
        elif not include_obsolete:
            qs = qs.exclude(status="OBSOLETE")
        fg_type = str(self.request.query_params.get("fg_type") or "").upper()
        if fg_type in {"POUCH", "ROLL"}:
            qs = qs.filter(fg_type=fg_type)
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

    @action(detail=False, methods=["get"], url_path="route-dispatch")
    def route_dispatch(self, request):
        include_obsolete = str(request.query_params.get("include_obsolete") or "").lower() in {"1", "true", "yes"}
        include_samples = str(request.query_params.get("include_samples") or "").lower() in {"1", "true", "yes"}
        rows = TemplateDispatchService.audit_steps(include_obsolete=include_obsolete, include_samples=include_samples)
        status_counts = {}
        process_counts = {}
        for row in rows:
            status_counts[row["status"]] = status_counts.get(row["status"], 0) + 1
            process_counts[row["process_code"]] = process_counts.get(row["process_code"], 0) + 1
        needs_decision = sum(
            status_counts.get(key, 0)
            for key in {
                "NEEDS_DECISION",
                "NO_CAPABILITY",
                "INVALID_ALLOWED_WORK_CENTERS",
                "INVALID_DEFAULT_WORK_CENTER",
            }
        )
        return Response({
            "rows": rows,
            "status_counts": status_counts,
            "process_counts": process_counts,
            "total": len(rows),
            "needs_decision": needs_decision,
        })

    @action(detail=False, methods=["post"], url_path="route-dispatch/backfill")
    def route_dispatch_backfill(self, request):
        apply_changes = str(request.data.get("apply") or request.query_params.get("apply") or "").lower() in {"1", "true", "yes"}
        include_samples = str(request.data.get("include_samples") or request.query_params.get("include_samples") or "").lower() in {"1", "true", "yes"}
        result = TemplateDispatchService.backfill_auto_resolvable_steps(apply=apply_changes, include_samples=include_samples)
        return Response({
            "status": "applied" if apply_changes else "dry_run",
            **result,
        })

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        try:
            template = TemplateGovernanceService.approve_template(pk, request.user)
            return Response({"status": "template approved", "id": template.id, "template_status": template.status})
        except DjangoValidationError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["post"], url_path="request-review")
    def request_review(self, request, pk=None):
        try:
            template = TemplateGovernanceService.request_review(pk, request.user)
            return Response({"status": "template sent for engineering review", "id": template.id, "template_status": template.status})
        except DjangoValidationError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["post"])
    def publish(self, request, pk=None):
        try:
            template = TemplateGovernanceService.publish_template(pk)
            return Response({"status": "template is now LIVE", "id": template.id, "template_status": template.status})
        except DjangoValidationError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["get"], url_path="readiness")
    def readiness(self, request, pk=None):
        template = self.get_object()
        return Response(TemplateGovernanceService.readiness(template))

    @action(detail=True, methods=["post"], url_path="retire")
    def retire(self, request, pk=None):
        if not _is_admin_actor(request.user):
            return Response({"detail": "Only admin users can disable templates."}, status=status.HTTP_403_FORBIDDEN)
        template = TemplateGovernanceService.retire_template(pk)
        return Response({
            "status": "template disabled",
            "id": template.id,
            "template_status": template.status,
            "message": "Template is obsolete and no longer blocks route or process deletion.",
        })

    @action(detail=True, methods=["post"], url_path="clone")
    def clone(self, request, pk=None):
        template = TemplateGovernanceService.clone_template(pk, request.user)
        return Response(TemplateDetailSerializer(template, context=self.get_serializer_context()).data, status=status.HTTP_201_CREATED)

    def _route_sync_plan(self, template):
        return TemplateGovernanceService.route_sync_plan(template)

    def _serialize_route_sync_preview(self, plan):
        return TemplateGovernanceService.serialize_route_sync_preview(plan)

    def _apply_route_sync(self, template, *, destructive=False):
        return TemplateGovernanceService.apply_route_sync(template, destructive=destructive)

    @action(detail=True, methods=["get"], url_path="route-steps")
    def route_steps(self, request, pk=None):
        template = self.get_object()
        process_steps = list(template.process_steps.select_related("process").filter(is_removed_from_route=False).order_by("sequence_number"))
        if process_steps:
            return Response([
                {
                    "id": str(step.id),
                    "index": index,
                    "sequence_number": step.sequence_number,
                    "label": f"Step {step.sequence_number} - {step.process.name}",
                    "process_code": step.process.code,
                    "name": step.process.name,
                    "input_form": step.process.input_form,
                    "output_form": step.process.output_form,
                    "roll_behavior": step.process.roll_behavior,
                    "process_transition": step.process.transition or f"{step.process.input_form}_TO_{step.process.output_form}",
                    "process_has_artwork": bool(step.process.has_artwork or step.process.print_capable),
                    "process_print_capable": bool(step.process.print_capable or step.process.has_artwork),
                    "requires_recipe": bool(step.process.requires_recipe),
                    "requires_substrate_prep": bool(step.process.requires_substrate_prep),
                    "requires_lamination_adhesive": bool(step.process.requires_lamination_adhesive),
                    "dispatch_status": TemplateDispatchService.step_status(step),
                    "notes": step.notes or "",
                }
                for index, step in enumerate(process_steps)
            ])

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
                    "process_transition": (proc.transition or f"{proc.input_form}_TO_{proc.output_form}") if proc else "BULK_TO_ROLL",
                    "process_has_artwork": bool(proc and (proc.has_artwork or proc.print_capable)),
                    "process_print_capable": bool(proc and (proc.print_capable or proc.has_artwork)),
                    "requires_recipe": bool(proc and proc.requires_recipe),
                    "requires_substrate_prep": bool(proc and proc.requires_substrate_prep),
                    "requires_lamination_adhesive": bool(proc and proc.requires_lamination_adhesive),
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
            if "cost_absorption_group" in request.data:
                step.cost_absorption_group_id = request.data.get("cost_absorption_group") or None
            step.save()
            return Response(TemplateProcessStepSerializer(step).data)

        step.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["get", "patch"], url_path="process-steps/(?P<step_id>[^/.]+)/dispatch")
    def process_step_dispatch(self, request, pk=None, step_id=None):
        template = self.get_object()
        try:
            step = TemplateProcessStep.objects.select_related(
                "process",
                "default_work_center",
                "default_work_center__plant",
            ).get(id=step_id, template=template)
        except TemplateProcessStep.DoesNotExist:
            return Response({"detail": "Step not found"}, status=status.HTTP_404_NOT_FOUND)

        if request.method == "GET":
            return Response(TemplateProcessStepSerializer(step).data)

        if template.status == "OBSOLETE":
            return Response({"detail": "Cannot update dispatch on an obsolete template."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            updated = TemplateDispatchService.update_step_dispatch(
                step,
                allowed_work_center_ids=request.data.get("allowed_work_center_ids", []),
                default_work_center_id=request.data.get("default_work_center") or request.data.get("default_work_center_id"),
                selection_policy=request.data.get("work_center_selection_policy"),
                notes=request.data.get("dispatch_notes"),
            )
            self._audit_master_change("UPDATE", template)
            return Response(TemplateProcessStepSerializer(updated).data)
        except DjangoValidationError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

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

        if category_code not in TemplateGovernanceService.SUPPORTED_CATEGORY_CODES:
            return _template_bad_request(
                "Unsupported material category.",
                field_errors={
                    "category_code": [
                        "Use GRANULE, ADHESIVE, SOLVENT, ADDON, or POD. Legacy INK/CHEMICAL rows remain readable but cannot be newly added."
                    ]
                },
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

    @action(detail=True, methods=["post"], url_path="process-steps/reorder")
    def reorder_process_steps(self, request, pk=None):
        template = self.get_object()
        if template.status in {"LIVE", "OBSOLETE"}:
            return Response({"detail": "Cannot reorder process steps on a LIVE or OBSOLETE template."}, status=status.HTTP_400_BAD_REQUEST)
        rows = request.data.get("steps")
        if not isinstance(rows, list):
            return Response({"detail": "steps must be a list of {id, sequence_number} rows."}, status=status.HTTP_400_BAD_REQUEST)
        steps = {str(step.id): step for step in template.process_steps.all()}
        seen_sequences = set()
        for row in rows:
            step = steps.get(str((row or {}).get("id") or ""))
            sequence = (row or {}).get("sequence_number")
            if not step or sequence is None:
                return Response({"detail": "Each row must include a valid id and sequence_number."}, status=status.HTTP_400_BAD_REQUEST)
            sequence = int(sequence)
            if sequence in seen_sequences:
                return Response({"detail": "sequence_number values must be unique."}, status=status.HTTP_400_BAD_REQUEST)
            seen_sequences.add(sequence)
            step.sequence_number = sequence
        pending = [steps[str((row or {}).get("id") or "")] for row in rows]
        for index, step in enumerate(pending, start=1):
            step.sequence_number = -1000 - index
            step.save(update_fields=["sequence_number", "updated_at"])
        for row in rows:
            step = steps[str((row or {}).get("id") or "")]
            step.sequence_number = int((row or {}).get("sequence_number"))
            step.save(update_fields=["sequence_number", "updated_at"])
        return Response(TemplateProcessStepSerializer(template.process_steps.select_related("process").prefetch_related("materials").all(), many=True).data)

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
