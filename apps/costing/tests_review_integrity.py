from decimal import Decimal
from threading import Event, Thread

from django.db import close_old_connections, transaction
from django.test import TestCase, TransactionTestCase, override_settings
from rest_framework.test import APIClient, APIRequestFactory, force_authenticate

from apps.costing.models import CostAbsorptionGroup, PlantCostPoolLine, PlantCostPoolMonth
from apps.costing.views import PlantCostPoolLineViewSet
from apps.factory.models import Plant
from apps.users.models import Role, User


@override_settings(STRICT_RBAC=True)
class CostPoolIntegrityTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        role = Role.objects.create(code="GUEST", name="Cost delegate")
        self.user = User.objects.create_user(
            username="cost-delegate", role=role, extra_permissions=["costing.view", "costing.manage"],
        )
        self.client.force_authenticate(self.user)
        self.plant = Plant.objects.create(code="COST-PLANT", name="Cost plant")
        self.group = CostAbsorptionGroup.objects.create(code="REVIEW-COST", label="Review cost")
        self.other_group = CostAbsorptionGroup.objects.create(code="REVIEW-COST-OTHER", label="Other")
        self.month = PlantCostPoolMonth.objects.create(
            plant=self.plant, year=2026, month=1, status="LOCKED", plant_total_labor=100,
        )
        self.draft = PlantCostPoolMonth.objects.create(plant=self.plant, year=2026, month=2)
        self.line = PlantCostPoolLine.objects.create(month_record=self.month, cost_group=self.group, labor_cost=100)

    def test_locked_month_rejects_mutation_allocation_deletion_and_backward_status(self):
        url = f"/api/costing/plant-pool-months/{self.month.pk}/"
        operations = [
            ("patch", url, {"plant_total_labor": "200"}),
            ("patch", url, {"status": "DRAFT"}),
            ("post", url + "allocate-from-totals/", {"percentages": {str(self.group.pk): "50"}}),
            ("post", url + "review/", {}),
            ("delete", url, {}),
        ]
        for method, path, payload in operations:
            with self.subTest(method=method, path=path, payload=payload):
                response = getattr(self.client, method)(path, payload, format="json")
                self.assertEqual(response.status_code, 400, response.data)
                self.month.refresh_from_db()
                self.line.refresh_from_db()
                self.assertEqual(self.month.status, "LOCKED")
                self.assertEqual(self.month.plant_total_labor, Decimal("100"))
                self.assertEqual(self.line.labor_cost, Decimal("100"))

    def test_locked_parent_rejects_line_creation_update_deletion_and_reparenting(self):
        base = "/api/costing/plant-pool-lines/"
        operations = [
            ("post", base, {"month_record": str(self.month.pk), "cost_group": str(self.other_group.pk), "labor_cost": "20"}),
            ("patch", base + f"{self.line.pk}/", {"labor_cost": "200"}),
            ("patch", base + f"{self.line.pk}/", {"month_record": str(self.draft.pk)}),
            ("delete", base + f"{self.line.pk}/", {}),
        ]
        for method, path, payload in operations:
            with self.subTest(method=method, payload=payload):
                response = getattr(self.client, method)(path, payload, format="json")
                self.assertEqual(response.status_code, 400, response.data)
                self.line.refresh_from_db()
                self.assertEqual(self.line.month_record_id, self.month.pk)
                self.assertEqual(self.line.labor_cost, Decimal("100"))
                self.assertEqual(self.month.lines.count(), 1)

    def test_unlocked_line_parent_cannot_be_changed_to_another_month(self):
        line = PlantCostPoolLine.objects.create(month_record=self.draft, cost_group=self.group, labor_cost=10)
        other = PlantCostPoolMonth.objects.create(plant=self.plant, year=2026, month=4)
        response = self.client.patch(
            f"/api/costing/plant-pool-lines/{line.pk}/",
            {"month_record": str(other.pk)}, format="json",
        )
        self.assertEqual(response.status_code, 400, response.data)
        line.refresh_from_db()
        self.assertEqual(line.month_record_id, self.draft.pk)

    def test_authorized_draft_review_lock_workflow_and_idempotent_lock_remain_available(self):
        month_url = f"/api/costing/plant-pool-months/{self.draft.pk}/"
        response = self.client.patch(month_url, {"plant_total_labor": "80"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        response = self.client.post(
            "/api/costing/plant-pool-lines/",
            {"month_record": str(self.draft.pk), "cost_group": str(self.group.pk), "labor_cost": "10"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        line_url = f"/api/costing/plant-pool-lines/{response.data['id']}/"
        response = self.client.patch(line_url, {"month_record": str(self.draft.pk), "labor_cost": "20"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        response = self.client.post(month_url + "allocate-from-totals/", {"percentages": {str(self.group.pk): "100"}}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        response = self.client.post(month_url + "review/", {}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "REVIEWED")
        self.assertEqual(self.client.patch(line_url, {"notes": "ignored", "labor_cost": "85"}, format="json").status_code, 200)
        for _ in range(2):
            response = self.client.post(month_url + "lock/", {}, format="json")
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(response.data["status"], "LOCKED")
        self.assertEqual(self.client.get(month_url).status_code, 200)
        self.assertEqual(self.client.get(line_url).status_code, 200)

    def test_cost_write_permission_is_still_required(self):
        user = User.objects.create_user(username="cost-read-only", extra_permissions=["costing.view"])
        self.client.force_authenticate(user)
        response = self.client.patch(
            f"/api/costing/plant-pool-months/{self.draft.pk}/", {"plant_total_labor": "200"}, format="json",
        )
        self.assertEqual(response.status_code, 403, response.data)


class CostPoolLockConcurrencyTests(TransactionTestCase):
    def test_line_write_waits_for_parent_lock_and_rechecks_committed_status(self):
        user = User.objects.create_user(username="cost-lock-owner", is_owner=True)
        plant = Plant.objects.create(code="COST-CONCURRENT", name="Concurrent plant")
        group = CostAbsorptionGroup.objects.create(code="COST-CONCURRENT-GROUP", label="Concurrent")
        month = PlantCostPoolMonth.objects.create(plant=plant, year=2026, month=3)
        line = PlantCostPoolLine.objects.create(month_record=month, cost_group=group, labor_cost=10)
        started, completed = Event(), Event()
        results = []

        def edit_line():
            close_old_connections()
            try:
                request = APIRequestFactory().patch("/api/costing/plant-pool-lines/", {"labor_cost": "99"}, format="json")
                force_authenticate(request, user)
                started.set()
                response = PlantCostPoolLineViewSet.as_view({"patch": "partial_update"})(request, pk=line.pk)
                results.append(response.status_code)
            except Exception as exc:
                results.append(exc)
            finally:
                completed.set()
                close_old_connections()

        with transaction.atomic():
            locked = PlantCostPoolMonth.objects.select_for_update().get(pk=month.pk)
            thread = Thread(target=edit_line)
            thread.start()
            self.assertTrue(started.wait(5))
            finished_before_unlock = completed.wait(0.2)
            locked.status = "LOCKED"
            locked.save(update_fields=["status"])
        thread.join(10)
        self.assertFalse(thread.is_alive())
        self.assertFalse(finished_before_unlock, "Line writes must serialize with the parent lock.")
        self.assertEqual(results, [400])
        line.refresh_from_db()
        self.assertEqual(line.labor_cost, Decimal("10"))
