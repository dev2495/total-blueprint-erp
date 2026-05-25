from django.test import TestCase

from apps.analytics.services_kpi import KPIService
from apps.factory.models import Plant, WorkCenter


class KPIWorkCenterScopeTests(TestCase):
    def test_real_metrics_work_center_scope_uses_valid_roll_and_bulk_filters(self):
        plant = Plant.objects.create(name="Main Plant", code="MAIN")
        work_center = WorkCenter.objects.create(name="Printing", code="PRINT", plant=plant)

        with self.assertNoLogs("apps.analytics.decorators", level="ERROR"):
            metrics = KPIService.get_real_metrics(work_center_ids=[work_center.id])

        self.assertIn("inventory_summary", metrics)
        self.assertEqual(metrics["inventory_summary"]["fg_kg"], 0.0)
