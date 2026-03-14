from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from apps.production.services.job_services import JobService


class JobWorkVendorSelectionTests(SimpleTestCase):
    @patch("apps.inventory.services.job_work.JobWorkService.create_order")
    @patch("apps.inventory.services.job_work.JobWorkService.compatible_vendors")
    @patch("apps.inventory.models.JobWorkOrder.objects.filter")
    @patch("apps.production.services.job_services.ProductionJob.objects.select_related")
    @patch("apps.production.services.job_services.JobService.pause_job")
    def test_send_to_jobwork_picks_matching_vendor_only(
        self,
        mock_pause_job,
        mock_job_select,
        mock_order_filter,
        mock_compatible_vendors,
        mock_create_order,
    ):
        plant = SimpleNamespace(id="plant-1", code="PLANT_A")
        job = SimpleNamespace(
            id="job-1",
            job_number="JOB-1",
            job_state="RELEASED",
            current_process=SimpleNamespace(code="PRINTING"),
            process=None,
            work_center=SimpleNamespace(plant=plant),
            from_location=None,
            to_location=None,
            current_step_index=2,
            is_on_hold=False,
            hold_reason="",
            save=MagicMock(),
        )
        vendor_bad = SimpleNamespace(id="vendor-bad", name="Vendor Bad")
        vendor_good = SimpleNamespace(id="vendor-good", name="Vendor Good")
        created_order = SimpleNamespace(id="order-1", vendor_name="Vendor Good")

        mock_job_select.return_value.get.return_value = job
        mock_order_filter.return_value.order_by.return_value.first.return_value = None
        mock_compatible_vendors.return_value = [
            (vendor_bad, {"match": False, "reasons": ["Vendor is not mapped to this plant."]}),
            (vendor_good, {"match": True, "reasons": []}),
        ]
        mock_create_order.return_value = created_order
        mock_pause_job.return_value = job

        paused_job, order = JobService.send_to_jobwork(
            "job-1",
            mode="EMERGENCY",
            emergency_reason="Emergency handoff",
        )

        self.assertIs(paused_job, job)
        self.assertIs(order, created_order)
        self.assertTrue(job.is_on_hold)
        mock_pause_job.assert_called_once_with("job-1", reason="Emergency Job Work: Emergency handoff")
        mock_create_order.assert_called_once()
        self.assertEqual(mock_create_order.call_args.kwargs["vendor"], vendor_good)

    @patch("apps.inventory.services.job_work.JobWorkService.create_order")
    @patch("apps.inventory.services.job_work.JobWorkService.compatible_vendors")
    @patch("apps.inventory.models.JobWorkOrder.objects.filter")
    def test_auto_pause_planned_jobwork_picks_matching_vendor_only(
        self,
        mock_order_filter,
        mock_compatible_vendors,
        mock_create_order,
    ):
        plant = SimpleNamespace(id="plant-1", code="PLANT_A")
        job = SimpleNamespace(
            id="job-2",
            job_number="JOB-2",
            current_process=SimpleNamespace(code="PRINTING_JOBWORK"),
            process=None,
            work_center=SimpleNamespace(plant=plant),
            from_location=None,
            to_location=None,
            current_step_index=1,
            job_state="RELEASED",
            is_on_hold=False,
            hold_reason="",
            save=MagicMock(),
        )
        vendor_bad = SimpleNamespace(id="vendor-bad", name="Vendor Bad")
        vendor_good = SimpleNamespace(id="vendor-good", name="Vendor Good")
        created_order = SimpleNamespace(id="order-2", vendor_name="Vendor Good")

        mock_order_filter.return_value.order_by.return_value.first.return_value = None
        mock_compatible_vendors.return_value = [
            (vendor_bad, {"match": False, "reasons": ["Vendor is not mapped to this plant."]}),
            (vendor_good, {"match": True, "reasons": []}),
        ]
        mock_create_order.return_value = created_order

        order = JobService._auto_pause_for_planned_jobwork(job)

        self.assertIs(order, created_order)
        self.assertEqual(job.job_state, "PAUSED")
        self.assertTrue(job.is_on_hold)
        self.assertIn("Vendor Good", job.hold_reason)
        mock_create_order.assert_called_once()
        self.assertEqual(mock_create_order.call_args.kwargs["vendor"], vendor_good)
