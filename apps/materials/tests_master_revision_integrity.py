import json
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase

from apps.materials import models
from apps.materials.management.commands import repair_master_revision_integrity as repair_command
from apps.templates.models import TemplateBlueprint


class MasterRevisionIntegrityRepairTests(TestCase):
    def setUp(self):
        self.template = TemplateBlueprint.objects.create(
            name="SILVER BOPP BAGS - BMC PRT",
            fg_type="ROLL",
            status="LIVE",
            is_current_version=True,
        )

    def _run_repair(self, *args):
        output = StringIO()
        with patch.multiple(
            repair_command,
            KNOWN_FILM_ALIASES={},
            KNOWN_ROUTE_ALIASES={},
            KNOWN_MASTER_TEMPLATE_FALLBACKS={},
            KNOWN_LEGACY_MASTER_REDIRECTS={},
            KNOWN_ORPHANED_MASTER_RESTORATIONS={
                "BOPP-BAGS": {
                    "master_code": "BOPP-BAGS-V31",
                    "template_name": self.template.name,
                }
            },
        ):
            call_command(
                "repair_master_revision_integrity",
                *args,
                "--skip-open-order-revision",
                stdout=output,
            )
        return json.loads(output.getvalue().strip())

    def test_known_ldnat_replacement_is_not_a_restoration_target(self):
        self.assertNotIn("MLD-LDNAT", repair_command.KNOWN_ORPHANED_MASTER_RESTORATIONS)

    def test_repair_deactivates_and_never_restores_master_with_current_successor_chain(self):
        current = models.ProductMaster.objects.create(
            code="MULTILAYER-SHEET-V30",
            name="Multilayer Sheet",
            product_kind="ROLL",
            default_reporting_group="SEMI_FG",
        )
        intermediate = models.ProductMaster.objects.create(
            code="BOPP-INTERMEDIATE",
            name="Retired intermediate",
            product_kind="ROLL",
            default_reporting_group="SEMI_FG",
            active=False,
            is_current_version=False,
            superseded_by=current,
        )
        legacy = models.ProductMaster.objects.create(
            code="BOPP-BAGS-V31",
            version_group="BOPP-BAGS",
            version=31,
            name="Legacy BOPP bags",
            product_kind="ROLL",
            default_reporting_group="SEMI_FG",
            active=True,
            is_current_version=True,
            superseded_by=intermediate,
        )

        report = self._run_repair("--apply")

        legacy.refresh_from_db()
        self.assertFalse(legacy.active)
        self.assertFalse(legacy.is_current_version)
        self.assertEqual(legacy.superseded_by_id, intermediate.id)
        self.assertEqual(report["active_superseded_masters"]["planned"], 1)
        self.assertEqual(report["active_superseded_masters"]["applied"], 1)
        self.assertEqual(report["orphaned_master_families"]["planned"], 0)
        self.assertEqual(
            report["orphaned_master_families"]["skipped_superseded"][0]["replacement_code"],
            current.code,
        )

    def test_true_orphan_restoration_clears_stale_supersession_pointer(self):
        inactive_replacement = models.ProductMaster.objects.create(
            code="BOPP-RETIRED-COPY",
            name="Retired copy",
            product_kind="ROLL",
            default_reporting_group="SEMI_FG",
            active=False,
            is_current_version=False,
        )
        legacy = models.ProductMaster.objects.create(
            code="BOPP-BAGS-V31",
            version_group="BOPP-BAGS",
            version=31,
            name="Legacy BOPP bags",
            product_kind="ROLL",
            default_reporting_group="SEMI_FG",
            active=False,
            is_current_version=False,
            superseded_by=inactive_replacement,
        )

        report = self._run_repair("--apply")

        legacy.refresh_from_db()
        self.assertTrue(legacy.active)
        self.assertTrue(legacy.is_current_version)
        self.assertIsNone(legacy.superseded_by_id)
        self.assertEqual(legacy.template_id, self.template.id)
        self.assertEqual(report["orphaned_master_families"]["applied"], 1)
