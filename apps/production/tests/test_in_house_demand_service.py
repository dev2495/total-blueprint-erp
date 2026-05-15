"""
Unit tests for InHouseDemandService — verifies that confirming a sales order
with in-house packaging or POD lines surfaces idempotent planner stock orders.
"""
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, TestCase

from apps.factory.models import Plant
from apps.inventory.models import InventoryBulk, InventoryLocation, PackagingStock
from apps.materials.models import InventoryMaterial, PodSku, PodSkuVariant
from apps.production.services.in_house_demand_service import InHouseDemandService


def _make_item(*, packaging_snapshot=None, bom_snapshot=None, qty_value=Decimal("100"), qty_uom="PCS", unit_weight_g=Decimal("5"), id_="item-1"):
    sales_order = SimpleNamespace(id="so-1", order_number="SO-1", plant_id=None)
    return SimpleNamespace(
        id=id_,
        sales_order=sales_order,
        sales_order_id="so-1",
        packaging_snapshot=packaging_snapshot or {},
        bom_snapshot=bom_snapshot or {},
        qty_value=qty_value,
        qty_uom=qty_uom,
        unit_weight_g=unit_weight_g,
    )


def _make_order(items):
    return SimpleNamespace(id="so-1", order_number="SO-1", items=items)


class _FakeQuerySet:
    def __init__(self, items):
        self._items = items

    def select_related(self, *_):
        return self._items

    def __iter__(self):
        return iter(self._items)


def _items_manager(items):
    """Return an object whose .items.all() and direct list-iteration both work."""
    qs = _FakeQuerySet(items)
    return SimpleNamespace(all=lambda: qs)


