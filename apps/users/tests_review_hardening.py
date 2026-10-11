"""User-management hierarchy, role-matrix revocations and sign-in lockout."""
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.users.models import PermissionAuditLog, Role, User
from apps.users.permission_service import PermissionService


class OwnerHierarchyTests(TestCase):
    def setUp(self):
        self.admin_role = Role.objects.get_or_create(code="ADMIN", defaults={"name": "Admin"})[0]
        self.owner_role = Role.objects.get_or_create(code="OWNER", defaults={"name": "Owner"})[0]
        self.sales_role = Role.objects.get_or_create(code="SALES", defaults={"name": "Sales"})[0]
        self.owner = User.objects.create_user(username="h-owner", email="owner@x.test", role=self.owner_role, is_owner=True)
        self.admin = User.objects.create_user(username="h-admin", email="admin@x.test", role=self.admin_role)
        self.staff = User.objects.create_user(username="h-staff", email="staff@x.test", role=self.sales_role)
        self.client = APIClient()

    def test_admin_cannot_grant_owner_rights_or_touch_owner_accounts(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.patch(f"/api/users/users/{self.staff.id}/", {"is_owner": True}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(f"/api/users/users/{self.admin.id}/", {"role_id": str(self.owner_role.id)}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(f"/api/users/users/{self.owner.id}/", {"first_name": "Changed"}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(f"/api/users/users/{self.owner.id}/", {"password": "Another-Long-Pass-2026"}, format="json").status_code, 400)
        self.assertEqual(self.client.delete(f"/api/users/users/{self.owner.id}/").status_code, 403)
        self.staff.refresh_from_db(); self.owner.refresh_from_db()
        self.assertFalse(self.staff.is_owner)
        self.assertTrue(self.owner.is_active)
        # Ordinary staff management still works for administrators.
        self.assertEqual(self.client.patch(f"/api/users/users/{self.staff.id}/", {"first_name": "Renamed"}, format="json").status_code, 200)

    def test_owner_can_grant_owner_rights_and_last_owner_is_protected(self):
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.patch(f"/api/users/users/{self.owner.id}/", {"is_active": False}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(f"/api/users/users/{self.admin.id}/", {"is_owner": True}, format="json").status_code, 200)
        self.assertEqual(self.client.patch(f"/api/users/users/{self.admin.id}/", {"is_owner": False}, format="json").status_code, 200)

    def test_delete_deactivates_and_keeps_the_account(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.delete(f"/api/users/users/{self.admin.id}/").status_code, 400)
        self.assertEqual(self.client.delete(f"/api/users/users/{self.staff.id}/").status_code, 204)
        self.staff.refresh_from_db()
        self.assertFalse(self.staff.is_active)
        self.assertTrue(PermissionAuditLog.objects.filter(details__target_user_id=str(self.staff.id), details__status="deactivated").exists())


class RoleRevocationTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username="rv-admin", role=Role.objects.get_or_create(code="ADMIN", defaults={"name": "Admin"})[0])
        self.dispatch_role = Role.objects.get_or_create(code="DISPATCH", defaults={"name": "Dispatch"})[0]
        self.dispatcher = User.objects.create_user(username="rv-dispatch", role=self.dispatch_role)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _matrix_without(self, code):
        exported = self.client.get("/api/users/roles/matrix/export").data
        row = exported["DISPATCH"]
        current = (set(row["default_permissions"]) | set(row["database_permissions"])) - set(row.get("revoked_permissions") or [])
        return {"DISPATCH": sorted(current - {code})}

    def test_unticking_a_baseline_permission_really_removes_it(self):
        self.assertIn("inventory.manage", PermissionService.get_user_permissions(self.dispatcher))
        response = self.client.post("/api/users/roles/matrix/import", {"matrix": self._matrix_without("inventory.manage")}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.dispatcher.role.refresh_from_db()
        self.assertNotIn("inventory.manage", PermissionService.get_user_permissions(self.dispatcher))
        exported = self.client.get("/api/users/roles/matrix/export").data["DISPATCH"]
        self.assertIn("inventory.manage", exported["revoked_permissions"])

        # An explicit per-account grant still applies on top of the role.
        self.dispatcher.extra_permissions = ["inventory.manage"]
        self.dispatcher.save(update_fields=["extra_permissions"])
        self.assertIn("inventory.manage", PermissionService.get_user_permissions(self.dispatcher))

        self.client.post("/api/users/roles/matrix/sync-defaults")
        self.dispatch_role.refresh_from_db()
        self.assertEqual(self.dispatch_role.revoked_permissions, [])


@override_settings(CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": "lockout-tests"}})
class LoginLockoutTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username="lock-user", email="lock@x.test", password="Correct-Horse-2026")
        self.client = APIClient()

    def _login(self, identifier, password):
        return self.client.post("/api/users/login/", {"identifier": identifier, "password": password}, format="json")

    def test_account_locks_after_repeated_failures_whatever_name_is_typed(self):
        for attempt in range(10):
            identifier = "lock-user" if attempt % 2 else "LOCK@x.test"
            self.assertEqual(self._login(identifier, "wrong").status_code, 400)
        locked = self._login("lock-user", "Correct-Horse-2026")
        self.assertEqual(locked.status_code, 429)
        self.assertTrue(PermissionAuditLog.objects.filter(action="DENIED", details__reason="login_locked").exists())

    def test_success_clears_the_failure_count(self):
        for _ in range(9):
            self._login("lock-user", "wrong")
        self.assertEqual(self._login("lock-user", "Correct-Horse-2026").status_code, 200)
        for _ in range(9):
            self._login("lock-user", "wrong")
        self.assertEqual(self._login("lock-user", "Correct-Horse-2026").status_code, 200)


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": "legacy-cookie-tests"}},
    JWT_COOKIE_DOMAIN=None,
    JWT_COOKIE_SAMESITE="Lax",
    JWT_LEGACY_COOKIE_DOMAINS=[".example.test"],
)
class LegacyCookieDomainTests(TestCase):
    def test_sign_in_and_logout_expire_parent_domain_cookies(self):
        cache.clear()
        User.objects.create_user(username="cookie-user", email="cookie@x.test", password="Correct-Horse-2026")
        client = APIClient()
        response = client.post("/api/users/login/", {"identifier": "cookie-user", "password": "Correct-Horse-2026"}, format="json")
        self.assertEqual(response.status_code, 200)
        lines = [morsel.output(header="").strip() for morsel in response.cookies.values()]
        access_lines = [line for line in lines if line.startswith("access=")]
        self.assertEqual(len(access_lines), 2, lines)
        self.assertTrue(any("Domain=.example.test" in line and "Max-Age=0" in line for line in access_lines))
        self.assertTrue(any("Domain=" not in line and "Max-Age=0" not in line for line in access_lines))
        self.assertTrue(any(line.startswith("refresh=") and "Domain=.example.test" in line for line in lines))

        logout = client.post("/api/users/logout/", {}, format="json")
        expired = [morsel.output(header="").strip() for morsel in logout.cookies.values()]
        self.assertTrue(any(line.startswith("access=") and "Domain=.example.test" in line for line in expired))
