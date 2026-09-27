"""Read-only FG/semi-FG eligibility smoke on a disposable local database.

This script creates deterministic fixture rows inside one transaction and rolls
them back before exiting. It refuses non-local databases and database names
that do not clearly identify a test database.
"""

import os
import sys
import uuid
from decimal import Decimal

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings_script")
os.environ.setdefault("SKIP_ADMIN_APP_IMPORT", "1")

import django

django.setup()

from django.conf import settings
from django.db import transaction

from apps.factory.models import Plant
from apps.inventory.models import InventoryLocation, InventoryRoll
from apps.production.views_planner import PlannerViewSet
from apps.routing.models import RoutingRule
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.templates.models import TemplateBlueprint
from apps.physics.spec_signature import (
    build_invariant_payload,
    build_invariant_signature,
    build_spec_payload,
    build_spec_signature,
)


def _require_isolated_database():
    config = settings.DATABASES["default"]
    host = str(config.get("HOST") or "").strip().lower()
    name = str(config.get("NAME") or "").strip().lower()
    if host not in {"127.0.0.1", "localhost"}:
        raise RuntimeError("Refusing fixture writes: verifier requires a local database host.")
    if not (name.startswith("test_") or name.startswith("tpp_v2_fg_")):
        raise RuntimeError(
            "Refusing fixture writes: DB_NAME must start with 'test_' or 'tpp_v2_fg_'."
        )
    if os.environ.get("TPP_ALLOW_LOCAL_FG_SEMI_FIXTURE") != "1":
        raise RuntimeError(
            "Refusing fixture writes: set TPP_ALLOW_LOCAL_FG_SEMI_FIXTURE=1 for a disposable local test DB."
        )


