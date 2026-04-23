from django.test import TestCase

from apps.factory.models import Machine, Plant, WorkCenter
from apps.production.views_machine import _ensure_machine_scope
from apps.users.models import Role, User, WorkCenterAssignment


class MachineScopeGuardTests(TestCase):
    def setUp(self):
        self.wcm_role = Role.objects.create(code="WORK_CENTER_MANAGER", name="Work Center Manager", default_permissions=["production.view"])
        self.admin_role = Role.objects.create(code="ADMIN", name="Admin", default_permissions=["*"])

        self.wcm = User.objects.create_user(
            username="machine-wcm",
            password="pass12345",
            email="machine-wcm@example.com",
            role=self.wcm_role,
        )
        self.admin = User.objects.create_user(
            username="machine-admin",
            password="pass12345",
            email="machine-admin@example.com",
            role=self.admin_role,
        )

        self.plant = Plant.objects.create(name="Scope Plant", code="SCOPE")
        self.work_center = WorkCenter.objects.create(name="Scope WC", code="SCOPE-WC", plant=self.plant)
        self.other_work_center = WorkCenter.objects.create(name="Other Scope WC", code="OTHER-SCOPE-WC", plant=self.plant)
        self.machine_a = Machine.objects.create(name="Machine A", code="M-SCOPE-A", work_center=self.work_center)
        self.machine_b = Machine.objects.create(name="Machine B", code="M-SCOPE-B", work_center=self.other_work_center)

    def test_wcm_machine_in_assigned_work_center_is_allowed(self):
        WorkCenterAssignment.objects.create(user=self.wcm, work_center=self.work_center)
        self.assertTrue(_ensure_machine_scope(self.wcm, self.machine_a.id))

    def test_wcm_machine_outside_assigned_work_center_is_denied(self):
        WorkCenterAssignment.objects.create(user=self.wcm, work_center=self.work_center)
        self.assertFalse(_ensure_machine_scope(self.wcm, self.machine_b.id))

    def test_admin_has_global_machine_scope(self):
        self.assertTrue(_ensure_machine_scope(self.admin, self.machine_b.id))
