from decimal import Decimal
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.utils import timezone
from django.test import SimpleTestCase, TestCase
from rest_framework.request import Request
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.materials.models import InventoryMaterial
from apps.mrp.models import MRPPlan, MRPRequirement, MRPSuggestion
from apps.mrp.services import MRPService
from apps.mrp.views import MRPRequirementViewSet, MRPSuggestionViewSet, MRPViewSet


class MRPPodSuggestionTests(SimpleTestCase):
    @patch("apps.mrp.services.MRPService._get_available_stock", return_value=Decimal("0"))
    @patch("apps.mrp.services.MRPService._required_date_for_suggestion", return_value="2026-03-16")
    @patch("apps.mrp.services.MRPSuggestion.objects.create")
    def test_inhouse_pod_creates_mts_produce_suggestion(self, mock_create, _mock_required_date, _mock_available):
        plan = SimpleNamespace(purchase_value_est=Decimal("0"))
        material = SimpleNamespace(category="POD", pod_is_inhouse_produced=True, name="POD Inhouse")

        MRPService._generate_suggestions(plan, material, Decimal("125"), "plant-1")

        mock_create.assert_called_once()
        self.assertEqual(mock_create.call_args.kwargs["type"], "MTS_PRODUCE")
        self.assertEqual(plan.purchase_value_est, Decimal("0"))

    @patch("apps.mrp.services.MRPService._get_available_stock", return_value=Decimal("0"))
    @patch("apps.mrp.services.CostingService.get_material_rate", return_value=Decimal("12.5"))
    @patch("apps.mrp.services.MRPService._required_date_for_suggestion", return_value="2026-03-16")
    @patch("apps.mrp.services.MRPSuggestion.objects.create")
    def test_external_pod_stays_purchase_suggestion(self, mock_create, _mock_required_date, _mock_rate, _mock_available):
        plan = SimpleNamespace(purchase_value_est=Decimal("0"))
        material = SimpleNamespace(category="POD", pod_is_inhouse_produced=False, name="POD Buy")

        MRPService._generate_suggestions(plan, material, Decimal("20"), "plant-1")

        mock_create.assert_called_once()
        self.assertEqual(mock_create.call_args.kwargs["type"], "PURCHASE")
        self.assertEqual(plan.purchase_value_est, Decimal("250.0"))


