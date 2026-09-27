from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from apps.production.services.queue_enrichment import print_color_contract_for_job
from apps.production.views_planner import PlannerViewSet


class PrintColorRevisionTests(SimpleTestCase):
    def test_effective_job_colors_come_from_governed_snapshot(self):
        source = SimpleNamespace(
            printing_snapshot={
                "front_colors": ["NAVY", "WHITE"],
                "back_colors": ["BLACK"],
                "color_revision": {
                    "revision_no": 2,
                    "changed_at": "2026-08-23T10:00:00+05:30",
                    "changed_by": "Planner",
                    "reason": "Customer sample approval",
                    "previous_front_colors": ["ROYAL BLUE", "WHITE"],
                    "previous_back_colors": ["BLACK"],
                },
            }
        )
        job = SimpleNamespace(sales_order_item=source, mts_order=None)

        contract = print_color_contract_for_job(job)

        self.assertEqual(contract["ink_colors"], ["NAVY", "WHITE", "BLACK"])
        self.assertEqual(contract["previous_front_colors"], ["ROYAL BLUE", "WHITE"])
        self.assertEqual(contract["color_revision_no"], 2)
        self.assertTrue(contract["operator_notice_required"])

    def test_rejects_color_count_change_after_release(self):
        with self.assertRaisesMessage(ValueError, "Color count cannot change after release"):
            PlannerViewSet._requested_print_colors(["CYAN"], side="front", expected_count=2)

    def test_post_release_color_revision_is_planner_governed(self):
        request = SimpleNamespace(
            user=SimpleNamespace(
                is_authenticated=True,
                is_superuser=False,
                is_owner=False,
                effective_role_code="WCM",
                role=SimpleNamespace(code="WCM"),
            ),
            data={},
        )

        response = PlannerViewSet().control_hub_revise_print_colors(
            request,
            order_kind="sales",
            order_id="order-1",
        )

        self.assertEqual(response.status_code, 403)
        self.assertIn("Only Planner", response.data["error"])

    @patch("apps.production.views_planner.ProductionWcmAuditEvent.objects.create")
    @patch("apps.production.views_planner.build_invariant_signature", return_value="new-invariant")
    @patch("apps.production.views_planner.build_spec_signature", return_value="new-spec")
    def test_revision_updates_snapshot_bom_job_and_audit(self, _spec_signature, _invariant_signature, create_audit):
        source = SimpleNamespace(
            id="stock-1",
            template=SimpleNamespace(fg_type="ROLL"),
            target_qty=Decimal("100"),
            quantity_uom="KG",
            geometry_snapshot={"finished_good_type": "ROLL", "roll_form": "OPEN_WEB"},
            layer_snapshot=[],
            addons_snapshot=[],
            printing_snapshot={
                "enabled": True,
                "artwork_id": "art-1",
                "front_colors_count": 2,
                "back_colors_count": 0,
                "front_colors": ["CYAN", "BLACK"],
                "back_colors": [],
                "color_names": ["CYAN", "BLACK"],
            },
            unit_weight_g=Decimal("0"),
            total_weight_kg=Decimal("0"),
            bom_snapshot={"inks": [{"name": "Theoretical printing ink", "colors": ["CYAN", "BLACK"], "weight_kg": 1.25}]},
            spec_signature="old-spec",
            invariant_signature="old-invariant",
            save=Mock(),
        )
        work_center = SimpleNamespace(id="wc-1")
        assignment = SimpleNamespace(id="assignment-1", assigned_machine=None)
        job = SimpleNamespace(
            id="job-1",
            job_state="EXECUTING",
            status="RUNNING",
            meta_json={},
            work_center=work_center,
            machine=None,
            assignment=assignment,
            save=Mock(),
        )
        actor = SimpleNamespace(
            id="user-1",
            username="planner",
            is_authenticated=True,
            get_full_name=lambda: "Planner User",
        )
        request = SimpleNamespace(
            user=actor,
            data={
                "front_colors": ["NAVY", "BLACK"],
                "back_colors": [],
                "reason": "Customer approved sample",
            },
        )
        create_audit.return_value = SimpleNamespace(id="audit-1")

        revision, audit_ids = PlannerViewSet()._apply_released_print_color_revision(
            source=source,
            jobs=[job],
            request=request,
        )

        self.assertEqual(revision["revision_no"], 1)
        self.assertEqual(source.printing_snapshot["front_colors"], ["NAVY", "BLACK"])
        self.assertEqual(source.bom_snapshot["inks"][0]["colors"], ["NAVY", "BLACK"])
        self.assertEqual(source.bom_snapshot["inks"][0]["weight_kg"], 1.25)
        self.assertEqual(source.unit_weight_g, Decimal("0"))
        self.assertEqual(source.spec_signature, "new-spec")
        self.assertEqual(job.meta_json["effective_print_color_revision"]["front_colors"], ["NAVY", "BLACK"])
        self.assertEqual(audit_ids, ["audit-1"])
        create_audit.assert_called_once()
