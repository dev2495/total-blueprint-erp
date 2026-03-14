import os
import sys
from datetime import timedelta
from decimal import Decimal
from pathlib import Path
import json

import django

sys.path.insert(0, os.getcwd())
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from django.utils import timezone

from apps.artwork.models import Artwork
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.sales.services.order_service import SalesOrderService
from apps.users.models import User

ORDER_PREFIX = "UI E2E Planner Artwork Gate"
ARTWORK_CODE = "UI-E2E-FLEXO-GATE"
ARTWORK_NAME = "UI E2E Deferred Artwork"


def ensure_seed_artwork(admin_user: User) -> Artwork:
    artwork, _ = Artwork.objects.get_or_create(
        design_code=ARTWORK_CODE,
        defaults={
            "name": ARTWORK_NAME,
            "print_type": "FLEXO",
            "front_colors_count": 1,
            "back_colors_count": 0,
            "front_colors": ["YELLOW"],
            "back_colors": [],
            "color_list": ["YELLOW"],
            "colors_count": 1,
            "file_path": "/tmp/ui-e2e-flexo-gate.pdf",
            "status": "APPROVED",
            "approved_by": admin_user,
            "approved_at": timezone.now(),
        },
    )

    changed = False
    required = {
        "name": ARTWORK_NAME,
        "print_type": "FLEXO",
        "front_colors_count": 1,
        "back_colors_count": 0,
        "front_colors": ["YELLOW"],
        "back_colors": [],
        "color_list": ["YELLOW"],
        "colors_count": 1,
        "file_path": "/tmp/ui-e2e-flexo-gate.pdf",
        "status": "APPROVED",
    }
    for field, value in required.items():
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
    if existing.items.filter(artwork_assignment_required=True).exists():
        return existing
    return None


def build_gate_order() -> SalesOrder:
    source_item = (
        SalesOrderItem.objects.filter(
            sales_order__status="CONFIRMED",
            template__status="LIVE",
            template__fg_type="POUCH",
        )
        .select_related("sales_order", "template")
        .order_by("-created_at")
        .first()
    )
    if not source_item:
        raise RuntimeError("Could not find a confirmed LIVE pouch sales order item to clone for UI E2E planner gate seeding.")

    customer = source_item.sales_order.customer
    customer_name = source_item.sales_order.customer_name or (customer.name if customer else "UI E2E Customer")
    qty_value = Decimal(str(source_item.qty_value or 0))
    if qty_value <= 0:
        qty_value = Decimal("25")
    unit_price = Decimal(str(source_item.unit_price or 0))
    if unit_price <= 0:
        unit_price = Decimal("100")

    payload = {
        "customer": str(customer.id) if customer else None,
        "customer_name": customer_name,
        "order_name": f"{ORDER_PREFIX} {timezone.now().strftime('%Y%m%d%H%M%S')}",
        "delivery_date": (timezone.now().date() + timedelta(days=7)).isoformat(),
        "template_id": str(source_item.template_id),
        "mode": "TEMPLATE",
        "qty_value": str(qty_value),
        "qty_uom": str(source_item.qty_uom or "KG").upper(),
        "geometry": source_item.geometry_snapshot or {},
        "film_layers": source_item.layer_snapshot or [],
        "printing": {
            "enabled": True,
            "type": "FLEXO",
            "substrate_mode": "SHEET",
            "front_colors_count": 1,
            "back_colors_count": 0,
            "ink_gsm_total": 1.2,
            "artwork_id": None,
        },
        "addons": source_item.addons_snapshot or [],
        "packaging_snapshot": source_item.packaging_snapshot or {},
        "line_name": "UI E2E Planner Gate",
        "price_basis": str(source_item.price_basis or "KG").upper(),
        "unit_price": str(unit_price),
    }
    payload = {key: value for key, value in payload.items() if value is not None}

    order = SalesOrderService.create_sales_order(payload)
    SalesOrderService.confirm_sales_order(str(order.id))
    order.refresh_from_db()
    item = order.items.first()
    if order.status != "PLANNING_REQUIRED" or not item or not item.artwork_assignment_required:
        raise RuntimeError("UI E2E planner artwork gate seed did not produce a pending artwork-assignment sales order.")
    return order


def main():
    admin_user = User.objects.filter(username="admin").first() or User.objects.filter(is_superuser=True).order_by("username").first()
    if not admin_user:
        raise RuntimeError("Admin user is required before seeding UI E2E planner gate fixtures.")

    artwork = ensure_seed_artwork(admin_user)
    order = find_existing_gate_order() or build_gate_order()
    gate_item = order.items.filter(artwork_assignment_required=True).first()
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
