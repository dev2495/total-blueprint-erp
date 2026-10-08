from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.users.models import PermissionAuditLog, Role, User


class RoleAdministrationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.role = Role.objects.create(code="TEST_TARGET", name="Target role")
        self.target = User.objects.create(username="role_target", role=self.role)

    def test_non_admins_cannot_retrieve_or_delete_roles_on_either_alias(self):
        for code in ("SALES", "ENGINEERING", "STORE", "DISPATCH", "PLANNER", "WORK_CENTER_MANAGER", "GUEST", "WATCHMAN"):
            role, _ = Role.objects.get_or_create(code=code, defaults={"name": code})
            user = User.objects.create(username=f"role_actor_{code}", role=role)
            if code == "WATCHMAN":
                user.is_owner = user.is_superuser = True
                user.save()
            self.client.force_authenticate(user)
            for prefix in ("users", "auth"):
                path = f"/api/{prefix}/roles/{self.role.pk}/"
                with self.subTest(role=code, prefix=prefix):
                    self.assertEqual(self.client.get(path).status_code, 403)
                    self.assertEqual(self.client.delete(path).status_code, 403)
        self.assertTrue(Role.objects.filter(pk=self.role.pk).exists())
        self.target.refresh_from_db()
        self.assertEqual(self.target.role_id, self.role.pk)

    def test_actual_admin_delete_is_audited_and_owner_flags_remain_supported(self):
        for code, flags in (("ADMIN", {}), ("OWNER", {}), ("SUPER_ADMIN", {}), ("SALES", {"is_owner": True}), ("ENGINEERING", {"is_superuser": True})):
            role, _ = Role.objects.get_or_create(code=code, defaults={"name": code})
            user = User.objects.create(username=f"master_{code}_{len(flags)}", role=role, **flags)
            target_role = Role.objects.create(code=f"DELETE_{user.username}", name="Delete test")
            self.client.force_authenticate(user)
            self.assertEqual(self.client.get(f"/api/users/roles/{target_role.pk}/").status_code, 200)
            response = self.client.delete(f"/api/users/roles/{target_role.pk}/")
            self.assertEqual(response.status_code, 204)
            self.assertTrue(PermissionAuditLog.objects.filter(user=user, method="DELETE", details__role_id=str(target_role.pk)).exists())


class PasswordSessionRevocationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="password_target", email="target@example.com", password="Initial-Target-2026!")
        self.other = User.objects.create_user(username="password_other", email="other@example.com", password="Other-User-2026!")
        role = Role.objects.create(code="ADMIN", name="Admin")
        self.admin = User.objects.create_user(username="password_admin", email="admin@example.com", password="Admin-User-2026!", role=role)
        self.stolen = str(RefreshToken.for_user(self.user))
        self.second_session = str(RefreshToken.for_user(self.user))
        self.unrelated = str(RefreshToken.for_user(self.other))

    def refresh(self, token):
        client = APIClient()
        return client.post("/api/users/token/refresh/", {"refresh": token}, format="json")

    def assert_only_target_sessions_revoked(self):
        self.assertEqual(self.refresh(self.stolen).status_code, 401)
        self.assertEqual(self.refresh(self.second_session).status_code, 401)
        self.assertEqual(self.refresh(self.unrelated).status_code, 200)
        fresh = APIClient().post("/api/users/login/", {"identifier": self.user.username, "password": "Replacement-Target-2026!"}, format="json")
        self.assertEqual(fresh.status_code, 200, fresh.content)

    def test_self_change_revokes_all_target_refreshes_and_clears_cookies(self):
        self.client.force_authenticate(self.user)
        response = self.client.post("/api/users/change-password/", {"current_password": "Initial-Target-2026!", "new_password": "Replacement-Target-2026!"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.cookies["access"]["max-age"], 0)
        self.assertEqual(response.cookies["refresh"]["max-age"], 0)
        self.assert_only_target_sessions_revoked()

    def test_admin_reset_revokes_target_refreshes_and_preserves_other_sessions(self):
        self.client.force_authenticate(self.admin)
        response = self.client.patch(f"/api/users/users/{self.user.pk}/", {"password": "Replacement-Target-2026!"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assert_only_target_sessions_revoked()
        self.assertTrue(PermissionAuditLog.objects.filter(user=self.admin, action="PASSWORD_CHANGED", details__target_user_id=str(self.user.pk)).exists())

    def test_failed_audit_rolls_back_password_change_and_blacklist(self):
        self.client.force_authenticate(self.user)
        with patch("apps.users.views.PermissionAuditLog.objects.create", side_effect=RuntimeError("audit unavailable")):
            response = self.client.post("/api/users/change-password/", {"current_password": "Initial-Target-2026!", "new_password": "Replacement-Target-2026!"}, format="json")
        self.assertEqual(response.status_code, 500)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("Initial-Target-2026!"))
        self.assertEqual(self.refresh(self.stolen).status_code, 200)

    def test_failed_reset_audit_rolls_back_password_and_blacklist(self):
        self.client.force_authenticate(self.admin)
        with patch("apps.users.serializers.PermissionAuditLog.objects.create", side_effect=RuntimeError("audit unavailable")):
            response = self.client.patch(f"/api/users/users/{self.user.pk}/", {"password": "Replacement-Target-2026!"}, format="json")
        self.assertEqual(response.status_code, 500)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("Initial-Target-2026!"))
        self.assertEqual(self.refresh(self.stolen).status_code, 200)
