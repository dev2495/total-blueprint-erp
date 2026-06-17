import os
import sys
from copy import deepcopy
from datetime import timedelta
from decimal import Decimal
from pathlib import Path
import json

import django

sys.path.insert(0, os.getcwd())
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings_script")
os.environ.setdefault("SKIP_ADMIN_APP_IMPORT", "1")
django.setup()

from django.utils import timezone

from apps.artwork.models import Artwork
from apps.artwork.print_contract import resolve_ink_base_from_layers
from apps.inventory.models import InkMaterial
from apps.sales.models import Customer, SalesOrder, SalesSkuVariant
from apps.sales.services.order_service import SalesOrderService
from apps.users.models import User

ORDER_PREFIX = "UI E2E Planner Artwork Gate"
ARTWORK_CODE = "UI-E2E-FLEXO-GATE"
ARTWORK_NAME = "UI E2E Deferred Artwork"
INK_COLOR_PALETTE = ("CYAN", "MAGENTA", "YELLOW", "BLACK", "RED", "BLUE", "GREEN", "WHITE")


def ensure_seed_artwork(
    admin_user: User,
    *,
    print_type: str = "FLEXO",
    front_colors_count: int = 1,
    back_colors_count: int = 0,
    front_colors: list[str] | None = None,
    back_colors: list[str] | None = None,
) -> Artwork:
    normalized_print_type = str(print_type or "FLEXO").upper()
    front_count = max(0, int(front_colors_count or 0))
    back_count = max(0, int(back_colors_count or 0))
    if front_count + back_count <= 0:
        front_count = 1
        back_count = 0
    normalized_front = [str(value).strip().upper() for value in (front_colors or []) if str(value).strip()]
    normalized_back = [str(value).strip().upper() for value in (back_colors or []) if str(value).strip()]
    if len(normalized_front) != front_count:
        normalized_front = [f"FRONT-{idx + 1}" for idx in range(front_count)]
    if len(normalized_back) != back_count:
        normalized_back = [f"BACK-{idx + 1}" for idx in range(back_count)]
    front_colors = normalized_front
    back_colors = normalized_back
    color_list = front_colors + back_colors
    artwork, _ = Artwork.objects.get_or_create(
        design_code=ARTWORK_CODE,
        defaults={
            "name": ARTWORK_NAME,
            "print_type": normalized_print_type,
            "front_colors_count": front_count,
            "back_colors_count": back_count,
            "front_colors": front_colors,
            "back_colors": back_colors,
            "color_list": color_list,
            "colors_count": len(color_list),
            "ink_gsm_total": 1.2,
            "ink_gsm_split_mode": "EQUAL",
            "ink_gsm_color_percentages": {},
            "ink_gsm_by_color": {},
            "file_path": "/tmp/ui-e2e-flexo-gate.pdf",
            "status": "APPROVED",
            "approved_by": admin_user,
            "approved_at": timezone.now(),
        },
    )

    changed = False
    required = {
        "name": ARTWORK_NAME,
        "print_type": normalized_print_type,
        "front_colors_count": front_count,
        "back_colors_count": back_count,
        "front_colors": front_colors,
        "back_colors": back_colors,
        "color_list": color_list,
        "colors_count": len(color_list),
        "ink_gsm_total": 1.2,
        "ink_gsm_split_mode": "EQUAL",
        "ink_gsm_color_percentages": {},
        "ink_gsm_by_color": {},
        "file_path": "/tmp/ui-e2e-flexo-gate.pdf",
        "status": "APPROVED",
    }
    for field, value in required.items():
        if not hasattr(artwork, field):
            continue
        if getattr(artwork, field) != value:
            setattr(artwork, field, value)
            changed = True
    if artwork.approved_by_id != admin_user.id:
        artwork.approved_by = admin_user
        changed = True
    if artwork.approved_at is None:
        artwork.approved_at = timezone.now()
        changed = True
    if changed:
        artwork.save()
    return artwork


def find_existing_gate_order() -> SalesOrder | None:
    existing = (
        SalesOrder.objects.filter(order_name__startswith=ORDER_PREFIX, status="PLANNING_REQUIRED")
        .order_by("-created_at")
        .first()
    )
    if not existing:
        return None
    if existing.created_at and existing.created_at < timezone.now() - timedelta(minutes=15):
        return None
    if existing.items.filter(artwork_assignment_required=True).exists():
        return existing
    return None


