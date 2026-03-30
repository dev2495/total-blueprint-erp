from decimal import Decimal

from django.test import TestCase

from apps.materials.models import InventoryMaterial, PodSku, PodSkuVariant
from apps.sales.services.order_service import _hydrate_pod_snapshot


class PodSkuSnapshotTests(TestCase):
    def test_hydrate_pod_snapshot_resolves_material_truth_from_pod_sku_variant(self):
        pod_material = InventoryMaterial.objects.create(
            code="TEST-POD-280",
            name="Test POD 280",
            category="POD",
            status="ACTIVE",
            base_uom="KG",
            density_gcm3=Decimal("0.9200"),
            pod_type="SINGLE",
            pod_fixed_height_mm=Decimal("280.00"),
            pod_thickness_micron=Decimal("35.000"),
            pod_panel_count=1,
            pod_is_inhouse_produced=True,
            is_purchasable=True,
            is_extrudable=False,
        )
        pod_sku = PodSku.objects.create(code="TEST-POD-SKU", name="Test POD SKU", family="POD", active=True)
        variant = PodSkuVariant.objects.create(
            pod_sku=pod_sku,
            material=pod_material,
            code="POD-280",
            name="POD 280",
            active=True,
            production_defaults_json={"fixed_height_mm": 280, "in_house": True},
            reporting_attributes_json={"width_mm": 280},
        )

        hydrated = _hydrate_pod_snapshot(
            {
                "enabled": True,
                "pod_sku_variant_id": str(variant.id),
            }
        )

        self.assertTrue(hydrated["enabled"])
        self.assertEqual(hydrated["pod_profile_id"], str(pod_material.id))
        self.assertEqual(hydrated["pod_sku_variant_id"], str(variant.id))
        self.assertEqual(hydrated["pod_sku_code"], "POD-280")
        self.assertEqual(hydrated["pod_sku_name"], "POD 280")
