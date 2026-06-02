from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.materials.models import PouchStyleMaster, ProductMaster, ProductMasterSize
from apps.materials.serializers import ProductMasterSizeSerializer, PouchStyleSerializer
from apps.materials.services_pouch_style import compute_child_target_width_mm, compute_stock_geometry


class PouchStyleMasterFormulaTests(TestCase):
    def test_closed_formula_computes_child_target_width(self):
        style = PouchStyleMaster.objects.create(
            code="TEST-STANDUP",
            name="Test standup",
            formula_kind="GUSSETED_BOTTOM",
            formula_params={"trim_mm": 5, "bottom_factor": 1},
        )

        value = compute_child_target_width_mm(style, {"W": 140, "H": 210, "gusset": 60})

        self.assertEqual(value, Decimal("345.00"))

    def test_custom_ast_is_safe_and_rounded(self):
        style = PouchStyleMaster.objects.create(
            code="TEST-AST",
            name="Test AST",
            formula_kind="CUSTOM_AST",
            formula_ast={
                "op": "+",
                "left": {"op": "*", "left": {"op": "VAR", "name": "W"}, "right": {"op": "NUM", "value": 2}},
                "right": {"op": "PARAM", "name": "trim_mm"},
            },
            formula_params={"trim_mm": 4.125},
        )

        value = compute_child_target_width_mm(style, {"W": 127.333})

        self.assertEqual(value, Decimal("258.79"))

    def test_linear_formula_can_mix_width_height_and_factor_fields(self):
        style = PouchStyleMaster.objects.create(
            code="TEST-WH",
            name="Width plus height",
            formula_kind="LINEAR",
            formula_params={
                "terms": [
                    {"factors": [{"kind": "NUMBER", "value": 1}, {"kind": "FIELD", "field": "W"}]},
                    {"factors": [{"kind": "NUMBER", "value": 1}, {"kind": "FIELD", "field": "H"}]},
                    {"factors": [{"kind": "FIELD", "field": "gusset"}, {"kind": "FIELD", "field": "bottom_factor"}]},
                ],
                "trim_mm": 6,
            },
            allowed_fields={
                "W": {"required": True, "label": "Width"},
                "H": {"required": True, "label": "Height"},
                "gusset": {"label": "Gusset"},
                "bottom_factor": {"label": "Bottom factor", "default": 0.5},
            },
        )

        value = compute_child_target_width_mm(style, {"W": 140, "H": 210, "gusset": 60, "bottom_factor": 0.5})

        self.assertEqual(value, Decimal("386.00"))

    def test_product_master_size_serializer_computes_child_target_from_style_defaults(self):
        style = PouchStyleMaster.objects.create(
            code="TEST-H-AXIS",
            name="Height axis",
            locked=True,
            formula_kind="LINEAR",
            allowed_fields={
                "H": {"required": True, "label": "Height"},
                "overlap": {"label": "Overlap", "default": 12},
            },
            formula_params={
                "terms": [
                    {"factors": [{"kind": "NUMBER", "value": 1}, {"kind": "FIELD", "field": "H"}]},
                    {"factors": [{"kind": "NUMBER", "value": 1}, {"kind": "FIELD", "field": "overlap"}]},
                ],
                "trim_mm": 8,
            },
        )
        master = ProductMaster.objects.create(code="PM-H-AXIS", name="PM height axis", product_kind="POUCH")

        serializer = ProductMasterSizeSerializer(
            data={
                "product_master": str(master.id),
                "code": "H300",
                "label": "H 300",
                "width_mm": "120",
                "height_mm": "300",
                "pouch_style_master": str(style.id),
                "child_target_override": False,
                "qty_uom": "PCS",
                "active": True,
            }
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        size = serializer.save()

        self.assertEqual(size.child_target_width_mm, Decimal("320.00"))
        self.assertEqual(size.pouch_style_version, 1)

    def test_draft_pouch_style_cannot_bind_to_product_master_size(self):
        style = PouchStyleMaster.objects.create(
            code="TEST-DRAFT-STYLE",
            name="Draft style",
            locked=False,
            formula_kind="LINEAR",
            allowed_fields={"W": {"required": True}, "H": {"required": True}},
            formula_params={
                "terms": [{"factors": [{"kind": "NUMBER", "value": 2}, {"kind": "FIELD", "field": "W"}]}],
                "trim_mm": 0,
            },
        )
        master = ProductMaster.objects.create(code="PM-DRAFT-STYLE", name="Draft style PM", product_kind="POUCH")

        serializer = ProductMasterSizeSerializer(
            data={
                "product_master": str(master.id),
                "code": "100X200",
                "label": "100 x 200",
                "width_mm": "100",
                "height_mm": "200",
                "pouch_style_master": str(style.id),
                "qty_uom": "PCS",
                "active": True,
            }
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("pouch_style_master", serializer.errors)

    def test_size_save_does_not_implicitly_approve_draft_style(self):
        style = PouchStyleMaster.objects.create(
            code="TEST-NO-AUTO-LOCK",
            name="No auto lock",
            locked=False,
            formula_kind="LINEAR",
            allowed_fields={"W": {"required": True}, "H": {"required": True}},
            formula_params={
                "terms": [{"factors": [{"kind": "NUMBER", "value": 2}, {"kind": "FIELD", "field": "W"}]}],
                "trim_mm": 0,
            },
        )
        master = ProductMaster.objects.create(code="PM-NO-AUTO-LOCK", name="No auto lock PM", product_kind="POUCH")

        ProductMasterSize.objects.create(
            product_master=master,
            code="100X200",
            label="100 x 200",
            width_mm=100,
            height_mm=200,
            pouch_style_master=style,
            active=True,
        )

        style.refresh_from_db()
        self.assertFalse(style.locked)

    def test_approve_action_locks_style_for_size_binding(self):
        user = get_user_model().objects.create_user(username="pouch-style-approver", password="x")
        client = APIClient()
        client.force_authenticate(user)
        style = PouchStyleMaster.objects.create(
            code="TEST-APPROVE",
            name="Approve me",
            locked=False,
            formula_kind="LINEAR",
            allowed_fields={"W": {"required": True}, "H": {"required": True}},
            formula_params={
                "terms": [{"factors": [{"kind": "NUMBER", "value": 2}, {"kind": "FIELD", "field": "W"}]}],
                "trim_mm": 0,
            },
        )

        response = client.post(f"/api/master/pouch-styles/{style.id}/approve/", {}, format="json")

        self.assertEqual(response.status_code, 200, response.content)
        style.refresh_from_db()
        self.assertTrue(style.locked)

    def test_locked_edit_same_payload_does_not_spawn_version_or_disable_old(self):
        user = get_user_model().objects.create_user(username="pouch-style-noop", password="x")
        client = APIClient()
        client.force_authenticate(user)
        style = PouchStyleMaster.objects.create(
            code="TEST-NOOP-VERSION",
            name="No-op version",
            locked=True,
            formula_kind="LINEAR",
            allowed_fields={"W": {"required": True}},
            field_adjustments={"trim_default_mm": 0, "default_lane_count": 1},
            formula_params={
                "terms": [{"factors": [{"kind": "NUMBER", "value": 2}, {"kind": "FIELD", "field": "W"}]}],
                "trim_mm": 0,
            },
        )

        response = client.patch(
            f"/api/master/pouch-styles/{style.id}/",
            {
                "name": style.name,
                "field_adjustments": {"trim_default_mm": 0},
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data["id"], str(style.id))
        self.assertEqual(PouchStyleMaster.objects.filter(code=style.code).count(), 1)
        style.refresh_from_db()
        self.assertFalse(style.deprecated)

    def test_locked_edit_changed_payload_spawns_draft_v2_and_disables_v1(self):
        user = get_user_model().objects.create_user(username="pouch-style-version", password="x")
        client = APIClient()
        client.force_authenticate(user)
        style = PouchStyleMaster.objects.create(
            code="TEST-SPAWN-VERSION",
            name="Old style",
            locked=True,
            formula_kind="LINEAR",
            allowed_fields={"W": {"required": True}},
            formula_params={
                "terms": [{"factors": [{"kind": "NUMBER", "value": 2}, {"kind": "FIELD", "field": "W"}]}],
                "trim_mm": 0,
            },
        )

        response = client.patch(
            f"/api/master/pouch-styles/{style.id}/",
            {"name": "Changed style"},
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.data["version"], 2)
        self.assertFalse(response.data["locked"])
        new_style = PouchStyleMaster.objects.get(id=response.data["id"])
        self.assertFalse(new_style.locked)
        self.assertFalse(new_style.deprecated)
        style.refresh_from_db()
        self.assertTrue(style.deprecated)

    def test_tube_style_exposes_layflat_stock_and_double_area_width(self):
        style = PouchStyleMaster.objects.create(
            code="TEST-TUBE",
            name="Tube pouch",
            formula_kind="LINEAR",
            default_stock_form="LAYFLAT_TUBE",
            default_width_basis="LAYFLAT_WIDTH",
            default_slit_policy="EXACT_ONLY",
            formula_params={
                "terms": [
                    {"factors": [{"kind": "NUMBER", "value": 1}, {"kind": "FIELD", "field": "W"}]},
                    {"factors": [{"kind": "NUMBER", "value": 1}, {"kind": "FIELD", "field": "G"}]},
                ],
                "trim_mm": 0,
            },
            allowed_fields={"W": {"required": True}, "G": {"required": True}},
        )

        geometry = compute_stock_geometry(style, {"W": 250, "G": 50})

        self.assertEqual(geometry["stock_width_mm"], Decimal("300.00"))
        self.assertEqual(geometry["film_area_width_mm"], Decimal("600.00"))
        self.assertEqual(geometry["stock_form"], "LAYFLAT_TUBE")
        self.assertEqual(geometry["slit_policy"], "EXACT_ONLY")

    def test_pouch_style_api_hides_legacy_faces_field(self):
        style = PouchStyleMaster.objects.create(
            code="TEST-NO-FACES",
            name="No faces API",
            formula_kind="LINEAR",
            formula_params={"terms": [{"field": "W", "coefficient": 2}], "trim_mm": 0},
        )

        data = PouchStyleSerializer(style).data

        self.assertNotIn("faces", data)
