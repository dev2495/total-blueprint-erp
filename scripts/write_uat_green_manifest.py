import json
import os
import sys
from pathlib import Path

import django

sys.path.insert(0, os.getcwd())
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from apps.analytics.models import ReportDispatchRun
from apps.sales.models import Quotation, SalesOrder, SalesSku


def runtime_dir() -> Path:
    target = Path(os.environ.get("UI_E2E_RUNTIME_DIR", Path(os.getcwd()) / ".runtime" / "ui-e2e"))
    target.mkdir(parents=True, exist_ok=True)
    return target


sales_seed_path = runtime_dir() / "sales-seed.json"
sales_seed = json.loads(sales_seed_path.read_text(encoding="utf-8")) if sales_seed_path.exists() else {}

sku = SalesSku.objects.filter(code=sales_seed.get("sku_code", "UAT-GREEN-DRYFRUIT")).prefetch_related("variants").first()
quotation = Quotation.objects.filter(quote_number=sales_seed.get("quotation_number")).first()
sales_order = SalesOrder.objects.filter(order_number=sales_seed.get("sales_order_number")).first()

report_runs = list(
    ReportDispatchRun.objects.order_by("-created_at")
    .values("id", "report_code", "report_date", "status", "pdf_file_name", "detail_file_name")[:20]
)

payload = {
    "generated_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
    "sku": {
        "code": getattr(sku, "code", None),
        "name": getattr(sku, "name", None),
        "variant_codes": list(sku.variants.order_by("code").values_list("code", flat=True)) if sku else [],
    },
    "quotation": {
        "id": str(quotation.id) if quotation else None,
        "quote_number": getattr(quotation, "quote_number", None),
    },
    "sales_order": {
        "id": str(sales_order.id) if sales_order else None,
        "order_number": getattr(sales_order, "order_number", None),
    },
    "report_runs": report_runs,
}

target = runtime_dir() / "uat-green-manifest.json"
target.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
print(f"UAT green manifest written: {target}")
