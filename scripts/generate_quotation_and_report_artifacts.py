from __future__ import annotations

import json
import os
import sys
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

import django

sys.path.insert(0, os.getcwd())
os.environ.setdefault("SKIP_CELERY_IMPORT", "1")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from django.utils import timezone
from rest_framework.test import APIClient

from apps.analytics.models import ReportDistributionProfile
from apps.analytics.report_delivery import ReportDistributionService
from apps.factory.models import Plant
from apps.sales.models import Customer, Quotation, SalesSku, SalesSkuVariant
from apps.sales.services.quotation_service import QuotationService
from apps.users.models import User
from scripts.e2e_green_utils import CODE_PREFIX, label, runtime_dir


DRY_FRUIT_SKU_CODE = f"{CODE_PREFIX}-DRYFRUIT"
SALES_CUSTOMER_CODE = f"{CODE_PREFIX}-SALES-CUST"
QUOTATION_NOTE = label("Premium Dry Fruit Quote")


def _resolve_admin_user() -> User:
    user = (
        User.objects.filter(is_superuser=True).first()
        or User.objects.filter(is_owner=True).first()
        or User.objects.filter(is_staff=True).order_by("date_joined").first()
    )
    if user:
        return user
    return User.objects.create_user(
        username="uat-green-admin",
        email="uat-green-admin@example.com",
        password="pass1234",
        is_staff=True,
        is_superuser=True,
    )


def _resolve_plant() -> Plant:
    plant = Plant.objects.filter(include_in_official_reports=True).order_by("code").first() or Plant.objects.order_by("code").first()
    if not plant:
        raise RuntimeError("No plant available for quotation/report artifact generation.")
    return plant


def _resolve_customer() -> Customer:
    customer = Customer.objects.filter(code=SALES_CUSTOMER_CODE).first() or Customer.objects.order_by("name").first()
    if not customer:
        raise RuntimeError("No customer available for quotation artifact generation.")
    return customer


def _variant_payload(variant: SalesSkuVariant, *, qty_value: Decimal, manual_unit_price: Decimal) -> dict:
    geometry = variant.geometry_snapshot or {}
    packaging = variant.packaging_snapshot or {}
    printing = variant.printing_snapshot or {}
    chemicals = variant.chemicals_snapshot or {}
    addons = variant.addons_snapshot or []
    qty_uom = "PCS"
    price_basis = "PCS"
    if str(variant.finished_good_type or "").upper() == "ROLL":
        qty_uom = "KG"
        price_basis = "KG"
    return {
        "plant": None,
        "sku_variant_id": str(variant.id),
        "template_id": str(variant.sku.template_id),
        "line_name": variant.name,
        "finished_good_type": variant.finished_good_type,
        "roll_form": variant.roll_form or "",
        "qty_value": float(qty_value),
        "qty_uom": qty_uom,
        "price_basis": price_basis,
        "geometry": geometry,
        "film_layers": variant.layer_snapshot or [],
        "printing": printing,
        "chemicals": chemicals,
        "addons": addons,
        "packaging_snapshot": packaging,
        "commercial_snapshot": {
            "margin_target_percent": 18,
            "tax_percent": 18,
            "manual_unit_price": float(manual_unit_price),
            "freight_value": 0,
            "packing_value": 0,
            "misc_value": 0,
            "discount_percent": 0,
            "discount_value": 0,
            "wastage_percent": 0,
        },
    }


def _build_dry_fruit_quote(plant: Plant, customer: Customer) -> Quotation:
    sku = SalesSku.objects.prefetch_related("variants").select_related("template").get(code=DRY_FRUIT_SKU_CODE)
    variants = {variant.code: variant for variant in sku.variants.filter(active=True)}
    quote_lines = [
        _variant_payload(variants["DRYFRUIT-200X200"], qty_value=Decimal("2500"), manual_unit_price=Decimal("6.90")),
        _variant_payload(variants["DRYFRUIT-240X300"], qty_value=Decimal("1800"), manual_unit_price=Decimal("9.40")),
    ]
    for line in quote_lines:
        line["plant"] = str(plant.id)

    quote = QuotationService.create_quotation(
        {
            "customer": str(customer.id),
            "customer_name": customer.name,
            "plant": str(plant.id),
            "status": "SENT",
            "valid_until": (timezone.localdate() + timedelta(days=14)).isoformat(),
            "currency": "INR",
            "terms": "Freight extra. Taxes as applicable. Quote uses system-estimated cost guidance.",
            "notes": QUOTATION_NOTE,
            "items": quote_lines,
        }
    )
    return quote


def _save_quote_pdf(quote: Quotation, user: User) -> Path:
    client = APIClient()
    client.force_authenticate(user)
    response = client.get(f"/api/sales/quotations/{quote.id}/pdf/")
    if response.status_code != 200:
        raise RuntimeError(f"Quotation PDF endpoint failed: {response.status_code}")
    target = runtime_dir() / f"dry-fruit-quotation-{quote.quote_number}.pdf"
    target.write_bytes(response.content)
    return target


def _trigger_daily_reports(user: User) -> list[dict]:
    runs = []
    for profile in ReportDistributionService.list_profiles():
        run = ReportDistributionService.send_profile(
            profile,
            report_date=timezone.localdate(),
            triggered_by=user,
            triggered_manually=True,
        )
        runs.append(ReportDistributionService.serialize_run(run))
    return runs


def main() -> None:
    plant = _resolve_plant()
    customer = _resolve_customer()
    user = _resolve_admin_user()
    quote = _build_dry_fruit_quote(plant, customer)
    pdf_path = _save_quote_pdf(quote, user)
    report_runs = _trigger_daily_reports(user)

    payload = {
        "generated_at": timezone.now().isoformat(),
        "quotation_id": str(quote.id),
        "quotation_number": quote.quote_number,
        "quotation_pdf": str(pdf_path),
        "customer": quote.customer_name,
        "plant": plant.name,
        "notes": quote.notes,
        "daily_report_runs": report_runs,
    }
    target = runtime_dir() / "quotation-and-report-artifacts.json"
    target.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
