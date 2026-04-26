from decimal import Decimal

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.factory.models import Machine, Plant, Process, WorkCenter
from apps.inventory.models import InventoryLocation
from apps.materials.models import GranuleQualityCode, InventoryMaterial
from apps.production.models import DowntimeLog, MaterialConsumptionLog, ProductionJob, QualityReading
from apps.production.views_machine import (
    machine_job_events,
    machine_log_consumption,
    machine_log_downtime,
    machine_log_quality,
)
from apps.routing.models import RoutingRule
from apps.templates.models import TemplateBlueprint
from apps.users.models import Role, User


class MachineTerminalEndpointTests(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        role = Role.objects.create(code="ADMIN", name="Admin")
        self.user = User.objects.create_user(username="terminal-admin", password="pass12345", role=role)
        self.user.is_owner = True
        self.user.save(update_fields=["is_owner"])
        self.plant = Plant.objects.create(name="Terminal Plant", code="MT")
        self.location = InventoryLocation.objects.create(plant=self.plant, code="MT-WIP", name="Terminal WIP", type="WIP")
        self.work_center = WorkCenter.objects.create(plant=self.plant, name="Terminal WC", code="MT-WC", default_wip_location=self.location)
        self.machine = Machine.objects.create(work_center=self.work_center, name="Terminal Machine", code="MT-MC")
        self.process = Process.objects.create(
            code="MT_EXT",
            name="Machine Extrusion",
            input_form="BULK",
            output_form="ROLL",
            roll_behavior="CREATE_NEW",
        )
        self.route = RoutingRule.objects.create(name="Machine Terminal Route", ordered_processes=["MT_EXT"])
        self.template = TemplateBlueprint.objects.create(name="Machine Roll", fg_type="ROLL", status="DRAFT", routing_rule=self.route)
        self.job = ProductionJob.objects.create(
            job_number="MT-JOB-001",
            template=self.template,
            routing_rule=self.route,
            current_step_index=0,
            current_process=self.process,
            process=self.process,
            work_center=self.work_center,
            machine=self.machine,
            from_location=self.location,
            to_location=self.location,
            quantity=Decimal("100.00"),
            remaining_qty=Decimal("100.0000"),
            job_state="EXECUTING",
            status="RUNNING",
        )
        self.material = InventoryMaterial.objects.create(code="MT-GR", name="Machine Granule", category="GRANULE", base_uom="KG")
        self.granule_code = GranuleQualityCode.objects.create(granule=self.material, code="SP", status="ACTIVE")

    def _post(self, view, payload):
        request = self.factory.post("/", payload, format="json")
        force_authenticate(request, user=self.user)
        return view(request, self.machine.id, self.job.id)

    def _get(self, view, query=""):
        request = self.factory.get(f"/{query}")
        force_authenticate(request, user=self.user)
        return view(request, self.machine.id, self.job.id)

    def test_consumption_quality_downtime_and_events_feed(self):
        response = self._post(
            machine_log_consumption,
            {
                "material_id": str(self.material.id),
                "granule_code_id": str(self.granule_code.id),
                "quantity": "12.500",
                "uom": "KG",
                "is_estimated": False,
            },
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(MaterialConsumptionLog.objects.filter(production_job=self.job).count(), 1)

        response = self._post(
            machine_log_quality,
            {
                "readings": [
                    {"code": "MELT_TEMP_C", "value_numeric": "218", "spec_min": "215", "spec_max": "225", "in_spec": True},
                    {"code": "GAUGE", "value_text": "PASS", "in_spec": True},
                ]
            },
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(QualityReading.objects.filter(production_job=self.job).count(), 2)

        response = self._post(
            machine_log_downtime,
            {
                "reason": "MATERIAL",
                "start_time": timezone.now().isoformat(),
                "notes": "Waiting for material feed",
                "auto_stop": False,
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(DowntimeLog.objects.get(production_job=self.job).notes, "Waiting for material feed")

        response = self._get(machine_job_events, "?limit=20")
        self.assertEqual(response.status_code, 200)
        event_types = {row["type"] for row in response.data["events"]}
        self.assertIn("CONSUMPTION", event_types)
        self.assertIn("QUALITY", event_types)
        self.assertIn("DOWNTIME_START", event_types)

    def test_endpoint_validation_blocks_bad_terminal_payloads(self):
        other_material = InventoryMaterial.objects.create(code="MT-OTHER", name="Other Granule", category="GRANULE", base_uom="KG")
        other_code = GranuleQualityCode.objects.create(granule=other_material, code="OTHER", status="ACTIVE")

        response = self._post(
            machine_log_consumption,
            {"material_id": str(self.material.id), "granule_code_id": str(other_code.id), "quantity": "1"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("granule_code_id", str(response.data))

        response = self._post(machine_log_quality, {"readings": []})
        self.assertEqual(response.status_code, 400)

        response = self._post(machine_log_downtime, {"reason": "BAD_REASON"})
        self.assertEqual(response.status_code, 400)
