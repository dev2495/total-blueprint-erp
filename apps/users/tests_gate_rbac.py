from datetime import timedelta

from django.test import TestCase, override_settings
from django.core.exceptions import ValidationError
from rest_framework.request import Request
from rest_framework.test import APIClient, APIRequestFactory
from rest_framework_simplejwt.tokens import RefreshToken

from apps.factory.models import Plant
from apps.gate.models import GateAssignment
from apps.gate.services import gate_today
from apps.users.authentication import CookieJWTAuthentication
from apps.users.models import Role, User
from apps.users.permission_registry import effective_permissions_for_role, is_assignable_permission
from apps.users.permission_service import PermissionService
from apps.users.serializers import UserSerializer


@override_settings(STRICT_RBAC=False)
class WatchmanIsolationTests(TestCase):
    def setUp(self):
        self.role, _ = Role.objects.get_or_create(code="WATCHMAN", defaults={"name": "Watchman"})
        self.role.default_permissions = ["*", "master.manage", "gate.reports"]
        self.role.save()
        self.user = User.objects.create_user(username="gate_guard", email="guard@example.com", password="Guard-Access-2026!", role=self.role, extra_permissions=["*", "analytics.view", "gate.reports"])
        self.plant = Plant.objects.create(name="Assigned gate", code="GATE_SCOPE")
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(self.user).access_token}")

    def test_watchman_permissions_ignore_wildcards_and_stale_extras(self):
        self.user.effective_role_code = "OWNER"
        self.assertEqual(set(PermissionService.get_user_permissions(self.user)), set(effective_permissions_for_role("WATCHMAN")))
        self.assertEqual(PermissionService.get_entitlements(self.user)["role"], "WATCHMAN")
        self.assertEqual(PermissionService.get_landing_route(self.user), "/gate")

    def test_watchman_real_bearer_denied_other_erp_even_when_strict_mode_disabled(self):
        for path in ("/api/master/materials/", "/api/sales/orders/", "/api/analytics/control-tower/", "/api/users/users/", "/api/factory/plants/", "/api/system/company-profile/"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 403)
        self.assertEqual(self.client.post("/api/inventory/adjustments/", {}, format="json").status_code, 403)

    def test_watchman_cookie_denied_other_erp_and_self_profile_allowed(self):
        self.client.credentials()
        self.client.cookies["access"] = str(RefreshToken.for_user(self.user).access_token)
        self.assertEqual(self.client.get("/api/analytics/reports/gate/").status_code, 403)
        response = self.client.get("/api/users/me/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data["entitlements"]["landing_page"], "/gate")
        self.assertEqual(response.data["gate_plant_ids"], [])

    @override_settings(ALLOW_ROLE_OVERRIDE=True)
    def test_watchman_owner_flags_and_override_still_cannot_escape(self):
        self.user.is_owner = True
        self.user.is_superuser = True
        self.user.save(update_fields=["is_owner", "is_superuser"])
        self.assertEqual(self.client.get("/api/analytics/control-tower/", HTTP_X_ROLE_OVERRIDE="OWNER").status_code, 403)
        response = self.client.get("/api/users/me/", HTTP_X_ROLE_OVERRIDE="OWNER")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(response.data["is_owner"])
        self.assertFalse(response.data["entitlements"]["is_owner"])
        self.assertEqual(response.data["entitlements"]["role"], "WATCHMAN")

    def test_gate_assignment_changes_explicit_context_and_rejects_unknown_ids_atomically(self):
        PermissionService.assign_gate_plants(self.user, [str(self.plant.id), str(self.plant.id)])
        self.assertEqual(PermissionService.get_assigned_context(self.user)["gate_plants"], [self.plant.id])
        with self.assertRaises(ValidationError):
            PermissionService.assign_gate_plants(self.user, ["e9bb24ed-14ac-4ec2-acb0-b1721734dcaf"])
        self.assertEqual(GateAssignment.objects.filter(user=self.user).count(), 1)

    def test_owner_gate_capabilities_cannot_be_user_overrides(self):
        self.assertTrue(is_assignable_permission("gate.reports"))
        for permission in ("gate.view", "gate.reconcile", "gate.audit", "gate.private"):
            self.assertFalse(is_assignable_permission(permission))

    def test_new_watchman_user_cannot_be_created_with_owner_flag(self):
        serializer = UserSerializer(data={"username": "gate_illegal", "email": "illegal@example.com", "password": "Gate-Manager-2026!", "role_id": str(self.role.id), "is_owner": True})
        self.assertFalse(serializer.is_valid())
        self.assertIn("is_owner", serializer.errors)


@override_settings(STRICT_RBAC=False, ALLOW_ROLE_OVERRIDE=True)
class GateRolePreviewAuthenticationTests(TestCase):
    def setUp(self):
        owner_role, _ = Role.objects.get_or_create(code="OWNER", defaults={"name": "Owner"})
        watchman_role, _ = Role.objects.get_or_create(code="WATCHMAN", defaults={"name": "Watchman"})
        self.owner = User.objects.create_user(username="preview_owner", role=owner_role, is_owner=True)
        self.watchman = User.objects.create_user(username="preview_watchman", role=watchman_role, is_owner=True, is_superuser=True, extra_permissions=["*"])
        self.plant = Plant.objects.create(name="Preview assigned gate", code="GATE_PREVIEW")
        self.other_plant = Plant.objects.create(name="Preview other gate", code="GATE_OTHER")
        GateAssignment.objects.create(user=self.owner, plant=self.plant)
        GateAssignment.objects.create(user=self.watchman, plant=self.plant)

    def _client(self, user, token_path):
        client = APIClient()
        token = str(RefreshToken.for_user(user).access_token)
        if token_path == "bearer":
            client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        else:
            client.cookies["access"] = token
        return client

    def test_real_owner_token_watchman_preview_restricts_gate_scope(self):
        yesterday = str(gate_today() - timedelta(days=1))
        for token_path in ("bearer", "cookie"):
            client = self._client(self.owner, token_path)
            preview = {"HTTP_X_ROLE_OVERRIDE": "WATCHMAN"}
            with self.subTest(token_path=token_path):
                # An ordinary owner token retains its actual owner access.
                self.assertEqual(client.get("/api/gate/audit/").status_code, 200)
                for path in ("/api/gate/audit/", "/api/gate/qr/", "/api/gate/reports/", "/api/gate/goods/e9bb24ed-14ac-4ec2-acb0-b1721734dcaf/", "/api/gate/visitors/?status=EXITED", f"/api/gate/goods/?date_from={yesterday}&date_to={yesterday}", "/api/analytics/reports/gate/"):
                    with self.subTest(path=path):
                        self.assertEqual(client.get(path, **preview).status_code, 403)
                response = client.get("/api/gate/masters/", **preview)
                self.assertEqual(response.status_code, 200, response.content)
                self.assertEqual([row["id"] for row in response.data["plants"]], [str(self.plant.id)])
                self.assertEqual(client.get(f"/api/gate/masters/?plant={self.other_plant.id}", **preview).status_code, 403)

    def test_real_watchman_token_owner_preview_keeps_actual_role_ceiling(self):
        for token_path in ("bearer", "cookie"):
            client = self._client(self.watchman, token_path)
            with self.subTest(token_path=token_path):
                for path in ("/api/gate/audit/", "/api/gate/reports/", "/api/analytics/reports/gate/", "/api/factory/plants/"):
                    self.assertEqual(client.get(path, HTTP_X_ROLE_OVERRIDE="OWNER").status_code, 403)
                response = client.get("/api/gate/masters/", HTTP_X_ROLE_OVERRIDE="OWNER")
                self.assertEqual(response.status_code, 200, response.content)
                self.assertEqual([row["id"] for row in response.data["plants"]], [str(self.plant.id)])

    @override_settings(ALLOW_ROLE_OVERRIDE=False)
    def test_disabled_preview_header_preserves_actual_owner_access(self):
        for token_path in ("bearer", "cookie"):
            client = self._client(self.owner, token_path)
            with self.subTest(token_path=token_path):
                self.assertEqual(client.get("/api/gate/audit/", HTTP_X_ROLE_OVERRIDE="WATCHMAN").status_code, 200)

    def test_authentication_does_not_copy_another_actors_role(self):
        token = str(RefreshToken.for_user(self.owner).access_token)
        raw = APIRequestFactory().get("/api/gate/audit/", HTTP_AUTHORIZATION=f"Bearer {token}")
        raw.user = self.watchman
        raw.user.effective_role_code = "WATCHMAN"
        user, _ = CookieJWTAuthentication().authenticate(Request(raw))
        self.assertEqual(user.pk, self.owner.pk)
        self.assertFalse(hasattr(user, "effective_role_code"))