class MRPBomDemandExplosionTests(SimpleTestCase):
    @patch("apps.mrp.services.MRPService._add_to_demand")
    def test_count_only_packaging_and_addons_do_not_become_kg_demand(self, mock_add_to_demand):
        bom = {
            "packaging": [
                {"material_id": "bag-count-only", "qty": 25000},
                {"material_id": "carton-weighted", "qty": 50, "weight_kg": "12.5"},
            ],
            "addons": [
                {"material_id": "sticker-count-only", "qty": 1000},
                {"material_id": "zipper-weighted", "qty": 1000, "weight_kg": "4.25"},
            ],
        }

        MRPService._aggregate_bom_into_map(bom, {}, Decimal("2"))

        calls = [(args[0], args[1]) for args, _kwargs in mock_add_to_demand.call_args_list]
        self.assertEqual(calls, [
            ("carton-weighted", Decimal("25.0")),
            ("zipper-weighted", Decimal("8.50")),
        ])

    @patch("apps.mrp.services.MRPService._add_to_demand")
    def test_materialized_packaging_stock_qty_is_not_scaled_again(self, mock_add_to_demand):
        bom = {
            "packaging": [
                {
                    "material_id": "pp-bag",
                    "qty": 250,
                    "count_qty": 250,
                    "stock_qty": "2.125",
                    "stock_uom": "KG",
                    "weight_kg": "2.125",
                    "qty_source": "ORDER_QUANTITY",
                },
            ],
        }

        MRPService._aggregate_bom_into_map(bom, {}, Decimal("25000"))

        mock_add_to_demand.assert_called_once_with("pp-bag", Decimal("2.125"), {})

    @patch("apps.mrp.services.MRPService._add_to_demand")
    def test_legacy_packaging_row_with_count_markers_is_not_scaled_again(self, mock_add_to_demand):
        bom = {
            "packaging": [
                {
                    "material_id": "pp-bag",
                    "qty": 250,
                    "uom": "PCS",
                    "weight_kg": "2.125",
                },
            ],
        }

        MRPService._aggregate_bom_into_map(bom, {}, Decimal("25000"))

        mock_add_to_demand.assert_called_once_with("pp-bag", Decimal("2.125"), {})

    @patch("apps.mrp.services.MRPService._add_to_demand")
    def test_partial_line_factor_prorates_materialized_packaging(self, mock_add_to_demand):
        bom = {
            "packaging": [
                {
                    "material_id": "pp-bag",
                    "stock_qty": "10",
                    "stock_uom": "KG",
                    "weight_kg": "10",
                },
            ],
        }

        MRPService._aggregate_bom_into_map(
            bom,
            {},
            Decimal("25000"),
            materialized_factor=Decimal("0.25"),
        )

        mock_add_to_demand.assert_called_once_with("pp-bag", Decimal("2.50"), {})

    @patch("apps.mrp.services.MRPService._add_to_demand")
    def test_materialized_packaging_count_uses_unit_base_qty(self, mock_add_to_demand):
        bom = {
            "packaging": [
                {
                    "material_id": "pp-bag",
                    "count_qty": 250,
                    "unit_base_qty": "0.0085",
                    "stock_uom": "KG",
                },
            ],
        }

        MRPService._aggregate_bom_into_map(bom, {}, Decimal("25000"))

        mock_add_to_demand.assert_called_once_with("pp-bag", Decimal("2.1250"), {})

    @patch("apps.mrp.services.MRPService._add_to_demand")
    def test_materialized_addon_stock_qty_is_planned_in_stock_uom(self, mock_add_to_demand):
        bom = {
            "addons": [
                {
                    "addon_id": "bopp-tape",
                    "stock_qty": "0.305",
                    "stock_uom": "METER",
                    "weight_kg": "0.00305",
                },
            ],
        }

        MRPService._aggregate_bom_into_map(bom, {}, Decimal("25000"))

        mock_add_to_demand.assert_called_once_with("bopp-tape", Decimal("7625.000"), {})


