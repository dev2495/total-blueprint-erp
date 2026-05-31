from decimal import Decimal

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.factory.models import Machine, Plant, Process, WorkCenter
from apps.inventory.models import InventoryLocation, InventoryReservation, InventoryRoll, RollConsumption, RollLink
from apps.materials.models import GranuleQualityCode, InventoryMaterial
from apps.production.models import (
    DowntimeLog,
    FinishedGoodsBatch,
    JobExecutionLog,
    JobMaterialRequirement,
    MaterialConsumptionLog,
    ProductionJob,
    QualityReading,
    ScrapLog,
)
from apps.production.views_machine import (
    machine_complete_job,
    machine_job_events,
    machine_job_context,
    machine_queue,
    machine_start_job,
    machine_log_consumption,
    machine_log_downtime,
    machine_log_output,
    machine_log_quality,
)
from apps.routing.models import RoutingRule
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.templates.models import TemplateBlueprint, TemplateProcessStep, TemplateProcessStepRollSpec
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

    def _get_machine(self, view, query=""):
        request = self.factory.get(f"/{query}")
        force_authenticate(request, user=self.user)
        return view(request, self.machine.id)

    def _post_for_job(self, view, job, payload):
        request = self.factory.post("/", payload, format="json")
        force_authenticate(request, user=self.user)
        return view(request, self.machine.id, job.id)

    def _make_film(self, code, *, density="0.9200", is_extrudable=False):
        family = InventoryMaterial.objects.create(
            code=f"{code}-FAM",
            name=f"{code} Family",
            category="FILM_FAMILY",
            base_uom="KG",
            density_gcm3=Decimal(str(density)),
        )
        return InventoryMaterial.objects.create(
            code=code,
            name=f"{code} Film",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            density_gcm3=Decimal(str(density)),
            is_extrudable=is_extrudable,
        )

    def _make_job(self, suffix, *, process, material, quantity="10.0000", fg_type="ROLL", geometry=None, unit_weight_g="0"):
        route = RoutingRule.objects.create(name=f"Machine Terminal Route {suffix}", ordered_processes=[process.code])
        template = TemplateBlueprint.objects.create(
            name=f"Machine Terminal Template {suffix}",
            fg_type=fg_type,
            status="DRAFT",
            routing_rule=route,
            pouch_style="PILLOW" if fg_type == "POUCH" else "",
        )
        step = TemplateProcessStep.objects.create(template=template, sequence_number=1, process=process)
        if process.roll_behavior == "MULTI_INPUT_COMBINE":
            TemplateProcessStepRollSpec.objects.create(
                template_step=step,
                input_roll_count=2,
                combine_mode="STRICT_ROLL_COUNT",
                input_lane_count=0,
                thickness_rule="SUM_INPUTS",
                width_rule="MIN_INPUT",
            )

        layer = {
            "variant_id": str(material.id),
            "material_id": str(material.id),
            "variant_code": material.code,
            "variant_name": material.name,
            "thickness_micron": 25,
            "width_mm": 500,
            "weight_kg": float(Decimal(str(quantity))),
            "source": "PURCHASE",
        }
        order = SalesOrder.objects.create(
            customer_name="Machine Test Customer",
            order_name=f"Machine Test Order {suffix}",
            order_type="MTO",
            status="CONFIRMED",
            geometry_override=geometry or {"fg_type": fg_type},
            commercial_confirmed_at=timezone.now(),
            delivery_date=timezone.localdate(),
        )
        item = SalesOrderItem.objects.create(
            sales_order=order,
            template=template,
            mode="TEMPLATE",
            line_name=f"Machine Test Line {suffix}",
            geometry_snapshot=geometry or {"fg_type": fg_type},
            layer_snapshot=[layer],
            printing_snapshot={},
            addons_snapshot=[],
            packaging_snapshot={},
            bom_snapshot={"films": [layer]},
            unit_weight_g=Decimal(str(unit_weight_g)),
            total_weight_kg=Decimal(str(quantity)),
            qty_uom="KG",
            qty_value=Decimal(str(quantity)),
            price_basis="KG",
            unit_price=Decimal("1.0000"),
        )
        return ProductionJob.objects.create(
            job_number=f"MT-{suffix}",
            template=template,
            sales_order_item=item,
            routing_rule=route,
            current_step_index=0,
            current_process=process,
            process=process,
            work_center=self.work_center,
            machine=self.machine,
            from_location=self.location,
            to_location=self.location,
            input_form=process.input_form,
            output_form=process.output_form,
            quantity=Decimal(str(quantity)),
            remaining_qty=Decimal(str(quantity)),
            uom="KG",
            job_state="EXECUTING",
            status="RUNNING",
        )

    def _make_roll(self, suffix, *, material, weight, width="500", thickness="25", status="RESERVED", job=None):
        roll = InventoryRoll.objects.create(
            label_id=f"MT-ROLL-{suffix}",
            material=material,
            plant=self.plant,
            thickness_micron=Decimal(str(thickness)),
            width_mm=Decimal(str(width)),
            weight_kg=Decimal(str(weight)),
            original_weight_kg=Decimal(str(weight)),
            location=self.location,
            status=status,
            stage_index=0,
            current_step_index=0,
            completed_step_index=0,
            template=job.template if job else None,
            sales_order_item=job.sales_order_item if job else None,
            meta_json={"roll_role": "INPUT_STOCK"},
        )
        if job:
            InventoryReservation.objects.create(
                job=job,
                roll=roll,
                material=material,
                quantity=Decimal(str(weight)),
                uom="KG",
                status="ACTIVE",
                created_by=self.user,
            )
        return roll

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

    def test_job_context_exposes_material_release_actuals_for_terminal(self):
        ink = InventoryMaterial.objects.create(code="MT-INK-CYAN", name="Cyan Ink", category="INK", base_uom="KG")
        process = Process.objects.create(
            code="MT_INK_RELEASE",
            name="Ink Release Step",
            input_form="BULK",
            output_form="ROLL",
            roll_behavior="CREATE_NEW",
        )
        job = self._make_job("INK-RELEASE", process=process, material=self.material, quantity="10.0000")
        step = job.template.process_steps.get(sequence_number=1)
        requirement = JobMaterialRequirement.objects.create(
            production_job=job,
            material=ink,
            process_step=step,
            required_qty=Decimal("1.5000"),
            theoretical_qty=Decimal("1.2500"),
            planned_issue_qty=Decimal("1.6000"),
            actual_issued_qty=Decimal("1.4000"),
            actual_returned_qty=Decimal("0.2000"),
            actual_scrap_qty=Decimal("0.0500"),
            consumed_qty=Decimal("1.2000"),
            variance_qty=Decimal("-0.0500"),
            uom="KG",
        )

        request = self.factory.get("/")
        force_authenticate(request, user=self.user)
        response = machine_job_context(request, self.machine.id, job.id)

        self.assertEqual(response.status_code, 200, response.data)
        preview_rows = response.data["inputs"]["bulk_preview"]
        ink_row = next(row for row in preview_rows if row["requirement_id"] == str(requirement.id))
        self.assertEqual(ink_row["material_name"], "Cyan Ink")
        self.assertEqual(ink_row["category"], "INK")
        self.assertEqual(ink_row["theoretical_qty_kg"], 1.25)
        self.assertEqual(ink_row["actual_issued_qty_kg"], 1.4)
        self.assertEqual(ink_row["actual_returned_qty_kg"], 0.2)
        self.assertEqual(ink_row["actual_scrap_qty_kg"], 0.05)
        self.assertIn("planned_issue_qty_kg", ink_row)
        self.assertIn("current_plant_available_qty_kg", ink_row)
        self.assertIn("other_plants_available_qty_kg", ink_row)
        self.assertIn("capture_mode", ink_row)

    def test_log_output_create_new_supports_multi_roll_output_math(self):
        film = self._make_film("MT-FILM-CREATE")
        process = Process.objects.create(
            code="MT_CREATE_NEW",
            name="Create New Roll",
            input_form="BULK",
            output_form="ROLL",
            roll_behavior="CREATE_NEW",
        )
        job = self._make_job("CREATE", process=process, material=film, quantity="10.0000")

        response = self._post_for_job(
            machine_log_output,
            job,
            {
                "roll_outputs": [
                    {"width_mm": "450", "weight_kg": "1.250", "tare_weight_kg": "0.200", "gross_weight_kg": "1.450"},
                    {"width_mm": "600", "weight_kg": "2.750", "tare_weight_kg": "0.300", "gross_weight_kg": "3.050"},
                ]
            },
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(JobExecutionLog.objects.filter(production_job=job).count(), 1)
        self.assertEqual(JobExecutionLog.objects.get(production_job=job).quantity, Decimal("4.0000"))
        outputs = list(InventoryRoll.objects.filter(created_by_job=job).order_by("created_at"))
        self.assertEqual(len(outputs), 2)
        self.assertEqual(sum((roll.weight_kg for roll in outputs), Decimal("0")), Decimal("4.000"))
        self.assertEqual(sum((roll.tare_weight_kg for roll in outputs), Decimal("0")), Decimal("0.500"))
        self.assertEqual(sum((roll.gross_weight_kg for roll in outputs), Decimal("0")), Decimal("4.500"))
        self.assertEqual(sum((roll.net_weight_kg for roll in outputs), Decimal("0")), Decimal("4.000"))
        self.assertEqual({roll.meta_json.get("source_behavior") for roll in outputs}, {"CREATE_NEW"})
        self.assertTrue(all("weight_breakdown" in roll.meta_json for roll in outputs))
        job.refresh_from_db()
        self.assertEqual(job.produced_qty, Decimal("4.0000"))
        self.assertEqual(job.remaining_qty, Decimal("6.0000"))

    def test_log_output_modify_existing_consumes_parent_and_returns_remainder(self):
        film = self._make_film("MT-FILM-MOD")
        process = Process.objects.create(
            code="MT_MODIFY",
            name="Modify Roll",
            input_form="ROLL",
            output_form="ROLL",
            roll_behavior="MODIFY_EXISTING",
        )
        job = self._make_job("MOD", process=process, material=film, quantity="5.0000")
        parent = self._make_roll("MOD-PARENT", material=film, weight="5.000", width="500", thickness="25", job=job)

        response = self._post_for_job(machine_log_output, job, {"actual_qty": "3.000", "scrap_qty": "0.500"})

        self.assertEqual(response.status_code, 200, response.data)
        parent.refresh_from_db()
        self.assertEqual(parent.status, "CONSUMED")
        self.assertEqual(parent.weight_kg, Decimal("0"))
        outputs = InventoryRoll.objects.filter(created_by_job=job, meta_json__source_behavior="MODIFY_EXISTING")
        remainders = InventoryRoll.objects.filter(created_by_job=job, meta_json__source_behavior="MODIFY_EXISTING", meta_json__is_remainder=True)
        self.assertEqual(outputs.filter(meta_json__roll_role="OUTPUT").get().weight_kg, Decimal("3.000"))
        self.assertEqual(remainders.get().weight_kg, Decimal("1.500"))
        self.assertEqual(ScrapLog.objects.get(production_job=job).quantity, Decimal("0.5000"))

    def test_log_output_split_creates_children_remainder_and_genealogy(self):
        film = self._make_film("MT-FILM-SPLIT")
        process = Process.objects.create(
            code="MT_SPLIT",
            name="Split Roll",
            input_form="ROLL",
            output_form="ROLL",
            roll_behavior="SPLIT",
        )
        job = self._make_job("SPLIT", process=process, material=film, quantity="5.0000")
        parent = self._make_roll("SPLIT-PARENT", material=film, weight="5.000", width="600", thickness="25", job=job)

        response = self._post_for_job(
            machine_log_output,
            job,
            {
                "split_outputs": [
                    {"width_mm": "250", "weight_kg": "1.750"},
                    {"width_mm": "300", "weight_kg": "1.250"},
                ],
                "scrap_qty": "0.500",
            },
        )

        self.assertEqual(response.status_code, 200, response.data)
        parent.refresh_from_db()
        self.assertEqual(parent.status, "CONSUMED")
        split_outputs = InventoryRoll.objects.filter(created_by_job=job, meta_json__roll_role="SPLIT_OUTPUT")
        self.assertEqual(split_outputs.count(), 2)
        self.assertEqual(sum((roll.weight_kg for roll in split_outputs), Decimal("0")), Decimal("3.000"))
        self.assertEqual(
            InventoryRoll.objects.get(created_by_job=job, meta_json__source_behavior="SPLIT", meta_json__is_remainder=True).weight_kg,
            Decimal("1.500"),
        )
        self.assertEqual(RollLink.objects.filter(parent_roll=parent, relation_type="SPLIT").count(), 3)

    def test_log_output_multi_input_combine_sums_thickness_and_consumes_all_inputs(self):
        film_a = self._make_film("MT-FILM-LAM-A")
        film_b = self._make_film("MT-FILM-LAM-B")
        process = Process.objects.create(
            code="MT_COMBINE",
            name="Combine Rolls",
            input_form="ROLL",
            output_form="ROLL",
            roll_behavior="MULTI_INPUT_COMBINE",
        )
        job = self._make_job("COMBINE", process=process, material=film_a, quantity="5.0000")
        layers = [
            {
                "variant_id": str(film_a.id),
                "material_id": str(film_a.id),
                "variant_code": film_a.code,
                "variant_name": film_a.name,
                "thickness_micron": 12,
                "width_mm": 500,
                "weight_kg": 2.0,
                "source": "PURCHASE",
            },
            {
                "variant_id": str(film_b.id),
                "material_id": str(film_b.id),
                "variant_code": film_b.code,
                "variant_name": film_b.name,
                "thickness_micron": 40,
                "width_mm": 450,
                "weight_kg": 3.0,
                "source": "PURCHASE",
            },
        ]
        item = job.sales_order_item
        item.layer_snapshot = layers
        item.bom_snapshot = {"films": layers}
        item.save(update_fields=["layer_snapshot", "bom_snapshot"])
        parent_a = self._make_roll("COMBINE-A", material=film_a, weight="2.000", width="500", thickness="12", job=job)
        parent_b = self._make_roll("COMBINE-B", material=film_b, weight="3.000", width="450", thickness="40", job=job)

        response = self._post_for_job(machine_log_output, job, {"actual_qty": "4.500", "scrap_qty": "0.500"})

        self.assertEqual(response.status_code, 200, response.data)
        parent_a.refresh_from_db()
        parent_b.refresh_from_db()
        self.assertEqual(parent_a.status, "CONSUMED")
        self.assertEqual(parent_b.status, "CONSUMED")
        output = InventoryRoll.objects.get(created_by_job=job, meta_json__source_behavior="MULTI_INPUT_COMBINE", meta_json__roll_role="OUTPUT")
        self.assertEqual(output.weight_kg, Decimal("4.500"))
        self.assertEqual(output.width_mm, Decimal("450.00"))
        self.assertEqual(output.thickness_micron, Decimal("52.00"))
        self.assertEqual(RollLink.objects.filter(child_roll=output, relation_type="MERGE").count(), 2)

    def test_roll_to_bulk_requires_pcs_and_posts_fg_batch_when_aligned(self):
        film = self._make_film("MT-FILM-POUCH")
        process = Process.objects.create(
            code="MT_POUCH",
            name="Pouching",
            input_form="ROLL",
            output_form="BULK",
            roll_behavior="NONE",
        )
        geometry = {
            "fg_type": "POUCH",
            "base": {"width_mm": 100, "height_mm": 150},
            "effective": {"width_mm": 100, "height_mm": 150},
        }
        missing_pcs_job = self._make_job(
            "POUCH-MISSING-PCS",
            process=process,
            material=film,
            quantity="4.0000",
            fg_type="POUCH",
            geometry=geometry,
            unit_weight_g="20",
        )
        parent_missing = self._make_roll("POUCH-MISSING", material=film, weight="4.000", width="500", thickness="25", job=missing_pcs_job)

        response = self._post_for_job(machine_log_output, missing_pcs_job, {"actual_qty": "2.000"})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["code"], "MACHINE_LOG_OUTPUT_VALIDATION_FAILED")
        self.assertIn("output_pcs is required", response.data["error"]["message"])
        parent_missing.refresh_from_db()
        self.assertEqual(parent_missing.status, "RESERVED")
        self.assertEqual(FinishedGoodsBatch.objects.filter(production_job=missing_pcs_job).count(), 0)

        ok_job = self._make_job(
            "POUCH-OK",
            process=process,
            material=film,
            quantity="4.0000",
            fg_type="POUCH",
            geometry=geometry,
            unit_weight_g="20",
        )
        parent_ok = self._make_roll("POUCH-OK", material=film, weight="4.000", width="500", thickness="25", job=ok_job)

        response = self._post_for_job(
            machine_log_output,
            ok_job,
            {"actual_qty": "2.000", "output_pcs": 100, "scrap_qty": "0.250"},
        )

        self.assertEqual(response.status_code, 200, response.data)
        parent_ok.refresh_from_db()
        self.assertEqual(parent_ok.status, "CONSUMED")
        batch = FinishedGoodsBatch.objects.get(production_job=ok_job)
        self.assertEqual(batch.qty_kg, Decimal("2.0000"))
        self.assertEqual(batch.qty_pcs, 100)
        consumption = RollConsumption.objects.get(job=ok_job)
        self.assertEqual(consumption.consumed_kg, Decimal("2.250"))
        self.assertEqual(consumption.scrap_kg, Decimal("0.250"))
        self.assertEqual(consumption.output_kg, Decimal("2.000"))

    def test_roll_to_bulk_template_kg_only_posts_fg_batch_without_pcs(self):
        film = self._make_film("MT-FILM-POUCH-KG")
        process = Process.objects.create(
            code="MT_POUCH_KG",
            name="Pouching KG",
            input_form="ROLL",
            output_form="BULK",
            roll_behavior="NONE",
        )
        geometry = {
            "fg_type": "POUCH",
            "base": {"width_mm": 100, "height_mm": 150},
            "effective": {"width_mm": 100, "height_mm": 150},
        }
        job = self._make_job(
            "POUCH-KG-ONLY",
            process=process,
            material=film,
            quantity="4.0000",
            fg_type="POUCH",
            geometry=geometry,
            unit_weight_g="20",
        )
        step = job.template.process_steps.get(sequence_number=1)
        TemplateProcessStepRollSpec.objects.create(
            template_step=step,
            input_roll_count=1,
            operator_entry_mode="KG_ONLY",
        )
        parent = self._make_roll("POUCH-KG-ONLY", material=film, weight="4.000", width="500", thickness="25", job=job)

        response = self._post_for_job(machine_log_output, job, {"actual_qty": "2.000"})

        self.assertEqual(response.status_code, 200, response.data)
        parent.refresh_from_db()
        self.assertEqual(parent.status, "CONSUMED")
        batch = FinishedGoodsBatch.objects.get(production_job=job)
        self.assertEqual(batch.qty_kg, Decimal("2.0000"))
        self.assertEqual(batch.qty_pcs, 0)
        self.assertEqual(batch.meta_json["primary_uom"], "KG")
        self.assertEqual(batch.meta_json["output_capture_policy"]["effective_mode"], "KG_ONLY")
        self.assertEqual(RollConsumption.objects.get(job=job).consumed_kg, Decimal("2.000"))
        job.refresh_from_db()
        self.assertEqual(job.produced_qty, Decimal("2.0000"))
        self.assertEqual(job.remaining_qty, Decimal("2.0000"))

    def test_roll_to_bulk_kg_only_still_rejects_piece_tracked_job_without_pcs(self):
        film = self._make_film("MT-FILM-POUCH-KG-PCS")
        process = Process.objects.create(
            code="MT_POUCH_KG_PCS",
            name="Pouching KG Piece Job",
            input_form="ROLL",
            output_form="BULK",
            roll_behavior="NONE",
        )
        geometry = {
            "fg_type": "POUCH",
            "base": {"width_mm": 100, "height_mm": 150},
            "effective": {"width_mm": 100, "height_mm": 150},
        }
        job = self._make_job(
            "POUCH-KG-PCS-JOB",
            process=process,
            material=film,
            quantity="100.0000",
            fg_type="POUCH",
            geometry=geometry,
            unit_weight_g="20",
        )
        job.uom = "PCS"
        job.save(update_fields=["uom", "updated_at"])
        step = job.template.process_steps.get(sequence_number=1)
        TemplateProcessStepRollSpec.objects.create(
            template_step=step,
            input_roll_count=1,
            operator_entry_mode="KG_ONLY",
        )
        parent = self._make_roll("POUCH-KG-PCS-JOB", material=film, weight="4.000", width="500", thickness="25", job=job)

        response = self._post_for_job(machine_log_output, job, {"actual_qty": "2.000"})

        self.assertEqual(response.status_code, 400)
        self.assertIn("PCS-tracked", response.data["error"]["message"])
        parent.refresh_from_db()
        self.assertEqual(parent.status, "RESERVED")
        self.assertEqual(FinishedGoodsBatch.objects.filter(production_job=job).count(), 0)

    def test_roll_to_bulk_kg_and_pcs_policy_requires_pcs(self):
        film = self._make_film("MT-FILM-POUCH-BOTH")
        process = Process.objects.create(
            code="MT_POUCH_BOTH",
            name="Pouching Both",
            input_form="ROLL",
            output_form="BULK",
            roll_behavior="NONE",
        )
        geometry = {
            "fg_type": "POUCH",
            "base": {"width_mm": 100, "height_mm": 150},
            "effective": {"width_mm": 100, "height_mm": 150},
        }
        job = self._make_job(
            "POUCH-BOTH",
            process=process,
            material=film,
            quantity="4.0000",
            fg_type="POUCH",
            geometry=geometry,
            unit_weight_g="20",
        )
        step = job.template.process_steps.get(sequence_number=1)
        TemplateProcessStepRollSpec.objects.create(
            template_step=step,
            input_roll_count=1,
            operator_entry_mode="KG_AND_PCS",
        )
        self._make_roll("POUCH-BOTH", material=film, weight="4.000", width="500", thickness="25", job=job)

        response = self._post_for_job(machine_log_output, job, {"actual_qty": "2.000"})

        self.assertEqual(response.status_code, 400)
        self.assertIn("output_pcs is required", response.data["error"]["message"])

    def test_machine_complete_uses_fifteen_percent_close_tolerance(self):
        film = self._make_film("MT-FILM-TOL")
        process = Process.objects.create(
            code="MT_TOL_CREATE",
            name="Tolerance Create",
            input_form="BULK",
            output_form="ROLL",
            roll_behavior="CREATE_NEW",
        )
        job = self._make_job("TOLERANCE", process=process, material=film, quantity="100.0000")

        response = self._post_for_job(
            machine_log_output,
            job,
            {"actual_qty": "86.000", "output_width_mm": "500"},
        )
        self.assertEqual(response.status_code, 200, response.data)

        response = self._post_for_job(machine_complete_job, job, {})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["completion_mode"], "NORMAL")
        job.refresh_from_db()
        self.assertEqual(job.job_state, "COMPLETED")
        self.assertFalse(job.closed_with_variance)

    def test_machine_output_cap_allows_only_fifteen_percent_over_target(self):
        film = self._make_film("MT-FILM-OVER")
        process = Process.objects.create(
            code="MT_OVER_CREATE",
            name="Overage Create",
            input_form="BULK",
            output_form="ROLL",
            roll_behavior="CREATE_NEW",
        )
        job = self._make_job("OVERAGE", process=process, material=film, quantity="10.0000")

        response = self._post_for_job(
            machine_log_output,
            job,
            {"actual_qty": "11.500", "output_width_mm": "500"},
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(JobExecutionLog.objects.get(production_job=job).quantity, Decimal("11.5000"))

        blocked = self._make_job("OVERAGE-BLOCK", process=process, material=film, quantity="10.0000")
        response = self._post_for_job(
            machine_log_output,
            blocked,
            {"actual_qty": "11.600", "output_width_mm": "500"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("exceeds max allowed", response.data["error"]["message"])

    def test_machine_output_keeps_trim_and_scrap_as_separate_scrap_logs(self):
        film = self._make_film("MT-FILM-WASTE")
        process = Process.objects.create(
            code="MT_WASTE_CREATE",
            name="Waste Create",
            input_form="BULK",
            output_form="ROLL",
            roll_behavior="CREATE_NEW",
        )
        job = self._make_job("WASTE", process=process, material=film, quantity="10.0000")

        response = self._post_for_job(
            machine_log_output,
            job,
            {
                "actual_qty": "5.000",
                "output_width_mm": "500",
                "trim_qty": "0.300",
                "process_scrap_qty": "0.200",
            },
        )
        self.assertEqual(response.status_code, 200, response.data)
        scraps = list(ScrapLog.objects.filter(production_job=job).order_by("reason"))
        self.assertEqual(len(scraps), 2)
        self.assertEqual([(row.reason, row.quantity) for row in scraps], [("DEFECT", Decimal("0.2000")), ("TRIM", Decimal("0.3000"))])

    def test_machine_can_start_multiple_jobs_on_same_high_capacity_machine(self):
        film = self._make_film("MT-FILM-PARALLEL")
        process = Process.objects.create(
            code="MT_PAR_CREATE",
            name="Parallel Create",
            input_form="BULK",
            output_form="ROLL",
            roll_behavior="CREATE_NEW",
        )
        first = self._make_job("PAR-1", process=process, material=film, quantity="5.0000")
        second = self._make_job("PAR-2", process=process, material=film, quantity="7.0000")
        for job in (first, second):
            job.job_state = "RELEASED"
            job.status = "ASSIGNED"
            job.save(update_fields=["job_state", "status", "updated_at"])

        first_response = self._post_for_job(machine_start_job, first, {})
        self.assertEqual(first_response.status_code, 200, first_response.data)
        second_response = self._post_for_job(machine_start_job, second, {})
        self.assertEqual(second_response.status_code, 200, second_response.data)

        response = self._get_machine(machine_queue)
        self.assertEqual(response.status_code, 200, response.data)
        executing_ids = {str(row["id"]) for row in response.data if row["job_state"] == "EXECUTING"}
        self.assertIn(str(first.id), executing_ids)
        self.assertIn(str(second.id), executing_ids)
