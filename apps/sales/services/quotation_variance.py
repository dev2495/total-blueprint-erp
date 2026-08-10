from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction

from apps.sales.models import QuotationActualVariance


ZERO = Decimal("0")


class QuotationVarianceService:
    """Bridge frozen quote cost inputs to downstream, source-backed actual costs."""

    @classmethod
    @transaction.atomic
    def refresh_for_order_item(cls, order_item):
        try:
            quote_item = order_item.source_quotation_item
        except Exception:
            return None
        try:
            order_cost = order_item.costing
        except Exception:
            return None
        coverage = Decimal(order_cost.actual_cost_coverage_pct or ZERO)
        if coverage <= 0:
            return None

        components = quote_item.cost_components.all()
        quoted_material = sum(
            (Decimal(row.component_cost or ZERO) for row in components if row.category == "MATERIAL"),
            ZERO,
        )
        quoted_conversion = sum(
            (Decimal(row.component_cost or ZERO) for row in components if row.category != "MATERIAL"),
            ZERO,
        )
        quoted_total = quoted_material + quoted_conversion
        if quoted_total <= 0:
            raise ValidationError("Frozen quote line has no attributable cost components for variance comparison.")

        actual_material = Decimal(order_cost.material_cost_actual or ZERO)
        actual_conversion = (
            Decimal(order_cost.conversion_cost_actual or ZERO)
            + Decimal(order_cost.overhead_cost_absorbed or ZERO)
        )
        actual_total = actual_material + actual_conversion
        variance_amount = actual_total - quoted_total
        variance_percent = (variance_amount / quoted_total * Decimal("100")).quantize(Decimal("0.0001"))
        quotation = quote_item.quotation
        global_component_count = quotation.cost_build.components.filter(quotation_item__isnull=True).count()
        variance, _ = QuotationActualVariance.objects.update_or_create(
            quotation_item=quote_item,
            defaults={
                "sales_order_item": order_item,
                "quoted_material_cost": quoted_material,
                "quoted_conversion_cost": quoted_conversion,
                "quoted_total_cost": quoted_total,
                "actual_material_cost": actual_material,
                "actual_conversion_cost": actual_conversion,
                "actual_total_cost": actual_total,
                "variance_amount": variance_amount,
                "variance_percent": variance_percent,
                "actual_coverage_pct": coverage,
                "source_snapshot": {
                    "quotation_revision_id": str(quotation.id),
                    "quotation_cost_checksum": quotation.cost_build.checksum,
                    "sales_order_item_id": str(order_item.id),
                    "order_cost_id": str(order_cost.id),
                    "costing_mode": order_cost.costing_mode,
                    "coverage_flags": list(order_cost.coverage_flags or []),
                    "actual_material_source": "OrderCost.material_cost_actual",
                    "actual_conversion_source": (
                        "OrderCost.conversion_cost_actual + OrderCost.overhead_cost_absorbed"
                    ),
                    "unallocated_global_quote_components": global_component_count,
                },
            },
        )
        return variance
