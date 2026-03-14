from django.contrib.auth.models import AnonymousUser
from django.test import RequestFactory, TestCase

from apps.users.models import Role, User
from apps.users.permissions import RoleBasedAccessPermission


class DummyView:
    rbac_strict = True


class RbacP0Tests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.permission = RoleBasedAccessPermission()
        self.view = DummyView()

        self.role_inventory = Role.objects.create(
            code="STORE",
            name="Store",
            default_permissions=["inventory.view"],
        )
        self.user_inventory = User.objects.create_user(
            username="store1",
            email="store1@example.com",
            password="pass1234",
            role=self.role_inventory,
        )

        self.role_sales = Role.objects.create(
            code="SALES",
            name="Sales",
            default_permissions=["sales.view"],
        )
        self.user_sales = User.objects.create_user(
            username="sales1",
            email="sales1@example.com",
            password="pass1234",
            role=self.role_sales,
        )

        self.role_dispatch = Role.objects.create(
            code="DISPATCH",
            name="Dispatch",
            default_permissions=["notifications.view"],
        )
        self.user_dispatch = User.objects.create_user(
            username="dispatch1",
            email="dispatch1@example.com",
            password="pass1234",
            role=self.role_dispatch,
        )

    def test_public_health_endpoint_allows_anonymous(self):
        request = self.factory.get("/api/health/live/")
        request.user = AnonymousUser()
        allowed = self.permission.has_permission(request, self.view)
        self.assertTrue(allowed)

    def test_mapped_permission_allows(self):
        request = self.factory.get("/api/inventory/health/")
        request.user = self.user_inventory
        allowed = self.permission.has_permission(request, self.view)
        self.assertTrue(allowed)

    def test_mapped_permission_denies_when_missing(self):
        request = self.factory.get("/api/inventory/health/")
        request.user = self.user_sales
        allowed = self.permission.has_permission(request, self.view)
        self.assertFalse(allowed)

    def test_unmapped_route_denied_in_strict_mode(self):
        request = self.factory.get("/api/unmapped/route/")
        request.user = self.user_inventory
        allowed = self.permission.has_permission(request, self.view)
        self.assertFalse(allowed)

    def test_notification_mark_read_allowed_with_notifications_view(self):
        request = self.factory.post("/api/users/notifications/mark-all-read/")
        request.user = self.user_dispatch
        allowed = self.permission.has_permission(request, self.view)
        self.assertTrue(allowed)
