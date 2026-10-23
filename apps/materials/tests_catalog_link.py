"""One-step catalog links: every POD roll has a distinct SKU row, and a POD roll or an
in-house packaging row links to the master that makes it from either side."""
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from apps.materials.models import InventoryMaterial, PodSkuVariant, ProductMaster, ProductMasterSize, ProductVariant
from apps.materials.services_catalog_link import ensure_pod_sku_variant
from apps.users.models import Role, User


class CatalogLinkTests(TestCase):
    def setUp(self):
        role = Role.objects.create(code="CAT-ADMIN", name="Catalog admin", default_permissions=["master.view", "master.manage"])
        self.user = User.objects.create_user(username="cat-admin", password="pass12345", role=role, is_superuser=True)
        self.api = APIClient(SERVER_NAME="127.0.0.1")
        self.api.force_authenticate(self.user)
        self.single = InventoryMaterial.objects.create(code="POD-SINGLE-T", name="POD single 200", category="POD", base_uom="KG", status="ACTIVE", pod_type="SINGLE")
        self.double = InventoryMaterial.objects.create(code="POD-DOUBLE-T", name="POD double 240", category="POD", base_uom="KG", status="ACTIVE", pod_type="DOUBLE")
        self.pod_master = ProductMaster.objects.create(code="PM-POD-T", name="POD film", product_kind="POD", default_reporting_group="POD")
        ProductMasterSize.objects.create(product_master=self.pod_master, code="POD-200", label="200 mm")
        self.inner = InventoryMaterial.objects.create(code="LD-GREY-T", name="LD grey bags", category="PACKAGING", base_uom="PCS", status="ACTIVE", packaging_kind="INNER_POUCH", packaging_supply_mode="IN_HOUSE")
        self.pack_master = ProductMaster.objects.create(code="PM-INNER-T", name="Grey bags", product_kind="PACKAGING", packaging_kind="INNER_POUCH", default_reporting_group="PACKAGING")
        ProductMasterSize.objects.create(product_master=self.pack_master, code="13X16", label="13 x 16")

    def test_every_pod_roll_gets_a_distinct_sku_row(self):
        a = ensure_pod_sku_variant(self.single)
        b = ensure_pod_sku_variant(self.double)
        self.assertEqual((a.code, b.code), ("POD-SINGLE-T", "POD-DOUBLE-T"))
        self.assertEqual(ensure_pod_sku_variant(self.single).id, a.id, "created once")
        self.assertIsNone(ensure_pod_sku_variant(self.inner))

    def test_pod_master_page_creates_the_sku_row_with_the_roll(self):
        made = self.api.post("/api/master/pod/", {"code": "POD-NEW-T", "name": "POD new"}, format="json")
        self.assertIn(made.status_code, (200, 201), made.data)
        self.assertTrue(PodSkuVariant.objects.filter(material_id=made.data["id"], code="POD-NEW-T").exists())

    def test_options_list_the_masters_that_can_make_a_row(self):
        pod = self.api.get("/api/master/products/catalog-link-options/", {"material": str(self.single.id)}).data
        self.assertEqual([m["code"] for m in pod["masters"]], ["PM-POD-T"])
        self.assertEqual(pod["masters"][0]["sizes"][0]["code"], "POD-200")
        pack = self.api.get("/api/master/products/catalog-link-options/", {"material": str(self.inner.id)}).data
        self.assertEqual([m["code"] for m in pack["masters"]], ["PM-INNER-T"])
        bought = InventoryMaterial.objects.create(code="GONNY-T", name="Gonny", category="PACKAGING", packaging_kind="GONNY", packaging_supply_mode="PURCHASED")
        self.assertEqual(self.api.get("/api/master/products/catalog-link-options/", {"material": str(bought.id)}).status_code, 400)

    def _fake_variant(self, master, code):
        def make(master_arg, material, size_code=""):
            return ProductVariant.objects.create(master=master_arg, code=code, axis_values={"size": size_code}), True
        return patch("apps.materials.services_catalog_link.find_or_create_link_variant", side_effect=make)

    def test_link_a_pod_roll_in_one_step(self):
        with self._fake_variant(self.pod_master, "PM-POD-T-V-200"):
            linked = self.api.post(f"/api/master/products/{self.pod_master.id}/link-catalog/", {"inventory_material_id": str(self.single.id), "size": "POD-200"}, format="json")
        self.assertEqual(linked.status_code, 201, linked.data)
        self.single.refresh_from_db()
        self.assertEqual(self.single.produced_by_product_variant.code, "PM-POD-T-V-200")
        self.assertTrue(self.single.pod_is_inhouse_produced)
        self.assertTrue(PodSkuVariant.objects.filter(material=self.single).exists())
        opts = self.api.get("/api/master/products/catalog-link-options/", {"material": str(self.single.id)}).data
        self.assertEqual(opts["linked"]["master_code"], "PM-POD-T")

    def test_link_refuses_the_wrong_kind_and_a_row_made_by_another_master(self):
        wrong = self.api.post(f"/api/master/products/{self.pack_master.id}/link-catalog/", {"inventory_material_id": str(self.single.id)}, format="json")
        self.assertEqual(wrong.status_code, 400)
        other = ProductMaster.objects.create(code="PM-INNER-OTHER", name="Other bags", product_kind="PACKAGING", packaging_kind="INNER_POUCH")
        self.inner.produced_by_product_variant = ProductVariant.objects.create(master=other, code="OTHER-V")
        self.inner.save(update_fields=["produced_by_product_variant"])
        with self._fake_variant(self.pack_master, "PM-INNER-T-V"):
            taken = self.api.post(f"/api/master/products/{self.pack_master.id}/link-catalog/", {"inventory_material_id": str(self.inner.id)}, format="json")
        self.assertEqual(taken.status_code, 400)
        self.assertIn("already linked", str(taken.data))
        self.assertFalse(ProductVariant.objects.filter(code="PM-INNER-T-V").exists(), "nothing half-made")
