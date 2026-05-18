from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.factory.models import Process
from apps.factory.views import ProcessViewSet
from apps.routing.models import RoutingRule
from apps.routing.views import RoutingRuleViewSet
from apps.templates.models import TemplateBlueprint, TemplateProcessStep
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
        self.assertIn("cannot be deleted", response.data["error"])
        self.assertTrue(Process.objects.filter(id=self.process.id).exists())

    def test_routing_rule_delete_returns_conflict_when_used_by_template(self):
        view = RoutingRuleViewSet.as_view({"delete": "destroy"})
        request = self.factory.delete(f"/api/routing/rules/{self.route.id}/")
        force_authenticate(request, user=self.user)

        response = view(request, pk=self.route.id)

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertIn("cannot be deleted", response.data["error"])
        self.assertTrue(RoutingRule.objects.filter(id=self.route.id).exists())
