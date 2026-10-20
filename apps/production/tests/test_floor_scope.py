"""Floor scope: a Work Center Manager acts only on their work centres, a Machine Operator only on
their machines, and neither can reach other modules through the API."""
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.factory.models import Machine, Plant, Process, WorkCenter
from apps.production.models import ProductionJob, WorkCenterAssignment
from apps.routing.models import RoutingRule
from apps.users.models import MachineAssignment, Role
from apps.users.models import WorkCenterAssignment as UserWorkCenter
from apps.users.permission_registry import ROLE_PERMISSION_MATRIX
from apps.users.role_catalog import get_canonical_role_code


@override_settings(STRICT_RBAC=True)
class FloorScopeTests(TestCase):
    def setUp(self):
        roles = {code: Role.objects.update_or_create(code=code, defaults={"name": code.title(), "default_permissions": list(ROLE_PERMISSION_MATRIX[code]), "revoked_permissions": []})[0]
                 for code in ("ADMIN", "WORK_CENTER_MANAGER", "OPERATOR", "PLANNER")}
        User = get_user_model()
        self.admin = User.objects.create_user(username="scope-admin", email="a@example.invalid", password="x-12345678", role=roles["ADMIN"])
        self.wcm = User.objects.create_user(username="scope-wcm", email="w@example.invalid", password="x-12345678", role=roles["WORK_CENTER_MANAGER"])
        self.operator = User.objects.create_user(username="scope-op", email="o@example.invalid", password="x-12345678", role=roles["OPERATOR"])
        self.planner = User.objects.create_user(username="scope-plan", email="p@example.invalid", password="x-12345678", role=roles["PLANNER"])

        plant = Plant.objects.create(name="Scope Plant", code="SCOPE_PLANT")
        self.wc_a = WorkCenter.objects.create(plant=plant, name="SCOPE-WC-A", code="SCOPE_WC_A")
        self.wc_b = WorkCenter.objects.create(plant=plant, name="SCOPE-WC-B", code="SCOPE_WC_B")
        self.machine_a = Machine.objects.create(work_center=self.wc_a, name="SCOPE-M-A", code="SCOPE_M_A")
        self.machine_a2 = Machine.objects.create(work_center=self.wc_a, name="SCOPE-M-A2", code="SCOPE_M_A2")
        self.machine_b = Machine.objects.create(work_center=self.wc_b, name="SCOPE-M-B", code="SCOPE_M_B")
        process = Process.objects.create(code="SCOPE_P", name="Scope process")
        route = RoutingRule.objects.create(name="SCOPE_ROUTE", ordered_processes=["SCOPE_P"])
        self.job_a = ProductionJob.objects.create(job_number="SCOPE-A", routing_rule=route, quantity=10, work_center=self.wc_a,
                                                  machine=self.machine_a, current_process=process, process=process)
        self.job_b = ProductionJob.objects.create(job_number="SCOPE-B", routing_rule=route, quantity=10, work_center=self.wc_b,
                                                  machine=self.machine_b, current_process=process, process=process)
        self.assign_a = WorkCenterAssignment.objects.create(production_job=self.job_a, work_center=self.wc_a, status="WC_READY")
        self.assign_b = WorkCenterAssignment.objects.create(production_job=self.job_b, work_center=self.wc_b, status="WC_READY")

        UserWorkCenter.objects.create(user=self.wcm, work_center=self.wc_a)
        MachineAssignment.objects.create(user=self.operator, machine=self.machine_a)

    def _client(self, user):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
        return client

    def test_operator_is_its_own_role_again(self):
        self.assertEqual(get_canonical_role_code("OPERATOR"), "OPERATOR")
        self.assertIn("OPERATOR", ROLE_PERMISSION_MATRIX)

    def test_wcm_sees_and_acts_only_on_assigned_work_centres(self):
        client = self._client(self.wcm)
        self.assertEqual(client.get(f"/api/production/wc/{self.wc_a.id}/").status_code, 200)
        refused = client.get(f"/api/production/wc/{self.wc_b.id}/")
        self.assertEqual(refused.status_code, 403, refused.content)
        self.assertIn("not assigned to you", refused.json()["detail"])
        self.assertEqual(client.get(f"/api/production/wc/{self.wc_b.id}/stats/").status_code, 403)

        own = client.post("/api/production/wc-allocation/assign-machine/", {"assignment_id": str(self.assign_b.id), "machine_id": str(self.machine_b.id)}, format="json")
        self.assertEqual(own.status_code, 403, own.content)
        self.assign_b.refresh_from_db()
        self.assertIsNone(self.assign_b.assigned_machine_id, "a refused request changes nothing")

        listed = client.get("/api/factory/work-centers/my-work-centers/").json()
        self.assertEqual([row["id"] for row in listed], [str(self.wc_a.id)])
        machines = client.get("/api/production/operator/machines/").json()
        rows = machines.get("results", machines) if isinstance(machines, dict) else machines
        self.assertEqual({row["id"] for row in rows}, {str(self.machine_a.id), str(self.machine_a2.id)})
        self.assertEqual(client.get(f"/api/production/machine/{self.machine_b.id}/").status_code, 403)

    def test_wcm_job_changes_outside_scope_are_refused_but_reads_stay_open(self):
        client = self._client(self.wcm)
        self.assertEqual(client.post(f"/api/production/jobs/{self.job_b.id}/pause/", {"reason": "test"}, format="json").status_code, 403)
        self.assertEqual(client.get(f"/api/production/jobs/{self.job_b.id}/spine/").status_code, 200)

    def test_operator_runs_only_assigned_machines(self):
        client = self._client(self.operator)
        machines = client.get("/api/production/operator/machines/").json()
        rows = machines.get("results", machines) if isinstance(machines, dict) else machines
        self.assertEqual([row["id"] for row in rows], [str(self.machine_a.id)])
        self.assertEqual(client.get(f"/api/production/machine/{self.machine_a.id}/").status_code, 200)
        self.assertEqual(client.get(f"/api/production/machine/{self.machine_a2.id}/").status_code, 403, "same work centre, not assigned")
        self.assertEqual(client.get(f"/api/production/machine/{self.machine_b.id}/").status_code, 403)
        self.assertEqual(client.get(f"/api/production/machine/{self.machine_a.id}/queue/").status_code, 200)

    def test_operator_cannot_reach_other_modules(self):
        client = self._client(self.operator)
        for path in (f"/api/production/wc/{self.wc_a.id}/", "/api/sales/orders/", "/api/inventory/job-work/", "/api/master/products/",
                     "/api/production/jobs/", "/api/analytics/control-tower/"):
            response = client.get(path)
            self.assertEqual(response.status_code, 403, f"{path}: {response.status_code}")
        self.assertEqual(client.post("/api/production/wc-allocation/ready/", {"assignment_id": str(self.assign_a.id)}, format="json").status_code, 403)
        self.assertEqual(client.get(f"/api/production/jobs/{self.job_a.id}/spine/").status_code, 200)
        self.assertEqual(client.get("/api/users/me/").status_code, 200)

    def test_planner_and_admin_are_not_limited_by_assignment(self):
        for user in (self.planner, self.admin):
            client = self._client(user)
            for wc in (self.wc_a, self.wc_b):
                self.assertEqual(client.get(f"/api/production/wc/{wc.id}/").status_code, 200, user.username)

    def test_machines_are_assigned_to_operators_only(self):
        client = self._client(self.admin)
        ok = client.post(f"/api/users/users/{self.operator.id}/assign-machines/", {"machine_ids": [str(self.machine_b.id)]}, format="json")
        self.assertEqual(ok.status_code, 200, ok.content)
        self.assertEqual(list(MachineAssignment.objects.filter(user=self.operator).values_list("machine_id", flat=True)), [self.machine_b.id])
        self.assertEqual(client.post(f"/api/users/users/{self.wcm.id}/assign-machines/", {"machine_ids": [str(self.machine_a.id)]}, format="json").status_code, 400)
        self.assertEqual(client.post(f"/api/users/users/{self.operator.id}/assign-work-centers/", {"work_center_ids": [str(self.wc_a.id)]}, format="json").status_code, 400)
        context = self._client(self.operator).get("/api/users/me/").json()
        self.assertTrue(context)

    def test_an_unassigned_wcm_is_told_why(self):
        UserWorkCenter.objects.filter(user=self.wcm).delete()
        refused = self._client(self.wcm).get(f"/api/production/wc/{self.wc_a.id}/")
        self.assertEqual(refused.status_code, 403)
        self.assertIn("No work centre is assigned", refused.json()["detail"])
