from rest_framework import serializers

from .models import Quotation, QuotationItem


class QuotationItemSerializer(serializers.ModelSerializer):
    template_name = serializers.ReadOnlyField(source="template.name")
    sku_variant_name = serializers.ReadOnlyField(source="sku_variant.name")
    sku_variant_code = serializers.ReadOnlyField(source="sku_variant.code")
    source_mode = serializers.SerializerMethodField()
    actual_variance = serializers.SerializerMethodField()

    class Meta:
        model = QuotationItem
        fields = [
            "id",
            "template",
            "template_name",
            "sku_variant",
            "sku_variant_name",
            "sku_variant_code",
            "source_mode",
            "actual_variance",
            "product_master",
            "product_master_size",
            "product_variant",
            "pouch_style_master",
            "artwork",
            "revised_from_item",
            "converted_sales_order_item",
            "line_name",
            "finished_good_type",
            "roll_form",
            "qty_value",
            "qty_uom",
            "price_basis",
            "geometry_snapshot",
            "layer_snapshot",
            "printing_snapshot",
            "chemicals_snapshot",
            "addons_snapshot",
            "packaging_snapshot",
            "physics_snapshot",
            "bom_snapshot",
            "process_cost_rows",
            "commercial_snapshot",
            "costing_snapshot",
            "canonical_source_snapshot",
            "spec_signature",
            "cost_snapshot_checksum",
            "unit_weight_g",
            "total_weight_kg",
            "quoted_unit_price",
            "quoted_line_total",
            "line_kind",
            "spec_snapshot",
            "margin_lock",
            "manual_rate_override",
            "hsn_code",
            "gst_rate",
            "created_at",
            "updated_at",
        ]

    def get_source_mode(self, obj):
        return "SKU" if obj.sku_variant_id else "CUSTOM"

    def get_actual_variance(self, obj):
        try:
            row = obj.actual_variance
        except Exception:
            return None
        return {
            "quoted_material_cost": row.quoted_material_cost,
            "quoted_conversion_cost": row.quoted_conversion_cost,
            "quoted_total_cost": row.quoted_total_cost,
            "actual_material_cost": row.actual_material_cost,
            "actual_conversion_cost": row.actual_conversion_cost,
            "actual_total_cost": row.actual_total_cost,
            "variance_amount": row.variance_amount,
            "variance_percent": row.variance_percent,
            "actual_coverage_pct": row.actual_coverage_pct,
            "source": row.source_snapshot,
            "calculated_at": row.calculated_at,
        }


