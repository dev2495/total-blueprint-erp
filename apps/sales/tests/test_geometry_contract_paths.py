from django.test import TestCase

from apps.materials.models import InventoryMaterial
from apps.sales.models import SalesSku
from apps.sales.serializers_orders import SalesSkuVariantSerializer
from apps.sales.services.order_service import SalesOrderService
from apps.templates.models import TemplateBlueprint


class SalesGeometryContractPathTests(TestCase):
    def setUp(self):
        self.template = TemplateBlueprint.objects.create(
            name="UAT Spout Pouch",
            fg_type="POUCH",
            pouch_style="SPOUT",
            status="LIVE",
        )
        self.sku = SalesSku.objects.create(
            code="UAT-SPOUT-SKU",
            name="UAT Spout SKU",
            template=self.template,
            active=True,
        )
        self.family = InventoryMaterial.objects.create(
            code="UAT-FAM-001",
            name="UAT Family",
            category="FILM_FAMILY",
            base_uom="KG",
            density_gcm3=0.9200,
            status="ACTIVE",
        )
        self.variant = InventoryMaterial.objects.create(
            code="UAT-VAR-001",
            name="UAT Variant",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=self.family,
            density_gcm3=0.9200,
            status="ACTIVE",
        )

    def _spout_addon(self):
        return [
            {
                "addon_id": "addon-top-spout",
                "code": "TOP_SPOUT_FITMENT",
                "name": "Top Spout Fitment",
                "qty": 1,
                "quantity": 1,
                "applies_to": "NONE",
                "weight_mode": "PER_PIECE",
                "weight_value": 1.6,
            }
        ]

    def _layer_snapshot(self):
        return [
            {
                "family_id": str(self.family.id),
                "variant_id": str(self.variant.id),
                "thickness_micron": 80,
                "density_g_cm3": 0.92,
                "roll_width_mm": 210,
            }
        ]

    def test_sku_variant_serializer_accepts_locked_style_geometry_contract(self):
        serializer = SalesSkuVariantSerializer(
            data={
                "sku": str(self.sku.id),
                "code": "UAT-SPOUT-V1",
                "name": "UAT Spout Variant",
                "active": True,
                "finished_good_type": "POUCH",
                "geometry_snapshot": {
                    "base": {"width_mm": 160, "height_mm": 240},
                    "pouch_style": "SPOUT",
                    "gusset_mm": 32,
                    "trim_loss_mm": 3,
                    "flap_tape_mm": 6,
                    "adjustments": [{"name": "Seal trim", "value": 2, "impact": "WIDTH"}],
                    "multipliers": {"faces": 1},
                },
                "layer_snapshot": self._layer_snapshot(),
                "printing_snapshot": {"enabled": False},
                "chemicals_snapshot": {},
                "addons_snapshot": self._spout_addon(),
                "packaging_snapshot": {"pod": {"enabled": False}},
            }
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.validated_data["geometry_snapshot"]["pouch_style"], "SPOUT")
        self.assertEqual(serializer.validated_data["geometry_snapshot"]["gusset_mm"], 32)
        self.assertEqual(serializer.validated_data["geometry_snapshot"]["trim_loss_mm"], 3)
        self.assertEqual(serializer.validated_data["geometry_snapshot"]["flap_tape_mm"], 6)

    def test_preview_sales_item_keeps_geometry_adjustments_and_addon_mass(self):
        preview = SalesOrderService.preview_sales_item(
            {
                "template_id": str(self.template.id),
                "finished_good_type": "POUCH",
                "geometry": {
                    "base": {"width_mm": 160, "height_mm": 240},
                    "pouch_style": "SPOUT",
                    "gusset_mm": 32,
                    "trim_loss_mm": 4,
                    "flap_tape_mm": 8,
                    "adjustments": [{"name": "Width allowance", "value": 3, "impact": "WIDTH"}],
                    "multipliers": {"faces": 1},
                },
                "film_layers": self._layer_snapshot(),
                "printing": {"enabled": False},
                "chemicals": {},
                "addons": self._spout_addon(),
                "packaging_snapshot": {"pod": {"enabled": False}},
                "order_qty": 1000,
                "uom": "PCS",
            }
        )

        geometry = preview["physics"]["geometry_snapshot"]
        self.assertGreater(geometry["effective_width_mm"], 160)
        self.assertGreater(geometry["effective_height_mm"], 240)
        self.assertGreater(preview["total_weight_kg"], 0)
        self.assertGreater(preview["physics"]["total_addon_weight"], 0)