class InHouseDemandServiceTests(SimpleTestCase):
    @patch("apps.production.services.in_house_demand_service._audit", lambda *a, **kw: None)
    @patch("apps.production.services.in_house_demand_service.SalesOrderItemInHouseDemand")
    @patch("apps.production.services.in_house_demand_service.PlannedStockOrder")
    @patch("apps.production.services.in_house_demand_service.InventoryMaterial")
    def test_creates_packaging_demand_for_in_house_material(
        self, mock_material_cls, mock_pso_cls, mock_demand_cls
    ):
        material = MagicMock()
        material.id = "mat-1"
        material.code = "PKG-IN-HOUSE"
        material.packaging_supply_mode = "IN_HOUSE"
        material.production_template_id = "tpl-1"
        material.production_template = MagicMock()
        material.base_uom = "PCS"

        mock_material_cls.objects.select_related.return_value.get.return_value = material
        mock_pso_cls.objects.create.return_value = MagicMock(id="pso-1")
        mock_demand_cls.objects.filter.return_value.first.return_value = None
        mock_demand_cls.objects.create.return_value = MagicMock(
            id="dem-1",
            demand_kind="PACKAGING",
            packaging_material_id="mat-1",
            planned_stock_order_id="pso-1",
            planned_bulk_stock_order_id=None,
        )

        item = _make_item(packaging_snapshot={
            "roll_dispatch_pack": {
                "enabled": True,
                "lines": [{"material_id": "mat-1", "qty": 200, "uom": "PCS", "basis": "PER_ORDER"}],
            },
        })
        order = SimpleNamespace(id="so-1", order_number="SO-1", items=_items_manager([item]))

        result = InHouseDemandService.create_for_order(order)

        self.assertEqual(len(result["created"]), 1)
        self.assertEqual(result["created"][0]["kind"], "PACKAGING")
        mock_pso_cls.objects.create.assert_called_once()
        kwargs = mock_pso_cls.objects.create.call_args.kwargs
        self.assertEqual(kwargs["stock_purpose"], "PACKAGING")
        self.assertEqual(kwargs["stock_strategy"], "PACKAGING_STOCK")
        self.assertEqual(kwargs["packaging_material"], material)
        self.assertEqual(kwargs["target_qty"], Decimal("200"))

    @patch("apps.production.services.in_house_demand_service._audit", lambda *a, **kw: None)
    @patch("apps.production.services.in_house_demand_service.SalesOrderItemInHouseDemand")
    @patch("apps.production.services.in_house_demand_service.PlannedStockOrder")
    @patch("apps.production.services.in_house_demand_service.InventoryMaterial")
    def test_skips_purchased_packaging_material(
        self, mock_material_cls, mock_pso_cls, mock_demand_cls
    ):
        material = MagicMock()
        material.packaging_supply_mode = "PURCHASED"
        material.production_template_id = None

        mock_material_cls.objects.select_related.return_value.get.return_value = material

        item = _make_item(packaging_snapshot={
            "roll_dispatch_pack": {
                "enabled": True,
                "lines": [{"material_id": "mat-1", "qty": 200, "uom": "PCS"}],
            },
        })
        order = SimpleNamespace(id="so-1", order_number="SO-1", items=_items_manager([item]))

        result = InHouseDemandService.create_for_order(order)

        self.assertEqual(result["created"], [])
        mock_pso_cls.objects.create.assert_not_called()

    @patch("apps.production.services.in_house_demand_service._audit", lambda *a, **kw: None)
    @patch("apps.production.services.in_house_demand_service.SalesOrderItemInHouseDemand")
    @patch("apps.production.services.in_house_demand_service.PlannedStockOrder")
    @patch("apps.production.services.in_house_demand_service.InventoryMaterial")
    def test_creates_primary_inner_pack_demand_for_in_house_material(
        self, mock_material_cls, mock_pso_cls, mock_demand_cls
    ):
        material = MagicMock()
        material.id = "mat-primary"
        material.code = "INNER-PACK-IN-HOUSE"
        material.packaging_supply_mode = "IN_HOUSE"
        material.production_template_id = "tpl-pack"
        material.production_template = MagicMock()
        material.base_uom = "PCS"

        mock_material_cls.objects.select_related.return_value.get.return_value = material
        mock_pso_cls.objects.create.return_value = MagicMock(id="pso-primary")
        mock_demand_cls.objects.filter.return_value.first.return_value = None
        mock_demand_cls.objects.create.return_value = MagicMock(
            id="dem-primary",
            demand_kind="PACKAGING",
            packaging_material_id="mat-primary",
            planned_stock_order_id="pso-primary",
            planned_bulk_stock_order_id=None,
        )

        item = _make_item(
            qty_value=Decimal("240"),
            qty_uom="PCS",
            packaging_snapshot={
                "primary_inner_pack": {
                    "enabled": True,
                    "material_id": "mat-primary",
                    "pcs_per_pack": 24,
                },
            },
        )
        order = SimpleNamespace(id="so-1", order_number="SO-1", items=_items_manager([item]))

        result = InHouseDemandService.create_for_order(order)

        self.assertEqual(len(result["created"]), 1)
        kwargs = mock_pso_cls.objects.create.call_args.kwargs
        self.assertEqual(kwargs["target_qty"], Decimal("10"))
        self.assertEqual(kwargs["quantity_uom"], "PCS")
        self.assertEqual(kwargs["stock_strategy"], "PACKAGING_STOCK")

    @patch("apps.production.services.in_house_demand_service._audit", lambda *a, **kw: None)
    @patch("apps.production.services.in_house_demand_service.SalesOrderItemInHouseDemand")
    @patch("apps.production.services.in_house_demand_service.PlannedStockOrder")
    @patch("apps.production.services.in_house_demand_service.InventoryMaterial")
    def test_primary_inner_pack_estimates_from_kg_when_unit_weight_exists(
        self, mock_material_cls, mock_pso_cls, mock_demand_cls
    ):
        material = MagicMock()
        material.id = "mat-primary-kg"
        material.code = "INNER-PACK-KG"
        material.packaging_supply_mode = "BOTH"
        material.production_template_id = "tpl-pack"
        material.production_template = MagicMock()
        material.base_uom = "PCS"

        mock_material_cls.objects.select_related.return_value.get.return_value = material
        mock_pso_cls.objects.create.return_value = MagicMock(id="pso-primary-kg")
        mock_demand_cls.objects.filter.return_value.first.return_value = None
        mock_demand_cls.objects.create.return_value = MagicMock(
            id="dem-primary-kg",
            demand_kind="PACKAGING",
            packaging_material_id="mat-primary-kg",
            planned_stock_order_id="pso-primary-kg",
            planned_bulk_stock_order_id=None,
        )

        item = _make_item(
            qty_value=Decimal("12"),
            qty_uom="KG",
            unit_weight_g=Decimal("6"),
            packaging_snapshot={
                "primary_inner_pack": {
                    "enabled": True,
                    "material_id": "mat-primary-kg",
                    "pcs_per_pack": 100,
                },
            },
        )
        order = SimpleNamespace(id="so-1", order_number="SO-1", items=_items_manager([item]))

        InHouseDemandService.create_for_order(order)

        kwargs = mock_pso_cls.objects.create.call_args.kwargs
        self.assertEqual(kwargs["target_qty"], Decimal("20"))
        self.assertEqual(kwargs["quantity_uom"], "PCS")

    @patch("apps.production.services.in_house_demand_service._audit", lambda *a, **kw: None)
    @patch("apps.production.services.in_house_demand_service.SalesOrderItemInHouseDemand")
    @patch("apps.production.services.in_house_demand_service.PlannedStockOrder")
    @patch("apps.production.services.in_house_demand_service.InventoryMaterial")
    def test_packaging_lines_create_multiple_in_house_demands_from_sku_rows(
        self, mock_material_cls, mock_pso_cls, mock_demand_cls
    ):
        inner = MagicMock()
        inner.id = "mat-inner"
        inner.code = "INNER-IN-HOUSE"
        inner.packaging_supply_mode = "IN_HOUSE"
        inner.production_template_id = "tpl-inner"
        inner.production_template = MagicMock()
        inner.base_uom = "PCS"
        inner.packaging_defaults_json = {"pcs_per_pack": 24}

        wrap = MagicMock()
        wrap.id = "mat-wrap"
        wrap.code = "WRAP-IN-HOUSE"
        wrap.packaging_supply_mode = "BOTH"
        wrap.production_template_id = "tpl-wrap"
        wrap.production_template = MagicMock()
        wrap.base_uom = "KG"
        wrap.packaging_defaults_json = {}

        material_by_id = {"mat-inner": inner, "mat-wrap": wrap}
        mock_material_cls.objects.select_related.return_value.get.side_effect = lambda id: material_by_id[id]
        mock_pso_cls.objects.create.side_effect = [MagicMock(id="pso-inner"), MagicMock(id="pso-wrap")]
        mock_demand_cls.objects.filter.return_value.first.return_value = None
        mock_demand_cls.objects.create.side_effect = [
            MagicMock(id="dem-inner", demand_kind="PACKAGING", packaging_material_id="mat-inner", planned_stock_order_id="pso-inner", planned_bulk_stock_order_id=None),
            MagicMock(id="dem-wrap", demand_kind="PACKAGING", packaging_material_id="mat-wrap", planned_stock_order_id="pso-wrap", planned_bulk_stock_order_id=None),
        ]

        item = _make_item(
            qty_value=Decimal("240"),
            qty_uom="PCS",
            packaging_snapshot={
                "packaging_lines": [
                    {"material_id": "mat-inner", "role": "PRIMARY_INNER", "basis": "PCS_PER_PACK", "pcs_per_pack": 24, "uom": "PCS"},
                    {"material_id": "mat-wrap", "role": "FINAL_OUTER", "basis": "PER_ORDER", "qty": 1.5, "uom": "KG"},
                ]
            },
        )
        order = SimpleNamespace(id="so-1", order_number="SO-1", items=_items_manager([item]))

        result = InHouseDemandService.create_for_order(order)

        self.assertEqual(len(result["created"]), 2)
        calls = mock_pso_cls.objects.create.call_args_list
        self.assertEqual(calls[0].kwargs["target_qty"], Decimal("10"))
        self.assertEqual(calls[0].kwargs["quantity_uom"], "PCS")
        self.assertEqual(calls[1].kwargs["target_qty"], Decimal("1.5"))
        self.assertEqual(calls[1].kwargs["quantity_uom"], "KG")

    @patch("apps.production.services.in_house_demand_service._audit", lambda *a, **kw: None)
    @patch("apps.production.services.in_house_demand_service.SalesOrderItemInHouseDemand")
    @patch("apps.production.services.in_house_demand_service.PlannedStockOrder")
    @patch("apps.production.services.in_house_demand_service.InventoryMaterial")
    def test_skips_when_production_template_missing(
        self, mock_material_cls, mock_pso_cls, mock_demand_cls
    ):
        material = MagicMock()
        material.id = "mat-2"
        material.code = "PKG-NO-TPL"
        material.packaging_supply_mode = "IN_HOUSE"
        material.production_template_id = None  # ← missing template

        mock_material_cls.objects.select_related.return_value.get.return_value = material

        item = _make_item(packaging_snapshot={
            "roll_dispatch_pack": {
                "enabled": True,
                "lines": [{"material_id": "mat-2", "qty": 50, "uom": "PCS"}],
            },
        })
        order = SimpleNamespace(id="so-1", order_number="SO-1", items=_items_manager([item]))

        result = InHouseDemandService.create_for_order(order)

        self.assertEqual(result["created"], [])
        self.assertEqual(len(result["skipped"]), 1)
        self.assertEqual(result["skipped"][0]["reason"], "no_production_template")
        mock_pso_cls.objects.create.assert_not_called()

    @patch("apps.production.services.in_house_demand_service._audit", lambda *a, **kw: None)
    @patch("apps.production.services.in_house_demand_service.SalesOrderItemInHouseDemand")
    @patch("apps.production.services.in_house_demand_service.PlannedStockOrder")
    @patch("apps.production.services.in_house_demand_service.InventoryMaterial")
    def test_idempotent_when_demand_already_exists(
        self, mock_material_cls, mock_pso_cls, mock_demand_cls
    ):
        material = MagicMock()
        material.id = "mat-3"
        material.code = "PKG-IDEMPOTENT"
        material.packaging_supply_mode = "IN_HOUSE"
        material.production_template_id = "tpl-1"
        material.base_uom = "PCS"

        mock_material_cls.objects.select_related.return_value.get.return_value = material
        existing_demand = MagicMock(id="dem-existing")
        mock_demand_cls.objects.filter.return_value.first.return_value = existing_demand

        item = _make_item(packaging_snapshot={
            "roll_dispatch_pack": {
                "enabled": True,
                "lines": [{"material_id": "mat-3", "qty": 75, "uom": "PCS"}],
            },
        })
        order = SimpleNamespace(id="so-1", order_number="SO-1", items=_items_manager([item]))

        result = InHouseDemandService.create_for_order(order)

        # No new demand created on re-confirm.
        self.assertEqual(result["created"], [])
        mock_pso_cls.objects.create.assert_not_called()
        mock_demand_cls.objects.create.assert_not_called()

    @patch("apps.production.services.in_house_demand_service._audit", lambda *a, **kw: None)
    @patch("apps.production.services.in_house_demand_service.SalesOrderItemInHouseDemand")
    @patch("apps.production.services.in_house_demand_service.PlannedStockOrder")
    @patch("apps.production.services.in_house_demand_service.InventoryMaterial")
    def test_both_mode_creates_demand(
        self, mock_material_cls, mock_pso_cls, mock_demand_cls
    ):
        material = MagicMock()
        material.id = "mat-4"
        material.code = "PKG-BOTH"
        material.packaging_supply_mode = "BOTH"
        material.production_template_id = "tpl-1"
        material.base_uom = "KG"

        mock_material_cls.objects.select_related.return_value.get.return_value = material
        mock_pso_cls.objects.create.return_value = MagicMock(id="pso-2")
        mock_demand_cls.objects.filter.return_value.first.return_value = None
        mock_demand_cls.objects.create.return_value = MagicMock(
            id="dem-2",
            demand_kind="PACKAGING",
            packaging_material_id="mat-4",
            planned_stock_order_id="pso-2",
            planned_bulk_stock_order_id=None,
        )

        item = _make_item(packaging_snapshot={
            "roll_dispatch_pack": {
                "enabled": True,
                "lines": [{"material_id": "mat-4", "qty": 12, "uom": "KG"}],
            },
        })
        order = SimpleNamespace(id="so-1", order_number="SO-1", items=_items_manager([item]))

        result = InHouseDemandService.create_for_order(order)

        self.assertEqual(len(result["created"]), 1)
        kwargs = mock_pso_cls.objects.create.call_args.kwargs
        self.assertEqual(kwargs["quantity_uom"], "KG")

    @patch("apps.production.services.in_house_demand_service._audit", lambda *a, **kw: None)
    @patch("apps.materials.models.PodSkuVariant")
    @patch("apps.production.services.in_house_demand_service.SalesOrderItemInHouseDemand")
    @patch("apps.production.services.in_house_demand_service.PlannedBulkStockOrder")
    def test_pod_bulk_demand_uses_bom_formula_without_template(
        self, mock_bulk_cls, mock_demand_cls, mock_pod_variant_cls
    ):
        material = MagicMock()
        material.id = "pod-mat-1"
        material.code = "POD-INHOUSE"
        material.name = "In-house POD roll"
        material.pod_is_inhouse_produced = True
        material.production_template_id = None
        material.pod_panel_count = 2

        pod_sku = MagicMock()
        pod_sku.code = "POD-SKU"
        variant = MagicMock()
        variant.id = "pod-var-1"
        variant.code = "POD-SKU"
        variant.material = material
        variant.pod_sku = pod_sku

        mock_pod_variant_cls.objects.select_related.return_value.get.return_value = variant
        mock_bulk_cls.objects.create.return_value = MagicMock(id="bulk-1")
        mock_demand_cls.objects.filter.return_value.first.return_value = None
        mock_demand_cls.objects.create.return_value = MagicMock(
            id="dem-pod",
            demand_kind="POD",
            packaging_material_id="pod-mat-1",
            planned_stock_order_id=None,
            planned_bulk_stock_order_id="bulk-1",
        )

        item = _make_item(
            qty_value=Decimal("1000"),
            qty_uom="PCS",
            unit_weight_g=Decimal("5"),
            packaging_snapshot={"pod": {"enabled": True, "pod_sku_variant_id": "pod-var-1"}},
            bom_snapshot={
                "planning_lines": [
                    {
                        "category_code": "POD",
                        "material_id": "pod-mat-1",
                        "material_code": "POD-INHOUSE",
                        "theoretical_qty": 1.25,
                        "planned_issue_qty": 1.25,
                    }
                ]
            },
        )
        order = SimpleNamespace(id="so-1", order_number="SO-1", items=_items_manager([item]))

        result = InHouseDemandService.create_for_order(order)

        self.assertEqual(len(result["created"]), 1)
        kwargs = mock_bulk_cls.objects.create.call_args.kwargs
        self.assertEqual(kwargs["material"], material)
        self.assertEqual(kwargs["target_qty_kg"], Decimal("1.2500"))
        self.assertIn("pod_profile_snapshot", kwargs)