def run_verification():
    _require_isolated_database()
    tag = uuid.uuid4().hex[:10].upper()
    with transaction.atomic():
        plant = Plant.objects.create(name=f"FG Semi Smoke {tag}", code=f"FG-{tag}")
        location = InventoryLocation.objects.create(
            name=f"FG Semi Smoke Location {tag}",
            code=f"FGL-{tag}",
            plant=plant,
            type="FG",
        )
        route = RoutingRule.objects.create(
            name=f"FG Semi Smoke Route {tag}",
            ordered_processes=["EXTRUSION", "PRINTING", "LAMINATION", "POUCHING"],
        )
        template = TemplateBlueprint.objects.create(
            name=f"FG Semi Smoke Pouch {tag}",
            fg_type="POUCH",
            status="DRAFT",
            pouch_style="STAND_UP",
            routing_rule=route,
        )

        family_id = str(uuid.uuid4())
        variant_id = str(uuid.uuid4())
        layer_snapshot = [
            {
                "family_id": family_id,
                "variant_id": variant_id,
                "thickness_micron": 50,
                "width_mm": 500,
            }
        ]
        printing_snapshot = {"enabled": False}
        invariant_payload = build_invariant_payload(
            film_layers=layer_snapshot,
            printing=printing_snapshot,
        )
        invariant_signature = build_invariant_signature(invariant_payload)

        # A finished roll must match the exact final specification and route.
        final_geometry = {"width_mm": 100, "height_mm": 200}
        final_signature = build_spec_signature(
            build_spec_payload(
                fg_type="POUCH",
                roll_form="",
                geometry=final_geometry,
                film_layers=layer_snapshot,
                printing=printing_snapshot,
                addons=[],
            )
        )
        final_order = SalesOrder.objects.create(
            customer_name=f"FG Final Smoke {tag}",
            status="PLANNING_REQUIRED",
        )
        final_item = SalesOrderItem.objects.create(
            sales_order=final_order,
            template=template,
            qty_value=Decimal("100"),
            spec_signature=final_signature,
            invariant_signature=invariant_signature,
            geometry_snapshot=final_geometry,
            layer_snapshot=layer_snapshot,
            printing_snapshot=printing_snapshot,
        )
        final_roll = InventoryRoll.objects.create(
            label_id=f"FG-FINAL-{tag}",
            template=template,
            status="AVAILABLE",
            weight_kg=Decimal("150.00"),
            width_mm=500,
            thickness_micron=50,
            completed_step_index=3,
            location=location,
            plant=plant,
            is_fg=True,
            sales_order_item=final_item,
            meta_json={"spec_signature": final_signature},
        )
        wrong_final = InventoryRoll.objects.create(
            label_id=f"FG-WRONG-{tag}",
            template=template,
            status="AVAILABLE",
            weight_kg=Decimal("90.00"),
            width_mm=500,
            thickness_micron=50,
            completed_step_index=3,
            location=location,
            plant=plant,
            is_fg=True,
            meta_json={"spec_signature": f"WRONG-{tag}"},
        )

        # A semi-finished roll can qualify only at the matching invariant and
        # an eligible in-route stage. Step 1 is WIP here; it is not raw stock.
        semi_geometry = {"width_mm": 120, "height_mm": 200}
        semi_signature = build_spec_signature(
            build_spec_payload(
                fg_type="POUCH",
                roll_form="",
                geometry=semi_geometry,
                film_layers=layer_snapshot,
                printing=printing_snapshot,
                addons=[],
            )
        )
        semi_order = SalesOrder.objects.create(
            customer_name=f"FG Semi Smoke {tag}",
            status="PLANNING_REQUIRED",
        )
        semi_item = SalesOrderItem.objects.create(
            sales_order=semi_order,
            template=template,
            qty_value=Decimal("100"),
            spec_signature=semi_signature,
            invariant_signature=invariant_signature,
            geometry_snapshot=semi_geometry,
            layer_snapshot=layer_snapshot,
            printing_snapshot=printing_snapshot,
        )
        semi_roll = InventoryRoll.objects.create(
            label_id=f"FG-SEMI-{tag}",
            template=template,
            status="AVAILABLE",
            weight_kg=Decimal("200.00"),
            width_mm=500,
            thickness_micron=50,
            completed_step_index=1,
            location=location,
            plant=plant,
            is_fg=False,
            meta_json={
                "spec_signature": f"OTHER-{tag}",
                "invariant_signature": invariant_signature,
            },
        )
        wrong_semi = InventoryRoll.objects.create(
            label_id=f"FG-SEMI-WRONG-{tag}",
            template=template,
            status="AVAILABLE",
            weight_kg=Decimal("80.00"),
            width_mm=500,
            thickness_micron=50,
            completed_step_index=1,
            location=location,
            plant=plant,
            is_fg=False,
            meta_json={
                "spec_signature": f"OTHER-WRONG-{tag}",
                "invariant_signature": f"WRONG-INVARIANT-{tag}",
            },
        )

        planner = PlannerViewSet()
        final_options = planner._eligible_inventory_for_order(
            order_kind="sales",
            order_obj=final_order,
            sales_item=final_item,
            template=template,
            order_signature=final_signature,
            order_invariant_signature=invariant_signature,
            required_start_step=3,
            route_last_index=3,
            roll_alloc_map={},
            fg_alloc_map={},
            order_layer_snapshot=layer_snapshot,
        )
        semi_options = planner._eligible_inventory_for_order(
            order_kind="sales",
            order_obj=semi_order,
            sales_item=semi_item,
            template=template,
            order_signature=semi_signature,
            order_invariant_signature=invariant_signature,
            required_start_step=1,
            route_last_index=3,
            roll_alloc_map={},
            fg_alloc_map={},
            order_layer_snapshot=layer_snapshot,
        )
        final_by_id = {row["inventory_id"]: row for row in final_options}
        semi_by_id = {row["inventory_id"]: row for row in semi_options}

        if str(final_roll.id) not in final_by_id or not final_by_id[str(final_roll.id)]["is_final_step"]:
            raise AssertionError("Exact final-spec stock did not qualify as finished stock.")
        if str(wrong_final.id) in final_by_id:
            raise AssertionError("Finished stock with a different exact signature qualified.")
        if str(semi_roll.id) not in semi_by_id or semi_by_id[str(semi_roll.id)]["is_final_step"]:
            raise AssertionError("Matching in-route semi-FG did not qualify as non-final WIP.")
        if str(wrong_semi.id) in semi_by_id:
            raise AssertionError("Semi-FG with a different invariant signature qualified.")

        print("PASS exact final-spec stock qualifies; wrong final signature is excluded.")
        print("PASS in-route semi-FG invariant qualifies; wrong invariant is excluded.")
        transaction.set_rollback(True)


if __name__ == "__main__":
    try:
        run_verification()
    except Exception as exc:
        print(f"FAIL FG/Semi-FG matching smoke: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
