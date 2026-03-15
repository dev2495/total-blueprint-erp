from django.core.exceptions import ValidationError
from django.test import SimpleTestCase

from apps.materials.models import InventoryMaterial


class PackagingMasterValidationTests(SimpleTestCase):
    def test_purchased_only_packaging_kind_cannot_be_in_house(self):
        material = InventoryMaterial(
            code="PK-GON-001",
            name="Dispatch Gonny",
            category="PACKAGING",
            base_uom="PCS",
            packaging_kind="GONNY",
            packaging_supply_mode="IN_HOUSE",
            status="ACTIVE",
        )

        with self.assertRaises(ValidationError) as exc:
            material.clean()

        self.assertIn("cannot be produced in house", str(exc.exception))

    def test_convertible_packaging_kind_requires_template_when_in_house(self):
        material = InventoryMaterial(
            code="PK-INNER-001",
            name="Inner Pack",
            category="PACKAGING",
            base_uom="PCS",
            packaging_kind="INNER_POUCH",
            packaging_supply_mode="IN_HOUSE",
            status="ACTIVE",
        )

        with self.assertRaises(ValidationError) as exc:
            material.clean()

        self.assertIn("production template", str(exc.exception).lower())
