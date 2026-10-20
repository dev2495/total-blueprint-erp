"""Job-work challan values for rolls made in house: valued at what they were made of."""
from decimal import Decimal

from django.test import TestCase

from apps.inventory.models import InventoryBulk, RollLink
from apps.inventory.services.job_work import roll_rate_per_kg
from apps.inventory.tests_job_work_base import JobWorkFixtureMixin


class InHouseRollValueTests(JobWorkFixtureMixin, TestCase):
    def test_slit_child_takes_its_parents_rate(self):
        parent = self.make_roll("VAL-P", "400", rate="152")
        child = self.make_roll("VAL-C", "200", rate="0")
        child.meta_json = {}
        child.parent_roll = parent
        child.save(update_fields=["meta_json", "parent_roll"])
        self.assertEqual(roll_rate_per_kg(child), Decimal("152"))

    def test_laminate_is_weighted_by_its_parents(self):
        a = self.make_roll("VAL-A", "300", rate="150")
        b = self.make_roll("VAL-B", "100", rate="250")
        out = self.make_roll("VAL-LAM", "390", material=self.lam_film, rate="0")
        out.meta_json = {}
        out.save(update_fields=["meta_json"])
        RollLink.objects.create(parent_roll=a, child_roll=out, relation_type="PROCESS_OUTPUT")
        RollLink.objects.create(parent_roll=b, child_roll=out, relation_type="PROCESS_OUTPUT")
        self.assertEqual(roll_rate_per_kg(out), Decimal("175.0000"))

    def test_material_without_a_cost_uses_its_bulk_stock_cost(self):
        InventoryBulk.objects.create(material=self.granule, location=self.rm, plant=self.plant, qty_kg=Decimal("100"), avg_cost=Decimal("118"))
        roll = self.make_roll("VAL-EXT", "200", material=self.granule, rate="0")
        roll.meta_json = {}
        roll.save(update_fields=["meta_json"])
        self.assertEqual(roll_rate_per_kg(roll), Decimal("118.0000"))
