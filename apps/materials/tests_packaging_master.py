from django.core.exceptions import ValidationError
from django.test import SimpleTestCase

from apps.materials.models import InventoryMaterial
from apps.templates.models import TemplateBlueprint


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

    def test_purchased_packaging_without_template_is_valid(self):
        material = InventoryMaterial(
            code="PK-TAPE-001",
            name="Dispatch Tape",
            category="PACKAGING",
            base_uom="PCS",
            packaging_kind="TAPE",
            packaging_supply_mode="PURCHASED",
            status="ACTIVE",
        )

        material.clean()

    def test_purchased_packaging_with_template_is_invalid(self):
        material = InventoryMaterial(
            code="PK-TAPE-002",
            name="Dispatch Tape With Template",
            category="PACKAGING",
            base_uom="PCS",
            packaging_kind="TAPE",
            packaging_supply_mode="PURCHASED",
            production_template=TemplateBlueprint(name="Should Not Attach"),
            status="ACTIVE",
        )

        with self.assertRaises(ValidationError) as exc:
            material.clean()

        self.assertIn("must not carry a production template", str(exc.exception))

    def test_in_house_inner_pouch_with_template_is_valid(self):
        material = InventoryMaterial(
            code="PK-INNER-VALID",
            name="Inner Pack 100",
            category="PACKAGING",
            base_uom="PCS",
            packaging_kind="INNER_POUCH",
            packaging_supply_mode="IN_HOUSE",
            production_template=TemplateBlueprint(name="Acceptance Inner Pack"),
            status="ACTIVE",
        )

        material.clean()

    def test_in_house_sheet_with_template_is_valid(self):
        material = InventoryMaterial(
            code="PK-SHEET-VALID",
            name="Roll Wrap Sheet",
            category="PACKAGING",
            base_uom="KG",
            packaging_kind="SHEET",
            packaging_supply_mode="IN_HOUSE",
            production_template=TemplateBlueprint(name="Acceptance Sheet Pack"),
            status="ACTIVE",
        )

        material.clean()
