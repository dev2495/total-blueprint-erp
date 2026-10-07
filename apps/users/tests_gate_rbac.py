from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch
import uuid

from django.test import TestCase, override_settings
from django.core.exceptions import ValidationError
from django.utils import timezone
from rest_framework.request import Request
from rest_framework.test import APIClient, APIRequestFactory
from rest_framework_simplejwt.tokens import RefreshToken

from apps.factory.models import Plant
from apps.analytics.models import ReportDistributionProfile
from apps.analytics.report_delivery import ReportDistributionService
from apps.gate.models import GateAssignment, VisitorVisit
from apps.gate.services import gate_today
from apps.users.authentication import CookieJWTAuthentication
from apps.users.models import Role, User
from apps.users.permission_registry import GATE_MASTER_PERMISSIONS, effective_permissions_for_role, is_assignable_permission
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
        self.assertFalse(response.data["is_superuser"])
        self.assertFalse(response.data["entitlements"]["is_owner"])
        self.assertFalse(response.data["entitlements"]["gate_master"])
        self.assertEqual(response.data["entitlements"]["role"], "WATCHMAN")

    def test_gate_assignment_changes_explicit_context_and_rejects_unknown_ids_atomically(self):
        PermissionService.assign_gate_plants(self.user, [str(self.plant.id), str(self.plant.id)])
        self.assertEqual(PermissionService.get_assigned_context(self.user)["gate_plants"], [self.plant.id])
        with self.assertRaises(ValidationError):
            PermissionService.assign_gate_plants(self.user, ["e9bb24ed-14ac-4ec2-acb0-b1721734dcaf"])
        self.assertEqual(GateAssignment.objects.filter(user=self.user).count(), 1)

    def test_master_gate_capabilities_cannot_be_user_overrides(self):
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

    def test_watchman_real_tokens_allow_exit_only_for_visitors_including_legacy_pending(self):
        for index, (actor, preview) in enumerate(((self.owner, "WATCHMAN"), (self.watchman, "OWNER"))):
            for offset, token_path in enumerate(("bearer", "cookie")):
                client = self._client(actor, token_path)
                headers = {"HTTP_X_ROLE_OVERRIDE": preview}
                suffix = index * 2 + offset
                pending = VisitorVisit.objects.create(plant=self.plant, name="Legacy pending visitor", mobile=f"987654320{suffix}", purpose="Meeting", status="PENDING", consent_at=timezone.now())
                with self.subTest(actor=actor.username, token_path=token_path):
                    for path in ("/api/gate/visitors/", f"/api/gate/visitors/{pending.pk}/check-in/", f"/api/gate/visitors/{pending.pk}/cancel/"):
                        with self.subTest(path=path):
                            self.assertEqual(client.post(path, {"client_token": str(uuid.uuid4())}, format="json", **headers).status_code, 403)
                    pending.refresh_from_db()
                    self.assertEqual(pending.status, "PENDING")
                    self.assertIsNone(pending.entry_at)
                    self.assertIsNone(pending.exit_at)
                    inside = VisitorVisit.objects.create(plant=self.plant, name="Entered visitor", mobile=f"987654321{suffix}", purpose="Meeting", status="INSIDE", consent_at=timezone.now(), entry_at=timezone.now())
                    response = client.post(f"/api/gate/visitors/{inside.pk}/check-out/", {"client_token": str(uuid.uuid4())}, format="json", **headers)
                    self.assertEqual(response.status_code, 200, response.content)
                    inside.refresh_from_db()
                    self.assertEqual(inside.status, "EXITED")
                    self.assertIsNotNone(inside.exit_at)


