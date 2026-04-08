import json
import os
import sys
from decimal import Decimal
from pathlib import Path

import django

sys.path.insert(0, os.getcwd())
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings_script")
os.environ.setdefault("SKIP_ADMIN_APP_IMPORT", "1")
django.setup()

from django.contrib.auth import get_user_model

from apps.analytics.models import ReportDistributionProfile
from apps.factory.models import Plant, PlantLegalProfile, Process
from apps.materials.models import CommercialFamily, InventoryMaterial, PodSku, PodSkuVariant
from apps.routing.models import RoutingRule
from apps.sales.models import Customer, Quotation, SalesOrder, SalesSku, SalesSkuVariant
from apps.sales.services.quotation_service import QuotationService
from apps.templates.models import TemplateBlueprint


def runtime_dir() -> Path:
    target = Path(os.environ.get("UI_E2E_RUNTIME_DIR", Path(os.getcwd()) / ".runtime" / "ui-e2e"))
    target.mkdir(parents=True, exist_ok=True)
    return target


def _ensure_admin():
    user = get_user_model().objects.filter(username="admin").first()
    if user:
        return user
    return get_user_model().objects.filter(is_superuser=True).order_by("id").first()


admin = _ensure_admin()

plant, _ = Plant.objects.update_or_create(
    code="UAT-GREEN-PLANT",
    defaults={"name": "UAT-GREEN Sales Plant"},
)
PlantLegalProfile.objects.update_or_create(
    plant=plant,
    defaults={
        "legal_name": "UAT-GREEN Sales Plant LLP",
        "gstin": "24ABCDE1234F1Z5",
        "address": "Operational Estate, Ahmedabad",
        "contact_phone": "9999999999",
        "contact_email": "uat-green@example.com",
    },
)

customer, _ = Customer.objects.update_or_create(
    code="UAT-GREEN-SALES",
    defaults={"name": "UAT-GREEN Sales Customer", "status": "ACTIVE"},
)

commercial_family, _ = CommercialFamily.objects.update_or_create(
    code="DRYFRUIT",
    defaults={
        "name": "Dry Fruit Pouches",
        "default_form": "POUCH",
        "default_reporting_group": "FG",
        "active": True,
    },
)

film_family, _ = InventoryMaterial.objects.update_or_create(
    code="UAT-GREEN-PET",
    defaults={
        "name": "UAT-GREEN PET Family",
        "category": "FILM_FAMILY",
        "density_gcm3": Decimal("1.3800"),
        "status": "ACTIVE",
        "commercial_family": commercial_family,
    },
)
film_variant, _ = InventoryMaterial.objects.update_or_create(
    code="UAT-GREEN-PET-12",
    defaults={
        "name": "UAT-GREEN PET 12u",
        "category": "FILM_VARIANT",
        "parent_family": film_family,
        "density_gcm3": Decimal("1.3800"),
        "is_purchasable": True,
        "is_extrudable": False,
        "status": "ACTIVE",
        "commercial_family": commercial_family,
    },
)
sealant_family, _ = InventoryMaterial.objects.update_or_create(
    code="UAT-GREEN-PE",
    defaults={
        "name": "UAT-GREEN PE Family",
        "category": "FILM_FAMILY",
        "density_gcm3": Decimal("0.9200"),
        "status": "ACTIVE",
        "commercial_family": commercial_family,
    },
)
sealant_variant, _ = InventoryMaterial.objects.update_or_create(
    code="UAT-GREEN-PE-40",
    defaults={
        "name": "UAT-GREEN PE 40u",
        "category": "FILM_VARIANT",
        "parent_family": sealant_family,
        "density_gcm3": Decimal("0.9200"),
        "is_purchasable": True,
        "is_extrudable": False,
        "status": "ACTIVE",
        "commercial_family": commercial_family,
    },
)

template = (
    TemplateBlueprint.objects.select_related("routing_rule")
    .filter(name__iexact="courier bags", status="LIVE")
    .first()
)
if template is None:
    extrusion, _ = Process.objects.update_or_create(
        code="UATGREENEXTRUSION",
        defaults={
            "name": "UAT GREEN Extrusion",
            "input_form": "BULK",
            "output_form": "ROLL",
            "roll_behavior": "CREATE_NEW",
        },
    )
    printing, _ = Process.objects.update_or_create(
        code="UATGREENPRINT",
        defaults={
            "name": "UAT GREEN Printing",
            "input_form": "ROLL",
            "output_form": "ROLL",
            "roll_behavior": "MODIFY_EXISTING",
        },
    )
    lamination, _ = Process.objects.update_or_create(
        code="UATGREENLAMINATION",
        defaults={
            "name": "UAT GREEN Lamination",
            "input_form": "ROLL",
            "output_form": "ROLL",
            "roll_behavior": "MULTI_INPUT_COMBINE",
        },
    )
    pouching, _ = Process.objects.update_or_create(
        code="UATGREENPOUCHING",
        defaults={
            "name": "UAT GREEN Pouching",
            "input_form": "ROLL",
            "output_form": "BULK",
            "roll_behavior": "NONE",
        },
    )
    routing, _ = RoutingRule.objects.update_or_create(
        name="UAT GREEN Courier Route",
        defaults={"ordered_processes": [extrusion.code, printing.code, lamination.code, pouching.code]},
    )
    desired_order = [extrusion.code, printing.code, lamination.code, pouching.code]
    if routing.ordered_processes != desired_order:
        routing.ordered_processes = desired_order
        routing.save(update_fields=["ordered_processes"])
    template, _ = TemplateBlueprint.objects.update_or_create(
        name="courier bags",
        defaults={
            "fg_type": "POUCH",
            "status": "LIVE",
            "routing_rule": routing,
            "pouch_style": "THREE_SIDE_SEAL",
            "commercial_family": commercial_family,
        },
    )

