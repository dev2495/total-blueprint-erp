import json
import os
import sys
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

import django
from django.utils import timezone
from unittest.mock import patch

sys.path.insert(0, os.getcwd())
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings_script")
os.environ.setdefault("SKIP_ADMIN_APP_IMPORT", "1")
django.setup()

from django.contrib.auth import get_user_model
from django.conf import settings
from rest_framework.test import APIClient

from apps.analytics.models import ReportDistributionProfile
from apps.costing.models import MaterialCostSnapshot, ProcessCostRate
from apps.factory.models import Plant, PlantLegalProfile, Process
from apps.materials.models import CommercialFamily, InventoryMaterial, PodSku, PodSkuVariant, ProductMaster, ProductMasterSize, PouchStyleMaster
from apps.routing.models import RoutingRule
from apps.sales.models import Customer, CustomerProductOverlay, Quotation, SalesOrder, SalesOrderItem, SalesSku, SalesSkuVariant
from apps.sales.services.quotation_cost_build import QuotationCostBuildService
from apps.sales.services.quotation_lifecycle import QuotationLifecycleService
from apps.sales.services.quotation_service import QuotationService
from apps.templates.models import TemplateBlueprint
from apps.users.models import CompanyProfile


database = settings.DATABASES["default"]
database_name = str(database.get("NAME") or "").strip().lower()
database_host = str(database.get("HOST") or "").strip().lower()
if database_host not in {"127.0.0.1", "localhost"} or not (
    database_name.startswith("test_")
    or database_name in {"tpp_test", "tpp_v2_test"}
    or database_name.startswith("tpp_v2_test_")
):
    raise RuntimeError("Refusing sales E2E fixture writes: use an isolated local test database.")
if os.environ.get("UI_E2E_ALLOW_TEST_FIXTURE_WRITES") != "1":
    raise RuntimeError("Set UI_E2E_ALLOW_TEST_FIXTURE_WRITES=1 to seed the local UI E2E database.")


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
if admin is None:
    raise RuntimeError("UI E2E sales seeding requires the local test admin created by ensure_superuser.py.")

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
    defaults={
        "name": "UAT-GREEN Sales Customer",
        "status": "ACTIVE",
        "email": "uat-green@example.com",
    },
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

product_master, _ = ProductMaster.objects.update_or_create(
    code="PM-UAT-GREEN-DRYFRUIT",
    defaults={
        "name": "UAT-GREEN Dry Fruit Product Master",
        "product_kind": "POUCH",
        "template": template,
        "default_template": template,
        "commercial_family": commercial_family,
        "default_reporting_group": "FG",
        "reusable_policy": "CONFIGURABLE",
        "layer_template": [
            {
                "role": "outer",
                "name": "PET 12u outer",
                "film_variant_code": film_variant.code,
                "thickness_micron": 12,
                "thickness_options": [12],
            },
            {
                "role": "sealant",
                "name": "PE 40u sealant",
                "film_variant_code": sealant_variant.code,
                "thickness_micron": 40,
                "thickness_options": [40],
            },
        ],
        "canonical_layer_stack": [
            {
                "role": "outer",
                "name": "PET 12u outer",
                "film_variant_code": film_variant.code,
                "thickness_micron": 12,
                "thickness_options": [12],
            },
            {
                "role": "sealant",
                "name": "PE 40u sealant",
                "film_variant_code": sealant_variant.code,
                "thickness_micron": 40,
                "thickness_options": [40],
            },
        ],
        "variant_axes": [
            {
                "axis": "size",
                "label": "Size",
                "type": "geometry",
                "required": True,
                "scope": "geometry",
                "options": ["DRYFRUIT-200X200", "DRYFRUIT-240X300", "DRYFRUIT-300X400"],
            }
        ],
        "fixed_attributes": {
            "fg_type": "POUCH",
            "layer_count": 2,
            "print_capable": False,
            "pouch_style": "THREE_SIDE_SEAL",
            "multipliers": {"faces": 2},
            "trim_loss_mm": 10,
            "trim_apply_to": "WIDTH",
        },
        "description": "UAT-GREEN reset-safe Product Master used by Sales manual Product Master order E2E.",
        "active": True,
    },
)
pouch_style = PouchStyleMaster.objects.filter(
    code="THREE_SIDE_SEAL",
    locked=True,
    deprecated=False,
).first()
if pouch_style is None:
    raise RuntimeError("The canonical THREE_SIDE_SEAL Pouch Style Master is unavailable.")
