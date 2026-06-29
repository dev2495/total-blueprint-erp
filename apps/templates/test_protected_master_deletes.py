from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.factory.models import Process
from apps.factory.views import ProcessViewSet
from apps.routing.models import RoutingRule
from apps.routing.views import RoutingRuleViewSet
from apps.templates.models import TemplateBlueprint, TemplateProcessStep
from apps.templates.views import TemplateBlueprintViewSet
from apps.users.models import Role


class ProtectedMasterDeleteTests(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        role = Role.objects.create(
            code="ADMIN",
            name="Admin",
            default_permissions=["factory.manage", "templates.manage"],
        )
        self.user = get_user_model().objects.create_user(
            username="protected_delete_admin",
            email="protected_delete_admin@example.com",
            password="pass1234",
            role=role,
        )
        engineering_role = Role.objects.create(
            code="ENGINEERING",
            name="Engineering",
            default_permissions=["factory.manage", "templates.manage"],
        )
        self.engineering_user = get_user_model().objects.create_user(
            username="protected_delete_engineering",
            email="protected_delete_engineering@example.com",
            password="pass1234",
            role=engineering_role,
        )
        self.process = Process.objects.create(
            code="PROTECTED_PROC",
            name="Protected Process",
            input_form="ROLL",
            output_form="ROLL",
            roll_behavior="MODIFY_EXISTING",
        )
        self.route = RoutingRule.objects.create(
            name="Protected Route",
            ordered_processes=[self.process.code],
        )
        self.template = TemplateBlueprint.objects.create(
            name="Protected Template",
            fg_type="ROLL",
            routing_rule=self.route,
        )
        TemplateProcessStep.objects.create(
            template=self.template,
            sequence_number=1,
            process=self.process,
        )

    def test_process_delete_returns_conflict_when_used_by_template_step(self):
        view = ProcessViewSet.as_view({"delete": "destroy"})
        request = self.factory.delete(f"/api/factory/processes/{self.process.id}/")
        force_authenticate(request, user=self.user)

        response = view(request, pk=self.process.id)

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertIn("routing rules", response.data["error"])
        self.assertTrue(Process.objects.filter(id=self.process.id).exists())

    def test_routing_rule_delete_returns_conflict_when_used_by_template(self):
        view = RoutingRuleViewSet.as_view({"delete": "destroy"})
        request = self.factory.delete(f"/api/routing/rules/{self.route.id}/")
        force_authenticate(request, user=self.user)

        response = view(request, pk=self.route.id)

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertIn("active templates", response.data["error"])
        self.assertTrue(RoutingRule.objects.filter(id=self.route.id).exists())

    def test_engineering_template_manager_can_disable_template_but_not_delete_route_process(self):
        template_view = TemplateBlueprintViewSet.as_view({"post": "retire"})
        template_request = self.factory.post(f"/api/templates/{self.template.id}/retire/")
        force_authenticate(template_request, user=self.engineering_user)

        template_response = template_view(template_request, pk=self.template.id)

        self.assertEqual(template_response.status_code, status.HTTP_200_OK)
        self.template.refresh_from_db()
        self.assertEqual(self.template.status, "OBSOLETE")

        route_view = RoutingRuleViewSet.as_view({"delete": "destroy"})
        route_request = self.factory.delete(f"/api/routing/rules/{self.route.id}/")
        force_authenticate(route_request, user=self.engineering_user)

        route_response = route_view(route_request, pk=self.route.id)

        self.assertEqual(route_response.status_code, status.HTTP_409_CONFLICT)

        process_view = ProcessViewSet.as_view({"delete": "destroy"})
        process_request = self.factory.delete(f"/api/factory/processes/{self.process.id}/")
        force_authenticate(process_request, user=self.engineering_user)

        process_response = process_view(process_request, pk=self.process.id)

        self.assertEqual(process_response.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_disable_template_preserves_route_and_step_history(self):
        retire_view = TemplateBlueprintViewSet.as_view({"post": "retire"})
        retire_request = self.factory.post(f"/api/templates/{self.template.id}/retire/")
        force_authenticate(retire_request, user=self.user)

        retire_response = retire_view(retire_request, pk=self.template.id)

        self.assertEqual(retire_response.status_code, status.HTTP_200_OK)
        self.template.refresh_from_db()
        self.assertEqual(self.template.status, "OBSOLETE")
        self.assertEqual(self.template.routing_rule_id, self.route.id)
        self.assertTrue(TemplateProcessStep.objects.filter(template=self.template).exists())

        list_view = TemplateBlueprintViewSet.as_view({"get": "list"})
        default_list_request = self.factory.get("/api/templates/")
        force_authenticate(default_list_request, user=self.user)
        default_list_response = list_view(default_list_request)
        self.assertNotIn(str(self.template.id), {str(row["id"]) for row in default_list_response.data})

        admin_list_request = self.factory.get("/api/templates/?include_obsolete=1")
        force_authenticate(admin_list_request, user=self.user)
        admin_list_response = list_view(admin_list_request)
        self.assertIn(str(self.template.id), {str(row["id"]) for row in admin_list_response.data})

        route_view = RoutingRuleViewSet.as_view({"delete": "destroy"})
        route_request = self.factory.delete(f"/api/routing/rules/{self.route.id}/")
        force_authenticate(route_request, user=self.user)

        route_response = route_view(route_request, pk=self.route.id)

        self.assertEqual(route_response.status_code, status.HTTP_409_CONFLICT)
        self.assertTrue(RoutingRule.objects.filter(id=self.route.id).exists())

        process_view = ProcessViewSet.as_view({"delete": "destroy"})
        process_request = self.factory.delete(f"/api/factory/processes/{self.process.id}/")
        force_authenticate(process_request, user=self.user)

        process_response = process_view(process_request, pk=self.process.id)

        self.assertEqual(process_response.status_code, status.HTTP_409_CONFLICT)
        self.assertTrue(Process.objects.filter(id=self.process.id).exists())

    def test_template_manager_can_disable_route_without_deleting_history(self):
        route_view = RoutingRuleViewSet.as_view({"post": "disable"})
        route_request = self.factory.post(f"/api/routing/rules/{self.route.id}/disable/")
        force_authenticate(route_request, user=self.engineering_user)

        route_response = route_view(route_request, pk=self.route.id)

        self.assertEqual(route_response.status_code, status.HTTP_200_OK)
        self.route.refresh_from_db()
        self.assertFalse(self.route.is_active)

    def test_route_sequence_edit_is_blocked_when_current_template_uses_route(self):
        view = RoutingRuleViewSet.as_view({"patch": "partial_update"})
        request = self.factory.patch(
            f"/api/routing/rules/{self.route.id}/",
            {"ordered_processes": [self.process.code, "NEXT_PROC"]},
            format="json",
        )
        force_authenticate(request, user=self.engineering_user)

        response = view(request, pk=self.route.id)

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertIn("locked", response.data["error"])
        self.route.refresh_from_db()
        self.assertEqual(self.route.ordered_processes, [self.process.code])
