from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIRequestFactory
from rest_framework.test import force_authenticate
from rest_framework import status

from apps.factory.models import Process
from apps.routing.models import RoutingRule
from apps.users.models import Role

from apps.templates.models import (
    TemplateBlueprint,
    TemplateProcessStep,
    TemplateProcessStepMaterial,
    TemplateProcessStepRollSpec,
)
from apps.templates.serializers import TemplateProcessStepMaterialSerializer
from apps.templates.views import TemplateBlueprintViewSet
from apps.templates.services import TemplateGovernanceService


class TemplateStepContractTests(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.role_engineering = Role.objects.create(
            code="ENGINEERING",
            name="Engineering",
            default_permissions=["templates.view", "templates.manage"],
        )
        self.user = get_user_model().objects.create_user(
            username="template_tester",
            email="template_tester@example.com",
            password="pass1234",
            role=self.role_engineering,
        )
        self.process_a = Process.objects.create(
            code="PROC_A",
            name="Process A",
            input_form="BULK",
            output_form="ROLL",
            roll_behavior="CREATE_NEW",
        )
        self.process_b = Process.objects.create(
            code="PROC_B",
            name="Process B",
            input_form="ROLL",
            output_form="ROLL",
            roll_behavior="MODIFY_EXISTING",
        )
        self.process_c = Process.objects.create(
            code="PROC_C",
            name="Process C",
            input_form="ROLL",
            output_form="BULK",
            roll_behavior="NONE",
        )
        self.routing_rule = RoutingRule.objects.create(
            name="Template Sync Route",
            ordered_processes=["PROC_A", "PROC_B"],
        )
        self.template = TemplateBlueprint.objects.create(
            name="Template Contract Test",
            fg_type="ROLL",
            routing_rule=self.routing_rule,
        )

    def _view(self):
        view = TemplateBlueprintViewSet()
        view.request = self.factory.get("/api/templates/")
        view.kwargs = {}
        return view

    def test_schema_health_reports_healthy(self):
        response = self._view().schema_health(self.factory.get("/api/templates/schema-health/"))

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["healthy"])
        self.assertIn("compatible", response.data["message"].lower())

    def test_safe_sync_preserves_matching_steps_and_marks_stale(self):
        preserved_step = TemplateProcessStep.objects.create(
            template=self.template,
            sequence_number=1,
            process=self.process_a,
            notes="Keep me",
        )
        TemplateProcessStepRollSpec.objects.create(template_step=preserved_step)

        stale_step = TemplateProcessStep.objects.create(
            template=self.template,
            sequence_number=7,
            process=self.process_c,
            notes="Old contract",
        )
        TemplateProcessStepRollSpec.objects.create(template_step=stale_step)

        result = self._view()._apply_route_sync(self.template, destructive=False)

        preserved_step.refresh_from_db()
        stale_step.refresh_from_db()

        created_codes = {
            step.process.code for step in result["created_steps"]
        }
        kept_ids = {
            str(step.id) for step in result["kept_steps"]
        }

        self.assertIn("PROC_B", created_codes)
        self.assertIn(str(preserved_step.id), kept_ids)
        self.assertFalse(preserved_step.is_removed_from_route)
        self.assertTrue(stale_step.is_removed_from_route)
        self.assertIn("[STALE ROUTE STEP]", stale_step.notes)

    def test_route_steps_payload_is_enriched(self):
        view = self._view()
        view.get_object = lambda: self.template

        response = view.route_steps(self.factory.get("/api/templates/route-steps/"), pk=str(self.template.id))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 2)
        first = response.data[0]
        self.assertEqual(first["index"], 0)
        self.assertIn("label", first)
        self.assertEqual(first["process_code"], "PROC_A")
        self.assertEqual(first["input_form"], "BULK")
        self.assertEqual(first["output_form"], "ROLL")
        self.assertEqual(first["roll_behavior"], "CREATE_NEW")

    def test_partial_material_update_keeps_category_context(self):
        step = TemplateProcessStep.objects.create(
            template=self.template,
            sequence_number=1,
            process=self.process_a,
        )
        row = TemplateProcessStepMaterial.objects.create(
            template_step=step,
            source_kind="CATEGORY",
            category_code="INK",
            consumption_basis="SNAPSHOT_GSM",
            issue_policy_mode="NONE",
            issue_policy_value=0,
            capture_mode="AUTO_ESTIMATED_CONFIRM",
            quantity_mode="GSM",
            value=0,
            is_optional=False,
        )

        serializer = TemplateProcessStepMaterialSerializer(
            row,
            data={"issue_policy_mode": "PERCENT_OVER_THEORY", "issue_policy_value": 12},
            partial=True,
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
        updated = serializer.save()
        self.assertEqual(updated.category_code, "INK")
        self.assertEqual(updated.issue_policy_mode, "PERCENT_OVER_THEORY")
        self.assertEqual(float(updated.issue_policy_value), 12.0)

    def test_material_detail_endpoint_accepts_partial_payload(self):
        step = TemplateProcessStep.objects.create(
            template=self.template,
            sequence_number=1,
            process=self.process_a,
        )
        row = TemplateProcessStepMaterial.objects.create(
            template_step=step,
            source_kind="CATEGORY",
            category_code="CHEMICAL",
            consumption_basis="FIXED_KG",
            issue_policy_mode="NONE",
            issue_policy_value=0,
            capture_mode="AUTO_FROM_OUTPUT",
            quantity_mode="KG",
            value=1,
            is_optional=False,
        )

        view = TemplateBlueprintViewSet.as_view({"put": "process_step_material_detail"})
        request = self.factory.put(
            "/api/templates/materials/detail/",
            {"capture_mode": "OPERATOR_REQUIRED"},
            format="json",
        )
        force_authenticate(request, user=self.user)

        response = view(
            request,
            pk=str(self.template.id),
            step_id=str(step.id),
            mat_id=str(row.id),
        )
        self.assertEqual(response.status_code, 200)
        row.refresh_from_db()
        self.assertEqual(row.capture_mode, "OPERATOR_REQUIRED")

    def test_step_materials_post_minimal_payload_assigns_with_defaults(self):
        step = TemplateProcessStep.objects.create(
            template=self.template,
            sequence_number=1,
            process=self.process_a,
        )

        view = TemplateBlueprintViewSet.as_view({"post": "step_materials"})
        request = self.factory.post(
            "/api/templates/materials/",
            {
                "source_kind": "CATEGORY",
                "category_code": "INK",
            },
            format="json",
        )
        force_authenticate(request, user=self.user)
        response = view(request, pk=str(self.template.id), step_id=str(step.id))

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data.get("status"), "ok")
        data = response.data.get("data") or {}
        self.assertEqual(data.get("category_code"), "INK")

    def test_approve_marks_template_approved_not_live(self):
        TemplateGovernanceService.request_review(str(self.template.id), self.user)
        TemplateGovernanceService.approve_template(str(self.template.id), self.user)
        self.template.refresh_from_db()
        self.assertEqual(self.template.status, "APPROVED")
        self.assertIsNotNone(self.template.approved_by)

    def test_publish_auto_syncs_route_before_live(self):
        TemplateGovernanceService.request_review(str(self.template.id), self.user)
        TemplateGovernanceService.approve_template(str(self.template.id), self.user)
        TemplateGovernanceService.publish_template(str(self.template.id))
        self.template.refresh_from_db()
        self.assertEqual(self.template.status, "LIVE")
        self.assertEqual(
            self.template.process_steps.filter(is_removed_from_route=False).count(),
            2,
        )

    def test_addon_defaults_to_category_formula_driver(self):
        step = TemplateProcessStep.objects.create(
            template=self.template,
            sequence_number=1,
            process=self.process_a,
        )

        view = TemplateBlueprintViewSet.as_view({"post": "step_materials"})
        request = self.factory.post(
            "/api/templates/materials/",
            {
                "source_kind": "CATEGORY",
                "category_code": "ADDON",
            },
            format="json",
        )
        force_authenticate(request, user=self.user)
        response = view(request, pk=str(self.template.id), step_id=str(step.id))

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        data = response.data.get("data") or {}
        self.assertEqual(data.get("consumption_basis"), "CATEGORY_FORMULA")
        self.assertEqual(data.get("formula_driver"), "ADDON_MASTER_WEIGHT_MODE")

    def test_step_materials_duplicate_assignment_is_idempotent(self):
        step = TemplateProcessStep.objects.create(
            template=self.template,
            sequence_number=1,
            process=self.process_a,
        )

        first = TemplateProcessStepMaterial.objects.create(
            template_step=step,
            source_kind="CATEGORY",
            category_code="CHEMICAL",
            consumption_basis="FIXED_KG",
            issue_policy_mode="NONE",
            issue_policy_value=0,
            capture_mode="AUTO_ESTIMATED_CONFIRM",
            quantity_mode="KG",
            value=0,
        )

        view = TemplateBlueprintViewSet.as_view({"post": "step_materials"})
        request = self.factory.post(
            "/api/templates/materials/",
            {"source_kind": "CATEGORY", "category_code": "CHEMICAL"},
            format="json",
        )
        force_authenticate(request, user=self.user)
        response = view(request, pk=str(self.template.id), step_id=str(step.id))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data.get("status"), "ok")
        self.assertIn("already mapped", str(response.data.get("message", "")).lower())
        self.assertEqual((response.data.get("data") or {}).get("id"), str(first.id))
        self.assertEqual(
            TemplateProcessStepMaterial.objects.filter(
                template_step=step,
                source_kind="CATEGORY",
                category_code="CHEMICAL",
            ).count(),
            1,
        )

    def test_step_materials_invalid_category_returns_field_errors(self):
        step = TemplateProcessStep.objects.create(
            template=self.template,
            sequence_number=1,
            process=self.process_a,
        )
        view = TemplateBlueprintViewSet.as_view({"post": "step_materials"})
        request = self.factory.post(
            "/api/templates/materials/",
            {"source_kind": "CATEGORY", "category_code": ""},
            format="json",
        )
        force_authenticate(request, user=self.user)
        response = view(request, pk=str(self.template.id), step_id=str(step.id))

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data.get("status"), "error")
        self.assertIn("field_errors", response.data)
        self.assertIn("category_code", response.data.get("field_errors", {}))