def _geometry_has_positive_pouch_dims(geometry: dict | None) -> bool:
    payload = geometry if isinstance(geometry, dict) else {}
    base = payload.get("base") if isinstance(payload.get("base"), dict) else {}
    width_mm = Decimal(str(base.get("width_mm") or 0))
    height_mm = Decimal(str(base.get("height_mm") or 0))
    return width_mm > 0 and height_mm > 0


def _positive_decimal(*values) -> Decimal:
    for value in values:
        try:
            parsed = Decimal(str(value or 0))
        except Exception:
            continue
        if parsed > 0:
            return parsed
    return Decimal("0")


def _ensure_seed_web_width_contract(geometry: dict | None, layer_snapshot: list | None) -> dict:
    payload = deepcopy(geometry or {})
    base = payload.get("base") if isinstance(payload.get("base"), dict) else {}
    child_width = _positive_decimal(
        payload.get("child_target_width_mm"),
        payload.get("target_child_width_mm"),
        payload.get("roll_width_mm"),
        payload.get("effective_roll_width_mm"),
        payload.get("effective_width_mm"),
        base.get("child_target_width_mm"),
        base.get("target_child_width_mm"),
        base.get("roll_width_mm"),
        base.get("width_mm"),
        base.get("effective_width_mm"),
    )
    if child_width <= 0:
        child_width = Decimal("1")

    width_value = float(child_width)
    payload["child_target_width_mm"] = width_value
    payload["target_child_width_mm"] = width_value
    payload["roll_width_mm"] = float(_positive_decimal(payload.get("roll_width_mm"), base.get("roll_width_mm"), child_width))
    base["child_target_width_mm"] = width_value
    base["target_child_width_mm"] = width_value
    base["roll_width_mm"] = payload["roll_width_mm"]
    payload["base"] = base

    for row in layer_snapshot or []:
        if not isinstance(row, dict):
            continue
        row_width = float(_positive_decimal(row.get("roll_width_mm"), row.get("width_mm"), payload["roll_width_mm"], child_width))
        row["roll_width_mm"] = row_width
        row["width_mm"] = row_width

    return payload


def _ensure_seed_ink_contract(layer_snapshot: list | None, total_colors: int) -> tuple[str, list[str], dict[str, str]]:
    color_count = max(1, int(total_colors or 1))
    base_family = resolve_ink_base_from_layers(layer_snapshot or [])
    palette = list(INK_COLOR_PALETTE)
    while len(palette) < color_count:
        palette.append(f"UIE2E{len(palette) + 1}")
    color_names = [str(color).strip().upper() for color in palette[:color_count]]
    color_mapping: dict[str, str] = {}
    for color in color_names:
        ink, _ = InkMaterial.objects.get_or_create(base_type=base_family, color_name=color)
        if hasattr(ink, "status") and getattr(ink, "status", "ACTIVE") != "ACTIVE":
            ink.status = "ACTIVE"
            ink.save(update_fields=["status"])
        color_mapping[color] = str(ink.id)
    return base_family, color_names, color_mapping


def _sheet_safe_seed_printing(printing: dict | None, layer_snapshot: list | None) -> dict:
    payload = dict(printing or {})
    print_type = "FLEXO"
    front_count = int(payload.get("front_colors_count") or 1)
    back_count = int(payload.get("back_colors_count") or 0)
    total_colors = max(1, front_count + back_count)
    ink_base_family, color_names, color_mapping = _ensure_seed_ink_contract(layer_snapshot or [], total_colors)
    ink_gsm = float(payload.get("ink_gsm_total") or payload.get("ink_gsm") or 1.2)
    payload.update(
        {
            "enabled": True,
            "type": print_type,
            "method": print_type,
            "substrate_mode": "SHEET",
            "film_type": "SHEET",
            "front_colors_count": total_colors,
            "back_colors_count": 0,
            "front_colors": color_names[:total_colors],
            "back_colors": [],
            "color_names": color_names[:total_colors],
            "color_mapping": color_mapping,
            "ink_base_family": ink_base_family,
            "ink_gsm_total": ink_gsm,
            "ink_gsm": ink_gsm,
            "cylinder_required": False,
        }
    )
    payload.pop("artwork_id", None)
    payload.pop("artwork_design_code", None)
    return payload


def _find_seed_variant() -> SalesSkuVariant:
    variants = (
        SalesSkuVariant.objects.select_related("sku", "sku__template")
        .filter(
            active=True,
            finished_good_type="POUCH",
            sku__active=True,
            sku__template__status="LIVE",
        )
        .order_by("sku__code", "code")
    )
    for variant in variants:
        if _geometry_has_positive_pouch_dims(variant.geometry_snapshot):
            return variant
    raise RuntimeError("Could not find an active LIVE pouch SKU variant with valid geometry for planner gate seeding.")