sku, _ = SalesSku.objects.update_or_create(
    code="UAT-GREEN-DRYFRUIT",
    defaults={
        "name": "UAT-GREEN Dry Fruit Pouch",
        "template": template,
        "commercial_family": commercial_family,
        "default_line_name": "UAT-GREEN Dry Fruit Pouch",
        "active": True,
    },
)

variant_specs = [
    ("DRYFRUIT-200X200", "UAT-GREEN Dry Fruit Pouch 200 x 200", 200, 200),
    ("DRYFRUIT-240X300", "UAT-GREEN Dry Fruit Pouch 240 x 300", 240, 300),
    ("DRYFRUIT-300X400", "UAT-GREEN Dry Fruit Pouch 300 x 400", 300, 400),
]

variants = []
for code, name, width_mm, height_mm in variant_specs:
    variant, _ = SalesSkuVariant.objects.update_or_create(
        sku=sku,
        code=code,
        defaults={
            "name": name,
            "active": True,
            "finished_good_type": "POUCH",
            "roll_form": "",
            "geometry_snapshot": {
                "base": {"width_mm": width_mm, "height_mm": height_mm},
                "adjustments": [],
                "multipliers": {"faces": 1},
            },
            "layer_snapshot": [
                {
                    "family_id": str(film_family.id),
                    "variant_id": str(film_variant.id),
                    "thickness_micron": 12,
                    "density_g_cm3": 1.38,
                },
                {
                    "family_id": str(sealant_family.id),
                    "variant_id": str(sealant_variant.id),
                    "thickness_micron": 40,
                    "density_g_cm3": 0.92,
                },
            ],
            "printing_snapshot": {"enabled": False},
            "chemicals_snapshot": {},
            "addons_snapshot": [],
            "packaging_snapshot": {},
        },
    )
    variants.append(variant)

pod_material, _ = InventoryMaterial.objects.update_or_create(
    code="UAT-GREEN-SALES-POD-280",
    defaults={
        "name": "UAT-GREEN Sales POD 280",
        "category": "POD",
        "base_uom": "KG",
        "pod_type": "SINGLE",
        "pod_fixed_height_mm": Decimal("280"),
        "pod_thickness_micron": Decimal("30"),
        "pod_panel_count": 1,
        "pod_is_inhouse_produced": True,
        "density_gcm3": Decimal("0.9200"),
        "status": "ACTIVE",
    },
)
pod_sku, _ = PodSku.objects.update_or_create(
    code="POD-280",
    defaults={"name": "POD 280", "family": "POD", "active": True},
)
pod_variant, _ = PodSkuVariant.objects.update_or_create(
    pod_sku=pod_sku,
    code="POD-280-SINGLE",
    defaults={
        "name": "POD 280 Single",
        "material": pod_material,
        "active": True,
        "production_defaults_json": {"pod_height_mm": 280},
        "reporting_attributes_json": {"display_height_mm": 280},
    },
)

quote_payload = {
    "customer": str(customer.id),
    "plant": str(plant.id),
    "customer_name": customer.name,
    "terms": "Standard commercial terms apply.",
    "items": [
        {
            "sku_variant_id": str(variants[0].id),
            "line_name": "UAT-GREEN Repeat Pouch",
            "qty_value": 2500,
            "qty_uom": "PCS",
            "price_basis": "PCS",
            "geometry": {"base": {"width_mm": 200, "height_mm": 200}},
            "commercial_snapshot": {"manual_unit_price": Decimal("6.90"), "tax_percent": 18},
        },
        {
            "sku_variant_id": str(variants[1].id),
            "line_name": variants[1].name,
            "qty_value": 1800,
            "qty_uom": "PCS",
            "price_basis": "PCS",
            "geometry": {"base": {"width_mm": 240, "height_mm": 300}},
            "commercial_snapshot": {"manual_unit_price": Decimal("9.40"), "tax_percent": 18},
        },
    ],
}

quotation = QuotationService.create_quotation(quote_payload)
sales_order = QuotationService.convert_to_sales_order(quotation)
repeat_item = sales_order.items.order_by("created_at").first()

payload = {
    "generated_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
    "admin_username": getattr(admin, "username", "admin"),
    "customer_id": str(customer.id),
    "customer_name": customer.name,
    "plant_id": str(plant.id),
    "plant_name": plant.name,
    "commercial_family_code": commercial_family.code,
    "sku_id": str(sku.id),
    "sku_code": sku.code,
    "shared_sku_code": sku.code,
    "pouch_template_name": template.name,
    "shared_variant_name": variants[0].name,
    "repeat_line_name": (repeat_item.line_name if repeat_item and repeat_item.line_name else "UAT-GREEN Repeat Pouch"),
    "variant_codes": [variant.code for variant in variants],
    "quotation_id": str(quotation.id),
    "quotation_number": quotation.quote_number,
    "sales_order_id": str(sales_order.id),
    "sales_order_number": sales_order.order_number,
    "pod_sku_code": pod_sku.code,
    "pod_variant_code": pod_variant.code,
    "report_profiles": list(ReportDistributionProfile.objects.order_by("report_code").values_list("report_code", flat=True)),
}

target = runtime_dir() / "sales-seed.json"
target.write_text(json.dumps(payload, indent=2), encoding="utf-8")
print(f"Sales UI E2E seed complete: {target}")