CustomerProductOverlay.objects.update_or_create(
    product_master=product_master,
    customer=customer,
    customer_item_code="UAT-GREEN-DRYFRUIT",
    defaults={
        "customer_display_name": "UAT-GREEN Dry Fruit Pouch",
        "margin_floor_pct": Decimal("10.00"),
        "active": True,
    },
)
sizes_by_code = {}
for sort_order, (size_code, label, width_mm, height_mm) in enumerate(
    [
        ("DRYFRUIT-200X200", "Dry Fruit 200 x 200", 200, 200),
        ("DRYFRUIT-240X300", "Dry Fruit 240 x 300", 240, 300),
        ("DRYFRUIT-300X400", "Dry Fruit 300 x 400", 300, 400),
    ],
    start=1,
):
    size, _ = ProductMasterSize.objects.update_or_create(
        product_master=product_master,
        code=size_code,
        defaults={
            "label": label,
            "width_mm": Decimal(str(width_mm)),
            "height_mm": Decimal(str(height_mm)),
            "roll_width_mm": Decimal(str(width_mm * 2 + 10)),
            "qty_uom": "PCS",
            "geometry_config": {
                "pouch_style": "THREE_SIDE_SEAL",
                "trim_loss_mm": 10,
                "trim_apply_to": "WIDTH",
                "multipliers": {"faces": 2},
            },
            "pouch_style_master": pouch_style,
            "pouch_style_version": pouch_style.version,
            "active": True,
            "sort_order": sort_order,
        },
    )
    sizes_by_code[size_code] = size

