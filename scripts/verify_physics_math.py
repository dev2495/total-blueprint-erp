import os
import sys
from decimal import Decimal
from unittest.mock import patch

import django


sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from django.core.exceptions import ValidationError

from apps.physics.geometry_override import validate_pouch_geometry_contract
from apps.physics.services_physics import PhysicsEngine


def _assert_close(name: str, actual, expected, tolerance=Decimal("0.0001")):
    actual_dec = Decimal(str(actual))
    expected_dec = Decimal(str(expected))
    if abs(actual_dec - expected_dec) > tolerance:
        raise AssertionError(f"{name}: expected {expected_dec}, got {actual_dec}")


def _run_roll_authoritative_case():
    data = {
        "finished_good_type": "ROLL",
        "geometry": {"base": {"width_mm": 500, "height_mm": 0}, "multipliers": {"faces": 1}},
        "weight_kg": 0.0092,
        "uom": "KG",
        "film_layers": [{"thickness_micron": 20, "density_g_cm3": 0.92, "roll_width_mm": 500}],
    }
    result = PhysicsEngine.calculate(data)
    _assert_close("roll.total_weight_g", result["total_weight_g"], Decimal("9.2"))
    _assert_close("roll.area_m2", result["geometry_snapshot"]["area_m2"], Decimal("0.5"))
    print("PASS roll-authoritative")


def _run_pillow_case():
    data = {
        "finished_good_type": "POUCH",
        "order_qty": 1000,
        "uom": "PCS",
        "geometry": {
            "base": {"width_mm": 200, "height_mm": 300},
            "multipliers": {"faces": 2},
            "pouch_style": "PILLOW",
        },
        "film_layers": [
            {"thickness_micron": 12, "density_g_cm3": 1.4},
            {"thickness_micron": 50, "density_g_cm3": 0.92},
        ],
        "printing": {"enabled": True, "front_colors_count": 4, "ink_gsm_total": 2.0},
        "chemicals": {"adhesive_gsm": 2.5, "solvent_gsm": 1.0},
        "addons": [],
    }
    result = PhysicsEngine.calculate(data)
    area_m2_per_piece = Decimal("0.12")
    total_qty = Decimal("1000")
    film_gsm = Decimal("12") * Decimal("1.4") + Decimal("50") * Decimal("0.92")
    expected_total = area_m2_per_piece * (film_gsm + Decimal("2.0") + Decimal("3.5")) * total_qty
    _assert_close("pillow.total_weight_g", result["total_weight_g"], expected_total)
    print("PASS pillow-math")


def _run_gusset_case():
    geometry = validate_pouch_geometry_contract(
        fg_type="POUCH",
        geometry={
            "base": {"width_mm": 180, "height_mm": 240},
            "gusset_mm": 35,
            "trim_loss_mm": 4,
            "adjustments": [{"name": "Seal loss", "value": 6, "impact": "HEIGHT"}],
            "multipliers": {"faces": 2},
            "pouch_style": "SIDE_GUSSET",
        },
        addons=[],
        context_label="gusset-case",
    )
    data = {
        "finished_good_type": "POUCH",
        "order_qty": 500,
        "uom": "PCS",
        "geometry": geometry,
        "film_layers": [{"thickness_micron": 60, "density_g_cm3": 0.92}],
        "printing": {"enabled": False},
        "chemicals": {},
        "addons": [],
    }
    result = PhysicsEngine.calculate(data)
    expected_area = Decimal("0.219") * Decimal("0.246") * Decimal("2")
    expected_film = expected_area * Decimal("60") * Decimal("0.92") * Decimal("500")
    _assert_close("gusset.area_m2", result["geometry_snapshot"]["area_m2"], expected_area, Decimal("0.000001"))
    _assert_close("gusset.total_film_weight", result["total_film_weight"], expected_film)
    print("PASS gusset-adjustment-math")


