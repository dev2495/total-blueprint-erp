from io import StringIO
from types import SimpleNamespace
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase

from apps.factory.models import Plant


class InventorySnapshotCommandTests(TestCase):
    def test_uses_reportable_plants_without_legacy_is_active_filter(self):
        included = Plant.objects.create(name="Included Plant", code="INCL", include_in_official_reports=True)
        Plant.objects.create(name="Excluded Plant", code="EXCL", include_in_official_reports=False)
        fake_snapshot = SimpleNamespace(
            id="snap-1",
            total_bulk_kg=0,
            bulk_sku_count=0,
            total_roll_kg=0,
            roll_count=0,
            total_fg_kg=0,
            total_wip_kg=0,
        )

        out = StringIO()
        with patch(
            "apps.inventory.management.commands.inventory_snapshot.InventoryAuditService.create_snapshot",
            return_value=fake_snapshot,
        ) as create_snapshot:
            call_command("inventory_snapshot", "--skip-reconciliation", stdout=out)

        create_snapshot.assert_called_once_with(included)
        self.assertIn("Snapshot created", out.getvalue())