def build_gate_order() -> SalesOrder:
    variant = _find_seed_variant()
    customer = Customer.objects.order_by("name", "created_at").first()
    customer_name = customer.name if customer else "UI E2E Customer"
    layer_snapshot = deepcopy(variant.layer_snapshot or [])
    geometry = _ensure_seed_web_width_contract(deepcopy(variant.geometry_snapshot or {}), layer_snapshot)
    payload = {
        "customer": str(customer.id) if customer else None,
        "customer_name": customer_name,
        "order_name": f"{ORDER_PREFIX} {timezone.now().strftime('%Y%m%d%H%M%S')}",
        "delivery_date": (timezone.now().date() + timedelta(days=7)).isoformat(),
        "template_id": str(variant.sku.template_id),
        "sku_variant_id": str(variant.id),
        "mode": "TEMPLATE",
        "qty_value": "2500",
        "qty_uom": "PCS",
        "geometry": geometry,
        "film_layers": layer_snapshot,
        "printing": _sheet_safe_seed_printing(deepcopy(variant.printing_snapshot or {}), layer_snapshot),
        "chemicals": deepcopy(variant.chemicals_snapshot or {}),
        "addons": deepcopy(variant.addons_snapshot or []),
        "packaging_snapshot": deepcopy(variant.packaging_snapshot or {}),
        "line_name": f"UI E2E {variant.name}",
        "price_basis": "PCS",
        "unit_price": "6.90",
    }
    payload = {key: value for key, value in payload.items() if value is not None}

    order = SalesOrderService.create_sales_order(payload)
    SalesOrderService.confirm_sales_order(str(order.id))
    order.refresh_from_db()
    order = force_artwork_gate(order)
    item = order.items.first()
    if order.status != "PLANNING_REQUIRED" or not item or not item.artwork_assignment_required:
        raise RuntimeError("UI E2E planner artwork gate seed did not produce a pending artwork-assignment sales order.")
    return order


def force_artwork_gate(order: SalesOrder) -> SalesOrder:
    item = order.items.first()
    if not item:
        raise RuntimeError("Planner artwork gate seed order has no items.")

    # This browser gate validates deferred artwork assignment, not cylinder readiness.
    # Keep the seeded row FLEXO and sheet-safe regardless of the source variant.
    printing = _sheet_safe_seed_printing(item.printing_snapshot or {}, item.layer_snapshot or [])

    item.printing_snapshot = printing
    item.assigned_artwork_id = None
    item.artwork_assignment_required = True
    item.save(update_fields=["printing_snapshot", "assigned_artwork_id", "artwork_assignment_required"])

    if hasattr(order, "artwork_assignment_required"):
        order.artwork_assignment_required = True
        order.save(update_fields=["artwork_assignment_required"])

    order.refresh_from_db()
    return order


def main():
    admin_user = User.objects.filter(username="admin").first() or User.objects.filter(is_superuser=True).order_by("username").first()
    if not admin_user:
        raise RuntimeError("Admin user is required before seeding UI E2E planner gate fixtures.")

    existing = find_existing_gate_order()
    order = force_artwork_gate(existing) if existing else build_gate_order()
    gate_item = order.items.filter(artwork_assignment_required=True).first()
    printing = dict(getattr(gate_item, "printing_snapshot", {}) or {})
    artwork = ensure_seed_artwork(
        admin_user,
        print_type=str(printing.get("type") or printing.get("method") or "FLEXO").upper(),
        front_colors_count=int(printing.get("front_colors_count") or 0),
        back_colors_count=int(printing.get("back_colors_count") or 0),
        front_colors=printing.get("front_colors") or [],
        back_colors=printing.get("back_colors") or [],
    )
    runtime_dir = Path(os.environ.get("UI_E2E_RUNTIME_DIR", Path(os.getcwd()) / ".runtime" / "ui-e2e"))
    runtime_dir.mkdir(parents=True, exist_ok=True)
    metadata_path = runtime_dir / "planner-gate-seed.json"
    metadata = {
        "order_id": str(order.id),
        "order_number": order.order_number,
        "order_name": order.order_name,
        "status": order.status,
        "item_id": str(gate_item.id) if gate_item else None,
        "artwork_design_code": artwork.design_code,
        "artwork_name": artwork.name,
    }
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    print("UI E2E planner gate seed complete:", metadata)


if __name__ == "__main__":
    main()
