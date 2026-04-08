import json
import os
import sys
from pathlib import Path

import django

sys.path.insert(0, os.getcwd())
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings_script")
os.environ.setdefault("SKIP_ADMIN_APP_IMPORT", "1")
django.setup()

from apps.analytics.models import ReportDispatchRun, ReportDistributionProfile
from apps.materials.models import PodSku
from apps.sales.models import Quotation, SalesOrder, SalesSku


def runtime_dir() -> Path:
    target = Path(os.environ.get("UI_E2E_RUNTIME_DIR", Path(os.getcwd()) / ".runtime" / "ui-e2e"))
    target.mkdir(parents=True, exist_ok=True)
    return target


def require(condition, message):
    if not condition:
        raise SystemExit(message)


sales_seed_path = runtime_dir() / "sales-seed.json"
require(sales_seed_path.exists(), "Missing sales-seed.json runtime metadata.")
sales_seed = json.loads(sales_seed_path.read_text(encoding="utf-8"))

sku = SalesSku.objects.filter(code=sales_seed["sku_code"]).prefetch_related("variants").first()
require(sku is not None, f"Missing sales SKU {sales_seed['sku_code']}.")
variant_codes = sorted(list(sku.variants.values_list("code", flat=True)))
require(
    variant_codes == sorted(sales_seed["variant_codes"]),
    f"Dry-fruit variants mismatch: expected {sales_seed['variant_codes']}, got {variant_codes}.",
)

quotation = Quotation.objects.filter(quote_number=sales_seed["quotation_number"]).first()
require(quotation is not None, f"Missing quotation {sales_seed['quotation_number']}.")
require(quotation.items.filter(sku_variant__sku=sku).exists(), "Dry-fruit quotation does not retain SKU-driven line items.")

sales_order = SalesOrder.objects.filter(order_number=sales_seed["sales_order_number"]).first()
require(sales_order is not None, f"Missing sales order {sales_seed['sales_order_number']}.")
require(sales_order.items.filter(sku_variant__sku=sku).exists(), "Converted sales order lost SKU lineage.")

pod_sku = PodSku.objects.filter(code=sales_seed["pod_sku_code"], variants__code=sales_seed["pod_variant_code"]).first()
require(pod_sku is not None, f"Missing POD SKU {sales_seed['pod_sku_code']} / {sales_seed['pod_variant_code']}.")

expected_reports = {
    ReportDistributionProfile.ReportCode.OWNER_EXECUTIVE_DAILY,
    ReportDistributionProfile.ReportCode.PRODUCTION_DAILY,
    ReportDistributionProfile.ReportCode.DISPATCH_DAILY,
    ReportDistributionProfile.ReportCode.PACKING_DISPATCH_SUMMARY_DAILY,
    ReportDistributionProfile.ReportCode.STOCK_STANDING_DAILY,
}
actual_profiles = set(ReportDistributionProfile.objects.values_list("report_code", flat=True))
require(expected_reports.issubset(actual_profiles), f"Missing report profiles: {sorted(expected_reports - actual_profiles)}")

actual_runs = set(
    ReportDispatchRun.objects.filter(report_code__in=expected_reports).values_list("report_code", flat=True)
)
require(expected_reports.issubset(actual_runs), f"Missing report runs: {sorted(expected_reports - actual_runs)}")

acceptance_report = runtime_dir() / "acceptance" / "e2e_report.json"
require(acceptance_report.exists(), "Missing tagged acceptance report.")

payload = {
    "status": "passed",
    "sales": {
        "sku_code": sku.code,
        "variant_codes": variant_codes,
        "quotation_number": quotation.quote_number,
        "sales_order_number": sales_order.order_number,
    },
    "pod": {
        "pod_sku_code": pod_sku.code,
        "variant_code": sales_seed["pod_variant_code"],
    },
    "reports": sorted(expected_reports),
    "acceptance_report": str(acceptance_report),
}

target = runtime_dir() / "business-truth.json"
target.write_text(json.dumps(payload, indent=2), encoding="utf-8")
print(f"Business truth verification passed: {target}")