class QuotationSerializer(serializers.ModelSerializer):
    items = QuotationItemSerializer(many=True, read_only=True)
    customer_code = serializers.ReadOnlyField(source="customer.code")
    plant_name = serializers.ReadOnlyField(source="plant.name")
    converted_sales_order_number = serializers.ReadOnlyField(source="converted_sales_order.order_number")
    approved_by_name = serializers.SerializerMethodField()
    sent_by_name = serializers.SerializerMethodField()
    rejected_by_name = serializers.SerializerMethodField()
    cost_build = serializers.SerializerMethodField()
    approval_gates = serializers.SerializerMethodField()
    deliveries = serializers.SerializerMethodField()
    audit_events = serializers.SerializerMethodField()
    readiness = serializers.SerializerMethodField()

    class Meta:
        model = Quotation
        fields = [
            "id",
            "quote_number",
            "customer",
            "customer_name",
            "customer_code",
            "enquiry_reference",
            "contact_name",
            "contact_email",
            "contact_phone",
            "billing_address",
            "shipping_address",
            "plant",
            "plant_name",
            "status",
            "valid_until",
            "currency",
            "terms",
            "payment_terms",
            "delivery_terms",
            "requested_delivery_date",
            "place_of_supply",
            "tax_snapshot",
            "notes",
            "custom_terms",
            "discount_pct",
            "discount_amount",
            "freight_amount",
            "freight_included",
            "other_charges",
            "gst_rate",
            "status_history",
            "rejection_reason",
            "sent_at",
            "sent_by",
            "sent_by_name",
            "approved_at",
            "approved_by",
            "approved_by_name",
            "rejected_by",
            "rejected_by_name",
            "accepted_at",
            "accepted_by",
            "acceptance_reference",
            "acceptance_channel",
            "cancelled_at",
            "cancelled_by",
            "cancellation_reason",
            "voided_at",
            "voided_by",
            "void_reason",
            "frozen_at",
            "revision_no",
            "revision_root_id",
            "parent_quotation",
            "totals_snapshot",
            "converted_sales_order",
            "converted_sales_order_number",
            "items",
            "cost_build",
            "approval_gates",
            "deliveries",
            "audit_events",
            "readiness",
            "created_at",
            "updated_at",
        ]

    def _user_name(self, user):
        if not user:
            return None
        return (
            getattr(user, "full_name", None)
            or getattr(user, "get_full_name", lambda: "")()
            or getattr(user, "username", None)
            or getattr(user, "email", None)
        )

    def get_approved_by_name(self, obj):
        return self._user_name(getattr(obj, "approved_by", None))

    def get_sent_by_name(self, obj):
        return self._user_name(getattr(obj, "sent_by", None))

    def get_rejected_by_name(self, obj):
        return self._user_name(getattr(obj, "rejected_by", None))

    def get_cost_build(self, obj):
        try:
            cost = obj.cost_build
        except Exception:
            return None
        return {
            "id": str(cost.id), "status": cost.status, "currency": cost.currency,
            "pricing_definition": cost.pricing_definition, "target_percent": cost.target_percent,
            "material_cost": cost.material_cost, "conversion_cost": cost.conversion_cost,
            "total_cost": cost.total_cost, "net_sale": cost.net_sale, "tax_amount": cost.tax_amount,
            "grand_total": cost.grand_total, "contribution": cost.contribution,
            "markup_pct": cost.markup_pct, "gross_margin_pct": cost.gross_margin_pct,
            "readiness": cost.readiness_snapshot, "sensitivity": cost.sensitivity_snapshot,
            "formula_version": cost.formula_version, "checksum": cost.checksum,
        }

    def get_approval_gates(self, obj):
        return [
            {
                "id": str(row.id), "gate": row.gate, "status": row.status, "reason": row.reason,
                "requested_by": str(row.requested_by_id or ""), "requested_at": row.requested_at,
                "decided_by": str(row.decided_by_id or ""), "decided_at": row.decided_at,
                "expires_at": row.expires_at, "snapshot_checksum": row.snapshot_checksum,
            }
            for row in obj.approval_gates.all()
        ]

    def get_deliveries(self, obj):
        return [
            {
                "id": str(row.id), "channel": row.channel, "recipient": row.recipient,
                "status": row.status, "provider": row.provider, "provider_message_id": row.provider_message_id,
                "attempted_at": row.attempted_at, "delivered_at": row.delivered_at,
                "artifact_checksum": row.artifact.checksum,
            }
            for row in obj.deliveries.select_related("artifact").all()
        ]

    def get_audit_events(self, obj):
        return [
            {
                "id": str(row.id), "event_type": row.event_type, "note": row.note,
                "actor": str(row.actor_id or ""), "created_at": row.created_at,
                "metadata": row.metadata,
            }
            for row in obj.audit_events.all()
        ]

    def get_readiness(self, obj):
        if obj.status != "DRAFT":
            return {"ready": obj.status in {"PENDING_APPROVAL", "APPROVED", "SENT", "ACCEPTED", "CONVERTED"}, "errors": []}
        try:
            from .services.quotation_lifecycle import QuotationLifecycleService
            errors = QuotationLifecycleService.readiness_errors(obj)
        except Exception as exc:
            errors = [str(exc)]
        return {"ready": not errors, "errors": errors}
