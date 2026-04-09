from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.users.models import PermissionAuditLog, Role, UserProfileChangeRequest


class ProfileAuthP0Tests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin_role = Role.objects.create(code="ADMIN", name="Admin", default_permissions=["*"])
        self.sales_role = Role.objects.create(
            code="SALES",
            name="Sales",
            default_permissions=["sales.view", "users.self_manage"],
        )

        self.admin = get_user_model().objects.create_user(
            username="admin1",
            email="admin1@example.com",
            password="adminpass123",
            role=self.admin_role,
        )
        self.user = get_user_model().objects.create_user(
            username="sales1",
            email="sales1@example.com",
            password="userpass123",
            role=self.sales_role,
        )

    def _csrf_headers(self, client: APIClient | None = None) -> dict:
        target = client or self.client
        if "csrftoken" not in target.cookies:
            target.get("/api/users/csrf/")
        token = target.cookies.get("csrftoken")
        return {"HTTP_X_CSRFTOKEN": str(getattr(token, "value", "") or "")}

    def _login(self, identifier: str, password: str):
        response = self.client.post(
            "/api/users/login/",
            {"identifier": identifier, "password": password},
            format="json",
            **self._csrf_headers(),
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIn("user", response.data)
        return response.data["user"]

    def test_login_with_username_and_email(self):
        response_legacy_username_key = self.client.post(
            "/api/users/login/",
            {"username": "sales1", "password": "userpass123"},
            format="json",
            **self._csrf_headers(),
        )
        self.assertEqual(response_legacy_username_key.status_code, 200, response_legacy_username_key.content)

        response_username = self.client.post(
            "/api/users/login/",
            {"identifier": "sales1", "password": "userpass123"},
            format="json",
            **self._csrf_headers(),
        )
        self.assertEqual(response_username.status_code, 200, response_username.content)

        response_email = self.client.post(
            "/api/users/login/",
            {"identifier": "sales1@example.com", "password": "userpass123"},
            format="json",
            **self._csrf_headers(),
        )
        self.assertEqual(response_email.status_code, 200, response_email.content)

        invalid = self.client.post(
            "/api/users/login/",
            {"identifier": "sales1@example.com", "password": "wrong"},
            format="json",
            **self._csrf_headers(),
        )
        self.assertIn(invalid.status_code, {400, 401})

    def test_login_requires_csrf(self):
        strict_client = APIClient(enforce_csrf_checks=True)

        denied = strict_client.post(
            "/api/users/login/",
            {"identifier": "sales1", "password": "userpass123"},
            format="json",
        )
        self.assertEqual(denied.status_code, 403, denied.content)

        allowed = strict_client.post(
            "/api/users/login/",
            {"identifier": "sales1", "password": "userpass123"},
            format="json",
            **self._csrf_headers(strict_client),
        )
        self.assertEqual(allowed.status_code, 200, allowed.content)

    def test_logout_blacklists_refresh_token(self):
        self._login("sales1", "userpass123")
        refresh_cookie = self.client.cookies.get("refresh")
        self.assertIsNotNone(refresh_cookie)
        refresh = str(refresh_cookie.value)

        logout_response = self.client.post(
            "/api/users/logout/",
            {},
            format="json",
            **self._csrf_headers(),
        )
        self.assertEqual(logout_response.status_code, 204, logout_response.content)
        self.assertEqual(str(self.client.cookies.get("refresh").value), "")

        refresh_response = self.client.post(
            "/api/users/token/refresh/",
            {},
            format="json",
            **self._csrf_headers(),
        )
        self.assertIn(refresh_response.status_code, {401, 403})

        # Legacy body refresh still rejected once blacklisted.
        body_refresh_response = self.client.post(
            "/api/users/token/refresh/",
            {"refresh": refresh},
            format="json",
            **self._csrf_headers(),
        )
        self.assertIn(body_refresh_response.status_code, {400, 401})

        self.assertTrue(
            PermissionAuditLog.objects.filter(
                user=self.user,
                action="USER_LOGOUT",
                path="/api/users/logout/",
            ).exists()
        )

    def test_successful_login_creates_audit_log(self):
        self._login("sales1", "userpass123")

        audit = PermissionAuditLog.objects.filter(
            user=self.user,
            action="USER_LOGIN",
            path="/api/users/login/",
        ).order_by("-created_at").first()

        self.assertIsNotNone(audit)
        self.assertEqual(audit.method, "POST")
        self.assertEqual(audit.details.get("status"), "authenticated")
        self.assertEqual(audit.effective_role, "SALES")

    def test_successful_login_updates_last_login(self):
        self.assertIsNone(self.user.last_login)

        self._login("sales1", "userpass123")

        self.user.refresh_from_db()
        self.assertIsNotNone(self.user.last_login)

    def test_cookie_refresh_rotates_access_cookie(self):
        self._login("sales1", "userpass123")
        old_access = str(self.client.cookies.get("access").value)
        response = self.client.post(
            "/api/users/token/refresh/",
            {},
            format="json",
            **self._csrf_headers(),
        )
        self.assertEqual(response.status_code, 200, response.content)
        new_access = str(self.client.cookies.get("access").value)
        self.assertNotEqual(old_access, new_access)

    def test_refresh_requires_csrf_when_only_refresh_cookie_is_present(self):
        strict_client = APIClient(enforce_csrf_checks=True)
        login_response = strict_client.post(
            "/api/users/login/",
            {"identifier": "sales1", "password": "userpass123"},
            format="json",
            **self._csrf_headers(strict_client),
        )
        self.assertEqual(login_response.status_code, 200, login_response.content)
        self.assertIn("refresh", strict_client.cookies)
        if "access" in strict_client.cookies:
            del strict_client.cookies["access"]

        denied = strict_client.post(
            "/api/users/token/refresh/",
            {},
            format="json",
        )
        self.assertEqual(denied.status_code, 403, denied.content)

    def test_refresh_succeeds_with_csrf_when_only_refresh_cookie_is_present(self):
        strict_client = APIClient(enforce_csrf_checks=True)
        login_response = strict_client.post(
            "/api/users/login/",
            {"identifier": "sales1", "password": "userpass123"},
            format="json",
            **self._csrf_headers(strict_client),
        )
        self.assertEqual(login_response.status_code, 200, login_response.content)
        old_access = str(strict_client.cookies.get("access").value)
        if "access" in strict_client.cookies:
            del strict_client.cookies["access"]

        allowed = strict_client.post(
            "/api/users/token/refresh/",
            {},
            format="json",
            **self._csrf_headers(strict_client),
        )
        self.assertEqual(allowed.status_code, 200, allowed.content)
        self.assertIn("access", strict_client.cookies)
        self.assertNotEqual(str(strict_client.cookies.get("access").value), old_access)

    def test_logout_requires_csrf_when_only_refresh_cookie_is_present(self):
        strict_client = APIClient(enforce_csrf_checks=True)
        login_response = strict_client.post(
            "/api/users/login/",
            {"identifier": "sales1", "password": "userpass123"},
            format="json",
            **self._csrf_headers(strict_client),
        )
        self.assertEqual(login_response.status_code, 200, login_response.content)
        self.assertIn("refresh", strict_client.cookies)
        if "access" in strict_client.cookies:
            del strict_client.cookies["access"]

        denied = strict_client.post(
            "/api/users/logout/",
            {},
            format="json",
        )
        self.assertEqual(denied.status_code, 403, denied.content)

    def test_logout_succeeds_with_csrf_when_only_refresh_cookie_is_present(self):
        strict_client = APIClient(enforce_csrf_checks=True)
        login_response = strict_client.post(
            "/api/users/login/",
            {"identifier": "sales1", "password": "userpass123"},
            format="json",
            **self._csrf_headers(strict_client),
        )
        self.assertEqual(login_response.status_code, 200, login_response.content)
        self.assertIn("refresh", strict_client.cookies)
        if "access" in strict_client.cookies:
            del strict_client.cookies["access"]

        allowed = strict_client.post(
            "/api/users/logout/",
            {},
            format="json",
            **self._csrf_headers(strict_client),
        )
        self.assertEqual(allowed.status_code, 204, allowed.content)

    def test_csrf_enforced_for_cookie_authenticated_unsafe_methods(self):
        strict_client = APIClient(enforce_csrf_checks=True)
        strict_client.get("/api/users/csrf/")
        csrf = str(strict_client.cookies.get("csrftoken").value)

        login_response = strict_client.post(
            "/api/users/login/",
            {"identifier": "sales1", "password": "userpass123"},
            format="json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(login_response.status_code, 200, login_response.content)

        denied = strict_client.post(
            "/api/users/change-password/",
            {"current_password": "userpass123", "new_password": "userpass456"},
            format="json",
        )
        self.assertEqual(denied.status_code, 403)

        allowed = strict_client.post(
            "/api/users/change-password/",
            {"current_password": "userpass123", "new_password": "userpass456"},
            format="json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(allowed.status_code, 200, allowed.content)

    def test_change_password(self):
        self._login("sales1", "userpass123")

        change_response = self.client.post(
            "/api/users/change-password/",
            {"current_password": "userpass123", "new_password": "userpass456"},
            format="json",
            **self._csrf_headers(),
        )
        self.assertEqual(change_response.status_code, 200, change_response.content)
        self.assertEqual(change_response.data.get("status"), "password_updated")

        old_login = self.client.post(
            "/api/users/login/",
            {"identifier": "sales1", "password": "userpass123"},
            format="json",
            **self._csrf_headers(),
        )
        self.assertIn(old_login.status_code, {400, 401})

        new_login = self.client.post(
            "/api/users/login/",
            {"identifier": "sales1", "password": "userpass456"},
            format="json",
            **self._csrf_headers(),
        )
        self.assertEqual(new_login.status_code, 200)

    def test_profile_change_request_submit_and_admin_review(self):
        self._login("sales1", "userpass123")

        create_req = self.client.post(
            "/api/users/profile-change-requests/",
            {"requested_changes": {"first_name": "Ravi", "email": "ravi.sales@example.com"}},
            format="json",
            **self._csrf_headers(),
        )
        self.assertEqual(create_req.status_code, 201, create_req.content)
        request_id = create_req.data["id"]

        forbidden_review = self.client.patch(
            f"/api/users/profile-change-requests/{request_id}/review/",
            {"decision": "APPROVE", "notes": "nope"},
            format="json",
            **self._csrf_headers(),
        )
        self.assertEqual(forbidden_review.status_code, 403)

        self._login("admin1", "adminpass123")
        review = self.client.patch(
            f"/api/users/profile-change-requests/{request_id}/review/",
            {"decision": "APPROVE", "notes": "Looks good"},
            format="json",
            **self._csrf_headers(),
        )
        self.assertEqual(review.status_code, 200, review.content)
        self.assertEqual(review.data["status"], "APPROVED")

        self.user.refresh_from_db()
        self.assertEqual(self.user.first_name, "Ravi")
        self.assertEqual(self.user.email, "ravi.sales@example.com")

    def test_email_required_on_user_create_and_update_but_legacy_user_flagged(self):
        self._login("admin1", "adminpass123")

        create_missing_email = self.client.post(
            "/api/users/users/",
            {"username": "newuser", "password": "newuser123", "role_id": str(self.sales_role.id)},
            format="json",
            **self._csrf_headers(),
        )
        self.assertEqual(create_missing_email.status_code, 400)
        self.assertIn("email", create_missing_email.data.get("detail", {}))

        legacy_user = get_user_model().objects.create_user(
            username="legacy",
            email="",
            password="legacy123",
            role=self.sales_role,
        )
        patch_without_email = self.client.patch(
            f"/api/users/users/{legacy_user.id}/",
            {"first_name": "Legacy"},
            format="json",
            **self._csrf_headers(),
        )
        self.assertEqual(patch_without_email.status_code, 400)
        self.assertIn("email", patch_without_email.data.get("detail", {}))

        self._login("legacy", "legacy123")
        me = self.client.get("/api/users/me/")
        self.assertEqual(me.status_code, 200, me.content)
        self.assertTrue(me.data.get("email_missing"))

    def test_api_user_create_rejects_weak_passwords(self):
        self._login("admin1", "adminpass123")

        response = self.client.post(
            "/api/users/users/",
            {
                "username": "weakuser",
                "email": "weakuser@example.com",
                "password": "12345678",
                "role_id": str(self.sales_role.id),
            },
            format="json",
            **self._csrf_headers(),
        )

        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("password", response.data.get("detail", {}))

    def test_api_user_update_rejects_weak_passwords(self):
        self._login("admin1", "adminpass123")

        response = self.client.patch(
            f"/api/users/users/{self.user.id}/",
            {"password": "12345678"},
            format="json",
            **self._csrf_headers(),
        )

        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("password", response.data.get("detail", {}))

    def test_api_user_create_accepts_strong_password(self):
        self._login("admin1", "adminpass123")

        response = self.client.post(
            "/api/users/users/",
            {
                "username": "secureuser",
                "email": "secureuser@example.com",
                "password": "StrongPass!234",
                "role_id": str(self.sales_role.id),
            },
            format="json",
            **self._csrf_headers(),
        )

        self.assertEqual(response.status_code, 201, response.content)
        created_user = get_user_model().objects.get(username="secureuser")
        self.assertTrue(created_user.check_password("StrongPass!234"))

    def test_requestor_can_cancel_own_pending_request(self):
        self._login("sales1", "userpass123")

        create_req = self.client.post(
            "/api/users/profile-change-requests/",
            {"requested_changes": {"last_name": "Updated"}},
            format="json",
            **self._csrf_headers(),
        )
        self.assertEqual(create_req.status_code, 201, create_req.content)
        request_id = create_req.data["id"]

        cancel = self.client.post(
            f"/api/users/profile-change-requests/{request_id}/cancel/",
            {},
            format="json",
            **self._csrf_headers(),
        )
        self.assertEqual(cancel.status_code, 200, cancel.content)
        self.assertEqual(cancel.data["status"], "CANCELLED")

        row = UserProfileChangeRequest.objects.get(id=request_id)
        self.assertEqual(row.status, "CANCELLED")