class MRPViewSetFilterTests(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.material = InventoryMaterial.objects.create(
            code="MRP-FILTER-MAT",
            name="MRP Filter Material",
            category="PACKAGING",
            base_uom="KG",
        )
        self.other_material = InventoryMaterial.objects.create(
            code="MRP-FILTER-OTHER",
            name="MRP Filter Other",
            category="PACKAGING",
            base_uom="KG",
        )
        self.plan = MRPPlan.objects.create(status="COMPLETED")
        self.other_plan = MRPPlan.objects.create(status="COMPLETED")

    def _drf_request(self, params):
        return Request(self.factory.get("/api/mrp/", params))

    def test_requirements_get_queryset_filters_by_plan(self):
        included = MRPRequirement.objects.create(
            plan=self.plan,
            material=self.material,
            required_qty_kg=Decimal("10"),
            available_qty_kg=Decimal("0"),
            shortage_qty_kg=Decimal("10"),
            source_type="SO",
            source_ref="SO-1",
        )
        MRPRequirement.objects.create(
            plan=self.other_plan,
            material=self.material,
            required_qty_kg=Decimal("999999"),
            available_qty_kg=Decimal("0"),
            shortage_qty_kg=Decimal("999999"),
            source_type="SO",
            source_ref="OLD",
        )

        viewset = MRPRequirementViewSet()
        viewset.request = self._drf_request({"plan": str(self.plan.id)})

        self.assertEqual(list(viewset.get_queryset()), [included])

    def test_latest_endpoint_returns_newest_completed_plan(self):
        MRPPlan.objects.filter(pk=self.plan.pk).update(
            created_at=timezone.now() - timedelta(days=2),
        )
        MRPPlan.objects.filter(pk=self.other_plan.pk).update(
            created_at=timezone.now() - timedelta(hours=1),
        )
        user = get_user_model().objects.create_user(
            username="mrp-latest-test",
            extra_permissions=["mrp.view"],
            password="testpass",
        )

        view = MRPViewSet.as_view({"get": "latest"})
        request = self.factory.get("/api/mrp/plans/latest/")
        force_authenticate(request, user=user)
        response = view(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["id"], str(self.other_plan.id))

    def test_suggestions_get_queryset_filters_by_plan_and_material(self):
        included = MRPSuggestion.objects.create(
            plan=self.plan,
            type="PURCHASE",
            material=self.material,
            qty=Decimal("10"),
        )
        MRPSuggestion.objects.create(
            plan=self.other_plan,
            type="PURCHASE",
            material=self.material,
            qty=Decimal("999999"),
        )
        MRPSuggestion.objects.create(
            plan=self.plan,
            type="PURCHASE",
            material=self.other_material,
            qty=Decimal("25"),
        )

        viewset = MRPSuggestionViewSet()
        viewset.request = self._drf_request(
            {"plan": str(self.plan.id), "material": str(self.material.id)}
        )

        self.assertEqual(list(viewset.get_queryset()), [included])


class MRPReliabilityTests(TestCase):
    def test_nightly_task_reaches_real_engine(self):
        from apps.mrp.tasks import run_nightly_mrp
        before = MRPPlan.objects.count()
        result = run_nightly_mrp()
        self.assertEqual(result['status'], 'COMPLETED')
        self.assertEqual(MRPPlan.objects.count(), before + 1)

    def test_wip_requires_material_plant_and_uom_and_subtracts_produced(self):
        from apps.factory.models import Plant
        from apps.templates.models import TemplateBlueprint
        from apps.production.models import PlannedStockOrder
        a = Plant.objects.create(code='MRP-A', name='A')
        b = Plant.objects.create(code='MRP-B', name='B')
        material = InventoryMaterial.objects.create(code='PACK-WIP', name='Sheet', category='PACKAGING', base_uom='KG', per_sheet_base_qty=Decimal('0.2'))
        template = TemplateBlueprint.objects.create(name='Sheet', fg_type='POUCH')
        PlannedStockOrder.objects.create(template=template, plant=a, packaging_material=material,
            stock_purpose='PACKAGING', status='RELEASED', target_qty=100, produced_qty=25, quantity_uom='PCS')
        PlannedStockOrder.objects.create(template=template, plant=b, packaging_material=material,
            stock_purpose='PACKAGING', status='RELEASED', target_qty=500, quantity_uom='KG')
        PlannedStockOrder.objects.create(template=template, plant=a, status='RELEASED', target_qty=999, quantity_uom='KG')
        self.assertEqual(MRPService._get_wip_stock(material, a.pk), Decimal('15'))

    def test_job_and_transfer_actions_do_not_claim_nonexistent_drafts(self):
        material = InventoryMaterial.objects.create(code='MRP-NO-STUB', name='Sheet', category='PACKAGING', base_uom='KG')
        plan = MRPPlan.objects.create()
        for kind, suggestion_type in [('job', 'MTS_PRODUCE'), ('transfer', 'TRANSFER')]:
            suggestion = MRPSuggestion.objects.create(plan=plan, material=material, type=suggestion_type, qty=10)
            with self.assertRaisesMessage(ValueError, 'No draft has been created'):
                MRPService.create_suggestion_draft(suggestion, kind)
            suggestion.refresh_from_db()
            self.assertFalse(suggestion.draft_ref)
            self.assertEqual(suggestion.action_status, 'PENDING')


class MRPPackagingStockNettingTests(TestCase):
    def setUp(self):
        from apps.factory.models import Plant
        from apps.inventory.models import InventoryLocation
        from apps.sales.models import SalesOrder
        from apps.templates.models import TemplateBlueprint

        self.plant = Plant.objects.create(code='MRP-PACK-A', name='Packaging A')
        self.other_plant = Plant.objects.create(code='MRP-PACK-B', name='Packaging B')
        self.location = InventoryLocation.objects.create(plant=self.plant, code='PACK-A', name='Packaging A')
        self.other_location = InventoryLocation.objects.create(plant=self.other_plant, code='PACK-B', name='Packaging B')
        self.template = TemplateBlueprint.objects.create(name='MRP Packaging Demand', fg_type='POUCH')
        self.order = SalesOrder.objects.create(customer_name='Packaging demand', status='PLANNED')

    def _material(self, uom):
        return InventoryMaterial.objects.create(
            code=f'MRP-PACK-{uom}', name=f'Packaging {uom}', category='PACKAGING', base_uom=uom,
        )

    def _demand(self, material, qty):
        from apps.sales.models import SalesOrderItem

        SalesOrderItem.objects.create(
            sales_order=self.order, template=self.template, line_status='PLANNED', qty_uom='PCS', qty_value=1000,
            bom_snapshot={'packaging': [{'material_id': str(material.pk), 'stock_qty': str(qty), 'stock_uom': material.base_uom}]},
        )

    def test_piece_packaging_stock_offsets_real_order_demand(self):
        from apps.inventory.models import PackagingStock

        material = self._material('PCS')
        PackagingStock.objects.create(material=material, plant=self.plant, location=self.location, qty=500)
        self._demand(material, 600)

        plan = MRPService.run_mrp(str(self.plant.pk))

        requirement = plan.requirements.get(material=material)
        self.assertEqual(requirement.required_qty_kg, Decimal('600'))
        self.assertEqual(requirement.available_qty_kg, Decimal('500'))
        self.assertEqual(requirement.shortage_qty_kg, Decimal('100'))
        self.assertEqual(plan.suggestions.get(type='PURCHASE').qty, Decimal('100'))

    def test_sufficient_meter_packaging_stock_avoids_purchase(self):
        from apps.inventory.models import PackagingStock

        material = self._material('METER')
        PackagingStock.objects.create(material=material, plant=self.plant, location=self.location, qty=500)
        self._demand(material, 400)

        plan = MRPService.run_mrp(str(self.plant.pk))

        self.assertEqual(plan.requirements.get(material=material).shortage_qty_kg, Decimal('0'))
        self.assertFalse(plan.suggestions.exists())

    def test_other_plant_packaging_stock_produces_transfer_before_purchase(self):
        from apps.inventory.models import PackagingStock

        material = self._material('PCS')
        PackagingStock.objects.create(material=material, plant=self.plant, location=self.location, qty=200)
        PackagingStock.objects.create(material=material, plant=self.other_plant, location=self.other_location, qty=500)
        self._demand(material, 600)

        plan = MRPService.run_mrp(str(self.plant.pk))

        suggestion = plan.suggestions.get()
        self.assertEqual(suggestion.type, 'TRANSFER')
        self.assertEqual(suggestion.qty, Decimal('400'))
        self.assertEqual(suggestion.target_plant_id, self.plant.pk)

    def test_available_stock_combines_only_matching_units(self):
        from apps.inventory.models import InventoryBulk, InventoryRoll, PackagingStock

        for uom, expected in [('KG', Decimal('17')), ('PCS', Decimal('15')), ('METER', Decimal('15'))]:
            with self.subTest(uom=uom):
                material = self._material(uom)
                PackagingStock.objects.create(material=material, plant=self.plant, location=self.location, qty=10)
                InventoryBulk.objects.create(material=material, plant=self.plant, location=self.location, qty_kg=5)
                InventoryRoll.objects.create(
                    material=material, plant=self.plant, location=self.location, label_id=f'MRP-ROLL-{uom}',
                    width_mm=100, weight_kg=2, status='AVAILABLE',
                )
                InventoryRoll.objects.create(
                    material=material, plant=self.plant, location=self.location, label_id=f'MRP-RESERVED-{uom}',
                    width_mm=100, weight_kg=99, status='RESERVED',
                )

                self.assertEqual(MRPService._get_available_stock(material, str(self.plant.pk)), expected)