def _run_spout_addon_pod_case():
    geometry = validate_pouch_geometry_contract(
        fg_type="POUCH",
        geometry={
            "base": {"width_mm": 160, "height_mm": 240},
            "gusset_mm": 32,
            "pouch_style": "SPOUT",
            "trim_loss_mm": 2,
            "multipliers": {"faces": 2},
        },
        addons=[
            {"name": "Top Spout Fitment", "weight_mode": "PER_PIECE", "weight_value": 1.8, "quantity": 1},
            {"name": "Zipper", "weight_mode": "PER_MM", "weight_value": 0.0015, "applies_to": "WIDTH", "quantity": 1},
        ],
        context_label="spout-case",
    )

    class _PodProfile:
        id = "pod-1"
        code = "POD-1"
        name = "Pod Single"
        pod_type = "SINGLE"
        pod_fixed_height_mm = Decimal("150")
        pod_thickness_micron = Decimal("30")
        pod_panel_count = 1
        density_gcm3 = Decimal("0.92")

    data = {
        "finished_good_type": "POUCH",
        "order_qty": 250,
        "uom": "PCS",
        "geometry": geometry,
        "film_layers": [{"thickness_micron": 70, "density_g_cm3": 0.92}],
        "printing": {"enabled": False},
        "chemicals": {},
        "addons": [
            {"name": "Top Spout Fitment", "weight_mode": "PER_PIECE", "weight_value": 1.8, "quantity": 1},
            {"name": "Zipper", "weight_mode": "PER_MM", "weight_value": 0.0015, "applies_to": "WIDTH", "quantity": 1},
        ],
        "packaging_snapshot": {"pod": {"enabled": True, "pod_profile_id": "pod-1"}},
    }

    with patch("apps.materials.models.InventoryMaterial.objects.filter") as filter_mock:
        filter_mock.return_value.only.return_value.first.return_value = _PodProfile()
        result = PhysicsEngine.calculate(data)

    expected_area = Decimal("0.194") * Decimal("0.24") * Decimal("2")
    expected_film = expected_area * Decimal("70") * Decimal("0.92") * Decimal("250")
    expected_addons = (Decimal("1.8") + (Decimal("0.0015") * Decimal("194"))) * Decimal("250")
    expected_pod_kg = (
        Decimal("0.194")
        * Decimal("0.15")
        * (Decimal("30") / Decimal("1000000"))
        * (Decimal("0.92") * Decimal("1000"))
        * Decimal("250")
    )
    expected_total = expected_film + expected_addons + (expected_pod_kg * Decimal("1000"))
    _assert_close("spout.total_addon_weight", result["total_addon_weight"], expected_addons)
    _assert_close("spout.total_weight_g", result["total_weight_g"], expected_total, Decimal("0.001"))
    print("PASS spout-addon-pod-math")


def _run_negative_contract_rejections():
    rejected = 0
    bad_cases = [
        {
            "label": "negative-trim",
            "geometry": {"base": {"width_mm": 120, "height_mm": 220}, "trim_loss_mm": -1, "pouch_style": "PILLOW"},
            "addons": [],
        },
        {
            "label": "spout-missing-addon",
            "geometry": {"base": {"width_mm": 120, "height_mm": 220}, "gusset_mm": 20, "pouch_style": "SPOUT"},
            "addons": [],
        },
        {
            "label": "per-mm-missing-axis",
            "geometry": {"base": {"width_mm": 120, "height_mm": 220}, "pouch_style": "PILLOW"},
            "addons": [{"name": "Zipper", "weight_mode": "PER_MM", "weight_value": 1.2, "quantity": 1}],
        },
    ]
    for row in bad_cases:
        try:
            validate_pouch_geometry_contract(
                fg_type="POUCH",
                geometry=row["geometry"],
                addons=row["addons"],
                context_label=row["label"],
            )
        except ValidationError:
            rejected += 1
    if rejected != len(bad_cases):
        raise AssertionError(f"Expected {len(bad_cases)} invalid pouch cases to be rejected, got {rejected}")
    print("PASS contract-rejections")


if __name__ == "__main__":
    try:
        _run_roll_authoritative_case()
        _run_pillow_case()
        _run_gusset_case()
        _run_spout_addon_pod_case()
        _run_negative_contract_rejections()
        print("All physics verification scenarios passed.")
    except Exception as exc:
        print(f"CRITICAL FAILURE: {exc}")
        raise