sku, _ = SalesSku.objects.update_or_create(
    code="UAT-GREEN-DRYFRUIT",
    defaults={
        "name": "UAT-GREEN Dry Fruit Pouch",
        "template": template,
        "commercial_family": commercial_family,
        "product_master": product_master,
        "axis_values_template": {"size": "DRYFRUIT-200X200"},
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
                    "film_variant_code": film_variant.code,
                    "material_code": film_variant.code,
                    "thickness_micron": 12,
                    "density_g_cm3": 1.38,
                },
                {
                    "family_id": str(sealant_family.id),
                    "variant_id": str(sealant_variant.id),
                    "film_variant_code": sealant_variant.code,
                    "material_code": sealant_variant.code,
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
    "contact_name": "UAT E2E Contact",
    "contact_email": customer.email,
    "billing_address": "UAT E2E fixture address, not a customer billing address",
    "shipping_address": "UAT E2E fixture address, not a delivery destination",
    "valid_until": (timezone.localdate() + timedelta(days=30)).isoformat(),
    "payment_terms": "UAT E2E only; no payment is due",
    "delivery_terms": "UAT E2E only; no delivery is scheduled",
    "terms": "UAT E2E fixture quotation; not a customer offer.",
    "items": [
        {
            "sku_variant_id": str(variants[0].id),
            "line_kind": "CATALOG",
            "product_master_id": str(product_master.id),
            "size_id": str(sizes_by_code["DRYFRUIT-200X200"].id),
            "pouch_style_id": str(pouch_style.id),
            "spec_snapshot": {
                "width_mm": 200,
                "height_mm": 200,
                "gusset_mm": 0,
                "pouch_style_id": str(pouch_style.id),
                "layers": [
                    {"material_id": str(film_variant.id), "micron": 12},
                    {"material_id": str(sealant_variant.id), "micron": 40},
                ],
            },
            "line_name": "UAT-GREEN Repeat Pouch",
            "qty_value": 2500,
            "qty_uom": "PCS",
            "price_basis": "PCS",
            "rate": Decimal("6.90"),
        },
        {
            "sku_variant_id": str(variants[1].id),
            "line_kind": "CATALOG",
            "product_master_id": str(product_master.id),
            "size_id": str(sizes_by_code["DRYFRUIT-240X300"].id),
            "pouch_style_id": str(pouch_style.id),
            "spec_snapshot": {
                "width_mm": 240,
                "height_mm": 300,
                "gusset_mm": 0,
                "pouch_style_id": str(pouch_style.id),
                "layers": [
                    {"material_id": str(film_variant.id), "micron": 12},
                    {"material_id": str(sealant_variant.id), "micron": 40},
                ],
            },
            "line_name": variants[1].name,
            "qty_value": 1800,
            "qty_uom": "PCS",
            "price_basis": "PCS",
            "rate": Decimal("9.40"),
        },
    ],
}

# Quote lifecycle acceptance needs statutory fields. Keep conspicuously fake
# values confined to the explicitly guarded, isolated local UI E2E database.
company_profile = CompanyProfile.get_solo()
company_profile.gstin = "UAT-TEST-GSTIN"
company_profile.pan = "UAT-TEST-PAN"
company_profile.save(update_fields=["gstin", "pan", "updated_at"])

existing_fixture_quotation = Quotation.objects.filter(
    customer_name=customer.name,
    status="DRAFT",
    items__line_name__startswith="UAT-GREEN ",
).distinct().order_by("-created_at").first()

quotation = (
    QuotationService.update_quotation(existing_fixture_quotation, quote_payload)
    if existing_fixture_quotation
    else QuotationService.create_quotation(quote_payload)
)
# The quotation preview accepts nested variant geometry, while Cost Build reads
# its established flat snapshot contract. Preserve both forms in this fixture.
for item in quotation.items.all():
    geometry = dict(item.geometry_snapshot or {})
    base_geometry = geometry.get("base") if isinstance(geometry.get("base"), dict) else {}
    width_mm = geometry.get("width_mm") or base_geometry.get("width_mm")
    height_mm = geometry.get("height_mm") or base_geometry.get("height_mm")
    if width_mm and height_mm:
        geometry.update({"width_mm": width_mm, "height_mm": height_mm})
        item.geometry_snapshot = geometry
    layers = [dict(row) for row in (item.layer_snapshot or []) if isinstance(row, dict)]
    for layer in layers:
        micron = layer.get("micron") or layer.get("thickness_micron")
        density = layer.get("density_gcm3") or layer.get("density_g_cm3")
        if micron and density:
            layer.setdefault("micron", micron)
            layer.setdefault("density_gcm3", density)
            layer.setdefault("gsm", float(Decimal(str(micron)) * Decimal(str(density))))
        if not layer.get("material_id"):
            material_code = layer.get("film_variant_code") or layer.get("material_code")
            material = InventoryMaterial.objects.filter(code=material_code).first() if material_code else None
            if material:
                layer["material_id"] = str(material.id)
    item.layer_snapshot = layers
    item.save(update_fields=["geometry_snapshot", "layer_snapshot", "updated_at"])

for material, rate in ((film_variant, Decimal("180.0000")), (sealant_variant, Decimal("140.0000"))):
    if not MaterialCostSnapshot.objects.filter(material=material, avg_rate_per_kg=rate, uom="KG").exists():
        MaterialCostSnapshot.objects.create(material=material, avg_rate_per_kg=rate, uom="KG")

route_process_codes = (quotation.items.first().template.routing_rule.ordered_processes or [])
cost_process = Process.objects.filter(code__in=route_process_codes).order_by("code").first()
if cost_process is None:
    raise RuntimeError("The accepted quotation fixture has no governed route process for Cost Build.")
process_rate = ProcessCostRate.objects.filter(
    process=cost_process,
    is_active=True,
    cost_per_hour__gt=0,
).order_by("created_at").first()
if process_rate is None:
    process_rate = ProcessCostRate.objects.create(
        process=cost_process,
        cost_per_hour=Decimal("600.00"),
        is_active=True,
    )

quote_items = list(quotation.items.order_by("created_at"))
cost_result = QuotationCostBuildService.persist(
    quotation,
    {
        "cost_entry_mode": "CONVERSION_TOTAL",
        "pricing_definition": "MARKUP_ON_COST",
        "target_percent": "20",
        "conversion_components": [
            {
                "quotation_item_id": str(item.id),
                "category": "PROCESS",
                "label": f"{item.line_name} route conversion",
                "source_type": "PROCESS_RATE",
                "process_cost_rate_id": str(process_rate.id),
                "quantity": "1",
                "uom": "HOUR",
                "basis": "PER_HOUR",
            }
            for item in quote_items
        ],
    },
    user=admin,
)
if not cost_result.get("readiness", {}).get("ready"):
    raise RuntimeError(f"The governed quotation fixture is not ready for approval: {cost_result.get('readiness')}")

User = get_user_model()
approver, _ = User.objects.get_or_create(
    username="uat-green-quotation-approver",
    defaults={
        "email": "uat-green-quotation-approver@example.com",
        "is_staff": True,
        "is_superuser": True,
    },
)
if not approver.is_superuser or not approver.is_staff:
    approver.is_superuser = True
    approver.is_staff = True
    approver.save(update_fields=["is_superuser", "is_staff"])

QuotationLifecycleService.submit(quotation, user=admin)
QuotationLifecycleService.approve_gate(
    quotation,
    gate="COMMERCIAL",
    user=approver,
    reason="UAT-GREEN controlled commercial approval",
)
QuotationLifecycleService.approve_gate(
    quotation,
    gate="FINANCE",
    user=approver,
    reason="UAT-GREEN controlled finance approval",
)

send_client = APIClient()
send_client.force_authenticate(approver)
with patch(
    "apps.users.services.email_service.EmailDeliveryService.configuration_status",
    return_value=(True, ""),
), patch(
    "apps.users.services.email_service.EmailDeliveryService.send_email",
    return_value={"provider": "LOCAL_E2E", "provider_message_id": f"uat-green-{quotation.id}"},
):
    send_response = send_client.post(
        f"/api/sales/quotations/{quotation.id}/send/",
        {"recipients": [customer.email]},
        format="json",
    )
if send_response.status_code != 200:
    raise RuntimeError(f"Could not complete the controlled quotation delivery lifecycle: {send_response.content!r}")

quotation.refresh_from_db()
QuotationLifecycleService.record_client_outcome(
    quotation,
    outcome="ACCEPTED",
    reference="UAT-GREEN-PO-2026-001",
    channel="EMAIL",
    reason="",
    user=admin,
)
quotation.refresh_from_db()
sales_order = QuotationService.convert_to_sales_order(quotation)
if sales_order.source_quotation_revision_id != quotation.id:
    raise RuntimeError("The accepted quotation revision was not carried into the seeded Sales Order.")
# Keep the E2E order fixture complete for the product master's required size
# axis when downstream acceptance refreshes its governed template snapshots.
for order_item in SalesOrderItem.objects.filter(
    product_master=product_master,
    sales_order__customer=customer,
).select_related("sku_variant"):
    axis_values = dict(order_item.axis_values or {})
    if axis_values.get("size"):
        continue
    size_code = str(getattr(order_item.sku_variant, "code", "") or "")
    if size_code:
        order_item.axis_values = {**axis_values, "size": size_code}
        order_item.save(update_fields=["axis_values"])
repeat_item = sales_order.items.order_by("created_at").first()

payload = {
    "generated_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
    "admin_username": getattr(admin, "username", "admin"),
    "customer_id": str(customer.id),
    "customer_name": customer.name,
    "plant_id": str(plant.id),
    "plant_name": plant.name,
    "commercial_family_code": commercial_family.code,
    "product_master_id": str(product_master.id),
    "product_master_code": product_master.code,
    "sku_id": str(sku.id),
    "sku_code": sku.code,
    "shared_sku_code": sku.code,
    "pouch_template_name": template.name,
    "shared_variant_name": variants[0].name,
    "repeat_line_name": (repeat_item.line_name if repeat_item and repeat_item.line_name else "UAT-GREEN Repeat Pouch"),
    "variant_codes": [variant.code for variant in variants],
    "quotation_id": str(quotation.id),
    "quotation_number": quotation.quote_number,
    "quotation_status": quotation.status,
    "quotation_cost_checksum": quotation.cost_build.checksum,
    "sales_order_id": str(sales_order.id),
    "sales_order_number": sales_order.order_number,
    "pod_sku_code": pod_sku.code,
    "pod_variant_code": pod_variant.code,
    "report_profiles": list(ReportDistributionProfile.objects.order_by("report_code").values_list("report_code", flat=True)),
}

target = runtime_dir() / "sales-seed.json"
target.write_text(json.dumps(payload, indent=2), encoding="utf-8")
print(f"Sales UI E2E seed complete: {target}")