class InHouseDemandAvailabilityTests(TestCase):
    def setUp(self):
        self.plant = Plant.objects.create(code="P1", name="Plant 1")
        self.location = InventoryLocation.objects.create(
            plant=self.plant,
            code="RM",
            name="RM Store",
            type="RM",
        )
        self.sales_order = SimpleNamespace(
            id="so-stock",
            order_number="SO-STOCK",
            plant_id=self.plant.id,
        )

    def _stock_item(self, *, packaging_snapshot=None, bom_snapshot=None, qty_value=Decimal("100"), item_id="item-stock"):
        return SimpleNamespace(
            id=item_id,
            sales_order=self.sales_order,
            sales_order_id="so-stock",
            packaging_snapshot=packaging_snapshot or {},
            bom_snapshot=bom_snapshot or {},
            qty_value=qty_value,
            qty_uom="PCS",
            unit_weight_g=Decimal("5"),
        )

    @patch("apps.production.services.in_house_demand_service._audit", lambda *a, **kw: None)
    def test_packaging_demand_is_only_created_for_shortage_after_stock(self):
        material = InventoryMaterial.objects.create(
            code="INNER-STOCKED",
            name="Inner pouch stocked",
            category="PACKAGING",
            base_uom="PCS",
            packaging_kind="INNER_POUCH",
            packaging_supply_mode="IN_HOUSE",
        )
        PackagingStock.objects.create(
            material=material,
            plant=self.plant,
            location=self.location,
            qty=Decimal("6"),
        )
        item = self._stock_item(
            packaging_snapshot={
                "packaging_lines": [
                    {"material_id": str(material.id), "basis": "PER_ORDER", "qty": 10, "uom": "PCS"},
                ],
            }
        )
        order = SimpleNamespace(id="so-stock", order_number="SO-STOCK", items=_items_manager([item]))
        link = SimpleNamespace(
            id="demand-shortage",
            demand_kind="PACKAGING",
            packaging_material_id=material.id,
            planned_stock_order_id="planned-shortage",
            planned_bulk_stock_order_id=None,
        )

        with patch.object(InHouseDemandService, "_resolve_packaging_production_contract", return_value=({"template": object()}, None)) as contract, \
                patch.object(InHouseDemandService, "_upsert_packaging_demand", return_value=(link, True)) as upsert:
            result = InHouseDemandService.create_for_order(order)

        self.assertEqual(len(result["created"]), 1)
        self.assertEqual(contract.call_args.kwargs["target_qty"], Decimal("4.0000"))
        self.assertEqual(upsert.call_args.kwargs["target_qty"], Decimal("4.0000"))

    @patch("apps.production.services.in_house_demand_service._audit", lambda *a, **kw: None)
    def test_packaging_demand_is_skipped_when_stock_covers_requirement(self):
        material = InventoryMaterial.objects.create(
            code="INNER-COVERED",
            name="Inner pouch covered",
            category="PACKAGING",
            base_uom="PCS",
            packaging_kind="INNER_POUCH",
            packaging_supply_mode="IN_HOUSE",
        )
        PackagingStock.objects.create(
            material=material,
            plant=self.plant,
            location=self.location,
            qty=Decimal("12"),
        )
        item = self._stock_item(
            packaging_snapshot={
                "packaging_lines": [
                    {"material_id": str(material.id), "basis": "PER_ORDER", "qty": 10, "uom": "PCS"},
                ],
            }
        )
        order = SimpleNamespace(id="so-stock", order_number="SO-STOCK", items=_items_manager([item]))

        with patch.object(InHouseDemandService, "_upsert_packaging_demand") as upsert:
            result = InHouseDemandService.create_for_order(order)

        self.assertEqual(result["created"], [])
        self.assertEqual(result["skipped"][0]["reason"], "stock_available")
        upsert.assert_not_called()

    @patch("apps.production.services.in_house_demand_service._audit", lambda *a, **kw: None)
    @patch("apps.production.services.in_house_demand_service.SalesOrderItemInHouseDemand")
    @patch("apps.production.services.in_house_demand_service.PlannedBulkStockOrder")
    def test_pod_bulk_demand_is_only_created_for_shortage_after_stock(
        self, mock_bulk_cls, mock_demand_cls
    ):
        material = InventoryMaterial.objects.create(
            code="POD-220-STOCKED",
            name="POD 220mm stocked",
            category="POD",
            base_uom="KG",
            pod_type="SINGLE",
            pod_fixed_height_mm=220,
            pod_thickness_micron=35,
            pod_panel_count=1,
            density_gcm3=Decimal("0.9200"),
            pod_is_inhouse_produced=True,
        )
        pod_sku = PodSku.objects.create(code="POD-220", name="POD 220mm")
        variant = PodSkuVariant.objects.create(
            pod_sku=pod_sku,
            material=material,
            code="POD-220",
            name="POD 220mm",
        )
        InventoryBulk.objects.create(
            material=material,
            plant=self.plant,
            location=self.location,
            qty_kg=Decimal("0.2500"),
        )
        item = self._stock_item(
            packaging_snapshot={"pod": {"enabled": True, "pod_sku_variant_id": str(variant.id)}},
            bom_snapshot={
                "planning_lines": [
                    {
                        "category_code": "POD",
                        "material_id": str(material.id),
                        "material_code": material.code,
                        "planned_issue_qty": 1.25,
                    }
                ]
            },
        )
        order = SimpleNamespace(id="so-stock", order_number="SO-STOCK", items=_items_manager([item]))
        mock_bulk_cls.objects.create.return_value = SimpleNamespace(id="bulk-shortage")
        mock_demand_cls.objects.filter.return_value.first.return_value = None
        mock_demand_cls.objects.create.return_value = SimpleNamespace(
            id="demand-pod",
            demand_kind="POD",
            packaging_material_id=material.id,
            planned_stock_order_id=None,
            planned_bulk_stock_order_id="bulk-shortage",
        )

        result = InHouseDemandService.create_for_order(order)

        self.assertEqual(len(result["created"]), 1)
        self.assertEqual(mock_bulk_cls.objects.create.call_args.kwargs["target_qty_kg"], Decimal("1.0000"))

    @patch("apps.production.services.in_house_demand_service._audit", lambda *a, **kw: None)
    @patch("apps.production.services.in_house_demand_service.SalesOrderItemInHouseDemand")
    @patch("apps.production.services.in_house_demand_service.PlannedBulkStockOrder")
    def test_pod_bulk_demand_is_skipped_when_bulk_stock_covers_requirement(
        self, mock_bulk_cls, mock_demand_cls
    ):
        material = InventoryMaterial.objects.create(
            code="POD-250-COVERED",
            name="POD 250mm covered",
            category="POD",
            base_uom="KG",
            pod_type="SINGLE",
            pod_fixed_height_mm=250,
            pod_thickness_micron=35,
            pod_panel_count=1,
            density_gcm3=Decimal("0.9200"),
            pod_is_inhouse_produced=True,
        )
        pod_sku = PodSku.objects.create(code="POD-250", name="POD 250mm")
        variant = PodSkuVariant.objects.create(
            pod_sku=pod_sku,
            material=material,
            code="POD-250",
            name="POD 250mm",
        )
        InventoryBulk.objects.create(
            material=material,
            plant=self.plant,
            location=self.location,
            qty_kg=Decimal("1.5000"),
        )
        item = self._stock_item(
            packaging_snapshot={"pod": {"enabled": True, "pod_sku_variant_id": str(variant.id)}},
            bom_snapshot={
                "planning_lines": [
                    {
                        "category_code": "POD",
                        "material_id": str(material.id),
                        "material_code": material.code,
                        "planned_issue_qty": 1.25,
                    }
                ]
            },
        )
        order = SimpleNamespace(id="so-stock", order_number="SO-STOCK", items=_items_manager([item]))
        mock_demand_cls.objects.filter.return_value.first.return_value = None

        result = InHouseDemandService.create_for_order(order)

        self.assertEqual(result["created"], [])
        self.assertEqual(result["skipped"][0]["reason"], "stock_available")
        mock_bulk_cls.objects.create.assert_not_called()
