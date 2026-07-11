from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.response import Response
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import OperationalError, ProgrammingError
from django.db.models import Q

from apps.factory.models import Process
from apps.users.audit_mixins import MasterDataAuditMixin
from apps.users.permission_service import PermissionService

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


def _can_manage_templates(user) -> bool:
    if not getattr(user, "is_authenticated", False):
        return False
    if _is_admin_actor(user):
        return True
    permissions = set(PermissionService.get_user_permissions(user))
    return bool({"*", "templates.manage"} & permissions)


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
    editable_statuses = {"DRAFT", "ENGINEERING", "APPROVED"}

    def get_queryset(self):
        qs = super().get_queryset()
        if getattr(self, "action", None) == "list":
            qs = qs.select_related(
                "routing_rule",
                "created_by",
                "commercial_family",
                "source_template",
                "superseded_by",
            )
        lookup_kwarg = self.lookup_url_kwarg or self.lookup_field
        if getattr(self, "kwargs", {}).get(lookup_kwarg):
            return qs
        status_param = str(self.request.query_params.get("status") or "").upper()
        include_obsolete = str(self.request.query_params.get("include_obsolete") or "").lower() in {"1", "true", "yes"}
        include_versions = str(self.request.query_params.get("include_versions") or "").lower() in {"1", "true", "yes"}
        include_drafts = str(self.request.query_params.get("include_drafts") or "").lower() in {"1", "true", "yes"}

        if status_param:
            if status_param in self.editable_statuses and not include_drafts:
                return qs.none()
            if status_param == "OBSOLETE" and not include_obsolete:
                return qs.none()
            qs = qs.filter(status=status_param)
            if status_param == "LIVE" and not include_versions:
                qs = qs.filter(is_current_version=True)
            if status_param in self.editable_statuses and not include_versions:
                qs = qs.filter(is_current_version=True)
        elif include_drafts:
            if not include_versions and not include_obsolete:
                qs = qs.filter(is_current_version=True)
            if not include_obsolete:
                qs = qs.exclude(status="OBSOLETE")
        elif include_obsolete:
            qs = qs.filter(status__in=["LIVE", "OBSOLETE"])
            if not include_versions:
                qs = qs.filter(Q(status="OBSOLETE") | Q(is_current_version=True))
        else:
            qs = qs.filter(status="LIVE")
            if not include_versions:
                qs = qs.filter(is_current_version=True)
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
        if instance.routing_rule_id:
            TemplateGovernanceService.apply_route_sync(instance, destructive=False)
        self._audit_master_change("CREATE", instance)

    def perform_update(self, serializer):
        before_route_id = serializer.instance.routing_rule_id
        instance = serializer.save()
        route_changed = before_route_id != instance.routing_rule_id
        sync_result = None
        if route_changed and instance.routing_rule_id and instance.status not in {"LIVE", "OBSOLETE"}:
            sync_result = TemplateGovernanceService.apply_route_sync(instance, destructive=False)

        extra_details = {
            "before_routing_rule_id": str(before_route_id or ""),
            "after_routing_rule_id": str(instance.routing_rule_id or ""),
            "route_changed": route_changed,
        }
        if sync_result:
            extra_details.update(
                {
                    "route_sync_applied": True,
                    "steps_created": len(sync_result["created_steps"]),
                    "steps_preserved": len(sync_result["kept_steps"]),
                    "steps_marked_removed": len(sync_result["stale_steps"]),
                }
            )
        self._audit_master_change("UPDATE", instance, extra_details=extra_details)

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
        include_versions = str(request.query_params.get("include_versions") or "").lower() in {"1", "true", "yes"}
        rows = TemplateDispatchService.audit_steps(
            include_obsolete=include_obsolete,
            include_samples=include_samples,
            include_versions=include_versions,
        )
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
        include_versions = str(request.data.get("include_versions") or request.query_params.get("include_versions") or "").lower() in {"1", "true", "yes"}
        result = TemplateDispatchService.backfill_auto_resolvable_steps(
            apply=apply_changes,
            include_samples=include_samples,
            include_versions=include_versions,
        )
        return Response({
            "status": "applied" if apply_changes else "dry_run",
            **result,
        })

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        try:
            template = TemplateGovernanceService.approve_template(pk, request.user)
            self._audit_master_change("APPROVE", template)
            return Response({"status": "template approved", "id": template.id, "template_status": template.status})
        except DjangoValidationError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["post"], url_path="request-review")
    def request_review(self, request, pk=None):
        try:
            template = TemplateGovernanceService.request_review(pk, request.user)
            self._audit_master_change("REQUEST_REVIEW", template)
            return Response({"status": "template sent for engineering review", "id": template.id, "template_status": template.status})
        except DjangoValidationError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["post"])
    def publish(self, request, pk=None):
        try:
            before = TemplateBlueprint.objects.only("status", "is_current_version").get(id=pk)
            template = TemplateGovernanceService.publish_template(pk)
            self._audit_master_change(
                "PUBLISH",
                template,
                extra_details={
                    "before_status": before.status,
                    "after_status": template.status,
                    "before_is_current_version": before.is_current_version,
                    "after_is_current_version": template.is_current_version,
                    "version": template.version,
                    "version_group": str(template.version_group),
                    "revised_product_master_ids": getattr(template, "_revised_product_master_ids", []),
                    "revision_summary": getattr(template, "_product_master_revision_summary", {}),
                },
            )
            return Response({
                "status": "template is now LIVE",
                "id": template.id,
                "template_status": template.status,
                "revision_summary": getattr(template, "_product_master_revision_summary", {}),
            })
        except DjangoValidationError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["get"], url_path="readiness")
    def readiness(self, request, pk=None):
        template = self.get_object()
        return Response(TemplateGovernanceService.readiness(template))

    @action(detail=True, methods=["post"], url_path="retire")
    def retire(self, request, pk=None):
        if not _can_manage_templates(request.user):
            return Response({"detail": "Template manage permission is required to disable templates."}, status=status.HTTP_403_FORBIDDEN)
        before = TemplateBlueprint.objects.only("status", "is_current_version", "routing_rule").get(id=pk)
        template = TemplateGovernanceService.retire_template(pk)
        self._audit_master_change(
            "DISABLE",
            template,
            extra_details={
                "before_status": before.status,
                "after_status": template.status,
                "before_is_current_version": before.is_current_version,
                "after_is_current_version": template.is_current_version,
                "routing_rule_id": str(before.routing_rule_id or ""),
            },
        )
        return Response({
            "status": "template disabled",
            "id": template.id,
            "template_status": template.status,
            "message": "Template is disabled and hidden from sales, planner, and product-master selectors.",
        })

    @action(detail=False, methods=["post"], url_path="purge-drafts")
    def purge_drafts(self, request):
        if not _can_manage_templates(request.user):
            return Response({"detail": "Template manage permission is required to purge draft templates."}, status=status.HTTP_403_FORBIDDEN)
        apply_changes = str(request.data.get("apply") or request.query_params.get("apply") or "").lower() in {"1", "true", "yes"}
        result = TemplateGovernanceService.purge_draft_templates(apply=apply_changes)
        self._audit_master_change(
            "PURGE_DRAFTS",
            TemplateBlueprint(id="00000000-0000-0000-0000-000000000000", name="Draft templates"),
            extra_details={
                "apply": apply_changes,
                "scanned": result.get("scanned", 0),
                "deleted": result.get("deleted", 0),
                "disabled": result.get("disabled", 0),
                "selector_refs": result.get("selector_refs", {}),
                "blocked_refs": result.get("blocked_refs", {}),
            },
        )
        return Response({
            "status": "applied" if apply_changes else "dry_run",
            **result,
        })

    @action(detail=True, methods=["post"], url_path="clone")
    def clone(self, request, pk=None):
        template = TemplateGovernanceService.clone_template(pk, request.user)
        self._audit_master_change("CLONE", template)
        return Response(TemplateDetailSerializer(template, context=self.get_serializer_context()).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="edit-draft")
    def edit_draft(self, request, pk=None):
        try:
            template = TemplateGovernanceService.edit_draft(
                pk,
                request.user,
                correction_reason=str(request.data.get("reason") or "").strip(),
            )
            self._audit_master_change("SAFE_EDIT_DRAFT", template)
            return Response(TemplateDetailSerializer(template, context=self.get_serializer_context()).data, status=status.HTTP_201_CREATED)
        except DjangoValidationError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

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

        if template.status in {"LIVE", "OBSOLETE"}:
            return Response(
                {
                    "detail": "Cannot update dispatch on a LIVE or OBSOLETE template. Use Edit safely to create a correction draft."
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            updated = TemplateDispatchService.update_step_dispatch(
                step,
                allowed_work_center_ids=request.data.get("allowed_work_center_ids", []),
                default_work_center_id=request.data.get("default_work_center") or request.data.get("default_work_center_id"),
                selection_policy=request.data.get("work_center_selection_policy"),
                notes=request.data.get("dispatch_notes"),
                optional_at_planning=request.data.get("optional_at_planning")
                if "optional_at_planning" in request.data
                else None,
                skippable_after_previous_output=request.data.get("skippable_after_previous_output")
                if "skippable_after_previous_output" in request.data
                else None,
            )
            self._audit_master_change(
                "UPDATE_DISPATCH",
                template,
                extra_details={
                    "step_id": str(updated.id),
                    "process_code": updated.process.code,
                    "allowed_work_center_ids": updated.allowed_work_center_ids,
                    "default_work_center_id": str(updated.default_work_center_id or ""),
                    "work_center_selection_policy": updated.work_center_selection_policy,
                    "optional_at_planning": updated.optional_at_planning,
                    "skippable_after_previous_output": updated.skippable_after_previous_output,
                },
            )
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
        self._audit_master_change(
            "SYNC_ROUTE",
            template,
            extra_details={
                "routing_rule_id": str(template.routing_rule_id),
                "steps_created": len(result["created_steps"]),
                "steps_preserved": len(result["kept_steps"]),
                "steps_marked_removed": len(result["stale_steps"]),
            },
        )
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
        self._audit_master_change(
            "REBUILD_ROUTE",
            template,
            extra_details={
                "routing_rule_id": str(template.routing_rule_id),
                "steps_created": len(result["created_steps"]),
            },
        )
        return Response(
            {
                "status": "rebuilt",
                "steps_created": len(result["created_steps"]),
                "steps": TemplateProcessStepSerializer(result["created_steps"], many=True).data,
            }
        )