@override_settings(STRICT_RBAC=True, ALLOW_ROLE_OVERRIDE=True)
class GateMasterAuthenticationTests(TestCase):
    def setUp(self):
        self.masters = []
        for index, (code, flags) in enumerate((("ADMIN", {}), ("SUPER_ADMIN", {}), ("OWNER", {}), ("SALES", {"is_owner": True}), ("SALES", {"is_superuser": True}))):
            role, _ = Role.objects.get_or_create(code=code, defaults={"name": code})
            user = User.objects.create_user(username=f"actual_gate_master_{index}", email=f"master{index}@example.com", role=role, **flags)
            self.masters.append(user)
        self.plants = [Plant.objects.create(name=f"Master gate {index}", code=f"MASTER_GATE_{index}") for index in range(2)]

    def _client(self, user, token_path):
        client = APIClient(enforce_csrf_checks=True)
        token = str(RefreshToken.for_user(user).access_token)
        if token_path == "bearer":
            client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        else:
            client.cookies["access"] = token
            csrf = client.get("/api/users/csrf/")
            self.assertEqual(csrf.status_code, 200, csrf.content)
            client.credentials(HTTP_X_CSRFTOKEN=csrf.data["csrfToken"])
        return client

    def test_signed_master_tokens_have_full_gate_pack_in_owner_preview_without_assignments(self):
        for user in self.masters:
            for token_path in ("bearer", "cookie"):
                client = self._client(user, token_path)
                headers = {"HTTP_X_ROLE_OVERRIDE": "OWNER"}
                with self.subTest(actual_role=user.role.code, token_path=token_path, flags=(user.is_owner, user.is_superuser)):
                    response = client.get("/api/users/me/", **headers)
                    self.assertEqual(response.status_code, 200, response.content)
                    self.assertEqual(response.data["is_owner"], user.is_owner)
                    self.assertEqual(response.data["is_superuser"], user.is_superuser)
                    self.assertTrue(response.data["entitlements"]["gate_master"])
                    self.assertTrue(GATE_MASTER_PERMISSIONS <= set(response.data["entitlements"]["permissions"]))
                    self.assertEqual(response.data["gate_plant_ids"], [])
                    response = client.get("/api/gate/masters/", **headers)
                    self.assertEqual(response.status_code, 200, response.content)
                    self.assertEqual({row["id"] for row in response.data["plants"]}, {str(plant.pk) for plant in self.plants})
                    for path in ("/api/gate/audit/", f"/api/gate/qr/?plant={self.plants[0].pk}", "/api/gate/visitors/?status=PENDING", "/api/analytics/reports/gate/", "/api/analytics/report-distributions/", "/api/analytics/audit-ledger/?stream=gate"):
                        with self.subTest(path=path):
                            self.assertEqual(client.get(path, **headers).status_code, 200)
                    response = client.put("/api/analytics/report-distributions/", {"profiles": [{"report_code": "gate_register_daily", "active": False}]}, format="json", **headers)
                    self.assertEqual(response.status_code, 200, response.content)
                    profile = ReportDistributionProfile.objects.get(report_code="gate_register_daily")
                    self.assertEqual(profile.target_roles, ["OWNER"])
                    self.assertEqual(profile.extra_recipients, [])
                    with patch.object(ReportDistributionService, "send_profile", return_value=SimpleNamespace()) as dispatch, patch.object(ReportDistributionService, "serialize_run", return_value={"id": "test"}):
                        response = client.post("/api/analytics/report-distributions/gate_register_daily/send/", {}, format="json", **headers)
                    self.assertEqual(response.status_code, 200, response.content)
                    self.assertEqual(dispatch.call_args.kwargs["triggered_by"].pk, user.pk)

    def test_actual_master_watchman_preview_overrides_all_gate_pack_and_flag_rights(self):
        for user in self.masters:
            for token_path in ("bearer", "cookie"):
                client = self._client(user, token_path)
                headers = {"HTTP_X_ROLE_OVERRIDE": "WATCHMAN"}
                with self.subTest(actual_role=user.role.code, token_path=token_path, flags=(user.is_owner, user.is_superuser)):
                    response = client.get("/api/users/me/", **headers)
                    self.assertEqual(response.status_code, 200, response.content)
                    self.assertFalse(response.data["entitlements"]["gate_master"])
                    for path in ("/api/gate/audit/", "/api/gate/qr/", "/api/gate/reports/", "/api/analytics/report-distributions/", "/api/analytics/reports/gate/"):
                        self.assertEqual(client.get(path, **headers).status_code, 403)
                    self.assertEqual(client.get("/api/gate/masters/", **headers).status_code, 403)

    def test_serializer_superuser_flag_is_read_only(self):
        serializer = UserSerializer(data={"username": "unprivileged_flag_input", "email": "flag-input@example.com", "password": "Master-Flags-2026!", "role_id": str(self.masters[3].role_id), "is_superuser": True})
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertNotIn("is_superuser", serializer.validated_data)
        user = serializer.save()
        self.assertFalse(user.is_superuser)
        self.assertFalse(PermissionService.is_gate_master(user))
