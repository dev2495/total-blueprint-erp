from django.test import TestCase

from apps.factory.models import Machine, Plant, WorkCenter
from apps.production.views_machine import _ensure_machine_scope
from apps.users.models import MachineAssignment, Role, User


class MachineScopeGuardTests(TestCase):
    def setUp(self):
        self.operator_role = Role.objects.create(code="OPERATOR", name="Operator", default_permissions=["production.view"])
        self.admin_role = Role.objects.create(code="ADMIN", name="Admin", default_permissions=["*"])

        self.operator = User.objects.create_user(
            username="machine-op",
            password="pass12345",
            email="machine-op@example.com",
            role=self.operator_role,
        )
        self.admin = User.objects.create_user(
            username="machine-admin",
            password="pass12345",
            email="machine-admin@example.com",
            role=self.admin_role,
        )

        self.plant = Plant.objects.create(name="Scope Plant", code="SCOPE")
        self.work_center = WorkCenter.objects.create(name="Scope WC", code="SCOPE-WC", plant=self.plant)
        self.machine_a = Machine.objects.create(name="Machine A", code="M-SCOPE-A", work_center=self.work_center)
        self.machine_b = Machine.objects.create(name="Machine B", code="M-SCOPE-B", work_center=self.work_center)

    def test_operator_assigned_machine_is_allowed(self):
        MachineAssignment.objects.create(user=self.operator, machine=self.machine_a)
        self.assertTrue(_ensure_machine_scope(self.operator, self.machine_a.id))

    def test_operator_unassigned_machine_is_denied(self):
        MachineAssignment.objects.create(user=self.operator, machine=self.machine_a)
        self.assertFalse(_ensure_machine_scope(self.operator, self.machine_b.id))

    def test_admin_has_global_machine_scope(self):
        self.assertTrue(_ensure_machine_scope(self.admin, self.machine_b.id))
