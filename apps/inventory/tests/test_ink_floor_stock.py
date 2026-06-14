from datetime import datetime, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.artwork.models import Artwork
from apps.factory.models import Plant, Process, WorkCenter
from apps.inventory.models import InkFloorCountLine, InkFloorMovement, InkMaterial, InventoryBulk, InventoryLocation
from apps.inventory.services.bulk_service import BulkService
from apps.inventory.services.ink_floor import InkFloorService
from apps.production.models import JobExecutionLog, ProductionJob
from apps.routing.models import RoutingRule
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.templates.models import TemplateBlueprint
from apps.users.models import CompanyProfile


class InkFloorStockTests(TestCase):
    def setUp(self):
        CompanyProfile.objects.update_or_create(
            id=1,
            defaults={
                "shift_boundaries": {
                    "A": ["06:00", "14:00"],
                    "B": ["14:00", "22:00"],
                    "C": ["22:00", "06:00"],
                },
            },
        )
        self.plant = Plant.objects.create(name="Ink Floor Plant", code="INK-FLOOR-P")
        self.store = InventoryLocation.objects.create(
            plant=self.plant,
            code="INK-STORE",
            name="Ink Store",
            type="RM",
        )
        self.floor = InventoryLocation.objects.create(
            plant=self.plant,
            code="INK-FLOOR",
            name="Ink Floor",
            type="WIP",
        )
        self.ink = InkMaterial.objects.create(base_type="POLY", color_name="CYAN")
        self.user = get_user_model().objects.create_user(username="ink-floor-user", password="testpass123")
        BulkService.add_bulk(
            str(self.ink.id),
            Decimal("20.0000"),
            str(self.plant.id),
            str(self.store.id),
            cost=Decimal("100.0000"),
            reference="Opening ink store",
            qty_uom="KG",
        )

    def test_issue_and_return_move_ink_between_store_and_floor_with_audit_rows(self):
        event_at = timezone.now()

        issue = InkFloorService.issue_to_floor(
            material_id=str(self.ink.id),
            qty_kg=Decimal("10.0000"),
            from_location_id=str(self.store.id),
            floor_location_id=str(self.floor.id),
            event_at=event_at,
            shift_code="A",
            reference="ISS-1",
        )
        returned = InkFloorService.return_from_floor(
            material_id=str(self.ink.id),
            qty_kg=Decimal("2.0000"),
            floor_location_id=str(self.floor.id),
            to_location_id=str(self.store.id),
            event_at=event_at,
            shift_code="A",
            reference="RET-1",
        )

        self.assertEqual(issue.type, "ISSUE")
        self.assertEqual(returned.type, "RETURN")
        self.assertEqual(InventoryBulk.objects.get(material=self.ink, location=self.floor).qty_kg, Decimal("8.0000"))
        self.assertEqual(InventoryBulk.objects.get(material=self.ink, location=self.store).qty_kg, Decimal("12.0000"))
        self.assertEqual(InkFloorMovement.objects.filter(material=self.ink).count(), 2)

    def test_shift_is_inferred_from_event_time_not_manual_input(self):
        event_at = timezone.make_aware(datetime(2026, 5, 27, 3, 15, 0))

        issue = InkFloorService.issue_to_floor(
            material_id=str(self.ink.id),
            qty_kg=Decimal("1.0000"),
            from_location_id=str(self.store.id),
            floor_location_id=str(self.floor.id),
            event_at=event_at,
            shift_code="WRONG",
            shift_date=event_at.date(),
            reference="SHIFT-AUTO",
        )

        self.assertEqual(issue.shift_code, "C")
        self.assertEqual(issue.shift_date.isoformat(), "2026-05-26")

    def test_mix_return_creates_mix_master_and_moves_source_floor_stock(self):
        InkFloorService.issue_to_floor(
            material_id=str(self.ink.id),
            qty_kg=Decimal("5.0000"),
            from_location_id=str(self.store.id),
            floor_location_id=str(self.floor.id),
            reference="ISS-MIX",
        )

        movement = InkFloorService.mix_return(
            source_material_id=str(self.ink.id),
            qty_kg=Decimal("3.0000"),
            floor_location_id=str(self.floor.id),
            to_location_id=str(self.store.id),
            target_base_type="POLY",
            target_color_name="GOLD MIX",
            reference="MIX-RET-1",
        )

        mix = movement.target_material
        self.assertEqual(movement.type, "MIX_RETURN")
        self.assertIsNotNone(mix)
        self.assertTrue(mix.is_mix)
        self.assertEqual(mix.color_name, "GOLD MIX")
        self.assertEqual(InventoryBulk.objects.get(material=self.ink, location=self.floor).qty_kg, Decimal("2.0000"))
        self.assertEqual(InventoryBulk.objects.get(material=mix, location=self.store).qty_kg, Decimal("3.0000"))

    def test_count_posts_variance_and_reconciliation_uses_open_issue_return_close_math(self):
        start_at = timezone.now()
        InkFloorService.issue_to_floor(
            material_id=str(self.ink.id),
            qty_kg=Decimal("10.0000"),
            from_location_id=str(self.store.id),
            floor_location_id=str(self.floor.id),
            event_at=start_at,
            shift_code="A",
            reference="ISS-COUNT",
        )
        InkFloorService.return_from_floor(
            material_id=str(self.ink.id),
            qty_kg=Decimal("2.0000"),
            floor_location_id=str(self.floor.id),
            to_location_id=str(self.store.id),
            event_at=start_at,
            shift_code="A",
            reference="RET-COUNT",
        )
        session = InkFloorService.post_count(
            plant_id=str(self.plant.id),
            location_id=str(self.floor.id),
            counted_at=start_at,
            shift_code="A",
            lines=[{"material_id": str(self.ink.id), "counted_qty_kg": Decimal("3.0000")}],
            reference="COUNT-1",
        )

        self.assertEqual(session.status, "POSTED")
        count_line = InkFloorCountLine.objects.get(session=session, material=self.ink)
        self.assertEqual(count_line.system_qty_kg, Decimal("8.0000"))
        self.assertEqual(count_line.counted_qty_kg, Decimal("3.0000"))
        self.assertEqual(count_line.variance_qty_kg, Decimal("-5.0000"))
        self.assertEqual(InventoryBulk.objects.get(material=self.ink, location=self.floor).qty_kg, Decimal("3.0000"))

        reconciliation = InkFloorService.reconcile(
            plant_id=str(self.plant.id),
            location_id=str(self.floor.id),
            start_at=start_at,
            end_at=start_at,
            theory_rows=[{"job_number": "JOB-1", "sales_order": "SO-1", "theory_ink_kg": Decimal("4.0000")}],
        )

        self.assertEqual(reconciliation["totals"]["actual_consumed_kg"], 5.0)
        self.assertEqual(reconciliation["totals"]["theory_ink_kg"], 4.0)
        self.assertEqual(reconciliation["totals"]["variance_kg"], 1.0)
        self.assertEqual(reconciliation["allocations"][0]["actual_allocated_kg"], 5.0)

    def test_five_print_orders_reconcile_theory_against_issue_return_mix_and_count(self):
        start_at = timezone.make_aware(datetime(2026, 6, 14, 8, 0, 0))
        count_at = start_at + timedelta(hours=5)

        process = Process.objects.create(code="INK_FLOW_PRINT", name="Ink Flow Print")
        route = RoutingRule.objects.create(name="Ink Flow Route", ordered_processes=[process.code])
        template = TemplateBlueprint.objects.create(
            name="Ink Flow Print Template",
            fg_type="POUCH",
            status="LIVE",
            routing_rule=route,
        )
        work_center = WorkCenter.objects.create(
            plant=self.plant,
            code="INK_FLOW_WC",
            name="Ink Flow WC",
            default_wip_location=self.floor,
        )
        order_specs = [
            ("FLEXO", "SHEET", Decimal("1.2000"), ["CYAN", "BLACK"]),
            ("ROTO", "TUBING", Decimal("1.1000"), ["RED", "GOLD"]),
            ("FLEXO", "SHEET", Decimal("1.4000"), ["BLUE", "WHITE"]),
            ("ROTO", "TUBING", Decimal("1.0000"), ["GREEN", "BLACK"]),
            ("FLEXO", "SHEET", Decimal("1.8000"), ["YELLOW", "MAGENTA"]),
        ]

        for index, (print_type, substrate_mode, theory_kg, colors) in enumerate(order_specs, start=1):
            artwork = Artwork.objects.create(
                design_code=f"INK-FLOW-{print_type}-{index}",
                name=f"{print_type} ink flow artwork {index}",
                print_type=print_type,
                substrate_mode=substrate_mode,
                status="APPROVED",
                front_colors=colors,
                front_colors_count=len(colors),
                back_colors=[] if substrate_mode == "SHEET" else ["REVERSE BLACK"],
                back_colors_count=0 if substrate_mode == "SHEET" else 1,
                color_list=colors,
                colors_count=len(colors),
                ink_gsm_total=Decimal("1.2500"),
            )
            order = SalesOrder.objects.create(
                customer_name=f"Ink Flow Customer {index}",
                order_name=f"Ink Flow {print_type} Order {index}",
                status="CONFIRMED",
            )
            item = SalesOrderItem.objects.create(
                sales_order=order,
                template=template,
                line_name=f"{print_type} line {index}",
                qty_value=Decimal("1000.0000"),
                qty_uom="PCS",
                unit_price=Decimal("1.0000"),
                printing_snapshot={
                    "enabled": True,
                    "type": print_type,
                    "print_type": print_type,
                    "substrate_mode": substrate_mode,
                    "artwork_id": str(artwork.id),
                    "artwork_design_code": artwork.design_code,
                    "color_names": colors,
                    "front_colors": colors,
                    "back_colors": [] if substrate_mode == "SHEET" else ["REVERSE BLACK"],
                    "ink_gsm_total": float(artwork.ink_gsm_total),
                    "cylinder_required": print_type == "ROTO",
                },
                bom_snapshot={
                    "inks": [
                        {
                            "code": "INK-THEORY",
                            "name": "Theoretical printing ink",
                            "color": "TOTAL",
                            "gsm_total": float(artwork.ink_gsm_total),
                            "weight_kg": float(theory_kg),
                        }
                    ]
                },
            )
            job = ProductionJob.objects.create(
                job_number=f"INK-FLOW-JOB-{index}",
                template=template,
                sales_order_item=item,
                routing_rule=route,
                current_step_index=0,
                current_process=process,
                process=process,
                work_center=work_center,
                from_location=self.floor,
                quantity=Decimal("1000.00"),
                uom="PCS",
                remaining_qty=Decimal("1000.0000"),
            )
            log = JobExecutionLog.objects.create(production_job=job, quantity=Decimal("1000.0000"), uom="PCS")
            JobExecutionLog.objects.filter(id=log.id).update(logged_at=start_at + timedelta(minutes=index * 20))

        other_plant = Plant.objects.create(name="Other Ink Flow Plant", code="OTHER-INK-FLOW")
        other_floor = InventoryLocation.objects.create(
            plant=other_plant,
            code="OTHER-INK-FLOOR",
            name="Other Ink Floor",
            type="WIP",
        )
        other_wc = WorkCenter.objects.create(
            plant=other_plant,
            code="OTHER_INK_WC",
            name="Other Ink WC",
            default_wip_location=other_floor,
        )
        other_order = SalesOrder.objects.create(customer_name="Other Plant Customer", status="CONFIRMED")
        other_item = SalesOrderItem.objects.create(
            sales_order=other_order,
            template=template,
            qty_value=Decimal("1000.0000"),
            qty_uom="PCS",
            unit_price=Decimal("1.0000"),
            printing_snapshot={"enabled": True, "type": "FLEXO", "artwork_id": "OTHER"},
            bom_snapshot={"inks": [{"weight_kg": 99.0}]},
        )
        other_job = ProductionJob.objects.create(
            job_number="INK-FLOW-OTHER-PLANT",
            template=template,
            sales_order_item=other_item,
            routing_rule=route,
            current_process=process,
            process=process,
            work_center=other_wc,
            from_location=other_floor,
            quantity=Decimal("1000.00"),
            uom="PCS",
            remaining_qty=Decimal("1000.0000"),
        )
        other_log = JobExecutionLog.objects.create(production_job=other_job, quantity=Decimal("1000.0000"), uom="PCS")
        JobExecutionLog.objects.filter(id=other_log.id).update(logged_at=start_at + timedelta(minutes=35))

        BulkService.add_bulk(
            str(self.ink.id),
            Decimal("5.0000"),
            str(self.plant.id),
            str(self.store.id),
            cost=Decimal("100.0000"),
            reference="FLOW-INWARD",
            qty_uom="KG",
        )
        InkFloorService.issue_to_floor(
            material_id=str(self.ink.id),
            qty_kg=Decimal("10.0000"),
            from_location_id=str(self.store.id),
            floor_location_id=str(self.floor.id),
            event_at=start_at + timedelta(minutes=10),
            reference="FLOW-ISSUE",
        )
        InkFloorService.return_from_floor(
            material_id=str(self.ink.id),
            qty_kg=Decimal("1.5000"),
            floor_location_id=str(self.floor.id),
            to_location_id=str(self.store.id),
            event_at=start_at + timedelta(hours=3),
            reference="FLOW-RETURN",
        )
        mix_movement = InkFloorService.mix_return(
            source_material_id=str(self.ink.id),
            qty_kg=Decimal("2.0000"),
            floor_location_id=str(self.floor.id),
            to_location_id=str(self.store.id),
            target_base_type="POLY",
            target_color_name="BLACK MIX",
            event_at=start_at + timedelta(hours=4),
            reference="FLOW-MIX",
        )
        count = InkFloorService.post_count(
            plant_id=str(self.plant.id),
            location_id=str(self.floor.id),
            counted_at=count_at,
            reference="FLOW-COUNT",
            lines=[{"material_id": str(self.ink.id), "counted_qty_kg": Decimal("0.0000")}],
        )

        self.assertTrue(mix_movement.target_material.is_mix)
        self.assertEqual(InventoryBulk.objects.get(material=self.ink, location=self.floor).qty_kg, Decimal("0.0000"))
        self.assertEqual(
            InkFloorCountLine.objects.get(session=count, material=self.ink).variance_qty_kg,
            Decimal("-6.5000"),
        )

        reconciliation = InkFloorService.reconcile(
            plant_id=str(self.plant.id),
            location_id=str(self.floor.id),
            start_at=start_at,
            end_at=count_at,
        )

        self.assertEqual(reconciliation["totals"]["issued_kg"], 10.0)
        self.assertEqual(reconciliation["totals"]["returned_kg"], 3.5)
        self.assertEqual(reconciliation["totals"]["closing_kg"], 0.0)
        self.assertEqual(reconciliation["totals"]["actual_consumed_kg"], 6.5)
        self.assertEqual(reconciliation["totals"]["theory_ink_kg"], 6.5)
        self.assertEqual(reconciliation["totals"]["variance_kg"], 0.0)
        self.assertEqual(len(reconciliation["allocations"]), 5)
        self.assertEqual({row["sales_order"] for row in reconciliation["allocations"]}, {f"SO-2026-{i:04d}" for i in range(1, 6)})

    def test_production_sessions_api_filters_by_shift_date_for_stock_lifecycle_proof(self):
        first_count_at = timezone.now()
        second_count_at = first_count_at + timedelta(days=1)
        first = InkFloorService.post_count(
            plant_id=str(self.plant.id),
            location_id=str(self.floor.id),
            counted_at=first_count_at,
            shift_code="A",
            lines=[{"material_id": str(self.ink.id), "counted_qty_kg": Decimal("0.0000")}],
            reference="COUNT-DAY-1",
        )
        second = InkFloorService.post_count(
            plant_id=str(self.plant.id),
            location_id=str(self.floor.id),
            counted_at=second_count_at,
            shift_code="B",
            lines=[{"material_id": str(self.ink.id), "counted_qty_kg": Decimal("0.0000")}],
            reference="COUNT-DAY-2",
        )

        client = APIClient()
        client.force_authenticate(user=self.user)
        response = client.get(
            "/api/production/ink-control/sessions/",
            {
                "plant": str(self.plant.id),
                "shift_date": first.shift_date.isoformat(),
                "status": "POSTED",
            },
        )

        self.assertEqual(response.status_code, 200, response.content)
        references = {row["reference"] for row in response.data}
        self.assertIn(first.reference, references)
        self.assertNotIn(second.reference, references)
