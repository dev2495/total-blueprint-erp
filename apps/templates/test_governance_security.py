from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.factory.models import Plant, Process, WorkCenter, WorkCenterProcess
from apps.routing.models import RoutingRule
from apps.templates.models import (
    TemplateBlueprint,
    TemplateProcessStep,
    TemplateProcessStepMaterial,
    TemplateProcessStepRollSpec,
)
from apps.users.models import Role


@override_settings(STRICT_RBAC=True)
class TemplateGovernanceSecurityTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.users = {}
        for code in ("ENGINEERING", "ADMIN", "OWNER", "SALES", "PLANNER", "WATCHMAN"):
            role, _ = Role.objects.get_or_create(code=code, defaults={"name": code})
            cls.users[code] = get_user_model().objects.create_user(
                username=f"template_security_{code.lower()}",
                role=role,
            )
        cls.process = Process.objects.create(
            code="TPL_SECURITY",
            name="Template Security Process",
            input_form="BULK",
            output_form="ROLL",
            roll_behavior="CREATE_NEW",
        )
        plant = Plant.objects.create(code="TPL-SEC", name="Template Security Plant")
        work_center = WorkCenter.objects.create(
            plant=plant, code="TPL-SEC-WC", name="Template Security Work Center"
        )
        WorkCenterProcess.objects.create(work_center=work_center, process=cls.process)
        cls.route = RoutingRule.objects.create(
            name="Template Security Route", ordered_processes=[cls.process.code]
        )
        cls.live = TemplateBlueprint.objects.create(
            name="Published template", fg_type="ROLL", status="LIVE", routing_rule=cls.route
        )
        cls.draft = TemplateBlueprint.objects.create(
            name="Editable template", fg_type="ROLL", routing_rule=cls.route
        )
        cls.live_step = TemplateProcessStep.objects.create(
            template=cls.live, process=cls.process, sequence_number=1
        )
        cls.unmapped_live_step = TemplateProcessStep.objects.create(
            template=cls.live, process=cls.process, sequence_number=2
        )
        cls.draft_step = TemplateProcessStep.objects.create(
            template=cls.draft, process=cls.process, sequence_number=1
        )
        cls.live_material = cls._material(cls.live_step)
        cls.draft_material = cls._material(cls.draft_step)
        cls.draft_spec = TemplateProcessStepRollSpec.objects.create(
            template_step=cls.draft_step, notes="Original handling"
        )

    @staticmethod
    def _material(step, category_code="GRANULE"):
        return TemplateProcessStepMaterial.objects.create(
            template_step=step,
            source_kind="CATEGORY",
            category_code=category_code,
            consumption_basis="FIXED_KG",
            quantity_mode="KG",
            value=1,
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.users["ENGINEERING"])

    @staticmethod
    def _detail(template):
        return f"/api/templates/{template.id}/"

    @classmethod
    def _step(cls, template, step):
        return f"{cls._detail(template)}process-steps/{step.id}/"

    @classmethod
    def _material_detail(cls, template, step, material):
        return f"{cls._step(template, step)}materials/{material.id}/"

    def test_crud_create_cannot_choose_lifecycle_state_for_manage_roles(self):
        for role in ("ENGINEERING", "ADMIN", "OWNER"):
            for desired_status in ("ENGINEERING", "APPROVED", "LIVE", "OBSOLETE"):
                with self.subTest(role=role, status=desired_status):
                    self.client.force_authenticate(self.users[role])
                    response = self.client.post(
                        "/api/templates/",
                        {"name": f"{role} {desired_status}", "fg_type": "ROLL", "status": desired_status},
                        format="json",
                    )
                    self.assertEqual(response.status_code, 201, response.data)
                    created = TemplateBlueprint.objects.get(id=response.data["id"])
                    self.assertEqual(created.status, "DRAFT")
                    self.assertIsNone(created.approved_by_id)
                    self.assertIsNone(created.approved_at)

    def test_crud_patch_cannot_choose_lifecycle_state_but_preserves_draft_edits(self):
        for role in ("ENGINEERING", "ADMIN", "OWNER"):
            for desired_status in ("ENGINEERING", "APPROVED", "LIVE", "OBSOLETE"):
                with self.subTest(role=role, status=desired_status):
                    self.client.force_authenticate(self.users[role])
                    response = self.client.patch(
                        self._detail(self.draft),
                        {"name": f"Edited by {role}", "status": desired_status},
                        format="json",
                    )
                    self.assertEqual(response.status_code, 200, response.data)
                    self.draft.refresh_from_db()
                    self.assertEqual(self.draft.status, "DRAFT")
                    self.assertEqual(self.draft.name, f"Edited by {role}")
                    self.assertIsNone(self.draft.approved_by_id)

    def test_view_only_roles_cannot_write_or_run_lifecycle_actions(self):
        for role in ("SALES", "PLANNER", "WATCHMAN"):
            with self.subTest(role=role):
                self.client.force_authenticate(self.users[role])
                responses = [
                    self.client.post("/api/templates/", {"name": "Forbidden", "fg_type": "ROLL"}, format="json"),
                    self.client.patch(self._detail(self.draft), {"status": "LIVE"}, format="json"),
                ]
                for action in ("request-review", "approve", "publish"):
                    responses.append(self.client.post(f"{self._detail(self.draft)}{action}/", {}, format="json"))
                for response in responses:
                    self.assertEqual(response.status_code, 403, response.data)
        self.draft.refresh_from_db()
        self.assertEqual(self.draft.status, "DRAFT")

    def test_engineering_dedicated_lifecycle_publishes_and_retires_previous_version(self):
        self.draft.version_group = self.live.version_group
        self.draft.source_template = self.live
        self.draft.version = 2
        self.draft.save(update_fields=["version_group", "source_template", "version"])
        for action, expected_status in (
            ("request-review", "ENGINEERING"), ("approve", "APPROVED"), ("publish", "LIVE")
        ):
            response = self.client.post(f"{self._detail(self.draft)}{action}/", {}, format="json")
            self.assertEqual(response.status_code, 200, response.data)
            self.draft.refresh_from_db()
            self.assertEqual(self.draft.status, expected_status)
        self.assertEqual(self.draft.approved_by_id, self.users["ENGINEERING"].id)
        self.assertIsNotNone(self.draft.approved_at)
        self.live.refresh_from_db()
        self.assertEqual(self.live.status, "OBSOLETE")
        self.assertFalse(self.live.is_current_version)
        self.assertEqual(self.live.superseded_by_id, self.draft.id)

    def test_dedicated_lifecycle_still_enforces_readiness_and_approval(self):
        unready = TemplateBlueprint.objects.create(name="Unready", fg_type="ROLL")
        for action in ("request-review", "approve", "publish"):
            response = self.client.post(f"{self._detail(unready)}{action}/", {}, format="json")
            self.assertEqual(response.status_code, 400, response.data)
        response = self.client.post(f"{self._detail(self.draft)}publish/", {}, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        self.draft.refresh_from_db()
        self.assertEqual(self.draft.status, "DRAFT")

    def test_material_put_cannot_use_draft_url_to_modify_live_mapping(self):
        response = self.client.put(
            self._material_detail(self.draft, self.live_step, self.live_material),
            {"value": 5}, format="json",
        )
        self.assertEqual(response.status_code, 404, response.data)
        self.live_material.refresh_from_db()
        self.assertEqual(self.live_material.value, 1)

    def test_material_delete_cannot_use_draft_url_to_delete_live_mapping(self):
        response = self.client.delete(self._material_detail(self.draft, self.live_step, self.live_material))
        self.assertEqual(response.status_code, 404, response.data)
        self.assertTrue(TemplateProcessStepMaterial.objects.filter(id=self.live_material.id).exists())

    def test_material_update_cannot_reparent_mapping_but_allows_quantity_edit(self):
        response = self.client.put(
            self._material_detail(self.draft, self.draft_step, self.draft_material),
            {"template_step": str(self.unmapped_live_step.id), "value": 3}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.draft_material.refresh_from_db()
        self.assertEqual(self.draft_material.template_step_id, self.draft_step.id)
        self.assertEqual(self.draft_material.value, 3)
        self.assertEqual(TemplateProcessStepMaterial.objects.filter(template_step=self.live_step).count(), 1)
        self.assertFalse(TemplateProcessStepMaterial.objects.filter(template_step=self.unmapped_live_step).exists())

    def test_material_category_edit_preserves_duplicate_validation_on_owned_step(self):
        self._material(self.draft_step, category_code="SOLVENT")
        response = self.client.put(
            self._material_detail(self.draft, self.draft_step, self.draft_material),
            {"category_code": "SOLVENT"}, format="json",
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.draft_material.refresh_from_db()
        self.assertEqual(self.draft_material.category_code, "GRANULE")

    def test_material_create_uses_scoped_step_and_draft_delete_remains_available(self):
        response = self.client.post(
            f"{self._step(self.draft, self.draft_step)}materials/",
            {"category_code": "SOLVENT", "template_step": str(self.live_step.id)}, format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        created = TemplateProcessStepMaterial.objects.get(id=response.data["data"]["id"])
        self.assertEqual(created.template_step_id, self.draft_step.id)
        response = self.client.delete(self._material_detail(self.draft, self.draft_step, created))
        self.assertEqual(response.status_code, 204)
        self.assertFalse(TemplateProcessStepMaterial.objects.filter(id=created.id).exists())

    def test_roll_handling_cannot_reparent_spec_but_allows_notes_edit(self):
        response = self.client.patch(
            f"{self._step(self.draft, self.draft_step)}roll-handling/",
            {"template_step": str(self.live_step.id), "notes": "Revised handling"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.draft_spec.refresh_from_db()
        self.assertEqual(self.draft_spec.template_step_id, self.draft_step.id)
        self.assertEqual(self.draft_spec.notes, "Revised handling")
        self.assertFalse(TemplateProcessStepRollSpec.objects.filter(template_step=self.live_step).exists())

    def test_denied_roll_handling_patch_does_not_initialize_immutable_template_spec(self):
        for template_status in ("LIVE", "OBSOLETE"):
            with self.subTest(status=template_status):
                self.live.status = template_status
                self.live.save(update_fields=["status"])
                before_count = TemplateProcessStepRollSpec.objects.count()
                response = self.client.patch(
                    f"{self._step(self.live, self.live_step)}roll-handling/",
                    {"notes": "Forbidden"}, format="json",
                )
                self.assertEqual(response.status_code, 400, response.data)
                self.assertEqual(TemplateProcessStepRollSpec.objects.count(), before_count)
                self.assertFalse(TemplateProcessStepRollSpec.objects.filter(template_step=self.live_step).exists())

    def test_allowed_draft_roll_handling_patch_initializes_and_saves_spec(self):
        self.draft_spec.delete()
        response = self.client.patch(
            f"{self._step(self.draft, self.draft_step)}roll-handling/",
            {"notes": "New handling"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        spec = TemplateProcessStepRollSpec.objects.get(template_step=self.draft_step)
        self.assertEqual(spec.notes, "New handling")

    def test_adjacent_step_routes_reject_foreign_template_identity(self):
        foreign_step_url = self._step(self.draft, self.live_step)
        responses = [
            self.client.put(foreign_step_url, {"notes": "Forbidden"}, format="json"),
            self.client.delete(foreign_step_url),
            self.client.patch(f"{foreign_step_url}dispatch/", {}, format="json"),
            self.client.patch(f"{foreign_step_url}roll-handling/", {"notes": "Forbidden"}, format="json"),
            self.client.post(f"{foreign_step_url}materials/", {"category_code": "SOLVENT"}, format="json"),
        ]
        for response in responses:
            self.assertEqual(response.status_code, 404, response.data)
        self.live_step.refresh_from_db()
        self.assertEqual(self.live_step.template_id, self.live.id)
        self.assertEqual(self.live_step.notes, "")
        self.assertFalse(TemplateProcessStepRollSpec.objects.filter(template_step=self.live_step).exists())
