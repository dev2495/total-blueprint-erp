from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.artwork.models import Artwork
from apps.materials.models import InventoryMaterial, PodSku, PodSkuVariant, ProductMaster, ProductMasterSize, ProductVariant
from apps.materials.services_product_variant import find_or_create_product_variant
from apps.recipes.models import RecipeGrade
from apps.sales.models import Customer, CustomerProductOverlay


class ProductMasterApiTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="pm-api", password="x")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        RecipeGrade.objects.update_or_create(name="GP", defaults={"is_active": True})
        RecipeGrade.objects.update_or_create(name="FOOD-A", defaults={"is_active": True})
        RecipeGrade.objects.update_or_create(name="CODEX FOOD GRADE", defaults={"is_active": True})

    def test_product_master_crud_uses_product_endpoint(self):
        response = self.client.post(
            "/api/master/products/",
            {
                "code": "DRYFRUIT-STANDUP",
                "name": "Dry Fruit Standup Pouch",
                "product_kind": "POUCH",
                "default_reporting_group": "FG",
                "reusable_policy": "CONFIGURABLE",
                "description": "Common product master for all dry fruit pouch sizes.",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        product_id = response.data["id"]
        self.assertEqual(response.data["code"], "DRYFRUIT-STANDUP")
        self.assertEqual(response.data["product_kind"], "POUCH")

        patch_response = self.client.patch(
            f"/api/master/products/{product_id}/",
            {"name": "Dry Fruit Standup Pouch Family"},
            format="json",
        )

        self.assertEqual(patch_response.status_code, 200)
        self.assertEqual(patch_response.data["name"], "Dry Fruit Standup Pouch Family")
        self.assertTrue(ProductMaster.objects.filter(code="DRYFRUIT-STANDUP").exists())

    def test_product_master_detail_accepts_code_slug_for_nested_ui_links(self):
        product = ProductMaster.objects.create(
            code="PM-DRY-PET-LD",
            name="Dry Fruit Standup Pouch",
            product_kind="POUCH",
            default_reporting_group="FG",
        )
        ProductMasterSize.objects.create(
            product_master=product,
            code="SNK-100",
            label="100g",
            width_mm=100,
            height_mm=150,
            active=True,
        )

        detail_response = self.client.get("/api/master/products/pm-dry-pet-ld/")
        sizes_response = self.client.get("/api/master/products/pm-dry-pet-ld/sizes/")

        self.assertEqual(detail_response.status_code, 200)
        self.assertEqual(detail_response.data["id"], str(product.id))
        self.assertEqual(sizes_response.status_code, 200)
        self.assertEqual(sizes_response.data[0]["code"], "SNK-100")

    def test_packaging_catalog_create_allows_in_house_row_without_direct_template(self):
        response = self.client.post(
            "/api/master/packaging/",
            {
                "code": "PK-INNER-PM-LINK",
                "name": "Inner pouch catalog row for PM link",
                "category": "PACKAGING",
                "base_uom": "PCS",
                "packaging_kind": "INNER_POUCH",
                "packaging_supply_mode": "IN_HOUSE",
                "production_template": None,
                "status": "ACTIVE",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        material = InventoryMaterial.objects.get(code="PK-INNER-PM-LINK")
        self.assertEqual(material.packaging_supply_mode, "IN_HOUSE")
        self.assertIsNone(material.production_template_id)

    def test_product_master_packaging_subtype_sets_physical_output_type(self):
        sheet_response = self.client.post(
            "/api/master/products/",
            {
                "code": "PM-PACK-SHEET-FORM",
                "name": "Packing sheet form",
                "product_kind": "PACKAGING",
                "packaging_kind": "SHEET",
                "default_reporting_group": "PACKAGING",
                "fixed_attributes": {"fg_type": "POUCH", "print_capable": True},
            },
            format="json",
        )
        inferred_response = self.client.post(
            "/api/master/products/",
            {
                "code": "PM-PACK-INFER-ROLL",
                "name": "Packing inferred roll form",
                "product_kind": "PACKAGING",
                "default_reporting_group": "PACKAGING",
                "fixed_attributes": {"fg_type": "ROLL", "print_capable": True},
            },
            format="json",
        )
        pod_response = self.client.post(
            "/api/master/products/",
            {
                "code": "PM-POD-ROLL-FORM",
                "name": "POD roll form",
                "product_kind": "POD",
                "default_reporting_group": "POD",
            },
            format="json",
        )

        self.assertEqual(sheet_response.status_code, 201, sheet_response.data)
        self.assertEqual(sheet_response.data["packaging_kind"], "SHEET")
        self.assertEqual(sheet_response.data["fixed_attributes"]["fg_type"], "ROLL")
        self.assertEqual(inferred_response.status_code, 201, inferred_response.data)
        self.assertEqual(inferred_response.data["packaging_kind"], "SHEET")
        self.assertEqual(inferred_response.data["fixed_attributes"]["fg_type"], "ROLL")
        self.assertEqual(pod_response.status_code, 201, pod_response.data)
        self.assertIsNone(pod_response.data["packaging_kind"])
        self.assertEqual(pod_response.data["fixed_attributes"]["fg_type"], "ROLL")

    def test_variant_inventory_link_requires_matching_packaging_subtype(self):
        master = ProductMaster.objects.create(
            code="PM-PACK-INNER-LINK",
            name="PM inner pouch link",
            product_kind="PACKAGING",
            packaging_kind="INNER_POUCH",
            default_reporting_group="PACKAGING",
        )
        variant = ProductVariant.objects.create(
            master=master,
            code="PM-PACK-INNER-LINK-V1",
            bom_signature="pm-pack-inner-link-v1",
            axis_values={"size": "100"},
        )
        inner = InventoryMaterial.objects.create(
            code="PK-INNER-LINK-OK",
            name="Inner pouch link OK",
            category="PACKAGING",
            base_uom="PCS",
            packaging_kind="INNER_POUCH",
            packaging_supply_mode="PURCHASED",
            status="ACTIVE",
        )
        sheet = InventoryMaterial.objects.create(
            code="PK-SHEET-LINK-BAD",
            name="Sheet link bad",
            category="PACKAGING",
            base_uom="KG",
            packaging_kind="SHEET",
            packaging_supply_mode="IN_HOUSE",
            status="ACTIVE",
        )
        pod = InventoryMaterial.objects.create(
            code="POD-LINK-BAD",
            name="POD link bad",
            category="POD",
            base_uom="KG",
            pod_type="SINGLE",
            pod_fixed_height_mm=200,
            pod_thickness_micron=30,
            pod_panel_count=1,
            pod_is_inhouse_produced=True,
            density_gcm3="0.9200",
            status="ACTIVE",
        )

        wrong_kind = self.client.post(
            f"/api/master/products/{master.id}/variants/{variant.id}/link-inventory/",
            {"inventory_material_id": str(sheet.id)},
            format="json",
        )
        wrong_category = self.client.post(
            f"/api/master/products/{master.id}/variants/{variant.id}/link-inventory/",
            {"inventory_material_id": str(pod.id)},
            format="json",
        )
        ok = self.client.post(
            f"/api/master/products/{master.id}/variants/{variant.id}/link-inventory/",
            {"inventory_material_id": str(inner.id)},
            format="json",
        )

        self.assertEqual(wrong_kind.status_code, 400, wrong_kind.data)
        self.assertIn("packaging_kind", str(wrong_kind.data).lower())
        self.assertEqual(wrong_category.status_code, 400, wrong_category.data)
        self.assertIn("category", str(wrong_category.data).lower())
        self.assertEqual(ok.status_code, 200, ok.data)
        inner.refresh_from_db()
        self.assertEqual(inner.produced_by_product_variant_id, variant.id)
        self.assertEqual(inner.packaging_supply_mode, "BOTH")

    def test_variant_inventory_link_allows_sheet_packaging_subtype_only(self):
        master = ProductMaster.objects.create(
            code="PM-PACK-SHEET-LINK",
            name="PM sheet packing link",
            product_kind="PACKAGING",
            packaging_kind="SHEET",
            default_reporting_group="PACKAGING",
            fixed_attributes={"fg_type": "ROLL"},
        )
        variant = ProductVariant.objects.create(
            master=master,
            code="PM-PACK-SHEET-LINK-V1",
            bom_signature="pm-pack-sheet-link-v1",
            axis_values={"size": "ROLL"},
        )
        sheet = InventoryMaterial.objects.create(
            code="PK-SHEET-LINK-OK",
            name="Sheet link OK",
            category="PACKAGING",
            base_uom="KG",
            packaging_kind="SHEET",
            packaging_supply_mode="PURCHASED",
            status="ACTIVE",
        )
        inner = InventoryMaterial.objects.create(
            code="PK-INNER-SHEET-BAD",
            name="Inner pouch bad for sheet master",
            category="PACKAGING",
            base_uom="PCS",
            packaging_kind="INNER_POUCH",
            packaging_supply_mode="PURCHASED",
            status="ACTIVE",
        )

        wrong_kind = self.client.post(
            f"/api/master/products/{master.id}/variants/{variant.id}/link-inventory/",
            {"inventory_material_id": str(inner.id)},
            format="json",
        )
        ok = self.client.post(
            f"/api/master/products/{master.id}/variants/{variant.id}/link-inventory/",
            {"inventory_material_id": str(sheet.id)},
            format="json",
        )

        self.assertEqual(wrong_kind.status_code, 400, wrong_kind.data)
        self.assertIn("packaging_kind", str(wrong_kind.data).lower())
        self.assertEqual(ok.status_code, 200, ok.data)
        sheet.refresh_from_db()
        self.assertEqual(sheet.produced_by_product_variant_id, variant.id)
        self.assertEqual(sheet.packaging_supply_mode, "BOTH")

    def test_variant_inventory_link_infers_sheet_for_legacy_roll_packaging_master(self):
        master = ProductMaster.objects.create(
            code="PM-PACK-LEGACY-ROLL",
            name="PM legacy roll packing",
            product_kind="PACKAGING",
            packaging_kind=None,
            default_reporting_group="PACKAGING",
            fixed_attributes={"fg_type": "ROLL"},
        )
        variant = ProductVariant.objects.create(
            master=master,
            code="PM-PACK-LEGACY-ROLL-V1",
            bom_signature="pm-pack-legacy-roll-v1",
            axis_values={"size": "ROLL"},
        )
        sheet = InventoryMaterial.objects.create(
            code="PK-SHEET-LEGACY-OK",
            name="Sheet legacy OK",
            category="PACKAGING",
            base_uom="KG",
            packaging_kind="SHEET",
            packaging_supply_mode="IN_HOUSE",
            status="ACTIVE",
        )

        response = self.client.post(
            f"/api/master/products/{master.id}/variants/{variant.id}/link-inventory/",
            {"inventory_material_id": str(sheet.id)},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        sheet.refresh_from_db()
        self.assertEqual(sheet.produced_by_product_variant_id, variant.id)

    def test_variant_inventory_link_requires_pod_catalog_for_pod_master(self):
        master = ProductMaster.objects.create(
            code="PM-POD-LINK",
            name="PM POD link",
            product_kind="POD",
            default_reporting_group="POD",
        )
        variant = ProductVariant.objects.create(
            master=master,
            code="PM-POD-LINK-V1",
            bom_signature="pm-pod-link-v1",
            axis_values={"size": "200"},
        )
        packaging = InventoryMaterial.objects.create(
            code="PK-INNER-POD-BAD",
            name="Packaging is not POD",
            category="PACKAGING",
            base_uom="PCS",
            packaging_kind="INNER_POUCH",
            packaging_supply_mode="IN_HOUSE",
            status="ACTIVE",
        )
        pod = InventoryMaterial.objects.create(
            code="POD-LINK-OK",
            name="POD link OK",
            category="POD",
            base_uom="KG",
            pod_type="SINGLE",
            pod_fixed_height_mm=200,
            pod_thickness_micron=30,
            pod_panel_count=1,
            pod_is_inhouse_produced=True,
            density_gcm3="0.9200",
            status="ACTIVE",
        )

        wrong_category = self.client.post(
            f"/api/master/products/{master.id}/variants/{variant.id}/link-inventory/",
            {"inventory_material_id": str(packaging.id)},
            format="json",
        )
        ok = self.client.post(
            f"/api/master/products/{master.id}/variants/{variant.id}/link-inventory/",
            {"inventory_material_id": str(pod.id)},
            format="json",
        )

        self.assertEqual(wrong_category.status_code, 400, wrong_category.data)
        self.assertIn("category", str(wrong_category.data).lower())
        self.assertEqual(ok.status_code, 200, ok.data)
        pod.refresh_from_db()
        self.assertEqual(pod.produced_by_product_variant_id, variant.id)

    def test_pod_variant_can_link_by_pod_sku_variant_id(self):
        master = ProductMaster.objects.create(
            code="PM-POD-SKU-LINK",
            name="PM POD SKU link",
            product_kind="POD",
            default_reporting_group="POD",
        )
        variant = ProductVariant.objects.create(
            master=master,
            code="PM-POD-SKU-LINK-V1",
            bom_signature="pm-pod-sku-link-v1",
            axis_values={"size": "200"},
        )
        pod = InventoryMaterial.objects.create(
            code="POD-SKU-LINK-MAT",
            name="POD SKU link material",
            category="POD",
            base_uom="KG",
            pod_type="SINGLE",
            pod_fixed_height_mm=200,
            pod_thickness_micron=30,
            pod_panel_count=1,
            pod_is_inhouse_produced=True,
            density_gcm3="0.9200",
            status="ACTIVE",
        )
        pod_sku = PodSku.objects.create(code="POD-SKU-LINK", name="POD SKU Link")
        pod_sku_variant = PodSkuVariant.objects.create(
            pod_sku=pod_sku,
            material=pod,
            code="POD-SKU-LINK-200",
            name="POD SKU Link 200",
            active=True,
        )

        response = self.client.post(
            f"/api/master/products/{master.id}/variants/{variant.id}/link-inventory/",
            {"pod_sku_variant_id": str(pod_sku_variant.id)},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        pod.refresh_from_db()
        self.assertEqual(pod.produced_by_product_variant_id, variant.id)
        self.assertEqual(response.data["inventory_link"]["id"], str(pod.id))
        self.assertEqual(response.data["inventory_link"]["pod_sku_variant_code"], pod_sku_variant.code)

    def test_packaging_and_pod_catalogs_expose_product_master_link_summary(self):
        packaging_master = ProductMaster.objects.create(
            code="PM-PACK-LINK-SUMMARY",
            name="PM Packaging Link Summary",
            product_kind="PACKAGING",
            packaging_kind="SHEET",
            default_reporting_group="PACKAGING",
        )
        packaging_variant = ProductVariant.objects.create(
            master=packaging_master,
            code="PM-PACK-LINK-SUMMARY-V1",
            bom_signature="pm-pack-link-summary-v1",
            axis_values={"size": "ROLL"},
        )
        packaging = InventoryMaterial.objects.create(
            code="PK-LINK-SUMMARY",
            name="Packaging Link Summary",
            category="PACKAGING",
            base_uom="KG",
            packaging_kind="SHEET",
            packaging_supply_mode="IN_HOUSE",
            produced_by_product_variant=packaging_variant,
            status="ACTIVE",
        )
        pod_master = ProductMaster.objects.create(
            code="PM-POD-LINK-SUMMARY",
            name="PM POD Link Summary",
            product_kind="POD",
            default_reporting_group="POD",
        )
        pod_variant = ProductVariant.objects.create(
            master=pod_master,
            code="PM-POD-LINK-SUMMARY-V1",
            bom_signature="pm-pod-link-summary-v1",
            axis_values={"size": "200"},
        )
        pod = InventoryMaterial.objects.create(
            code="POD-LINK-SUMMARY",
            name="POD Link Summary",
            category="POD",
            base_uom="KG",
            pod_type="SINGLE",
            pod_fixed_height_mm=200,
            pod_thickness_micron=30,
            pod_panel_count=1,
            pod_is_inhouse_produced=True,
            density_gcm3="0.9200",
            produced_by_product_variant=pod_variant,
            status="ACTIVE",
        )
        pod_sku = PodSku.objects.create(code="POD-LINK-SUMMARY-SKU", name="POD Link Summary SKU")
        pod_sku_variant = PodSkuVariant.objects.create(
            pod_sku=pod_sku,
            material=pod,
            code="POD-LINK-SUMMARY-VAR",
            name="POD Link Summary Variant",
            active=True,
        )

        packaging_response = self.client.get("/api/master/packaging/")
        pod_response = self.client.get("/api/master/pod/")

        self.assertEqual(packaging_response.status_code, 200, packaging_response.data)
        packaging_row = next(row for row in packaging_response.data if row["id"] == str(packaging.id))
        self.assertEqual(packaging_row["product_master_link"]["variant_code"], packaging_variant.code)
        self.assertEqual(packaging_row["product_master_link"]["master_code"], packaging_master.code)
        self.assertEqual(packaging_row["product_master_link"]["packaging_kind"], "SHEET")

        self.assertEqual(pod_response.status_code, 200, pod_response.data)
        pod_row = next(row for row in pod_response.data if row["id"] == str(pod.id))
        self.assertEqual(pod_row["base_uom"], "KG")
        self.assertEqual(pod_row["product_master_link"]["variant_code"], pod_variant.code)
        self.assertEqual(pod_row["product_master_link"]["master_code"], pod_master.code)
        self.assertEqual(pod_row["product_master_link"]["product_kind"], "POD")

        pod_sku_response = self.client.get("/api/master/pod-sku-variants/")
        self.assertEqual(pod_sku_response.status_code, 200, pod_sku_response.data)
        pod_sku_row = next(row for row in pod_sku_response.data if row["id"] == str(pod_sku_variant.id))
        self.assertEqual(pod_sku_row["material_product_master_link"]["variant_code"], pod_variant.code)
        self.assertEqual(pod_sku_row["material_base_uom"], "KG")

    def test_pod_product_master_variant_does_not_create_catalog_row_without_manual_link(self):
        family = InventoryMaterial.objects.create(
            code="POD-PM-FAM",
            name="POD PM family",
            category="FILM_FAMILY",
            base_uom="KG",
            density_gcm3="0.9200",
            status="ACTIVE",
        )
        InventoryMaterial.objects.create(
            code="POD-PM-LD",
            name="POD PM LD",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            density_gcm3="0.9200",
            is_extrudable=True,
            status="ACTIVE",
        )
        master = ProductMaster.objects.create(
            code="PM-POD-SYNC",
            name="PM POD Sync",
            product_kind="POD",
            default_reporting_group="POD",
            layer_template=[
                {"role": "pod-web", "material_code": "POD-PM-LD", "thickness_micron": 30, "default_grade": "GP"},
            ],
            variant_axes=[{"axis": "size", "type": "geometry", "required": True, "options": ["POD-200"]}],
            fixed_attributes={
                "fg_type": "ROLL",
                "layer_count": 1,
                "pod_type": "SINGLE",
                "pod_fixed_height_mm": 200,
                "pod_thickness_micron": 30,
                "pod_panel_count": 1,
                "density_gcm3": 0.92,
            },
        )
        ProductMasterSize.objects.create(
            product_master=master,
            code="POD-200",
            label="POD 200",
            width_mm=200,
            height_mm=0,
            roll_width_mm=200,
            active=True,
        )

        response = self.client.post(
            f"/api/master/products/{master.id}/variants/find-or-create/",
            {"axis_values": {"size": "POD-200"}},
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        variant_code = response.data["variant"]["code"]
        self.assertFalse(InventoryMaterial.objects.filter(code=variant_code, category="POD").exists())
        self.assertFalse(PodSkuVariant.objects.filter(code=variant_code).exists())
        self.assertIsNone(response.data["variant"]["inventory_link"])

    def test_product_master_write_normalizes_adhesive_and_solvent_defaults(self):
        pet = InventoryMaterial.objects.create(
            code="PET-CHEM-API-T",
            name="PET chemistry API test",
            category="FILM_VARIANT",
            base_uom="KG",
            density_gcm3="1.3800",
            is_purchasable=True,
            is_extrudable=False,
            status="ACTIVE",
        )
        ldpe = InventoryMaterial.objects.create(
            code="LD-CHEM-API-T",
            name="LD chemistry API test",
            category="FILM_VARIANT",
            base_uom="KG",
            density_gcm3="0.9200",
            is_purchasable=True,
            is_extrudable=False,
            status="ACTIVE",
        )
        adhesive = InventoryMaterial.objects.create(
            code="ADH-CHEM-API-T",
            name="API selected adhesive",
            category="ADHESIVE",
            base_uom="KG",
            status="ACTIVE",
        )
        solvent = InventoryMaterial.objects.create(
            code="SOL-CHEM-API-T",
            name="API selected solvent",
            category="SOLVENT",
            base_uom="KG",
            status="ACTIVE",
        )

        response = self.client.post(
            "/api/master/products/",
            {
                "code": "PM-CHEM-API-T",
                "name": "Chem API pouch",
                "product_kind": "POUCH",
                "default_reporting_group": "FG",
                "layer_template": [
                    {"role": "print-web", "material_code": pet.code, "thickness_micron": 12, "default_grade": ""},
                    {"role": "sealant", "material_code": ldpe.code, "thickness_micron": 60, "default_grade": ""},
                ],
                "fixed_attributes": {
                    "fg_type": "POUCH",
                    "layer_count": 2,
                    "print_capable": False,
                    "adhesive_material_id": str(adhesive.id),
                    "adhesive_gsm": 2.4,
                    "solvent_material_id": str(solvent.id),
                    "solvent_gsm": 0.9,
                },
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        fixed = response.data["fixed_attributes"]
        self.assertEqual(fixed["adhesive_material_id"], str(adhesive.id))
        self.assertEqual(fixed["adhesive_material_code"], adhesive.code)
        self.assertEqual(fixed["adhesive_material_name"], adhesive.name)
        self.assertEqual(fixed["adhesive_gsm"], 2.4)
        self.assertEqual(fixed["solvent_material_id"], str(solvent.id))
        self.assertEqual(fixed["solvent_material_code"], solvent.code)
        self.assertEqual(fixed["solvent_material_name"], solvent.name)
        self.assertEqual(fixed["solvent_gsm"], 0.9)

    def test_product_master_consumers_endpoint_returns_downstream_masters(self):
        upstream = ProductMaster.objects.create(
            code="PM-UPSTREAM-WIP",
            name="Upstream WIP roll",
            product_kind="ROLL",
            default_reporting_group="LAMINATED",
        )
        downstream = ProductMaster.objects.create(
            code="PM-DOWNSTREAM-POUCH",
            name="Downstream pouch",
            product_kind="POUCH",
            default_reporting_group="FG",
            variant_axes=[
                {
                    "axis": "wip_source",
                    "type": "product_master_ref",
                    "required": True,
                    "options": [str(upstream.id)],
                }
            ],
            fixed_attributes={"default_wip_master": upstream.code},
        )
        ProductMaster.objects.create(
            code="PM-UNRELATED-POUCH",
            name="Unrelated pouch",
            product_kind="POUCH",
            default_reporting_group="FG",
        )

        response = self.client.get(f"/api/master/products/{upstream.id}/consumers/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual([row["id"] for row in response.data], [str(downstream.id)])

    def test_catalog_bom_preview_resolves_v33_pod_inner_and_counted_outer_axes(self):
        inner_pack = InventoryMaterial.objects.create(
            code="INNER-POUCH-V33-API",
            name="Inner pouch 24",
            category="PACKAGING",
            base_uom="PCS",
            packaging_kind="INNER_POUCH",
            packaging_supply_mode="IN_HOUSE",
            packaging_defaults_json={"pcs_per_pack": 24},
            status="ACTIVE",
        )
        outer_pack = InventoryMaterial.objects.create(
            code="OUTER-GONNY-V33-API",
            name="Outer gonny",
            category="PACKAGING",
            base_uom="PCS",
            packaging_kind="GONNY",
            packaging_supply_mode="PURCHASED",
            packaging_defaults_json={"inners_per_gunny": 12},
            status="ACTIVE",
        )
        pod_material = InventoryMaterial.objects.create(
            code="POD-MAT-V33-API",
            name="POD material",
            category="POD",
            base_uom="KG",
            pod_is_inhouse_produced=True,
            status="ACTIVE",
        )
        pod_sku = PodSku.objects.create(code="POD-SKU-V33-API", name="POD SKU")
        pod_variant = PodSkuVariant.objects.create(
            pod_sku=pod_sku,
            material=pod_material,
            code="POD-V33-API",
            name="POD 220mm 30u",
        )
        product = ProductMaster.objects.create(
            code="PM-V33-CATALOG-API",
            name="Catalog axis test pouch",
            product_kind="POUCH",
            default_reporting_group="FG",
            variant_axes=[
                {
                    "axis": "packaging_inner",
                    "type": "catalog_ref",
                    "required": True,
                    "master_data_source": "packaging_material",
                    "master_data_filter": {"packaging_kind": "INNER_POUCH"},
                    "qty_formula": "ceil(total_pouches / pcs_per_inner)",
                    "auto_demand_in_house": True,
                },
                {
                    "axis": "packaging_outer",
                    "type": "catalog_ref",
                    "required": False,
                    "master_data_source": "packaging_material",
                    "master_data_filter": {"packaging_kind": "GONNY"},
                    "qty_per_pcs": 0,
                    "auto_demand_in_house": False,
                },
                {
                    "axis": "pod_variant",
                    "type": "catalog_ref",
                    "required": False,
                    "master_data_source": "pod_sku_variant",
                    "qty_per_pcs": 1,
                    "auto_demand_in_house": True,
                },
            ],
        )

        response = self.client.post(
            f"/api/master/products/{product.id}/catalog-bom-preview/",
            {
                "axis_values": {
                    "packaging_inner": inner_pack.code,
                    "packaging_outer": outer_pack.code,
                    "pod_variant": pod_variant.code,
                },
                "total_pouches": 1000,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        lines = {row["axis"]: row for row in response.data["lines"]}
        self.assertEqual(lines["packaging_inner"]["required_qty"], 42)
        self.assertTrue(lines["packaging_inner"]["would_create_demand"])
        self.assertEqual(lines["packaging_outer"]["required_qty"], 0)
        self.assertEqual(lines["packaging_outer"]["basis"], "COUNTED_AT_PACKING")
        self.assertFalse(lines["packaging_outer"]["would_create_demand"])
        self.assertEqual(lines["pod_variant"]["required_qty"], 1000)
        self.assertTrue(lines["pod_variant"]["would_create_demand"])

    def test_catalog_axis_qty_formula_rejects_unsafe_expressions(self):
        response = self.client.post(
            "/api/master/products/",
            {
                "code": "PM-BAD-FORMULA",
                "name": "Bad formula",
                "product_kind": "POUCH",
                "default_reporting_group": "FG",
                "variant_axes": [
                    {
                        "axis": "packaging_inner",
                        "type": "catalog_ref",
                        "master_data_source": "packaging_material",
                        "qty_formula": "__import__('os').system('echo no')",
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("qty_formula", str(response.data))

    def test_pouch_size_without_explicit_roll_width_computes_web_width(self):
        family = InventoryMaterial.objects.create(
            code="LD-FAM-WIDTH",
            name="LD width family",
            category="FILM_FAMILY",
            base_uom="KG",
        )
        InventoryMaterial.objects.create(
            code="LD-WIDTH-T",
            name="LD width test",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            is_extrudable=True,
        )
        product = ProductMaster.objects.create(
            code="PM-WIDTH-POUCH",
            name="Width Pouch",
            product_kind="POUCH",
            default_reporting_group="FG",
            layer_template=[
                {"role": "sealant", "material_code": "LD-WIDTH-T", "thickness_micron": 50, "default_grade": "GP"},
            ],
            variant_axes=[{"axis": "size", "type": "geometry", "required": True, "options": ["SNK-100"]}],
            fixed_attributes={"fg_type": "POUCH", "layer_count": 1},
            invariant_signature="INV-WIDTH-POUCH",
        )
        ProductMasterSize.objects.create(
            product_master=product,
            code="SNK-100",
            label="100g",
            width_mm=100,
            height_mm=150,
            gusset_mm=30,
            active=True,
        )

        response = self.client.post(
            f"/api/master/products/{product.id}/variants/find-or-create/",
            {"axis_values": {"size": "SNK-100"}},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        variant = response.data["variant"]
        self.assertEqual(variant["geometry_snapshot"]["roll_width_mm"], 210.0)
        self.assertEqual(variant["geometry_snapshot"]["effective_height_mm"], 180.0)
        self.assertEqual(variant["layer_snapshot"][0]["roll_width_mm"], 210.0)

    def test_product_master_blank_reporting_group_defaults_to_fg(self):
        response = self.client.post(
            "/api/master/products/",
            {
                "code": "dry fruit",
                "name": "LDNAT PET LD Milky",
                "product_kind": "POUCH",
                "default_reporting_group": "",
                "reusable_policy": "CONFIGURABLE",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["code"], "DRY-FRUIT")
        self.assertEqual(response.data["default_reporting_group"], "FG")

    def test_customer_overlay_links_customer_product_and_optional_artwork(self):
        product = ProductMaster.objects.create(
            code="BOPP-PRINTED",
            name="BOPP Printed Pouch",
            product_kind="POUCH",
            default_reporting_group="FG",
        )
        customer = Customer.objects.create(code="CUST-1", name="Acme Retail")
        artwork = Artwork.objects.create(
            design_code="ART-BOPP-1",
            name="BOPP Default",
            status="APPROVED",
            front_colors_count=1,
            front_colors=["CYAN"],
        )

        response = self.client.post(
            "/api/master/customer-product-overlays/",
            {
                "product_master": str(product.id),
                "customer": str(customer.id),
                "customer_item_code": "ACME-BOPP-250",
                "size_variant_code": "BOPP-250",
                "customer_display_name": "Acme BOPP 250g",
                "default_packing_note": "100 pcs inner, 1000 pcs carton",
                "default_packing_recipe": {"carton_qty": 1000},
                "default_price_basis": "PCS",
                "moq_kg": "100.000",
                "default_artwork": str(artwork.id),
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["product_master_name"], "BOPP Printed Pouch")
        self.assertEqual(response.data["customer_name"], "Acme Retail")
        self.assertEqual(response.data["size_variant_code"], "BOPP-250")
        self.assertEqual(response.data["default_packing_recipe"]["carton_qty"], 1000)
        self.assertEqual(response.data["default_artwork_design_code"], "ART-BOPP-1")
        self.assertTrue(
            CustomerProductOverlay.objects.filter(
                product_master=product,
                customer=customer,
                customer_item_code="ACME-BOPP-250",
            ).exists()
        )

    def test_product_master_sizes_are_nested_under_master(self):
        product = ProductMaster.objects.create(
            code="DRYFRUIT",
            name="Dry Fruit Pouch",
            product_kind="POUCH",
            default_reporting_group="FG",
        )

        response = self.client.post(
            f"/api/master/products/{product.id}/sizes/",
            {
                "code": "250 g",
                "label": "250g",
                "width_mm": "140.00",
                "height_mm": "210.00",
                "gusset_mm": "35.00",
                "standard_qty": "1000.00",
                "qty_uom": "KG",
                "geometry_config": {"multipliers": {"faces": 2}},
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["code"], "250-G")
        self.assertNotIn("default_packing", response.data)
        self.assertEqual(response.data["geometry_config"]["multipliers"]["faces"], 2)
        self.assertEqual(ProductMasterSize.objects.filter(product_master=product, code="250-G").count(), 1)

        list_response = self.client.get(f"/api/master/products/{product.id}/sizes/")
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(len(list_response.data), 1)

    def test_product_master_api_treats_layer_thickness_as_microns_not_percent_sum(self):
        family = InventoryMaterial.objects.create(
            code="PETLD-FAM",
            name="PET LD family",
            category="FILM_FAMILY",
            base_uom="KG",
        )
        InventoryMaterial.objects.create(
            code="PET-12",
            name="PET 12",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            is_extrudable=True,
        )
        InventoryMaterial.objects.create(
            code="LDPE-65",
            name="LDPE 65",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            is_extrudable=True,
        )

        response = self.client.post(
            "/api/master/products/",
            {
                "code": "PET-LD-MICRON",
                "name": "PET LD Micron Contract",
                "product_kind": "POUCH",
                "default_reporting_group": "FG",
                "reusable_policy": "CONFIGURABLE",
                "layer_template": [
                    {
                        "role": "print-web",
                        "material_code": "PET-12",
                        "thickness_micron": 12,
                        "thickness_share": 12,
                        "default_grade": "FOOD-A",
                    },
                    {
                        "role": "sealant",
                        "material_code": "LDPE-65",
                        "thickness_micron": 65,
                        "thickness_share": 65,
                        "default_grade": "GP",
                    },
                ],
                "variant_axes": [
                    {"axis": "size", "type": "geometry", "required": True, "options": ["120x180"]},
                    {"axis": "addons", "type": "multi_enum", "required": False, "options": ["ZIPPER-T"]},
                ],
                "fixed_attributes": {"fg_type": "POUCH", "layer_count": 2, "print_capable": True},
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["layer_template"][0]["thickness_micron"], 12)
        self.assertEqual(response.data["layer_template"][1]["thickness_micron"], 65)

    def test_product_master_api_rejects_global_thickness_and_grade_axes(self):
        family = InventoryMaterial.objects.create(
            code="REJECT-FAM",
            name="Reject family",
            category="FILM_FAMILY",
            base_uom="KG",
        )
        InventoryMaterial.objects.create(
            code="REJECT-LD",
            name="Reject LD",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            is_extrudable=True,
        )

        response = self.client.post(
            "/api/master/products/",
            {
                "code": "BAD-GLOBAL-AXIS",
                "name": "Bad global axis",
                "product_kind": "ROLL",
                "default_reporting_group": "FG",
                "layer_template": [
                    {
                        "role": "base-film",
                        "material_code": "REJECT-LD",
                        "thickness_micron": 46,
                        "default_grade": "GP",
                    }
                ],
                "variant_axes": [
                    {"axis": "size", "type": "geometry", "required": True, "options": ["ROLL-1050"]},
                    {"axis": "thickness_um", "type": "integer_um", "required": True, "options": [46]},
                    {"axis": "grade", "type": "enum", "required": False, "options": ["GP"]},
                ],
                "fixed_attributes": {"fg_type": "ROLL", "layer_count": 1},
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("variant_axes", str(response.data))

    def test_product_master_api_requires_layer_grade_except_purchasable_roll_inputs(self):
        family = InventoryMaterial.objects.create(
            code="GRADE-FAM",
            name="Grade family",
            category="FILM_FAMILY",
            base_uom="KG",
        )
        InventoryMaterial.objects.create(
            code="EXTRUDABLE-LD",
            name="Extrudable LD",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            is_extrudable=True,
            is_purchasable=True,
        )
        InventoryMaterial.objects.create(
            code="BOUGHT-PET",
            name="Bought PET",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            is_extrudable=False,
            is_purchasable=True,
        )

        missing_grade = self.client.post(
            "/api/master/products/",
            {
                "code": "MISSING-GRADE",
                "name": "Missing grade",
                "product_kind": "ROLL",
                "layer_template": [{"role": "base-film", "material_code": "EXTRUDABLE-LD", "thickness_micron": 46}],
                "variant_axes": [{"axis": "size", "type": "geometry", "required": True, "options": ["ROLL-1050"]}],
            },
            format="json",
        )
        purchasable = self.client.post(
            "/api/master/products/",
            {
                "code": "BOUGHT-ROLL",
                "name": "Bought roll",
                "product_kind": "ROLL",
                "layer_template": [{"role": "base-film", "material_code": "BOUGHT-PET", "thickness_micron": 12}],
                "variant_axes": [{"axis": "size", "type": "geometry", "required": True, "options": ["ROLL-1050"]}],
            },
            format="json",
        )

        self.assertEqual(missing_grade.status_code, 400)
        self.assertIn("grade", str(missing_grade.data).lower())
        self.assertEqual(purchasable.status_code, 201, purchasable.data)
        self.assertEqual(purchasable.data["layer_template"][0]["default_grade"], "")
        self.assertEqual(purchasable.data["layer_template"][0]["grade_options"], [])

    def test_product_master_api_rejects_grade_outside_grade_master(self):
        family = InventoryMaterial.objects.create(
            code="GRADE-MASTER-FAM",
            name="Grade master family",
            category="FILM_FAMILY",
            base_uom="KG",
        )
        InventoryMaterial.objects.create(
            code="GRADE-MASTER-LD",
            name="Grade master LD",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            is_extrudable=True,
            is_purchasable=True,
        )

        response = self.client.post(
            "/api/master/products/",
            {
                "code": "BAD-GRADE-MASTER",
                "name": "Bad grade master",
                "product_kind": "POUCH",
                "layer_template": [
                    {"role": "sealant", "film_variant_code": "GRADE-MASTER-LD", "thickness_micron": 50, "default_grade": "NOT-A-GRADE"}
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("grade master", str(response.data).lower())

    def test_find_or_create_variant_treats_layer_thickness_options_as_presets(self):
        family = InventoryMaterial.objects.create(
            code="THICK-OPT-FAM",
            name="Thickness option family",
            category="FILM_FAMILY",
            base_uom="KG",
        )
        InventoryMaterial.objects.create(
            code="THICK-OPT-LD",
            name="Thickness option LD",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            is_extrudable=True,
            is_purchasable=True,
        )
        product = ProductMaster.objects.create(
            code="PM-THICK-OPTIONS",
            name="Thickness Options",
            product_kind="POUCH",
            default_reporting_group="FG",
            layer_template=[
                {
                    "role": "sealant",
                    "film_variant_code": "THICK-OPT-LD",
                    "thickness_micron": 50,
                    "thickness_options": [40, 50, 60],
                    "default_grade": "GP",
                    "grade_options": ["GP"],
                }
            ],
            variant_axes=[
                {"axis": "size", "type": "geometry", "required": True, "options": ["POUCH-100"]},
                {"axis": "layer_thicknesses", "type": "per_layer_number", "required": True},
            ],
            fixed_attributes={"fg_type": "POUCH", "layer_count": 1},
        )
        ProductMasterSize.objects.create(
            product_master=product,
            code="POUCH-100",
            label="100g",
            width_mm=100,
            height_mm=150,
            roll_width_mm=220,
            active=True,
        )

        custom_variant, custom_created = find_or_create_product_variant(
            product,
            {"size": "POUCH-100", "layer_thicknesses": {"1": 55}, "layer_grades": {"1": "GP"}},
        )
        self.assertTrue(custom_created)
        self.assertEqual(custom_variant.layer_snapshot[0]["thickness_micron"], 55.0)

        variant, created = find_or_create_product_variant(product, {"size": "POUCH-100", "layer_thicknesses": {"1": 60}, "layer_grades": {"1": "GP"}})
        self.assertTrue(created)
        self.assertEqual(variant.layer_snapshot[0]["thickness_micron"], 60.0)

    def test_product_master_api_requires_real_film_variant_on_each_layer(self):
        response = self.client.post(
            "/api/master/products/",
            {
                "code": "BAD-LAYER-FILM",
                "name": "Bad layer film",
                "product_kind": "ROLL",
                "layer_template": [{"role": "base-film", "material_code": "NOT-A-FILM", "thickness_micron": 46, "default_grade": "GP"}],
                "variant_axes": [{"axis": "size", "type": "geometry", "required": True, "options": ["ROLL-1050"]}],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("valid film variant", str(response.data).lower())

    def test_find_or_create_variant_is_axis_deduped_and_returns_snapshot(self):
        family = InventoryMaterial.objects.create(
            code="BOPP-FAM-T",
            name="BOPP family test",
            category="FILM_FAMILY",
            base_uom="KG",
        )
        InventoryMaterial.objects.create(
            code="BOPP",
            name="BOPP",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            is_extrudable=True,
        )
        product = ProductMaster.objects.create(
            code="BOPP-1L",
            name="BOPP Single Layer",
            product_kind="POUCH",
            default_reporting_group="FG",
            layer_template=[{"role": "sealant", "material_code": "BOPP", "thickness_micron": 25, "default_grade": "FOOD"}],
            variant_axes=[
                {"axis": "size", "type": "geometry", "required": True, "options": ["100x150"]},
            ],
            fixed_attributes={"fg_type": "POUCH", "layer_count": 1, "print_capable": True},
            invariant_signature="INV-BOPP-1L",
        )

        first = self.client.post(
            f"/api/master/products/{product.id}/variants/find-or-create/",
            {"axis_values": {"size": "100x150"}},
            format="json",
        )
        second = self.client.post(
            f"/api/master/products/{product.id}/variants/find-or-create/",
            {"axis_values": {"size": "100x150"}},
            format="json",
        )

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.data["variant"]["id"], second.data["variant"]["id"])
        self.assertEqual(ProductVariant.objects.filter(master=product).count(), 1)
        self.assertEqual(first.data["variant"]["geometry_snapshot"]["base"]["width_mm"], 100.0)
        self.assertEqual(first.data["variant"]["layer_snapshot"][0]["grade_code"], "FOOD")

    def test_find_or_create_variant_uses_per_layer_thickness_grade_and_addon_axis(self):
        food_grade, _ = RecipeGrade.objects.get_or_create(name="FOOD-A", defaults={"is_active": True})
        gp_grade, _ = RecipeGrade.objects.get_or_create(name="GP", defaults={"is_active": True})
        family = InventoryMaterial.objects.create(
            code="FILM-FAM-T",
            name="Film family test",
            category="FILM_FAMILY",
            base_uom="KG",
            density_gcm3="0.9200",
        )
        InventoryMaterial.objects.create(
            code="PET-12-T",
            name="PET 12 test",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
        )
        InventoryMaterial.objects.create(
            code="LDPE-65-T",
            name="LDPE 65 test",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
        )
        InventoryMaterial.objects.create(
            code="ZIPPER-T",
            name="Press-to-close zipper",
            category="ADDON",
            base_uom="PCS",
            weight_mode="PER_MM",
            weight_value="0.0120",
        )
        product = ProductMaster.objects.create(
            code="PET-LD-LAYERED",
            name="PET LD Layered Pouch",
            product_kind="POUCH",
            default_reporting_group="FG",
            layer_template=[
                {
                    "role": "print-web",
                    "film_variant_code": "PET-12-T",
                    "thickness_micron": 12,
                    "default_grade": "FOOD-A",
                    "grade_options": ["FOOD-A", "GP"],
                },
                {
                    "role": "sealant",
                    "film_variant_code": "LDPE-65-T",
                    "thickness_micron": 65,
                    "default_grade": "GP",
                    "grade_options": ["FOOD-A", "GP"],
                },
            ],
            variant_axes=[
                {"axis": "size", "type": "geometry", "required": True, "options": ["120x180"]},
                {"axis": "addons", "type": "multi_enum", "required": False, "options": ["ZIPPER-T"]},
            ],
            fixed_attributes={"fg_type": "POUCH", "layer_count": 2, "print_capable": True},
            invariant_signature="INV-PET-LD-LAYERED",
        )

        with_addon = self.client.post(
            f"/api/master/products/{product.id}/variants/find-or-create/",
            {"axis_values": {"size": "120x180", "addons": ["ZIPPER-T"]}},
            format="json",
        )
        without_addon = self.client.post(
            f"/api/master/products/{product.id}/variants/find-or-create/",
            {"axis_values": {"size": "120x180", "addons": []}},
            format="json",
        )

        self.assertEqual(with_addon.status_code, 201, with_addon.data)
        self.assertEqual(without_addon.status_code, 201, without_addon.data)
        self.assertNotEqual(with_addon.data["variant"]["id"], without_addon.data["variant"]["id"])
        self.assertEqual(ProductVariant.objects.filter(master=product).count(), 2)
        layer_snapshot = with_addon.data["variant"]["layer_snapshot"]
        self.assertEqual(layer_snapshot[0]["thickness_micron"], 12.0)
        self.assertEqual(layer_snapshot[1]["thickness_micron"], 65.0)
        self.assertEqual(layer_snapshot[0]["grade_code"], "FOOD-A")
        self.assertEqual(layer_snapshot[1]["grade_code"], "GP")
        self.assertEqual(layer_snapshot[0]["grade_id"], str(food_grade.id))
        self.assertEqual(layer_snapshot[1]["grade_id"], str(gp_grade.id))
        self.assertAlmostEqual(layer_snapshot[0]["kg_per_kg_fg"], 12 / 77, places=4)
        self.assertAlmostEqual(layer_snapshot[1]["kg_per_kg_fg"], 65 / 77, places=4)
        self.assertEqual(with_addon.data["variant"]["geometry_snapshot"]["thickness_um"], 77.0)

    def test_find_or_create_variant_rejects_material_override_when_axis_not_enabled(self):
        family = InventoryMaterial.objects.create(
            code="FIXED-FAM-T",
            name="Fixed family test",
            category="FILM_FAMILY",
            base_uom="KG",
            density_gcm3="0.9200",
        )
        InventoryMaterial.objects.create(
            code="FIXED-LD-T",
            name="Fixed LD",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            is_extrudable=True,
        )
        InventoryMaterial.objects.create(
            code="ALT-LD-T",
            name="Alternate LD",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            is_extrudable=True,
        )
        product = ProductMaster.objects.create(
            code="FIXED-LAYER-MASTER",
            name="Fixed layer master",
            product_kind="ROLL",
            default_reporting_group="FILM",
            layer_template=[
                {"role": "base-film", "material_code": "FIXED-LD-T", "thickness_micron": 55, "default_grade": "GP"}
            ],
            variant_axes=[
                {"axis": "size", "type": "geometry", "required": True, "options": ["ROLL-1050"]},
            ],
            fixed_attributes={"fg_type": "ROLL", "layer_count": 1, "roll_form": "FLAT"},
            invariant_signature="INV-FIXED-LAYER-MASTER",
        )
        ProductMasterSize.objects.create(
            product_master=product,
            code="ROLL-1050",
            label="1050mm roll",
            width_mm=1050,
            roll_width_mm=1050,
            qty_uom="KG",
        )

        response = self.client.post(
            f"/api/master/products/{product.id}/variants/find-or-create/",
            {
                "axis_values": {
                    "size": "ROLL-1050",
                    "layer_material_overrides": {"1": "ALT-LD-T"},
                }
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(ProductVariant.objects.filter(master=product).count(), 0)
        self.assertIn("layer_material_overrides", str(response.data))

    def test_find_or_create_variant_allows_controlled_per_layer_material_override(self):
        family = InventoryMaterial.objects.create(
            code="ALT-FAM-T",
            name="Alternate family test",
            category="FILM_FAMILY",
            base_uom="KG",
            density_gcm3="0.9200",
        )
        InventoryMaterial.objects.create(
            code="LD-NAT-T",
            name="LD natural",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            is_extrudable=True,
        )
        InventoryMaterial.objects.create(
            code="LD-MILKY-T",
            name="LD milky",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            is_extrudable=True,
        )
        product = ProductMaster.objects.create(
            code="CONTROLLED-ALT-MASTER",
            name="Controlled alternate master",
            product_kind="ROLL",
            default_reporting_group="FILM",
            layer_template=[
                {
                    "role": "sealant",
                    "material_code": "LD-NAT-T",
                    "allowed_film_variant_codes": ["LD-MILKY-T"],
                    "thickness_micron": 60,
                    "default_grade": "GP",
                    "grade_options": ["GP", "FOOD-A"],
                }
            ],
            variant_axes=[
                {"axis": "size", "type": "geometry", "required": True, "options": ["ROLL-1050"]},
                {
                    "axis": "layer_material_overrides",
                    "type": "per_layer_material_enum",
                    "required": False,
                    "options": {"1": ["LD-MILKY-T"]},
                },
                {"axis": "layer_thicknesses", "type": "per_layer_number", "required": False, "options": [60, 65]},
                {"axis": "layer_grades", "type": "per_layer_enum", "required": False, "options": ["GP", "FOOD-A"]},
            ],
            fixed_attributes={"fg_type": "ROLL", "layer_count": 1, "roll_form": "FLAT"},
            invariant_signature="INV-CONTROLLED-ALT-MASTER",
        )
        ProductMasterSize.objects.create(
            product_master=product,
            code="ROLL-1050",
            label="1050mm roll",
            width_mm=1050,
            roll_width_mm=1050,
            qty_uom="KG",
        )

        response = self.client.post(
            f"/api/master/products/{product.id}/variants/find-or-create/",
            {
                "axis_values": {
                    "size": "ROLL-1050",
                    "layer_material_overrides": {"1": "LD-MILKY-T"},
                    "layer_thicknesses": {"1": 65},
                    "layer_grades": {"1": "FOOD-A"},
                }
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        layer = response.data["variant"]["layer_snapshot"][0]
        self.assertEqual(layer["material_code"], "LD-MILKY-T")
        self.assertEqual(layer["base_material_code"], "LD-NAT-T")
        self.assertTrue(layer["material_override_applied"])
        self.assertEqual(layer["thickness_micron"], 65.0)
        self.assertEqual(layer["grade_code"], "FOOD-A")

    def test_find_or_create_variant_requires_resolved_layer_width(self):
        family = InventoryMaterial.objects.create(
            code="WIDTH-FAM",
            name="Width family",
            category="FILM_FAMILY",
            base_uom="KG",
        )
        InventoryMaterial.objects.create(
            code="WIDTH-LD",
            name="Width LD",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            is_extrudable=True,
        )
        product = ProductMaster.objects.create(
            code="WIDTH-ROLL",
            name="Width roll",
            product_kind="ROLL",
            default_reporting_group="FG",
            layer_template=[{"role": "base-film", "material_code": "WIDTH-LD", "thickness_micron": 46, "default_grade": "GP"}],
            variant_axes=[{"axis": "size", "type": "geometry", "required": True, "options": ["MISSING-WIDTH"]}],
            fixed_attributes={"fg_type": "ROLL", "layer_count": 1, "roll_form": "FLAT"},
            invariant_signature="INV-WIDTH-ROLL",
        )

        response = self.client.post(
            f"/api/master/products/{product.id}/variants/find-or-create/",
            {"axis_values": {"size": "MISSING-WIDTH"}},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("roll width", str(response.data).lower())

    def test_find_or_create_variant_allows_required_width_axis_to_auto_resolve_from_size(self):
        family = InventoryMaterial.objects.create(
            code="WIDTH-AUTO-FAM",
            name="Width auto family",
            category="FILM_FAMILY",
            base_uom="KG",
        )
        InventoryMaterial.objects.create(
            code="WIDTH-AUTO-LD",
            name="Width auto LD",
            category="FILM_VARIANT",
            base_uom="KG",
            parent_family=family,
            is_extrudable=True,
        )
        product = ProductMaster.objects.create(
            code="WIDTH-AUTO-POUCH",
            name="Width auto pouch",
            product_kind="POUCH",
            default_reporting_group="FG",
            layer_template=[{"role": "base-film", "material_code": "WIDTH-AUTO-LD", "thickness_micron": 46, "default_grade": "GP"}],
            variant_axes=[
                {"axis": "size", "type": "geometry", "required": True, "options": ["140X200"]},
                {"axis": "layer_widths", "type": "per_layer_number", "required": True},
            ],
            fixed_attributes={"fg_type": "POUCH", "layer_count": 1, "roll_form": "CENTER_FOLD"},
            invariant_signature="INV-WIDTH-AUTO-POUCH",
        )
        ProductMasterSize.objects.create(
            product_master=product,
            code="140X200",
            label="140 x 200",
            width_mm=140,
            height_mm=200,
            roll_width_mm=330,
            qty_uom="KG",
        )

        response = self.client.post(
            f"/api/master/products/{product.id}/variants/find-or-create/",
            {"axis_values": {"size": "140X200"}},
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["variant"]["layer_snapshot"][0]["roll_width_mm"], 330.0)
