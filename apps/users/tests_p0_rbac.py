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

        self.role_planner = Role.objects.create(
            code="PLANNER",
            name="Planner",
            default_permissions=["production.view"],
        )
        self.user_planner = User.objects.create_user(
            username="planner1",
            email="planner1@example.com",
            password="pass1234",
            role=self.role_planner,
        )

        self.role_wcm = Role.objects.create(
            code="WORK_CENTER_MANAGER",
            name="Work Center Manager",
            default_permissions=["production.view"],
        )
        self.user_wcm = User.objects.create_user(
            username="wcm1",
            email="wcm1@example.com",
            password="pass1234",
            role=self.role_wcm,
        )

        self.role_engineering = Role.objects.create(
            code="ENGINEERING",
            name="Engineering",
            default_permissions=["templates.view"],
        )
        self.user_engineering = User.objects.create_user(
            username="eng1",
            email="eng1@example.com",
            password="pass1234",
            role=self.role_engineering,
        )

    def assertAllows(self, user, method: str, path: str):
        request = getattr(self.factory, method.lower())(path)
        request.user = user
        self.assertTrue(
            self.permission.has_permission(request, self.view),
            f"{user.role.code} should access {method.upper()} {path}",
        )

    def assertDenies(self, user, method: str, path: str):
        request = getattr(self.factory, method.lower())(path)
        request.user = user
        self.assertFalse(
            self.permission.has_permission(request, self.view),
            f"{user.role.code} should not access {method.upper()} {path}",
        )

    def test_public_health_endpoint_allows_anonymous(self):
        request = self.factory.get("/api/health/live/")
        request.user = AnonymousUser()
        allowed = self.permission.has_permission(request, self.view)
        self.assertTrue(allowed)

    def test_public_auth_endpoint_without_trailing_slash_allows_anonymous(self):
        request = self.factory.get("/api/auth/csrf")
        request.user = AnonymousUser()
        allowed = self.permission.has_permission(request, self.view)
        self.assertTrue(allowed)

    def test_mapped_permission_allows(self):
        request = self.factory.get("/api/inventory/health/")
        request.user = self.user_inventory
        allowed = self.permission.has_permission(request, self.view)
        self.assertTrue(allowed)

    def test_store_can_read_factory_plants_for_grn_inward(self):
        self.assertAllows(self.user_inventory, "GET", "/api/factory/plants/")

    def test_store_can_read_master_materials_for_grn_inward(self):
        self.assertAllows(self.user_inventory, "GET", "/api/master/granules/")
        self.assertAllows(self.user_inventory, "GET", "/api/master/film-variants/")
        self.assertAllows(self.user_inventory, "GET", "/api/master/packaging/")

    def test_sales_can_read_sku_catalog_cross_module_selectors(self):
        self.assertAllows(self.user_sales, "GET", "/api/templates/")
        self.assertAllows(self.user_sales, "GET", "/api/master/packaging/")
        self.assertAllows(self.user_sales, "GET", "/api/engineering/artworks/")
        self.assertAllows(self.user_sales, "GET", "/api/factory/plants/")

    def test_planner_can_read_stock_order_cross_module_selectors(self):
        self.assertAllows(self.user_planner, "GET", "/api/master/film-variants/")
        self.assertAllows(self.user_planner, "GET", "/api/master/packaging/")
        self.assertAllows(self.user_planner, "GET", "/api/templates/")
        self.assertAllows(self.user_planner, "GET", "/api/engineering/artworks/")

    def test_wcm_can_read_execution_lookup_data(self):
        self.assertAllows(self.user_wcm, "GET", "/api/master/granules/")
        self.assertAllows(self.user_wcm, "GET", "/api/templates/")
        self.assertAllows(self.user_wcm, "GET", "/api/inventory/locations/")

    def test_dispatch_can_read_packing_and_dispatch_lookup_data(self):
        self.assertAllows(self.user_dispatch, "GET", "/api/production/packing/orders/")
        self.assertAllows(self.user_dispatch, "GET", "/api/master/packaging/")
        self.assertAllows(self.user_dispatch, "GET", "/api/factory/plants/")

    def test_dispatch_can_manage_packing_yard_without_full_production_manage(self):
        self.assertAllows(self.user_dispatch, "POST", "/api/production/packing/release-roll/")
        self.assertAllows(self.user_dispatch, "POST", "/api/production/packing/bulk-release-rolls/")
        self.assertAllows(self.user_dispatch, "POST", "/api/production/packing/00000000-0000-0000-0000-000000000001/release/")
        self.assertAllows(self.user_dispatch, "POST", "/api/production/packing/material-count/")
        self.assertDenies(self.user_dispatch, "POST", "/api/production/jobs/")

    def test_dispatch_can_manage_challans_without_full_production_manage(self):
        self.assertAllows(self.user_dispatch, "GET", "/api/production/challans/board/")
        self.assertAllows(self.user_dispatch, "GET", "/api/production/challans/material-ready-slip/")
        self.assertAllows(self.user_dispatch, "POST", "/api/production/challans/create_challan/")
        self.assertAllows(
            self.user_dispatch,
            "POST",
            "/api/production/challans/00000000-0000-0000-0000-000000000001/dispatch/",
        )
        self.assertAllows(
            self.user_dispatch,
            "POST",
            "/api/production/challans/00000000-0000-0000-0000-000000000001/update_status/",
        )
        self.assertDenies(self.user_dispatch, "POST", "/api/production/jobs/")

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

    def test_templates_route_without_trailing_slash_allows_templates_view(self):
        request = self.factory.get("/api/templates")
        request.user = self.user_engineering
        allowed = self.permission.has_permission(request, self.view)
        self.assertTrue(allowed)
