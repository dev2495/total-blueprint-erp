from types import SimpleNamespace

from django.test import SimpleTestCase

from apps.inventory.services.roll_naming import (
    commercial_family_name_for_roll,
    commercial_reporting_group_for_roll,
)


class _NoLazyMaterial:
    def __init__(self):
        self.commercial_family = None
        self.parent_family_id = "physical-family-id"
        self.name = "Plain PET Web"

    def __getattribute__(self, name):
        if name == "parent_family":
            raise AssertionError("roll naming should not lazy-load parent_family")
        return object.__getattribute__(self, name)


class RollNamingTests(SimpleTestCase):
    def test_roll_family_name_falls_back_without_lazy_parent_lookup(self):
        roll = SimpleNamespace(template=None, material=_NoLazyMaterial(), label_id="ROLL-001")

        result = commercial_family_name_for_roll(roll)

        self.assertEqual(result, "Plain PET Web")

    def test_reporting_group_defaults_to_other_without_lazy_parent_lookup(self):
        roll = SimpleNamespace(template=None, material=_NoLazyMaterial(), label_id="ROLL-001")

        result = commercial_reporting_group_for_roll(roll)

        self.assertEqual(result, "OTHER")
