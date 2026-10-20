from importlib import import_module

from django.apps import apps
from django.test import TestCase

from apps.users.models import Role, User
from apps.users.permission_service import PermissionService
from apps.users.role_catalog import CANONICAL_ROLE_LABELS

retire = import_module("apps.users.migrations.0015_retire_engineering_role")


class RetireEngineeringRoleTests(TestCase):
    def test_engineering_users_keep_their_access_as_personal_grants(self):
        role = Role.objects.create(code="ENGINEERING", name="Engineering", default_permissions=["artwork.extra"], revoked_permissions=["tooling.manage"])
        user = User.objects.create(username="eng-user", role=role, extra_permissions=["sales.view"])

        retire.retire(apps, None)

        user.refresh_from_db()
        self.assertIsNone(user.role)
        self.assertFalse(Role.objects.filter(code="ENGINEERING").exists())
        granted = set(user.extra_permissions)
        self.assertTrue({"master.manage", "templates.manage", "engineering.manage", "routing.manage", "artwork.extra", "sales.view"} <= granted)
        self.assertNotIn("tooling.manage", granted, "a role-matrix removal stays removed")
        effective = set(PermissionService.get_user_permissions(user))
        self.assertIn("master.manage", effective)
        self.assertNotIn("production.manage", effective, "no access beyond what the role had")

    def test_engineering_is_no_longer_an_assignable_role(self):
        self.assertNotIn("ENGINEERING", CANONICAL_ROLE_LABELS)
